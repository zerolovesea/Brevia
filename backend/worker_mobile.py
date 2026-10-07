"""Authenticated desktop bridge only: replayable, sample-addressed mobile audio."""

import base64
import os

from .worker_common import synchronized_recording, model_supports_language, missing_models


class MobileWorkerMixin:
    def mobile_options(self, _payload):
        languages = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru', 'auto']
        models = [
            {
                "id": m['id'],
                "name": m['name'],
                "status": m['status'],
                "languages": [lang for lang in languages if model_supports_language(m, lang)],
                "default_for_languages": m.get('default_for_languages', []),
            }
            for m in self.models.list()
            if 'refined' in m.get('stages', []) and not m.get('retired')
        ]
        return {
            "models": models,
            "workspaces": [
                {"id": w['id'], "name": w['name']} for w in self.store.list_workspaces()
            ],
        }

    def mobile_translate(self, payload):
        meeting = self.store.get_meeting(payload['meeting_id'])
        if meeting['status'] == 'recording':
            raise ValueError('请先结束会议')
        if not meeting.get('segments'):
            raise ValueError('会议暂无可翻译的字幕')
        for segment in meeting['segments']:
            self.translate({**payload, 'segment_id': segment['id']})
        return {'translated': True}

    def mobile_prepare(self, payload):
        if payload.get('id'):
            try:
                existing = self.store.get_meeting(payload['id'])
            except (ValueError, KeyError):
                existing = None
            if existing is not None:
                raise ValueError('会议编号已存在，请重新创建手机会议')
        value = self._sentence_payload(payload)
        required = [value['refined_model_id'], value['vad_model_id']]
        if value.get('target_language'):
            from .worker_llm import TRANSLATION_MODEL_ID

            required.append(TRANSLATION_MODEL_ID)
        missing = missing_models(self.models, required)
        if missing:
            raise ValueError('请先在电脑模型库安装所选会议需要的模型：' + ', '.join(missing))
        if value.get('workspace_id') and not any(
            w['id'] == value['workspace_id'] for w in self.store.list_workspaces()
        ):
            raise ValueError('工作区已不存在，请重新选择')
        return {"ready": True}

    @synchronized_recording
    def mobile_apply(self, payload):
        meeting_id = payload['meeting_id']
        action = payload['action']
        if self.active and self.active != meeting_id:
            raise ValueError('电脑正在处理另一场录音，请稍后重试')
        try:
            meeting = self.store.get_meeting(meeting_id)
        except (ValueError, KeyError):
            meeting = None
        if meeting is None:
            if action != 'start':
                raise ValueError('请先创建手机会议')
            return self.start({**payload, 'tags': ['手机录音'], 'audio_tracks': ['mic']})
        if action == 'start':
            if '手机录音' not in meeting.get('tags', []):
                meeting = self.store.update_meeting(
                    meeting_id, {'tags': [*meeting.get('tags', []), '手机录音']}
                )
            return meeting  # Lost create response must not create a second meeting.
        if action == 'end' and meeting['status'] == 'ready' and not self.active:
            # A process restart may already have finalized this recording.
            return meeting
        if not self.active:
            # Desktop startup finalizes interrupted sessions; authenticated mobile
            # replay reopens its own session and keeps the same audio timeline.
            manifest = self.store.read_manifest(meeting_id)
            manifest['closed'] = False
            self.store.write_manifest(meeting_id, manifest)
            with self.store.connect() as db:
                db.execute(
                    "UPDATE meetings SET status='recording',ended_at=NULL WHERE id=?", (meeting_id,)
                )
            self._prepare_active(
                meeting, self.store.recorded_duration_ms(meeting_id), audio_tracks=['mic']
            )
        if action == 'end':
            return self.stop({'meeting_id': meeting_id, 'duration_ms': payload['samples'] / 16})
        if action != 'chunk':
            raise ValueError('Invalid mobile action')
        pcm = base64.b64decode(payload['pcm'], validate=True)
        start = payload['start_sample']
        if not isinstance(start, int) or start < 0 or len(pcm) % 2 or not 0 < len(pcm) <= 32000:
            raise ValueError('Invalid PCM chunk')
        session = self.store._audio_sessions.get(meeting_id)
        if session:
            recorded = session['manifest']['tracks'].get('mic', {}).get('samples', 0)
        else:
            recorded = sum(
                self.store._wav_samples(p)
                for p in (self.store.meeting_dir(meeting_id) / 'audio').glob('mic-*.wav')
            )
        if start > recorded:
            raise ValueError('Missing audio before this chunk')
        # A worker response can be lost after append. Resume from actual WAV samples,
        # including a partially written chunk, instead of appending duplicates.
        pcm = pcm[max(0, recorded - start) * 2 :]
        if pcm:
            self.audio(
                {
                    'meeting_id': meeting_id,
                    'track': 'mic',
                    'pcm': base64.b64encode(pcm).decode(),
                    'sample_rate': 16000,
                    'start_ms': recorded / 16,
                }
            )
        session = self.store._audio_sessions.get(meeting_id)
        if session:
            for output in session['writers'].values():
                output.flush()
                os.fsync(output.fileno())
        return {'samples': max(recorded, start + len(base64.b64decode(payload['pcm'])) // 2)}
