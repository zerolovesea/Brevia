"""Apple Silicon ASR; mlx-audio owns inference, VAD state and segmentation.

The pinned models consume completed arrays, not a live PCM iterator. Brevia only
adapts its PCM clock/flush protocol to those arrays. No Hugging Face downloads.
"""

import os
import threading
import wave

# Set before importing transformers/huggingface_hub, including in frozen workers.
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

from .config import SETTINGS, CUT_OVERLAP_MS, live_speech_cap
from .worker_common import ModelNotInstalled

# ponytail: MLX default device/stream is process-global; serialize inference and
# VAD contexts. Move inference to separate processes if queued PCM latency grows.
ASR_LOCK = threading.RLock()


def local_model_path(manager, model_id):
    if not manager.is_ready(model_id):
        raise ModelNotInstalled([model_id])
    path = manager.path(model_id).resolve()
    if not path.is_dir():
        raise ModelNotInstalled([model_id])
    return path


class MLXASR:
    def __init__(self, manager, model_id, language=None, threads=None):
        import mlx.core as mx
        from mlx_audio.stt.utils import load_model

        self.model_id = model_id
        self.model_kind = manager.get(model_id)['kind']
        self.language = language
        self.max_speech_seconds = 20.0
        with ASR_LOCK, mx.stream(mx.gpu):
            # Register the same upstream tokenizer explicitly. Transformers 5's
            # name lookup otherwise walks unrelated multimodal architectures,
            # forcing their processors into an offline speech-only bundle.
            if self.model_kind in ('qwen3', 'funasr-nano'):
                from transformers import AutoTokenizer
                from transformers.models.qwen2.configuration_qwen2 import Qwen2Config
                from transformers.models.qwen2.tokenization_qwen2 import Qwen2Tokenizer

                AutoTokenizer.register(Qwen2Config, tokenizer_class=Qwen2Tokenizer, exist_ok=True)
            self.model = load_model(
                local_model_path(manager, model_id),
                # FireRed builds sinusoidal position buffers;
                # the published checkpoint omits those two arrays.
                strict=self.model_kind != 'fireredasr2',
            )

    def _options(self):
        if self.model_kind == 'funasr-nano':
            return dict(
                language=None if self.language == 'auto' else self.language,
                max_tokens=512,
                temperature=0.0,
                verbose=False,
            )
        if self.model_kind == 'qwen3':
            from .asr import RefinedASR

            return dict(
                language=RefinedASR._qwen3_language(self.language) or None,
                max_tokens=512,
                temperature=0.0,
                verbose=False,
            )
        if self.model_kind == 'fireredasr2':
            return dict(beam_size=3, max_len=512)
        return dict(chunk_duration=20.0, overlap_duration=2.0, verbose=False)

    def _audio(self, samples, sample_rate):
        import mlx.core as mx
        import numpy as np

        audio = np.asarray(samples, dtype=np.float32)
        if sample_rate != 16000 or audio.ndim != 1 or not np.isfinite(audio).all():
            raise ValueError('MLX ASR requires finite mono 16 kHz audio')
        return mx.array(audio)

    def decode(self, samples, sample_rate=16000):
        return self.decode_words(samples, sample_rate)[0]

    def decode_words(self, samples, sample_rate=16000):
        import mlx.core as mx

        with ASR_LOCK, mx.stream(mx.gpu):
            audio = self._audio(samples, sample_rate)
            if not len(audio):
                return '', []
            result = self.model.generate(audio, **self._options())
            # Only Parakeet supplies real alignment. Qwen stream timestamps are
            # token-budget estimates; never persist those as audio timestamps.
            words = [
                dict(text=t.text, start_ms=round(t.start * 1000), end_ms=round(t.end * 1000))
                for s in getattr(result, 'sentences', [])
                for t in s.tokens
            ]
            text = result.text.strip()
            mx.clear_cache()
            return text, words

    def decode_stream(self, samples, sample_rate=16000, partial=None):
        if self.model_kind not in ('qwen3', 'funasr-nano'):
            return self.decode(samples, sample_rate)
        import mlx.core as mx

        with ASR_LOCK, mx.stream(mx.gpu):
            audio = self._audio(samples, sample_rate)
            if not len(audio):
                return ''
            text, tokens = '', []
            options = self._options()
            options.pop('temperature')  # stream_generate defaults to greedy decoding.
            options.pop('verbose')
            try:
                # mlx-audio's text stream decodes each token separately. Its
                # tokenizer splits 龘/हिन्दी across tokens, producing U+FFFD.
                # Reuse the token stream and decode its bounded prefix instead.
                for token, _ in self.model.stream_generate(audio, **options):
                    tokens.append(int(token))
                    decoded = self.model._tokenizer.decode(tokens, skip_special_tokens=True)
                    if self.model_kind == 'qwen3' and not options['language']:
                        if '<asr_text>' not in decoded:
                            continue
                        _, decoded = self.model.extract_language(decoded)
                    decoded = decoded.rstrip('\ufffd')
                    if decoded != text:
                        text = decoded
                        if partial:
                            partial(text)
                return text.strip()
            finally:
                mx.clear_cache()


