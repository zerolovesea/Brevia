"""聚焦的 worker 职责组件。"""

import re
from difflib import SequenceMatcher
from pathlib import Path

from .asr import (
    OfflineDenoiser,
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
from .config import SETTINGS
from .media_tasks import TTS_MODEL_IDS
from .worker_common import managed_task, require

# 精修先做 VAD/说话人聚类，需要整段波形常驻，故仍有内存上限；识别阶段改为
# 逐窗从磁盘读取，聚类才是真正的天花板，这里放宽到 4 小时覆盖绝大多数会议。
MAX_REFINE_SECONDS = 4 * 60 * 60


class RefinementWorkerMixin:
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
        if num_speakers != -1 and num_speakers < 1:
            raise ValueError("num_speakers must be -1 or a positive integer")
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
                    meeting.get("speaker_embedding_model_id"),
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
        embedding_id = (
            meeting.get("speaker_embedding_model_id")
            or SETTINGS["diarization"]["embedding_model_id"]
        )
        speaker_models_ready = self.models.is_ready(
            segmentation_id
        ) and self.models.is_ready(embedding_id)
        diarized_tracks = set(required_diarized)
        if speaker_models_ready:
            diarized_tracks |= set(tracks)
        # 多个轨道同时聚类时，未命中声纹库的 spk-N 需按轨道命名，避免麦克风与系统
        # 音频各自的 spk-1 在按时间戳合并后串成同一个人。
        namespace_tracks = len(diarized_tracks) > 1
        self.emit("refinement.started", {"meeting_id": meeting["id"], "total": 0})
        sources, turns_by_track, raw_turns_by_track = {}, {}, {}
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]

        def prepare(track):
            return self._prepare_track(
                track,
                meeting,
                control,
                diarized_tracks,
                namespace_tracks,
                num_speakers,
                threshold,
                denoiser_id,
            )

        # 双轨会议并行准备：sherpa-onnx 每个模型仅占用约一半 CPU 核心（见
        # ModelManager.device），两条轨道并行执行 VAD/聚类/声纹提取正好吃满
        # CPU，把准备阶段的墙钟时间从双份降到接近单份，且不改变任一算法结果。
        if len(tracks) > 1:
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=len(tracks)) as pool:
                prepared = list(pool.map(prepare, tracks))
        else:
            prepared = [prepare(track) for track in tracks]
        for track, source, raw_turns, stable_turns in prepared:
            sources[track] = source
            raw_turns_by_track[track] = raw_turns
            turns_by_track[track] = stable_turns
        turns = sorted(
            (turn for track_turns in turns_by_track.values() for turn in track_turns),
            key=lambda turn: (turn["start_ms"], turn["end_ms"]),
        )
        overlaps = self._detect_overlaps(raw_turns_by_track)
        raw_turns = sorted(
            (turn for track_turns in raw_turns_by_track.values() for turn in track_turns),
            key=lambda turn: (turn["start_ms"], turn["end_ms"]),
        )
        self.store.replace_speaker_turns(meeting["id"], raw_turns)
        self.emit(
            "diarization.ready",
            {"meeting_id": meeting["id"], "tracks": tracks, "turns": raw_turns, "overlaps": overlaps},
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
        denoiser = (
            OfflineDenoiser(self.models, denoiser_id)
            if any(source["denoise"] for source in sources.values())
            else None
        )
        total = sum(map(len, windows_by_track.values()))
        completed = 0
        previous_text = {}
        refined_segments = []
        refined_segment_ids = set()
        context_ms = 800
        self.store.set_status(meeting["id"], "refining")
        self.emit(
            "refinement.progress",
            {"meeting_id": meeting["id"], "completed": 0, "total": total},
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
                    if source["denoise"] and denoiser is not None and len(current):
                        current = denoiser.process(current, sample_rate)
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
                                "overlap_speakers": self._overlap_speakers(
                                    word["start_ms"] + decode_start_ms,
                                    word["end_ms"] + decode_start_ms,
                                    raw_turns_by_track[track],
                                ),
                                "overlap": len(
                                    self._overlap_speakers(
                                        word["start_ms"] + decode_start_ms,
                                        word["end_ms"] + decode_start_ms,
                                        raw_turns_by_track[track],
                                    )
                                ) > 1,
                            }
                            for word in words
                        ],
                    }
                    refined_segments.append(event)
        except Exception:
            self.store.set_status(meeting["id"], "ready")
            raise
        refined_segments.sort(
            key=lambda item: (item["start_ms"], item["track"], item["end_ms"])
        )
        version, revision = self.store.next_refinement_version(meeting["id"])
        refined_segments = self.store.replace_segments(
            meeting["id"], refined_segments, version, revision
        )
        for event in refined_segments:
            self.emit("refinement.segment", event)
        result = self.store.set_status(meeting["id"], "refined")
        result = self.store.get_meeting(meeting["id"])
        self.emit("refinement.ready", {"meeting_id": meeting["id"], "meeting": result})
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
        denoiser_id,
    ):
        """对单条轨道执行 VAD/聚类/声纹提取，返回稳定化前后的说话人时间段。

        每次调用创建独立的 VAD/Diarizer/SpeakerTracker 实例，因此可安全地在
        线程池中并行运行多条轨道；共享的 ``self.store``/``self.emit`` 均已在各自
        实现里加锁。返回 ``(track, source, raw_turns, stable_turns)``。
        """
        self.wait_task(control)
        path = meeting["audio"]["playback"][track]
        ensure_wav_duration(path, MAX_REFINE_SECONDS, "refine")
        samples, sample_rate = read_mono_wav(path)
        denoise = track == "mic" and self.models.is_ready(denoiser_id)
        if denoise:
            try:
                samples = OfflineDenoiser(self.models, denoiser_id).process(
                    samples, sample_rate
                )
            except RuntimeError as error:
                denoise = False
                self.emit(
                    "worker.warning",
                    {
                        "meeting_id": meeting["id"],
                        "code": "offline_denoiser_unavailable",
                        "message": str(error),
                    },
                )
        vad = OfflineVAD(self.models, meeting.get("vad_model_id") or "silero-vad")
        speech = vad.process(samples, sample_rate)
        if track not in diarized_tracks:
            turns = [{**turn, "speaker": "local-user"} for turn in speech]
            self.store.rename_speaker(meeting["id"], "local-user", "Local user")
        else:
            import numpy

            diarizer = OfflineDiarizer(
                self.models,
                num_speakers,
                threshold,
                meeting.get("speaker_segmentation_model_id"),
                meeting.get("speaker_embedding_model_id"),
            )
            speech_only = numpy.zeros_like(samples)
            for turn in speech:
                start = round(turn["start_ms"] * sample_rate / 1000)
                end = round(turn["end_ms"] * sample_rate / 1000)
                speech_only[start:end] = samples[start:end]
            turns = diarizer.process(speech_only, sample_rate) if speech else []
            del speech_only
            if speech and not turns:
                turns = [{**turn, "speaker": "spk-1"} for turn in speech]
            # Initialise to None so the finally clause always has a name to del,
            # even when SpeakerTracker() raises before assignment completes.
            identity_tracker = None
            try:
                identity_tracker = SpeakerTracker(
                    self.models, model_id=meeting.get("speaker_embedding_model_id")
                )
                turns = self._split_long_turns(turns)
                turn_embeddings = []
                for turn in turns:
                    clip = samples[
                        round(turn["start_ms"] * sample_rate / 1000) : round(
                            turn["end_ms"] * sample_rate / 1000
                        )
                    ]
                    turn_embeddings.append(
                        identity_tracker.embedding(clip, sample_rate)
                    )
                if num_speakers == -1 and len(turns) > 1:
                    known = [
                        (index, embedding)
                        for index, embedding in enumerate(turn_embeddings)
                        if embedding is not None
                    ]
                    labels = (
                        self._auto_cluster_embeddings(
                            [embedding for _, embedding in known],
                            [
                                turns[index]["end_ms"] - turns[index]["start_ms"]
                                for index, _ in known
                            ],
                        )
                        if len(known) >= 3
                        else []
                    )
                    labeled = {
                        index: label for (index, _), label in zip(known, labels)
                    }
                    for index, turn in enumerate(turns):
                        if index not in labeled and labeled:
                            nearest_index = min(
                                labeled,
                                key=lambda candidate: max(
                                    0,
                                    turn["start_ms"] - turns[candidate]["end_ms"],
                                    turns[candidate]["start_ms"] - turn["end_ms"],
                                ),
                            )
                            labeled[index] = labeled[nearest_index]
                        if index in labeled:
                            turn["speaker"] = f"spk-{labeled[index] + 1}"
                for turn, embedding in zip(turns, turn_embeddings):
                    if embedding is None:
                        continue
                    profile = self.store.match_speaker_profile(
                        embedding,
                        SETTINGS["diarization"]["online_similarity_threshold"],
                    )
                    if self._is_confident_profile_match(profile):
                        turn["speaker"] = f"profile-{profile['id']}"
                        self.store.rename_speaker(
                            meeting["id"],
                            f"profile-{profile['id']}",
                            profile["name"],
                            profile_id=profile["id"],
                        )
            except RuntimeError:
                pass
            finally:
                # Explicitly release the native ONNX embedding extractor so its
                # C++ heap memory is freed before returning, reducing peak
                # memory pressure when tracks run in parallel.
                del identity_tracker
        if namespace_tracks:
            # 命中声纹库的 turn 已是全局 profile-{id}，跨轨道自然合并同一人；
            # 仅给未命中的 spk-N 加轨道前缀，避免不同轨道的 spk-1 混为一人。
            for turn in turns:
                if str(turn.get("speaker", "")).startswith("spk-"):
                    turn["speaker"] = f"{track}-{turn['speaker']}"
        source = {
            "path": path,
            "sample_rate": sample_rate,
            "duration_ms": len(samples) * 1000 // sample_rate,
            "denoise": denoise,
        }
        stable_turns = self._stabilize_speaker_turns(turns)
        # 精修识别阶段改为逐窗从磁盘读取，这里立即释放整段波形。
        del samples
        return track, source, turns, stable_turns

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

    def synthesize_tts(self, payload):
        """翻译后使用目标语言对应的本地 TTS 模型生成语音。"""
        require(payload, "text", "target_language", "provider", "model")
        language = payload["target_language"]
        model_id = TTS_MODEL_IDS.get(language)
        if not model_id:
            raise ValueError("Unsupported TTS language")
        if language in {"zh", "en"}:
            require(payload, "voice_id")
        if not self.models.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        payload = {**payload, "language": payload["target_language"]}
        payload["text"] = self._complete(
            payload,
            f"Translate the following text to {language}. Return only the translation.\n\n{payload['text']}",
        ).strip()
        event = self.media.synthesize(payload)
        self.emit("tts.ready", event)
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

    @staticmethod
    def _split_long_turns(turns, maximum_ms=6000):
        """将异常长的 diarization turn 切成可独立验证声纹的短段。"""
        split = []
        for turn in turns:
            for start_ms in range(turn["start_ms"], turn["end_ms"], maximum_ms):
                end_ms = min(start_ms + maximum_ms, turn["end_ms"])
                split.append({**turn, "start_ms": start_ms, "end_ms": end_ms})
        return split

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
        for length in range(min(len(previous), len(text), 120), 2, -1):
            if previous[-length:].casefold() == text[:length].casefold():
                return text[length:].lstrip()
        return text

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
    def _auto_cluster_embeddings(embeddings, durations):
        """以加权 silhouette 的首个平台自动选择 1–20 个说话人簇。"""
        import numpy

        if len(embeddings) < 3:
            return [0] * len(embeddings)
        vectors = numpy.asarray(embeddings, dtype=numpy.float32)
        vectors /= numpy.linalg.norm(vectors, axis=1, keepdims=True) + 1e-9
        weights = numpy.asarray(durations, dtype=numpy.float64)
        distances = 1 - numpy.clip(vectors @ vectors.T, -1, 1)

        def cluster(count):
            centers = [vectors[numpy.argmax(weights)]]
            for _ in range(1, count):
                similarity = numpy.max(vectors @ numpy.asarray(centers).T, axis=1)
                centers.append(vectors[numpy.argmin(similarity)])
            centers = numpy.asarray(centers)
            labels = None
            for _ in range(50):
                updated = numpy.argmax(vectors @ centers.T, axis=1)
                if labels is not None and numpy.array_equal(labels, updated):
                    break
                labels = updated
                for label in range(count):
                    members = labels == label
                    if members.any():
                        center = numpy.average(
                            vectors[members], axis=0, weights=weights[members]
                        )
                        centers[label] = center / (numpy.linalg.norm(center) + 1e-9)
            return labels

        candidates = {}
        for count in range(2, min(20, len(vectors) - 1) + 1):
            labels = cluster(count)
            if len(set(labels)) < 2:
                candidates[count] = (0, labels)
                continue
            scores = []
            for index, label in enumerate(labels):
                same = labels == label
                same[index] = False
                if not same.any():
                    scores.append(0)
                    continue
                within = numpy.average(distances[index, same], weights=weights[same])
                nearest = min(
                    numpy.average(
                        distances[index, labels == other],
                        weights=weights[labels == other],
                    )
                    for other in set(labels)
                    if other != label
                )
                scores.append((nearest - within) / max(nearest, within, 1e-9))
            candidates[count] = (numpy.average(scores, weights=weights), labels)
        best = max(score for score, _ in candidates.values())
        # ponytail: first silhouette plateau; ask for an explicit count when a
        # recording genuinely contains more than 20 or tightly similar voices.
        count = min(
            count for count, (score, _) in candidates.items() if score >= best - 0.003
        )
        return candidates[count][1].tolist()

    @staticmethod
    def _detect_overlaps(turns_by_track):
        """从 diarization 的并发说话人活动中提取独立的重叠语音区间。"""
        overlaps = []
        for track, turns in turns_by_track.items():
            for index, first in enumerate(turns):
                for second in turns[index + 1 :]:
                    if second["start_ms"] >= first["end_ms"]:
                        break
                    if first["speaker"] == second["speaker"]:
                        continue
                    start_ms, end_ms = max(first["start_ms"], second["start_ms"]), min(first["end_ms"], second["end_ms"])
                    if end_ms - start_ms >= 100:
                        overlaps.append({"track": track, "start_ms": start_ms, "end_ms": end_ms, "speakers": [first["speaker"], second["speaker"]]})
        return overlaps

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
