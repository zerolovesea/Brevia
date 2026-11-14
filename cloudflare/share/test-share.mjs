import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import backend from '../../macos/backend/worker.cjs';
import worker from './worker.mjs';
import desktop from '../../desktop/cloud-share.cjs';
const snapshot = {
  title: '会议 <script>',
  language: 'zh',
  markdown: '# 纪要',
  transcript: [{ text: '原文', speaker: '李', start_ms: 0 }],
  claims: [],
};
function environment() {
  const rows = new Map();
  const counts = new Map();
  return {
    rows,
    counts,
    VIEWS: {
      getByName: (id) => ({
        increment: async () => {
          const count = (counts.get(id) || 0) + 1;
          counts.set(id, count);
          return count;
        },
      }),
    },
    PASSWORD_LIMIT: { limit: async () => ({ success: true }) },
    UPLOAD_LIMIT: { limit: async () => ({ success: true }) },
    TOTAL_LIMIT: { limit: async () => ({ success: true }) },
    SHARES: {
      put: async (key, value, options) => rows.set(key, { value: JSON.parse(value), options }),
      get: async (key) => rows.get(key)?.value,
    },
    ASSETS: { fetch: async () => new Response('page') },
  };
}
const upload = (env, days, content = snapshot) =>
  worker.fetch(
    new Request('https://share.brevia.work/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days, snapshot: content }),
    }),
    env,
  );
test('all four expirations are server assigned, unguessable and enforced on every read', async () => {
  const env = environment();
  for (const days of [3, 7, 15, 30]) {
    const response = await upload(env, days);
    assert.equal(response.status, 201);
    const { url, expiresAt } = await response.json();
    assert.match(url, /\/s\/[a-f0-9]{32}$/);
    assert.ok(Math.abs(expiresAt - Date.now() / 1000 - days * 86400) < 2);
    const id = url.split('/').at(-1),
      row = env.rows.get(id);
    assert.equal(row.options.expiration, expiresAt);
    const read = () => worker.fetch(new Request(`https://share.brevia.work/api/shares/${id}`), env);
    const valid = await read();
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get('cache-control'), 'no-store');
    row.value.expiresAt = 0;
    assert.equal((await read()).status, 404);
  }
  assert.equal(env.rows.size, 4);
});
test('reject invalid TTL, malformed input, oversized bodies, and rate-limited uploads', async () => {
  const env = environment();
  for (const days of [0, 1, 4, 31, '7', null]) assert.equal((await upload(env, days)).status, 400);
  assert.equal((await upload(env, 7, { ...snapshot, transcript: [{ text: 3 }] })).status, 400);
  assert.equal(
    (await upload(env, 7, { ...snapshot, markdown: 'x'.repeat(4 * 1024 * 1024) })).status,
    413,
  );
  env.UPLOAD_LIMIT.limit = async () => ({ success: false });
  assert.equal((await upload(env, 7)).status, 429);
  assert.equal(env.rows.size, 0);
});
test('allowlist strips local IDs, audio paths, notes and secrets; snapshot takes edited latest text', async () => {
  const meeting = {
    ...snapshot,
    status: 'ended',
    id: 'private-id',
    notes: 'private',
    audio_path: '/private/audio',
    summary: { data: { markdown: 'summary', claims: [] } },
    segments: [
      { id: '1', version: 'user', revision: 0, text: 'edited', speaker: 'B', start_ms: 0 },
    ],
  };
  const value = desktop.shareSnapshot(meeting, 'zh');
  assert.equal(value.transcript[0].text, 'edited');
  assert.equal(value.transcript.length, 1);
  const legacy = desktop.shareSnapshot(
    { segments: [{ speaker_name: 'Alice', text: 'Hello' }] },
    'en',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.transcript[0])), {
    speaker: 'Alice',
    text: 'Hello',
    start_ms: 0,
  });
  assert.ok(!JSON.stringify(value).includes('private'));
  assert.throws(() => desktop.shareSnapshot({ ...meeting, status: 'recording' }, 'zh'));
  const env = environment();
  await upload(env, 7, { ...value, secret: 'private' });
  assert.ok(!JSON.stringify([...env.rows.values()]).includes('private'));
});
test('responses never expose internal errors or permit framing/indexing', async () => {
  const env = environment();
  env.SHARES.put = async () => {
    throw Error('secret');
  };
  const response = await upload(env, 7);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret'));
  const page = await worker.fetch(
    new Request('https://share.brevia.work/s/' + 'a'.repeat(32)),
    env,
  );
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
});

