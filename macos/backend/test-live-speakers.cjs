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
  const publish = (id = 'first', voiceSpans = [{ start: 0, end: durationMs }]) => {
    worker.session.subtitles.push(
      {
        meeting_id: 'live',
        segment_id: id,
        revision: 1,
        track: 'mic',
        start_ms: 0,
        end_ms: durationMs,
        speaker: 'local-user',
      },
      'The transcript arrives first.',
      voiceSpans,
    );
    worker.session.subtitles.flush();
  };
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
    wait: async (count = 1) => {
      const deadline = performance.now() + 3000;
      while (calls.length < count && performance.now() < deadline)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls.length, count, 'Expected an embedding request');
    },
  };
}

async function embed(harness, vector = [1, 0]) {
  const live = harness.worker.session.liveSpeakers,
    count = harness.calls.length + 1;
  live.nextAt = 0;
  const pending = live.run();
  await harness.wait(count);
  harness.complete(vector);
  await pending;
}

test('Natural speech windows exclude merged silence and conflicting voices stay unknown', async (t) => {
  const h = await setup(t, 8000),
    live = h.worker.session.liveSpeakers;
  h.publish('mixed', [
    { start: 500, end: 3500 },
    { start: 4500, end: 7500 },
  ]);
  await embed(h, [1, 0]);
  assert.equal(Buffer.from(h.calls[0].pcm, 'base64').length, 3 * 32000);
  assert.equal(live.centers.length, 0, 'partial evidence cannot teach a center');
  await embed(h, [0, 1]);
  assert.equal(h.events.filter((e) => e.type === 'transcript.refined').length, 0);
  assert.equal(live.centers.length, 0, 'mixed speakers cannot create an averaged identity');
  h.publish('same', [
    { start: 500, end: 3500 },
    { start: 4500, end: 7500 },
  ]);
  await embed(h);
  await embed(h);
  assert.equal(h.events.filter((e) => e.type === 'transcript.refined').length, 1);
  assert.equal(live.centers.length, 1);
});

test('Short speech can match an identity but cannot create or move its center', async (t) => {
  const h = await setup(t),
    live = h.worker.session.liveSpeakers;
  h.publish('learn');
  await embed(h);
  const center = live.centers[0],
    reference = [...center.vector];
  h.publish('short', [{ start: 0, end: 1500 }]);
  await embed(h, [0.95, 0.05]);
  assert.equal(h.worker.store.currentSegments('live', 'short')[0].speaker, center.id);
  assert.deepEqual(center.vector, reference);
  assert.equal(center.count, 1);
  h.publish('unknown-short', [{ start: 0, end: 1500 }]);
  await embed(h, [0, 1]);
  assert.equal(live.centers.length, 1);
  assert.equal(h.worker.store.currentSegments('live', 'unknown-short')[0].speaker, 'local-user');
  h.publish('tiny', [{ start: 0, end: 800 }]);
  assert.equal(live.queue.length, 0);
});

test('Registered and temporary identities compete together without double-counting bound aliases', async (t) => {
  const h = await setup(t),
    live = h.worker.session.liveSpeakers;
  h.publish('first');
  await embed(h);
  const center = live.centers[0];
  const other = h.worker.store.saveSpeakerProfileSample(
    'Other',
    [Math.cos(Math.PI / 9), Math.sin(Math.PI / 9)],
    'other',
  );
  h.publish('ambiguous');
  await embed(h, [Math.cos(Math.PI / 18), Math.sin(Math.PI / 18)]);
  assert.equal(h.worker.store.currentSegments('live', 'ambiguous')[0].speaker, 'local-user');
  assert.equal(center.count, 1);
  h.worker.store.deleteSpeakerProfile(other.id);
  const same = h.worker.store.saveSpeakerProfileSample('Known', [1, 0], 'same');
  h.worker.store.run(
    'UPDATE speakers SET profile_id=?,name=? WHERE meeting_id=? AND id=?',
    same.id,
    same.name,
    'live',
    center.id,
  );
  h.publish('bound');
  await embed(h);
  const row = h.worker.store.currentSegments('live', 'bound')[0];
  assert.equal(row.speaker, center.id);
  assert.equal(row.speaker_name, 'Known');
});

test('A near registered identity cannot fall through its stricter threshold into a new identity', async (t) => {
  const h = await setup(t),
    live = h.worker.session.liveSpeakers;
  h.worker.settings.diarization.online_similarity_threshold = 0.68;
  h.worker.settings.diarization.voiceprint_similarity_threshold = 0.75;
  const profile = h.worker.store.saveSpeakerProfileSample(
    'Known',
    [0.72, Math.sqrt(1 - 0.72 ** 2), 0],
    'known',
  );
  h.publish('near-profile');
  await embed(h, [1, 0, 0]);
  assert.equal(live.centers.length, 0);
  live.centers.push({
    id: 'temporary',
    name: 'spk-1',
    vector: [0.7, 0, Math.sqrt(1 - 0.7 ** 2)],
    count: 1,
  });
  h.publish('ambiguous-thresholds');
  await embed(h, [1, 0, 0]);
  assert.equal(live.centers.length, 1);
  assert.equal(h.events.filter((e) => e.type === 'transcript.refined').length, 0);
  h.worker.store.deleteSpeakerProfile(profile.id);
  h.publish('temporary-alone');
  await embed(h, [1, 0, 0]);
  assert.equal(h.worker.store.currentSegments('live', 'temporary-alone')[0].speaker, 'temporary');
});

test('A registered identity keeps a distinct stable row after its original row is manually rebound', async (t) => {
  const h = await setup(t);
  const alice = h.worker.store.saveSpeakerProfileSample('Alice', [1, 0], 'alice');
  h.worker.store.saveSpeakerProfileSample('Bob', [0, 1], 'bob');
  h.publish('first');
  await embed(h);
  const original = h.worker.store.currentSegments('live', 'first')[0].speaker;
  await h.worker.handlers['speaker.rename']({
    meeting_id: 'live',
    speaker_id: original,
    name: 'Bob',
  });
  h.publish('second');
  await embed(h);
  const second = h.worker.store.currentSegments('live', 'second')[0];
  assert.equal(second.speaker_name, 'Alice');
  assert.notEqual(second.speaker, original);
  assert.equal(h.worker.store.currentSegments('live', 'first')[0].speaker_name, 'Bob');
  assert.equal(
    h.worker.store.one(
      'SELECT profile_id FROM speakers WHERE meeting_id=? AND id=?',
      'live',
      second.speaker,
    ).profile_id,
    alice.id,
  );
  h.publish('third');
  await embed(h);
  assert.equal(h.worker.store.currentSegments('live', 'third')[0].speaker, second.speaker);
});

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
  assert.equal(live.centers.length, 0, 'late manual correction also prevents center learning');
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
    await running;
    live.nextAt = 0;
    await live.run();
    assert.equal(calls.length, 1, 'new ASR work takes priority over the second window');
    worker.session.preprocessingQueued = 0;
    live.nextAt = 0;
    const next = live.run();
    await wait(2);
    complete();
    await next;
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
    await running;
    assert.equal(calls.length, 1);
    if (action === 'pause') live.setPaused(true);
    else item.at -= 31000;
    live.nextAt = 0;
    await live.run();
    assert.equal(calls.length, 1);
    assert.equal(!!live.disabled, false);
    assert.equal(live.running, false);
    assert.equal(events.filter((event) => event.type === 'transcript.refined').length, 0);
    worker.session.preprocessingQueued = 0;
  });
