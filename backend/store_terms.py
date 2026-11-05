"""工作区词典。空工作区键对应公开工作区，与所有具名工作区隔离。"""

import re


def checked_workspace(db, workspace_id):
    if (
        workspace_id
        and not db.execute(
            "SELECT 1 FROM workspaces WHERE id=? AND deleted_at IS NULL", (workspace_id,)
        ).fetchone()
    ):
        raise ValueError("Workspace not found")
    return workspace_id or ""


def term_rows(db, workspace_id):
    return [
        dict(row)
        for row in db.execute(
            "SELECT wrong,correct,post_replace,hotword FROM workspace_terms "
            "WHERE workspace_id=? ORDER BY correct,wrong",
            (workspace_id or "",),
        )
    ]


def save_term(db, workspace_id, payload, *, remember=False):
    workspace_id = checked_workspace(db, workspace_id)
    wrong, correct = payload["wrong"].strip(), payload["correct"].strip()
    if (
        not wrong
        or not correct
        or wrong == correct
        or max(len(wrong), len(correct)) > 80
        or any(ord(c) < 32 for c in wrong + correct)
    ):
        raise ValueError("请输入两个不同的术语，每项最多 80 字")
    rows = term_rows(db, workspace_id)
    existing = next((row for row in rows if row["wrong"] == wrong), None)
    post, hot = bool(payload.get("post_replace")), bool(payload.get("hotword"))
    if remember and existing:
        if existing["correct"] != correct:
            raise ValueError("工作区已有不同的正确术语，请先编辑词条")
        post = post or bool(existing["post_replace"])
        hot = hot or bool(existing["hotword"])
    if not existing and len(rows) >= 128:
        raise ValueError("每个工作区最多保存 128 个词条")
    if hot:
        words = {row["correct"] for row in rows if row["hotword"] and row["wrong"] != wrong}
        words.add(correct)
        if "," in correct or sum(map(len, words)) + len(words) > 256:
            raise ValueError("识别热词合计限 256 字，单个热词不能含英文逗号")
    db.execute(
        "INSERT INTO workspace_terms VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,wrong) "
        "DO UPDATE SET correct=excluded.correct,post_replace=excluded.post_replace,hotword=excluded.hotword",
        (workspace_id, wrong, correct, post, hot),
    )


def workspace_replacements(db, meeting_id):
    return dict(
        db.execute(
            "SELECT wrong,correct FROM workspace_terms WHERE post_replace=1 AND workspace_id="
            "(SELECT COALESCE(workspace_id,'') FROM meetings WHERE id=?) ORDER BY length(wrong) DESC",
            (meeting_id,),
        )
    )


def post_replacer(db, meeting_id):
    rules = workspace_replacements(db, meeting_id)
    if not rules:
        return None
    pattern = re.compile("|".join(map(re.escape, rules)))

    def apply(payload):
        original = payload["text"]
        text = pattern.sub(lambda m: rules[m[0]], original)
        if text != original and len(text) <= 4000:
            payload.update(text=text, asr_text=original, word_timestamps=None)

    return apply


class TermStoreMixin:
    def workspace_terms(self, workspace_id):
        with self.connect() as db:
            return term_rows(db, checked_workspace(db, workspace_id))

    def write_workspace_term(self, payload):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workspace = checked_workspace(db, payload["workspace_id"])
            if payload.get("remove"):
                db.execute(
                    "DELETE FROM workspace_terms WHERE workspace_id=? AND wrong=?",
                    (workspace, payload["wrong"]),
                )
            else:
                save_term(db, workspace, payload)
            return term_rows(db, workspace)

    def asr_term_options(self, meeting):
        words = list(
            dict.fromkeys(
                row["correct"]
                for row in self.workspace_terms(meeting.get("workspace_id"))
                if row["hotword"]
            )
        )
        return {"hotwords": words} if words else {}
