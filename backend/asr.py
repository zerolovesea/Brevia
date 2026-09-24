"""本地模型管理，以及跨平台语音引擎的兼容边界。"""

import functools
import hashlib
import http.client
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

from .config import SETTINGS, SPEAKER_EMBEDDING_MODEL_ID
from .worker_common import ModelNotInstalled


DOWNLOAD_TIMEOUT_SECONDS = 30
DOWNLOAD_RETRIES = 5
DOWNLOAD_FREE_SPACE_MULTIPLIER = 2
DEFAULT_REFINED_MODEL_ID = "funasr-nano-int8"
# 参照 Meetily 的 pre_speech_pad：每个语音段在检测到的起点前再补一段刚喂入的
# 原始音频，抵消端点检测/采集的句首抖动，避免独白首字/首词被切掉。
DEFAULT_SPEECH_PAD_MS = 300
# 切开连续语音（到目标长度/硬上限）时的回看长度：切点落在句子中间，切点上的那个字
# 两段都听不全——前一段音频被截断，识别器给补个句号；后一段从半个字开始，识别器
# 干脆丢掉它。把「已交付水位」退到切点之前，下一段的首字回补就能越过切点，让边界字
# 在新的上下文里被完整识别（重复的部分由接缝去重消掉）。
CUT_OVERLAP_MS = 400
# 离线识别器能稳定承载的最长语音段（秒）。实时整句链路用它与语言级
# max_speech_duration 配置取较小值：FunASR Nano 的 KV 容量约 512，实测音频
# 超过 ~28 s 后输出开始截断、约 29.5 s 起整段解码为空——连续独白一旦按 30 s
# 硬切就会整段漏识别。各模型按自己的 max_total_len/输入上限给保守值。
REFINED_MODEL_MAX_SPEECH_SECONDS = {
    "funasr-nano": 22.0,
    "qwen3": 50.0,
    "whisper": 30.0,
    "fire-red-asr-ctc": 25.0,
    # Parakeet TDT 的 sherpa-onnx 导出按 10 s 编码窗口发布（官方 QNN 版即
    # ...-10s-transducer），转写质量以此窗口最优。取 20 s 留出余量但仍然避免
    # 整段独白塞进一次编码——具体上限需要实测确认，见设计文档 §2.8 待办。
    "nemo-transducer": 20.0,
}
# 实时整句链路的默认段长上限（秒）。这是「用户可调的下压阀门」，不是模型容量表：
# 有效上限始终取三者的最小值——``vad[语言].max_speech_duration``、识别模型的
# ``REFINED_MODEL_MAX_SPEECH_SECONDS``、以及本设置。因此本值调**大**没有效果（它只会
# 被前面两者夹住），调小才会真的缩短实时段长；真正的模型容量由模型表独立保证，
# 不会因为用户改这里而越过 KV 容量。
DEFAULT_LIVE_MAX_SPEECH_SECONDS = 22.0
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


