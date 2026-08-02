"""Thread-safe shared state and protocol helpers for worker components."""

import threading
from functools import wraps


SCHEMA_VERSION = 1


def require(payload, *names):
    missing = [name for name in names if name not in payload]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")


def synchronized_recording(method):
    """Serialize mutations of the active recording state."""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self.state.lock:
            return method(self, *args, **kwargs)

    return synchronized


def managed_task(task):
    """Register one long-running task and always release it after completion."""

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
    """Owns the active recording identity behind one re-entrant lock."""

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
        with self.lock:
            if meeting_id != self._active:
                raise ValueError("Meeting is not active")


class TaskRegistry:
    """Synchronizes pause controls and rejects duplicate long-running tasks."""

    def __init__(self):
        self._controls = {}
        self._lock = threading.Lock()

    def begin(self, task, meeting_id):
        key = (task, meeting_id)
        with self._lock:
            if key in self._controls:
                raise ValueError("Task is already running")
            control = threading.Event()
            self._controls[key] = control
            return control

    def finish(self, task, meeting_id, control=None):
        key = (task, meeting_id)
        with self._lock:
            if control is None or self._controls.get(key) is control:
                self._controls.pop(key, None)

    def set_paused(self, task, meeting_id, paused):
        key = (task, meeting_id)
        with self._lock:
            control = self._controls.get(key)
            if not control:
                raise ValueError("Task is not running")
            control.set() if paused else control.clear()
        return control
