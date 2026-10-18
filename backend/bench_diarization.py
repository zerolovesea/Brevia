"""在独立数据目录中测量真实分析入口、模型阶段与进程树资源。"""

import argparse
import hashlib
import json
import os
import platform
import sys
import tempfile
import time
import wave
from pathlib import Path

import psutil

from .diarization_process import DiarizationProcess
from .process_resources import ProcessTreeMonitor


def benchmark_entry(command, payload, env, directory, timeout, startup_timeout, session_chunks=0):
    started = time.monotonic()
    result = {"stages": [], "ok": False}
    monitor = None
    child = None
    chunks = []
    initialized = False
    request_started = started
    with (directory / "native.log").open("w", encoding="utf-8") as log:
        try:
            child = DiarizationProcess(
                payload, command=command, stderr=log, env=env, session=bool(session_chunks)
            )
            with (directory / "resources.jsonl").open("w", encoding="utf-8") as samples:
                with ProcessTreeMonitor(child.process.pid, samples) as monitor:
                    try:
                        stage = "startup"
                        while True:
                            elapsed = time.monotonic() - started
                            if time.monotonic() - request_started > timeout or (
                                stage in {"startup", "import_modules"} and elapsed > startup_timeout
                            ):
                                raise TimeoutError(f"Speaker analysis timed out in {stage}")
                            if not child.poll(0.1):
                                continue
                            message = child.recv()
                            elapsed = time.monotonic() - started
                            if not isinstance(message, (list, tuple)) or len(message) != 2:
                                raise ValueError(f"Invalid analysis response: {str(message)[:256]}")
                            ok, value = message
                            if ok is None:
                                stage = value
                                result["stages"].append(
                                    {"stage": stage, "elapsed_seconds": round(elapsed, 4)}
                                )
                                continue
                            if ok is not True:
                                raise RuntimeError(str(value))
                            if session_chunks and not initialized:
                                initialized = True
                                child.submit("process_chunk", payload)
                                stage = "submitted"
                                continue
                            if not isinstance(value, list):
                                raise ValueError("Analysis result must contain turns")
                            if session_chunks:
                                digest = hashlib.sha256(
                                    json.dumps(value, sort_keys=True, allow_nan=False).encode()
                                ).hexdigest()
                                chunks.append(
                                    {
                                        "seconds": round(time.monotonic() - request_started, 4),
                                        "result_sha256": digest,
                                        "turns": len(value),
                                    }
                                )
                                if digest != chunks[0]["result_sha256"]:
                                    raise ValueError(
                                        "Repeated session input changed the analysis result"
                                    )
                                if len(chunks) < session_chunks:
                                    child.submit("process_chunk", payload)
                                    request_started = time.monotonic()
                                    stage = "submitted"
                                    continue
                                result["chunks"] = chunks
                            result.update(
                                ok=True,
                                turns=len(value),
                                embeddings=sum(
                                    turn.get("_embedding") is not None for turn in value
                                ),
                                speakers=len({turn["speaker"] for turn in value}),
                                elapsed_seconds=round(time.monotonic() - started, 4),
                            )
                            break
                    finally:
                        closing, child = child, None
                        closing.close(graceful=bool(session_chunks))
        except (OSError, RuntimeError, ValueError, TimeoutError, EOFError, psutil.Error) as error:
            result["ok"] = False
            result["error"] = f"{type(error).__name__}: {error}"
        finally:
            if child is not None:
                child.close()
            if monitor is not None:
                result["resources"] = monitor.summary()
            result["total_seconds"] = round(time.monotonic() - started, 4)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", type=Path, help="已安装或冻结包中的 worker 可执行文件")
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--models-root", type=Path, required=True)
    parser.add_argument("--bundled-models-root", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--max-seconds", type=float, default=60)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--startup-timeout", type=float, default=60)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument(
        "--session-chunks",
        type=int,
        default=0,
        help="同一会话重复相同输入的次数（1～10）；0 为冷入口",
    )
    args = parser.parse_args()
    if (
        not 1 <= args.repeat <= 100
        or not 1 <= args.threads <= 256
        or not 0 < args.max_seconds <= 60
        or not 0 < args.startup_timeout <= args.timeout <= 3600
        or not 0 <= args.session_chunks <= 10
    ):
        parser.error("Invalid repetition, thread, duration or timeout budget")
    if not args.wav.is_file() or (args.worker is not None and not args.worker.is_file()):
        parser.error("Audio or worker file does not exist")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        parser.error("Output directory must be empty")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "schema_version": 1,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "logical_cores": os.cpu_count(),
        "processor": platform.processor(),
        "physical_memory_bytes": psutil.virtual_memory().total,
        "collector": {"python": platform.python_version(), "psutil": psutil.__version__},
        "worker": str(args.worker.resolve()) if args.worker else "source",
        "threads": args.threads,
        "runs": [],
        "scope": "repeated-session-protocol-only"
        if args.session_chunks
        else "cold-entry-diarization-only; no ASR quality or real-time latency claim",
        "session_chunks": args.session_chunks,
    }
    with tempfile.TemporaryDirectory(prefix="isolated-", dir=args.output_dir) as temporary:
        root = Path(temporary)
        audio_path = root / "analysis-input.wav"
        with wave.open(str(args.wav)) as source, wave.open(str(audio_path), "wb") as audio:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
                1,
                2,
                16000,
            ):
                parser.error("Audio must be 16 kHz mono PCM16 WAV")
            audio.setparams(source.getparams())
            frames = source.readframes(round(args.max_seconds * source.getframerate()))
            if not frames:
                parser.error("Audio must not be empty")
            audio.writeframes(frames)
        duration_ms = len(frames) * 1000 // 32000
        report["input"] = {
            "pcm_sha256": hashlib.sha256(frames).hexdigest(),
            "duration_ms": duration_ms,
        }
        env = dict(
            os.environ,
            BREVIA_DATA_DIR=str(root / "data"),
            BREVIA_MODELS_DIR=str(root / "models"),
            BREVIA_ASR_BACKEND="cpu",
            BREVIA_OFFLINE_THREADS=str(args.threads),
            PYTHONUTF8="1",
        )
        payload = {
            "path": str(audio_path),
            "models_root": str(args.models_root.resolve()),
            "bundled_models_root": (
                str(args.bundled_models_root.resolve()) if args.bundled_models_root else None
            ),
            "segmentation_id": "pyannote-segmentation-3.0",
            "threshold": 0.35,
            "window_start_ms": 0,
            "window_end_ms": duration_ms,
            "core_start_ms": 0,
            "core_end_ms": duration_ms,
            "speech": [{"start_ms": 0, "end_ms": duration_ms}],
        }
        command = (
            [str(args.worker.resolve()), "--diarization"]
            if args.worker
            else [sys.executable, "-m", "backend.diarization_process"]
        )
        for index in range(args.repeat):
            directory = args.output_dir / f"run-{index + 1:03}"
            directory.mkdir()
            result = benchmark_entry(
                command,
                payload,
                env,
                directory,
                args.timeout,
                args.startup_timeout,
                args.session_chunks,
            )
            report["runs"].append(result)
            (args.output_dir / "report.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                encoding="utf-8",
            )
            print(json.dumps(result, allow_nan=False), flush=True)
            if not result["ok"]:
                raise SystemExit(1)


if __name__ == "__main__":
    main()
