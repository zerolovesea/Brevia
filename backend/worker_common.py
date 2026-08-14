"""工作组件的线程安全共享状态与协议辅助工具。"""

import threading
from functools import wraps


SCHEMA_VERSION = 1


class TaskCancelled(Exception):
    """任务在安全检查点收到取消请求。"""


class TaskControl:
    """长时任务的暂停与取消状态。"""

    def __init__(self):
        self.paused = threading.Event()
        self.cancelled = threading.Event()


def require(payload, *names):
    """检查 payload 必需字段，缺失时抛出 ValueError。"""
    missing = [name for name in names if name not in payload]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")


def synchronized_recording(method):
    """序列化活动录音状态的所有变更操作。"""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self.state.lock:
            return method(self, *args, **kwargs)

    return synchronized


def managed_task(task):
    """注册一个长时运行任务，并在完成后始终释放其注册记录。"""

    def decorate(method):
        @wraps(method)
        def managed(self, payload, *args, **kwargs):
            meeting_id = payload.get("meeting_id")
            if not meeting_id:
                return method(self, payload, *args, **kwargs)
            control = self.tasks.begin(task, meeting_id)
            try:
                return method(self, payload, control, *args, **kwargs)
            finally:
                self.tasks.finish(task, meeting_id, control)

        return managed

    return decorate


class WorkerState:
    """拥有活动录音标识，保护在一个可重入锁后。"""

    def __init__(self):
        self.lock = threading.RLock()
        self._active = None

    @property
    def active(self):
        with self.lock:
            return self._active

    @active.setter
    def active(self, meeting_id):
        with self.lock:
            self._active = meeting_id

    def require(self, meeting_id):
        """验证目标会议为当前活动会议。"""
        with self.lock:
            if meeting_id != self._active:
                raise ValueError("Meeting is not active")


class TaskRegistry:
    """同步暂停控制并拒绝重复的长时运行任务。"""

    def __init__(self):
        self._controls = {}
        self._lock = threading.Lock()

    def begin(self, task, meeting_id):
        """启动任务并返回其暂停控制事件；已运行时抛出异常。"""
        key = (task, meeting_id)
        with self._lock:
            if key in self._controls:
                raise ValueError("Task is already running")
            control = TaskControl()
            self._controls[key] = control
            return control

    def finish(self, task, meeting_id, control=None):
        """结束任务并移除其注册记录。"""
        key = (task, meeting_id)
        with self._lock:
            if control is None or self._controls.get(key) is control:
                self._controls.pop(key, None)

    def set_paused(self, task, meeting_id, paused):
        """设置任务的暂停状态并返回控制事件。"""
        key = (task, meeting_id)
        with self._lock:
            control = self._controls.get(key)
            if not control:
                raise ValueError("Task is not running")
            control.paused.set() if paused else control.paused.clear()
        return control

    def cancel(self, task, meeting_id):
        """请求运行中的任务在下一个安全检查点停止。"""
        key = (task, meeting_id)
        with self._lock:
            control = self._controls.get(key)
            if not control:
                raise ValueError("Task is not running")
            control.cancelled.set()
            control.paused.clear()
        return control
