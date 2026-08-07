"""Focused worker responsibility component."""

import re

from .worker_common import require


class SpeakerCommandMixin:
    def assign_segment_speaker(self, payload):
        if self._is_default_speaker_name(payload["name"]):
            return self.store.get_meeting(payload["meeting_id"])
        meeting = self.store.get_meeting(payload["meeting_id"])
        if not payload.get("enroll"):
            segment = next(
                (
                    item
                    for item in meeting["segments"]
                    if item["id"] == payload["segment_id"]
                ),
                None,
            )
            if not segment:
                raise ValueError("Segment not found")
            self.store.set_segment_speaker(
                payload["meeting_id"],
                payload["segment_id"],
                segment["speaker"],
                name=payload["name"],
            )
            return self.store.get_meeting(payload["meeting_id"])
        profile = self.store.ensure_speaker_profile(payload["name"])
        speaker_id = f"profile-{profile['id']}"
        self.store.set_segment_speaker(
            payload["meeting_id"],
            payload["segment_id"],
            speaker_id,
            profile["id"],
            profile["name"],
        )
        meeting = self.store.get_meeting(payload["meeting_id"])
        profile = self.voice_profiles.learn_from_meeting(
            meeting,
            speaker_id,
            profile["name"],
            segment_ids={payload["segment_id"]},
            source_id=profile["id"],
        )
        self.emit("speaker-profile.updated", {"profile": profile})
        return self.store.get_meeting(payload["meeting_id"])

    def add_segment_speaker_profile_sample(self, payload):
        """仅在用户明确选择时，将一段已保存对话加入既有声纹档案。"""
        require(payload, "meeting_id", "segment_id", "profile_id")
        profile = self.store.speaker_profile(payload["profile_id"])
        self.store.set_segment_speaker(
            payload["meeting_id"],
            payload["segment_id"],
            f"profile-{profile['id']}",
            profile["id"],
            profile["name"],
        )
        profile = self.voice_profiles.learn_from_meeting(
            self.store.get_meeting(payload["meeting_id"]),
            None,
            profile["name"],
            segment_ids={payload["segment_id"]},
            source_id=profile["id"],
        )
        self.emit("speaker-profile.updated", {"profile": profile})
        return self.store.get_meeting(payload["meeting_id"])

    def rename_speaker(self, payload):
        """保存会议内名称，并把真人命名实时同步到本地人员库。

        人工把说话人命名为真实姓名，是明确的身份意图；即便会议仍在进行、
        暂时无法提取稳定声纹，也先建立空档案并关联会议说话人，使其立刻出现
        在设置的说话人识别列表中。占位名（如“说话人1”）不注册为真人。声纹
        样本仍由显式 Enrollment 或分配片段时补全。
        """
        require(payload, "meeting_id", "speaker_id", "name")
        profile = (
            None
            if self._is_default_speaker_name(payload["name"])
            else self.store.ensure_speaker_profile(payload["name"])
        )
        self.store.rename_speaker(
            payload["meeting_id"],
            payload["speaker_id"],
            payload["name"],
            payload.get("locked", False),
            profile["id"] if profile else None,
        )
        if profile:
            self.emit("speaker-profile.updated", {"profile": profile})
        return self.store.get_meeting(payload["meeting_id"])

    @staticmethod
    def _is_default_speaker_name(name):
        """识别各界面语言的自动说话人占位名称，避免将其注册为真人声纹。"""
        normalized = re.sub(r"[\s_-]+", "", name.strip().casefold())
        return bool(
            re.fullmatch(
                r"(?:spk|speaker|说话人|話者|화자|hablante|orador|locuteur|intervenant|sprecher|говорящий|спикер)\d+",
                normalized,
            )
        )

    def enroll_speaker_profile(self, payload):
        """从用户选定的单人语音录音注册或补充本地人员声纹。"""
        require(payload, "name", "path")
        result = self.voice_profiles.enroll(payload)
        self.emit("speaker-profile.updated", {"profile": result})
        return result

    def verify_speaker_profile(self, payload):
        """验证一段临时选择的音频是否匹配指定本地声纹。"""
        require(payload, "profile_id", "path")
        return self.voice_profiles.verify(payload)

    def delete_speaker_profile(self, payload):
        require(payload, "profile_id")
        self.store.delete_speaker_profile(payload["profile_id"])
        self.emit("speaker-profile.deleted", {"profile_id": payload["profile_id"]})
        return {"profile_id": payload["profile_id"], "deleted": True}

    def delete_speaker_profile_sample(self, payload):
        """删除一句声纹存档，并发布人员声纹已增量更新。"""
        require(payload, "profile_id", "sample_id")
        profile = self.store.delete_speaker_profile_sample(
            payload["profile_id"], payload["sample_id"]
        )
        self.emit("speaker-profile.updated", {"profile": profile})
        return profile
