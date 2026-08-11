"""聚焦的 worker 职责组件。"""

import sys
from array import array
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .asr import (
    ChinesePunctuation,
    EnglishPunctuation,
    LanguageIdentifier,
    LiveDenoiser,
    RefinedASR,
    SpeakerTracker,
    StreamingASR,
)
from .audio_io import convert_to_pcm_wav
from .config import SETTINGS
from .worker_llm import TRANSLATION_MODEL_ID
from .worker_common import require, synchronized_recording


class RecordingSessionMixin:
    @synchronized_recording
    def start(self, payload):
        """创建会议并启动流式识别。

        Args:
            payload: 标题、语言及实时/精修模型 ID，可附带分类和标签。

        Returns:
            新会议详情；同时发布 ``meeting.started``。
        """
        require(payload, "title", "language", "streaming_model_id", "refined_model_id")
        if self.active:
            raise ValueError("A meeting is already active")
        required_models = [
            payload.get(key)
            for key in (
                "streaming_model_id",
                "refined_model_id",
                "speaker_segmentation_model_id",
                "speaker_embedding_model_id",
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
        self._prepare_active(meeting)
        self.emit("meeting.started", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def import_audio(self, payload):
        """导入录音，统一转为本地 16 kHz 单声道 WAV 后创建可精修会议。"""
        require(
            payload,
            "title",
            "language",
            "streaming_model_id",
            "refined_model_id",
            "path",
        )
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
        manifest = self.store.read_manifest(meeting["id"])
        start_ms = max(
            (
                round(track.get("samples", 0) * 1000 / track.get("sample_rate", 16000))
                for track in manifest.get("tracks", {}).values()
            ),
            default=0,
        )
        self._prepare_active(meeting, start_ms)
        self.emit("meeting.recovered", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def _prepare_active(self, meeting, start_ms=0):
        """建立活动会议的双轨识别状态；模型不可用时仍允许安全录音。"""
        self.active = meeting["id"]
        self.meeting_language = meeting["language"]
        self.detected_language = None
        self.stream_state = {
            track: {
                "start_ms": start_ms,
                "revision": 0,
                "segment": start_ms,
                "last_text": "",
                "audio": [],
            }
            for track in ("mic", "system")
        }
        self.recent_finals = []
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
        self.denoiser = None

        # 各加载闭包在工作线程中运行，绝不能访问 self.active——它是受 state.lock 保护
        # 的属性，而本方法已在该锁内运行，跨线程再次获取会死锁。改用本地会议 ID。
        meeting_id = meeting["id"]

        # 每个模型加载彼此独立，且 sherpa-onnx 的原生初始化会释放 GIL，因此并行
        # 加载可把「准备中」墙钟时间从各模型耗时之和降到最慢的一个（通常是精修用
        # 的 Qwen3-ASR）。此方法始终在录音状态锁内单线程进入，各闭包只写各自的
        # self 属性，emit 也已加锁，故并行不改变加载后的任何运行时行为。
        def load_denoiser():
            if self.models.is_ready(denoiser_id):
                try:
                    self.denoiser = LiveDenoiser(self.models, denoiser_id)
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": meeting_id,
                            "code": "denoiser_unavailable",
                            "message": str(error),
                        },
                    )

        def load_language_identifier():
            if meeting["language"] == "auto" and self.models.is_ready("whisper-large-v3"):
                try:
                    self.language_identifier = LanguageIdentifier(self.models)
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": meeting_id,
                            "code": "language_identifier_unavailable",
                            "message": str(error),
                        },
                    )

        def load_asr():
            try:
                self.asr = StreamingASR(
                    self.models, meeting["streaming_model_id"], meeting["language"]
                )
            except RuntimeError as error:
                self.asr = None
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": meeting_id,
                        "code": "asr_unavailable",
                        "message": str(error),
                    },
                )

        def load_punctuation():
            self.punctuation = self._build_live_punctuation(
                meeting["language"], meeting_id
            )

        def load_speaker_tracker():
            try:
                self.speaker_tracker = SpeakerTracker(
                    self.models,
                    max_speakers=meeting.get("num_speakers"),
                    model_id=meeting.get("speaker_embedding_model_id"),
                )
            except RuntimeError as error:
                self.speaker_tracker = None
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": meeting_id,
                        "code": "speaker_unavailable",
                        "message": str(error),
                    },
                )

        def load_live_refiner():
            if self.models.is_ready(meeting["refined_model_id"]):
                try:
                    self.live_refiner = RefinedASR(
                        self.models, meeting["refined_model_id"]
                    )
                    self.live_refinement = ThreadPoolExecutor(
                        max_workers=1, thread_name_prefix="brevia-live-refine"
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

        loaders = (
            load_denoiser,
            load_language_identifier,
            load_asr,
            load_punctuation,
            load_speaker_tracker,
            load_live_refiner,
        )
        with ThreadPoolExecutor(max_workers=len(loaders)) as pool:
            for future in [pool.submit(loader) for loader in loaders]:
                # 复现串行版本的语义：非 RuntimeError 的意外异常仍向上冒泡。
                future.result()

    @synchronized_recording
    def pause(self, payload):
        """确认目标是当前会议并广播暂停状态；音频停送由前端负责。"""
        require(payload, "meeting_id", "paused")
        self._active(payload["meeting_id"])
        self.emit(
            "meeting.paused",
            {"meeting_id": self.active, "paused": bool(payload["paused"])},
        )
        return {"paused": bool(payload["paused"])}

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
        """会中热切换语言与实时/精修模型，对当前录音立即生效。

        仅重建受影响的组件：改语言会同时重建实时识别与标点；改实时模型只重建识别；
        改精修模型只替换后续实时精修所用的模型。新模型先构建到局部变量，全部成功后
        再原子替换，任一步骤失败都不会破坏正在运行的识别流。缺失模型会以 ``not
        installed`` 抛出，交由上层触发下载流程。

        Args:
            payload: ``meeting_id`` 必填；``language``、``streaming_model_id``、
                ``refined_model_id``、``target_language`` 至少提供一项。

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
        refined_model_id = (
            payload.get("refined_model_id") or meeting["refined_model_id"]
        )
        target_language = (
            payload.get("target_language")
            if "target_language" in payload
            else meeting["target_language"]
        )
        language_changed = language != meeting["language"]
        streaming_changed = streaming_model_id != meeting["streaming_model_id"]
        refined_changed = refined_model_id != meeting["refined_model_id"]
        target_language_changed = target_language != meeting["target_language"]
        if not (language_changed or streaming_changed or refined_changed or target_language_changed):
            return meeting

        # 先校验所有目标模型已安装，缺失即抛错（不做任何替换），让上层弹出下载。
        missing = [
            model_id
            for model_id in (streaming_model_id, refined_model_id)
            if not self.models.is_ready(model_id)
        ]
        if missing:
            label = "Model" if len(missing) == 1 else "Models"
            verb = "is" if len(missing) == 1 else "are"
            raise RuntimeError(f"{label} {', '.join(missing)} {verb} not installed")

        # 全部构建到局部变量，成功后再原子替换。
        new_asr = self.asr
        if streaming_changed or language_changed:
            new_asr = StreamingASR(self.models, streaming_model_id, language)
        new_refiner = self.live_refiner
        if refined_changed:
            new_refiner = RefinedASR(self.models, refined_model_id)

        self.asr = new_asr
        if refined_changed:
            self.live_refiner = new_refiner
            if self.live_refinement is None:
                self.live_refinement = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="brevia-live-refine"
                )
        if language_changed:
            self.meeting_language = language
            self.detected_language = None
            self.punctuation = self._build_live_punctuation(language, self.active)
            self.language_identifier = None
            if language == "auto" and self.models.is_ready("whisper-large-v3"):
                try:
                    self.language_identifier = LanguageIdentifier(self.models)
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": self.active,
                            "code": "language_identifier_unavailable",
                            "message": str(error),
                        },
                    )

        meeting = self.store.update_meeting(
            self.active,
            {
                "language": language,
                "streaming_model_id": streaming_model_id,
                "refined_model_id": refined_model_id,
                "target_language": target_language,
            },
        )
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
        samples_total = self.store.append_audio(
            self.active,
            payload["track"],
            payload["pcm"],
            int(payload["sample_rate"]),
            int(payload["start_ms"]),
        )
        if not self.asr:
            return {"samples": samples_total}
        pcm = __import__("base64").b64decode(payload["pcm"], validate=True)
        values = array("h")
        values.frombytes(pcm)
        if sys.byteorder != "little":
            values.byteswap()
        import numpy

        samples = numpy.asarray(values, dtype=numpy.float32) / 32768.0
        state = self.stream_state[payload["track"]]
        if len(samples):
            state["audio"].append(samples)
        asr_samples = (
            self._enhance_live_microphone(samples)
            if payload["track"] == "mic"
            else samples
        )
        if payload["track"] == "mic" and self.denoiser:
            asr_samples = self.denoiser.accept(
                payload["track"],
                asr_samples,
                int(payload["sample_rate"]),
                bool(payload.get("flush")),
            )
        result, final = self.asr.accept(
            payload["track"],
            asr_samples,
            int(payload["sample_rate"]),
            bool(payload.get("flush")),
        )
        text = self._clean_live_text(result if isinstance(result, str) else result.text)
        if final and not text:
            text = state["last_text"]
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
                self.emit(
                    "asr.language",
                    {"meeting_id": self.active, "language": detected},
                )
        if self.punctuation:
            text = self.punctuation.apply(text)
        end_ms = int(
            payload["start_ms"] + len(samples) * 1000 / int(payload["sample_rate"])
        )
        if text and (text != state["last_text"] or final):
            state["revision"] += 1
            segment_id = f"{payload['track']}-{state['segment']}"
            speaker = "local-user" if payload["track"] == "mic" else (
                self.speaker_tracker.last_speaker
                if self.speaker_tracker and self.speaker_tracker.last_speaker
                else "spk-1"
            )
            speaker_name = "Local user" if speaker == "local-user" else None
            segment_audio = (
                numpy.concatenate(state["audio"])
                if final
                and state["audio"]
                and (self.speaker_tracker or self.live_refiner)
                else None
            )
            if (
                final
                and self.speaker_tracker
                and segment_audio is not None
            ):
                speaker, speaker_name = self._identify_speaker(
                    self.active,
                    self.speaker_tracker,
                    segment_audio,
                    int(payload["sample_rate"]),
                )
            event = {
                "meeting_id": self.active,
                "segment_id": segment_id,
                "revision": state["revision"],
                "text": text,
                "start_ms": state["start_ms"],
                "end_ms": end_ms,
                "speaker": speaker,
                "speaker_name": speaker_name,
                "track": payload["track"],
            }
            if speaker == "local-user":
                self.store.rename_speaker(self.active, speaker, "Local user")
            state["last_text"] = text
            if final:
                if self._is_duplicate_final(event):
                    self.emit(
                        "transcript.discarded",
                        {"meeting_id": self.active, "segment_id": segment_id},
                    )
                else:
                    self.store.save_segment(event)
                    self.emit("transcript.final", event)
                    self._refine_live_segment_later(
                        event, segment_audio, int(payload["sample_rate"])
                    )
            elif not final:
                self.store.save_segment(event)
                self.emit("transcript.partial", event)
            if final:
                state.update(
                    start_ms=end_ms,
                    revision=0,
                    segment=state["segment"] + 1,
                    last_text="",
                    audio=[],
                )
        elif final:
            state.update(
                start_ms=end_ms,
                revision=0,
                segment=state["segment"] + 1,
                last_text="",
                audio=[],
            )
        return {"samples": samples_total, "text": text, "final": final}

    def _refine_live_segment_later(self, event, samples, sample_rate):
        """将实时最终段交给单线程校准模型，不阻塞快轨。"""
        if not (self.live_refinement and self.live_refiner and samples is not None):
            return
        self.live_refinement.submit(
            self._refine_live_segment,
            self.live_refiner,
            event.copy(),
            samples.copy(),
            sample_rate,
        )

    def _refine_live_segment(self, refiner, event, samples, sample_rate):
        """写回同一 live 段；用户已编辑的段落由存储层拒绝覆盖。"""
        try:
            text = self._clean_live_text(refiner.decode(samples, sample_rate))
            if not text or text == event["text"]:
                return
            refined = {**event, "text": text, "revision": event["revision"] + 1}
            if self.store.save_segment(refined):
                self.emit("transcript.refined", refined)
        except Exception as error:
            self.emit(
                "worker.warning",
                {
                    "meeting_id": event["meeting_id"],
                    "code": "live_refinement_failed",
                    "message": str(error),
                },
            )

    def _identify_speaker(self, meeting_id, tracker, samples, sample_rate):
        """优先匹配已注册人员；未命中时保留会议内的临时说话人 ID。"""
        embedding = tracker.embedding(samples, sample_rate)
        if embedding is None:
            return tracker.last_speaker or "spk-1", None
        profile = self.store.match_speaker_profile(
            embedding, SETTINGS["diarization"]["online_similarity_threshold"]
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
                for track in ("mic", "system"):
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
        """在持久化停止状态前释放模型和执行器资源。"""
        refinement = self.live_refinement
        self.live_refinement = None
        if refinement:
            refinement.shutdown(wait=True, cancel_futures=True)
        (
            self.active,
            self.asr,
            self.punctuation,
            self.denoiser,
            self.language_identifier,
        ) = None, None, None, None, None
        self.speaker_tracker, self.stream_state, self.recent_finals = None, {}, []
        self.meeting_language, self.detected_language = None, None
        self.live_refiner = None

    def _active(self, meeting_id):
        """确认命令指向当前活动会议，无返回值。"""
        self.state.require(meeting_id)
