/**
 * 端到端冒烟测试：启动真实的 Electron 应用，通过 CDP 连到真实渲染进程断言。
 *
 * 为什么需要它：`test-main-logic.mjs` 只覆盖纯逻辑接缝，`test-ui.mjs` 是源码文本断言。
 * 本项目的前端是 14 个共享全局作用域的 classic script，**index.html 的 script 顺序就是
 * 依赖图**——任何一个文件在加载期抛 ReferenceError，只有真实启动才能发现。这个测试
 * 因此会先 attach 再 reload 一次，专门吞下加载期异常。
 *
 * 不引入新依赖：用 Node 内置的 fetch + WebSocket 直接讲 CDP。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 全局 `WebSocket` 从 Node 22 起才默认可用（fetch 从 Node 18 起）。缺了它这里会以
// 一句「WebSocket is not defined」失败，看不出是 Node 版本问题，因此显式说明要求。
// CI（release.yml 的 node-version）与 README 的前置条件都是 Node 22+。
if (typeof WebSocket === 'undefined') {
  console.error(`E2E 需要 Node.js 22+（内置全局 WebSocket）；当前为 ${process.version}。`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Electron 可执行文件路径，跨平台。 */
function electronBinary() {
  // `require('electron')` 在 Node（非 Electron）下返回可执行文件路径，Windows 也适用；
  // 直接 spawn `node_modules/.bin/electron` 在 Windows 上会失败（那是 sh 脚本，没有 .exe）。
  try {
    return createRequire(import.meta.url)('electron');
  } catch {
    return path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  }
}

/** 项目 venv 的 python 路径；开发机存在才覆盖 BREVIA_PYTHON。 */
function venvPython() {
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.venv', 'Scripts', 'python.exe')]
    : [path.join(root, '.venv', 'bin', 'python')];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

const electronBin = electronBinary();
const pythonBin = venvPython();

if (process.env.BREVIA_SKIP_E2E === '1') {
  console.log('E2E smoke skipped (BREVIA_SKIP_E2E=1).');
  process.exit(0);
}

/* 每个脚本各取一个代表性全局，用来证明整条 script 依赖链按顺序执行成功。
   顺序与 frontend/index.html 一致；漏掉的文件会在下面被交叉校验。 */
const moduleProbes = [
  ['app-state.js', 'locale'],
  ['app-actions.js', 'appActions'],
  ['app-utils.js', 'formatBytes'],
  ['backend-client.js', 'workletContexts'],
  ['ui-data.js', 'uiData'],
  ['i18n.js', 'window.BreviaI18n'],
  ['i18n-data.js', 'window.BreviaLocaleData'],
  ['i18n-runtime.js', 't'],
  ['model-selection.js', 'window.BreviaModelSelection'],
  ['asr-copy.js', 'window.BreviaAsrCopy'],
  ['ui-components.js', 'escapeHtml'],
  ['workspaces.js', 'workspaces'],
  ['app-meetings.js', 'backendMeeting'],
  ['app-meeting-detail.js', 'renderSegmentData'],
  ['onboarding.js', 'window.BreviaOnboarding'],
  ['app.js', 't'],
];

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 最小 CDP 客户端：按 id 匹配响应，把事件交给 onEvent。 */
function connect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(`${message.error.message}`));
        else res(message.result);
        return;
      }
      if (message.method) onEvent(message);
    });
    socket.addEventListener('error', () => reject(new Error('CDP websocket error')));
    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }));
  });
}

/** 等待调试端口上出现页面目标。 */
async function waitForTarget(port, deadline, exited) {
  while (Date.now() < deadline) {
    if (exited()) return null; // Electron 提前退出时立即失败，不干等到超时。
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 端口还没起来，继续等。 */ }
    await delay(150);
  }
  return null;
}

/* 临时目录放在工作区内：DSH 文件沙箱只允许写工作区，Chromium 需要往 user-data-dir
   写 DevToolsActivePort 等文件。--no-sandbox 让 Electron 的子进程能在该沙箱下起来。 */
const sandboxRoot = path.join(root, '.e2e-tmp');
rmSync(sandboxRoot, { recursive: true, force: true });
const dataDir = path.join(sandboxRoot, 'data');
const userDataDir = path.join(sandboxRoot, 'userdata');
mkdirSync(dataDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });

