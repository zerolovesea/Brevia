"""会议纪要的可核对原话、日期标注与编辑关系。"""

import re
from collections import Counter
from datetime import date, timedelta
from uuid import uuid4

from .transcript import clock


TEMPLATES = {
    "general": "Organize by discussion topic, decisions and next steps.",
    "weekly": "Use headings Progress, Blockers, Decisions and Next week. Translate these headings to the output language.",
    "interview": "Use each interview question as a heading. Group the respondent's observations, supporting examples and follow-ups under it.",
    "review": "Use headings Proposal, Review findings, Causes, Decisions and Required revisions. Translate headings to the output language.",
}

MARK = re.compile(r"\[\[(conclusion|decision|action|cause):([^\]\n]*)\]\]")
# 小模型有时把明确的因果句标成普通结论；只在原话和结论都有显式连接词时纠正类别。
CAUSE = re.compile(r"因为|原因(?:是|在于)|\bbecause\b|\bdue to\b", re.IGNORECASE)
BULLET = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)")
WEEKDAYS = "一二三四五六日"
EN_DAYS = "monday tuesday wednesday thursday friday saturday sunday".split()
DATE_WORDS = re.compile(
    r"(?:本|这|下下|下|上)(?:周|星期)[一二三四五六日天]|大后天|大前天|(?<![大昨明前后])(?:今天|明天|后天|昨天|前天)"
    r"|\b(?:the day after tomorrow|the day before yesterday|tomorrow|today|yesterday|"
    r"(?:next|this|last) (?:" + "|".join(EN_DAYS) + r"))\b",
    re.IGNORECASE,
)
OFFSETS = {
    "今天": 0,
    "明天": 1,
    "后天": 2,
    "大后天": 3,
    "昨天": -1,
    "前天": -2,
    "大前天": -3,
    "today": 0,
    "tomorrow": 1,
    "yesterday": -1,
    "the day after tomorrow": 2,
    "the day before yesterday": -2,
}


