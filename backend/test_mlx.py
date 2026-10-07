"""Platform routing and the PCM/endpoint contract; no ASR weight downloads."""

import json
import sys
import subprocess
import tempfile
import unittest
import weakref
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

from .asr import ModelManager, RefinedASR, load_model_catalog
from .worker_common import ModelNotInstalled, default_refined_model_for_language


class CatalogTest(unittest.TestCase):
    def test_platforms_and_pinned_assets(self):
        with patch('backend.asr.platform.system', return_value='Windows'):
            windows = load_model_catalog()
        with patch('backend.asr.platform.system', return_value='Darwin'):
            mac = load_model_catalog()
        self.assertEqual(
            default_refined_model_for_language(list(windows.values()), 'zh'), 'funasr-nano-int8'
        )
        self.assertEqual(
            default_refined_model_for_language(list(mac.values()), 'zh'), 'funasr-nano-mlx'
        )
        for language, expected in [
            ('yue', 'funasr-nano-mlx'),
            ('ja', 'qwen3-asr-0.6b-mlx'),
            ('ko', 'qwen3-asr-0.6b-mlx'),
        ]:
            self.assertEqual(
                default_refined_model_for_language(list(mac.values()), language), expected
            )
        self.assertEqual(
            default_refined_model_for_language(list(mac.values()), 'en'), 'parakeet-tdt-0.6b-v3-mlx'
        )
        self.assertFalse(any(m['runtime'] == 'mlx-audio' for m in windows.values()))
        for m in mac.values():
            if m['runtime'] == 'mlx-audio':
                self.assertEqual(len(m['revision']), 40)
                self.assertEqual(m['files'], [d['path'] for d in m['downloads']])
                for d in m['downloads']:
                    self.assertEqual(len(d['sha256']), 64)
                    self.assertIn('/resolve/' + m['revision'] + '/', d['url'])
        for ident in ('eres2net-base-3dspeaker-zh', 'pyannote-segmentation-3.0'):
            self.assertIn(ident, mac)
            self.assertIn(ident, windows)
        self.assertEqual(
            {m["kind"] for m in mac.values() if m["runtime"].startswith("sherpa")},
            {"speaker-segmentation", "speaker-embedding"},
        )

    def test_native_and_python_logs_cannot_corrupt_jsonl(self):
        script = """
import json, os
from backend.worker import protocol_output
out = protocol_output()
os.write(1, b'native log\\n')
print('python log')
print(json.dumps({'ok': True}), file=out, flush=True)
"""
        run = subprocess.run(
            [sys.executable, '-c', script], capture_output=True, text=True, check=True
        )
        self.assertEqual(json.loads(run.stdout), {'ok': True})
        self.assertIn('native log', run.stderr)
        self.assertIn('python log', run.stderr)

    def test_migration_does_not_delete_other_platform_weights(self):
        with (
            tempfile.TemporaryDirectory() as root,
            patch('backend.asr.platform.system', return_value='Darwin'),
        ):
            manager = ModelManager(root, cleanup=False)
            folder = Path(root) / 'old-onnx'
            folder.mkdir()
            (folder / '.brevia.json').write_text(json.dumps(dict(id='funasr-nano-int8')))
            self.assertEqual(manager.cleanup_unlisted()['removed'], [])
            self.assertTrue(folder.exists())


