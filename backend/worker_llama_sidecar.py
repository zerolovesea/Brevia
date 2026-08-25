"""内置 AI 推理的 LlamaSidecar 管理。

摘要与实时 AI 辅助共享一个 16K context sidecar；翻译保留独立进程，避免切换不同
GGUF 时重载。翻译序列化由 ``worker.py`` 中的单工作线程执行器在上游强制执行。
"""

import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional


# 推理模型（Qwen3.5 等）将思维链包装在 <think>...</think> 中。即使思考实际关闭，
# 它们也会发出一个空块，因此在到达摘要/翻译管道之前从每次内置补全中剥离它。
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINKING_PROCESS = re.compile(r"^\s*(?:thinking process|reasoning|analysis)\s*:", re.IGNORECASE)
# 内置模型在 CPU（Windows 无 GPU 卸载时）上生成纪要很慢；超时保留足够余量，
# 避免 2B~4B GGUF 在慢速机器上被误杀。
REQUEST_TIMEOUT_SECONDS = 20 * 60
ASSISTANT_SIDECAR = "assistant"


def strip_reasoning(text: str) -> str:
    """从模型输出中移除推理块，只保留最终回答。"""
    if not text:
        return text
    cleaned = _THINK_BLOCK.sub("", text)
    # 处理悬挂的关闭标签（开放标签被聊天模板消耗）：只保留最后一个 </think> 之后的内容。
    # 然后丢弃被截断（最大令牌）推理运行留下的任何孤立开放标签。
    lower = cleaned.lower()
    if "</think>" in lower:
        cleaned = cleaned[lower.rindex("</think>") + len("</think>"):]
    cleaned = re.sub(r"</?think>", "", cleaned, flags=re.IGNORECASE)
    if _THINKING_PROCESS.match(cleaned):
        final = re.search(r"(?m)^#\s+", cleaned)
        cleaned = cleaned[final.start():] if final else ""
    return cleaned.strip()


