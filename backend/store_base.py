"""Shared SQLite connection and filesystem roots for storage components."""

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
  speaker_embedding_model_id TEXT,
  vad_model_id TEXT,
  num_speakers INTEGER NOT NULL DEFAULT -1,
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
  example_locale TEXT
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
  reference_text TEXT,
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
"""


def utc_now():
    """返回可直接写入 SQLite 的 UTC ISO 8601 时间。"""
    return datetime.now(timezone.utc).isoformat()


def synchronized_storage_files(method):
    """Serialize manifest and audio-file mutations for one Store instance."""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self.storage_file_lock:
            return method(self, *args, **kwargs)

    return synchronized


class StoreBase:
    def __init__(self, root):
        """创建数据目录、打开数据库并执行向后兼容的轻量迁移。

        Args:
            root: Brevia 数据根目录；支持 ``~``。
        """
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        self.meetings_dir = self.root / "meetings"
        self.speaker_profiles_dir = self.root / "speaker-profiles"
        self.models_dir = Path(
            __import__("os").environ.get("BREVIA_MODELS_DIR", self.root / "models")
        ).expanduser()
        self.meetings_dir.mkdir(exist_ok=True)
        self.speaker_profiles_dir.mkdir(exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.storage_file_lock = threading.RLock()
        self.db_path = self.root / "brevia.db"
        with self.connect() as db:
            db.executescript(SCHEMA)
            segment_key = [
                row["name"]
                for row in db.execute("PRAGMA table_info(segments)")
                if row["pk"]
            ]
            if segment_key == ["id", "version"]:
                db.executescript(
                    """CREATE TABLE segments_new (
                            id TEXT NOT NULL, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                            revision INTEGER NOT NULL DEFAULT 0, version TEXT NOT NULL, track TEXT NOT NULL,
                            start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL,
                            translation TEXT, user_edited INTEGER NOT NULL DEFAULT 0,
                            PRIMARY KEY (meeting_id, id, version)
                        );
                        INSERT INTO segments_new SELECT id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,translation,user_edited FROM segments;
                        DROP TABLE segments;
                        ALTER TABLE segments_new RENAME TO segments;
                        CREATE INDEX segments_meeting_time ON segments(meeting_id, start_ms);"""
                )
            columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)")}
            if "is_example" not in columns:
                db.execute(
                    "ALTER TABLE meetings ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0"
                )
            if "example_locale" not in columns:
                db.execute("ALTER TABLE meetings ADD COLUMN example_locale TEXT")
            if "speaker_segmentation_model_id" not in columns:
                db.execute(
                    "ALTER TABLE meetings ADD COLUMN speaker_segmentation_model_id TEXT"
                )
            if "speaker_embedding_model_id" not in columns:
                db.execute(
                    "ALTER TABLE meetings ADD COLUMN speaker_embedding_model_id TEXT"
                )
            if "num_speakers" not in columns:
                db.execute(
                    "ALTER TABLE meetings ADD COLUMN num_speakers INTEGER NOT NULL DEFAULT -1"
                )
            if "vad_model_id" not in columns:
                db.execute("ALTER TABLE meetings ADD COLUMN vad_model_id TEXT")
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
            if "reference_text" not in sample_columns:
                db.execute(
                    "ALTER TABLE speaker_profile_samples ADD COLUMN reference_text TEXT"
                )
            if "duration_ms" not in sample_columns:
                db.execute(
                    "ALTER TABLE speaker_profile_samples ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0"
                )

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
        try:
            yield db
            db.commit()
        finally:
            db.close()
