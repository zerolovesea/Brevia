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
            self.event("model.status", {"model_id": model_id, "status": "ready"})
            return self.path(model_id)
        self.event("model.status", {"model_id": model_id, "status": "downloading"})
        with tempfile.TemporaryDirectory(dir=self.root) as temporary:
            if model.get("downloads"):
                source = Path(temporary) / "model"
                source.mkdir()
                received = 0
                for item in model["downloads"]:
                    destination = Path(temporary) / item["path"] if item.get("extract") else source / item["path"]
                    destination.parent.mkdir(parents=True, exist_ok=True)

                    def report(blocks, block_size, total, offset=received):
                        current = min(blocks * block_size, total) if total > 0 else blocks * block_size
                        self.event("model.progress", {"model_id": model_id, "received": offset + current, "total": model["size_bytes"]})

                    urllib.request.urlretrieve(item["url"], destination, report)
                    if item.get("extract"):
                        extract_root = Path(temporary) / f"extract-{received}"
                        extract_root.mkdir()
                        with tarfile.open(destination) as bundle:
                            for member in bundle.getmembers():
                                target = (extract_root / member.name).resolve()
                                if not target.is_relative_to(extract_root.resolve()):
                                    raise ValueError("Unsafe model archive path")
                            bundle.extractall(extract_root, filter="data")
                        extracted = extract_root / item["directory"]
                        if not extracted.is_dir():
                            raise ValueError("Model archive is missing required directory")
                        shutil.copytree(extracted, source, dirs_exist_ok=True)
                    received += destination.stat().st_size
                digest = None
            else:
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
        endpoint = self.model.get("endpoint", {})
        common = {
            "tokens": str(path / "tokens.txt"),
            "num_threads": manager.device()["threads"],
            "provider": manager.device()["backend"],
            "enable_endpoint_detection": True,
            "rule1_min_trailing_silence": endpoint.get(
                "rule1_silence", SETTINGS["asr"]["endpoint_rule1_silence"]
            ),
            "rule2_min_trailing_silence": endpoint.get(
                "rule2_silence", SETTINGS["asr"]["endpoint_rule2_silence"]
            ),
            "rule3_min_utterance_length": endpoint.get(
                "maximum_utterance_seconds", SETTINGS["asr"]["maximum_utterance_seconds"]
            ),
        }
        if self.model["kind"] == "paraformer":
            common.update(
                encoder=str(path / "encoder.int8.onnx"),
                decoder=str(path / "decoder.int8.onnx"),
            )
        else:
            files = [name for name in self.model["files"] if name.endswith(".onnx")]
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


class LiveDenoiser:
    """用 Sherpa-onnx 在线 GTCRN 降噪后再交给实时识别。"""

    def __init__(self, manager, model_id):
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        config = sherpa_onnx.OnlineSpeechDenoiserConfig()
        config.model.gtcrn.model = str(manager.path(model_id) / "gtcrn_simple.onnx")
        config.model.num_threads = manager.device()["threads"]
        config.model.provider = manager.device()["backend"]
        if not config.validate():
            raise RuntimeError("Invalid live denoiser configuration")
        self.config = config
        self.engines = {}

    def accept(self, track, samples, sample_rate, flush=False):
        """按模型帧长处理一条音轨，并在结束时输出缓存尾音。"""
        import numpy
        import sherpa_onnx

        engine = self.engines.setdefault(track, sherpa_onnx.OnlineSpeechDenoiser(self.config))
        output = [
            numpy.asarray(engine(samples[start:start + engine.frame_shift_in_samples], sample_rate).samples, dtype=numpy.float32)
            for start in range(0, len(samples), engine.frame_shift_in_samples)
        ]
        if flush:
            output.append(numpy.asarray(engine.flush().samples, dtype=numpy.float32))
        return numpy.concatenate(output) if output else samples


