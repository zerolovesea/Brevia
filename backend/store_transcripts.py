"""聚焦存储职责的组件。"""

import json

from .store_base import utc_now
from .store_corrections import (
    CorrectionStoreMixin,
    _check_correction_base,
    _clear_undo_entries,
    _correction_state,
    _current_segments,
    _editable_meeting,
    _mark_correction_stale,
    _save_correction_state,
    _write_correction,
)


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
        json.dumps(payload.get("word_timestamps"), ensure_ascii=False)
        if payload.get("word_timestamps")
        else None,
        payload.get("translation"),
        int(payload.get("user_edited", False)),
    )


class TranscriptStoreMixin(CorrectionStoreMixin):
    def translation_context(self, meeting_id, segment_id):
        """翻译仅需会议语言与当前单句，不读取音频、纪要或完整历史。"""
        with self.connect() as db:
            meeting = db.execute(
                "SELECT id,target_language FROM meetings WHERE id=? AND deleted_at IS NULL",
                (meeting_id,),
            ).fetchone()
            if not meeting:
                raise ValueError("Meeting not found")
            segments = _current_segments(db, meeting_id, segment_id)
        return dict(meeting), segments[0] if segments else None

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
        if not edits or len(edits) > 500:
            raise ValueError("每批最多保存 500 段")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            _editable_meeting(db, meeting_id)
            current = {item["id"]: item for item in _current_segments(db, meeting_id)}
            state = _correction_state(db, meeting_id)
            changed = []
            total = 0
            for edit in edits:
                text = " ".join(str(edit.get("text") or "").split())
                if not text:
                    raise ValueError("Subtitle text cannot be empty")
                total += len(text)
                if total > 60000:
                    raise ValueError("每批最多保存 60000 字")
                base = current.get(edit["segment_id"])
                if not base:
                    raise ValueError("Segment not found")
                if "expected" in edit:
                    _check_correction_base(base, edit["expected"])
                _write_correction(db, meeting_id, base, text)
                changed.append(base)
            _mark_correction_stale(db, meeting_id, state, changed)
            _save_correction_state(db, meeting_id, state)

    def save_segment(self, payload):
        """插入或更新一段逐字稿。

        Args:
            payload: 至少包含会议 ID、段落 ID、文本及起止毫秒；可附带版本、
                revision、音轨、说话人、译文和人工编辑标记。

        已标记 ``user_edited`` 的同版本记录不会被自动识别结果覆盖。
        """
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._apply_transcript_rules(db, payload)
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

    def replace_segments(
        self,
        meeting_id,
        segments,
        version="postprocess",
        revision=0,
        *,
        model_id=None,
        language=None,
    ):
        """原子替换一次精修生成的全部段落，保留用户编辑版本。"""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = _correction_state(db, meeting_id)
            state["undo"] = None
            _clear_undo_entries(db, meeting_id, "transcript")
            _mark_correction_stale(db, meeting_id, state, _current_segments(db, meeting_id))
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
            if model_id is not None:
                db.execute(
                    "UPDATE meetings SET transcript_model_id=?, refined_model_id=?, language=?, status='refined' WHERE id=?",
                    (model_id, model_id, language, meeting_id),
                )
            current_ids = {item["id"] for item in _current_segments(db, meeting_id)}
            state["stale_translations"] = sorted(set(state["stale_translations"]) & current_ids)
            _save_correction_state(db, meeting_id, state)
        return normalized

    def save_translation(
        self,
        meeting_id,
        segment_id,
        translation,
        *,
        expected_text=None,
        expected_version=None,
        target_language=None,
    ):
        """只更新源文本及版本仍一致的译文；旧推理不能覆盖新的人工稿。"""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = _current_segments(db, meeting_id, segment_id)
            base = current[0] if current else None
            if not base or (expected_text is not None and base["text"] != expected_text):
                return False
            if (
                expected_version is not None
                and (base["version"], base["revision"]) != expected_version
            ):
                return False
            state = _correction_state(db, meeting_id)
            if segment_id in state["stale_translations"]:
                state["stale_translations"].remove(segment_id)
                _save_correction_state(db, meeting_id, state)
            db.execute(
                "UPDATE segments SET translation=? WHERE meeting_id=? AND id=? AND text=?",
                (translation, meeting_id, segment_id, base["text"]),
            )
            if target_language is not None:
                db.execute(
                    "UPDATE meetings SET target_language=? WHERE id=? AND target_language IS NOT ?",
                    (target_language, meeting_id, target_language),
                )
            return True

    def rename_speaker(self, meeting_id, speaker_id, name, locked=False, profile_id=None):
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

    def save_summary(self, meeting_id, data, raw_response, *, expected_revision=None):
        """保存结构化纪要及供应商原始响应。

        解析失败时 ``data`` 可为空，原始响应仍会留下，便于排查而不必重发文本。
        返回是否写入：已删除的会议不再接受后台任务的迟到结果。
        """
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = _correction_state(db, meeting_id)
            state["summary_stale"] = (
                expected_revision is not None and state.get("revision", 0) != expected_revision
            )
            if db.execute(
                "SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL", (meeting_id,)
            ).fetchone():
                _save_correction_state(db, meeting_id, state)
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
