"""聚焦的 worker 职责组件。"""

import base64
import os
import re
import sys
import threading
from array import array
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from difflib import SequenceMatcher
from pathlib import Path

from .asr import (
    DEFAULT_REFINED_MODEL_ID,
    ChinesePunctuation,
    EnglishPunctuation,
    LanguageIdentifier,
    LiveDenoiser,
    RefinedASR,
    StreamingASR,
)
from .audio_io import convert_to_pcm_wav
from .config import SETTINGS
from .refine_sidecar import RemoteRefiner
from .worker_llm import TRANSLATION_MODEL_ID
from .worker_common import require, synchronized_recording

# 语义软钉可接受的切点：句末标点优先，逗号/分号作为次优切点（连续语音里标点模型
# 常把句号降级成逗号，若只认句号会一直等、最后从词中间硬切）。
_SENTENCE_FINAL = "。！？.!?；;"

# 比较流式重解与原文时去掉的标点/空白字符（用于判断重解是否丢了句尾）。
_NORMALIZE_TABLE = str.maketrans("", "", " \t\r\n，。！？、；：,.!?;:…'\"「」（）()")

# 实时双轨混音缓冲的时间跨度上限（毫秒）。单轨停帧时另一轨缓冲会无限增长，这里
# 限制跨度，超出即丢弃最旧帧，避免内存增长与恢复后的一次性爆量对齐。
MAX_MIX_BUFFER_MS = 5000

