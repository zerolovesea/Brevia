"""声纹注册、验证与会议标注的本地服务。"""

import json
import shutil
import tempfile
import time
from pathlib import Path

from .audio_io import convert_to_pcm_wav, read_mono_wav
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
        profile = self.store.save_speaker_profile_sample(payload["name"], embedding, source_key, payload.get("profile_id"))
        reference_text = (payload.get("reference_text") or "").strip()
        if reference_text:
            directory = self.store.speaker_profiles_dir / profile["id"]
            directory.mkdir(parents=True, exist_ok=True)
            reference_audio = directory / f"{int(time.time() * 1000)}.wav"
            # 保存统一采样率版本，既可作嵌入模型输入，也可作 ZipVoice 参考音频。
            convert_to_pcm_wav(source, reference_audio)
            profile = self.store.save_speaker_profile_sample(
                payload["name"], embedding, source_key, profile["id"], str(reference_audio), reference_text
            )
        return profile

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
        """仅学习人工改名后的片段，防止未确认的聚类污染声纹中心。"""
        profile = self.store.ensure_speaker_profile(name)
        try:
            tracker = SpeakerTracker(self.models, model_id=meeting.get("speaker_embedding_model_id"))
        except RuntimeError:
            return profile
        cached, latest = {}, {}
        for segment in meeting["segments"]:
            if segment["speaker"] == speaker_id and segment["version"] in {"live", "postprocess"}:
                latest[segment["id"]] = segment
        for segment in sorted(latest.values(), key=lambda item: item["start_ms"])[:12]:
            path = meeting["audio"]["playback"].get(segment["track"])
            if not path or not Path(path).exists():
                continue
            cached.setdefault(path, read_mono_wav(path))
            samples, rate = cached[path]
            clip = samples[round(segment["start_ms"] * rate / 1000):round(segment["end_ms"] * rate / 1000)]
            embedding = tracker.embedding(clip, rate)
            if embedding is not None:
                profile = self.store.save_speaker_profile_sample(name, embedding, f"meeting:{meeting['id']}:{speaker_id}:{segment['track']}:{segment['start_ms']}:{segment['end_ms']}", profile["id"])
        return profile

    @staticmethod
    def _samples(source):
        with tempfile.TemporaryDirectory() as directory:
            wav = Path(directory) / "voice.wav"
            convert_to_pcm_wav(source, wav)
            return read_mono_wav(wav)
