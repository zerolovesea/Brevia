"""macOS 轻量 Worker 与完整 MLX 运行包之间的私有 JSONL 协议。"""

import base64
import json
import logging
import os
import sys
import threading
import time
import weakref
from pathlib import Path

from .worker_common import ModelNotInstalled, TaskCancelled
from .worker_llama_sidecar import _Sidecar, inference_worker


def _release(sidecar, done):
    done.set()
    sidecar.cancel()


def _watch_cancel(sidecar, cancelled, done):
    while not done.wait(0.2):
        if cancelled.is_set():
            sidecar.cancel(cancelled)
            return


class RemoteMLXASR:
    def __init__(
        self, manager, model_id, language=None, threads=None, hotwords=None, cancellation=None
    ):
        if not manager.is_ready(model_id):
            raise ModelNotInstalled([model_id])
        worker = inference_worker()
        self.model_id = model_id
        self.cancellation = cancellation
        self.config = {
            "model": model_id,
            "root": str(manager.root),
            "bundled": str(manager.bundled_root) if manager.bundled_root else None,
            "language": language,
            "hotwords": hotwords or [],
        }
        self.sidecar = _Sidecar([str(worker), "--mlx-asr"], logging.getLogger(__name__).error)
        done = threading.Event()
        # 调整会议语言时旧的排队任务会继续持有旧识别器，最后一个引用释放后回收。
        self._finalizer = weakref.finalize(self, _release, self.sidecar, done)
        if cancellation is not None:
            threading.Thread(
                target=_watch_cancel, args=(self.sidecar, cancellation, done), daemon=True
            ).start()
        try:
            self.max_speech_seconds = self._request("load")["max_speech_seconds"]
        except BaseException:
            self._finalizer()
            raise

    def close_remote(self):
        self.sidecar.shutdown()
        self._finalizer()

    def _request(self, operation, samples=None, sample_rate=16000, partial=None):
        if not self._finalizer.alive:
            raise RuntimeError("MLX recognizer is closed")
        request = {"type": operation, "config": self.config}
        if samples is not None:
            import numpy as np

            audio = np.asarray(samples, dtype="<f4")
            if sample_rate != 16000 or audio.ndim != 1 or audio.nbytes > MAX_AUDIO_BYTES:
                raise ValueError("Invalid MLX audio window")
            request["audio"] = base64.b64encode(audio).decode("ascii")
        result = self.sidecar.request(request, partial=partial, cancellation=self.cancellation)
        if self.cancellation is not None and self.cancellation.is_set():
            raise TaskCancelled()
        if result.get("type") != "result":
            raise RuntimeError(result.get("message") or "MLX sidecar failed")
        return result

    def decode(self, samples, sample_rate=16000):
        return self.decode_words(samples, sample_rate)[0]

    def decode_words(self, samples, sample_rate=16000):
        result = self._request("words", samples, sample_rate)
        return result["text"], result["words"]

    def decode_stream(self, samples, sample_rate=16000, partial=None):
        return self._request("stream", samples, sample_rate, partial)["text"]


# 现有 MLX 识别器单窗上限 20 秒；留出边界拼接与精修热词上下文。
MAX_AUDIO_BYTES = 60 * 16000 * 4


def _watch_parent(parent):
    while os.getppid() == parent and parent != 1:
        time.sleep(1)
    os._exit(1)


def serve():
    from .asr import ModelManager
    from .mlx_asr import MLXASR
    from .worker import protocol_output

    protocol = protocol_output()
    threading.Thread(target=_watch_parent, args=(os.getppid(),), daemon=True).start()
    model = config = None

    def send(message):
        print(json.dumps(message, ensure_ascii=False), file=protocol, flush=True)

    while line := sys.stdin.buffer.readline(2 * MAX_AUDIO_BYTES + 1):
        try:
            if len(line) > 2 * MAX_AUDIO_BYTES:
                raise ValueError("MLX sidecar request too large")
            request = json.loads(line)
            operation = request["type"]
            if operation == "shutdown":
                return
            if operation not in ("load", "words", "stream"):
                raise ValueError("Unknown MLX operation")
            if request["config"] != config:
                cfg = request["config"]
                manager = ModelManager(
                    Path(cfg["root"]), bundled_root=cfg["bundled"], cleanup=False
                )
                model = MLXASR(
                    manager, cfg["model"], language=cfg["language"], hotwords=cfg["hotwords"]
                )
                config = cfg
            if operation == "load":
                send({"type": "result", "max_speech_seconds": model.max_speech_seconds})
                continue
            import numpy as np

            audio = base64.b64decode(request["audio"], validate=True)
            if len(audio) > MAX_AUDIO_BYTES:
                raise ValueError("MLX audio window too large")
            samples = np.frombuffer(audio, dtype="<f4")
            if operation == "words":
                text, words = model.decode_words(samples)
                send({"type": "result", "text": text, "words": words})
            else:
                text = model.decode_stream(
                    samples, partial=lambda value: send({"type": "partial", "text": value})
                )
                send({"type": "result", "text": text})
        except Exception as error:
            send({"type": "error", "message": str(error)})
            return
