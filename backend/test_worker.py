import base64
import io
import json
import tempfile
import threading
import unittest
import wave
import zipfile
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from .asr import ChinesePunctuation, EnglishPunctuation, SpeakerTracker
from .llm_client import complete
from .transcript import parse_json_object, validate_summary
from .worker import Worker


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.events = []
        self.worker = Worker(self.temp.name, self.events.append)
        self.worker.models.is_ready = lambda _: False

    def tearDown(self):
        self.temp.cleanup()

    def test_meeting_audio_persistence_and_export(self):
        meeting = self.worker.start(
            {
                "title": "接口联调",
                "language": "zh",
                "target_language": None,
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        for track, pcm in (("mic", b"\x10\x00" * 1600), ("system", b"\x20\x00" * 1600)):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": track,
                    "pcm": base64.b64encode(pcm).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "这是联调测试。",
                "start_ms": 0,
                "end_ms": 100,
                "speaker": "spk-1",
            }
        )
        result = self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 100})
        audio = Path(result["audio"]["mic"][0])
        with wave.open(str(audio)) as recording:
            self.assertEqual(recording.getnframes(), 1600)
            self.assertEqual(recording.getframerate(), 16000)
        with wave.open(result["audio"]["playback"]["mix"]) as recording:
            mixed = array("h")
            mixed.frombytes(recording.readframes(1))
            self.assertEqual(mixed[0], 24)
        exported = self.worker.export({"meeting_id": meeting["id"], "format": "srt"})
        self.assertIn("这是联调测试", Path(exported["path"]).read_text())
        bundle = self.worker.bundle({"meeting_id": meeting["id"]})
        with zipfile.ZipFile(bundle["path"]) as archive:
            self.assertEqual({Path(name).suffix for name in archive.namelist()}, {".wav", ".md", ".txt"})
        self.assertTrue(self.worker.store.read_manifest(meeting["id"])["closed"])

    def test_start_requires_selected_models_when_requested(self):
        with self.assertRaisesRegex(RuntimeError, "Models paraformer-zh-en-int8, qwen3-asr-0.6b-int8 are not installed"):
            self.worker.start({"title": "缺模型", "language": "zh", "streaming_model_id": "paraformer-zh-en-int8", "refined_model_id": "qwen3-asr-0.6b-int8", "require_models": True})
        self.assertEqual([], self.worker.store.list_meetings())

    def test_summary_requires_valid_evidence(self):
        with self.assertRaises(ValueError):
            validate_summary(
                {
                    "summary": "摘要",
                    "decisions": [{"text": "决定", "evidence_segment_ids": ["missing"]}],
                    "action_items": [],
                    "open_questions": [],
                },
                {"seg-1"},
            )

    def test_summary_appends_transcript_to_custom_prompt_and_parses_code_fence(self):
        meeting = self.worker.start({"title": "纪要联调", "language": "zh", "streaming_model_id": "paraformer-zh-en-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        self.worker.store.save_segment({"meeting_id": meeting["id"], "segment_id": "mic-0", "text": "周五完成验收", "start_ms": 0, "end_ms": 1000, "speaker": "spk-1"})
        prompts = []
        self.worker.llm_complete = lambda _payload, prompt, **_kwargs: prompts.append(prompt) or '```json\n{"summary":"验收安排","decisions":[],"action_items":[{"task":"完成验收","owner":null,"due":null,"evidence_segment_ids":["mic-0"]}],"open_questions":[]}\n```'
        result = self.worker.summarize({"meeting_id": meeting["id"], "provider": "Anthropic", "endpoint": "https://example.test/messages", "model": "claude", "format": "claude", "consent": True, "prompt": "只写关键事项"})
        self.assertEqual(result["summary"], "验收安排")
        self.assertIn("只写关键事项", prompts[0])
        self.assertIn("周五完成验收", prompts[0])
        progress = [event["payload"]["completed"] for event in self.events if event.get("type") in {"summary.started", "summary.progress"}]
        self.assertEqual(progress, [10, 60, 100])
        self.assertEqual(parse_json_object("说明\n{\"summary\":\"ok\"}")["summary"], "ok")

    def test_summary_exports_markdown_and_text(self):
        meeting = self.worker.start({"title": "纪要导出", "language": "zh", "streaming_model_id": "paraformer-zh-en-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        summary = {"summary": "确认验收安排", "decisions": [{"text": "周五验收", "evidence_segment_ids": []}], "action_items": [{"task": "准备报告", "owner": "小王", "due": None, "evidence_segment_ids": []}], "open_questions": ["是否需要复盘"]}
        self.worker.store.save_summary(meeting["id"], summary, "raw")
        for export_format in ("md", "txt"):
            exported = self.worker.export({"meeting_id": meeting["id"], "content": "notes", "format": export_format})
            self.assertIn("准备报告", Path(exported["path"]).read_text())

    def test_llm_client_supports_openai_and_anthropic_shapes(self):
        class Response:
            def __init__(self, data):
                self.data = json.dumps(data).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return self.data

        with patch("backend.llm_client.urllib.request.urlopen", return_value=Response({"choices": [{"message": {"content": "openai"}}]})) as request:
            self.assertEqual(complete({"endpoint": "https://example.test/openai", "model": "gpt", "api_key": "token"}, "hello", True), "openai")
            sent = request.call_args.args[0]
            self.assertEqual(json.loads(sent.data)["response_format"], {"type": "json_object"})
            self.assertEqual(dict(sent.header_items())["Authorization"], "Bearer token")
            self.assertEqual(dict(sent.header_items())["User-agent"], "Brevia/1.0")
        with patch("backend.llm_client.urllib.request.urlopen", return_value=Response({"content": [{"type": "text", "text": "anthropic"}]})) as request:
            self.assertEqual(complete({"endpoint": "https://example.test/anthropic", "model": "claude", "format": "claude", "api_key": "token"}, "hello"), "anthropic")
            sent = request.call_args.args[0]
            self.assertEqual(sent.full_url, "https://example.test/anthropic/v1/messages")
            self.assertEqual(json.loads(sent.data)["max_tokens"], 2048)
            self.assertEqual(dict(sent.header_items())["X-api-key"], "token")

    def test_cross_track_duplicate_finals_are_suppressed(self):
        first = {"track": "mic", "text": "我们再一次完整地打一下这一场防疫", "start_ms": 1000, "end_ms": 4000}
        duplicate = {"track": "system", "text": "我们再一次完整的打一下这一场防疫", "start_ms": 1100, "end_ms": 4100}
        distinct = {"track": "system", "text": "接下来请产品团队介绍下一步安排", "start_ms": 1100, "end_ms": 4100}
        self.assertFalse(self.worker._is_duplicate_final(first))
        self.assertTrue(self.worker._is_duplicate_final(duplicate))
        self.assertFalse(self.worker._is_duplicate_final(distinct))

    def test_refinement_turns_preserve_speaker_boundaries(self):
        turns = self.worker._refinement_turns(
            [{"start_ms": 0, "end_ms": 18000, "speaker": "spk-1"}, {"start_ms": 18000, "end_ms": 21000, "speaker": "spk-2"}],
            21000,
            15000,
        )
        self.assertEqual([(turn["start_ms"], turn["end_ms"], turn["speaker"]) for turn in turns], [(0, 15000, "spk-1"), (15000, 18000, "spk-1"), (18000, 21000, "spk-2")])
        self.assertEqual([turn["speaker"] for turn in turns], ["spk-1", "spk-1", "spk-2"])

    def test_refinement_overlap_removes_repeated_prefix(self):
        self.assertEqual(self.worker._trim_refinement_overlap("我们确认下周的发布计划", "发布计划和负责人"), "和负责人")

    def test_refinement_segment_ids_remain_unique_for_overlapping_turns(self):
        ids = set()
        self.assertEqual(self.worker._refinement_segment_id("mix", 0, 0, ids), "mix-0")
        self.assertEqual(self.worker._refinement_segment_id("mix", 0, 1, ids), "mix-0-1")

    def test_tts_requires_zipvoice_before_translation(self):
        with self.assertRaisesRegex(RuntimeError, "Model zipvoice-zh-en is not installed"):
            self.worker.synthesize_tts({"text": "你好", "voice_id": "voice", "target_language": "zh", "endpoint": "https://example.test", "model": "test"})

    def test_refinement_versions_preserve_prior_postprocess_segments(self):
        meeting = self.worker.start({"title": "再次精修", "language": "zh", "streaming_model_id": "paraformer-zh-en-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        first = self.worker.store.next_refinement_version(meeting["id"])
        self.worker.store.replace_segments(meeting["id"], [{"segment_id": "mic-0", "track": "mic", "start_ms": 0, "end_ms": 1000, "speaker": "spk-1", "text": "旧结果"}], *first)
        second = self.worker.store.next_refinement_version(meeting["id"])
        self.worker.store.replace_segments(meeting["id"], [{"segment_id": "mic-1000", "track": "mic", "start_ms": 1000, "end_ms": 2000, "speaker": "spk-1", "text": "新结果"}], *second)
        segments = self.worker.store.get_meeting(meeting["id"])["segments"]
        self.assertEqual([segment["text"] for segment in segments], ["旧结果", "新结果"])
        self.assertEqual([segment["version"] for segment in segments], ["postprocess", "postprocess-1"])

    def test_replace_segments_normalizes_duplicate_ids(self):
        meeting = self.worker.start({"title": "重叠精修", "language": "zh", "streaming_model_id": "paraformer-zh-en-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        segments = self.worker.store.replace_segments(meeting["id"], [
            {"segment_id": "mix-0", "track": "mix", "start_ms": 0, "end_ms": 1000, "speaker": "spk-1", "text": "第一段"},
            {"segment_id": "mix-0", "track": "mix", "start_ms": 1000, "end_ms": 2000, "speaker": "spk-1", "text": "第二段"},
        ])
        self.assertEqual([segment["segment_id"] for segment in segments], ["mix-0", "mix-0-1"])

    def test_zipformer_xlarge_manifest_uses_the_archive_decoder_name(self):
        self.assertIn("decoder.onnx", self.worker.models.get("zipformer-zh-xlarge-streaming-int8")["files"])

    def test_streaming_transducer_receives_terms_as_hotwords(self):
        self.worker.store.save_term({"text": "Brevia"})
        with patch("backend.worker.StreamingASR") as streaming:
            self.worker.start({
                "title": "热词会议", "language": "zh",
                "streaming_model_id": "zipformer-zh-xlarge-streaming-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            })
        self.assertEqual(streaming.call_args.args[2], ("Brevia",))

    def test_initialize_downloads_the_default_live_denoiser(self):
        with patch.object(self.worker, "download_model") as download:
            self.worker.initialize({})
        download.assert_called_once_with({"model_id": "gtcrn-live-denoiser"})

    def test_live_microphone_gain_is_bounded_and_skips_near_silence(self):
        class Samples(list):
            def __mul__(self, gain):
                return Samples([value * gain for value in self])

        enhanced = self.worker._enhance_live_microphone(Samples([0.01, -0.01]))
        self.assertGreater(enhanced[0], 0.01)
        self.assertLessEqual(max(abs(value) for value in enhanced), 0.92)
        quiet = Samples([0.001, -0.001])
        self.assertEqual(self.worker._enhance_live_microphone(quiet), quiet)

    def test_speaker_profile_aggregates_samples_and_matches_known_voice(self):
        first = self.worker.store.save_speaker_profile_sample("王琳", [1, 0, 0], "voice-1")
        second = self.worker.store.save_speaker_profile_sample("王琳", [0.9, 0.1, 0], "voice-2", first["id"])
        matched = self.worker.store.match_speaker_profile([0.95, 0.05, 0], 0.8)
        self.assertEqual(second["sample_count"], 2)
        self.assertEqual(matched["id"], first["id"])
        self.assertIsNone(self.worker.store.match_speaker_profile([0, 0, 1], 0.8))

    def test_voiceprint_recording_limits_and_incremental_delete(self):
        with patch.dict("backend.storage.SETTINGS", {"voice_profiles": {"max_samples": 2, "max_total_seconds": 3}}, clear=False):
            profile = self.worker.store.save_speaker_profile_sample("林悦", [1, 0], "sentence-1", duration_ms=1000)
            self.worker.store.save_speaker_profile_sample("林悦", [0, 1], "sentence-2", profile["id"], duration_ms=1000)
            with self.assertRaisesRegex(ValueError, "at most 2"):
                self.worker.store.save_speaker_profile_sample("林悦", [1, 0], "sentence-3", profile["id"], duration_ms=1000)
        samples = self.worker.store.list_speaker_profile_samples(profile["id"])
        self.worker.store.delete_speaker_profile_sample(profile["id"], samples[0]["id"])
        self.assertEqual(self.worker.store.speaker_profile(profile["id"])["sample_count"], 1)

    def test_two_builtin_voiceprints_are_seeded_from_bundled_audio(self):
        self.worker.models.is_ready = lambda _: True
        with patch("backend.voice_profiles.SpeakerTracker") as tracker, \
             patch("backend.voice_profiles.read_mono_wav", return_value=([0.1] * 160000, 16000)), \
             patch("backend.voice_profiles.write_mono_wav", side_effect=lambda path, *_: Path(path).write_bytes(b"wav")):
            tracker.return_value.embedding.return_value = [1.0, 0.0]
            self.worker.voice_profiles.seed_builtin_profiles()
        profiles = self.worker.store.list_speaker_profiles()
        self.assertEqual({profile["name"] for profile in profiles}, {"内置男声", "内置女声"})
        self.assertTrue(all(profile["built_in"] for profile in profiles))

    def test_model_downloads_run_in_parallel(self):
        started, release = threading.Event(), threading.Event()
        running = []

        def download(model_id):
            running.append(model_id)
            if len(running) == 2:
                started.set()
            release.wait(1)

        self.worker.models.download = download
        self.assertEqual(self.worker.download_model({"model_id": "paraformer-zh-en-int8"})["status"], "downloading")
        self.assertEqual(self.worker.download_model({"model_id": "zipformer-en-streaming-int8"})["status"], "downloading")
        self.assertTrue(started.wait(1))
        release.set()

    def test_bundle_exports_transcript_without_recording(self):
        meeting = self.worker.start({"title": "无录音", "language": "zh", "streaming_model_id": "paraformer-zh-en-int8", "refined_model_id": "qwen3-asr-0.6b-int8"})
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        bundle = self.worker.bundle({"meeting_id": meeting["id"]})
        self.assertFalse(bundle["recording_included"])

    def test_stop_persists_the_last_partial_transcript(self):
        meeting = self.worker.start(
            {
                "title": "收尾保存",
                "language": "zh",
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )

        class PartialOnlyASR:
            def accept(self, _track, samples, _sample_rate, flush=False):
                return ("", True) if flush else ("停止前的实时字幕", False)

        self.worker.asr = PartialOnlyASR()
        class Samples(list):
            def __truediv__(self, _value):
                return self

        numpy = type("Numpy", (), {"float32": float, "asarray": staticmethod(lambda values, dtype: Samples(values))})
        with patch.dict("sys.modules", {"numpy": numpy}):
            self.worker.audio(
                {
                    "meeting_id": meeting["id"],
                    "track": "mic",
                    "pcm": base64.b64encode(b"\x10\x00" * 1600).decode(),
                    "sample_rate": 16000,
                    "start_ms": 0,
                }
            )
            self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 100})
        segments = self.worker.store.get_meeting(meeting["id"])["segments"]
        self.assertEqual([segment["text"] for segment in segments], ["停止前的实时字幕"])

    def test_meeting_search_matches_title_tags_and_transcript(self):
        meeting = self.worker.start(
            {
                "title": "季度路线图",
                "language": "zh",
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
                "tags": ["客户反馈"],
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "下周确认预算",
                "start_ms": 0,
                "end_ms": 100,
                "speaker": "spk-1",
            }
        )
        for query in ("路线图", "客户反馈", "确认预算"):
            self.assertEqual([item["id"] for item in self.worker.store.list_meetings(query=query)], [meeting["id"]])

    def test_translation_is_explicit_and_persisted(self):
        meeting = self.worker.start(
            {
                "title": "翻译联调",
                "language": "zh",
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.store.save_segment(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "text": "你好",
                "start_ms": 0,
                "end_ms": 100,
                "speaker": "spk-1",
            }
        )
        self.worker.llm_complete = lambda *_args, **_kwargs: "Hello"
        translated = self.worker.translate(
            {
                "meeting_id": meeting["id"],
                "segment_id": "mic-0",
                "target_language": "en",
                "endpoint": "http://127.0.0.1",
                "model": "local",
                "consent": True,
            }
        )
        self.assertEqual(translated["translation"], "Hello")
        self.assertEqual(
            self.worker.store.get_meeting(meeting["id"])["segments"][0]["translation"],
            "Hello",
        )

    def test_diarization_turns_and_overlap_assignment(self):
        meeting = self.worker.start(
            {
                "title": "声纹聚类",
                "language": "zh",
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        turns = [
            {"start_ms": 0, "end_ms": 900, "speaker": "spk-1"},
            {"start_ms": 900, "end_ms": 2000, "speaker": "spk-2"},
        ]
        self.worker.store.replace_speaker_turns(meeting["id"], turns)
        saved = self.worker.store.get_meeting(meeting["id"])["speaker_turns"]
        self.assertEqual(saved, [{**turn, "version": "postprocess"} for turn in turns])
        self.assertEqual(self.worker._speaker_for(800, 1500, turns), "spk-2")

    def test_speaker_tracker_reuses_similar_voiceprints(self):
        tracker = SpeakerTracker.__new__(SpeakerTracker)
        tracker.threshold = 0.2
        tracker.max_speakers = 2
        tracker.centers = []
        tracker.counts = []
        tracker.last_speaker = None
        self.assertEqual(tracker.assign_embedding([1.0, 0.0]), "spk-1")
        self.assertEqual(tracker.assign_embedding([0.9, 0.1]), "spk-1")
        self.assertEqual(tracker.assign_embedding([0.0, 1.0]), "spk-2")
        self.assertIn(tracker.assign_embedding([-1.0, 0.0]), {"spk-1", "spk-2"})
        self.assertEqual(tracker.speaker_ids, ["spk-1", "spk-2"])

    def test_english_punctuation_normalizes_model_text(self):
        formatter = EnglishPunctuation.__new__(EnglishPunctuation)

        class Engine:
            def add_punctuation_with_case(self, text):
                self.text = text
                return "How are you?"

        formatter.engine = Engine()
        self.assertEqual(formatter.apply("HOW ARE YOU"), "How are you?")
        self.assertEqual(formatter.engine.text, "how are you")

    def test_chinese_punctuation_preserves_model_sentence_boundaries(self):
        formatter = ChinesePunctuation.__new__(ChinesePunctuation)

        class Engine:
            def add_punctuation(self, text):
                self.text = text
                return "我们都是木头人，不会说话不会动。"

        formatter.engine = Engine()
        self.assertEqual(formatter.apply("我们都是木头人不会说话不会动"), "我们都是木头人，不会说话不会动。")
        self.assertEqual(formatter.engine.text, "我们都是木头人不会说话不会动")

    def test_auto_language_detection(self):
        self.assertEqual(Worker._detect_language("how are you doing today"), "en")
        self.assertEqual(Worker._detect_language("我们今天讨论产品计划"), "zh")

    def test_voiceprint_reference_is_local_and_removed_with_profile(self):
        profile = self.worker.store.save_speaker_profile_sample("测试人员", [1.0, 0.0], "sample-1")
        profile_dir = self.worker.store.speaker_profiles_dir / profile["id"]
        profile_dir.mkdir()
        reference = profile_dir / "reference.wav"
        reference.write_bytes(b"local")
        self.worker.store.save_speaker_profile_sample("测试人员", [1.0, 0.0], "sample-1", profile["id"], str(reference), "这是参考文本")
        self.assertEqual(self.worker.store.speaker_profile_reference(profile["id"])["audio_path"], str(reference))
        self.worker.store.delete_speaker_profile(profile["id"])
        self.assertFalse((self.worker.store.speaker_profiles_dir / profile["id"]).exists())

    def test_named_speaker_creates_profile_before_audio_is_long_enough(self):
        profile = self.worker.store.ensure_speaker_profile("小林")
        self.assertEqual((profile["name"], profile["sample_count"], profile["embedding"]), ("小林", 0, "[]"))
        completed = self.worker.store.save_speaker_profile_sample("小林", [1.0, 0.0], "meeting-short-then-long", profile["id"])
        self.assertEqual(completed["sample_count"], 1)

    def test_refining_status_preserves_meeting(self):
        meeting = self.worker.start(
            {
                "title": "精修状态",
                "language": "zh",
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        self.assertEqual(self.worker.store.set_status(meeting["id"], "refining")["status"], "refining")

    def test_examples_are_seeded_once_and_delete_audio_immediately(self):
        self.assertTrue(self.worker.store.seed_examples())
        self.assertFalse(self.worker.store.seed_examples())
        examples = [
            meeting
            for meeting in self.worker.store.list_meetings()
            if meeting["is_example"]
        ]
        self.assertEqual({meeting["example_locale"] for meeting in examples}, {"zh", "en", "es"})
        meeting = self.worker.store.get_meeting(examples[0]["id"])
        audio = Path(meeting["audio"]["playback"]["mic"])
        self.assertTrue(audio.exists())
        self.assertTrue(all(segment["translation"] for segment in meeting["segments"]))
        self.worker.store.soft_delete(meeting["id"])
        self.assertFalse(audio.exists())
        self.assertNotIn(meeting["id"], {item["id"] for item in self.worker.store.list_meetings()})
        with self.worker.store.connect() as db:
            db.execute("DELETE FROM app_meta WHERE key LIKE 'examples_seeded_%'")
        self.assertTrue(self.worker.store.seed_examples())
        self.assertNotIn(meeting["id"], {item["id"] for item in self.worker.store.list_meetings()})

    def test_deleted_meetings_can_be_restored_or_purged_with_files(self):
        meeting = self.worker.start(
            {
                "title": "回收站测试",
                "language": "zh",
                "streaming_model_id": "paraformer-zh-en-int8",
                "refined_model_id": "qwen3-asr-0.6b-int8",
            }
        )
        meeting_dir = self.worker.store.meetings_dir / meeting["id"]
        self.worker.stop({"meeting_id": meeting["id"], "duration_ms": 0})
        self.worker.delete_meeting({"meeting_id": meeting["id"]})
        self.assertEqual(self.worker.store.list_meetings(include_deleted=True)[0]["id"], meeting["id"])
        self.worker.restore_meeting({"meeting_id": meeting["id"]})
        self.assertTrue(meeting_dir.exists())
        self.worker.delete_meeting({"meeting_id": meeting["id"]})
        with self.worker.store.connect() as db:
            db.execute(
                "UPDATE meetings SET deleted_at=? WHERE id=?",
                ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(), meeting["id"]),
            )
        self.assertEqual(self.worker.store.purge_expired(), [meeting["id"]])
        self.assertFalse(meeting_dir.exists())
        with self.assertRaises(ValueError):
            self.worker.store.get_meeting(meeting["id"])


if __name__ == "__main__":
    unittest.main()
