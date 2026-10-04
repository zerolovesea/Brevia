"""为当前平台构建自包含的后端 Worker。"""

import os
import re
import subprocess
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.bundled_models import prepare_bundled_models  # noqa: E402 - ROOT must be importable first


BACKEND = ROOT / "backend"
BUNDLED_MODELS = BACKEND / "bundled-models"


def resource(name, destination="backend"):
    """构建资源路径参数。"""
    return f"{BACKEND / name}{os.pathsep}{destination}"


# 清残留并补齐随包模型；`backend/bundled_models.py` 与打包前置校验共用同一份 allowlist。
prepare_bundled_models(BUNDLED_MODELS)

# mlx-audio and transformers select architectures/tokenizers dynamically. Keep
# the installed speech families and Metal library beside mlx.core in the bundle.
mlx_options = []
if sys.platform == "win32":
    # One frozen runtime, two independently launched processes. Windows ASR
    # remains Sherpa; exclude optional MLX/HF imports even on a polluted host.
    for package in ("backend.mlx_asr", "mlx", "mlx_audio", "transformers",
                    "torch", "tensorflow", "jax", "scipy", "huggingface_hub"):
        mlx_options.extend(["--exclude-module", package])
    mlx_options.extend(["--hidden-import", "backend.llama_sidecar",
                        "--hidden-import", "backend.check_windows_runtime",
                        "--collect-binaries", "llama_cpp",
                        "--collect-data", "llama_cpp"])
if sys.platform == "darwin":
    import mlx.core
    mlx_root = Path(mlx.core.__file__).parent
    for binary in (Path(mlx.core.__file__), mlx_root / "lib" / "libmlx.dylib"):
        build = subprocess.check_output(["otool", "-l", str(binary)], text=True)
        minimum = re.search(r"\bminos (\d+)\.(\d+)", build)
        if not minimum or tuple(map(int, minimum.groups())) > (14, 0):
            raise RuntimeError("MLX must use the macOS 14 wheels pinned in requirements.txt: " + str(binary))
    if not (mlx_root / "lib" / "mlx.metallib").is_file():
        raise RuntimeError("MLX Metal shader library is missing")
    # Ship Metal kernels and shared libraries, not the C++ development headers.
    mlx_options.extend(["--collect-submodules", "mlx",
                        "--collect-binaries", "mlx",
                        "--add-data", f"{mlx_root / 'lib' / 'mlx.metallib'}{os.pathsep}mlx/lib"])
    # Transformers' TYPE_CHECKING imports enumerate every architecture. Only
    # these tokenizer/feature-extractor families are used by our MLX models.
    import transformers
    model_root = Path(transformers.__file__).parent / "models"
    # AutoTokenizer imports GGUF mappings eagerly, including these tokenizers.
    transformer_families = {"auto", "qwen2", "whisper", "encoder_decoder",
                            "gemma", "gpt2", "llama", "qwen3_5", "t5", "qwen3", "qwen3_asr", "__pycache__"}
    for directory in sorted(model_root.iterdir()):
        if directory.is_dir() and directory.name not in transformer_families:
            mlx_options.extend(["--exclude-module", f"transformers.models.{directory.name}"])
    for package in ("torch", "tensorflow", "jax", "hf_xet",
                    "mlx_audio.tts", "mlx_audio.sts", "mlx_audio.lid"):
        mlx_options.extend(["--exclude-module", package])
    for package in ("mlx_audio.stt.models.qwen3_asr",
                    "mlx_audio.stt.models.fun_asr_nano",
                    "mlx_audio.stt.models.fireredasr2", "mlx_audio.stt.models.parakeet",
                    "mlx_audio.vad.models.silero_vad"):
        mlx_options.extend(["--collect-all", package])
    for package in ("mlx-audio", "mlx", "mlx-metal", "transformers", "tokenizers",
                    "huggingface-hub", "safetensors", "regex", "tqdm", "numpy",
                    "packaging", "pyyaml", "sentencepiece"):
        mlx_options.extend(["--copy-metadata", package])
    mlx_options.extend(["--hidden-import", "transformers.models.qwen2.tokenization_qwen2",
                        "--hidden-import", "transformers.models.whisper.feature_extraction_whisper"])

PyInstaller.__main__.run(
    [
        *mlx_options,
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        "brevia-worker",
        "--paths",
        str(ROOT),
        "--distpath",
        str(BACKEND / "runtime"),
        "--workpath",
        str(BACKEND / "build"),
        "--specpath",
        str(BACKEND / "build"),
        "--collect-binaries",
        "sherpa_onnx",
        "--collect-data",
        "sherpa_onnx",
        "--collect-data",
        "certifi",
        "--exclude-module",
        "onnxruntime",
        "--add-data",
        resource("settings.json"),
        "--add-data",
        resource("models.json"),
        "--add-data",
        resource("examples.json"),
        "--add-data",
        resource("fixtures", "backend/fixtures"),
        str(BACKEND / "worker_entry.py"),
    ]
)
