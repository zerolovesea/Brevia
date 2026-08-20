"""实时 AI 辅助笔记引擎：紧凑会议状态、本地轻量检测、单飞去抖调度与批量建议生成。

设计约束：

- 推理独立于 ASR 主循环，运行在专属守护线程，绝不阻塞录音/识别/保存；
- CPU 优先：实时 prompt 严格控制规模（约 <=700 tokens 中文），配合 ``/no_think``
  关闭思维链，让 2B~4B 内置模型在 CPU 上也能在超时内稳定产出 JSON；
- 单飞去抖：一次只运行一个推理；新内容不会打断在飞任务（在飞结果照常使用），
  只在最小间隔后合并触发下一轮，避免「新触发覆盖旧任务」导致的空跑浪费；
- 批量建议：一次推理最多产出 3 条建议，覆盖标题/议题、观点、关键数据、待办等类型，
  再逐个去重、价值门控后发出；
- 新鲜度优先：任务超时/取消/会话停止后，旧结果直接丢弃；
- Meeting State 与 Raw Transcript 分离：事实校对仍以原始字幕为准。
"""

import json
import re
import threading
import time
from difflib import SequenceMatcher
from uuid import uuid4

from .transcript import clock
from .worker_common import require

# —— 实时推理预算（CPU 优先）——
REALTIME_MAX_TOKENS = 160
REALTIME_TIMEOUT_SECONDS = 40.0
# 中文约 1.8 字符/token、英文约 4 字符/token：窗口按语言分别收紧，
# 让内置模型（2B~4B）在 CPU 上的单次分析保持在数秒到十余秒量级。
MEETING_STATE_MAX_CHARS = 420          # 压缩会议状态（长记忆）
RECENT_TRANSCRIPT_CHARS = {"zh": 450, "en": 900}
REALTIME_RECENT_SEGMENTS = {"zh": 5, "en": 8}
USER_PARAGRAPH_CHARS = 80
MAX_RECENT_SEGMENTS = 200
MAX_SUGGESTION_HISTORY = 24
MAX_SUGGESTIONS_PER_CALL = 3

# —— 分析节奏（频次降低、质量保证）——
ANALYSIS_MIN_INTERVAL_AUTO = 16.0      # 「自动」档：两次分析的最短间隔
ANALYSIS_MIN_INTERVAL_ASSIST = 30.0    # 「辅助」档：两次分析的最短间隔
ASSIST_MIN_NEW_CHARS = 90              # 辅助档：无关键词时也触发的新增字数
AUTO_MIN_NEW_CHARS = 20                # 自动档：触发所需的最少新增字数
SUGGESTION_EMIT_GAP_SECONDS = 0.6      # 同批建议逐条发出时的间隔
_STATE_ENTRY_MAX = 34                  # 会议状态单条的最长长度（折叠压缩用）

# —— 轻量检测触发信号（不依赖 LLM）——
_DECISION_WORDS = (
    "决定", "确认", "定了", "结论", "敲定", "就这么", "拍板", "一致同意",
    "finaliz", "decided", "decide", "confirm", "agreed", "decision",
)
_ACTION_WORDS = (
    "下一步", "负责", "跟进", "待办", "行动", "分配", "安排", "落实",
    "action", "todo", "assigned", "owner", "due", "follow up", "follow-up",
)
_RISK_WORDS = (
    "风险", "隐患", "担心", "可能出", "风险点", "瓶颈", "挑战", "困难",
    "risk", "blocker", "blocked", "concern", "issue", "challenge",
)
_QUESTION_WORDS = ("?", "？", "怎么", "为什么", "是否", "什么时候", "多少", "能不能", "何时", "如何", "how", "why", "when", "whether")
_TOPIC_MARKERS = (
    "接下来", "我们换", "下一个议题", "回到", "先看", "现在讨论", "下一个", "下面",
    "move on", "next topic", "switch", "next",
)
_INTRO_MARKERS = (
    "本期", "这期", "今天", "欢迎收听", "欢迎来到", "我们来聊", "我们聊聊", "我们讨论",
    "welcome", "in this episode", "today we", "let's talk", "we're going to", "we are going to",
)
_NUMBER_RE = re.compile(
    r"\d+(?:\.\d+)?%?"
    r"|百分之[零一二三四五六七八九十百千万两]+"
    r"|[零一二三四五六七八九十百千万亿两]{2,}\s*[%％]?"
)
_DATE_RE = re.compile(r"\d{1,4}[年/.\-]\d{1,2}(?:[月/.\-]\d{1,2})?|周[一二三四五六日天]")

