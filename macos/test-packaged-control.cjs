// 用成品中的 Node、控制层和原生业务 worker 跑完一场会议；只有系统设备输入由固定 PCM 替代。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');

async function test() {
  const resources = path.join(path.resolve(process.argv[2]), 'Contents/Resources');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'brevia-native-test-'));
  const cli = spawnSync(
    path.join(path.resolve(process.argv[2]), 'Contents/MacOS/brevia'),
    ['status', '--no-start'],
    {
      env: { ...process.env, BREVIA_DATA_DIR: scratch },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(cli.status, 0, cli.stderr || cli.error?.message);
  assert.deepEqual(JSON.parse(cli.stdout), { ok: true, result: { running: false, ready: false } });
  await fs.access(path.join(resources, 'skills/brevia/SKILL.md'));
  const helper = path.join(scratch, 'input');
  await fs.writeFile(
    helper,
    `#!/bin/sh
printf '%s\\n' '{"type":"ready","micFellBack":false}'
while read -r cmd; do
  if [ "$cmd" = stop ]; then
    printf '%s\\n' '{"type":"audio","track":"mic","sample_rate":16000,"start_ms":0,"pcm":"${Buffer.alloc(3200, 1).toString('base64')}"}'
  fi
  printf '{"type":"ack","command":"%s"}\\n' "$cmd"
  if [ "$cmd" = stop ]; then exit 0; fi
done\n`,
    { mode: 0o700 },
  );
  const child = spawn(
    path.join(resources, 'control/node'),
    [path.join(resources, 'control/control.cjs')],
    {
      env: {
        ...process.env,
        BREVIA_RESOURCES: resources,
        BREVIA_AUDIO_HELPER: helper,
        BREVIA_DATA_DIR: scratch,
        BREVIA_MODELS_DIR: path.join(scratch, 'models'),
        BREVIA_MEETINGS_DIR: path.join(scratch, 'meetings'),
        BREVIA_MOBILE_PORT: '0',
        BREVIA_PYTHON: '/deliberately-unavailable-python',
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  const exited = once(child, 'exit');
  const requests = new Map();
  let next = 0,
    loaded,
    startupError;
  const start = new Promise((resolve, reject) => {
    loaded = resolve;
    startupError = reject;
  });
  const write = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  const call = (channel, payload = {}, label = 'main') =>
    new Promise((resolve, reject) => {
      const id = ++next;
      requests.set(id, { resolve, reject });
      write({ id, label, channel, payload });
    });
  const timer = setTimeout(() => child.kill(), 60000);
  exited.then(() => {
    const error = new Error('control exited');
    startupError(error);
    for (const request of requests.values()) request.reject(error);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    if ('native' in msg) {
      write({ native: msg.native, result: true });
      if (msg.method === 'window.create') {
        write({ host: 'window.loaded', label: msg.args.label });
        if (msg.args.label === 'main') loaded();
      }
      if (msg.method === 'dialog.message') startupError(new Error(msg.args.message));
    } else if ('id' in msg) {
      const request = requests.get(msg.id);
      requests.delete(msg.id);
      if (msg.error || msg.result?.__brevia_error)
        request.reject(new Error(msg.error || msg.result.__brevia_error.detail));
      else request.resolve(msg.result);
    }
  });
  try {
    await start;
    const state = await call('app.initialize');
    assert.ok(state.meetings.length);
    const agent = await call('agent.settings.get');
    assert.equal(agent.enabled, true);
    assert.equal(typeof agent.mcp, 'object');
    assert.doesNotMatch(JSON.stringify(agent), /Bearer|"tokens"/);
    const promptDefaults = await call('prompts.get');
    assert.deepEqual(promptDefaults, { summary: '', ai_note: '', translation: '' });
    const preferences = { ...promptDefaults, summary: 'Keep the notes concise.' };
    assert.deepEqual(await call('prompts.save', preferences), preferences);
    assert.deepEqual(await call('prompts.get'), preferences);
    await call('prompts.save', promptDefaults);
    const model = state.models.find((m) => m.id === 'funasr-nano-int8');
    assert.equal(model.status, 'not_installed');
    assert.equal(model.runtime_tier, 'core');
    assert.ok(state.models.some((m) => m.id === 'funasr-nano-mlx' && m.runtime_tier === 'core'));
    await assert.rejects(call('meeting.delete', {}, 'floating-caption'));
    const config = {
      title: 'Native offline smoke',
      language: 'zh',
      refined_model_id: model.id,
      audio_tracks: ['mic'],
    };
    await call('native-audio.prepare', { mic: true, system: false, preview: false });
    const meeting = await call('meeting.start', config);
    assert.ok(meeting.id);
    await call('native-audio.start', { meeting_id: meeting.id });
    for (const paused of [true, false]) {
      await call('native-audio.pause', { paused });
      await call('meeting.pause', { meeting_id: meeting.id, paused });
    }
    await call('native-audio.stop');
    const saved = await call('meeting.stop', { meeting_id: meeting.id, duration_ms: 100 });
    assert.equal(saved.id, meeting.id);
    const detail = await call('meeting.get', { meeting_id: meeting.id });
    assert.equal(detail.title, config.title);
    const directory = path.join(scratch, 'meetings', meeting.id, 'audio');
    const files = await fs.readdir(directory);
    const mic = files.find((file) => file.startsWith('mic-') && file.endsWith('.wav'));
    assert.ok(mic, files);
    const wav = await fs.readFile(path.join(directory, mic));
    assert.equal(wav.readUInt32LE(40), 3200);
    assert.deepEqual(wav.subarray(44), Buffer.alloc(3200, 1));
    console.log(
      'Packaged control: offline startup, isolated window IPC, recording, pause, resume, final PCM and meeting storage passed.',
    );
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(kill);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
