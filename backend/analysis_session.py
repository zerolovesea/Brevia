"""精修分析阶段的有界进程会话；未提供实测预算时保留按块隔离路径。"""

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import psutil

from .diarization_process import (
    DiarizationCleanupError,
    DiarizationProcess,
    DiarizationStartupError,
    DiarizationTimeout,
)
from .process_resources import ProcessTreeMonitor
from .worker_common import TaskCancelled

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AnalysisBudget:
    process_soft_bytes: int
    tree_soft_bytes: int
    tree_hard_bytes: int
    minimum_available_bytes: int
    minimum_total_bytes: int
    max_chunks: int = 10

    def __post_init__(self):
        if any(type(value) is not int or value <= 0 for value in vars(self).values()):
            raise ValueError("Analysis budgets must be positive integers")
        if not self.process_soft_bytes <= self.tree_soft_bytes < self.tree_hard_bytes:
            raise ValueError("Analysis soft limits must be below the tree hard limit")
        if not 1 <= self.max_chunks <= 10:
            raise ValueError("Analysis sessions may reuse at most 10 speech chunks")
        if self.minimum_available_bytes >= self.minimum_total_bytes:
            raise ValueError("Analysis reserve must be below the validated device memory")

    @classmethod
    def from_environment(cls):
        path = os.environ.get("BREVIA_ANALYSIS_BUDGET")
        if not path:
            return None
        source = Path(path)
        if source.stat().st_size > 4096:
            raise ValueError("Analysis budget file is too large")
        return cls(**json.loads(source.read_text(encoding="utf-8")))


class AnalysisResourceError(RuntimeError):
    """资源不可测或系统余量不足时，结束自动分析而不立即重新加载模型。"""


