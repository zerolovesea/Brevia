const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const { AgentService, locations } = require('./agent-service.cjs');
const { transport, credentials } = require('./agent-client.cjs');

const fixture = `
const { AgentService } = require(process.argv[1]);
const service = new AgentService({root: process.argv[2], status: () => ({pid: process.pid})});
process.on('message', async () => {await service.close();process.exit(0);});
service.listen().then(() => { service.ready = true; process.send({ready:true, pid:process.pid}); }, error => process.send({error:error.code,message:error.message}, () => process.exit(0)));
`;
function launch(root, children) {
  const child = spawn(
    process.execPath,
    ['-e', fixture, require.resolve('./agent-service.cjs'), root],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    let error = '';
    child.stderr.on('data', (part) => {
      error += part;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Lock child timed out: ' + error));
    }, 10000);
    child.once('error', reject);
    child.once('message', (message) => {
      clearTimeout(timer);
      resolve({ child, ...message });
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Child exited before ready: ' + error));
    });
  });
}
async function cleanup(children, root) {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }),
  );
  if (process.platform !== 'win32')
    fs.rmSync(locations(root).socketDirectory, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

test(
  'one owner survives concurrent crash recovery; contenders cannot unlink a live socket',
  { skip: process.platform === 'win32' },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-lock-'));
    const children = [];
    try {
      const original = await launch(root, children);
      assert.equal(original.ready, true);
      const oldToken = credentials(root, 'read').token;
      const dead = once(original.child, 'exit');
      original.child.kill('SIGKILL');
      await dead;
      assert.ok(fs.existsSync(locations(root).socket));
      const attempts = await Promise.all(Array.from({ length: 8 }, () => launch(root, children)));
      const owners = attempts.filter((attempt) => attempt.ready);
      assert.equal(
        owners.length,
        1,
        JSON.stringify(attempts.map(({ ready, error }) => ({ ready, error }))),
      );
      for (const attempt of attempts.filter((attempt) => !attempt.ready))
        assert.equal(attempt.error, 'already_running');
      assert.notEqual(credentials(root, 'read').token, oldToken);
      let result = await transport(credentials(root, 'read'), 'app.status', {});
      assert.equal(result.pid, owners[0].pid);
      fs.symlinkSync(root, path.join(root, 'alias'));
      const contender = await launch(path.join(root, 'alias'), children);
      assert.equal(contender.error, 'already_running');
      result = await transport(credentials(root, 'read'), 'app.status', {});
      assert.equal(result.pid, owners[0].pid);
      const ended = once(owners[0].child, 'exit');
      owners[0].child.send('close');
      await ended;
      const replacement = await launch(root, children);
      assert.equal(replacement.ready, true);
    } finally {
      await cleanup(children, root);
    }
  },
);

test('an occupied recovery port fails closed without touching credentials or socket', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-lock-port-'));
  const info = locations(root);
  const blocker = net.createServer((socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(info.recoveryPort, '127.0.0.1', resolve);
    });
    const service = new AgentService({ root });
    await assert.rejects(service.listen(), { code: 'already_running' });
    assert.equal(fs.existsSync(info.credentials), false);
    assert.equal(fs.existsSync(info.socket), false);
  } finally {
    if (blocker.listening) await new Promise((resolve) => blocker.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  'long data directories and symlink aliases resolve to one short private socket',
  { skip: process.platform === 'win32' },
  async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-long-'));
    const root = path.join(base, 'long-directory-'.repeat(12));
    const children = [];
    fs.mkdirSync(root);
    try {
      const owner = await launch(root, children);
      assert.equal(owner.ready, true);
      assert.ok(Buffer.byteLength(locations(root).socket) < 100);
      assert.equal(fs.statSync(locations(root).socketDirectory).mode & 0o777, 0o700);
      const alias = path.join(base, 'alias');
      fs.symlinkSync(root, alias);
      assert.equal(locations(alias).socket, locations(root).socket);
      assert.equal((await transport(credentials(alias, 'read'), 'app.status', {})).pid, owner.pid);
    } finally {
      await cleanup(children, root);
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  'socket directories cannot be redirected through symlinks',
  { skip: process.platform === 'win32' },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-socket-link-'));
    const info = locations(root);
    fs.symlinkSync(root, info.socketDirectory);
    try {
      await assert.rejects(new AgentService({ root }).listen(), {
        code: 'unsafe_control_directory',
      });
      assert.equal(fs.existsSync(info.credentials), false);
    } finally {
      fs.unlinkSync(info.socketDirectory);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
