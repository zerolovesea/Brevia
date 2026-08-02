#!/usr/bin/env python3
"""用官方四人音频检查 diarization 模型下载、加载和聚类结果。"""

import argparse
import json
import time
import urllib.request
from pathlib import Path

from .audio_io import read_mono_wav
from .asr import ModelManager, OfflineDiarizer


TEST_WAV = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/0-four-speakers-zh.wav"
MODEL_IDS = ("pyannote-segmentation-3.0", "eres2net-base-3dspeaker-zh")


def main():
    """执行说话人聚类诊断。

    入参来自 argparse：模型目录、可选 WAV、是否下载和预期人数。成功时输出
    说话人列表、时间段数量、耗时和 RTF 的 JSON；人数不符时抛出错误。
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--wav")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--num-speakers", type=int, default=4)
    args = parser.parse_args()

    manager = ModelManager(args.models_dir)
    if args.download:
        for model_id in MODEL_IDS:
            manager.download(model_id)
    wav_path = (
        Path(args.wav) if args.wav else Path(args.models_dir) / "0-four-speakers-zh.wav"
    )
    if not wav_path.exists():
        urllib.request.urlretrieve(TEST_WAV, wav_path)
    samples, sample_rate = read_mono_wav(wav_path)
    started = time.perf_counter()
    turns = OfflineDiarizer(manager, args.num_speakers).process(samples, sample_rate)
    elapsed = time.perf_counter() - started
    speakers = sorted({turn["speaker"] for turn in turns})
    if len(speakers) != args.num_speakers:
        raise RuntimeError(
            f"Expected {args.num_speakers} speakers, got {len(speakers)}"
        )
    print(
        json.dumps(
            {
                "speakers": speakers,
                "turns": len(turns),
                "audio_seconds": round(len(samples) / sample_rate, 2),
                "elapsed_seconds": round(elapsed, 2),
                "rtf": round(elapsed * sample_rate / len(samples), 3),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
