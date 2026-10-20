import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const [
  html,
  css,
  app,
  meetings,
  meetingDetail,
  uiData,
  components,
  i18n,
  i18nData,
  asrCopy,
  tailwind,
  onboarding,
  workspaces,
  floatingCaption,
  floatingCaptionHtml,
] = await Promise.all(
  [
    'index.html',
    'styles.css',
    'app.js',
    'app-meetings.js',
    'app-meeting-detail.js',
    'ui-data.js',
    'ui-components.js',
    'i18n.js',
    'i18n-data.js',
    'asr-copy.js',
    'tailwind.css',
    'onboarding.js',
    'workspaces.js',
    'floating-caption.js',
    'floating-caption.html',
  ].map((file) => readFile(file)),
);
const js = Buffer.concat([app, meetings, meetingDetail, workspaces]);
const [backendClient, audioProcessor, logo, revealGif] = await Promise.all(
  [
    'backend-client.js',
    'audio-processor.js',
    'assets/brevia-logo.svg',
    'assets/brevia-logo-reveal.gif',
  ].map((file) => readFile(file)),
);
const [electronMain, preload, packageManifest, modelManifest] = await Promise.all([
  readFile('../electron/main.js'),
  readFile('../electron/preload.js'),
  readFile('../package.json', 'utf8').then(JSON.parse),
  readFile('../backend/models.json', 'utf8').then(JSON.parse),
]);
const asr = await readFile('../backend/asr.py');

// ─── 这个文件测什么、不测什么 ─────────────────────────────────────────────────
//
// 前端是 16 个 classic script 共享一个全局作用域，没有 bundler、也没有 DOM 测试环境，
// 所以断言分三层，各有明确边界：
//   1. **行为断言** — 纯逻辑/纯函数在 vm 或宿主 realm 里真跑一遍（model-selection、
//      app-utils、escapeHtml、cleanSummaryMarkdown、app-actions 注册表）。凡是「输入→输出」
//      能说清的东西，都必须在这里验证，而不是断言源码里出现过某个函数名。
//   2. **契约门禁** — 加载顺序、全局符号重复声明、动作接缝、令牌成对、暗色覆盖、对比度。
//      这些是"机制级不变量"：它们约束的是源码结构本身，因此只能读源码。
//   3. **结构断言** — 某个 CSS 类 / i18n 文案 / HTML 属性是否存在。这类断言读源码是
//      恰当的：它们描述的正是**源码形态**，而且比启动一次真实应用快几个数量级。
// 真实启动后的 DOM 行为由 `electron/test-e2e.mjs`（CDP）覆盖，那才是端到端层。
// 因此"把结构断言也改成行为断言"不是目标——目标是让**逻辑**不靠源码文本证明。

// 模型选择的纯逻辑：与 index.html 同一种加载方式，测试直接拿合成清单跑真实边界。
// 在**宿主 realm** 里加载：模块只往 window 上挂东西，因此没必要用 vm。用 vm 会让模块
// 返回的数组带着另一个 realm 的原型，空数组的 deepStrictEqual 会以"结构相同但引用不等"
// 失败——那是测试脚手架的噪音，不是被测逻辑的问题。
const modelSelectionSource = (await readFile('model-selection.js')).toString();
const ms = modelSelectionSource.replace(/\r\n/g, '\n');
const previousWindow = globalThis.window;
globalThis.window = {};
try {
  await import(
    `data:text/javascript;base64,${Buffer.from(modelSelectionSource).toString('base64')}`
  );
  var MS = globalThis.window.BreviaModelSelection;
} finally {
  globalThis.window = previousWindow;
}
const packWorker = await readFile('../backend/pack_worker.py');
const workerSession = await readFile('../backend/worker_session.py');
const text = (value) => value.toString().replace(/\r\n/g, '\n');
assert.match(text(audioProcessor), /const BLOCK_SIZE = 8192;/);
assert.match(text(audioProcessor), /data\?\.type !== 'flush'/);
assert.match(text(audioProcessor), /this\.buffer\.slice\(0, count\)/);
assert.match(text(backendClient), /sources\.map\(\(resource\) => this\.flush\(resource\)\)/);
assert.match(
  text(backendClient),
  /resampler: null/,
  'audio capture retains resampling state across worklet blocks',
);
assert.match(
  text(backendClient),
  /state\.nextOutput \* ratio/,
  'resampling advances on one cumulative output clock',
);
assert.doesNotMatch(
  text(backendClient),
  /sampleOffset/,
  'per-frame resample rounding must not accumulate into timestamps',
);
assert.match(text(app), /const DEFAULT_REFINED_MODEL_ID = 'funasr-nano-int8';/);
assert.match(text(app), /hint\.textContent = userFacingError\(error\.message\)/);
assert.match(
  text(css),
  /\.capture-settings\{[^}]*grid-template-columns:repeat\(1,minmax\(0,1fr\)\)/,
);
assert.match(
  text(tailwind),
  /\.capture-mode-select\.opens-upward \.flow-select-options/,
  'capture mode menu opens upward when it would overflow',
);
assert.match(
  text(app),
  /options\.getBoundingClientRect\(\)\.bottom > window\.innerHeight/,
  'capture mode menu checks available viewport space',
);
assert.match(
  text(tailwind),
  /\.live-caption-controls\s+\{\s+@apply\s+flex\s+flex-wrap\s+items-center\s+gap-2;\s+\}/,
  'live controls fit the floating bar',
);
assert.match(
  text(html),
  /class="floating-control-bar live-control-bar"[^]*id="floating-caption-toggle"[^]*id="translation-toggle"[^]*id="live-model-toggle"[^]*id="pause"[^]*id="mark-important"[^]*id="end-meeting"/,
  'live tools precede pause, mark and end in the bottom toolbar',
);
assert.match(
  text(html),
  /class="player floating-control-bar"[^]*id="player-time"[^]*id="player-duration"[^]*id="play"[^]*id="progress"/,
  'playback time and duration precede the controls and timeline',
);
assert.match(
  text(tailwind),
  /\.secondary\s+\{\s+@apply\s+inline-flex\s+min-h-10/,
  'secondary actions do not fall back to a native light button in dark mode',
);
assert.match(
  text(tailwind),
  /html\[\s*data-theme="dark",?\s*\]\s+\s*\.modal-danger\s+\{\s+border-color:\s+var\(\s*--color-danger,?\s*\);\s+background:\s+var\(\s*--color-danger,?\s*\);\s+color:\s+#fff;\s+\}/,
  'dark destructive actions retain a visible danger background',
);
assert.match(text(app), /window\.brevia\.on\('meeting\.interrupted'/);
assert.match(text(app), /window\.brevia\.on\('transcript\.settled'/);
assert.match(
  text(app),
  /window\.brevia\.on\('transcript\.draft'/,
  'the in-progress paragraph gets its own line',
);
assert.match(text(app), /clearDraftSegments\(\);/, 'leaving a meeting drops the in-progress line');
assert.match(
  text(app),
  /transcript\.appendChild\(element\)/,
  'the in-progress line is pinned to the bottom, below confirmed subtitles',
);
assert.match(
  text(css),
  /\.segment\.is-draft/,
  'the in-progress line is styled apart from confirmed subtitles',
);
assert.match(
  text(app),
  /function setDetailLayoutMode\(mode\)/,
  'meeting details can swap their primary panel',
);
assert.match(
  text(html),
  /data-toggle-detail-mode="summary"/,
  'meeting details expose the swap control',
);
assert.match(
  text(html),
  /data-toggle-detail-mode="transcript"/,
  'meeting details expose the return control',
);
assert.match(
  text(tailwind),
  /\.detail-layout\.is-summary-mode > \.notes/,
  'summary mode expands the meeting summary panel',
);
assert.match(
  text(tailwind),
  /left: calc\(100% - 353px\)/,
  'swap control is centered on the panel divider',
);
assert.match(
  text(tailwind),
  /\.final-transcript\s+\.tabbar-extra\s+\{\s+margin-right:\s+40px;/,
  'refinement menu stays clear of the swap control',
);
assert.match(
  text(tailwind),
  /\.tab\s+\{\s+@apply\s+border-b\s+border-transparent\s+pb-4\s+text-\[13px\]\s+text-\[#666666\];\s+white-space:\s+nowrap;/,
  'narrow transcript tabs do not wrap per character',
);
assert.match(
  text(components),
  /data-edit-notes type="button" aria-label=/,
  'edit action uses an accessible icon button',
);
// 「字幕」tab 的铅笔必须编辑字幕本身：tabbar 随激活 tab 重建，保存走 segment.text 命令。
assert.match(
  text(components),
  /data-edit-transcript type="button" aria-label=/,
  'the subtitle tab exposes its own edit action',
);
assert.match(
  text(components),
  /data-transcript-cancel[^]*data-transcript-save type="button"[^>]*aria-label=/,
  'subtitle edits can be cancelled or saved',
);
assert.match(
  text(components),
  /function renderDetailTabbar\(\)/,
  'the tabbar is rendered on its own so its action can follow the active tab',
);
assert.match(
  text(components),
  /detailActiveTab\s+===\s+'transcript'\s+&&\s+d\.transcriptEditable\s+&&\s+d\.refinedMode\s+!==\s+'fulltext'\s+&&\s+d\.refineState\s+!==\s+'refining'/,
  'subtitle editing waits for a settled per-segment transcript',
);
assert.match(
  text(app),
  /holder\.innerHTML = renderDetailTabbar\(\);/,
  'switching tabs refreshes the tabbar action',
);
assert.match(
  text(app),
  /if \(tabbar\) \{\n\s+const holder = document\.createElement\('div'\);/,
  'tab switching tolerates a missing tabbar',
);
assert.match(text(app), /function saveDetailTranscriptEdits\(\)/);
assert.match(
  text(app),
  /window\.brevia\.segment\.saveText\(\{\s*meeting_id:\s*meeting\.id,\s*segments:\s*edits,?\s*\}\)/,
  'subtitle edits are saved in one batch request',
);
assert.match(
  text(app),
  /d\.transcriptDraft\[field\.dataset\.segmentText\] = field\.value/,
  'typed text is kept as a draft until save',
);
assert.match(
  text(meetingDetail),
  /segmentId: segment\.id/,
  'transcript entries carry the segment id used by inline editing',
);
assert.match(
  text(meetingDetail),
  /uiData\.detail\.transcriptEditable = meeting\.id !== liveMeetingId/,
  'a recording meeting cannot be edited while it is still being written',
);
assert.match(
  text(tailwind),
  /\.segment-text-input\s+\{\s+@apply\s+w-full/,
  'the inline editor is styled',
);
assert.match(text(preload), /saveText: invoke\('segment\.text'\)/);
assert.match(
  text(electronMain),
  /handle\(\s*'segment\.text'/,
  'the desktop bridge validates subtitle edits',
);
assert.match(
  text(electronMain),
  /'segment\.text',\s*\n?\s*id\.extend/,
  'the bridge forwards segment.text to the worker',
);
assert.match(
  text(electronMain),
  /edit\.text\.length, 0\) <= 60000/,
  'one save stays inside the single-command transport limit',
);
assert.match(
  text(tailwind),
  /html\[data-theme=["\x27]?dark["\x27]?\]\s+#detail-view\s+\.final-transcript\s+\.segment-text-input/,
  'the inline editor is readable in dark mode',
);
assert.match(
  text(tailwind),
  /\.detail-notes-panel:has\(\.detail-notes-edit\)\s+\{\s+display:\s+flex;\s+overflow:\s+hidden;/,
  'detail editor toolbar stays outside the scrolling surface',
);
assert.match(
  text(components),
  /data-inline-summary-editor/,
  'summary editor renders in the detail panel',
);
assert.match(
  text(app),
  /data-save-inline-summary/,
  'inline summary edits save through the existing summary API',
);
const workletMessages = [];
const workletContext = {
  currentFrame: 4800,
  AudioWorkletProcessor: class {
    constructor() {
      this.port = { onmessage: null, postMessage: (data) => workletMessages.push(data) };
    }
  },
  registerProcessor: (_name, processor) => {
    workletContext.Processor = processor;
  },
  Float32Array,
};
runInNewContext(text(audioProcessor), workletContext);
const processor = new workletContext.Processor();
processor.process([[new Float32Array([0.1, 0.2, 0.3])]]);
processor.port.onmessage({ data: { type: 'flush' } });
assert.equal(workletMessages[0].samples.length, 3, 'stop flush preserves the partial audio block');
assert.equal(
  workletMessages[0].startFrame,
  4800,
  'audio timestamps come from the shared audio clock',
);
assert.equal(workletMessages[1].flushed, true);
const onboardingContext = {
  window: {},
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { language: 'zh-CN' },
};
runInNewContext(text(onboarding), onboardingContext);
assert.deepEqual(
  Array.from(onboardingContext.window.BreviaOnboarding.defaultMeetingLanguages('zh')),
  ['zh'],
);
assert.deepEqual(
  Array.from(onboardingContext.window.BreviaOnboarding.defaultMeetingLanguages('ja')),
  ['ja'],
);
assert.deepEqual(
  Array.from(onboardingContext.window.BreviaOnboarding.defaultMeetingLanguages('ko')),
  ['ko'],
);
assert.deepEqual(
  Array.from(onboardingContext.window.BreviaOnboarding.defaultMeetingLanguages('en')),
  ['auto'],
);
// 「auto」的声明默认模型（Parakeet）不覆盖 zh/ja/ko：这三个界面必须给出显式会议语言，
// 否则默认会议会被路由到不支持该语言的模型。app.js 与 onboarding.js 口径必须一致。
assert.match(
  text(app),
  /\{\s*zh:\s*'zh',\s*ja:\s*'ja',\s*ko:\s*'ko'\s*\}\)?\[locale\]\s*\|\|\s*'auto'/,
  'app.js 会议语言默认值必须覆盖 zh/ja/ko',
);
assert.match(
  text(onboarding),
  /\{\s*zh:\s*'zh',\s*ja:\s*'ja',\s*ko:\s*'ko'\s*\}\)?\[locale\]\s*\|\|\s*'auto'/,
  'onboarding.js 会议语言默认值必须与 app.js 一致',
);
assert.match(text(app), /name="onboarding-model" value="\$\{escapeHtml\(model\.id\)\}"/);
// 识别模型文案表：每个分组必须覆盖全部八个界面语言，且每个模型 id / asr_role 都有文案。
// 缺一个语言就会在切换界面语言后掉进 undefined（或静默回落英文而没人发现）。
const asrCopyContext = { window: {} };
runInNewContext(text(i18nData), asrCopyContext);
runInNewContext(text(asrCopy), asrCopyContext);
const asrCopyData = asrCopyContext.window.BreviaAsrCopy;
const asrCopyLocales = asrCopyData.LOCALES;
assert.deepEqual(
  [...asrCopyLocales].sort(),
  ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'].sort(),
  'asr-copy.js must cover exactly the eight interface languages',
);
// 所有仍未退役的整句识别模型都必须有文案。
const asrModelCatalogIds = modelManifest
  .filter(({ stages, retired }) => (stages || []).includes('refined') && !retired)
  .map(({ id }) => id);
assert.equal(
  asrModelCatalogIds.length,
  new Set(asrModelCatalogIds).size,
  'refined model ids must be unique',
);
assert.ok(asrModelCatalogIds.length >= 2, 'expected several selectable recognition models');

for (const group of ['asrRole', 'tiers', 'model', 'recommended', 'setup', 'prepare']) {
  assert.ok(asrCopyData[group], `asr-copy.js must export ${group}`);
  for (const code of asrCopyLocales) {
    assert.ok(asrCopyData[group][code], `${group} missing locale ${code}`);
  }
}
for (const code of asrCopyLocales) {
  assert.equal(
    asrCopyData.setup[code].intro,
    undefined,
    `${code} recognition setup must omit the removed intro`,
  );
  for (const id of asrModelCatalogIds) {
    assert.ok(asrCopyData.model[code][id], `model.${code} missing ${id}`);
    assert.ok(asrCopyData.model[code][id].tagline, `model.${code}.${id} needs a tagline`);
  }
  for (const role of new Set(modelManifest.map(({ asr_role: role }) => role).filter(Boolean))) {
    assert.ok(asrCopyData.asrRole[code][role], `asrRole.${code} missing ${role}`);
  }
  // 速度/准确度是三档刻度，文案表必须为每档提供词。
  for (const axis of ['speed', 'quality']) {
    assert.equal(
      asrCopyData.tiers[code][axis].length,
      3,
      `tiers.${code}.${axis} must have 3 levels`,
    );
  }
}
assert.equal(
  asrCopyData.model.zh['funasr-nano-int8'].tagline,
  '通义实验室推出的轻量语音识别模型，约 8 亿参数，面向中文语音场景。支持普通话、粤语和英语，可识别多种中文方言与地方口音，适合中文会议、访谈和日常讨论。采用量化版本在本机离线运行，兼顾识别效果与资源占用。',
);
assert.equal(
  asrCopyData.model.zh['qwen3-asr-0.6b-int8'].tagline,
  '阿里云 Qwen 团队推出的多语种语音识别模型，约 6 亿参数。支持中、英、日、韩等 30 种语言及 22 种中文方言，覆盖多种地区口音，适合国际会议、跨语言沟通与多语种内容记录。',
);
assert.equal(
  asrCopyData.model.zh['parakeet-tdt-0.6b-v3-int8'].tagline,
  'NVIDIA 推出的高效语音识别模型，约 6 亿参数，支持英语、西班牙语、法语、德语、俄语等 25 种欧洲语言。可自动识别语种，生成标点与英文大小写，适合英语及欧洲语言会议、访谈和长录音转写。',
);
// 内层键集跨语种必须一致。某门语言少写一个字段时，渲染拿到的是 undefined 而不是
// 回落英文——中文界面正常、该语种界面缺一块，这类缺漏只有逐语种比对结构才发现得了。
// `recommended` 是扁平字符串表，不适用。
for (const group of ['asrRole', 'tiers', 'model', 'setup', 'prepare']) {
  const union = new Set();
  for (const code of asrCopyLocales)
    Object.keys(asrCopyData[group][code]).forEach((key) => union.add(key));
  for (const code of asrCopyLocales) {
    const missing = [...union].filter((key) => !(key in asrCopyData[group][code]));
    assert.deepEqual(missing, [], `${group}.${code} 缺少键：${missing.join(', ')}`);
  }
}
// 角色枚举必须与清单一致：清单加了新的 asr_role 而文案表没跟，会在卡片上漏掉角标。
assert.deepEqual(
  [...new Set(modelManifest.map(({ asr_role: role }) => role).filter(Boolean))].sort(),
  Object.keys(asrCopyData.asrRole.en).sort(),
  'asrRole keys must match the asr_role values declared in models.json',
);
// 第 3 条要求：不得用「比 X 慢」这类模型间比较来表达速度。
assert.doesNotMatch(
  text(asrCopy),
  /比 (FunASR|Qwen3|Whisper)/,
  'must not compare models against each other',
);
// 文案只讲「适合什么场景」：不得再单列一行「不适合什么」把缺点摊给用户。
// 这条会拦住 `caveat` 字段和「不支持中文 / 遇到西语会识别失败」这类写法回归。
for (const code of asrCopyLocales) {
  for (const id of asrModelCatalogIds) {
    const { caveat, tagline } = asrCopyData.model[code][id];
    assert.equal(
      caveat,
      undefined,
      `model.${code}.${id} must not carry a downside-only caveat line`,
    );
    assert.doesNotMatch(
      tagline,
      /不支持|识别失败|会失败|fails? on|not supported|no Chinese support|无法/i,
      `model.${code}.${id} must describe what the model suits, not what it cannot do`,
    );
  }
}
assert.doesNotMatch(
  text(asrCopy),
  /caveat:/,
  'asr-copy.js must not expose per-model downside lines',
);
// 首启页不再解释「必需组件无需选择」，tour 页也不再挂那句本机运行的小字。
assert.doesNotMatch(
  text(asrCopy),
  /bundledNote/,
  'bundled components are self-evident; no "no choice needed" note',
);
assert.doesNotMatch(
  text(js),
  /onboarding-tour-hint/,
  'the tour page must not render the removed hint line',
);
assert.match(
  text(html),
  /<script src="\.\/asr-copy\.js"><\/script>/,
  'asr-copy.js must be loaded by index.html',
);
assert.match(
  text(html),
  /i18n-data\.js[\s\S]*asr-copy\.js[\s\S]*app\.js/,
  'asr-copy.js must load after i18n-data.js and before app.js',
);
// ─── 加载顺序契约 ──────────────────────────────────────────────────────────────
//
// 前端是 16 个 classic script 共享一个全局作用域：`index.html` 的顺序**就是**依赖图。
// 危险的不是"文件之间互相引用"（那在函数调用时是安全的），而是**顶层可执行代码引用了
// 尚未加载的符号**——那会在启动时直接 ReferenceError，或者在 app.js 之前读到 undefined。
//
// 这条门禁把「顺序」从隐式约定变成受检不变量。注意它只检查顶层代码：函数体内的引用
// 在调用时解析，只要函数在全部脚本加载后才会被调用就没问题，把它们一并算进来会产生
// 大量误报。花括号深度用于跳过函数体（顶层代码深度为 0）。
//
// 依赖图现在是单向的：state → actions → utils → data → i18n-runtime → views → app。
// 拆环分两步：① app-state.js / app-utils.js 承载共享状态与纯工具；② i18n-runtime.js 前移
// t()（视图模块调用最频繁的符号，125 处），app-actions.js 把 27 处「视图回调进 app.js」
// 变成 appActions 显式登记。在 t 前移之前，任何 ESM 化都无法给视图模块定序。
// 下面的顺序门禁 + 动作接缝门禁共同保证这两条不变量不会被改回去。
const scriptOrder = [...text(html).matchAll(/<script src="\.\/([\w.-]+)"><\/script>/g)].map(
  (match) => match[1],
);
assert.ok(scriptOrder.length >= 10, 'index.html 应显式列出脚本顺序');
assert.ok(scriptOrder.includes('model-selection.js'), '纯逻辑模块必须被加载');
const appActionsSource = (await readFile('app-actions.js')).toString();
const actionListBody = appActionsSource.match(/const APP_ACTION_NAMES = \[([\s\S]*?)\];/);
assert.ok(actionListBody, 'app-actions.js 必须声明 APP_ACTION_NAMES 清单');
const APP_ACTION_NAMES_FOR_TEST = [...actionListBody[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map(
  (match) => match[1],
);
assert.ok(
  APP_ACTION_NAMES_FOR_TEST.length >= 10,
  `动作清单过短：${APP_ACTION_NAMES_FOR_TEST.length}`,
);
const declaredBy = new Map();
const scriptSources = new Map(
  await Promise.all(scriptOrder.map(async (file) => [file, (await readFile(file)).toString()])),
);
scriptOrder.forEach((file, index) => {
  const body = scriptSources.get(file);
  for (const match of body.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm))
    if (!declaredBy.has(match[1])) declaredBy.set(match[1], { file, index });
  for (const match of body.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm))
    if (!declaredBy.has(match[1])) declaredBy.set(match[1], { file, index });
});
// 同一个全局名字被两个脚本重复声明会在解析期直接 SyntaxError（let/const 是脚本级词法
// 绑定，跨脚本共享）。这条门禁让「把状态/工具下沉到叶子模块」这类搬迁有个安全的落地检查：
// 漏删原声明会在这里被抓住，而不是等到用户打开应用。
const declaredTwice = [];
const seenDeclaration = new Map();
for (const file of scriptOrder) {
  const body = scriptSources.get(file);
  const names = [
    ...[...body.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]),
    ...[...body.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]),
  ];
  for (const name of names) {
    if (seenDeclaration.has(name))
      declaredTwice.push(`${name}: ${seenDeclaration.get(name)} 与 ${file}`);
    else seenDeclaration.set(name, file);
  }
}
assert.deepEqual(declaredTwice, [], `全局符号不得重复声明：\n${declaredTwice.join('\n')}`);

// 动作接缝门禁：视图模块不得直接调用定义在 app.js 里的应用动作——必须经过 appActions。
// 这既是 ESM 定序的前提，也让「视图模块能请求哪些应用动作」保持显式。
const viewModules = [
  'ui-components.js',
  'workspaces.js',
  'app-meetings.js',
  'app-meeting-detail.js',
];
const directActionCalls = [];
for (const file of viewModules) {
  const body = scriptSources.get(file);
  assert.ok(body, `${file} 必须由 index.html 加载`);
  for (const name of APP_ACTION_NAMES_FOR_TEST) {
    const direct = new RegExp(`(^|[^\\w.$])${name}\\s*\\(`, 'm');
    if (direct.test(body)) directActionCalls.push(`${file} 直接调用了 ${name}`);
  }
}
assert.deepEqual(
  directActionCalls,
  [],
  `视图模块必须通过 appActions 回调应用层：\n${directActionCalls.join('\n')}`,
);
// 反向：app.js 必须把清单里的每个动作都登记为 appActions 实现，否则调用时会抛「尚未注册」。
const appRegister = text(app).match(/registerAppActions\('app\.js',\s*\{([\s\S]*?)\}\);/);
assert.ok(appRegister, 'app.js 必须调用 registerAppActions');
for (const name of APP_ACTION_NAMES_FOR_TEST) {
  assert.match(appRegister[1], new RegExp(`\\b${name}\\b`), `app.js 未登记应用动作 ${name}`);
}
// i18n 运行时必须在第一个视图模块之前加载，否则视图模块顶层的 t() 会 ReferenceError。
assert.ok(
  scriptOrder.indexOf('i18n-runtime.js') < scriptOrder.indexOf('ui-components.js'),
  'i18n-runtime.js 必须在视图模块之前加载',
);

const orderViolations = [];
scriptOrder.forEach((file, index) => {
  const body = scriptSources.get(file);
  let depth = 0;
  body.split('\n').forEach((line, lineIndex) => {
    const trimmed = line.trim();
    const isTopLevelCode =
      !/^\s/.test(line) &&
      trimmed &&
      !/^(\/\/|\/\*|\*)/.test(trimmed) &&
      !/^(function|const|let|var|class|async function|\}|\)|;)/.test(trimmed);
    if (depth === 0 && isTopLevelCode) {
      for (const match of trimmed.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
        const info = declaredBy.get(match[1]);
        if (info && info.index > index) {
          orderViolations.push(
            `${file}:${lineIndex + 1} 顶层引用了后加载的 ${match[1]}（定义于 ${info.file}）`,
          );
        }
      }
    }
    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
  });
});
assert.deepEqual(
  orderViolations,
  [],
  `顶层代码不得引用后加载的符号，否则启动即报错：\n${orderViolations.join('\n')}`,
);
const componentContext = {};
runInNewContext(text(components), componentContext);
// 动效只处理真实键盘点击，不改变点击行为；快速重复按键取消上一段反馈。
let keyboardPress;
let reduceButtonMotion = false;
let cancelPressCount = 0;
const buttonAnimations = [];
runInNewContext(text(components), {
  document: {
    addEventListener(type, handler, capture) {
      if (type === 'click' && capture === true) {
        keyboardPress = handler;
        assert.equal(capture, true);
      }
    },
  },
  getComputedStyle: () => ({ getPropertyValue: () => '1' }),
  matchMedia: () => ({ matches: reduceButtonMotion }),
});
const motionButton = {
  disabled: false,
  closest() {
    return this;
  },
  matches() {
    return this.disabled;
  },
  animate(frames, options) {
    buttonAnimations.push({ frames, options });
    return { cancel: () => cancelPressCount++ };
  },
};
const pressEvent = { target: motionButton, isTrusted: true, detail: 0 };
keyboardPress(pressEvent);
assert.equal(buttonAnimations.length, 1);
assert.equal(buttonAnimations[0].options.duration, 260);
assert.equal(buttonAnimations[0].frames[1].scale, '.98');
keyboardPress(pressEvent);
assert.equal(cancelPressCount, 1);
reduceButtonMotion = true;
keyboardPress(pressEvent);
reduceButtonMotion = false;
motionButton.disabled = true;
keyboardPress(pressEvent);
motionButton.disabled = false;
keyboardPress({ ...pressEvent, isTrusted: false });
keyboardPress({ ...pressEvent, detail: 1 });
assert.equal(buttonAnimations.length, 2, '减少动态、禁用和非键盘点击不启动补充动画');
assert.match(componentContext.renderTaskProgressLabel('<long title>', 0), /&lt;long title&gt;/);
assert.match(componentContext.renderTaskProgressLabel('Meeting', 0), /task-progress-value.*0%/);
assert.doesNotMatch(componentContext.renderTaskProgressLabel('Waiting'), /task-progress-value/);
const readOnlyTasks = componentContext.renderMarkdown('- [ ] Pending\n- [x] Done');
assert.match(readOnlyTasks, /class="markdown-task-mark" role="checkbox" aria-checked="false"/);
assert.match(readOnlyTasks, /aria-checked="true"/);
assert.doesNotMatch(readOnlyTasks, /☐|☑/);
assert.match(
  componentContext.renderMarkdown('- parent\n  - child'),
  /<ul><li>parent<ul><li>child<\/li><\/ul><\/li><\/ul>/,
);
assert.match(
  componentContext.renderMarkdown('1. parent\n  1. child'),
  /<ol><li>parent<ol><li>child<\/li><\/ol><\/li><\/ol>/,
);
assert.match(
  componentContext.renderMarkdown('- parent\n  - child\n    - grandchild'),
  /<ul><li>parent<ul><li>child<ul><li>grandchild<\/li><\/ul><\/li><\/ul><\/li><\/ul>/,
);
for (const source of [
  '***bold***',
  '---heading',
  '___abc',
  'text\n***bold***',
  '# Heading\n---\nend',
]) {
  componentContext.markdownRegression = source;
  assert.ok(
    runInNewContext('renderMarkdown(markdownRegression)', componentContext, {
      timeout: 1000,
    }).includes('<'),
    'Markdown parser must make progress',
  );
}
const mediaContext = {
  setTimeout,
  clearTimeout,
  window: {},
  navigator: { mediaDevices: {} },
  console,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  performance: globalThis.performance,
};
runInNewContext(`${text(backendClient)}\nthis.AudioCapture = AudioCapture;`, mediaContext);
// 手机作为音频源时只调用采集接口，不打开电脑上的媒体设备。
const phoneCalls = [];
const phoneContext = {
  window: {
    brevia: {
      mobile: {
        startCapture: async (payload) => {
          phoneCalls.push(payload);
          return { id: 'desktop-phone', tags: ['手机录音', '手机麦克风'] };
        },
        pauseCapture: async (payload) => {
          phoneCalls.push(payload);
          return { requested: true };
        },
      },
    },
  },
};
runInNewContext(text(backendClient), phoneContext);
const phoneClient = phoneContext.window.breviaClient;
await phoneClient.start(
  { title: 'Desktop' },
  { mic: false, system: false, phone: 'paired-device' },
);
assert.equal(phoneClient.capture, null);
assert.equal(phoneClient.state.meeting.id, 'desktop-phone');
assert.equal(phoneCalls[0].device_id, 'paired-device');
await phoneClient.pause(true);
assert.equal(phoneCalls[1].meeting_id, 'desktop-phone');
assert.equal(phoneCalls[1].paused, true);
const stoppedTracks = [];
const loopbackAudio = {
  readyState: 'live',
  stop() {
    stoppedTracks.push('audio');
  },
};
const displayVideo = {
  readyState: 'live',
  stop() {
    stoppedTracks.push('video');
  },
};
mediaContext.stopMediaStream({
  getVideoTracks: () => [displayVideo],
  getAudioTracks: () => [loopbackAudio],
});
assert.deepEqual(stoppedTracks, ['video', 'audio']);
mediaContext.stopMediaStream({
  getVideoTracks: () => [displayVideo],
  getAudioTracks: () => [loopbackAudio],
});
assert.deepEqual(stoppedTracks, ['video', 'audio']);
const microphone = {
  readyState: 'live',
  stop() {
    stoppedTracks.push('mic');
  },
};
mediaContext.stopMediaStream({ getVideoTracks: () => [], getAudioTracks: () => [microphone] });
assert.deepEqual(stoppedTracks, ['video', 'audio', 'mic']);
// 48 kHz input blocks do not divide evenly into 16 kHz samples. Keep the
// resampling window continuous so a block boundary neither skips nor repeats audio.
const resampleCapture = new mediaContext.AudioCapture(
  () => {},
  () => {},
);
const resampleResource = { resampler: null };
const resampled = [];
for (let block = 0; block < 3; block += 1) {
  const input = Float32Array.from({ length: 8192 }, (_, index) => block * 8192 + index);
  resampled.push(...resampleCapture.resample(resampleResource, input, 48000).samples);
}
resampled.push(
  ...resampleCapture.resample(resampleResource, new Float32Array(), 48000, true).samples,
);
assert.equal(resampled.length, 8192, 'resampling preserves the cumulative 48 kHz duration');
assert.deepEqual(
  resampled.slice(5458, 5463),
  [16375, 16378, 16381, 16384, 16387],
  'resampling remains continuous across 8192-sample blocks',
);
let displayConstraints;
const capturedAudio = { readyState: 'live', stop() {} };
const capturedVideo = { readyState: 'live', stop() {} };
mediaContext.navigator.mediaDevices.getDisplayMedia = async (constraints) => {
  displayConstraints = constraints;
  return { getAudioTracks: () => [capturedAudio], getVideoTracks: () => [capturedVideo] };
};
const systemCapture = new mediaContext.AudioCapture(
  () => {},
  () => {},
);
await systemCapture.prepare({ mic: false, system: true });
assert.equal(displayConstraints.audio.systemAudio, 'include');
assert.equal(systemCapture.pendingStreams[0].track, 'system');
await systemCapture.stop();
// Mic device selection: explicit deviceId is passed through as an exact constraint.
let micConstraints;
mediaContext.navigator.mediaDevices.getUserMedia = async (constraints) => {
  micConstraints = constraints;
  if (['dead-device', 'missing-constraint'].includes(constraints.audio?.deviceId?.exact)) {
    const err = new Error('gone');
    err.name =
      constraints.audio.deviceId.exact === 'dead-device' ? 'NotFoundError' : 'OverconstrainedError';
    err.constraint = 'deviceId';
    throw err;
  }
  return { getVideoTracks: () => [], getAudioTracks: () => [{ readyState: 'live', stop() {} }] };
};
const micCapture = new mediaContext.AudioCapture(
  () => {},
  () => {},
);
micCapture.micDeviceId = 'builtin-mic-id';
await micCapture.requestTrack('mic');
assert.equal(
  micConstraints.audio.deviceId.exact,
  'builtin-mic-id',
  'selected mic is pinned via exact deviceId',
);
// A selected device that disappears (e.g. headset unplugged) falls back to the system default.
micCapture.micDeviceId = 'dead-device';
await micCapture.requestTrack('mic');
assert.equal(micCapture.micDeviceId, '', 'falls back to default device');
assert.equal(micConstraints.audio.deviceId, undefined, 'fallback uses no deviceId');
assert.equal(micCapture.micFellBack, true, 'records the fallback');
micCapture.micDeviceId = 'missing-constraint';
await micCapture.requestTrack('mic');
assert.equal(micCapture.micDeviceId, '', 'an unavailable exact device constraint also falls back');
// previewMic reports a fallback so the UI can resync the picker.
const mockNode = () => ({ connect() {}, disconnect() {}, port: { onmessage: null, close() {} } });
mediaContext.AudioContext = class {
  constructor() {
    this.audioWorklet = { addModule: async () => {} };
    this.state = 'suspended';
  }
  createMediaStreamSource() {
    return mockNode();
  }
  async resume() {
    this.state = 'running';
  }
  async close() {}
};
mediaContext.AudioWorkletNode = function AudioWorkletNode() {
  return mockNode();
};
micCapture.micDeviceId = 'dead-device';
const previewFellBack = await micCapture.previewMic();
assert.equal(previewFellBack, true, 'preview reports device fallback');
await micCapture.stopPreview();
let resolvePreview;
let openedPreviews = 0;
let stoppedPreview = 0;
micCapture.openMicStream = () => {
  openedPreviews += 1;
  return new Promise((resolve) => {
    resolvePreview = resolve;
  });
};
const pendingPreview = micCapture.previewMic();
await micCapture.previewMic();
assert.equal(openedPreviews, 1, 'concurrent previews share one pending microphone acquisition');
await micCapture.stopPreview();
const lateTrack = {
  readyState: 'live',
  stop() {
    stoppedPreview += 1;
  },
};
resolvePreview({ getVideoTracks: () => [], getAudioTracks: () => [lateTrack] });
await pendingPreview;
assert.equal(
  stoppedPreview,
  1,
  'leaving the page releases a microphone acquired after cancellation',
);
assert.equal(micCapture.preview, null);
const pauseCapture = new mediaContext.AudioCapture();
const contextStates = [];
pauseCapture.sources = [
  {
    context: {
      state: 'running',
      async suspend() {
        contextStates.push('suspend');
        this.state = 'suspended';
      },
      async resume() {
        contextStates.push('resume');
        this.state = 'running';
      },
    },
  },
];
await pauseCapture.setPaused(true);
await pauseCapture.setPaused(false);
assert.deepEqual(contextStates, ['suspend', 'resume']);
let audioContexts = 0,
  closedAudioContexts = 0;
const sharedProcessors = [];
mediaContext.AudioContext = class {
  constructor() {
    audioContexts += 1;
    this.sampleRate = 48000;
    this.state = 'suspended';
    this.audioWorklet = { addModule: async () => {} };
  }
  createMediaStreamSource() {
    return mockNode();
  }
  async resume() {
    this.state = 'running';
    for (const node of sharedProcessors)
      if (!node.sent) {
        node.sent = true;
        node.port.onmessage({
          data: { samples: new Float32Array(8192), level: 0, startFrame: 48000 },
        });
      }
  }
  async close() {
    this.state = 'closed';
    closedAudioContexts += 1;
  }
  async suspend() {
    this.state = 'suspended';
  }
};
mediaContext.AudioWorkletNode = function AudioWorkletNode() {
  const node = mockNode();
  node.port.postMessage = () => {
    node.port.onmessage({
      data: { samples: new Float32Array(1000), level: 0, startFrame: 56192 },
    });
    node.port.onmessage({ data: { flushed: true } });
  };
  sharedProcessors.push(node);
  return node;
};
const clockFrames = [];
const clockCapture = new mediaContext.AudioCapture(async (frame) => clockFrames.push(frame));
clockCapture.pendingStreams = ['mic', 'system'].map((track) => ({
  track,
  stream: {
    getAudioTracks: () => [{ readyState: 'live', stop() {} }],
    getVideoTracks: () => [],
  },
}));
await clockCapture.start('clock-meeting');
assert.equal(audioContexts, 1, 'both capture streams share one Web Audio clock');
assert.equal(clockCapture.sources[0].context, clockCapture.sources[1].context);
assert.deepEqual(
  clockFrames.map((frame) => frame.start_ms),
  [1000, 1000],
  'IPC scheduling cannot change audio start times',
);
await clockCapture.stop();
assert.equal(closedAudioContexts, 1, 'the shared context closes exactly once');
for (const paused of [false, true]) {
  const frames = [];
  const capture = new mediaContext.AudioCapture(async (frame) => frames.push(frame));
  capture.pendingStreams = [
    {
      track: 'mic',
      stream: {
        getAudioTracks: () => [{ readyState: 'live', stop() {} }],
        getVideoTracks: () => [],
      },
    },
  ];
  await capture.start('tail-meeting');
  if (paused) await capture.setPaused(true);
  await capture.stop();
  assert.equal(
    frames.reduce((samples, frame) => samples + Buffer.from(frame.pcm, 'base64').length / 2, 0),
    Math.round((8192 + 1000) / 3),
    `ending ${paused ? 'paused' : 'running'} capture preserves and resamples the worklet tail`,
  );
}
let releaseFirstAudio;
const sentAudio = [];
const batchingCapture = new mediaContext.AudioCapture((payload) => {
  sentAudio.push(payload);
  if (sentAudio.length === 1)
    return new Promise((resolve) => {
      releaseFirstAudio = resolve;
    });
});
batchingCapture.meetingId = 'meeting';
const batchingResource = {
  track: 'mic',
  pendingPcm: [],
  pendingSamples: 0,
  pendingStartMs: null,
  inFlight: null,
};
batchingCapture.enqueue(batchingResource, new Int16Array([1, 2]), 0);
batchingCapture.enqueue(batchingResource, new Int16Array([3, 4]), 1);
assert.equal(sentAudio.length, 1, 'only one audio request is in flight');
releaseFirstAudio();
await batchingResource.inFlight;
const secondAudio = Buffer.from(sentAudio[1].pcm, 'base64');
assert.deepEqual([secondAudio.readInt16LE(0), secondAudio.readInt16LE(2)], [3, 4]);
mediaContext.navigator.mediaDevices.getDisplayMedia = async () => ({
  getAudioTracks: () => [],
  getVideoTracks: () => [{ readyState: 'live', stop() {} }],
});
await assert.rejects(
  new mediaContext.AudioCapture().prepare({ mic: false, system: true }),
  /未检测到系统音频/,
);
const localeContext = { window: {} };
runInNewContext(text(i18nData), localeContext);
const i18nRuntimeSource = await readFile('i18n-runtime.js', 'utf8');
assert.doesNotThrow(() => runInNewContext(i18nRuntimeSource, { window: localeContext.window }));
for (const stored of ['zh', 'en', 'de', 'fr-CA', '__proto__', '']) {
  const context = { window: localeContext.window, locale: stored };
  runInNewContext(i18nRuntimeSource, context);
  runInNewContext(text(app).slice(0, text(app).indexOf('const views')), context);
  assert.equal(context.locale, ['zh', 'en', 'de'].includes(stored) ? stored : 'zh');
  assert.ok(runInNewContext("t('转写中')", context));
}
for (const code of asrCopyLocales) {
  const storage = localeContext.window.BreviaLocaleData.onboardingStorageCopy;
  assert.deepEqual(
    Object.keys(storage[code]).sort(),
    Object.keys(storage.en).sort(),
    `${code} storage labels must be complete`,
  );
  for (const key of [
    '请选择空文件夹。',
    '请先结束会议、精修和模型下载，再更改文件夹。',
    '模型和录音文件夹必须相互独立，且不能包含原数据文件夹。',
    '此文件夹由环境变量指定，无法在应用内更改。',
    '文件夹更改失败，请检查路径、磁盘连接和写入权限。',
  ]) {
    assert.ok(
      localeContext.window.BreviaLocaleData.catalog[code].labels[key],
      `${code} missing storage error: ${key}`,
    );
  }
}
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  assert.ok(
    localeContext.window.BreviaLocaleData.catalog[code].labels['言录需要以下系统权限以提供服务'],
    `${code} missing onboarding permission copy`,
  );
}
// 新引导动效的状态和样例正文都由同一份八语种词条供给。
const motionCopy = localeContext.window.BreviaLocaleData.onboardingMotionCopy;
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  assert.deepEqual(Object.keys(motionCopy[code]).sort(), Object.keys(motionCopy.en).sort());
  for (const [key, value] of Object.entries(motionCopy[code])) {
    assert.equal(typeof value, 'string', `${code} motion ${key}`);
    assert.ok(value.trim(), `${code} motion ${key} cannot be empty`);
    if (code !== 'zh' && code !== 'ja')
      assert.doesNotMatch(value, /[\u4e00-\u9fff]/, `${code} motion ${key}`);
  }
}
// 独立预览已退役，直接校验应用实际加载的组件及八语种正文。
const motionEscapeHtml = runInNewContext('escapeHtml', componentContext);
const motionContext = {
  window: localeContext.window,
  escapeHtml: motionEscapeHtml,
};
runInNewContext(await readFile('onboarding-motion.js', 'utf8'), motionContext);
for (const code of Object.keys(motionCopy)) {
  for (const stage of ['language', 'permissions', 'setup', 'ai', 'phone']) {
    const rendered = motionContext.window.BreviaOnboardingMotion.render(stage, code);
    for (const key of ['recordHeading', 'transcriptHeading', 'summaryHeading'])
      assert.ok(
        rendered.includes(motionEscapeHtml(motionCopy[code][key])),
        `${stage} ${code} must render the application copy: ${key}`,
      );
  }
}
assert.match(text(html), /src="\.\/onboarding-motion\.js"/);
assert.match(text(html), /href="\.\/onboarding-motion\.css"/);
assert.ok((await readFile('onboarding-motion.css', 'utf8')).includes('.bom'));
assert.ok((await readFile('assets/brevia-mark.svg', 'utf8')).includes('<svg'));
const i18nStaticKeys = new Set(
  [
    text(app),
    text(meetings),
    text(meetingDetail),
    text(workspaces),
    text(components),
    await readFile('mobile-connection.js', 'utf8'),
    await readFile('transcript-corrections.js', 'utf8'),
  ].flatMap((source) => [...source.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)].map((match) => match[1])),
);
for (const key of i18nStaticKeys)
  for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
    assert.ok(
      localeContext.window.BreviaLocaleData.appCopy.stageLabels[key]?.[code] ||
        localeContext.window.BreviaLocaleData.catalog[code].labels[key],
      `missing ${code} translation for ${key}`,
    );
  }
const meetingCacheStorage = new Map([
  [
    'brevia-meetings-v1',
    JSON.stringify({ savedAt: Date.now(), meetings: [{ id: 'cached', deleted: false }] }),
  ],
]);
const meetingCacheContext = {
  uiData: { meetings: [] },
  window: { brevia: {} },
  activeLibraryNav: 'all-meetings',
  meetingSearch: { value: '' },
  localStorage: {
    getItem: (key) => meetingCacheStorage.get(key) || null,
    setItem: (key, value) => meetingCacheStorage.set(key, value),
    removeItem: (key) => meetingCacheStorage.delete(key),
  },
};
runInNewContext(text(meetings), meetingCacheContext);
assert.equal(meetingCacheContext.uiData.meetings[0].id, 'cached');
meetingCacheContext.uiData.meetings.push({ id: 'deleted', deleted: true });
meetingCacheContext.cacheMeetingList();
assert.deepEqual(
  JSON.parse(meetingCacheStorage.get('brevia-meetings-v1')).meetings.map(({ id }) => id),
  ['cached'],
);
const advancedDescription = '调整识别、端点检测、说话人分离和本地模型运行参数。';
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'])
  assert.notEqual(
    localeContext.window.BreviaLocaleData.catalog[code].labels[advancedDescription],
    advancedDescription,
  );
const runtimeI18nKeys = [
  '离线功能',
  '请选择声音',
  '请先配置翻译模型',
  '纪要服务拒绝了请求',
  '纪要模型需要配置',
  '请先选择译文目标并配置纪要模型',
  '将确认字幕发送到 {provider} 生成译文。是否继续？',
  '选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a',
  '刚刚',
  '已导出「{title}」',
  '示例会议及录音已删除',
  '会议已移至最近删除',
  '暂停录音',
  '播放录音',
  '这场会议没有可播放的录音',
  '纪要配置加载失败',
  '配置或后端启动失败',
  '翻译失败',
  '压缩包已导出',
  '未找到录音，已导出逐字稿压缩包',
  '内置纪要模型清单暂不可用。',
  '请先选择或填写纪要模型。',
  '请填写请求地址。',
  '请填写 API Key。',
  '纪要模型已保存',
  '结束中',
];
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'])
  for (const key of runtimeI18nKeys)
    assert.notEqual(localeContext.window.BreviaLocaleData.catalog[code].labels[key], key);
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  for (const key of ['删除此设备上的会议录音、转写文本与笔记。', '清空已下载的模型文件。']) {
    const value = localeContext.window.BreviaLocaleData.catalog[code].labels[key];
    assert.ok(value && value !== key, `${code}: ${key}`);
  }
}
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  // ja 的「行数 / 列数」与中文同形，因此只校验键存在，另有英文差异校验兜底。
  for (const key of ['已暂停', '行数', '列数', '插入', '选择行列数', '列 {n}']) {
    assert.ok(
      localeContext.window.BreviaLocaleData.catalog[code].labels[key],
      `missing ${code} translation for ${key}`,
    );
  }
  assert.match(
    localeContext.window.BreviaLocaleData.catalog[code].labels['列 {n}'],
    /\{n\}/,
    `${code} column label keeps the number placeholder`,
  );
}
for (const key of ['已暂停', '行数', '列数', '插入', '选择行列数']) {
  assert.notEqual(
    localeContext.window.BreviaLocaleData.catalog.en.labels[key],
    localeContext.window.BreviaLocaleData.catalog.zh.labels[key],
    `en must localize ${key}`,
  );
}
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'])
  assert.notEqual(
    localeContext.window.BreviaLocaleData.catalog[code].labels['添加录音到声纹库'],
    '添加录音到声纹库',
  );
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'])
  assert.notEqual(
    localeContext.window.BreviaLocaleData.catalog[code].labels['清空数据'],
    '清空数据',
  );
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  assert.notEqual(
    localeContext.window.BreviaLocaleData.catalog[code].labels['VAD 模型'],
    'VAD 模型',
  );
  assert.notEqual(localeContext.window.BreviaLocaleData.catalog[code].labels['确认'], '确认');
}
// index.html 里写死的 aria-label/title/placeholder 只有登记进 catalog.zh.labels，
// collectTranslations 才会在切换语言时替换；漏登记会让无障碍属性永远保持中文。
{
  const zhLabels = localeContext.window.BreviaLocaleData.catalog.zh.labels;
  for (const [, value] of text(html).matchAll(/(?:aria-label|title|placeholder)="([^"]+)"/g)) {
    if (value.includes('${') || value === 'GitHub') continue;
    assert.ok(value in zhLabels, `index.html 的静态属性必须可翻译：${value}`);
    for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
      // 只断言「登记了译文」，不断言与中文不同：日语的「最小化」本就与中文同形。
      assert.ok(
        value in localeContext.window.BreviaLocaleData.catalog[code].labels,
        `${code} 缺少翻译：${value}`,
      );
    }
  }
}
// i18n 里那份与清单平行的显示数组（modalCopy[*].models.items）已整体删除：它靠数组
// 下标与 modelIds 对齐，改清单顺序就会静默错位，而且模型库里每个字段清单本来就有。
// 现在只保留 title，其余展示数据一律来自 models.json。
for (const code of asrCopyLocales) {
  const models = localeContext.window.BreviaLocaleData.appCopy.modalCopy[code].models;
  assert.deepEqual(
    Object.keys(models),
    ['title'],
    `${code}: modal copy must only carry the library title`,
  );
  assert.equal(models.items, undefined, `${code}: the index-aligned model array must stay deleted`);
}
assert.doesNotMatch(
  text(js),
  /models\.items/,
  'app.js must not read the index-aligned model array',
);
assert.doesNotMatch(
  text(i18nData),
  /removedSpeechModels|additionalStreamingModels|Streaming Zipformer/,
  'the retired-model copy blocks must stay deleted',
);
for (const id of [
  'vits-mimic3-ko-kss-low',
  'vits-piper-fr-siwis-medium-int8',
  'vits-piper-de-thorsten-medium-int8',
  'vits-piper-es-sharvard-medium-int8',
  'vits-piper-ru-irina-medium-int8',
  'zipformer-zh-streaming-int8',
  'zipformer-ctc-zh-streaming-int8',
  'paraformer-zh-en-int8',
  'whisper-turbo',
  'fire-red-asr2-ctc-zh-en-int8',
  'nemo-titanet-small-en',
  'campplus-zh-en',
]) {
  assert.equal(
    modelManifest.find((entry) => entry.id === id),
    undefined,
    `pruned model ${id} still in manifest`,
  );
  assert.doesNotMatch(
    text(js),
    new RegExp(`'${id}'`),
    `pruned model ${id} still referenced in app js`,
  );
}
assert.equal(
  componentContext.rectanglesIntersect(
    { left: 0, right: 10, top: 0, bottom: 10 },
    { left: 8, right: 12, top: 8, bottom: 12 },
  ),
  true,
);
assert.equal(
  componentContext.rectanglesIntersect(
    { left: 0, right: 2, top: 0, bottom: 2 },
    { left: 3, right: 5, top: 3, bottom: 5 },
  ),
  false,
);
componentContext.t = (value) => value;
componentContext.editingMeetingIndex = null;
componentContext.categories = [];
assert.doesNotMatch(
  componentContext.renderMeetingRow(
    {
      id: 'active',
      tone: 'violet',
      title: 'Active',
      meta: '',
      tags: [],
      status: { tone: 'processing' },
    },
    0,
  ),
  /data-meeting-action="delete"/,
);
assert.match(
  componentContext.renderMeetingRow(
    { id: 'drag-me', tone: 'violet', title: 'Meeting', meta: '', tags: [], status: {} },
    0,
  ),
  /draggable="true"/,
);
// 录制中会议行的次要信息存的是文案 key，renderMeetingRow 必须翻一次——漏掉会让所有非中文
// 界面的会议库在标题下显示「本地保存」。
componentContext.t = (value) => ({ 本地保存: 'Saved locally' })[value] || value;
assert.match(
  componentContext.renderMeetingRow(
    {
      id: 'rec',
      tone: 'violet',
      title: 'M',
      meta: '',
      tags: [],
      status: { tone: 'processing', label: '正在录制', detail: '本地保存' },
    },
    0,
  ),
  /Saved locally/,
  'meeting-row detail must be translated',
);
componentContext.t = (value) => value;
assert.doesNotMatch(
  componentContext.renderTranscriptSegment({
    time: '00:00',
    speaker: { name: 'A' },
    text: '<img src=x onerror=alert(1)>',
  }),
  /<img/,
);
assert.match(
  componentContext.renderTranscriptSegment({
    time: '00:00',
    speaker: { name: 'A', overlapNames: ['A', 'B'] },
    text: 'test',
  }),
  /重叠说话：A、B/,
);
assert.doesNotMatch(
  componentContext.renderTranscriptSegment({
    time: '00:00',
    speaker: { name: 'Speaker 1' },
    text: 'test',
    showSpeaker: false,
  }),
  /Speaker 1/,
);
// 逐句编辑只替换正文：读态是 <p>，编辑态是可输入的文本域，两者都按 id 定位段落。
const readonlySegment = componentContext.renderTranscriptSegment({
  time: '00:00',
  speaker: { name: 'A' },
  text: '第一句',
  segmentId: 'seg-1',
});
assert.doesNotMatch(readonlySegment, /<textarea/, 'a read-only subtitle stays plain text');
const editingSegment = componentContext.renderTranscriptSegment({
  time: '00:00',
  startSeconds: 12,
  endSeconds: 18,
  speaker: { name: 'A' },
  text: '第一句',
  segmentId: 'seg-1',
  textEditable: true,
});
assert.match(
  editingSegment,
  /<textarea[^>]*data-segment-text="seg-1"[^>]*>第一句<\/textarea>/,
  'the edit action turns the subtitle into an editable field',
);
assert.match(editingSegment, /data-start=|data-end=/, 'editing keeps playback alignment');
const translatedEdit = componentContext.renderTranscriptSegment({
  time: '00:00',
  speaker: { name: 'A' },
  text: '新字幕',
  translation: 'Original translation',
  segmentId: 'seg-1',
  textEditable: true,
  textModified: true,
});
assert.match(translatedEdit, /译文（未更新）/);
assert.match(translatedEdit, /class="translation"[^>]*>.*Original translation<\/p>/);
assert.equal(
  (translatedEdit.match(/<textarea/g) || []).length,
  1,
  'translation remains read-only while its source is modified',
);
assert.doesNotMatch(
  componentContext.renderTranscriptSegment({
    time: '00:00',
    speaker: { name: 'A' },
    text: 'test',
    textEditable: true,
  }),
  /<textarea/,
  'live captions without a stored segment cannot be edited',
);
assert.doesNotMatch(
  componentContext.renderTranscriptSegment({
    time: '00:00',
    speaker: { name: 'A' },
    text: '2026 的问题？',
    segmentId: 'seg-1',
    textEditable: true,
  }),
  /caption-signals/,
  'stale signal badges are hidden while the text is being rewritten',
);
// tabbar 的铅笔跟随激活 tab：笔记页编辑笔记，字幕页编辑字幕，录制中 / 精修中不提供入口。
const detailTabbarContext = {
  uiData: { detail: { hasRefined: false, refineState: 'idle', transcriptEditable: true } },
  detailActiveTab: 'notes',
  locale: 'zh',
  t: (value) => value,
  BreviaI18n: {
    languageOptions: () => [['auto', '多语言混说']],
    languageName: (_locale, code) => code,
  },
};
runInNewContext(text(components), detailTabbarContext);
assert.match(
  detailTabbarContext.renderDetailTabbar(),
  /data-edit-notes type=/,
  'the notes tab offers the notes editor',
);
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /refine-wrap|detail-translation-action|已精修/,
  'notes keep refinement controls out of the tabbar',
);
detailTabbarContext.detailActiveTab = 'transcript';
assert.match(
  detailTabbarContext.renderDetailTabbar(),
  /data-edit-transcript type=/,
  'the subtitle tab offers the subtitle editor',
);
assert.match(
  detailTabbarContext.renderDetailTabbar(),
  /refine-wrap/,
  'the subtitle tab keeps the refinement entry point',
);
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /data-edit-notes/,
  'the notes action gives way to the subtitle action',
);
detailTabbarContext.uiData.detail.transcriptEditable = false;
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /data-edit-transcript/,
  'a recording meeting cannot be edited',
);
detailTabbarContext.uiData.detail.transcriptEditable = true;
detailTabbarContext.uiData.detail.refineState = 'refining';
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /data-edit-transcript/,
  'a running refinement blocks subtitle edits',
);
detailTabbarContext.uiData.detail.refineState = 'idle';
detailTabbarContext.uiData.detail.transcriptEditing = true;
assert.match(
  detailTabbarContext.renderDetailTabbar(),
  /data-transcript-save type="button"[^>]*aria-label="保存"/,
  'editing subtitles swaps in the save action',
);
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /refine-wrap/,
  'editing subtitles retires the refinement entry point so unsaved drafts cannot be replaced',
);
assert.match(
  text(app),
  /detailActiveTab = 'transcript';\n    renderMeetingDetail\(\);/,
  'leaving subtitle editing returns to the subtitle panel',
);
detailTabbarContext.uiData.detail.transcriptEditing = false;
detailTabbarContext.uiData.detail.refinedMode = 'fulltext';
detailTabbarContext.uiData.detail.hasRefined = true;
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /data-edit-transcript/,
  'a full-text refinement has no per-sentence subtitles to edit',
);
assert.doesNotMatch(
  componentContext.renderMeetingSummary({
    title: '<script>alert(1)</script>',
    sections: [{ title: 'Note', text: '<img src=x>' }],
    participants: [{ name: '<script>alert(1)</script>' }],
  }),
  /<script>|<img/,
);

