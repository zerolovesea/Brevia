"""校验分析引擎的依赖边界、临时状态和聚类内存上限。"""

import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import weakref
from pathlib import Path
from unittest.mock import Mock, patch

import numpy
import psutil

from .config import SETTINGS
from .analysis_session import AnalysisBudget, AnalysisResourceError, AnalysisSession
from .diarization_engine import DiarizationEngine
from .diarization_process import DiarizationProcess, DiarizationStartupError, serve_session
from .worker_common import TaskCancelled, TaskControl
from .worker_refinement import RefinementWorkerMixin


class DiarizationEngineTest(unittest.TestCase):
    def test_import_does_not_load_worker_or_generation_modules(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys,json,backend.diarization_engine; print(json.dumps(list(sys.modules)))",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        modules = json.loads(result.stdout)
        for name in (
            "backend.worker",
            "backend.worker_refinement",
            "backend.worker_llm",
            "llama_cpp",
        ):
            self.assertNotIn(name, modules)

    def test_repeated_calls_keep_models_and_release_chunk_audio(self):
        payload = {
            "models_root": "models",
            "path": "audio.wav",
            "threshold": 0.35,
            "segmentation_id": "segmentation",
            "window_start_ms": 0,
            "window_end_ms": 2000,
            "core_start_ms": 0,
            "core_end_ms": 2000,
            "speech": [{"start_ms": 500, "end_ms": 1500}],
        }
        arrays = []

        def read(*_):
            samples = numpy.ones(32000, dtype=numpy.float32)
            arrays.append(weakref.ref(samples))
            return samples, 16000

        with (
            patch("backend.diarization_engine.ModelManager") as manager,
            patch("backend.diarization_engine.OfflineDiarizer") as diarizer,
            patch("backend.diarization_engine.SpeakerTracker") as tracker,
            patch("backend.diarization_engine.read_mono_wav_window", side_effect=read),
        ):
            manager.return_value.device.return_value = {"threads": 2}
            diarizer.return_value.process.return_value = []
            tracker.return_value.embedding.return_value = numpy.array([1, 0])
            engine = DiarizationEngine(payload, Mock())
            first = engine.process(payload, Mock())
            second = engine.process(payload, Mock())
            self.assertEqual(first, second)
            self.assertIsNot(first, second)
            manager.assert_called_once()
            diarizer.assert_called_once()
            tracker.assert_called_once()
            # mock 的参数记录会持有波形，清除后才能检查引擎本身是否保留它。
            diarizer.reset_mock()
            tracker.reset_mock()
            self.assertTrue(all(reference() is None for reference in arrays))
            with self.assertRaisesRegex(ValueError, "configuration changed"):
                engine.process({**payload, "threshold": 0.4}, Mock())


class ClusteringMemoryTest(unittest.TestCase):
    def test_fixed_speaker_count_never_allocates_pairwise_distances(self):
        with patch("numpy.clip", wraps=numpy.clip) as clip:
            labels = RefinementWorkerMixin._auto_cluster_embeddings(
                [[1, 0]] * 4 + [[0, 1]] * 4,
                [2000] * 8,
                2,
            )
        clip.assert_not_called()
        self.assertEqual(labels, [0] * 4 + [1] * 4)

    def test_automatic_scoring_keeps_only_bounded_distance_rows(self):
        count = 3000
        vectors = [[1, 0]] * (count // 2) + [[0, 1]] * (count // 2)
        with (
            patch.dict(SETTINGS["refinement"], {"max_auto_speakers": 2}),
            patch("numpy.clip", wraps=numpy.clip) as clip,
        ):
            labels = RefinementWorkerMixin._auto_cluster_embeddings(vectors, [2000] * count)
        self.assertEqual(labels, [0] * (count // 2) + [1] * (count // 2))
        self.assertGreater(clip.call_count, 1)
        for call in clip.call_args_list:
            block = call.args[0]
            self.assertEqual(block.shape[1], count)
            self.assertLess(block.shape[0], count)
            self.assertLessEqual(block.nbytes, 8 * 1024 * 1024)


class AnalysisPipeTest(unittest.TestCase):
    def test_invalid_payload_is_rejected_before_starting_a_process(self):
        with patch("backend.diarization_process.subprocess.Popen") as start:
            with self.assertRaises(ValueError):
                DiarizationProcess({"threshold": float("nan")})
        start.assert_not_called()

    def test_flooded_reader_has_bounded_queue_and_can_be_closed(self):
        child = DiarizationProcess(
            {},
            command=[
                sys.executable,
                "-u",
                "-c",
                "while True: print('[null,\"stage\"]',flush=True)",
            ],
            stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.monotonic() + 5
            while child.messages.qsize() < 16 and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(child.messages.qsize(), 16)
        finally:
            child.close()
        self.assertFalse(child.reader.is_alive())
        self.assertFalse(child.writer.is_alive())

    def test_close_interrupts_a_writer_when_the_child_never_reads(self):
        child = DiarizationProcess(
            {"payload": "x" * 1024 * 1024},
            command=[sys.executable, "-c", "import time; time.sleep(30)"],
        )
        child.close()
        self.assertFalse(child.writer.is_alive())
        self.assertFalse(child.reader.is_alive())

    def test_oversized_native_output_is_rejected(self):
        with patch("backend.diarization_process.MAXIMUM_RESPONSE_CHARACTERS", 64):
            child = DiarizationProcess(
                {},
                command=[sys.executable, "-c", "print('x'*1000)"],
            )
            try:
                self.assertTrue(child.poll(5))
                ok, message = child.recv()
                self.assertFalse(ok)
                self.assertIn("exceeds the message limit", message)
            finally:
                child.close()


class AnalysisSessionProtocolTest(unittest.TestCase):
    def test_session_initializes_once_and_returns_only_matching_requests(self):
        requests = [
            {"id": 2, "type": "process_chunk", "payload": {"chunk": 1}},
            {"id": 3, "type": "process_chunk", "payload": {"chunk": 2}},
            {"id": 4, "type": "shutdown", "payload": {}},
        ]
        connection = Mock()
        with patch("backend.diarization_engine.DiarizationEngine") as engine:
            engine.return_value.process.side_effect = [[1], [2]]
            serve_session(
                connection,
                {"id": 1, "type": "init", "payload": {"model": "fixed"}},
                io.StringIO("\n".join(map(json.dumps, requests))),
            )
        engine.assert_called_once()
        self.assertEqual(engine.return_value.process.call_count, 2)
        self.assertEqual(
            [call.args[0] for call in connection.send.call_args_list],
            [
                {"id": 1, "ok": True, "result": None},
                {"id": 2, "ok": True, "result": [1]},
                {"id": 3, "ok": True, "result": [2]},
                {"id": 4, "ok": True, "result": None},
            ],
        )

    def test_server_rejects_repeated_and_boolean_request_ids(self):
        for identity in (1, True, 3):
            with self.subTest(identity=identity):
                connection = Mock()
                with patch("backend.diarization_engine.DiarizationEngine") as engine:
                    serve_session(
                        connection,
                        {"id": 1, "type": "init", "payload": {}},
                        io.StringIO(json.dumps({"id": identity, "type": "process_chunk"})),
                    )
                engine.return_value.process.assert_not_called()
                self.assertFalse(connection.send.call_args.args[0]["ok"])

    def test_transport_allows_only_one_inflight_and_graceful_shutdown(self):
        script = (
            "import sys,json\n"
            "for line in sys.stdin:\n"
            " request=json.loads(line)\n"
            " print(json.dumps({'id':request['id'],'ok':True,'result':None}),flush=True)\n"
            " if request['type']=='shutdown': break\n"
        )
        child = DiarizationProcess({}, command=[sys.executable, "-u", "-c", script], session=True)
        try:
            with self.assertRaisesRegex(RuntimeError, "active request"):
                child.submit("process_chunk", {})
            for _ in range(3):
                self.assertTrue(child.poll(5))
                self.assertEqual(child.recv(), (True, None))
                child.submit("process_chunk", {})
            self.assertTrue(child.poll(5))
            child.recv()
        finally:
            child.close(graceful=True)
        self.assertEqual(child.process.returncode, 0)
        self.assertFalse(child.reader.is_alive())
        self.assertFalse(child.writer.is_alive())

    def test_transport_rejects_stale_boolean_and_ambiguous_responses(self):
        for response in (
            {"id": 0, "ok": True},
            {"id": True, "ok": True},
            {"id": 1, "stage": "diarization", "ok": True},
            {"id": 1, "stage": "x" * 129},
        ):
            with self.subTest(response=response):
                child = DiarizationProcess(
                    {},
                    command=[sys.executable, "-c", f"print({json.dumps(response)!r})"],
                    session=True,
                )
                try:
                    with self.assertRaises(RuntimeError):
                        child.poll(5)
                finally:
                    child.close()

    @unittest.skipUnless(sys.platform == "win32", "Windows Job Object")
    def test_parent_abrupt_exit_reaps_analysis_and_grandchild(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "pids.json"
            script = (
                "import os,sys,time,subprocess,json\n"
                "from pathlib import Path\n"
                "from backend.diarization_process import DiarizationProcess\n"
                "child_code=\"import subprocess,sys,os,json,time; from pathlib import Path; "
                "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']); "
                "Path(sys.argv[1]).write_text(json.dumps([os.getpid(),p.pid]));time.sleep(60)\"\n"
                "child=DiarizationProcess({},command=[sys.executable,'-c',child_code,sys.argv[1]],session=True)\n"
                "deadline=time.monotonic()+10\n"
                "while not Path(sys.argv[1]).exists() and time.monotonic()<deadline: time.sleep(.01)\n"
                "os._exit(0 if Path(sys.argv[1]).exists() else 1)\n"
            )
            completed = subprocess.run(
                [sys.executable, "-c", script, str(output)],
                timeout=15,
                capture_output=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            identities = json.loads(output.read_text())
            remaining = [psutil.Process(pid) for pid in identities if psutil.pid_exists(pid)]
            _, alive = psutil.wait_procs(remaining, timeout=5)
            self.assertEqual(alive, [])


class AnalysisSessionLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.control = TaskControl()
        self.budget = AnalysisBudget(1000, 2000, 3000, 100, 4000, 2)
        self.start = self.enterContext(patch("backend.analysis_session.DiarizationProcess"))
        self.monitor_factory = self.enterContext(
            patch("backend.analysis_session.ProcessTreeMonitor")
        )
        self.memory = self.enterContext(patch("backend.analysis_session.psutil.virtual_memory"))
        self.memory.return_value.total = 5000
        self.memory.return_value.available = 1000
        self.monitor = self.monitor_factory.return_value
        self.monitor.failure = None
        self.monitor.current = {
            "totals": {"private_bytes": 500},
            "system": {"available_bytes": 1000},
            "errors": [],
            "processes": [{"pid": -1, "private_bytes": 200}],
        }
        self.child = self.start.return_value
        self.child.poll.return_value = True
        self.session = AnalysisSession(self.budget, self.control, Mock(), Mock())
        self.addCleanup(self.session.close)
        self.payload = {"core_start_ms": 0}

    def test_profile_is_opt_in_and_rejects_unbounded_or_inconsistent_values(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertIsNone(AnalysisBudget.from_environment())
        for changes in ({"max_chunks": 11}, {"max_chunks": True}, {"tree_hard_bytes": 2000}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                AnalysisBudget(**{**vars(self.budget), **changes})

    def test_refinement_closes_session_before_returning_analysis_results(self):
        worker = RefinementWorkerMixin()
        worker.models = Mock(root=Path("models"), bundled_root=None)
        worker.wait_task = Mock()
        worker._refinement_progress = Mock()
        speech = [{"start_ms": 0, "end_ms": 120000}]
        with (
            patch("multiprocessing.get_context"),
            patch("backend.worker_refinement.sys.platform", "win32"),
            patch.object(worker, "_diarization_cache_key", return_value=None),
            patch(
                "backend.analysis_session.AnalysisBudget.from_environment", return_value=self.budget
            ),
            patch("backend.analysis_session.AnalysisSession") as create,
        ):
            create.return_value.process_chunk.return_value = []
            self.assertEqual(
                worker._diarize_long_track(
                    "input.wav", 120000, speech, "segmentation", 0.35, self.control
                ),
                [],
            )
        self.assertEqual(create.return_value.process_chunk.call_count, 2)
        create.return_value.close.assert_called_once_with(graceful=True)

    def test_reuse_limit_recycles_before_next_chunk(self):
        self.child.recv.side_effect = [
            (True, None),
            (True, [1]),
            (True, [2]),
            (True, None),
            (True, [3]),
        ]
        for expected in ([1], [2], [3]):
            self.assertEqual(self.session.process_chunk(self.payload, 5), expected)
        self.assertEqual(self.start.call_count, 2)
        self.child.close.assert_called_once_with(graceful=True)
        self.assertFalse(hasattr(self.control, "analysis_restarts"))

    def test_soft_limit_recycles_after_accepting_result(self):
        self.monitor.current["processes"][0]["private_bytes"] = 1000
        self.child.recv.side_effect = [(True, None), (True, [1])]
        self.assertEqual(self.session.process_chunk(self.payload, 5), [1])
        self.child.close.assert_called_once_with(graceful=True)
        self.assertIsNone(self.session.child)

    def test_same_chunk_gets_only_one_retry(self):
        self.child.recv.side_effect = [(True, None), (False, "native fault")] * 2
        with self.assertRaisesRegex(RuntimeError, "native fault"):
            self.session.process_chunk(self.payload, 5)
        self.assertEqual(self.start.call_count, 2)
        self.assertEqual(self.control.analysis_restarts, 1)

    def test_recovery_budget_is_shared_by_the_whole_task(self):
        self.control.analysis_restarts = 2
        self.child.recv.side_effect = [(True, None), (False, "native fault")]
        with self.assertRaisesRegex(RuntimeError, "native fault"):
            self.session.process_chunk(self.payload, 5)
        self.start.assert_called_once()

    def test_startup_failure_is_never_retried(self):
        self.child.recv.return_value = (False, "missing runtime")
        with self.assertRaises(DiarizationStartupError):
            self.session.process_chunk(self.payload, 5)
        self.start.assert_called_once()

    def test_low_system_memory_and_missing_metrics_stop_without_reloading(self):
        for changes in ({"system": {"available_bytes": 99}}, {"totals": {"private_bytes": None}}):
            with self.subTest(changes=changes):
                self.monitor.current.update(changes)
                with self.assertRaises(AnalysisResourceError):
                    self.session.process_chunk(self.payload, 5)
                self.assertIsNone(self.session.child)
                self.assertFalse(hasattr(self.control, "analysis_restarts"))

    def test_cancel_during_native_call_closes_without_retry(self):
        def poll(_):
            self.control.cancelled.set()
            return False

        self.child.poll.side_effect = poll
        with self.assertRaises(TaskCancelled):
            self.session.process_chunk(self.payload, 5)
        self.start.assert_called_once()
        self.child.close.assert_called_once_with(graceful=False)

    def test_pause_during_native_call_does_not_stop_wall_clock(self):
        def poll(_):
            self.control.paused.set()
            return False

        self.child.recv.return_value = (True, None)
        self.child.poll.side_effect = [True, *([False] * 10000)]
        # init 成功后模拟推理阻塞；暂停不让当前请求的预算停表。
        self.session._start(self.payload, time.monotonic(), time.monotonic() + 5)
        self.child.poll.side_effect = poll
        self.control.analysis_restarts = 2
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            self.session.process_chunk(self.payload, 0.01)
        self.child.close.assert_called_once_with(graceful=False)

    def test_cleanup_failure_prohibits_another_session(self):
        self.child.recv.side_effect = [(True, None), (True, [1]), (True, [2])]
        self.session.process_chunk(self.payload, 5)
        self.child.close.side_effect = OSError("cannot reap")
        try:
            with self.assertRaises(DiarizationStartupError):
                self.session.process_chunk(self.payload, 5)
            self.start.assert_called_once()
        finally:
            self.child.close.side_effect = None


if __name__ == "__main__":
    unittest.main()