test('password shares reveal neither content nor hash before authorization', async () => {
  const env = environment();
  const created = await worker.fetch(
    new Request('https://share.brevia.work/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 3, snapshot, password: '秘密 abc' }),
    }),
    env,
  );
  assert.equal(created.status, 201);
  const { url } = await created.json();
  const endpoint = url.replace('/s/', '/api/shares/');
  assert.equal((await worker.fetch(new Request(endpoint), env)).status, 401);
  assert.equal(env.counts.size, 0);
  assert.ok(!JSON.stringify([...env.rows.values()]).includes('秘密 abc'));
  const unlock = (password) =>
    worker.fetch(
      new Request(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
      env,
    );
  assert.equal((await unlock('wrong')).status, 401);
  const valid = await unlock('秘密 abc');
  assert.equal(valid.status, 200);
  const data = await valid.json();
  assert.equal(data.markdown, snapshot.markdown);
  assert.equal(data.password, undefined);
  env.PASSWORD_LIMIT.limit = async () => ({ success: false });
  assert.equal((await unlock('秘密 abc')).status, 429);
  env.rows.values().next().value.value.expiresAt = 0;
  assert.equal((await unlock('秘密 abc')).status, 404);
});

test('counts authorized reads only, metadata and same-name identities survive snapshot', async () => {
  const env = environment();
  const created = await upload(env, 3);
  const { url } = await created.json();
  const endpoint = url.replace('/s/', '/api/shares/');
  assert.equal((await (await worker.fetch(new Request(endpoint), env)).json()).views, 1);
  assert.equal((await (await worker.fetch(new Request(endpoint), env)).json()).views, 2);
  const meeting = {
    title: 'test',
    status: 'ended',
    meeting_date: '2026-11-11',
    duration_ms: 120000,
    current_segments: [
      { speaker: 'a', text: 'one', start_ms: 0 },
      { speaker: 'b', text: 'two', start_ms: 1 },
    ],
    speakers: [
      { id: 'a', name: 'Same' },
      { id: 'b', name: 'Same' },
    ],
  };
  const data = desktop.shareSnapshot(meeting, 'zh');
  assert.equal(data.duration_ms, 120000);
  assert.equal(data.meeting_date, '2026-11-11');
  assert.deepEqual(
    data.transcript.map((s) => s.speaker_id),
    ['a', 'b'],
  );
  assert.deepEqual(
    data.transcript.map((s) => s.speaker),
    ['Same', 'Same'],
  );
});

test('share uploads only current translations whose source text is still valid', async () => {
  const env = environment();
  const current = [
    { id: 'fresh', text: 'original', translation: 'current translation', start_ms: 0 },
    { id: 'stale', text: 'corrected', translation: 'obsolete translation', start_ms: 2000 },
    { id: 'none', text: 'untranslated', translation: ' ', start_ms: 3000 },
  ];
  const snapshot = desktop.shareSnapshot(
    {
      title: 'Bilingual',
      current_segments: current,
      correction: { stale_translations: ['stale'] },
    },
    'zh',
  );
  const response = await upload(env, 3, snapshot);
  assert.equal(response.status, 201);
  const saved = [...env.rows.values()][0].value.transcript;
  assert.deepEqual(
    saved.map((item) => item.translation),
    ['current translation', undefined, undefined],
  );
});

test('cloud shares preserve each segment returned by meeting.get after a partial edit', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'brevia-share-'));
  const backendWorker = new backend.Worker(root, { output: () => {} });
  t.after(async () => {
    try {
      await backendWorker.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  await backendWorker.initialization;
  const store = backendWorker.store;
  const id = 'share-review';
  store.createMeeting({
    meeting_id: id,
    title: 'Review',
    language: 'en',
    refined_model_id: 'test',
  });
  store.replaceSegments(
    id,
    [
      { segment_id: 'a', text: 'first', start_ms: 0, end_ms: 1000 },
      { segment_id: 'b', text: 'second', start_ms: 1000, end_ms: 2000 },
    ],
    'postprocess',
    0,
    { model_id: 'test', language: 'en' },
  );
  store.saveSegmentTexts(id, [{ segment_id: 'a', text: 'corrected' }]);
  const meeting = await backendWorker.handle({
    id: 'get',
    type: 'meeting.get',
    payload: { meeting_id: id },
  });
  for (const detail of [meeting, store.getMeeting(id)])
    assert.deepEqual(
      desktop.shareSnapshot(detail, 'en').transcript.map((s) => s.text),
      ['corrected', 'second'],
    );
});
