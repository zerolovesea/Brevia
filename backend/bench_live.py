"""实时链路压测与模型基准（开发用，不随应用发布）。

对一条本地 WAV 录音做「实时节奏回放」，测量流式 ASR / 精修的真实 RTF 与整机 CPU
占用，并对比效率模式（power_saving，流式模型做二阶段）与性能模式（精修模型做二阶段）
的最终字幕，用于在低端 Windows 机器上选型。

用法::

    python -m backend.bench_live \
        --wav C:/Users/<you>/brevia/meetings/<id>/audio/playback-system.wav \
        --language zh --max-seconds 60

可选: --streaming-model / --refined-model / --power-saving 0|1 / --bench streaming|refined|replay
"""

import argparse
import base64
import os
import statistics
import time
import wave
from pathlib import Path

import numpy

FRAME_SAMPLES = 2730  # 与前端 8192@48k 降采样到 16k 后每帧样本数一致

# 开发/沙箱下，工作区外的「缺失文件」的 stat 会被转成 PermissionError，导致
# ModelManager.is_ready 对未下载模型抛错。真实 App 不会命中，这里加一层容错以
# 便本工具在未下载 denoiser/refined 模型时也能回放。
from .asr import ModelManager
from .audio_io import read_wav_pcm

_orig_is_ready = ModelManager.is_ready


def _safe_is_ready(self, model_id):
    try:
        return _orig_is_ready(self, model_id)
    except PermissionError:
        return False


ModelManager.is_ready = _safe_is_ready


def cpu_load_snapshot(pid=None):
    """返回当前进程的 CPU 百分比与 RSS（MB）；psutil 缺失时返回 None。

    ``psutil.Process.cpu_percent`` 首次调用为基线值 0.0，故先空采一次建立基线。
    """
    try:
        import psutil

        proc = psutil.Process(pid or os.getpid())
        proc.cpu_percent(interval=None)
        return {
            "cpu_percent": proc.cpu_percent(interval=0.1),
            "rss_mb": round(proc.memory_info().rss / 1e6, 1),
        }
    except Exception:
        return None


