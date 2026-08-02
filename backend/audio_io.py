"""本地音频文件与波形转换的公共边界。

这里不依赖数据库或模型，避免录制、精修、声纹注册各自实现一套 PCM
转换。所有函数只处理临时文件或调用方传入的目标路径，不会改写原录音。
"""

import os
import shutil
import subprocess
import wave
def ffmpeg_path():
    """返回显式配置或 PATH 中的 ffmpeg；缺失时给出统一错误。"""
    executable = os.environ.get("BREVIA_FFMPEG") or shutil.which("ffmpeg")
    if not executable:
        raise ValueError("ffmpeg is required for audio processing")
    return executable


def convert_to_pcm_wav(source, destination, sample_rate=16000, channels=1):
    """转为模型可预测的 PCM16 WAV，供临时推理使用。"""
    subprocess.run(
        [ffmpeg_path(), "-y", "-loglevel", "error", "-i", str(source), "-ar", str(sample_rate),
         "-ac", str(channels), "-c:a", "pcm_s16le", str(destination)],
        check=True,
    )


def read_mono_wav(path):
    """读取单声道 PCM16 WAV，返回归一化 float32 与采样率。"""
    import numpy

    with wave.open(str(path)) as recording:
        if recording.getnchannels() != 1 or recording.getsampwidth() != 2:
            raise ValueError("This operation requires mono PCM16 WAV audio")
        samples = numpy.frombuffer(recording.readframes(recording.getnframes()), dtype="<i2")
        return samples.astype(numpy.float32) / 32768.0, recording.getframerate()


def write_mono_wav(path, samples, sample_rate):
    """写入单声道 PCM16 WAV；浮点振幅先限幅以防止溢出失真。"""
    import numpy

    values = numpy.clip(samples, -1, 1)
    with wave.open(str(path), "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(sample_rate)
        recording.writeframes((values * 32767).astype("<i2").tobytes())


def read_wav_channels(path):
    """读取 PCM16 WAV 为 ``(channels, samples)``，符合 Sherpa 分离器输入。"""
    import numpy

    with wave.open(str(path)) as recording:
        if recording.getsampwidth() != 2:
            raise ValueError("Source separation requires PCM16 WAV audio")
        channels = recording.getnchannels()
        values = numpy.frombuffer(recording.readframes(recording.getnframes()), dtype="<i2")
        return values.astype(numpy.float32).reshape(-1, channels).T.copy() / 32768.0, recording.getframerate()


def write_wav_channels(path, samples, sample_rate):
    """把 ``(channels, samples)`` 波形写回标准交错 PCM16 WAV。"""
    import numpy

    values = numpy.clip(numpy.asarray(samples).T, -1, 1)
    with wave.open(str(path), "wb") as recording:
        recording.setnchannels(values.shape[1])
        recording.setsampwidth(2)
        recording.setframerate(sample_rate)
        recording.writeframes((values * 32767).astype("<i2").tobytes())