class OfflineDenoiser:
    """在会后精修前清理整段录音，不改写原始音频文件。"""

    def __init__(self, manager, model_id):
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        config = sherpa_onnx.OfflineSpeechDenoiserConfig()
        config.model.gtcrn.model = str(manager.path(model_id) / "gtcrn_simple.onnx")
        config.model.num_threads = manager.device()["threads"]
        config.model.provider = manager.device()["backend"]
        if not config.validate():
            raise RuntimeError("Invalid offline denoiser configuration")
        self.engine = sherpa_onnx.OfflineSpeechDenoiser(config)

    def process(self, samples, sample_rate):
        import numpy
        return numpy.asarray(self.engine(samples, sample_rate).samples, dtype=numpy.float32)


class LanguageIdentifier:
    """使用 Whisper 的原生语言识别替代文本启发式判断。"""

    def __init__(self, manager, model_id="whisper-turbo"):
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        path = manager.path(model_id)
        config = sherpa_onnx.SpokenLanguageIdentificationConfig(
            whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
                encoder=str(path / "turbo-encoder.int8.onnx"), decoder=str(path / "turbo-decoder.int8.onnx"),
            ),
            num_threads=manager.device()["threads"], provider=manager.device()["backend"],
        )
        if not config.validate():
            raise RuntimeError("Invalid language-identification configuration")
        self.engine = sherpa_onnx.SpokenLanguageIdentification(config)

    def identify(self, samples, sample_rate):
        stream = self.engine.create_stream()
        stream.accept_waveform(sample_rate, samples)
        return self.engine.compute(stream)


class SenseVoiceStreamingASR:
    """用 Silero VAD 切分音频并驱动 SenseVoice，提供低延迟分段字幕。"""
    def __init__(self, manager, model_id, vad_id="silero-vad"):
        if not (manager.is_ready(model_id) and manager.is_ready(vad_id)):
            raise RuntimeError(f"Models {model_id}, {vad_id} are not installed")
        import sherpa_onnx
        path = manager.path(model_id)
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=str(path / "model.int8.onnx"), tokens=str(path / "tokens.txt"), language="auto", use_itn=True, num_threads=manager.device()["threads"], provider=manager.device()["backend"])
        config = sherpa_onnx.VadModelConfig()
        vad = manager.get(vad_id)
        getattr(config, "ten_vad" if vad["kind"] == "ten-vad" else "silero_vad").model = str(manager.path(vad_id) / vad["files"][0])
        config.sample_rate = 16000
        self.vads = {}
        self.config = config

    def accept(self, track, samples, sample_rate=16000, flush=False):
        import sherpa_onnx
        vad = self.vads.setdefault(track, sherpa_onnx.VoiceActivityDetector(self.config, 100))
        vad.accept_waveform(samples)
        if flush:
            vad.flush()
        if vad.empty():
            return "", False
        segment = vad.front
        stream = self.recognizer.create_stream()
        stream.accept_waveform(sample_rate, segment.samples)
        self.recognizer.decode_stream(stream)
        vad.pop()
        return stream.result.text.strip(), True


class EnglishPunctuation:
    """为英文实时识别结果恢复大小写和标点。"""

    def __init__(self, manager, model_id):
        """加载英文在线标点模型；模型未安装时抛出 ``RuntimeError``。"""
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        path = manager.path(model_id)
        model = sherpa_onnx.OnlinePunctuationModelConfig(
            cnn_bilstm=str(path / "model.int8.onnx"),
            bpe_vocab=str(path / "bpe.vocab"),
            num_threads=manager.device()["threads"],
            provider=manager.device()["backend"],
        )
        self.engine = sherpa_onnx.OnlinePunctuation(
            sherpa_onnx.OnlinePunctuationConfig(model)
        )

    def apply(self, text):
        """返回带自然大小写与标点的英文；空文本原样返回。"""
        return self.engine.add_punctuation_with_case(text.lower()) if text else text


