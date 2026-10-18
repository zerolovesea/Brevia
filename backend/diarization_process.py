"""Windows 显式分析入口，避免冻结程序依赖 multiprocessing 的隐式重入。"""

import json
import os
import queue
import subprocess
import sys
import threading

from .process_resources import process_descendants, stop_process_tree

MAXIMUM_RESPONSE_CHARACTERS = 32 * 1024 * 1024


class DiarizationTimeout(RuntimeError):
    """原生调用超过处理预算。"""


class DiarizationStartupError(RuntimeError):
    """启动故障不随音频长度变化，禁止拆块重试。"""


class DiarizationProtocolError(DiarizationStartupError):
    """损坏的消息或请求序号不能通过重新处理音频修复。"""


class DiarizationProcess:
    """把独立进程的 JSONL 消息接到分析任务现有的可取消等待循环。"""

    def __init__(self, payload, *, command=None, stderr=None, env=None, session=False):
        self.session = session
        self.request_id = 1
        self.inflight = True
        if session:
            payload = {"id": 1, "type": "init", "payload": payload}
        encoded_payload = json.dumps(payload, allow_nan=False) + "\n"
        if len(encoded_payload) > 32 * 1024 * 1024:
            raise ValueError("Diarization payload exceeds the message limit")
        command = command or (
            [sys.executable, "--diarization"]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-m", "backend.diarization_process"]
        )
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr,
            env=env,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self.messages = queue.Queue(maxsize=16)
        self.stopped = threading.Event()
        self.pending = None
        self.descendants = {}
        self.requests = queue.Queue(maxsize=1)
        self.requests.put_nowait(encoded_payload)
        self.job = None
        try:
            if session and sys.platform == "win32":
                from .windows_job import WindowsProcessJob

                self.job = WindowsProcessJob()
                self.job.assign(self.process.pid)
                # venv 启动器可能在入 Job 前已创建解释器；这些后代也必须受约束。
                for child in process_descendants(self.process.pid):
                    self.descendants[child.pid] = child
                    self.job.assign(child.pid)
        except Exception:
            try:
                if self.job is not None:
                    self.job.close()
            finally:
                stop_process_tree(self.process, self.descendants.values())
                self.process.stdin.close()
                self.process.stdout.close()
            raise

        def read():
            try:
                while not self.stopped.is_set():
                    line = self.process.stdout.readline(MAXIMUM_RESPONSE_CHARACTERS + 1)
                    if not line:
                        break
                    if len(line) > MAXIMUM_RESPONSE_CHARACTERS:
                        raise ValueError("Diarization response exceeds the message limit")
                    self._publish(json.loads(line))
            except (OSError, ValueError) as error:
                message = f"Invalid diarization output: {error}"
                self._publish(DiarizationProtocolError(message) if session else (False, message))
            finally:
                self._publish(None)

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

        def write():
            # 子进程尚未读取 stdin 时，大 payload 会填满 Windows 管道；不能阻塞超时/取消。
            try:
                with self.process.stdin:
                    while not self.stopped.is_set():
                        try:
                            packet = self.requests.get(timeout=0.1)
                        except queue.Empty:
                            continue
                        self.process.stdin.write(packet)
                        self.process.stdin.flush()
                        if not session:
                            break
            except (OSError, ValueError) as error:
                message = f"Cannot send diarization payload: {error}"
                self._publish(DiarizationProtocolError(message) if session else (False, message))

        self.writer = threading.Thread(target=write, daemon=True)
        self.writer.start()

    def _publish(self, message):
        # 消费者暂停或退出时不能无限堆积消息，也不能把读取线程卡在满队列中。
        while not self.stopped.is_set():
            try:
                self.messages.put(message, timeout=0.1)
                return
            except queue.Full:
                continue

    def poll(self, timeout=0):
        self.descendants.update(
            (child.pid, child) for child in process_descendants(self.process.pid)
        )
        if self.pending is not None:
            return True
        try:
            self.pending = self.messages.get(timeout=timeout)
        except queue.Empty:
            return False
        if self.pending is None:
            raise EOFError("Diarization process closed before returning a result")
        if isinstance(self.pending, Exception):
            error, self.pending = self.pending, None
            raise error
        if self.session:
            message = self.pending
            if self.request_id == 1 and message == [None, "import_modules"]:
                return True
            if (
                not isinstance(message, dict)
                or type(message.get("id")) is not int
                or message["id"] != self.request_id
            ):
                raise DiarizationProtocolError(
                    "Diarization response does not match the active request"
                )
            if (
                isinstance(message.get("stage"), str)
                and 0 < len(message["stage"]) <= 128
                and "ok" not in message
            ):
                self.pending = (None, message["stage"])
            elif type(message.get("ok")) is bool and "stage" not in message:
                self.pending = (
                    message["ok"],
                    message.get("result") if message["ok"] else message.get("error"),
                )
            else:
                raise DiarizationProtocolError("Invalid diarization session response")
        return True

    def recv(self):
        message, self.pending = self.pending, None
        if self.session and message[0] is not None:
            self.inflight = False
        return message

    def submit(self, kind, payload):
        if not self.session or self.inflight or self.stopped.is_set():
            raise RuntimeError("Diarization session already has an active request or is closed")
        packet = (
            json.dumps(
                {"id": self.request_id + 1, "type": kind, "payload": payload}, allow_nan=False
            )
            + "\n"
        )
        if len(packet) > MAXIMUM_RESPONSE_CHARACTERS:
            raise ValueError("Diarization payload exceeds the message limit")
        try:
            self.requests.put_nowait(packet)
        except queue.Full as error:
            raise RuntimeError("Diarization request queue is full") from error
        self.request_id += 1
        self.inflight = True

    def close(self, graceful=False):
        if graceful and self.session and not self.inflight and not self.stopped.is_set():
            try:
                self.submit("shutdown", {})
                self.process.wait(timeout=5)
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                pass  # 正常关闭有上限；阻塞的原生调用必须继续走强制回收。
        self.stopped.set()
        failure = None
        try:
            if self.job is not None:
                self.job.close()
        except Exception as error:
            failure = error
        try:
            stop_process_tree(self.process, self.descendants.values())
        except Exception as error:
            failure = error
        finally:
            self.reader.join(timeout=5)
            self.writer.join(timeout=5)
        if self.reader.is_alive() or self.writer.is_alive():
            raise RuntimeError("Diarization pipe threads did not stop") from failure
        self.process.stdout.close()
        self.pending = None
        for channel in (self.requests, self.messages):
            while not channel.empty():
                channel.get_nowait()
        if failure is not None:
            raise failure


