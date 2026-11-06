"""本机 Agent 的文件流程；复用正在运行的导入、精修、翻译和声纹业务。"""

import json
import math
import os
import re
import threading
from collections import OrderedDict
from pathlib import Path
from uuid import UUID

from .config import SETTINGS
from .transcript import latest_segments, srt_time
from .worker_common import (
    ModelNotInstalled,
    TaskCancelled,
    UserFacingError,
    managed_task,
    missing_models,
)
from .worker_llm import TRANSLATION_MODEL_ID

FORMATS = {"txt", "md", "srt", "vtt", "json"}
TEXT_TYPES = {".txt", ".md", ".srt", ".vtt"}


def parse_subtitles(text):
    segments = []
    for block in re.split(r"\n\s*\n", text.lstrip("\ufeff").replace("\r", "").strip()):
        if re.match(r"^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)", block):
            continue
        lines = block.split("\n")
        index = next((i for i, line in enumerate(lines) if "-->" in line), -1)
        match = (
            re.fullmatch(
                r"(\d+:\d{2}(?::\d{2})?[.,]\d{3})\s+-->\s+(\d+:\d{2}(?::\d{2})?[.,]\d{3})(?:\s.*)?",
                lines[index],
            )
            if index in {0, 1}
            else None
        )
        if not match:
            raise UserFacingError("invalid_subtitles", "Malformed subtitle cue")

        def stamp(value):
            parts = [float(p) for p in value.replace(",", ".").split(":")]
            if parts[-1] >= 60 or parts[-2] >= 60:
                raise UserFacingError(
                    "invalid_subtitles", "Subtitle minutes and seconds must be below 60"
                )
            return round(sum(p * 60**i for i, p in enumerate(reversed(parts))) * 1000)

        start, end = stamp(match[1]), stamp(match[2])
        body = "\n".join(lines[index + 1 :]).strip()
        if not body or end <= start:
            raise UserFacingError("invalid_subtitles", "Invalid subtitle text or timestamps")
        segments.append({"start_ms": start, "end_ms": end, "text": body})
    if not segments:
        raise UserFacingError("invalid_subtitles", "No subtitle cues found")
    return segments


def render_result(result, format):
    if format == "json":
        return json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    segments = result.get("segments")
    if segments is None:
        raise UserFacingError("invalid_format", "Voice matching requires JSON output")

    def text(segment):
        body = segment.get("translation", segment["text"])
        if result.get("operation") == "diarize":
            return f"[{segment.get('speaker') or 'Unknown speaker'}] {body}"
        return body

    if format in {"srt", "vtt"}:
        if any(
            not isinstance(s.get(k), (int, float)) or not math.isfinite(s[k])
            for s in segments
            for k in ("start_ms", "end_ms")
        ):
            raise UserFacingError(
                "timestamps_unavailable", "Choose TXT, Markdown or JSON for text without timestamps"
            )

        def stamp(ms):
            value = srt_time(round(ms))
            return value.replace(",", ".") if format == "vtt" else value

        return (
            ("WEBVTT\n\n" if format == "vtt" else "")
            + "\n\n".join(
                f"{i}\n{stamp(s['start_ms'])} --> {stamp(s['end_ms'])}\n{text(s)}"
                for i, s in enumerate(segments, 1)
            )
            + "\n"
        )
    return ("\n\n" if format == "md" else "\n").join(text(s) for s in segments) + "\n"


def validate(payload):
    allowed = {
        "meeting_id",
        "operation",
        "input_path",
        "text",
        "language",
        "target_language",
        "model_id",
        "profile_id",
        "num_speakers",
        "output_path",
        "format",
    }
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise ValueError("Invalid Agent payload")
    UUID(payload["meeting_id"])
    if payload.get("operation") not in {"transcribe", "translate", "diarize", "voice-match"}:
        raise ValueError("Unknown inference operation")
    for key in ("output_path", "input_path"):
        value = payload.get(key)
        if key == "input_path" and value is None:
            continue
        if not isinstance(value, str) or len(value) > 4096 or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute local path")
    if bool(payload.get("text")) == bool(payload.get("input_path")):
        raise ValueError("Supply exactly one input_path or text")
    if "text" in payload and (
        not isinstance(payload["text"], str) or not 0 < len(payload["text"]) <= 1_000_000
    ):
        raise ValueError("Invalid input text")
    for key in ("language", "target_language"):
        if key in payload and (
            not isinstance(payload[key], str) or not 2 <= len(payload[key]) <= 32
        ):
            raise ValueError(f"Invalid {key}")
    if "model_id" in payload and (
        not isinstance(payload["model_id"], str) or not 1 <= len(payload["model_id"]) <= 128
    ):
        raise ValueError("Invalid model_id")
    if payload["operation"] == "translate" and not payload.get("target_language"):
        raise ValueError("target_language is required")
    if payload["operation"] != "translate" and not payload.get("input_path"):
        raise ValueError("This operation requires input_path")
    if payload["operation"] == "voice-match":
        UUID(payload["profile_id"])
    count = payload.get("num_speakers", -1)
    if type(count) is not int or not (count == -1 or 1 <= count <= 100):
        raise ValueError("Invalid num_speakers")
    return {"language": "auto", **payload}


def write_result(destination, content, checkpoint):
    checkpoint()
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
            checkpoint()
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return str(destination.resolve())