const port = await freePort();
const childEnv = { ...process.env, BREVIA_DATA_DIR: dataDir };
// 只在开发机的 venv 真实存在时覆盖；CI 用 setup-python，写死 .venv 路径会让 worker 起不来。
if (process.env.BREVIA_PYTHON || pythonBin) childEnv.BREVIA_PYTHON = process.env.BREVIA_PYTHON || pythonBin;
const child = spawn(electronBin, [
  '.',
  '--no-sandbox',
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${port}`,
], {
  cwd: root,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});

let mainOutput = '';
child.stdout.on('data', (chunk) => { mainOutput += chunk; });
child.stderr.on('data', (chunk) => { mainOutput += chunk; });
let earlyExit = null;
let spawnError = null;
child.on('exit', (code, signal) => { earlyExit = { code, signal }; });
// 没有这个 handler 时，spawn 失败（例如 Windows 上二进制不可执行）会变成未捕获异常。
child.on('error', (error) => { spawnError = error; });

const cleanup = () => {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* 已退出。 */ } }
};

try {
  const target = await waitForTarget(port, Date.now() + 30000, () => earlyExit || spawnError);
  if (!target) {
    console.error(spawnError
      ? `✗ 无法启动 Electron（${electronBin}）：${spawnError.message}`
      : earlyExit
        ? `✗ Electron 在暴露渲染进程之前就退出了（code=${earlyExit.code} signal=${earlyExit.signal}）。`
        : '✗ Electron 未在 30 秒内暴露渲染进程目标。');
    console.error(mainOutput.trim().split('\n').slice(-25).join('\n'));
    cleanup();
    process.exit(1);
  }

  const pageErrors = [];
  const consoleErrors = [];
  const client = await connect(target.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text || 'unknown exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  });

  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Page.enable');

  // attach 之后 reload 一次：加载期异常才是这条 script 依赖链的真正风险。
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await client.send('Page.reload', { ignoreCache: true });
  const reloadDeadline = Date.now() + 20000;
  for (;;) {
    await delay(200);
    const state = await client.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (state.result?.value === 'complete') break;
    if (Date.now() > reloadDeadline) { failures.push('reload 后 20 秒内未完成加载'); break; }
  }
  // 加载完成后给事件队列一点时间把加载期异常送过来。
  await delay(300);

  const probe = `(() => {
    const globals = ${JSON.stringify(moduleProbes.map(([, name]) => name))};
    const missing = globals.filter((name) => {
      try { return typeof eval(name) === 'undefined'; } catch { return true; }
    });
    // 'Brevia' 是真实词条（zh 下为「言录」），既是标题来源也是可靠的翻译探针。
    const probeKey = 'Brevia';
    return {
      brandTitle: typeof t === 'function' ? t(probeKey) : null,
      locales: window.BreviaLocaleData ? Object.keys(window.BreviaLocaleData.catalog).length : 0,
      readyState: document.readyState,
      title: document.title,
      missing,
      views: document.querySelectorAll('.view').length,
      scripts: document.querySelectorAll('script[src]').length,
      translated: typeof t === 'function' ? t(probeKey) : null,
      locale: typeof locale === 'undefined' ? null : locale,
      navItems: document.querySelectorAll('[data-view]').length,
    };
  })()`;

  const result = await client.send('Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: false });
  if (result.exceptionDetails) {
    failures.push(`探针求值抛错：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
  }
  const value = result.result?.value || {};

  check(value.readyState === 'complete', `document.readyState = ${value.readyState}`);
  check(value.title && value.title === value.brandTitle, `document.title = ${value.title}，期望 t('Brevia') = ${value.brandTitle}`);
  check((value.missing || []).length === 0, `脚本依赖链缺失全局：${(value.missing || []).join(', ')}`);
  check(value.views >= 5, `视图数量 ${value.views} < 5`);
  check(value.scripts === moduleProbes.length, `script 标签数 ${value.scripts} != 探针数 ${moduleProbes.length}（index.html 增删脚本后要同步这里）`);
  check(typeof value.translated === 'string' && value.translated !== 'Brevia', `t('Brevia') 未翻译（回落到键名）：${value.translated}`);
  check(value.locales === 8, `i18n 词条语言数 ${value.locales} != 8`);
  check(value.navItems > 0, '[data-view] 导航项为 0');
  check(pageErrors.length === 0, `渲染进程加载期异常：\n  ${pageErrors.join('\n  ')}`);

  /* 应用自身把可预期的失败写进 console.error（例如临时数据目录里没有模型），
     这里只报告不判负，避免把"测试环境缺模型"误判成回归。 */
  if (consoleErrors.length) {
    console.log(`  · 渲染进程 console.error ${consoleErrors.length} 条（测试环境预期内，未判负）`);
  }

  client.close();
  cleanup();
  await delay(400);

} catch (error) {
  failures.push(`E2E 运行失败：${error.message}`);
  cleanup();
} finally {
  cleanup();
  try { rmSync(sandboxRoot, { recursive: true, force: true }); } catch { /* 临时目录可能已被系统回收。 */ }
}

if (failures.length) {
  console.error('E2E smoke failed:');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('E2E smoke passed.');
process.exit(0);
