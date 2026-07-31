"""逐字稿版本选择、时间格式化与摘要证据校验。"""


def latest_segments(segments):
    """选择展示/导出版本：精修覆盖实时，人工编辑始终优先。"""
    latest, priority = {}, {"live": 1, "postprocess": 2, "user": 3}
    base = "postprocess" if any(item["version"] == "postprocess" for item in segments) else "live"
    for item in (item for item in segments if item["version"] in {base, "user"}):
        if priority.get(item["version"], 0) >= priority.get(latest.get(item["id"], {}).get("version"), 0):
            latest[item["id"]] = item
    return sorted(latest.values(), key=lambda item: item["start_ms"])


def validate_summary(data, segment_ids):
    """拒绝没有来源段落的决定与待办，避免模型编造会议结论。"""
    required = {"summary", "decisions", "action_items", "open_questions"}
    if not isinstance(data, dict) or not required <= data.keys():
        raise ValueError("Summary JSON does not match the required schema")
    for item in [*data["decisions"], *data["action_items"]]:
        evidence = item.get("evidence_segment_ids")
        if not evidence or any(segment not in segment_ids for segment in evidence):
            raise ValueError("Every decision and action item needs valid evidence")


def clock(milliseconds):
    seconds = milliseconds // 1000
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def srt_time(milliseconds):
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"
