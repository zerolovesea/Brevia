"""读取随应用发布的后端运行参数。"""

import json
import math
from pathlib import Path


DEFAULT_SETTINGS = json.loads(
    Path(__file__).with_name("settings.json").read_text(encoding="utf-8")
)
SETTINGS = json.loads(json.dumps(DEFAULT_SETTINGS))
SPEAKER_EMBEDDING_MODEL_ID = "eres2net-base-3dspeaker-zh"


def validate_num_speakers(value):
    """接受自动模式 ``-1`` 或受资源上限保护的固定人数。"""
    if isinstance(value, bool):
        raise ValueError("num_speakers must be an integer")
    try:
        integer = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("num_speakers must be an integer") from error
    if integer != value:
        raise ValueError("num_speakers must be an integer")
    value = integer
    if value != -1 and value < 1:
        raise ValueError("num_speakers must be -1 or a positive integer")
    return value


def _deep_update(base, override):
    """把用户覆盖项深合并进默认模板，使新增的默认键回落到默认值。"""
    for key, item in override.items():
        if isinstance(item, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], item)
        else:
            base[key] = item
    return base


def runtime_settings(root):
    """加载用户本地覆盖项，保留模块共享的 SETTINGS 引用。"""
    path = Path(root) / "advanced-settings.json"
    value = json.loads(json.dumps(DEFAULT_SETTINGS))
    if path.is_file():
        _deep_update(value, json.loads(path.read_text(encoding="utf-8")))
    value.get("diarization", {}).pop("embedding_model_id", None)
    _validate(value, DEFAULT_SETTINGS)
    SETTINGS.clear()
    SETTINGS.update(value)
    return value


def save_runtime_settings(root, value):
    """保存用户本地覆盖配置到 advanced-settings.json。"""
    value = json.loads(json.dumps(value))
    value.get("diarization", {}).pop("embedding_model_id", None)
    _validate(value, DEFAULT_SETTINGS)
    path = Path(root) / "advanced-settings.json"
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    SETTINGS.clear()
    SETTINGS.update(value)
    return value


def _validate(value, template):
    """递归验证配置项类型、值域和结构完整性。"""
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
            if key == "num_speakers":
                validate_num_speakers(current)
            if key == "cluster_threshold" and not 0 <= current <= 2:
                raise ValueError(f"Invalid setting: {key}")
            if (
                key
                in {
                    "online_similarity_threshold",
                    "voiceprint_similarity_threshold",
                    "microphone_target_rms",
                    "microphone_minimum_rms",
                    "microphone_peak",
                    "denoiser_enabled",
                    "denoise_minimum_rms",
                    "threshold",
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
                    "live_pin_seconds",
                    "live_pin_max_seconds",
                    "refined_window_seconds",
                    "boundary_tail_seconds",
                    "microphone_max_gain",
                    "max_samples",
                    "max_total_seconds",
                    "timeout_seconds",
                    "max_refine_seconds",
                    "diarization_chunk_ms",
                    "embedding_window_ms",
                    "max_auto_speakers",
                    "min_auto_speaker_windows",
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
                    "min_silence_duration",
                    "min_speech_duration",
                    "max_speech_duration",
                    "deleted_retention_days",
                    "diarization_overlap_ms",
                    "min_auto_speaker_duration_ms",
                    "auto_cluster_score_tolerance",
                }
                and current < 0
            ):
                raise ValueError(f"Invalid setting: {key}")
