const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Worker } = require('./worker.cjs');
const { SentenceVAD } = require('./sentence-vad.cjs');

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-live-performance-')),
    events = [],
    engines = [],
    worker = new Worker(root, {
      output: (event) => events.push(event),
      engineFactory: () => {
        const engine = {
          calls: [],
          samples: [],
          closed: false,
          async request(type, p) {
            this.calls.push(type);
            if (type === 'asr.load') return { max_speech_seconds: 20 };
            if (type === 'asr.decode') return { text: '今天确认发布计划。' };
            if (type === 'vad.load' || type === 'vad.reset') {
              this.samples = [];
              return {};
            }
            if (type === 'vad.feed') {
              this.samples.push(Buffer.from(p.pcm, 'base64'));
              return p.with_state
                ? { segments: [], speech_detected: true, current_segment_start: 0 }
                : [];
            }
            if (type === 'vad.flush') {
              const pcm = Buffer.concat(this.samples),
                segments = pcm.length
                  ? [{ start_ms: 0, end_ms: pcm.length / 32, pcm: pcm.toString('base64') }]
                  : [];
              this.samples = [];
              return p.with_state ? { segments } : segments;
            }
            if (type === 'speaker.diarize')
              return {
                segments: [
                  {
                    start_ms: 0,
                    end_ms: Buffer.from(p.pcm, 'base64').length / 32,
                    speaker: 'spk-1',
                  },
                ],
              };
            throw new Error(type);
          },
          close() {
            this.closed = true;
          },
        };
        engines.push(engine);
        return engine;
      },
    });
  await worker.initialization;
  worker.models.missing = () => [];
  worker.models.isReady = () => true;
  worker.models.path = () => '/models';
  worker.speakerEmbedding = async () => [1, 0];
  t.after(async () => {
    await worker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { worker, events, engines };
}
const start = (worker) =>
  worker.handlers['meeting.start']({
    meeting_id: 'early',
    title: 'Early captions',
    language: 'zh',
    refined_model_id: 'funasr-nano-int8',
    audio_tracks: ['mic'],
  });
async function audio(worker, start, duration) {
  const pcm = Buffer.alloc(duration * 32);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(4000, i);
  await worker.handlers['meeting.audio']({
    meeting_id: 'early',
    track: 'mic',
    pcm: pcm.toString('base64'),
    start_ms: start,
    sample_rate: 16000,
  });
  await worker.drainRecognition();
}

test('First speech produces one provisional draft after two seconds without changing stored segments', async (t) => {
  const { worker, events, engines } = await setup(t);
  await start(worker);
  await audio(worker, 0, 1000);
  assert.equal(events.filter((e) => e.type === 'transcript.draft' && e.payload.text).length, 0);
  await audio(worker, 1000, 1000);
  const first = events.find((e) => e.type === 'transcript.draft' && e.payload.text);
  assert.ok(first);
  assert.equal(first.payload.end_ms, 2000);
  assert.equal(worker.store.getMeeting('early', true).segments.length, 0);
  await audio(worker, 2000, 3000);
  const recognizer = engines.find((e) => e.calls.includes('asr.load'));
  assert.equal(recognizer.calls.filter((c) => c === 'asr.decode').length, 1);
  assert.equal(
    events.filter((e) => e.type === 'transcript.draft' && e.payload.track === 'mic').at(-1).payload
      .text,
    first.payload.text,
  );
  await worker.handlers['meeting.stop']({ meeting_id: 'early', duration_ms: 5000 });
  assert.equal(recognizer.calls.filter((c) => c === 'asr.decode').length, 2);
  const segments = worker.store.getMeeting('early', true).segments;
  assert.equal(segments.length, 1);
  assert.equal(segments[0].start_ms, 0);
  assert.equal(segments[0].end_ms, 5000);
  assert.equal(
    events.filter((e) => e.type === 'transcript.draft' && e.payload.track === 'mic').at(-1).payload
      .text,
    '',
  );
});

test('Preview excludes initial silence and bounds snapshots without consuming VAD state', async (t) => {
  const { worker } = await setup(t),
    vad = new SentenceVAD(worker, { language: 'zh' }, 20, 10000);
  vad.remember(Buffer.alloc(32000 * 5));
  vad.samples = 16000 * 5;
  assert.equal(vad.preview(), null);
  vad.speechStart = 16000;
  const result = vad.preview();
  assert.equal(result.start_ms, 11000);
  assert.equal(result.end_ms, 14000);
  assert.equal(Buffer.from(result.pcm, 'base64').length, 96000);
  assert.deepEqual(vad.preview(), result);
  assert.equal(vad.speechStart, 16000);
  vad.close();
});

test('Refinement reuses one speaker engine across windows and closes it afterwards', async (t) => {
  const { worker, engines } = await setup(t);
  await start(worker);
  await audio(worker, 0, 6000);
  await worker.handlers['meeting.stop']({ meeting_id: 'early', duration_ms: 6000 });
  worker.settings.refinement.diarization_chunk_ms = 2000;
  await worker.handlers['meeting.refine']({
    meeting_id: 'early',
    refined_model_id: 'funasr-nano-int8',
  });
  const speakers = engines.filter((e) => e.calls.includes('speaker.diarize'));
  assert.equal(speakers.length, 1);
  assert.equal(speakers[0].calls.filter((c) => c === 'speaker.diarize').length, 3);
  assert.equal(speakers[0].closed, true);
  assert.equal(worker.engines.size, 0);
});

test('Voice enrollment avoids duplicate full-segment inference and shares short-clip fallback', async (t) => {
  const { worker } = await setup(t);
  await start(worker);
  await audio(worker, 0, 6000);
  await worker.handlers['meeting.stop']({ meeting_id: 'early', duration_ms: 6000 });
  const segment = worker.store.getMeeting('early', true).segments[0],
    durations = [];
  worker.speakerEmbedding = async (_engine, pcm) => {
    durations.push(pcm.length / 32);
    return pcm.length >= 64000 ? [1, 0] : null;
  };
  await worker.handlers['segment.speaker']({
    meeting_id: 'early',
    segment_id: segment.id,
    name: 'First speaker',
    enroll: true,
  });
  assert.deepEqual(durations, [6000]);
  durations.length = 0;
  worker.store.run(
    'UPDATE segments SET text=? WHERE meeting_id=? AND id=?',
    '一。二。三。四。',
    'early',
    segment.id,
  );
  await worker.handlers['segment.speaker']({
    meeting_id: 'early',
    segment_id: segment.id,
    name: 'Second speaker',
    enroll: true,
  });
  assert.deepEqual(durations, [1500, 6000, 1500, 1500, 1500]);
});

test('Cancelling speaker analysis releases the shared engine and preserves the live transcript', async (t) => {
  const { worker } = await setup(t);
  await start(worker);
  await audio(worker, 0, 6000);
  await worker.handlers['meeting.stop']({ meeting_id: 'early', duration_ms: 6000 });
  const previous = worker.store.getMeeting('early', true).segments;
  let entered, shared;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const create = worker.newEngine;
  worker.newEngine = (...args) => {
    const engine = create(...args),
      request = engine.request.bind(engine);
    engine.request = (type, p, options) => {
      if (type !== 'speaker.diarize') return request(type, p, options);
      shared = engine;
      entered();
      return new Promise((_, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        }),
      );
    };
    return engine;
  };
  const pending = worker.handlers['meeting.refine']({
    meeting_id: 'early',
    refined_model_id: 'funasr-nano-int8',
  });
  await ready;
  worker.handlers['task.cancel']({ task: 'meeting.refine', meeting_id: 'early' });
  await pending;
  assert.ok(shared.closed);
  assert.equal(worker.engines.size, 0);
  assert.deepEqual(worker.store.getMeeting('early', true).segments, previous);
});
