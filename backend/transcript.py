"""逐字稿版本选择与时间格式化。"""


def latest_segments(segments):
    """选择展示/导出版本：精修覆盖实时，人工编辑始终优先。"""
    latest, priority = {}, {"live": 1, "postprocess": 2, "user": 3}
    refined = [
        item
        for item in segments
        if item["version"].startswith("postprocess") and str(item.get("text") or "").strip()
    ]
    revision = max((item["revision"] for item in refined), default=None)
    base = (
        [item for item in refined if item["revision"] == revision]
        if revision is not None
        else [
            item
            for item in segments
            if item["version"] == "live" and str(item.get("text") or "").strip()
        ]
    )
    for item in [*base, *(item for item in segments if item["version"] == "user")]:
        item_priority = (
            priority["postprocess"]
            if item["version"].startswith("postprocess")
            else priority[item["version"]]
        )
        previous = latest.get(item["id"], {})
        previous_priority = (
            priority["postprocess"]
            if previous.get("version", "").startswith("postprocess")
            else priority.get(previous.get("version"), 0)
        )
        if item_priority >= previous_priority:
            latest[item["id"]] = item
    return sorted(latest.values(), key=lambda item: item["start_ms"])


def clock(milliseconds):
    """将毫秒转为 MM:SS 格式的时钟显示。"""
    seconds = milliseconds // 1000
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def srt_time(milliseconds):
    """将毫秒转为 SRT 字幕格式的时间戳 (HH:MM:SS,mmm)。"""
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"
