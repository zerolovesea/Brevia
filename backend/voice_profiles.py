"""声纹注册、验证与会议标注的本地服务。"""

import json
import re
import tempfile
import time
from pathlib import Path

from .audio_io import convert_to_pcm_wav, read_mono_wav, write_mono_wav
from .asr import SpeakerTracker
from .config import SETTINGS
from .transcript import subtitle_time_at_offset


class VoiceProfileService:
    """协调模型与 Store，保持 Worker 不承载声纹库细节。"""

    def __init__(self, store, models):
        self.store = store
        self.models = models

    def enroll(self, payload):
        """提取声纹并保存用于后续验证的本地录音。"""
        source = Path(payload["path"])
        if not source.is_file():
            raise ValueError("Audio file not found")
        samples, sample_rate = self._samples(source)
        embedding = SpeakerTracker(self.models).embedding(samples, sample_rate)
        if embedding is None:
            raise ValueError("Voice sample is too short for speaker registration")
        source_key = f"file:{source.resolve()}:{source.stat().st_mtime_ns}:{source.stat().st_size}"
        profile = (
            self.store.ensure_speaker_profile(payload["name"])
            if not payload.get("profile_id")
            else self.store.speaker_profile(payload["profile_id"])
        )
        directory = self.store.speaker_profiles_dir / profile["id"]
        directory.mkdir(parents=True, exist_ok=True)
        sample_audio = directory / f"{int(time.time() * 1000)}.wav"
        convert_to_pcm_wav(source, sample_audio)
        try:
            return self.store.save_speaker_profile_sample(
                payload["name"],
                embedding,
                source_key,
                profile["id"],
                str(sample_audio),
                round(len(samples) * 1000 / sample_rate),
            )
        except Exception:
            sample_audio.unlink(missing_ok=True)
            raise

    def verify(self, payload):
        """对临时选择的录音打分；验证音频不会保存到声纹库。"""
        source = Path(payload["path"])
        if not source.is_file():
            raise ValueError("Audio file not found")
        samples, sample_rate = self._samples(source)
        embedding = SpeakerTracker(self.models).embedding(samples, sample_rate)
        if embedding is None:
            raise ValueError("Voice sample is too short for verification")
        profile = self.store.speaker_profile(payload["profile_id"])
        candidate, reference = (
            self.store._normalized_embedding(embedding),
            json.loads(profile["embedding"]),
        )
        if len(candidate) != len(reference):
            raise ValueError(
                "Voiceprint model does not match this person's registered samples"
            )
        score = sum(left * right for left, right in zip(candidate, reference))
        return {
            "profile_id": profile["id"],
            "name": profile["name"],
            "score": score,
            "verified": score >= SETTINGS["diarization"]["online_similarity_threshold"],
        }

    def learn_from_meeting(
        self, meeting, speaker_id, name, segment_ids=None, source_id=None
    ):
        """按句保存用户明确选择的会议录音，并增量更新声纹中心。"""
        profile = self.store.ensure_speaker_profile(name)
        try:
            tracker = SpeakerTracker(self.models)
        except RuntimeError:
            return profile
        archived = self.store.list_speaker_profile_samples(profile["id"])
        existing = {sample["source_key"] for sample in archived}
        count = len(archived)
        total_ms = sum(sample["duration_ms"] for sample in archived)
        limits = SETTINGS["voice_profiles"]
        cached, latest = {}, {}
        for segment in meeting["segments"]:
            if (
                (speaker_id is not None and segment["speaker"] != speaker_id)
                or (segment_ids is not None and segment["id"] not in segment_ids)
                or (
                    segment["version"] != "live"
                    and not segment["version"].startswith("postprocess")
                )
            ):
                continue
            previous = latest.get(segment["id"])
            if (
                previous is None
                or segment["version"].startswith("postprocess")
                and (
                    previous["version"] == "live"
                    or segment["revision"] >= previous["revision"]
                )
            ):
                latest[segment["id"]] = segment
        for segment in sorted(latest.values(), key=lambda item: item["start_ms"]):
            path = meeting["audio"]["playback"].get(segment["track"])
            if not path or not Path(path).exists():
                continue
            cached.setdefault(path, read_mono_wav(path))
            samples, rate = cached[path]
            text = segment["text"] or ""
            sentences = self._sentences(text)
            boundaries = self._sentence_boundaries(segment, text, sentences)
            cursor = segment["start_ms"]
            segment_clip = samples[
                round(segment["start_ms"] * rate / 1000) : round(
                    segment["end_ms"] * rate / 1000
                )
            ]
            fallback_embedding = tracker.embedding(segment_clip, rate)
            for index, sentence in enumerate(sentences):
                end_ms = boundaries[index]
                source_key = f"meeting:{meeting['id']}:{source_id or speaker_id}:{segment['id']}:{index}"
                duration_ms = max(0, end_ms - cursor)
                if source_key in existing:
                    cursor = end_ms
                    continue
                if (
                    count >= limits["max_samples"]
                    or total_ms + duration_ms > limits["max_total_seconds"] * 1000
                ):
                    return profile
                clip = samples[
                    round(cursor * rate / 1000) : round(end_ms * rate / 1000)
                ]
                embedding = tracker.embedding(clip, rate)
                if embedding is None:
                    embedding = fallback_embedding
                if embedding is None:
                    cursor = end_ms
                    continue
                directory = self.store.speaker_profiles_dir / profile["id"]
                directory.mkdir(parents=True, exist_ok=True)
                audio_path = (
                    directory / f"{meeting['id']}-{segment['start_ms']}-{index}.wav"
                )
                write_mono_wav(audio_path, clip, rate)
                try:
                    profile = self.store.save_speaker_profile_sample(
                        name,
                        embedding,
                        source_key,
                        profile["id"],
                        str(audio_path),
                        duration_ms,
                    )
                except Exception:
                    audio_path.unlink(missing_ok=True)
                    raise
                existing.add(source_key)
                count += 1
                total_ms += duration_ms
                cursor = end_ms
        return profile

    @staticmethod
    def _sentences(text):
        """按中英文句末标点拆分，未带标点的段落仍作为一句。"""
        return [
            part.strip()
            for part in re.split(r"(?<=[。！？.!?])\s*", text.strip())
            if part.strip()
        ]

    @classmethod
    def _sentence_boundaries(cls, segment, text, sentences):
        """每句样本在音频时间轴上的结束点（含句末标点），与句子一一对应。

        有词级时间戳、且句子能在原文里顺序定位时，句间切点取自真实的发音时刻（与字幕
        切分共用 :func:`transcript.subtitle_time_at_offset` 的锚点映射）；否则退回按句子字数比例
        估时。整段的起止两端始终取自 ``segment``，不受影响。
        """
        if not sentences:
            return []
        start_ms, end_ms = segment["start_ms"], segment["end_ms"]
        total = sum(len(sentence) for sentence in sentences)
        if not total:
            return [end_ms] * len(sentences)
        # 兜底：累计字数比例，逐句 round 后累加——与引入词级对齐前的取值完全一致。
        fallback, cursor = [], start_ms
        for sentence in sentences[:-1]:
            cursor += round((end_ms - start_ms) * len(sentence) / total)
            fallback.append(cursor)
        fallback.append(end_ms)
        if not segment.get("word_timestamps"):
            return fallback
        offsets, position, located = [], 0, True
        for sentence in sentences[:-1]:
            index = text.find(sentence, position)
            if index < 0:
                located = False
                break
            position = index + len(sentence)
            offsets.append(position)
        if not located:
            return fallback
        boundaries, previous = [], start_ms
        for offset in offsets:
            time = max(previous, min(subtitle_time_at_offset(segment, text, offset), end_ms))
            boundaries.append(time)
            previous = time
        boundaries.append(end_ms)
        return boundaries

    @staticmethod
    def _samples(source):
        """从任意音频文件转换并读取为单声道 PCM16 样本。"""
        with tempfile.TemporaryDirectory() as directory:
            wav = Path(directory) / "voice.wav"
            convert_to_pcm_wav(source, wav)
            return read_mono_wav(wav)
