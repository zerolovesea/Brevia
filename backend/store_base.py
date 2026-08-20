"""稳定存储组件的共享 SQLite 连接和文件系统根目录。"""

import os
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
  streaming_model_id TEXT NOT NULL,
  refined_model_id TEXT NOT NULL,
  speaker_segmentation_model_id TEXT,
  vad_model_id TEXT,
  num_speakers INTEGER NOT NULL DEFAULT -1,
  power_saving INTEGER NOT NULL DEFAULT 0,
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


def synchronized_storage_files(method):
    """为单个 Store 实例序列化清单和音频文件变更。"""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self.storage_file_lock:
            return method(self, *args, **kwargs)

    return synchronized


# 数据库结构版本：用 PRAGMA user_version 记录。结构迁移只在版本落后时执行一次，
# 达标后启动热路径不再重复 PRAGMA 列检查；数据级清理（示例工作区等）仍按需运行。
CURRENT_SCHEMA_VERSION = 1


class StoreBase:
    def __init__(self, root):
        """创建数据目录、打开数据库并执行向后兼容的迁移。

        Args:
            root: Brevia 数据根目录；支持 ``~``。
        """
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        self.meetings_dir = self.root / "meetings"
        self.speaker_profiles_dir = self.root / "speaker-profiles"
        self.models_dir = Path(
            os.environ.get("BREVIA_MODELS_DIR", self.root / "models")
        ).expanduser()
        self.meetings_dir.mkdir(exist_ok=True)
        self.speaker_profiles_dir.mkdir(exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.storage_file_lock = threading.RLock()
        self.db_path = self.root / "brevia.db"
        with self.connect() as db:
            db.executescript(SCHEMA)
            self._migrate_schema(db)
            # 示例会议始终属于公开区：数据级防御清理，每次启动保持（依赖用户数据状态）。
            self._clear_example_workspaces(db)

    def _migrate_schema(self, db):
        """执行 user_version 控制的一次性结构迁移；达到目标版本后直接跳过。

        历史列补丁与 segments 主键重建只在版本落后时运行一次，避免每次启动
        重复 PRAGMA 元数据检查；数据级清理（示例工作区等）仍在 __init__ 按需执行。
        """
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version >= CURRENT_SCHEMA_VERSION:
            return
        if version < 1:
            self._migrate_v1(db)
        db.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION}")

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
        columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)")}
        if "workspace_id" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL"
            )
        if "previous_workspace_id" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN previous_workspace_id TEXT")
        if "is_example" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0"
            )
        workspace_columns = {row["name"] for row in db.execute("PRAGMA table_info(workspaces)")}
        if "deleted_at" not in workspace_columns:
            db.execute("ALTER TABLE workspaces ADD COLUMN deleted_at TEXT")
        if "example_locale" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN example_locale TEXT")
        if "notes" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN notes TEXT NOT NULL DEFAULT ''"
            )
        if "speaker_segmentation_model_id" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN speaker_segmentation_model_id TEXT"
            )
        if "num_speakers" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN num_speakers INTEGER NOT NULL DEFAULT -1"
            )
        if "power_saving" not in columns:
            db.execute(
                "ALTER TABLE meetings ADD COLUMN power_saving INTEGER NOT NULL DEFAULT 0"
            )
        if "vad_model_id" not in columns:
            db.execute("ALTER TABLE meetings ADD COLUMN vad_model_id TEXT")
        segment_columns = {row["name"] for row in db.execute("PRAGMA table_info(segments)")}
        if "word_timestamps" not in segment_columns:
            db.execute("ALTER TABLE segments ADD COLUMN word_timestamps TEXT")
        speaker_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(speakers)")
        }
        if "profile_id" not in speaker_columns:
            db.execute("ALTER TABLE speakers ADD COLUMN profile_id TEXT")
        sample_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(speaker_profile_samples)")
        }
        if "audio_path" not in sample_columns:
            db.execute(
                "ALTER TABLE speaker_profile_samples ADD COLUMN audio_path TEXT"
            )
        if "duration_ms" not in sample_columns:
            db.execute(
                "ALTER TABLE speaker_profile_samples ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0"
            )
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
                "SELECT id FROM workspaces WHERE id = ? OR name = ? COLLATE NOCASE",
                (category_name, category_name),
            ).fetchone()
            workspace_id = workspace["id"] if workspace else str(uuid4())
            if not workspace:
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
