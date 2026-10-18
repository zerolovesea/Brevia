"""Windows 显式分析入口，避免冻结程序依赖 multiprocessing 的隐式重入。"""

import json
import os
import queue
import subprocess
import sys
import threading


class DiarizationProcess:
    """把独立进程的 JSONL 消息接到分析任务现有的可取消等待循环。"""

    def __init__(self, payload):
        command = (
            [sys.executable, "--diarization"]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-m", "backend.diarization_process"]
        )
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self.messages = queue.Queue()
        self.pending = None

        def read():
            try:
                for line in self.process.stdout:
                    self.messages.put(json.loads(line))
            except (OSError, ValueError) as error:
                self.messages.put((False, f"Invalid diarization output: {error}"))
            finally:
                self.messages.put(None)

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

        def write():
            # 子进程尚未读取 stdin 时，大 payload 会填满 Windows 管道；不能阻塞超时/取消。
            try:
                with self.process.stdin:
                    self.process.stdin.write(json.dumps(payload) + "\n")
            except (OSError, ValueError) as error:
                self.messages.put((False, f"Cannot send diarization payload: {error}"))

        self.writer = threading.Thread(target=write, daemon=True)
        self.writer.start()

    def poll(self, timeout=0):
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
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        self.reader.join(timeout=5)
        self.writer.join(timeout=5)
        self.process.stdout.close()


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
            from .worker_refinement import _diarize_chunk_process

            payload = json.loads(sys.stdin.buffer.readline())
            _diarize_chunk_process(connection, payload)
        except Exception as error:
            connection.send((False, f"{type(error).__name__}: {error}"))


if __name__ == "__main__":
    main()