# ``_mix_live_audio`` 的标记值：单轨已停流超过 MAX_MIX_BUFFER_MS，应回退为该轨
# 独立转写（而非继续空等导致整场 live 字幕空白）。
_MIX_STALL = object()


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
        self._prepare_active(
            meeting,
            audio_tracks=payload.get("audio_tracks"),
            auto_source=bool(payload.get("auto_source")),
        )
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

    def _prepare_active(self, meeting, start_ms=0, audio_tracks=None, auto_source=False):
        """建立活动会议的双轨识别状态；模型不可用时仍允许安全录音。"""
        self.active = meeting["id"]
        self.meeting_language = meeting["language"]
        self.detected_language = None
        self.power_saving = bool(meeting.get("power_saving"))
        self.auto_source = bool(auto_source)
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
                "carry_text": "",
                "carry_ms": 0,
            }
            for track in ("mic", "system", "mix")
        }
        self.live_tracks = set(audio_tracks or ())
        self.live_mix_buffers = {"mic": deque(), "system": deque()}
        self.recent_finals = []
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
        self.denoiser = None
        self.speaker_tracker = None

        # 各加载闭包在工作线程中运行，绝不能访问 self.active——它是受 state.lock 保护
        # 的属性，而本方法已在该锁内运行，跨线程再次获取会死锁。改用本地会议 ID。
        meeting_id = meeting["id"]

        # sherpa-onnx 模型初始化会进入原生运行时；按序加载避免不同模型的原生
        # 初始化相互竞争导致 worker 直接退出。构建闭包返回模型，由调用方决定
        # 何时/在哪个线程做赋值。
        def build_denoiser():
            if (
                not self.power_saving
                and SETTINGS["live_asr"].get("denoiser_enabled", 1)
                and self.models.is_ready(denoiser_id)
            ):
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
            # 流式模型已内置标点（如 X-ASR）时，CT-Transformer 不会被用到，跳过加载，
            # 省约 75MB 内存与加载时间，也避免弱机上多一份推理算力。
            if self._streaming_is_punctuated(meeting["streaming_model_id"]):
                return None
            return self._build_live_punctuation(meeting["language"], meeting_id)

        def build_live_refiner(streaming_asr=None):
            model_id, streaming = self._live_refiner_choice(
                meeting["streaming_model_id"],
                meeting["refined_model_id"],
                meeting["language"],
                self.power_saving,
            )
            if not self.models.is_ready(model_id):
                return None
            if streaming:
                return streaming_asr
            try:
                return self._create_live_refiner(
                    model_id,
                    language=meeting.get("language"),
                    streaming=streaming,
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

        # 流式 ASR、降噪、标点是实时字幕的关键路径且加载快：同步加载。
        # 说话人分离只在会后精修执行；逐段在线聚类会把同一人裂成大量临时标签，
        # 也会与实时精修争用 CPU。语言识别（whisper-large-v3）
        # 与实时精修模型较重，在后台按序加载，避免原生初始化竞争，同时显著缩短
        # 「准备中」等待；加载完成前语言回退到文本启发式，精修回退到流式文本。
        # 只同步加载「快」模型（降噪/标点）；流式 ASR（zipformer 等大模型
        # 加载需数秒）与语言识别、精修模型一起放到后台加载。start() 因此能立刻
        # 返回进入录制界面，加载完成前音频会被缓冲，不丢字。
        self.denoiser = build_denoiser()
        self.punctuation = build_punctuation()
        # 标点补发与精修各用一个单线程执行器：精修（RefinedASR）较慢，若与标点
        # 共用执行器会把快速的部分标点堵在队列里，导致字幕卡顿。
        if self.punctuation:
            self.live_punctuation = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="brevia-live-punctuation"
            )

        def load_remaining():
            asr = build_asr()
            language_identifier = build_language_identifier()
            live_refiner = build_live_refiner(asr)
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

    def _streaming_is_punctuated(self, model_id):
        """流式模型是否自带标点（无需再加载 CT-Transformer / 二阶段重解）。"""
        try:
            return bool(self.models.get(model_id).get("punctuated"))
        except ValueError:
            return False

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

    def _live_refiner_choice(
        self, streaming_model_id, refined_model_id, language, power_saving
    ):
        """统一选择实时二阶段模型；不支持当前语言时回退到流式模型。"""
        if power_saving:
            return streaming_model_id, True
        refined = self.models.get(refined_model_id)
        if (
            (language == "auto" or language in refined.get("languages", []))
            and self.models.is_ready(refined_model_id)
        ):
            return refined_model_id, False
        compatible = next(
            (
                model["id"]
                for model in self.models.catalog.values()
                if "refined" in model.get("stages", [])
                and language in model.get("languages", [])
                and self.models.is_ready(model["id"])
            ),
            None,
        )
        return (compatible, False) if compatible else (streaming_model_id, True)

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

        # 先校验实际会加载的模型；配置中的精修模型不支持当前语言时，校验兼容替代。
        live_refiner_model_id, live_refiner_streaming = self._live_refiner_choice(
            streaming_model_id, refined_model_id, language, power_saving
        )
        required_models = (streaming_model_id,)
        if live_refiner_model_id != streaming_model_id:
            required_models += (live_refiner_model_id,)
        if target_language:
            required_models += (TRANSLATION_MODEL_ID,)
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
                new_refiner = (
                    new_asr
                    if live_refiner_streaming
                    else self._create_live_refiner(
                        live_refiner_model_id, language=language
                    )
                )
        else:
            if power_saving_changed:
                denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
                new_denoiser = (
                    LiveDenoiser(self.models, denoiser_id)
                    if self.models.is_ready(denoiser_id)
                    and SETTINGS["live_asr"].get("denoiser_enabled", 1)
                    else None
                )
            if power_saving_changed or streaming_changed or language_changed:
                new_refiner = (
                    new_asr
                    if live_refiner_streaming
                    else self._create_live_refiner(
                        live_refiner_model_id, language=language
                    )
                )
            if new_refiner is not None and new_postprocessing is None:
                new_postprocessing = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="brevia-live-postprocess"
                )

        new_punctuation = self.punctuation
        new_punctuation_executor = self.live_punctuation
        new_language_identifier = self.language_identifier
        if language_changed:
            new_punctuation = (
                None
                if self._streaming_is_punctuated(streaming_model_id)
                else self._build_live_punctuation(language, self.active)
            )
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

    def _should_bypass_denoise(self, samples):
        """偏弱/远端人声跳过实时降噪，避免 GTCRN 把人声当噪声整体压掉。

        落盘录音保留原始人声，而实时 ASR 只消费「增益+降噪」后的信号。线下会议室里
        说话人离麦克风较远、信号偏弱时，GTCRN 这类面向近讲场景的降噪器更容易把这段
        带房间混响的人声当作噪声一起衰减，结果就是「录音有声、实时字幕空白」。此时
        跳过降噪，把已增益的原始信号直接交给 ASR，反而更稳。

        用与增益一致的 RMS 度量，并把阈值取在实时增益目标（``microphone_target_rms``）
        的下方：正常说话（增益后被抬到目标附近）仍走降噪，只有确实偏弱的片段才旁路。
        """
        if not len(samples):
            return True
        rms = (
            sum(float(sample) * float(sample) for sample in samples) / len(samples)
        ) ** 0.5
        return rms < SETTINGS["live_asr"].get("denoise_minimum_rms", 0.03)

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
    def set_audio_source(self, payload):
        """由前端设置当前应采集/转写的活跃音轨。

        自动音源的门控（待命/激活）由前端在采集层完成，后端不再依据固定 RMS 丢帧；
        前端在音轨激活状态变化时调用本方法，后端据此切换双轨混音/单轨转写，并广播
        决定供 UI 展示。
        """
        require(payload, "meeting_id", "active")
        self._active(payload["meeting_id"])
        active = set(payload["active"]) & {"mic", "system"}
        removed = self.live_tracks - active
        added = active - self.live_tracks
        if removed:
            for track in removed:
                self.live_mix_buffers[track].clear()
        self.live_tracks = active
        if removed or added:
            self.emit(
                "audio_source.auto",
                {
                    "meeting_id": self.active,
                    "active": sorted(self.live_tracks),
                    "muted": sorted({"mic", "system"} - self.live_tracks),
                },
            )
        return {"active": sorted(self.live_tracks)}

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
        values = array("h")
        values.frombytes(pcm)
        if sys.byteorder != "little":
            values.byteswap()
        import numpy

        samples = numpy.asarray(values, dtype=numpy.float32) / 32768.0
        samples_total = 0 if source_track == "mix" else self.store.append_audio(
            self.active,
            source_track,
            pcm,
            int(payload["sample_rate"]),
            int(payload["start_ms"]),
        )
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
            # 偏弱/远端人声直接跳过降噪，避免 GTCRN 把人声当噪声压掉导致「录音有声、
            # 实时无字幕」（见 ``_should_bypass_denoise``）。
            if not self._should_bypass_denoise(asr_samples):
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
        if state["carry_text"] and text:
            text = self._merge_carry_text(state["carry_text"], text)
        if final and not text:
            text = state["last_raw_text"] or state["carry_text"]
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
        next_carry_text = ""
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
                    # 分档切点：句末标点（。！？；等）优先；逗号只在接近硬切上限时才
                    # 作为兜底切点。否则刚过 live_pin_seconds 就命中一个句中逗号，
                    # 把还没说完的句子从中间截断，造成「语义软钉分得不够好」。
                    if any(ch in _SENTENCE_FINAL for ch in stripped):
                        pin_ready = True
                    else:
                        comma_ready_ms = (
                            pin_seconds + (pin_max_seconds - pin_seconds) * 0.5
                        ) * 1000
                        if elapsed_ms >= comma_ready_ms and any(
                            ch in "，," for ch in stripped
                        ):
                            pin_ready = True
                if pin_ready and elapsed_ms < pin_max_seconds * 1000:
                    # 边界后的 carry 先积累足够声学上下文，再重启流式解码；
                    # 否则「那么理由呢」这类短语容易在新流开头被吞掉。
                    _, boundary_ratio = self._sentence_boundary(raw_text)
                    tail_ms = elapsed_ms * (1 - boundary_ratio)
                    minimum_tail_ms = (
                        SETTINGS["diarization"]["boundary_tail_seconds"] * 1000
                    )
                    if 0 < tail_ms < minimum_tail_ms:
                        pin_ready = False
        if pin_ready and not final and raw_text:
            pinned_result = self.asr.force_endpoint(payload["track"])
            pinned_raw = self._clean_live_text(
                pinned_result
                if isinstance(pinned_result, str)
                else getattr(pinned_result, "text", "")
            )
            # ``force_endpoint`` 已重置识别流；某些模型会在此返回空结果，必须保留
            # 当前 partial，否则这段已识别文本会随流状态一起丢失。
            pinned_raw = pinned_raw or raw_text or state["last_raw_text"] or state["carry_text"]
            if pinned_raw:
                if state["carry_text"]:
                    pinned_raw = self._merge_carry_text(state["carry_text"], pinned_raw)
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
                    next_carry_text = pinned_raw[len(raw_text) :].lstrip(
                        " \t,。.;:!?，；：！？"
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
        previous_final_text = state["last_final_text"] if final else ""
        if final and text and previous_final_text:
            # Endpoint windows can re-decode their opening audio. Reuse the
            # post-processing overlap logic before persisting the next caption.
            text = self._trim_refinement_overlap(previous_final_text, text)
        if text and (text != state["last_text"] or final):
            state["revision"] += 1
            segment_id = f"{payload['track']}-{state['segment']}"
            speaker = "local-user" if payload["track"] == "mic" else "spk-1"
            speaker_name = None
            segment_audio = (
                numpy.concatenate(state["audio"])
                if final
                and state["audio"]
                and self.live_refiner
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
                        {
                            **event,
                            "_previous_final_text": previous_final_text,
                            "_carry_in_text": state["carry_text"],
                            "_carry_out_text": next_carry_text,
                        },
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
                    carry_text=next_carry_text,
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
                carry_text="",
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
            and self.live_refiner
            and (samples is not None or refine_samples is not None)
        ):
            self.emit("transcript.settled", event)
            return
        reservation = self._live_refine_try_reserve()
        if reservation is None:
            self._warn_live_refine_degraded(event)
            self._live_refine_dropped(event.get("meeting_id"))
            self.emit("transcript.settled", event)
            return
        self.live_postprocessing.submit(
            self._refine_live_utterance_with_release,
            reservation,
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
        self, reservation, refiner, event, samples, refine_samples, sample_rate
    ):
        """在限流名额内执行单段精修；无论结果如何都释放名额。"""
        meeting_id = event.get("meeting_id")
        settled = event
        try:
            settled = self._refine_live_utterance(
                refiner, event, samples, refine_samples, sample_rate
            )
        finally:
            self.emit("transcript.settled", settled)
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

    def _refine_live_utterance(self, refiner, event, samples, refine_samples, sample_rate):
        """对单个 live final 做整段精修。

        单阶段字幕：整段用 RefinedASR 转写，然后原地覆盖当前段的文本，
        不跨段拆分/合并。
        """
        return self._postprocess_live_segment(refiner, event, samples, refine_samples, sample_rate)

    def _postprocess_live_segment(self, refiner, event, samples, refine_samples, sample_rate):
        """合并异步文本精修结果；存储层保护用户编辑。

        实时说话人识别已移至会后精修，此处只负责文本精修。
        """
        updated = event.copy()
        previous_final_text = updated.pop("_previous_final_text", "")
        carry_in_text = updated.pop("_carry_in_text", "")
        carry_out_text = updated.pop("_carry_out_text", "")
        if refiner:
            audio = refine_samples if refine_samples is not None else samples
            if audio is None:
                return event
            try:
                text = self._refine_live_audio(
                    refiner, audio, sample_rate, original_text=event.get("text", "")
                )
                if text:
                    text = self._restore_missing_head(text, event.get("text", ""))
                    if carry_in_text:
                        carry_norm = self._normalized_transcript(carry_in_text)
                        refined_norm = self._normalized_transcript(text)
                        opening = SequenceMatcher(
                            None, carry_norm, refined_norm
                        ).find_longest_match()
                        # 精修包含 carry 开头时直接信任精修；否则补回开头。
                        if (
                            (opening.a != 0 or opening.size < 4)
                            and SequenceMatcher(None, carry_norm, refined_norm).ratio()
                            < 0.5
                        ):
                            text = self._merge_carry_text(carry_in_text, text)
                    text = self._trim_refined_extension(text, event.get("text", ""))
                    if carry_out_text:
                        text = self._trim_carry_prefix(text, carry_out_text)
                    if previous_final_text:
                        text = self._trim_refinement_overlap(previous_final_text, text)
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
            return event
        updated["revision"] = event["revision"] + 1
        return self._emit_refined_segment(updated) or event

    def _refine_live_audio(self, refiner, audio, sample_rate, original_text=""):
        """把一段音频精修为文本；超长段落切成 ≤15s 窗口逐段精修后拼接。

        funasr-nano 等精修模型的 KV 容量有限（约 20s），去掉 utterance 硬切后单条
        字幕可能长达 30~90s，直接整段解码会溢出丢字。这里按 ``refined_window_seconds``
        切窗逐段解码再拼接，避免溢出，同时保持「原地精修、不跨段」。

        ``original_text`` 是流式第一阶段的原文。效率模式用同一流式模型做第二阶段
        重解，输入是软钉边界处切掉尾巴的音频（末尾无静音），transducer 最后一个
        partial 可能未 commit 而被丢弃，造成「句尾内容消失」；重解明显短于原文时
        回退到原文，保住句尾。
        """
        window_samples = int(SETTINGS["asr"]["refined_window_seconds"] * sample_rate)
        if isinstance(refiner, StreamingASR) or len(audio) <= window_samples:
            result = self._clean_live_text(refiner.decode(audio, sample_rate))
            if result and original_text:
                result = self._preserve_streaming_tail(result, original_text)
                if isinstance(refiner, StreamingASR):
                    original_words = re.findall(r"\w+", original_text.casefold())
                    refined_words = re.findall(r"\w+", result.casefold())
                    width = len(original_words)
                    contains_original = any(
                        refined_words[index : index + width] == original_words
                        for index in range(len(refined_words) - width + 1)
                    )
                    if not contains_original:
                        result = original_text
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

    @staticmethod
    def _preserve_streaming_tail(refined, original):
        """流式重解若丢掉未说完的句尾，则回退到原文。

        判断标准：重解结果以句末标点收尾则视为语义完整，直接采用；否则把重解与原文
        去掉标点/空白后比较，若重解是原文的严格前缀且更短，说明句尾在重解时丢失，
        用含句尾的原文覆盖，避免「句尾内容消失」。
        """
        if not refined or not original:
            return refined
        refined_norm = (refined or "").translate(_NORMALIZE_TABLE)
        original_norm = (original or "").translate(_NORMALIZE_TABLE)
        if len(refined_norm) < len(original_norm) and original_norm.startswith(refined_norm):
            return original
        return refined

    def _apply_live_punctuation(self, text):
        """保留流式模型原生标点，其他模型才走 CT-Transformer。"""
        if self.asr and self.asr.model.get("punctuated") is True:
            return text
        result = self.punctuation.apply(text) if self.punctuation else text
        result = self._restore_missing_tail(result, text)
        # CT-Transformer 对短/未说完文本偶发在句首补出标点，去掉句首标点。
        return result.lstrip("，。！？、；：,.!?;:… ") if result else result

    def _restore_missing_tail(self, transformed, original):
        """标点模型若只吞掉原文尾部，保留标点结果并补回缺失内容。"""
        transformed_norm = (transformed or "").translate(_NORMALIZE_TABLE).casefold()
        original_norm = (original or "").translate(_NORMALIZE_TABLE).casefold()
        if not transformed_norm or not original_norm.startswith(transformed_norm):
            return transformed
        if len(transformed_norm) >= len(original_norm):
            return transformed
        count = 0
        for index, char in enumerate(original):
            if char.translate(_NORMALIZE_TABLE):
                count += 1
                if count == len(transformed_norm):
                    suffix = original[index + 1 :].lstrip(" \t,。.;:!?，；：！？")
                    return self._join_utterance_text(
                        transformed.rstrip(" 	。.!?；;！？"), suffix
                    )
        return transformed

    def _restore_missing_head(self, transformed, original):
        """精修若从原文中段开始，补回被吞掉的段首。"""
        transformed_norm = self._normalized_transcript(transformed)
        original_norm = self._normalized_transcript(original)
        match = SequenceMatcher(None, original_norm, transformed_norm).find_longest_match()
        if match.b != 0 or match.a == 0 or match.size < 4:
            return transformed
        count = 0
        for index, char in enumerate(original):
            if char.translate(_NORMALIZE_TABLE):
                if count == match.a:
                    return self._join_utterance_text(original[:index].rstrip(), transformed)
                count += 1
        return transformed

    def _emit_refined_segment(self, updated):
        """发射精修段：原地替换当前段的文本与说话人，不跨段合并。

        实时字幕保持「流式输出 → 精修原地覆盖」：精修只更新同一条 segment 的内容。
        软钉未能切出 carry 音频时，保留末尾残句，不能在精修阶段静默删字。
        """
        if self.store.save_segment(updated):
            self.emit("transcript.refined", updated)
            return updated
        return None

    def _sentence_boundary(self, raw_text):
        """返回 ``(截断后的原文, 边界比例)``。

        流式标点模型对未说完的文本也会在末尾补一个句号，所以先把末尾句号剥掉，
        找中间最后一个语义切点（句末优先、逗号兜底），把原始文本截到那里。比例用于
        把音频缓冲也按同一位置切开，把「还没说完的尾巴」带到下一段重识别。没有
        完整切点时比例返回 1.0（不截断、不 carry）。
        """
        if not raw_text:
            return raw_text, 1.0
        # 语义切点依赖标点：内置标点模型（X-ASR）自带标点，未加载 CT-Transformer
        # 也可切；其余模型必须已加载标点模型才切。
        if not self.punctuation and not (self.asr and self.asr.model.get("punctuated")):
            return raw_text, 1.0
        punctuated = self._apply_live_punctuation(raw_text)
        stripped = (punctuated or "").strip()
        if not stripped:
            return raw_text, 1.0
        # 末尾的句末/逗号通常是「伪句末」（标点模型对未说完的文本也会补一个），剥掉后
        # 在剩余文本里找最后一个真实切点。若末尾本就是残句（无标点），直接在整个文本
        # 里找——软钉应始终切在中间的语义边界、把未说完的尾巴带到下一段，而不是只在
        # 末尾恰好带标点时才切，否则「不是马爷」这类残句会留在本段，下一段从半句开始。
        search = stripped
        if search[-1] in "。！？.!?；;，,":
            search = search[:-1]
        # 优先切在句末标点；只有当中间没有句末标点时才用逗号兜底，避免把标点模型
        # 临时补的逗号当成切点。
        last = max(
            (index for index, ch in enumerate(search) if ch in _SENTENCE_FINAL),
            default=-1,
        )
        if last < 0:
            last = max(
                (index for index, ch in enumerate(search) if ch in "，,；;"),
                default=-1,
            )
        if last < 0:
            return raw_text, 1.0
        punctuation = set("，。！？、；：,.!?;:…'\"「」（）() \t")
        total_chars = sum(1 for ch in raw_text if ch not in " \t")
        if punctuated == raw_text:
            # 内置标点模型（如 X-ASR）：punctuated 就是 raw。ratio 用「非空白字符数」
            # 而非 raw 下标（raw 里标点后常跟空格，raw 下标会虚高），否则音频按比例
            # 切过头、把下一句开头一并截掉。文本截断仍按 raw 下标 raw_text[:last]。
            cut = sum(1 for ch in raw_text[:last] if ch not in " \t")
            ratio = min(1.0, cut / total_chars) if total_chars else 1.0
            truncated = raw_text[:last].rstrip("，。！？、；：,.!?;: ")
        else:
            # 标点模型增补标点（CT-Transformer）：punctuated 比 raw 多了标点字符，
            # 需要按内容字符数映射回 raw，才能对齐音频比例与截断位置。
            content_count = sum(1 for ch in search[: last + 1] if ch not in punctuation)
            ratio = min(1.0, content_count / total_chars) if total_chars else 1.0
            raw_cut = 0
            seen = 0
            for raw_cut, ch in enumerate(raw_text, 1):
                if ch not in punctuation:
                    seen += 1
                    if seen == content_count:
                        break
            truncated = raw_text[:raw_cut].rstrip("，。！？、；：,.!?;: ")
        return (truncated if truncated else raw_text), ratio

    def _merge_carry_text(self, carry, text):
        """保留已识别的 carry 开头，移除新流对同一段音频的重复识别。"""
        carry_norm = self._normalized_transcript(carry)
        text_norm = self._normalized_transcript(text)
        minimum_overlap = 2 if carry.rstrip()[-1:].isascii() else 4
        overlap = next(
            (
                (length, text_norm.find(carry_norm[-length:]))
                for length in range(
                    min(len(carry_norm), len(text_norm)), minimum_overlap - 1, -1
                )
                if carry_norm[-length:] in text_norm
            ),
            None,
        )
        if overlap is None:
            return self._join_utterance_text(carry, text)
        length, offset = overlap
        count = 0
        for index, char in enumerate(text):
            if char.isalnum():
                count += 1
                if count == offset + length:
                    rest = text[index + 1 :]
                    if rest and rest[0].isalnum():
                        return carry + rest
                    return self._join_utterance_text(
                        carry, rest.lstrip(" \t,。.;:!?，；：！？")
                    )
        return carry

    def _trim_carry_prefix(self, text, carry):
        """移除精修跨过软钉边界多识别的下一段开头。"""
        text_norm = self._normalized_transcript(text)
        carry_norm = self._normalized_transcript(carry)
        for length in range(min(len(text_norm), len(carry_norm)), 1, -1):
            if not text_norm.endswith(carry_norm[:length]):
                continue
            count = 0
            for index in range(len(text) - 1, -1, -1):
                if text[index].isalnum():
                    count += 1
                    if count == length:
                        return text[:index].rstrip(" \t,。.;:!?，；：！？")
        return text

    def _trim_refined_extension(self, refined, original):
        """精修若在原始段落的完整尾部之后继续输出，移除越界文本。"""
        refined_norm = self._normalized_transcript(refined)
        original_norm = self._normalized_transcript(original)
        for length in range(min(len(refined_norm), len(original_norm)), 3, -1):
            suffix = original_norm[-length:]
            offset = refined_norm.rfind(suffix)
            if offset < 0:
                continue
            if offset + length == len(refined_norm):
                return refined
            count = 0
            for index, char in enumerate(refined):
                if char.isalnum():
                    count += 1
                    if count == offset + length:
                        return refined[: index + 1].rstrip(" \t,。.;:!?，；：！？")
        return refined

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
        self.auto_source = False
        self.meeting_language, self.detected_language = None, None
        self.live_refiner = None
        self.power_saving = False

    def _active(self, meeting_id):
        """确认命令指向当前活动会议，无返回值。"""
        self.state.require(meeting_id)
