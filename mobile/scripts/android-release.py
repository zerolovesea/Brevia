"""生成 Android 更新清单；先上传 APK，最后发布清单。"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def prepare(apk, pubspec, build, output):
    version = re.search(r"^version: (\d+\.\d+\.\d+)\+\d+$", pubspec, re.M)
    if not version or not 0 < build <= 2100000000:
        raise ValueError("Invalid Android version")
    version = version[1]
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"Brevia-{version}-{build}.apk"
    shutil.copyfile(apk, target)
    with target.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest = output / "latest.json"
    manifest.write_text(
        json.dumps(
            {
                "version": version,
                "build": build,
                "size": target.stat().st_size,
                "sha256": digest,
            }
        )
        + "\n"
    )
    return target, manifest


if __name__ == "__main__":
    apk, manifest = prepare(
        Path("build/app/outputs/flutter-apk/app-release.apk"),
        Path("pubspec.yaml").read_text(),
        int(os.environ["BUILD_NUMBER"]),
        Path("build/android-release"),
    )
    latest = apk.with_name("Brevia-android.apk")
    shutil.copyfile(apk, latest)
    for file in (apk, latest, manifest):
        subprocess.run(
            [
                "modelscope",
                "upload",
                "zyaztec/brevia-release",
                str(file),
                f"android/{file.name}",
                "--repo-type",
                "model",
                "--commit-message",
                f"Android {os.environ['BUILD_NUMBER']}: {file.name}",
                "--disable-tqdm",
            ],
            check=True,
        )