# 模型输出里需要规范化的类型别名，统一映射到前端可识别的 type。
_TYPE_ALIASES = {
    "conclusion": "conclusion", "结论": "conclusion", "观点": "conclusion",
    "decision": "decision", "决策": "decision", "决定": "decision",
    "action": "action", "action_item": "action", "todo": "action", "待办": "action", "行动": "action",
    "number": "number", "数字": "number", "数据": "number",
    "date": "date", "日期": "date",
    "question": "question", "待确认": "question", "疑问": "question",
    "risk": "risk", "风险": "risk",
    "topic": "topic", "议题": "topic", "标题": "topic", "新话题": "topic",
    "supplement": "supplement", "补充": "supplement", "重点": "supplement",
}
_ALLOWED_TYPES = {"conclusion", "decision", "action", "number", "date", "question", "risk", "topic", "supplement"}

# 低价值/泛泛文本的启发式过滤。
_META_WORDS = (
    "本期", "这期", "本次", "本场", "播客", "节目", "会议", "讨论", "话题",
    "聊聊", "聊了", "讲述了", "主题是", "相关", "内容", "问题",
    "episode", "podcast", "discussion", "talk about", "topic", "show", "conversation about",
)
_TOPIC_GENERIC_RE = re.compile(
    r"^(?:本期|这期|本次|本场|今天|关于|on|about|in this|the (?:topic|subject) of)\b"
    r"|(?:的话题|的讨论|相关话题|有关问题|related topic|discussion about|talk about)\s*$",
    re.IGNORECASE,
)


class MeetingState:
    """压缩的会议工作记忆：短条目、去重、有界。与原始字幕分离。"""

    def __init__(self):
        self.lock = threading.Lock()
        self.topic = ""
        self.facts = []
        self.decisions = []
        self.actions = []
        self.open_questions = []

    def snapshot(self):
        with self.lock:
            return {
                "topic": self.topic,
                "facts": list(self.facts[-4:]),
                "decisions": list(self.decisions[-3:]),
                "actions": list(self.actions[-3:]),
                "open_questions": list(self.open_questions[-3:]),
            }

    def all_entries(self):
        """返回全部条目（用于「不重复已记录内容」的去重检查）。"""
        with self.lock:
            return (
                [self.topic] if self.topic else []
            ) + self.facts + self.decisions + self.actions + self.open_questions

    def to_prompt(self):
        snapshot = self.snapshot()
        lines = []
        if snapshot["topic"]:
            lines.append(f"当前议题：{snapshot['topic']}")
        if snapshot["facts"]:
            lines.append("事实：" + "；".join(snapshot["facts"]))
        if snapshot["decisions"]:
            lines.append("已确认决定：" + "；".join(snapshot["decisions"]))
        if snapshot["actions"]:
            lines.append("行动项：" + "；".join(snapshot["actions"]))
        if snapshot["open_questions"]:
            lines.append("待确认：" + "；".join(snapshot["open_questions"]))
        return "\n".join(lines)


class _AiNoteSession:
    """单场会议的 AI 辅助状态与单飞去抖调度器。"""

    def __init__(self, meeting_id, connection, proactivity, language):
        self.meeting_id = meeting_id
        self.language = language or "zh"
        self.connection = connection
        self.proactivity = proactivity or "assist"
        self.meeting_state = MeetingState()
        self.recent_segments = []
        self.user_typing = False
        self.user_paragraph = ""
        # 单飞去抖调度状态
        self.cond = threading.Condition()
        self.stopped = False
        self.running = False
        self.generation = 0            # 仅在取消/停止时递增：让在飞结果过期
        self.content_version = 0       # 新内容版本号（每段字幕/停笔 +1）
        self.analyzed_version = 0      # 已覆盖的内容版本（分析开始时快照）
        self.pending_chars = 0         # 自上次分析以来新增的字数
        self.last_run_at = 0.0         # 上次分析开始时间（monotonic）
        self.typing_trigger = False    # 停笔触发的分析（quiet 档也允许）
        self.thread = None
        # 去重 / 质量
        self.recent_norms = []
        self.seen_topic_norms = set()
        self.dismissed_norms = set()


