"""会议数据库、录音分块和本地文件布局。"""

import base64
import json
import shutil
import sqlite3
import struct
import sys
import time
import wave
from array import array
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .config import SETTINGS


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
  PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS segments_meeting_time ON segments(meeting_id, start_ms);
CREATE TABLE IF NOT EXISTS speakers (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, id)
);
CREATE TABLE IF NOT EXISTS speaker_turns (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  PRIMARY KEY (meeting_id, version, start_ms, end_ms, speaker)
);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL COLLATE NOCASE,
  language TEXT NOT NULL DEFAULT '',
  weight REAL NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(text, language)
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


class Store:
    """把会议元数据写入 SQLite，把大体积音频保存在会议目录中。"""

    def __init__(self, root):
        """创建数据目录、打开数据库并执行向后兼容的轻量迁移。

        Args:
            root: Brevia 数据根目录；支持 ``~``。
        """
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        self.meetings_dir = self.root / "meetings"
        self.models_dir = Path(
            __import__("os").environ.get("BREVIA_MODELS_DIR", self.root / "models")
        ).expanduser()
        self.meetings_dir.mkdir(exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "brevia.db"
        with self.connect() as db:
            db.executescript(SCHEMA)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)")}
            if "is_example" not in columns:
                db.execute("ALTER TABLE meetings ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0")
            if "example_locale" not in columns:
                db.execute("ALTER TABLE meetings ADD COLUMN example_locale TEXT")

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

    def create_meeting(self, payload):
        """创建录制中的会议及其音频、导出目录。

        Args:
            payload: 会议标题、语言、实时模型和精修模型；可选分类、标签与固定 ID。

        Returns:
            可直接返回给前端的完整会议详情。
        """
        meeting_id = payload.get("meeting_id") or str(uuid4())
        now = utc_now()
        values = (
            meeting_id,
            payload["title"].strip(),
            payload["language"],
            payload.get("target_language"),
            payload["streaming_model_id"],
            payload["refined_model_id"],
            payload.get("category", ""),
            json.dumps(payload.get("tags", []), ensure_ascii=False),
            "recording",
            now,
            now,
        )
        with self.connect() as db:
            db.execute(
                """INSERT INTO meetings
                (id,title,language,target_language,streaming_model_id,refined_model_id,
                 category,tags,status,created_at,started_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                values,
            )
        meeting_dir = self.meetings_dir / meeting_id
        (meeting_dir / "audio").mkdir(parents=True)
        (meeting_dir / "exports").mkdir()
        self.write_manifest(meeting_id, {"meeting_id": meeting_id, "closed": False, "tracks": {}})
        return self.get_meeting(meeting_id)

    def list_meetings(self, include_deleted=False, query=""):
        """列出会议摘要。

        Args:
            include_deleted: 为真时只列出最近删除的会议，否则只列出正常会议。
            query: 可选模糊搜索词，匹配标题、标签和逐字稿。

        Returns:
            按创建时间倒序排列的会议字典列表，不加载音频和逐字稿详情。
        """
        clauses, params = [], []
        clauses.append("deleted_at IS NOT NULL" if include_deleted else "deleted_at IS NULL")
        if query:
            clauses.append(
                "(title LIKE ? OR tags LIKE ? OR id IN "
                "(SELECT meeting_id FROM segments WHERE text LIKE ?))"
            )
            like = f"%{query}%"
            params.extend([like, like, like])
        with self.connect() as db:
            rows = db.execute(
                f"SELECT * FROM meetings WHERE {' AND '.join(clauses)} ORDER BY created_at DESC",
                params,
            ).fetchall()
        return [self._meeting(row) for row in rows]

    def seed_examples(self):
        """按版本写入三语示例会议和录音。

        已被用户删除的示例带有 tombstone，升级种子数据时也不会重新创建。

        Returns:
            本次是否执行了种子写入；同一版本重复调用返回 ``False``。
        """
        fixture_root = Path(__file__).with_name("fixtures")
        examples = json.loads(Path(__file__).with_name("examples.json").read_text())
        with self.connect() as db:
            if db.execute(
                "SELECT 1 FROM app_meta WHERE key='examples_seeded_v3'"
            ).fetchone():
                return False
            now = utc_now()
            for example in examples:
                if db.execute(
                    "SELECT 1 FROM app_meta WHERE key=?",
                    (f"example_deleted:{example['id']}",),
                ).fetchone():
                    continue
                meeting_dir = self.meetings_dir / example["id"]
                (meeting_dir / "audio").mkdir(parents=True, exist_ok=True)
                (meeting_dir / "exports").mkdir(exist_ok=True)
                shutil.copyfile(
                    fixture_root / example["audio"],
                    meeting_dir / "audio" / "playback-mic.wav",
                )
                self.write_manifest(
                    example["id"],
                    {"meeting_id": example["id"], "closed": True, "tracks": {}},
                )
                db.execute(
                    """INSERT OR IGNORE INTO meetings
                    (id,title,language,target_language,streaming_model_id,refined_model_id,
                     category,tags,status,created_at,started_at,ended_at,duration_ms,
                     is_example,example_locale)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,language=excluded.language,
                    target_language=excluded.target_language,category=excluded.category,
                    tags=excluded.tags,status=excluded.status,duration_ms=excluded.duration_ms,
                    is_example=1,example_locale=excluded.example_locale""",
                    (
                        example["id"],
                        example["title"],
                        example["locale"],
                        "en" if example["locale"] == "zh" else "zh",
                        "paraformer-zh-en-int8",
                        "qwen3-asr-0.6b-int8",
                        example["category"],
                        json.dumps(example["tags"], ensure_ascii=False),
                        "refined",
                        now,
                        now,
                        now,
                        example["duration_ms"],
                        1,
                        example["locale"],
                    ),
                )
                db.executemany(
                    """INSERT INTO speakers(meeting_id,id,name,locked) VALUES(?,?,?,1)
                       ON CONFLICT(meeting_id,id) DO UPDATE SET name=excluded.name""",
                    (
                        (example["id"], speaker_id, name)
                        for speaker_id, name in example["speakers"].items()
                    ),
                )
                db.executemany(
                    """INSERT OR IGNORE INTO segments
                    (id,meeting_id,version,track,start_ms,end_ms,speaker,text,translation)
                    VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id,version) DO UPDATE SET
                    start_ms=excluded.start_ms,end_ms=excluded.end_ms,
                    speaker=excluded.speaker,text=excluded.text,
                    translation=excluded.translation""",
                    (
                        (
                            f"example-{example['locale']}-{index}",
                            example["id"],
                            "postprocess",
                            "mic",
                            start,
                            end,
                            speaker,
                            text,
                            translation,
                        )
                        for index, (start, end, speaker, text, translation) in enumerate(
                            example["segments"], 1
                        )
                    ),
                )
            db.execute(
                "INSERT INTO app_meta(key,value) VALUES('examples_seeded_v3',?)",
                (now,),
            )
        return True

    def get_meeting(self, meeting_id):
        """读取会议及其逐字稿、说话人、摘要和音频路径。

        Args:
            meeting_id: 会议 UUID。

        Returns:
            聚合后的会议详情；逐字稿中的 ``speaker_name`` 已应用用户命名。

        Raises:
            ValueError: 会议不存在。
        """
        with self.connect() as db:
            row = db.execute("SELECT * FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not row:
                raise ValueError("Meeting not found")
            segments = db.execute(
                """SELECT s.*, COALESCE(p.name, s.speaker) AS speaker_name
                   FROM segments s LEFT JOIN speakers p
                   ON p.meeting_id=s.meeting_id AND p.id=s.speaker
                   WHERE s.meeting_id=? ORDER BY s.start_ms, s.version""",
                (meeting_id,),
            ).fetchall()
            summary = db.execute(
                "SELECT data,raw_response,created_at FROM summaries WHERE meeting_id=?",
                (meeting_id,),
            ).fetchone()
            speakers = db.execute(
                "SELECT id,name,locked FROM speakers WHERE meeting_id=? ORDER BY id",
                (meeting_id,),
            ).fetchall()
            speaker_turns = db.execute(
                "SELECT version,start_ms,end_ms,speaker FROM speaker_turns "
                "WHERE meeting_id=? ORDER BY start_ms,end_ms",
                (meeting_id,),
            ).fetchall()
        result = self._meeting(row)
        result["segments"] = [dict(segment) for segment in segments]
        result["speakers"] = [dict(speaker) for speaker in speakers]
        result["speaker_turns"] = [dict(turn) for turn in speaker_turns]
        result["summary"] = (
            {**dict(summary), "data": json.loads(summary["data"]) if summary["data"] else None}
            if summary
            else None
        )
        result["audio"] = self.audio_files(meeting_id)
        return result

    def update_meeting(self, meeting_id, updates):
        """更新允许用户编辑的会议字段并返回最新详情。

        ``updates`` 只接受标题、分类、标签和归档时间，其他键会被忽略。
        """
        allowed = {"title", "category", "tags", "archived_at"}
        fields = {key: value for key, value in updates.items() if key in allowed}
        if not fields:
            return self.get_meeting(meeting_id)
        if "title" in fields:
            fields["title"] = fields["title"].strip()
            if not fields["title"]:
                raise ValueError("Title cannot be empty")
        if "tags" in fields:
            fields["tags"] = json.dumps(fields["tags"], ensure_ascii=False)
        with self.connect() as db:
            db.execute(
                f"UPDATE meetings SET {','.join(f'{key}=?' for key in fields)} WHERE id=?",
                [*fields.values(), meeting_id],
            )
        return self.get_meeting(meeting_id)

    def set_status(self, meeting_id, status):
        """更新会议处理状态并返回最新详情。"""
        if status not in {"ready", "refining", "refined"}:
            raise ValueError("Invalid meeting status")
        with self.connect() as db:
            db.execute("UPDATE meetings SET status=? WHERE id=?", (status, meeting_id))
        return self.get_meeting(meeting_id)

    def finish_meeting(self, meeting_id, duration_ms):
        """结束录制，关闭恢复清单，并为每条已有音轨生成连续播放文件。

        Returns:
            状态更新为 ``ready`` 的完整会议详情。
        """
        with self.connect() as db:
            db.execute(
                "UPDATE meetings SET status='ready',ended_at=?,duration_ms=? WHERE id=?",
                (utc_now(), max(0, int(duration_ms)), meeting_id),
            )
        manifest = self.read_manifest(meeting_id)
        manifest["closed"] = True
        self.write_manifest(meeting_id, manifest)
        for track in ("mic", "system"):
            self._build_playback(meeting_id, track)
        self._build_mix(meeting_id)
        return self.get_meeting(meeting_id)

    def soft_delete(self, meeting_id, restore=False):
        """删除或恢复会议。

        普通会议写入删除时间，仍可在保留期内恢复；示例会议会立即删除数据库
        记录和录音目录，并写入 tombstone，避免下次启动重新生成。

        Args:
            meeting_id: 目标会议 UUID。
            restore: 为真时清除普通会议的删除时间。
        """
        with self.connect() as db:
            meeting = db.execute(
                "SELECT is_example FROM meetings WHERE id=?", (meeting_id,)
            ).fetchone()
            if not meeting:
                raise ValueError("Meeting not found")
            if meeting["is_example"] and not restore:
                db.execute(
                    "INSERT OR REPLACE INTO app_meta(key,value) VALUES(?,?)",
                    (f"example_deleted:{meeting_id}", utc_now()),
                )
                db.execute("DELETE FROM meetings WHERE id=?", (meeting_id,))
                shutil.rmtree(self.meetings_dir / meeting_id, ignore_errors=True)
                return
            db.execute(
                "UPDATE meetings SET deleted_at=? WHERE id=?",
                (None if restore else utc_now(), meeting_id),
            )

    def purge_expired(self):
        """永久删除超过保留期的会议记录及其全部本地文件。"""
        cutoff = (
            datetime.now(timezone.utc)
            - timedelta(days=SETTINGS["meetings"]["deleted_retention_days"])
        ).isoformat()
        with self.connect() as db:
            ids = [
                row["id"]
                for row in db.execute(
                    "SELECT id FROM meetings WHERE deleted_at IS NOT NULL AND deleted_at<?",
                    (cutoff,),
                )
            ]
        for meeting_id in ids:
            self.permanent_delete(meeting_id)
        return ids

    def permanent_delete(self, meeting_id):
        """永久删除已进入最近删除的会议及其录音、逐字稿和导出文件。"""
        with self.connect() as db:
            meeting = db.execute(
                "SELECT deleted_at FROM meetings WHERE id=?", (meeting_id,)
            ).fetchone()
            if not meeting:
                raise ValueError("Meeting not found")
            if not meeting["deleted_at"]:
                raise ValueError("Only deleted meetings can be permanently deleted")
        shutil.rmtree(self.meetings_dir / meeting_id, ignore_errors=True)
        with self.connect() as db:
            db.execute("DELETE FROM meetings WHERE id=?", (meeting_id,))

    def save_segment(self, payload):
        """插入或更新一段逐字稿。

        Args:
            payload: 至少包含会议 ID、段落 ID、文本及起止毫秒；可附带版本、
                revision、音轨、说话人、译文和人工编辑标记。

        已标记 ``user_edited`` 的同版本记录不会被自动识别结果覆盖。
        """
        values = (
            payload["segment_id"],
            payload["meeting_id"],
            int(payload.get("revision", 0)),
            payload.get("version", "live"),
            payload.get("track", "mic"),
            int(payload["start_ms"]),
            int(payload["end_ms"]),
            payload.get("speaker", "spk-1"),
            payload["text"].strip(),
            payload.get("translation"),
            int(payload.get("user_edited", False)),
        )
        with self.connect() as db:
            db.execute(
                """INSERT INTO segments
                (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,translation,user_edited)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id,version) DO UPDATE SET
                revision=excluded.revision,end_ms=excluded.end_ms,speaker=excluded.speaker,
                text=excluded.text,translation=excluded.translation
                WHERE segments.user_edited=0""",
                values,
            )

    def save_translation(self, meeting_id, segment_id, translation):
        """为会议中同一段落的所有版本保存译文。"""
        with self.connect() as db:
            db.execute(
                "UPDATE segments SET translation=? WHERE meeting_id=? AND id=?",
                (translation, meeting_id, segment_id),
            )

    def rename_speaker(self, meeting_id, speaker_id, name, locked=False):
        """保存会议内的说话人显示名。

        Args:
            locked: 锁定后，会后精修优先沿用该说话人 ID。
        """
        name = name.strip()
        if not name:
            raise ValueError("Speaker name cannot be empty")
        with self.connect() as db:
            db.execute(
                """INSERT INTO speakers(meeting_id,id,name,locked) VALUES(?,?,?,?)
                   ON CONFLICT(meeting_id,id) DO UPDATE SET name=excluded.name,locked=excluded.locked""",
                (meeting_id, speaker_id, name, int(locked)),
            )

    def replace_speaker_turns(self, meeting_id, turns, version="postprocess"):
        """用一组新的聚类时间段替换指定版本结果。

        Args:
            turns: 包含 ``start_ms``、``end_ms`` 和 ``speaker`` 的可迭代对象。
            version: 结果版本，默认写入会后处理版本。
        """
        with self.connect() as db:
            db.execute(
                "DELETE FROM speaker_turns WHERE meeting_id=? AND version=?",
                (meeting_id, version),
            )
            db.executemany(
                """INSERT INTO speaker_turns(meeting_id,version,start_ms,end_ms,speaker)
                   VALUES(?,?,?,?,?)""",
                (
                    (
                        meeting_id,
                        version,
                        int(turn["start_ms"]),
                        int(turn["end_ms"]),
                        turn["speaker"],
                    )
                    for turn in turns
                ),
            )

    def list_terms(self):
        """返回按文本排序的全部术语。"""
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM terms ORDER BY text")]

    def save_term(self, payload):
        """新增或更新术语，并返回更新后的完整术语表。

        ``payload`` 可带术语 ID；无 ID 时按“文本 + 语言”去重。
        """
        text = payload["text"].strip()
        if not text or len(text) > 64:
            raise ValueError("Term must contain 1–64 characters")
        with self.connect() as db:
            if payload.get("id"):
                db.execute(
                    "UPDATE terms SET text=?,language=?,weight=?,note=? WHERE id=?",
                    (
                        text,
                        payload.get("language", ""),
                        float(payload.get("weight", 1)),
                        payload.get("note", ""),
                        int(payload["id"]),
                    ),
                )
            else:
                db.execute(
                """INSERT INTO terms(text,language,weight,note) VALUES(?,?,?,?)
                   ON CONFLICT(text,language) DO UPDATE SET weight=excluded.weight,note=excluded.note""",
                    (
                        text,
                        payload.get("language", ""),
                        float(payload.get("weight", 1)),
                        payload.get("note", ""),
                    ),
                )
        return self.list_terms()

    def delete_term(self, term_id):
        """按整数 ID 删除术语，无匹配记录时保持幂等。"""
        with self.connect() as db:
            db.execute("DELETE FROM terms WHERE id=?", (int(term_id),))

    def save_summary(self, meeting_id, data, raw_response):
        """保存结构化纪要及供应商原始响应。

        解析失败时 ``data`` 可为空，原始响应仍会留下，便于排查而不必重发文本。
        """
        with self.connect() as db:
            db.execute(
                """INSERT INTO summaries(meeting_id,data,raw_response,created_at) VALUES(?,?,?,?)
                   ON CONFLICT(meeting_id) DO UPDATE SET
                   data=excluded.data,raw_response=excluded.raw_response,created_at=excluded.created_at""",
                (
                    meeting_id,
                    json.dumps(data, ensure_ascii=False) if data else None,
                    raw_response,
                    utc_now(),
                ),
            )

    def append_audio(
        self,
        meeting_id,
        track,
        pcm_base64,
        sample_rate=SETTINGS["audio"]["sample_rate"],
    ):
        """把一帧 base64 PCM16 追加到会议音轨。

        Args:
            meeting_id: 正在录制的会议 UUID。
            track: ``mic`` 或 ``system``。
            pcm_base64: 小端 PCM16 字节的 base64 表示；空字符串用于 flush。
            sample_rate: 本帧样本率，同一音轨录制期间不可变化。

        Returns:
            该音轨目前累计写入的样本数。
        """
        if track not in {"mic", "system"}:
            raise ValueError("Invalid audio track")
        pcm = base64.b64decode(pcm_base64, validate=True)
        if len(pcm) % 2:
            raise ValueError("PCM16 audio has an invalid byte length")
        manifest = self.read_manifest(meeting_id)
        state = manifest["tracks"].setdefault(
            track, {"sample_rate": sample_rate, "samples": 0, "chunks": []}
        )
        if state["sample_rate"] != sample_rate:
            raise ValueError("Sample rate changed during recording")
        chunk_samples = sample_rate * SETTINGS["audio"]["chunk_seconds"]
        offset = 0
        while offset < len(pcm):
            chunk_index = state["samples"] // chunk_samples
            in_chunk = state["samples"] % chunk_samples
            take = min((chunk_samples - in_chunk) * 2, len(pcm) - offset)
            name = f"{track}-{chunk_index:05d}.wav"
            path = self.meetings_dir / meeting_id / "audio" / name
            frame = pcm[offset : offset + take]
            if not path.exists():
                with wave.open(str(path), "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(sample_rate)
                    output.writeframes(frame)
            else:
                with path.open("r+b") as output:
                    output.seek(0, 2)
                    output.write(frame)
                    size = output.tell()
                    output.seek(4)
                    output.write(struct.pack("<I", size - 8))
                    output.seek(40)
                    output.write(struct.pack("<I", size - 44))
            if name not in state["chunks"]:
                state["chunks"].append(name)
            state["samples"] += take // 2
            offset += take
        self.write_manifest(meeting_id, manifest)
        return state["samples"]

    def audio_files(self, meeting_id):
        """返回会议的分块录音列表及可播放的连续 WAV 路径。"""
        audio = self.meetings_dir / meeting_id / "audio"
        files = {
            track: [str(path) for path in sorted(audio.glob(f"{track}-*.wav"))]
            for track in ("mic", "system")
        }
        files["playback"] = {
            track: str(audio / f"playback-{track}.wav")
            if (audio / f"playback-{track}.wav").exists()
            else None
            for track in ("mic", "system", "mix")
        }
        return files

    def _build_playback(self, meeting_id, track):
        """按文件名顺序拼接一条音轨的 WAV 分块；没有分块时不创建文件。"""
        sources = self.audio_files(meeting_id)[track]
        if not sources:
            return
        destination = self.meetings_dir / meeting_id / "audio" / f"playback-{track}.wav"
        with wave.open(sources[0]) as first, wave.open(str(destination), "wb") as output:
            output.setparams(first.getparams())
            output.writeframes(first.readframes(first.getnframes()))
            for source in sources[1:]:
                with wave.open(source) as recording:
                    if recording.getparams()[:3] != first.getparams()[:3]:
                        raise ValueError("Audio chunk format changed during recording")
                    output.writeframes(recording.readframes(recording.getnframes()))

    def _build_mix(self, meeting_id):
        """把麦克风和系统录音等比例混合为详情页默认回放文件。"""
        playback = self.audio_files(meeting_id)["playback"]
        if not playback["mic"] or not playback["system"]:
            return
        destination = self.meetings_dir / meeting_id / "audio" / "playback-mix.wav"
        with wave.open(playback["mic"]) as mic, wave.open(playback["system"]) as system:
            if mic.getparams()[:3] != system.getparams()[:3]:
                raise ValueError("Audio track format mismatch")
            with wave.open(str(destination), "wb") as output:
                output.setparams(mic.getparams())
                while True:
                    left, right = array("h"), array("h")
                    left.frombytes(mic.readframes(65536))
                    right.frombytes(system.readframes(65536))
                    if not left and not right:
                        break
                    if sys.byteorder != "little":
                        left.byteswap()
                        right.byteswap()
                    mixed = array(
                        "h",
                        (
                            ((left[index] if index < len(left) else 0)
                             + (right[index] if index < len(right) else 0)) // 2
                            for index in range(max(len(left), len(right)))
                        ),
                    )
                    if sys.byteorder != "little":
                        mixed.byteswap()
                    output.writeframes(mixed.tobytes())

    def read_manifest(self, meeting_id):
        """读取录音恢复清单；文件尚不存在时返回空字典。"""
        path = self.meetings_dir / meeting_id / "manifest.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def write_manifest(self, meeting_id, data):
        """通过临时文件替换，原子地写入录音恢复清单。"""
        path = self.meetings_dir / meeting_id / "manifest.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        temporary.replace(path)

    def recoverable_meetings(self):
        """返回清单仍未关闭的会议，用于 Worker 崩溃后的恢复提示。"""
        return [
            json.loads(path.read_text())
            for path in self.meetings_dir.glob("*/manifest.json")
            if not json.loads(path.read_text()).get("closed")
        ]

    def usage(self):
        """统计会议、模型与导出文件占用的字节数及其根目录。"""
        def size(root):
            """累计目录内普通文件的字节数。"""
            return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())

        return {
            "meetings": size(self.meetings_dir),
            "models": size(self.models_dir),
            "exports": sum(
                path.stat().st_size
                for path in self.meetings_dir.glob("*/exports/*")
                if path.is_file()
            ),
            "root": str(self.root),
            "models_root": str(self.models_dir),
        }

    @staticmethod
    def _meeting(row):
        """把 SQLite 会议行转为字典，并还原 JSON 标签。"""
        result = dict(row)
        result["tags"] = json.loads(result["tags"])
        return result
