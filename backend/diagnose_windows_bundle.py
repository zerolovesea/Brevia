"""Check the actual frozen Windows entry modes before publishing an installer."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import wave

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.process_resources import stop_process_tree  # noqa: E402


def check_parent_exit(command, payload, env):
    """在原生模型已加载后强退父端；失败时仍回收受测进程。"""
    descendants = []
    with tempfile.TemporaryDirectory(prefix='brevia-parent-exit-') as directory:
        log = Path(directory) / 'native.log'
        with tempfile.TemporaryFile() as output, log.open('wb') as errors:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=errors,
                env=env,
                text=True,
                encoding='utf-8',
            )
            try:
                process.stdin.write(json.dumps(payload) + '\n')
                process.stdin.flush()
                deadline = time.monotonic() + 30
                parent = psutil.Process(process.pid)
                while time.monotonic() < deadline and process.poll() is None:
                    descendants = parent.children(recursive=True)
                    stages = log.read_bytes()
                    if descendants and (
                        b'next=diarization' in stages or b'stage=diarization' in stages
                    ):
                        break
                    time.sleep(0.01)
                else:
                    raise RuntimeError('Frozen parent did not reach native analysis')
                process.kill()
                process.wait(timeout=5)
                _, alive = psutil.wait_procs(descendants, timeout=5)
                if alive:
                    raise RuntimeError(
                        f'Frozen parent left analysis processes: {[p.pid for p in alive]}'
                    )
            finally:
                stop_process_tree(process, descendants)
                process.stdin.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--packaged', action='store_true')
    args = parser.parse_args()
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
            BREVIA_ASR_BACKEND='cpu',
        )

        def run(arguments, requests=(), *, keep_stdin_open=False):
            command = [str(worker), *arguments]
            packet = ''.join(json.dumps(r) + '\n' for r in requests)
            if keep_stdin_open:
                # communicate 会提前关闭 stdin，使冻结子进程继承管道的死锁无法复现。
                with (
                    tempfile.TemporaryFile(mode='w+', encoding='utf-8') as output,
                    tempfile.TemporaryFile(mode='w+', encoding='utf-8') as errors,
                ):
                    process = subprocess.Popen(
                        command,
                        stdin=subprocess.PIPE,
                        stdout=output,
                        stderr=errors,
                        text=True,
                        encoding='utf-8',
                        env=env,
                    )
                    try:
                        process.stdin.write(packet)
                        process.stdin.flush()
                        process.wait(timeout=120)
                    finally:
                        stop_process_tree(process)
                        process.stdin.close()
                    output.seek(0)
                    errors.seek(0)
                    result = subprocess.CompletedProcess(
                        command, process.returncode, output.read(), errors.read()
                    )
            else:
                result = subprocess.run(
                    command,
                    input=packet,
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
        analysis = run(['--check-diarization'], [payload], keep_stdin_open=True)
        assert analysis == [{'diarization': 'passed'}], analysis
        analysis = run(['--check-analysis-session'], [payload], keep_stdin_open=True)
        assert analysis == [{'diarization': 'passed'}], analysis
        for argument in ('--check-diarization', '--check-analysis-session'):
            check_parent_exit([str(worker), argument], payload, env)
        print(
            'Windows bundle passed: native models, both analysis modes, shutdown and parent crash cleanup'
        )


if __name__ == '__main__':
    main()
