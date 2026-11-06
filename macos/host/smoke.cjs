// 用法：node macos/host/smoke.cjs [Brevia.app 或 Windows 应用目录]。不请求设备权限。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');

async function smoke() {
  const bundle = path.resolve(process.argv[2] || 'dist/native/image/Brevia.app');
  const windows = process.platform === 'win32';
  const resources = path.join(bundle, windows ? 'resources' : 'Contents/Resources');
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-webkit-smoke-')));
  const contents = path.join(temp, windows ? 'Host' : 'Host/Contents');
  const host = path.join(contents, windows ? 'Brevia.exe' : 'MacOS/brevia-host');
  const data = path.join(temp, 'data');
  let child;
  let debugPort;
  if (windows) {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    debugPort = server.address().port;
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    fs.mkdirSync(path.dirname(host), { recursive: true });
    if (windows) {
      fs.copyFileSync(path.join(bundle, 'Brevia.exe'), host);
      const loader = path.join(bundle, 'WebView2Loader.dll');
      if (fs.existsSync(loader)) fs.copyFileSync(loader, path.join(contents, 'WebView2Loader.dll'));
    } else {
      fs.mkdirSync(path.join(contents, 'Resources'));
      fs.copyFileSync(path.join(bundle, 'Contents/Info.plist'), path.join(contents, 'Info.plist'));
      fs.copyFileSync(path.join(bundle, 'Contents/MacOS/brevia-host'), host);
      fs.chmodSync(host, 0o755);
    }
    const env = {
      ...process.env,
      BREVIA_CONTROL_NODE: path.join(resources, 'control', windows ? 'node.exe' : 'node'),
      BREVIA_CONTROL_ENTRY: __filename,
      BREVIA_SMOKE_RESOURCES: resources,
      BREVIA_DATA_DIR: data,
      BREVIA_MODELS_DIR: path.join(data, 'models'),
      BREVIA_MEETINGS_DIR: path.join(data, 'meetings'),
      BREVIA_PYTHON: '/deliberately-unavailable-python',
      BREVIA_MOBILE_PORT: '0',
      ...(windows
        ? {
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
            BREVIA_SMOKE_DEBUG_PORT: String(debugPort),
          }
        : {}),
    };
    child = spawn(host, [], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    try {
      const [code, signal] = await once(child, 'exit');
      assert.equal(code, 0, 'host stopped with ' + (signal || code));
      assert.ok(fs.existsSync(path.join(data, 'smoke-passed')), 'control smoke did not finish');
    } finally {
      clearTimeout(timer);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function evaluateWebView(expression) {
  const port = Number(process.env.BREVIA_SMOKE_DEBUG_PORT);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(
    (item) => item.type === 'page' && /^http:\/\/tauri\.localhost(?:\/|$)/.test(item.url),
  );
  assert.ok(target?.webSocketDebuggerUrl, 'WebView2 main document debugger');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const finish = (error, value) => {
      clearTimeout(timeout);
      socket.close();
      error ? reject(error) : resolve(value);
    };
    const timeout = setTimeout(() => finish(new Error('WebView2 image probe timed out')), 15000);
    socket.addEventListener(
      'open',
      () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        ),
      { once: true },
    );
    socket.addEventListener('error', () => finish(new Error('WebView2 debugger disconnected')), {
      once: true,
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      const error = message.error || message.result?.exceptionDetails;
      finish(error ? new Error(JSON.stringify(error)) : null, message.result?.result?.value);
    });
  });
}

async function proxy() {
  if (process.env.BREVIA_WAIT_FOR_HOST === '1') {
    const byte = Buffer.alloc(1);
    let line = '';
    while (line.length < 64 && !line.endsWith('\n')) {
      assert.equal(fs.readSync(0, byte, 0, 1, null), 1, 'host handshake disconnected');
      line += byte.toString('ascii');
    }
    assert.equal(line, '{"host":"ready"}\n');
  }
  const resources = process.env.BREVIA_SMOKE_RESOURCES;
  const data = process.env.BREVIA_DATA_DIR;
  const worker = spawn(process.execPath, [path.join(resources, 'control/control.cjs')], {
    env: { ...process.env, BREVIA_RESOURCES: resources, BREVIA_WAIT_FOR_HOST: '0' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map();
  let id = 0;
  let published = false;
  let loaded = false;
  let started = false;
  const write = (pipe, object) => pipe.write(JSON.stringify(object) + '\n');
  const command = (channel, payload = {}) =>
    new Promise((resolve, reject) => {
      const requestId = 'smoke-' + ++id;
      pending.set(requestId, { resolve, reject });
      write(worker.stdin, { id: requestId, channel, payload, label: 'main' });
    });
  const fail = (error) => {
    console.error('Brevia native webview smoke failed:', error);
    worker.stdin.end();
    process.exitCode = 1;
    write(process.stdout, { native: 'smoke-exit', method: 'app.quit', args: {} });
  };
  async function probe() {
    if (started || !loaded || !published) return;
    started = true;
    const initial = await command('app.initialize');
    assert.ok(initial.meetings.length && initial.models.length, 'worker initialization');
    const meeting = initial.meetings[0];
    const detail = await command('meeting.get', { meeting_id: meeting.id });
    assert.ok(detail.segments.length, 'stored example transcript');
    const locations = await command('storage.locations');
    const folder = path.join(locations.recordings, meeting.id, 'audio');
    const source = fs.readdirSync(folder).find((file) => file.endsWith('.wav'));
    const url = await command('audio.url', path.join(folder, source));
    assert.ok(
      url.startsWith(
        process.platform === 'win32' ? 'http://asset.localhost/' : 'asset://localhost/',
      ),
      'scoped audio playback URL',
    );
    const rejected = await command('audio.url', path.join(resources, 'control/control.cjs')).catch(
      () => null,
    );
    assert.ok(!rejected || rejected.__brevia_error, 'reject playback outside meeting directory');
    if (process.platform === 'win32') {
      const image = await evaluateWebView(`(async () => {
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1kAAAAASUVORK5CYII='), c => c.charCodeAt(0)).buffer;
        const saved = await window.brevia.meeting.noteImage.save({meeting_id:${JSON.stringify(meeting.id)},mime_type:'image/png',bytes});
        const node = new Image();
        await new Promise((resolve, reject) => { node.onload=resolve; node.onerror=()=>reject(new Error('Note image did not load')); node.src=sanitizeUrl(saved.url); });
        const restored = noteImageMarkdownUrl(node.getAttribute('src'));
        if (restored !== saved.url) throw new Error('Note image changed its stored address');
        const audio = new Audio();
        await new Promise((resolve, reject) => { audio.onloadedmetadata=resolve; audio.onerror=()=>reject(new Error('Scoped audio did not load')); audio.src=${JSON.stringify(url)}; });
        return {width:node.naturalWidth, audioDuration:audio.duration};
      })()`);
      assert.equal(image.width, 1);
      assert.ok(image.audioDuration > 0);
    }
    const pdf = await command('meeting.export', {
      meeting_id: meeting.id,
      content: 'transcript',
      format: 'pdf',
    });
    assert.equal(pdf.path, path.join(data, 'smoke.pdf'));
    const bytes = fs.readFileSync(pdf.path);
    assert.equal(bytes.toString('ascii', 0, 5), '%PDF-');
    const permissions = await command('permissions.status');
    assert.ok(permissions && !permissions.__brevia_error);
    fs.writeFileSync(path.join(data, 'smoke-passed'), 'ok\n');
    console.error(
      'Native webview smoke passed: renderer IPC, packaged worker, example transcript, scoped media URL, PDF, permission status and quit.',
    );
    write(worker.stdin, { host: 'app.quit' });
  }
  createInterface({ input: process.stdin })
    .on('line', (line) => {
      const message = JSON.parse(line);
      if (message.host === 'window.loaded' && message.label === 'main') loaded = true;
      if (message.channel === 'desktop.publish' && message.label === 'main') published = true;
      write(worker.stdin, message);
      void probe().catch(fail);
    })
    .on('close', () => worker.stdin.end());
  createInterface({ input: worker.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const result = pending.get(message.id);
    if (result) {
      pending.delete(message.id);
      if (message.error) result.reject(new Error(String(message.error)));
      else result.resolve(message.result);
      return;
    }
    if (message.native) {
      const method = message.method;
      // 真正的导出经过系统 WebView 打印，仅替代交互式保存位置，避免打扰使用中的桌面。
      if (method === 'dialog.save') {
        write(worker.stdin, {
          native: message.native,
          result: { canceled: false, filePath: path.join(data, 'smoke.pdf') },
        });
        return;
      }
      if (
        [
          'window.show',
          'window.focus',
          'tray.set',
          'shortcut.register',
          'shortcut.unregister',
        ].includes(method)
      ) {
        write(worker.stdin, { native: message.native, result: true });
        return;
      }
      if (method === 'dialog.message') {
        fail(new Error(JSON.stringify(message.args)));
        return;
      }
    }
    process.stdout.write(line + '\n');
  });
  worker.on('error', fail);
}

(process.env.BREVIA_SMOKE_RESOURCES ? proxy() : smoke()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
