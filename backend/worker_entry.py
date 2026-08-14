"""PyInstaller 打包后的后端 worker 入口点。"""

import multiprocessing
import os

import certifi

multiprocessing.freeze_support()
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

from backend.worker import main  # noqa: E402 - SSL must be configured before import


main()
