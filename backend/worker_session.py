"""Focused worker responsibility component."""

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
from .audio_io import convert_to_pcm_wav, read_mono_wav
from .config import SETTINGS
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
            _, sample_rate = read_mono_wav(destination)
            import wave

            with wave.open(str(destination)) as audio:
                duration_ms = round(audio.getnframes() * 1000 / sample_rate)
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
        if self.models.is_ready(denoiser_id):
            try:
                self.denoiser = LiveDenoiser(self.models, denoiser_id)
            except RuntimeError as error:
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": self.active,
                        "code": "denoiser_unavailable",
                        "message": str(error),
                    },
                )
        if meeting["language"] == "auto" and self.models.is_ready("whisper-turbo"):
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
        try:
            self.asr = StreamingASR(self.models, meeting["streaming_model_id"])
        except RuntimeError as error:
            self.asr = None
            self.emit(
                "worker.warning",
                {
                    "meeting_id": self.active,
                    "code": "asr_unavailable",
                    "message": str(error),
                },
            )
        if meeting["language"] == "en":
            try:
                self.punctuation = EnglishPunctuation(
                    self.models, SETTINGS["punctuation"]["english_model_id"]
                )
            except RuntimeError as error:
                self.punctuation = None
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": self.active,
                        "code": "punctuation_unavailable",
                        "message": str(error),
                    },
                )
        elif meeting["language"] in {"zh", "yue", "auto"}:
            try:
                self.punctuation = ChinesePunctuation(
                    self.models, SETTINGS["punctuation"]["chinese_model_id"]
                )
            except RuntimeError as error:
                self.punctuation = None
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": self.active,
                        "code": "punctuation_unavailable",
                        "message": str(error),
                    },
                )
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
                    "meeting_id": self.active,
                    "code": "speaker_unavailable",
                    "message": str(error),
                },
            )
        if self.models.is_ready(meeting["refined_model_id"]):
            try:
                self.live_refiner = RefinedASR(self.models, meeting["refined_model_id"])
                self.live_refinement = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="brevia-live-refine"
                )
            except RuntimeError as error:
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": self.active,
                        "code": "live_refinement_unavailable",
                        "message": str(error),
                    },
                )

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
            self.active, payload["track"], payload["pcm"], int(payload["sample_rate"])
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
                            self.models, SETTINGS["asr"]["auto_english_model_id"]
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
            speaker = "local-user" if payload["track"] == "mic" else "spk-1"
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
        """Release model and executor resources before persisting the stopped state."""
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
