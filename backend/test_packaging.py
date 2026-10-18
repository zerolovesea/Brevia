"""打包期资产（随包模型、worker 二进制）的只读校验测试。

对应 ``backend/bundled_models.py`` 与 ``backend/preflight_package.py``：前者被
``pack_worker`` 用来 prune + 补齐随包模型，后者在 electron-builder 之前拦住「worker 早于
源码」和「bundled-models 里有越界目录」这两种会被原样打进安装包的本地状态。

所有用例都在临时目录里跑，不触碰真实的 ``backend/bundled-models`` 与 ``backend/runtime``。
"""

import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from .asr import ModelManager, load_model_catalog, model_directory_name
from .bundled_models import (
    expected_bundled_model_names,
    missing_bundled_model_ids,
    prune_stale_bundled_models,
    unexpected_bundled_model_dirs,
)
from .config import BUNDLED_MODEL_IDS
from .preflight_package import binary_name, package_problems


class DiarizationProcessTest(unittest.TestCase):
    def test_source_entry_reports_startup_and_runs_native_models(self):
        from .diarization_process import DiarizationProcess

        backend = Path(__file__).parent.resolve()
        manager = ModelManager(backend / 'bundled-models', cleanup=False)
        if not all(manager.is_ready(model_id) for model_id in BUNDLED_MODEL_IDS):
            self.skipTest('bundled native models are not installed')
        with tempfile.TemporaryDirectory() as root:
            payload = {
                'path': str(backend / 'fixtures' / 'example-zh.wav'),
                'models_root': root,
                'bundled_models_root': str(backend / 'bundled-models'),
                'window_start_ms': 0,
                'window_end_ms': 2000,
                'core_start_ms': 0,
                'core_end_ms': 2000,
                'speech': [{'start_ms': 0, 'end_ms': 2000}],
                'segmentation_id': 'pyannote-segmentation-3.0',
                'threshold': 0.35,
            }
            messages = []
            with patch.dict(os.environ, {'BREVIA_ASR_BACKEND': 'cpu'}):
                process = DiarizationProcess(payload)
                try:
                    deadline = time.monotonic() + 60
                    while time.monotonic() < deadline:
                        if process.poll(0.1):
                            message = process.recv()
                            messages.append(message)
                            if message[0] is not None:
                                break
                    else:
                        self.fail('Diarization entry did not respond within 60 seconds')
                finally:
                    process.close()
            self.assertFalse(process.reader.is_alive())
            self.assertFalse(process.writer.is_alive())
            self.assertIsNotNone(process.process.returncode)
        self.assertEqual(messages[0], [None, 'import_modules'])
        self.assertIn([None, 'diarization'], messages)
        self.assertTrue(messages[-1][0], messages)
        self.assertTrue(any(t['_embedding'] for t in messages[-1][1]))

    def test_offline_thread_override_does_not_change_live_budget(self):
        with patch.dict(os.environ, {'BREVIA_OFFLINE_THREADS': '8'}):
            self.assertEqual(ModelManager.device()['threads'], 8)
            self.assertLessEqual(ModelManager.thread_budget(), 2)
        with patch.dict(os.environ, {'BREVIA_OFFLINE_THREADS': '0'}):
            with self.assertRaises(ValueError):
                ModelManager.device()


