"""会后精修 VAD 分片调试工具（开发用，不随应用发布）。

对比默认 VAD 参数与中文 VAD 参数在一条录音上的分段粒度，并推演经过
说话人稳定化与精修窗口组装后的最终段落数，用于验证中文独立参数的
去碎片效果。

用法::

    python -m backend.diagnose_refinement_vad \
        /path/to/meeting/audio/playback-mic.wav

未传路径时默认使用示例路径（需手动修改 DEFAULT_TRACK 为实际会议）。
"""

import argparse
import os
import statistics
from pathlib import Path

from .asr import ModelManager, OfflineVAD
from .config import SETTINGS
from .worker_refinement import RefinementWorkerMixin

# 开发默认路径 - 使用前请修改为实际会议 ID
DEFAULT_TRACK = (
    Path.home()
    / "brevia"
    / "meetings"
    / "CHANGE-ME-TO-YOUR-MEETING-ID"  # 例如: a8678397-6397-4c51-9e1d-dca629c3476f
    / "audio"
    / "playback-mic.wav"
)


def summarize(label, speech, sample_rate):
    durations = [turn["end_ms"] - turn["start_ms"] for turn in speech]
    gaps = [
        speech[index + 1]["start_ms"] - speech[index]["end_ms"]
        for index in range(len(speech) - 1)
    ]
    total_speech = sum(durations)
    print(f"[{label}]")
    print(f"  语音段数: {len(speech)}")
    print(f"  总语音时长: {total_speech / 1000:.1f}s")
    print(
        "  段长(ms) min/median/mean/max: "
        f"{min(durations) if durations else 0}/"
        f"{int(statistics.median(durations)) if durations else 0}/"
        f"{int(statistics.mean(durations)) if durations else 0}/"
        f"{max(durations) if durations else 0}"
    )
    print(
        "  静默间隙(ms) min/median/max: "
        f"{min(gaps) if gaps else 0}/"
        f"{int(statistics.median(gaps)) if gaps else 0}/"
        f"{max(gaps) if gaps else 0}"
    )
    return durations


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", nargs="?", type=Path, default=DEFAULT_TRACK)
    parser.add_argument("--models-dir", default=os.environ.get("BREVIA_MODELS_DIR") or str(Path.home() / "brevia" / "models"))
    args = parser.parse_args()

    manager = ModelManager(args.models_dir)
    from .audio_io import read_mono_wav

    samples, sample_rate = read_mono_wav(args.wav)
    print(f"录音: {args.wav}")
    print(f"时长: {len(samples) / sample_rate:.1f}s (sample_rate={sample_rate})")

    default_params = (SETTINGS.get("vad") or {}).get("default") or {}
    zh_params = (SETTINGS.get("vad") or {}).get("zh") or {}
    print(f"\n默认参数: {default_params}")
    print(f"中文参数: {zh_params}\n")

    for label, params in (("default", default_params), ("zh", zh_params)):
        vad = OfflineVAD(manager, "silero-vad", vad_params=params)
        speech = vad.process(samples, sample_rate)
        durations = summarize(label, speech, sample_rate)

        # 模拟 mic/local-user 单说话人路径的稳定化与窗口组装。
        turns = [{**turn, "speaker": "local-user"} for turn in speech]
        stable = RefinementWorkerMixin._stabilize_speaker_turns(turns)
        windows = RefinementWorkerMixin._refinement_turns(
            stable, len(samples) * 1000 // sample_rate, SETTINGS["asr"]["refined_window_seconds"] * 1000
        )
        print(f"  稳定化后 turn 数: {len(stable)}")
        print(f"  精修窗口数(最终段落数): {len(windows)}")
        print()


if __name__ == "__main__":
    main()
