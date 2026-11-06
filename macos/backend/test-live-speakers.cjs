const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Worker } = require('./worker.cjs');
const { EMBEDDING_MODEL } = require('./worker-speakers.cjs');

async function setup(t, durationMs = 4000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-live-speakers-'));
  const events = [],
    calls = [];
  let complete;
  const worker = new Worker(root, {
    output: (event) => events.push(event),
    engineFactory: () => ({
      closed: false,
      async request(type, payload, options = {}) {
        if (type === 'asr.load') return {};
        assert.equal(type, 'speaker.embed');
        calls.push(payload);
        return new Promise((resolve, reject) => {
          complete = (embedding = [1, 0]) => resolve({ embedding });
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        });
      },
      close() {
        this.closed = true;
      },
    }),
  });
  await worker.initialization;
  worker.models.isReady = () => true;
  worker.models.missing = () => [];
  worker.models.path = () => '/models';
  await worker.handlers['meeting.start']({
    meeting_id: 'live',
    title: 'Live',
    language: 'zh',
    refined_model_id: 'funasr-nano-int8',
    audio_tracks: ['mic'],
  });
  const pcm = Buffer.alloc(durationMs * 32);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(4000, i);
  worker.store.appendAudio('live', 'mic', pcm, 16000, 0);
  const publish = (id = 'first') =>
    worker.session.subtitles.publish({
      meeting_id: 'live',
      segment_id: id,
      revision: 1,
      track: 'mic',
      start_ms: 0,
      end_ms: durationMs,
      speaker: 'local-user',
      text: 'The transcript arrives first.',
    });
  t.after(async () => {
    await worker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    worker,
    events,
    calls,
    publish,
    complete: (...args) => complete(...args),
    wait: async () => {
      while (!complete) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('Live voiceprints arrive after captions, use one thread and do not retrigger settled work', async (t) => {
  const { worker, events, calls, publish, complete, wait } = await setup(t);
  const profile = worker.store.saveSpeakerProfileSample('Alice', [1, 0], 'test');
  publish();
  assert.equal(events.filter((event) => event.type === 'transcript.final').length, 1);
  assert.equal(events.filter((event) => event.type === 'transcript.refined').length, 0);
  const live = worker.session.liveSpeakers;
  const running = live.run();
  await wait();
  assert.equal(calls[0].threads, 1);
  assert.equal(Buffer.from(calls[0].pcm, 'base64').length, 4 * 32000);
  complete();
  await running;
  const update = events.find((event) => event.type === 'transcript.refined').payload;
  assert.equal(update.speaker, 'profile-' + profile.id);
  assert.equal(update.speaker_name, 'Alice');
  assert.equal(update.revision, 2);
  assert.equal(events.filter((event) => event.type === 'transcript.settled').length, 1);
  const row = worker.store.currentSegments('live', 'first')[0];
  assert.equal(row.speaker_name, 'Alice');
  assert.equal(row.user_edited, 0);
  publish('next');
  await live.run();
  assert.equal(calls.length, 1, 'rate budget defers the next embedding');
  const engine = live.engine;
  await worker.handlers['meeting.pause']({ meeting_id: 'live', paused: true });
  assert.equal(engine.closed, true);
  assert.equal(live.queue.length, 0);
});

test('Late speaker inference preserves manual edits and pause cancels pending inference', async (t) => {
  const { worker, events, publish, complete, wait } = await setup(t);
  publish();
  const live = worker.session.liveSpeakers;
  const running = live.run();
  await wait();
  worker.store.setSegmentSpeaker('live', 'first', 'manual-alice', null, 'Alice');
  complete();
  await running;
  assert.equal(worker.store.currentSegments('live', 'first')[0].speaker_name, 'Alice');
  assert.equal(
    events.some((event) => event.type === 'transcript.refined'),
    false,
  );
  publish('second');
  live.nextAt = 0;
  const cancelled = live.run();
  await new Promise((resolve) => setImmediate(resolve));
  live.setPaused(true);
  await cancelled;
  assert.equal(worker.store.currentSegments('live', 'second')[0].speaker, 'local-user');
  assert.equal(
    events.some((event) => event.type === 'transcript.refined'),
    false,
  );
  assert.equal(live.engine, null);
});

test('Live speaker work stays bounded, yields to ASR and ignores unavailable models', async (t) => {
  const { worker, calls, publish } = await setup(t);
  const live = worker.session.liveSpeakers;
  worker.models.isReady = (id) => id !== EMBEDDING_MODEL;
  publish('missing');
  assert.equal(live.queue.length, 0);
  worker.models.isReady = () => true;
  for (let i = 0; i < 100; i++) publish('utterance-' + i);
  assert.equal(live.queue.length, 8);
  worker.session.queued = 1;
  await live.run();
  assert.equal(calls.length, 0);
  worker.session.queued = 0;
  for (const item of live.queue) item.at -= 31000;
  live.nextAt = 0;
  await live.run();
  assert.equal(live.queue.length, 0);
  assert.equal(calls.length, 0);
});

test(
  'Long utterances yield between voiceprint windows when ASR work arrives',
  { timeout: 5000 },
  async (t) => {
    const { worker, events, calls, publish, complete, wait } = await setup(t, 8000);
    publish();
    const live = worker.session.liveSpeakers;
    const running = live.run();
    await wait();
    assert.equal(calls.length, 1);
    worker.session.preprocessingQueued = 1;
    complete();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.length, 1, 'new ASR work takes priority over the second window');
    worker.session.preprocessingQueued = 0;
    while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    complete();
    await running;
    assert.equal(!!live.disabled, false);
    assert.equal(events.filter((event) => event.type === 'transcript.refined').length, 1);
    assert.equal(events.filter((event) => event.type === 'transcript.settled').length, 1);
  },
);

for (const action of ['pause', 'expire'])
  test(`Voiceprint windows stop waiting for ASR on ${action}`, { timeout: 5000 }, async (t) => {
    const { worker, events, calls, publish, complete, wait } = await setup(t, 8000);
    publish();
    const live = worker.session.liveSpeakers,
      item = live.queue[0],
      running = live.run();
    await wait();
    worker.session.preprocessingQueued = 1;
    complete();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.length, 1);
    if (action === 'pause') live.setPaused(true);
    else item.at -= 31000;
    await running;
    assert.equal(calls.length, 1);
    assert.equal(!!live.disabled, false);
    assert.equal(live.running, false);
    assert.equal(events.filter((event) => event.type === 'transcript.refined').length, 0);
    worker.session.preprocessingQueued = 0;
  });
