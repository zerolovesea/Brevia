"""会议内文字替换、撤销与后续字幕规则；所有写入与段落共享一个事务。"""

import json
import re

from .transcript import latest_segments
from .markdown import normalize_summary_markdown
from .worker_common import UserFacingError


CONFLICT = "部分内容已变化，请更新预览"


def _editable_meeting(db, meeting_id, scope="transcript"):
    meeting = db.execute(
        "SELECT status,deleted_at FROM meetings WHERE id=?", (meeting_id,)
    ).fetchone()
    if not meeting or meeting["deleted_at"]:
        raise ValueError("Meeting not found")
    if scope == "transcript" and meeting["status"] == "refining":
        raise UserFacingError("error.transcript_conflict", CONFLICT)
    return meeting


def _current_segments(db, meeting_id, segment_id=None):
    """只读取当前精修轮次及人工覆盖；单句查询不加载其他段落。"""
    revision = db.execute(
        "SELECT MAX(revision) FROM segments WHERE meeting_id=? "
        "AND version GLOB 'postprocess*' AND TRIM(text)<>''",
        (meeting_id,),
    ).fetchone()[0]
    base = (
        "version GLOB 'postprocess*' AND revision=?" if revision is not None else "version='live'"
    )
    clauses = [
        "s.meeting_id=?",
        "s.id IN (SELECT id FROM base)",
        "(s.version='user' OR EXISTS(SELECT 1 FROM base b WHERE b.id=s.id AND b.version=s.version))",
    ]
    params = [meeting_id] + ([revision] if revision is not None else [])
    if segment_id is not None:
        base += " AND id=?"
        params.append(segment_id)
    params.append(meeting_id)
    return latest_segments(
        [
            dict(row)
            for row in db.execute(
                "WITH base AS (SELECT id,version FROM segments WHERE meeting_id=? AND "
                + base
                + " AND TRIM(text)<>'') "
                "SELECT s.*, COALESCE(p.name,s.speaker) AS speaker_name FROM segments s "
                "LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker "
                "WHERE " + " AND ".join(clauses),
                params,
            )
        ]
    )


def _correction_state(db, meeting_id):
    row = db.execute(
        "SELECT data FROM transcript_corrections WHERE meeting_id=?", (meeting_id,)
    ).fetchone()
    return (
        json.loads(row[0])
        if row
        else {
            "rules": [],
            "undo": None,
            "summary_stale": False,
            "stale_translations": [],
            "revision": 0,
        }
    )


def _save_correction_state(db, meeting_id, state):
    db.execute(
        "INSERT INTO transcript_corrections(meeting_id,data) VALUES (?,?) ON CONFLICT(meeting_id) DO UPDATE SET data=excluded.data",
        (meeting_id, json.dumps(state, ensure_ascii=False)),
    )


def _save_undo_entry(db, meeting_id, scope, segment_id, entry):
    db.execute(
        "INSERT OR REPLACE INTO correction_undo_entries(meeting_id,scope,segment_id,data) VALUES (?,?,?,?)",
        (meeting_id, scope, segment_id, json.dumps(entry, ensure_ascii=False)),
    )


def _undo_entries(db, meeting_id, scope):
    return [
        json.loads(row[0])
        for row in db.execute(
            "SELECT data FROM correction_undo_entries WHERE meeting_id=? AND scope=? ORDER BY segment_id",
            (meeting_id, scope),
        )
    ]


def _clear_undo_entries(db, meeting_id, scope):
    db.execute(
        "DELETE FROM correction_undo_entries WHERE meeting_id=? AND scope=?", (meeting_id, scope)
    )


def migrate_correction_undo(db):
    """一次性拆出旧撤销内容；规则热路径只读取有界元数据，撤销仍保持完整。"""
    key = "correction_undo_entries_v1"
    if db.execute("SELECT 1 FROM app_meta WHERE key=?", (key,)).fetchone():
        return
    for row in db.execute("SELECT meeting_id,data FROM transcript_corrections").fetchall():
        meeting_id, state = row[0], json.loads(row[1])
        undo = state.get("undo")
        if undo:
            for entry in undo.pop("entries", []):
                _save_undo_entry(db, meeting_id, "transcript", entry["after"]["id"], entry)
        for scope, entry in state.get("document_undo", {}).items():
            if "before" in entry:
                _save_undo_entry(db, meeting_id, scope, "", entry)
                state["document_undo"][scope] = {"count": entry["count"]}
        _save_correction_state(db, meeting_id, state)
    db.execute("INSERT INTO app_meta(key,value) VALUES (?,?)", (key, "1"))


