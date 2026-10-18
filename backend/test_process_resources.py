"""校验真实进程资源采样，以及 Windows 提交量与工作集的区别。"""

import io
import json
import subprocess
import sys
import time
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from .process_resources import ProcessTreeMonitor, process_snapshot, stop_process_tree


class ProcessResourcesTest(unittest.TestCase):
    def test_windows_private_commit_is_not_virtual_memory_or_rss(self):
        process = Mock(pid=42)
        process.oneshot.return_value = nullcontext()
        process.memory_info.return_value = SimpleNamespace(rss=100, private=200, vms=900)
        process.memory_full_info.return_value = SimpleNamespace(uss=80)
        process.cpu_times.return_value = SimpleNamespace(user=2, system=3)
        process.create_time.return_value = 123.0
        process.num_threads.return_value = 4
        process.num_handles.return_value = 5
        result = process_snapshot(process)
        self.assertEqual(result["private_bytes"], 200)
        self.assertEqual(result["rss_bytes"], 100)
        self.assertEqual(result["uss_bytes"], 80)
        self.assertEqual(result["cpu_seconds"], 5)

    def test_guard_reads_private_commit_without_scanning_working_set_pages(self):
        process = Mock(pid=42)
        process.oneshot.return_value = nullcontext()
        process.memory_info.return_value = SimpleNamespace(rss=100, private=200)
        process.cpu_times.return_value = SimpleNamespace(user=2, system=3)
        result = process_snapshot(process, include_uss=False)
        process.memory_full_info.assert_not_called()
        self.assertEqual(result["private_bytes"], 200)
        self.assertIsNone(result["uss_bytes"])

    def test_sampler_records_and_stops_without_retaining_dead_children(self):
        output = io.StringIO()
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            with ProcessTreeMonitor(child.pid, output, interval=0.05) as monitor:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if monitor.current["totals"]["rss_bytes"]:
                        break
                    time.sleep(0.02)
                self.assertGreater(monitor.current["totals"]["rss_bytes"], 0)
                child.terminate()
                child.wait(timeout=5)
            self.assertFalse(monitor.thread.is_alive())
            self.assertFalse(monitor.summary()["last"]["processes"])
            self.assertFalse(monitor.processes)
            rows = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertGreaterEqual(len(rows), 2)
            self.assertTrue(any(row["processes"] for row in rows))
            self.assertFalse(rows[-1]["processes"])
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)

    def test_invalid_sampling_interval_is_rejected(self):
        for interval in (0, -1, 61):
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                ProcessTreeMonitor(1, interval=interval)

    def test_stopping_a_launcher_reaps_its_interpreter_child(self):
        child = subprocess.Popen(
            [
                sys.executable,
                "-u",
                "-c",
                "import subprocess,sys,time; "
                "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
                "print(p.pid,flush=True); time.sleep(30)",
            ],
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            import psutil

            descendant = psutil.Process(int(child.stdout.readline()))
            stop_process_tree(child, [descendant])
            self.assertIsNotNone(child.returncode)
            self.assertFalse(descendant.is_running())
        finally:
            stop_process_tree(child)
            child.stdout.close()

    def test_cleanup_snapshots_the_live_sampler_collection(self):
        observed = {}

        class Child:
            kill = Mock()

            @property
            def pid(self):
                observed.clear()
                return 42

        child = Child()
        observed[42] = child
        process = Mock()
        process.poll.return_value = 0
        with patch("backend.process_resources.psutil.wait_procs", return_value=([], [])):
            stop_process_tree(process, observed.values())
        child.kill.assert_called_once()

    def test_descendant_failure_does_not_skip_root_or_other_cleanup(self):
        import psutil

        denied, other = Mock(pid=10), Mock(pid=11)
        denied.kill.side_effect = psutil.AccessDenied(10)
        process = Mock(pid=12)
        process.poll.return_value = 0
        with patch("backend.process_resources.psutil.wait_procs", return_value=([], [])) as wait:
            with self.assertRaises(psutil.AccessDenied):
                stop_process_tree(process, [other, denied])
        other.kill.assert_called_once()
        process.kill.assert_called_once()
        process.wait.assert_called_once_with(timeout=5)
        wait.assert_called_once()

    def test_dead_launcher_still_terminates_its_job(self):
        process = Mock(pid=12)
        process.poll.return_value = 0
        with patch("backend.process_resources.psutil.wait_procs", return_value=([], [])):
            stop_process_tree(process)
        process.kill.assert_called_once()
        process.wait.assert_called_once_with(timeout=5)


if __name__ == "__main__":
    unittest.main()
