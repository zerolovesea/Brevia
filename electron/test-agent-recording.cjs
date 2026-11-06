const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { createRecordingController } = require('./agent-recording.cjs');
const { defaultRefinedModelId, modelSupportsLanguage } = require('../frontend/model-selection.js');

test('Agent recording defaults use real catalog models and preserve multilingual support', () => {
  const catalog = require('../backend/models.json');
  for (const language of ['auto', 'zh', 'en']) {
    const id = defaultRefinedModelId({ catalog, language, installed: new Set() });
    const model = catalog.find((item) => item.id === id);
    assert.ok(model && !model.retired);
    assert.ok(modelSupportsLanguage(model, language));
  }
});

const meetingId = 'd2d9b5ad-02ea-48c6-b3f1-218e66b75dc8';
const phoneId = 'a'.repeat(32);
const meeting = { id: meetingId, title: 'Agent recording', status: 'recording' };
function fixture({ native = true } = {}) {
  const calls = [],
    events = [];
  const worker = {
    active: null,
    async request(type, payload) {
      calls.push([type, payload]);
      return type === 'meeting.pause' ? { paused: payload.paused } : meeting;
    },
    sendEvent(type, payload) {
      events.push([type, payload]);
    },
    recycle() {
      calls.push(['recycle']);
    },
  };
  const mobileServer = {
    sessions: new Map(),
    async startCapture(target) {
      calls.push(['phone.start', target]);
      this.sessions.set(meetingId, {
        id: meetingId,
        owner: target,
        state: 'starting',
        finished: false,
        ended: false,
      });
      return meeting;
    },
    async pauseCapture(id, paused) {
      calls.push(['phone.pause', { id, paused }]);
    },
    async requestStop(id) {
      calls.push(['phone.stop', id]);
    },
  };
  const nativeAudio = {
    async prepare(inputs, append) {
      calls.push(['prepare', inputs]);
      this.append = append;
    },
    async command(type) {
      calls.push(['audio.' + type]);
    },
    async query() {
      return { systemAudioSupported: true };
    },
  };
  const desktop = {
    state: { ready: true },
    update(state) {
      this.state = state;
    },
  };
  const action = createRecordingController({
    worker,
    mobileServer,
    nativeAudio: native ? nativeAudio : null,
    desktop,
    parseStart: (payload) => ({
      title: payload.title || 'Agent recording',
      refined_model_id: 'local-model',
    }),
    parseAudio: (payload) => payload,
    resetCaptions() {
      calls.push(['captions.reset']);
    },
  });
  return { action, worker, mobileServer, nativeAudio, desktop, calls, events };
}

test('同一请求复用结果；不同参数拒绝；并发开始只能打开一次设备', async () => {
  const f = fixture();
  const payload = { action: 'start', request_id: 'start-1' };
  const first = f.action(payload);
  assert.equal(f.action({ ...payload }), first);
  assert.throws(() => f.action({ ...payload, title: 'Changed' }), { code: 'REQUEST_CONFLICT' });
  const second = f.action({ ...payload, request_id: 'start-2' });
  const secondRejected = assert.rejects(second, { code: 'RECORDING_BUSY' });
  const result = await first;
  await secondRejected;
  assert.equal(result.confirmed, true);
  assert.equal(result.state, 'recording');
  assert.equal(f.calls.filter(([name]) => name === 'prepare').length, 1);
});

test('电脑开始等待原生 ack；暂停恢复和停录复用业务层并先排空 PCM', async () => {
  const f = fixture();
  let confirm;
  f.nativeAudio.command = async (type) => {
    f.calls.push(['audio.' + type]);
    if (type === 'start')
      await new Promise((resolve) => {
        confirm = resolve;
      });
    if (type === 'stop') await f.nativeAudio.append({ meeting_id: meetingId, pcm: 'last PCM' });
  };
  const starting = f.action({ action: 'start', request_id: 'start' });
  await delay(0);
  assert.equal(f.events.length, 0, '发出采集指令不等于开始');
  confirm();
  await starting;
  await f.action({ action: 'pause', request_id: 'pause', meeting_id: meetingId });
  assert.equal(f.worker.active.paused, true);
  await f.action({ action: 'resume', request_id: 'resume' });
  assert.equal(f.worker.active.paused, false);
  await f.action({ action: 'stop', request_id: 'stop' });
  const names = f.calls.map(([name]) => name);
  assert.ok(names.indexOf('meeting.audio') < names.indexOf('meeting.stop'));
  assert.equal(f.worker.active, null);
  assert.equal(f.desktop.state.phase, 'saved');
});

