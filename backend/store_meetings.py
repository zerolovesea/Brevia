"""Focused storage responsibility component."""

import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .config import SETTINGS
from .store_base import utc_now


def example_note(example):
    """返回与界面语言一致的示例会议纪要。"""
    notes = {
        "zh": "## **会议摘要**\n\n会议确认了新用户引导的上线范围。设计已完成，研发将在周四交付测试版本；团队计划周五前完成内部验收，并于下周一开始小范围发布。\n\n## **核心结论**\n\n- 新用户引导按既定范围上线。\n- 周四交付测试版本，周五前完成内部验收。\n\n## **已确认决定**\n\n- 决定：下周一开始小范围发布。\n- 确认方：会议参与者。\n\n## **行动项**\n\n| **任务** | **负责人** | **截止时间** | **状态** |\n| -------- | ---------- | ------------ | -------- |\n| 交付测试版本 | 开发团队 | 周四 | 待开始 |\n| 完成内部验收 | 未明确 | 周五前 | 待开始 |",
        "en": "## **Meeting Summary**\n\nThe team confirmed the launch scope for the new-user onboarding flow. Design is complete, engineering will deliver a test build on Thursday, and a limited rollout will begin next Monday after internal acceptance.\n\n## **Key Conclusions**\n\n- The onboarding flow will launch within the agreed scope.\n- The test build is due Thursday and internal acceptance is due by Friday.\n\n## **Confirmed Decisions**\n\n- Decision: Begin a limited rollout next Monday.\n- Confirmed by: Meeting participants.\n\n## **Action Items**\n\n| **Task** | **Owner** | **Due date** | **Status** |\n| -------- | ---------- | ------------ | ---------- |\n| Deliver the test build | Engineering team | Thursday | Not started |\n| Complete internal acceptance | Not specified | By Friday | Not started |",
        "es": "## **Resumen de la reunión**\n\nEl equipo confirmó el alcance del lanzamiento del flujo de incorporación de nuevos usuarios. El diseño está listo, ingeniería entregará una versión de prueba el jueves y el lanzamiento limitado empezará el próximo lunes tras la validación interna.\n\n## **Conclusiones clave**\n\n- El flujo de incorporación se lanzará dentro del alcance acordado.\n- La versión de prueba se entrega el jueves y la validación interna termina antes del viernes.\n\n## **Decisiones confirmadas**\n\n- Decisión: Iniciar un lanzamiento limitado el próximo lunes.\n- Confirmado por: Participantes de la reunión.\n\n## **Acciones**\n\n| **Tarea** | **Responsable** | **Fecha límite** | **Estado** |\n| --------- | --------------- | ---------------- | ---------- |\n| Entregar la versión de prueba | Equipo de ingeniería | Jueves | Sin iniciar |\n| Completar la validación interna | No especificado | Antes del viernes | Sin iniciar |",
        "ja": "## **会議概要**\n\nチームは新規ユーザー向けオンボーディングのリリース範囲を確認しました。デザインは完了しており、開発チームは木曜日にテストビルドを提供し、社内受け入れ後の翌週月曜日に限定公開を開始します。\n\n## **主要な結論**\n\n- 合意した範囲でオンボーディングをリリースします。\n- テストビルドは木曜日、社内受け入れは金曜日までです。\n\n## **確定した決定**\n\n- 決定：翌週月曜日に限定公開を開始する。\n- 確認者：会議参加者。\n\n## **アクション項目**\n\n| **タスク** | **担当者** | **期限** | **状態** |\n| ---------- | ---------- | -------- | -------- |\n| テストビルドを提供する | 開発チーム | 木曜日 | 未着手 |\n| 社内受け入れを完了する | 未確認 | 金曜日まで | 未着手 |",
        "ko": "## **회의 요약**\n\n팀은 신규 사용자 온보딩 흐름의 출시 범위를 확정했습니다. 디자인은 완료되었고 개발팀은 목요일에 테스트 빌드를 제공하며, 내부 승인 후 다음 주 월요일에 제한 출시를 시작합니다.\n\n## **핵심 결론**\n\n- 합의된 범위 안에서 온보딩 흐름을 출시합니다.\n- 테스트 빌드는 목요일까지, 내부 승인은 금요일까지 완료합니다.\n\n## **확정된 결정**\n\n- 결정: 다음 주 월요일에 제한 출시를 시작합니다.\n- 확인자: 회의 참석자.\n\n## **실행 항목**\n\n| **작업** | **담당자** | **기한** | **상태** |\n| -------- | ---------- | -------- | -------- |\n| 테스트 빌드 제공 | 개발팀 | 목요일 | 시작 전 |\n| 내부 승인 완료 | 미정 | 금요일까지 | 시작 전 |",
        "fr": "## **Résumé de la réunion**\n\nL’équipe a confirmé le périmètre de lancement du parcours d’accueil des nouveaux utilisateurs. La conception est terminée, l’équipe d’ingénierie livrera une version de test jeudi et un déploiement limité commencera lundi prochain après la validation interne.\n\n## **Conclusions clés**\n\n- Le parcours d’accueil sera lancé dans le périmètre convenu.\n- La version de test est attendue jeudi et la validation interne avant vendredi.\n\n## **Décisions confirmées**\n\n- Décision : commencer un déploiement limité lundi prochain.\n- Confirmé par : les participants à la réunion.\n\n## **Actions**\n\n| **Tâche** | **Responsable** | **Échéance** | **Statut** |\n| --------- | --------------- | ------------ | ---------- |\n| Livrer la version de test | Équipe d’ingénierie | Jeudi | Non commencé |\n| Finaliser la validation interne | Non précisé | Avant vendredi | Non commencé |",
        "de": "## **Besprechungszusammenfassung**\n\nDas Team hat den Umfang für den Start des neuen Onboarding-Ablaufs bestätigt. Das Design ist fertig, das Entwicklungsteam liefert am Donnerstag einen Test-Build und nach der internen Abnahme beginnt nächsten Montag eine begrenzte Einführung.\n\n## **Kernpunkte**\n\n- Der Onboarding-Ablauf wird im vereinbarten Umfang gestartet.\n- Der Test-Build ist am Donnerstag, die interne Abnahme bis Freitag fällig.\n\n## **Bestätigte Entscheidungen**\n\n- Entscheidung: Begrenzte Einführung ab nächsten Montag.\n- Bestätigt durch: Die Besprechungsteilnehmer.\n\n## **Aufgaben**\n\n| **Aufgabe** | **Verantwortlich** | **Frist** | **Status** |\n| ----------- | ------------------ | --------- | ---------- |\n| Test-Build liefern | Entwicklungsteam | Donnerstag | Nicht begonnen |\n| Interne Abnahme abschließen | Nicht angegeben | Bis Freitag | Nicht begonnen |",
        "ru": "## **Краткое содержание встречи**\n\nКоманда подтвердила объём запуска нового сценария адаптации пользователей. Дизайн готов, команда разработки предоставит тестовую сборку в четверг, а ограниченный запуск начнётся в следующий понедельник после внутренней приёмки.\n\n## **Ключевые выводы**\n\n- Сценарий адаптации будет запущен в согласованном объёме.\n- Тестовая сборка должна быть готова в четверг, внутренняя приёмка — к пятнице.\n\n## **Подтверждённые решения**\n\n- Решение: начать ограниченный запуск в следующий понедельник.\n- Подтвердили: участники встречи.\n\n## **Задачи**\n\n| **Задача** | **Ответственный** | **Срок** | **Статус** |\n| ---------- | ----------------- | -------- | ---------- |\n| Предоставить тестовую сборку | Команда разработки | Четверг | Не начато |\n| Завершить внутреннюю приёмку | Не указан | До пятницы | Не начато |",
    }
    return f"# **{example['title']}**\n\n{notes[example['locale']]}"


