#!/usr/bin/env python3
"""JSONL worker entry point and stable Worker facade."""

import json
import sys
import threading

from .worker_core import WorkerCore
from .worker_exports import ExportWorkerMixin
from .worker_llm import LLMWorkerMixin
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
):
    """Protocol facade composed from focused worker services."""


def install_global_error_handlers(worker):
    """Report otherwise-unhandled process and background-thread failures."""

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
    """Run the stdin/stdout JSONL loop; one failed command does not stop the worker."""
    worker = Worker()
    install_global_error_handlers(worker)

    def respond(command):
        try:
            worker.response(command.get("id"), worker.handle(command))
        except Exception as error:
            worker.response(command.get("id"), error=error)

    maximum_command_bytes = 4 * 1024 * 1024
    while line := sys.stdin.readline(maximum_command_bytes + 1):
        if len(line) > maximum_command_bytes and not line.endswith("\n"):
            while line and not line.endswith("\n"):
                line = sys.stdin.readline(maximum_command_bytes + 1)
            worker.response(None, error=ValueError("Command is too large"))
            continue
        if not line.strip():
            continue
        if len(line) > maximum_command_bytes:
            worker.response(None, error=ValueError("Command is too large"))
            continue
        try:
            command = json.loads(line)
        except Exception as error:
            worker.response(None, error=error)
            continue
        if command.get("type") in {
            "meeting.refine",
            "meeting.separate",
            "translation.generate",
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
