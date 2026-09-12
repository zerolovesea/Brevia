"""录音落盘 → Silero VAD 分段 → 单次高精度识别 → 完整句字幕。"""

import base64
import re
import sys
import tempfile
import time
from array import array
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from difflib import SequenceMatcher
from pathlib import Path

from .asr import DEFAULT_REFINED_MODEL_ID, RefinedASR, SentenceVAD
from .audio_io import convert_to_pcm_wav
from .config import SETTINGS
from .worker_llm import TRANSLATION_MODEL_ID
from .worker_common import (
    ModelNotInstalled,
    missing_models,
    default_refined_model_for_language,
    model_supports_language,
    require,
    synchronized_recording,
)

MAX_MIX_BUFFER_MS = 5000
_MIX_STALL = object()

# 一条字幕的（下限、目标、上限）。目标决定什么时候可以提交，上限决定还能并进多少；
# 下限用来避免把一句话单独发成一段。中文按字数、拉丁按字符数，两者对应的时间跨度
# 大致相当（中文约 5 字/秒，英文约 13 字符/秒）。
SUBTITLE_LENGTHS = {"cjk": (60, 110, 150), "latin": (150, 280, 380)}
# 上一段押住的尾句与下一段之间的最大时间缝：超过它说明中间已经有别的段落提交过，
# 不能再把两句接成一句。切点回看会让下一段的起点比上一段终点更早，因此容差要算上。
SUBTITLE_JOIN_GAP_MS = 700
# 段落之间的最小静音：只有真正的长停顿才另起一段。实测真实会议里 VAD 端点之后的静音
# 中位数只有 30–50 ms、p75 300–500 ms，把端点当段落边界会切出平均 24 字的碎片段；
# 上界取 1.2 s（远高于 p75，又低于"人真的停下来了"的量级）。
SUBTITLE_PARAGRAPH_GAP_MS = 1200
# 不足目标的段落最多滞留多久再兜底提交。按**结果到达的间隔**（墙钟）衡量，而不是
# 音频时钟：识别一旦落后 L 秒，段落的 end_ms 就落后当前音频位置 L 秒，用音频时钟会让
# 慢机器上的每个段落一生成就被冲掉，碎片化重现。语义上要问的是「说话人还在继续说
# 吗」，而「还有没有新的识别结果到来」正好回答它。必须大于连续语音里相邻片段的到达
# 间隔（实测音频间隔 p99 约 1.4 s、解码结果墙钟到达间隔 p90 约 6.5 s），又要小到说话人
# 停下后字幕不至于长时间空着。实测扫描：2s→22 段、3s→16 段、8s→5 段、12s 以上与
# 「只用长停顿规则」等价，因此取 8 s。
SUBTITLE_PARAGRAPH_HOLD_SECONDS = 8.0


