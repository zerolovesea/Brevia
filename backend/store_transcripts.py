"""聚焦存储职责的组件。"""

import json

from .store_base import utc_now


def _segment_row(payload):
    """把段落负载序列化为 segments 表的一行（实时保存与精修批量替换共用）。"""
    return (
        payload["segment_id"],
        payload["meeting_id"],
        int(payload.get("revision", 0)),
        payload.get("version", "live"),
        payload.get("track", "mic"),
        int(payload["start_ms"]),
        int(payload["end_ms"]),
        payload.get("speaker", "spk-1"),
        payload["text"].strip(),
        json.dumps(payload.get("word_timestamps"), ensure_ascii=False) if payload.get("word_timestamps") else None,
        payload.get("translation"),
        int(payload.get("user_edited", False)),
    )


def _user_edit_base(rows):
    """挑出人工编辑的基准行：用户版本优先，其次精修最新一轮，最后实时识别。"""
    return max(
        rows,
        key=lambda row: (
            row["version"] == "user",
            row["version"].startswith("postprocess"),
            row["revision"],
        ),
    )


class TranscriptStoreMixin:
    def save_segment_texts(self, meeting_id, edits):
        """保存人工修正后的字幕文本，写在用户当前看到的那一版上。

        Args:
            edits: ``{"segment_id", "text"}`` 列表。界面一次保存可能改动多句，
                批量写入保证提交是原子的。

        写入位置取决于基准行：已精修时另建 ``version='user'`` 覆盖行，读取路径
        （``latest_segments`` 与压缩会议详情）按「用户版本优先」合并，因此修正会
        覆盖精修结果；只有实时版本时直接改写实时行并标记 ``user_edited``。

        实时与精修使用两套段落 id（``track-start-seq`` 与 ``track-start``），若给
        实时段落另建覆盖行，精修落地后它会变成一条找不到基线的孤儿行，界面上表现为
        同一句话出现两次；改写实时行则让精修结果正常接管（重新识别本就以新结果为准）。

        Raises:
            ValueError: 段落不存在，或修正后的文本为空。
        """
        normalized = []
        for edit in edits:
            text = " ".join(str(edit.get("text") or "").split())
            if not text:
                raise ValueError("Subtitle text cannot be empty")
            normalized.append((edit["segment_id"], text))
        with self.connect() as db:
            for segment_id, text in normalized:
                rows = db.execute(
                    "SELECT * FROM segments WHERE meeting_id=? AND id=?",
                    (meeting_id, segment_id),
                ).fetchall()
                if not rows:
                    raise ValueError(f"Segment not found: {segment_id}")
                base = _user_edit_base(rows)
                version = "live" if base["version"] == "live" else "user"
                db.execute(
                    """INSERT INTO segments
                        (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
                        ON CONFLICT(meeting_id,id,version) DO UPDATE SET
                        text=excluded.text,user_edited=1""",
                    (
                        base["id"],
                        meeting_id,
                        base["revision"],
                        version,
                        base["track"],
                        base["start_ms"],
                        base["end_ms"],
                        base["speaker"],
                        text,
                        base["word_timestamps"],
                        base["translation"],
                    ),
                )

    def save_segment(self, payload):
        """插入或更新一段逐字稿。

        Args:
            payload: 至少包含会议 ID、段落 ID、文本及起止毫秒；可附带版本、
                revision、音轨、说话人、译文和人工编辑标记。

        已标记 ``user_edited`` 的同版本记录不会被自动识别结果覆盖。
        """
        with self.connect() as db:
            cursor = db.execute(
                """INSERT INTO segments
                    (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(meeting_id,id,version) DO UPDATE SET
                    revision=excluded.revision,end_ms=excluded.end_ms,speaker=excluded.speaker,
                    text=excluded.text,word_timestamps=excluded.word_timestamps,translation=excluded.translation
                    WHERE segments.user_edited=0""",
                _segment_row(payload),
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
                        "meeting_id": meeting_id,
                        "version": version,
                        "revision": revision,
                        "user_edited": 0,
                    }
                )
            db.execute(
                "DELETE FROM segments WHERE meeting_id=? AND version=?",
                (meeting_id, version),
            )
            db.executemany(
                """INSERT INTO segments
                    (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                [_segment_row(item) for item in normalized],
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
        返回是否写入：已删除的会议不再接受后台任务的迟到结果。
        """
        with self.connect() as db:
            result = db.execute(
                """INSERT INTO summaries(meeting_id,data,raw_response,created_at)
                   SELECT ?,?,?,? WHERE EXISTS(
                       SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL
                   )
                       ON CONFLICT(meeting_id) DO UPDATE SET
                       data=excluded.data,raw_response=excluded.raw_response,created_at=excluded.created_at""",
                (
                    meeting_id,
                    json.dumps(data, ensure_ascii=False) if data else None,
                    raw_response,
                    utc_now(),
                    meeting_id,
                ),
            )
        return result.rowcount > 0
