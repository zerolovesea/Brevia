"""electron-builder 之前的打包前置校验。

本地图快直接 ``npm run package:mac`` / ``package:win``（不经过 ``pack:backend``）时，
``extraResources`` 会原样复制磁盘上现成的 ``backend/runtime/`` 与
``backend/bundled-models/``，于是：

- worker 二进制可能早于当前源码——发出去的东西「前端是新的、后端是旧的」，功能看着在
  却停在几天前的行为，比体积问题难查得多；
- 随包模型目录里可能留着已经下架的模型，白占几十上百 MB。

CI（``.github/workflows/release.yml``）与 ``npm run dist:*`` 都是先 ``pack_worker`` 再
打包，本身不会踩到；这里保护的是本地直接打包的路径。校验完全只读，不做任何清理。
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.bundled_models import missing_bundled_model_ids, unexpected_bundled_model_dirs  # noqa: E402


BACKEND = ROOT / "backend"
# worker 运行时由这些二进制承载；两个都是 `pack:backend` 的产物，任一过期都要拦。
WORKER_BINARIES = ("brevia-worker", "brevia-llama-helper")
# 构建产物目录，不是源码；比较新鲜度时必须跳过。
GENERATED_PARTS = {"build", "runtime", "bundled-models", "__pycache__", ".pytest_cache"}
# 只用于开发/诊断、不会进 worker 的文件，改了不该逼人造一次 worker。
DEV_PREFIXES = ("test_", "diagnose_", "bench_")
DEV_NAMES = {"preflight_package.py"}
# 被 `pack_worker` 用 --add-data 烘进 worker 的数据文件：清单/配置改了也必须重建，
# 否则包里的 json 是新的、worker 实际读的是二进制里那份旧的。
WORKER_DATA_INPUTS = ("settings.json", "models.json", "examples.json")
FIXTURE_DIR = "fixtures"


def binary_name(name, platform=None):
    """当前平台上该二进制的文件名。"""
    platform = platform or sys.platform
    return f"{name}.exe" if platform == "win32" else name


def source_files(root=BACKEND):
    """worker 的构建输入：Python 源码 + 被 --add-data 打包的清单与 fixtures。"""
    for path in root.rglob("*.py"):
        if GENERATED_PARTS & set(path.relative_to(root).parts):
            continue
        if path.name in DEV_NAMES or path.name.startswith(DEV_PREFIXES):
            continue
        yield path
    for name in WORKER_DATA_INPUTS:
        path = root / name
        if path.is_file():
            yield path
    fixture_root = root / FIXTURE_DIR
    if fixture_root.is_dir():
        for path in fixture_root.rglob("*"):
            if path.is_file():
                yield path


def newest_source(root=BACKEND):
    """返回最新源码文件的 ``(mtime, path)``；一个都没有时返回 ``(0.0, None)``。"""
    newest_mtime, newest_path = 0.0, None
    for path in source_files(root):
        mtime = path.stat().st_mtime
        if mtime > newest_mtime:
            newest_mtime, newest_path = mtime, path
    return newest_mtime, newest_path


def display_path(path, root):
    """尽量给出相对路径：优先相对仓库根，其次相对校验根，都不行才用绝对路径。"""
    for base in (ROOT, root):
        try:
            return str(path.relative_to(base))
        except ValueError:
            continue
    return str(path)


def worker_problem(name, root=BACKEND, platform=None):
    """二进制缺失或早于源码时返回问题描述，否则返回 ``None``。"""
    binary = root / "runtime" / name / binary_name(name, platform)
    if not binary.is_file():
        return f"缺少 worker 二进制：{binary}（先跑 `npm run pack:backend`）"
    newest_mtime, source = newest_source(root)
    if source and binary.stat().st_mtime < newest_mtime:
        return (
            f"{name} 早于源码 {display_path(source, root)}，发出去的 worker 会与前端版本错配"
            "（先跑 `npm run pack:backend`）"
        )
    return None


def bundled_model_problems(models_root=BACKEND / "bundled-models"):
    """随包模型目录的越界/缺失问题列表。"""
    problems = []
    unexpected = unexpected_bundled_model_dirs(models_root)
    if unexpected:
        problems.append(
            "bundled-models 含不在 allowlist 的目录（会被原样打进安装包，"
            "请手动删除或加入 config.py 的 BUNDLED_MODEL_IDS）：" + "、".join(unexpected)
        )
    missing = missing_bundled_model_ids(models_root)
    if missing:
        problems.append(
            "bundled-models 缺少必须随包的模型（先跑 `npm run pack:backend`）：" + "、".join(missing)
        )
    return problems


def package_problems(root=BACKEND, models_root=None, platform=None):
    """打包前必须全部为空的问题列表。"""
    problems = [
        problem
        for problem in (worker_problem(name, root, platform) for name in WORKER_BINARIES)
        if problem
    ]
    problems.extend(bundled_model_problems(models_root or root / "bundled-models"))
    return problems


def main():
    problems = package_problems()
    if problems:
        print("打包前置校验未通过：", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print("打包前置校验通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
