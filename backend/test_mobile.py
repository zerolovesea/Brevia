"""Sample-addressed replay checks using the real WAV store, without ASR models."""

import base64
import json
from concurrent.futures import ThreadPoolExecutor
import tempfile
import threading
import unittest
import wave
from types import SimpleNamespace
from .storage import Store
from .worker_mobile import MobileWorkerMixin


class Bridge(MobileWorkerMixin):
    def __init__(self, store):
        self.store = store
        self.state = SimpleNamespace(lock=threading.RLock())
        self.active = None
        self.live_preprocessing_tail = None
        self.live_postprocessing = None

    def start(self, payload):
        self.active = payload['meeting_id']
        return self.store.create_meeting({**payload, 'refined_model_id': 'test'})

    def _prepare_active(self, meeting, duration, **kwargs):
        self.active = meeting['id']

    def audio(self, payload):
        self.store.append_audio(
            payload['meeting_id'], 'mic', payload['pcm'], start_ms=payload['start_ms']
        )

    def stop(self, payload):
        self.store.flush_audio(payload['meeting_id'], force=True, close=True)
        self.store.set_status(payload['meeting_id'], 'ready')
        self.active = None
        return self.store.get_meeting(payload['meeting_id'])


class MobileReplayTest(unittest.TestCase):
    def test_replay_waits_for_recognition_before_acknowledging(self):
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(1) as executor:
            bridge = Bridge(Store(directory))
            mid = 'b46cbe75-c097-436b-9322-55c336203f38'
            bridge.mobile_apply(dict(action='start', meeting_id=mid, title='Mobile', language='zh'))
            consumed = threading.Event()
            release = threading.Event()
            bridge.live_postprocessing = executor
            bridge.live_preprocessing_tail = executor.submit(lambda: release.wait(5))

            def replay():
                bridge.mobile_apply(
                    dict(
                        action='chunk',
                        meeting_id=mid,
                        start_sample=0,
                        pcm=base64.b64encode(bytes([1, 0])).decode(),
                    )
                )
                consumed.set()

            thread = threading.Thread(target=replay)
            thread.start()
            try:
                self.assertFalse(consumed.wait(0.05))
            finally:
                release.set()
                thread.join(5)
                bridge.store.flush_audio(mid, force=True, close=True)
            self.assertTrue(consumed.is_set())

    def test_deletion_clears_phone_audio_and_prevents_resurrection(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            meeting = store.create_meeting(
                {'title': 'private', 'language': 'zh', 'refined_model_id': 'test'}
            )
            mid = meeting['id']
            spool = store.root / 'mobile' / mid
            spool.mkdir(parents=True)
            (spool / 'session.json').write_text(
                json.dumps({'id': mid, 'owner': 'phone', 'title': 'private', 'finished': True})
            )
            (spool / '0.json').write_text('private audio' * 100)
            before = store.usage()['meetings']
            store.soft_delete(mid)
            store.permanent_delete(mid)
            self.assertEqual(list(spool.iterdir()), [spool / 'session.json'])
            self.assertEqual(
                json.loads((spool / 'session.json').read_text()),
                {'id': mid, 'owner': 'phone', 'deleted': True, 'finished': True},
            )
            self.assertLess(store.usage()['meetings'], before)
            (spool / '0.json').write_text('private audio')
            identity = store.root / 'mobile' / 'identity.json'
            identity.write_text('identity')
            store.clear_storage_partition('meetings')
            self.assertFalse((spool / '0.json').exists())
            self.assertEqual(identity.read_text(), 'identity')

    def test_translation_processes_every_segment_and_rejects_active_recording(self):
        bridge = Bridge(
            SimpleNamespace(
                get_meeting=lambda _: {
                    'status': 'ready',
                    'segments': [{'id': 'one'}, {'id': 'two'}],
                }
            )
        )
        calls = []
        bridge.translate = calls.append
        payload = {'meeting_id': 'meeting', 'target_language': 'en', 'consent': True}
        self.assertTrue(bridge.mobile_translate(payload)['translated'])
        self.assertEqual(
            calls, [{**payload, 'segment_id': 'one'}, {**payload, 'segment_id': 'two'}]
        )
        bridge.store.get_meeting = lambda _: {'status': 'recording', 'segments': []}
        with self.assertRaises(ValueError):
            bridge.mobile_translate(payload)

    def test_options_and_prepare_keep_private_paths_and_invalid_settings_out(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Bridge(Store(directory))
            catalog = [
                {
                    "id": "asr",
                    "name": "ASR",
                    "kind": "whisper",
                    "stages": ["refined"],
                    "languages": ["zh", "en"],
                    "status": "ready",
                    "path": "/private/models/asr",
                }
            ]
            bridge.models = SimpleNamespace(
                list=lambda: catalog, is_ready=lambda mid: mid != "missing"
            )
            bridge._sentence_payload = lambda value: {"vad_model_id": "silero-vad", **value}
            options = bridge.mobile_options({})
            self.assertNotIn('path', options['models'][0])
            self.assertIn('auto', options['models'][0]['languages'])
            self.assertTrue(bridge.mobile_prepare({'refined_model_id': 'asr'})['ready'])
            with self.assertRaisesRegex(ValueError, '安装'):
                bridge.mobile_prepare({'refined_model_id': 'missing'})
            with self.assertRaisesRegex(ValueError, '工作区'):
                bridge.mobile_prepare({'refined_model_id': 'asr', 'workspace_id': 'unknown'})

    def test_retries_partial_write_and_worker_restart_do_not_duplicate_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            bridge = Bridge(store)
            start = dict(
                action='start',
                meeting_id='b46cbe75-c097-436b-9322-55c336203f38',
                title='Mobile',
                language='zh',
                num_speakers=3,
            )
            bridge.mobile_apply(start)
            self.assertIn('手机录音', store.get_meeting(start['meeting_id'])['tags'])
            self.assertEqual(store.get_meeting(start['meeting_id'])['num_speakers'], 3)
            bridge.mobile_apply(start)
            mid = start['meeting_id']
            pcm = bytes([1, 0, 2, 0, 3, 0])
            chunk = dict(
                action='chunk', meeting_id=mid, start_sample=0, pcm=base64.b64encode(pcm).decode()
            )
            store.append_audio(mid, 'mic', pcm[:2])  # crash halfway through an append
            self.assertEqual(bridge.mobile_apply(chunk)['samples'], 3)
            bridge.mobile_apply(chunk)  # lost response
            store.flush_audio(mid, force=True, close=True)
            bridge.active = None  # new worker, no open WAV writers
            bridge.mobile_apply(chunk)
            with self.assertRaisesRegex(ValueError, 'Missing audio'):
                bridge.mobile_apply({**chunk, 'start_sample': 9})
            bridge.mobile_apply(dict(action='end', meeting_id=mid, samples=3))
            bridge.mobile_apply(dict(action='end', meeting_id=mid, samples=3))
            audio = list((store.meeting_dir(mid) / 'audio').glob('mic-*.wav'))
            with wave.open(str(audio[0])) as stream:
                self.assertEqual(stream.readframes(20), pcm)


if __name__ == '__main__':
    unittest.main()