for (const id of [
  'home-view',
  'prepare-view',
  'live-view',
  'detail-view',
  'settings-view',
  'meeting-form',
  'end-meeting',
]) {
  assert.match(text(html), new RegExp(`id="${id}"`));
}
assert.match(text(html), /Content-Security-Policy/);
assert.match(text(html), /frame-src 'none'/);
assert.doesNotMatch(text(preload), /secret\.get/);
assert.match(
  text(electronMain),
  /printToPDF\(\{\s*printBackground: true,\s*displayHeaderFooter: true,/,
);
assert.match(text(css), /prefers-reduced-motion:\s*reduce/);
assert.match(text(css), /\.window-bar\{[^}]*-webkit-app-region:drag/);
assert.match(text(css), /\.window-bar\{[^}]*position:sticky/);
assert.match(
  text(css),
  /\.refine-menu-speakers input:not\(\[type=checkbox\]\):not\(\[type=range\]\):not\(\[type=radio\]\),\.refine-menu-speakers \.flow-select-toggle\{[^}]*width:144px/,
);
assert.match(text(css), /\.refine-menu-speakers input:focus\{[^}]*border-color:#000/);
assert.doesNotMatch(
  text(i18nData),
  /refinedModelOptionTags/,
  'the unconsumed per-model tag table must stay deleted',
);
assert.equal(localeContext.window.BreviaLocaleData.refinedModelOptionTags, undefined);
assert.match(text(app), /refineState = 'refining'/);
assert.match(text(app), /function openSegmentProfilePanel/);
assert.doesNotMatch(text(app), /fitSegmentSubmenu/);
assert.match(text(app), /data-segment-profile-search/);
// 旧片段的 play() 失败不能污染重新打开的面板。
let rejectOldPreview;
let profileClick;
const previewContext = {
  segmentProfilePanel: {
    addEventListener: (_type, listener) => {
      profileClick = listener;
    },
  },
  segmentProfileDraft: { segment: { start_ms: 0, end_ms: 1000 } },
  segmentProfileAudio: {
    paused: true,
    currentTime: 0,
    play: () =>
      new Promise((_resolve, reject) => {
        rejectOldPreview = reject;
      }),
  },
  playerAudio: { pause() {} },
  userFacingError: (message) => message,
  renderSegmentProfilePanel() {},
};
runInNewContext(
  text(app).slice(
    text(app).indexOf("segmentProfilePanel.addEventListener('click',"),
    text(app).indexOf("segmentProfilePanel.addEventListener('input',"),
  ),
  previewContext,
);
profileClick({
  target: { closest: (selector) => (selector === '[data-preview-segment-profile]' ? {} : null) },
});
previewContext.segmentProfileDraft = { segment: { start_ms: 2000, end_ms: 3000 } };
rejectOldPreview(new Error('old playback aborted'));
await Promise.resolve();
assert.equal(
  previewContext.segmentProfileDraft.error,
  undefined,
  'stale playback must not mark the next clip as broken',
);

// 保存后即使面板已关闭，同一会议仍同步结果；不能覆盖用户后来打开的另一会议。
for (const activeId of ['saved-meeting', 'another-meeting']) {
  let completeProfileSave;
  let appliedMeeting;
  const profileContext = {
    segmentProfileDraft: {
      meetingId: 'saved-meeting',
      segmentId: 'clip',
      profileId: 'person',
      url: 'audio',
    },
    speakerProfiles: [{ id: 'person', name: 'Alex' }],
    speakerProfileName: (profile) => profile.name,
    segmentProfileAudio: { pause() {} },
    renderSegmentProfilePanel() {},
    currentMeetingDetail: { id: activeId },
    applyBackendDetail: (meeting) => {
      appliedMeeting = meeting;
    },
    window: {
      brevia: {
        segment: {
          addProfileSample: () =>
            new Promise((resolve) => {
              completeProfileSave = resolve;
            }),
        },
        speakerProfile: { list: async () => [{ id: 'person', name: 'Alex', sample_count: 1 }] },
      },
    },
  };
  runInNewContext(
    text(app).slice(
      text(app).indexOf('async function saveSegmentProfile()'),
      text(app).indexOf("segmentProfilePanel.addEventListener('click',"),
    ),
    profileContext,
  );
  const saving = profileContext.saveSegmentProfile();
  profileContext.segmentProfileDraft = undefined;
  completeProfileSave({ id: 'saved-meeting' });
  await saving;
  assert.equal(appliedMeeting?.id, activeId === 'saved-meeting' ? activeId : undefined);
}

assert.match(text(components), /data-tooltip-key="\$\{key\}"/);
assert.match(text(app), /document\.querySelectorAll\('\[data-tooltip-key\]'\)/);
assert.match(text(components), /document\.body\.append\(pageTooltip\)/);
assert.match(text(tailwind), /\.page-tooltip\s+\{\s+position:\s+fixed;\s+z-index:\s+100/);
assert.match(
  text(tailwind),
  /\.page-tooltip\s+\{[^}]*width:\s+max-content;\s+max-width:\s+min\(360px,\s+calc\(100vw\s+-\s+16px\)\)/,
);
assert.match(text(js), /function positionFloating/);
assert.match(
  text(js),
  /placements\s*\.map\(\s*\(\s*placement,?\s*\)\s+=>\s+positions\[\s*placement,?\s*\],?\s*\)\s*\.find/,
);
assert.match(
  text(js),
  /Math\.max\(8, Math\.min\(position\.left, window\.innerWidth - width - 8\)\)/,
);
assert.match(text(css), /\.app-shell\{[^}]*grid-template-columns:272px minmax\(0,1fr\)/);
assert.match(text(workspaces), /class="new-workspace"/);
assert.match(text(tailwind), /#settings-view\s+\.settings-card\s+\{\s+@apply\s+min-h-20/);
assert.match(text(tailwind), /#settings-view \.settings-grid \{[^}]*grid-auto-rows: max-content/);
assert.match(
  text(tailwind),
  /\.update-card\s+\{\s+@apply\s+col-span-12\s+flex\s+items-center\s+justify-between\s+gap-6/,
);
assert.match(text(app), /stackableTaskCardSelector\s+=\s+'[^']*\.mini-meeting[^']*\.mini-playback/);
assert.match(
  text(app),
  /\[\.\.\.taskCards\.children\]\.filter\(\(card\) => card\.matches\(stackableTaskCardSelector\)\)/,
);
assert.match(text(tailwind), /\.task-cards > \.is-task-card-back \{[^}]*box-shadow:/);
assert.match(text(app), /function activateTaskCard\(card\)/);
assert.match(text(app), /\['Enter', ' '\]\.includes\(event\.key\)/);
assert.match(
  text(electronMain),
  /handleIpc\('app\.maintain'[\s\S]{0,300}if \(app\.isQuitting\) return \{\}/,
);
assert.match(
  text(css),
  /\.required-models-card ul\{(?=[^}]*max-height:min\(28vh,14rem\))(?=[^}]*overflow:hidden auto)(?=[^}]*overscroll-behavior:contain)/,
);
assert.match(text(css), /#prepare-view\.active\{[^}]*overflow:hidden/);
assert.match(text(css), /\.prepare-layout\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
assert.doesNotMatch(text(css), /\.prepare-layout\{[^}]*transform:scale/);
assert.match(
  text(html),
  /id="import-recording"\s+data-view="prepare"\s+data-prepare-mode="import"/,
);
assert.match(text(css), /\.import-recording\{[^}]*border/);
assert.match(text(js), /function fitPrepareLayout/);
assert.match(text(js), /function renderModelDownloadQueue/);
assert.match(text(js), /id = 'model-download-queue'/);
assert.match(text(js), /function renderModelLibrary\(\)/);
// 退役模型一律不显示：模型库的分组列表、已安装计数与合计占用都走 visibleModels()。
// 留一条「已退役」只读行只是噪音，还会让用户把淘汰的模型重新下回来。
// 规则本体在 model-selection.js（上面已用合成清单真跑过）。app.js 里只允许留绑定全局的
// 薄包装：把规则再实现一遍会让「同一套判断两处各写一份」重新出现，这正是漂移的来源。
assert.match(
  text(js),
  /function visibleModels\(\) \{\s*return modelSelection\.visibleModels/,
  'visibleModels 必须是薄包装',
);
// 分组的**映射数据**（哪个 stage 归哪组）是 app 层的展示配置，留在 app.js；
// 但**查找算法**在模块里，app.js 不得自己遍历映射。
assert.match(text(js), /MODEL_LIBRARY_STAGE_GROUPS = \{/, '分组映射数据仍在 app 层');
assert.doesNotMatch(text(js), /MODEL_LIBRARY_STAGE_GROUPS\[/, '不得在 app.js 里重新实现分组查找');
assert.match(text(js), /modelSelection\.modelLibraryGroup/);
// 清单里可选的整句识别模型（退役模型不在其中）：下面几处不变量都基于它。
const selectableRefined = modelManifest.filter(
  ({ stages, retired }) => (stages || []).includes('refined') && !retired,
);
const retiredModelIds = modelManifest.filter(({ retired }) => retired).map(({ id }) => id);
assert.ok(retiredModelIds.length, '清单里至少要有一个 retired 模型，否则隐藏逻辑形同虚设');
for (const id of retiredModelIds) {
  assert.ok(
    !selectableRefined.some((model) => model.id === id),
    `${id} 已退役，不得进入可选用模型列表`,
  );
}
assert.doesNotMatch(text(js), /model\.retired \? `<span>\$\{t\('已退役'\)\}<\/span>`/);
assert.doesNotMatch(text(js), /model\.retired && !isInstalled/);
// 模型库完全由清单生成，按钮一律携带 model_id，不再用数组下标（§1.4 / §9.5）。
assert.doesNotMatch(text(js), /modelIds\[sourceIndex\]/);
assert.match(text(js), /data-download-model="\$\{escapeHtml\(model\.id\)\}"/);
assert.match(text(js), /data-delete-model="\$\{escapeHtml\(model\.id\)\}"/);
// 模型库大小摘要仅显示下载大小。
assert.match(
  text(js),
  /function modelSizeSummary\(model\) \{\s*return modelSelection\.modelSizeSummary/,
  '体积摘要必须是薄包装',
);
assert.doesNotMatch(text(js), /model-library-total/);
// 下载失败要按原因分类，而不是压成一句话（§6.3）。
assert.match(text(js), /MODEL_DOWNLOAD_FAILURES/);
// 在线纪要/AI 笔记的网络失败不能被改写成「模型下载失败」的文案。
assert.match(text(app), /if \(\/LLM request failed\/i\.test\(text\)\) return content;/);
assert.match(text(js), /Insufficient disk space/);
assert.match(text(js), /checksum mismatch/);
assert.match(text(electronMain), /BREVIA_MODELS_DIR: modelsDir\(\)/);
assert.match(text(electronMain), /const dataDir = \(\) => process\.env\.BREVIA_DATA_DIR \|\|/);
assert.match(
  text(electronMain),
  /const resetOnboarding = process\.argv\.includes\('--reset-onboarding'\)/,
);
assert.match(text(electronMain), /query: \{ resetOnboarding: '1' \}/);
assert.match(
  text(js),
  /resetOnboarding'\)\)\s+localStorage\.removeItem\('brevia-onboarding-complete'\)/,
);
assert.doesNotMatch(text(tailwind), /\.onboarding-ai-demo \{ position: fixed/);
assert.match(
  text(app),
  /deviceIsWeak\(\)\s+&&\s+config\.provider\s+===\s+'built-in'\s+&&\s+\/4b\/i\.test/,
);
assert.match(
  text(app),
  /const aiOnboardingDemoCopy = window\.BreviaLocaleData\.appCopy\.aiOnboardingDemoCopy/,
);
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'])
  assert.ok(localeContext.window.BreviaLocaleData.appCopy.aiOnboardingDemoCopy[code].recording);
assert.match(text(js), /window\.brevia\.task\[paused \? 'resume' : 'pause'\]/);
assert.match(text(js), /miniPlaybackSeek\.addEventListener\('pointerdown'/);
assert.match(text(js), /let contextMeetingId;/);
assert.match(text(js), /openSegmentContextMenu\(meetingId, segmentId, x, y, segmentInfo\)/);
assert.match(text(js), /followPlaybackTranscript = false/);
assert.doesNotMatch(text(workerSession), /_identify_speaker/);
assert.doesNotMatch(text(workerSession), /tracker\.assign_embedding/);
assert.doesNotMatch(text(workerSession), /SpeakerTracker/);
assert.doesNotMatch(text(js), /name="num-speakers"[^>]*max="20"/);
assert.match(text(js), /prepareLayout\.style\.removeProperty\('transform'\)/);
assert.match(text(js), /new ResizeObserver\(\(\) => requestAnimationFrame\(fitPrepareLayout\)\)/);
assert.doesNotMatch(text(css), /max-width:1100px|max-height:760px/);
assert.match(
  text(css),
  /\.library-toolbar \.search input,.library-toolbar \.flow-select-toggle\{[^}]*height:/,
);
assert.match(text(css), /\.window-actions\{[^}]*-webkit-app-region:no-drag/);
assert.match(
  text(tailwind),
  /\.window-actions\s+\{\s+@apply\s+ml-auto\s+flex\s+items-center\s+gap-2;/,
);
assert.match(text(js), /showView\('live'\)/);
assert.match(text(js), /function setLiveTranslationEnabled/);
assert.match(text(js), /setLiveTranslationEnabled\(Boolean\(payload\.target_language\)\)/);
assert.match(text(html), /translation-menu flow-select[\s\S]*id="translation-options"/);
assert.match(text(js), /data-live-translation/);
assert.match(text(js), /reconfigureLive\(\{ target_language: targetLanguage \}\)/);
assert.match(text(js), /showView\('detail'\)/);
assert.doesNotMatch(text(html), /id="language-toggle"/);
assert.match(text(html), /href="https:\/\/github\.com\/zerolovesea\/Brevia"/);
assert.match(text(html), /id="all-meetings"/);
assert.doesNotMatch(text(html), /id="category-filter"/);
assert.doesNotMatch(
  text(js),
  /renderCategoryFilter|data-assign-category|data-new-meeting-category/,
);
assert.match(text(js), /refreshLocalizedTaskCards\(\);/);
for (const code of ['en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'])
  assert.notEqual(
    localeContext.window.BreviaLocaleData.catalog[code].labels['导入录音'],
    '导入录音',
  );
assert.doesNotMatch(text(js), /data-pause-required-all|data-download-required-all/);
assert.match(text(js), /interfaceIcon\(progress.paused \? 'play' : 'pause'\)/);
assert.match(text(html), /id="home-slogan"/);
assert.match(text(html), /id="home-eyebrow"[^>]*disabled/);
assert.match(text(js), /function activeWorkspaceDescription\(\)/);
assert.ok(!text(js).includes('sloganIndex'), 'the latest library subtitle stays fixed');
assert.match(
  text(js),
  /flowSelect\('meeting-language', language, BreviaI18n\.languageOptions\(locale, t, true\)\)/,
);
assert.match(
  text(js),
  /\{\s*zh:\s*'zh',\s*ja:\s*'ja',\s*ko:\s*'ko'\s*\}\)?\[locale\]\s*\|\|\s*'auto'/,
);
assert.match(text(html), /id="mini-meeting"/);
assert.match(text(html), /id="mini-playback-seek"\s+role="slider"/);
assert.doesNotMatch(text(html), /id="mini-playback-seek" type="range"/);
assert.match(text(html), /id="refinement-progress"/);
assert.match(text(html), /data-pause-task/);
assert.doesNotMatch(text(html), /原版逐字稿仍可查看|data-refine-meeting/);
assert.match(text(html), /id="capture-mode-mount"/);
assert.match(text(html), /id="mic-device-setting"/);
assert.match(text(html), /id="playback-rate"/);
assert.match(text(i18nData), /catalog\s*=\s*{/);
assert.match(text(js), /window\.BreviaLocaleData/);
assert.doesNotMatch(text(js), /defaultSummaryPrompts|prompt-form/);
assert.match(
  text(js),
  /const\s+summaryProviders\s+=\s+\[\s*'built-in',\s+'claude',\s+'openai',\s+'openrouter',\s+'custom-openai',\s+'custom-claude',?\s*\]/,
);
assert.match(text(js), /model\.kind === 'llama-chat' && modelPaths\.has\(model\.id\)/);
// 只有两个自定义供应商暴露请求地址，固定供应商的地址由 summaryProviderPresets 派生。
assert.match(text(js), /const\s+endpointField\s+=\s+preset\.needsEndpoint\s+\?/);
assert.match(
  text(js),
  /'custom-openai':\s+\{\s+format:\s+'openai',\s+endpoint:\s+'',\s+needsKey:\s+true,\s+needsEndpoint:\s+true/,
);
assert.match(
  text(js),
  /openrouter:\s+\{\s+format:\s+'openai',\s+endpoint:\s+'https:\/\/openrouter\.ai\/api\/v1\/chat\/completions',\s+needsKey:\s+true,\s+needsEndpoint:\s+false/,
);
// 安装与删除只在模型库；功能设置只负责「这个功能用哪个」。
assert.doesNotMatch(
  text(js),
  /data-download-summary-model/,
  'feature settings must not install models',
);
assert.doesNotMatch(
  text(js),
  /data-builtin-model-id/,
  'feature settings must not re-render the model list',
);
assert.match(text(js), /function builtinModelPicker\(/);
assert.match(text(js), /function builtinModelEmptyState\(/);
assert.match(
  text(js),
  /data-open-models-from-config/,
  'the empty state must link to the model library',
);
assert.match(
  text(js),
  /const\s+installed\s+=\s+modelCatalog\s*\.filter\(\s*\(\s*model,?\s*\)\s+=>\s+model\s*\.kind\s+===\s+'llama-chat'\s+&&\s+modelPaths\s*\.has\(\s*model\s*\.id,?\s*\),?\s*\)/,
);
assert.match(text(css), /\.model-picker\{/);
assert.doesNotMatch(text(css), /\.builtin-model-list\{/);
assert.doesNotMatch(text(js), /ollama/i);
assert.doesNotMatch(text(i18nData), /ollama/i);
assert.doesNotMatch(
  text(js),
  /data-new-summary-model|data-delete-summary-model|active-summary-config/,
);
assert.match(text(js), /type="password"[^>]*placeholder="\$\{entry\.keyReference/);
assert.doesNotMatch(text(js), /secret\.get|summaryKeyValues/);
assert.match(text(js), /speakerProfileName\(profile\)/);
assert.match(text(js), /window\.brevia\?\.appInfo\?\.version\?\.\(\)/);
assert.match(text(electronMain), /handleIpc\('app\.version', \(\) => app\.getVersion\(\)\)/);
assert.match(text(electronMain), /const useBundledWorker = app\.isPackaged/);
assert.match(text(js), /fetch\('\.\.\/package\.json'\)/);
assert.match(
  text(js),
  /renderSettingsView\(\);[\s\S]{0,220}before\(speakerProfileCard\);[\s\S]{0,120}append\(updateCard\)/,
);
assert.match(text(components), /function renderSettingsView\(\)/);
assert.doesNotMatch(text(electronMain), /handleIpc\('secret\.get'/);
assert.match(text(js), /renderSlogan/);
assert.match(text(app), /refinement\.progress'.*stage.*showRefinementProgress/s);
assert.equal(localeContext.window.BreviaLocaleData.catalog.en.labels['检查音频'], 'Checking audio');
assert.doesNotMatch(
  text(i18nData),
  /Object\.assign|catalog\.[a-z]+\.labels\[/,
  'locale tables have no runtime overrides',
);
for (const locale of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  assert.ok(localeContext.window.BreviaLocaleData.catalog[locale].labels['转写中']);
}
assert.match(
  text(js),
  /activeLibraryNav\s+===\s+'recently-deleted'\s+\?\s+BreviaI18n\.trashCopy\(locale\)\.slogan/,
);
assert.match(text(js), /if \(activeView === 'home'\) selectLibraryNav\(activeLibraryNav\)/);
assert.match(text(js), /async function showLibraryNav/);
assert.match(text(js), /async function transitionPage/);
assert.match(text(js), /transitionPage\(current, home/);
assert.match(text(js), /minimizeMeeting/);
assert.match(text(css), /page-in/);
assert.match(text(css), /language-out/);
assert.match(text(uiData), /title: 'AI 功能'[\s\S]*modal: 'ai-features'/);
assert.doesNotMatch(text(uiData), /modal: '(?:ai-assist|summary-model)'/);
assert.match(text(js), /summaryProviders/);
assert.match(text(js), /persistSummaryConfig/);
assert.match(text(components), /function renderTranscriptSegment/);
assert.match(text(components), /inline-segment-speaker-form/);
assert.match(text(components), /function renderMeetingSummary/);
assert.match(text(components), /function cleanSummaryMarkdown/);
assert.match(text(components), /renderMarkdown\(cleanSummaryMarkdown\(markdown\)\)/);
assert.match(text(components), /function flowSelect/);
assert.match(text(js), /renderMeetingDetail\(\);/);
assert.match(text(js), /function saveInlineSegmentSpeaker/);
assert.match(text(components), /function renderMeetingRow/);
assert.match(text(components), /function renderSettingsCard/);
assert.match(text(js), /renderStaticViews\(\);/);
assert.match(text(js), /function renderPrepareSelects/);
assert.match(text(js), /function selectCurrentWorkspaceForMeeting/);
assert.match(
  text(js),
  /if \(target\.dataset\.view === 'prepare'\) setPrepareMode\(target\.dataset\.prepareMode \|\| 'record'\)/,
);
assert.match(text(js), /__new_workspace__/);
assert.match(text(js), /showNewWorkspaceDialog\(null, \(workspace\)/);
assert.match(text(app), /showWorkspaceAssignMenu\(index, rect\)/);
assert.match(text(js), /function renderWorkspaceNav/);
assert.match(text(js), /async function switchWorkspace/);
assert.match(
  text(workspaces),
  /await\s+appActions\.transitionPage\([\s\S]*?,\s+applyWorkspace,?\s*\)/,
);
assert.match(text(js), /meeting\.list\(\{ include_deleted: includeDeleted \}\)/);
assert.doesNotMatch(text(js), /action === 'purge' && window\.brevia/);
assert.match(text(js), /addEventListener\('pointerdown'/);
assert.match(text(js), /addEventListener\('dragstart'/);
assert.match(text(js), /meetingSelectionSurface\.setPointerCapture/);
assert.match(text(js), /meetingSelectionSurface = document\.querySelector\('#home-view'\)/);
assert.match(text(js), /event\.clientY < libraryToolbar\.getBoundingClientRect\(\)\.top/);
assert.doesNotMatch(text(js), /pointerdown[\s\S]{0,300}event\.preventDefault\(\)/);
assert.match(text(js), /pointermove[\s\S]{0,500}meetingSelectionSurface\.setPointerCapture/);
assert.doesNotMatch(text(js), /closest\('button, input, \.meeting-actions/);
assert.match(
  text(js),
  /meetingSelectionSurface\.addEventListener\(\s*'click',[\s\S]{0,300}stopImmediatePropagation\(\)[\s\S]{0,40}true,?\s*\)/,
);
assert.match(text(js), /data-batch-export/);
assert.match(text(js), /data-batch-restore/);
assert.match(text(js), /runBatchMutation\(permanently \? 'purge' : 'delete', meetings\)/);
assert.match(text(js), /async function mutateMeetings/);
assert.match(text(js), /async function openMeetingRow/);
assert.match(text(components), /data-meeting-action="purge"/);
assert.match(text(electronMain), /meeting\.purge/);
assert.match(
  text(electronMain),
  /handleModelRequirement\('meeting\.reconfigure', meetingReconfigure, 'meeting\.reconfigure'\)/,
);
assert.match(text(electronMain), /const meetingReconfigure = id\.extend/);
assert.doesNotMatch(text(electronMain), /power_saving/);
assert.match(text(electronMain), /'meeting\.reconfigured'/);
assert.match(text(electronMain), /endpoint: z\.string\(\)\.url\(\)\.optional\(\)/);
// 纪要配置收敛为「单套激活 + 按供应商记住凭据」，只认 version 2，不再迁移旧结构。
assert.match(
  text(electronMain),
  /const\s+summaryProviderIds\s+=\s+\[\s*'built-in',\s+'claude',\s+'openai',\s+'openrouter',\s+'custom-openai',\s+'custom-claude',?\s*\]/,
);
assert.match(
  text(electronMain),
  /providers: z\.partialRecord\(z\.enum\(summaryProviderIds\), summaryProviderEntry\)/,
);
assert.match(
  text(electronMain),
  /if \(!api_key && !isBuiltInProvider\(value\.provider\)\) return \{ configuration_required: true \}/,
);
assert.match(text(electronMain), /return current\.success \? current\.data : null;/);
assert.doesNotMatch(text(electronMain), /legacySummaryConfig|migrateSummaryConfig/);
assert.doesNotMatch(text(js), /migrateSummaryConfig|inferSummaryProvider/);
assert.doesNotMatch(text(electronMain), /ollama/i);
assert.match(
  text(electronMain),
  /handleIpc\('translation\.generate',[\s\S]{0,700}target_language: z\.string\(\)\.min\(2\)\.max\(16\),[\s\S]{0,100}consent: z\.literal\(true\)/,
);
assert.doesNotMatch(
  text(electronMain),
  /handleIpc\('translation\.generate',[\s\S]{0,700}provider: z\.string\(\)/,
);
assert.match(text(electronMain), /const startupAnimationMs = 1700;/);
assert.match(text(electronMain), /const startupDataWaitMs = 2200;/);
assert.match(
  text(electronMain),
  /powerMonitor\.on\('suspend',\s+\(\)\s+=>\s+\{\s+void\s+stopActiveMeetingForSleep\(\);\s+\}\);/,
);
assert.doesNotMatch(text(electronMain), /const splash = new BrowserWindow/);
assert.match(
  text(electronMain),
  /window\s*\.loadFile\(\s*path\s*\.join\(\s*packagedRoot,\s+'frontend',\s+'index\s*\.html',?\s*\)/,
);
assert.match(text(electronMain), /webContents\.on\('did-finish-load'/);
assert.doesNotMatch(text(electronMain), /webContents\.once\('did-finish-load'/);
assert.match(text(electronMain), /reloadRevealTimer = setTimeout/);
assert.match(
  text(electronMain),
  /!pageReady\s+\|\|\s+!animationComplete\s+\|\|\s+!initializationReady/,
);
assert.match(text(electronMain), /type: 'startup\.ready'/);
assert.match(text(html), /id="startup-splash"/);
assert.match(
  text(js),
  /querySelectorAll\('\.startup-credit, \.app-credit'\)\.forEach\(\(credit\) => credit\.remove\(\)\)/,
);
assert.match(text(html), /id="app-version">v—/);
assert.match(
  text(html),
  /window-actions"\s*><small\s+id="app-version">v—<\/small\s*><a\s+class="icon-button"\s+href="https:\/\/github\.com\/zerolovesea\/Brevia"/,
);
assert.match(text(html), /brevia-logo-reveal\.gif/);
assert.match(text(js), /brevia\.on\('startup\.ready'/);
assert.match(text(js), /const dismissStartupSplash/);
for (const duration of ['0s', '0.36s']) {
  let removed = false,
    fallback;
  const splash = {
    classList: { add() {} },
    addEventListener() {},
    remove() {
      removed = true;
    },
  };
  const start = js.indexOf('const dismissStartupSplash =');
  const end = js.indexOf('// 启动动画', start);
  runInNewContext(js.slice(start, end) + '\ndismissStartupSplash();', {
    document: { querySelector: () => splash },
    getComputedStyle: () => ({ transitionDuration: duration }),
    setTimeout(callback, ms) {
      fallback = callback;
      assert.equal(ms, 392);
    },
  });
  if (duration === '0s')
    assert.equal(removed, true, 'reduced-motion startup never waits for a missing transitionend');
  else {
    assert.equal(removed, false);
    fallback();
    assert.equal(removed, true, 'startup removes its overlay even when transitionend is lost');
  }
}
assert.match(text(meetings), /brevia-meetings-v1/);
assert.match(text(js), /cacheMeetingList\(\)/);
assert.match(text(css), /\.startup-splash\{[^}]*z-index:100[^}]*transition:opacity \.36s/);
assert.doesNotMatch(
  text(css),
  /\.onboarding-credit\{/,
  'the onboarding credit class is unreferenced and must stay deleted',
);
assert.doesNotMatch(text(js), /Powered by zerolovesea/);
assert.match(text(electronMain), /PYTHONUTF8: '1'/);
assert.match(text(electronMain), /setPermissionRequestHandler/);
assert.match(text(js), /exportMany/);
assert.doesNotMatch(text(js), /flowSelect\('library-category'/);
assert.doesNotMatch(text(js), /flowSelect\('library-date'/);
assert.doesNotMatch(text(js), /const dateMatch = activeDateRange === 'all'/);
assert.match(text(js), /window\.brevia\.meeting\.search\(\{ query \}\)/);
assert.match(text(js), /function highlightSearchMatch/);
assert.match(text(js), /updateSearchPopup/);
assert.match(
  text(js),
  /activeView !== 'detail' && playbackStarted && Boolean\(playerAudio\.src\) && !playerAudio\.ended/,
);
assert.match(text(js), /closeMeetingMenus/);
assert.doesNotMatch(text(js), /closeCategoryMenu/);
assert.match(text(js), /const positionMeetingMenu =/);
assert.match(text(js), /window\.innerHeight - anchor\.bottom < height && anchor\.top >= height/);
assert.match(text(css), /\.meeting-menu[^{}]*\{(?=[^}]*position:fixed)(?=[^}]*z-index:50)/);
assert.match(text(css), /\.detail-head\{(?=[^}]*z-index:50)/);
assert.doesNotMatch(text(components), /data-meeting-action="category"/);
assert.match(text(components), /data-rename-meeting/);
assert.match(text(components), /class="meeting-title-rename"/);
assert.doesNotMatch(text(components), /meeting-rename-menu/);
assert.doesNotMatch(text(js), /renameForm\.requestSubmit\(\)/);
assert.doesNotMatch(text(components), /data-delete-meeting-category/);
assert.match(text(components), /data-selection-key/);
assert.doesNotMatch(text(js), /data-new-meeting-category/);
assert.match(text(js), /event\.target\.matches\('input, textarea'\)\) return/);
assert.doesNotMatch(text(js), /meeting-category/);
assert.match(text(uiData), /const uiData/);
assert.doesNotMatch(
  text(uiData),
  /models: \[/,
  'the reader-less demo model array must stay deleted',
);
assert.doesNotMatch(
  text(uiData),
  /Streaming|流式/,
  'demo data must not mention the retired streaming pipeline',
);
assert.doesNotMatch(text(i18nData), /Qwen3-ASR 1\.7B int8/);
assert.doesNotMatch(text(uiData), /VAD \+ Speaker/);
assert.doesNotMatch(text(uiData), /SenseVoice Small|Whisper Small/);
assert.match(
  text(js),
  /下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。/,
  'the library intro is set from a single localized string',
);
assert.match(text(i18nData), /Réunions et enregistrements/);
assert.match(text(i18nData), /Modèle de sous-titres en direct/);
assert.match(text(i18nData), /Gérer les modèles et les termes/);
// app.js 里不应再有任何针对已退役模型的 id：库卡片、描述表与评级都从清单生成。
for (const { id } of modelManifest.filter((m) => m.retired)) {
  assert.doesNotMatch(
    text(js),
    new RegExp(`'${id}'`),
    `${id} is retired and must not be hardcoded in app.js`,
  );
}
assert.match(text(i18nData), /实时字幕/);
assert.match(text(i18nData), /会后精修/);
assert.match(text(js), /const languageModelDefaults/);
assert.match(text(js), /const DEFAULT_REFINED_MODEL_ID = 'funasr-nano-int8';/);
assert.match(text(electronMain), /path\.join\(app\.getPath\('home'\), 'brevia'\)/);
assert.match(text(electronMain), /appendFile\(logFile\(\), line, 'utf8'\)/);
assert.match(text(electronMain), /await migrateDataDir\(\)/);
// 「语言 → 默认模型」现在只由 models.json 的 default_for_languages 决定，
// 前端与后端读同一字段（设计文档 §2.6）。这里守住前端不再自己写一份 refined 表。
assert.match(text(js), /modelSelection\.declaredDefaultModelId/, '默认模型推导必须在模块里');
assert.doesNotMatch(text(js), /refined: DEFAULT_REFINED_MODEL_ID/);
// 推导实现必须在模块里，且模块确实读的是清单的 default_for_languages。
assert.match(ms, /default_for_languages \|\| \[\]\)\.includes\(language\)/);
assert.doesNotMatch(text(js), /default_for_languages/, 'app.js 不得自己读该字段');
assert.match(text(html), /src="\.\/i18n\.js"/);
assert.match(
  text(html),
  /i18n-data\.js[\s\S]*i18n\.js/,
  'locale data must load before its runtime helpers',
);
assert.match(text(js), /BreviaI18n\.languageOptions\(locale, t/);
assert.match(text(js), /Object\.values\(modalCopy\)\.forEach/);
assert.match(text(i18n), /new Intl\.DisplayNames/);
const meetingLanguages = { window: {}, Intl };
runInNewContext(text(i18nData), meetingLanguages);
runInNewContext(text(i18n), meetingLanguages);

// ─── 词条完备门禁：集中数据中的四张表 ──────────────────────────────────────────
//
// `i18n-data.js` 的 catalog 有逐键完备检查，但 i18n.js 的四张表此前**完全没有**：
// 访问器都带 `|| .en` 兜底，漏一门语言只会静默回落英文，不报错、也看不出来。
// 这里直接检查原始表（`localeTables`），而不是从访问器返回值反推——
// `defaultMeetingNames.de` 与 `en` 合法地相同（都是 "Meeting"），返回值区分不出
// 「德语已定义」和「德语缺失、回落英文」。这正是需要原始表的理由。
const interfaceI18n = meetingLanguages.window.BreviaI18n;
const interfaceLocales = Array.from(interfaceI18n.languageCodes);
assert.deepEqual(
  [...interfaceLocales].sort(),
  ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'].sort(),
  'i18n.js 必须覆盖恰好八个界面语言',
);
// 三个词条库的语种集合必须一致：i18n.js / i18n-data.js 的 catalog / asr-copy.js。
// 任何一处漂移都意味着某个界面语言在某个模块里缺失。
assert.deepEqual(
  [
    ...new Set([...asrCopyLocales, ...Object.keys(localeContext.window.BreviaLocaleData.catalog)]),
  ].sort(),
  [...interfaceLocales].sort(),
  'i18n.js / i18n-data.js / asr-copy.js 的语种集合必须完全一致',
);
const {
  slogans: sloganTable,
  trashCopy: trashTable,
  defaultMeetingNames: meetingNameTable,
  selectionOverview: overviewTable,
} = interfaceI18n.localeTables;
assert.ok(
  sloganTable && trashTable && meetingNameTable && overviewTable,
  'i18n.js 必须导出 localeTables 供完备性检查',
);
for (const [name, table] of [
  ['slogans', sloganTable],
  ['trashCopy', trashTable],
  ['defaultMeetingNames', meetingNameTable],
  ['selectionOverview', overviewTable],
]) {
  // Array.from 走宿主 realm：vm 里 filter 出来的空数组原型不同，deepStrictEqual 会判为不等。
  const missing = Array.from(interfaceLocales).filter((code) => !(code in table));
  assert.deepEqual(missing, [], `${name} 缺少语种：${missing.join(', ')}`);
}
// slogans 是首页轮播：各语种条数必须一致，否则切语言时轮播长度会变。
const sloganLengths = new Set(interfaceLocales.map((code) => sloganTable[code].length));
assert.equal(sloganLengths.size, 1, `slogans 各语种条数不一致：${[...sloganLengths].join(', ')}`);
assert.ok([...sloganLengths][0] >= 3, 'slogans 每语种至少 3 条');
for (const code of interfaceLocales) {
  assert.ok(
    sloganTable[code].every((line) => typeof line === 'string' && line.trim()),
    `slogans.${code} 有空条目`,
  );
}
// 「最近删除」页面三个位置各用一个字段，缺一个就是空白按钮或空白标题。
const trashKeys = Object.keys(trashTable.en).sort();
assert.deepEqual(trashKeys, ['back', 'purge', 'slogan'], 'trashCopy 的字段集合变了，使用方要同步');
for (const code of interfaceLocales) {
  assert.deepEqual(
    Object.keys(trashTable[code]).sort(),
    trashKeys,
    `trashCopy.${code} 字段与 en 不一致`,
  );
  for (const key of trashKeys) {
    assert.ok(trashTable[code][key].trim(), `trashCopy.${code}.${key} 为空`);
  }
}
for (const code of interfaceLocales) {
  assert.ok(
    typeof meetingNameTable[code] === 'string' && meetingNameTable[code].trim(),
    `defaultMeetingNames.${code} 缺失或为空`,
  );
  assert.equal(typeof overviewTable[code], 'function', `selectionOverview.${code} 必须是函数`);
  // 单复数分支都要能出话，且必须带上数量——否则批量选择提示会丢数字。
  for (const count of [1, 2]) {
    const line = overviewTable[code](count);
    assert.ok(
      typeof line === 'string' && line.includes(String(count)),
      `selectionOverview.${code}(${count}) 应返回含数字的字符串`,
    );
  }
}
assert.deepEqual(
  Array.from(meetingLanguages.window.BreviaI18n.languageOptions('en', (key) => key, true)[0]),
  ['auto', '多语言混说'],
);
assert.equal(
  meetingLanguages.window.BreviaI18n.languageOptions('en', (key) => key, false)[0][0],
  '',
);
assert.match(text(app), /values\['meeting-language'\] \|\| defaultMeetingLanguage\(\)/);
assert.match(text(i18n), /defaultMeetingTitle/);
assert.match(text(i18n), /selectionOverview/);
assert.match(text(js), /renderDefaultMeetingTitle\(\)/);
assert.match(text(js), /\(themeLabels\[locale\] \|\| themeLabels\.en\)/);
for (const code of ['ja', 'ko', 'fr', 'de', 'ru'])
  assert.ok(
    localeContext.window.BreviaLocaleData.catalog[code],
    `settings locale ${code} remains available`,
  );
assert.doesNotMatch(text(js), /音频分析/);
assert.match(text(js), /data-download-model/);
// A cancelled download is terminal: the library button must not stay disabled on "下载中", and dismissing the
// queue must drop cancelled/failed entries so re-downloading works. Guards the stuck-"下载中" regression.
// 已取消的下载是终结状态，按钮不能停在禁用的「下载中」——否则重新下载永远点不动。
assert.match(text(js), /const inFlight = progress && !progress\.error && !progress\.cancelled/);
// 退役模型整行不再渲染，所以下载按钮的禁用只看「是否正在下载」。
assert.match(text(js), /\$\{inFlight \? ' disabled' : ''\}/);
assert.match(
  text(js),
  /if\s+\(card\?\.id\s+===\s+'model-download-queue'\)\s+\{[\s\S]*?if\s+\(progress\.cancelled\s+\|\|\s+progress\.error\)\s+\{\s+modelDownloads\.delete\(modelId\);\s+requiredModelIds\.delete\(modelId\);\s+\}/,
);
assert.match(
  text(js),
  /function renderPrepareSelects\(\) \{[\s\S]*?prepareView\.dataset\.mode === 'import'/,
);
assert.match(text(js), /if \(prepareView\.dataset\.mode === 'import'\) \{[\s\S]*?meeting\.import/);
assert.doesNotMatch(text(components), /查看完整内容/);
assert.match(text(js), /function renderPauseButton/);
assert.match(
  text(js),
  /const translation = payload\.translation \|\| previous\?\.querySelector\('\.translation'\)\?\.textContent;/,
);
assert.doesNotMatch(text(js), /ten-vad|TEN-VAD/);
assert.doesNotMatch(text(asr), /ten_vad/);
// 模型大小与定位共用辅助行，真实随包状态保持只读。
assert.match(text(js), /model\.size_bytes/);
assert.match(text(js), /model-library-details/);
assert.doesNotMatch(text(js), /function renderModelLibraryMeta/);
assert.doesNotMatch(text(js), /model-library-meta/);
assert.match(text(js), /model-library-readonly/);
// 档位来自清单的 speed / quality（上面已逐个校验），不再有第二份手写评级表。
assert.doesNotMatch(
  text(js),
  /const modelRatings = \{/,
  'the duplicate rating table must stay deleted',
);
assert.match(text(js), /function renderModelLibraryRatings/);
assert.match(text(js), /const quality = level\(model\.quality\)/);
assert.match(text(js), /model-library-ratings/);
assert.match(text(js), /rating-scale/);
assert.match(text(js), /model-library-headline/);
assert.match(text(js), /modelLibraryBackground/);
// renderModelLibraryTags 无调用方（徽标已内联进 renderModelLibrary），已删除。
assert.doesNotMatch(
  text(js),
  /function renderModelLibraryTags/,
  'the uncalled tag renderer must stay deleted',
);
assert.match(text(js), /<b class="model-library-headline">\$\{escapeHtml\(model\.name\)\}<\/b>/);
// 每个清单模型都必须带 1..3 档的 speed / quality，否则卡片画不出刻度（上面已逐个校验清单）。
for (const { id, speed, quality } of modelManifest) {
  assert.ok(
    Number.isInteger(speed) && Number.isInteger(quality),
    `${id} needs speed/quality for its ratings row`,
  );
}
assert.deepEqual(
  Array.from(localeContext.window.BreviaLocaleData.appCopy.modelLibraryMetaCopy.zh.qualityTiers),
  ['标准', '高', '极高'],
);
assert.deepEqual(
  Array.from(localeContext.window.BreviaLocaleData.appCopy.modelLibraryMetaCopy.zh.speedTiers),
  ['较慢', '均衡', '快'],
);
assert.doesNotMatch(text(html), /id="active-model-name"/);
assert.doesNotMatch(text(js), /createElement\('select'\)/);
assert.match(text(logo), /<svg/);
assert.equal(revealGif.readUInt16LE(6), 2400);
assert.equal(revealGif.readUInt16LE(8), 1520);
assert.equal(revealGif.includes(Buffer.from('NETSCAPE2.0')), false);
assert.match(text(backendClient), /this\.stopPromise/);
assert.doesNotMatch(text(electronMain), /require\('@ffmpeg-installer\/ffmpeg'\)/);
assert.match(text(electronMain), /app\.asar\.unpacked/);
assert.match(text(electronMain), /BREVIA_FFMPEG: ffmpeg/);
assert.equal(packageManifest.dependencies['@ffmpeg-installer/ffmpeg'], '1.1.0');
assert.deepEqual(packageManifest.build.asarUnpack, ['node_modules/@ffmpeg-installer/**']);
assert.doesNotMatch(text(backendClient), /setTrackEnabled\(/);
assert.doesNotMatch(text(backendClient), /_gateSystem|alwaysRecordSystem|audioSource/);
assert.match(text(js), /const CAPTURE_MODES = new Set\(\['mic', 'system', 'both', 'phone'\]\)/);
assert.match(text(js), /function captureModeInputs\(mode = currentCaptureMode\)/);
assert.doesNotMatch(text(js), /LAST_CAPTURE_MODE_KEY|CAPTURE_MODE_KEY|function lastCaptureMode/);
const captureSourceContext = {
  t: (key) => key,
  escapeHtml: runInNewContext('escapeHtml', componentContext),
  interfaceIcon: componentContext.interfaceIcon,
  locale: 'zh',
  BreviaI18n: { localeTag: () => 'zh-CN' },
};
const captureSourceCode = text(js).slice(
  text(js).indexOf('const CAPTURE_MODES ='),
  text(js).indexOf('function selectCurrentWorkspaceForMeeting()'),
);
runInNewContext(captureSourceCode, captureSourceContext);
const defaultSource = captureSourceContext.captureModeSelect('both');
assert.equal((defaultSource.match(/role="radio" /g) || []).length, 4);
assert.match(
  defaultSource,
  /aria-checked="true" data-flow-select-choice="capture-mode" data-value="both"/,
);
assert.doesNotMatch(defaultSource, /data-value="auto"|data-capture-phone/);
for (const hint of [
  '适合面对面交流、个人口述',
  '适合网课、视频和电脑播放的音频',
  '适合线上会议，同时收录双方声音',
  '适合线下会议，用手机近距离收音',
])
  assert.ok(defaultSource.includes(hint));
runInNewContext(
  "capturePhones = [{id:'one',name:'Phone one'},{id:'two',name:'Phone two'}]; selectedPhoneDeviceId = 'two';",
  captureSourceContext,
);
const connectedSources = captureSourceContext.captureModeSelect('phone');
assert.equal(
  (connectedSources.match(/role="radio" /g) || []).length,
  4,
  'device count does not add source rows',
);
assert.ok(connectedSources.includes('2 台手机已连接'));
assert.equal(captureSourceContext.captureModeInputs('phone').phone, 'two');
assert.equal(captureSourceContext.captureModeInputs('phone').mic, false);
assert.equal(captureSourceContext.captureModeInputs('phone').system, false);
const previewRequests = [];
let finishPreview;
let previewRenders = 0;
Object.assign(captureSourceContext, {
  activeView: 'prepare',
  prepareView: { dataset: { mode: 'record' } },
  prepareForm: { querySelector: () => ({ classList: { contains: () => false } }) },
  window: {
    brevia: {
      mobile: {
        previewCapture: ({ device_id }) => {
          previewRequests.push(device_id);
          return device_id
            ? new Promise((resolve) => {
                finishPreview = resolve;
              })
            : Promise.resolve({ level: null });
        },
      },
    },
  },
  clearInterval() {},
  setInterval: () => 1,
  renderPrepareAudioSources: () => {
    previewRenders++;
  },
});
runInNewContext(
  "currentCaptureMode='phone';capturePhones.forEach(device=>device.captureReady=true);syncPhonePreview();",
  captureSourceContext,
);
finishPreview({ level: 0.5 });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(runInNewContext('phonePreviewLevel', captureSourceContext), 0.5);
assert.equal(previewRenders, 1);
runInNewContext(
  "selectedPhoneDeviceId='one';syncPhonePreview();currentCaptureMode='both';syncPhonePreview();",
  captureSourceContext,
);
finishPreview({ level: 0.9 });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(previewRequests, ['two', 'one', null]);
assert.equal(
  runInNewContext('phonePreviewLevel', captureSourceContext),
  null,
  'a stale phone preview cannot update the new source',
);
assert.equal(previewRenders, 1);
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  for (const key of [
    '连接设备',
    '手机设备',
    '适合面对面交流、个人口述',
    '适合网课、视频和电脑播放的音频',
    '适合线上会议，同时收录双方声音',
    '适合线下会议，用手机近距离收音',
    '{count} 台手机已连接',
  ])
    assert.ok(
      localeContext.window.BreviaLocaleData.catalog[code].labels[key],
      `${code}: missing capture source translation ${key}`,
    );
  assert.ok(
    localeContext.window.BreviaLocaleData.catalog[code].labels['{count} 台手机已连接'].includes(
      '{count}',
    ),
  );
}
assert.match(text(backendClient), /this\.startedAt = performance\.now\(\)/);
assert.match(text(electronMain), /setWindowOpenHandler/);
assert.match(text(electronMain), /will-navigate/);
assert.match(text(electronMain), /process\.on\('unhandledRejection'/);
assert.match(text(electronMain), /process\.on\('uncaughtException'/);
assert.match(text(electronMain), /workerMessage\.parse\(JSON\.parse\(line\)\)/);
assert.match(text(electronMain), /schema_version: z\.literal\(1\)/);
assert.match(text(app), /addEventListener\('unhandledrejection'/);
assert.match(text(app), /addEventListener\('error'/);
assert.match(text(backendClient), /await this\.release\(resource\)/);
assert.match(text(meetings), /function syncBackendMeeting/);
assert.match(text(packWorker), /resource\("fixtures", "backend\/fixtures"\)/);
assert.match(text(packWorker), /"--onedir"/);
assert.doesNotMatch(text(packWorker), /"--onefile"/);
assert.match(text(css), /\.confirmation-actions \.secondary\{margin-top:0/);
assert.match(text(i18nData), /管理语言识别模型的下载、删除与版本信息/);
assert.match(text(i18nData), /Bibliothèque de modèles/);
assert.doesNotMatch(text(html), /class="model-card"/);
assert.doesNotMatch(
  text(html),
  /active-(device|meeting-language|meeting-mode|streaming-model|diarization-model|refined-model)/,
);
assert.doesNotMatch(text(js), /prepareModelCard|prepareModelChoices|modelPicker/);
assert.match(text(js), /model\.progress/);
assert.match(text(js), /model-download-progress/);
// 纯工具已下沉到 app-utils.js（与 index.html 的加载顺序一致），并且这里真跑它：
// 「源码里存在这个函数」不说明任何行为，格式化边界才是会出错的地方。
const utilsContext = { window: {} };
runInNewContext(text(await readFile('app-utils.js')), utilsContext);
assert.equal(utilsContext.formatBytes(0), '0 KiB');
assert.equal(utilsContext.formatBytes(512), '1 KiB');
assert.equal(utilsContext.formatBytes(1024 ** 2 * 1.5), '1.50 MiB');
assert.equal(utilsContext.formatBytes(1024 ** 3 * 2), '2.00 GiB');
assert.equal(utilsContext.formatMeetingTime(0), '00:00');
assert.equal(utilsContext.formatMeetingTime(61_000), '01:01');
assert.equal(utilsContext.formatMeetingTime(3_600_000), '60:00', '超过一小时按分钟累计');
assert.equal(utilsContext.formatMeetingTime(-5), '00:00', '负值夹到 0');
assert.equal(utilsContext.refinedModelSupportsTimestamps('funasr-nano-int8'), true);
assert.equal(utilsContext.refinedModelSupportsTimestamps('unknown-model'), false);

// 重点锚点保留原文并拒绝非法时间，正文只作为文本渲染。
const highlightContext = { formatMeetingTime: utilsContext.formatMeetingTime, t: (value) => value };
runInNewContext(text(components), highlightContext);
assert.equal(
  highlightContext.noteHighlightMarkdown(0, '第一句\n第二句'),
  '> [00:00](#brevia-highlight-0) 第一句 第二句',
);
for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000'])
  assert.equal(highlightContext.noteHighlightMarkdown(value, 'text'), '');
assert.equal(highlightContext.noteHighlightMarkdown(1000, '  '), '');
const highlightMarkup = highlightContext.renderMarkdown(
  highlightContext.noteHighlightMarkdown(147000, '<img src=x onerror=alert(1)> **raw**'),
);
assert.match(highlightMarkup, /data-note-highlight="147000"/);
assert.match(highlightMarkup, /02:27/);
assert.match(highlightMarkup, /&lt;img/);
assert.doesNotMatch(highlightMarkup, /<img|<strong>/);
assert.equal(
  highlightContext.renderMarkdown('> ordinary quote'),
  '<blockquote>ordinary quote</blockquote>',
);
assert.doesNotMatch(
  highlightContext.renderMarkdown('> [x](#brevia-highlight-9007199254740992) text'),
  /data-note-highlight/,
);

const markedSubtitles = [],
  detailHighlights = [],
  highlightToasts = [];
const subtitleHighlightContext = {
  noteHighlightMarkdown: highlightContext.noteHighlightMarkdown,
  meetingActive: true,
  breviaClient: { state: { meeting: { id: 'live-highlight' } } },
  liveNotesEditor: { addHighlight: (...args) => markedSubtitles.push(args) },
  detailNotesEditor: null,
  uiData: { detail: { notes: '' } },
  appendTextToActiveNotes: (...args) => detailHighlights.push(args),
  showToast: (message) => highlightToasts.push(message),
  t: (value) => value,
};
const highlightHandlerStart = text(app).indexOf('function addSubtitleHighlight(');
runInNewContext(
  text(app).slice(
    highlightHandlerStart,
    text(app).indexOf("document.addEventListener('click'", highlightHandlerStart),
  ),
  subtitleHighlightContext,
);
subtitleHighlightContext.addSubtitleHighlight(
  { start_ms: 147000, text: '原字幕' },
  'live-highlight',
);
assert.deepEqual(markedSubtitles, [[147000, '原字幕']], '使用字幕开始时间而非点击时间');
subtitleHighlightContext.addSubtitleHighlight({ start_ms: -1, text: '非法' }, 'live-highlight');
assert.equal(markedSubtitles.length, 1);
subtitleHighlightContext.meetingActive = false;
subtitleHighlightContext.uiData.detail.notes = highlightContext.noteHighlightMarkdown(
  147000,
  '已标记',
);
subtitleHighlightContext.addSubtitleHighlight(
  { start_ms: 147000, text: '已标记' },
  'detail-highlight',
);
assert.equal(detailHighlights.length, 0);
subtitleHighlightContext.addSubtitleHighlight(
  { start_ms: 147000, text: '另一句话' },
  'detail-highlight',
);
assert.deepEqual(detailHighlights, [
  [highlightContext.noteHighlightMarkdown(147000, '另一句话'), 'detail-highlight'],
]);

const recordingMarks = [];
let recordMark;
const recordingMarkContext = {
  document: {
    querySelector: () => ({ addEventListener: (_, callback) => (recordMark = callback) }),
  },
  meetingActive: false,
  seconds: 57,
  liveSegmentData: new Map(),
  latestLiveSegmentId: null,
  liveNotesEditor: { addHighlight: (...args) => recordingMarks.push(args) },
  showToast() {},
  t: (value) => value,
};
const recordMarkStart = text(app).indexOf(
  "document.querySelector('#mark-important').addEventListener(",
);
runInNewContext(
  text(app).slice(
    recordMarkStart,
    text(app).indexOf("document.querySelector('#end-meeting')", recordMarkStart),
  ),
  recordingMarkContext,
);
recordMark();
assert.equal(recordingMarks.length, 0, '未录音时不创建标记');
recordingMarkContext.meetingActive = true;
recordMark();
assert.deepEqual(recordingMarks, [[57000, '重点']], '首句字幕出现前也能标记当前录音时间');
recordingMarkContext.latestLiveSegmentId = 'last';
recordingMarkContext.liveSegmentData.set('last', { start_ms: 42000, text: '上一句字幕' });
recordingMarkContext.seconds = 58;
recordMark();
recordingMarkContext.seconds = 59;
recordMark();
assert.deepEqual(
  recordingMarks.slice(1),
  [
    [58000, '上一句字幕'],
    [59000, '上一句字幕'],
  ],
  '同一字幕后的不同录音时刻分别保存',
);

// 动作接缝真跑一遍：注册前调用要抛出可诊断的错误，重复/越界/非函数注册要立刻失败。
// 这些是视图模块与 app.js 之间唯一的契约，光断言源码里出现过 appActions 说明不了行为。
const actionsContext = {};
// const/let 是脚本级词法绑定，不会挂到 vm 的 context 对象上；这里显式导出再取回。
runInNewContext(
  `${text(await readFile('app-actions.js'))}\n;globalThis.__actions = { appActions, registerAppActions };`,
  actionsContext,
);
const { appActions, registerAppActions } = actionsContext.__actions;
for (const name of ['showToast', 'renderMeetingList', 'transitionPage']) {
  assert.throws(() => appActions[name](), /尚未注册/, `${name} 未注册时应抛出明确错误`);
}
assert.equal(appActions.notAnAction, undefined, '清单外的属性应为 undefined，不参与代理拦截');
assert.throws(() => registerAppActions('test', { typoName: () => {} }), /不在 APP_ACTION_NAMES/);
assert.throws(() => registerAppActions('test', { showToast: 'not a function' }), /不是函数/);
const recorded = [];
registerAppActions('test', { showToast: (value) => recorded.push(value) });
appActions.showToast('hello');
assert.deepEqual(recorded, ['hello']);
assert.throws(() => registerAppActions('test2', { showToast: () => {} }), /重复注册/);
assert.match(text(js), /showRefinementComplete/);
assert.doesNotMatch(text(js), /function missingModelIds/);
assert.doesNotMatch(text(js), /function openModelLibraryAt/);
assert.match(text(js), /window\.brevia\.on\('model\.required'/);
assert.match(text(js), /const requiredModelIds = new Set/);
assert.doesNotMatch(text(js), /downloadRequiredModels\(\[\.\.\.requiredModelIds\]\)/);
assert.match(text(js), /pending\.task === 'meeting\.start'/);
assert.match(text(js), /queueModelTask\('meeting\.start', \{ \.\.\.payload, inputs \}/);
assert.match(text(html), /id="task-cards"/);
assert.match(text(html), /data-dismiss-task-card/);
assert.match(text(js), /data-dismiss-task-card/);
assert.match(text(js), /function hideRefinementProgress/);
assert.match(text(app), /let refinementCardDismissed = false/);
assert.match(text(app), /if \(refinementCardDismissed\) return/);
assert.match(text(app), /hideRefinementProgress\(true\)/);
assert.match(
  text(app),
  /window\s*\.brevia\s*\.task\s*\.cancel\(\s*\{\s+task,\s+meeting_id:\s+meetingId\s+\},?\s*\)/,
);
assert.match(text(electronMain), /'refinement\.cancelled'/);
assert.match(text(app), /window\.brevia\.on\('refinement\.cancelled'/);
assert.match(text(js), /transcript\.scrollTop = transcript\.scrollHeight/);
assert.match(
  text(js),
  /const\s+isAtLiveBottom\s+=\s+\(\)\s+=>\s+transcript\.scrollHeight\s+-\s+transcript\.clientHeight\s+-\s+transcript\.scrollTop\s+<=\s+32/,
);
assert.doesNotMatch(text(html), /current-caption|id="live-caption/);
assert.doesNotMatch(text(js), /#live-caption|caption-increment/);
assert.match(
  text(html),
  /live-caption-controls[^]*floating-caption-toggle[^]*translation-toggle[^]*live-model-menu/,
  'live controls are captions, translation, then model',
);
assert.match(
  text(app),
  /enabled \? '翻译：开' : '翻译：关'/,
  'live translation toggle uses the current Chinese label',
);
assert.doesNotMatch(text(html), /data-meeting-power-saving/);
assert.match(text(html), /live-status[\s\S]*recording[\s\S]*id="timer"/);
assert.ok(localeContext.window.BreviaLocaleData.catalog.en.labels['字幕：开']);
assert.ok(localeContext.window.BreviaLocaleData.catalog.en.labels['新建工作区']);
assert.ok(localeContext.window.BreviaLocaleData.catalog.en.labels['翻译']);
assert.match(text(js), /function renderFloatingCaptionToggle\(\)/);
assert.doesNotMatch(text(js), /floatingCaptionEnabled/);
const captionModeSource = text(app).match(
  /function nextFloatingCaptionMode\(mode\) \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(captionModeSource);
const captionModeContext = { floatingCaptionMode: null };
runInNewContext(
  `${captionModeSource}\nthis.nextFloatingCaptionMode = nextFloatingCaptionMode;`,
  captionModeContext,
);
assert.equal(captionModeContext.nextFloatingCaptionMode('live'), 'live');
captionModeContext.floatingCaptionMode = 'live';
assert.equal(captionModeContext.nextFloatingCaptionMode('live'), null);
captionModeContext.floatingCaptionMode = 'playback';
assert.equal(captionModeContext.nextFloatingCaptionMode('live'), 'live');
assert.match(
  text(js),
  /'#floating-caption-toggle', '#translation-toggle', '#playback-floating-caption-toggle'/,
);
assert.match(
  text(css),
  /\.live-caption-controls :is\(\.floating-caption-toggle,\.translation-toggle,\.live-model-toggle\)\[data-enabled=true\]\{color:var\(--color-black\)\}/,
);
assert.doesNotMatch(text(html), /id="latest"/);
assert.doesNotMatch(text(css), /html\{zoom:/);
assert.match(text(css), /#live-view\.active/);
assert.match(text(css), /\.workspace:has\(#live-view\.active\)/);
assert.match(text(css), /\.transcript\{[^}]*min-width:0/);
assert.match(
  text(tailwind),
  /\.transcript\s+\{\s+@apply\s+col-span-9\s+flex\s+min-h-0\s+min-w-0;\s+\}/,
);
assert.match(text(tailwind), /\.live-layout\s+\{\s+@apply\s+relative\s+grid\s+min-h-0/);
assert.match(
  text(css),
  /\.transcript-scroll \.segment\{[^}]*padding:10px 0 12px[^}]*display:block/,
);
assert.match(text(css), /\.transcript-scroll \.segment-meta\{[^}]*align-items:baseline/);
assert.doesNotMatch(text(css), /\.transcript-scroll \.segment p\{[^}]*-webkit-line-clamp/);
assert.match(text(tailwind), /\.live-notes,\s+\.live-captions\s+\{\s+position:\s+absolute/);
assert.doesNotMatch(text(html), /data-toggle-live-mode/);
assert.doesNotMatch(text(js), /setLiveLayoutMode/);
assert.doesNotMatch(text(tailwind), /is-caption-mode|live-mode-toggle/);
assert.doesNotMatch(text(js), /live-translation-target|live-toggle|liveInputs/);
assert.match(text(js), /formatSpeakerName\(payload\.speaker_name \|\| payload\.speaker\)/);
assert.match(text(js), /function renderExportModal/);
assert.doesNotMatch(text(js), /data-track="vocals"/);
assert.doesNotMatch(text(js), /data-track="accompaniment"/);
assert.doesNotMatch(text(js), /data-export-detail[\s\S]{0,300}prompt\(/);
assert.doesNotMatch(text(components), /data-detail-tab="tracks"/);
assert.match(detailTabbarContext.renderDetailTabbar(), /data-detail-tab="notes"/);
assert.match(text(components), /data-detail-panel="notes"/);
assert.match(text(components), /class="detail-notes-empty"/);
assert.match(
  text(meetingDetail),
  /uiData\.detail\.refinedTranscript\s+=\s+revision\s+===\s+null\s+\?\s+\[\]/,
);
assert.match(text(app), /finalTranscript\.addEventListener\('click',/);
assert.match(text(app), /\[data-refine-more\]/);
assert.match(text(app), /\[data-detail-tab\]/);
// 点击字幕段的时间戳/说话人区域即可定位播放。
assert.match(text(app), /closest\('\.segment-meta'\)[\s\S]{0,400}playerAudio\.currentTime = start/);
assert.doesNotMatch(
  text(app),
  /finalTranscript\.addEventListener\('dblclick',[\s\S]{0,500}\[data-detail-tab\]/,
);
assert.doesNotMatch(text(components), /双轨录音/);
assert.doesNotMatch(text(components), /data-view-full-summary|查看完整内容/);
assert.match(text(js), /function showSummaryConfigCard/);
assert.match(text(js), /isSummaryAuthenticationError/);
assert.match(text(js), /summary\?\.configuration_required/);
assert.match(text(js), /function showSummaryProgress/);
assert.match(text(js), /summary\.started/);
assert.match(text(js), /pendingModelTasks/);
assert.doesNotMatch(text(js), /将逐字稿发送到所选模型供应商以生成纪要/);
assert.match(text(js), /openModal\('summary-model'\)/);
assert.match(text(js), /exportHubHtml\(\)/);
assert.match(text(js), /data-export-format=/);
assert.match(text(js), /data-flow-select-choice="export-format-/);
assert.doesNotMatch(text(app), /id: 'wechat'/);
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  const copy = localeContext.window.BreviaLocaleData.exportHubCopy[code];
  assert.equal(copy.platform.wechat, undefined, `${code} has no standalone WeChat share action`);
  assert.doesNotMatch(copy.summaryMany, /\{n\}/, `${code} bundle copy is not count-specific`);
}
assert.match(
  text(tailwind),
  /\.share-platform\s+svg\s+\{\s+@apply\s+row-span-2\s+h-5\s+w-5\s+shrink-0/,
);
assert.match(text(components), /data-regenerate-summary/);
assert.match(text(components), /data-copy-summary[^]*interfaceIcon\('copy'\)/);
assert.match(text(app), /data-copy-summary[\s\S]{0,300}share\s*\.copyText/);
assert.match(text(app), /trashCopy\(locale\)\.slogan/);
assert.match(text(components), /data-open-summary-edit[^]*interfaceIcon\('edit'\)/);
assert.match(text(js), /data-regenerate-summary/);
assert.match(
  text(app),
  /data-open-summary-edit[^]*uiData\.detail\.summaryEditing\s+=\s+true;[\s\S]*?renderMeetingDetail\(\)/,
);
assert.doesNotMatch(text(app), /summary-modal-document\) return;/);
assert.match(text(app), /data-export-save/);
assert.doesNotMatch(text(app), /data-export-reveal/);
assert.match(text(js), /data-regenerate-summary\]'\)\) void generateMeetingSummary\(\)/);
assert.match(
  text(tailwind),
  /\.markdown-content\s+ul\s+ul\s+\{\s+list-style-type:\s+circle;\s+\}[^]*\.markdown-content\s+ul\s+ul\s+ul\s+\{\s+list-style-type:\s+square;\s+\}/,
);
const stoppedListeners = text(app).match(/window\.brevia\.on\('meeting\.stopped'/g) || [];
assert.equal(stoppedListeners.length, 1);
assert.match(
  text(app),
  /window\.brevia\.on\('meeting\.stopped', async \(\{ meeting \}\) => \{[\s\S]{0,400}floatingCaptionMode = null;[\s\S]{0,150}if \(!meetingActive\) return;\s+meetingActive = false;\s+clearInterval\(timer\);/,
);
assert.match(
  text(js),
  /async function generateMeetingSummary\(meetingId = breviaClient\?\.state\.selectedMeetingId\)/,
);
assert.match(
  text(js),
  /if\s+\(summary\?\.cancelled\)\s+\{\s+hideSummaryProgress\(\);\s+return;\s+\}/,
);
// 结束事件共用一条自动纪要路径，桌面/手机结束与列表刷新失败都应覆盖。
const stoppedHandlerSource = text(app).match(
  /window\.brevia\.on\('meeting\.stopped', async \(\{ meeting \}\) => \{[\s\S]*?\n  \}\);/,
)?.[0];
assert.ok(stoppedHandlerSource);
const summaryConfigFunctions = [
  'providerEntry',
  'builtinFallbackModel',
  'requestConfig',
  'summaryRequestConfig',
]
  .map((name) => text(app).match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0])
  .join('\n');
for (const scenario of [
  { provider: 'built-in', model: 'local', installed: true, expected: 1 },
  { provider: 'built-in', model: 'local', installed: true, phone: true, expected: 1 },
  { provider: 'built-in', installed: true, expected: 1 },
  { provider: 'built-in', model: 'local', expected: 0 },
  { provider: 'built-in', model: 'local', installed: true, enabled: false, expected: 0 },
  { provider: 'remote', model: 'online', keyReference: 'saved-key', expected: 1 },
  { provider: 'remote', model: 'online', expected: 0 },
  { provider: 'built-in', model: 'local', installed: true, cleanupFails: true, expected: 1 },
]) {
  const calls = [];
  const failures = [];
  const meeting = { id: 'ended', tags: scenario.phone ? ['手机录音'] : [] };
  const context = {
    summaryConfig: {
      enabled: scenario.enabled !== false,
      provider: scenario.provider,
      providers: {
        [scenario.provider]: { model: scenario.model, keyReference: scenario.keyReference },
      },
    },
    summaryProviderPresets: {
      'built-in': { format: 'builtin' },
      remote: { needsKey: true, format: 'openai' },
    },
    modelCatalog: [{ id: 'local', kind: 'llama-chat' }],
    modelPaths: new Set(scenario.installed ? ['local'] : []),
    meetingActive: true,
    floatingCaptionMode: null,
    timer: 0,
    clearInterval() {},
    stopAiNoteForMeeting() {},
    resetAiNoteSuggestions() {},
    breviaClient: {
      state: { meeting },
      capture: {
        stop: async () => {
          if (scenario.cleanupFails) throw new Error('capture cleanup');
        },
      },
    },
    miniMeeting: { hidden: false },
    applyBackendDetail() {},
    showView() {},
    refreshBackendMeetings: async () => {
      throw new Error('list refresh');
    },
    showToast: (message) => failures.push(message),
    generateMeetingSummary: (id) => calls.push(id),
    console: { error() {} },
    window: {
      brevia: {
        on: (_, handler) => {
          context.stopped = handler;
        },
      },
    },
  };
  runInNewContext(`${summaryConfigFunctions}\n${stoppedHandlerSource}`, context);
  await context.stopped({ meeting });
  await context.stopped({ meeting });
  assert.equal(calls.length, scenario.expected, JSON.stringify(scenario));
  assert.ok(calls.every((id) => id === meeting.id));
  assert.equal(context.meetingActive, false);
  assert.equal(context.breviaClient.state.meeting, null);
  assert.deepEqual(failures, ['list refresh']);
}
assert.doesNotMatch(text(app), /live-more-toggle|live-more-panel/);

for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  for (const key of ['开启悬浮字幕', '关闭悬浮字幕', '翻译：开', '翻译：关', '识别模型'])
    assert.ok(localeContext.window.BreviaLocaleData.catalog[code].labels[key], `${code}: ${key}`);
}
// 只有移动菜单锚点的祖先滚动才关闭菜单，字幕更新和菜单自身滚动保持打开。
const floatingScrollSource = text(app)
  .slice(text(app).indexOf('function fitFlowSelectOptions'))
  .match(/document\.addEventListener\(\n  'scroll',[\s\S]*?\n\);/)?.[0];
assert.ok(floatingScrollSource);
let onFloatingScroll;
let expanded = 'true';
const select = {
  querySelector: () => ({
    setAttribute: (_, value) => {
      expanded = value;
    },
  }),
};
const popup = { hidden: false, closest: () => select };
const scrollContext = {
  document: {
    addEventListener: (_, handler) => {
      onFloatingScroll = handler;
    },
    querySelectorAll: () => [popup],
  },
};
runInNewContext(floatingScrollSource, scrollContext);
for (const containsAnchor of [false, false, true]) {
  onFloatingScroll({ target: { contains: (owner) => containsAnchor && owner === select } });
  assert.equal(popup.hidden, containsAnchor);
  assert.equal(expanded, containsAnchor ? 'false' : 'true');
}
const fitSource = text(app).match(/function fitFlowSelectOptions\([^]*?\n\}/)?.[0];
const fitted = {
  hidden: false,
  style: {},
  classList: { add() {} },
  querySelectorAll: () => [],
  offsetWidth: 320,
  offsetHeight: 360,
};
const fitContext = { innerWidth: 880, innerHeight: 800 };
runInNewContext(`${fitSource}\nthis.fit = fitFlowSelectOptions`, fitContext);
fitContext.fit(
  fitted,
  {
    closest: () => ({ querySelector: () => null }),
    getBoundingClientRect: () => ({ left: 500, top: 700, bottom: 744, width: 44 }),
  },
  320,
  360,
);
assert.equal(fitted.style.width, '320px');
assert.equal(fitted.style.maxHeight, '360px');
assert.equal(fitted.style.top, '336px');

assert.match(
  text(js),
  /function\s+availableUpdateActionLabel\(\)\s+\{\s+return\s+updateVersion\s+\?\s+updateCopy\(\)\.update\.replace\('0\.2\.0',\s+updateVersion\)\s+:\s+updateCopy\(\)\.update;\s+\}/,
);
assert.match(text(js), /updateAvailable\s+\?\s+availableUpdateActionLabel\(\)\s+:\s+copy\.action/);
assert.match(text(js), /content: 'notes'/);
// 统一「导出与分享」面板:内容勾选 + 每项格式 + 导出文件 + 分享到。
assert.match(text(js), /function exportHubHtml/);
assert.match(text(js), /audio: 'wav'/, 'recording exports use the saved WAV format');
assert.match(
  text(js),
  /content\s+===\s+'audio'\s+\?\s+'<span\s+class="export-format-fixed">WAV<\/span>'/,
  'recordings do not show a format picker',
);
assert.doesNotMatch(text(js), /audio: \['m4a', 'wav', 'flac'\]/);
assert.match(text(js), /function updateExportBuilderState/);
assert.match(text(js), /function runExportBundle/);
assert.match(text(js), /data-export-item/);
assert.match(text(js), /data-share-target/);
assert.match(text(js), /share\.copyText/);
assert.match(text(js), /share\.openExternal/);
assert.match(text(js), /meeting\.exportBundle/);
assert.match(text(js), /filename_prefix: `\[\$\{exportContentLabel\[content\]\(\)\}\]`/);
assert.match(text(js), /t\('会议录音'\)/);
// 社交分享只带摘要,邮件/剪贴板带全文。
assert.match(text(js), /function makeExcerpt/);
assert.match(text(js), /function markdownToPlainText/);
// mailto 正文按编码后长度截断,避免 CJK 膨胀撑爆主进程 URL 上限。
assert.match(text(js), /function buildMailto/);
assert.match(text(js), /encodeURIComponent\(text\)\.length > maxEncodedBody/);
assert.match(text(js), /share\.openExternal\(\{ url: buildMailto\(subject, text\) \}\)/);
// 文本渠道可跨平台;系统分享面板仅在 darwin 上出现,文件经 meeting.export-bundle(mode: system) 走原生面板。
assert.match(text(js), /window\.brevia\?\.platform === 'darwin'/);
assert.match(text(js), /runExportBundle\('system'/);
assert.match(text(preload), /exportBundle: invoke\('meeting\.export-bundle'\)/);
assert.match(text(preload), /platform: process\.platform/);
assert.match(text(electronMain), /new ShareMenu\(sharingItem\)\.popup/);
assert.match(text(electronMain), /System share is only available on macOS/);
assert.match(text(electronMain), /handleIpc\('meeting\.export-bundle'/);
assert.match(text(electronMain), /filename_prefix: z\.string\(\)\.max\(60\)\.optional\(\)/);
// 详情页「转发」改为打开分享面板,不再直接打包。
assert.doesNotMatch(text(js), /data-share-detail'\)\.addEventListener\('click', async/);
// preload 暴露 share API;主进程只放行 https 与 mailto。
assert.match(text(preload), /copyText: invoke\('share\.copy-text'\)/);
assert.match(text(preload), /openExternal: invoke\('share\.open-external'\)/);
assert.match(text(preload), /file: invoke\('share\.file'\)/);
assert.match(text(electronMain), /\^\(https:\\\/\\\/\|mailto:\)/);
assert.match(text(js), /speakerProfile\.samples/);
assert.match(text(js), /speakerProfile\.deleteSample/);
// 缺失模型一律抛结构化异常：主进程据此触发下载，而不是正则解析文案。
assert.match(text(asr), /raise ModelNotInstalled\(\[segmentation_id, embedding_id\]\)/);
assert.doesNotMatch(text(asr), /are not installed/, '不再手拼人类可读的缺失报错');
assert.match(text(asr), /expected_checksum = model\.get\("archive_sha256"\)/);
assert.match(text(asr), /if digest != expected_checksum:/);
assert.match(text(electronMain), /meeting\.bundle/);
assert.match(text(electronMain), /error\.code === 'ENOENT'/);
assert.match(text(electronMain), /configuration_required: true/);
assert.match(text(electronMain), /summary\.config\.save/);
assert.ok(localeContext.window.BreviaLocaleData.catalog.zh.labels['error.summary.no_transcript']);
assert.ok(localeContext.window.BreviaLocaleData.catalog.en.labels['error.summary.no_transcript']);
assert.doesNotMatch(text(js), /const modelSizes/);
assert.match(text(js), /const modelSize = \(modelId\) => modelCatalog\.find/);

// ─── 模型选择：真跑逻辑，而不是断言源码里有这个函数 ──────────────────────────────
//
// 下面这组断言替代了原先"源码里存在 function xxx"的写法。那种写法有两个确定的坏处：
// 改个函数名就变红（而行为没变），以及真正会出错的边界一条也测不到。所有边界都用**合成
// 清单**构造——这正是不把逻辑从 app.js 抽出来的代价：拿不到 modelCatalog 就无法构造。
const syntheticCatalog = [
  {
    id: 'shadow-retired',
    name: 'Retired',
    kind: 'qwen3',
    stages: ['refined'],
    refined_priority: 0,
    languages: ['zh'],
    default_for_languages: ['zh'],
    retired: true,
  },
  {
    id: 'zh-fast',
    name: 'ZhFast',
    kind: 'funasr-nano',
    stages: ['refined'],
    refined_priority: 1,
    languages: ['zh', 'en', 'yue'],
    default_for_languages: ['zh'],
    size_bytes: 1024,
  },
  {
    id: 'multi',
    name: 'Multi',
    kind: 'qwen3',
    stages: ['refined'],
    refined_priority: 2,
    languages: ['ja', 'ko', 'zh', 'en'],
    default_for_languages: ['ja'],
    size_bytes: 2048,
  },
  {
    id: 'western',
    name: 'Western',
    kind: 'nemo-transducer',
    stages: ['refined'],
    refined_priority: 3,
    languages: ['en', 'de', 'fr'],
    default_for_languages: ['en', 'auto'],
    size_bytes: 4096,
  },
  { id: 'vad', name: 'Vad', kind: 'vad', stages: ['vad'], languages: ['all'] },
];

// kind 决定 auto：只有按整段音频判语种的类型能承担混说。
assert.equal(MS.modelSupportsLanguage({ kind: 'qwen3', languages: ['ja'] }, 'auto'), true);
assert.equal(
  MS.modelSupportsLanguage({ kind: 'nemo-transducer', languages: ['en'] }, 'auto'),
  true,
);
assert.equal(
  MS.modelSupportsLanguage({ kind: 'funasr-nano', languages: ['zh'] }, 'auto'),
  false,
  '逐语言微调的模型不得承担混说',
);
// 「multilingual」不是通配符：不含中文的模型不得被判成支持中文。
assert.equal(
  MS.modelSupportsLanguage({ kind: 'nemo-transducer', languages: ['multilingual'] }, 'zh'),
  false,
);
assert.equal(MS.modelSupportsLanguage({ kind: 'x', languages: ['zh'] }, 'zh'), true);
assert.equal(MS.modelSupportsLanguage({ kind: 'x', languages: ['all'] }, 'de'), true);
assert.equal(MS.modelSupportsLanguage({ kind: 'x', languages: [] }, 'de'), false);
assert.equal(MS.modelSupportsLanguage(undefined, 'zh'), false, '未知模型不得判成支持');

// 候选模型：排除退役、排除非整句识别、按 refined_priority 排序。
assert.deepEqual(
  MS.selectableRefinedModels(syntheticCatalog).map((model) => model.id),
  ['zh-fast', 'multi', 'western'],
);
assert.deepEqual(MS.selectableRefinedModels(undefined), []);
assert.deepEqual(
  MS.selectableRefinedModels(syntheticCatalog).map((model) => model.id),
  MS.selectableRefinedModels(syntheticCatalog).map((model) => model.id),
  '排序必须是稳定的',
);

// 语言支持的落地效果：混说时逐语言模型被排除。
assert.deepEqual(
  MS.refinedModelsForLanguage(syntheticCatalog, 'auto').map((model) => model.id),
  ['multi', 'western'],
);
assert.deepEqual(
  MS.refinedModelsForLanguage(syntheticCatalog, 'zh').map((model) => model.id),
  ['zh-fast', 'multi'],
);
assert.deepEqual(
  MS.refinedModelsForLanguage(syntheticCatalog, 'de').map((model) => model.id),
  ['western'],
);
assert.deepEqual(MS.refinedModelsForLanguage(syntheticCatalog, 'ar'), [], '无人支持的语言返回空');

// 声明的默认优先于顺序；没有声明时回落到第一个支持的模型。
assert.equal(MS.declaredDefaultModelId(syntheticCatalog, 'zh'), 'zh-fast');
assert.equal(MS.declaredDefaultModelId(syntheticCatalog, 'en'), 'western');
assert.equal(MS.declaredDefaultModelId(syntheticCatalog, 'auto'), 'western');
assert.equal(
  MS.declaredDefaultModelId(syntheticCatalog, 'ko'),
  'multi',
  '未声明的语言回落到首个支持者',
);

// 最终选择：① 用户偏好 ② 声明默认 ③ 已安装回退。
assert.equal(
  MS.defaultRefinedModelId({
    catalog: syntheticCatalog,
    language: 'zh',
    installed: new Set(['zh-fast']),
  }),
  'zh-fast',
);
assert.equal(
  MS.defaultRefinedModelId({
    catalog: syntheticCatalog,
    language: 'en',
    installed: new Set(['zh-fast']),
  }),
  'zh-fast',
  '声明的默认没装时必须回落到已安装的同语言模型，而不是要求再下一个',
);
assert.equal(
  MS.defaultRefinedModelId({ catalog: syntheticCatalog, language: 'en', installed: new Set() }),
  'western',
  '一个都没装时仍返回声明的默认',
);
assert.equal(
  MS.defaultRefinedModelId({
    catalog: syntheticCatalog,
    language: 'zh',
    installed: new Set(['multi']),
    preferredId: 'multi',
  }),
  'multi',
  '用户显式偏好优先',
);
assert.equal(
  MS.defaultRefinedModelId({
    catalog: syntheticCatalog,
    language: 'zh',
    installed: new Set(['multi']),
    preferredId: 'western',
  }),
  'multi',
  '偏好若不支持该语言则被忽略（western 不含 zh）',
);
assert.equal(
  MS.defaultRefinedModelId({
    catalog: [],
    language: 'zh',
    installed: new Set(),
    fallbackId: 'last-resort',
  }),
  'last-resort',
  '清单为空时由调用方的兜底常量接手',
);
assert.equal(
  MS.defaultRefinedModelId({
    catalog: syntheticCatalog,
    language: 'zh',
    installed: new Set(['multi']),
    preferredId: 'zh-fast',
  }),
  'zh-fast',
  '偏好模型尚未安装时也必须压过已安装回退，否则等于静默丢弃用户的选择',
);
assert.equal(
  MS.defaultRefinedModelId({
    catalog: syntheticCatalog,
    language: 'zh',
    installed: new Set(['multi']),
    preferredId: 'shadow-retired',
  }),
  'multi',
  '已退役模型不接受的偏好必须回落到清单默认/已安装模型',
);

// 下拉选项：未安装的带体积，推荐角标只给声明的默认。
const options = MS.refinedModelOptions({
  catalog: syntheticCatalog,
  language: 'zh',
  installed: new Set(['zh-fast', 'multi']),
  downloadWord: 'Download',
  recommendedWord: 'Recommended',
  formatSize: (bytes) => `${bytes}B`,
});
assert.deepEqual(options, [
  ['zh-fast', 'ZhFast', 'Recommended'],
  ['multi', 'Multi', ''],
]);
assert.deepEqual(
  MS.refinedModelOptions({
    catalog: syntheticCatalog,
    language: 'en',
    installed: new Set(),
    downloadWord: 'Download',
    recommendedWord: 'Rec',
    formatSize: (bytes) => `${bytes}B`,
  }),
  [
    ['zh-fast', 'ZhFast · Download 1024B', ''],
    ['multi', 'Multi · Download 2048B', ''],
    ['western', 'Western · Download 4096B', 'Rec'],
  ],
);

// 模型库可见性：退役模型不出现在列表里（清单保留它只为解析历史 id）。
assert.deepEqual(
  MS.visibleModels(syntheticCatalog).map((model) => model.id),
  ['zh-fast', 'multi', 'western', 'vad'],
);
assert.deepEqual(MS.visibleModels(undefined), []);
// 默认模型随界面语言置顶，其他识别模型按优先级排列，且不改写原清单。
const reversedCatalog = [...syntheticCatalog].reverse();
for (const [language, expected] of [
  ['zh', ['zh-fast', 'multi', 'western', 'vad']],
  ['ja', ['multi', 'zh-fast', 'western', 'vad']],
  ['en', ['western', 'zh-fast', 'multi', 'vad']],
]) {
  assert.deepEqual(
    MS.visibleModels(reversedCatalog, language).map((model) => model.id),
    expected,
  );
}
assert.equal(reversedCatalog[0].id, 'vad', '显示排序不得改写原清单');
const macModels = modelManifest.filter(
  (model) => !model.platforms || model.platforms.includes('darwin'),
);
const onboardingModelContext = {
  refinedModels: () => MS.selectableRefinedModels(macModels),
  asrCopy: asrCopyData,
  manifestDefaultRefinedModelId: (language) => MS.declaredDefaultModelId(macModels, language),
};
runInNewContext(
  text(app).match(/function onboardingAsrModels\(\) \{[\s\S]*?\n\}/)[0],
  onboardingModelContext,
);
assert.deepEqual(
  Array.from(onboardingModelContext.onboardingAsrModels(), (model) => model.id),
  ['funasr-nano-mlx', 'qwen3-asr-0.6b-mlx', 'parakeet-tdt-0.6b-v3-mlx'],
  '首启仅提供三个默认模型，其他模型留在设置的模型库中',
);
assert.deepEqual(
  MS.visibleModels(macModels, 'zh')
    .filter((model) => model.stages.includes('refined'))
    .map((model) => model.id),
  [
    'funasr-nano-mlx',
    'qwen3-asr-0.6b-mlx',
    'parakeet-tdt-0.6b-v3-mlx',
    'qwen3-asr-1.7b-mlx',
    'whisper-large-v3-turbo-mlx',
  ],
);

// 分组映射必须显式：按前缀匹配会把 speaker-segmentation 同时归进声纹组。
const STAGE_GROUPS = {
  refined: 'refined',
  vad: 'vad',
  diarization: 'diarization',
  'speaker-segmentation': 'diarization',
  'speaker-embedding': 'voiceprint',
};
assert.equal(
  MS.modelLibraryGroup({ stages: ['speaker-segmentation'] }, STAGE_GROUPS),
  'diarization',
);
assert.equal(MS.modelLibraryGroup({ stages: ['speaker-embedding'] }, STAGE_GROUPS), 'voiceprint');
assert.equal(MS.modelLibraryGroup({ stages: ['refined'] }, STAGE_GROUPS), 'refined');
assert.equal(MS.modelLibraryGroup({ stages: ['unknown-stage'] }, STAGE_GROUPS), undefined);
assert.equal(MS.modelLibraryGroup({}, STAGE_GROUPS), undefined);

// 即使清单包含占用和内存字段，摘要也只显示下载大小。
assert.equal(
  MS.modelSizeSummary(
    { size_bytes: 100, disk_size_bytes: 200, memory_floor_bytes: 300 },
    { download: 'D', disk: 'K', memory: 'M' },
    (bytes) => `${bytes}B`,
  ),
  'D 100B',
);
assert.equal(
  MS.modelSizeSummary(
    { size_bytes: 100 },
    { download: 'D', disk: 'K', memory: 'M' },
    (bytes) => `${bytes}B`,
  ),
  'D 100B',
);

// 前端与后端必须用同一套语言判断与同一份清单字段：这两个常量不能各自漂移。
assert.deepEqual([...MS.MULTILINGUAL_MODEL_KINDS].sort(), ['nemo-transducer', 'qwen3', 'whisper']);
assert.equal(MS.LOCALES.length, 8);

// ─── 模型清单的唯一事实来源（机制级不变量） ─────────────────────────────────────
//
// 这一条守的是本项目反复踩的那个坑：`models.json` 是唯一事实来源，但历史上同时存在
// 五份平行副本（modelIds / refinedModelIds / modelRatings / modalCopy[*].models.items /
// timestampAlignedRefinedModels）。漏同步一份不会报错，只会在用户那边表现为
// 「招牌功能在部分语言下悄悄失效」或「退役模型被重新下载」。
//
// 判据是机械的：任何**生产源码**里出现「同一处同时提到 ≥2 个清单模型 id」，
// 就是一份平行清单的候选（白名单见下）。清单本身、以及显式的时间戳对齐集合是有意为之，
// 因此单独列出；bench/diagnose 脚本是分析工具，不属于产品代码。
const MODEL_ID_SOURCES = [
  'app.js',
  'app-meeting-detail.js',
  'ui-components.js',
  'ui-data.js',
  'i18n-data.js',
  'asr-copy.js',
  'backend-client.js',
  'workspaces.js',
  'onboarding.js',
  'floating-caption.js',
];
const manifestIds = new Set(modelManifest.map(({ id }) => id));
const parallelListOffenders = [];
for (const name of MODEL_ID_SOURCES) {
  const source = await readFile(name, 'utf8');
  for (const line of source.split('\n')) {
    const hits = [...manifestIds].filter(
      (id) => line.includes(`'${id}'`) || line.includes(`"${id}"`),
    );
    // 同一个翻译表内的别名赋值不是第二份模型清单。
    const translationAlias =
      name === 'i18n-data.js' &&
      /^\s*model\[locale\]\[['"][^'"]+['"]\]\s*=\s*model\[locale\]\[['"][^'"]+['"]\];\s*$/.test(
        line,
      );
    if (hits.length >= 2 && !translationAlias)
      parallelListOffenders.push(`${name}: ${line.trim().slice(0, 120)}`);
  }
}
assert.deepEqual(
  parallelListOffenders,
  [],
  `生产源码里不应再出现并排的多个模型 id（那是平行清单的候选）：\n${parallelListOffenders.join('\n')}`,
);
// 前端不再持有任何硬编码的模型 id 列表：模型库、识别模型下拉、首启选型都从清单生成，
// 排序读 refined_priority。留着副本就一定会漂移（这就是本项目反复踩过的那个坑）。
assert.doesNotMatch(
  text(js),
  /const modelIds = \[/,
  'the hardcoded model-id array must stay deleted',
);
assert.doesNotMatch(
  text(js),
  /const refinedModelIds = \[/,
  'the hardcoded refined-model array must stay deleted',
);
assert.match(text(ms), /refined_priority/, '候选顺序必须来自清单字段');
assert.doesNotMatch(text(js), /\.refined_priority/, 'app.js 不得自己读排序字段（交给模块）');
// 模型库完全由 models.json 生成，因此不变量直接钉在清单上：每个模型有 name / speed /
// quality，且它们的 speed/quality 落在 1..3 的刻度内。以前这里核对的是 i18n 里那份
// 按下标对齐的显示表；那张表已删除，靠「第 i 个 id 对应第 i 个名字」的一致性不再需要，
// 因为显示名直接取自清单的 name。
for (const model of modelManifest) {
  assert.ok(model.name, `${model.id} needs a display name in the manifest`);
  for (const axis of ['speed', 'quality']) {
    assert.ok(
      Number.isInteger(model[axis]) && model[axis] >= 1 && model[axis] <= 3,
      `${model.id} needs ${axis} on a 1..3 scale, got ${model[axis]}`,
    );
  }
}
// 前端展示顺序与后端回退顺序共用清单里的 refined_priority：缺字段或重号会让两端对同一个
// 语言选出不同的回退模型，而「语言 → 默认模型」本该只有一处定义。
for (const platform of ['darwin', 'windows', 'linux']) {
  const available = selectableRefined.filter(
    (model) => !model.platforms || model.platforms.includes(platform),
  );
  const priorities = available.map(({ refined_priority: priority }) => priority);
  assert.ok(
    priorities.every(Number.isInteger),
    'every selectable refined model needs refined_priority',
  );
  assert.equal(
    new Set(priorities).size,
    priorities.length,
    `${platform}: priorities must be unique`,
  );
  const languages = available.flatMap((model) => model.default_for_languages || []);
  assert.equal(
    new Set(languages).size,
    languages.length,
    `${platform}: language defaults must be unique`,
  );
  assert.equal(
    MS.declaredDefaultModelId(available, 'zh'),
    platform === 'darwin' ? 'funasr-nano-mlx' : 'funasr-nano-int8',
  );
  assert.equal(
    MS.declaredDefaultModelId(available, 'en'),
    platform === 'darwin' ? 'parakeet-tdt-0.6b-v3-mlx' : 'parakeet-tdt-0.6b-v3-int8',
  );
}
assert.match(
  text(app),
  /refined_priority/,
  'app.js must derive the candidate order from the manifest',
);
// 时间戳对齐集合必须与清单保持同步：漏登记新模型会让精修稿被当成「无时间戳全文」渲染，
// 顺带关掉逐句编辑（见 ui-components.js 的 refinedMode 分支）。
// 用**行为**断言，而不是解析集合源码：清单里每个可选用的整句识别模型都必须被判为
// 支持时间戳，退役的必须被判为不支持。这样既守住了不变量，也不依赖集合的写法。
for (const { id } of selectableRefined) {
  assert.equal(
    utilsContext.refinedModelSupportsTimestamps(id),
    true,
    `${id} 是可选整句识别模型，必须被判为支持时间戳对齐`,
  );
}
for (const { id } of modelManifest.filter((m) => m.retired)) {
  assert.equal(
    utilsContext.refinedModelSupportsTimestamps(id),
    false,
    `已退役的 ${id} 不应再被判为支持时间戳对齐`,
  );
}
assert.doesNotMatch(text(js), /reference_text|embeddingModel|embedding_model_id/);
assert.match(text(js), /data-delete-model/);
assert.match(text(css), /::-webkit-scrollbar-thumb\{/);
assert.match(text(css), /:where\(html,body,\*\)\.is-scrolling\{scrollbar-color:#aaa transparent/);
assert.doesNotMatch(text(css), /scrollbar-color:#666 transparent/);
assert.match(
  text(css),
  /html\[data-theme=dark\] \.brand img,html\[data-theme=dark\] \.onboarding-brand\{filter:invert\(\)/,
);
assert.match(
  text(tailwind),
  /html\[\s*data-theme="dark",?\s*\]\s+label,\s+html\[\s*data-theme="dark",?\s*\]\s+legend\s+\{\s+color:\s+#b0b0b0/,
);
// ─── 语义令牌的对比度 ────────────────────────────────────────────────────────
//
// T2.2 的暗色门禁只检查"这个类有没有暗色规则"，**不检查结果颜色对不对**——这正是
// 链接蓝 #0066ff 在暗色面板上只有约 2.4:1 却一直没被发现的原因（它在暗色区出现过，
// 只是出现的方式是"从不被覆盖"）。语义令牌把取值集中到一处后，就可以直接算对比度：
// 这是「颜色可读」这件事唯一可自动化的判据。
//
// 阈值：四个角色色在两种主题的页面和导航/面板底色上
// 都必须 ≥ 4.5:1（WCAG AA 正文）。项目原有的次要灰 #767676 是 3.50/4.15，属于既有选择
// （用于 11px 以下的小标签），这里按 ≥ 3.0 守住"不再变差"，并在注释里注明它未达 AA。
const relativeLuminance = (value) => {
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex;
  const channels = [0, 2, 4]
    .map((index) => parseInt(full.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrastRatio = (first, second) => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
};
// 对比度和令牌配对共用同一份浅色、暗色块，避免两套定位规则漂移。
const themeBlock = text(tailwind).slice(
  text(tailwind).indexOf('@theme'),
  text(tailwind).indexOf('@layer base'),
);
const tokenDarkBody = [
  ...text(tailwind).matchAll(/html\[data-theme="dark"\]\s*\{([^{}]*)\}/g),
].find((match) => match[1].includes('--color-link'))?.[1];
assert.ok(tokenDarkBody, '未找到暗色令牌块（应含 --color-link）');
const [lightTokens, darkTokens] = [themeBlock, tokenDarkBody].map((block) =>
  Object.fromEntries(
    [...block.matchAll(/--(color-[\w-]+):\s*(#[0-9a-fA-F]{3,6})/g)].map((match) => [
      match[1],
      match[2],
    ]),
  ),
);
for (const role of [
  'color-link',
  'color-danger',
  'color-warning',
  'color-success',
  'color-success-border',
]) {
  assert.ok(lightTokens[role], `@theme 里缺少令牌 --${role}`);
  assert.ok(darkTokens[role], `暗色令牌块里缺少 --${role}`);
  assert.notEqual(
    lightTokens[role],
    darkTokens[role],
    `--${role} 在两种主题下必须有不同取值，否则就是漏了暗色`,
  );
}
const CONTRAST_BACKGROUNDS = {
  light: [lightTokens['color-surface'], lightTokens['color-navigation']],
  dark: [darkTokens['color-surface'], darkTokens['color-overlay']],
};
for (const [theme, backgrounds] of Object.entries(CONTRAST_BACKGROUNDS)) {
  const tokens = theme === 'light' ? lightTokens : darkTokens;
  for (const background of backgrounds) {
    for (const role of ['color-link', 'color-danger', 'color-warning', 'color-success']) {
      const ratio = contrastRatio(tokens[role], background);
      assert.ok(
        ratio >= 4.5,
        `${theme}/${background}: --${role} (${tokens[role]}) 对比度 ${ratio.toFixed(2)} < 4.5（WCAG AA 正文）`,
      );
    }
    // 文字色也来自源码，避免只比较测试内写死的颜色。
    assert.ok(
      contrastRatio(tokens['color-text-subtle'], background) >= 3.0,
      `${theme}: 次要文字对比度不得低于 3.0`,
    );
    assert.ok(
      contrastRatio(tokens['color-text'], background) >= 7,
      `${theme}: 正文对比度应达到 AAA`,
    );
  }
}
// 录制红与次要灰属于**既有**取值，未达 AA 正文标准（录制红浅色 3.87、次要灰浅 3.50/暗 4.15），
// 但它们是小号状态标签而不是正文；这里按 ≥3.0 守住"不得比现状更差"，并把事实写下来，
// 而不是把阈值调低到刚好通过。
for (const role of ['color-recording', 'color-recording-border']) {
  for (const [tokens, background] of [
    [lightTokens, lightTokens['color-surface']],
    [darkTokens, darkTokens['color-surface']],
  ]) {
    if (!tokens[role]) continue;
    assert.ok(
      contrastRatio(tokens[role], background) >= 3.0,
      `--${role} (${tokens[role]}) 在 ${background} 上低于 3.0`,
    );
  }
}
// ─── 令牌成对门禁 ──────────────────────────────────────────────────────────────
//
// 语义令牌的浅色取值写在 `@theme` 里，暗色取值写在末尾的 `html[data-theme="dark"]` 令牌块里。
// 只加深色令牌是目前最省事的漏暗色方式（写 `var(--color-x)` 却不给暗色取值，暗色下就沿用
// 浅色值）。这条门禁要求两边成对：除 `--color-black/--color-white` 这两个 Tailwind 基础色阶
// 外，所有 `--color-*` 令牌都必须在暗色块里有对应取值。
const tokenLightNames = [...themeBlock.matchAll(/(--color-[\w-]+)\s*:/g)].map((match) => match[1]);
const tokenDarkNames = new Set(
  [...tokenDarkBody.matchAll(/(--color-[\w-]+)\s*:/g)].map((match) => match[1]),
);
const tokenBaseNames = new Set(['--color-black', '--color-white']);
assert.ok(tokenLightNames.length >= 15, `令牌数量异常：${tokenLightNames.length}`);
const tokenUnpaired = tokenLightNames.filter(
  (name) => !tokenDarkNames.has(name) && !tokenBaseNames.has(name),
);
assert.deepEqual(
  tokenUnpaired,
  [],
  `这些令牌只有浅色取值，没有暗色取值：\n${tokenUnpaired.join('\n')}`,
);
// 反向：暗色块里不得出现主题块未定义的令牌（拼错名字会静默失效）。
const tokenOrphanDark = [...tokenDarkNames].filter((name) => !tokenLightNames.includes(name));
assert.deepEqual(
  tokenOrphanDark,
  [],
  `暗色块里的令牌未在 @theme 定义：\n${tokenOrphanDark.join('\n')}`,
);

// ─── 暗色覆盖门禁 ────────────────────────────────────────────────────────────
//
// 项目的手写组件类全部靠 `html[data-theme="dark"] …` 覆盖，而注册这条规则的唯一途径是
// 人记得写。上一次发版因此漏了 13 个新类（模型名、定位短句、刻度值在暗色下 1.0:1，
// 整块看不见），并且删掉了一条旧的暗色规则却没有替代。
//
// 判据：`@layer components` 里**带颜色工具类**的组件类，必须在暗色区出现过；否则要列进
// DARK_AGNOSTIC 并写明理由。白名单不是"豁免名单"——每一条都是"这个类不需要暗色规则"
// 的具体判断，新增条目必须能说清为什么。
const DARK_AGNOSTIC = {
  // 只用了 #767676：这个灰度就是现有暗色规则为次要文字选定的取值，浅色规则直接给出它，
  // 两个主题下对比度都够，再写一条同值规则没有意义。
  'export-builder-section': '仅 text-[#767676]，该灰度本身就是暗色下的次要文字取值',
  'export-empty': '仅 text-[#767676]，同上',
  'search-snippet-title': '仅 text-[#767676]，同上',
  'segment-meta': '仅 text-[#767676]，同上',
  'summary-model-hint': '仅 text-[#767676]，同上',
  'window-actions': '仅 text-[#767676]，同上',
  // 刻意反相：浅色下白底黑字，暗色下依然是"亮底暗字"，对比正确（与 .modal-action 的暗色规则同构）。
  // 纯遮罩，没有前景内容，暗色下不需要调整。
  'modal-backdrop': '纯遮罩层，无前景内容',
  // 与 .onboarding-page 同时挂载，由 `html[data-theme=dark] .onboarding-page{background:#191919}`
  // 覆盖（属性选择器 0-2-0 高于本类的 0-1-0），本类的 bg-white 在暗色下不会生效。
  'onboarding-active': '由 .onboarding-page 的暗色规则覆盖（属性选择器特异性更高）',
};
const COMPONENT_COLOR =
  /(?:text|bg|border|from|to|via)-\[#[0-9a-fA-F]+\]|text-(?:black|white|red|green)|bg-(?:black|white|red|green)|border-(?:black|white|red|green)/;
const componentLayerStart = text(tailwind).indexOf('@layer components');
const componentLayerBody = (() => {
  const source = text(tailwind);
  let depth = 0;
  for (let index = componentLayerStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(source.indexOf('{', componentLayerStart) + 1, index);
    }
  }
  return '';
})();
const darkSelectors = [...text(tailwind).matchAll(/data-theme="?dark"?\][^{]*/g)]
  .map((match) => match[0])
  .join(',');
const darkClasses = new Set(
  [...darkSelectors.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]),
);
const colourClasses = new Map();
for (const [, selector, body] of componentLayerBody.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!COMPONENT_COLOR.test(body)) continue;
  for (const [, name] of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (!colourClasses.has(name)) colourClasses.set(name, body.trim().slice(0, 90));
  }
}
// 判据有两条通路：
//  1. 该类的颜色写死在浅色规则里 → 必须有一条暗色规则（或列进白名单）；
//  2. 该类的颜色全部走语义令牌（`(--color-…)`）→ **按构造**两个主题都成立，不需要暗色规则。
// 第 2 条是令牌化的收益：漏暗色在语言层面不可能，所以门禁要奖励它而不是继续要求写规则。
// 判据用"有没有写死的颜色"来表达：出现十六进制字面量，或 black/white/red/green 这类
// 不随主题变化的具名色，就算写死。
const HARDCODED_COLOUR =
  /#[0-9a-fA-F]{3,6}|(?:text|bg|border|decoration|outline)-(?:black|white|red|green)\b/;
const missingDark = [...colourClasses.entries()]
  .filter(
    ([name, declaration]) =>
      !darkClasses.has(name) && HARDCODED_COLOUR.test(declaration) && !(name in DARK_AGNOSTIC),
  )
  .map(([name]) => name)
  .sort();
assert.deepEqual(
  missingDark,
  [],
  `这些组件类带颜色但没有暗色规则，也没在白名单里：\n${missingDark.map((name) => `  .${name}  ${colourClasses.get(name)}`).join('\n')}`,
);
// 定点回归：上面按类名判断有两个盲区——原生 `color:` 声明（不在 COMPONENT_COLOR 里）和
// 「父类有暗色规则、子元素自身仍有浅色声明」。这三处曾因此在暗色下保持 2.63:1。
assert.match(
  text(tailwind),
  /html\[data-theme="dark"\]\s+\.notes-table-size\s+\{\s+color:\s+#767676;\s+\}/,
  '.notes-table-size 需要暗色规则',
);
assert.match(
  text(tailwind),
  /html\[data-theme="dark"\]\s+\.onboarding-bundled\s+small\s+\{\s+color:\s+#767676;\s+\}/,
  '.onboarding-bundled small 需要暗色规则',
);
assert.match(
  text(tailwind),
  /html\[data-theme="dark"\] \.onboarding-model-selection > h2,/,
  '.onboarding-model-selection > h2 需要暗色规则',
);
// 白名单不能腐化：条目必须仍然是一个带颜色的组件类，否则就是过期的豁免。
for (const name of Object.keys(DARK_AGNOSTIC)) {
  assert.ok(
    colourClasses.has(name),
    `DARK_AGNOSTIC 里的 .${name} 已不再是带颜色的组件类，应删除这条豁免`,
  );
  assert.ok(!darkClasses.has(name), `DARK_AGNOSTIC 里的 .${name} 已经有暗色规则，应删除这条豁免`);
}
assert.match(text(css), /html\[data-theme=dark\] \.secondary\{color:#eee;border-color:#eee/);
assert.doesNotMatch(
  text(css),
  /\.meeting-color|\.model-icon/,
  'the unreferenced demo classes must stay deleted',
);
assert.match(
  text(css),
  /html\[data-theme=dark\] \.processing-bar i,html\[data-theme=dark\] \.model-download-progress i\{background-color:#fff/,
);
assert.match(text(js), /document\.addEventListener\(\s*'scroll',[\s\S]{0,300}is-scrolling/);
assert.match(text(js), /setTimeout\(\(\) => scroller\.classList\.remove\('is-scrolling'\), 2000\)/);
assert.match(text(js), /meeting\.exampleLocale === locale/);
assert.match(text(js), /function selectLibraryNav/);
assert.match(text(js), /await refreshBackendMeetings\(\)/);
assert.match(text(js), /let updateAvailable = false/);
assert.match(text(js), /updateNoticeProgressBar\.style\.transform/);
assert.match(text(js), /renderUpdateNotice\(\);/);
assert.match(text(tailwind), /\.software-update-notice > i/);
assert.match(text(js), /taskCards\.append\(updateNotice\)/);
assert.match(text(js), /stackableTaskCardSelector\s+=\s+'[^']*\.software-update-notice/);
assert.match(
  text(tailwind),
  /\.task-cards > \.software-update-notice \{[^}]*@apply relative bottom-auto left-auto z-auto w-full max-w-full/,
);
assert.doesNotMatch(
  text(tailwind),
  /\.summary-model-modal\s+\.modal-body\s+\{\s+overflow:\s+visible/,
);
assert.match(text(js), /function syncSummaryFeedback/);
assert.doesNotMatch(text(components), /summary-side-actions/);
assert.match(text(i18nData), /前往 AI 会议总结/);
assert.match(text(backendClient), /async prepare\(\{ mic, system \}\)/);
assert.match(text(backendClient), /async previewMic\(\)/);
assert.match(text(backendClient), /async stopPreview\(\)/);
assert.match(text(js), /async function previewMicrophone/);
assert.doesNotMatch(text(js), /transcript\.discarded/, 'no producer left for this event');
assert.match(text(app), /refineAction\.dataset\.refineAction === 'start'/);
assert.match(text(components), /refine-wrap/);
assert.match(text(app), /closest\('\.refine-wrap, \.refine-menu/);
assert.match(
  text(backendClient),
  /await this\.capture\.prepare\(inputs\)[\s\S]*audio_tracks:[\s\S]*window\.brevia\.meeting\.start\(startPayload\)/,
);
assert.match(text(backendClient), /系统音频.*未产生音频数据/);
assert.match(text(backendClient), /this\.state\.meeting\?\.id \|\| this\.capture\?\.meetingId/);
assert.match(text(backendClient), /await this\.capture\.stop\(\)/);
assert.match(text(electronMain), /handleIpc\('permissions\.status'/);
assert.match(text(electronMain), /systemPreferences\.askForMediaAccess\('microphone'\)/);
assert.ok(packageManifest.build.mac.extendInfo.NSAudioCaptureUsageDescription);
assert.ok(packageManifest.build.mac.extendInfo.NSMicrophoneUsageDescription);
assert.match(text(electronMain), /MacCatapLoopbackAudioForScreenShare/);
assert.match(text(electronMain), /autoUpdater\.downloadUpdate\(\)/);
assert.match(text(electronMain), /autoUpdater\.quitAndInstall\(\)/);
assert.match(text(js), /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
assert.match(text(js), /window\.brevia\.permissions\.requestMicrophone\(\)/);
assert.match(text(js), /window\.brevia\?\.update\?\.check/);
assert.match(text(js), /window\.brevia\.update\.install/);
assert.match(text(electronMain), /handleIpc\('metrics\.record'/);
assert.match(text(electronMain), /error\.code === 'EPIPE'/);
assert.match(text(electronMain), /workerRequestTimeouts = new Map/);
assert.match(text(electronMain), /Worker request timed out/);
assert.match(text(app), /function userFacingError\(content\)/);
assert.match(text(app), /worker request \|operation \)timed out/);
assert.match(text(app), /t\('操作超时，请稍后重试'\)/);
assert.match(text(i18nData), /操作超时，请稍后重试/);
assert.match(text(electronMain), /clearTimeout\(pending\.timer\)/);
assert.match(
  text(electronMain),
  /'meeting\.stop', 'meeting\.pause'/,
  'stop and pause have a long, finite deadline',
);
assert.doesNotMatch(
  text(electronMain).match(/const timer = timeout && setTimeout\([\s\S]*?\}, timeout\);/)?.[0] ||
    '',
  /stopProcess/,
);
assert.match(text(backendClient), /navigator\.mediaDevices\.getDisplayMedia/);
assert.match(text(backendClient), /systemAudio: 'include'/);
assert.match(text(backendClient), /stream\.getAudioTracks\(\)\.length/);
assert.match(text(electronMain), /systemAudioSupported/);
assert.match(text(electronMain), /require\('node:os'\)/);
assert.doesNotMatch(text(electronMain), /app\.getSystemVersion/);
assert.match(text(electronMain), /createDisplayMediaHandler\(desktopCapturer, writeLog\)/);
assert.match(
  text(js),
  /window\.brevia\.on\('startup\.ready', \(\) => \{\s+const reveal = \(\) => \{/,
);
assert.match(text(js), /splashGifDurationMs = 1500/);
assert.match(text(js), /if \(!silent\) showToast\(error\.message, undefined, 'error'\)/);
assert.match(text(js), /const preferredModelsForLanguage = \(language\) =>/);
assert.match(
  text(js),
  /onboardingModelIds = checked\.filter\(\(modelId\) => !modelPaths\.has\(modelId\)\)/,
);
assert.match(text(js), /const installed = modelPaths\.has\(model\.id\);/);
assert.match(text(js), /function downloadRequiredModels/);
assert.match(text(js), /void Promise\.all\(models\.map\(downloadRequiredModel\)\)/);
assert.match(
  text(js),
  /if \(meeting\?\.model_required\) \{[\s\S]{0,260}downloadRequiredModels\(meeting\.model_required\);[\s\S]{0,180}showToast\(t\('正在下载会议所需模型，完成后会自动开始录制'\)\)/,
);
assert.match(text(i18nData), /正在下载会议所需模型，完成后会自动开始录制/);
assert.match(text(js), /function scheduleRequiredModelsCardRender/);
assert.match(
  text(js),
  /requestAnimationFrame\(\(\) => \{\s*requiredModelsRenderFrame = undefined;\s*renderRequiredModelsCard\(\);/,
);
assert.match(text(js), /const scrollTop = card\.querySelector\('ul'\)\?\.scrollTop \|\| 0;/);
assert.match(text(js), /card\.querySelector\('ul'\)\.scrollTop = scrollTop;/);
assert.equal([...text(js).matchAll(/id = 'model-download-queue'/g)].length, 1);
assert.doesNotMatch(
  text(js),
  /id = 'required-models'|data-minimize-required-models|requiredModelsCardDismissed/,
);
assert.match(
  text(js),
  /function renderRequiredModelsCard\(\) \{[\s\S]{0,240}renderModelDownloadQueue\(\);/,
);
assert.match(text(html), /id="mini-playback"/);
assert.match(text(html), /id="mini-playback-close"[^>]*aria-label="关闭播放"/);
assert.match(text(js), /function renderMiniPlayback/);
assert.match(
  text(js),
  /miniPlaybackClose\.addEventListener\('click',[\s\S]{0,180}playbackStarted = false;[\s\S]{0,100}playerAudio\.pause\(\);[\s\S]{0,100}playerAudio\.currentTime = 0;/,
);
assert.match(text(js), /miniPlayback\.addEventListener\('dblclick'/);
assert.match(text(css), /\.required-models-card li small\{[^}]*overflow-wrap:anywhere/);
assert.match(text(css), /\.task-card-close\{[^}]*width:calc\(var\(--spacing\) \* 7\)/);
assert.match(text(css), /\.mini-playback\{/);
assert.match(text(js), /function openOnboardingLanguage/);
assert.match(text(js), /type="radio" name="locale"/);
assert.match(text(js), /data-language-wheel-value/);
assert.match(text(js), /onboarding-actions"><button class="modal-action" type="submit"/);
assert.match(text(js), /onboarding-language-page/);
assert.doesNotMatch(text(js), /data-onboarding-exit/);
assert.match(text(js), /onboarding-page/);
assert.match(
  text(js),
  /if \(window\.BreviaOnboarding\.isFirstLaunch\(\)\) openOnboardingLanguage\(\);/,
);
assert.match(text(js), /data-select-storage/);
assert.match(
  text(js),
  /\+\s+storageRows\s*\+\s+`<section\s+class="onboarding-section\s+onboarding-model-selection"/,
);
assert.match(text(js), /data-change-folder/);
assert.match(text(js), /storage\.setupLocations/);
assert.match(
  text(js),
  /settingsModal\.style\.zIndex = '60'/,
  'settings dialogs must stay above the onboarding overlay',
);
assert.match(
  text(js),
  /if\s+\(initializationPromise\)\s+await\s+initializationPromise;[\s\S]{0,160}openOnboardingPermissions\(\);\s+return;/,
);
assert.match(text(js), /window\.brevia\.on\(\s*'app\.maintenance'/);
assert.match(text(js), /void window\.brevia\.maintain\(\)/);
assert.match(text(js), /data-cleanup-storage/);
assert.match(text(js), /void loadSummaryConfig\(\)\.catch/);
assert.match(text(js), /updateOnboardingLanguageCopy/);
assert.match(text(js), /function openOnboardingSetup/);
assert.doesNotMatch(text(js), /name="onboarding-performance-mode"/);
assert.doesNotMatch(text(js), /'zipformer-ctc-zh-streaming-int8'/);
assert.match(
  text(js),
  /className = 'onboarding-page onboarding-active onboarding-language-overlay'/,
);
assert.match(text(js), /onboarding-page onboarding-active onboarding-\$\{kind\}-overlay/);
assert.doesNotMatch(text(js), /onboarding-page onboarding-active onboarding-\$\{kind\}-page/);
assert.doesNotMatch(text(js), /document\.body\.classList\.(?:add|remove)\('onboarding-active'\)/);
assert.match(
  text(css),
  /\.onboarding-page\.onboarding-active\{[^}]*position:fixed[^}]*overflow-y:auto/,
);
assert.match(text(css), /\.onboarding-page:before\{[^}]*-webkit-app-region:drag/);
assert.match(text(css), /body:has\(\.onboarding-page\) \.app-shell\{display:none/);
assert.doesNotMatch(text(css), /\*\{scrollbar-gutter:stable/);
// 首启选型去掉评分，保留角标与真实选择守卫。
assert.doesNotMatch(text(js), /function asrMeter\(/);
assert.doesNotMatch(text(js), /openOnboardingTour|updateOnboardingTour|function tourView/);
assert.match(text(js), /asr-badge/);
assert.match(text(js), /data-onboarding-guard/);
assert.match(text(js), /function onboardingRecommendedModelId\(/);
assert.doesNotMatch(text(css), /\.asr-scale/);
assert.match(text(css), /\.asr-badge\.is-recommended/);
assert.match(text(css), /\.onboarding-bundled\{/);
// 准备页始终直接显示模型；展开选项按最长模型名保持单行。
assert.match(text(js), /function prepareModelControl\(/);
assert.match(text(js), /class="prepare-model-select"/);
assert.doesNotMatch(text(js), /data-expand-prepare-model/);
assert.match(text(css), /\.prepare-model-select \.flow-select-options\{/);
assert.match(
  text(css),
  /#prepare-view \.flow-select-toggle,#prepare-view \.flow-select-options button\{[^}]*white-space:nowrap/,
);
assert.match(text(css), /#prepare-view \.flow-select-toggle\{[^}]*text-overflow:ellipsis/);
// 偏好只在用户主动改选时写入；系统回退不写。
assert.match(text(js), /function rememberPreferredModel\(/);
assert.match(text(js), /function preferredModelForLanguage\(/);
assert.match(text(js), /data-onboarding-estimate/);
assert.doesNotMatch(text(js), /onboardingModelSelectionCopy/);
assert.match(text(js), /onboarding-model-grid/);
assert.match(text(js), /onboarding-folder-section\" open/);
assert.match(text(js), /src="\.\/assets\/brevia-logo\.svg"/);
assert.match(
  text(i18nData),
  /title: '选择语音识别模型'/,
  'the setup page copy lives in i18n-data.js',
);
assert.doesNotMatch(text(js), /name="onboarding-language"/);
assert.match(text(js), /modelSize\(modelId\)/);
assert.match(text(js), /class="onboarding-model-card\$\{isRecommended/);
assert.match(text(css), /\.onboarding-model-card\{/);
assert.match(
  text(css),
  /\.onboarding-setup-page header\{[^}]*justify-items:start[^}]*text-align:left/,
);
assert.match(text(js), /manifestDefaultRefinedModelId\(language\)/);
assert.doesNotMatch(text(js), /name="onboarding-model-preference"/);
assert.doesNotMatch(text(css), /\.onboarding-preference-option\{/);
assert.ok(localeContext.window.BreviaLocaleData.catalog.en.labels['准备精修']);
assert.match(text(js), /data-onboarding-back-language/);
assert.match(text(js), /function openOnboardingPermissions/);
assert.match(text(js), /data-request-onboarding-permission/);
assert.match(text(js), /onboarding-permission-action/);
assert.match(text(js), /onboarding-permission\$\{granted \? ' is-granted'/);
assert.match(text(js), /data-onboarding-mic-level/);
assert.match(text(js), /breviaClient\?\.previewMic\(\)/);
assert.match(text(js), /const granted = permissionGranted\(permission\);/);
assert.match(text(js), /data-open-screen-settings/);
assert.match(text(css), /\.onboarding-permission-title\{[^}]*align-items:center/);
assert.match(text(css), /\.onboarding-mic-meter\{[^}]*width:calc\(var\(--spacing\) \* 32\)/);
assert.match(text(js), /const permissionPoll = window\.setInterval/);
assert.match(text(js), /window\.clearInterval\(permissionPoll\)/);
assert.match(text(js), /const\s+placeholders\s+=\s+steps\s*\.map[\s\S]*?aria-busy="true"/);
assert.match(text(js), /function openOnboardingLanguage[\s\S]*?openOnboardingPermissions\(\);/);
assert.match(text(js), /data-storage-path/);
assert.match(
  text(js),
  /dismissOnboardingPage\(\(\) => \{\s*onboardingPreviewLocale = undefined;\s*applyLanguage\(nextLocale, true\);\s*openOnboardingPermissions\(\);/,
);
assert.match(text(js), /data-skip-onboarding-permissions/);
assert.match(text(js), /dismissOnboardingPage\(openOnboardingSetup\)/);
assert.doesNotMatch(text(js), /function openOnboardingWelcome/);
assert.match(text(js), /const page = onboardingPage/);
assert.match(text(js), /page\.querySelector\('\[name="locale"\]:checked'\)\.value/);
assert.match(text(js), /finally \{\s*nodes\.forEach/);
for (const selector of [
  '.settings-grid',
  '.meeting-list',
  '#meeting-form .form-grid',
  '.final-transcript',
  '.notes',
  '#model-download-queue',
]) {
  assert.match(text(js), new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(text(js), /rerendered\.push\(\s*batchToolbar,\s+updateNotice/);
assert.doesNotMatch(text(html), /原始录音与每版逐字稿均保存在本机/);
assert.doesNotMatch(text(i18nData), /原始录音与每版逐字稿均保存在本机/);
assert.doesNotMatch(text(js), /function openOnboardingMeetingLanguages/);
assert.doesNotMatch(text(js), /function openOnboardingModels/);
assert.match(text(js), /data-download-onboarding-models/);
// 模型库里的勾选行（data-onboarding-model-selection / data-download-onboarding-selected）
// 与它们读写的 onboardingModelSelection 已随「自定义下载」入口一起删除，不得回归。
assert.doesNotMatch(
  text(js),
  /data-onboarding-model-selection/,
  'the removed library checkbox must not come back',
);
// 首启选型：默认只勾选推荐模型，且任何模型都能取消勾选（已安装的也一样，不得 disabled）。
assert.match(text(js), /\$\{isRecommended \? ' checked' : ''\} \/>/);
assert.doesNotMatch(
  text(js),
  /name="onboarding-model"[\s\S]{0,200}?disabled/,
  'no recognition model may be disabled in the onboarding picker',
);
assert.doesNotMatch(text(js), /modelPaths\.has\(modelIds\[sourceIndex\]\) \? '✓'/);
// 守卫问的是「能不能出字幕」：已装在本地但未勾选的模型照样能出字幕，所以要放行，
// 否则全装过的用户会被「无法生成字幕」堵住。
assert.match(text(js), /const missing = checked\.length === 0 && !anyInstalled;/);
assert.match(text(js), /if \(download && !onboardingModelReady\) return;/);
assert.doesNotMatch(
  text(js),
  /data-download-onboarding-selected/,
  'the removed library download button must not come back',
);
assert.match(text(js), /onboardingModelIds = checked/);
assert.match(text(js), /showOfflineTranscriptionReady/);
// 会议开始时可按语言挑选识别模型，并能在实时页热切换。
assert.match(text(js), /modelSelection\.refinedModelsForLanguage/, '语言过滤必须在模块里');
assert.match(text(js), /modelSelection\.defaultRefinedModelId/, '默认模型选择必须在模块里');
// 逐句字幕保存必须用与展示同一份段落集合，否则「精修模型退役」的会议里
// 展示的是实时段落、保存查的是精修段落，草稿会整体对不上并被静默丢弃。
assert.match(
  text(js),
  /latestTranscriptSegments\(meeting\)/,
  '展示和保存必须使用同一份后端选定的逐字稿',
);
assert.match(text(js), /flowSelect\('refined-model', refinedModel, modelOptions\)/);
assert.match(
  text(js),
  /const modelLabel = prepareModelControl\(language, refinedModel, modelOptions\);/,
);
// 识别模型的「推荐」角标直接标在下拉选项上，不再在「会议语言」下面写一段解释文字。
assert.match(text(js), /recommendedWord: \(asrCopy\.recommended/, '角标文案仍来自 8 语言文案表');
assert.match(ms, /model\.id === recommendedId \? recommendedWord : ''/, '角标口径在模块里');
assert.match(text(components), /flow-select-badge/);
assert.match(text(components), /const\s+badge\s*=\s*\(option\)\s*=>\s*\(?option\?\.\[2\]/);
assert.match(text(components), /data-label="\$\{escapeHtml\(option\[1\]\)\}"/);
assert.match(text(components), /\$\{escapeHtml\(option\[1\]\)\}\$\{badge\(option\)\}/);
assert.doesNotMatch(text(components), /\$\{badge\(selected\)\}/);
assert.doesNotMatch(
  text(js),
  /prepare-language-hint/,
  'the prepare page must not explain the auto-match in prose',
);
assert.doesNotMatch(
  text(asrCopy),
  /languageHint/,
  'prepare.languageHint is replaced by the option badge',
);
assert.doesNotMatch(text(css), /\.prepare-language-hint\{/);
assert.match(text(css), /\.flow-select-badge\{/);
assert.match(
  text(js),
  /function applyInitializationResult\(result\)[\s\S]*?renderMeetingList\(\);\s*renderPrepareSelects\(\);/,
);
assert.doesNotMatch(
  text(js),
  /function modelSupportsLanguage/,
  '语言支持判断不得在 app.js 里重复实现',
);
assert.match(text(js), /modelSelection\.modelSupportsLanguage/);
assert.match(text(js), /function renderLiveModelControl\(\)/);
assert.match(text(js), /data-live-model="\$\{escapeHtml\(id\)\}"/);
assert.match(text(html), /id="live-model-menu" hidden/);
// 性能/效率模式及其瓶颈弹窗已下线：界面上不应再出现模式开关。
assert.doesNotMatch(
  text(js),
  /getPerformanceMode|setPerformanceMode|PERFORMANCE_MODE_KEY|openPerformanceBottleneckDialog|applyLiveEfficiency/,
);
assert.doesNotMatch(text(js), /liveConfig = \{[^}]*power_saving/);
assert.match(
  text(js),
  /liveConfig = \{ language: 'auto', target_language: null, refined_model_id: null \};/,
);
assert.doesNotMatch(text(js), /name="performance-mode"/);
assert.match(text(js), /正在下载模型，完成后会自动切换/);
assert.doesNotThrow(() => new Function(text(js)));
assert.doesNotMatch(text(electronMain), /showMessageBox/);
assert.match(text(electronMain), /permissions\.open-screen-settings/);
assert.match(text(electronMain), /permissions\.open-microphone-settings/);
assert.match(text(electronMain), /Privacy_ScreenCapture/);
assert.match(text(electronMain), /Privacy_Microphone/);
assert.match(text(electronMain), /spawn\(\s*'open',\s+\[\s*'x-apple\.systempreferences/);
assert.doesNotMatch(text(electronMain), /useSystemPicker/);
assert.match(text(electronMain), /requestSingleInstanceLock/);
assert.match(text(electronMain), /async function stopActiveMeeting\(\)/);
assert.match(text(electronMain), /worker\.request\('meeting\.stop'/);
assert.match(text(electronMain), /event\.preventDefault\(\)/);
assert.match(text(electronMain), /meeting\.export-many/);
assert.match(text(js), /const button = event\.currentTarget/);
assert.doesNotMatch(
  text(js),
  /await breviaClient\.pause\(!paused\)[\s\S]{0,200}event\.currentTarget/,
);
assert.doesNotMatch(
  text(app),
  /document\.querySelector\('#end-meeting'\)[\s\S]{0,800}meeting\.refine/,
);
assert.match(
  text(app),
  /const buttonLabel = button\.innerHTML;[\s\S]{0,300}button\.innerHTML = `<i class="button-spinner" aria-hidden="true"><\/i>\$\{t\('结束中'\)\}`/,
);
assert.match(text(app), /data-refine-num-speakers/);
assert.match(text(app), /const startRefinement[\s\S]*?requestRefinement/);
assert.match(text(app), /num_speakers: numSpeakers/);
assert.match(text(components), /refine-menu-speakers[\s\S]{0,200}data-refine-num-speakers/);
assert.match(text(app), /function refineNumSpeakers/);
assert.match(
  text(app),
  /async function translateLatestTranscript\(targetLanguage, meeting = currentMeetingDetail\)/,
);
assert.match(text(components), /data-detail-translation/);
assert.match(
  text(components),
  /data-detail-translation-toggle[^]*interfaceIcon\('translate'\)/,
  'translation uses the shared accessible icon and action',
);
assert.doesNotMatch(
  text(components),
  /data-refine-translation/,
  'refinement options never select a translation target',
);
assert.doesNotMatch(
  text(components),
  /detail-translation-menu flow-select-options/,
  'translation menu stays out of the generic select handler',
);
assert.match(
  text(app),
  /querySelectorAll\('\.detail-translation-menu'\)[\s\S]{0,160}aria-expanded/,
  'opening refinement closes translation',
);
assert.match(
  text(app),
  /function showTranslationProgress\(completed, total, targetLanguage\)/,
  'subtitle translation exposes task-card progress',
);
assert.match(
  text(app),
  /if \(!meeting\) return;\s*breviaClient\.state\.selectedMeetingId = meeting\.id;[\s\S]{0,300}startRefinement\(\);/,
);
assert.doesNotMatch(
  text(app),
  /refine\(\{[\s\S]{0,200}?refined_model_id/,
  'the refinement model is chosen once, on the backend',
);
assert.match(text(js), /let followLiveTranscript = true/);
assert.match(
  text(js),
  /meetingActive = true;\s*seconds = 0;\s*const pauseButton = document\.querySelector\('#pause'\);\s*pauseButton\.dataset\.paused = 'false';\s*renderPauseButton\(\);/,
);
assert.doesNotMatch(
  text(js),
  /segment\.offsetTop - \(transcript\.clientHeight - segment\.offsetHeight\) \/ 2/,
);
assert.match(text(js), /liveSegments\.set\(payload\.segment_id, element\)/);
assert.match(text(js), /const maxLiveSegments = 500/);
assert.match(text(js), /while \(liveSegments\.size > maxLiveSegments\)/);
assert.match(
  text(js),
  /liveConfig\s+=\s+\{\s+language:\s+language\s+\|\|\s+'auto',\s+target_language:\s+payload\.target_language\s+\|\|\s+null,\s+refined_model_id:\s+meeting\?\.refined_model_id\s+\|\|\s+payload\.refined_model_id\s+\|\|\s+null,?\s*\}/,
);
assert.match(
  text(js),
  /await window\.brevia\.meeting\.reconfigure\(\{ meeting_id: meetingId, \.\.\.changes \}\)/,
);
assert.doesNotMatch(text(js), /function setLivePowerSaving\(enabled\)/);
assert.match(text(js), /const MAX_NOTES_CHARS = 5 \* 1024 \* 1024/);
assert.doesNotMatch(text(js), /function checkPowerSavingSuggestion\(\)/);
assert.ok(localeContext.window.BreviaLocaleData.catalog.zh.labels['error.summary.empty_response']);
assert.doesNotMatch(text(js), /paraformer-zh-en-int8/);
assert.doesNotMatch(text(uiData), /Streaming Paraformer/);
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  const labels = localeContext.window.BreviaLocaleData.catalog[code].labels;
  assert.ok(labels['纪要生成失败：模型未返回有效内容，请稍后重试。']);
  if (code !== 'zh') {
    assert.notEqual(
      labels['纪要生成失败：模型未返回有效内容，请稍后重试。'],
      '纪要生成失败：模型未返回有效内容，请稍后重试。',
    );
  }
  // 效率模式下线后，它那一整块文案（含这句随它一起塞进去的错误提示）都必须消失。
  assert.equal(labels['纪要服务暂时不可用，请检查网络或稍后重试。'], undefined);
  assert.equal(labels['会议模式'], undefined);
}
// 识别链路不可用必须是**常驻卡片**，不能压成一条一闪而过的 toast：那一场会议全程不会有
// 字幕，用户需要当场就知道「录音还在、会后能出稿」。
assert.match(text(js), /code === 'asr_unavailable'/);
assert.match(text(js), /function showLiveCaptionUnavailable\(/);
assert.match(
  text(js),
  /class = 'processing-card live-transcription-unavailable'|className = 'processing-card live-transcription-unavailable'/,
);
assert.match(text(js), /aria-live', 'polite'\)/);
assert.match(text(js), /function dismissLiveCaptionUnavailable\(/);
assert.match(
  text(js),
  /dismissLiveCaptionUnavailable\(meeting\?\.id \|\| payload\?\.id/,
  'a new live meeting must clear the previous card',
);
// 卡片归属必须按会议 id 判定：警告在 meeting.start 返回**之前**发出，而 activateMeeting 在其之后，
// 无条件撤下会把刚建好的提示立刻抹掉。
assert.match(text(js), /card\.dataset\.meetingId = meetingId \|\| ''/);
assert.match(text(js), /if \(meetingId && card\.dataset\.meetingId === meetingId\) return;/);
assert.doesNotMatch(
  text(js),
  /worker\.warning', \(\{ message: warning \}\) => showToast\(warning\)\)/,
  'the blanket toast must be replaced by the code-based branch',
);
// 卡片面向用户的文案不得包含内部模型 id：原始错误只作为悬停诊断（card.title）。
assert.match(text(js), /card\.title = detail \|\| ''/);
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  const labels = localeContext.window.BreviaLocaleData.catalog[code].labels;
  assert.ok(
    labels['本次会议无法生成实时字幕'],
    `${code} needs the live-transcription-unavailable title`,
  );
  assert.ok(
    labels['识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。'],
    `${code} needs the body copy`,
  );
}
assert.doesNotMatch(text(js), /setTrackEnabled\(/);
assert.doesNotMatch(text(js), /uiData\.live\.status/);
assert.match(text(js), /segment\.classList\.remove\('is-active'\)/);
assert.match(text(js), /示例会议及录音已删除/);
assert.match(text(js), /function syncPlaybackTranscript/);
assert.match(text(js), /function syncPlaybackFloatingCaption/);
assert.match(text(js), /translation: segment\?\.translation \|\| null/);
assert.match(text(js), /function renderPlaybackFloatingCaptionToggle\(\)/);
assert.match(
  text(html),
  /class="detail-actions"[\s\S]*data-export-detail[\s\S]*class="detail-head"/,
);
assert.doesNotMatch(text(html), /data-share-detail/);
assert.match(
  text(js),
  /if \(floatingCaptionMode === 'playback'\) \{[\s\S]{0,300}floatingCaption\?\.close/,
);
assert.match(text(floatingCaption), /function renderCaptionText\(text, streaming\)/);
assert.match(text(floatingCaption), /text\.startsWith\(renderedCaptionText\)/);
assert.match(text(floatingCaption), /captionText\.append\(document\.createTextNode/);
assert.match(text(floatingCaption), /if \(!showingTranslationLoading\)/);
assert.doesNotMatch(text(floatingCaption), /caption-increment|caption-swap/);
assert.match(
  text(floatingCaption),
  /captionTranslation\.previousElementSibling !== captionFinalized/,
);
assert.match(text(floatingCaption), /function renderFinalizedText\(text\)/);
assert.match(text(floatingCaption), /if \(autoScrolling\) return/);
assert.match(
  text(floatingCaption),
  /if \(!state\.lastFinalized\.text && !state\.current\.text\) followLiveCaption = true;/,
);
assert.match(text(floatingCaption), /captionContainer\.scrollTop = captionContainer\.scrollHeight/);
assert.match(text(floatingCaptionHtml), /\.caption-shell \{[^}]*display: flex;[^}]*height: 100vh;/);
assert.match(text(floatingCaptionHtml), /max-height: none;[\s\S]*overflow-y: auto;/);
assert.match(
  text(floatingCaptionHtml),
  /\.caption-controls \{[\s\S]*z-index: 1;[\s\S]*opacity: 1;/,
);
assert.match(
  text(floatingCaptionHtml),
  /class="caption-shell">[\s\S]*class="caption-controls"[\s\S]*class="caption-container"/,
);
assert.match(text(floatingCaptionHtml), /@keyframes caption-fade \{\s*from \{ opacity: 0\.65; \}/);
assert.match(text(electronMain), /translationPending: z\.boolean\(\)\.optional\(\)/);
assert.match(text(electronMain), /worker\.restarts = 0;\s*resetFloatingCaptionState\(\);/);
assert.match(text(electronMain), /pendingTranslation\.segmentId === value\.segmentId/);
assert.match(text(electronMain), /translationPending: floatingCaptionState\.translationPending/);
assert.match(text(js), /function showRefinementProgress/);
assert.match(text(js), /function refinementTitle\(meetingId\)/);
assert.match(text(js), /refinementTitle\(meeting_id\), meeting_id, stage/);
assert.match(text(js), /target\.textContent = refinementMeetingTitle/);

assert.equal(localeContext.window.BreviaLocaleData.catalog.en.labels['转写中'], 'Transcribing');

assert.match(text(js), /segment\.version\.startsWith\('postprocess'\)/);
assert.match(
  text(meetingDetail),
  /playback\?\.mix\s+\|\|\s*\(?meeting\?\.audio\?\.playback\?\.mic/,
);
assert.match(text(js), /segment\.is-active/);
assert.match(text(js), /body\.scrollTo/);
assert.match(text(i18nData), /Aún no se ha generado el resumen/);
assert.match(text(i18nData), /Speaker diarization/);
// 更新日志的版本簿记是手动维护的（RELEASING.md §1）：只允许一条 current，且它必须是
// 列表第一条（版本从新到旧），否则应用内「更新日志」会把上一版标成当前版本。
runInNewContext(text(await readFile('changelog.js')), localeContext);
assert.equal(localeContext.window.BreviaLocaleData.whatsNewLog, undefined);
assert.match(text(html), /changelog\.js[\s\S]*app\.js/);
const releaseEntries = localeContext.window.BreviaChangelog;
assert.equal(releaseEntries.filter((entry) => entry.current).length, 1);
assert.equal(releaseEntries[0].current, true);
assert.match(releaseEntries[0].version, /^\d+\.\d+\.\d+$/);
assert.match(releaseEntries[0].date, /^\d{4}-\d{2}-\d{2}$/);

for (const copy of [
  'ローカル会議',
  '로컬 회의',
  'Réunion locale',
  'Lokale Besprechung',
  'Локальная встреча',
])
  assert.match(text(i18nData), new RegExp(copy));
assert.doesNotMatch(text(css), /\.status\.complete:before/);
assert.match(text(css), /\.page-head>div\{[^}]*min-width:0/);
assert.doesNotMatch(text(js), /renderModelRow/);
assert.match(text(components), /id="installed-models"[\s\S]*data-settings-modal="models"/);
assert.match(text(components), /class="transcript-body"/);
assert.match(text(components), /data-start=/);
assert.match(text(components), /data-segment-id=/);
// 详情页精修稿只带顶层 segmentId（speaker.segmentId 在精修稿里是 undefined），
// 右键注册声纹依赖 article 上的 data-segment-id，必须保留这个兜底。
assert.match(text(components), /segmentId \|\| speaker\.segmentId/);
assert.match(text(components), /class="segment-copy"/);
assert.match(text(js), /segmentContextMenu/);
assert.match(text(js), /addProfileSample/);
assert.match(text(js), /data-create-segment-profile/);
assert.match(text(i18nData), /Create voiceprint/);
assert.match(text(css), /\.final-transcript\{[^}]*overflow:hidden/);
assert.match(text(css), /#prepare-view\.active\{[^}]*height:calc\(100dvh - 3rem\)/);
assert.match(text(css), /#detail-view\.active\{[^}]*height:calc\(100dvh - 3rem\)/);
assert.doesNotMatch(text(tailwind), /\.dual-track-panel|\.track-player|\.dual-track-empty/);
assert.doesNotMatch(
  text(css),
  /\.refined-transcript-empty/,
  'the unreferenced empty-state class must stay deleted',
);
assert.match(text(css), /scrollbar-gutter:stable/);
assert.match(text(css), /\.transcript-scroll\{[^}]*min-height:0[^}]*flex:1/);
assert.match(text(css), /::-webkit-scrollbar-thumb/);
assert.match(text(css), /\.sidebar\{[^}]*position:sticky/);
assert.match(text(css), /\.input-meter/);
assert.match(text(css), /\.selection-marquee\{/);
assert.match(text(css), /\.meeting-row\.is-selected\{/);
assert.match(text(html), /ui-data\.js[\s\S]*ui-components\.js[\s\S]*app\.js/);
// 纪要模态框的真实渲染产物：字段可见性、内置模型清单、凭据回填、转义和八语言标签。
const summaryAppSource = text(app);
const summaryFn = (name) => {
  const start = summaryAppSource.indexOf(`function ${name}(`);
  return summaryAppSource.slice(start, summaryAppSource.indexOf('\n}\n', start) + 2);
};
const summaryConst = (decl, multiline = false) => {
  const start = summaryAppSource.indexOf(decl);
  return multiline
    ? summaryAppSource.slice(start, summaryAppSource.indexOf('\n};', start) + 3)
    : summaryAppSource.slice(start, summaryAppSource.indexOf(';', start) + 1);
};
const changelogContext = {
  locale: 'zh',
  whatsNewCopy: localeContext.window.BreviaLocaleData.appCopy.whatsNewCopy,
  escapeHtml: (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  whatsNewLog: [
    {
      version: '1.2.2',
      date: '2026-10-02',
      current: true,
      previousVersion: '1.2.1',
      zh: { summary: '中文摘要', what: [{ text: '<新增>', commit: '4b1f51e' }] },
      en: { summary: 'English summary', what: [{ text: 'New feature', commit: '4b1f51e' }] },
      contributors: [{ login: 'Sousukes', pr: 4 }],
    },
    { version: '1.2.1', en: { fixed: ['Legacy entry'] } },
  ],
};
const refinementProgressContext = {
  refinementCard: { dataset: {}, querySelector: () => ({ textContent: '' }) },
  refinementPercent: { textContent: '' },
  renderTaskProgressLabel: componentContext.renderTaskProgressLabel,
  refinementBar: { style: {} },
  refinementMeetingTitle: '',
  refinementCardDismissed: false,
  refinementDismissTimer: null,
  clearTimeout() {},
  t: (label) => label,
  revealTaskCard() {},
  syncTaskCardStack() {},
  setTaskCardTask(card, _task, meetingId) {
    card.dataset.meetingId = meetingId;
  },
};
runInNewContext(summaryFn('showRefinementProgress'), refinementProgressContext);
refinementProgressContext.showRefinementProgress(0, 0, 'Meeting', 'one', '准备精修');
let lastRefinementRatio = 0;
for (const percent of [10, 40, 20, 95, 100]) {
  refinementProgressContext.showRefinementProgress(
    percent,
    100,
    'Meeting',
    undefined,
    '分析说话人',
  );
  const ratio = Number(refinementProgressContext.refinementCard.dataset.completed) / 100;
  assert.ok(
    ratio >= lastRefinementRatio && ratio < 1,
    'progress never goes backwards or finishes before refinement.ready',
  );
  lastRefinementRatio = ratio;
}
assert.match(refinementProgressContext.refinementPercent.innerHTML, /Meeting/);
assert.match(refinementProgressContext.refinementPercent.innerHTML, /99%/);
refinementProgressContext.showRefinementProgress(0, 0, 'Next', 'two', '准备精修');
assert.equal(
  refinementProgressContext.refinementBar.style.transform,
  'scaleX(0)',
  'a new refinement resets progress',
);
const refinementHandlers = {},
  refinementActions = [];
const refinementEventsContext = {
  window: {
    brevia: {
      on: (type, handler) => {
        refinementHandlers[type] = handler;
      },
      meeting: { get: async ({ meeting_id }) => ({ id: meeting_id }) },
    },
  },
  refinementCard: { dataset: { meetingId: 'current' } },
  refinementMeetingTitle: '',
  breviaClient: { state: { selectedMeetingId: 'none' } },
  showRefinementProgress() {
    refinementActions.push('progress');
  },
  hideRefinementProgress() {
    refinementActions.push('cancel');
  },
  showRefinementComplete() {
    refinementActions.push('ready');
  },
  syncBackendMeeting() {},
  refreshBackendMeetings() {},
};
runInNewContext(
  summaryAppSource.slice(
    summaryAppSource.indexOf("  window.brevia.on('refinement.progress'"),
    summaryAppSource.indexOf("  window.brevia.on('summary.started'"),
  ),
  refinementEventsContext,
);
for (const type of ['progress', 'cancelled', 'ready'])
  await refinementHandlers[`refinement.${type}`]({ meeting_id: 'old' });
assert.deepEqual(
  refinementActions,
  [],
  'late events from another meeting cannot change the progress card',
);
for (const type of ['progress', 'cancelled', 'ready'])
  await refinementHandlers[`refinement.${type}`]({ meeting_id: 'current' });
assert.deepEqual(
  refinementActions,
  ['progress', 'cancel', 'ready'],
  'the current meeting still updates and completes',
);
runInNewContext(summaryFn('renderWhatsNewList'), changelogContext);
for (const code of ['zh', 'en']) {
  changelogContext.locale = code;
  const rendered = changelogContext.renderWhatsNewList();
  assert.ok(rendered.includes(code === 'zh' ? '中文摘要' : 'English summary'));
  assert.ok(rendered.includes(`/commit/4b1f51e`));
  assert.ok(rendered.includes('/compare/v1.2.1...v1.2.2'));
  assert.ok(rendered.includes(changelogContext.whatsNewCopy[code].contributors));
  assert.ok(rendered.includes('https://github.com/Sousukes'));
  assert.ok(rendered.includes('/pull/4'));
  assert.match(rendered, /<details class="whatsnew-entry" data-modal-detail="[^"]+"><summary>/);
  assert.ok(rendered.includes('Legacy entry'));
  assert.ok(!rendered.includes('<新增>'));
}
// 逐段保存只有真实成功后退出；失败、缺桥接和空内容保留同一份草稿。
const transcriptToasts = [],
  transcriptWrites = [];
const transcriptMeeting = {
  id: 'meeting',
  segments: [
    { id: 'one', text: 'Original' },
    { id: 'two', text: 'Other' },
  ],
};
const transcriptContext = {
  currentMeetingDetail: transcriptMeeting,
  uiData: {
    detail: {
      transcriptEditing: true,
      transcriptDraft: { one: 'Updated' },
      transcriptSaveState: 'dirty',
    },
  },
  latestTranscriptSegments: (meeting) => ({ segments: meeting.segments }),
  t: (value) => value,
  CSS: { escape: (value) => value },
  document: { querySelector: () => ({ focus() {} }) },
  renderMeetingDetail() {},
  applyBackendDetail(meeting) {
    transcriptContext.currentMeetingDetail = meeting;
  },
  showToast: (message) => transcriptToasts.push(message),
  window: {
    brevia: {
      segment: {
        saveText: async (data) => {
          transcriptWrites.push(data);
          return transcriptMeeting;
        },
      },
    },
  },
};
runInNewContext('async ' + summaryFn('saveDetailTranscriptEdits'), transcriptContext);
await transcriptContext.saveDetailTranscriptEdits();
assert.equal(transcriptContext.uiData.detail.transcriptEditing, false);
assert.equal(transcriptWrites.length, 1);
assert.equal(
  JSON.stringify(transcriptWrites[0].segments),
  JSON.stringify([{ segment_id: 'one', text: 'Updated' }]),
);
let resolveTranscript;
transcriptContext.uiData.detail = {
  transcriptEditing: true,
  transcriptDraft: { one: 'Keep me' },
  transcriptSaveState: 'dirty',
};
transcriptContext.window.brevia.segment.saveText = () =>
  new Promise((resolve) => {
    resolveTranscript = resolve;
  });
const transcriptPending = transcriptContext.saveDetailTranscriptEdits();
assert.equal(transcriptContext.uiData.detail.transcriptEditing, true);
assert.equal(transcriptContext.uiData.detail.transcriptSaveState, 'saving');
assert.equal(transcriptContext.uiData.detail.transcriptDraft.one, 'Keep me');
await transcriptContext.saveDetailTranscriptEdits();
resolveTranscript(undefined);
await transcriptPending;
assert.equal(transcriptContext.uiData.detail.transcriptSaveState, 'failed');
assert.equal(transcriptContext.uiData.detail.transcriptDraft.one, 'Keep me');
transcriptContext.window.brevia = undefined;
await transcriptContext.saveDetailTranscriptEdits();
assert.equal(transcriptContext.uiData.detail.transcriptEditing, true);
assert.equal(transcriptContext.uiData.detail.transcriptDraft.one, 'Keep me');
transcriptContext.uiData.detail.transcriptDraft.one = '   ';
await transcriptContext.saveDetailTranscriptEdits();
assert.equal(transcriptContext.uiData.detail.transcriptErrors.one, '字幕内容不能为空');
transcriptContext.uiData.detail.transcriptDraft = { stale: 'Retain stale revision text' };
await transcriptContext.saveDetailTranscriptEdits();
assert.equal(transcriptContext.uiData.detail.transcriptSaveState, 'failed');
assert.equal(transcriptContext.uiData.detail.transcriptDraft.stale, 'Retain stale revision text');
transcriptContext.uiData.detail.transcriptDraft = { one: 'Original' };
await transcriptContext.saveDetailTranscriptEdits();
assert.equal(
  transcriptContext.uiData.detail.transcriptEditing,
  false,
  'unchanged save does not require the bridge',
);
// 升级浮窗复用完整日志，只展开实际安装版本，缺少该版本时不可冒充最新版本。
runInNewContext(summaryFn('compareVersions'), changelogContext);
assert.ok(changelogContext.renderWhatsNewList('1.2.1').includes('is-current'));
assert.ok(!changelogContext.renderWhatsNewList('1.2.1').includes('v1.2.2'));
assert.ok(
  changelogContext.renderWhatsNewList('9.0.0').includes(changelogContext.whatsNewCopy.en.empty),
);
changelogContext.locale = 'fr';
assert.ok(changelogContext.renderWhatsNewList('1.2.2').includes('English summary'));
const upgradeOpens = [],
  upgradeTimers = [];
let seenVersion = null;
const upgradeContext = {
  installedAppVersion: '1.3.1',
  whatsNewRetryTimer: undefined,
  whatsNewReady: true,
  whatsNewShown: false,
  onboardingPage: undefined,
  activeModal: undefined,
  meetingActive: false,
  pageTransition: false,
  localStorage: {
    getItem: () => seenVersion,
    setItem: (_, version) => {
      seenVersion = version;
    },
  },
  document: { querySelector: () => null },
  clearTimeout() {},
  setTimeout: (action) => {
    upgradeTimers.push(action);
    return 1;
  },
  openModal: (kind) => upgradeOpens.push(kind),
};
runInNewContext(summaryFn('compareVersions'), upgradeContext);
runInNewContext(summaryFn('maybeShowWhatsNew'), upgradeContext);
runInNewContext(summaryFn('markWhatsNewSeen'), upgradeContext);
upgradeContext.maybeShowWhatsNew();
assert.equal(seenVersion, '1.3.1');
assert.equal(upgradeOpens.length, 0, 'first install only records the version');
for (const version of ['1.3.1', '2.0.0']) {
  seenVersion = version;
  upgradeContext.maybeShowWhatsNew();
  assert.equal(upgradeOpens.length, 0, 'same version and downgrade do not show a popup');
}
seenVersion = '1.2.0';
for (const blocker of [
  'whatsNewReady',
  'onboardingPage',
  'activeModal',
  'meetingActive',
  'pageTransition',
]) {
  const original = upgradeContext[blocker];
  upgradeContext[blocker] = blocker === 'whatsNewReady' ? false : true;
  upgradeContext.maybeShowWhatsNew();
  assert.equal(upgradeOpens.length, 0, 'upgrade must wait for ' + blocker);
  upgradeContext[blocker] = original;
}
upgradeContext.maybeShowWhatsNew();
upgradeContext.maybeShowWhatsNew();
for (const retry of upgradeTimers) retry();
assert.deepEqual(
  upgradeOpens,
  ['upgrade-log'],
  'one popup per session even after repeated retries',
);
upgradeContext.markWhatsNewSeen();
assert.equal(seenVersion, '1.3.1');
upgradeContext.whatsNewShown = false;
upgradeContext.maybeShowWhatsNew();
assert.equal(upgradeOpens.length, 1, 'read flag prevents reopening next session');
upgradeContext.localStorage.getItem = () => {
  throw new Error('storage unavailable');
};
upgradeContext.whatsNewShown = false;
upgradeContext.maybeShowWhatsNew();
assert.equal(upgradeContext.whatsNewShown, true, 'storage errors never loop or block startup');
// 模型库每个模型的长描述必须覆盖全部 8 种界面语言，统一从 i18n-data.js 读取，
// 缺语种会静默回退英文（es 曾长期只有 zh/en）。
const modelLibraryBackground = localeContext.window.BreviaLocaleData.appCopy.modelLibraryBackground;
const modelLibraryDescriptionIds = [
  'eres2net-base-3dspeaker-zh',
  'funasr-nano-int8',
  'hy-mt2-1.8b-q4km',
  'pyannote-segmentation-3.0',
  'qwen3-asr-0.6b-int8',
  'silero-vad',
];
assert.deepEqual(
  Object.keys(modelLibraryBackground).sort(),
  ['de', 'en', 'es', 'fr', 'ja', 'ko', 'ru', 'zh'],
  'model library descriptions must cover all eight locales',
);
for (const code of Object.keys(modelLibraryBackground)) {
  assert.deepEqual(
    Object.keys(modelLibraryBackground[code]).sort(),
    modelLibraryDescriptionIds,
    `modelLibraryBackground.${code} 与 en 的键集必须一致`,
  );
}
const summaryNodes = {
  '.modal-title h2': { textContent: '' },
  '.modal-title p': { textContent: '' },
  '.modal-body': { innerHTML: '' },
};
const summaryContext = {
  locale: 'zh',
  t: (value) => localeContext.window.BreviaLocaleData.catalog.zh.labels[value] || value,
  summaryModelCopy: localeContext.window.BreviaLocaleData.appCopy.summaryModelCopy,
  modelLabels: localeContext.window.BreviaLocaleData.appCopy.modelLabels,
  builtinModelIntro: { 'qwen3.5-2b-q4km': { zh: '质量与速度均衡' } },
  asrCopy: asrCopyData,
  renderModelLibraryRatings: () => '<span>质量：极高 · 速度：均衡</span>',
  formatBytes: (bytes) => `${bytes}B`,
  structuredClone,
  modelDownloads: new Map(),
  summaryConfigDraft: null,
  modelConfigSecrets: new WeakMap(),
  onboardingOnlineProvider: false,
  onboardingBuiltinProvider: false,
  chinaModelSourceToggle: () => '<input data-china-model-source />',
  settingsModal: {
    classList: { contains: () => false },
    querySelector: (selector) => summaryNodes[selector],
  },
  replaceModalBody: (_kind, markup) => (summaryNodes['.modal-body'].innerHTML = markup),
};
runInNewContext(`${text(components)}\nthis.escapeHtml = escapeHtml;`, summaryContext);
// escapeHtml 是所有模型名/会议名/用户文本进 innerHTML 的唯一出口，它就是 XSS 边界。
// 只断言「源码里调用了 escapeHtml」不说明它真的转义。
assert.equal(
  summaryContext.escapeHtml('<img src=x onerror=alert(1)>'),
  '&lt;img src=x onerror=alert(1)&gt;',
);
assert.doesNotMatch(summaryContext.escapeHtml('<script>alert(1)</script>'), /[<>]/);
assert.equal(
  summaryContext.escapeHtml('a & b'),
  'a &amp; b',
  '& 必须先于其它字符被转义，且只转一次',
);
assert.equal(summaryContext.escapeHtml(`"quoted" 'single'`), '&quot;quoted&quot; &#39;single&#39;');
assert.equal(summaryContext.escapeHtml(null), '', 'null 渲染为空串而不是 "null"');
assert.equal(summaryContext.escapeHtml(undefined), '');
assert.equal(summaryContext.escapeHtml(0), '0', '0 不能被 ?? 吞掉');
assert.equal(summaryContext.escapeHtml(false), 'false');
// 图片地址、链接地址与行内代码只能按文本渲染，不能被下一轮 Markdown 替换改成属性。
assert.equal(
  summaryContext.renderMarkdown('![a](https://img/[x](https://evil onerror=alert))'),
  '<p><img src="https://img/[x](https://evil onerror=alert" alt="a" />)</p>',
);
assert.equal(
  summaryContext.renderMarkdown('[**a & b**](https://host/`foo`)'),
  '<p><a href="https://host/`foo`" target="_blank" rel="noopener"><strong>a &amp; b</strong></a></p>',
);
assert.equal(
  summaryContext.renderMarkdown('`[x](https://host)` *text* **strong** *'),
  '<p><code>[x](https://host)</code> <em>text</em> <strong>strong</strong> *</p>',
);
assert.equal(summaryContext.renderMarkdown('**'), '<p>**</p>');
assert.equal(
  summaryContext.renderMarkdown('[x](javascript:alert) <img src=x onerror=alert>'),
  '<p><a href="#" target="_blank" rel="noopener">x</a> &lt;img src=x onerror=alert&gt;</p>',
);
// 关闭搜索、修改查询和较新请求都必须使旧响应失效，旧错误也不能关闭新结果。
{
  let resolveSearch, rejectSearch;
  const panel = { hidden: true, innerHTML: '' };
  const scheduled = new Set();
  const searchContext = {
    searchRequestId: 0,
    meetingSearch: { value: 'old' },
    meetingSearchClear: {},
    searchResultsPanel: panel,
    searchDebounceTimer: undefined,
    window: {
      clearTimeout(fn) {
        scheduled.delete(fn);
      },
      setTimeout(fn) {
        scheduled.add(fn);
        return fn;
      },
      brevia: {
        meeting: {
          search: () =>
            new Promise((resolve, reject) => {
              resolveSearch = resolve;
              rejectSearch = reject;
            }),
        },
      },
    },
    t: (key) => key,
    escapeHtml: summaryContext.escapeHtml,
    showToast: () => assert.fail('stale errors must not show a toast'),
  };
  runInNewContext(
    ['scheduleMeetingSearch', 'updateSearchPopup', 'closeSearchPopup']
      .map((name) => `${name === 'updateSearchPopup' ? 'async ' : ''}${summaryFn(name)}`)
      .join('\n'),
    searchContext,
  );
  let pending = searchContext.updateSearchPopup();
  searchContext.closeSearchPopup();
  resolveSearch([]);
  await pending;
  assert.equal(panel.hidden, true);
  searchContext.closeSearchPopup();
  assert.equal(scheduled.size, 0, 'closing the popup also cancels the pending debounce');
  pending = searchContext.updateSearchPopup();
  searchContext.meetingSearch.value = 'new';
  searchContext.scheduleMeetingSearch();
  resolveSearch([]);
  await pending;
  assert.equal(panel.hidden, true);
  pending = searchContext.updateSearchPopup();
  const staleError = rejectSearch;
  const newest = searchContext.updateSearchPopup();
  resolveSearch([]);
  await newest;
  staleError(new Error('old search failed'));
  await pending;
  assert.equal(panel.hidden, false);
}
{
  let pop;
  const popoverContext = {
    locale: 'en',
    aiAssistCopy: localeContext.window.BreviaLocaleData.appCopy.aiAssistCopy,
    escapeHtml: summaryContext.escapeHtml,
    window: { innerWidth: 1280 },
    document: {
      querySelector: () => pop,
      createElement: () => ({
        dataset: {},
        style: {},
        addEventListener(_type, handler) {
          this.click = handler;
        },
        remove() {
          if (pop === this) pop = null;
        },
      }),
      body: {
        append: (node) => {
          pop = node;
        },
      },
      addEventListener: () => assert.fail('opening a popover must not add a global listener'),
    },
    setTimeout: (fn) => fn(),
  };
  runInNewContext(summaryFn('openAiAssistPopover'), popoverContext);
  for (let index = 0; index < 3; index++) {
    popoverContext.openAiAssistPopover({
      getBoundingClientRect: () => ({ bottom: 10, right: 100 }),
    });
    pop.click({ target: { closest: (selector) => selector === '[data-ai-assist-later]' } });
    assert.equal(pop, null);
  }
}
// cleanSummaryMarkdown 决定纪要开头是否露出模型的寒暄：首个标题之前的内容会被丢掉。
assert.equal(
  summaryContext.cleanSummaryMarkdown('  ## 议题\n内容  '),
  '## 议题\n内容',
  '首个标题前的内容必须被裁掉，首尾空白要修剪',
);
assert.equal(
  summaryContext.cleanSummaryMarkdown('好的，以下是纪要：\n# 标题\n正文'),
  '# 标题\n正文',
  '模型前言必须被丢弃',
);
assert.equal(summaryContext.cleanSummaryMarkdown('# 标题'), '# 标题', '标题在开头时原样保留');
assert.equal(
  summaryContext.cleanSummaryMarkdown('没有标题的正文'),
  '没有标题的正文',
  '无标题时不裁剪内容',
);
assert.equal(summaryContext.cleanSummaryMarkdown(''), '');
assert.equal(summaryContext.cleanSummaryMarkdown(null), '');
assert.equal(
  summaryContext.cleanSummaryMarkdown('正文 # 不是标题'),
  '正文 # 不是标题',
  '行内 # 不是标题行',
);
assert.doesNotMatch(
  summaryContext.renderMeetingSummary({ generating: true }),
  /data-generate-summary/,
);
for (const markdown of ['', '# 已有纪要']) {
  detailTabbarContext.detailActiveTab = 'summary';
  detailTabbarContext.uiData.detail.summary = { markdown, generating: true };
  const generating = detailTabbarContext.renderDetailTabbar();
  assert.equal(
    (generating.match(/class="summary-generating-icon" aria-hidden="true"/g) || []).length,
    1,
  );
  assert.equal((generating.match(/disabled aria-busy="true"/g) || []).length, 1);
  assert.ok(generating.includes(componentContext.interfaceIcon('ai')), '生成中使用现有星星图标');
  detailTabbarContext.uiData.detail.summary.generating = false;
  assert.doesNotMatch(
    detailTabbarContext.renderDetailTabbar(),
    /summary-generating-icon|aria-busy="true"/,
  );
}
// 三个页面只保留一套公共操作；隐藏页面的草稿不改变当前页的按钮。
for (const scope of ['notes', 'transcript', 'summary']) {
  detailTabbarContext.detailActiveTab = scope;
  const d = detailTabbarContext.uiData.detail;
  Object.assign(d, {
    hasRefined: false,
    refinedMode: 'timestamps',
    transcriptVersion: 'refined',
    notesEditing: false,
    transcriptEditing: false,
    summaryEditing: false,
    transcriptEditable: true,
    summary: { markdown: '# 纪要' },
  });
  const header = detailTabbarContext.renderDetailTabbar();
  assert.equal((header.match(/class="detail-content-toolbar"/g) || []).length, 1);
  assert.match(header, new RegExp('id="detail-tab-' + scope + '" role="tab" aria-selected="true"'));
  d[scope + 'Editing'] = true;
  const editing = detailTabbarContext.renderDetailTabbar();
  assert.doesNotMatch(editing, /data-copy-summary|data-regenerate-summary|data-refine-more/);
  assert.match(editing, /取消<\/button>/);
  assert.match(editing, /保存<\/button>/);
}
detailTabbarContext.detailActiveTab = 'summary';
detailTabbarContext.uiData.detail.notesEditing = true;
detailTabbarContext.uiData.detail.summaryEditing = false;
assert.doesNotMatch(detailTabbarContext.renderDetailTabbar(), /data-notes-save/);
detailTabbarContext.uiData.detail.summary = {};
assert.doesNotMatch(
  detailTabbarContext.renderDetailTabbar(),
  /data-save-state="saved"/,
  '尚未生成纪要时不宣称已保存',
);
assert.doesNotMatch(
  summaryContext.renderMeetingSummary({ markdown: '# 纪要' }),
  /summary-head|data-open-summary-edit|data-regenerate-summary/,
  '纪要正文不再创建重复工具行',
);

runInNewContext(
  `${summaryConst('const summaryProviders = ')}${summaryConst('const summaryProviderPresets = ', true)}\n${summaryFn('summaryProviderLabel')}${summaryFn('providerEntry')}${summaryFn('builtinModelPicker')}${summaryFn('builtinModelEmptyState')}${summaryConst('const RECOMMENDED_BUILTIN_MODEL_ID = ')}${summaryFn('renderModelConfigFields')}${summaryFn('renderModelConfigForm')}${summaryFn('renderSummaryModelForm')}${summaryFn('renderAiSettingsTabs')}${summaryFn('renderAiServiceChoice')}${summaryFn('renderSummaryModelModal')}`,
  summaryContext,
);
const summaryCatalogModels = [
  { id: 'qwen3.5-2b-q4km', name: 'Qwen 3.5 2B', kind: 'llama-chat', size_bytes: 100 },
  { id: 'qwen3.5-4b-q4km', name: 'Qwen 3.5 4B', kind: 'llama-chat' },
  { id: 'whisper-large-v3', name: 'Whisper', kind: 'asr' },
];
const renderSummaryModal = (provider, { providers = {}, installed = [] } = {}) => {
  summaryContext.modelCatalog = summaryCatalogModels;
  summaryContext.modelPaths = new Map(installed.map((id) => [id, `/tmp/${id}`]));
  summaryContext.summaryConfig = { version: 2, provider, providers };
  summaryContext.summaryConfigDraft = null;
  summaryContext.selectedBuiltinModel = '';
  summaryContext.renderSummaryModelModal();
  return summaryNodes['.modal-body'].innerHTML;
};
summaryContext.onboardingBuiltinProvider = true;
let onboardingSummaryHtml = renderSummaryModal('built-in');
assert.doesNotMatch(onboardingSummaryHtml, /data-summary-enabled|data-china-model-source/);
assert.match(onboardingSummaryHtml, /name="provider" value="built-in"/);
assert.match(
  onboardingSummaryHtml,
  /data-flow-select-choice="provider" data-value="built-in"[^>]*>本地模型/,
);
assert.match(onboardingSummaryHtml, /data-flow-select-choice="provider" data-value="openai"/);
assert.equal(summaryNodes['.modal-title h2'].textContent, 'AI 会议纪要');
assert.equal(
  summaryNodes['.modal-title p'].textContent,
  '会议结束后，AI 自动把整场对话整理成会议纪要及待办事项。',
);
assert.match(onboardingSummaryHtml, /data-download-model="qwen3\.5-2b-q4km"/);
assert.match(
  onboardingSummaryHtml,
  /data-flow-select-choice="model" data-value="qwen3\.5-4b-q4km"/,
);
assert.match(onboardingSummaryHtml, /type="submit" disabled/);
summaryContext.modelDownloads.set('qwen3.5-2b-q4km', { received: 50, total: 100 });
onboardingSummaryHtml = renderSummaryModal('built-in');
assert.match(onboardingSummaryHtml, /data-download-model="qwen3\.5-2b-q4km" disabled/);
assert.match(onboardingSummaryHtml, /50%/);
summaryContext.modelDownloads.clear();
onboardingSummaryHtml = renderSummaryModal('built-in', { installed: ['qwen3.5-2b-q4km'] });
assert.doesNotMatch(onboardingSummaryHtml, /type="submit" disabled/);
assert.doesNotMatch(onboardingSummaryHtml, /data-download-model=/);
summaryContext.onboardingBuiltinProvider = false;
let summaryHtml = renderSummaryModal('built-in', { installed: ['qwen3.5-2b-q4km'] });
// 只列已安装的模型：装了 2B 就只出现 2B，没装的 4B 不出现在选择器里。
assert.match(summaryHtml, /data-flow-select-choice="model" data-value="qwen3\.5-2b-q4km"/);
assert.doesNotMatch(
  summaryHtml,
  /qwen3\.5-4b-q4km/,
  'uninstalled built-in models must not be listed',
);
assert.match(summaryHtml, /未安装|data-flow-select-choice/, 'the picker must be a select');
assert.doesNotMatch(
  summaryHtml,
  /data-download-summary-model/,
  'no download button inside feature settings',
);
assert.match(summaryHtml, /data-open-models-from-config/);
assert.match(summaryHtml, /质量与速度均衡/);
assert.doesNotMatch(summaryHtml, /whisper-large-v3/);
assert.match(summaryHtml, /name="model" value="qwen3\.5-2b-q4km"/);
assert.doesNotMatch(summaryHtml, /name="apiKey"|name="endpoint"/);
assert.doesNotMatch(summaryHtml, /type="submit" disabled/);
// 一个内置模型都没装时无从选择，保存必须禁用，并且要给一条去模型库的路。
summaryHtml = renderSummaryModal('built-in');
assert.match(summaryHtml, /type="submit" disabled/);
assert.doesNotMatch(summaryHtml, /data-flow-select-choice="model"/);
assert.match(summaryHtml, /data-open-models-from-config/);
// 两个都装了才能挑，推荐角标落在 2B 上。
summaryHtml = renderSummaryModal('built-in', { installed: ['qwen3.5-4b-q4km', 'qwen3.5-2b-q4km'] });
assert.match(summaryHtml, /data-flow-select-choice="model" data-value="qwen3\.5-4b-q4km"/);
assert.match(summaryHtml, /data-flow-select-choice="model" data-value="qwen3\.5-2b-q4km"/);
assert.match(
  summaryHtml,
  /data-value="qwen3\.5-2b-q4km"[^>]*>Qwen 3\.5 2B<em class="flow-select-badge">推荐<\/em>/,
);
assert.match(
  summaryHtml,
  /data-value="qwen3\.5-4b-q4km"[^>]*>Qwen 3\.5 4B<\/button>/,
  'only the recommended option carries a badge',
);
assert.equal(
  summaryContext.renderModelConfigFields(summaryContext.summaryConfig, '', { required: false })
    .saveDisabled,
  false,
  'disabling AI notes must not require a downloaded model',
);
for (const provider of ['claude', 'openai', 'openrouter']) {
  summaryHtml = renderSummaryModal(provider);
  assert.doesNotMatch(
    summaryHtml,
    /name="endpoint"/,
    `${provider} must not expose an endpoint field`,
  );
  assert.match(summaryHtml, /name="apiKey"/, `${provider} needs an api key field`);
  assert.match(summaryHtml, /name="model"/, `${provider} needs a model field`);
  assert.doesNotMatch(summaryHtml, /data-open-models-from-config|data-flow-select-choice="model"/);
}
for (const provider of ['custom-openai', 'custom-claude']) {
  assert.match(
    renderSummaryModal(provider),
    /name="endpoint"[^>]*type="url"/,
    `${provider} needs an endpoint field`,
  );
}
// 已存凭据只回填模型和圆点占位长度，密钥引用和明文都不进 DOM。
summaryHtml = renderSummaryModal('openai', {
  providers: { openai: { model: 'gpt-4.1-mini', keyReference: 'summary-1', keyLength: 12 } },
});
assert.match(summaryHtml, /name="model" value="gpt-4\.1-mini"/);
assert.match(summaryHtml, /name="apiKey"[^>]*type="password"/);
assert.match(summaryHtml, /name="apiKey"[^>]*autocomplete="new-password"/);
assert.match(summaryHtml, /name="apiKey"[^>]*placeholder="••••••••••••"/);
assert.doesNotMatch(summaryHtml, /summary-1/);
// 输入上限必须和主进程 zod 的上限一致，否则超长值要到主进程才被拒。
assert.match(summaryHtml, /name="apiKey"[^>]*maxlength="512"/);
assert.match(summaryHtml, /name="model"[^>]*maxlength="128"/);
assert.match(text(electronMain), /model: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)/);
assert.match(text(electronMain), /keyLength: z\.number\(\)\.int\(\)\.positive\(\)\.max\(512\)/);
summaryHtml = renderSummaryModal('openai');
for (const id of ['built-in', 'claude', 'openai', 'openrouter', 'custom-openai', 'custom-claude']) {
  assert.match(
    summaryHtml,
    new RegExp(`data-flow-select-choice="provider" data-value="${id}"`),
    `missing provider choice ${id}`,
  );
}
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  summaryContext.locale = code;
  const copy = localeContext.window.BreviaLocaleData.appCopy.summaryModelCopy[code];
  summaryHtml = renderSummaryModal('custom-openai');
  assert.ok(
    summaryHtml.includes(copy.providers['custom-openai']),
    `${code} is missing the custom-openai label`,
  );
  assert.ok(summaryHtml.includes(copy.save), `${code} is missing the save label`);
  assert.equal(summaryNodes['.modal-title h2'].textContent, copy.title);
}
summaryContext.locale = 'zh';
summaryContext.modelCatalog = [
  { id: '"><img src=x onerror=alert(1)>', name: '<script>alert(1)</script>', kind: 'llama-chat' },
];
summaryContext.modelPaths = new Map();
summaryContext.summaryConfig = { version: 2, provider: 'built-in', providers: {} };
summaryContext.renderSummaryModelModal();
assert.doesNotMatch(summaryNodes['.modal-body'].innerHTML, /<img|<script>/);
assert.doesNotMatch(text(html), /管理模型与术语/);
// AI 辅助笔记（阶段 0/1）：配置 IPC、入口、设置项与八语种文案。
assert.match(text(electronMain), /ai-assist\.config\.(get|save)/);
assert.match(
  text(preload),
  /aiAssist:\s*\{\s+config:\s+\{\s+get:\s+invoke\('ai-assist\.config\.get'\)/,
);
assert.match(
  text(app),
  /aiAssistConfig\s*=\s*\{\s+version:\s+2,\s+enabled:\s+false,\s+proactivity:\s+'assist',\s+provider:\s+'built-in',\s+providers:\s+\{\},?\s+\}/,
);
assert.match(text(app), /ai-assist-config-form/);
assert.match(text(app), /function switchAiAssistTo2B/);
assert.match(text(app), /function renderAiAssistToggle/);
assert.doesNotMatch(text(app), /AiAssistEmptyState|data-ai-empty-action/);
assert.match(text(app), /function openAiAssistPopover/);
assert.match(
  text(app),
  /if\s+\(kind\s+===\s+'ai-assist'\)\s+\{\s+renderAiAssistModal\(\);\s+return;\s+\}/,
);
assert.match(text(html), /data-ai-assist-toggle/);
assert.doesNotMatch(text(html), /data-ai-assist-empty/);
assert.doesNotMatch(text(tailwind), /ai-assist-empty/);
assert.match(text(uiData), /modal: 'ai-features'/);
assert.match(text(tailwind), /\.ai-assist-toggle/);
assert.match(text(tailwind), /\.ai-assist-popover/);
assert.match(text(i18nData), /aiAssistCopy/);
assert.equal(Object.keys(localeContext.window.BreviaLocaleData.appCopy.aiAssistCopy).length, 8);
assert.ok(
  localeContext.window.BreviaLocaleData.aiNotePromptCopy.en.instructions.includes(
    'Return at most one suggestion.',
  ),
);
assert.equal(localeContext.window.BreviaLocaleData.appCopy.aiAssistCopy.zh.toggleOn, 'AI 笔记 开');
assert.deepEqual(Object.keys(localeContext.window.BreviaLocaleData.aiNotePromptCopy), [
  'zh',
  'en',
  'es',
  'ja',
  'ko',
  'fr',
  'de',
  'ru',
]);
Object.values(localeContext.window.BreviaLocaleData.aiNotePromptCopy).forEach((copy) => {
  assert.ok(copy.instructions.length > 0);
  assert.equal(copy.state_labels.length, 5);
});
// AI 辅助笔记（阶段 2 无需 AI 本地规则）：加入笔记 / 信号检测。
assert.match(text(components), /appendMarkdown\(markdown\)/);
assert.match(text(components), /\^\[-\*\]\\s\$/);
assert.match(text(components), /function detectCaptionSignals/);
assert.match(text(app), /data-add-segment-note/);
assert.doesNotMatch(text(app), /data-add-segment-time/);
assert.match(text(app), /function segmentInfoFor/);
assert.match(text(app), /function appendTextToActiveNotes/);
assert.match(text(tailwind), /\.caption-signals/);
// AI 辅助笔记（阶段 3 实时引擎）：IPC、事件白名单、前端启动/停止/输入信号接线。
assert.match(text(electronMain), /ai-note\.suggestion/);
assert.match(text(electronMain), /ai-note\.evidence/);
assert.match(text(electronMain), /ai-note\.analyzing/);
assert.match(text(electronMain), /handleIpc\('ai-note\.start'/);
assert.match(text(preload), /aiNote:\s+\{\s+start:\s+invoke\('ai-note\.start'\)/);
assert.match(text(preload), /request: invoke\('ai-note\.request'\)/);
assert.match(text(workerSession), /self\.ai_note_on_segment\(event\)/);
assert.match(text(workerSession), /self\.ai_note_stop\(\{"meeting_id": self\.active\}\)/);
assert.match(text(app), /function startAiNoteForMeeting/);
assert.match(text(app), /prompt: aiNotePromptCopy\[locale\] \|\| aiNotePromptCopy\.en/);
assert.match(text(app), /function signalAiNoteTyping/);
assert.match(text(app), /function requestAiSuggestion/);
assert.match(text(app), /function appendAiSuggestion\(suggestion\)/);
assert.match(text(app), /suggestion\.type === 'topic' \? '##' : '-'/);
assert.match(text(app), /function flushAutoSuggestions\(\)/);
assert.match(
  text(app),
  /function resetAiNoteSuggestions\(\)[\s\S]*pendingAutoSuggestions\.length = 0/,
);
assert.ok((text(app).match(/resetAiNoteSuggestions\(\);/g) || []).length >= 3);
assert.match(text(app), /window\.brevia\.on\('ai-note\.suggestion'/);
assert.match(text(app), /window\.brevia\.on\('ai-note\.evidence'/);
// 补充引用依据时必须同时更新展示中与暂存的建议，不能因队列重赋值中断事件。
const evidenceHandlers = new Map();
const evidenceContext = {
  window: { brevia: { on: (name, handler) => evidenceHandlers.set(name, handler) } },
  meetingActive: true,
  breviaClient: { state: { meeting: { id: 'evidence-meeting' } } },
  latestAiSuggestion: { id: 'suggestion-1', text: '决定周五验收' },
  aiSuggestionQueue: [{ id: 'suggestion-1', text: '决定周五验收' }],
  renderAiSuggestion: () => {},
};
const evidenceStart = summaryAppSource.indexOf(
  "if (window.brevia?.on)\n  window.brevia.on('ai-note.evidence'",
);
const evidenceEnd = summaryAppSource.indexOf('/** 展示队列里的下一条建议', evidenceStart);
runInNewContext(
  `${summaryAppSource.match(/(?:const|let) pendingAutoSuggestions = \[\];/)[0]}\npendingAutoSuggestions.push({id:'suggestion-1',text:'决定周五验收'});\n${summaryAppSource.slice(evidenceStart, evidenceEnd)}`,
  evidenceContext,
);
const evidencePayload = {
  meeting_id: 'evidence-meeting',
  id: 'suggestion-1',
  evidence: ['segment-1'],
};
evidenceHandlers.get('ai-note.evidence')(evidencePayload);
assert.equal(evidenceContext.latestAiSuggestion.evidence[0], 'segment-1');
assert.equal(evidenceContext.aiSuggestionQueue[0].evidence[0], 'segment-1');
assert.equal(
  runInNewContext('pendingAutoSuggestions[0].evidence[0]', evidenceContext),
  'segment-1',
);
evidenceHandlers.get('ai-note.evidence')({
  ...evidencePayload,
  meeting_id: 'other',
  evidence: ['wrong'],
});
assert.equal(evidenceContext.latestAiSuggestion.evidence[0], 'segment-1');
assert.match(text(app), /renderOnboardingAiDemo/);
for (const [language, copy] of Object.entries(
  localeContext.window.BreviaLocaleData.appCopy.aiOnboardingCopy,
)) {
  for (const key of [
    'during',
    'after',
    'serviceTitle',
    'serviceHint',
    'adjustHint',
    'summaryScope',
    'demoOff',
    'replay',
  ]) {
    assert.ok(typeof copy[key] === 'string' && copy[key].trim(), `${language}: ${key}`);
  }
  const modes = copy.levels.filter(([value]) => value !== 'off');
  assert.equal(modes.length, 3, `${language}: three AI note modes`);
  assert.equal(new Set(modes.map(([, , description]) => description)).size, 3);
}
// AI 辅助笔记（阶段 4 建议 UI + 输入状态机）：三种 UI 形态与操作。
assert.match(text(html), /data-ai-suggestion/);
assert.match(text(html), /data-ai-request/);
assert.match(text(app), /function renderAiSuggestion/);
assert.match(text(app), /function acceptAiSuggestion/);
assert.match(text(app), /function convertTopicToHeading/);
assert.match(text(app), /data-ai-accept/);
assert.match(text(app), /data-ai-ignore/);
assert.match(text(app), /data-ai-suggestion-badge/);
assert.match(text(app), /data-ai-topic/);
assert.match(text(tailwind), /\.ai-suggestion-card/);
assert.match(text(tailwind), /\.ai-topic-divider/);
assert.match(text(tailwind), /\.ai-suggestion-badge/);
for (const copy of Object.values(localeContext.window.BreviaLocaleData.appCopy.aiAssistCopy)) {
  assert.equal(
    Object.keys(copy).some((key) => key.startsWith('empty')),
    false,
  );
}
// AI 辅助仅保留实时建议，不提供聊天式主动分析。
assert.doesNotMatch(text(electronMain), /ai-note\.analyze/);
assert.doesNotMatch(text(preload), /analyze: invoke\('ai-note\.analyze'\)/);
assert.doesNotMatch(
  text(app),
  /function organizeNotes|function factCheckNotes|function recallWorkspace|function askMeeting/,
);
assert.doesNotMatch(text(html), /data-ai-actions|data-ai-action/);
assert.match(text(html), /class="brand-mark"[^>]*><img src="\.\/assets\/brevia-mark\.svg"/);
assert.match(text(html), /class="new-meeting-label">开始会议/);
assert.match(
  text(app),
  /classList\.toggle\(\s*'is-live-meeting',\s+activeView\s+===\s+'live'\s+&&\s+meetingActive,?\s*\)/,
);
assert.match(text(tailwind), /\.app-shell\.is-live-meeting:has\(\.sidebar:hover\)/);
assert.match(text(tailwind), /\.sidebar:has\(\.task-cards > :not\(\[hidden\]\)\)::after/);
assert.match(text(tailwind), /--task-progress/);
assert.doesNotMatch(text(tailwind), /task-working/);
assert.match(text(tailwind), /conic-gradient/);
assert.doesNotMatch(text(tailwind), /live-note-reference/);
assert.doesNotMatch(
  text(app),
  /bindLiveNoteReference|noteReferenceMarkdown|segmentTimestampMarkdown|data-add-segment-time/,
);
assert.doesNotMatch(text(app), /renderLiveNoteReference|liveNoteReference/);
assert.match(text(meetingDetail), /summaryGeneratingMeetingId === meeting\.id/);
assert.match(text(components), /const editing = Boolean\(d\[`\$\{scope\}Editing`\]\)/);
assert.match(
  text(app),
  /if\s+\(window\.brevia\)\s+await\s+refreshBackendMeetings\(includeDeleted\)/,
);
// AI 辅助笔记（阶段 6 Onboarding AI 配置页）。
assert.match(text(app), /function openOnboardingAi/);
assert.match(text(app), /function finishAiOnboarding/);
assert.match(text(app), /aiOnboardingCopy/);
assert.match(text(app), /data-onboarding-ai-finish/);
assert.match(text(app), /data-onboarding-ai-skip/);
assert.match(text(tailwind), /\.onboarding-ai-ways/);
assert.match(text(tailwind), /\.onboarding-ai-levels/);
// AI 辅助笔记仅保留快速建议与标记。
assert.match(text(components), /command === 'todo'/);
assert.match(text(components), /command === 'highlight'/);
// UI 修订：富文本/Markdown 切换为工具栏 SVG 图标 + Command+/；移除字幕搜索与头部模式页签。
assert.match(text(html), /<div data-live-notes-root><\/div>/);
assert.doesNotMatch(text(html), /notes-mode-tabs/);
assert.match(text(html), /class="detail-search-results"[\s\S]*data-close-transcript-search/);
assert.match(text(components), /data-transcript-search/);
assert.match(text(app), /function filterDetailTranscript/);
assert.match(
  text(tailwind),
  /\.notes-find-pop\s+\{\s+position:\s+absolute;[^}]*top:\s+64px;[^}]*width:\s+min\(26rem/,
  'find and replace should overlay the editor content instead of taking a row',
);
assert.match(
  text(tailwind),
  /\.notes-find-pop\s+input\s+\{\s+min-width:\s+0;\s+height:\s+28px;/,
  'find and replace inputs should stay compact',
);
assert.doesNotMatch(
  text(components),
  /selection\.addRange\(range\); editor\.focus\(\);/,
  'find highlighting must not move focus from the find input',
);
assert.match(
  text(components),
  /document\.addEventListener\('pointerdown', closeFindOnOutsidePointer, \{ signal: listeners\.signal \}\)/,
  'clicking outside closes the find popover',
);
assert.match(
  text(components),
  /document\.execCommand\(event\.shiftKey \? 'outdent' : 'indent'\)/,
  'rich-text lists support nesting',
);
assert.match(text(components), /mode-toggle/);
assert.doesNotMatch(text(components), /mode-rich/);
assert.doesNotMatch(text(components), /mode-markdown/);
assert.match(text(components), /getMode\(\)\s+\{\s+return\s+mode;\s+\}/);
assert.match(text(components), /urlPop\.style\.position = 'fixed'/);
assert.match(text(components), /openUrlPop\(command, button\)/);
assert.match(
  text(components),
  /imageInput\.accept = 'image\/png,image\/jpeg,image\/gif,image\/webp'/,
);
assert.match(text(components), /file\.size > 10 \* 1024 \* 1024/);
assert.match(text(components), /file\s*\.arrayBuffer\(\)/);
assert.doesNotMatch(text(components), /readAsDataURL|data_url/);
assert.match(
  text(components),
  /meeting\.noteImage\.save\(\{\s*meeting_id:\s*meetingId,\s*mime_type:\s*file\.type,\s*bytes,?\s*\}/,
);
assert.match(text(components), /sanitizeUrl\(url = ''\)[\s\S]{0,180}brevia-note/);
assert.match(
  text(electronMain),
  /function saveNoteImage\([\s\S]{0,700}Image must be 10 MB or smaller/,
);
assert.match(
  text(electronMain),
  /meeting\.note-image\.save[\s\S]{0,300}worker\.request\('meeting\.get'/,
);
assert.match(text(electronMain), /protocol\.handle\('brevia-note'/);
assert.match(text(preload), /noteImage: \{ save: invoke\('meeting\.note-image\.save'\) \}/);
assert.match(text(html), /img-src 'self' data: brevia-note:/);
assert.doesNotMatch(text(components), /note-reference|syncNoteReferenceRail/);
assert.match(text(components), /\[\s*'table',\s+'插入表格'/);
assert.match(text(components), /tag === 'table'/);
assert.match(text(tailwind), /\.notes-url-pop \{[^}]*display: flex/);
// 表格可以自选行列数：默认仍是 2×2，选择器同时提供网格快选与数字精确输入。
assert.match(
  text(components),
  /const NOTE_TABLE_LIMITS = \{ columns: 20, rows: 50, gridColumns: 10, gridRows: 8 \}/,
);
assert.match(text(components), /data-notes-table-rows/, 'table picker exposes a row count field');
assert.match(
  text(components),
  /data-notes-table-columns/,
  'table picker exposes a column count field',
);
assert.match(
  text(components),
  /data-notes-table-cell="\$\{column \+ 1\}:\$\{row \+ 1\}"/,
  'table picker grid reports the hovered size',
);
assert.match(
  text(components),
  /command === 'table'\) openTablePop\(button\)/,
  'the table button opens the size picker',
);
assert.match(
  text(components),
  /document\.addEventListener\(\s*'pointerdown',\s+closeTablePopOnOutsidePointer,\s+\{\s+signal:\s+listeners\.signal,?\s*\}\)/,
  'clicking outside closes the table picker',
);
assert.match(
  text(components),
  /tablePop\.hidden = true;[\s\S]{0,80}\}/,
  'switching editor mode closes the table picker',
);
assert.match(text(tailwind), /\.notes-table-pop \{[^}]*display: grid/);
assert.match(text(tailwind), /\.notes-table-grid button\.is-on/);
assert.match(text(tailwind), /\.notes-table-fields input \{[^}]*width: 56px/);
assert.equal(componentContext.clampTableSize('7', 20), 7);
assert.equal(componentContext.clampTableSize('', 50), 1, 'an empty field falls back to one row');
assert.equal(componentContext.clampTableSize(999, 20), 20, 'column count is capped');
assert.equal(componentContext.clampTableSize(-3, 50), 1);
assert.equal(
  componentContext.noteTableHtml({ columns: 3, rows: 3 }),
  '<table><thead><tr><th>列 1</th><th>列 2</th><th>列 3</th></tr></thead><tbody><tr><td>内容</td><td>内容</td><td>内容</td></tr><tr><td>内容</td><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>',
  'rich text inserts the requested number of columns and rows',
);
assert.equal(
  componentContext.noteTableMarkdown({ columns: 2, rows: 2 }),
  '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |',
  'markdown keeps the previous 2×2 default',
);
assert.equal(
  componentContext.noteTableMarkdown({ columns: 2, rows: 4 }).split('\n').length,
  5,
  'markdown emits the header, separator and one line per body row',
);
assert.match(text(components), /Array\.from\(\s*\{\s+length:\s+NOTE_TABLE_LIMITS\.gridRows\s+\}/);
// 引用（blockquote）与标题都是可切换的块格式，再次点击回到正文。
assert.match(
  text(components),
  /if\s+\(quote\)\s+\{\s+placeCaretAtEnd\(unwrapBlockquote\(quote\)\)/,
  'quote can be turned off again',
);
assert.doesNotMatch(
  text(components),
  /command === 'quote'\) document\.execCommand/,
  'the quote button must not always re-apply the blockquote',
);
assert.match(
  text(components),
  /block\.tagName\.toLowerCase\(\)\s+===\s+command\)\s+\{\s+placeCaretAtEnd\(retagBlock\(block,\s+'p'\)\)/,
  'headings can be turned off again',
);
assert.match(
  text(components),
  /const blocks = \[\.\.\.quote\.children\]\.filter/,
  'exiting a quote preserves its inner blocks',
);
assert.match(text(components), /function syncToolbarState\(\)/);
assert.match(
  text(components),
  /document\.addEventListener\('selectionchange', syncToolbarState, \{ signal: listeners\.signal \}\)/,
  'active block formats are reflected on the toolbar',
);
assert.match(text(components), /button\.classList\.toggle\('is-active', active\)/);
assert.doesNotMatch(text(components), /class="jump"/);
assert.match(text(tailwind), /\.caption-signals\s+\{[^}]*white-space:\s+nowrap;\s+flex:\s+none/);
assert.match(text(app), /event\.key !== '\/'/);
assert.match(text(app), /editor\.setMode\(editor\.getMode\(\)/);
assert.match(text(tailwind), /notes-toolbar button\.is-active/);
// 暂停录制后界面必须显示已暂停：实时页 header、迷你控件与会议列表三处同步。
assert.match(
  text(html),
  /<span class="recording" id="live-recording-state">/,
  'the live header recording pill is addressable',
);
assert.match(text(app), /function renderRecordingState\(paused\) \{/);
assert.match(
  text(app),
  /'#live-recording-state', '#mini-meeting \.mini-recording'/,
  'pause state reaches both live indicators',
);
assert.match(
  text(app),
  /\['#live-recording-state', '#mini-meeting \.mini-recording'\]\.forEach[\s\S]{0,320}badge\.classList\.toggle\('is-paused', paused\)/,
);
assert.match(text(app), /const label = paused \? '已暂停' : '正在录制';/);
assert.match(
  text(app),
  /label: paused \? '已暂停' : '正在录制', paused/,
  're-rendering from backend data keeps a paused meeting paused',
);
assert.match(
  text(app),
  /active\.status = \{ \.\.\.active\.status, label, paused \};[\s\S]{0,80}renderMeetingList\(\)/,
  'the meeting list row follows the pause state',
);
assert.match(
  text(app),
  /button\.innerHTML = .*interfaceIcon\(paused \? 'play' : 'pause'\).*;\s*renderRecordingState\(paused\);/,
  'the pause button also refreshes the recording state',
);
assert.match(
  text(components),
  /\$\{status\.paused \? ' is-paused' : ''\}/,
  'paused meetings are marked in the library list',
);
// 暂停态改用警示色（令牌），不再沿用录制红——断言角色而不是字面值。
assert.match(
  text(tailwind),
  /\.recording\.is-paused\s+\{\s+@apply\s+text-\(--color-warning\)/,
  'paused stops using the recording red',
);
assert.match(text(tailwind), /\.mini-recording\.is-paused/);
assert.match(text(tailwind), /\.meeting-status \.status\.is-paused/);

assert.ok(
  modelManifest.every(
    (model) => !model.stages.some((stage) => ['streaming', 'punctuation'].includes(stage)),
  ),
);

assert.doesNotMatch(text(app), /streamingModelId/);
assert.match(text(app), /isRefined: true,\s*updateFinalized: true,\s*clearCurrentIfMatch: true/);

// 模型下架不改写或隐藏历史精修；下一次选型与稿件来源分别记录。
assert.doesNotMatch(text(meetingDetail), /ignoreRefined|modelRetired/);
assert.match(text(meetingDetail), /refinedModelApplied = meeting\.transcript_model_id/);
assert.match(text(meetingDetail), /latestTranscriptSegments\(meeting\)/);
// 判定本身已用合成输入验证（见 app-utils 的行为断言）；这里确认展示模式跟着**模型能力**
// 分流，而不是跟着数据里有没有时间戳字段走。
assert.match(text(components), /d\.refinedMode === 'fulltext'/);
assert.match(text(components), /d\.refinedMode === 'timestamps'/);
assert.match(
  text(app),
  /language: uiData\.detail\.language \|\| 'auto',\n\s+\.\.\.\(numSpeakers/,
  'refinement sends its own settings without a translation target',
);

// 设置可下载模型与已安装模型共同展示；默认值优先已安装，切换服务不会丢失密钥草稿。
summaryContext.locale = 'zh';
summaryContext.settingsModal.classList.contains = () => true;
summaryContext.modelCatalog = summaryCatalogModels;
summaryContext.modelPaths = new Map([['qwen3.5-4b-q4km', '/tmp/installed']]);
summaryContext.selectedBuiltinModel = '';
summaryContext.summaryConfigDraft = {
  version: 2,
  enabled: false,
  provider: 'built-in',
  providers: {},
};
summaryContext.renderSummaryModelModal();
assert.match(summaryNodes['.modal-body'].innerHTML, /data-ai-settings-tab="summary-model"/);
assert.match(summaryNodes['.modal-body'].innerHTML, /data-ai-settings-tab="ai-assist"/);
assert.match(summaryNodes['.modal-body'].innerHTML, /name="model" value="qwen3.5-4b-q4km"/);
assert.doesNotMatch(summaryNodes['.modal-body'].innerHTML, /type="submit" disabled/);
const onlineDraft = { provider: 'openai', providers: {} };
summaryContext.modelConfigSecrets.set(onlineDraft, { openai: 'draft-key' });
const onlineMarkup = summaryContext.renderModelConfigFields(onlineDraft, '').markup;
assert.match(onlineMarkup, /value="draft-key"/);
assert.match(onlineMarkup, /data-toggle-secret/);
assert.doesNotMatch(onlineMarkup, /data-value="built-in"/);
summaryContext.settingsModal.classList.contains = () => false;

// 进阶设置表单必须覆盖 settings.json 的每个字段，并把两层配置渲染成可保存的路径。
const advancedContext = {
  interfaceIcon: summaryContext.interfaceIcon,
  window: localeContext.window,
  locale: 'zh',
  escapeHtml: (value) => String(value ?? ''),
};
runInNewContext(
  `${summaryConst('const advancedSettingCopy = ')}${summaryFn('renderAdvancedSettings')}\nthis.advancedSettingCopy = advancedSettingCopy; this.renderAdvancedSettings = renderAdvancedSettings;`,
  advancedContext,
);
const advancedSettings = JSON.parse(await readFile('../backend/settings.json', 'utf8'));
const commonInactive = ['boundary_tail_seconds', 'speaker_change_detection', 'num_speakers'];
const advancedMetadata = {
  vad_runtime: 'sherpa-onnx==1.13.8',
  inactive_fields: commonInactive,
  speech_cap_minimum: 1,
  speech_cap_default_seconds: 22,
  speech_window_seconds: 512 / 16000,
  speech_overlap_seconds: 0.4,
  field_constraints: {
    'audio.sample_rate': { min: 16000, max: 16000, step: 1, read_only: true },
    'audio.chunk_seconds': { min: 1, step: 1 },
    'live_asr.max_speech_seconds': { min: 0, step: 'any' },
    'live_asr.quiet_speech_recovery': { min: 0, max: 1, step: 1 },
    'live_asr.quiet_speech_max_seconds': { min: 0, exclusive_min: true, step: 'any' },
    'vad.zh.threshold': { min: 0, max: 1, step: 'any' },
  },
};
const advancedMarkup = advancedContext.renderAdvancedSettings(advancedSettings, advancedMetadata);
const mlxMetadata = {
  ...advancedMetadata,
  vad_runtime: 'mlx-audio',
  inactive_fields: [
    ...commonInactive,
    'quiet_speech_min_seconds',
    'quiet_speech_max_seconds',
    'quiet_speech_level_ratio',
  ],
};
const mlxAdvanced = advancedContext.renderAdvancedSettings(advancedSettings, mlxMetadata);
assert.match(mlxAdvanced, /name="live_asr.max_speech_seconds"[^>]*min="0"/);
assert.match(mlxAdvanced, /0 \/ ≥ 1 s/);
assert.doesNotMatch(mlxAdvanced, /name="live_asr.quiet_speech_min_seconds"/);
assert.match(mlxAdvanced, /name="live_asr.quiet_speech_recovery"[^>]*min="0" max="1" step="1"/);
assert.match(advancedMarkup, /name="audio.sample_rate"[^>]*readonly[^>]*value="16000"/);
assert.match(advancedMarkup, /name="vad.zh.threshold"[^>]*min="0" max="1" step="any"/);
assert.match(advancedMarkup, /name="audio.chunk_seconds"[^>]*min="1" step="1"/);
for (const key of commonInactive) assert.ok(!advancedMarkup.includes(`name="diarization.${key}"`));
assert.ok(mlxAdvanced.includes(advancedContext.advancedSettingCopy.zh.mlxQuietHint));
assert.ok(!advancedMarkup.includes(advancedContext.advancedSettingCopy.zh.mlxQuietHint));
assert.ok(advancedMarkup.includes(advancedContext.advancedSettingCopy.zh.defaultSilenceHint));
assert.ok(
  advancedContext
    .renderAdvancedSettings(advancedSettings, {
      ...advancedMetadata,
      diarization_chunk_floor_ms: 60000,
    })
    .includes(advancedContext.advancedSettingCopy.zh.windowsChunkHint),
);
const advancedPaths = [...advancedMarkup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
const leafPaths = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' ? leafPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
assert.deepEqual(
  advancedPaths.sort(),
  leafPaths(advancedSettings)
    .filter((path) => !commonInactive.includes(path.split('.').at(-1)))
    .sort(),
  'only effective settings are rendered, preserving their original paths',
);
assert.match(
  advancedMarkup,
  /name="vad\.zh\.threshold"/,
  'nested voice detection settings keep their full path',
);
assert.match(
  advancedMarkup,
  /advanced-settings-subgroup/,
  'nested settings get their own subheading',
);
for (const key of Object.keys(advancedContext.advancedSettingCopy.zh.fields)) {
  for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
    assert.ok(
      advancedContext.advancedSettingCopy[code].fields[key],
      `missing ${code} label for ${key}`,
    );
    const hint = advancedContext.advancedSettingCopy[code].hints[key];
    assert.ok(hint?.length > 10, `missing ${code} explanation for ${key}`);
    advancedContext.locale = code;
    const markup = advancedContext.renderAdvancedSettings(advancedSettings, advancedMetadata);
    if (!commonInactive.includes(key)) assert.ok(markup.includes(hint));
    const mlxMarkup = advancedContext.renderAdvancedSettings(advancedSettings, mlxMetadata);
    assert.ok(mlxMarkup.includes(advancedContext.advancedSettingCopy[code].mlxQuietHint));
    assert.ok(mlxMarkup.includes(advancedContext.advancedSettingCopy[code].defaultSilenceHint));
  }
}
assert.doesNotMatch(
  JSON.stringify(advancedContext.advancedSettingCopy),
  /punctuation|endpoint_rule/,
  'labels for removed settings are gone',
);

assert.doesNotMatch(advancedMarkup, /用于本地运行配置|undefined/);
assert.match(mlxAdvanced, /0 使用默认 22 秒/);
advancedContext.locale = 'zh';

// 条件值与联动下限要随输入更新；原生 required / min / max / step 由 E2E 验证。
advancedContext.advancedSettings = advancedMetadata;
runInNewContext(summaryFn('validateAdvancedSettings'), advancedContext);
const makeAdvancedInput = (name, valueAsNumber) => {
  const hint = { textContent: 'range' };
  return {
    name,
    valueAsNumber,
    closest: () => ({ querySelector: () => hint }),
    setCustomValidity(message) {
      this.error = message;
    },
  };
};
const capInput = makeAdvancedInput('live_asr.max_speech_seconds', 0.5);
const speechInput = makeAdvancedInput('vad.zh.min_speech_duration', 0.3);
const durationInput = makeAdvancedInput('vad.zh.max_speech_duration', 30);
const quietMin = makeAdvancedInput('live_asr.quiet_speech_min_seconds', 1);
const quietMax = makeAdvancedInput('live_asr.quiet_speech_max_seconds', 0);
const advancedForm = {
  querySelectorAll: () => [capInput, speechInput, durationInput, quietMin, quietMax],
};
advancedContext.validateAdvancedSettings(advancedForm);
assert.ok(capInput.error, 'positive caps below the supported minimum are invalid');
assert.ok(quietMax.error, 'exclusive lower bounds reject zero');
assert.ok(quietMin.error, 'quiet speech minimum must fit in the maximum span');
capInput.valueAsNumber = 0;
quietMax.valueAsNumber = 20;
advancedContext.validateAdvancedSettings(advancedForm);
assert.equal(capInput.error, '', 'zero uses the default cap');
assert.equal(quietMax.error, '');
assert.equal(quietMin.error, '');
speechInput.valueAsNumber = 3;
capInput.valueAsNumber = 1;
advancedContext.validateAdvancedSettings(advancedForm);
assert.ok(durationInput.min > 3, 'VAD cap includes overlap and window padding');
assert.ok(capInput.error, 'live cap follows an increased minimum utterance duration');
speechInput.valueAsNumber = 0.3;
advancedContext.validateAdvancedSettings(advancedForm);
assert.equal(durationInput.min, 1);
assert.equal(capInput.error, '', 'lowering the minimum removes stale input errors');

// 首次精修与重新精修都要能改「会议语言」和「识别模型」。
summaryContext.BreviaI18n = meetingLanguages.window.BreviaI18n;
const refineModelCandidates = [
  ['funasr-nano-int8', 'FunASR Nano int8', ''],
  ['qwen3-asr-0.6b-int8', 'Qwen3-ASR 0.6B · 838MB', 'Recommended'],
];
for (const hasRefined of [false, true]) {
  const markup = summaryContext.renderRefineStatus({
    hasRefined,
    refineState: 'idle',
    language: 'zh',
    refinedModelId: 'funasr-nano-int8',
    refinedModelAppliedName: 'FunASR Nano int8',
    refinedModelOptions: refineModelCandidates,
  });
  assert.match(markup, /data-flow-select-choice="refine-language" data-value="zh"/);
  assert.match(markup, /data-flow-select-choice="refine-language" data-value="auto"/);
  assert.match(markup, /data-flow-select-choice="refine-language" data-value="es"/);
  assert.doesNotMatch(markup, /<select/);
  assert.match(markup, /data-refine-model-row/, 'both menus expose the refinement-model row');
  assert.match(
    markup,
    /name="refine-model" value="funasr-nano-int8"/,
    'the current model is pre-selected',
  );
  assert.match(
    markup,
    /data-flow-select-choice="refine-model" data-value="qwen3-asr-0.6b-int8"/,
    'other candidates are offered',
  );
  assert.match(
    markup,
    /data-flow-select-choice="refine-model" data-value="qwen3-asr-0\.6b-int8"[^>]*>Qwen3-ASR 0\.6B · 838MB/,
    'uninstalled candidates carry their size',
  );
  if (hasRefined) {
    assert.doesNotMatch(markup, /data-refine-action="original"/);
    detailTabbarContext.detailActiveTab = 'transcript';
    Object.assign(detailTabbarContext.uiData.detail, {
      hasRefined,
      transcriptEditing: false,
      refinedModelAppliedName: 'FunASR Nano int8',
    });
    assert.match(
      detailTabbarContext.renderDetailTabbar(),
      /已精修 · FunASR Nano int8/,
      'the refined label names the model that produced it',
    );
  } else {
    assert.doesNotMatch(markup, /已精修 ·/, 'no applied-model suffix before the first refinement');
    assert.match(markup, /data-refine-action="start"/);
  }
}
// 模型清单还没加载完（没有候选）时不能渲染一个空的模型选择框。
assert.doesNotMatch(
  summaryContext.renderRefineStatus({ hasRefined: false, refineState: 'idle', language: 'zh' }),
  /data-refine-model-row/,
);
// 精修菜单的模型选择与「只在显式改过时才点名」的状态机，必须在 app.js 里接线。
assert.match(text(app), /data-flow-select-choice="refine-model"/);
assert.match(text(app), /uiData\.detail\.refinedModelPinned = true/);
assert.match(text(app), /function pinnedRefineModel\(\)/);
assert.match(text(app), /function meetingHasUserEdits\(\)/);
assert.match(text(app), /function refineWithSelectedModel\(numSpeakers\)/);
assert.match(text(app), /\.\.\.\(modelId \? \{ refined_model_id: modelId \} : \{\}\)/);
assert.match(text(app), /refineWithSelectedModel\(refineNumSpeakers\(\)\)/);
assert.match(
  text(meetingDetail),
  /refinedModelOptions = refinedModelOptions\(uiData\.detail\.language\)/,
);
assert.match(text(meetingDetail), /refinedModelAppliedName/);
assert.ok(localeContext.window.BreviaLocaleData.catalog.en.labels['识别模型']);
for (const copy of [
  '重新精修',
  '该会议已有逐句修改。重新精修可能改变分段，使这些修改不再出现在当前逐字稿中。原稿仍保存在本机历史数据中。',
  'Refinement may change segment boundaries',
]) {
  assert.ok(text(i18nData).includes(copy), `missing i18n copy: ${copy}`);
}
assert.match(
  text(css),
  /\.refine-menu-speakers input:not\(\[type=checkbox\]\):not\(\[type=range\]\):not\(\[type=radio\]\),\.refine-menu-speakers \.flow-select-toggle\{[^}]*height:32px/,
);
const viewNode = (id) => {
  const classes = new Set(['active']);
  return {
    id,
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
  };
};
const viewA = viewNode('a-view'),
  viewB = viewNode('b-view'),
  viewC = viewNode('c-view');
let visibleView = viewA;
const navigationContext = {
  pageTransition: null,
  pageTransitionRevision: 0,
  viewReturnFocus: new Map(),
  BreviaMotion: { cancel() {}, enter() {} },
  modalRequestRevision: 0,
  activeView: 'a',
  settingsModal: { hidden: true },
  onboardingPage: undefined,
  breviaClient: null,
  document: {
    querySelector: (selector) =>
      selector === '.view.active' ? visibleView : { classList: { toggle() {} } },
    querySelectorAll: () => [],
  },
  meetingActive: false,
  crumb: {},
  prepareView: { dataset: {} },
  t: (value) => value,
  locale: 'en',
  catalog: { en: { views: { a: 'A', b: 'B', c: 'C' } } },
  activeLibraryNav: 'all-meetings',
  selectLibraryNav() {},
  resetDetailHeaderCollapse() {},
  renderMiniPlayback() {},
  syncPhonePreview() {},
  matchMedia: () => ({ matches: false }),
  window: { scrollTo() {} },
};
runInNewContext(`async ${summaryFn('transitionPage')}`, navigationContext);
const firstNavigation = navigationContext.transitionPage(viewA, viewB, () => {
  visibleView = viewB;
});
const secondNavigation = navigationContext.transitionPage(viewA, viewC, () => {
  visibleView = viewC;
});
await firstNavigation;
await secondNavigation;
assert.equal(visibleView, viewC, 'navigation does not wait for visual animation');
assert.equal(
  navigationContext.activeView,
  'c',
  'all transition callers update the same active view state',
);
assert.ok(
  !viewA.classList.contains('active') &&
    !viewB.classList.contains('active') &&
    viewC.classList.contains('active'),
);
// 会议库直接调用 transitionPage，必须与 showView 一样释放设置页。
let settingsClosed = false;
const appShellStub = { inert: true, classList: { toggle() {} } };
navigationContext.settingsModal = viewNode('settings-modal');
navigationContext.settingsModal.hidden = false;
navigationContext.settingsModal.classList.add('settings-page');
navigationContext.closeModal = () => {
  settingsClosed = true;
};
navigationContext.clearTimeout = () => {};
navigationContext.modalDismissTimer = undefined;
navigationContext.document.body = { classList: { remove() {} } };
navigationContext.document.querySelector = (selector) =>
  selector === '.view.active' ? visibleView : appShellStub;
const libraryNavigation = navigationContext.transitionPage(viewC, viewA);
await libraryNavigation;
assert.ok(
  settingsClosed && navigationContext.settingsModal.hidden && !appShellStub.inert,
  '离开设置后会议库可交互',
);
// 慢业务清理仍串行，但尚未开始的中间意图不会排成长动画队列。
let finishNavigation;
const appliedNavigation = [];
const heldNavigation = navigationContext.transitionPage(
  viewA,
  viewB,
  () =>
    new Promise((resolve) => {
      finishNavigation = resolve;
    }),
);
const skippedNavigation = navigationContext.transitionPage(viewA, viewC, () =>
  appliedNavigation.push('stale'),
);
const latestNavigation = navigationContext.transitionPage(viewA, viewA, () =>
  appliedNavigation.push('latest'),
);
finishNavigation();
await Promise.all([heldNavigation, skippedNavigation, latestNavigation]);
assert.deepEqual(appliedNavigation, ['latest']);

const liveElement = () => ({
  classList: { add() {}, remove() {} },
  setAttribute() {},
  removeAttribute() {},
  querySelector: () => null,
  replaceWith() {},
  remove() {},
});
const liveCacheContext = {
  correctionDraft: null,
  correctionPanel: { hidden: true },
  liveSegments: new Map(),
  liveSegmentData: new Map(),
  maxLiveSegments: 500,
  followLiveTranscript: false,
  isAtLiveBottom: () => false,
  formatMeetingTime: () => '',
  formatSpeakerName: summaryContext.formatSpeakerName,
  t: (value) => value,
  floatingCaptionMode: null,
  latestLiveSegmentId: null,
  document: { createElement: () => ({ content: { firstElementChild: liveElement() } }) },
  renderTranscriptSegment: () => '',
  transcript: { querySelectorAll: () => [], insertBefore() {} },
};
const liveRenderStart = summaryAppSource.indexOf('  const renderLiveEvent = (payload) => {');
runInNewContext(
  summaryAppSource.slice(liveRenderStart, summaryAppSource.indexOf('\n  };', liveRenderStart) + 5) +
    '\nthis.renderLiveEvent = renderLiveEvent;',
  liveCacheContext,
);
for (let index = 0; index < 505; index++)
  liveCacheContext.renderLiveEvent({
    segment_id: `s${index}`,
    revision: 1,
    speaker: 'spk-1',
    start_ms: index,
    end_ms: index + 1,
    text: 'test',
  });
assert.equal(liveCacheContext.liveSegments.size, 500);
assert.equal(
  liveCacheContext.liveSegmentData.size,
  500,
  'deduplication revisions share the bounded segment cache',
);
liveCacheContext.renderLiveEvent({
  segment_id: 's504',
  revision: 1,
  speaker: 'spk-1',
  text: 'duplicate',
});
assert.equal(
  liveCacheContext.liveSegmentData.get('s504').text,
  'test',
  'repeated revisions cannot overwrite a retained segment',
);
liveCacheContext.renderLiveEvent({
  segment_id: 'missing-speaker',
  revision: 1,
  speaker: null,
  start_ms: 505,
  end_ms: 506,
  text: 'valid caption',
});
assert.equal(liveCacheContext.liveSegmentData.get('missing-speaker').text, 'valid caption');
assert.doesNotMatch(
  summaryAppSource,
  /liveSegmentRevisions/,
  'there is no second unbounded revision cache',
);
// 恢复手机会议后，已有字幕也必须支持加入笔记、去重和缓存淘汰。
{
  const restoredNodes = Array.from({ length: 500 }, liveElement);
  Object.assign(liveCacheContext, {
    breviaClient: { state: { meeting: null } },
    timer: undefined,
    clearInterval() {},
    activateMeeting() {
      liveCacheContext.liveSegments.clear();
      liveCacheContext.liveSegmentData.clear();
      liveCacheContext.latestLiveSegmentId = null;
    },
    renderSegmentData: (segment) => segment,
    liveNotesEditor: { setMarkdown() {} },
  });
  liveCacheContext.transcript.children = restoredNodes;
  liveCacheContext.document.querySelector = (selector) =>
    selector === '#transcript-scroll' ? liveCacheContext.transcript : {};
  runInNewContext(
    summaryFn('adoptMobileMeeting') + '\n' + summaryFn('segmentInfoFor'),
    liveCacheContext,
  );
  liveCacheContext.adoptMobileMeeting({
    id: 'restored-phone',
    tags: ['手机录音'],
    notes: 'Keep these notes',
    segments: Array.from({ length: 505 }, (_, index) => ({
      id: `restored-${index}`,
      revision: 3,
      text: 'restored text',
      start_ms: index * 1000,
      end_ms: (index + 1) * 1000,
      speaker_name: 'Pat',
    })),
  });
  assert.equal(
    liveCacheContext.segmentInfoFor('restored-phone', 'restored-504')?.text,
    'restored text',
  );
  assert.equal(liveCacheContext.latestLiveSegmentId, 'restored-504');
  assert.equal(liveCacheContext.liveSegments.size, 500);
  assert.equal(liveCacheContext.liveSegmentData.has('restored-0'), false);
  assert.equal(liveCacheContext.liveSegments.get('restored-5'), restoredNodes[0]);
  liveCacheContext.renderLiveEvent({ segment_id: 'restored-504', revision: 3, text: 'duplicate' });
  assert.equal(liveCacheContext.liveSegmentData.get('restored-504').text, 'restored text');
}

// A slow worker cannot retain an unbounded stream or prevent microphone release.
let releaseSlowAudio,
  captureError,
  releasedTracks = 0,
  releasedContexts = 0;
const boundedCapture = new mediaContext.AudioCapture(
  () =>
    new Promise((resolve) => {
      releaseSlowAudio = resolve;
    }),
  () => {},
  (error) => {
    captureError = error;
  },
);
boundedCapture.meetingId = 'bounded';
const boundedResource = {
  track: 'mic',
  stream: {
    getAudioTracks: () => [
      {
        readyState: 'live',
        stop() {
          releasedTracks += 1;
        },
      },
    ],
    getVideoTracks: () => [],
  },
  context: {
    state: 'running',
    async close() {
      releasedContexts += 1;
    },
  },
  pending: () => boundedResource.inFlight,
};
boundedCapture.sources = [boundedResource];
boundedCapture.enqueue(boundedResource, new Int16Array(8192), 0);
for (let frame = 0; frame < 100; frame += 1)
  boundedCapture.enqueue(boundedResource, new Int16Array(8192), frame * 512);
assert.equal(captureError.message, 'error.audio_backpressure');
assert.ok(boundedResource.pendingSamples <= 16000 * 15 + 8192);
const stoppedSlowCapture = boundedCapture.stop();
await new Promise(setImmediate);
assert.ok(
  releasedTracks > 0 && releasedContexts === 1,
  'device resources are released before the pending worker request',
);
releaseSlowAudio();
await new Promise(setImmediate);
releaseSlowAudio();
await stoppedSlowCapture;
for (const code of ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']) {
  const data = localeContext.window.BreviaLocaleData;
  assert.ok(data.appCopy.summaryModelCopy[code].featureIntro);
  if (code !== 'en')
    for (const key of ['译文: 开', '已完成精修', '说话人', '悬浮字幕：开', '精修字稿'])
      assert.notEqual(data.catalog[code].labels[key], data.catalog.en.labels[key]);
  if (code !== 'zh') assert.ok(data.appCopy.aiOnboardingCopy[code].proactivityHint);
  for (const key of [
    'error.audio_backpressure',
    'error.worker_exited',
    'error.worker_recovery',
    'error.storage_recovery',
    'error.storage_recovery_hint',
    'error.storage_unavailable',
  ])
    assert.ok(data.catalog[code].labels[key]);
}
const editsContext = { currentMeetingDetail: { segments: [{ version: 'live', user_edited: 1 }] } };
runInNewContext(summaryFn('meetingHasUserEdits'), editsContext);
assert.equal(
  editsContext.meetingHasUserEdits(),
  true,
  'edited live segments must warn before refinement',
);
editsContext.currentMeetingDetail.segments[0].user_edited = 0;
assert.equal(editsContext.meetingHasUserEdits(), false);
const refinementCalls = [];
let confirmRefinement;
Object.assign(editsContext, {
  pinnedRefineModel: () => undefined,
  t: (key) => key,
  openConfirmation: (_title, _message, confirm) => {
    confirmRefinement = confirm;
  },
  startRefinement: (...args) => refinementCalls.push(args),
});
runInNewContext(summaryFn('refineWithSelectedModel'), editsContext);
for (const modelId of [undefined, 'same-model', 'different-model']) {
  editsContext.pinnedRefineModel = () => modelId;
  editsContext.currentMeetingDetail.segments[0].user_edited = 1;
  const before = refinementCalls.length;
  editsContext.refineWithSelectedModel(2);
  assert.equal(
    refinementCalls.length,
    before,
    'edits require confirmation even without a model change',
  );
  confirmRefinement();
  assert.deepEqual(refinementCalls.at(-1), [2, modelId]);
}
editsContext.currentMeetingDetail.segments[0].user_edited = 0;
editsContext.refineWithSelectedModel(undefined);
assert.deepEqual(refinementCalls.at(-1), [undefined, 'different-model']);

const clientStopContext = {
  window: {
    brevia: {
      meeting: {
        stop: async () => {
          throw new Error('offline');
        },
      },
    },
  },
  navigator: {},
  console,
};
runInNewContext(text(backendClient), clientStopContext);
const stoppingClient = clientStopContext.window.breviaClient;
stoppingClient.state.meeting = { id: 'retryable' };
stoppingClient.state.inputs = { mic: true };
stoppingClient.capture = { async stop() {} };
await assert.rejects(stoppingClient.stop(100), /offline/);
assert.equal(
  stoppingClient.state.meeting.id,
  'retryable',
  'backend stop failure must keep the meeting ID for retry',
);
clientStopContext.window.brevia.meeting.stop = async () => ({ id: 'retryable' });
await stoppingClient.stop(100);
assert.equal(stoppingClient.state.meeting, null);
const batchContext = {
  selectedMeetingKeys: new Set(),
  meetingSelectionMode: false,
  window: { brevia: { meeting: {} } },
  uiData: { meetings: [] },
  clearMeetingSelection() {},
  renderMeetingList() {},
};
runInNewContext(`async ${summaryFn('mutateMeetings')}`, batchContext);
let runningMutations = 0;
const deletedMeetings = [];
batchContext.window.brevia.meeting.delete = async ({ meeting_id }) => {
  assert.equal(runningMutations++, 0, 'destructive IPC requests must be sequential');
  await new Promise(setImmediate);
  runningMutations--;
  if (meeting_id === 'failed') throw new Error('disk disconnected');
  deletedMeetings.push(meeting_id);
};
const batchMeetings = Array.from({ length: 6 }, (_, id) => ({ id: String(id) }));
batchContext.uiData.meetings = [...batchMeetings];
await batchContext.mutateMeetings('delete', batchMeetings);
assert.equal(deletedMeetings.length, 6);
assert.equal(batchContext.uiData.meetings.length, 0);
batchContext.uiData.meetings = [{ id: 'done' }, { id: 'failed' }, { id: 'remaining' }];
await assert.rejects(
  batchContext.mutateMeetings('delete', [...batchContext.uiData.meetings]),
  /disk disconnected/,
);
assert.equal(
  batchContext.uiData.meetings.map(({ id }) => id).join(','),
  'failed',
  '继续处理后面的有效项，失败项保留供重试',
);
assert.equal([...batchContext.selectedMeetingKeys].join(','), 'failed');
assert.ok(batchContext.meetingSelectionMode);
for (const [code, data] of Object.entries(localeContext.window.BreviaLocaleData.catalog)) {
  for (const key of [
    '该设备仍有未完成的录音，请先结束并补传',
    '配对请求已过期',
    '电脑正在移动或清理数据，请稍后重试',
    '会议不存在',
  ]) {
    assert.ok(data.labels[key], `${code}: missing mobile error translation: ${key}`);
    if (code !== 'zh') assert.notEqual(data.labels[key], key);
  }
  const errors = { t: (key) => data.labels[key] || key, MODEL_DOWNLOAD_FAILURES: [] };
  runInNewContext(summaryFn('userFacingError'), errors);
  for (const key of [
    'error.tasks.running',
    'error.voice_sample_owned',
    'error.voice_sample_limit',
    'error.voice_duration_limit',
    'error.worker_exited',
    'error.audio_too_long',
  ]) {
    assert.notEqual(
      errors.userFacingError(`Operation: ${key}`),
      `Operation: ${key}`,
      `${code}: prefixed errors must be translated`,
    );
    assert.equal(errors.userFacingError(`Operation: ${key}`), `Operation: ${data.labels[key]}`);
  }
  assert.equal(
    errors.userFacingError('Details: error.unknown_code'),
    'Details: error.unknown_code',
  );
}
const onboardingClasses = new Set();
let onboardingNext = 0,
  onboardingDisposed = 0,
  onboardingTimer;
const dismissal = {
  BreviaMotion: { duration: () => 180 },
  onboardingPage: {
    dataset: {},
    classList: {
      contains: (name) => onboardingClasses.has(name),
      remove: (name) => onboardingClasses.delete(name),
      add: (name) => onboardingClasses.add(name),
    },
    remove() {
      this.removed = true;
    },
  },
  onboardingAiDemoTimer: null,
  onboardingSummaryDemoTimer: null,
  onboardingMotion: {
    destroy() {
      onboardingDisposed++;
    },
  },
  clearTimeout() {},
  clearInterval() {},
  breviaClient: null,
  fitTourWindow() {},
  window: {
    removeEventListener() {},
    setTimeout(callback) {
      onboardingTimer = callback;
    },
  },
};
runInNewContext(summaryFn('dismissOnboardingPage'), dismissal);
const firstDismissal = dismissal.dismissOnboardingPage(() => onboardingNext++);
const repeatedDismissal = dismissal.dismissOnboardingPage(() => onboardingNext++);
assert.equal(firstDismissal, repeatedDismissal, 'repeated dismissal has one awaitable completion');
await firstDismissal;
assert.equal(onboardingNext, 1, 'repeated clicks must not create duplicate onboarding pages');
assert.equal(onboardingDisposed, 1, 'leaving onboarding must dispose motion exactly once');
dismissal.dismissOnboardingPage(() => onboardingNext++);
assert.equal(onboardingNext, 1);
let finishNextStep;
const retainedPage = {
  dataset: {},
  remove() {
    this.removed = true;
  },
};
dismissal.onboardingPage = retainedPage;
const slowHandoff = dismissal.dismissOnboardingPage(
  () =>
    new Promise((resolve) => {
      finishNextStep = resolve;
    }),
);
await Promise.resolve();
assert.equal(
  retainedPage.removed,
  undefined,
  'slow preparation keeps the existing onboarding page visible',
);
assert.equal(retainedPage.inert, true, 'pending step cannot be submitted twice');
finishNextStep(false);
await slowHandoff;
assert.equal(retainedPage.removed, undefined, 'failed preparation retains the old page');
assert.equal(retainedPage.inert, false, 'failed preparation can be retried');
await dismissal.dismissOnboardingPage(() => {});
assert.equal(retainedPage.removed, true);
console.log('UI structure and behavior checks passed.');

// A second meeting cannot launch or clear the first meeting's progress.
const refineRequests = [];
let finishRefinement;
const refineRequestContext = {
  refinementBusyMeetingId: null,
  renderMeetingDetail() {},
  resumeReadyModelTasks() {},
  t: (key) => key,
  window: {
    brevia: {
      meeting: {
        refine(payload) {
          refineRequests.push(payload.meeting_id);
          return new Promise((resolve) => {
            finishRefinement = resolve;
          });
        },
      },
    },
  },
};
runInNewContext('async ' + summaryFn('requestRefinement'), refineRequestContext);
const firstRefinement = refineRequestContext.requestRefinement({ meeting_id: 'first' });
await assert.rejects(
  refineRequestContext.requestRefinement({ meeting_id: 'second' }),
  /error.tasks.running/,
);
assert.equal(refineRequestContext.refinementBusyMeetingId, 'first');
assert.deepEqual(refineRequests, ['first']);
finishRefinement({});
await firstRefinement;
assert.equal(refineRequestContext.refinementBusyMeetingId, null);
summaryContext.refinementBusyMeetingId = 'another';
const busyRefineMarkup = summaryContext.renderRefineStatus({ refineState: 'idle', language: 'zh' });
assert.doesNotMatch(busyRefineMarkup, /data-refine-action/);
assert.ok(busyRefineMarkup.includes(summaryContext.t('error.tasks.running')));

const refinementFailureActions = [];
let rejectRefinement;
const startRefinementContext = {
  window: { brevia: { meeting: { refine() {} } } },
  breviaClient: { state: { selectedMeetingId: 'first' } },
  refinementBusyMeetingId: null,
  uiData: { detail: { language: 'zh', refineState: 'idle' } },
  refinementCard: { dataset: { meetingId: 'second' } },
  requestRefinement: () =>
    new Promise((_, reject) => {
      rejectRefinement = reject;
    }),
  renderMeetingDetail() {},
  hideRefinementProgress() {
    refinementFailureActions.push('hidden');
  },
  showToast() {},
  t: (key) => key,
};
const startRefinementSource = summaryAppSource.slice(
  summaryAppSource.indexOf('const startRefinement ='),
  summaryAppSource.indexOf('/** 用户在这次精修里'),
);
runInNewContext(startRefinementSource + '\nstartRefinement();', startRefinementContext);
startRefinementContext.breviaClient.state.selectedMeetingId = 'second';
rejectRefinement(new Error('busy'));
await Promise.resolve();
assert.deepEqual(
  refinementFailureActions,
  [],
  'a rejected request cannot hide another meeting’s progress',
);
assert.equal(
  startRefinementContext.uiData.detail.refineState,
  'refining',
  'a late failure cannot reset another meeting’s state',
);

const mobileRow = componentContext.renderMeetingRow(
  { id: 'mobile', title: 'Phone', meta: '', tags: ['手机录音', '讨论'], status: {} },
  0,
);
assert.match(mobileRow, /<h2>Phone<span class="meeting-source">/);
assert.doesNotMatch(mobileRow, /class="tag">手机录音/);
assert.match(mobileRow, /class="tag">讨论/);

// 密集收尾事件必须复用草稿节点；其他会议和只覆盖前半段的 final 不得清空当前草稿。
const draftHandlers = {};
const draftClasses = new Set(['is-draft', 'is-active']);
const draftText = { textContent: 'first' };
const draftTime = { textContent: '00:00' };
let removedDrafts = 0;
const stableDraft = {
  dataset: { draftTrack: 'mic', start: '0', end: '2' },
  classList: { contains: (name) => draftClasses.has(name) },
  querySelector: (selector) => (selector === 'time' ? draftTime : draftText),
  remove() {
    removedDrafts++;
  },
};
const activeDrafts = new Map([['mic', stableDraft]]);
const draftContext = {
  correctionDraft: null,
  correctionPanel: { hidden: true },
  window: {
    brevia: {
      on: (name, handler) => {
        draftHandlers[name] = handler;
      },
    },
  },
  meetingActive: true,
  breviaClient: { state: { meeting: { id: 'phone' } } },
  draftSegments: activeDrafts,
  transcript: { lastElementChild: stableDraft, querySelectorAll: () => [] },
  followLiveTranscript: false,
  isAtLiveBottom: () => false,
  formatMeetingTime: () => '00:00',
  renderLiveEvent() {},
};
const draftStart = text(app).indexOf("  window.brevia.on('transcript.final',");
const draftEnd = text(app).indexOf("  window.brevia.on('transcript.settled',", draftStart);
runInNewContext(text(app).slice(draftStart, draftEnd), draftContext);
const draftPayload = {
  meeting_id: 'phone',
  track: 'mic',
  start_ms: 0,
  end_ms: 4000,
  text: 'first and second',
};
draftHandlers['transcript.draft'](draftPayload);
draftHandlers['transcript.draft'](draftPayload);
assert.equal(activeDrafts.get('mic'), stableDraft);
assert.equal(draftText.textContent, 'first and second');
draftHandlers['transcript.draft']({ ...draftPayload, meeting_id: 'other', text: '' });
assert.equal(removedDrafts, 0);
draftHandlers['transcript.final']({ ...draftPayload, end_ms: 2000 });
assert.equal(removedDrafts, 0);
draftHandlers['transcript.final'](draftPayload);
assert.equal(removedDrafts, 1);
assert.equal(activeDrafts.size, 0);

// 配对刷新途中关闭浮窗，返回的旧请求不能重新打开它。
const mobileConnectionSource = await readFile('mobile-connection.js', 'utf8');
const mobilePairFunction = mobileConnectionSource.match(
  /  (async function pair\([\s\S]*?)(?=  async function render)/,
);
assert.ok(mobilePairFunction);
let finishPairRefresh;
let pairRefreshCalls = 0;
const refreshDisplays = [];
const pairRefreshContext = {
  pairingBusy: false,
  pairClosing: null,
  pairDialog: { open: true, querySelector: () => ({ textContent: '' }) },
  api: {
    pair: () => {
      pairRefreshCalls++;
      return new Promise((resolve) => {
        finishPairRefresh = resolve;
      });
    },
  },
  render: () => refreshDisplays.push('render'),
  showPairDialog: () => refreshDisplays.push('open'),
};
runInNewContext(mobilePairFunction[1], pairRefreshContext);
const pendingPairRefresh = pairRefreshContext.pair(true);
assert.equal(pairRefreshContext.pairingBusy, true);
pairRefreshContext.pairClosing = Promise.resolve();
finishPairRefresh({});
await pendingPairRefresh;
assert.equal(pairRefreshContext.pairingBusy, false);
assert.deepEqual(refreshDisplays, [], '关闭期间不重绘或重新打开配对浮窗');
pairRefreshContext.pairClosing = null;
pairRefreshContext.pairDialog.open = false;
await pairRefreshContext.pair(true);
assert.equal(pairRefreshCalls, 1, '关闭浮窗后不自动生成新配对码');

const diskUsageContext = {
  systemDiskUsage: { total: 1000, used: 700, free: 270 },
  escapeHtml: summaryContext.escapeHtml,
  t: (value) => value,
  formatBytes: (value) => `${value} B`,
};
runInNewContext(summaryFn('renderSystemDiskUsage'), diskUsageContext);
assert.match(diskUsageContext.renderSystemDiskUsage(), /aria-valuenow="70"/);
assert.match(diskUsageContext.renderSystemDiskUsage(), /700 B \/ 1000 B/);
assert.match(diskUsageContext.renderSystemDiskUsage(), /可用空间 270 B/);
diskUsageContext.systemDiskUsage = null;
assert.match(diskUsageContext.renderSystemDiskUsage(), /系统磁盘信息暂不可用/);
assert.doesNotMatch(diskUsageContext.renderSystemDiskUsage(), /progressbar/);

// 两种清空操作仅更新已有容量节点；失败时保留页面和旧用量。
const storageUsageLabels = { children: [{ textContent: '' }, { textContent: '' }] };
const storageSizeLabels = [{ textContent: '' }, { textContent: '' }];
const storageClearCalls = [];
const storagePlaybackEvents = [];
const storageClearToasts = [];
let storageClearAction;
let storageClearFailure = false;
let storageFolderRefreshes = 0;
const storageClearContext = {
  currentMeetingDetail: { id: 'cleared' },
  breviaClient: { state: { selectedMeetingId: 'cleared' } },
  meetingCacheKey: 'brevia-meetings-v1',
  localStorage: { removeItem: (key) => storagePlaybackEvents.push(`forget:${key}`) },
  playbackStarted: true,
  playerAudio: {
    pause: () => storagePlaybackEvents.push('pause'),
    removeAttribute: (name) => storagePlaybackEvents.push(`remove:${name}`),
    load: () => storagePlaybackEvents.push('load'),
  },
  renderMiniPlayback: () => storagePlaybackEvents.push('mini'),
  refreshBackendMeetings: async () => storagePlaybackEvents.push('refresh'),
  storageUsage: { meetings: 100, models: 200 },
  locale: 'zh',
  modalCopy: {
    zh: {
      storage: {
        items: [
          ['会议', ''],
          ['模型', ''],
        ],
      },
    },
  },
  formatBytes: (value) => `${value} B`,
  document: { querySelector: () => storageUsageLabels },
  settingsFolders: { querySelectorAll: () => storageSizeLabels },
  t: (value) => value,
  openConfirmation: (_title, _detail, action) => (storageClearAction = action),
  renderModal: () => assert.fail('清空不能重建存储页'),
  refreshSettingsFolderRows: () => storageFolderRefreshes++,
  showToast: (message) => storageClearToasts.push(message),
  window: {
    brevia: {
      storage: {
        clear: async ({ partition }) => {
          storagePlaybackEvents.push(`clear:${partition}`);
          storageClearCalls.push(partition);
          if (storageClearFailure) throw Error('清空失败');
          return { ...storageClearContext.storageUsage, [partition]: 0 };
        },
      },
    },
  },
};
const storageClickStart = summaryAppSource.indexOf(
  "  const clearStorage = event.target.closest('[data-clear-storage]');",
);
const storageClickEnd = summaryAppSource.indexOf(
  "  if (event.target.closest('[data-cleanup-storage]'))",
  storageClickStart,
);
runInNewContext(
  `${summaryFn('updateStorageUsage')}\nasync function clearStorageClick(event) {${summaryAppSource.slice(storageClickStart, storageClickEnd)}}`,
  storageClearContext,
);
for (const partition of ['meetings', 'models']) {
  await storageClearContext.clearStorageClick({
    target: { closest: () => ({ dataset: { clearStorage: partition } }) },
  });
  await storageClearAction();
  assert.equal(storageClearContext.storageUsage[partition], 0);
}
assert.deepEqual(storageClearCalls, ['meetings', 'models']);
assert.deepEqual(storagePlaybackEvents, [
  'pause',
  'remove:src',
  'load',
  'mini',
  'clear:meetings',
  'forget:brevia-meetings-v1',
  'refresh',
  'clear:models',
]);
assert.equal(storageClearContext.playbackStarted, false);
assert.equal(storageClearContext.currentMeetingDetail, null);
assert.equal(storageClearContext.breviaClient.state.selectedMeetingId, null);
assert.equal(storageUsageLabels.children[0].textContent, 'Brevia · 0 B');
assert.equal(storageUsageLabels.children[1].textContent, '会议 · 0 B　模型 · 0 B');
assert.deepEqual(
  storageSizeLabels.map((label) => label.textContent),
  ['0 B', '0 B'],
);
assert.equal(storageFolderRefreshes, 2);
storageClearFailure = true;
await storageClearAction();
assert.equal(storageFolderRefreshes, 2, '失败不刷新或重建当前页');
assert.equal(storageClearToasts.at(-1), '清空失败');

// 导出浮窗刷新不重选用户取消的项；下一次真正打开仍按当前标签初始化。
const exportRefreshBody = { dataset: { contentKind: 'export' } };
const exportRefreshContext = {
  locale: 'en',
  activeModal: 'export',
  activeView: 'detail',
  detailActiveTab: 'summary',
  exportHubCopy: { en: { title: 'Export' } },
  exportSelection: { notes: null, transcript: 'txt' },
  exportDefaultFormat: { notes: 'md', transcript: 'srt' },
  exportContentMeta: () => [{ content: 'notes' }, { content: 'transcript' }],
  exportHubHtml: () => '',
  replaceModalBody: () => {},
  updateExportBuilderState: () => {},
  t: (value) => value,
  settingsModal: {
    hidden: false,
    querySelector: (selector) => (selector === '.modal-body' ? exportRefreshBody : {}),
  },
};
runInNewContext(summaryFn('renderExportModal'), exportRefreshContext);
exportRefreshContext.renderExportModal();
assert.equal(exportRefreshContext.exportSelection.notes, null);
assert.equal(exportRefreshContext.exportSelection.transcript, 'txt');
exportRefreshContext.settingsModal.hidden = true;
exportRefreshContext.renderExportModal();
assert.equal(exportRefreshContext.exportSelection.notes, 'md');
assert.equal(exportRefreshContext.exportSelection.transcript, null);

// 匹配按出现位置选择；英文大小写、正则字符和表情都保持字面语义。
const correctionSource = await readFile('transcript-corrections.js', 'utf8');
const matchFunction = correctionSource.slice(
  correctionSource.indexOf('function correctionMatches('),
  correctionSource.indexOf('function correctionMeetingId('),
);
const findMatches = runInNewContext(`${matchFunction}; correctionMatches`, {
  textMatchOffsets: utilsContext.textMatchOffsets,
  correctionPreviewLimit: 200,
});
const literalMatches = findMatches(
  [
    { id: 'a', text: '😀北威亚和北威亚' },
    { id: 'b', text: 'Brevia brevia' },
  ],
  '北威亚',
);
assert.equal(literalMatches.length, 2);
assert.equal(literalMatches[0].offset, 2);
assert.equal(literalMatches[1].occurrence, 1);
assert.equal(findMatches([{ text: 'a.a aa' }], 'a.').length, 1);
assert.equal(findMatches([{ text: 'Brevia brevia' }], 'Brevia').length, 1);
assert.equal(findMatches([{ text: 'aaaa' }], 'aa').length, 2);
assert.equal(findMatches([{ text: 'abc' }], '').length, 0);

const correctedTextFunction = text(components).slice(
  text(components).indexOf('function renderCorrectedTranscript('),
  text(components).indexOf('function renderTranscriptSegment('),
);
const renderCorrectionText = runInNewContext(
  `${correctedTextFunction}; renderCorrectedTranscript`,
  { escapeHtml: summaryContext.escapeHtml },
);
assert.equal(
  renderCorrectionText('Brevia and Brevia', 'Brevia'),
  '<mark class="correction-saved-word">Brevia</mark> and <mark class="correction-saved-word">Brevia</mark>',
);
assert.ok(!renderCorrectionText('<script>x</script>', '<script>').includes('<script>'));

// 保存期间锁定整张表单；成功和失败都恢复控件原有可用状态。
{
  const source = text(app);
  const start = source.indexOf("settingsModal.addEventListener('submit', async (event) => {");
  const end = source.indexOf("  if (event.target.matches('.speaker-profile-rename-form'))", start);
  const status = { outerHTML: '' };
  const fields = [{ disabled: false }, { disabled: false }, { disabled: true }];
  const form = {
    isConnected: true,
    elements: fields,
    matches: () => true,
    reportValidity: () => true,
    querySelector: (selector) => (selector === '.save-state' ? status : fields[0]),
  };
  let submit, resolveSave, rejectSave;
  const context = {
    structuredClone,
    settingsModal: {
      classList: { contains: () => true },
      addEventListener: (_, callback) => {
        submit = callback;
      },
    },
    advancedSettings: { settings: { vad: { threshold: 0.5 } } },
    FormData: class {
      forEach(callback) {
        callback('0.6', 'vad.threshold');
      }
    },
    validateAdvancedSettings() {},
    renderSaveState: (state) => state,
    showToast() {},
    t: (key) => key,
    window: {
      brevia: {
        advancedSettings: {
          save: () =>
            new Promise((resolve, reject) => {
              resolveSave = resolve;
              rejectSave = reject;
            }),
        },
      },
    },
  };
  runInNewContext(summaryFn('completeSettingsSave') + source.slice(start, end) + '});', context);
  let pending = submit({ target: form, preventDefault() {} });
  assert.ok(fields.every((field) => field.disabled));
  resolveSave();
  await pending;
  assert.deepEqual(
    fields.map((field) => field.disabled),
    [false, false, true],
  );
  assert.equal(status.outerHTML, 'saved');
  pending = submit({ target: form, preventDefault() {} });
  rejectSave(new Error('disk error'));
  await pending;
  assert.deepEqual(
    fields.map((field) => field.disabled),
    [false, false, true],
  );
  assert.equal(status.outerHTML, 'failed');
}

// 压缩详情仍提供原始稿；当前稿不被原稿切换覆盖。
assert.ok(text(meetingDetail).includes('meeting.original_segments'));
{
  const source = text(components);
  const start = source.indexOf('  const translationLine = translation');
  const end = source.indexOf('  // 编辑框', start);
  const html = runInNewContext(source.slice(start, end) + '\ntranslationLine', {
    translation: 'outdated amount',
    translationStale: true,
    t: (key) => key,
  });
  assert.ok(html.includes('译文 · 待更新'));
  assert.ok(!html.includes('outdated amount'));
}

// 动态手机服务错误也必须在每种桌面语言中有词条。
{
  const source = String(await readFile('../electron/mobile-server.js'));
  const data = {};
  runInNewContext(text(i18nData), { window: data });
  const labels = data.BreviaLocaleData.catalog;
  const errors = [
    ...source.matchAll(
      /(?:fail\(\d+,\s*|new Error\(|captureError:\s*|error:\s*)(['"])([^'"\n]*[\u3400-\u9fff][^'"\n]*)\1/g,
    ),
  ];
  for (const [, , key] of errors) {
    for (const code of Object.keys(labels)) assert.ok(labels[code].labels[key], `${code}: ${key}`);
  }
}

// 实时重新翻译显式携带会议；详情切换和失败不能更新另一场的界面。
{
  const calls = [],
    applied = [];
  const live = { id: 'live', segments: [{ id: 'line', text: 'live text' }] };
  const context = {
    currentMeetingDetail: { id: 'previous' },
    latestTranscriptSegments: (meeting) => ({ segments: meeting.segments }),
    uiData: { detail: {} },
    renderMeetingDetail: () => assert.fail('实时翻译不能重建上一场详情'),
    mapWithConcurrency: async (items, _limit, fn) =>
      Promise.all(items.map(async (item) => ({ status: 'fulfilled', value: await fn(item) }))),
    generateSegmentTranslation: async (segment, target) => calls.push([segment.id, target]),
    showTranslationProgress() {},
    showToast() {},
    t: (key) => key,
    applyCorrectionMeeting: (meeting) => applied.push(meeting.id),
    window: {
      brevia: { translation: {}, meeting: { get: async ({ meeting_id }) => ({ id: meeting_id }) } },
    },
  };
  runInNewContext('async ' + summaryFn('translateLatestTranscript'), context);
  await context.translateLatestTranscript('en', live);
  assert.deepEqual(calls, [['line', 'en']]);
  assert.deepEqual(applied, ['live']);
  assert.equal(context.uiData.detail.translationPending, undefined);
}

// 预览在匹配时停止，既不建立完整结果数组，也不默认提交超过边界的整份文档。
{
  const matches = findMatches([{ id: 'notes', text: 'a '.repeat(10000) }], 'a');
  assert.equal(matches.length, 200);
  assert.equal(matches.limited, true);
  assert.equal(findMatches([{ id: 'notes', text: 'a'.repeat(200) }], 'a').limited, undefined);
  let focused = 0,
    keyboard = false;
  const context = { document: { documentElement: { hasAttribute: () => keyboard } } };
  runInNewContext(summaryFn('focusForKeyboard'), context);
  const button = { focus: () => focused++ };
  context.focusForKeyboard(button);
  assert.equal(focused, 0);
  keyboard = true;
  context.focusForKeyboard(button);
  assert.equal(focused, 1);
}
// 编辑器查找与替换共同使用区分大小写的字面规则。
{
  const source = text(components);
  const start = source.indexOf('  function selectFindMatch(');
  const end = source.indexOf('  /** 切换富文本', start);
  const input = {
    value: 'Brevia brevia',
    selectionEnd: 0,
    focus() {},
    setSelectionRange(start, end) {
      this.selected = [start, end];
    },
  };
  const context = {
    input,
    mode: 'markdown',
    findInput: { value: 'brevia' },
    replaceInput: { value: 'NEW' },
    editor: { innerHTML: '' },
    renderMarkdown: (value) => value,
    onInput: null,
  };
  runInNewContext(source.slice(start, end) + '\nselectFindMatch(); replaceAll();', context);
  assert.deepEqual(input.selected, [7, 13]);
  assert.equal(input.value, 'Brevia NEW');
}
// 动态警告通过错误码进入与其他错误相同的本地化路径。
{
  for (const code of Object.keys(localeContext.window.BreviaLocaleData.catalog))
    assert.ok(
      localeContext.window.BreviaLocaleData.appCopy.stageLabels['error.transcript_rule_limit'][
        code
      ],
    );
  let warn;
  const source = text(app);
  const start = source.indexOf("  window.brevia.on('worker.warning'");
  const end = source.indexOf("  window.brevia.on('worker.error'", start);
  const messages = [];
  runInNewContext(source.slice(start, end), {
    window: { brevia: { on: (_name, callback) => (warn = callback) } },
    t: (key) => localeContext.window.BreviaLocaleData.appCopy.stageLabels[key].en,
    showToast: (text) => messages.push(text),
  });
  warn({ code: 'error.transcript_rule_limit', message: '中文诊断' });
  assert.match(messages[0], /original transcript was kept/);
}
