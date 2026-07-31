#!/usr/bin/env python3
"""Electron 后台 Worker：处理 JSONL 命令并编排录音、识别、存储与导出。"""

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import zipfile
from array import array
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from pathlib import Path

from .asr import (
    ChinesePunctuation,
    EnglishPunctuation,
    LanguageIdentifier,
    LiveDenoiser,
    OfflineDenoiser,
    ModelManager,
    OfflineDiarizer,
    RefinedASR,
    SenseVoiceStreamingASR,
    SpeakerTracker,
    StreamingASR,
)
from .audio_io import read_mono_wav
from .llm_client import complete
from .media_tasks import MeetingMediaService
from .transcript import clock, latest_segments, parse_json_object, srt_time, validate_summary
from .voice_profiles import VoiceProfileService
from .config import DEFAULT_SETTINGS, SETTINGS, runtime_settings, save_runtime_settings
from .storage import Store


SCHEMA_VERSION = 1


def require(payload, *names):
    """确认命令数据包含必填键；缺失时一次列出全部键名。"""
    missing = [name for name in names if name not in payload]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")


class Worker:
    """连接 Electron IPC 与本地能力的单进程命令处理器。"""

    def __init__(self, root=None, output=None):
        """初始化存储和模型管理。

        Args:
            root: 数据目录；为空时读取环境变量，再回退到 macOS 应用目录。
            output: JSON 消息输出函数；默认逐行写到 stdout。
        """
        root = root or os.environ.get(
            "BREVIA_DATA_DIR",
            Path.home() / "Library" / "Application Support" / "Brevia",
        )
        self.output = output or (lambda value: print(json.dumps(value, ensure_ascii=False), flush=True))
        self.output_lock = threading.Lock()
        self.model_downloads = {}
        self.model_downloads_lock = threading.Lock()
        self.store = Store(root)
        runtime_settings(self.store.root)
        self.models = ModelManager(self.store.models_dir, self.emit)
        # 服务按存储/模型依赖构造；它们不持有实时会议状态，便于单独测试。
        self.voice_profiles = VoiceProfileService(self.store, self.models)
        self.media = MeetingMediaService(self.store, self.models)
        # 可替换边界让集成测试无需连接外部 LLM，也集中保留用户同意后的唯一出口。
        self.llm_complete = complete
        self.active = None
        self.asr = None
        self.denoiser = None
        self.language_identifier = None
        self.punctuation = None
        self.speaker_tracker = None
        self.stream_state = {}
        self.recent_finals = []
        self.meeting_language = None
        self.detected_language = None
        self.asr_warning_sent = False
        self.live_refiner = None
        self.live_refinement = None

    def emit(self, event_type, payload):
        """向前端发送无请求 ID 的异步事件。"""
        with self.output_lock:
            self.output({"type": event_type, "schema_version": SCHEMA_VERSION, "payload": payload})

    def response(self, command_id, result=None, error=None):
        """写出一条命令响应；错误只返回安全的字符串表示。"""
        value = {"id": command_id, "ok": error is None}
        value["error" if error else "result"] = str(error) if error else result
        with self.output_lock:
            self.output(value)

    def handle(self, command):
        """校验并分发一条 JSONL 命令。

        Args:
            command: 包含 ``id``、``type`` 和可选 ``payload`` 的字典。

        Returns:
            对应处理器的结果，最终由 ``response`` 包装。
        """
        command_id = command.get("id")
        command_type = command.get("type")
        payload = command.get("payload") or {}
        if not command_id or not command_type:
            raise ValueError("Commands require id and type")
        handlers = {
            "app.initialize": self.initialize,
            "meeting.start": self.start,
            "meeting.import": self.import_audio,
            "meeting.resume": self.resume,
            "meeting.pause": self.pause,
            "meeting.audio": self.audio,
            "meeting.stop": self.stop,
            "meeting.list": lambda value: self.store.list_meetings(**value),
            "meeting.get": lambda value: self.store.get_meeting(value["meeting_id"]),
            "meeting.update": self.update_meeting,
            "meeting.delete": self.delete_meeting,
            "meeting.restore": self.restore_meeting,
            "meeting.purge": self.purge_meeting,
            "speaker.rename": self.rename_speaker,
            "speaker-profile.list": lambda _: self.store.list_speaker_profiles(),
            "speaker-profile.samples": lambda value: self.store.list_speaker_profile_samples(value["profile_id"]),
            "speaker-profile.enroll": self.enroll_speaker_profile,
            "speaker-profile.verify": self.verify_speaker_profile,
            "speaker-profile.sample-delete": self.delete_speaker_profile_sample,
            "speaker-profile.delete": self.delete_speaker_profile,
            "speaker-profile.rename": lambda value: self.store.rename_speaker_profile(value["profile_id"], value["name"]),
            "storage.clear": lambda value: self.store.clear_storage_partition(value["partition"]),
            "settings.advanced.get": lambda _: {"settings": SETTINGS, "defaults": DEFAULT_SETTINGS},
            "settings.advanced.save": lambda value: save_runtime_settings(self.store.root, value["settings"]),
            "metrics.record": lambda value: self.store.metrics(value.get("app_duration_ms", 0)),
            "segment.speaker": self.assign_segment_speaker,
            "segment.speaker-profile-sample": self.add_segment_speaker_profile_sample,
            "models.list": lambda _: self.models.list(),
            "models.download": self.download_model,
            "models.delete": self.delete_model,
            "meeting.export": self.export,
            "meeting.bundle": self.bundle,
            "meeting.refine": self.refine,
            "meeting.separate": self.separate_sources,
            "tts.synthesize": self.synthesize_tts,
            "summary.generate": self.summarize,
            "translation.generate": self.translate,
        }
        if command_type not in handlers:
            raise ValueError(f"Unknown command: {command_type}")
        return handlers[command_type](payload)

    def initialize(self, _):
        """执行启动期维护，并返回前端首屏需要的完整本地状态。"""
        seeded_examples = self.store.seed_examples()
        purged = self.store.purge_expired()
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
        if not self.models.is_ready(denoiser_id):
            self.download_model({"model_id": denoiser_id})
        try:
            self.voice_profiles.seed_builtin_profiles()
        except RuntimeError as error:
            self.emit("worker.warning", {"code": "builtin_voiceprints_unavailable", "message": str(error)})
        for profile in self.store.list_speaker_profiles():
            if self._is_default_speaker_name(profile["name"]):
                self.store.delete_speaker_profile(profile["id"])
        return {
            "meetings": self.store.list_meetings(),
            "models": self.models.list(),
            "speaker_profiles": self.store.list_speaker_profiles(),
            "preset_voices": self.media.preset_voices(),
            "device": self.models.device(),
            "storage": self.store.usage(),
            "recoverable": self.store.recoverable_meetings(),
            "purged_meeting_ids": purged,
            "seeded_examples": seeded_examples,
        }

    def assign_segment_speaker(self, payload):
        if self._is_default_speaker_name(payload["name"]):
            return self.store.get_meeting(payload["meeting_id"])
        profile = self.store.ensure_speaker_profile(payload["name"])
        speaker_id = f"profile-{profile['id']}"
        self.store.set_segment_speaker(payload["meeting_id"], payload["segment_id"], speaker_id, profile["id"], profile["name"])
        meeting = self.store.get_meeting(payload["meeting_id"])
        profile = self.voice_profiles.learn_from_meeting(
            meeting, speaker_id, profile["name"], segment_ids={payload["segment_id"]}, source_id=profile["id"]
        )
        self.emit("speaker-profile.updated", {"profile": profile})
        return self.store.get_meeting(payload["meeting_id"])

    def add_segment_speaker_profile_sample(self, payload):
        """仅在用户明确选择时，将一段已保存对话加入既有声纹档案。"""
        require(payload, "meeting_id", "segment_id", "profile_id")
        profile = self.store.speaker_profile(payload["profile_id"])
        self.store.set_segment_speaker(
            payload["meeting_id"], payload["segment_id"], f"profile-{profile['id']}", profile["id"], profile["name"]
        )
        profile = self.voice_profiles.learn_from_meeting(
            self.store.get_meeting(payload["meeting_id"]), None, profile["name"],
            segment_ids={payload["segment_id"]}, source_id=profile["id"],
        )
        self.emit("speaker-profile.updated", {"profile": profile})
        return self.store.get_meeting(payload["meeting_id"])

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
        required_models = [payload.get(key) for key in ("streaming_model_id", "refined_model_id", "speaker_segmentation_model_id", "speaker_embedding_model_id", "vad_model_id")]
        missing_models = [model_id for model_id in required_models if model_id and not self.models.is_ready(model_id)]
        if payload.get("require_models") and missing_models:
            label = "Model" if len(missing_models) == 1 else "Models"
            verb = "is" if len(missing_models) == 1 else "are"
            raise RuntimeError(f"{label} {', '.join(missing_models)} {verb} not installed")
        meeting = self.store.create_meeting(payload)
        self._prepare_active(meeting)
        self.emit("meeting.started", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def import_audio(self, payload):
        """导入录音，统一转为本地 16 kHz 单声道 WAV 后创建可精修会议。"""
        require(payload, "title", "language", "streaming_model_id", "refined_model_id", "path")
        source = Path(payload["path"])
        if not source.is_file():
            raise ValueError("Audio file not found")
        meeting = self.store.create_meeting(payload)
        destination = self.store.meetings_dir / meeting["id"] / "audio" / "playback-mic.wav"
        try:
            subprocess.run(["ffmpeg", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(destination)], check=True, capture_output=True)
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

    def resume(self, payload):
        """恢复一场未正常结束的录音，并从给定毫秒位置继续计时。"""
        require(payload, "meeting_id")
        if self.active:
            raise ValueError("A meeting is already active")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] != "recording":
            raise ValueError("Only an unfinished recording can be resumed")
        self._prepare_active(meeting, int(payload.get("start_ms", 0)))
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
                self.emit("worker.warning", {"meeting_id": self.active, "code": "denoiser_unavailable", "message": str(error)})
        if meeting["language"] == "auto" and self.models.is_ready("whisper-turbo"):
            try:
                self.language_identifier = LanguageIdentifier(self.models)
            except RuntimeError as error:
                self.emit("worker.warning", {"meeting_id": self.active, "code": "language_identifier_unavailable", "message": str(error)})
        try:
            self.asr = SenseVoiceStreamingASR(self.models, meeting["streaming_model_id"], meeting.get("vad_model_id") or "silero-vad") if self.models.get(meeting["streaming_model_id"])["kind"] == "sensevoice" else StreamingASR(self.models, meeting["streaming_model_id"])
        except RuntimeError as error:
            self.asr = None
            self.emit(
                "worker.warning",
                {"meeting_id": self.active, "code": "asr_unavailable", "message": str(error)},
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
                    {"meeting_id": self.active, "code": "punctuation_unavailable", "message": str(error)},
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
                    {"meeting_id": self.active, "code": "punctuation_unavailable", "message": str(error)},
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
                {"meeting_id": self.active, "code": "speaker_unavailable", "message": str(error)},
            )
        if meeting["refined_model_id"].startswith("qwen3-") and self.models.is_ready(meeting["refined_model_id"]):
            try:
                self.live_refiner = RefinedASR(self.models, meeting["refined_model_id"])
                self.live_refinement = ThreadPoolExecutor(max_workers=1, thread_name_prefix="brevia-live-refine")
            except RuntimeError as error:
                self.emit("worker.warning", {"meeting_id": self.active, "code": "live_refinement_unavailable", "message": str(error)})

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
        rms = (sum(float(sample) * float(sample) for sample in samples) / len(samples)) ** 0.5
        if rms < config["microphone_minimum_rms"]:
            return samples
        gain = min(config["microphone_max_gain"], config["microphone_target_rms"] / rms)
        peak = max(abs(float(sample)) for sample in samples)
        if peak:
            gain = min(gain, config["microphone_peak"] / peak)
        return samples if gain <= 1 else samples * gain

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
        asr_samples = self._enhance_live_microphone(samples) if payload["track"] == "mic" else samples
        if payload["track"] == "mic" and self.denoiser:
            asr_samples = self.denoiser.accept(
                payload["track"], asr_samples, int(payload["sample_rate"]), bool(payload.get("flush"))
            )
        result, final = self.asr.accept(
            payload["track"], asr_samples, int(payload["sample_rate"]), bool(payload.get("flush"))
        )
        text = self._clean_live_text(result if isinstance(result, str) else result.text)
        if final and not text:
            text = state["last_text"]
        if self.meeting_language == "auto" and not self.detected_language:
            context = numpy.concatenate(state["audio"]) if state["audio"] else samples
            detected = self.language_identifier.identify(context, int(payload["sample_rate"])) if self.language_identifier and len(context) >= int(payload["sample_rate"]) else self._detect_language(text)
            if detected:
                self.detected_language = detected
                if detected == "en":
                    try:
                        self.asr = StreamingASR(self.models, SETTINGS["asr"]["auto_english_model_id"])
                        self.punctuation = EnglishPunctuation(
                            self.models, SETTINGS["punctuation"]["english_model_id"]
                        )
                        result, _ = self.asr.accept(
                            payload["track"], numpy.concatenate(state["audio"]), int(payload["sample_rate"])
                        )
                        text = self._clean_live_text(result if isinstance(result, str) else result.text)
                    except RuntimeError as error:
                        self.emit(
                            "worker.warning",
                            {"meeting_id": self.active, "code": "auto_model_unavailable", "message": str(error)},
                        )
                self.emit(
                    "asr.language",
                    {"meeting_id": self.active, "language": detected},
                )
        if self.punctuation:
            text = self.punctuation.apply(text)
        end_ms = int(payload["start_ms"] + len(samples) * 1000 / int(payload["sample_rate"]))
        if text and (text != state["last_text"] or final):
            state["revision"] += 1
            segment_id = f"{payload['track']}-{state['segment']}"
            speaker = "spk-1" if payload["track"] == "mic" else "spk-2"
            segment_audio = numpy.concatenate(state["audio"]) if final and state["audio"] and (self.speaker_tracker or self.live_refiner) else None
            if final and self.speaker_tracker and segment_audio is not None:
                speaker = self._identify_speaker(
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
                "track": payload["track"],
            }
            state["last_text"] = text
            if final:
                if self._is_duplicate_final(event):
                    self.emit("transcript.discarded", {"meeting_id": self.active, "segment_id": segment_id})
                else:
                    self.store.save_segment(event)
                    self.emit("transcript.final", event)
                    self._refine_live_segment_later(event, segment_audio, int(payload["sample_rate"]))
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
        """将中文最终段交给单线程 Qwen3，避免阻塞实时 Zipformer。"""
        if not (self.live_refinement and self.live_refiner and samples is not None):
            return
        if self.meeting_language not in {"zh", "yue"} and self.detected_language not in {"zh", "yue"}:
            return
        self.live_refinement.submit(self._refine_live_segment, self.live_refiner, event.copy(), samples.copy(), sample_rate)

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
            self.emit("worker.warning", {"meeting_id": event["meeting_id"], "code": "live_refinement_failed", "message": str(error)})

    def _identify_speaker(self, meeting_id, tracker, samples, sample_rate):
        """优先匹配已注册人员；未命中时保留会议内的临时说话人 ID。"""
        embedding = tracker.embedding(samples, sample_rate)
        if embedding is None:
            return tracker.last_speaker or "spk-1"
        profile = self.store.match_speaker_profile(
            embedding, SETTINGS["diarization"]["online_similarity_threshold"]
        )
        if profile:
            speaker_id = f"profile-{profile['id']}"
            self.store.rename_speaker(meeting_id, speaker_id, profile["name"], profile_id=profile["id"])
            return speaker_id
        return tracker.assign_embedding(embedding)

    def stop(self, payload):
        """flush 所有识别流、合成播放文件并结束活动会议。

        Returns:
            状态为 ``ready`` 的会议详情。
        """
        require(payload, "meeting_id", "duration_ms")
        self._active(payload["meeting_id"])
        if self.asr:
            for track in ("mic", "system"):
                self.audio(
                    {
                        "meeting_id": self.active,
                        "track": track,
                        "pcm": "",
                        "sample_rate": 16000,
                        "start_ms": int(payload["duration_ms"]),
                        "flush": True,
                    }
                )
        meeting = self.store.finish_meeting(self.active, payload["duration_ms"])
        meeting = self.store.get_meeting(meeting["id"])
        self.emit("meeting.stopped", {"meeting_id": self.active, "meeting": meeting})
        if self.live_refinement:
            self.live_refinement.shutdown(wait=False)
        self.active, self.asr, self.punctuation, self.denoiser, self.language_identifier = None, None, None, None, None
        self.speaker_tracker, self.stream_state, self.recent_finals = None, {}, []
        self.meeting_language, self.detected_language = None, None
        self.live_refiner, self.live_refinement = None, None
        return meeting

    def update_meeting(self, payload):
        """更新会议的可编辑元数据并返回最新详情。"""
        require(payload, "meeting_id", "updates")
        return self.store.update_meeting(payload["meeting_id"], payload["updates"])

    def delete_meeting(self, payload):
        """删除非活动会议。

        普通会议进入最近删除；示例会议由存储层永久删除以立即释放空间。
        """
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        self.store.soft_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "deleted": True}

    def restore_meeting(self, payload):
        """恢复软删除会议并返回完整详情。"""
        require(payload, "meeting_id")
        self.store.soft_delete(payload["meeting_id"], restore=True)
        return self.store.get_meeting(payload["meeting_id"])

    def purge_meeting(self, payload):
        """永久删除最近删除中的会议及其全部本地文件。"""
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        self.store.permanent_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "purged": True}

    def rename_speaker(self, payload):
        """保存说话人名称和可选锁定状态，并返回更新后的会议。"""
        require(payload, "meeting_id", "speaker_id", "name")
        if self._is_default_speaker_name(payload["name"]):
            self.store.rename_speaker(payload["meeting_id"], payload["speaker_id"], payload["name"], payload.get("locked", False))
            return self.store.get_meeting(payload["meeting_id"])
        self.store.rename_speaker(
            payload["meeting_id"],
            payload["speaker_id"],
            payload["name"],
            payload.get("locked", False),
        )
        profile = self.voice_profiles.learn_from_meeting(
            self.store.get_meeting(payload["meeting_id"]), payload["speaker_id"], payload["name"]
        )
        self.store.rename_speaker(
            payload["meeting_id"], payload["speaker_id"], payload["name"],
            payload.get("locked", False), profile["id"],
        )
        self.emit("speaker-profile.updated", {"profile": profile})
        return self.store.get_meeting(payload["meeting_id"])

    @staticmethod
    def _is_default_speaker_name(name):
        """识别各界面语言的自动说话人占位名称，避免将其注册为真人声纹。"""
        normalized = re.sub(r"[\s_-]+", "", name.strip().casefold())
        return bool(re.fullmatch(
            r"(?:spk|speaker|说话人|話者|화자|hablante|orador|locuteur|intervenant|sprecher|говорящий|спикер)\d+",
            normalized,
        ))

    def enroll_speaker_profile(self, payload):
        """从用户选定的单人语音录音注册或补充本地人员声纹。"""
        require(payload, "name", "path")
        result = self.voice_profiles.enroll(payload)
        self.emit("speaker-profile.updated", {"profile": result})
        return result

    def verify_speaker_profile(self, payload):
        """验证一段临时选择的音频是否匹配指定本地声纹。"""
        require(payload, "profile_id", "path")
        return self.voice_profiles.verify(payload)

    def delete_speaker_profile(self, payload):
        require(payload, "profile_id")
        self.store.delete_speaker_profile(payload["profile_id"])
        self.emit("speaker-profile.deleted", {"profile_id": payload["profile_id"]})
        return {"profile_id": payload["profile_id"], "deleted": True}

    def delete_speaker_profile_sample(self, payload):
        """删除一句声纹存档，并发布人员声纹已增量更新。"""
        require(payload, "profile_id", "sample_id")
        profile = self.store.delete_speaker_profile_sample(payload["profile_id"], payload["sample_id"])
        self.emit("speaker-profile.updated", {"profile": profile})
        return profile

    def download_model(self, payload):
        """启动指定模型的后台下载，并立即返回其状态。"""
        require(payload, "model_id")
        model_id = payload["model_id"]
        with self.model_downloads_lock:
            if model_id in self.model_downloads:
                return {"model_id": model_id, "status": "downloading"}
            task = threading.Thread(target=self._download_model, args=(model_id,), daemon=True)
            self.model_downloads[model_id] = task
            task.start()
        return {"model_id": model_id, "status": "downloading"}

    def _download_model(self, model_id):
        """下载模型并将最终状态作为异步事件发送。"""
        try:
            self.models.download(model_id)
            if model_id == SETTINGS["diarization"]["embedding_model_id"]:
                try:
                    self.voice_profiles.seed_builtin_profiles()
                    self.emit("speaker-profile.updated", {"profiles": self.store.list_speaker_profiles()})
                except RuntimeError as error:
                    self.emit("worker.warning", {"code": "builtin_voiceprints_unavailable", "message": str(error)})
        except Exception as error:
            self.emit("model.status", {"model_id": model_id, "status": "failed", "error": str(error)})
        finally:
            with self.model_downloads_lock:
                self.model_downloads.pop(model_id, None)

    def delete_model(self, payload):
        """删除模型；活动会议正在使用的实时模型不可删除。"""
        require(payload, "model_id")
        if self.active and self.store.get_meeting(self.active)["streaming_model_id"] == payload["model_id"]:
            raise ValueError("Cannot delete the model used by the active meeting")
        self.models.delete(payload["model_id"])
        return {"model_id": payload["model_id"], "deleted": True}

    def export(self, payload):
        """导出逐字稿、纪要或录音。

        Args:
            payload: 会议 ID、目标格式，可选 ``content`` 与音轨 ``track``。

        Returns:
            临时导出文件路径和实际格式；Electron 再负责保存或分享。
        """
        require(payload, "meeting_id", "format")
        meeting = self.store.get_meeting(payload["meeting_id"])
        export_format = payload["format"].lower()
        content_type = payload.get("content", "transcript")
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        safe_title = re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        path = directory / f"{safe_title}.{export_format}"
        if content_type == "audio":
            return self._export_audio(meeting, path, export_format, payload.get("track", "mix"))
        if content_type not in {"transcript", "notes"}:
            raise ValueError("Export content must be transcript, notes, or audio")
        if export_format not in {"md", "txt", "json", "srt", "docx", "pdf"}:
            raise ValueError("Unsupported text export format")
        segments = latest_segments(meeting["segments"])
        if export_format == "json":
            content = json.dumps({**meeting, "segments": segments}, ensure_ascii=False, indent=2)
        elif export_format == "srt":
            content = "\n\n".join(
                f"{index}\n{srt_time(item['start_ms'])} --> {srt_time(item['end_ms'])}\n"
                f"{item['speaker_name']}: {item['text']}"
                for index, item in enumerate(segments, 1)
            )
        elif content_type == "notes":
            summary = meeting.get("summary", {}).get("data") if meeting.get("summary") else None
            if not summary:
                raise ValueError("Generate meeting notes before exporting them")
            content = self._summary_markdown(meeting["title"], summary)
        else:
            lines = [
                f"[{clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
                + (f"\n{item['translation']}" if item.get("translation") else "")
                for item in segments
            ]
            content = (
                f"# {meeting['title']}\n\n" + "\n\n".join(lines)
                if export_format == "md"
                else "\n".join(lines)
            )
        if export_format in {"docx", "pdf"}:
            path = self._convert_document(directory, safe_title, export_format, content)
        else:
            path.write_text(content, encoding="utf-8")
        return {"path": str(path), "format": export_format}

    def bundle(self, payload):
        """打包本地录音与 Markdown、TXT 逐字稿。"""
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        directory.mkdir(parents=True, exist_ok=True)
        safe_title = re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        audio = next(
            (meeting["audio"]["playback"].get(track) for track in ("mix", "mic", "system") if meeting["audio"]["playback"].get(track)),
            None,
        )
        markdown = self.export({"meeting_id": meeting["id"], "format": "md"})["path"]
        plain_text = self.export({"meeting_id": meeting["id"], "format": "txt"})["path"]
        bundle = directory / f"{safe_title}.zip"
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
            if audio:
                archive.write(audio, arcname=f"{safe_title}.wav")
            archive.write(markdown, arcname=f"{safe_title}.md")
            archive.write(plain_text, arcname=f"{safe_title}.txt")
        return {"path": str(bundle), "format": "zip", "recording_included": bool(audio)}

    def _export_audio(self, meeting, path, export_format, track):
        """通过 ffmpeg 导出单轨或归一化混音。

        Returns:
            包含导出路径和格式的字典。
        """
        if export_format not in {"flac", "wav", "m4a"}:
            raise ValueError("Supported audio formats: flac, wav, m4a")
        playback = meeting["audio"]["playback"]
        inputs = [playback[name] for name in ("mic", "system") if playback.get(name)]
        if track in {"mic", "system", "vocals", "accompaniment"}:
            inputs = [playback.get(track)] if playback.get(track) else []
        if not inputs:
            raise ValueError("The selected audio track is empty")
        ffmpeg = os.environ.get("BREVIA_FFMPEG") or shutil.which("ffmpeg")
        if not ffmpeg:
            raise ValueError("ffmpeg is required for audio export")
        command = [ffmpeg, "-y", "-loglevel", "error"]
        for source in inputs:
            command.extend(["-i", source])
        if len(inputs) == 2:
            command.extend(["-filter_complex", "amix=inputs=2:duration=longest:normalize=1"])
        if export_format == "m4a":
            command.extend(["-c:a", "aac", "-b:a", "192k"])
        command.append(str(path))
        subprocess.run(command, check=True)
        return {"path": str(path), "format": export_format}

    @staticmethod
    def _summary_markdown(title, summary):
        """把结构化纪要转换成适合导出的 Markdown 文本。"""
        decisions = "\n".join(f"- {item['text']}" for item in summary["decisions"]) or "- 无"
        actions = "\n".join(
            f"- [ ] {item['task']} · {item.get('owner') or '待确认'} · {item.get('due') or '无截止日期'}"
            for item in summary["action_items"]
        ) or "- 无"
        questions = "\n".join(f"- {item}" for item in summary["open_questions"]) or "- 无"
        return (
            f"# {title}\n\n{summary['summary']}\n\n## 决定\n\n{decisions}\n\n"
            f"## 待办\n\n{actions}\n\n## 开放问题\n\n{questions}\n"
        )

    @staticmethod
    def _convert_document(directory, title, export_format, content):
        """调用 macOS 原生工具把文本转换为 DOCX 或 PDF，返回目标路径。"""
        source = directory / f"{title}.{'html' if export_format == 'docx' else 'txt'}"
        source.write_text(
            (
                "<!doctype html><meta charset='utf-8'><style>"
                "body{font:16px -apple-system;line-height:1.7;max-width:760px;margin:48px auto}"
                "</style><pre style='white-space:pre-wrap'>"
                + __import__("html").escape(content)
                + "</pre>"
            )
            if export_format == "docx"
            else content,
            encoding="utf-8",
        )
        destination = directory / f"{title}.{export_format}"
        try:
            if export_format == "docx" and shutil.which("textutil"):
                subprocess.run(
                    ["textutil", "-convert", "docx", "-output", str(destination), str(source)],
                    check=True,
                    capture_output=True,
                )
            elif export_format == "pdf" and shutil.which("cupsfilter"):
                with destination.open("wb") as output:
                    subprocess.run(
                        ["cupsfilter", "-m", "application/pdf", str(source)],
                        check=True,
                        stdout=output,
                        stderr=subprocess.PIPE,
                    )
            else:
                raise ValueError(f"{export_format.upper()} export is unavailable on this device")
        finally:
            source.unlink(missing_ok=True)
        return destination

    def refine(self, payload):
        """对停止后的会议执行会后转写和说话人聚类。

        Args:
            payload: 会议 ID；可选已知说话人数和聚类阈值。

        Returns:
            状态更新为 ``refined`` 的会议详情。

        Notes:
            优先使用混音轨生成跨音轨的说话人时间段。人工编辑或锁定的说话人
            优先于聚类结果。
        """
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] == "recording":
            raise ValueError("Stop the meeting before refinement")
        refined_model_id = payload.get("refined_model_id", meeting["refined_model_id"])
        if refined_model_id != meeting["refined_model_id"]:
            self.models.get(refined_model_id)
            meeting = self.store.update_meeting(meeting["id"], {"refined_model_id": refined_model_id})
        num_speakers = int(payload.get("num_speakers", meeting.get("num_speakers", SETTINGS["diarization"]["num_speakers"])))
        threshold = float(
            payload.get("cluster_threshold", SETTINGS["diarization"]["cluster_threshold"])
        )
        if num_speakers != -1 and num_speakers < 1:
            raise ValueError("num_speakers must be -1 or a positive integer")
        if not 0 <= threshold <= 1:
            raise ValueError("cluster_threshold must be between 0 and 1")
        track = next(
            (name for name in ("mix", "mic", "system") if meeting["audio"]["playback"].get(name)),
            None,
        )
        tracks = [track] if track else []
        if not tracks:
            raise ValueError("The meeting has no audio to refine")
        audio = {
            track: read_mono_wav(meeting["audio"]["playback"][track])
            for track in tracks
        }
        samples, sample_rate = audio[tracks[0]]
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
        if self.models.is_ready(denoiser_id):
            try:
                samples = OfflineDenoiser(self.models, denoiser_id).process(samples, sample_rate)
            except RuntimeError as error:
                self.emit("worker.warning", {"meeting_id": meeting["id"], "code": "offline_denoiser_unavailable", "message": str(error)})
        speaker_tracker = SpeakerTracker(self.models)
        turns = OfflineDiarizer(self.models, num_speakers, threshold, meeting.get("speaker_segmentation_model_id"), meeting.get("speaker_embedding_model_id")).process(samples, sample_rate)
        try:
            identity_tracker = SpeakerTracker(self.models, model_id=meeting.get("speaker_embedding_model_id"))
            for turn in turns:
                clip = samples[round(turn["start_ms"] * sample_rate / 1000):round(turn["end_ms"] * sample_rate / 1000)]
                embedding = identity_tracker.embedding(clip, sample_rate)
                profile = embedding is not None and self.store.match_speaker_profile(
                    embedding, SETTINGS["diarization"]["online_similarity_threshold"]
                )
                if profile:
                    turn["speaker"] = f"profile-{profile['id']}"
                    self.store.rename_speaker(meeting["id"], turn["speaker"], profile["name"], profile_id=profile["id"])
        except RuntimeError:
            pass
        self.store.replace_speaker_turns(meeting["id"], turns)
        self.emit(
            "diarization.ready",
            {"meeting_id": meeting["id"], "track": tracks[0], "turns": turns},
        )
        recognizer = RefinedASR(self.models, refined_model_id)
        locked_ids = {speaker["id"] for speaker in meeting["speakers"] if speaker["locked"]}
        locked_segments = [
            segment
            for segment in meeting["segments"]
            if segment["user_edited"] or segment["speaker"] in locked_ids
        ]
        window_size = SETTINGS["asr"]["refined_window_seconds"]
        windows = self._refinement_turns(turns, len(samples) * 1000 // sample_rate, window_size * 1000)
        total = len(windows)
        completed = 0
        previous_text = {}
        refined_segments = []
        refined_segment_ids = set()
        overlap_ms = 1000
        self.store.set_status(meeting["id"], "refining")
        self.emit("refinement.started", {"meeting_id": meeting["id"], "total": total})
        try:
            for track in tracks:
                for index, turn in enumerate(windows):
                    start_ms, end_ms = turn["start_ms"], turn["end_ms"]
                    before = windows[index - 1] if index else None
                    after = windows[index + 1] if index + 1 < len(windows) else None
                    decode_start_ms = start_ms - overlap_ms if before and before["speaker"] == turn["speaker"] and before["end_ms"] == start_ms else start_ms
                    decode_end_ms = end_ms + overlap_ms if after and after["speaker"] == turn["speaker"] and after["start_ms"] == end_ms else end_ms
                    start = round(decode_start_ms * sample_rate / 1000)
                    end = round(decode_end_ms * sample_rate / 1000)
                    current = samples[start:end]
                    raw_text = recognizer.decode(current, sample_rate)
                    speaker_key = turn["speaker"] or track
                    text = self._trim_refinement_overlap(previous_text.get(speaker_key, ""), raw_text)
                    previous_text[speaker_key] = raw_text
                    completed += 1
                    self.emit(
                        "refinement.progress",
                        {"meeting_id": meeting["id"], "completed": completed, "total": total},
                    )
                    if not text:
                        continue
                    speaker = self._speaker_for(start_ms, end_ms, locked_segments)
                    if not speaker:
                        speaker = turn["speaker"]
                    if not speaker:
                        speaker = speaker_tracker.assign(current, sample_rate)
                    segment_id = self._refinement_segment_id(track, start_ms, index, refined_segment_ids)
                    event = {
                        "meeting_id": meeting["id"],
                        "segment_id": segment_id,
                        "version": "postprocess",
                        "text": text,
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                        "speaker": speaker or ("spk-1" if track == "mic" else "spk-2"),
                        "track": track,
                    }
                    refined_segments.append(event)
        except Exception:
            self.store.set_status(meeting["id"], "ready")
            raise
        version, revision = self.store.next_refinement_version(meeting["id"])
        refined_segments = self.store.replace_segments(meeting["id"], refined_segments, version, revision)
        for event in refined_segments:
            self.emit("refinement.segment", event)
        result = self.store.set_status(meeting["id"], "refined")
        result = self.store.get_meeting(meeting["id"])
        self.emit("refinement.ready", {"meeting_id": meeting["id"], "meeting": result})
        return result

    def separate_sources(self, payload):
        """从已保存会议生成独立的人声和非人声 WAV，不改动原录音。"""
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        self.emit("separation.started", {"meeting_id": meeting["id"], "completed": 0, "total": 100})
        event = self.media.separate(
            meeting,
            lambda completed, stage: self.emit(
                "separation.progress",
                {"meeting_id": meeting["id"], "completed": completed, "total": 100, "stage": stage},
            ),
        )
        self.emit("meeting.sources-separated", event)
        return event

    def synthesize_tts(self, payload):
        """使用已注册人员的本地参考音频生成 ZipVoice 聊天语音。"""
        require(payload, "text", "voice_id", "target_language", "endpoint", "model")
        if not self.models.is_ready("zipvoice-zh-en"):
            raise RuntimeError("Model zipvoice-zh-en is not installed")
        payload = {**payload, "language": payload["target_language"]}
        payload["text"] = self.llm_complete(
            payload,
            f"Translate the following text to {'Chinese' if payload['target_language'] == 'zh' else 'English'}. Return only the translation.\n\n{payload['text']}",
        ).strip()
        event = self.media.synthesize(payload)
        self.emit("tts.ready", event)
        return event

    @staticmethod
    def _refinement_turns(turns, duration_ms, maximum_ms):
        """按离线说话人边界拆分精修窗口，且单段不超过模型上限。"""
        source = turns or [{"start_ms": 0, "end_ms": duration_ms, "speaker": None}]
        return [
            {"start_ms": start, "end_ms": min(start + maximum_ms, turn["end_ms"]), "speaker": turn["speaker"]}
            for turn in source
            for start in range(turn["start_ms"], turn["end_ms"], maximum_ms)
        ]

    @staticmethod
    def _refinement_segment_id(track, start_ms, index, existing):
        """为重叠的离线窗口保留各自的稳定段落 ID。"""
        segment_id = f"{track}-{start_ms}"
        if segment_id in existing:
            segment_id = f"{segment_id}-{index}"
        existing.add(segment_id)
        return segment_id

    @staticmethod
    def _trim_refinement_overlap(previous, text):
        """移除相邻精修窗口因上下文重叠产生的重复前缀。"""
        for length in range(min(len(previous), len(text), 120), 2, -1):
            if previous[-length:].casefold() == text[:length].casefold():
                return text[length:].lstrip()
        return text

    @staticmethod
    def _normalized_transcript(text):
        return re.sub(r"[\W_]+", "", text).lower()

    @staticmethod
    def _clean_live_text(text):
        """移除模型终止标记，并截断流式识别末尾的重复循环。"""
        text = re.split(r"<\|endoftext\|>", str(text or ""), flags=re.IGNORECASE)[0]
        text = re.sub(r"<\|[^|>]+\|>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        words = list(re.finditer(r"[\w']+", text, flags=re.UNICODE))
        for width in range(1, min(6, len(words) // 4) + 1):
            tail = [word.group().casefold() for word in words[-width:]]
            cursor, repeats = len(words), 0
            while cursor >= width and [word.group().casefold() for word in words[cursor - width:cursor]] == tail:
                cursor, repeats = cursor - width, repeats + 1
            if repeats >= 4:
                return text[:words[cursor + width - 1].end()].rstrip(" ,;，、")
        return text

    def _is_duplicate_final(self, event):
        """过滤麦克风与系统音频对同一句话的重复识别。"""
        text = self._normalized_transcript(event["text"])
        if len(text) < 8:
            return False
        start_ms, end_ms = event["start_ms"], event["end_ms"]
        self.recent_finals = [
            item for item in self.recent_finals
            if item["end_ms"] >= start_ms - 2000 and item["start_ms"] <= end_ms + 2000
        ]
        # ponytail: text/timing heuristic; add audio fingerprinting if false matches become measurable.
        duplicate = any(
            (item["track"] != event["track"] and SequenceMatcher(None, text, item["text"]).ratio() >= 0.75)
            or (item["track"] == event["track"] and item["end_ms"] >= start_ms - 800 and SequenceMatcher(None, text, item["text"]).ratio() >= 0.92)
            for item in self.recent_finals
        )
        if not duplicate:
            self.recent_finals.append({"track": event["track"], "text": text, "start_ms": start_ms, "end_ms": end_ms})
        return duplicate

    @staticmethod
    def _detect_language(text):
        """根据首段识别文本选择中文或英文流式模型。"""
        latin = sum(character.isascii() and character.isalpha() for character in text)
        han = sum("\u4e00" <= character <= "\u9fff" for character in text)
        if latin >= 12 and latin > han * 2:
            return "en"
        if han:
            return "zh"
        return None

    @staticmethod
    def _speaker_for(start_ms, end_ms, intervals):
        """返回与目标时间窗重叠最长的说话人；完全无重叠时返回 ``None``。"""
        overlaps = [
            (min(end_ms, item["end_ms"]) - max(start_ms, item["start_ms"]), item["speaker"])
            for item in intervals
        ]
        overlap, speaker = max(overlaps, default=(0, None))
        return speaker if overlap > 0 else None

    def summarize(self, payload):
        """把逐字稿发送到用户确认的 LLM，并保存可追溯纪要。

        Args:
            payload: 会议和模型连接信息，``consent`` 必须明确为真。

        Returns:
            通过结构及证据段落校验的纪要字典。

        解析失败时仍保存供应商原始响应，避免丢失排障依据。
        """
        require(payload, "meeting_id", "provider", "endpoint", "model", "consent")
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        self.emit("summary.started", {"meeting_id": meeting["id"], "completed": 10, "total": 100, "stage": "准备逐字稿"})
        segments = latest_segments(meeting["segments"])
        transcript = "\n".join(
            f"{item['id']} [{clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
            for item in segments
        )
        schema = (
            '{"summary":"不超过120字","decisions":[{"text":"...","evidence_segment_ids":["..."]}],'
            '"action_items":[{"task":"...","owner":"...","due":null,'
            '"evidence_segment_ids":["..."]}],"open_questions":[]}'
        )
        instructions = (payload.get("prompt") or "提炼结论、决定、待办和风险；保留可追溯的来源。").strip()
        prompt = (
            f"{instructions}\n\n仅基于下方逐字稿生成会议纪要。"
            f"只输出符合此结构的 JSON：{schema}\n\n逐字稿：\n{transcript}"
        )
        try:
            self.emit("summary.progress", {"meeting_id": meeting["id"], "completed": 60, "total": 100, "stage": "正在调用纪要模型"})
            raw = self.llm_complete(payload, prompt, json_mode=True)
            data = parse_json_object(raw)
            validate_summary(data, {item["id"] for item in segments})
        except Exception as error:
            raw = locals().get("raw", str(error))
            self.store.save_summary(meeting["id"], None, raw)
            raise ValueError(f"Summary response was saved but could not be parsed: {error}") from error
        self.store.save_summary(meeting["id"], data, raw)
        self.emit("summary.progress", {"meeting_id": meeting["id"], "completed": 100, "total": 100, "stage": "正在保存纪要"})
        self.emit("summary.ready", {"meeting_id": meeting["id"], "summary": data})
        return data

    def translate(self, payload):
        """翻译一个已落库段落，并把结果写回所有同 ID 版本。

        Returns:
            可直接作为 ``translation.ready`` 事件发送的字典。
        """
        require(
            payload,
            "meeting_id",
            "segment_id",
            "target_language",
            "endpoint",
            "model",
            "consent",
        )
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        segment = next(
            (item for item in meeting["segments"] if item["id"] == payload["segment_id"]),
            None,
        )
        # The final event can reach the renderer before an overlapping task has
        # committed its segment; preserve that event instead of dropping translation.
        if not segment and payload.get("segment"):
            self.store.save_segment({
                "meeting_id": meeting["id"], "segment_id": payload["segment_id"], **payload["segment"],
            })
            meeting = self.store.get_meeting(meeting["id"])
            segment = next((item for item in meeting["segments"] if item["id"] == payload["segment_id"]), None)
        if not segment:
            raise ValueError("Transcript segment not found")
        translation = self.llm_complete(
            payload,
            f"Translate the following text to {payload['target_language']}. "
            f"Return only the translation.\n\n{segment['text']}",
        ).strip()
        self.store.save_translation(meeting["id"], segment["id"], translation)
        event = {
            "meeting_id": meeting["id"],
            "segment_id": segment["id"],
            "translation": translation,
        }
        self.emit("translation.ready", event)
        return event

    def _active(self, meeting_id):
        """确认命令指向当前活动会议，无返回值。"""
        if meeting_id != self.active:
            raise ValueError("Meeting is not active")


def main():
    """运行 stdin/stdout JSONL 循环；单条命令失败不会终止 Worker。"""
    worker = Worker()
    def respond(command):
        try:
            worker.response(command.get("id"), worker.handle(command))
        except Exception as error:
            worker.response(command.get("id"), error=error)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            command = json.loads(line)
        except Exception as error:
            worker.response(None, error=error)
            continue
        # Keep long-running work and voiceprint SQLite writes off the command loop.
        if command.get("type") in {
            "meeting.refine", "meeting.separate", "translation.generate",
            "speaker-profile.list", "speaker-profile.samples", "speaker-profile.sample-delete",
            "summary.generate", "tts.synthesize", "speaker-profile.enroll", "speaker-profile.verify",
            "speaker.rename", "segment.speaker", "segment.speaker-profile-sample", "meeting.export", "meeting.bundle",
        }:
            threading.Thread(target=respond, args=(command,), daemon=True).start()
        else:
            respond(command)


if __name__ == "__main__":
    main()