def confirmed_date(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\d", value):
        raise ValueError("Invalid meeting date")
    return date.fromisoformat(value).isoformat()


def annotate_dates(text, meeting_date):
    if not meeting_date:
        return text
    base = date.fromisoformat(meeting_date)

    def expand(match):
        term = match.group().lower()
        offset = OFFSETS.get(term)
        if offset is None:
            if term.isascii():
                week, weekday = term.split()
                weeks = {"this": 0, "last": -1, "next": 1}[week]
                day = EN_DAYS.index(weekday)
            else:
                weeks = (
                    2 if term.startswith("下下") else {"本": 0, "这": 0, "下": 1, "上": -1}[term[0]]
                )
                day = WEEKDAYS.index(term[-1].replace("天", "日"))
            offset = weeks * 7 + day - base.weekday()
        try:
            resolved = base + timedelta(days=offset)
        except OverflowError:
            return match.group()
        if term.isascii():
            return f"{match.group()} ({resolved.isoformat()})"
        year = f"{resolved.year} 年 " if resolved.year != base.year else ""
        return f"{match.group()}（{year}{resolved.month} 月 {resolved.day} 日）"

    return DATE_WORDS.sub(expand, text)


ZH_TEMPLATES = {
    "general": "按议题、决定、行动项组织。",
    "weekly": "分为本周进展、阻碍、已作决定、下周行动。",
    "interview": "以实际访谈问题为小标题，归纳受访者的观点、例证和待追问项。",
    "review": "分为评审发现、原因分析、评审决定、待修改项。",
}


def evidence_instructions(template, language):
    if template not in TEMPLATES:
        raise ValueError("Unknown meeting template")
    if language == "zh":
        return ZH_TEMPLATES[template] + (
            "只保留有内容的章节。每条实质信息写成一个项目，不重复、不使用表格或空白占位。"
            "每条末尾务必附上支持它的输入段号，格式：- 要点。[[conclusion:S2,S4]]。"
            "结论用 conclusion，明确决定用 decision，待办用 action，明确提到的原因用 cause；"
            "发言中明确出现因果关系时，用问题作为 Markdown 小标题，在其下单列一条 cause，不要归为普通结论。引用的原话必须明确说明该问题及原因。猜测保留发言人的不确定语气；没有明确因果关系则省略，不把先后顺序当作原因。不得创造段号，合并时原样传递段号。"
            "原样保留相对日期及紧随其后的程序标注；原话没有明确日期且没有程序标注时，只保留原话，不得推算日期或为模糊表达设截止日。"
            "仅当发言明确纠正术语时保留“错写 → 正确术语”。"
        )
    return (
        "For the final note, organize the material as follows: "
        + TEMPLATES[template]
        + "\nFor each substantive conclusion, decision, action or explicitly discussed cause, "
        "write one Markdown bullet with a source suffix, e.g. '- <claim> [[decision:S1,S3]]'. "
        "Use kinds conclusion, decision, action, cause. Use bullets instead of action tables. "
        "Copy only source IDs actually supporting that claim; never guess IDs. Preserve these "
        "suffixes when merging partial summaries. When a cause is explicit, write it as a distinct cause bullet under a heading naming the problem. The source must explicitly connect that cause to that problem. Preserve uncertainty and omit inferred causes; chronology alone is insufficient. "
        "Keep the original relative date wording with supplied calendar annotations. Never calculate "
        "dates yourself or turn uncertain phrases into deadlines. Keep explicitly stated terminology "
        "corrections as wrong spelling → correct term. Use the requested output language."
    )


def snapshot(segment, seekable=True):
    return {
        "segment_id": segment.get("id") or segment.get("segment_id"),
        "text": segment["text"],
        "speaker": segment.get("speaker_name") or segment.get("speaker", ""),
        "start_ms": segment["start_ms"],
        "end_ms": segment.get("end_ms", segment["start_ms"]),
        "track": segment.get("track", "mic"),
        "version": segment.get("version", "live"),
        "revision": segment.get("revision", 0),
        "seekable": seekable,
    }


def claim_record(text, kind, sources, section="", claim_id=None):
    return {
        "id": claim_id or str(uuid4()),
        "kind": kind,
        "text": text,
        "original_text": text,
        "section": section,
        "sources": sources,
        "edited": False,
    }


def restrict_sources(markdown, allowed):
    """分段与合并各自只能引用该轮输入出现的标签，避免链接到被截断的段落。"""

    def checked(match):
        labels = [value.strip() for value in match[2].split(",") if value.strip() in allowed]
        return f"[[{match[1]}:{','.join(labels)}]]"

    return MARK.sub(checked, markdown)


def parse_claims(markdown, segments, seekable):
    """只解析真实输入段号。Markdown 保留可导出的时间，数据库保留不可变的引文。"""
    output, claims = [], []
    section = ""
    by_label = {f"S{i}": row for i, row in enumerate(segments, 1)}
    fence = ""
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        delimiter = re.match(r"^(`{3,}|~{3,})", stripped)
        if fence:
            if stripped.startswith(fence) and not stripped.strip(fence[0]):
                fence = ""
            output.append(line)
            continue
        if delimiter:
            fence = delimiter[1]
            output.append(line)
            continue
        if re.match(r"^#{1,6}\s", stripped):
            section = stripped.lstrip("# ").strip("* ")
            output.append(line)
            continue
        is_table = stripped.startswith("|")
        next_line = lines[index + 1].strip() if index + 1 < len(lines) else ""
        table_header = (
            is_table and next_line.startswith("|") and re.fullmatch(r"[| :\-]+", next_line)
        )
        if (
            not any(char.isalnum() for char in stripped)
            or table_header
            or stripped in ("（分段纪要过长，已截断）", "(partial summaries truncated)")
            or stripped.startswith(("<!--", "![", "[^"))
        ):
            output.append(line)
            continue
        marks = list(MARK.finditer(line))
        cleaned = MARK.sub("", line).rstrip()
        prefix_match = BULLET.match(cleaned)
        prefix = prefix_match.group() if prefix_match else ""
        text = cleaned[len(prefix) :].strip()
        table_end = ""
        if is_table and text.endswith("|"):
            prefix = cleaned[: cleaned.index("|") + 1]
            text = text.strip("|").strip()
            table_end = " |"
            cleaned = prefix + " " + text
            prefix += " "
        if not text:
            continue
        references = []
        for mark in marks:
            for label in mark[2].split(","):
                label = label.strip()
                if label in by_label and label not in references:
                    references.append(label)
        sources = [snapshot(by_label[label], seekable) for label in references]
        stamps = list(dict.fromkeys(clock(src["start_ms"]) for src in sources if src["seekable"]))
        suffix = " 〔" + " · ".join(stamps) + "〕" if stamps else ""
        suffix += table_end
        kind = marks[0][1] if marks else "action" if is_table else "conclusion"
        problem = section
        cause = CAUSE.search(text)
        if kind == "conclusion" and cause and any(CAUSE.search(src["text"]) for src in sources):
            kind = "cause"
            problem = text[: cause.start()].rsplit("：", 1)[-1].strip(" ：:，,。.") or section
        record = claim_record(text, kind, sources, problem)
        line = cleaned + suffix
        record.update(line=line, prefix=prefix, suffix=suffix)
        claims.append(record)
        output.append(line)
    return "\n".join(output), claims


def align_replacement(claims, before, after):
    """只用于已验证的逐字替换/撤销。可确定同一行时保留结论身份，跨行改写另行核对。"""
    old = before.splitlines()
    new = after.splitlines()
    if len(old) != len(new):
        return
    counts = Counter(old)
    changed = {a: b for a, b in zip(old, new) if a != b and counts[a] == 1}
    for claim in claims:
        line = changed.get(claim["line"])
        prefix, suffix = claim["prefix"], claim["suffix"]
        if line and line.startswith(prefix) and line.endswith(suffix):
            text = line.removeprefix(prefix).removesuffix(suffix).strip()
            if text:
                claim.update(text=text, line=line, edited=text != claim["original_text"])


def resolve_claims(claims, segments, markdown, *, accepted=False):
    """只在同一音轨、同一时间区间匹配完全相同的原话，避免把相邻的重复发言误连。"""
    if not claims:
        return claims
    indexed = {}
    for row in segments:
        key = (row["track"], row["start_ms"], row["end_ms"], row["text"])
        indexed[key] = None if key in indexed else row["id"]
    lines = markdown.splitlines()
    if accepted:
        lines = [re.sub(r"^\s*(?:[-*+]|#{1,6})\s+", "", line).strip() for line in lines]
    counts = Counter(lines)
    for claim in claims:
        claim["detached"] = counts[claim["text"] if accepted else claim["line"]] != 1
        sources = claim["sources"]
        for src in sources:
            key = (src["track"], src["start_ms"], src["end_ms"], src["text"])
            src["current_segment_id"] = indexed.get(key)
        chars = sum(len(s["text"].strip()) for s in sources)
        if not sources:
            status = "missing"
        elif any(not s["current_segment_id"] for s in sources):
            status = "changed"
        elif chars < 20:
            status = "thin"
        else:
            status = "supported"
        claim.update(status=status, source_chars=chars)
    return claims