test('开始 ack 失败关闭本次采集并保留可恢复会议，不发成功事件', async () => {
  const f = fixture();
  f.nativeAudio.command = async (type) => {
    f.calls.push(['audio.' + type]);
    if (type === 'start') throw new Error('microphone failed');
  };
  await assert.rejects(f.action({ action: 'start', request_id: 'fail' }), /microphone failed/);
  assert.ok(f.calls.some(([name]) => name === 'audio.stop'));
  assert.ok(f.calls.some(([name]) => name === 'meeting.stop'));
  assert.equal(f.worker.active, null);
  assert.equal(f.events.length, 0);
});

test('设备准备失败不能停止别人的采集', async () => {
  const f = fixture();
  f.nativeAudio.prepare = async () => {
    throw new Error('Audio capture is busy');
  };
  await assert.rejects(f.action({ action: 'start', request_id: 'busy' }), /busy/);
  assert.equal(f.calls.length, 0);
});

test('手机开始、暂停、恢复、停止均等待实际状态，不使用 desiredState', async () => {
  const f = fixture();
  const starting = f.action({ action: 'start', target: phoneId, request_id: 'phone-start' });
  await delay(0);
  const session = f.mobileServer.sessions.get(meetingId);
  session.desiredState = 'recording';
  assert.equal(f.events.length, 0);
  session.state = 'recording';
  await starting;
  const pausing = f.action({ action: 'pause', target: phoneId, request_id: 'phone-pause' });
  await delay(0);
  assert.equal(f.events.length, 1);
  session.state = 'paused';
  await pausing;
  const resuming = f.action({ action: 'resume', target: phoneId, request_id: 'phone-resume' });
  await delay(0);
  assert.equal(f.events.length, 2);
  session.state = 'recording';
  await resuming;
  const stopping = f.action({ action: 'stop', target: phoneId, request_id: 'phone-stop' });
  await delay(0);
  assert.equal(f.events.length, 3);
  session.state = 'ended';
  session.ended = true;
  await stopping;
  assert.equal(f.desktop.state.phase, 'saving', '手机确认停录后仍可能有分片待同步');
});

test('手机确认超时撤回开始请求；错误请求去重不会再开麦', async (t) => {
  const f = fixture();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const payload = { action: 'start', target: phoneId, request_id: 'phone-timeout' };
  const starting = f.action(payload);
  const rejected = assert.rejects(starting, { code: 'DEVICE_TIMEOUT' });
  await delay(0);
  now += 31000;
  await rejected;
  assert.ok(f.calls.some(([name]) => name === 'phone.stop'));
  assert.equal(f.events.length, 0);
  assert.equal(f.action(payload), starting);
  assert.equal(f.calls.filter(([name]) => name === 'phone.start').length, 1);
});

test('后台启动等待录音提示就绪，超时不能打开设备', async (t) => {
  const f = fixture();
  f.desktop.state.ready = false;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const rejected = assert.rejects(f.action({ action: 'start', request_id: 'not-ready' }), {
    code: 'UI_NOT_READY',
  });
  await delay(0);
  now += 31000;
  await rejected;
  assert.equal(f.calls.length, 0);
});

