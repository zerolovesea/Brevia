#!/usr/bin/env python3
"""Benchmark local GGUF CPU inference (prompt processing + generation) for realtime AI-note sizing.

Usage:
    BREVIA_GGUF=~/brevia/models/qwen3.5-4b-q4km-llama-models-2025-08/Qwen3.5-4B-Q4_K_M.gguf \
        .venv/bin/python scripts/bench_llm_cpu.py
"""
import os
import time
from pathlib import Path

GGUF = Path(
    os.environ.get(
        "BREVIA_GGUF",
        str(Path.home() / "brevia/models/qwen3.5-4b-q4km-llama-models-2025-08/Qwen3.5-4B-Q4_K_M.gguf"),
    )
)

from llama_cpp import Llama  # noqa: E402


def main():
    if not GGUF.exists():
        raise SystemExit(f"GGUF not found: {GGUF}")
    print(f"Model: {GGUF.name} ({GGUF.stat().st_size / 1e9:.2f} GB)")
    llm = Llama(model_path=str(GGUF), n_ctx=8192, n_gpu_layers=0, verbose=False)

    zh_prompt = (
        "你是一名会议实时笔记助手。请从下面最近的会议字幕中提取一条明确、可核对的信息。\n"
        "<recent_transcript>\n"
        + "\n".join(f"[{i:02d}:00] 说话人{1 + i % 2}: " + ("我们今天的主题是如果中国严格执行劳动法，会对企业和员工产生什么影响。" * 1) for i in range(30))
        + "\n</recent_transcript>\n"
        '输出极短 JSON：{"type":"conclusion|decision|action|number|date|question|risk|topic|supplement","text":"一句话","importance":"high|medium"}。只输出 JSON。'
    )
    print(f"\nzh prompt chars: {len(zh_prompt)}")

    for max_tokens in (64, 128):
        t0 = time.monotonic()
        out = llm(zh_prompt, max_tokens=max_tokens, temperature=0.2, stop=["<|im_end|>", "<|endoftext|>"])
        dt = time.monotonic() - t0
        text = out["choices"][0]["text"]
        usage = out.get("usage", {})
        pt = usage.get("prompt_tokens", 0)
        gt = usage.get("completion_tokens", 0)
        print(f"\nmax_tokens={max_tokens}: {dt:.1f}s  prompt_tokens={pt} completion_tokens={gt}")
        print(f"  prompt proc: {pt / dt:.1f} tok/s  gen: {gt / max(dt - pt / max(40, pt / dt), 0.01):.1f} tok/s")
        print(f"  output: {text[:160]!r}")

    en_prompt = (
        "You are a realtime meeting-notes assistant. Decide whether the recent transcript "
        "contains one explicit piece of information worth capturing. "
        "<recent_transcript>\n"
        + "\n".join(f"[{i:02d}:00] speaker {1 + i % 2}: " + ("We're discussing what happens when millions of AI agents meet, and the coordination costs involved.") for i in range(30))
        + "\n</recent_transcript>\n"
        'Output a very short JSON: {"type":"conclusion|decision|action|number|date|question|risk|topic|supplement","text":"one short sentence","importance":"high|medium"}. Output only JSON.'
    )
    print(f"\nen prompt chars: {len(en_prompt)}")
    t0 = time.monotonic()
    out = llm(en_prompt, max_tokens=128, temperature=0.2, stop=["<|im_end|>", "<|endoftext|>"])
    dt = time.monotonic() - t0
    text = out["choices"][0]["text"]
    usage = out.get("usage", {})
    print(f"\nen: {dt:.1f}s prompt_tokens={usage.get('prompt_tokens')} completion_tokens={usage.get('completion_tokens')}")
    print(f"  output: {text[:160]!r}")


if __name__ == "__main__":
    main()
