import base64
import hashlib
import io
import json
import tarfile
import tempfile
import threading
import unittest
import urllib.error
import wave
import zipfile
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from .asr import DownloadCancelled, ChinesePunctuation, EnglishPunctuation, ModelManager, OfflineVAD, RefinedASR, SpeakerTracker
from .audio_io import ensure_wav_duration
from .config import DEFAULT_SETTINGS, SETTINGS, runtime_settings, save_runtime_settings
from .llm_client import complete
from .storage import Store
from .worker import Worker, install_global_error_handlers, main
from .worker_common import TaskCancelled
from .worker_core import WorkerCore
from .worker_llama_sidecar import _Sidecar, strip_reasoning


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.events = []
        self.worker = Worker(self.temp.name, self.events.append)
        self.worker.models.is_ready = lambda _: False

    def tearDown(self):
        self.temp.cleanup()

    def test_worker_protocol_is_safe_on_gbk_stdout(self):
        class GbkStdout:
            def __init__(self):
                self.value = ""

            def write(self, value):
                value.encode("gbk")
                self.value += value

            def flush(self):
                pass

        output = GbkStdout()
        with patch("sys.stdout", output):
            WorkerCore._write_stdout({"title": "예시"})
        self.assertEqual(json.loads(output.value), {"title": "예시"})

    def test_meeting_get_compacts_superseded_word_timestamps(self):
        meeting = self.worker.start({"title": "compact", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        for version, revision, text in (("live", 0, "live"), ("postprocess", 0, "old"), ("postprocess-1", 1, "current")):
            self.worker.store.save_segment({"meeting_id": meeting["id"], "segment_id": version, "version": version, "revision": revision, "start_ms": 0, "end_ms": 1000, "speaker": "spk-1", "text": text, "word_timestamps": [{"text": "word", "overlap_speakers": ["spk-1", "spk-2"]}]})
        result = self.worker.handle({"id": "compact-get", "type": "meeting.get", "payload": {"meeting_id": meeting["id"]}})
        self.assertEqual([segment["text"] for segment in result["segments"]], ["current"])
        self.assertEqual(result["segments"][0]["word_timestamps"], [{"overlap_speakers": ["spk-1", "spk-2"]}])

    def test_worker_command_replaces_lone_surrogates_before_sqlite(self):
        meeting = self.worker.handle(
            {
                "id": "start",
                "type": "meeting.start",
                "payload": {
                    "title": "\ud800会议 😀",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                },
            }
        )
        self.assertEqual(meeting["title"], "\ufffd会议 😀")

    def test_worker_rejects_excessive_command_rate_and_depth(self):
        for index in range(100):
            with self.assertRaisesRegex(ValueError, "Unknown command"):
                self.worker.handle({"id": str(index), "type": "unknown"})
        with self.assertRaisesRegex(ValueError, "rate limit"):
            self.worker.handle({"id": "limited", "type": "unknown"})
        payload = {}
        for _ in range(65):
            payload = {"a": payload}
        with self.assertRaisesRegex(ValueError, "nested too deeply"):
            WorkerCore(self.temp.name).handle({"id": "deep", "type": "unknown", "payload": payload})

    def test_workspace_delete_restores_meeting_and_workspace_together(self):
        meeting = self.worker.start({"title": "workspace", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        workspace = self.worker.store.create_workspace({"name": "Test"})
        self.worker.store.assign_meeting_to_workspace(meeting["id"], workspace["id"])
        self.worker.store.delete_workspace(workspace["id"])
        self.assertEqual(self.worker.store.list_meetings(include_deleted=True)[0]["id"], meeting["id"])
        self.worker.restore_meeting({"meeting_id": meeting["id"]})
        self.assertEqual(self.worker.store.get_meeting(meeting["id"])["workspace_id"], workspace["id"])
        self.assertEqual(self.worker.store.get_workspace(workspace["id"])["id"], workspace["id"])

    def test_meeting_can_start_in_a_workspace(self):
        workspace = self.worker.store.create_workspace({"name": "Team"})
        meeting = self.worker.start({"title": "workspace", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8", "workspace_id": workspace["id"]})
        self.assertEqual(meeting["workspace_id"], workspace["id"])

    def test_legacy_category_migrates_once_to_workspace_id(self):
        meeting = self.worker.start({"title": "legacy", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        with self.worker.store.connect() as db:
            db.execute("UPDATE meetings SET category='Legacy', workspace_id=NULL WHERE id=?", (meeting["id"],))
            # 模拟旧版数据库：user_version 为 0，下一次初始化应执行一次性结构迁移。
            db.execute("PRAGMA user_version = 0")
        migrated = Store(self.temp.name).get_meeting(meeting["id"])
        self.assertEqual(migrated["category"], "")
        self.assertEqual(Store(self.temp.name).get_workspace(migrated["workspace_id"])["name"], "Legacy")

    def test_schema_migration_runs_once_and_is_idempotent(self):
        """结构迁移按 user_version 只执行一次：升级库迁移、已迁移库跳过。"""
        meeting = self.worker.start({"title": "migrate", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        with self.worker.store.connect() as db:
            db.execute("UPDATE meetings SET category='Old', workspace_id=NULL WHERE id=?", (meeting["id"],))
        with Store(self.temp.name).connect() as db:
            # 模拟旧版库：结构落后 + category 残留。
            db.execute("PRAGMA user_version = 0")
        store = Store(self.temp.name)
        self.assertEqual(store.get_meeting(meeting["id"])["category"], "")
        with store.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 1)
        # 已迁移到目标版本后，再次初始化不再触碰 category 残留（一次性迁移语义）。
        with store.connect() as db:
            db.execute("UPDATE meetings SET category='Stale' WHERE id=?", (meeting["id"],))
        Store(self.temp.name)
        self.assertEqual(Store(self.temp.name).get_meeting(meeting["id"])["category"], "Stale")

    def test_example_workspace_is_not_shown_as_a_real_workspace(self):
        workspace = self.worker.store.create_workspace({"name": "Example"})
        meeting = self.worker.start({"title": "example", "language": "en", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        with self.worker.store.connect() as db:
            db.execute("UPDATE meetings SET is_example=1, workspace_id=? WHERE id=?", (workspace["id"], meeting["id"]))
        Store(self.temp.name)
        self.assertIsNone(Store(self.temp.name).get_meeting(meeting["id"])["workspace_id"])
        self.assertIsNone(Store(self.temp.name).get_workspace(workspace["id"]))

    def test_wav_duration_is_checked_before_loading_audio(self):
        path = Path(self.temp.name) / "long.wav"
        with wave.open(str(path), "wb") as recording:
            recording.setnchannels(1)
            recording.setsampwidth(2)
            recording.setframerate(1000)
            recording.writeframes(b"\0\0" * 2000)
        with self.assertRaisesRegex(ValueError, "too long"):
            ensure_wav_duration(path, 1, "refine")
        ensure_wav_duration(path, 2, "refine")

    def test_cancelling_refinement_task_preserves_completed_turns(self):
        meeting = self.worker.start(
            {"title": "cancel", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"}
        )
        self.worker.store.replace_speaker_turns(
            meeting["id"], [{"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}]
        )
        control = self.worker.tasks.begin("meeting.refine", meeting["id"])
        try:
            self.worker.cancel_task({"task": "meeting.refine", "meeting_id": meeting["id"]})
            with self.assertRaises(TaskCancelled):
                self.worker.wait_task(control)
        finally:
            self.worker.tasks.finish("meeting.refine", meeting["id"], control)

        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["speaker_turns"],
            [{"version": "postprocess", "start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}],
        )

    def test_translation_does_not_wait_for_the_recording_lock(self):
        meeting = self.worker.start(
            {
                "title": "translation lock",
                "language": "en",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "hello",
                "start_ms": 0,
                "end_ms": 1,
                "speaker": "spk-1",
            }
        )
        self.worker.llama_generate = lambda *_args, **_kwargs: "你好"
        done = threading.Event()

        def translate():
            self.worker.translate(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": "mic-0",
                    "target_language": "zh",
                    "consent": True,
                }
            )
            done.set()

        self.worker.state.lock.acquire()
        try:
            thread = threading.Thread(target=translate)
            thread.start()
            self.assertTrue(done.wait(1))
        finally:
            self.worker.state.lock.release()
        thread.join()

    def test_sidecar_timeout_kills_the_stalled_process(self):
        child = Mock()
        child.poll.return_value = None
        child.stdout.readline.return_value = ""

        class ImmediateTimer:
            def __init__(self, _timeout, callback):
                self.callback = callback

            def start(self):
                self.callback()

            def cancel(self):
                pass

        with (
            patch("backend.worker_llama_sidecar.subprocess.Popen", return_value=child),
            patch("backend.worker_llama_sidecar.threading.Timer", ImmediateTimer),
        ):
            response = _Sidecar(["sidecar"], Mock()).request({"type": "generate"})
        self.assertEqual(response, {"type": "error", "message": "Sidecar request timed out"})
        child.kill.assert_called_once()

    def test_meeting_audio_persistence_and_export(self):
        meeting = self.worker.start(
            {
                "title": "接口联调",
                "language": "zh",
                "target_language": None,
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        for track, pcm in (("mic", b"\x10\x00" * 1600), ("system", b"\x20\x00" * 1600)):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": track,
                    "pcm": base64.b64encode(pcm).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "这是联调测试。",
                "start_ms": 0,
                "end_ms": 100,
                "speaker": "spk-1",
            }
        )
        result = self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 100})
        audio = Path(result["audio"]["mic"][0])
        with wave.open(str(audio)) as recording:
            self.assertEqual(recording.getnframes(), 1600)
            self.assertEqual(recording.getframerate(), 16000)
        with wave.open(result["audio"]["playback"]["mix"]) as recording:
            mixed = array("h")
            mixed.frombytes(recording.readframes(1))
            self.assertEqual(mixed[0], 24)
        exported = self.worker.export({"meeting_id": meeting["id"], "format": "srt"})
        self.assertIn("这是联调测试", Path(exported["path"]).read_text())
        docx = self.worker.export({"meeting_id": meeting["id"], "format": "docx"})
        with zipfile.ZipFile(docx["path"]) as archive:
            self.assertIn("这是联调测试", archive.read("word/document.xml").decode())
        pdf = self.worker.export({"meeting_id": meeting["id"], "format": "pdf"})
        self.assertTrue(pdf["print_pdf"])
        self.assertIn("这是联调测试", Path(pdf["path"]).read_text())
        bundle = self.worker.bundle({"meeting_id": meeting["id"]})
        with zipfile.ZipFile(bundle["path"]) as archive:
            self.assertEqual(
                {Path(name).suffix for name in archive.namelist()},
                {".wav", ".md", ".txt"},
            )
        self.assertTrue(self.worker.store.read_manifest(meeting["id"])["closed"])

    def test_audio_started_mid_meeting_is_padded_with_silence(self):
        meeting = self.worker.start(
            {
                "title": "late track",
                "language": "en",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.append_audio(
            meeting["id"], "system", base64.b64encode(b"\x01\x00" * 160).decode(), 16000, 100
        )
        self.assertEqual(self.worker.store.read_manifest(meeting["id"])["tracks"]["system"]["samples"], 1760)

    def test_start_requires_selected_models_when_requested(self):
        with self.assertRaisesRegex(
            RuntimeError,
            "Models zipformer-zh-xlarge-streaming-int8, qwen3-asr-0.6b-int8, eres2net-base-3dspeaker-zh are not installed",
        ):
            self.worker.start(
                {
                    "title": "缺模型",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                    "require_models": True,
                }
            )
        self.assertEqual([], self.worker.store.list_meetings())

    def test_start_requires_translation_model_when_translation_is_selected(self):
        with self.assertRaisesRegex(
            RuntimeError,
            "Models zipformer-zh-xlarge-streaming-int8, qwen3-asr-0.6b-int8, eres2net-base-3dspeaker-zh, hy-mt2-1.8b-q4km are not installed",
        ):
            self.worker.start(
                {
                    "title": "缺翻译模型",
                    "language": "zh",
                    "target_language": "en",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                    "require_models": True,
                }
            )
        self.assertEqual([], self.worker.store.list_meetings())

    def test_utf8_json_files_are_read_explicitly_as_utf8(self):
        with patch.object(
            Path, "read_text", autospec=True, side_effect=Path.read_text
        ) as read_text:
            self.worker.store.seed_examples()
        self.assertTrue(
            any(
                call.kwargs.get("encoding") == "utf-8"
                for call in read_text.call_args_list
            )
        )

    def test_strip_reasoning_removes_plain_thinking_process(self):
        self.assertEqual(
            strip_reasoning("Thinking Process:\n1. Plan\n# Meeting notes\n\nDone"),
            "# Meeting notes\n\nDone",
        )
        self.assertEqual(strip_reasoning("Thinking Process:\n1. Plan"), "")

    def test_summary_appends_transcript_to_custom_prompt_and_parses_code_fence(self):
        meeting = self.worker.start(
            {
                "title": "纪要联调",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "周五完成验收",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        prompts = []
        self.worker.llm_complete = lambda _payload, prompt, **_kwargs: (prompts.append(prompt) or "# **测试会议**\n\n## **行动项**\n\n- 周五完成验收")
        result = self.worker.summarize(
            {
                "meeting_id": meeting["id"],
                "provider": "Anthropic",
                "endpoint": "https://example.test/messages",
                "model": "claude",
                "format": "claude",
                "consent": True,
                "language": "zh",
            }
        )
        self.assertIn("markdown", result)
        self.assertIn("会议纪要助手", prompts[0])
        self.assertIn("周五完成验收", prompts[0])
        progress = [
            event["payload"]["completed"]
            for event in self.events
            if event.get("type") in {"summary.started", "summary.progress"}
        ]
        self.assertEqual(progress, [10, 60, 100])

    def test_summary_ignores_legacy_cleaned_transcript(self):
        meeting = self.worker.start(
            {
                "title": "复用清洗稿",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "已清洗的内容",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        transcript = "mic-0 [00:00] spk-1: 已清洗的内容"
        self.worker.store.save_summary(
            meeting["id"],
            {
                "cleaned_transcript": "不应作为纪要输入",
                "transcript_hash": hashlib.sha256(transcript.encode()).hexdigest(),
            },
            "",
        )
        prompts = []
        self.worker.llm_complete = lambda _payload, prompt, **_kwargs: (
            prompts.append(prompt) or "# **复用清洗稿**\n\n## **会议摘要**\n\n已生成"
        )
        self.worker.summarize(
            {"meeting_id": meeting["id"], "provider": "OpenAI", "endpoint": "https://example.test/chat", "model": "gpt", "consent": True, "language": "zh"}
        )
        self.assertEqual(len(prompts), 1)
        self.assertIn("已清洗的内容", prompts[0])
        self.assertNotIn("不应作为纪要输入", prompts[0])

    def test_summary_uses_live_text_when_postprocess_is_empty(self):
        meeting = self.worker.start(
            {
                "title": "实时逐字稿",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "本周五完成验收",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "postprocess-0",
                "version": "postprocess",
                "text": " ",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        prompts = []
        self.worker.llm_complete = lambda _payload, prompt, **_kwargs: (prompts.append(prompt) or "# **实时逐字稿**")
        self.worker.summarize(
            {
                "meeting_id": meeting["id"],
                "provider": "OpenAI",
                "endpoint": "https://example.test/chat",
                "model": "gpt",
                "consent": True,
                "language": "zh",
            }
        )
        self.assertIn("本周五完成验收", prompts[0])

    def test_summary_without_transcript_returns_readable_error(self):
        meeting = self.worker.start(
            {
                "title": "空会议",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        with self.assertRaisesRegex(
            ValueError, "当前会议暂无逐字稿内容，请先完成转写后再生成会议纪要"
        ):
            self.worker.summarize(
                {
                    "meeting_id": meeting["id"],
                    "provider": "built-in",
                    "model": "local",
                    "consent": True,
                }
            )

    def test_summary_retries_after_generation_failure(self):
        meeting = self.worker.start(
            {
                "title": "失败后重试",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "确认下周发布",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        prompts = []

        def complete(_payload, prompt, **_kwargs):
            prompts.append(prompt)
            if len(prompts) == 1:
                raise RuntimeError("temporary failure")
            return "# **失败后重试**"

        self.worker.llm_complete = complete
        payload = {
            "meeting_id": meeting["id"],
            "provider": "OpenAI",
            "endpoint": "https://example.test/chat",
            "model": "gpt",
            "consent": True,
            "language": "zh",
        }
        with self.assertRaisesRegex(ValueError, "Summary generation failed"):
            self.worker.summarize(payload)
        self.worker.summarize(payload)
        self.assertEqual(len(prompts), 2)
        self.assertIn("确认下周发布", prompts[-1])

    def test_summary_retries_empty_response_once(self):
        meeting = self.worker.start(
            {
                "title": "空响应重试",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "确认下周发布",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        prompts = []

        def complete(_payload, prompt, **_kwargs):
            prompts.append(prompt)
            if len(prompts) == 1:
                return "   "
            return "# **空响应重试成功**"

        self.worker.llm_complete = complete
        payload = {
            "meeting_id": meeting["id"],
            "provider": "OpenAI",
            "endpoint": "https://example.test/chat",
            "model": "gpt",
            "consent": True,
            "language": "zh",
        }
        result = self.worker.summarize(payload)
        self.assertEqual(len(prompts), 2)
        self.assertIn("空响应重试成功", result["markdown"])

    def test_summary_chunks_long_transcript(self):
        meeting = self.worker.start(
            {
                "title": "超长转录分段",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "内容" * 8000,
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        prompts = []

        def complete(_payload, prompt, **_kwargs):
            prompts.append(prompt)
            return "# **块纪要**"

        self.worker.llm_complete = complete
        payload = {
            "meeting_id": meeting["id"],
            "provider": "OpenAI",
            "endpoint": "https://example.test/chat",
            "model": "gpt",
            "consent": True,
            "language": "zh",
        }
        self.worker.summarize(payload)
        # 长转录走分段：每块一次块级摘要 + 一次合并。
        self.assertGreaterEqual(len(prompts), 3)
        self.assertIn("<partial summaries>", prompts[-1])
        self.assertIn("<transcript>", prompts[0])
        # 每个块级提示词都要小于单次生成的转录上限，避免超出上下文。
        for prompt in prompts[:-1]:
            self.assertLess(len(prompt), 14000)
        # 结果保存为合并后的 markdown。
        result = self.worker.store.get_meeting(meeting["id"])["summary"]["data"]
        self.assertIn("# **块纪要**", result["markdown"])

    def test_summary_warns_when_transcript_truncated(self):
        meeting = self.worker.start(
            {
                "title": "超长转录截断提示",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        # 转录远超 MAX_SUMMARY_CHUNKS * SUMMARY_CHUNK_CHARS，必然触发截断。
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "内容" * 60000,
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        prompts = []

        def complete(_payload, prompt, **_kwargs):
            prompts.append(prompt)
            return "# **块纪要**"

        self.worker.llm_complete = complete
        self.worker.summarize(
            {
                "meeting_id": meeting["id"],
                "provider": "OpenAI",
                "endpoint": "https://example.test/chat",
                "model": "gpt",
                "consent": True,
                "language": "zh",
            }
        )
        # 超出块数上限时向用户发出“纪要未覆盖全部内容”的警告。
        warnings = [event for event in self.events if event.get("type") == "worker.warning"]
        self.assertTrue(any("转录过长" in event["payload"]["message"] for event in warnings))

    def test_meeting_speaker_count_reflects_diarization(self):
        meeting = self.worker.start(
            {
                "title": "参与者统计",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        for index, speaker in enumerate(["spk-1", "spk-2", "spk-3"]):
            self.worker.store.save_segment(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": f"mic-{index}",
                    "text": f"发言 {index}",
                    "start_ms": index * 1000,
                    "end_ms": (index + 1) * 1000,
                    "speaker": speaker,
                }
            )
        # 未聚类时回退到字幕中 distinct speaker 数。
        listed = [m for m in self.worker.store.list_meetings() if m["id"] == meeting["id"]][0]
        self.assertEqual(listed["speaker_count"], 3)
        # 聚类后（speaker_turns postprocess）优先使用聚类结果。
        self.worker.store.replace_speaker_turns(
            meeting["id"],
            [
                {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"},
                {"start_ms": 1000, "end_ms": 2000, "speaker": "spk-2"},
                {"start_ms": 2000, "end_ms": 3000, "speaker": "spk-1"},
            ],
        )
        listed = [m for m in self.worker.store.list_meetings() if m["id"] == meeting["id"]][0]
        self.assertEqual(listed["speaker_count"], 2)
        fetched = self.worker.store.get_meeting(meeting["id"])
        self.assertEqual(fetched["speaker_count"], 2)

    def test_meeting_notes_persist_through_update(self):
        meeting = self.worker.start(
            {
                "title": "笔记持久化",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        notes = "# 要点\n\n- 发布计划\n- 风险：网络"
        updated = self.worker.store.update_meeting(meeting["id"], {"notes": notes})
        self.assertEqual(updated["notes"], notes)
        fetched = self.worker.store.get_meeting(meeting["id"])
        self.assertEqual(fetched["notes"], notes)
        # 超长笔记应被截断到存储上限。
        truncated = self.worker.store.update_meeting(meeting["id"], {"notes": "字" * 30000})
        self.assertLessEqual(len(truncated["notes"]), 20000)

    def test_summary_authentication_error_remains_actionable(self):
        meeting = self.worker.start(
            {
                "title": "鉴权失败",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "revision": 0,
                "version": "live",
                "track": "mic",
                "text": "测试",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "local-user",
            }
        )
        self.worker.llm_complete = Mock(
            side_effect=ValueError("LLM request failed (401): invalid_api_key")
        )
        with self.assertRaisesRegex(ValueError, "Summary authentication failed"):
            self.worker.summarize(
                {
                    "meeting_id": meeting["id"],
                    "provider": "OpenAI",
                    "endpoint": "https://example.test/chat",
                    "model": "gpt",
                    "consent": True,
                }
            )

    def test_summary_exports_markdown_and_text(self):
        meeting = self.worker.start(
            {
                "title": "纪要导出",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        summary = {"markdown": "# **纪要导出**\n\n## **行动项**\n\n- 准备报告"}
        self.worker.store.save_summary(meeting["id"], summary, "raw")
        for export_format in ("md", "txt"):
            exported = self.worker.export(
                {
                    "meeting_id": meeting["id"],
                    "content": "notes",
                    "format": export_format,
                }
            )
            self.assertIn("准备报告", Path(exported["path"]).read_text())
        pdf = self.worker.export(
            {"meeting_id": meeting["id"], "content": "notes", "format": "pdf"}
        )
        printed = Path(pdf["path"]).read_text()
        self.assertNotIn("print-brand", printed)
        self.assertIn("<h2>行动项</h2>", printed)
        self.assertNotIn("## **行动项**", printed)

    def test_mynotes_exports_markdown_and_pdf(self):
        meeting = self.worker.start(
            {
                "title": "我的笔记导出",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.update_meeting(
            meeting["id"], {"notes": "# 要点\n\n- 发布计划\n- 风险：网络"}
        )
        for export_format in ("md", "txt"):
            exported = self.worker.export(
                {
                    "meeting_id": meeting["id"],
                    "content": "mynotes",
                    "format": export_format,
                }
            )
            self.assertIn("发布计划", Path(exported["path"]).read_text())
        pdf = self.worker.export(
            {"meeting_id": meeting["id"], "content": "mynotes", "format": "pdf"}
        )
        printed = Path(pdf["path"]).read_text()
        self.assertIn("<h1>要点</h1>", printed)
        # 没有笔记时给出可读错误。
        self.worker.store.update_meeting(meeting["id"], {"notes": ""})
        with self.assertRaisesRegex(ValueError, "会议中没有记录笔记"):
            self.worker.export(
                {"meeting_id": meeting["id"], "content": "mynotes", "format": "md"}
            )

    def test_llm_client_supports_openai_and_anthropic_shapes(self):
        class Response:
            def __init__(self, data):
                self.data = json.dumps(data).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return self.data

        with patch(
            "backend.llm_client.urllib.request.urlopen",
            return_value=Response({"choices": [{"message": {"content": "openai"}}]}),
        ) as request:
            self.assertEqual(
                complete(
                    {
                        "endpoint": "https://example.test/openai",
                        "model": "gpt",
                        "api_key": "token",
                    },
                    "hello",
                    True,
                ),
                "openai",
            )
            sent = request.call_args.args[0]
            self.assertEqual(
                json.loads(sent.data)["response_format"], {"type": "json_object"}
            )
            self.assertEqual(json.loads(sent.data)["tool_choice"], "none")
            self.assertEqual(dict(sent.header_items())["Authorization"], "Bearer token")
            self.assertEqual(dict(sent.header_items())["User-agent"], "Brevia/1.0")
        with patch(
            "backend.llm_client.urllib.request.urlopen",
            return_value=Response({"content": [{"type": "text", "text": "anthropic"}]}),
        ) as request:
            self.assertEqual(
                complete(
                    {
                        "endpoint": "https://example.test/anthropic",
                        "model": "claude",
                        "format": "claude",
                        "api_key": "token",
                    },
                    "hello",
                ),
                "anthropic",
            )
            sent = request.call_args.args[0]
            self.assertEqual(
                sent.full_url, "https://example.test/anthropic/v1/messages"
            )
            self.assertEqual(json.loads(sent.data)["max_tokens"], 2048)
            self.assertEqual(dict(sent.header_items())["X-api-key"], "token")
        with patch(
            "backend.llm_client.urllib.request.urlopen",
            return_value=Response({"content": [{"type": "tool_use", "name": "EnterPlanMode", "input": {}}]}),
        ):
            with self.assertRaisesRegex(ValueError, "tool call instead of text: EnterPlanMode"):
                complete({"endpoint": "https://example.test/anthropic", "model": "claude", "format": "claude"}, "hello")
        with patch(
            "backend.llm_client.urllib.request.urlopen",
            return_value=Response({"choices": [{"message": {"content": "custom"}}]}),
        ) as request:
            self.assertEqual(
                complete({"provider": "custom-openai", "endpoint": "https://gateway.test/v1/chat/completions", "model": "local-model"}, "hello"),
                "custom",
            )
            self.assertNotIn("Authorization", dict(request.call_args.args[0].header_items()))

    def test_cross_track_duplicate_finals_are_suppressed(self):
        first = {
            "track": "mic",
            "text": "我们再一次完整地打一下这一场防疫",
            "start_ms": 1000,
            "end_ms": 4000,
        }
        duplicate = {
            "track": "system",
            "text": "我们再一次完整的打一下这一场防疫",
            "start_ms": 1100,
            "end_ms": 4100,
        }
        distinct = {
            "track": "system",
            "text": "接下来请产品团队介绍下一步安排",
            "start_ms": 1100,
            "end_ms": 4100,
        }
        self.assertFalse(self.worker._is_duplicate_final(first))
        self.assertTrue(self.worker._is_duplicate_final(duplicate))
        self.assertFalse(self.worker._is_duplicate_final(distinct))

    def test_live_text_removes_model_markers_and_repeating_tail(self):
        self.assertEqual(
            Worker._clean_live_text("language English<asr_text>Thought we would reinvent it."),
            "Thought we would reinvent it.",
        )
        self.assertEqual(
            Worker._clean_live_text("<|endoftext|>Human / Computer Interaction"), ""
        )
        self.assertEqual(
            Worker._clean_live_text(
                "介绍一下 all, over, all, over, all, over, all, over"
            ),
            "介绍一下 all, over",
        )
        self.assertEqual(
            Worker._clean_live_text("吞噬天地，那那那那那那那那那那"),
            "吞噬天地，那",
        )
        # decoder 空转的重复片段可能出现在句中（后面仍接正常文字），而非仅句尾。
        self.assertEqual(
            Worker._clean_live_text(
                "隔了好久，就" + "就" * 29 + "。对，但是平常的吧"
            ),
            "隔了好久，就。对，但是平常的吧",
        )
        repeated = "像你们存量的，比如说那家豪普营销的，"
        self.assertEqual(
            Worker._clean_live_text(f"开场。{repeated * 4}继续讨论。"),
            f"开场。{repeated}继续讨论。",
        )

    def test_live_text_removes_qwen3_hallucinated_artifacts(self):
        # Qwen3-ASR 在静音/低信噪窗口会幻听出代码围栏、"language <语言>" 标签等。
        self.assertEqual(Worker._clean_live_text("```python language Chinese"), "")
        self.assertEqual(Worker._clean_live_text("```java"), "")
        self.assertEqual(Worker._clean_live_text("```language=Germantic"), "")
        self.assertEqual(Worker._clean_live_text("```python language None ```"), "")
        self.assertEqual(Worker._clean_live_text("`(1)"), "")
        self.assertEqual(Worker._clean_live_text("**language Chinese**"), "")
        self.assertEqual(Worker._clean_live_text("language Chinese。"), "")
        self.assertEqual(
            Worker._clean_live_text("language Chinese一条是这个域名，它有域名的。"),
            "一条是这个域名，它有域名的。",
        )
        self.assertEqual(
            Worker._clean_live_text("他们聊，也就是说，language Chinese。"),
            "他们聊，也就是说，。",
        )
        self.assertEqual(
            Worker._clean_live_text("这是正常的中文文本。"),
            "这是正常的中文文本。",
        )

    def test_live_qwen_refinement_replaces_unedited_final_only(self):
        meeting = self.worker.start(
            {
                "title": "实时精修",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        event = {
            "meeting_id": meeting["id"],
            "segment_id": "mic-0",
            "revision": 2,
            "text": "这是直 播识别",
            "start_ms": 0,
            "end_ms": 1000,
            "speaker": "spk-1",
            "track": "mic",
        }
        self.worker.store.save_segment(event)

        class Refiner:
            def decode(self, _, __):
                return "这是直播识别。"

        self.worker._postprocess_live_segment(None, Refiner(), event, None, [0.1], 16000)
        segment = self.worker.store.get_meeting(meeting["id"])["segments"][0]
        self.assertEqual((segment["text"], segment["revision"]), ("这是直播识别。", 3))
        self.assertEqual(self.events[-1]["type"], "transcript.refined")
        with self.worker.store.connect() as db:
            db.execute("UPDATE segments SET user_edited=1 WHERE id=?", ("mic-0",))
        self.worker._postprocess_live_segment(None, Refiner(), event, None, [0.1], 16000)
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["segments"][0]["text"],
            "这是直播识别。",
        )

    def test_live_revision_layer_runs_for_every_language(self):
        self.worker.meeting_language = "en"
        event = {"meeting_id": "meeting", "segment_id": "system-0", "text": "fast"}
        executor = self.worker.live_postprocessing = Mock()
        self.worker.live_refiner = object()
        self.worker._postprocess_live_segment_later(event, [0.1], [0.1], 16000)
        executor.submit.assert_called_once()

    def test_live_revision_queues_work_when_the_single_slot_is_busy(self):
        self.worker.live_postprocessing = executor = Mock()
        self.worker.live_refiner = object()
        event = {"meeting_id": "meeting", "segment_id": "system-0", "text": "fast"}
        self.worker._postprocess_live_segment_later(event, [0.1], [0.1], 16000)
        self.worker._postprocess_live_segment_later(event, [0.2], [0.2], 16000)
        self.assertEqual(executor.submit.call_count, 2)

    def test_refinement_keeps_tracks_separate_and_merges_by_timestamp(self):
        meeting = self.worker.start(
            {
                "title": "双轨精修",
                "language": "en",
                "streaming_model_id": "zipformer-en-streaming-int8",
                "refined_model_id": "whisper-large-v3",
            }
        )
        for track, value in (("mic", 16), ("system", 32)):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": track,
                    "pcm": base64.b64encode(bytes((value, 0)) * 32000).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 2000})

        numpy = type(
            "Numpy",
            (),
            {"zeros_like": staticmethod(lambda samples: [0.0] * len(samples))},
        )
        audio = {"mic": ([0.0005] * 32000, 16000), "system": ([0.001] * 32000, 16000)}
        self.worker.models.is_ready = lambda model_id: (
            model_id != SETTINGS["live_asr"]["denoiser_model_id"]
        )
        with (
            patch(
                "backend.worker_refinement.read_mono_wav",
                side_effect=lambda path: audio["mic" if "mic" in path else "system"],
            ),
            patch(
                "backend.worker_refinement.read_mono_wav_window",
                side_effect=lambda path, _start_ms, _end_ms: (
                    audio["mic" if "mic" in path else "system"][0],
                    16000,
                ),
            ),
            patch.dict("sys.modules", {"numpy": numpy}),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
            patch("backend.worker_refinement.SpeakerTracker") as tracker,
            patch("backend.worker_refinement.RefinedASR") as refined,
        ):
            vad.return_value.process.side_effect = lambda samples, _rate: (
                [{"start_ms": 1000, "end_ms": 2000}]
                if samples[0] < 0.0007
                else [{"start_ms": 0, "end_ms": 1000}]
            )
            diarizer.return_value.process.return_value = [
                {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}
            ]
            tracker.return_value.embedding.return_value = None
            refined.return_value.decode_words.side_effect = lambda samples, _rate: (
                ("local slow", [{"text": "local slow", "start_ms": 0, "end_ms": 1000}])
                if samples[0] < 0.0007
                else ("remote slow", [{"text": "remote slow", "start_ms": 0, "end_ms": 1000}])
            )
            self.worker.refine({"meeting_id": meeting["id"]})

        latest = [
            segment
            for segment in self.worker.store.get_meeting(meeting["id"])["segments"]
            if segment["version"] == "postprocess"
        ]
        self.assertEqual(
            [(item["track"], item["text"], item["speaker"]) for item in latest],
            [
                ("mic", "local slow", "mic-spk-1"),
                ("system", "remote slow", "system-spk-1"),
            ],
        )
        self.assertNotIn("mix", {item["track"] for item in latest})
        self.assertEqual(latest[0]["word_timestamps"][0]["speaker"], "mic-spk-1")
    def test_mic_track_matches_registered_voiceprint_on_refine(self):
        meeting = self.worker.start(
            {
                "title": "远端会",
                "language": "en",
                "streaming_model_id": "zipformer-en-streaming-int8",
                "refined_model_id": "whisper-large-v3",
            }
        )
        for track, value in (("mic", 16), ("system", 32)):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": track,
                    "pcm": base64.b64encode(bytes((value, 0)) * 32000).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 2000})

        numpy = type(
            "Numpy",
            (),
            {"zeros_like": staticmethod(lambda samples: [0.0] * len(samples))},
        )
        audio = {"mic": ([0.0005] * 32000, 16000), "system": ([0.001] * 32000, 16000)}
        self.worker.models.is_ready = lambda model_id: (
            model_id != SETTINGS["live_asr"]["denoiser_model_id"]
        )
        with (
            patch(
                "backend.worker_refinement.read_mono_wav",
                side_effect=lambda path: audio["mic" if "mic" in path else "system"],
            ),
            patch(
                "backend.worker_refinement.read_mono_wav_window",
                side_effect=lambda path, _start_ms, _end_ms: (
                    audio["mic" if "mic" in path else "system"][0],
                    16000,
                ),
            ),
            patch.dict("sys.modules", {"numpy": numpy}),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
            patch("backend.worker_refinement.SpeakerTracker") as tracker,
            patch("backend.worker_refinement.RefinedASR") as refined,
            patch.object(self.worker.store, "list_speaker_profiles", return_value=[{"id": "p1"}]),
            patch.object(
                self.worker.store,
                "match_speaker_profile",
                side_effect=lambda embedding, _threshold: (
                    {
                        "id": "p1",
                        "name": "李雷",
                        "sample_count": 3,
                        "score": 0.9,
                        "runner_up_score": 0.4,
                    }
                    if embedding == [1.0, 0.0, 0.0]
                    else None
                ),
            ),
        ):
            vad.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000}]
            diarizer.return_value.process.return_value = [
                {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}
            ]
            # 只有麦克风轨道给出可匹配声纹的 embedding，远端不命中任何声纹。
            tracker.return_value.embedding.side_effect = lambda clip, _rate: (
                [1.0, 0.0, 0.0] if clip[0] < 0.0007 else None
            )
            refined.return_value.decode_words.side_effect = lambda samples, _rate: (
                ("local slow", [{"text": "local slow", "start_ms": 0, "end_ms": 1000}])
                if samples[0] < 0.0007
                else ("remote slow", [{"text": "remote slow", "start_ms": 0, "end_ms": 1000}])
            )
            self.worker.refine({"meeting_id": meeting["id"]})

        latest = [
            (item["track"], item["speaker"], item["speaker_name"])
            for item in self.worker.store.get_meeting(meeting["id"])["segments"]
            if item["version"] == "postprocess"
        ]
        self.assertEqual(
            latest,
            [
                ("mic", "profile-p1", "李雷"),
                ("system", "system-spk-1", "system-spk-1"),
            ],
        )

    def test_imported_audio_is_diarized(self):
        meeting = self.worker.store.create_meeting(
            {
                "title": "导入录音",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        with wave.open(
            str(self.worker.store.meetings_dir / meeting["id"] / "audio" / "playback-mic.wav"),
            "wb",
        ) as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b"\0\0" * 16000)
        self.worker.store.finish_imported_meeting(meeting["id"], 1000)
        self.worker.models.is_ready = lambda _: True
        numpy = type("Numpy", (), {"zeros_like": staticmethod(lambda samples: [0.0] * len(samples))})
        with (
            patch("backend.worker_refinement.read_mono_wav", return_value=([0.001] * 16000, 16000)),
            patch(
                "backend.worker_refinement.read_mono_wav_window",
                return_value=([0.001] * 16000, 16000),
            ),
            patch.dict("sys.modules", {"numpy": numpy}),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
            patch("backend.worker_refinement.SpeakerTracker") as tracker,
            patch("backend.worker_refinement.RefinedASR") as refined,
        ):
            vad.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000}]
            diarizer.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000, "speaker": "spk-2"}]
            tracker.return_value.embedding.return_value = None
            refined.return_value.decode_words.return_value = ("导入内容", [{"text": "导入内容", "start_ms": 0, "end_ms": 1000}])
            self.worker.refine({"meeting_id": meeting["id"]})

        diarizer.return_value.process.assert_called_once()
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["segments"][-1]["speaker"],
            "spk-2",
        )

    def test_refinement_does_not_denoise_audio_by_default(self):
        meeting = self.worker.store.create_meeting(
            {
                "title": "降噪精修",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        audio_path = self.worker.store.meetings_dir / meeting["id"] / "audio" / "playback-mic.wav"
        with wave.open(str(audio_path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b"\0\0" * 16000)
        self.worker.store.finish_imported_meeting(meeting["id"], 1000)
        self.worker.models.is_ready = lambda _: True
        numpy = type("Numpy", (), {"zeros_like": staticmethod(lambda samples: [0.0] * len(samples))})
        with (
            patch("backend.worker_refinement.read_mono_wav", return_value=([0.001] * 16000, 16000)),
            patch("backend.worker_refinement.read_mono_wav_window", return_value=([0.001] * 16000, 16000)) as read_window,
            patch.dict("sys.modules", {"numpy": numpy}),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
            patch("backend.worker_refinement.SpeakerTracker") as tracker,
            patch("backend.worker_refinement.RefinedASR") as refined,
        ):
            vad.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000}]
            diarizer.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}]
            tracker.return_value.embedding.return_value = None
            refined.return_value.decode_words.return_value = ("内容", [{"text": "内容", "start_ms": 0, "end_ms": 1000}])
            self.worker.refine({"meeting_id": meeting["id"]})

        self.assertEqual(read_window.call_args.args[0], str(audio_path))

    def test_auto_speaker_clustering_does_not_split_identical_embeddings(self):
        labels = self.worker._auto_cluster_embeddings(
            [[1.0, 0.0]] * 6, [2000] * 6
        )
        self.assertEqual(labels, [0] * 6)

    def test_auto_speaker_clustering_keeps_supported_near_optimal_clusters(self):
        import numpy

        vectors = []
        for index in range(7):
            angle = index * 2 * numpy.pi / 7
            vectors.extend([[numpy.cos(angle), numpy.sin(angle)]] * 4)
        labels = self.worker._auto_cluster_embeddings(vectors, [2000] * len(vectors))
        self.assertEqual(len(set(labels)), 7)

    def test_refinement_matches_each_speaker_profile_once(self):
        turns = [
            {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1", "_embedding": [0.5, 0.5]},
            {"start_ms": 1000, "end_ms": 5000, "speaker": "spk-1", "_embedding": [1.0, 0.0]},
            {"start_ms": 5000, "end_ms": 7000, "speaker": "spk-2", "_embedding": [0.0, 1.0]},
        ]
        self.worker.store.list_speaker_profiles = Mock(return_value=[{"id": "p1"}])
        self.worker.store.match_speaker_profile = Mock(return_value=None)

        self.worker._match_speaker_profiles({"id": "meeting"}, turns)

        self.assertEqual(self.worker.store.match_speaker_profile.call_count, 2)

    def test_fixed_speaker_refinement_matches_profiles(self):
        import numpy

        meeting = {"id": "meeting", "audio": {"playback": {"mic": "audio.wav"}}}
        with (
            patch("backend.worker_refinement.ensure_wav_duration"),
            patch("backend.worker_refinement.read_mono_wav", return_value=(numpy.zeros(16000), 16000)),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
            patch("backend.worker_refinement.SpeakerTracker"),
            patch.object(self.worker, "_match_speaker_profiles") as match,
        ):
            vad.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000}]
            diarizer.return_value.process.return_value = [{"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}]
            self.worker.store.list_speaker_profiles = Mock(return_value=[{"id": "zhou"}])
            self.worker._prepare_track(
                "mic", meeting, SimpleNamespace(paused=threading.Event(), cancelled=threading.Event()), {"mic"}, False, 2, 0.35
            )
        match.assert_called_once()

    def test_auto_speaker_refinement_reuses_the_audio_buffer(self):
        import numpy

        samples = numpy.ones(16000)
        meeting = {"id": "meeting", "audio": {"playback": {"mic": "audio.wav"}}}
        with (
            patch("backend.worker_refinement.ensure_wav_duration"),
            patch("backend.worker_refinement.read_mono_wav", return_value=(samples, 16000)),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
        ):
            vad.return_value.process.return_value = [{"start_ms": 250, "end_ms": 750}]
            diarizer.return_value.process.return_value = []
            self.worker._prepare_track(
                "mic", meeting, SimpleNamespace(paused=threading.Event(), cancelled=threading.Event()), {"mic"}, False, -1, 0.35
            )
        self.assertIs(diarizer.return_value.process.call_args.args[0], samples)
        self.assertEqual(samples[0], 0)
        self.assertEqual(samples[13000], 0)

    def test_long_refinement_isolates_native_diarization(self):
        meeting = {"id": "meeting", "audio": {"playback": {"mic": "audio.wav"}}}
        control = SimpleNamespace(
            paused=threading.Event(), cancelled=threading.Event()
        )
        with (
            patch("backend.worker_refinement.ensure_wav_duration"),
            patch(
                "backend.worker_refinement.read_mono_wav",
                return_value=([0.1] * 16_001, 1),
            ),
            patch("backend.worker_refinement.OfflineVAD") as vad,
            patch("backend.worker_refinement.OfflineDiarizer") as diarizer,
            patch.object(
                self.worker,
                "_diarize_long_track",
                return_value=[
                    {
                        "start_ms": 0,
                        "end_ms": 6000,
                        "speaker": "spk-9",
                        "_embedding": [1.0, 0.0],
                    }
                ],
            ) as isolated,
        ):
            vad.return_value.process.return_value = [
                {"start_ms": 0, "end_ms": 6000}
            ]
            _, _, turns, _ = self.worker._prepare_track(
                "mic", meeting, control, {"mic"}, False, -1, 0.35
            )
        isolated.assert_called_once()
        diarizer.assert_not_called()
        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 6000, "speaker": "spk-1"}])

    def test_long_diarization_stays_on_fallback_after_native_crash(self):
        control = SimpleNamespace(paused=threading.Event(), cancelled=threading.Event())
        calls = []

        def diarize(_, payload, __):
            calls.append(payload["vad_fallback"])
            if len(calls) <= 2:
                raise RuntimeError("native crash")
            return []

        with patch.object(self.worker, "_run_diarization_process", side_effect=diarize):
            turns = self.worker._diarize_long_track(
                "audio.wav",
                45_000,
                [{"start_ms": 0, "end_ms": 45_000}],
                "segmentation",
                0.35,
                control,
            )

        self.assertEqual(calls, [False, True, True, True])
        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 15_000, "speaker": "spk-1", "_embedding": None}])

    def test_offline_vad_drains_long_audio_without_losing_timestamps(self):
        class Detector:
            def __init__(self, _, buffer_seconds):
                type(self).last_buffer_seconds = buffer_seconds
                self.queue, self.position = [], 0

            def accept_waveform(self, samples):
                self.queue.append(
                    type("Segment", (), {"start": self.position, "samples": samples})()
                )
                self.position += len(samples)

            def flush(self):
                pass

            def empty(self):
                return not self.queue

            @property
            def front(self):
                return self.queue[0]

            def pop(self):
                self.queue.pop(0)

        vad = OfflineVAD.__new__(OfflineVAD)
        vad.config = type("Config", (), {"sample_rate": 16000})()
        vad.sherpa_onnx = type("Sherpa", (), {"VoiceActivityDetector": Detector})
        self.assertEqual(
            vad.process([0.1] * 400000),
            [
                {"start_ms": 0, "end_ms": 10000},
                {"start_ms": 10000, "end_ms": 20000},
                {"start_ms": 20000, "end_ms": 25000},
            ],
        )
        self.assertEqual(vad.sherpa_onnx.VoiceActivityDetector.last_buffer_seconds, 100)
        vad.process([0.1] * 1600001)
        self.assertEqual(vad.sherpa_onnx.VoiceActivityDetector.last_buffer_seconds, 102)

    def test_refinement_decode_range_adds_context_without_crossing_speakers(self):
        turn = {"start_ms": 1000, "end_ms": 1200, "speaker": "spk-1"}
        self.assertEqual(
            self.worker._decode_range(turn, None, None, 5000), (200, 2000)
        )
        self.assertEqual(
            self.worker._decode_range(
                turn,
                {"start_ms": 0, "end_ms": 950, "speaker": "spk-2"},
                {"start_ms": 1250, "end_ms": 2000, "speaker": "spk-2"},
                5000,
            ),
            (950, 1250),
        )

    def test_refinement_turns_preserve_speaker_boundaries(self):
        turns = self.worker._refinement_turns(
            [
                {"start_ms": 0, "end_ms": 18000, "speaker": "spk-1"},
                {"start_ms": 18000, "end_ms": 21000, "speaker": "spk-2"},
            ],
            21000,
            15000,
        )
        self.assertEqual(
            [(turn["start_ms"], turn["end_ms"], turn["speaker"]) for turn in turns],
            [(0, 15000, "spk-1"), (15000, 18000, "spk-1"), (18000, 21000, "spk-2")],
        )
        self.assertEqual(
            [turn["speaker"] for turn in turns], ["spk-1", "spk-1", "spk-2"]
        )

    def test_refinement_overlap_removes_repeated_prefix(self):
        self.assertEqual(
            self.worker._trim_refinement_overlap(
                "我们确认下周的发布计划", "发布计划和负责人"
            ),
            "和负责人",
        )
        self.assertEqual(
            self.worker._trim_refinement_overlap(
                "这是一次完整的会议结论和行动项", "这是一次完整的会议结论和行动项"
            ),
            "",
        )

    def test_refinement_splits_long_turns_for_second_pass(self):
        turns = self.worker._split_long_turns(
            [{"start_ms": 0, "end_ms": 13_000, "speaker": "spk-9"}]
        )
        self.assertEqual(
            [(turn["start_ms"], turn["end_ms"]) for turn in turns],
            [(0, 6000), (6000, 12000), (12000, 13000)],
        )

    def test_speaker_turn_stabilization_and_word_overlap(self):
        turns = self.worker._stabilize_speaker_turns([
            {"start_ms": 0, "end_ms": 900, "speaker": "spk-1"},
            {"start_ms": 900, "end_ms": 1100, "speaker": "spk-2"},
            {"start_ms": 1100, "end_ms": 2000, "speaker": "spk-1"},
        ])
        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 2000, "speaker": "spk-1"}])
        turns = self.worker._stabilize_speaker_turns([
            {"start_ms": 0, "end_ms": 3000, "speaker": "spk-1"},
            {"start_ms": 2500, "end_ms": 2900, "speaker": "spk-2"},
        ])
        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 3000, "speaker": "spk-1"}])
        self.assertEqual(
            self.worker._overlap_speakers(750, 900, [
                {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"},
                {"start_ms": 700, "end_ms": 1200, "speaker": "spk-2"},
            ]),
            ["spk-1", "spk-2"],
        )

    def test_deoverlap_speaker_turns_splits_overlapping_boundaries(self):
        deoverlapped = self.worker._deoverlap_speaker_turns([
            {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"},
            {"start_ms": 900, "end_ms": 2000, "speaker": "spk-2"},
        ])
        self.assertEqual(
            [(turn["start_ms"], turn["end_ms"], turn["speaker"]) for turn in deoverlapped],
            [(0, 950, "spk-1"), (950, 2000, "spk-2")],
        )

    def test_deoverlap_speaker_turns_keeps_same_speaker_overlap(self):
        deoverlapped = self.worker._deoverlap_speaker_turns([
            {"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"},
            {"start_ms": 900, "end_ms": 2000, "speaker": "spk-1"},
        ])
        self.assertEqual(len(deoverlapped), 2)

    def test_overlap_speakers_ignores_boundary_noise(self):
        self.assertEqual(
            self.worker._overlap_speakers(900, 1000, [
                {"start_ms": 0, "end_ms": 950, "speaker": "spk-1"},
                {"start_ms": 950, "end_ms": 2000, "speaker": "spk-2"},
            ]),
            [],
        )

    def test_vad_params_for_language_falls_back_to_default(self):
        self.assertEqual(
            self.worker._vad_params_for("zh"), SETTINGS["vad"]["zh"]
        )
        self.assertEqual(
            self.worker._vad_params_for("en"), SETTINGS["vad"]["default"]
        )
        self.assertEqual(
            self.worker._vad_params_for("auto"), SETTINGS["vad"]["default"]
        )

    def test_refined_asr_language_hints_force_chinese(self):
        self.assertEqual(RefinedASR._funasr_nano_language("zh"), "中文")
        self.assertEqual(RefinedASR._funasr_nano_language("ja"), "日语")
        self.assertEqual(RefinedASR._funasr_nano_language("auto"), "")
        self.assertEqual(RefinedASR._funasr_nano_language(None), "")
        self.assertEqual(RefinedASR._whisper_language("zh"), "zh")
        self.assertEqual(RefinedASR._whisper_language("auto"), "")

    def test_assemble_utterances_merges_adjacent_same_speaker_windows(self):
        assembled = self.worker._assemble_utterances([
            {"track": "mic", "start_ms": 0, "end_ms": 15000, "speaker": "mic-spk-1", "text": "我们来看一下", "word_timestamps": [{"text": "我", "start_ms": 0, "end_ms": 100}]},
            {"track": "mic", "start_ms": 15000, "end_ms": 30000, "speaker": "mic-spk-1", "text": "这个数据的情况", "word_timestamps": [{"text": "这", "start_ms": 15000, "end_ms": 15100}]},
            {"track": "mic", "start_ms": 30000, "end_ms": 45000, "speaker": "mic-spk-2", "text": "对，是这样的", "word_timestamps": []},
        ])
        self.assertEqual(
            [(item["start_ms"], item["end_ms"], item["speaker"], item["text"]) for item in assembled],
            [
                (0, 30000, "mic-spk-1", "我们来看一下这个数据的情况"),
                (30000, 45000, "mic-spk-2", "对，是这样的"),
            ],
        )
        self.assertEqual(len(assembled[0]["word_timestamps"]), 2)

    def test_assemble_utterances_keeps_tracks_and_speakers_separate(self):
        assembled = self.worker._assemble_utterances([
            {"track": "mic", "start_ms": 0, "end_ms": 1000, "speaker": "mic-spk-1", "text": "你好", "word_timestamps": []},
            {"track": "system", "start_ms": 0, "end_ms": 1000, "speaker": "system-spk-1", "text": "hi", "word_timestamps": []},
        ])
        self.assertEqual(len(assembled), 2)
        self.assertEqual([item["track"] for item in assembled], ["mic", "system"])

    def test_assemble_utterances_splits_at_sentence_boundary_when_overlong(self):
        # 第二句跨窗口：窗口 2 以半句话结尾，句末在窗口 3 中。超长时应在
        # 第一个完整句末处拆分，而不是从窗口边界（半句话）硬切。
        assembled = self.worker._assemble_utterances([
            {"track": "system", "start_ms": 0, "end_ms": 15000, "speaker": "system-spk-1", "text": "第一句话。", "word_timestamps": [{"text": "a", "start_ms": 0, "end_ms": 1000}]},
            {"track": "system", "start_ms": 15000, "end_ms": 30000, "speaker": "system-spk-1", "text": "第二句话还没", "word_timestamps": [{"text": "b", "start_ms": 15000, "end_ms": 16000}]},
            {"track": "system", "start_ms": 30000, "end_ms": 45000, "speaker": "system-spk-1", "text": "讲完。第三句话。", "word_timestamps": [{"text": "c", "start_ms": 30000, "end_ms": 31000}]},
        ])
        self.assertEqual(
            [(item["text"]) for item in assembled],
            ["第一句话。", "第二句话还没讲完。第三句话。"],
        )

    def test_join_utterance_text_preserves_cjk_and_adds_latin_space(self):
        self.assertEqual(self.worker._join_utterance_text("我们看", "一下"), "我们看一下")
        self.assertEqual(self.worker._join_utterance_text("hello", "world"), "hello world")
        self.assertEqual(self.worker._join_utterance_text("", "内容"), "内容")


    def test_profile_assignment_requires_a_clear_best_match(self):
        self.assertTrue(self.worker._is_confident_profile_match({"score": 0.82, "runner_up_score": 0.71}))
        self.assertFalse(self.worker._is_confident_profile_match({"score": 0.82, "runner_up_score": 0.76}))

    def test_refinement_segment_ids_remain_unique_for_overlapping_turns(self):
        ids = set()
        self.assertEqual(self.worker._refinement_segment_id("mix", 0, 0, ids), "mix-0")
        self.assertEqual(
            self.worker._refinement_segment_id("mix", 0, 1, ids), "mix-0-1"
        )

    def test_refinement_versions_preserve_prior_postprocess_segments(self):
        meeting = self.worker.start(
            {
                "title": "再次精修",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        first = self.worker.store.next_refinement_version(meeting["id"])
        self.worker.store.replace_segments(
            meeting["id"],
            [
                {
                    "segment_id": "mic-0",
                    "track": "mic",
                    "start_ms": 0,
                    "end_ms": 1000,
                    "speaker": "spk-1",
                    "text": "旧结果",
                }
            ],
            *first,
        )
        second = self.worker.store.next_refinement_version(meeting["id"])
        self.worker.store.replace_segments(
            meeting["id"],
            [
                {
                    "segment_id": "mic-1000",
                    "track": "mic",
                    "start_ms": 1000,
                    "end_ms": 2000,
                    "speaker": "spk-1",
                    "text": "新结果",
                }
            ],
            *second,
        )
        segments = self.worker.store.get_meeting(meeting["id"])["segments"]
        self.assertEqual(
            [segment["text"] for segment in segments], ["旧结果", "新结果"]
        )
        self.assertEqual(
            [segment["version"] for segment in segments],
            ["postprocess", "postprocess-1"],
        )

    def test_replace_segments_normalizes_duplicate_ids(self):
        meeting = self.worker.start(
            {
                "title": "重叠精修",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        segments = self.worker.store.replace_segments(
            meeting["id"],
            [
                {
                    "segment_id": "mix-0",
                    "track": "mix",
                    "start_ms": 0,
                    "end_ms": 1000,
                    "speaker": "spk-1",
                    "text": "第一段",
                },
                {
                    "segment_id": "mix-0",
                    "track": "mix",
                    "start_ms": 1000,
                    "end_ms": 2000,
                    "speaker": "spk-1",
                    "text": "第二段",
                },
            ],
        )
        self.assertEqual(
            [segment["segment_id"] for segment in segments], ["mix-0", "mix-0-1"]
        )

    def test_refinement_segment_ids_do_not_collide_across_meetings(self):
        first = self.worker.start(
            {
                "title": "第一场",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.stop({"meeting_id": first["id"], "duration_ms": 0})
        second = self.worker.start(
            {
                "title": "第二场",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.replace_segments(
            first["id"],
            [
                {
                    "segment_id": "mic-0",
                    "track": "mic",
                    "start_ms": 0,
                    "end_ms": 1,
                    "speaker": "spk-1",
                    "text": "一",
                }
            ],
        )
        result = self.worker.store.replace_segments(
            second["id"],
            [
                {
                    "segment_id": "mic-0",
                    "track": "mic",
                    "start_ms": 0,
                    "end_ms": 1,
                    "speaker": "spk-1",
                    "text": "二",
                }
            ],
        )
        self.assertEqual(result[0]["segment_id"], "mic-0")

    def test_clear_meeting_storage_removes_meeting_records(self):
        self.worker.start(
            {
                "title": "待清理",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.clear_storage_partition("meetings")
        self.assertEqual(self.worker.store.list_meetings(), [])

    def test_cannot_clear_meetings_while_recording(self):
        self.worker.start(
            {
                "title": "录制中",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        with self.assertRaisesRegex(ValueError, "Stop the active meeting"):
            self.worker.clear_storage({"partition": "meetings"})

    def test_advanced_settings_are_saved_outside_the_default_template(self):
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        settings["asr"]["endpoint_rule2_silence"] = 0.9
        save_runtime_settings(self.temp.name, settings)
        self.assertEqual(
            runtime_settings(self.temp.name)["asr"]["endpoint_rule2_silence"], 0.9
        )

    def test_voiceprint_model_is_fixed_to_eres2net(self):
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        settings["diarization"]["embedding_model_id"] = "campplus-zh-en"
        save_runtime_settings(self.temp.name, settings)
        self.assertNotIn("embedding_model_id", runtime_settings(self.temp.name)["diarization"])
        models = json.loads(Path(__file__).with_name("models.json").read_text())
        self.assertEqual(
            [model["id"] for model in models if model["kind"] == "speaker-embedding"],
            ["eres2net-base-3dspeaker-zh"],
        )
        meeting = self.worker.start(
            {"title": "ERes2Net", "language": "zh", "streaming_model_id": "zipformer-zh-xlarge-streaming-int8", "refined_model_id": "qwen3-asr-0.6b-int8"}
        )
        self.assertNotIn("speaker_embedding_model_id", meeting)
        with self.worker.store.connect() as db:
            sample_columns = {
                row["name"] for row in db.execute("PRAGMA table_info(speaker_profile_samples)")
            }
        self.assertNotIn("reference_text", sample_columns)

    def test_advanced_settings_reject_values_that_break_runtime_math(self):
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        settings["audio"]["chunk_seconds"] = 0
        with self.assertRaisesRegex(ValueError, "chunk_seconds"):
            save_runtime_settings(self.temp.name, settings)

        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        settings["diarization"]["cluster_threshold"] = 2.1
        with self.assertRaisesRegex(ValueError, "cluster_threshold"):
            save_runtime_settings(self.temp.name, settings)

        payload = {
            "title": "人数必须为整数",
            "language": "zh",
            "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
            "refined_model_id": "qwen3-asr-0.6b-int8",
        }
        with self.assertRaisesRegex(ValueError, "must be an integer"):
            self.worker.start({**payload, "num_speakers": 1.5})

    def test_fixed_speaker_count_has_no_artificial_upper_bound(self):
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        settings["diarization"]["num_speakers"] = 21
        self.assertEqual(
            save_runtime_settings(self.temp.name, settings)["diarization"]["num_speakers"],
            21,
        )
        meeting = self.worker.start(
            {
                "title": "大型会议",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
                "num_speakers": 21,
            }
        )
        self.assertEqual(meeting["num_speakers"], 21)

    def test_failed_playback_build_keeps_meeting_recoverable(self):
        meeting = self.worker.start(
            {
                "title": "可恢复",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        with patch.object(
            self.worker.store, "_build_playback", side_effect=OSError("disk full")
        ):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.worker.store.finish_meeting(meeting["id"], 1000)
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["status"], "recording"
        )
        self.assertFalse(self.worker.store.read_manifest(meeting["id"])["closed"])
        with patch.object(
            self.worker.store, "write_manifest", side_effect=OSError("disk full")
        ):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.worker.store.finish_meeting(meeting["id"], 1000)
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["status"], "recording"
        )

    def test_resume_uses_persisted_audio_time_instead_of_wall_clock(self):
        meeting = self.worker.start(
            {
                "title": "恢复时间轴",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.audio(
            {
                "meeting_id": meeting["id"],
                "track": "mic",
                "pcm": base64.b64encode(b"\0\0" * 8000).decode(),
                "sample_rate": 16000,
                "start_ms": 0,
            }
        )
        self.worker.active = None
        self.worker.resume({"meeting_id": meeting["id"], "start_ms": 999_999})
        self.assertEqual(self.worker.stream_state["mic"]["start_ms"], 500)

    def test_corrupt_recovery_manifest_does_not_break_startup(self):
        path = self.worker.store.meetings_dir / "broken" / "manifest.json"
        path.parent.mkdir()
        path.write_text("{broken", encoding="utf-8")
        self.assertEqual(self.worker.store.recoverable_meetings(), [])

    def test_zipformer_xlarge_manifest_uses_the_archive_decoder_name(self):
        self.assertIn(
            "decoder.onnx",
            self.worker.models.get("zipformer-zh-xlarge-streaming-int8")["files"],
        )

    def test_model_downloads_have_checksums(self):
        for model in self.worker.models.catalog.values():
            # Single-file GGUF models are fetched directly (no tar archive), so
            # they carry no archive checksum; skip the archive requirement.
            if model.get("kind") in {"llama-chat", "llama-translation"}:
                continue
            if model.get("downloads"):
                self.assertTrue(all(item.get("sha256") for item in model["downloads"]))
            else:
                self.assertTrue(model.get("archive_sha256"), model["id"])

    def test_model_extraction_rejects_paths_outside_the_install_directory(self):
        archive = Path(self.temp.name) / "unsafe.tar.bz2"
        with tarfile.open(archive, "w:bz2") as bundle:
            member = tarfile.TarInfo("../escaped")
            member.size = 1
            bundle.addfile(member, io.BytesIO(b"x"))
        manager = ModelManager(Path(self.temp.name) / "models")
        manager.catalog["unsafe"] = {"id": "unsafe", "revision": "1", "url": "https://example.test/unsafe.tar.bz2", "size_bytes": archive.stat().st_size, "directory": "model", "files": ["model.onnx"]}
        manager._download_file = lambda _url, destination, _control, progress: (destination.write_bytes(archive.read_bytes()), progress(archive.stat().st_size))
        with self.assertRaises(tarfile.FilterError):
            manager.download("unsafe")
        self.assertFalse((Path(self.temp.name) / "escaped").exists())

    def test_bundled_model_is_ready_without_copying_it_to_user_data(self):
        root = Path(self.temp.name)
        manager = ModelManager(root / "models", bundled_root=root / "bundled-models")
        model_id = "silero-vad"
        bundled = manager.bundled_path(model_id)
        bundled.mkdir(parents=True)
        (bundled / "silero_vad.onnx").write_bytes(b"model")

        self.assertTrue(manager.is_ready(model_id))
        self.assertTrue(manager.is_bundled(model_id))
        self.assertEqual(manager.path(model_id), bundled)
        manager.local_path(model_id).mkdir()
        self.assertEqual(manager.path(model_id), bundled)
        manager.delete(model_id)
        self.assertTrue(manager.is_ready(model_id))

    def test_removed_model_directories_are_cleaned_up(self):
        root = Path(self.temp.name) / "models"
        removed = [
            root / "paraformer-zh-en-int8-asr-models-2024-03-10",
            root / "campplus-zh-en-speaker-recognition-models-campplus",
            root / "zipvoice-zh-en-tts-models-zipvoice-zh-en-emilia",
        ]
        kept = root / "user-files"
        for path in [*removed, kept]:
            path.mkdir(parents=True)

        ModelManager(root)

        self.assertTrue(kept.exists())
        self.assertFalse(any(path.exists() for path in removed))

    def test_china_source_only_proxies_github_downloads(self):
        github = "https://github.com/k2-fsa/sherpa-onnx/releases/download/a/model.tar.bz2"
        self.assertEqual(ModelManager.download_url(github, True), f"https://gh-proxy.com/{github}")
        self.assertEqual(ModelManager.download_url("https://modelscope.cn/model.onnx", True), "https://modelscope.cn/model.onnx")

    def test_china_source_prefers_modelscope_file_downloads(self):
        manager = ModelManager(Path(self.temp.name) / "models")
        manager.catalog["mirror"] = {
            "id": "mirror", "revision": "1", "url": "https://example.test/model.tar.bz2",
            "size_bytes": 5, "files": ["model.onnx"],
            "china_downloads": [{"path": "model.onnx", "url": "https://modelscope.cn/example/model.onnx"}],
        }
        urls = []
        def download(url, destination, _control, progress):
            urls.append(url)
            destination.write_bytes(b"model")
            progress(5)
        manager._download_file = download
        manager.download("mirror", china_source=True)
        self.assertEqual(urls, ["https://modelscope.cn/example/model.onnx"])
        self.assertTrue(manager.is_ready("mirror"))

    def test_asr_backend_override_maps_mps_to_cpu(self):
        with patch.dict("os.environ", {"BREVIA_ASR_BACKEND": "cuda"}):
            self.assertEqual(ModelManager.device()["backend"], "cuda")
        with patch.dict("os.environ", {"BREVIA_ASR_BACKEND": "mps"}):
            self.assertEqual(ModelManager.device()["backend"], "cpu")
        with patch.dict("os.environ", {"BREVIA_ASR_BACKEND": "invalid"}):
            with self.assertRaisesRegex(ValueError, "BREVIA_ASR_BACKEND"):
                ModelManager.device()

    def test_whisper_large_v3_manifest_uses_the_archive_file_names(self):
        self.assertEqual(
            self.worker.models.get("whisper-large-v3")["files"],
            ["large-v3-encoder.int8.onnx", "large-v3-decoder.int8.onnx", "large-v3-tokens.txt"],
        )

    def test_refined_asr_without_token_timestamps_keeps_segment_timing(self):
        class Stream:
            def accept_waveform(self, *_):
                pass

        class Recognizer:
            def create_stream(self):
                return Stream()

            def decode_stream(self, stream):
                stream.result = SimpleNamespace(text="hola mundo", tokens=[], timestamps=[])

        recognizer = object.__new__(RefinedASR)
        recognizer.recognizer = Recognizer()
        self.assertEqual(recognizer.decode_words([0.0] * 16000), ("hola mundo", []))

    def test_nemotron_manifest_uses_the_archive_file_names(self):
        model = self.worker.models.get("nemotron-3.5-asr-streaming-0.6b-560ms-int8")
        self.assertEqual(
            model["files"],
            ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
        )
        self.assertEqual(model["runtime"], "sherpa-onnx==1.13.5")

    def test_streaming_transducer_starts_without_extra_terms(self):
        with patch("backend.worker_session.StreamingASR") as streaming:
            self.worker.start(
                {
                    "title": "本地会议",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                }
            )
        self.assertEqual(
            streaming.call_args.args,
            (self.worker.models, "zipformer-zh-xlarge-streaming-int8", "zh"),
        )

    def test_reconfigure_hot_switches_language_and_models(self):
        ready = {"zipformer-zh-xlarge-streaming-int8", "qwen3-asr-0.6b-int8"}
        self.worker.models.is_ready = lambda model_id: model_id in ready
        with (
            patch("backend.worker_session.StreamingASR") as streaming,
            patch("backend.worker_session.RefinedASR") as refiner,
        ):
            meeting = self.worker.start(
                {
                    "title": "热切换",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                }
            )
            ready.update({"zipformer-en-streaming-int8", "qwen3-asr-1.7b-int8"})
            streaming.reset_mock()
            refiner.reset_mock()
            self.events.clear()
            updated = self.worker.reconfigure(
                {
                    "meeting_id": meeting["id"],
                    "language": "en",
                    "target_language": "zh",
                    "streaming_model_id": "zipformer-en-streaming-int8",
                    "refined_model_id": "qwen3-asr-1.7b-int8",
                }
            )
        self.assertEqual(
            (
                updated["language"],
                updated["target_language"],
                updated["streaming_model_id"],
                updated["refined_model_id"],
            ),
            ("en", "zh", "zipformer-en-streaming-int8", "qwen3-asr-1.7b-int8"),
        )
        stored = self.worker.store.get_meeting(meeting["id"])
        self.assertEqual(
            (
                stored["language"],
                stored["target_language"],
                stored["streaming_model_id"],
                stored["refined_model_id"],
            ),
            ("en", "zh", "zipformer-en-streaming-int8", "qwen3-asr-1.7b-int8"),
        )
        self.assertEqual(
            streaming.call_args.args,
            (self.worker.models, "zipformer-en-streaming-int8", "en"),
        )
        refiner.assert_called_once_with(self.worker.models, "qwen3-asr-1.7b-int8", language="en")
        reconfigured = [
            event for event in self.events if event["type"] == "meeting.reconfigured"
        ]
        self.assertEqual(len(reconfigured), 1)
        self.assertEqual(reconfigured[0]["payload"]["meeting"]["language"], "en")

    def test_reconfigure_rejects_missing_models_without_touching_the_session(self):
        ready = {"zipformer-zh-xlarge-streaming-int8", "qwen3-asr-0.6b-int8"}
        self.worker.models.is_ready = lambda model_id: model_id in ready
        with (
            patch("backend.worker_session.StreamingASR"),
            patch("backend.worker_session.RefinedASR"),
        ):
            meeting = self.worker.start(
                {
                    "title": "缺模型",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                }
            )
            self.worker._wait_prepare()
            running_asr = self.worker.asr
            self.events.clear()
            with self.assertRaisesRegex(RuntimeError, "not installed"):
                self.worker.reconfigure(
                    {
                        "meeting_id": meeting["id"],
                        "streaming_model_id": "zipformer-en-streaming-int8",
                    }
                )
        self.assertIs(self.worker.asr, running_asr)
        stored = self.worker.store.get_meeting(meeting["id"])
        self.assertEqual(stored["streaming_model_id"], "zipformer-zh-xlarge-streaming-int8")
        self.assertFalse(
            [event for event in self.events if event["type"] == "meeting.reconfigured"]
        )

    def test_power_saving_is_stored_and_reconfigured(self):
        self.worker.models.is_ready = lambda model_id: model_id in {
            "zipformer-zh-xlarge-streaming-int8",
            "qwen3-asr-0.6b-int8",
        }
        with patch("backend.worker_session.StreamingASR"), patch(
            "backend.worker_session.RefinedASR"
        ), patch.object(self.worker, "_build_live_punctuation"):
            meeting = self.worker.start(
                {
                    "title": "省电",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                    "power_saving": True,
                }
            )
            self.assertEqual(meeting["power_saving"], 1)
            updated = self.worker.reconfigure(
                {"meeting_id": meeting["id"], "power_saving": False}
            )
        self.assertEqual(updated["power_saving"], 0)
        self.assertFalse(self.worker.power_saving)

    def test_power_saving_does_not_reload_refiner_on_model_change(self):
        self.worker.models.is_ready = lambda _: True
        with patch("backend.worker_session.StreamingASR"), patch(
            "backend.worker_session.RefinedASR"
        ) as refiner, patch.object(self.worker, "_build_live_punctuation"):
            meeting = self.worker.start(
                {
                    "title": "省电切模型",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                    "power_saving": True,
                }
            )
            self.worker.reconfigure(
                {"meeting_id": meeting["id"], "refined_model_id": "whisper-large-v3"}
            )
        refiner.assert_not_called()
        self.assertIsNone(self.worker.live_refiner)
        self.assertIsNone(self.worker.live_postprocessing)

    def test_failed_power_saving_reconfigure_keeps_runtime_and_database(self):
        self.worker.models.is_ready = lambda _: True
        with patch("backend.worker_session.StreamingASR"), patch.object(
            self.worker, "_build_live_punctuation"
        ):
            meeting = self.worker.start(
                {
                    "title": "省电失败",
                    "language": "zh",
                    "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                    "refined_model_id": "qwen3-asr-0.6b-int8",
                    "power_saving": True,
                }
            )
        with patch(
            "backend.worker_session.LiveDenoiser", side_effect=RuntimeError("load failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "load failed"):
                self.worker.reconfigure(
                    {"meeting_id": meeting["id"], "power_saving": False}
                )
        self.assertTrue(self.worker.power_saving)
        self.assertEqual(self.worker.store.get_meeting(meeting["id"])["power_saving"], 1)

    def test_refinement_recovery_preserves_completed_turns(self):
        meeting = self.worker.start(
            {
                "title": "恢复精修",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.set_status(meeting["id"], "refining")
        self.worker.store.replace_speaker_turns(
            meeting["id"], [{"start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}]
        )
        recovered = self.worker.handle(
            {
                "id": "recover-refinement",
                "type": "meeting.refinement-recover",
                "payload": {"meeting_id": meeting["id"]},
            }
        )
        self.assertEqual(recovered["status"], "ready")
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["speaker_turns"],
            [{"version": "postprocess", "start_ms": 0, "end_ms": 1000, "speaker": "spk-1"}],
        )

    def test_initialize_downloads_default_live_models(self):
        with (
            patch.object(self.worker, "download_model") as download,
            patch.object(self.worker, "_start_startup_maintenance"),
        ):
            self.worker.initialize({})
        self.assertEqual(
            [call.args[0]["model_id"] for call in download.call_args_list],
            ["gtcrn-live-denoiser"],
        )

    def test_live_microphone_uses_track_identity_without_native_voiceprint(self):
        meeting = self.worker.start(
            {
                "title": "实时声纹",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.return_value = (SimpleNamespace(text="测试"), True)
        self.worker.punctuation = None
        self.worker.live_refiner = None
        self.worker.audio(
            {
                "meeting_id": meeting["id"],
                "track": "mic",
                "pcm": base64.b64encode(b"\x01\x00" * 1600).decode(),
                "sample_rate": 16000,
                "start_ms": 0,
            }
        )
        final = next(event for event in self.events if event["type"] == "transcript.final")
        self.assertEqual(final["payload"]["speaker"], "local-user")

    def test_live_microphone_distinguishes_speakers_with_voiceprints(self):
        meeting = self.worker.start(
            {
                "title": "实时多人声纹",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.side_effect = [
            (SimpleNamespace(text="这是第一位发言"), True),
            (SimpleNamespace(text="这是第二位发言"), True),
        ]
        self.worker.punctuation = None
        self.worker.live_refiner = None
        self.worker.speaker_tracker = Mock(last_speaker=None)
        self.worker.speaker_tracker.embedding.side_effect = ([1, 0], [0, 1])
        self.worker.speaker_tracker.assign_embedding.side_effect = ("spk-1", "spk-2")
        queued = []
        self.worker.live_postprocessing = Mock()
        self.worker.live_postprocessing.submit.side_effect = (
            lambda function, *args: queued.append((function, args))
        )
        payload = {
            "meeting_id": meeting["id"],
            "track": "mic",
            # 用 3 秒音频，让每段超过短插话阈值，避免被跨说话人并入主线。
            "pcm": base64.b64encode(b"\x01\x00" * 48000).decode(),
            "sample_rate": 16000,
            "start_ms": 0,
        }
        self.worker.audio(payload)
        self.worker.audio({**payload, "start_ms": 3000})
        final_speakers = [
            event["payload"]["speaker"]
            for event in self.events
            if event["type"] == "transcript.final"
        ]
        self.assertEqual(final_speakers, ["local-user", "local-user"])
        self.worker.speaker_tracker.embedding.assert_not_called()
        for function, args in queued:
            function(*args)
        refined_speakers = [
            event["payload"]["speaker"]
            for event in self.events
            if event["type"] == "transcript.refined"
        ]
        self.assertEqual(refined_speakers, ["spk-1", "spk-2"])

    def test_live_pin_forces_endpoint_without_trailing_silence(self):
        meeting = self.worker.start(
            {
                "title": "软钉",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.return_value = (SimpleNamespace(text="一句很长的话"), False)
        self.worker.asr.force_endpoint.return_value = SimpleNamespace(text="一句很长的话。")
        self.worker.punctuation = None
        self.worker.live_refiner = None
        # 语义软钉：无标点时靠硬上限兜底触发
        with patch.dict(SETTINGS["asr"], {"live_pin_seconds": 0.05, "live_pin_max_seconds": 0.05}):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": "mic",
                    "pcm": base64.b64encode(b"\x01\x00" * 1600).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
        final = next(event for event in self.events if event["type"] == "transcript.final")
        self.assertTrue(final["payload"]["pinned"])
        self.worker.asr.force_endpoint.assert_called_once_with("mic")

    def test_live_pin_cuts_at_middle_sentence_boundary(self):
        meeting = self.worker.start(
            {
                "title": "语义软钉",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.return_value = (SimpleNamespace(text="一句很长的话"), False)
        self.worker.asr.force_endpoint.return_value = SimpleNamespace(text="一句很长的话。")
        self.worker.punctuation = Mock()
        # 标点模型总会在末尾补句末；只有中间还有句末才说明真的跨过了一句话。
        self.worker.punctuation.apply.return_value = "一句很长的话。然后呢。"
        self.worker.live_refiner = None
        payload = {
            "meeting_id": meeting["id"],
            "track": "mic",
            "pcm": base64.b64encode(b"\x01\x00" * 1600).decode(),
            "sample_rate": 16000,
        }
        with patch.dict(SETTINGS["asr"], {"live_pin_seconds": 0.05, "live_pin_max_seconds": 40}):
            self.worker.audio({**payload, "start_ms": 0})
        final = next(event for event in self.events if event["type"] == "transcript.final")
        self.assertTrue(final["payload"]["pinned"])
        self.worker.asr.force_endpoint.assert_called_once_with("mic")

    def test_live_pin_does_not_cut_mid_phrase(self):
        meeting = self.worker.start(
            {
                "title": "语义软钉",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.return_value = (SimpleNamespace(text="调控起来简单"), False)
        self.worker.asr.force_endpoint.return_value = SimpleNamespace(text="调控起来简单")
        self.worker.punctuation = Mock()
        # 末尾只有一个「伪句末」，中间没有真句末 → 不应切（「简单直接」不能拆）。
        self.worker.punctuation.apply.return_value = "调控起来简单。"
        self.worker.live_refiner = None
        payload = {
            "meeting_id": meeting["id"],
            "track": "mic",
            "pcm": base64.b64encode(b"\x01\x00" * 1600).decode(),
            "sample_rate": 16000,
        }
        with patch.dict(SETTINGS["asr"], {"live_pin_seconds": 0.05, "live_pin_max_seconds": 40}):
            self.worker.audio({**payload, "start_ms": 0})
        self.assertEqual(
            [event["type"] for event in self.events if event["type"] == "transcript.final"],
            [],
        )
        self.worker.asr.force_endpoint.assert_not_called()

    def test_async_punctuation_defers_when_executor_present(self):
        meeting = self.worker.start(
            {
                "title": "异步标点",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.return_value = (SimpleNamespace(text="测试"), False)
        self.worker.punctuation = Mock()
        self.worker.punctuation.apply.return_value = "测试。"
        executor = self.worker.live_punctuation = Mock()
        self.worker.audio(
            {
                "meeting_id": meeting["id"],
                "track": "mic",
                "pcm": base64.b64encode(b"\x01\x00" * 1600).decode(),
                "sample_rate": 16000,
                "start_ms": 0,
            }
        )
        partial = next(event for event in self.events if event["type"] == "transcript.partial")
        self.assertEqual(partial["payload"]["text"], "测试")
        self.worker.punctuation.apply.assert_not_called()
        executor.submit.assert_called_once()

    def test_unchanged_partial_does_not_repeat_punctuation_inference(self):
        meeting = self.worker.start(
            {
                "title": "标点去重",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.asr = Mock()
        self.worker.asr.accept.return_value = (SimpleNamespace(text="测试"), False)
        self.worker.punctuation = Mock()
        self.worker.punctuation.apply.return_value = "测试。"
        payload = {
            "meeting_id": meeting["id"],
            "track": "mic",
            "pcm": base64.b64encode(b"\x01\x00" * 1600).decode(),
            "sample_rate": 16000,
            "start_ms": 0,
        }
        self.worker.audio(payload)
        self.worker.audio({**payload, "start_ms": 100})
        self.worker.asr.accept.return_value = (SimpleNamespace(text="测试"), True)
        self.worker.audio({**payload, "start_ms": 200})
        self.worker.punctuation.apply.assert_called_once_with("测试")

    def test_initialize_defers_maintenance_from_the_first_response(self):
        with (
            patch.object(self.worker, "download_model"),
            patch.object(self.worker, "_start_startup_maintenance") as maintenance,
            patch.object(self.worker.store, "usage") as usage,
        ):
            result = self.worker.initialize({})
        maintenance.assert_not_called()
        usage.assert_not_called()
        self.assertIn("meetings", result)

    def test_maintenance_starts_only_after_the_first_response(self):
        with patch.object(self.worker, "_start_startup_maintenance") as maintenance:
            self.worker.maintain({})
        maintenance.assert_called_once()

    def test_live_microphone_gain_is_bounded_and_skips_near_silence(self):
        class Samples(list):
            def __mul__(self, gain):
                return Samples([value * gain for value in self])

        enhanced = self.worker._enhance_live_microphone(Samples([0.01, -0.01]))
        self.assertGreater(enhanced[0], 0.01)
        self.assertLessEqual(max(abs(value) for value in enhanced), 0.92)
        quiet = Samples([0.001, -0.001])
        self.assertEqual(self.worker._enhance_live_microphone(quiet), quiet)

    def test_speaker_profile_aggregates_samples_and_matches_known_voice(self):
        first = self.worker.store.save_speaker_profile_sample(
            "王琳", [1, 0, 0], "voice-1"
        )
        second = self.worker.store.save_speaker_profile_sample(
            "王琳", [0.9, 0.1, 0], "voice-2", first["id"]
        )
        matched = self.worker.store.match_speaker_profile([0.95, 0.05, 0], 0.8)
        self.assertEqual(second["sample_count"], 2)
        self.assertEqual(matched["id"], first["id"])
        self.assertIsNone(self.worker.store.match_speaker_profile([0, 0, 1], 0.8))

    def test_assigning_a_sentence_speaker_does_not_enroll_audio(self):
        meeting = self.worker.start(
            {
                "title": "声纹绑定",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "这是当前句",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        with patch.object(
            self.worker.voice_profiles,
            "learn_from_meeting",
            side_effect=lambda _meeting, _speaker, name, **_kwargs: (
                self.worker.store.ensure_speaker_profile(name)
            ),
        ) as learn:
            result = self.worker.assign_segment_speaker(
                {"meeting_id": meeting["id"], "segment_id": "mic-0", "name": "小王"}
            )
        self.assertEqual(result["segments"][-1]["speaker_name"], "小王")
        learn.assert_not_called()
        self.assertEqual(self.worker.store.list_speaker_profiles(), [])

    def test_explicit_segment_enrollment_adds_only_that_audio(self):
        meeting = self.worker.start(
            {
                "title": "显式 Enrollment",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "这是当前句",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        with patch.object(
            self.worker.voice_profiles,
            "learn_from_meeting",
            side_effect=lambda _meeting, _speaker, name, **_kwargs: (
                self.worker.store.ensure_speaker_profile(name)
            ),
        ) as learn:
            result = self.worker.assign_segment_speaker(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": "mic-0",
                    "name": "小王",
                    "enroll": True,
                }
            )
        self.assertEqual(result["segments"][-1]["speaker_name"], "小王")
        learn.assert_called_once()

    def test_renaming_a_live_speaker_does_not_enroll_audio(self):
        meeting = self.worker.start(
            {
                "title": "只改名",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        with patch.object(self.worker.voice_profiles, "learn_from_meeting") as learn:
            result = self.worker.rename_speaker(
                {"meeting_id": meeting["id"], "speaker_id": "spk-1", "name": "小王", "locked": True}
            )
        self.assertEqual(result["speakers"][0]["name"], "小王")
        self.assertTrue(result["speakers"][0]["locked"])
        learn.assert_not_called()

    def test_voiceprint_samples_are_added_only_for_the_selected_sentence(self):
        meeting = self.worker.start(
            {
                "title": "手动补充声纹",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "只加入这一句",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        profile = self.worker.store.ensure_speaker_profile("小林")
        with patch.object(
            self.worker.voice_profiles, "learn_from_meeting", return_value=profile
        ) as learn:
            result = self.worker.add_segment_speaker_profile_sample(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": "mic-0",
                    "profile_id": profile["id"],
                }
            )
        self.assertEqual(result["segments"][-1]["speaker_name"], "小林")
        self.assertEqual(
            learn.call_args.kwargs,
            {"segment_ids": {"mic-0"}, "source_id": profile["id"]},
        )

    def test_recognized_voiceprints_are_not_automatically_collected_after_a_meeting(
        self,
    ):
        meeting = self.worker.start(
            {
                "title": "不自动采样",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        profile = self.worker.store.ensure_speaker_profile("小林")
        self.worker.store.rename_speaker(
            meeting["id"],
            f"profile-{profile['id']}",
            profile["name"],
            profile_id=profile["id"],
        )
        with patch.object(self.worker.voice_profiles, "learn_from_meeting") as learn:
            self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        learn.assert_not_called()

    def test_default_speaker_labels_do_not_create_voiceprints(self):
        meeting = self.worker.start(
            {
                "title": "默认说话人",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "这是当前句",
                "start_ms": 0,
                "end_ms": 1000,
                "speaker": "spk-1",
            }
        )
        for name in (
            "说话人 1",
            "Speaker 1",
            "Hablante 1",
            "話者 1",
            "화자 1",
            "Sprecher 1",
            "Спикер 1",
        ):
            self.worker.assign_segment_speaker(
                {"meeting_id": meeting["id"], "segment_id": "mic-0", "name": name}
            )
        self.assertEqual(self.worker.store.list_speaker_profiles(), [])

    def test_voiceprint_recording_limits_and_incremental_delete(self):
        with patch.dict(
            "backend.store_speakers.SETTINGS",
            {"voice_profiles": {"max_samples": 2, "max_total_seconds": 3}},
            clear=False,
        ):
            profile = self.worker.store.save_speaker_profile_sample(
                "林悦", [1, 0], "sentence-1", duration_ms=1000
            )
            self.worker.store.save_speaker_profile_sample(
                "林悦", [0, 1], "sentence-2", profile["id"], duration_ms=1000
            )
            with self.assertRaisesRegex(ValueError, "at most 2"):
                self.worker.store.save_speaker_profile_sample(
                    "林悦", [1, 0], "sentence-3", profile["id"], duration_ms=1000
                )
        samples = self.worker.store.list_speaker_profile_samples(profile["id"])
        self.worker.store.delete_speaker_profile_sample(profile["id"], samples[0]["id"])
        self.assertEqual(
            self.worker.store.speaker_profile(profile["id"])["sample_count"], 1
        )

    def test_model_downloads_run_in_parallel(self):
        started, third_started, release = threading.Event(), threading.Event(), threading.Event()
        running = []

        def download(model_id, control=None, china_source=False):
            running.append(model_id)
            if len(running) == 2:
                started.set()
            if model_id == "zipformer-ko-streaming-int8":
                third_started.set()
            release.wait(1)

        self.worker.models.download = download
        self.assertEqual(
            self.worker.download_model({"model_id": "zipformer-zh-xlarge-streaming-int8"})["status"],
            "downloading",
        )
        self.assertEqual(
            self.worker.download_model({"model_id": "zipformer-en-streaming-int8"})[
                "status"
            ],
            "downloading",
        )
        self.assertTrue(started.wait(1))
        self.assertEqual(
            self.worker.download_model({"model_id": "zipformer-ko-streaming-int8"})["status"],
            "downloading",
        )
        self.assertFalse(third_started.wait(0.1))
        self.assertEqual(
            self.worker.pause_model({"model_id": "zipformer-zh-xlarge-streaming-int8"})["status"],
            "paused",
        )
        self.assertEqual(
            self.worker.download_model({"model_id": "zipformer-zh-xlarge-streaming-int8"})["status"],
            "downloading",
        )
        release.set()
        self.assertTrue(third_started.wait(1))

    def test_model_worker_delegates_network_retry_to_model_manager(self):
        control = {"paused": threading.Event(), "cancelled": Mock()}
        control["cancelled"].wait.return_value = False
        control["cancelled"].is_set.return_value = False
        self.worker.models.download = Mock(side_effect=urllib.error.URLError("offline"))
        self.worker._download_model("zipformer-zh-xlarge-streaming-int8", control)
        self.assertEqual(self.worker.models.download.call_count, 1)
        self.assertEqual(self.events[-1]["payload"]["status"], "failed")

    def test_cancelled_model_is_retryable_only_after_worker_cleanup(self):
        started, release, calls = threading.Event(), threading.Event(), []

        def download(model_id, control=None, china_source=False):
            calls.append(model_id)
            if len(calls) == 1:
                started.set()
                release.wait(1)
                raise DownloadCancelled()

        self.worker.models.download = download
        model_id = "zipformer-zh-xlarge-streaming-int8"
        self.worker.download_model({"model_id": model_id})
        self.assertTrue(started.wait(1))
        self.assertEqual(
            self.worker.cancel_model({"model_id": model_id})["status"],
            "cancelling",
        )
        self.assertFalse(
            any(event["payload"].get("status") == "cancelled" for event in self.events)
        )
        release.set()
        self.worker.model_downloads[model_id]["task"].join(1)
        self.assertEqual(self.events[-1]["payload"]["status"], "cancelled")
        self.worker.download_model({"model_id": model_id})
        self.assertEqual(calls, [model_id, model_id])

    def test_model_file_download_has_a_timeout_and_reports_bytes(self):
        manager = ModelManager(Path(self.temp.name) / "download-test")
        response = io.BytesIO(b"model-data")
        destination = Path(self.temp.name) / "model.bin"
        progress = []
        with patch("backend.asr.urllib.request.urlopen", return_value=response) as open_url:
            manager._download_file(
                "https://example.test/model.bin",
                destination,
                lambda: None,
                progress.append,
            )
        self.assertEqual(destination.read_bytes(), b"model-data")
        self.assertEqual(progress, [0, 10])
        self.assertEqual(open_url.call_args.kwargs["timeout"], 30)

    def test_model_file_download_retries_from_the_partial_file(self):
        manager = ModelManager(Path(self.temp.name) / "download-test")
        destination = Path(self.temp.name) / "model.bin"

        class InterruptedResponse:
            def __init__(self):
                self.calls = 0

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def getcode(self):
                return 200

            def read(self, _):
                self.calls += 1
                if self.calls == 1:
                    return b"abc"
                raise TimeoutError()

        resumed = io.BytesIO(b"def")
        resumed.getcode = lambda: 206
        with (
            patch("backend.asr.urllib.request.urlopen", side_effect=[InterruptedResponse(), resumed]) as open_url,
            patch("backend.asr.time.sleep"),
        ):
            manager._download_file("https://example.test/model.bin", destination, lambda: None, lambda _: None)
        self.assertEqual(destination.read_bytes(), b"abcdef")
        self.assertEqual(open_url.call_args_list[1].args[0].get_header("Range"), "bytes=3-")

    def test_model_file_download_accepts_a_complete_range_after_416(self):
        manager = ModelManager(Path(self.temp.name) / "download-test")
        destination = Path(self.temp.name) / "model.bin"
        destination.write_bytes(b"complete")
        error = urllib.error.HTTPError(
            "https://example.test/model.bin",
            416,
            "Range Not Satisfiable",
            {"Content-Range": "bytes */8"},
            None,
        )
        progress = []
        with patch("backend.asr.urllib.request.urlopen", side_effect=error) as open_url:
            manager._download_file(
                "https://example.test/model.bin",
                destination,
                lambda: None,
                progress.append,
            )
        self.assertEqual(open_url.call_count, 1)
        self.assertEqual(destination.read_bytes(), b"complete")
        self.assertEqual(progress, [8])

    def test_pausing_a_finished_model_download_is_a_noop(self):
        self.assertEqual(
            self.worker.pause_model({"model_id": "zipformer-zh-xlarge-streaming-int8"})["status"],
            "not_downloading",
        )

    def test_task_pause_and_resume_control(self):
        control = self.worker.begin_task("meeting.refine", "meeting-1")
        with self.assertRaisesRegex(ValueError, "already running"):
            self.worker.begin_task("meeting.refine", "meeting-1")
        self.assertEqual(
            self.worker.pause_task(
                {"task": "meeting.refine", "meeting_id": "meeting-1"}
            )["status"],
            "paused",
        )
        self.assertTrue(control.paused.is_set())
        self.assertEqual(
            self.worker.resume_task(
                {"task": "meeting.refine", "meeting_id": "meeting-1"}
            )["status"],
            "running",
        )
        self.assertFalse(control.paused.is_set())
        self.worker.finish_task("meeting.refine", "meeting-1")
        self.worker.finish_task(
            "meeting.refine",
            "meeting-1",
            self.worker.begin_task("meeting.refine", "meeting-1"),
        )

    def test_recording_state_rejects_concurrent_starts(self):
        results = []

        def start(title):
            try:
                results.append(
                    self.worker.start(
                        {
                            "title": title,
                            "language": "zh",
                            "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                            "refined_model_id": "qwen3-asr-0.6b-int8",
                        }
                    )["id"]
                )
            except ValueError as error:
                results.append(str(error))

        threads = [
            threading.Thread(target=start, args=(title,))
            for title in ("并发一", "并发二")
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(
            len([result for result in results if "already active" not in result]), 1
        )

    def test_store_serializes_concurrent_audio_appends(self):
        meeting = self.worker.store.create_meeting(
            {
                "title": "并发写入",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        pcm = base64.b64encode(b"\x01\x00" * 800).decode()
        threads = [
            threading.Thread(
                target=self.worker.store.append_audio,
                args=(meeting["id"], "mic", pcm),
            )
            for _ in range(4)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        manifest = self.worker.store.read_manifest(meeting["id"])
        self.assertEqual(manifest["tracks"]["mic"]["samples"], 3200)

    def test_worker_and_store_facades_delegate_to_focused_components(self):
        self.assertEqual(Worker.start.__module__, "backend.worker_session")
        self.assertEqual(Worker.summarize.__module__, "backend.worker_llm")
        self.assertEqual(Store.append_audio.__module__, "backend.store_audio")
        self.assertEqual(Store.save_segment.__module__, "backend.store_transcripts")

    def test_global_thread_errors_are_reported(self):
        previous_thread_hook, previous_process_hook = (
            threading.excepthook,
            __import__("sys").excepthook,
        )
        try:
            install_global_error_handlers(self.worker)
            threading.excepthook(
                SimpleNamespace(
                    exc_value=RuntimeError("background failed"),
                    exc_traceback=None,
                    thread=threading.current_thread(),
                )
            )
        finally:
            threading.excepthook, __import__("sys").excepthook = (
                previous_thread_hook,
                previous_process_hook,
            )
        self.assertEqual(self.events[-1]["type"], "worker.error")
        self.assertIn("background failed", self.events[-1]["payload"]["message"])

    def test_bundle_exports_transcript_without_recording(self):
        meeting = self.worker.start(
            {
                "title": "无录音",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        bundle = self.worker.bundle({"meeting_id": meeting["id"]})
        self.assertFalse(bundle["recording_included"])

    def test_stop_persists_the_last_partial_transcript(self):
        meeting = self.worker.start(
            {
                "title": "收尾保存",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )

        class PartialOnlyASR:
            def accept(self, _track, samples, _sample_rate, flush=False):
                return ("", True) if flush else ("停止前的实时字幕", False)

        self.worker.asr = PartialOnlyASR()

        class Samples(list):
            def __truediv__(self, _value):
                return self

        numpy = type(
            "Numpy",
            (),
            {
                "float32": float,
                "asarray": staticmethod(lambda values, dtype: Samples(values)),
            },
        )
        with patch.dict("sys.modules", {"numpy": numpy}):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": "mic",
                    "pcm": base64.b64encode(b"\x10\x00" * 1600).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
            self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 100})
        segments = self.worker.store.get_meeting(meeting["id"])["segments"]
        self.assertEqual(
            [segment["text"] for segment in segments], ["停止前的实时字幕"]
        )

    def test_meeting_search_matches_title_tags_and_transcript(self):
        meeting = self.worker.start(
            {
                "title": "季度路线图",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
                "tags": ["客户反馈"],
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "下周确认预算",
                "start_ms": 0,
                "end_ms": 100,
                "speaker": "spk-1",
            }
        )
        for query in ("路线图", "客户反馈", "确认预算"):
            self.assertEqual(
                [item["id"] for item in self.worker.store.list_meetings(query=query)],
                [meeting["id"]],
            )

    def test_translation_is_explicit_and_persisted(self):
        meeting = self.worker.start(
            {
                "title": "翻译联调",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "你好",
                "start_ms": 0,
                "end_ms": 100,
                "speaker": "spk-1",
            }
        )
        self.worker.llama_generate = lambda *_args, **_kwargs: "Hello"
        translated = self.worker.translate(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "target_language": "en",
                "consent": True,
            }
        )
        self.assertEqual(translated["translation"], "Hello")
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["segments"][0]["translation"],
            "Hello",
        )

    def test_background_commands_do_not_block_the_command_loop(self):
        commands = "".join(
            f'{{"id":"{kind}","type":"{kind}","payload":{{}}}}\n'
            for kind in (
                "translation.generate",
                "summary.generate",
                "speaker-profile.enroll",
                "speaker-profile.verify",
                "speaker-profile.samples",
                "speaker-profile.sample-delete",
                "speaker.rename",
                "segment.speaker",
                "meeting.export",
                "meeting.bundle",
            )
        )
        with (
            patch("backend.worker.Worker"),
            patch("backend.worker.threading.Thread") as thread,
            patch("backend.worker.ThreadPoolExecutor") as executor,
            patch("sys.stdin", io.StringIO(commands)),
        ):
            main()
        # Translation is serialized through a single-worker executor; every other
        # background command still runs on its own daemon thread.
        self.assertEqual(
            [call.args[1]["type"] for call in executor.return_value.submit.call_args_list],
            ["translation.generate"],
        )
        self.assertEqual(
            [call.kwargs["args"][0]["type"] for call in thread.call_args_list],
            [
                "summary.generate",
                "speaker-profile.enroll",
                "speaker-profile.verify",
                "speaker-profile.samples",
                "speaker-profile.sample-delete",
                "speaker.rename",
                "segment.speaker",
                "meeting.export",
                "meeting.bundle",
            ],
        )

    def test_translation_recovers_a_final_segment_not_yet_visible_to_the_request(self):
        meeting = self.worker.start(
            {
                "title": "翻译补写",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.llama_generate = lambda *_args, **_kwargs: "Hello"
        translated = self.worker.translate(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "target_language": "en",
                "consent": True,
                "segment": {
                    "text": "你好",
                    "start_ms": 0,
                    "end_ms": 100,
                    "speaker": "spk-1",
                    "track": "mic",
                    "revision": 1,
                },
            }
        )
        self.assertEqual(translated["translation"], "Hello")
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["segments"][0]["translation"],
            "Hello",
        )

    def test_segments_with_the_same_live_id_are_scoped_to_their_meeting(self):
        first = self.worker.store.create_meeting(
            {
                "title": "第一场",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        second = self.worker.store.create_meeting(
            {
                "title": "第二场",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        for meeting, text in ((first, "第一句"), (second, "第二句")):
            self.worker.store.save_segment(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": "mic-0",
                    "text": text,
                    "start_ms": 0,
                    "end_ms": 100,
                    "speaker": "spk-1",
                }
            )
        self.assertEqual(
            self.worker.store.get_meeting(first["id"])["segments"][0]["text"], "第一句"
        )
        self.assertEqual(
            self.worker.store.get_meeting(second["id"])["segments"][0]["text"], "第二句"
        )

    def test_diarization_turns_and_overlap_assignment(self):
        meeting = self.worker.start(
            {
                "title": "声纹聚类",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        turns = [
            {"start_ms": 0, "end_ms": 900, "speaker": "spk-1"},
            {"start_ms": 900, "end_ms": 2000, "speaker": "spk-2"},
        ]
        self.worker.store.replace_speaker_turns(meeting["id"], turns)
        saved = self.worker.store.get_meeting(meeting["id"])["speaker_turns"]
        self.assertEqual(saved, [{**turn, "version": "postprocess"} for turn in turns])
        self.assertEqual(self.worker._speaker_for(800, 1500, turns), "spk-2")

    def test_speaker_tracker_reuses_similar_voiceprints(self):
        tracker = SpeakerTracker.__new__(SpeakerTracker)
        tracker.threshold = 0.2
        tracker.max_speakers = 2
        tracker.centers = []
        tracker.counts = []
        tracker.last_speaker = None
        self.assertEqual(tracker.assign_embedding([1.0, 0.0]), "spk-1")
        self.assertEqual(tracker.assign_embedding([0.9, 0.1]), "spk-1")
        self.assertEqual(tracker.assign_embedding([0.0, 1.0]), "spk-2")
        self.assertIn(tracker.assign_embedding([-1.0, 0.0]), {"spk-1", "spk-2"})
        self.assertEqual(tracker.speaker_ids, ["spk-1", "spk-2"])

    def test_speaker_tracker_uses_first_temporary_speaker(self):
        tracker = SpeakerTracker.__new__(SpeakerTracker)
        tracker.last_speaker = None
        tracker.embedding = lambda *_: None
        self.assertEqual(tracker.assign([], 16000), "spk-1")

    def test_speaker_tracker_accepts_array_embeddings(self):
        class ArrayEmbedding:
            def __bool__(self):
                raise ValueError("array truth value is ambiguous")

        tracker = SpeakerTracker.__new__(SpeakerTracker)
        tracker.embedding = lambda *_: ArrayEmbedding()
        tracker.assign_embedding = lambda _: "spk-1"
        self.assertEqual(tracker.assign([], 16000), "spk-1")

    def test_english_punctuation_normalizes_model_text(self):
        formatter = EnglishPunctuation.__new__(EnglishPunctuation)

        class Engine:
            def add_punctuation_with_case(self, text):
                self.text = text
                return "How are you?"

        formatter.engine = Engine()
        self.assertEqual(formatter.apply("HOW ARE YOU"), "How are you?")
        self.assertEqual(formatter.engine.text, "how are you")

    def test_stop_with_auto_language_and_no_audio_is_safe(self):
        meeting = self.worker.start(
            {
                "title": "空录音",
                "language": "auto",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )

        class EmptyASR:
            def accept(self, _track, _samples, _sample_rate, _flush=False):
                return "", True

        self.worker.asr = EmptyASR()

        class Samples(list):
            def __truediv__(self, _value):
                return self

        numpy = type(
            "Numpy",
            (),
            {
                "float32": float,
                "asarray": staticmethod(lambda values, dtype: Samples(values)),
                "concatenate": staticmethod(
                    lambda _values: self.fail("empty recording must not concatenate")
                ),
            },
        )
        with patch.dict("sys.modules", {"numpy": numpy}):
            self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})

    def test_stop_releases_session_before_database_update_and_on_failure(self):
        meeting = self.worker.start(
            {
                "title": "清理顺序",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        order = []
        postprocessing = Mock()
        postprocessing.shutdown.side_effect = lambda **_: order.append("cleanup")
        self.worker.live_postprocessing = postprocessing
        self.worker.asr = None

        def fail_update(*_):
            order.append("database")
            raise RuntimeError("database failed")

        with patch.object(self.worker.store, "finish_meeting", side_effect=fail_update):
            with self.assertRaisesRegex(RuntimeError, "database failed"):
                self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        self.assertEqual(order, ["cleanup", "database"])
        self.assertIsNone(self.worker.active)
        self.assertIsNone(self.worker.live_postprocessing)
        postprocessing.shutdown.assert_called_once_with(wait=True, cancel_futures=True)

    def test_chinese_punctuation_preserves_model_sentence_boundaries(self):
        formatter = ChinesePunctuation.__new__(ChinesePunctuation)

        class Engine:
            def add_punctuation(self, text):
                self.text = text
                return "我们都是木头人，不会说话不会动。"

        formatter.engine = Engine()
        self.assertEqual(
            formatter.apply("我们都是木头人不会说话不会动"),
            "我们都是木头人，不会说话不会动。",
        )
        self.assertEqual(formatter.engine.text, "我们都是木头人不会说话不会动")

    def test_auto_language_detection(self):
        self.assertEqual(Worker._detect_language("how are you doing today"), "en")
        self.assertEqual(Worker._detect_language("我们今天讨论产品计划"), "zh")

    def test_voiceprint_sample_audio_is_removed_with_profile(self):
        profile = self.worker.store.save_speaker_profile_sample(
            "测试人员", [1.0, 0.0], "sample-1"
        )
        profile_dir = self.worker.store.speaker_profiles_dir / profile["id"]
        profile_dir.mkdir()
        reference = profile_dir / "reference.wav"
        reference.write_bytes(b"local")
        self.worker.store.save_speaker_profile_sample(
            "测试人员",
            [1.0, 0.0],
            "sample-1",
            profile["id"],
            str(reference),
            1000,
        )
        self.assertEqual(
            self.worker.store.list_speaker_profile_samples(profile["id"])[0]["audio_path"],
            str(reference),
        )
        self.worker.store.delete_speaker_profile(profile["id"])
        self.assertFalse(
            (self.worker.store.speaker_profiles_dir / profile["id"]).exists()
        )

    def test_named_speaker_creates_profile_before_audio_is_long_enough(self):
        profile = self.worker.store.ensure_speaker_profile("小林")
        self.assertEqual(
            (profile["name"], profile["sample_count"], profile["embedding"]),
            ("小林", 0, "[]"),
        )
        completed = self.worker.store.save_speaker_profile_sample(
            "小林", [1.0, 0.0], "meeting-short-then-long", profile["id"]
        )
        self.assertEqual(completed["sample_count"], 1)

    def test_refining_status_preserves_meeting(self):
        meeting = self.worker.start(
            {
                "title": "精修状态",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        self.assertEqual(
            self.worker.store.set_status(meeting["id"], "refining")["status"],
            "refining",
        )

    def test_startup_recovers_interrupted_meetings(self):
        recording = self.worker.store.create_meeting(
            {
                "title": "录制中",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.append_audio(
            recording["id"], "mic", base64.b64encode(b"\0\0" * 16000).decode()
        )
        refining = self.worker.store.create_meeting(
            {
                "title": "精修中",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.finish_meeting(refining["id"], 0)
        self.worker.store.set_status(refining["id"], "refining")
        recovered = Worker(root=self.temp.name, output=self.events.append)
        self.assertEqual(recovered.store.get_meeting(recording["id"])["status"], "ready")
        self.assertTrue(recovered.store.read_manifest(recording["id"])["closed"])
        self.assertEqual(recovered.store.get_meeting(refining["id"])["status"], "ready")

    def test_restarted_worker_does_not_reset_active_refinement(self):
        meeting = self.worker.store.create_meeting(
            {
                "title": "仍在精修",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.finish_meeting(meeting["id"], 0)
        self.worker.store.set_status(meeting["id"], "refining")
        with patch.dict("os.environ", {"BREVIA_RECOVER_INTERRUPTED": "0"}):
            restarted = Worker(root=self.temp.name, output=self.events.append)
        self.assertEqual(restarted.store.get_meeting(meeting["id"])["status"], "refining")

    def test_delete_cancels_a_running_background_task(self):
        meeting = self.worker.start(
            {
                "title": "串行任务",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        control = self.worker.tasks.begin("meeting.refine", meeting["id"])
        try:
            # 现在删除会先请求取消后台任务再删除，不再抛错阻塞。
            self.worker.delete_meeting({"meeting_id": meeting["id"]})
        finally:
            self.worker.tasks.finish("meeting.refine", meeting["id"], control)
        self.assertTrue(control.cancelled.is_set())
        self.assertIsNotNone(self.worker.store.get_meeting(meeting["id"])["deleted_at"])

    def test_examples_are_seeded_once_and_delete_audio_immediately(self):
        self.assertTrue(self.worker.store.seed_examples())
        self.assertFalse(self.worker.store.seed_examples())
        examples = [
            meeting
            for meeting in self.worker.store.list_meetings()
            if meeting["is_example"]
        ]
        self.assertEqual(
            {meeting["example_locale"] for meeting in examples}, {"zh", "en", "es", "ja", "ko", "fr", "de", "ru"}
        )
        meeting = self.worker.store.get_meeting(examples[0]["id"])
        audio = Path(meeting["audio"]["playback"]["mic"])
        self.assertTrue(audio.exists())
        self.assertTrue(all(segment["translation"] for segment in meeting["segments"]))
        self.assertTrue(all(
            self.worker.store.get_meeting(item["id"])["summary"]["data"]["markdown"]
            for item in examples
        ))
        spanish = next(item for item in examples if item["example_locale"] == "es")
        self.assertEqual(spanish["language"], "en")
        self.assertEqual(spanish["target_language"], "es")
        self.worker.store.soft_delete(meeting["id"])
        self.assertFalse(audio.exists())
        self.assertNotIn(
            meeting["id"], {item["id"] for item in self.worker.store.list_meetings()}
        )
        with self.worker.store.connect() as db:
            db.execute("DELETE FROM app_meta WHERE key LIKE 'examples_seeded_%'")
        self.assertTrue(self.worker.store.seed_examples())
        self.assertNotIn(
            meeting["id"], {item["id"] for item in self.worker.store.list_meetings()}
        )

    def test_deleted_meetings_can_be_restored_or_purged_with_files(self):
        meeting = self.worker.start(
            {
                "title": "回收站测试",
                "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        meeting_dir = self.worker.store.meetings_dir / meeting["id"]
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        self.worker.delete_meeting({"meeting_id": meeting["id"]})
        self.assertEqual(
            self.worker.store.list_meetings(include_deleted=True)[0]["id"],
            meeting["id"],
        )
        self.worker.restore_meeting({"meeting_id": meeting["id"]})
        self.assertTrue(meeting_dir.exists())
        self.worker.delete_meeting({"meeting_id": meeting["id"]})
        with self.worker.store.connect() as db:
            db.execute(
                "UPDATE meetings SET deleted_at=? WHERE id=?",
                (
                    (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(),
                    meeting["id"],
                ),
            )
        self.assertEqual(self.worker.store.purge_expired(), [meeting["id"]])
        self.assertFalse(meeting_dir.exists())
        with self.assertRaises(ValueError):
            self.worker.store.get_meeting(meeting["id"])


if __name__ == "__main__":
    unittest.main()
