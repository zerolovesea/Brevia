"""Offline JSONL smoke test of source or frozen macOS worker and actual models.

python -m backend.diagnose_mlx --worker backend/runtime/brevia-worker/brevia-worker
Uses sandbox-exec to deny network, an empty HF cache and a disposable meeting DB.
"""

import argparse
import base64
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker')
    parser.add_argument('--models-dir', default='.models')
    parser.add_argument(
        '--llm',
        action='store_true',
        help='Also exercise packaged translation, notes and summary with installed GGUFs',
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='brevia-offline-') as temp:
        command = (
            [str(Path(args.worker).resolve())]
            if args.worker
            else [sys.executable, '-m', 'backend.worker']
        )
        command = [
            '/usr/bin/sandbox-exec',
            '-p',
            '(version 1)(allow default)(deny network*)',
            *command,
        ]
        env = dict(
            os.environ,
            BREVIA_DATA_DIR=temp,
            BREVIA_MODELS_DIR=str(Path(args.models_dir).resolve()),
            BREVIA_LLAMA_HELPER='' if args.worker else 'module',
            HF_HOME=str(Path(temp) / 'empty-hf'),
            HF_HUB_OFFLINE='1',
            TRANSFORMERS_OFFLINE='1',
        )
        with open('/tmp/brevia-offline-worker.log', 'w') as log:
            process = subprocess.Popen(
                command,
                cwd=root,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=log,
                text=True,
                bufsize=1,
            )
            messages, events, invalid = queue.Queue(), [], []

            def read():
                for line in process.stdout:
                    try:
                        item = json.loads(line)
                    except ValueError:
                        invalid.append(line)
                        continue
                    events.append(item)
                    if 'id' in item:
                        messages.put(item)

            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            counter = 0

            def call(kind, payload):
                nonlocal counter
                counter += 1
                time.sleep(0.012)  # Stay below the production command-rate limit.
                print(kind, file=sys.stderr, flush=True) if kind != 'meeting.audio' else None
                process.stdin.write(json.dumps(dict(id=counter, type=kind, payload=payload)) + '\n')
                process.stdin.flush()
                answer = messages.get(timeout=180)
                assert answer['id'] == counter, answer
                assert answer['ok'], answer
                return answer['result']

            def feed(meeting, language, start=0, pause=False):
                with wave.open(str(root / 'backend/fixtures' / f'example-{language}.wav')) as wav:
                    pcm = wav.readframes(wav.getnframes())
                for pos in range(0, len(pcm), 3200):
                    if pause and pos == 160000:
                        call('meeting.pause', dict(meeting_id=meeting, paused=True))
                        call('meeting.pause', dict(meeting_id=meeting, paused=False))
                    call(
                        'meeting.audio',
                        dict(
                            meeting_id=meeting,
                            track='mic',
                            pcm=base64.b64encode(pcm[pos : pos + 3200]).decode(),
                            sample_rate=16000,
                            start_ms=start + round(pos / 32),
                        ),
                    )
                return start + round(len(pcm) / 32)

            def wait_event(kind, predicate):
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    matching = [
                        e for e in events if e.get('type') == kind and predicate(e['payload'])
                    ]
                    if matching:
                        return matching[-1]
                    time.sleep(0.05)
                raise AssertionError('No event: ' + kind)

            results = []
            try:
                call('app.initialize', {})
                before = time.perf_counter()
                meeting = call(
                    'meeting.start',
                    dict(title='offline transition', language='zh', require_models=True),
                )
                end = feed(meeting['id'], 'zh', pause=True)
                call(
                    'meeting.reconfigure',
                    dict(
                        meeting_id=meeting['id'],
                        language='en',
                        refined_model_id='parakeet-tdt-0.6b-v3-mlx',
                    ),
                )
                end = feed(meeting['id'], 'en', start=end)
                stopped = call('meeting.stop', dict(meeting_id=meeting['id'], duration_ms=end))
                assert stopped['segments'], stopped
                results.append(
                    dict(
                        case='pause-switch-drain',
                        seconds=time.perf_counter() - before,
                        segments=[s['text'] for s in stopped['segments']],
                    )
                )
                for model in ('funasr-nano-mlx', 'qwen3-asr-0.6b-mlx'):
                    before = time.perf_counter()
                    meeting = call(
                        'meeting.start',
                        dict(
                            title='offline ' + model,
                            language='zh',
                            refined_model_id=model,
                            require_models=True,
                        ),
                    )
                    if args.llm and model == 'funasr-nano-mlx':
                        call(
                            'ai-note.start',
                            dict(
                                meeting_id=meeting['id'],
                                provider='built-in',
                                model='qwen3.5-4b-q4km',
                                proactivity='quiet',
                                language='zh',
                            ),
                        )
                    end = feed(meeting['id'], 'zh')
                    if args.llm and model == 'funasr-nano-mlx':
                        call('meeting.pause', dict(meeting_id=meeting['id'], paused=True))
                        wait_event('transcript.final', lambda p: p['meeting_id'] == meeting['id'])
                        call(
                            'ai-note.request',
                            dict(meeting_id=meeting['id'], notes='请记录上线安排与交付时间。'),
                        )
                        wait_event(
                            'ai-note.analyzing',
                            lambda p: p['meeting_id'] == meeting['id'] and p['active'] is False,
                        )
                        results.append(dict(case='ai-note', completed=True))
                    stopped = call('meeting.stop', dict(meeting_id=meeting['id'], duration_ms=end))
                    assert stopped['segments']
                    with (
                        wave.open(stopped['audio']['playback']['mic']) as saved,
                        wave.open(str(root / 'backend/fixtures/example-zh.wav')) as original,
                    ):
                        assert saved.readframes(saved.getnframes()) == original.readframes(
                            original.getnframes()
                        ), 'Stored PCM changed'
                    assert not list(Path(temp).rglob('sentence-*.npy')), 'Decode queue not drained'
                    results.append(
                        dict(
                            case=model,
                            seconds=time.perf_counter() - before,
                            segments=[s['text'] for s in stopped['segments']],
                        )
                    )
                    if model == 'funasr-nano-mlx':
                        refined = call(
                            'meeting.refine', dict(meeting_id=meeting['id'], num_speakers=2)
                        )
                        assert refined['status'] == 'refined', refined
                        refined = call('meeting.get', dict(meeting_id=meeting['id']))
                        assert refined['segments']
                        results.append(
                            dict(
                                case='refine-with-sherpa-diarization',
                                segments=[s['text'] for s in refined['segments']],
                            )
                        )
                        if args.llm:
                            translation = call(
                                'translation.generate',
                                dict(
                                    meeting_id=meeting['id'],
                                    segment_id=refined['segments'][0]['id'],
                                    target_language='en',
                                    consent=True,
                                ),
                            )
                            assert translation['translation']
                            summary = call(
                                'summary.generate',
                                dict(
                                    meeting_id=meeting['id'],
                                    provider='built-in',
                                    model='qwen3.5-4b-q4km',
                                    consent=True,
                                ),
                            )
                            assert summary['markdown']
                            results.append(
                                dict(
                                    case='llama-translation-summary',
                                    translation=translation['translation'],
                                    summary=summary['markdown'],
                                )
                            )
                warnings = [
                    e for e in events if e.get('type') in ('worker.warning', 'worker.error')
                ]
                assert not warnings, warnings
                assert not invalid, invalid
                assert not list((Path(temp) / 'empty-hf').rglob('*.safetensors'))
                print(
                    json.dumps(
                        dict(
                            results=results,
                            jsonl_lines=len(events),
                            network='denied by sandbox-exec',
                            warnings=warnings,
                            ai_note_suggestions=[
                                e['payload']
                                for e in events
                                if e.get('type') == 'ai-note.suggestion'
                            ],
                        ),
                        ensure_ascii=False,
                        indent=2,
                    )
                )
            finally:
                process.stdin.close()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                reader.join(timeout=5)
                assert process.returncode == 0, (
                    f'worker exit {process.returncode}; see /tmp/brevia-offline-worker.log'
                )


if __name__ == '__main__':
    main()
