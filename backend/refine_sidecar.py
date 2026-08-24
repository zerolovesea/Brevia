"""独立的实时精修 sidecar 进程（可选，默认关闭）。

把 RefinedASR 从主 worker 进程中移出，获得两级隔离：

- 精修模型崩溃 / 长时间卡死不会拖垮主 worker 里的流式 ASR；
- sidecar 进程可另行设置 OS 优先级，避免抢占实时字幕。

主 worker 经 ``multiprocessing`` 双向管道与 sidecar 通信；sidecar 在首次解码时
懒加载模型并常驻复用。任何失败（模型缺失 / 管道断开 / 超时）都会自动回退到
worker 进程内直接精修（``RemoteRefiner._fallback_decode``），绝不阻塞字幕主链路。

启用方式：``BREVIA_LIVE_REFINE_SIDECAR=1``（Windows 打包进程已调用
``multiprocessing.freeze_support()``，与 diarization 子进程走同一套 spawn 机制）。

注意：实时精修线程数已由 ``thread_budget("refine")`` 压低，sidecar 进程内同样
保持低线程数，避免与流式 ASR 争抢 CPU。
"""

import multiprocessing

from .asr import ModelManager, RefinedASR

# 单次解码的等待上限（秒）。15s 窗口在弱 CPU 上通常需十几秒；给足余量避免误判，
# 超出则判 sidecar 卡死并重启/回退。
REFINE_SIDECAR_TIMEOUT_SECONDS = 90

# sidecar 连续失败多少次后永久锁定进程内回退。弱机上模型首载/解码常超 90s，
# 若每次都"杀进程重建 + 再回退主进程"会反复加载第二份模型并造成进程 churn，
# 违背 sidecar 隔离/让核的目的。连续失败达阈值后直接锁定回退，不再折腾子进程。
REFINE_SIDECAR_MAX_CONSECUTIVE_FAILURES = 2


def refine_sidecar_loop(conn, models_root, bundled_root, model_id, language):
    """sidecar 进程入口：加载模型并循环处理解码请求。

    协议（经 Connection 收发 tuple）：
    - ``("decode", samples, sample_rate)`` -> ``("text", text)`` / ``("error", msg)``
    - ``"shutdown"`` 或 ``None`` 结束。
    """
    try:
        manager = ModelManager(models_root, bundled_root=bundled_root)
        refiner = None
        while True:
            try:
                message = conn.recv()
            except (EOFError, OSError):
                break
            if message is None or message == "shutdown":
                break
            if not isinstance(message, tuple) or message[0] != "decode":
                continue
            _, samples, sample_rate = message
            try:
                if refiner is None:
                    refiner = RefinedASR(
                        manager, model_id, language=language, threads=1
                    )
                text = refiner.decode(samples, sample_rate)
            except BaseException as error:  # noqa: BLE001 - report to parent
                conn.send(("error", f"{type(error).__name__}: {error}"))
                continue
            conn.send(("text", text or ""))
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


class RemoteRefiner:
    """主进程侧的远程精修器：懒启动 sidecar 进程，失败时回退到进程内精修。

    暴露与 ``RefinedASR`` 一致的 ``decode(samples, sample_rate) -> str`` 接口，
    因此 ``_refine_live_audio`` 等调用方无需改动。
    """

    def __init__(self, manager, model_id, language=None):
        self._manager = manager
        self._model_id = model_id
        self._language = language
        self._ctx = multiprocessing.get_context("spawn")
        self._process = None
        self._conn = None
        self._fallback = None
        self._closed = False
        self._consecutive_failures = 0
        self._fallback_locked = False

    def decode(self, samples, sample_rate):
        """把一段音频交给 sidecar 解码；失败时回退到进程内精修。

        连续失败达到 ``REFINE_SIDECAR_MAX_CONSECUTIVE_FAILURES`` 后永久锁定回退：
        之后直接走进程内精修，不再尝试/重建 sidecar，避免弱机上反复空等与双份模型。
        """
        if self._closed:
            return ""
        if self._fallback_locked:
            return self._fallback_decode(samples, sample_rate)
        try:
            self._ensure()
            self._conn.send(("decode", samples, sample_rate))
            if not self._conn.poll(timeout=REFINE_SIDECAR_TIMEOUT_SECONDS):
                raise RuntimeError("refine sidecar decode timed out")
            message = self._conn.recv()
            if isinstance(message, tuple) and message and message[0] == "text":
                self._consecutive_failures = 0
                return message[1]
            raise RuntimeError(
                message[1] if isinstance(message, tuple) and len(message) > 1
                else "refine sidecar error"
            )
        except Exception:
            self._consecutive_failures += 1
            if self._consecutive_failures >= REFINE_SIDECAR_MAX_CONSECUTIVE_FAILURES:
                self._fallback_locked = True
                self._close()
            return self._fallback_decode(samples, sample_rate)

    def _ensure(self):
        if self._closed:
            raise RuntimeError("refine sidecar is closed")
        if self._process is not None and self._process.is_alive() and self._conn is not None:
            return
        parent, child = self._ctx.Pipe(duplex=True)
        self._process = self._ctx.Process(
            target=refine_sidecar_loop,
            args=(
                child,
                str(self._manager.root),
                str(self._manager.bundled_root) if self._manager.bundled_root else None,
                self._model_id,
                self._language,
            ),
        )
        self._process.start()
        child.close()
        self._conn = parent

    def _fallback_decode(self, samples, sample_rate):
        if self._closed:
            return ""
        if self._fallback is None:
            self._fallback = RefinedASR(
                self._manager, self._model_id, language=self._language
            )
        return self._fallback.decode(samples, sample_rate)

    def shutdown(self):
        self._closed = True
        self._close()

    def _close(self):
        conn, process = self._conn, self._process
        self._process = None
        self._conn = None
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass
        if process is not None and process.is_alive():
            process.terminate()
            process.join(timeout=REFINE_SIDECAR_TIMEOUT_SECONDS)

    def __del__(self):
        try:
            self.shutdown()
        except Exception:  # noqa: BLE001
            pass
