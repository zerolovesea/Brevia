const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const { download } = require('./build.cjs');

test('installer tools rebuild from verified archives and preserve tools on download failure', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-installer-tools-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const tools = path.join(scratch, '工具 缓存');
  const fixture = path.join(scratch, 'nsis-3.11');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'makensis.exe'), 'verified compiler');
  const archive = path.join(scratch, 'fixture.zip');
  execFileSync('tar', ['-cf', archive, '-C', scratch, 'nsis-3.11']);
  let fail = false;
  const calls = [];
  const output = { exports: {} };
  runInNewContext(fs.readFileSync(path.join(__dirname, 'installer-tools.cjs'), 'utf8'), {
    __dirname: path.join(scratch, '源码/windows'),
    module: output,
    require(name) {
      if (name !== './build.cjs') return require(name);
      return {
        async download(url, file, sha) {
          calls.push({ url, sha });
          assert.match(sha, /^[a-f0-9]{64}$/);
          if (fail && url.endsWith('.dll')) throw new Error('Download failed after 3 attempts');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          if (url.endsWith('.zip')) fs.copyFileSync(archive, file);
          else fs.writeFileSync(file, 'verified plugin');
        },
        run(command, args, options) {
          assert.equal(command, 'tar');
          assert.deepEqual(Array.from(args), ['-xf', 'nsis.zip']);
          assert.ok(fs.statSync(path.join(options.cwd, 'nsis.zip')).isFile());
          execFileSync(command, Array.from(args), options);
        },
      };
    },
  });
  const compiler = path.join(tools, 'NSIS/makensis.exe');
  const plugin = path.join(tools, 'NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll');
  for (let pass = 0; pass < 2; pass++) {
    fs.mkdirSync(path.dirname(compiler), { recursive: true });
    fs.writeFileSync(compiler, 'stale compiler');
    await output.exports.prepareInstallerTools(tools);
    assert.equal(fs.readFileSync(compiler, 'utf8'), 'verified compiler');
    assert.equal(fs.readFileSync(plugin, 'utf8'), 'verified plugin');
  }
  assert.equal(calls.length, 4, 'Even warm builds must verify both cached archives');
  assert.ok(calls.every(({ url }) => url.startsWith('https://github.com/tauri-apps/')));
  fail = true;
  await assert.rejects(output.exports.prepareInstallerTools(tools), /after 3 attempts/);
  assert.equal(fs.readFileSync(compiler, 'utf8'), 'verified compiler');
  assert.equal(fs.readFileSync(plugin, 'utf8'), 'verified plugin');
});

test('native downloads recover bounded network failures without accepting corrupt artifacts', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-download-'));
  const payload = Buffer.from('verified native dependency\n');
  const sha = createHash('sha256').update(payload).digest('hex');
  const requests = new Map();
  const server = http.createServer((request, response) => {
    const route = request.url;
    const count = (requests.get(route) || 0) + 1;
    requests.set(route, count);
    if (route === '/disconnect' && count === 1) return request.socket.destroy();
    if (route === '/timeout' || (route === '/disconnect' && count === 2)) {
      response.writeHead(200, { 'Content-Length': payload.length });
      response.write(payload.subarray(0, 3));
      if (route === '/disconnect') setTimeout(() => response.destroy(), 10);
      return;
    }
    if (route === '/gateway' || (route === '/recover' && count === 1)) response.statusCode = 504;
    if (route === '/limited-api') response.statusCode = 403;
    if (route === '/asset' && request.headers.accept !== 'application/octet-stream')
      response.statusCode = 406;
    if (route === '/missing') response.statusCode = 404;
    if (route === '/busy' && count === 1) response.statusCode = 503;
    if (route === '/bad-gateway' && count === 1) response.statusCode = 502;
    response.end(route === '/corrupt' ? 'wrong bytes' : payload);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const route = new URL(url).pathname;
    // 本地真实 HTTP 连接负责断连和停滞；不降低生产下载器的 HTTPS 校验。
    const response = await nativeFetch(
      `http://127.0.0.1:${server.address().port}${route}`,
      options,
    );
    if (route !== '/downgrade') Object.defineProperty(response, 'url', { value: url });
    return response;
  });

  await t.test(
    'connection reset and partial response restart before reusing verified cache',
    async () => {
      const file = path.join(scratch, 'recover.bin');
      fs.writeFileSync(file, 'previous cache');
      await download('https://dependency.test/disconnect', file, sha);
      assert.equal(requests.get('/disconnect'), 3);
      assert.deepEqual(fs.readFileSync(file), payload);
      assert.ok(!fs.existsSync(file + '.part'));
      await download('https://dependency.test/disconnect', file, sha);
      assert.equal(requests.get('/disconnect'), 3, 'Verified cache must not request the network');
    },
  );

  await t.test(
    'a release gateway timeout retries the same pinned asset through the API',
    async () => {
      const file = path.join(scratch, 'release.bin');
      await download('https://dependency.test/gateway', file, sha, 'https://dependency.test/asset');
      assert.deepEqual(fs.readFileSync(file), payload);
      assert.equal(requests.get('/gateway'), 1);
      assert.equal(requests.get('/asset'), 1);
    },
  );

  await t.test('an API rate limit gives the recovered direct URL the final attempt', async () => {
    const file = path.join(scratch, 'recovered-release.bin');
    await download(
      'https://dependency.test/recover',
      file,
      sha,
      'https://dependency.test/limited-api',
    );
    assert.deepEqual(fs.readFileSync(file), payload);
    assert.equal(requests.get('/recover'), 2);
    assert.equal(requests.get('/limited-api'), 1);
  });

  await t.test('body timeout stops after three attempts and removes partial output', async (t) => {
    const nativeTimeout = AbortSignal.timeout;
    t.mock.method(AbortSignal, 'timeout', () => nativeTimeout(500));
    const file = path.join(scratch, 'timeout.bin');
    fs.writeFileSync(file, 'previous cache');
    await assert.rejects(download('https://dependency.test/timeout', file, sha), (error) => {
      assert.match(error.message, /after 3 attempts/);
      assert.ok(['TimeoutError', 'AbortError'].includes(error.cause?.name));
      return true;
    });
    assert.equal(requests.get('/timeout'), 3);
    assert.equal(fs.readFileSync(file, 'utf8'), 'previous cache');
    assert.ok(!fs.existsSync(file + '.part'));
  });

  await t.test(
    'temporary HTTP failures retry while permanent failures preserve the original error',
    async () => {
      for (const route of ['busy', 'bad-gateway']) {
        const file = path.join(scratch, route + '.bin');
        await download(`https://dependency.test/${route}`, file, sha);
        assert.equal(requests.get('/' + route), 2);
        assert.deepEqual(fs.readFileSync(file), payload);
      }
      for (const [route, message] of [
        ['corrupt', /Checksum mismatch/],
        ['missing', /HTTP 404/],
        ['downgrade', /Insecure download redirect/],
      ]) {
        const file = path.join(scratch, route + '.bin');
        fs.writeFileSync(file, 'previous cache');
        await assert.rejects(download(`https://dependency.test/${route}`, file, sha), message);
        assert.equal(requests.get('/' + route), 1);
        assert.equal(fs.readFileSync(file, 'utf8'), 'previous cache');
        assert.ok(!fs.existsSync(file + '.part'));
      }
    },
  );
});
