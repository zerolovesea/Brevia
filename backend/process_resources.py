"""采样受控进程树；仅保留当前状态和峰值，完整曲线按行写盘。"""

import json
import threading
import time

import psutil


def process_descendants(pid):
    try:
        return psutil.Process(pid).children(recursive=True)
    except psutil.NoSuchProcess:
        return []


def stop_process_tree(process, descendants=(), timeout=5):
    """等待受控子树真正退出，避免 Windows Python 启动器留下推理进程。"""
    # 采样线程可能同时移除已退出的进程，先固定视图再逐个读取属性。
    children = {child.pid: child for child in tuple(descendants)}
    failures = []
    try:
        if process.pid is not None and process.poll() is None:
            children.update((child.pid, child) for child in process_descendants(process.pid))
    except Exception as error:
        failures.append(error)
    children = list(children.values())
    for child in reversed(children):
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
        except Exception as error:
            failures.append(error)
    try:
        # Windows 的 kill 终止整个 Job，即使启动器已退出也不能跳过。
        process.kill()
    except ProcessLookupError:
        pass
    except Exception as error:
        failures.append(error)
    try:
        process.wait(timeout=timeout)
    except Exception as error:
        failures.append(error)
    try:
        _, alive = psutil.wait_procs(children, timeout=timeout)
        if alive:
            failures.append(
                RuntimeError(f"Analysis descendants did not exit: {[child.pid for child in alive]}")
            )
    except Exception as error:
        failures.append(error)
    if failures:
        raise failures[0]


def process_snapshot(process, *, include_uss=True):
    """分别报告工作集与私有提交量，不用虚拟地址空间冒充物理内存。"""
    with process.oneshot():
        memory = process.memory_info()
        cpu = process.cpu_times()
        value = {
            "pid": process.pid,
            "created_at": process.create_time(),
            "rss_bytes": memory.rss,
            "private_bytes": getattr(memory, "private", None),
            "cpu_seconds": cpu.user + cpu.system,
            "threads": process.num_threads(),
            "handles": process.num_handles() if hasattr(process, "num_handles") else None,
        }
    value["uss_bytes"] = None
    if include_uss:
        try:
            value["uss_bytes"] = process.memory_full_info().uss
        except (psutil.AccessDenied, AttributeError, NotImplementedError):
            pass
    return value


class ProcessTreeMonitor:
    """保留已发现的存活子进程，父进程退出后仍能检测未回收的后代。"""

    def __init__(self, pid, output=None, interval=0.5, *, include_uss=True):
        if not 0.05 <= interval <= 60:
            raise ValueError("Sampling interval must be between 0.05 and 60 seconds")
        try:
            self.root = psutil.Process(pid)
            created_at = self.root.create_time()
        except psutil.Error as error:
            raise RuntimeError("Cannot inspect the benchmark process") from error
        self.processes = {(pid, created_at): self.root}
        self.output = output
        self.interval = interval
        self.include_uss = include_uss
        self.started = time.monotonic()
        self.current = None
        self.peaks = {}
        self.failure = None
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, name="brevia-resources", daemon=True)

    def __enter__(self):
        self.sample()
        self.thread.start()
        return self

    def __exit__(self, error_type, error, traceback):
        self.stopped.set()
        self.thread.join(timeout=self.interval + 5)
        if self.thread.is_alive():
            raise RuntimeError("Resource sampler did not stop")
        self.sample()
        if error_type is None:
            if self.failure is not None:
                raise RuntimeError("Resource sampler failed") from self.failure

    def _run(self):
        try:
            while not self.stopped.wait(self.interval):
                self.sample()
        except Exception as error:
            self.failure = error

    def sample(self):
        errors = []
        for identity, process in list(self.processes.items()):
            try:
                if not process.is_running():
                    self.processes.pop(identity, None)
                    continue
                for child in process.children(recursive=True):
                    self.processes[(child.pid, child.create_time())] = child
            except psutil.NoSuchProcess:
                self.processes.pop(identity, None)
            except psutil.AccessDenied:
                errors.append({"pid": process.pid, "error": "access_denied"})
        rows = []
        for identity, process in list(self.processes.items()):
            try:
                rows.append(process_snapshot(process, include_uss=self.include_uss))
            except psutil.NoSuchProcess:
                self.processes.pop(identity, None)
            except psutil.AccessDenied:
                errors.append({"pid": process.pid, "error": "access_denied"})
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        totals = {}
        for name in ("rss_bytes", "private_bytes", "uss_bytes", "threads", "handles"):
            values = [row[name] for row in rows]
            totals[name] = (
                sum(values) if all(value is not None for value in values) and not errors else None
            )
            if totals[name] is not None and rows:
                self.peaks[name] = max(self.peaks.get(name, 0), totals[name])
        value = {
            "elapsed_seconds": round(time.monotonic() - self.started, 4),
            "root_pid": self.root.pid,
            "processes": rows,
            "totals": totals,
            "system": {
                "total_bytes": memory.total,
                "available_bytes": memory.available,
                "swap_used_bytes": swap.used,
            },
            "errors": errors,
        }
        self.current = value
        if self.output is not None:
            self.output.write(json.dumps(value, allow_nan=False) + "\n")
            self.output.flush()
        return value

    def summary(self):
        return {
            "sample_interval_seconds": self.interval,
            "includes_uss": self.include_uss,
            "peaks": dict(self.peaks),
            "last": self.current,
            # RSS 含共享页面，求和只表示进程工作集之和，不能当作整机物理占用。
            "rss_includes_shared_pages": True,
        }
