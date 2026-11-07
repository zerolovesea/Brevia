// 仅供开发测试：Playwright 驱动真实桌面控制器/Worker，系统窗口由原生宿主测试覆盖。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const resources = path.join(process.env.BREVIA_DATA_DIR, 'test-resources');
const views = new Map(),
  pending = new Map(),
  media = new Map();
let sequence = 0,
  control,
  context,
  closing = false;
const write = (value) => control.stdin.write(JSON.stringify(value) + '\n');
const invoke = (label, channel, payload) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('Desktop test command timed out: ' + channel));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    write({ id, label, channel, payload });
  });
const bridge = fs
  .readFileSync(path.join(root, 'macos/bridge.js'), 'utf8')
  .replace('/* BREVIA_PRELOAD */', fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};
const server = http.createServer((request, response) => {
  const mediaId = new URL(request.url, 'http://localhost').pathname.slice('/__media__/'.length);
  if (request.url.startsWith('/__media__/')) {
    const file = media.get(mediaId);
    if (!file || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const range = request.headers.range;
    let start = 0,
      end = size - 1;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        response.writeHead(416).end();
        return;
      }
      start = Number(match[1]);
      end = Math.min(match[2] ? Number(match[2]) : end, end);
      if (!Number.isSafeInteger(start) || start > end) {
        response.writeHead(416).end();
        return;
      }
    }
    response.writeHead(range ? 206 : 200, {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
    return;
  }
  let file;
  try {
    file = path.resolve(
      root,
      '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
    );
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (
    !file.startsWith(root + path.sep) ||
    !['frontend', 'website'].includes(path.relative(root, file).split(path.sep)[0])
  ) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) response.writeHead(404).end();
    else
      response
        .writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
        .end(data);
  });
});
async function native(method, args) {
  const view = views.get(args?.label);
  if (method === 'window.create') {
    const page = await context.newPage();
    views.set(args.label, page);
    await page.setViewportSize({ width: args.width || 1280, height: args.height || 800 });
    await page.exposeBinding('__breviaInvoke', (_source, channel, payload) =>
      invoke(args.label, channel, payload),
    );
    await page.addInitScript(
      ({ platform, bridge }) => {
        window.__BREVIA_PLATFORM__ = platform;
        const listeners = new Map();
        window.__breviaReceive = (payload) => {
          for (const fn of listeners.values()) fn({ payload });
        };
        window.__TAURI__ = {
          core: {
            invoke: (_method, { channel, payload }) => window.__breviaInvoke(channel, payload),
          },
          event: {
            listen: async (_name, fn) => {
              const id = Math.random();
              listeners.set(id, fn);
              return () => listeners.delete(id);
            },
          },
        };
        (0, eval)(bridge);
      },
      { platform: process.platform, bridge },
    );
    page.on('load', () => write({ host: 'window.loaded', label: args.label }));
    page.on('close', () => views.delete(args.label));
    const url = new URL(`/frontend/${args.page}`, `http://127.0.0.1:${server.address().port}`);
    for (const [key, value] of Object.entries(args.query || {})) url.searchParams.set(key, value);
    await page.goto(url.href);
    return true;
  }
  if (method === 'window.close') {
    await view?.close();
    return true;
  }
  if (method === 'window.setBounds' && view && args.width && args.height) {
    await view.setViewportSize({ width: Math.round(args.width), height: Math.round(args.height) });
    write({ host: 'window.bounds', label: args.label, bounds: args });
    return true;
  }
  if (method === 'window.show') {
    await view?.bringToFront();
    return true;
  }
  if (method === 'window.hide') return true;
  if (method === 'dialog.open') return { canceled: true, filePaths: [] };
  if (method === 'dialog.save') return { canceled: true };
  if (method === 'dialog.message') return { response: 0 };
  if (method === 'shell.copyText') {
    globalThis.copiedText = args.text;
    return true;
  }
  if (method === 'file.url') {
    const id = randomUUID();
    media.set(id, args.path);
    return `http://127.0.0.1:${server.address().port}/__media__/${id}`;
  }
  if (method === 'update.check') return { status: 'current' };
  if (method === 'app.quit' || method === 'app.relaunch') {
    setImmediate(stop);
    return true;
  }
  if (
    [
      'window.focus',
      'window.restore',
      'window.setZoom',
      'window.setAlwaysOnTop',
      'window.setEnabled',
      'tray.set',
      'shortcut.register',
      'shortcut.unregister',
      'shell.showItem',
      'shell.openPath',
      'shell.openExternal',
    ].includes(method)
  )
    return true;
  throw Error('Unsupported test native operation: ' + method);
}
async function stop() {
  if (closing) return;
  closing = true;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(Error('Desktop test host closed'));
  }
  pending.clear();
  control?.stdin.end();
  await context?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (control?.exitCode === null) control.kill();
}
async function main() {
  fs.mkdirSync(path.join(resources, 'control'), { recursive: true });
  for (const name of ['frontend', 'backend', 'skills'])
    fs.symlinkSync(
      path.join(root, name),
      path.join(resources, name),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  await build({
    entryPoints: [path.join(root, 'macos/backend/worker.cjs')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: path.join(resources, 'control/worker.cjs'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = process.argv.find((value) => value.startsWith('--remote-debugging-port='));
  context = await chromium.launchPersistentContext(process.env.BREVIA_TEST_USER_DATA, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: port ? [port] : [],
  });
  for (const page of context.pages()) await page.close();
  control = spawn(
    process.execPath,
    [
      '--inspect=' +
        (process.argv.find((value) => value.startsWith('--control-inspect='))?.split('=')[1] ||
          '0'),
      path.join(__dirname, 'test-host-worker.cjs'),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        BREVIA_RESOURCES: resources,
        BREVIA_MODELS_DIR: path.join(process.env.BREVIA_DATA_DIR, 'models'),
        BREVIA_MOBILE_PORT: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  control.stderr.pipe(process.stderr);
  control.on('exit', (code, signal) => {
    if (!closing) void stop().then(() => process.exit(code || (signal ? 1 : 0)));
  });
  createInterface({ input: control.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write(line + '\n');
      return;
    }
    if (message.native)
      void native(message.method, message.args).then(
        (result) => write({ native: message.native, result }),
        (error) => write({ native: message.native, error: error.message }),
      );
    else if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry?.timer);
      if (message.error) entry?.reject(new Error(message.error));
      else entry?.resolve(message.result);
    } else if (message.event) {
      const pages = message.target ? [views.get(message.target)] : [...views.values()];
      for (const page of pages)
        void page
          ?.evaluate((payload) => window.__breviaReceive?.(payload), message.event)
          .catch(() => {});
    }
  });
  process.on('SIGTERM', () => {
    void stop().then(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void stop().then(() => process.exit(0));
  });
}
main().catch((error) => {
  console.error(error);
  void stop().finally(() => process.exit(1));
});
