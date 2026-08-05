"""Focused worker responsibility component."""

import threading
import time

from .asr import (
    DownloadCancelled,
)
from .config import SETTINGS
from .worker_common import require


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
        self.emit("model.status", {"model_id": model_id, "status": "cancelled"})
        return {"model_id": model_id, "status": "cancelled"}

    def begin_task(self, task, meeting_id):
        return self.tasks.begin(task, meeting_id)

    def wait_task(self, control):
        while control.is_set():
            time.sleep(0.1)

    def finish_task(self, task, meeting_id, control=None):
        self.tasks.finish(task, meeting_id, control)

    def set_task_pause(self, payload, paused):
        require(payload, "task", "meeting_id")
        key = (payload["task"], payload["meeting_id"])
        self.tasks.set_paused(*key, paused)
        status = "paused" if paused else "running"
        self.emit(
            "task.status", {"task": key[0], "meeting_id": key[1], "status": status}
        )
        return {"task": key[0], "meeting_id": key[1], "status": status}

    def pause_task(self, payload):
        return self.set_task_pause(payload, True)

    def resume_task(self, payload):
        return self.set_task_pause(payload, False)

    def _download_model(self, model_id, control, china_source=False):
        """下载模型并将最终状态作为异步事件发送。"""
        try:
            if china_source:
                self.models.download(model_id, control, china_source=True)
            else:
                self.models.download(model_id, control)
            if model_id == SETTINGS["diarization"]["embedding_model_id"]:
                try:
                    self.voice_profiles.seed_builtin_profiles()
                    self.emit(
                        "speaker-profile.updated",
                        {"profiles": self.store.list_speaker_profiles()},
                    )
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "code": "builtin_voiceprints_unavailable",
                            "message": str(error),
                        },
                    )
        except DownloadCancelled:
            pass
        except Exception as error:
            self.emit(
                "model.status",
                {"model_id": model_id, "status": "failed", "error": str(error)},
            )
        finally:
            with self.model_downloads_lock:
                self.model_downloads.pop(model_id, None)

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
