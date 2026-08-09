"""为当前平台构建自包含的 llama 侧车进程。"""

import os
from pathlib import Path

import PyInstaller.__main__


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def resource(name, destination="backend"):
    """构建资源路径参数。"""
    return f"{BACKEND / name}{os.pathsep}{destination}"


PyInstaller.__main__.run(
    [
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
