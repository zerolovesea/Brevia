const views = [...document.querySelectorAll('.view')];
const crumb = document.querySelector('#crumb');
const toast = document.querySelector('#toast');
const languageToggle = document.querySelector('#language-toggle');
const languageOptions = document.querySelector('#language-options');
const themeToggle = document.querySelector('#theme-toggle');
const miniMeeting = document.querySelector('#mini-meeting');
const miniPlayback = document.querySelector('#mini-playback');
const miniPlaybackSeek = document.querySelector('#mini-playback-seek');
const miniPlaybackToggle = document.querySelector('#mini-playback-toggle');
const miniPlaybackClose = document.querySelector('#mini-playback-close');
const miniTitle = document.querySelector('#mini-title');
const miniTimer = document.querySelector('#mini-timer');
const refinementCard = document.querySelector('#refinement-progress');
const refinementPercent = document.querySelector('#refinement-percent');
const refinementBar = document.querySelector('#refinement-bar');
const taskCards = document.querySelector('#task-cards');
const stackableTaskCardSelector = ':is(.processing-card, .mini-meeting, .mini-playback, .software-update-notice):not([hidden])';
function syncTaskCardStack(active) {
  const cards = [...taskCards.children].filter((card) => card.matches(stackableTaskCardSelector));
  active ||= cards.at(-1);
  const completed = Number(active?.dataset.completed);
  const total = Number(active?.dataset.total);
  document.querySelector('.app-shell')?.style.setProperty('--task-progress', total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0);
  taskCards.style.setProperty('--task-card-back-count', Math.max(0, cards.length - 1));
  cards.forEach((card, index) => {
    const isBack = card !== active;
    card.classList.add('task-card-stack-item');
    card.style.setProperty('--task-card-index', index);
    card.style.setProperty('--task-card-depth', Math.min(3, cards.length - 1 - index));
    card.style.zIndex = index + 1;
    card.classList.toggle('is-task-card-back', isBack);
    if (isBack) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', card.querySelector('.task-card-heading p, :scope > span, :scope > strong')?.textContent.trim() || 'Task');
    } else {
      card.removeAttribute('tabindex');
      card.removeAttribute('role');
      card.removeAttribute('aria-label');
    }
  });
}
function activateTaskCard(card) {
  if (!card?.matches(':is(.processing-card, .mini-meeting, .mini-playback, .software-update-notice):not([hidden])') || card.classList.contains('task-card-leave')) return;
  taskCards.append(card);
  syncTaskCardStack(card);
}
new MutationObserver(() => syncTaskCardStack()).observe(taskCards, { childList: true, attributes: true, attributeFilter: ['hidden'], subtree: true });
function taskCardControls() { return `<span class="task-card-actions"><button class="task-card-close" data-minimize-task-card type="button" aria-label="${t('最小化')}">—</button><button class="task-card-close" data-dismiss-task-card type="button" aria-label="${t('关闭')}">×</button></span>`; }
function taskPauseControl() { return `<button class="task-card-close" data-pause-task type="button" aria-label="${t('暂停')}" disabled>Ⅱ</button>`; }
function setTaskCardTask(card, task, meetingId) {
  card.dataset.task = task;
  card.dataset.meetingId = meetingId;
  card.dataset.paused = 'false';
  const button = card.querySelector('[data-pause-task]');
  button.disabled = false;
  button.textContent = 'Ⅱ';
  button.setAttribute('aria-label', t('暂停'));
}
function setTaskCardPaused(card, paused) {
  if (!card) return;
  card.dataset.paused = String(paused);
  const button = card.querySelector('[data-pause-task]');
  button.textContent = paused ? '▶' : 'Ⅱ';
  button.setAttribute('aria-label', paused ? t('继续') : t('暂停'));
}
function finishTaskCard(card) {
  delete card.dataset.task;
  delete card.dataset.meetingId;
  const button = card.querySelector('[data-pause-task]');
  button.disabled = true;
}
function toggleTaskCardMinimized(card, button) {
  card.classList.add('task-card-resizing');
  card.classList.toggle('is-minimized');
  button.textContent = card.classList.contains('is-minimized') ? '□' : '—';
  window.setTimeout(() => card.classList.remove('task-card-resizing'), 180);
}
function enterTaskCard(card) {
  card.classList.remove('task-card-leave');
  activateTaskCard(card);
  card.classList.add('task-card-enter');
  window.setTimeout(() => card.classList.remove('task-card-enter'), 220);
}
function dismissTaskCard(card, done = () => card.remove()) {
  if (!card || card.classList.contains('task-card-leave')) return;
  card.classList.remove('task-card-enter');
  card.classList.add('task-card-leave');
  window.setTimeout(() => {
    if (card.classList.contains('task-card-leave')) done();
  }, 220);
}
function revealTaskCard(card) {
  const wasHidden = card.hidden;
  const wasLeaving = card.classList.contains('task-card-leave');
  card.hidden = false;
  if (wasHidden || wasLeaving) { taskCards.append(card); enterTaskCard(card); }
}
const { onboardingStorageCopy, aiNotePromptCopy, storageCleanupCopy, exportHubCopy, appCopy: { themeLabels, updateLabels, modalCopy, modelLabels, summaryModelCopy, speakerProfileCopy, voiceFeaturesCopy, aiAssistCopy, whatsNewCopy } } = window.BreviaLocaleData;
const whatsNewLog = window.BreviaChangelog;
if (new URLSearchParams(location.search).has('resetOnboarding')) localStorage.removeItem('brevia-onboarding-complete');
let theme = localStorage.getItem('brevia-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const appOpenedAt = Date.now();
window.addEventListener('pagehide', () => { void window.brevia?.metrics.record({ app_duration_ms: Date.now() - appOpenedAt }); });
const scrollingTimers = new WeakMap();
document.addEventListener('scroll', (event) => {
  const scroller = event.target instanceof Element ? event.target : document.scrollingElement;
  if (!scroller) return;
  scroller.classList.add('is-scrolling');
  clearTimeout(scrollingTimers.get(scroller));
  scrollingTimers.set(scroller, setTimeout(() => scroller.classList.remove('is-scrolling'), 2000));
}, true);
const liveSegments = new Map();
// 正在攒的段落（transcript.draft）渲染出的临时行，按音轨保存：后端每轨最多只有一段在攒，
// 因此它是一条会被就地替换的行，正式段落提交后由空文本的 draft 事件撤下。
const draftSegments = new Map();
const clearDraftSegments = () => {
  draftSegments.forEach((element) => element.remove());
  draftSegments.clear();
};
// 实时字幕段落元数据（text/start_ms/speaker），供「加入笔记」等本地规则辅助读取。
const liveSegmentData = new Map();
const maxLiveSegments = 500;
let followLiveTranscript = true;
let toastTimer;
let switchingLanguage = false;
// 镜像当前会议的实时配置，使实时面板控件能够反映（并驱动）热切换。
let liveConfig = { language: 'auto', target_language: null, refined_model_id: null };
// —— 设备能力（弱机检测）——
let deviceReport = null;
/** 本机是否属于弱机（CPU 推理且核心少），前端据此建议更小模型或在线 API。@returns {boolean} */
function deviceIsWeak() {
  return Boolean(deviceReport?.weak);
}
// 此会议打开了哪些捕获轨道；此处不存在的轨道无法实时切换。
let translationAllowed = false;
let latestLiveSegmentId = null;
// 详情页状态：当前字幕视图（精修/原始）、激活 tab、编辑前笔记（取消时恢复）。
let detailNotesBeforeEdit = '';
const translatedNodes = [];
let floatingCaptionMode = null;
let floatingCaptionLocale = locale;
/** 解析当前语言环境的显示标签。@param {string} key 中文源标签。@returns {string} 本地化后的标签或原始键。*/
/** 解析当前语言环境的临时消息。@param {string} key 消息标识符。@returns {string} 本地化后的消息。*/
const message = (key) => catalog[locale].messages[key];
/** 当前机器的推荐设置 tag 标记。@param {boolean} show 是否显示。@returns {string} */
const recommendTag = (show) => show ? `<span class="model-library-tags recommend-tags"><span class="model-library-installed">${escapeHtml(t('当前机器的推荐设置'))}</span></span>` : '';
renderStaticViews();
const speakerProfileCard = document.createElement('section');
speakerProfileCard.className = 'settings-card';
speakerProfileCard.innerHTML = '<h2></h2><p></p><button class="secondary" type="button"></button>';
document.querySelector('#advanced-settings').before(speakerProfileCard);
const updateCard = document.createElement('section');
updateCard.className = 'update-card';
updateCard.innerHTML = '<div><h2></h2><p></p></div><span class="update-actions"><button class="update-notes" data-open-whats-new type="button"></button><button class="update-button" type="button"></button></span>';
document.querySelector('#settings-view .settings-grid').append(updateCard);
const updateTitle = updateCard.querySelector('h2');
const updateDescription = updateCard.querySelector('p');
const updateButton = updateCard.querySelector('button.update-button');
const updateNotesButton = updateCard.querySelector('[data-open-whats-new]');
const updateNotice = document.createElement('aside');
updateNotice.className = 'software-update-notice';
updateNotice.hidden = true;
updateNotice.innerHTML = '<span></span><i hidden aria-hidden="true"><b></b></i><button type="button"></button>';
taskCards.append(updateNotice);
const updateNoticeText = updateNotice.querySelector('span');
const updateNoticeProgress = updateNotice.querySelector('i');
const updateNoticeProgressBar = updateNoticeProgress.querySelector('b');
const updateNoticeButton = updateNotice.querySelector('button');
let updateAvailable = false;
let updateVersion = '';
let updateBusy = false;
let updateDownloadProgress = null;
let installedAppVersion = '—';
const appVersion = document.querySelector('#app-version');
document.querySelectorAll('.startup-credit, .app-credit').forEach((credit) => credit.remove());
let speakerProfiles = [];
const modelSize = (modelId) => modelCatalog.find((model) => model.id === modelId)?.size_bytes || 0;
// 识别模型文案（8 语种）由 asr-copy.js 提供。必须在文件靠前的位置声明：
// renderPrepareSelects 在启动初始化时就会被调用，而它要读 asrCopy。
const asrCopy = window.BreviaAsrCopy || {};
// 模型选择的纯逻辑（model-selection.js）：排序、语言支持、默认模型、库分组全部在那里，
// 这里只做「把全局状态传进去」的薄包装，使同一份规则既能被 app 使用，也能被测试用合成
// 清单直接跑边界。
const modelSelection = window.BreviaModelSelection || {};
const modelLibraryMetaCopy = window.BreviaLocaleData.appCopy.modelLibraryMetaCopy;
// 内置纪要模型介绍：团队背景、会议用途与本地运行要求。
// 按模型 id 与语言环境索引，与模型库共用。
const builtinModelIntro = window.BreviaLocaleData.appCopy.builtinModelIntro;
/** 渲染一个评级维度的 3 级质量/速度刻度。@param {string} label 本地化的维度标签。@param {number} level 等级 1-3。@param {string} tierWord 本地化的等级名称。@returns {string} */
function ratingScale(label, level, tierWord) {
  const dots = [1, 2, 3].map((step) => `<i${step <= level ? ' class="on"' : ''}></i>`).join('');
  return `<span class="model-library-rating"><small>${escapeHtml(label)}</small><b>${escapeHtml(tierWord)}</b><span class="rating-scale" aria-hidden="true">${dots}</span></span>`;
}
/** 渲染模型库卡片的质量/速度刻度。档位直接取清单的 speed / quality（1..3）。
 *
 * 这里曾经另有一张 ``modelRatings`` 表按 id 硬编码同样的档位，且与清单不一致
 * （例如 qwen3-asr 的 speed 在两边分别是 3 和 2）。同一张模型卡在模型库（读清单）与
 * 功能设置（读那张表）里因此可能显示不同的档位。清单已经是唯一事实来源。
 * @param {object|undefined} model 模型清单项。@returns {string} 评级刻度标记。
 */
function renderModelLibraryRatings(model) {
  if (!model || (!model.quality && !model.speed)) return '';
  const copy = modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en;
  const level = (value) => Math.max(1, Math.min(3, Number(value) || 1));
  const quality = level(model.quality);
  const speed = level(model.speed);
  return `<div class="model-library-ratings">${ratingScale(copy.quality, quality, copy.qualityTiers[quality - 1])}${ratingScale(copy.speed, speed, copy.speedTiers[speed - 1])}</div>`;
}
// 模型说明只陈述事实：谁发布、什么时候、覆盖哪些语言、体积与速度特点。不做
// 「适合作为…」「日常选择」这类推荐性判断——模型选择由用户在模型库和会议设置里
// 自己做，界面文字只负责把差异讲清楚。
const modelLibraryBackground = window.BreviaLocaleData.appCopy.modelLibraryBackground;
function modelLibraryDescription(model, fallback) {
  return builtinModelIntro[model?.id]?.[locale] || builtinModelIntro[model?.id]?.en
    || modelLibraryBackground[locale]?.[model?.id] || modelLibraryBackground.en[model?.id] || fallback;
}
let expandedSpeakerProfileId = null;
let addingSampleProfileId = null;
let editingSpeakerProfileId = null;
const speakerSamples = new Map();
const speakerSampleAudio = new Audio();
speakerSampleAudio.addEventListener('ended', () => {
  if (speakerSampleAudio._button) speakerSampleAudio._button.textContent = '▶';
});
function renderSpeakerProfileCard() {
  const copy = speakerProfileCopy[locale] || speakerProfileCopy.en;
  speakerProfileCard.querySelector('h2').textContent = copy.title;
  speakerProfileCard.querySelector('p').textContent = copy.intro;
  speakerProfileCard.querySelector('button').textContent = copy.title;
}
/** 根据当前语言环境和可用性状态渲染浮动更新通知。@returns {void} */
function updateCopy() { return updateLabels[locale] || { ...updateLabels.en, title: t('软件更新'), action: t('检查更新') }; }
function currentVersionLabel() { const labels = window.BreviaLocaleData.appCopy.currentVersionLabels; return labels[locale] || labels.en; }
function availableUpdateLabel() { return updateVersion ? updateCopy().available.replace('0.2.0', updateVersion) : updateCopy().available; }
function availableUpdateActionLabel() { return updateVersion ? updateCopy().update.replace('0.2.0', updateVersion) : updateCopy().update; }
function renderUpdateNotice() {
  const copy = updateCopy();
  const progress = updateDownloadProgress && Math.max(0, Math.min(100, updateDownloadProgress.percent || 0));
  updateNoticeText.textContent = progress === null ? availableUpdateLabel() : `${copy.downloading || '正在下载'} ${Math.round(progress)}%`;
  updateNoticeProgress.hidden = progress === null;
  updateNoticeProgressBar.style.transform = `scaleX(${(progress || 0) / 100})`;
  updateNoticeButton.textContent = progress === null ? copy.floating : copy.updating;
  updateNoticeButton.disabled = updateBusy;
  const wasHidden = updateNotice.hidden;
  updateNotice.hidden = !updateAvailable;
  if (updateAvailable && wasHidden) { taskCards.append(updateNotice); enterTaskCard(updateNotice); }
}
/** 根据当前语言环境和可用性状态渲染设置页面的更新操作。@returns {void} */
function renderUpdateButton() {
  const copy = updateCopy();
  updateTitle.textContent = copy.title;
  updateNotesButton.textContent = (whatsNewCopy[locale] || whatsNewCopy.en).view;
  if (updateDownloadProgress) {
    const percent = Math.round(updateDownloadProgress.percent);
    const transferred = formatBytes(updateDownloadProgress.transferred);
    const total = formatBytes(updateDownloadProgress.total);
    updateDescription.textContent = `${copy.downloading || '正在下载'} ${percent}% · ${transferred} / ${total}`;
  } else {
    updateDescription.textContent = updateAvailable ? availableUpdateLabel() : `${currentVersionLabel()} ${installedAppVersion}`;
  }
  updateButton.textContent = updateDownloadProgress ? `${copy.downloading || '正在下载'} ${Math.round(updateDownloadProgress.percent)}%` : updateBusy ? (updateAvailable ? copy.updating : copy.checking) : updateAvailable ? availableUpdateActionLabel() : copy.action;
  updateButton.disabled = updateBusy;
}
// 纪要供应商固定为这六项。请求地址由 summaryProviderPresets 派生，只有两个自定义
// 供应商才向用户暴露地址输入框。
const summaryProviders = ['built-in', 'claude', 'openai', 'openrouter', 'custom-openai', 'custom-claude'];
const summaryProviderPresets = {
  'built-in': { format: 'openai', endpoint: '', needsKey: false, needsEndpoint: false, model: '' },
  claude: { format: 'claude', endpoint: 'https://api.anthropic.com', needsKey: true, needsEndpoint: false, model: 'claude-sonnet-4-5' },
  openai: { format: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', needsKey: true, needsEndpoint: false, model: 'gpt-4.1-mini' },
  openrouter: { format: 'openai', endpoint: 'https://openrouter.ai/api/v1/chat/completions', needsKey: true, needsEndpoint: false, model: 'openai/gpt-4.1-mini' },
  'custom-openai': { format: 'openai', endpoint: '', needsKey: true, needsEndpoint: true, model: '' },
  'custom-claude': { format: 'claude', endpoint: '', needsKey: true, needsEndpoint: true, model: '' },
};
function summaryProviderLabel(provider) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  return copy.providers?.[provider] || (summaryModelCopy.en.providers?.[provider] ?? provider);
}
// 只有一套生效配置，但每个供应商的模型/地址/密钥引用分别留存，来回切换不会丢失已填内容。
let summaryConfig = { version: 2, enabled: true, provider: 'built-in', providers: {} };
// 配置写入版本号：loadSummaryConfig 读取期间若发生保存，旧值作废（防覆盖竞态）。
let summaryConfigRevision = 0;
let summaryConfigDraft = null;
// 内置供应商在表单里待选的模型。重新渲染（下载/删除/选择）时存活，切换供应商时重置。
let selectedBuiltinModel = '';
let selectedAiAssistBuiltinModel = '';
// onboarding 里选了「在线 AI 供应商」后，供应商下拉不再列出「内置 AI」，
// 避免在线配置流程里混入本地内置选项。关闭模态框时复位。
let onboardingOnlineProvider = false;
let onboardingBuiltinProvider = false;
function providerEntry(config, provider = config.provider) {
  return config.providers[provider] || {};
}
/** 内置供应商可用的已安装模型；未显式选择时回退到第一个已安装的 llama-chat 模型。@returns {string} */
function builtinFallbackModel() {
  const installed = modelCatalog.filter((model) => model.kind === 'llama-chat' && modelPaths.has(model.id));
  return installed[0]?.id || '';
}
/** 组装一次 LLM 请求所需的连接信息；配置不完整时返回 null。@returns {object|null} */
function requestConfig(config) {
  const provider = config.provider;
  const preset = summaryProviderPresets[provider];
  if (!preset) return null;
  const entry = providerEntry(config, provider);
  // 内置模型：未显式选择时自动回退到第一个已安装的 llama-chat 模型，
  // 避免“首次点击就要求配置”的摩擦（本地模型与 API Key 无关）。
  const model = entry.model || (provider === 'built-in' ? builtinFallbackModel() : '');
  if (!model) return null;
  const endpoint = preset.needsEndpoint ? entry.endpoint : preset.endpoint;
  if (preset.needsEndpoint && !endpoint) return null;
  if (preset.needsKey && !entry.keyReference) return null;
  return { provider, endpoint, model, format: preset.format, keyReference: entry.keyReference };
}
function summaryRequestConfig() { return summaryConfig.enabled ? requestConfig(summaryConfig) : null; }
function speakerProfileName(profile) {
  return profile.name;
}
/** 返回保存在应用数据目录中的非机密纪要配置。*/
function currentSummaryConfig() {
  return { version: 2, enabled: summaryConfig.enabled, provider: summaryConfig.provider, providers: summaryConfig.providers };
}
/** 在浏览器存储之外保存纪要模型设置；密钥保留在 Electron 安全存储中。*/
async function persistSummaryConfig() {
  await window.brevia?.summary.config.save(currentSummaryConfig());
}
/** 应用已读取的配置；只认 version 2，其余一律回落到默认的内置供应商。*/
function applySummaryConfig(config) {
  summaryConfig = {
    version: 2,
    enabled: config?.enabled !== false,
    provider: summaryProviders.includes(config?.provider) ? config.provider : 'built-in',
    providers: config?.providers && typeof config.providers === 'object' ? config.providers : {},
  };
  selectedBuiltinModel = '';
}
async function loadSummaryConfig() {
  // 读取期间用户可能已经保存了新配置；快照版本号，旧值晚到就直接丢弃，
  // 避免启动时的一次慢读取把刚保存的配置覆盖回旧值。
  const revision = summaryConfigRevision;
  const stored = await window.brevia?.summary.config.get();
  if (revision !== summaryConfigRevision) return;
  if (stored) applySummaryConfig(stored);
  // 1.0.8 之前的版本把整个配置（含 apiKey 明文）存在 localStorage 里，清掉。
  localStorage.removeItem('brevia-summary-config');
}
// —— AI 辅助笔记配置（开关、主动性与独立模型连接）。 ——
let aiAssistConfig = { version: 2, enabled: false, proactivity: 'assist', provider: 'built-in', providers: {} };
let aiAssistConfigRevision = 0;
let aiAssistConfigDraft = null;
const modelConfigSecrets = new WeakMap();
let aiAssistTemporarilyDisabled = false;
/** 返回当前 AI 辅助配置的可持久化形态。@returns {object} */
function currentAiAssistConfig() {
  return { version: 2, enabled: aiAssistConfig.enabled, proactivity: aiAssistConfig.proactivity, provider: aiAssistConfig.provider, providers: aiAssistConfig.providers };
}
async function persistAiAssistConfig() {
  await window.brevia?.aiAssist.config.save(currentAiAssistConfig());
}
function applyAiAssistConfig(config) {
  aiAssistConfig = {
    version: 2,
    enabled: Boolean(config?.enabled),
    proactivity: ['quiet', 'assist', 'auto'].includes(config?.proactivity) ? config.proactivity : 'assist',
    provider: summaryProviders.includes(config?.provider) ? config.provider : 'built-in',
    providers: config?.providers && typeof config.providers === 'object' ? config.providers : {},
  };
  selectedAiAssistBuiltinModel = '';
}
async function loadAiAssistConfig() {
  const revision = aiAssistConfigRevision;
  const stored = await window.brevia?.aiAssist.config.get();
  if (revision !== aiAssistConfigRevision) return;
  if (stored) applyAiAssistConfig(stored);
  renderAiAssistToggle();
}
/** AI 辅助是否开启（仅当用户显式启用时才返回真）。@returns {boolean} */
function aiAssistEnabled() {
  return aiAssistConfig.enabled && !aiAssistTemporarilyDisabled;
}
const settingsModal = document.createElement('div');
settingsModal.className = 'modal-backdrop';
settingsModal.hidden = true;
settingsModal.innerHTML = '<section class="modal-panel" role="dialog" aria-modal="true"><header class="modal-head"><div class="modal-title"><h2></h2><p></p></div><button class="modal-close" type="button" aria-label="关闭">×</button></header><div class="modal-body"></div></section>';
document.body.append(settingsModal);
let activeModal;
let modelsReturnTo = null;
// 从功能设置跳到模型库时，还未安装的内置 AI 模型 id；其中任意一个装好后跳回一次。
let modelsReturnToPending = null;
let advancedSettings;
let permissionStatus;
let permissionPollTimer;
const advancedSettingCopy = window.BreviaLocaleData.appCopy.advancedSettingCopy;
function renderAdvancedSettings(settings, metadata = {}) {
  const copy = advancedSettingCopy[locale] || advancedSettingCopy.en;
  // 配置里只有 vad 是分语言的两层结构（default / zh）：子分组各有一个小标题，
  // 字段名用完整路径，保存时按路径写回，避免把子对象整体当成一个输入框。
  const rows = (path, values) => Object.entries(values).map(([key, value]) => {
    const fieldPath = `${path}.${key}`;
    if (metadata.inactive_fields?.includes(key)) return "";
    if (value && typeof value === 'object') {
      return `<h4 class="advanced-settings-subgroup">${escapeHtml(copy.subgroups?.[key] || key)}</h4>${rows(fieldPath, value)}`;
    }
    const capMinimum = key === 'max_speech_seconds' ? metadata.speech_cap_minimum : null;
    const range = capMinimum ? `0 / ≥ ${capMinimum} s` : copy.hint;
    return `<label><span><b>${escapeHtml(copy.fields[key] || key)}</b><small>${escapeHtml(range)}</small></span><input ${capMinimum ? 'min="0"' : ''} name="${escapeHtml(fieldPath)}" type="${typeof value === 'number' ? 'number' : 'text'}" step="any" value="${escapeHtml(String(value))}" /></label>`;
  }).join('');
  return Object.entries(settings).map(([section, values]) => `<section class="advanced-settings-section"><h3>${escapeHtml(copy.sections[section] || section)}</h3>${rows(section, values)}</section>`).join('');
}
/** 构建权限部分的一行：状态标记、标签、提示和上下文操作按钮。*/
function permissionRow(kind, label, detail, granted, denied, active, unsupported) {
  const state = granted ? checkIconSvg : '—';
  const hint = unsupported ? t('当前系统不支持直接录制系统音频，请仅使用麦克风') : granted ? t('已允许') : denied ? t('请在系统设置中开启此权限') : detail;
  const action = granted || unsupported ? ''
    : active ? `<button class="modal-action permission-setting-action" data-request-permission="${kind}" type="button">${t('允许')}</button>`
    : `<button class="modal-action permission-setting-action" data-open-permission-settings="${kind}" type="button">${t('打开系统设置')}</button>`;
  return `<label class="permission-setting-row${granted ? ' is-granted' : ''}"><span><b>${escapeHtml(label)}</b><small>${escapeHtml(hint)}</small></span><span class="permission-setting-control"><span class="permission-setting-state">${state}</span>${action}</span></label>`;
}
/** 渲染显示在高级设置模态框顶部的系统权限部分。@returns {string} */
function renderPermissionSettings() {
  const status = permissionStatus || {};
  const micGranted = status.microphone === 'granted';
  const micActive = status.microphone === 'not-determined';
  const screenGranted = status.screen === 'granted';
  const screenUnsupported = !status.systemAudioSupported;
  const rows = permissionRow('microphone', t('麦克风'), t('录制你的发言。'), micGranted, status.microphone === 'denied', micActive, false)
    + permissionRow('screen', t('屏幕与系统音频'), t('录制屏幕共享中的系统声音。'), screenGranted && !screenUnsupported, status.screen === 'denied', false, screenUnsupported);
  return `<section class="advanced-settings-section permission-settings-section" data-permission-settings><h3>${t('系统权限')}</h3>${rows}</section>`;
}
const modelDownloads = new Map();
const meetingList = document.querySelector('.meeting-list');
const libraryToolbar = document.querySelector('.library-toolbar');
const meetingSearch = document.querySelector('#meeting-search');
const meetingSearchClear = document.querySelector('#meeting-search-clear');
const searchResultsPanel = document.querySelector('#search-results');
let searchDebounceTimer = 0;
let searchRequestId = 0;
const selectedMeetingKeys = new Set();
const batchToolbar = document.createElement('section');
batchToolbar.className = 'batch-toolbar';
batchToolbar.hidden = true;
batchToolbar.setAttribute('aria-live', 'polite');
batchToolbar.innerHTML = '<strong data-batch-count></strong><div class="batch-actions"><button type="button" data-batch-restore></button><button type="button" data-batch-export></button><button class="batch-delete" type="button" data-batch-delete></button><button type="button" data-batch-clear></button></div>';
libraryToolbar.after(batchToolbar);
/** 同步选中行样式和上下文批量工具栏。@param {boolean} updateToolbar 是否重绘批量操作。@returns {void} */
function syncMeetingSelection(updateToolbar = true) {
  const rows = [...meetingList.querySelectorAll('.meeting-row')];
  const available = new Set(rows.map((row) => row.dataset.selectionKey));
  [...selectedMeetingKeys].filter((key) => !available.has(key)).forEach((key) => selectedMeetingKeys.delete(key));
  rows.forEach((row) => { const selected = selectedMeetingKeys.has(row.dataset.selectionKey); row.classList.toggle('is-selected', selected); row.setAttribute('aria-selected', String(selected)); });
  if (!updateToolbar) return;
  batchToolbar.hidden = selectedMeetingKeys.size === 0;
  batchToolbar.querySelector('[data-batch-count]').textContent = BreviaI18n.selectionOverview(locale, selectedMeetingKeys.size);
  const deleted = activeLibraryNav === 'recently-deleted';
  const exportButton = batchToolbar.querySelector('[data-batch-export]');
  const restoreButton = batchToolbar.querySelector('[data-batch-restore]');
  exportButton.hidden = deleted;
  restoreButton.hidden = !deleted;
  restoreButton.textContent = t('恢复');
  exportButton.textContent = t('导出');
  batchToolbar.querySelector('[data-batch-delete]').textContent = deleted ? BreviaI18n.trashCopy(locale).purge : t('删除');
  batchToolbar.querySelector('[data-batch-clear]').textContent = t('取消');
  const selectAllButton = document.querySelector('#meeting-select-all');
  if (selectAllButton) {
    // 「全选」只在进入批量管理模式（已有选中）后出现，默认不占视觉。
    selectAllButton.hidden = selectedMeetingKeys.size === 0;
    if (selectedMeetingKeys.size > 0) {
      const visibleRows = rows.filter((row) => !row.hidden);
      const allSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedMeetingKeys.has(row.dataset.selectionKey));
      selectAllButton.textContent = allSelected ? t('取消全选') : t('全选');
    }
  }
}
const selectedMeetings = () => uiData.meetings.filter((meeting, index) => selectedMeetingKeys.has(meeting.id || String(index)));
function clearMeetingSelection() { selectedMeetingKeys.clear(); syncMeetingSelection(); }
/** 将活动工作区过滤应用于会议库列表（搜索已改为独立浮窗，不再过滤列表）。@returns {void} */
function filterMeetings() {
  meetingList.querySelectorAll('.meeting-row').forEach((row) => {
    const meeting = uiData.meetings[Number(row.dataset.meetingIndex)];
    const workspaceMatch = activeWorkspaceId === '' ? !meeting.workspaceId : meeting.workspaceId === activeWorkspaceId;
    row.hidden = !workspaceMatch;
  });
}
/** 使用当前界面语言格式化后端会议元数据。@param {object} meeting 存储的 UI 会议。@returns {object} 显示就绪的会议。*/
function localizeMeeting(meeting) {
  if (!meeting.createdAt) return meeting;
  const languageTag = BreviaI18n.localeTag(locale);
  const created = new Date(meeting.createdAt).toLocaleString(languageTag, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = Math.round(meeting.durationMs / 60000);
  // 后端仍把暂停中的会议记为 recording，这里以界面的暂停状态为准，避免重绘后回到「正在录制」。
  const paused = meetingActive && meetingPaused() && meeting.id === breviaClient?.state.meeting?.id;
  return {
    ...meeting,
    meta: `${created} · ${minutes} ${t('分钟')}`,
    // label 一律存文案 key；detail 允许是 key（录制中）或已合成的译文（已完成）。
    // renderMeetingRow 会统一走一次 t()：key 被翻译，已翻译文本原样返回。
    status: meeting.statusCode === 'recording'
      ? { tone: 'processing', label: paused ? '已暂停' : '正在录制', paused, detail: '本地保存' }
      : { tone: 'complete', label: '已整理', detail: meetingSecondaryInfo(meeting) },
  };
}
/** 已完成会议的价值信息：参与者数与纪要状态，比“本地录音”更有判断价值。@param {object} meeting 会议数据。@returns {string} 次要信息文本。*/
function meetingSecondaryInfo(meeting) {
  const parts = [];
  if (meeting.speakerCount > 0) parts.push(`${meeting.speakerCount} ${t('位参与者')}`);
  if (meeting.hasSummary) parts.push(t('已生成纪要'));
  return parts.length ? parts.join(' · ') : t('本地录音');
}
/** 仅重新渲染会议列表，保留设置模态框事件绑定。@returns {void} */
function renderMeetingList() { meetingList.innerHTML = uiData.meetings.map((meeting, index) => !meeting.isExample || meeting.exampleLocale === locale ? renderMeetingRow(localizeMeeting(meeting), index) : '').join(''); filterMeetings(); syncMeetingSelection(); cacheMeetingList(); }
const prepareForm = document.querySelector('#meeting-form');
const prepareView = document.querySelector('#prepare-view');
const prepareLayout = prepareView.querySelector('.prepare-layout');
const prepareBack = prepareView.querySelector('.back');
const desktopPrepareLayout = matchMedia('(min-width: 851px)');
/** 在窗口调整大小时，将准备控件适配到可见的桌面工作空间。@returns {void} */
function fitPrepareLayout() {
  if (activeView !== 'prepare' || !desktopPrepareLayout.matches) {
    prepareLayout.style.removeProperty('transform');
    prepareLayout.style.removeProperty('width');
    return;
  }
  prepareLayout.style.setProperty('--prepare-scale', '1');
  prepareLayout.style.width = '100%';
  const styles = getComputedStyle(prepareView);
  const gap = Number.parseFloat(styles.rowGap) || 0;
  const padding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
  const available = prepareView.clientHeight - padding - prepareBack.offsetHeight - gap;
  let scale = Math.min(1, available / Math.max(prepareLayout.scrollHeight, 1));
  prepareLayout.style.width = `${100 / scale}%`;
  scale = Math.min(1, available / Math.max(prepareLayout.scrollHeight, 1));
  prepareLayout.style.setProperty('--prepare-scale', scale.toFixed(4));
  prepareLayout.style.width = `${100 / scale}%`;
}
new ResizeObserver(() => requestAnimationFrame(fitPrepareLayout)).observe(prepareView);
desktopPrepareLayout.addEventListener('change', fitPrepareLayout);
const importRecording = document.querySelector('#import-recording');
const meetingTitle = document.querySelector('#meeting-title');
let meetingTitleEdited = false;
/** 仅在用户提供自己的标题之前刷新起始标题。@returns {void} */
function renderDefaultMeetingTitle() { if (!meetingTitleEdited) meetingTitle.value = BreviaI18n.defaultMeetingTitle(locale); }
meetingTitle.addEventListener('input', () => { meetingTitleEdited = true; });
// 会议语言的默认值：界面语言本身就是可识别的会议语言时直接用它。
// auto 的声明默认模型（Parakeet）不覆盖 zh/ja/ko，所以这三个界面必须给出显式语言，
// 否则默认会议会被路由到不支持该语言的模型。
const defaultMeetingLanguage = () => ({ zh: 'zh', ja: 'ja', ko: 'ko' }[locale] || 'auto');
/** 在保留其提交值的同时重建会议语言选择器。@returns {void} */
/** 渲染准备页的识别模型控件。 */
function prepareModelControl(language, refinedModel, modelOptions) {
  if (!modelOptions.length) return '';
  const words = (asrCopy.prepare || {})[locale] || (asrCopy.prepare || {}).en || {};
  return `<label class="prepare-model-select">${escapeHtml(words.modelLabel || t('识别模型'))}${flowSelect('refined-model', refinedModel, modelOptions)}</label>`;
}
function renderPrepareSelects() {
  const values = Object.fromEntries(new FormData(prepareForm));
  const workspaceOptions = [
    ['', t('公开工作区')],
    ...(typeof workspaces !== 'undefined' ? workspaces.map((ws) => [ws.id, ws.name]) : []),
    ['__new_workspace__', `+ ${t('新建工作区')}`],
  ];
  const workspaceValue = values['meeting-workspace'] === '__new_workspace__' ? activeWorkspaceId : values['meeting-workspace'] ?? activeWorkspaceId;
  const language = values['meeting-language'] || defaultMeetingLanguage();
  // 换语言时保留用户显式选过的模型（只要它仍支持新语言），否则回到该语言的默认模型。
  const modelOptions = refinedModelOptions(language);
  const previousModel = values['refined-model'];
  const refinedModel = modelOptions.some(([id]) => id === previousModel) ? previousModel : defaultRefinedModelId(language);
  // 模型清单要等后端 initialize 返回；在那之前不渲染这一格，避免出现空白的禁用下拉。
  const modelLabel = prepareModelControl(language, refinedModel, modelOptions);
  prepareForm.querySelector('.form-grid').innerHTML = `<label>${t('会议语言')}${flowSelect('meeting-language', language, BreviaI18n.languageOptions(locale, t, true))}</label>${modelLabel}<label>${t('译文目标')}${flowSelect('translation-target', values['translation-target'] || '', BreviaI18n.languageOptions(locale, t))}</label><label>${t('工作区')}${flowSelect('meeting-workspace', workspaceValue, workspaceOptions)}</label>`;
  renderCaptureMode(values['capture-mode'] || savedCaptureMode());
  const importing = prepareView.dataset.mode === 'import';
  prepareView.querySelector('.eyebrow').textContent = t(importing ? '导入录音' : '准备录制');
  prepareView.querySelector('h1').textContent = t(importing ? '导入录音' : '开始一场会议');
  prepareForm.querySelector('.primary-action').firstChild.nodeValue = `${t(importing ? '导入录音' : '开始录制')} `;
  importRecording.querySelector('.import-recording-label').textContent = t('导入录音');
  if (activeView === 'prepare') crumb.textContent = importing ? t('导入录音') : catalog[locale].views.prepare;
  requestAnimationFrame(fitPrepareLayout);
}
const CAPTURE_MODE_KEY = 'brevia-capture-mode';
const LAST_CAPTURE_MODE_KEY = 'brevia-last-capture-mode';
const CAPTURE_MODES = new Set(['auto', 'mic', 'system', 'both']);
function savedCaptureMode() {
  try {
    const value = localStorage.getItem(CAPTURE_MODE_KEY);
    return CAPTURE_MODES.has(value) ? value : 'both';
  } catch { return 'both'; }
}
function lastCaptureMode() {
  try {
    const value = localStorage.getItem(LAST_CAPTURE_MODE_KEY);
    return ['mic', 'system', 'both'].includes(value) ? value : 'both';
  } catch { return 'both'; }
}
function captureModeInputs(mode = savedCaptureMode()) {
  const effective = mode === 'auto' ? lastCaptureMode() : mode;
  return { mic: effective === 'mic' || effective === 'both', system: effective === 'system' || effective === 'both' };
}
function captureModeSelect(value) {
  const options = [
    ['auto', t('自动（记住上次）'), t('沿用上次成功录制的方式')],
    ['mic', t('仅麦克风'), t('适合线下会议场景')],
    ['system', t('仅系统音频'), t('适合网课、视频场景')],
    ['both', t('麦克风 + 系统音频'), t('适合线上会议场景')],
  ];
  const selected = options.find(([mode]) => mode === value) || options[0];
  return `<div class="flow-select capture-mode-select"><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false">${escapeHtml(selected[1])}<span>⌄</span></button><input type="hidden" name="capture-mode" value="${escapeHtml(selected[0])}" /><div class="flow-select-options" hidden>${options.map(([mode, label, scene]) => `<button type="button" data-flow-select-choice="capture-mode" data-value="${mode}" data-label="${escapeHtml(label)}"><b>${escapeHtml(label)}</b><small>${escapeHtml(scene)}</small></button>`).join('')}</div></div>`;
}
function renderCaptureMode(value = savedCaptureMode()) {
  const mount = prepareForm.querySelector('#capture-mode-mount');
  if (!mount) return;
  mount.innerHTML = captureModeSelect(value);
  const inputs = captureModeInputs(value);
  const micSetting = prepareForm.querySelector('#mic-device-setting');
  if (micSetting) micSetting.hidden = !inputs.mic;
  const hint = prepareForm.querySelector('#capture-mode-hint');
  if (hint) hint.textContent = '';
  renderPrepareAudioSources();
  // 仅在准备页内预览麦克风；启动或首页重绘（applyLanguage 会调用本函数）不应采集声音。
  if (activeView !== 'prepare' || prepareView.dataset.mode === 'import') return;
  if (inputs.mic) { void refreshMicDevices(); void previewMicrophone(); }
  else void breviaClient?.stopPreview();
}
function selectCurrentWorkspaceForMeeting() {
  const workspace = prepareForm.querySelector('[name="meeting-workspace"]');
  if (workspace) workspace.value = activeWorkspaceId;
  renderPrepareSelects();
}
function setPrepareMode(mode) {
  prepareView.dataset.mode = mode;
  if (mode === 'import') void breviaClient?.stopPreview();
  selectCurrentWorkspaceForMeeting();
}
const DEFAULT_REFINED_MODEL_ID = 'funasr-nano-int8';
const languageModelDefaults = {
  zh: { segmentation: 'pyannote-segmentation-3.0' },
  yue: { segmentation: 'pyannote-segmentation-3.0' },
  en: { segmentation: 'pyannote-segmentation-3.0' },
  default: { segmentation: 'pyannote-segmentation-3.0' },
};
const preferredModelsForLanguage = (language) => languageModelDefaults[language] || languageModelDefaults.default;
// 以下这些函数是对 model-selection.js 的薄包装：把模块级状态（清单、已安装路径、当前
// 语言环境与文案）显式传进去。规则本身不在这里，避免"同一套判断在两处各写一遍"。
const MULTILINGUAL_MODEL_KINDS = modelSelection.MULTILINGUAL_MODEL_KINDS;
const modelSupportsLanguage = (model, language) =>
  modelSelection.modelSupportsLanguage(model, language);

/** 可选的整句识别模型，按清单的 refined_priority 排序。@returns {object[]} */
function refinedModels() {
  return modelSelection.selectableRefinedModels(modelCatalog);
}
/** 该语言可用（含未安装）的整句识别模型。@param {string} language 会议语言。@returns {object[]} */
function refinedModelsForLanguage(language) {
  return modelSelection.refinedModelsForLanguage(modelCatalog, language);
}
/** 清单声明的该语言默认识别模型 id。@param {string} language 会议语言。@returns {string|undefined} */
function manifestDefaultRefinedModelId(language) {
  return modelSelection.declaredDefaultModelId(modelCatalog, language);
}
/** 该语言的首选识别模型：用户偏好 → 清单声明 → 已安装的同语言模型。
 * @param {string} language 会议语言。@returns {string} 模型 id。 */
function defaultRefinedModelId(language) {
  return modelSelection.defaultRefinedModelId({
    catalog: modelCatalog,
    language,
    installed: modelPaths,
    preferredId: preferredModelForLanguage(language),
    fallbackId: DEFAULT_REFINED_MODEL_ID,
  });
}
/** 组装识别模型下拉选项（第三项是本语言的推荐角标）。@param {string} language 会议语言。
 * @returns {Array<[string, string, string]>} */
function refinedModelOptions(language) {
  const labels = modelLabels[locale] || modelLabels.en;
  return modelSelection.refinedModelOptions({
    catalog: modelCatalog,
    language,
    installed: modelPaths,
    downloadWord: labels.download,
    recommendedWord: (asrCopy.recommended || {})[locale] || (asrCopy.recommended || {}).en || '',
    formatSize: formatBytes,
    fallbackId: DEFAULT_REFINED_MODEL_ID,
  });
}
// 用户显式改选的识别模型偏好，按会议语言分别记（跨语言的首选没有意义）。
// 只有用户在准备页主动改选时才写入；系统按语言做的回退不写——否则回退值会静默
// 覆盖偏好（设计文档 §5.1）。key 用单一映射，缺省即无偏好。
const PREFERRED_MODEL_KEY = 'brevia-preferred-refined-model';
function preferredModelMap() {
  try { return JSON.parse(localStorage.getItem(PREFERRED_MODEL_KEY) || '{}') || {}; }
  catch { return {}; }
}
function rememberPreferredModel(modelId, language) {
  if (!modelId) return;
  const map = preferredModelMap();
  // 语言未知时按当前会议语言记，保证同一语言下次开会能命中。
  const key = language || prepareForm.querySelector('[name="meeting-language"]')?.value || defaultMeetingLanguage();
  map[key] = modelId;
  try { localStorage.setItem(PREFERRED_MODEL_KEY, JSON.stringify(map)); } catch { /* 忽略存储失败。 */ }
}
/** 该语言下用户显式选过的模型；若它已不适用（不支持该语言或已被删除）则返回 null。 */
function preferredModelForLanguage(language) {
  const modelId = preferredModelMap()[language];
  if (!modelId) return null;
  const model = modelCatalog.find((item) => item.id === modelId);
  return model && modelSupportsLanguage(model, language || 'auto') ? modelId : null;
}
function applyLanguageModelDefaults(language) {
  const models = preferredModelsForLanguage(language);
  Object.assign(prepareForm.dataset, { segmentationModel: models.segmentation, vadModel: 'silero-vad' });
}
if (breviaClient) {
  breviaClient.onCaptureError = (error) => {
    showToast(t(error.message));
    document.querySelector('#end-meeting').click();
  };
  breviaClient.onLevel = (track, level) => {
    if (track !== 'mic') return;
    document.querySelectorAll('#mic-level, [data-onboarding-mic-level], [data-live-mic-level]').forEach((meter) => meter.style.setProperty('--level', Math.max(.04, level)));
  };
  // 恢复用户上次选择的麦克风设备(若有)。
  if (savedMicDeviceId()) breviaClient.setMicDevice(savedMicDeviceId());
}
function setSourceBadge(labelEl, hintEl, { ok, text, hint }) {
  if (labelEl) {
    labelEl.textContent = text;
    labelEl.dataset.tone = ok ? 'ok' : 'warn';
  }
  if (hintEl) {
    hintEl.textContent = hint || '';
    hintEl.hidden = !hint;
  }
}
/** 根据系统权限状态刷新录制前页的录音源（麦克风 / 系统音频）状态。@returns {void} */
function renderPrepareAudioSources() {
  const status = permissionStatus || {};
  const inputs = captureModeInputs();
  const micReady = status.microphone === 'granted';
  const systemReady = status.systemAudioSupported !== false && status.screen === 'granted';
  setSourceBadge(document.querySelector('#mic-input-label'), null, { ok: micReady && inputs.mic, text: inputs.mic ? (micReady ? t('输入良好') : t('未就绪')) : t('未启用') });
  setSourceBadge(document.querySelector('#system-input-label'), null, { ok: systemReady && inputs.system, text: inputs.system ? (systemReady ? t('已连接') : t('未就绪')) : t('未启用') });
  renderMicDeviceOptions();
}
/** 拉取最新权限状态并刷新录音前页的录音源显示。@returns {Promise<void>} */
async function refreshPrepareAudioSources() {
  if (window.brevia?.permissions?.status) {
    const status = await window.brevia.permissions.status().catch(() => permissionStatus);
    if (status) permissionStatus = status;
  }
  renderPrepareAudioSources();
  if (permissionStatus?.microphone === 'granted' && captureModeInputs().mic) await refreshMicDevices();
}
async function previewMicrophone() {
  if (!breviaClient || !captureModeInputs().mic) return;
  try {
    const fellBack = await breviaClient.previewMic();
    if (fellBack) {
      // 所选设备在预览时已断开(如拔出耳机),已回退到系统默认。
      // 重新枚举并同步下拉、持久化与后端采集,避免继续指向已失效的设备。
      await refreshMicDevices();
    }
  } catch (error) {
    const hint = prepareForm.querySelector('#capture-mode-hint');
    if (hint) hint.textContent = userFacingError(error.message);
  }
}
const MIC_DEVICE_KEY = 'brevia-mic-device';
/** 读取用户保存的麦克风设备 id(空串表示系统默认)。@returns {string} */
function savedMicDeviceId() { try { return localStorage.getItem(MIC_DEVICE_KEY) || ''; } catch { return ''; } }
/** 持久化所选麦克风设备 id。@param {string} deviceId 设备 id 或空串表示系统默认。@returns {void} */
function saveMicDeviceId(deviceId) { try { localStorage.setItem(MIC_DEVICE_KEY, deviceId || ''); } catch { /* 忽略存储失败。 */ } }
/** 录制前页当前选中的麦克风设备 id(空串表示系统默认),来自自定义 flow-select 的隐藏字段。@returns {string} */
function selectedMicDeviceId() { return prepareForm.querySelector('[name="mic-device"]')?.value || ''; }
/** 缓存的麦克风设备列表,用于重建下拉选项。@type {Array<{deviceId:string,label:string}>} */
let cachedMicDevices = [];
/** 构建麦克风设备下拉的选项数组(首个为「系统默认」)。@returns {Array<[string,string]>} */
function micDeviceOptions() {
  return [['', t('系统默认')], ...cachedMicDevices.map((device) => [device.deviceId, device.label || t('麦克风设备')])];
}
/** 就地重建麦克风设备下拉:更新选项与选中标签,保留展开/收起状态;若已选设备断开则回退到系统默认。@returns {void} */
function renderMicDeviceOptions() {
  const mount = prepareForm.querySelector('#mic-device-mount');
  if (!mount) return;
  const saved = savedMicDeviceId();
  const present = new Set(cachedMicDevices.map((device) => device.deviceId));
  if (saved && !present.has(saved)) saveMicDeviceId('');
  const options = micDeviceOptions();
  const flow = mount.querySelector('.flow-select');
  if (!flow) {
    mount.innerHTML = flowSelect('mic-device', savedMicDeviceId(), options);
  } else {
    flow.querySelector('.flow-select-options').innerHTML = options
      .map(([value, label]) => `<button type="button" data-flow-select-choice="mic-device" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('');
    const current = flow.querySelector('input').value || savedMicDeviceId();
    const label = options.find(([value]) => value === current)?.[1] || options[0][1];
    flow.querySelector('.flow-select-toggle').firstChild.nodeValue = label;
    flow.querySelector('input').value = current;
  }
  breviaClient?.setMicDevice(savedMicDeviceId());
}
/** 重新枚举系统麦克风设备并重建下拉。@returns {Promise<void>} */
async function refreshMicDevices() {
  cachedMicDevices = (await breviaClient?.listMicrophones().catch(() => [])) || [];
  renderMicDeviceOptions();
}
/** 用户切换麦克风设备后:持久化选择,停止旧预览并立即用新设备重测。@returns {Promise<void>} */
async function onMicDeviceChange() {
  const deviceId = selectedMicDeviceId();
  saveMicDeviceId(deviceId);
  breviaClient?.setMicDevice(deviceId);
  await breviaClient?.stopPreview();
  if (captureModeInputs().mic) await previewMicrophone();
}
let refinementMeetingTitle = '';
let refinementBusyMeetingId = null;
let refinementCardDismissed = false;
function refinementTitle(meetingId) {
  return currentMeetingDetail?.id === meetingId ? currentMeetingDetail.title
    : breviaClient?.state.meeting?.id === meetingId ? breviaClient.state.meeting.title
      : uiData.meetings.find((meeting) => meeting.id === meetingId)?.title || '';
}
function showRefinementProgress(completed = 0, total = 0, meetingTitle = refinementMeetingTitle, meetingId, stage) {
  clearTimeout(refinementDismissTimer);
  if (meetingId) refinementCardDismissed = false;
  if (refinementCardDismissed) return;
  refinementMeetingTitle = meetingTitle;
  const copy = { title: t('正在精修'), waiting: t(stage || '准备中') };
  const previous = !meetingId && refinementCard.dataset.complete !== 'true'
    ? Number(refinementCard.dataset.completed || 0) / Math.max(1, Number(refinementCard.dataset.total || 0)) : 0;
  const ratio = Math.max(previous, total ? Math.min(0.99, Math.max(0, completed / total)) : 0);
  revealTaskCard(refinementCard);
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${copy.title} - ${refinementMeetingTitle}` : copy.title;
  refinementPercent.textContent = total ? `${copy.waiting} · ${Math.round(ratio * 100)}%` : copy.waiting;
  refinementBar.style.transform = `scaleX(${ratio})`;
  Object.assign(refinementCard.dataset, { completed: ratio * 100, total: 100, stage: stage || '', complete: 'false' });
  syncTaskCardStack(refinementCard);
  if (meetingId) setTaskCardTask(refinementCard, 'meeting.refine', meetingId);
}
let refinementDismissTimer;
function showRefinementComplete() {
  clearTimeout(refinementDismissTimer);
  if (refinementCardDismissed) {
    refinementCardDismissed = false;
    return;
  }
  revealTaskCard(refinementCard);
  const title = t('会后精修已完成');
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${title} - ${refinementMeetingTitle}` : title;
  refinementPercent.textContent = '100%';
  refinementBar.style.transform = 'scaleX(1)';
  Object.assign(refinementCard.dataset, { completed: 100, total: 100, complete: 'true' });
  syncTaskCardStack(refinementCard);
  finishTaskCard(refinementCard);
  refinementDismissTimer = setTimeout(hideRefinementProgress, 10000);
}
function hideRefinementProgress(dismissActiveTask = false) {
  if (dismissActiveTask && refinementCard.dataset.complete !== 'true') refinementCardDismissed = true;
  dismissTaskCard(refinementCard, () => { refinementCard.hidden = true; refinementCard.classList.remove('task-card-leave'); });
}
let summaryDismissTimer;
let translationDismissTimer;
function showTranslationProgress(completed, total, targetLanguage) {
  clearTimeout(translationDismissTimer);
  let card = document.querySelector('#translation-progress');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'translation-progress';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `<header class="task-card-heading"><p></p>${taskCardControls()}</header><strong></strong><div class="task-card-progress"><div class="processing-bar" aria-hidden="true"><i></i></div></div>`;
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? completed / total : 0;
  card.querySelector('p').textContent = t('正在翻译字幕');
  card.querySelector('strong').textContent = `${BreviaI18n.languageName(locale, targetLanguage)} · ${Math.round(ratio * 100)}%`;
  card.querySelector('i').style.transform = `scaleX(${ratio})`;
  Object.assign(card.dataset, { completed, total });
  syncTaskCardStack(card);
  if (completed === total) translationDismissTimer = setTimeout(() => dismissTaskCard(card), 10000);
}
const summaryTaskCopy = window.BreviaLocaleData.appCopy.summaryTaskCopy;

function summaryTaskLabel(stage) {
  const copy = summaryTaskCopy[locale] || summaryTaskCopy.en;
  return { 'summary.prepare': copy[1], 'summary.generating': copy[2], 'summary.saving': copy[3], 'summary.complete': copy[4] }[stage] || stage || t('准备中');
}
function showSummaryProgress(completed = 0, total = 100, stage = 'summary.prepare', meetingId) {
  clearTimeout(summaryDismissTimer);
  if (meetingId) {
    summaryGeneratingMeetingId = meetingId;
    if (meetingId === currentMeetingDetail?.id) applyBackendDetail(currentMeetingDetail);
  }
  let card = document.querySelector('#summary-progress');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'summary-progress';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `<header class="task-card-heading"><p></p>${taskCardControls()}</header><strong></strong><div class="task-card-progress"><div class="processing-bar" aria-hidden="true"><i></i></div>${taskPauseControl()}</div>`;
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? Math.min(1, completed / total) : 0;
  card.querySelector('p').textContent = (summaryTaskCopy[locale] || summaryTaskCopy.en)[0];
  card.querySelector('strong').textContent = `${summaryTaskLabel(stage)}${total ? ` · ${Math.round(ratio * 100)}%` : ''}`;
  card.querySelector('i').style.transform = `scaleX(${ratio})`;
  Object.assign(card.dataset, { completed, total, stage });
  syncTaskCardStack(card);
  if (meetingId) setTaskCardTask(card, 'summary.generate', meetingId);
}
function hideSummaryProgress() {
  clearTimeout(summaryDismissTimer);
  const meetingId = summaryGeneratingMeetingId;
  summaryGeneratingMeetingId = undefined;
  if (meetingId === currentMeetingDetail?.id) applyBackendDetail(currentMeetingDetail);
  dismissTaskCard(document.querySelector('#summary-progress'));
}
function showSummaryComplete() {
  showSummaryProgress(100, 100, 'summary.complete');
  finishTaskCard(document.querySelector('#summary-progress'));
  summaryDismissTimer = setTimeout(hideSummaryProgress, 10000);
}
function refreshLocalizedTaskCards() {
  if (!refinementCard.hidden) {
    const title = refinementCard.dataset.complete === 'true' ? t('会后精修已完成') : t('正在精修');
    refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${title} - ${refinementMeetingTitle}` : title;
    const stage = t(refinementCard.dataset.stage || '准备中');
    refinementPercent.textContent = refinementCard.dataset.total === '0' ? stage : `${stage} · ${Math.round(Number(refinementCard.dataset.completed || 0) / Number(refinementCard.dataset.total || 1) * 100)}%`;
  }
  const summary = document.querySelector('#summary-progress');
  if (summary) {
    const total = Number(summary.dataset.total || 0);
    summary.querySelector('p').textContent = (summaryTaskCopy[locale] || summaryTaskCopy.en)[0];
    summary.querySelector('strong').textContent = `${summaryTaskLabel(summary.dataset.stage)}${total ? ` · ${Math.round(Number(summary.dataset.completed || 0) / total * 100)}%` : ''}`;
  }
}
async function generateMeetingSummary(meetingId = breviaClient?.state.selectedMeetingId) {
  if (meetingActive) { showToast(t('实时会议中，结束后再生成会议纪要。')); return; }
  if (summaryGeneratingMeetingId) { showToast(t('已有会议纪要正在生成，请稍候。')); return; }
  const config = summaryRequestConfig();
  if (!config || !meetingId) { showSummaryConfigCard(); return; }
  showSummaryProgress(0, 100, 'summary.prepare', meetingId);
  try {
    const summary = await window.brevia.summary.generate({
      meeting_id: meetingId,
      provider: config.provider,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      model: config.model,
      format: config.format,
      key_reference: config.keyReference,
      language: locale,
      consent: true,
    });
    if (summary?.configuration_required) { hideSummaryProgress(); showSummaryConfigCard(); return; }
    if (summary?.cancelled) { hideSummaryProgress(); return; }
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
    meeting.summary = { data: summary };
    summaryGeneratingMeetingId = undefined;
    if (meetingId === breviaClient.state.selectedMeetingId) applyBackendDetail(meeting);
    dismissTaskCard(document.querySelector('#summary-config-required'));
    showSummaryComplete();
    showToast(t('会议纪要已生成'));
  } catch (error) {
    hideSummaryProgress();
    if (isSummaryAuthenticationError(error)) showSummaryConfigCard(error);
    else showToast(error.message);
  }
}
const requiredModelIds = new Set();
const pendingModelTasks = new Map();
const resumingModelTasks = new Set();
let onboardingModelIds = [];
// 首启选型页是否已经满足「能出字幕」：勾了模型，或本地已经装了模型。由
// updateOnboardingSetup() 维护，供「下载并继续」的守卫使用（见该函数注释）。
let onboardingModelReady = false;
let initializationPromise;
const useChinaModelSource = () => locale === 'zh' && localStorage.getItem('brevia-china-model-source') === 'true';
const modelDownloadPayload = (modelId) => ({ model_id: modelId, ...(useChinaModelSource() ? { source: 'china' } : {}) });
const chinaModelSourceToggle = () => locale === 'zh' ? `<p class="model-source-switch"><label><input type="checkbox" data-china-model-source${useChinaModelSource() ? ' checked' : ''} /><span>${escapeHtml(window.BreviaLocaleData.chinaModelSourceLabel)}</span></label></p>` : '';
const onboardingCopy = window.BreviaLocaleData.appCopy.onboardingCopy;
const onboardingSecurityCopy = window.BreviaLocaleData.appCopy.onboardingSecurityCopy;
const onboardingLanguageCopy = window.BreviaLocaleData.appCopy.onboardingLanguageCopy;
function queueModelTask(task, payload, models) {
  if (!task || (!payload?.meeting_id && !['meeting.start'].includes(task))) return;
  pendingModelTasks.set(`${task}:${payload.meeting_id || 'new'}`, { task, payload, models });
}
async function resumeReadyModelTasks() {
  for (const [key, pending] of pendingModelTasks) {
    if (resumingModelTasks.has(key) || !pending.models.every((modelId) => modelPaths.has(modelId))) continue;
    if (pending.task === 'meeting.refine' && refinementBusyMeetingId) continue;
    pendingModelTasks.delete(key);
    resumingModelTasks.add(key);
    try {
      if (pending.task === 'meeting.refine') {
        await requestRefinement(pending.payload);
      } else if (pending.task === 'meeting.reconfigure') {
        // 仅在此会议仍是实时会议时重试；已停止的会议无法重新配置。
        if (breviaClient?.state.meeting?.id === pending.payload.meeting_id) await window.brevia.meeting.reconfigure(pending.payload);
      } else if (pending.task === 'meeting.start') {
        const { inputs, ...payload } = pending.payload;
        const meeting = await breviaClient.start(payload, inputs);
        if (meeting?.model_required) queueModelTask('meeting.start', pending.payload, meeting.model_required);
        else activateMeeting(meeting, payload);
      }
    } catch (error) {
      if (pending.task === 'meeting.refine' && refinementCard.dataset.meetingId === pending.payload.meeting_id) hideRefinementProgress();
      showToast(error.message);
    } finally { resumingModelTasks.delete(key); }
  }
}
/** 模型 id → 展示名。一律从清单取。
 *
 * 以前走的是一条按下标对齐的 i18n 显示表（`modelIds.indexOf(modelId)` 当下标）：模型不在
 * 那张表里时下标是 -1，取到 undefined，于是下载队列卡片把内部 id 直接摊给用户（内置 AI
 * 模型显示成 `qwen3.5-2b-q4km`）。清单本来就有 `name`，不需要第二份按下标对齐的显示名表
 * ——那份表和它依赖的 `modelIds` 数组都已删除。
 * @param {string} modelId 模型 id。@returns {string} 展示名，未知 id 原样返回。 */
function modelDisplayName(modelId) {
  return modelCatalog.find((model) => model.id === modelId)?.name || modelId;
}
let requiredModelsRenderFrame;
function scheduleRequiredModelsCardRender() {
  if (requiredModelsRenderFrame) return;
  requiredModelsRenderFrame = requestAnimationFrame(() => {
    requiredModelsRenderFrame = undefined;
    renderRequiredModelsCard();
  });
}
let modelLibraryRenderFrame;
/** 节流刷新模型库弹窗：进度事件每秒数十次，逐帧重建会打断点击（mousedown 与 mouseup 之间
 * 节点被销毁，click 永远命中不到）。@returns {void} */
function scheduleModelLibraryRender() {
  if (modelLibraryRenderFrame) return;
  modelLibraryRenderFrame = requestAnimationFrame(() => {
    modelLibraryRenderFrame = undefined;
    if (activeModal === 'models') renderModelLibrary();
  });
}
function renderModelDownloadQueue() {
  let card = document.querySelector('#model-download-queue');
  const entries = [...modelDownloads.entries()];
  if (!entries.length) { dismissTaskCard(card); return; }
  if (!card) {
    card = document.createElement('aside');
    card.id = 'model-download-queue';
    card.className = 'processing-card required-models-card';
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const total = entries.reduce((sum, [id, progress]) => sum + (progress.total || modelSize(id)), 0);
  const received = entries.reduce((sum, [id, progress]) => sum + Math.min(progress.received || 0, progress.total || modelSize(id)), 0);
  const ratio = total ? received / total : 0;
  const heading = entries.some(([id]) => requiredModelIds.has(id)) ? t('需要下载以下模型') : t('模型下载队列');
  // 只有条目或按钮状态变化时才重建 DOM。进度每秒刷新数十次，若每次都重建，
  // 会在 mousedown 与 mouseup 之间销毁按钮，click 永远无法触发，卡片看似点不动。
  const signature = JSON.stringify(entries.map(([id, progress]) => [id, !!progress.error, !!progress.cancelled, !!progress.cancelling, !!progress.paused]).concat([[heading]]));
  if (card.dataset.signature !== signature) {
    card.dataset.signature = signature;
    const scrollTop = card.querySelector('ul')?.scrollTop || 0;
    card.innerHTML = `<header class="task-card-heading"><p>${heading} · ${entries.length}</p>${taskCardControls()}</header><div class="processing-bar" aria-hidden="true"><i style="transform:scaleX(${ratio})"></i></div><ul>${entries.map(([id, progress]) => {
      const itemRatio = progress.total ? Math.min(1, progress.received / progress.total) : 0;
      const status = progress.error ? `<small title="${escapeHtml(progress.error)}">${t('下载失败')}</small>` : progress.cancelled ? '' : `<small>${progress.cancelling ? t('正在取消') : progress.paused ? t('暂停') : progress.total ? `${Math.round(itemRatio * 100)}%` : t('准备中')}</small>`;
      const action = progress.error || progress.cancelled ? `<button type="button" data-download-required="${id}">${t(progress.error ? '重试' : '下载')}</button>` : progress.cancelling ? '' : `<button class="task-card-close" type="button" data-pause-required="${id}" aria-label="${progress.paused ? t('继续') : t('暂停')}">${progress.paused ? '▶' : 'Ⅱ'}</button><button class="task-card-close" type="button" data-cancel-required="${id}" aria-label="${t('取消')}">×</button>`;
      return `<li><span><b>${escapeHtml(modelDisplayName(id))}</b>${status}</span><span class="model-actions">${action}</span><div class="processing-bar" aria-hidden="true"><i style="transform:scaleX(${itemRatio})"></i></div></li>`;
    }).join('')}</ul>`;
    card.querySelector('ul').scrollTop = scrollTop;
    return;
  }
  // 纯进度刷新：原地更新进度条与百分比，保留按钮节点，点击才能命中。
  const topBar = card.querySelector(':scope > .processing-bar > i');
  if (topBar) topBar.style.transform = `scaleX(${ratio})`;
  const items = card.querySelectorAll(':scope > ul > li');
  entries.forEach(([id, progress], index) => {
    const li = items[index];
    if (!li) return;
    const itemRatio = progress.total ? Math.min(1, progress.received / progress.total) : 0;
    const bar = li.querySelector(':scope > .processing-bar > i');
    if (bar) bar.style.transform = `scaleX(${itemRatio})`;
    if (!progress.error && !progress.cancelled && !progress.cancelling && !progress.paused) {
      const small = li.querySelector('span small');
      if (small) small.textContent = progress.total ? `${Math.round(itemRatio * 100)}%` : t('准备中');
    }
  });
}
function renderRequiredModelsCard() {
  [...requiredModelIds].filter((id) => modelPaths.has(id)).forEach((id) => requiredModelIds.delete(id));
  renderModelDownloadQueue();
}
async function downloadRequiredModel(modelId) {
  if (modelPaths.has(modelId)) { requiredModelIds.delete(modelId); renderRequiredModelsCard(); return; }
  if (modelDownloads.has(modelId) && !modelDownloads.get(modelId).error && !modelDownloads.get(modelId).paused && !modelDownloads.get(modelId).cancelled) return;
  if (!modelDownloads.has(modelId) || modelDownloads.get(modelId).error || modelDownloads.get(modelId).cancelled) modelDownloads.set(modelId, { received: 0, total: 0 });
  renderRequiredModelsCard();
  try {
    await window.brevia?.models.download(modelDownloadPayload(modelId));
  } catch (error) {
    modelDownloads.set(modelId, { error: error.message });
    renderRequiredModelsCard();
  }
}
function downloadRequiredModels(models) {
  models.forEach((modelId) => requiredModelIds.add(modelId));
  void Promise.all(models.map(downloadRequiredModel));
}
function showOfflineTranscriptionReady() {
  let card = document.querySelector('#offline-transcription-ready');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'offline-transcription-ready';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
    enterTaskCard(card);
  }
  card.innerHTML = `<header class="task-card-heading"><p>${(onboardingCopy[locale] || onboardingCopy.en).ready}</p>${taskCardControls()}</header>`;
  window.setTimeout(() => dismissTaskCard(card), 10000);
}
taskCards.addEventListener('click', (event) => {
  const backCard = event.target.closest('.is-task-card-back');
  if (backCard) { activateTaskCard(backCard); return; }
  const taskPause = event.target.closest('[data-pause-task]');
  if (taskPause) {
    const card = taskPause.closest('.processing-card');
    const task = card.dataset.task;
    const meetingId = card.dataset.meetingId;
    if (!task || !meetingId) return;
    const paused = card.dataset.paused === 'true';
    taskPause.disabled = true;
    void window.brevia.task[paused ? 'resume' : 'pause']({ task, meeting_id: meetingId }).catch((error) => showToast(error.message)).finally(() => { taskPause.disabled = false; });
    return;
  }
  const minimize = event.target.closest('[data-minimize-task-card]');
  if (minimize) {
    const card = minimize.closest('.processing-card');
    toggleTaskCardMinimized(card, minimize);
    return;
  }
  const close = event.target.closest('[data-dismiss-task-card]');
  if (close) {
    const card = close.closest('.processing-card');
    if (card === refinementCard) {
      const { task, meetingId } = card.dataset;
      hideRefinementProgress(true);
      if (task && meetingId) void window.brevia.task.cancel({ task, meeting_id: meetingId }).catch((error) => showToast(error.message));
    }
    else {
      if (card?.id === 'summary-progress') clearTimeout(summaryDismissTimer);
      if (card?.id === 'summary-config-required') clearTimeout(summaryConfigDismissTimer);
      // 关闭下载队列对于已取消/失败的模型是终结性的：删除它们，以便卡片无法
      // 重新浮现（并且库无法一直停留在"下载中"）。正在进行的下载继续运行。
      if (card?.id === 'model-download-queue') {
        for (const [modelId, progress] of modelDownloads) {
          if (progress.cancelled || progress.error) { modelDownloads.delete(modelId); requiredModelIds.delete(modelId); }
        }
        if (activeModal === 'models') renderModal('models');
      }
      dismissTaskCard(card);
    }
    return;
  }
  const one = event.target.closest('[data-download-required]');
  if (one) { void downloadRequiredModel(one.dataset.downloadRequired); return; }
  const pause = event.target.closest('[data-pause-required]');
  if (pause) {
    const modelId = pause.dataset.pauseRequired;
    const progress = modelDownloads.get(modelId);
    if (progress?.paused) void downloadRequiredModel(modelId);
    else void window.brevia?.models.pause({ model_id: modelId }).catch((error) => showToast(error.message));
    return;
  }
  const cancel = event.target.closest('[data-cancel-required]');
  if (cancel) {
    const modelId = cancel.dataset.cancelRequired;
    modelDownloads.set(modelId, { ...modelDownloads.get(modelId), cancelling: true });
    renderRequiredModelsCard();
    void window.brevia?.models.cancel({ model_id: modelId }).catch((error) => {
      if (modelDownloads.has(modelId)) modelDownloads.set(modelId, { ...modelDownloads.get(modelId), cancelling: false });
      renderRequiredModelsCard();
      showToast(error.message);
    });
    return;
  }
});
taskCards.addEventListener('keydown', (event) => {
  const card = event.target.closest('.is-task-card-back');
  if (card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activateTaskCard(card); }
});
prepareForm.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) {
    const options = toggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    const captureMode = toggle.closest('.capture-mode-select');
    // 打开麦克风设备下拉前刷新设备列表(插拔后保持最新),就地更新不会打断展开状态。
    if (opening && toggle.closest('#mic-device-mount')) void refreshMicDevices();
    prepareForm.querySelectorAll('.flow-select-options').forEach((list) => { list.hidden = true; list.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
    captureMode?.classList.remove('opens-upward');
    options.hidden = !opening;
    if (opening && captureMode && options.getBoundingClientRect().bottom > window.innerHeight) captureMode.classList.add('opens-upward');
    toggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const choice = event.target.closest('[data-flow-select-choice]');
  if (!choice) return;
  const select = choice.closest('.flow-select');
  if (choice.dataset.flowSelectChoice === 'meeting-workspace' && choice.dataset.value === '__new_workspace__') {
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
    showNewWorkspaceDialog(null, (workspace) => {
      prepareForm.querySelector('[name="meeting-workspace"]').value = workspace.id;
      renderPrepareSelects();
    });
    return;
  }
  select.querySelector('input').value = choice.dataset.value;
  select.querySelector('.flow-select-toggle').firstChild.nodeValue = choice.dataset.label || choice.textContent;
  select.querySelector('.flow-select-options').hidden = true;
  select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
  if (choice.dataset.flowSelectChoice === 'meeting-language') { applyLanguageModelDefaults(choice.dataset.value); renderPrepareSelects(); }
  if (choice.dataset.flowSelectChoice === 'refined-model') {
    // 只有用户主动改选才写入偏好；系统按语言做的回退不写（否则回退值会静默覆盖偏好，
    // 与 OpenWhispr #1288「浏览 picker 改掉了选择」同源）。见设计文档 §5.1。
    rememberPreferredModel(choice.dataset.value);
  }
  if (choice.dataset.flowSelectChoice === 'capture-mode') {
    try { localStorage.setItem(CAPTURE_MODE_KEY, choice.dataset.value); } catch { /* 忽略存储失败。 */ }
    renderCaptureMode(choice.dataset.value);
  }
  if (choice.dataset.flowSelectChoice === 'mic-device') void onMicDeviceChange();
});
/** 内置纪要模型的推荐项。与模型库、首启页一样只推荐一个，避免三处口径漂移。 */
const RECOMMENDED_BUILTIN_MODEL_ID = 'qwen3.5-2b-q4km';
/** 渲染内置纪要模型选择器。设置页仅列已安装模型；首启允许选择和下载。
 * @param {string} currentModelId 当前模型 id。@param {object[]} installed 候选模型。
 * @param {string} [hint] 说明文案。@param {boolean} [allowDownload] 是否提供首启下载入口。
 * @returns {string} 选择器标记。 */
function builtinModelPicker(currentModelId, installed, hint, allowDownload = false) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const recommendedWord = (asrCopy.recommended || {})[locale] || (asrCopy.recommended || {}).en || '';
  const options = installed.map((model) => [
    model.id,
    model.name,
    model.id === RECOMMENDED_BUILTIN_MODEL_ID ? recommendedWord : '',
  ]);
  const selected = installed.find((model) => model.id === currentModelId) || installed[0];
  const progress = modelDownloads.get(selected.id);
  const inFlight = progress && !progress.error && !progress.cancelled;
  const labels = modelLabels[locale] || modelLabels.en;
  const downloadAction = allowDownload && !modelPaths.has(selected.id)
    ? `<button class="modal-action" type="button" data-download-model="${escapeHtml(selected.id)}"${inFlight ? ' disabled' : ''}>${escapeHtml(inFlight ? labels.downloading : labels.download)} · ${formatBytes(selected.size_bytes || 0)}</button>`
      + (progress?.error ? `<p class="summary-model-hint">${escapeHtml(progress.error)}</p>` : inFlight && progress.total ? `<p class="summary-model-hint">${Math.round(Math.min(1, progress.received / progress.total) * 100)}%</p>` : '')
    : '';
  const intro = builtinModelIntro[selected.id]?.[locale] || builtinModelIntro[selected.id]?.en || '';
  return `<div class="model-picker">${flowSelect('model', selected.id, options)}`
    + (intro ? `<p class="model-picker-intro">${escapeHtml(intro)}</p>` : '')
    + `<div class="model-picker-foot">${renderModelLibraryRatings(selected)}`
    + (allowDownload ? downloadAction : `<button class="text-button" type="button" data-open-models-from-config>${escapeHtml(t('管理模型库'))}</button>`) + '</div></div>'
    + (allowDownload ? '' : `<p class="summary-model-hint">${escapeHtml(hint || copy.builtinHint)}</p>`);
}
/** 一个内置模型都没装时的空状态：不留死路，直接给去模型库的路。@param {string} storedModelId 配置里记着的模型 id（回填用，可能未安装）。@returns {string} 空状态标记。 */
function builtinModelEmptyState(storedModelId) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  return `<input type="hidden" name="model" value="${escapeHtml(storedModelId)}" />`
    + `<div class="model-picker is-empty"><p class="summary-model-hint">${escapeHtml(t('还没有下载内置 AI 模型。'))}</p>`
    + `<button class="modal-action" type="button" data-open-models-from-config>${escapeHtml(t('管理模型库'))}</button></div>`
    + `<p class="summary-model-hint">${escapeHtml(copy.builtinHint)}</p>`;
}
/** 渲染纪要模型配置表单：单选供应商 + 按供应商条件显示的字段。@returns {string} */
function renderModelConfigFields(config, selectedModel, { required = true, hint } = {}) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const provider = config.provider;
  const preset = summaryProviderPresets[provider];
  const entry = providerEntry(config, provider);
  const isBuiltin = provider === 'built-in';

  const providerOptions = summaryProviders
    .filter((id) => !onboardingOnlineProvider || id !== 'built-in')
    .map((id) => [id, summaryProviderLabel(id)]);
  const providerField = onboardingBuiltinProvider ? '<input type="hidden" name="provider" value="built-in" />' : `<label class="config-select-field">${copy.provider}${flowSelect('provider', provider, providerOptions)}</label>`;
  let fields = '';
  let builtinModelList = '';
  let currentModelId = '';
  if (isBuiltin) {
    const installed = modelCatalog.filter((model) => model.kind === 'llama-chat' && (onboardingBuiltinProvider || modelPaths.has(model.id)));
    const stored = modelPaths.has(entry.model) ? entry.model : '';
    currentModelId = installed.some((model) => model.id === selectedModel) ? selectedModel : (stored || (onboardingBuiltinProvider && installed.find((model) => model.id === RECOMMENDED_BUILTIN_MODEL_ID)?.id) || installed[0]?.id || '');
    builtinModelList = installed.length ? builtinModelPicker(currentModelId, installed, hint, onboardingBuiltinProvider) : builtinModelEmptyState(stored);
  } else {
    // 固定供应商的请求地址由代码派生，只有自定义供应商才让用户填写。
    const requiredAttr = required ? ' required' : '';
    const endpointField = preset.needsEndpoint ? `<label>${copy.endpoint}<input name="endpoint" value="${escapeHtml(entry.endpoint || '')}" type="url" placeholder="${escapeHtml(copy.endpointPlaceholder)}"${requiredAttr} /></label>` : '';
    // maxlength 对齐主进程的 zod 上限（model 128、keyLength 512），否则超长值要到
    // 主进程才被拒，用户只会看到一句无从下手的「操作失败」。
    const keyField = `<label>${copy.key}<input name="apiKey" type="password" autocomplete="new-password" maxlength="512" value="${escapeHtml(modelConfigSecrets.get(config)?.[provider] || '')}" placeholder="${entry.keyReference ? '•'.repeat(entry.keyLength || 8) : ''}"${entry.keyReference || !required ? '' : ' required'} /></label>`;
    const modelField = `<label>${copy.model}<input name="model" value="${escapeHtml(entry.model || '')}" maxlength="128" placeholder="${escapeHtml(preset.model)}"${requiredAttr} /></label>`;
    fields = `${endpointField}${keyField}${modelField}`;
  }

  return { markup: `<div class="config-fields">${providerField}${fields}</div>${builtinModelList}`, saveDisabled: required && isBuiltin && !modelPaths.has(currentModelId) };
}
function renderModelConfigForm(config, formClass, selectedModel) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const fields = renderModelConfigFields(config, selectedModel);
  return `<form class="${formClass}">${fields.markup}<div class="modal-form-actions"><button class="modal-action" type="submit"${fields.saveDisabled ? ' disabled' : ''}>${copy.save}</button></div></form>`;
}
function renderSummaryModelForm() { return renderModelConfigForm(summaryConfigDraft || summaryConfig, 'summary-model-form', selectedBuiltinModel); }
/** 渲染纪要模型配置模态框。@returns {void} */
function renderSummaryModelModal() {
  summaryConfigDraft ||= structuredClone(summaryConfig);
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.featureIntro || summaryModelCopy.en.featureIntro;
  settingsModal.querySelector('.modal-body').innerHTML = `${onboardingBuiltinProvider || onboardingOnlineProvider ? '' : `<label class="summary-enabled-control"><input type="checkbox" data-summary-enabled${summaryConfig.enabled ? ' checked' : ''} />${escapeHtml(t('AI 会议总结'))}</label>`}${renderSummaryModelForm()}`;
}
/** 渲染「AI 笔记」设置模态框：开关、主动性与独立模型连接。@returns {void} */
function renderAiAssistModal() {
  aiAssistConfigDraft ||= structuredClone(aiAssistConfig);
  const config = aiAssistConfigDraft;
  const copy = (aiAssistCopy[locale] || aiAssistCopy.en).modal;
  settingsModal.querySelector('h2').textContent = t('AI 笔记');
  settingsModal.querySelector('.modal-title p').textContent = t('让 AI 在会议中帮你发现重点、提取待办并整理笔记。');
  const proactivity = config.enabled ? config.proactivity : 'off';
  const levels = (aiOnboardingCopy[locale] || aiOnboardingCopy.en).levels.map(([value, title, detail]) => `<label class="ai-assist-level${proactivity === value ? ' is-selected' : ''}"><input type="radio" name="proactivity" value="${escapeHtml(value)}"${proactivity === value ? ' checked' : ''} /><span><b>${escapeHtml(title)}${recommendTag(value === 'off' && deviceIsWeak())}</b><small>${escapeHtml(detail)}</small></span></label>`).join('');
  const warning = (deviceIsWeak() && config.provider === 'built-in' && /4b/i.test(providerEntry(config).model || ''))
    ? `<p class="performance-weak-note">⚠ ${escapeHtml(t('本机性能有限，建议使用更小的内置模型（如 2B）或在线 LLM API，以获得更流畅的实时体验。'))}<br><button class="secondary" data-use-ai-2b type="button">${escapeHtml(t('改用 2B AI 笔记模型'))}</button>${meetingActive ? ` <button class="secondary" data-disable-ai-assist type="button">${escapeHtml(t('暂时停用 AI 笔记'))}</button>` : ''}</p>` : '';
  // 说明文案用 summaryModelCopy.builtinHint（默认值），两个功能共用同一句，不再各写一份。
  const modelFields = renderModelConfigFields(config, selectedAiAssistBuiltinModel, { required: proactivity !== 'off' });
  const aiForm = `<form class="ai-assist-config-form"><section class="ai-summary-section">${warning}<section class="ai-assist-proactivity"><p>${escapeHtml(copy.proactivityLabel)}</p><div class="ai-assist-levels">${levels}</div></section></section><section class="ai-summary-section"><h3>${escapeHtml(t('模型'))}</h3>${modelFields.markup}</section><div class="modal-form-actions"><button class="modal-action" type="submit"${modelFields.saveDisabled ? ' disabled' : ''}>${escapeHtml(t('保存配置'))}</button></div></form>`;
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="ai-summary-settings">${aiForm}</div>`;
}
async function switchAiAssistTo2B() {
  const model = 'qwen3.5-2b-q4km';
  if (!modelPaths.has(model)) { showToast(t('请先下载 2B AI 模型。')); return false; }
  aiAssistConfig.provider = 'built-in';
  aiAssistConfig.providers = { ...aiAssistConfig.providers, 'built-in': { model } };
  aiAssistConfigDraft = structuredClone(aiAssistConfig);
  aiAssistConfigRevision += 1;
  await persistAiAssistConfig();
  const meetingId = breviaClient?.state.meeting?.id;
  if (meetingActive && meetingId && aiAssistEnabled()) await startAiNoteForMeeting(meetingId);
  showToast(t('AI 笔记已切换为 2B 模型。'));
  return true;
}
function temporarilyDisableAiAssist() {
  aiAssistTemporarilyDisabled = true;
  const meetingId = breviaClient?.state.meeting?.id;
  if (meetingId) stopAiNoteForMeeting(meetingId);
  renderAiAssistToggle();
  renderAiAssistEmptyState();
  showToast(t('AI 笔记已暂时停用。'));
}
function renderSpeakerProfileModal() {
  const copy = speakerProfileCopy[locale] || speakerProfileCopy.en;
  const voiceCopy = voiceFeaturesCopy[locale] || voiceFeaturesCopy.en;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-body').innerHTML = `<form class="speaker-profile-form"><label>${copy.name}<input name="name" maxlength="32" required /></label><button class="modal-action" type="submit">${copy.add}</button></form><div class="speaker-profile-list">${speakerProfiles.map((profile) => {
    const samples = speakerSamples.get(profile.id) || [];
    const expanded = expandedSpeakerProfileId === profile.id;
    const adding = addingSampleProfileId === profile.id;
    const profileName = speakerProfileName(profile);
    const name = editingSpeakerProfileId === profile.id ? `<form class="speaker-profile-rename-form" data-profile-id="${profile.id}"><input name="name" value="${escapeHtml(profileName)}" maxlength="32" required autofocus /></form>` : `<b data-rename-speaker-profile="${profile.id}" title="双击修改名称">${escapeHtml(profileName)}</b>`;
    return `<section class="speaker-profile-entry"><div class="speaker-profile-head"><span>${name}<small>${profile.sample_count}/50 ${copy.samples} · ${formatMeetingTime(profile.duration_ms || 0)} / 05:00</small></span><span><button class="secondary" data-toggle-speaker-samples="${profile.id}" type="button">${expanded ? t('收起') : t('查看录音')}</button><button class="secondary" data-add-speaker-sample="${profile.id}" type="button">${copy.addSample}</button><button class="secondary" data-verify-speaker-profile="${profile.id}" type="button">${voiceCopy.verify}</button><button class="model-delete" data-delete-speaker-profile="${profile.id}" type="button">${copy.remove}</button></span></div>${adding ? `<form class="speaker-sample-form" data-speaker-profile="${profile.id}"><button class="modal-action" type="submit">${t('选择录音并添加')}</button><button class="secondary" data-cancel-speaker-sample type="button">${t('取消')}</button></form>` : ''}${expanded ? `<div class="speaker-sample-list">${samples.length ? samples.map((sample) => `<article><button class="sample-play" data-play-speaker-sample="${sample.id}" type="button" aria-label="${t('播放录音')}">▶</button><span><small>${formatMeetingTime(sample.duration_ms || 0)}</small></span><button class="model-delete" data-delete-speaker-sample="${sample.id}" data-profile-id="${profile.id}" type="button">${copy.remove}</button></article>`).join('') : `<p>${copy.empty}</p>`}</div>` : ''}</section>`;
  }).join('')}</div>`;
}
// 社交平台网页分享入口。本地应用没有可公开访问的会议链接,因此只能携带一小段文本;
// 各平台按 limit 截断。仅使用有稳定 https web-intent 的平台,微信等无 API 平台走文件分享。
const shareSocialUrls = {
  weibo: { limit: 1800, url: (text) => `https://service.weibo.com/share/share.php?title=${encodeURIComponent(text)}` },
  x: { limit: 260, url: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}` },
  telegram: { limit: 1500, url: (text) => `https://t.me/share/url?url=&text=${encodeURIComponent(text)}` },
  whatsapp: { limit: 1500, url: (text) => `https://wa.me/?text=${encodeURIComponent(text)}` },
};
// ===== 导出与分享（统一面板）=====
// 导出内容清单：仅包含当前会议实际可用的内容。exportSelection 记录「已勾选内容 -> 所选格式」。
let exportSelection = {};
const exportContentFormats = {
  notes: ['md', 'pdf', 'docx', 'txt'],
  mynotes: ['md', 'pdf', 'docx', 'txt'],
  transcript: ['srt', 'md', 'txt', 'json'],
};
const exportDefaultFormat = { notes: 'md', mynotes: 'md', transcript: 'srt', audio: 'wav' };
const exportTrack = { audio: 'mix' };
const exportContentLabel = { notes: () => t('会议纪要'), mynotes: () => t('我的笔记'), transcript: () => t('字幕'), audio: () => t('会议录音') };
function exportContentMeta() {
  const meeting = currentMeetingDetail || {};
  const playback = meeting?.audio?.playback || {};
  const meta = [];
  if (meeting?.summary?.data?.markdown) meta.push({ content: 'notes' });
  if (String(meeting?.notes || '').trim()) meta.push({ content: 'mynotes' });
  if ((uiData.detail.transcript || []).length) meta.push({ content: 'transcript' });
  if (playback.mix || playback.mic || playback.system) meta.push({ content: 'audio' });
  return meta;
}
// 把 Markdown 纪要转成便于粘贴的纯文本(去标题井号、加粗、行内代码、列表符与表格竖线)。
function markdownToPlainText(markdown) {
  return String(markdown || '')
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*\|(.*)\|\s*$/gm, (_, row) => row.split('|').map((cell) => cell.trim()).filter(Boolean).join(' · '))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function shareTranscriptText() {
  return (uiData.detail.transcript || []).map((row) => `[${row.time}] ${row.speaker.name}: ${row.text}`).join('\n');
}
// mailto: 正文经 URL 编码后 CJK 字符会膨胀约 9 倍;邮件客户端与主进程都对 URL 长度有上限。
// 按「编码后长度」而非字符数截断,保证最终 URL 稳定落在安全范围(远低于 8000)。整篇正文
// 应通过附件或「复制到剪贴板」传递,mailto 只带开头。
function buildMailto(subject, body, maxEncodedBody = 1600) {
  let text = body || '';
  while (text && encodeURIComponent(text).length > maxEncodedBody) {
    // 每次砍掉约 10%,直到编码后长度达标;CJK 下几次即可收敛。
    text = text.slice(0, Math.max(1, Math.floor(text.length * 0.9)));
  }
  if (text && text.length < (body || '').length) text = `${text.trimEnd()}…`;
  return `mailto:?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text)}`;
}
// 通用截断：先按字符数,再按「URL 编码后长度」二次截断,避免 CJK 编码膨胀后超过主进程 URL 上限。
function makeExcerpt(text, limit) {
  if (!text) return '';
  let value = text.length > limit ? `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : text;
  const maxEncoded = 7000;
  while (value && encodeURIComponent(value).length > maxEncoded) value = value.slice(0, Math.max(1, Math.floor(value.length * 0.9)));
  if (value && value.length < text.length) value = `${value.trimEnd()}…`;
  return value;
}
// 把当前勾选的内容项交给主进程导出/打包/分享。mode: save 保存对话框, reveal 在文件夹中显示, system 系统分享面板。
async function runExportBundle(mode, anchor) {
  const items = selectedExportItems();
  if (!items.length) throw new Error(t('请先选择要导出的内容'));
  const result = await window.brevia?.meeting.exportBundle({
    meeting_id: breviaClient.state.selectedMeetingId,
    items,
    mode,
    ...(anchor ? { anchor } : {}),
  });
  return { ...(result || {}), count: result ? items.length : null };
}
// 格式显示名：Markdown 与各容器格式为通用名，纯文本按语言显示（txt 使用 copy.txt）。
const exportFormatDisplay = {
  md: 'Markdown', pdf: 'PDF', docx: 'DOCX', txt: null, srt: 'SRT', json: 'JSON', wav: 'WAV',
};
// 分享/转发渠道的轻量内联图标。
function sharePlatformIcon(id) {
  const common = 'viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    system: '<path d="M14 6l4 4-4 4"/><path d="M18 10H9"/><path d="M12 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8"/>',
    copy: '<rect x="6" y="6" width="10" height="11" rx="1.5"/><path d="M13 3H5a2 2 0 0 0-2 2v9"/>',
    email: '<rect x="3" y="4.5" width="14" height="11" rx="1.5"/><path d="m3.5 6 6.5 5 6.5-5"/>',
    whatsapp: '<path d="M10 3a7 7 0 0 0-6 10.5L3 17l3.6-1A7 7 0 1 0 10 3Z"/><path d="M7.5 7.5c0 3 2.5 5.5 5.5 5.5l.6-1.4-1.6-.8-.6.6a4.6 4.6 0 0 1-1.8-1.8l.6-.6-.8-1.6L7.5 7.5Z"/>',
    telegram: '<path d="M17.5 3.5 3 9.2l4.2 1.6 1.7 5 2.5-1.7 3 2.4 3.1-12Z"/><path d="m7.2 10.8 6.8-4.3"/>',
    x: '<path d="m4 4 12 12M16 4 4 16"/>',
    weibo: '<path d="M8 12c1-1 3.5-2.5 4.5-1.5 1 .8-1 2-3 2-1.2 0-1.8-.3-1.5-.5Z"/><path d="M13.5 14.5c.5-.8-.8-2.4-1.5-3M7 4c-1.5 2-1.5 6 .5 8 1.6 1.7 4.6 2 6.7.8C16 12 16.5 9.5 15 8c-1-.8-2-.6-2.4-1.5"/>',
  };
  return `<svg ${common}>${paths[id] || paths.copy}</svg>`;
}
// 收集本次选择的内容项（仅限当前会议可用且已勾选的项），带各自格式与音轨。
function selectedExportItems() {
  return exportContentMeta()
    .filter(({ content }) => exportSelection[content])
    .map(({ content }) => ({
      content,
      format: exportSelection[content],
      label: exportContentLabel[content](),
      filename_prefix: `[${exportContentLabel[content]()}]`,
      ...(exportTrack[content] ? { track: exportTrack[content] } : {}),
    }));
}
// 需要文本能力（复制 / 邮件 / 社交网页分享）时，从所选内容中挑正文：纪要优先，其次我的笔记，再逐字稿。
function exportShareText() {
  if (exportSelection.notes) {
    const markdown = currentMeetingDetail?.summary?.data?.markdown;
    if (markdown) return markdownToPlainText(markdown);
  }
  if (exportSelection.mynotes) {
    const notes = String(currentMeetingDetail?.notes || '').trim();
    if (notes) return notes;
  }
  if (exportSelection.transcript) return shareTranscriptText();
  return '';
}
function renderExportModal() {
  const copy = exportHubCopy[locale] || exportHubCopy.en;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = currentMeetingDetail?.title || '';
  exportSelection = {};
  exportContentMeta().forEach(({ content }) => { exportSelection[content] = exportDefaultFormat[content]; });
  settingsModal.querySelector('.modal-body').innerHTML = exportHubHtml();
  updateExportBuilderState();
}
// 统一「导出与分享」面板。
function exportHubHtml() {
  const copy = exportHubCopy[locale] || exportHubCopy.en;
  const meta = exportContentMeta();
  meta.forEach(({ content }) => { if (!(content in exportSelection)) exportSelection[content] = exportDefaultFormat[content]; });
  const txt = copy.txt;
  const rows = meta.map(({ content }) => {
    const label = exportContentLabel[content]();
    const desc = copy.desc[content] || '';
    const current = exportSelection[content] || exportDefaultFormat[content];
    const currentDisplay = exportFormatDisplay[current] || txt;
    const formatOptions = (exportContentFormats[content] || []).map((format) => {
      const display = exportFormatDisplay[format] || txt;
      return `<button type="button" data-flow-select-choice="export-format-${content}" data-value="${format}">${escapeHtml(display)}</button>`;
    }).join('');
    return `<label class="export-content-row${exportSelection[content] ? ' is-checked' : ''}">
      <input type="checkbox" data-export-item="${content}"${exportSelection[content] ? ' checked' : ''}>
      <span class="export-content-name"><b>${escapeHtml(label)}</b><small>${escapeHtml(desc)}</small></span>
      ${content === 'audio' ? '<span class="export-format-fixed">WAV</span>' : `<span class="export-format-wrap flow-select">
        <button class="flow-select-toggle" type="button" data-flow-select-toggle aria-expanded="false">${escapeHtml(currentDisplay)}<span>⌄</span></button>
        <input type="hidden" data-export-format="${content}" value="${current}" />
        <div class="flow-select-options" hidden>${formatOptions}</div>
      </span>`}
    </label>`;
  }).join('');
  const channels = [];
  if (window.brevia?.platform === 'darwin') channels.push({ id: 'system', kind: 'file' });
  channels.push({ id: 'copy', kind: 'text' }, { id: 'email', kind: 'text' },
    { id: 'whatsapp', kind: 'text' }, { id: 'telegram', kind: 'text' }, { id: 'x', kind: 'text' }, { id: 'weibo', kind: 'text' });
  const platforms = channels.map(({ id, kind }) => {
    const [label, desc] = copy.platform[id];
    return `<button type="button" class="share-platform" data-share-target="${id}" data-share-kind="${kind}">${sharePlatformIcon(id)}<b>${escapeHtml(label)}</b><small>${escapeHtml(desc)}</small></button>`;
  }).join('');
  return `<div class="export-builder">
    <section class="export-builder-section">
      <h3>${copy.what}</h3>
      <div class="export-content-list">${rows || `<p class="export-empty">${copy.empty}</p>`}</div>
      <p class="export-selection-summary" data-export-summary>${copy.emptySummary}</p>
    </section>
    <section class="export-builder-section">
      <h3>${copy.files}</h3>
      <div class="export-actions">
        <button type="button" class="modal-action" data-export-save>${copy.save}</button>
      </div>
    </section>
    <section class="export-builder-section">
      <h3>${copy.shareTo}</h3>
      <p class="share-hint">${copy.shareHint}</p>
      <div class="share-platforms">${platforms}</div>
    </section>
  </div>`;
}
// 勾选 / 换格式后刷新摘要与各按钮可用状态。
function updateExportBuilderState() {
  const copy = exportHubCopy[locale] || exportHubCopy.en;
  const meta = exportContentMeta();
  const selected = meta.filter(({ content }) => exportSelection[content]);
  const count = selected.length;
  const summaryEl = settingsModal.querySelector('[data-export-summary]');
  if (summaryEl) summaryEl.textContent = count === 0 ? copy.emptySummary : count === 1 ? copy.summaryOne : copy.summaryMany;
  const hasText = selected.some(({ content }) => content !== 'audio');
  settingsModal.querySelectorAll('[data-export-save]').forEach((btn) => { btn.disabled = count === 0; });
  settingsModal.querySelectorAll('[data-share-target]').forEach((btn) => {
    const kind = btn.dataset.shareKind;
    btn.disabled = count === 0 || (kind === 'text' && !hasText);
  });
}
/** 模型事件只刷新内置模型选择，不打断在线配置表单的输入和焦点。 */
function refreshModelConfigModels() {
  const config = activeModal === 'summary-model' ? summaryConfigDraft : activeModal === 'ai-assist' ? aiAssistConfigDraft : null;
  if (config?.provider === 'built-in') renderModal(activeModal);
}

/** 渲染一个设置模态框。@param {'models'|'storage'|'summary-model'} kind 请求的模态框。@returns {void} */
function renderModal(kind) {
  settingsModal.classList.toggle('summary-model-modal', kind === 'summary-model');
  if (kind === 'advanced-settings') {
    settingsModal.querySelector('h2').textContent = t('进阶设置');
    settingsModal.querySelector('.modal-title p').textContent = t('为特定会议环境微调识别、端点检测、说话人分离和本地模型。');
    settingsModal.querySelector('.modal-body').innerHTML = `${renderPermissionSettings()}<form class="advanced-settings-form">${renderAdvancedSettings(advancedSettings?.settings || {}, advancedSettings || {})}<div class="modal-form-actions"><button class="modal-action" type="submit">${t('确定')}</button><button class="secondary" data-reset-advanced-settings type="button">${t('恢复默认')}</button></div></form>`;
    return;
  }
  if (kind === 'summary-model') { renderSummaryModelModal(); return; }
  if (kind === 'ai-assist') { renderAiAssistModal(); return; }
  if (kind === 'speaker-profiles') { renderSpeakerProfileModal(); return; }
  if (kind === 'export' || kind === 'share') { renderExportModal(); return; }
  if (kind === 'whats-new') { renderWhatsNewModal(); return; }
  const copy = (modalCopy[locale] || modalCopy.en)[kind];
  if (kind === 'storage') {
    const cleanup = storageCleanupCopy[locale] || storageCleanupCopy.en;
    settingsModal.querySelector('h2').textContent = t('存储与隐私');
    settingsModal.querySelector('.modal-title p').textContent = t('查看和管理保存在此设备上的会议录音、会议纪要与模型。');
    settingsModal.querySelector('.modal-body').innerHTML = `<div class="storage-list">${copy.items.map(([name, size], index) => `<section><span><b>${escapeHtml(name)}</b><small>${escapeHtml(size)}</small></span><span><button class="secondary" data-open-storage="${['meetings', 'models'][index]}" type="button">${t('从文件夹打开')}</button><button class="model-delete" data-clear-storage="${['meetings', 'models'][index]}" type="button">${t('清空数据')}</button></span></section>`).join('')}</div><div class="modal-form-actions storage-cleanup"><button class="model-delete" data-cleanup-storage type="button">${cleanup.button}</button></div>`;
    return;
  }
  if (kind === 'models') { renderModelLibrary(); return; }
  const modelStageOrder = new Map();
  (copy.items || []).forEach(([stage], index) => { if (!modelStageOrder.has(stage)) modelStageOrder.set(stage, index); });
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="modal-list">${copy.items.map((item, index) => {
    const [name, detail] = item;
    const label = `<b>${escapeHtml(name)}</b>`;
    return `<div><span>${label}<small>${escapeHtml(detail)}</small></span></div>`;
  }).join('')}</div>`;
}

/** 模型库分组顺序与标题。键是清单里的 ``stages``；只读的随包组件单独一组。 */
const MODEL_LIBRARY_GROUPS = [
  { key: 'refined', stage: 'refined' },
  { key: 'vad', stage: 'vad' },
  { key: 'diarization', stage: 'diarization' },
  { key: 'speaker-embedding', stage: 'voiceprint' },
  { key: 'summary', stage: 'summary' },
  { key: 'translation', stage: 'translation' },
];
/** 清单里的 stage 名 → 模型库分组键。
 *
 * 不能用前缀匹配：「speaker-segmentation」会同时匹配 speaker-embedding 与
 * speaker-embedding 两组（前缀 'speaker-' 相同），把说话人分割模型归错组。
 * 映射必须显式。 */
const MODEL_LIBRARY_STAGE_GROUPS = {
  refined: 'refined',
  vad: 'vad',
  diarization: 'diarization',
  'speaker-segmentation': 'diarization',
  'speaker-embedding': 'speaker-embedding',
  summary: 'summary',
  translation: 'translation',
};
// 模型库的可见性、分组与体积摘要同样只在 model-selection.js 里实现一次，这里只传全局状态。
/** 模型库要展示的模型：退役模型一律不显示（清单保留条目只为解析历史 id）。
 * @returns {object[]} 可展示模型。 */
function visibleModels() {
  return modelSelection.visibleModels(modelCatalog, locale);
}
/** 该模型在模型库里属于哪一组。@param {object} model 清单项。@returns {string|undefined} */
function modelLibraryGroup(model) {
  return modelSelection.modelLibraryGroup(model, MODEL_LIBRARY_STAGE_GROUPS);
}
/** 模型库一行的下载大小。@param {object} model 清单项。@returns {string} */
function modelSizeSummary(model) {
  return modelSelection.modelSizeSummary(
    model,
    { download: t('下载') },
    formatBytes,
  );
}
/** 渲染模型库：完全由 modelCatalog 生成，按能力分组，随包组件为只读行。
 *
 * 不再读 i18n 里那份与清单平行的显示数组——那份数据靠下标对齐，改清单顺序就会
 * 静默错位（设计文档 §1.4 / §9.5）。分组标题与定位短句都按 model.id / asr_role 取。
 * @returns {void} */
function renderModelLibrary() {
  const roleWords = (asrCopy.asrRole || {})[locale] || (asrCopy.asrRole || {}).en || {};
  const modelWords = (asrCopy.model || {})[locale] || (asrCopy.model || {}).en || {};
  const labels = modelLabels[locale] || modelLabels.en;

  settingsModal.querySelector('h2').textContent = (modalCopy[locale] || modalCopy.en).models?.title || t('模型库');
  settingsModal.querySelector('.modal-title p').textContent = t('下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。');

  const rows = MODEL_LIBRARY_GROUPS.map(({ key, stage }) => {
    const models = visibleModels().filter((model) => modelLibraryGroup(model) === key);
    if (!models.length) return '';
    const heading = `<h3>${escapeHtml((modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en)[stage] || key)}</h3>`;
    return heading + models.map((model) => {
      const isInstalled = modelPaths.has(model.id);
      const readOnly = Boolean(model.bundled);
      const progress = modelDownloads.get(model.id);
      const ratio = progress?.total ? Math.min(1, progress.received / progress.total) : 0;
      // 已取消是终结状态：不禁用按钮，否则重新下载将不可能。
      const inFlight = progress && !progress.error && !progress.cancelled;
      const progressHtml = progress?.error
        ? `<span class="model-download-progress">${escapeHtml(progress.error)}</span>`
        : inFlight
          ? `<span class="model-download-progress">${formatBytes(progress.received)} / ${formatBytes(progress.total)} · ${Math.round(ratio * 100)}%<i aria-hidden="true" style="transform:scaleX(${ratio})"></i></span>`
          : '';
      const words4 = modelWords[model.id] || {};
      const role = roleWords[model.asr_role];
      const badges = [
        readOnly ? `<span class="model-library-installed">${t('随应用安装')}</span>` : '',
        isInstalled && !readOnly ? `<span class="model-library-installed">${labels.installed}</span>` : '',
        role ? `<span>${escapeHtml(role)}</span>` : '',
      ].join('');
      // 评级刻度统一走 renderModelLibraryRatings：它读 modelLibraryMetaCopy，与 AI 模型
      // 选择器同源；这里再内联一份会读到 asrCopy.tiers，同一模型在两个界面显示不同档位词。
      const ratings = renderModelLibraryRatings(model);
      // 选型模型用我们的实测级文案；其余组件沿用按 id 的客观描述。
      // 只讲「适合什么场景」——不再单列一行「不适合什么」把缺点摊给用户；
      // 语言范围已经写在定位短句里（例如 Parakeet 的 25 种欧洲语言就隐含了不含中文）。
      const description = words4.tagline || modelLibraryDescription(model, '');
      const actions = readOnly
        ? `<span class="model-actions"><span class="model-library-readonly">${t('必需')}</span></span>`
        : `<span class="model-actions">`
          + (isInstalled ? `<button class="secondary" data-open-model-folder="${escapeHtml(model.id)}" type="button">${t('从文件夹打开')}</button>` : '')
          + `<button class="modal-action${isInstalled ? ' modal-danger' : ''}" `
          + (isInstalled ? `data-delete-model="${escapeHtml(model.id)}"` : `data-download-model="${escapeHtml(model.id)}"`)
          + ` type="button"${inFlight ? ' disabled' : ''}>`
          + `${isInstalled ? labels.remove : inFlight ? labels.downloading : labels.download}</button></span>`;
      return `<div class="model-library-item"><span>`
        + `<div class="model-library-name"><b class="model-library-headline">${escapeHtml(model.name)}</b>${badges ? `<div class="model-library-tags">${badges}</div>` : ''}</div>`
        + progressHtml + ratings
        + (description ? `<p>${escapeHtml(description)}</p>` : '')
        + `<small class="model-library-size">${escapeHtml(modelSizeSummary(model))}</small>`
        + `</span>${actions}</div>`;
    }).join('');
  }).join('');

  settingsModal.querySelector('.modal-body').innerHTML = chinaModelSourceToggle()
    + `<div class="modal-list model-library-list">${rows}</div>`;
}

/** 渲染“更新日志”弹窗：标题 + 按版本倒序的内容列表。@returns {void} */
function renderWhatsNewModal() {
  const copy = whatsNewCopy[locale] || whatsNewCopy.en;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-body').innerHTML = renderWhatsNewList();
}
/** 当前版本展开、历史版本折叠；分类条目附提交引用与首次贡献者。 */
function renderWhatsNewList() {
  const copy = whatsNewCopy[locale] || whatsNewCopy.en;
  if (!whatsNewLog || !whatsNewLog.length) return `<p class="whatsnew-empty">${escapeHtml(copy.empty)}</p>`;
  const localized = (entry) => entry[locale] || entry.en || entry.zh || {};
  const repository = 'https://github.com/zerolovesea/Brevia';
  const link = (url, label) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  return `<div class="whatsnew-list">${whatsNewLog.map((entry) => {
    const { version, date, current } = entry;
    const content = localized(entry);
    const sections = [['what', copy.what], ['improved', copy.improved], ['fixed', copy.fixed], ['security', copy.security], ['changes', copy.changes]]
      .map(([key, label]) => {
        const items = content[key];
        if (!items || !items.length) return '';
        return `<section><h4>${escapeHtml(label)}</h4><ul>${items.map((item) => {
          const text = typeof item === 'string' ? item : item.text;
          const reference = /^[a-f0-9]{7,40}$/.test(item.commit || '') ? ` ${link(`${repository}/commit/${item.commit}`, item.commit.slice(0, 7))}` : '';
          return `<li>${escapeHtml(text)}${reference}</li>`;
        }).join('')}</ul></section>`;
      })
      .join('');
    const contributors = entry.contributors?.length ? `<section><h4>${escapeHtml(copy.contributors)}</h4><ul>${entry.contributors.map(({ login, pr }) => `<li>${link(`https://github.com/${encodeURIComponent(login)}`, `@${login}`)} · ${link(`${repository}/pull/${pr}`, `#${pr}`)}</li>`).join('')}</ul></section>` : '';
    const footer = entry.previousVersion ? `<footer>${link(`${repository}/compare/v${entry.previousVersion}...v${version}`, copy.fullChangelog)}</footer>` : '';
    const heading = `<div class="whatsnew-heading"><h3>v${escapeHtml(version)}${current ? `<em>${escapeHtml(copy.current)}</em>` : ''}</h3>${date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>` : ''}</div>`;
    const body = `${content.summary ? `<p class="whatsnew-summary">${escapeHtml(content.summary)}</p>` : ''}${sections}${contributors}${footer}`;
    return current ? `<article class="whatsnew-entry is-current"><header>${heading}</header>${body}</article>` : `<details class="whatsnew-entry"><summary>${heading}</summary>${body}</details>`;
  }).join('')}</div>`;
}
/** 显示设置模态框并播放进入动画；可选聚焦内部元素。@param {string} [focusSelector] 打开后聚焦的模态框内元素。@returns {void} */
function showSettingsModal(focusSelector) {
  settingsModal.querySelector('.modal-title p').hidden = activeView === 'settings';
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close);
  settingsModal.classList.remove('modal-leave');
  settingsModal.style.zIndex = '60';
  settingsModal.hidden = false;
  requestAnimationFrame(() => settingsModal.classList.add('modal-enter'));
  document.body.classList.add('modal-open');
  if (focusSelector) settingsModal.querySelector(focusSelector)?.focus();
}
/** Opens and focuses a settings modal. @param {'models'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
let modalDismissTimer;
let confirmationAction;
function openConfirmation(title, detail, action) {
  confirmationAction = action;
  activeModal = 'confirmation';
  settingsModal.querySelector('h2').textContent = title;
  settingsModal.querySelector('.modal-title p').textContent = detail;
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="confirmation-actions"><p>${escapeHtml(detail)}</p><button class="modal-action modal-danger" data-confirm-action type="button">${t('确认')}</button><button class="secondary" data-cancel-confirmation type="button">${t('取消')}</button></div>`;
  showSettingsModal('[data-cancel-confirmation]');
}
async function openModal(kind) {
  clearTimeout(modalDismissTimer);
  if (kind === 'ai-features') { openOnboardingAi(true); return; }
  if (kind === 'advanced-settings') {
    try {
      const [settings, status] = await Promise.all([window.brevia?.advancedSettings.get(), window.brevia?.permissions.status().catch(() => undefined)]);
      advancedSettings = settings || { settings: {}, defaults: {} };
      permissionStatus = status;
    } catch (error) { showToast(error.message); return; }
  }
  activeModal = kind;
  renderModal(kind);
  showSettingsModal('.modal-close');
  if (kind === 'advanced-settings') startPermissionPoll();
}
/** 在高级设置模态框打开时轮询系统权限状态，并仅在更改时重新渲染该部分。@returns {void} */
function startPermissionPoll() {
  window.clearInterval(permissionPollTimer);
  permissionPollTimer = window.setInterval(async () => {
    if (activeModal !== 'advanced-settings' || settingsModal.hidden) { window.clearInterval(permissionPollTimer); return; }
    const status = await window.brevia?.permissions.status().catch(() => undefined);
    if (!status) return;
    const changed = JSON.stringify(status) !== JSON.stringify(permissionStatus);
    permissionStatus = status;
    const section = settingsModal.querySelector('[data-permission-settings]');
    if (changed && section) section.outerHTML = renderPermissionSettings();
  }, 1000);
}
/** 关闭活动的设置模态框并恢复页面滚动。@returns {void} */
function closeModal() {
  if (settingsModal.hidden) return;
  if (activeModal === 'whats-new') markWhatsNewSeen();
  window.clearInterval(permissionPollTimer);
  summaryConfigDraft = null;
  aiAssistConfigDraft = null;
  onboardingOnlineProvider = false;
  onboardingBuiltinProvider = false;
  // 关掉弹窗就作废「装完跳回功能设置」的意图，否则下次在模型库里随便下一个
  // llama-chat 模型会被莫名其妙地弹回纪要设置页。
  modelsReturnTo = null;
  modelsReturnToPending = null;
  activeModal = undefined;
  settingsModal.style.zIndex = '';
  settingsModal.classList.remove('modal-enter');
  settingsModal.classList.add('modal-leave');
  modalDismissTimer = setTimeout(() => {
    if (!settingsModal.classList.contains('modal-leave')) return;
    settingsModal.hidden = true;
    settingsModal.classList.remove('modal-leave');
    if (onboardingPage?.dataset.aiSettings !== 'true') document.body.classList.remove('modal-open');
  }, 220);
}

let onboardingPage;
let onboardingAiDemoTimer;
let onboardingPreviewLocale;
let onboardingSelectedLocale;
let onboardingTourIndex = 0;
/** 渲染「AI 笔记」演示：复刻应用内实时会议界面——右侧实时字幕 + 左侧 AI 建议（随主动性切换）。@returns {void} */
function renderOnboardingAiDemo() {
  clearInterval(onboardingAiDemoTimer);
  const demo = onboardingPage?.querySelector('[data-onboarding-ai-demo]');
  const mode = onboardingPage?.querySelector('[name="onboarding-ai-enabled"]')?.checked
    ? onboardingPage.querySelector('[name="onboarding-ai-proactivity"]')?.value || 'assist' : 'off';
  if (!demo) return;
  const select = onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').closest('.flow-select');
  select.querySelectorAll('button, input').forEach(control => { control.disabled = mode === 'off'; });
  if (mode === 'off') {
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
  }
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  const demoCopy = aiOnboardingDemoCopy[locale] || aiOnboardingDemoCopy.en;
  const speaker = t('说话人');
  const caption = (n) => `<div class="app-demo-caption"><span class="app-demo-speaker">${escapeHtml(speaker)} ${n}</span><p>${escapeHtml(demoCopy.transcriptText)}</p></div>`;
  demo.dataset.mode = mode;
  // 「暂不开启」：只显示实时字幕，左侧为空态提示（会中无实时建议）。
  if (mode === 'off') {
    demo.innerHTML = `<div class="app-demo-window"><div class="app-demo-window-bar"><i></i><i></i><i></i><span>${escapeHtml(demoCopy.meeting)}</span></div><div class="app-demo-live"><aside class="app-demo-notes"><div class="app-demo-notes-head"><p class="eyebrow">${escapeHtml(demoCopy.notes)}</p></div><p class="app-demo-notes-off">${escapeHtml(copy.offEmpty || '')}</p></aside><div class="app-demo-captions">${caption(1)}${caption(2)}</div></div></div>`;
    clearInterval(onboardingAiDemoTimer);
    return;
  }
  let index = 0;
  const paint = () => {
    const [title, suggestion, note] = demoCopy.scenes[mode][index++ % demoCopy.scenes[mode].length];
    demo.innerHTML = `<div class="app-demo-window"><div class="app-demo-window-bar"><i></i><i></i><i></i><span>${escapeHtml(demoCopy.meeting)}</span></div><div class="app-demo-live"><aside class="app-demo-notes"><div class="app-demo-notes-head"><p class="eyebrow">${escapeHtml(demoCopy.notes)}</p></div><div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">✦</span><span class="ai-suggestion-type">${escapeHtml(title)}</span></div><p class="ai-suggestion-text">${escapeHtml(suggestion)}</p></div><p class="app-demo-notes-note">${escapeHtml(note).replace(/\n/g, '<br />')}</p></aside><div class="app-demo-captions">${caption(1)}${caption(2)}</div></div></div>`;
  };
  paint();
  onboardingAiDemoTimer = setInterval(paint, 2800);
}
/** 渲染「AI 会议纪要」演示。@returns {void} */
function renderOnboardingSummaryDemo() {
  const frame = onboardingPage?.querySelector('[data-onboarding-summary-demo]');
  if (!frame) return;
  const demo = aiOnboardingSummaryDemoCopy[locale] || aiOnboardingSummaryDemoCopy.en;
  frame.innerHTML = `<div class="app-demo-window"><div class="app-demo-window-bar"><i></i><i></i><i></i><span>${escapeHtml(demo.windowTitle)}</span></div><div class="app-demo-summary"><div class="app-demo-summary-body"><p class="eyebrow">${escapeHtml(demo.heading)}</p><div class="markdown-content"><p>${escapeHtml(demo.decision)}</p><ul>${demo.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul></div></div></div></div>`;
}
function openOnboardingLanguage(initialLocale = onboardingSelectedLocale || window.BreviaOnboarding.systemLocale()) {
  activeModal = undefined;
  onboardingPreviewLocale = undefined;
  const choices = [['zh', '简体中文'], ['en', 'English'], ['es', 'Español'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['ru', 'Русский']];
  const defaultLocale = initialLocale;
  const wheelItems = Array.from({ length: 5 }, (_, round) => choices.map(([code, label]) => `<button type="button" data-language-wheel-value="${code}" role="option" aria-selected="${code === defaultLocale}"${round === 2 ? '' : ' tabindex="-1"'}>${label}</button>`).join('')).join('');
  onboardingPage = document.createElement('main');
  onboardingPage.className = 'onboarding-page onboarding-active';
  onboardingPage.innerHTML = `<form class="onboarding-page-content onboarding-language-page" data-onboarding-language><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><div class="onboarding-page-copy"><h1></h1><p></p></div><input name="locale" type="hidden" value="${defaultLocale}" /><div class="language-wheel" role="listbox" aria-label="${escapeHtml(t('切换语言'))}">${wheelItems}</div><div class="onboarding-actions onboarding-page-copy"><button class="modal-action" type="submit"></button></div></form>`;
  document.body.append(onboardingPage);
  updateOnboardingLanguageCopy(defaultLocale);
  requestAnimationFrame(() => onboardingPage.classList.add('onboarding-page-enter'));
  initializeLanguageWheel(onboardingPage.querySelector('.language-wheel'), updateOnboardingLanguageCopy);
  onboardingPage.addEventListener('submit', (event) => {
    event.preventDefault();
    const page = onboardingPage;
    const nextLocale = page.querySelector('[name="locale"]').value;
    onboardingSelectedLocale = nextLocale;
    dismissOnboardingPage(() => {
      onboardingPreviewLocale = undefined;
      applyLanguage(nextLocale, true);
      openOnboardingPermissions();
    });
  });
}

function renderSettingsFolderRows() {
  const grid = document.querySelector('#settings-view .settings-grid');
  const copy = onboardingStorageCopy[locale] || onboardingStorageCopy.en;
  const rows = [];
  for (const key of ['recordings', 'models']) {
    const row = document.createElement('section');
    row.className = 'settings-folder-row';
    row.innerHTML = `<span><b>${escapeHtml(key === 'models' ? copy.models : copy.recordings)}</b><small data-settings-path="${key}"></small></span><button class="secondary" data-change-folder="${key}" type="button">${escapeHtml(copy.choose)}</button>`;
    rows.push(row);
  }
  grid.prepend(...rows);
  void refreshSettingsFolderRows();
}
let storageMovePending = false;
/** Keep setup and settings inert until the move and UI refresh both finish. */
async function withStorageMigration(operation) {
  if (storageMovePending) return;
  storageMovePending = true;
  const copy = onboardingStorageCopy[locale] || onboardingStorageCopy.en;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal-panel storage-migration-dialog';
  dialog.setAttribute('aria-labelledby', 'storage-migration-title');
  dialog.setAttribute('aria-describedby', 'storage-migration-description');
  dialog.innerHTML = `<h2 id="storage-migration-title">${escapeHtml(copy.moving)}</h2><p id="storage-migration-description">${escapeHtml(copy.movingHint)}</p><progress aria-label="${escapeHtml(copy.moving)}"></progress>`;
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(dialog);
  try {
    dialog.showModal();
    return await operation();
  } finally {
    dialog.close();
    dialog.remove();
    storageMovePending = false;
  }
}
function storageErrorMessage(error) {
  const message = String(error.detail || error.message || error);
  if (/empty|ENOTEMPTY/.test(message)) return t('请选择空文件夹。');
  if (/Folders are/.test(message)) return (onboardingStorageCopy[locale] || onboardingStorageCopy.en).moving;
  if (/Finish the current/.test(message)) return t('请先结束会议、精修和模型下载，再更改文件夹。');
  if (/separate|outside/.test(message)) return t('模型和录音文件夹必须相互独立，且不能包含原数据文件夹。');
  if (/environment variable/.test(message)) return t('此文件夹由环境变量指定，无法在应用内更改。');
  return t('文件夹更改失败，请检查路径、磁盘连接和写入权限。');
}
async function refreshSettingsFolderRows() {
  try {
    const locations = await window.brevia.storage.locations();
    for (const key of ['recordings', 'models']) {
      const path = document.querySelector(`[data-settings-path="${key}"]`);
      const button = document.querySelector(`[data-change-folder="${key}"]`);
      if (!path || !button) continue;
      path.textContent = locations[key];
      path.title = locations[key];
      button.disabled = !locations[`${key}Managed`];
    }
  } catch (error) { showToast(error.message); }
}
renderSettingsFolderRows();

// 首次引导：功能演示（tour）。在设置完成后，以 1:1 复刻的应用界面逐一展示言录的核心能力。
const tourMeetingFallback = window.BreviaLocaleData.appCopy.tourMeetingFallback;
const tourAiSuggestionFallback = window.BreviaLocaleData.appCopy.tourAiSuggestionFallback;
const tourHowtoLabel = window.BreviaLocaleData.appCopy.tourHowtoLabel;
const tourHowto = window.BreviaLocaleData.appCopy.tourHowto;
function openOnboardingTour() {
  const copy = tourCopy[locale] || tourCopy.en;
  onboardingTourIndex = 0;
  const steps = copy.steps.map((step, index) => `<button type="button" class="onboarding-tour-step${index === 0 ? ' is-active' : ''}" data-onboarding-tour-step="${index}"><em>${String(index + 1).padStart(2, '0')}</em><span>${escapeHtml(step.label)}</span></button>`).join('');
  showOnboardingPage('tour', `<section class="onboarding-tour-page"><button class="onboarding-tour-skip" data-onboarding-tour-skip type="button">${escapeHtml(copy.skip)}</button><header class="onboarding-tour-head"><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${escapeHtml(copy.title)}</h1><div class="onboarding-intro"><p>${escapeHtml(copy.intro)}</p></div></header><div class="onboarding-tour"><div class="onboarding-tour-stage" data-onboarding-tour-stage></div><div class="onboarding-tour-side"><div class="onboarding-tour-steps">${steps}</div><div class="onboarding-tour-copy" data-onboarding-tour-copy></div><div class="onboarding-tour-actions"><button class="secondary" type="button" data-onboarding-tour-prev hidden>${escapeHtml(copy.back)}</button><button class="modal-action" type="button" data-onboarding-tour-next>${escapeHtml(copy.next)}</button></div></div></div></section>`);
  const page = onboardingPage;
  updateOnboardingTour(page, 0);
  window.addEventListener('resize', fitTourWindow);
  page.addEventListener('click', (event) => {
    const step = event.target.closest('[data-onboarding-tour-step]');
    if (step) { updateOnboardingTour(page, Number(step.dataset.onboardingTourStep)); return; }
    if (event.target.closest('[data-onboarding-tour-skip]')) { dismissOnboardingPage(finishOnboarding); return; }
    if (event.target.closest('[data-onboarding-tour-prev]')) { updateOnboardingTour(page, onboardingTourIndex - 1); return; }
    if (event.target.closest('[data-onboarding-tour-next]')) {
      const last = (tourCopy[locale] || tourCopy.en).steps.length - 1;
      if (onboardingTourIndex < last) updateOnboardingTour(page, onboardingTourIndex + 1);
      else dismissOnboardingPage(finishOnboarding);
    }
  });
}
function updateOnboardingTour(page, index) {
  onboardingTourIndex = index;
  const copy = tourCopy[locale] || tourCopy.en;
  const step = copy.steps[index];
  page.querySelectorAll('[data-onboarding-tour-step]').forEach((button, i) => button.classList.toggle('is-active', i === index));
  page.querySelector('[data-onboarding-tour-stage]').innerHTML = renderTourWindow(index);
  fitTourWindow();
  const prev = page.querySelector('[data-onboarding-tour-prev]');
  const next = page.querySelector('[data-onboarding-tour-next]');
  prev.hidden = index === 0;
  next.textContent = index === copy.steps.length - 1 ? copy.start : copy.next;
  page.querySelector('[data-onboarding-tour-copy]').innerHTML = `<h3>${escapeHtml(step.heading)}</h3><p>${escapeHtml(step.body)}</p><ul>${step.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>${(tourHowto[locale] || {})[index]?.length ? `<p class="onboarding-tour-howto-label">${escapeHtml(tourHowtoLabel[locale] || tourHowtoLabel.en)}</p><ol class="onboarding-tour-howto">${(tourHowto[locale][index] || tourHowto.en[index] || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>` : ''}`;
}
// 按当前版面宽度与高度计算缩放，使 1:1 复刻的应用界面等比铺入演示窗口。
// 采用 requestAnimationFrame 等布局完成后取宽度，避免首帧拿到 0 宽导致整屏空白。
function fitTourWindow() {
  const page = onboardingPage;
  const stage = page?.querySelector('[data-onboarding-tour-stage]');
  const frame = stage?.querySelector('[data-onboarding-tour-window]');
  if (!stage || !frame) return;
  requestAnimationFrame(() => {
    const width = stage.clientWidth || stage.getBoundingClientRect().width;
    if (width <= 0) return;
    const repW = 1180;
    const repH = 660;
    const scale = Math.min(width / repW, (window.innerHeight * 0.66) / repH);
    frame.style.setProperty('--tour-scale', scale);
    frame.style.setProperty('--tour-w', `${Math.round(repW * scale)}px`);
    frame.style.setProperty('--tour-h', `${Math.round(repH * scale)}px`);
  });
}
function renderTourWindow(index) {
  const step = (tourCopy[locale] || tourCopy.en).steps[index];
  const crumbs = [t('所有会议'), t('准备录制'), t('实时字幕'), t('实时字幕'), t('会议详情')];
  return `<div class="onboarding-tour-window" data-onboarding-tour-window>${renderTourReplica(index, crumbs[index] || '')}<div class="onboarding-tour-callout tour-callout--${step.callout}">${index + 1}</div></div>`;
}
function renderTourReplica(index, crumb) {
  const step = (tourCopy[locale] || tourCopy.en).steps[index];
  return `<div class="onboarding-tour-replica">${tourSidebar(index)}<section class="workspace"><header class="window-bar"><div class="traffic"><i></i><i></i><i></i></div><span>${escapeHtml(crumb)}</span><div class="window-actions"><small>v—</small></div></header>${tourView(index, step.demo)}</section></div>`;
}
function tourSidebar(index) {
  const items = [['all', '⌂', t('所有会议')], ['trash', '◷', t('最近删除')], ['settings', '⚙', t('设置')]];
  return `<aside class="sidebar"><button class="brand"><span class="brand-mark">言</span><img src="./assets/brevia-logo.svg" alt="brevia" /></button><button class="new-meeting${index === 1 ? ' is-tour-highlight' : ''}"><span class="new-meeting-icon">+</span><span class="new-meeting-label">${escapeHtml(t('开始会议'))}</span></button><button class="import-recording"><span class="import-recording-icon">↥</span><span class="import-recording-label">${escapeHtml(t('导入录音'))}</span></button><nav>${items.map(([id, icon, label]) => `<button class="nav-item${id === 'all' ? ' active' : ''}"><span>${icon}</span>${escapeHtml(label)}</button>`).join('')}</nav></aside>`;
}
function tourView(index, demo) {
  const meetingName = demo.meeting || tourMeetingFallback[locale] || 'Meeting';
  const aiSuggestionLabel = tourAiSuggestionFallback[locale] || 'AI';
  const aiToggleLabel = (aiAssistCopy[locale] || aiAssistCopy.en).toggleOff;
  const liveHeader = (time) => `<header class="live-header tour-anim" style="--tour-delay:0ms"><div class="live-title"><strong>${escapeHtml(meetingName)}</strong><div class="live-status"><span class="recording"><i></i>${escapeHtml(t('正在录制'))}</span><time>${time}</time><span class="save-state"><svg class="check-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg>${escapeHtml(t('已保存'))}</span></div></div></header>`;
  const liveControls = `<div class="floating-control-bar live-control-bar"><div class="control-source"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="7" y="2" width="6" height="11" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3m-3 0h6"/></svg><i class="input-meter" style="--level:.7"></i><span>${escapeHtml(t('麦克风'))}</span></div><div class="control-primary"><button class="pause-button">Ⅱ ${escapeHtml(t('暂停'))}</button><button class="end-button">${escapeHtml(t('结束会议'))}</button></div><div class="control-secondary"><button class="mark-button">▯ ${escapeHtml(t('重点'))}</button><button class="live-more-toggle">•••</button></div></div>`;
  const liveModeIcon = (path) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  const captionsPanel = (segments) => `<section class="live-captions tour-anim" style="--tour-delay:160ms"><header class="live-section-head"><p class="eyebrow">${escapeHtml(t('实时字幕'))}</p><button class="live-mode-toggle" data-toggle-live-mode="notes" aria-label="${escapeHtml(t('返回笔记'))}" title="${escapeHtml(t('返回笔记'))}">${liveModeIcon('m10 3-5 5 5 5')}</button></header><div class="transcript-scroll">${segments}</div></section>`;
  const segment = (time, speaker, text, delay = 220) => `<div class="segment tour-anim" style="--tour-delay:${delay}ms"><div class="segment-meta"><time>${time}</time><button class="segment-speaker">${escapeHtml(speaker)}</button></div><div class="segment-copy"><p>${escapeHtml(text)}</p></div></div>`;
  switch (index) {
    case 0: {
      const rows = demo.meetings.map(([title, meta, tags], i) => `<article class="meeting-row tour-anim" style="--tour-delay:${160 + i * 110}ms"><div class="meeting-main"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(meta)}</p><div class="meeting-tags">${(tags || []).map((tag) => `<div class="tag">${escapeHtml(tag)}</div>`).join('')}</div></div><div class="meeting-status"><span class="status">${escapeHtml(t('已精修'))}</span><small>${escapeHtml(demo.time || '14:20')}</small></div><div class="meeting-actions"><button class="more">•••</button></div></article>`).join('');
      return `<section class="view active" id="home-view"><div class="page-head"><div><button class="eyebrow tour-anim" type="button">${escapeHtml(t('会议库'))}</button><h1 class="tour-anim" style="--tour-delay:70ms">${escapeHtml(t('每一场对话，都留有依据。'))}</h1></div></div><div class="library-toolbar tour-anim" style="--tour-delay:110ms"><div class="library-search"><label class="search"><span>⌕</span><input type="search" placeholder="${escapeHtml(t('搜索会议、字幕或说话人…'))}" /></label></div></div><section class="meeting-list">${rows}</section></section>`;
    }
    case 1:
      return `<section class="view active" id="prepare-view"><button class="back tour-anim">← ${escapeHtml(t('返回会议库'))}</button><div class="prepare-layout"><div class="tour-anim" style="--tour-delay:60ms"><p class="eyebrow">${escapeHtml(t('准备录制'))}</p><h1>${escapeHtml(t('开始一场会议'))}</h1><form><label>${escapeHtml(t('会议名称'))}<input value="${escapeHtml(demo.name)}" /></label><div class="form-grid"><label>${escapeHtml(t('会议语言'))}<input value="${escapeHtml(demo.language)}" /></label><label>${escapeHtml(t('译文目标'))}<input value="${escapeHtml(demo.translation || t('不需要翻译'))}" /></label></div><fieldset><legend>${escapeHtml(t('录制来源'))}</legend><div class="capture-settings"><label>${escapeHtml(t('采集模式'))}<div class="flow-select capture-mode-select"><button class="flow-select-toggle" type="button">${escapeHtml(t('自动（记住上次）'))}<span>⌄</span></button></div></label><label>${escapeHtml(t('麦克风设备'))}<div class="flow-select"><button class="flow-select-toggle" type="button">${escapeHtml(t('系统默认'))}<span>⌄</span></button></div></label></div><div class="capture-status"><span><b>${escapeHtml(t('麦克风'))}</b><strong><i class="input-meter" style="--level:.72"></i><span>${escapeHtml(t('输入良好'))}</span></strong></span><span><b>${escapeHtml(t('系统音频'))}</b><strong><span>${escapeHtml(t('已连接'))}</span></strong></span></div></fieldset><button class="primary-action wide tour-anim" style="--tour-delay:200ms">${escapeHtml(t('开始录制'))} <span>→</span></button></form></div></div></section>`;
    case 2: {
      const segments = demo.segments.map(([speaker, text], i) => segment(`${String((i * 3) + 2).padStart(2, '0')}:00`, speaker, text, 240 + i * 130)).join('');
      return `<section class="view active" id="live-view">${liveHeader('04:23')}<div class="live-layout"><section class="live-notes tour-anim" style="--tour-delay:120ms"><header class="live-section-head"><p class="eyebrow">${escapeHtml(t('我的笔记'))}</p><button class="ai-assist-toggle"><span class="ai-assist-toggle-star">✦</span> ${escapeHtml(aiToggleLabel)}</button><button class="live-mode-toggle" data-toggle-live-mode="caption" aria-label="${escapeHtml(t('展开字幕'))}" title="${escapeHtml(t('展开字幕'))}">${liveModeIcon('m6 3 5 5-5 5')}</button></header><div class="notes-editor">${(demo.notes || []).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div></section>${captionsPanel(segments)}</div>${liveControls}</section>`;
    }
    case 3: {
      // AI 纪要步骤的 demo 只含 decision/actions，无字幕；回退到上一步（实时字幕）的片段，
      // 避免渲染出空说话人 + 空文本的字幕行。
      const live = demo.live || demo.segments?.[0] || (tourCopy[locale] || tourCopy.en).steps[2].demo.segments?.[0] || [];
      return `<section class="view active" id="live-view">${liveHeader('07:41')}<div class="live-layout"><section class="live-notes tour-anim" style="--tour-delay:120ms"><header class="live-section-head"><p class="eyebrow">${escapeHtml(t('我的笔记'))}</p><button class="ai-assist-toggle is-enabled"><span class="ai-assist-toggle-star">✦</span> ${escapeHtml(aiToggleLabel)}</button><button class="live-mode-toggle" data-toggle-live-mode="caption" aria-label="${escapeHtml(t('展开字幕'))}" title="${escapeHtml(t('展开字幕'))}">${liveModeIcon('m6 3 5 5-5 5')}</button></header><div class="ai-suggestion tour-anim" style="--tour-delay:220ms"><div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">✦</span><span class="ai-suggestion-type">${escapeHtml(aiSuggestionLabel)}</span></div><p class="ai-suggestion-text">${escapeHtml(demo.decision)}</p></div></div><div class="notes-editor tour-anim" style="--tour-delay:320ms">${(demo.actions || []).map((action) => `<p>• ${escapeHtml(action)}</p>`).join('')}</div></section>${captionsPanel(segment('00:02', live[0] || '', live[1] || '', 300))}</div>${liveControls}</section>`;
    }
    case 4: {
      const meta = demo.meta || (tourCopy[locale] || tourCopy.en).steps[0].demo.meetings[0]?.[1] || '';
      return `<section class="view active" id="detail-view"><button class="back tour-anim">← ${escapeHtml(t('返回会议库'))}</button><header class="detail-head tour-anim" style="--tour-delay:60ms"><div><p class="eyebrow">${escapeHtml(t('本地会议'))}</p><h1>${escapeHtml(meetingName)}</h1><p class="detail-meta">${escapeHtml(meta)}</p></div><div class="detail-actions"><button class="primary-action">${escapeHtml(t('导出与分享'))}</button></div></header><div class="detail-layout"><section class="final-transcript tour-anim" style="--tour-delay:220ms"><div class="tabbar"><div class="tabbar-tabs"><button class="tab active">${escapeHtml(t('精修字幕'))}</button><button class="tab">${escapeHtml(t('原始转写'))}</button></div><button class="tabbar-action">${escapeHtml(t('更多'))}</button></div><div class="refined-fulltext"><div class="refined-fulltext-body">${escapeHtml(demo.refined)}</div></div></section><aside class="notes tour-anim" style="--tour-delay:300ms"><div class="tabbar"><div class="tabbar-tabs"><button class="tab active">${escapeHtml(t('会议纪要'))}</button></div></div><div class="detail-notes-panel"><p>${escapeHtml(demo.summary)}</p></div></aside></div><section class="player floating-control-bar tour-anim" style="--tour-delay:140ms"><div class="player-source"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3V5L6 8H3z"/><path d="M13 7a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/></svg><span>${escapeHtml(t('本地录音'))}</span><span class="player-time">00:00</span></div><div class="player-actions"><button class="skip">↶ 15</button><button class="play">▶</button><button class="skip">15 ↷</button></div><div class="player-meta"><span class="player-duration">17:00</span><div class="player-speed flow-select"><button class="flow-select-toggle" type="button">1× <span>⌄</span></button></div></div><div class="player-track"><input type="range" min="0" max="1" value="0" /></div></section></section>`;
    }
  }
  return '';
}

function updateOnboardingLanguageCopy(nextLocale) {
  if (!onboardingPage || onboardingPreviewLocale === nextLocale) return;
  onboardingPreviewLocale = nextLocale;
  onboardingSelectedLocale = nextLocale;
  const [title, prompt, continueLabel] = onboardingLanguageCopy[nextLocale] || onboardingLanguageCopy.en;
  const nodes = onboardingPage.querySelectorAll('.onboarding-page-copy');
  nodes.forEach((node) => node.classList.add('locale-out'));
  window.setTimeout(() => {
    onboardingPage.querySelector('h1').textContent = title;
    onboardingPage.querySelector('.language-wheel').setAttribute('aria-label', prompt);
    onboardingPage.querySelector('.onboarding-page-copy p').textContent = prompt;
    onboardingPage.querySelector('[type="submit"]').textContent = continueLabel;
    onboardingPage.lang = nextLocale;
    nodes.forEach((node) => { node.classList.remove('locale-out'); node.classList.add('locale-in'); });
    window.setTimeout(() => nodes.forEach((node) => node.classList.remove('locale-in')), 220);
  }, 120);
}

function initializeLanguageWheel(wheel, onSelect = () => {}) {
  const cycleHeight = wheel.scrollHeight / 5;
  let resetTimer;
  const select = (button) => {
    const code = button.dataset.languageWheelValue;
    wheel.closest('form').elements.locale.value = code;
    wheel.querySelectorAll('[data-language-wheel-value]').forEach((option) => option.setAttribute('aria-selected', String(option === button)));
    onSelect(code);
  };
  const selectCentered = () => {
    const center = wheel.scrollTop + wheel.clientHeight / 2;
    const buttons = [...wheel.querySelectorAll('[data-language-wheel-value]')];
    select(buttons.reduce((closest, button) => Math.abs(button.offsetTop + button.offsetHeight / 2 - center) < Math.abs(closest.offsetTop + closest.offsetHeight / 2 - center) ? button : closest));
  };
  requestAnimationFrame(() => {
    const options = [...wheel.querySelectorAll('[data-language-wheel-value]')];
    const selected = options.find((option, index) => option.dataset.languageWheelValue === wheel.closest('form').elements.locale.value && index >= options.length / 2) || options[Math.floor(options.length / 2)];
    if (!selected) return;
    wheel.scrollTop = selected.offsetTop + selected.offsetHeight / 2 - wheel.clientHeight / 2;
    selectCentered();
  });
  wheel.addEventListener('click', (event) => {
    const option = event.target.closest('[data-language-wheel-value]');
    if (option) { select(option); option.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });
  wheel.addEventListener('keydown', (event) => {
    const option = event.target.closest('[data-language-wheel-value]');
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!option || !direction) return;
    event.preventDefault();
    const options = [...wheel.querySelectorAll('[data-language-wheel-value]')];
    const next = options[options.indexOf(option) + direction];
    if (!next) return;
    select(next);
    next.focus();
    next.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  wheel.addEventListener('scroll', () => {
    selectCentered();
    clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      if (wheel.scrollTop < cycleHeight || wheel.scrollTop > cycleHeight * 3) wheel.scrollTop += wheel.scrollTop < cycleHeight ? cycleHeight * 2 : -cycleHeight * 2;
    }, 120);
  });
}

function showOnboardingPage(kind, content) {
  onboardingPage = document.createElement('main');
  onboardingPage.className = `onboarding-page onboarding-active onboarding-${kind}-overlay`;
  onboardingPage.innerHTML = `<div class="onboarding-page-content onboarding-${kind}-content">${content}</div>`;
  document.body.append(onboardingPage);
  requestAnimationFrame(() => onboardingPage.classList.add('onboarding-page-enter'));
}

function dismissOnboardingPage(next) {
  const page = onboardingPage;
  if (!page || page.classList.contains('onboarding-page-leave')) return;
  clearInterval(onboardingAiDemoTimer);
  void breviaClient?.stopPreview();
  // 导览页在 openOnboardingTour 里注册了 resize 监听；页面销毁时同步移除，避免泄漏。
  window.removeEventListener('resize', fitTourWindow);
  page.classList.remove('onboarding-page-enter');
  page.classList.add('onboarding-page-leave');
  if (page.dataset.aiSettings === 'true') { page.classList.remove('modal-enter'); page.classList.add('modal-leave'); }
  window.setTimeout(() => {
    page.remove();
    if (onboardingPage !== page) return;
    onboardingPage = undefined;
    if (page.dataset.aiSettings === 'true' && settingsModal.hidden) document.body.classList.remove('modal-open');
    next?.();
  }, 260);
}

// 识别模型文案（8 语种）由 asr-copy.js 提供；这里只做取值与回退。
const asrText = (group, fallback = 'en') => (asrCopy[group] || {})[locale] || (asrCopy[group] || {})[fallback] || {};
/** 渲染一个 1..3 档的刻度（实心点表示档位）。@returns {string} */
function asrMeter(label, level, words) {
  const safe = Math.max(1, Math.min(3, Number(level) || 1));
  const dots = [1, 2, 3].map((step) => `<i${step <= safe ? ' class="on"' : ''}></i>`).join('');
  return `<span class="asr-meter"><small>${escapeHtml(label)}</small><span class="asr-scale" aria-hidden="true">${dots}</span><b>${escapeHtml(words[safe - 1] || '')}</b></span>`;
}
/** 首启第 ③ 步的可选识别模型：清单里仍未退役的整句识别模型。@returns {object[]} */
function onboardingAsrModels() {
  return refinedModels().filter((model) => !model.bundled);
}
/** 首启默认勾选：按界面语言推导的推荐模型。
 *
 * 用界面语言而不是让用户先选会议语言，是因为他在第 ① 步刚做过这个选择，因果关系自明。
 * @returns {string} 模型 id。 */
function onboardingRecommendedModelId() {
  return manifestDefaultRefinedModelId(locale) || DEFAULT_REFINED_MODEL_ID;
}
async function openOnboardingSetup() {
  try { if (initializationPromise) await initializationPromise; }
  catch (error) { showToast(`${t('配置或后端启动失败')}: ${userFacingError(error.message)}`); openOnboardingPermissions(); return; }
  const copy = asrText('setup');
  const storageCopy = onboardingStorageCopy[locale] || onboardingStorageCopy.en;
  let locations;
  try { locations = await window.brevia.storage.locations(); }
  catch (error) { showToast(error.message); return; }
  const roleWords = asrText('asrRole');
  const modelWords = asrText('model');
  const tierWords = asrText('tiers');
  const recommendedWords = asrCopy.recommended || {};
  const securityHint = onboardingSecurityCopy[locale] || onboardingSecurityCopy.en;
  const recommendedId = onboardingRecommendedModelId();
  const models = onboardingAsrModels();

  const cards = models.map((model) => {
    const installed = modelPaths.has(model.id);
    const words = modelWords[model.id] || {};
    const isRecommended = model.id === recommendedId;
    const role = model.role || (roleWords[model.asr_role] || '');
    const badges = [
      role ? `<span class="asr-badge">${escapeHtml(role)}</span>` : '',
      isRecommended ? `<span class="asr-badge is-recommended">${escapeHtml(recommendedWords[locale] || '')}</span>` : '',
      installed ? `<span class="asr-badge is-installed">${escapeHtml((modelLabels[locale] || modelLabels.en).installed)}</span>` : '',
    ].join('');
    // 默认只勾选按界面语言推导的推荐模型。
    // 勾选只决定「这一轮下载哪几个」（updateOnboardingSetup 会把已安装的过滤掉），
    // 所以没有必要替用户把所有已安装的模型也预选上——那只是让用户多点几次取消。
    // 任何模型都不禁用：即使用户已经装过，他也必须能取消勾选。
    return `<label class="onboarding-model-card${isRecommended ? ' is-recommended' : ''}">`
      + `<input type="checkbox" name="onboarding-model" value="${escapeHtml(model.id)}"`
      + `${isRecommended ? ' checked' : ''} />`
      + `<span class="asr-card-body">`
      + `<span class="asr-card-head"><b>${escapeHtml(model.name)}</b>${badges}</span>`
      + `<small class="asr-tagline">${escapeHtml(words.tagline || '')}</small>`
      + `<span class="asr-meters">`
      + asrMeter(tierWords.speedLabel || '', model.speed, tierWords.speed || [])
      + asrMeter(tierWords.qualityLabel || '', model.quality, tierWords.quality || [])
      + `</span>`
      + `<i class="asr-size">${installed ? (modelLabels[locale] || modelLabels.en).installed : formatBytes(model.size_bytes || 0)}</i>`
      + `</span></label>`;
  }).join('');

  const bundled = modelCatalog.filter((model) => model.bundled);
  const bundledSize = bundled.reduce((total, model) => total + (model.size_bytes || 0), 0);
  const bundledRow = `<div class="onboarding-bundled"><span><b>${escapeHtml(copy.bundledTitle || '')}</b>`
    + `<small>${escapeHtml(copy.bundledDetail || '')}</small></span>`
    + `<i>${escapeHtml(formatBytes(bundledSize))}</i></div>`;

  const storageRow = (key, label, managed) => `<div class="onboarding-folder-row"><span><b>${escapeHtml(label)}</b><small data-storage-path="${key}" title="${escapeHtml(locations[key])}">${escapeHtml(locations[key])}</small></span><button class="secondary" data-select-storage="${key}" type="button"${managed ? '' : ' disabled'}>${escapeHtml(storageCopy.choose)}</button></div>`;
  const storageRows = `<section class="onboarding-section onboarding-folder-section"><h2>${escapeHtml(storageCopy.title)}</h2>${storageRow('models', storageCopy.models, locations.modelsManaged)}${storageRow('recordings', storageCopy.recordings, locations.recordingsManaged)}</section>`;

  showOnboardingPage('setup',
    `<section class="onboarding-setup-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="${t('返回')}">←</button>`
    + `<header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${escapeHtml(copy.title || '')}</h1>`
    + `<div class="onboarding-intro"><small>${securityHint}</small></div></header>`
    + storageRows
    + `<section class="onboarding-section onboarding-model-selection"><h2>${escapeHtml(copy.pickHint || '')}</h2>`
    + `<div class="onboarding-model-grid">${cards}</div></section>`
    + `<section class="onboarding-section onboarding-bundled-section">${bundledRow}</section>`
    + `<section class="onboarding-model-summary"><strong>${escapeHtml(copy.estimate || '')}: <span data-onboarding-estimate></span></strong>`
    + `<small data-onboarding-guard hidden>${escapeHtml(copy.atLeastOne || '')}</small>${chinaModelSourceToggle()}</section>`
    + `<div class="onboarding-actions"><button class="modal-action" data-download-onboarding-models type="button">${escapeHtml(copy.download || '')}</button>`
    + `<button class="secondary" data-finish-onboarding type="button">${escapeHtml(copy.later || '')}</button></div></section>`);

  updateOnboardingSetup();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-model"]')) updateOnboardingSetup();
    if (event.target.matches('[data-china-model-source]')) localStorage.setItem('brevia-china-model-source', event.target.checked);
  });
  onboardingPage.addEventListener('click', async (event) => {
    if (event.target.closest('[data-onboarding-back-language]')) { dismissOnboardingPage(openOnboardingPermissions); return; }
    const select = event.target.closest('[data-select-storage]');
    if (select) {
      try {
        const directory = await window.brevia.storage.chooseFolder();
        if (directory) {
          locations[select.dataset.selectStorage] = directory;
          const path = onboardingPage.querySelector(`[data-storage-path="${select.dataset.selectStorage}"]`);
          path.textContent = directory;
          path.title = directory;
        }
      } catch (error) { showToast(error.message); }
      return;
    }
    const download = event.target.closest('[data-download-onboarding-models]');
    const later = event.target.closest('[data-finish-onboarding]');
    if (!download && !later) return;
    if (download && !onboardingModelReady) return;
    download?.setAttribute('disabled', '');
    later?.setAttribute('disabled', '');
    try {
      await withStorageMigration(async () => {
        const result = await window.brevia.storage.setupLocations({ models: locations.models, recordings: locations.recordings });
        if (result.data) applyInitializationResult(result.data);
        if (download) {
          window.BreviaOnboarding.beginDownloads(onboardingModelIds);
          downloadRequiredModels(onboardingModelIds);
        }
        dismissOnboardingPage(openOnboardingAi);
      });
    } catch (error) {
      showToast(storageErrorMessage(error));
      if (download) download.disabled = false;
      if (later) later.disabled = false;
    }
  });
}

function updateOnboardingSetup() {
  const inputs = [...onboardingPage.querySelectorAll('[name="onboarding-model"]')];
  const checked = inputs.filter((input) => input.checked).map((input) => input.value);
  onboardingModelIds = checked.filter((modelId) => !modelPaths.has(modelId));
  const size = onboardingModelIds.reduce((total, modelId) => total + modelSize(modelId), 0);
  const estimate = onboardingPage.querySelector('[data-onboarding-estimate]');
  if (estimate) estimate.textContent = formatBytes(size);
  // 守卫问的是「能不能出字幕」，不是「勾了几个」。已装在本地、但用户没勾的模型照样能出字幕，
  // 所以取消勾选全部已安装模型之后仍然放行——否则全装过的用户会被一句「无法生成字幕」
  // 堵在这里，而那句话在这个状态下是假的。
  const anyInstalled = inputs.some((input) => modelPaths.has(input.value));
  const missing = checked.length === 0 && !anyInstalled;
  onboardingModelReady = !missing;
  const download = onboardingPage.querySelector('[data-download-onboarding-models]');
  const guard = onboardingPage.querySelector('[data-onboarding-guard]');
  if (download) download.disabled = missing;
  if (guard) guard.hidden = !missing;
}

function finishOnboarding() {
  window.BreviaOnboarding.complete();
  closeModal();
}
// Onboarding 的 AI 辅助配置页（PRD §22）：离线功能配置之后进入。
const aiOnboardingCopy = window.BreviaLocaleData.appCopy.aiOnboardingCopy;
const aiOnboardingDemoCopy = window.BreviaLocaleData.appCopy.aiOnboardingDemoCopy;
// AI 会议纪要演示：会后左下角出现任务卡片（进度条），随后显示整理好的纪要。
const aiOnboardingSummaryDemoCopy = window.BreviaLocaleData.appCopy.aiOnboardingSummaryDemoCopy;
// 首次引导功能演示（tour）文案。
const tourCopy = window.BreviaLocaleData.appCopy.tourCopy;
function openOnboardingAi(settingsMode = false) {
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  // 低配设备默认「暂不开启」实时 AI 笔记（太耗资源），仅保留会后一次性的 AI 会议纪要。
  const defaultProactivity = settingsMode ? aiAssistConfig.proactivity : (deviceIsWeak() ? 'off' : 'assist');
  const levels = copy.levels.filter(([value]) => ['assist', 'auto'].includes(value) || (settingsMode && value === 'quiet')).map(([value, title]) => [value, title]);
  const brand = locale === 'zh' ? '<div class="onboarding-brand-name"><span>言</span><b>言录</b></div>' : '<img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" />';
  const summaryIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 11h6M9 15h6M9 19h4"/></svg>';
  const notesIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a2 2 0 0 1 2 2v6M5 4v16h9M8 9h7M8 13h5"/><path d="m16 17 1.5-3 1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5z"/></svg>';
  const content = `<section class="${settingsMode ? 'ai-features-content' : 'onboarding-setup-page'} onboarding-ai-setup-page">
    ${settingsMode ? '' : `<button class="onboarding-back" data-onboarding-back-language type="button" aria-label="${t('返回')}">←</button>
    <header>${brand}<h1>${escapeHtml(copy.title)}</h1>${copy.intro ? `<div class="onboarding-intro"><p>${escapeHtml(copy.intro)}</p></div>` : ''}</header>`}
    <section class="onboarding-section onboarding-ai-feature onboarding-ai-row">
      <div class="onboarding-ai-copy">
        <div class="onboarding-ai-feature-head"><span class="onboarding-ai-icon">${summaryIcon}</span><h2>${escapeHtml(copy.meetingNotesTitle)}</h2><label class="onboarding-ai-switch"><input type="checkbox" name="onboarding-summary-enabled" aria-label="${escapeHtml(copy.meetingNotesTitle)}"${summaryConfig.enabled ? ' checked' : ''} /></label></div>
        <p class="onboarding-ai-feature-desc">${escapeHtml(copy.meetingNotesDesc)}</p>
        <p class="onboarding-ai-way-title">${escapeHtml(copy.wayTitle)}</p>
        <div class="onboarding-ai-ways"><label><input type="radio" name="onboarding-ai-way" value="built-in"${summaryConfig.provider === 'built-in' ? ' checked' : ''} /><span><b>${escapeHtml(copy.builtin)}</b><small>${escapeHtml(copy.builtinHint)}</small></span></label><label><input type="radio" name="onboarding-ai-way" value="online"${summaryConfig.provider !== 'built-in' ? ' checked' : ''} /><span><b>${escapeHtml(copy.online)}${recommendTag(deviceIsWeak())}</b><small>${escapeHtml(copy.onlineHint)}</small></span></label></div>
      </div><div class="onboarding-ai-frame" data-onboarding-summary-demo></div>
    </section>
    <section class="onboarding-section onboarding-ai-feature onboarding-ai-row">
      <div class="onboarding-ai-copy">
        <div class="onboarding-ai-feature-head"><span class="onboarding-ai-icon">${notesIcon}</span><h2>${escapeHtml(copy.liveNotesTitle)}</h2><label class="onboarding-ai-switch"><input type="checkbox" name="onboarding-ai-enabled" aria-label="${escapeHtml(copy.enableLiveNotes)}"${(settingsMode ? aiAssistConfig.enabled : defaultProactivity !== 'off') ? ' checked' : ''} /></label></div>
        <p class="onboarding-ai-feature-desc">${escapeHtml(copy.liveNotesDesc)}</p>
        <label class="onboarding-ai-way-title" for="onboarding-ai-proactivity">${escapeHtml(copy.proactivityTitle)}</label>
        <div class="onboarding-ai-levels">${flowSelect('onboarding-ai-proactivity', defaultProactivity, levels)}</div>
        ${copy.proactivityHint ? `<small class="onboarding-ai-feature-hint">${escapeHtml(copy.proactivityHint)}</small>` : ''}
        ${settingsMode ? `<button class="secondary" data-configure-ai-notes type="button">${escapeHtml(t('配置 AI 笔记'))}</button>` : ''}
      </div><div class="onboarding-ai-frame"><aside class="onboarding-ai-demo" data-onboarding-ai-demo></aside></div>
    </section>
    <div class="onboarding-actions"><button class="secondary" data-onboarding-ai-skip type="button">${escapeHtml(settingsMode ? t('取消') : copy.skip)}</button><button class="modal-action" data-onboarding-ai-finish type="button">${escapeHtml(settingsMode ? t('保存配置') : copy.finish)}</button></div>
  </section>`;
  if (settingsMode) {
    onboardingPage = document.createElement('div');
    onboardingPage.className = 'modal-backdrop ai-features-modal';
    onboardingPage.innerHTML = `<section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="ai-features-title"><header class="modal-head"><div class="modal-title"><h2 id="ai-features-title">${escapeHtml(t('AI 功能'))}</h2></div><button class="modal-close" data-close-ai-features type="button" aria-label="${escapeHtml(t('关闭'))}">×</button></header><div class="modal-body">${content}</div></section>`;
    document.body.append(onboardingPage);
    document.body.classList.add('modal-open');
    const page = onboardingPage;
    requestAnimationFrame(() => page.classList.add('modal-enter'));
    page.querySelector('[data-close-ai-features]').focus();
  } else showOnboardingPage('setup', content);
  onboardingPage.dataset.aiSettings = String(settingsMode);
  onboardingPage.querySelector('.onboarding-ai-levels .flow-select-toggle').id = 'onboarding-ai-proactivity';
  renderOnboardingAiDemo();
  renderOnboardingSummaryDemo();
  const syncSummarySwitch = () => {
    const enabled = onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked;
    onboardingPage.querySelectorAll('[name="onboarding-ai-way"]').forEach((option) => { option.disabled = !enabled; });
    onboardingPage.querySelector('[data-onboarding-summary-demo]').classList.toggle('is-disabled', !enabled);
  };
  syncSummarySwitch();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-summary-enabled"]')) syncSummarySwitch();
    if (event.target.matches('[name="onboarding-ai-proactivity"], [name="onboarding-ai-enabled"]')) {
      renderOnboardingAiDemo();
    }
  });
  onboardingPage.addEventListener('click', (event) => {
    if (settingsMode && (event.target === onboardingPage || event.target.closest('[data-close-ai-features]'))) { dismissOnboardingPage(); return; }
    const toggle = event.target.closest('.onboarding-ai-levels [data-flow-select-toggle]');
    if (toggle) {
      if (toggle.disabled) return;
      const options = toggle.parentElement.querySelector('.flow-select-options');
      options.hidden = !options.hidden;
      toggle.setAttribute('aria-expanded', String(!options.hidden));
      return;
    }
    const choice = event.target.closest('[data-flow-select-choice="onboarding-ai-proactivity"]');
    if (choice) {
      if (choice.disabled) return;
      const select = choice.closest('.flow-select');
      const input = select.querySelector('input');
      input.value = choice.dataset.value;
      select.querySelector('.flow-select-toggle').firstChild.nodeValue = choice.dataset.label;
      select.querySelector('.flow-select-options').hidden = true;
      select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const aiWay = event.target.closest('.onboarding-ai-ways label');
    if (aiWay) {
      if (!onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked) return;
      onboardingOnlineProvider = !aiWay.querySelector('[value="built-in"]');
      onboardingBuiltinProvider = !onboardingOnlineProvider;
      summaryConfigDraft = structuredClone(summaryConfig);
      summaryConfigDraft.provider = onboardingOnlineProvider ? (summaryConfig.provider === 'built-in' ? 'openai' : summaryConfig.provider) : 'built-in';
      openModal('summary-model');
      return;
    }
    if (event.target.closest('[data-configure-ai-notes]')) {
      aiAssistConfigDraft = structuredClone(aiAssistConfig);
      aiAssistConfigDraft.enabled = onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked;
      aiAssistConfigDraft.proactivity = onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value || 'assist';
      openModal('ai-assist');
      return;
    }
    if (event.target.closest('[data-onboarding-back-language]')) { dismissOnboardingPage(settingsMode ? undefined : openOnboardingSetup); return; }
    if (event.target.closest('[data-onboarding-ai-finish]')) { void finishAiOnboarding(undefined, settingsMode); return; }
    if (event.target.closest('[data-onboarding-ai-skip]')) {
      if (settingsMode) dismissOnboardingPage();
      else void finishAiOnboarding(false);
      return;
    }
  });
}
async function finishAiOnboarding(forceEnabled, settingsMode = false) {
  const proactivity = onboardingPage.querySelector('[name="onboarding-ai-proactivity"]')?.value || 'assist';
  const enabled = typeof forceEnabled === 'boolean' ? forceEnabled : onboardingPage.querySelector('[name="onboarding-ai-enabled"]')?.checked;
  const summaryEnabled = forceEnabled === false ? false : Boolean(onboardingPage.querySelector('[name="onboarding-summary-enabled"]')?.checked);
  if (settingsMode) {
    const ready = (config) => {
      const connection = requestConfig(config);
      return connection && (connection.provider !== 'built-in' || modelPaths.has(connection.model));
    };
    if (summaryEnabled && !ready(summaryConfig)) { showToast(t('请先选择或填写纪要模型。')); return; }
    if (enabled && !ready(aiAssistConfig)) { showToast(t('请先选择或填写 AI 笔记模型。')); return; }
  }
  summaryConfig.enabled = summaryEnabled;
  summaryConfigRevision += 1;
  aiAssistConfig.enabled = enabled;
  aiAssistConfig.proactivity = ['quiet', 'assist', 'auto'].includes(proactivity) ? proactivity : 'assist';
  aiAssistConfigRevision += 1;
  try { await Promise.all([persistSummaryConfig(), persistAiAssistConfig()]); }
  catch (error) { showToast(error.message); return; }
  if (settingsMode) {
    aiAssistTemporarilyDisabled = false;
    renderAiAssistToggle();
    renderAiAssistEmptyState();
    const meetingId = breviaClient?.state.meeting?.id;
    if (meetingActive && meetingId) {
      if (aiAssistEnabled()) void startAiNoteForMeeting(meetingId);
      else stopAiNoteForMeeting(meetingId);
    }
    dismissOnboardingPage();
    showToast(t('已保存'));
  } else dismissOnboardingPage(openOnboardingTour);
}

function openOnboardingPermissions() {
  const copy = onboardingCopy[locale] || onboardingCopy.en;
  const steps = [
    ['microphone', t('麦克风'), t('录制你的发言。')],
    ['screen', t('屏幕与系统音频'), t('录制屏幕共享中的系统声音。')],
  ];
  const placeholders = steps.map(([permission, label, detail], index) => `<div class="onboarding-permission"><span class="onboarding-permission-state">${index + 1}</span><span><b>${label}</b><small>${detail}</small></span><button class="modal-action onboarding-permission-action onboarding-permission-placeholder" type="button" disabled>${permission === 'microphone' ? t('允许') : t('继续')}</button></div>`).join('') + `<div class="onboarding-permission-complete onboarding-permission-placeholder" aria-hidden="true">&nbsp;</div>`;
  showOnboardingPage('permissions', `<section class="onboarding-setup-page onboarding-permissions-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="${t('返回')}">←</button><header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${t('录制权限')}</h1><div class="onboarding-intro"><p>${t('言录需要以下系统权限以提供服务')}</p></div></header><section class="onboarding-section" data-onboarding-permissions>${placeholders}</section><div class="onboarding-actions"><button class="modal-action" data-finish-onboarding type="button" disabled>${t('继续')}</button><button class="secondary" data-skip-onboarding-permissions type="button">${copy.later}</button></div></section>`);
  const page = onboardingPage;
  const section = onboardingPage.querySelector('[data-onboarding-permissions]');
  const continueButton = onboardingPage.querySelector('[data-finish-onboarding]');
  let microphonePreviewed = false;
  const render = async () => {
    const status = await window.brevia.permissions.status();
    const permissionGranted = (permission) => grantedPermissions.has(permission) || status[permission] === 'granted';
    const next = steps.find(([permission]) => !permissionGranted(permission) && (permission !== 'screen' || status.systemAudioSupported));
    section.innerHTML = steps.map(([permission, label, detail], index) => {
      const unsupported = permission === 'screen' && !status.systemAudioSupported;
      const granted = permissionGranted(permission);
      const value = granted ? 'granted' : status[permission];
      const active = next?.[0] === permission;
      const state = granted ? checkIconSvg : active ? String(index + 1) : '—';
      const action = granted ? `<button class="onboarding-permission-action onboarding-permission-granted" type="button" disabled>${t('已允许')}</button>` : active ? `<button class="modal-action onboarding-permission-action" ${permission === 'screen' ? 'data-open-screen-settings' : 'data-request-onboarding-permission="microphone"'} type="button">${t('允许')}</button>` : value === 'denied' && !unsupported ? `<button class="modal-action onboarding-permission-action" data-open-${permission}-settings type="button">${t('允许')}</button>` : '';
      const hint = unsupported ? t('当前系统不支持直接录制系统音频，请仅使用麦克风') : granted ? t('已允许') : value === 'denied' ? t('请在系统设置中允许') : detail;
      const meter = permission === 'microphone' && granted ? `<i class="input-meter onboarding-mic-meter" data-onboarding-mic-level aria-label="${t('麦克风')} ${t('音量')}"></i>` : '';
      return `<div class="onboarding-permission${granted ? ' is-granted' : ''}"><span class="onboarding-permission-state">${state}</span><span><span class="onboarding-permission-title"><b>${label}</b>${meter}</span><small>${hint}</small></span>${action}</div>`;
    }).join('');
    if (permissionGranted('microphone') && !microphonePreviewed) {
      microphonePreviewed = true;
      void breviaClient?.previewMic().catch((error) => { microphonePreviewed = false; showToast(error.message); });
    }
    if (!permissionGranted('microphone') && microphonePreviewed) {
      microphonePreviewed = false;
      void breviaClient?.stopPreview();
    }
    const complete = steps.every(([permission]) => permissionGranted(permission));
    continueButton.disabled = !complete;
    section.insertAdjacentHTML('beforeend', complete ? `<div class="onboarding-permission-complete">${checkIconSvg} ${t('录制权限')} ${t('已准备就绪')}</div>` : `<div class="onboarding-permission-complete onboarding-permission-placeholder" aria-hidden="true">&nbsp;</div>`);
  };
  const grantedPermissions = new Set();
  void render();
  const permissionPoll = window.setInterval(() => {
    if (onboardingPage !== page) { window.clearInterval(permissionPoll); return; }
    void render();
  }, 1000);
  onboardingPage.addEventListener('click', async (event) => {
    if (event.target.closest('[data-onboarding-back-language]')) { dismissOnboardingPage(() => openOnboardingLanguage(onboardingSelectedLocale)); return; }
    if (event.target.closest('[data-finish-onboarding]')) { dismissOnboardingPage(openOnboardingSetup); return; }
    if (event.target.closest('[data-skip-onboarding-permissions]')) { dismissOnboardingPage(openOnboardingSetup); return; }
    if (event.target.closest('[data-open-microphone-settings]')) { await window.brevia.permissions.openMicrophoneSettings(); return; }
    if (event.target.closest('[data-open-screen-settings]')) { await window.brevia.permissions.openScreenSettings(); return; }
    const button = event.target.closest('[data-request-onboarding-permission]');
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.requestOnboardingPermission === 'microphone') {
        if (!await window.brevia.permissions.requestMicrophone()) throw new Error(t('请在系统设置中允许'));
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stopMediaStream(stream);
        grantedPermissions.add('microphone');
      }
    } catch (error) {
      showToast(error.message);
    }
    await render();
  });
}

document.querySelector('#settings-view .settings-grid').addEventListener('click', async (event) => {
  const folder = event.target.closest('[data-change-folder]');
  if (folder) {
    folder.disabled = true;
    try {
      const chosen = await window.brevia.storage.chooseFolder();
      if (!chosen) return;
      await withStorageMigration(async () => {
        const locations = await window.brevia.storage.locations();
        playerAudio.pause();
        playerAudio.removeAttribute('src');
        playbackStarted = false;
        renderMiniPlayback();
        const result = await window.brevia.storage.setupLocations({ ...locations, [folder.dataset.changeFolder]: chosen });
        if (result.data) {
          applyInitializationResult(result.data);
          if (currentMeetingDetail?.id) applyBackendDetail(await window.brevia.meeting.get({ meeting_id: currentMeetingDetail.id }));
        }
        await refreshSettingsFolderRows();
        if (result.changed) showToast((onboardingStorageCopy[locale] || onboardingStorageCopy.en).moved);
      });
    }
    catch (error) { showToast(storageErrorMessage(error)); }
    finally { folder.disabled = false; }
    return;
  }
  const button = event.target.closest('[data-settings-modal]');
  if (button) openModal(button.dataset.settingsModal);
  if (event.target.closest('[data-open-whats-new]')) openModal('whats-new');
});
let modelAction = document.querySelector('[data-settings-modal="models"]');
speakerProfileCard.querySelector('button').addEventListener('click', () => openModal('speaker-profiles'));
// 模型是否已安装只由 modelPaths 表示（后端每次 models.list() 都会给出权威 path）。
// 这里以前还维护过一份 installedModelNames（按显示名，靠 `.replace(' 0.6B int8', '')`
// 去凑 i18n 里的名字），但它没有任何读者：installModel / deleteInstalledModel /
// isModelInstalled 三个函数只是为了喂它。整条链路已删除。
const modelPaths = new Map();
/** 在语言环境或模型列表更改后同步已安装模型操作。@returns {void} */
function renderModelControls() {
  modelAction = document.querySelector('[data-settings-modal="models"]');
  modelAction.textContent = (modelLabels[locale] || modelLabels.en).manage;
}
/** 热切换当前会议的实时配置（语言/整句识别模型）。@param {object} changes 部分配置。@returns {Promise<void>} */
async function reconfigureLive(changes) {
  const meetingId = breviaClient?.state.meeting?.id;
  if (!window.brevia || !meetingId) return false;
  // 乐观应用，以便控件感觉即时；meeting.reconfigured 事件确认它。
  const previous = { ...liveConfig };
  liveConfig = { ...liveConfig, ...changes };
  try {
    const result = await window.brevia.meeting.reconfigure({ meeting_id: meetingId, ...changes });
    if (result?.model_required) {
      // 模型没装：排队等下载完成后再切换，避免用户以为「点了没反应」。
      liveConfig = previous;
      queueModelTask('meeting.reconfigure', { meeting_id: meetingId, ...changes }, result.model_required);
      downloadRequiredModels(result.model_required);
      activateTaskCard(document.querySelector('#model-download-queue'));
      showToast(t('正在下载模型，完成后会自动切换'));
      return false;
    }
    return true;
  } catch (error) {
    liveConfig = previous;
    showToast(error.message);
    return false;
  }
}
renderModelControls();
settingsModal.addEventListener('click', async (event) => {
  if (event.target === settingsModal || event.target.closest('.modal-close')) { closeModal(); return; }
  if (event.target.closest('[data-cancel-confirmation]')) { confirmationAction = undefined; closeModal(); return; }
  if (event.target.closest('[data-use-ai-2b]')) {
    // switchAiAssistTo2B 自带成功/失败 toast。仅当是从「AI 笔记」或「性能」设置框
    // 进入时重渲染该框；从会中瓶颈弹窗进入（activeModal 为空）则保持弹窗不跳走。
    await switchAiAssistTo2B();
    if (activeModal === 'ai-assist') renderModal(activeModal);
    return;
  }
  if (event.target.closest('[data-disable-ai-assist]')) { temporarilyDisableAiAssist(); closeModal(); return; }
  if (event.target.closest('[data-reset-advanced-settings]')) { advancedSettings.settings = advancedSettings.defaults; renderModal('advanced-settings'); return; }
  const openPermission = event.target.closest('[data-open-permission-settings]');
  if (openPermission) {
    try { await (openPermission.dataset.openPermissionSettings === 'screen' ? window.brevia.permissions.openScreenSettings() : window.brevia.permissions.openMicrophoneSettings()); }
    catch (error) { showToast(error.message); }
    return;
  }
  const requestPermission = event.target.closest('[data-request-permission]');
  if (requestPermission) {
    requestPermission.disabled = true;
    try {
      if (!await window.brevia.permissions.requestMicrophone()) throw new Error(t('请在系统设置中允许'));
      stopMediaStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
    } catch (error) { showToast(error.message); }
    permissionStatus = await window.brevia?.permissions.status().catch(() => permissionStatus);
    const section = settingsModal.querySelector('[data-permission-settings]');
    if (section) section.outerHTML = renderPermissionSettings();
    return;
  }
  if (event.target.closest('[data-confirm-action]')) { const action = confirmationAction; confirmationAction = undefined; closeModal(); await action?.(); return; }
  const batchExportFormat = event.target.closest('[data-batch-export-format]');
  if (batchExportFormat) { closeModal(); void exportSelectedMeetings(batchExportFormat.dataset.batchExportFormat); return; }
  const openStorage = event.target.closest('[data-open-storage]');
  if (openStorage) { try { await window.brevia?.storage.open({ partition: openStorage.dataset.openStorage }); } catch (error) { showToast(error.message); } return; }
  const clearStorage = event.target.closest('[data-clear-storage]');
  if (clearStorage) {
    const partition = clearStorage.dataset.clearStorage;
    openConfirmation(t('清空数据'), t('此操作不可恢复。'), async () => {
      try { await window.brevia?.storage.clear({ partition }); renderModal('storage'); showToast(t('已清空')); } catch (error) { showToast(error.message); }
    });
    return;
  }
  if (event.target.closest('[data-cleanup-storage]')) {
    try {
      const result = await window.brevia?.storage.cleanup();
      renderModal('storage');
      const copy = storageCleanupCopy[locale] || storageCleanupCopy.en;
      showToast(copy.done.replace('{size}', formatBytes(result.freed_bytes)));
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-regenerate-summary]')) { closeModal(); void generateMeetingSummary(); return; }
  const exportSave = event.target.closest('[data-export-save]');
  if (exportSave) {
    exportSave.disabled = true;
    try {
      const result = await runExportBundle('save');
      if (result && result.count !== null) {
        closeModal();
        const copy = exportHubCopy[locale] || exportHubCopy.en;
        showToast(result.count > 1 ? copy.savedBundle : t('已导出「{title}」').replace('{title}', currentMeetingDetail?.title || ''));
      } else exportSave.disabled = false;
    } catch (error) { exportSave.disabled = false; showToast(error.message); }
    return;
  }
  const shareTarget = event.target.closest('[data-share-target]');
  if (shareTarget) {
    const target = shareTarget.dataset.shareTarget;
    shareTarget.disabled = true;
    try {
      if (target === 'system') {
        // 原生分享面板:把所选文件(多项时打包)交给系统,可转发到 AirDrop / 微信 / 邮件等任意 App。
        // 传点击坐标让弹窗锚定在按钮处;不关闭面板,否则原生弹窗会孤立浮现。
        await runExportBundle('system', { x: Math.round(event.clientX), y: Math.round(event.clientY) });
        shareTarget.disabled = false;
      } else {
        const text = exportShareText();
        if (!text) throw new Error(t('暂无可分享的内容'));
        if (target === 'copy') {
          await window.brevia?.share.copyText({ text });
          closeModal(); showToast(t('已复制到剪贴板'));
        } else if (target === 'email') {
          const subject = currentMeetingDetail?.title || '';
          await window.brevia?.share.openExternal({ url: buildMailto(subject, text) });
          closeModal();
        } else {
          const spec = shareSocialUrls[target];
          const title = currentMeetingDetail?.title || '';
          const combined = title && text ? `${title}\n\n${text}` : title || text;
          const excerpt = makeExcerpt(combined, spec.limit);
          if (!excerpt) throw new Error(t('暂无可分享的内容'));
          await window.brevia?.share.openExternal({ url: spec.url(excerpt) });
          closeModal();
        }
      }
    } catch (error) { shareTarget.disabled = false; showToast(error.message); }
    return;
  }
  const selectToggle = event.target.closest('[data-flow-select-toggle]');
  if (selectToggle) {
    const options = selectToggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    settingsModal.querySelectorAll('.flow-select-options').forEach((list) => { list.hidden = true; list.previousElementSibling.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
    options.hidden = !opening;
    selectToggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const selectChoice = event.target.closest('[data-flow-select-choice]');
  if (selectChoice) {
    const select = selectChoice.closest('.flow-select');
    const choiceName = selectChoice.dataset.flowSelectChoice;
    const value = selectChoice.dataset.value;
    select.querySelector('input').value = value;
    // 用 data-label 回填，不用 textContent：选项里还带推荐角标的文字，
    // 直接取 textContent 会把「推荐」一起搬进收起态。
    select.querySelector('.flow-select-toggle').firstChild.nodeValue = selectChoice.dataset.label || selectChoice.textContent;
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');

    // 切换供应商只改当前选择；每个供应商已填的字段留在 providers 里，切回来仍在。
    if (choiceName === 'provider' && summaryProviders.includes(value)) {
      const aiForm = selectChoice.closest('.ai-assist-config-form');
      const config = aiForm ? aiAssistConfigDraft : summaryConfigDraft;
      config.provider = value;
      if (aiForm) selectedAiAssistBuiltinModel = '';
      else selectedBuiltinModel = '';
      renderModal(activeModal === 'ai-assist' ? 'ai-assist' : 'summary-model');
      return;
    }
    // 换内置模型：记进草稿并重画，让下面的说明与速度/质量刻度跟着换。
    if (choiceName === 'model') {
      const aiForm = selectChoice.closest('.ai-assist-config-form');
      if (aiForm) selectedAiAssistBuiltinModel = value;
      else selectedBuiltinModel = value;
      renderModal(activeModal === 'ai-assist' ? 'ai-assist' : 'summary-model');
      return;
    }
    // 导出与分享面板里的格式选择。
    if (choiceName.startsWith('export-format-')) {
      exportSelection[choiceName.slice('export-format-'.length)] = value;
      return;
    }
    return;
  }
  // 从功能设置跳到模型库：安装与删除只在那里做，这里只负责「用哪个」。
  // 草稿留在模块级变量里，所以跳过去再回来时用户已经改的配置不会丢。
  if (event.target.closest('[data-open-models-from-config]')) {
    // 只对「跳过去时还没装的内置 AI 模型」生效一次：否则用户在模型库里顺手下别的
    // llama-chat 模型（或下游览一圈再回来）也会被莫名其妙地弹回纪要设置页。
    modelsReturnTo = activeModal === 'ai-assist' ? 'ai-assist' : 'summary-model';
    modelsReturnToPending = new Set(
      modelCatalog.filter((model) => model.kind === 'llama-chat' && !modelPaths.has(model.id)).map((model) => model.id)
    );
    activeModal = 'models';
    renderModal('models');
    return;
  }
  const toggleSpeakerSamples = event.target.closest('[data-toggle-speaker-samples]');
  if (toggleSpeakerSamples) {
    const profileId = toggleSpeakerSamples.dataset.toggleSpeakerSamples;
    expandedSpeakerProfileId = expandedSpeakerProfileId === profileId ? null : profileId;
    if (expandedSpeakerProfileId && window.brevia) {
      try { speakerSamples.set(profileId, await window.brevia.speakerProfile.samples({ profile_id: profileId })); } catch (error) { showToast(error.message); }
    }
    renderModal('speaker-profiles');
    return;
  }
  const addSpeakerSample = event.target.closest('[data-add-speaker-sample]');
  if (addSpeakerSample) {
    addingSampleProfileId = addSpeakerSample.dataset.addSpeakerSample;
    renderModal('speaker-profiles');
    settingsModal.querySelector('.speaker-sample-form input')?.focus();
    return;
  }
  if (event.target.closest('[data-cancel-speaker-sample]')) {
    addingSampleProfileId = null;
    renderModal('speaker-profiles');
    return;
  }
  const playSpeakerSample = event.target.closest('[data-play-speaker-sample]');
  if (playSpeakerSample) {
    if (speakerSampleAudio._button === playSpeakerSample && !speakerSampleAudio.paused) {
      speakerSampleAudio.pause();
      playSpeakerSample.textContent = '▶';
      return;
    }
    speakerSampleAudio.pause();
    if (speakerSampleAudio._button) speakerSampleAudio._button.textContent = '▶';
    const sample = [...speakerSamples.values()].flat().find((item) => item.id === playSpeakerSample.dataset.playSpeakerSample);
    if (!sample?.audio_path) { showToast(t('未找到录音文件')); return; }
    try {
      speakerSampleAudio.src = await window.brevia.audioUrl(sample.audio_path);
      speakerSampleAudio._button = playSpeakerSample;
      await speakerSampleAudio.play();
      playSpeakerSample.textContent = '❚❚';
    } catch (error) { showToast(error.message); }
    return;
  }
  const deleteSpeakerSample = event.target.closest('[data-delete-speaker-sample]');
  if (deleteSpeakerSample) {
    if (deleteSpeakerSample.disabled) return;
    deleteSpeakerSample.disabled = true;
    const profileId = deleteSpeakerSample.dataset.profileId;
    try {
      await window.brevia?.speakerProfile.deleteSample({ profile_id: profileId, sample_id: deleteSpeakerSample.dataset.deleteSpeakerSample });
      speakerProfiles = await window.brevia.speakerProfile.list();
      speakerSamples.set(profileId, await window.brevia.speakerProfile.samples({ profile_id: profileId }));
    } catch (error) { showToast(error.message); }
    renderModal('speaker-profiles');
    return;
  }
  const deleteSpeakerProfile = event.target.closest('[data-delete-speaker-profile]');
  if (deleteSpeakerProfile) {
    try { await window.brevia?.speakerProfile.delete({ profile_id: deleteSpeakerProfile.dataset.deleteSpeakerProfile }); speakerProfiles = await window.brevia.speakerProfile.list(); } catch (error) { showToast(error.message); }
    renderModal('speaker-profiles');
    return;
  }
  const verifySpeakerProfile = event.target.closest('[data-verify-speaker-profile]');
  if (verifySpeakerProfile) {
    try {
      const result = await window.brevia?.speakerProfile.verify({ profile_id: verifySpeakerProfile.dataset.verifySpeakerProfile });
      if (result) showToast(`${result.name}: ${(result.score * 100).toFixed(1)}%${result.verified ? ' ✓' : ''}`);
    } catch (error) { showToast(error.message); }
    return;
  }
  // 模型库的按钮一律携带 model_id，不再用数组下标——下标会随清单顺序变化而错位，
  // 曾导致「下载 A 却显示 B 的名字」。文案也按 id 从清单取，不再读 i18n 的下标数组。
  const download = event.target.closest('[data-download-model]');
  if (download) {
    const modelId = download.dataset.downloadModel;
    const model = modelCatalog.find((item) => item.id === modelId);
    if (!model || download.disabled || modelPaths.has(modelId)) return;
    modelDownloads.set(modelId, { received: 0, total: 0 });
    const downloadModal = activeModal;
    renderModal(downloadModal);
    renderModelDownloadQueue();
    try {
      if (window.brevia) await window.brevia.models.download(modelDownloadPayload(modelId));
      else modelDownloads.delete(modelId);
    } catch (error) { modelDownloads.set(modelId, { error: error.message }); showToast(error.message); }
    if (activeModal === downloadModal) renderModal(downloadModal);
    return;
  }
  const deleteModel = event.target.closest('[data-delete-model]');
  if (deleteModel) {
    const modelId = deleteModel.dataset.deleteModel;
    try {
      if (window.brevia) await window.brevia.models.delete({ model_id: modelId });
      modelPaths.delete(modelId);
    } catch (error) { showToast(error.message); }
    renderModal('models');
    return;
  }
  const openModelFolder = event.target.closest('[data-open-model-folder]');
  if (openModelFolder) {
    const modelId = openModelFolder.dataset.openModelFolder;
    const directory = modelPaths.get(modelId);
    if (!directory) { showToast(t('未找到模型文件')); return; }
    try { await window.brevia?.showItem(`${directory}/.brevia.json`); } catch (error) { showToast(error.message); }
    return;
  }
});
settingsModal.addEventListener('input', (event) => {
  const form = event.target.closest('.summary-model-form, .ai-assist-config-form');
  if (!form) return;
  const config = form.matches('.ai-assist-config-form') ? aiAssistConfigDraft : summaryConfigDraft;
  const name = event.target.name;
  if (name === 'apiKey') {
    const keys = modelConfigSecrets.get(config) || {};
    keys[config.provider] = event.target.value;
    modelConfigSecrets.set(config, keys);
  } else if (name === 'model' || name === 'endpoint') {
    config.providers[config.provider] = { ...providerEntry(config), [name]: event.target.value };
  }
});
settingsModal.addEventListener('change', async (event) => {
  if (event.target.matches('[data-summary-enabled]')) {
    const previous = summaryConfig.enabled;
    event.target.disabled = true;
    summaryConfig.enabled = event.target.checked;
    summaryConfigRevision += 1;
    try { await persistSummaryConfig(); }
    catch (error) { summaryConfig.enabled = previous; event.target.checked = previous; showToast(error.message); }
    finally { event.target.disabled = false; }
    return;
  }
  if (event.target.matches('[data-china-model-source]')) { localStorage.setItem('brevia-china-model-source', event.target.checked); return; }
  if (event.target.matches('.ai-assist-level input[type=radio]')) {
    aiAssistConfigDraft.enabled = event.target.value !== 'off';
    if (aiAssistConfigDraft.enabled) aiAssistConfigDraft.proactivity = event.target.value;
    settingsModal.querySelectorAll('.ai-assist-level').forEach((level) => level.classList.toggle('is-selected', level.querySelector('input[type=radio]').checked));
    return;
  }
  const exportItem = event.target.closest('[data-export-item]');
  if (exportItem) {
    const content = exportItem.dataset.exportItem;
    if (exportItem.checked) { if (!(content in exportSelection)) exportSelection[content] = exportDefaultFormat[content]; }
    else delete exportSelection[content];
    exportItem.closest('.export-content-row')?.classList.toggle('is-checked', exportItem.checked);
    updateExportBuilderState();
    return;
  }
});
settingsModal.addEventListener('dblclick', (event) => {
  const profile = event.target.closest('[data-rename-speaker-profile]');
  if (!profile) return;
  editingSpeakerProfileId = profile.dataset.renameSpeakerProfile;
  renderModal('speaker-profiles');
  settingsModal.querySelector('.speaker-profile-rename-form input')?.select();
});
async function saveModelConfig(form, config, keyPrefix) {
  const isAiNoteForm = form.matches('.ai-assist-config-form');
  const modelMissingMessage = isAiNoteForm ? t('请先选择或填写 AI 笔记模型。') : t('请先选择或填写纪要模型。');
  const values = Object.fromEntries(new FormData(form));
  const provider = summaryProviders.includes(values.provider) ? values.provider : config.provider;
  const preset = summaryProviderPresets[provider];
  const previous = providerEntry(config, provider);
  const entry = { model: (values.model || '').trim() };
  if (!entry.model) { showToast(modelMissingMessage); return false; }
  if (preset.needsEndpoint) {
    entry.endpoint = (values.endpoint || '').trim();
    if (!entry.endpoint) { showToast(t('请填写请求地址。')); return false; }
  }
  if (preset.needsKey) {
    entry.keyReference = previous.keyReference || `${keyPrefix}-${crypto.randomUUID()}`;
    if (values.apiKey && window.brevia) {
      entry.keyLength = values.apiKey.length;
      await window.brevia.secret.set({ reference: entry.keyReference, value: values.apiKey });
    } else if (previous.keyLength) entry.keyLength = previous.keyLength;
    else { showToast(t('请填写 API Key。')); return false; }
  }
  config.provider = provider;
  config.providers = { ...config.providers, [provider]: entry };
  return true;
}
settingsModal.addEventListener('submit', async (event) => {
  if (event.target.matches('.advanced-settings-form')) {
    event.preventDefault();
    try {
      const settings = structuredClone(advancedSettings.settings);
      new FormData(event.target).forEach((value, path) => {
        // 字段名是完整路径（如 vad.zh.threshold）：逐层下钻后再按原类型写回。
        const keys = path.split('.');
        const leaf = keys.pop();
        const parent = keys.reduce((node, key) => node[key], settings);
        parent[leaf] = typeof parent[leaf] === 'number' ? Number(value) : value;
      });
      await window.brevia?.advancedSettings.save({ settings });
      advancedSettings.settings = settings;
      closeModal();
      showToast(t('已保存'));
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.matches('.speaker-profile-rename-form')) {
    event.preventDefault();
    const profileId = event.target.dataset.profileId;
    const name = new FormData(event.target).get('name').trim();
    try { await window.brevia?.speakerProfile.rename({ profile_id: profileId, name }); speakerProfiles = await window.brevia.speakerProfile.list(); } catch (error) { showToast(error.message); }
    editingSpeakerProfileId = null;
    renderModal('speaker-profiles');
    return;
  }
  if (event.target.matches('.ai-assist-config-form')) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const enabled = values.proactivity !== 'off';
    if (enabled && !await saveModelConfig(event.target, aiAssistConfigDraft, 'ai-assist')) return;
    if (enabled) {
      aiAssistConfig.provider = aiAssistConfigDraft.provider;
      aiAssistConfig.providers = aiAssistConfigDraft.providers;
    }
    aiAssistConfig.enabled = enabled;
    aiAssistTemporarilyDisabled = false;
    if (['quiet', 'assist', 'auto'].includes(values.proactivity)) aiAssistConfig.proactivity = values.proactivity;
    aiAssistConfigRevision += 1;
    selectedAiAssistBuiltinModel = '';
    aiAssistConfigDraft = structuredClone(aiAssistConfig);
    await persistAiAssistConfig();
    closeModal();
    if (onboardingPage?.dataset.aiSettings === 'true') {
      onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked = aiAssistConfig.enabled;
      onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value = aiAssistConfig.proactivity;
      const select = onboardingPage.querySelector('.onboarding-ai-levels .flow-select');
      select.querySelector('.flow-select-toggle').firstChild.nodeValue = select.querySelector(`[data-value="${aiAssistConfig.proactivity}"]`).dataset.label;
      renderOnboardingAiDemo();
    }
    renderAiAssistToggle();
    const meetingId = breviaClient?.state.meeting?.id;
    if (meetingActive && meetingId) {
      if (aiAssistEnabled()) void startAiNoteForMeeting(meetingId);
      else stopAiNoteForMeeting(meetingId);
    }
    renderAiAssistEmptyState();
    showToast(t('AI 笔记已保存'));
    return;
  }
  if (event.target.matches('.summary-model-form')) {
    event.preventDefault();
    if (!await saveModelConfig(event.target, summaryConfigDraft, 'summary')) return;
    summaryConfig.provider = summaryConfigDraft.provider;
    summaryConfig.providers = summaryConfigDraft.providers;
    summaryConfigRevision += 1;
    selectedBuiltinModel = '';
    summaryConfigDraft = structuredClone(summaryConfig);
    await persistSummaryConfig();
    dismissTaskCard(document.querySelector('#summary-config-required'));
    closeModal();
    showToast(t('纪要模型已保存'));
    return;
  }
  if (event.target.matches('.speaker-sample-form')) {
    event.preventDefault();
    const profileId = event.target.dataset.speakerProfile;
    const profile = speakerProfiles.find((item) => item.id === profileId);
    try {
      const result = await window.brevia?.speakerProfile.enroll({ profile_id: profileId, name: profile.name });
      if (result) {
        speakerProfiles = await window.brevia.speakerProfile.list();
        speakerSamples.set(profileId, await window.brevia.speakerProfile.samples({ profile_id: profileId }));
        expandedSpeakerProfileId = profileId;
      }
    } catch (error) { showToast(error.message); }
    addingSampleProfileId = null;
    renderModal('speaker-profiles');
    return;
  }
  if (event.target.matches('.speaker-profile-form')) {
    event.preventDefault();
    try {
      const values = new FormData(event.target);
      const profile = await window.brevia?.speakerProfile.enroll({ name: values.get('name').trim() });
      if (profile) speakerProfiles = await window.brevia.speakerProfile.list();
    } catch (error) { showToast(error.message); }
    renderModal('speaker-profiles');
    return;
  }
});
/* Locale copy lives in i18n.js; this alias keeps the renderer focused on state changes. */
const slogans = BreviaI18n.slogans;
const homeSlogan = document.querySelector('#home-slogan');
const homeEyebrow = document.querySelector('#home-eyebrow');
let sloganIndex = Math.floor(Math.random() * slogans.zh.length);
function activeWorkspaceDescription() {
  return activeWorkspaceId ? workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.description?.trim() || '' : '';
}
/** 更新旋转的库标语。@param {boolean} animate 是否播放过渡动画。@returns {void} */
function renderSlogan(animate = false) {
  const workspaceDescription = activeWorkspaceDescription();
  const update = () => {
    homeSlogan.textContent = activeLibraryNav === 'recently-deleted' ? BreviaI18n.trashCopy(locale).slogan : workspaceDescription || (slogans[locale] || slogans.en)[sloganIndex];
    if (animate) {
      homeSlogan.classList.remove('slogan-out');
      homeSlogan.classList.add('slogan-in');
      window.setTimeout(() => homeSlogan.classList.remove('slogan-in'), 440);
    }
  };
  if (!animate || workspaceDescription || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  homeSlogan.classList.add('slogan-out');
  window.setTimeout(update, 280);
}

/** 应用并持久化选定的颜色主题。@param {'light'|'dark'} nextTheme 要应用的主题。@returns {void} */
function applyTheme(nextTheme) {
  theme = nextTheme;
  localStorage.setItem('brevia-theme', theme);
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeToggle.textContent = dark ? '☾' : '◐';
  themeToggle.title = (themeLabels[locale] || themeLabels.en)[dark ? 'light' : 'dark'];
  themeToggle.setAttribute('aria-label', themeToggle.title);
}

/** 记录可在语言环境更改时替换的静态 DOM 文本和属性。
 *
 * 节点用 WeakRef 持有：renderMeetingList / renderSettingsView 等用 innerHTML 重建后会
 * 使旧节点游离，若用强引用会永久持有它们（内存泄漏）。WeakRef 让被替换的节点可被回收，
 * 存活的节点仍能正常更新。@returns {void} */
function collectTranslations() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const key = node.nodeValue.trim();
    if (catalog.zh.labels[key]) translatedNodes.push({ node: new WeakRef(node), key, leading: node.nodeValue.match(/^\s*/)[0], trailing: node.nodeValue.match(/\s*$/)[0] });
  }
  document.querySelectorAll('[placeholder]').forEach((element) => translatedNodes.push({ element: new WeakRef(element), attribute: 'placeholder', key: element.placeholder }));
  document.querySelectorAll('[value]').forEach((element) => translatedNodes.push({ element: new WeakRef(element), attribute: 'value', key: element.value }));
  document.querySelectorAll('[aria-label]').forEach((element) => {
    const key = element.getAttribute('aria-label');
    if (catalog.zh.labels[key]) translatedNodes.push({ element: new WeakRef(element), attribute: 'aria-label', key });
  });
  document.querySelectorAll('[title]').forEach((element) => {
    const key = element.getAttribute('title');
    if (catalog.zh.labels[key]) translatedNodes.push({ element: new WeakRef(element), attribute: 'title', key });
  });
}
/** 应用语言环境、重绘依赖组件，并可选择对翻译节点进行动画处理。@param {'zh'|'en'|'es'} nextLocale 要应用的语言环境。@param {boolean} animate 是否对更改进行动画处理。@returns {void} */
function applyLanguage(nextLocale, animate = false) {
  locale = nextLocale;
  localStorage.setItem('brevia-language', locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
  document.title = t('Brevia');
  languageToggle.title = t('切换语言');
  languageToggle.setAttribute('aria-label', t('切换语言'));
  applyTheme(theme);
  languageOptions.querySelectorAll('[data-language]').forEach((option) => option.setAttribute('aria-current', String(option.dataset.language === locale)));
  const rerendered = [
    '.settings-grid', '.meeting-list', '#meeting-form .form-grid',
    '.final-transcript', '.notes', '#model-download-queue',
  ].map((selector) => document.querySelector(selector));
  rerendered.push(batchToolbar, updateNotice.hidden ? null : updateNotice, settingsModal.hidden ? null : settingsModal.querySelector('.modal-panel'));
  const rerenderedRoots = rerendered.filter(Boolean);
  const nodes = [...new Set([
    ...translatedNodes
      .map(({ node, element }) => (node?.deref())?.parentElement || element?.deref())
      .filter((element) => element?.isConnected && !rerenderedRoots.some((root) => root.contains(element))),
    ...rerenderedRoots,
    ...['#floating-caption-toggle', '#translation-toggle', '#playback-floating-caption-toggle']
      .map((selector) => document.querySelector(selector))
      .filter(Boolean),
  ])];
  const updateText = () => {
    translatedNodes.forEach(({ node, element, attribute, key, leading = '', trailing = '' }) => {
      const value = t(key);
      const textNode = node?.deref();
      if (textNode) { textNode.nodeValue = `${leading}${value}${trailing}`; return; }
      const target = element?.deref();
      if (target) target[attribute] = value;
    });
    renderPrepareSelects();
    renderPrepareAudioSources();
    renderPauseButton();
    renderLiveInputStatus();
    document.querySelector('#end-meeting').textContent = t('结束会议');
    renderSettingsView();
    document.querySelector('#advanced-settings').before(speakerProfileCard);
    document.querySelector('#settings-view .settings-grid').append(updateCard);
    renderSettingsFolderRows();
    renderDefaultMeetingTitle();
    renderMeetingList();
    renderWorkspaceNav();
    renderMeetingDetail();
    if (activeView === 'home') selectLibraryNav(activeLibraryNav);
    else crumb.textContent = activeView === 'prepare' && prepareView.dataset.mode === 'import' ? t('导入录音') : catalog[locale].views[activeView];
    renderSlogan(false);
    renderUpdateButton();
    renderUpdateNotice();
    renderSpeakerProfileCard();
    renderModelControls();
    renderRequiredModelsCard();
    refreshLocalizedTaskCards();
    if (activeModal) renderModal(activeModal);
    renderFloatingCaptionToggle();
    setLiveTranslationEnabled(translationAllowed);
    renderPlaybackFloatingCaptionToggle();
    document.querySelectorAll('[data-tooltip-key]').forEach((button) => {
      const label = t(button.dataset.tooltipKey);
      button.dataset.tooltip = label;
      button.setAttribute('aria-label', label);
    });
    // 更新浮动字幕按钮工具提示
    document.querySelectorAll('#floating-caption-toggle, #playback-floating-caption-toggle').forEach((floatingCaptionToggle) => {
      floatingCaptionToggle.title = t('悬浮字幕');
      floatingCaptionToggle.setAttribute('aria-label', t('悬浮字幕'));
    });
  };
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { updateText(); return; }
  switchingLanguage = true;
  nodes.forEach((element) => element.classList.add('locale-out'));
  window.setTimeout(() => {
    try { updateText(); }
    finally {
      switchingLanguage = false;
      nodes.forEach((element) => { element.classList.remove('locale-out'); element.classList.add('locale-in'); window.setTimeout(() => element.classList.remove('locale-in'), 520); });
    }
  }, 380);
}
/** 显示简短的、自动清除的反馈消息。@param {string} content Toast 文本。@returns {void} */
/** 为缺失或被拒绝的纪要提供商凭据显示共享任务卡片。*/
let summaryConfigDismissTimer;
function showSummaryConfigCard(error) {
  clearTimeout(summaryConfigDismissTimer);
  let card = document.querySelector('#summary-config-required');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'summary-config-required';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const rejected = /LLM request failed \(403\)|error code: 1010/i.test(String(error?.detail || error?.message || error));
  // 内置模型走本地 GGUF，与 API Key 无关；缺配置时给出针对性的指引，
  // 避免把「未选择本地模型」误报成「API Key 未配置」。
  const builtin = summaryConfig.provider === 'built-in';
  const copy = builtin
    ? { title: t('内置纪要模型未配置'), detail: t('请前往「设置」>「AI 会议总结」，选择并下载内置纪要模型。'), action: t('前往 AI 会议总结') }
    : { title: t(rejected ? '纪要服务拒绝了请求' : '纪要模型需要配置'), detail: t(rejected ? '请检查 API 地址、密钥和服务商访问策略。' : 'API Key 未配置、已失效或不匹配当前服务。'), action: t('配置纪要模型') };
  card.innerHTML = `<header class="task-card-heading"><p>${copy.title}</p>${taskCardControls()}</header><strong>${copy.detail}</strong><button class="secondary" type="button">${copy.action}</button>`;
  card.querySelector('.secondary').onclick = () => {
    clearTimeout(summaryConfigDismissTimer);
    dismissTaskCard(card);
    void showView('settings').then(() => openModal('summary-model'));
  };
  summaryConfigDismissTimer = setTimeout(() => dismissTaskCard(card), 30000);
}
function isSummaryAuthenticationError(error) {
  return /LLM request failed \((401|403)\)|error code: 1010|API key|Authorization header|invalid_api_key|authentication/i.test(String(error.detail || error.message));
}
// 模型下载的失败原因分类。
//
// 后端抛的是具体类型（OSError: Insufficient disk space / ValueError: checksum mismatch /
// urllib 系的网络异常），但这些原文直接甩给用户没有可操作性——用户不知道下一步该做什么。
// 过去所有失败都被压成同一句话，于是「磁盘满了」和「网络断了」提示长得一样。
// 这里按后端实际抛出的字符串归类，并各给一句可行动的建议。
// 参考 OpenWhispr 的 "A model won't download" 帮助页：把 SSL 拦截、磁盘耗尽、
// 安装步骤失败区分为不同原因（设计文档 §6.3）。
const MODEL_DOWNLOAD_FAILURES = [
  { pattern: /Insufficient disk space/i, key: '磁盘空间不足，请先清理空间再下载。' },
  { pattern: /checksum mismatch|is missing required files|is missing required directory/i, key: '文件校验未通过，下载可能已损坏，请删除后重试。' },
  { pattern: /timed out|timeout|URLError|ConnectionError|IncompleteRead|SSL|CERTIFICATE/i, key: '网络中断导致下载失败，请检查网络后重试。' },
  { pattern: /Unknown model|not installed/i, key: '模型不可用，请刷新模型库后重试。' },
];
/** 把后端错误转成用户能行动的一句话。
 *
 * 翻译结构化错误码（包括带操作前缀的消息）；其它错误保留诊断信息。
 * @param {string} content 原始错误文本。
 * @returns {string} 可直接展示的文本。 */
function userFacingError(content) {
  const text = String(content);
  const localized = text.replace(/\berror\.[a-z_]+(?:\.[a-z_]+)*\b/g, (code) => t(code));
  if (localized !== text) return localized;
  if (/\b(?:worker request |operation )timed out\b/i.test(text)) return t('操作超时，请稍后重试');
  // 在线纪要/AI 笔记的网络失败也带 timeout/SSL/CERTIFICATE 字样，但它们不是模型下载
  // 失败，套上下载文案会把用户引到错误的方向。
  if (/LLM request failed/i.test(text)) return content;
  for (const { pattern, key } of MODEL_DOWNLOAD_FAILURES) {
    if (pattern.test(text)) return t(key);
  }
  return content;
}
/** 显示临时消息，并在提供时显示一个显式的安全下一步操作。*/
const showToast = (content, action) => {
  const message = document.createElement('span');
  message.textContent = userFacingError(content);
  toast.replaceChildren(message);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => { action.run(); toast.classList.remove('visible'); });
    toast.append(button);
  }
  toast.classList.toggle('has-action', Boolean(action));
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
};
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  const message = userFacingError(event.reason?.message || 'error.operation_failed');
  showToast(`${t('操作失败')}: ${message}`);
});
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message;
  if (message) { console.error(event.error || message); showToast(t('error.operation_failed')); }
});
/** 标记活动的会议库源并更新窗口面包屑。@param {'all-meetings'|'recently-deleted'} id 导航项 ID。@returns {void} */
function selectLibraryNav(id) {
  if (id !== activeLibraryNav) clearMeetingSelection();
  activeLibraryNav = id;
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.id === id));
  crumb.textContent = id === 'recently-deleted' ? t('最近删除') : catalog[locale].views.home;
  const deleted = id === 'recently-deleted';
  homeEyebrow.className = deleted ? 'back' : 'eyebrow';
  homeEyebrow.disabled = !deleted;
  homeEyebrow.textContent = deleted ? BreviaI18n.trashCopy(locale).back : t('会议库');
  renderSlogan(false);
}
/** 按请求顺序执行页面过渡，当前过渡结束后再读取真正可见的页面。 */
async function transitionPage(current, next, swap = () => {}) {
  const previous = pageTransition;
  const transition = (async () => {
    if (previous) await previous.catch(() => {});
    current = document.querySelector('.view.active') || current;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
    current.classList.add('leaving');
    await new Promise((resolve) => window.setTimeout(resolve, duration));
    const previousView = activeView;
    activeView = next.id.slice(0, -'-view'.length);
    try {
      if (previousView === 'prepare' && activeView !== 'prepare') await breviaClient?.stopPreview();
      document.querySelector('.app-shell').classList.toggle('is-live-meeting', (activeView === 'live' && meetingActive) || activeView === 'detail');
      crumb.textContent = activeView === 'prepare' && prepareView.dataset.mode === 'import' ? t('导入录音') : catalog[locale].views[activeView];
      if (activeView === 'home') selectLibraryNav(activeLibraryNav);
      else document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === activeView));
      if (activeView === 'detail') resetDetailHeaderCollapse();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await swap();
    } finally {
      current.classList.remove('active', 'leaving');
      next.classList.remove('active', 'leaving');
      void next.offsetWidth;
      next.classList.add('active');
      renderMiniPlayback();
    }
  })();
  pageTransition = transition;
  try { await transition; }
  finally { if (pageTransition === transition) pageTransition = null; }
}
/** 在顶级应用视图之间切换。@param {'home'|'prepare'|'live'|'detail'|'settings'} name 目标视图。*/
const showView = async (name) => {
  if (name === activeView && !pageTransition) return;
  const current = document.querySelector(`#${activeView}-view`);
  const next = document.querySelector(`#${name}-view`);
  await transitionPage(current, next);
  if (name === 'prepare') { requestAnimationFrame(fitPrepareLayout); renderCaptureMode(); if (prepareView.dataset.mode !== 'import') void refreshPrepareAudioSources(); }
};

/* ===== Sticky Auto-hide Header（会议详情页）=====
   规则：只有内容滚动到最顶部时，标题、导出操作与播放条才完整显示；
   只要离开顶部（向下滚了哪怕一点），头部就收起压扁，把空间让给内容区。
   用防抖延迟触发，避免每次 scroll 事件都启动一次布局过渡——那会抖动闪烁。 */
let detailHeaderCollapsed = false;
const detailHeaderDebounceMs = 120; // 滚动停顿 120ms 后才执行一次过渡
let detailHeaderScrollTimer = null;
/** 读取内容面板滚动位置，一次性切换详情页头部收起态。@returns {void} */
function evaluateDetailHeaderCollapse() {
  const detailView = document.querySelector('#detail-view');
  if (!detailView) return;
  let maxScroll = 0;
  detailView.querySelectorAll('.transcript-body, .detail-notes-panel, .notes-editor, .notes-input').forEach((panel) => {
    if (panel.scrollTop > maxScroll) maxScroll = panel.scrollTop;
  });
  // 只在“严格位于顶部”时展开；一旦滚离顶部即收起（纯二进制状态，不会交替）。
  const next = maxScroll > 0;
  if (next === detailHeaderCollapsed) return;
  detailHeaderCollapsed = next;
  detailView.classList.toggle('is-header-collapsed', next);
}
/** 滚动中的节流入口：重置防抖计时器，滚动停顿后只评估一次。@returns {void} */
function updateDetailHeaderCollapse() {
  clearTimeout(detailHeaderScrollTimer);
  detailHeaderScrollTimer = setTimeout(evaluateDetailHeaderCollapse, detailHeaderDebounceMs);
}
/** 强制展开详情页头部（进入详情视图或内容面板重建时调用）。@returns {void} */
function resetDetailHeaderCollapse() {
  clearTimeout(detailHeaderScrollTimer);
  detailHeaderCollapsed = false;
  document.querySelector('#detail-view')?.classList.remove('is-header-collapsed');
}
// scroll 事件不冒泡，但会经过捕获阶段；挂到视图根上即可覆盖动态重建的内部面板。
document.querySelector('#detail-view')?.addEventListener('scroll', updateDetailHeaderCollapse, true);
/** 使用与顶级视图相同的页面淡出/淡入时序切换会议库源。*/
async function showLibraryNav(id) {
  const includeDeleted = id === 'recently-deleted';
  if (activeView === 'home' && id === activeLibraryNav && !pageTransition) return;
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  const current = document.querySelector(`#${activeView}-view`);
  const home = document.querySelector('#home-view');
  await transitionPage(current, home, async () => {
    selectLibraryNav(id);
    if (window.brevia) await refreshBackendMeetings(includeDeleted).catch((error) => showToast(error.message));
  });
}
collectTranslations();
applyLanguage(locale);
applyLanguageModelDefaults(new FormData(prepareForm).get('meeting-language') || defaultMeetingLanguage());
applyTheme(theme);
async function loadInstalledAppVersion() {
  try {
    const version = await window.brevia?.appInfo?.version?.();
    if (version) { applyInstalledVersion(version); return; }
  } catch { /* Fall through to the packaged manifest. */ }
  try {
    const response = await fetch('../package.json');
    const { version } = await response.json();
    if (response.ok && version) applyInstalledVersion(version);
  } catch { /* Keep the unavailable marker when neither source can be read. */ }
}
/** 记录已安装版本并触发“本次更新”弹窗判定。@param {string} version 已安装的应用版本。@returns {void} */
function applyInstalledVersion(version) {
  installedAppVersion = version;
  appVersion.textContent = `v${version}`;
  renderUpdateButton();
  maybeShowWhatsNew();
}
/** 按点号分段、逐段数值比较两个 semver 版本号。@param {string} a @param {string} b @returns {number} a<b → 负数，a>b → 正数。 */
function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => parseInt(part, 10) || 0);
  const right = String(b).split('.').map((part) => parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
/** 仅在升级后自动弹出一次“更新日志”；首次安装只记录版本、不弹窗。@returns {void} */
function maybeShowWhatsNew() {
  if (!installedAppVersion || installedAppVersion === '—') return;
  try {
    const seen = localStorage.getItem('brevia-whatsnew-seen');
    if (!seen) { localStorage.setItem('brevia-whatsnew-seen', installedAppVersion); return; }
    if (compareVersions(seen, installedAppVersion) < 0) openModal('whats-new');
  } catch { /* Ignore storage errors and never block startup. */ }
}
/** 记录当前版本已查看，避免下次启动重复弹窗。@returns {void} */
function markWhatsNewSeen() {
  if (!installedAppVersion || installedAppVersion === '—') return;
  try { localStorage.setItem('brevia-whatsnew-seen', installedAppVersion); } catch { /* ignore */ }
}
void loadInstalledAppVersion();
async function checkForUpdates({ silent = false } = {}) {
  updateBusy = true;
  renderUpdateButton();
  try {
    const result = await window.brevia?.update?.check?.();
    updateAvailable = result?.status === 'available';
    updateVersion = result?.version || '';
    if (!silent && result?.status === 'current') showToast((updateLabels[locale] || updateLabels.en).current);
  } catch (error) { if (!silent) showToast(error.message); }
  finally { updateBusy = false; renderUpdateButton(); renderUpdateNotice(); }
}
async function runUpdateAction() {
  if (!updateAvailable) return checkForUpdates();
  updateBusy = true;
  updateDownloadProgress = null;
  renderUpdateButton();
  renderUpdateNotice();
  try { await window.brevia.update.install(); }
  catch (error) { showToast(error.message); updateBusy = false; updateDownloadProgress = null; renderUpdateButton(); renderUpdateNotice(); }
}
window.setInterval(() => { if (activeLibraryNav === 'recently-deleted' || activeWorkspaceDescription()) return; sloganIndex = (sloganIndex + 1) % (slogans[locale] || slogans.en).length; renderSlogan(true); }, 30000);
updateButton.addEventListener('click', () => void runUpdateAction());
updateNoticeButton.addEventListener('click', () => void runUpdateAction());
/** 关闭语言菜单并更新其展开状态。@returns {void} */
function closeLanguageMenu() { languageOptions.hidden = true; languageToggle.setAttribute('aria-expanded', 'false'); }
languageToggle.addEventListener('click', () => {
  const opening = languageOptions.hidden;
  languageOptions.hidden = !opening;
  languageToggle.setAttribute('aria-expanded', String(opening));
});
languageOptions.addEventListener('click', (event) => {
  const option = event.target.closest('[data-language]');
  if (!option || switchingLanguage || option.dataset.language === locale) { closeLanguageMenu(); return; }
  closeLanguageMenu();
  applyLanguage(option.dataset.language, true);
});
document.addEventListener('click', (event) => { if (!event.target.closest('.language-menu')) closeLanguageMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (activeModal) closeModal(); else if (onboardingPage?.dataset.aiSettings === 'true') dismissOnboardingPage(); else { closeLanguageMenu(); languageToggle.focus(); } } });
// Command+/ 或 Ctrl+/：切换富文本 / Markdown 编辑模式。
document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key !== '/') return;
  const editor = meetingActive ? liveNotesEditor : (detailNotesEditor || null);
  if (!editor) return;
  event.preventDefault();
  editor.setMode(editor.getMode() === 'rich' ? 'markdown' : 'rich');
});
/** 在录制期间导航离开时显示紧凑的实时会议控件。@returns {void} */
function minimizeMeeting() { miniTitle.textContent = document.querySelector('#live-name').textContent; miniTimer.textContent = document.querySelector('#timer').textContent; const wasHidden = miniMeeting.hidden; miniMeeting.hidden = false; if (wasHidden) taskCards.append(miniMeeting); }
document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (!target || ['all-meetings', 'recently-deleted'].includes(target.id)) return; if (target.dataset.view === 'home') selectLibraryNav('all-meetings'); if (target.dataset.view === 'prepare') setPrepareMode(target.dataset.prepareMode || 'record'); if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting(); showView(target.dataset.view); if (target.dataset.view === 'settings') void refreshSettingsFolderRows(); });
homeEyebrow.addEventListener('click', async () => {
  if (activeLibraryNav !== 'recently-deleted') return;
  await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
});
function setLiveTranslationEnabled(enabled) {
  translationAllowed = enabled;
  const toggle = document.querySelector('#translation-toggle');
  toggle.dataset.enabled = String(enabled);
  toggle.textContent = t(enabled ? '翻译：开' : '翻译：关');
  document.querySelector('#translation-options').innerHTML = BreviaI18n.languageOptions(locale, t)
    .map(([value, label]) => `<button type="button" data-live-translation="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('');
  if (!enabled) document.querySelectorAll('.translation').forEach((line) => { line.hidden = true; });
}
/** 渲染实时页的识别模型切换器：当前版本在此会议中生效，选中新模型会热切换（未安装则先触发下载）。

只有会议语言下存在两个以上候选模型时才显示，避免给只有单一选择的用户添乱。
@returns {void} */
function renderLiveModelControl() {
  const menu = document.querySelector('#live-model-menu');
  const toggle = document.querySelector('#live-model-toggle');
  const options = document.querySelector('#live-model-options');
  if (!menu || !toggle || !options) return;
  const language = liveConfig.language || 'auto';
  const models = refinedModelsForLanguage(language);
  if (models.length < 2) { menu.hidden = true; return; }
  const current = liveConfig.refined_model_id || models[0].id;
  menu.hidden = false;
  const optionLabels = new Map(refinedModelOptions(language));
  toggle.textContent = optionLabels.get(current) || models[0].name;
  toggle.setAttribute('aria-expanded', 'false');
  options.innerHTML = [...optionLabels].map(([id, label]) => `<button type="button" data-live-model="${escapeHtml(id)}"${id === current ? ' aria-current="true"' : ''}>${escapeHtml(label)}</button>`).join('');
  options.hidden = true;
}
function renderFloatingCaptionToggle() {
  const toggle = document.querySelector('#floating-caption-toggle');
  if (!toggle) return;
  toggle.dataset.enabled = String(floatingCaptionMode === 'live');
  toggle.textContent = t(floatingCaptionMode === 'live' ? '字幕：开' : '字幕：关');
}
function renderPlaybackFloatingCaptionToggle() {
  const toggle = document.querySelector('#playback-floating-caption-toggle');
  if (!toggle) return;
  toggle.dataset.enabled = String(floatingCaptionMode === 'playback');
  toggle.textContent = t('字幕');
}
function nextFloatingCaptionMode(mode) { return floatingCaptionMode === mode ? null : mode; }
function activateMeeting(meeting, payload) {
  document.querySelector('#pause').disabled = false;
  const { title, workspace_id: workspaceId, language } = meeting || payload;
  // 上一场遗留的「无实时字幕」卡片不能带到这一场；本场的卡片要保留（它的归属 id 与本次相同）。
  dismissLiveCaptionUnavailable(meeting?.id || payload?.id || breviaClient?.state.meeting?.id);
  liveConfig = { language: language || 'auto', target_language: payload.target_language || null, refined_model_id: meeting?.refined_model_id || payload.refined_model_id || null };
  document.querySelector('#live-name').textContent = title;
  uiData.meetings.unshift({ id: meeting.id, tone: 'violet', title, meta: `${t('刚刚')} · 0 ${t('分钟')}`, workspaceId: workspaceId || '', workspace: workspaceId ? { name: getWorkspaceName(workspaceId) } : null, tags: [], status: { tone: 'processing', label: '正在录制', detail: t('本地保存') } });
  document.querySelector('#transcript-scroll').innerHTML = '';
  const backToLatestButton = document.querySelector('#back-to-latest');
  if (backToLatestButton) backToLatestButton.hidden = true;
  if (liveNotesEditor) {
    liveNotesEditor.setMarkdown('');
    liveNotesEditor.setMode('rich');
  }
  setLiveLayoutMode('notes');
  resetAiNoteSuggestions();
  renderAiAssistToggle();
  setLiveTranslationEnabled(Boolean(payload.target_language));
  renderLiveModelControl();
  latestLiveSegmentId = null;
  liveSegments.clear();
  liveSegmentData.clear();
  clearDraftSegments();
  followLiveTranscript = true;
  renderMeetingList();
  meetingActive = true;
  seconds = 0;
  const pauseButton = document.querySelector('#pause');
  pauseButton.dataset.paused = 'false';
  renderPauseButton();
  renderLiveInputStatus();
  renderAiAssistEmptyState();
  void startAiNoteForMeeting(meeting.id);
  miniMeeting.hidden = true;
  showView('live');
  startTimer();
}
document.querySelector('#meeting-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const submitLabel = submit.innerHTML;
  submit.disabled = true;
  submit.classList.add('is-pending');
  submit.setAttribute('aria-busy', 'true');
  submit.innerHTML = `<i class="button-spinner" aria-hidden="true"></i>${t('准备中')}`;
  const form = new FormData(event.currentTarget);
  const title = document.querySelector('#meeting-title').value.trim();
  const language = form.get('meeting-language') || defaultMeetingLanguage();
  const defaults = preferredModelsForLanguage(language);
  const refinedModelId = form.get('refined-model') || defaultRefinedModelId(language);
  const targetLanguage = form.get('translation-target') || null;
  const segmentationModelId = prepareForm.dataset.segmentationModel || defaults.segmentation;
  const captureMode = form.get('capture-mode') || savedCaptureMode();
  const inputs = captureModeInputs(captureMode);
  const payload = {
    title, language, target_language: targetLanguage, refined_model_id: refinedModelId,
    speaker_segmentation_model_id: segmentationModelId,
    vad_model_id: prepareForm.dataset.vadModel || 'silero-vad', workspace_id: form.get('meeting-workspace') || null,
  };
  try {
    if (prepareView.dataset.mode === 'import') {
      const meeting = window.brevia && await window.brevia.meeting.import({ ...payload, path: 'selected-by-electron' });
      if (!meeting) return;
      breviaClient.state.selectedMeetingId = meeting.id;
      applyBackendDetail(meeting);
      await refreshBackendMeetings();
      showView('detail');
      startRefinement();
      return;
    }
    const meeting = breviaClient ? await breviaClient.start(payload, inputs, selectedMicDeviceId()) : { id: null };
    if (meeting?.model_required) {
      queueModelTask('meeting.start', { ...payload, inputs }, meeting.model_required);
      downloadRequiredModels(meeting.model_required);
      activateTaskCard(document.querySelector('#model-download-queue'));
      showToast(t('正在下载会议所需模型，完成后会自动开始录制'));
      return;
    }
    try { localStorage.setItem(LAST_CAPTURE_MODE_KEY, inputs.mic && inputs.system ? 'both' : inputs.mic ? 'mic' : 'system'); } catch { /* 忽略存储失败。 */ }
    activateMeeting(meeting, payload);
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
    submit.classList.remove('is-pending');
    submit.removeAttribute('aria-busy');
    submit.innerHTML = submitLabel;
  }
});
/** 当前是否处于「暂停录制」状态：暂停按钮的 dataset 是唯一状态来源。@returns {boolean} 是否已暂停。 */
function meetingPaused() { return document.querySelector('#pause')?.dataset.paused === 'true'; }
/** 把录制 / 暂停状态同步到实时页 header、迷你控件与会议库列表，避免暂停后仍显示「正在录制」。@param {boolean} paused 是否已暂停。@returns {void} */
function renderRecordingState(paused) {
  const label = paused ? '已暂停' : '正在录制';
  ['#live-recording-state', '#mini-meeting .mini-recording'].forEach((selector) => {
    const badge = document.querySelector(selector);
    if (!badge) return;
    badge.classList.toggle('is-paused', paused);
    // 直接改写文本节点，保留语言切换时记录的翻译节点引用。
    const text = [...badge.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (text) text.nodeValue = ` ${t(label)}`;
  });
  const activeId = meetingActive ? breviaClient?.state.meeting?.id : null;
  const active = activeId ? uiData.meetings.find((meeting) => meeting.id === activeId) : null;
  if (!active?.status) return;
  const changed = active.status.label !== label || Boolean(active.status.paused) !== paused;
  active.status = { ...active.status, label, paused };
  if (changed) renderMeetingList();
}
function renderLiveInputStatus() {
  const mic = captureModeInputs().mic;
  document.querySelector('#live-input-label').textContent = t(mic ? '麦克风' : '系统音频');
  document.querySelector('[data-live-mic-level]').hidden = !mic;
}
/** 实时识别链路没能建立时，给出一条**常驻**提示卡（而不是一闪而过的 toast）。
 *
 * 触发条件不是「模型没下载」——那条路会被 meeting.start 的 require_models 拦在前面，
 * 先下载再进会议。这里覆盖的是「文件在、但加载不了」：模型文件损坏/被截断、ONNX 图与
 * 当前 sherpa-onnx 不兼容、onnxruntime 动态库加载失败等。此时会话照常录制，但
 * `_accept_audio` 的守卫 `if self.vad and self.asr` 恒为假，整场不会产生一个字幕段。
 *
 * 音频在守卫之前就落盘了（原地录音完好、会后精修可补逐字稿），所以提示的重点是：
 * 「这一场不会有实时字幕，但录音在、事后能出稿」——让用户当场就知道，而不是散会才发现。
 * @param {string} meetingId 受影响的会议 id。@param {string} detail 后端原始错误（只放进 title 作诊断用）。@returns {void} */
function showLiveCaptionUnavailable(meetingId, detail) {
  // 迟到的警告可能属于上一场会议：只对当前实时会议生效。
  const active = breviaClient?.state.meeting?.id;
  if (meetingId && active && meetingId !== active) return;
  let card = document.querySelector('#live-transcription-unavailable');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'live-transcription-unavailable';
    card.className = 'processing-card live-transcription-unavailable';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
  }
  // 卡片归属哪一场会议：它是在 meeting.start 返回**之前**就发出来的（见下面 dismiss 的注释），
  // 必须记住归属才能区分「本场的卡片」与「上一场遗留的卡片」。
  card.dataset.meetingId = meetingId || '';
  // 面向用户的文案本地化、且不出现内部模型 id；原始错误只作为悬停诊断信息保留。
  card.title = detail || '';
  card.innerHTML = `<header class="task-card-heading"><p>${escapeHtml(t('本次会议无法生成实时字幕'))}</p>${taskCardControls()}</header>`
    + `<p class="live-transcription-unavailable-body">${escapeHtml(t('识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。'))}</p>`;
  enterTaskCard(card);
}
/** 撤下**属于别的会议**的「无实时字幕」提示卡。
 *
 * 不能无条件撤下：这条警告在 `_prepare_active` 里发出，即在 `meeting.start` 返回之前，
 * 而 `activateMeeting` 在返回之后才跑。无条件撤下会把刚建好的提示立刻抹掉，用户又回到
 * 「以为在记、其实只在录」的状态。
 * @param {string} [meetingId] 当前要激活的会议 id；缺省时按无条件撤下处理。@returns {void} */
function dismissLiveCaptionUnavailable(meetingId) {
  const card = document.querySelector('#live-transcription-unavailable');
  if (!card) return;
  if (meetingId && card.dataset.meetingId === meetingId) return;
  dismissTaskCard(card);
}
/** 使录制控件标签与活动语言环境和状态保持同步。@returns {void} */
function renderPauseButton() {
  const button = document.querySelector('#pause');
  const paused = button.dataset.paused === 'true';
  button.textContent = `${paused ? '▶' : 'Ⅱ'} ${t(paused ? '继续' : '暂停')}`;
  renderRecordingState(paused);
}
/** 启动可见的录制计时器，替换任何先前的计时器。@returns {void} */
function startTimer() { clearInterval(timer); timer = setInterval(() => { seconds += 1; const value = new Date(seconds * 1000).toISOString().slice(11, 19); document.querySelector('#timer').textContent = value; miniTimer.textContent = value; }, 1000); }
document.querySelector('#pause').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const paused = button.dataset.paused === 'true';
  const nextPaused = !paused;
  button.disabled = true;
  try {
    const request = breviaClient?.pause(nextPaused);
    button.dataset.paused = String(nextPaused);
    renderPauseButton();
    if (nextPaused) clearInterval(timer); else startTimer();
    await request;
  } catch (error) {
    button.dataset.paused = String(paused);
    renderPauseButton();
    if (paused) clearInterval(timer); else startTimer();
    showToast(error.message);
  } finally { button.disabled = false; }
});
document.querySelector('#mark-important').addEventListener('click', () => {
  if (!meetingActive) return;
  const segment = liveSegmentData.get(latestLiveSegmentId);
  liveNotesEditor.appendMarkdown(`${t('重点')} · ${formatMeetingTime(seconds * 1000)}${segment ? ` — ${segment.text}` : ''}`);
  showToast(t('已加入笔记'));
});
document.querySelector('#end-meeting').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const buttonLabel = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-pending');
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<i class="button-spinner" aria-hidden="true"></i>${t('结束中')}`;
  clearInterval(timer);
  try {
    // 先释放采集；保存失败时会议 ID 与笔记草稿保留，允许再次结束。
    await breviaClient?.capture?.stop().catch((error) => console.error('Audio capture cleanup failed', error));
    clearTimeout(liveNotesSaveTimer.current);
    const notes = currentNotesMarkdown();
    const activeMeetingId = breviaClient?.state.meeting?.id;
    if (notes && activeMeetingId) {
      await persistNotes(activeMeetingId, notes);
    }
    const meeting = breviaClient ? await breviaClient.stop(seconds * 1000) : null;
    meetingActive = false;
    miniMeeting.hidden = true;
    if (meeting) {
      breviaClient.state.selectedMeetingId = meeting.id;
      applyBackendDetail(meeting);
    }
    showView('detail');
    showToast(message('recordingSaved'));
    if (window.brevia) await refreshBackendMeetings();
    if (meeting && summaryRequestConfig()) void generateMeetingSummary(meeting.id);
  } catch (error) {
    showToast(error.message);
    // 采集已经收尾；保留会议 ID 供重试结束，不能装作仍在录音。
    document.querySelector('#pause').dataset.paused = 'true';
    renderPauseButton();
    document.querySelector('#pause').disabled = true;
  } finally {
    button.disabled = false;
    button.classList.remove('is-pending');
    button.removeAttribute('aria-busy');
    button.innerHTML = buttonLabel;
  }
});
miniMeeting.addEventListener('click', () => { miniMeeting.hidden = true; showView('live'); });
/** 切换会议主区域布局：'notes'（笔记模式，默认）或 'caption'（字幕展开模式）。@param {'notes'|'caption'} mode 目标模式。@returns {void} */
function setLiveLayoutMode(mode) {
  const layout = document.querySelector('.live-layout');
  if (!layout) return;
  layout.classList.toggle('is-caption-mode', mode === 'caption');
  layout.dataset.liveMode = mode;
  if (mode === 'caption') {
    const transcript = document.querySelector('#transcript-scroll');
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }
}
document.querySelectorAll('[data-toggle-live-mode]').forEach((button) => {
  button.addEventListener('click', () => setLiveLayoutMode(button.dataset.toggleLiveMode));
});
/** 交换详情页的逐字稿与会议纪要主次分区。@param {'summary'|'transcript'} mode 要展开的分区。@returns {void} */
function setDetailLayoutMode(mode) {
  const layout = document.querySelector('.detail-layout');
  if (!layout) return;
  layout.classList.toggle('is-summary-mode', mode === 'summary');
  layout.dataset.detailMode = mode;
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-detail-mode]');
  if (button) setDetailLayoutMode(button.dataset.toggleDetailMode);
});
const liveNotesRoot = document.querySelector('[data-live-notes-root]');
const aiSuggestionHost = document.querySelector('[data-ai-suggestion]');
if (aiSuggestionHost) liveNotesRoot.append(aiSuggestionHost);
const liveNotesEditor = createNotesEditor(liveNotesRoot, {
  onInput: (opts) => {
    scheduleNotesSave(liveNotesSaveTimer, currentNotesMarkdown, () => breviaClient?.state.meeting?.id);
    hideAiAssistEmptyState();
    // 程序化写入（AI 落笔/插入字幕）不算用户打字，避免触发 4 秒静默窗口。
    if (opts?.programmatic) return;
    signalAiNoteTyping(true);
    clearTimeout(aiNoteTypingTimer);
    aiNoteTypingTimer = setTimeout(() => signalAiNoteTyping(false), 4000);
  },
  getMeetingId: () => breviaClient?.state.meeting?.id,
});
// —— AI 辅助：header 开关、空态引导、未启用 Popover ——
function aiAssistEmptyRoot() { return document.querySelector('[data-ai-assist-empty]'); }
function aiAssistToggleButton() { return document.querySelector('[data-ai-assist-toggle]'); }
function aiRequestButton() { return document.querySelector('[data-ai-request]'); }
function renderAiAssistToggle() {
  const button = aiAssistToggleButton();
  if (!button) return;
  const copy = (aiAssistCopy[locale] || aiAssistCopy.en);
  const label = button.querySelector('[data-ai-assist-toggle-label]');
  if (label) label.textContent = aiAssistEnabled() ? copy.toggleOn : copy.toggleOff;
  button.classList.toggle('is-enabled', aiAssistEnabled());
  button.setAttribute('aria-expanded', 'false');
  const request = aiRequestButton();
  if (request) {
    request.hidden = !aiAssistEnabled() || aiAssistConfig.proactivity !== 'quiet';
    request.textContent = copy.request || aiAssistCopy.en.request;
  }
}
function renderAiAssistEmptyState() {
  const root = aiAssistEmptyRoot();
  if (!root) return;
  const copy = (aiAssistCopy[locale] || aiAssistCopy.en);
  const hasNotes = Boolean(currentNotesMarkdown().trim());
  if (hasNotes || !meetingActive) { root.hidden = true; root.innerHTML = ''; return; }
  const hasAi = aiAssistEnabled();
  const disabledActions = ['insert-latest'];
  const tags = hasAi
    ? copy.emptyEnabledTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')
    : copy.emptyDisabledTags.slice(0, 1).map((tag, index) => `<button type="button" data-ai-empty-action="${disabledActions[index]}">${escapeHtml(tag)}</button>`).join('');
  root.innerHTML = `<div class="ai-assist-empty-inner"><strong>${escapeHtml(hasAi ? copy.emptyEnabledTitle : copy.emptyDisabledTitle)}</strong><p>${escapeHtml(hasAi ? copy.emptyEnabledBody : copy.emptyDisabledBody)}</p><div class="ai-assist-empty-tags">${tags}</div></div>`;
  root.hidden = false;
}
function hideAiAssistEmptyState() {
  const root = aiAssistEmptyRoot();
  if (root) { root.hidden = true; root.innerHTML = ''; }
}
function openAiAssistPopover(anchor) {
  document.querySelector('[data-ai-assist-popover]')?.remove();
  const copy = (aiAssistCopy[locale] || aiAssistCopy.en).popover;
  const pop = document.createElement('div');
  pop.className = 'ai-assist-popover';
  pop.dataset.aiAssistPopover = '';
  pop.innerHTML = `<strong>${escapeHtml(copy.title)}</strong><p>${escapeHtml(copy.body)}</p><div class="ai-assist-popover-actions"><button class="modal-action" data-ai-assist-configure type="button">${escapeHtml(copy.configure)}</button><button class="secondary" data-ai-assist-later type="button">${escapeHtml(copy.later)}</button></div>`;
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(rect.bottom + 8)}px`;
  pop.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
  pop.addEventListener('click', (event) => {
    if (event.target.closest('[data-ai-assist-configure]')) { pop.remove(); openModal('ai-assist'); }
    else if (event.target.closest('[data-ai-assist-later]')) { pop.remove(); }
  });
  const close = (event) => { if (!pop.contains(event.target) && !anchor.contains(event.target)) { pop.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}
document.querySelector('[data-ai-assist-toggle]')?.addEventListener('click', () => {
  const button = aiAssistToggleButton();
  if (!button) return;
  if (aiAssistEnabled()) { openModal('ai-assist'); return; }
  openAiAssistPopover(button);
});
// 空态引导中的快捷操作（无需 AI）：插入当前字幕。
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-ai-empty-action]');
  if (!action || !meetingActive) return;
  if (action.dataset.aiEmptyAction === 'insert-latest') {
    const info = liveSegmentData.get(latestLiveSegmentId);
    if (info) { liveNotesEditor.appendMarkdown(info.text); showToast(t('已加入笔记')); }
    else showToast(t('暂无字幕可插入'));
  }
});
// —— 实时 AI 辅助（阶段 3/4）：启动/停止引擎 + 输入状态信号 + 建议接收与 UI ——
let latestAiSuggestion = null;
let aiSuggestionQueue = [];
let aiNoteTypingTimer;
let aiNoteUserTyping = false;
let aiSuggestionAutoFadeTimer;
function aiSuggestionRoot() { return document.querySelector('[data-ai-suggestion]'); }
/** 组装 AI 辅助的独立连接信息；未配置返回 null。@returns {object|null} */
function aiNoteConnection() {
  const config = requestConfig(aiAssistConfig);
  if (!config) return null;
  return {
    provider: config.provider,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    model: config.model,
    format: config.format,
    key_reference: config.keyReference,
  };
}
/** AI 已启用且模型已配置时启动实时引擎。@param {string} meetingId 会议 id。@returns {Promise<void>} */
async function startAiNoteForMeeting(meetingId) {
  if (!aiAssistEnabled() || !window.brevia?.aiNote) return;
  const connection = aiNoteConnection();
  if (!connection) return;
  try {
    await window.brevia.aiNote.start({ meeting_id: meetingId, ...connection, proactivity: aiAssistConfig.proactivity, language: locale, prompt: aiNotePromptCopy[locale] || aiNotePromptCopy.en });
  } catch { /* Best Effort：AI 辅助启动失败不影响录音与字幕主链路 */ }
}
function stopAiNoteForMeeting(meetingId) {
  if (window.brevia?.aiNote) window.brevia.aiNote.stop({ meeting_id: meetingId }).catch(() => {});
}
/** 向引擎上报输入状态：打字中静默，停笔后重新评估（PRD §19）。@param {boolean} typing 是否正在输入。@returns {void} */
function signalAiNoteTyping(typing) {
  const meetingId = breviaClient?.state.meeting?.id;
  aiNoteUserTyping = typing;
  if (!typing) flushAutoSuggestions();
  renderAiSuggestion();
  if (!meetingId || !aiAssistEnabled() || !window.brevia?.aiNote) return;
  window.brevia.aiNote.typing({ meeting_id: meetingId, typing, ...(typing ? {} : { notes: currentNotesMarkdown().slice(-20000) }) }).catch(() => {});
}
function requestAiSuggestion() {
  const meetingId = breviaClient?.state.meeting?.id;
  if (!meetingId || !aiAssistEnabled() || aiAssistConfig.proactivity !== 'quiet') return;
  window.brevia?.aiNote?.request({ meeting_id: meetingId, notes: currentNotesMarkdown().slice(-20000) }).catch(() => {});
}
document.querySelector('[data-ai-request]')?.addEventListener('click', requestAiSuggestion);
const pendingAutoSuggestions = [];
function resetAiNoteSuggestions() {
  clearTimeout(aiNoteTypingTimer);
  aiNoteUserTyping = false;
  pendingAutoSuggestions.length = 0;
  aiSuggestionQueue = [];
  latestAiSuggestion = null;
  hideAiSuggestion();
}
function appendAiSuggestion(suggestion) {
  liveNotesEditor.appendMarkdown(`${suggestion.type === 'topic' ? '##' : '-'} ${suggestion.text}`);
  scheduleNotesSave(liveNotesSaveTimer, currentNotesMarkdown, () => breviaClient?.state.meeting?.id);
  window.brevia?.aiNote.dismiss({ meeting_id: suggestion.meeting_id, text: suggestion.text }).catch(() => {});
}
function flushAutoSuggestions() {
  if (aiAssistConfig.proactivity !== 'auto' || aiNoteUserTyping) return;
  while (pendingAutoSuggestions.length) appendAiSuggestion(pendingAutoSuggestions.shift());
}
if (window.brevia?.on) window.brevia.on('ai-note.suggestion', (payload) => {
  if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
  if (aiAssistConfig.proactivity === 'auto') {
    if (aiNoteUserTyping) pendingAutoSuggestions.push(payload);
    else appendAiSuggestion(payload);
    return;
  }
  // 一次分析可能产出多条建议：入队逐条展示，避免后面的覆盖前面的。
  aiSuggestionQueue.push(payload);
  if (aiSuggestionQueue.length > 5) aiSuggestionQueue.shift();
  if (!latestAiSuggestion) showNextAiSuggestion();
});
if (window.brevia?.on) window.brevia.on('ai-note.evidence', (payload) => {
  if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
  const mergeEvidence = (suggestion) => suggestion?.id === payload.id ? { ...suggestion, evidence: payload.evidence } : suggestion;
  latestAiSuggestion = mergeEvidence(latestAiSuggestion);
  aiSuggestionQueue = aiSuggestionQueue.map(mergeEvidence);
  pendingAutoSuggestions = pendingAutoSuggestions.map(mergeEvidence);
  renderAiSuggestion();
});
/** 展示队列里的下一条建议（没有则回到空状态）。@returns {void} */
function showNextAiSuggestion() {
  latestAiSuggestion = aiSuggestionQueue.shift() || null;
  renderAiSuggestion();
}
if (window.brevia?.on) window.brevia.on('ai-note.analyzing', ({ meeting_id: meetingId, active }) => {
  if (meetingId !== breviaClient?.state.meeting?.id) return;
  aiAssistToggleButton()?.classList.toggle('is-analyzing', Boolean(active));
});
/** 建议类型 → 浅色标签键。@param {string} type 后端建议类型。@returns {string} 文案键。 */
function aiSuggestionTypeKey(type) {
  return ({ conclusion: '可能是一个结论', decision: '可能的决策', action: '可能的待办', number: '重要数字', date: '重要日期', question: '待确认事项', risk: '可能的风险', supplement: '补充', topic: '新话题' })[type] || '可能是一个结论';
}
/** 渲染建议：topic → 分割线；打字中 → 徽标；否则 → 建议卡。@returns {void} */
function renderAiSuggestion() {
  const root = aiSuggestionRoot();
  if (!root) return;
  clearTimeout(aiSuggestionAutoFadeTimer);
  if (!latestAiSuggestion || !meetingActive) { root.hidden = true; root.innerHTML = ''; renderAiAssistEmptyState(); return; }
  const suggestion = latestAiSuggestion;
  hideAiAssistEmptyState();
  if (suggestion.type === 'topic') {
    root.innerHTML = `<button type="button" class="ai-topic-divider" data-ai-topic="${escapeHtml(suggestion.id)}">${t('AI 检测到新话题：')}${escapeHtml(suggestion.text)}</button>`;
    root.hidden = false;
    scheduleAiSuggestionAutoFade();
    return;
  }
  if (aiNoteUserTyping) {
    root.innerHTML = `<button type="button" class="ai-suggestion-badge" data-ai-suggestion-badge>✦ ${t('1 条建议')}</button>`;
    root.hidden = false;
    return;
  }
  const label = t(aiSuggestionTypeKey(suggestion.type));
  const actionLabel = suggestion.type === 'supplement' ? t('补充') : t('加入笔记');
  const evidence = Array.isArray(suggestion.evidence) ? suggestion.evidence : [];
  const evidenceLabel = evidence.length ? `<span class="ai-suggestion-evidence" title="${escapeHtml(evidence.join('、'))}">${escapeHtml(t('依据 {count} 段字幕').replace('{count}', evidence.length))}</span>` : '';
  root.innerHTML = `<div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">✦</span> <span class="ai-suggestion-type">${escapeHtml(label)}</span>${evidenceLabel}</div><p class="ai-suggestion-text">${escapeHtml(suggestion.text)}</p><div class="ai-suggestion-actions"><button type="button" class="ai-suggestion-accept" data-ai-accept>＋ ${escapeHtml(actionLabel)}</button><button type="button" class="ai-suggestion-ignore" data-ai-ignore>${t('忽略')}</button></div></div>`;
  root.hidden = false;
  scheduleAiSuggestionAutoFade();
}
function scheduleAiSuggestionAutoFade() {
  clearTimeout(aiSuggestionAutoFadeTimer);
  aiSuggestionAutoFadeTimer = setTimeout(hideAiSuggestion, 15000);
}
function hideAiSuggestion() {
  clearTimeout(aiSuggestionAutoFadeTimer);
  latestAiSuggestion = null;
  // 若队列里还有建议，继续展示下一条；否则回到空状态。
  if (aiSuggestionQueue.length) { showNextAiSuggestion(); return; }
  const root = aiSuggestionRoot();
  if (root) { root.hidden = true; root.innerHTML = ''; }
  renderAiAssistEmptyState();
}
/** 接受建议：把内容写入正式笔记并上报忽略（去重）。@param {string} text 建议文本。@returns {void} */
function acceptAiSuggestion(text) {
  const suggestion = latestAiSuggestion;
  if (!suggestion || !text) return;
  appendAiSuggestion(suggestion);
  hideAiSuggestion();
  showToast(t('已加入笔记'));
}
/** 把 topic 建议转换为笔记正式标题。@returns {void} */
function convertTopicToHeading() {
  const suggestion = latestAiSuggestion;
  if (!suggestion || suggestion.type !== 'topic') return;
  liveNotesEditor.appendMarkdown(`## ${suggestion.text}`);
  hideAiSuggestion();
}
document.addEventListener('click', (event) => {
  const accept = event.target.closest('[data-ai-accept]');
  if (accept) { const suggestion = latestAiSuggestion; if (suggestion) acceptAiSuggestion(suggestion.text); return; }
  if (event.target.closest('[data-ai-ignore]')) {
    const suggestion = latestAiSuggestion;
    const meetingId = breviaClient?.state.meeting?.id;
    if (suggestion && meetingId && window.brevia?.aiNote) window.brevia.aiNote.dismiss({ meeting_id: meetingId, text: suggestion.text }).catch(() => {});
    hideAiSuggestion();
    return;
  }
  if (event.target.closest('[data-ai-suggestion-badge]')) { aiNoteUserTyping = false; renderAiSuggestion(); return; }
  if (event.target.closest('[data-ai-topic]')) { convertTopicToHeading(); return; }
});
/** 返回当前笔记的 Markdown 文本（富文本或源码模式）。@returns {string} Markdown 笔记。 */
function currentNotesMarkdown() {
  return liveNotesEditor.getMarkdown();
}
/** 笔记存储上限（与后端及 IPC 校验一致，足以容纳几张内联图片）。 */
const MAX_NOTES_CHARS = 5 * 1024 * 1024;
let notesLimitNotified = false;
/** 立即把笔记写入后端；超出上限时截断到存储上限并提示一次。@param {string|undefined} meetingId 会议 id。@param {string} notes Markdown 文本。@returns {Promise<void>} */
function persistNotes(meetingId, notes) {
  if (!meetingId || !window.brevia?.meeting?.update) return Promise.resolve();
  let text = String(notes || '');
  if (text.length > MAX_NOTES_CHARS) {
    text = text.slice(0, MAX_NOTES_CHARS);
    if (!notesLimitNotified) {
      notesLimitNotified = true;
      showToast(t('笔记已达容量上限，超出部分未保存。'));
    }
  }
  return window.brevia.meeting.update({ meeting_id: meetingId, updates: { notes: text } });
}
/** 防抖保存实时笔记；会议与文本在输入时共同取快照。@param {{current: number|undefined}} timer 防抖计时器。@param {() => string} getNotes 取笔记文本。@param {() => string|undefined} getMeetingId 取会议 id。@returns {void} */
function scheduleNotesSave(timer, getNotes, getMeetingId) {
  const meetingId = getMeetingId();
  if (!meetingId || !window.brevia?.meeting?.update) return;
  clearTimeout(timer.current);
  const notes = getNotes();
  timer.current = setTimeout(() => {
    void persistNotes(meetingId, notes).catch((error) => showToast(error.message));
  }, 800);
}
const liveNotesSaveTimer = { current: undefined };
document.querySelector('.translation-menu').addEventListener('click', async (event) => {
  const options = document.querySelector('#translation-options');
  if (event.target.closest('#translation-toggle')) {
    options.hidden = !options.hidden;
    document.querySelector('#translation-toggle').setAttribute('aria-expanded', String(!options.hidden));
    return;
  }
  const choice = event.target.closest('[data-live-translation]');
  if (!choice) return;
  const targetLanguage = choice.dataset.liveTranslation || null;
  const changed = targetLanguage !== liveConfig.target_language;
  options.hidden = true;
  document.querySelector('#translation-toggle').setAttribute('aria-expanded', 'false');
  if (await reconfigureLive({ target_language: targetLanguage }) && changed) {
    document.querySelectorAll('.translation').forEach((line) => { line.remove(); });
  }
});
document.querySelector('.live-model-menu').addEventListener('click', async (event) => {
  const options = document.querySelector('#live-model-options');
  const toggle = document.querySelector('#live-model-toggle');
  if (event.target.closest('#live-model-toggle')) {
    options.hidden = !options.hidden;
    toggle.setAttribute('aria-expanded', String(!options.hidden));
    return;
  }
  const choice = event.target.closest('[data-live-model]');
  if (!choice) return;
  const modelId = choice.dataset.liveModel;
  options.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  if (modelId === liveConfig.refined_model_id) return;
  // 未安装的模型会带回 model_required：交给既有的下载队列，下完再由用户重新切换。
  const ok = await reconfigureLive({ refined_model_id: modelId });
  if (!ok) return;
  renderLiveModelControl();
});
document.querySelector('#live-more-toggle').addEventListener('click', (event) => {
  const panel = document.querySelector('#live-more-panel');
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  document.querySelector('#live-more-panel').hidden = true;
  document.querySelector('#live-more-toggle').setAttribute('aria-expanded', 'false');
  for (const [options, toggle] of [['#translation-options', '#translation-toggle'], ['#live-model-options', '#live-model-toggle']]) {
    document.querySelector(options).hidden = true;
    document.querySelector(toggle).setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.live-more')) {
    document.querySelector('#live-more-panel').hidden = true;
    document.querySelector('#live-more-toggle').setAttribute('aria-expanded', 'false');
  }
  if (!event.target.closest('.translation-menu')) {
    document.querySelector('#translation-options').hidden = true;
    document.querySelector('#translation-toggle').setAttribute('aria-expanded', 'false');
  }
  // 实时识别模型下拉同样需要点外部收起，否则它会一直悬在页面上且 aria-expanded 停在 true。
  if (!event.target.closest('.live-model-menu')) {
    document.querySelector('#live-model-options').hidden = true;
    document.querySelector('#live-model-toggle').setAttribute('aria-expanded', 'false');
  }
});
document.querySelector('#floating-caption-toggle').addEventListener('click', async () => {
  floatingCaptionMode = nextFloatingCaptionMode('live');
  floatingCaptionLocale = locale;
  renderFloatingCaptionToggle();
  renderPlaybackFloatingCaptionToggle();

  if (floatingCaptionMode === 'live') {
    try {
      await window.brevia?.floatingCaption?.show();
      // Wait a bit for the window to be fully ready
      await new Promise(resolve => setTimeout(resolve, 200));
      if (floatingCaptionMode !== 'live') return;
      const currentSegment = liveSegments.get(latestLiveSegmentId);
      window.brevia.floatingCaption.update({
        segmentId: latestLiveSegmentId,
        text: currentSegment?.querySelector('.segment-copy > p')?.textContent || '',
        isRefined: true,
        updateFinalized: true,
        clearCurrentIfMatch: true,
        locale: floatingCaptionLocale,
      });
      const translation = currentSegment?.querySelector('.translation')?.textContent;
      if (translationAllowed && translation) {
        window.brevia.floatingCaption.update({
          segmentId: latestLiveSegmentId,
          translation,
        });
      }
    } catch (error) {
      if (floatingCaptionMode !== 'live') return;
      showToast(error.message);
      floatingCaptionMode = null;
      renderFloatingCaptionToggle();
      renderPlaybackFloatingCaptionToggle();
    }
  } else {
    await window.brevia?.floatingCaption?.close();
  }
});
meetingSearch.addEventListener('input', () => { scheduleMeetingSearch(); });
meetingSearchClear.addEventListener('click', () => { meetingSearch.value = ''; meetingSearchClear.hidden = true; meetingSearch.focus(); updateSearchPopup(); });
meetingSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeSearchPopup(); meetingSearch.blur(); }
});
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.library-search')) closeSearchPopup(); });
meetingSearch.addEventListener('focus', () => { if (meetingSearch.value.trim()) updateSearchPopup(); });
searchResultsPanel.addEventListener('click', async (event) => {
  const result = event.target.closest('[data-search-result]');
  if (!result) return;
  const meetingId = result.dataset.searchResult;
  closeSearchPopup();
  meetingSearch.value = '';
  meetingSearchClear.hidden = true;
  if (!meetingId || !window.brevia) { showView('detail'); return; }
  try {
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
    breviaClient.state.selectedMeetingId = meetingId;
    applyBackendDetail(meeting);
    showView('detail');
  } catch (error) { showToast(error.message); }
});
/** 对搜索结果文本进行安全高亮。@param {string} text 原文。@param {string} query 关键词。@returns {string} 带 <mark> 高亮的 HTML。 */
function highlightSearchMatch(text, query) {
  const source = String(text || '');
  const needle = query.trim();
  if (!needle) return escapeHtml(source);
  const lower = source.toLowerCase();
  const q = needle.toLowerCase();
  let out = ''; let i = 0;
  while (i < source.length) {
    const hit = lower.indexOf(q, i);
    if (hit === -1) { out += escapeHtml(source.slice(i)); break; }
    if (hit > i) out += escapeHtml(source.slice(i, hit));
    out += `<mark>${escapeHtml(source.slice(hit, hit + q.length))}</mark>`;
    i = hit + q.length;
  }
  return out;
}
/** 搜索输入变化后（带防抖）刷新结果浮窗。@returns {void} */
function scheduleMeetingSearch() {
  const query = meetingSearch.value;
  meetingSearchClear.hidden = !query.trim();
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(updateSearchPopup, 160);
}
/** 渲染搜索结果浮窗。@returns {Promise<void>} */
async function updateSearchPopup() {
  const query = meetingSearch.value.trim();
  if (!query) { closeSearchPopup(); return; }
  const requestId = ++searchRequestId;
  let meetings;
  try {
    meetings = window.brevia ? await window.brevia.meeting.search({ query }) : [];
  } catch (error) { closeSearchPopup(); showToast(error.message); return; }
  if (requestId !== searchRequestId) return;
  if (!meetings.length) {
    searchResultsPanel.innerHTML = `<div class="search-results-empty">${escapeHtml(t('未找到匹配的会议'))}</div>`;
  } else {
    searchResultsPanel.innerHTML = `<div class="search-results-head">${escapeHtml(query)}<small>${t('{count} 条结果').replace('{count}', String(meetings.length))}</small></div>${meetings.map((meeting) => {
      const created = (meeting.created_at || meeting.createdAt) ? new Date(meeting.created_at || meeting.createdAt).toLocaleDateString(BreviaI18n.localeTag(locale), { month: 'short', day: 'numeric' }) : '';
      const durationMs = meeting.duration_ms != null ? meeting.duration_ms : meeting.durationMs;
      const duration = durationMs ? `${Math.round(durationMs / 60000)} ${t('分钟')}` : '';
      const snippet = meeting.snippets && meeting.snippets.length
        ? `<p class="search-snippet"><b>${highlightSearchMatch(meeting.snippets[0].speaker_name, query)}</b><span>${highlightSearchMatch(meeting.snippets[0].text, query)}</span></p>`
        : `<p class="search-snippet search-snippet-title"><span>${escapeHtml(t('标题匹配'))}</span></p>`;
      return `<button type="button" class="search-result" role="option" data-search-result="${escapeHtml(meeting.id)}"><strong>${highlightSearchMatch(meeting.title, query)}</strong><small>${escapeHtml([created, duration].filter(Boolean).join(' · '))}</small>${snippet}</button>`;
    }).join('')}`;
  }
  searchResultsPanel.hidden = false;
}
function closeSearchPopup() { searchResultsPanel.hidden = true; searchResultsPanel.innerHTML = ''; }
const meetingSelectionSurface = document.querySelector('#home-view');
let dragSelection;
let suppressMeetingClick = false;
const toggleMeetingSelection = (row) => { const key = row.dataset.selectionKey; if (selectedMeetingKeys.has(key)) selectedMeetingKeys.delete(key); else selectedMeetingKeys.add(key); syncMeetingSelection(); };
document.querySelector('#meeting-select-all')?.addEventListener('click', () => {
  const rows = [...meetingList.querySelectorAll('.meeting-row:not([hidden])')];
  const allSelected = rows.length > 0 && rows.every((row) => selectedMeetingKeys.has(row.dataset.selectionKey));
  if (allSelected) clearMeetingSelection();
  else { rows.forEach((row) => selectedMeetingKeys.add(row.dataset.selectionKey)); syncMeetingSelection(); }
});
meetingSelectionSurface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.clientY < libraryToolbar.getBoundingClientRect().top || event.target.closest('.meeting-row, .meeting-actions, .batch-toolbar')) return;
  dragSelection = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, additive: event.shiftKey, initial: new Set(selectedMeetingKeys), moved: false, marquee: document.createElement('div') };
  dragSelection.marquee.className = 'selection-marquee';
});
meetingSelectionSurface.addEventListener('dragstart', (event) => { if (!event.target.closest('.meeting-row[draggable]')) event.preventDefault(); });
meetingList.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.meeting-row[draggable]');
  if (!row || event.target.closest('.meeting-actions')) return event.preventDefault();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.meetingId);
});
meetingSelectionSurface.addEventListener('pointermove', (event) => {
  if (!dragSelection || event.pointerId !== dragSelection.pointerId) return;
  if (!dragSelection.moved && Math.hypot(event.clientX - dragSelection.x, event.clientY - dragSelection.y) < 4) return;
  event.preventDefault();
  if (!dragSelection.moved) {
    dragSelection.moved = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
    meetingSelectionSurface.setPointerCapture(event.pointerId);
    meetingList.classList.add('is-selecting');
    document.body.append(dragSelection.marquee);
  }
  const left = Math.min(dragSelection.x, event.clientX);
  const top = Math.min(dragSelection.y, event.clientY);
  const right = Math.max(dragSelection.x, event.clientX);
  const bottom = Math.max(dragSelection.y, event.clientY);
  dragSelection.marquee.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
  const next = dragSelection.additive ? new Set(dragSelection.initial) : new Set();
  meetingList.querySelectorAll('.meeting-row:not([hidden])').forEach((row) => {
    const rect = row.getBoundingClientRect();
    if (rectanglesIntersect(rect, { left, right, top, bottom })) next.add(row.dataset.selectionKey);
  });
  selectedMeetingKeys.clear();
  next.forEach((key) => selectedMeetingKeys.add(key));
  syncMeetingSelection(false);
});
const finishDragSelection = (event) => {
  if (!dragSelection || event.pointerId !== dragSelection.pointerId) return;
  // ponytail: marquee covers visible rows; add edge auto-scroll only if long-list drag selection needs it.
  if (dragSelection.moved) {
    suppressMeetingClick = true;
    window.setTimeout(() => { suppressMeetingClick = false; }, 0);
  }
  dragSelection.marquee.remove();
  meetingList.classList.remove('is-selecting');
  if (meetingSelectionSurface.hasPointerCapture(event.pointerId)) meetingSelectionSurface.releasePointerCapture(event.pointerId);
  dragSelection = undefined;
  syncMeetingSelection();
};
meetingSelectionSurface.addEventListener('pointerup', finishDragSelection);
meetingSelectionSurface.addEventListener('pointercancel', finishDragSelection);
meetingSelectionSurface.addEventListener('click', (event) => {
  if (!suppressMeetingClick) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
meetingList.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea')) return;
  const row = event.target.closest('.meeting-row');
  if (row && event.key === ' ') { event.preventDefault(); toggleMeetingSelection(row); }
});
const batchExportFormats = ['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'wav'];
function openBatchExport() {
  activeModal = 'batch-export';
  settingsModal.querySelector('h2').textContent = t('选择导出格式');
  settingsModal.querySelector('.modal-title p').textContent = BreviaI18n.selectionOverview(locale, selectedMeetings().length);
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="export-options">${batchExportFormats.map((format) => `<button type="button" data-batch-export-format="${format}"><span><b>${format.toUpperCase()}</b></span><strong>.${format}</strong></button>`).join('')}</div>`;
  showSettingsModal();
}
async function exportSelectedMeetings(format) {
  const meetings = selectedMeetings();
  if (!meetings.length || !format) return;
  try {
    const result = window.brevia
      ? await window.brevia.meeting.exportMany({ meeting_ids: meetings.map(({ id }) => id).filter(Boolean), format, filename_prefix: `[${format === 'wav' ? t('会议录音') : t('字幕')}]` })
      : { paths: meetings.map(({ title }) => `${title}.${format}`) };
    if (result) showToast(`${t('导出')}: ${BreviaI18n.selectionOverview(locale, meetings.length)}`);
  } catch (error) { showToast(error.message); }
}
batchToolbar.addEventListener('click', async (event) => {
  if (event.target.closest('[data-batch-clear]')) { clearMeetingSelection(); return; }
  const meetings = selectedMeetings();
  if (event.target.closest('[data-batch-restore]')) {
    try {
      await mutateMeetings('restore', meetings);
      showToast(t('恢复'));
    } catch (error) { await refreshBackendMeetings(true); showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-batch-export]')) {
    openBatchExport();
    return;
  }
  const permanently = activeLibraryNav === 'recently-deleted';
  const deleteLabel = permanently ? BreviaI18n.trashCopy(locale).purge : t('删除');
  if (event.target.closest('[data-batch-delete]')) {
    openConfirmation(deleteLabel, `${BreviaI18n.selectionOverview(locale, meetings.length)}\n${deleteLabel}?`, async () => {
      try { await mutateMeetings(permanently ? 'purge' : 'delete', meetings); } catch (error) { await refreshBackendMeetings(); showToast(error.message); }
    });
  }
});
const positionMeetingMenu = (menu, toggle, opensLeft = false) => {
  const anchor = toggle.getBoundingClientRect();
  const height = menu.offsetHeight;
  const opensUp = window.innerHeight - anchor.bottom < height && anchor.top >= height;
  const left = opensLeft ? anchor.left - menu.offsetWidth - 4 : anchor.right - menu.offsetWidth;
  menu.classList.toggle('opens-up', opensUp);
  menu.style.top = `${opensUp ? anchor.top - height : anchor.bottom}px`;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
};
const positionOpenMeetingMenus = () => document.querySelectorAll('.meeting-menu:not([hidden])').forEach((menu) => {
  const toggle = menu.closest('.meeting-actions')?.querySelector('[data-meeting-menu]');
  if (toggle) positionMeetingMenu(menu, toggle);
});
const openMeetingMenu = (menu, toggle, opensLeft = false) => { menu.hidden = false; positionMeetingMenu(menu, toggle, opensLeft); };
const closeMeetingMenus = () => { document.querySelectorAll('.meeting-menu').forEach((menu) => { menu.hidden = true; }); document.querySelectorAll('[data-meeting-menu]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false')); };
meetingList.addEventListener('scroll', positionOpenMeetingMenus);
window.addEventListener('resize', positionOpenMeetingMenus);
/** 为行操作和批量操作运行一次会议变更。*/
async function mutateMeetings(action, meetings) {
  const ids = new Set(meetings.map(({ id }) => id).filter(Boolean));
  const completed = new Set();
  try {
    for (const meeting_id of ids) {
      if (window.brevia) await window.brevia.meeting[action]({ meeting_id });
      completed.add(meeting_id);
    }
  } finally {
    // 与主进程的串行删除保护一致；失败时也同步已完成项，只扫描一次列表。
    if (['delete', 'restore', 'purge'].includes(action)) uiData.meetings = uiData.meetings.filter((meeting) => !completed.has(meeting.id));
    clearMeetingSelection();
    renderMeetingList();
  }
}
async function openMeetingRow(row) {
  if (!window.brevia) { showView('detail'); return; }
  const request = ++meetingListRequest;
  breviaClient.state.selectedMeetingId = row.dataset.meetingId;

  const meetingId = row.dataset.meetingId;
  row.style.opacity = '0.6';

  try {
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });

    row.style.opacity = '';
    if (request !== meetingListRequest) return;
    applyBackendDetail(meeting);
    showView('detail');
  } catch (error) {
    row.style.opacity = '';
    showToast(error.message);
  }
}
meetingList.addEventListener('click', async (event) => {
  if (suppressMeetingClick) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (event.target.closest('[data-rename-meeting]')) { event.stopPropagation(); return; }
  const selectionRow = event.target.closest('.meeting-row');
  if (selectionRow && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); toggleMeetingSelection(selectionRow); return; }
  const actions = event.target.closest('.meeting-actions');
  if (!actions) {
    if (selectionRow && activeLibraryNav !== 'recently-deleted') {
      try { await openMeetingRow(selectionRow); } catch (error) { showToast(error.message); }
    }
    return;
  }
  event.stopPropagation();
  const menuToggle = event.target.closest('[data-meeting-menu]');
  if (menuToggle) { const menu = actions.querySelector('.meeting-menu'); const opening = menu.hidden; closeMeetingMenus(); if (opening) openMeetingMenu(menu, menuToggle); menuToggle.setAttribute('aria-expanded', String(opening)); return; }
  const action = event.target.closest('[data-meeting-action]');
  if (action) {
    const index = Number(action.dataset.meetingIndex);
    const meeting = uiData.meetings[index];
    if (action.dataset.meetingAction === 'workspace') {
      const rect = action.getBoundingClientRect();
      closeMeetingMenus();
      if (typeof showWorkspaceAssignMenu === 'function') {
        showWorkspaceAssignMenu(index, rect);
      }
      return;
    }
    if (action.dataset.meetingAction === 'rename') { editingMeetingIndex = index; closeMeetingMenus(); renderMeetingList(); requestAnimationFrame(() => { const input = meetingList.querySelector('[data-rename-meeting] input'); input?.focus(); input?.select(); }); return; }
    if (action.dataset.meetingAction === 'open-folder') {
      try {
        const detail = await window.brevia?.meeting.get({ meeting_id: meeting.id });
        const audio = detail?.audio?.playback?.mix || detail?.audio?.playback?.mic || detail?.audio?.playback?.system;
        if (!audio) { showToast(t('未找到录音文件')); return; }
        await window.brevia.showItem(audio);
      } catch (error) { showToast(error.message); }
      closeMeetingMenus();
      return;
    }
    if (action.dataset.meetingAction === 'export') { closeMeetingMenus(); if (window.brevia && meeting.id) window.brevia.meeting.export({ meeting_id: meeting.id, content: 'transcript', format: 'md', filename_prefix: `[${t('字幕')}]` }).then((value) => value && showToast(t('已导出「{title}」').replace('{title}', meeting.title))).catch((error) => showToast(error.message)); else showToast(t('已导出「{title}」').replace('{title}', meeting.title)); return; }
    if (action.dataset.meetingAction === 'delete') {
      openConfirmation(t('删除'), `「${meeting.title}」`, async () => {
        try { await mutateMeetings('delete', [meeting]); showToast(t(meeting.isExample ? '示例会议及录音已删除' : '会议已移至最近删除')); } catch (error) { showToast(error.message); }
      });
      return;
    }
    if (action.dataset.meetingAction === 'restore') { try { await mutateMeetings('restore', [meeting]); showToast(t('恢复')); } catch (error) { showToast(error.message); } return; }
    if (action.dataset.meetingAction === 'purge') { openConfirmation(BreviaI18n.trashCopy(locale).purge, `「${meeting.title}」`, async () => { try { await mutateMeetings('purge', [meeting]); showToast(BreviaI18n.trashCopy(locale).purge); } catch (error) { showToast(error.message); } }); return; }
  }
});
meetingList.addEventListener('submit', (event) => {
  if (event.target.matches('[data-rename-meeting]')) { event.preventDefault(); const title = new FormData(event.target).get('title').trim(); const meeting = uiData.meetings[Number(event.target.dataset.meetingIndex)]; editingMeetingIndex = null; if (title) { meeting.title = title; if (window.brevia && meeting.id) window.brevia.meeting.update({ meeting_id: meeting.id, updates: { title } }).catch((error) => showToast(error.message)); } renderMeetingList(); return; }
});
meetingList.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && event.target.matches('[data-rename-meeting] input')) { editingMeetingIndex = null; renderMeetingList(); }
});
document.addEventListener('click', (event) => {
  const renameForm = meetingList.querySelector('[data-rename-meeting]');
  if (renameForm && !event.target.closest('.meeting-row')) renameForm.requestSubmit();
  if (!event.target.closest('.flow-select')) document.querySelectorAll('.flow-select-options:not([hidden])').forEach((options) => { options.hidden = true; options.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  if (!event.target.closest('.meeting-actions')) closeMeetingMenus();

  // 工作区相关事件
  const workspaceItem = event.target.closest('.workspace-item');
  if (workspaceItem && typeof switchWorkspace === 'function') {
    const workspaceId = workspaceItem.dataset.workspaceId || '';
    void switchWorkspace(workspaceId);
    return;
  }

  const newWorkspaceBtn = event.target.closest('[data-new-workspace]');
  if (newWorkspaceBtn && typeof showNewWorkspaceDialog === 'function') {
    showNewWorkspaceDialog();
    return;
  }

  const assignWorkspace = event.target.closest('[data-assign-workspace]');
  if (assignWorkspace && typeof assignMeetingToWorkspace === 'function') {
    const meetingIndex = Number(assignWorkspace.dataset.meetingIndex);
    const workspaceId = assignWorkspace.dataset.assignWorkspace;
    const meeting = uiData.meetings[meetingIndex];
    if (meeting?.id) {
      assignMeetingToWorkspace(meeting.id, workspaceId);
    }
    return;
  }

  const newWorkspaceAssign = event.target.closest('[data-new-workspace-assign]');
  if (newWorkspaceAssign && typeof showNewWorkspaceDialog === 'function') {
    const meetingIndex = Number(newWorkspaceAssign.dataset.meetingIndex);
    const meeting = uiData.meetings[meetingIndex];
    showNewWorkspaceDialog(meeting?.id);
    return;
  }
});

// 工作区右键菜单
document.addEventListener('contextmenu', (event) => {
  const workspaceItem = event.target.closest('.workspace-item');
  if (workspaceItem && typeof showEditWorkspaceDialog === 'function') {
    const workspaceId = workspaceItem.dataset.workspaceId;
    // 只有非公开工作区才能右键编辑
    if (workspaceId) {
      event.preventDefault();
      showEditWorkspaceDialog(workspaceId);
    }
  }
});

const playerTime = document.querySelector('#player-time');
const playerDuration = document.querySelector('#player-duration');
const playButton = document.querySelector('#play');
let playbackCaptionSegmentId = undefined;
function syncPlaybackFloatingCaption() {
  if (floatingCaptionMode !== 'playback' || !window.brevia?.floatingCaption) return;
  const segment = uiData.detail.transcript.find((item) => playerAudio.currentTime >= item.startSeconds && playerAudio.currentTime < item.endSeconds);
  const segmentId = segment?.speaker?.segmentId ?? null;
  if (segmentId === playbackCaptionSegmentId) return;
  playbackCaptionSegmentId = segmentId;
  window.brevia.floatingCaption.update({ segmentId, text: segment?.text || '', translation: segment?.translation || null, isRefined: true, locale: floatingCaptionLocale });
}
function renderMiniPlayback() {
  const active = activeView !== 'detail' && playbackStarted && Boolean(playerAudio.src) && !playerAudio.ended;
  const wasHidden = miniPlayback.hidden;
  miniPlayback.hidden = !active;
  if (!active) return;
  if (wasHidden) taskCards.append(miniPlayback);
  miniPlayback.querySelector('#mini-playback-title').textContent = currentMeetingDetail?.title || t('播放录音');
  const segment = uiData.detail.transcript.find((item) => playerAudio.currentTime >= item.startSeconds && playerAudio.currentTime < item.endSeconds);
  const ratio = segment ? Math.max(0, Math.min(1, (playerAudio.currentTime - segment.startSeconds) / Math.max(.1, segment.endSeconds - segment.startSeconds))) : 0;
  miniPlayback.querySelector('#mini-playback-caption').textContent = segment ? segment.text.slice(0, Math.max(1, Math.ceil(segment.text.length * ratio))) : '';
  miniPlayback.querySelector('#mini-playback-state').textContent = playerAudio.paused ? t('暂停') : t('正在播放');
  miniPlaybackSeek.setAttribute('aria-valuemax', String(playerAudio.duration || 0));
  miniPlaybackSeek.setAttribute('aria-valuenow', String(playerAudio.currentTime));
  miniPlaybackSeek.querySelector('i').style.transform = `scaleX(${playerAudio.duration ? playerAudio.currentTime / playerAudio.duration : 0})`;
  miniPlaybackToggle.textContent = playerAudio.paused ? '▶' : 'Ⅱ';
  miniPlaybackToggle.setAttribute('aria-label', playerAudio.paused ? t('继续') : t('暂停'));
}
const updatePlayerControl = () => {
  const playing = !playerAudio.paused && !playerAudio.ended;
  playButton.classList.toggle('is-playing', playing);
  playButton.textContent = playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-label', t(playing ? '暂停录音' : '播放录音'));
  renderMiniPlayback();
};
/** 将音频进度控件格式化为 mm:ss 显示。@returns {void} */
const renderPlayerTime = () => {
  playerTime.textContent = formatMeetingTime(Number(progress.value) * 1000);
  playerDuration.textContent = formatMeetingTime(Number(progress.max) * 1000);
  progress.style.setProperty('--played', `${Number(progress.value) / Number(progress.max) * 100}%`);
};
/** 突出显示当前播放时间的转录段落，并使其在自己的滚动器中居中。*/
function syncPlaybackTranscript() {
  syncPlaybackFloatingCaption();
  const body = document.querySelector('.transcript-body');
  if (!body) return;
  const current = playerAudio.currentTime;
  const segments = [...body.querySelectorAll('.segment[data-start][data-end]')];
  const active = segments.find((segment) => current >= Number(segment.dataset.start) && current < Number(segment.dataset.end));
  const previous = body.querySelector('.segment.is-active');
  if (previous === active) return;
  if (previous) { previous.classList.remove('is-active'); previous.removeAttribute('aria-current'); }
  if (!active) return;
  active.classList.add('is-active');
  active.setAttribute('aria-current', 'true');
  if (!followPlaybackTranscript) return;
  const bodyRect = body.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  body.scrollTo({
    top: body.scrollTop + activeRect.top - bodyRect.top - (body.clientHeight - activeRect.height) / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
progress.addEventListener('input', () => { followPlaybackTranscript = true; renderPlayerTime(); playerAudio.currentTime = Number(progress.value); syncPlaybackTranscript(); });
playButton.addEventListener('click', async () => {
  if (!playerAudio.src) { showToast(t('这场会议没有可播放的录音')); return; }
  if (playerAudio.paused) await playerAudio.play(); else playerAudio.pause();
  showToast(message(playerAudio.paused ? 'paused' : 'playing'));
});
playerAudio.addEventListener('play', () => { playbackStarted = true; updatePlayerControl(); });
playerAudio.addEventListener('pause', updatePlayerControl);
playerAudio.addEventListener('ended', () => { playbackStarted = false; updatePlayerControl(); });
playerAudio.addEventListener('timeupdate', () => { progress.value = playerAudio.currentTime; renderPlayerTime(); syncPlaybackTranscript(); renderMiniPlayback(); });
document.querySelector('#playback-floating-caption-toggle')?.addEventListener('click', async () => {
  floatingCaptionMode = nextFloatingCaptionMode('playback');
  renderFloatingCaptionToggle();
  renderPlaybackFloatingCaptionToggle();
  if (floatingCaptionMode !== 'playback') { await window.brevia?.floatingCaption?.close(); return; }
  try {
    await window.brevia?.floatingCaption?.show();
    if (floatingCaptionMode !== 'playback') return;
    playbackCaptionSegmentId = undefined;
    syncPlaybackFloatingCaption();
  } catch (error) {
    if (floatingCaptionMode !== 'playback') return;
    showToast(error.message);
    floatingCaptionMode = null;
    renderFloatingCaptionToggle();
    renderPlaybackFloatingCaptionToggle();
  }
});
function seekMiniPlayback(clientX) {
  followPlaybackTranscript = true;
  const bounds = miniPlaybackSeek.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  playerAudio.currentTime = ratio * (playerAudio.duration || 0);
  progress.value = playerAudio.currentTime;
  renderPlayerTime();
  syncPlaybackTranscript();
  renderMiniPlayback();
}
miniPlaybackSeek.addEventListener('pointerdown', (event) => {
  miniPlaybackSeek.setPointerCapture(event.pointerId);
  seekMiniPlayback(event.clientX);
});
miniPlaybackSeek.addEventListener('pointermove', (event) => { if (miniPlaybackSeek.hasPointerCapture(event.pointerId)) seekMiniPlayback(event.clientX); });
miniPlaybackSeek.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  playerAudio.currentTime = Math.max(0, Math.min(playerAudio.duration || 0, playerAudio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
  progress.value = playerAudio.currentTime;
  renderPlayerTime(); syncPlaybackTranscript(); renderMiniPlayback();
});
miniPlaybackToggle.addEventListener('click', async () => {
  if (playerAudio.paused) await playerAudio.play();
  else playerAudio.pause();
});
miniPlaybackClose.addEventListener('click', () => {
  playbackStarted = false;
  playerAudio.pause();
  playerAudio.currentTime = 0;
  updatePlayerControl();
  if (floatingCaptionMode === 'playback') {
    floatingCaptionMode = null;
    renderPlaybackFloatingCaptionToggle();
    void window.brevia?.floatingCaption?.close();
  }
});
miniPlayback.addEventListener('dblclick', (event) => { if (!event.target.closest('button')) void showView('detail'); });
document.querySelectorAll('.player .skip').forEach((button, index) => button.addEventListener('click', () => {
  playerAudio.currentTime = Math.max(0, Math.min(playerAudio.duration || 0, playerAudio.currentTime + (index ? 15 : -15)));
}));
document.querySelector('.player-speed').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) {
    const options = toggle.parentElement.querySelector('.flow-select-options');
    options.hidden = !options.hidden;
    toggle.setAttribute('aria-expanded', String(!options.hidden));
    return;
  }
  const option = event.target.closest('[data-playback-rate]');
  if (!option) return;
  const speed = option.closest('.player-speed');
  speed.querySelector('input').value = option.dataset.playbackRate;
  speed.querySelector('.flow-select-toggle').firstChild.nodeValue = option.textContent;
  speed.querySelector('.flow-select-options').hidden = true;
  speed.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
  playerAudio.playbackRate = Number(option.dataset.playbackRate);
});
themeToggle.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));

async function saveInlineSegmentSpeaker(form) {
  if (form.dataset.saving) return;
  const name = new FormData(form).get('name').trim();
  if (!name) { editingSegmentSpeakerId = undefined; renderMeetingDetail(); return; }
  form.dataset.saving = 'true';
  try {
    const meeting = await window.brevia?.segment.speaker({ meeting_id: currentMeetingDetail.id, segment_id: form.dataset.segmentId, name });
    editingSegmentSpeakerId = undefined;
    if (meeting) applyBackendDetail(meeting);
  } catch (error) { delete form.dataset.saving; showToast(error.message); }
}
const finalTranscript = document.querySelector('.final-transcript');
const segmentContextMenu = document.createElement('div');
segmentContextMenu.className = 'segment-context-menu';
segmentContextMenu.hidden = true;
document.body.append(segmentContextMenu);
let contextSegmentId;
let contextMeetingId;
let contextSegment;
function closeSegmentContextMenu() {
  contextSegmentId = undefined;
  contextMeetingId = undefined;
  contextSegment = undefined;
  segmentContextMenu.hidden = true;
  segmentContextMenu.querySelectorAll('.segment-context-options').forEach((options) => { options.style.removeProperty('left'); options.style.removeProperty('top'); });
  segmentContextMenu.querySelectorAll('.is-open, .is-positioned').forEach((item) => item.classList.remove('is-open', 'is-positioned'));
}
function positionFloating(floating, reference, placements = ['right-start', 'left-start', 'right-end', 'left-end']) {
  const anchor = reference.getBoundingClientRect ? reference.getBoundingClientRect() : reference;
  floating.style.left = '0px';
  floating.style.top = '0px';
  const width = floating.offsetWidth;
  const height = floating.offsetHeight;
  const positions = {
    'right-start': { left: anchor.right, top: anchor.top },
    'left-start': { left: anchor.left - width, top: anchor.top },
    'right-end': { left: anchor.right, top: anchor.bottom - height },
    'left-end': { left: anchor.left - width, top: anchor.bottom - height },
  };
  const position = placements.map((placement) => positions[placement]).find(({ left, top }) => left >= 8 && top >= 8 && left + width <= window.innerWidth - 8 && top + height <= window.innerHeight - 8) || positions[placements[0]];
  floating.style.left = `${Math.max(8, Math.min(position.left, window.innerWidth - width - 8))}px`;
  floating.style.top = `${Math.max(8, Math.min(position.top, window.innerHeight - height - 8))}px`;
}
function fitSegmentSubmenu(submenu) {
  const options = submenu.querySelector(':scope > .segment-context-options');
  if (!options || submenu.classList.contains('is-positioned')) return;
  positionFloating(options, submenu.querySelector(':scope > button'));
  submenu.classList.add('is-positioned');
}
function openSegmentContextMenu(meetingId, segmentId, x, y, segmentInfo) {
  followLiveTranscript = false;
  followPlaybackTranscript = false;
  contextMeetingId = meetingId;
  contextSegmentId = segmentId;
  contextSegment = segmentInfo || null;
  const profiles = speakerProfiles.map((profile) => `<button type="button" data-add-segment-profile-sample="${profile.id}">${escapeHtml(speakerProfileName(profile))}</button>`).join('');
  const createProfile = `<div class="segment-context-submenu"><button type="button" data-open-segment-profile-create><span class="segment-context-label">${t('新增声纹')}</span><span class="segment-context-arrow" aria-hidden="true">›</span></button><form class="segment-context-options segment-context-name-form" data-create-segment-profile><label>${t('声纹名称')}<input name="name" maxlength="32" required autocomplete="off" /></label><button type="submit">${t('确定')}</button></form></div>`;
  segmentContextMenu.innerHTML = `<div class="segment-context-submenu"><button type="button" data-add-segment-note><span class="segment-context-label">${t('加入笔记')}</span></button></div><div class="segment-context-submenu"><button type="button" data-open-segment-profile-menu><span class="segment-context-label">${t('添加录音到声纹库')}</span><span class="segment-context-arrow" aria-hidden="true">›</span></button><div class="segment-context-options">${profiles || `<span>${t('暂无已注册声纹')}</span>`}${createProfile}</div></div>`;
  segmentContextMenu.style.visibility = 'hidden';
  segmentContextMenu.hidden = false;
  positionFloating(segmentContextMenu, { left: x, right: x, top: y, bottom: y });
  segmentContextMenu.style.visibility = '';
}
/** 把文本追加到当前活跃的笔记编辑器（live 视图或详情页编辑态）。@param {string} markdown 追加的 Markdown。@param {string} [meetingId] 目标会议 id（live 视图判定用）。@returns {void} */
function appendTextToActiveNotes(markdown, meetingId) {
  if (meetingActive && meetingId && breviaClient?.state.meeting?.id === meetingId) {
    liveNotesEditor.appendMarkdown(markdown);
    return;
  }
  if (!detailNotesEditor) {
    detailNotesBeforeEdit = uiData.detail.notes;
    uiData.detail.notesEditing = true;
    detailActiveTab = 'notes';
    renderMeetingDetail();
  }
  detailNotesEditor.appendMarkdown(markdown);
  updateDetailNotesDraft();
}
/** 根据会议与段落 id 解析字幕元数据（live 视图从内存映射取，详情页从后端段落取）。@param {string} meetingId 会议 id。@param {string} segmentId 段落 id。@returns {{text:string, start_ms:number, speaker:string}|null} */
function segmentInfoFor(meetingId, segmentId) {
  if (meetingId === breviaClient?.state.meeting?.id) {
    return liveSegmentData.get(segmentId) || null;
  }
  const segment = currentMeetingDetail?.segments?.find((item) => item.id === segmentId);
  return segment ? { text: segment.text, start_ms: segment.start_ms, speaker: segment.speaker_name || segment.speaker } : null;
}
segmentContextMenu.addEventListener('click', async (event) => {
  if (event.target.closest('[data-add-segment-note]')) {
    const info = contextSegment;
    const meetingId = contextMeetingId;
    closeSegmentContextMenu();
    if (info) { appendTextToActiveNotes(info.text, meetingId); showToast(t('已加入笔记')); }
    else showToast(t('无法获取字幕内容'));
    return;
  }
  if (event.target.closest('[data-open-segment-profile-menu]')) {
    const submenu = event.target.closest('.segment-context-submenu');
    submenu.classList.toggle('is-open');
    requestAnimationFrame(() => fitSegmentSubmenu(submenu));
    return;
  }
  const create = event.target.closest('[data-open-segment-profile-create]');
  if (create) {
    const submenu = create.closest('.segment-context-submenu');
    submenu.classList.add('is-open');
    requestAnimationFrame(() => fitSegmentSubmenu(submenu));
    submenu.querySelector('input').focus();
    return;
  }
  const profile = event.target.closest('[data-add-segment-profile-sample]');
  if (!profile || !contextSegmentId || !contextMeetingId) return;
  const segmentId = contextSegmentId;
  const meetingId = contextMeetingId;
  closeSegmentContextMenu();
  try {
    const meeting = await window.brevia?.segment.addProfileSample({ meeting_id: meetingId, segment_id: segmentId, profile_id: profile.dataset.addSegmentProfileSample });
    speakerProfiles = await window.brevia.speakerProfile.list();
    if (meeting) applyBackendDetail(meeting);
    showToast(t('已添加录音到声纹库'));
  } catch (error) { showToast(error.message); }
});
segmentContextMenu.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-create-segment-profile]');
  if (!form || !contextSegmentId || !contextMeetingId) return;
  event.preventDefault();
  const name = new FormData(form).get('name').trim();
  if (!name) return;
  const segmentId = contextSegmentId;
  const meetingId = contextMeetingId;
  closeSegmentContextMenu();
  try {
    const meeting = await window.brevia?.segment.speaker({ meeting_id: meetingId, segment_id: segmentId, name, enroll: true });
    speakerProfiles = await window.brevia.speakerProfile.list();
    if (meeting) applyBackendDetail(meeting);
    showToast(t('已创建声纹并添加录音'));
  } catch (error) { showToast(error.message); }
});
segmentContextMenu.addEventListener('pointerover', (event) => {
  const submenu = event.target.closest('.segment-context-submenu');
  if (submenu) requestAnimationFrame(() => fitSegmentSubmenu(submenu));
});
finalTranscript.addEventListener('contextmenu', (event) => {
  const segment = event.target.closest('[data-segment-id]');
  if (!segment || !currentMeetingDetail) return;
  event.preventDefault();
  openSegmentContextMenu(currentMeetingDetail.id, segment.dataset.segmentId, event.clientX, event.clientY, segmentInfoFor(currentMeetingDetail.id, segment.dataset.segmentId));
});
document.addEventListener('mousedown', (event) => {
  if (!segmentContextMenu.hidden && !segmentContextMenu.contains(event.target)) closeSegmentContextMenu();
});
/** 读取精修菜单中的固定说话人数；空或无效返回 undefined（自动识别）。@returns {number|undefined} */
function refineNumSpeakers() {
  const input = document.querySelector('[data-refine-num-speakers]');
  const parsed = Number(String(input?.value ?? '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
/** 所有 UI 精修入口共用占用状态，包括模型下载后的自动重试。 */
async function requestRefinement(payload) {
  if (refinementBusyMeetingId) throw new Error(t('error.tasks.running'));
  refinementBusyMeetingId = payload.meeting_id;
  try {
    renderMeetingDetail();
    return await window.brevia.meeting.refine(payload);
  } finally {
    refinementBusyMeetingId = null;
    renderMeetingDetail();
    void resumeReadyModelTasks();
  }
}
/** 触发会后精修并同步字幕面板状态。
 * @param {number} [numSpeakers] 固定说话人数。
 * @param {string} [modelId] 只在用户于精修菜单里显式改过模型时传入。
 * @returns {void} */
const startRefinement = (numSpeakers, modelId) => {
  if (!window.brevia?.meeting?.refine || !breviaClient?.state?.selectedMeetingId) return;
  if (refinementBusyMeetingId) { showToast(t('error.tasks.running')); return; }
  const meetingId = breviaClient.state.selectedMeetingId;
  uiData.detail.refineState = 'refining';
  renderMeetingDetail();
  void requestRefinement({
    meeting_id: meetingId,
    language: uiData.detail.language || 'auto',
    ...(numSpeakers ? { num_speakers: numSpeakers } : {}),
    // 没点名时保留后端「模型不可用就回落到该语言默认模型」的既有行为；点了名就要用点名
    // 的那个（后端对显式点名的模型不做静默替换，缺文件时回 model_required 走下载队列）。
    ...(modelId ? { refined_model_id: modelId } : {}),
  }).catch((error) => {
    if (breviaClient.state.selectedMeetingId === meetingId) {
      uiData.detail.refineState = 'idle';
      renderMeetingDetail();
    }
    if (refinementCard.dataset.meetingId === meetingId) hideRefinementProgress();
    showToast(error.message);
  });
};
/** 用户在这次精修里显式选过的模型；没选过返回 undefined，让后端自己选。@returns {string|undefined} */
function pinnedRefineModel() {
  return uiData.detail.refinedModelPinned ? uiData.detail.refinedModelId : undefined;
}
/** 会议是否已有逐句人工修改。@returns {boolean} 有则为真。 */
function meetingHasUserEdits() {
  return Boolean(currentMeetingDetail?.segments?.some((segment) => segment.user_edited || segment.version === 'user'));
}
/** 按菜单里的选择发起精修。
 *
 * 换模型会按新模型重新分段，逐句人工修改依赖段落 id，可能对不上；因此**只在确实存在
 * 人工修改且换了模型**时确认一次，其余情况直接开始。
 * @param {number} [numSpeakers] 固定说话人数。@returns {void} */
function refineWithSelectedModel(numSpeakers) {
  const modelId = pinnedRefineModel();
  if (modelId && modelId !== uiData.detail.refinedModelApplied && meetingHasUserEdits()) {
    openConfirmation(
      t('更换精修模型'),
      t('该会议已有逐句修改。用新模型重新精修会按新模型重新分段，这些修改可能无法保留。'),
      () => startRefinement(numSpeakers, modelId),
    );
    return;
  }
  startRefinement(numSpeakers, modelId);
}
/** 以受限并发映射一批任务，返回与 Promise.allSettled 同形的结果数组。
 *
 * 批量翻译 / 批量删除若一次性打出全部请求，千段会议会把本地模型与后端队列压垮。
 * 用固定并发闸把在途请求数压到 limit 以内，同时保留「逐条成功/失败」的 settle 语义。
 * @template T
 * @param {Iterable<T>} items 待处理项。
 * @param {number} limit 最大并发数。
 * @param {(item: T, index: number) => Promise<any>} worker 单项处理函数。
 * @returns {Promise<Array<{status: 'fulfilled', value: any} | {status: 'rejected', reason: any}>>} */
async function mapWithConcurrency(items, limit, worker) {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;
  const runner = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      try { results[index] = { status: 'fulfilled', value: await worker(list[index], index) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, runner));
  return results;
}
/** 调用内置模型翻译一条已确认字幕。 */
async function generateSegmentTranslation(payload, targetLanguage) {
  if (!targetLanguage) return;
  return window.brevia.translation.generate({
    meeting_id: payload.meeting_id,
    segment_id: payload.segment_id || payload.id,
    segment: {
      text: payload.text,
      start_ms: payload.start_ms,
      end_ms: payload.end_ms,
      speaker: payload.speaker,
      track: payload.track,
      revision: payload.revision || 0,
    },
    target_language: targetLanguage,
    consent: true,
  });
}
/** 将当前最新字幕翻译为指定语言；精修和手工编辑版本优先。 */
async function translateLatestTranscript(targetLanguage) {
  const meeting = currentMeetingDetail;
  const segments = meeting && latestTranscriptSegments(meeting).segments;
  if (!meeting || !segments?.length || !window.brevia?.translation) return;
  uiData.detail.translationTarget = targetLanguage;
  uiData.detail.translationPending = true;
  renderMeetingDetail();
  try {
    let completed = 0;
    showTranslationProgress(completed, segments.length, targetLanguage);
    const results = await mapWithConcurrency(segments, 4, async (segment) => {
      try { return await generateSegmentTranslation(segment, targetLanguage); }
      finally { showTranslationProgress(++completed, segments.length, targetLanguage); }
    });
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) showToast(`${t('翻译失败')}: ${failure.reason.message}`);
    const refreshed = await window.brevia.meeting.get({ meeting_id: meeting.id });
    if (refreshed?.id === currentMeetingDetail?.id) applyBackendDetail(refreshed);
  } catch (error) {
    uiData.detail.translationPending = false;
    renderMeetingDetail();
    showToast(`${t('翻译失败')}: ${error.message}`);
  }
}
/** 保存字幕编辑态下的逐句修正：只提交真正改动的段落，写入后端用户版本。@returns {Promise<void>} */
async function saveDetailTranscriptEdits() {
  const meeting = currentMeetingDetail;
  if (!meeting || !uiData.detail.transcriptEditing) return;
  if (!window.brevia?.segment?.saveText) {
    // 桥接缺失（旧 preload）时不能静默失败：用户会以为改动已保存。
    uiData.detail.transcriptEditing = false;
    renderMeetingDetail();
    showToast(t('保存失败'));
    return;
  }
  const draft = uiData.detail.transcriptDraft || {};
  // 与展示口径保持一致（精修模型退役时展示的是实时版本，见 applyBackendDetail）：
  // 用同一份段落集合取原文，否则草稿 id 全部对不上，修改会被整体静默跳过。
  const original = new Map((latestTranscriptSegments(meeting).segments || []).map((segment) => [segment.id, String(segment.text).trim()]));
  const edits = [];
  for (const [segmentId, value] of Object.entries(draft)) {
    if (!original.has(segmentId)) continue;
    const text = String(value).trim();
    // 字幕需要保留文本：空段落会让播放定位与导出出现空行，因此整段清空时不提交。
    if (!text) { showToast(t('字幕内容不能为空')); return; }
    if (text !== original.get(segmentId)) edits.push({ segment_id: segmentId, text });
  }
  uiData.detail.transcriptEditing = false;
  uiData.detail.transcriptDraft = {};
  detailActiveTab = 'transcript';
  if (!edits.length) { renderMeetingDetail(); return; }
  try {
    const updated = await window.brevia.segment.saveText({ meeting_id: meeting.id, segments: edits });
    if (updated?.id === currentMeetingDetail?.id) applyBackendDetail(updated);
    showToast(t('字幕已保存'));
  } catch (error) {
    // 保存失败时退回编辑态并保留草稿，用户已输入的内容不会丢。
    uiData.detail.transcriptEditing = true;
    uiData.detail.transcriptDraft = draft;
    detailActiveTab = 'transcript';
    renderMeetingDetail();
    showToast(`${t('保存失败')}: ${error.message}`);
  }
}
finalTranscript.addEventListener('input', (event) => {
  const field = event.target.closest('[data-segment-text]');
  if (!field) return;
  uiData.detail.transcriptDraft ||= {};
  uiData.detail.transcriptDraft[field.dataset.segmentText] = field.value;
});
finalTranscript.addEventListener('click', async (event) => {
  // 点击字幕段的时间戳/说话人区域 → 定位播放该段。
  const segmentMeta = event.target.closest('.segment-meta');
  if (segmentMeta && !event.target.closest('[data-segment-speaker-input]')) {
    const start = Number(segmentMeta.closest('.segment')?.dataset.start);
    if (Number.isFinite(start)) {
      followPlaybackTranscript = true;
      playerAudio.currentTime = start;
      progress.value = start;
      renderPlayerTime();
      syncPlaybackTranscript();
      return;
    }
  }
  const editNotes = event.target.closest('[data-edit-notes]');
  if (editNotes) {
    detailNotesBeforeEdit = uiData.detail.notes;
    uiData.detail.notesEditing = true;
    renderMeetingDetail();
    return;
  }
  const notesCancel = event.target.closest('[data-notes-cancel]');
  if (notesCancel) {
    uiData.detail.notes = detailNotesBeforeEdit;
    uiData.detail.notesEditing = false;
    // 取消后必然回到「我的笔记」只读态，编辑按钮始终可见；
    // 防止任何并发刷新把激活 tab 带到别处后编辑入口消失。
    detailActiveTab = 'notes';
    renderMeetingDetail();
    return;
  }
  const notesSave = event.target.closest('[data-notes-save]');
  if (notesSave) {
    const meetingId = currentMeetingDetail?.id;
    const notes = detailNotesEditor ? detailNotesEditor.getMarkdown() : uiData.detail.notes;
    notesSave.disabled = true;
    try {
      await persistNotes(meetingId, notes);
      if (currentMeetingDetail?.id !== meetingId) return;
      if (uiData.detail.notesEditing && detailNotesEditor?.getMarkdown() !== notes) return;
      uiData.detail.notes = notes;
      uiData.detail.notesEditing = false;
      detailActiveTab = 'notes';
      renderMeetingDetail();
    } catch (error) {
      showToast(error.message);
    } finally {
      notesSave.disabled = false;
    }
    return;
  }
  const editTranscript = event.target.closest('[data-edit-transcript]');
  if (editTranscript) {
    uiData.detail.transcriptEditing = true;
    uiData.detail.transcriptDraft = {};
    detailActiveTab = 'transcript';
    renderMeetingDetail();
    document.querySelector('.transcript-body [data-segment-text]')?.focus();
    return;
  }
  const transcriptCancel = event.target.closest('[data-transcript-cancel]');
  if (transcriptCancel) {
    uiData.detail.transcriptEditing = false;
    uiData.detail.transcriptDraft = {};
    // 与笔记编辑一致：结束编辑必然回到被编辑的面板，避免动作作用在看不见的视图上。
    detailActiveTab = 'transcript';
    renderMeetingDetail();
    return;
  }
  const transcriptSave = event.target.closest('[data-transcript-save]');
  if (transcriptSave) {
    void saveDetailTranscriptEdits();
    return;
  }
  const detailTranslationToggle = event.target.closest('[data-detail-translation-toggle]');
  if (detailTranslationToggle) {
    const options = detailTranslationToggle.nextElementSibling;
    const opening = options.hidden;
    if (opening) finalTranscript.querySelectorAll('.refine-menu').forEach((menu) => { menu.hidden = true; });
    options.hidden = !opening;
    detailTranslationToggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const detailTranslation = event.target.closest('[data-detail-translation]');
  if (detailTranslation) {
    detailTranslation.closest('.detail-translation-menu').hidden = true;
    void translateLatestTranscript(detailTranslation.dataset.detailTranslation);
    return;
  }
  const refineLanguageToggle = event.target.closest('.refine-menu [data-flow-select-toggle]');
  if (refineLanguageToggle) {
    const options = refineLanguageToggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    // 精修菜单里有「会议语言」和「识别模型」两个下拉：展开一个要收起另一个。
    if (opening) {
      refineLanguageToggle.closest('.refine-menu')?.querySelectorAll('.flow-select-options').forEach((other) => { if (other !== options) other.hidden = true; });
    }
    options.hidden = !opening;
    refineLanguageToggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const refineLanguageChoice = event.target.closest('[data-flow-select-choice="refine-language"]');
  if (refineLanguageChoice) {
    const select = refineLanguageChoice.closest('.flow-select');
    select.querySelector('input').value = refineLanguageChoice.dataset.value;
    select.querySelector('.flow-select-toggle').firstChild.nodeValue = refineLanguageChoice.textContent;
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
    // 选择写进详情状态：否则后台刷新会用会议语言把用户刚选的精修语言覆盖回去。
    uiData.detail.language = refineLanguageChoice.dataset.value;
    // 语言与识别模型是联动的：换语言后候选会变，仍支持新语言的选择保留，否则回到该语言的
    // 默认模型（与准备页同一套规则），并就地替换模型行，免得用户还要重开菜单。
    const candidates = refinedModelOptions(uiData.detail.language);
    uiData.detail.refinedModelOptions = candidates;
    if (!candidates.some(([id]) => id === uiData.detail.refinedModelId)) {
      uiData.detail.refinedModelId = defaultRefinedModelId(uiData.detail.language);
      uiData.detail.refinedModelPinned = false;
    }
    const modelRow = select.closest('.refine-menu')?.querySelector('[data-refine-model-row]');
    if (modelRow) modelRow.outerHTML = renderRefineModelRow(candidates, uiData.detail.refinedModelId);
    return;
  }
  const refineModelChoice = event.target.closest('[data-flow-select-choice="refine-model"]');
  if (refineModelChoice) {
    const select = refineModelChoice.closest('.flow-select');
    select.querySelector('input').value = refineModelChoice.dataset.value;
    // 用 data-label 而不是 textContent：模型选项还带「推荐」角标，textContent 会把角标
    // 也拼进按钮文案。
    select.querySelector('.flow-select-toggle').firstChild.nodeValue = refineModelChoice.dataset.label;
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
    // 只记录选择；未安装的模型到点「开始/重新精修」时才下载（见 refineWithSelectedModel）。
    uiData.detail.refinedModelId = refineModelChoice.dataset.value;
    uiData.detail.refinedModelPinned = true;
    return;
  }
  const more = event.target.closest('[data-refine-more]');
  if (more) {
    const menu = more.parentElement.querySelector('.refine-menu');
    finalTranscript.querySelectorAll('.refine-menu').forEach((other) => { if (other !== menu) other.hidden = true; });
    const opening = menu.hidden;
    if (opening) {
      finalTranscript.querySelectorAll('.detail-translation-menu').forEach((other) => { other.hidden = true; });
      finalTranscript.querySelectorAll('[data-detail-translation-toggle]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    }
    menu.hidden = !opening;
    more.setAttribute('aria-expanded', String(!menu.hidden));
    // 打开选单时预填当前会议已知的说话人数（自动则留空，提示手动输入）。
    if (opening) {
      const input = menu.querySelector('[data-refine-num-speakers]');
      const numSpeakers = currentMeetingDetail?.num_speakers;
      if (input) input.value = Number.isInteger(numSpeakers) && numSpeakers > 0 ? numSpeakers : '';
    }
    return;
  }
  const refineAction = event.target.closest('[data-refine-action]');
  if (refineAction) {
    const menu = refineAction.closest('.refine-menu');
    if (refineAction.dataset.refineAction === 're-refine') {
      if (menu) menu.hidden = true;
      refineWithSelectedModel(refineNumSpeakers());
      return;
    }
    if (refineAction.dataset.refineAction === 'start') {
      if (menu) menu.hidden = true;
      refineWithSelectedModel(refineNumSpeakers());
      return;
    }
  }
  const tab = event.target.closest('[data-detail-tab]');
  if (!tab) return;
  const target = tab.dataset.detailTab;
  detailActiveTab = target;
  // tabbar 的编辑动作跟随激活 tab（笔记 → 编辑笔记，字幕 → 逐句编辑字幕），
  // 因此切换 tab 时必须重建 tabbar，否则铅笔会停留在上一个 tab 的含义。
  const tabbar = finalTranscript.querySelector('.tabbar');
  if (tabbar) {
    const holder = document.createElement('div');
    holder.innerHTML = renderDetailTabbar();
    tabbar.replaceWith(holder.firstElementChild);
  }
  finalTranscript.querySelectorAll('[data-detail-panel]').forEach((panel) => { panel.hidden = panel.dataset.detailPanel !== target; });
});
document.addEventListener('click', (event) => {
  if (event.target.closest('.refine-wrap, .refine-menu, .detail-translation-action')) return;
  document.querySelectorAll('.refine-menu').forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll('.detail-translation-menu').forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll('[data-refine-more]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('[data-detail-translation-toggle]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
});
/** 同步详情页笔记草稿；只有点击保存才提交，取消编辑不会改变数据库。 */
function updateDetailNotesDraft() {
  if (!detailNotesEditor) return;
  uiData.detail.notes = detailNotesEditor.getMarkdown(); // 即时同步，避免重建面板时丢失未保存内容
}
finalTranscript.addEventListener('dblclick', (event) => {
  const speaker = event.target.closest('[data-segment-speaker]');
  if (speaker) {
    event.preventDefault();
    editingSegmentSpeakerId = speaker.dataset.segmentSpeaker;
    renderMeetingDetail();
    requestAnimationFrame(() => document.querySelector('[data-segment-speaker-input]')?.select());
    return;
  }
});
finalTranscript.addEventListener('submit', (event) => {
  if (!event.target.matches('.inline-segment-speaker-form')) return;
  event.preventDefault();
  void saveInlineSegmentSpeaker(event.target);
});
finalTranscript.addEventListener('focusout', (event) => {
  const form = event.target.closest('.inline-segment-speaker-form');
  if (form) void saveInlineSegmentSpeaker(form);
});

function applyInitializationResult(result) {
  modelCatalog = result.models;
  uiData.meetings = result.meetings.map(backendMeeting);
  if (typeof initializeWorkspaces === 'function') {
    initializeWorkspaces(result.workspaces || []);
    renderWorkspaceNav();
    updateHomeViewTitle();
  }
  speakerProfiles = result.speaker_profiles || [];
  modelPaths.clear();
  result.models.filter((model) => model.status === 'ready' && model.path).forEach((model) => modelPaths.set(model.id, model.path));
  deviceReport = result.device || null;
  renderSpeakerProfileCard();
  renderMeetingList();
  renderPrepareSelects();
  void window.brevia.maintain();
}

if (window.brevia) {
  const dismissStartupSplash = () => {
    const splash = document.querySelector('#startup-splash');
    if (!splash) return;
    splash.classList.add('startup-splash-leave');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  };
  // 启动动画 brevia-logo-reveal.gif（约 1.4s）在 Windows 上因页面加载/解码更慢，
  // 会在 startup.ready 到达时还没播完。这里以 GIF 实际开始播放的时间为基准，
  // 等它播满时长后再揭示应用，避免 Windows 上动画被截断（macOS 不受影响）。
  const splashGif = document.querySelector('#startup-splash img');
  const splashGifDurationMs = 1500; // GIF 时长 1400ms + 少量余量
  let splashGifStartedAt = null;
  if (splashGif) {
    const markGifStarted = () => { if (splashGifStartedAt === null) splashGifStartedAt = performance.now(); };
    if (splashGif.complete && splashGif.naturalWidth > 0) markGifStarted();
    else splashGif.addEventListener('load', markGifStarted, { once: true });
  }
  const revealAfterSplash = () => {
    dismissStartupSplash();
    void checkForUpdates({ silent: true });
  };
  window.brevia.on('startup.ready', () => {
    const reveal = () => {
      const startedAt = splashGifStartedAt ?? performance.now();
      const wait = Math.max(0, splashGifDurationMs - (performance.now() - startedAt));
      setTimeout(revealAfterSplash, wait);
    };
    if (splashGif && splashGifStartedAt === null) {
      splashGif.addEventListener('load', reveal, { once: true });
    } else {
      reveal();
    }
  });
  if (window.BreviaOnboarding.isFirstLaunch()) openOnboardingLanguage();
  void loadSummaryConfig().catch((error) => showToast(`${t('纪要配置加载失败')}: ${error.message}`));
  void loadAiAssistConfig().catch((error) => showToast(`${t('AI 笔记配置加载失败')}: ${error.message}`));
  initializationPromise = breviaClient.initialize().then(applyInitializationResult);
  void initializationPromise.catch((error) => showToast(`${t('配置或后端启动失败')}: ${userFacingError(error.message)}`));

  const transcript = document.querySelector('#transcript-scroll');
  const backToLatest = document.querySelector('#back-to-latest');
  const isAtLiveBottom = () => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 32;
  const scrollLiveToLatest = (segment) => {
    if (!segment) return;
    transcript.scrollTop = transcript.scrollHeight;
    followLiveTranscript = true;
    if (backToLatest) backToLatest.hidden = true;
  };
  transcript.addEventListener('scroll', () => {
    followLiveTranscript = isAtLiveBottom();
    if (backToLatest) backToLatest.hidden = followLiveTranscript;
  }, { passive: true });
  if (backToLatest) {
    backToLatest.addEventListener('click', () => {
      followLiveTranscript = true;
      transcript.scrollTop = transcript.scrollHeight;
      backToLatest.hidden = true;
    });
  }
  transcript.addEventListener('contextmenu', (event) => {
    const segment = event.target.closest('[data-segment-id]');
    const meetingId = breviaClient.state.meeting?.id;
    if (!segment || !meetingId) return;
    event.preventDefault();
    openSegmentContextMenu(meetingId, segment.dataset.segmentId, event.clientX, event.clientY, segmentInfoFor(meetingId, segment.dataset.segmentId));
  });
  const renderLiveEvent = (payload) => {
    // 防止重复事件覆盖已经展示的字幕。
    const revision = Number(payload.revision) || 0;
    const seenRevision = liveSegmentData.get(payload.segment_id)?.revision;
    if (seenRevision !== undefined && revision <= seenRevision) return;
    const shouldFollow = followLiveTranscript || isAtLiveBottom();
    const previous = liveSegments.get(payload.segment_id);
    const translation = payload.translation || previous?.querySelector('.translation')?.textContent;
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      startSeconds: payload.start_ms / 1000,
      endSeconds: payload.end_ms / 1000,
      speaker: { id: payload.speaker, segmentId: payload.segment_id, name: formatSpeakerName(payload.speaker_name || payload.speaker) || t('说话人') },
      text: payload.text,
      translation,
      showSpeaker: false,
    };
    latestLiveSegmentId = payload.segment_id;
    // 整句直接进入已确认区域，不再等待二次精修。
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({
        segmentId: payload.segment_id,
        text: payload.text,
        isRefined: true,
        updateFinalized: true,
        clearCurrentIfMatch: true,
        locale: floatingCaptionLocale,
      });
    }
    const template = document.createElement('template');
    template.innerHTML = renderTranscriptSegment(entry);
    const element = template.content.firstElementChild;
    if (previous) previous.replaceWith(element);
    else {
      const next = [...transcript.querySelectorAll('.segment')].find((item) => Number(item.dataset.start) > payload.start_ms / 1000);
      transcript.insertBefore(element, next || null);
    }
    liveSegments.set(payload.segment_id, element);
    liveSegmentData.set(payload.segment_id, { revision, text: payload.text, start_ms: payload.start_ms, speaker: payload.speaker_name || payload.speaker });
    while (liveSegments.size > maxLiveSegments) {
      const [segmentId, stale] = liveSegments.entries().next().value;
      liveSegments.delete(segmentId);
      liveSegmentData.delete(segmentId);
      stale.remove();
    }
    transcript.querySelectorAll('.segment.is-active').forEach((segment) => {
      segment.classList.remove('is-active');
      segment.removeAttribute('aria-current');
    });
    element.classList.add('is-active');
    element.setAttribute('aria-current', 'true');
    if (shouldFollow) scrollLiveToLatest(element);
  };
  for (const type of ['meeting.started', 'meeting.recovered', 'meeting.imported', 'meeting.stopped']) {
    window.brevia.on(type, ({ meeting }) => syncBackendMeeting(meeting));
  }
  window.brevia.on('meeting.reconfigured', ({ meeting }) => {
    syncBackendMeeting(meeting);
    if (!meeting || meeting.id !== breviaClient?.state.meeting?.id) return;
    const targetChanged = meeting.target_language !== liveConfig.target_language;
    breviaClient.state.meeting = { ...breviaClient.state.meeting, ...meeting };
    liveConfig = { language: meeting.language || 'auto', target_language: meeting.target_language || null, refined_model_id: meeting.refined_model_id || null };
    if (targetChanged) document.querySelectorAll('.translation').forEach((line) => { line.remove(); });
    setLiveTranslationEnabled(Boolean(liveConfig.target_language));
    renderLiveModelControl();
  });
  window.brevia.on('meeting.stopped', async ({ meeting }) => {
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.close();
      floatingCaptionMode = null;
      renderFloatingCaptionToggle();
    }
    if (!meetingActive) return;
    clearInterval(timer);
    if (meeting?.id) stopAiNoteForMeeting(meeting.id);
    resetAiNoteSuggestions();
    if (breviaClient?.capture) await breviaClient.capture.stop();
    if (breviaClient) {
      breviaClient.capture = null;
      breviaClient.state.meeting = null;
      breviaClient.state.inputs = null;
      if (meeting) {
        breviaClient.state.selectedMeetingId = meeting.id;
        applyBackendDetail(meeting);
      }
    }
    meetingActive = false;
    miniMeeting.hidden = true;
    showView('detail');
    void refreshBackendMeetings();
  });
  window.brevia.on('meeting.interrupted', async ({ meeting_id: meetingId }) => {
    if (!meetingActive || meetingId !== breviaClient?.state.meeting?.id) return;
    meetingActive = false;
    clearInterval(timer);
    resetAiNoteSuggestions();
    miniMeeting.hidden = true;
    if (breviaClient?.capture) await breviaClient.capture.stop();
    if (breviaClient) {
      breviaClient.capture = null;
      breviaClient.state.meeting = null;
      breviaClient.state.inputs = null;
    }
    showView('home');
    void refreshBackendMeetings();
  });
  window.brevia.on('app.maintenance', ({ meetings, speaker_profiles: profiles, storage, recoverable }) => {
    uiData.meetings = meetings.map(backendMeeting);
    speakerProfiles = profiles;
    const storageSizes = [storage.meetings, storage.models].map(formatBytes);
    Object.values(modalCopy).forEach((copy) => copy.storage.items.forEach((item, index) => { item[1] = storageSizes[index]; }));
    renderSpeakerProfileCard();
    renderMeetingList();
    if (activeModal === 'storage') renderModal('storage');
    if (recoverable.length) showToast(t('发现可恢复录音').replace('{count}', recoverable.length));
  });
  window.brevia.on('transcript.final', (payload) => {
    renderLiveEvent(payload);
    // 正式段落一旦覆盖到临时行预览的起点，那条临时行就已过期：这里主动让它退场，
    // 不依赖随后到达的「空 draft」事件。暂停/停止排空时 final 与空 draft 几乎同时到，
    // 顺序稍有偏差就会让临时行残留在列表里（看起来像「临时字幕没变成正式段落」）。
    for (const [key, draft] of draftSegments) {
      // 只让同一条音轨的正式段落撤下临时行：双轨会议里 mic 的 final 不该清掉 system
      // 仍在攒的临时行，否则它会消失又在下一个 draft 事件里重新冒出来（闪烁 + 高亮错位）。
      if (String(draft.dataset.draftTrack || 'mix') !== String(payload.track || 'mix')) continue;
      if (Number(draft.dataset.start) <= payload.start_ms / 1000) {
        draft.remove();
        draftSegments.delete(key);
      }
    }
  });
  // 正在攒的段落：文本来自已完成的整句识别，只是还没攒够提交条件（可能再等几秒）。
  // 显示成一条会被就地替换的临时行，并接手「当前」高亮；正式段落到达后退场，高亮交还。
  window.brevia.on('transcript.draft', (payload) => {
    const key = payload.track || 'mix';
    const existing = draftSegments.get(key);
    if (!payload.text) {
      if (!existing) return;
      existing.remove();
      draftSegments.delete(key);
      const last = [...transcript.querySelectorAll('.segment:not(.is-draft)')].pop();
      if (last) {
        last.classList.add('is-active');
        last.setAttribute('aria-current', 'true');
      }
      return;
    }
    const shouldFollow = followLiveTranscript || isAtLiveBottom();
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      startSeconds: payload.start_ms / 1000,
      endSeconds: payload.end_ms / 1000,
      speaker: { id: payload.speaker, name: '' },
      text: payload.text,
      showSpeaker: false,
    };
    const template = document.createElement('template');
    template.innerHTML = renderTranscriptSegment(entry);
    const element = template.content.firstElementChild;
    element.classList.add('is-draft');
    element.dataset.draftTrack = key;
    // draft 预览的始终是最新（未提交）的段落，因此永远排在已确认段落之后。replaceWith
    // 会继承旧行的 DOM 位置，而旧行对应的时间更早——必须重新 appendChild 把它钉到末尾，
    // 否则临时行会停在列表上方，和「确认后的字幕从下刷新」的方向相反。
    existing?.replaceWith(element);
    transcript.appendChild(element);
    draftSegments.set(key, element);
    transcript.querySelectorAll('.segment.is-active').forEach((segment) => {
      segment.classList.remove('is-active');
      segment.removeAttribute('aria-current');
    });
    element.classList.add('is-active');
    element.setAttribute('aria-current', 'true');
    if (shouldFollow) scrollLiveToLatest(element);
  });
  window.brevia.on('transcript.settled', async (payload) => {
    if (!translationAllowed) return;
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({ segmentId: payload.segment_id, translationPending: true });
    }
    try {
      await generateSegmentTranslation(payload, liveConfig.target_language);
    } catch (error) { showToast(`${t('翻译失败')}: ${error.message}`); }
  });
  window.brevia.on('translation.ready', (payload) => {
    const element = liveSegments.get(payload.segment_id);
    if (!element) return;
    const shouldFollow = followLiveTranscript || isAtLiveBottom();
    let line = element.querySelector('.translation');
    if (!line) { line = document.createElement('p'); line.className = 'translation'; element.querySelector('.segment-copy').append(line); }
    line.textContent = payload.translation;
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({ segmentId: payload.segment_id, translation: translationAllowed ? payload.translation : null });
    }
    if (shouldFollow) scrollLiveToLatest(element);
  });
  window.brevia.on('refinement.started', ({ meeting_id, total, stage }) => {
    showRefinementProgress(0, total, refinementTitle(meeting_id), meeting_id, stage);
    if (meeting_id === breviaClient.state.selectedMeetingId) {
      uiData.detail.refineState = 'refining';
      renderMeetingDetail();
    }
  });
  window.brevia.on('refinement.progress', ({ meeting_id, completed, total, stage }) => {
    if (meeting_id !== refinementCard.dataset.meetingId) return;
    showRefinementProgress(completed, total, refinementMeetingTitle, undefined, stage);
  });
  window.brevia.on('refinement.cancelled', async ({ meeting_id, meeting }) => {
    if (meeting_id === refinementCard.dataset.meetingId) hideRefinementProgress();
    if (meeting?.id === breviaClient.state.selectedMeetingId) {
      uiData.detail.refineState = 'idle';
      applyBackendDetail(meeting);
    }
    void refreshBackendMeetings();
  });
  window.brevia.on('refinement.ready', async ({ meeting_id }) => {
    const meeting = await window.brevia.meeting.get({ meeting_id });
    syncBackendMeeting(meeting);
    if (meeting_id === refinementCard.dataset.meetingId) showRefinementComplete();
    if (meeting.id === breviaClient.state.selectedMeetingId) {
      uiData.detail.refineState = 'idle';
      applyBackendDetail(meeting);
    }
    if (!meeting.target_language) return;
    const refined = meeting.segments.filter((segment) => segment.version.startsWith('postprocess'));
    const revision = Math.max(...refined.map((segment) => segment.revision), -1);
    const results = await mapWithConcurrency(refined.filter((item) => item.revision === revision), 4, (segment) => generateSegmentTranslation(segment, meeting.target_language));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) showToast(`${t('翻译失败')}: ${failure.reason.message}`);
    if (meeting.id === breviaClient.state.selectedMeetingId) applyBackendDetail(await window.brevia.meeting.get({ meeting_id: meeting.id }));
  });
  window.brevia.on('summary.started', ({ meeting_id, completed, total, stage }) => showSummaryProgress(completed, total, stage, meeting_id));
  window.brevia.on('summary.progress', ({ completed, total, stage }) => showSummaryProgress(completed, total, stage));
  window.brevia.on('summary.ready', () => showSummaryComplete());
  window.brevia.on('model.progress', ({ model_id, received, total }) => {
    if (!modelDownloads.has(model_id)) return;
    modelDownloads.set(model_id, { ...modelDownloads.get(model_id), received, total, paused: false });
    scheduleModelLibraryRender();
    refreshModelConfigModels();
    scheduleRequiredModelsCardRender();
  });
  window.brevia.on('model.status', ({ model_id, status, error }) => {
    if (status === 'ready') {
      modelDownloads.delete(model_id);
      requiredModelIds.delete(model_id);
      if (onboardingModelIds.includes(model_id) && window.BreviaOnboarding.modelReady(model_id)) showOfflineTranscriptionReady();
      window.brevia.models.list().then((models) => {
        modelCatalog = models;
        const model = models.find((item) => item.id === model_id);
        if (model?.path) modelPaths.set(model_id, model.path);
        // 从功能设置跳来装模型的：装完直接跳回去，配置草稿还在。
        // 只认「跳过来时确实缺失」的那个模型，跳一次即作废（见 modelsReturnToPending）。
        if (modelsReturnTo && modelsReturnToPending?.has(model_id)) {
          activeModal = modelsReturnTo;
          modelsReturnTo = null;
          modelsReturnToPending = null;
        }
        if (activeModal === 'models') renderModal('models');
        refreshModelConfigModels();
        renderRequiredModelsCard();
        renderPrepareSelects();
        void resumeReadyModelTasks();
      }).catch(() => {});
    } else if (status === 'paused' && modelDownloads.has(model_id)) modelDownloads.set(model_id, { ...modelDownloads.get(model_id), paused: true });
    else if (status === 'downloading' && modelDownloads.has(model_id)) modelDownloads.set(model_id, { ...modelDownloads.get(model_id), paused: false });
    else if (status === 'cancelled' && modelDownloads.has(model_id)) {
      if (requiredModelIds.has(model_id)) modelDownloads.set(model_id, { cancelled: true });
      else modelDownloads.delete(model_id);
    }
    else if (status === 'failed' && modelDownloads.has(model_id)) modelDownloads.set(model_id, { error });
    else if (status === 'not_installed') modelPaths.delete(model_id);
    if (activeModal === 'models') renderModal('models');
    refreshModelConfigModels();
    renderRequiredModelsCard();
  });
  window.brevia.on('worker.warning', ({ code, message: warning, meeting_id: warningMeetingId }) => {
    // 实时识别不可用是「整场没有字幕」，不是可忽略的瞬时警告：改成常驻卡片。
    if (code === 'asr_unavailable') {
      showLiveCaptionUnavailable(warningMeetingId, warning);
      return;
    }
    showToast(warning);
  });
  window.brevia.on('worker.error', ({ code, message: error }) => showToast(code ? `${t(code)} (${error})` : userFacingError(error)));
  window.brevia.on('update.download-progress', (progress) => {
    updateDownloadProgress = progress;
    renderUpdateButton();
    renderUpdateNotice();
  });
  window.brevia.on('task.status', ({ task, meeting_id, status }) => {
    const card = [...taskCards.querySelectorAll('.processing-card')].find((item) => item.dataset.task === task && item.dataset.meetingId === meeting_id);
    setTaskCardPaused(card, status === 'paused');
  });
  window.brevia.on('model.required', ({ models, task, payload }) => {
    if (task === 'meeting.refine' && payload?.meeting_id === breviaClient.state.selectedMeetingId) {
      // 精修被模型缺失阻塞：复位精修状态，避免详情页停留在“正在精修”；
      // 模型下载完成后 resumeReadyModelTasks 会自动重试精修。
      uiData.detail.refineState = 'idle';
      renderMeetingDetail();
    }
    const queued = pendingModelTasks.get(`${task}:${payload?.meeting_id || 'new'}`);
    queueModelTask(task, task === 'meeting.start' && queued?.payload.inputs ? { ...payload, inputs: queued.payload.inputs } : payload, models);
    downloadRequiredModels(models);
  });
  window.brevia.on('speaker-profile.updated', async () => { speakerProfiles = await window.brevia.speakerProfile.list(); renderSpeakerProfileCard(); });
  window.brevia.on('speaker-profile.deleted', async () => { speakerProfiles = await window.brevia.speakerProfile.list(); renderSpeakerProfileCard(); });

  // Listen for floating caption window closed event to sync state
  window.brevia.on('floating-caption.closed', () => {
    floatingCaptionMode = null;
    document.querySelectorAll('#floating-caption-toggle, #playback-floating-caption-toggle').forEach((toggle) => { toggle.dataset.enabled = 'false'; });
    renderFloatingCaptionToggle();
  });

  document.querySelector('#recently-deleted').addEventListener('click', async () => {
    await showLibraryNav('recently-deleted').catch((error) => showToast(error.message));
  });
  document.querySelector('#all-meetings').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (activeView === 'home' && activeLibraryNav === 'all-meetings') {
      const workspaceNav = document.querySelector('.workspace-subnav');
      if (workspaceNav) {
        const collapsed = workspaceNav.classList.toggle('is-collapsed');
        workspaceNav.setAttribute('aria-hidden', String(collapsed));
        button.setAttribute('aria-expanded', String(!collapsed));
      }
      return;
    }
    await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
    const workspaceNav = document.querySelector('.workspace-subnav');
    if (workspaceNav) {
      workspaceNav.classList.remove('is-collapsed');
      workspaceNav.setAttribute('aria-hidden', 'false');
      button.setAttribute('aria-expanded', 'true');
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-copy-summary]')) {
      const markdown = currentMeetingDetail?.summary?.data?.markdown;
      if (markdown) void window.brevia?.share.copyText({ text: markdown }).then(() => showToast(t('已复制到剪贴板'))).catch((error) => showToast(error.message));
      return;
    }
    if (event.target.closest('[data-open-summary-edit]')) { uiData.detail.summaryEditing = true; renderMeetingDetail(); return; }
    if (event.target.closest('[data-cancel-inline-summary-edit]')) { uiData.detail.summaryDraft = undefined; uiData.detail.summaryEditing = false; renderMeetingDetail(); return; }
    if (event.target.closest('[data-save-inline-summary]')) {
      const markdown = (inlineSummaryEditor?.getMarkdown() || '').trim();
      const meetingId = currentMeetingDetail?.id;
      if (!meetingId || !window.brevia?.summary?.save) return;
      if (!markdown) { showToast(t('纪要不能为空')); return; }
      void window.brevia.summary.save({ meeting_id: meetingId, markdown }).then(() => {
        if (currentMeetingDetail?.id !== meetingId) return;
        currentMeetingDetail.summary = { data: { markdown } };
        uiData.detail.summary = { markdown, hasFull: true, blocked: meetingActive, generating: false };
        if (!uiData.detail.summaryEditing || (inlineSummaryEditor?.getMarkdown() || '').trim() === markdown) {
          uiData.detail.summaryDraft = undefined;
          uiData.detail.summaryEditing = false;
        }
        renderMeetingDetail();
        showToast(t('已保存'));
      }).catch((error) => showToast(error.message));
      return;
    }
    if (event.target.closest('[data-generate-summary]')) void generateMeetingSummary();
    if (event.target.closest('[data-regenerate-summary]')) void generateMeetingSummary();
  });

  document.querySelector('[data-export-detail]').addEventListener('click', async () => {
    if (!breviaClient.state.selectedMeetingId) return;
    openModal('export');
  });
}

/* 视图模块通过 appActions 回调应用层，实现必须在这里登记。
   放在文件末尾：上面的 function 声明已提升，而 const 箭头函数（showToast / showView /
   updatePlayerControl / renderPlayerTime）到这里都已初始化。 */
registerAppActions('app.js', {
  updateDetailNotesDraft,
  showToast,
  filterMeetings,
  renderMeetingList,
  openConfirmation,
  selectLibraryNav,
  transitionPage,
  minimizeMeeting,
  showView,
  updatePlayerControl,
  renderPlayerTime,
});
