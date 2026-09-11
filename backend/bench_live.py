"""以真实采集节奏回放示例，测量整句链路；每次运行使用独立进程和临时会议。"""
import argparse
import base64
import hashlib
import json
import platform
import resource
import sqlite3
import sys
import tempfile
import time
import wave
from pathlib import Path


def error_rate(reference, hypothesis, language):
    def normalize(text):
        text = ''.join(c.lower() if c.isalnum() else ' ' for c in text)
        return list(''.join(text.split())) if language == 'zh' else text.split()
    expected, actual = normalize(reference), normalize(hypothesis)
    row = list(range(len(actual) + 1))
    for i, left in enumerate(expected, 1):
        previous, row = row, [i]
        for j, right in enumerate(actual, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right)))
    return row[-1] / max(1, len(expected))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--models-root', type=Path, default=Path.home() / 'brevia/models')
    parser.add_argument('--language', choices=('auto', 'zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'), help='覆盖会议识别语言；不指定时沿用源会议')
    parser.add_argument('--model', default='funasr-nano-int8')
    parser.add_argument('--legacy', action='store_true', help='对归档旧版本使用原流式模型')
    parser.add_argument('--gaps', action='store_true', help='在示例标注的句间插入 1 秒静音')
    parser.add_argument('--silence', action='store_true', help='以等长纯静音验证误触发')
    parser.add_argument('--max-speech', type=float, help='覆盖 VAD 最长语音时长以验证持续发言切段')
    parser.add_argument('--unpaced', action='store_true', help='尽快喂音频；只用于测量吞吐，不用于字幕延迟')
    parser.add_argument('--translate-to', help='转写后用现有本地模型逐段翻译，并单独计时')
    parser.add_argument('--meeting', help='只读回放已有会议 ID；结果写入临时目录')
    parser.add_argument('--source-root', type=Path, default=Path.home() / 'brevia')
    parser.add_argument('--start-seconds', type=float, default=0, help='源录音回放起点')
    parser.add_argument('--max-seconds', type=float, help='仅回放指定长度，便于验证长会议片段')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.start_seconds < 0 or (args.max_seconds is not None and args.max_seconds <= 0):
        parser.error('Invalid replay time range')
    # 直接执行此文件时，也可以对 git archive 的旧版执行完全相同的测量。
    sys.path.insert(0, str(args.project_root.resolve()))
    import os
    os.environ['BREVIA_MODELS_DIR'] = str(args.models_root.resolve())
    from backend.worker import Worker
    from backend.config import SETTINGS

    reference = None
    if args.meeting:
        if args.gaps:
            parser.error('--gaps requires the annotated example')
        with sqlite3.connect(f"file:{args.source_root.resolve() / 'brevia.db'}?mode=ro", uri=True) as db:
            row = db.execute('SELECT language FROM meetings WHERE id=?', (args.meeting,)).fetchone()
        if row is None:
            parser.error('Meeting not found')
        args.language = args.language or row[0]
        directory = args.source_root / 'meetings' / args.meeting
        tracks = json.loads((directory / 'manifest.json').read_text())['tracks']
        track = 'system' if 'system' in tracks else 'mic'
        sources = [directory / 'audio' / name for name in tracks[track]['chunks']]
    else:
        args.language = args.language or 'zh'
        if args.language not in {'zh', 'en', 'es'}:
            parser.error('Use --meeting for this language')
        example = next(x for x in json.loads((args.project_root / 'backend/examples.json').read_text()) if x['locale'] == args.language)
        sources = [args.project_root / 'backend/fixtures' / example['audio']]
        reference = ' '.join(segment[3] for segment in example['segments'])
        track = 'system'
    blocks = []
    for source in sources:
        with wave.open(str(source)) as recording:
            assert recording.getframerate() == 16000 and recording.getnchannels() == 1 and recording.getsampwidth() == 2
            blocks.append(recording.readframes(recording.getnframes()))
    pcm = b''.join(blocks)
    if args.start_seconds or args.max_seconds is not None:
        if args.gaps:
            parser.error('--gaps cannot be combined with a time range')
        start = round(args.start_seconds * 16000) * 2
        end = start + round(args.max_seconds * 16000) * 2 if args.max_seconds is not None else len(pcm)
        pcm, reference = pcm[start:end], None
        if not pcm:
            parser.error('Replay range contains no audio')
    source_seconds = len(pcm) / 32000
    if args.gaps:
        chunks, offset = [], 0
        for index, segment in enumerate(example['segments']):
            end = round(segment[1] * 16) if index < len(example['segments']) - 1 else len(pcm) // 2
            chunks.append(pcm[offset * 2:end * 2])
            chunks.append(bytes(32000))
            offset = end
        pcm = b''.join(chunks)
    if args.silence:
        pcm, reference = bytes(len(pcm)), ''
    # 两秒尾静音让正常端点有机会触发，stop 仍负责剩余语音与排队任务。
    pcm += bytes(64000)
    events = []
    def emit(event):
        events.append({**event, 'wall': time.perf_counter()})
    with tempfile.TemporaryDirectory(prefix='brevia-benchmark-') as data:
        worker = Worker(data, emit)
        if args.max_speech:
            for parameters in SETTINGS['vad'].values():
                parameters['max_speech_duration'] = args.max_speech
        started = time.perf_counter()
        meeting = worker.start({
            'title': 'Sentence benchmark', 'language': args.language,
            'refined_model_id': args.model, 'vad_model_id': 'silero-vad', 'audio_tracks': [track],
        })
        if worker.asr is None:
            raise RuntimeError('ASR failed to load')
        load_seconds = time.perf_counter() - started
        loaded_peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        started, cpu_started = time.perf_counter(), time.process_time()
        call_times = []
        decode_seconds = []
        decode_timings, audio_windows = [], []
        if not args.legacy:
            decode = worker.asr.decode
            def measured_decode(samples, sample_rate):
                decode_seconds.append(len(samples) / sample_rate)
                began = time.perf_counter()
                try:
                    return decode(samples, sample_rate)
                finally:
                    decode_timings.append({'start_wall_seconds': began - started,
                                           'inference_seconds': time.perf_counter() - began})
            worker.asr.decode = measured_decode
            queue_sentence = worker._queue_sentence
            def measured_queue(track, segment):
                audio_windows.append({'start_ms': segment[0], 'end_ms': segment[1],
                                      'queued_wall_seconds': time.perf_counter() - started})
                return queue_sentence(track, segment)
            worker._queue_sentence = measured_queue
        for offset in range(0, len(pcm) // 2, 2730):
            frame = pcm[offset * 2:(offset + 2730) * 2]
            if not args.unpaced:
                time.sleep(max(0, started + (offset + len(frame) // 2) / 16000 - time.perf_counter()))
            before = time.perf_counter()
            worker.audio({'meeting_id': meeting['id'], 'track': track, 'pcm': base64.b64encode(frame).decode(), 'sample_rate': 16000, 'start_ms': round(offset / 16)})
            call_times.append(time.perf_counter() - before)
        # 旧版 stop 会取消二阶段工作；先排空以比较实际精修结果，避免人为劣化基线。
        if args.legacy and worker.live_postprocessing:
            worker.live_postprocessing.submit(lambda: None).result(timeout=180)
        before = time.perf_counter()
        meeting = worker.stop({'meeting_id': meeting['id'], 'duration_ms': round(len(pcm) / 32)})
        finished = time.perf_counter()
        cpu_seconds = time.process_time() - cpu_started
        text = ' '.join(segment['text'] for segment in meeting['segments'])
        transcript_events = [e for e in events if e['type'] in {'transcript.final', 'transcript.refined'}]
        counts = {kind: sum(e['type'] == kind for e in events) for kind in ['transcript.partial', 'transcript.final', 'transcript.refined', 'worker.warning']}
        result = {
            'platform': platform.platform(), 'python': platform.python_version(),
            'language': args.language, 'model': args.model, 'legacy': args.legacy,
            'gaps': args.gaps, 'silence': args.silence, 'paced': not args.unpaced,
            'max_speech': args.max_speech, 'audio_sha256': hashlib.sha256(pcm).hexdigest(),
            'source_seconds': source_seconds, 'fed_seconds': len(pcm) / 32000,
            'load_seconds': load_seconds,
            'loaded_peak_rss_mb': loaded_peak_rss / (1024 ** 2 if sys.platform == 'darwin' else 1024),
            'wall_seconds': finished - started,
            'cpu_seconds': cpu_seconds, 'cpu_per_source_second': cpu_seconds / source_seconds,
            'peak_rss_mb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 2 if sys.platform == 'darwin' else 1024),
            'stop_seconds': finished - before,
            'audio_call_p95_ms': sorted(call_times)[int(.95 * (len(call_times) - 1))] * 1000,
            'events': counts, 'error_metric': 'CER' if args.language == 'zh' else 'WER',
            'error_rate': error_rate(reference, text, args.language) if reference is not None else None, 'text': text,
            'meeting_id': args.meeting, 'source_start_seconds': args.start_seconds, 'decode_audio_seconds': decode_seconds,
            'audio_windows': audio_windows, 'decode_timings': decode_timings,
            'max_subtitle_chars': max((len(s['text']) for s in meeting['segments']), default=0),
            'overlapping_segments': sum(a['end_ms'] > b['start_ms'] for a, b in zip(meeting['segments'], meeting['segments'][1:])),
            'emissions': [{'type': e['type'], 'wall_seconds': e['wall'] - started,
                           'start_ms': e['payload']['start_ms'], 'end_ms': e['payload']['end_ms'],
                           'text': e['payload']['text']} for e in transcript_events],
            'warnings': [e['payload'] for e in events if e['type'] == 'worker.warning'],
        }
        if not args.unpaced and transcript_events:
            end_delays = sorted(e['wall'] - started - e['payload']['end_ms'] / 1000 for e in transcript_events)
            start_delays = sorted(e['wall'] - started - e['payload']['start_ms'] / 1000 for e in transcript_events)
            result['latency_seconds'] = {
                'from_end_p50': end_delays[len(end_delays) // 2],
                'from_end_max': max(end_delays),
                'from_start_p50': start_delays[len(start_delays) // 2],
                'from_start_max': max(start_delays),
                'first_from_speech_start': transcript_events[0]['wall'] - started - audio_windows[0]['start_ms'] / 1000 if audio_windows else None,
            }
        if args.translate_to:
            translation_started = time.perf_counter()
            children_before = resource.getrusage(resource.RUSAGE_CHILDREN)
            try:
                translations = [worker.translate({
                    'meeting_id': meeting['id'], 'segment_id': segment['id'],
                    'target_language': args.translate_to, 'consent': True,
                })['translation'] for segment in meeting['segments']]
            finally:
                worker.shutdown_sidecars()
            children_after = resource.getrusage(resource.RUSAGE_CHILDREN)
            result['translation'] = {
                'target': args.translate_to, 'wall_seconds': time.perf_counter() - translation_started,
                'cpu_seconds': children_after.ru_utime + children_after.ru_stime - children_before.ru_utime - children_before.ru_stime,
                'texts': translations,
            }
            assert all(translations), 'Empty translation'
        if not args.legacy:
            assert counts['transcript.partial'] == counts['transcript.refined'] == 0
            assert not list(Path(data).rglob('sentence-*.npy'))
        if args.silence:
            assert not text, 'Silence produced a transcript'
        output = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output)
        print(output)
        worker.store.close_audio_sessions()


if __name__ == '__main__':
    main()
