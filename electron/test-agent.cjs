const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const { AgentService } = require('./agent-service.cjs');
const { transport, credentials, call } = require('./agent-client.cjs');
const { mcp } = require('../scripts/brevia.cjs');
async function setup(t, request = async () => []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-agent-'));
  const service = new AgentService({
    root,
    request,
    status: () => ({ version: 'test' }),
    devices: () => [],
    recording: async (p) => p,
  });
  await service.listen();
  service.ready = true;
  t.after(async () => {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service };
}
test('local service requires authentication and separates read, inference and recording', async (t) => {
  const { root } = await setup(t);
  const read = credentials(root, 'read');
  assert.equal((await transport(read, 'app.status', {})).ready, true);
  await assert.rejects(transport({ ...read, token: 'wrong' }, 'app.status', {}), {
    code: 'unauthorized',
  });
  await assert.rejects(
    transport(read, 'recording.control', { action: 'stop', target: 'computer', request_id: '1' }),
    { code: 'forbidden' },
  );
  await assert.rejects(
    transport(credentials(root, 'infer'), 'meeting.get', { meeting_id: 'bad' }),
    { code: 'forbidden' },
  );
  await assert.rejects(transport(read, 'meeting.delete', {}), { code: 'unknown_method' });
});
test('recording stop transport permits the full application finalization deadline', async (t) => {
  const { root } = await setup(t);
  const { ClientRequest } = require('node:http');
  const original = ClientRequest.prototype.setTimeout;
  const deadlines = [];
  t.mock.method(ClientRequest.prototype, 'setTimeout', function (timeout, callback) {
    deadlines.push(timeout);
    return original.call(this, timeout, callback);
  });
  const record = credentials(root, 'record');
  await transport(record, 'recording.control', {
    action: 'stop',
    target: 'computer',
    request_id: 'stop-deadline',
  });
  assert.ok(deadlines.at(-1) > 610000, 'client must wait for the backend stop deadline');
  await transport(credentials(root, 'read'), 'app.status', {});
  assert.equal(deadlines.at(-1), 240000, 'ordinary queries retain their existing timeout');
});
test('oversized recording track collections fail before validating individual entries', async (t) => {
  const { root, service } = await setup(t);
  let recordings = 0;
  service.recording = async () => recordings++;
  // GHSA-mrhx-c7xc-m3w5：超长集合必须只报告边界错误，不能逐项分配错误对象。
  await assert.rejects(
    transport(credentials(root, 'record'), 'recording.control', {
      action: 'start',
      request_id: 'oversized-tracks',
      audio_tracks: Array(10000).fill(0),
    }),
    (error) => {
      const issues = JSON.parse(error.message);
      assert.equal(issues.length, 1);
      assert.equal(issues[0].code, 'too_big');
      assert.deepEqual(issues[0].path, ['audio_tracks']);
      return true;
    },
  );
  assert.equal(recordings, 0);
  assert.equal((await transport(credentials(root, 'read'), 'app.status', {})).ready, true);
});
test('status without startup is side effect free; startup waits for readiness', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-no-start-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let starts = 0;
  assert.deepEqual(await call('app.status', {}, { root, noStart: true, start: () => starts++ }), {
    running: false,
    ready: false,
  });
  assert.equal(starts, 0);
  assert.deepEqual(fs.readdirSync(root), []);
  const service = new AgentService({
    root,
    request: async () => [],
    status: () => ({}),
    devices: () => [],
  });
  t.after(() => service.close());
  const result = await call(
    'app.status',
    {},
    {
      root,
      timeout: 1500,
      start: async () => {
        starts++;
        await service.listen();
        setTimeout(() => {
          service.ready = true;
        }, 250);
      },
    },
  );
  assert.equal(result.ready, true);
  assert.equal(starts, 1);
});
test('task ID is immediate, completion/result and cancellation remain queryable', async (t) => {
  let finish;
  let cancelled = false;
  const { root } = await setup(t, async (type) => {
    if (type === 'agent.cancel') {
      cancelled = true;
      finish({ cancelled: true });
      return {};
    }
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const infer = credentials(root, 'infer'),
    read = credentials(root, 'read');
  const job = await transport(infer, 'inference.run', {
    operation: 'translate',
    text: 'hello',
    target_language: 'zh',
    output_path: path.join(root, 'out.txt'),
  });
  assert.ok(job.task_id);
  assert.equal(job.status, 'queued');
  await delay(10);
  await transport(infer, 'task.cancel', { task_id: job.task_id });
  await delay(10);
  const final = await transport(read, 'task.get', { task_id: job.task_id });
  assert.equal(cancelled, true);
  assert.equal(final.status, 'cancelled');
});
test('MCP discovery and call use JSON lines and never instantiate a Worker', async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let text = '';
  output.on('data', (part) => {
    text += part;
  });
  const calls = [];
  const running = mcp(
    async (method, payload) => {
      calls.push([method, payload]);
      return { running: true };
    },
    input,
    output,
  );
  for (const message of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'app_status', arguments: {} } },
  ])
    input.write(JSON.stringify(message) + '\n');
  input.end();
  await running;
  const messages = text.trim().split('\n').map(JSON.parse);
  assert.equal(messages.length, 3);
  assert.ok(messages[1].result.tools.some((tool) => tool.name === 'inference_run'));
  assert.equal(messages[2].result.isError, false);
  assert.deepEqual(calls, [['app.status', {}]]);
});

test('a killed auto-start process reports a launch failure without waiting for the readiness deadline', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-killed-start-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    call('app.status', {}, { root, timeout: 5000, start: async () => ({ signalCode: 'SIGKILL' }) }),
    (error) => error.code === 'launch_failed' && /SIGKILL/.test(error.message),
  );
});

