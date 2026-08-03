"""读取随应用发布的后端运行参数。"""

import json
import math
from pathlib import Path


DEFAULT_SETTINGS = json.loads(
    Path(__file__).with_name("settings.json").read_text(encoding="utf-8")
)
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
            if not isinstance(current, bool):
                raise ValueError(f"Invalid setting: {key}")
        elif type(current) is not type(default):
            raise ValueError(f"Invalid setting: {key}")
        elif isinstance(current, (int, float)):
            if not math.isfinite(current):
                raise ValueError(f"Invalid setting: {key}")
            if key == "num_speakers" and current != -1 and not 1 <= current <= 20:
                raise ValueError("num_speakers must be -1 or between 1 and 20")
            if key == "cluster_threshold" and not 0 <= current <= 2:
                raise ValueError(f"Invalid setting: {key}")
            if (
                key
                in {
                    "online_similarity_threshold",
                    "microphone_target_rms",
                    "microphone_minimum_rms",
                    "microphone_peak",
                }
                and not 0 <= current <= 1
            ):
                raise ValueError(f"Invalid setting: {key}")
            if (
                key
                in {
                    "sample_rate",
                    "chunk_seconds",
                    "maximum_utterance_seconds",
                    "refined_window_seconds",
                    "microphone_max_gain",
                    "max_samples",
                    "max_total_seconds",
                    "timeout_seconds",
                }
                and current <= 0
            ):
                raise ValueError(f"Invalid setting: {key}")
            if (
                key
                in {
                    "endpoint_rule1_silence",
                    "endpoint_rule2_silence",
                    "minimum_embedding_seconds",
                    "min_duration_on",
                    "min_duration_off",
                    "deleted_retention_days",
                }
                and current < 0
            ):
                raise ValueError(f"Invalid setting: {key}")