class BenchmarkCompatibilityTest(unittest.TestCase):
    def test_model_diagnosis_defaults_to_platform_model_and_project_fixture(self):
        from .diagnose_model import main

        for platform, model_id in (("Darwin", "funasr-nano-mlx"), ("Windows", "funasr-nano-int8")):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as root:
                output = io.StringIO()
                recognizer = Mock(max_speech_seconds=22.0)
                recognizer.decode.return_value = "识别样例"
                with (
                    patch("backend.asr.platform.system", return_value=platform),
                    patch("sys.argv", ["diagnose_model", "--models-dir", root]),
                    patch("backend.diagnose_model.RefinedASR", return_value=recognizer) as factory,
                    patch("sys.stdout", output),
                ):
                    main()
                self.assertEqual(json.loads(output.getvalue())["model_id"], model_id)
                self.assertEqual(factory.call_args.args[1], model_id)
                self.assertGreater(len(recognizer.decode.call_args.args[0]), 0)

    def test_refinement_benchmark_skips_sherpa_only_for_mlx(self):
        from .bench_refinement import main

        for platform in ("Darwin", "Windows"):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as root:
                with (
                    patch("backend.asr.platform.system", return_value=platform),
                    patch.dict(os.environ, {"BREVIA_BUNDLED_MODELS_DIR": root}),
                    patch(
                        "sys.argv",
                        ["bench_refinement", "--models-root", root, "--max-seconds", "1"],
                    ),
                    patch("backend.bench_refinement.benchmark_sherpa", return_value={}) as native,
                    patch("backend.bench_refinement.benchmark_python_stages", return_value=[]),
                    patch("backend.bench_refinement.benchmark_python_pipeline", return_value={}),
                    patch("sys.stdout", io.StringIO()),
                ):
                    main()
                self.assertEqual(native.call_count, int(platform == "Windows"))

    def test_windows_benchmark_reads_native_peak_working_set_without_resource(self):
        from .bench_asr_models import peak_rss_mb

        def query(_handle, pointer, size):
            self.assertEqual(pointer._obj.cb, size)
            pointer._obj.PeakWorkingSetSize = 123 * 1024 * 1024
            return True

        kernel = SimpleNamespace(GetCurrentProcess=Mock(return_value=1))
        psapi = SimpleNamespace(GetProcessMemoryInfo=Mock(side_effect=query))
        with (
            patch("sys.platform", "win32"),
            patch("ctypes.WinDLL", side_effect=[kernel, psapi], create=True),
            patch.dict("sys.modules", {"resource": None}),
        ):
            self.assertEqual(peak_rss_mb(), 123)


class PackagingAssetTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def complete_models(self, models_root):
        """在给定目录里造假一个「文件齐全」的随包模型库。"""
        catalog = load_model_catalog()
        for model_id in BUNDLED_MODEL_IDS:
            model = catalog[model_id]
            directory = models_root / model_directory_name(model_id, model["revision"])
            for name in model["files"]:
                target = directory / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()

    def write_workers(self, root=None, platform="darwin"):
        root = root or self.root
        for name in ("brevia-worker", "brevia-llama-helper"):
            binary = root / "runtime" / name / binary_name(name, platform)
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(b"binary")


class BundledModelTest(PackagingAssetTest):
    def test_sherpa_model_runtime_matches_worker_requirement(self):
        requirement = next(
            line.strip()
            for line in Path(__file__)
            .with_name("requirements.txt")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.startswith("sherpa-onnx==")
        )
        runtimes = {
            model["runtime"]
            for model in load_model_catalog().values()
            if model["runtime"].startswith("sherpa-onnx==")
        }
        self.assertEqual(runtimes, {requirement})

    def test_unexpected_dirs_ignore_allowlisted_models_and_plain_files(self):
        expected = sorted(expected_bundled_model_names())
        (self.root / expected[0]).mkdir()
        (self.root / "stale-punct-model").mkdir()
        (self.root / "notes.txt").write_text("x", encoding="utf-8")
        self.assertEqual(unexpected_bundled_model_dirs(self.root), ["stale-punct-model"])

    def test_unexpected_dirs_of_missing_root_is_empty(self):
        self.assertEqual(unexpected_bundled_model_dirs(self.root / "absent"), [])

    def test_prune_only_removes_marked_unexpected_dirs(self):
        expected = sorted(expected_bundled_model_names())
        (self.root / expected[0]).mkdir()
        marked = self.root / "stale-punct-model"
        marked.mkdir()
        (marked / ".brevia.json").write_text("{}", encoding="utf-8")
        (marked / "model.onnx").write_bytes(b"12345")
        unmarked = self.root / "not-managed-by-brevia"
        unmarked.mkdir()
        self.assertEqual(
            [name for name, _ in prune_stale_bundled_models(self.root)], ["stale-punct-model"]
        )
        self.assertFalse(marked.exists())
        self.assertTrue(unmarked.exists())
        self.assertTrue((self.root / expected[0]).exists())

    def test_missing_ids_reports_incomplete_root(self):
        self.assertEqual(missing_bundled_model_ids(self.root), list(BUNDLED_MODEL_IDS))
        self.complete_models(self.root)
        self.assertEqual(missing_bundled_model_ids(self.root), [])


