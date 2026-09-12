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


def subtitle_timeline_anchors(event, text):
    """文本字符偏移 → 音频时间 的锚点，来自模型的词级时间戳。

    识别器给出的 ``word_timestamps`` 是同一段音频里按顺序排列的 token；把它们在最终
    文本里顺序定位，就得到一组「这个字在哪里说出口」的真实锚点。定位不到的 token
    （数字被归一化、接缝去重改写过的文本）直接跳过，相邻锚点之间由调用方线性插值，
    因此个别失配不会把整条时间轴带偏。返回值按偏移与时间都单调递增，并以段落自身的
    起止封口——段落的外边界始终精确。
    """
    start_ms, end_ms = event["start_ms"], event["end_ms"]
    anchors = [(0, start_ms)]
    cursor, previous = 0, start_ms
    for word in event.get("word_timestamps") or []:
        token = str(word.get("text") or "").strip()
        if not token:
            continue
        index = text.find(token, cursor)
        if index < 0:
            continue
        time = word.get("start_ms")
        if not isinstance(time, (int, float)) or isinstance(time, bool):
            continue
        time = min(max(int(time), start_ms), end_ms)
        if time < previous:
            continue
        anchors.append((index, time))
        previous = time
        cursor = index + len(token)
    anchors.append((max(len(text), cursor), end_ms))
    return anchors


def subtitle_time_at_offset(event, text, offset):
    """把文本里的字符偏移映射到音频时间。

    有词级锚点时按相邻锚点插值：段内停顿、语速变化因此被真实反映，而不是把整段时长
    按字数平摊。模型不给词时间戳时（``word_timestamps`` 为空）退回按字数比例估时。
    两种情况都以段落自身的 ``start_ms``/``end_ms`` 为两端锚点。
    """
    start_ms, end_ms = event["start_ms"], event["end_ms"]
    length = len(text)
    if length <= 0 or end_ms <= start_ms:
        return start_ms
    offset = max(0, min(length, offset))
    anchors = subtitle_timeline_anchors(event, text)
    for index in range(len(anchors) - 1):
        left, right = anchors[index], anchors[index + 1]
        if offset <= right[0]:
            span = right[0] - left[0]
            if span <= 0:
                return right[1]
            return left[1] + round((right[1] - left[1]) * (offset - left[0]) / span)
    return end_ms