class MLXVAD:
    """Bounded PCM adapter around Silero feed + mlx-audio's timestamp extractor.

    feed() has recurrent state but no endpoint/flush API. Timestamp extraction
    finalizes trailing speech on every call, so only closed regions are emitted
    until flush or the live latency cap. No energy-based SentenceVAD heuristics.
    """

    def __init__(
        self,
        manager,
        model_id='silero-vad',
        language='auto',
        max_speech_duration=None,
        speech_pad_ms=300,
        vad_params=None,
        *,
        offline=False,
    ):
        import mlx.core as mx
        from mlx_audio.vad.utils import load_model

        self.stream = mx.new_thread_local_stream(mx.cpu)
        with ASR_LOCK, mx.stream(self.stream):
            self.model = load_model(local_model_path(manager, model_id), strict=True)
        params = {**SETTINGS['vad'].get(language, SETTINGS['vad']['default']), **(vad_params or {})}
        self.options = dict(
            sample_rate=16000,
            threshold=params.get('threshold', 0.5),
            min_speech_duration_ms=round(params.get('min_speech_duration', 0.25) * 1000),
            min_silence_duration_ms=round(params.get('min_silence_duration', 0.5) * 1000),
            speech_pad_ms=speech_pad_ms,
            return_seconds=False,
        )
        if not offline and language == 'auto':
            self.options['min_silence_duration_ms'] = max(
                2000, self.options['min_silence_duration_ms']
            )
        # Eight seconds is a soft target; never cut a word merely to meet it.
        maximum = params.get('max_speech_duration', 20.0)
        if not offline:
            maximum = live_speech_cap(params, max_speech_duration or 20.0)
        self.maximum = max(512, int(16000 * maximum))
        self.maximum = self.maximum // 512 * 512
        self.max_speech_seconds = (
            self.maximum / 16000
        )  # Subtitle tails must wait for the next complete window.
        self.tracks = {}
        self.cut_overlap_ms = CUT_OVERLAP_MS

    def _feed(self, samples, state):
        import numpy as np

        # Give quiet speech a bounded gain for classification only. Unlike an
        # energy fallback, this still requires Silero to confirm speech. The
        # original PCM sent to ASR/playback is never amplified here.
        if SETTINGS['live_asr'].get('quiet_speech_recovery', 1):
            rms = float(np.sqrt(np.mean(samples * samples)))
            if 0.0001 < rms < 0.01:
                samples = samples * min(4.0, 0.01 / rms)
        return self.model.feed(samples, state)

    def _new(self, start_ms):
        import numpy as np

        return dict(
            origin=start_ms * 16,
            audio=np.empty(0, np.float32),
            probabilities=[],
            state=self.model.initial_state(),
            processed=0,
            delivered=start_ms * 16,
        )

    def _regions(self, state, **options):
        import numpy as np

        # ponytail: rescan a bounded window using the upstream segmenter; an
        # upstream online endpoint iterator can replace this bounded rescan.
        return self.model._probs_to_timestamps(
            np.array(state['probabilities']),
            audio_len=state['processed'],
            **{**self.options, **options},
        )

    def accept(self, track, samples, start_ms):
        import mlx.core as mx
        import numpy as np

        samples = np.asarray(samples, dtype=np.float32)
        if samples.ndim != 1 or not np.isfinite(samples).all() or start_ms < 0:
            raise ValueError('VAD requires finite mono PCM and nonnegative timestamp')
        completed = []
        with ASR_LOCK, mx.stream(self.stream):
            state = self.tracks.get(track)
            if (
                state is not None
                and abs(start_ms * 16 - state['origin'] - len(state['audio'])) > 32
            ):
                completed.extend(self.flush(track))
                state = None
            if state is None:
                state = self.tracks[track] = self._new(start_ms)
            # Bound memory even when the command contains a large PCM buffer.
            for offset in range(0, len(samples), 512):
                state['audio'] = np.concatenate((state['audio'], samples[offset : offset + 512]))
                while len(state['audio']) - state['processed'] >= 512:
                    pos = state['processed']
                    probability, state['state'] = self._feed(
                        state['audio'][pos : pos + 512], state['state']
                    )
                    state['probabilities'].append(float(probability.item()))
                    state['processed'] += 512
                    regions = self._regions(state)
                    # Silence is not part of the utterance's latency budget.
                    # Keep padding (and enough history for unconfirmed speech),
                    # while retaining the detector's recurrent state.
                    keep = max(
                        16000,
                        (self.options['speech_pad_ms'] + self.options['min_speech_duration_ms'])
                        * 16
                        + 512,
                    )
                    keep = (keep // 512) * 512
                    prefix = regions[0]['start'] if regions else max(0, state['processed'] - keep)
                    prefix = (prefix // 512) * 512
                    if prefix:
                        self._discard(state, prefix)
                        regions = self._regions(state)
                    # A still-open region ends at processed. A closed region
                    # retains at least silence-pad samples after its end.
                    closed = [
                        r
                        for r in regions
                        if r['end'] < state['processed'] - self.options['speech_pad_ms'] * 16
                    ]
                    # Once the live target is reached, look back two seconds
                    # for a confirmed short pause. Padding would merge these
                    # regions, so use native unpadded timestamps for this only.
                    pause = None
                    if not closed and track != 'offline' and state['processed'] >= 8 * 16000:
                        short = self._regions(state, min_silence_duration_ms=100, speech_pad_ms=0)
                        for a, b in zip(short, short[1:] + [dict(start=state['processed'])]):
                            if state['processed'] - 2 * 16000 <= a['end'] < b['start']:
                                pause = ((a['end'] + b['start']) // 1024) * 512
                    if pause is not None:
                        for r in regions:
                            if r['start'] < pause:
                                segment = self._segment(
                                    state, dict(start=r['start'], end=min(r['end'], pause)), 'pause'
                                )
                                if segment is not None:
                                    completed.append(segment)
                        self._discard(state, pause)
                        continue
                    cut = state['processed'] >= self.maximum
                    if closed or cut:
                        selected = regions if cut else closed
                        for r in selected:
                            segment = self._segment(
                                state,
                                r,
                                'cut' if cut and r['end'] == state['processed'] else 'endpoint',
                            )
                            if segment is not None:
                                completed.append(segment)
                        # Keep a small context overlap at hard speech cuts only.
                        consumed = (
                            state['processed'] if cut else ((closed[-1]['end'] + 511) // 512) * 512
                        )
                        if cut and (not regions or regions[-1]['end'] == state['processed']):
                            consumed -= min(
                                (self.cut_overlap_ms * 16 // 512) * 512, max(0, consumed - 512)
                            )  # <=384 ms; always make progress.
                        self._discard(state, consumed)
        return completed

    @staticmethod
    def _discard(state, count):
        state['audio'] = state['audio'][count:].copy()
        state['origin'] += count
        state['processed'] -= count
        del state['probabilities'][: count // 512]

    def _segment(self, state, region, boundary):
        import numpy as np

        start, end = region['start'], region['end']
        # Context overlap alone is not a new utterance (including trailing
        # silence padding after a hard cut). Use upstream unpadded speech ends.
        raw = self.model._probs_to_timestamps(
            np.array(state['probabilities']),
            audio_len=state['processed'],
            **{**self.options, 'speech_pad_ms': 0},
        )
        speech_end = state['origin'] + max(
            (min(r['end'], end) for r in raw if r['start'] < end and r['end'] > start), default=0
        )
        if speech_end <= state['delivered']:
            return None
        state['delivered'] = speech_end
        return (
            round((state['origin'] + start) / 16),
            round((state['origin'] + end) / 16),
            state['audio'][start:end].copy(),
            boundary,
        )

    def flush(self, track):
        import mlx.core as mx
        import numpy as np

        state = self.tracks.pop(track, None)
        if state is None:
            return []
        with ASR_LOCK, mx.stream(self.stream):
            remaining = state['audio'][state['processed'] :]
            if len(remaining):
                probability, state['state'] = self._feed(
                    np.pad(remaining, (0, 512 - len(remaining))), state['state']
                )
                state['probabilities'].append(float(probability.item()))
                state['processed'] += len(remaining)
            return [
                segment
                for r in self._regions(state)
                if (segment := self._segment(state, r, 'endpoint')) is not None
            ]

    def process(self, samples, sample_rate=16000, progress=None):
        if sample_rate != 16000:
            raise ValueError('VAD requires 16 kHz audio')
        return self._process(
            (samples[i : i + 16000] for i in range(0, len(samples), 16000)), len(samples), progress
        )

    def process_wav(self, path, chunk_seconds=10, progress=None):
        import numpy as np

        with wave.open(str(path)) as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                raise ValueError('VAD requires mono PCM16 16 kHz WAV')

            def chunks():
                while data := audio.readframes(round(16000 * chunk_seconds)):
                    yield np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768

            return self._process(chunks(), audio.getnframes(), progress)

    def _process(self, chunks, total, progress):
        result, position = [], 0
        for samples in chunks:
            # Offline callers only need timestamps. Release each batch's PCM
            # immediately instead of retaining the whole meeting until EOF.
            result.extend(
                dict(start_ms=s, end_ms=e)
                for s, e, _, _ in self.accept('offline', samples, round(position / 16))
            )
            position += len(samples)
            if progress:
                progress(position, total)
        result.extend(dict(start_ms=s, end_ms=e) for s, e, _, _ in self.flush('offline'))
        return result
