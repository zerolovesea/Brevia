"""回放已有会议并逐条打印 partial/final/refined/discarded 事件（开发诊断用）。

用于观察句间重复、软钉边界、句末精修与说话人标签。相比 diagnose_live_replay
只打印最终段落，这里完整打印事件序列（含 revision 与 speaker），便于定位
「上一句尾出现在下一句头」的重复来源。

用法::

    BREVIA_MODELS_DIR=~/brevia/models .venv/bin/python -m backend.diagnose_live_events \
        --meeting 0b3233a4-23e2-4067-98fc-c48180a6f92c --track system --max-seconds 60 \
        --source-root /tmp/brevia-src --data-root /tmp/brevia-replay-events
"""

import argparse
import base64
import time
import wave
from pathlib import Path

FRAME_SAMPLES = 2730


def read_wav_pcm(path):
    with wave.open(str(path)) as recording:
        if recording.getnchannels() != 1 or recording.getsampwidth() != 2:
            raise ValueError(f"{path} 不是单声道 PCM16")
        return recording.readframes(recording.getnframes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--meeting", required=True)
    parser.add_argument("--track", default="system", choices=("mic", "system"))
    parser.add_argument("--max-seconds", type=float, default=60.0)
    parser.add_argument("--source-root", default="/tmp/brevia-src")
    parser.add_argument("--data-root", default="/tmp/brevia-replay-events")
    parser.add_argument("--show-partial", action="store_true")
    args = parser.parse_args()

    from .storage import Store
    from .worker import Worker

    source = Store(args.source_root)
    src = source.get_meeting(args.meeting)
    manifest = source.read_manifest(args.meeting)
    track_meta = manifest["tracks"][args.track]
    sample_rate = track_meta["sample_rate"]

    events = []
    worker = Worker(args.data_root, events.append)
    meeting = worker.start(
        {
            "title": f"[回放] {src['title']}",
            "language": src.get("language") or "auto",
            "streaming_model_id": src["streaming_model_id"],
            "refined_model_id": src["refined_model_id"],
            "speaker_segmentation_model_id": src.get("speaker_segmentation_model_id"),
            "vad_model_id": src.get("vad_model_id") or "silero-vad",
            "num_speakers": src.get("num_speakers", -1),
        }
    )

    fed_samples = 0
    # 等待后台模型加载完成（流式 ASR + 精修），模拟真实节奏，避免快速回放把
    # 「模型尚未就绪」的错误状态放大成回归。
    worker._wait_prepare(timeout=20)
    for name in track_meta["chunks"]:
        pcm = read_wav_pcm(source.meetings_dir / args.meeting / "audio" / name)
        total = len(pcm) // 2
        for offset in range(0, total, FRAME_SAMPLES):
            frame = pcm[offset * 2:(offset + FRAME_SAMPLES) * 2]
            if not frame:
                continue
            worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": args.track,
                    "pcm": base64.b64encode(frame).decode(),
                    "sample_rate": sample_rate,
                    "start_ms": fed_samples * 1000 // sample_rate,
                }
            )
            fed_samples += len(frame) // 2
            if fed_samples / sample_rate >= args.max_seconds:
                break
        if fed_samples / sample_rate >= args.max_seconds:
            break

    executor = getattr(worker, "live_postprocessing", None)
    if executor is not None:
        # 用哨兵任务确认队列与正在执行的任务都已排空，避免只看到部分精修结果。
        sentinel = executor.submit(lambda: None)
        sentinel.result()

    worker.stop({"meeting_id": meeting["id"], "duration_ms": int(fed_samples * 1000 / sample_rate)})

    for event in events:
        etype = event["type"]
        if etype not in {"transcript.partial", "transcript.final", "transcript.refined", "transcript.discarded"}:
            continue
        if etype == "transcript.partial" and not args.show_partial:
            continue
        payload = event["payload"]
        if etype == "transcript.discarded":
            print(f"{etype:22s} segment_id={payload.get('segment_id','?')}")
            continue
        clock = f"{payload['start_ms'] // 60000:02d}:{payload['start_ms'] % 60000 // 1000:02d}"
        pin = " [钉]" if payload.get("pinned") else ""
        rev = payload.get("revision", "?")
        print(f"{etype:22s} rev={rev:>2} [{clock}] {payload.get('speaker','?')}{pin}: {payload.get('text','')}")

    result = worker.store.get_meeting(meeting["id"])
    print("\n=== 最终 live 段落 ===")
    for segment in result["segments"]:
        if segment.get("version") != "live":
            continue
        clock = f"{segment['start_ms'] // 60000:02d}:{segment['start_ms'] % 60000 // 1000:02d}"
        print(f"  [{clock}] {segment.get('speaker','?')}: {segment['text']}")


if __name__ == "__main__":
    main()
