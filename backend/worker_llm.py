"""Focused worker responsibility component."""

from .transcript import clock, latest_segments, parse_json_object, validate_summary
from .worker_common import managed_task, require


class LLMWorkerMixin:
    @managed_task("summary.generate")
    def summarize(self, payload, control=None):
        """把逐字稿发送到用户确认的 LLM，并保存可追溯纪要。

        Args:
            payload: 会议和模型连接信息，``consent`` 必须明确为真。

        Returns:
            通过结构及证据段落校验的纪要字典。

        解析失败时仍保存供应商原始响应，避免丢失排障依据。
        """
        require(payload, "meeting_id", "provider", "endpoint", "model", "consent")
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        self.emit(
            "summary.started",
            {
                "meeting_id": meeting["id"],
                "completed": 10,
                "total": 100,
                "stage": "准备逐字稿",
            },
        )
        segments = latest_segments(meeting["segments"])
        transcript = "\n".join(
            f"{item['id']} [{clock(item['start_ms'])}] {item['speaker_name']}: {item['text']}"
            for item in segments
        )
        schema = (
            '{"summary":"不超过120字","decisions":[{"text":"...","evidence_segment_ids":["..."]}],'
            '"action_items":[{"task":"...","owner":"...","due":null,'
            '"evidence_segment_ids":["..."]}],"open_questions":[]}'
        )
        instructions = (
            payload.get("prompt") or "提炼结论、决定、待办和风险；保留可追溯的来源。"
        ).strip()
        prompt = (
            f"{instructions}\n\n仅基于下方逐字稿生成会议纪要。"
            f"只输出符合此结构的 JSON：{schema}\n\n逐字稿：\n{transcript}"
        )
        try:
            self.wait_task(control)
            self.emit(
                "summary.progress",
                {
                    "meeting_id": meeting["id"],
                    "completed": 60,
                    "total": 100,
                    "stage": "正在调用纪要模型",
                },
            )
            raw = self.llm_complete(payload, prompt, json_mode=True)
            self.wait_task(control)
            data = parse_json_object(raw)
            validate_summary(data, {item["id"] for item in segments})
        except Exception as error:
            raw = locals().get("raw", str(error))
            self.store.save_summary(meeting["id"], None, raw)
            raise ValueError(
                f"Summary response was saved but could not be parsed: {error}"
            ) from error
        self.store.save_summary(meeting["id"], data, raw)
        self.emit(
            "summary.progress",
            {
                "meeting_id": meeting["id"],
                "completed": 100,
                "total": 100,
                "stage": "正在保存纪要",
            },
        )
        self.emit("summary.ready", {"meeting_id": meeting["id"], "summary": data})
        return data

    def translate(self, payload):
        """翻译一个已落库段落，并把结果写回所有同 ID 版本。

        Returns:
            可直接作为 ``translation.ready`` 事件发送的字典。
        """
        require(
            payload,
            "meeting_id",
            "segment_id",
            "target_language",
            "endpoint",
            "model",
            "consent",
        )
        if not payload["consent"]:
            raise ValueError("Transcript sharing was not confirmed")
        meeting = self.store.get_meeting(payload["meeting_id"])
        segment = next(
            (
                item
                for item in meeting["segments"]
                if item["id"] == payload["segment_id"]
            ),
            None,
        )
        # The final event can reach the renderer before an overlapping task has
        # committed its segment; preserve that event instead of dropping translation.
        if not segment and payload.get("segment"):
            self.store.save_segment(
                {
                    "meeting_id": meeting["id"],
                    "segment_id": payload["segment_id"],
                    **payload["segment"],
                }
            )
            meeting = self.store.get_meeting(meeting["id"])
            segment = next(
                (
                    item
                    for item in meeting["segments"]
                    if item["id"] == payload["segment_id"]
                ),
                None,
            )
        if not segment:
            raise ValueError("Transcript segment not found")
        translation = self.llm_complete(
            payload,
            f"Translate the following text to {payload['target_language']}. "
            f"Return only the translation.\n\n{segment['text']}",
        ).strip()
        self.store.save_translation(meeting["id"], segment["id"], translation)
        event = {
            "meeting_id": meeting["id"],
            "segment_id": segment["id"],
            "translation": translation,
        }
        self.emit("translation.ready", event)
        return event
