"""为当前平台构建自包含的后端 Worker。"""

import os
import shutil
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.asr import ModelManager  # noqa: E402 - ROOT must be importable first
from backend.config import BUNDLED_MODEL_IDS  # noqa: E402


BACKEND = ROOT / "backend"
BUNDLED_MODELS = BACKEND / "bundled-models"


def resource(name, destination="backend"):
    """构建资源路径参数。"""
    return f"{BACKEND / name}{os.pathsep}{destination}"


def prepare_bundled_models():
    """将开箱即用的基础模型放进安装包；其余模型仍按需下载。

    同时**清掉不该随包的东西**：``extraResources`` 会把整个 ``backend/`` 打进安装包，
    而 ``backend/bundled-models/`` 不排除，所以这个目录里留着的任何东西都会随包发布。
    以前这里只补齐缺失、从不清理，于是下架一个随包模型后，旧目录会一直跟着出厂——
    实测本机残留了 112 MB 已下架的标点模型（``online-punct-en-int8``、
    ``punct-ct-transformer-zh-en-int8``），而 release note 写的是"不再存储"。

    只删带 ``.brevia.json`` 标记、且不属于当前 ``BUNDLED_MODEL_IDS`` 的目录：标记既是
    「这是 Brevia 管理的模型」的判据，也避免把误指到用户模型库的路径清空。
    """
    manager = ModelManager(BUNDLED_MODELS)
    expected = {manager.local_path(model_id).name for model_id in BUNDLED_MODEL_IDS}
    stale = []
    for path in BUNDLED_MODELS.iterdir():
        if path.name in expected or not (path / ".brevia.json").is_file():
            continue
        freed = sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
        shutil.rmtree(path, ignore_errors=True)
        stale.append((path.name, freed))
    for name, freed in stale:
        print(f"pruned stale bundled model {name} ({freed / 1024 / 1024:.1f} MB)")
    for model_id in BUNDLED_MODEL_IDS:
        manager.download(model_id)
    # 构建期断言：目录名对了不等于文件齐。``test_bundled_models_exist_in_the_catalog``
    # 只保证 id 在清单里，**不保证文件真的在磁盘上**。漏掉一个随包模型会让功能静默
    # 失效——OpenWhispr #1057 就是这样栽的：Windows 安装包漏了 VAD 模型，结果语音活动
    # 检测被静默禁用，直到用户报告才发现。宁可让 ``npm run dist:*`` 直接失败。
    missing = [model_id for model_id in BUNDLED_MODEL_IDS if not manager.is_ready(model_id)]
    if missing:
        raise SystemExit(
            "Bundled models are incomplete; refusing to package: "
            + ", ".join(missing)
            + f". Looked under {BUNDLED_MODELS}."
        )


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
