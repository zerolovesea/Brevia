"""聚焦的 worker 职责组件。"""

import json
import re
import shutil
import zipfile
from html import escape
from pathlib import Path

from .transcript import clock, latest_segments, srt_time
from .worker_common import managed_task, require


class ExportWorkerMixin:
    @managed_task("meeting.export", concurrent=True)
    def export(self, payload, control=None):
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
        safe_title = re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        prefix = payload.get("filename_prefix") or {
            "transcript": "[字幕]",
            "notes": "[会议纪要]",
            "mynotes": "[我的笔记]",
            "audio": "[会议录音]",
        }.get(content_type, "")
        prefix = re.sub(r'[<>:"/\\|?*]+', "-", str(prefix))
        if content_type == "audio":
            return self._export_audio(
                meeting,
                directory,
                f"{prefix}{safe_title}",
                export_format,
                payload.get("track", "mix"),
            )
        if content_type not in {"transcript", "notes", "mynotes"}:
            raise ValueError("Export content must be transcript, notes, mynotes, or audio")
        if export_format not in {"md", "txt", "json", "srt", "docx", "pdf"}:
            raise ValueError("Unsupported text export format")
        segments = latest_segments(meeting["segments"])
        if export_format == "json":
            content = json.dumps({**meeting, "segments": segments}, ensure_ascii=False, indent=2)
        elif export_format == "srt":
            content = "\n\n".join(
                f"{index}\n{srt_time(item['start_ms'])} --> {srt_time(item['end_ms'])}\n"
                f"{item['speaker_name']}: {item['text']}"
                for index, item in enumerate(segments, 1)
            )
        elif content_type == "mynotes":
            content = meeting.get("notes") or ""
            if not content.strip():
                raise ValueError("会议中没有记录笔记。")
        elif content_type == "notes":
            summary = meeting.get("summary", {}).get("data") if meeting.get("summary") else None
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
        stem = self._available_export_stem(directory, f"{prefix}{safe_title}", export_format)
        path = directory / f"{stem}.{'print.html' if export_format == 'pdf' else export_format}"
        try:
            if export_format == "docx":
                path = self._write_docx(directory, stem, content)
            elif export_format == "pdf":
                path = self._write_print_html(
                    directory,
                    stem,
                    content,
                    markdown=content_type in {"notes", "mynotes"},
                )
            else:
                path.write_text(content, encoding="utf-8")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {
            "path": str(path),
            "format": "html" if export_format == "pdf" else export_format,
            "print_pdf": export_format == "pdf",
        }

    @staticmethod
    def _available_export_stem(directory, stem, export_format):
        """为临时导出文件保留不会覆盖已有结果的名字。"""
        if directory.resolve().parent != directory.parent.resolve():
            raise ValueError("Invalid export directory")
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(10000):
            candidate = f"{stem}{'' if index == 0 else f'({index})'}"
            extensions = ("pdf", "print.html") if export_format == "pdf" else (export_format,)
            if any((directory / f"{candidate}.{extension}").exists() for extension in extensions):
                continue
            reservation = directory / f"{candidate}.{extensions[-1]}"
            try:
                reservation.touch(exist_ok=False)
            except FileExistsError:
                continue
            if export_format == "pdf" and (directory / f"{candidate}.pdf").exists():
                reservation.unlink()
                continue
            return candidate
        raise ValueError("Too many exports with the same name")

    @managed_task("meeting.bundle", concurrent=True)
    def bundle(self, payload, control=None):
        """打包本地录音与 Markdown、TXT 逐字稿。"""
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        directory = self.store.meetings_dir / meeting["id"] / "exports"
        directory.mkdir(parents=True, exist_ok=True)
        safe_title = re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        audio = next(
            (
                meeting["audio"]["playback"].get(track)
                for track in ("mix", "mic", "system")
                if meeting["audio"]["playback"].get(track)
            ),
            None,
        )
        temporary = []
        try:
            for format in ("md", "txt"):
                temporary.append(
                    self.export({"meeting_id": meeting["id"], "format": format})["path"]
                )
            files = [
                *([{"path": audio, "name": f"{safe_title}.wav"}] if audio else []),
                *[
                    {"path": source, "name": f"{safe_title}.{Path(source).suffix.lstrip('.')}"}
                    for source in temporary
                ],
            ]
            result = self.bundle_files(
                {"meeting_id": meeting["id"], "name": safe_title, "files": files}
            )
        finally:
            for source in temporary:
                Path(source).unlink(missing_ok=True)
        return {**result, "recording_included": bool(audio)}

    @managed_task("meeting.bundle-files")
    def bundle_files(self, payload, control=None):
        """流式归档当前会议的导出与音频文件，拒绝其他目录与符号链接逃逸。"""
        require(payload, "meeting_id", "files")
        self.store.get_meeting(payload["meeting_id"], compact=True)
        meeting_dir = self.store.meeting_dir(payload["meeting_id"])
        directory = meeting_dir / "exports"
        files = payload["files"]
        if not isinstance(files, list) or not 1 <= len(files) <= 8:
            raise ValueError("Choose between one and eight export files")
        checked = []
        names = set()
        for item in files:
            source = Path(item["path"]).resolve()
            if not source.is_relative_to(meeting_dir.resolve()) or not any(
                source.is_relative_to(root.resolve()) for root in (directory, meeting_dir / "audio")
            ):
                raise ValueError("Invalid archive source")
            if not source.is_file():
                raise ValueError("Archive source is unavailable")
            name = item["name"]
            if (
                not isinstance(name, str)
                or not name
                or "/" in name
                or "\\" in name
                or name in {".", ".."}
            ):
                raise ValueError("Invalid archive filename")
            if name in names:
                raise ValueError("Duplicate archive filename")
            names.add(name)
            checked.append((source, name))
        title = re.sub(r'[<>:"/\\|?*]+', "-", str(payload.get("name") or "Brevia"))
        stem = self._available_export_stem(directory, title, "zip")
        destination = directory / f"{stem}.zip"
        try:
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
                for source, name in checked:
                    self.wait_task(control)
                    # ZIP64 与分块复制由标准库负责；取消时也能及时释放文件。
                    with (
                        source.open("rb") as input_file,
                        archive.open(name, "w", force_zip64=True) as output,
                    ):
                        while chunk := input_file.read(1024 * 1024):
                            self.wait_task(control)
                            output.write(chunk)
            return {"path": str(destination), "format": "zip"}
        except Exception:
            destination.unlink(missing_ok=True)
            raise

    def _export_audio(self, meeting, directory, title, export_format, track):
        """直接复制已保存的 WAV 回放录音。

        Returns:
            包含导出路径和格式的字典。
        """
        if export_format != "wav":
            raise ValueError("Meeting audio is exported in its saved WAV format")
        playback = meeting["audio"]["playback"]
        source = (
            playback.get("mix") or playback.get("mic") or playback.get("system")
            if track == "mix"
            else playback.get(track)
        )
        if not source:
            raise ValueError("The selected audio track is empty")
        if (
            not Path(source)
            .resolve()
            .is_relative_to(self.store.meeting_dir(meeting["id"]).resolve())
        ):
            raise ValueError("Invalid audio path")
        stem = self._available_export_stem(directory, title, export_format)
        path = directory / f"{stem}.{export_format}"
        try:
            shutil.copyfile(source, path)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {"path": str(path), "format": export_format}

    @staticmethod
    def _write_docx(directory, title, content):
        """写入最小化的 Unicode DOCX，无需依赖操作系统特定工具。"""
        destination = directory / f"{title}.docx"
        paragraphs = "".join(
            f'<w:p><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>'
            for line in content.splitlines() or [""]
        )
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "[Content_Types].xml",
                '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            )
            archive.writestr(
                "_rels/.rels",
                '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            )
            archive.writestr(
                "word/document.xml",
                '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                f"{paragraphs}<w:sectPr/></w:body></w:document>",
            )
        return destination

    @staticmethod
    def _write_print_html(directory, title, content, markdown=False):
        """创建 Unicode 安全的 HTML，供 Electron 跨平台 PDF 渲染器使用。"""
        destination = directory / f"{title}.print.html"
        body = (
            ExportWorkerMixin._markdown_html(content)
            if markdown
            else f"<pre>{escape(content)}</pre>"
        )
        destination.write_text(
            "<!doctype html><meta charset='utf-8'><style>"
            "@page{margin:64px 44px 48px}"
            "body{font:16px system-ui,sans-serif;line-height:1.7;margin:0 auto;max-width:760px}"
            "h1,h2,h3{line-height:1.3}h1{font-size:28px}h2{font-size:21px;margin-top:32px}"
            "h3{font-size:17px;margin-top:24px}ul{padding-left:1.4em}"
            "table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left}"
            "pre{font:inherit;white-space:pre-wrap}</style>"
            f"{body}",
            encoding="utf-8",
        )
        return destination

    @staticmethod
    def _markdown_html(markdown):
        """渲染纪要使用的标题、列表、表格和段落 Markdown 子集。"""
        lines = str(markdown or "").replace("\r", "").split("\n")
        html, index = [], 0

        def inline(value):
            return escape(value).replace("**", "")

        while index < len(lines):
            line = lines[index]
            if not line.strip():
                index += 1
                continue
            heading = re.match(r"^(#{1,3})\s+(.+)$", line)
            if heading:
                level = len(heading.group(1))
                html.append(f"<h{level}>{inline(heading.group(2))}</h{level}>")
                index += 1
                continue
            if line.startswith(("- ", "* ")):
                items = []
                while index < len(lines) and lines[index].startswith(("- ", "* ")):
                    items.append(f"<li>{inline(lines[index][2:])}</li>")
                    index += 1
                html.append(f"<ul>{''.join(items)}</ul>")
                continue
            if line.startswith("|"):
                rows = []
                while index < len(lines) and lines[index].startswith("|"):
                    cells = [cell.strip() for cell in lines[index].split("|")[1:-1]]
                    if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                        rows.append(cells)
                    index += 1
                if rows:
                    header, *body = rows
                    html.append(
                        "<table><thead><tr>"
                        + "".join(f"<th>{inline(cell)}</th>" for cell in header)
                        + "</tr></thead><tbody>"
                        + "".join(
                            "<tr>" + "".join(f"<td>{inline(cell)}</td>" for cell in row) + "</tr>"
                            for row in body
                        )
                        + "</tbody></table>"
                    )
                continue
            paragraph = []
            while (
                index < len(lines)
                and lines[index].strip()
                and not re.match(r"^(#{1,3}\s+|[-*]\s+|\|)", lines[index])
            ):
                paragraph.append(lines[index])
                index += 1
            html.append(f"<p>{inline(' '.join(paragraph))}</p>")
        return "".join(html)
