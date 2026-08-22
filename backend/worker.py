#!/usr/bin/env python3
"""JSONL worker 入口点与稳定的 Worker 外观。"""

import io
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from .worker_core import WorkerCore
from .worker_exports import ExportWorkerMixin
from .worker_llm import LLMWorkerMixin
from .worker_llama_sidecar import LlamaSidecarMixin
from .worker_meetings import MeetingCommandMixin
from .worker_models import ModelTaskWorkerMixin
from .worker_refinement import RefinementWorkerMixin
from .worker_session import RecordingSessionMixin
from .worker_speakers import SpeakerCommandMixin
from .worker_ai_note import AiNoteWorkerMixin


MAXIMUM_COMMAND_BYTES = 1024 * 1024


class Worker(
    WorkerCore,
    RecordingSessionMixin,
    MeetingCommandMixin,
    SpeakerCommandMixin,
    ModelTaskWorkerMixin,
    ExportWorkerMixin,
    RefinementWorkerMixin,
    LLMWorkerMixin,
    LlamaSidecarMixin,
    AiNoteWorkerMixin,
):
    """从聚焦的 worker 服务组合而成的协议外观。"""


def install_global_error_handlers(worker):
    """报告未被捕获的进程和后台线程故障。"""

    def thread_error(args):
        try:
            worker.emit(
                "worker.error",
                {
                    "message": str(args.exc_value),
                    "thread": getattr(args.thread, "name", "unknown"),
                },
            )
        except Exception:
            sys.__excepthook__(type(args.exc_value), args.exc_value, args.exc_traceback)

    def process_error(error_type, error, traceback):
        try:
            worker.emit("worker.error", {"message": str(error), "fatal": True})
        finally:
            sys.__excepthook__(error_type, error, traceback)

    threading.excepthook = thread_error
    sys.excepthook = process_error


def main():
    """运行 stdin/stdout JSONL 循环；单个命令失败不会停止 worker。"""
    # Windows 上管道 stdio 默认按系统 ANSI 代码页解码（中文区域为 GBK），与主进程
    # 写入的 UTF-8 字节不一致，会把非 ASCII 文本（如会议名称）解成乱码。这里显式
    # 固定为 UTF-8，不依赖 PYTHONIOENCODING/PYTHONUTF8 环境变量是否生效。
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if stream is not None and stream.encoding and stream.encoding.lower() not in {"utf-8", "utf8"}:
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, io.UnsupportedOperation, ValueError):
                pass
    worker = Worker()
    install_global_error_handlers(worker)

    def respond(command):
        try:
            worker.response(command.get("id"), worker.handle(command))
        except Exception as error:
            worker.response(command.get("id"), error=error)

    # 单工作线程执行器序列化翻译推理，使得每次只运行一个翻译任务（有序输出，限制本地模型加载）。
    translation_executor = ThreadPoolExecutor(
        max_workers=1, thread_name_prefix="brevia-translation"
    )

    while line := sys.stdin.readline(MAXIMUM_COMMAND_BYTES + 1):
        if len(line) > MAXIMUM_COMMAND_BYTES and not line.endswith("\n"):
            while line and not line.endswith("\n"):
                line = sys.stdin.readline(MAXIMUM_COMMAND_BYTES + 1)
            worker.response(None, error=ValueError("Command is too large"))
            continue
        if not line.strip():
            continue
        if len(line) > MAXIMUM_COMMAND_BYTES:
            worker.response(None, error=ValueError("Command is too large"))
            continue
        try:
            command = json.loads(line)
        except Exception as error:
            worker.response(None, error=error)
            continue
        if command.get("type") == "translation.generate":
            translation_executor.submit(respond, command)
        elif command.get("type") in {
            "meeting.refine",
            "meeting.import",
            "speaker-profile.list",
            "speaker-profile.samples",
            "speaker-profile.sample-delete",
            "summary.generate",
            "speaker-profile.enroll",
            "speaker-profile.verify",
            "speaker.rename",
            "segment.speaker",
            "segment.speaker-profile-sample",
            "meeting.export",
            "meeting.bundle",
        }:
            threading.Thread(target=respond, args=(command,), daemon=True).start()
        else:
            respond(command)

    worker.shutdown_ai_note()
    worker.shutdown_sidecars()
    worker.store.close_audio_sessions()
    translation_executor.shutdown(wait=True)


if __name__ == "__main__":
    main()