def serve_session(connection, first, source):
    from .diarization_engine import DiarizationEngine

    request = first
    engine = None
    expected = 1
    while request is not None:
        identity = request.get("id") if isinstance(request, dict) else None
        try:
            if type(identity) is not int or identity != expected:
                raise ValueError("Invalid diarization request sequence")
            kind = request.get("type")

            def stage(name):
                connection.send({"id": identity, "stage": name})

            if engine is None and kind == "init":
                engine = DiarizationEngine(request["payload"], stage)
                result = None
            elif engine is not None and kind == "process_chunk":
                result = engine.process(request["payload"], stage)
            elif engine is not None and kind == "shutdown":
                connection.send({"id": identity, "ok": True, "result": None})
                return
            else:
                raise ValueError("Unexpected diarization session request")
            connection.send({"id": identity, "ok": True, "result": result})
            expected += 1
            packet = source.readline(MAXIMUM_RESPONSE_CHARACTERS + 1)
            if not packet:
                return
            if len(packet) > MAXIMUM_RESPONSE_CHARACTERS:
                raise ValueError("Diarization request exceeds the message limit")
            request = json.loads(packet)
        except Exception as error:
            connection.send(
                {"id": identity, "ok": False, "error": f"{type(error).__name__}: {error}"}
            )
            return


def main():
    # 原生库的 stdout 不能混入协议；在导入任何模型模块前先回报入口已就绪。
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1) as output:
        sys.stdout.flush()
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        sys.stdout = sys.stderr

        class Connection:
            def send(self, message):
                print(json.dumps(message, allow_nan=False), file=output, flush=True)

            def close(self):
                pass

        connection = Connection()
        connection.send((None, "import_modules"))
        try:
            packet = sys.stdin.buffer.readline(MAXIMUM_RESPONSE_CHARACTERS + 1)
            if len(packet) > MAXIMUM_RESPONSE_CHARACTERS:
                raise ValueError("Diarization payload exceeds the message limit")
            payload = json.loads(packet)
            # 原生依赖加载仍属于启动阶段，DLL/导入失败不能按音频故障递归重试。
            import numpy  # noqa: F401
            import sherpa_onnx  # noqa: F401

            if isinstance(payload, dict) and payload.get("type") == "init":
                serve_session(connection, payload, sys.stdin.buffer)
            else:
                from .diarization_engine import diarize_chunk_process

                diarize_chunk_process(connection, payload)
        except Exception as error:
            connection.send((False, f"{type(error).__name__}: {error}"))


if __name__ == "__main__":
    main()
