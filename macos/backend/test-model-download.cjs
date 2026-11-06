const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { ModelManager } = require('./models.cjs');
const { TaskControl } = require('./tasks.cjs');
const { binaries } = require('../runtime/package.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-download-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const catalogPath = path.join(root, 'models.json');
  fs.writeFileSync(
    catalogPath,
    JSON.stringify([
      { id: 'other-platform', revision: 'v1', files: ['model'], platforms: ['win32'] },
    ]),
  );
  return { root, manager: new ModelManager(path.join(root, 'models'), () => {}, { catalogPath }) };
}

test('下载逐跳限制 HTTPS，拒绝降级前不发送下一请求', async (t) => {
  const { root, manager } = fixture(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    assert.equal(new URL(url).protocol, 'https:');
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://unsafe.example/model' },
    });
  });
  await assert.rejects(
    manager.downloadFile(
      'https://safe.example/model',
      path.join(root, 'partial'),
      new TaskControl(),
      () => {},
    ),
    /Unsafe model redirect/,
  );
  assert.equal(calls, 1);
});

test('断点续传核对 Content-Range 并完整追加原始字节', async (t) => {
  const { root, manager } = fixture(t),
    file = path.join(root, 'partial');
  fs.writeFileSync(file, 'abc');
  const progress = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=3-');
    return new Response(new Uint8Array(Buffer.from('def')), {
      status: 206,
      headers: { 'Content-Range': 'bytes 3-5/6' },
    });
  });
  await manager.downloadFile('https://example.com/model', file, new TaskControl(), (size) =>
    progress.push(size),
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'abcdef');
  assert.deepEqual(progress, [3, 6]);
});

// Real bzip2-compressed tar fixtures: regular file, traversal, symlink, 8 MiB file.
const archives = {
  regular:
    'QlpoOTFBWSZTWVZT2v8AADnbkNsAQADjhAgAZuaewAQAABggAFRBIA0DygaPKbSDEoxA0ADQBCSh8Q9wBE3CBYEOA8QouTINXKd6JSBvQMDIASqBISAQHWLNOTKoUn9g7O7qNDEfxdyRThQkFZT2v8A=',
  traversal:
    'QlpoOTFBWSZTWeh44CsAAB/bkNsAQAHlhACAagBeQAQAABggAFRGimRkyGAm0gSKRpkAABpPZyoiyIIq5YoCIh6ybbZpfTEjJizcGKZkEoZFXZGpUxRgwqr6pZ03WB9AD8XckU4UJDoeOArA',
  symlink:
    'QlpoOTFBWSZTWQCnGYIAADnbkNEAQAH5BAwALubegABAAAggAFQ1GUA0G1A002ptQSiQ2kPUAAAR5x+BqADqCJACIjCqSK3dw3YCSiXKJCLwEMn4oRkZm7leKLWcVpMNX4Z2NozQRw/F3JFOFCQAKcZggA==',
  large:
    'QlpoOTFBWSZTWeU3sxQAADjbkNkAQADnBAgAZuaexAQAAAggAGQkUKPU0A9QYZT9UAqlAjAgxNMAfq7OdaL7MQTuxSQbhV5uTyfHWm9pNi7MUu7ODs6O0lZjc1jEaYvcr8xlF4iIAAEAA66ICIAiyEgCAHYu5IpwoSHKb2Yo',
};
function archiveInstaller(t, data, multiple = false) {
  const { root, manager } = fixture(t);
  manager.root = path.join(root, '中文模型');
  fs.mkdirSync(manager.root);
  manager.catalog.set('archive', {
    id: 'archive',
    revision: 'v1',
    files: ['weights'],
    size_bytes: 8 * 1024 * 1024,
    ...(multiple
      ? {
          downloads: [
            {
              url: 'https://example.com/model.tar.bz2',
              path: 'archive.tar.bz2',
              extract: true,
              directory: 'model',
            },
          ],
        }
      : { url: 'https://example.com/model.tar.bz2', directory: 'model' }),
  });
  manager.downloadFile = async (_url, destination) =>
    fs.writeFileSync(destination, Buffer.from(data, 'base64'));
  return { root, manager };
}
test('bzip2 archive models install with Unicode paths through both catalog download forms', async (t) => {
  for (const multiple of [false, true]) {
    const { manager } = archiveInstaller(t, archives.regular, multiple),
      installed = await manager.install('archive', new TaskControl());
    assert.equal(fs.readFileSync(path.join(installed, 'weights'), 'utf8'), 'xxxxxxx');
    assert.equal(manager.isReady('archive'), true);
    assert.deepEqual(fs.readdirSync(manager.root), ['archive-v1']);
  }
});
test(
  'malicious and truncated archives reject without escaping or leaving partial installation',
  { timeout: 10000 },
  async (t) => {
    for (const data of [archives.traversal, archives.symlink, archives.regular.slice(0, 60)]) {
      const { root, manager } = archiveInstaller(t, data);
      await assert.rejects(
        manager.install('archive', new TaskControl()),
        /model path|archive member|archive decoder|archive/i,
      );
      assert.equal(fs.existsSync(path.join(root, 'escape')), false);
      assert.deepEqual(fs.readdirSync(manager.root), []);
    }
  },
);
test(
  'cancelling bzip2 extraction closes the decoder and output files before cleanup',
  { timeout: 10000 },
  async (t) => {
    const { manager } = archiveInstaller(t, archives.large),
      control = new TaskControl(),
      wait = control.wait.bind(control);
    control.wait = async () => {
      const extracting = fs.readdirSync(manager.root).find((name) => name.startsWith('.download-'));
      if (extracting && fs.existsSync(path.join(manager.root, extracting, 'extract/model/weights')))
        control.cancel();
      await wait();
    };
    await assert.rejects(manager.install('archive', control), { name: 'TaskCancelled' });
    assert.equal(manager.isReady('archive'), false);
    assert.deepEqual(fs.readdirSync(manager.root), []);
  },
);

