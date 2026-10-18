"""验证采集失败时也会保存错误并回收受测进程。"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

from .bench_diarization import benchmark_entry


class DiarizationBenchmarkTest(unittest.TestCase):
    def run_entry(self, script, timeout=5, startup_timeout=5, session_chunks=0):
        with tempfile.TemporaryDirectory() as root:
            result = benchmark_entry(
                [sys.executable, "-u", "-c", script],
                {},
                dict(os.environ),
                Path(root),
                timeout,
                startup_timeout,
                session_chunks,
            )
        self.assertFalse(result["resources"]["last"]["processes"], result)
        return result

    def test_valid_result_is_measured_and_process_is_reaped(self):
        result = self.run_entry(
            "import sys,time; sys.stdin.readline(); "
            "print('[null,\"import_modules\"]',flush=True); time.sleep(0.1); "
            "print('[true,[{\"speaker\":\"spk-1\",\"_embedding\":[1]}]]',flush=True)"
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["embeddings"], 1)

    def test_stalled_entry_is_killed_and_reported(self):
        result = self.run_entry("import time; time.sleep(30)", 1, 0.1)
        self.assertFalse(result["ok"])
        self.assertIn("TimeoutError", result["error"])

    def test_wrong_worker_entry_is_not_counted_as_success(self):
        result = self.run_entry(
            "import sys,time; sys.stdin.readline(); time.sleep(0.1); "
            "print('{\"ok\":false,\"error\":\"unknown command\"}',flush=True)"
        )
        self.assertFalse(result["ok"])
        self.assertIn("Invalid analysis response", result["error"])

    def test_session_requires_stable_results_and_exits_after_shutdown(self):
        script = (
            "import sys,json\n"
            "for line in sys.stdin:\n"
            " r=json.loads(line)\n"
            " result=None if r['type']!='process_chunk' else [{'speaker':'spk-1'}]\n"
            " print(json.dumps({'id':r['id'],'ok':True,'result':result}),flush=True)\n"
            " if r['type']=='shutdown':break\n"
        )
        result = self.run_entry(script, session_chunks=3)
        self.assertTrue(result["ok"], result)
        self.assertEqual(len(result["chunks"]), 3)
        self.assertEqual(len({chunk["result_sha256"] for chunk in result["chunks"]}), 1)


if __name__ == "__main__":
    unittest.main()
