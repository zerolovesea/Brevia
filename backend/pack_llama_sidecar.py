"""为当前平台构建自包含的 llama 侧车进程。"""

import os
import sys
from pathlib import Path

if sys.platform == "win32":
    print("Windows llama sidecar is bundled in brevia-worker.exe --llama-sidecar")
    raise SystemExit(0)

import PyInstaller.__main__


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def resource(name, destination="backend"):
    """构建资源路径参数。"""
    return f"{BACKEND / name}{os.pathsep}{destination}"


PyInstaller.__main__.run(
    [
        # Brevia uses the GGUF tokenizer embedded in llama.cpp. The optional
        # HFTokenizer and multimodal handlers otherwise pull the ASR stack in.
        "--exclude-module",
        "transformers",
        "--exclude-module",
        "torch",
        "--exclude-module",
        "mlx",
        "--exclude-module",
        "scipy",
        "--exclude-module",
        "huggingface_hub",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        "brevia-llama-helper",
        "--paths",
        str(ROOT),
        "--distpath",
        str(BACKEND / "runtime"),
        "--workpath",
        str(BACKEND / "build"),
        "--specpath",
        str(BACKEND / "build"),
        "--collect-binaries",
        "llama_cpp",
        "--collect-data",
        "llama_cpp",
        "--hidden-import",
        "llama_cpp",
        str(BACKEND / "llama_sidecar.py"),
    ]
)
