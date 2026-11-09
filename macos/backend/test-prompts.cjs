const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { PromptPreferences } = require('./prompts.cjs');
const { Worker } = require('./worker.cjs');
const defaults = { summary: '', ai_note: '', translation: '' };
test('prompt preferences persist atomically, reset to defaults and reject corrupt or oversized data', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-prompts-')),
    preferences = new PromptPreferences(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(preferences.get(), defaults);
  assert.equal(preferences.apply('summary', 'Original exact prompt'), 'Original exact prompt');
  const custom = {
    summary: 'Focus on risks',
    ai_note: 'Find deadlines',
    translation: 'Use plain language',
  };
  assert.deepEqual(preferences.save(custom), custom);
  assert.deepEqual(new PromptPreferences(root).get(), custom);
  assert.throws(() => preferences.save({ ...custom, summary: 'a'.repeat(4001) }), {
    code: 'invalid_prompts',
  });
  assert.deepEqual(preferences.get(), custom);
  assert.equal(preferences.save({ ...custom, summary: '😀'.repeat(2000) }).summary.length, 4000);
  assert.throws(() => preferences.save({ ...custom, summary: '😀'.repeat(2001) }), {
    code: 'invalid_prompts',
  });
  assert.deepEqual(preferences.save(defaults), defaults);
  assert.equal(
    preferences.apply('translation', 'Translate into English'),
    'Translate into English',
  );
  fs.writeFileSync(path.join(root, 'prompts.json'), '{bad');
  assert.throws(() => preferences.get(), { code: 'invalid_prompts' });
  assert.equal(fs.readFileSync(path.join(root, 'prompts.json'), 'utf8'), '{bad');
  assert.ok(fs.readdirSync(root).every((name) => !name.endsWith('.tmp')));
});
test('all native prompt consumers include saved instructions while retaining their original contracts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-prompts-')),
    requests = [];
  fs.writeFileSync(path.join(root, 'model.gguf'), 'fixture');
  const worker = new Worker(root, {
    output: () => {},
    engineFactory: () => ({
      request: async (type, payload) => {
        if (type === 'llama.generate') {
          requests.push(payload);
          return {
            text: payload.prompt.includes('<recent_transcript>')
              ? '{"type":"none"}'
              : payload.prompt.includes('<transcript>')
                ? [...payload.prompt.matchAll(/^## .+$/gm)]
                    .map(([heading]) => heading + '\n- Launch confirmed [[decision:S1]]')
                    .join('\n')
                : '# Notes\n- Launch confirmed',
          };
        }
        return {};
      },
      close() {},
    }),
  });
  t.after(async () => {
    await worker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await worker.initialization;
  worker.models.isReady = () => true;
  worker.models.path = () => root;
  await worker.translateText('hello', 'zh');
  assert.equal(requests.at(-1).context_size, 4096);
  assert.doesNotMatch(requests.at(-1).prompt, /user_preferences/);
  const custom = {
    summary: 'CUSTOM SUMMARY',
    ai_note: 'CUSTOM LIVE',
    translation: 'CUSTOM TRANSLATION',
  };
  worker.handlers['prompts.save'](custom);
  assert.deepEqual(worker.handlers['prompts.get']({}), custom);
  await worker.handlers['agent.run']({
    meeting_id: randomUUID(),
    operation: 'translate',
    text: 'hello',
    target_language: 'zh',
    output_path: path.join(root, 'result.txt'),
  });
  assert.match(requests.at(-1).prompt, /Translate the following text into Chinese/);
  assert.match(requests.at(-1).prompt, /CUSTOM TRANSLATION/);
  assert.equal(requests.at(-1).context_size, 16384);
  const meeting = worker.store.createMeeting({
    title: 'Test',
    language: 'en',
    refined_model_id: 'funasr-nano-int8',
  });
  worker.store.saveSegment({
    meeting_id: meeting.id,
    segment_id: 'one',
    text: 'Launch confirmed',
    start_ms: 0,
    end_ms: 1000,
  });
  await worker.handlers['summary.generate']({
    meeting_id: meeting.id,
    provider: 'builtin',
    model: 'hy-mt2-1.8b-q4km',
    consent: true,
  });
  assert.match(requests.at(-1).prompt, /CUSTOM SUMMARY/);
  assert.match(requests.at(-1).prompt, /S1 \[/);
  worker.handlers['ai-note.start']({
    meeting_id: meeting.id,
    provider: 'builtin',
    model: 'hy-mt2-1.8b-q4km',
    proactivity: 'quiet',
    prompt: { instructions: 'Return JSON only' },
  });
  worker.handlers['ai-note.request']({ meeting_id: meeting.id });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(requests.at(-1).prompt, /CUSTOM LIVE/);
  assert.match(requests.at(-1).prompt, /Return JSON only/);
  assert.match(
    requests.at(-1).prompt,
    /original output format, JSON schema, source\/evidence markers and requested language remain mandatory/,
  );
  await worker.shutdownAiNote();
});
