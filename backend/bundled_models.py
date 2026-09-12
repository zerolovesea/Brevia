"""随包基础模型的准备与打包期校验。

``pack_worker`` 在构建时用这里 **prune + 下载 + 断言**；``preflight_package`` 在
electron-builder 之前只做 **只读校验**。两边共用同一份「哪些目录算随包模型」的
判据，避免本地直接 ``npm run package:*`` 时把陈旧的随包模型或旧 worker 发出去。
"""

import shutil
from pathlib import Path

from .asr import ModelManager, load_model_catalog, model_directory_name, model_files_present
from .config import BUNDLED_MODEL_IDS


def expected_bundled_model_names():
    """随包 allowlist 在当前平台上的目录名集合。"""
    catalog = load_model_catalog()
    return {
        model_directory_name(model_id, catalog[model_id]["revision"])
        for model_id in BUNDLED_MODEL_IDS
    }


def unexpected_bundled_model_dirs(models_root):
    """``models_root`` 下不属于 allowlist 的目录名（按名称排序）。

    只读，不删任何东西：这种目录会被 ``extraResources`` 原样打进安装包，因此打包前
    必须显式拦住。不区分有没有 ``.brevia.json`` 标记——没标记的目录同样会被复制。
    """
    root = Path(models_root)
    if not root.is_dir():
        return []
    expected = expected_bundled_model_names()
    return sorted(
        path.name
        for path in root.iterdir()
        if path.is_dir() and path.name not in expected
    )


def prune_stale_bundled_models(models_root):
    """删除 allowlist 之外、且带 ``.brevia.json`` 标记的模型目录。

    ``extraResources`` 会把整个 ``backend/`` 打进安装包，而 ``bundled-models/`` 不做
    逐个模型的排除，所以这里留着的任何东西都会随包发布。标记既是「这是 Brevia 管理的
    模型」的判据，也避免把误指到用户模型库的路径清空。

    Returns:
        ``(目录名, 释放字节数)`` 列表，便于调用方打印。
    """
    root = Path(models_root)
    if not root.is_dir():
        return []
    expected = expected_bundled_model_names()
    pruned = []
    for path in sorted(root.iterdir()):
        if path.name in expected or not path.is_dir() or not (path / ".brevia.json").is_file():
            continue
        freed = sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
        shutil.rmtree(path, ignore_errors=True)
        pruned.append((path.name, freed))
    return pruned


def missing_bundled_model_ids(models_root):
    """``models_root`` 里文件不齐的随包模型 id（按 allowlist 顺序）。

    只读：不走 ``ModelManager``，否则构造它会顺手删掉退役模型的本地副本，把校验本身
    变成有副作用的操作。
    """
    root = Path(models_root)
    catalog = load_model_catalog()
    missing = []
    for model_id in BUNDLED_MODEL_IDS:
        model = catalog[model_id]
        directory = root / model_directory_name(model_id, model["revision"])
        if not model_files_present(model, directory):
            missing.append(model_id)
    return missing


def prepare_bundled_models(models_root, log=print):
    """构建期的随包模型准备：先 prune 残留，再补齐 allowlist，最后断言文件齐全。

    构建期断言不是多余的：目录名对了不等于文件齐。漏掉一个随包模型会让功能静默
    失效（OpenWhispr #1057 就是 Windows 安装包漏了 VAD 模型，语音活动检测被静默
    禁用）。宁可让 ``npm run dist:*`` 直接失败。
    """
    for name, freed in prune_stale_bundled_models(models_root):
        log(f"pruned stale bundled model {name} ({freed / 1024 / 1024:.1f} MB)")
    manager = ModelManager(models_root)
    for model_id in BUNDLED_MODEL_IDS:
        manager.download(model_id)
    missing = missing_bundled_model_ids(models_root)
    if missing:
        raise SystemExit(
            "Bundled models are incomplete; refusing to package: "
            + ", ".join(missing)
            + f". Looked under {models_root}."
        )