test('业务暂停失败恢复采集状态，不发布已暂停', async () => {
  const f = fixture();
  await f.action({ action: 'start', request_id: 'start' });
  const originalRequest = f.worker.request;
  f.worker.request = async (type, payload) => {
    if (type === 'meeting.pause') throw new Error('could not flush recording');
    return originalRequest(type, payload);
  };
  await assert.rejects(f.action({ action: 'pause', request_id: 'pause' }), /could not flush/);
  assert.deepEqual(
    f.calls.slice(-2).map(([name]) => name),
    ['audio.pause', 'audio.resume'],
  );
  assert.equal(f.events.filter(([name]) => name === 'agent.recording').length, 1);
  assert.equal(f.desktop.state.phase, 'recording');
});

test('Windows 电脑录音复用 renderer 并等待 capture 确认，所有操作保持请求去重', async () => {
  const f = fixture({ native: false });
  const actions = [];
  let confirm;
  f.desktop.action = async (name, payload) => {
    assert.equal(name, 'agent-recording');
    actions.push(payload);
    if (payload.recording.action === 'start')
      await new Promise((resolve) => {
        confirm = resolve;
      });
    return {
      meeting_id: meetingId,
      state:
        payload.recording.action === 'pause'
          ? 'paused'
          : payload.recording.action === 'stop'
            ? 'stopped'
            : 'recording',
      confirmed: true,
    };
  };
  const payload = {
    action: 'start',
    request_id: 'windows-start',
    audio_tracks: ['mic', 'system'],
    device_id: 'microphone',
  };
  const starting = f.action(payload);
  assert.equal(f.action(payload), starting);
  await delay(0);
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].recording.audio_tracks, ['mic', 'system']);
  assert.equal(actions[0].recording.device_id, 'microphone');
  confirm();
  assert.equal((await starting).state, 'recording');
  f.worker.active = { meeting_id: meetingId };
  for (const action of ['pause', 'resume', 'stop']) {
    const result = await f.action({ action, request_id: action, meeting_id: meetingId });
    assert.equal(result.confirmed, true);
    assert.equal(actions.at(-1).meetingId, meetingId);
  }
  assert.equal(f.calls.length, 0, '控制层不能另开采集或重复调用 worker');
});

test('Windows 缺模型或采集失败不返回已开始，不自动下载或转云端', async () => {
  const f = fixture({ native: false });
  f.desktop.action = async () => ({ model_required: ['offline-asr'] });
  await assert.rejects(f.action({ action: 'start', request_id: 'missing' }), {
    code: 'MODEL_NOT_INSTALLED',
  });
  f.desktop.action = async () => {
    throw new Error('microphone denied');
  };
  await assert.rejects(f.action({ action: 'start', request_id: 'denied' }), /microphone denied/);
  f.desktop.action = async () => true;
  await assert.rejects(f.action({ action: 'start', request_id: 'unconfirmed' }), {
    code: 'DEVICE_FAILED',
  });
  assert.equal(f.events.length, 0);
});

test('Windows Agent 缺模型不能进入 UI 自动下载并延迟开麦队列', async () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const { z } = require('zod');
  const source = readFileSync(require.resolve('./main.js'), 'utf8');
  const start = source.indexOf("  handleIpc('meeting.start',");
  const end = source.indexOf('  // 仅允许导入', start);
  let handler;
  const events = [];
  const context = {
    z,
    handleIpc: (_name, callback) => {
      handler = callback;
    },
    mobileServer: { sessions: new Map() },
    nativeAudio: null,
    meetingStart: z.object({ title: z.string() }),
    worker: {
      async request(_type, payload) {
        assert.equal(payload.agent_control, undefined, '控制元数据不进入业务持久化');
        throw new Error('missing model');
      },
      sendEvent: (...args) => events.push(args),
    },
    requiredModels: () => ['offline-asr'],
  };
  runInNewContext(source.slice(start, end), context);
  const result = await handler(null, { title: 'Agent', agent_control: true });
  assert.deepEqual(result.model_required, ['offline-asr']);
  assert.equal(events.length, 0);
  await handler(null, { title: 'UI' });
  assert.equal(events[0][0], 'model.required', '普通界面保留原有下载体验');
});