class ChinesePunctuation:
    """使用中英 CT-Transformer 为实时中文结果恢复标点。"""

    def __init__(self, manager, model_id):
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        path = manager.path(model_id)
        model = sherpa_onnx.OfflinePunctuationModelConfig(
            ct_transformer=str(path / "model.int8.onnx"),
            num_threads=manager.device()["threads"],
            provider=manager.device()["backend"],
        )
        self.engine = sherpa_onnx.OfflinePunctuation(
            sherpa_onnx.OfflinePunctuationConfig(model=model)
        )

    def apply(self, text):
        return self.engine.add_punctuation(text) if text else text


class SpeakerTracker:
    """按声纹相似度为连续语音分配稳定的会议内说话人 ID。"""

    def __init__(self, manager, threshold=None, max_speakers=None, model_id=None):
        """加载声纹模型；阈值越低，越倾向于合并为同一说话人。"""
        config = SETTINGS["diarization"]
        model_id = model_id or config["embedding_model_id"]
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        model = manager.path(model_id) / manager.get(model_id)["files"][0]
        extractor_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(model),
            num_threads=manager.device()["threads"],
            provider=manager.device()["backend"],
        )
        if not extractor_config.validate():
            raise RuntimeError("Invalid speaker embedding configuration")
        self.extractor = sherpa_onnx.SpeakerEmbeddingExtractor(extractor_config)
        self.threshold = (
            config["online_similarity_threshold"] if threshold is None else threshold
        )
        self.minimum_seconds = config["minimum_embedding_seconds"]
        self.max_speakers = max_speakers if max_speakers and max_speakers > 0 else None
        self.centers = []
        self.counts = []
        self.last_speaker = None

    @property
    def speaker_ids(self):
        """返回当前已发现的说话人 ID。"""
        return [f"spk-{index + 1}" for index in range(len(self.centers))]

    def assign(self, samples, sample_rate=16000):
        """提取一段语音的声纹并返回稳定的 ``spk-N``；过短片段沿用上一人。"""
        embedding = self.embedding(samples, sample_rate)
        return self.assign_embedding(embedding) if embedding else self.last_speaker or "spk-1"

    def embedding(self, samples, sample_rate=16000):
        """提取一段可用于人员库匹配的归一化前声纹；过短或不可用时返回 ``None``。"""
        import numpy

        if len(samples) < sample_rate * self.minimum_seconds:
            return None
        stream = self.extractor.create_stream()
        stream.accept_waveform(sample_rate, samples)
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            return None
        return numpy.asarray(self.extractor.compute(stream), dtype=numpy.float32)

    def assign_embedding(self, embedding):
        """把已归一化前的声纹向量并入最近聚类，供实时与离线流程复用。"""
        import math

        embedding = [float(value) for value in embedding]
        norm = math.sqrt(sum(value * value for value in embedding)) + 1e-9
        embedding = [value / norm for value in embedding]
        similarities = [
            sum(value * center_value for value, center_value in zip(embedding, center))
            for center in self.centers
        ]
        if similarities and (max(similarities) >= self.threshold or (self.max_speakers and len(self.centers) >= self.max_speakers)):
            index = max(range(len(similarities)), key=similarities.__getitem__)
            self.counts[index] += 1
            center = [
                value * (self.counts[index] - 1) + new_value
                for value, new_value in zip(self.centers[index], embedding)
            ]
            norm = math.sqrt(sum(value * value for value in center)) + 1e-9
            self.centers[index] = [value / norm for value in center]
        else:
            index = len(self.centers)
            self.centers.append(embedding)
            self.counts.append(1)
        self.last_speaker = f"spk-{index + 1}"
        return self.last_speaker


