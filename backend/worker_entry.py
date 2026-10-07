"""PyInstaller 打包后的后端 worker 入口点。"""

import multiprocessing
import os
import sys
from importlib import import_module

import certifi


def main():
    multiprocessing.freeze_support()
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    # Dynamic imports keep llama out of the macOS worker's dependency graph.
    # Windows launches the same executable in a separate process, sharing only
    # files on disk, never the ASR process's model state or address space.
    if sys.platform == "win32" and sys.argv[1:] == ["--llama-sidecar"]:
        import_module("backend.llama_sidecar").main()
    elif sys.platform == "win32" and sys.argv[1:] == ["--check-runtime"]:
        import_module("backend.check_windows_runtime").main()
    else:
        from backend.worker import main as worker_main, protocol_output

        worker_main(protocol_output())


if __name__ == "__main__":
    main()
