"""聚焦的 worker 职责组件。"""

import threading
import time

from .asr import (
    DownloadCancelled,
)
from .worker_common import TaskCancelled, require


class ModelTaskWorkerMixin:
    def download_model(self, payload):
        """启动指定模型的后台下载，并立即返回其状态。"""
        require(payload, "model_id")
        model_id = payload["model_id"]
        with self.model_downloads_lock:
            existing = self.model_downloads.get(model_id)
            if existing:
                if existing["paused"].is_set() and not existing["cancelled"].is_set():
                    existing["paused"].clear()
                    self.emit(
                        "model.status", {"model_id": model_id, "status": "downloading"}
                    )
                return {"model_id": model_id, "status": "downloading"}
            control = {"paused": threading.Event(), "cancelled": threading.Event()}
            task = threading.Thread(
                target=self._download_model,
                args=(model_id, control, payload.get("source") == "china"),
                daemon=True,
            )
            self.model_downloads[model_id] = {"task": task, **control}
            task.start()
        return {"model_id": model_id, "status": "downloading"}

    def pause_model(self, payload):
        """暂停活动下载；网络流会在下一次进度回调处停住。"""
        require(payload, "model_id")
        model_id = payload["model_id"]
        with self.model_downloads_lock:
            download = self.model_downloads.get(model_id)
            if not download or download["cancelled"].is_set():
                return {"model_id": model_id, "status": "not_downloading"}
            download["paused"].set()
        self.emit("model.status", {"model_id": model_id, "status": "paused"})
        return {"model_id": model_id, "status": "paused"}

    def cancel_model(self, payload):
        """取消活动下载，并在当前下载块完成后清理临时文件。"""
        require(payload, "model_id")
        model_id = payload["model_id"]
        with self.model_downloads_lock:
            download = self.model_downloads.get(model_id)
            if not download:
                raise ValueError("Model is not downloading")
            download["cancelled"].set()
            download["paused"].clear()
        return {"model_id": model_id, "status": "cancelling"}

    def begin_task(self, task, meeting_id):
        """开始一个任务并返回其控制事件。"""
        return self.tasks.begin(task, meeting_id)

    def wait_task(self, control):
        """等待任务控制事件解除暂停。"""
        while control.paused.is_set():
            if control.cancelled.is_set():
                raise TaskCancelled()
            time.sleep(0.1)
        if control.cancelled.is_set():
            raise TaskCancelled()

    def finish_task(self, task, meeting_id, control=None):
        """结束任务并释放其控制记录。"""
        self.tasks.finish(task, meeting_id, control)

    def set_task_pause(self, payload, paused):
        """设置任务暂停状态并发布状态事件。"""
        require(payload, "task", "meeting_id")
        key = (payload["task"], payload["meeting_id"])
        self.tasks.set_paused(*key, paused)
        status = "paused" if paused else "running"
        self.emit(
            "task.status", {"task": key[0], "meeting_id": key[1], "status": status}
        )
        return {"task": key[0], "meeting_id": key[1], "status": status}

    def pause_task(self, payload):
        """暂停长时运行任务。"""
        return self.set_task_pause(payload, True)

    def resume_task(self, payload):
        """恢复暂停的任务。"""
        return self.set_task_pause(payload, False)

    def cancel_task(self, payload):
        """请求运行中的任务取消，并发布状态事件。"""
        require(payload, "task", "meeting_id")
        self.tasks.cancel(payload["task"], payload["meeting_id"])
        self.emit(
            "task.status",
            {"task": payload["task"], "meeting_id": payload["meeting_id"], "status": "cancelling"},
        )
        return {"task": payload["task"], "meeting_id": payload["meeting_id"], "status": "cancelling"}

    def _download_model(self, model_id, control, china_source=False):
        """下载模型并将最终状态作为异步事件发送。"""
        completed = False
        acquired = False
        try:
            while not acquired:
                if control["cancelled"].is_set():
                    raise DownloadCancelled()
                acquired = self.model_download_slots.acquire(timeout=0.1)
            self.models.download(model_id, control, china_source=china_source)
            completed = True
        except DownloadCancelled:
            pass
        except Exception as error:
            self.emit(
                "model.status",
                {"model_id": model_id, "status": "failed", "error": str(error)},
            )
        finally:
            if acquired:
                self.model_download_slots.release()
            with self.model_downloads_lock:
                self.model_downloads.pop(model_id, None)
            if control["cancelled"].is_set() and not completed:
                self.emit(
                    "model.status", {"model_id": model_id, "status": "cancelled"}
                )

    def delete_model(self, payload):
        """删除模型；活动会议正在使用的实时模型不可删除。"""
        require(payload, "model_id")
        if (
            self.active
            and self.store.get_meeting(self.active)["streaming_model_id"]
            == payload["model_id"]
        ):
            raise ValueError("Cannot delete the model used by the active meeting")
        self.models.delete(payload["model_id"])
        return {"model_id": payload["model_id"], "deleted": True}
