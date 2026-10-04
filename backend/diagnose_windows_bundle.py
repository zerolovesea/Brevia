"""Check the actual frozen Windows entry modes before publishing an installer."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--packaged', action='store_true')
    args = parser.parse_args()
    if args.packaged:
        assert not (args.runtime / 'brevia-llama-helper').exists(), 'Duplicate Windows sidecar runtime'
        for package in ('llama_cpp', 'sherpa_onnx'):
            root = args.runtime / 'brevia-worker' / '_internal' / package
            assert not any(p.suffix.lower() in {'.lib', '.exp', '.pdb', '.a', '.h', '.hpp'}
                           for p in root.rglob('*') if p.is_file()), f'Build artifacts left in {package}'
    worker = args.runtime.resolve() / 'brevia-worker' / 'brevia-worker.exe'
    with tempfile.TemporaryDirectory(prefix='brevia-win-smoke-') as directory:
        env = dict(os.environ, BREVIA_DATA_DIR=directory,
                   BREVIA_MODELS_DIR=str(Path(directory) / 'models'), BREVIA_LLAMA_HELPER='')
        def run(arguments, requests=()):
            result = subprocess.run([str(worker), *arguments],
                input=''.join(json.dumps(r) + '\n' for r in requests),
                capture_output=True, text=True, encoding='utf-8', env=env, timeout=120)
            if result.returncode:
                raise RuntimeError(f'{arguments}: exit {result.returncode}\n{result.stderr}\n{result.stdout}')
            return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]

        native = run(['--check-runtime'])
        assert native == [{'asr': 'sherpa-onnx', 'vad': 'passed', 'llama': 'passed'}], native
        sidecar = run(['--llama-sidecar'], [{'type': 'ping'}, {'type': 'shutdown'}])
        assert sidecar == [{'type': 'pong'}, {'type': 'goodbye'}], sidecar
        responses = run([], [{'id': 1, 'type': 'app.initialize', 'payload': {}}])
        answer = next(item for item in responses if item.get('id') == 1)
        assert answer['ok'], answer
        print('Windows bundle passed: Sherpa ONNX VAD, llama native backend, both JSONL entry modes')


if __name__ == '__main__':
    main()
