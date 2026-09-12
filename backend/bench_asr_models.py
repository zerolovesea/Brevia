"""对比整句识别模型的速度、内存与输出质量（开发用，不随应用发布）。

用于「三个 ASR 模型该怎么定位」这类选型决策：同一段真实会议音频、同一套 VAD
切分，逐个模型解码，输出可直接对比的指标与文本。

与 ``diagnose_models.py`` 的区别：本工具的音频来自会议的**分块录音目录**（而非
``playback-mic.wav``），并且额外测量**峰值内存**与 **CPU 时间**——因为实测发现
「模型体积」完全不能推断「运行时开销」（FunASR Nano 只有 842 MB，峰值常驻
内存却有 2.2 GB）。

用法::

    python -m backend.bench_asr_models \
        --meeting 976ec2d4-afe3-4834-8a80-8008769c5415 \
        --track mic --language en \
        --models funasr-nano-int8,qwen3-asr-0.6b-int8,whisper-large-v3

输出：stdout 汇总表 + ``--json-out`` 指向的逐段文本明细（便于人工核对英西混说等
场景的识别质量；没有 ground truth 时 WER 无法计算，只能人工比对）。
"""

import argparse
import json
import math
import os
import re
import resource
import statistics
import time
import wave
from pathlib import Path

from .asr import ModelManager, OfflineVAD, RefinedASR

# 与 diagnose_models.py 保持一致的质量启发式：模型幻觉与重复循环是这两个家族
# 在真实会议音频上最常见的退化形态。
ARTIFACT_RE = re.compile(r"```|`\(|language\s*=?\s*[A-Za-z]+|\*\*")


def peak_rss_mb():
    """返回当前进程的峰值常驻内存（MB）。"""
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS 返回字节，Linux 返回 KB。按平台归一化，便于跨平台比较。
    return usage / (1024 * 1024) if os.uname().sysname == "Darwin" else usage / 1024


def find_tracks(meeting_dir):
    """读取 manifest，返回 {轨道名: [分块 WAV 路径]}。"""
    manifest = json.loads((meeting_dir / "manifest.json").read_text(encoding="utf-8"))
    audio = meeting_dir / "audio"
    return {
        name: [audio / chunk for chunk in info["chunks"]]
        for name, info in (manifest.get("tracks") or {}).items()
    }


def merge_track(chunks, destination):
    """把分块 WAV 按顺序拼成一个 16 kHz 单声道 PCM16 WAV。

    会议录音按块落盘（每块约 30 s）。整句识别需要连续音频，否则块边界会把词切开。
    """
    if destination.exists():
        return destination
    with wave.open(str(destination), "wb") as output:
        parameters = None
        for chunk in chunks:
            with wave.open(str(chunk)) as part:
                if parameters is None:
                    parameters = part.getparams()
                    if parameters.nchannels != 1 or parameters.sampwidth != 2:
                        raise ValueError("expected mono PCM16 chunks")
                    output.setparams(parameters)
                output.writeframes(part.readframes(part.getnframes()))
    return destination


def speech_windows(path, vad, min_seconds=1.0):
    """用生产环境的同一套 VAD 切出语音区间。

    必须与产品使用同一个 VAD 和同一套参数，否则比较的不是「模型差异」，而是
    「切分差异」。返回 ``[{start_ms, end_ms}]``。
    """
    return [
        {"start_ms": s["start_ms"], "end_ms": s["end_ms"], "text": ""}
        for s in vad.process_wav(str(path))
        if s["end_ms"] - s["start_ms"] >= min_seconds * 1000
    ]


# English / Spanish 混说的判别词。用于挑选「英西混说」样本：用户的实际场景是
# 英语会议里夹杂西语（"como está"、"o sea"、"entonces"、"vale"…），而均匀采样
# 会命中大量纯英语片段，测出来的是「英语准确度」而不是「混说准确度」。
SPANISH_MARKERS = re.compile(
    r"\b(que|pero|porque|está|estas|entonces|también|vale|bueno|más|para|como|"
    r"mira|nada|o sea|así|muy|aquí|ahora|puede|tiene|hacer|decir|cosa|gente|"
    r"español|castellano|hola|gracias|sí)\b",
    re.IGNORECASE,
)
ENGLISH_MARKERS = re.compile(r"\b(the|and|you|that|what|have|this|with|for|just|okay|yeah)\b", re.IGNORECASE)


def spanish_ratio(text):
    """返回西语标记占（西语+英语）标记的比例，用于排序混说程度。"""
    spanish = len(SPANISH_MARKERS.findall(text))
    english = len(ENGLISH_MARKERS.findall(text))
    total = spanish + english
    return spanish / total if total else 0.0


