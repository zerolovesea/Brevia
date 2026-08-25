"""聚焦的 worker 职责组件。"""

import base64
import os
import sys
import threading
from array import array
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from pathlib import Path

from .asr import (
    DEFAULT_REFINED_MODEL_ID,
    ChinesePunctuation,
    EnglishPunctuation,
    LanguageIdentifier,
    LiveDenoiser,
    RefinedASR,
    SpeakerTracker,
    StreamingASR,
)
from .audio_io import convert_to_pcm_wav
from .config import SETTINGS, SPEAKER_EMBEDDING_MODEL_ID
from .refine_sidecar import RemoteRefiner
from .worker_llm import TRANSLATION_MODEL_ID
from .worker_common import require, synchronized_recording

# 语义软钉可接受的切点：句末标点优先，逗号/分号作为次优切点（连续语音里标点模型
# 常把句号降级成逗号，若只认句号会一直等、最后从词中间硬切）。
_SENTENCE_FINAL = "。！？.!?；;"

# 实时双轨混音缓冲的时间跨度上限（毫秒）。单轨停帧时另一轨缓冲会无限增长，这里
# 限制跨度，超出即丢弃最旧帧，避免内存增长与恢复后的一次性爆量对齐。
MAX_MIX_BUFFER_MS = 5000

# ``_mix_live_audio`` 的标记值：单轨已停流超过 MAX_MIX_BUFFER_MS，应回退为该轨
# 独立转写（而非继续空等导致整场 live 字幕空白）。
_MIX_STALL = object()
_PIN_BOUNDARY = "。！？.!?；;，,"


