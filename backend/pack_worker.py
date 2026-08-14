"""为当前平台构建自包含的后端 Worker。"""

import os
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.asr import ModelManager  # noqa: E402 - ROOT must be importable first
from backend.config import SPEAKER_EMBEDDING_MODEL_ID  # noqa: E402


BACKEND = ROOT / "backend"
BUNDLED_MODELS = BACKEND / "bundled-models"
BUNDLED_MODEL_IDS = (
    "silero-vad",
    "online-punct-en-int8",
    "punct-ct-transformer-zh-en-int8",
    "pyannote-segmentation-3.0",
    SPEAKER_EMBEDDING_MODEL_ID,
)


def resource(name, destination="backend"):
    """构建资源路径参数。"""
    return f"{BACKEND / name}{os.pathsep}{destination}"


def prepare_bundled_models():
    """将开箱即用的基础模型放进安装包；其余模型仍按需下载。"""
    manager = ModelManager(BUNDLED_MODELS)
    for model_id in BUNDLED_MODEL_IDS:
        manager.download(model_id)


prepare_bundled_models()


PyInstaller.__main__.run(
    [
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
