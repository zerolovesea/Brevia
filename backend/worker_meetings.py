"""聚焦的 worker 职责组件。"""

import time

from .worker_common import require, synchronized_recording


class MeetingCommandMixin:
    def update_meeting(self, payload):
        """更新会议的可编辑元数据并返回最新详情。"""
        require(payload, "meeting_id", "updates")
        return self.store.update_meeting(payload["meeting_id"], payload["updates"])

    def _cancel_meeting_tasks(self, meeting_id, timeout=3.0):
        """取消该会议的后台任务并短暂等待其在检查点停止。

        删除会议不再要求用户等精修/纪要跑完：先请求取消，再等任务在下一个安全
        检查点退出（通常 <1s，最长 ``timeout``），随后即可安全删除。
        """
        self.tasks.cancel_for_meeting(meeting_id)
        deadline = time.monotonic() + timeout
        while self.tasks.has_for_meeting(meeting_id) and time.monotonic() < deadline:
            time.sleep(0.05)

    @synchronized_recording
    def delete_meeting(self, payload):
        """删除非活动会议。

        普通会议进入最近删除；示例会议由存储层永久删除以立即释放空间。
        若会议有正在运行的后台任务，先请求取消再删除，不再阻塞用户。
        """
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        if self.tasks.has_for_meeting(payload["meeting_id"]):
            self._cancel_meeting_tasks(payload["meeting_id"])
        self.store.soft_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "deleted": True}

    def clear_storage(self, payload):
        """清理本地分区；录制期间保留会议文件以避免损坏当前会话。"""
        if payload["partition"] == "meetings" and self.active:
            raise ValueError("Stop the active meeting before clearing meeting data")
        if payload["partition"] == "meetings" and self.tasks.has_any():
            raise ValueError("Wait for background tasks to finish before clearing meeting data")
        return self.store.clear_storage_partition(payload["partition"])

    def restore_meeting(self, payload):
        """恢复软删除会议并返回完整详情。"""
        require(payload, "meeting_id")
        self.store.soft_delete(payload["meeting_id"], restore=True)
        return self.store.get_meeting(payload["meeting_id"])

    @synchronized_recording
    def purge_meeting(self, payload):
        """永久删除最近删除中的会议及其全部本地文件。"""
        require(payload, "meeting_id")
        if payload["meeting_id"] == self.active:
            raise ValueError("Stop the active meeting before deleting it")
        if self.tasks.has_for_meeting(payload["meeting_id"]):
            self._cancel_meeting_tasks(payload["meeting_id"], timeout=5.0)
        self.store.permanent_delete(payload["meeting_id"])
        return {"meeting_id": payload["meeting_id"], "purged": True}
