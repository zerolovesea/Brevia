"""Check the actual frozen Windows entry modes before publishing an installer."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--packaged', action='store_true')
    parser.add_argument('--cuda', action='store_true')
    parser.add_argument(
        '--gpu', action='store_true', help='Require a working NVIDIA GPU and execute CUDA inference'
    )
    args = parser.parse_args()
    if args.gpu and not args.cuda:
        parser.error('--gpu requires --cuda')
    if args.packaged:
        assert not (args.runtime / 'brevia-llama-helper').exists(), (
            'Duplicate Windows sidecar runtime'
        )
        for package in ('llama_cpp', 'sherpa_onnx'):
            root = args.runtime / 'brevia-worker' / '_internal' / package
            assert not any(
                p.suffix.lower() in {'.lib', '.exp', '.pdb', '.a', '.h', '.hpp'}
                for p in root.rglob('*')
                if p.is_file()
            ), f'Build artifacts left in {package}'
    worker = args.runtime.resolve() / 'brevia-worker' / 'brevia-worker.exe'
    with tempfile.TemporaryDirectory(prefix='brevia-win-smoke-') as directory:
        env = dict(
            os.environ,
            BREVIA_DATA_DIR=directory,
            BREVIA_MODELS_DIR=str(Path(directory) / 'models'),
            BREVIA_LLAMA_HELPER='',
            BREVIA_ASR_BACKEND='cuda' if args.gpu else 'cpu',
            BREVIA_EXPECT_CUDA='1' if args.cuda else '0',
            BREVIA_VALIDATE_GPU='1' if args.gpu else '0',
        )

        def run(arguments, requests=()):
            result = subprocess.run(
                [str(worker), *arguments],
                input=''.join(json.dumps(r) + '\n' for r in requests),
                capture_output=True,
                text=True,
                encoding='utf-8',
                env=env,
                timeout=120,
            )
            if result.returncode:
                raise RuntimeError(
                    f'{arguments}: exit {result.returncode}\n{result.stderr}\n{result.stdout}'
                )
            return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]

        native = run(['--check-runtime'])
        expected = {'asr': 'sherpa-onnx', 'vad': 'passed', 'llama': 'passed'}
        if args.gpu:
            expected['gpu'] = 'passed'
        assert native == [expected], native
        sidecar = run(['--llama-sidecar'], [{'type': 'ping'}, {'type': 'shutdown'}])
        assert sidecar == [{'type': 'pong'}, {'type': 'goodbye'}], sidecar
        responses = run([], [{'id': 1, 'type': 'app.initialize', 'payload': {}}])
        answer = next(item for item in responses if item.get('id') == 1)
        assert answer['ok'], answer
        # 真实冻结入口、Unicode 路径、完整分割及声纹链路；不能只测主进程和 VAD。
        fixture = args.runtime.resolve().parent / 'fixtures' / 'example-zh.wav'
        audio_path = Path(directory) / '说话人启动检查.wav'
        with wave.open(str(fixture)) as source, wave.open(str(audio_path), 'wb') as output:
            output.setparams(source.getparams())
            data = source.readframes(source.getnframes())
            target_bytes = source.getframerate() * 60 * source.getsampwidth()
            output.writeframes((data * (target_bytes // len(data) + 1))[:target_bytes])
        payload = {
            'path': str(audio_path),
            'models_root': env['BREVIA_MODELS_DIR'],
            'bundled_models_root': str(args.runtime.resolve().parent / 'bundled-models'),
            'window_start_ms': 0,
            'window_end_ms': 60000,
            'core_start_ms': 0,
            'core_end_ms': 60000,
            'speech': [{'start_ms': 0, 'end_ms': 60000}],
            'segmentation_id': 'pyannote-segmentation-3.0',
            'threshold': 0.35,
        }
        analysis = run(['--diarization'], [payload])
        assert analysis[0] == [None, 'import_modules'], analysis
        assert [None, 'diarization'] in analysis, analysis
        assert analysis[-1][0] is True and analysis[-1][1], analysis
        assert any(turn.get('_embedding') for turn in analysis[-1][1]), analysis
        print(
            'Windows bundle passed: Sherpa ONNX VAD, llama native backend, JSONL entries, 60s diarization'
        )


if __name__ == '__main__':
    main()