class RefinedASR:
    """使用完整录音窗口执行高精度离线转写。"""

    def __init__(self, manager, model_id):
        """加载 Qwen3-ASR 会后精修模型。

        Args:
            manager: 已初始化的 ``ModelManager``。
            model_id: 已安装的 Qwen3-ASR 模型 ID。

        """
        model = manager.get(model_id)
        if model["kind"] not in {"qwen3", "sensevoice", "whisper"} or not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        common = dict(num_threads=manager.device()["threads"], provider=manager.device()["backend"])
        if model["kind"] == "sensevoice":
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(path / "model.int8.onnx"), tokens=str(path / "tokens.txt"), language="auto", use_itn=True, **common
            )
        elif model["kind"] == "whisper":
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=str(path / "turbo-encoder.int8.onnx"), decoder=str(path / "turbo-decoder.int8.onnx"), tokens=str(path / "turbo-tokens.txt"), language="", **common
            )
        else:
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
            conv_frontend=str(path / "conv_frontend.onnx"),
            encoder=str(path / "encoder.int8.onnx"),
            decoder=str(path / "decoder.int8.onnx"),
            tokenizer=str(path / "tokenizer"),
            **common,
            max_total_len=1024,
            max_new_tokens=1024,
        )

    def decode(self, samples, sample_rate=16000):
        """转写一段单声道浮点波形，返回去除首尾空白的文本。"""
        stream = self.recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()


class OfflineDiarizer:
    """用语音分段、声纹向量和聚类生成单轨说话人时间段。"""

    def __init__(self, manager, num_speakers=None, threshold=None, segmentation_id=None, embedding_id=None):
        """创建离线说话人分离器。

        Args:
            manager: 提供 segmentation 与 embedding 模型路径的模型管理器。
            num_speakers: 已知人数；``None`` 使用配置，``-1`` 表示自动估计。
            threshold: 聚类阈值；``None`` 使用 ``settings.json`` 的默认值。
        """
        config = SETTINGS["diarization"]
        segmentation_id = segmentation_id or config["segmentation_model_id"]
        embedding_id = embedding_id or config["embedding_model_id"]
        if not all(manager.is_ready(model_id) for model_id in (segmentation_id, embedding_id)):
            raise RuntimeError(f"Models {segmentation_id}, {embedding_id} are not installed")
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


class SourceSeparator:
    """使用 Spleeter 将双声道录音拆为人声与非人声轨。"""

    def __init__(self, manager, model_id="spleeter-2stems-fp16"):
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        config = sherpa_onnx.OfflineSourceSeparationConfig(
            model=sherpa_onnx.OfflineSourceSeparationModelConfig(
                spleeter=sherpa_onnx.OfflineSourceSeparationSpleeterModelConfig(
                    vocals=str(path / "vocals.fp16.onnx"),
                    accompaniment=str(path / "accompaniment.fp16.onnx"),
                ), num_threads=manager.device()["threads"], provider=manager.device()["backend"],
            )
        )
        if not config.validate():
            raise RuntimeError("Invalid source separation configuration")
        self.engine = sherpa_onnx.OfflineSourceSeparation(config)

    def process(self, samples, sample_rate):
        return self.engine.process(sample_rate=sample_rate, samples=samples)


class ZipVoiceTTS:
    """使用 ZipVoice 本地根据参考音频合成中英文语音。"""

    def __init__(self, manager, model_id="zipvoice-zh-en"):
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                zipvoice=sherpa_onnx.OfflineTtsZipvoiceModelConfig(
                    tokens=str(path / "tokens.txt"), encoder=str(path / "encoder.int8.onnx"),
                    decoder=str(path / "decoder.int8.onnx"), data_dir=str(path / "espeak-ng-data"),
                    lexicon=str(path / "lexicon.txt"), vocoder=str(path / "vocos_24khz.onnx"),
                ), num_threads=manager.device()["threads"], provider=manager.device()["backend"],
            )
        )
        if not config.validate():
            raise RuntimeError("Invalid ZipVoice configuration")
        self.engine = sherpa_onnx.OfflineTts(config)

    def generate(self, text, reference_audio, reference_sample_rate, reference_text):
        import sherpa_onnx
        config = sherpa_onnx.GenerationConfig()
        config.reference_audio = reference_audio
        config.reference_sample_rate = reference_sample_rate
        config.reference_text = reference_text
        config.num_steps = 4
        return self.engine.generate(text, config)
