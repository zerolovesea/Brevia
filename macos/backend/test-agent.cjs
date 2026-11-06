const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('./worker.cjs');
const { TaskControl } = require('./tasks.cjs');
const { parseSubtitles, render, writeResult } = require('./worker-agent.cjs');
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-pipeline-'));
  const worker = new Worker(root, { output: () => {} });
  await worker.initialization;
  t.after(async () => {
    await worker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    worker,
    run: (p) => worker.handlers['agent.run']({ meeting_id: randomUUID(), ...p }),
  };
}
test('diarization text and subtitle exports preserve speaker labels without changing transcription', () => {
  const result = {
    operation: 'diarize',
    segments: [
      { start_ms: 0, end_ms: 1000, text: 'Hello', speaker: 'Alice' },
      { start_ms: 1000, end_ms: 2000, text: 'Hi', speaker: '' },
    ],
  };
  for (const format of ['txt', 'md', 'srt', 'vtt']) {
    const output = render(result, format);
    assert.ok(output.includes('[Alice] Hello'));
    assert.ok(output.includes('[Unknown speaker] Hi'));
    assert.ok(!render({ ...result, operation: 'transcribe' }, format).includes('[Alice]'));
  }
  assert.deepEqual(JSON.parse(render(result, 'json')), result);
});
test('subtitle translation preserves timestamps, original and writes actual VTT path', async (t) => {
  const { root, worker, run } = await setup(t);
  const source = '1\n00:00:01,250 --> 00:00:03,000\nHello world\n';
  const input_path = path.join(root, 'in.srt'),
    output_path = path.join(root, 'out.vtt');
  fs.writeFileSync(input_path, source);
  worker.translateText = async (text) => '译文 ' + text;
  const result = await run({
    operation: 'translate',
    input_path,
    output_path,
    target_language: 'zh',
  });
  assert.equal(result.output_path, fs.realpathSync(output_path));
  assert.equal(fs.readFileSync(input_path, 'utf8'), source);
  assert.match(
    fs.readFileSync(output_path, 'utf8'),
    /00:00:01\.250 --> 00:00:03\.000\n译文 Hello world/,
  );
  await assert.rejects(
    run({ operation: 'translate', input_path, output_path, target_language: 'zh' }),
    { code: 'output_exists' },
  );
});
test('missing local model and invalid audio are explicit failures without cloud fallback', async (t) => {
  const { root, worker, run } = await setup(t);
  const input_path = path.join(root, 'bad.mp4');
  fs.writeFileSync(input_path, 'not media');
  await assert.rejects(
    run({
      operation: 'transcribe',
      input_path,
      model_id: 'qwen3-asr-0.6b',
      output_path: path.join(root, 'out.json'),
    }),
    { code: 'model_not_installed' },
  );
  worker.models.missing = () => [];
  worker.handlers['meeting.import'] = async () => {
    throw new Error('Cannot decode media');
  };
  await assert.rejects(
    run({
      operation: 'transcribe',
      input_path,
      model_id: 'qwen3-asr-0.6b',
      output_path: path.join(root, 'out.json'),
    }),
    { code: 'decode_failed' },
  );
  assert.equal(fs.existsSync(path.join(root, 'out.json')), false);
});
test('audio translation reuses import, refinement and meeting query; exports translated timing', async (t) => {
  const { root, worker, run } = await setup(t),
    calls = [];
  const input_path = path.join(root, 'media.mp4');
  fs.writeFileSync(input_path, 'fixture');
  worker.models.missing = () => [];
  for (const name of ['meeting.import', 'meeting.refine'])
    worker.handlers[name] = async (p) => {
      calls.push([name, p]);
      return {};
    };
  worker.handlers['meeting.get'] = async () => ({
    segments: [
      {
        id: '1',
        version: 'postprocess',
        revision: 1,
        start_ms: 100,
        end_ms: 900,
        text: 'hello',
        speaker_name: 'A',
      },
    ],
  });
  worker.translateText = async () => '你好';
  const result = await run({
    operation: 'translate',
    input_path,
    output_path: path.join(root, 'out.srt'),
    language: 'en',
    target_language: 'zh',
    model_id: 'qwen3-asr-0.6b',
  });
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['meeting.import', 'meeting.refine'],
  );
  assert.equal(calls[0][1].meeting_id, calls[1][1].meeting_id);
  assert.match(fs.readFileSync(result.output_path, 'utf8'), /00:00:00,100 --> 00:00:00,900\n你好/);
});
test('cancellation during local translation prevents output', async (t) => {
  const { root, worker, run } = await setup(t),
    meeting_id = randomUUID();
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  worker.translateText = async (_text, _language, signal) => {
    entered();
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  const output_path = path.join(root, 'out.txt'),
    pending = run({
      meeting_id,
      operation: 'translate',
      text: 'hello',
      target_language: 'zh',
      output_path,
    });
  await ready;
  worker.handlers['agent.cancel']({ meeting_id });
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(fs.existsSync(output_path), false);
});
test('exports refuse symlinks and never invent timestamps', async (t) => {
  const { root } = await setup(t),
    source = path.join(root, 'source'),
    link = path.join(root, 'link');
  fs.writeFileSync(source, 'original');
  fs.symlinkSync(source, link);
  await assert.rejects(writeResult(link, 'replacement', new TaskControl()), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  assert.throws(() => render({ segments: [{ text: 'hello' }] }, 'srt'), {
    code: 'timestamps_unavailable',
  });
  assert.throws(() => parseSubtitles('1\n00:00:02,000 --> 00:00:01,000\nhello'), {
    code: 'invalid_subtitles',
  });
});

test('long translation bounds model context without dropping Unicode or accepting empty input', async (t) => {
  const { root, worker, run } = await setup(t),
    calls = [];
  worker.translateText = async (text, target, signal, options) => {
    calls.push(text);
    assert.deepEqual(options, { complete: true });
    assert.equal(target, 'en');
    return text;
  };
  const text = '汉字😀'.repeat(300),
    output_path = path.join(root, 'unicode.txt');
  await run({ operation: 'translate', text, target_language: 'en', output_path });
  assert.equal(calls.join(''), text);
  assert.ok(calls.every((text) => Array.from(text).length <= 256));
  await assert.rejects(
    run({
      operation: 'translate',
      text: '   ',
      target_language: 'en',
      output_path: path.join(root, 'empty.txt'),
    }),
    { code: 'invalid_input' },
  );
  assert.throws(() => parseSubtitles('1\n00:99:00,000 --> 02:00:00,000\nhello'), {
    code: 'invalid_subtitles',
  });
  assert.throws(() => parseSubtitles('1\n00:00:99,000 --> 00:02:00,000\nhello'), {
    code: 'invalid_subtitles',
  });
});

test('empty model translation is a failure and leaves no output file', async (t) => {
  const { root, worker, run } = await setup(t),
    output_path = path.join(root, 'empty-result.txt');
  worker.translateText = async () => '  ';
  await assert.rejects(
    run({ operation: 'translate', text: 'hello', target_language: 'zh', output_path }),
    { code: 'translation_empty' },
  );
  assert.equal(fs.existsSync(output_path), false);
});