class RecordingSessionMixin:
    @synchronized_recording
    def start(self, payload):
        """创建会议并启动 VAD 分句识别。

        Args:
            payload: 标题、语言及识别模型 ID，可附带分类和标签。

        Returns:
            新会议详情；同时发布 ``meeting.started``。
        """
        require(payload, "title")
        payload = self._sentence_payload(payload)
        if self.active:
            raise ValueError("A meeting is already active")
        required_models = [payload["refined_model_id"], payload["vad_model_id"]]
        if payload.get("target_language"):
            required_models.append(TRANSLATION_MODEL_ID)
        missing = missing_models(self.models, required_models)
        if payload.get("require_models") and missing:
            raise ModelNotInstalled(missing)
        meeting = self.store.create_meeting(payload)
        self._prepare_active(
            meeting,
            audio_tracks=payload.get("audio_tracks"),
        )
        self.emit("meeting.started", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def import_audio(self, payload):
        """导入录音，统一转为本地 16 kHz 单声道 WAV 后创建可精修会议。"""
        require(
            payload,
            "title",
            "path",
        )
        payload = self._sentence_payload(payload)
        source = Path(payload["path"])
        if not source.is_file():
            raise ValueError("Audio file not found")
        meeting = self.store.create_meeting(payload)
        destination = (
            self.store.meetings_dir / meeting["id"] / "audio" / "playback-mic.wav"
        )
        try:
            convert_to_pcm_wav(source, destination)
            import wave

            with wave.open(str(destination)) as audio:
                duration_ms = round(audio.getnframes() * 1000 / audio.getframerate())
            result = self.store.finish_imported_meeting(meeting["id"], duration_ms)
        except Exception:
            self.store.soft_delete(meeting["id"])
            self.store.permanent_delete(meeting["id"])
            raise
        self.emit("meeting.imported", {"meeting_id": result["id"], "meeting": result})
        return result

    @synchronized_recording
    def resume(self, payload):
        """恢复一场未正常结束的录音，并从给定毫秒位置继续计时。"""
        require(payload, "meeting_id")
        if self.active:
            raise ValueError("A meeting is already active")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] != "recording":
            raise ValueError("Only an unfinished recording can be resumed")
        # 恢复入口以前不校验也不修复识别模型：加载失败会被 _prepare_active 吞成一条警告，
        # 于是会议"恢复成功"却全程没有字幕。先修掉失效/退役的模型，再让加载失败向上抛，
        # 由 main.js 明确告诉用户「录音仍在本地保留，但转写无法恢复」。
        meeting = self._repair_refined_model(meeting)
        start_ms = self.store.recorded_duration_ms(meeting["id"])
        # 恢复时从录音 manifest 推导本场打开了哪些捕获轨道，以重建双轨混音。
        # ``audio_tracks`` 未落库，但原始双轨的落盘记录就是最可靠的来源：双轨会议
        # 的 manifest tracks 含 mic/system 两键，单轨只含其一。否则恢复的双轨会议会
        # 退回 mic/system 分别转写，重现「同一人声两条字幕」的旧 bug。
        manifest = self.store.read_manifest(meeting["id"])
        recorded_tracks = set(manifest.get("tracks", {}))
        audio_tracks = [track for track in ("mic", "system") if track in recorded_tracks]
        self._prepare_active(meeting, start_ms, audio_tracks=audio_tracks, require_asr=True)
        self.emit("meeting.recovered", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def _sentence_payload(self, payload):
        payload = {**payload, "language": payload.get("language") or "auto"}
        model_id = payload.get("refined_model_id") or self._default_refined_model(payload["language"])
        model = self.models.get(model_id)
        if "refined" not in model.get("stages", []):
            raise ValueError("Sentence transcription requires an offline ASR model")
        if not model_supports_language(model, payload["language"]):
            if payload["language"] == "auto":
                raise ValueError("Automatic multilingual transcription requires a multilingual model (Qwen3-ASR or Parakeet)")
            raise ValueError(f"Model {model_id} does not support {payload['language']}")
        return {**payload, "refined_model_id": model_id,
                "vad_model_id": payload.get("vad_model_id") or "silero-vad"}

    def _default_refined_model(self, language):
        """按 ``models.json`` 的 ``default_for_languages`` 选该语言的默认识别模型。

        规则只有一处实现（``models.json`` 的 ``default_for_languages`` +
        ``refined_priority``），前端读同一份字段，两端连「候选顺序」都一致。

        这里传入 ``self.models.is_ready``：清单里声明的默认模型没装时改选一个已安装且
        支持该语言的模型。不这样做的话，后端会把用户从没选过的模型当成默认值送给加载器
        ——精修老会议时凭空弹出一个几 GB 的下载，而前端在同一条路径上会回落到已安装的
        模型，两端对同一个语言给出不同的模型。

        清单里没有模型支持该语言（旧会议记录的冷门语言码、或将来新增的语言）时回落到
        ``DEFAULT_REFINED_MODEL_ID``，保证调用方拿到的是一个可用 id 而不是 None。
        """
        return (
            default_refined_model_for_language(self.models, language, is_ready=self.models.is_ready)
            or DEFAULT_REFINED_MODEL_ID
        )

    def _repair_refined_model(self, meeting, language=None):
        """把会议指向的识别模型修成当前可用的，返回更新后的会议字典。

        会议记录里的 ``refined_model_id`` 可能指向已退役的模型、已从清单移除的模型，或
        用户已删除本地文件的模型。``ModelManager.remove_deprecated_models`` 会在启动时
        把退役模型的本地副本清掉，因此这些 id 加载时必然失败。

        ``start`` / ``import_audio`` / ``refine`` / ``reconfigure`` 都会重新校验模型，
        但 ``resume``（进程崩溃后的自动恢复）以前既不校验也不修复：它直接进
        ``_prepare_active``，加载失败被吞成一条 ``worker.warning``，于是整场会议照常
        "恢复"却一条字幕都不出。这个入口现在也走同一修复。

        Args:
            meeting: 会议详情字典。
            language: 覆盖会议语言（换语言时用），省略则用会议自身的语言。

        Returns:
            修复后的会议字典；无需修改时返回入参本身。未安装但型号合法的模型**不改动**
            ——那是「用户还没下载」，应当由 ``model_required`` 提示下载，而不是静默换型号。
        """
        model_id = meeting.get("refined_model_id")
        language = language or meeting.get("language") or "auto"
        model = self.models.get(model_id) if model_id and self.models.is_known(model_id) else None
        needs_repair = (
            model is None
            or model.get("retired")
            or "refined" not in model.get("stages", [])
            or not model_supports_language(model, language)
        )
        if not needs_repair:
            return meeting
        replacement = self._default_refined_model(language)
        if replacement == model_id:
            return meeting
        return self.store.update_meeting(meeting["id"], {"refined_model_id": replacement})

    def _prepare_active(self, meeting, start_ms=0, audio_tracks=None, require_asr=False):
        """建立一场实时会话的识别链路。

        Args:
            meeting: 会议详情。
            start_ms: 起始毫秒（恢复录制时用）。
            audio_tracks: 本场打开的捕获轨道。
            require_asr: 识别链路建不起来时是否上抛。录制入口（``start``）保持 False：
                「识别失败也保住原始录音」是既有产品约定，失败只发一条
                ``worker.warning``，音频照常落盘。恢复入口（``resume``）传 True——
                那里报"恢复成功"却全程没有字幕是在骗用户，必须让调用方看到失败。

        Raises:
            RuntimeError: ``require_asr`` 为 True 且识别链路不可用时。
        """
        self.active = meeting["id"]
        self.meeting_language = meeting["language"]
        self.stream_state = {}
        self.live_tracks = set(audio_tracks or ())
        self.live_mix_buffers = {"mic": deque(), "system": deque()}
        self.pending_subtitles, self.pending_join = {}, {}
        self.pending_paragraphs = {}
        self.subtitle_expiry_ms = 0
        self.vad = None
        self.asr = None
        self.live_postprocessing = None
        try:
            self.asr = RefinedASR(self.models, meeting["refined_model_id"], language=meeting["language"])
            # 连续语音硬上限取「语言配置」与识别模型容量（如 FunASR Nano ~22 s）的
            # 较小值：超过模型 KV 容量的长段会整段解码为空，单人播客场景会漏识别。
            self.vad = SentenceVAD(
                self.models,
                meeting.get("vad_model_id") or "silero-vad",
                meeting["language"],
                max_speech_duration=self.asr.max_speech_seconds,
            )
            self.live_postprocessing = ThreadPoolExecutor(max_workers=1, thread_name_prefix="brevia-sentence")
        except (RuntimeError, ValueError) as error:
            self.asr = None
            self.vad = None
            self.live_postprocessing = None
            if require_asr:
                # 恢复入口：由调用方（resume）把失败报给用户并中止恢复，这里不重复发警告，
                # 否则用户会先收到一条"识别不可用"、再收到一条"无法恢复"。
                #
                # 但必须把刚写下的会话状态一并回滚：`self.active` 已在方法开头置位，
                # 若原样上抛，下一次 start/resume 会撞上 "A meeting is already
                # active"，录音被卡死到进程重启（主进程"先下载再重试 resume"也会
                # 在重试时失败）。线程池与 AI 笔记此刻都还没建，只需清纯状态字段。
                self._clear_active_session()
                raise
            # 录制入口：保住录音，但这一场永远不会有实时字幕。这条警告是**常驻卡片**的数据源
            # （前端按 code 渲染，而不是一闪而过的 toast）——否则用户以为在记，其实只在录。
            self.emit(
                "worker.warning",
                {
                    "meeting_id": self.active,
                    "code": "asr_unavailable",
                    "message": str(error),
                },
            )

    @synchronized_recording
    def pause(self, payload):
        require(payload, "meeting_id", "paused")
        self._active(payload["meeting_id"])
        if payload["paused"]:
            self._flush_sentences()
        return {"paused": bool(payload["paused"])}

    @synchronized_recording
    def reconfigure(self, payload):
        """先构建新模型，切换前提交旧语言的末句；排队段保留自己的模型。"""
        require(payload, "meeting_id")
        self._active(payload["meeting_id"])
        previous = self.store.get_meeting(self.active)
        changes = {key: payload[key] for key in ("language", "refined_model_id", "target_language") if key in payload}
        # 无论改哪一项都先修一次存量模型：退役、已下架、或带不动新语言的 id 都换成该语言
        # 可用的默认模型。修复只针对「型号不可用」，不动「用户还没下载」的合法型号。
        # 注意 ``previous`` 必须保持为会话启动时实际加载的那个会议记录，下面比较
        # ``changed_asr`` 才有意义。
        repaired = self._repair_refined_model(previous, language=changes.get("language"))
        updated = self._sentence_payload({**repaired, **changes})
        changed_asr = self.asr is None or any(updated[key] != previous[key] for key in ("language", "refined_model_id"))
        asr, vad = self.asr, self.vad
        if changed_asr:
            asr = RefinedASR(self.models, updated["refined_model_id"], language=updated["language"])
            vad = SentenceVAD(
                self.models,
                updated["vad_model_id"],
                updated["language"],
                max_speech_duration=asr.max_speech_seconds,
            )
        if updated.get("target_language") and not self.models.is_ready(TRANSLATION_MODEL_ID):
            raise ModelNotInstalled([TRANSLATION_MODEL_ID])
        if changed_asr:
            self._flush_sentences()
        meeting = self.store.update_meeting(self.active, {key: updated[key] for key in (
            "language", "refined_model_id", "target_language")})
        if self.live_postprocessing is None and asr is not None:
            self.live_postprocessing = ThreadPoolExecutor(max_workers=1, thread_name_prefix="brevia-sentence")
        self.asr, self.vad = asr, vad
        self.meeting_language = updated["language"]
        self.emit("meeting.reconfigured", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def _enhance_live_microphone(self, samples):
        """仅为实时识别补偿偏弱麦克风音量，原始录音不受影响。"""
        config = SETTINGS["live_asr"]
        if not len(samples):
            return samples
        rms = (
            sum(float(sample) * float(sample) for sample in samples) / len(samples)
        ) ** 0.5
        if rms < config["microphone_minimum_rms"]:
            return samples
        gain = min(config["microphone_max_gain"], config["microphone_target_rms"] / rms)
        peak = max(abs(float(sample)) for sample in samples)
        if peak:
            gain = min(gain, config["microphone_peak"] / peak)
        return samples if gain <= 1 else samples * gain

    def _mix_live_audio(self, track, samples, start_ms, sample_rate):
        """按时间对齐双轨 PCM，供实时字幕使用；原始双轨仍分别落盘。"""
        if not len(samples):
            return None
        buffers = self.live_mix_buffers
        buffer = buffers[track]
        peer = "system" if track == "mic" else "mic"
        if track == "mic":
            samples = self._enhance_live_microphone(samples)
        buffer.append([float(start_ms), samples])
        if not buffers[peer] and start_ms - buffer[0][0] >= MAX_MIX_BUFFER_MS:
            return _MIX_STALL
        while buffers[peer] and start_ms - buffers[peer][0][0] > MAX_MIX_BUFFER_MS:
            buffers[peer].popleft()
        mic, system = buffers["mic"], buffers["system"]
        if not mic or not system:
            return None
        import numpy

        # 双轨启动并不总是同步。较早轨道的内容若直接丢弃，会造成会议开头
        # 缺字幕；先把它送进同一条 mix 流，等两轨时间重叠后再混音。
        while mic and system:
            start_ms = max(mic[0][0], system[0][0])
            earlier = mic if mic[0][0] < system[0][0] else system
            if earlier[0][0] < start_ms:
                chunk_start, chunk = earlier[0]
                count = min(
                    len(chunk),
                    round((start_ms - chunk_start) * sample_rate / 1000),
                )
                if count:
                    leading = chunk[:count]
                    if count == len(chunk):
                        earlier.popleft()
                    else:
                        earlier[0] = [start_ms, chunk[count:]]
                    return leading, round(chunk_start)
            for queue in (mic, system):
                chunk_start, chunk = queue[0]
                skip = round((start_ms - chunk_start) * sample_rate / 1000)
                if skip >= len(chunk):
                    queue.popleft()
                elif skip > 0:
                    queue[0] = [start_ms, chunk[skip:]]
            if not mic or not system:
                return None
            count = min(len(mic[0][1]), len(system[0][1]))
            # 相加而非先除以 2：双轨都有人声时，若直接 (mic+system)*0.5 会把每条
            # 轨压到 -6dB，偏弱人声再叠加降噪就更容易被抑制。改为先求和，仅当峰值
            # 超过 1 时按峰值软限幅（保真度高于硬 clip），既保留较大一轨的音量，
            # 又避免近满幅双轨叠加削顶失真。
            mixed = mic[0][1][:count] + system[0][1][:count]
            peak = float(numpy.abs(mixed).max()) if count else 0.0
            if peak > 1.0:
                mixed = mixed / peak
            next_start = start_ms + count * 1000 / sample_rate
            for queue in (mic, system):
                chunk_start, chunk = queue[0]
                if count == len(chunk):
                    queue.popleft()
                else:
                    queue[0] = [next_start, chunk[count:]]
            return mixed, round(start_ms)
        return None

    @synchronized_recording
    def audio(self, payload):
        """先保存原始 PCM；采集线程只做 VAD，识别在单独线程串行执行。"""
        require(payload, "meeting_id", "track", "pcm", "sample_rate", "start_ms")
        self._active(payload["meeting_id"])
        track = payload["track"]
        sample_rate = int(payload["sample_rate"])
        start_ms = int(payload["start_ms"])
        if track not in {"mic", "system", "mix"} or sample_rate != 16000 or start_ms < 0:
            raise ValueError("Sentence transcription requires a valid track, 16 kHz PCM and nonnegative timestamp")
        pcm = base64.b64decode(payload["pcm"], validate=True)
        values = array("h")
        values.frombytes(pcm)
        if sys.byteorder != "little":
            values.byteswap()
        import numpy
        samples = numpy.asarray(values, dtype=numpy.float32) / 32768.0
        total = 0 if track == "mix" or not pcm else self.store.append_audio(self.active, track, pcm, sample_rate, start_ms)
        if self.live_tracks == {"mic", "system"} and track != "mix":
            mixed = self._mix_live_audio(track, samples, start_ms, sample_rate)
            if mixed is _MIX_STALL:
                self._flush_sentences()
                self.live_tracks = {track}
                return {"samples": total}
            elif mixed is None:
                return {"samples": total}
            else:
                samples, start_ms = mixed
                track = "mix"
        elif track == "mic":
            samples = self._enhance_live_microphone(samples)
        if self.vad and self.asr:
            for segment in self.vad.accept(track, samples, start_ms):
                self._queue_sentence(track, segment)
        if self.live_postprocessing and start_ms >= self.subtitle_expiry_ms:
            self.subtitle_expiry_ms = start_ms + 1000
            self.live_postprocessing.submit(self._flush_subtitle_tails, start_ms)
        if payload.get("flush"):
            self._flush_sentences()
        return {"samples": total}

    def _flush_sentences(self):
        if not (self.vad and self.asr):
            return
        # 双轨最后一帧可能还在等待对轨；按原时间轴送完后再 flush。
        for queue in self.live_mix_buffers.values():
            while queue:
                start_ms, samples = queue.popleft()
                for segment in self.vad.accept("mix", samples, start_ms):
                    self._queue_sentence("mix", segment)
        for track in list(self.vad.tracks):
            for segment in self.vad.flush(track):
                self._queue_sentence(track, segment)
        if self.live_postprocessing:
            self.live_postprocessing.submit(self._flush_subtitle_tails)
            # 排空后临时行必须跟着撤下，否则界面上会留一条内容已经进正式段落的残留行。
            # 只通知真的提交过段落的音轨，避免为从未出现的音轨发空事件。
            for track in list(self.stream_state):
                self.live_postprocessing.submit(self._emit_draft, track, self.active)

    def _queue_sentence(self, track, segment):
        # VAD/Smart Turn is the sole endpoint authority. Holding an endpoint here
        # to merge a possible next one makes live captions arrive in bursts.
        boundary = segment[3] if len(segment) > 3 else "endpoint"
        self._submit_sentence(track, segment[0], segment[1], segment[2], boundary)

    def _submit_sentence(self, track, start_ms, end_ms, samples, boundary="endpoint"):
        import numpy
        sequence = self.stream_state.get(track, 0)
        self.stream_state[track] = sequence + 1
        event = {"meeting_id": self.active, "segment_id": f"{track}-{start_ms}-{sequence}",
                 "revision": 1, "start_ms": start_ms, "end_ms": end_ms, "boundary": boundary,
                 # 实时段落只区分「本机用户」与远端整轨：说话人细分交给会后精修。
                 "speaker": "local-user" if track == "mic" else "spk-1",
                 "speaker_name": None, "track": track}
        # 队列只持有路径，慢设备积压时不把整场语音留在内存。原录音始终独立保留。
        directory = self.store.meetings_dir / self.active / "audio"
        with tempfile.NamedTemporaryFile(dir=directory, prefix="sentence-", suffix=".npy", delete=False) as file:
            numpy.save(file, samples, allow_pickle=False)
            path = Path(file.name)
        try:
            self.live_postprocessing.submit(self._decode_sentence, self.asr, event, path)
        except Exception:
            path.unlink(missing_ok=True)
            raise

    def _decode_sentence(self, asr, event, path):
        """每段只提交一次 final；不读活动会话锁，stop 可安全等待队列排空。"""
        import numpy
        try:
            samples = numpy.load(path, allow_pickle=False)
            text = self._clean_live_text(asr.decode(samples, 16000))
            if not text:
                return
            for subtitle in self._chunk_subtitles(event, text):
                self._emit_subtitle(subtitle)
            self._emit_draft(event["track"], event["meeting_id"])
        except Exception as error:
            self.emit("worker.warning", {"meeting_id": event["meeting_id"], "code": "sentence_transcription_failed",
                       "message": str(error), "start_ms": event["start_ms"], "end_ms": event["end_ms"]})
        finally:
            path.unlink(missing_ok=True)

    def _chunk_subtitles(self, event, text):
        """把一段识别结果切成字幕，并与上一段押住的悬空尾句接上。

        连续语音（播客、视频音轨、没人停顿的会议）里没有可用的停顿，段落只能按目标
        长度或硬上限切开，切点落在一句话中间。识别器看不到切点之后的内容，会给截断
        音频补一个句号，于是「约翰就算改变了这个世界。／也拯救不了……」。这里按句号
        先把这一段切成句子，只把**最后一句**押住：前面的完整句子交给
        :meth:`_coalesce_subtitles` 攒成段落，下一段到达时再由 :meth:`_join_pending`
        决定用逗号还是直接相接。
        """
        track = event["track"]
        sentences = self._attach_leading_closers(
            [sentence for sentence in self._split_sentences(text) if sentence.strip()]
        )
        if not sentences:
            return
        pending = self.pending_subtitles.pop(track, None)
        total = sum(len(sentence) for sentence in sentences) or 1
        duration = event["end_ms"] - event["start_ms"]
        offset = 0
        windows = []
        for sentence in sentences:
            start = event["start_ms"] + round(duration * offset / total)
            offset += len(sentence)
            windows.append((start, event["start_ms"] + round(duration * offset / total), sentence))
        limit = self._length_limits(text)[2]
        pieces = []
        overlap_ms = self._vad_overlap_ms()
        body_from = windows[0][0]
        style = self.pending_join.pop(track, None)
        if pending:
            gap = windows[0][0] - pending["end_ms"]
            # 起点早于上一段终点说明两段音频重叠（切点回看）。重叠区的字符数按本段
            # 自己的语速换算——这是接缝对齐唯一需要的先验，比固定字数可靠。
            overlap_chars = self._overlap_chars(text, duration, -gap if gap < 0 else 0)
            joined = self._join_pending(
                pending["text"], windows[0][2], style, overlap_chars
            )
            # 段间时间必须相接（切点是连续的），太远说明中间已经有别的段落提交过；
            # 切点回看会让本段起点早于上一段终点，这时同样算相接，重复的字交给去重。
            contiguous = -overlap_ms <= gap <= SUBTITLE_JOIN_GAP_MS
            if joined and contiguous and len(joined) <= limit:
                pieces.append({**pending, "text": joined, "end_ms": windows[0][1]})
                windows.pop(0)
                body_from = windows[0][0] if windows else event["end_ms"]
            else:
                pieces.append(pending)
        # 切在停顿上或硬上限上的段落，末尾标点不可信；语义端点上也可能是识别器
        # 自己断在半句话上（尾字是虚词），同样押住等下一段确认（见 _unfinished_subtitle）。
        tail = None
        if windows and (self._cut_boundary(event) or self._unfinished_subtitle(windows[-1][2])):
            start, _, text_of_tail = windows.pop()
            tail = {**event, "segment_id": f"{event['segment_id']}-tail",
                    "start_ms": start, "end_ms": event["end_ms"], "text": text_of_tail}
            body_until = start
        else:
            body_until = event["end_ms"]
        if windows:
            body = "".join(sentence for _, _, sentence in windows)
            pieces.extend(self._sentence_subtitles(
                {**event, "start_ms": body_from, "end_ms": body_until}, body))
        if tail:
            self.pending_subtitles[track] = tail
            self.pending_join[track] = "comma" if event.get("boundary") == "pause" else None
        yield from self._coalesce_subtitles(track, pieces)

    def _coalesce_subtitles(self, track, pieces):
        """把候选字幕攒成段落再提交，避免一句话一段。

        段落边界只有三种：攒够目标长度、遇到明显长停顿（``SUBTITLE_PARAGRAPH_GAP_MS``）、
        再并进去就超过上限。**不用 VAD 端点当段落边界**——实测真实会议里端点之后的
        静音中位数只有 30–50 ms，按端点切会得到平均 24 字、四分之一不足 20 字的碎片
        段（见 ``SUBTITLE_PARAGRAPH_GAP_MS`` 的注释）。端点只说明「这句的话末标点可信」，
        与段落多长无关。

        合并只在「并进去还不超过上限」时进行；但当前段落本身短于下限时宁可略微超限
        也要并，否则会留下一条只有十几个字的字幕。不足目标的段落由
        :meth:`_flush_subtitle_tails` 的滞留上限兜底提交，实时字幕不会无限等下去。
        """
        touched_at = time.monotonic()
        paragraph = self.pending_paragraphs.pop(track, None)
        for piece in pieces:
            if paragraph is None:
                paragraph = {**piece, "touched_at": touched_at}
                continue
            held = len(paragraph["text"])
            minimum, target, limit = self._length_limits(paragraph["text"] + piece["text"])
            long_pause = piece["start_ms"] - paragraph["end_ms"] >= SUBTITLE_PARAGRAPH_GAP_MS
            if not long_pause and held < target and (held + len(piece["text"]) <= limit or held < minimum):
                paragraph = {**paragraph, "text": self._join_text(paragraph["text"], piece["text"]),
                             "end_ms": piece["end_ms"], "touched_at": time.monotonic()}
                continue
            yield paragraph
            paragraph = {**piece, "touched_at": touched_at}
        if paragraph is None:
            return
        if len(paragraph["text"]) >= self._length_limits(paragraph["text"])[1]:
            yield paragraph
        else:
            self.pending_paragraphs[track] = paragraph

    def _vad_overlap_ms(self):
        """切点回看长度（见 ``asr.CUT_OVERLAP_MS``）；自定义 VAD 没有该属性时按 0。"""
        overlap = getattr(self.vad, "cut_overlap_ms", 0)
        return overlap if isinstance(overlap, (int, float)) and not isinstance(overlap, bool) else 0

    @staticmethod
    def _overlap_chars(text, duration_ms, overlap_ms):
        """重叠的那段音频大约对应本段开头的多少个字。

        接缝对齐只需要一个搜索窗口，窗口大小就取「重叠时长 × 本段语速」。语速从本段
        自己的字数与时长算出，因此和 :meth:`_sentence_subtitles` 估句时间轴用的是
        同一个尺度，不会两头各估一次。
        """
        if overlap_ms <= 0 or duration_ms <= 0:
            return 0
        per_ms = len(text) / duration_ms
        return max(2, min(8, round(overlap_ms * per_ms)))

    @staticmethod
    def _cut_boundary(event):
        """段落是被连续语音硬上限切出来的（末尾句号不可信），而不是语义端点。"""
        return event.get("boundary") in {"pause", "cut"}

    @classmethod
    def _join_pending(cls, previous, current, style, overlap_chars=0):
        """把押着的悬空尾句与下一段的首句接起来；不该接时返回 ``None``。

        这正是流式识别里的 LocalAgreement 原则在本链路的落地：切点附近那段音频被
        解码了两次，**两次都认同的部分才算数**。上一段押住的尾句就是第一次假设，
        本段首句是第二次假设（它有切点左侧上下文，切点上的字只有它听得对）。

        接法按证据强弱分两档，两档都会去掉那个为截断音频补出来的句号：

        1. 两段在接缝上共享字面（硬上限把「未来」切成「…未来。」+「来，有些网友…」）
           ——去掉重叠后直接相接；
        2. 字面没完全对上（「…放电现象只会。」+「则会停止。」），但在重叠窗口内能找到
           共同字并对齐——接点之前保留上一段的说法，之后改用下一段的说法。

        另外，尾句以虚词/连接词结尾（的、在、因为、落在了……）时直接相接：这正是
        :meth:`_chunk_subtitles` 押住该尾句的理由本身，不接回来等于白押。

        ``style`` 为 ``"comma"`` 表示上一段切在停顿上（能量低谷也算）：VAD 确实听到了
        停顿，但句末句号是识别器对截断音频的补全，两段在字面上对不上时改用逗号连接，
        表示语义上这句还没说完。

        以上都不成立，说明本段开头与上一段尾句描述的不是同一段音频（例如日文台词后面
        接中文旁白，或中间已经有别的段落提交过）：返回 ``None``，让调用方原样提交，
        不发明标点把它们粘成一句。
        """
        previous = (previous or "").strip()
        current = (current or "").strip()
        if not previous:
            return current
        if not current:
            return previous
        deduped = cls._dedupe_seam(previous, current, overlap_chars)
        if deduped != current or cls._unfinished_subtitle(previous):
            return previous.rstrip("。.") + deduped
        spliced = cls._anchor_splice(previous, current, overlap_chars)
        if spliced:
            return spliced
        if style != "comma":
            return None
        head = previous.rstrip("。！？.!?；;，,、 ")
        tail = current.lstrip("，,、 ")
        return f"{head}，{tail}" if head and tail else head + tail

    @staticmethod
    def _dedupe_seam(previous, current, overlap_chars=0):
        """去掉接缝两边重复识别的字词；没有重叠时原样返回。

        硬上限把「未来」切成两段时，前一段解码成「…以此改变未来。」、后一段解码成
        「来，有些网友……」，直接相接会出现「未来来」。搜索长度取切点回看换算出的
        字符数（``_overlap_chars``）——重复只可能发生在被解码两遍的那段音频里，窗口
        之外的相同字是巧合，不能当重叠删掉。去掉重叠后新段不能为空，否则宁可保留重复。
        """
        head = current.lstrip("，,、 ")
        tail = previous.rstrip("。！？.!?；;，,、 ")
        # 窗口取切点回看换算出的字符数（`_overlap_chars` 已夹在 2..8）——重复只可能发生在
        # 被解码两遍的那段音频里，窗口之外的相同字是巧合，不能当重叠删掉。原先这里还有
        # 一个 `max(12, ...)` 下限，使上面这个换算彻底失效、两处拼接永远搜 12 字。
        window = max(2, overlap_chars)
        for length in range(min(len(tail), len(head), window), 0, -1):
            if tail[-length:] == head[:length] and len(head) > length:
                return head[length:]
        return current

    @staticmethod
    def _anchor_splice(previous, current, overlap_chars=0):
        """按共同字对齐接缝上重复识别的区间；找不到可信的共同字时返回 ``None``。

        切点回看让相邻两段音频重叠，重叠的那几百毫秒被识别了两次。识别器在切点附近
        本来就不稳——前一段只拿到截断的音频，后一段从半个字开始——两次结果可能只有
        个别字对得上（「…放电现象只会。」＋「则会停止。」，真相是「则会停止」）。逐字
        比对会漏掉这种情况，重复的字就原样留在字幕里（「放电现象只会，则会停止」）。
        这里在接缝两侧各取一小段找最长公共子串，接点之前保留上一段的说法，接点之后
        改用下一段的说法：下一段有完整上下文，切点上的字只有它听得对。

        搜索窗口取切点回看换算出的字符数（``_overlap_chars``），重叠只可能发生在这
        一小段里。只有共同子串同时落在上一段的**结尾**和本段的**开头**才算重叠的
        证据——否则只是「，」这类标点在两段里各出现一次，按它对齐会整段吞掉中间的字。
        """
        window = min(len(previous), len(current), max(2, overlap_chars))
        if window < 2:
            return None
        tail = previous[-window:].rstrip("。！？.!?；;，,、 ")
        head = current[:window]
        if len(tail) < 2 or len(head) < 2:
            return None
        match = SequenceMatcher(None, tail, head, autojunk=False).find_longest_match(
            0, len(tail), 0, len(head)
        )
        if not match.size or match.a + match.size < len(tail) - 1 or match.b > 1:
            return None
        if not re.search(r"[^\W_]", tail[match.a : match.a + match.size]):
            return None
        return previous[: len(previous) - window + match.a] + current[match.b:]

    @staticmethod
    def _attach_leading_closers(sentences):
        """把落在下一句开头的右引号/右括号并回上一句。

        识别器常把句号写在右引号之前（``……变动率的。”数值会发生改变。``），按句末标点
        切句就会把孤零零的 ``”`` 留在下一句开头，字幕里多出一条 ``”，数值会……``。
        """
        merged = []
        for sentence in sentences:
            head = ""
            while sentence and sentence[0] in "”’」』）】〉»" and merged:
                head += sentence[0]
                sentence = sentence[1:]
            if head:
                merged[-1] += head
            if sentence:
                merged.append(sentence)
        return merged

    def _tail_hold_ms(self):
        """悬空尾句最多押多久（音频时间）；必须撑过一次切段才可能接上下一段。"""
        cap = getattr(self.vad, "max_speech_seconds", None)
        seconds = float(cap) + 2.0 if isinstance(cap, (int, float)) else 12.0
        return int(max(6.0, seconds) * 1000)

    def _emit_subtitle(self, event):
        if self.store.save_segment(event):
            self.emit("transcript.final", event)
            self.emit("transcript.settled", event)
            try:
                self.ai_note_on_segment(event)
            except Exception:
                pass

    def _emit_draft(self, track, meeting_id):
        """把「正在攒的段落」作为临时行发给界面。

        它与被下线的流式 partial 不是一回事：内容来自一次**已经完成**的整句识别，
        只是还没攒够提交条件（见 :meth:`_coalesce_subtitles`）。所以它不逐字改写，
        只在下一段解码到达时增长；押住的尾句被 :meth:`_join_pending` 接缝对齐修正时
        会有小幅增减。正式段落提交后由空文本撤下。

        ``meeting_id`` 由调用方传入：本方法在识别线程上运行，而 ``self.active`` 受
        录音锁保护——stop/pause 正持着那把锁等本线程排空，读它就会死锁。
        """
        parts = [item for item in (self.pending_paragraphs.get(track),
                                   self.pending_subtitles.get(track)) if item]
        if not parts:
            self.emit("transcript.draft", {"meeting_id": meeting_id, "track": track,
                                           "segment_id": f"draft-{track}", "text": "",
                                           "start_ms": 0, "end_ms": 0, "speaker": None})
            return
        text = parts[0]["text"]
        for item in parts[1:]:
            text = self._join_text(text, item["text"])
        self.emit("transcript.draft", {
            "meeting_id": meeting_id, "track": track, "segment_id": f"draft-{track}",
            "start_ms": parts[0]["start_ms"], "end_ms": parts[-1]["end_ms"],
            "speaker": "local-user" if track == "mic" else "spk-1", "text": text,
        })

    def _flush_subtitle_tails(self, now_ms=None):
        # 每轨最多暂存一个未攒够的段落和一个悬空尾句。两者用途不同，滞留上限也不同：
        # 段落等的是「还有话要接着说」（SUBTITLE_PARAGRAPH_HOLD_SECONDS），尾句等的是
        # 「下一段解码到达」（_tail_hold_ms）。暂停/停止立即排空。
        # 段落覆盖的时间更早，先提交。
        for track, paragraph in list(self.pending_paragraphs.items()):
            if now_ms is None or time.monotonic() - paragraph.get("touched_at", 0.0) >= SUBTITLE_PARAGRAPH_HOLD_SECONDS:
                self._emit_subtitle(paragraph)
                del self.pending_paragraphs[track]
        for track, subtitle in list(self.pending_subtitles.items()):
            if now_ms is None or subtitle["end_ms"] <= now_ms - self._tail_hold_ms():
                self._emit_subtitle(subtitle)
                del self.pending_subtitles[track]
                self.pending_join.pop(track, None)

    @staticmethod
    def _unfinished_subtitle(text):
        # ponytail: 只续接明确悬空的中文连接词；完整语义判断需额外语言模型。
        return bool(re.search(r"(?:是|的|把|被|与|及|从|例如|比如|包括|在于|落在了|以外)[。.]?$", text))

    @staticmethod
    def _join_text(left, right):
        """拼接两段识别文本：拉丁词之间补一个空格，中日韩直接相接。

        片段的边界一般落在句末，上一段结尾的标点后面不会再带空格，直接相接会得到
        ``you?Muy`` 这种粘在一起的句子。
        """
        if not left:
            return right
        if not right:
            return left
        if left[-1].isspace() or right[0].isspace():
            return left + right
        if left[-1].isascii() and right[0].isascii() and right[0].isalnum():
            return f"{left} {right}"
        return left + right

    @staticmethod
    def _length_limits(text):
        """按文本主体语言给出字幕的（下限、目标、上限）；表意文字按字，拉丁按字符。

        「表意文字」必须涵盖**汉字、假名与谚文**：日/韩的默认识别模型是 qwen3-asr，
        只统计汉字会把「안녕하세요」「こんにちは」这类无汉字文本判成拉丁，从而给它们
        280/380 的上限——字幕段落会比中英会议长两三倍。
        """
        cjk_chars = len(re.findall(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]", text))
        cjk = cjk_chars > 0 and cjk_chars * 3 >= len(re.findall(r"[A-Za-z]", text))
        return SUBTITLE_LENGTHS["cjk" if cjk else "latin"]

    def _sentence_subtitles(self, event, text):
        """按目标长度聚合多句；过长时优先在完整句子、分句或单词边界切开。"""
        minimum, target, limit = self._length_limits(text)
        sentences = []
        for sentence in self._split_sentences(text):
            if sentences and self._unfinished_subtitle(sentences[-1]):
                sentences[-1] = sentences[-1].rstrip("。.") + sentence.strip()
            else:
                sentences.append(sentence)
        remaining = "".join(sentences).strip()
        parts = []
        # 句号只是候选边界；长度合适的多个句子一起提交为一条字幕。
        while len(remaining) > limit:
            upper = min(limit, len(remaining) - minimum)
            boundaries, offset = [], 0
            for sentence in self._split_sentences(remaining):
                offset += len(sentence)
                if minimum <= offset <= upper:
                    boundaries.append(offset)
            if not boundaries:
                boundaries = [match.end() for match in re.finditer(r"[，、：:;；]|(?<!\d),(?!\d)|\s+", remaining[:upper])
                              if minimum <= match.end() <= upper]
            cut = min(boundaries, key=lambda end: abs(end - target)) if boundaries else min(target, upper)
            # 不切开英文单词或数字；极长无分隔 token 保持原样。
            if not boundaries and remaining[cut - 1].isascii() and remaining[cut - 1].isalnum():
                while cut < len(remaining) and remaining[cut].isascii() and remaining[cut].isalnum():
                    cut += 1
            parts.append(remaining[:cut].strip())
            remaining = remaining[cut:].strip()
        if remaining:
            parts.append(remaining)
        # ponytail: Nano 无词时间戳，句内按字数估时；需要精确卡字时再引入对齐器。
        total = sum(map(len, parts))
        offset = 0
        duration = event["end_ms"] - event["start_ms"]
        for index, part in enumerate(parts):
            start = event["start_ms"] + round(duration * offset / total)
            offset += len(part)
            yield {**event, "segment_id": event["segment_id"] if index == 0 else f"{event['segment_id']}-s{index}",
                   "start_ms": start, "end_ms": event["start_ms"] + round(duration * offset / total), "text": part}

    @synchronized_recording
    def stop(self, payload):
        require(payload, "meeting_id", "duration_ms")
        self._active(payload["meeting_id"])
        meeting_id = self.active
        try:
            self._flush_sentences()
        finally:
            self._release_active_session()
        meeting = self.store.finish_meeting(meeting_id, payload["duration_ms"])
        meeting = self.store.get_meeting(meeting["id"])
        self.emit("meeting.stopped", {"meeting_id": meeting_id, "meeting": meeting})
        return meeting

    def _clear_active_session(self):
        """清掉一场会话的纯状态字段，不触碰线程池与 AI 笔记。

        `_release_active_session` 与 `_prepare_active` 的失败回滚共用这一份重置，
        避免两处字段清单各自漂移（漏掉一个就会留下半初始化的会话）。
        """
        self.active = self.asr = self.vad = None
        self.stream_state = {}
        self.pending_subtitles, self.pending_join = {}, {}
        self.pending_paragraphs = {}
        self.live_tracks, self.live_mix_buffers = set(), {"mic": deque(), "system": deque()}
        self.meeting_language = None
        self.subtitle_expiry_ms = 0

    def _release_active_session(self):
        # 这已是唯一识别结果，不能像旧二阶段精修那样取消排队任务。
        if self.live_postprocessing:
            self.live_postprocessing.shutdown(wait=True)
        if self.active and hasattr(self, "ai_note_stop"):
            self.ai_note_stop({"meeting_id": self.active})
        self.live_postprocessing = None
        self._clear_active_session()

    @synchronized_recording
    def shutdown_active_session(self):
        """进程退出前收尾活动会议：与 stop 相同的刷新 + 释放，走同一把录音锁。"""
        if not self.active:
            return
        try:
            self._flush_sentences()
        finally:
            self._release_active_session()

    def _active(self, meeting_id):
        self.state.require(meeting_id)
