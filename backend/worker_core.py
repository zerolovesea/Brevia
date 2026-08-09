"""聚焦的 worker 职责组件。"""

import json
import os
import threading
from pathlib import Path

from .asr import (
    ModelManager,
)
from .config import DEFAULT_SETTINGS, SETTINGS, runtime_settings, save_runtime_settings
from .llm_client import complete
from .media_tasks import MeetingMediaService
from .storage import Store
from .voice_profiles import VoiceProfileService
from .worker_common import SCHEMA_VERSION, TaskRegistry, WorkerState


class WorkerCore:
    def __init__(self, root=None, output=None):
        """初始化存储和模型管理。

        Args:
            root: 数据目录；为空时读取环境变量，再回退到 macOS 应用目录。
            output: JSON 消息输出函数；默认逐行写到 stdout。
        """
        root = root or os.environ.get(
            "BREVIA_DATA_DIR",
            Path.home() / "brevia",
        )
        self.output = output or self._write_stdout
        self.output_lock = threading.Lock()
        self.model_downloads = {}
        self.model_downloads_lock = threading.Lock()
        self.model_download_slots = threading.Semaphore(2)
        self.state = WorkerState()
        self.tasks = TaskRegistry()
        self.store = Store(root)
        self.store.recover_interrupted_meetings()
        runtime_settings(self.store.root)
        self.models = ModelManager(self.store.models_dir, self.emit)
        # 服务按存储/模型依赖构造；它们不持有实时会议状态，便于单独测试。
        self.voice_profiles = VoiceProfileService(self.store, self.models)
        self.media = MeetingMediaService(self.store, self.models)
        # 可替换边界让集成测试无需连接外部 LLM，也集中保留用户同意后的唯一出口。
        self.llm_complete = complete
        self.active = None
        self.asr = None
        self.denoiser = None
        self.language_identifier = None
        self.punctuation = None
        self.speaker_tracker = None
        self.stream_state = {}
        self.recent_finals = []
        self.meeting_language = None
        self.detected_language = None
        self.asr_warning_sent = False
        self.live_refiner = None
        self.live_refinement = None
        # 继续协作初始化链，使兄弟 mixin（如 llama sidecar 管理器）的 __init__ 也能
        # 运行——否则 _sidecars_lock 等属性永远不会被创建。
        super().__init__()

    @staticmethod
    def _write_stdout(value):
        """将 JSON 写入 stdout，忽略管道断开。"""
        try:
            print(json.dumps(value), flush=True)
        except BrokenPipeError:
            pass

    @property
    def active(self):
        return self.state.active

    @active.setter
    def active(self, meeting_id):
        self.state.active = meeting_id

    def emit(self, event_type, payload):
        """向前端发送无请求 ID 的异步事件。"""
        with self.output_lock:
            self.output(
                {
                    "type": event_type,
                    "schema_version": SCHEMA_VERSION,
                    "payload": payload,
                }
            )

    def response(self, command_id, result=None, error=None):
        """写出一条命令响应；错误只返回安全的字符串表示。"""
        value = {"id": command_id, "ok": error is None}
        value["error" if error else "result"] = str(error) if error else result
        with self.output_lock:
            self.output(value)

    def handle(self, command):
        """校验并分发一条 JSONL 命令。

        Args:
            command: 包含 ``id``、``type`` 和可选 ``payload`` 的字典。

        Returns:
            对应处理器的结果，最终由 ``response`` 包装。
        """
        command_id = command.get("id")
        command_type = command.get("type")
        payload = command.get("payload") or {}
        if not command_id or not command_type:
            raise ValueError("Commands require id and type")
        handlers = {
            "app.initialize": self.initialize,
            "app.maintain": self.maintain,
            "meeting.start": self.start,
            "meeting.import": self.import_audio,
            "meeting.resume": self.resume,
            "meeting.pause": self.pause,
            "meeting.reconfigure": self.reconfigure,
            "meeting.audio": self.audio,
            "meeting.stop": self.stop,
            "meeting.list": lambda value: self.store.list_meetings(**value),
            "meeting.get": lambda value: self.store.get_meeting(value["meeting_id"]),
            "meeting.update": self.update_meeting,
            "meeting.delete": self.delete_meeting,
            "meeting.restore": self.restore_meeting,
            "meeting.purge": self.purge_meeting,
            "speaker.rename": self.rename_speaker,
            "speaker-profile.list": lambda _: self.store.list_speaker_profiles(),
            "speaker-profile.samples": lambda value: (
                self.store.list_speaker_profile_samples(value["profile_id"])
            ),
            "speaker-profile.enroll": self.enroll_speaker_profile,
            "speaker-profile.verify": self.verify_speaker_profile,
            "speaker-profile.sample-delete": self.delete_speaker_profile_sample,
            "speaker-profile.delete": self.delete_speaker_profile,
            "speaker-profile.rename": lambda value: self.store.rename_speaker_profile(
                value["profile_id"], value["name"]
            ),
            "storage.clear": self.clear_storage,
            "settings.advanced.get": lambda _: {
                "settings": SETTINGS,
                "defaults": DEFAULT_SETTINGS,
            },
            "settings.advanced.save": lambda value: save_runtime_settings(
                self.store.root, value["settings"]
            ),
            "metrics.record": lambda value: self.store.metrics(
                value.get("app_duration_ms", 0)
            ),
            "segment.speaker": self.assign_segment_speaker,
            "segment.speaker-profile-sample": self.add_segment_speaker_profile_sample,
            "models.list": lambda _: self.models.list(),
            "models.download": self.download_model,
            "models.pause": self.pause_model,
            "models.cancel": self.cancel_model,
            "models.delete": self.delete_model,
            "task.pause": self.pause_task,
            "task.resume": self.resume_task,
            "meeting.export": self.export,
            "meeting.bundle": self.bundle,
            "meeting.refine": self.refine,
            "meeting.separate": self.separate_sources,
            "tts.synthesize": self.synthesize_tts,
            "summary.generate": self.summarize,
            "translation.generate": self.translate,
        }
        if command_type not in handlers:
            raise ValueError(f"Unknown command: {command_type}")
        return handlers[command_type](payload)

    def initialize(self, _):
        """返回首屏状态，并把可延后的启动维护放入后台。"""
        seeded_examples = self.store.seed_examples()
        for model_id in (
            SETTINGS["live_asr"]["denoiser_model_id"],
            SETTINGS["punctuation"]["english_model_id"],
            SETTINGS["punctuation"]["chinese_model_id"],
        ):
            if not self.models.is_ready(model_id):
                self.download_model({"model_id": model_id})
        return {
            "meetings": self.store.list_meetings(),
            "models": self.models.list(),
            "speaker_profiles": self.store.list_speaker_profiles(),
            "preset_voices": self.media.preset_voices(),
            "device": self.models.device(),
            "seeded_examples": seeded_examples,
        }

    def maintain(self, _):
        """在首屏已返回后启动可延后的维护任务。"""
        self._start_startup_maintenance()
        return {}

    def _start_startup_maintenance(self):
        threading.Thread(target=self._startup_maintenance, daemon=True).start()

    def _startup_maintenance(self):
        """完成不影响首屏的清理、声纹预置和磁盘统计。"""
        try:
            purged = self.store.purge_expired()
            self.voice_profiles.seed_builtin_profiles()
        except RuntimeError as error:
            self.emit(
                "worker.warning",
                {"code": "builtin_voiceprints_unavailable", "message": str(error)},
            )
        for profile in self.store.list_speaker_profiles():
            if self._is_default_speaker_name(profile["name"]):
                self.store.delete_speaker_profile(profile["id"])
        self.emit(
            "app.maintenance",
            {
                "meetings": self.store.list_meetings(),
                "speaker_profiles": self.store.list_speaker_profiles(),
                "storage": self.store.usage(),
                "recoverable": self.store.recoverable_meetings(),
                "purged_meeting_ids": purged,
            },
        )
