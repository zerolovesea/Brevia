"""按提交差异选择手机分发平台；不能确定差异时保留两端验证。"""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request


def last_successful_push():
    # 分发队列可能合并等待中的推送，必须从上次成功分发累积，而非只比较本次 before。
    url = (
        f"{os.environ['GITHUB_API_URL']}/repos/{os.environ['GITHUB_REPOSITORY']}"
        "/actions/workflows/mobile.yml/runs?event=push&status=success&branch=main&per_page=1"
    )
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            runs = json.load(response)["workflow_runs"]
        return runs[0]["head_sha"] if runs else None
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        print("无法查询上次成功分发，两端均保留。", file=sys.stderr)
        return None


def platforms(paths):
    android = ios = False
    for path in paths:
        if path.endswith(".md") or path.startswith(
            ("mobile/test/", "mobile/integration_test/", "mobile/test_driver/", "mobile/web/")
        ):
            continue
        if path == "mobile/analysis_options.yaml" or path.startswith("mobile/scripts/test-"):
            continue
        if (
            path.startswith(("mobile/ios/", "mobile/fastlane/", "mobile/Gemfile"))
            or path == "mobile/scripts/ios-signing.sh"
        ):
            ios = True
        elif path.startswith("mobile/android/") or path == "mobile/scripts/android-release.py":
            android = True
        elif path.startswith("mobile/") or path in (
            ".github/workflows/mobile.yml",
            "scripts/ci-mobile-changes.py",
        ):
            android = ios = True
    return android, ios


def changed_paths(event_name, event):
    if event_name == "workflow_dispatch":
        return None
    if event_name == "pull_request":
        base = event["pull_request"]["base"]["sha"]
        head = event["pull_request"]["head"]["sha"]
        revisions = [f"{base}...{head}"]
    elif event_name == "push":
        base, head = event["before"], event["after"]
    else:
        raise ValueError(f"Unsupported event: {event_name}")
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
        raise ValueError("Invalid commit SHA")
    if base == "0" * 40:
        return None
    if event_name == "push":
        base = last_successful_push()
        if base is None:
            return None
        if not re.fullmatch(r"[0-9a-f]{40}", base):
            raise ValueError("Invalid previous commit SHA")
        revisions = [base, head]
    try:
        result = subprocess.check_output(
            ["git", "diff", "--name-only", "--no-renames", "-z", *revisions, "--"],
            cwd=Path(__file__).resolve().parents[1],
            text=True,
        )
    except subprocess.CalledProcessError:
        # 强推可能使旧提交不可达；多跑一次两端比漏掉一次分发安全。
        return None
    return [path for path in result.split("\0") if path]


if __name__ == "__main__":
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    paths = changed_paths(os.environ["GITHUB_EVENT_NAME"], event)
    android, ios = (True, True) if paths is None else platforms(paths)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"android={str(android).lower()}\nios={str(ios).lower()}\n")
