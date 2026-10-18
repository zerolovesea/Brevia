"""Windows 显式分析入口，避免冻结程序依赖 multiprocessing 的隐式重入。"""

import json
import os
import queue
import subprocess
import sys
import threading

from .process_resources import process_descendants, stop_process_tree

MAXIMUM_RESPONSE_CHARACTERS = 32 * 1024 * 1024


class DiarizationProcess:
    """把独立进程的 JSONL 消息接到分析任务现有的可取消等待循环。"""

    def __init__(self, payload, *, command=None, stderr=None, env=None):
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
                self._publish((False, f"Invalid diarization output: {error}"))
            finally:
                self._publish(None)

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

        def write():
            # 子进程尚未读取 stdin 时，大 payload 会填满 Windows 管道；不能阻塞超时/取消。
            try:
                with self.process.stdin:
                    self.process.stdin.write(encoded_payload)
            except (OSError, ValueError) as error:
                self._publish((False, f"Cannot send diarization payload: {error}"))

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
        return True

    def recv(self):
        message, self.pending = self.pending, None
        return message

    def close(self):
        self.stopped.set()
        failure = None
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
        if failure is not None:
            raise failure


def main():
    # 原生库的 stdout 不能混入协议；在导入任何模型模块前先回报入口已就绪。
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1) as output:
        sys.stdout.flush()
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        sys.stdout = sys.stderr

        class Connection:
            def send(self, message):
                print(json.dumps(message), file=output, flush=True)

            def close(self):
                pass

        connection = Connection()
        connection.send((None, "import_modules"))
        try:
            from .diarization_engine import diarize_chunk_process

            payload = json.loads(sys.stdin.buffer.readline())
            diarize_chunk_process(connection, payload)
        except Exception as error:
            connection.send((False, f"{type(error).__name__}: {error}"))


if __name__ == "__main__":
    main()
