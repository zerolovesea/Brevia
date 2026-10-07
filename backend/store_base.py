"""稳定存储组件的共享 SQLite 连接和文件系统根目录。"""

import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  target_language TEXT,
  refined_model_id TEXT NOT NULL,
  transcript_model_id TEXT,
  speaker_segmentation_model_id TEXT,
  vad_model_id TEXT,
  num_speakers INTEGER NOT NULL DEFAULT -1,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  previous_workspace_id TEXT,
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  deleted_at TEXT,
  is_example INTEGER NOT NULL DEFAULT 0,
  example_locale TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS segments (
  id TEXT NOT NULL,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL,
  track TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  word_timestamps TEXT,
  translation TEXT,
  user_edited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, id, version)
);
CREATE INDEX IF NOT EXISTS segments_meeting_time ON segments(meeting_id, start_ms);
CREATE INDEX IF NOT EXISTS meetings_deleted_created ON meetings(deleted_at, created_at DESC);
CREATE TABLE IF NOT EXISTS speakers (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  profile_id TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, id)
);
CREATE TABLE IF NOT EXISTS speaker_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  embedding TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS speaker_profile_samples (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES speaker_profiles(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE,
  embedding TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audio_path TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS speaker_turns (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  PRIMARY KEY (meeting_id, version, start_ms, end_ms, speaker)
);
CREATE TABLE IF NOT EXISTS summaries (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  data TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'violet',
  position INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def utc_now():
    """返回可直接写入 SQLite 的 UTC ISO 8601 时间。"""
    return datetime.now(timezone.utc).isoformat()


# 会议 / 说话人 id 只允许这些字符。UUID 天然满足；这条白名单同时挡掉 ``../``、
# 绝对路径与盘符，使 ``root / id`` 不可能逃逸出数据目录。
_SAFE_ID = re.compile(r"\A[A-Za-z0-9_-]{1,64}\Z")


def safe_child(root, identifier, label="identifier"):
    """把标识符解析成 ``root`` 下的直接子路径，拒绝路径穿越。

    会议 id 在协议层可由调用方自带（``create_meeting`` 的 ``meeting_id``），
    直接 ``root / id`` 会让 ``../`` 逃逸出数据目录；配合 ``shutil.rmtree`` 即可
    删除任意目录。这里要求 id 只含安全字符（UUID 天然满足），并在解析后二次确认
    仍位于 ``root`` 之内——``resolve`` 会展开符号链接，避免软链接绕过。

    返回的是未经 ``resolve`` 的原路径：调用方（如 ``audio_files``）会把该路径交给
    Electron 与 ``recordingsDir()`` 做前缀比较，若这里改成规范路径，macOS 上
    ``/var`` → ``/private/var`` 这类展开会让两侧前缀对不上。
    """
    if not isinstance(identifier, str) or not _SAFE_ID.match(identifier):
        raise ValueError(f"Invalid {label}")
    root_path = Path(root)
    candidate = root_path / identifier
    if candidate.resolve().parent != root_path.resolve():
        raise ValueError(f"Invalid {label}")
    return candidate


def synchronized_storage_files(method):
    """为单个 Store 实例序列化清单和音频文件变更。"""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self.storage_file_lock:
            return method(self, *args, **kwargs)

    return synchronized


# 数据库结构版本：用 PRAGMA user_version 记录。结构迁移只在版本落后时执行一次，
# 重型迁移只运行一次；缺列补齐和数据清理仍以实际结构为准。
CURRENT_SCHEMA_VERSION = 2


class StoreBase:
    def __init__(self, root):
        """创建数据目录、打开数据库并执行向后兼容的迁移。

        Args:
            root: Brevia 数据根目录；支持 ``~``。
        """
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        self.meetings_dir = Path(
            os.environ.get("BREVIA_MEETINGS_DIR", self.root / "meetings")
        ).expanduser()
        self.speaker_profiles_dir = self.root / "speaker-profiles"
        self.models_dir = Path(
            os.environ.get("BREVIA_MODELS_DIR", self.root / "models")
        ).expanduser()
        self.meetings_dir.mkdir(parents=True, exist_ok=True)
        self.speaker_profiles_dir.mkdir(exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.storage_file_lock = threading.RLock()
        self._audio_sessions = {}
        self.db_path = self.root / "brevia.db"
        with self.connect() as db:
            db.executescript(SCHEMA)
            # 补列按「当前实际结构」判断，每次启动都跑：版本号一旦被写高（例如运行过
            # 中途的开发版），基于版本的迁移会永久跳过，留下缺列的旧表让新代码 INSERT
            # 直接失败（NOT NULL 列缺失）。重建表这类重活仍由 _migrate_schema 按版本控制。
            self._ensure_columns(db)
            self._migrate_schema(db)
            # 下架功能的列与示例工作区都按「当前实际结构/数据」判断，每次启动都跑：
            # 版本号只用来跳过重型重建，不能用来跳过这类幂等修复。
            self._drop_retired_columns(db)
            self._clear_example_workspaces(db)

    def meeting_dir(self, meeting_id):
        """返回某场会议的数据目录，拒绝越界的 ``meeting_id``。"""
        return safe_child(self.meetings_dir, meeting_id, label="meeting id")

    def _ensure_columns(self, db):
        """幂等地补齐各表缺失的列。

        与 ``_drop_retired_columns`` 对称：以实际结构为准，不看版本号，因此可以从
        任何中间版本（包括版本号被写高、但列并未真正补上的开发版）恢复到当前结构。
        """
        columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)")}
        if "transcript_model_id" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN transcript_model_id TEXT")
            db.execute(
                "UPDATE meetings SET transcript_model_id=refined_model_id "
                "WHERE EXISTS(SELECT 1 FROM segments s WHERE s.meeting_id=meetings.id "
                "AND (s.version='postprocess' OR s.version GLOB 'postprocess-*'))"
            )
        if "workspace_id" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL"
            )
        if "previous_workspace_id" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN previous_workspace_id TEXT")
        if "is_example" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0")
        if "example_locale" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN example_locale TEXT")
        if "notes" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
        if "speaker_segmentation_model_id" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN speaker_segmentation_model_id TEXT")
        if "num_speakers" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN num_speakers INTEGER NOT NULL DEFAULT -1")
        if "vad_model_id" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN vad_model_id TEXT")
        workspace_columns = {row["name"] for row in db.execute("PRAGMA table_info(workspaces)")}
        if "deleted_at" not in workspace_columns:
            db.execute("ALTER TABLE workspaces ADD COLUMN deleted_at TEXT")
        segment_columns = {row["name"] for row in db.execute("PRAGMA table_info(segments)")}
        if "word_timestamps" not in segment_columns:
            db.execute("ALTER TABLE segments ADD COLUMN word_timestamps TEXT")
        speaker_columns = {row["name"] for row in db.execute("PRAGMA table_info(speakers)")}
        if "profile_id" not in speaker_columns:
            db.execute("ALTER TABLE speakers ADD COLUMN profile_id TEXT")
        sample_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(speaker_profile_samples)")
        }
        if "audio_path" not in sample_columns:
            db.execute("ALTER TABLE speaker_profile_samples ADD COLUMN audio_path TEXT")
        if "duration_ms" not in sample_columns:
            db.execute(
                "ALTER TABLE speaker_profile_samples ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0"
            )

    def _migrate_schema(self, db):
        """执行 user_version 控制的一次性结构迁移；达到目标版本后直接跳过。

        仅用于重建表这类不能每次启动都跑的重活；补列、删列等幂等修复放在
        ``_ensure_columns`` 和 ``_drop_retired_columns``，按实际结构判断。
        """
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version >= CURRENT_SCHEMA_VERSION:
            return
        if version < 1:
            self._migrate_v1(db)
        if version < 2:
            db.execute(
                "UPDATE meetings SET transcript_model_id=refined_model_id "
                "WHERE EXISTS(SELECT 1 FROM segments s WHERE s.meeting_id=meetings.id "
                "AND (s.version='postprocess' OR s.version GLOB 'postprocess-*'))"
            )
        db.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION}")

    def _drop_retired_columns(self, db):
        """删除已下架功能的列。

        必须按「列是否存在」而不是版本号判断：版本号一旦被写高（例如运行过中途的
        开发版），基于版本的迁移会永久跳过，留下 NOT NULL 的历史列让新代码的
        INSERT 直接失败。

        每下架一个功能就在这里加一条：``streaming_model_id``（流式识别）、
        ``power_saving``（效率模式）都只保留一个识别模型 ``refined_model_id``，
        不再为老客户端保留占位字段。
        """
        columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)")}
        for retired in ("streaming_model_id", "power_saving"):
            if retired in columns:
                db.execute(f"ALTER TABLE meetings DROP COLUMN {retired}")

    def _migrate_v1(self, db):
        """v0 → v1：segments 主键并入 meeting_id、各表补列、旧分类迁移到工作区。"""
        segment_key = [
            row["name"] for row in db.execute("PRAGMA table_info(segments)") if row["pk"]
        ]
        if segment_key == ["id", "version"]:
            # 重建表以把 meeting_id 并入主键；必须连同 word_timestamps 一并迁移，
            # 否则从中间版本升级会静默丢失全部词级时间戳。
            db.execute(
                "CREATE TABLE segments_new ("
                "id TEXT NOT NULL, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, "
                "revision INTEGER NOT NULL DEFAULT 0, version TEXT NOT NULL, track TEXT NOT NULL, "
                "start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, "
                "word_timestamps TEXT, translation TEXT, user_edited INTEGER NOT NULL DEFAULT 0, "
                "PRIMARY KEY (meeting_id, id, version))"
            )
            db.execute(
                "INSERT INTO segments_new SELECT id,meeting_id,revision,version,track,start_ms,end_ms,"
                "speaker,text,word_timestamps,translation,user_edited FROM segments"
            )
            db.execute("DROP TABLE segments")
            db.execute("ALTER TABLE segments_new RENAME TO segments")
            db.execute("CREATE INDEX segments_meeting_time ON segments(meeting_id, start_ms)")
        # 补列已移到每次启动都跑的 ``_ensure_columns``；这里只保留不能每次启动都做的
        # 重活（重建表）与一次性数据迁移。
        # 旧分类迁移到工作区：升级时一次性处理 category 残留（新库无数据，检查直接跳过）。
        if db.execute(
            "SELECT 1 FROM meetings WHERE category != '' AND is_example=0 LIMIT 1"
        ).fetchone():
            self._migrate_categories_to_workspaces(db)

    @contextmanager
    def connect(self):
        """提供一次短生命周期数据库事务。

        Yields:
            配置了 ``sqlite3.Row`` 和外键约束的连接。正常退出时提交，
            异常退出时关闭连接并由 SQLite 回滚未提交事务。
        """
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=5000")
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def _migrate_categories_to_workspaces(self, db):
        """将旧分类或旧版工作区 ID 一次性迁移到独立字段。"""
        from uuid import uuid4

        categories = db.execute(
            "SELECT DISTINCT category FROM meetings WHERE category != '' AND is_example=0"
        ).fetchall()

        now = utc_now()
        colors = ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'cyan', 'gray']

        for idx, row in enumerate(categories):
            category_name = row['category']
            workspace = db.execute(
                "SELECT id, deleted_at FROM workspaces WHERE id = ? OR name = ? COLLATE NOCASE",
                (category_name, category_name),
            ).fetchone()
            if workspace:
                workspace_id = workspace["id"]
                # 命中的工作区可能已被软删除：把会议挂上去会让它指向一个不可见的工作区。
                # 名称唯一（UNIQUE COLLATE NOCASE），不能另建同名工作区，这里顺手恢复它。
                if workspace["deleted_at"]:
                    db.execute(
                        "UPDATE workspaces SET deleted_at=NULL WHERE id=?",
                        (workspace_id,),
                    )
            else:
                workspace_id = str(uuid4())
                db.execute(
                    """INSERT INTO workspaces (id, name, description, color, position, created_at, updated_at)
                       VALUES (?, ?, '', ?, ?, ?, ?)""",
                    (workspace_id, category_name, colors[idx % len(colors)], idx, now, now),
                )
            db.execute(
                "UPDATE meetings SET workspace_id = ?, category = '' WHERE category = ?",
                (workspace_id, category_name),
            )

    @staticmethod
    def _clear_example_workspaces(db):
        """示例会议始终属于公开区，并清除旧迁移生成的空示例工作区。"""
        workspace_ids = [
            row["workspace_id"]
            for row in db.execute(
                "SELECT DISTINCT workspace_id FROM meetings WHERE is_example=1 AND workspace_id IS NOT NULL"
            )
        ]
        db.execute("UPDATE meetings SET workspace_id=NULL, category='' WHERE is_example=1")
        db.executemany(
            """DELETE FROM workspaces WHERE id=?
               AND NOT EXISTS (SELECT 1 FROM meetings WHERE workspace_id=workspaces.id)""",
            ((workspace_id,) for workspace_id in workspace_ids),
        )
