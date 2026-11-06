const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { download } = require('./build.cjs');

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
    if (route === '/missing') response.statusCode = 404;
    if (route === '/busy' && count === 1) response.statusCode = 503;
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
      const busy = path.join(scratch, 'busy.bin');
      await download('https://dependency.test/busy', busy, sha);
      assert.equal(requests.get('/busy'), 2);
      assert.deepEqual(fs.readFileSync(busy), payload);
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
