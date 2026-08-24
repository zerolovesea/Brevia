"""本地模型的下载管理，以及 sherpa-onnx 识别与说话人聚类封装。"""

import hashlib
import http.client
import json
import os
import platform
import shutil
import tarfile
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from .config import SETTINGS, SPEAKER_EMBEDDING_MODEL_ID


DOWNLOAD_TIMEOUT_SECONDS = 30
DOWNLOAD_RETRIES = 5
DOWNLOAD_FREE_SPACE_MULTIPLIER = 2
DEFAULT_REFINED_MODEL_ID = "funasr-nano-int8"
DEPRECATED_MODEL_PREFIXES = (
    "campplus-zh-en-",
    "fire-red-asr2-ctc-zh-en-int8-",
    "nemo-titanet-small-en-",
    "paraformer-zh-en-int8-",
    "qwen3-asr-1.7b-",
    "vits-mimic3-ko-kss-low-",
    "vits-piper-de-thorsten-medium-int8-",
    "vits-piper-es-sharvard-medium-int8-",
    "vits-piper-fr-siwis-medium-int8-",
    "vits-piper-ru-irina-medium-int8-",
    "whisper-turbo-",
    "zipformer-zh-streaming-int8-",
    "zipvoice-zh-en-",
)


class DownloadCancelled(Exception):
    """用于中止由下载进度回调驱动的模型下载。"""