class PreflightTest(PackagingAssetTest):
    def problems(self):
        return package_problems(self.root, self.root / "bundled-models", platform="darwin")

    def test_empty_root_reports_every_missing_asset(self):
        problems = self.problems()
        self.assertEqual(len(problems), 3)
        joined = "\n".join(problems)
        self.assertIn("brevia-worker", joined)
        self.assertIn("brevia-llama-helper", joined)
        self.assertIn("缺少必须随包的模型", joined)

    def test_flags_worker_older_than_sources(self):
        self.complete_models(self.root / "bundled-models")
        self.write_workers()
        source = self.root / "worker_session.py"
        source.write_text("x = 1", encoding="utf-8")
        future = time.time() + 60
        os.utime(source, (future, future))
        problems = self.problems()
        self.assertEqual(len(problems), 2)
        self.assertTrue(all("早于源码" in problem for problem in problems))

    def test_dev_only_scripts_do_not_invalidate_a_built_worker(self):
        self.complete_models(self.root / "bundled-models")
        self.write_workers()
        for name in (
            "test_packaging.py",
            "diagnose_model.py",
            "bench_live.py",
            "preflight_package.py",
        ):
            path = self.root / name
            path.write_text("x = 1", encoding="utf-8")
            future = time.time() + 60
            os.utime(path, (future, future))
        self.assertEqual(self.problems(), [])

    def test_worker_data_inputs_do_not_invalidate_a_built_worker(self):
        # models.json / settings.json / fixtures 都被 --add-data 烘进 worker，
        # 改它们（例如调整默认模型映射）后必须重建，否则包里的清单与生效的清单不一致。
        self.complete_models(self.root / "bundled-models")
        self.write_workers()
        for name in ("models.json", "settings.json", "examples.json"):
            path = self.root / name
            path.write_text("{}", encoding="utf-8")
            future = time.time() + 60
            os.utime(path, (future, future))
        fixture = self.root / "fixtures" / "example-zh.wav"
        fixture.parent.mkdir(parents=True, exist_ok=True)
        fixture.write_bytes(b"wav")
        future = time.time() + 60
        os.utime(fixture, (future, future))
        problems = self.problems()
        self.assertEqual(len(problems), 2)
        self.assertTrue(all("早于源码" in problem for problem in problems))

    def test_passes_when_worker_is_fresh_and_models_are_complete(self):
        self.complete_models(self.root / "bundled-models")
        source = self.root / "worker_session.py"
        source.write_text("x = 1", encoding="utf-8")
        past = time.time() - 60
        os.utime(source, (past, past))
        self.write_workers()
        self.assertEqual(self.problems(), [])