class AnalysisSession:
    def __init__(self, budget, control, wait_task, progress):
        self.budget = budget
        self.control = control
        self.wait_task = wait_task
        self.progress = progress
        self.child = None
        self.monitor = None
        self.monitor_started = False
        self.cleanup_failed = False
        self.chunks = 0
        self.last_summary = None

    def _check_environment(self):
        memory = psutil.virtual_memory()
        if memory.total < self.budget.minimum_total_bytes:
            raise AnalysisResourceError(
                "This device has less memory than the validated analysis profile"
            )
        if memory.available < self.budget.minimum_available_bytes:
            raise AnalysisResourceError("Not enough available memory to start speaker analysis")

    def _resources(self):
        if self.monitor.failure is not None:
            raise AnalysisResourceError(
                "Cannot monitor speaker analysis resources"
            ) from self.monitor.failure
        sample = self.monitor.current
        private = sample["totals"]["private_bytes"]
        if sample["errors"] or private is None:
            raise AnalysisResourceError("Speaker analysis private memory cannot be measured")
        if sample["system"]["available_bytes"] < self.budget.minimum_available_bytes:
            raise AnalysisResourceError("Speaker analysis reached the system memory reserve")
        if private >= self.budget.tree_hard_bytes:
            raise MemoryError("Speaker analysis exceeded the process tree hard limit")
        # 进程树包含当前精修 worker；每个分析进程还受独立软阈值约束。
        soft = private >= self.budget.tree_soft_bytes or any(
            row["pid"] != os.getpid() and row["private_bytes"] >= self.budget.process_soft_bytes
            for row in sample["processes"]
        )
        return soft

    def _wait(self, payload, started, deadline, *, initializing=False):
        stage, stage_started, last_progress = (
            "startup" if initializing else "submitted",
            started,
            started,
        )
        while True:
            if self.control.cancelled.is_set():
                raise TaskCancelled()
            self._resources()
            now = time.monotonic()
            if now >= deadline:
                message = f"Speaker analysis timed out at {payload['core_start_ms']} ms (stage={stage}, elapsed={now - started:.1f}s)"
                raise (
                    DiarizationStartupError(message)
                    if initializing
                    else DiarizationTimeout(message)
                )
            try:
                available = self.child.poll(min(0.1, deadline - now))
            except EOFError as error:
                if initializing:
                    raise DiarizationStartupError(str(error)) from error
                raise RuntimeError("Speaker analysis exited during a chunk") from error
            if available:
                ok, value = self.child.recv()
                now = time.monotonic()
                if now >= deadline:
                    continue  # 超过墙钟预算的结果不能因恰好到达而被接收。
                logger.info(
                    "analysis session meeting=%s chunk=%s request=%s stage=%s seconds=%.2f elapsed=%.2f next=%s",
                    payload.get("meeting_id"),
                    payload["core_start_ms"],
                    self.child.request_id,
                    stage,
                    now - stage_started,
                    now - started,
                    value if ok is None else "result",
                )
                if ok is None:
                    stage, stage_started = value, now
                elif not ok:
                    if initializing:
                        raise DiarizationStartupError(str(value))
                    raise RuntimeError(str(value))
                else:
                    return value
            if now - last_progress >= 5:
                self.progress(payload)
                logger.info(
                    "analysis session waiting chunk=%s stage=%s elapsed=%.1f",
                    payload["core_start_ms"],
                    stage,
                    now - started,
                )
                last_progress = now

    def _start(self, payload, started, deadline):
        self._check_environment()
        try:
            self.child = DiarizationProcess(payload, session=True)
            # USS 扫描页面较重；生产守护只需 Private Bytes，完整诊断由基准采集。
            self.monitor = ProcessTreeMonitor(os.getpid(), include_uss=False)
            self.monitor.__enter__()
            self.monitor_started = True
        except DiarizationStartupError:
            raise
        except Exception as error:
            raise DiarizationStartupError(f"Cannot start speaker analysis: {error}") from error
        self.chunks = 0
        self._wait(payload, started, min(deadline, started + 60), initializing=True)

    def process_chunk(self, payload, timeout):
        if self.cleanup_failed:
            raise DiarizationCleanupError("Previous analysis cleanup did not complete")
        for attempt in range(2):
            try:
                # 暂停时不为等待下一块保留模型，也不绕过取消检查。
                if self.control.paused.is_set():
                    self.close(graceful=True)
                self.wait_task(self.control)
                self._check_environment()
                started = time.monotonic()
                if self.child is None:
                    self._start(payload, started, started + timeout)
                self.child.submit("process_chunk", payload)
                result = self._wait(payload, started, started + timeout)
                self.chunks += 1
                if self._resources() or self.chunks >= self.budget.max_chunks:
                    self.close(graceful=True)
                return result
            except (TaskCancelled, DiarizationStartupError, AnalysisResourceError):
                self.close()
                raise
            except (RuntimeError, MemoryError) as error:
                self.close()
                restarts = getattr(self.control, "analysis_restarts", 0)
                if attempt or restarts >= 2:
                    raise
                self._check_environment()
                self.control.analysis_restarts = restarts + 1
                logger.warning(
                    "Restarting analysis for chunk=%s recovery=%s error=%s",
                    payload["core_start_ms"],
                    restarts + 1,
                    error,
                )
        raise AssertionError("Unreachable analysis retry state")

    def close(self, graceful=False):
        child, monitor = self.child, self.monitor
        # 清理失败时保留引用并传播错误；调用方禁止启动另一套模型。
        failure = None
        try:
            if child is not None:
                child.close(graceful=graceful)
        except Exception as error:
            failure = error
        try:
            if monitor is not None and self.monitor_started:
                monitor.__exit__(None, None, None)
                self.monitor_started = False
                self.last_summary = monitor.summary()
                logger.info(
                    "analysis session closed chunks=%s peaks=%s",
                    self.chunks,
                    self.last_summary["peaks"],
                )
        except Exception as error:
            failure = failure or error
        if failure is not None:
            self.cleanup_failed = True
            raise DiarizationCleanupError("Analysis process cleanup did not complete") from failure
        self.child = None
        self.monitor = None
