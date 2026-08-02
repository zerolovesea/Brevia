"""Focused storage responsibility component."""

import json

from .store_base import utc_now


class TranscriptStoreMixin:
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
            cursor = db.execute(
                """INSERT INTO segments
                    (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,translation,user_edited)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(meeting_id,id,version) DO UPDATE SET
                    revision=excluded.revision,end_ms=excluded.end_ms,speaker=excluded.speaker,
                    text=excluded.text,translation=excluded.translation
                    WHERE segments.user_edited=0""",
                values,
            )
            return cursor.rowcount > 0

    def next_refinement_version(self, meeting_id):
        """为一次新的精修分配版本，保留此前的精修结果。"""
        with self.connect() as db:
            rows = db.execute(
                "SELECT revision FROM segments WHERE meeting_id=? AND (version='postprocess' OR version GLOB 'postprocess-*')",
                (meeting_id,),
            ).fetchall()
        revision = max((row["revision"] for row in rows), default=-1) + 1
        return ("postprocess" if revision == 0 else f"postprocess-{revision}", revision)

    def replace_segments(self, meeting_id, segments, version="postprocess", revision=0):
        """原子替换一次精修生成的全部段落，保留用户编辑版本。"""
        with self.connect() as db:
            segment_ids = set()
            normalized = []
            for item in segments:
                base_id = item["segment_id"]
                segment_id = base_id
                suffix = 1
                while segment_id in segment_ids:
                    segment_id = f"{base_id}-{suffix}"
                    suffix += 1
                segment_ids.add(segment_id)
                normalized.append(
                    {
                        **item,
                        "segment_id": segment_id,
                        "version": version,
                        "revision": revision,
                    }
                )
            db.execute(
                "DELETE FROM segments WHERE meeting_id=? AND version=?",
                (meeting_id, version),
            )
            db.executemany(
                """INSERT INTO segments
                    (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,translation,user_edited)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    (
                        item["segment_id"],
                        meeting_id,
                        item["revision"],
                        version,
                        item["track"],
                        int(item["start_ms"]),
                        int(item["end_ms"]),
                        item["speaker"],
                        item["text"].strip(),
                        item.get("translation"),
                        0,
                    )
                    for item in normalized
                ],
            )
        return normalized

    def save_translation(self, meeting_id, segment_id, translation):
        """为会议中同一段落的所有版本保存译文。"""
        with self.connect() as db:
            db.execute(
                "UPDATE segments SET translation=? WHERE meeting_id=? AND id=?",
                (translation, meeting_id, segment_id),
            )

    def rename_speaker(
        self, meeting_id, speaker_id, name, locked=False, profile_id=None
    ):
        """保存会议内的说话人显示名。

        Args:
            locked: 锁定后，会后精修优先沿用该说话人 ID。
        """
        name = name.strip()
        if not name:
            raise ValueError("Speaker name cannot be empty")
        with self.connect() as db:
            db.execute(
                """INSERT INTO speakers(meeting_id,id,name,profile_id,locked) VALUES(?,?,?,?,?)
                       ON CONFLICT(meeting_id,id) DO UPDATE SET name=excluded.name,
                       profile_id=COALESCE(excluded.profile_id,speakers.profile_id),locked=excluded.locked""",
                (meeting_id, speaker_id, name, profile_id, int(locked)),
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
