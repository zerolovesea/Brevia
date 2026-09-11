"""聚焦的 worker 职责组件。"""

from .worker_common import require


class TranscriptCommandMixin:
    def save_segment_texts(self, payload):
        """保存人工修正后的字幕文本，并返回最新会议详情。

        界面一次「保存」可能改动了多句字幕，因此按批量提交：写入是原子的，
        也不会因逐句往返触发命令限流。
        """
        require(payload, "meeting_id", "segments")
        edits = payload["segments"]
        if not isinstance(edits, list) or not edits:
            raise ValueError("Nothing to save")
        for edit in edits:
            require(edit, "segment_id", "text")
        self.store.save_segment_texts(payload["meeting_id"], edits)
        return self.store.get_meeting(payload["meeting_id"], compact=True)
