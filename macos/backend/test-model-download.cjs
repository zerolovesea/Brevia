const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
