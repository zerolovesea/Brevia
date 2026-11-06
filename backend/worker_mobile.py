"""Authenticated desktop bridge only: replayable, sample-addressed mobile audio."""

import base64
import json
import os

from .worker_common import (
    synchronized_recording,
    model_supports_language,
    model_capabilities,
    missing_models,
)


class MobileWorkerMixin:
    def mobile_library(self, _payload):
        # 列表轮询不加载纪要、笔记、音频和字幕。
        with self.store.connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT id,title,status,created_at,duration_ms FROM meetings "
                    "WHERE deleted_at IS NULL ORDER BY created_at DESC"
                )
            ]

    def mobile_proposal_put(self, payload):
        mid, device, pid = (payload[key] for key in ('meeting_id', 'device_id', 'id'))
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute(
                "SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL", (mid,)
            ).fetchone():
                return {'missing': True}
            prior = db.execute(
                "SELECT id,state FROM mobile_note_proposals WHERE meeting_id=? AND device_id=?",
                (mid, device),
            ).fetchone()
            if prior and prior['id'] == pid:
                return dict(prior)
            if prior and prior['state'] == 'pending':
                return {'conflict': True}
            db.execute(
                "INSERT INTO mobile_note_proposals(meeting_id,device_id,id,base_revision,notes,state) "
                "VALUES(?,?,?,?,?,'pending') ON CONFLICT(meeting_id,device_id) DO UPDATE SET "
                "id=excluded.id,base_revision=excluded.base_revision,notes=excluded.notes,state='pending'",
                (mid, device, pid, payload['base_revision'], payload['notes']),
            )
            return {'id': pid, 'state': 'pending'}

    def mobile_proposal_status(self, payload):
        with self.store.connect() as db:
            row = db.execute(
                "SELECT id,state FROM mobile_note_proposals WHERE meeting_id=? AND device_id=?",
                (payload['meeting_id'], payload['device_id']),
            ).fetchone()
            return dict(row) if row else None

    def mobile_proposal_list(self, payload):
        mid = payload.get('meeting_id')
        with self.store.connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT p.*,m.title AS meeting_title FROM mobile_note_proposals p "
                    "JOIN meetings m ON m.id=p.meeting_id WHERE p.state='pending' "
                    "AND m.deleted_at IS NULL AND (? IS NULL OR p.meeting_id=?) ORDER BY p.rowid",
                    (mid, mid),
                )
            ]

    def mobile_proposal_resolve(self, payload):
        mid, pid = payload['meeting_id'], payload['id']
        with self.store.connect() as db:
            # 用户选择的是预览时的两个版本；写入笔记和消费提议必须同一事务。
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT p.notes,p.state FROM mobile_note_proposals p JOIN meetings m ON m.id=p.meeting_id "
                "WHERE p.meeting_id=? AND p.id=? AND m.deleted_at IS NULL",
                (mid, pid),
            ).fetchone()
            if not row or row['state'] != 'pending':
                return {'missing': True}
            result = {'id': pid, 'meeting_id': mid, 'state': 'declined'}
            if payload['accept']:
                if not db.execute(
                    "UPDATE meetings SET notes=? WHERE id=? AND notes=?",
                    (row['notes'], mid, payload['expected_notes']),
                ).rowcount:
                    return {'conflict': True}
                result.update(state='accepted', notes=row['notes'])
            db.execute(
                "UPDATE mobile_note_proposals SET state=?,notes='' WHERE id=?",
                (result['state'], pid),
            )
            return result

    def mobile_proposal_forget(self, payload):
        with self.store.connect() as db:
            db.execute(
                "DELETE FROM mobile_note_proposals WHERE device_id=? "
                "AND meeting_id NOT IN (SELECT value FROM json_each(?))",
                (payload['device_id'], json.dumps(payload.get('keep_meetings', []))),
            )
        return {'saved': True}

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
            if 'transcription' in model_capabilities(m) and not m.get('retired')
        ]
        return {
            "models": models,
            "workspaces": [
                {"id": w['id'], "name": w['name']} for w in self.store.list_workspaces()
            ],
        }

    def mobile_translate(self, payload):
        meeting = self.store.get_meeting(payload['meeting_id'], compact=True)
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
            tags = ['手机录音', '手机麦克风'] if payload.get('desktop_capture') else ['手机录音']
            return self.start({**payload, 'tags': tags, 'audio_tracks': ['mic']})
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
        # 手机缓存可能以远快于实时的速度重放。先消费预处理和识别任务，再确认
        # 处理进度；不能沿用实时采集的溢出降级，否则剩余缓存只有音频没有转写。
        if self.live_preprocessing_tail is not None:
            self.live_preprocessing_tail.result()
        if self.live_postprocessing is not None:
            self.live_postprocessing.submit(lambda: None).result()
        session = self.store._audio_sessions.get(meeting_id)
        if session:
            for output in session['writers'].values():
                output.flush()
                os.fsync(output.fileno())
        return {'samples': max(recorded, start + len(base64.b64decode(payload['pcm'])) // 2)}
