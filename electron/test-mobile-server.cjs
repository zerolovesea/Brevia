const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MobileServer } = require('./mobile-server');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brevia-mobile-'));
  const deliveries = [];
  const commands = [];
  let discoveryPrompts = 0;
  const options = {
    directory,
    advertise: false,
    discovered: () => discoveryPrompts++,
    port: 0,
    active: () => null,
    approve: async () => true,
    request: async (type, payload) => {
      commands.push(type);
      if (type === 'meeting.get')
        return { notes: 'notes from PC', segments: [], audio: '/private/path' };
      deliveries.push(payload);
      return { id: payload.meeting_id };
    },
  };
  let server = new MobileServer(options);
  async function call(method, route, value, token) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: server.port,
          method,
          path: route,
          ca: server.identity.cert,
          checkServerIdentity: () => undefined,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        },
      );
      req.on('error', reject);
      req.end(value ? JSON.stringify(value) : undefined);
    });
  }
  async function waitForTask(id, token) {
    const deadline = Date.now() + 5000;
    let task;
    do {
      task = (await call('GET', `/meetings/${id}/snapshot`, null, token)).body.task;
      if (task.state !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    assert.equal(task.state, 'done');
  }
  try {
    await server.init();
    await call('GET', '/identity');
    await call('GET', '/identity');
    assert.equal(discoveryPrompts, 1);
    const pair = await server.openPairing();
    clearInterval(server.timer);
    assert.equal((await call('GET', '/meetings')).status, 401);
    assert.equal((await call('GET', '/options')).status, 401);
    assert.equal(
      (await call('POST', '/pair', { name: 'test', code: '000000', nonce: 'a'.repeat(32) })).status,
      403,
    );
    const linked = await call('POST', '/pair', {
      name: 'test',
      code: pair.pin,
      nonce: 'a'.repeat(32),
    });
    assert.equal(linked.status, 200);
    const connectedAt = server.status().devices[0].firstConnectedAt;
    assert.ok(Number.isFinite(Date.parse(connectedAt)));
    assert.equal(server.status().devices[0].recordingCount, 0);
    const token = linked.body.token;
    assert.equal(
      (await call('POST', '/pair', { name: 'test', code: pair.pin, nonce: 'a'.repeat(32) })).status,
      403,
    );
    const id = randomUUID();
    const session = {
      id,
      title: '移动会议',
      language: 'en',
      num_speakers: 3,
      target_language: 'zh',
      workspace_id: randomUUID(),
      refined_model_id: 'test-model',
    };
    assert.equal(
      (await call('POST', '/meetings', { ...session, num_speakers: 0 }, token)).status,
      400,
    );
    assert.equal((await call('POST', '/meetings', session, token)).status, 200);
    assert.equal(
      server.status().devices.find((d) => d.id === linked.body.deviceId).connected,
      true,
    );
    assert.equal(
      (await call('POST', `/meetings/${id}/state`, { state: 'paused' }, token)).status,
      200,
    );
    assert.equal(server.status().sessions[0].state, 'paused');
    assert.equal((await call('POST', '/meetings', session, token)).status, 200);
    assert.equal(
      (await call('GET', `/meetings/${randomUUID()}/snapshot`, null, token)).status,
      404,
    );
    const secondPair = await server.openPairing();
    const second = await call('POST', '/pair', {
      name: 'other phone',
      code: secondPair.pin,
      nonce: 'b'.repeat(32),
    });
    assert.equal((await call('GET', '/meetings', null, second.body.token)).body.length, 0);
    assert.equal(
      (await call('GET', `/meetings/${id}/snapshot`, null, second.body.token)).status,
      404,
    );
    assert.equal((await call('POST', '/meetings', session, second.body.token)).status, 404);
    assert.equal(
      (
        await call(
          'POST',
          `/meetings/${id}/action`,
          { action: 'refine', request_id: randomUUID() },
          token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          'POST',
          `/meetings/${id}/action`,
          { action: 'refine', request_id: randomUUID() },
          second.body.token,
        )
      ).status,
      404,
    );
    await server.requestStop(id);
    await server.requestStop(id);
    assert.equal(
      (await call('GET', `/meetings/${id}/snapshot`, null, token)).body.stopRequested,
      true,
    );
    assert.equal(server.sessions.get(id).ended, false); // Phone must flush and acknowledge first.
    const chunk = { seq: 0, start_sample: 0, pcm: Buffer.from([1, 0, 2, 0]).toString('base64') };
    assert.equal(
      (await call('PUT', `/meetings/${id}/chunks`, { ...chunk, seq: 1 }, token)).status,
      409,
    );
    assert.equal((await call('PUT', `/meetings/${id}/chunks`, chunk, token)).body.next, 1);
    assert.equal((await call('PUT', `/meetings/${id}/chunks`, chunk, token)).body.next, 1);
    assert.equal(
      (await call('PUT', `/meetings/${id}/chunks`, { ...chunk, pcm: 'AAAAAA==' }, token)).status,
      409,
    );
    assert.equal(
      (await call('POST', `/meetings/${id}/end`, { count: 2, samples: 4 }, token)).status,
      409,
    );
    // Restart between durable acknowledgment and worker consumption.
    await server.disable();
    server = new MobileServer(options);
    await server.init();
    await server.enable();
    clearInterval(server.timer);
    assert.equal((await call('PUT', `/meetings/${id}/chunks`, chunk, token)).body.next, 1);
    const snapshot = await call('GET', `/meetings/${id}/snapshot`, null, token);
    assert.equal(
      server.status().devices.find((d) => d.id === linked.body.deviceId).firstConnectedAt,
      connectedAt,
    );
    assert.equal(
      server.status().devices.find((d) => d.id === linked.body.deviceId).recordingCount,
      1,
    );
    assert.equal(server.sessions.get(id).state, 'paused');
    assert.equal(snapshot.body.stopRequested, true); // Stop survives desktop restart.
    assert.equal(snapshot.body.notes, 'notes from PC');
    assert.equal(snapshot.body.audio, undefined);
    assert.equal(
      (await call('POST', `/meetings/${id}/end`, { count: 1, samples: 2 }, token)).status,
      200,
    );
    await server.drain();
    await server.drain();
    assert.equal(deliveries.filter((v) => v.action === 'chunk').length, 1);
    const start = deliveries.find((v) => v.action === 'start');
    assert.equal(start.workspace_id, session.workspace_id);
    assert.equal(start.target_language, 'zh');
    assert.equal(start.num_speakers, 3);
    assert.equal(start.refined_model_id, 'test-model');
    assert.deepEqual(start.tags, ['手机录音']);
    assert.equal(server.sessions.get(id).finished, true);
    const task = { action: 'refine', request_id: randomUUID() };
    assert.equal((await call('POST', `/meetings/${id}/action`, task, token)).status, 200);
    await waitForTask(id, token);
    await call('POST', `/meetings/${id}/action`, task, token);
    assert.equal(commands.filter((c) => c === 'meeting.refine').length, 1);
    assert.equal(
      (
        await call(
          'POST',
          `/meetings/${id}/action`,
          {
            action: 'translate',
            request_id: randomUUID(),
            target_language: 'invalid',
            consent: true,
          },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          'POST',
          `/meetings/${id}/action`,
          { action: 'translate', request_id: randomUUID(), target_language: 'en', consent: false },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          'POST',
          `/meetings/${id}/action`,
          { action: 'translate', request_id: randomUUID(), target_language: 'en', consent: true },
          token,
        )
      ).status,
      200,
    );
    await waitForTask(id, token);
    assert.equal(commands.filter((c) => c === 'mobile.translate').length, 1);
    assert.equal(
      (
        await call(
          'POST',
          `/meetings/${id}/action`,
          { action: 'workspace', workspace_id: null },
          token,
        )
      ).status,
      200,
    );
    assert.equal(server.sessions.get(id).workspace_id, null);
    const resumedId = randomUUID();
    await call('POST', '/meetings', { ...session, id: resumedId }, token);
    await call('PUT', `/meetings/${resumedId}/chunks`, chunk, token);
    await server.finishReceived(resumedId);
    await server.drain();
    await server.drain();
    assert.equal(server.sessions.get(resumedId).finished, true);
    const tail = { ...chunk, seq: 1, start_sample: 2 };
    assert.equal((await call('PUT', `/meetings/${resumedId}/chunks`, tail, token)).status, 200);
    assert.equal(server.sessions.get(resumedId).finished, false);
    await call('POST', `/meetings/${resumedId}/end`, { count: 2, samples: 4 }, token);
    await server.drain();
    await server.drain();
    assert.equal(server.sessions.get(resumedId).finished, true);
    // 后端删除的标记必须覆盖内存缓存，离线客户端不能重建会议。
    await server.save({
      id: resumedId,
      owner: linked.body.deviceId,
      deleted: true,
      finished: true,
    });
    await server.refreshDeleted();
    assert.equal(
      (await call('POST', '/meetings', { ...session, id: resumedId }, token)).status,
      410,
    );
    assert.equal((await call('GET', `/meetings/${resumedId}/snapshot`, null, token)).status, 410);
    assert.equal(
      server.status().sessions.some((s) => s.id === resumedId),
      false,
    );
    await server.revoke(linked.body.deviceId);
    assert.equal((await call('GET', '/meetings', null, token)).status, 401);
    console.log(
      'mobile server: TLS pairing, authorization, durable retry, conflict detection and finalization passed',
    );
  } finally {
    await server.disable();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