def _write_correction(db, meeting_id, base, text):
    if not text.strip() or len(text) > 4000:
        raise UserFacingError("error.transcript_limit", "字幕内容不能为空，且每段不能超过 4000 字")
    version = "live" if base["version"] == "live" else "user"
    db.execute(
        """INSERT INTO segments
        (id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(meeting_id,id,version)
        DO UPDATE SET text=excluded.text,user_edited=1""",
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
    return {**base, "version": version, "text": text, "user_edited": 1}


def _mark_correction_stale(db, meeting_id, state, segments):
    state["revision"] = state.get("revision", 0) + 1
    ids = set(state["stale_translations"])
    ids.update(segment["id"] for segment in segments if segment.get("translation"))
    state["stale_translations"] = sorted(ids)
    if db.execute("SELECT 1 FROM summaries WHERE meeting_id=?", (meeting_id,)).fetchone():
        state["summary_stale"] = True


def _check_correction_base(base, expected):
    if not base or any(base[key] != expected[key] for key in ("text", "version", "revision")):
        raise UserFacingError("error.transcript_conflict", CONFLICT)


def _replace_occurrences(text, find, replacement, selected):
    if (
        not isinstance(find, str)
        or not isinstance(replacement, str)
        or not find.strip()
        or not replacement.strip()
        or find == replacement
        or max(len(find), len(replacement)) > 4000
    ):
        raise ValueError("请输入不同的查找文字和替换文字")
    offsets = [item.start() for item in re.finditer(re.escape(find), text)]
    if (
        not isinstance(selected, list)
        or not selected
        or len(selected) > 4000
        or any(type(index) is not int or index < 0 or index >= len(offsets) for index in selected)
        or len(set(selected)) != len(selected)
    ):
        raise UserFacingError("error.transcript_conflict", CONFLICT)
    for index in sorted(selected, reverse=True):
        offset = offsets[index]
        text = text[:offset] + replacement + text[offset + len(find) :]
    return text


def _correct_document(db, meeting_id, state, scope, payload):
    if payload.get("future"):
        raise ValueError("后续字幕规则仅适用于逐字稿")
    if scope == "notes":
        text = (
            db.execute("SELECT notes FROM meetings WHERE id=?", (meeting_id,)).fetchone()[0] or ""
        )
    else:
        row = db.execute("SELECT data FROM summaries WHERE meeting_id=?", (meeting_id,)).fetchone()
        data = json.loads(row[0]) if row and row[0] else {}
        text = normalize_summary_markdown(data.get("markdown", ""))
    undo_by_scope = state.setdefault("document_undo", {})
    if payload["action"] == "undo":
        entries = _undo_entries(db, meeting_id, scope)
        undo = entries[0] if entries else None
        if not undo or text != undo["after"]:
            raise UserFacingError("error.transcript_conflict", CONFLICT)
        updated = undo["before"]
        undo_by_scope.pop(scope)
        _clear_undo_entries(db, meeting_id, scope)
    elif payload["action"] == "replace":
        document = payload.get("document", {})
        if text != document.get("text"):
            raise UserFacingError("error.transcript_conflict", CONFLICT)
        updated = _replace_occurrences(
            text, payload.get("find"), payload.get("replacement"), document.get("occurrences")
        )
        if len(updated) > 5 * 1024 * 1024:
            raise ValueError("内容超过容量上限")
        count = len(document["occurrences"])
        _save_undo_entry(
            db, meeting_id, scope, "", {"before": text, "after": updated, "count": count}
        )
        undo_by_scope[scope] = {"count": count}
    else:
        raise ValueError("Unknown correction action")
    if scope == "notes":
        db.execute("UPDATE meetings SET notes=? WHERE id=?", (updated, meeting_id))
    else:
        data["markdown"] = updated
        db.execute(
            "UPDATE summaries SET data=?,raw_response=? WHERE meeting_id=?",
            (json.dumps(data, ensure_ascii=False), updated, meeting_id),
        )
    _save_correction_state(db, meeting_id, state)


class CorrectionStoreMixin:
    def transcript_correction(self, meeting_id, payload):
        """按预览快照提交替换/撤销；先锁定事务，避免识别线程在校验后抢写。"""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            scope = payload.get("scope", "transcript")
            if scope not in ("transcript", "notes", "summary"):
                raise ValueError("Unknown correction scope")
            meeting = _editable_meeting(db, meeting_id, scope)
            state = _correction_state(db, meeting_id)
            if scope != "transcript":
                _correct_document(db, meeting_id, state, scope, payload)
                return
            current = {item["id"]: item for item in _current_segments(db, meeting_id)}
            action = payload.get("action")
            if action == "disable":
                for rule in state["rules"]:
                    if rule["find"] == payload.get("find"):
                        rule["enabled"] = False
            elif action == "undo":
                undo = state["undo"]
                if not undo:
                    raise ValueError("没有可撤销的替换")
                entries = _undo_entries(db, meeting_id, "transcript")
                for entry in entries:
                    _check_correction_base(current.get(entry["after"]["id"]), entry["after"])
                for entry in entries:
                    _write_correction(
                        db, meeting_id, current[entry["after"]["id"]], entry["before"]["text"]
                    )
                if undo.get("rule"):
                    state["rules"] = [
                        rule for rule in state["rules"] if rule["find"] != undo["rule"]
                    ]
                    if undo.get("previous_rule"):
                        state["rules"].append(undo["previous_rule"])
                _mark_correction_stale(
                    db, meeting_id, state, [current[entry["after"]["id"]] for entry in entries]
                )
                state["undo"] = None
                _clear_undo_entries(db, meeting_id, "transcript")
            elif action == "replace":
                find, replacement = payload.get("find"), payload.get("replacement")
                if (
                    not isinstance(find, str)
                    or not isinstance(replacement, str)
                    or not find.strip()
                    or not replacement.strip()
                    or find == replacement
                    or max(len(find), len(replacement)) > 4000
                ):
                    raise ValueError("请输入不同的查找文字和替换文字")
                matches = payload.get("matches")
                if not isinstance(matches, list) or not 1 <= len(matches) <= 500:
                    raise UserFacingError("error.transcript_limit", "每批最多替换 500 段")
                entries, count, total = [], 0, 0
                seen = set()
                for match in matches:
                    segment_id = match["segment_id"]
                    if segment_id in seen:
                        raise ValueError("重复段落")
                    seen.add(segment_id)
                    base = current.get(segment_id)
                    _check_correction_base(base, match)
                    selected = match["occurrences"]
                    text = _replace_occurrences(base["text"], find, replacement, selected)
                    total += len(text)
                    if total > 60000:
                        raise UserFacingError(
                            "error.transcript_limit", "每批最多保存 60000 字，请缩小替换范围"
                        )
                    after = _write_correction(db, meeting_id, base, text)
                    entries.append({"before": base, "after": after})
                    count += len(selected)
                previous = next((rule for rule in state["rules"] if rule["find"] == find), None)
                enabled = bool(payload.get("future"))
                if enabled:
                    if meeting["status"] not in ("recording", "paused", "interrupted"):
                        raise UserFacingError(
                            "error.transcript_ended", "录音已结束，后续字幕规则未启用，请更新预览"
                        )
                    if (
                        previous
                        and previous["replacement"] != replacement
                        and not payload.get("confirm_rule")
                    ):
                        raise UserFacingError(
                            "error.transcript_rule_conflict", "本场已有不同的替换规则，请确认更新"
                        )
                    state["rules"] = [rule for rule in state["rules"] if rule["find"] != find]
                    state["rules"].append(
                        {"find": find, "replacement": replacement, "enabled": True}
                    )
                _clear_undo_entries(db, meeting_id, "transcript")
                for entry in entries:
                    _save_undo_entry(db, meeting_id, "transcript", entry["after"]["id"], entry)
                state["undo"] = {
                    "count": count,
                    "replacement": replacement,
                    "rule": find if enabled else None,
                    "previous_rule": previous,
                }
                _mark_correction_stale(
                    db, meeting_id, state, [entry["before"] for entry in entries]
                )
            else:
                raise ValueError("Unknown correction action")
            _save_correction_state(db, meeting_id, state)

    def _apply_transcript_rules(self, db, payload):
        """仅对首次落库的实时段落按原文匹配一次，不递归替换结果。"""
        meeting_id = payload["meeting_id"]
        if (
            payload.get("version", "live") != "live"
            or db.execute(
                "SELECT 1 FROM segments WHERE meeting_id=? AND id=?",
                (meeting_id, payload["segment_id"]),
            ).fetchone()
        ):
            return
        meeting = db.execute("SELECT status FROM meetings WHERE id=?", (meeting_id,)).fetchone()
        if not meeting or meeting["status"] not in ("recording", "paused", "interrupted"):
            return
        state = _correction_state(db, meeting_id)
        rules = sorted(
            (rule for rule in state["rules"] if rule["enabled"]),
            key=lambda rule: -len(rule["find"]),
        )
        if not rules:
            return
        original = payload["text"]
        pattern = "|".join(re.escape(rule["find"]) for rule in rules)
        replacements = {rule["find"]: rule["replacement"] for rule in rules}
        text = re.sub(pattern, lambda match: replacements[match[0]], original)
        if text == original:
            return
        if len(text) > 4000:
            for rule in state["rules"]:
                rule["enabled"] = False
            _save_correction_state(db, meeting_id, state)
            payload["correction_error"] = "后续字幕替换超过 4000 字，已停用本场规则并保留识别原文"
            payload["correction_error_code"] = "error.transcript_rule_limit"
            return
        text = text.strip()
        payload.update(text=text, user_edited=True)
        undo = state["undo"]
        tracked = [
            match
            for match in re.finditer(pattern, original)
            if undo and match[0] == undo.get("rule")
        ]
        if tracked:
            before = re.sub(
                pattern,
                lambda match: match[0] if match[0] == undo["rule"] else replacements[match[0]],
                original,
            )
            base = {
                "id": payload["segment_id"],
                "text": before,
                "version": "live",
                "revision": int(payload.get("revision", 0)),
                "translation": payload.get("translation"),
            }
            _save_undo_entry(
                db,
                meeting_id,
                "transcript",
                payload["segment_id"],
                {"before": base, "after": {**base, "text": text}},
            )
            undo["count"] += len(tracked)
        _mark_correction_stale(db, meeting_id, state, [])
        _save_correction_state(db, meeting_id, state)
