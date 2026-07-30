#!/usr/bin/env python3
"""Electron 后台 Worker：处理 JSONL 命令并编排录音、识别、存储与导出。"""

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.request
from array import array
from pathlib import Path

from .asr import ModelManager, OfflineDiarizer, RefinedASR, StreamingASR
from .config import SETTINGS
from .storage import Store


SCHEMA_VERSION = 1


def require(payload, *names):
    """确认命令数据包含必填键；缺失时一次列出全部键名。"""
    missing = [name for name in names if name not in payload]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")


class Worker:
    """连接 Electron IPC 与本地能力的单进程命令处理器。"""

    def __init__(self, root=None, output=None):
        """初始化存储和模型管理。

        Args:
            root: 数据目录；为空时读取环境变量，再回退到 macOS 应用目录。
            output: JSON 消息输出函数；默认逐行写到 stdout。
        """
        root = root or os.environ.get(
            "BREVIA_DATA_DIR",
            Path.home() / "Library" / "Application Support" / "Brevia",
        )
        self.output = output or (lambda value: print(json.dumps(value, ensure_ascii=False), flush=True))
        self.store = Store(root)
        self.models = ModelManager(self.store.models_dir, self.emit)
        self.active = None
        self.asr = None
        self.stream_state = {}
        self.asr_warning_sent = False

    def emit(self, event_type, payload):
        """向前端发送无请求 ID 的异步事件。"""
        self.output({"type": event_type, "schema_version": SCHEMA_VERSION, "payload": payload})

    def response(self, command_id, result=None, error=None):
        """写出一条命令响应；错误只返回安全的字符串表示。"""
        value = {"id": command_id, "ok": error is None}
        value["error" if error else "result"] = str(error) if error else result
        self.output(value)

    def handle(self, command):
        """校验并分发一条 JSONL 命令。

        Args:
            command: 包含 ``id``、``type`` 和可选 ``payload`` 的字典。

        Returns:
            对应处理器的结果，最终由 ``response`` 包装。
        """
        command_id = command.get("id")
        command_type = command.get("type")
        payload = command.get("payload") or {}
        if not command_id or not command_type:
            raise ValueError("Commands require id and type")
        handlers = {
            "app.initialize": self.initialize,
            "meeting.start": self.start,
            "meeting.resume": self.resume,
            "meeting.pause": self.pause,
            "meeting.audio": self.audio,
            "meeting.stop": self.stop,
            "meeting.list": lambda value: self.store.list_meetings(**value),
            "meeting.get": lambda value: self.store.get_meeting(value["meeting_id"]),
            "meeting.update": self.update_meeting,
            "meeting.delete": self.delete_meeting,
            "meeting.restore": self.restore_meeting,
            "speaker.rename": self.rename_speaker,
            "terms.list": lambda _: self.store.list_terms(),
            "terms.save": self.store.save_term,
            "terms.delete": self.delete_term,
            "models.list": lambda _: self.models.list(),
            "models.download": self.download_model,
            "models.delete": self.delete_model,
            "meeting.export": self.export,
            "meeting.refine": self.refine,
            "summary.generate": self.summarize,
            "translation.generate": self.translate,
        }
        if command_type not in handlers:
            raise ValueError(f"Unknown command: {command_type}")
        return handlers[command_type](payload)

    def initialize(self, _):
        """执行启动期维护，并返回前端首屏需要的完整本地状态。"""
        seeded_examples = self.store.seed_examples()
        purged = self.store.purge_expired()
        return {
            "meetings": self.store.list_meetings(),
            "models": self.models.list(),
            "terms": self.store.list_terms(),
            "device": self.models.device(),
            "storage": self.store.usage(),
            "recoverable": self.store.recoverable_meetings(),
            "purged_meeting_ids": purged,
            "seeded_examples": seeded_examples,
        }

    def start(self, payload):
        """创建会议并启动流式识别。

        Args:
            payload: 标题、语言及实时/精修模型 ID，可附带分类和标签。

        Returns:
            新会议详情；同时发布 ``meeting.started``。
        """
        require(payload, "title", "language", "streaming_model_id", "refined_model_id")
        if self.active:
            raise ValueError("A meeting is already active")
        meeting = self.store.create_meeting(payload)
        self._prepare_active(meeting)
        self.emit("meeting.started", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def resume(self, payload):
        """恢复一场未正常结束的录音，并从给定毫秒位置继续计时。"""
        require(payload, "meeting_id")
        if self.active:
            raise ValueError("A meeting is already active")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] != "recording":
            raise ValueError("Only an unfinished recording can be resumed")
        self._prepare_active(meeting, int(payload.get("start_ms", 0)))
        self.emit("meeting.recovered", {"meeting_id": self.active, "meeting": meeting})
        return meeting

    def _prepare_active(self, meeting, start_ms=0):
        """建立活动会议的双轨识别状态；模型不可用时仍允许安全录音。"""
        self.active = meeting["id"]
        self.stream_state = {
            track: {"start_ms": start_ms, "revision": 0, "segment": start_ms, "last_text": ""}
            for track in ("mic", "system")
        }
        try:
            self.asr = StreamingASR(self.models, meeting["streaming_model_id"])
        except RuntimeError as error:
            self.asr = None
            self.emit(
                "worker.warning",
                {"meeting_id": self.active, "code": "asr_unavailable", "message": str(error)},
            )

    def pause(self, payload):
        """确认目标是当前会议并广播暂停状态；音频停送由前端负责。"""
        require(payload, "meeting_id", "paused")
        self._active(payload["meeting_id"])
        self.emit(
            "meeting.paused",
            {"meeting_id": self.active, "paused": bool(payload["paused"])},
        )
        return {"paused": bool(payload["paused"])}

    def audio(self, payload):
        """持久化一帧音频，并在模型可用时推进实时转写。

        Args:
            payload: 会议 ID、音轨、base64 PCM16、样本率和本帧开始时间；
                ``flush`` 可强制结束当前句。

        Returns:
            累计样本数，以及模型可用时的当前文本和句末状态。

        Notes:
            partial 只通过事件发送；句末文本才写入数据库。
        """
        require(payload, "meeting_id", "track", "pcm", "sample_rate", "start_ms")
        self._active(payload["meeting_id"])
        samples_total = self.store.append_audio(
            self.active, payload["track"], payload["pcm"], int(payload["sample_rate"])
        )
        if not self.asr:
            return {"samples": samples_total}
        pcm = __import__("base64").b64decode(payload["pcm"], validate=True)
        values = array("h")
        values.frombytes(pcm)
        if sys.byteorder != "little":
            values.byteswap()
        import numpy

        samples = numpy.asarray(values, dtype=numpy.float32) / 32768.0
        result, final = self.asr.accept(
            payload["track"], samples, int(payload["sample_rate"]), bool(payload.get("flush"))
        )
        state = self.stream_state[payload["track"]]
        text = result.strip() if isinstance(result, str) else result.text.strip()
        end_ms = int(payload["start_ms"] + len(samples) * 1000 / int(payload["sample_rate"]))
        if text and (text != state["last_text"] or final):
            state["revision"] += 1
            segment_id = f"{payload['track']}-{state['segment']}"
            event = {
                "meeting_id": self.active,
                "segment_id": segment_id,
                "revision": state["revision"],
                "text": text,
                "start_ms": state["start_ms"],
                "end_ms": end_ms,
                "speaker": "spk-1" if payload["track"] == "mic" else "spk-2",
                "track": payload["track"],
            }
            state["last_text"] = text
            if final:
                self.store.save_segment(event)
            self.emit("transcript.final" if final else "transcript.partial", event)
            if final:
                state.update(
                    start_ms=end_ms,
                    revision=0,
                    segment=state["segment"] + 1,
                    last_text="",
                )
        return {"samples": samples_total, "text": text, "final": final}

    def stop(self, payload):
        """flush 所有识别流、合成播放文件并结束活动会议。

        Returns:
            状态为 ``ready`` 的会议详情。
        """
        require(payload, "meeting_id", "duration_ms")
        self._active(payload["meeting_id"])
        if self.asr:
            for track in ("mic", "system"):
                self.audio(
                    {
                        "meeting_id": self.active,
                        "track": track,
                        "pcm": "",
                        "sample_rate": 16000,
                        "start_ms": int(payload["duration_ms"]),
                        "flush": True,
                    }
                )
        meeting = self.store.finish_meeting(self.active, payload["duration_ms"])
        self.emit("meeting.stopped", {"meeting_id": self.active, "meeting": meeting})
        self.active, self.asr, self.stream_state = None, None, {}
        return meeting

    def update_meeting(self, payload):
        """更新会议的可编辑元数据并返回最新详情。"""
        require(payload, "meeting_id", "updates")
        return self.store.update_meeting(payload["meeting_id"], payload["updates"])

    def delete_meeting(self, payload):
        """删除非活动会议。

        普通会议进入最近删除；示例会议由存储层永久删除以立即释放空间。
        """
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        self.store.soft_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "deleted": True}

    def restore_meeting(self, payload):
        """恢复软删除会议并返回完整详情。"""
        require(payload, "meeting_id")
        self.store.soft_delete(payload["meeting_id"], restore=True)
        return self.store.get_meeting(payload["meeting_id"])

    def rename_speaker(self, payload):
        """保存说话人名称和可选锁定状态，并返回更新后的会议。"""
        require(payload, "meeting_id", "speaker_id", "name")
        self.store.rename_speaker(
            payload["meeting_id"],
            payload["speaker_id"],
            payload["name"],
            payload.get("locked", False),
        )
        return self.store.get_meeting(payload["meeting_id"])

    def delete_term(self, payload):
        """删除一个术语并返回剩余术语列表。"""
        require(payload, "term_id")
        self.store.delete_term(payload["term_id"])
        return self.store.list_terms()

    def download_model(self, payload):
        """下载指定模型，返回安装目录字符串。"""
        require(payload, "model_id")
        return {"path": str(self.models.download(payload["model_id"]))}

    def delete_model(self, payload):
        """删除模型；活动会议正在使用的实时模型不可删除。"""
        require(payload, "model_id")
        if self.active and self.store.get_meeting(self.active)["streaming_model_id"] == payload["model_id"]:
            raise ValueError("Cannot delete the model used by the active meeting")
        self.models.delete(payload["model_id"])
        return {"model_id": payload["model_id"], "deleted": True}

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
        safe_title = re.sub(r'[<>:"/\\|?*]+', "-", meeting["title"]).strip() or meeting["id"]
        path = directory / f"{safe_title}.{export_format}"
        if content_type == "audio":
            return self._export_audio(meeting, path, export_format, payload.get("track", "mix"))
        if content_type not in {"transcript", "notes"}:
            raise ValueError("Export content must be transcript, notes, or audio")
        if export_format not in {"md", "txt", "json", "srt", "docx", "pdf"}:
            raise ValueError("Unsupported text export format")
        segments = self._latest_segments(meeting["segments"])
        if export_format == "json":
            content = json.dumps({**meeting, "segments": segments}, ensure_ascii=False, indent=2)
        elif export_format == "srt":
            content = "\n\n".join(
                f"{index}\n{self._srt_time(item['start_ms'])} --> {self._srt_time(item['end_ms'])}\n"
                f"{item['speaker_name']}: {item['text']}"
                for index, item in enumerate(segments, 1)
            )
        elif content_type == "notes":
            summary = meeting.get("summary", {}).get("data") if meeting.get("summary") else None
            if not summary:
                raise ValueError("Generate meeting notes before exporting them")
            content = self._summary_markdown(meeting["title"], summary)
        else:
            lines = [
                f"[{self._clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
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

    def _export_audio(self, meeting, path, export_format, track):
        """通过 ffmpeg 导出单轨或归一化混音。

        Returns:
            包含导出路径和格式的字典。
        """
        if export_format not in {"flac", "wav", "m4a"}:
            raise ValueError("Supported audio formats: flac, wav, m4a")
        playback = meeting["audio"]["playback"]
        inputs = [playback[name] for name in ("mic", "system") if playback.get(name)]
        if track in {"mic", "system"}:
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
            command.extend(["-filter_complex", "amix=inputs=2:duration=longest:normalize=1"])
        if export_format == "m4a":
            command.extend(["-c:a", "aac", "-b:a", "192k"])
        command.append(str(path))
        subprocess.run(command, check=True)
        return {"path": str(path), "format": export_format}

    @staticmethod
    def _summary_markdown(title, summary):
        """把结构化纪要转换成适合导出的 Markdown 文本。"""
        decisions = "\n".join(f"- {item['text']}" for item in summary["decisions"]) or "- 无"
        actions = "\n".join(
            f"- [ ] {item['task']} · {item.get('owner') or '待确认'} · {item.get('due') or '无截止日期'}"
            for item in summary["action_items"]
        ) or "- 无"
        questions = "\n".join(f"- {item}" for item in summary["open_questions"]) or "- 无"
        return (
            f"# {title}\n\n{summary['summary']}\n\n## 决定\n\n{decisions}\n\n"
            f"## 待办\n\n{actions}\n\n## 开放问题\n\n{questions}\n"
        )

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
                    ["textutil", "-convert", "docx", "-output", str(destination), str(source)],
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
                raise ValueError(f"{export_format.upper()} export is unavailable on this device")
        finally:
            source.unlink(missing_ok=True)
        return destination

    def refine(self, payload):
        """对停止后的会议执行会后转写和单轨说话人聚类。

        Args:
            payload: 会议 ID；可选已知说话人数和聚类阈值。

        Returns:
            状态更新为 ``refined`` 的会议详情。

        Notes:
            双轨会议沿用音轨身份；单轨会议先生成 diarization 时间段。人工编辑
            或锁定的说话人优先于聚类结果。
        """
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] == "recording":
            raise ValueError("Stop the meeting before refinement")
        num_speakers = int(payload.get("num_speakers", SETTINGS["diarization"]["num_speakers"]))
        threshold = float(
            payload.get("cluster_threshold", SETTINGS["diarization"]["cluster_threshold"])
        )
        if num_speakers != -1 and num_speakers < 1:
            raise ValueError("num_speakers must be -1 or a positive integer")
        if not 0 <= threshold <= 1:
            raise ValueError("cluster_threshold must be between 0 and 1")
        tracks = [
            track
            for track in ("mic", "system")
            if meeting["audio"]["playback"].get(track)
        ]
        if not tracks:
            raise ValueError("The meeting has no audio to refine")
        turns = []
        if len(tracks) == 1:
            samples, sample_rate = self._read_wav(meeting["audio"]["playback"][tracks[0]])
            turns = OfflineDiarizer(self.models, num_speakers, threshold).process(
                samples, sample_rate
            )
            self.store.replace_speaker_turns(meeting["id"], turns)
            self.emit(
                "diarization.ready",
                {"meeting_id": meeting["id"], "track": tracks[0], "turns": turns},
            )
        terms = [item["text"] for item in self.store.list_terms()][:200]
        recognizer = RefinedASR(self.models, meeting["refined_model_id"], terms)
        locked_ids = {speaker["id"] for speaker in meeting["speakers"] if speaker["locked"]}
        locked_segments = [
            segment
            for segment in meeting["segments"]
            if segment["user_edited"] or segment["speaker"] in locked_ids
        ]
        for track in tracks:
            samples, sample_rate = self._read_wav(meeting["audio"]["playback"][track])
            window = sample_rate * SETTINGS["asr"]["refined_window_seconds"]
            for offset in range(0, len(samples), window):
                current = samples[offset : offset + window]
                text = recognizer.decode(current, sample_rate)
                if not text:
                    continue
                start_ms = round(offset * 1000 / sample_rate)
                end_ms = start_ms + round(len(current) * 1000 / sample_rate)
                speaker = self._speaker_for(start_ms, end_ms, locked_segments)
                if not speaker:
                    speaker = self._speaker_for(start_ms, end_ms, turns)
                event = {
                    "meeting_id": meeting["id"],
                    "segment_id": f"{track}-{start_ms}",
                    "version": "postprocess",
                    "text": text,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "speaker": speaker or ("spk-1" if track == "mic" else "spk-2"),
                    "track": track,
                }
                self.store.save_segment(event)
                self.emit("refinement.segment", event)
        with self.store.connect() as db:
            db.execute("UPDATE meetings SET status='refined' WHERE id=?", (meeting["id"],))
        result = self.store.get_meeting(meeting["id"])
        self.emit("refinement.ready", {"meeting_id": meeting["id"], "meeting": result})
        return result

    @staticmethod
    def _read_wav(path):
        """读取单声道 PCM16 WAV。

        Returns:
            ``(float32 样本数组, 样本率)``；不支持的声道或位深会报错。
        """
        import wave
        import numpy

        with wave.open(path) as recording:
            if recording.getnchannels() != 1 or recording.getsampwidth() != 2:
                raise ValueError("Refinement requires mono PCM16 WAV audio")
            values = array("h")
            values.frombytes(recording.readframes(recording.getnframes()))
            if sys.byteorder != "little":
                values.byteswap()
            return numpy.asarray(values, dtype=numpy.float32) / 32768.0, recording.getframerate()

    @staticmethod
    def _speaker_for(start_ms, end_ms, intervals):
        """返回与目标时间窗重叠最长的说话人；完全无重叠时返回 ``None``。"""
        overlaps = [
            (min(end_ms, item["end_ms"]) - max(start_ms, item["start_ms"]), item["speaker"])
            for item in intervals
        ]
        overlap, speaker = max(overlaps, default=(0, None))
        return speaker if overlap > 0 else None

    def summarize(self, payload):
        """把逐字稿发送到用户确认的 LLM，并保存可追溯纪要。

        Args:
            payload: 会议和模型连接信息，``consent`` 必须明确为真。

        Returns:
            通过结构及证据段落校验的纪要字典。

        解析失败时仍保存供应商原始响应，避免丢失排障依据。
        """
        require(payload, "meeting_id", "provider", "endpoint", "model", "consent")
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        segments = self._latest_segments(meeting["segments"])
        transcript = "\n".join(
            f"{item['id']} [{self._clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
            for item in segments
        )
        schema = (
            '{"summary":"不超过120字","decisions":[{"text":"...","evidence_segment_ids":["..."]}],'
            '"action_items":[{"task":"...","owner":"...","due":null,'
            '"evidence_segment_ids":["..."]}],"open_questions":[]}'
        )
        prompt = payload.get("prompt") or (
            f"仅基于逐字稿生成会议纪要。只输出符合此结构的 JSON：{schema}\n\n{transcript}"
        )
        try:
            raw = self._call_llm(payload, prompt, json_mode=True)
            data = json.loads(raw)
            self._validate_summary(data, {item["id"] for item in segments})
        except Exception as error:
            raw = locals().get("raw", str(error))
            self.store.save_summary(meeting["id"], None, raw)
            raise ValueError(f"Summary response was saved but could not be parsed: {error}") from error
        self.store.save_summary(meeting["id"], data, raw)
        self.emit("summary.ready", {"meeting_id": meeting["id"], "summary": data})
        return data

    def translate(self, payload):
        """翻译一个已落库段落，并把结果写回所有同 ID 版本。

        Returns:
            可直接作为 ``translation.ready`` 事件发送的字典。
        """
        require(
            payload,
            "meeting_id",
            "segment_id",
            "target_language",
            "endpoint",
            "model",
            "consent",
        )
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        segment = next(
            (item for item in meeting["segments"] if item["id"] == payload["segment_id"]),
            None,
        )
        if not segment:
            raise ValueError("Transcript segment not found")
        translation = self._call_llm(
            payload,
            f"Translate the following text to {payload['target_language']}. "
            f"Return only the translation.\n\n{segment['text']}",
        ).strip()
        self.store.save_translation(meeting["id"], segment["id"], translation)
        event = {
            "meeting_id": meeting["id"],
            "segment_id": segment["id"],
            "translation": translation,
        }
        self.emit("translation.ready", event)
        return event

    @staticmethod
    def _call_llm(payload, prompt, json_mode=False):
        """调用 OpenAI 兼容或 Claude 兼容的 HTTP 接口。

        Args:
            payload: endpoint、model、format、可选 API key 与超时。
            prompt: 发送给模型的用户消息。
            json_mode: OpenAI 兼容接口是否请求 JSON object 响应。

        Returns:
            从常见响应结构中提取的文本；未知结构回退为完整 JSON 字符串。
        """
        body = {
            "model": payload["model"],
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Content-Type": "application/json"}
        if payload.get("format") == "claude":
            body = {
                "model": payload["model"],
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}],
            }
            headers.update({"anthropic-version": "2023-06-01", "x-api-key": payload.get("api_key", "")})
        elif payload.get("api_key"):
            headers["Authorization"] = f"Bearer {payload['api_key']}"
        request = urllib.request.Request(
            payload["endpoint"],
            json.dumps(body).encode(),
            headers,
            method="POST",
        )
        with urllib.request.urlopen(
            request,
            timeout=int(payload.get("timeout", SETTINGS["llm"]["timeout_seconds"])),
        ) as response:
            response_data = json.loads(response.read())
        return (
            response_data.get("message", {}).get("content")
            or response_data.get("choices", [{}])[0].get("message", {}).get("content")
            or (response_data.get("content") or [{}])[0].get("text")
            or json.dumps(response_data, ensure_ascii=False)
        )

    def _active(self, meeting_id):
        """确认命令指向当前活动会议，无返回值。"""
        if meeting_id != self.active:
            raise ValueError("Meeting is not active")

    @staticmethod
    def _latest_segments(segments):
        """选出用于展示和导出的最新逐字稿版本。

        会后版本存在时替代实时版本，人工版本始终拥有最高优先级。
        返回值按开始时间升序排列。
        """
        latest = {}
        priority = {"live": 1, "postprocess": 2, "user": 3}
        base = "postprocess" if any(item["version"] == "postprocess" for item in segments) else "live"
        for item in (item for item in segments if item["version"] in {base, "user"}):
            if priority.get(item["version"], 0) >= priority.get(
                latest.get(item["id"], {}).get("version"), 0
            ):
                latest[item["id"]] = item
        return sorted(latest.values(), key=lambda item: item["start_ms"])

    @staticmethod
    def _validate_summary(data, segment_ids):
        """校验纪要结构，并确保每项决定和待办引用真实逐字稿段落。"""
        required = {"summary", "decisions", "action_items", "open_questions"}
        if not isinstance(data, dict) or not required <= data.keys():
            raise ValueError("Summary JSON does not match the required schema")
        for item in [*data["decisions"], *data["action_items"]]:
            evidence = item.get("evidence_segment_ids")
            if not evidence or any(segment not in segment_ids for segment in evidence):
                raise ValueError("Every decision and action item needs valid evidence")

    @staticmethod
    def _clock(milliseconds):
        """把毫秒时间戳格式化为 ``MM:SS``。"""
        seconds = milliseconds // 1000
        return f"{seconds // 60:02d}:{seconds % 60:02d}"

    @staticmethod
    def _srt_time(milliseconds):
        """把毫秒时间戳格式化为 SRT 的 ``HH:MM:SS,mmm``。"""
        hours, remainder = divmod(milliseconds, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        seconds, millis = divmod(remainder, 1000)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def main():
    """运行 stdin/stdout JSONL 循环；单条命令失败不会终止 Worker。"""
    worker = Worker()
    for line in sys.stdin:
        if not line.strip():
            continue
        command = {}
        try:
            command = json.loads(line)
            worker.response(command.get("id"), worker.handle(command))
        except Exception as error:
            worker.response(command.get("id"), error=error)


if __name__ == "__main__":
    main()