def replay(wav_path, language, max_seconds, data_root, models_root,
           streaming_model="x-asr-zh-en-streaming-480ms-int8",
           refined_model="qwen3-asr-0.6b-int8",
           power_saving=True):
    from .worker import Worker

    pcm = read_wav_pcm(wav_path)
    total_samples = len(pcm) // 2
    sample_rate = 16000
    events = []
    worker = Worker(data_root, events.append)
    meeting = worker.start(
        {
            "title": f"[bench] {Path(wav_path).name}",
            "language": language,
            "streaming_model_id": streaming_model,
            "refined_model_id": refined_model,
            "speaker_segmentation_model_id": "pyannote-segmentation-3.0",
            "vad_model_id": "silero-vad",
            "num_speakers": -1,
            "power_saving": bool(power_saving),
        }
    )
    worker._wait_prepare(60)
    if worker.asr is None:
        raise RuntimeError("Streaming ASR did not become ready")

    fed_samples = 0
    cpu_samples = []
    wall_start = time.time()
    start_ms = 0
    offset = 0
    while offset < total_samples and (not max_seconds or fed_samples < max_seconds * sample_rate):
        frame = pcm[offset * 2:(offset + FRAME_SAMPLES) * 2]
        if not frame:
            break
        worker.audio(
            {
                "meeting_id": meeting["id"],
                "track": "system",
                "pcm": base64.b64encode(frame).decode(),
                "sample_rate": sample_rate,
                "start_ms": start_ms,
            }
        )
        offset += len(frame) // 2
        fed_samples = offset
        start_ms = fed_samples * 1000 // sample_rate
        if len(cpu_samples) < 40:
            snap = cpu_load_snapshot()
            if snap:
                cpu_samples.append(snap["cpu_percent"])
    wall_elapsed = time.time() - wall_start

    executor = getattr(worker, "live_postprocessing", None)
    if executor is not None:
        while True:
            queue = getattr(executor, "_work_queue", None)
            if queue is None or queue.qsize() == 0:
                break
            time.sleep(0.2)

    worker.stop({"meeting_id": meeting["id"], "duration_ms": fed_samples * 1000 // sample_rate})
    segments = worker.store.get_meeting(meeting["id"])["segments"]
    return {
        "fed_seconds": round(fed_samples / sample_rate, 1),
        "wall_seconds": round(wall_elapsed, 1),
        "speedup": round(fed_samples / sample_rate / max(wall_elapsed, 1e-9), 1),
        "cpu_percent": round(statistics.mean(cpu_samples), 1) if cpu_samples else None,
        "events": events,
        "segments": segments,
    }


def benchmark_streaming(wav_path, model_id, language, max_seconds, models_root):
    from .asr import ModelManager, StreamingASR

    manager = ModelManager(models_root)
    pcm = read_wav_pcm(wav_path)
    total = len(pcm) // 2
    sample_rate = 16000
    limit = min(total, int(max_seconds * sample_rate)) if max_seconds else total
    recognizer = StreamingASR(manager, model_id, language)
    finals = []
    t0 = time.time()
    for start in range(0, limit, FRAME_SAMPLES):
        frame = pcm[start * 2:(start + FRAME_SAMPLES) * 2]
        samples = numpy.frombuffer(frame, dtype=numpy.int16).astype(numpy.float32) / 32768
        result, final = recognizer.accept("system", samples, sample_rate)
        text = result if isinstance(result, str) else getattr(result, "text", "")
        if final and text:
            finals.append(text)
    tail, _ = recognizer.accept("system", numpy.empty(0, dtype=numpy.float32), sample_rate, True)
    if tail:
        finals.append(tail if isinstance(tail, str) else getattr(tail, "text", ""))
    elapsed = time.time() - t0
    return {
        "audio_seconds": round(limit / sample_rate, 2),
        "elapsed_seconds": round(elapsed, 2),
        "rtf": round(elapsed / (limit / sample_rate), 3),
        "text": "".join(finals),
    }


def benchmark_refined(wav_path, model_id, language, max_seconds, models_root, window=15):
    from .asr import ModelManager, RefinedASR
    from .audio_io import read_mono_wav_window

    manager = ModelManager(models_root)
    with wave.open(str(wav_path)) as w:
        duration_ms = w.getnframes() * 1000 // w.getframerate()
    limit_ms = min(duration_ms, int(max_seconds * 1000)) if max_seconds else duration_ms
    recognizer = RefinedASR(manager, model_id, language=language)
    times = []
    texts = []
    for start in range(0, limit_ms, window * 1000):
        end = min(start + window * 1000, limit_ms)
        samples, sr = read_mono_wav_window(wav_path, start, end)
        t0 = time.time()
        text = recognizer.decode(samples, sr)
        elapsed = time.time() - t0
        times.append(elapsed)
        texts.append(text)
    return {
        "windows": len(times),
        "avg_seconds_per_window": round(statistics.mean(times), 2) if times else 0,
        "rtf": round(sum(times) / max(limit_ms / 1000, 1e-9), 3),
        "text": "".join(texts),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", required=True)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--max-seconds", type=float, default=60.0)
    parser.add_argument("--streaming-model", default="x-asr-zh-en-streaming-480ms-int8")
    parser.add_argument("--refined-model", default="qwen3-asr-0.6b-int8")
    parser.add_argument("--power-saving", type=int, default=1, choices=(0, 1))
    parser.add_argument("--models-root", default=os.environ.get("BREVIA_MODELS_DIR") or str(Path.home() / "brevia" / "models"))
    parser.add_argument("--data-root", default=str(Path(__file__).resolve().parents[1] / ".bench-data"))
    parser.add_argument("--bench", default="all", choices=("all", "streaming", "refined", "replay"))
    args = parser.parse_args()

    if args.bench in ("all", "streaming"):
        result = benchmark_streaming(args.wav, args.streaming_model, args.language, args.max_seconds, args.models_root)
        print(f"[streaming {args.streaming_model}] rtf={result['rtf']} "
              f"({result['elapsed_seconds']}s / {result['audio_seconds']}s)")
        print("  text:", result["text"][:160])

    if args.bench in ("all", "refined"):
        result = benchmark_refined(args.wav, args.refined_model, args.language, args.max_seconds, args.models_root)
        print(f"[refined {args.refined_model}] rtf={result['rtf']} "
              f"({result['avg_seconds_per_window']}s/窗 x {result['windows']})")
        print("  text:", result["text"][:160])

    if args.bench in ("all", "replay"):
        result = replay(
            args.wav, args.language, args.max_seconds, args.data_root, args.models_root,
            args.streaming_model, args.refined_model, bool(args.power_saving),
        )
        counts = {}
        for event in result["events"]:
            counts[event["type"]] = counts.get(event["type"], 0) + 1
        print(f"[replay power_saving={args.power_saving}] 回放 {result['fed_seconds']}s 音频 "
              f"耗时 {result['wall_seconds']}s (加速 {result['speedup']}x) "
              f"CPU≈{result['cpu_percent']}%")
        print("  事件:", counts)
        for segment in result["segments"]:
            clock = f"{segment['start_ms'] // 60000:02d}:{segment['start_ms'] % 60000 // 1000:02d}"
            print(f"  [{clock}] {segment.get('speaker','?')}: {segment['text'][:120]}")


if __name__ == "__main__":
    main()