class WindowsRuntimeTest(PackagingAssetTest):
    def test_windows_runtime_requires_avx2_without_avx512(self):
        import sys
        from unittest.mock import Mock, patch

        from .check_windows_runtime import main

        catalog = {
            'silero-vad': {
                'runtime': 'sherpa-onnx',
                'revision': 'test',
                'files': ['vad.onnx'],
            }
        }
        for info, compatible in (
            (b'CPU : AVX = 1 | AVX2 = 1 | FMA = 1 |', True),
            (b'CPU : AVX2 = 1 | AVX512 = 0 |', True),
            (b'CPU : AVX = 1 |', False),
            (b'CPU : AVX2 = 0 |', False),
            (b'CPU : AVX2 = 1 | AVX512 = 1 |', False),
            (b'CPU : AVX2 = 1 | AVX512_VBMI = 1 |', False),
            (b'CPU : AVX2 = 1 | AVX512_VNNI = 1 |', False),
            (b'CPU : AVX2 = 1 | AVX512_BF16 = 1 |', False),
        ):
            native, sherpa = Mock(), Mock()
            native.llama_print_system_info.return_value = info
            sherpa.VoiceActivityDetector.return_value.empty.return_value = True
            with (
                self.subTest(info=info),
                patch.dict(sys.modules, {'llama_cpp': native, 'sherpa_onnx': sherpa}),
                patch('backend.asr.load_model_catalog', return_value=catalog),
                patch('builtins.print') as output,
            ):
                if compatible:
                    main()
                    output.assert_called_once_with(
                        '{"asr": "sherpa-onnx", "vad": "passed", "llama": "passed"}'
                    )
                else:
                    with self.assertRaisesRegex(RuntimeError, 'AVX2.*AVX512'):
                        main()
                    output.assert_not_called()

    def test_windows_requires_only_the_unified_worker(self):
        self.complete_models(self.root / 'bundled-models')
        binary = self.root / 'runtime' / 'brevia-worker' / 'brevia-worker.exe'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'PE fixture')
        self.assertEqual(package_problems(self.root, platform='win32'), [])
        source = self.root / 'llama_sidecar.py'
        source.write_text('# changed sidecar', encoding='utf-8')
        future = time.time() + 60
        os.utime(source, (future, future))
        self.assertIn('早于源码', package_problems(self.root, platform='win32')[0])

    def test_windows_build_embeds_sidecar_and_excludes_mlx(self):
        import runpy
        import sys
        from types import ModuleType
        from unittest.mock import Mock, patch

        package = ModuleType('PyInstaller')
        package.__path__ = []
        entry = ModuleType('PyInstaller.__main__')
        entry.run = Mock()
        package.__main__ = entry
        with (
            patch.dict(sys.modules, {'PyInstaller': package, 'PyInstaller.__main__': entry}),
            patch.object(sys, 'platform', 'win32'),
            patch('backend.bundled_models.prepare_bundled_models'),
        ):
            runpy.run_path(str(Path(__file__).with_name('pack_worker.py')))
        args = entry.run.call_args.args[0]

        def values(flag):
            return {args[i + 1] for i, value in enumerate(args[:-1]) if value == flag}

        self.assertTrue(
            {
                'backend.llama_sidecar',
                'backend.check_windows_runtime',
                'backend.diarization_process',
            }
            <= values('--hidden-import')
        )
        self.assertTrue({'sherpa_onnx', 'llama_cpp'} <= values('--collect-binaries'))
        self.assertTrue(
            {'backend.mlx_asr', 'mlx', 'mlx_audio', 'transformers'} <= values('--exclude-module')
        )
        self.assertNotIn('sherpa_onnx', values('--exclude-module'))

    def test_windows_entry_dispatches_sidecar_without_starting_worker(self):
        import sys
        from unittest.mock import Mock, patch
        from . import worker_entry

        for flag, module in [
            ('--llama-sidecar', 'backend.llama_sidecar'),
            ('--check-runtime', 'backend.check_windows_runtime'),
            ('--check-diarization', 'backend.check_windows_runtime'),
            ('--diarization', 'backend.diarization_process'),
        ]:
            target = Mock()
            with (
                patch.object(sys, 'platform', 'win32'),
                patch.object(sys, 'argv', ['brevia-worker.exe', flag]),
                patch.object(worker_entry.multiprocessing, 'freeze_support'),
                patch.object(worker_entry, 'import_module', return_value=target) as load,
                patch('backend.worker.main') as worker_main,
            ):
                worker_entry.main()
            load.assert_called_once_with(module)
            target.main.assert_called_once_with()
            worker_main.assert_not_called()

    def test_windows_sidecar_is_a_separate_process_using_the_same_exe(self):
        import sys
        from unittest.mock import patch
        from .worker_llama_sidecar import LlamaSidecarMixin

        with (
            patch.object(sys, 'frozen', True, create=True),
            patch.object(sys, 'platform', 'win32'),
            patch.object(sys, 'executable', 'C:/Brevia/brevia-worker.exe'),
            patch.dict(os.environ, {'BREVIA_LLAMA_HELPER': ''}),
        ):
            self.assertEqual(
                LlamaSidecarMixin._sidecar_command(None),
                ['C:/Brevia/brevia-worker.exe', '--llama-sidecar'],
            )

    def test_macos_still_uses_the_separate_sidecar_binary(self):
        import sys
        from unittest.mock import patch
        from .worker_llama_sidecar import LlamaSidecarMixin

        internal = self.root / 'runtime' / 'brevia-worker' / '_internal'
        helper = internal.parent.parent / 'brevia-llama-helper' / 'brevia-llama-helper'
        helper.parent.mkdir(parents=True)
        helper.touch()
        with (
            patch.object(sys, 'frozen', True, create=True),
            patch.object(sys, '_MEIPASS', str(internal), create=True),
            patch.object(sys, 'platform', 'darwin'),
            patch.dict(os.environ, {'BREVIA_LLAMA_HELPER': ''}),
        ):
            self.assertEqual(LlamaSidecarMixin._sidecar_command(None), [str(helper)])

    def test_default_entry_still_starts_the_worker_on_both_platforms(self):
        import sys
        from unittest.mock import patch
        from . import worker_entry

        for platform in ('darwin', 'win32'):
            with (
                patch.object(sys, 'platform', platform),
                patch.object(sys, 'argv', ['brevia-worker']),
                patch.object(worker_entry.multiprocessing, 'freeze_support'),
                patch.object(worker_entry, 'import_module') as dynamic,
                patch('backend.worker.protocol_output', return_value='protocol'),
                patch('backend.worker.main') as worker_main,
            ):
                worker_entry.main()
            worker_main.assert_called_once_with('protocol')
            dynamic.assert_not_called()
