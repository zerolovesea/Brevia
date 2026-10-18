"""创建时原子加入 Job 的分析进程；句柄仅由父端持有，父端消失即回收子树。"""

import ctypes
import math
import os
import subprocess
import sys
import time
from ctypes import wintypes


class BasicLimit(ctypes.Structure):
    _fields_ = [
        ("process_time", ctypes.c_int64),
        ("job_time", ctypes.c_int64),
        ("flags", wintypes.DWORD),
        ("minimum_working_set", ctypes.c_size_t),
        ("maximum_working_set", ctypes.c_size_t),
        ("active_processes", wintypes.DWORD),
        ("affinity", ctypes.c_size_t),
        ("priority", wintypes.DWORD),
        ("scheduling", wintypes.DWORD),
    ]


class ExtendedLimit(ctypes.Structure):
    _fields_ = [
        ("basic", BasicLimit),
        ("io", ctypes.c_uint64 * 6),
        ("process_memory", ctypes.c_size_t),
        ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t),
        ("peak_job_memory", ctypes.c_size_t),
    ]


class JobAccounting(ctypes.Structure):
    _fields_ = [
        ("times", ctypes.c_int64 * 4),
        ("page_faults", wintypes.DWORD),
        ("total_processes", wintypes.DWORD),
        ("active_processes", wintypes.DWORD),
        ("terminated_processes", wintypes.DWORD),
    ]