class AgentWorkerMixin:
    def __init__(self):
        self._agent_lock = threading.Lock()
        self._agent_cancelled = OrderedDict()
        super().__init__()

    def agent_cancel(self, payload):
        mid = payload["meeting_id"]
        UUID(mid)
        with self._agent_lock:
            control = self.tasks.get("agent.run", mid)
            if control is None:
                # JSONL 主线程可能先于任务线程收到取消；保留有界撤销记录。
                self._agent_cancelled[mid] = None
                while len(self._agent_cancelled) > 128:
                    self._agent_cancelled.popitem(last=False)
            self.tasks.cancel_for_meeting(mid)
        if control:
            self.cancel_sidecar("translation", control.cancelled)
        return {"cancel_requested": True}

    @managed_task("agent.run")
    def agent_run(self, payload, control):
        with self._agent_lock:
            if payload["meeting_id"] in self._agent_cancelled:
                del self._agent_cancelled[payload["meeting_id"]]
                control.cancelled.set()
        p = validate(payload)
        mid, operation = p["meeting_id"], p["operation"]
        destination = Path(p["output_path"])
        format = p.get("format") or destination.suffix[1:].lower()
        if format not in FORMATS or (operation == "voice-match" and format != "json"):
            raise UserFacingError(
                "invalid_format", "Specify TXT, MD, SRT, VTT or JSON; voice matching requires JSON"
            )
        if os.path.lexists(destination):
            raise UserFacingError("output_exists", f"Output already exists: {destination}")
        if not destination.parent.is_dir():
            raise UserFacingError("output_directory_missing", "Output directory does not exist")
        source = Path(p["input_path"]) if p.get("input_path") else None
        if source and (not source.is_file() or not source.stat().st_size):
            raise UserFacingError("invalid_input", "Input must be a nonempty local file")

        def checkpoint():
            self.wait_task(control)

        def emit(stage, completed=0, total=1):
            self.emit(
                "agent.progress",
                {"meeting_id": mid, "stage": stage, "completed": completed, "total": total},
            )

        try:
            checkpoint()
            emit("preparing")
            if operation == "voice-match":
                result = self.verify_speaker_profile(
                    {"meeting_id": mid, "path": str(source), "profile_id": p["profile_id"]}
                )
            else:
                text_input = source is None or source.suffix.lower() in TEXT_TYPES
                if text_input:
                    if operation != "translate":
                        raise UserFacingError(
                            "invalid_input", "Text and subtitle files support translation"
                        )
                    if source and source.stat().st_size > 2 * 1024 * 1024:
                        raise UserFacingError("input_too_large", "Text input exceeds 2 MiB")
                    text = source.read_text(encoding="utf-8-sig") if source else p["text"]
                    if not text.strip():
                        raise UserFacingError("invalid_input", "Text input is empty")
                    segments = (
                        parse_subtitles(text)
                        if source and source.suffix.lower() in {".srt", ".vtt"}
                        else [{"text": text}]
                    )
                else:
                    model = p.get("model_id") or self._default_refined_model(p["language"])
                    needed = [model, "silero-vad"] + (
                        [TRANSLATION_MODEL_ID] if operation == "translate" else []
                    )
                    missing = missing_models(self.models, needed)
                    if missing:
                        raise ModelNotInstalled(missing)
                    checkpoint()
                    emit("decoding")
                    try:
                        self.import_audio(
                            {
                                "meeting_id": mid,
                                "path": str(source),
                                "title": source.name,
                                "language": p["language"],
                                "refined_model_id": model,
                                "speaker_segmentation_model_id": SETTINGS["diarization"][
                                    "segmentation_model_id"
                                ],
                            }
                        )
                    except TaskCancelled:
                        raise
                    except Exception as error:
                        if getattr(error, "code", None):
                            raise
                        raise UserFacingError("decode_failed", str(error)) from error
                    checkpoint()
                    emit("transcribing")
                    self.refine(
                        {
                            "meeting_id": mid,
                            "language": p["language"],
                            "refined_model_id": model,
                            "num_speakers": p.get("num_speakers", -1),
                            "force_diarization": operation == "diarize",
                        }
                    )
                    checkpoint()
                    meeting = self.store.get_meeting(mid, compact=True)
                    segments = [
                        {
                            "start_ms": s["start_ms"],
                            "end_ms": s["end_ms"],
                            "text": s["text"],
                            "speaker": s.get("speaker_name"),
                        }
                        for s in latest_segments(meeting["segments"])
                    ]
                if operation == "translate":
                    for index, segment in enumerate(segments):
                        checkpoint()
                        emit("translating", index, len(segments))
                        translated = []
                        for at in range(0, len(segment["text"]), 256):
                            checkpoint()
                            part = self.translate_text(
                                segment["text"][at : at + 256],
                                p["target_language"],
                                control=control,
                                complete=True,
                            )
                            if not part.strip():
                                raise UserFacingError(
                                    "translation_empty", "Translation model returned no text"
                                )
                            translated.append(part)
                        segment["translation"] = "\n".join(translated)
                result = {"operation": operation, "language": p["language"], "segments": segments}
                if p.get("target_language"):
                    result["target_language"] = p["target_language"]
                if not text_input:
                    result["meeting_id"] = mid
            checkpoint()
            emit("exporting")
            output = write_result(destination, render_result(result, format), checkpoint)
            emit("completed", 1, 1)
            return {
                "output_path": output,
                "format": format,
                **(
                    {"match": result}
                    if operation == "voice-match"
                    else {"segment_count": len(result["segments"])}
                ),
                **({"meeting_id": mid} if result.get("meeting_id") else {}),
            }
        except Exception:
            if control.cancelled.is_set():
                return {"cancelled": True}
            raise
