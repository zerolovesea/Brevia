"""校验分析引擎的依赖边界、临时状态和聚类内存上限。"""

import json
import subprocess
import sys
import time
import unittest
import weakref
from unittest.mock import Mock, patch

import numpy

from .config import SETTINGS
from .diarization_engine import DiarizationEngine
from .diarization_process import DiarizationProcess
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


if __name__ == "__main__":
    unittest.main()