class StartupInfo(ctypes.Structure):
    _fields_ = [
        ("size", wintypes.DWORD),
        ("reserved", wintypes.LPWSTR),
        ("desktop", wintypes.LPWSTR),
        ("title", wintypes.LPWSTR),
        ("x", wintypes.DWORD),
        ("y", wintypes.DWORD),
        ("width", wintypes.DWORD),
        ("height", wintypes.DWORD),
        ("columns", wintypes.DWORD),
        ("rows", wintypes.DWORD),
        ("fill", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("show", wintypes.WORD),
        ("reserved_size", wintypes.WORD),
        ("reserved_data", ctypes.c_void_p),
        ("stdin", wintypes.HANDLE),
        ("stdout", wintypes.HANDLE),
        ("stderr", wintypes.HANDLE),
        ("attributes", ctypes.c_void_p),
    ]


class ProcessInfo(ctypes.Structure):
    _fields_ = [
        ("process", wintypes.HANDLE),
        ("thread", wintypes.HANDLE),
        ("pid", wintypes.DWORD),
        ("tid", wintypes.DWORD),
    ]


class WindowsJobProcess:
    """提供分析管道需要的 Popen 接口，并持有整个 Job 的退出凭据。"""

    def __init__(self):
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        pointer = ctypes.c_void_p
        size = ctypes.c_size_t
        signatures = {
            "CreateJobObjectW": ([pointer, wintypes.LPCWSTR], wintypes.HANDLE),
            "SetInformationJobObject": (
                [wintypes.HANDLE, ctypes.c_int, pointer, wintypes.DWORD],
                wintypes.BOOL,
            ),
            "QueryInformationJobObject": (
                [wintypes.HANDLE, ctypes.c_int, pointer, wintypes.DWORD, pointer],
                wintypes.BOOL,
            ),
            "TerminateJobObject": ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            "InitializeProcThreadAttributeList": (
                [pointer, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(size)],
                wintypes.BOOL,
            ),
            "UpdateProcThreadAttribute": (
                [pointer, wintypes.DWORD, size, pointer, size, pointer, pointer],
                wintypes.BOOL,
            ),
            "DeleteProcThreadAttributeList": ([pointer], None),
            "CreateProcessW": (
                [
                    pointer,
                    wintypes.LPWSTR,
                    pointer,
                    pointer,
                    wintypes.BOOL,
                    wintypes.DWORD,
                    pointer,
                    pointer,
                    ctypes.POINTER(StartupInfo),
                    ctypes.POINTER(ProcessInfo),
                ],
                wintypes.BOOL,
            ),
            "WaitForSingleObject": ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            "GetExitCodeProcess": (
                [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)],
                wintypes.BOOL,
            ),
            "CloseHandle": ([wintypes.HANDLE], wintypes.BOOL),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.kernel, name)
            function.argtypes, function.restype = arguments, result
        self.handle = None
        self.thread = None
        self.job = None
        self.pid = None
        self.returncode = None
        self.stdin = None
        self.stdout = None
        self.args = None

    def start(self, command, *, stderr=None, env=None):
        import msvcrt

        self.args = command
        if any("\0" in part for part in command):
            raise ValueError("Process arguments contain a null character")
        if env is not None and any(
            not key or "=" in key or "\0" in key or "\0" in value for key, value in env.items()
        ):
            raise ValueError("Invalid process environment")
        self.job = self.kernel.CreateJobObjectW(None, None)
        if not self.job:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimit()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(
            self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        descriptors = []
        attributes = None
        try:
            child_input, parent_input = os.pipe()
            descriptors.extend((child_input, parent_input))
            parent_output, child_output = os.pipe()
            descriptors.extend((parent_output, child_output))
            child_error = (
                os.open(os.devnull, os.O_WRONLY)
                if stderr == subprocess.DEVNULL
                else os.dup((stderr if stderr is not None else sys.stderr).fileno())
            )
            descriptors.append(child_error)
            self.stdin = os.fdopen(parent_input, "w", encoding="utf-8", buffering=1)
            descriptors.remove(parent_input)
            self.stdout = os.fdopen(parent_output, "r", encoding="utf-8")
            descriptors.remove(parent_output)
            handles = (wintypes.HANDLE * 3)(
                *(msvcrt.get_osfhandle(fd) for fd in (child_input, child_output, child_error))
            )
            for fd in (child_input, child_output, child_error):
                os.set_inheritable(fd, True)
            required = ctypes.c_size_t()
            self.kernel.InitializeProcThreadAttributeList(None, 2, 0, ctypes.byref(required))
            buffer = ctypes.create_string_buffer(required.value)
            if not self.kernel.InitializeProcThreadAttributeList(
                buffer, 2, 0, ctypes.byref(required)
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            attributes = buffer
            jobs = (wintypes.HANDLE * 1)(self.job)
            # JOB_LIST 在 CreateProcess 内生效；禁止先运行、再按 PID 加 Job 的保护空隙。
            # HANDLE_LIST 只继承独立管道，尤其不能继承 Job 及父端命令输入句柄。
            for key, value in ((0x20002, handles), (0x2000D, jobs)):
                if not self.kernel.UpdateProcThreadAttribute(
                    attributes, 0, key, value, ctypes.sizeof(value), None, None
                ):
                    raise ctypes.WinError(ctypes.get_last_error())
            startup = StartupInfo()
            startup.size = ctypes.sizeof(startup)
            startup.flags = 0x100  # STARTF_USESTDHANDLES
            startup.stdin, startup.stdout, startup.stderr = handles
            startup.attributes = ctypes.cast(attributes, ctypes.c_void_p)
            environment = None
            if env is not None:
                environment = ctypes.create_unicode_buffer(
                    "\0".join(
                        f"{key}={value}"
                        for key, value in sorted(env.items(), key=lambda row: row[0].upper())
                    )
                    + "\0"
                )
            info = ProcessInfo()
            if not self.kernel.CreateProcessW(
                None,
                ctypes.create_unicode_buffer(subprocess.list2cmdline(command)),
                None,
                None,
                True,
                0x80000 | 0x400,
                environment,
                None,
                ctypes.byref(startup),
                ctypes.byref(info),
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            self.handle, self.thread, self.pid = info.process, info.thread, info.pid
            if not self.kernel.CloseHandle(self.thread):
                raise ctypes.WinError(ctypes.get_last_error())
            self.thread = None
        finally:
            if attributes is not None:
                self.kernel.DeleteProcThreadAttributeList(attributes)
            for fd in descriptors:
                os.close(fd)

    def poll(self):
        if self.returncode is None and self.handle is not None:
            result = self.kernel.WaitForSingleObject(self.handle, 0)
            if result == 0:
                code = wintypes.DWORD()
                if not self.kernel.GetExitCodeProcess(self.handle, ctypes.byref(code)):
                    raise ctypes.WinError(ctypes.get_last_error())
                self.returncode = code.value
            elif result != 258:  # WAIT_TIMEOUT
                raise ctypes.WinError(ctypes.get_last_error())
        return self.returncode

    def kill(self):
        # 即使启动器已退出，也要终止未被采样捕获的后代。
        if self.job and not self.kernel.TerminateJobObject(self.job, 1):
            raise ctypes.WinError(ctypes.get_last_error())

    def wait(self, timeout=None):
        started = time.monotonic()
        if self.handle is not None:
            milliseconds = 0xFFFFFFFF if timeout is None else max(0, math.ceil(timeout * 1000))
            result = self.kernel.WaitForSingleObject(self.handle, milliseconds)
            if result == 258:
                raise subprocess.TimeoutExpired(self.args, timeout)
            if result != 0:
                raise ctypes.WinError(ctypes.get_last_error())
            self.poll()
        while self.job:
            accounting = JobAccounting()
            if not self.kernel.QueryInformationJobObject(
                self.job, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            if accounting.active_processes == 0:
                break
            if timeout is not None and time.monotonic() - started >= timeout:
                raise subprocess.TimeoutExpired(self.args, timeout)
            time.sleep(0.01)
        return self.returncode

    def close_handles(self):
        # 只有证实 Job 已空才释放所有权；失败句柄保留，允许调用方再次清理。
        self.wait(timeout=0)
        failure = None
        for name in ("thread", "handle", "job"):
            handle = getattr(self, name)
            if handle:
                if self.kernel.CloseHandle(handle):
                    setattr(self, name, None)
                else:
                    failure = failure or ctypes.WinError(ctypes.get_last_error())
        if failure is not None:
            raise failure
