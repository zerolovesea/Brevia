"""读取随应用发布的后端运行参数。"""

import json
from pathlib import Path


DEFAULT_SETTINGS = json.loads(Path(__file__).with_name("settings.json").read_text(encoding="utf-8"))
SETTINGS = json.loads(json.dumps(DEFAULT_SETTINGS))


def runtime_settings(root):
    """加载用户本地覆盖项，保留模块共享的 SETTINGS 引用。"""
    path = Path(root) / "advanced-settings.json"
    value = json.loads(json.dumps(DEFAULT_SETTINGS))
    if path.is_file():
        value = json.loads(path.read_text(encoding="utf-8"))
    _validate(value, DEFAULT_SETTINGS)
    SETTINGS.clear()
    SETTINGS.update(value)
    return value


def save_runtime_settings(root, value):
    _validate(value, DEFAULT_SETTINGS)
    path = Path(root) / "advanced-settings.json"
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    SETTINGS.clear()
    SETTINGS.update(value)
    return value


def _validate(value, template):
    if not isinstance(value, dict) or set(value) != set(template):
        raise ValueError("Advanced settings must match the default template")
    for key, default in template.items():
        current = value[key]
        if isinstance(default, dict):
            _validate(current, default)
        elif isinstance(default, bool):
            if not isinstance(current, bool): raise ValueError(f"Invalid setting: {key}")
        elif type(current) is not type(default):
            raise ValueError(f"Invalid setting: {key}")
