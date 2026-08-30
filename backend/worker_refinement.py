"""聚焦的 worker 职责组件。"""

import os
import re
import sys
from difflib import SequenceMatcher

from .asr import (
    ModelManager,
    OfflineVAD,
    OfflineDiarizer,
    RefinedASR,
    SpeakerTracker,
)
from .audio_io import (
    ensure_wav_duration,
    read_mono_wav,
    read_mono_wav_window,
)
from .config import SETTINGS, SPEAKER_EMBEDDING_MODEL_ID, validate_num_speakers
from .worker_common import TaskCancelled, managed_task, require

# 该值在 diarization 子进程内使用；子进程不加载用户覆盖，故经 payload 传入，
# 这里仅作缺失时的回退默认值。较长窗口让声纹更稳定，避免把同一个人聚成多人。
EMBEDDING_WINDOW_MS = 15_000

_CN_NUM = {
    "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
}
_CN_UNIT = {"十": 10, "百": 100, "千": 1000}
_CN_BIG_UNIT = {"万": 10000, "亿": 100000000}
# 仅在这些「计量单位」前把中文数字转阿拉伯，避免把成语/惯用短语里的数字误转。
# 不含「个」：量词「一个/一种/一下」不应被转成阿拉伯数字（如「5元1个」）。
_NUM_SUFFIX = "岁年月日号元块角毛"


def _cn_int_value(text):
    """把中文数字串（不含小数）转为整数；无法/不宜转换返回 ``None``。

    仅由大单位占位（如「亿」「万」）的片段不单独转换：这类片段常跟在阿拉伯数字后
    （``16.99亿``），若强行转会把大单位误成 0，导致「亿元→0元」。
    「十/百/千」可单独成数（``百分之十``→``10%``），不在此列。
    """
    if not text or not any(ch in _CN_NUM or ch in _CN_UNIT for ch in text):
        return None
    if all(ch in _CN_NUM for ch in text):
        # 纯数字串（如“二零二五”）按位拼接为阿拉伯数字，而非逐字覆盖。
        return int("".join(str(_CN_NUM[ch]) for ch in text))
    total = section = number = 0
    for ch in text:
        if ch in _CN_NUM:
            number = _CN_NUM[ch]
        elif ch in _CN_UNIT:
            section += (number if number else 1) * _CN_UNIT[ch]
            number = 0
        elif ch in _CN_BIG_UNIT:
            section = (section + number) * _CN_BIG_UNIT[ch]
            total += section
            section = number = 0
        else:
            return None
    return total + section + number


def _cn_to_display(text):
    """把中文数字串转为阿拉伯展示串；末尾带「万/亿」时保留单位而不展开全零。

    返回展示串；无法/不宜转换返回 ``None``（此时调用方保留原文）。例如：
    ``三亿元`` → ``3亿元``；``十六点九九亿元`` → ``16.99亿元``；``16.99亿元``
    保持不变（不误转成 ``0元``）。
    """
    if not text:
        return None
    unit = text[-1] if text[-1] in _CN_BIG_UNIT else None
    body = text[:-1] if unit else text
    if unit and any(ch in _CN_BIG_UNIT for ch in body):
        # 嵌套大单位（如「三亿五千万」）解析不可靠，保留原文避免产生错误数字。
        return None
    if "点" in body:
        whole, frac = body.split("点", 1)
        wval = _cn_int_value(whole) if whole else 0
        if wval is None:
            return None
        fraction = 0.0
        if frac:
            for ch in frac:
                if ch not in _CN_NUM:
                    return None
                fraction = fraction * 10 + _CN_NUM[ch]
            fraction /= 10 ** len(frac)
        number = wval + fraction
    else:
        wval = _cn_int_value(body)
        if wval is None:
            return None
        number = float(wval)
    if unit:
        return f"{number:g}{unit}"
    return f"{number:g}"


def _normalize_numbers(text):
    """把「中文数字 + 计量单位」中的数字转成阿拉伯数字，惯用短语原样保留。

    - 大单位（万/亿）保留单位字符，不展开成满屏零：``三亿元`` → ``3亿元``。
    - 跟在阿拉伯数字后的大单位（``16.99亿元``）保持不变，不再被误转成 ``0元``。
    - ``百分之X`` 统一转成 ``X%``，与模型偶发的阿拉伯百分比输出保持一致。
    """
    pattern = re.compile(r"([零〇一二两三四五六七八九十百千万亿点]+)([" + _NUM_SUFFIX + r"])")
    text = pattern.sub(
        lambda match: (
            f"{_cn_to_display(match.group(1))}{match.group(2)}"
            if _cn_to_display(match.group(1)) is not None
            else match.group(0)
        ),
        text,
    )
    # 约数大单位：三千四百多亿元 -> 3400多亿元；三千多万 -> 3000多万
    text = re.sub(
        r"([零〇一二两三四五六七八九十百千]+)([多余来])([万亿])([" + _NUM_SUFFIX + r"])?",
        lambda match: (
            f"{_cn_to_display(match.group(1)) or match.group(1)}"
            f"{match.group(2)}{match.group(3)}{match.group(4) or ''}"
        ),
        text,
    )
    # 百分比必须先于独立小数处理，避免「百分之五点三六」的「五点三六」被小数规则抢先。
    text = re.sub(
        r"百分之([零〇一二两三四五六七八九十百千万亿点]+)",
        lambda match: f"{_cn_to_display(match.group(1)) or match.group(1)}%",
        text,
    )
    # 独立小数：五百二十九点四四 -> 529.44（中文小数是明确的数字，不会误伤成语）
    text = re.sub(
        r"([零〇一二两三四五六七八九十百千万亿]+点[零〇一二三四五六七八九]+)",
        lambda match: f"{_cn_to_display(match.group(1)) or match.group(1)}",
        text,
    )
    return text


def _refinement(key):
    """读取可被 advanced-settings 覆盖的精修/聚类参数。"""
    return SETTINGS["refinement"][key]


def _diarization_chunk_ms():
    """Windows 减少昂贵的 spawn + 模型加载次数。"""
    chunk_ms = _refinement("diarization_chunk_ms")
    return max(chunk_ms, 60_000) if sys.platform == "win32" else chunk_ms


def _diarize_chunk_process(connection, payload):
    """在短生命进程内完成分段和声纹，让 OS 回收 Sherpa 原生缓冲。"""
    try:
        manager = ModelManager(
            payload["models_root"], bundled_root=payload.get("bundled_models_root")
        )
        samples, sample_rate = read_mono_wav_window(
            payload["path"], payload["window_start_ms"], payload["window_end_ms"]
        )
        cursor = 0
        for speech in payload["speech"]:
            start = max(
                cursor,
                round(
                    (speech["start_ms"] - payload["window_start_ms"])
                    * sample_rate
                    / 1000
                ),
            )
            end = min(
                len(samples),
                round(
                    (speech["end_ms"] - payload["window_start_ms"])
                    * sample_rate
                    / 1000
                ),
            )
            samples[cursor:start] = 0
            cursor = max(cursor, end)
        samples[cursor:] = 0
        # 会后离线精修独占 CPU：用满 device() 线程数，而非实时路径的 2 线程预算。
        diarization_threads = manager.device()["threads"]
        tracker = SpeakerTracker(manager, threads=diarization_threads)
        turns = []
        if payload.get("vad_fallback"):
            diarized = [
                {
                    "start_ms": max(
                        payload["window_start_ms"], speech["start_ms"]
                    )
                    - payload["window_start_ms"],
                    "end_ms": min(payload["window_end_ms"], speech["end_ms"])
                    - payload["window_start_ms"],
                    "speaker": "spk-1",
                }
                for speech in payload["speech"]
            ]
        else:
            diarizer = OfflineDiarizer(
                manager,
                -1,
                payload["threshold"],
                payload["segmentation_id"],
                threads=diarization_threads,
            )
            diarized = diarizer.process(samples, sample_rate)
        for turn in diarized:
            start_ms = max(
                payload["core_start_ms"],
                payload["window_start_ms"] + turn["start_ms"],
            )
            end_ms = min(
                payload["core_end_ms"],
                payload["window_start_ms"] + turn["end_ms"],
            )
            embedding_window_ms = payload.get("embedding_window_ms", EMBEDDING_WINDOW_MS)
            for part_start in range(start_ms, end_ms, embedding_window_ms):
                part_end = min(part_start + embedding_window_ms, end_ms)
                local_start = round(
                    (part_start - payload["window_start_ms"]) * sample_rate / 1000
                )
                local_end = round(
                    (part_end - payload["window_start_ms"]) * sample_rate / 1000
                )
                embedding = tracker.embedding(samples[local_start:local_end], sample_rate)
                turns.append(
                    {
                        "start_ms": part_start,
                        "end_ms": part_end,
                        "speaker": turn["speaker"],
                        "_embedding": embedding.tolist()
                        if embedding is not None
                        else None,
                    }
                )
        connection.send((True, turns))
    except BaseException as error:
        connection.send((False, f"{type(error).__name__}: {error}"))
    finally:
        connection.close()


