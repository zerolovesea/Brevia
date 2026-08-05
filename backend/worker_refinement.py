"""Focused worker responsibility component."""

import re
from difflib import SequenceMatcher

from .asr import (
    OfflineDenoiser,
    OfflineVAD,
    OfflineDiarizer,
    RefinedASR,
    SpeakerTracker,
)
from .audio_io import ensure_wav_duration, read_mono_wav
from .config import SETTINGS
from .media_tasks import TTS_MODEL_IDS
from .worker_common import managed_task, require, synchronized_recording


class RefinementWorkerMixin:
    @managed_task("meeting.refine")
    @synchronized_recording
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
        diarized_tracks = {"system"} | ({"mic"} if is_imported_audio else set())
        required_models = [
            refined_model_id,
            meeting.get("vad_model_id") or "silero-vad",
        ]
        if diarized_tracks.intersection(tracks):
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
        self.emit("refinement.started", {"meeting_id": meeting["id"], "total": 0})
        audio, turns_by_track, raw_turns_by_track = {}, {}, {}
        vad = OfflineVAD(self.models, meeting.get("vad_model_id") or "silero-vad")
        diarizer = (
            OfflineDiarizer(
                self.models,
                num_speakers,
                threshold,
                meeting.get("speaker_segmentation_model_id"),
                meeting.get("speaker_embedding_model_id"),
            )
            if diarized_tracks.intersection(tracks)
            else None
        )
        denoiser_id = SETTINGS["live_asr"]["denoiser_model_id"]
        for track in tracks:
            self.wait_task(control)
            path = meeting["audio"]["playback"][track]
            ensure_wav_duration(path, 30 * 60, "refine")
            samples, sample_rate = read_mono_wav(path)
            if track == "mic" and self.models.is_ready(denoiser_id):
                try:
                    samples = OfflineDenoiser(self.models, denoiser_id).process(
                        samples, sample_rate
                    )
                except RuntimeError as error:
                    self.emit(
                        "worker.warning",
                        {
                            "meeting_id": meeting["id"],
                            "code": "offline_denoiser_unavailable",
                            "message": str(error),
                        },
                    )
            speech = vad.process(samples, sample_rate)
            if track not in diarized_tracks:
                turns = [{**turn, "speaker": "local-user"} for turn in speech]
                self.store.rename_speaker(meeting["id"], "local-user", "Local user")
            else:
                import numpy

                speech_only = numpy.zeros_like(samples)
                for turn in speech:
                    start = round(turn["start_ms"] * sample_rate / 1000)
                    end = round(turn["end_ms"] * sample_rate / 1000)
                    speech_only[start:end] = samples[start:end]
                turns = diarizer.process(speech_only, sample_rate) if speech else []
                if speech and not turns:
                    turns = [{**turn, "speaker": "spk-1"} for turn in speech]
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
                    if (
                        num_speakers == -1
                        and len(turns) > 1
                    ):
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
            raw_turns_by_track[track] = turns
            turns = self._stabilize_speaker_turns(turns)
            audio[track] = samples, sample_rate
            turns_by_track[track] = turns
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
                len(audio[track][0]) * 1000 // audio[track][1],
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
            {"meeting_id": meeting["id"], "completed": 0, "total": total},
        )
        try:
            for track in tracks:
                samples, sample_rate = audio[track]
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
                        len(samples) * 1000 // sample_rate,
                        context_ms,
                    )
                    start = round(decode_start_ms * sample_rate / 1000)
                    end = round(decode_end_ms * sample_rate / 1000)
                    current = samples[start:end]
                    raw_text, words = recognizer.decode_words(current, sample_rate)
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

    @managed_task("meeting.separate")
    @synchronized_recording
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
        require(payload, "text", "target_language", "endpoint", "model")
        language = payload["target_language"]
        model_id = TTS_MODEL_IDS.get(language)
        if not model_id:
            raise ValueError("Unsupported TTS language")
        if language in {"zh", "en"}:
            require(payload, "voice_id")
        if not self.models.is_ready(model_id):
            raise RuntimeError(f"Model {model_id} is not installed")
        payload = {**payload, "language": payload["target_language"]}
        payload["text"] = self.llm_complete(
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
    def _stabilize_speaker_turns(turns, minimum_ms=1000):
        """合并同一说话人，并把相邻的亚秒聚类抖动吸收到较长 turn。"""

        def merge_same(items):
            merged = []
            for turn in items:
                if (
                    merged
                    and turn["speaker"] == merged[-1]["speaker"]
                    and turn["start_ms"] <= merged[-1]["end_ms"] + 200
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
        text = re.split(r"<\|endoftext\|>", str(text or ""), flags=re.IGNORECASE)[0]
        text = re.sub(r"<\|[^|>]+\|>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"([\u4e00-\u9fff])\1{7,}$", r"\1", text)
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
