"""Focused worker responsibility component."""

import json
import os
import re
import shutil
import subprocess
import zipfile

from .transcript import clock, latest_segments, srt_time
from .worker_common import require


class ExportWorkerMixin:
    def export(self, payload):
        """导出逐字稿、纪要或录音。

        Args:
            payload: 会议 ID、目标格式，可选 ``content`` 与音轨 ``track``。

        Returns:
            临时导出文件路径和实际格式；Electron 再负责保存或分享。
        """
        require(payload, "meeting_id", "format")
        meeting = self.store.get_meeting(payload["meeting_id"])
        export_format = payload["format"].lower()
        content_type = payload.get("content", "transcript")
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        safe_title = (
            re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        )
        path = directory / f"{safe_title}.{export_format}"
        if content_type == "audio":
            return self._export_audio(
                meeting, path, export_format, payload.get("track", "mix")
            )
        if content_type not in {"transcript", "notes"}:
            raise ValueError("Export content must be transcript, notes, or audio")
        if export_format not in {"md", "txt", "json", "srt", "docx", "pdf"}:
            raise ValueError("Unsupported text export format")
        segments = latest_segments(meeting["segments"])
        if export_format == "json":
            content = json.dumps(
                {**meeting, "segments": segments}, ensure_ascii=False, indent=2
            )
        elif export_format == "srt":
            content = "\n\n".join(
                f"{index}\n{srt_time(item['start_ms'])} --> {srt_time(item['end_ms'])}\n"
                f"{item['speaker_name']}: {item['text']}"
                for index, item in enumerate(segments, 1)
            )
        elif content_type == "notes":
            summary = (
                meeting.get("summary", {}).get("data")
                if meeting.get("summary")
                else None
            )
            if not summary:
                raise ValueError("Generate meeting notes before exporting them")
            content = summary.get("markdown")
            if not content:
                raise ValueError("Meeting notes must be regenerated as Markdown")
        else:
            lines = [
                f"[{clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
                + (f"\n{item['translation']}" if item.get("translation") else "")
                for item in segments
            ]
            content = (
                f"# {meeting['title']}\n\n" + "\n\n".join(lines)
                if export_format == "md"
                else "\n".join(lines)
            )
        if export_format in {"docx", "pdf"}:
            path = self._convert_document(directory, safe_title, export_format, content)
        else:
            path.write_text(content, encoding="utf-8")
        return {"path": str(path), "format": export_format}

    def bundle(self, payload):
        """打包本地录音与 Markdown、TXT 逐字稿。"""
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        directory.mkdir(parents=True, exist_ok=True)
        safe_title = (
            re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        )
        audio = next(
            (
                meeting["audio"]["playback"].get(track)
                for track in ("mix", "mic", "system")
                if meeting["audio"]["playback"].get(track)
            ),
            None,
        )
        markdown = self.export({"meeting_id": meeting["id"], "format": "md"})["path"]
        plain_text = self.export({"meeting_id": meeting["id"], "format": "txt"})["path"]
        bundle = directory / f"{safe_title}.zip"
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
            if audio:
                archive.write(audio, arcname=f"{safe_title}.wav")
            archive.write(markdown, arcname=f"{safe_title}.md")
            archive.write(plain_text, arcname=f"{safe_title}.txt")
        return {"path": str(bundle), "format": "zip", "recording_included": bool(audio)}

    def _export_audio(self, meeting, path, export_format, track):
        """通过 ffmpeg 导出单轨或归一化混音。

        Returns:
            包含导出路径和格式的字典。
        """
        if export_format not in {"flac", "wav", "m4a"}:
            raise ValueError("Supported audio formats: flac, wav, m4a")
        playback = meeting["audio"]["playback"]
        inputs = [playback[name] for name in ("mic", "system") if playback.get(name)]
        if track in {"mic", "system", "vocals", "accompaniment"}:
            inputs = [playback.get(track)] if playback.get(track) else []
        if not inputs:
            raise ValueError("The selected audio track is empty")
        ffmpeg = os.environ.get("BREVIA_FFMPEG") or shutil.which("ffmpeg")
        if not ffmpeg:
            raise ValueError("ffmpeg is required for audio export")
        command = [ffmpeg, "-y", "-loglevel", "error"]
        for source in inputs:
            command.extend(["-i", source])
        if len(inputs) == 2:
            command.extend(
                ["-filter_complex", "amix=inputs=2:duration=longest:normalize=1"]
            )
        if export_format == "m4a":
            command.extend(["-c:a", "aac", "-b:a", "192k"])
        command.append(str(path))
        subprocess.run(command, check=True)
        return {"path": str(path), "format": export_format}

    @staticmethod
    def _convert_document(directory, title, export_format, content):
        """调用 macOS 原生工具把文本转换为 DOCX 或 PDF，返回目标路径。"""
        source = directory / f"{title}.{'html' if export_format == 'docx' else 'txt'}"
        source.write_text(
            (
                "<!doctype html><meta charset='utf-8'><style>"
                "body{font:16px -apple-system;line-height:1.7;max-width:760px;margin:48px auto}"
                "</style><pre style='white-space:pre-wrap'>"
                + __import__("html").escape(content)
                + "</pre>"
            )
            if export_format == "docx"
            else content,
            encoding="utf-8",
        )
        destination = directory / f"{title}.{export_format}"
        try:
            if export_format == "docx" and shutil.which("textutil"):
                subprocess.run(
                    [
                        "textutil",
                        "-convert",
                        "docx",
                        "-output",
                        str(destination),
                        str(source),
                    ],
                    check=True,
                    capture_output=True,
                )
            elif export_format == "pdf" and shutil.which("cupsfilter"):
                with destination.open("wb") as output:
                    subprocess.run(
                        ["cupsfilter", "-m", "application/pdf", str(source)],
                        check=True,
                        stdout=output,
                        stderr=subprocess.PIPE,
                    )
            else:
                raise ValueError(
                    f"{export_format.upper()} export is unavailable on this device"
                )
        finally:
            source.unlink(missing_ok=True)
        return destination