def _sysctl_physical_cores():
    """macOS：读 ``hw.physicalcpu``；失败时返回 ``None``。"""
    try:
        result = subprocess.run(
            ["sysctl", "-n", "hw.physicalcpu"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        value = int(result.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return value if value > 0 else None


def _proc_cpuinfo_physical_cores():
    """Linux：按 ``physical id`` + ``core id`` 去重得到物理核数；失败时返回 ``None``。"""
    try:
        blocks = Path("/proc/cpuinfo").read_text(encoding="utf-8").split("\n\n")
    except OSError:
        return None
    pairs = set()
    for block in blocks:
        fields = {}
        for line in block.splitlines():
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
        physical, core = fields.get("physical id"), fields.get("core id")
        if physical is not None and core is not None:
            pairs.add((physical, core))
    return len(pairs) or None


def sha256_file(path):
    """计算文件的 SHA256 哈希值。"""
    digest = hashlib.sha256()
    with path.open("rb") as downloaded:
        for block in iter(lambda: downloaded.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_model_catalog(path=None):
    """读取按当前平台过滤后的模型清单。

    纯读取、无副作用：打包前置校验（``backend/preflight_package.py``）要在不触碰磁盘
    的前提下算出随包模型的目录名，不能走 ``ModelManager.__init__``——那里会顺手删掉
    退役模型的本地副本，正好会把校验要发现的残留提前抹掉。
    """
    path = Path(path) if path else Path(__file__).with_name("models.json")
    system = platform.system().lower()
    return {
        item["id"]: item
        for item in json.loads(path.read_text(encoding="utf-8"))
        if not item.get("platforms") or system in item["platforms"]
    }


def model_directory_name(model_id, revision):
    """模型在本地/随包目录里的版本化目录名。"""
    return f"{model_id}-{revision.replace('/', '-')}"


def model_files_present(model, path):
    """模型目录里清单声明的文件是否齐全（纯检查，不创建也不下载）。"""
    path = Path(path)
    return path.is_dir() and all((path / name).exists() for name in model["files"])


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
        self.catalog = load_model_catalog()
        self.remove_deprecated_models()

    def remove_deprecated_models(self):
        """删除已从清单移除、且应用不再提供删除入口的旧模型。

        分两类：(1) 名字前缀命中 ``DEPRECATED_MODEL_PREFIXES`` 的历史遗留；
        (2) 清单里标了 ``retired: true`` 的模型——它仍然留在清单里（历史会议的
        ``refined_model_id`` 可能指向它，``get()`` 必须还能解析），但界面已经不显示、
        也不再提供删除入口。留着本地副本只会变成用户看不见也删不掉的几 GB 占用。
        """
        for path in self.root.iterdir():
            if path.is_dir() and path.name.startswith(DEPRECATED_MODEL_PREFIXES):
                shutil.rmtree(path, ignore_errors=True)
        for model in self.catalog.values():
            if model.get("retired"):
                shutil.rmtree(self.local_path(model["id"]), ignore_errors=True)

    def cleanup_unlisted(self):
        """仅删除带 Brevia 元数据、但已不在当前模型清单的本地模型。"""
        removed, freed_bytes = [], 0
        for path in self.root.iterdir():
            marker = path / ".brevia.json"
            if not path.is_dir() or not marker.is_file():
                continue
            try:
                model_id = json.loads(marker.read_text(encoding="utf-8")).get("id")
            except (OSError, json.JSONDecodeError):
                continue
            if model_id and model_id not in self.catalog:
                freed_bytes += sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
                shutil.rmtree(path)
                removed.append(path.name)
        return {"removed": removed, "freed_bytes": freed_bytes}

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
        return self.root / model_directory_name(model_id, model["revision"])

    def bundled_path(self, model_id):
        """返回随安装包提供的模型路径；开发环境可能不存在。"""
        if not self.bundled_root:
            return None
        model = self.get(model_id)
        return self.bundled_root / model_directory_name(model_id, model["revision"])

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
        return model_files_present(self.get(model_id), path)

    def is_bundled(self, model_id):
        """检查模型是否可直接从安装包使用。"""
        bundled = self.bundled_path(model_id)
        return bool(bundled and self._is_ready(model_id, bundled))

    def is_ready(self, model_id):
        """检查用户目录或安装包中的模型是否完整。

        目录里没有的 ID（旧会议记录、或另一平台留下的高级设置）算「未就绪」，
        不抛异常：这是个查询，调用方要的是「能不能用」，而不是让整条链路中断。
        """
        if not self.is_known(model_id):
            return False
        return self._is_ready(model_id, self.local_path(model_id)) or self.is_bundled(model_id)

    def is_known(self, model_id):
        """该 ID 是否属于当前平台的模型目录。"""
        return model_id in self.catalog

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
        # 退役模型不接受下载。清单里保留它的条目只是为了让历史会议的 id 仍能解析；
        # 界面已经不提供入口，但 ``model_required`` 错误链会把旧会议的 id 原样带回来，
        # 于是用户为已下线的模型白下几 GB——而 ``remove_deprecated_models`` 会在下次
        # 启动/下个分离分块子进程里再删掉它，形成下载—删除循环。
        if model.get("retired"):
            raise ValueError(f"Model {model_id} is no longer offered")
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
    @functools.lru_cache(maxsize=1)
    def physical_cores():
        """探测物理核数，探测不到时回落到逻辑核数。

        按核数折算耗时的场景必须用物理核：超线程不提供实测到的线性加速，而
        ``os.cpu_count()`` 返回逻辑核。在 4C/8T 机器上直接拿逻辑核做除数，会把估算
        时间砍掉一半，于是「预计要等太久」的判断被推迟一倍。

        Returns:
            物理核数（探测失败时为 ``os.cpu_count()``，再失败为 2）。
        """
        fallback = os.cpu_count() or 2
        detected = None
        if sys.platform == "darwin":
            detected = _sysctl_physical_cores()
        elif sys.platform.startswith("linux"):
            detected = _proc_cpuinfo_physical_cores()
        return detected if detected and detected > 0 else fallback

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
            # 耗时代价按物理核折算（见 ModelManager.physical_cores）。与 cores 分开暴露：
            # cores 表示调度意义上的并行度，physical_cores 表示真实吞吐量上限。
            "physical_cores": ModelManager.physical_cores(),
            # Apple Silicon 的语音模型虽走 CPU provider，但仍可使用 Metal 跑本地 LLM；
            # 不应仅因 ASR provider 是 CPU 而被误判为弱机。
            # Windows commonly reports logical processors: a 4C/8T mobile CPU is still
            # too small for CPU-only live ASR plus a local LLM.  Treat that class as weak
            # so the UI picks the responsive path instead of the quality-first default.
            "weak": backend == "cpu" and platform.machine().lower() not in {"arm64", "aarch64"} and (os.cpu_count() or 2) <= 8,
        }

    @staticmethod
    def thread_budget():
        """整句识别保持低线程预算，给采集和 AI 笔记留出 CPU。"""
        total = os.cpu_count() or 2
        return max(1, min(2, total // 4))


def _vad_config(manager, model_id, vad_params=None):
    """创建实时与离线流程共用的 VAD 配置，可覆盖 Silero 阈值/时长参数。"""
    if not manager.is_ready(model_id):
        raise ModelNotInstalled([model_id])
    import sherpa_onnx

    config = sherpa_onnx.VadModelConfig()
    model = manager.get(model_id)
    if "vad" not in model.get("stages", []):
        raise ValueError("A VAD model is required")
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


class SentenceVAD:
    """短停顿检测、合并短语后交付音频；回补不得越过已交付的样本。

    每个交付段是 ``(start_ms, end_ms, samples, boundary)``；``boundary`` 说明这段
    是**怎么**结束的，供上层判断末尾标点可不可信：

    - ``endpoint``：说话人真的停顿了（检测器连续 ``sentence_gap_ms`` 没有语音），
      段落末尾是语义端点，句末标点可信。
    - ``pause``：到目标长度后切在能量低谷上（一句话中间的换气也算），末尾标点是
      识别器对截断音频的补全，不可信。
    - ``cut``：到连续语音硬上限被切开，或检测器漏判的安静语音兜底段，末尾同样不可信。
    """

    def __init__(
        self,
        manager,
        model_id="silero-vad",
        language="auto",
        max_speech_duration=None,
        speech_pad_ms=None,
    ):
        import sherpa_onnx

        self.sherpa_onnx = sherpa_onnx
        params = dict(SETTINGS["vad"].get(language, SETTINGS["vad"]["default"]))
        if max_speech_duration is not None:
            params["max_speech_duration"] = min(
                params.get("max_speech_duration") or 1e9,
                float(max_speech_duration),
            )
        # 先发现播客中的短停顿，再聚合到适合单次识别的长度。
        self.sentence_gap_ms = round(params.get("min_silence_duration", 0.5) * 1000)
        # 自动语言需要连续上下文；过短的独立音节容易被识别成其他语言。
        if language == "auto":
            self.sentence_gap_ms = max(self.sentence_gap_ms, 2000)
        params["min_silence_duration"] = 0.1
        self.target_seconds = 8.0
        self.speech_pad_ms = max(0, DEFAULT_SPEECH_PAD_MS if speech_pad_ms is None else int(speech_pad_ms))
        # 段首回补与切点回看共用同一段历史缓冲、同一个上限（``_new_state`` 的
        # ``pad_samples``）：回看要够长才能救回切点上的字，所以取两者的较大值。
        # 段首因此会多补一点原始音频（只会让句首更完整），但绝不会越过已经交付的
        # 水位——``_history_prefix`` 会把它夹在 ``delivered_until`` 之内。
        self.cut_overlap_ms = max(self.speech_pad_ms, CUT_OVERLAP_MS)
        # 实时整句链路的硬上限：取「模型能承载的最长段」与「用户配置上限」的较小值。
        # 这里以前把 12.0 写死，等于把上面那张按模型实测出来的容量表整个作废——
        # FunASR Nano（22 s）、Parakeet（20 s）、Qwen3-ASR（50 s）在实时链路上
        # 一律被切成 12 s，连续独白被多切 2–4 倍，实时率白白变差。
        # 现在由 live_asr.max_speech_seconds 配置。注意它只是「下压阀门」：
        # 有效值 = min(vad 语言配置, 模型容量, 本设置)，所以调大不生效、调小才生效，
        # 模型 KV 容量永远由 REFINED_MODEL_MAX_SPEECH_SECONDS 独立兜住。
        configured_cap = float(
            SETTINGS.get("live_asr", {}).get("max_speech_seconds") or DEFAULT_LIVE_MAX_SPEECH_SECONDS
        )
        self.max_speech_seconds = min(params["max_speech_duration"], configured_cap)
        # 回补与最后一个 512 样本块也计入模型上限，不能在切完后额外超出。
        params["max_speech_duration"] = max(0.1, self.max_speech_seconds - self.cut_overlap_ms / 1000 - 512 / 16000)
        self.config = _vad_config(manager, model_id, params)
        self.tracks = {}
        # 检测器漏判的安静语音兜底（见 ``_finish_idle_run``）：音乐里的轻声、
        # 电话音等整段被判成非语音时，字幕里会凭空少一句且没有任何提示。
        recovery = SETTINGS.get("live_asr", {})
        self.recover_enabled = bool(recovery.get("quiet_speech_recovery", 1))
        self.recover_min_seconds = float(recovery.get("quiet_speech_min_seconds", 1.0))
        self.recover_max_seconds = float(recovery.get("quiet_speech_max_seconds", 20.0))
        self.recover_level_ratio = float(recovery.get("quiet_speech_level_ratio", 0.08))

    def _new_state(self, start_ms):
        pad_ms = max(
            max(int(getattr(self, "speech_pad_ms", 0) or 0), 0),
            int(getattr(self, "cut_overlap_ms", CUT_OVERLAP_MS) or 0),
        )
        return {
            "detector": self.sherpa_onnx.VoiceActivityDetector(
                self.config,
                max(60, self.config.silero_vad.max_speech_duration + 2),
            ),
            "origin_ms": start_ms,
            "samples": 0,
            "speech_start": None,
            "delivered_until": round(start_ms * 16),
            "pending": None,
            "pad_samples": pad_ms * 16,
            # 保留最近喂入的原始音频，用于给段首回补 ``speech_pad_ms``。原始双轨
            # 分别落盘，这里只缓存浮点样本：边界容量约为 pad + 最长语音段 + 余量，
            # 长语音会按段切分，因此缓冲不会随会议时长增长。
            "hist": [],
            "hist_from": round(start_ms * 16),
            "hist_total": 0,
            "hist_bound": pad_ms * 16
            + int((self.config.silero_vad.max_speech_duration + 2.5) * 16000),
            # 漏判兜底：检测器已确认过语音（``speech_seen``）、已确认语音的平均能量
            # （``speech_level``，只在语音帧上更新，因此不受静音拖低），以及最近这段
            # 检测器没有认领的音频（``idle``）。
            "speech_seen": False,
            "speech_level": 0.0,
            "idle": [],
            "idle_total": 0,
            "idle_after_speech": False,
        }

    def _remember(self, state, chunk):
        """把喂给检测器的一段原始音频计入历史（仅启用回补时需要）。"""
        if not state["pad_samples"]:
            return
        hist = state["hist"]
        hist.append(chunk)
        state["hist_total"] += len(chunk)
        overflow = state["hist_total"] - state["hist_bound"]
        while overflow > 0 and hist:
            first = hist[0]
            if len(first) > overflow:
                hist[0] = first[overflow:]
                state["hist_from"] += overflow
                state["hist_total"] -= overflow
                break
            hist.pop(0)
            state["hist_from"] += len(first)
            state["hist_total"] -= len(first)
            overflow -= len(first)

    def _history_prefix(self, state, absolute_start):
        """返回段起点前最多 ``speech_pad_ms`` 的原始音频；无可用历史返回 None。"""
        import numpy

        if not state["pad_samples"] or not state["hist_total"]:
            return None
        lo = absolute_start - state["pad_samples"]
        if lo >= state["hist_from"] + state["hist_total"]:
            return None
        lo = max(lo, state["hist_from"], state["delivered_until"])
        if lo >= absolute_start:
            return None
        return numpy.concatenate(list(state["hist"]))[
            lo - state["hist_from"]: absolute_start - state["hist_from"]
        ]

    def accept(self, track, samples, start_ms):
        state = self.tracks.get(track)
        completed = []
        if state and abs(start_ms - (state["origin_ms"] + state["samples"] / 16)) > 2:
            completed.extend(self.flush(track))
            state = None
        if state is None:
            state = self.tracks[track] = self._new_state(start_ms)
        # 以短块喂入并及时排空；即使调用者回放大块音频也不撑爆原生环形缓冲。
        for offset in range(0, len(samples), 512):
            chunk = samples[offset:offset + 512]
            state["samples"] += len(chunk)
            self._remember(state, chunk)
            detector = state["detector"]
            detector.accept_waveform(chunk)
            segments = self._drain(state)
            completed.extend(self._collect(state, segments, "cut"))
            if segments or not detector.is_speech_detected():
                state["speech_start"] = None
            if detector.is_speech_detected() and state["speech_start"] is None:
                state["speech_start"] = max(0, detector.current_segment.start)
            if state["speech_start"] is not None:
                pending = state["pending"]
                start = pending[0] if pending else state["origin_ms"] + state["speech_start"] / 16
                elapsed = (state["origin_ms"] + state["samples"] / 16 - start) / 1000
                hard_end = elapsed >= self.config.silero_vad.max_speech_duration
                quiet_end = elapsed >= getattr(self, "target_seconds", 8) and self._at_quiet_boundary(state)
                if hard_end or quiet_end:
                    # 到目标长度后在低能量停顿交付；背景声一直触发 VAD 时也不无限等。
                    boundary = "cut" if hard_end else "pause"
                    detector.flush()
                    completed.extend(self._collect(state, self._drain(state), boundary))
                    if state["pending"]:
                        completed.append((*state["pending"], boundary))
                        state["pending"] = None
                    detector.reset()
                    state["origin_ms"] += state["samples"] / 16
                    state["samples"] = 0
                    # 切点回看：把「已交付水位」退到切点之前，下一段的首字回补
                    # （``_history_prefix``）因此能越过切点，把被切在词中间的那个字
                    # 连同左侧上下文一起交给识别器。切点上的重复内容由上层的接缝
                    # 去重消掉，不会重复出词。
                    state["delivered_until"] = (
                        round(state["origin_ms"] * 16) - state["pad_samples"]
                    )
                    state["idle"].clear()
                    state["idle_total"] = 0
                    state["speech_start"] = None
            pending = state["pending"]
            if pending and not detector.is_speech_detected() and state["origin_ms"] + state["samples"] / 16 - pending[1] >= getattr(self, "sentence_gap_ms", 700):
                completed.append((*pending, "endpoint"))
                state["pending"] = None
            self._track_quiet_audio(state, chunk, bool(segments) or detector.is_speech_detected(), completed)
        return completed

    def _track_quiet_audio(self, state, chunk, in_speech, completed):
        """收集检测器没有认领的音频，把成段的「安静语音空洞」交给识别器兜底。

        检测器对音乐里的轻声、电话音等会整段判成非语音：这段内容既不出现在字幕里，
        也没有任何提示，只有回放录音才能发现。兜底只在**已确认语音之间**的空洞上生效
        （前后都有语音）、时长在 ``recover_min_seconds`` 以上、能量接近已确认语音水平，
        因此开场/收尾的纯音乐不会被卷进来；识别器给出空文本时上层会直接丢弃。

        ``in_speech`` 只取检测器的判断，不含还没被端点确认的暂存段：空洞从语音
        真正结束的那一刻开始累积，暂存段的端点确认（``sentence_gap_ms``，自动语言
        2 秒）不会把空洞开头那段语音算到兜底之外。
        """
        import numpy

        if not getattr(self, "recover_enabled", True):
            return
        level = float(numpy.sqrt(numpy.mean(numpy.square(chunk, dtype=numpy.float64))))
        if in_speech:
            state["speech_seen"] = True
            state["speech_level"] = 0.999 * state["speech_level"] + 0.001 * level
            self._finish_idle_run(state, completed, len(chunk))
            return
        idle = state["idle"]
        if not idle:
            # 空洞之前是否已经出现过语音：开场/收尾的纯音乐不算「被漏判的语音」。
            state["idle_after_speech"] = state["speech_seen"]
        idle.append(chunk)
        state["idle_total"] += len(chunk)
        bound = int(getattr(self, "recover_max_seconds", 20.0) * 16000)
        while state["idle_total"] > bound and idle:
            first = idle[0]
            if len(first) > state["idle_total"] - bound:
                over = state["idle_total"] - bound
                idle[0] = first[over:]
                state["idle_total"] -= over
                break
            idle.pop(0)
            state["idle_total"] -= len(first)

    def _finish_idle_run(self, state, completed, trailing_samples=0):
        """语音重新出现：把刚才的空洞当作候选音频交付（能量不足或太短则丢弃）。"""
        import numpy

        run, total = state["idle"], state["idle_total"]
        state["idle"], state["idle_total"] = [], 0
        if not run or not state["idle_after_speech"]:
            return
        samples = run[0] if len(run) == 1 else numpy.concatenate(run)
        run_end_ms = round(state["origin_ms"] + (state["samples"] - trailing_samples) / 16)
        run_start_ms = run_end_ms - round(total / 16)
        # 检测器要攒够一个判决窗口才会说「有语音」，回补段首的 300ms 也由正常段落负责：
        # 空洞末尾这段其实已经是新语音，留着会让识别器把整段语言判成新段落那门语言。
        keep_ms = run_end_ms
        onset = state.get("speech_start")
        if onset is not None:
            onset_ms = round(state["origin_ms"] + onset / 16) - round(getattr(self, "speech_pad_ms", 0))
            if onset_ms <= run_start_ms:
                return
            keep_ms = onset_ms
            samples = samples[: round((keep_ms - run_start_ms) * 16)]
        trimmed = trim_quiet_speech(
            samples, run_start_ms, keep_ms, state["speech_level"],
            getattr(self, "recover_min_seconds", 1.0),
            getattr(self, "recover_level_ratio", 0.08),
        )
        if trimmed:
            start_ms, end_ms, audio = trimmed
            completed.append((start_ms, end_ms, audio, "cut"))

    @staticmethod
    def _at_quiet_boundary(state):
        import numpy

        # ponytail: 用最近 2 秒的相对能量估计 80ms 停顿；恒定噪声仍走时长兜底。
        if state["hist_total"] < 32000:
            return False
        recent = numpy.concatenate(state["hist"])[-32000:]
        energy = numpy.mean(recent.reshape(-1, 320) ** 2, axis=1)
        speech_energy = numpy.quantile(energy[:-4], 0.75)
        return bool(speech_energy > 1e-7 and numpy.max(energy[-4:]) < speech_energy * 0.16)

    def _collect(self, state, segments, boundary="cut"):
        """合并相邻短停顿的语音段；``boundary`` 是本次排空时**强制**交付段的原因。

        因检测器报告停顿而交付的段（新段与暂存段之间隔了 ``sentence_gap_ms``）永远是
        ``endpoint``；只有到目标长度或硬上限被切开的段才用调用方给的 ``boundary``。
        """
        import numpy

        completed = []
        maximum_ms = getattr(self, "max_speech_seconds", self.config.silero_vad.max_speech_duration) * 1000
        for segment in segments:
            pending = state["pending"]
            if pending:
                gap = segment[0] - pending[1]
                if gap < getattr(self, "sentence_gap_ms", 700) and segment[1] - pending[0] <= maximum_ms:
                    segment = (pending[0], segment[1], numpy.concatenate([
                        pending[2], numpy.zeros(max(0, round(gap * 16)), dtype=numpy.float32), segment[2]
                    ]))
                else:
                    completed.append((*pending, "endpoint"))
            state["pending"] = segment
            if segment[1] - segment[0] >= getattr(self, "target_seconds", 0) * 1000:
                completed.append((*segment, boundary))
                state["pending"] = None
        return completed

    def flush(self, track):
        state = self.tracks.pop(track, None)
        if state is None:
            return []
        state["detector"].flush()
        completed = self._collect(state, self._drain(state), "endpoint")
        if state["pending"]:
            completed.append((*state["pending"], "endpoint"))
            state["pending"] = None
        return completed

    def _drain(self, state):
        import numpy

        detector = state["detector"]
        segments = []
        while not detector.empty():
            segment = detector.front
            start = max(0, segment.start, state["delivered_until"] - round(state["origin_ms"] * 16))
            end = min(segment.start + len(segment.samples), state["samples"])
            samples = numpy.asarray(segment.samples, dtype=numpy.float32)[
                start - segment.start:end - segment.start
            ].copy()
            if len(samples):
                origin = state["origin_ms"]
                end_ms = round(origin + end / 16)
                start_ms = round(origin + start / 16)
                if state.get("pad_samples"):
                    prefix = self._history_prefix(state, round(origin * 16) + start)
                    if prefix is not None and len(prefix):
                        samples = numpy.concatenate([prefix, samples])
                        start_ms = round((round(origin * 16) + start - len(prefix)) / 16)
                state["delivered_until"] = round(origin * 16) + end
                segments.append((start_ms, end_ms, samples))
            detector.pop()
        return segments


def trim_quiet_speech(samples, start_ms, end_ms, speech_level, minimum_seconds=1.0, level_ratio=0.08):
    """在检测器未认领的音频里裁出值得识别的区间；不值得则返回 ``None``。

    返回 ``(start_ms, end_ms, samples)``：切掉首尾低于噪声门限的部分（各留 100ms），
    并要求有效部分不短于 ``minimum_seconds``、覆盖比例不低于 20%——「整段都在噪声
    底下、只有个别尖峰」的空洞不值得花一次识别，静音喂给识别器还会得到幻觉。
    """
    import numpy

    if len(samples) < minimum_seconds * 16000:
        return None
    floor = max(speech_level * level_ratio, 0.004)
    frames = samples[: len(samples) // 160 * 160].reshape(-1, 160)
    loud = numpy.flatnonzero(numpy.sqrt(numpy.mean(numpy.square(frames), axis=1)) >= floor)
    if not len(loud) or len(loud) * 5 < len(frames):
        return None
    first = max(0, (int(loud[0]) - 10) * 160)
    last = min(len(samples), (int(loud[-1]) + 11) * 160)
    if last - first < minimum_seconds * 16000:
        return None
    span = end_ms - start_ms
    return (
        start_ms + round(span * first / len(samples)),
        start_ms + round(span * last / len(samples)),
        samples[first:last].copy(),
    )


def recover_speech_gaps(regions, read_window, minimum_seconds=1.0, maximum_seconds=20.0, level_ratio=0.08):
    """在已确认语音之间的空洞里找回检测器漏判的安静语音（会后精修用）。

    检测器（Silero）会把音乐里的轻声、电话音整段判成非语音，这段内容既不会出现在
    精修转写里，也没有任何提示。这里只看**前后都有语音**的空洞：时长在
    ``minimum_seconds``–``maximum_seconds`` 之间，且能量接近相邻语音水平，才额外交给
    识别器；开场/收尾的纯音乐不会被卷进来，识别器给出空文本时上层会丢弃。

    Args:
        regions: 已检测到的语音区间（``{"start_ms", "end_ms"}``，按时间排序）。
        read_window: ``read_window(start_ms, end_ms) -> 归一化 float32 单声道样本``。

    Returns:
        需要补识别的区间（``{"start_ms", "end_ms"}``），按时间排序。
    """
    recovered = []
    for previous, following in zip(regions, regions[1:]):
        start_ms, end_ms = int(previous["end_ms"]), int(following["start_ms"])
        if not minimum_seconds * 1000 <= end_ms - start_ms <= maximum_seconds * 1000:
            continue
        level = _neighbour_speech_level(read_window, previous, following)
        if level <= 0:
            continue
        # 空洞末尾紧挨着的其实是下一段语音：和实时链路一样留出段首回补的余量，
        # 否则识别器会把整段语言判成新段落那门语言。
        window_end = max(start_ms + 1, end_ms - DEFAULT_SPEECH_PAD_MS)
        trimmed = trim_quiet_speech(
            read_window(start_ms, window_end), start_ms, window_end, level,
            minimum_seconds, level_ratio,
        )
        if trimmed:
            recovered.append({"start_ms": trimmed[0], "end_ms": trimmed[1]})
    return recovered


def _neighbour_speech_level(read_window, previous, following, seconds=1.0):
    """用空洞两侧各 1 秒已确认语音估计「这门语言的正常音量」。"""
    import numpy

    parts = []
    for region, take_start in ((previous, False), (following, True)):
        if take_start:
            lo = int(region["start_ms"])
            hi = min(int(region["end_ms"]), lo + seconds * 1000)
        else:
            hi = int(region["end_ms"])
            lo = max(int(region["start_ms"]), hi - seconds * 1000)
        if hi - lo < 200:
            continue
        samples = read_window(lo, hi)
        if len(samples):
            parts.append(samples)
    if not parts:
        return 0.0
    joined = numpy.concatenate(parts).astype(numpy.float64)
    return float(numpy.sqrt(numpy.mean(numpy.square(joined))))


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
        return self._process_chunks(
            (
                samples[start : start + sample_rate * 10]
                for start in range(0, len(samples), sample_rate * 10)
            ),
            sample_rate,
            buffer_seconds,
        )

    def process_wav(self, path, chunk_seconds=10):
        """按块读取 PCM WAV 并保持 VAD 状态，避免长录音整段驻留内存。"""
        import numpy

        with wave.open(str(path)) as recording:
            if recording.getnchannels() != 1 or recording.getsampwidth() != 2:
                raise ValueError("This operation requires mono PCM16 WAV audio")
            sample_rate = recording.getframerate()
            if sample_rate != self.config.sample_rate:
                raise ValueError(f"VAD requires {self.config.sample_rate} Hz audio")
            chunk_frames = sample_rate * chunk_seconds

            def chunks():
                while frames := recording.readframes(chunk_frames):
                    yield numpy.frombuffer(frames, dtype="<i2").astype(numpy.float32) / 32768.0

            return self._process_chunks(
                chunks(),
                sample_rate,
                60,
            )

    def _process_chunks(self, chunks, sample_rate, buffer_seconds):
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

        for samples in chunks:
            detector.accept_waveform(samples)
            drain()
        detector.flush()
        drain()
        return segments


class SpeakerTracker:
    """按声纹相似度为连续语音分配稳定的会议内说话人 ID。"""

    def __init__(self, manager, threshold=None, max_speakers=None, threads=None):
        """加载声纹模型；阈值越低，越倾向于合并为同一说话人。"""
        config = SETTINGS["diarization"]
        model_id = SPEAKER_EMBEDDING_MODEL_ID
        if not manager.is_ready(model_id):
            raise ModelNotInstalled([model_id])
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        model = manager.path(model_id) / manager.get(model_id)["files"][0]
        extractor_config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(model),
            num_threads=threads or manager.thread_budget(),
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
    # Qwen3-ASR 的语言在 stream 上设置，且接口要求自然语言名称而不是 ISO 代码。
    QWEN3_LANGUAGE_HINTS = {
        "zh": "Chinese",
        "en": "English",
        "yue": "Cantonese",
        "ja": "Japanese",
        "ko": "Korean",
        "fr": "French",
        "de": "German",
        "es": "Spanish",
        "ru": "Russian",
    }

    def __init__(self, manager, model_id, language=None, threads=None):
        """加载 Qwen3-ASR 会后精修模型。

        Args:
            manager: 已初始化的 ``ModelManager``。
            model_id: 已安装的 Qwen3-ASR 模型 ID。
            language: 会议语言代码；支持的语言会强制模型按该语言转写，
                避免短窗口自动检测把中文误判成日语等其他语言。
            threads: 推理线程数；默认用 ``thread_budget("refine")`` 的低预算
                给采集与 AI 笔记留出 CPU。会后离线精修（独占 CPU）可显式传
                ``manager.device()["threads"]`` 获得满线程。

        """
        model = manager.get(model_id)
        self.model_id = model_id
        self.model_kind = model["kind"]
        self.language = language
        if model["kind"] not in {
            "qwen3",
            "whisper",
            "nemo-transducer",
            "fire-red-asr-ctc",
            "funasr-nano",
        } or not manager.is_ready(model_id):
            raise ModelNotInstalled([model_id])
        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("sherpa-onnx is not installed") from error
        path = manager.path(model_id)
        common = dict(
            num_threads=threads or manager.thread_budget(),
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
        elif model["kind"] == "nemo-transducer":
            # Parakeet TDT：25 种欧洲语言联合训练，官方支持自动检测语言、无需提示——
            # 这正是英西混说需要的，也是它取代 Whisper 的原因（Whisper 在混说音频上
            # 会把外语翻译成英语而不是转写，见 docs/asr-model-selection-design.md §2.8）。
            # 不解码语言参数：模型自行判断，传了反而可能限制它。
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=str(path / model["files"][0]),
                decoder=str(path / model["files"][1]),
                joiner=str(path / model["files"][2]),
                tokens=str(path / model["files"][3]),
                model_type="nemo_transducer",
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
        # 实时整句链路按此上限硬切连续语音段（见 SentenceVAD），防止超过模型容量。
        self.max_speech_seconds = REFINED_MODEL_MAX_SPEECH_SECONDS[model["kind"]]

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

    @classmethod
    def _qwen3_language(cls, language):
        """返回 Qwen3-ASR stream 的语言选项；自动语言保持未设置。"""
        if not language or language == "auto":
            return ""
        return cls.QWEN3_LANGUAGE_HINTS.get(language, "")

    def _stream(self):
        stream = self.recognizer.create_stream()
        language = self._qwen3_language(getattr(self, "language", None))
        if getattr(self, "model_kind", None) == "qwen3" and language:
            stream.set_option("language", language)
        return stream

    def decode(self, samples, sample_rate=16000):
        """返回文本；整句识别不需要词级时间轴。"""
        stream = self._stream()
        stream.accept_waveform(sample_rate, samples)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()

    def decode_words(self, samples, sample_rate=16000):
        """返回文本及模型提供的 token 级时间戳；没有时保留空列表。"""
        stream = self._stream()
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
        threads=None,
    ):
        """创建离线说话人分离器。

        Args:
            manager: 提供 segmentation 与 embedding 模型路径的模型管理器。
            num_speakers: 已知人数；``None`` 使用配置，``-1`` 表示自动估计。
            threshold: 聚类阈值；``None`` 使用 ``settings.json`` 的默认值。
            threads: 推理线程数；``None`` 使用 ``thread_budget("diarization")``
                的低预算（给采集与 AI 笔记留出 CPU）。会后离线精修（独占 CPU）应显式
                传 ``manager.device()["threads"]`` 获得满线程，避免本就不快的
                Pyannote 分割推理被压到 2 线程而拖慢「准备精修」。
        """
        config = SETTINGS["diarization"]
        diarization_threads = threads or manager.thread_budget()
        segmentation_id = segmentation_id or config["segmentation_model_id"]
        embedding_id = SPEAKER_EMBEDDING_MODEL_ID
        if not all(
            manager.is_ready(model_id) for model_id in (segmentation_id, embedding_id)
        ):
            raise ModelNotInstalled([segmentation_id, embedding_id])
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
                num_threads=diarization_threads,
                provider=manager.device()["backend"],
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(embedding),
                num_threads=diarization_threads,
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
