"""只依赖音频和模型的说话人分析实现，供独立入口和 spawn 共同调用。"""

from .asr import ModelManager, OfflineDiarizer, SpeakerTracker
from .audio_io import read_mono_wav_window

# 子进程不加载用户覆盖，由父端传入；缺省保留现有声纹窗口。
EMBEDDING_WINDOW_MS = 15_000


class DiarizationEngine:
    """任务内保留模型，不保留上一块波形、轮次或声纹结果。"""

    def __init__(self, config, stage):
        self.config = {
            name: config.get(name)
            for name in (
                "models_root",
                "bundled_models_root",
                "segmentation_id",
                "threshold",
                "vad_fallback",
            )
        }
        manager = ModelManager(
            config["models_root"], bundled_root=config.get("bundled_models_root"), cleanup=False
        )
        threads = manager.device()["threads"]
        stage("load_embedding_model")
        self.tracker = SpeakerTracker(manager, threads=threads)
        self.diarizer = None
        if not config.get("vad_fallback"):
            stage("load_diarization_models")
            self.diarizer = OfflineDiarizer(
                manager, -1, config["threshold"], config["segmentation_id"], threads=threads
            )

    def process(self, payload, stage):
        if any(payload.get(name) != value for name, value in self.config.items()):
            raise ValueError("Analysis model configuration changed during a session")
        stage("load_audio")
        samples, sample_rate = read_mono_wav_window(
            payload["path"], payload["window_start_ms"], payload["window_end_ms"]
        )
        cursor = 0
        for speech in payload["speech"]:
            start = max(
                cursor,
                round((speech["start_ms"] - payload["window_start_ms"]) * sample_rate / 1000),
            )
            end = min(
                len(samples),
                round((speech["end_ms"] - payload["window_start_ms"]) * sample_rate / 1000),
            )
            samples[cursor:start] = 0
            cursor = max(cursor, end)
        samples[cursor:] = 0
        turns = []
        fallback_turns = [
            {
                "start_ms": max(payload["window_start_ms"], speech["start_ms"])
                - payload["window_start_ms"],
                "end_ms": min(payload["window_end_ms"], speech["end_ms"])
                - payload["window_start_ms"],
                "speaker": "spk-1",
            }
            for speech in payload["speech"]
        ]
        if self.diarizer is None:
            diarized = fallback_turns
        else:
            stage("diarization")
            diarized = self.diarizer.process(samples, sample_rate) or fallback_turns
        stage("extract_embeddings")
        for turn in diarized:
            start_ms = max(
                payload["core_start_ms"],
                payload["window_start_ms"] + turn["start_ms"],
            )
            end_ms = min(
                payload["core_end_ms"],
                payload["window_start_ms"] + turn["end_ms"],
            )
            embedding_window_ms = payload.get("embedding_window_ms", EMBEDDING_WINDOW_MS)
            for part_start in range(start_ms, end_ms, embedding_window_ms):
                part_end = min(part_start + embedding_window_ms, end_ms)
                local_start = round((part_start - payload["window_start_ms"]) * sample_rate / 1000)
                local_end = round((part_end - payload["window_start_ms"]) * sample_rate / 1000)
                embedding = self.tracker.embedding(samples[local_start:local_end], sample_rate)
                turns.append(
                    {
                        "start_ms": part_start,
                        "end_ms": part_end,
                        "speaker": turn["speaker"],
                        "_embedding": embedding.tolist() if embedding is not None else None,
                    }
                )
        return turns


def diarize_chunk_process(connection, payload):
    """兼容按块隔离入口；异常必须由父端回收整个原生进程。"""

    def stage(name):
        connection.send((None, name))

    try:
        engine = DiarizationEngine(payload, stage)
        connection.send((True, engine.process(payload, stage)))
    except BaseException as error:
        connection.send((False, f"{type(error).__name__}: {error}"))
    finally:
        connection.close()