@unittest.skipUnless(sys.platform == 'darwin', 'MLX requires Apple Silicon')
class MLXContractTest(unittest.TestCase):
    def setUp(self):
        import mlx.core as mx
        from mlx_audio.vad.models.silero_vad.silero_vad import Model
        from .mlx_asr import MLXVAD

        class Detector:
            _probs_to_timestamps = staticmethod(Model._probs_to_timestamps)

            def initial_state(self):
                return None

            def feed(self, audio, state):
                return mx.array(float(np.max(np.abs(audio)) > 0.1)), state

        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.manager = ModelManager(self.directory.name, cleanup=False)
        with (
            patch('mlx_audio.vad.utils.load_model', return_value=Detector()),
            patch('backend.mlx_asr.local_model_path', return_value=Path(self.directory.name)),
        ):
            self.vad = MLXVAD(
                self.manager,
                language='zh',
                vad_params=dict(min_speech_duration=0.1, min_silence_duration=0.5),
            )

    def test_endpoints_tail_and_per_track_state(self):
        speech = np.ones(16000, np.float32)
        silence = np.zeros(16000, np.float32)
        self.assertEqual(self.vad.accept('mic', speech, 1000), [])
        self.assertEqual(self.vad.accept('system', silence, 1000), [])
        closed = self.vad.accept('mic', silence, 2000)
        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0][0], 1000)
        self.assertEqual(closed[0][3], 'endpoint')
        self.assertEqual(self.vad.flush('mic'), [])
        self.assertEqual(self.vad.flush('system'), [])
        # Sub-frame final samples are padded for inference, never for timestamps.
        self.vad.accept('mic', speech[:1601], 9000)
        tail = self.vad.flush('mic')
        self.assertEqual(tail[0][1], 9100)
        self.assertEqual(len(tail[0][2]), 1601)
        self.assertEqual(self.vad.flush('mic'), [])

    def test_offline_vad_preserves_parameters_and_ignores_live_cap(self):
        from .asr import OfflineVAD, SentenceVAD
        from .config import SETTINGS

        speech = np.ones(16000, np.float32)
        audio = np.concatenate((speech, np.zeros(16000, np.float32), speech))
        with (
            patch('mlx_audio.vad.utils.load_model', return_value=self.vad.model),
            patch('backend.mlx_asr.local_model_path', return_value=Path(self.directory.name)),
            patch.dict(SETTINGS['live_asr'], max_speech_seconds=1.0),
        ):
            for silence in (0.7, 0.8):
                with self.subTest(silence=silence):
                    vad = OfflineVAD(
                        self.manager,
                        vad_params=dict(
                            min_speech_duration=0.25,
                            min_silence_duration=silence,
                            max_speech_duration=30.0,
                        ),
                    )
                    self.assertEqual(vad.options['min_silence_duration_ms'], round(silence * 1000))
                    self.assertGreater(vad.max_speech_seconds, 29)
                    regions = vad.process(audio)
                    self.assertEqual(len(regions), 2)
                    self.assertLess(regions[0]['end_ms'], regions[1]['start_ms'])
            # The automatic live-language policy still needs its longer context.
            live = SentenceVAD(self.manager, language='auto')
            self.assertEqual(live.options['min_silence_duration_ms'], 2000)
            self.assertLessEqual(live.max_speech_seconds, 1.0)

    def test_zero_live_cap_uses_default_and_still_detects_speech(self):
        from .asr import SentenceVAD
        from .config import DEFAULT_SETTINGS, SETTINGS

        windows = []
        with (
            patch('mlx_audio.vad.utils.load_model', return_value=self.vad.model),
            patch('backend.mlx_asr.local_model_path', return_value=Path(self.directory.name)),
        ):
            for cap in (0, DEFAULT_SETTINGS['live_asr']['max_speech_seconds']):
                with patch.dict(SETTINGS['live_asr'], max_speech_seconds=cap):
                    vad = SentenceVAD(self.manager, language='zh')
                    segments = vad.accept('mic', np.ones(16000, np.float32), 0)
                    segments.extend(vad.flush('mic'))
                    self.assertTrue(segments)
                    windows.append([(start, end) for start, end, _, _ in segments])
        self.assertEqual(windows[0], windows[1])

    def test_minimum_live_cap_produces_bounded_nonempty_windows(self):
        from .asr import SentenceVAD
        from .config import SETTINGS

        with (
            patch('mlx_audio.vad.utils.load_model', return_value=self.vad.model),
            patch('backend.mlx_asr.local_model_path', return_value=Path(self.directory.name)),
            patch.dict(SETTINGS['live_asr'], max_speech_seconds=1.0),
        ):
            vad = SentenceVAD(self.manager, language='zh')
            segments = vad.accept('mic', np.ones(160000, np.float32), 0)
            segments.extend(vad.flush('mic'))
            self.assertGreater(len(segments), 1)
            self.assertLess(len(segments), 20)
            self.assertTrue(all(0 < len(audio) <= 16000 for _, _, audio, _ in segments))
            self.assertGreaterEqual(segments[-1][1], 9980)

    def test_continuous_speech_bounded_and_gap_flushes(self):
        chunks = []
        for i in range(30):
            chunks.extend(self.vad.accept('mic', np.ones(16000, np.float32), i * 1000))
            self.assertLessEqual(len(self.vad.tracks['mic']['audio']), self.vad.maximum + 512)
        chunks.extend(self.vad.accept('mic', np.ones(16000, np.float32), 40000))
        chunks.extend(self.vad.flush('mic'))
        self.assertEqual(chunks[0][0], 0)
        self.assertEqual(chunks[-1][0], 40000)
        self.assertEqual(chunks[-2][1], 30000)
        for a, b in zip(chunks[:-2], chunks[1:-1]):
            self.assertLessEqual(b[0], a[1])
            self.assertLessEqual(a[1] - b[0], 400)

    def test_stop_at_exact_cut_does_not_transcribe_overlap_again(self):
        speech = np.ones(self.vad.maximum, np.float32)
        self.assertEqual(len(self.vad.accept('mic', speech, 0)), 1)
        self.assertEqual(self.vad.flush('mic'), [])
        self.assertEqual(len(self.vad.accept('mic', speech, 0)), 1)
        self.assertEqual(self.vad.accept('mic', np.zeros(16000, np.float32), len(speech) // 16), [])
        self.assertEqual(self.vad.flush('mic'), [])

    def test_soft_target_uses_native_pause_without_losing_pcm(self):
        # A short pause is insufficient for the normal endpoint, but suitable
        # for a live cut. Result must not depend on command buffer boundaries.
        audio = np.ones(10 * 16000, np.float32)
        audio[7 * 16000 : 7 * 16000 + 4096] = 0
        results = []
        for size in (2730, len(audio)):
            segments = []
            for offset in range(0, len(audio), size):
                segments.extend(
                    self.vad.accept('mic', audio[offset : offset + size], round(offset / 16))
                )
            segments.extend(self.vad.flush('mic'))
            self.assertEqual(segments[0][3], 'pause')
            self.assertEqual(segments[0][1], segments[1][0])
            np.testing.assert_array_equal(np.concatenate([s[2] for s in segments]), audio)
            results.append([(s, e, b) for s, e, _, b in segments])
        self.assertEqual(*results)
        # A confirmed pause can be delivered while the speaker is still quiet;
        # waiting for the next utterance adds unnecessary caption latency.
        waiting = np.concatenate((np.ones(8 * 16000, np.float32), np.zeros(4096, np.float32)))
        ready = self.vad.accept('mic', waiting, 0)
        self.assertEqual(len(ready), 1)
        self.assertEqual(ready[0][3], 'pause')
        self.assertEqual(self.vad.flush('mic'), [])
        # Offline refinement has no live latency target and preserves context.
        self.assertEqual(self.vad.process(audio), [dict(start_ms=0, end_ms=10000)])

    def test_short_hard_cap_always_makes_progress(self):
        self.vad.maximum = 512
        segments = self.vad.accept('mic', np.ones(16000, np.float32), 0)
        segments.extend(self.vad.flush('mic'))
        self.assertLess(len(self.vad.tracks), 1)
        # Native minimum speech duration can suppress these tiny windows.
        self.assertTrue(all(e > s for s, e, _, _ in segments))

    def test_subtitle_tail_survives_until_the_next_mlx_window(self):
        from .worker import Worker

        worker = object.__new__(Worker)
        worker.vad = self.vad
        worker.pending_paragraphs = {}
        worker.pending_subtitles = {'mic': dict(end_ms=8000, text='这个方案是。')}
        worker.pending_join = {'mic': None}
        with patch.object(worker, '_emit_subtitle') as emit:
            # Twenty seconds of uninterrupted audio plus decoding allowance:
            # the old fallback (12 s) finalized this tail before its successor.
            worker._flush_subtitle_tails(29000)
            emit.assert_not_called()
            worker._flush_subtitle_tails(31000)
            emit.assert_called_once()
            self.assertEqual(worker.pending_subtitles, {})
            self.assertEqual(worker.pending_join, {})

    def test_silence_does_not_grow_or_transcribe(self):
        for i in range(30):
            self.assertEqual(self.vad.accept('mic', np.zeros(16000, np.float32), i * 1000), [])
            self.assertLessEqual(len(self.vad.tracks['mic']['audio']), self.vad.maximum + 512)
        self.assertEqual(self.vad.flush('mic'), [])

    def test_leading_and_inter_utterance_silence_do_not_spend_speech_budget(self):
        for track in ('mix', 'offline'):
            for idle in (7, 19, 41):
                with self.subTest(track=track, idle=idle):
                    audio = np.concatenate(
                        (
                            np.zeros(idle * 16000, np.float32),
                            np.ones(3 * 16000, np.float32),
                            np.zeros(2 * 16000, np.float32),
                        )
                    )
                    segments = []
                    for offset in range(0, len(audio), 2731):
                        segments.extend(
                            self.vad.accept(
                                track, audio[offset : offset + 2731], round(offset / 16)
                            )
                        )
                    segments.extend(self.vad.flush(track))
                    self.assertEqual(len(segments), 1)
                    start, end, pcm, boundary = segments[0]
                    self.assertEqual(boundary, 'endpoint')
                    self.assertLessEqual(start, idle * 1000)
                    self.assertGreaterEqual(start, idle * 1000 - 350)
                    self.assertGreaterEqual(end, (idle + 3) * 1000)
                    self.assertEqual(np.count_nonzero(pcm), 3 * 16000)

    def test_auto_bridges_short_pause_but_manual_language_closes(self):
        from .mlx_asr import MLXVAD

        audio = np.concatenate(
            (
                np.ones(2 * 16000, np.float32),
                np.zeros(19200, np.float32),
                np.ones(2 * 16000, np.float32),
                np.zeros(3 * 16000, np.float32),
            )
        )
        with (
            patch('mlx_audio.vad.utils.load_model', return_value=self.vad.model),
            patch('backend.mlx_asr.local_model_path', return_value=Path(self.directory.name)),
        ):
            automatic = MLXVAD(self.manager, language='auto')
        self.assertEqual(automatic.options['min_silence_duration_ms'], 2000)
        self.assertEqual(len(automatic.process(audio)), 1)
        self.assertEqual(len(self.vad.process(audio)), 2)

    def test_idle_memory_retains_only_short_context(self):
        for second in range(120):
            self.assertEqual(self.vad.accept('mix', np.zeros(16000, np.float32), second * 1000), [])
            self.assertLessEqual(len(self.vad.tracks['mix']['audio']), 16000 + 512)
        self.assertEqual(self.vad.flush('mix'), [])

    def test_quiet_classification_gain_is_bounded_and_does_not_modify_pcm(self):
        from .config import SETTINGS

        source = np.full(512, 0.001, np.float32)
        captured = []
        feed = self.vad.model.feed
        with patch.object(
            self.vad.model,
            'feed',
            side_effect=lambda a, s: (captured.append(a.copy()), feed(a, s))[1],
        ):
            self.vad._feed(source, None)
            with patch.dict(SETTINGS['live_asr'], quiet_speech_recovery=0):
                self.vad._feed(source, None)
            self.vad._feed(np.zeros(512, np.float32), None)
        np.testing.assert_allclose(captured[0], source * 4)
        np.testing.assert_array_equal(captured[1], source)
        np.testing.assert_array_equal(captured[2], 0)
        np.testing.assert_array_equal(source, np.full(512, 0.001, np.float32))

    def test_offline_vad_releases_completed_pcm_before_next_chunk(self):
        references = []
        segment = self.vad._segment

        def track_segment(*args):
            result = segment(*args)
            if result is not None:
                references.append(weakref.ref(result[2]))
            return result

        progress_calls = []

        def progress(completed, total):
            progress_calls.append((completed, total))
            self.assertTrue(
                all(ref() is None for ref in references),
                'Offline VAD retained PCM from completed segments',
            )

        with patch.object(self.vad, '_segment', side_effect=track_segment):
            regions = self.vad._process(
                (np.ones(16000, np.float32) for _ in range(120)), 120 * 16000, progress
            )
        self.assertGreater(len(references), 1)
        self.assertTrue(all(ref() is None for ref in references))
        self.assertEqual(regions[0]['start_ms'], 0)
        self.assertEqual(regions[-1]['end_ms'], 120000)
        self.assertEqual(progress_calls[-1], (120 * 16000, 120 * 16000))
        self.assertTrue(all(a['end_ms'] >= b['start_ms'] for a, b in zip(regions, regions[1:])))

    def test_offline_wav_and_array_preserve_regions_and_partial_tail(self):
        audio = np.concatenate((np.ones(16000), np.zeros(16000), np.ones(32000 + 1601)))
        pcm = (audio * 16384).astype('<i2')
        path = Path(self.directory.name) / 'offline.wav'
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            output.writeframes(pcm.tobytes())
        expected = self.vad.process(pcm.astype(np.float32) / 32768)
        actual = self.vad.process_wav(path, chunk_seconds=0.137)
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), 2)
        self.assertEqual(actual[-1]['end_ms'], round(len(pcm) / 16))

    def test_qwen_tokenizer_lookup_does_not_import_multimodal_models(self):
        # Run in a clean interpreter: cached Transformers modules can hide
        # missing dependencies in a frozen, speech-only runtime.
        code = """
import importlib.abc
import sys
from pathlib import Path
from unittest.mock import patch
from backend.mlx_asr import MLXASR
from backend.asr import ModelManager
allowed = {'auto', 'qwen2', 'qwen3', 'qwen3_asr', 'whisper', 'encoder_decoder',
           'gemma', 'gpt2', 'llama', 'qwen3_5', 't5'}
class SpeechOnly(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith('transformers.models.') and fullname.split('.')[2] not in allowed:
            raise AssertionError('Unexpected model import: ' + fullname)
sys.meta_path.insert(0, SpeechOnly())
with patch('backend.mlx_asr.local_model_path', return_value=Path('.')), patch('mlx_audio.stt.utils.load_model'):
    MLXASR(ModelManager('.', cleanup=False), 'qwen3-asr-0.6b-mlx')
from transformers.models.auto.tokenization_auto import tokenizer_class_from_name
from transformers.models.qwen2.tokenization_qwen2 import Qwen2Tokenizer
assert tokenizer_class_from_name('Qwen2Tokenizer') is Qwen2Tokenizer
"""
        result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_local_model_never_reaches_hub(self):
        with (
            patch('huggingface_hub.snapshot_download', side_effect=AssertionError('network')),
            patch('mlx_audio.stt.utils.load_model') as load,
        ):
            with self.assertRaises(ModelNotInstalled):
                RefinedASR(self.manager, 'qwen3-asr-0.6b-mlx', 'zh')
            load.assert_not_called()

    def test_token_stream_preserves_split_unicode_and_hides_language_prefix(self):
        from .mlx_asr import MLXASR

        class Tokenizer:
            def decode(self, tokens, **kwargs):
                return {
                    1: 'language Chinese',
                    2: 'language Chinese<asr_text>\ufffd',
                    3: 'language Chinese<asr_text>龘',
                }[len(tokens)]

        class Model:
            _tokenizer = Tokenizer()

            def stream_generate(self, audio, **kwargs):
                return iter([(1, None), (2, None), (3, None)])

            def extract_language(self, text):
                return 'Chinese', text.split('<asr_text>', 1)[1]

        asr = object.__new__(MLXASR)
        asr.model_kind, asr.language, asr.model = 'qwen3', 'auto', Model()
        partials = []
        self.assertEqual(asr.decode_stream(np.zeros(1600), partial=partials.append), '龘')
        self.assertEqual(partials, ['龘'])

        # FunASR shares the token adapter but has no Qwen language header or
        # verbose argument, even when the caller requests automatic language.
        class FunTokenizer:
            def decode(self, tokens, **kwargs):
                return '\ufffd' if len(tokens) == 1 else '龘'

        class FunModel:
            _tokenizer = FunTokenizer()

            def stream_generate(self, audio, *, language, max_tokens):
                self.language = language
                return iter([(1, None), (2, None)])

        asr.model_kind, asr.model = 'funasr-nano', FunModel()
        partials.clear()
        self.assertEqual(asr.decode_stream(np.zeros(1600), partial=partials.append), '龘')
        self.assertEqual(partials, ['龘'])
        self.assertIsNone(asr.model.language)

    def test_history_repair_preserves_audio_and_transcript(self):
        from .worker import Worker

        worker = Worker(self.directory.name, lambda _: None)
        for model_id in ('funasr-nano-int8', 'fireredasr2-aed-mlx'):
            meeting = worker.store.create_meeting(
                dict(title='history', language='zh', refined_model_id=model_id)
            )
            repaired = worker._repair_refined_model(meeting)
            self.assertEqual(repaired['refined_model_id'], 'funasr-nano-mlx')
            self.assertEqual(repaired['id'], meeting['id'])
        worker.store.close_audio_sessions()


if __name__ == '__main__':
    unittest.main()