test('清理只移除不在全平台目录中的 Brevia 托管权重', (t) => {
  const { root, manager } = fixture(t);
  for (const [name, marker] of [
    ['old', { id: 'removed-model' }],
    ['windows', { id: 'other-platform' }],
    ['personal', null],
  ]) {
    const directory = path.join(manager.root, name);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'model'), 'weights');
    if (marker) fs.writeFileSync(path.join(directory, '.brevia.json'), JSON.stringify(marker));
  }
  const external = path.join(root, 'external');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, '.brevia.json'), '{"id":"removed-model"}');
  fs.symlinkSync(external, path.join(manager.root, 'link'));
  const result = manager.cleanupUnlisted();
  assert.deepEqual(result.removed, ['old']);
  assert.ok(result.freed_bytes > 7);
  for (const name of ['windows', 'personal', 'link'])
    assert.ok(fs.existsSync(path.join(manager.root, name)));
  assert.ok(fs.existsSync(path.join(external, '.brevia.json')));
});

test('成品审计拒绝 Python 文件和指向包外的运行依赖', async (t) => {
  const { root } = fixture(t),
    app = path.join(root, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'module.pyc'), 'compiled');
  await assert.rejects(binaries(app), /Python runtime file/);
  fs.rmSync(path.join(app, 'module.pyc'));
  fs.symlinkSync(path.join(root, 'models.json'), path.join(app, 'outside'));
  await assert.rejects(binaries(app), /External runtime symlink/);
});

test('清理可回收崩溃下载缓存，但保留其他进程仍在写入的缓存', { timeout: 10000 }, async (t) => {
  const { manager } = fixture(t),
    child = spawn(
      process.execPath,
      [
        '-e',
        `
      const fs = require('node:fs');
      const path = require('node:path');
      const { ModelManager } = require(${JSON.stringify(require.resolve('./models.cjs'))});
      const { TaskControl } = require(${JSON.stringify(require.resolve('./tasks.cjs'))});
      const manager = new ModelManager(${JSON.stringify(manager.root)});
      manager.catalog.set('fixture', {
        id: 'fixture', revision: 'v1', files: ['weights'], size_bytes: 32,
        downloads: [{ path: 'weights', url: 'https://example.com/weights' }],
      });
      manager.downloadFile = async (_url, destination) => {
        fs.writeFileSync(destination, 'partial weights');
        process.send('downloaded');
        await new Promise(() => setInterval(() => {}, 1000));
      };
      manager.install('fixture', new TaskControl()).catch(error => {
        process.send({ error: error.message });
        process.exitCode = 1;
      });
    `,
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
  t.after(() => child.kill('SIGKILL'));
  assert.equal((await once(child, 'message'))[0], 'downloaded');
  assert.deepEqual(manager.cleanupUnlisted().removed, []);
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const result = manager.cleanupUnlisted();
  assert.equal(result.removed.length, 1);
  assert.ok(result.freed_bytes >= Buffer.byteLength('partial weights'));
  assert.equal(fs.existsSync(path.join(manager.root, result.removed[0])), false);
});
