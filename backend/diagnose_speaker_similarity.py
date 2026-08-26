"""测量一条音轨各语音段的声纹两两相似度，用于校准在线说话人阈值。

把会议音轨按 VAD 切成语音段，逐段提取 eres2net 声纹，打印两两余弦相似度
矩阵与按时间的相邻相似度序列，帮助判断 ``online_similarity_threshold`` 该取多少
才能把不同说话人分开（相似度越低越不像同一人）。

用法::

    BREVIA_MODELS_DIR=~/brevia/models .venv/bin/python -m backend.diagnose_speaker_similarity \
        --meeting fdb94cd6-8043-4a75-843f-0d125dafbf2b --track system --source-root /tmp/brevia-src
"""

import argparse
import numpy
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--meeting", required=True)
    parser.add_argument("--track", default="system")
    parser.add_argument("--source-root", default="/tmp/brevia-src")
    parser.add_argument("--min-ms", type=int, default=1500)
    args = parser.parse_args()

    from .storage import Store
    from .asr import ModelManager, SpeakerTracker
    from .audio_io import read_mono_wav

    source = Store(args.source_root)
    # 验证会议存在，在读取音频前给出明确错误。
    source.get_meeting(args.meeting)
    path = source.meetings_dir / args.meeting / "audio" / "playback-system.wav"
    if not path.exists():
        path = source.meetings_dir / args.meeting / "audio" / "playback-mic.wav"

    manager = ModelManager(Path.home() / "brevia" / "models")
    samples, sample_rate = read_mono_wav(path)
    tracker = SpeakerTracker(manager)
    print(f"音轨: {path}  时长 {len(samples)/sample_rate:.1f}s")

    # 固定 5s 窗（3s 步进）提取声纹，观察随时间变化的相似度，定位说话人切换点。
    window_ms = 5000
    step_ms = 3000
    segs = []
    for start_ms in range(0, int(len(samples) / sample_rate * 1000) - window_ms, step_ms):
        start = round(start_ms * sample_rate / 1000)
        end = round((start_ms + window_ms) * sample_rate / 1000)
        emb = tracker.embedding(samples[start:end], sample_rate)
        segs.append({"start_ms": start_ms, "end_ms": start_ms + window_ms, "emb": emb})

    embeds = [s["emb"] for s in segs if s["emb"] is not None]
    print(f"可提取声纹的窗口: {len(embeds)} / {len(segs)}\n")

    def sim(a, b):
        a = numpy.asarray(a, dtype=numpy.float32)
        b = numpy.asarray(b, dtype=numpy.float32)
        a = a / (numpy.linalg.norm(a) + 1e-9)
        b = b / (numpy.linalg.norm(b) + 1e-9)
        return float(a @ b)

    print("相邻窗口相似度（时间顺序）:")
    for i in range(1, len(embeds)):
        s0 = segs[i - 1]
        s1 = segs[i]
        clock0 = f"{s0['start_ms']//60000:02d}:{s0['start_ms']%60000//1000:02d}"
        clock1 = f"{s1['start_ms']//60000:02d}:{s1['start_ms']%60000//1000:02d}"
        print(f"  [{clock0}]-[{clock1}]  {sim(embeds[i-1], embeds[i]):.3f}")

    print("\n两两相似度统计:")
    vals = [sim(a, b) for i, a in enumerate(embeds) for b in embeds[i + 1:]]
    if vals:
        print(f"  min={min(vals):.3f}  max={max(vals):.3f}  mean={sum(vals)/len(vals):.3f}")
        hist = [0, 0, 0, 0, 0]
        for v in vals:
            idx = min(4, int(v * 5))
            hist[idx] += 1
        for i, c in enumerate(hist):
            print(f"  sim {i/5:.1f}-{(i+1)/5:.1f}: {c}")


if __name__ == "__main__":
    main()
