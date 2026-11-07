"""离线验证手机分流，包括删除、跨端移动与无法读取提交的保守处理。"""

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "ci_mobile_changes", Path(__file__).with_name("ci-mobile-changes.py")
)
changes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changes)


class MobileChangesTests(unittest.TestCase):
    def test_platforms(self):
        for paths, expected in [
            (["mobile/README.md"], (False, False)),
            (["mobile/web/preview.dart"], (False, False)),
            (["mobile/fastlane/README.md"], (False, False)),
            (["mobile/test/recording_test.dart"], (False, False)),
            (["mobile/scripts/test-release.rb"], (False, False)),
            (["scripts/test-ci-mobile-changes.py"], (False, False)),
            (["mobile/ios/Runner/SceneDelegate.swift"], (False, True)),
            (["mobile/Gemfile.lock"], (False, True)),
            (["mobile/fastlane/Fastfile"], (False, True)),
            (["mobile/scripts/ios-signing.sh"], (False, True)),
            (["mobile/android/app/build.gradle.kts"], (True, False)),
            (["mobile/android/app/src/test/kotlin/UpdateDownloadTest.kt"], (True, False)),
            (["mobile/scripts/android-release.py"], (True, False)),
            (["mobile/lib/recorder.dart"], (True, True)),
            (["mobile/pubspec.lock"], (True, True)),
            (["mobile/assets/brevia-logo.png"], (True, True)),
            ([".github/workflows/mobile.yml"], (True, True)),
            (["scripts/ci-mobile-changes.py"], (True, True)),
            (["mobile/ios/old.swift", "mobile/android/new.kt"], (True, True)),
            (["mobile/README.md", "mobile/lib/main.dart"], (True, True)),
        ]:
            with self.subTest(paths=paths):
                self.assertEqual(changes.platforms(paths), expected)

    def test_diff(self):
        base, head = "a" * 40, "b" * 40
        with (
            patch.object(changes, "last_successful_push", return_value=base),
            patch.object(
                subprocess,
                "check_output",
                return_value="mobile/ios/删除.swift\0mobile/android/新建.kt\0",
            ) as git,
        ):
            paths = changes.changed_paths("push", {"before": base, "after": head})
            self.assertEqual(changes.platforms(paths), (True, True))
            self.assertIn("--no-renames", git.call_args.args[0])
            self.assertEqual(git.call_args.args[0][-3:], [base, head, "--"])
            changes.changed_paths(
                "pull_request", {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}
            )
            self.assertEqual(git.call_args.args[0][-2:], [f"{base}...{head}", "--"])
        with (
            patch.object(changes, "last_successful_push", return_value=base),
            patch.object(
                subprocess, "check_output", side_effect=subprocess.CalledProcessError(1, "git")
            ),
        ):
            self.assertIsNone(changes.changed_paths("push", {"before": base, "after": head}))
        self.assertIsNone(changes.changed_paths("workflow_dispatch", {}))
        self.assertIsNone(changes.changed_paths("push", {"before": "0" * 40, "after": head}))
        with self.assertRaises(ValueError):
            changes.changed_paths("push", {"before": "--bad", "after": head})

    def test_coalesced_pushes_compare_from_last_success(self):
        previous, before, head = "a" * 40, "b" * 40, "c" * 40
        with (
            patch.object(changes, "last_successful_push", return_value=previous),
            patch.object(
                subprocess, "check_output", return_value="mobile/android/app/build.gradle.kts\0"
            ) as git,
        ):
            paths = changes.changed_paths("push", {"before": before, "after": head})
            self.assertEqual(git.call_args.args[0][-3:], [previous, head, "--"])
            self.assertEqual(changes.platforms(paths), (True, False))
        with patch.object(changes, "last_successful_push", return_value=None):
            self.assertIsNone(changes.changed_paths("push", {"before": before, "after": head}))

    def test_successful_push_lookup(self):
        with patch.dict(
            os.environ,
            {
                "GITHUB_API_URL": "https://api.github.com",
                "GITHUB_REPOSITORY": "owner/repo",
                "GITHUB_TOKEN": "test-only",
            },
        ):
            response = io.BytesIO(json.dumps({"workflow_runs": [{"head_sha": "a" * 40}]}).encode())
            with patch.object(changes.urllib.request, "urlopen", return_value=response) as request:
                self.assertEqual(changes.last_successful_push(), "a" * 40)
                url = request.call_args.args[0].full_url
                self.assertIn("event=push&status=success&branch=main", url)
            with patch.object(
                changes.urllib.request, "urlopen", side_effect=urllib.error.URLError("offline")
            ):
                self.assertIsNone(changes.last_successful_push())


if __name__ == "__main__":
    unittest.main()
