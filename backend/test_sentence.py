"""整句链路的生命周期回归；无需下载识别模型。"""
import base64
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np

from .asr import (
    CUT_OVERLAP_MS,
    DEFAULT_LIVE_MAX_SPEECH_SECONDS,
    SentenceVAD,
    recover_speech_gaps,
    trim_quiet_speech,
)
from .config import SETTINGS
from .worker_common import MULTILINGUAL_MODEL_KINDS, model_supports_language
from .worker_session import SUBTITLE_PARAGRAPH_GAP_MS
from .worker import Worker


class SentenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.events = []
        self.worker = Worker(self.temp.name, self.events.append)
        self.worker.models.is_ready = lambda _: False
        self.vad = Mock(tracks={})
        self.vad.accept.return_value = []
        self.vad.flush.return_value = []
        self.asr = Mock()
        self.asr.decode.return_value = "完整的一句话。"
        self.patches = [patch("backend.worker_session.SentenceVAD", return_value=self.vad),
                        patch("backend.worker_session.RefinedASR", return_value=self.asr)]
        for item in self.patches:
            item.start()
        self.meeting = self.worker.start({"title": "分句测试", "language": "zh"})

    def tearDown(self):
        self.worker._release_active_session()
        self.worker.store.close_audio_sessions()
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def feed(self, start=0, flush=True):
        return self.worker.audio({"meeting_id": self.meeting["id"], "track": "mic",
                                  "pcm": base64.b64encode(bytes(3200)).decode(),
                                  "sample_rate": 16000, "start_ms": start, "flush": flush})

    def finals(self):
        return [event["payload"] for event in self.events if event["type"] == "transcript.final"]

    def test_auto_multilingual_defaults_and_model_compatibility(self):
        with patch("backend.asr._vad_config"):
            automatic = SentenceVAD(self.worker.models, language="auto")
            manual = SentenceVAD(self.worker.models, language="en")
        self.assertEqual(automatic.sentence_gap_ms, 2000)
        self.assertLess(manual.sentence_gap_ms, automatic.sentence_gap_ms)
        # 段长上限不再是一个写死的常数：它取「语言级配置」与「实时配置上限」的较小
        # 值。曾经的 12.0 硬上限让所有模型都被多切 2–4 倍（见 asr.py 注释）。
        self.assertEqual(
            automatic.max_speech_seconds,
            min(SETTINGS["vad"]["default"]["max_speech_duration"], DEFAULT_LIVE_MAX_SPEECH_SECONDS),
        )
        self.assertEqual(automatic.target_seconds, manual.target_seconds)
        # auto（多语言混说）默认落在 parakeet-tdt-0.6b-v3-int8：清单的 default_for_languages
        # 声明。演进过程：曾为 qwen3-asr-0.6b-int8（实测英语会议 14% 窗口输出中文幻觉，
        # 41/287），后为 whisper-large-v3，最终换成 Parakeet TDT——Whisper 在代码转换基准里
        # 排名垫底，因为它会把外语翻译成英语而不是转写（西语仅 1/287 窗口保留）。
        # 见 docs/asr-model-selection-design.md §2.4 / §2.5 / §2.8。
        payload = self.worker._sentence_payload({"title": "mixed"})
        self.assertEqual((payload["language"], payload["refined_model_id"]), ("auto", "parakeet-tdt-0.6b-v3-int8"))
        with self.assertRaisesRegex(ValueError, "Automatic multilingual"):
            self.worker._sentence_payload({"language": "auto", "refined_model_id": "funasr-nano-int8"})
        qwen3 = self.worker._sentence_payload({"language": "auto", "refined_model_id": "qwen3-asr-0.6b-int8"})
        self.assertEqual(qwen3["refined_model_id"], "qwen3-asr-0.6b-int8",
                         "auto 仍须允许显式指定 Qwen3-ASR（多语种模型都可用于混说）")
        with patch("backend.worker_session.RefinedASR", return_value=self.asr) as builder:
            self.worker.reconfigure({"meeting_id": self.meeting["id"], "language": "auto"})
        self.assertEqual(builder.call_args.args[1], "parakeet-tdt-0.6b-v3-int8")
        self.assertEqual(builder.call_args.kwargs["language"], "auto")
        # 混合语种的三段：各自解码一次，再按无长停顿合并成同一段。
        self.asr.decode.side_effect = ["Hello, how are you?", "Muy bien, gracias.", "Let's continue."]
        self.vad.accept.return_value = [(i * 1700, i * 1700 + 1000, np.ones(16000, dtype=np.float32)) for i in range(3)]
        self.feed()
        result = self.worker.stop({"meeting_id": self.meeting["id"], "duration_ms": 3000})
        self.assertEqual(result["language"], "auto")
        # 三段都短于目标长度，也没有长停顿，因此并成同一段；每段仍各自解码一次。
        self.assertEqual([s["text"] for s in result["segments"]],
                         ["Hello, how are you? Muy bien, gracias. Let's continue."])
        self.assertEqual(self.asr.decode.call_count, 3)

    def test_default_refined_model_follows_manifest_language_ownership(self):
        """语言 → 默认模型必须由 models.json 的 default_for_languages 决定。

        这条规则过去在后端 `_default_refined_model` 与前端 `languageModelDefaults` 各写
        一份硬编码，改语言归属要同时改两处。现在只有清单一处实现，前端读同一字段。
        """
        models = self.worker.models
        for language, expected in (
            ("zh", "funasr-nano-int8"),
            ("yue", "funasr-nano-int8"),
            # 英西混说场景：Parakeet TDT 取代 Whisper（混说基准明确优于垫底的 Whisper，
            # 且不会把外语翻译成英语）。设计文档 §2.8。
            ("en", "parakeet-tdt-0.6b-v3-int8"),
            ("es", "parakeet-tdt-0.6b-v3-int8"),
            ("fr", "parakeet-tdt-0.6b-v3-int8"),
            ("de", "parakeet-tdt-0.6b-v3-int8"),
            ("ru", "parakeet-tdt-0.6b-v3-int8"),
            ("auto", "parakeet-tdt-0.6b-v3-int8"),
            ("ja", "qwen3-asr-0.6b-int8"),
            ("ko", "qwen3-asr-0.6b-int8"),
        ):
            self.assertEqual(self.worker._default_refined_model(language), expected,
                             f"unexpected default model for {language}")
        # 未在清单里声明的语言要回落，而不是抛错。
        fallback = self.worker._default_refined_model("xx")
        self.assertIn(fallback, {"funasr-nano-int8", "qwen3-asr-0.6b-int8",
                                 "parakeet-tdt-0.6b-v3-int8"})
        # 退役模型不再参与选型：清单里留着条目只是为了能解析历史 id，本地文件已在启动时清掉。
        for model in models.catalog.values():
            if model.get("retired"):
                for language in ("zh", "en", "es", "ja", "ko", "auto", "xx"):
                    self.assertNotEqual(self.worker._default_refined_model(language), model["id"],
                                        f"retired model {model['id']} must never be selected")
        # 清单里声明的每一项都必须真的支持该语言，否则会推荐出无法使用的模型。
        for model in models.catalog.values():
            for language in model.get("default_for_languages") or []:
                self.assertTrue(
                    model_supports_language(model, language),
                    f"{model['id']} is declared default for unsupported language {language}",
                )
        # auto 下不得把逐语言微调的模型推荐出去。
        self.assertNotEqual(self.worker._default_refined_model("auto"), "funasr-nano-int8")

    def test_language_coverage_matches_manifest_without_wildcards(self):
        """语言覆盖必须与 languages 严格一致，且 multilingual 不能当通配符。

        踩过的坑：给 Parakeet（25 种欧洲语言、不含中日韩）的 languages 里加了
        ``multilingual``，结果 ``model_supports_language`` 判它支持中文——前端于是把
        Parakeet 列进中文会议的识别模型下拉，用户选得出、结果全是垃圾。
        """
        catalog = self.worker.models.catalog
        parakeet = catalog["parakeet-tdt-0.6b-v3-int8"]
        whisper = catalog["whisper-large-v3"]

        for language in ("en", "es", "fr", "de", "ru"):
            self.assertTrue(model_supports_language(parakeet, language), language)
        for language in ("zh", "ja", "ko", "yue"):
            self.assertFalse(model_supports_language(parakeet, language),
                             f"Parakeet must not claim {language}")
        # auto 由 kind 决定，而不是由 languages 里的通配符决定。
        self.assertTrue(model_supports_language(parakeet, "auto"))
        self.assertIn(parakeet["kind"], MULTILINGUAL_MODEL_KINDS)

        # multilingual 通配符不得出现在 languages 里，否则「不支持」无法表达。
        for model in catalog.values():
            self.assertNotIn(
                "multilingual", model.get("languages") or [],
                f"{model['id']} must list concrete language codes, not the 'multilingual' wildcard",
            )

        # Whisper 仍可被选中（用户可自行下载），所以必须声明真实覆盖的语言。
        for language in ("en", "zh", "es", "ja", "ru"):
            self.assertTrue(model_supports_language(whisper, language), language)

        # 每个界面可选的语言都必须能解析出默认模型——否则准备页会出现空的模型下拉。
        for language in ("zh", "yue", "en", "es", "fr", "de", "ru", "ja", "ko", "auto"):
            chosen = self.worker._default_refined_model(language)
            self.assertTrue(model_supports_language(catalog[chosen], language),
                            f"default {chosen} does not support {language}")

    def test_live_segment_cap_never_exceeds_configured_limit(self):
        # 模型容量比配置上限更长时，按配置上限切（实时延迟优先）；模型容量更短时
        # 按模型容量切（否则会越过 KV 容量整段解码为空）。两条都不能反过来。
        with patch("backend.asr._vad_config"):
            tight = SentenceVAD(self.worker.models, language="zh", max_speech_duration=8.0)
            generous = SentenceVAD(self.worker.models, language="zh", max_speech_duration=999.0)
        # 两者都不得越过实时配置上限。
        self.assertLessEqual(tight.max_speech_seconds, DEFAULT_LIVE_MAX_SPEECH_SECONDS)
        self.assertLessEqual(generous.max_speech_seconds, DEFAULT_LIVE_MAX_SPEECH_SECONDS)
        # 模型容量更紧时以模型容量为准（这是 12.0 硬上限当初破坏的语义）。
        self.assertEqual(tight.max_speech_seconds, 8.0)
        self.assertEqual(generous.max_speech_seconds, DEFAULT_LIVE_MAX_SPEECH_SECONDS)
        # 即使语言级配置放宽，也不会超过实时配置上限。
        loose = {**SETTINGS, "vad": {**SETTINGS["vad"], "default": {**SETTINGS["vad"]["default"], "max_speech_duration": 60.0}}}
        with patch("backend.asr._vad_config"), patch("backend.asr.SETTINGS", loose):
            wide = SentenceVAD(self.worker.models, language="zh", max_speech_duration=999.0)
        self.assertEqual(wide.max_speech_seconds, DEFAULT_LIVE_MAX_SPEECH_SECONDS)

    def test_no_partial_then_one_final_per_endpoint(self):
        self.feed()
        self.asr.decode.assert_not_called()
        self.assertFalse(self.finals())
        self.vad.accept.return_value = [(0, 100, np.ones(1600, dtype=np.float32))]
        self.feed(100)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual(len(self.finals()), 1)
        self.assertEqual(self.finals()[0]["speaker"], "local-user")
        self.assertEqual(self.finals()[0]["text"], "完整的一句话。")
        self.assertFalse(any(e["type"] in {"transcript.partial", "transcript.refined"} for e in self.events))
        self.assertEqual(sum(e["type"] == "transcript.settled" for e in self.events), 1)

    def test_vad_endpoints_are_submitted_without_an_extra_merge_delay(self):
        self.vad.accept.side_effect = [
            [(0, 1000, np.ones(16000, dtype=np.float32))],
            [(1200, 2200, np.ones(16000, dtype=np.float32))],
            [],
        ]
        self.feed(0, flush=False)
        self.feed(1600, flush=False)
        self.feed(2700, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual(self.asr.decode.call_count, 2)
        self.assertEqual([len(call.args[0]) for call in self.asr.decode.call_args_list], [16000, 16000])

    def test_subtitles_split_once_and_preserve_text_and_timeline(self):
        text = "收入为60.99亿元。" + "，".join(["如果企业需要扩大规模", "首先应当了解客户的需求", "再评估市场容量和现有产品", "同时考虑员工的工作时间", "合理安排生产计划与设备投入", "并对未来可能出现的风险做好准备", "通过改进技术和提高管理水平", "为客户提供更有价值的服务", "在经营收入持续稳定增长以后", "员工也应得到相应的回报", "这样才能形成健康的长期发展模式"]) + "。"
        self.asr.decode.return_value = text
        self.vad.accept.return_value = [(1000, 21000, np.ones(320000, dtype=np.float32))]
        self.feed()
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        finals = self.finals()
        self.asr.decode.assert_called_once()
        self.assertEqual("".join(item["text"] for item in finals), text)
        self.assertTrue(all(len(item["text"]) <= 100 for item in finals))
        self.assertTrue(finals[0]["text"].startswith("收入为60.99亿元。"))
        self.assertTrue(all(len(item["text"]) >= 40 for item in finals))
        self.assertEqual((finals[0]["start_ms"], finals[-1]["end_ms"]), (1000, 21000))
        self.assertTrue(all(a["end_ms"] == b["start_ms"] for a, b in zip(finals, finals[1:])))
        self.assertEqual(len({item["segment_id"] for item in finals}), len(finals))
        self.assertEqual(len(self.worker.store.get_meeting(self.meeting["id"])["segments"]), len(finals))
        event = {"segment_id": "english", "start_ms": 0, "end_ms": 20000}
        english = "We should preserve complete words and meaningful clauses, " * 10
        parts = list(self.worker._sentence_subtitles(event, english))
        self.assertEqual(" ".join(item["text"] for item in parts).split(), english.split())
        self.assertTrue(all(len(item["text"]) <= 320 for item in parts))

    def test_paragraphs_group_sentences_and_avoid_short_remainders(self):
        event = {"segment_id": "paragraph", "start_ms": 0, "end_ms": 20000}
        mostly_latin = "嗯。 " + "We can discuss the contract and the data model together. " * 3
        self.assertEqual([part["text"] for part in self.worker._sentence_subtitles(event, mostly_latin)], [mostly_latin.strip()])
        text = "各种光伏基地，大风车拔地而起。十五五期间，光是国家电网就要再投四万个亿。哎，你们觉得缺电吗？你们家里多久没停电了？"
        parts = list(self.worker._sentence_subtitles(event, text))
        self.assertEqual([item["text"] for item in parts], [text])
        text = "供" * 60 + "，" + "电" * 90 + "。" + "需" * 10 + "。"
        parts = list(self.worker._sentence_subtitles(event, text))
        self.assertEqual("".join(item["text"] for item in parts), text)
        self.assertTrue(all(60 <= len(item["text"]) <= 150 for item in parts))
        english = "This is the first sentence. This is the second sentence."
        self.assertEqual([item["text"] for item in self.worker._sentence_subtitles(event, english)], [english])
        mixed = "电力需求。 There is demand. More power is needed."
        self.assertEqual([item["text"] for item in self.worker._sentence_subtitles(event, mixed)], [mixed])

    def test_overlap_window_comes_from_the_cut_lookback_not_a_fixed_width(self):
        # 接缝对齐的搜索窗口 = 切点回看时长 × 本段语速；语速从本段自己的字数与时长算，
        # 与估句时间轴同源，因此不会两头各估一次。
        self.assertEqual(self.worker._overlap_chars("一二三四五六七八九十", 2000, 400), 2)
        self.assertEqual(self.worker._overlap_chars("一" * 100, 5000, 400), 8)
        self.assertEqual(self.worker._overlap_chars("一二三四五六七八九十", 2000, 0), 0)
        # 没有重叠时不做对齐拼接：两段只是碰巧共享某个字，不能当成重复删掉。
        self.assertIsNone(self.worker._anchor_splice("各种科学原理。", "与偶然反应电话拨炉。", 0))

    def test_connective_tail_is_joined_to_the_next_sentence(self):
        # 押住尾句的理由（尾字是虚词/连接词）必须同时是接回来的理由，否则等于白押。
        self.assertEqual(
            self.worker._join_pending("观点落在了。", "公司本质是骗局。", None, 0),
            "观点落在了公司本质是骗局。",
        )
        # 有重叠但字面完全对不上、又没有虚词线索时，不发明标点去粘：交给调用方原样提交。
        self.assertIsNone(
            self.worker._join_pending("ジョン大佐って誰ぞ。", "约翰·提托并未出现。", None, 3)
        )

    def test_draft_event_shows_the_paragraph_being_collected(self):
        # 不足目标的段落最多押 8 秒；这段时间界面靠临时行显示已经确认的文本。
        # 它来自一次完成的整句识别，不是逐字改写的流式 partial，
        # 正式段落提交后必须被空文本撤下（否则界面上留一条重复行）。
        self.asr.decode.return_value = "这毫无疑问是技术上的革新。"
        self.vad.accept.return_value = [(0, 2000, np.ones(32000, dtype=np.float32))]
        self.feed(0, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        drafts = [e["payload"] for e in self.events if e["type"] == "transcript.draft"]
        self.assertEqual([item["text"] for item in drafts], ["这毫无疑问是技术上的革新。"])
        self.assertEqual(drafts[-1]["segment_id"], "draft-mic")
        self.assertFalse(self.finals())
        self.worker.stop({"meeting_id": self.meeting["id"], "duration_ms": 2000})
        drafts = [e["payload"] for e in self.events if e["type"] == "transcript.draft"]
        self.assertEqual([item["text"] for item in drafts][-1], "")
        self.assertEqual([item["text"] for item in self.finals()], ["这毫无疑问是技术上的革新。"])

    def test_short_paragraph_accumulates_until_the_target_or_a_long_pause(self):
        # 「一句话一段」的直接来源：短句先攒着，攒够目标、遇到长停顿、或再并就超上限
        # 才提交。VAD 端点不是段落边界——实测真实会议端点后的静音中位数只有 30–50 ms。
        event = {"segment_id": "short", "track": "mic", "start_ms": 0, "end_ms": 3000}
        self.assertEqual(
            list(self.worker._coalesce_subtitles("mic", [{**event, "text": "这毫无疑问是技术上的革新。"}])),
            [],
        )
        self.assertEqual(self.worker.pending_paragraphs["mic"]["text"], "这毫无疑问是技术上的革新。")
        self.assertEqual(
            list(self.worker._coalesce_subtitles(
                "mic", [{**event, "start_ms": 3000, "end_ms": 6000, "text": "所以我们要继续验证这条路线。"}])),
            [],
        )
        self.assertEqual(
            list(self.worker._coalesce_subtitles(
                "mic", [{**event, "start_ms": 6000, "end_ms": 7000, "text": "这不是终点。"}])),
            [],
        )
        # 长停顿（≥ SUBTITLE_PARAGRAPH_GAP_MS）另起一段
        emitted = list(self.worker._coalesce_subtitles(
            "mic", [{**event, "start_ms": 7000 + SUBTITLE_PARAGRAPH_GAP_MS, "end_ms": 9000,
                     "text": "后面这段另起。"}]))
        self.assertEqual([item["text"] for item in emitted],
                         ["这毫无疑问是技术上的革新。所以我们要继续验证这条路线。这不是终点。"])
        self.assertEqual(self.worker.pending_paragraphs["mic"]["text"], "后面这段另起。")

    def test_long_paragraph_is_submitted_once_it_reaches_the_target(self):
        event = {"segment_id": "long", "track": "mic", "start_ms": 0, "end_ms": 3000}
        first = "供" * 70 + "。"
        second = "电" * 70 + "。"
        self.assertEqual(
            list(self.worker._coalesce_subtitles("mic", [{**event, "text": first}])),
            [],
        )
        emitted = list(self.worker._coalesce_subtitles("mic", [{**event, "start_ms": 3000, "text": second}]))
        self.assertEqual([item["text"] for item in emitted], [first + second])

    def test_latin_fragments_keep_a_space_between_words(self):
        # 跨事件拼接时上一段结尾不会带空格，直接相连会得到 "you?Muy" 这种粘在一起的句子。
        self.assertEqual(self.worker._join_text("Hello, how are you?", "Muy bien."),
                         "Hello, how are you? Muy bien.")
        self.assertEqual(self.worker._join_text("电话微波炉的原理", "和LHC类似。"),
                         "电话微波炉的原理和LHC类似。")
        self.assertEqual(self.worker._join_text("", "只有右边。"), "只有右边。")

    def test_length_limits_treat_hangul_and_kana_as_cjk(self):
        """日/韩默认走 qwen3-asr；只统计汉字会把它们的段落上限放大到 280/380。"""
        cjk = (60, 110, 150)
        self.assertEqual(self.worker._length_limits("这是一句中文测试。"), cjk)
        self.assertEqual(self.worker._length_limits("こんにちは、これはテストです。"), cjk)
        self.assertEqual(self.worker._length_limits("안녕하세요 여러분 반갑습니다."), cjk)
        self.assertEqual(self.worker._length_limits("This is an English sentence."), (150, 280, 380))

    def test_unfinished_tail_joins_next_sentence_and_stop_flushes(self):
        # 尾句押住等下一段确认；押住的只是最后一句。整段不足目标长度也没有长停顿，
        # 因此三句并成同一段，在 stop 时一次性提交（文本必须逐字无损）。
        self.asr.decode.side_effect = ["观点落在了。", "公司本质是骗局。它的模式是。", "多层次营销。"]
        self.vad.accept.return_value = [(0, 1000, np.ones(16000, dtype=np.float32)),
                                      (1700, 2700, np.ones(16000, dtype=np.float32)),
                                      (3400, 4400, np.ones(16000, dtype=np.float32))]
        self.feed()
        result = self.worker.stop({"meeting_id": self.meeting["id"], "duration_ms": 3000})
        self.assertEqual([s["text"] for s in result["segments"]],
                         ["观点落在了公司本质是骗局。它的模式是多层次营销。"])
        self.assertEqual("".join(s["text"] for s in result["segments"]),
                         "观点落在了公司本质是骗局。它的模式是多层次营销。")
        self.assertEqual(self.asr.decode.call_count, 3)
        self.assertFalse(self.worker.pending_subtitles)

    def test_unfinished_tail_expires_and_pause_preserves_it(self):
        self.asr.decode.return_value = "它的模式是。"
        self.vad.accept.return_value = [(0, 1000, np.ones(16000, dtype=np.float32))]
        self.feed(flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertFalse(self.finals())
        self.vad.accept.return_value = []
        self.feed(25000)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual([s["text"] for s in self.finals()], ["它的模式是。"])
        self.vad.accept.return_value = [(26000, 27000, np.ones(16000, dtype=np.float32))]
        self.feed(26000)
        self.worker.pause({"meeting_id": self.meeting["id"], "paused": True})
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual(len(self.finals()), 2)
        self.assertFalse(self.worker.pending_subtitles)

    def test_vad_aggregates_short_pauses_without_crossing_limit(self):
        vad = SentenceVAD.__new__(SentenceVAD)
        vad.config = SimpleNamespace(silero_vad=SimpleNamespace(max_speech_duration=22))
        vad.target_seconds, vad.sentence_gap_ms = 8, 700
        state = {"pending": None}
        def segment(start, end):
            return (start, end, np.ones((end - start) * 16, dtype=np.float32))
        self.assertEqual(vad._collect(state, [segment(0, 4000)]), [])
        out = vad._collect(state, [segment(4100, 8500)])
        self.assertEqual(out[0][:2], (0, 8500))
        self.assertEqual(len(out[0][2]), 8500 * 16)
        self.assertIsNone(state["pending"])
        vad._collect(state, [segment(9000, 12000)])
        out = vad._collect(state, [segment(13000, 16000)])
        self.assertEqual(out[0][:2], (9000, 12000))
        out = vad._collect(state, [segment(16100, 37000)])
        self.assertEqual([item[:2] for item in out], [(13000, 16000), (16100, 37000)])

    def test_continuous_speech_hard_cap_preserves_every_sample_with_bounded_overlap(self):
        class Detector:
            def __init__(self, *_):
                self.samples, self.ready = [], False
            def accept_waveform(self, samples):
                self.samples.extend(samples)
            def is_speech_detected(self):
                return bool(self.samples)
            def empty(self):
                return not self.ready
            def flush(self):
                self.ready = bool(self.samples)
            @property
            def current_segment(self):
                return SimpleNamespace(start=0)
            @property
            def front(self):
                return SimpleNamespace(start=0, samples=self.samples)
            def pop(self):
                self.ready = False
            def reset(self):
                self.samples = []
        vad = SentenceVAD.__new__(SentenceVAD)
        vad.config = SimpleNamespace(silero_vad=SimpleNamespace(max_speech_duration=0.668))
        vad.sherpa_onnx = SimpleNamespace(VoiceActivityDetector=Detector)
        vad.max_speech_seconds, vad.speech_pad_ms, vad.target_seconds = 1, 300, 8
        vad.tracks = {}
        samples = np.arange(48000, dtype=np.float32)
        out = vad.accept("mic", samples, 5000) + vad.flush("mic")
        pad = max(vad.speech_pad_ms, CUT_OVERLAP_MS) * 16
        self.assertEqual((out[0][0], out[-1][1]), (5000, 8000))
        # 段长上限 = 模型能承载的最长语音段 + 切点回看。
        self.assertTrue(all(len(item[2]) <= 16000 + pad for item in out))
        # 段与段之间只能重叠切点回看的那一段：不漏样本（负值）也不多交付。
        for previous, current in zip(out, out[1:]):
            self.assertTrue(0 <= previous[1] - current[0] <= pad // 16,
                            f"{previous[:2]} -> {current[:2]} 的重叠超出回看长度")
        # 把每段开头的回看重叠剪掉后，应当恰好还原原始音频（丢样本会在这里暴露）。
        rebuilt = np.concatenate([
            out[0][2],
            *[item[2][(out[index][1] - item[0]) * 16:] for index, item in enumerate(out[1:])],
        ])
        np.testing.assert_array_equal(rebuilt, samples)

    def test_vad_padding_cannot_repeat_previous_audio(self):
        vad = SentenceVAD.__new__(SentenceVAD)
        state = {"pad_samples": 4800, "hist_total": 16000, "hist_from": 0,
                 "hist": [np.arange(16000, dtype=np.float32)], "delivered_until": 8000}
        np.testing.assert_array_equal(vad._history_prefix(state, 9000), np.arange(8000, 9000))
        self.assertIsNone(vad._history_prefix(state, 8000))

    def test_stop_drains_disk_queue_and_flushes_last_sentence(self):
        entered, release = threading.Event(), threading.Event()
        def decode(*_):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test decode timed out")
            return "完整的一句话。"
        self.asr.decode.side_effect = decode
        self.vad.accept.return_value = [(0, 100, np.ones(1600, dtype=np.float32))]
        self.feed()
        self.assertTrue(entered.wait(2))
        self.vad.tracks = {"mic": {}}
        self.vad.flush.return_value = [(100, 200, np.ones(1600, dtype=np.float32))]
        results = []
        stop = threading.Thread(target=lambda: results.append(self.worker.stop({"meeting_id": self.meeting["id"], "duration_ms": 200})))
        stop.start()
        try:
            self.assertTrue(list(Path(self.temp.name).rglob("sentence-*.npy")))
        finally:
            release.set()
            stop.join(5)
        self.assertFalse(stop.is_alive(), "stop must not deadlock on the recording lock")
        self.assertEqual(len(results[0]["segments"]), 2)
        self.assertEqual(len(self.finals()), 2)
        self.assertFalse(list(Path(self.temp.name).rglob("sentence-*.npy")))
        self.assertEqual(self.events[-1]["type"], "meeting.stopped")

    def test_decode_failure_keeps_audio_and_does_not_drop_following_sentence(self):
        self.asr.decode.side_effect = [RuntimeError("model failed"), "后一句。"]
        self.vad.accept.return_value = [(0, 50, np.ones(800, dtype=np.float32)), (700, 750, np.ones(800, dtype=np.float32))]
        self.feed(flush=False)
        result = self.worker.stop({"meeting_id": self.meeting["id"], "duration_ms": 100})
        self.assertEqual([s["text"] for s in result["segments"]], ["后一句。"])
        self.assertTrue(result["audio"]["mic"])
        self.assertTrue(any(e["payload"].get("code") == "sentence_transcription_failed" for e in self.events))
        self.assertFalse(list(Path(self.temp.name).rglob("sentence-*.npy")))

    def test_flush_payload_processes_its_audio_before_flushing(self):
        self.feed(flush=True)
        self.vad.accept.assert_called_once()
        self.assertEqual(len(self.vad.accept.call_args.args[1]), 1600)

    def test_pause_promotes_a_held_tail_into_a_final_too(self):
        # 押住的悬空尾句同样只有临时行；暂停后必须一并排空成正式段落，不能卡在临时行上。
        self.asr.decode.side_effect = ["前面的完整句子。后面这句还没说完。", ""]
        self.vad.accept.return_value = [(0, 2000, np.ones(32000, dtype=np.float32), "cut")]
        self.feed(0, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertFalse(self.finals())
        self.assertEqual(len(self.worker.pending_subtitles), 1)
        drafts = [e["payload"] for e in self.events if e["type"] == "transcript.draft"]
        self.assertTrue(drafts and drafts[-1]["text"])
        self.worker.pause({"meeting_id": self.meeting["id"], "paused": True})
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertFalse(self.worker.pending_subtitles)
        self.assertFalse(self.worker.pending_paragraphs)
        self.assertEqual([item["text"] for item in self.finals()],
                         ["前面的完整句子。", "后面这句还没说完。"])
        drafts = [e["payload"] for e in self.events if e["type"] == "transcript.draft"]
        self.assertEqual(drafts[-1]["text"], "")

    def test_pause_promotes_the_last_draft_into_a_final(self):
        # 不足目标的段落只有临时行、没有正式段落；暂停后它必须被排空成正式段落，
        # 而不是永远停在临时行上。
        self.asr.decode.return_value = "这毫无疑问是技术上的革新。"
        self.vad.accept.return_value = [(0, 2000, np.ones(32000, dtype=np.float32))]
        self.feed(0, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertFalse(self.finals())
        drafts = [e["payload"] for e in self.events if e["type"] == "transcript.draft"]
        self.assertTrue(drafts and drafts[-1]["text"])
        self.worker.pause({"meeting_id": self.meeting["id"], "paused": True})
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual([item["text"] for item in self.finals()], ["这毫无疑问是技术上的革新。"])
        drafts = [e["payload"] for e in self.events if e["type"] == "transcript.draft"]
        self.assertEqual(drafts[-1]["text"], "")

    def test_pause_flushes_without_ending_recording(self):
        self.vad.tracks = {"mic": {}}
        self.vad.flush.return_value = [(0, 100, np.ones(1600, dtype=np.float32))]
        self.worker.pause({"meeting_id": self.meeting["id"], "paused": True})
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual(len(self.finals()), 1)
        self.assertEqual(self.worker.active, self.meeting["id"])

    def test_reconfigure_keeps_queued_old_model_and_switches_future_segments(self):
        old = self.asr
        self.vad.tracks = {"mic": {}}
        self.vad.flush.return_value = [(0, 100, np.ones(1600, dtype=np.float32))]
        new = Mock()
        new.decode.return_value = "New sentence."
        with patch("backend.worker_session.RefinedASR", return_value=new):
            self.worker.reconfigure({"meeting_id": self.meeting["id"], "language": "en"})
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        old.decode.assert_called_once()
        self.assertIs(self.worker.asr, new)
        self.assertEqual(self.worker.meeting_language, "en")

    def test_failed_reconfigure_does_not_touch_active_model_or_language(self):
        with patch("backend.worker_session.RefinedASR", side_effect=RuntimeError("not installed")):
            with self.assertRaisesRegex(RuntimeError, "not installed"):
                self.worker.reconfigure({"meeting_id": self.meeting["id"], "language": "en"})
        self.assertIs(self.worker.asr, self.asr)
        self.assertEqual(self.worker.store.get_meeting(self.meeting["id"])["language"], "zh")
        self.vad.flush.assert_not_called()

    def test_retired_models_are_not_required(self):
        self.assertTrue(self.worker.models.is_known(self.meeting["refined_model_id"]))
        self.assertFalse(any(set(m["stages"]) & {"streaming", "punctuation"} for m in self.worker.models.catalog.values()))

    def test_invalid_audio_is_rejected_before_persistence(self):
        with self.assertRaisesRegex(ValueError, "16 kHz"):
            self.worker.audio({"meeting_id": self.meeting["id"], "track": "mic", "pcm": "", "sample_rate": 8000, "start_ms": 0})
        self.assertFalse(self.worker.store.read_manifest(self.meeting["id"])["tracks"])

    def test_vad_discontinuity_and_flush_keep_absolute_timestamps(self):
        class Detector:
            def __init__(self, *_):
                self.samples = []
                self.ready = False
            def accept_waveform(self, samples):
                self.samples.extend(samples)
            def is_speech_detected(self):
                return False
            def empty(self):
                return not self.ready
            def flush(self):
                self.ready = bool(self.samples)
            @property
            def front(self):
                return SimpleNamespace(start=0, samples=self.samples)
            def pop(self):
                self.ready = False
        vad = SentenceVAD.__new__(SentenceVAD)
        vad.config = SimpleNamespace(silero_vad=SimpleNamespace(max_speech_duration=20))
        vad.sherpa_onnx = SimpleNamespace(VoiceActivityDetector=Detector)
        vad.tracks = {}
        samples = np.ones(1600, dtype=np.float32)
        self.assertEqual(vad.accept("mic", samples, 5000), [])
        self.assertEqual(vad.accept("mic", samples, 5100), [])
        first = vad.accept("mic", samples, 9000)
        self.assertEqual(first[0][:2], (5000, 5200))
        self.assertEqual(len(first[0][2]), 3200)
        self.assertEqual(vad.flush("mic")[0][:2], (9000, 9100))
        self.assertEqual(vad.flush("mic"), [])
        # sherpa 的原生最大时长是软端点；外层硬上限不能丢样本或破坏时钟。
    def test_vad_speech_cap_tracks_recognizer_ceiling(self):
        # 语言级 30 s 上限超过 FunASR Nano 容量时，会话按识别模型上限切段，
        # 避免连续独白切出的长段超过 KV 容量整段解码为空（漏识别）。
        self.asr.max_speech_seconds = 22.0
        with patch("backend.worker_session.SentenceVAD") as builder:
            builder.return_value = self.vad
            self.worker.reconfigure({"meeting_id": self.meeting["id"], "language": "en"})
        kwargs = builder.call_args.kwargs
        self.assertEqual(kwargs["max_speech_duration"], 22.0)

    def test_sentence_pad_recovers_segment_onset(self):
        # 在检测到的段起点前回补原始音频：检测/采集的句首抖动不再切掉首字。
        class Detector:
            def __init__(self, *_):
                self.fed = 0
                self.parts = []
                self.segment = None

            def accept_waveform(self, samples):
                self.parts.append(samples)
                self.fed += len(samples)
                if self.fed >= 16384 and self.segment is None:
                    audio = np.concatenate(self.parts)
                    self.segment = SimpleNamespace(
                        start=8192, samples=audio[8192:16384].copy()
                    )

            def is_speech_detected(self):
                return False

            def empty(self):
                return self.segment is None

            def flush(self):
                pass

            @property
            def front(self):
                return self.segment

            def pop(self):
                self.segment = None

            def reset(self):
                self.segment = None

        fed = (np.arange(16384, dtype=np.float32) % 97) / 97.0
        # 段首回补长度取 speech_pad_ms 与切点回看（CUT_OVERLAP_MS）的较大值：两者
        # 共用同一段历史缓冲，回看要够长才能把切点上的字带进下一段。
        for pad in (0, 300, 600):
            effective = max(pad, CUT_OVERLAP_MS)
            vad = SentenceVAD.__new__(SentenceVAD)
            vad.config = SimpleNamespace(silero_vad=SimpleNamespace(max_speech_duration=60))
            vad.sherpa_onnx = SimpleNamespace(VoiceActivityDetector=Detector)
            vad.speech_pad_ms = pad
            vad.cut_overlap_ms = CUT_OVERLAP_MS
            vad.tracks = {}
            out = vad.accept("mic", fed, 0)
            self.assertEqual(len(out), 1)
            start_ms, end_ms, samples, boundary = out[0]
            self.assertEqual(boundary, "cut")
            # 段前回补（不超过已喂入的历史），并保留原段全部样本。
            back = min(effective * 16, 8192)
            self.assertEqual((start_ms, end_ms), ((8192 - back) // 16, 1024))
            self.assertEqual(len(samples), 8192 + back)
            np.testing.assert_array_equal(samples[:back], fed[8192 - back:8192])
            np.testing.assert_array_equal(samples[back:], fed[8192:16384])


    def test_cut_boundary_defers_the_period_until_the_next_segment(self):
        # 硬上限切出来的段落，末尾句号只是临时判断：押着不提交，下一段接上来时
        # 改成逗号连接（VAD 确实听到停顿，但这句话没说完）。
        self.asr.decode.side_effect = ["一五年的财政收入下降了百分之四十。", "G D P的增速逐年放缓。"]
        self.vad.accept.side_effect = [
            [(0, 1000, np.ones(16000, dtype=np.float32), "pause")],
            [(1000, 2000, np.ones(16000, dtype=np.float32), "endpoint")],
        ]
        self.feed(0, flush=False)
        self.feed(1000, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        # 不足目标长度、又没有长停顿：先押住，排空后一次提交。
        self.assertFalse(self.finals())
        self.worker._flush_subtitle_tails()
        self.assertEqual(
            [item["text"] for item in self.finals()],
            ["15年的财政收入下降了40%，G D P的增速逐年放缓。"],
        )

    def test_deferred_cut_boundary_is_released_unchanged_without_continuation(self):
        self.asr.decode.return_value = "一五年的财政收入下降了百分之四十。"
        self.vad.accept.side_effect = [[(0, 1000, np.ones(16000, dtype=np.float32), "pause")]]
        self.feed(0, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertFalse(self.finals())
        self.worker._flush_subtitle_tails()
        self.assertEqual([item["text"] for item in self.finals()], ["15年的财政收入下降了40%。"])

    def test_semantic_endpoint_keeps_its_own_punctuation(self):
        # 语义端点（停顿 + Smart Turn 确认）的句末标点是可信的：不押尾句、不改成逗号。
        # 段落长度仍按目标/长停顿决定，与端点无关。
        self.asr.decode.return_value = "一五年的财政收入下降了百分之四十。"
        self.vad.accept.side_effect = [[(0, 1000, np.ones(16000, dtype=np.float32), "endpoint")]]
        self.feed(0, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.worker._flush_subtitle_tails()
        self.assertEqual([item["text"] for item in self.finals()], ["15年的财政收入下降了40%。"])

    def test_tail_holds_only_the_last_sentence_of_a_cut_chunk(self):
        # 连续语音被切开时，最后一句押住等下一段；前面的完整句子也不单独成段，
        # 而是留着和下一段并成一条（见 _coalesce_subtitles），避免一句话一段。
        self.asr.decode.side_effect = ["绝望乡。约翰乘坐时间机器来到2010年。", "目的是改变未来。"]
        self.vad.accept.side_effect = [
            [(0, 2000, np.ones(32000, dtype=np.float32), "pause")],
            [(2000, 3000, np.ones(16000, dtype=np.float32), "endpoint")],
        ]
        self.feed(0, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.assertEqual([item["text"] for item in self.finals()], [])
        self.feed(2000, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.worker._flush_subtitle_tails()
        self.assertEqual([item["text"] for item in self.finals()],
                         ["绝望乡。约翰乘坐时间机器来到2010年，目的是改变未来。"])

    def test_cut_seam_drops_the_word_decoded_twice(self):
        # 硬上限把「未来」切成两段：前段补了一个句号，后段从「来」重新开始。
        self.asr.decode.side_effect = ["以此改变未来。", "来，有些网友不理解。"]
        self.vad.accept.side_effect = [
            [(0, 1000, np.ones(16000, dtype=np.float32), "cut")],
            [(1000, 2000, np.ones(16000, dtype=np.float32), "endpoint")],
        ]
        self.feed(0, flush=False)
        self.feed(1000, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.worker._flush_subtitle_tails()
        self.assertEqual([item["text"] for item in self.finals()],
                         ["以此改变未来，有些网友不理解。"])

    def test_cross_language_seam_keeps_its_own_sentence(self):
        # 兜底识别的日文台词后面接中文旁白：两句话各自成立，不能连成一句。
        # 两句可以并进同一条字幕（长度远不到目标），但各自保留自己的句末标点。
        self.asr.decode.side_effect = ["ジョン大佐って誰ぞ。", "约翰·提托并未出现。"]
        self.vad.accept.side_effect = [
            [(56000, 60600, np.ones(73600, dtype=np.float32), "cut")],
            [(60900, 67000, np.ones(97600, dtype=np.float32), "endpoint")],
        ]
        self.feed(56000, flush=False)
        self.feed(60900, flush=False)
        self.worker.live_postprocessing.submit(lambda: None).result(2)
        self.worker._flush_subtitle_tails()
        self.assertEqual([item["text"] for item in self.finals()],
                         ["ジョン大佐って誰ぞ。约翰·提托并未出现。"])


class QuietSpeechRecoveryTest(unittest.TestCase):
    """检测器整段漏判的安静语音（音乐里的轻声、电话音）不再凭空消失。"""

    def setUp(self):
        self.vad = SentenceVAD.__new__(SentenceVAD)
        self.vad.speech_pad_ms = 0
        self.vad.recover_enabled = True
        self.vad.recover_min_seconds = 1.0
        self.vad.recover_max_seconds = 20.0
        self.vad.recover_level_ratio = 0.08
        self.state = {"origin_ms": 0, "samples": 0, "speech_start": None,
                      "speech_seen": False, "speech_level": 0.0, "idle": [], "idle_total": 0,
                      "idle_after_speech": False}
        self.completed = []
        self.speech = np.full(512, 0.2, dtype=np.float32)
        self.quiet = np.full(512, 0.02, dtype=np.float32)
        self.silence = np.full(512, 0.0005, dtype=np.float32)

    def feed(self, chunk, in_speech, seconds):
        for _ in range(round(seconds * 16000 / len(chunk))):
            self.state["samples"] += len(chunk)
            self.vad._track_quiet_audio(self.state, chunk, in_speech, self.completed)

    def reopen_speech(self):
        # 检测器攒够判决窗口才说「有语音」，onset 落在当前喂入位置之前 0.5 秒。
        self.state["speech_start"] = self.state["samples"] - 8000

    def test_quiet_hole_between_speech_is_delivered(self):
        self.feed(self.speech, True, 2.0)
        self.feed(self.quiet, False, 3.0)
        self.reopen_speech()
        self.feed(self.speech, True, 1.0)
        self.assertEqual(len(self.completed), 1)
        start_ms, end_ms, samples, boundary = self.completed[0]
        self.assertEqual(boundary, "cut")
        # 空洞 2.0-5.0s，去掉重新起播的 0.5 秒后交给识别器。
        self.assertAlmostEqual(start_ms, 2000, delta=120)
        self.assertAlmostEqual(end_ms, 4500, delta=120)
        self.assertAlmostEqual(len(samples) / 16, end_ms - start_ms, delta=2)

    def test_hole_without_speech_before_it_is_ignored(self):
        self.feed(self.quiet, False, 3.0)
        self.reopen_speech()
        self.feed(self.speech, True, 1.0)
        self.assertFalse(self.completed)

    def test_silent_and_short_holes_are_ignored(self):
        self.feed(self.speech, True, 2.0)
        self.feed(self.silence, False, 3.0)
        self.reopen_speech()
        self.feed(self.speech, True, 1.0)
        self.assertFalse(self.completed)
        self.feed(self.quiet, False, 0.5)
        self.reopen_speech()
        self.feed(self.speech, True, 1.0)
        self.assertFalse(self.completed)

    def test_recovery_can_be_disabled(self):
        self.vad.recover_enabled = False
        self.feed(self.speech, True, 2.0)
        self.feed(self.quiet, False, 3.0)
        self.reopen_speech()
        self.feed(self.speech, True, 1.0)
        self.assertFalse(self.completed)


class OfflineQuietSpeechRecoveryTest(unittest.TestCase):
    """会后精修用同一份判据找回检测器漏判的安静语音。"""

    @staticmethod
    def audio(seconds, level):
        return np.full(round(seconds * 16000), level, dtype=np.float32)

    def setUp(self):
        # 4 秒正常音量语音 + 2 秒安静语音（检测器漏判）+ 4 秒正常音量语音。
        self.samples = np.concatenate([self.audio(4, 0.2), self.audio(2, 0.02), self.audio(4, 0.2)])

    def read_window(self, start_ms, end_ms):
        return self.samples[round(start_ms * 16) : round(end_ms * 16)]

    def test_gap_between_speech_regions_is_recovered(self):
        recovered = recover_speech_gaps(
            [{"start_ms": 0, "end_ms": 4000}, {"start_ms": 6000, "end_ms": 10000}],
            self.read_window,
        )
        # 空洞末尾留出段首回补的 300ms，交给正常段落。
        self.assertEqual(recovered, [{"start_ms": 4000, "end_ms": 5700}])

    def test_hole_without_energy_or_without_length_is_ignored(self):
        self.samples = np.concatenate([self.audio(4, 0.2), self.audio(2, 0.0005), self.audio(4, 0.2)])
        self.assertEqual(
            recover_speech_gaps(
                [{"start_ms": 0, "end_ms": 4000}, {"start_ms": 6000, "end_ms": 10000}],
                self.read_window,
            ),
            [],
        )
        self.assertEqual(
            recover_speech_gaps(
                [{"start_ms": 0, "end_ms": 4000}, {"start_ms": 4500, "end_ms": 10000}],
                self.read_window,
            ),
            [],
        )

    def test_holes_at_the_recording_edges_are_not_recovered(self):
        self.assertEqual(
            recover_speech_gaps([{"start_ms": 0, "end_ms": 4000}], self.read_window), []
        )

    def test_trim_quiet_speech_keeps_a_margin_around_the_speech(self):
        samples = np.concatenate([self.audio(1, 0.0005), self.audio(2, 0.02), self.audio(1, 0.0005)])
        start_ms, end_ms, audio = trim_quiet_speech(samples, 0, 4000, 0.2, 1.0, 0.08)
        self.assertAlmostEqual(start_ms, 900, delta=70)
        self.assertAlmostEqual(end_ms, 3100, delta=70)
        self.assertAlmostEqual(len(audio) / 16, end_ms - start_ms, delta=2)


if __name__ == "__main__":
    unittest.main()
