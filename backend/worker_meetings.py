"""Focused worker responsibility component."""

from .worker_common import require


class MeetingCommandMixin:
    def update_meeting(self, payload):
        """更新会议的可编辑元数据并返回最新详情。"""
        require(payload, "meeting_id", "updates")
        return self.store.update_meeting(payload["meeting_id"], payload["updates"])

    def delete_meeting(self, payload):
        """删除非活动会议。

        普通会议进入最近删除；示例会议由存储层永久删除以立即释放空间。
        """
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        self.store.soft_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "deleted": True}

    def clear_storage(self, payload):
        """清理本地分区；录制期间保留会议文件以避免损坏当前会话。"""
        if payload["partition"] == "meetings" and self.active:
            raise ValueError("Stop the active meeting before clearing meeting data")
        return self.store.clear_storage_partition(payload["partition"])

    def restore_meeting(self, payload):
        """恢复软删除会议并返回完整详情。"""
        require(payload, "meeting_id")
        self.store.soft_delete(payload["meeting_id"], restore=True)
        return self.store.get_meeting(payload["meeting_id"])

    def purge_meeting(self, payload):
        """永久删除最近删除中的会议及其全部本地文件。"""
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        self.store.permanent_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "purged": True}