class RefinementWorkerMixin:
    def recover_refinement(self, payload):
        """将异常退出的精修恢复为可重试状态。"""
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] == "refining":
            meeting = self.store.set_status(meeting["id"], "ready")
        return meeting

    @managed_task("meeting.refine")
    def refine(self, payload, control=None):
        """对停止后的会议执行会后转写和说话人聚类。

        Args:
            payload: 会议 ID；可选已知说话人数和聚类阈值。

        Returns:
            状态更新为 ``refined`` 的会议详情。

        Notes:
            麦克风与系统音频始终独立执行 VAD/识别，再按时间戳合并。麦克风
            直接归属本地用户；系统音频才执行远端说话人分离与 Enrollment 匹配。
        """
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        if meeting["status"] == "recording":
            raise ValueError("Stop the meeting before refinement")
        refined_model_id = payload.get(
            "refined_model_id", meeting["refined_model_id"]
        )
        if refined_model_id != meeting["refined_model_id"]:
            self.models.get(refined_model_id)
            meeting = self.store.update_meeting(
                meeting["id"], {"refined_model_id": refined_model_id}
            )
        num_speakers = int(
            payload.get(
                "num_speakers",
                meeting.get("num_speakers", SETTINGS["diarization"]["num_speakers"]),
            )
        )
        threshold = float(
            payload.get(
                "cluster_threshold", SETTINGS["diarization"]["cluster_threshold"]
            )
        )
        validate_num_speakers(num_speakers)
        if not 0 <= threshold <= 2:
            raise ValueError("cluster_threshold must be between 0 and 2")
        tracks = [
            track
            for track in ("mic", "system")
            if meeting["audio"]["playback"].get(track)
        ]
        if not tracks:
            raise ValueError("The meeting has no audio to refine")
        manifest = self.store.read_manifest(meeting["id"])
        is_imported_audio = manifest.get("source") == "audio_import" or (
            not manifest.get("tracks") and set(tracks) == {"mic"}
        )
        # 系统音频（远端）与导入的麦克风必须聚类；实时麦克风只要声纹模型就绪也
        # 一起聚类，让本机说话人同样接受声纹库匹配，而不再一律标成 local-user。
        required_diarized = (
            {"system"} | ({"mic"} if is_imported_audio else set())
        ) & set(tracks)
        required_models = [
            refined_model_id,
            meeting.get("vad_model_id") or "silero-vad",
        ]
        if required_diarized:
            required_models.extend(
                [
                    meeting.get("speaker_segmentation_model_id"),
                    SPEAKER_EMBEDDING_MODEL_ID,
                ]
            )
        missing_models = [
            model_id
            for model_id in required_models
            if model_id and not self.models.is_ready(model_id)
        ]
        if missing_models:
            label = "Model" if len(missing_models) == 1 else "Models"
            verb = "is" if len(missing_models) == 1 else "are"
            raise RuntimeError(
                f"{label} {', '.join(missing_models)} {verb} not installed"
            )
        segmentation_id = (
            meeting.get("speaker_segmentation_model_id")
            or SETTINGS["diarization"]["segmentation_model_id"]
        )
        embedding_id = SPEAKER_EMBEDDING_MODEL_ID
        speaker_models_ready = self.models.is_ready(
            segmentation_id
        ) and self.models.is_ready(embedding_id)
        diarized_tracks = set(required_diarized)
        if speaker_models_ready:
            diarized_tracks |= set(tracks)
        # 多个轨道同时聚类时，未命中声纹库的 spk-N 需按轨道命名，避免麦克风与系统
        # 音频各自的 spk-1 在按时间戳合并后串成同一个人。
        namespace_tracks = len(diarized_tracks) > 1
        self.emit(
            "refinement.started",
            {"meeting_id": meeting["id"], "total": 0, "stage": "准备精修"},
        )

        def cancel_refinement():
            self.store.set_status(meeting["id"], "ready")
            self.emit("refinement.cancelled", {"meeting_id": meeting["id"]})
            return self.store.get_meeting(meeting["id"])

        sources, turns_by_track, raw_turns_by_track = {}, {}, {}
        def prepare(track):
            return self._prepare_track(
                track,
                meeting,
                control,
                diarized_tracks,
                namespace_tracks,
                num_speakers,
                threshold,
            )

        # 每条轨道会使用 ModelManager.device() 规定的线程数；只有 CPU 预算足够
        # 时才并行，避免双轨在低核设备上互相争抢而让准备阶段更慢。
        try:
            device = self.models.device()
            workers = (
                min(
                    len(tracks),
                    (os.cpu_count() or 1) // max(1, device["threads"]),
                )
                if device["backend"] == "cpu"
                else 1
            )
            if workers > 1:
                from concurrent.futures import ThreadPoolExecutor

                with ThreadPoolExecutor(max_workers=workers) as pool:
                    prepared = list(pool.map(prepare, tracks))
            else:
                prepared = [prepare(track) for track in tracks]
        except TaskCancelled:
            return cancel_refinement()
        try:
            self.wait_task(control)
        except TaskCancelled:
            return cancel_refinement()
        for track, source, raw_turns, stable_turns in prepared:
            sources[track] = source
            raw_turns_by_track[track] = raw_turns
            turns_by_track[track] = stable_turns
        turns = sorted(
            (turn for track_turns in turns_by_track.values() for turn in track_turns),
            key=lambda turn: (turn["start_ms"], turn["end_ms"]),
        )
        try:
            self.wait_task(control)
        except TaskCancelled:
            return cancel_refinement()
        self.emit(
            "refinement.progress",
            {"meeting_id": meeting["id"], "completed": 0, "total": 0, "stage": "分析说话人"},
        )
        recognizer = RefinedASR(
            self.models,
            refined_model_id,
            language=meeting.get("language"),
            threads=self.models.device()["threads"],
        )
        locked_ids = {
            speaker["id"] for speaker in meeting["speakers"] if speaker["locked"]
        }
        locked_segments = [
            segment
            for segment in meeting["segments"]
            if segment["user_edited"] or segment["speaker"] in locked_ids
        ]
        window_size = SETTINGS["asr"]["refined_window_seconds"] * 1000
        windows_by_track = {
            track: self._refinement_turns(
                turns_by_track[track],
                sources[track]["duration_ms"],
                window_size,
            )
            for track in tracks
        }
        total = sum(map(len, windows_by_track.values()))
        completed = 0
        previous_text = {}
        refined_segments = []
        refined_segment_ids = set()
        context_ms = 800
        self.store.set_status(meeting["id"], "refining")
        self.emit(
            "refinement.progress",
            {"meeting_id": meeting["id"], "completed": 0, "total": total, "stage": "转写中 · 校正说话人"},
        )
        try:
            for track in tracks:
                source = sources[track]
                sample_rate = source["sample_rate"]
                duration_ms = source["duration_ms"]
                windows = windows_by_track[track]
                for index, turn in enumerate(windows):
                    self.wait_task(control)
                    start_ms, end_ms = turn["start_ms"], turn["end_ms"]
                    before = windows[index - 1] if index else None
                    after = windows[index + 1] if index + 1 < len(windows) else None
                    decode_start_ms, decode_end_ms = self._decode_range(
                        turn,
                        before,
                        after,
                        duration_ms,
                        context_ms,
                    )
                    current, _ = read_mono_wav_window(
                        source["path"], decode_start_ms, decode_end_ms
                    )
                    raw_text, words = recognizer.decode_words(current, sample_rate)
                    # 音频窗口只提供识别上下文；重复在 ASR 返回的字幕文本层裁切。
                    raw_text = re.split(r"<\|endoftext\|>", str(raw_text or ""), flags=re.IGNORECASE)[0]
                    raw_text = re.sub(r"<\|[^|>]+\|>", " ", raw_text).strip()
                    raw_text = self._trim_refinement_repeats(raw_text)
                    speaker_key = (track, turn["speaker"])
                    text, continued = self._trim_refinement_overlap_detailed(
                        previous_text.get(speaker_key, ""), raw_text
                    )
                    # 精修是离线完整音频，不会有流式空转重复；统一把中文数字转成阿拉伯，
                    # 与实时字幕保持一致的「亿/万保留单位、百分比归一」规则。
                    text = _normalize_numbers(text)
                    previous_text[speaker_key] = raw_text
                    completed += 1
                    self.emit(
                        "refinement.progress",
                        {
                            "meeting_id": meeting["id"],
                            "completed": completed,
                            "total": total,
                            "stage": "转写中 · 校正说话人",
                        },
                    )
                    if not text:
                        continue
                    speaker = (
                        self._speaker_for(
                            start_ms,
                            end_ms,
                            [
                                segment
                                for segment in locked_segments
                                if segment["track"] == track
                            ],
                        )
                        or turn["speaker"]
                        or ("local-user" if track == "mic" else "spk-1")
                    )
                    segment_id = self._refinement_segment_id(
                        track, start_ms, index, refined_segment_ids
                    )
                    event = {
                        "meeting_id": meeting["id"],
                        "segment_id": segment_id,
                        "version": "postprocess",
                        "text": text,
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                        "speaker": speaker,
                        "track": track,
                        "continues_previous": continued,
                        "word_timestamps": [
                            {
                                **word,
                                "start_ms": word["start_ms"] + decode_start_ms,
                                "end_ms": word["end_ms"] + decode_start_ms,
                                "speaker": self._speaker_for(
                                    word["start_ms"] + decode_start_ms,
                                    word["end_ms"] + decode_start_ms,
                                    turns_by_track[track],
                                ) or speaker,
                            }
                            for word in words
                        ],
                    }
                    for word in event["word_timestamps"]:
                        word["overlap_speakers"] = self._overlap_speakers(
                            word["start_ms"], word["end_ms"], turns_by_track[track]
                        )
                        word["overlap"] = len(word["overlap_speakers"]) > 1
                    refined_segments.append(event)
            self.emit(
                "refinement.progress",
                {"meeting_id": meeting["id"], "completed": total, "total": total, "stage": "校正说话人"},
            )
            self.emit(
                "refinement.progress",
                {"meeting_id": meeting["id"], "completed": total, "total": total, "stage": "整理结果"},
            )
            self.wait_task(control)
        except TaskCancelled:
            return cancel_refinement()
        except Exception:
            self.store.set_status(meeting["id"], "ready")
            raise
        try:
            self.wait_task(control)
        except TaskCancelled:
            return cancel_refinement()
        refined_segments.sort(
            key=lambda item: (item["track"], item["start_ms"], item["end_ms"])
        )
        refined_segments = self._assemble_utterances(refined_segments)
        version, revision = self.store.next_refinement_version(meeting["id"])
        refined_segments = self.store.replace_segments(
            meeting["id"], refined_segments, version, revision
        )
        self.store.replace_speaker_turns(meeting["id"], turns)
        self.store.set_status(meeting["id"], "refined")
        result = {"meeting_id": meeting["id"], "status": "refined"}
        self.emit("refinement.ready", result)
        return result

    @staticmethod
    def _vad_params_for(language):
        """返回按会议语言选择的 VAD 参数；未配置的语言回落到 default。

        中文没有英文那样靠停顿切词的边界，Silero 的默认阈值会把连续语音
        切成碎片，因此用更低的阈值、更长的静默判定和更长的单段上限合并
        整句话，避免会后精修把一个人拆成好几段。
        """
        vad = SETTINGS.get("vad") or {}
        return vad.get(language) or vad.get("default") or {}

    def _prepare_track(
        self,
        track,
        meeting,
        control,
        diarized_tracks,
        namespace_tracks,
        num_speakers,
        threshold,
    ):
        """对单条轨道执行 VAD/聚类/声纹提取，返回稳定化前后的说话人时间段。

        每次调用创建独立的 VAD/Diarizer/SpeakerTracker 实例，因此可安全地在
        线程池中并行运行多条轨道；共享的 ``self.store``/``self.emit`` 均已在各自
        实现里加锁。返回 ``(track, source, raw_turns, stable_turns)``。
        """
        self.wait_task(control)
        path = meeting["audio"]["playback"][track]
        self.emit(
            "refinement.progress",
            {"meeting_id": meeting["id"], "completed": 0, "total": 0, "stage": "准备精修"},
        )
        ensure_wav_duration(path, _refinement("max_refine_seconds"), "refine")
        samples, sample_rate = read_mono_wav(path)
        duration_ms = len(samples) * 1000 // sample_rate
        vad_params = self._vad_params_for(meeting.get("language"))
        if track not in diarized_tracks:
            vad = OfflineVAD(
                self.models,
                meeting.get("vad_model_id") or "silero-vad",
                vad_params=vad_params,
            )
            speech = vad.process(samples, sample_rate)
            turns = [{**turn, "speaker": "local-user"} for turn in speech]
        else:
            vad = OfflineVAD(
                self.models,
                meeting.get("vad_model_id") or "silero-vad",
                vad_params=vad_params,
            )
            speech = vad.process(samples, sample_rate)

            self.emit(
                "refinement.progress",
                {"meeting_id": meeting["id"], "completed": 0, "total": 0, "stage": "分析说话人"},
            )
            if duration_ms > _refinement("diarization_chunk_ms"):
                turns = self._diarize_long_track(
                    path,
                    duration_ms,
                    speech,
                    meeting.get("speaker_segmentation_model_id")
                    or SETTINGS["diarization"]["segmentation_model_id"],
                    threshold,
                    control,
                )
            else:
                # 短音频直接处理；长音频由短生命子进程回收 Sherpa 原生内存。
                cursor = 0
                for turn in speech:
                    start = round(turn["start_ms"] * sample_rate / 1000)
                    end = round(turn["end_ms"] * sample_rate / 1000)
                    try:
                        samples[cursor:start] = 0
                    except TypeError:
                        samples[cursor:start] = [0] * (start - cursor)
                    cursor = end
                try:
                    samples[cursor:] = 0
                except TypeError:
                    samples[cursor:] = [0] * (len(samples) - cursor)
                diarizer = OfflineDiarizer(
                    self.models,
                    -1,
                    threshold,
                    meeting.get("speaker_segmentation_model_id"),
                    threads=self.models.device()["threads"],
                )
                turns = (
                    [dict(turn) for turn in diarizer.process(samples, sample_rate)]
                    if speech
                    else []
                )

            if speech and not turns:
                # diarizer 失败时 fallback 到单说话人
                turns = [{**turn, "speaker": "spk-1"} for turn in speech]
            if duration_ms <= _refinement("diarization_chunk_ms") and turns:
                try:
                    tracker = SpeakerTracker(
                        self.models, threads=self.models.device()["threads"]
                    )
                except RuntimeError:
                    tracker = None
                turns = self._split_long_turns(turns, _refinement("embedding_window_ms"))
                for turn in turns:
                    start = round(turn["start_ms"] * sample_rate / 1000)
                    end = round(turn["end_ms"] * sample_rate / 1000)
                    embedding = (
                        tracker.embedding(samples[start:end], sample_rate)
                        if tracker
                        else None
                    )
                    turn["_embedding"] = (
                        embedding.tolist()
                        if hasattr(embedding, "tolist")
                        else embedding
                    )
            turns = self._cluster_speaker_turns(
                meeting, turns, sample_rate, num_speakers
            )
        if namespace_tracks:
            # 命中声纹库的 turn 已是全局 profile-{id}，跨轨道自然合并同一人；
            # 仅给未命中的 spk-N 加轨道前缀，避免不同轨道的 spk-1 混为一人。
            for turn in turns:
                if str(turn.get("speaker", "")).startswith("spk-"):
                    turn["speaker"] = f"{track}-{turn['speaker']}"
        source = {
            "path": path,
            "sample_rate": sample_rate,
            "duration_ms": duration_ms,
        }
        stable_turns = self._stabilize_speaker_turns(turns)
        stable_turns = self._deoverlap_speaker_turns(stable_turns)
        # 精修识别阶段改为逐窗从磁盘读取，这里立即释放整段波形。
        del samples
        return track, source, turns, stable_turns

    def _diarize_long_track(
        self, path, duration_ms, speech, segmentation_id, threshold, control
    ):
        """分块隔离 Sherpa 原生推理，防止长音频缓冲在 worker 内累积。"""
        import multiprocessing

        context = multiprocessing.get_context("spawn")
        turns = []
        native_broken = False  # 首次原生崩溃后整轨熔断（升级 Sherpa 后可删除）
        chunk_ms = _diarization_chunk_ms()
        for core_start in range(0, duration_ms, chunk_ms):
            self.wait_task(control)
            core_end = min(duration_ms, core_start + chunk_ms)
            window_start = max(0, core_start - _refinement("diarization_overlap_ms"))
            window_end = min(duration_ms, core_end + _refinement("diarization_overlap_ms"))
            window_speech = [
                turn
                for turn in speech
                if turn["end_ms"] > window_start
                and turn["start_ms"] < window_end
            ]
            if not window_speech:
                continue
            payload = {
                "path": str(path),
                "models_root": str(self.models.root),
                "bundled_models_root": str(self.models.bundled_root)
                if self.models.bundled_root
                else None,
                "segmentation_id": segmentation_id,
                "threshold": threshold,
                "embedding_window_ms": _refinement("embedding_window_ms"),
                "core_start_ms": core_start,
                "core_end_ms": core_end,
                "window_start_ms": window_start,
                "window_end_ms": window_end,
                "speech": window_speech,
            }
            result, native_crashed = self._diarize_chunk(
                context, payload, control, try_native=not native_broken
            )
            native_broken = native_broken or native_crashed
            turns.extend(result)
        return turns

    def _diarize_chunk(self, context, payload, control, try_native):
        """单个分块的降级链：原生 → VAD-only → 单说话人。

        返回 (turns, native_crashed)；native_crashed 供调用方决定是否整轨熔断。
        两种策略都失败时不抛异常，而是降级为 spk-1，保持轨道可用。
        """
        strategies = []
        if try_native:
            strategies.append(("native", {**payload, "vad_fallback": False}))
        strategies.append(("vad_only", {**payload, "vad_fallback": True}))

        native_crashed = False
        for strategy, modified_payload in strategies:
            try:
                result = self._run_diarization_process(
                    context, modified_payload, control
                )
                return result, native_crashed
            except RuntimeError as error:
                if strategy == "native":
                    native_crashed = True
                self.emit(
                    "worker.warning",
                    {
                        "code": (
                            "diarization_chunk_fallback"
                            if strategy == "native"
                            else "diarization_chunk_vad_only"
                        ),
                        "start_ms": payload["core_start_ms"],
                        "end_ms": payload["core_end_ms"],
                        "error_type": type(error).__name__,
                        "message": str(error),
                    },
                )

        core_start, core_end = payload["core_start_ms"], payload["core_end_ms"]
        return [
            {
                "start_ms": max(core_start, turn["start_ms"]),
                "end_ms": min(core_end, turn["end_ms"]),
                "speaker": "spk-1",
                "_embedding": None,
            }
            for turn in payload["speech"]
            if turn["end_ms"] > core_start and turn["start_ms"] < core_end
        ], native_crashed

    def _run_diarization_process(self, context, payload, control):
        receiver, sender = context.Pipe(duplex=False)
        process = context.Process(
            target=_diarize_chunk_process, args=(sender, payload)
        )
        process.start()
        sender.close()
        try:
            while process.is_alive() and not receiver.poll(0.1):
                self.wait_task(control)
            if not receiver.poll():
                raise RuntimeError(
                    f"Diarization subprocess exited with code {process.exitcode} "
                    f"at {payload['core_start_ms']} ms"
                )
            try:
                ok, result = receiver.recv()
            except EOFError as error:
                process.join()
                raise RuntimeError(
                    f"Diarization subprocess exited with code {process.exitcode} "
                    f"at {payload['core_start_ms']} ms"
                ) from error
            if not ok:
                raise RuntimeError(result)
            return result
        finally:
            receiver.close()
            if process.is_alive():
                process.terminate()
            process.join()

    def _cluster_speaker_turns(
        self, meeting, turns, sample_rate, num_speakers=-1
    ):
        """用子进程返回的声纹在全会议时间轴上统一聚类。"""
        known = [
            (index, turn["_embedding"])
            for index, turn in enumerate(turns)
            if turn.get("_embedding") is not None
        ]
        labels = (
            [0] * len(known)
            if len(known) < 2
            else self._auto_cluster_embeddings(
                [embedding for _, embedding in known],
                [
                    turns[index]["end_ms"] - turns[index]["start_ms"]
                    for index, _ in known
                ],
                num_speakers,
            )
        )
        assigned = {index: label for (index, _), label in zip(known, labels)}
        for index, turn in enumerate(turns):
            if index not in assigned and assigned:
                nearest = min(
                    assigned,
                    key=lambda other: max(
                        0,
                        turn["start_ms"] - turns[other]["end_ms"],
                        turns[other]["start_ms"] - turn["end_ms"],
                    ),
                )
                assigned[index] = assigned[nearest]
            if index in assigned:
                turn["speaker"] = f"spk-{assigned[index] + 1}"
        if self.store.list_speaker_profiles():
            self._match_speaker_profiles(meeting, turns)
        for turn in turns:
            turn.pop("_embedding", None)
        return turns

    @staticmethod
    def _refinement_turns(turns, duration_ms, maximum_ms):
        """按离线说话人边界拆分精修窗口，且单段不超过模型上限。"""
        return [
            {
                "start_ms": start,
                "end_ms": min(start + maximum_ms, turn["end_ms"]),
                "speaker": turn["speaker"],
            }
            for turn in turns
            for start in range(turn["start_ms"], turn["end_ms"], maximum_ms)
        ]

    @staticmethod
    def _assemble_utterances(segments):
        """把同一说话人、同一轨道上相邻的精修窗口组装成一条 utterance。

        单条 turn 会被 ``refined_window_seconds`` 切成多个解码窗口，每个窗口
        原本各生成一个段落，导致一个人的连续发言被拆成好几段。这里在解码后
        按 (track, speaker, 时间相邻) 合并，恢复连续的发言边界。

        同时合并同说话人的短间隔句子（< 1.5s），减少 LLM 类 ASR 模型的
        过度断句。合并只发生在解码后、按文本拼接，不会把静默喂给解码器。

        单段默认不超过 ``refined_window_seconds * 2``（约 30s），且超限时优先在
        最后一个句末标点处拆分（语义切点），避免从一句话中间断开；找不到句末
        标点才退回窗口边界。
        """
        if not segments:
            return []
        assembled = []
        max_merge_gap_ms = 1500
        max_segment_ms = SETTINGS["asr"]["refined_window_seconds"] * 2 * 1000
        for event in segments:
            previous = assembled[-1] if assembled else None
            mergeable = (
                previous
                and previous["track"] == event["track"]
                and previous["speaker"] == event["speaker"]
            )
            gap_ms = event["start_ms"] - previous["end_ms"] if previous else float("inf")
            if not mergeable or gap_ms > max_merge_gap_ms:
                assembled.append(
                    {**event, "word_timestamps": list(event.get("word_timestamps", []))}
                )
                continue
            merged_duration = event["end_ms"] - previous["start_ms"]
            if merged_duration <= max_segment_ms:
                previous["text"] = RefinementWorkerMixin._join_utterance_pair(
                    previous["text"],
                    event["text"],
                    continuation=bool(event.get("continues_previous")),
                )
                previous["end_ms"] = max(previous["end_ms"], event["end_ms"])
                # 词级数据仅用于详情页的重叠说话人提示，完整保留各窗口即可；
                # 文本去重不再尝试替换整组词时间戳。
                previous["word_timestamps"].extend(event.get("word_timestamps", []))
                continue
            # 超长：优先在 previous 最后一个句末标点处语义拆分。
            head, tail = RefinementWorkerMixin._split_utterance_at_sentence(previous)
            if head is None:
                assembled.append(
                    {**event, "word_timestamps": list(event.get("word_timestamps", []))}
                )
                continue
            assembled[-1] = head
            # 拆分出的尾句可能仍是残句或续接窗口，沿用与普通合并相同的拼接规则
            # （截断重启整句替换、续接窗口去掉伪句号），而不是简单按标点粘接。
            merged_text = RefinementWorkerMixin._join_utterance_pair(
                tail["text"],
                event["text"],
                continuation=bool(event.get("continues_previous")),
            )
            merged_words = tail["word_timestamps"] + list(event.get("word_timestamps", []))
            assembled.append(
                {
                    **event,
                    "text": merged_text,
                    "start_ms": tail["start_ms"],
                    "end_ms": event["end_ms"],
                    "word_timestamps": merged_words,
                }
            )
        return assembled

    @staticmethod
    def _is_decimal_dot(text, index):
        """判断 ``text[index]`` 处的小数点是否属于数字（两侧都是数字）。

        ASR 输出里小数点（如 ``60.99亿元``、``涨幅629.44%``）不是句末标点，
        切句与拼接时不能当成句号。仅当两侧都是数字时才是小数点。
        """
        return (
            text[index] == "."
            and index > 0
            and text[index - 1].isdigit()
            and index + 1 < len(text)
            and text[index + 1].isdigit()
        )

    @staticmethod
    def _split_sentences(text):
        """按句末标点切分为句子（含标点），数字内的小数点不作为句末。

        返回的每个片段保留标点后的前导空白，便于英文等以空格分词的语言原样粘回。
        """
        if not text:
            return []
        chunks = []
        start = 0
        for index, ch in enumerate(text):
            is_end = ch in "。！？!?；;"
            if ch == "." and not RefinementWorkerMixin._is_decimal_dot(text, index):
                is_end = True
            if is_end:
                chunks.append(text[start : index + 1])
                start = index + 1
        if start < len(text):
            chunks.append(text[start:])
        return chunks

    @staticmethod
    def _numberish_core(text):
        """返回文本去掉句末标点与计量单位后的「数字残片核心」；不是短数字则返回 ``None``。

        例如 ``五十九点。`` → ``五十九``、``6000亿元。`` → ``6000``；而 ``59.17亿元。``
        （完整数字）核心过长返回 ``None``。用于识别 ASR 把同一个数字说/转写两遍时
        前一处的残片（中文数字、被截断的小数等）。
        """
        core = (text or "").strip(" \t。！？.!?；;，,、")
        core = core.rstrip("元亿元万块角毛分个点")
        if not core or len(core) > 4:
            return None
        if all(ch.isdigit() or ch in "零〇一二两三四五六七八九十百千万亿点" for ch in core):
            return core
        return None

    @staticmethod
    def _number_rephrase(previous, current):
        """数字重述拼接：``previous`` 以数字残片结尾，``current`` 重述其前缀并补全数字。

        ASR 跨窗口/跨句会把同一个数字说两遍，第一处常是残片、第二处用另一种形式补全：
        「…净募集资金约五十九点。」接「募集资金约59.17亿元，刨除…」共享前缀
        「募集资金约」，应把残片「五十九点」换成「59.17亿元」→
        「…净募集资金约59.17亿元，刨除…」。命中返回拼接结果，否则返回 ``None``。
        """
        if not previous or not current:
            return None
        prefix = ""
        for ch in current:
            if "\u4e00" <= ch <= "\u9fff":
                prefix += ch
            else:
                break
        # 从长到短找 current 开头的纯中文前缀，且它出现在 previous 内部、previous 其后
        # 是数字残片（而不是完整句）。纯中文前缀归一化与原文 1:1 对应，便于映射。
        for length in range(min(len(prefix), 10), 3, -1):
            piece = prefix[:length]
            pos = previous.rfind(piece)
            if pos < 0:
                continue
            tail = previous[pos + length :]
            if RefinementWorkerMixin._numberish_core(tail) is not None:
                return (previous[: pos + length] + current[length:]).strip()
        # 短数词常在句首被语气词打断（「哎，对，这八千七百三。」→
        # 「对，这8734股呢」），共享的业务前缀只剩「这」。此时只接受“中文数字
        # 残片 → 阿拉伯数字”的明确更正，保留原来的语气词。
        match = re.search(r"(?P<prefix>[\u4e00-\u9fff]{1,4})(?P<number>\d+(?:\.\d+)?)", current)
        if match:
            for length in range(len(match["prefix"]), 0, -1):
                piece = match["prefix"][-length:]
                pos = previous.rfind(piece)
                tail = previous[pos + length :] if pos >= 0 else ""
                if re.fullmatch(r"[零〇一二两三四五六七八九十百千万亿点]+[。！？.!?；;]*", tail):
                    return previous[:pos] + current[match.start("prefix") :]
        return None

    @staticmethod
    def _is_fragment(shorter, longer):
        """判断 ``shorter`` 是否几乎完全是 ``longer`` 的开头残片。"""
        shorter_norm = RefinementWorkerMixin._normalized_transcript(shorter)
        longer_norm = RefinementWorkerMixin._normalized_transcript(longer)
        if not shorter_norm or not longer_norm:
            return False
        common = 0
        for left, right in zip(shorter_norm, longer_norm):
            if left != right:
                break
            common += 1
        return (
            common >= 4
            and 0 < len(shorter_norm) - common <= max(1, len(shorter_norm) // 5)
            and (len(shorter_norm) - common) / len(shorter_norm) <= 0.2
        )

    @staticmethod
    def _split_utterance_at_sentence(segment):
        """在段内最后一个「有效」句末标点处拆开，返回 ``(head, tail)``；无则返回 ``(None, None)``。

        LLM 类 ASR 常在窗口末尾补一个「伪句末」（如 ``…but if you.``，实际句子还没完）。
        因此从后往前找第一个「后面还有实质内容」的句末标点作为切点，跳过末尾伪句末，
        避免把 ``if you ask them…`` 从中间断开。拆点用字符比例映射到时间。
        数字内的小数点（如 ``60.99亿元``）不是句末，不会被当作切点。
        """
        text = (segment.get("text") or "").strip()
        positions = [
            index
            for index, ch in enumerate(text)
            if ch in "。！？.!?；;"
            and not RefinementWorkerMixin._is_decimal_dot(text, index)
        ]
        for last in reversed(positions):
            if last + 1 >= len(text):
                continue  # 末尾句末（伪句末），跳过
            head_text = text[: last + 1].strip()
            tail_text = text[last + 1 :].strip()
            if not head_text or not tail_text:
                continue
            start_ms = segment["start_ms"]
            end_ms = segment["end_ms"]
            split_ms = start_ms + round((end_ms - start_ms) * (last + 1) / len(text))
            words = segment.get("word_timestamps", []) or []
            head_words = [word for word in words if word["start_ms"] < split_ms]
            tail_words = [word for word in words if word["start_ms"] >= split_ms]
            head = {
                **segment,
                "text": head_text,
                "end_ms": split_ms,
                "word_timestamps": head_words,
            }
            tail = {
                **segment,
                "text": tail_text,
                "start_ms": split_ms,
                "word_timestamps": tail_words,
            }
            return head, tail
        return None, None

    @staticmethod
    def _join_utterance_text(previous, current):
        """拼接相邻窗口文本；句末标点后补空格，拉丁词边界补空格，其余直接相连。"""
        previous = (previous or "").strip()
        current = (current or "").strip()
        if not previous:
            return current
        if not current:
            return previous
        if previous[-1] in "。！？.!?；;":
            return f"{previous} {current}"
        if (
            previous[-1].isascii()
            and previous[-1].isalnum()
            and current[0].isascii()
            and current[0].isalnum()
        ):
            return f"{previous} {current}"
        return f"{previous}{current}"

    @staticmethod
    def _join_utterance_pair(previous, current, continuation=False):
        """合并相邻窗口文本；前一句是当前句开头的截断残片时整体替换。

        跨窗口解码时，前一个窗口可能只解码出句子开头的残片（如「今天我们就打开语。」，
        词在窗口边界被截断），后一个窗口带上下文重新解码出完整句子。若按标点拼接会
        得到「残片。 完整句」，因此当较短的一句几乎被两句共享前缀覆盖时，整体用更
        完整的一句替换，词级时间戳也随替换。

        ``continuation`` 为真表示当前句是上一句的直接续接（重叠裁切已命中，见
        :meth:`_trim_refinement_overlap_detailed`），上一句末尾的伪句号应去掉后再
        拼接，与单窗口内的重复合并（:meth:`_trim_refinement_repeats`）保持一致。

        词级时间戳仅用于重叠说话人提示，因此组装时始终保留各窗口的数据。
        """
        previous = (previous or "").strip()
        current = (current or "").strip()
        if not previous:
            return current
        if not current:
            return previous
        if continuation and previous[-1] in "。！？.!?；;":
            return previous.rstrip("。！？.!?；; ").rstrip() + current
        # 数字重述：上一段以数字残片结尾、当前段重述其前缀并补全数字（如「…净募集
        # 资金约五十九点。」接「募集资金约59.17亿元…」），拼成完整数字。
        rephrased = RefinementWorkerMixin._number_rephrase(previous, current)
        if rephrased is not None:
            return rephrased
        # 残片常出现在相邻窗口文本的拼接边界：前一段的最后一句是当前句开头的
        # 截断重启（如「…研究。今天我们就打开语。」接「今天我们就打开宇树的
        # 招股说明书…」），或当前段的第一句是上一句的残片，需要整句丢弃。
        fragment = RefinementWorkerMixin._boundary_fragment(previous, current)
        if fragment == "previous":
            chunks = list(RefinementWorkerMixin._split_sentences(previous))
            head = "".join(chunks[:-1]).strip()
            # 前一段整体就是残片：直接用当前段。
            if not head:
                return current
            return RefinementWorkerMixin._join_utterance_text(head, current)
        if fragment == "current":
            chunks = list(RefinementWorkerMixin._split_sentences(current))
            rest = "".join(chunks[1:]).strip()
            if not rest:
                return previous
            return RefinementWorkerMixin._join_utterance_text(previous, rest)
        if RefinementWorkerMixin._is_fragment(previous, current):
            return current
        if RefinementWorkerMixin._is_fragment(current, previous):
            return previous
        return RefinementWorkerMixin._join_utterance_text(previous, current)

    @staticmethod
    def _boundary_fragment(previous, current):
        """判断拼接边界处是否存在截断残句，返回丢弃哪一侧。

        前一段的最后一句可能是当前句开头的截断重启（返回 ``"previous"``，
        丢弃前一段的最后一句）；当前段的第一句可能是前一段的残片（返回
        ``"current"``，丢弃当前段的第一句）。都不是则返回 ``None``。

        例如「…还得分开来研究。今天我们就打开语。」接「今天我们就打开宇树的
        招股说明书…」：前一句的最后一句「今天我们就打开语。」是「今天我们就打
        开宇树的招股说明书…」的截断残片，应丢弃并保留当前段。
        """
        prev_chunks = [
            chunk.strip()
            for chunk in RefinementWorkerMixin._split_sentences(previous)
        ]
        cur_chunks = [
            chunk.strip()
            for chunk in RefinementWorkerMixin._split_sentences(current)
        ]
        if not prev_chunks or not cur_chunks:
            return None

        prev_last = prev_chunks[-1]
        cur_first = cur_chunks[0]
        if RefinementWorkerMixin._is_fragment(prev_last, current) or RefinementWorkerMixin._is_fragment(prev_last, cur_first):
            return "previous"
        if RefinementWorkerMixin._is_fragment(cur_first, previous) or RefinementWorkerMixin._is_fragment(cur_first, prev_last):
            return "current"
        return None

    def _match_speaker_profiles(self, meeting, turns):
        """为每位 diarized speaker 的最长片段做一次声纹库匹配。"""
        representatives = {}
        for turn in turns:
            speaker = turn.get("speaker")
            if not speaker or (
                speaker in representatives
                and turn["end_ms"] - turn["start_ms"]
                <= representatives[speaker]["end_ms"] - representatives[speaker]["start_ms"]
            ):
                continue
            representatives[speaker] = turn
        replacements = {}
        for speaker, turn in representatives.items():
            embedding = turn.get("_embedding")
            if embedding is None:
                continue
            profile = self.store.match_speaker_profile(
                embedding, SETTINGS["diarization"]["voiceprint_similarity_threshold"]
            )
            if self._is_confident_profile_match(profile):
                replacements[speaker] = f"profile-{profile['id']}"
                self.store.rename_speaker(
                    meeting["id"],
                    replacements[speaker],
                    profile["name"],
                    profile_id=profile["id"],
                )
        for turn in turns:
            turn["speaker"] = replacements.get(turn.get("speaker"), turn.get("speaker"))

    @staticmethod
    def _decode_range(turn, before, after, duration_ms, context_ms=800):
        """为快速语音保留窗口首尾上下文，但不跨越其他说话人。"""
        start_ms, end_ms = turn["start_ms"], turn["end_ms"]
        decode_start_ms = max(0, start_ms - context_ms)
        decode_end_ms = min(duration_ms, end_ms + context_ms)
        if before and before["speaker"] != turn["speaker"]:
            decode_start_ms = max(decode_start_ms, min(start_ms, before["end_ms"]))
        if after and after["speaker"] != turn["speaker"]:
            decode_end_ms = min(decode_end_ms, max(end_ms, after["start_ms"]))
        return decode_start_ms, decode_end_ms

    @staticmethod
    def _refinement_segment_id(track, start_ms, index, existing):
        """为重叠的离线窗口保留各自的稳定段落 ID。"""
        segment_id = f"{track}-{start_ms}"
        if segment_id in existing:
            segment_id = f"{segment_id}-{index}"
        existing.add(segment_id)
        return segment_id

    @staticmethod
    def _trim_refinement_overlap(previous, text):
        """移除相邻精修窗口因上下文重叠产生的重复前缀。

        LLM 类 ASR（如 Qwen3-ASR）对同一段重叠音频在两个窗口里会带不同上下文解码，
        标点/大小写常有差异，纯字符串精确匹配会漏掉。这里先做「去标点 + 小写」的
        归一化，在归一化文本上找最长公共后缀/前缀，再映射回原文截断。
        """
        trimmed, _ = RefinementWorkerMixin._trim_refinement_overlap_detailed(
            previous, text
        )
        return trimmed

    @staticmethod
    def _trim_refinement_overlap_detailed(previous, text):
        """同 :meth:`_trim_refinement_overlap`，额外返回 ``continued``。

        ``continued`` 为真表示当前窗口是上一窗口句子的直接续接：重叠裁切命中
        （如「美元一圈仍然浮盈…」接「…一圈仍然浮。」），拼接时应去掉上一句句末
        的伪句号。窗口边界落在句中时，下一窗口通常会把上下文完整重说一遍，因此
        只要发生裁切就按续接处理；干净重复（如「2025年末」接「2025年末固定资产…」）
        同样是句中截断，句号同样要去掉。
        """
        if not previous or not text:
            return text, False
        prev_norm = RefinementWorkerMixin._normalized_transcript(previous)
        text_norm = RefinementWorkerMixin._normalized_transcript(text)
        if not prev_norm or not text_norm:
            return text, False
        if SequenceMatcher(None, prev_norm, text_norm).ratio() >= 0.92:
            return "", False
        max_len = min(len(prev_norm), len(text_norm), 200)
        best = offset = 0
        # 精确匹配优先：先完整扫描，找到最长精确重叠。
        # decoder 偶尔会在重复内容前多吐出一两个字（如「一好，我们先聊…」）。
        # 重叠仍紧贴窗口开头，跳过极短前缀后匹配即可，且不会扫描到正文中误删。
        for prefix in range(min(4, len(text_norm))):
            for length in range(min(max_len, len(text_norm) - prefix), 3, -1):
                if prev_norm[-length:] == text_norm[prefix : prefix + length]:
                    best, offset = length, prefix
                    break
            if best:
                break
        # 没有任何精确匹配时，才允许高相似度兜底，容忍 LLM ASR 对同一重叠音频的
        # 标点/字词抖动（如「好，我们先聊。一好，我们先聊一聊…」）。相似度够高、
        # 长度不短才启用，降低误删风险。
        if best == 0:
            for length in range(max_len, 3, -1):
                if length >= 4 and SequenceMatcher(
                    None, prev_norm[-length:], text_norm[offset : offset + length]
                ).ratio() >= 0.9:
                    best = length
                    break
        if best == 0:
            return text, False
        # 把归一化前缀的 best 个「词字符」映射回原文 text 的字符偏移。
        count = 0
        for index, ch in enumerate(text):
            if ch.isalnum():
                count += 1
                if count >= offset + best:
                    return (
                        text[index + 1 :].lstrip(" \t,.;:!?，。；：！？"),
                        True,
                    )
        return text, False

    @staticmethod
    def _trim_refinement_repeats(text):
        """移除单次离线 ASR 输出中跨句的重复前缀。"""
        sentences = []
        previous_text = ""
        for chunk in RefinementWorkerMixin._split_sentences(text):
            sentence = chunk.lstrip()
            previous = previous_text
            previous_norm = RefinementWorkerMixin._normalized_transcript(previous)
            sentence_norm = RefinementWorkerMixin._normalized_transcript(sentence)
            overlap = None
            if previous_norm and sentence_norm and sentence_norm[0] != previous_norm[0]:
                for offset in range(1, min(4, len(sentence_norm))):
                    for length in range(min(len(previous_norm), len(sentence_norm) - offset), 3, -1):
                        if previous_norm[-length:] == sentence_norm[offset : offset + length]:
                            overlap = offset + length
                            break
                    if overlap:
                        break
            if overlap:
                count = 0
                for index, char in enumerate(sentence):
                    if char.isalnum():
                        count += 1
                        if count == overlap:
                            sentence = sentence[index + 1 :].lstrip()
                            break
                merged = RefinementWorkerMixin._join_utterance_text(
                    previous.rstrip("。！？.!?；; "), sentence
                )
                sentences[-1] = merged
                previous_text = merged
                continue
            # 数字重述：前一句以数字残片结尾、当前句重述其前缀并补全数字
            # （「制造基地计划投入6000亿元。」接「制造基地计划投入6.24亿元。」）。
            rephrased = RefinementWorkerMixin._number_rephrase(previous, sentence)
            if rephrased is not None:
                sentences[-1] = rephrased
                previous_text = rephrased
                continue
            # 截断重启：前一句是当前句开头的残片（「今天我们就打开语。」→
            # 「今天我们就打开宇树的招股说明书…」），保留更完整的一句；
            # 若当前句反而更短，说明它只是上一句末尾的残片，直接丢弃，避免
            # 把完整句替换成残片。两句完全同前缀（common == min，如「互联网
            # 金融。互联网金融有很多服务。」）不是残片，保持原样。
            if RefinementWorkerMixin._is_fragment(previous, sentence):
                sentences[-1] = sentence
                previous_text = sentence
                continue
            if RefinementWorkerMixin._is_fragment(sentence, previous):
                # 当前句是残片：不追加，且继续用上一句作为比较基准。
                previous_text = previous
                continue
            # 未裁切时必须保留原句前空白，英文等以空格分词的语言不能粘句。
            sentences.append(chunk)
            previous_text = sentence
        return "".join(sentences)

    @staticmethod
    def _split_long_turns(turns, maximum_ms=6000):
        return [
            {**turn, "start_ms": start_ms, "end_ms": min(start_ms + maximum_ms, turn["end_ms"])}
            for turn in turns
            for start_ms in range(turn["start_ms"], turn["end_ms"], maximum_ms)
        ]

    @staticmethod
    def _auto_cluster_embeddings(embeddings, durations, num_speakers=-1):
        """以时长加权 silhouette 选择自动说话人数。"""
        import numpy

        if not embeddings:
            return []
        vectors = numpy.asarray(embeddings, dtype=numpy.float32)
        vectors /= numpy.linalg.norm(vectors, axis=1, keepdims=True) + 1e-9
        weights = numpy.asarray(durations, dtype=numpy.float64)
        distances = 1 - numpy.clip(vectors @ vectors.T, -1, 1)

        def cluster(count):
            centers = [vectors[numpy.argmax(weights)]]
            for _ in range(1, count):
                centers.append(vectors[numpy.argmin(numpy.max(vectors @ numpy.asarray(centers).T, axis=1))])
            centers, labels = numpy.asarray(centers), None
            for _ in range(50):
                updated = numpy.argmax(vectors @ centers.T, axis=1)
                if labels is not None and numpy.array_equal(labels, updated):
                    break
                labels = updated
                for label in range(count):
                    members = labels == label
                    if members.any():
                        center = numpy.average(vectors[members], axis=0, weights=weights[members])
                        centers[label] = center / (numpy.linalg.norm(center) + 1e-9)
            return labels

        if num_speakers > 0:
            return cluster(min(num_speakers, len(vectors))).tolist()
        if len(embeddings) < 3:
            return [0] * len(embeddings)

        candidates = {}
        for count in range(1, min(_refinement("max_auto_speakers"), len(vectors) - 1) + 1):
            labels = cluster(count)
            if len(set(labels)) == count and all(
                (labels == label).sum() >= _refinement("min_auto_speaker_windows")
                and weights[labels == label].sum() >= _refinement("min_auto_speaker_duration_ms")
                for label in set(labels)
            ):
                candidates[count] = labels
        if not candidates:
            return [0] * len(embeddings)
        scores = {}
        for count, labels in candidates.items():
            if count == 1:
                scores[count] = 0
                continue
            values = []
            for index, label in enumerate(labels):
                same = labels == label
                same[index] = False
                if not same.any():
                    values.append(0)
                    continue
                within = numpy.average(distances[index, same], weights=weights[same])
                nearest = min(numpy.average(distances[index, labels == other], weights=weights[labels == other]) for other in set(labels) if other != label)
                values.append((nearest - within) / max(nearest, within, 1e-9))
            scores[count] = numpy.average(values, weights=weights)
        best = max(scores.values())
        return candidates[
            max(
                count
                for count, score in scores.items()
                if score >= best - _refinement("auto_cluster_score_tolerance")
            )
        ].tolist()

    @staticmethod
    def _stabilize_speaker_turns(turns, minimum_ms=1000, merge_gap_ms=600):
        """合并同一说话人，并把相邻的亚秒聚类抖动吸收到较长 turn。

        ``merge_gap_ms`` 控制同一说话人两段之间可跨越的最大静默，需要在两个
        方向上权衡：过小（如 200ms）会把一句话切成很多小块；过大（如 1s）则会
        把较长静默并进同一 turn，而 turn 仅按 ``refined_window_seconds`` 切窗，
        这段静默会留在解码窗口内，正是 decoder 空转打转（“就就就…”）的诱因。
        句内换气/停顿多在 0.3–0.6s，0.6–1.0s 更可能是真正的句读或迟疑；取
        600ms 既能并掉换气停顿（仍是原 200ms 的 3 倍，避免过碎），又不至于把长
        静默喂给解码器。该值落在 pyannote / WhisperX 同说话人合并的 0.5–1.5s
        经验区间内。
        """

        def merge_same(items):
            merged = []
            for turn in items:
                if (
                    merged
                    and turn["speaker"] == merged[-1]["speaker"]
                    and turn["start_ms"] <= merged[-1]["end_ms"] + merge_gap_ms
                ):
                    merged[-1]["end_ms"] = max(
                        merged[-1]["end_ms"], turn["end_ms"]
                    )
                else:
                    merged.append(dict(turn))
            return merged

        stable = merge_same(
            sorted(
                (
                    turn
                    for turn in turns
                    if turn["end_ms"] > turn["start_ms"]
                ),
                key=lambda turn: (turn["start_ms"], turn["end_ms"]),
            )
        )
        # ponytail: local turn absorption; keep brief interjections separate when
        # word-level multi-speaker paragraphs are rendered by the UI.
        while len(stable) > 1:
            candidates = []
            for index, turn in enumerate(stable):
                if turn["end_ms"] - turn["start_ms"] >= minimum_ms:
                    continue
                if index:
                    previous = stable[index - 1]
                    candidates.append(
                        (
                            max(0, turn["start_ms"] - previous["end_ms"]),
                            -(previous["end_ms"] - previous["start_ms"]),
                            index,
                            index - 1,
                        )
                    )
                if index + 1 < len(stable):
                    following = stable[index + 1]
                    candidates.append(
                        (
                            max(0, following["start_ms"] - turn["end_ms"]),
                            -(following["end_ms"] - following["start_ms"]),
                            index,
                            index + 1,
                        )
                    )
            if not candidates:
                break
            gap, _, index, neighbor_index = min(candidates)
            turn = stable[index]
            if gap > 200:
                break
            neighbor = stable[neighbor_index]
            neighbor["start_ms"] = min(neighbor["start_ms"], turn["start_ms"])
            neighbor["end_ms"] = max(neighbor["end_ms"], turn["end_ms"])
            stable.pop(index)
            stable = merge_same(stable)
        return stable

    @staticmethod
    def _deoverlap_speaker_turns(turns):
        """消除相邻不同说话人 turn 的时间重叠，避免被误判成两人同时说话。

        pyannote 分段在说话人切换处常产生重叠边界（相邻 turn 有几百毫秒到几秒的
        交叠），这些交叠是 diarization 的边界噪声，并非真实的同时说话。这里按重叠
        区中点切分，让同一时刻只归属一位说话人，从而去掉 UI 上大量虚假的「重叠说话」。
        """
        turns = sorted(turns, key=lambda turn: (turn["start_ms"], turn["end_ms"]))
        deoverlapped = []
        for turn in turns:
            if (
                deoverlapped
                and turn["start_ms"] < deoverlapped[-1]["end_ms"]
                and turn["speaker"] != deoverlapped[-1]["speaker"]
            ):
                previous = deoverlapped[-1]
                # 完全被前一个 turn 包含的碎片（如 1ms 的 diarization 噪声）直接丢弃。
                if turn["end_ms"] <= previous["end_ms"]:
                    continue
                boundary = (turn["start_ms"] + previous["end_ms"]) // 2
                previous["end_ms"] = max(previous["start_ms"] + 1, boundary)
                turn = {**turn, "start_ms": min(boundary, turn["end_ms"] - 1)}
            deoverlapped.append(dict(turn))
        return [turn for turn in deoverlapped if turn["end_ms"] > turn["start_ms"]]

    @staticmethod
    def _is_confident_profile_match(profile):
        return profile and profile["score"] - profile["runner_up_score"] >= 0.08

    @staticmethod
    def _overlap_speakers(start_ms, end_ms, turns):
        """返回实质性覆盖该时间范围的说话人，过滤 diarization 边界噪声。

        仅当某位说话人的 turn 覆盖超过一半时长时才计入，这样跨说话人切换的单个
        token（其时间范围横跨两个相邻 turn）不会再被误标成两人同时说话。
        """
        span = max(1, end_ms - start_ms)
        speakers = []
        for turn in turns:
            overlap = min(end_ms, turn["end_ms"]) - max(start_ms, turn["start_ms"])
            if overlap > span / 2:
                speakers.append(turn["speaker"])
        return list(dict.fromkeys(speakers))

    @staticmethod
    def _normalized_transcript(text):
        return re.sub(r"[\W_]+", "", text).lower()

    @staticmethod
    def _clean_live_text(text):
        """移除模型终止标记、幻觉标签，并截断流式识别末尾的重复循环。"""
        # Qwen3-ASR may prepend its language metadata before this marker.
        text = re.split(r"<asr_text>", str(text or ""), flags=re.IGNORECASE)[-1]
        text = re.split(r"<\|endoftext\|>", str(text or ""), flags=re.IGNORECASE)[0]
        text = re.sub(r"<\|[^|>]+\|>", " ", text)
        # 字节级 BPE 流式模型（如 zipformer-zh-xlarge）在多字节字符的字节尚未补齐时，
        # get_result 会把半个字符解码成 U+FFFD（前端显示为 �/?）。合法转写不会出现该
        # 字符，全部删除；beam search 回退时它也可能落在句中，故不限句尾。下一帧字节
        # 补齐后重算的 partial 即恢复正常文字。
        text = text.replace("�", "")
        # Qwen3-ASR 是 LLM 型 ASR，在静音/低信噪窗口会幻听出 markdown 代码围栏
        # （```python、```java、```language=...）、"language <语言>" 标签、反引号
        # 序号（`(1)）等非转写内容，统一清理后再做重复检测。
        text = re.sub(r"```[^\n]*", "", text)
        text = re.sub(r"`\([^)]*\)`?", "", text)
        text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
        text = re.sub(r"language\s*=?\s*[A-Za-z]+", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+", " ", text).strip()
        # 流式/标点模型偶发在句首补出标点（如开头一个「。」），统一去掉，避免字幕以句号开头。
        text = re.sub(r"^[，。！？、；：,.!?;:…]+", "", text).strip()
        # 清理后只剩标点/空白（幻觉内容被移除），按空文本处理。
        if not re.search(r"[A-Za-z0-9\u4e00-\u9fff]", text):
            return ""
        # \u6298\u53e0 decoder \u7a7a\u8f6c\u4ea7\u751f\u7684\u91cd\u590d CJK \u7247\u6bb5\uff081\u20134 \u5b57\u4e3a\u4e00\u4e2a\u5355\u5143\u3001\u8fde\u7eed 8 \u6b21\u4ee5\u4e0a\uff09\uff0c
        # \u4e0d\u518d\u4ec5\u9650\u53e5\u5c3e\uff1a\u957f\u9759\u9ed8\u7a97\u53e3\u5e38\u5728\u53e5\u4e2d\u6253\u8f6c\uff08\u5982\u201c\u5c31\u5c31\u5c31\u2026\u201d\u540e\u4ecd\u63a5\u6b63\u5e38\u6587\u5b57\uff09\u3002
        text = re.sub(r"([\u4e00-\u9fff]{1,4}?)\1{7,}", r"\1", text)
        words = list(re.finditer(r"[\w']+", text, flags=re.UNICODE))
        for width in range(1, min(6, len(words) // 4) + 1):
            tail = [word.group().casefold() for word in words[-width:]]
            cursor, repeats = len(words), 0
            while (
                cursor >= width
                and [word.group().casefold() for word in words[cursor - width : cursor]]
                == tail
            ):
                cursor, repeats = cursor - width, repeats + 1
            if repeats >= 4:
                return text[: words[cursor + width - 1].end()].rstrip(" ,;，、")
        # 一些离线 decoder 会重复整句而非单个汉字。仅压缩至少 8 个字符、连续三次
        # 出现的完全相同片段（任意语言），避免吞掉正常的短语强调。
        while match := next(
            re.finditer(r"(?P<phrase>.{8,80}?)(?P=phrase){2,}", text),
            None,
        ):
            text = f"{text[:match.start()]}{match.group('phrase')}{text[match.end():]}"
        # 流式英文模型偶尔以全大写写出整段或句首的一长串词。只处理连续三个
        # 以上的大写词，避免改动正常句中的专有名词；常见技术缩写保持大写。
        def sentence_case(value):
            value = value.lower().capitalize()
            return re.sub(
                r"\b(?:ai|api|asr|cpu|gpu|http|https|llm|url)\b",
                lambda match: match.group().upper(),
                value,
            )

        text = re.sub(
            r"(?:\b[A-Z][A-Z'’-]*\b(?:[\s,;:.!?]+|$)){3,}",
            lambda match: sentence_case(match.group()),
            text,
        )
        letters = "".join(re.findall(r"[A-Za-z]", text))
        if len(letters) >= 4 and letters.isupper():
            text = sentence_case(text)
        return _normalize_numbers(text)

    def _is_duplicate_final(self, event):
        """过滤麦克风与系统音频对同一句话的重复识别。"""
        text = self._normalized_transcript(event["text"])
        if len(text) < 8:
            return False
        start_ms, end_ms = event["start_ms"], event["end_ms"]
        self.recent_finals = [
            item
            for item in self.recent_finals
            if item["end_ms"] >= start_ms - 2000 and item["start_ms"] <= end_ms + 2000
        ]
        # ponytail: text/timing heuristic; add audio fingerprinting if false matches become measurable.
        duplicate = any(
            (
                item["track"] != event["track"]
                and SequenceMatcher(None, text, item["text"]).ratio() >= 0.75
            )
            or (
                item["track"] == event["track"]
                and item["end_ms"] >= start_ms - 800
                and SequenceMatcher(None, text, item["text"]).ratio() >= 0.92
            )
            for item in self.recent_finals
        )
        if not duplicate:
            self.recent_finals.append(
                {
                    "track": event["track"],
                    "text": text,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                }
            )
        return duplicate

    @staticmethod
    def _detect_language(text):
        """根据首段识别文本选择中文或英文流式模型。"""
        latin = sum(character.isascii() and character.isalpha() for character in text)
        han = sum("\u4e00" <= character <= "\u9fff" for character in text)
        if latin >= 12 and latin > han * 2:
            return "en"
        if han:
            return "zh"
        return None

    @staticmethod
    def _speaker_for(start_ms, end_ms, intervals):
        """返回与目标时间窗重叠最长的说话人；完全无重叠时返回 ``None``。"""
        overlaps = [
            (
                min(end_ms, item["end_ms"]) - max(start_ms, item["start_ms"]),
                item["speaker"],
            )
            for item in intervals
        ]
        overlap, speaker = max(overlaps, default=(0, None))
        return speaker if overlap > 0 else None