class MeetingStoreMixin:
    def recover_interrupted_meetings(self):
        """Finalize interrupted recordings and make interrupted refinement retryable."""
        with self.connect() as db:
            meetings = db.execute(
                "SELECT id,status FROM meetings WHERE status IN ('recording','refining')"
            ).fetchall()
        recovered = []
        for meeting in meetings:
            if meeting["status"] == "recording":
                manifest = self.read_manifest(meeting["id"])
                duration_ms = max(
                    (
                        round(track.get("samples", 0) * 1000 / track.get("sample_rate", 16000))
                        for track in manifest.get("tracks", {}).values()
                    ),
                    default=0,
                )
                try:
                    self.finish_meeting(meeting["id"], duration_ms)
                except (OSError, ValueError):
                    self.set_status(meeting["id"], "ready")
            else:
                self.set_status(meeting["id"], "ready")
            recovered.append(meeting["id"])
        return recovered

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
            payload.get("speaker_segmentation_model_id"),
            payload.get("speaker_embedding_model_id"),
            payload.get("vad_model_id", "silero-vad"),
            int(payload.get("num_speakers", -1)),
            payload.get("category", ""),
            json.dumps(payload.get("tags", []), ensure_ascii=False),
            "recording",
            now,
            now,
        )
        meeting_dir = self.meetings_dir / meeting_id
        if meeting_dir.exists():
            raise ValueError("Meeting data already exists")
        try:
            (meeting_dir / "audio").mkdir(parents=True)
            (meeting_dir / "exports").mkdir()
            self.write_manifest(
                meeting_id, {"meeting_id": meeting_id, "closed": False, "tracks": {}}
            )
            with self.connect() as db:
                db.execute(
                    """INSERT INTO meetings
                        (id,title,language,target_language,streaming_model_id,refined_model_id,
                         speaker_segmentation_model_id,speaker_embedding_model_id,vad_model_id,num_speakers,category,tags,status,created_at,started_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    values,
                )
        except Exception:
            shutil.rmtree(meeting_dir, ignore_errors=True)
            raise
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
        clauses.append(
            "deleted_at IS NOT NULL" if include_deleted else "deleted_at IS NULL"
        )
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
        """按版本写入所有界面语言的示例会议和录音。

        已被用户删除的示例带有 tombstone，升级种子数据时也不会重新创建。

        Returns:
            本次是否执行了种子写入；同一版本重复调用返回 ``False``。
        """
        fixture_root = Path(__file__).with_name("fixtures")
        examples = json.loads(
            Path(__file__).with_name("examples.json").read_text(encoding="utf-8")
        )
        with self.connect() as db:
            if db.execute(
                "SELECT 1 FROM app_meta WHERE key='examples_seeded_v5'"
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
                        example.get("language", example["locale"]),
                        example.get("target_language", "en" if example["locale"] == "zh" else "zh"),
                        "paraformer-zh-en-int8",
                        "funasr-nano-int8",
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
                db.execute("DELETE FROM segments WHERE meeting_id=?", (example["id"],))
                db.executemany(
                    """INSERT INTO segments
                        (id,meeting_id,version,track,start_ms,end_ms,speaker,text,translation)
                        VALUES(?,?,?,?,?,?,?,?,?)
                    """,
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
                        for index, (
                            start,
                            end,
                            speaker,
                            text,
                            translation,
                        ) in enumerate(example["segments"], 1)
                    ),
                )
                db.execute(
                    """INSERT INTO summaries(meeting_id,data,raw_response,created_at) VALUES(?,?,?,?)
                       ON CONFLICT(meeting_id) DO UPDATE SET
                       data=excluded.data,raw_response=excluded.raw_response,created_at=excluded.created_at""",
                    (example["id"], json.dumps({"markdown": example_note(example)}, ensure_ascii=False), "example", now),
                )
            db.execute(
                "INSERT INTO app_meta(key,value) VALUES('examples_seeded_v5',?)",
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
            row = db.execute(
                "SELECT * FROM meetings WHERE id=?", (meeting_id,)
            ).fetchone()
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
                "SELECT id,name,profile_id,locked FROM speakers WHERE meeting_id=? ORDER BY id",
                (meeting_id,),
            ).fetchall()
            speaker_turns = db.execute(
                "SELECT version,start_ms,end_ms,speaker FROM speaker_turns "
                "WHERE meeting_id=? ORDER BY start_ms,end_ms",
                (meeting_id,),
            ).fetchall()
        result = self._meeting(row)
        result["segments"] = [
            {**dict(segment), "word_timestamps": json.loads(segment["word_timestamps"]) if segment["word_timestamps"] else []}
            for segment in segments
        ]
        result["speakers"] = [dict(speaker) for speaker in speakers]
        result["speaker_turns"] = [dict(turn) for turn in speaker_turns]
        result["summary"] = (
            {
                **dict(summary),
                "data": json.loads(summary["data"]) if summary["data"] else None,
            }
            if summary
            else None
        )
        result["audio"] = self.audio_files(meeting_id)
        return result

    def update_meeting(self, meeting_id, updates):
        """更新允许用户编辑的会议字段并返回最新详情。

        ``updates`` 只接受标题、分类、标签和归档时间，其他键会被忽略。
        """
        allowed = {"title", "category", "tags", "archived_at", "refined_model_id"}
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
        for track in ("mic", "system"):
            self._build_playback(meeting_id, track)
        self._build_mix(meeting_id)
        with self.connect() as db:
            db.execute(
                "UPDATE meetings SET status='ready',ended_at=?,duration_ms=? WHERE id=?",
                (utc_now(), max(0, int(duration_ms)), meeting_id),
            )
        manifest = self.read_manifest(meeting_id)
        manifest["closed"] = True
        try:
            self.write_manifest(meeting_id, manifest)
        except Exception:
            with self.connect() as db:
                db.execute(
                    "UPDATE meetings SET status='recording',ended_at=NULL,duration_ms=0 WHERE id=?",
                    (meeting_id,),
                )
            raise
        return self.get_meeting(meeting_id)

    def finish_imported_meeting(self, meeting_id, duration_ms):
        """关闭已规范化的单文件导入音频，而不重建录音分块。"""
        with self.connect() as db:
            db.execute(
                "UPDATE meetings SET status='ready',ended_at=?,duration_ms=? WHERE id=?",
                (utc_now(), max(0, int(duration_ms)), meeting_id),
            )
        manifest = self.read_manifest(meeting_id)
        manifest["source"] = "audio_import"
        manifest["closed"] = True
        self.write_manifest(meeting_id, manifest)
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
        with self.connect() as db:
            db.execute("DELETE FROM meetings WHERE id=?", (meeting_id,))
        shutil.rmtree(self.meetings_dir / meeting_id, ignore_errors=True)

    @staticmethod
    def _meeting(row):
        """把 SQLite 会议行转为字典，并还原 JSON 标签。"""
        result = dict(row)
        result["tags"] = json.loads(result["tags"])
        return result
