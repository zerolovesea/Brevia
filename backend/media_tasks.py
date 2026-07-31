"""会后媒体任务：不修改原录音的分离和语音合成。"""

import time
from pathlib import Path

from .asr import SourceSeparator, ZipVoiceTTS
from .audio_io import convert_to_pcm_wav, read_mono_wav, read_wav_channels, write_mono_wav, write_wav_channels


class MeetingMediaService:
    """管理长耗时媒体任务的文件边界，Worker 只负责发布事件。"""

    def __init__(self, store, models):
        self.store = store
        self.models = models

    def separate(self, meeting, progress=lambda *_: None):
        """返回新生成的人声与非人声文件；原始回放轨保持不变。"""
        source = next((meeting["audio"]["playback"].get(track) for track in ("mix", "mic", "system") if meeting["audio"]["playback"].get(track)), None)
        if not source:
            raise ValueError("The meeting has no audio to separate")
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        input_path = directory / "source-separation-input.wav"
        progress(10, "preparing")
        convert_to_pcm_wav(source, input_path, sample_rate=44100, channels=2)
        progress(25, "reading")
        samples, sample_rate = read_wav_channels(input_path)
        progress(35, "separating")
        result = SourceSeparator(self.models).process(samples, sample_rate)
        vocals, accompaniment = directory / "separated-vocals.wav", directory / "separated-accompaniment.wav"
        progress(85, "writing")
        write_wav_channels(vocals, result.stems[0].data, result.sample_rate)
        progress(95, "writing")
        write_wav_channels(accompaniment, result.stems[1].data, result.sample_rate)
        input_path.unlink(missing_ok=True)
        progress(100, "complete")
        return {"meeting_id": meeting["id"], "vocals_path": str(vocals), "accompaniment_path": str(accompaniment)}

    def synthesize(self, payload):
        """用已注册人员最新的带文本参考音频生成本地 ZipVoice 音频。"""
        if payload["language"] not in {"zh", "en"}:
            raise ValueError("ZipVoice supports Chinese and English")
        text = payload["text"].strip()
        if not text or len(text) > 1000:
            raise ValueError("TTS text must contain 1–1000 characters")
        reference = self._voice_reference(payload["voice_id"])
        samples, sample_rate = read_mono_wav(reference["audio_path"])
        audio = ZipVoiceTTS(self.models).generate(text, samples, sample_rate, reference["reference_text"])
        if not len(audio.samples):
            raise ValueError("ZipVoice did not generate audio")
        directory = self.store.root / "tts"
        directory.mkdir(exist_ok=True)
        path = directory / f"{int(time.time() * 1000)}.wav"
        write_mono_wav(path, audio.samples, audio.sample_rate)
        return {"path": str(path), "voice_id": payload["voice_id"], "text": text}

    def preset_voices(self):
        """公开 ZipVoice 自带且有已知参考文本的本地样例声音。"""
        path = self.models.path("zipvoice-zh-en") / "test_wavs" / "leijun-1.wav"
        return [{"id": "preset:leijun-1", "name": "ZipVoice · Lei Jun", "audio_path": str(path)}] if self.models.is_ready("zipvoice-zh-en") and path.is_file() else []

    def _voice_reference(self, voice_id):
        if voice_id == "preset:leijun-1":
            preset = self.preset_voices()
            if not preset:
                raise ValueError("ZipVoice preset voice is unavailable")
            return {"audio_path": preset[0]["audio_path"], "reference_text": "那还是三十六年前, 一九八七年. 我呢考上了武汉大学的计算机系."}
        return self.store.speaker_profile_reference(voice_id)
