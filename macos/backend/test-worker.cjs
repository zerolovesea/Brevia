const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { Worker } = require('./worker.cjs');
const { wavInfo } = require('./audio-io.cjs');
const { Configuration } = require('./config.cjs');
const { EngineClient } = require('./engine.cjs');
const { TaskControl } = require('./tasks.cjs');
class FakeEngine {
  constructor(calls) {
    this.calls = calls;
    this.parts = [];
    this.closed = false;
  }
  async request(type, payload, options = {}) {
    this.calls.push([type, payload]);
    options.signal?.throwIfAborted();
    if (type === 'asr.load') return { max_speech_seconds: 20 };
    if (type === 'asr.decode')
      return {
        text: '今天确认发布计划。',
        words: [{ text: '今天确认发布计划', start_ms: 0, end_ms: 500 }],
      };
    if (type === 'vad.load' || type === 'vad.reset') {
      this.parts = [];
      return {};
    }
    if (type === 'vad.feed') {
      this.parts.push(Buffer.from(payload.pcm, 'base64'));
      return payload.with_state
        ? { segments: [], speech_detected: false, current_segment_start: -1 }
        : [];
    }
    if (type === 'vad.flush') {
      const pcm = Buffer.concat(this.parts);
      this.parts = [];
      const segments = pcm.length
        ? [{ start_ms: 0, end_ms: pcm.length / 32, pcm: pcm.toString('base64') }]
        : [];
      return payload.with_state
        ? { segments, speech_detected: false, current_segment_start: -1 }
        : segments;
    }
    if (type === 'speaker.embed') return { embedding: [1, 0] };
    if (type === 'speaker.diarize')
      return {
        segments: [
          { start_ms: 0, end_ms: Buffer.from(payload.pcm, 'base64').length / 32, speaker: 'spk-1' },
        ],
      };
    throw new Error('Unexpected inference command: ' + type);
  }
  close() {
    this.closed = true;
  }
}
async function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-worker-test-')),
    events = [],
    calls = [],
    engines = [],
    w = new Worker(root, {
      output: (v) => events.push(v),
      engineFactory: () => {
        const engine = options.engineFactory?.(calls) || new FakeEngine(calls);
        engines.push(engine);
        return engine;
      },
    });
  await w.initialization;
  w.models.missing = () => [];
  w.models.isReady = () => true;
  w.models.path = () => '/models';
  t.after(async () => {
    await w.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { w, root, events, calls, engines };
}
const start = (w, id = 'session') =>
  w.handlers['meeting.start']({
    meeting_id: id,
    title: '会议',
    language: 'zh',
    refined_model_id: 'funasr-nano-int8',
    require_models: true,
    audio_tracks: ['mic'],
  });
function audio(w, id, pcm, startMs = 0) {
  return w.handlers['meeting.audio']({
    meeting_id: id,
    track: 'mic',
    pcm: pcm.toString('base64'),
    sample_rate: 16000,
    start_ms: startMs,
  });
}
test('Recording preserves original PCM and sends compatible settled transcript events', async (t) => {
  const { w, events, calls } = await setup(t);
  const pcm = Buffer.alloc(32000);
  for (let i = 0; i < 16000; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 0.1) * 5000), i * 2);
  const meeting = await start(w);
  await audio(w, meeting.id, pcm);
  await w.handlers['meeting.pause']({ meeting_id: meeting.id, paused: true });
  await audio(w, meeting.id, pcm, 1000);
  const saved = await w.handlers['meeting.stop']({ meeting_id: meeting.id, duration_ms: 2000 });
  assert.equal(saved.status, 'ready');
  assert.equal(w.active, null);
  const file = w.store.audioFiles(meeting.id).playback.mic,
    info = wavInfo(file);
  assert.deepEqual(fs.readFileSync(file).subarray(info.offset), Buffer.concat([pcm, pcm]));
  assert.ok(w.store.getMeeting(meeting.id, true).segments.length);
  assert.ok(events.some((e) => e.type === 'transcript.settled'));
  assert.ok(events.every((e) => e.schema_version === 1));
  assert.equal(events.filter((e) => e.type === 'worker.warning').length, 0);
  assert.equal(calls.filter(([type]) => type === 'vad.load').length, 2);
  assert.ok(calls.find(([type]) => type === 'asr.load')[1].files.length);
});
test('Lost phone chunk responses replay safely, including partial overlap and stale manifest', async (t) => {
  const { w, root } = await setup(t);
  const mid = 'mobile';
  await w.handlers['mobile.apply']({
    action: 'start',
    meeting_id: mid,
    title: 'Phone',
    language: 'zh',
    refined_model_id: 'funasr-nano-int8',
  });
  const pcm = Buffer.alloc(32000, 4);
  const put = (startSample) =>
    w.handlers['mobile.apply']({
      action: 'chunk',
      meeting_id: mid,
      pcm: pcm.toString('base64'),
      start_sample: startSample,
    });
  assert.deepEqual(await put(0), { samples: 16000 });
  assert.deepEqual(await put(0), { samples: 16000 });
  assert.deepEqual(await put(8000), { samples: 24000 });
  w.store.closeAudioSessions();
  const manifest = w.store.readManifest(mid);
  manifest.tracks.mic.samples = 0;
  w.store.writeManifest(mid, manifest);
  assert.deepEqual(await put(8000), { samples: 24000 });
  await assert.rejects(put(40000), /Missing audio/);
  const end = await w.handlers['mobile.apply']({ action: 'end', meeting_id: mid, samples: 24000 });
  assert.equal(end.duration_ms, 1500);
  assert.equal(
    w.store.wavSamples(path.join(root, 'meetings', mid, 'audio', 'mic-00000.wav')),
    24000,
  );
});
test('Phone note proposals use optimistic updates and preserve pending conflicts', async (t) => {
  const { w } = await setup(t);
  await start(w);
  const put = (id, notes) =>
    w.handlers['mobile.proposal.put']({
      id,
      notes,
      meeting_id: 'session',
      device_id: 'phone',
      base_revision: 1,
    });
  assert.deepEqual(put('one', '手机笔记'), { id: 'one', state: 'pending' });
  assert.deepEqual(put('two', '新笔记'), { conflict: true });
  assert.deepEqual(
    w.handlers['mobile.proposal.resolve']({
      meeting_id: 'session',
      id: 'one',
      accept: true,
      expected_notes: 'old',
    }),
    { conflict: true },
  );
  const result = w.handlers['mobile.proposal.resolve']({
    meeting_id: 'session',
    id: 'one',
    accept: true,
    expected_notes: '',
  });
  assert.equal(result.state, 'accepted');
  assert.equal(w.store.getMeeting('session').notes, '手机笔记');
  assert.deepEqual(put('two', '新笔记'), { id: 'two', state: 'pending' });
});
test('Refinement persists real decode output and revisions, retains manual speaker locks', async (t) => {
  const { w, events, calls } = await setup(t);
  await start(w);
  await audio(w, 'session', Buffer.alloc(64000, 8));
  await w.handlers['meeting.stop']({ meeting_id: 'session', duration_ms: 2000 });
  const live = w.store.getMeeting('session', true).segments[0];
  await w.handlers['segment.speaker']({ meeting_id: 'session', segment_id: live.id, name: '张三' });
  await w.handlers['meeting.refine']({
    meeting_id: 'session',
    refined_model_id: 'funasr-nano-int8',
  });
  const first = w.store.getMeeting('session', true);
  assert.equal(first.status, 'refined');
  assert.equal(first.segments[0].version, 'postprocess');
  assert.equal(first.segments[0].speaker_name, '张三');
  assert.ok(first.segments[0].word_timestamps.length);
  await w.handlers['meeting.refine']({
    meeting_id: 'session',
    refined_model_id: 'funasr-nano-int8',
  });
  assert.equal(w.store.getMeeting('session', true).segments[0].version, 'postprocess-1');
  assert.equal(events.filter((e) => e.type === 'refinement.ready').length, 2);
  assert.ok(calls.some(([type]) => type === 'speaker.diarize'));
});
test('Cancelling refinement kills the pending decode and preserves the previous transcript', async (t) => {
  let reached,
    waitReached = new Promise((resolve) => (reached = resolve)),
    blocked = false;
  class Blocking extends FakeEngine {
    async request(type, payload, options) {
      if (blocked && type === 'asr.decode') {
        reached();
        return new Promise((resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          }),
        );
      }
      return super.request(type, payload, options);
    }
  }
  const { w, events } = await setup(t, { engineFactory: (calls) => new Blocking(calls) });
  await start(w);
  await audio(w, 'session', Buffer.alloc(32000, 3));
  await w.handlers['meeting.stop']({ meeting_id: 'session', duration_ms: 1000 });
  const previous = w.store.getMeeting('session', true).segments;
  blocked = true;
  const pending = w.handlers['meeting.refine']({
    meeting_id: 'session',
    refined_model_id: 'funasr-nano-int8',
  });
  await waitReached;
  w.handlers['task.cancel']({ task: 'meeting.refine', meeting_id: 'session' });
  await pending;
  assert.equal(w.store.getMeeting('session').status, 'ready');
  assert.deepEqual(w.store.getMeeting('session', true).segments, previous);
  assert.ok(events.some((e) => e.type === 'refinement.cancelled'));
  assert.equal(w.tasks.hasAny(), false);
});
test('Advanced settings migrate legacy fields and prune retired keys', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, 'advanced-settings.json'),
    JSON.stringify({
      audio: { sample_rate: 48000 },
      live_asr: {
        quiet_speech_recovery: 2,
        quiet_speech_min_seconds: -1,
        quiet_speech_max_seconds: 0,
        quiet_speech_level_ratio: 2,
      },
      asr: { refined_window_seconds: 12 },
    }),
  );
  const config = new Configuration(root);
  assert.equal(config.value.audio.sample_rate, 16000);
  assert.equal(config.value.asr.refined_window_seconds, 12);
  assert.equal(config.value.live_asr.quiet_speech_recovery, 1);
  assert.equal(config.value.live_asr.quiet_speech_level_ratio, 1);
  assert.deepEqual(config.save({ ...config.value, retired_setting: 1 }), config.value);
  assert.deepEqual(config.save(JSON.parse(JSON.stringify(config.value))), config.value);
});
test('JSONL rejects malformed and non-object commands without losing subsequent requests', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-jsonl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(__dirname, 'worker.cjs')], {
    env: { ...process.env, BREVIA_DATA_DIR: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '',
    error = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (error += chunk));
  child.stdin.end('null\n{bad\n{"id":"ok","type":"models.can-relocate"}\n');
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(code, 0, error);
  const rows = output.trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter((r) => !r.ok).length, 2);
  assert.deepEqual(
    rows.find((r) => r.id === 'ok'),
    { id: 'ok', ok: true, result: true },
  );
});
test('Native streaming events find their pending request via payload.id', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-engine-')),
    file = path.join(root, 'engine');
  fs.writeFileSync(
    file,
    '#!' +
      process.execPath +
      '\n' +
      `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({type:'asr.partial',payload:{id:r.id,text:'partial'}}));console.log(JSON.stringify({id:r.id,ok:true,result:{text:'final'}}));});`,
  );
  fs.chmodSync(file, 0o700);
  const engine = new EngineClient(file);
  t.after(() => {
    engine.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const events = [],
    result = await engine.request('asr.decode', {}, { onEvent: (e) => events.push(e) });
  assert.equal(result.text, 'final');
  assert.equal(events[0].payload.text, 'partial');
});

test('Import cancellation uses the actual meeting id and removes unfinished converted audio', async (t) => {
  const { w } = await setup(t);
  const pending = w.handlers['meeting.import']({
    title: 'Cancel import',
    path: path.join(__dirname, '../../backend/fixtures/example-zh.wav'),
    language: 'zh',
    refined_model_id: 'funasr-nano-int8',
  });
  const task = [...w.tasks.controls.values()].find((v) => v.task === 'meeting.import');
  assert.ok(task);
  assert.equal(w.store.getMeeting(task.meetingId).title, 'Cancel import');
  w.handlers['task.cancel']({ task: 'meeting.import', meeting_id: task.meetingId });
  await assert.rejects(pending);
  assert.equal(w.store.one('SELECT id FROM meetings WHERE id=?', task.meetingId), null);
  assert.equal(w.tasks.hasAny(), false);
});
test('Phone retransmission never resurrects a deleted meeting', async (t) => {
  const { w } = await setup(t);
  await start(w, 'deleted-mobile');
  await w.handlers['meeting.stop']({ meeting_id: 'deleted-mobile', duration_ms: 0 });
  w.store.softDelete('deleted-mobile');
  assert.throws(
    () =>
      w.handlers['mobile.prepare']({
        id: 'deleted-mobile',
        language: 'zh',
        refined_model_id: 'funasr-nano-int8',
      }),
    /编号已存在/,
  );
  await assert.rejects(
    w.handlers['mobile.apply']({
      action: 'start',
      meeting_id: 'deleted-mobile',
      title: 'retry',
      language: 'zh',
      refined_model_id: 'funasr-nano-int8',
    }),
    /已删除/,
  );
  assert.ok(w.store.getMeeting('deleted-mobile').deleted_at);
});