test('inference queues share one execution slot and cancelled queued work never reaches Worker', async (t) => {
  const calls = [];
  let finish;
  const { service } = await setup(t, async (method, params) => {
    calls.push([method, params.meeting_id]);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const input = {
    operation: 'translate',
    text: 'hello',
    target_language: 'zh',
    output_path: path.join(os.tmpdir(), 'agent-queued.txt'),
  };
  const first = await service.invoke('inference.run', input, 'infer');
  const second = await service.invoke('inference.run', input, 'infer');
  assert.equal(
    (await service.invoke('task.get', { task_id: first.task_id }, 'infer')).status,
    'running',
  );
  assert.equal(
    (await service.invoke('task.get', { task_id: second.task_id }, 'infer')).status,
    'queued',
  );
  assert.equal(
    (await service.invoke('task.cancel', { task_id: second.task_id }, 'infer')).status,
    'cancelled',
  );
  finish({ output_path: input.output_path });
  await service.queue;
  assert.deepEqual(calls, [['agent.run', first.task_id]]);
  assert.equal(
    (await service.invoke('task.get', { task_id: first.task_id }, 'infer')).status,
    'completed',
  );
  assert.equal(
    (await service.invoke('task.get', { task_id: second.task_id }, 'infer')).status,
    'cancelled',
  );
});

test('application settings reject new requests while preserving cancellation and stop', async (t) => {
  let finish;
  const calls = [];
  const { service, root } = await setup(t, async (method, p) => {
    calls.push([method, p.meeting_id]);
    if (method === 'agent.cancel') {
      finish({ cancelled: true });
      return {};
    }
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const input = {
    operation: 'translate',
    text: 'hello',
    target_language: 'zh',
    output_path: path.join(root, 'out.txt'),
  };
  const first = await service.invoke('inference.run', input, 'infer');
  const second = await service.invoke('inference.run', input, 'infer');
  const saved = await service.saveSettings({
    enabled: true,
    permissions: { read: true, infer: false, record: false },
  });
  assert.equal(saved.permissions.infer, false);
  assert.equal(service.jobs.get(first.task_id).status, 'running');
  assert.equal(service.jobs.get(second.task_id).status, 'queued');
  await service.invoke('task.cancel', { task_id: second.task_id }, 'infer');
  await service.invoke('task.cancel', { task_id: first.task_id }, 'infer');
  await service.queue;
  assert.deepEqual(calls, [
    ['agent.run', first.task_id],
    ['agent.cancel', first.task_id],
  ]);
  for (const job of [first, second])
    assert.equal(
      (await service.invoke('task.get', { task_id: job.task_id }, 'read')).status,
      'cancelled',
    );
  await assert.rejects(service.invoke('inference.run', input, 'infer'), {
    code: 'permission_disabled',
  });
  await assert.rejects(
    service.invoke('recording.control', { action: 'start', request_id: 'x' }, 'record'),
    { code: 'permission_disabled' },
  );
  await assert.rejects(service.invoke('agent.settings.save', { enabled: true }, 'read'), {
    code: 'unknown_method',
  });
  assert.equal(JSON.stringify(saved).includes('token'), false);
  await service.saveSettings({
    enabled: false,
    permissions: { read: false, infer: false, record: false },
  });
  assert.equal(
    (
      await service.invoke(
        'recording.control',
        { action: 'stop', request_id: 'safe-stop' },
        'record',
      )
    ).action,
    'stop',
  );
  await assert.rejects(
    service.invoke('recording.control', { action: 'resume', request_id: 'new-resume' }, 'record'),
    { code: 'permission_disabled' },
  );
  await assert.rejects(
    service.invoke('recording.control', { action: 'stop', request_id: 'invalid-scope' }, 'read'),
    { code: 'forbidden' },
  );
});

test('disabled settings survive restart and malformed settings fail closed without disabling the application settings UI', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-settings-'));
  let service = new AgentService({ root, status: () => ({}) });
  try {
    await service.listen();
    await service.saveSettings({
      enabled: false,
      permissions: { read: true, infer: true, record: true },
    });
    await service.close();
    service = new AgentService({ root, status: () => ({}) });
    await service.listen();
    service.ready = true;
    assert.equal(service.getSettings().enabled, false);
    await assert.rejects(service.invoke('app.status', {}, 'read'), { code: 'permission_disabled' });
    await service.close();
    fs.writeFileSync(path.join(root, '.agent/settings.json'), 'invalid');
    service = new AgentService({ root, status: () => ({}) });
    await service.listen();
    service.ready = true;
    assert.equal(service.getSettings().enabled, false);
    assert.ok(service.getSettings().status.error);
    await service.saveSettings({
      enabled: true,
      permissions: { read: true, infer: true, record: true },
    });
    assert.equal((await service.invoke('app.status', {}, 'read')).ready, true);
    assert.equal(service.getSettings().status.error, undefined);
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a disabled inference token cannot read completed results through cancellation', async (t) => {
  const { service } = await setup(t, async () => ({ output_path: '/private/result.txt' }));
  const job = await service.invoke(
    'inference.run',
    {
      operation: 'translate',
      text: 'hello',
      target_language: 'zh',
      output_path: path.join(os.tmpdir(), 'private.txt'),
    },
    'infer',
  );
  await service.queue;
  await service.saveSettings({
    enabled: false,
    permissions: { read: false, infer: false, record: false },
  });
  const cancelled = await service.invoke('task.cancel', { task_id: job.task_id }, 'infer');
  assert.equal(cancelled.status, 'completed');
  assert.equal(cancelled.result, undefined);
  await assert.rejects(service.invoke('task.get', { task_id: job.task_id }, 'infer'), {
    code: 'permission_disabled',
  });
});
