"""精修模型对比评估工具（开发用，不随应用发布）。

在若干真实会议录音上对多个精修模型（Qwen3-ASR 0.6B / 1.7B、FunASR Nano）
采样解码，统计执行耗时、幻觉伪影率、重复循环率，用于选型与调参。

用法::

    python -m backend.diagnose_models \
        --meeting a8678397-6397-4c51-9e1d-dca629c3476f \
        --models qwen3-asr-0.6b-int8,qwen3-asr-1.7b-int8,funasr-nano-int8

不传 --meeting 时自动评估数据目录下所有含麦克风录音的会议（前若干条）。
"""

import argparse
import re
import statistics
import time
from pathlib import Path

from .asr import ModelManager, RefinedASR
from .audio_io import read_mono_wav_window
from .config import SETTINGS
from .worker_refinement import RefinementWorkerMixin

ARTIFACT_RE = re.compile(r"```|`\(|language\s*=?\s*[A-Za-z]+|\*\*")


def quality(text):
    """返回 (是否幻觉, 是否重复循环, 有效字符数)。"""
    cleaned = RefinementWorkerMixin._clean_live_text(text)
    has_artifact = bool(ARTIFACT_RE.search(text))
    has_loop = len(text) > 80 and len(set(re.findall(r"[\u4e00-\u9fff]+", text))) <= 4
    chars = len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", cleaned))
    return has_artifact, has_loop, chars


def evaluate(manager, model_id, language, windows):
    recognizer = RefinedASR(manager, model_id, language=language)
    results = []
    for start_ms, end_ms, path in windows:
        samples, sample_rate = read_mono_wav_window(path, start_ms, end_ms)
        t0 = time.time()
        text, _ = recognizer.decode_words(samples, sample_rate)
        elapsed = time.time() - t0
        has_artifact, has_loop, chars = quality(text)
        results.append((elapsed, has_artifact, has_loop, chars))
    return results


def list_recordings(root):
    recordings = []
    meetings = (root / "meetings").iterdir()
    for meeting in meetings:
        mic = meeting / "audio" / "playback-mic.wav"
        if not mic.exists():
            continue
        recordings.append(mic)
    return recordings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path.home() / "brevia"))
    parser.add_argument("--meeting", default=None)
    parser.add_argument("--models", default="qwen3-asr-0.6b-int8,funasr-nano-int8")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--step-seconds", type=int, default=90)
    parser.add_argument("--window-seconds", type=int, default=15)
    parser.add_argument("--max-windows", type=int, default=30)
    args = parser.parse_args()

    root = Path(args.root)
    if args.meeting:
        paths = [root / "meetings" / args.meeting / "audio" / "playback-mic.wav"]
    else:
        paths = list_recordings(root)[:5]
    paths = [p for p in paths if p.exists()]

    manager = ModelManager(str(root / "models"))
    model_ids = [m for m in args.models.split(",") if m]

    for path in paths:
        import wave
        with wave.open(str(path)) as w:
            duration_ms = w.getnframes() * 1000 // w.getframerate()
        windows = [
            (s, min(s + args.window_seconds * 1000, duration_ms), str(path))
            for s in range(0, duration_ms, args.step_seconds * 1000)
        ][: args.max_windows]
        print(f"\n=== {path.name} ({duration_ms // 1000}s, {len(windows)} 窗口) ===")
        for model_id in model_ids:
            t0 = time.time()
            try:
                results = evaluate(manager, model_id, args.language, windows)
            except Exception as error:
                print(f"  {model_id}: 失败 {type(error).__name__}: {error}")
                continue
            load_and_decode = time.time() - t0
            times = [r[0] for r in results]
            artifacts = sum(1 for r in results if r[1])
            loops = sum(1 for r in results if r[2])
            empties = sum(1 for r in results if r[3] == 0)
            avg_chars = statistics.mean(r[3] for r in results)
            print(
                f"  {model_id:24s} 平均 {statistics.mean(times):5.1f}s/窗 "
                f"(总 {load_and_decode:.0f}s) | 伪影 {artifacts}/{len(results)} "
                f"重复 {loops} 空 {empties} | 平均 {avg_chars:.0f} 字符"
            )


if __name__ == "__main__":
    main()