class AiNoteWorkerMixin:
    """实时 AI 辅助笔记：接收字幕事件，按单飞去抖调度产出批量短建议。"""

    def __init__(self):
        super().__init__()
        self._ai_note_sessions = {}
        self._ai_note_lock = threading.Lock()

    # —— 命令入口（在 worker_core.handle 注册）——

    def ai_note_start(self, payload):
        """初始化（或重置）某场会议的 AI 辅助引擎并启动调度线程。"""
        require(payload, "meeting_id", "provider", "model")
        if (payload.get("provider") or "").lower() not in {"built-in", "builtin"}:
            require(payload, "endpoint")
        meeting_id = payload["meeting_id"]
        connection = {
            "provider": payload["provider"],
            "endpoint": payload.get("endpoint", ""),
            "model": payload["model"],
            "api_key": payload.get("api_key", ""),
            "format": payload.get("format", "openai"),
        }
        session = _AiNoteSession(
            meeting_id,
            connection,
            payload.get("proactivity", "assist"),
            payload.get("language", "zh"),
        )
        previous = None
        with self._ai_note_lock:
            previous = self._ai_note_sessions.get(meeting_id)
            if previous:
                previous.stopped = True
                with previous.cond:
                    previous.cond.notify_all()
            self._ai_note_sessions[meeting_id] = session
        if previous:
            # 旧的调度线程可能正卡在一次推理上：立即终止，避免占用共享 sidecar。
            self.cancel_sidecar("ai-note")
        session.thread = threading.Thread(
            target=self._scheduler_loop,
            args=(session,),
            name=f"brevia-ai-note-{meeting_id[:8]}",
            daemon=True,
        )
        session.thread.start()
        return {"started": True}

    def ai_note_stop(self, payload):
        """停止某场会议的 AI 辅助引擎（取消在飞推理并结束调度线程）。"""
        meeting_id = payload.get("meeting_id")
        with self._ai_note_lock:
            session = self._ai_note_sessions.pop(meeting_id, None)
        if not session:
            return {"stopped": False}
        self._cancel_session(session)
        return {"stopped": True}

    def ai_note_typing(self, payload):
        """更新输入状态：打字中取消在飞推理；停笔后保持静默。"""
        meeting_id = payload.get("meeting_id")
        session = self._session(meeting_id)
        if not session:
            return {"ok": False}
        typing = bool(payload.get("typing"))
        cancel_inflight = False
        with session.cond:
            session.user_typing = typing
            if payload.get("notes") is not None:
                session.user_paragraph = str(payload["notes"])[-USER_PARAGRAPH_CHARS:]
            if typing:
                # 陪写模式：取消在飞任务，保持静默。
                session.generation += 1
                # 仅在确有在飞推理时杀掉 sidecar；空闲但已加载模型的进程保留，
                # 避免每敲一次键都触发 GGUF 冷启动（CPU 上重载需数秒到数十秒）。
                cancel_inflight = session.running
                session.cond.notify_all()
            else:
                session.cond.notify_all()
        if cancel_inflight:
            self.cancel_sidecar("ai-note")
        return {"ok": True}

    def ai_note_request(self, payload):
        """由用户显式请求一轮建议；这是 quiet 档唯一的推理入口。"""
        session = self._session(payload.get("meeting_id"))
        if not session:
            return {"ok": False}
        with session.cond:
            if payload.get("notes") is not None:
                session.user_paragraph = str(payload["notes"])[-USER_PARAGRAPH_CHARS:]
            session.typing_trigger = True
            session.content_version += 1
            session.cond.notify_all()
        return {"ok": True}

    def ai_note_dismiss(self, payload):
        """记录已忽略/已接受的建议，用于后续去重。"""
        session = self._session(payload.get("meeting_id"))
        if not session:
            return {"ok": False}
        norm = _normalize(payload.get("text") or "")
        if norm:
            session.dismissed_norms.add(norm)
        return {"ok": True}

    def shutdown_ai_note(self):
        """应用退出时停止全部 AI 辅助会话。"""
        with self._ai_note_lock:
            sessions = list(self._ai_note_sessions.values())
            self._ai_note_sessions.clear()
        for session in sessions:
            self._cancel_session(session)

    # —— 字幕事件钩子（worker_session 调用，必须非阻塞且快速）——

    def ai_note_on_segment(self, event):
        """喂入一条 final 字幕：入窗、折叠进状态、标记新内容（不在这里触发推理）。

        即使 quiet 档也照常缓冲，保证用户主动提问/停笔时有可用的上下文。
        """
        session = self._session(event.get("meeting_id"))
        if not session:
            return
        text = str(event.get("text") or "")
        with session.cond:
            session.recent_segments.append(
                {
                    "text": text,
                    "start_ms": int(event.get("start_ms") or 0),
                    "speaker": event.get("speaker") or "spk-1",
                }
            )
            if len(session.recent_segments) > MAX_RECENT_SEGMENTS:
                session.recent_segments = session.recent_segments[-MAX_RECENT_SEGMENTS:]
            self._fold_into_state(session, session.recent_segments[-1])
            session.pending_chars += len(text)
            session.content_version += 1
            session.cond.notify_all()

    # —— 内部实现 ——

    def _session(self, meeting_id):
        with self._ai_note_lock:
            return self._ai_note_sessions.get(meeting_id)

    def _cancel_session(self, session):
        """请求停止：标记停止、使在飞任务过期并取消内置 sidecar。"""
        with session.cond:
            session.stopped = True
            session.generation += 1
            session.cond.notify_all()
        self.cancel_sidecar("ai-note")

    def _scheduler_loop(self, session):
        """单飞去抖调度：一次只运行一个推理，新内容合并到下一轮，绝不打断在飞任务。"""
        while True:
            with session.cond:
                while not session.stopped and not self._should_analyze(session):
                    session.cond.wait(timeout=1.0)
                if session.stopped:
                    return
                task_generation = session.generation
                task_version = session.content_version
                task_pending_chars = session.pending_chars
                session.running = True
                if session.proactivity == "quiet":
                    session.typing_trigger = False
            try:
                self.emit("ai-note.analyzing", {"meeting_id": session.meeting_id, "active": True})
                batch = self._analyze_realtime(session, task_generation)
            finally:
                self.emit("ai-note.analyzing", {"meeting_id": session.meeting_id, "active": False})
                with session.cond:
                    session.running = False
                    # 取消/停止轮次的结果被丢弃，内容仍未覆盖：不推进 analyzed_version，
                    # 也不扣除 pending_chars，让该段内容在后续轮次继续触发分析。
                    if session.generation == task_generation and not session.stopped:
                        # 只标记「分析开始那一刻」已覆盖的内容；期间新到的内容保留到下一轮。
                        session.analyzed_version = max(session.analyzed_version, task_version)
                        session.pending_chars = max(0, session.pending_chars - task_pending_chars)
                    session.last_run_at = time.monotonic()
                    session.cond.notify_all()
            if batch:
                self._emit_suggestions(session, batch)

    def _should_analyze(self, session):
        """调度门控：有新内容、过了最小间隔、且满足该档位的触发条件。"""
        if session.stopped or session.running or session.user_typing:
            return False
        if session.content_version <= session.analyzed_version:
            return False
        if session.proactivity == "quiet":
            return session.typing_trigger
        interval = (
            ANALYSIS_MIN_INTERVAL_AUTO
            if session.proactivity == "auto"
            else ANALYSIS_MIN_INTERVAL_ASSIST
        )
        if time.monotonic() - session.last_run_at < interval:
            return False
        if session.proactivity == "auto":
            return session.pending_chars >= AUTO_MIN_NEW_CHARS
        # 辅助档：轻量关键词命中，或积累了足够的新内容（长独白播客也能触发）。
        return self._lightweight_trigger(session) or session.pending_chars >= ASSIST_MIN_NEW_CHARS

    def _analyze_realtime(self, session, task_generation):
        """执行一次实时分析；超时/取消/过期都返回空列表。"""
        prompt = self._realtime_prompt(session)
        try:
            raw = self._ai_note_complete(session, prompt)
        except Exception:
            # 内置模型超时/被取消、在线请求失败等：Best Effort，静默丢弃。
            return []
        if session.stopped or session.generation != task_generation:
            return []
        accepted = []
        for item in self._parse_suggestions(raw):
            if not self._accept_suggestion(session, item):
                continue
            norm = _normalize(item["text"])
            if item["type"] == "topic":
                session.seen_topic_norms.add(norm)
            session.recent_norms.append(norm)
            session.recent_norms = session.recent_norms[-MAX_SUGGESTION_HISTORY:]
            accepted.append(item)
        return accepted

    def _accept_suggestion(self, session, item):
        """价值门控 + 去重：泛泛文本、重复内容、类型不符都丢弃。"""
        text = item.get("text") or ""
        if len(text.strip()) < 6:
            return False
        if _is_generic_text(text):
            return False
        if not _type_gate(item):
            return False
        if item["type"] == "topic" and _is_generic_topic(text):
            return False
        # 列表式/注水式文本：一句话不该有 3 个以上逗号分句（多为模型补全）。
        if item["type"] in ("action", "supplement") and (text.count("，") + text.count(",") >= 3):
            return False
        if self._matches_state(session, text):
            return False
        norm = _normalize(text)
        if not norm:
            return False
        if norm in session.recent_norms or norm in session.dismissed_norms:
            return False
        if self._fuzzy_duplicate(session.recent_norms, norm):
            return False
        if item["type"] == "topic" and norm in session.seen_topic_norms:
            return False
        return True

    @staticmethod
    def _fuzzy_duplicate(norms, norm):
        """近义重复检测：与最近建议的归一化文本相似度过高则视为重复。"""
        for previous in norms[-12:]:
            if SequenceMatcher(None, previous, norm).ratio() >= 0.85:
                return True
        return False

    def _matches_state(self, session, text):
        """建议内容是否已几乎原样落在会议状态里（模型偷懒复述状态时丢弃）。"""
        norm = _normalize(text)
        if not norm:
            return True
        for entry in session.meeting_state.all_entries():
            entry_norm = _normalize(entry)
            if entry_norm and SequenceMatcher(None, entry_norm, norm).ratio() >= 0.92:
                return True
        return False

    def _realtime_prompt(self, session):
        state = session.meeting_state.to_prompt()[:MEETING_STATE_MAX_CHARS]
        lang = session.language if session.language in RECENT_TRANSCRIPT_CHARS else "en"
        recent = "\n".join(
            f"[{clock(segment['start_ms'])}] {segment['text']}"
            for segment in session.recent_segments[-REALTIME_RECENT_SEGMENTS[lang]:]
        )[:RECENT_TRANSCRIPT_CHARS[lang]]
        user = session.user_paragraph[:USER_PARAGRAPH_CHARS]
        if session.language == "zh":
            instructions = (
                "你是会议实时笔记助手。从「最近字幕」和「会议状态」中挑最多3条值得记录的短信息，输出极短 JSON。\n"
                "只使用字幕里明确出现的内容，不补全、不推测、不写空话；不重复会议状态已有的内容。\n"
                "类型：conclusion观点 | decision决定 | action待办 | number关键数据 | date关键日期 | "
                "question待确认 | risk风险 | topic新议题/标题 | supplement重点。\n"
                "整体议题/节目主题明确时（尤其开头）优先输出一条 topic 作标题候选：2-12字具体名词短语，"
                "禁止「本期播客将讨论…话题」式泛标题。\n"
                "number/date 必须原文出现；number 要带主语背景（如「家具制造业利润仅5.36%」），不能只写数字。\n"
                '输出 {"suggestions":[{"type":"...","text":"8-40字","importance":"high|medium"}]}；'
                '无价值输出 {"suggestions":[]}。只输出 JSON。'
            )
        else:
            instructions = (
                "You are a realtime meeting-notes assistant. From the <recent_transcript> and "
                "<meeting_state>, pick up to 3 short pieces worth capturing; output compact JSON. "
                "Use only what is explicitly said; do not infer, pad, or repeat state items.\n"
                "Types: conclusion | decision | action | number | date | question | risk | topic "
                "(new topic/title) | supplement (noteworthy point).\n"
                "When a clear overall topic/show title appears (especially the opening), prefer one "
                "topic item as a title candidate: a specific 2-10 word noun phrase, never "
                "\"In this episode we discuss...\".\n"
                "number/date must match explicit figures; a number item must carry subject and "
                "context (e.g. \"furniture makers' margin is only 5.36%\"), never a bare figure.\n"
                'Output {"suggestions":[{"type":"...","text":"one short sentence",'
                '"importance":"high|medium"}]}; output {"suggestions":[]} if nothing is valuable. '
                "Output only JSON."
            )
        return (
            f"{instructions}\n\n"
            f"<meeting_state>\n{state or '(empty)'}\n</meeting_state>\n\n"
            f"<recent_transcript>\n{recent or '(empty)'}\n</recent_transcript>\n\n"
            f"<user_note>\n{user or '(empty)'}\n</user_note>"
        )

    def _ai_note_complete(self, session, prompt):
        """把补全路由到内置 ``ai-note`` sidecar 或共享 HTTP 客户端。"""
        payload = session.connection
        if (payload.get("provider") or "").lower() in {"built-in", "builtin"}:
            return self.llama_generate_realtime(payload["model"], prompt)
        return self.llm_complete(
            {**payload, "timeout": int(REALTIME_TIMEOUT_SECONDS)},
            prompt,
        )

    def _parse_suggestions(self, raw):
        """解析模型输出为规范化建议列表（支持批量 JSON 与旧版单条 JSON）。"""
        text = str(raw or "").strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
        data = _extract_json(text)
        if isinstance(data, dict):
            items = data.get("suggestions")
            if not isinstance(items, list):
                # 旧版单条输出：{"type":..., "text":...}
                items = [data] if data.get("type") else []
        elif isinstance(data, list):
            items = data
        else:
            return []
        result = []
        for item in items[:MAX_SUGGESTIONS_PER_CALL]:
            if not isinstance(item, dict):
                continue
            raw_type = str(item.get("type") or "").strip().lower()
            if raw_type in ("none", "", "null"):
                continue
            suggestion_type = _TYPE_ALIASES.get(raw_type, raw_type)
            if suggestion_type not in _ALLOWED_TYPES:
                continue
            suggestion_text = str(item.get("text") or item.get("suggestion") or "").strip()
            if not suggestion_text:
                continue
            result.append(
                {
                    "type": suggestion_type,
                    "text": suggestion_text[:64],
                    "importance": str(item.get("importance") or "medium"),
                }
            )
        return result

    def _emit_suggestions(self, session, batch):
        """逐条发出批量建议（会话已停止则中断）。"""
        for index, suggestion in enumerate(batch):
            with session.cond:
                if session.stopped:
                    break
            if index:
                time.sleep(SUGGESTION_EMIT_GAP_SECONDS)
            self._emit_suggestion(session, suggestion)

    def _emit_suggestion(self, session, suggestion):
        self.emit(
            "ai-note.suggestion",
            {
                "meeting_id": session.meeting_id,
                "id": str(uuid4()),
                "type": suggestion["type"],
                "text": suggestion["text"],
                "importance": suggestion.get("importance", "medium"),
            },
        )

    @staticmethod
    def _lightweight_trigger(session):
        """本地规则判断新到内容是否值得调用 LLM（关键词命中）。"""
        recent = session.recent_segments[-4:]
        if not recent:
            return False
        text = " ".join(segment["text"] for segment in recent)
        lowered = text.lower()
        if _NUMBER_RE.search(text) or _DATE_RE.search(text):
            return True
        if any(word.lower() in lowered for word in _DECISION_WORDS):
            return True
        if any(word.lower() in lowered for word in _ACTION_WORDS):
            return True
        if any(word.lower() in lowered for word in _RISK_WORDS):
            return True
        if any(word.lower() in lowered for word in _QUESTION_WORDS):
            return True
        if any(marker.lower() in lowered for marker in _TOPIC_MARKERS):
            return True
        if any(marker.lower() in lowered for marker in _INTRO_MARKERS):
            return True
        return False

    @staticmethod
    def _compress_entry(text):
        """压缩一条会议状态条目：去空白、去句末标点、限长。"""
        text = re.sub(r"\s+", "", str(text or "")).strip("，。！？!?；;：:、")
        return text[:_STATE_ENTRY_MAX]

    @staticmethod
    def _state_append(items, entry):
        """带近义去重地追加状态条目，保持有界。"""
        if not entry:
            return
        for existing in items[-6:]:
            if SequenceMatcher(None, _normalize(existing), _normalize(entry)).ratio() >= 0.85:
                return
        items.append(entry)

    @staticmethod
    def _fold_into_state(session, segment):
        """规则化地把一条字幕折叠进 MeetingState（无 LLM，代价极低）。

        一条字幕只落一个列表（优先级：决定 > 行动 > 待确认 > 事实），
        避免同一条内容在多个列表里重复出现、撑爆 prompt。
        """
        text = str(segment.get("text") or "").strip()
        if not text:
            return
        state = session.meeting_state
        lowered = text.lower()
        with state.lock:
            entry = AiNoteWorkerMixin._compress_entry(text)
            if any(word.lower() in lowered for word in _DECISION_WORDS):
                AiNoteWorkerMixin._state_append(state.decisions, entry)
            elif any(word.lower() in lowered for word in _ACTION_WORDS):
                AiNoteWorkerMixin._state_append(state.actions, entry)
            elif any(word.lower() in lowered for word in _QUESTION_WORDS):
                AiNoteWorkerMixin._state_append(state.open_questions, entry)
            elif _NUMBER_RE.search(text) or _DATE_RE.search(text):
                AiNoteWorkerMixin._state_append(state.facts, entry)
            if any(marker.lower() in lowered for marker in _TOPIC_MARKERS) or any(
                marker.lower() in lowered for marker in _INTRO_MARKERS
            ):
                state.topic = AiNoteWorkerMixin._compress_entry(text)
            state.facts = state.facts[-4:]
            state.decisions = state.decisions[-3:]
            state.actions = state.actions[-3:]
            state.open_questions = state.open_questions[-3:]

