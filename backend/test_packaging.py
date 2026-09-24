"""打包期资产（随包模型、worker 二进制）的只读校验测试。

对应 ``backend/bundled_models.py`` 与 ``backend/preflight_package.py``：前者被
``pack_worker`` 用来 prune + 补齐随包模型，后者在 electron-builder 之前拦住「worker 早于
源码」和「bundled-models 里有越界目录」这两种会被原样打进安装包的本地状态。

所有用例都在临时目录里跑，不触碰真实的 ``backend/bundled-models`` 与 ``backend/runtime``。
"""

import os
import tempfile
import time
import unittest
from pathlib import Path

from .asr import load_model_catalog, model_directory_name
from .bundled_models import (
    expected_bundled_model_names,
    missing_bundled_model_ids,
    prune_stale_bundled_models,
    unexpected_bundled_model_dirs,
)
from .config import BUNDLED_MODEL_IDS
from .preflight_package import binary_name, package_problems


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
        self.assertEqual([name for name, _ in prune_stale_bundled_models(self.root)], ["stale-punct-model"])
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
        for name in ("test_packaging.py", "diagnose_model.py", "bench_live.py", "preflight_package.py"):
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
