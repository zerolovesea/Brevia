/**
 * 端到端冒烟测试：启动 Playwright 浏览器、真实桌面控制器和 Worker，通过 CDP 连到真实渲染进程断言。
 *
 * 为什么需要它：`test-main-logic.mjs` 只覆盖纯逻辑接缝，`test-ui.mjs` 是源码文本断言。
 * 本项目的前端是 14 个共享全局作用域的 classic script，**index.html 的 script 顺序就是
 * 依赖图**——任何一个文件在加载期抛 ReferenceError，只有真实启动才能发现。这个测试
 * 因此会先 attach 再 reload 一次，专门吞下加载期异常。
 *
 * 用 Node 内置的 fetch + WebSocket 连接测试浏览器的 CDP；真实系统宿主另行验证。
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const defaultWindowScale = 1;
const captureStartedAt = Date.now();
const captureSources = process.env.BREVIA_DESIGN_CAPTURE_DIR
  ? (() => {
      const sources = [
        ...readdirSync(path.join(root, 'frontend'))
          .filter((name) => /\.(js|css|html)$/.test(name))
          .map((name) => 'frontend/' + name),
        'desktop/main.js',
        'desktop/test-e2e.mjs',
      ];
      return Object.fromEntries(
        sources.map((name) => [
          name,
          createHash('sha256')
            .update(readFileSync(path.join(root, name)))
            .digest('hex'),
        ]),
      );
    })()
  : {};

/** 桌面测试宿主 可执行文件路径，跨平台。 */
if (process.env.BREVIA_SKIP_E2E === '1') {
  console.log('Renderer/controller integration skipped.');
  process.exit(0);
}
const packagedApp = false;
const hostBin = process.execPath;

/* 每个脚本各取一个代表性全局，用来证明整条 script 依赖链按顺序执行成功。
   顺序与 frontend/index.html 一致；漏掉的文件会在下面被交叉校验。 */
const moduleProbes = [
  ['app-state.js', 'locale'],
  ['motion.js', 'window.BreviaMotion'],
  ['app-actions.js', 'appActions'],
  ['app-utils.js', 'formatBytes'],
  ['backend-client.js', 'NativeAudioCapture'],
  ['ui-data.js', 'uiData'],
  ['i18n-data.js', 'window.BreviaLocaleData'],
  ['changelog.js', 'window.BreviaChangelog'],
  ['i18n.js', 'window.BreviaI18n'],
  ['i18n-runtime.js', 't'],
  ['model-selection.js', 'window.BreviaModelSelection'],
  ['asr-copy.js', 'window.BreviaAsrCopy'],
  ['meeting-evidence.js', 'transcriptEvidenceLinks'],
  ['ui-components.js', 'escapeHtml'],
  ['assets/vendor/gsap.min.js', 'window.gsap'],
  ['assets/vendor/CustomEase.min.js', 'window.CustomEase'],
  ['onboarding-motion.js', 'window.BreviaOnboardingMotion'],
  ['workspaces.js', 'workspaces'],
  ['app-meetings.js', 'backendMeeting'],
  ['app-meeting-detail.js', 'renderSegmentData'],
  ['onboarding.js', 'window.BreviaOnboarding'],
  ['transcript-corrections.js', 'correctionMatches'],
  ['summary-providers.js', 'configuredSummaryProvider'],
  ['app.js', 't'],
  ['mobile-connection.js', "document.getElementById('mobile-pair').onclick"],
  [
    'mobile-note-review.js',
    "document.querySelector('.mobile-note-review [data-apply]')?.onclick || undefined",
  ],
  ['desktop-controls.js', 'desktopControlsReady'],
  ['desktop-mobile-preview.js', 'window.BreviaDesktopMobilePreview'],
];

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
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
    const send = (method, params = {}, timeoutMs = 180000) =>
      new Promise((res, rej) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`CDP等待超时：${method} ${String(params.expression || '').slice(0, 160)}`));
        }, timeoutMs);
        pending.set(id, { res, rej, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        if (message.error) rej(new Error(`${message.error.message}`));
        else res(message.result);
        return;
      }
      if (message.method) onEvent(message);
    });
    socket.addEventListener('close', () => {
      for (const { rej, timer } of pending.values()) {
        clearTimeout(timer);
        rej(new Error('CDP连接已关闭'));
      }
      pending.clear();
    });
    socket.addEventListener('error', () => reject(new Error('CDP websocket error')));
    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }));
  });
}

/** 等待调试端口上出现页面目标。 */
async function waitForTarget(port, deadline, exited) {
  while (Date.now() < deadline) {
    if (exited()) return null; // 桌面测试宿主 提前退出时立即失败，不干等到超时。
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (t) =>
          t.type === 'page' && t.url.includes('/frontend/index.html') && t.webSocketDebuggerUrl,
      );
      if (page) return page;
    } catch {
      /* 端口还没起来，继续等。 */
    }
    await delay(150);
  }
  return null;
}

/* 临时目录放在工作区内：DSH 文件沙箱只允许写工作区，Chromium 需要往 user-data-dir
   写 DevToolsActivePort 等文件。--no-sandbox 让 桌面测试宿主 的子进程能在该沙箱下起来。 */
// 并行测试各用独立目录，避免互相覆盖配对证书与 Chromium 状态。
const sandboxRoot = path.join(root, '.e2e-tmp', String(process.pid));
rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const dataDir = path.join(sandboxRoot, 'data');
const recordingsDir = path.join(sandboxRoot, 'recordings');
const userDataDir = path.join(sandboxRoot, 'userdata');
mkdirSync(dataDir, { recursive: true });
mkdirSync(recordingsDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
if (process.env.BREVIA_DESIGN_CAPTURE_DIR) {
  mkdirSync(path.join(dataDir, 'mobile'), { recursive: true });
  writeFileSync(
    path.join(dataDir, 'mobile', 'devices.json'),
    JSON.stringify([
      {
        id: 'a'.repeat(32),
        name: 'iPhone',
        firstConnectedAt: '2026-10-12T10:00:00Z',
        tokenHash: 'a'.repeat(64),
      },
    ]),
  );
}

const port = await freePort();
const childEnv = {
  ...process.env,
  BREVIA_DATA_DIR: dataDir,
  BREVIA_MEETINGS_DIR: recordingsDir,
  BREVIA_MOBILE_PORT: '0',
  BREVIA_TEST_USER_DATA: userDataDir,
};
const child = spawn(
  hostBin,
  [
    'desktop/test-host.cjs',
    '--inspect=0',
    '--no-sandbox',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
  ],
  {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  },
);

let mainOutput = '';
child.stdout.on('data', (chunk) => {
  mainOutput += chunk;
});
child.stderr.on('data', (chunk) => {
  mainOutput += chunk;
});
let earlyExit = null;
let spawnError = null;
child.on('exit', (code, signal) => {
  earlyExit = { code, signal };
});
// 没有这个 handler 时，spawn 失败（例如 Windows 上二进制不可执行）会变成未捕获异常。
child.on('error', (error) => {
  spawnError = error;
});

let cleanupPromise;
const cleanup = () =>
  (cleanupPromise ??= (async () => {
    if (child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode !== null || child.signalCode) return;
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* 已退出。 */
    }
    await Promise.race([exited, delay(1000)]);
  })());

let client;
try {
  const target = await waitForTarget(port, Date.now() + 30000, () => earlyExit || spawnError);
  if (!target) {
    console.error(
      spawnError
        ? `✗ 无法启动 桌面测试宿主（${hostBin}）：${spawnError.message}`
        : earlyExit
          ? `✗ 桌面测试宿主 在暴露渲染进程之前就退出了（code=${earlyExit.code} signal=${earlyExit.signal}）。`
          : '✗ 桌面测试宿主 未在 30 秒内暴露渲染进程目标。',
    );
    console.error(mainOutput.trim().split('\n').slice(-25).join('\n'));
    await cleanup();
    process.exit(1);
  }

  const pageErrors = [];
  const consoleErrors = [];
  client = await connect(target.webSocketDebuggerUrl, (message) => {
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
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.openReviewDocument = (scope) => {
    document.querySelector('[role="tab"][data-detail-tab="' + scope + '"]').click();
  }`,
  });
  // 普通动画用例不继承 runner 的无障碍偏好；减少动态效果在下方单独验证。
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  let timeoutChecked = false;
  try {
    await client.send(
      'Runtime.evaluate',
      { expression: 'window.__cdpTimeoutCheck = new Promise(() => {})', awaitPromise: true },
      25,
    );
  } catch (error) {
    timeoutChecked = error.message.startsWith('CDP等待超时：Runtime.evaluate');
  }
  check(timeoutChecked, 'CDP未返回时必须超时，避免回归永久挂起');

  // attach 之后 reload 一次：加载期异常才是这条 script 依赖链的真正风险。
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await client.send('Page.reload', { ignoreCache: true });
  const reloadDeadline = Date.now() + 20000;
  for (;;) {
    await delay(200);
    const state = await client.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    if (state.result?.value === 'complete') break;
    if (Date.now() > reloadDeadline) {
      failures.push('reload 后 20 秒内未完成加载');
      break;
    }
  }
  const initialized = await client.send('Runtime.evaluate', {
    expression: 'initializationPromise',
    awaitPromise: true,
    returnByValue: true,
  });
  check(!initialized.exceptionDetails, '后台初始化必须完成后再测试交互');
  // 加载完成后给事件队列一点时间把加载期异常送过来。
  await delay(300);

  const markdownBoundary = await client.send('Runtime.evaluate', {
    expression: `(()=>{const node=document.createElement('div');node.innerHTML=renderMarkdown('![a](brevia-note://missing/[x](https://invalid onerror=alert))');return ![...node.querySelectorAll('*')].some(element=>[...element.attributes].some(attribute=>attribute.name.startsWith('on')));})()`,
    returnByValue: true,
  });
  check(markdownBoundary.result?.value === true, 'Markdown 图片地址不能生成事件属性');

  const compactWindow = await client.send('Runtime.evaluate', {
    expression: `({ width:outerWidth, height:outerHeight, scale:outerWidth/innerWidth, viewportWidth:innerWidth, viewportHeight:innerHeight, bodyWidth:document.body.scrollWidth, overflow:document.body.scrollWidth>innerWidth+1 })`,
    returnByValue: true,
  });
  check(
    Math.abs(compactWindow.result?.value?.viewportWidth - 1280) <= 2 &&
      Math.abs(compactWindow.result.value.viewportHeight - 800) <= 2 &&
      Math.abs(compactWindow.result.value.scale - defaultWindowScale) < 0.02 &&
      !compactWindow.result.value.overflow,
    `旧缩放配置启动并重载后，应使用 1280×800 原生比例且无横向溢出：${JSON.stringify(compactWindow.result?.value)}`,
  );

  const probe = `(() => {
    // 无公开全局的键盘脚本用真实事件验证执行，不能只证明 script 标签存在。
    const desktopControlsReady=(()=>{
      const previous=document.activeElement,host=document.createElement('div');
      host.className='ui-select';host.style.cssText='position:fixed;left:0;top:0;opacity:0;pointer-events:none';
      host.innerHTML='<button data-flow-select-toggle type="button">Probe</button><div class="ui-select-list"><button type="button" data-flow-select-choice="probe" data-value="probe">Probe</button></div>';
      document.body.append(host);
      const event=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});
      host.firstElementChild.dispatchEvent(event);
      const ready=event.defaultPrevented&&document.activeElement===host.querySelector('[data-flow-select-choice]');
      host.remove();previous?.focus?.({preventScroll:true});
      return ready?true:undefined;
    })();
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

  const result = await client.send('Runtime.evaluate', {
    expression: probe,
    returnByValue: true,
    awaitPromise: false,
  });
  const savedConfig = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const config = { version: 2, enabled: false, proactivity: 'quiet', provider: 'built-in', providers: {} };
    await window.brevia.aiAssist.config.save(config);
    return JSON.stringify(await window.brevia.aiAssist.config.get()) === JSON.stringify(config);
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(savedConfig.result?.value === true, 'AI 笔记设置经真实 IPC 保存后应从磁盘完整读回');
  const audioPlayback = await client.send('Runtime.evaluate', {
    expression: `(async () => {
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
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    audioPlayback.result?.value === true,
    '数据目录之外的录音应通过真实 audio.url IPC 并成功加载播放器',
  );
  if (result.exceptionDetails) {
    failures.push(
      `探针求值抛错：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`,
    );
  }
  const value = result.result?.value || {};

  check(value.readyState === 'complete', `document.readyState = ${value.readyState}`);
  check(
    value.title && value.title === value.brandTitle,
    `document.title = ${value.title}，期望 t('Brevia') = ${value.brandTitle}`,
  );
  check(
    (value.missing || []).length === 0,
    `脚本依赖链缺失全局：${(value.missing || []).join(', ')}`,
  );
  check(value.views >= 5, `视图数量 ${value.views} < 5`);
  check(
    value.scripts === moduleProbes.length,
    `script 标签数 ${value.scripts} != 探针数 ${moduleProbes.length}（index.html 增删脚本后要同步这里）`,
  );
  check(
    typeof value.translated === 'string' && value.translated !== 'Brevia',
    `t('Brevia') 未翻译（回落到键名）：${value.translated}`,
  );
  check(value.locales === 8, `i18n 词条语言数 ${value.locales} != 8`);
  check(value.navItems > 0, '[data-view] 导航项为 0');
  check(pageErrors.length === 0, `渲染进程加载期异常：\n  ${pageErrors.join('\n  ')}`);

  const storageRows = await client.send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('.settings-folder-paths [data-settings-path]')].map((row) => row.dataset.settingsPath).join(',')`,
    returnByValue: true,
  });
  check(
    storageRows.result?.value === 'recordings,models',
    `存储页面路径顺序：${storageRows.result?.value}`,
  );
  const deviceCardOrder = await client.send('Runtime.evaluate', {
    expression: `(() => { const destinations=document.querySelector('.preferences-destinations');return destinations?.contains(document.getElementById('mobile-connection')) && destinations.contains(speakerProfileCard) && !!destinations.querySelector('[data-settings-modal="storage"]'); })()`,
    returnByValue: true,
  });
  check(deviceCardOrder.result?.value, '设备连接应与声纹、存储归在设备与数据分组');
  await client.send('Runtime.evaluate', {
    expression: `document.querySelector('#import-recording').click()`,
  });
  await delay(350);
  const importPage = await client.send('Runtime.evaluate', {
    expression: `({ sidebar: !!document.querySelector('.sidebar #import-recording'), active: document.querySelector('#prepare-view').classList.contains('active'), mode: document.querySelector('#prepare-view').dataset.mode, capture: document.querySelector('#prepare-view fieldset').checkVisibility() })`,
    returnByValue: true,
  });
  check(
    importPage.result?.value?.sidebar &&
      importPage.result?.value?.active &&
      importPage.result?.value?.mode === 'import' &&
      importPage.result?.value?.capture === false,
    `侧栏导入入口未打开独立模式：${JSON.stringify(importPage.result?.value)}`,
  );
  const importUi = await client.send('Runtime.evaluate', {
    expression: `(() => { applyLanguage('fr'); const button = document.querySelector('#import-recording'); const label = button.querySelector('.import-recording-label'); return { radius: getComputedStyle(button).borderTopLeftRadius, referenceRadius: getComputedStyle(document.querySelector('.new-meeting')).borderTopLeftRadius, label: label.textContent, clipped: label.scrollWidth > label.clientWidth, heading: document.querySelector('#prepare-view h1').textContent }; })()`,
    returnByValue: true,
  });
  check(
    importUi.result?.value?.radius === importUi.result?.value?.referenceRadius,
    `导入按钮圆角不一致：${JSON.stringify(importUi.result?.value)}`,
  );
  check(
    importUi.result?.value?.label === 'Importer un fichier audio local' &&
      importUi.result?.value?.heading === 'Importer un fichier audio local' &&
      !importUi.result?.value?.clipped,
    `导入界面法语文案不完整：${JSON.stringify(importUi.result?.value)}`,
  );
  const accessibleLabels = await client.send('Runtime.evaluate', {
    expression: `[['.sidebar', '主导航'], ['.brand', 'Brevia 首页'], ['#import-recording', '导入本地音频'], ['.audio-dropzone', '选择音频文件']].every(([selector, key]) => document.querySelector(selector).getAttribute('aria-label') === t(key))`,
    returnByValue: true,
  });
  check(accessibleLabels.result?.value, '切换语言必须更新真实的 aria-label 属性');
  const storageMove = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    let finish;
    const pending = withStorageMigration(() => new Promise((resolve) => { finish = resolve; }));
    const dialog = document.querySelector('.storage-migration-dialog');
    const deferred = !dialog.open && document.querySelector('.app-shell').inert;
    await new Promise(resolve => setTimeout(resolve, 220));
    const modal = dialog.matches(':modal');
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    let duplicateRan = false;
    await withStorageMigration(() => { duplicateRan = true; });
    document.querySelector('.new-meeting').focus();
    const focusContained = document.activeElement !== document.querySelector('.new-meeting');
    const visible = dialog.getBoundingClientRect().width > 0 && !!dialog.querySelector('progress');
    finish();
    await pending;
    const cleaned = !storageMovePending && !document.querySelector('.storage-migration-dialog');
    const fast = withStorageMigration(async () => {});
    const fastHidden = !document.querySelector('.storage-migration-dialog').open;
    await fast;
    let failure = '';
    try { await withStorageMigration(async () => { throw new Error('disk disconnected'); }); }
    catch (error) { failure = error.message; }
    return { deferred, fastHidden, modal, visible, focusContained, cancelPrevented: cancel.defaultPrevented, duplicateRan, cleaned,
      failedCleanly: failure === 'disk disconnected' && !storageMovePending && !document.querySelector('.storage-migration-dialog') };
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const move = storageMove.result?.value || {};
  check(
    move.deferred &&
      move.fastHidden &&
      move.modal &&
      move.visible &&
      move.focusContained &&
      move.cancelPrevented &&
      !move.duplicateRan &&
      move.cleaned &&
      move.failedCleanly,
    `Storage migration must block conflicting actions and restore controls after success/failure: ${JSON.stringify(move)}`,
  );
  const aiOnboarding = await client.send('Runtime.evaluate', {
    expression: `(async () => { if (onboardingPage) await new Promise((resolve) => dismissOnboardingPage(resolve)); applyLanguage('zh'); openOnboardingAi(); const page = document.querySelector('.onboarding-ai-setup-page'); const cards = page.querySelectorAll('.onboarding-ai-feature'); const toggle = page.querySelector('[name="onboarding-ai-enabled"]'); const select = page.querySelector('[name="onboarding-ai-proactivity"]'); toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); const off = page.querySelector('[data-onboarding-ai-demo]').dataset.mode; toggle.checked = true; select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })); return { cards: cards.length, choices: page.querySelectorAll('[name="onboarding-ai-way"]').length, off, on: page.querySelector('[data-onboarding-ai-demo]').dataset.mode, aligned: Math.abs(cards[0].getBoundingClientRect().width - cards[1].getBoundingClientRect().width) < 1, summaryVisible: getComputedStyle(page.querySelector('.app-demo-summary-body')).opacity === '1' }; })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    aiOnboarding.result?.value?.cards === 2 &&
      aiOnboarding.result?.value?.choices === 0 &&
      aiOnboarding.result?.value?.off === 'off' &&
      aiOnboarding.result?.value?.on === 'auto' &&
      aiOnboarding.result?.value?.aligned &&
      aiOnboarding.result?.value?.summaryVisible,
    `AI 引导页布局或预览不正确：${JSON.stringify(aiOnboarding.result?.value)}`,
  );
  const disabledDemo = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const toggle = onboardingPage.querySelector('[name="onboarding-ai-enabled"]');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const demo = onboardingPage.querySelector('[data-onboarding-ai-demo]');
    const before = demo.innerHTML;
    await new Promise((resolve) => setTimeout(resolve, 2900));
    return before === demo.innerHTML;
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(disabledDemo.result?.value === true, '关闭 AI 演示后旧定时器不能继续更新内容');
  const aiAnimationFit = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      window.__visualAiFit={phase:'initial-dismiss'};
      const dismissBeforeFit=dismissOnboardingPage;
      dismissOnboardingPage=(next)=>{
        if(onboardingPage)onboardingPage.dismissTrace=new Error('onboarding dismissal').stack;
        return dismissBeforeFit(next);
      };
      if(onboardingPage)await dismissOnboardingPage();
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']){
        window.__visualAiFit={code,phase:'open'};
        applyLanguage(code);openOnboardingAi();
        await new Promise(resolve=>setTimeout(resolve,250));
        const page=onboardingPage,sections=page.querySelector('.onboarding-ai-sections');
        await document.fonts.ready;
        page.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).forEach(a=>a.finish());
        const footer=page.querySelector('.onboarding-actions');
        const summary=page.querySelector('[name=onboarding-summary-enabled]');
        if(summary.checked!==summaryConfig.enabled)errors.push(code+': summary preference was overridden');
        const notesTitle=page.querySelectorAll('.onboarding-ai-feature-head h2')[0];
        const demoTitle=page.querySelector('[data-onboarding-ai-demo] h3');
        if(notesTitle.textContent!==t('AI 笔记')||!demoTitle.textContent.startsWith(t('AI 笔记'))||notesTitle.getBoundingClientRect().width===0)errors.push(code+': AI notes title missing');
        const guide=page.querySelector('.onboarding-ai-mode-guide');
        if(guide.querySelectorAll('dt').length!==3||guide.querySelectorAll('dd').length!==3||guide.textContent.includes('undefined'))errors.push(code+': mode descriptions missing');
        const rows=page.querySelectorAll('.onboarding-ai-row');
        if(!rows[0].querySelector('[name=onboarding-ai-enabled]')||!rows[1].querySelector('[name=onboarding-summary-enabled]')||!(rows[1].compareDocumentPosition(page.querySelector('.onboarding-shared-service'))&Node.DOCUMENT_POSITION_FOLLOWING))errors.push(code+': feature order incorrect');
        summary.checked=true;
        summary.dispatchEvent(new Event('change',{bubbles:true}));
        const enabled=page.querySelector('[name=onboarding-ai-enabled]');
        enabled.checked=true;
        for(const mode of ['quiet','assist','auto']){
          window.__visualAiFit={code,mode,phase:'frames'};
          renderOnboardingAiDemo();
          page.querySelector('[data-flow-select-choice=onboarding-ai-proactivity][data-value='+mode+']').click();
          renderOnboardingSummaryDemo();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          // 模式切换后的有限CSS动画结束再测量，避免把按压/入场缩放当成行高变化。
          page.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).forEach(a=>a.finish());
          const initial=footer.getBoundingClientRect();
          const rowHeights=[...page.querySelectorAll('.onboarding-ai-row')].map(row=>row.getBoundingClientRect().height);
          for(let stage=0;stage<3;stage++){
            window.__visualAiFit={code,mode,stage,phase:'animation'};
            if(stage)await new Promise(resolve=>setTimeout(resolve,1300));
            if(mode==='quiet'&&stage===0)page.querySelector('[data-demo-suggestion] button').click();
            if(mode==='assist'&&stage===2)page.querySelector('[data-demo-add]')?.click();
            const demo=page.querySelector('[data-onboarding-ai-demo]');
            if(stage===2&&demo.dataset.stage!==(mode==='quiet'?'suggestion':'written'))errors.push(code+'/'+mode+': incorrect completion behavior');
            if(mode==='auto'&&demo.querySelector('[data-demo-add]'))errors.push(code+': auto mode requires acceptance');
            const bounds=footer.getBoundingClientRect();
            if(bounds.bottom>innerHeight+1||bounds.top<0||Math.abs(bounds.top-initial.top)>1)errors.push(code+'/'+mode+'/'+stage+': footer moved or clipped');
            if(page.querySelector('.onboarding-page-content').scrollHeight>page.querySelector('.onboarding-page-content').clientHeight+1)errors.push(code+'/'+mode+': outer page overflow');
            if([...page.querySelectorAll('.onboarding-ai-row')].some((row,index)=>Math.abs(row.getBoundingClientRect().height-rowHeights[index])>1))errors.push(code+'/'+mode+': demo changed row height '+JSON.stringify({before:rowHeights,after:[...page.querySelectorAll('.onboarding-ai-row')].map(row=>row.getBoundingClientRect().height),connected:page.isConnected,current:page===onboardingPage,classes:page.className,dismissal:page.dismissTrace}));
            if(sections.getBoundingClientRect().bottom>bounds.top+1)errors.push(code+'/'+mode+': content covers footer');
          }
        }
        window.__visualAiFit={code,phase:'dismiss'};
        await dismissOnboardingPage();
      }
      applyLanguage('zh');openOnboardingAi();
      dismissOnboardingPage=dismissBeforeFit;
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(aiAnimationFit.result?.value) && !aiAnimationFit.result.value.length,
    `AI 演示全阶段与八语言不能撑高卡片或挤出导航：${JSON.stringify(aiAnimationFit.result?.value || aiAnimationFit.exceptionDetails)}`,
  );
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reducedAiDemo = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const page=onboardingPage,demo=page.querySelector('[data-onboarding-ai-demo]'),summary=page.querySelector('[data-onboarding-summary-demo]');
      const enabled=page.querySelector('[name=onboarding-ai-enabled]'),summaryEnabled=page.querySelector('[name=onboarding-summary-enabled]');
      enabled.checked=true;summaryEnabled.checked=true;
      page.querySelector('[data-flow-select-choice=onboarding-ai-proactivity][data-value=auto]').click();
      renderOnboardingSummaryDemo();
      const staticComplete=demo.dataset.stage==='written'&&summary.dataset.stage==='saved';
      demo.querySelector('[data-demo-replay]').click();
      const replayComplete=demo.dataset.stage==='written';
      enabled.checked=false;enabled.dispatchEvent(new Event('change',{bubbles:true}));
      summaryEnabled.checked=false;summaryEnabled.dispatchEvent(new Event('change',{bubbles:true}));
      const before=demo.innerHTML+summary.innerHTML;
      await new Promise(resolve=>setTimeout(resolve,1400));
      const examplesRetained=demo.dataset.stage==='off'&&summary.dataset.stage==='off'&&!!demo.querySelector('.onboarding-demo-transcript')&&!!summary.querySelector('[data-demo-summary-result] li')&&!demo.querySelector('button')&&!summary.querySelector('button')&&before===demo.innerHTML+summary.innerHTML;
      enabled.checked=true;summaryEnabled.checked=true;
      enabled.dispatchEvent(new Event('change',{bubbles:true}));
      page.querySelector('[data-flow-select-choice=onboarding-ai-proactivity][data-value=assist]').click();
      renderOnboardingSummaryDemo();
      return {staticComplete,replayComplete,examplesRetained};
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  // 恢复本套测试指定的偏好，不能回落到 CI 机器自身的减少动态效果设置。
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  check(
    reducedAiDemo.result?.value &&
      Object.values(reducedAiDemo.result.value).every((value) => value === true),
    '降低动态效果应直接显示成品；关闭功能后保留静态示例并取消演示计时器：' +
      JSON.stringify(reducedAiDemo.result?.value || reducedAiDemo.exceptionDetails),
  );
  const builtinOnboarding = await client.send('Runtime.evaluate', {
    expression: `(() => {
    const savedPaths = new Map(modelPaths);
    const savedSelection = selectedBuiltinModel;
    const candidates = modelCatalog.filter((model) => model.kind === 'llama-chat');
    const toggle = onboardingPage.querySelector('[name="onboarding-summary-enabled"]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    candidates.forEach((model) => modelPaths.delete(model.id));
    selectedBuiltinModel = '';
    onboardingBuiltinProvider = true; summaryConfigDraft = structuredClone(summaryConfig); summaryConfigDraft.provider = 'built-in'; openModal('summary-model');
    const body = settingsModal.querySelector('.modal-body');
    const previousSource = localStorage.getItem('brevia-china-model-source');
    localStorage.setItem('brevia-china-model-source', 'true');
    const inheritsSource = modelDownloadPayload(candidates[0].id).source === 'china';
    if (previousSource === null) localStorage.removeItem('brevia-china-model-source');
    else localStorage.setItem('brevia-china-model-source', previousSource);
    const localProvider = inheritsSource && body.querySelector('[name="provider"]').value === 'built-in'
      && body.querySelectorAll('[data-flow-select-choice="provider"]').length === summaryProviders.length && !body.querySelector('[data-summary-enabled]')
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
    return { localProvider, offered, downloadAvailable, switched, progressVisible, ready };
  })()`,
    returnByValue: true,
  });
  check(
    Object.values(builtinOnboarding.result?.value || {}).length === 6 &&
      Object.values(builtinOnboarding.result?.value || {}).every(Boolean),
    `AI 引导应默认本地供应商，支持模型选择、下载进度及安装后保存：${JSON.stringify(builtinOnboarding.result?.value || builtinOnboarding.exceptionDetails)}`,
  );
  const cancelledProvider = await client.send('Runtime.evaluate', {
    expression: `(() => {
    const previous = summaryConfig.provider;
    onboardingOnlineProvider = true; summaryConfigDraft = structuredClone(summaryConfig); summaryConfigDraft.provider = 'openai'; openModal('summary-model');
    const draft = summaryConfigDraft.provider;
    closeModal();
    return draft !== 'built-in' && summaryConfig.provider === previous;
  })()`,
    returnByValue: true,
  });
  check(cancelledProvider.result?.value === true, '取消引导页供应商配置不能覆盖已保存选择');
  const configDrafts = await client.send('Runtime.evaluate', {
    expression: `(() => {
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
  })()`,
    returnByValue: true,
  });
  check(
    configDrafts.result?.value === true,
    '纪要与 AI 笔记输入应在刷新和供应商切换后保留，密钥不能进入可持久化配置',
  );
  const rapidNavigation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const homeIsActive = () => activeView === 'home' && document.querySelector('#home-view').classList.contains('active')
      && document.querySelectorAll('body > .app-shell > .workspace > .view.active').length === 1 && document.querySelector('#all-meetings').classList.contains('active')
      && crumb.textContent === catalog[locale].views.home && !document.querySelector('.app-shell').classList.contains('is-live-meeting');
    await showView('home');
    await Promise.all([showView('settings'), showView('prepare'), showView('home')]);
    if (!homeIsActive()) return false;
    await Promise.all([showView('settings'), showLibraryNav(activeLibraryNav)]);
    if (!homeIsActive()) return false;
    await Promise.all([showView('settings'), switchWorkspace(activeWorkspaceId)]);
    if (activeView !== 'settings' || !document.querySelector('#settings-view').classList.contains('active') || document.querySelectorAll('body > .app-shell > .workspace > .view.active').length !== 1 || crumb.textContent !== catalog[locale].views.settings) return false;
    await Promise.all([showLibraryNav('recently-deleted'), showView('settings')]);
    if (activeView !== 'settings' || !document.querySelector('#settings-view').classList.contains('active') || crumb.textContent !== catalog[locale].views.settings) return false;
    await showLibraryNav('all-meetings');
    return homeIsActive();
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    rapidNavigation.result?.value === true,
    '快速连续导航必须到达最后一个目标，且只保留一个活动页面',
  );
  const aiOptions = await client.send('Runtime.evaluate', {
    expression: `(async () => { const page = document.querySelector('.onboarding-ai-setup-page'); const enabled = page.querySelector('[name="onboarding-ai-enabled"]'); enabled.checked=true; enabled.dispatchEvent(new Event('change',{bubbles:true})); const choices = [...page.querySelectorAll('[data-flow-select-choice="onboarding-ai-proactivity"]')]; const options = choices.map(option => option.dataset.value); choices[0].click(); choices[0].focus(); choices[0].dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true})); const keyboard = page.querySelector('[name="onboarding-ai-proactivity"]').value === 'assist' && choices[1].getAttribute('aria-checked') === 'true'; const icons = page.querySelectorAll('.onboarding-ai-icon svg').length; const toggle = page.querySelector('[name="onboarding-summary-enabled"]'); toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); const disabled = [...page.querySelectorAll('[name="onboarding-ai-way"]')].every(option=>!option.disabled) && !page.querySelector('[data-configure-ai-summary]').disabled; await finishAiOnboarding(); const saved = await window.brevia.summary.config.get(); const notes = await window.brevia.aiAssist.config.get(); return { options, icons, keyboard, disabled, saved: saved.enabled, shared: saved.provider===notes.provider && JSON.stringify(saved.providers)===JSON.stringify(notes.providers) }; })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    JSON.stringify(aiOptions.result?.value?.options) === '["quiet","assist","auto"]' &&
      aiOptions.result?.value?.icons === 2 &&
      aiOptions.result?.value?.keyboard &&
      aiOptions.result?.value?.disabled &&
      aiOptions.result?.value?.saved === false &&
      aiOptions.result?.value?.shared,
    `AI 开关、图标或档位未正确保存：${JSON.stringify(aiOptions)}`,
  );
  const floatingBars = await client.send('Runtime.evaluate', {
    expression: `(() => { const live = document.querySelector('#live-view .floating-control-bar'); const player = document.querySelector('#detail-view .floating-control-bar'); const toggle = document.querySelector('#translation-toggle'); toggle.click(); const menuOpen = !document.querySelector('#translation-options').hidden && toggle.getAttribute('aria-expanded') === 'true'; document.body.click(); const menuClosed = document.querySelector('#translation-options').hidden; const tools = [...live.querySelectorAll('.live-caption-controls .icon-button')].every(button => button.querySelector('svg') && button.getAttribute('aria-label')); const noMore = !document.querySelector('#live-more-toggle'); const wasActive = meetingActive, wasSeconds = seconds, wasMeeting=breviaClient.state.meeting, wasSegment=latestLiveSegmentId, wasNotes=currentNotesMarkdown(); meetingActive = true; seconds = 57; breviaClient.state.meeting={id:'toolbar-highlight-test'};latestLiveSegmentId='toolbar-highlight-test';liveSegmentData.set(latestLiveSegmentId,{start_ms:42000,text:'测试字幕重点'});document.querySelector('#mark-important').click(); const note = currentNotesMarkdown();clearTimeout(liveNotesSaveTimer.current);liveNotesEditor.setMarkdown(wasNotes);liveSegmentData.delete(latestLiveSegmentId);latestLiveSegmentId=wasSegment;breviaClient.state.meeting=wasMeeting; meetingActive = wasActive; seconds = wasSeconds; return { live: getComputedStyle(live).position, player: getComputedStyle(player).position, menuOpen, menuClosed, tools, noMore, note }; })()`,
    returnByValue: true,
  });
  check(
    floatingBars.result?.value?.live === 'relative' &&
      floatingBars.result?.value?.player === 'static' &&
      floatingBars.result?.value?.menuOpen &&
      floatingBars.result?.value?.menuClosed &&
      floatingBars.result?.value?.tools &&
      floatingBars.result?.value?.noMore &&
      floatingBars.result?.value?.note?.includes('> [00:57](#brevia-highlight-57000) 测试字幕重点'),
    `悬浮控制栏操作不正确：${JSON.stringify(floatingBars.result?.value)}`,
  );
  const pointerFocus = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const probe=document.createElement('div');probe.id='focus-modality-probe';probe.className='live-control-bar';
      probe.style.cssText='position:fixed;left:8px;top:8px;z-index:9999;width:80px';
      probe.innerHTML='<div class="live-caption-controls"><button class="icon-button" data-enabled="true" aria-label="Focus test">'+interfaceIcon('captions')+'</button></div>';
      probe.returnFocus=document.activeElement;document.body.append(probe);
      const button=probe.querySelector('button');button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));button.focus();
      await new Promise(r=>setTimeout(r,200));
      return {outline:getComputedStyle(button).outlineStyle,keyboard:document.documentElement.hasAttribute('data-keyboard-navigation')};
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    pointerFocus.result?.value?.outline === 'none' && pointerFocus.result.value.keyboard === false,
    '鼠标操作后的自动聚焦不应显示外框：' + JSON.stringify(pointerFocus),
  );
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  const keyboardFocus = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const button=document.querySelector('#focus-modality-probe button');button.focus();
      await new Promise(r=>setTimeout(r,200));const style=getComputedStyle(button);
      return {visible:button.matches(':focus-visible'),outline:style.outlineStyle,decoration:style.textDecorationLine,keyboard:document.documentElement.hasAttribute('data-keyboard-navigation')};
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    keyboardFocus.result?.value?.visible &&
      keyboardFocus.result.value.keyboard &&
      keyboardFocus.result.value.outline === 'none' &&
      keyboardFocus.result.value.decoration.includes('underline'),
    '键盘焦点使用底色与下划线，不显示外圈：' + JSON.stringify(keyboardFocus),
  );
  const restoredPointerFocus = await client.send('Runtime.evaluate', {
    expression: `(()=>{const probe=document.querySelector('#focus-modality-probe'),button=probe.querySelector('button');button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const outline=getComputedStyle(button).outlineStyle;probe.returnFocus?.focus({preventScroll:true});probe.remove();return outline;})()`,
    returnByValue: true,
  });
  check(restoredPointerFocus.result?.value === 'none', '改回鼠标后应清除键盘焦点外框');
  const detailLayout = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    await initializationPromise;
    const mobileDeadline = Date.now() + 10000;
    while (!document.querySelector('.onboarding-mobile-page')) {
      if (Date.now() > mobileDeadline) throw new Error('Mobile onboarding did not appear after AI setup');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const mobilePage = document.querySelector('.onboarding-mobile-page');
    if (mobilePage.querySelectorAll('.mobile-install-platform img').length !== 2
      || !mobilePage.querySelector('a[href$="/android/Brevia-android.apk"]')
      || !mobilePage.querySelector('a[href="https://apps.apple.com/app/id6819869442"]')
      || mobilePage.textContent.includes('TestFlight')) throw new Error('Mobile downloads missing');
    mobilePage.querySelector('[data-onboarding-mobile-pair]').click();
    const pairDialog = document.querySelector('#mobile-pair-dialog');
    for (let i = 0; i < 200 && !pairDialog.open; i++) await new Promise(resolve => setTimeout(resolve, 50));
    if (!pairDialog.open || !document.querySelector('.onboarding-mobile-page')) throw new Error('Onboarding pairing is not a separate dialog: ' + JSON.stringify({open:pairDialog.open,connected:pairDialog.isConnected,error:document.querySelector('#mobile-pair-error').textContent,handler:typeof (mobileConnectionContent || document.getElementById('mobile-dialog')).querySelector('#mobile-pair').onclick}));
    if(getComputedStyle(document.activeElement).outlineStyle !== 'none') throw new Error('Pairing autofocus shows explicit focus outline');
    document.querySelector('#mobile-close-pairing').click();
    for (let i = 0; i < 60 && pairDialog.open; i++) await new Promise(resolve => setTimeout(resolve, 50));
    if (pairDialog.open) throw new Error('Pairing did not close');
    mobilePage.querySelector('[data-onboarding-mobile-skip]').click();
    const finishDeadline = Date.now() + 10000;
    while (document.querySelector('.onboarding-page')) {
      if (Date.now() > finishDeadline) throw new Error('Mobile onboarding did not complete');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!localStorage.getItem('brevia-onboarding-complete') || typeof openOnboardingTour !== 'undefined') throw new Error('Removed tour is still reachable');
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
        const notes = document.querySelector('#detail-view [data-detail-panel]:not([hidden])').getBoundingClientRect();
        const player = document.querySelector('#detail-view .player').getBoundingClientRect();
        if (panel.width <= 0 || panel.height <= 0 || notes.height <= 0 || panel.bottom > player.top + 1 || notes.bottom > innerHeight + 1) failures.push(code + '/' + theme + ': meeting content hidden or overlaps player');
      }
      if (document.querySelectorAll('[data-settings-path]').length !== 2) failures.push(code + ': duplicate storage rows');
      const error = storageErrorMessage(new Error('Chosen recording folder is no longer empty'));
      if (error !== catalog[code].labels['请选择空文件夹。']) failures.push(code + ': untranslated storage error');
    }
    applyLanguage('zh');
    return failures;
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(detailLayout.result?.value) && detailLayout.result.value.length === 0,
    `多语言/主题布局回归：${JSON.stringify(detailLayout)}`,
  );
  const deviceLanguages = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const previous = locale;
    await showView('home');
    await new Promise(resolve => setTimeout(resolve, 2100));
    const card = document.querySelector('#mobile-nav');
    const errors = [];
    for (const language of Object.keys(catalog)) {
      applyLanguage(language);
      const status = document.querySelector('#mobile-sidebar-status');
      const translated = [t('等待设备连接'), t('服务已关闭')].includes(status.textContent);
      const fits = () => [...card.querySelectorAll('strong, svg, #mobile-sidebar-status, #mobile-nav-dot')].every(node => {
        if (!node.getClientRects().length) return true;
        const bounds = node.getBoundingClientRect(), outer = card.getBoundingClientRect();
        const style = getComputedStyle(node);
        const clippedStatus = node.id === 'mobile-sidebar-status' && style.clipPath === 'inset(50%)' && style.overflow === 'hidden';
        return bounds.right <= outer.right + 1 && bounds.left >= outer.left - 1 && (clippedStatus || node.scrollWidth <= node.clientWidth + 1);
      });
      const normalFits = fits();
      if(!translated)errors.push(language+': sidebar status untranslated');
      if(!normalFits)errors.push(language+': sidebar content clipped');
      if(!card.title.includes(status.textContent)||card.getAttribute('aria-label')!==card.title)errors.push(language+': device status accessible label missing');
      await card.onclick();
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      if(activeView!=='settings'||!settingsModal.classList.contains('settings-page'))errors.push(language+': status bar did not open device settings');
      const phone=document.querySelector('#mobile-dialog'),{devices,sessions}=await window.brevia.mobile.status();
      const expected=devices.length?'paired':'intro';
      if(phone.dataset.mobilePageState!==expected||!phone.querySelector('[data-mobile-panel="'+expected+'"]').checkVisibility())errors.push(language+': device page stage mismatch');
      if(expected==='paired'){
        const equipment=phone.querySelector('.mobile-equipment');
        const owner=sessions?.find(session=>!session.finished)?.owner;
        const device=devices.find(d=>d.id===owner)||devices.find(d=>d.connected)||devices[0];
        const state=device?(device.connected?'connected':'offline'):'empty';
        if(!equipment.checkVisibility()||equipment.dataset.link!==state||equipment.querySelector('[data-mobile-handset-name]').textContent!==(device?.name||''))errors.push(language+': device graphic does not match trust records');
      }
      if(expected==='intro'){
        const body=phone.closest('.modal-body');
        const bounds=body.getBoundingClientRect();
        const elements=['.mobile-page-intro','.mobile-intro-actions','.mobile-page-support','.dmp-phone'].map(selector=>{
          const el=phone.querySelector(selector),rect=el.getBoundingClientRect();
          return {selector,visible:el.checkVisibility(),top:Math.round(rect.top),bottom:Math.round(rect.bottom),fits:rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1&&rect.left>=bounds.left-1&&rect.right<=bounds.right+1};
        });
        if(body.scrollHeight>body.clientHeight+1||body.scrollWidth>body.clientWidth+1||elements.some(el=>!el.visible||!el.fits))errors.push(language+': device introduction does not fit '+JSON.stringify({window:[innerWidth,innerHeight],client:[body.clientWidth,body.clientHeight],scroll:[body.scrollWidth,body.scrollHeight],elements}));
        phone.querySelector('[data-mobile-page-step=install]').click();
        if(phone.dataset.mobilePageState!=='install'||!phone.querySelector('[data-mobile-panel=install]').checkVisibility()||!phone.querySelector('.mobile-install').open)errors.push(language+': install step inaccessible');
      }
      const modalTranslated=document.querySelector('#mobile-pair').textContent === t('连接新设备')
        && document.querySelector('#mobile-install-title').textContent === t('安装Brevia手机端')
        && document.querySelector('.mobile-install-platform a').href === 'https://apps.apple.com/app/id6819869442'
        && document.querySelector('.mobile-install-platform h4').textContent === t('iPhone · App Store')
        && document.querySelector('.mobile-install-platform p').textContent === t('扫码或点击链接，从 App Store 免费安装 Brevia。')
        && (document.querySelector('.mobile-device-empty')?.textContent === t('暂无已信任设备') || document.querySelector('.mobile-device small')?.textContent === t('离线 · 保留信任'));
      if(!modalTranslated)errors.push(language+': device dialog content untranslated');
      if(expected==='intro'){
        phone.querySelector('[data-mobile-panel=install] [data-mobile-page-step=back]').click();
        if(phone.dataset.mobilePageState!=='intro'||phone.querySelector('[data-mobile-panel=install]').checkVisibility())errors.push(language+': install back did not restore introduction');
      }
      closeModal();
      await showView('home');
    }
    applyLanguage(previous);
    return errors;
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(deviceLanguages.result?.value) && deviceLanguages.result.value.length === 0,
    '设备连接八语言及长名称布局：' +
      JSON.stringify(deviceLanguages.result?.value || deviceLanguages.exceptionDetails),
  );
  const preparePairing = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      setPrepareMode('record');
      await showView('prepare');
      prepareForm.querySelector('[data-flow-select-choice="capture-mode"][data-value="phone"]').click();
      const title=prepareForm.querySelector('#meeting-title'),oldTitle=title.value;
      title.value='配对后继续的会议';
      const draft=JSON.stringify([...new FormData(prepareForm)]);
      const button=prepareForm.querySelector('[data-capture-phone]');
      button.focus();
      await button.onclick();
      const pair=document.querySelector('#mobile-pair-dialog');
      const inline=activeView==='prepare'&&pair.open&&settingsModal.hidden;
      await pair.querySelector('#mobile-close-pairing').onclick();
      const retained=activeView==='prepare'&&!pair.open&&document.activeElement===button&&title.value==='配对后继续的会议'&&currentCaptureMode==='phone'&&draft===JSON.stringify([...new FormData(prepareForm)]);
      title.value=oldTitle;setPrepareMode('record');await showView('home');
      return {inline,retained};
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    preparePairing.result?.value?.inline && preparePairing.result.value.retained,
    '准备录音中就地连接设备须恢复焦点并保留会议草稿：' +
      JSON.stringify(preparePairing.result?.value || preparePairing.exceptionDetails),
  );
  const librarySearchCommand = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      await initializationPromise;
      await showView('home');
      const shortcut=document.querySelector('#library-search-shortcut');
      const search=document.querySelector('#meeting-search');
      const key=()=>new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:window.brevia.platform==='darwin',ctrlKey:window.brevia.platform!=='darwin',bubbles:true,cancelable:true});
      const waitForSearch=async()=>{
        const until=Date.now()+3000;
        while(document.activeElement!==search&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
        return document.activeElement===search&&!document.querySelector('.app-shell').classList.contains('is-library-hidden');
      };
      shortcut.focus();shortcut.click();
      if(!await waitForSearch())errors.push('sidebar search did not focus meeting search');
      await showView('settings');
      shortcut.focus();
      const command=key();shortcut.dispatchEvent(command);
      if(!command.defaultPrevented||activeView!=='home'||!await waitForSearch())errors.push('keyboard search did not navigate and focus');
      const library=document.querySelector('.library-panel'),sidebar=document.querySelector('.sidebar'),workspace=document.querySelector('.workspace');
      if(library!==sidebar||!sidebar.contains(meetingList)||!sidebar.contains(taskCards)||document.querySelectorAll('#desktop-app > aside').length!==1||Math.abs(sidebar.getBoundingClientRect().width-(innerWidth<=1050?240:260))>1)errors.push('single persistent meeting sidebar missing');
      const group=meetingList.querySelector('.sidebar-workspace');
      let groupToggle=group?.querySelector('.sidebar-workspace-toggle'),groupMeetings=group?.querySelector('.sidebar-workspace-meetings');
      if(!groupToggle||!groupMeetings||groupToggle.getAttribute('aria-expanded')!=='true'||groupMeetings.hidden)errors.push('workspace tree initially collapsed or missing');
      else {
        groupToggle.click();await new Promise(resolve=>setTimeout(resolve,50));
        groupToggle=meetingList.querySelector('.sidebar-workspace-toggle');groupMeetings=meetingList.querySelector('.sidebar-workspace-meetings');
        if(groupToggle.getAttribute('aria-expanded')!=='false'||!groupMeetings.hidden)errors.push('workspace tree does not collapse');
        groupToggle.click();await new Promise(resolve=>setTimeout(resolve,50));
        groupToggle=meetingList.querySelector('.sidebar-workspace-toggle');groupMeetings=meetingList.querySelector('.sidebar-workspace-meetings');
        if(groupToggle.getAttribute('aria-expanded')!=='true'||groupMeetings.hidden)errors.push('workspace tree does not expand');
      }
      for(const row of meetingList.querySelectorAll('.meeting-row')){
        if(Math.abs(row.getBoundingClientRect().height-28)>1)errors.push('meeting tree row density');
        if([...row.querySelectorAll('.meeting-main p,.meeting-status,.meeting-row-icon,.meeting-workspace,.meeting-source')].some(node=>node.checkVisibility()))errors.push('meeting tree shows retired metadata');
      }
      const initialized=await window.brevia.initialize();
      const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
      applyBackendDetail(meeting);await showView('detail');renderMeetingList();
      const documentPanel=document.querySelector('[data-detail-panel=notes]');
      shortcut.focus();shortcut.dispatchEvent(key());
      if(!await waitForSearch()||activeView!=='detail'||currentMeetingDetail.id!==meeting.id||document.querySelector('[data-detail-panel=notes]')!==documentPanel)errors.push('library search replaced open document');
      const currentRow=meetingList.querySelector('[data-meeting-id="'+CSS.escape(meeting.id)+'"]');
      if(!currentRow||currentRow.getAttribute('aria-current')!=='page')errors.push('open meeting missing current navigation state');
      const toggle=document.querySelector('#library-toggle'),left=workspace.getBoundingClientRect().left;
      toggle.click();await new Promise(requestAnimationFrame);
      if(toggle.getAttribute('aria-expanded')!=='false'||getComputedStyle(library).visibility!=='hidden'||Math.abs(library.getBoundingClientRect().width)>1||workspace.getBoundingClientRect().left>=left||Math.abs(workspace.getBoundingClientRect().left)>1||activeView!=='detail')errors.push('library toggle did not expand current workspace');
      shortcut.click();await waitForSearch();
      if(toggle.getAttribute('aria-expanded')!=='true'||getComputedStyle(library).visibility!=='visible'||Math.abs(library.getBoundingClientRect().width-(innerWidth<=1050?240:260))>1||activeView!=='detail')errors.push('search did not restore library beside document');
      const wasActive=meetingActive;
      meetingActive=true;await showView('live');
      const notes=currentNotesMarkdown(),liveEditor=liveNotesEditor;
      shortcut.focus();shortcut.dispatchEvent(key());
      if(!await waitForSearch()||activeView!=='live'||!meetingActive||liveNotesEditor!==liveEditor||currentNotesMarkdown()!==notes)errors.push('library search interrupted recording workspace');
      meetingActive=wasActive;await showView('home');
      for(const tag of ['input','textarea','div']){
        const editor=document.createElement(tag);
        if(tag==='div'){editor.contentEditable='true';editor.textContent='draft';}
        else editor.value='draft';
        document.body.append(editor);editor.focus();
        const event=key();editor.dispatchEvent(event);
        if(event.defaultPrevented||document.activeElement!==editor||(tag==='div'?editor.textContent:editor.value)!=='draft')errors.push(tag+': search intercepted editing');
        editor.remove();
      }
      await openModal('upgrade-log');
      const modalButton=settingsModal.querySelector('button');modalButton.focus();
      const modalFocus=document.activeElement,modalView=activeView;
      const modalCommand=key();modalButton.dispatchEvent(modalCommand);
      shortcut.click();
      await new Promise(resolve=>setTimeout(resolve,50));
      if(modalCommand.defaultPrevented||activeModal!=='upgrade-log'||activeView!==modalView||document.activeElement!==modalFocus)errors.push('search escaped modal');
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      await showView('detail');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(librarySearchCommand.result?.value) &&
      librarySearchCommand.result.value.length === 0,
    `搜索入口、快捷键、编辑与弹窗保护：${JSON.stringify(librarySearchCommand)}`,
  );
  const refineModelLayout = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const previousView=activeView;
      await showView('detail');
      const host=document.createElement('div');
      host.className='refine-menu';
      host.style.cssText='position:fixed;left:340px;top:120px;z-index:1000';
      host.innerHTML=renderRefineModelRow([
        ['qwen','Qwen3-ASR 0.6B 8bit · 下载 960MB','推荐'],
        ['fire','FireRedASR2-AED · 下载 4.25GB',''],
        ['long','ASR'.repeat(40),''],
      ],'qwen');
      document.querySelector('#detail-view').append(host);
      try{
        const toggle=host.querySelector('.ui-select-trigger'),menu=host.querySelector('.ui-select-list');
        menu.hidden=false;fitFlowSelectOptions(menu,toggle);
        const fits=()=>[menu,...menu.querySelectorAll('.ui-select-option,.ui-select-option > span')].every(element=>{
          const rect=element.getBoundingClientRect();
          return rect.width>0&&element.scrollWidth<=element.clientWidth+1;
        });
        const initial=fits();
        toggle.firstChild.nodeValue='ASR'.repeat(40);
        const changed=fits();
        const arrow=toggle.querySelector('.select-chevron').getBoundingClientRect(),bounds=toggle.getBoundingClientRect();
        const style=getComputedStyle(toggle);
        const triggerFits=bounds.width>0&&bounds.right<=host.getBoundingClientRect().right+1&&(toggle.scrollWidth<=toggle.clientWidth+1||(style.overflowX==='hidden'&&style.textOverflow==='ellipsis'));
        const arrowFits=arrow.width>=11.5&&arrow.height>=11.5&&arrow.left>=bounds.left&&arrow.right<=bounds.right&&arrow.top>=bounds.top&&arrow.bottom<=bounds.bottom;
        const menuBounds=menu.getBoundingClientRect();
        const menuFits=menuBounds.left>=0&&menuBounds.right<=innerWidth+1&&menuBounds.top>=0&&menuBounds.bottom<=innerHeight+1;
        return {initial,changed,triggerFits,arrowFits,menuFits};
      }finally{host.remove();await showView(previousView);}
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    refineModelLayout.result?.value &&
      Object.values(refineModelLayout.result.value).every((value) => value === true),
    `识别模型长文本布局回归：${JSON.stringify(refineModelLayout)}`,
  );
  const editingRegression = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    await initializationPromise;
    const meeting = await window.brevia.meeting.get({ meeting_id: breviaClient.state.initialized.meetings[0].id });
    const chosen = refinedModelOptions(meeting.language).at(-1)?.[0];
    if (chosen) meeting.refined_model_id = chosen;
    // 独立验证首次载入；前一用例已打开同一会议，不能把保留本地选择误判为回归。
    currentMeetingDetail = null;
    applyBackendDetail(meeting);
    const selected = !chosen || uiData.detail.refinedModelId === chosen;
    uiData.detail.summary = { markdown: 'saved memo', hasFull: true };
    detailActiveTab='summary';
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
    const beforeSwitch=currentMeetingDetail.id;
    await openMeetingRow({dataset:{meetingId:'blocked-draft-switch'},style:{}});
    const switchBlocked=currentMeetingDetail.id===beforeSwitch&&inlineSummaryEditor.getMarkdown()===draft&&uiData.detail.summaryEditing;
    for (let index = 0; index < 30; index += 1) renderMeetingDetail();
    return { selected, localizedDraft, refreshedDraft, switchBlocked, editing: uiData.detail.summaryEditing };
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    editingRegression.result?.value?.selected &&
      editingRegression.result?.value?.localizedDraft &&
      editingRegression.result?.value?.refreshedDraft &&
      editingRegression.result?.value?.switchBlocked &&
      editingRegression.result?.value?.editing,
    `草稿/模型回归：${JSON.stringify(editingRegression)}`,
  );
  const documentObject = await client.send('Runtime.evaluate', { expression: 'document' });
  const listenersBefore = await client.send('DOMDebugger.getEventListeners', {
    objectId: documentObject.result.objectId,
  });
  await client.send('Runtime.evaluate', {
    expression: 'for (let index = 0; index < 30; index += 1) renderMeetingDetail();',
  });
  const listenersAfter = await client.send('DOMDebugger.getEventListeners', {
    objectId: documentObject.result.objectId,
  });
  check(
    listenersBefore.listeners.length === listenersAfter.listeners.length,
    '重建编辑器不应增加 document 监听器数量',
  );
  const captionClose = await client.send('Runtime.evaluate', {
    expression: `(async () => {
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
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(captionClose.result?.value === 2, `悬浮字幕关闭通知缺失：${JSON.stringify(captionClose)}`);
  const scaleAfterCaption = await client.send('Runtime.evaluate', {
    expression: 'outerWidth / innerWidth',
    returnByValue: true,
  });
  check(
    Math.abs(scaleAfterCaption.result?.value - defaultWindowScale) < 0.02,
    '打开及关闭独立字幕窗口后，主应用仍保持默认缩放',
  );
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(880 * defaultWindowScale),
    height: Math.round(720 * defaultWindowScale),
    deviceScaleFactor: 1,
    mobile: false,
  });
  const minimumWindow = await client.send('Runtime.evaluate', {
    expression: `({ activeView, className: document.querySelector('#detail-view').className, display: getComputedStyle(document.querySelector('#detail-view')).display, onboarding: [...document.querySelectorAll('.onboarding-page')].map(page => page.className), shell: getComputedStyle(document.querySelector('.app-shell')).display, parentWidth: document.querySelector('#detail-view').parentElement.getBoundingClientRect().width, width: document.querySelector('#detail-view').getBoundingClientRect().width, sidebar: getComputedStyle(document.querySelector('.app-shell > .sidebar')).display })`,
    returnByValue: true,
  });
  check(
    minimumWindow.result?.value?.width > 500 && minimumWindow.result?.value?.sidebar !== 'none',
    `最小桌面窗口丢失内容或导航：${JSON.stringify(minimumWindow.result?.value)}`,
  );
  const changelog = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const errors = [];
    for (const code of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      applyLanguage(code); applyTheme(theme);
      await openModal('whats-new');
      const current = settingsModal.querySelector('.whatsnew-entry.is-current');
      const body = settingsModal.querySelector('.modal-body');
      if (!current || !current.textContent.includes(whatsNewLog[0].version)) errors.push(code + ': missing current version');
      if (body.scrollWidth > body.clientWidth + 1) errors.push(code + '/' + theme + ': horizontal overflow');
      const history = settingsModal.querySelector('details.whatsnew-entry:not(.is-current)');
      if (!history || history.open) errors.push(code + ': history must start collapsed');
      history.querySelector('summary').click();
      if (!history.open || !history.querySelector('section')) errors.push(code + ': history cannot be expanded');
      const version=history.dataset.modalDetail,top=body.scrollTop;
      renderWhatsNewModal();
      const refreshed=[...body.querySelectorAll('details.whatsnew-entry')].find(entry=>entry.dataset.modalDetail===version);
      if(!refreshed?.open||Math.abs(body.scrollTop-top)>1)errors.push(code+': history refresh lost reading state');
      if (whatsNewLog[0].contributors?.length && !current.textContent.includes(whatsNewCopy[code].contributors)) errors.push(code + ': missing contributors');
      for (const anchor of current.querySelectorAll('a')) if (!anchor.href.startsWith('https://github.com/') || anchor.target !== '_blank') errors.push('unsafe release link');
    }
    closeModal(); applyLanguage('zh'); applyTheme('light');
    return errors;
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(changelog.result?.value) && changelog.result.value.length === 0,
    `双语更新日志布局或链接异常：${JSON.stringify(changelog)}`,
  );
  const upgradeSmall = await client.send('Runtime.evaluate', {
    expression: `(async()=>{await openModal('upgrade-log');const body=settingsModal.querySelector('.modal-body'),panel=settingsModal.querySelector('.modal-panel'),footer=settingsModal.querySelector('.upgrade-log-actions');settingsModal.dispatchEvent(new MouseEvent('click',{bubbles:true}));return activeModal==='upgrade-log'&&!settingsModal.contains(document.activeElement)&&body.scrollWidth<=body.clientWidth+1&&panel.scrollHeight<=panel.clientHeight+1&&footer.getBoundingClientRect().bottom<=innerHeight;})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(upgradeSmall.result?.value === true, '升级浮窗在最小窗口溢出、焦点不正确或遮罩误关闭');
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  check(
    (
      await client.send('Runtime.evaluate', {
        expression: `document.activeElement===settingsModal.querySelector('.modal-close')`,
        returnByValue: true,
      })
    ).result?.value === true,
    '升级标题的Tab未进入关闭按钮',
  );
  await client.send('Runtime.evaluate', {
    expression: `settingsModal.querySelector('[data-update-log-dismiss]').focus()`,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  check(
    (
      await client.send('Runtime.evaluate', {
        expression: `document.activeElement===settingsModal.querySelector('.modal-close')`,
        returnByValue: true,
      })
    ).result?.value === true,
    'Tab焦点越出升级浮窗',
  );
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(
    (
      await client.send('Runtime.evaluate', {
        expression: `settingsModal.hidden&&!document.querySelector('.app-shell').inert&&localStorage.getItem('brevia-whatsnew-seen')===installedAppVersion`,
        returnByValue: true,
      })
    ).result?.value === true,
    'Esc未关闭升级浮窗、保存已读或恢复交互',
  );
  await client.send('Emulation.clearDeviceMetricsOverride');
  const settingsNavigation = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      await showView('settings');
      const errors=[];
      for(let attempt=0;attempt<2;attempt++) {
        const pending=openModal('advanced-settings');
        await openModal('models');
        await pending;
        if(activeModal!=='models')errors.push('late settings replaced model library');
      }
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      const dismissed=openModal('advanced-settings');
      closeModal();await dismissed;
      if(!settingsModal.hidden)errors.push('closed settings reopened');
      const confirmed=openModal('advanced-settings');
      openConfirmation(t('删除'),t('此操作不可恢复。'),()=>{});
      await confirmed;
      if(activeModal!=='confirmation')errors.push('late settings replaced confirmation');
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      const leaving=openModal('advanced-settings');
      await showView('home');await leaving;
      if(!settingsModal.hidden||document.querySelector('.app-shell').inert)errors.push('late settings blocked home');
      const previous=locale;
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']) {
        applyLanguage(code);
        const heading=document.querySelector('#settings-view .preferences-titlebar h1');
        if(!heading || heading.textContent.trim()!==t('通用'))errors.push('untranslated settings heading: '+code);
      }
      applyLanguage(previous);
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(settingsNavigation.result?.value) && !settingsNavigation.result.value.length,
    '设置导航竞态或标题翻译：' +
      JSON.stringify(
        settingsNavigation.result?.value ||
          settingsNavigation.exceptionDetails?.exception?.description ||
          settingsNavigation.exceptionDetails ||
          settingsNavigation,
      ),
  );
  const mergedAiSettings = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const settled = async predicate => {
      const deadline=Date.now()+5000;
      while(!predicate()) { if(Date.now()>deadline) throw new Error('AI settings save timed out'); await new Promise(resolve=>setTimeout(resolve,25)); }
    };
    const saveInPlace = async kind => {
      const form=settingsModal.querySelector('form');
      form.dispatchEvent(new Event('input',{bubbles:true}));
      if(!form.querySelector('[data-save-state="dirty"]')) return false;
      form.requestSubmit();
      await settled(()=>form.dataset.savePending==='false');
      return activeView==='settings' && activeModal===kind && !settingsModal.hidden
        && form.isConnected && !!form.querySelector('[data-save-state="saved"]')
        && !form.querySelector('[type="submit"]').disabled;
    };
    meetingActive = false;
    summaryConfig.enabled = false;
    aiAssistConfig.enabled = false;
    aiAssistConfig.proactivity = 'quiet';
    await Promise.all([persistSummaryConfig(), persistAiAssistConfig()]);
    await showView('settings');
    const routes = [...document.querySelectorAll('#settings-view .preferences-navigation [data-settings-page]')].map(button => button.dataset.settingsPage);
    await openModal('ai-features');
    const initial = settingsModal.classList.contains('settings-page')
      && settingsModal.querySelectorAll('[data-ai-settings-tab]').length===2
      && !settingsModal.querySelector('[data-summary-enabled]').checked
      && !onboardingPage && getComputedStyle(document.querySelector('.app-shell')).display !== 'none';
    await openModal('ai-assist');
    settingsModal.querySelector('[data-ai-settings-enabled]').click();
    closeModal(); await new Promise(resolve => setTimeout(resolve,350));
    const cancelled = !aiAssistConfig.enabled && !summaryConfig.enabled;
    await openModal('ai-assist');
    const notesConfig = !!settingsModal.querySelector('.ai-assist-config-form');
    settingsModal.querySelector('[name="proactivity"][value="auto"]').click();
    const selected = aiAssistConfigDraft.proactivity==='auto';
    const notesSavedInPlace=await saveInPlace('ai-assist');
    const summary = await window.brevia.summary.config.get();
    const notes = await window.brevia.aiAssist.config.get();
    const saved = !summary.enabled && !notes.enabled && notes.proactivity==='auto';
    const model = modelCatalog.find(item => item.kind === 'llama-chat').id;
    modelPaths.set(model, '/tmp/e2e-ai-model');
    summaryConfig.provider='built-in'; summaryConfig.providers={'built-in':{model}};
    aiAssistConfig.provider='built-in'; aiAssistConfig.providers={'built-in':{model}};
    await openModal('ai-features');
    { const enabled=settingsModal.querySelector('[data-summary-enabled]'); enabled.click(); await settled(()=>!enabled.disabled); }
    const summaryOnly = summaryConfig.enabled && !aiAssistConfig.enabled;
    const summarySavedInPlace=await saveInPlace('summary-model');
    await openModal('ai-assist');
    const restored = !settingsModal.querySelector('[data-ai-settings-enabled]').checked
      && settingsModal.querySelector('[name="proactivity"][value="auto"]').checked;
    await openModal('ai-features');
    { const enabled=settingsModal.querySelector('[data-summary-enabled]'); enabled.click(); await settled(()=>!enabled.disabled); }
    await openModal('ai-assist');
    settingsModal.querySelector('[data-ai-settings-enabled]').click();
    const enabledSavedInPlace=await saveInPlace('ai-assist');
    const independent = summaryOnly && restored && !(await window.brevia.summary.config.get()).enabled
      && (await window.brevia.aiAssist.config.get()).enabled;
    let dismissible=true;
    for (const close of ['button','backdrop','escape']) {
      await openModal('ai-features');
      if(close==='button') settingsModal.querySelector('.modal-close').click();
      else if(close==='backdrop') settingsModal.click();
      else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,350));
      dismissible=dismissible && settingsModal.hidden && !document.body.classList.contains('modal-open');
    }
    await showView('home');
    await openModal('ai-assist');
    settingsModal.querySelector('[data-ai-settings-enabled]').click();
    settingsModal.querySelector('form').requestSubmit();
    await settled(()=>settingsModal.hidden);
    const floatingDisabled = !(await window.brevia.aiAssist.config.get()).enabled;
    await openModal('ai-assist');
    settingsModal.querySelector('[data-ai-settings-enabled]').click();
    const floatingForm = settingsModal.querySelector('form');
    const floatingFormEnabled = new FormData(floatingForm).get('enabled')==='on';
    floatingForm.requestSubmit();
    await settled(()=>settingsModal.hidden);
    const floatingSaved = floatingDisabled && floatingFormEnabled && (await window.brevia.aiAssist.config.get()).enabled;
    return { routes, initial, cancelled, notesConfig, saved, selected, notesSavedInPlace, summarySavedInPlace, enabledSavedInPlace, summaryOnly, restored, independent, dismissible, floatingSaved, closed: settingsModal.hidden };
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const merged = mergedAiSettings.result?.value;
  check(
    merged?.routes?.filter((kind) => kind === 'ai-features').length === 1 &&
      !merged.routes.includes('ai-assist') &&
      !merged.routes.includes('summary-model') &&
      merged.initial &&
      merged.cancelled &&
      merged.notesConfig &&
      merged.saved &&
      merged.selected &&
      merged.notesSavedInPlace &&
      merged.summarySavedInPlace &&
      merged.enabledSavedInPlace &&
      merged.independent &&
      merged.dismissible &&
      merged.floatingSaved &&
      merged.closed,
    `合并 AI 设置回归：${JSON.stringify(mergedAiSettings)}`,
  );
  // 默认布局不继承真实鼠标或上个用例留下的侧栏Hover状态。
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 100 });
  const compactSettings = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    const previousLocale = locale, previousTheme = theme;
    const errors = [];
    await showView('settings');
    for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) for (const appearance of ['light', 'dark']) {
      applyLanguage(code); applyTheme(appearance);
      for (const kind of ['summary-model', 'ai-assist', 'device-connection']) {
        for (const provider of kind === 'device-connection' ? [''] : ['built-in', 'custom-openai', 'custom-claude']) {
          await openModal(kind);
          if (provider) {
            const config = kind === 'summary-model' ? summaryConfigDraft : aiAssistConfigDraft;
            config.provider = provider;
            renderModal(kind);
          }
          await new Promise(resolve => setTimeout(resolve, 260));
          // 导航已改为不等待视觉完成；静态布局检查先结束有限动画并提交一帧。
          await document.fonts.ready;
          document.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).forEach(animation=>animation.finish());
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const body = settingsModal.querySelector('.modal-body');
          if (kind === 'device-connection' && (document.querySelector('#mobile-service-toggle').getAttribute('aria-label') !== t('手机连接服务') || document.querySelector('[data-mobile-copy-preview]').getAttribute('aria-label') !== t('复制配对码')))
            errors.push([code, appearance, 'untranslated device accessibility label']);
          if (body.scrollWidth > body.clientWidth + 1)
            errors.push([code, appearance, kind, provider, 'horizontal overflow', body.clientWidth, body.scrollWidth]);
          // 设置正文按内容独立滚动；必须真正可滚到底并完整触及保存动作。
          if (body.scrollHeight > body.clientHeight + 1) {
            const previousScroll=body.scrollTop;
            body.scrollTop=body.scrollHeight;
            await new Promise(resolve=>requestAnimationFrame(resolve));
            if (!['auto','scroll'].includes(getComputedStyle(body).overflowY) || body.scrollTop + body.clientHeight < body.scrollHeight - 1)
              errors.push([code, appearance, kind, provider, 'vertical scroll inaccessible', body.clientHeight, body.scrollHeight, body.scrollTop]);
            const action=body.querySelector('.modal-form-actions [type="submit"]');
            if(action){
              const bounds=action.getBoundingClientRect(),viewport=body.getBoundingClientRect();
              if(!action.checkVisibility()||bounds.top<viewport.top-1||bounds.bottom>viewport.bottom+1||bounds.left<viewport.left-1||bounds.right>viewport.right+1)
                errors.push([code,appearance,kind,provider,'save action unreachable']);
            }
            body.scrollTop=previousScroll;
          }
        }
      }
    }
    await openModal('advanced-settings');
    const permission = settingsModal.querySelector('[data-permission-settings]');
    const permissionHeading=permission.querySelector('.preferences-section-heading');
    if(!permissionHeading || !permissionHeading.checkVisibility() || permissionHeading.textContent.trim()!==t('系统权限')) errors.push('permission section heading missing');
    const permissionRows=[...permission.querySelectorAll('.preferences-permission-row')];
    if(permissionRows.length!==2)errors.push('permission rows missing');
    for(const row of permissionRows){
      const bounds=row.getBoundingClientRect(),copy=row.querySelector('.preference-copy'),control=row.querySelector('.preferences-permission-control');
      const text=copy.getBoundingClientRect(),action=control.getBoundingClientRect();
      if(bounds.height<32 || text.left<bounds.left-1 || text.right>action.left+1 || action.right>bounds.right+1 || copy.scrollWidth>copy.clientWidth+1)errors.push('permission row clipped');
    }
    const advancedForm = settingsModal.querySelector('.advanced-settings-form');
    const numeric = name => advancedForm.elements.namedItem(name);
    const sampleRate = numeric('audio.sample_rate');
    if (!sampleRate.readOnly || sampleRate.value !== '16000') errors.push('fixed sample rate');
    for (const key of advancedSettings.inactive_fields) {
      if ([...advancedForm.elements].some(input => input.name.split('.').at(-1) === key)) errors.push('inactive advanced setting: ' + key);
    }
    for (const input of advancedForm.querySelectorAll('input[type=number]')) {
      const limits = advancedSettings.field_constraints[input.name];
      if (input.step !== String(limits.step) || input.min !== String(limits.min) || (limits.max !== undefined && input.max !== String(limits.max))) errors.push('numeric limits: ' + input.name);
    }
    const chunk = numeric('audio.chunk_seconds'), threshold = numeric('vad.zh.threshold');
    const audioSection=sampleRate.closest('details'),previouslyOpen=audioSection.open;
    audioSection.open=true;
    await new Promise(requestAnimationFrame);
    for(const appearance of ['light','dark']){
      applyTheme(appearance);
      for(const field of [sampleRate,chunk]){
        const frame=field.getBoundingClientRect(),column=field.closest('.preference-control').getBoundingClientRect();
        if(!frame.height || Math.abs(frame.left-column.left)>1 || Math.abs(frame.width-column.width)>1)errors.push(appearance+': advanced input does not fill its column');
      }
      const fixed=sampleRate.getBoundingClientRect(),editable=chunk.getBoundingClientRect();
      if(Math.abs(fixed.width-editable.width)>1 || Math.abs(fixed.height-editable.height)>1 || Math.abs(fixed.left-editable.left)>1)errors.push(appearance+': advanced numeric fields not aligned');
      const groupStyle=getComputedStyle(permission);
      for(const group of advancedForm.querySelectorAll('.preferences-disclosure')){
        const style=getComputedStyle(group);
        if(style.backgroundColor!==groupStyle.backgroundColor || style.borderWidth!==groupStyle.borderWidth || style.borderRadius!==groupStyle.borderRadius)errors.push(appearance+': advanced groups use different surfaces');
      }
    }
    audioSection.open=previouslyOpen;
    chunk.value = '1.5';
    if (!chunk.validity.stepMismatch) errors.push('integer setting accepts fraction');
    chunk.value = advancedSettings.settings.audio.chunk_seconds;
    threshold.value = '1.1';
    if (!threshold.validity.rangeOverflow) errors.push('threshold accepts value over one');
    threshold.value = advancedSettings.settings.vad.zh.threshold;
    const cap = numeric('live_asr.max_speech_seconds'), minimum = numeric('vad.zh.min_speech_duration');
    cap.value = '0.5'; cap.dispatchEvent(new Event('input', {bubbles:true}));
    if (!cap.validity.customError) errors.push('live cap gap');
    cap.value = '1'; minimum.value = '3'; minimum.dispatchEvent(new Event('input', {bubbles:true}));
    if (!cap.validity.customError || Number(numeric('vad.zh.max_speech_duration').min) <= 3) errors.push('speech limits do not follow minimum');
    cap.value = '0'; minimum.value = advancedSettings.settings.vad.zh.min_speech_duration;
    minimum.dispatchEvent(new Event('input', {bubbles:true}));
    if (!advancedForm.checkValidity()) errors.push('valid advanced values cannot be saved');
    cap.value = advancedSettings.settings.live_asr.max_speech_seconds;
    cap.dispatchEvent(new Event('input', {bubbles:true}));
    const quietHint = numeric('live_asr.quiet_speech_recovery').closest('label').querySelector('small').textContent;
    const advancedCopy = advancedSettingCopy[locale] || advancedSettingCopy.en;
    if (advancedSettings.vad_runtime === 'mlx-audio' && !quietHint.includes(advancedCopy.mlxQuietHint)) errors.push('wrong MLX quiet speech explanation');
    const originalAdvancedValues = structuredClone(advancedSettings.settings);
    advancedSettings.settings.diarization.boundary_tail_seconds = 7;
    chunk.value = '31';
    settingsModal.querySelector('[data-reset-advanced-settings]').click();
    if (chunk.value !== String(advancedSettings.defaults.audio.chunk_seconds) || advancedSettings.settings.diarization.boundary_tail_seconds !== 7) errors.push('reset overwrites hidden advanced settings');
    if (!advancedForm.querySelector('[data-save-state="dirty"]')) errors.push('reset shows unsaved defaults as saved');
    advancedSettings.settings = originalAdvancedValues;
    renderModal('advanced-settings');
    const savedAdvancedForm=settingsModal.querySelector('.advanced-settings-form');
    savedAdvancedForm.requestSubmit();
    const saveDeadline=Date.now()+5000;
    while(savedAdvancedForm.querySelector('[type="submit"]').disabled && Date.now()<saveDeadline)
      await new Promise(resolve=>setTimeout(resolve,25));
    if(activeModal!=='advanced-settings' || settingsModal.hidden || !savedAdvancedForm.isConnected || !savedAdvancedForm.querySelector('[data-save-state="saved"]')) errors.push('advanced save left page or missing saved state');
    const section = settingsModal.querySelector('details.advanced-settings-section');
    const summary = section.querySelector('summary');
    summary.click();
    await new Promise(resolve => setTimeout(resolve, 280));
    if (!section.open || section.querySelector('.advanced-fields').getBoundingClientRect().height < 60) errors.push('advanced expansion');
    if (![...section.querySelectorAll('label small')].every(hint => hint.textContent.length > 10)) errors.push('advanced explanations');
    if (!getComputedStyle(section, '::details-content').transitionProperty.includes('block-size')) errors.push('advanced transition');
    summary.click();
    await new Promise(resolve => setTimeout(resolve, 280));
    if (section.open || section.getBoundingClientRect().height > summary.getBoundingClientRect().height + 3) errors.push('advanced collapse');
    await openModal('speaker-profiles');
    const createSpeaker = settingsModal.querySelector('.speaker-create');
    const createButton = createSpeaker.querySelector('summary');
    const rect = createButton.getBoundingClientRect(), iconRect = createButton.querySelector('svg').getBoundingClientRect();
    if (rect.width < 28 || rect.height < 28 || iconRect.width < 13.9 || Math.abs(iconRect.width-iconRect.height)>1 || iconRect.left<rect.left || iconRect.right>rect.right || Math.abs((iconRect.top+iconRect.bottom-rect.top-rect.bottom)/2)>1) errors.push('speaker create control is clipped or inaccessible');
    if (!createButton.getAttribute('aria-label') || !createButton.title || !createButton.textContent.trim()) errors.push('speaker create label');
    createButton.click();
    if (!createSpeaker.open || !createSpeaker.querySelector('form').checkVisibility()) errors.push('speaker create cannot expand');
    createButton.click();
    if (createSpeaker.open) errors.push('speaker create cannot collapse');
    const previousTab = modelLibraryTab;
    for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
      applyLanguage(code);
      await openModal('storage');
      const descriptions = [...settingsModal.querySelectorAll('.storage-list .preferences-danger-row .preference-copy p')].map(e => e.textContent);
      if(descriptions.length!==2)errors.push(code+': storage descriptions missing');
      for (const [index, key] of ['删除此设备上的会议录音、转写文本与笔记。', '清空已下载的模型文件。'].entries()) {
        if (descriptions[index] !== t(key) || (code !== 'zh' && descriptions[index] === key)) errors.push(code + ': untranslated storage description');
      }
      for (const button of settingsModal.querySelectorAll('.settings-navigation button')) {
        if (button.scrollWidth > button.clientWidth + 1) errors.push(code + ': settings navigation overflow');
      }
      await openModal('models');
      for (const tab of ['installed', 'available']) {
        modelLibraryTab = tab; renderModelLibrary();
        const toolbar = settingsModal.querySelector('.model-library-toolbar');
        if (parseFloat(getComputedStyle(toolbar).borderBottomWidth)) errors.push('model toolbar divider');
        for (const row of settingsModal.querySelectorAll('.preferences-model-row')) {
          const intro = row.querySelector('details.model-intro');
          const description = intro?.querySelector('.model-library-description');
          if (intro) {
            const wasOpen = intro.open;
            intro.open = false;
            intro.querySelector('summary').click();
            if (!intro.open || !description?.textContent.trim() || !description.checkVisibility() || description.scrollWidth > description.clientWidth + 1) errors.push(code + ': model introduction inaccessible');
            intro.open = wasOpen;
          }
          const bounds = row.getBoundingClientRect();
          const actions = row.querySelector('.preferences-model-actions').getBoundingClientRect();
          for (const button of row.querySelectorAll('button')) {
            const target = button.getBoundingClientRect();
            if (!button.getAttribute('aria-label') || !button.title || target.width < 28 || target.height < 28 || target.right > bounds.right + 1) errors.push(code + ': model action inaccessible');
          }
          for (const rating of row.querySelectorAll('.model-library-rating')) {
            const rect = rating.getBoundingClientRect();
            const scale = rating.querySelector('.rating-scale').getBoundingClientRect();
            if (rect.left < bounds.left || rect.right > actions.left + 1 || scale.width < 12 || scale.width > rect.width + 1) errors.push(code + ': model rating clipped');
          }
        }
      }
    }
    modelLibraryTab = previousTab;
    await openModal('summary-model');
    const aiTabs=settingsModal.querySelector('.preferences-tabs'),tabBounds=aiTabs.getBoundingClientRect();
    const aiTabButtons=[...aiTabs.querySelectorAll('[data-ai-settings-tab]')];
    if(aiTabButtons.length!==2 || aiTabButtons.filter(button=>button.getAttribute('aria-selected')==='true').length!==1 || aiTabs.querySelector('[aria-selected="true"]')?.dataset.aiSettingsTab!=='summary-model')errors.push('AI tabs selected state');
    let previousRight=tabBounds.left;
    for(const button of aiTabButtons){
      const bounds=button.getBoundingClientRect(),label=t(button.dataset.aiSettingsTab==='summary-model'?'会议纪要':'AI 笔记');
      if(button.textContent.trim()!==label || bounds.height<28 || bounds.left<previousRight-1 || bounds.right>tabBounds.right+1 || bounds.top<tabBounds.top-1 || bounds.bottom>tabBounds.bottom+1 || button.scrollWidth>button.clientWidth+1)errors.push('AI tabs clipped or untranslated');
      previousRight=bounds.right;
    }
    await openModal('device-connection');
    closeModal(); await new Promise(resolve => setTimeout(resolve, 250));
    await showView('home');
    openConfirmation(t('删除'), 'layout regression', () => {});
    if (settingsModal.querySelector('[data-mobile-install-toggle]')) errors.push('installation button in confirmation');
    closeModal(); await new Promise(resolve => setTimeout(resolve, 250));
    applyLanguage(previousLocale); applyTheme(previousTheme);
    return errors;
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(compactSettings.result?.value) && !compactSettings.result.value.length,
    `默认窗口设置布局回归：${JSON.stringify(compactSettings)}`,
  );
  const summaryToolbarErrors = [];
  for (const width of [920, 1079, 1800]) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 675,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 20, y: 100 });
    const result = await client.send('Runtime.evaluate', {
      expression: `(async()=>{
        const errors=[],previousLocale=locale,previousTheme=theme;
        closeModal();await new Promise(r=>setTimeout(r,250));
        const initialized=await window.brevia.initialize();
        const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
        applyBackendDetail(meeting);uiData.detail.refinedMode='timestamps';renderMeetingDetail();await showView('detail');openReviewDocument('transcript');
        document.querySelector('#detail-view').getAnimations().forEach(animation=>animation.finish());
        const participants=Array.from({length:50},(_,i)=>({id:'participant-'+i,name:i===0?'Alexandria Constantinopoulos '.repeat(3):'Participant <'+i+'> 名称'}));
        for(const code of ['zh','en','es','ja','ko','fr','de','ru'])for(const appearance of ['light','dark']){
          applyLanguage(code);applyTheme(appearance);
          currentMeetingDetail={...meeting,speakers:participants};uiData.detail.refinedMode='timestamps';renderMeetingDetail();
          await new Promise(r=>setTimeout(r,180));
          document.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).forEach(animation=>animation.finish());
          const row=finalTranscript.querySelector('.segment'),speaker=row.querySelector('.segment-speaker'),copy=row.querySelector('.segment-copy');
          const before=copy.getBoundingClientRect(),label=speaker.getBoundingClientRect();
          row.querySelector('[data-segment-tool="speaker"]').focus({preventScroll:true});await new Promise(r=>setTimeout(r,120));
          const bar=row.querySelector('.segment-tools');
          // 120ms 恰好落在过渡边界；结束有限动效后再检查终态，避免帧调度造成偶发误报。
          bar.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).forEach(animation=>animation.finish());
          await new Promise(requestAnimationFrame);
          const barRect=bar.getBoundingClientRect(),rowRect=row.getBoundingClientRect(),after=copy.getBoundingClientRect();
          if(Math.abs(label.left-before.left)>1||Math.abs(after.top-before.top)>1||Math.abs(after.left-before.left)>1)errors.push(code+': toolbar moved speaker or text');
          if(getComputedStyle(bar).opacity!=='1'||barRect.right>rowRect.right+1||barRect.left<rowRect.left-1||barRect.bottom>after.top+1)errors.push(code+': toolbar clips or covers subtitle '+JSON.stringify({appearance,connected:row.isConnected,focused:document.activeElement?.outerHTML,hasFocus:document.hasFocus(),opacity:getComputedStyle(bar).opacity,bar:barRect,row:rowRect,copy:after}));
          if(bar.querySelectorAll('button').length!==7||[...bar.querySelectorAll('button')].some(b=>!b.getAttribute('aria-label')||b.textContent.trim()))errors.push(code+': missing accessible actions');
          const preview=[...document.querySelectorAll('.summary-participant-preview-person > span:not(.speaker-avatar)')];
          if(preview.length!==3||preview.some(name=>!name.textContent.trim()||!name.getBoundingClientRect().width))errors.push(code+': initial participant names hidden');
          const section=document.querySelector('.summary-participants'),toggle=section.querySelector('[data-summary-participants-toggle]'),body=document.querySelector('.summary-body');
          const bodyTop=body.getBoundingClientRect().top;
          if(section.getBoundingClientRect().height>60||toggle.scrollWidth>toggle.clientWidth+1)errors.push(code+': participants header expanded or clipped');
          toggle.focus({preventScroll:true});toggle.click();
          const popover=section.querySelector('[popover]'),rect=popover.getBoundingClientRect(),list=popover.querySelector('.summary-participant-list');
          if(!popover.matches(':popover-open')||Math.abs(body.getBoundingClientRect().top-bodyTop)>1)errors.push(code+': roster moves summary');
          if(rect.left<0||rect.right>innerWidth+1||rect.bottom>innerHeight+1||popover.scrollWidth>popover.clientWidth+1||list.scrollHeight<=list.clientHeight)errors.push(code+': roster overflow or missing internal scroll');
          const search=popover.querySelector('input');search.value='Alexandria';search.dispatchEvent(new Event('input',{bubbles:true}));
          if([...list.children].filter(row=>!row.hidden).length!==1||list.textContent.indexOf('Participant <1>')<0)errors.push(code+': roster search or escaped names');
          search.value='__absent__';search.dispatchEvent(new Event('input',{bubbles:true}));
          if(popover.querySelector('[data-participant-empty]').hidden)errors.push(code+': roster missing empty state');
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          if(popover.matches(':popover-open')||document.activeElement!==toggle)errors.push(code+': roster Escape or focus return');
        }
        applyBackendDetail(meeting);uiData.detail.refinedMode='timestamps';renderMeetingDetail();applyLanguage(previousLocale);applyTheme(previousTheme);
        return errors;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (!Array.isArray(result.result?.value) || result.result.value.length)
      summaryToolbarErrors.push({ width, result });
  }
  await client.send('Emulation.clearDeviceMetricsOverride');
  check(
    !summaryToolbarErrors.length,
    '字幕悬浮条与参会者折叠八语种/窄窗口：' + JSON.stringify(summaryToolbarErrors),
  );
  const directSubtitleActions = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[],initialized=await window.brevia.initialize();
      const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id}),segment=meeting.segments[0];
      const profilesBefore=await window.brevia.speakerProfile.list();
      applyBackendDetail(meeting);uiData.detail.refinedMode='timestamps';renderMeetingDetail();await showView('detail');openReviewDocument('transcript');
      const source=finalTranscript.querySelector('.segment'),time=playerAudio.currentTime;
      const pending=openSegmentSpeakerPicker(meeting.id,segment.id,source.querySelector('[data-segment-tool="speaker"]'));
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pending;
      if(segmentSpeakerPicker.matches(':popover-open'))errors.push('cancelled speaker request reopened picker');
      const pendingRoster=openSegmentSpeakerPicker(meeting.id,segment.id,source.querySelector('[data-segment-tool="speaker"]'));
      document.querySelector('[data-summary-participants-toggle]').click();await pendingRoster;
      if(segmentSpeakerPicker.matches(':popover-open')||!document.querySelector('.summary-participants-popover:popover-open'))errors.push('late speaker request replaced roster');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      source.querySelector('[data-segment-tool="speaker"]').click();
      for(let i=0;i<80&&!segmentSpeakerPicker.matches(':popover-open');i++)await new Promise(r=>setTimeout(r,25));
      if(!segmentSpeakerPicker.matches(':popover-open'))return ['speaker picker did not open'];
      if(playerAudio.currentTime!==time||!source.classList.contains('has-segment-menu'))errors.push('speaker action seeks or loses toolbar');
      const input=segmentSpeakerPicker.querySelector('input'),form=segmentSpeakerPicker.querySelector('form');
      input.value='Speaker 1';form.requestSubmit();
      if(!input.validity.customError||segmentSpeakerDraft.saving)errors.push('placeholder accepted as real person');
      input.value='Interface test';input.dispatchEvent(new Event('input',{bubbles:true}));
      segmentSpeakerDraft.segmentId='missing-test-segment';form.requestSubmit();
      for(let i=0;i<80&&segmentSpeakerDraft.saving;i++)await new Promise(r=>setTimeout(r,25));
      if(segmentSpeakerPicker.querySelector('[role=alert]').hidden||input.value!=='Interface test'||input.disabled)errors.push('failed assignment loses draft');
      segmentSpeakerDraft.segmentId=segment.id;
      const choice=[...segmentSpeakerPicker.querySelectorAll('[data-segment-speaker-choice]')].find(b=>b.dataset.segmentSpeakerChoice!==segment.speaker_name);
      if(!choice)return ['missing participant choice'];
      const assigned=choice.dataset.segmentSpeakerChoice;choice.hidden=false;choice.click();
      for(let i=0;i<80&&segmentSpeakerPicker.matches(':popover-open');i++)await new Promise(r=>setTimeout(r,25));
      const saved=await window.brevia.meeting.get({meeting_id:meeting.id});
      if(saved.segments.find(s=>s.id===segment.id).speaker_name!==assigned)errors.push('speaker choice not saved');
      if(saved.segments.some(s=>s.id!==segment.id&&s.speaker_name!==meeting.segments.find(original=>original.id===s.id).speaker_name))errors.push('assignment changed another segment');
      if(JSON.stringify(await window.brevia.speakerProfile.list())!==JSON.stringify(profilesBefore))errors.push('assignment unexpectedly enrolled voiceprint');
      const restored=await window.brevia.segment.speaker({meeting_id:meeting.id,segment_id:segment.id,name:segment.speaker_name});
      applyBackendDetail(restored);detailActiveTab='transcript';uiData.detail.refinedMode='timestamps';renderMeetingDetail();
      const notesBefore=uiData.detail.notes;
      finalTranscript.querySelector('[data-segment-tool="note"]').click();
      if(!detailNotesEditor?.getMarkdown().includes(segment.text))errors.push('direct note action missing subtitle');
      uiData.detail.notes=notesBefore;uiData.detail.notesEditing=false;uiData.detail.notesSaveState='saved';detailActiveTab='transcript';renderMeetingDetail();
      finalTranscript.querySelector('[data-segment-tool="profile"]').click();
      for(let i=0;i<80&&segmentProfilePanel.hidden;i++)await new Promise(r=>setTimeout(r,25));
      if(segmentProfilePanel.hidden||segmentProfileDraft?.segmentId!==segment.id)errors.push('direct voiceprint action not connected');
      closeSegmentProfilePanel(true);closeMeetingPopovers();await showView('home');return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(directSubtitleActions.result?.value) &&
      !directSubtitleActions.result.value.length,
    '字幕直接操作：' + JSON.stringify(directSubtitleActions),
  );

  // 使用隔离数据目录里的真实会议与保存接口，捕获三张纠错状态；不启动麦克风采集。
  const correctionEvaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const captureCorrection = async (name) => {
    if (!process.env.BREVIA_CORRECTION_CAPTURE_DIR) return;
    await correctionEvaluate(
      `(async()=>{const deadline=Date.now()+10000;while(document.querySelector('#startup-splash')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));if(document.querySelector('#startup-splash'))throw Error('startup splash has not exited');await document.fonts.ready;document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).forEach(a=>a.finish());await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
    );
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const output = path.resolve(process.env.BREVIA_CORRECTION_CAPTURE_DIR);
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  // 全新数据目录的示例走实际会议入口，引用随应用提供，不依赖下载或推理。
  await correctionEvaluate(`(async()=>{
    closeModal();applyLanguage('zh');applyTheme('light');
    const { meetings } = await window.brevia.initialize();
    const sample = meetings.find(item => item.example_locale === 'zh');
    if (!sample) throw Error('first-run example missing');
    await showView('home');
    currentMeetingDetail = null;
    const row = document.querySelector('[data-open-recent="'+sample.id+'"]');
    if (!row?.checkVisibility()) throw Error('first-run example missing from library');
    row.click();
    for(let i=0;i<80 && (currentMeetingDetail?.id!==sample.id || activeView!=='detail');i++) await new Promise(r=>setTimeout(r,25));
    if (detailActiveTab !== 'summary') throw Error('example did not open its prepared review');
    if(pageTransition) await pageTransition;
    const mediaDeadline = Date.now()+6000;
    while(!playerAudio.getAttribute('src') || playerAudio.readyState<1){
      if(Date.now()>mediaDeadline) throw Error('example WAV metadata did not load');
      await new Promise(r=>setTimeout(r,25));
    }
    const branches = [...document.querySelectorAll('brevia-cause-tree .evidence-claim')];
    if (branches.length !== 2 || !branches[0].checkVisibility()) throw Error('first-run tree missing');
    branches[0].querySelector('summary').click();
    if (!branches[0].querySelector('blockquote').textContent.includes('开发团队周四可以交付测试版本')) throw Error('first-run source mismatch');
    const playback = branches[0].querySelector('[data-play-evidence]');
    const wasMuted = playerAudio.muted;
    playerAudio.muted = true;
    const playing = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('example WAV did not play: '+JSON.stringify({ready:playerAudio.readyState,network:playerAudio.networkState,error:playerAudio.error?.message,paused:playerAudio.paused}))), 4000);
      playerAudio.addEventListener('playing', () => {clearTimeout(timer);resolve()}, {once:true});
    });
    playback.click();
    await playing;
    if (Math.abs(playerAudio.currentTime - 5.016) > .2) throw Error('example quote did not seek to its audio');
    playerAudio.pause();
    playerAudio.muted = wasMuted;
  })()`);
  if (process.env.BREVIA_CORRECTION_CAPTURE_DIR)
    await correctionEvaluate(`(async()=>{
      for(let i=0;i<50 && document.querySelector('#toast.visible');i++) await new Promise(r=>setTimeout(r,100));
    })()`);
  await captureCorrection('first-run-example-tree');
  await correctionEvaluate(`(async()=>{
    closeModal();applyLanguage('zh');applyTheme('light');
    const initialized=await window.brevia.initialize();
    const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
    window.correctionTestBackup={meeting,segments:(meeting.current_segments||meeting.segments).slice(0,3)};
    const samples=['我们先确认北威亚的上线范围。','北威亚的会议纪要功能需要优先验收。','请大家周五前完成北威亚的内部验收。'];
    const updated=await window.brevia.segment.saveText({meeting_id:meeting.id,segments:window.correctionTestBackup.segments.map((segment,i)=>({segment_id:segment.id,text:samples[i]}))});
    adoptMobileMeeting(updated);await showView('live');
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    await openLiveCorrection(document.querySelector('#transcript-scroll .segment'));
    if(document.activeElement===correctionDraft.field)throw Error('pointer opened live editor with focus');
    closeLiveCorrection();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
    await openLiveCorrection(document.querySelector('#transcript-scroll .segment'));
    if(document.activeElement!==correctionDraft.field)throw Error('keyboard did not enter live editor');
    closeLiveCorrection();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    await openLiveCorrection(document.querySelector('#transcript-scroll .segment'));
    const field=correctionDraft.field;if(document.activeElement===field)throw Error('live editor autofocus');field.focus();field.value+=' 修改';field.dispatchEvent(new Event('input',{bubbles:true}));
    if(document.querySelectorAll('#transcript-scroll textarea').length!==1||!document.querySelector('#end-meeting').checkVisibility())throw Error('live inline editor or recording control missing');
    const before=field.selectionStart;applyCorrectionMeeting(updated);
    if(document.activeElement!==field||field.value.indexOf('修改')<0||field.selectionStart!==before)throw Error('refresh lost draft or focus');field.blur();
  })()`);
  await captureCorrection('01-live-edit');
  await correctionEvaluate(`(async()=>{
    document.querySelector('[data-live-correction-cancel]').click();
    await openCorrection('北威亚');
    if(correctionPanel.contains(document.activeElement))throw Error('replacement panel autofocus');const replacement=correctionPanel.querySelector('[data-correction-replacement]');replacement.value='Brevia';replacement.dispatchEvent(new Event('input',{bubbles:true}));
    if(correctionPanelState.matches.length!==3||correctionPanel.querySelector('[data-correction-future]').checked)throw Error('wrong preview count or future default');
    const highlights=CSS.highlights.get('correction-search');if(highlights?.size!==3||[...highlights].some(range=>range.toString()!=='北威亚'))throw Error('original transcript matches are not highlighted');
    if(correctionPanel.textContent.includes('精确匹配'))throw Error('redundant helper remains');
    const checkbox=correctionPanel.querySelector('[data-correction-match]');checkbox.checked=false;checkbox.dispatchEvent(new Event('input',{bubbles:true}));
    if(!correctionPanel.querySelector('[data-submit-correction]').textContent.includes('2'))throw Error('selection count did not update');
    correctionPanel.querySelector('[data-correction-select-all]').click();
    const remember=correctionPanel.querySelector('[data-term-remember]');
    if(!remember||remember.checked)throw Error('new terms must be opt-in');
    remember.click();
    if(!correctionPanel.querySelector('.term-options').checkVisibility()||correctionPanel.querySelector('[data-term-post]').checked||correctionPanel.querySelector('[data-term-hotword]').checked)throw Error('separate vocabulary permissions missing');

    const panel=correctionPanel.getBoundingClientRect(),controls=document.querySelector('.live-control-bar').getBoundingClientRect();
    if(panel.bottom>controls.top+1||panel.right>innerWidth+1||panel.left<0)throw Error('replacement panel overlaps recording controls');
  })()`);
  await captureCorrection('02-live-replace');
  await correctionEvaluate(`(async()=>{
    await submitCorrection();
    if(!correctionPanel.hidden)throw Error('replace did not save');
    const meeting=await window.brevia.meeting.get({meeting_id:correctionTestBackup.meeting.id});
    if(!meeting.correction.undo_count||meeting.segments.filter(s=>s.text.includes('Brevia')).length<3)throw Error('replacement did not persist');
    const vocabulary=await window.brevia.workspace.terms({workspace_id:meeting.workspace_id||''});
    if(!vocabulary.some(t=>t.wrong==='北威亚'&&t.correct==='Brevia'&&!t.post_replace&&!t.hotword))throw Error('search alias was not remembered independently');

    meetingActive=false;breviaClient.state.meeting=null;miniMeeting.hidden=true;clearInterval(timer);
    applyBackendDetail(meeting);uiData.detail.refinedMode='timestamps';renderMeetingDetail();await showView('detail');openReviewDocument('transcript');
    if(!document.querySelector('[data-correction-undo]')||document.querySelector('[data-segment-text]'))throw Error('saved view must have undo and plain text');
  })()`);
  await captureCorrection('03-detail-saved');
  const correctionChecks = await correctionEvaluate(`(async()=>{
    const errors=[];
    await submitCorrection('undo');
    let meeting=await window.brevia.meeting.get({meeting_id:correctionTestBackup.meeting.id});
    if(meeting.correction.undo_count||!meeting.segments.some(s=>s.text.includes('北威亚')))errors.push('undo did not restore preview source');
    await openCorrection('北威亚');
    const replacement=correctionPanel.querySelector('[data-correction-replacement]');replacement.value='Brevia';replacement.dispatchEvent(new Event('input',{bubbles:true}));
    const segment=correctionPanelState.matches[0].segment;
    await window.brevia.segment.saveText({meeting_id:meeting.id,segments:[{segment_id:segment.id,text:segment.text+' 后改'}]});
    await submitCorrection();
    if(correctionPanel.hidden||!correctionPanel.querySelector('.correction-error').textContent.includes('更新预览')||replacement.value!=='Brevia')errors.push('conflicting replace lost input '+JSON.stringify({hidden:correctionPanel.hidden,error:correctionPanel.querySelector('.correction-error')?.textContent,value:replacement.value,saving:correctionPanelState?.saving,busy:correctionSaving,disabled:correctionPanel.querySelector('[data-submit-correction]')?.disabled}));
    closeCorrectionPanel();
    meeting=await window.brevia.segment.saveText({meeting_id:meeting.id,segments:correctionTestBackup.segments.map(s=>({segment_id:s.id,text:s.text}))});
    applyCorrectionMeeting(meeting);
    await showView('home');return errors;
  })()`);
  check(
    !correctionChecks.length,
    '实时编辑、替换预览、事务保存、撤销与冲突保护：' + JSON.stringify(correctionChecks),
  );

  await correctionEvaluate(`(async()=>{
    const id=currentMeetingDetail.id;
    await window.brevia.meeting.update({meeting_id:id,updates:{notes:'# 本周决定\\n\\n北威亚上线，**北威亚**验收。\\n\\n- [ ] 保留格式'}});
    await window.brevia.summary.save({meeting_id:id,markdown:'## 会议纪要\\n\\n北威亚上线，北威亚验收。'});
    applyBackendDetail(await window.brevia.meeting.get({meeting_id:id}));await showView('detail');
    window.documentCorrectionSources={notes:currentMeetingDetail.notes,summary:currentMeetingDetail.summary.data.markdown};
  })()`);
  for (const scope of ['notes', 'summary']) {
    await correctionEvaluate(`(async()=>{
      const scope=${JSON.stringify(scope)};
      detailActiveTab=scope;renderMeetingDetail();
      const button=document.querySelector('.detail-content-actions [data-open-correction="'+scope+'"]');
      if(!button?.checkVisibility())throw Error(scope+' find/replace entry missing');
      button.click();for(let i=0;i<100&&correctionPanel.hidden;i++)await new Promise(r=>setTimeout(r,10));
      if(correctionPanelState?.scope!==scope||correctionPanel.contains(document.activeElement))throw Error(scope+' wrong scope or autofocus');
      const query=correctionPanel.querySelector('[data-correction-find]');query.value='北威亚';query.dispatchEvent(new Event('input',{bubbles:true}));
      const field=correctionPanel.querySelector('[data-correction-replacement]');field.value='Brevia';field.dispatchEvent(new Event('input',{bubbles:true}));
      if(CSS.highlights.get('correction-search')?.size!==2||correctionPanelState.matches.length!==2)throw Error(scope+' original highlight missing');
      if(correctionPanel.querySelector('[data-correction-future]'))throw Error(scope+' has transcript rule');
      const box=correctionPanel.querySelector('[data-correction-match]');box.checked=false;box.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await captureCorrection('04-' + scope + '-replace');
    await correctionEvaluate(`(async()=>{
      const scope=${JSON.stringify(scope)},id=currentMeetingDetail.id;
      await submitCorrection();if(!correctionPanel.hidden||CSS.highlights.has('correction-search'))throw Error(scope+' save/cleanup failed');
      let meeting=await window.brevia.meeting.get({meeting_id:id});
      const source=documentCorrectionSources[scope],saved=scope==='notes'?meeting.notes:meeting.summary.data.markdown;
      const second=source.indexOf('北威亚',source.indexOf('北威亚')+3);
      if(saved!==source.slice(0,second)+'Brevia'+source.slice(second+3))throw Error(scope+' selection or Markdown formatting changed');
      const undo=document.querySelector('[data-correction-undo="'+scope+'"]');if(!undo?.checkVisibility())throw Error(scope+' undo missing');
      await submitCorrection('undo',undefined,scope);meeting=await window.brevia.meeting.get({meeting_id:id});
      if((scope==='notes'?meeting.notes:meeting.summary.data.markdown)!==source)throw Error(scope+' undo failed');
      await openCorrection('北威亚',false,scope);applyTheme('dark');
      if(CSS.highlights.get('correction-search')?.size!==2)throw Error(scope+' dark highlight lost');
    })()`);
    await captureCorrection('05-' + scope + '-dark');
    await correctionEvaluate(`closeCorrectionPanel();applyTheme('light');`);
  }
  await correctionEvaluate(`(async()=>{
    const meeting=await window.brevia.meeting.get({meeting_id:currentMeetingDetail.id});
    adoptMobileMeeting(meeting);await showView('live');
    const segment=meeting.segments.at(-1);
    const citation={segment_id:segment.id,text:segment.text,start_ms:segment.start_ms,end_ms:segment.end_ms,track:segment.track,speaker:segment.speaker_name};
    const claim={id:'live-citation',type:'decision',text:'核对生成时的决定',sources:[citation]};
    latestAiSuggestion=claim;renderAiSuggestion();
    document.querySelector('[data-live-suggestion-sources]').click();
    let evidence=document.querySelector('[data-live-note-dialog][open]');
    if(evidence.querySelector('blockquote p').textContent!==citation.text)throw Error('live suggestion source snapshot missing');
    evidence.querySelector('[data-live-locate]').click();
    if(document.activeElement!==liveSegments.get(segment.id))throw Error('live source does not focus the matching transcript');
    setLiveAcceptedClaims([{...claim,sources:[{...citation,text:'生成时的原话快照'}]}]);
    document.querySelector('[data-live-accepted]').click();
    evidence=document.querySelector('[data-live-note-dialog][open]');
    if(evidence.querySelector('[data-live-locate]')||!evidence.textContent.includes('生成时的原话快照'))throw Error('stale source linked to a changed live segment');
    resetAiNoteSuggestions();
    if(!document.querySelector('[data-live-accepted]').hidden||document.querySelector('[data-live-note-dialog][open]'))throw Error('stale meeting citation survived reset');
    liveNotesEditor.setMarkdown('北威亚上线，北威亚验收。');
    await openCorrection('北威亚',false,'notes');
    if(CSS.highlights.get('correction-search')?.size!==2)throw Error('live notes original highlight missing');
    const field=correctionPanel.querySelector('[data-correction-replacement]');field.value='Brevia';field.dispatchEvent(new Event('input',{bubbles:true}));
    await submitCorrection();if(!currentNotesMarkdown().includes('Brevia'))throw Error('live notes replacement failed');
    await submitCorrection('undo',undefined,'notes');if(currentNotesMarkdown().includes('Brevia'))throw Error('live notes undo failed');
    liveNotesEditor.setMode('markdown');await openCorrection('北威亚',false,'notes');
    if(CSS.highlights.get('correction-search')?.size!==2||!document.querySelector('.correction-markdown-source')?.checkVisibility())throw Error('Markdown source highlight missing');
    closeCorrectionPanel();if(!liveNotesRoot.querySelector('.notes-input').checkVisibility())throw Error('Markdown source mode was not restored');liveNotesEditor.setMode('rich');
    meetingActive=false;breviaClient.state.meeting=null;miniMeeting.hidden=true;clearInterval(timer);
    const original=correctionTestBackup.meeting;
    await window.brevia.meeting.update({meeting_id:original.id,updates:{notes:original.notes||''}});
    if(original.summary?.data?.markdown)await window.brevia.summary.save({meeting_id:original.id,markdown:original.summary.data.markdown});
    delete window.correctionTestBackup;delete window.documentCorrectionSources;await showView('home');
  })()`);

  // 键盘焦点与鼠标打开分别验证；原生对话框保留安全默认动作。
  await correctionEvaluate(`(async()=>{
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    openConfirmation('test','',()=>{});
    if(settingsModal.contains(document.activeElement))throw Error('pointer modal moved focus');
    closeModal();await new Promise(r=>setTimeout(r,250));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
    openConfirmation('test','',()=>{});
    if(!document.activeElement.matches('[data-cancel-confirmation]'))throw Error('keyboard modal did not focus safe action');
    closeModal();await new Promise(r=>setTimeout(r,250));
    const pending=chooseCorrectionDraft(),dialog=document.querySelector('.correction-draft-dialog');
    if(!dialog.contains(document.activeElement))throw Error('native draft dialog lost initial focus');
    dialog.querySelector('[data-choice=cancel]').click();if(await pending!=='cancel')throw Error('draft dialog outcome');
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const segment={id:'limit',text:'a'.repeat(4000),version:'live',revision:0};
    const meeting={segments:[segment]};
    correctionPanelState={meetingId:'limit',scope:'transcript',query:'a',replacement:'bb',meeting,latest:meeting,matches:correctionMatches([segment],'a')};
    correctionPanel.hidden=false;renderCorrectionPanel();
    if(correctionPanelState.matches.length!==200||!correctionPanelState.matches.limited||!correctionPanel.querySelector('[data-submit-correction]').disabled)throw Error('preview or segment capacity limit');
    correctionPanelState.replacement='b';renderCorrectionResults();
    if(correctionPanel.querySelector('[data-submit-correction]').disabled)throw Error('valid partial batch blocked');
    closeCorrectionPanel();
  })()`);

  // 使用当前会议的真实段落和播放器，测试引用、反向链接和精修后失配的分支。
  await correctionEvaluate(`(async () => {
    const data = await window.brevia.initialize();
    const meeting = await window.brevia.meeting.get({meeting_id:data.meetings[0].id});
    const rows = meeting.current_segments || meeting.segments;
    const segment = rows.find(row => row.start_ms > 0) || rows[0];
    const source = {...segment,segment_id:segment.id,current_segment_id:segment.id,seekable:true};
    const claim = {id:'check-claim',kind:'decision',section:'',text:'开发团队周四交付测试版本',original_text:'周四可以交付测试版本',edited:true,sources:[source],source_chars:source.text.length,status:'supported'};
    const cause = {...claim,id:'check-cause',kind:'cause',section:'测试版交付条件',text:'设计稿已经完成',line:'- 设计稿已经完成',edited:false};
    const orphan = {...cause,id:'check-orphan',text:'旧版验收口径需要复核',status:'changed',sources:[{...source,text:'这版验收先沿用原来的测试范围。',current_segment_id:null}]};
    delete orphan.line;
    const acceptance = {...cause,id:'check-acceptance',section:'内部验收安排',text:'产品与研发共同核对验收范围',line:'- 产品与研发共同核对验收范围'};
    const release = {...cause,id:'check-release',section:'小范围发布的前提',text:'验收通过后开始小范围发布',line:'- 验收通过后开始小范围发布'};
    const newline=String.fromCharCode(10);
    const markdown=['# 试点评审','## 交付准备',cause.line,...Array(6).fill('开发团队确认设计稿已完成，周四交付测试版本。保留会议原话，便于后续核对交付范围与负责人。'),'## 内部验收',acceptance.line,...Array(6).fill('产品和研发共同核对测试范围，记录未解决的问题；在完成内部验收后，确认是否进入下一步发布。'),'## 发布计划',release.line,...Array(6).fill('先进行小范围验证，再根据反馈调整发布安排。每个结论保留来源，原话发生变化时重新核对。')].join(newline+newline);
    applyBackendDetail({...meeting,summary:{data:{markdown,claims:[claim,cause,acceptance,release,orphan]}}});
    uiData.detail.refinedMode='timestamps';renderMeetingDetail();
    await showView('detail');
    openReviewDocument('summary');
    const find = key => document.querySelector('[data-evidence-id="'+key+'"]');
    const quotes = find(claim.id).closest('.evidence-document');
    if (!quotes || quotes.open || !document.querySelector('.evidence-notebook > .summary-document .summary-reading-section')?.checkVisibility()) throw Error('summary text and citations are not independently readable');
    quotes.querySelector('summary').click();
    find(claim.id).querySelector('summary').click();
    if (!find(claim.id).open || !find(claim.id).textContent.includes(claim.original_text) || !find(claim.id).querySelector('blockquote').textContent.includes(source.text)) throw Error('claim lost its original text or quote');
    if (playerAudio.readyState && Math.abs(playerAudio.currentTime-segment.start_ms/1000)>.15) throw Error('claim seek failed');
    find(claim.id).querySelector('[data-locate-evidence]').click();
    const row = [...document.querySelectorAll('.transcript-body [data-segment-id]')].find(el => el.dataset.segmentId === segment.id);
    const back = row?.querySelector('[data-evidence-back="check-claim"]');
    if (detailActiveTab !== 'transcript' || !back?.checkVisibility() || document.activeElement !== back) throw Error('citation does not resolve to its own transcript row');
    back.click();
    if (detailActiveTab !== 'summary' || !find(claim.id).open) throw Error('missing transcript backlink');
    if (transcriptEvidenceLinks([claim],[],[{segmentId:source.segment_id, track:source.track,text:'changed',startSeconds:source.start_ms/1000,endSeconds:source.end_ms/1000}]).size) throw Error('wrong reverse link on historical transcript with same ID');
    if (!find(cause.id).closest('brevia-cause-tree') || find(orphan.id).querySelector('[data-locate-evidence]') || !find(orphan.id).textContent.includes(t('原文已变化'))) throw Error('stale citation or missing causal branch');
    find(claim.id).querySelector('[data-edit-evidence]').click();
    const editor = document.querySelector('.claim-edit-dialog');
    if (!editor?.open || editor.querySelector('textarea').value !== claim.text) throw Error('claim editor failed');
    editor.querySelector('button[type="button"]').click();
  })()`);
  await captureCorrection('evidence-review');
  // 原因图是三个阅读页共用的连续侧栏；章节联动使用真实滚动容器。
  await correctionEvaluate(`(async()=>{
    const settle=async()=>{
      document.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).forEach(animation=>animation.finish());
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    };
    for(const scope of ['notes','transcript','summary']) {
      document.querySelector('[data-detail-tab="'+scope+'"]').click();await settle();
      const reading=document.querySelector('.final-transcript'),rail=reading.querySelector('.detail-cause-rail');
      const panel=reading.querySelector('[data-detail-panel="'+scope+'"]');
      const a=panel.getBoundingClientRect(),b=rail.getBoundingClientRect();
      if(getComputedStyle(reading).display!=='grid'||!rail.checkVisibility()||b.left<a.right-1||Math.abs(a.top-b.top)>1)throw Error(scope+' cause rail not beside document: '+JSON.stringify({panel:a,rail:b}));
      if(rail.querySelectorAll('brevia-cause-tree').length!==1||rail.querySelectorAll('.cause-tree-spine').length!==1)throw Error('disconnected cause trees');
    }
    const body=document.querySelector('.summary-body');
    const chapter=body.querySelector('[data-summary-section="2"]');
    body.scrollTop=chapter.offsetTop;chapter.scrollIntoView({block:'start'});await settle();
    if(!document.querySelector('[data-cause-section="2"].is-reading'))throw Error('summary scrolling does not follow chapter');
    document.querySelector('[data-summary-section-link="1"]').click();await settle();
    if(document.activeElement?.dataset.summarySection!=='1'||!document.querySelector('[data-cause-section="1"].is-reading'))throw Error('cause chapter does not focus summary');
    const find=()=>document.querySelector('[data-evidence-id="check-cause"]');
    find().querySelector('summary').click();await settle();
    find().querySelector('[data-locate-evidence]').click();await settle();
    if(detailActiveTab!=='transcript'||!find().open)throw Error('cause quote lost on transcript navigation');
    const back=document.querySelector('.transcript-body [data-evidence-back="check-cause"]');
    if(!back)throw Error('cause reverse link missing');back.click();await settle();
    if(detailActiveTab!=='transcript'||!find().open)throw Error('cause backlink unnecessarily switches document');
    const rail=document.querySelector('.detail-cause-scroll');rail.scrollTop=30;
    renderMeetingDetail();await settle();
    if(!find().open||Math.abs(document.querySelector('.detail-cause-scroll').scrollTop-30)>1)throw Error('same meeting refresh lost cause state');
    const source=document.querySelector('.transcript-body [data-segment-tool="play"]')?.closest('[data-segment-id]');
    if(!source?.querySelector('[data-segment-tool="play"]')||!source.querySelector('[data-segment-tool="translate"]'))throw Error('single-segment controls missing');
    document.querySelector('[data-detail-tab="summary"]').click();await settle();
    document.querySelector('.detail-cause-scroll').scrollTop=30;renderMeetingDetail();await settle();
    if(Math.abs(document.querySelector('.detail-cause-scroll').scrollTop-30)>1)throw Error('summary refresh reset independent cause scroll');
  })()`);
  await correctionEvaluate(`(async()=>{
    document.querySelector('[data-detail-tab="transcript"]').click();
    const button=document.querySelector('.transcript-body [data-segment-tool="play"]');
    button.scrollIntoView({block:'center'});button.focus();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  })()`);
  await captureCorrection('cause-rail-transcript');
  await correctionEvaluate(
    `document.querySelector('[data-detail-tab="summary"]').click();document.querySelector('.summary-body').scrollTop=0;document.querySelector('.detail-cause-scroll').scrollTop=0;`,
  );
  await captureCorrection('cause-rail-summary');
  await correctionEvaluate(`applyTheme('dark');`);
  await captureCorrection('cause-rail-dark');
  await correctionEvaluate(`applyTheme('light');`);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 880,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await correctionEvaluate(`(async()=>{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    document.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).forEach(animation=>animation.finish());
    const panel=document.querySelector('[data-detail-panel="summary"]').getBoundingClientRect();
    const rail=document.querySelector('.detail-cause-rail').getBoundingClientRect();
    if(rail.top<panel.bottom-1||rail.height<120||panel.height<150||document.body.scrollWidth>innerWidth+1)throw Error('narrow cause rail blocks reading: '+JSON.stringify({panel,rail,width:innerWidth,scrollWidth:document.body.scrollWidth,container:document.querySelector('.detail-layout').getBoundingClientRect(),rows:getComputedStyle(document.querySelector('.has-cause-rail')).gridTemplateRows}));
  })()`);
  await captureCorrection('cause-rail-narrow');
  await client.send('Emulation.clearDeviceMetricsOverride');
  // 使用真实录音验证正文时间戳，并确保列表、表格的依据留在对应内容旁。
  await correctionEvaluate(`(async()=>{
    const initialized=await window.brevia.initialize();
    const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
    const segment=(meeting.current_segments||meeting.segments)[0];
    const source={...segment,segment_id:segment.id,current_segment_id:segment.id,seekable:true};
    const list='- 周四交付测试版本。〔00:02 · 00:03〕';
    const firstRow='| 产品团队 | 核对验收范围 [00:04] |';
    const secondRow='| 研发团队 | 完成测试版本 [00:05] |';
    const claim=(id,line,text)=>({id,kind:'decision',section:'交付安排',line,text,original_text:text,sources:[source],source_chars:source.text.length,status:'supported'});
    const claims=[claim('inline-list',list,'周四交付测试版本。'),claim('inline-table-first',firstRow,'产品团队核对验收范围'),claim('inline-table-second',secondRow,'研发团队完成测试版本')];
    const code=String.fromCharCode(96);
    const markdown=['# 交付安排',list,'| 负责人 | 工作 |','| --- | --- |',firstRow,secondRow,'','[待确认] '+code+'[00:06]'+code+' [00:07](https://example.com/recording)'].join(String.fromCharCode(10));
    applyBackendDetail({...meeting,summary:{data:{markdown,claims}}});
    renderMeetingDetail();await showView('detail');openReviewDocument('summary');
    const notebook=document.querySelector('.summary-body .evidence-notebook');
    if(!notebook||notebook.querySelector('.evidence-document')||notebook.querySelectorAll('.evidence-inline').length!==3)throw Error('已匹配引用仍集中在纪要末尾');
    const item=notebook.querySelector('[data-evidence-id="inline-list"]');
    if(!item.closest('li')?.textContent.includes('周四交付测试版本'))throw Error('列表依据未绑定对应要点');
    for(const [id,owner]of[['inline-table-first','产品团队'],['inline-table-second','研发团队']]){
      const evidence=notebook.querySelector('[data-evidence-id="'+id+'"]');
      const row=evidence?.closest('tr');
      if(!row||row.querySelector('td')?.textContent!==owner||row.querySelectorAll('.evidence-inline').length!==1)throw Error('表格依据串行或移至表格外：'+id);
    }
    const times=[...notebook.querySelectorAll('[data-summary-seek]')];
    if(times.map(button=>Number(button.dataset.summarySeek)).join(',')!=='2,3,4,5')throw Error('正文时间戳格式、普通方括号或代码链接识别错误');
    if(!notebook.textContent.includes('[待确认]')||notebook.querySelector('a [data-summary-seek],code [data-summary-seek]'))throw Error('普通正文或链接被播放按钮破坏');
    item.querySelector('summary').click();
    if(!item.open||!item.querySelector('.evidence-quotes').textContent.includes(source.text))throw Error('行内引用未展开对应原话');
    const deadline=Date.now()+6000;
    while(playerAudio.readyState<1){if(Date.now()>deadline)throw Error('样例录音元数据未加载');await new Promise(r=>setTimeout(r,25));}
    playerAudio.pause();times[0].click();
    while(playerAudio.paused){if(Date.now()>deadline)throw Error('纪要时间戳没有开始播放');await new Promise(r=>setTimeout(r,25));}
    if(playerAudio.currentTime<1.9||playerAudio.currentTime>2.8)throw Error('纪要时间戳跳转位置错误：'+playerAudio.currentTime);
    playerAudio.pause();
  })()`);
  await captureCorrection('summary-inline-citations');
  await correctionEvaluate(`(async()=>{
    const initialized=await window.brevia.initialize();
    const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
    const segment=(meeting.current_segments||meeting.segments)[0];
    const source={...segment,segment_id:segment.id,current_segment_id:segment.id,seekable:true};
    const staleCause={id:'stale-cause',kind:'cause',section:'旧版原因',text:'旧版结论',sources:[source],status:'supported'};
    applyBackendDetail({...meeting,summary:{data:{markdown:'',claims:[staleCause]}}});
    renderMeetingDetail();await showView('detail');
    for(const tab of['summary','notes','transcript']){
      openReviewDocument(tab);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const reading=document.querySelector('.final-transcript'),panel=reading.querySelector('[data-detail-panel="'+tab+'"]');
      if(reading.classList.contains('has-cause-rail')||reading.querySelector('.detail-cause-rail'))throw Error(tab+'：无纪要仍显示旧版原因图');
      if(tab!=='notes'&&panel.getBoundingClientRect().width<reading.clientWidth-4)throw Error(tab+'：无原因图时正文仍预留空栏');
    }
  })()`);
  await captureCorrection('transcript-without-cause-rail');
  // 三个内容页共享导航和操作栏；坐标比较防止入口再次漂移。
  const unifiedGeometry = [];
  await correctionEvaluate(`(async()=>{
    const initialized=await window.brevia.initialize();
    applyBackendDetail(await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id}));
    const d=uiData.detail;d.hasRefined=true;d.refinedMode='timestamps';d.transcriptVersion='refined';d.transcriptEditable=true;d.refineState='idle';
    d.refinedTranscript=d.transcript;
    d.notes='# 产品周会笔记\\n\\n- 确认本周上线范围，优先完成会议记录与术语修正。\\n- 周四交付测试版本，周五完成内部验收。\\n- 保留现有 Markdown 格式、文字高亮与音频定位。\\n\\n## 后续安排\\n\\n整理验证结果，并记录需要继续跟进的问题。';
    d.summary={markdown:'# 产品周会\\n\\n## 会议摘要\\n\\n本次会议确认产品上线范围、会议记录流程与内部验收安排。\\n\\n## 核心结论\\n\\n- 优先完善记录和术语修正。\\n- 笔记、逐字稿、纪要使用统一的操作入口。\\n\\n## 行动事项\\n\\n- [ ] 周四交付测试版本。\\n- [ ] 周五完成内部验收。'};
    await showView('detail');
  })()`);
  for (const scope of ['notes', 'transcript', 'summary']) {
    unifiedGeometry.push(
      await correctionEvaluate(`(async()=>{
      const scope=${JSON.stringify(scope)};
      detailActiveTab=scope;renderMeetingDetail();
      await document.fonts.ready;document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).forEach(a=>a.finish());await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const root=document.querySelector('#detail-view');
      const toolbar=root.querySelector('.detail-content-toolbar');
      const find=toolbar.querySelector('[data-open-correction]');
      const edit=toolbar.querySelector('[data-edit-notes],[data-edit-transcript],[data-open-summary-edit]');
      const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      if(!find?.checkVisibility()||!edit?.checkVisibility()||root.querySelectorAll('.detail-content-header').length!==1)throw Error(scope+' shared header missing');
      if(root.querySelector('.summary-head')||root.querySelector('.detail-transcript-toolbar'))throw Error(scope+' legacy tool row remains');
      if(document.activeElement?.matches('input,textarea,[contenteditable=true]'))throw Error(scope+' automatic focus');
      const tabs=[...root.querySelectorAll('[role=tab]')].map(rect);
      if(tabs.length!==3||tabs.some(tab=>Math.abs(tab.y-tabs[0].y)>1)||tabs.some((tab,index)=>index&&tab.x<tabs[index-1].x+tabs[index-1].width))throw Error(scope+' horizontal tabs missing or overlapping');
      return {scope,find:rect(find),edit:rect(edit),toolbar:rect(toolbar),panel:rect(root.querySelector('[data-detail-panel="'+scope+'"]'))};
    })()`),
    );
    await captureCorrection('unified-' + scope);
    await correctionEvaluate(`(()=>{
      const scope=${JSON.stringify(scope)};
      const edit=document.querySelector('.detail-content-actions [data-edit-notes],.detail-content-actions [data-edit-transcript],.detail-content-actions [data-open-summary-edit]');edit.click();
      const save=document.querySelector('.detail-content-actions [data-notes-save],.detail-content-actions [data-transcript-save],.detail-content-actions [data-save-inline-summary]');
      if(!save?.checkVisibility()||save.textContent.trim()!==t('保存'))throw Error(scope+' shared save action missing');
      if(document.activeElement?.matches('input,textarea,[contenteditable=true]'))throw Error(scope+' editor autofocus');
      const before=scope==='notes'?detailNotesEditor:scope==='summary'?inlineSummaryEditor:document.querySelector('[data-segment-text]');
      openReviewDocument(scope==='notes'?'summary':'notes');openReviewDocument(scope);
      const after=scope==='notes'?detailNotesEditor:scope==='summary'?inlineSummaryEditor:document.querySelector('[data-segment-text]');
      if(before!==after)throw Error(scope+' tab switch rebuilt draft editor');
      document.querySelector('.detail-content-actions [data-notes-cancel],.detail-content-actions [data-transcript-cancel],.detail-content-actions [data-cancel-inline-summary-edit]').click();
    })()`);
  }
  const baseline = unifiedGeometry[0];
  check(
    unifiedGeometry.every(
      (item) =>
        Math.abs(item.toolbar.y - baseline.toolbar.y) < 1 &&
        Math.abs(item.find.x - baseline.find.x) < 1 &&
        Math.abs(item.edit.x - baseline.edit.x) < 1 &&
        ['find', 'edit'].every(
          (key) =>
            item[key].y >= item.toolbar.y &&
            item[key].y + item[key].height <= item.toolbar.y + item.toolbar.height + 1,
        ) &&
        item.panel.y >= item.toolbar.y + item.toolbar.height - 1 &&
        item.panel.width > 0 &&
        item.panel.height > 0,
    ),
    '三个内容页共享水平导航、工具入口且正文不重叠：' + JSON.stringify(unifiedGeometry),
  );
  await correctionEvaluate(`detailActiveTab='summary';renderMeetingDetail();applyTheme('dark');`);
  await captureCorrection('unified-summary-dark');
  await correctionEvaluate(`applyTheme('light');`);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 880,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const scope of ['notes', 'transcript', 'summary']) {
    await correctionEvaluate(`(()=>{
      detailActiveTab=${JSON.stringify(scope)};renderMeetingDetail();
      const root=document.querySelector('#detail-view'),toolbar=root.querySelector('.detail-content-toolbar');
      if(toolbar.scrollWidth>toolbar.clientWidth+1||document.body.scrollWidth>innerWidth+1)throw Error('narrow toolbar overflow: '+detailActiveTab);
      const buttons=[...toolbar.querySelectorAll('.detail-content-actions button')];if(buttons.some(b=>b.getBoundingClientRect().right>innerWidth))throw Error('narrow shared actions clipped');
    })()`);
    if (scope === 'transcript') await captureCorrection('unified-transcript-narrow');
  }
  await correctionEvaluate(`(()=>{
    for(const language of ['zh','en','es','ja','ko','fr','de','ru']) {
      applyLanguage(language);
      for(const scope of ['notes','transcript','summary']) {
        detailActiveTab=scope;renderMeetingDetail();
        const bar=document.querySelector('#detail-view .detail-content-toolbar');
        if(bar.scrollWidth>bar.clientWidth+1||document.body.scrollWidth>innerWidth+1)throw Error(language+' '+scope+' localized toolbar overflow');
      }
    }
    applyLanguage('zh');
  })()`);
  await client.send('Emulation.clearDeviceMetricsOverride');
  await correctionEvaluate(`(async()=>{
    const id=currentMeetingDetail.id;
    currentMeetingDetail.id='00000000-0000-4000-8000-000000000000';
    for(const scope of ['notes','summary']) {
      detailActiveTab=scope;renderMeetingDetail();
      document.querySelector(scope==='notes'?'[data-edit-notes]':'[data-open-summary-edit]').click();
      const editor=scope==='notes'?detailNotesEditor:inlineSummaryEditor;
      editor.setMarkdown('保存失败时保留的草稿');
      if(scope==='notes')updateDetailNotesDraft();
      document.querySelector(scope==='notes'?'[data-notes-save]':'[data-save-inline-summary]').click();
      document.querySelector('[data-detail-tab=transcript]').click();
      for(let i=0;i<200&&uiData.detail[scope+'SaveState']==='saving';i++)await new Promise(r=>setTimeout(r,10));
      if(uiData.detail[scope+'SaveState']!=='failed'||detailActiveTab!=='transcript'||editor.getMarkdown()!=='保存失败时保留的草稿')throw Error(scope+' late failure lost draft or switched tabs');
      openReviewDocument(scope);
      const save=document.querySelector(scope==='notes'?'[data-notes-save]':'[data-save-inline-summary]');
      if(save.disabled||!save.textContent.includes(t('重试')))throw Error(scope+' retry not restored');
      document.querySelector(scope==='notes'?'[data-notes-cancel]':'[data-cancel-inline-summary-edit]').click();
    }
    currentMeetingDetail.id=id;
    detailActiveTab='notes';renderMeetingDetail();
    const tab=document.querySelector('[data-detail-tab=notes]');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    if(detailActiveTab!=='transcript'||document.activeElement?.dataset.detailTab!=='transcript')throw Error('content tab keyboard navigation');
    applyBackendDetail(await window.brevia.meeting.get({meeting_id:currentMeetingDetail.id}));await showView('home');
  })()`);

  const profilePanelChecks = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[],previousLocale=locale,previousProfiles=speakerProfiles,previousTheme=theme;
      closeModal();await new Promise(r=>setTimeout(r,250));
      await showView('home');
      const initialized=await window.brevia.initialize();
      const detail=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
      applyBackendDetail(detail);
      // 示例只有精修稿；用其真实音频与段落验证带时间戳的呈现和菜单入口。
      uiData.detail.refinedMode='timestamps';renderMeetingDetail();await showView('detail');openReviewDocument('transcript');
      const segment=detail.segments.find(s=>s.end_ms>s.start_ms);
      document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const row=[...finalTranscript.querySelectorAll('article[data-segment-id]')].find(e=>e.dataset.segmentId===segment.id);
      if(!row?.querySelector('[data-segment-actions]'))return ['missing subtitle action entry'];
      row.querySelector('[data-segment-actions]').click();
      const menuStyle=()=>{const root=getComputedStyle(segmentContextMenu);return {surface:['borderColor','borderRadius','backgroundColor','boxShadow','padding','minWidth'].map(key=>root[key]),items:[...segmentContextMenu.querySelectorAll('button')].map(button=>{const style=getComputedStyle(button),icon=getComputedStyle(button.querySelector('.interface-icon'));return [...['minHeight','padding','gap','fontSize','lineHeight','color'].map(key=>style[key]),icon.width,icon.height]})};};
      const subtitleStyle=menuStyle();
      segmentContextMenu.classList.replace('segment-context-menu','meeting-menu');
      const meetingMenuStyle=menuStyle();
      segmentContextMenu.classList.replace('meeting-menu','segment-context-menu');
      if(JSON.stringify(subtitleStyle)!==JSON.stringify(meetingMenuStyle))errors.push('subtitle menu differs from shared meeting menu style');
      if(segmentContextMenu.contains(document.activeElement))errors.push('menu moved focus when opened');
      segmentContextMenu.querySelector('button').focus();
      if(segmentContextMenu.querySelector('.segment-context-options'))errors.push('legacy cascading menu remains');
      segmentContextMenu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      if(!document.activeElement.matches('[data-open-segment-profile-menu]'))errors.push('subtitle menu keyboard navigation');
      segmentContextMenu.querySelector('[data-open-segment-profile-menu]').click();
      for(let i=0;i<60&&segmentProfilePanel.hidden;i++)await new Promise(r=>setTimeout(r,50));
      if(segmentProfilePanel.hidden) return ['saved subtitle clip did not open'];
      if(segmentProfileMotion.effect.getKeyframes()[0].transform!=='translateX(100%)'||segmentProfileMotion.effect.getTiming().duration!==240)errors.push('drawer entrance missing');
      await segmentProfileMotion.finished;

      if(finalTranscript.getBoundingClientRect().height < 100 || document.querySelector('.detail-head').getBoundingClientRect().top > 180)errors.push('sample panel hides transcript context');
      if(segmentProfileDraft.segment.id!==segment.id||!segmentProfileAudio.src)errors.push('preview source mismatch');
      const fixtures=[{id:'layout-profile',name:'Alexandria Constantinopoulos',sample_count:9,duration_ms:10000},{id:'full-profile',name:'Full profile',sample_count:50,duration_ms:300000}];
      const savedSettings=(await window.brevia.advancedSettings.get()).settings;
      const customSettings=structuredClone(savedSettings);
      customSettings.voice_profiles={max_samples:100,max_total_seconds:600};
      await window.brevia.advancedSettings.save({settings:customSettings});
      advancedSettings=undefined;
      await openSegmentProfilePanel(detail.id,segment.id);
      speakerProfiles=fixtures;segmentProfileDraft.profileId='full-profile';renderSegmentProfilePanel();
      if(segmentProfilePanel.querySelector('input[value="full-profile"]').disabled||segmentProfilePanel.querySelector('[data-save-segment-profile]').disabled)errors.push('custom voiceprint capacity requires visiting advanced settings');
      closeSegmentProfilePanel(true);speakerProfiles=previousProfiles;
      advancedSettings=undefined;
      await openModal('speaker-profiles');
      speakerProfiles=fixtures;expandedSpeakerProfileId='full-profile';renderSpeakerProfileModal();
      const capacity=settingsModal.querySelector('.speaker-detail-header small').textContent;
      if(!capacity.includes('50/100')||!capacity.includes('10:00'))errors.push('voiceprint manager shows hardcoded capacity: '+capacity);
      closeModal();await new Promise(r=>setTimeout(r,250));
      await window.brevia.advancedSettings.save({settings:savedSettings});
      advancedSettings=undefined;
      await openSegmentProfilePanel(detail.id,segment.id);
      await segmentProfileMotion.finished;
      for(const code of ['zh','en','es','ja','ko','fr','de','ru'])for(const appearance of ['light','dark']){
        applyLanguage(code);applyTheme(appearance);speakerProfiles=fixtures;segmentProfileDraft.name='';segmentProfileDraft.search='';segmentProfileDraft.profileId='layout-profile';renderSegmentProfilePanel();
        const source=[...finalTranscript.querySelectorAll('article[data-segment-id]')].find(e=>e.dataset.segmentId===segment.id);
        const speaker=source.querySelector('.segment-speaker').getBoundingClientRect(),copy=source.querySelector('.segment-copy').getBoundingClientRect(),time=source.querySelector('time').getBoundingClientRect();
        if(Math.abs(speaker.left-copy.left)>1||time.left<speaker.right)errors.push(code+': speaker label moved from text start');
        const footer=segmentProfilePanel.querySelector('footer'),rect=segmentProfilePanel.getBoundingClientRect();
        if(rect.right>innerWidth+1||rect.bottom>innerHeight+1||footer.getBoundingClientRect().bottom>rect.bottom+1)errors.push(code+': panel footer clipped');
        if(segmentProfilePanel.scrollWidth>segmentProfilePanel.clientWidth+1)errors.push(code+': horizontal panel overflow');
        if(!segmentProfilePanel.querySelector('input[value="full-profile"]').disabled)errors.push('full profile selectable');
        const search=segmentProfilePanel.querySelector('[data-segment-profile-search]');search.value='missing';search.dispatchEvent(new Event('input',{bubbles:true}));
        if(segmentProfilePanel.querySelector('[data-segment-profile-empty]').hidden)errors.push('search missing empty state');
        search.value='Alexandria';search.dispatchEvent(new Event('input',{bubbles:true}));
        if(segmentProfilePanel.querySelectorAll('.segment-profile-person:not([hidden])').length!==1)errors.push('profile search disconnected');
        segmentProfilePanel.querySelector('[data-new-segment-profile]').click();
        const input=segmentProfilePanel.querySelector('input[name=name]');
        if(!input||!segmentProfilePanel.querySelector('[data-save-segment-profile]').disabled)errors.push('new profile missing validation');
        input.value=fixtures[0].name;input.dispatchEvent(new Event('input',{bubbles:true}));
        await saveSegmentProfile();
        if(!segmentProfileDraft.error||segmentProfileDraft.name!==fixtures[0].name||segmentProfileDraft.saving)errors.push('duplicate name loses draft');
        segmentProfilePanel.querySelector('[data-existing-segment-profile]').click();
        if(segmentProfileDraft.create||segmentProfileDraft.profileId!=='layout-profile')errors.push('return loses selection');
      }
      const before=playerAudio.currentTime;
      segmentProfilePanel.querySelector('[data-preview-segment-profile]').click();
      await new Promise(r=>setTimeout(r,150));
      if(segmentProfileAudio.paused||segmentProfileAudio.currentTime<segment.start_ms/1000||!playerAudio.paused)errors.push('clip preview not isolated');
      segmentProfileAudio.currentTime=segment.end_ms/1000;
      segmentProfileAudio.dispatchEvent(new Event('timeupdate'));
      if(!segmentProfileAudio.paused||playerAudio.currentTime!==before)errors.push('clip end affects main playback');
      segmentProfileDraft.success={...fixtures[0],sample_count:10};renderSegmentProfilePanel();
      if(!segmentProfilePanel.querySelector('.segment-profile-success')||!segmentProfilePanel.querySelector('[data-view-segment-profile]'))errors.push('success actions missing');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(segmentProfilePanel.hidden||!segmentProfilePanel.inert||segmentProfileMotion.effect.getKeyframes().at(-1).transform!=='translateX(100%)')errors.push('drawer exit missing');
      await segmentProfileMotion.finished;
      if(!segmentProfilePanel.hidden||document.querySelector('.has-segment-profile')||segmentProfileAudio.hasAttribute('src'))errors.push('panel cleanup incomplete');
      await openSegmentProfilePanel(detail.id,segment.id);
      closeSegmentProfilePanel();
      await openSegmentProfilePanel(detail.id,segment.id);
      await segmentProfileMotion.finished;
      if(segmentProfilePanel.hidden||segmentProfilePanel.inert||!segmentProfileDraft)errors.push('reopening drawer lost to stale close');
      closeSegmentProfilePanel(true);

      speakerProfiles=previousProfiles;applyLanguage(previousLocale);applyTheme(previousTheme);
      await showView('home');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(profilePanelChecks.result?.value) && !profilePanelChecks.result.value.length,
    '字幕声纹面板、试听与多语言：' + JSON.stringify(profilePanelChecks),
  );

  const settingsPageHeaders = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    await showView('settings');
    const failures = [];
    for (const kind of ['models', 'storage', 'advanced-settings', 'summary-model', 'ai-assist', 'whats-new']) {
      await openModal(kind);
      const nav = settingsModal.querySelector('.preferences-navigation [aria-current="page"]');
      const title = settingsModal.querySelector('.preferences-titlebar h2');
      if (!settingsModal.classList.contains('settings-page') || !nav?.checkVisibility() || !title?.checkVisibility() || !title.textContent.trim()) failures.push(kind);
      if (kind === 'whats-new') {
        const check = settingsModal.querySelector('[data-check-app-update]');
        const install = settingsModal.querySelector('[data-install-app-update]');
        const previous = {busy:updateBusy, progress:updateDownloadProgress, available:updateAvailable, version:updateVersion, policy:{...updatePolicy}};
        try {
          updateBusy='install';updateAvailable=true;updateVersion='1.9.7';updateDownloadProgress={percent:42,transferred:42,total:100};Object.assign(updatePolicy,{delayDays:0,dismissedVersion:'',releasedAt:Date.now()});renderUpdateButton();renderUpdateNotice();
          if (!check.disabled || !install.disabled || install.hidden || settingsModal.querySelector('.release-settings progress').value!==42 || updateNotice.querySelector('progress').value!==42) failures.push('about page download progress');
          updateBusy='';updateDownloadProgress=null;renderUpdateButton();renderUpdateNotice();
          if (check.textContent!==updateCopy().action || !install.textContent.includes(updateVersion) || !updateNotice.checkVisibility()) failures.push('separate check and install controls');
          updateNotice.querySelector('[data-dismiss-update]').click();renderUpdateNotice();
          if (!updateNotice.hidden || install.hidden) failures.push('dismissal hides only the notification');
          updateVersion='1.9.8';renderUpdateNotice();
          if (updateNotice.hidden) failures.push('new version restores update offer');
          settingsModal.querySelector('.release-delay input[value="3"]').click();
          if (!updateNotice.hidden || install.hidden || updatePolicy.delayDays!==3) failures.push('release delay keeps manual installation available');
        } finally {
          updatePolicy=previous.policy;persistUpdatePolicy();updateBusy=previous.busy;updateDownloadProgress=previous.progress;updateAvailable=previous.available;updateVersion=previous.version;renderUpdateButton();renderUpdateNotice();
        }
      }
      closeModal();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    return failures;
  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(settingsPageHeaders.result?.value) && !settingsPageHeaders.result.value.length,
    `设置页面导航、标题或更新状态异常：${JSON.stringify(settingsPageHeaders)}`,
  );
  const mobileLive = await client.send('Runtime.evaluate', {
    expression: `(async () => {
    aiAssistConfig.enabled = false;
    const meeting = {id:'a126fdcc-e5a5-40d5-92da-c7064e031654', title:'手机联动测试', language:'zh', tags:['手机录音'], notes:'已有重点', segments:[{id:'mobile-initial',speaker_name:'不应显示',text:'初次接管字幕',start_ms:0,end_ms:1000}], status:'recording'};
    syncBackendMeeting(meeting);
    adoptMobileMeeting(meeting);
    await new Promise(resolve => setTimeout(resolve, 400));
    const restored = liveSegments.get('mobile-initial') === document.querySelector('#transcript-scroll [data-segment-id="mobile-initial"]')
      && segmentInfoFor(meeting.id,'mobile-initial')?.text === '初次接管字幕'
      && latestLiveSegmentId === 'mobile-initial';
    const live = activeView === 'live' && meetingActive && document.querySelector('#pause').disabled && !document.querySelector('#end-meeting').disabled;
    const source = !document.querySelector('.mobile-source-tag') && !document.querySelector('#transcript-scroll .speaker-name') && !document.querySelector('[data-ai-assist-empty]') && !document.querySelector('.control-source') && liveInputLabel()===t('手机录音');
    const unique = uiData.meetings.filter(m => m.id === meeting.id).length === 1;
    await document.querySelector('#mobile-nav').onclick();
    const deviceFromLive = activeView === 'settings' && meetingActive && !miniMeeting.hidden && miniTitle.textContent === meeting.title;
    closeModal(); await showView('live');
    minimizeMeeting(); await showView('home');
    if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();
    const miniDiagnostic={title:miniTitle.textContent,hidden:miniMeeting.hidden,source:!!miniMeeting.querySelector('.mobile-source-tag'),position:getComputedStyle(taskCards).position,task:taskCards.getBoundingClientRect().toJSON(),mini:miniMeeting.getBoundingClientRect().toJSON(),sidebar:document.querySelector('.sidebar').getBoundingClientRect().toJSON(),view:activeView};
    const taskBounds=taskCards.getBoundingClientRect(),statusBounds=document.querySelector('#desktop-statusbar').getBoundingClientRect();
    const mini = document.querySelector('.library-panel').contains(taskCards) && !miniMeeting.hidden && !miniMeeting.querySelector('.mobile-source-tag') && miniTitle.textContent === meeting.title && getComputedStyle(taskCards).position === 'fixed' && taskBounds.left>=0 && taskBounds.right<=innerWidth+1 && taskBounds.top>=0 && taskBounds.bottom<=statusBounds.top && miniMeeting.getBoundingClientRect().bottom<=taskBounds.bottom+1;
    await document.querySelector('#mobile-manage').onclick();
    // 后台窗口的动画帧可能被节流，等待实际打开而不是固定延迟。
    for (let i = 0; i < 60 && !settingsModal.classList.contains('modal-enter'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    await settingsModal.querySelector('.mobile-install img').decode();
    const dialog = activeView === 'settings' && settingsModal.classList.contains('settings-page') && activeModal === 'device-connection' && !settingsModal.hidden && settingsModal.classList.contains('modal-enter') && !!settingsModal.querySelector('#mobile-dialog') && settingsModal.querySelector('.mobile-install img').complete && settingsModal.querySelector('.mobile-install img').naturalWidth > 0;
    settingsModal.querySelector('.modal-close').click();
    const closing = settingsModal.classList.contains('modal-leave');
    await new Promise(resolve => setTimeout(resolve, 250));
    await openModal('storage'); closeModal();
    await new Promise(resolve => setTimeout(resolve, 250));
    await document.querySelector('#mobile-manage').onclick();
    const retained = !!settingsModal.querySelector('#mobile-pair')?.onclick;
    document.querySelector('#mobile-dialog [data-mobile-panel]:not([hidden]) [data-mobile-page-step=pair], #mobile-dialog [data-mobile-panel=pair]:not([hidden]) #mobile-pair').click();
    const pairing = document.querySelector('#mobile-pair-dialog');
    const preview = settingsModal.querySelector('.mobile-pair-preview');
    for (let i = 0; i < 60 && !pairing.open; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const inlinePairing = preview.hidden && pairing.open && /^\\d{6}$/.test(pairing.querySelector('#mobile-pin').textContent)
      && preview.querySelector('[data-mobile-pair-qr]').src===document.querySelector('#mobile-qr').src
      && typeof preview.querySelector('[data-mobile-copy-preview]').onclick==='function'
      && !document.querySelector('#mobile-disable');
    pairing.querySelector('#mobile-close-pairing').click();
    for (let i = 0; i < 60 && pairing.open; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const pairingClosed = preview.hidden && !pairing.open && !settingsModal.hidden;
    closeModal();
    return {live, source, unique, mini, restored, dialog: deviceFromLive && dialog && closing && retained && inlinePairing && pairingClosed,miniDiagnostic};

  })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    ['live', 'source', 'unique', 'mini', 'restored', 'dialog'].every(
      (key) => mobileLive.result?.value?.[key] === true,
    ),
    `手机会议桌面联动：${JSON.stringify(mobileLive)}`,
  );
  check(pageErrors.length === 0, `交互期间渲染异常：${pageErrors.join('\n')}`);

  /* 应用自身把可预期的失败写进 console.error（例如临时数据目录里没有模型），
     这里只报告不判负，避免把"测试环境缺模型"误判成回归。 */
  if (consoleErrors.length) {
    console.log(`  · 渲染进程 console.error ${consoleErrors.length} 条（测试环境预期内，未判负）`);
  }

  const languagePicker = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      if (onboardingPage) await dismissOnboardingPage();
      document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      openOnboardingLanguage('zh');
      await new Promise(requestAnimationFrame);
      const firstHeading=onboardingPage.querySelector('h1');
      if(onboardingPage.contains(document.activeElement)||getComputedStyle(firstHeading).outlineStyle!=='none')throw Error('onboarding opened with automatic focus or a focus ring');
      const choices = [...onboardingPage.querySelectorAll('[name="locale"]')];
      const japanese = choices.find(input => input.value === 'ja');
      japanese.click();
      await new Promise(resolve => setTimeout(resolve, 150));
      const result = { count: choices.length, checked: onboardingPage.querySelector('[name="locale"]:checked').value,
        rail: onboardingPage.querySelectorAll('.onboarding-rail li').length === 5, keyboardNative: choices.every(input => input.type === 'radio') };
      onboardingPage.querySelector('form').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
      const deadline = Date.now()+5000;
      while (!onboardingPage?.querySelector('[data-onboarding-permissions]') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
      result.saved = locale === 'ja' && localStorage.getItem('brevia-language') === 'ja';
      await dismissOnboardingPage();
      return result;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    languagePicker.result?.value?.count === 8 &&
      languagePicker.result?.value?.checked === 'ja' &&
      languagePicker.result?.value?.rail &&
      languagePicker.result?.value?.keyboardNative &&
      languagePicker.result?.value?.saved,
    '语言引导必须展示八项原生单选，并即时保存选择',
  );
  // 真应用接线验证：八语种、自动循环、右侧隔离与关闭清理。
  const onboardingMotionResult = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      const configBefore=JSON.stringify([aiAssistConfig,summaryConfig]);
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']) {
        applyLanguage(code);
        for(const kind of ['language','permissions','setup','ai','phone']) {
          if(kind==='language') { openOnboardingLanguage(code); await new Promise(r=>setTimeout(r,160)); }
          else if(kind==='permissions') openOnboardingPermissions({microphone:'denied',screen:'denied'});
          else if(kind==='setup') await openOnboardingSetup();
          else if(kind==='ai') openOnboardingAi();
          else openOnboardingMobile();
          const handle=onboardingMotion;
          const rail=onboardingPage.querySelector('.onboarding-rail');
          const paper=rail.querySelector('[data-motion="paper"]');
          const copy=window.BreviaLocaleData.onboardingMotionCopy[code];
          const content=onboardingPage.querySelector('.onboarding-page-content');
          const before=content.innerHTML;
          if(!rail.querySelector('.onboarding-brand-lockup img[src$="brevia-logo.svg"][alt="Brevia"]') || rail.querySelectorAll('li').length!==5) errors.push(code+'/'+kind+': brand/navigation');
          if(handle.timeline.duration()!==9) errors.push(code+'/'+kind+': duration');
          if(!handle.timeline.getChildren().every(tween=>tween.targets().every(target=>!(target instanceof Element)||rail.contains(target)))) errors.push(code+'/'+kind+': leaked target');
          handle.seek(0); const wave=rail.querySelector('[data-motion="curve-one"]').getAttribute('d');
          handle.seek(2.8);
          if(parseFloat(getComputedStyle(rail.querySelector('[data-motion="curve-one"]')).opacity)<.99||parseFloat(getComputedStyle(rail.querySelector('[data-motion="transcript-one"]')).opacity)>0) errors.push(code+'/'+kind+': waveform leaves before settling');
          handle.seek(5.82);
          if(parseFloat(getComputedStyle(rail.querySelector('[data-motion="transcript-two"]')).opacity)>.01||parseFloat(getComputedStyle(rail.querySelector('[data-motion="points"]')).opacity)<.1) errors.push(code+'/'+kind+': transcript/minutes overlap');
          handle.seek(3.5);
          if(paper.dataset.phase!=='transcript'||rail.querySelector('[data-motion="transcript-one"]').textContent!==copy.transcriptFirst) errors.push(code+'/'+kind+': transcript');
          handle.seek(6.5);
          if(paper.dataset.phase!=='minutes'||rail.querySelector('[data-motion="points"] p').textContent!==copy.pointItem) errors.push(code+'/'+kind+': minutes');
          handle.seek(9);
          if(paper.dataset.phase!=='recording'||rail.querySelector('[data-motion="curve-one"]').getAttribute('d')!==wave) errors.push(code+'/'+kind+': loop seam');
          if(rail.querySelector('[data-motion="caption-record"] h3').textContent!==copy.recordHeading) errors.push(code+'/'+kind+': localized caption');
          if(rail.querySelector('.bom-controls,[data-motion-control]')) errors.push(code+'/'+kind+': removed controls');
          if(handle.timeline.timeScale()!==1.35) errors.push(code+'/'+kind+': faster playback');
          if(content.innerHTML!==before) errors.push(code+'/'+kind+': changed right pane');
          const demo=rail.querySelector('.bom');
          if(demo.scrollWidth>demo.clientWidth+1) errors.push(code+'/'+kind+': horizontal overflow');
          let looped=false;
          const onComplete=handle.timeline.eventCallback('onComplete');
          await new Promise(resolve=>{
            const timeout=setTimeout(resolve,2000);
            handle.timeline.eventCallback('onComplete',()=>{onComplete.call(handle.timeline);looped=true;clearTimeout(timeout);resolve();});
            handle.timeline.play(handle.timeline.duration()-.04);
          });
          handle.timeline.eventCallback('onComplete',onComplete);
          if(!looped||handle.timeline.paused()||handle.timeline.time()>=.4) errors.push(code+'/'+kind+': automatic loop');
          await dismissOnboardingPage();
          if(onboardingMotion || handle.timeline.isActive()) errors.push(code+'/'+kind+': cleanup');
        }
      }
      openOnboardingLanguage('en');
      updateOnboardingLanguageCopy('de'); updateOnboardingLanguageCopy('ja');
      await new Promise(resolve=>setTimeout(resolve,160));
      if(onboardingPage.lang!=='ja'||onboardingPage.querySelector('.bom').dataset.kind!=='language') errors.push('stale language preview');
      const staleHandle=onboardingMotion;
      updateOnboardingLanguageCopy('ru');
      await dismissOnboardingPage();
      if(staleHandle.timeline.isActive()||onboardingMotion) errors.push('language callback leaked after exit');
      if(JSON.stringify([aiAssistConfig,summaryConfig])!==configBefore) errors.push('demo wrote configuration');
      applyLanguage('zh');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(onboardingMotionResult.result?.value) &&
      !onboardingMotionResult.result.value.length,
    `左侧动效接线与八语种：${JSON.stringify(onboardingMotionResult)}`,
  );
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reducedOnboardingMotion = await client.send('Runtime.evaluate', {
    expression: `(async()=>{openOnboardingMobile();const handle=onboardingMotion;const wave=onboardingPage.querySelector('[data-motion="curve-one"]').getAttribute('d');await new Promise(r=>setTimeout(r,120));const stable=handle.timeline.paused()&&handle.timeline.time()===0&&onboardingPage.querySelector('[data-motion="curve-one"]').getAttribute('d')===wave;await dismissOnboardingPage();return stable;})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(reducedOnboardingMotion.result?.value === true, '引导减少动态：不自动播放且波形静止');
  const reducedProfileMotion = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const initialized=await window.brevia.initialize();
      const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
      applyBackendDetail(meeting);await showView('detail');
      await openSegmentProfilePanel(meeting.id,meeting.segments[0].id);
      const frames=segmentProfileMotion.effect.getKeyframes();
      const reduced=frames.every(frame=>frame.transform==='none')&&segmentProfileMotion.effect.getTiming().duration===80;
      await segmentProfileMotion.finished;
      closeSegmentProfilePanel();await segmentProfileMotion.finished;
      const closed=segmentProfilePanel.hidden;
      await showView('home');return reduced&&closed;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(reducedProfileMotion.result?.value === true, '声纹抽屉减少动态：淡入淡出且正常关闭');

  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  const onboardingFit = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      applyLanguage('zh'); applyTheme('light');
      const steps=[['language',()=>openOnboardingLanguage('zh')],['permissions',()=>openOnboardingPermissions()],['models',()=>openOnboardingSetup()],['ai',()=>openOnboardingAi()],['phone',()=>openOnboardingMobile()]];
      for(const [name,open] of steps){
        await open();
        if(document.querySelector('#desktop-statusbar').checkVisibility()) errors.push(name+': status bar visible during onboarding');
        await new Promise(resolve=>setTimeout(resolve,100));
        onboardingPage.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).forEach(a=>a.finish());
        const pages=1;
        for(let i=0;i<pages;i++){
          const content=onboardingPage.querySelector('.onboarding-page-content');
          const actions=onboardingPage.querySelector('.onboarding-actions,.onboarding-tour-actions');
          const bounds=actions?.getBoundingClientRect();
          if(content.scrollHeight>content.clientHeight+1) errors.push(name+'/'+i+': page overflow '+content.scrollHeight+'/'+content.clientHeight);
          if(!bounds || bounds.bottom>innerHeight+1 || bounds.top<0) errors.push(name+'/'+i+': footer outside viewport');
        }
        await dismissOnboardingPage();
        if(!document.querySelector('#desktop-statusbar').checkVisibility()) errors.push(name+': status bar not restored after onboarding');
      }
      await showView('settings');
      const voice=document.getElementById('speaker-profiles-entry');
      renderSettingsView();
      if(document.getElementById('speaker-profiles-entry')!==voice || !document.getElementById('app-update-entry')) errors.push('settings entries lost');
      const settingsScroll=document.querySelector('#settings-view .preferences-scroll');
      const capsuleOption=document.querySelector('[data-desktop-toggle="autoCapsule"]');
      if(capsuleOption){capsuleOption.scrollIntoView({block:'nearest'});const r=capsuleOption.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight+1)errors.push('desktop preferences cannot be reached');settingsScroll.scrollTop=0;}
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(onboardingFit.result?.value) && onboardingFit.result.value.length === 0,
    `引导页默认满屏及应用入口回归：${JSON.stringify(onboardingFit)}`,
  );
  const shortcutSettings = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      await showView('settings');
      const button=()=>document.querySelector('[data-shortcut-control="pauseShortcut"]');
      const begin=()=>button().click();
      const wait=async(test)=>{const until=Date.now()+3000;while(!test()&&Date.now()<until)await new Promise(r=>setTimeout(r,10));if(!test())errors.push('shortcut operation timed out');};
      button().scrollIntoView({block:'center'});
      if(button().getBoundingClientRect().bottom>innerHeight+1) errors.push('shortcut controls unreachable');
      begin();
      await wait(()=>desktopShortcutCapture?.timer);
      if(button().getAttribute('aria-pressed')!=='true'||document.activeElement!==button()) errors.push('shortcut capture not focused or announced');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
      await wait(()=>!desktopShortcutCapture);
      if(desktopPreferences.pauseShortcut!=='' || button().getAttribute('aria-pressed')==='true' || document.activeElement!==button()) errors.push('cancel did not restore prior shortcut and focus');
      begin();
      await wait(()=>desktopShortcutCapture?.timer);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'R',code:'KeyR',altKey:true,metaKey:window.brevia.platform==='darwin',ctrlKey:window.brevia.platform!=='darwin',bubbles:true}));
      await wait(()=>!desktopShortcutCapture && !desktopSettingsBusy);
      if(desktopPreferences.pauseShortcut!=='') errors.push('duplicate overwrote previous shortcut');
      begin();
      await wait(()=>desktopShortcutCapture?.timer);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',code:'Backspace',bubbles:true}));
      await wait(()=>!desktopShortcutCapture && !desktopSettingsBusy);
      if((await window.brevia.desktop.preferences()).pauseShortcut!=='') errors.push('clear not persisted');
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']){
        applyLanguage(code);
        if(document.querySelectorAll('[data-shortcut-control]').length!==2)errors.push(code+': missing shortcut controls');
        if(code!=='zh' && t('全局快捷键')==='全局快捷键')errors.push(code+': missing shortcut translation');
      }
      applyLanguage('zh');
      toast.classList.remove('visible');
      button().scrollIntoView({block:'center'});
      const groups=[...document.querySelectorAll('.desktop-shortcut')];
      const reference=document.querySelector('#preferences-basics .preference-control').getBoundingClientRect();
      for(const group of groups){
        const bounds=group.getBoundingClientRect();
        if(Math.abs(bounds.right-reference.right)>1)errors.push('shortcut actions misaligned');
        for(const control of group.querySelectorAll('button')){
          const rect=control.getBoundingClientRect();
          if(!control.checkVisibility() || !control.getAttribute('aria-label') || rect.width<20 || rect.left<bounds.left-1 || rect.right>bounds.right+1)errors.push('shortcut action clipped or unlabeled');
        }
      }
      const recording=()=>document.querySelector('[data-shortcut-control="recordingShortcut"]');
      const clearRecording=()=>document.querySelector('[data-shortcut-clear="recordingShortcut"]');
      const resetRecording=()=>document.querySelector('[data-shortcut-reset="recordingShortcut"]');
      if(!document.querySelector('[data-shortcut-clear="pauseShortcut"]').disabled || !document.querySelector('[data-shortcut-reset="pauseShortcut"]').disabled)errors.push('empty default shortcut offers redundant actions');
      const initial=desktopPreferences.recordingShortcut;
      if(recording().querySelectorAll('kbd').length!==3 || clearRecording().disabled || !resetRecording().disabled)errors.push('default shortcut controls incorrect');
      clearRecording().click();
      await wait(()=>!desktopSettingsBusy);
      if((await window.brevia.desktop.preferences()).recordingShortcut!=='' || !clearRecording().disabled || resetRecording().disabled)errors.push('clear action not saved or not reversible');
      resetRecording().click();
      await wait(()=>!desktopSettingsBusy);
      if((await window.brevia.desktop.preferences()).recordingShortcut!==initial || !resetRecording().disabled || clearRecording().disabled)errors.push('restore default not persisted');
      if(!document.querySelector('[data-desktop-settings-status]').hidden)errors.push('saved status should be hidden');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(shortcutSettings.result?.value) && shortcutSettings.result.value.length === 0,
    `快捷键设置：取消、冲突、清除、可达性和八语言：${JSON.stringify(shortcutSettings)}`,
  );
  const shortcutShot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    path.join(root, '.e2e-tmp', 'recording-shortcuts.png'),
    Buffer.from(shortcutShot.data, 'base64'),
  );
  const phonePair = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      openOnboardingMobile();
      onboardingPage.querySelector('[data-onboarding-mobile-pair]').click();
      const deadline=Date.now()+10000;
      while(!document.querySelector('#mobile-pair-dialog').open && Date.now()<deadline) await new Promise(r=>setTimeout(r,25));
      const status=await window.brevia.mobile.status();
      return {status,pin:document.querySelector('#mobile-pin').textContent,visible:!document.querySelector('#mobile-pairing').hidden,error:document.querySelector('#mobile-pair-error').textContent};
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const pairState = phonePair.result?.value;
  check(
    pairState?.visible && /^\d{6}$/.test(pairState.pin) && !pairState.error,
    `引导页应从真实配对服务显示二维码与配对码：${JSON.stringify(phonePair)}`,
  );
  if (pairState?.visible && pairState.status.addresses.length) {
    const certificate = JSON.parse(
      readFileSync(path.join(dataDir, 'mobile', 'identity.json'), 'utf8'),
    ).cert;
    const requestPhone = (pin, nonce) =>
      new Promise((resolve, reject) => {
        const request = httpsRequest(
          {
            hostname: '127.0.0.1',
            port: new URL(pairState.status.addresses[0]).port,
            path: '/pair',
            method: 'POST',
            ca: certificate,
            checkServerIdentity: () => undefined,
            headers: { 'Content-Type': 'application/json' },
          },
          (reply) => {
            reply.resume();
            reply.on('end', () => resolve(reply.statusCode));
          },
        );
        request.on('error', reject);
        // 导出两张审批截图会额外等待渲染帧；普通回归仍保持10秒超时。
        request.setTimeout(process.env.BREVIA_DESIGN_CAPTURE_DIR ? 60000 : 10000, () =>
          request.destroy(new Error('Phone approval timed out')),
        );
        request.end(JSON.stringify({ name: '<UI test phone>', code: pin, nonce }));
      });
    const response = requestPhone(pairState.pin, 'b'.repeat(32));
    const approval = await client.send('Runtime.evaluate', {
      expression: `(async()=>{
        const deadline=Date.now()+6000;
        while(!document.querySelector('.mobile-request-actions') && Date.now()<deadline) await new Promise(r=>setTimeout(r,25));
        const status=await window.brevia.mobile.status();
        const info=document.querySelector('.mobile-request-info');
        const actions=document.querySelector('.mobile-request-actions');
        const safe=info?.querySelector('b')?.textContent==='<UI test phone>' && !info.querySelector('ui');
        const verification=info?.querySelector('.mobile-verification')?.textContent===status.approval?.verification;
        const focused=!actions?.contains(document.activeElement);
        const dialog=document.querySelector('#mobile-pair-dialog');
        const footer=dialog.querySelector('.mobile-pair-actions').getBoundingClientRect();
        const fits=dialog.scrollHeight<=dialog.clientHeight+1 && footer.bottom<=innerHeight+1;
        return {safe,verification,focused,fits,bounds:{height:dialog.clientHeight,scroll:dialog.scrollHeight,footer:footer.bottom,viewport:innerHeight}};
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    check(
      ['safe', 'verification', 'focused', 'fits'].every(
        (key) => approval.result?.value?.[key] === true,
      ),
      `真实手机请求应安全显示设备名、校验词且默认焦点在拒绝：${JSON.stringify(approval)}`,
    );
    if (process.env.BREVIA_DESIGN_CAPTURE_DIR) {
      const output = path.resolve(process.env.BREVIA_DESIGN_CAPTURE_DIR);
      mkdirSync(output, { recursive: true });
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 0,
        height: 0,
        deviceScaleFactor: 1 / defaultWindowScale,
        mobile: false,
      });
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      writeFileSync(
        path.join(output, 'desktop-onboarding-pairing-request.png'),
        Buffer.from(shot.data, 'base64'),
      );
      await client.send('Runtime.evaluate', {
        expression: `(async()=>{if(onboardingPage)await dismissOnboardingPage();await showView('home');})()`,
        awaitPromise: true,
      });
      await client.send('Runtime.evaluate', {
        expression: `(async()=>{await document.fonts.ready;document.getAnimations().forEach(a=>a.effect.getComputedTiming().iterations===Infinity?a.pause():a.finish());await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
        awaitPromise: true,
      });
      const homePairShot = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      writeFileSync(
        path.join(output, 'desktop-mobile-pairing-approval.png'),
        Buffer.from(homePairShot.data, 'base64'),
      );
    }
    // HTTP 拒绝先于退场动画完成；等待处理函数关闭旧审批，再发起下一次配对。
    const denied = await client.send('Runtime.evaluate', {
      expression: `(async()=>{await document.querySelector('.mobile-request-actions button').onclick();return !document.querySelector('#mobile-pair-dialog').open;})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (denied.exceptionDetails)
      throw Error(denied.exceptionDetails.exception?.description || denied.exceptionDetails.text);
    check(denied.result?.value === true, '拒绝处理完成后必须关闭配对审批');
    check((await response) === 403, '电脑拒绝后真实配对请求应返回 403');
    if (process.env.BREVIA_DESIGN_CAPTURE_DIR) {
      for (const allowed of [false, true]) {
        if (allowed) {
          const session = await client.send('Runtime.evaluate', {
            expression: `(async()=>{await document.querySelector('#mobile-pair').onclick();const dialog=document.querySelector('#mobile-pair-dialog');const pin=document.querySelector('#mobile-pin').textContent;if(!dialog.open||!/^\\d{6}$/.test(pin))throw Error('重新配对没有打开有效的配对码');return pin;})()`,
            awaitPromise: true,
            returnByValue: true,
          });
          if (session.exceptionDetails)
            throw Error(
              session.exceptionDetails.exception?.description || session.exceptionDetails.text,
            );
          const [accepted, decision] = await Promise.all([
            requestPhone(session.result.value, 'c'.repeat(32)),
            (async () => {
              const result = await client.send('Runtime.evaluate', {
                expression: `(async()=>{const deadline=Date.now()+6000;while(!document.querySelector('.mobile-request-actions .modal-action')){if(Date.now()>deadline)throw Error('允许连接入口未出现');await new Promise(r=>setTimeout(r,25));}await document.querySelector('.mobile-request-actions .modal-action').onclick();const state=await window.brevia.mobile.status();return !document.querySelector('#mobile-pair-dialog').open&&state.devices.some(d=>d.name==='<UI test phone>')&&(mobileConnectionContent||document.getElementById('mobile-dialog')).dataset.mobilePageState==='paired'&&!document.querySelector('#mobile-nav').classList.contains('is-connected');})()`,
                awaitPromise: true,
                returnByValue: true,
              });
              if (result.exceptionDetails)
                throw Error(
                  result.exceptionDetails.exception?.description || result.exceptionDetails.text,
                );
              return result;
            })(),
          ]);
          check(
            accepted === 200 && decision.result?.value === true,
            '真实允许连接必须建立信任、关闭审批且不伪装成已连接',
          );
        }
        await client.send('Runtime.evaluate', {
          expression: `(async()=>{if(onboardingPage)await dismissOnboardingPage();await showView('settings');await openModal('device-connection');await document.fonts.ready;document.getAnimations().forEach(a=>a.effect.getComputedTiming().iterations===Infinity?a.pause():a.finish());})()`,
          awaitPromise: true,
        });
        const shot = await client.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        writeFileSync(
          path.join(
            path.resolve(process.env.BREVIA_DESIGN_CAPTURE_DIR),
            `desktop-mobile-pairing-${allowed ? 'approved' : 'denied'}.png`,
          ),
          Buffer.from(shot.data, 'base64'),
        );
      }
      await client.send('Runtime.evaluate', {
        expression: `(async()=>{closeModal();await new Promise(r=>setTimeout(r,250));await showView('home');})()`,
        awaitPromise: true,
      });
    }
  }
  await client.send('Runtime.evaluate', {
    expression: `(async()=>{document.querySelector('#mobile-close-pairing').click();await new Promise(r=>setTimeout(r,300));if(onboardingPage)await dismissOnboardingPage();})()`,
    awaitPromise: true,
  });
  const workspaceSubmit = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      await showView('home');
      setLibraryVisible(true);
      document.querySelector('.new-workspace').click();
      const form=document.querySelector('.workspace-dialog form');
      const popup=form.closest('.workspace-create-popover');
      if(!popup?.matches(':popover-open')||popup.getAttribute('popover')!=='auto'||document.body.classList.contains('modal-open'))throw new Error('workspace creation must be a nonmodal native popover');
      const bounds=popup.getBoundingClientRect(),sidebar=document.querySelector('.library-panel').getBoundingClientRect();
      if(bounds.width>320||bounds.width<300||bounds.left<sidebar.right||bounds.bottom>innerHeight-7)throw new Error('workspace popover is not anchored beside the sidebar');
      const input=form.querySelector('[name="name"]');
      const field=input.getBoundingClientRect(),heading=popup.querySelector('h2').getBoundingClientRect(),close=popup.querySelector('[data-close-modal]').getBoundingClientRect();
      if(Math.abs(field.left-bounds.left-15)>1||Math.abs(bounds.right-field.right-15)>1||Math.abs(heading.left-field.left)>1||Math.abs(close.right-field.right)>1)throw new Error('workspace popover content must fill its padded width');
      if(document.activeElement!==input)throw new Error('workspace name is not focused');
      input.value='   ';form.requestSubmit();
      if(input.checkValidity())throw new Error('blank workspace name accepted');
      popup.querySelector('details').open=true;
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(!popup.querySelector('textarea').checkVisibility())throw new Error('optional workspace description inaccessible');
      const name='Design review '+Date.now();
      input.value=name;
      form.requestSubmit(); form.requestSubmit();
      for(let i=0;i<100 && !workspaces.some(item=>item.name===name);i++) await new Promise(resolve=>setTimeout(resolve,25));
      const created=workspaces.filter(item=>item.name===name);
      if(created.length===1) {
        await window.brevia.workspace.delete({workspace_id:created[0].id});
        workspaces=workspaces.filter(item=>item.id!==created[0].id); renderWorkspaceNav();
      }
      await new Promise(resolve=>setTimeout(resolve,240));
      return created.length===1;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(workspaceSubmit.result?.value === true, '连续提交工作区表单只能创建一次');
  await client.send('Runtime.evaluate', {
    expression: "document.querySelector('.new-workspace').click()",
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  const workspaceEscape = await client.send('Runtime.evaluate', {
    expression: `(async()=>{await new Promise(resolve=>setTimeout(resolve,50));return !document.querySelector('.workspace-create-popover')&&document.activeElement.matches('.new-workspace');})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(workspaceEscape.result?.value === true, 'Esc 关闭新建工作区并恢复入口焦点');
  await client.send('Runtime.evaluate', {
    expression: "document.querySelector('.new-workspace').click()",
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 600,
    y: 40,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 600,
    y: 40,
    button: 'left',
    clickCount: 1,
  });
  const workspaceDismiss = await client.send('Runtime.evaluate', {
    expression: `(async()=>{await new Promise(resolve=>setTimeout(resolve,50));return !document.querySelector('.workspace-create-popover')&&!document.body.classList.contains('modal-open');})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(workspaceDismiss.result?.value === true, '外部点击轻关闭工作区浮层且不锁定页面');
  const protectedFocus = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      openConfirmation('Confirmation','Focus check',()=>{});
      const cancel=settingsModal.querySelector('[data-cancel-confirmation]');
      const buttons=[...settingsModal.querySelectorAll('button')];
      const initial=!settingsModal.contains(document.activeElement) && document.querySelector('.app-shell').inert;
      buttons.at(-1).focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      const wrapped=document.activeElement===buttons[0];
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      return initial && wrapped && !document.querySelector('.app-shell').inert;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    protectedFocus.result?.value === true,
    '确认弹窗默认聚焦取消，Tab 留在弹窗，关闭后恢复背景交互',
  );

  const restoration = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      if (onboardingPage) await dismissOnboardingPage();
      closeModal(); await new Promise(resolve => setTimeout(resolve,250));
      meetingActive=false; await showView('settings'); openModal('ai-features');
      const tabs=settingsModal.querySelectorAll('[data-ai-settings-tab]').length===2;
      const summaryEnabled=summaryConfig.enabled;
      settingsModal.querySelector('[data-ai-settings-tab="ai-assist"]').click();
      const notes=settingsModal.querySelector('[data-ai-settings-enabled]');
      notes.click();
      const independent=summaryConfig.enabled===summaryEnabled && aiAssistConfigDraft.enabled===notes.checked;
      const levels=settingsModal.querySelectorAll('[name="proactivity"]').length===3;
      const draft=aiAssistConfigDraft; draft.proactivity='auto';
      settingsModal.querySelector('[data-open-models-from-config]').click();
      settingsModal.querySelector('.modal-close').click();
      const modelReturn=activeModal==='ai-assist' && aiAssistConfigDraft===draft && draft.proactivity==='auto';
      closeModal(); await new Promise(resolve => setTimeout(resolve,250));
      setPrepareMode('record'); await showView('prepare');
      const speakers=new FormData(prepareForm).get('meeting-speakers')==='-1';
      const language=prepareForm.querySelector('[name="meeting-language"]').closest('.flow-select');
      language.querySelector('[data-flow-select-toggle]').click();
      const menu=language.querySelector('.flow-select-options'), menuRect=menu.getBoundingClientRect();
      const menusVisible=menuRect.top>=0 && menuRect.bottom<=innerHeight && menuRect.height>0 && menu.contains(document.elementFromPoint(menuRect.left+12,menuRect.top+12));
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      const button=prepareForm.querySelector('.primary-action'); button.scrollIntoView({block:'nearest'});
      const prepareReachable=button.getBoundingClientRect().bottom<=innerHeight+1;
      const data=await window.brevia.initialize();
      const meeting=await window.brevia.meeting.get({meeting_id:data.meetings[0].id});
      applyBackendDetail(meeting); await showView('detail');
      const detail=document.querySelector('#detail-view');
      const content=detail.querySelector('.detail-layout').getBoundingClientRect();
      const player=detail.querySelector('.player').getBoundingClientRect();
      const reading=content.height>100 && player.bottom<=innerHeight+1 && Math.abs(player.left-content.left)<2 && Math.abs(player.right-content.right)<2;
      const threeTabs=detail.querySelectorAll('[role=tab]').length===3 && detailActiveTab==='summary';
      detail.querySelector('[data-detail-tab="transcript"]').click();
      applyBackendDetail({...meeting,transcript_revision:0,original_segments:[{...meeting.segments[0],version:'live',text:'原始稿切换测试'}]});
      detail.querySelector('[data-transcript-version="original"]').click();
      const rawAvailable=!detail.querySelector('[data-transcript-version="original"]').disabled && uiData.detail.transcriptVersion==='original' && detail.querySelector('.transcript-body').textContent.includes('原始稿切换测试');
      applyBackendDetail(meeting);
      const search=detail.querySelector('[data-transcript-search]');
      search.value='__no_matching_segment__'; search.dispatchEvent(new Event('input',{bubbles:true}));
      const filtered=[...detail.querySelectorAll('.transcript-body .segment,.transcript-body .refined-fulltext')].every(row=>!row.hidden);
      const resultsPanel=detail.querySelector('.detail-search-results');
      const searchEmpty=!resultsPanel.hidden && resultsPanel.querySelectorAll('.transcript-search-result').length===0 && detail.querySelector('.notes').hidden;
      const firstText=detail.querySelector('.segment-copy p,.refined-fulltext-body')?.textContent?.trim().slice(0,4)||'';
      search.value=firstText;search.dispatchEvent(new Event('input',{bubbles:true}));
      const mirrored=resultsPanel.querySelector('[data-transcript-search]').value===firstText && resultsPanel.querySelectorAll('.transcript-search-result').length>0;
      resultsPanel.querySelector('[data-close-transcript-search]').click();
      const searchRestored=resultsPanel.hidden&&detail.querySelector('.notes').hidden&&document.activeElement===search;
      search.value=''; search.dispatchEvent(new Event('input',{bubbles:true}));
      openReviewDocument('summary');
      const summaryVisible=detail.querySelector('[data-detail-panel=summary]').contains(detail.querySelector('.summary-preview')) && detail.querySelector('[data-detail-panel=notes]').hidden && detail.querySelector('.notes').hidden && !detail.querySelector('.detail-actions').hidden && detail.querySelector('.summary-preview').getBoundingClientRect().width > detail.querySelector('.detail-layout').getBoundingClientRect().width * .95 && detail.querySelector('.summary-preview').getBoundingClientRect().height>100;
      const originalSummaryConfig=structuredClone(summaryConfig);
      const retainedSummary=uiData.detail.summary.markdown;
      summaryConfig.enabled=true;summaryConfig.provider='built-in';summaryConfig.providers['built-in'].model='__missing_summary_model__';
      const previousTaskCount=taskCards.children.length;
      await generateMeetingSummary();
      const inlineSummaryConfig=taskCards.children.length===previousTaskCount && !detail.querySelector('[data-summary-feedback]').hidden && detail.querySelector('[data-summary-feedback]').textContent.includes(t('内置纪要模型未配置')) && uiData.detail.summary.markdown===retainedSummary && !summaryGeneratingMeetingId;
      detail.querySelector('[data-summary-feedback] [data-settings-modal]').click();
      const configReturnsToMeeting=activeView==='detail' && activeModal==='summary-model' && currentMeetingDetail.id===meeting.id;
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      summaryConfig.enabled=false;await generateMeetingSummary();
      const disabledSummary=!detail.querySelector('[data-summary-feedback]').hidden && detail.querySelector('[data-summary-feedback]').textContent.includes(t('内置纪要模型未配置')) && !summaryConfig.enabled;
      detail.querySelector('[data-summary-feedback] [data-settings-modal]').click();
      const disabledConfigOpens=activeView==='detail' && activeModal==='summary-model' && !settingsModal.hidden;
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      detail.querySelector('.summary-feedback-close').click();summaryConfig=originalSummaryConfig;
      openModal('export');const summaryExportDefault=Object.entries(exportSelection).filter(([,format])=>format).every(([content])=>content==='notes') && Boolean(exportSelection.notes);closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      const summaryBack=detail.querySelector('.back');
      const summaryBackVisible=summaryBack.getBoundingClientRect().width>0 && Math.abs(summaryBack.querySelector('svg.interface-icon')?.getBoundingClientRect().width-20)<.5 && getComputedStyle(summaryBack,'::before').content==='none';
      uiData.detail.summary.markdown ||= '# 纪要草稿';
      renderMeetingDetail();
      detail.querySelector('[data-open-summary-edit]').click();
      const summaryEditor=inlineSummaryEditor;
      summaryEditor.setMarkdown('# 切换标签后保留草稿');
      uiData.detail.summaryDraft=summaryEditor.getMarkdown();
      openReviewDocument('notes');
      const editorRetained=detail.querySelector('[data-detail-panel=summary]').contains(detail.querySelector('[data-inline-summary-editor]'))&&detail.querySelector('[data-detail-panel=summary]').hidden;
      openReviewDocument('summary');
      const summaryDraftPreserved=editorRetained && inlineSummaryEditor===summaryEditor && summaryEditor.getMarkdown().includes('切换标签后保留草稿') && detail.querySelector('[data-detail-panel=summary]').contains(detail.querySelector('[data-inline-summary-editor]'));
      detail.querySelector('[data-cancel-inline-summary-edit]').click();
      applyBackendDetail({...meeting,transcript_revision:0,segments:meeting.segments.filter(segment=>segment.version!=='live')});
      const rawUnavailable=detail.querySelector('[data-transcript-version=original]').disabled && uiData.detail.originalTranscript.length===0;
      applyBackendDetail(meeting);
      showRefinementProgress(42,100,'Layout test',meeting.id,'正在识别');
      toggleTaskCardMinimized(refinementCard,refinementCard.querySelector('[data-minimize-task-card]'));
      showRefinementProgress(56,100,'Layout test',meeting.id,'正在识别');
      const minimizedProgress=refinementCard.querySelector('.task-mini-percent').textContent==='56%';
      refinementCard.classList.remove('is-minimized'); refinementCard.hidden=true;
      return {tabs,independent,levels,modelReturn,speakers,menusVisible,prepareReachable,reading,threeTabs,filtered,searchEmpty,mirrored,searchRestored,summaryVisible,inlineSummaryConfig,configReturnsToMeeting,disabledSummary,disabledConfigOpens,summaryExportDefault,summaryBackVisible,summaryDraftPreserved,rawAvailable,rawUnavailable,minimizedProgress};
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const restorationChecks = restoration.result?.value;
  check(
    restorationChecks && Object.values(restorationChecks).every(Boolean),
    `设计还原交互、独立 AI 配置及可见布局：${JSON.stringify(restorationChecks || restoration.exceptionDetails)}`,
  );
  await client.send('Page.bringToFront');
  const detailConsistency = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      const detail=document.querySelector('#detail-view');
      const selectors=['.detail-head','.detail-layout','.tabbar','.player','.detail-actions'];
      const samples=[];
      for(const tab of ['notes','transcript','summary','notes']){
        openReviewDocument(tab);
        const panel=detail.querySelector('[data-detail-panel="'+tab+'"]');
        const animation=panel.getAnimations()[0];
        if(!animation||animation.effect.getTiming().duration!==180||animation.effect.getKeyframes().some(frame=>Number(frame.opacity)!==1))errors.push(tab+': inconsistent tab motion');
        animation?.finish();
        samples.push(selectors.map(selector=>{const r=detail.querySelector(selector).getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
        const nav=detail.querySelector('.detail-document-navigation'),navBounds=nav.getBoundingClientRect(),panelBounds=panel.getBoundingClientRect(),tools=detail.querySelector('.detail-content-toolbar').getBoundingClientRect();
        const tablist=nav.querySelector('[role=tablist]'),tabButtons=[...tablist.querySelectorAll('[data-detail-tab]')];
        if(tablist.getAttribute('aria-orientation')==='vertical'||tabButtons.length!==3||tabButtons.some(button=>Math.abs(button.getBoundingClientRect().top-tabButtons[0].getBoundingClientRect().top)>1)||navBounds.bottom>tools.top+1||panelBounds.top<tools.bottom-1)errors.push(tab+': horizontal navigation or toolbar overlaps content');
        if(detail.querySelector('.detail-document-heading')||tablist.querySelector('[aria-selected=true]')?.dataset.detailTab!==tab)errors.push(tab+': selected document tab incorrect');
        const title=detail.querySelector('h1');
        if(title.title!==title.textContent||getComputedStyle(title).whiteSpace!=='nowrap')errors.push(tab+': compact title loses full-text access');
        if(getComputedStyle(panel).opacity!=='1'||panel.getBoundingClientRect().height<100)errors.push(tab+': empty content region');
        const roster=detail.querySelector('.summary-participants');
        if(roster&&!detail.querySelector('.detail-head').contains(roster))errors.push(tab+': roster moved with tab');
      }
      for(const [index,sample] of samples.slice(1).entries())for(const [i,rect] of sample.entries())if(rect.some((value,j)=>Math.abs(value-samples[0][i][j])>1))errors.push('tab changed geometry '+JSON.stringify({tab:['transcript','summary','notes'][index],region:selectors[i],before:samples[0][i],after:rect}));
      openReviewDocument('summary');
      const body=detail.querySelector('.summary-body');
      if(body&&[...body.querySelectorAll('hr')].some(rule=>getComputedStyle(rule).display!=='none'))errors.push('redundant summary separators remain');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(detailConsistency.result?.value) && !detailConsistency.result.value.length,
    '回看分区统一比例、固定页头与播放器、相同切换动效：' +
      JSON.stringify(
        detailConsistency.result?.value ||
          detailConsistency.exceptionDetails?.exception?.description ||
          detailConsistency.exceptionDetails ||
          detailConsistency,
      ),
  );
  // 旧语言的系统默认不能冒充手动偏好；切换与重绘均按目标语言重新推导。
  const prepareModelSelection = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const errors=[],savedPreference=localStorage.getItem(PREFERRED_MODEL_KEY),savedPaths=[...modelPaths],savedLanguage=prepareForm.querySelector('[name="meeting-language"]').value;
      const fun=refinedModels().find(model=>model.kind==='funasr-nano');
      const qwen=refinedModels().find(model=>(model.default_for_languages||[]).includes('ja'));
      const parakeet=refinedModels().find(model=>(model.default_for_languages||[]).includes('en'));
      const choose=(name,value)=>{const choice=prepareForm.querySelector('[data-flow-select-choice="'+name+'"][data-value="'+value+'"]');if(!choice)throw Error('missing model/language choice '+name+':'+value);choice.click();};
      const expect=(id,scenario)=>{const actual=new FormData(prepareForm).get('refined-model');if(actual!==id)errors.push(scenario+': '+actual+' != '+id);};
      try {
        if(!fun||!qwen||!parakeet)throw Error('missing language default fixture');
        localStorage.removeItem(PREFERRED_MODEL_KEY);
        refinedModels().forEach(model=>modelPaths.set(model.id,'test-installed'));
        prepareForm.querySelector('[name="meeting-language"]').value='zh';renderPrepareSelects();expect(fun.id,'Chinese default');
        choose('meeting-language','en');expect(parakeet.id,'Chinese to English');
        choose('meeting-language','ja');expect(qwen.id,'English to Japanese');
        choose('meeting-language','zh');expect(fun.id,'Japanese to Chinese');
        choose('meeting-language','en');choose('refined-model',fun.id);
        choose('meeting-language','ja');expect(qwen.id,'English manual choice stays in English');
        choose('meeting-language','en');expect(fun.id,'English preference restored');
        choose('refined-model',qwen.id);modelPaths.delete(qwen.id);renderPrepareSelects();expect(qwen.id,'Uninstalled explicit preference');
        choose('meeting-language','zh');expect(fun.id,'English preference cannot replace Chinese default');
        choose('meeting-language','en');expect(qwen.id,'English preference survives switching');
        if(preferredModelMap().en!==qwen.id||preferredModelMap().zh||preferredModelMap().ja)errors.push('automatic selection overwrote preferences');
        localStorage.removeItem(PREFERRED_MODEL_KEY);modelPaths.clear();modelPaths.set(fun.id,'test-installed');renderPrepareSelects();expect(fun.id,'Installed compatible fallback');
        modelPaths.clear();renderPrepareSelects();expect(parakeet.id,'No installed compatible model');
      } finally {
        if(savedPreference===null)localStorage.removeItem(PREFERRED_MODEL_KEY);else localStorage.setItem(PREFERRED_MODEL_KEY,savedPreference);
        modelPaths.clear();for(const [id,path]of savedPaths)modelPaths.set(id,path);
        prepareForm.querySelector('[name="meeting-language"]').value=savedLanguage;renderPrepareSelects();
      }
      return errors;
    })()`,
    returnByValue: true,
  });
  check(
    Array.isArray(prepareModelSelection.result?.value) &&
      !prepareModelSelection.result.value.length,
    '准备页按会议语言选择模型：' +
      JSON.stringify(prepareModelSelection.result?.value || prepareModelSelection.exceptionDetails),
  );

  const finalAtlasControls = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      if(onboardingPage) await dismissOnboardingPage();
      await openOnboardingSetup();
      for(const card of onboardingPage.querySelectorAll('.onboarding-model-card')) {
        if(card.querySelector('.asr-meters,.asr-meter,.rating-scale,.is-installed')) errors.push('legacy onboarding model details');
        const id=card.querySelector('input').value;
        if(card.querySelector('.asr-tagline').textContent!==asrText('model')[id].onboarding) errors.push('model short description');
      }
      await dismissOnboardingPage();
      openOnboardingPermissions({microphone:'granted',screen:'granted',systemAudioSupported:true});
      await new Promise(resolve=>setTimeout(resolve,100));
      const saved={mode:currentCaptureMode,prepare:prepareView.dataset.mode,view:activeView,active:meetingActive,meeting:breviaClient.state.meeting,inputs:breviaClient.state.inputs};
      const verifyMeter=(selector,segmented)=>{
        const meter=document.querySelector(selector);
        if(!meter?.checkVisibility({visibilityProperty:true})||meter.closest('[inert]')){errors.push(selector+' is not on the active surface');return;}
        const color=document.createElement('span');color.style.color=segmented?'var(--color-success-indicator)':'var(--color-text-body)';meter.after(color);
        if(getComputedStyle(meter,'::after').backgroundColor!==getComputedStyle(color).color)errors.push(selector+' signal color');
        color.remove();
        const css=getComputedStyle(meter);
        if(segmented?!css.maskImage.includes('data:image/svg+xml'):css.maskImage!=='none'||parseFloat(css.height)!==7)errors.push(selector+' signal shape');
        for(const level of [.5,0]){
          breviaClient.onLevel('mic',level);
          // 结束本次电平的短过渡，避免等待期间下一帧硬件采样覆盖固定测试信号。
          getComputedStyle(meter,'::after').transform;
          for(const animation of meter.getAnimations({subtree:true}))if(animation.transitionProperty==='transform')animation.finish();
          const transform=getComputedStyle(meter,'::after').transform;
          if(Number(meter.style.getPropertyValue('--level'))!==level||transform==='none'||Math.abs(new DOMMatrixReadOnly(transform).a-level)>.001)errors.push(selector+' signal '+level+' produced '+transform);
        }
      };
      try{
        verifyMeter('[data-onboarding-mic-level]',true);
        await dismissOnboardingPage();
        setPrepareMode('record');renderCaptureMode('mic');await showView('prepare');
        verifyMeter('#mic-level',true);
        breviaClient.state.meeting={...(saved.meeting||currentMeetingDetail),tags:[]};
        breviaClient.state.inputs={mic:true,system:false};
        meetingActive=true;await showView('live');
        if(document.querySelector('[data-live-mic-level]'))errors.push('unexpected live meter');
      }finally{
        if(onboardingPage)await dismissOnboardingPage();
        meetingActive=saved.active;breviaClient.state.meeting=saved.meeting;breviaClient.state.inputs=saved.inputs;
        await showView(saved.view);setPrepareMode(saved.prepare||'record');renderCaptureMode(saved.mode);
      }
      openOnboardingAi();
      if(onboardingPage.querySelector('[data-configure-ai-notes]') || onboardingPage.querySelector('.onboarding-privacy-hint')) errors.push('legacy onboarding AI options');
      if(!onboardingPage.querySelector('.onboarding-shared-service [data-configure-ai-summary]')) errors.push('shared service not separated');
      await dismissOnboardingPage();
      await showView('home');
      for(const destination of ['all-meetings','recently-deleted']) {
        await showView('settings');
        await openModal('models');
        if(!document.querySelector('.app-shell').classList.contains('is-settings-view')) errors.push('settings layout state missing');
        await showLibraryNav(destination);
        if(activeView!=='home' || activeLibraryNav!==destination || !settingsModal.hidden || document.querySelector('.app-shell').inert || document.querySelector('.app-shell').classList.contains('is-settings-view')) errors.push('settings navigation blocked '+destination);
      }
      await showView('settings');
      openOnboardingAi(true);
      await showLibraryNav('all-meetings');
      await new Promise(resolve=>setTimeout(resolve,300));
      if(onboardingPage || document.body.classList.contains('modal-open')) errors.push('AI settings still cover library');
      showRefinementProgress(42,100,'视觉回归任务',currentMeetingDetail.id,'正在识别');
      miniPlayback.hidden=false;syncTaskCardStack(miniPlayback);
      const taskSummary=document.querySelector('[data-task-summary]');
      if(taskCards.classList.contains('is-collapsed'))taskSummary.click();
      const r=refinementCard.getBoundingClientRect(),bar=refinementBar.parentElement.getBoundingClientRect();
      if(bar.height<3 || bar.top<r.top || bar.bottom>r.bottom+.5 || refinementBar.parentElement.getAttribute('aria-valuenow')!=='42') errors.push('rear task progress hidden');
      taskSummary.click();
      if(getComputedStyle(taskCards).display!=='none'||taskSummary.getAttribute('aria-expanded')!=='false') errors.push('task stack cannot collapse');
      taskSummary.click();
      if(getComputedStyle(taskCards).display==='none'||taskSummary.getAttribute('aria-expanded')!=='true') errors.push('task stack cannot restore');
      miniPlayback.hidden=true;refinementCard.hidden=true;
      miniMeeting.hidden=false;syncTaskCardStack(miniMeeting);
      await showView('settings');
      if(!document.querySelector('#desktop-statusbar').contains(taskSummary)||!taskSummary.checkVisibility())errors.push('settings hide task summary');
      if(!taskCards.classList.contains('is-collapsed'))taskSummary.click();
      taskSummary.click();
      if(activeView!=='settings'||!taskCards.checkVisibility()||!miniMeeting.checkVisibility())errors.push('settings cannot reveal ongoing tasks in place');
      const taskBounds=taskCards.getBoundingClientRect(),statusBounds=document.querySelector('#desktop-statusbar').getBoundingClientRect();
      if(taskBounds.left<0||taskBounds.right>innerWidth+1||taskBounds.top<0||taskBounds.bottom>statusBounds.top)errors.push('task popover overlaps status bar or leaves viewport');
      taskSummary.click();
      if(activeView!=='settings'||taskSummary.getAttribute('aria-expanded')!=='false'||getComputedStyle(taskCards).display!=='none')errors.push('task summary cannot collapse in settings');
      await showView('home');
      miniMeeting.hidden=true;
      for(const tone of ['success','error','info']) {
        showToast(t('工作区已创建'),undefined,tone);
        if(!toast.querySelector('.toast-status-mark svg') || getComputedStyle(toast).borderRadius!=='8px' || toast.dataset.tone!==tone || toast.getAttribute('role')!==(tone==='error'?'alert':'status')) errors.push('legacy notification '+tone);
      }
      toast.classList.remove('visible');
      const actions=document.querySelector('.window-actions');
      const center=actions.getBoundingClientRect().top+actions.getBoundingClientRect().height/2;
      const visibleActions=[...actions.children].filter(element=>element.checkVisibility());
      for(const [index,e] of visibleActions.entries()) {
        const r=e.getBoundingClientRect();if(Math.abs(r.top+r.height/2-center)>1) errors.push('window action alignment');
        if(index&&Math.abs(r.left-visibleActions[index-1].getBoundingClientRect().right-8)>1)errors.push('window action spacing');
      }
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(finalAtlasControls.result?.value) && !finalAtlasControls.result.value.length,
    `电平、首启选型、共享 AI、任务进度及通知：${JSON.stringify(finalAtlasControls.result?.value || finalAtlasControls.exceptionDetails)}`,
  );
  const detailToolChecks = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      await showView('detail');
      const meeting=currentMeetingDetail;
      const d=uiData.detail;
      d.hasRefined=true;d.refinedMode='timestamps';d.transcriptVersion='refined';
      d.refinedTranscript=d.originalTranscript;d.transcriptEditable=true;d.refineState='idle';
      detailActiveTab='transcript';renderMeetingDetail();
      const errors=[];
      const selectors=['[data-edit-transcript]','[data-detail-translation-toggle]','[data-refine-more]','[data-open-summary-edit]','[data-copy-summary]'];
      for(const selector of selectors){
        openReviewDocument(selector.includes('summary')?'summary':'transcript');
        const button=document.querySelector(selector),icon=button?.querySelector('svg');
        const iconSize=16;
        if(!button||!icon||Math.abs(parseFloat(getComputedStyle(icon).width)-iconSize)>.1||button.getBoundingClientRect().height<31.5||button.getBoundingClientRect().height>36||!button.textContent.trim())errors.push(selector+': detail action geometry');
      }
      document.querySelector('[data-detail-tab=transcript]').click();
      if(!document.querySelector('.refine-state.is-done[role=status]')||document.querySelector('.refine-state.is-done svg'))errors.push('legacy refined state');
      const checkMenu=selector=>{
        const menu=document.querySelector(selector),r=menu.getBoundingClientRect();
        if(r.top<0||r.bottom>innerHeight+1||r.left<0||r.right>innerWidth+1||!menu.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)))errors.push(selector+': menu clipped or occluded');
      };
      document.querySelector('[data-refine-more]').click();checkMenu('.refine-menu');
      const refineMenu=document.querySelector('.refine-menu'),refineBounds=refineMenu.getBoundingClientRect();
      if(refineBounds.width>280||refineBounds.height>280||!refineMenu.querySelector('header')||!refineMenu.querySelector('footer [data-refine-action]'))errors.push('refine: compact heading or action layout missing');
      for(const row of refineMenu.querySelectorAll('.refine-menu-speakers')){
        const label=row.querySelector(':scope>span'),control=row.querySelector('.flow-select,input');
        if(!label||!control||control.getBoundingClientRect().left<label.getBoundingClientRect().right-1||row.scrollWidth>row.clientWidth+1)errors.push('refine: field label and input overlap');
      }
      document.querySelector('[data-detail-translation-toggle]').click();checkMenu('.detail-translation-menu');
      document.querySelector('[data-edit-transcript]').click();
      if(!document.querySelector('[data-transcript-save]')||document.querySelector('[data-refine-more]'))errors.push('editing action guard lost');
      document.querySelector('[data-transcript-cancel]').click();
      applyBackendDetail(meeting);renderMeetingDetail();
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(detailToolChecks.result?.value) && !detailToolChecks.result.value.length,
    `详情操作统一图标、间距、菜单及编辑保护：${JSON.stringify(detailToolChecks.result?.value || detailToolChecks.exceptionDetails)}`,
  );

  // 默认背景检查前移开鼠标，避免布局变化让按钮恰好进入悬停态。
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  const visualFeedback = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      applyLanguage('zh');applyTheme('light');
      const visible=element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom<=innerHeight+1&&r.top>=0&&element.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));};
      for(const mode of ['record','import']){
        setPrepareMode(mode);await showView('prepare');
        const button=prepareForm.querySelector('.primary-action'),view=document.getElementById('prepare-view');
        await new Promise(requestAnimationFrame);
        button.scrollIntoView({block:'nearest'});await new Promise(requestAnimationFrame);
        const r=button.getBoundingClientRect(),v=view.getBoundingClientRect(),formBounds=prepareForm.getBoundingClientRect();
        const workspace=prepareForm.querySelector('.compose-workspace').getBoundingClientRect();
        if(!visible(button)||r.left<formBounds.left||r.right>formBounds.right+1||formBounds.width>741)errors.push(mode+': start action escaped the centered composer');
        if(r.top<workspace.bottom-1||r.top-workspace.bottom>40)errors.push(mode+': start action is detached from the form');
        if(r.top<v.top-1||r.bottom>v.bottom+1||view.scrollWidth>view.clientWidth+1)errors.push(mode+': start action cannot be reached without horizontal overflow');
        view.scrollTop=view.scrollHeight;await new Promise(requestAnimationFrame);
        if(!visible(button))errors.push(mode+': submit action is unreachable after scrolling');
        view.scrollTop=0;
      }
      setPrepareMode('record');await showView('prepare');
      const primaryFields=[...prepareForm.querySelectorAll('.form-grid label')];
      if(primaryFields.length!==2||primaryFields.some(field=>field.getBoundingClientRect().width<=0)||!prepareForm.querySelector('details.prepare-options [name=meeting-speakers]'))errors.push('record: core fields or expandable options missing');
      const speakerInput=prepareForm.querySelector('[name="meeting-speakers"]');
      const previousSpeakers=speakerInput.value;
      prepareForm.querySelector('details.prepare-options [data-flow-select-choice="summary-template"][data-value=interview]').click();
      speakerInput.value='4';renderPrepareSelects();setPrepareMode('import');
      if(new FormData(prepareForm).get('meeting-speakers')!=='4' || !prepareForm.querySelector('[data-prepare-processing] [name="meeting-speakers"]')) errors.push('prepare: processing values lost when moving fields');
      if(new FormData(prepareForm).get('summary-template')!=='interview'||!prepareForm.querySelector('[data-prepare-processing] [name="summary-template"]')) errors.push('prepare: meeting template missing from import');
      setPrepareMode('record');prepareForm.querySelector('[name="summary-template"]').value='general';prepareForm.querySelector('[name="meeting-speakers"]').value=previousSpeakers;renderPrepareSelects();
      const phoneId='a'.repeat(32),secondPhoneId='c'.repeat(32),oldPhoneId='b'.repeat(32);
      const phones=[{id:phoneId,name:'Phone <test>',connected:true,captureReady:true},{id:secondPhoneId,name:'Pixel 9',connected:true,captureReady:true},{id:oldPhoneId,name:'Old phone',connected:true,captureReady:false}];
      localStorage.setItem('brevia-capture-mode','mic');
      setPrepareMode('record');
      if(currentCaptureMode!=='both'||!captureModeInputs().mic||!captureModeInputs().system) errors.push('capture: new meetings must default to microphone and system audio');
      updateCapturePhones(phones);
      const sourceRows=()=>[...prepareForm.querySelectorAll('.compose-source-switch [role="radio"]')];
      if(sourceRows().length!==4||prepareForm.querySelector('[data-flow-select-choice="capture-mode"][data-value="auto"]')) errors.push('capture: expected four source options without automatic mode');
      if(!prepareForm.querySelector('#phone-device-setting').hidden||prepareForm.querySelector('#mic-device-setting').hidden) errors.push('phone: device dropdown visible before selecting phone source');
      if(!prepareForm.querySelector('.compose-device-routes [data-capture-phone]')) errors.push('phone: connection entry missing from input inspector');
      prepareForm.querySelector('[data-flow-select-choice="capture-mode"][data-value="phone"]').click();
      const phoneInput=()=>prepareForm.querySelector('[name="phone-device"]');
      if(prepareForm.querySelector('#phone-device-setting').hidden||!prepareForm.querySelector('#mic-device-setting').hidden) errors.push('phone: wrong device dropdown for the selected source');
      const unavailable=prepareForm.querySelector('[data-flow-select-choice="phone-device"][data-value="'+oldPhoneId+'"]');
      if(!unavailable?.disabled||!unavailable.textContent.includes(t('未就绪'))) errors.push('phone: unavailable devices can be selected');
      const named=prepareForm.querySelector('[data-flow-select-choice="phone-device"][data-value="'+phoneId+'"]');
      if(!named.textContent.includes('Phone <test>')||named.querySelector('test')) errors.push('phone: device names are not escaped');
      prepareForm.querySelector('[data-flow-select-choice="phone-device"][data-value="'+secondPhoneId+'"]').click();
      const inputs=captureModeInputs();
      if(phoneInput().value!==secondPhoneId||inputs.phone!==secondPhoneId||inputs.mic||inputs.system||sourceRows().filter(row=>row.getAttribute('aria-checked')==='true').length!==1) errors.push('phone: expected exactly one selected device and source');
      phonePreviewLevel=0.5;renderPrepareAudioSources();
      const phoneMeter=prepareForm.querySelector('#mic-level');
      breviaClient.onLevel('mic',1);
      if(prepareForm.querySelector('#mic-input-state > b').textContent!==t('手机麦克风')||!prepareForm.querySelector('#system-input-state').hidden||phoneMeter.style.getPropertyValue('--level')!=='0.5'||prepareForm.querySelector('#mic-input-label').textContent!==t('输入良好')) errors.push('phone: meter uses desktop microphone instead of the selected phone');
      applyLanguage('de');
      if(phoneInput().value!==secondPhoneId||currentCaptureMode!=='phone') errors.push('phone: language change lost the selected phone');
      updateCapturePhones(phones.filter(device=>device.id!==secondPhoneId));
      if(phoneInput().value!==secondPhoneId||!prepareForm.querySelector('.primary-action').disabled) errors.push('phone: disconnection silently selected a different device');
      prepareForm.querySelector('[data-flow-select-choice="phone-device"][data-value="'+phoneId+'"]').click();
      if(captureModeInputs().phone!==phoneId||prepareForm.querySelector('.primary-action').disabled) errors.push('phone: manual selection did not recover recording');
      updateCapturePhones(phones);
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']){
        applyLanguage(code);
        for(const mode of ['both','phone']){
          renderCaptureMode(mode);
          const sources=sourceRows();
          const columns=new Set(sources.map(radio=>Math.round(radio.getBoundingClientRect().left)));
          const rows=new Set(sources.map(radio=>Math.round(radio.getBoundingClientRect().top)));
          if(columns.size!==4||rows.size!==1)errors.push(code+': recording sources are not one horizontal row');
          for(const radio of sources){
            const icon=radio.querySelector('.interface-icon').getBoundingClientRect();
            if(Math.abs(icon.width-icon.height)>0.1||icon.width<13.9) errors.push(code+': recording source icon was squeezed');
            if(radio.scrollWidth>radio.clientWidth+1) errors.push(code+': recording source text overflows');
          }
          if(sources.some(radio=>!radio.title.trim()))errors.push(code+': recording source title is missing');
          if(sources.filter(radio=>radio.getAttribute('aria-checked')==='true').length!==1)errors.push(code+': recording source selection is ambiguous');
          const meter=prepareForm.querySelector('.capture-status');
          const start=prepareForm.querySelector('.primary-action');
          const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;const mr=meter.getBoundingClientRect(),sr=start.getBoundingClientRect(),sourceBounds=prepareForm.querySelector('fieldset').getBoundingClientRect();if(!visible(meter)||!visible(start)||overlaps(mr,sr)||overlaps(sourceBounds,mr)||overlaps(sourceBounds,sr))errors.push(code+'/'+mode+': sources, audio levels or start button overlap');
        }
      }
      applyLanguage('zh');
      updateCapturePhones([]);renderCaptureMode('phone');
      if(!prepareForm.querySelector('.primary-action').disabled||!prepareForm.querySelector('#phone-device-mount .flow-select-toggle').disabled) errors.push('phone: empty device list permits recording');
      if(!prepareForm.querySelector('.compose-device-routes [data-capture-phone]')) errors.push('phone: connection entry missing without connected devices');
      setPrepareMode('record');
      if(currentCaptureMode!=='both'||!prepareForm.querySelector('#phone-device-setting').hidden) errors.push('capture: starting another meeting did not restore the default source');
      const data=await window.brevia.initialize();const meeting=await window.brevia.meeting.get({meeting_id:data.meetings[0].id});
      summaryGeneratingMeetingId=undefined;applyBackendDetail(meeting);await showView('detail');await new Promise(resolve=>setTimeout(resolve,350));
      uiData.detail.summary={markdown:'# Review\\n\\nSaved memo',hasFull:true};detailActiveTab='summary';renderMeetingDetail();setDetailLayoutMode('transcript');
      const detail=document.getElementById('detail-view');
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']){
        applyLanguage(code);
        for(const action of ['data-open-summary-edit','data-copy-summary','data-regenerate-summary']){
          const button=[...detail.querySelectorAll('['+action+']')].find(visible);
          if(!button||!visible(button)||!button.textContent.trim()) errors.push(code+': action not visible '+action);
        }
      }
      applyLanguage('zh');
      const player=detail.querySelector('.player'),source=player.querySelector('.player-source');
      if(!source.contains(playerTime)||!source.contains(playerDuration)||!source.textContent.includes('/')) errors.push('playback times separated');
      if (![...player.querySelectorAll('.player-actions .skip')].every(visible) || player.querySelectorAll('.player-actions .skip').length!==2) errors.push('15-second transport controls unreachable');
      if(!visible(detail.querySelector('[data-detail-panel=summary]'))) errors.push('summary reading panel hidden');
      if(!visible(detail.querySelector('[data-export-detail]'))) errors.push('export action occluded');
      const exportButton=detail.querySelector('[data-export-detail]').getBoundingClientRect();
      if(exportButton.top<detail.getBoundingClientRect().top||exportButton.right>detail.getBoundingClientRect().right)errors.push('export outside fixed header');
      detail.querySelector('[data-open-summary-edit]').click();
      for(const action of ['data-cancel-inline-summary-edit','data-save-inline-summary']) if(!visible(detail.querySelector('['+action+']'))) errors.push('edit footer outside viewport');
      if(parseFloat(getComputedStyle(detail.querySelector('.notes-editor')).fontSize)!==15) errors.push('document editor font');
      inlineSummaryEditor.setMode('markdown');
      if(!getComputedStyle(detail.querySelector('.notes-input')).fontFamily.includes('monospace')) errors.push('Markdown source must use monospace');
      detail.querySelector('[data-cancel-inline-summary-edit]').click();
      for(const theme of ['light','dark']){
        applyTheme(theme);
        const expected=getComputedStyle(document.body).getPropertyValue('--color-surface').trim();
        const canvasProbe=document.createElement('span');canvasProbe.style.backgroundColor=expected;document.body.append(canvasProbe);
        const canvasColor=getComputedStyle(canvasProbe).backgroundColor;canvasProbe.remove();
        if(getComputedStyle(document.body).backgroundColor!==canvasColor||getComputedStyle(player).backgroundColor!==canvasColor) errors.push(theme+': canvas background');
        if(getComputedStyle(document.querySelector('.sidebar .new-meeting')).backgroundColor!=='rgba(0, 0, 0, 0)') errors.push(theme+': legacy navigation fill');
      }
      applyTheme('light');applyBackendDetail(meeting);
      openOnboardingPermissions();await new Promise(resolve=>setTimeout(resolve,150));
      for(const status of onboardingPage.querySelectorAll('.permission-status.is-granted')){
        const mark=getComputedStyle(status.querySelector('.check-icon'));
        if(mark.backgroundColor==='rgba(0, 0, 0, 0)'||mark.borderRadius!=='50%') errors.push('granted status lacks filled check');
      }
      await dismissOnboardingPage();
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(visualFeedback.result?.value) && visualFeedback.result.value.length === 0,
    `本轮视觉反馈回归：${JSON.stringify(visualFeedback.result?.value || visualFeedback.exceptionDetails)}`,
  );

  // 重点在富文本/Markdown 往返时不丢原文，展开与回放跳转互不干扰。
  const highlightChecks = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const previousView=activeView;await showView('live');const errors=[],host=document.createElement('div');
      document.body.append(host);host.style.cssText='position:fixed;left:200px;top:100px;width:500px;height:500px;z-index:9999;background:white';
      let changes=0;
      const notes=createNotesEditor(host,{onInput:()=>changes++,getHighlightTime:()=>1200});
      notes.setMarkdown('普通笔记');
      const quote='明确验收范围，保留完整原文 <unsafe> **plain** '.repeat(12).trim();
      if(!notes.addHighlight(1200,quote)||notes.addHighlight(1200,quote)||notes.addHighlight(-1,quote))errors.push('highlight validation/dedup');
      const markdown=notes.getMarkdown();
      if(markdown!=='普通笔记\\n\\n'+noteHighlightMarkdown(1200,quote)||changes!==1)errors.push('highlight round trip '+markdown);
      notes.setMode('markdown');notes.setMode('rich');
      if(notes.getMarkdown()!==markdown)errors.push('mode switch loses anchor');
      const row=host.querySelector('[data-note-highlight]'),body=row.querySelector('.note-highlight-body'),toggle=row.querySelector('[data-note-highlight-toggle]');
      if(!body.hidden||row.querySelector('img,strong'))errors.push('highlight text unsafe or expanded');
      toggle.click();if(body.hidden||toggle.getAttribute('aria-expanded')!=='true')errors.push('expand');
      toggle.click();if(!body.hidden)errors.push('collapse');
      const textNode=host.querySelector('.notes-editor p').firstChild,selection=getSelection(),range=document.createRange();
      host.querySelector('.notes-editor').focus();range.selectNodeContents(textNode);selection.removeAllRanges();selection.addRange(range);
      host.querySelector('[data-notes-command="highlight"]').click();
      if(!notes.getMarkdown().includes(noteHighlightMarkdown(1200,'普通笔记')))errors.push('selected note not marked');
      if(!notes.addHighlight(1200,'同一时刻的另一条重点'))errors.push('same time different text lost');
      notes.destroy();host.remove();selection.removeAllRanges();
      const audio=playerAudio,oldSrc=audio.getAttribute('src'),oldMax=progress.max;
      const bytes=new Uint8Array(32044),view=new DataView(bytes.buffer);
      for(const [offset,value]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);
      for(const [offset,value]of [[4,32036],[16,16],[24,8000],[28,16000],[40,32000]])view.setUint32(offset,value,true);
      for(const [offset,value]of [[20,1],[22,1],[32,2],[34,16]])view.setUint16(offset,value,true);
      const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
      const loaded=new Promise((resolve,reject)=>{audio.addEventListener('loadedmetadata',resolve,{once:true});audio.addEventListener('error',reject,{once:true});});
      audio.src=url;audio.load();await loaded;
      const playback=document.createElement('div');playback.className='detail-notes-content';playback.innerHTML=renderMarkdown(noteHighlightMarkdown(1200,quote));finalTranscript.append(playback);
      audio.pause();playback.querySelector('[data-note-seek]').click();
      if(Math.abs(audio.currentTime-1.2)>.01||!audio.paused)errors.push('paused seek');
      await audio.play();playback.querySelector('[data-note-seek]').click();
      if(Math.abs(audio.currentTime-1.2)>.1||audio.paused)errors.push('playing seek');
      playback.querySelector('[data-note-highlight-toggle]').click();
      if(audio.paused)errors.push('expand pauses playback');
      audio.pause();playback.remove();if(oldSrc)audio.src=oldSrc;else audio.removeAttribute('src');audio.load();progress.max=oldMax;URL.revokeObjectURL(url);
      await showView(previousView);return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  check(
    Array.isArray(highlightChecks.result?.value) && !highlightChecks.result.value.length,
    '重点笔记与回放：' +
      JSON.stringify(highlightChecks.result?.value || highlightChecks.exceptionDetails),
  );

  // 底栏工具与收起侧栏在最小窗口和双语主题下都保留稳定位置。
  const liveToolbarErrors = [];
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 100 });
  for (const width of [880, 1280]) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const result = await client.send('Runtime.evaluate', {
      expression: `(async()=>{
        const errors=[],previousView=activeView,previousActive=meetingActive;
        const cards=[...taskCards.children].map(card=>[card,card.hidden]);
        for(const [card] of cards)card.hidden=true;
        meetingActive=true;await showView('live');document.activeElement?.blur();
        const studio=document.querySelector('#live-view'),notes=studio.querySelector('.live-notes'),captions=studio.querySelector('.live-captions');
        const toggle=studio.querySelector('[data-live-transcript-toggle]');
        const editor=notes.querySelector('[contenteditable=true], textarea');
        for(const expanded of [false,true]){
          toggle.click();
          if(toggle.getAttribute('aria-expanded')!==String(expanded)||!notes.checkVisibility()||captions.checkVisibility()!==expanded||!editor?.isConnected)errors.push('persistent notes editor / transcript visibility');
          const toolbar=notes.querySelector('.notes-toolbar'),buttons=[...toolbar.querySelectorAll('button')];
          if(!toolbar.checkVisibility()||!buttons.length||buttons.some(b=>Math.abs(b.getBoundingClientRect().y-buttons[0].getBoundingClientRect().y)>1))errors.push('format controls must stay in one row');
          if(innerWidth>=1280 && toolbar.scrollWidth>toolbar.clientWidth+1)errors.push('default window clips format controls');
          const before=toolbar.getBoundingClientRect().top;
          editor.scrollTop=editor.scrollHeight;
          if(Math.abs(toolbar.getBoundingClientRect().top-before)>1)errors.push('format controls scroll with editor');
        }

        if(studio.querySelector('.control-source'))errors.push('unexpected live input source');
        for(const [code,theme] of Object.keys(catalog).map(code=>[code,code==='zh'?'light':'dark'])){
          applyLanguage(code);applyTheme(theme);renderLiveModelControl();
          await new Promise(resolve=>setTimeout(resolve,300));
          const bar=document.querySelector('.live-control-bar'),r=bar.getBoundingClientRect();
          const tools=[...bar.querySelectorAll('.live-caption-controls .icon-button')].filter(button=>button.getBoundingClientRect().width);
          const primary=bar.querySelector('.control-primary').getBoundingClientRect();
          const secondary=bar.querySelector('.control-secondary').getBoundingClientRect(),style=getComputedStyle(bar);
          if(style.gridTemplateColumns.split(' ').length!==2||Math.abs(secondary.left-r.left-bar.clientLeft-parseFloat(style.paddingLeft))>1||Math.abs(primary.right-r.right+bar.clientLeft+parseFloat(style.paddingRight))>1||Math.abs(primary.top+primary.height/2-secondary.top-secondary.height/2)>1)errors.push(code+': recording groups must align with both bar edges on one row');
          for(const button of tools){const b=button.getBoundingClientRect();if(b.left<r.left||b.right>primary.left||b.bottom>r.bottom||b.width<32||!button.getAttribute('aria-label')||!button.querySelector('svg'))errors.push(code+': tool bounds/label');}
          if(bar.scrollWidth>bar.clientWidth+1||primary.right>r.right)errors.push(code+': toolbar overflow');
          let footerPosition;
          for(const withTask of [false,true]){
            refinementCard.hidden=!withTask;syncTaskCardStack();
            const footer=document.querySelector('.sidebar-footer'),footerBounds=footer.getBoundingClientRect(),sidebar=document.querySelector('.sidebar').getBoundingClientRect();
            const footerControls=[document.querySelector('#recently-deleted')];
            if(document.querySelectorAll('.window-settings').length!==1||document.querySelector('.sidebar-settings')||!document.querySelector('.navigation-brand #all-meetings')?.checkVisibility())errors.push(code+': duplicate or missing navigation entry');
            const footerRects=footerControls.map(control=>control.getBoundingClientRect());
            const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
            if(footerBounds.bottom>sidebar.bottom+1||sidebar.bottom-footerBounds.bottom>32||footerControls.some((control,index)=>{const r=footerRects[index];return !footer.contains(control)||!control.checkVisibility()||r.width<28||r.height<28||r.left<footerBounds.left-1||r.right>footerBounds.right+1||r.top<footerBounds.top-1||r.bottom>footerBounds.bottom+1||!((control.getAttribute('aria-label')||control.title||control.textContent).trim())||footerRects.some((other,j)=>j<index&&overlap(r,other));}))errors.push(code+': sidebar footer '+withTask);
            if(footerRects.some(r=>Math.abs((r.top+r.bottom-footerRects[0].top-footerRects[0].bottom)/2)>1))errors.push(code+': sidebar footer controls are not aligned in one row');
            if(footerPosition&&Math.abs(footerPosition-footerBounds.top)>1)errors.push(code+': task state moved sidebar footer');
            footerPosition=footerBounds.top;
            const statusbar=document.querySelector('#desktop-statusbar'),statusBounds=statusbar.getBoundingClientRect();
            if(Math.abs(statusBounds.height-24)>1||Math.abs(statusBounds.bottom-innerHeight)>1||statusBounds.left>1||Math.abs(statusBounds.width-innerWidth)>1)errors.push(code+': status bar geometry');
            for(const control of [document.querySelector('#mobile-nav'),document.querySelector('[data-task-summary]')].filter(control=>control.checkVisibility())){const r=control.getBoundingClientRect();if(!statusbar.contains(control)||r.left<statusBounds.left-1||r.right>statusBounds.right+1||r.top<statusBounds.top-1||r.bottom>statusBounds.bottom+1)errors.push(code+': status control outside bar');}
            if(withTask){
              const summary=document.querySelector('[data-task-summary]');if(taskCards.classList.contains('is-collapsed'))summary.click();
              const bounds=taskCards.getBoundingClientRect();if(!taskCards.checkVisibility()||bounds.left<0||bounds.right>innerWidth+1||bounds.top<0||bounds.bottom>statusBounds.top)errors.push(code+': task popover outside viewport');
              summary.click();
            }
          }
          document.querySelector('#translation-toggle').click();
          const options=document.querySelector('#translation-options').getBoundingClientRect(),toggle=document.querySelector('#translation-toggle').getBoundingClientRect();
          if(options.bottom>toggle.top||options.top<0||options.right>innerWidth)errors.push(code+': translation popup bounds');
          document.body.click();
          for(const id of ['floating-caption-toggle','translation-toggle','live-model-toggle','mark-important']){
            const button=document.getElementById(id);
            if(!button.getClientRects().length)continue;
            if(button.textContent.trim())errors.push(code+': icon has visible text '+id);
            button.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
            if(!pageTooltip||pageTooltip.hidden||pageTooltip.textContent!==button.dataset.tooltip||button.dataset.tooltip!==button.getAttribute('aria-label'))errors.push(code+': localized tooltip '+id);
            if(!['zh','ja'].includes(code)&&/[\u4e00-\u9fff]/.test(button.dataset.tooltip))errors.push(code+': untranslated tooltip '+id);
            button.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));
          }
          const model=document.querySelector('#live-model-toggle'),modelOptions=document.querySelector('#live-model-options');
          if(model.getClientRects().length){
            model.click();
            const bounds=modelOptions.getBoundingClientRect();
            if(bounds.width<319||bounds.left<0||bounds.right>innerWidth)errors.push(code+': model menu too narrow');
            const transcript=document.querySelector('#transcript-scroll');
            const marker=document.createElement('div');marker.innerHTML=renderTranscriptSegment({text:'持续刷新字幕',time:'00:01',startSeconds:1,endSeconds:2,speaker:{}});marker.style.height='200px';transcript.append(marker);transcript.scrollTop=transcript.scrollHeight;
            transcript.dispatchEvent(new Event('scroll'));await new Promise(resolve=>requestAnimationFrame(resolve));marker.remove();
            renderLiveModelControl();
            if(modelOptions.hidden||model.getAttribute('aria-expanded')!=='true')errors.push(code+': transcript update closed model menu');
            modelOptions.dispatchEvent(new Event('scroll'));
            if(modelOptions.hidden)errors.push(code+': model menu scroll closed itself');
            document.dispatchEvent(new Event('scroll'));
            if(!modelOptions.hidden||model.getAttribute('aria-expanded')!=='false')errors.push(code+': viewport scroll left stale anchor');
          }
        }
        for(const [card,hidden] of cards)card.hidden=hidden;
        syncTaskCardStack();applyLanguage('zh');applyTheme('light');
        meetingActive=previousActive;await showView(previousView);
        return errors;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (!Array.isArray(result.result?.value) || result.result.value.length)
      liveToolbarErrors.push({ width, result });
  }
  await client.send('Emulation.clearDeviceMetricsOverride');
  check(!liveToolbarErrors.length, '会议底栏与侧栏定位：' + JSON.stringify(liveToolbarErrors));

  const remainingAlignment = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      await showView('detail');
      const originalMuted=playerAudio.muted;
      document.querySelector('#player-mute').click();
      await new Promise(resolve=>setTimeout(resolve,50));
      if(playerAudio.muted===originalMuted||document.querySelector('#player-mute').getAttribute('aria-pressed')!==String(playerAudio.muted)) errors.push('mute action');
      document.querySelector('#player-mute').click();
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']){applyLanguage(code);if(document.querySelector('#player-mute').getAttribute('aria-label')!==t('静音'))errors.push(code+': mute label');}
      applyLanguage('zh');
      for(const state of ['saved','dirty','saving','failed']){
        const host=document.createElement('div');host.innerHTML=renderSaveState(state);document.body.append(host);
        const mark=host.querySelector('.save-state-mark'),style=getComputedStyle(mark);
        if(state==='saved' && (!mark.querySelector('svg')||style.backgroundColor==='rgba(0, 0, 0, 0)')) errors.push('saved circular check');
        if(state==='dirty' && Math.abs(parseFloat(style.width)-8)>.1) errors.push('dirty dot');
        if(state==='saving' && style.animationName!=='save-state-spin') errors.push('saving spinner');
        if(state==='failed' && mark.textContent!=='!') errors.push('failure mark');
        host.remove();
      }
      await showView('settings');await openModal('storage');
      const list=settingsModal.querySelector('.storage-list'),rows=[...list.querySelectorAll('.preferences-danger-row')];
      if(rows.length!==2 || list.clientHeight<rows.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)-1) errors.push('storage rows clipped');
      for(const row of rows){
        const bounds=row.getBoundingClientRect(),copy=row.querySelector('.preference-copy'),control=row.querySelector('[data-clear-storage]');
        const text=copy.getBoundingClientRect(),action=control.getBoundingClientRect();
        if(!control.checkVisibility() || text.left<bounds.left-1 || text.right>action.left+1 || action.right>bounds.right+1 || action.top<bounds.top-1 || action.bottom>bounds.bottom+1 || copy.scrollWidth>copy.clientWidth+1)errors.push('storage row action clipped');
      }
      if(!settingsModal.querySelector('.storage-usage-bar')||!settingsModal.querySelector('[data-cleanup-storage]')) errors.push('storage usage/cleanup');
      const bar=settingsModal.querySelector('.storage-usage-bar');
      if(!systemDiskUsage || Math.abs(Number(bar.getAttribute('aria-valuenow'))-systemDiskUsage.used/systemDiskUsage.total*100)>.1 || !bar.getAttribute('aria-valuetext').includes(formatBytes(systemDiskUsage.total))) errors.push('disk usage not real');
      if(storageUsage && !settingsModal.querySelector('.storage-app-usage').textContent.includes(formatBytes(storageUsage.meetings))) errors.push('app usage not real');
      const clear=settingsModal.querySelector('[data-clear-storage="meetings"]');
      clear.scrollIntoView({block:'nearest'});await new Promise(resolve=>requestAnimationFrame(resolve));
      const clearBounds=clear.getBoundingClientRect(),storageViewport=settingsModal.querySelector('.modal-body').getBoundingClientRect();
      if(clearBounds.top<storageViewport.top-1 || clearBounds.bottom>storageViewport.bottom+1)errors.push('storage clear action unreachable');
      clear.click();
      if(!storageConfirmationPage||!storageConfirmationPage.page.querySelector('.storage-usage-bar')||!storageConfirmationPage.page.inert)errors.push('storage confirmation lost page');
      settingsModal.querySelector('[data-cancel-confirmation]').click();
      if(activeModal!=='storage'||document.activeElement!==clear||!settingsModal.querySelector('.storage-usage-bar'))errors.push('storage confirmation return');
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));await showView('home');
      const originalWorkspace=activeWorkspaceId,workspace=workspaces.find(w=>w.id===originalWorkspace)||workspaces[0];
      if(workspace){
        await switchWorkspace(workspace.id);
        const trigger=document.querySelector('[data-edit-sidebar-workspace="'+workspace.id+'"]');
        trigger.click();
        await new Promise(resolve=>setTimeout(resolve,150));
        const popup=document.querySelector('.workspace-dialog:popover-open');
        if(!popup||!popup.querySelector('[data-delete-workspace]')||popup.querySelector('[name=name]').value!==workspace.name||popup.getBoundingClientRect().bottom>innerHeight)errors.push('workspace edit popover');
        const name=popup.querySelector('[name=name]'),desc=popup.querySelector('[name=description]');name.value='draft name';desc.value='draft description';const erase=popup.querySelector('[data-delete-workspace]');erase.click();
        if(!settingsModal.matches(':popover-open')||!popup.matches(':popover-open')||document.querySelector('.app-shell').inert)errors.push('workspace deletion replaced draft editor');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        if(!settingsModal.hidden||!popup.matches(':popover-open')||name.value!=='draft name'||desc.value!=='draft description')errors.push('workspace deletion cancelled but draft lost');
        document.querySelector('.workspace-dialog [data-close-modal]').click();toast.classList.remove('visible');await new Promise(resolve=>setTimeout(resolve,250));await switchWorkspace(originalWorkspace);
      }
      return errors;
    })()`,
    userGesture: true,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(remainingAlignment.result?.value) && !remainingAlignment.result.value.length,
    `静音/保存状态/工作区浮窗/存储分组回归：${JSON.stringify(remainingAlignment.result?.value || remainingAlignment.exceptionDetails)}`,
  );

  const fullscreen = await client.send(
    'Runtime.evaluate',
    {
      expression: `(async()=>{
      await showView('detail'); const errors=[];
      for(const entering of [true,false]) {
        const changed=new Promise(resolve=>document.addEventListener('fullscreenchange',resolve,{once:true}));
        document.querySelector('#player-fullscreen').click(); await changed;
        await new Promise(resolve=>requestAnimationFrame(resolve));
        if((document.fullscreenElement?.id||null)!==(entering?'detail-view':null)||document.querySelector('#player-fullscreen').getAttribute('aria-pressed')!==String(entering))errors.push({entering});
      } return errors;
    })()`,
      userGesture: true,
      awaitPromise: true,
      returnByValue: true,
    },
    25000,
  );
  check(
    Array.isArray(fullscreen.result?.value) && !fullscreen.result.value.length,
    '播放器全屏交互：' + JSON.stringify(fullscreen.result?.value || fullscreen.exceptionDetails),
  );

  const agentSettingsFlow = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
      const wait=async(predicate)=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('settings save timed out');await pause();}};
      const originalPrompts=await window.brevia.prompts.get();
      const originalAgent=await window.brevia.agent.settings.get();
      try {
        await window.brevia.agent.settings.save({enabled:false,permissions:{read:true,infer:false,record:false}});
        await showView('settings');await openModal('agent-settings');
        if(settingsModal.querySelector('[role=switch],[data-agent-permission]'))errors.push('retired agent permission switches remain');
        if(['guide','mcp','cli'].some(kind=>!settingsModal.querySelector('[data-agent-copy="'+kind+'"]')))errors.push('agent integration copy missing');
        if(settingsModal.querySelectorAll('[data-agent-copy=prompt]').length!==3)errors.push('agent prompt examples missing');
        const guide=agentSetupGuide();
        if(!agentSettings.skill_path||!guide.includes(agentSettings.skill_path)||!guide.includes(agentSettings.cli_path)||!guide.includes(agentSettings.mcp.env.BREVIA_DATA_DIR)||!guide.includes('status --no-start'))errors.push('agent guide missing actual local setup paths');
        const enable=settingsModal.querySelector('[data-agent-enable]');
        if(!enable)errors.push('legacy agent access cannot be enabled');
        else {
          enable.click();
          await wait(()=>!agentSettingsBusy);
          const enabled=await window.brevia.agent.settings.get();
          if(!enabled.enabled||['read','infer','record'].some(key=>!enabled.permissions[key]))errors.push('agent access not fully enabled');
          if(settingsModal.querySelector('[data-agent-enable]'))errors.push('agent enable control is stale');
        }
        const navigation=settingsModal.querySelector('.settings-navigation');
        if(document.querySelector('[data-settings-page=prompts],[data-modal=prompts]'))errors.push('retired prompt navigation remains reachable');
        const search=navigation.querySelector('[data-settings-search]');
        search.value=t('提示词');search.dispatchEvent(new Event('input',{bubbles:true}));
        if([...navigation.querySelectorAll('[data-settings-page]')].some(button=>button.checkVisibility()))errors.push('retired prompt settings appears in search');
        search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
        const page=settingsModal.querySelector('.agent-settings');
        const stateBefore={activeModal,activeView,modalRequestRevision,contentKind:settingsModal.querySelector('.modal-body').dataset.contentKind};
        await openModal('prompts');
        const stateAfter={activeModal,activeView,modalRequestRevision,contentKind:settingsModal.querySelector('.modal-body').dataset.contentKind};
        if(JSON.stringify(stateAfter)!==JSON.stringify(stateBefore)||settingsModal.querySelector('.agent-settings')!==page||!page.checkVisibility())errors.push('retired prompt route changed the current settings page');
        if(JSON.stringify(await window.brevia.prompts.get())!==JSON.stringify(originalPrompts))errors.push('retiring prompt settings changed stored overrides');
        return errors;
      } finally {
        await window.brevia.agent.settings.save({enabled:originalAgent.enabled,permissions:originalAgent.permissions});
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    !agentSettingsFlow.exceptionDetails,
    'Agent settings and retired prompt route threw: ' +
      JSON.stringify(agentSettingsFlow.exceptionDetails),
  );
  check(
    !agentSettingsFlow.result?.value?.length,
    'Agent settings and retired prompt route: ' + JSON.stringify(agentSettingsFlow.result?.value),
  );
  if (process.env.BREVIA_SETTINGS_CAPTURE_DIR) {
    const output = path.resolve(process.env.BREVIA_SETTINGS_CAPTURE_DIR);
    mkdirSync(output, { recursive: true });
    for (const [appearance, width, language] of [
      ['light', 1280, 'zh'],
      ['dark', 1280, 'en'],
      ['light', 760, 'ru'],
    ]) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 850,
        deviceScaleFactor: 1,
        mobile: false,
      });
      for (const kind of ['agent-settings']) {
        const layout = await client.send('Runtime.evaluate', {
          expression: `(async()=>{applyLanguage(${JSON.stringify(language)});applyTheme(${JSON.stringify(appearance)});await showView('settings');await openModal(${JSON.stringify(kind)});await new Promise(r=>setTimeout(r,260));const panel=settingsModal.querySelector('.modal-body');return {overflow:document.body.scrollWidth>innerWidth+1,contentOverflow:panel.scrollWidth>panel.clientWidth+1,visible:settingsModal.checkVisibility()};})()`,
          awaitPromise: true,
          returnByValue: true,
        });
        check(
          !layout.exceptionDetails &&
            layout.result?.value?.visible &&
            !layout.result.value.overflow &&
            !layout.result.value.contentOverflow,
          `settings capture layout ${kind}/${width}: ` + JSON.stringify(layout),
        );
        const shot = await client.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        writeFileSync(
          path.join(output, `${kind}-${appearance}-${width}-${language}.png`),
          Buffer.from(shot.data, 'base64'),
        );
      }
    }
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Runtime.evaluate', {
      expression: "applyLanguage('zh');applyTheme('light');",
      returnByValue: true,
    });
  }

  const designStates = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      const sidebar=document.querySelector('.sidebar'),libraryToggle=document.querySelector('#library-toggle'),shell=document.querySelector('.app-shell');
      for(const collapsed of [false,true]){
        await showView('home');
        if(shell.classList.contains('is-library-hidden')!==collapsed)libraryToggle.click();
        await showView('settings');await new Promise(resolve=>setTimeout(resolve,260));
        if(Math.abs(sidebar.getBoundingClientRect().width)>1||sidebar.querySelector('.meeting-list').checkVisibility({visibilityProperty:true})||Math.abs(document.querySelector('.workspace').getBoundingClientRect().left)>1||shell.classList.contains('is-library-hidden')!==collapsed)errors.push('settings did not replace meeting navigation or changed collapse preference');
        await openModal('models');
        const back=settingsModal.querySelector('.settings-workspace-back');
        if(!back?.checkVisibility())errors.push('settings return action missing');
        else{back.click();await pageTransition;await new Promise(resolve=>setTimeout(resolve,260));}
        if(activeView!=='home'||!settingsModal.hidden||shell.classList.contains('is-library-hidden')!==collapsed||Math.abs(sidebar.getBoundingClientRect().width-(collapsed?0:innerWidth<=1050?240:260))>1)errors.push('settings return did not preserve sidebar preference '+collapsed);
      }
      if(shell.classList.contains('is-library-hidden'))libraryToggle.click();
      await showView('settings');
      const navigation=document.querySelector('#settings-view .settings-navigation');
      const settingPages=[...navigation.querySelectorAll('[data-settings-page]')].map(button=>button.dataset.settingsPage).sort();
      const expectedPages=['general','advanced-settings','whats-new','models','ai-features','speaker-profiles','device-connection','agent-settings','storage'].sort();
      if(JSON.stringify(settingPages)!==JSON.stringify(expectedPages)) errors.push('general navigation '+JSON.stringify(settingPages));
      const search=navigation.querySelector('[data-settings-search]');
      search.value=t('模型库');search.dispatchEvent(new Event('input',{bubbles:true}));
      const matches=[...navigation.querySelectorAll('[data-settings-page]')].filter(button=>button.checkVisibility());
      if(matches.length!==1||matches[0].dataset.settingsPage!=='models'||activeView!=='settings')errors.push('settings search does not filter navigation in place');
      search.value='__absent__';search.dispatchEvent(new Event('input',{bubbles:true}));
      if(!navigation.querySelector('.settings-search-empty').checkVisibility())errors.push('settings search missing empty state');
      search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
      if([...navigation.querySelectorAll('[data-settings-page]')].some(button=>!button.checkVisibility()))errors.push('settings search clearing did not restore navigation');
      await openModal('models');
      // 设置目录替代会议导航，切换分区保持内容起点。
      await new Promise(requestAnimationFrame);
      const general=document.querySelector('.settings-general-main').getBoundingClientRect();
      const panel=settingsModal.querySelector('.modal-panel').getBoundingClientRect();
      if(Math.abs(general.left-panel.left)>1 || Math.abs(navigation.getBoundingClientRect().width-settingsModal.querySelector('.preferences-navigation').getBoundingClientRect().width)>1) errors.push('settings content origin changed');
      if(!settingsModal.querySelector('.rating-scale') || settingsModal.querySelector('.rating-scale').children.length!==1) errors.push('rating is not continuous');
      settingsModal.querySelector('[data-model-library-tab="available"]').click();
      const modelRows=[...settingsModal.querySelectorAll('.preferences-model-row')];
      if(!modelRows.length) errors.push('available models missing');
      for(const row of modelRows){
        if(!row.querySelector('[data-download-model], [data-pause-required]')) errors.push('available model action missing');
        if(row.scrollWidth>row.clientWidth+1) errors.push('model card overflow');
      }
      const grid=settingsModal.querySelector('.preferences-model-rows');
      if(grid && getComputedStyle(grid).gridTemplateColumns.split(' ').length !== (grid.clientWidth>=650 ? 2 : 1))errors.push('model library column count');
      const intro=modelRows[0]?.querySelector('.model-intro');
      if(intro){
        intro.open=true;
        const id=intro.dataset.modalDetail;
        renderModelLibrary();
        if(![...settingsModal.querySelectorAll('details[open]')].some(node=>node.dataset.modalDetail===id))errors.push('model introduction closed after refresh');
      }
      const cardId=settingsModal.querySelector('[data-download-model]')?.dataset.downloadModel;
      if(cardId){
        try{
          modelDownloads.set(cardId,{received:0,total:0});
          renderModelLibrary();
          const card = settingsModal.querySelector('[data-model-card="' + CSS.escape(cardId) + '"]');
          const pause = card.querySelector('[data-pause-required]');
          const details = card.querySelector('details');
          if(details)details.open=true;
          pause.focus({preventScroll:true});
          modelDownloads.set(cardId,{received:25,total:100});scheduleModelLibraryRender(cardId);
          await new Promise(requestAnimationFrame);
          if(!pause.isConnected||document.activeElement!==pause||(details&&!details.open)||card.querySelector('progress').value!==25)errors.push('model transfer refresh replaced focus or stale value');
          modelDownloads.set(cardId,{received:25,total:100,paused:true});refreshModelCardProgress(cardId);
          if(card.querySelector('[data-pause-required]')!==pause||!pause.title.includes(t('继续'))||!card.querySelector('[data-cancel-required]'))errors.push('paused model lost resume or cancel');
        }finally{
          modelDownloads.delete(cardId);
          renderModelLibrary();
        }
      }
      settingsModal.querySelector('.modal-body').scrollTop=500;
      await openModal('device-connection');
      if(settingsModal.querySelector('.modal-body').scrollTop!==0) errors.push('settings retained previous scroll');
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      await showView('home');
      const deleted=document.getElementById('recently-deleted').getBoundingClientRect();
      const workspace=document.querySelector('.workspace-heading').getBoundingClientRect();
      if(!document.querySelector('.sidebar').contains(document.getElementById('recently-deleted'))||!document.querySelector('.library-panel').contains(document.querySelector('.workspace-heading'))||!document.querySelector('.new-workspace[aria-label]')) errors.push('single sidebar navigation missing');
      await showView('detail');detailActiveTab='notes';renderMeetingDetail();
      document.querySelector('[data-edit-notes]').click();
      const saved=persistNotes;
      try {
        let rejectSave;
        persistNotes=()=>new Promise((resolve,reject)=>rejectSave=reject);
        detailNotesEditor.setMarkdown('# 保留的草稿');updateDetailNotesDraft();
        const draft=detailNotesEditor.getMarkdown();
        document.querySelector('[data-notes-save]').click();
        if(uiData.detail.notesSaveState!=='saving' || !document.querySelector('[data-notes-save]').disabled) errors.push('saving state');
        rejectSave(new Error('fixture: save failed'));
        await new Promise(resolve=>setTimeout(resolve,30));
        if(uiData.detail.notesSaveState!=='failed' || detailNotesEditor.getMarkdown()!==draft || document.querySelector('[data-notes-save]').disabled) errors.push('failure discarded draft');
        const rich=detailNotesEditor.getMarkdown();
        detailNotesEditor.setMode('markdown');detailNotesEditor.setMode('rich');
        if(detailNotesEditor.getMarkdown()!==rich) errors.push('mode lost draft');
        persistNotes=saved;
        document.querySelector('[data-notes-save]').click();
        for(let i=0;i<100&&uiData.detail.notesEditing;i++) await new Promise(resolve=>setTimeout(resolve,30));
        const written=await window.brevia.meeting.get({meeting_id:currentMeetingDetail.id});
        if(uiData.detail.notesEditing || written.notes!==draft || uiData.detail.notesSaveState!=='saved') errors.push('retry did not persist');
      } finally { persistNotes=saved; }
      await openModal('summary-model');
      summaryConfigDraft.provider='built-in';renderModal('summary-model');showSettingsModal();
      const form=settingsModal.querySelector('.summary-model-form');
      const originalPersist=persistSummaryConfig;
      const originalConfig=JSON.stringify(summaryConfig);
      const originalDisabled=form.querySelector('[type="submit"]').disabled;
      try {
        let rejectConfig, saves=0;
        persistSummaryConfig=()=>{saves++;return new Promise((resolve,reject)=>rejectConfig=reject);};
        form.requestSubmit();
        await new Promise(resolve=>setTimeout(resolve,30));
        form.requestSubmit();
        if(saves!==1 || !form.querySelector('[data-save-state="saving"]') || !form.querySelector('[type="submit"]').disabled) errors.push('config pending state');
        rejectConfig(new Error('fixture: config failed'));
        await new Promise(resolve=>setTimeout(resolve,30));
        if(!form.querySelector('[data-save-state="failed"]') || form.querySelector('[type="submit"]').disabled!==originalDisabled || JSON.stringify(summaryConfig)!==originalConfig) errors.push('config failure state');
      } finally {persistSummaryConfig=originalPersist;closeModal();}
      toast.classList.remove('visible');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(designStates.result?.value) && !designStates.result.value.length,
    '第五轮壳层/评级/失败草稿/重试写入：' +
      JSON.stringify(designStates.result?.value || designStates.exceptionDetails),
  );

  const detailExportStates = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      meetingActive=false;await showView('detail');detailActiveTab='notes';setDetailLayoutMode('transcript');renderMeetingDetail();
      document.querySelector('[data-edit-notes]').click();
      const toolbar=document.querySelector('#detail-view .detail-notes-edit .notes-toolbar');
      const first=document.querySelector('#detail-view .notes-editor > :first-child');
      const tabbar=document.querySelector('#detail-view .detail-content-toolbar');
      const editorPanel=document.querySelector('#detail-view .detail-notes-panel');
      const topInset=parseFloat(getComputedStyle(editorPanel).paddingTop);
      if(Math.abs(toolbar.getBoundingClientRect().top-tabbar.getBoundingClientRect().bottom-topInset)>2)errors.push('editor duplicated top padding');
      if(first && first.getBoundingClientRect().top-toolbar.getBoundingClientRect().bottom>32)errors.push('editor heading separated from toolbar');
      if(document.querySelectorAll('.tabbar-tabs [role=tab]').length!==3)errors.push('review navigation changed');
      document.querySelector('[data-notes-cancel]').click();
      for(const code of ['zh','en','es','ja','ko','fr','de','ru']){
        applyLanguage(code);await openModal('export');await document.fonts.ready;
        document.getAnimations().forEach(a=>a.effect.getComputedTiming().iterations===Infinity?a.pause():a.finish());
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const panel=settingsModal.querySelector('.modal-panel'),p=panel.getBoundingClientRect(),trigger=document.querySelector('[data-export-detail]').getBoundingClientRect();
        if(!settingsModal.matches(':popover-open')||document.querySelector('.app-shell').inert||Math.abs(p.right-trigger.right)>2||Math.abs(p.top-trigger.bottom-6)>2||p.bottom>innerHeight+1)errors.push(code+': export anchor or non-modal interaction');
        const buttons=[...panel.querySelectorAll('.export-actions button')];
        const checkActions=()=>{if(buttons.some(b=>{const r=b.getBoundingClientRect();return r.left<p.left||r.right>p.right+1||r.top<p.top||r.bottom>p.bottom+1;}))errors.push(code+': export actions clipped');};
        checkActions();
        for(const picker of panel.querySelectorAll('[data-export-format]')){
          const content=picker.dataset.exportFormat;
          const choices=[...picker.parentElement.querySelectorAll('[data-flow-select-choice]')];
          if(JSON.stringify(choices.map(c=>c.dataset.value))!==JSON.stringify(exportContentFormats[content]))errors.push(code+': missing real formats');
          choices.at(-1).click();
          if(exportSelection[content]!==choices.at(-1).dataset.value)errors.push(code+': format selection disconnected');
        }
        const fields=[...panel.querySelectorAll('[data-export-item]')];
        fields.forEach(f=>{if(f.checked)f.click();});
        if(!panel.querySelector('[data-export-save]').disabled||!panel.querySelector('[data-share-target=copy]').disabled||selectedExportItems().length)errors.push(code+': empty export enabled');
        const audio=panel.querySelector('[data-export-item=audio]');
        if(audio){audio.click();if(!panel.querySelector('[data-share-target=copy]').disabled||selectedExportItems()[0]?.format!=='wav')errors.push(code+': audio export or text availability');}
        fields.forEach(f=>{if(!f.checked)f.click();});
        panel.querySelector('.export-more-share summary').click();checkActions();
        if(!panel.querySelector('[data-share-target=email]')||!panel.querySelector('[data-export-summary]').textContent.trim())errors.push(code+': share channels or packaging hint missing');
        const targets=[...panel.querySelectorAll('[data-share-target]')].map(b=>b.dataset.shareTarget);
        if(new Set(targets).size!==targets.length)errors.push(code+': duplicate share actions');
        if([...panel.querySelectorAll('.share-platform')].some(b=>{const r=b.getBoundingClientRect();return r.height>40||r.width<1||r.right>p.right+1||r.left<p.left-1;}))errors.push(code+': compact share rows overflow');
        if(exportContentMeta().some(item=>item.content==='notes')&&(!panel.querySelector('[data-sync-note]')||!panel.querySelector('[data-group-send]')))errors.push(code+': no local summary workflow or explicit bot action');
        closeModal();
      }
      applyLanguage('zh');
      const originalExport=runExportBundle,originalMeeting=currentMeetingDetail;let complete;
      try{
        runExportBundle=()=>new Promise(resolve=>{complete=resolve;});
        await openModal('export');settingsModal.querySelector('[data-export-save]').click();
        if(typeof complete!=='function')throw Error('export did not start');
        closeModal();currentMeetingDetail={...originalMeeting,title:'other meeting'};await openModal('export');
        complete({count:1});await new Promise(resolve=>setTimeout(resolve,20));
        if(!settingsModal.matches(':popover-open')||!toast.textContent.includes(originalMeeting.title)||toast.textContent.includes('other meeting'))errors.push('stale export completion modified a newer surface or meeting title');
      }finally{runExportBundle=originalExport;currentMeetingDetail=originalMeeting;closeModal();}
      for(const theme of ['light','dark']){
        applyTheme(theme);let actions=0;
        showToast(t('已保存'),{label:t('重试'),run:()=>actions++},'success');
        toast.querySelector('button').click();
        if(actions!==1||toast.classList.contains('visible'))errors.push(theme+': notification action');
        showToast(t('保存失败'),undefined,'error');
        if(toast.querySelector('button')||toast.getAttribute('role')!=='alert')errors.push(theme+': stale notification action');
      }
      applyTheme('light');toast.classList.remove('visible');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(detailExportStates.result?.value) && !detailExportStates.result.value.length,
    `详情几何、八语言导出选项与通知操作：${JSON.stringify(detailExportStates.result?.value || detailExportStates.exceptionDetails)}`,
  );
  const originalViewport = await client.send('Runtime.evaluate', {
    expression: `({width:innerWidth,height:innerHeight})`,
    returnByValue: true,
  });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(880 * defaultWindowScale),
    height: Math.round(640 * defaultWindowScale),
    deviceScaleFactor: 1,
    mobile: false,
  });
  const minimumStates = [
    [
      'detail',
      `(()=>{closeModal();detailActiveTab='notes';setDetailLayoutMode('transcript');renderMeetingDetail();document.querySelector('[data-edit-notes]').click();})()`,
    ],
    [
      'export',
      `(async()=>{document.querySelector('[data-notes-cancel]').click();await openModal('export');})()`,
    ],
    ['export-expanded', `settingsModal.querySelector('.export-more-share summary').click()`],
    [
      'tasks',
      `(async()=>{closeModal();await showView('home');miniMeeting.hidden=false;miniPlayback.hidden=false;showRefinementProgress(42,100,'产品周会',currentMeetingDetail.id,'正在识别');document.querySelector('.workspace-subnav').classList.remove('is-collapsed');syncTaskCardStack(refinementCard);})()`,
    ],
  ];
  for (const [name, expression] of minimumStates) {
    const result = await client.send('Runtime.evaluate', {
      expression: `(async()=>{await (${expression});await document.fonts.ready;document.getAnimations().forEach(a=>a.effect.getComputedTiming().iterations===Infinity?a.pause():a.finish());await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const errors=[];
      if(${JSON.stringify(name)}==='detail'){
        const player=document.querySelector('#detail-view .player'),p=player.getBoundingClientRect();
        for(const selector of ['.play','.player-source','.player-meta','.player-track']){const r=player.querySelector(selector).getBoundingClientRect();if(r.left<p.left-1||r.right>p.right+1||r.top<p.top-1||r.bottom>p.bottom+1)errors.push(selector+' outside player');}
        if(p.top<document.querySelector('#detail-view .detail-layout').getBoundingClientRect().bottom-1)errors.push('player overlaps reading region');
      }else if(${JSON.stringify(name)}==='tasks'){
        const nav=meetingList;nav.scrollTop=0;
        const first=nav.querySelector('.sidebar-workspace-toggle').getBoundingClientRect(),n=nav.getBoundingClientRect();
        if(first.top<n.top||first.bottom>n.bottom+1)errors.push('first workspace clipped by tasks');
        for(const selector of ['#mobile-nav','.window-settings']){const r=document.querySelector(selector).getBoundingClientRect();if(r.bottom>innerHeight+1)errors.push(selector+' outside sidebar');}
      }else{
        const p=settingsModal.querySelector('.modal-panel').getBoundingClientRect();
        for(const selector of ['.export-actions','[data-export-summary]']){const r=settingsModal.querySelector(selector).getBoundingClientRect();if(r.top<p.top||r.bottom>p.bottom+1||r.left<p.left||r.right>p.right+1)errors.push(selector+' outside export');}
      }return errors;})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    check(
      Array.isArray(result.result?.value) && !result.result.value.length,
      `最小窗口 ${name}：${JSON.stringify(result.result?.value || result.exceptionDetails)}`,
    );
    if (process.env.BREVIA_DESIGN_CAPTURE_DIR) {
      const output = path.resolve(process.env.BREVIA_DESIGN_CAPTURE_DIR);
      mkdirSync(output, { recursive: true });
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      writeFileSync(
        path.join(output, `desktop-minimum-${name}.png`),
        Buffer.from(shot.data, 'base64'),
      );
    }
  }
  await client.send('Emulation.clearDeviceMetricsOverride', {});
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 0,
    height: 0,
    deviceScaleFactor: 1 / defaultWindowScale,
    mobile: false,
  });
  await client.send('Runtime.evaluate', {
    expression: `closeModal();toast.classList.remove('visible');miniMeeting.hidden=true;miniPlayback.hidden=true;refinementCard.hidden=true;syncTaskCardStack()`,
  });
  const restoredViewport = await client.send('Runtime.evaluate', {
    expression: `({width:innerWidth,height:innerHeight})`,
    returnByValue: true,
  });
  check(
    JSON.stringify(restoredViewport.result?.value) ===
      JSON.stringify(originalViewport.result?.value),
    '最小窗口检查后必须恢复默认画布',
  );

  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 100 });
  const taskLayoutChecks = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      closeModal();await new Promise(resolve=>setTimeout(resolve,250));
      await showView('home');
      const longTitle='快牛 印尼会议 20260813 — 完整会议标题与进度保留测试';
      showRefinementProgress(42,100,longTitle,currentMeetingDetail.id,'正在识别');
      miniMeeting.hidden=false;miniTitle.textContent=longTitle;miniTimer.textContent='00:12:36';
      miniPlayback.hidden=false;document.querySelector('#mini-playback-title').textContent=longTitle;
      syncTaskCardStack(miniPlayback);
      if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();
      const minimize=refinementCard.querySelector('[data-minimize-task-card]');
      minimize.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      if(!refinementCard.classList.contains('is-task-card-back'))errors.push('child key activates background card');
      minimize.click();
      if(!refinementCard.classList.contains('is-minimized'))errors.push('background minimize requires two clicks');
      minimize.click();
      await new Promise(resolve=>setTimeout(resolve,300));
      for(const card of [...taskCards.children].filter(c=>!c.hidden)){
        const r=card.getBoundingClientRect();
        if(card.scrollWidth>card.clientWidth+1)errors.push(card.id+': horizontal overflow');
        for(const child of card.querySelectorAll('header,header button')){
          const c=child.getBoundingClientRect();
          if(c.width && (c.left<r.left-1||c.right>r.right+1||c.top<r.top-1||c.bottom>r.bottom+1))errors.push(card.id+': clipped heading/control');
        }
      }
      const label=refinementCard.querySelector('.task-progress-label'),value=refinementCard.querySelector('.task-progress-value');
      if(!label||label.title!==longTitle||value?.textContent.trim()!=='· 42%'||value.getBoundingClientRect().right>refinementCard.getBoundingClientRect().right)errors.push('long title clips or loses true percentage');
      const bar=refinementBar.parentElement.getBoundingClientRect(),fill=refinementBar.getBoundingClientRect();
      if(Math.abs(fill.width/bar.width-.42)>.01||fill.height<5)errors.push('progress geometry does not reflect 42%');
      const downloadsBefore=new Map(modelDownloads);
      const dismissedBefore=dismissedModelDownloadIds.slice();
      const model=onboardingAsrModels()[0];
      modelDownloads.set(model.id,{received:model.size_bytes*.42,total:model.size_bytes,paused:false});
      renderModelDownloadQueue();
      const queue=document.querySelector('#model-download-queue');
      const pause=queue.querySelector('[data-pause-required]');
      modelDownloads.get(model.id).received=model.size_bytes*.56;renderModelDownloadQueue();
      if(queue.querySelector('[data-pause-required]')!==pause)errors.push('download updates replace live controls');
      syncTaskCardStack(refinementCard);
      queue.querySelector('[data-minimize-task-card]').click();
      if(!queue.classList.contains('is-minimized'))errors.push('background download minimize requires two clicks');
      queue.querySelector('[data-dismiss-task-card]').click();
      modelDownloads.get(model.id).received=model.size_bytes*.57;renderModelDownloadQueue();
      await new Promise(resolve=>setTimeout(resolve,250));
      if(document.querySelector('#model-download-queue')||!modelDownloads.has(model.id))errors.push('closing download reopens card or cancels actual task');
      modelDownloads.clear();for(const [id,progress] of downloadsBefore)modelDownloads.set(id,progress);dismissedModelDownloadIds=dismissedBefore;queue.remove();
      meetingActive=true;await showView('settings');await openModal('models');
      miniMeeting.hidden=false;miniMeeting.click();await new Promise(resolve=>setTimeout(resolve,400));
      document.activeElement.blur();await new Promise(resolve=>setTimeout(resolve,250));
      if(!settingsModal.hidden||activeModal||activeView!=='live'||!meetingActive||document.querySelector('.app-shell').inert)errors.push('settings remains over live meeting');
      for(const card of [...taskCards.children].filter(c=>!c.hidden)){
        if(card.scrollWidth>card.clientWidth+1)errors.push(card.id+': task popover horizontal overflow');
        const visibleText=[...card.querySelectorAll('header p,strong,time,.task-card-actions')].some(e=>e.getBoundingClientRect().width>0);
        if(!visibleText||!document.querySelector('.library-panel').contains(card))errors.push(card.id+': persistent library lost task text');
      }
      meetingActive=false;miniMeeting.hidden=true;miniPlayback.hidden=true;refinementCard.hidden=true;
      await showView('home');await showLibraryNav('all-meetings');
      const row=document.querySelector('[data-meeting-action=delete]').closest('.meeting-row'),menu=row.querySelector('[data-meeting-menu]');
      const ids=uiData.meetings.map(m=>m.id).join(',');
      document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      menu.click();row.querySelector('[data-meeting-action=delete]').click();
      if([...document.querySelectorAll('.meeting-menu')].some(e=>!e.hidden)||settingsModal.contains(document.activeElement))errors.push('delete menu/focus not retired');
      if(!settingsModal.matches(':popover-open')||!menu.classList.contains('is-confirmation-anchor')||document.querySelector('.app-shell').inert||!settingsModal.querySelector('.confirmation-actions p').textContent.includes(meetingDeletionConsequence([uiData.meetings[Number(menu.dataset.meetingMenu)]])))errors.push('row delete must explain consequence from its button');

      settingsModal.querySelector('[data-cancel-confirmation]').click();await new Promise(resolve=>setTimeout(resolve,250));
      if(ids!==uiData.meetings.map(m=>m.id).join(',')||!settingsModal.hidden||document.querySelector('.app-shell').inert)errors.push('delete cancel changes data or traps focus');
      const stableRow=row.dataset.selectionKey;menu.click();row.querySelector('[data-meeting-action=delete]').click();settingsModal.querySelector('[data-cancel-confirmation]').focus();
      applyLanguage(locale);
      if(activeModal==='confirmation'||confirmationAction||!settingsModal.hidden||document.activeElement.closest('.meeting-row')?.dataset.selectionKey!==stableRow||ids!==uiData.meetings.map(m=>m.id).join(','))errors.push('locale refresh must cancel deletion, preserve data and refocus the rebuilt meeting');

      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(taskLayoutChecks.result?.value) && !taskLayoutChecks.result.value.length,
    `任务卡片、真实进度、设置返回与删除取消：${JSON.stringify(taskLayoutChecks)}`,
  );

  // 指针只移动一次；逐帧检查边缘命中与几何，覆盖悬停位移和后台列表刷新。
  const homeRow = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const row=document.querySelector('#home-view button.home-meeting');
      row.scrollIntoView({block:'nearest'});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return row.getBoundingClientRect().toJSON();
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const homeBounds = homeRow.result.value;
  for (const y of [homeBounds.bottom - 1, homeBounds.top + homeBounds.height / 2]) {
    const x = homeBounds.left + homeBounds.width / 2;
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    const stable = await client.send('Runtime.evaluate', {
      expression: `(async()=>{
        const row=document.querySelector('#home-view button.home-meeting');
        for(let start=performance.now();performance.now()-start<480;){
          await new Promise(requestAnimationFrame);
          renderHomeMeetings();
          const hit=document.elementFromPoint(${x},${y}),r=row.getBoundingClientRect();
          if(!row.matches(':hover')||hit?.closest('.home-meeting')!==row||Math.abs(r.top-${homeBounds.top})>.5||Math.abs(r.left-${homeBounds.left})>.5)return false;
        }
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    check(stable.result?.value === true, '首页会议在静止指针下应持续命中同一行');
  }

  // 显式启用时导出真实 桌面测试宿主 渲染图，供设计稿对照；默认测试不产生图片。
  const revisedInteractions = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[],originalWorkspaces=workspaces,originalMeetings=uiData.meetings;
      closeModal();await new Promise(r=>setTimeout(r,250));
      if(onboardingPage)await dismissOnboardingPage();
      meetingActive=false;await showView('home');
      const root=document.querySelector('.workspace-subnav'),before=root.getBoundingClientRect().height;
      workspaces=Array.from({length:40},(_,i)=>({id:'fixture-'+i,name:'工作区 '+i,meeting_count:0}));renderWorkspaceNav();
      if(Math.abs(root.getBoundingClientRect().height-before)>1)errors.push('workspace height changes with count');
      document.querySelector('#workspace-selector').click();
      const picker=workspacePicker,search=picker.querySelector('input');
      const addWorkspace=picker.querySelector('[data-new-workspace]'),addRect=addWorkspace.getBoundingClientRect(),plusRect=addWorkspace.querySelector('svg').getBoundingClientRect();
      if(Math.abs((plusRect.top+plusRect.bottom-addRect.top-addRect.bottom)/2)>1||Math.abs(plusRect.width-plusRect.height)>1||plusRect.left<addRect.left||plusRect.right>addRect.right||plusRect.top<addRect.top||plusRect.bottom>addRect.bottom)errors.push('workspace picker plus is offset or clipped');
      if(picker.querySelectorAll('.workspace-item').length!==41)errors.push('missing real workspace choices');
      const list=picker.querySelector('.workspace-picker-list');
      if(list.scrollHeight<=list.clientHeight||getComputedStyle(list).overflowY!=='auto')errors.push('workspace list cannot scroll');
      search.value='工作区 39';search.dispatchEvent(new Event('input'));
      if(picker.querySelectorAll('.workspace-item').length!==1)errors.push('workspace search disconnected');
      search.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      if(document.activeElement.dataset.workspaceId!=='fixture-39')errors.push('workspace keyboard');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(workspacePicker||document.activeElement.id!=='workspace-selector')errors.push('workspace escape focus');
      workspaces=originalWorkspaces;renderWorkspaceNav();
      const data=await window.brevia.initialize(),actual=data.meetings[0];
      uiData.meetings=[backendMeeting(actual)];activeLibraryNav='all-meetings';activeWorkspaceId=uiData.meetings[0].workspaceId||'';renderMeetingList();
      document.querySelector('[data-meeting-menu]').click();
      document.querySelector('[data-meeting-action=workspace]').click();
      if(document.querySelector('.meeting-menu').hidden||!document.querySelector('.meeting-workspace-menu'))errors.push('destination menu hides parent');
      if([...document.querySelectorAll('.meeting-menu button')].some(b=>!b.querySelector('svg')))errors.push('legacy menu icon');
      closeMeetingMenus();
      document.querySelector('[data-meeting-menu]').click();document.querySelector('[data-meeting-action=rename]').click();
      let input=meetingList.querySelector('[data-rename-meeting] input');
      const renameWidth=input.getBoundingClientRect().width,renameBounds=input.form.getBoundingClientRect();
      if(document.activeElement!==input||renameWidth<renameBounds.width*.6||input.form.scrollWidth>input.form.clientWidth+1||[...input.form.querySelectorAll('button')].some(button=>!button.getAttribute('aria-label')||button.getBoundingClientRect().right>renameBounds.right+1))errors.push('sidebar rename field clipped or unfocused');
      input.value='重命名测试';input.dispatchEvent(new Event('input',{bubbles:true}));
      const another={...uiData.meetings[0],id:'rename-other',title:'另一场会议',isExample:false};
      uiData.meetings.push(another);
      renderMeetingList();
      const renameOther=()=>{const row=meetingList.querySelector('[data-meeting-id=rename-other]');row.querySelector('[data-meeting-menu]').click();row.querySelector('[data-meeting-action=rename]').click();};
      renameOther();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,isComposing:true}));
      if(meetingList.querySelector('[data-rename-meeting] input')!==input||input.value!=='重命名测试'||meetingRenameDraft?.key!==actual.id)errors.push('refresh, composing or selecting another row loses rename draft');
      input.form.requestSubmit();
      renameOther();
      for(let i=0;i<100&&meetingRenameDraft;i++)await new Promise(r=>setTimeout(r,30));
      const written=await window.brevia.meeting.get({meeting_id:actual.id});
      if(meetingRenameDraft||written.title!=='重命名测试')errors.push('rename not persisted');
      renameOther();
      const otherField=meetingList.querySelector('[data-rename-meeting] input');
      if(otherField===input||otherField.disabled||otherField.value!==another.title)errors.push('rename reused another meeting form');
      otherField.form.querySelector('[data-cancel-meeting-rename]').click();
      if(document.activeElement?.dataset.meetingId!==another.id)errors.push('cancel rename loses keyboard focus');
      await window.brevia.meeting.update({meeting_id:actual.id,updates:{title:actual.title}});
      uiData.meetings=[{...backendMeeting(actual),id:'9d610fcc-dd65-4a78-a996-f287d57242e3',isExample:false}];renderMeetingList();
      document.querySelector('[data-meeting-menu]').click();document.querySelector('[data-meeting-action=rename]').click();
      input=meetingList.querySelector('[data-rename-meeting] input');input.value='失败仍保留';input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();
      for(let i=0;i<100&&meetingRenameDraft?.saving;i++)await new Promise(r=>setTimeout(r,30));
      if(!meetingRenameDraft?.error||input.value!=='失败仍保留'||input.disabled||uiData.meetings[0].title!==actual.title)errors.push('failed rename loses original or draft');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(meetingRenameDraft||meetingList.querySelector('[data-rename-meeting]'))errors.push('rename cancel');
      uiData.meetings=Array.from({length:4},(_,i)=>({...backendMeeting(actual),id:'fixture-select-'+i,isExample:false}));renderMeetingList();
      document.querySelector('#meeting-selection-toggle').click();
      if(batchToolbar.hidden||!batchToolbar.querySelector('[data-batch-export]').disabled)errors.push('empty selection actions');
      meetingList.querySelector('[data-select-meeting]').click();
      if(selectedMeetingKeys.size!==1||!batchToolbar.querySelector('#batch-select-all').indeterminate)errors.push('mixed checkbox state');
      batchToolbar.querySelector('#batch-select-all').click();
      if(selectedMeetingKeys.size!==4||!batchToolbar.querySelector('#batch-select-all').checked)errors.push('select all');
      const batchDelete=batchToolbar.querySelector('[data-batch-delete]');batchDelete.click();
      if(!settingsModal.matches(':popover-open')||!batchDelete.classList.contains('is-confirmation-anchor')||!settingsModal.querySelector('.confirmation-actions p').textContent.includes(t('会议将移至最近删除，可在那里恢复。')))errors.push('batch deletion anchor or consequence');
      settingsModal.querySelector('[data-cancel-confirmation]').click();
      batchToolbar.querySelector('#batch-select-all').click();
      if(selectedMeetingKeys.size||!meetingSelectionMode||!batchToolbar.querySelector('[data-batch-delete]').disabled)errors.push('clear all exits selection or enables delete');
      document.querySelector('#meeting-selection-toggle').click();
      if(meetingSelectionMode||!batchToolbar.hidden)errors.push('explicit exit');
      activeLibraryNav='recently-deleted';uiData.meetings=[{...backendMeeting(actual),deleted:true,isExample:false,deletedAt:new Date().toISOString()}];renderMeetingList();
      const purgeButton=meetingList.querySelector('[data-meeting-menu]');purgeButton.click();meetingList.querySelector('[data-meeting-action=purge]').click();
      if(!settingsModal.matches(':popover-open')||!purgeButton.classList.contains('is-confirmation-anchor')||!settingsModal.querySelector('.confirmation-actions p').textContent.includes(t('此操作不可恢复。')))errors.push('permanent deletion lacks anchored consequence');
      settingsModal.querySelector('[data-cancel-confirmation]').click();activeLibraryNav='all-meetings';
      uiData.meetings=originalMeetings;workspaces=originalWorkspaces;activeWorkspaceId='';renderWorkspaceNav();renderMeetingList();
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(revisedInteractions.result?.value) && !revisedInteractions.result.value.length,
    '新版选择器、菜单、重命名与多选：' +
      JSON.stringify(revisedInteractions.result?.value || revisedInteractions.exceptionDetails),
  );

  await client.send('Page.bringToFront');
  const motionChecks = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      closeModal(); await new Promise(r=>setTimeout(r,180));
      await Promise.all([showView('prepare'),showView('settings'),showView('home')]);
      if(activeView!=='home'||document.querySelectorAll('.view.active').length!==1)errors.push('rapid navigation did not converge');
      if(!document.querySelector('link[href="./motion.css"]'))errors.push('shared motion styles missing');
      const element=document.createElement('div');document.body.append(element);
      let closed=0;BreviaMotion.leave(element,()=>closed++);BreviaMotion.enter(element);
      await new Promise(r=>setTimeout(r,180));
      if(closed)errors.push('obsolete exit removed a reopened layer');
      element.remove();
      const button=document.querySelector('#meeting-selection-toggle');
      if(parseFloat(getComputedStyle(button).transitionDuration)>0.18)errors.push('frequent button feedback too slow');
      const auditControls=()=>{
        for(const control of document.querySelectorAll('button,summary,a[href],input:not([type="hidden"]),textarea,select,[role="button"]')){
          const style=getComputedStyle(control);
          if(style.display==='none'||!control.getClientRects().length)continue;
          if(!style.transitionProperty.split(',').some(property=>['color','background-color','border-color','opacity','all'].includes(property.trim())))errors.push('missing feedback: '+control.tagName+'.'+control.className);
          if(style.transitionDuration.split(',').every(value=>parseFloat(value)===0))errors.push('missing transition: '+control.tagName+'.'+control.className);
        }
      };
      auditControls();
      await showView('settings');auditControls();
      for(const kind of ['models','ai-features','advanced-settings','speaker-profiles','device-connection','storage','whats-new']){
        await openModal(kind);auditControls();
      }
      await showView('prepare');auditControls();
      await showView('home');
      if(BreviaMotion.timing.surface<=BreviaMotion.timing.exit)errors.push('exit is not faster than entrance');
      const view=document.querySelector('.view.active');
      view.getAnimations().forEach(animation=>animation.finish());
      if(getComputedStyle(view).opacity!=='1')errors.push('active view invisible');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const liveColumns = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[],wasActive=meetingActive,originalLocale=locale,notes=currentNotesMarkdown();
      closeModal();await showView('live');meetingActive=true;
      const layout=document.querySelector('.live-layout');
      if(layout.querySelector('[data-toggle-live-mode]'))errors.push('retired layout toggle remains');
      const notesBounds=layout.querySelector('.live-notes').getBoundingClientRect(),captionsBounds=layout.querySelector('.live-captions').getBoundingClientRect();
      if(notesBounds.left>=captionsBounds.left||Math.abs(notesBounds.width/(notesBounds.width+captionsBounds.width)-1.25/2.25)>.01||Math.abs(notesBounds.top-captionsBounds.top)>1)errors.push('live notes must lead the split');
      for(const code of Object.keys(catalog)){
        applyLanguage(code);
        for(const header of layout.querySelectorAll('.live-section-head')){
          const button=header.querySelector('[data-open-correction]'),title=header.querySelector('.eyebrow');
          if(button.textContent.trim()||!button.querySelector('svg')||button.title!==t('查找与替换')||button.getAttribute('aria-label')!==t('查找与替换'))errors.push('find icon locale '+code);
          const b=button.getBoundingClientRect(),h=title.getBoundingClientRect();
          if(b.top>=h.bottom||b.bottom<=h.top||b.right>header.getBoundingClientRect().right+1)errors.push('find icon outside title row '+code);
        }
      }
      applyLanguage(originalLocale);
      if(currentNotesMarkdown()!==notes)errors.push('language switching changes live notes');
      meetingActive=wasActive;await showView('home');return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    liveColumns.result?.value?.length === 0,
    `录制双栏布局和八语种操作栏：${JSON.stringify(liveColumns.result?.value || liveColumns.exceptionDetails)}`,
  );
  const onboardingHandoff = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const errors=[];
      await dismissOnboardingPage();
      openOnboardingLanguage('zh');
      const assertVisible=()=>{
        if(document.querySelectorAll('.onboarding-page').length!==1)errors.push('missing or duplicate onboarding shell');
        if(getComputedStyle(onboardingPage).opacity!=='1')errors.push('onboarding shell faded');
        if(!onboardingPage.querySelector('h1')?.textContent.trim())errors.push('blank onboarding heading');
      };
      assertVisible();
      onboardingPage.querySelector('[value="en"]').click();
      if(onboardingPage.lang!=='en')errors.push('language change delayed');
      onboardingPage.querySelector('[value="zh"]').click();
      let release;
      const old=onboardingPage;
      const pending=dismissOnboardingPage(async()=>{
        await new Promise(resolve=>release=resolve);
        openOnboardingPermissions();
      });
      await new Promise(resolve=>setTimeout(resolve,60));
      assertVisible();
      if(!old.isConnected||!old.inert)errors.push('slow next step exposes background or accepts repeat input');
      release();await pending;
      for(const open of [openOnboardingSetup,openOnboardingAi,openOnboardingMobile,openOnboardingAi,openOnboardingSetup]){
        await dismissOnboardingPage(open);
        assertVisible();
        await new Promise(requestAnimationFrame);assertVisible();
        if(getComputedStyle(onboardingPage.querySelector('h1')).outlineStyle!=='none')errors.push('step heading shows browser focus ring');
        const content=onboardingPage.querySelector('.onboarding-page-content');
        if(getComputedStyle(content).opacity!=='1')errors.push('step body starts transparent');
        if([...onboardingPage.querySelectorAll('button')].some(button=>getComputedStyle(button).transitionDuration.split(',').every(value=>parseFloat(value)===0)))errors.push('onboarding control missing feedback');
      }
      const frames=onboardingPage.querySelector('.onboarding-page-content').getAnimations()[0]?.effect.getKeyframes();
      if(frames&&frames[0].transform!=='translateX(-24px)')errors.push('back direction incorrect');
      // 点击真实下一步：快速存储设置不能闪出原生迁移浮窗。
      const originalDownload=downloadRequiredModels;
      const originalShow=HTMLDialogElement.prototype.showModal;
      let migrationDelay=null, downloaded=false;
      const modelNextStarted=performance.now();
      HTMLDialogElement.prototype.showModal=function(){if(this.classList.contains('storage-migration-dialog'))migrationDelay=performance.now()-modelNextStarted;return originalShow.call(this);};
      downloadRequiredModels=()=>{downloaded=true;};
      try {
        onboardingPage.querySelector('[data-download-onboarding-models]').click();
        const until=Date.now()+3000;
        while(onboardingPage.dataset.onboardingStep!=='ai'&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
        if(!onboardingPage.querySelector('.onboarding-ai-setup-page')||(migrationDelay!==null&&migrationDelay<160)||!downloaded||storageMovePending||document.querySelector('.storage-migration-dialog'))errors.push('model Next flashed a migration dialog or failed to hand off');
        assertVisible();
      } finally {
        downloadRequiredModels=originalDownload;
        HTMLDialogElement.prototype.showModal=originalShow;
      }
      const savedCompletion=localStorage.getItem('brevia-onboarding-complete');
      try {
        localStorage.removeItem('brevia-onboarding-complete');
        await dismissOnboardingPage(openOnboardingMobile);
        const outgoing=onboardingPage;
        outgoing.querySelector('[data-onboarding-mobile-next]').click();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        if(!document.body.classList.contains('onboarding-handoff')||getComputedStyle(document.querySelector('.app-shell')).display==='none'||!outgoing.inert)errors.push('first home lacks continuous handoff');
        const home=document.querySelector('#home-view');
        if(getComputedStyle(home).opacity!=='1'||!home.getAnimations().some(animation=>animation.effect.getTiming().duration===520))errors.push('first home entrance missing or transparent');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
        await outgoing.dismissPromise;
        if(document.querySelector('.onboarding-page')||document.body.classList.contains('onboarding-handoff')||getComputedStyle(home).opacity!=='1')errors.push('welcome input interruption failed');
        await openOnboardingMobile();
        const repeated=onboardingPage;
        repeated.querySelector('[data-onboarding-mobile-next]').click();
        await repeated.dismissPromise;
        if(document.body.classList.contains('onboarding-handoff')||home.getAnimations().length)errors.push('welcome replayed after first entry');
      } finally {
        if(savedCompletion===null)localStorage.removeItem('brevia-onboarding-complete');
        else localStorage.setItem('brevia-onboarding-complete',savedCompletion);
      }
      await dismissOnboardingPage();
      applyLanguage('zh');
      return errors;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(
    Array.isArray(onboardingHandoff.result?.value) && !onboardingHandoff.result.value.length,
    '引导全步骤、异步准备连续性和控件反馈：' +
      JSON.stringify(onboardingHandoff.result?.value || onboardingHandoff.exceptionDetails),
  );
  check(
    Array.isArray(motionChecks.result?.value) && !motionChecks.result.value.length,
    '公共动效、快速导航和退出重入：' +
      JSON.stringify(motionChecks.result?.value || motionChecks.exceptionDetails),
  );
  const summaryButtonMotion = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      const host=document.createElement('section');host.id='summary-motion-test';
      const previous=uiData.detail.summary,previousTab=detailActiveTab;uiData.detail.summary={markdown:'# 已有纪要',generating:true};detailActiveTab='summary';host.innerHTML=renderDetailTabbar();uiData.detail.summary=previous;detailActiveTab=previousTab;
      document.body.append(host);
      const spinners=[...host.querySelectorAll('[aria-busy="true"] .summary-generating-icon')];
      await new Promise(requestAnimationFrame);
      const before=spinners.map(spinner=>getComputedStyle(spinner).transform);
      await new Promise(resolve=>setTimeout(resolve,80));
      return spinners.length===1 && spinners.every((spinner,index)=>spinner.closest('button').disabled
        && getComputedStyle(spinner).animationName==='button-spin'
        && getComputedStyle(spinner).transform!==before[index]);
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(summaryButtonMotion.result?.value === true, '纪要生成按钮：禁用重复提交并持续旋转星星');
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reducedControls = await client.send('Runtime.evaluate', {
    expression: `(async()=>{
      await new Promise(requestAnimationFrame);
      const controls=[...document.querySelectorAll('button,summary,a[href],input,textarea,select,[role="button"]')];
      const host=document.getElementById('summary-motion-test');
      const reduced=[...host.querySelectorAll('.summary-generating-icon')].every(spinner=>parseFloat(getComputedStyle(spinner).animationDuration)===0);
      const transitions=controls.every(control=>getComputedStyle(control).transitionDuration.split(',').every(value=>parseFloat(value)===0));
      host.remove();
      return reduced && transitions;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  check(reducedControls.result?.value === true, '减少动态效果：真实控件全部停止过渡');
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  if (process.env.BREVIA_DESIGN_CAPTURE_DIR) {
    const output = path.resolve(process.env.BREVIA_DESIGN_CAPTURE_DIR);
    mkdirSync(output, { recursive: true });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 0,
      height: 0,
      deviceScaleFactor: 1 / defaultWindowScale,
      mobile: false,
    });
    const evaluate = async (expression) => {
      const value = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (value.exceptionDetails)
        throw new Error(
          value.exceptionDetails.exception?.description || value.exceptionDetails.text,
        );
      return value.result?.value;
    };
    await evaluate(
      `(async () => { if (onboardingPage) await dismissOnboardingPage(); closeModal(); await new Promise(resolve => setTimeout(resolve,250)); meetingActive=false; miniMeeting.hidden=true; clearInterval(timer); applyLanguage('zh'); applyTheme('light'); })()`,
    );
    await delay(3500);
    const captures = [
      [
        'desktop-library',
        `(()=>{window.visualOriginalMeetings=uiData.meetings;const source=uiData.meetings.at(-1);const now=new Date();uiData.meetings=['产品周会','客户访谈','项目复盘','需求评审'].map((title,i)=>({...source,id:'visual-library-'+i,title,isExample:false,workspaceId:'',workspace:{name:['产品','访谈','产品','未分类'][i]},createdAt:new Date(now.getFullYear(),now.getMonth(),now.getDate()-(i<2?0:7),i%2?14:10).toISOString(),durationMs:i%2?5400000:3600000,speakerCount:0,hasSummary:false,tags:i%2?['手机录音']:[],statusCode:i===1?'pending':'completed',status:{tone:i===1?'processing':'done',label:i===1?'待转写':'已整理',detail:''}}));window.visualLibraryMeetings=uiData.meetings;showView('home');renderMeetingList();homeSlogan.textContent=t('所有对话，清晰归档。');})()`,
      ],
      ['desktop-prepare', `setPrepareMode('record'); showView('prepare')`],
      ['desktop-import', `setPrepareMode('import'); showView('prepare')`],
      [
        'desktop-import-selected',
        `(()=>{const input=document.createElement('input');input.type='file';input.id='visual-import-file';input.hidden=true;document.body.append(input);})()`,
      ],
      ['desktop-settings', `renderSettingsView(); showView('settings')`],
      ['desktop-ai-summary', `openModal('ai-features')`],
      ['desktop-ai-notes', `openModal('ai-assist')`],
      ['desktop-models', `openModal('models')`],
      [
        'desktop-advanced',
        `(async()=>{await openModal('advanced-settings');const groups=settingsModal.querySelectorAll('.advanced-settings-form details');groups[0]?.setAttribute('open','');[...groups].find(group=>group.querySelector('[name^=\"live.\"]'))?.setAttribute('open','');})()`,
      ],
      ['desktop-storage', `openModal('storage')`],
      ['desktop-voiceprints', `openModal('speaker-profiles')`],
      ['desktop-phone', `openModal('device-connection')`],
      [
        'desktop-workspace-create',
        `(async()=>{closeModal(); await new Promise(resolve=>setTimeout(resolve,250)); showNewWorkspaceDialog();})()`,
      ],
      [
        'desktop-confirmation',
        `(async()=>{document.querySelector('.workspace-dialog [data-close-modal]').click();await showLibraryNav('all-meetings');const row=meetingList.querySelector('.meeting-row');row.querySelector('[data-meeting-menu]').click();row.querySelector('[data-meeting-action=delete]').click();})()`,
      ],
      [
        'desktop-tasks',
        `(async()=>{closeModal(); await new Promise(resolve=>setTimeout(resolve,250)); await showView('home'); showTranslationProgress(56,100,'en'); showSummaryProgress(68,100,'summary.generating',uiData.meetings[0].id); showRefinementProgress(42,100,'产品周会',uiData.meetings[0].id,'正在识别');})()`,
      ],
      ['desktop-task-paused', `setTaskCardPaused(refinementCard,true)`],
      [
        'desktop-task-minimized',
        `toggleTaskCardMinimized(refinementCard,refinementCard.querySelector('[data-minimize-task-card]'))`,
      ],
      [
        'desktop-live',
        `(async()=>{closeModal(); await new Promise(resolve=>setTimeout(resolve,250)); meetingActive=true; breviaClient.state.meeting={...breviaClient.state.meeting,tags:[]};breviaClient.state.inputs={mic:true,system:true};document.querySelector('#pause').disabled=false;document.querySelector('#pause').innerHTML=interfaceIcon('pause')+'<span>'+t('暂停')+'</span>'; document.querySelector('#live-name').textContent='产品周会'; uiData.live.transcript=[['10:02','我们先回顾一下上周的进展。整体来说，核心功能已经稳定，当前重点是提升会议纪要的准确性和可用性。接下来会重点看真实使用场景。'],['10:04','我们建议优先邀请 3 个有代表性的客户，结合他们的真实会议内容，收集使用反馈和典型问题，再决定后续的扩展节奏。'],['10:06','另外，关于数据存储方式，我们需要向客户解释清楚：录音和文字内容优先保存在本地，在线服务需要明确确认。'],['10:08','本周先完成测试版本，下周开始试点。各负责人同步准备使用指南和反馈入口。']].map(([time,text],i)=>({time,text,speaker:{name:''},translation:i===2?'In addition, regarding the storage method, we need to explain it clearly to customers: prioritize local storage of audio and text.':undefined}));document.querySelector('#transcript-scroll').innerHTML=uiData.live.transcript.map(entry=>renderTranscriptSegment({...entry,showSpeaker:false})).join(''); await showView('live'); liveNotesEditor?.setMarkdown('## 一、试点范围\\n\\n- 先在产品团队与 3 个核心客户中进行试点\\n- 覆盖会议场景：周会、需求评审、客户访谈\\n- 试点周期 4 周，收集使用反馈并评估效果\\n- 重点验证：转写准确性、会议纪要、行动项提取\\n\\n## 二、待办事项\\n\\n- [ ] 优化会议纪要生成效果（负责人：张伟）\\n- [ ] 准备试点使用指南与 FAQ（负责人：李娜）\\n- [ ] 整理客户反馈入口（4 月 28 日）');latestAiSuggestion={id:'visual-suggestion',type:'conclusion',text:'本周先完成测试版本，下周开始小范围试点，随后汇总使用反馈并评估效果。'};aiNoteUserTyping=false;renderAiSuggestion();clearTimeout(aiSuggestionAutoFadeTimer); })()`,
      ],
      ['desktop-live-dark', `applyTheme('dark')`],
      [
        'desktop-detail',
        `(async()=>{meetingActive=false;uiData.meetings=window.visualOriginalMeetings;renderMeetingList(); miniMeeting.hidden=true; applyTheme('light'); document.querySelectorAll('#task-cards > aside').forEach(card=>card.hidden=true); const row=[...document.querySelectorAll('.meeting-list [data-meeting-id]')].at(-1); summaryGeneratingMeetingId=undefined; await openMeetingRow(row);detailActiveTab='notes';setDetailLayoutMode('transcript');uiData.detail.hasRefined=true;uiData.detail.hasOriginalTranscript=true;uiData.detail.transcriptEditable=true;uiData.detail.refinedMode='timestamps';uiData.detail.refinedTranscript=uiData.detail.transcript=uiData.detail.originalTranscript=[['张伟','大家好，今天我们主要回顾上周进展，并讨论下个版本的重点。',0],['李娜','先看一下产品数据。整体活跃用户保持增长，尤其是会议纪要功能的使用率提升明显。',28],['王强','关于下个版本，建议我们优先优化企业版的权限管理，同时控制预算，确保在 Q2 内完成上线。',72],['陈晨','我同意这个方向。另外，用户反馈中提到了移动端体验问题，我们也需要跟进。',105],['刘洋','好的，我这边会整理详细的需求列表，并在本周内评估开发资源。',138],['张伟','如果实际成本超过预算，我们再评估范围和交付节奏。',182]].map(([name,text,time],i)=>({segmentId:'visual-reference-'+i,time:formatMeetingTime(time*1000),startSeconds:time,endSeconds:time+25,speaker:{name},text}));currentMeetingDetail={...currentMeetingDetail,title:'产品周会',speakers:[{id:'visual-zhang',name:'张伟'},{id:'visual-li',name:'李娜'},{id:'visual-wang',name:'王强'}]};document.querySelector('#detail-view .detail-title h1').textContent='产品周会';uiData.detail.notes='# 试点计划\\n\\n本次会议围绕新客户试点计划的推进节奏、核心功能范围和风险评估展开讨论，明确了下阶段的重点任务与责任人。\\n\\n## 决定\\n\\n- 选定两家标杆客户开展试点，优先验证会议纪要的准确性与可用性。\\n- 试点周期为 4 周，11 月初进行中期评估。\\n- 产品侧优先支持多语言识别与发言人区分，其余需求后续迭代。\\n\\n## 待办事项\\n\\n- [ ] 整理试点客户的需求清单并确认对接人（@张伟）\\n- [ ] 完成多语言识别的测试版本并内部评测（@李娜）\\n- [ ] 准备试点使用指南与培训材料（@王强）\\n\\n## 待确认\\n\\n- [ ] 是否需要接入企业的 SSO 登录？\\n- [ ] 试点阶段的数据留存周期与安全评估方案。';uiData.detail.summary.markdown='## 会议要点\\n\\n本次会议聚焦新客户试点计划，确定了试点客户、周期与核心功能范围，并对资源安排、风险及后续评估方式达成一致。\\n\\n## 决定\\n\\n1. 选定两家标杆客户开展试点，优先验证会议纪要的准确性与可用性。\\n2. 试点周期为 4 周，11 月初进行中期评估。\\n3. 产品侧优先支持多语言识别与发言人区分，其余需求后续迭代。\\n\\n## 待办事项\\n\\n- [ ] 整理试点客户的需求清单并确认对接人（@张伟）\\n- [ ] 完成多语言识别的测试版本并内部评测（@李娜）\\n- [ ] 准备试点使用指南与培训材料（@王强）';renderMeetingDetail();})()`,
      ],
      [
        'desktop-detail-transcript',
        `document.querySelector('[data-detail-tab=transcript]').click()`,
      ],
      [
        'desktop-detail-transcript-search',
        `(()=>{const search=finalTranscript.querySelector('[data-transcript-search]');search.value='预算';search.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      ],
      [
        'desktop-detail-search-reset',
        `document.querySelector('[data-close-transcript-search]').click()`,
      ],
      ['desktop-detail-summary', `openReviewDocument('summary')`],
      [
        'desktop-detail-summary-config-required',
        `(async()=>{
          window.visualSavedSummaryConfig=structuredClone(summaryConfig);
          window.visualSavedSummaryWait=uiData.detail.summary.waitingModels;
          window.visualSummaryTaskKey='summary.generate:'+currentMeetingDetail.id;
          window.visualSavedSummaryTask=pendingModelTasks.get(window.visualSummaryTaskKey);
          summaryConfig.enabled=true;
          summaryConfig.provider='built-in';
          summaryConfig.providers['built-in'].model='__missing_summary_model__';
          await generateMeetingSummary(currentMeetingDetail.id);
          const feedback=document.querySelector('[data-summary-feedback]');
          if(!feedback?.checkVisibility()||!feedback.querySelector('.summary-feedback-close')||!feedback.querySelector('[data-settings-modal="summary-model"]'))throw Error('缺失纪要模型时未显示可关闭的配置提示');
        })()`,
      ],
      [
        'desktop-detail-edit',
        `(()=>{
          summaryConfig=window.visualSavedSummaryConfig;
          if(window.visualSavedSummaryTask)pendingModelTasks.set(window.visualSummaryTaskKey,window.visualSavedSummaryTask);
          else pendingModelTasks.delete(window.visualSummaryTaskKey);
          uiData.detail.summary.waitingModels=window.visualSavedSummaryWait;
          document.querySelector('.summary-feedback-close').click();
          if(!document.querySelector('[data-summary-feedback]').hidden)throw Error('关闭配置提示后仍然可见');
          document.querySelector('[data-open-summary-edit]').click();
          if(!inlineSummaryEditor||!document.querySelector('[data-cancel-inline-summary-edit]'))throw Error('纪要编辑器未打开');
          delete window.visualSavedSummaryConfig;
          delete window.visualSavedSummaryWait;
          delete window.visualSummaryTaskKey;
          delete window.visualSavedSummaryTask;
        })()`,
      ],
      ['desktop-detail-edit-markdown', `inlineSummaryEditor.setMode('markdown')`],
      [
        'desktop-detail-ready',
        `document.querySelector('[data-cancel-inline-summary-edit]').click()`,
      ],
      ['desktop-export', `openReviewDocument('notes');openModal('export')`],
      [
        'desktop-language',
        `(async()=>{closeModal(); await new Promise(resolve=>setTimeout(resolve,250)); meetingActive=false; applyTheme('light'); openOnboardingLanguage('zh');})()`,
      ],
      [
        'desktop-onboarding-models',
        `(async()=>{await dismissOnboardingPage(); await openOnboardingSetup();})()`,
      ],
      [
        'desktop-onboarding-ai',
        `(async()=>{await dismissOnboardingPage(); openOnboardingAi();})()`,
      ],
      [
        'desktop-onboarding-ai-config',
        `(()=>{const enabled=onboardingPage.querySelector('[name="onboarding-summary-enabled"]'); if(!enabled.checked) enabled.click(); onboardingPage.querySelector('[data-configure-ai-summary]').click();settingsModal.querySelector('[data-flow-select-choice="provider"][data-value="custom-openai"]').click();})()`,
      ],
      [
        'desktop-onboarding-phone',
        `(async()=>{closeModal(); await new Promise(resolve=>setTimeout(resolve,250)); await dismissOnboardingPage(); openOnboardingMobile();})()`,
      ],
      [
        'desktop-onboarding-pairing',
        `(async()=>{onboardingPage.querySelector('[data-onboarding-mobile-pair]').click(); const until=Date.now()+10000; while(!document.getElementById('mobile-pair-dialog').open && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,50)); if(!document.getElementById('mobile-pair-dialog').open) throw new Error('配对弹窗未打开');})()`,
      ],
      [
        'desktop-onboarding-permissions',
        `(async()=>{document.querySelector('#mobile-close-pairing').click(); await new Promise(resolve=>setTimeout(resolve,250)); await dismissOnboardingPage(); openOnboardingPermissions({microphone:'not-determined',screen:'not-determined',systemAudioSupported:true});})()`,
      ],
    ];
    captures.push(
      [
        'desktop-workspace-empty',
        `(async()=>{await dismissOnboardingPage();await showView('home');const workspace=await window.brevia.workspace.create({name:'访谈',description:''});workspaces.push(workspace);renderWorkspaceNav();await switchWorkspace(workspace.id);})()`,
      ],
      ['desktop-workspace-popover', `document.querySelector('#workspace-edit').click()`],
      ['desktop-notification-workspace', `showToast(t('工作区已创建'),undefined,'success')`],
      ['desktop-notification-ai-saved', `showToast(t('AI 笔记已保存'),undefined,'success')`],
      ['desktop-notification-error', `showToast(t('保存失败'),undefined,'error')`],
      [
        'desktop-workspace-after-popover',
        `(async()=>{document.querySelector('.workspace-dialog [data-close-modal]').click();await new Promise(resolve=>setTimeout(resolve,250));})()`,
      ],
      [
        'desktop-trash',
        `(async()=>{meetingSearch.value='';await showLibraryNav('recently-deleted');})()`,
      ],
      [
        'desktop-about',
        `(async()=>{await showLibraryNav('all-meetings');await showView('settings');await openModal('whats-new');})()`,
      ],
      [
        'desktop-update-first-launch-changelog-zh',
        `(async()=>{closeModal();await new Promise(r=>setTimeout(r,250));await showView('home');applyLanguage('zh');localStorage.setItem('brevia-whatsnew-seen','1.2.0');whatsNewShown=false;maybeShowWhatsNew();const deadline=Date.now()+6000;while(activeModal!=='upgrade-log'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));if(activeModal!=='upgrade-log')throw Error('升级日志未自动显示');})()`,
      ],
      [
        'desktop-update-changelog-scroll',
        `(()=>{const body=settingsModal.querySelector('.modal-body');body.scrollTop=body.scrollHeight;})()`,
      ],
      [
        'desktop-update-changelog-history',
        `(()=>{const body=settingsModal.querySelector('.modal-body');const history=body.querySelector('details:not(.is-current)');history.open=true;body.scrollTop=history.offsetTop-body.offsetTop;})()`,
      ],
      [
        'desktop-update-first-launch-changelog-en',
        `(()=>{applyLanguage('en');settingsModal.querySelector('.modal-body').scrollTop=0;})()`,
      ],
      [
        'desktop-update-changelog-en-long',
        `(()=>{const body=settingsModal.querySelector('.modal-body');body.scrollTop=180;})()`,
      ],
      [
        'desktop-update-changelog-en-links',
        `(()=>{const body=settingsModal.querySelector('.modal-body');const history=body.querySelector('details:not(.is-current)');history.open=true;body.scrollTop=history.offsetTop-body.offsetTop;})()`,
      ],
      [
        'desktop-update-changelog-en-dark',
        `(()=>{applyTheme('dark');settingsModal.querySelector('.modal-body').scrollTop=0;})()`,
      ],
      [
        'desktop-update-changelog-dismiss',
        `(async()=>{settingsModal.querySelector('[data-update-log-dismiss]').click();await new Promise(r=>setTimeout(r,300));if(!settingsModal.hidden||document.querySelector('.app-shell').inert||localStorage.getItem('brevia-whatsnew-seen')!==installedAppVersion)throw Error('开始使用未关闭/保存已读/恢复交互');applyTheme('light');applyLanguage('zh');})()`,
      ],
      [
        'desktop-update-changelog-same-version',
        `(()=>{whatsNewShown=false;maybeShowWhatsNew();if(activeModal)throw Error('已读版本重复弹出');})()`,
      ],
      [
        'desktop-update-changelog-about',
        `(async()=>{await openModal('upgrade-log');settingsModal.querySelector('[data-update-log-about]').click();const deadline=Date.now()+6000;while(activeModal!=='whats-new'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));if(activeModal!=='whats-new'||activeView!=='settings'||!settingsModal.classList.contains('settings-page'))throw Error('日志入口未进入D41');})()`,
      ],
      [
        'desktop-update-changelog-return',
        `(async()=>{closeModal();await new Promise(r=>setTimeout(r,600));if(activeView!=='home')throw Error('D41返回未恢复原页');await showView('settings');})()`,
      ],
      [
        'desktop-settings-dark',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));applyTheme('dark');})()`,
      ],
      [
        'desktop-models-ai',
        `(async()=>{applyTheme('light');await openModal('models');const section=[...settingsModal.querySelectorAll('.model-group-heading')].find(e=>e.textContent.includes('会议纪要'));section?.scrollIntoView({block:'start'});})()`,
      ],
      [
        'desktop-models-installed',
        `(()=>{window.visualModelPaths=new Map(modelPaths);const model=onboardingAsrModels()[0];modelPaths.set(model.id,'/fixture/installed');modelLibraryTab='installed';renderModelLibrary();settingsModal.querySelector('.modal-body').scrollTop=0;})()`,
      ],
      [
        'desktop-models-download-error',
        `(()=>{modelPaths.clear();for(const [id,path] of window.visualModelPaths)modelPaths.set(id,path);modelLibraryTab='available';const model=onboardingAsrModels()[0];window.visualDownloadId=model.id;modelDownloads.set(model.id,{error:'fixture: download failed',received:0,total:model.size_bytes});renderModelLibrary();})()`,
      ],
      [
        'desktop-advanced-expanded',
        `(async()=>{modelDownloads.delete(window.visualDownloadId);await openModal('advanced-settings');settingsModal.querySelector('.advanced-settings-form details')?.setAttribute('open','');})()`,
      ],
      [
        'desktop-notes-edit',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));await showView('detail');detailActiveTab='notes';setDetailLayoutMode('transcript');uiData.detail.notesEditing=false;renderMeetingDetail();document.querySelector('[data-edit-notes]').click();detailNotesEditor.setMarkdown('# 试点计划\\n\\n本次会议围绕新客户试点计划的推进节奏、核心功能范围和风险评估展开讨论。\\n\\n## 决定\\n\\n- 选定两家标杆客户开展试点。\\n- 试点周期为 4 周。\\n\\n## 待办事项\\n\\n- [ ] 整理试点客户的需求清单。\\n- [ ] 准备培训材料。');updateDetailNotesDraft();})()`,
      ],
      ['desktop-notes-markdown', `detailNotesEditor.setMode('markdown')`],
      [
        'desktop-notes-saving',
        `(()=>{window.visualPersistNotes=persistNotes;persistNotes=()=>new Promise((resolve,reject)=>window.visualRejectNotes=reject);document.querySelector('[data-notes-save]').click();})()`,
      ],
      [
        'desktop-notes-save-failed',
        `(async()=>{window.visualRejectNotes(new Error('fixture: save failed'));await new Promise(resolve=>setTimeout(resolve,50));toast.classList.remove('visible');})()`,
      ],
      [
        'desktop-component-states',
        `(async()=>{persistNotes=window.visualPersistNotes;document.querySelector('[data-notes-cancel]').click();await showView('prepare');prepareForm.querySelector('details.prepare-options').open=true;prepareForm.querySelector('[name="meeting-speakers"]').closest('.flow-select').querySelector('.flow-select-toggle').click();})()`,
      ],
      [
        'desktop-live-expanded',
        `(async()=>{meetingActive=true;await showView('live');showRefinementProgress(42,100,'产品周会',currentMeetingDetail.id,'正在识别');document.querySelector('.sidebar .brand').focus();})()`,
      ],
      [
        'desktop-live-toolbar-translation',
        `(()=>{const toggle=document.querySelector('#translation-toggle');toggle.click();const panel=document.querySelector('#translation-options'),r=panel.getBoundingClientRect(),anchor=toggle.getBoundingClientRect();if(panel.hidden||r.bottom>anchor.top||r.top<0||r.right>innerWidth)throw Error('会议底栏菜单错位');})()`,
      ],
      ['desktop-live-toolbar-closed', `document.querySelector('#translation-toggle').click()`],
      [
        'desktop-live-info',
        `(()=>{const before=meetingActive;document.querySelector('#live-info-toggle').click();const panel=document.querySelector('#live-info-panel'),r=panel.getBoundingClientRect();if(panel.hidden||meetingActive!==before||activeView!=='live'||!panel.textContent.includes(document.querySelector('#live-name').textContent)||r.top<40||r.bottom>innerHeight||r.right>innerWidth)throw Error('会议信息错位或改变录制状态');})()`,
      ],
      [
        'desktop-live-info-closed',
        `(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));if(!document.querySelector('#live-info-panel').hidden||document.querySelector('#live-info-toggle').getAttribute('aria-expanded')!=='false')throw Error('会议信息不能关闭');})()`,
      ],

      [
        'desktop-onboarding-storage',
        `(async()=>{meetingActive=false;document.querySelectorAll('#task-cards > aside').forEach(e=>e.hidden=true);await openOnboardingSetup();})()`,
      ],
      [
        'desktop-onboarding-ai-local-config',
        `(async()=>{await dismissOnboardingPage();openOnboardingAi();onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked=true;onboardingPage.querySelector('[name="onboarding-summary-enabled"]').dispatchEvent(new Event('change',{bubbles:true}));window.__designBuiltinPath=modelPaths.get(RECOMMENDED_BUILTIN_MODEL_ID);modelPaths.delete(RECOMMENDED_BUILTIN_MODEL_ID);onboardingBuiltinProvider=true;summaryConfigDraft=structuredClone(summaryConfig);summaryConfigDraft.provider='built-in';openModal('summary-model');})()`,
      ],
      [
        'desktop-onboarding-ai-local',
        `(async()=>{closeModal();if(window.__designBuiltinPath)modelPaths.set(RECOMMENDED_BUILTIN_MODEL_ID,window.__designBuiltinPath);delete window.__designBuiltinPath;await new Promise(resolve=>setTimeout(resolve,250));})()`,
      ],
      [
        'desktop-onboarding-ai-auto',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked=true;onboardingPage.querySelector('[data-flow-select-choice="onboarding-ai-proactivity"][data-value="auto"]').click();await new Promise(resolve=>setTimeout(resolve,1300));})()`,
      ],
      [
        'desktop-onboarding-ai-auto-written',
        `(async()=>{await new Promise(resolve=>setTimeout(resolve,2000));})()`,
      ],
      [
        'desktop-onboarding-ai-manual',
        `(()=>{onboardingPage.querySelector('[data-flow-select-choice="onboarding-ai-proactivity"][data-value="quiet"]').click();})()`,
      ],
      [
        'desktop-onboarding-ai-suggestion',
        `(async()=>{onboardingPage.querySelector('[data-demo-suggestion] button').click();await new Promise(resolve=>setTimeout(resolve,1300));})()`,
      ],
      ['desktop-onboarding-ai-written', `onboardingPage.querySelector('[data-demo-add]').click()`],
      [
        'desktop-onboarding-permissions-granted',
        `(async()=>{await dismissOnboardingPage();openOnboardingPermissions({microphone:'granted',screen:'not-determined',systemAudioSupported:true});})()`,
      ],
      [
        'desktop-onboarding-permissions-denied',
        `(async()=>{await dismissOnboardingPage();openOnboardingPermissions({microphone:'denied',screen:'denied',systemAudioSupported:false});})()`,
      ],
    );
    captures.push(
      [
        'desktop-workspace-edit',
        `(async()=>{if(onboardingPage)await dismissOnboardingPage();await showView('home');const workspace=await window.brevia.workspace.create({name:'产品',description:'产品研发会议'});workspaces.push(workspace);renderWorkspaceNav();await switchWorkspace(workspace.id);showEditWorkspaceDialog(workspace.id);})()`,
      ],
      [
        'desktop-task-media',
        `(async()=>{document.querySelector('.workspace-dialog [data-close-modal]').click();await switchWorkspace('');uiData.meetings=window.visualLibraryMeetings;renderMeetingList();miniMeeting.hidden=false;miniTitle.textContent='产品周会';miniTimer.textContent='00:12:36';miniPlayback.hidden=false;miniPlayback.querySelector('#mini-playback-title').textContent='客户访谈';miniPlayback.querySelector('#mini-playback-state').textContent='已暂停';if(refinementCard.classList.contains('is-minimized'))toggleTaskCardMinimized(refinementCard,refinementCard.querySelector('[data-minimize-task-card]'));showRefinementProgress(42,100,'产品周会',currentMeetingDetail.id,'正在识别');document.querySelector('.workspace-subnav').classList.remove('is-collapsed');setTaskCardPaused(refinementCard,false);syncTaskCardStack(refinementCard);if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();await document.fonts.ready;document.getAnimations().forEach(a=>a.effect.getComputedTiming().iterations===Infinity?a.pause():a.finish());await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));for(const card of taskCards.querySelectorAll('.is-task-card-back')){const r=card.getBoundingClientRect(),h=card.querySelector('header').getBoundingClientRect();if(h.top<r.top||h.bottom>r.top+48)throw new Error('后层任务标题不可见');}const nav=meetingList,first=nav.querySelector('.sidebar-workspace-toggle');nav.scrollTop=0;if(first.getBoundingClientRect().bottom>nav.getBoundingClientRect().bottom+1)throw new Error('任务挤出首个工作区 '+JSON.stringify({first:first.getBoundingClientRect().toJSON(),nav:nav.getBoundingClientRect().toJSON(),sidebar:document.querySelector('.sidebar').getBoundingClientRect().toJSON()}));})()`,
      ],
      [
        'desktop-models-downloading',
        `(async()=>{miniMeeting.hidden=true;miniPlayback.hidden=true;await showView('settings');await openModal('models');const model=onboardingAsrModels()[0];modelDownloads.set(model.id,{received:Math.round(model.size_bytes*.42),total:model.size_bytes,paused:false});modelLibraryTab='available';renderModelLibrary();settingsModal.querySelector('.modal-panel').scrollTop=0;settingsModal.querySelector('[data-model-id="'+model.id+'"]')?.scrollIntoView({block:'center'});})()`,
      ],
      [
        'desktop-phone-trusted',
        `(async()=>{document.querySelectorAll('#task-cards > aside, #task-cards > section, #task-cards > button').forEach(card=>card.hidden=true);await showView('settings');await openModal('device-connection');settingsModal.querySelector('.modal-body').scrollTop=0;})()`,
      ],
    );
    captures.push(
      [
        'desktop-ai-online',
        `(async()=>{await showView('settings');await openModal('ai-assist');aiAssistConfigDraft.provider='custom-openai';renderModal('ai-assist');showSettingsModal();})()`,
      ],
      [
        'desktop-model-picker-options',
        `(()=>{const selector=settingsModal.querySelector('[name=provider]').closest('.flow-select');selector.querySelector('[data-flow-select-toggle]').click();})()`,
      ],
      [
        'desktop-voiceprints-filled',
        `(async()=>{await openModal('speaker-profiles');speakerProfiles=[{id:'visual-speaker-1',name:'王琳',sample_count:2,duration_ms:62000},{id:'visual-speaker-2',name:'陈明',sample_count:1,duration_ms:28000}];expandedSpeakerProfileId='visual-speaker-1';speakerSamples.set('visual-speaker-1',[{id:'visual-sample-1',duration_ms:20000},{id:'visual-sample-2',duration_ms:42000}]);renderSpeakerProfileModal();})()`,
      ],
      [
        'desktop-trash-selected',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));await showLibraryNav('recently-deleted');const source=backendMeeting((await window.brevia.initialize()).meetings[0]);uiData.meetings.push({...source,id:'visual-trash-1',title:'产品周会',isExample:false,deleted:true,deletedAt:new Date().toISOString()},{...source,id:'visual-trash-2',title:'客户访谈',isExample:false,deleted:true,deletedAt:new Date().toISOString()});renderMeetingList();for(const field of document.querySelectorAll('[data-select-meeting]'))field.click();})()`,
      ],
      ['desktop-trash-confirmation', `document.querySelector('[data-batch-delete]').click()`],
      [
        'desktop-storage-confirmation',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));await showView('settings');await openModal('storage');settingsModal.querySelector('[data-clear-storage=meetings]').click();})()`,
      ],
      [
        'desktop-export-format-options',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));await showView('detail');detailActiveTab='notes';setDetailLayoutMode('transcript');renderMeetingDetail();await openModal('export');})()`,
      ],
      [
        'desktop-export-expanded',
        `(()=>{settingsModal.querySelector('.export-format-wrap [data-flow-select-toggle]').click();settingsModal.querySelector('.export-more-share summary').click();})()`,
      ],
      [
        'desktop-export-none',
        `(()=>{settingsModal.querySelector('.export-more-share summary').click();settingsModal.querySelectorAll('[data-export-item]').forEach(field=>{if(field.checked)field.click();});})()`,
      ],
      [
        'desktop-export-audio-only',
        `settingsModal.querySelector('[data-export-item=audio]').click()`,
      ],
    );
    captures.push([
      'desktop-onboarding-ai-weak',
      `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));const report=deviceReport;deviceReport={...report,weak:true};openOnboardingAi();deviceReport=report;})()`,
    ]);
    captures.push(
      [
        'desktop-ai-demo-processing',
        `(async()=>{if(onboardingPage)await dismissOnboardingPage();openOnboardingAi();onboardingPage.querySelector('[name=onboarding-summary-enabled]').checked=true;onboardingPage.querySelector('[name=onboarding-ai-enabled]').checked=true;onboardingPage.querySelector('[name=onboarding-ai-proactivity]').value='assist';renderOnboardingSummaryDemo();renderOnboardingAiDemo();})()`,
      ],
      [
        'desktop-ai-demo-suggestion',
        `(async()=>{await new Promise(resolve=>setTimeout(resolve,1000));})()`,
      ],
      ['desktop-ai-demo-added', `document.querySelector('[data-demo-add]')?.click()`],
      [
        'desktop-ai-demo-auto',
        `(async()=>{const enabled=onboardingPage.querySelector('[name=onboarding-ai-enabled]');enabled.checked=true;renderOnboardingAiDemo();onboardingPage.querySelector('[data-flow-select-choice=onboarding-ai-proactivity][data-value=auto]').click();await new Promise(resolve=>setTimeout(resolve,2600));})()`,
      ],
      [
        'desktop-detail-tools-refined',
        `(async()=>{await dismissOnboardingPage();await showView('detail');const d=uiData.detail;d.hasRefined=true;d.refinedMode='timestamps';d.transcriptVersion='refined';d.refinedTranscript=d.originalTranscript;currentMeetingDetail.current_segments=d.refinedTranscript.map((entry)=>({id:entry.segmentId,text:entry.text,start_ms:entry.startSeconds*1000,end_ms:entry.endSeconds*1000}));d.transcriptEditable=true;d.refineState='idle';detailActiveTab='transcript';renderMeetingDetail();})()`,
      ],
      ['desktop-detail-refine-menu', `document.querySelector('[data-refine-more]').click()`],
      [
        'desktop-detail-translation-menu',
        `document.querySelector('[data-detail-translation-toggle]').click()`,
      ],
      [
        'desktop-detail-transcript-edit',
        `document.querySelector('[data-edit-transcript]').click()`,
      ],
      [
        'desktop-detail-transcript-edit-v11',
        `(()=>{const d=uiData.detail;d.refinedTranscript[2].translation='For the next release, we suggest prioritizing enterprise permission management and keeping the launch within budget.';document.querySelector('[data-transcript-cancel]').click();document.querySelector('[data-edit-transcript]').click();const edited=document.querySelectorAll('[data-segment-text]')[2];edited.value+=' 修改';edited.dispatchEvent(new Event('input',{bubbles:true}));edited.focus();if(!document.querySelector('#detail-view .translation').textContent.includes(t('译文（未更新）'))||document.querySelector('#detail-view .translation textarea'))throw Error('旧译文未保持只读/状态提示');if(document.querySelectorAll('[data-transcript-save]').length!==1||!document.querySelector('[data-transcript-save-status]').textContent.includes(t('已修改 · 尚未保存'))||!document.querySelector('.segment-modified-state'))throw Error('逐段修改状态缺失');})()`,
      ],
      [
        'desktop-detail-transcript-saving-v11',
        `(()=>{uiData.detail.transcriptSaveState='saving';renderMeetingDetail();if(!document.querySelector('[data-transcript-save]').disabled||!document.querySelector('[data-transcript-cancel]').disabled||![...document.querySelectorAll('[data-segment-text]')].every(f=>f.disabled))throw Error('保存中未锁定');})()`,
      ],
      [
        'desktop-detail-transcript-failed-v11',
        `(()=>{uiData.detail.transcriptSaveState='failed';renderMeetingDetail();if(!document.querySelector('[data-transcript-save]').textContent.includes(t('重试'))||!Object.values(uiData.detail.transcriptDraft).some(v=>v.includes('修改')))throw Error('失败未保留草稿/重试');})()`,
      ],
      [
        'desktop-detail-transcript-empty-v11',
        `(async()=>{const field=document.querySelector('[data-segment-text]');field.value='  ';field.dispatchEvent(new Event('input',{bubbles:true}));await saveDetailTranscriptEdits();if(!document.activeElement?.matches('[data-segment-text][aria-invalid=true]')||!uiData.detail.transcriptEditing)throw Error('空文本未定位/保留草稿 '+JSON.stringify({id:currentMeetingDetail?.id,editing:uiData.detail.transcriptEditing,state:uiData.detail.transcriptSaveState,draft:uiData.detail.transcriptDraft,errors:uiData.detail.transcriptErrors,focus:document.activeElement.outerHTML.slice(0,350)}));})()`,
      ],
      [
        'desktop-detail-summary-tools',
        `(()=>{document.querySelector('[data-transcript-cancel]').click();openReviewDocument('summary');})()`,
      ],
    );
    captures.push(
      [
        'desktop-tasks-long-title',
        `(async()=>{await showView('home');miniMeeting.hidden=false;miniTitle.textContent='快牛 印尼会议 20260813 — 长会议标题验证';miniTimer.textContent='00:12:36';miniPlayback.hidden=false;document.querySelector('#mini-playback-title').textContent='客户访谈 — 带有很长标题的音频';showRefinementProgress(42,100,'快牛 印尼会议 20260813 — 长会议标题验证',currentMeetingDetail.id,'正在识别');syncTaskCardStack(refinementCard);})()`,
      ],
      [
        'desktop-live-task-summary-compact-v11',
        `(async()=>{meetingActive=true;await showView('live');taskCards.querySelectorAll('.task-card-stack-item').forEach(card=>card.hidden=true);miniMeeting.hidden=false;miniTimer.textContent='18:42';miniPlayback.hidden=false;refinementCard.hidden=false;syncTaskCardStack(miniMeeting);if(!taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();document.activeElement?.blur();})()`,
      ],
      [
        'desktop-live-task-summary-compact-error-v11',
        `(()=>{refinementCard.dataset.failed='true';syncTaskCardStack(miniMeeting);})()`,
      ],
      [
        'desktop-live-task-summary-expanded-v11',
        `(()=>{document.querySelector('[data-task-summary]').focus();document.querySelector('[data-task-summary]').click();})()`,
      ],
      [
        'desktop-live-task-summary-return-v11',
        `(async()=>{delete refinementCard.dataset.failed;meetingActive=false;await showView('home');document.activeElement?.blur();syncTaskCardStack();})()`,
      ],
      [
        'desktop-tasks-download-states',
        `(()=>{const models=onboardingAsrModels().slice(0,3);models.forEach((model,i)=>modelDownloads.set(model.id,{received:model.size_bytes*.42,total:model.size_bytes,paused:i===1,error:i===2?'网络连接暂时中断，请重试。':undefined}));renderModelDownloadQueue();syncTaskCardStack();if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();taskCards.scrollTop=taskCards.scrollHeight;})()`,
      ],
      [
        'desktop-settings-with-tasks',
        `(async()=>{meetingActive=true;await showView('settings');await openModal('models');miniMeeting.hidden=false;})()`,
      ],
      [
        'desktop-settings-return-live',
        `(async()=>{miniMeeting.click();await new Promise(resolve=>setTimeout(resolve,400));document.activeElement.blur();if(!settingsModal.hidden||activeView!=='live'||!meetingActive)throw new Error('设置仍覆盖会议');})()`,
      ],
      ['desktop-live-tasks-expanded', `document.querySelector('.sidebar .brand').focus()`],
      [
        'desktop-meeting-delete',
        `(async()=>{meetingActive=false;await showLibraryNav('all-meetings');const row=document.querySelector('[data-meeting-action=delete]').closest('.meeting-row');row.querySelector('[data-meeting-menu]').click();row.querySelector('[data-meeting-action=delete]').click();})()`,
      ],
      [
        'desktop-tasks-paused',
        `(async()=>{closeModal();await new Promise(resolve=>setTimeout(resolve,250));setTaskCardPaused(refinementCard,true);syncTaskCardStack(refinementCard);if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();taskCards.scrollTop=taskCards.scrollHeight;})()`,
      ],
      [
        'desktop-tasks-minimized',
        `toggleTaskCardMinimized(refinementCard,refinementCard.querySelector('[data-minimize-task-card]'))`,
      ],
    );
    captures.push(
      [
        'desktop-sidebar-workspace-selector-tasks',
        `(async()=>{closeModal();await new Promise(r=>setTimeout(r,250));await switchWorkspace('');uiData.meetings=window.visualLibraryMeetings;renderMeetingList();taskCards.querySelectorAll('.is-minimized').forEach(c=>toggleTaskCardMinimized(c,c.querySelector('[data-minimize-task-card]')));workspaces=Array.from({length:24},(_,i)=>({id:'visual-workspace-'+i,name:['产品','访谈','海外','未分类'][i%4]+(i>3?' '+i:''),meeting_count:i}));renderWorkspaceNav();miniMeeting.hidden=false;miniTitle.textContent='产品周会';miniTimer.textContent='00:12:36';miniPlayback.hidden=false;document.querySelector('#mini-playback-title').textContent='客户访谈';modelDownloads.clear();renderModelDownloadQueue();showRefinementProgress(42,100,'产品周会',currentMeetingDetail.id,'正在识别');syncTaskCardStack(refinementCard);if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();taskCards.scrollTop=0;})()`,
      ],
      ['desktop-library-select-entry-v11', `(()=>{})()`],
      [
        'desktop-sidebar-workspace-popover-tasks',
        `(()=>{onboardingAsrModels().slice(0,3).forEach(model=>modelDownloads.set(model.id,{received:model.size_bytes*.42,total:model.size_bytes}));renderModelDownloadQueue();showTranslationProgress(56,100,'en');showSummaryProgress(68,100,'summary.generating',uiData.meetings[0].id);document.querySelectorAll('#translation-progress,#summary-progress').forEach(card=>card.hidden=false);syncTaskCardStack();if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();taskCards.scrollTop=0;document.querySelector('#workspace-selector').click();})()`,
      ],
      [
        'desktop-sidebar-workspace-search',
        `(()=>{const input=workspacePicker.querySelector('input');input.value='海外';input.dispatchEvent(new Event('input'));})()`,
      ],
      [
        'desktop-sidebar-many-tasks',
        `(()=>{closeWorkspacePicker(true);showTranslationProgress(56,100,'en');showSummaryProgress(68,100,'summary.generating',uiData.meetings[0].id);taskCards.scrollTop=taskCards.scrollHeight;})()`,
      ],
      [
        'desktop-meeting-management-menu',
        `(()=>{taskCards.querySelectorAll('.task-card-stack-item').forEach(c=>c.hidden=true);syncTaskCardStack();document.querySelector('[data-meeting-menu]').click();})()`,
      ],
      [
        'desktop-meeting-workspace-targets',
        `(()=>{document.querySelector('[data-meeting-action=workspace]').click();window.dispatchEvent(new Event('resize'));const parent=document.querySelector('.meeting-menu:not([hidden])').getBoundingClientRect(),menu=document.querySelector('.meeting-workspace-menu'),r=menu.getBoundingClientRect(),list=menu.querySelector('.menu-section');if(Math.abs(parent.top-r.top)>1||r.bottom>innerHeight-7||list.scrollHeight<=list.clientHeight)throw Error('长工作区菜单必须同顶对齐并独立滚动');const last=list.querySelector('button:last-child');last.focus();if(last.getBoundingClientRect().bottom>list.getBoundingClientRect().bottom+1)throw Error('键盘无法到达末项');menu.querySelector('.active')?.focus();})()`,
      ],
      [
        'desktop-meeting-rename-inline',
        `document.querySelector('[data-meeting-action=rename]').click()`,
      ],
      [
        'desktop-meeting-rename-error',
        `(async()=>{const input=document.querySelector('[data-rename-meeting] input');input.value='产品周会 · 失败后保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();const deadline=Date.now()+5000;while(meetingRenameDraft?.saving){if(Date.now()>deadline)throw Error('重命名请求未结束');await new Promise(r=>setTimeout(r,25));}if(!meetingRenameDraft?.error||input.disabled||input.value!=='产品周会 · 失败后保留草稿')throw Error('重命名失败草稿未保留');})()`,
      ],
      [
        'desktop-meeting-batch-none',
        `(()=>{document.querySelector('[data-cancel-meeting-rename]').click();document.querySelector('#meeting-selection-toggle').click();})()`,
      ],
      [
        'desktop-library-selection-empty-v11',
        `(()=>{miniMeeting.hidden=false;miniPlayback.hidden=false;refinementCard.hidden=false;syncTaskCardStack(refinementCard);})()`,
      ],
      [
        'desktop-library-selection-exit-v11',
        `document.querySelector('#meeting-selection-toggle').click()`,
      ],
      [
        'desktop-library-selection-entry-again-v11',
        `document.querySelector('#meeting-selection-toggle').click()`,
      ],
      [
        'desktop-meeting-batch-selected',
        `(()=>{const fields=[...meetingList.querySelectorAll('.meeting-row:not([hidden]) [data-select-meeting]')];fields[0].click();fields[2].click();})()`,
      ],
      ['desktop-meeting-batch-all', `batchToolbar.querySelector('#batch-select-all').click()`],
      [
        'desktop-meeting-batch-delete-confirm',
        `(()=>{batchToolbar.querySelector('#batch-select-all').click();const fields=[...meetingList.querySelectorAll('.meeting-row:not([hidden]) [data-select-meeting]')];fields[0].click();fields[2].click();batchToolbar.querySelector('[data-batch-delete]').click();})()`,
      ],
      [
        'desktop-meeting-batch-export-partial',
        `(()=>{closeModal();const meetings=selectedMeetings().map(m=>({...m}));showBatchResults(meetings,[{meeting_id:meetings[0].id,path:'/fixture/export.md'},{meeting_id:meetings[1].id,error:'网络连接暂时中断，请重试。'}],'export',()=>{});})()`,
      ],
      ['desktop-meeting-batch-states', `(()=>{})()`],
      [
        'desktop-library-select-entry-empty-v11',
        `(()=>{closeModal();clearMeetingSelection();uiData.meetings=[];renderMeetingList();})()`,
      ],
      [
        'desktop-trash-batch',
        `(async()=>{closeModal();await new Promise(r=>setTimeout(r,250));await showLibraryNav('recently-deleted');uiData.meetings=window.visualLibraryMeetings.slice(0,2).map(m=>({...m,deleted:true,deletedAt:new Date().toISOString()}));renderMeetingList();document.querySelector('#meeting-selection-toggle').click();batchToolbar.querySelector('#batch-select-all').click();})()`,
      ],
      [
        'desktop-devices-revoke',
        `(async()=>{clearMeetingSelection();await showView('settings');await openModal('device-connection');window.visualDevicePage=document.querySelector('#mobile-dialog');const first=document.querySelector('.trusted-device-revoke');if(!first)throw Error('撤销信任截图缺少已配对设备');first.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(activeModal!=='confirmation'||!settingsModal.matches(':popover-open')||!settingsModal.textContent.includes(t('这台设备将断开连接，需要重新配对才能访问电脑。'))||!settingsModal.querySelector('.confirmation-subject')?.textContent)throw Error('解除信任缺少锚定浮窗、设备名称或后果提示');const bounds=settingsModal.querySelector('.modal-panel').getBoundingClientRect();if(bounds.width>300||bounds.height>240||bounds.left<0||bounds.top<0||bounds.right>innerWidth||bounds.bottom>innerHeight)throw Error('解除信任浮窗尺寸或位置不正确：'+JSON.stringify(bounds.toJSON()));})()`,
      ],
      [
        'desktop-devices-revoke-cancelled',
        `(async()=>{settingsModal.querySelector('[data-cancel-confirmation]').click();if(activeModal!=='device-connection'||document.querySelector('#mobile-dialog')!==window.visualDevicePage||document.querySelector('.app-shell').inert||settingsModal.hasAttribute('popover'))throw Error('取消后未恢复原设备设置页面');if(!(await window.brevia.mobile.status()).devices.length)throw Error('取消确认仍解除了信任');document.querySelector('.trusted-device-revoke').click();if(activeModal!=='confirmation')throw Error('恢复后的设备按钮失去事件绑定');settingsModal.querySelector('[data-cancel-confirmation]').click();if(activeModal!=='device-connection'||document.querySelector('#mobile-dialog')!==window.visualDevicePage)throw Error('再次取消未恢复原页面');})()`,
      ],
      [
        'desktop-devices-revoke-escape',
        `(()=>{window.visualRevokeTrigger=document.querySelector('.trusted-device-revoke');window.visualRevokeTrigger.focus();window.visualRevokeTrigger.click();if(!settingsModal.matches(':popover-open'))throw Error('Escape 回归未打开撤销信任浮窗');})()`,
      ],
      [
        'desktop-devices-revoke-outside',
        `(()=>{window.visualRevokeTrigger=document.querySelector('.trusted-device-revoke');window.visualRevokeTrigger.focus();window.visualRevokeTrigger.click();if(!settingsModal.matches(':popover-open'))throw Error('外部点击回归未打开撤销信任浮窗');})()`,
      ],
      [
        'desktop-devices-empty',
        `(async()=>{const wait=async(predicate)=>{const deadline=Date.now()+6000;while(!await predicate()){if(Date.now()>deadline)throw Error('撤销信任确认超时');await new Promise(r=>setTimeout(r,25));}};let count=(await window.brevia.mobile.status()).devices.length;while(count){document.querySelector('.trusted-device-revoke').click();settingsModal.querySelector('[data-confirm-action]').click();await wait(async()=>activeModal==='device-connection'&&(await window.brevia.mobile.status()).devices.length<count);count=(await window.brevia.mobile.status()).devices.length;}const dialog=document.querySelector('#mobile-dialog');if(dialog.dataset.mobilePageState!=='intro'||dialog.querySelector('[data-mobile-panel="intro"]').hidden||dialog.querySelector('.mobile-device'))throw Error('撤销最后一台设备后未返回连接引导页');settingsModal.querySelector('.modal-body').scrollTop=0;delete window.visualDevicePage;})()`,
      ],
      [
        'desktop-devices-service-off',
        `(async()=>{await window.brevia.mobile.disable();const deadline=Date.now()+5000;while(document.querySelector('#mobile-service-toggle').checked){if(Date.now()>deadline)throw Error('服务关闭UI未更新');await new Promise(r=>setTimeout(r,50));}})()`,
      ],
      [
        'desktop-mobile-discovery-pairing',
        `(async()=>{closeModal();await new Promise(r=>setTimeout(r,250));await showLibraryNav('all-meetings');uiData.meetings=window.visualLibraryMeetings;renderMeetingList();await openModal('device-connection');document.querySelector('#mobile-dialog [data-mobile-panel]:not([hidden]) [data-mobile-page-step=pair], #mobile-dialog [data-mobile-panel=pair]:not([hidden]) #mobile-pair').click();const deadline=Date.now()+6000;while(!document.querySelector('#mobile-pair-dialog').open&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));if(!document.querySelector('#mobile-pair-dialog').open)throw new Error('配对弹窗未打开');settingsModal.hidden=true;settingsModal.classList.remove('modal-enter');document.querySelector('.app-shell').inert=false;})()`,
      ],
      [
        'desktop-mobile-pairing-expired',
        `(async()=>{const clock=Date.now,qr=document.querySelector('#mobile-qr').src;try{Date.now=()=>clock()+121000;await new Promise(r=>setTimeout(r,1500));}finally{Date.now=clock;}if(qr===document.querySelector('#mobile-qr').src||!document.querySelector('#mobile-retry-pairing').hidden||document.querySelector('#mobile-copy-pin').disabled||document.querySelector('#mobile-pair-error').textContent)throw new Error('配对码未自动刷新');})()`,
      ],
    );
    const measurements = [];
    for (const [name, expression] of captures) {
      console.log('Capturing', name);
      await evaluate(expression);
      if (['desktop-devices-revoke-escape', 'desktop-devices-revoke-outside'].includes(name)) {
        if (name.endsWith('-escape')) {
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
          });
          await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
          });
        } else {
          const x = await evaluate('innerWidth / 2');
          for (const type of ['mousePressed', 'mouseReleased']) {
            await client.send('Input.dispatchMouseEvent', {
              type,
              x,
              y: 20,
              button: 'left',
              clickCount: 1,
            });
          }
        }
        await evaluate(
          `(async()=>{const deadline=Date.now()+2000;while(activeModal!=='device-connection'){if(Date.now()>deadline)throw Error('撤销信任浮窗未轻关闭');await new Promise(r=>setTimeout(r,25));}if(document.querySelector('#mobile-dialog')!==window.visualDevicePage||document.querySelector('.app-shell').inert||settingsModal.hasAttribute('popover')||document.activeElement!==window.visualRevokeTrigger)throw Error('轻关闭未恢复原设备设置页面、交互或入口焦点');if(!(await window.brevia.mobile.status()).devices.length)throw Error('轻关闭意外解除了信任');delete window.visualRevokeTrigger;})()`,
        );
      }
      if (name.startsWith('desktop-update-') && (await evaluate(`activeModal==='upgrade-log'`))) {
        const issues = await evaluate(
          `(()=>{const body=settingsModal.querySelector('.modal-body'),panel=settingsModal.querySelector('.modal-panel'),footer=settingsModal.querySelector('.upgrade-log-actions');const errors=[];if(body.scrollWidth>body.clientWidth+1)errors.push('正文横向溢出');if(footer.getBoundingClientRect().bottom>innerHeight||panel.scrollHeight>panel.clientHeight+1)errors.push('固定动作溢出');if(settingsModal.querySelectorAll('.upgrade-log-actions').length!==1)errors.push('重复动作');if(!settingsModal.querySelector('.whatsnew-entry.is-current[open]')?.textContent.includes(installedAppVersion))errors.push('实际版本未展开');if(!document.querySelector('.app-shell').inert)errors.push('背景仍可操作');return errors;})()`,
        );
        if (issues.length) throw Error(name + ': ' + issues.join(', '));
      }
      if (name === 'desktop-sidebar-workspace-popover-tasks') {
        const cardsFit = await evaluate(
          `(()=>{const title=refinementCard.querySelector('header p');return [...taskCards.children].filter(c=>!c.hidden).length===6&&title.scrollWidth<=title.clientWidth+1;})()`,
        );
        if (!cardsFit)
          throw Error(
            '六任务场景缺少卡片，或普通任务标题被动作挤截：' +
              JSON.stringify(
                await evaluate(
                  `({cards:[...taskCards.children].map(c=>[c.id,c.hidden]),title:refinementCard.querySelector('header p').textContent,width:refinementCard.querySelector('header p').clientWidth,scroll:refinementCard.querySelector('header p').scrollWidth})`,
                ),
              ),
          );
      }
      if (name.startsWith('desktop-live-task-summary-compact')) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 100 });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const valid = await evaluate(
          `(()=>{const summary=document.querySelector('[data-task-summary]'),r=summary.getBoundingClientRect(),bar=document.querySelector('#desktop-statusbar'),bounds=bar.getBoundingClientRect(),device=document.querySelector('#mobile-nav').getBoundingClientRect();return bar.contains(summary)&&Math.abs(bounds.height-24)<1&&Math.abs(bounds.bottom-innerHeight)<1&&r.width>0&&r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1&&(device.right<=r.left+1||device.left>=r.right-1)&&device.right<=bounds.right+1&&getComputedStyle(taskCards).display==='none'&&summary.getAttribute('aria-expanded')==='false'&&summary.textContent.includes('3')&&summary.textContent.includes('18:42');})()`,
        );
        if (!valid) throw Error(name + ': 底部任务汇总几何/数量/计时不正确');
      }
      if (name === 'desktop-import-selected') {
        const audioPath = await evaluate(
          `(async()=>{const data=await window.brevia.initialize();const meeting=await window.brevia.meeting.get({meeting_id:data.meetings[0].id});return meetingPlaybackPath(meeting);})()`,
        );
        if (!audioPath) throw new Error('导入截图需要真实样例音频');
        const { root } = await client.send('DOM.getDocument');
        const { nodeId } = await client.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: '#visual-import-file',
        });
        await client.send('DOM.setFileInputFiles', { files: [audioPath], nodeId });
        await evaluate(
          `(async()=>{const input=document.querySelector('#visual-import-file');try{await selectImportAudio(input.files[0]);if(!importAudioSelection)throw new Error('真实音频选择失败');document.querySelector('#meeting-title').value='客户访谈';}finally{input.remove();}})()`,
        );
      }
      if (name === 'desktop-export-format-options') {
        const rowsVisible = await evaluate(
          `(()=>{const list=settingsModal.querySelector('.export-builder-section'),rows=[...list.querySelectorAll('.export-content-row')];return rows.length===4&&rows.every(row=>row.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+1);})()`,
        );
        if (!rowsVisible) throw Error('默认导出浮窗的四项内容应完整可见');
        const rect = await evaluate(
          `settingsModal.querySelector('.export-format-wrap [data-flow-select-toggle]').getBoundingClientRect().toJSON()`,
        );
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        if (
          !(await evaluate(
            `!!settingsModal.querySelector('.export-format-wrap [data-flow-select-toggle][aria-expanded=true]')`,
          ))
        )
          throw new Error('导出格式菜单未响应鼠标点击');
        if (
          !(await evaluate(
            `(()=>{const options=[...settingsModal.querySelectorAll('.export-format-wrap .flow-select-options:not([hidden]) button')];return options.length>0&&options.every(option=>option.getBoundingClientRect().height>=31.5&&option.getBoundingClientRect().height<=34&&getComputedStyle(option).fontSize==='14px')&&options.find(option=>option.dataset.value==='txt')?.textContent.trim()==='TXT';})()`,
          ))
        )
          throw new Error('导出格式菜单未对齐 D12 的行高与类型名称');
      }
      if (!name.startsWith('desktop-notification-'))
        await evaluate(`toast.classList.remove('visible')`);
      await evaluate(`document.fonts.ready.then(()=>true)`);
      if (await evaluate(`!!document.querySelector('#startup-splash')`))
        throw Error(name + ': 启动遮罩尚未退出');
      await delay(500);
      await evaluate(
        `document.getAnimations().forEach(animation=>animation.effect.getComputedTiming().iterations===Infinity?animation.pause():animation.finish())`,
      );
      await evaluate(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
      );
      if (['desktop-onboarding-ai-config', 'desktop-onboarding-ai-local-config'].includes(name)) {
        const configState = await evaluate(
          `(()=>{const panel=settingsModal.querySelector('.modal-panel');return {rect:panel.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},provider:panel.querySelector('[name="provider"]')?.value,remoteFields:['endpoint','apiKey','model'].every(name=>!!panel.querySelector('[name="'+name+'"]')),download:!!panel.querySelector('[data-download-model]'),submitDisabled:panel.querySelector('[type="submit"]').disabled,fieldHeights:[...panel.querySelectorAll('.config-fields input:not([type=hidden]),.config-fields .flow-select-toggle')].map(e=>e.getBoundingClientRect().height)};})()`,
        );
        const { rect, viewport } = configState;
        // 首启允许展示本地候选，不代表当前选中本地服务；按实际供应商检查配置状态。
        const providerReady =
          name === 'desktop-onboarding-ai-local-config'
            ? configState.provider === 'built-in' &&
              configState.download &&
              configState.submitDisabled
            : configState.provider === 'custom-openai' &&
              configState.remoteFields &&
              !configState.submitDisabled;
        const configFits =
          Math.abs(rect.width - 450) < 2 &&
          Math.abs(rect.left - (viewport.width - rect.width) / 2) < 2 &&
          rect.top >= 0 &&
          rect.bottom <= viewport.height &&
          providerReady;
        if (!configFits)
          throw Error(name + ': 引导配置浮窗错位或配置状态错误 ' + JSON.stringify(configState));
        const compact =
          rect.height < 520 &&
          configState.fieldHeights.every((height) => Math.abs(height - 40) <= 0.5);
        if (!compact)
          throw Error(
            name + ': 共享字段或模型区的留白覆盖了紧凑配置样式 ' + JSON.stringify(configState),
          );
      }
      if (['desktop-detail', 'desktop-notes-edit'].includes(name)) {
        const rhythm = await evaluate(
          `(()=>{const root=document.querySelector('.detail-notes-content,.detail-notes-edit .notes-editor');const first=root.querySelector('h1'),section=root.querySelector('h2'),paragraph=root.querySelector('p');return first&&getComputedStyle(first).fontSize==='26px'&&getComputedStyle(section).fontSize==='18px'&&getComputedStyle(paragraph).fontSize==='15px'&&parseFloat(getComputedStyle(section).marginTop)===28;})()`,
        );
        if (!rhythm) throw Error(name + ': 阅读与编辑的排版层级不一致');
      }
      const menuErrors = await evaluate(
        `([...document.querySelectorAll('.flow-select-options.is-floating:not([hidden])')].filter(menu=>{const bounds=menu.getBoundingClientRect(),anchor=menu.closest('.flow-select').querySelector('[data-flow-select-toggle]').getBoundingClientRect();return bounds.width>Math.max(anchor.width,160)+1||bounds.left<0||bounds.right>innerWidth+1||bounds.top<0||bounds.bottom>innerHeight+1;}).length)`,
      );
      if (menuErrors) throw new Error(name + ': 下拉菜单超出控件或视口边界');
      if (
        name === 'desktop-advanced' &&
        !(await evaluate(
          `(()=>{const panel=settingsModal.querySelector('[data-permission-settings]'),form=settingsModal.querySelector('.advanced-settings-form');return form.getBoundingClientRect().top-panel.getBoundingClientRect().bottom>=15.5;})()`,
        ))
      )
        throw new Error('权限区和进阶参数之间缺少分组留白');
      if (
        name === 'desktop-trash-selected' &&
        (await evaluate(
          `!!document.querySelector('.meeting-list .library-empty') || document.querySelectorAll('.meeting-row:not([hidden])').length !== 2`,
        ))
      )
        throw new Error('最近删除必须显示其它工作区的已选会议');
      if (
        ['desktop-library-select-entry-v11', 'desktop-library-selection-empty-v11'].includes(name)
      ) {
        const valid = await evaluate(
          `(()=>{const button=document.querySelector('#meeting-selection-toggle'),r=button.getBoundingClientRect(),icon=button.querySelector('svg').getBoundingClientRect(),toolbar=document.querySelector('.library-toolbar').getBoundingClientRect();if(r.height<28||icon.width<15||icon.right>r.right||icon.bottom>r.bottom||r.left<toolbar.left||r.right>toolbar.right+1||r.top<toolbar.top||r.bottom>toolbar.bottom+1)return false;const fields=[...meetingList.querySelectorAll('.meeting-row:not([hidden]) [data-select-meeting]')];if(!meetingSelectionMode)return batchToolbar.hidden&&fields.every(f=>f.hidden)&&button.getAttribute('aria-pressed')==='false';return selectedMeetingKeys.size===0&&!batchToolbar.hidden&&fields.every(f=>!f.hidden&&!f.checked)&&batchToolbar.querySelector('[data-batch-export]').disabled&&batchToolbar.querySelector('[data-batch-delete]').disabled&&!batchToolbar.querySelector('[data-batch-clear]').disabled&&getComputedStyle(batchToolbar.querySelector('[data-batch-delete]')).color===getComputedStyle(batchToolbar.querySelector('[data-batch-export]')).color&&batchToolbar.querySelector('[data-batch-count]').textContent===t('已选择')+' 0 / '+fields.length;})()`,
        );
        if (!valid) throw new Error(name + ': 选择入口几何或0项初始状态不正确');
      }
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const png = Buffer.from(shot.data, 'base64');
      writeFileSync(path.join(output, name + '.png'), png);
      if (
        [
          'desktop-library-select-entry-v11',
          'desktop-library-selection-empty-v11',
          'desktop-sidebar-many-tasks',
          'desktop-sidebar-workspace-popover-tasks',
          'desktop-meeting-batch-selected',
          'desktop-tasks-long-title',
          'desktop-tasks-download-states',
          'desktop-settings-with-tasks',
          'desktop-settings-return-live',
          'desktop-meeting-delete',
          'desktop-library',
          'desktop-prepare',
          'desktop-settings',
          'desktop-detail-tools-refined',
          'desktop-detail-summary-tools',
          'desktop-storage',
          'desktop-workspace-popover',
          'desktop-notes-edit',
          'desktop-export-format-options',
        ].includes(name) ||
        name.startsWith('desktop-ai-demo-')
      ) {
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 0,
          height: 0,
          deviceScaleFactor: 1,
          mobile: false,
        });
        const scaled = await client.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        writeFileSync(
          path.join(output, name + '-default-window.png'),
          Buffer.from(scaled.data, 'base64'),
        );
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: 0,
          height: 0,
          deviceScaleFactor: 1 / defaultWindowScale,
          mobile: false,
        });
      }
      measurements.push({
        name,
        capturedAt: new Date().toISOString(),
        imageWidth: png.readUInt32BE(16),
        imageHeight: png.readUInt32BE(20),
        ...(await evaluate(
          `({ width:innerWidth, height:innerHeight, windowWidth:outerWidth, windowHeight:outerHeight, dpr:devicePixelRatio, overflow:document.body.scrollWidth>innerWidth+1, modal:{hidden:settingsModal.hidden,classes:settingsModal.className,opacity:getComputedStyle(settingsModal).opacity,panelOpacity:getComputedStyle(settingsModal.querySelector('.modal-panel')).opacity}, font:getComputedStyle(document.body).fontFamily, fontWeight:getComputedStyle(document.body).fontWeight, typography:['.page-title','.meeting-title','.detail-title','.notes-body','.transcript-text','.primary-button','.secondary-button','.setting-label'].flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).slice(0,3).map(e=>({selector,weight:getComputedStyle(e).fontWeight,size:getComputedStyle(e).fontSize}))), regions:['.sidebar','.library-panel','#desktop-statusbar','#task-cards','.window-bar','#settings-view .settings-navigation','.settings-page .settings-navigation','.settings-general-main','.settings-page .modal-panel','#meeting-form','.detail-layout','.player'].map(selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return {selector,rect:r?.toJSON(),display:e&&getComputedStyle(e).display}}), onboarding:[...document.querySelectorAll('.onboarding-page-content')].map(e=>({height:e.clientHeight,scroll:e.scrollHeight})), actions:[...document.querySelectorAll('.onboarding-actions,.onboarding-tour-actions')].map(e=>({bottom:e.getBoundingClientRect().bottom})) })`,
        )),
      });
    }
    if (!packagedApp) {
      const resizeNativeWindow = async (width, height) => {
        await client.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
      };
      try {
        await evaluate(
          `(async()=>{document.querySelector('#mobile-close-pairing').click();await new Promise(resolve=>setTimeout(resolve,300));closeModal();})()`,
        );
        await resizeNativeWindow(
          Math.round(880 * defaultWindowScale),
          Math.round(640 * defaultWindowScale),
        );
        const nativeScenes = [
          [
            'desktop-sidebar-tasks-small-window',
            `(async()=>{meetingActive=false;await showLibraryNav('all-meetings');uiData.meetings=window.visualLibraryMeetings;renderMeetingList();miniMeeting.hidden=false;miniPlayback.hidden=false;refinementCard.hidden=false;syncTaskCardStack();if(taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();taskCards.scrollTop=0;})()`,
          ],
          [
            'desktop-sidebar-workspace-small-window',
            `document.querySelector('#workspace-selector').click()`,
          ],
          [
            'desktop-update-changelog-small-window',
            `(async()=>{closeWorkspacePicker(true);await openModal('upgrade-log');})()`,
          ],
          [
            'desktop-device-connection-native-minimum',
            `(async()=>{closeModal();await showView('home');await document.querySelector('#mobile-nav').onclick();const body=settingsModal.querySelector('.modal-body');if(!settingsModal.classList.contains('settings-page')||body.scrollWidth>body.clientWidth+1)throw Error('设备设置页窄窗布局');})()`,
          ],
          [
            'desktop-live-task-summary-native-minimum',
            `(async()=>{closeModal();meetingActive=true;await showView('live');taskCards.querySelectorAll('.task-card-stack-item').forEach(card=>card.hidden=true);miniMeeting.hidden=false;miniPlayback.hidden=false;refinementCard.hidden=false;miniTimer.textContent='18:42';syncTaskCardStack(miniMeeting);if(!taskCards.classList.contains('is-collapsed'))document.querySelector('[data-task-summary]').click();document.activeElement?.blur();})()`,
          ],
          [
            'desktop-detail-transcript-native-minimum',
            `(async()=>{meetingActive=false;await showView('detail');const d=uiData.detail;d.notesEditing=false;d.summaryEditing=false;d.transcriptEditing=false;d.transcriptEditable=true;d.refineState='idle';d.transcriptVersion='refined';d.refinedMode='timestamps';detailActiveTab='transcript';renderMeetingDetail();document.querySelector('[data-edit-transcript]').click();})()`,
          ],
        ];
        for (const [name, expression] of nativeScenes) {
          await evaluate(expression);
          await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 100 });
          await delay(350);
          const geometry = await evaluate(
            `(()=>{const errors=[];if(document.querySelector('dialog[open]')||(!settingsModal.hidden&&!['upgrade-log','device-connection'].includes(activeModal)))errors.push('前序弹窗未关闭');if(activeModal==='upgrade-log'&&settingsModal.querySelector('.upgrade-log-actions').getBoundingClientRect().bottom>innerHeight+1)errors.push('升级操作溢出');if(activeView==='home'){const nav=document.querySelector('.workspace-subnav').getBoundingClientRect(),selector=document.querySelector('#workspace-selector').getBoundingClientRect(),device=document.querySelector('#mobile-nav').getBoundingClientRect();if(selector.bottom>nav.bottom+1||device.bottom>innerHeight+1||(taskCards.checkVisibility()&&taskCards.getBoundingClientRect().bottom>document.querySelector('#desktop-statusbar').getBoundingClientRect().top))errors.push('侧栏分区溢出');if(workspacePicker&&workspacePicker.getBoundingClientRect().bottom>innerHeight+1)errors.push('工作区菜单溢出');}if(document.body.scrollWidth>innerWidth+1)errors.push('横向溢出');const summary=document.querySelector('[data-task-summary]').getBoundingClientRect(),player=document.querySelector('#detail-view .player').getBoundingClientRect();if(taskCards.checkVisibility()){const tasks=taskCards.getBoundingClientRect();if(tasks.top<0||tasks.left<0||tasks.right>innerWidth+1||tasks.bottom>document.querySelector('#desktop-statusbar').getBoundingClientRect().top)errors.push('任务弹层超出视口或覆盖状态栏');}if(activeView==='detail'&&(document.querySelectorAll('[data-transcript-save]').length!==1||player.bottom>innerHeight+1))errors.push('编辑动作或播放器溢出');return {errors,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.body.scrollWidth>innerWidth+1};})()`,
          );
          if (geometry.errors.length) throw Error(name + ': ' + geometry.errors.join(','));
          const shot = await client.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          });
          const png = Buffer.from(shot.data, 'base64');
          writeFileSync(path.join(output, name + '.png'), png);
          measurements.push({
            name,
            imageWidth: png.readUInt32BE(16),
            imageHeight: png.readUInt32BE(20),
            capturedAt: new Date().toISOString(),
            nativeContent: {
              width: Math.round(880 * defaultWindowScale),
              height: Math.round(640 * defaultWindowScale),
            },
            ...geometry,
          });
        }
        await evaluate(`document.querySelector('[data-transcript-cancel]').click()`);
      } finally {
        await resizeNativeWindow(1280, 800);
      }
    }
    await evaluate(`window.brevia.floatingCaption.show()`);
    await delay(500);
    await evaluate(
      `window.brevia.floatingCaption.update({segmentId:'visual-caption',text:'我们先回顾上周的进展。',translation:'Let us review progress from last week.',locale:'zh'})`,
    );
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const caption = targets.find((target) => target.url.includes('floating-caption.html'));
    if (!caption) throw new Error('悬浮字幕窗口未创建');
    const captionClient = await connect(caption.webSocketDebuggerUrl, () => {});
    try {
      await delay(500);
      const shot = await captionClient.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      writeFileSync(
        path.join(output, 'desktop-floating-caption.png'),
        Buffer.from(shot.data, 'base64'),
      );
    } finally {
      captionClient.close();
      await evaluate(`window.brevia.floatingCaption.close()`);
    }
    writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
    // 文件时间与源码指纹将本轮截图和历史补拍分开，避免旧图被算作最新覆盖。
    const run = {
      startedAt: new Date(captureStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      checksPassed: failures.length === 0 && pageErrors.length === 0,
      nativeContent: { width: 1280, height: 800 },
      zoom: defaultWindowScale,
      sources: captureSources,
      files: readdirSync(output).filter(
        (name) =>
          name.endsWith('.png') && statSync(path.join(output, name)).mtimeMs >= captureStartedAt,
      ),
    };
    writeFileSync(path.join(output, 'capture-run.json'), JSON.stringify(run, null, 2) + '\n');
  }
  check(pageErrors.length === 0, `页面操作期间脚本异常：${pageErrors.join('\n')}`);
  client.close();
  await cleanup();
  await delay(400);
} catch (error) {
  failures.push(`E2E 运行失败：${error.stack || error.message}`);
  try {
    const state = await client?.send(
      'Runtime.evaluate',
      {
        expression:
          '({visibility:document.visibilityState,phase:window.__visualAiFit,page:onboardingPage?.className,locale,activeView,activeModal})',
        returnByValue: true,
      },
      1000,
    );
    console.error('E2E失败时页面状态：', JSON.stringify(state?.result?.value));
  } catch {
    /* 失联时保留主进程日志。 */
  }
  console.error(mainOutput.slice(-4000));
  await cleanup();
} finally {
  await cleanup();
  try {
    rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* 临时目录可能已被系统回收。 */
  }
}

if (failures.length) {
  console.error('E2E smoke failed:');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('E2E smoke passed.');
process.exit(0);
