"""本地模型的下载管理，以及 sherpa-onnx 识别与说话人聚类封装。"""

import hashlib
import json
import os
import platform
import shutil
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

from .config import SETTINGS


class ModelManager:
    """按模型清单管理本地文件，并向 Worker 上报下载状态。"""

    def __init__(self, root, event=lambda *_: None):
        """加载模型清单。

        Args:
            root: 模型文件根目录。
            event: 状态回调，接收 ``(事件名, 事件数据)``。
        """
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.event = event
        self.catalog = {
            item["id"]: item
            for item in json.loads(Path(__file__).with_name("models.json").read_text())
        }

    def list(self):
        """返回模型清单，并补充本机安装状态和安装路径。"""
        return [
            {
                **model,
                "status": "ready" if self.is_ready(model["id"]) else "not_installed",
                "path": str(self.path(model["id"])) if self.is_ready(model["id"]) else None,
            }
            for model in self.catalog.values()
        ]

    def path(self, model_id):
        """返回指定模型在本机的版本化目录，不检查目录是否存在。"""
        model = self.get(model_id)
        return self.root / f"{model_id}-{model['revision'].replace('/', '-')}"

    def get(self, model_id):
        """按下载 ID 读取模型配置；未知 ID 会抛出 ``ValueError``。"""
        try:
            return self.catalog[model_id]
        except KeyError as error:
            raise ValueError("Unknown model") from error

    def is_ready(self, model_id):
        """检查模型目录及清单声明的必需文件是否完整。"""
        model, path = self.get(model_id), self.path(model_id)
        return path.is_dir() and all((path / name).exists() for name in model["files"])

    def download(self, model_id):
        """下载并校验一个模型，成功后原子地放入正式目录。

        Args:
            model_id: ``models.json`` 中的模型下载 ID。

        Returns:
            安装完成后的 ``Path``。已安装模型直接返回现有路径。

        Raises:
            ValueError: 校验和不一致、压缩包越界或缺少必需文件。
        """
        model = self.get(model_id)
        if self.is_ready(model_id):
            return self.path(model_id)
        self.event("model.status", {"model_id": model_id, "status": "downloading"})
        with tempfile.TemporaryDirectory(dir=self.root) as temporary:
            archive = Path(temporary) / Path(model["url"]).name

            reported = 0

            def report(blocks, block_size, total):
                """把 urlretrieve 的块进度节流为约每 MiB 一次的 Worker 事件。"""
                nonlocal reported
                received = min(blocks * block_size, total) if total > 0 else blocks * block_size
                if received < total and received - reported < 1024 * 1024:
                    return
                reported = received
                self.event(
                    "model.progress",
                    {"model_id": model_id, "received": received, "total": total},
                )

            urllib.request.urlretrieve(model["url"], archive, report)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            if model["archive_sha256"] and digest != model["archive_sha256"]:
                raise ValueError("Model archive checksum mismatch")
            source = Path(temporary) / "model"
            if model.get("directory"):
                extract_root = Path(temporary) / "extract"
                extract_root.mkdir()
                with tarfile.open(archive) as bundle:
                    for member in bundle.getmembers():
                        target = (extract_root / member.name).resolve()
                        if not target.is_relative_to(extract_root.resolve()):
                            raise ValueError("Unsafe model archive path")
                    bundle.extractall(extract_root, filter="data")
                source = extract_root / model["directory"]
            else:
                source.mkdir()
                archive.replace(source / model["files"][0])
            if not all((source / name).exists() for name in model["files"]):
                raise ValueError("Model archive is missing required files")
            source.replace(self.path(model_id))
        (self.path(model_id) / ".brevia.json").write_text(
            json.dumps({**model, "downloaded_at": time.time(), "archive_sha256": digest}, indent=2)
        )
        self.event("model.status", {"model_id": model_id, "status": "ready"})
        return self.path(model_id)

    def delete(self, model_id):
        """删除指定模型目录，并发布未安装状态。"""
        path = self.path(model_id)
        if path.exists():
            shutil.rmtree(path)
        self.event("model.status", {"model_id": model_id, "status": "not_installed"})

    @staticmethod
    def device():
        """探测 ONNX Runtime 执行后端，并给出保守的推理线程数。"""
        try:
            import onnxruntime

            providers = onnxruntime.get_available_providers()
        except ImportError:
            providers = ["CPUExecutionProvider"]
        return {
            "architecture": platform.machine(),
            "providers": providers,
            "backend": "cuda" if "CUDAExecutionProvider" in providers else "cpu",
            "threads": max(1, min(4, (os.cpu_count() or 2) // 2)),
        }


class StreamingASR:
    """维护每条音轨的在线识别流，生成 partial 和 endpoint 结果。"""

    def __init__(self, manager, model_id):
        """创建流式识别器。

        Args:
            manager: 已初始化的 ``ModelManager``。
            model_id: 具备 ``streaming`` 能力且已安装的模型 ID。
        """
        self.manager = manager
        self.model = manager.get(model_id)
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        common = {
            "tokens": str(path / "tokens.txt"),
            "num_threads": manager.device()["threads"],
            "provider": manager.device()["backend"],
            "enable_endpoint_detection": True,
            "rule1_min_trailing_silence": SETTINGS["asr"]["endpoint_rule1_silence"],
            "rule2_min_trailing_silence": SETTINGS["asr"]["endpoint_rule2_silence"],
            "rule3_min_utterance_length": SETTINGS["asr"]["maximum_utterance_seconds"],
        }
        if self.model["kind"] == "paraformer":
            common.update(
                encoder=str(path / "encoder.int8.onnx"),
                decoder=str(path / "decoder.int8.onnx"),
            )
        else:
            files = self.model["files"]
            common.update(
                encoder=str(path / files[0]),
                decoder=str(path / files[1]),
                joiner=str(path / files[2]),
            )
        self.recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(**common) if self.model["kind"] == "paraformer" else sherpa_onnx.OnlineRecognizer.from_transducer(**common)
        self.streams = {}

    def accept(self, track, samples, sample_rate=16000, flush=False):
        """向一条音轨追加波形并推进解码。

        Args:
            track: 音轨键；不同键各自维护独立识别流。
            samples: 归一化到 ``[-1, 1]`` 的 float32 单声道样本。
            sample_rate: 样本率，当前录音链路固定为 16 kHz。
            flush: 是否强制结束当前句，通常用于停止录音。

        Returns:
            ``(识别结果, 是否句末)``；结果类型由 sherpa-onnx 模型决定。
        """
        stream = self.streams.setdefault(track, self.recognizer.create_stream())
        stream.accept_waveform(sample_rate, samples)
        while self.recognizer.is_ready(stream):
            self.recognizer.decode_stream(stream)
        result = self.recognizer.get_result(stream)
        endpoint = flush or self.recognizer.is_endpoint(stream)
        if endpoint:
            stream.input_finished()
            while self.recognizer.is_ready(stream):
                self.recognizer.decode_stream(stream)
            result = self.recognizer.get_result(stream)
            self.recognizer.reset(stream)
        return result, endpoint


class RefinedASR:
    """使用完整录音窗口执行高精度离线转写。"""

    def __init__(self, manager, model_id, hotwords=()):
        """加载 Qwen3-ASR 会后精修模型。

        Args:
            manager: 已初始化的 ``ModelManager``。
            model_id: 已安装的 Qwen3-ASR 模型 ID。
            hotwords: 术语列表；重复项会在传给模型前去除。
        """
        model = manager.get(model_id)
        if model["kind"] != "qwen3" or not manager.is_ready(model_id):
            raise RuntimeError("The selected refined model is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
            conv_frontend=str(path / "conv_frontend.onnx"),
            encoder=str(path / "encoder.int8.onnx"),
            decoder=str(path / "decoder.int8.onnx"),
            tokenizer=str(path / "tokenizer"),
            num_threads=manager.device()["threads"],
            provider=manager.device()["backend"],
            hotwords=",".join(dict.fromkeys(hotwords)),
        )

    def decode(self, samples, sample_rate=16000):
        """转写一段单声道浮点波形，返回去除首尾空白的文本。"""
        stream = self.recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()


class OfflineDiarizer:
    """用语音分段、声纹向量和聚类生成单轨说话人时间段。"""

    def __init__(self, manager, num_speakers=None, threshold=None):
        """创建离线说话人分离器。

        Args:
            manager: 提供 segmentation 与 embedding 模型路径的模型管理器。
            num_speakers: 已知人数；``None`` 使用配置，``-1`` 表示自动估计。
            threshold: 聚类阈值；``None`` 使用 ``settings.json`` 的默认值。
        """
        config = SETTINGS["diarization"]
        segmentation_id = config["segmentation_model_id"]
        embedding_id = config["embedding_model_id"]
        if not all(manager.is_ready(model_id) for model_id in (segmentation_id, embedding_id)):
            raise RuntimeError("Speaker diarization models are not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        segmentation = manager.path(segmentation_id) / manager.get(segmentation_id)["files"][0]
        embedding = manager.path(embedding_id) / manager.get(embedding_id)["files"][0]
        diarization_config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(segmentation)
                ),
                num_threads=manager.device()["threads"],
                provider=manager.device()["backend"],
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(embedding),
                num_threads=manager.device()["threads"],
                provider=manager.device()["backend"],
            ),
            clustering=sherpa_onnx.FastClusteringConfig(
                num_clusters=config["num_speakers"] if num_speakers is None else num_speakers,
                threshold=config["cluster_threshold"] if threshold is None else threshold,
            ),
            min_duration_on=config["min_duration_on"],
            min_duration_off=config["min_duration_off"],
        )
        if not diarization_config.validate():
            raise RuntimeError("Invalid speaker diarization configuration")
        self.diarizer = sherpa_onnx.OfflineSpeakerDiarization(diarization_config)

    def process(self, samples, sample_rate=16000):
        """聚类整段录音。

        Args:
            samples: 归一化 float32 单声道样本。
            sample_rate: 必须与分离模型声明的样本率一致。

        Returns:
            按开始时间排序的字典列表，每项包含毫秒时间戳和 ``spk-N``。
        """
        if sample_rate != self.diarizer.sample_rate:
            raise ValueError(f"Diarization requires {self.diarizer.sample_rate} Hz audio")
        return [
            {
                "start_ms": round(segment.start * 1000),
                "end_ms": round(segment.end * 1000),
                "speaker": f"spk-{segment.speaker + 1}",
            }
            for segment in self.diarizer.process(samples).sort_by_start_time()
        ]
