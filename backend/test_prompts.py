import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from .prompt_preferences import DEFAULTS, PromptPreferences
from .worker import Worker
from .worker_common import UserFacingError


class PromptsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.worker = Worker(self.root, output=lambda _: None)
        self.addCleanup(self.worker.shutdown_sidecars)
        self.addCleanup(self.worker.store.close_audio_sessions)

    def test_persistence_reset_corruption_and_validation(self):
        prompts = self.worker.prompts
        self.assertEqual(prompts.get(), DEFAULTS)
        self.assertEqual(
            prompts.apply('translation', 'Original exact prompt'), 'Original exact prompt'
        )
        custom = {'summary': 'Risks', 'ai_note': 'Dates', 'translation': 'Plain language'}
        self.assertEqual(prompts.save(custom), custom)
        self.assertEqual(PromptPreferences(self.root).get(), custom)
        for bad in (
            {'summary': 'missing fields'},
            {**custom, 'summary': 'x' * 4001},
            {**custom, 'extra': ''},
        ):
            with self.assertRaises(UserFacingError):
                prompts.save(bad)
        self.assertEqual(prompts.get(), custom)
        self.assertEqual(prompts.save({**custom, 'summary': '😀' * 2000})['summary'], '😀' * 2000)
        with self.assertRaises(UserFacingError):
            prompts.save({**custom, 'summary': '😀' * 2001})
        self.assertEqual(prompts.save(DEFAULTS), DEFAULTS)
        self.assertEqual(prompts.apply('ai_note', 'Original exact prompt'), 'Original exact prompt')
        prompts.file.write_text('{bad')
        with self.assertRaises(UserFacingError) as caught:
            prompts.get()
        self.assertEqual(caught.exception.code, 'invalid_prompts')
        self.assertEqual(prompts.file.read_text(), '{bad')
        self.assertFalse(list(self.root.glob('prompts.*.tmp')))

    def test_saved_preferences_reach_summary_live_and_agent_translation(self):
        worker = self.worker
        worker.llama_generate = Mock(return_value='Translated')
        worker.translate_text('hello', 'zh')
        self.assertEqual(worker.llama_generate.call_args.kwargs['context_size'], 4096)
        self.assertNotIn('user_preferences', worker.llama_generate.call_args.args[2])
        custom = {
            'summary': 'CUSTOM SUMMARY',
            'ai_note': 'CUSTOM LIVE',
            'translation': 'CUSTOM TRANSLATION',
        }
        handlers = worker._command_handlers()
        self.assertEqual(handlers['prompts.save'](custom), custom)
        self.assertEqual(handlers['prompts.get']({}), custom)
        result = worker.agent_run(
            {
                'meeting_id': str(uuid4()),
                'operation': 'translate',
                'text': 'hello',
                'target_language': 'zh',
                'output_path': str(self.root / 'result.json'),
            }
        )
        self.assertEqual(
            json.loads(Path(result['output_path']).read_text())['segments'][0]['translation'],
            'Translated',
        )
        prompt = worker.llama_generate.call_args.args[2]
        self.assertIn('Translate the following text into Chinese', prompt)
        self.assertIn(custom['translation'], prompt)
        self.assertEqual(worker.llama_generate.call_args.kwargs['context_size'], 16384)
        worker._complete(
            {'provider': 'builtin', 'model': 'local'}, 'Original Markdown with [[action:S1]]'
        )
        prompt = worker.llama_generate.call_args.args[2]
        self.assertIn('[[action:S1]]', prompt)
        self.assertIn(custom['summary'], prompt)
        worker.llama_generate_realtime = Mock(return_value='{"type":"none"}')
        session = SimpleNamespace(
            connection={'provider': 'builtin', 'model': 'local'}, cancellation=threading.Event()
        )
        worker._ai_note_complete(session, 'Return JSON only; use evidence from S1')
        prompt = worker.llama_generate_realtime.call_args.args[1]
        self.assertIn('Return JSON only; use evidence from S1', prompt)
        self.assertIn(custom['ai_note'], prompt)
        self.assertIn(
            'original output format, JSON schema, source/evidence markers and requested language remain mandatory',
            prompt,
        )
        self.assertEqual(worker.llama_generate_realtime.call_args.kwargs['context_size'], 16384)
        worker.prompts.save(DEFAULTS)
        worker._ai_note_complete(session, 'Return JSON only')
        self.assertEqual(worker.llama_generate_realtime.call_args.args[1], 'Return JSON only')
        self.assertNotIn('context_size', worker.llama_generate_realtime.call_args.kwargs)


if __name__ == '__main__':
    unittest.main()
