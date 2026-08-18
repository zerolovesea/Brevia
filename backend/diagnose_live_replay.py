"""用本地已有会议录音回放，验证实时链路改动。

按前端真实节奏（约 170ms 一帧）把某个会议的 ``system`` 或 ``mic`` 音轨回放到
一条全新的实时会议里，收集 partial/final/refined/discarded 事件与最终段落，用于
观察软钉、句间去重、段内说话人切分与异步标点是否按预期工作。

用法:
    BREVIA_MODELS_DIR=~/brevia/models \
        .venv/bin/python -m backend.diagnose_live_replay \
        --meeting c7a51367-6832-491d-b378-e03fba613dfc --track system --max-seconds 90
"""

import argparse
import base64
import os
import time
import wave
from pathlib import Path

# 与前端 AudioCaptureProcessor 一致：8192 帧 @48k 降采样到 16k 后约 2730 样本/帧。
FRAME_SAMPLES = 2730


def read_wav_pcm(path):
    """读取单声道 PCM16 WAV，返回原始小端字节。"""
    with wave.open(str(path)) as recording:
        if recording.getnchannels() != 1 or recording.getsampwidth() != 2:
            raise ValueError(f"{path} 不是单声道 PCM16")
        return recording.readframes(recording.getnframes())


def replay(
    source_root,
    meeting_id,
    track,
    max_seconds,
    data_root,
    num_speakers_override=None,
    streaming_model_override=None,
    refined_model_override=None,
):
    from .storage import Store
    from .worker import Worker

    source = Store(source_root)
    src = source.get_meeting(meeting_id)
    manifest = source.read_manifest(meeting_id)
    if track not in manifest.get("tracks", {}):
        raise ValueError(f"会议没有 {track} 音轨: {meeting_id}")
    track_meta = manifest["tracks"][track]
    sample_rate = track_meta["sample_rate"]

    events = []
    worker = Worker(data_root, events.append)

    meeting = worker.start(
        {
            "title": f"[回放] {src['title']}",
            "language": src.get("language") or "auto",
            "streaming_model_id": streaming_model_override or src["streaming_model_id"],
            "refined_model_id": refined_model_override or src["refined_model_id"],
            "speaker_segmentation_model_id": src.get("speaker_segmentation_model_id"),
            "vad_model_id": src.get("vad_model_id") or "silero-vad",
            "num_speakers": (
                num_speakers_override
                if num_speakers_override is not None
                else src.get("num_speakers", -1)
            ),
        }
    )

    start_ms = 0
    fed_seconds = 0.0
    fed_samples = 0
    wall_start = time.time()
    for name in track_meta["chunks"]:
        pcm = read_wav_pcm(source.meetings_dir / meeting_id / "audio" / name)
        total = len(pcm) // 2
        for offset in range(0, total, FRAME_SAMPLES):
            frame = pcm[offset * 2 : (offset + FRAME_SAMPLES) * 2]
            if not frame:
                continue
            worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": track,
                    "pcm": base64.b64encode(frame).decode(),
                    "sample_rate": sample_rate,
                    "start_ms": start_ms,
                }
            )
            fed_samples += len(frame) // 2
            start_ms = fed_samples * 1000 // sample_rate
            fed_seconds = fed_samples / sample_rate
            if max_seconds and fed_seconds >= max_seconds:
                break
        if max_seconds and fed_seconds >= max_seconds:
            break
    wall_elapsed = time.time() - wall_start

    # 回放比实时快很多时，后台精修队列会积压；stop() 的 cancel_futures 会丢弃尚未
    # 执行的精修任务。这里先等队列排空，让所有 final 都完成精修后再停止。
    executor = getattr(worker, "live_postprocessing", None)
    if executor is not None:
        while True:
            queue = getattr(executor, "_work_queue", None)
            pending = queue.qsize() if queue is not None else 0
            if pending == 0:
                break
            time.sleep(0.2)

    worker.stop({"meeting_id": meeting["id"], "duration_ms": int(fed_seconds * 1000)})
    result = worker.store.get_meeting(meeting["id"])
    return {
        "fed_seconds": fed_seconds,
        "wall_seconds": wall_elapsed,
        "events": events,
        "segments": result["segments"],
        "speakers": result["speakers"],
    }


def summarize(outcome):
    counts = {}
    warnings = []
    for event in outcome["events"]:
        counts[event["type"]] = counts.get(event["type"], 0) + 1
        if event["type"] == "worker.warning":
            warnings.append(event["payload"])
    print(f"回放 {outcome['fed_seconds']:.1f}s 音频耗时 {outcome['wall_seconds']:.1f}s "
          f"(加速 {outcome['fed_seconds'] / max(outcome['wall_seconds'], 1e-9):.1f}x)")
    print("事件计数:", counts)
    if warnings:
        print("警告:")
        for warning in warnings[:20]:
            print("  ", warning.get("code"), warning.get("message", "")[:120])
    print(f"最终段落 {len(outcome['segments'])} 条:")
    for segment in outcome["segments"]:
        clock = f"{segment['start_ms'] // 60000:02d}:{segment['start_ms'] % 60000 // 1000:02d}"
        speaker = segment.get("speaker", "?")
        pinned = " [钉]" if segment.get("pinned") else ""
        print(f"  [{clock}] {speaker}{pinned}: {segment['text']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--meeting", required=True, help="源会议 ID")
    parser.add_argument("--track", default="system", choices=("mic", "system"))
    parser.add_argument("--max-seconds", type=float, default=90.0)
    parser.add_argument("--num-speakers", type=int, default=None)
    parser.add_argument("--streaming-model", default=None)
    parser.add_argument("--refined-model", default=None)
    parser.add_argument("--source-root", default=str(Path.home() / "brevia"))
    parser.add_argument("--data-root", default=str(Path.home() / "brevia-replay-test"))
    args = parser.parse_args()

    outcome = replay(
        args.source_root,
        args.meeting,
        args.track,
        args.max_seconds,
        args.data_root,
        args.num_speakers,
        args.streaming_model,
        args.refined_model,
    )
    summarize(outcome)


if __name__ == "__main__":
    main()
