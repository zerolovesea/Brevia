"""Build a self-contained backend worker for the current platform."""

import os
from pathlib import Path

import PyInstaller.__main__


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def resource(name):
    return f"{BACKEND / name}{os.pathsep}backend"


PyInstaller.__main__.run([
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "brevia-worker",
    "--paths", str(ROOT),
    "--distpath", str(BACKEND),
    "--workpath", str(BACKEND / "build"),
    "--specpath", str(BACKEND / "build"),
    "--collect-binaries", "sherpa_onnx",
    "--collect-data", "sherpa_onnx",
    "--exclude-module", "onnxruntime",
    "--add-data", resource("settings.json"),
    "--add-data", resource("models.json"),
    "--add-data", resource("examples.json"),
    "--add-data", resource("fixtures"),
    str(BACKEND / "worker_entry.py"),
])