class RecordingSessionMixin:
    @synchronized_recording
    def start(self, payload):
        """创建会议并启动流式识别。

        Args:
            payload: 标题、语言及实时/精修模型 ID，可附带分类和标签。

        Returns:
            新会议详情；同时发布 ``meeting.started``。
        """
        require(payload, "title", "language", "streaming_model_id")
        payload = {"refined_model_id": DEFAULT_REFINED_MODEL_ID, **payload}
        if self.active:
            raise ValueError("A meeting is already active")
        required_models = [
            payload.get(key)
            for key in (
                "streaming_model_id",
                "refined_model_id",
                "speaker_segmentation_model_id",
                "vad_model_id",
            )
        ]
        required_models.append(SPEAKER_EMBEDDING_MODEL_ID)
        if payload.get("target_language"):
            required_models.append(TRANSLATION_MODEL_ID)
        missing_models = [
            model_id
            for model_id in required_models
            if model_id and not self.models.is_ready(model_id)
        ]
        if payload.get("require_models") and missing_models:
            label = "Model" if len(missing_models) == 1 else "Models"
            verb = "is" if len(missing_models) == 1 else "are"
            raise RuntimeError(
                f"{label} {', '.join(missing_models)} {verb} not installed"
            )
        meeting = self.store.create_meeting(payload)
        self._prepare_active(meeting, audio_tracks=payload.get("audio_tracks"))
        self.emit("meeting.started", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def import_audio(self, payload):
        """导入录音，统一转为本地 16 kHz 单声道 WAV 后创建可精修会议。"""
        require(
            payload,
            "title",
            "language",
            "streaming_model_id",
            "path",
        )
        payload = {"refined_model_id": DEFAULT_REFINED_MODEL_ID, **payload}
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
        start_ms = self.store.recorded_duration_ms(meeting["id"])
        # 恢复时从录音 manifest 推导本场打开了哪些捕获轨道，以重建双轨混音。
        # ``audio_tracks`` 未落库，但原始双轨的落盘记录就是最可靠的来源：双轨会议
        # 的 manifest tracks 含 mic/system 两键，单轨只含其一。否则恢复的双轨会议会
        # 退回 mic/system 分别转写，重现「同一人声两条字幕」的旧 bug。
        manifest = self.store.read_manifest(meeting["id"])
        recorded_tracks = set(manifest.get("tracks", {}))
        audio_tracks = [track for track in ("mic", "system") if track in recorded_tracks]
        self._prepare_active(meeting, start_ms, audio_tracks=audio_tracks)
        self.emit("meeting.recovered", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def _prepare_active(self, meeting, start_ms=0, audio_tracks=None):
        """建立活动会议的双轨识别状态；模型不可用时仍允许安全录音。"""
        self.active = meeting["id"]
        self.meeting_language = meeting["language"]
        self.detected_language = None
        self.power_saving = bool(meeting.get("power_saving"))
        self.stream_state = {
            track: {
                "start_ms": start_ms,
                "revision": 0,
                "segment": start_ms,
                "last_text": "",
                "last_raw_text": "",
                "last_final_text": "",
                "punctuation_epoch": 0,
                "pending_pin": False,
                "audio": [],
                "refine_audio": [],
                "startup_audio": [],
                "carry_audio": [],
                "carry_raw_audio": [],
                "carry_ms": 0,
            }
            for track in ("mic", "system", "mix")
        }
        self.live_tracks = set(audio_tracks or ())
        self.live_mix_buffers = {"mic": deque(), "system": deque()}
        self.recent_finals = []
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
        self.denoiser = None

        # 各加载闭包在工作线程中运行，绝不能访问 self.active——它是受 state.lock 保护
        # 的属性，而本方法已在该锁内运行，跨线程再次获取会死锁。改用本地会议 ID。
        meeting_id = meeting["id"]

        # sherpa-onnx 模型初始化会进入原生运行时；按序加载避免不同模型的原生
        # 初始化相互竞争导致 worker 直接退出。构建闭包返回模型，由调用方决定
        # 何时/在哪个线程做赋值。
        def build_denoiser():
            if not self.power_saving and self.models.is_ready(denoiser_id):
                try:
                    return LiveDenoiser(self.models, denoiser_id)
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": meeting_id,
                            "code": "denoiser_unavailable",
                            "message": str(error),
                        },
                    )
            return None

        def build_language_identifier():
            if meeting["language"] == "auto" and self.models.is_ready("whisper-large-v3"):
                try:
                    return LanguageIdentifier(self.models)
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": meeting_id,
                            "code": "language_identifier_unavailable",
                            "message": str(error),
                        },
                    )
            return None

        def build_asr():
            try:
                return StreamingASR(
                    self.models, meeting["streaming_model_id"], meeting["language"]
                )
            except RuntimeError as error:
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": meeting_id,
                        "code": "asr_unavailable",
                        "message": str(error),
                    },
                )
                return None

        def build_punctuation():
            return self._build_live_punctuation(meeting["language"], meeting_id)

        def build_speaker_tracker():
            try:
                return SpeakerTracker(
                    self.models, max_speakers=meeting.get("num_speakers")
                )
            except RuntimeError as error:
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": meeting_id,
                        "code": "speaker_unavailable",
                        "message": str(error),
                    },
                )
                return None

        def build_live_refiner():
            model_id = (
                meeting["streaming_model_id"]
                if self.power_saving
                else meeting["refined_model_id"]
            )
            if self.models.is_ready(model_id):
                try:
                    return self._create_live_refiner(
                        model_id,
                        language=meeting.get("language"),
                        streaming=self.power_saving,
                    )
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": meeting_id,
                            "code": "live_refinement_unavailable",
                            "message": str(error),
                        },
                    )
            return None

        # 流式 ASR、降噪、标点、声纹是实时字幕的关键路径且加载快：同步加载，
        # start() 返回后首帧音频即可带标点/声纹转写。语言识别（whisper-large-v3）
        # 与实时精修模型较重，在后台按序加载，避免原生初始化竞争，同时显著缩短
        # 「准备中」等待；加载完成前语言回退到文本启发式，精修回退到流式文本。
        # 只同步加载「快」模型（降噪/标点/声纹）；流式 ASR（zipformer 等大模型
        # 加载需数秒）与语言识别、精修模型一起放到后台加载。start() 因此能立刻
        # 返回进入录制界面，加载完成前音频会被缓冲，不丢字。
        self.denoiser = build_denoiser()
        self.punctuation = build_punctuation()
        self.speaker_tracker = build_speaker_tracker()
        # 标点补发与精修各用一个单线程执行器：精修（RefinedASR）较慢，若与标点
        # 共用执行器会把快速的部分标点堵在队列里，导致字幕卡顿。
        if self.punctuation:
            self.live_punctuation = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="brevia-live-punctuation"
            )
        if self.speaker_tracker:
            self.live_postprocessing = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="brevia-live-postprocess"
            )

        def load_remaining():
            asr = build_asr()
            language_identifier = build_language_identifier()
            live_refiner = build_live_refiner()
            with self.state.lock:
                # 若会议已停止或被 reconfigure 接管，则不覆盖运行态，避免泄漏线程。
                if self.state.active != meeting_id:
                    return
                # 只填充尚未就绪的模型：若 reconfigure 或测试已提前注入，则不覆盖。
                if self.asr is None:
                    self.asr = asr
                if self.language_identifier is None:
                    self.language_identifier = language_identifier
                if self.live_refiner is None:
                    self.live_refiner = live_refiner
                if live_refiner and self.live_postprocessing is None:
                    self.live_postprocessing = ThreadPoolExecutor(
                        max_workers=1, thread_name_prefix="brevia-live-postprocess"
                    )

        self._prepare_thread = threading.Thread(target=load_remaining, daemon=True)
        self._prepare_thread.start()

    def _wait_prepare(self, timeout=10):
        """等待后台模型加载线程结束（测试/诊断用），不阻塞正常启动流程。"""
        thread = getattr(self, "_prepare_thread", None)
        if thread and thread.is_alive():
            thread.join(timeout)

    @synchronized_recording
    def pause(self, payload):
        """确认目标是当前会议；音频停送由前端负责。"""
        require(payload, "meeting_id", "paused")
        self._active(payload["meeting_id"])
        return {"paused": bool(payload["paused"])}

    def _create_live_refiner(self, model_id, language=None, streaming=False):
        """创建实时精修器。

        ``BREVIA_LIVE_REFINE_SIDECAR=1`` 时把 RefinedASR 放入独立子进程
        （见 ``refine_sidecar``），隔离崩溃并避免抢占流式 ASR；失败自动回退到
        进程内精修。默认进程内精修（已用低线程预算让出 CPU）。
        """
        if streaming:
            return StreamingASR(self.models, model_id, language=language)
        if os.environ.get("BREVIA_LIVE_REFINE_SIDECAR", "") == "1":
            return RemoteRefiner(self.models, model_id, language=language)
        return RefinedASR(self.models, model_id, language=language)

    def _build_live_punctuation(self, language, meeting_id):
        """按语言构建实时标点模型；不可用时发告警并返回 None。"""
        if language == "en":
            builder = EnglishPunctuation, SETTINGS["punctuation"]["english_model_id"]
        elif language in {"zh", "yue", "auto"}:
            builder = ChinesePunctuation, SETTINGS["punctuation"]["chinese_model_id"]
        else:
            return None
        cls, model_id = builder
        try:
            return cls(self.models, model_id)
        except RuntimeError as error:
            self.emit(
                "worker.warning",
                {
                    "meeting_id": meeting_id,
                    "code": "punctuation_unavailable",
                    "message": str(error),
                },
            )
            return None

    @synchronized_recording
    def reconfigure(self, payload):
        """会中热切换语言与实时模型，对当前录音立即生效。

        仅重建受影响的组件：改语言会同时重建实时识别与标点；改实时模型只重建识别。
        新模型先构建到局部变量，全部成功后再原子替换，任一步骤失败都不会破坏正在
        运行的识别流。缺失模型会以 ``not installed`` 抛出，交由上层触发下载流程。

        Args:
            payload: ``meeting_id`` 必填；``language``、``streaming_model_id``、
                ``target_language`` 至少提供一项。

        Returns:
            持久化后的会议详情；同时发布 ``meeting.reconfigured``。
        """
        require(payload, "meeting_id")
        self._active(payload["meeting_id"])
        meeting = self.store.get_meeting(self.active)
        language = payload.get("language") or meeting["language"]
        streaming_model_id = (
            payload.get("streaming_model_id") or meeting["streaming_model_id"]
        )
        refined_model_id = meeting["refined_model_id"]
        target_language = (
            payload.get("target_language")
            if "target_language" in payload
            else meeting["target_language"]
        )
        language_changed = language != meeting["language"]
        streaming_changed = streaming_model_id != meeting["streaming_model_id"]
        target_language_changed = target_language != meeting["target_language"]
        power_saving = bool(payload.get("power_saving", self.power_saving))
        power_saving_changed = power_saving != self.power_saving
        if not (language_changed or streaming_changed or target_language_changed or power_saving_changed):
            return meeting

        # 先校验所有目标模型已安装，缺失即抛错（不做任何替换），让上层弹出下载。
        required_models = (streaming_model_id,) if power_saving else (
            streaming_model_id, refined_model_id
        )
        missing = [
            model_id
            for model_id in required_models
            if not self.models.is_ready(model_id)
        ]
        if missing:
            label = "Model" if len(missing) == 1 else "Models"
            verb = "is" if len(missing) == 1 else "are"
            raise RuntimeError(f"{label} {', '.join(missing)} {verb} not installed")

        # 全部构建到局部变量并先持久化，成功后再一次性替换运行态。
        new_asr = self.asr
        if streaming_changed or language_changed:
            new_asr = StreamingASR(self.models, streaming_model_id, language)
        new_denoiser = self.denoiser
        new_refiner = self.live_refiner
        new_postprocessing = self.live_postprocessing
        if power_saving:
            new_denoiser = None
            if power_saving_changed or streaming_changed or language_changed:
                new_refiner = self._create_live_refiner(
                    streaming_model_id, language=language, streaming=True
                )
        else:
            if power_saving_changed:
                denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
                new_denoiser = (
                    LiveDenoiser(self.models, denoiser_id)
                    if self.models.is_ready(denoiser_id)
                    else None
                )
            if power_saving_changed:
                new_refiner = self._create_live_refiner(
                    refined_model_id, language=language
                )
            if new_refiner is not None and new_postprocessing is None:
                new_postprocessing = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="brevia-live-postprocess"
                )

        new_punctuation = self.punctuation
        new_punctuation_executor = self.live_punctuation
        new_language_identifier = self.language_identifier
        if language_changed:
            new_punctuation = self._build_live_punctuation(language, self.active)
            if new_punctuation is not None and new_punctuation_executor is None:
                new_punctuation_executor = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="brevia-live-punctuation"
                )
            new_language_identifier = None
            if language == "auto" and self.models.is_ready("whisper-large-v3"):
                try:
                    new_language_identifier = LanguageIdentifier(self.models)
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": self.active,
                            "code": "language_identifier_unavailable",
                            "message": str(error),
                        },
                    )

        try:
            meeting = self.store.update_meeting(
                self.active,
                {
                    "language": language,
                    "streaming_model_id": streaming_model_id,
                    "refined_model_id": refined_model_id,
                    "target_language": target_language,
                    "power_saving": int(power_saving),
                },
            )
        except Exception:
            if new_postprocessing is not self.live_postprocessing and new_postprocessing:
                new_postprocessing.shutdown(wait=False, cancel_futures=True)
            if (
                new_punctuation_executor is not self.live_punctuation
                and new_punctuation_executor
            ):
                new_punctuation_executor.shutdown(wait=False, cancel_futures=True)
            raise

        old_postprocessing = self.live_postprocessing
        old_punctuation_executor = self.live_punctuation
        old_refiner = self.live_refiner
        self.asr = new_asr
        self.denoiser = new_denoiser
        self.live_refiner = new_refiner
        self.live_postprocessing = new_postprocessing
        self.power_saving = power_saving
        # 替换远程精修器时回收其子进程，避免泄漏。
        if old_refiner is not new_refiner and isinstance(
            old_refiner, RemoteRefiner
        ):
            old_refiner.shutdown()
        if language_changed:
            self.meeting_language = language
            self.detected_language = None
            self.punctuation = new_punctuation
            self.language_identifier = new_language_identifier
            self.live_punctuation = new_punctuation_executor
        if old_postprocessing is not new_postprocessing and old_postprocessing:
            old_postprocessing.shutdown(wait=False, cancel_futures=True)
        if (
            old_punctuation_executor is not new_punctuation_executor
            and old_punctuation_executor
        ):
            old_punctuation_executor.shutdown(wait=False, cancel_futures=True)
        self.emit(
            "meeting.reconfigured", {"meeting_id": self.active, "meeting": meeting}
        )
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
        # 单轨停帧保护：若本轨一直有数据而对轨停流，本轨缓冲会无限增长。把缓冲
        # 跨度限制在 MAX_MIX_BUFFER_MS 内，超出即从最旧丢弃，既避免内存增长，也
        # 防止对轨恢复后的一次性爆量对齐。实时字幕优先最新内容，丢弃旧帧可接受。
        while buffer and start_ms - buffer[0][0] > MAX_MIX_BUFFER_MS:
            buffer.popleft()
        # 麦克风轨进混音前先做增益均衡，避免人声忽大忽小（与单轨时的增强一致）。
        if track == "mic":
            samples = self._enhance_live_microphone(samples)
        buffer.append([float(start_ms), samples])
        peer = "system" if track == "mic" else "mic"
        # 对轨停流检测：本轨已有超过 MAX_MIX_BUFFER_MS 的数据但从未遇到对轨，判定
        # 对轨停流。此时回退为本轨独立转写，避免整场 live 字幕空白（原始音频仍落盘，
        # 会后精修可恢复）。对轨恢复后由下一帧重新进入双轨混音。
        if not buffers[peer] and buffer and start_ms - buffer[0][0] >= MAX_MIX_BUFFER_MS:
            buffer.clear()
            return _MIX_STALL
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
            mixed = (mic[0][1][:count] + system[0][1][:count]) * 0.5
            next_start = start_ms + count * 1000 / sample_rate
            for queue in (mic, system):
                chunk_start, chunk = queue[0]
                if count == len(chunk):
                    queue.popleft()
                else:
                    queue[0] = [next_start, chunk[count:]]
            return numpy.clip(mixed, -1, 1), round(start_ms)
        return None

    @synchronized_recording
    def audio(self, payload):
        """持久化一帧音频，并在模型可用时推进实时转写。

        Args:
            payload: 会议 ID、音轨、base64 PCM16、样本率和本帧开始时间；
                ``flush`` 可强制结束当前句。

        Returns:
            累计样本数，以及模型可用时的当前文本和句末状态。

        Notes:
            partial 只通过事件发送；句末文本才写入数据库。
        """
        require(payload, "meeting_id", "track", "pcm", "sample_rate", "start_ms")
        self._active(payload["meeting_id"])
        pcm = base64.b64decode(payload["pcm"], validate=True)
        source_track = payload["track"]
        samples_total = 0 if source_track == "mix" else self.store.append_audio(
            self.active,
            source_track,
            pcm,
            int(payload["sample_rate"]),
            int(payload["start_ms"]),
        )
        values = array("h")
        values.frombytes(pcm)
        if sys.byteorder != "little":
            values.byteswap()
        import numpy

        samples = numpy.asarray(values, dtype=numpy.float32) / 32768.0
        mixed_from_dual_track = False
        if self.live_tracks == {"mic", "system"} and source_track != "mix":
            mixed = self._mix_live_audio(source_track, samples, payload["start_ms"], int(payload["sample_rate"]))
            if mixed is _MIX_STALL:
                # 对轨停流：回退为本轨独立转写，保持实时字幕不空白。
                self.live_tracks = {source_track}
                payload = {**payload, "track": source_track}
            elif mixed is None:
                return {"samples": samples_total}
            else:
                samples, mixed_start_ms = mixed
                payload = {**payload, "track": "mix", "start_ms": mixed_start_ms}
                mixed_from_dual_track = True
        state = self.stream_state[payload["track"]]
        # mix 流的 state["start_ms"] 初值为会议起点；若某轨领先导致首段混音从较晚的
        # 对齐点开始，懒初始化首段时间戳，避免首段 start_ms 被错误地前移。仅当本次
        # 确实由双轨混音产出（而非 stop() 直接 flush 的 mix 空帧）时进行。
        if (
            mixed_from_dual_track
            and payload["track"] == "mix"
            and not state["audio"]
            and not state["carry_raw_audio"]
        ):
            state["start_ms"] = mixed_start_ms
            state["segment"] = mixed_start_ms
        # 上一段软钉截断后带过来的尾巴（原始音频），先并入本段音频缓冲。
        if state["carry_raw_audio"]:
            state["audio"].extend(state["carry_raw_audio"])
            state["carry_raw_audio"] = []
        if len(samples):
            state["audio"].append(samples)
        asr_samples = (
            self._enhance_live_microphone(samples)
            if payload["track"] == "mic"
            else samples
        )
        if payload["track"] in ("mic", "mix") and self.denoiser:
            asr_samples = self.denoiser.accept(
                payload["track"],
                asr_samples,
                int(payload["sample_rate"]),
                bool(payload.get("flush")),
            )
        # 上一段软钉截断后带过来的尾巴（已降噪），先并入本段流式识别，避免边界丢字。
        if state["carry_audio"]:
            carried = numpy.concatenate(state["carry_audio"])
            state["carry_audio"] = []
            asr_samples = (
                numpy.concatenate([carried, asr_samples])
                if len(asr_samples)
                else carried
            )
        # 精修与实时字幕共用同一份「增益+降噪」后的音频，避免精修解码原始（更安静/更嘈杂）
        # 音频而漏字。声纹识别仍用 state["audio"] 的原始音频，保留说话人特征。
        if len(asr_samples):
            state["refine_audio"].append(asr_samples)
        # 流式 ASR 尚未加载完成：缓冲已增益+降噪的样本，加载后由后续帧统一送入，
        # 避免「准备中」期间的开头几秒音频丢字。
        if self.asr is None:
            if len(asr_samples):
                state["startup_audio"].append(asr_samples)
            return {"samples": samples_total}
        if state["startup_audio"]:
            buffered = numpy.concatenate(state["startup_audio"])
            state["startup_audio"] = []
            asr_samples = (
                numpy.concatenate([buffered, asr_samples])
                if len(asr_samples)
                else buffered
            )
        result, final = self.asr.accept(
            payload["track"],
            asr_samples,
            int(payload["sample_rate"]),
            bool(payload.get("flush")),
        )
        text = self._clean_live_text(result if isinstance(result, str) else result.text)
        if final and not text:
            text = state["last_raw_text"]
        if self.meeting_language == "auto" and not self.detected_language:
            context = numpy.concatenate(state["audio"]) if state["audio"] else samples
            detected = (
                self.language_identifier.identify(context, int(payload["sample_rate"]))
                if self.language_identifier
                and len(context) >= int(payload["sample_rate"])
                else self._detect_language(text)
            )
            if detected:
                self.detected_language = detected
                if detected == "en":
                    try:
                        self.asr = StreamingASR(
                            self.models, SETTINGS["asr"]["auto_english_model_id"], "en"
                        )
                        self.punctuation = EnglishPunctuation(
                            self.models, SETTINGS["punctuation"]["english_model_id"]
                        )
                        result, _ = self.asr.accept(
                            payload["track"],
                            numpy.concatenate(state["audio"]),
                            int(payload["sample_rate"]),
                        )
                        text = self._clean_live_text(
                            result if isinstance(result, str) else result.text
                        )
                    except RuntimeError as error:
                        self.emit(
                            "worker.warning",
                            {
                                "meeting_id": self.active,
                                "code": "auto_model_unavailable",
                                "message": str(error),
                            },
                        )
        raw_text = text
        end_ms = int(
            payload["start_ms"] + len(samples) * 1000 / int(payload["sample_rate"])
        )
        pinned = False
        # 语义软钉：无尾静音但单句已持续 live_pin_seconds 时，等到句末/逗号等语义
        # 切点再切，把「还没说完的尾巴」音频带到下一段重识别，避免从词中间硬切；
        # 超过 live_pin_max_seconds 则硬切兜底。只切分、不跨段合并，字幕原地精修。
        pin_seconds = SETTINGS["asr"].get("live_pin_seconds", 20)
        pin_max_seconds = SETTINGS["asr"].get("live_pin_max_seconds", 40)
        pin_ready = False
        if not final and pin_seconds > 0 and raw_text:
            elapsed_ms = end_ms - state["start_ms"]
            if elapsed_ms >= pin_seconds * 1000:
                state["pending_pin"] = True
            if state.get("pending_pin"):
                if elapsed_ms >= pin_max_seconds * 1000:
                    pin_ready = True
                else:
                    check_text = self._apply_live_punctuation(raw_text)
                    stripped = (check_text or "").strip()
                    # 标点模型对未说完的文本也总会补一个句末标点，先剥掉末尾「伪句末」；
                    # 只有中间还残留语义切点才切，避免把短语从中间切开。
                    if stripped and stripped[-1] in "。！？.!?":
                        stripped = stripped[:-1]
                    if any(ch in _PIN_BOUNDARY for ch in stripped):
                        pin_ready = True
        if pin_ready and not final and raw_text:
            pinned_result = self.asr.force_endpoint(payload["track"])
            pinned_raw = self._clean_live_text(
                pinned_result
                if isinstance(pinned_result, str)
                else getattr(pinned_result, "text", "")
            )
            if pinned_raw:
                # 截断到最后一个完整语义切点，并把尾部音频带到下一段重识别，边界不丢字。
                raw_text, boundary_ratio = self._sentence_boundary(pinned_raw)
                if boundary_ratio < 1.0 and state["audio"]:
                    full_raw = numpy.concatenate(state["audio"])
                    split = max(1, int(len(full_raw) * boundary_ratio))
                    state["carry_raw_audio"] = [full_raw[split:]]
                    state["audio"] = [full_raw[:split]]
                    if state["refine_audio"]:
                        full_asr = numpy.concatenate(state["refine_audio"])
                        asr_split = max(1, int(len(full_asr) * boundary_ratio))
                        state["carry_audio"] = [full_asr[asr_split:]]
                        state["refine_audio"] = [full_asr[:asr_split]]
                    state["carry_ms"] = round(
                        len(full_raw[split:]) * 1000 / int(payload["sample_rate"])
                    )
                pinned = True
                final = True
                state["pending_pin"] = False
        raw_changed = raw_text != state["last_raw_text"]
        state["last_raw_text"] = raw_text
        needs_punctuation = self.punctuation and self.asr.model.get("punctuated") is not True
        if raw_changed and needs_punctuation and self.live_punctuation and not final:
            # 异步标点：先发裸文本，标点由后台补发，避免 CT-Transformer 阻塞录音锁。
            text = raw_text
        elif raw_changed and needs_punctuation:
            text = self._apply_live_punctuation(raw_text)
        elif raw_changed:
            text = raw_text
        else:
            text = state["last_text"]
            # 异步模式下 partial 是裸文本；句末若仍无标点则补一次（final 是一次性事件，
            # 代价可忽略），避免 final 沿用了未标点的裸文本。
            if final and needs_punctuation and raw_text and text == raw_text:
                text = self._apply_live_punctuation(raw_text)
        if final and text and state["last_final_text"]:
            # Endpoint windows can re-decode their opening audio. Reuse the
            # post-processing overlap logic before persisting the next caption.
            text = self._trim_refinement_overlap(state["last_final_text"], text)
        if text and (text != state["last_text"] or final):
            state["revision"] += 1
            segment_id = f"{payload['track']}-{state['segment']}"
            speaker = "local-user" if payload["track"] == "mic" else (
                self.speaker_tracker.last_speaker
                if self.speaker_tracker and self.speaker_tracker.last_speaker
                else "spk-1"
            )
            speaker_name = None
            segment_audio = (
                numpy.concatenate(state["audio"])
                if final
                and state["audio"]
                and (self.speaker_tracker or self.live_refiner)
                else None
            )
            segment_refine_audio = (
                numpy.concatenate(state["refine_audio"])
                if final
                and state["refine_audio"]
                and self.live_refiner
                else None
            )
            # 软钉截断时，段落尾时间要扣掉被 carry 的尾巴，否则字幕时间戳与下一段重叠。
            segment_end_ms = (
                end_ms - state.get("carry_ms", 0) if pinned else end_ms
            )
            event = {
                "meeting_id": self.active,
                "segment_id": segment_id,
                "revision": state["revision"],
                "text": text,
                "start_ms": state["start_ms"],
                "end_ms": segment_end_ms,
                "speaker": speaker,
                "speaker_name": speaker_name,
                "track": payload["track"],
                "pinned": pinned,
            }
            state["last_text"] = text
            if final:
                state["last_final_text"] = text
                state["punctuation_epoch"] = state.get("punctuation_epoch", 0) + 1
                if self._is_duplicate_final(event):
                    self.emit(
                        "transcript.discarded",
                        {"meeting_id": self.active, "segment_id": event["segment_id"]},
                    )
                else:
                    self.store.save_segment(event)
                    self.emit("transcript.final", event)
                    try:
                        self.ai_note_on_segment(event)
                    except Exception:
                        # AI 辅助笔记失败绝不能影响字幕/保存主链路。
                        pass
                    self._postprocess_live_segment_later(
                        event,
                        segment_audio,
                        segment_refine_audio,
                        int(payload["sample_rate"]),
                    )
            elif not final:
                self.store.save_segment(event)
                self.emit("transcript.partial", event)
                if raw_changed and needs_punctuation and self.live_punctuation:
                    self.live_punctuation.submit(
                        self._punctuate_partial_later,
                        event.copy(),
                        raw_text,
                        state.get("punctuation_epoch", 0),
                    )
            if final:
                state.update(
                    start_ms=end_ms - state.get("carry_ms", 0),
                    revision=0,
                    segment=state["segment"] + 1,
                    last_text="",
                    last_raw_text="",
                    audio=[],
                    refine_audio=[],
                    pending_pin=False,
                    carry_ms=0,
                )
        elif final:
            state["last_final_text"] = ""
            state["punctuation_epoch"] = state.get("punctuation_epoch", 0) + 1
            state.update(
                start_ms=end_ms,
                revision=0,
                segment=state["segment"] + 1,
                last_text="",
                last_raw_text="",
                audio=[],
                pending_pin=False,
                carry_ms=0,
            )
        return {"samples": samples_total, "text": text, "final": final}

    def _postprocess_live_segment_later(self, event, samples, refine_samples, sample_rate):
        """异步更新最终段的说话人与精修文本，不阻塞音频处理。

        ``samples`` 是原始音频（用于声纹），``refine_samples`` 是增益+降噪后的音频
        （用于精修转写），二者不一致时以 refiner 是否可用为准。

        实时精修采用「有界积压」：弱 CPU 上 RefinedASR 可能慢于实时语音。若每个
        final 都压进单线程执行器且不设上限，积压会无限增长，精修字幕延迟达数分钟。
        这里限流——在飞+排队超过 ``live_refine_max_pending`` 时跳过本段实时精修
        （保留其流式原文，会后精修会再覆盖），把延迟压到有界范围内，并自动恢复。
        """
        if not (
            self.live_postprocessing
            and (self.speaker_tracker or self.live_refiner)
            and (samples is not None or refine_samples is not None)
        ):
            return
        reservation = self._live_refine_try_reserve()
        if reservation is None:
            self._warn_live_refine_degraded(event)
            self._live_refine_dropped(event.get("meeting_id"))
            return
        self.live_postprocessing.submit(
            self._refine_live_utterance_with_release,
            reservation,
            self.speaker_tracker,
            self.live_refiner,
            event.copy(),
            samples.copy() if samples is not None else None,
            refine_samples.copy() if refine_samples is not None else None,
            sample_rate,
        )

    def _live_refine_try_reserve(self):
        """占用一个精修名额；返回会话 reservation，满载时返回 ``None``。"""
        with self._live_refine_lock:
            if self._live_refine_outstanding >= self._live_refine_max:
                return None
            self._live_refine_outstanding += 1
            # 连续积压已恢复：清空掉段计数（若已进入瓶颈，交 release 发恢复事件）。
            self._live_refine_drops = 0
            return self._live_refine_generation

    def _live_refine_release(self, reservation, meeting_id=None):
        """精修完成（含异常）后归还名额，并在积压排空后发恢复事件。"""
        with self._live_refine_lock:
            if reservation != self._live_refine_generation:
                return
            self._live_refine_outstanding = max(0, self._live_refine_outstanding - 1)
            recovered = (
                self._live_perf_bottleneck
                and self._live_refine_outstanding == 0
                and self._live_refine_drops == 0
            )
            if recovered:
                self._live_perf_bottleneck = False
        if recovered and meeting_id:
            self.emit(
                "live.performance",
                {"meeting_id": meeting_id, "bottleneck": False},
            )

    def _live_refine_dropped(self, meeting_id):
        """记录一次被跳过的实时精修；连续达到阈值时发瓶颈事件。"""
        with self._live_refine_lock:
            self._live_refine_drops += 1
            trigger = self._live_refine_drops >= 3 and not self._live_perf_bottleneck
            if trigger:
                self._live_perf_bottleneck = True
        if trigger and meeting_id:
            self.emit(
                "live.performance",
                {"meeting_id": meeting_id, "bottleneck": True},
            )

    def _refine_live_utterance_with_release(
        self, reservation, tracker, refiner, event, samples, refine_samples, sample_rate
    ):
        """在限流名额内执行单段精修；无论结果如何都释放名额。"""
        meeting_id = event.get("meeting_id")
        try:
            self._refine_live_utterance(
                tracker, refiner, event, samples, refine_samples, sample_rate
            )
        finally:
            self._live_refine_release(reservation, meeting_id)

    def _warn_live_refine_degraded(self, event):
        """积压过载导致跳过实时精修时，仅首次告警，避免刷屏。"""
        with self._live_refine_lock:
            if self._live_refine_degraded_warned:
                return
            self._live_refine_degraded_warned = True
        self.emit(
            "worker.warning",
            {
                "meeting_id": event.get("meeting_id"),
                "code": "live_refinement_degraded",
                "message": (
                    "实时精修已自动降级以保持字幕实时。"
                ),
            },
        )

    def _punctuate_partial_later(self, event, raw_text, epoch):
        """在后台为 partial 补标点；若该句已 final 则丢弃（精修会补齐标点）。"""
        try:
            if not self.punctuation or self.asr.model.get("punctuated") is True:
                return
            state = self.stream_state.get(event["track"])
            if state is None or state.get("punctuation_epoch", 0) != epoch:
                return
            punctuated = self._apply_live_punctuation(raw_text)
            if not punctuated or punctuated == raw_text:
                return
            updated = {**event, "text": punctuated, "revision": event["revision"] + 1}
            if self.store.save_segment(updated):
                self.emit("transcript.partial", updated)
        except Exception as error:
            self.emit(
                "worker.warning",
                {
                    "meeting_id": event.get("meeting_id"),
                    "code": "live_punctuation_failed",
                    "message": str(error),
                },
            )

    def _refine_live_utterance(self, tracker, refiner, event, samples, refine_samples, sample_rate):
        """对单个 live final 做整段精修。

        单阶段字幕：整段用 RefinedASR 转写、用 SpeakerTracker 给一个说话人标签，
        然后原地覆盖当前段的文本，不跨段拆分/合并。
        """
        self._postprocess_live_segment(tracker, refiner, event, samples, refine_samples, sample_rate)

    def _postprocess_live_segment(self, tracker, refiner, event, samples, refine_samples, sample_rate):
        """合并异步声纹与文本结果；存储层保护用户编辑。"""
        updated = event.copy()
        if tracker and samples is not None:
            try:
                speaker, speaker_name = self._identify_speaker(
                    event["meeting_id"],
                    tracker,
                    samples,
                    sample_rate,
                )
                updated.update(speaker=speaker, speaker_name=speaker_name)
            except Exception as error:
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": event["meeting_id"],
                        "code": "live_speaker_identification_failed",
                        "message": str(error),
                    },
                )
        if refiner:
            audio = refine_samples if refine_samples is not None else samples
            if audio is None:
                return
            try:
                text = self._refine_live_audio(refiner, audio, sample_rate)
                if text:
                    updated["text"] = text
            except Exception as error:
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": event["meeting_id"],
                        "code": "live_refinement_failed",
                        "message": str(error),
                    },
                )
        if all(updated.get(key) == event.get(key) for key in ("speaker", "speaker_name", "text")):
            return
        updated["revision"] = event["revision"] + 1
        self._emit_refined_segment(updated)

    def _refine_live_audio(self, refiner, audio, sample_rate):
        """把一段音频精修为文本；超长段落切成 ≤15s 窗口逐段精修后拼接。

        funasr-nano 等精修模型的 KV 容量有限（约 20s），去掉 utterance 硬切后单条
        字幕可能长达 30~90s，直接整段解码会溢出丢字。这里按 ``refined_window_seconds``
        切窗逐段解码再拼接，避免溢出，同时保持「原地精修、不跨段」。
        """
        window_samples = int(SETTINGS["asr"]["refined_window_seconds"] * sample_rate)
        if isinstance(refiner, StreamingASR) or len(audio) <= window_samples:
            result = self._clean_live_text(refiner.decode(audio, sample_rate))
        else:
            result = ""
            context_samples = sample_rate
            for start in range(0, len(audio), window_samples):
                # 离线 ASR 在窗口首尾容易吞掉半个词；给后续窗一秒上下文，
                # 再用已有的字幕去重保留真正的新内容。
                chunk = audio[max(0, start - context_samples) : start + window_samples]
                part = self._clean_live_text(refiner.decode(chunk, sample_rate))
                if part:
                    result = self._join_utterance_text(
                        result, self._trim_refinement_overlap(result, part)
                    )
        if result and isinstance(refiner, StreamingASR) and refiner.model.get("punctuated") is not True and self.punctuation:
            result = self._clean_live_text(self.punctuation.apply(result))
        return result

    def _apply_live_punctuation(self, text):
        """保留流式模型原生标点，其他模型才走 CT-Transformer。"""
        if self.asr and self.asr.model.get("punctuated") is True:
            return text
        return self.punctuation.apply(text) if self.punctuation else text

    def _emit_refined_segment(self, updated):
        """发射精修段：原地替换当前段的文本与说话人，不跨段合并。

        实时字幕保持「流式输出 → 精修原地覆盖」：精修只更新同一条 segment 的内容。
        软钉未能切出 carry 音频时，保留末尾残句，不能在精修阶段静默删字。
        """
        if self.store.save_segment(updated):
            self.emit("transcript.refined", updated)

    def _sentence_boundary(self, raw_text):
        """返回 ``(截断后的原文, 边界比例)``。

        流式标点模型对未说完的文本也会在末尾补一个句号，所以先把末尾句号剥掉，
        找中间最后一个语义切点（句末优先、逗号兜底），把原始文本截到那里。比例用于
        把音频缓冲也按同一位置切开，把「还没说完的尾巴」带到下一段重识别。没有
        完整切点时比例返回 1.0（不截断、不 carry）。
        """
        if not raw_text or not self.punctuation:
            return raw_text, 1.0
        punctuated = self._apply_live_punctuation(raw_text)
        stripped = (punctuated or "").strip()
        if not stripped or stripped[-1] not in "。！？.!?":
            return raw_text, 1.0
        stripped = stripped[:-1]
        # 优先切在句末标点；只有当中间没有句末标点时才用逗号兜底，避免把标点模型
        # 临时补的逗号当成切点。
        last = max(
            (index for index, ch in enumerate(stripped) if ch in _SENTENCE_FINAL),
            default=-1,
        )
        if last < 0:
            last = max(
                (index for index, ch in enumerate(stripped) if ch in "，,；;"),
                default=-1,
            )
        if last < 0:
            return raw_text, 1.0
        punctuation = set("，。！？、；：,.!?;:…'\"「」（）() \t")
        content_count = sum(1 for ch in stripped[: last + 1] if ch not in punctuation)
        total_chars = sum(1 for ch in raw_text if ch not in " \t")
        ratio = min(1.0, content_count / total_chars) if total_chars else 1.0
        truncated = raw_text[:content_count].rstrip("，。！？、；：,.!?;: ")
        return (truncated if truncated else raw_text), ratio

    def _identify_speaker(self, meeting_id, tracker, samples, sample_rate):
        """优先匹配声纹库，未命中时分配会议内临时说话人。

        去掉 utterance 硬切后单条字幕可能包含多个说话人（连续/抢话场景），整段声纹
        会是多人的混合，容易把不同人聚到一起。这里取段落前 15s 的声纹（更可能还是
        同一说话人），提升聚类稳定性。
        """
        window = sample_rate * 15
        if len(samples) > window:
            samples = samples[:window]
        embedding = tracker.embedding(samples, sample_rate)
        if embedding is None:
            return tracker.last_speaker or "spk-1", None
        profile = self.store.match_speaker_profile(
            embedding, SETTINGS["diarization"]["voiceprint_similarity_threshold"]
        )
        if profile:
            speaker_id = f"profile-{profile['id']}"
            self.store.rename_speaker(
                meeting_id, speaker_id, profile["name"], profile_id=profile["id"]
            )
            return speaker_id, profile["name"]
        return tracker.assign_embedding(embedding), None

    @synchronized_recording
    def stop(self, payload):
        """flush 所有识别流、合成播放文件并结束活动会议。

        Returns:
            状态为 ``ready`` 的会议详情。
        """
        require(payload, "meeting_id", "duration_ms")
        self._active(payload["meeting_id"])
        meeting_id = self.active
        try:
            if self.asr:
                for track in (("mix",) if self.live_tracks == {"mic", "system"} else ("mic", "system")):
                    self.audio(
                        {
                            "meeting_id": meeting_id,
                            "track": track,
                            "pcm": "",
                            "sample_rate": 16000,
                            "start_ms": int(payload["duration_ms"]),
                            "flush": True,
                        }
                    )
        finally:
            self._release_active_session()
        meeting = self.store.finish_meeting(meeting_id, payload["duration_ms"])
        meeting = self.store.get_meeting(meeting["id"])
        self.emit("meeting.stopped", {"meeting_id": meeting_id, "meeting": meeting})
        return meeting

    def _release_active_session(self):
        """在持久化停止状态前释放模型和执行器资源。

        精修/标点执行器用 ``wait=False`` 关闭：结束会议不应干等排队的精修跑完
        （弱 CPU 上可能拖到数分钟）。在飞任务保留流式原文，会议结束后由
        ``meeting.refine`` 统一完整精修。
        """
        meeting_id = self.active
        if meeting_id and hasattr(self, "ai_note_stop"):
            self.ai_note_stop({"meeting_id": meeting_id})
        postprocessing = self.live_postprocessing
        punctuation = self.live_punctuation
        self.live_postprocessing = None
        self.live_punctuation = None
        with self._live_refine_lock:
            self._live_refine_generation += 1
            self._live_refine_outstanding = 0
            self._live_refine_degraded_warned = False
            self._live_refine_drops = 0
            self._live_perf_bottleneck = False
        if postprocessing:
            postprocessing.shutdown(wait=False, cancel_futures=True)
        if punctuation:
            punctuation.shutdown(wait=False, cancel_futures=True)
        # 远程精修器需要显式回收其子进程。
        if isinstance(self.live_refiner, RemoteRefiner):
            self.live_refiner.shutdown()
        (
            self.active,
            self.asr,
            self.punctuation,
            self.denoiser,
            self.language_identifier,
        ) = None, None, None, None, None
        self.speaker_tracker, self.stream_state, self.recent_finals = None, {}, []
        self.live_tracks, self.live_mix_buffers = set(), {"mic": deque(), "system": deque()}
        self.meeting_language, self.detected_language = None, None
        self.live_refiner = None
        self.power_saving = False

    def _active(self, meeting_id):
        """确认命令指向当前活动会议，无返回值。"""
        self.state.require(meeting_id)
