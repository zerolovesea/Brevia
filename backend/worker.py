#!/usr/bin/env python3
"""JSONL worker 入口点与稳定的 Worker 外观。"""

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from .worker_core import WorkerCore


MAXIMUM_COMMAND_BYTES = 1024 * 1024
from .worker_exports import ExportWorkerMixin
from .worker_llm import LLMWorkerMixin
from .worker_llama_sidecar import LlamaSidecarMixin
from .worker_meetings import MeetingCommandMixin
from .worker_models import ModelTaskWorkerMixin
from .worker_refinement import RefinementWorkerMixin
from .worker_session import RecordingSessionMixin
from .worker_speakers import SpeakerCommandMixin


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
            "meeting.separate",
            "speaker-profile.list",
            "speaker-profile.samples",
            "speaker-profile.sample-delete",
            "summary.generate",
            "tts.synthesize",
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


if __name__ == "__main__":
    main()
