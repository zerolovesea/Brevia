#!/usr/bin/env python3
"""独立的 llama.cpp 侧车进程，用于本地 GGUF 推理。

通过 stdin/stdout 以 JSON 格式与主 Worker 通信。
处理模型懒加载、GPU 层检测和文本生成。
"""

import json
import sys
from pathlib import Path
from typing import Optional

# 延迟导入 llama_cpp 以避免收集阶段出错
try:
    from llama_cpp import Llama
except ImportError:
    Llama = None


class LlamaSidecar:
    """管理单个 llama.cpp 模型实例，支持懒加载。"""

    def __init__(self):
        self.model: Optional[Llama] = None
        self.model_path: Optional[Path] = None
        self.context_size: int = 8192

    def load_model(self, model_path: str, context_size: int = 8192) -> None:
        """加载或重载模型（如果路径或上下文大小改变）。"""
        path = Path(model_path)
        if not path.exists():
            raise FileNotFoundError(f"Model not found: {model_path}")

        # 如果模型和上下文相同则跳过重载
        if self.model and self.model_path == path and self.context_size == context_size:
            return

        # 检测 GPU 层数
        n_gpu_layers = self._detect_gpu_layers()

        # 加载模型
        self.model = Llama(
            model_path=str(path),
            n_ctx=context_size,
            n_gpu_layers=n_gpu_layers,
            verbose=False,
        )
        self.model_path = path
        self.context_size = context_size

        print(
            json.dumps({
                "type": "log",
                "message": f"Model loaded: {path.name}, ctx={context_size}, gpu_layers={n_gpu_layers}"
            }),
            flush=True,
            file=sys.stderr,
        )

    def _detect_gpu_layers(self) -> int:
        """根据可用后端自动检测最佳 GPU 层数。"""
        try:
            # 尝试检测 Metal (macOS)
            import platform
            if platform.system() == "Darwin":
                # Apple Silicon - 将所有层卸载到 Metal
                return -1  # -1 表示"所有层"
        except Exception:
            pass

        try:
            # 尝试检测 CUDA
            import torch
            if torch.cuda.is_available():
                return -1  # 将所有层卸载到 CUDA
        except Exception:
            pass

        # CPU 回退
        return 0

    def generate(
        self,
        prompt: str,
        max_tokens: int = 2048,
        temperature: float = 0.7,
        top_k: int = 40,
        top_p: float = 0.95,
        stop: Optional[list] = None,
    ) -> str:
        """从已加载的模型生成文本。"""
        if not self.model:
            raise RuntimeError("Model not loaded")

        response = self.model(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            stop=stop or [],
            echo=False,
        )

        return response["choices"][0]["text"]

    def handle_request(self, request: dict) -> dict:
        """处理单个 JSON 请求。"""
        req_type = request.get("type")

        if req_type == "ping":
            return {"type": "pong"}

        if req_type == "generate":
            try:
                # 如果需要则加载模型
                model_path = request.get("model_path")
                if not model_path:
                    return {"type": "error", "message": "Missing model_path"}

                context_size = request.get("context_size", 8192)
                self.load_model(model_path, context_size)

                # 生成文本
                prompt = request.get("prompt", "")
                max_tokens = request.get("max_tokens", 2048)
                temperature = request.get("temperature", 0.7)
                top_k = request.get("top_k", 40)
                top_p = request.get("top_p", 0.95)
                stop = request.get("stop_tokens")

                text = self.generate(
                    prompt=prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    top_k=top_k,
                    top_p=top_p,
                    stop=stop,
                )

                return {"type": "response", "text": text, "error": None}

            except Exception as e:
                return {"type": "error", "message": str(e)}

        if req_type == "shutdown":
            return {"type": "goodbye"}

        return {"type": "error", "message": f"Unknown request type: {req_type}"}


def main():
    """主循环：从 stdin 读取 JSON，向 stdout 写入 JSON。"""
    if Llama is None:
        print(
            json.dumps({"type": "error", "message": "llama-cpp-python not installed"}),
            flush=True,
        )
        sys.exit(1)

    sidecar = LlamaSidecar()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            response = sidecar.handle_request(request)
            print(json.dumps(response), flush=True)

            if response.get("type") == "goodbye":
                break

        except json.JSONDecodeError as e:
            print(
                json.dumps({"type": "error", "message": f"Invalid JSON: {e}"}),
                flush=True,
            )
        except Exception as e:
            print(
                json.dumps({"type": "error", "message": f"Unexpected error: {e}"}),
                flush=True,
            )


if __name__ == "__main__":
    main()
