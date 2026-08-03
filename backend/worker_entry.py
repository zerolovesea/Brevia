"""PyInstaller entry point for the packaged backend worker."""

import os

import certifi

os.environ.setdefault("SSL_CERT_FILE", certifi.where())

from backend.worker import main


main()
