import json
import os
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

from .audio_io import _convert_process
from .llama_sidecar import LlamaSidecar
from .worker import Worker
from .worker_agent import parse_subtitles, render_result, write_result
from .worker_common import ModelNotInstalled, TaskCancelled, UserFacingError
from .worker_llama_sidecar import _Sidecar


class AgentTest(unittest.TestCase):
    def test_diarization_exports_keep_speaker_labels(self):
        result = {
            "operation": "diarize",
            "segments": [
                {"start_ms": 0, "end_ms": 1000, "text": "Hello", "speaker": "Alice"},
                {"start_ms": 1000, "end_ms": 2000, "text": "Hi", "speaker": ""},
            ],
        }
        for format in ("txt", "md", "srt", "vtt"):
            output = render_result(result, format)
            self.assertIn("[Alice] Hello", output)
            self.assertIn("[Unknown speaker] Hi", output)
            self.assertNotIn(
                "[Alice]", render_result({**result, "operation": "transcribe"}, format)
            )
        self.assertEqual(json.loads(render_result(result, "json")), result)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.worker = Worker(self.root, output=lambda _: None)
        self.addCleanup(self.worker.shutdown_sidecars)
        self.addCleanup(self.worker.store.close_audio_sessions)

    def run_task(self, **values):
        payload = {
            "meeting_id": str(uuid4()),
            "operation": "translate",
            "text": "hello",
            "target_language": "zh",
            "output_path": str(self.root / "result.txt"),
            **values,
        }
        return self.worker.agent_run(
            {key: value for key, value in payload.items() if value is not None}
        )

    def test_subtitle_pipeline_preserves_source_and_timestamps(self):
        source = self.root / "input.srt"
        original = "1\n00:00:01,250 --> 00:00:03,000\nHello\n"
        source.write_text(original, encoding="utf-8")
        self.worker.translate_text = Mock(return_value="你好")
        result = self.run_task(
            text=None, input_path=str(source), output_path=str(self.root / "out.vtt")
        )
        self.assertEqual(result["output_path"], str((self.root / "out.vtt").resolve()))
        self.assertIn(
            "00:00:01.250 --> 00:00:03.000\n你好", Path(result["output_path"]).read_text()
        )
        self.assertEqual(source.read_text(), original)
        with self.assertRaises(UserFacingError) as caught:
            self.run_task(output_path=result["output_path"])
        self.assertEqual(caught.exception.code, "output_exists")

    def test_translation_is_local_bounded_and_complete(self):
        calls = []

        def generate(*args, **kwargs):
            calls.append((args, kwargs))
            self.assertEqual(kwargs["max_tokens"], 2048)
            self.assertTrue(kwargs["require_complete"])
            self.assertIsInstance(kwargs["cancellation"], threading.Event)
            return "translation"

        self.worker.llama_generate = generate
        result = self.run_task(text="中😀" * 300, output_path=str(self.root / "out.json"))
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(len(c[0][2].split("\n\n", 1)[1]) <= 256 for c in calls))
        self.assertEqual(
            json.loads(Path(result["output_path"]).read_text())["segments"][0]["text"], "中😀" * 300
        )

    def test_media_reuses_import_refinement_and_meeting_read(self):
        source = self.root / "input.mp4"
        source.write_bytes(b"fixture")
        self.worker.models.is_ready = lambda _: True
        self.worker.import_audio = Mock()
        self.worker.refine = Mock()
        self.worker.store.get_meeting = Mock(
            return_value={
                "segments": [
                    {
                        "id": "one",
                        "version": "postprocess",
                        "revision": 1,
                        "start_ms": 10,
                        "end_ms": 1000,
                        "text": "hello",
                        "speaker_name": "A",
                    }
                ]
            }
        )
        result = self.run_task(
            operation="diarize",
            text=None,
            target_language=None,
            input_path=str(source),
            model_id="funasr-nano-int8",
            output_path=str(self.root / "out.json"),
        )
        self.assertEqual(
            self.worker.import_audio.call_args.args[0]["meeting_id"],
            self.worker.refine.call_args.args[0]["meeting_id"],
        )
        self.assertTrue(self.worker.refine.call_args.args[0]["force_diarization"])
        self.assertEqual(
            json.loads(Path(result["output_path"]).read_text())["segments"][0]["speaker"], "A"
        )

    def test_missing_models_and_decode_failures_are_explicit(self):
        source = self.root / "bad.mp4"
        source.write_bytes(b"bad media")
        with self.assertRaises(ModelNotInstalled):
            self.run_task(
                operation="transcribe",
                text=None,
                target_language=None,
                input_path=str(source),
                model_id="funasr-nano-int8",
            )
        self.worker.models.is_ready = lambda _: True
        self.worker.import_audio = Mock(side_effect=OSError("Bad codec"))
        with self.assertRaises(UserFacingError) as caught:
            self.run_task(
                operation="transcribe",
                text=None,
                target_language=None,
                input_path=str(source),
                model_id="funasr-nano-int8",
            )
        self.assertEqual(caught.exception.code, "decode_failed")
        self.assertFalse((self.root / "result.txt").exists())

    def test_cancel_before_registration_and_during_translation(self):
        mid = str(uuid4())
        self.worker.agent_cancel({"meeting_id": mid})
        self.worker.translate_text = Mock(return_value="should not run")
        self.assertEqual(self.run_task(meeting_id=mid), {"cancelled": True})
        self.worker.translate_text.assert_not_called()
        entered = threading.Event()

        def translate(_text, _target, control, complete):
            entered.set()
            self.assertTrue(control.cancelled.wait(5))
            raise TaskCancelled()

        self.worker.translate_text = translate
        mid = str(uuid4())
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.run_task, meeting_id=mid)
            self.assertTrue(entered.wait(5))
            self.worker.agent_cancel({"meeting_id": mid})
            self.assertEqual(pending.result(timeout=5), {"cancelled": True})
        self.assertFalse((self.root / "result.txt").exists())
        self.assertFalse(self.worker.tasks.has_any())

    def test_export_refuses_overwrite_and_unusable_timestamps(self):
        destination = self.root / "original.txt"
        destination.write_text("original")
        with self.assertRaises(FileExistsError):
            write_result(destination, "replacement", lambda: None)
        self.assertEqual(destination.read_text(), "original")
        with self.assertRaises(UserFacingError):
            render_result({"segments": [{"text": "hello"}]}, "srt")
        with self.assertRaises(UserFacingError):
            parse_subtitles("1\n00:00:99,000 --> 00:03:00,000\nhello")
        if os.name != "nt":
            link = self.root / "link"
            link.symlink_to(destination)
            with self.assertRaises(FileExistsError):
                write_result(link, "replacement", lambda: None)

    def test_late_nested_stage_inherits_parent_cancellation(self):
        mid = str(uuid4())
        with self.worker.tasks.running("agent.run", mid) as parent:
            self.worker.agent_cancel({"meeting_id": mid})
            with self.worker.tasks.running("meeting.import", mid) as child:
                self.assertIs(child.cancelled, parent.cancelled)
                self.assertTrue(child.cancelled.is_set())

    def test_converter_cancellation_terminates_child(self):
        cancelled = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(
                _convert_process, [sys.executable, "-c", "import time;time.sleep(30)"], cancelled
            )
            cancelled.set()
            with self.assertRaises(TaskCancelled):
                pending.result(timeout=3)

    def test_llama_complete_mode_rejects_length_and_accepts_stop(self):
        sidecar = LlamaSidecar()
        sidecar.model = Mock(
            return_value={"choices": [{"text": "fragment", "finish_reason": "length"}]}
        )
        with self.assertRaisesRegex(RuntimeError, "output token limit"):
            sidecar.generate("hello", require_complete=True)
        self.assertEqual(sidecar.generate("hello"), "fragment")
        sidecar.model.return_value = {"choices": [{"text": "complete", "finish_reason": "stop"}]}
        self.assertEqual(sidecar.generate("hello", require_complete=True), "complete")

    def test_cancelled_translation_does_not_wait_for_unrelated_sidecar_request(self):
        sidecar = _Sidecar(["unused"], lambda _: None)
        cancelled = threading.Event()
        sidecar.lock.acquire()
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(sidecar.request, {}, cancellation=cancelled)
                cancelled.set()
                self.assertEqual(pending.result(timeout=1)["message"], "Sidecar request cancelled")
        finally:
            sidecar.lock.release()


if __name__ == "__main__":
    unittest.main()
