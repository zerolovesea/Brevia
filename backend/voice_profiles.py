"""声纹注册、验证与会议标注的本地服务。"""

import json
import re
import shutil
import tempfile
import time
from pathlib import Path

from .audio_io import convert_to_pcm_wav, read_mono_wav, write_mono_wav
from .asr import SpeakerTracker
from .config import SETTINGS


class VoiceProfileService:
    """协调模型与 Store，保持 Worker 不承载声纹库细节。"""

    def __init__(self, store, models):
        self.store = store
        self.models = models

    def enroll(self, payload):
        """提取声纹并可选保存克隆所需的本地参考音频与文字。"""
        source = Path(payload["path"])
        if not source.is_file():
            raise ValueError("Audio file not found")
        samples, sample_rate = self._samples(source)
        embedding = SpeakerTracker(self.models, model_id=payload.get("embedding_model_id")).embedding(samples, sample_rate)
        if embedding is None:
            raise ValueError("Voice sample is too short for speaker registration")
        source_key = f"file:{source.resolve()}:{source.stat().st_mtime_ns}:{source.stat().st_size}"
        reference_text = (payload.get("reference_text") or "").strip()
        profile = self.store.ensure_speaker_profile(payload["name"]) if not payload.get("profile_id") else self.store.speaker_profile(payload["profile_id"])
        directory = self.store.speaker_profiles_dir / profile["id"]
        directory.mkdir(parents=True, exist_ok=True)
        reference_audio = directory / f"{int(time.time() * 1000)}.wav"
        convert_to_pcm_wav(source, reference_audio)
        try:
            return self.store.save_speaker_profile_sample(
                payload["name"], embedding, source_key, profile["id"], str(reference_audio),
                reference_text, round(len(samples) * 1000 / sample_rate),
            )
        except Exception:
            reference_audio.unlink(missing_ok=True)
            raise

    def verify(self, payload):
        """对临时选择的录音打分；验证音频不会保存到声纹库。"""
        source = Path(payload["path"])
        if not source.is_file():
            raise ValueError("Audio file not found")
        samples, sample_rate = self._samples(source)
        embedding = SpeakerTracker(self.models, model_id=payload.get("embedding_model_id")).embedding(samples, sample_rate)
        if embedding is None:
            raise ValueError("Voice sample is too short for verification")
        profile = self.store.speaker_profile(payload["profile_id"])
        candidate, reference = self.store._normalized_embedding(embedding), json.loads(profile["embedding"])
        if len(candidate) != len(reference):
            raise ValueError("Voiceprint model does not match this person's registered samples")
        score = sum(left * right for left, right in zip(candidate, reference))
        return {"profile_id": profile["id"], "name": profile["name"], "score": score, "verified": score >= SETTINGS["diarization"]["online_similarity_threshold"]}

    def learn_from_meeting(self, meeting, speaker_id, name):
        """按句保存人工命名说话人的录音，并增量更新声纹中心。"""
        profile = self.store.ensure_speaker_profile(name)
        try:
            tracker = SpeakerTracker(self.models, model_id=meeting.get("speaker_embedding_model_id"))
        except RuntimeError:
            return profile
        archived = self.store.list_speaker_profile_samples(profile["id"])
        existing = {sample["source_key"] for sample in archived}
        count = len(archived)
        total_ms = sum(sample["duration_ms"] for sample in archived)
        limits = SETTINGS["voice_profiles"]
        cached, latest = {}, {}
        for segment in meeting["segments"]:
            if segment["speaker"] != speaker_id or (segment["version"] != "live" and not segment["version"].startswith("postprocess")):
                continue
            previous = latest.get(segment["id"])
            if previous is None or segment["version"].startswith("postprocess") and (previous["version"] == "live" or segment["revision"] >= previous["revision"]):
                latest[segment["id"]] = segment
        for segment in sorted(latest.values(), key=lambda item: item["start_ms"]):
            path = meeting["audio"]["playback"].get(segment["track"])
            if not path or not Path(path).exists():
                continue
            cached.setdefault(path, read_mono_wav(path))
            samples, rate = cached[path]
            sentences = self._sentences(segment["text"])
            characters = sum(len(sentence) for sentence in sentences)
            cursor = segment["start_ms"]
            segment_clip = samples[round(segment["start_ms"] * rate / 1000):round(segment["end_ms"] * rate / 1000)]
            fallback_embedding = tracker.embedding(segment_clip, rate)
            for index, sentence in enumerate(sentences):
                end_ms = segment["end_ms"] if index == len(sentences) - 1 else cursor + round(
                    (segment["end_ms"] - segment["start_ms"]) * len(sentence) / characters
                )
                source_key = f"meeting:{meeting['id']}:{speaker_id}:{segment['id']}:{index}"
                duration_ms = max(0, end_ms - cursor)
                if source_key in existing:
                    cursor = end_ms
                    continue
                if count >= limits["max_samples"] or total_ms + duration_ms > limits["max_total_seconds"] * 1000:
                    return profile
                clip = samples[round(cursor * rate / 1000):round(end_ms * rate / 1000)]
                embedding = tracker.embedding(clip, rate)
                if embedding is None:
                    embedding = fallback_embedding
                if embedding is None:
                    cursor = end_ms
                    continue
                directory = self.store.speaker_profiles_dir / profile["id"]
                directory.mkdir(parents=True, exist_ok=True)
                audio_path = directory / f"{meeting['id']}-{segment['start_ms']}-{index}.wav"
                write_mono_wav(audio_path, clip, rate)
                try:
                    profile = self.store.save_speaker_profile_sample(
                        name, embedding, source_key, profile["id"], str(audio_path), sentence, duration_ms
                    )
                except Exception:
                    audio_path.unlink(missing_ok=True)
                    raise
                existing.add(source_key)
                count += 1
                total_ms += duration_ms
                cursor = end_ms
        return profile

    def seed_builtin_profiles(self):
        """用随应用发布的双人示例录音提供一男一女两个默认声纹。"""
        model_id = SETTINGS["diarization"]["embedding_model_id"]
        if not self.models.is_ready(model_id):
            return
        source = Path(__file__).with_name("fixtures") / "example-zh.wav"
        if not source.is_file():
            return
        samples, rate = read_mono_wav(source)
        tracker = SpeakerTracker(self.models, model_id=model_id)
        # ponytail: bundled demo speakers seed defaults; replace fixtures when branded voices are recorded.
        for key, name, start_ms, end_ms, text in (
            ("builtin:male", "内置男声", 0, 5016, "大家早上好，今天我们确认新用户引导的上线范围。"),
            ("builtin:female", "内置女声", 5016, 9102, "设计稿已经完成，开发团队周四可以交付测试版本。"),
        ):
            if any(sample["source_key"] == key for profile in self.store.list_speaker_profiles() for sample in self.store.list_speaker_profile_samples(profile["id"])):
                continue
            clip = samples[round(start_ms * rate / 1000):round(end_ms * rate / 1000)]
            embedding = tracker.embedding(clip, rate)
            if embedding is None:
                continue
            profile = self.store.ensure_speaker_profile(name)
            directory = self.store.speaker_profiles_dir / profile["id"]
            directory.mkdir(parents=True, exist_ok=True)
            audio_path = directory / f"{key.split(':')[1]}.wav"
            write_mono_wav(audio_path, clip, rate)
            self.store.save_speaker_profile_sample(
                name, embedding, key, profile["id"], str(audio_path), text, end_ms - start_ms
            )

    @staticmethod
    def _sentences(text):
        """按中英文句末标点拆分，未带标点的段落仍作为一句。"""
        return [part.strip() for part in re.split(r"(?<=[。！？.!?])\s*", text.strip()) if part.strip()]

    @staticmethod
    def _samples(source):
        with tempfile.TemporaryDirectory() as directory:
            wav = Path(directory) / "voice.wav"
            convert_to_pcm_wav(source, wav)
            return read_mono_wav(wav)
