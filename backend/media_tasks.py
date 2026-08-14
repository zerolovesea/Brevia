"""会后媒体任务：不修改原录音的分离。"""

from .asr import SourceSeparator
from .audio_io import (
    convert_to_pcm_wav,
    ensure_wav_duration,
    read_wav_channels,
    write_wav_channels,
)


class MeetingMediaService:
    """管理长耗时媒体任务的文件边界，Worker 只负责发布事件。"""

    def __init__(self, store, models):
        self.store = store
        self.models = models

    def separate(self, meeting, progress=lambda *_: None):
        """返回新生成的人声与非人声文件；原始回放轨保持不变。"""
        source = next(
            (
                meeting["audio"]["playback"].get(track)
                for track in ("mix", "mic", "system")
                if meeting["audio"]["playback"].get(track)
            ),
            None,
        )
        if not source:
            raise ValueError("The meeting has no audio to separate")
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        input_path = directory / "source-separation-input.wav"
        try:
            progress(10, "preparing")
            convert_to_pcm_wav(source, input_path, sample_rate=44100, channels=2)
            progress(25, "reading")
            ensure_wav_duration(input_path, 15 * 60, "separate")
            samples, sample_rate = read_wav_channels(input_path)
            progress(35, "separating")
            result = SourceSeparator(self.models).process(samples, sample_rate)
            vocals, accompaniment = (
                directory / "separated-vocals.wav",
                directory / "separated-accompaniment.wav",
            )
            progress(85, "writing")
            write_wav_channels(vocals, result.stems[0].data, result.sample_rate)
            progress(95, "writing")
            write_wav_channels(accompaniment, result.stems[1].data, result.sample_rate)
            progress(100, "complete")
            return {
                "meeting_id": meeting["id"],
                "vocals_path": str(vocals),
                "accompaniment_path": str(accompaniment),
            }
        finally:
            input_path.unlink(missing_ok=True)
