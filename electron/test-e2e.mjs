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

// 指向打包应用的可执行文件时，同一套检查使用随包 worker，不借用开发环境 Python。
const packagedApp = process.env.BREVIA_E2E_APP;
const electronBin = packagedApp || electronBinary();
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
  ['i18n-data.js', 'window.BreviaLocaleData'],
  ['i18n.js', 'window.BreviaI18n'],
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
const recordingsDir = path.join(sandboxRoot, 'recordings');
const userDataDir = path.join(sandboxRoot, 'userdata');
mkdirSync(dataDir, { recursive: true });
mkdirSync(recordingsDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });

const port = await freePort();
const childEnv = { ...process.env, BREVIA_DATA_DIR: dataDir, BREVIA_MEETINGS_DIR: recordingsDir };
// 只在开发机的 venv 真实存在时覆盖；CI 用 setup-python，写死 .venv 路径会让 worker 起不来。
if (packagedApp) delete childEnv.BREVIA_PYTHON;
else if (process.env.BREVIA_PYTHON || pythonBin) childEnv.BREVIA_PYTHON = process.env.BREVIA_PYTHON || pythonBin;
const child = spawn(electronBin, [
  ...(packagedApp ? [] : ['.']),
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
  const initialized = await client.send('Runtime.evaluate', { expression: 'initializationPromise', awaitPromise: true, returnByValue: true });
  check(!initialized.exceptionDetails, '后台初始化必须完成后再测试交互');
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
  const savedConfig = await client.send('Runtime.evaluate', { expression: `(async () => {
    const config = { version: 2, enabled: false, proactivity: 'quiet', provider: 'built-in', providers: {} };
    await window.brevia.aiAssist.config.save(config);
    return JSON.stringify(await window.brevia.aiAssist.config.get()) === JSON.stringify(config);
  })()`, awaitPromise: true, returnByValue: true });
  check(savedConfig.result?.value === true, 'AI 笔记设置经真实 IPC 保存后应从磁盘完整读回');
  const audioPlayback = await client.send('Runtime.evaluate', { expression: `(async () => {
    const data = await window.brevia.initialize();
    const meeting = await window.brevia.meeting.get({ meeting_id: data.meetings[0].id });
    const source = meeting.audio.playback.mix || meeting.audio.playback.mic || meeting.audio.playback.system;
    const url = await window.brevia.audioUrl(source);
    const audio = new Audio();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Audio metadata timed out')), 10000);
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      audio.onerror = () => { clearTimeout(timer); reject(new Error('Audio playback failed')); };
      audio.src = url;
    });
    const duration = audio.duration;
    audio.removeAttribute('src'); audio.load();
    return Number.isFinite(duration) && duration > 0;
  })()`, awaitPromise: true, returnByValue: true });
  check(audioPlayback.result?.value === true, '数据目录之外的录音应通过真实 audio.url IPC 并成功加载播放器');
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

  const storageRows = await client.send('Runtime.evaluate', { expression: `[...document.querySelector('#settings-view .settings-grid').children].slice(0, 2).map((row) => row.querySelector('[data-settings-path]')?.dataset.settingsPath).join(',')`, returnByValue: true });
  check(storageRows.result?.value === 'recordings,models', `设置页顶部路径顺序：${storageRows.result?.value}`);
  await client.send('Runtime.evaluate', { expression: `document.querySelector('#import-recording').click()` });
  await delay(350);
  const importPage = await client.send('Runtime.evaluate', { expression: `({ sidebar: !!document.querySelector('.sidebar > #import-recording'), active: document.querySelector('#prepare-view').classList.contains('active'), mode: document.querySelector('#prepare-view').dataset.mode, capture: getComputedStyle(document.querySelector('#prepare-view fieldset')).display })`, returnByValue: true });
  check(importPage.result?.value?.sidebar && importPage.result?.value?.active && importPage.result?.value?.mode === 'import' && importPage.result?.value?.capture === 'none', `侧栏导入入口未打开独立模式：${JSON.stringify(importPage.result?.value)}`);
  const importUi = await client.send('Runtime.evaluate', { expression: `(() => { applyLanguage('fr'); const button = document.querySelector('#import-recording'); const label = button.querySelector('.import-recording-label'); return { radius: getComputedStyle(button).borderTopLeftRadius, referenceRadius: getComputedStyle(document.querySelector('.new-meeting')).borderTopLeftRadius, label: label.textContent, clipped: label.scrollWidth > label.clientWidth, heading: document.querySelector('#prepare-view h1').textContent }; })()`, returnByValue: true });
  check(importUi.result?.value?.radius === importUi.result?.value?.referenceRadius, `导入按钮圆角不一致：${JSON.stringify(importUi.result?.value)}`);
  check(importUi.result?.value?.label === 'Importer un enregistrement' && importUi.result?.value?.heading === 'Importer un enregistrement' && !importUi.result?.value?.clipped, `导入界面法语文案不完整：${JSON.stringify(importUi.result?.value)}`);
  const storageMove = await client.send('Runtime.evaluate', { expression: `(async () => {
    let finish;
    const pending = withStorageMigration(() => new Promise((resolve) => { finish = resolve; }));
    const dialog = document.querySelector('.storage-migration-dialog');
    const modal = dialog.matches(':modal');
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    let duplicateRan = false;
    await withStorageMigration(() => { duplicateRan = true; });
    document.querySelector('.new-meeting').focus();
    const focusContained = dialog.contains(document.activeElement);
    const visible = dialog.getBoundingClientRect().width > 0 && !!dialog.querySelector('progress');
    finish();
    await pending;
    const cleaned = !storageMovePending && !document.querySelector('.storage-migration-dialog');
    let failure = '';
    try { await withStorageMigration(async () => { throw new Error('disk disconnected'); }); }
    catch (error) { failure = error.message; }
    return { modal, visible, focusContained, cancelPrevented: cancel.defaultPrevented, duplicateRan, cleaned,
      failedCleanly: failure === 'disk disconnected' && !storageMovePending && !document.querySelector('.storage-migration-dialog') };
  })()`, awaitPromise: true, returnByValue: true });
  const move = storageMove.result?.value || {};
  check(move.modal && move.visible && move.focusContained && move.cancelPrevented && !move.duplicateRan && move.cleaned && move.failedCleanly,
    `Storage migration must block conflicting actions and restore controls after success/failure: ${JSON.stringify(move)}`);
  const aiOnboarding = await client.send('Runtime.evaluate', { expression: `(async () => { if (onboardingPage) await new Promise((resolve) => dismissOnboardingPage(resolve)); applyLanguage('zh'); openOnboardingAi(); const page = document.querySelector('.onboarding-ai-setup-page'); const cards = page.querySelectorAll('.onboarding-ai-feature'); const toggle = page.querySelector('[name="onboarding-ai-enabled"]'); const select = page.querySelector('[name="onboarding-ai-proactivity"]'); toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); const off = page.querySelector('[data-onboarding-ai-demo]').dataset.mode; toggle.checked = true; select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })); return { cards: cards.length, choices: page.querySelectorAll('[name="onboarding-ai-way"]').length, off, on: page.querySelector('[data-onboarding-ai-demo]').dataset.mode, aligned: Math.abs(cards[0].getBoundingClientRect().width - cards[1].getBoundingClientRect().width) < 1, summaryVisible: getComputedStyle(page.querySelector('.app-demo-summary-body')).opacity === '1' }; })()`, awaitPromise: true, returnByValue: true });
  check(aiOnboarding.result?.value?.cards === 2 && aiOnboarding.result?.value?.choices === 2 && aiOnboarding.result?.value?.off === 'off' && aiOnboarding.result?.value?.on === 'auto' && aiOnboarding.result?.value?.aligned && aiOnboarding.result?.value?.summaryVisible, `AI 引导页布局或预览不正确：${JSON.stringify(aiOnboarding.result?.value)}`);
  const disabledDemo = await client.send('Runtime.evaluate', { expression: `(async () => {
    const toggle = onboardingPage.querySelector('[name="onboarding-ai-enabled"]');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const demo = onboardingPage.querySelector('[data-onboarding-ai-demo]');
    const before = demo.innerHTML;
    await new Promise((resolve) => setTimeout(resolve, 2900));
    return before === demo.innerHTML;
  })()`, awaitPromise: true, returnByValue: true });
  check(disabledDemo.result?.value === true, '关闭 AI 演示后旧定时器不能继续更新内容');
  const builtinOnboarding = await client.send('Runtime.evaluate', { expression: `(() => {
    const savedPaths = new Map(modelPaths);
    const savedSelection = selectedBuiltinModel;
    const candidates = modelCatalog.filter((model) => model.kind === 'llama-chat');
    const toggle = onboardingPage.querySelector('[name="onboarding-summary-enabled"]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    candidates.forEach((model) => modelPaths.delete(model.id));
    selectedBuiltinModel = '';
    onboardingPage.querySelector('[name="onboarding-ai-way"][value="built-in"]').closest('label').click();
    const body = settingsModal.querySelector('.modal-body');
    const previousSource = localStorage.getItem('brevia-china-model-source');
    localStorage.setItem('brevia-china-model-source', 'true');
    const inheritsSource = modelDownloadPayload(candidates[0].id).source === 'china';
    if (previousSource === null) localStorage.removeItem('brevia-china-model-source');
    else localStorage.setItem('brevia-china-model-source', previousSource);
    const fixedProvider = inheritsSource && body.querySelector('[name="provider"]').value === 'built-in'
      && !body.querySelector('[data-flow-select-choice="provider"]') && !body.querySelector('[data-summary-enabled]')
      && !body.querySelector('[data-china-model-source]') && settingsModal.querySelector('h2').textContent === 'AI 会议纪要';
    const offered = body.querySelectorAll('[data-flow-select-choice="model"]').length === candidates.length;
    const initialDownload = body.querySelector('[data-download-model]');
    const downloadAvailable = Boolean(initialDownload) && body.querySelector('[type="submit"]').disabled;
    const next = candidates.find((model) => model.id !== initialDownload?.dataset.downloadModel);
    body.querySelector('[data-flow-select-choice="model"][data-value="' + next.id + '"]').click();
    const switched = body.querySelector('[data-download-model]').dataset.downloadModel === next.id;
    modelDownloads.set(next.id, { received: 50, total: 100 });
    refreshModelConfigModels();
    const progressVisible = body.textContent.includes('50%') && body.querySelector('[data-download-model]').disabled;
    modelDownloads.delete(next.id);
    modelPaths.set(next.id, '/tmp/test-installed-model');
    refreshModelConfigModels();
    const ready = !body.querySelector('[data-download-model]') && !body.querySelector('[type="submit"]').disabled;
    modelPaths.clear(); savedPaths.forEach((value, key) => modelPaths.set(key, value));
    selectedBuiltinModel = savedSelection;
    closeModal();
    return { fixedProvider, offered, downloadAvailable, switched, progressVisible, ready };
  })()`, returnByValue: true });
  check(Object.values(builtinOnboarding.result?.value || {}).length === 6 && Object.values(builtinOnboarding.result?.value || {}).every(Boolean),
    `内置 AI 引导应固定供应商，支持模型选择、下载进度及安装后保存：${JSON.stringify(builtinOnboarding.result?.value || builtinOnboarding.exceptionDetails)}`);
  const cancelledProvider = await client.send('Runtime.evaluate', { expression: `(() => {
    const previous = summaryConfig.provider;
    onboardingPage.querySelector('[name="onboarding-ai-way"][value="online"]').closest('label').click();
    const draft = summaryConfigDraft.provider;
    closeModal();
    return draft !== 'built-in' && summaryConfig.provider === previous;
  })()`, returnByValue: true });
  check(cancelledProvider.result?.value === true, '取消引导页供应商配置不能覆盖已保存选择');
  const configDrafts = await client.send('Runtime.evaluate', { expression: `(() => {
    for (const kind of ['summary-model', 'ai-assist']) {
      openModal(kind);
      const config = kind === 'summary-model' ? summaryConfigDraft : aiAssistConfigDraft;
      config.provider = 'custom-openai';
      renderModal(kind);
      const values = { apiKey: 'test-only-issue-3-key', model: 'test-model', endpoint: 'https://example.test/v1' };
      for (const [name, value] of Object.entries(values)) {
        const field = settingsModal.querySelector('[name="' + name + '"]');
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const key = settingsModal.querySelector('[name="apiKey"]');
      key.focus();
      refreshModelConfigModels();
      if (document.activeElement !== key || key.value !== values.apiKey) return false;
      renderModal(kind);
      if (Object.entries(values).some(([name, value]) => settingsModal.querySelector('[name="' + name + '"]').value !== value)) return false;
      config.provider = 'built-in'; renderModal(kind);
      config.provider = 'custom-openai'; renderModal(kind);
      if (settingsModal.querySelector('[name="apiKey"]').value !== values.apiKey || JSON.stringify(config).includes(values.apiKey)) return false;
      closeModal();
    }
    return true;
  })()`, returnByValue: true });
  check(configDrafts.result?.value === true, '纪要与 AI 笔记输入应在刷新和供应商切换后保留，密钥不能进入可持久化配置');
  const rapidNavigation = await client.send('Runtime.evaluate', { expression: `(async () => {
    const homeIsActive = () => activeView === 'home' && document.querySelector('#home-view').classList.contains('active')
      && document.querySelectorAll('body > .app-shell > .workspace > .view.active').length === 1 && document.querySelector('#all-meetings').classList.contains('active')
      && crumb.textContent === catalog[locale].views.home && !document.querySelector('.app-shell').classList.contains('is-live-meeting');
    await showView('home');
    await Promise.all([showView('settings'), showView('prepare'), showView('home')]);
    if (!homeIsActive()) return false;
    await Promise.all([showView('settings'), showLibraryNav(activeLibraryNav)]);
    if (!homeIsActive()) return false;
    await Promise.all([showView('settings'), switchWorkspace(activeWorkspaceId)]);
    if (!homeIsActive()) return false;
    await Promise.all([showLibraryNav('recently-deleted'), showView('settings')]);
    if (activeView !== 'settings' || !document.querySelector('#settings-view').classList.contains('active') || crumb.textContent !== catalog[locale].views.settings) return false;
    await showLibraryNav('all-meetings');
    return homeIsActive();
  })()`, awaitPromise: true, returnByValue: true });
  check(rapidNavigation.result?.value === true, '快速连续导航必须到达最后一个目标，且只保留一个活动页面');
  const aiOptions = await client.send('Runtime.evaluate', { expression: `(async () => { const page = document.querySelector('.onboarding-ai-setup-page'); const options = [...page.querySelectorAll('[data-flow-select-choice="onboarding-ai-proactivity"]')].map((option) => option.dataset.value); const icons = page.querySelectorAll('.onboarding-ai-icon svg').length; const toggle = page.querySelector('[name="onboarding-summary-enabled"]'); toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); const disabled = [...page.querySelectorAll('[name="onboarding-ai-way"]')].every((option) => option.disabled); await finishAiOnboarding(); const saved = await window.brevia.summary.config.get(); return { options, icons, disabled, saved: saved.enabled }; })()`, awaitPromise: true, returnByValue: true });
  check(JSON.stringify(aiOptions.result?.value?.options) === '["assist","auto"]' && aiOptions.result?.value?.icons === 2 && aiOptions.result?.value?.disabled && aiOptions.result?.value?.saved === false, `AI 开关、图标或档位未正确保存：${JSON.stringify(aiOptions)}`);
  const floatingBars = await client.send('Runtime.evaluate', { expression: `(() => { const live = document.querySelector('#live-view .floating-control-bar'); const player = document.querySelector('#detail-view .floating-control-bar'); const toggle = document.querySelector('#live-more-toggle'); toggle.click(); const menuOpen = !document.querySelector('#live-more-panel').hidden && toggle.getAttribute('aria-expanded') === 'true'; document.body.click(); const menuClosed = document.querySelector('#live-more-panel').hidden; const wasActive = meetingActive, wasSeconds = seconds; meetingActive = true; seconds = 57; document.querySelector('#mark-important').click(); const note = currentNotesMarkdown(); meetingActive = wasActive; seconds = wasSeconds; return { live: getComputedStyle(live).position, player: getComputedStyle(player).position, menuOpen, menuClosed, note }; })()`, returnByValue: true });
  check(floatingBars.result?.value?.live === 'absolute' && floatingBars.result?.value?.player === 'relative' && floatingBars.result?.value?.menuOpen && floatingBars.result?.value?.menuClosed && floatingBars.result?.value?.note?.includes('重点 · 00:57'), `悬浮控制栏操作不正确：${JSON.stringify(floatingBars.result?.value)}`);
  const detailLayout = await client.send('Runtime.evaluate', { expression: `(async () => {
    await initializationPromise;
    const tourDeadline = Date.now() + 10000;
    while (!document.querySelector('.onboarding-tour-overlay')) {
      if (Date.now() > tourDeadline) throw new Error('Onboarding tour did not appear');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Exercise list filtering while the tour replica exists, then reveal the real app.
    applyLanguage('en');
    document.querySelectorAll('.onboarding-page').forEach((page) => page.remove());
    onboardingPage = undefined;
    await showView('detail');
    const failures = [];
    for (const code of BreviaI18n.languageCodes) {
      applyLanguage(code);
      for (const theme of ['light', 'dark']) {
        applyTheme(theme);
        const panel = document.querySelector('#detail-view .final-transcript').getBoundingClientRect();
        const notes = document.querySelector('#detail-view .notes').getBoundingClientRect();
        const player = document.querySelector('#detail-view .player').getBoundingClientRect();
        if (panel.width <= 0 || panel.height <= 0 || notes.height <= 0 || Math.max(panel.bottom, notes.bottom) > player.top + 1) failures.push(code + '/' + theme + ': meeting content hidden or overlaps player');
      }
      if (document.querySelectorAll('[data-settings-path]').length !== 2) failures.push(code + ': duplicate storage rows');
      const error = storageErrorMessage(new Error('Chosen recording folder is no longer empty'));
      if (error !== catalog[code].labels['请选择空文件夹。']) failures.push(code + ': untranslated storage error');
    }
    applyLanguage('zh');
    return failures;
  })()`, awaitPromise: true, returnByValue: true });
  check(Array.isArray(detailLayout.result?.value) && detailLayout.result.value.length === 0, `多语言/主题布局回归：${JSON.stringify(detailLayout)}`);
  const refineModelLayout = await client.send('Runtime.evaluate', { expression: `(() => {
    const host = document.createElement('div');
    host.className = 'refine-menu';
    host.innerHTML = renderRefineModelRow([
      ['qwen', 'Qwen3-ASR 0.6B 8bit · 下载 960MB', '推荐'],
      ['fire', 'FireRedASR2-AED · 下载 4.25GB', ''],
      ['long', 'ASR'.repeat(40), ''],
    ], 'qwen');
    document.body.append(host);
    host.querySelector('.flow-select-options').hidden = false;
    const fits = () => [...host.querySelectorAll('.flow-select-toggle, .flow-select-options, .flow-select-options button')]
      .every(element => element.scrollWidth <= element.clientWidth + 1);
    const initial = fits();
    const toggle = host.querySelector('.flow-select-toggle');
    toggle.firstChild.nodeValue = 'ASR'.repeat(40);
    const changed = fits();
    const arrow = toggle.querySelector('span').getBoundingClientRect();
    const bounds = toggle.getBoundingClientRect();
    host.remove();
    return initial && changed && arrow.right <= bounds.right && arrow.left >= bounds.left;
  })()`, returnByValue: true });
  check(refineModelLayout.result?.value === true, `识别模型长文本布局回归：${JSON.stringify(refineModelLayout)}`);
  const editingRegression = await client.send('Runtime.evaluate', { expression: `(async () => {
    await initializationPromise;
    const meeting = await window.brevia.meeting.get({ meeting_id: breviaClient.state.initialized.meetings[0].id });
    const chosen = refinedModelOptions(meeting.language).at(-1)?.[0];
    if (chosen) meeting.refined_model_id = chosen;
    applyBackendDetail(meeting);
    const selected = !chosen || uiData.detail.refinedModelId === chosen;
    uiData.detail.summary = { markdown: 'saved memo', hasFull: true };
    renderMeetingDetail();
    document.querySelector('[data-open-summary-edit]').click();
    inlineSummaryEditor.setMode('markdown');
    const draft = '***draft***\\n---heading\\n___abc';
    const field = document.querySelector('[data-inline-summary-editor] textarea');
    field.value = draft;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    applyLanguage('ja');
    const localizedDraft = inlineSummaryEditor.getMarkdown() === draft && inlineSummaryEditor.getMode() === 'markdown';
    applyBackendDetail(meeting);
    const refreshedDraft = inlineSummaryEditor.getMarkdown() === draft;
    for (let index = 0; index < 30; index += 1) renderMeetingDetail();
    return { selected, localizedDraft, refreshedDraft, editing: uiData.detail.summaryEditing };
  })()`, awaitPromise: true, returnByValue: true });
  check(editingRegression.result?.value?.selected && editingRegression.result?.value?.localizedDraft && editingRegression.result?.value?.refreshedDraft && editingRegression.result?.value?.editing, `草稿/模型回归：${JSON.stringify(editingRegression)}`);
  const documentObject = await client.send('Runtime.evaluate', { expression: 'document' });
  const listenersBefore = await client.send('DOMDebugger.getEventListeners', { objectId: documentObject.result.objectId });
  await client.send('Runtime.evaluate', { expression: 'for (let index = 0; index < 30; index += 1) renderMeetingDetail();' });
  const listenersAfter = await client.send('DOMDebugger.getEventListeners', { objectId: documentObject.result.objectId });
  check(listenersBefore.listeners.length === listenersAfter.listeners.length, '重建编辑器不应增加 document 监听器数量');
  const captionClose = await client.send('Runtime.evaluate', { expression: `(async () => {
    let closed = 0;
    const unsubscribe = window.brevia.on('floating-caption.closed', () => { closed += 1; });
    for (let index = 0; index < 2; index += 1) {
      await window.brevia.floatingCaption.show();
      await window.brevia.floatingCaption.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    unsubscribe();
    document.querySelector('[data-cancel-inline-summary-edit]').click();
    applyLanguage('zh');
    return closed;
  })()`, awaitPromise: true, returnByValue: true });
  check(captionClose.result?.value === 2, `悬浮字幕关闭通知缺失：${JSON.stringify(captionClose)}`);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 720, deviceScaleFactor: 1, mobile: false });
  const minimumWindow = await client.send('Runtime.evaluate', { expression: `({ activeView, className: document.querySelector('#detail-view').className, display: getComputedStyle(document.querySelector('#detail-view')).display, onboarding: [...document.querySelectorAll('.onboarding-page')].map(page => page.className), shell: getComputedStyle(document.querySelector('.app-shell')).display, parentWidth: document.querySelector('#detail-view').parentElement.getBoundingClientRect().width, width: document.querySelector('#detail-view').getBoundingClientRect().width, sidebar: getComputedStyle(document.querySelector('.app-shell > .sidebar')).display })`, returnByValue: true });
  check(minimumWindow.result?.value?.width > 500 && minimumWindow.result?.value?.sidebar !== 'none', `最小桌面窗口丢失内容或导航：${JSON.stringify(minimumWindow.result?.value)}`);
  const changelog = await client.send('Runtime.evaluate', { expression: `(async () => {
    const errors = [];
    for (const code of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      applyLanguage(code); applyTheme(theme);
      await openModal('whats-new');
      const current = settingsModal.querySelector('.whatsnew-entry.is-current');
      const body = settingsModal.querySelector('.modal-body');
      if (!current || !current.textContent.includes(whatsNewLog[0].version)) errors.push(code + ': missing current version');
      if (body.scrollWidth > body.clientWidth + 1) errors.push(code + '/' + theme + ': horizontal overflow');
      const history = settingsModal.querySelector('details.whatsnew-entry');
      if (!history || history.open) errors.push(code + ': history must start collapsed');
      history.querySelector('summary').click();
      if (!history.open || !history.querySelector('section')) errors.push(code + ': history cannot be expanded');
      if (whatsNewLog[0].contributors?.length && !current.textContent.includes(whatsNewCopy[code].contributors)) errors.push(code + ': missing contributors');
      for (const anchor of current.querySelectorAll('a')) if (!anchor.href.startsWith('https://github.com/') || anchor.target !== '_blank') errors.push('unsafe release link');
    }
    closeModal(); applyLanguage('zh'); applyTheme('light');
    return errors;
  })()`, awaitPromise: true, returnByValue: true });
  check(Array.isArray(changelog.result?.value) && changelog.result.value.length === 0, `双语更新日志布局或链接异常：${JSON.stringify(changelog)}`);
  await client.send('Emulation.clearDeviceMetricsOverride');
  const mergedAiSettings = await client.send('Runtime.evaluate', { expression: `(async () => {
    meetingActive = false;
    summaryConfig.enabled = false;
    aiAssistConfig.enabled = false;
    aiAssistConfig.proactivity = 'quiet';
    await Promise.all([persistSummaryConfig(), persistAiAssistConfig()]);
    await showView('settings');
    const cards = [...document.querySelectorAll('[data-settings-modal]')].map(button => button.dataset.settingsModal);
    document.querySelector('[data-settings-modal="ai-features"]').click();
    const page = onboardingPage;
    const initial = page.dataset.aiSettings === 'true' && page.querySelector('#ai-features-title').textContent === 'AI 功能'
      && page.classList.contains('modal-backdrop') && !page.classList.contains('onboarding-page')
      && getComputedStyle(document.querySelector('.app-shell')).display !== 'none'
      && !page.querySelector('[name="onboarding-summary-enabled"]').checked
      && !page.querySelector('[name="onboarding-ai-enabled"]').checked
      && page.querySelector('[name="onboarding-ai-proactivity"]').value === 'quiet';
    page.querySelector('[name="onboarding-summary-enabled"]').checked = true;
    page.querySelector('[name="onboarding-ai-enabled"]').checked = true;
    page.querySelector('[data-onboarding-ai-skip]').click();
    await new Promise(resolve => setTimeout(resolve, 350));
    const cancelled = !onboardingPage && !summaryConfig.enabled && !aiAssistConfig.enabled;
    document.querySelector('[data-settings-modal="ai-features"]').click();
    onboardingPage.querySelector('[data-configure-ai-notes]').click();
    const notesConfig = !!settingsModal.querySelector('.ai-assist-config-form');
    closeModal();
    const enableNotes = onboardingPage.querySelector('[name="onboarding-ai-enabled"]');
    enableNotes.checked = true;
    enableNotes.dispatchEvent(new Event('change', { bubbles: true }));
    onboardingPage.querySelector('.onboarding-ai-levels .flow-select-toggle').click();
    const opened = !onboardingPage.querySelector('.onboarding-ai-levels .flow-select-options').hidden;
    onboardingPage.querySelector('[data-flow-select-choice="onboarding-ai-proactivity"][data-value="auto"]').click();
    const selected = opened && onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value === 'auto'
      && onboardingPage.querySelector('.onboarding-ai-levels .flow-select-options').hidden;
    enableNotes.checked = false;
    enableNotes.dispatchEvent(new Event('change', { bubbles: true }));
    await finishAiOnboarding(undefined, true);
    await new Promise(resolve => setTimeout(resolve, 350));
    const summary = await window.brevia.summary.config.get();
    const notes = await window.brevia.aiAssist.config.get();
    const saved = !summary.enabled && !notes.enabled && notes.proactivity === 'auto' && !onboardingPage;
    const model = modelCatalog.find(item => item.kind === 'llama-chat').id;
    modelPaths.set(model, '/tmp/e2e-ai-model');
    summaryConfig.provider = 'built-in';
    summaryConfig.providers = { 'built-in': { model } };
    aiAssistConfig.provider = 'built-in';
    aiAssistConfig.providers = { 'built-in': { model } };
    document.querySelector('[data-settings-modal="ai-features"]').click();
    onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked = true;
    await finishAiOnboarding(undefined, true);
    await new Promise(resolve => setTimeout(resolve, 350));
    const summaryOnly = summaryConfig.enabled && !aiAssistConfig.enabled;
    document.querySelector('[data-settings-modal="ai-features"]').click();
    const restored = onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked
      && !onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked
      && onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value === 'auto';
    onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked = false;
    onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked = true;
    await finishAiOnboarding(undefined, true);
    await new Promise(resolve => setTimeout(resolve, 350));
    const independent = summaryOnly && restored && !(await window.brevia.summary.config.get()).enabled
      && (await window.brevia.aiAssist.config.get()).enabled;
    let dismissible = true;
    for (const close of ['button', 'backdrop', 'escape']) {
      document.querySelector('[data-settings-modal="ai-features"]').click();
      if (close === 'button') onboardingPage.querySelector('[data-close-ai-features]').click();
      else if (close === 'backdrop') onboardingPage.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 350));
      dismissible = dismissible && !onboardingPage && !document.body.classList.contains('modal-open');
    }
    return { cards, initial, cancelled, notesConfig, saved, selected, independent, dismissible, closed: !onboardingPage };
  })()`, awaitPromise: true, returnByValue: true });
  const merged = mergedAiSettings.result?.value;
  check(merged?.cards.includes('ai-features') && !merged.cards.includes('ai-assist') && !merged.cards.includes('summary-model') && merged.initial && merged.cancelled && merged.notesConfig && merged.saved && merged.selected && merged.independent && merged.dismissible && merged.closed, `合并 AI 设置回归：${JSON.stringify(mergedAiSettings)}`);
  const settingsModalDescriptions = await client.send('Runtime.evaluate', { expression: `(async () => {
    await showView('settings');
    const failures = [];
    for (const kind of ['models', 'storage', 'advanced-settings', 'summary-model', 'ai-assist', 'whats-new']) {
      await openModal(kind);
      const description = settingsModal.querySelector('.modal-title p');
      if (!description.hidden || getComputedStyle(description).display !== 'none') failures.push(kind);
      if (!settingsModal.querySelector('h2').textContent) failures.push(kind + ': missing title');
      closeModal();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    return failures;
  })()`, awaitPromise: true, returnByValue: true });
  check(Array.isArray(settingsModalDescriptions.result?.value) && !settingsModalDescriptions.result.value.length, `设置浮窗说明仍可见：${JSON.stringify(settingsModalDescriptions)}`);
  check(pageErrors.length === 0, `交互期间渲染异常：${pageErrors.join('\n')}`);

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
