import base64
import io
import tempfile
import unittest
import wave
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .asr import EnglishPunctuation, SpeakerTracker
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
        self.assertTrue(self.worker.store.read_manifest(meeting["id"])["closed"])

    def test_summary_requires_valid_evidence(self):
        with self.assertRaises(ValueError):
            self.worker._validate_summary(
                {
                    "summary": "摘要",
                    "decisions": [{"text": "决定", "evidence_segment_ids": ["missing"]}],
                    "action_items": [],
                    "open_questions": [],
                },
                {"seg-1"},
            )

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
        self.worker._call_llm = lambda *_args, **_kwargs: "Hello"
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
        tracker.centers = []
        tracker.counts = []
        tracker.last_speaker = None
        self.assertEqual(tracker.assign_embedding([1.0, 0.0]), "spk-1")
        self.assertEqual(tracker.assign_embedding([0.9, 0.1]), "spk-1")
        self.assertEqual(tracker.assign_embedding([0.0, 1.0]), "spk-2")
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

    def test_auto_language_detection(self):
        self.assertEqual(Worker._detect_language("how are you doing today"), "en")
        self.assertEqual(Worker._detect_language("我们今天讨论产品计划"), "zh")

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
