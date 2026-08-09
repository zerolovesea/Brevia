"""PyInstaller 打包后的后端 worker 入口点。"""

import os

import certifi

os.environ.setdefault("SSL_CERT_FILE", certifi.where())

from backend.worker import main


main()
