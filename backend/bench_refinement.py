"""Compare native Sherpa, the Python refinement pipeline, and Electron IPC RTF.

The input must be a 16 kHz mono PCM WAV. Use the same model and audio duration
on macOS and Windows; model loading and import conversion are excluded from RTF.

Example:
    .venv/bin/python -m backend.bench_refinement --wav sample.wav --electron
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

from .asr import ModelManager, OfflineDiarizer, OfflineVAD, RefinedASR, SpeakerTracker
from .audio_io import read_mono_wav, read_mono_wav_window
from .config import SETTINGS

DEFAULT_WAV = Path(__file__).with_name("benchmarks") / "baseline-zh.wav"


def wav_duration_seconds(path):
    with wave.open(str(path)) as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("--wav must be mono PCM16 WAV")
        if audio.getframerate() != 16000:
            raise ValueError("--wav must be 16 kHz")
        return audio.getnframes() / audio.getframerate()


def clip_wav(source, destination, seconds):
    with wave.open(str(source)) as input_audio, wave.open(str(destination), "wb") as output:
        output.setparams(input_audio.getparams())
        frames = input_audio.getnframes()
        if seconds:
            frames = min(frames, round(seconds * input_audio.getframerate()))
        output.writeframes(input_audio.readframes(frames))


def windows(path, window_seconds):
    duration_ms = round(wav_duration_seconds(path) * 1000)
    for start_ms in range(0, duration_ms, window_seconds * 1000):
        yield read_mono_wav_window(path, start_ms, min(start_ms + window_seconds * 1000, duration_ms))


def result(name, audio_seconds, started):
    elapsed = time.perf_counter() - started
    return {
        "benchmark": name,
        "audio_seconds": round(audio_seconds, 3),
        "elapsed_seconds": round(elapsed, 3),
        "rtf": round(elapsed / max(audio_seconds, 1e-9), 4),
    }


def benchmark_sherpa(path, model_id, language, models_root, window_seconds):
    """Decode through the raw Sherpa recognizer after the app has built its config."""
    recognizer = RefinedASR(
        ModelManager(models_root), model_id, language=language,
        threads=ModelManager.device()["threads"],
    ).recognizer
    audio_seconds = wav_duration_seconds(path)
    started = time.perf_counter()
    for samples, sample_rate in windows(path, window_seconds):
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        recognizer.decode_stream(stream)
        _ = stream.result.text
    return result("bare-sherpa", audio_seconds, started)


def benchmark_python_stages(path, model_id, language, models_root, window_seconds):
    """Time the individual operations which make the refinement pipeline heavier."""
    import numpy

    manager = ModelManager(models_root)
    audio_seconds = wav_duration_seconds(path)
    samples, sample_rate = read_mono_wav(path)

    started = time.perf_counter()
    vad = OfflineVAD(manager, "silero-vad")
    vad_load = time.perf_counter() - started
    started = time.perf_counter()
    speech = vad.process(samples, sample_rate)
    vad_result = result("python-vad", audio_seconds, started)
    vad_result["model_init_seconds"] = round(vad_load, 3)

    masked = numpy.zeros_like(samples)
    for turn in speech:
        start = round(turn["start_ms"] * sample_rate / 1000)
        end = round(turn["end_ms"] * sample_rate / 1000)
        masked[start:end] = samples[start:end]
    started = time.perf_counter()
    diarizer = OfflineDiarizer(
        manager,
        -1,
        SETTINGS["diarization"]["cluster_threshold"],
        threads=manager.device()["threads"],
    )
    tracker = SpeakerTracker(manager, threads=manager.device()["threads"])
    speaker_load = time.perf_counter() - started
    started = time.perf_counter()
    turns = diarizer.process(masked, sample_rate) if speech else []
    for turn in turns:
        start = round(turn["start_ms"] * sample_rate / 1000)
        end = round(turn["end_ms"] * sample_rate / 1000)
        tracker.embedding(masked[start:end], sample_rate)
    speaker_result = result("python-diarization-and-embedding", audio_seconds, started)
    speaker_result["model_init_seconds"] = round(speaker_load, 3)
    speaker_result["turns"] = len(turns)

    started = time.perf_counter()
    recognizer = RefinedASR(
        manager, model_id, language=language, threads=manager.device()["threads"]
    )
    asr_load = time.perf_counter() - started
    started = time.perf_counter()
    for window_samples, window_rate in windows(path, window_seconds):
        recognizer.decode_words(window_samples, window_rate)
    asr_result = result("python-refined-asr-wrapper", audio_seconds, started)
    asr_result["model_init_seconds"] = round(asr_load, 3)
    return [vad_result, speaker_result, asr_result]


def benchmark_python_pipeline(path, model_id, language, models_root, data_root):
    """Measure the same post-import refinement path without Electron IPC."""
    from .worker import Worker

    previous_models_root = os.environ.get("BREVIA_MODELS_DIR")
    os.environ["BREVIA_MODELS_DIR"] = str(models_root)
    try:
        worker = Worker(str(data_root), lambda *_: None)
        meeting = worker.store.create_meeting({
            "title": "[benchmark]",
            "language": language,
            "streaming_model_id": "zipformer-en-streaming-int8",
            "refined_model_id": model_id,
            "speaker_segmentation_model_id": "pyannote-segmentation-3.0",
        })
        destination = worker.store.meetings_dir / meeting["id"] / "audio" / "playback-mic.wav"
        shutil.copyfile(path, destination)
        worker.store.finish_imported_meeting(meeting["id"], round(wav_duration_seconds(path) * 1000))
        started = time.perf_counter()
        worker.refine({"meeting_id": meeting["id"], "refined_model_id": model_id})
        return result("python-refinement-pipeline", wav_duration_seconds(path), started)
    finally:
        if previous_models_root is None:
            os.environ.pop("BREVIA_MODELS_DIR", None)
        else:
            os.environ["BREVIA_MODELS_DIR"] = previous_models_root


def benchmark_electron(path, model_id, language, models_root, data_root):
    npm = "npm.cmd" if os.name == "nt" else "npm"
    command = [
        npm, "run", "bench:electron", "--", "--wav", str(path),
        "--refined-model", model_id, "--language", language,
        "--models-root", str(models_root), "--data-root", str(data_root),
    ]
    completed = subprocess.run(command, check=True, text=True, capture_output=True)
    for line in reversed(completed.stdout.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if value.get("benchmark") == "electron-main-worker-ipc":
            return value
    raise RuntimeError(f"Electron benchmark did not return JSON:\n{completed.stdout}\n{completed.stderr}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", type=Path, default=DEFAULT_WAV)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--refined-model", default="funasr-nano-int8")
    parser.add_argument("--models-root", default=os.environ.get("BREVIA_MODELS_DIR") or str(Path.home() / "brevia" / "models"))
    parser.add_argument("--max-seconds", type=float)
    parser.add_argument("--window-seconds", type=int, default=15)
    parser.add_argument("--electron", action="store_true")
    args = parser.parse_args()
    if not args.wav.is_file():
        parser.error("--wav was not found")
    wav_duration_seconds(args.wav)

    with tempfile.TemporaryDirectory(prefix="brevia-bench-") as temporary:
        temporary_root = Path(temporary)
        wav_path = temporary_root / "input.wav"
        clip_wav(args.wav, wav_path, args.max_seconds)
        models_root = Path(args.models_root)
        results = [
            benchmark_sherpa(wav_path, args.refined_model, args.language, models_root, args.window_seconds),
            *benchmark_python_stages(wav_path, args.refined_model, args.language, models_root, args.window_seconds),
            benchmark_python_pipeline(wav_path, args.refined_model, args.language, models_root, temporary_root / "python-data"),
        ]
        if args.electron:
            results.append(benchmark_electron(wav_path, args.refined_model, args.language, models_root, temporary_root / "electron-data"))
        for value in results:
            print(json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