def _is_generic_text(text):
    """泛泛/空话文本检测：含 >=2 个元词，或整句没有具体内容。"""
    t = _normalize(text)
    if len(t) < 6:
        return True
    lowered = text.lower()
    hits = sum(1 for word in _META_WORDS if word in lowered)
    return hits >= 2


def _is_generic_topic(text):
    """议题/标题门控：必须是具体名词短语，不得是「本期播客将讨论…」式泛标题。"""
    if len(text.strip()) < 4:
        return True
    lowered = text.lower()
    hits = sum(1 for word in _META_WORDS if word in lowered)
    if hits >= 2:
        return True
    return bool(_TOPIC_GENERIC_RE.search(text))


def _type_gate(item):
    """类型一致性门控：number 必须有数字且带主语背景，date 必须有日期痕迹。"""
    suggestion_type = item.get("type")
    text = item.get("text") or ""
    if suggestion_type == "number":
        if not _NUMBER_RE.search(text):
            return False
        # 去掉数字/单位后至少要有 4 个“上下文”字符，拒绝「2769.17亿」这类裸数字。
        return _number_context_len(text) >= 4
    if suggestion_type == "date":
        return bool(_DATE_RE.search(text))
    return True


def _number_context_len(text):
    """去掉数字、常见单位与标点后剩余的上下文字符数。"""
    stripped = re.sub(
        r"[0-9０-９.．%％年月日时分秒个点万亿千百十亿块元角分号]"
        r"|[\s,，。；;：:、\-/()（）【】]",
        "",
        text,
    )
    return len(stripped)


def _extract_json(text):
    """从模型输出中提取 JSON 对象或数组；失败返回 None。"""
    value = str(text or "").strip()
    value = re.sub(r"^```(?:json)?\s*|\s*```$", "", value, flags=re.MULTILINE).strip()
    try:
        data = json.loads(value)
        if isinstance(data, (dict, list)):
            return data
    except Exception:
        pass
    match = re.search(r"[\[{].*[\]]}", value, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
        return data if isinstance(data, (dict, list)) else None
    except Exception:
        return None


def _normalize(value):
    """文本归一化，用于建议去重。"""
    return re.sub(r"[\s\W_]+", "", str(value or "").lower())