def split_capped(start, end, cap_ms):
    """把超长段按 ``cap_ms`` 均分，不丢弃。

    上限是硬约束：FunASR Nano 的 KV 容量是 512 token（约 22 s 音频），而生产
    环境的 VAD 上限是 20 s——把 20 s 整段喂给它会触发 ``Context_len exceeds
    KV capacity`` 并把音频占位符截断，产出**空文本**。不做这个约束，测出来的
    是「上下文溢出」而不是「模型准确度」。均分而非截断，避免偏袒能吞长音频的模型。
    """
    if end - start <= cap_ms:
        return [(start, end)]
    pieces = max(2, -(-(end - start) // cap_ms))
    step = (end - start) / pieces
    return [
        (round(start + index * step), round(start + (index + 1) * step))
        for index in range(int(pieces))
    ]


def split_and_spread(segments, max_windows, cap_ms):
    """切好上限后均匀采样，用于 ``--select uniform``。"""
    candidates = []
    for item in segments:
        candidates.extend(split_capped(item["start_ms"], item["end_ms"], cap_ms))
    if len(candidates) <= max_windows:
        return sorted(candidates)
    step = len(candidates) / max_windows
    return sorted(candidates[int(index * step)] for index in range(max_windows))


def load_transcript_windows(database, meeting_id):
    """从会议数据库读取已落库的逐句稿，用于挑选评估样本。

    用已有转写做样本挑选，而不是让我们再解码一遍来猜哪段是西语 —— 更便宜，
    而且样本选择与被评估的模型完全解耦（否则挑样本的模型会偏好自己听懂的段）。
    """
    import sqlite3

    if not database or not Path(database).exists():
        return []
    # 只读打开：绝不改动用户会议库。WAL 模式下仍需能建 shm，故副本优先。
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """SELECT start_ms, end_ms, text FROM segments
               WHERE meeting_id = ? ORDER BY start_ms""",
            (meeting_id,),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        connection.close()
    return [{"start_ms": r[0], "end_ms": r[1], "text": r[2] or ""} for r in rows]


def select_mixed_windows(transcript, max_windows, cap_ms, mixed_fraction=0.6):
    """按西语密度挑选评估窗口：``mixed_fraction`` 取最混说的，其余均匀铺开。

    只取最混说的会丢掉「同一模型在纯英语上是否退化」的信息，所以保留一部分
    均匀样本。返回 ``[(start_ms, end_ms)]``。
    """
    candidates = []
    for item in transcript:
        for start, end in split_capped(item["start_ms"], item["end_ms"], cap_ms):
            candidates.append((start, end, spanish_ratio(item["text"])))

    if not candidates:
        return []
    mixed_count = min(max_windows, max(1, round(max_windows * mixed_fraction)))
    by_mix = sorted(candidates, key=lambda item: item[2], reverse=True)[:mixed_count]
    chosen = {(item[0], item[1]) for item in by_mix}
    rest = [item for item in candidates if (item[0], item[1]) not in chosen]
    remaining = max_windows - len(by_mix)
    if remaining > 0 and rest:
        # 均匀铺开，避免只取会议开头。
        step = max(1, len(rest) // remaining)
        chosen.update((item[0], item[1]) for item in rest[::step][:remaining])
    return sorted(chosen)


def iter_windows(path, window_seconds):
    """按固定时长顺序切分整条音轨，覆盖全片。

    全片模式用统一固定窗口而不是各自的 VAD 段：VAD 段长度取决于模型专属上限，
    会让「切分差异」混进「模型差异」。固定窗口对三者完全公平，且能覆盖真实会议
    里所有的英语、西语、混说、静音、音乐段落。
    """
    with wave.open(str(path)) as recording:
        rate = recording.getframerate()
        frame_count = int(rate * window_seconds)
        index = 0
        while frames := recording.readframes(frame_count):
            yield index, index * window_seconds, frames
            index += 1


def evaluate_full(manager, model_id, language, path, window_seconds, cleaner):
    """全片解码，返回 RTF、峰值内存与逐窗文本。"""
    import numpy

    recognizer = RefinedASR(manager, model_id, language=language)
    items, cpu_total, audio_total, wall_total = [], 0.0, 0.0, 0.0
    for index, offset, frames in iter_windows(path, window_seconds):
        samples = numpy.frombuffer(frames, dtype="<i2").astype(numpy.float32) / 32768.0
        if not len(samples):
            continue
        seconds = len(samples) / 16000
        cpu_before, wall_before = time.process_time(), time.perf_counter()
        text, _ = recognizer.decode_words(samples, 16000)
        cpu = time.process_time() - cpu_before
        wall = time.perf_counter() - wall_before
        cpu_total += cpu
        wall_total += wall
        audio_total += seconds
        cleaned = cleaner(text)
        has_artifact, has_loop, chars = quality(text, cleaned)
        items.append(
            {
                "index": index,
                "start_ms": offset * 1000,
                "end_ms": (offset + window_seconds) * 1000,
                "audio_seconds": round(seconds, 2),
                "cpu_seconds": round(cpu, 3),
                "wall_seconds": round(wall, 3),
                "chars": chars,
                "artifact": has_artifact,
                "loop": has_loop,
                "spanish": spanish_ratio(text),
                "text": text,
            }
        )
    return summarize(model_id, items, cpu_total, wall_total, audio_total)


def summarize(model_id, items, cpu_total, wall_total, audio_total):
    """汇总逐窗结果。指标口径与逐段模式一致，便于对比。"""
    return {
        "model_id": model_id,
        "windows": len(items),
        "audio_seconds": round(audio_total, 2),
        "cpu_seconds": round(cpu_total, 2),
        "wall_seconds": round(wall_total, 2),
        "cpu_rtf": round(cpu_total / audio_total, 4) if audio_total else None,
        "wall_rtf": round(wall_total / audio_total, 4) if audio_total else None,
        "peak_rss_mb": round(peak_rss_mb(), 1),
        "empty": sum(1 for i in items if i["chars"] == 0),
        "artifacts": sum(1 for i in items if i["artifact"]),
        "loops": sum(1 for i in items if i["loop"]),
        # 中文字符出现在英语/西语会议里即为错语言幻觉，是最伤信任的退化形态。
        "cjk_only_windows": sum(
            1 for i in items
            if i["chars"] and not re.search(r"[A-Za-z]", i["text"]) and re.search(r"[\u4e00-\u9fff]", i["text"])
        ),
        "spanish_windows": sum(1 for i in items if i["spanish"] >= 0.5 and i["chars"]),
        "mean_chars": round(statistics.mean(i["chars"] for i in items), 1) if items else 0,
        "items": items,
    }


def quality(text, cleaned):
    """返回 (是否含伪影, 是否重复循环, 有效字符数)。"""
    return (
        bool(ARTIFACT_RE.search(text)),
        len(text) > 80 and len(set(re.findall(r"[\u4e00-\u9fff]+", text))) <= 4,
        len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", cleaned)),
    )


def evaluate(manager, model_id, language, windows, audio_path, cleaner):
    """逐窗口解码，返回逐段结果与汇总指标。"""
    from .audio_io import read_mono_wav_window

    recognizer = RefinedASR(manager, model_id, language=language)
    items, cpu_total, audio_total, wall_total = [], 0.0, 0.0, 0.0
    for start_ms, end_ms in windows:
        samples, sample_rate = read_mono_wav_window(str(audio_path), start_ms, end_ms)
        cpu_before = time.process_time()
        wall_before = time.perf_counter()
        text, _ = recognizer.decode_words(samples, sample_rate)
        cpu = time.process_time() - cpu_before
        wall = time.perf_counter() - wall_before
        seconds = len(samples) / sample_rate
        cpu_total += cpu
        wall_total += wall
        audio_total += seconds
        cleaned = cleaner(text)
        has_artifact, has_loop, chars = quality(text, cleaned)
        items.append(
            {
                "start_ms": start_ms,
                "end_ms": end_ms,
                "audio_seconds": round(seconds, 3),
                "cpu_seconds": round(cpu, 3),
                "wall_seconds": round(wall, 3),
                "chars": chars,
                "artifact": has_artifact,
                "loop": has_loop,
                "spanish": spanish_ratio(text),
                "text": text,
            }
        )
    return summarize(model_id, items, cpu_total, wall_total, audio_total)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path.home() / "brevia"))
    parser.add_argument("--meeting", required=True, help="会议目录名")
    parser.add_argument("--track", default="mic", choices=["mic", "system"])
    parser.add_argument("--language", default="en")
    parser.add_argument("--models", default="funasr-nano-int8,qwen3-asr-0.6b-int8,whisper-large-v3")
    parser.add_argument("--max-windows", type=int, default=24)
    parser.add_argument(
        "--max-window-seconds",
        type=float,
        default=12.0,
        help="单个窗口音频长度上限；须小于所有候选模型的 KV 容量（FunASR Nano 约 22 s）",
    )
    parser.add_argument("--models-root", default=None, help="模型根目录，默认 <root>/models")
    parser.add_argument(
        "--select",
        default="mixed",
        choices=["mixed", "uniform"],
        help="mixed：从已有逐句稿挑英西混说样本；uniform：VAD 均匀采样",
    )
    parser.add_argument(
        "--transcript-db",
        default=None,
        help="会议数据库副本路径（--select mixed 时必需）；沙箱下需先 cp 到 workspace",
    )
    parser.add_argument("--json-out", default=None)
    parser.add_argument(
        "--full",
        action="store_true",
        help="全片模式：按 --window-seconds 固定窗口覆盖整条音轨，不采样。最公平但最慢。",
    )
    parser.add_argument(
        "--window-seconds",
        type=float,
        default=12.0,
        help="--full 的固定窗口长度；须小于所有候选模型的 KV 容量（FunASR Nano 约 22 s）",
    )
    args = parser.parse_args()

    from .worker_refinement import RefinementWorkerMixin

    root = Path(args.root)
    meeting_dir = root / "meetings" / args.meeting
    models_root = args.models_root or str(root / "models")

    tracks = find_tracks(meeting_dir)
    if args.track not in tracks:
        raise SystemExit(f"轨道 {args.track} 不存在，可用：{sorted(tracks)}")

    merge_dir = Path(args.json_out).parent if args.json_out else Path.cwd()
    merged = merge_track(tracks[args.track], merge_dir / f"{args.track}-merged.wav")
    with wave.open(str(merged)) as recording:
        duration = recording.getnframes() / recording.getframerate()

    manager = ModelManager(models_root)
    vad = OfflineVAD(manager, "silero-vad")
    cleaner = RefinementWorkerMixin._clean_live_text

    cap_ms = round(args.max_window_seconds * 1000)
    if args.full:
        # 全片模式：统一固定窗口覆盖整条音轨，对三者完全公平，且覆盖真实会议里的
        # 英语、西语、混说、静音与音乐段落。
        windows = None
        source = f"全片固定 {args.window_seconds:.0f} s 窗口（无采样）"
        expected = math.ceil(duration / args.window_seconds)
    elif args.select == "mixed":
        # 从已落库的逐句稿里挑「英西混说」样本。数据库放在会话 workspace 的副本上
        # （沙箱不允许读 ~/brevia 的 sqlite），故显式传 --transcript-db。
        transcript = load_transcript_windows(args.transcript_db, args.meeting)
        if not transcript:
            raise SystemExit(
                "没读到任何逐句稿，无法挑选混说样本；"
                "请用 --transcript-db 指向会议数据库的副本，或改用 --select uniform"
            )
        windows = select_mixed_windows(transcript, args.max_windows, cap_ms)
        source = f"已有逐句稿挑样（{len(transcript)} 段候选，60% 取最混说）"
        expected = len(windows)
    else:
        segments = speech_windows(merged, vad)
        windows = split_and_spread(segments, args.max_windows, cap_ms)
        source = f"VAD 切分（{len(segments)} 段）均匀采样"
        expected = len(windows)

    if not args.full and not windows:
        raise SystemExit("没有可评估的语音段")

    print(f"\n会议   {args.meeting}")
    print(f"轨道   {args.track}  时长 {duration / 60:.1f} 分钟  合并后 {merged}")
    print(f"样本   {expected} 段 · {source}")
    if windows:
        lengths = [(e - s) / 1000 for s, e in windows]
        print(f"窗口   上限 {args.max_window_seconds:.0f} s，中位 {statistics.median(lengths):.1f} s，"
              f"最长 {max(lengths):.1f} s，合计 {sum(lengths):.0f} s")
    print(f"模型   {args.models}\n")

    header = (
        f"{'model':24} {'cpu_rtf':>8} {'wall_rtf':>9} {'峰值RSS':>9} "
        f"{'空':>5} {'伪影':>5} {'重复':>5} {'中文幻觉':>8} {'均字符':>7}"
    )
    print(header)
    print("-" * len(header))

    report = {"meeting": args.meeting, "track": args.track, "language": args.language,
              "duration_seconds": round(duration, 2), "full": bool(args.full),
              "window_seconds": args.window_seconds if args.full else None, "models": {}}
    for model_id in [m for m in args.models.split(",") if m]:
        try:
            result = (
                evaluate_full(manager, model_id, args.language, merged, args.window_seconds, cleaner)
                if args.full
                else evaluate(manager, model_id, args.language, windows, merged, cleaner)
            )
        except Exception as error:  # 模型缺失或初始化失败不应中断整轮对比
            print(f"{model_id:24} 失败 {type(error).__name__}: {error}")
            report["models"][model_id] = {"error": f"{type(error).__name__}: {error}"}
            continue
        report["models"][model_id] = result
        print(
            f"{model_id:24} {result['cpu_rtf']:>8} {result['wall_rtf']:>9} "
            f"{result['peak_rss_mb']:>7.0f}MB {result['empty']:>5} "
            f"{result['artifacts']:>5} {result['loops']:>5} "
            f"{result['cjk_only_windows']:>8} {result['mean_chars']:>7}"
        )

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n逐段文本明细已写入 {args.json_out}")


if __name__ == "__main__":
    main()