class _Sidecar:
    """绑定到一个用途的单个 llama sidecar 子进程。"""

    def __init__(self, cmd, on_error):
        self.cmd = cmd
        self.on_error = on_error
        self.process: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()

    def _ensure(self) -> bool:
        """确保 sidecar 进程正在运行；失败时返回 False。"""
        if self.process and self.process.poll() is None:
            return True
        try:
            # 显式 UTF-8 文本管道：Windows 下 subprocess 文本管道默认按系统 ANSI
            # 代码页编解码，与 sidecar 内部固定为 UTF-8 的 stdio 保持一致。
            self.process = subprocess.Popen(
                self.cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            return True
        except Exception as error:  # noqa: BLE001 - report and degrade
            self.on_error(f"Failed to start llama sidecar: {error}")
            return False

    def request(self, request: dict, timeout_seconds=None) -> dict:
        """发送请求并返回 sidecar 响应；``timeout_seconds`` 为空时用默认超时。"""
        with self.lock:
            if not self._ensure():
                return {"type": "error", "message": "Sidecar not available"}
            timed_out = threading.Event()

            def terminate():
                timed_out.set()
                if self.process and self.process.poll() is None:
                    self.process.kill()

            timer = threading.Timer(timeout_seconds or REQUEST_TIMEOUT_SECONDS, terminate)
            timer.start()
            try:
                self.process.stdin.write(json.dumps(request) + "\n")
                self.process.stdin.flush()
                line = self.process.stdout.readline()
                if timed_out.is_set():
                    self.process = None
                    return {"type": "error", "message": "Sidecar request timed out"}
                if not line:
                    self.process = None
                    return {"type": "error", "message": "Sidecar closed unexpectedly"}
                return json.loads(line)
            except Exception as error:  # noqa: BLE001 - surface to caller
                self.process = None
                return {"type": "error", "message": f"Sidecar communication error: {error}"}
            finally:
                timer.cancel()

    def cancel(self):
        """立即终止在飞的推理（不持有锁，以便从请求等待中解除阻塞）。"""
        process = self.process
        if process and process.poll() is None:
            try:
                process.kill()
            except Exception:  # noqa: BLE001 - best-effort cancellation
                pass
        self.process = None

    def shutdown(self):
        """优雅地关闭 sidecar 进程。"""
        with self.lock:
            if self.process and self.process.poll() is None:
                try:
                    self.process.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
                    self.process.stdin.flush()
                    self.process.wait(timeout=5)
                except Exception:  # noqa: BLE001 - best-effort cleanup
                    self.process.kill()
                finally:
                    self.process = None


class LlamaSidecarMixin:
    """管理命名的 llama sidecar 子进程，用于本地 GGUF 推理。"""

    def __init__(self):
        super().__init__()
        self._sidecars: dict = {}
        self._sidecars_lock = threading.Lock()

    def _sidecar_command(self):
        """解析启动 llama sidecar 的命令。"""
        # 开发/测试用：跳过已打包的二进制，直接跑当前源码模块
        # （打包后的二进制不会带上 llama_sidecar.py 的最新改动）。
        if os.environ.get("BREVIA_LLAMA_HELPER", "").lower() in {"module", "dev", "python"}:
            return [sys.executable, "-m", "backend.llama_sidecar"]
        if getattr(sys, "frozen", False):
            bundle_dir = Path(sys._MEIPASS)
            runtime_dir = bundle_dir.parent.parent / "brevia-llama-helper"
        else:
            runtime_dir = Path(__file__).parent / "runtime" / "brevia-llama-helper"

        binary = "brevia-llama-helper.exe" if sys.platform == "win32" else "brevia-llama-helper"
        binary_path = runtime_dir / binary
        if binary_path.exists():
            return [str(binary_path)]
        # 开发模式回退：直接运行模块。
        return [sys.executable, "-m", "backend.llama_sidecar"]

    def _get_sidecar(self, name: str) -> _Sidecar:
        """获取或创建命名的 sidecar 实例。"""
        with self._sidecars_lock:
            sidecar = self._sidecars.get(name)
            if sidecar is None:
                sidecar = _Sidecar(self._sidecar_command(), self._sidecar_error)
                self._sidecars[name] = sidecar
            return sidecar

    def _sidecar_error(self, message: str):
        """报告 sidecar 错误；绝不能在此处抛出异常。"""
        try:
            self.emit("worker.error", {"message": message})
        except Exception:  # noqa: BLE001 - emit must never raise here
            pass

    def _resolve_gguf(self, model_id: str) -> Path:
        """解析已下载模型的磁盘 .gguf 路径。"""
        model_path = self.models.path(model_id)
        if not model_path.exists():
            raise ValueError(f"Model {model_id} is not installed")
        gguf_files = list(model_path.glob("*.gguf"))
        if not gguf_files:
            raise ValueError(f"No .gguf file found in {model_path}")
        return gguf_files[0]

    def llama_generate(
        self,
        sidecar_name: str,
        model_id: str,
        prompt: str,
        *,
        max_tokens: int = 2048,
        context_size: int = 8192,
        temperature: float = 0.7,
        top_k: int = 40,
        top_p: float = 0.95,
        stop_tokens: Optional[list] = None,
        chat: bool = False,
    ) -> str:
        """通过命名 sidecar 使用已下载的 GGUF 模型生成文本。

        ``chat`` 为 True 时走聊天模板，用于摘要等需要抑制思维链的任务。
        """
        model_file = self._resolve_gguf(model_id)
        request = {
            "type": "generate",
            "model_path": str(model_file),
            "prompt": prompt,
            "max_tokens": max_tokens,
            "context_size": context_size,
            "temperature": temperature,
            "top_k": top_k,
            "top_p": top_p,
            "stop_tokens": stop_tokens,
            "chat": chat,
        }
        response = self._get_sidecar(sidecar_name).request(request)
        if response.get("type") == "error":
            raise RuntimeError(f"Sidecar error: {response.get('message')}")
        if response.get("type") != "response":
            raise RuntimeError(f"Unexpected sidecar response: {response.get('type')}")
        return strip_reasoning(response.get("text", ""))

    def llama_sidecar_complete(self, payload: dict, prompt: str) -> str:
        """通过共享 ``assistant`` sidecar 进行摘要侧补全。

        摘要走聊天模板（``chat=True``）：Qwen 系列在原始 completion 下会先输出
        <think> 思维链，占用输出预算并导致纪要正文被截断；聊天模板能抑制思考、
        直接产出完整纪要。
        """
        # UI 在 ``model`` 中发送选定的 GGUF 目录 id；接受显式的 ``model_id`` 别名作为回退。
        model_id = payload.get("model_id") or payload.get("model")
        if not model_id:
            raise ValueError("Built-in AI requires a model id in payload")
        return self.llama_generate(
            ASSISTANT_SIDECAR,
            model_id,
            prompt,
            max_tokens=payload.get("max_tokens", 2048),
            context_size=payload.get("context_size", 16384),
            temperature=payload.get("temperature", 0.7),
            top_k=payload.get("top_k", 40),
            top_p=payload.get("top_p", 0.95),
            stop_tokens=payload.get("stop_tokens"),
            chat=True,
        )

    def llama_generate_realtime(self, model_id: str, prompt: str) -> str:
        """通过共享 ``assistant`` sidecar 运行实时短任务（短超时、可取消、限长输出）。

        Qwen3 系列（2B/4B）默认把思维链包在 <think> 块里，会占满实时任务本就有限的
        输出预算并拖慢 CPU 推理；这里显式追加 ``/no_think`` 关闭思考，只输出 JSON。
        """
        from .worker_ai_note import REALTIME_MAX_TOKENS, REALTIME_TIMEOUT_SECONDS

        if model_id.startswith("qwen3"):
            prompt = f"{prompt}\n/no_think"
        model_file = self._resolve_gguf(model_id)
        request = {
            "type": "generate",
            "model_path": str(model_file),
            "prompt": prompt,
            "max_tokens": REALTIME_MAX_TOKENS,
            # Live notes retain < 1K tokens of prompt context.  A 16K KV cache wastes
            # hundreds of MB on CPU-only laptops and competes with streaming ASR.
            "context_size": 4096,
            "temperature": 0.2,
            "top_k": 40,
            "top_p": 0.95,
            "stop_tokens": ["<|im_end|>", "<|endoftext|>"],
        }
        response = self._get_sidecar(ASSISTANT_SIDECAR).request(request, timeout_seconds=REALTIME_TIMEOUT_SECONDS)
        if response.get("type") == "error":
            raise RuntimeError(f"Sidecar error: {response.get('message')}")
        if response.get("type") != "response":
            raise RuntimeError(f"Unexpected sidecar response: {response.get('type')}")
        return strip_reasoning(response.get("text", ""))

    def cancel_sidecar(self, name: str):
        """取消命名 sidecar 的在飞推理（用于实时任务超时/取消）。"""
        with self._sidecars_lock:
            sidecar = self._sidecars.get(name)
        if sidecar:
            sidecar.cancel()

    def shutdown_sidecars(self):
        """优雅地关闭所有 sidecar 进程。"""
        with self._sidecars_lock:
            for sidecar in self._sidecars.values():
                sidecar.shutdown()
            self._sidecars.clear()
