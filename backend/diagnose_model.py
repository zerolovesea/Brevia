"""下载并用随模型提供的 WAV 检查 ASR 可加载性与实时系数。"""

import argparse
import json
import time
import wave
import numpy

from .asr import ModelManager, RefinedASR
from .config import SETTINGS


def main():
    """执行命令行诊断。

    入参来自 argparse：模型目录、模型 ID，以及是否允许下载。成功时向 stdout
    输出识别文本、音频时长、耗时和 RTF 的 JSON；空结果以非零状态退出。
    """
    parser = argparse.ArgumentParser(
        description="Download and diagnose a Brevia sentence model"
    )
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--model-id", default="funasr-nano-int8")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    manager = ModelManager(args.models_dir)
    if args.download:
        manager.download(args.model_id)
    wav_path = next((manager.path(args.model_id) / "test_wavs").glob("*.wav"))
    with wave.open(str(wav_path)) as recording:
        sample_rate = recording.getframerate()
        samples = (
            numpy.frombuffer(
                recording.readframes(recording.getnframes()), dtype=numpy.int16
            ).astype(numpy.float32)
            / 32768
        )
    started = time.perf_counter()
    samples = samples[: sample_rate * SETTINGS["asr"]["refined_window_seconds"]]
    finals = [RefinedASR(manager, args.model_id).decode(samples, sample_rate)]
    elapsed = time.perf_counter() - started
    result = {
        "model_id": args.model_id,
        "text": "".join(finals),
        "audio_seconds": round(len(samples) / sample_rate, 3),
        "elapsed_seconds": round(elapsed, 3),
        "rtf": round(elapsed / (len(samples) / sample_rate), 3),
    }
    print(json.dumps(result, ensure_ascii=False))
    if not result["text"]:
        raise SystemExit("Model returned no text")


if __name__ == "__main__":
    main()