def sha256_file(path):
    """计算文件的 SHA256 哈希值。"""
    digest = hashlib.sha256()
    with path.open("rb") as downloaded:
        for block in iter(lambda: downloaded.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class ModelManager:
    """按模型清单管理本地文件，并向 Worker 上报下载状态。"""

    def __init__(self, root, event=lambda *_: None, bundled_root=None):
        """加载模型清单。

        Args:
            root: 模型文件根目录。
            event: 状态回调，接收 ``(事件名, 事件数据)``。
        """
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        bundled_root = bundled_root or os.environ.get("BREVIA_BUNDLED_MODELS_DIR")
        self.bundled_root = Path(bundled_root) if bundled_root else None
        self.event = event
        self.catalog = {
            item["id"]: item
            for item in json.loads(
                Path(__file__).with_name("models.json").read_text(encoding="utf-8")
            )
        }
        self.remove_deprecated_models()

    def remove_deprecated_models(self):
        """删除已从清单移除、且应用不再提供删除入口的旧模型。"""
        for path in self.root.iterdir():
            if path.is_dir() and path.name.startswith(DEPRECATED_MODEL_PREFIXES):
                shutil.rmtree(path, ignore_errors=True)

    def list(self):
        """返回模型清单，并补充本机安装状态和安装路径。"""
        return [
            {
                **model,
                "status": "ready" if self.is_ready(model["id"]) else "not_installed",
                "bundled": self.is_bundled(model["id"]),
                "path": str(self.path(model["id"]))
                if self.is_ready(model["id"])
                else None,
            }
            for model in self.catalog.values()
        ]

    def local_path(self, model_id):
        """返回指定模型的可写版本化目录，不检查目录是否存在。"""
        model = self.get(model_id)
        return self.root / f"{model_id}-{model['revision'].replace('/', '-')}"

    def bundled_path(self, model_id):
        """返回随安装包提供的模型路径；开发环境可能不存在。"""
        if not self.bundled_root:
            return None
        model = self.get(model_id)
        return self.bundled_root / f"{model_id}-{model['revision'].replace('/', '-')}"

    def path(self, model_id):
        """返回可用模型路径，优先用户下载的版本。"""
        local = self.local_path(model_id)
        bundled = self.bundled_path(model_id)
        if not self._is_ready(model_id, local) and bundled and self._is_ready(model_id, bundled):
            return bundled
        return local

    def get(self, model_id):
        """按下载 ID 读取模型配置；未知 ID 会抛出 ``ValueError``。"""
        try:
            return self.catalog[model_id]
        except KeyError as error:
            raise ValueError("Unknown model") from error

    def _is_ready(self, model_id, path):
        model = self.get(model_id)
        return path.is_dir() and all((path / name).exists() for name in model["files"])

    def is_bundled(self, model_id):
        """检查模型是否可直接从安装包使用。"""
        bundled = self.bundled_path(model_id)
        return bool(bundled and self._is_ready(model_id, bundled))

    def is_ready(self, model_id):
        """检查用户目录或安装包中的模型是否完整。"""
        return self._is_ready(model_id, self.local_path(model_id)) or self.is_bundled(model_id)

    @staticmethod
    def download_url(url, china_source=False):
        """返回选定的源，不改变构件标识。"""
        if not china_source:
            return url
        if url.startswith("https://github.com/"):
            return f"https://gh-proxy.com/{url}"
        if url.startswith("https://huggingface.co/"):
            return url.replace("https://huggingface.co/", "https://hf-mirror.com/", 1)
        return url

    @staticmethod
    def _download_file(url, destination, check_control, progress):
        """下载单个文件，支持重试和 HTTP Range 断点续传。"""
        for attempt in range(DOWNLOAD_RETRIES):
            check_control()
            received = destination.stat().st_size if destination.exists() else 0
            request = urllib.request.Request(
                url, headers={"Range": f"bytes={received}-"} if received else {}
            )
            try:
                with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
                    partial = received and response.getcode() == 206
                    if not partial:
                        received = 0
                    with destination.open("ab" if partial else "wb") as downloaded:
                        progress(received)
                        while block := response.read(256 * 1024):
                            check_control()
                            downloaded.write(block)
                            received += len(block)
                            progress(received)
                check_control()
                return
            except urllib.error.HTTPError as error:
                if error.code == 416 and destination.exists():
                    total = error.headers.get("Content-Range", "").rpartition("/")[2]
                    if total.isdigit() and destination.stat().st_size == int(total):
                        progress(int(total))
                        check_control()
                        return
                    destination.unlink()
                if attempt == DOWNLOAD_RETRIES - 1:
                    raise
                check_control()
                time.sleep(2**attempt)
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead):
                if attempt == DOWNLOAD_RETRIES - 1:
                    raise
                check_control()
                time.sleep(2**attempt)

    def download(self, model_id, control=None, china_source=False):
        """下载并校验一个模型，成功后原子地放入正式目录。

        Args:
            model_id: ``models.json`` 中的模型下载 ID。

        Returns:
            安装完成后的 ``Path``。已安装模型直接返回现有路径。

        Raises:
            ValueError: 校验和不一致、压缩包越界或缺少必需文件。
        """

        def check_control():
            while control and control["paused"].is_set():
                if control["cancelled"].is_set():
                    raise DownloadCancelled()
                time.sleep(0.1)
            if control and control["cancelled"].is_set():
                raise DownloadCancelled()

        model = self.get(model_id)
        if self.is_ready(model_id):
            self.event("model.status", {"model_id": model_id, "status": "ready"})
            return self.path(model_id)
        required_space = model["size_bytes"] * DOWNLOAD_FREE_SPACE_MULTIPLIER
        if shutil.disk_usage(self.root).free < required_space:
            raise OSError(f"Insufficient disk space: need {required_space} bytes free")
        self.event("model.status", {"model_id": model_id, "status": "downloading"})
        with tempfile.TemporaryDirectory(dir=self.root) as temporary:
            downloads = model.get("china_downloads") if china_source else None
            if downloads is None:
                downloads = model.get("downloads")
            if downloads:
                source = Path(temporary) / "model"
                source.mkdir()
                received = 0
                for item in downloads:
                    destination = (
                        Path(temporary) / item["path"]
                        if item.get("extract")
                        else source / item["path"]
                    )
                    destination.parent.mkdir(parents=True, exist_ok=True)

                    def report(current, offset=received):
                        self.event(
                            "model.progress",
                            {
                                "model_id": model_id,
                                "received": offset + current,
                                "total": model["size_bytes"],
                            },
                        )

                    check_control()
                    self._download_file(
                        self.download_url(item["url"], china_source),
                        destination,
                        check_control,
                        report,
                    )
                    check_control()
                    digest = sha256_file(destination)
                    if item.get("sha256") and digest != item["sha256"]:
                        raise ValueError("Model download checksum mismatch")
                    if item.get("extract"):
                        extract_root = Path(temporary) / f"extract-{received}"
                        extract_root.mkdir()
                        with tarfile.open(destination) as bundle:
                            bundle.extractall(extract_root, filter="data")
                        extracted = extract_root / item["directory"]
                        if not extracted.is_dir():
                            raise ValueError(
                                "Model archive is missing required directory"
                            )
                        shutil.copytree(extracted, source, dirs_exist_ok=True)
                    received += destination.stat().st_size
                digest = None
            else:
                archive = Path(temporary) / Path(model["url"]).name

                def report(received):
                    self.event(
                        "model.progress",
                        {
                            "model_id": model_id,
                            "received": received,
                            "total": model["size_bytes"],
                        },
                    )

                check_control()
                # 优先使用 china_url（如果存在且启用了大陆镜像）
                model_url = model.get("china_url") if china_source and model.get("china_url") else model["url"]
                self._download_file(
                    self.download_url(model_url, china_source),
                    archive,
                    check_control,
                    report,
                )
                check_control()
                # 仅当有校验和需要验证时才计算 SHA256 — 否则会在大文件 100% 进度时停顿数秒且无益处。
                expected_checksum = model.get("archive_sha256")
                if expected_checksum:
                    digest = sha256_file(archive)
                    if digest != expected_checksum:
                        raise ValueError("Model archive checksum mismatch")
                else:
                    digest = None
                source = Path(temporary) / "model"
                if model.get("directory"):
                    extract_root = Path(temporary) / "extract"
                    extract_root.mkdir()
                    with tarfile.open(archive) as bundle:
                        bundle.extractall(extract_root, filter="data")
                    source = extract_root / model["directory"]
                else:
                    source.mkdir()
                    archive.replace(source / model["files"][0])
            if not all((source / name).exists() for name in model["files"]):
                raise ValueError("Model archive is missing required files")
            check_control()
            source.replace(self.path(model_id))
        (self.path(model_id) / ".brevia.json").write_text(
            json.dumps(
                {**model, "downloaded_at": time.time(), "archive_sha256": digest},
                indent=2,
            ),
            encoding="utf-8",
        )
        self.event("model.status", {"model_id": model_id, "status": "ready"})
        return self.path(model_id)

    def delete(self, model_id):
        """删除指定模型目录，并发布未安装状态。"""
        path = self.local_path(model_id)
        if path.exists():
            shutil.rmtree(path)
        self.event(
            "model.status",
            {"model_id": model_id, "status": "ready" if self.is_bundled(model_id) else "not_installed"},
        )

    @staticmethod
    def device():
        """探测 ONNX Runtime 执行后端，并给出保守的推理线程数。"""
        requested = os.environ.get("BREVIA_ASR_BACKEND", "").lower()
        if requested not in {"", "cpu", "cuda", "coreml", "mps"}:
            raise ValueError("BREVIA_ASR_BACKEND must be cpu, cuda, coreml, or mps")
        if requested:
            # sherpa-onnx 没有 MPS provider；Apple 语音模型实测 CPU 更快，Metal
            # 仍由 llama.cpp 用于纪要与翻译。CUDA/CoreML 保留给专用运行时构件。
            backend = "cpu" if requested == "mps" else requested
            providers = {
                "cpu": ["CPUExecutionProvider"],
                "cuda": ["CUDAExecutionProvider"],
                "coreml": ["CoreMLExecutionProvider"],
            }[backend]
        else:
            try:
                import onnxruntime

                providers = onnxruntime.get_available_providers()
            except ImportError:
                providers = ["CPUExecutionProvider"]
            backend = "cuda" if "CUDAExecutionProvider" in providers else "cpu"
        return {
            "architecture": platform.machine(),
            "providers": providers,
            "backend": backend,
            "threads": max(1, min(4, (os.cpu_count() or 2) // 2)),
            "cores": os.cpu_count() or 2,
            # Apple Silicon 的语音模型虽走 CPU provider，但仍可使用 Metal 跑本地 LLM；
            # 不应仅因 ASR provider 是 CPU 而被误判为弱机。
            "weak": backend == "cpu" and platform.machine().lower() not in {"arm64", "aarch64"} and (os.cpu_count() or 2) <= 4,
        }

    @staticmethod
    def thread_budget(role):
        """按推理角色分配线程数，在低核机器上为实时字幕保留算力。

        每个模型都独立调用 ``device()`` 时，4 核机上流式 ASR、实时精修、声纹、
        标点会各自开 4 线程，八线程同时跑 native 推理，过度订阅导致互相抢核、
        字幕卡顿。这里把角色分为两类：

        - 实时关键路径（流式 ASR / 降噪 / 标点 / 在线语言识别）：保持
          ``min(4, cpu//2)``，与旧行为一致，保证字幕跟得上。
        - 精修 / 声纹 / 离线 VAD / 说话人聚类等并发度较高的任务：降到
          ``min(2, cpu//4)``，让出核给实时 ASR，避免抢占。

        ``device()["threads"]`` 仍作为「整机最大可用线程」，供会后离线精修等
        独占 CPU 的场景使用。
        """
        total = os.cpu_count() or 2
        realtime = {"streaming", "denoiser", "punctuation", "language"}
        if role in realtime:
            return max(1, min(4, total // 2))
        return max(1, min(2, total // 4))


class StreamingASR:
    """维护每条音轨的在线识别流，生成 partial 和 endpoint 结果。"""

    def __init__(self, manager, model_id, language="auto"):
        """创建流式识别器。

        Args:
            manager: 已初始化的 ``ModelManager``。
            model_id: 具备 ``streaming`` 能力且已安装的模型 ID。
            language: 会议语言；Nemotron 按流使用此值选择识别语言。
        """
        self.manager = manager
        self.model = manager.get(model_id)
        self.language = language or "auto"
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
            "num_threads": manager.thread_budget("streaming"),
            "provider": manager.device()["backend"],
            "enable_endpoint_detection": True,
            "rule1_min_trailing_silence": endpoint.get(
                "rule1_silence", SETTINGS["asr"]["endpoint_rule1_silence"]
            ),
            "rule2_min_trailing_silence": endpoint.get(
                "rule2_silence", SETTINGS["asr"]["endpoint_rule2_silence"]
            ),
            "rule3_min_utterance_length": endpoint.get(
                "maximum_utterance_seconds",
                SETTINGS["asr"]["maximum_utterance_seconds"],
            ),
        }
        files = [name for name in self.model["files"] if name.endswith(".onnx")]
        common.update(
            encoder=str(path / files[0]),
            decoder=str(path / files[1]),
            joiner=str(path / files[2]),
        )
        self.recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(**common)
        self.streams = {}
        self.lock = threading.Lock()

    def _stream(self, track):
        """返回音轨的识别流，首次访问时创建。"""
        if track not in self.streams:
            stream = self.recognizer.create_stream()
            if self.model["kind"] == "nemotron":
                stream.set_option("language", self.language)
            self.streams[track] = stream
        return self.streams[track]

    def _finalize(self, track):
        """结束并重置一条音轨的识别流，返回最终文本。"""
        stream = self.streams[track]
        stream.input_finished()
        while self.recognizer.is_ready(stream):
            self.recognizer.decode_stream(stream)
        result = self.recognizer.get_result(stream)
        self.recognizer.reset(stream)
        return result

    def accept(self, track, samples, sample_rate=16000, flush=False):
        """向一条音轨追加波形并推进解码。

        Args:
            track: 音轨键；不同键各自维护独立识别流。
            samples: 归一化到 ``[-1, 1]`` 的 float32 单声道样本。
            sample_rate: 样本率，当前录音链路固定为 16 kHz。
            flush: 是否强制结束当前句，通常用于停止录音。

        Returns:
            ``(识别结果, 是否句末)``；结果类型由 sherpa-onnx 模型决定。

        Notes:
            句末由 sherpa-onnx 的内置端点检测决定：尾静音（rule1/rule2）触发，
            连续语音则靠 rule3（``maximum_utterance_seconds``）兜底强制结束，
            或 ``flush`` 时结束。实时字幕保持「流式输出 → 精修原地覆盖」的
            单阶段体验，不再在 worker 里做软钉切分。
        """
        with self.lock:
            stream = self._stream(track)
            stream.accept_waveform(sample_rate, samples)
            while self.recognizer.is_ready(stream):
                self.recognizer.decode_stream(stream)
            result = self.recognizer.get_result(stream)
            endpoint = flush or self.recognizer.is_endpoint(stream)
            if endpoint:
                result = self._finalize(track)
        return result, endpoint

    def force_endpoint(self, track):
        """无尾静音时强制结束当前句，返回最终文本并重置流。"""
        with self.lock:
            if track not in self.streams:
                return ""
            return self._finalize(track)


class LiveDenoiser:
    """用 Sherpa-onnx 在线 GTCRN 降噪后再交给实时识别。"""

    def __init__(self, manager, model_id):
        """初始化在线降噪器。

        Args:
            manager: 已初始化的 ModelManager。
            model_id: 已安装的降噪模型 ID。
        """
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        config = sherpa_onnx.OnlineSpeechDenoiserConfig()
        config.model.gtcrn.model = str(manager.path(model_id) / "gtcrn_simple.onnx")
        config.model.num_threads = manager.thread_budget("denoiser")
        config.model.provider = manager.device()["backend"]
        if not config.validate():
            raise RuntimeError("Invalid live denoiser configuration")
        self.config = config
        self.engines = {}

    def accept(self, track, samples, sample_rate, flush=False):
        """按模型帧长处理一条音轨，并在结束时输出缓存尾音。"""
        import numpy
        import sherpa_onnx

        engine = self.engines.setdefault(
            track, sherpa_onnx.OnlineSpeechDenoiser(self.config)
        )
        output = [
            numpy.asarray(
                engine(
                    samples[start : start + engine.frame_shift_in_samples], sample_rate
                ).samples,
                dtype=numpy.float32,
            )
            for start in range(0, len(samples), engine.frame_shift_in_samples)
        ]
        if flush:
            output.append(numpy.asarray(engine.flush().samples, dtype=numpy.float32))
        return numpy.concatenate(output) if output else samples


class OfflineDenoiser:
    """在会后精修前清理整段录音，不改写原始音频文件。"""

    def __init__(self, manager, model_id):
        """初始化离线降噪器。

        Args:
            manager: 已初始化的 ModelManager。
            model_id: 已安装的降噪模型 ID。
        """
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        config = sherpa_onnx.OfflineSpeechDenoiserConfig()
        config.model.gtcrn.model = str(manager.path(model_id) / "gtcrn_simple.onnx")
        config.model.num_threads = manager.thread_budget("denoiser_offline")
        config.model.provider = manager.device()["backend"]
        if not config.validate():
            raise RuntimeError("Invalid offline denoiser configuration")
        self.engine = sherpa_onnx.OfflineSpeechDenoiser(config)

    def process(self, samples, sample_rate):
        """处理音频样本并返回降噪后的波形。"""
        import numpy

        return numpy.asarray(
            self.engine(samples, sample_rate).samples, dtype=numpy.float32
        )


class LanguageIdentifier:
    """使用 Whisper 的原生语言识别替代文本启发式判断。"""

    def __init__(self, manager, model_id="whisper-large-v3"):
        """初始化语言识别器。

        Args:
            manager: 已初始化的 ModelManager。
            model_id: 已安装的 Whisper 模型 ID。
        """
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        path = manager.path(model_id)
        files = manager.get(model_id)["files"]
        encoder = next(name for name in files if "encoder" in name)
        decoder = next(name for name in files if "decoder" in name)
        config = sherpa_onnx.SpokenLanguageIdentificationConfig(
            whisper=sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
                encoder=str(path / encoder),
                decoder=str(path / decoder),
            ),
            num_threads=manager.thread_budget("language"),
            provider=manager.device()["backend"],
        )
        if not config.validate():
            raise RuntimeError("Invalid language-identification configuration")
        self.engine = sherpa_onnx.SpokenLanguageIdentification(config)

    def identify(self, samples, sample_rate):
        """识别音频样本的语言并返回语言代码。"""
        stream = self.engine.create_stream()
        stream.accept_waveform(sample_rate, samples)
        return self.engine.compute(stream)


def _vad_config(manager, model_id, vad_params=None):
    """创建实时与离线流程共用的 VAD 配置，可覆盖 Silero 阈值/时长参数。"""
    if not manager.is_ready(model_id):
        raise RuntimeError(f"Model {model_id} is not installed")
    import sherpa_onnx

    config = sherpa_onnx.VadModelConfig()
    model = manager.get(model_id)
    config.silero_vad.model = str(manager.path(model_id) / model["files"][0])
    config.sample_rate = 16000
    vad_params = vad_params or {}
    for key in (
        "threshold",
        "min_silence_duration",
        "min_speech_duration",
        "max_speech_duration",
    ):
        if key in vad_params and vad_params[key] is not None:
            setattr(config.silero_vad, key, float(vad_params[key]))
    return config


class OfflineVAD:
    """用会议选择的 VAD 模型生成保留原时间轴的语音区间。"""

    def __init__(self, manager, model_id="silero-vad", vad_params=None):
        """初始化离线 VAD 检测器。

        Args:
            manager: 已初始化的 ModelManager。
            model_id: 已安装的 VAD 模型 ID。
            vad_params: 可选阈值/时长覆盖，用于按语言调优分段粒度。
        """
        import sherpa_onnx

        self.sherpa_onnx = sherpa_onnx
        self.config = _vad_config(manager, model_id, vad_params)

    def process(self, samples, sample_rate=16000):
        if sample_rate != self.config.sample_rate:
            raise ValueError(f"VAD requires {self.config.sample_rate} Hz audio")
        # 检测器在此缓冲区中保留未完成的语音段。按输入大小分配，而不是在连续会议音频上反复增长。
        buffer_seconds = max(100, (len(samples) + sample_rate - 1) // sample_rate + 1)
        detector = self.sherpa_onnx.VoiceActivityDetector(self.config, buffer_seconds)
        segments = []

        def drain():
            while not detector.empty():
                segment = detector.front
                segments.append(
                    {
                        "start_ms": round(segment.start * 1000 / sample_rate),
                        "end_ms": round(
                            (segment.start + len(segment.samples)) * 1000 / sample_rate
                        ),
                    }
                )
                detector.pop()

        for start in range(0, len(samples), sample_rate * 10):
            detector.accept_waveform(samples[start : start + sample_rate * 10])
            drain()
        detector.flush()
        drain()
        return segments


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
            num_threads=manager.thread_budget("punctuation"),
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
        """加载中文在线标点模型；模型未安装时抛出 RuntimeError。"""
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        import sherpa_onnx

        path = manager.path(model_id)
        model = sherpa_onnx.OfflinePunctuationModelConfig(
            ct_transformer=str(path / "model.int8.onnx"),
            num_threads=manager.thread_budget("punctuation"),
            provider=manager.device()["backend"],
        )
        self.engine = sherpa_onnx.OfflinePunctuation(
            sherpa_onnx.OfflinePunctuationConfig(model=model)
        )

    def apply(self, text):
        """返回带标点的中文；空文本原样返回。"""
        return self.engine.add_punctuation(text) if text else text


class SpeakerTracker:
    """按声纹相似度为连续语音分配稳定的会议内说话人 ID。"""

    def __init__(self, manager, threshold=None, max_speakers=None, threads=None):
        """加载声纹模型；阈值越低，越倾向于合并为同一说话人。"""
        config = SETTINGS["diarization"]
        model_id = SPEAKER_EMBEDDING_MODEL_ID
        if not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        model = manager.path(model_id) / manager.get(model_id)["files"][0]
        extractor_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(model),
            num_threads=threads or manager.thread_budget("speaker"),
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
        return (
            self.assign_embedding(embedding)
            if embedding is not None
            else self.last_speaker or "spk-1"
        )

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
        if similarities and (
            max(similarities) >= self.threshold
            or (self.max_speakers and len(self.centers) >= self.max_speakers)
        ):
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

    # FunASR Nano 的语言提示会拼进 ``语音转写成{language}`` 的 prompt，
    # 因此使用自然语言名称而不是 ISO 代码，避免自动检测把中文误判成日语等。
    FUNASR_NANO_LANGUAGE_HINTS = {
        "zh": "中文",
        "en": "英文",
        "yue": "粤语",
        "ja": "日语",
        "ko": "韩语",
        "fr": "法语",
        "de": "德语",
        "es": "西班牙语",
        "ru": "俄语",
    }

    def __init__(self, manager, model_id, language=None, threads=None):
        """加载 Qwen3-ASR 会后精修模型。

        Args:
            manager: 已初始化的 ``ModelManager``。
            model_id: 已安装的 Qwen3-ASR 模型 ID。
            language: 会议语言代码；支持的语言会强制模型按该语言转写，
                避免短窗口自动检测把中文误判成日语等其他语言。
            threads: 推理线程数；默认用 ``thread_budget("refine")`` 的低预算
                让核给实时流式 ASR。会后离线精修（独占 CPU）可显式传
                ``manager.device()["threads"]`` 获得满线程。

        """
        model = manager.get(model_id)
        self.model_id = model_id
        if model["kind"] not in {
            "qwen3",
            "whisper",
            "fire-red-asr-ctc",
            "funasr-nano",
        } or not manager.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        common = dict(
            num_threads=threads or manager.thread_budget("refine"),
            provider=manager.device()["backend"],
        )
        if model["kind"] == "fire-red-asr-ctc":
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_fire_red_asr_ctc(
                model=str(path / "model.int8.onnx"),
                tokens=str(path / "tokens.txt"),
                **common,
            )
        elif model["kind"] == "funasr-nano":
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_funasr_nano(
                encoder_adaptor=str(path / "encoder_adaptor.int8.onnx"),
                llm=str(path / "llm.int8.onnx"),
                embedding=str(path / "embedding.int8.onnx"),
                tokenizer=str(path / "Qwen3-0.6B"),
                language=self._funasr_nano_language(language),
                **common,
            )
        elif model["kind"] == "whisper":
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=str(path / model["files"][0]),
                decoder=str(path / model["files"][1]),
                tokens=str(path / model["files"][2]),
                language=self._whisper_language(language),
                **common,
            )
        else:
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
                conv_frontend=str(path / "conv_frontend.onnx"),
                encoder=str(path / "encoder.int8.onnx"),
                decoder=str(path / "decoder.int8.onnx"),
                tokenizer=str(path / "tokenizer"),
                **common,
                max_total_len=1024,
                max_new_tokens=512,
            )

    @classmethod
    def _funasr_nano_language(cls, language):
        """把会议语言映射为 FunASR Nano 的自然语言提示；``auto`` 保持自动。"""
        if not language or language == "auto":
            return ""
        return cls.FUNASR_NANO_LANGUAGE_HINTS.get(language, "")

    @staticmethod
    def _whisper_language(language):
        """Whisper 使用 ISO 639-1 代码；``auto`` 保持自动检测。"""
        if not language or language == "auto":
            return ""
        return language

    def decode(self, samples, sample_rate=16000):
        """返回文本；实时精修不需要词级时间轴。"""
        stream = self.recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()

    def decode_words(self, samples, sample_rate=16000):
        """返回文本及模型提供的 token 级时间戳；没有时保留空列表。"""
        stream = self.recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self.recognizer.decode_stream(stream)
        result = stream.result
        tokens = list(getattr(result, "tokens", []) or [])
        timestamps = list(getattr(result, "timestamps", []) or [])
        if not tokens or len(tokens) != len(timestamps):
            return result.text.strip(), []
        words = []
        for index, token in enumerate(tokens):
            if not token or token.startswith("<|"):
                continue
            text = token.replace("▁", " ")
            start_ms = round(float(timestamps[index]) * 1000)
            end_ms = round(float(timestamps[index + 1]) * 1000) if index + 1 < len(timestamps) else start_ms + 200
            words.append({"text": text, "start_ms": start_ms, "end_ms": max(start_ms + 1, end_ms)})
        return result.text.strip(), words


class OfflineDiarizer:
    """用语音分段、声纹向量和聚类生成单轨说话人时间段。"""

    def __init__(
        self,
        manager,
        num_speakers=None,
        threshold=None,
        segmentation_id=None,
    ):
        """创建离线说话人分离器。

        Args:
            manager: 提供 segmentation 与 embedding 模型路径的模型管理器。
            num_speakers: 已知人数；``None`` 使用配置，``-1`` 表示自动估计。
            threshold: 聚类阈值；``None`` 使用 ``settings.json`` 的默认值。
        """
        config = SETTINGS["diarization"]
        segmentation_id = segmentation_id or config["segmentation_model_id"]
        embedding_id = SPEAKER_EMBEDDING_MODEL_ID
        if not all(
            manager.is_ready(model_id) for model_id in (segmentation_id, embedding_id)
        ):
            raise RuntimeError(
                f"Models {segmentation_id}, {embedding_id} are not installed"
            )
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        segmentation = (
            manager.path(segmentation_id) / manager.get(segmentation_id)["files"][0]
        )
        embedding = manager.path(embedding_id) / manager.get(embedding_id)["files"][0]
        diarization_config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(segmentation)
                ),
                num_threads=manager.thread_budget("diarization"),
                provider=manager.device()["backend"],
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(embedding),
                num_threads=manager.thread_budget("diarization"),
                provider=manager.device()["backend"],
            ),
            clustering=sherpa_onnx.FastClusteringConfig(
                num_clusters=config["num_speakers"]
                if num_speakers is None
                else num_speakers,
                threshold=config["cluster_threshold"]
                if threshold is None
                else threshold,
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
            raise ValueError(
                f"Diarization requires {self.diarizer.sample_rate} Hz audio"
            )
        return [
            {
                "start_ms": round(segment.start * 1000),
                "end_ms": round(segment.end * 1000),
                "speaker": f"spk-{segment.speaker + 1}",
            }
            for segment in self.diarizer.process(samples).sort_by_start_time()
        ]
