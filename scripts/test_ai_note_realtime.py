#!/usr/bin/env python3
"""用真实内置模型（CPU）回放播客字幕，验证实时 AI 辅助建议的质量与性能。

用法::

    # 中文单人播客（assist 档，加速 3s/段）
    .venv/bin/python scripts/test_ai_note_realtime.py --meeting zh --mode assist

    # 英文双人播客（assist 档，加速 0.9s/段）
    .venv/bin/python scripts/test_ai_note_realtime.py --meeting en --mode assist --gap 0.9

    # 两个播客都跑（默认）
    .venv/bin/python scripts/test_ai_note_realtime.py

依赖：
- 已安装内置模型 GGUF（默认 ~/brevia/models，可用 --models-dir 覆盖）；
- 默认强制 CPU（BREVIA_GPU_LAYERS=0），用 --no-cpu 关闭。
"""
import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

FIXTURES = {
    "zh": REPO_ROOT / "backend/fixtures/podcast-zh-labor-law.json",
    "en": REPO_ROOT / "backend/fixtures/podcast-en-ai-agents.json",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--meeting", choices=("zh", "en", "both"), default="both")
    parser.add_argument("--mode", choices=("assist", "auto"), default="assist")
    parser.add_argument("--gap", type=float, default=None, help="段间墙钟间隔秒（默认 zh 3.0 / en 0.9）")
    parser.add_argument("--model", default="qwen3.5-4b-q4km")
    parser.add_argument("--models-dir", default=str(Path.home() / "brevia" / "models"))
    parser.add_argument("--cpu", action="store_true", default=True, help="强制 CPU（BREVIA_GPU_LAYERS=0）")
    parser.add_argument("--no-cpu", dest="cpu", action="store_false")
    parser.add_argument("--debug", action="store_true", help="打印每次分析的 prompt 与模型原始输出")
    args = parser.parse_args()

    if args.cpu:
        os.environ["BREVIA_GPU_LAYERS"] = "0"
    # 用当前源码的 llama_sidecar（开发/测试模式），而不是旧的打包二进制。
    os.environ["BREVIA_LLAMA_HELPER"] = "module"

    meetings = ["zh", "en"] if args.meeting == "both" else [args.meeting]
    for meeting in meetings:
        run_podcast(meeting, args)


def run_podcast(meeting, args):
    from backend.worker_ai_note import (
        ANALYSIS_MIN_INTERVAL_ASSIST,
        ANALYSIS_MIN_INTERVAL_AUTO,
    )

    fixture = FIXTURES[meeting]
    if not fixture.exists():
        raise SystemExit(f"fixture not found: {fixture}")
    segments = json.loads(fixture.read_text(encoding="utf-8"))
    gap = args.gap if args.gap is not None else (3.0 if meeting == "zh" else 0.9)
    language = "zh" if meeting == "zh" else "en"
    min_interval = ANALYSIS_MIN_INTERVAL_AUTO if args.mode == "auto" else ANALYSIS_MIN_INTERVAL_ASSIST

    events = []
    root = tempfile.mkdtemp(prefix=f"brevia-ai-note-{meeting}-")
    worker = Worker(root, events.append)
    worker.models.is_ready = lambda _: False
    worker.models.root = Path(args.models_dir)  # 复用真实模型目录
    if args.debug:
        original_generate = worker.llama_generate_realtime

        def debug_generate(model_id, prompt):
            print(f"\n--- 分析 prompt（{len(prompt)} 字符）---\n{prompt}\n--- 原始输出 ---")
            raw = original_generate(model_id, prompt)
            print(f"{raw[:600]}\n---")
            return raw

        worker.llama_generate_realtime = debug_generate

    print(f"\n{'='*80}\n播客：{'如果中国严格执行劳动法（中文单人）' if meeting=='zh' else 'When millions of AI agents meet（英文双人）'}"
          f"  mode={args.mode}  model={args.model}  段数={len(segments)}  段间隔={gap}s")
    print("=" * 80)

    meeting_id = "00000000-0000-4000-8000-0000000000ab"
    worker.ai_note_start(
        {
            "meeting_id": meeting_id,
            "provider": "built-in",
            "model": args.model,
            "proactivity": args.mode,
            "language": language,
        }
    )

    start_wall = time.monotonic()
    suggestion_log = []
    analysis_times = []
    state = {"analyzing_t0": None, "seq": 0}

    def drain():
        """消化已产生的事件并即时打印建议。"""
        for event in events:
            etype = event["type"]
            if etype == "ai-note.suggestion":
                payload = event["payload"]
                suggestion_log.append((time.monotonic() - start_wall, payload))
                print(f"  [+{time.monotonic() - start_wall:6.1f}s] ✦ {payload['type']:<11} {payload['text']}")
            elif etype == "ai-note.analyzing":
                if event["payload"].get("active"):
                    state["seq"] += 1
                    state["analyzing_t0"] = time.monotonic()
                elif state["analyzing_t0"] is not None:
                    analysis_times.append((state["seq"], time.monotonic() - state["analyzing_t0"]))
                    state["analyzing_t0"] = None
        events.clear()

    try:
        for index, segment in enumerate(segments):
            text = str(segment["text"] or "").strip()
            if not text:
                continue
            worker.ai_note_on_segment(
                {
                    "meeting_id": meeting_id,
                    "text": text,
                    "start_ms": segment["start_ms"],
                    "speaker": segment.get("speaker") or "spk-1",
                }
            )
            drain()
            if gap:
                time.sleep(gap)

        # 收尾：等到调度器不再有可分析内容（覆盖最后一轮分析）。
        session = worker._ai_note_sessions.get(meeting_id)
        deadline = time.monotonic() + min_interval + 30
        while time.monotonic() < deadline:
            drain()
            if session is None:
                break
            with session.cond:
                interval_elapsed = time.monotonic() - session.last_run_at >= min_interval
                idle = (
                    not session.running
                    and session.content_version == session.analyzed_version
                    and (session.pending_chars == 0 or interval_elapsed)
                )
            if idle and state["analyzing_t0"] is None:
                break
            time.sleep(0.5)
        drain()
    finally:
        worker.ai_note_stop({"meeting_id": meeting_id})

    wall = time.monotonic() - start_wall
    print(f"\n—— {meeting} 结果 ——")
    print(f"墙钟总时长: {wall:.1f}s（播客原始时长约 {segments[-1]['start_ms'] / 1000 / 60:.0f} 分钟，加速回放）")
    print("每次分析耗时: " + ", ".join(f"#{seq}={dt:.1f}s" for seq, dt in analysis_times) or "（无）")
    types = {}
    for _, payload in suggestion_log:
        types[payload["type"]] = types.get(payload["type"], 0) + 1
    print(f"建议总数: {len(suggestion_log)}  类型分布: " + (", ".join(f"{k}×{v}" for k, v in sorted(types.items())) or "（无）"))
    if suggestion_log:
        print("建议明细：")
        for offset, payload in suggestion_log:
            print(f"  [+{offset:6.1f}s] {payload['type']:<11} {payload['text']}")
    worker.shutdown_ai_note()


if __name__ == "__main__":
    from backend.worker import Worker

    main()
