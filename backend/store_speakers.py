"""聚焦存储职责的组件。"""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .config import SETTINGS
from .store_base import utc_now


class SpeakerProfileStoreMixin:
    def list_speaker_profiles(self):
        """返回本地声纹库的人员摘要，不暴露原始声纹向量。"""
        with self.connect() as db:
            rows = db.execute(
                """SELECT id,name,sample_count,created_at,updated_at,
                       COALESCE((SELECT SUM(duration_ms) FROM speaker_profile_samples sample WHERE sample.profile_id=speaker_profiles.id),0) AS duration_ms
                       FROM speaker_profiles ORDER BY name COLLATE NOCASE"""
            ).fetchall()
        return [dict(row) for row in rows]

    def list_speaker_profile_samples(self, profile_id):
        """返回人员的句级录音档案，不暴露单条声纹向量。"""
        self.speaker_profile(profile_id)
        with self.connect() as db:
            rows = db.execute(
                """SELECT id,profile_id,source_key,created_at,audio_path,duration_ms
                       FROM speaker_profile_samples WHERE profile_id=? ORDER BY created_at DESC""",
                (profile_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def speaker_profile(self, profile_id):
        """根据 ID 获取单个人员档案详情。"""
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM speaker_profiles WHERE id=?", (profile_id,)
            ).fetchone()
        if not row:
            raise ValueError("Speaker profile not found")
        return dict(row)

    def ensure_speaker_profile(self, name):
        """确保人工命名的人员立即拥有本地档案。

        人工标注是明确的身份意图，但实时片段可能还不足以提取稳定声纹；先
        保存空档案以维持会议与人员库的关联，后续样本会在同一档案上补全。
        """
        name = name.strip()
        if not name:
            raise ValueError("Speaker name cannot be empty")
        now = utc_now()
        with self.connect() as db:
            profile = db.execute(
                "SELECT * FROM speaker_profiles WHERE name=? COLLATE NOCASE", (name,)
            ).fetchone()
            if not profile:
                profile_id = str(uuid4())
                db.execute(
                    "INSERT INTO speaker_profiles(id,name,embedding,sample_count,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                    (profile_id, name, "[]", 0, now, now),
                )
            else:
                profile_id = profile["id"]
        return self.speaker_profile(profile_id)

    @staticmethod
    def _normalized_embedding(embedding):
        """归一化声纹向量到单位长度。"""
        values = [float(value) for value in embedding]
        norm = sum(value * value for value in values) ** 0.5
        if not norm:
            raise ValueError("Speaker embedding is empty")
        return [value / norm for value in values]

    def save_speaker_profile_sample(
        self,
        name,
        embedding,
        source_key,
        profile_id=None,
        audio_path=None,
        duration_ms=0,
    ):
        """保存一条声纹样本，并以所有样本的归一化中心更新人员声纹。"""
        normalized = self._normalized_embedding(embedding)
        now = utc_now()
        with self.connect() as db:
            if profile_id:
                profile = db.execute(
                    "SELECT * FROM speaker_profiles WHERE id=?", (profile_id,)
                ).fetchone()
            else:
                profile = db.execute(
                    "SELECT * FROM speaker_profiles WHERE name=? COLLATE NOCASE",
                    (name.strip(),),
                ).fetchone()
            if not profile:
                profile_id = str(uuid4())
                db.execute(
                    "INSERT INTO speaker_profiles(id,name,embedding,sample_count,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                    (profile_id, name.strip(), json.dumps(normalized), 0, now, now),
                )
                profile = db.execute(
                    "SELECT * FROM speaker_profiles WHERE id=?", (profile_id,)
                ).fetchone()
            elif json.loads(profile["embedding"]) and len(
                json.loads(profile["embedding"])
            ) != len(normalized):
                raise ValueError(
                    "Voiceprint model does not match this person's registered samples"
                )
            profile_id = profile["id"]
            existing = db.execute(
                "SELECT id FROM speaker_profile_samples WHERE source_key=?",
                (source_key,),
            ).fetchone()
            if existing:
                saved = False
                if audio_path:
                    db.execute(
                        "UPDATE speaker_profile_samples SET audio_path=?,duration_ms=? WHERE id=?",
                        (audio_path, int(duration_ms), existing["id"]),
                    )
            else:
                usage = db.execute(
                    "SELECT COUNT(*) AS samples,COALESCE(SUM(duration_ms),0) AS duration_ms FROM speaker_profile_samples WHERE profile_id=?",
                    (profile_id,),
                ).fetchone()
                limits = SETTINGS["voice_profiles"]
                if usage["samples"] >= limits["max_samples"]:
                    raise ValueError(
                        f"A voiceprint can contain at most {limits['max_samples']} recordings"
                    )
                if (
                    usage["duration_ms"] + int(duration_ms)
                    > limits["max_total_seconds"] * 1000
                ):
                    raise ValueError(
                        f"Voiceprint recordings can total at most {limits['max_total_seconds']} seconds"
                    )
                db.execute(
                    "INSERT INTO speaker_profile_samples(id,profile_id,source_key,embedding,created_at,audio_path,duration_ms) VALUES(?,?,?,?,?,?,?)",
                    (
                        str(uuid4()),
                        profile_id,
                        source_key,
                        json.dumps(normalized),
                        now,
                        audio_path,
                        int(duration_ms),
                    ),
                )
                samples = [
                    json.loads(row["embedding"])
                    for row in db.execute(
                        "SELECT embedding FROM speaker_profile_samples WHERE profile_id=?",
                        (profile_id,),
                    )
                ]
                center = self._normalized_embedding(
                    [sum(values) / len(samples) for values in zip(*samples)]
                )
                db.execute(
                    "UPDATE speaker_profiles SET embedding=?,sample_count=?,updated_at=? WHERE id=?",
                    (json.dumps(center), len(samples), now, profile_id),
                )
                saved = True
        return {**self.speaker_profile(profile_id), "added": saved}

    def delete_speaker_profile_sample(self, profile_id, sample_id):
        """删除一句存档录音，并用剩余样本增量重算声纹中心。"""
        with self.connect() as db:
            sample = db.execute(
                "SELECT audio_path FROM speaker_profile_samples WHERE id=? AND profile_id=?",
                (sample_id, profile_id),
            ).fetchone()
            if not sample:
                return self.speaker_profile(profile_id)
            db.execute("DELETE FROM speaker_profile_samples WHERE id=?", (sample_id,))
            samples = [
                json.loads(row["embedding"])
                for row in db.execute(
                    "SELECT embedding FROM speaker_profile_samples WHERE profile_id=?",
                    (profile_id,),
                )
            ]
            center = (
                self._normalized_embedding(
                    [sum(values) / len(samples) for values in zip(*samples)]
                )
                if samples
                else []
            )
            db.execute(
                "UPDATE speaker_profiles SET embedding=?,sample_count=?,updated_at=? WHERE id=?",
                (json.dumps(center), len(samples), utc_now(), profile_id),
            )
        audio_path = sample["audio_path"]
        if audio_path:
            path = Path(audio_path)
            try:
                path.relative_to(self.speaker_profiles_dir / profile_id)
            except ValueError:
                pass
            else:
                path.unlink(missing_ok=True)
        return self.speaker_profile(profile_id)

    def match_speaker_profile(self, embedding, threshold):
        """按余弦相似度匹配本地人员；低于阈值时返回 ``None``。"""
        normalized = self._normalized_embedding(embedding)
        with self.connect() as db:
            profiles = db.execute(
                "SELECT id,name,embedding,sample_count FROM speaker_profiles"
            ).fetchall()
        scored = []
        for profile in profiles:
            candidate = json.loads(profile["embedding"])
            if len(candidate) == len(normalized):
                scored.append(
                    (
                        sum(left * right for left, right in zip(normalized, candidate)),
                        profile,
                    )
                )
        if not scored:
            return None
        scored.sort(key=lambda item: item[0], reverse=True)
        score, profile = scored[0]
        runner_up_score = scored[1][0] if len(scored) > 1 else -1
        return (
            {
                "id": profile["id"],
                "name": profile["name"],
                "sample_count": profile["sample_count"],
                "score": score,
                "runner_up_score": runner_up_score,
            }
            if score >= threshold
            else None
        )

    def delete_speaker_profile(self, profile_id):
        """删除人员档案及其所有声纹样本和本地录音文件。"""
        with self.connect() as db:
            db.execute("DELETE FROM speaker_profiles WHERE id=?", (profile_id,))
        shutil.rmtree(self.speaker_profiles_dir / profile_id, ignore_errors=True)

    def delete_legacy_builtin_profiles(self):
        """删除旧版本内置演示说话人（样本 source_key 以 ``builtin:`` 开头）。"""
        with self.connect() as db:
            rows = db.execute(
                "SELECT DISTINCT profile_id FROM speaker_profile_samples "
                "WHERE source_key LIKE 'builtin:%'"
            ).fetchall()
        for row in rows:
            self.delete_speaker_profile(row["profile_id"])
        return len(rows)

    def set_segment_speaker(
        self, meeting_id, segment_id, speaker, profile_id=None, name=None
    ):
        """设置段落的说话人并标记为用户编辑。"""
        with self.connect() as db:
            db.execute(
                "UPDATE segments SET speaker=?,user_edited=1 WHERE meeting_id=? AND id=?",
                (speaker, meeting_id, segment_id),
            )
            db.execute(
                "INSERT INTO speakers(meeting_id,id,name,profile_id,locked) VALUES(?,?,?,?,1) ON CONFLICT(meeting_id,id) DO UPDATE SET name=excluded.name,profile_id=excluded.profile_id,locked=1",
                (meeting_id, speaker, name or speaker, profile_id),
            )

    def rename_speaker_profile(self, profile_id, name):
        """重命名人员档案。"""
        name = name.strip()
        if not name:
            raise ValueError("Speaker profile name cannot be empty")
        with self.connect() as db:
            db.execute(
                "UPDATE speaker_profiles SET name=?,updated_at=? WHERE id=?",
                (name, datetime.now(timezone.utc).isoformat(), profile_id),
            )
        return self.speaker_profile(profile_id)
