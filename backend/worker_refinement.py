"""聚焦的 worker 职责组件。"""

import os
import re
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

# 精修先做 VAD/说话人聚类，需要整段波形常驻，故仍有内存上限；识别阶段改为
# 逐窗从磁盘读取，聚类才是真正的天花板，这里放宽到 4 小时覆盖绝大多数会议。
MAX_REFINE_SECONDS = 4 * 60 * 60
MAX_AUTO_SPEAKERS = 20
MIN_AUTO_SPEAKER_WINDOWS = 2
MIN_AUTO_SPEAKER_DURATION_MS = 4000
AUTO_CLUSTER_SCORE_TOLERANCE = 0.05
DIARIZATION_CHUNK_MS = 15_000
DIARIZATION_OVERLAP_MS = 1_000
EMBEDDING_WINDOW_MS = 6_000


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
        tracker = SpeakerTracker(manager)
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
            for part_start in range(start_ms, end_ms, EMBEDDING_WINDOW_MS):
                part_end = min(part_start + EMBEDDING_WINDOW_MS, end_ms)
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
        refined_model_id = payload.get("refined_model_id", meeting["refined_model_id"])
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
        recognizer = RefinedASR(self.models, refined_model_id)
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
                    raw_text = self._clean_live_text(raw_text)
                    speaker_key = (track, turn["speaker"])
                    text = self._trim_refinement_overlap(
                        previous_text.get(speaker_key, ""), raw_text
                    )
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
            key=lambda item: (item["start_ms"], item["track"], item["end_ms"])
        )
        version, revision = self.store.next_refinement_version(meeting["id"])
        refined_segments = self.store.replace_segments(
            meeting["id"], refined_segments, version, revision
        )
        self.store.replace_speaker_turns(meeting["id"], turns)
        self.store.set_status(meeting["id"], "refined")
        result = {"meeting_id": meeting["id"], "status": "refined"}
        self.emit("refinement.ready", result)
        return result

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
        ensure_wav_duration(path, MAX_REFINE_SECONDS, "refine")
        samples, sample_rate = read_mono_wav(path)
        duration_ms = len(samples) * 1000 // sample_rate
        if track not in diarized_tracks:
            vad = OfflineVAD(
                self.models, meeting.get("vad_model_id") or "silero-vad"
            )
            speech = vad.process(samples, sample_rate)
            turns = [{**turn, "speaker": "local-user"} for turn in speech]
            self.store.rename_speaker(meeting["id"], "local-user", "Local user")
        else:
            vad = OfflineVAD(
                self.models, meeting.get("vad_model_id") or "silero-vad"
            )
            speech = vad.process(samples, sample_rate)

            self.emit(
                "refinement.progress",
                {"meeting_id": meeting["id"], "completed": 0, "total": 0, "stage": "分析说话人"},
            )
            if duration_ms > DIARIZATION_CHUNK_MS:
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
                )
                turns = (
                    [dict(turn) for turn in diarizer.process(samples, sample_rate)]
                    if speech
                    else []
                )

            if speech and not turns:
                # diarizer 失败时 fallback 到单说话人
                turns = [{**turn, "speaker": "spk-1"} for turn in speech]
            if duration_ms <= DIARIZATION_CHUNK_MS and turns:
                try:
                    tracker = SpeakerTracker(self.models)
                except RuntimeError:
                    tracker = None
                turns = self._split_long_turns(turns)
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
        use_vad_fallback = False
        for core_start in range(0, duration_ms, DIARIZATION_CHUNK_MS):
            self.wait_task(control)
            core_end = min(duration_ms, core_start + DIARIZATION_CHUNK_MS)
            window_start = max(0, core_start - DIARIZATION_OVERLAP_MS)
            window_end = min(duration_ms, core_end + DIARIZATION_OVERLAP_MS)
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
                "core_start_ms": core_start,
                "core_end_ms": core_end,
                "window_start_ms": window_start,
                "window_end_ms": window_end,
                "speech": window_speech,
                "vad_fallback": use_vad_fallback,
            }
            fallback_error = None
            try:
                result = self._run_diarization_process(context, payload, control)
            except RuntimeError as error:
                if use_vad_fallback:
                    fallback_error = error
                else:
                    # ponytail: 首次原生崩溃后整条轨道熔断，升级 Sherpa 后可删除。
                    use_vad_fallback = True
                    self.emit(
                        "worker.warning",
                        {
                            "code": "diarization_chunk_fallback",
                            "start_ms": core_start,
                            "message": str(error),
                        },
                    )
                    try:
                        result = self._run_diarization_process(
                            context, {**payload, "vad_fallback": True}, control
                        )
                    except RuntimeError as error:
                        fallback_error = error
                if fallback_error:
                    self.emit(
                        "worker.warning",
                        {
                            "code": "diarization_chunk_vad_only",
                            "start_ms": core_start,
                            "message": str(fallback_error),
                        },
                    )
                    result = [
                        {
                            "start_ms": max(core_start, turn["start_ms"]),
                            "end_ms": min(core_end, turn["end_ms"]),
                            "speaker": "spk-1",
                            "_embedding": None,
                        }
                        for turn in window_speech
                        if turn["end_ms"] > core_start
                        and turn["start_ms"] < core_end
                    ]
            turns.extend(result)
        return turns

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

    @managed_task("meeting.separate")
    def separate_sources(self, payload, control=None):
        """从已保存会议生成独立的人声和非人声 WAV，不改动原录音。"""
        require(payload, "meeting_id")
        meeting = self.store.get_meeting(payload["meeting_id"])
        self.emit(
            "separation.started",
            {"meeting_id": meeting["id"], "completed": 0, "total": 100},
        )

        def progress(completed, stage):
            self.wait_task(control)
            self.emit(
                "separation.progress",
                {
                    "meeting_id": meeting["id"],
                    "completed": completed,
                    "total": 100,
                    "stage": stage,
                },
            )

        event = self.media.separate(meeting, progress)
        self.emit("meeting.sources-separated", event)
        return event

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
                embedding, SETTINGS["diarization"]["online_similarity_threshold"]
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
        """移除相邻精修窗口因上下文重叠产生的重复前缀。"""
        if (
            previous
            and text
            and SequenceMatcher(
                None,
                RefinementWorkerMixin._normalized_transcript(previous),
                RefinementWorkerMixin._normalized_transcript(text),
            ).ratio()
            >= 0.92
        ):
            return ""
        for length in range(min(len(previous), len(text), 120), 2, -1):
            if previous[-length:].casefold() == text[:length].casefold():
                return text[length:].lstrip()
        return text

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
        for count in range(1, min(MAX_AUTO_SPEAKERS, len(vectors) - 1) + 1):
            labels = cluster(count)
            if len(set(labels)) == count and all(
                (labels == label).sum() >= MIN_AUTO_SPEAKER_WINDOWS
                and weights[labels == label].sum() >= MIN_AUTO_SPEAKER_DURATION_MS
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
                if score >= best - AUTO_CLUSTER_SCORE_TOLERANCE
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
    def _is_confident_profile_match(profile):
        return profile and profile["score"] - profile["runner_up_score"] >= 0.08

    @staticmethod
    def _overlap_speakers(start_ms, end_ms, turns):
        """返回与时间范围相交的全部说话人，不把重叠压成单一标签。"""
        return list(
            dict.fromkeys(
                turn["speaker"]
                for turn in turns
                if turn["start_ms"] < end_ms and turn["end_ms"] > start_ms
            )
        )

    @staticmethod
    def _normalized_transcript(text):
        return re.sub(r"[\W_]+", "", text).lower()

    @staticmethod
    def _clean_live_text(text):
        """移除模型终止标记，并截断流式识别末尾的重复循环。"""
        # Qwen3-ASR may prepend its language metadata before this marker.
        text = re.split(r"<asr_text>", str(text or ""), flags=re.IGNORECASE)[-1]
        text = re.split(r"<\|endoftext\|>", str(text or ""), flags=re.IGNORECASE)[0]
        text = re.sub(r"<\|[^|>]+\|>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
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
        return text

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
