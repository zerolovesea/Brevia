"""无需网络和凭据的更新清单回归。"""

import hashlib
import json
import os
from pathlib import Path
import runpy
import tempfile
from unittest.mock import patch

prepare = runpy.run_path(str(Path(__file__).with_name("android-release.py")))["prepare"]
with tempfile.TemporaryDirectory() as root:
    root = Path(root)
    source = root / "app.apk"
    source.write_bytes(b"signed-apk-fixture")
    apk, manifest = prepare(source, "version: 0.1.5+6\n", 1234, root / "output")
    value = json.loads(manifest.read_text())
    assert apk.name == "Brevia-0.1.5-1234.apk"
    assert value == {
        "version": "0.1.5",
        "build": 1234,
        "size": source.stat().st_size,
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    }
    try:
        prepare(source, "version: bad", 0, root / "invalid")
        raise AssertionError("Invalid version accepted")
    except ValueError:
        pass
    script = Path(__file__).with_name("android-release.py").resolve()
    working = Path.cwd()
    try:
        os.chdir(root)
        Path("pubspec.yaml").write_text("version: 0.1.5+6\n")
        binary = Path("build/app/outputs/flutter-apk/app-release.apk")
        binary.parent.mkdir(parents=True)
        binary.write_bytes(source.read_bytes())
        with patch.dict(os.environ, {"BUILD_NUMBER": "1234"}), patch("subprocess.run") as upload:
            runpy.run_path(str(script), run_name="__main__")
        assert [call.args[0][4] for call in upload.call_args_list] == [
            "android/Brevia-0.1.5-1234.apk",
            "android/Brevia-android.apk",
            "android/latest.json",
        ]
        assert Path("build/android-release/Brevia-android.apk").read_bytes() == source.read_bytes()
    finally:
        os.chdir(working)
print("Android release manifest and upload order passed")
