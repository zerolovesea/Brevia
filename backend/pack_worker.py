"""为当前平台构建自包含的后端 Worker。"""

import os
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
