"""读取随应用发布的后端运行参数。"""

import json
import logging
import math
import os
import tempfile
from pathlib import Path
from uuid import uuid4


DEFAULT_SETTINGS = json.loads(Path(__file__).with_name("settings.json").read_text(encoding="utf-8"))
SETTINGS = json.loads(json.dumps(DEFAULT_SETTINGS))
SPEAKER_EMBEDDING_MODEL_ID = "eres2net-base-3dspeaker-zh"
# 随安装包出厂的基础模型（VAD、说话人分割、声纹嵌入）；整句识别模型由首次启动
# 引导按语言下载。这里的 id 必须存在于 models.json，否则打包会在下载步骤直接失败
# （test_bundled_models_exist_in_the_catalog 守住这一点）。
BUNDLED_MODEL_IDS = (
    "silero-vad",
    "pyannote-segmentation-3.0",
    SPEAKER_EMBEDDING_MODEL_ID,
)


# Both VAD engines consume 512-sample windows at 16 kHz. A live cut must
# leave room for overlap, a complete minimum utterance and window rounding.
VAD_WINDOW_SECONDS = 512 / 16000
CUT_OVERLAP_MS = 400


def minimum_speech_cap(params, overlap_ms=CUT_OVERLAP_MS):
    return max(
        1.0,
        math.ceil(
            (params["min_speech_duration"] + overlap_ms / 1000 + 2 * VAD_WINDOW_SECONDS)
            / VAD_WINDOW_SECONDS
        )
        * VAD_WINDOW_SECONDS,
    )


def live_speech_cap(params, model_limit, overlap_ms=CUT_OVERLAP_MS):
    configured = (
        SETTINGS["live_asr"]["max_speech_seconds"]
        or DEFAULT_SETTINGS["live_asr"]["max_speech_seconds"]
    )
    maximum = min(params["max_speech_duration"], model_limit, configured)
    if maximum < minimum_speech_cap(params, overlap_ms):
        raise ValueError("Speech cap must accommodate minimum speech duration and overlap")
    return maximum


def validate_speech_settings(value, *, migrate=False):
    """Validate related settings together; migrate only unsafe legacy caps."""
    for language, params in value["vad"].items():
        minimum = minimum_speech_cap(params)
        if params["max_speech_duration"] < minimum:
            if not migrate:
                raise ValueError(f"vad.{language}.max_speech_duration must be >= {minimum:g}")
            params["max_speech_duration"] = max(
                minimum, DEFAULT_SETTINGS["vad"][language]["max_speech_duration"]
            )
            logging.getLogger(__name__).warning("Migrated unsafe VAD cap for %s", language)
    minimum = max(minimum_speech_cap(params) for params in value["vad"].values())
    cap = (
        value["live_asr"]["max_speech_seconds"]
        or DEFAULT_SETTINGS["live_asr"]["max_speech_seconds"]
    )
    if cap < minimum:
        if not migrate:
            raise ValueError(f"live_asr.max_speech_seconds must be 0 (default) or >= {minimum:g}")
        value["live_asr"]["max_speech_seconds"] = max(
            minimum, DEFAULT_SETTINGS["live_asr"]["max_speech_seconds"]
        )
        logging.getLogger(__name__).warning("Migrated unsafe live speech cap")


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


def _prune_to_template(value, template):
    """递归丢弃模板里已不存在的键。

    用户覆盖文件会深合并进默认模板；模板中下架过的键若留在值里，末端的键集校验会
    失败并让 worker 无法启动。这里统一以模板为准，删掉任何多余的键，因此以后从
    settings.json 移除配置项不需要再维护一份「已下架键」清单。
    """
    for key in list(value):
        if key not in template:
            value.pop(key)
        elif isinstance(value[key], dict) and isinstance(template[key], dict):
            _prune_to_template(value[key], template[key])
    return value


def runtime_settings(root):
    """加载用户本地覆盖项，保留模块共享的 SETTINGS 引用。"""
    path = Path(root) / "advanced-settings.json"
    value = json.loads(json.dumps(DEFAULT_SETTINGS))
    if path.is_file():
        try:
            override = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(override, dict):
                raise ValueError("Advanced settings must be an object")
            _deep_update(value, override)
            _prune_to_template(value, DEFAULT_SETTINGS)
            _validate(value, DEFAULT_SETTINGS)
            validate_speech_settings(value, migrate=True)
        except (OSError, ValueError, TypeError, UnicodeError) as error:
            backup = path.with_name(f"{path.name}.corrupt-{uuid4().hex}")
            try:
                path.rename(backup)
            except OSError:
                logging.getLogger(__name__).exception(
                    "Could not preserve invalid advanced settings %s", path
                )
            logging.getLogger(__name__).warning(
                "Invalid advanced settings; using defaults: %s", error
            )
            value = json.loads(json.dumps(DEFAULT_SETTINGS))
    _prune_to_template(value, DEFAULT_SETTINGS)
    _validate(value, DEFAULT_SETTINGS)
    SETTINGS.clear()
    SETTINGS.update(value)
    return value


def save_runtime_settings(root, value):
    """保存用户本地覆盖配置到 advanced-settings.json。"""
    value = _prune_to_template(json.loads(json.dumps(value)), DEFAULT_SETTINGS)
    _validate(value, DEFAULT_SETTINGS)
    validate_speech_settings(value)
    path = Path(root) / "advanced-settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}-", delete=False
        ) as output:
            temporary = Path(output.name)
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    SETTINGS.clear()
    SETTINGS.update(value)
    return value


def _types_compatible(current, default):
    """配置项类型是否可接受。

    JSON 往返只丢整数浮点的 ``.0``：JS 只有一个 number 类型，``22.0`` 经
    ``JSON.stringify`` 变成 ``22``。若严格比对 Python 类型，「进阶设置」里只要有一个
    整数值的浮点默认项（如 ``live_asr.max_speech_seconds = 22.0``），保存就会永远报
    ``Invalid setting``。因此浮点默认项接受整数；整数默认项仍拒绝小数（那才是真错误），
    bool 始终不算数值。
    """
    if isinstance(current, bool):
        return isinstance(default, bool)
    if isinstance(default, float) and isinstance(current, int):
        return True
    return type(current) is type(default)


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
        elif not _types_compatible(current, default):
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
                    "max_speech_duration",
                    "refined_window_seconds",
                    "boundary_tail_seconds",
                    "microphone_max_gain",
                    "max_samples",
                    "max_total_seconds",
                    "timeout_seconds",
                    "diarization_timeout_seconds",
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
                    "minimum_embedding_seconds",
                    "min_duration_on",
                    "min_duration_off",
                    "min_silence_duration",
                    "min_speech_duration",
                    "deleted_retention_days",
                    "diarization_overlap_ms",
                    "mix_max_delay_ms",
                    "max_speech_seconds",
                    "min_auto_speaker_duration_ms",
                    "auto_cluster_score_tolerance",
                }
                and current < 0
            ):
                raise ValueError(f"Invalid setting: {key}")
