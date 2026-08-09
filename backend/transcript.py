"""逐字稿版本选择、时间格式化与摘要证据校验。"""

import json


def latest_segments(segments):
    """选择展示/导出版本：精修覆盖实时，人工编辑始终优先。"""
    latest, priority = {}, {"live": 1, "postprocess": 2, "user": 3}
    refined = [item for item in segments if item["version"].startswith("postprocess")]
    revision = max((item["revision"] for item in refined), default=None)
    base = (
        [item for item in refined if item["revision"] == revision]
        if revision is not None
        else [item for item in segments if item["version"] == "live"]
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


def validate_summary(data, segment_ids):
    """拒绝没有来源段落的决定与待办，避免模型编造会议结论。"""
    required = {"summary", "decisions", "action_items", "open_questions"}
    if not isinstance(data, dict) or not required <= data.keys():
        raise ValueError("Summary JSON does not match the required schema")
    for item in [*data["decisions"], *data["action_items"]]:
        evidence = item.get("evidence_segment_ids")
        if not evidence or any(segment not in segment_ids for segment in evidence):
            raise ValueError("Every decision and action item needs valid evidence")


def parse_json_object(value):
    """从纯 JSON 或 Markdown 代码块响应中提取第一个 JSON 对象。"""
    text = value.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character == "{":
            try:
                data, _ = decoder.raw_decode(text[index:])
                return data
            except json.JSONDecodeError:
                continue
    raise ValueError("Summary response does not contain a JSON object")


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
