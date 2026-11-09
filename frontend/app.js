// 缓存语言在应用入口校验；共用的翻译运行时不能提前读取官网演示的 locale。
if (!Object.hasOwn(catalog, locale)) locale = 'zh';

const views = [...document.querySelectorAll('.view')];
const crumb = document.querySelector('#crumb');
const toast = document.querySelector('#toast');
const themeToggle = document.querySelector('#theme-toggle');
const librarySearchShortcut = document.querySelector('#library-search-shortcut');
librarySearchShortcut.querySelector('kbd').textContent =
  window.brevia?.platform === 'darwin' ? '⌘ K' : 'Ctrl K';
/** 显式搜索命令才移动焦点，切换页面仍沿用原有草稿保存与录音后台逻辑。 */
async function focusLibrarySearch() {
  if (
    activeModal ||
    onboardingPage ||
    desktopShortcutCapture ||
    document.querySelector('.workspace-dialog')
  )
    return;
  if (activeView === 'settings') await showView('home');
  setLibraryVisible(true);
  meetingSearch.focus({ preventScroll: true });
}
function setLibraryVisible(visible) {
  if (!visible) closeSearchPopup();
  document.querySelector('.app-shell').classList.toggle('is-library-hidden', !visible);
  document.querySelector('#library-toggle').setAttribute('aria-expanded', String(visible));
}
document.querySelector('#library-toggle').addEventListener('click', () => {
  setLibraryVisible(document.querySelector('.app-shell').classList.contains('is-library-hidden'));
});
function syncCurrentMeetingNavigation() {
  meetingList.querySelectorAll('[data-meeting-id]').forEach((row) => {
    const current = activeView === 'detail' && row.dataset.meetingId === currentMeetingDetail?.id;
    row.classList.toggle('is-current', current);
    if (current) row.setAttribute('aria-current', 'page');
    else row.removeAttribute('aria-current');
  });
}
librarySearchShortcut.addEventListener('click', () => void focusLibrarySearch());
document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
  if (event.shiftKey || event.altKey || event.repeat || event.isComposing) return;
  // 富文本编辑器的链接快捷键和快捷键录入仍由原控制器处理。
  if (event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
  if (
    activeModal ||
    onboardingPage ||
    desktopShortcutCapture ||
    document.querySelector('.workspace-dialog')
  )
    return;
  event.preventDefault();
  void focusLibrarySearch();
});
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
const stackableTaskCardSelector =
  ':is(.processing-card, .mini-meeting, .mini-playback):not([hidden])';
function syncTaskCardStack(active) {
  const cards = [...taskCards.children].filter((card) => card.matches(stackableTaskCardSelector));
  const toggle = document.querySelector('[data-toggle-task-stack]');
  toggle.hidden = !cards.length;
  toggle.setAttribute('aria-expanded', String(!taskCards.classList.contains('is-collapsed')));
  toggle.querySelector('[data-task-count]').textContent = `${t('任务')} · ${cards.length}`;
  active ||= cards.find((card) => !card.classList.contains('is-task-card-back')) || cards[0];
  renderTaskSummary(cards, active);
  const completed = Number(active?.dataset.completed);
  const total = Number(active?.dataset.total);
  document
    .querySelector('.app-shell')
    ?.style.setProperty(
      '--task-progress',
      total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0,
    );
  cards.forEach((card, index) => {
    const percent = card.querySelector('.task-mini-percent');
    if (percent) {
      const value = `${Math.round((Number(card.dataset.completed || 0) / Math.max(1, Number(card.dataset.total || 100))) * 100)}%`;
      if (percent.textContent !== value) percent.textContent = value;
    }
    const pause = card.querySelector('[data-pause-task]');
    if (card === miniPlayback && !card.querySelector('.task-card-actions')) {
      const controls = document.createElement('span');
      controls.className = 'task-card-actions';
      miniPlaybackClose.innerHTML = interfaceIcon('close');
      controls.append(miniPlaybackToggle, miniPlaybackClose);
      card.querySelector('.task-card-heading').append(controls);
    }
    const actions = card.querySelector('.task-card-actions');
    if (pause && actions && pause.parentElement !== actions) actions.prepend(pause);
    const isBack = card !== active;
    card.classList.add('task-card-stack-item');
    card.style.zIndex = index + 1;
    card.classList.toggle('is-task-card-back', isBack);
    const bar = card.querySelector('.processing-bar');
    if (bar && bar.getAttribute('role') !== 'slider') {
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute(
        'aria-label',
        card.querySelector('.task-card-heading p')?.textContent || t('任务'),
      );
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute(
        'aria-valuenow',
        String(
          Math.round(
            Math.min(
              1,
              Math.max(
                0,
                Number(card.dataset.completed || 0) /
                  Math.max(1, Number(card.dataset.total || 100)),
              ),
            ) * 100,
          ),
        ),
      );
      bar.removeAttribute('aria-hidden');
    }
    if (isBack) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute(
        'aria-label',
        card
          .querySelector('.task-card-heading p, :scope > span, :scope > strong')
          ?.textContent.trim() || 'Task',
      );
    } else {
      card.removeAttribute('tabindex');
      card.removeAttribute('role');
      card.removeAttribute('aria-label');
    }
  });
}
function toggleTaskStack() {
  const collapsed = taskCards.classList.toggle('is-collapsed');
  syncTaskCardStack();
  if (!collapsed)
    taskCards
      .querySelector('.task-card-stack-item:not(.is-task-card-back)')
      ?.scrollIntoView({ block: 'nearest' });
}
document.querySelector('[data-toggle-task-stack]').addEventListener('click', toggleTaskStack);
function activateTaskCard(card) {
  if (
    !card?.matches(':is(.processing-card, .mini-meeting, .mini-playback):not([hidden])') ||
    card.classList.contains('task-card-leave')
  )
    return;
  taskCards.append(card);
  syncTaskCardStack(card);
  taskCards.scrollTop = taskCards.scrollHeight;
}
new MutationObserver(() => syncTaskCardStack()).observe(taskCards, {
  childList: true,
  attributes: true,
  attributeFilter: ['hidden', 'data-completed', 'data-total', 'data-paused', 'data-failed'],
  characterData: true,
  subtree: true,
});
/** 底部摘要始终反映真实任务与展开状态，详细操作仍由原有任务节点拥有。 */
function renderTaskSummary(cards, active) {
  const summary = document.querySelector('[data-task-summary]');
  if (!summary) return;
  summary.hidden = !cards.length;
  summary.setAttribute('aria-expanded', String(!taskCards.classList.contains('is-collapsed')));
  const heading = active?.querySelector('.task-card-heading p')?.textContent || t('任务');
  const failed = cards.filter(
    (card) => card.dataset.failed === 'true' || card.querySelector('.download-error-detail'),
  ).length;
  let status = t('处理中');
  if (active?.dataset.failed === 'true' || active?.querySelector('.download-error-detail'))
    status = t('任务失败');
  else if (active?.dataset.paused === 'true') status = t('已暂停');
  else if (active === miniMeeting) status = miniTimer.textContent;
  else if (active === miniPlayback)
    status = document.querySelector('#player-time')?.textContent || '00:00';
  else if (Number(active?.dataset.total) > 0)
    status =
      Math.round(
        Math.min(
          1,
          Math.max(0, Number(active.dataset.completed || 0) / Number(active.dataset.total)),
        ) * 100,
      ) + '%';
  summary.querySelector('[data-task-summary-label]').textContent = t('任务');
  const count = summary.querySelector('[data-task-summary-count]');
  const value = summary.querySelector('[data-task-summary-status]');
  count.textContent = cards.length;
  value.textContent = active === miniMeeting ? status.replace(/^00:/, '') : status;
  summary.classList.toggle('is-recording', active === miniMeeting);
  summary.classList.toggle('has-errors', failed > 0);
  const label = `${t('任务')} ${cards.length} · ${heading} · ${status}${failed ? ` · ${t('任务失败')} ${failed}` : ''}`;
  summary.title = label;
  summary.setAttribute('aria-label', label);
}
document.querySelector('[data-task-summary]').addEventListener('click', toggleTaskStack);
document.addEventListener('pointerdown', (event) => {
  if (
    !document.querySelector('[data-task-summary]').hidden &&
    !taskCards.classList.contains('is-collapsed') &&
    !event.target.closest('#task-cards, [data-task-summary], [data-toggle-task-stack]')
  )
    toggleTaskStack();
});
document.addEventListener('keydown', (event) => {
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    document.querySelector('[data-task-summary]').hidden ||
    taskCards.classList.contains('is-collapsed') ||
    (activeModal && !settingsModal.classList.contains('settings-page')) ||
    (onboardingPage && onboardingPage.dataset.aiSettings !== 'true') ||
    document.querySelector('dialog[open], .workspace-dialog')
  )
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleTaskStack();
  document.querySelector('[data-task-summary]').focus({ preventScroll: true });
});
function taskCardControls() {
  return `<span class="task-card-actions"><button class="task-card-close" data-minimize-task-card type="button" aria-label="${t('最小化')}">${interfaceIcon('minimize')}</button><button class="task-card-close" data-dismiss-task-card type="button" aria-label="${t('关闭')}">${interfaceIcon('close')}</button></span>`;
}
function taskPauseControl() {
  return `<button class="task-card-close task-card-pause" data-pause-task type="button" aria-label="${t('暂停')}" title="${t('暂停')}" disabled>${interfaceIcon('pause')}<span>${escapeHtml(t('暂停'))}</span></button>`;
}
function setTaskCardTask(card, task, meetingId) {
  card.dataset.task = task;
  card.dataset.meetingId = meetingId;
  card.dataset.paused = 'false';
  const button = card.querySelector('[data-pause-task]');
  button.disabled = false;
  button.innerHTML = interfaceIcon('pause') + '<span>' + escapeHtml(t('暂停')) + '</span>';
  button.setAttribute('aria-label', t('暂停'));
  button.title = t('暂停');
}
function setTaskCardPaused(card, paused) {
  if (!card) return;
  card.dataset.paused = String(paused);
  const button = card.querySelector('[data-pause-task]');
  button.innerHTML =
    interfaceIcon(paused ? 'play' : 'pause') +
    '<span>' +
    escapeHtml(t(paused ? '继续' : '暂停')) +
    '</span>';
  button.setAttribute('aria-label', paused ? t('继续') : t('暂停'));
  button.title = t(paused ? '继续' : '暂停');
  card.querySelector('.task-paused-status')?.remove();
  if (paused) {
    const status = document.createElement('span');
    status.className = 'task-paused-status';
    status.setAttribute('role', 'status');
    status.textContent = t('已暂停');
    card.querySelector('.task-card-progress').before(status);
  }
}
function finishTaskCard(card) {
  delete card.dataset.task;
  delete card.dataset.meetingId;
  delete card.dataset.paused;
  card.querySelector('.task-paused-status')?.remove();
  const button = card.querySelector('[data-pause-task]');
  button.disabled = true;
}
function toggleTaskCardMinimized(card, button) {
  card.classList.add('task-card-resizing');
  card.classList.toggle('is-minimized');
  const minimized = card.classList.contains('is-minimized');
  let percent = card.querySelector('.task-mini-percent');
  if (!percent) {
    percent = document.createElement('span');
    percent.className = 'task-mini-percent';
    card
      .querySelector('.task-card-heading')
      .insertBefore(percent, card.querySelector('.task-card-actions'));
  }
  percent.textContent = `${Math.round((Number(card.dataset.completed || 0) / Math.max(1, Number(card.dataset.total || 100))) * 100)}%`;
  button.innerHTML = interfaceIcon(minimized ? 'plus' : 'minimize');
  button.setAttribute('aria-label', t(minimized ? '还原' : '最小化'));
  window.setTimeout(() => card.classList.remove('task-card-resizing'), 180);
}
function enterTaskCard(card) {
  card.classList.remove('task-card-leave');
  activateTaskCard(card);
  card.classList.add('task-card-enter');
  window.setTimeout(() => card.classList.remove('task-card-enter'), BreviaMotion.duration('task'));
}
function dismissTaskCard(card, done = () => card.remove()) {
  if (!card || card.classList.contains('task-card-leave')) return;
  card.classList.remove('task-card-enter');
  card.classList.add('task-card-leave');
  window.setTimeout(() => {
    if (card.classList.contains('task-card-leave')) done();
  }, BreviaMotion.duration('taskExit'));
}
function revealTaskCard(card) {
  const wasHidden = card.hidden;
  const wasLeaving = card.classList.contains('task-card-leave');
  card.hidden = false;
  if (wasHidden || wasLeaving) {
    taskCards.append(card);
    enterTaskCard(card);
  }
}
const {
  onboardingStorageCopy,
  aiNotePromptCopy,
  storageCleanupCopy,
  exportHubCopy,
  appCopy: {
    themeLabels,
    updateLabels,
    modalCopy,
    modelLabels,
    summaryModelCopy,
    speakerProfileCopy,
    voiceFeaturesCopy,
    aiAssistCopy,
    whatsNewCopy,
  },
} = window.BreviaLocaleData;
const whatsNewLog = window.BreviaChangelog;
if (new URLSearchParams(location.search).has('resetOnboarding'))
  localStorage.removeItem('brevia-onboarding-complete');
let theme =
  localStorage.getItem('brevia-theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const appOpenedAt = Date.now();
window.addEventListener('pagehide', () => {
  void window.brevia?.metrics.record({ app_duration_ms: Date.now() - appOpenedAt });
});
const scrollingTimers = new WeakMap();
document.addEventListener(
  'scroll',
  (event) => {
    const scroller = event.target instanceof Element ? event.target : document.scrollingElement;
    if (!scroller) return;
    scroller.classList.add('is-scrolling');
    clearTimeout(scrollingTimers.get(scroller));
    scrollingTimers.set(
      scroller,
      setTimeout(() => scroller.classList.remove('is-scrolling'), 900),
    );
  },
  true,
);
const liveSegments = new Map();
// 正在攒的段落（transcript.draft）渲染出的临时行，按音轨保存：后端每轨最多只有一段在攒，
// 因此它是一条会被就地替换的行，正式段落提交后由空文本的 draft 事件撤下。
const draftSegments = new Map();
const clearDraftSegments = () => {
  draftSegments.forEach((element) => element.remove());
  draftSegments.clear();
};
// 实时字幕段落元数据（text/start_ms/speaker），供「加入笔记」等本地规则辅助读取。
let segmentSpeakerDraft;
const liveSegmentData = new Map();
const maxLiveSegments = 500;
let followLiveTranscript = true;
let toastTimer;
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
const recommendTag = (show) =>
  show ? `<span class="flow-select-badge">${escapeHtml(t('当前机器的推荐设置'))}</span>` : '';
const selectedMeetingKeys = new Set();
let meetingSelectionMode = false;
let meetingRenameDraft = null;
renderStaticViews();
document.querySelectorAll('[data-interface-icon]').forEach((mount) => {
  mount.innerHTML = interfaceIcon(mount.dataset.interfaceIcon);
});
const speakerProfileCard = document.createElement('section');
speakerProfileCard.className = 'preferences-destination';
speakerProfileCard.id = 'speaker-profiles-entry';
speakerProfileCard.innerHTML = `<div class="preference-copy"><h2></h2><p></p></div><button class="preferences-open" type="button">${interfaceIcon('chevron-right')}</button>`;
document.querySelector('#mobile-connection').before(speakerProfileCard);
const updateCard = document.createElement('section');
updateCard.className = 'preferences-destination preferences-update';
updateCard.id = 'app-update-entry';
updateCard.innerHTML = `<div class="preference-copy"><h2 id="settings-update-label"></h2><p></p></div><button class="preferences-open" data-open-whats-new type="button" aria-labelledby="settings-update-label">${interfaceIcon('chevron-right')}</button><span class="update-actions"><button class="update-notes" data-open-whats-new type="button"></button><button class="update-button" type="button"></button></span>`;
document.querySelector('#settings-view .preferences-destinations').append(updateCard);
const updateTitle = updateCard.querySelector('h2');
const updateDescription = updateCard.querySelector('p');
const updateButton = updateCard.querySelector('button.update-button');
const updateNotesButton = updateCard.querySelector('.update-notes');
const updateNotice = document.createElement('aside');
updateNotice.className = 'release-notice';
updateNotice.hidden = true;
updateNotice.innerHTML = `<header><strong></strong><button type="button" data-dismiss-update>${interfaceIcon('close')}</button></header><p></p><a data-release-link target="_blank" rel="noopener noreferrer"></a><progress max="100" hidden></progress><button type="button" class="release-install" data-install-app-update></button>`;
document.body.append(updateNotice);
let updateAvailable = false;
let updateVersion = '';
let updateBusy = '';
let updateDownloadProgress = null;
let updateStatus = '';
let updateRetryDelay = 3600000;
let updateCheckTimer;
let nextUpdateCheckAt = 0;
let updateReminderTimer;
const UPDATE_DAY = 86400000;
const updateDelays = [0, 1, 3, 7, 14, 30];
let updatePolicy = {};
try {
  const saved = JSON.parse(localStorage.getItem('brevia-update-policy'));
  if (saved && typeof saved === 'object') updatePolicy = saved;
} catch {
  // 存储不可用时仍允许本次会话检查、下载和关闭提醒。
}
if (!updateDelays.includes(updatePolicy.delayDays)) updatePolicy.delayDays = 0;
function persistUpdatePolicy() {
  try {
    localStorage.setItem('brevia-update-policy', JSON.stringify(updatePolicy));
  } catch {
    // 本次会话仍使用内存中的提醒偏好。
  }
}
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
  return `<span class="model-library-rating"><small>${escapeHtml(label)}</small><b>${escapeHtml(tierWord)}</b><span class="rating-scale" aria-hidden="true" style="--rating-level:${level}"><i></i></span></span>`;
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
  return (
    builtinModelIntro[model?.id]?.[locale] ||
    builtinModelIntro[model?.id]?.en ||
    modelLibraryBackground[locale]?.[model?.id] ||
    modelLibraryBackground.en[model?.id] ||
    fallback
  );
}
let expandedSpeakerProfileId = null;
let editingSpeakerProfileId = null;
const speakerSamples = new Map();
const speakerSampleAudio = new Audio();
speakerSampleAudio.addEventListener('ended', () => {
  if (speakerSampleAudio._button) speakerSampleAudio._button.innerHTML = interfaceIcon('play');
});
function renderSpeakerProfileCard() {
  const copy = speakerProfileCopy[locale] || speakerProfileCopy.en;
  speakerProfileCard.querySelector('h2').textContent = t('声纹管理');
  speakerProfileCard.querySelector('p').textContent = copy.intro;
  speakerProfileCard.querySelector('button').setAttribute('aria-label', copy.title);
}
/** 根据当前语言环境和可用性状态渲染浮动更新通知。@returns {void} */
function updateCopy() {
  return (
    updateLabels[locale] || { ...updateLabels.en, title: t('软件更新'), action: t('检查更新') }
  );
}
function currentVersionLabel() {
  const labels = window.BreviaLocaleData.appCopy.currentVersionLabels;
  return labels[locale] || labels.en;
}
function availableUpdateLabel() {
  return updateVersion
    ? updateCopy().available.replace('0.2.0', updateVersion)
    : updateCopy().available;
}
function availableUpdateActionLabel() {
  return updateVersion ? updateCopy().update.replace('0.2.0', updateVersion) : updateCopy().update;
}
function updateReleaseLink(link) {
  link.textContent = (whatsNewCopy[locale] || whatsNewCopy.en).title;
  link.href = `https://github.com/zerolovesea/Brevia/releases/tag/v${encodeURIComponent(updateVersion)}`;
}
function renderUpdateNotice() {
  clearTimeout(updateReminderTimer);
  const waiting = (updatePolicy.releasedAt || 0) + updatePolicy.delayDays * UPDATE_DAY - Date.now();
  updateNotice.hidden =
    !updateAvailable || updatePolicy.dismissedVersion === updateVersion || waiting > 0;
  if (updateNotice.hidden) {
    if (updateAvailable && updatePolicy.dismissedVersion !== updateVersion && waiting > 0)
      updateReminderTimer = setTimeout(renderUpdateNotice, Math.min(waiting, UPDATE_DAY));
    return;
  }
  const copy = updateCopy();
  updateNotice.querySelector('strong').textContent = copy.title;
  updateNotice.querySelector('[data-dismiss-update]').ariaLabel = t('关闭');
  updateNotice.querySelector('p').textContent = availableUpdateLabel();
  updateReleaseLink(updateNotice.querySelector('[data-release-link]'));
  const progress = updateNotice.querySelector('progress');
  progress.hidden = !updateDownloadProgress;
  progress.value = updateDownloadProgress?.percent || 0;
  progress.setAttribute('aria-label', copy.downloading);
  const install = updateNotice.querySelector('[data-install-app-update]');
  install.title = copy.restart;
  install.textContent = updateDownloadProgress
    ? `${copy.downloading} ${Math.round(progress.value)}%`
    : updateBusy === 'install'
      ? copy.updating
      : availableUpdateActionLabel();
  install.disabled = Boolean(updateBusy);
}
function renderUpdateButton() {
  const copy = updateCopy();
  updateTitle.textContent = t('关于与更新');
  updateNotesButton.textContent = (whatsNewCopy[locale] || whatsNewCopy.en).view;
  const detail = updateDownloadProgress
    ? `${copy.downloading} ${Math.round(updateDownloadProgress.percent)}% · ${formatBytes(updateDownloadProgress.transferred)} / ${formatBytes(updateDownloadProgress.total)}`
    : updateBusy === 'install'
      ? copy.updating
      : updateStatus === 'unsupported'
        ? copy.unsupported
        : updateAvailable
          ? availableUpdateLabel()
          : updateStatus === 'current'
            ? copy.current
            : '';
  updateDescription.textContent = detail || `${currentVersionLabel()} ${installedAppVersion}`;
  updateButton.textContent = updateBusy === 'check' ? copy.checking : copy.action;
  updateButton.disabled = Boolean(updateBusy);
  const section = settingsModal.querySelector('.release-settings');
  if (!section) return;
  const check = section.querySelector('[data-check-app-update]');
  check.querySelector('span').textContent = updateButton.textContent;
  check.disabled = updateButton.disabled;
  const install = section.querySelector('[data-install-app-update]');
  install.title = copy.restart;
  install.hidden = !updateAvailable;
  install.disabled = Boolean(updateBusy);
  install.querySelector('span').textContent =
    updateBusy === 'install' ? copy.updating : availableUpdateActionLabel();
  const status = section.querySelector('[role="status"]');
  status.textContent = detail;
  status.hidden = !detail;
  const progress = section.querySelector('progress');
  progress.hidden = !updateDownloadProgress;
  progress.value = updateDownloadProgress?.percent || 0;
  const link = section.querySelector('[data-release-link]');
  link.hidden = !updateAvailable;
  if (updateAvailable) updateReleaseLink(link);
  else if (updateStatus === 'unsupported') {
    link.hidden = false;
    link.textContent = (whatsNewCopy[locale] || whatsNewCopy.en).title;
    link.href = 'https://github.com/zerolovesea/Brevia/releases/latest';
  }
}
const summaryProviders = Object.keys(summaryProviderPresets);
function summaryProviderLabel(provider) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  return (
    copy.providers?.[provider] ||
    summaryProviderPresets[provider]?.label ||
    summaryModelCopy.en.providers?.[provider] ||
    provider
  );
}
// 只有一套生效配置，但每个供应商的模型/地址/密钥引用分别留存，来回切换不会丢失已填内容。
let summaryConfig = { version: 2, enabled: true, provider: 'built-in', providers: {} };
// 配置写入版本号：loadSummaryConfig 读取期间若发生保存，旧值作废（防覆盖竞态）。
let summaryConfigRevision = 0;
let summaryConfigDraft = null;
let summaryFeedback = null;
// 内置供应商在表单里待选的模型。重新渲染（下载/删除/选择）时存活，切换供应商时重置。
let selectedBuiltinModel = '';
let selectedAiAssistBuiltinModel = '';
// 首启浮窗共用供应商表单；标志控制功能开关显示与本地模型下载，关闭时复位。
let onboardingOnlineProvider = false;
let onboardingBuiltinProvider = false;
function providerEntry(config, provider = config.provider) {
  return config.providers[provider] || {};
}
/** 内置供应商可用的已安装模型；未显式选择时回退到第一个已安装的 llama-chat 模型。@returns {string} */
function builtinFallbackModel() {
  const installed = modelCatalog.filter(
    (model) => model.kind === 'llama-chat' && modelPaths.has(model.id),
  );
  return installed[0]?.id || '';
}
/** 组装一次 LLM 请求所需的连接信息；配置不完整时返回 null。@returns {object|null} */
function requestConfig(config) {
  const fallback =
    config.provider === 'built-in' && !config.providers?.['built-in']?.model
      ? builtinFallbackModel()
      : '';
  return configuredSummaryProvider(config, fallback);
}
function summaryRequestConfig() {
  return summaryConfig.enabled ? requestConfig(summaryConfig) : null;
}
function speakerProfileName(profile) {
  return profile.name;
}
/** 返回保存在应用数据目录中的非机密纪要配置。*/
function currentSummaryConfig() {
  return {
    version: 2,
    enabled: summaryConfig.enabled,
    provider: summaryConfig.provider,
    providers: summaryConfig.providers,
  };
}
/** 在浏览器存储之外保存纪要模型设置；密钥由本地业务端管理。*/
async function persistSummaryConfig(apiKey) {
  await window.brevia?.summary.config.save({
    ...currentSummaryConfig(),
    ...(apiKey ? { apiKey } : {}),
  });
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
let aiAssistConfig = {
  version: 2,
  enabled: false,
  proactivity: 'assist',
  provider: 'built-in',
  providers: {},
};
let aiAssistConfigRevision = 0;
let aiAssistConfigDraft = null;
const modelConfigSecrets = new WeakMap();
let aiAssistTemporarilyDisabled = false;
/** 返回当前 AI 辅助配置的可持久化形态。@returns {object} */
function currentAiAssistConfig() {
  return {
    version: 2,
    enabled: aiAssistConfig.enabled,
    proactivity: aiAssistConfig.proactivity,
    provider: aiAssistConfig.provider,
    providers: aiAssistConfig.providers,
  };
}
async function persistAiAssistConfig(apiKey) {
  await window.brevia?.aiAssist.config.save({
    ...currentAiAssistConfig(),
    ...(apiKey ? { apiKey } : {}),
  });
}
function applyAiAssistConfig(config) {
  aiAssistConfig = {
    version: 2,
    enabled: Boolean(config?.enabled),
    proactivity: ['quiet', 'assist', 'auto'].includes(config?.proactivity)
      ? config.proactivity
      : 'assist',
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
settingsModal.innerHTML = settingsModalMarkup();
document.body.append(settingsModal);
const settingsFolders = document.createElement('div');
settingsFolders.className = 'settings-folder-paths';
settingsFolders.hidden = true;
document.body.append(settingsFolders);
/** 同一表单在设置中作为连续页面，在会议中作为受保护的配置弹层。 */
function configureSettingsPage(kind) {
  if (kind !== 'device-connection')
    settingsModal.querySelector('[data-mobile-install-toggle]')?.remove();
  const page =
    activeView === 'settings' &&
    !onboardingPage &&
    [
      'models',
      'storage',
      'summary-model',
      'ai-assist',
      'advanced-settings',
      'speaker-profiles',
      'device-connection',
      'agent-settings',
      'whats-new',
    ].includes(kind);
  settingsModal.classList.toggle('settings-page', page);
  settingsModal.classList.toggle('confirmation-modal', kind === 'confirmation');
  settingsModal.classList.remove('library-confirmation');
  settingsModal.classList.toggle('summary-model-modal', kind === 'summary-model');
  settingsModal.classList.toggle('ai-assist-modal', kind === 'ai-assist');
  settingsModal.classList.toggle(
    'batch-modal',
    kind === 'batch-export' || kind === 'batch-results',
  );
  if (kind !== 'confirmation')
    settingsModal.classList.remove('permanent-confirmation', 'storage-confirmation');
  settingsModal.classList.toggle('storage-settings', kind === 'storage');
  settingsModal.classList.toggle('about-settings', kind === 'whats-new');
  settingsModal.classList.toggle('upgrade-log', kind === 'upgrade-log');
  settingsModal.querySelector('.upgrade-log-actions')?.remove();
  if (kind !== 'whats-new' && kind !== 'upgrade-log') updateLogReturn = undefined;
  settingsModal.classList.toggle('export-modal', kind === 'export' || kind === 'share');
  const panel = settingsModal.querySelector('.modal-panel');
  panel.classList.toggle('preferences-workspace', page);
  settingsModal.querySelector('.modal-head').classList.toggle('preferences-titlebar', page);
  settingsModal.querySelector('.modal-body').classList.toggle('preferences-scroll', page);
  if (kind === 'upgrade-log') {
    settingsModal.querySelector('.modal-title h2').id = 'upgrade-log-title';
    panel.setAttribute('aria-labelledby', 'upgrade-log-title');
  } else panel.removeAttribute('aria-labelledby');
  panel.setAttribute('role', page ? 'region' : 'dialog');
  panel.setAttribute(
    'aria-modal',
    String(!page && !settingsModal.classList.contains('export-modal')),
  );
  const navigation = settingsModal.querySelector('.settings-navigation');
  const navigationKind = ['summary-model', 'ai-assist'].includes(kind) ? 'ai-features' : kind;
  if (
    !page ||
    navigation?.dataset.page !== navigationKind ||
    navigation?.dataset.locale !== locale
  ) {
    const scrollTop = navigation?.querySelector('.settings-nav-sections')?.scrollTop || 0;
    navigation?.remove();
    if (page) {
      settingsModal.insertAdjacentHTML('afterbegin', renderSettingsNavigation(kind));
      const next = settingsModal.querySelector('.settings-navigation');
      next.dataset.page = navigationKind;
      next.dataset.locale = locale;
      next.querySelector('.settings-nav-sections').scrollTop = scrollTop;
    }
  }
  const back = settingsModal.querySelector('.modal-close');
  back.innerHTML = interfaceIcon(page ? 'back' : 'close');
  back.classList.toggle('settings-back', page);
}
let activeModal;
let whatsNewReady = false;
let whatsNewShown = false;
let whatsNewRetryTimer;
let updateLogReturn;
// 维护事件提供真实字节数；未知时不展示示例容量或假配额。
let storageUsage;
let systemDiskUsage;
let modelsReturnTo = null;
// 从功能设置跳到模型库时，还未安装的内置 AI 模型 id；其中任意一个装好后跳回一次。
let modelsReturnToPending = null;
let advancedSettings;
let permissionStatus;
let permissionPollTimer;
const permissionRequests = new Set();
const advancedSettingCopy = window.BreviaLocaleData.appCopy.advancedSettingCopy;
function renderAdvancedSettings(settings, metadata = {}) {
  const copy = advancedSettingCopy[locale] || advancedSettingCopy.en;
  // 配置里只有 vad 是分语言的两层结构（default / zh）：子分组各有一个小标题，
  // 字段名用完整路径，保存时按路径写回，避免把子对象整体当成一个输入框。
  const rows = (path, values) =>
    Object.entries(values)
      .map(([key, value]) => {
        const fieldPath = `${path}.${key}`;
        if (metadata.inactive_fields?.includes(key)) return '';
        if (value && typeof value === 'object') {
          return `<h4 class="advanced-settings-subgroup">${escapeHtml(copy.subgroups?.[key] || key)}</h4>${rows(fieldPath, value)}`;
        }
        const capMinimum = key === 'max_speech_seconds' ? metadata.speech_cap_minimum : null;
        const limits = metadata.field_constraints?.[fieldPath] || {};
        const mlxQuiet = metadata.vad_runtime === 'mlx-audio' && key === 'quiet_speech_recovery';
        const label = mlxQuiet ? copy.mlxQuietLabel : copy.fields[key] || key;
        const hint = mlxQuiet
          ? copy.mlxQuietHint
          : fieldPath === 'vad.default.min_silence_duration'
            ? copy.defaultSilenceHint
            : key === 'diarization_chunk_ms' && metadata.diarization_chunk_floor_ms
              ? copy.windowsChunkHint
              : copy.hints[key];
        const bounds = capMinimum
          ? `0 / ≥ ${capMinimum} s`
          : limits.min === limits.max && limits.min !== undefined
            ? ''
            : [
                limits.min !== undefined ? `${limits.exclusive_min ? '>' : '≥'} ${limits.min}` : '',
                limits.max !== undefined ? `≤ ${limits.max}` : '',
                limits.step === 1 ? copy.integer : '',
              ]
                .filter(Boolean)
                .join(' · ');
        const range = [hint, bounds].filter(Boolean).join(' · ');
        const attributes = ['min', 'max', 'step']
          .filter((attribute) => limits[attribute] !== undefined)
          .map((attribute) => `${attribute}="${escapeHtml(String(limits[attribute]))}"`)
          .join(' ');
        return `<label class="preference-row preference-field" title="${escapeHtml(range)}"><span class="preference-copy"><b>${escapeHtml(label)}</b><small>${escapeHtml(range)}</small></span><span class="preference-control"><input name="${escapeHtml(fieldPath)}" type="${typeof value === 'number' ? 'number' : 'text'}" ${attributes}${limits.read_only ? ' readonly' : ' required'} value="${escapeHtml(String(value))}" /></span></label>`;
      })
      .join('');
  return Object.entries(settings)
    .map(
      ([section, values]) =>
        `<details class="preferences-disclosure advanced-settings-section"><summary class="preferences-advanced-heading">${interfaceIcon({ audio: 'microphone', asr: 'waveform', vad: 'waveform', live: 'waveform', diarization: 'person', refinement: 'document', summary: 'ai', translation: 'translate' }[section] || 'advanced')}<h3>${escapeHtml(copy.sections[section] || section)}</h3>${interfaceIcon('chevron-down')}</summary><div class="preferences-disclosure-fields advanced-fields">${rows(section, values)}</div></details>`,
    )
    .join('');
}
function validateAdvancedSettings(form) {
  const inputs = [...form.querySelectorAll('input[type="number"]')];
  const copy = advancedSettingCopy[locale] || advancedSettingCopy.en;
  const windowSeconds = advancedSettings.speech_window_seconds;
  const minimums = new Map();
  for (const input of inputs.filter((field) => /^vad\..+\.min_speech_duration$/.test(field.name))) {
    if (!Number.isFinite(input.valueAsNumber) || !windowSeconds) continue;
    const minimum = Math.max(
      1,
      Math.ceil(
        (input.valueAsNumber + advancedSettings.speech_overlap_seconds + 2 * windowSeconds) /
          windowSeconds,
      ) * windowSeconds,
    );
    minimums.set(input.name.replace('min_speech_duration', 'max_speech_duration'), minimum);
  }
  const capMinimum = minimums.size
    ? Math.max(...minimums.values())
    : advancedSettings.speech_cap_minimum || 1;
  const quietMinimum = inputs.find((field) => field.name === 'live_asr.quiet_speech_min_seconds');
  const quietMaximum = inputs.find((field) => field.name === 'live_asr.quiet_speech_max_seconds');
  for (const input of inputs) {
    const limits = advancedSettings.field_constraints?.[input.name] || {};
    const value = input.valueAsNumber;
    const hint = input.closest('label').querySelector('small');
    if (minimums.has(input.name)) {
      input.min = minimums.get(input.name);
      hint.textContent = `${copy.hints.max_speech_duration} · ≥ ${input.min}`;
    }
    const isCap = input.name === 'live_asr.max_speech_seconds';
    if (isCap) hint.textContent = `${copy.hints.max_speech_seconds} · 0 / ≥ ${capMinimum} s`;
    const invalid =
      (limits.exclusive_min && value <= limits.min) ||
      limits.exclude?.includes(value) ||
      (isCap && (value || advancedSettings.speech_cap_default_seconds) < capMinimum) ||
      (input === quietMinimum && value > quietMaximum?.valueAsNumber);
    input.closest('label').title = hint.textContent;
    input.setCustomValidity(invalid ? hint.textContent : '');
  }
}
let screenProbe =
  localStorage.getItem('brevia-system-audio-confirmed') === 'true' ? true : undefined;
function systemAudioAllowed(status) {
  return (
    status.screen === 'granted' ||
    (status.screen === 'unknown' &&
      status.systemAudioCapture === 'core-audio-tap' &&
      screenProbe === true)
  );
}
function unknownScreenLabel() {
  return screenProbe === true
    ? '已检测到系统音频'
    : screenProbe === null
      ? '已发起权限申请'
      : '录音时确认';
}
function permissionSettingsPath(kind, status = permissionStatus) {
  if (window.brevia?.platform !== 'darwin') return t('请在系统设置中开启此权限');
  if (kind === 'screen' && status?.systemAudioCapture === 'core-audio-tap')
    return t('隐私与安全性 → 屏幕与系统音频录制 → 仅系统音频录制');
  return t(kind === 'screen' ? '隐私与安全性 → 屏幕与系统音频录制' : '隐私与安全性 → 麦克风');
}
async function requestPermissionAccess(kind) {
  if (kind === 'screen') screenProbe = undefined;
  const granted = await (kind === 'screen'
    ? window.brevia.permissions.requestScreen()
    : window.brevia.permissions.requestMicrophone());
  if (kind === 'screen') {
    screenProbe = granted;
    if (granted === true) localStorage.setItem('brevia-system-audio-confirmed', 'true');
    else localStorage.removeItem('brevia-system-audio-confirmed');
  }
  if (granted === false)
    throw new Error(`${t('请在系统设置中允许')} · ${permissionSettingsPath(kind)}`);
  if (granted === null) showToast(t('已发起权限申请'));
  return granted;
}
/** 构建权限部分的一行：状态标记、标签、提示和上下文操作按钮。*/
function permissionRow(
  kind,
  label,
  detail,
  granted,
  denied,
  active,
  unsupported,
  uncertain = false,
) {
  const state = `<span class="permission-badge${granted || (uncertain && screenProbe === true) ? ' is-granted' : denied ? ' is-denied' : ''}">${t(granted ? '已允许' : unsupported ? '不可用' : uncertain ? unknownScreenLabel() : '未授权')}</span>`;
  const hint = unsupported
    ? t('当前系统不支持直接录制系统音频，请仅使用麦克风')
    : denied
      ? permissionSettingsPath(kind)
      : uncertain && !granted
        ? t(
            screenProbe === undefined
              ? '录制时将请求系统音频权限；若录不到声音，请在系统设置中检查。'
              : '播放其他应用的声音后重新检测。',
          )
        : detail;
  const pending = permissionRequests.has(kind);
  // 系统音频沿用 screen 协议字段；其权限不能总由公开 API 静默查询。
  const canRequest = active || kind === 'screen';
  const action =
    granted || unsupported
      ? ''
      : `<span class="permission-actions">${canRequest ? `<button class="modal-action permission-setting-action" data-request-permission="${kind}" type="button"${uncertain ? ` title="${escapeHtml(hint)}"` : ''}${pending ? ' disabled aria-busy="true"' : ''}>${t(pending ? '正在请求权限…' : uncertain && screenProbe !== undefined ? '重新检测' : '申请权限')}</button>` : ''}<button class="secondary permission-setting-action" data-open-permission-settings="${kind}" type="button" title="${escapeHtml(permissionSettingsPath(kind))}"${pending ? ' disabled' : ''}>${t('打开系统设置')}</button></span>`;
  return `<div class="preference-row preferences-permission-row${granted ? ' is-granted' : ''}"><span class="preference-copy" title="${escapeHtml(hint)}"><b>${escapeHtml(label)}</b>${denied || unsupported || (uncertain && screenProbe === null) ? `<small>${escapeHtml(hint)}</small>` : ''}</span><span class="preference-control preferences-permission-control"><span class="preferences-permission-state">${state}</span>${action}</span></div>`;
}
/** 渲染显示在高级设置模态框顶部的系统权限部分。@returns {string} */
function renderPermissionSettings() {
  const status = permissionStatus || {};
  const micGranted = status.microphone === 'granted';
  const micActive = status.microphone === 'not-determined';
  const screenGranted = systemAudioAllowed(status);
  const screenUnsupported = status.systemAudioSupported === false;
  const rows =
    permissionRow(
      'microphone',
      t('麦克风'),
      t('录制你的发言。'),
      micGranted,
      ['denied', 'restricted'].includes(status.microphone),
      micActive,
      false,
    ) +
    permissionRow(
      'screen',
      t('系统音频'),
      t('用于录制电脑播放的声音。'),
      screenGranted && !screenUnsupported,
      status.screen === 'denied',
      false,
      screenUnsupported,
      status.screen === 'unknown',
    );
  return `<section class="preferences-section permission-settings-section" data-permission-settings><header class="preferences-section-heading preferences-advanced-heading">${interfaceIcon('laptop')}<h3>${t('系统权限')}</h3></header>${rows}</section>`;
}
const modelDownloads = new Map();
const meetingList = document.querySelector('.meeting-list');
const libraryToolbar = document.querySelector('.library-toolbar');
const meetingSearch = document.querySelector('#meeting-search');
const meetingSearchClear = document.querySelector('#meeting-search-clear');
const searchResultsPanel = document.querySelector('#search-results');
searchResultsPanel.setAttribute('popover', 'manual');
let searchDebounceTimer = 0;
let searchRequestId = 0;
const batchToolbar = document.createElement('section');
batchToolbar.className = 'batch-toolbar';
batchToolbar.hidden = true;
batchToolbar.setAttribute('aria-live', 'polite');
batchToolbar.innerHTML =
  '<label class="batch-select-all"><input id="batch-select-all" type="checkbox" /><span data-batch-all-label></span></label><strong data-batch-count></strong><div class="batch-actions"><button type="button" data-batch-restore></button><button type="button" data-batch-export></button><button class="batch-delete" type="button" data-batch-delete></button><button type="button" data-batch-clear></button></div>';
document.querySelector('.navigation-library-heading').after(batchToolbar);
/** 同步选中行样式和上下文批量工具栏。@param {boolean} updateToolbar 是否重绘批量操作。@returns {void} */
function syncMeetingSelection(updateToolbar = true) {
  const rows = [...meetingList.querySelectorAll('.meeting-row')];
  const visibleRows = rows.filter((row) => !row.hidden);
  const available = new Set(visibleRows.map((row) => row.dataset.selectionKey));
  [...selectedMeetingKeys]
    .filter((key) => !available.has(key))
    .forEach((key) => selectedMeetingKeys.delete(key));
  if (selectedMeetingKeys.size) meetingSelectionMode = true;
  rows.forEach((row) => {
    const selected = selectedMeetingKeys.has(row.dataset.selectionKey);
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-selected', String(selected));
    const checkbox = row.querySelector('[data-select-meeting]');
    if (checkbox) {
      checkbox.checked = selected;
      checkbox.hidden = !meetingSelectionMode;
    }
  });
  if (!updateToolbar) return;
  batchToolbar.hidden = !meetingSelectionMode;
  const toggle = document.querySelector('#meeting-selection-toggle');
  toggle.innerHTML = `${interfaceIcon('checkbox')}${escapeHtml(t(meetingSelectionMode ? '退出选择' : '选择会议'))}`;
  toggle.setAttribute('aria-pressed', String(meetingSelectionMode));
  toggle.title = toggle.ariaLabel = t(meetingSelectionMode ? '退出选择' : '选择会议');
  meetingList.classList.toggle('is-selecting', meetingSelectionMode);
  batchToolbar.querySelector('[data-batch-count]').textContent =
    `${selectedMeetingKeys.size} / ${visibleRows.length}`;
  batchToolbar.querySelector('[data-batch-count]').ariaLabel =
    `${t('已选择')} ${selectedMeetingKeys.size} / ${visibleRows.length}`;
  const all = batchToolbar.querySelector('#batch-select-all');
  all.checked = visibleRows.length > 0 && selectedMeetingKeys.size === visibleRows.length;
  all.indeterminate = selectedMeetingKeys.size > 0 && !all.checked;
  all.setAttribute('aria-checked', all.indeterminate ? 'mixed' : String(all.checked));
  all.setAttribute('aria-label', t(all.checked ? '取消全选' : '全选'));
  batchToolbar.querySelector('[data-batch-all-label]').textContent = t(
    all.checked ? '取消全选' : '全选',
  );
  const deleted = activeLibraryNav === 'recently-deleted';
  const exportButton = batchToolbar.querySelector('[data-batch-export]');
  const restoreButton = batchToolbar.querySelector('[data-batch-restore]');
  exportButton.hidden = deleted;
  restoreButton.hidden = !deleted;
  restoreButton.innerHTML = `${interfaceIcon('restore')}${escapeHtml(t('恢复'))}`;
  exportButton.innerHTML = `${interfaceIcon('upload')}${escapeHtml(t('导出'))}`;
  [restoreButton, exportButton, batchToolbar.querySelector('[data-batch-delete]')].forEach(
    (button) => {
      button.disabled = selectedMeetingKeys.size === 0;
    },
  );
  batchToolbar.querySelector('[data-batch-delete]').innerHTML =
    `${interfaceIcon('trash')}${escapeHtml(deleted ? BreviaI18n.trashCopy(locale).purge : t('删除'))}`;
  batchToolbar.querySelector('[data-batch-clear]').innerHTML =
    `${interfaceIcon('close')}${escapeHtml(t('取消'))}`;
  batchToolbar.querySelectorAll('.batch-actions button').forEach((button) => {
    button.title = button.ariaLabel = button.textContent.trim();
  });
}
const selectedMeetings = () =>
  uiData.meetings.filter((meeting, index) => selectedMeetingKeys.has(meeting.id || String(index)));
function clearMeetingSelection() {
  selectedMeetingKeys.clear();
  meetingSelectionMode = false;
  syncMeetingSelection();
}
/** 工作区只折叠自己的会议；活动工作区仅决定下一场会议的默认归属。@returns {void} */
function filterMeetings() {
  meetingList.querySelectorAll('.meeting-row').forEach((row) => {
    const meeting = uiData.meetings[Number(row.dataset.meetingIndex)];
    row.hidden =
      activeLibraryNav !== 'recently-deleted' &&
      collapsedSidebarWorkspaces.has(meeting.workspaceId || '');
  });
  meetingList.querySelectorAll('[data-sidebar-workspace]').forEach((group) => {
    const workspaceId = group.dataset.sidebarWorkspace;
    const expanded = !collapsedSidebarWorkspaces.has(workspaceId);
    const toggle = group.querySelector('[data-sidebar-workspace-toggle]');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-pressed', String(workspaceId === activeWorkspaceId));
    toggle.classList.toggle('active', workspaceId === activeWorkspaceId);
    group.querySelector('.sidebar-workspace-meetings').hidden = !expanded;
  });
  meetingList.querySelectorAll('header.library-group').forEach((heading) => {
    const count = [...meetingList.querySelectorAll('.meeting-row')].filter(
      (row) => !row.hidden && row.dataset.libraryGroup === heading.dataset.libraryGroup,
    ).length;
    heading.hidden = count === 0;
    heading.querySelector('span').textContent = count;
  });
  meetingList.querySelector('.library-empty')?.remove();
  if (activeLibraryNav === 'recently-deleted' && !meetingList.querySelector('.meeting-row')) {
    meetingList.insertAdjacentHTML(
      'beforeend',
      `<section class="library-empty">${interfaceIcon('document')}<h2>${t(activeLibraryNav === 'recently-deleted' ? '没有已删除的会议' : '这里还没有会议')}</h2><p>${t(activeLibraryNav === 'recently-deleted' ? '删除的会议会显示在这里。' : '录制或导入后，在这里整理。')}</p>${activeLibraryNav === 'recently-deleted' ? '' : `<div><button class="primary-action" data-view="prepare" data-prepare-mode="record">${interfaceIcon('plus')}${t('开始会议')}</button><button class="secondary" data-view="prepare" data-prepare-mode="import">${interfaceIcon('upload')}${t('导入音频')}</button></div>`}</section>`,
    );
  }
}
function toggleSidebarWorkspace(
  workspaceId,
  expanded = collapsedSidebarWorkspaces.has(workspaceId),
) {
  if (expanded) collapsedSidebarWorkspaces.delete(workspaceId);
  else collapsedSidebarWorkspaces.add(workspaceId);
  void switchWorkspace(workspaceId);
  syncMeetingSelection();
}
function renderSidebarMeetingTree() {
  const meetings = uiData.meetings
    .map((meeting, index) => ({ meeting, index }))
    .filter(({ meeting }) => !meeting.isExample || meeting.exampleLocale === locale);
  if (activeLibraryNav === 'recently-deleted') {
    const group = t('最近删除');
    return `<header class="library-group" data-library-group="${escapeHtml(group)}"><h2>${escapeHtml(group)}</h2><span>${meetings.length}</span></header>${meetings
      .map(({ meeting, index }) =>
        renderNavigationMeeting(localizeMeeting(meeting), index).replace(
          'class="meeting-row"',
          `class="meeting-row" data-library-group="${escapeHtml(group)}"`,
        ),
      )
      .join('')}`;
  }
  const groups = [{ id: '', name: t('公开工作区') }, ...workspaces];
  // 已恢复会议的原工作区元数据可能稍后才到；此时也不能隐藏可用的录音。
  for (const { meeting } of meetings) {
    const workspaceId = meeting.workspaceId || '';
    if (!groups.some(({ id }) => id === workspaceId))
      groups.push({
        id: workspaceId,
        name: meeting.workspace?.name || getWorkspaceName(workspaceId),
      });
  }
  return groups
    .map((workspace, groupIndex) => {
      const items = meetings.filter(({ meeting }) => (meeting.workspaceId || '') === workspace.id);
      const expanded = !collapsedSidebarWorkspaces.has(workspace.id);
      const current = workspace.id === activeWorkspaceId;
      const contentId = `sidebar-workspace-meetings-${groupIndex}`;
      return `<section class="sidebar-workspace" data-sidebar-workspace="${escapeHtml(workspace.id)}"><header class="sidebar-workspace-header"><button type="button" class="workspace-item sidebar-workspace-toggle${current ? ' active' : ''}" data-sidebar-workspace-toggle data-workspace-id="${escapeHtml(workspace.id)}" aria-expanded="${expanded}" aria-pressed="${current}" aria-controls="${contentId}" title="${escapeHtml(workspace.name)}">${interfaceIcon('chevron-right')}${interfaceIcon('folder')}<span class="workspace-label">${escapeHtml(workspace.name)}</span></button>${workspace.id ? `<button type="button" class="sidebar-workspace-edit" data-edit-sidebar-workspace="${escapeHtml(workspace.id)}" aria-label="${escapeHtml(t('编辑工作区'))} ${escapeHtml(workspace.name)}" title="${escapeHtml(t('编辑工作区'))}">${interfaceIcon('more')}</button>` : ''}</header><div class="sidebar-workspace-meetings" id="${contentId}"${expanded ? '' : ' hidden'}>${items.length ? items.map(({ meeting, index }) => renderNavigationMeeting(localizeMeeting(meeting), index)).join('') : `<p class="sidebar-workspace-empty">${escapeHtml(t('还没有会议记录'))}</p>`}</div></section>`;
    })
    .join('');
}
/** 使用当前界面语言格式化后端会议元数据。@param {object} meeting 存储的 UI 会议。@returns {object} 显示就绪的会议。*/
function localizeMeeting(meeting) {
  if (!meeting.createdAt) return meeting;
  const languageTag = BreviaI18n.localeTag(locale);
  const created = new Date(meeting.createdAt).toLocaleString(languageTag, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const minutes = Math.round(meeting.durationMs / 60000);
  // 后端仍把暂停中的会议记为 recording，这里以界面的暂停状态为准，避免重绘后回到「正在录制」。
  const paused = meetingActive && meetingPaused() && meeting.id === breviaClient?.state.meeting?.id;
  return {
    ...meeting,
    meta: `${created} · ${minutes} ${t('分钟')}`,
    // label 一律存文案 key；detail 允许是 key（录制中）或已合成的译文（已完成）。
    // renderNavigationMeeting 会统一走一次 t()：key 被翻译，已翻译文本原样返回。
    status:
      meeting.statusCode === 'recording'
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
function renderHomeMeetings() {
  const panel = document.querySelector('[data-home-meetings]');
  const deleted = activeLibraryNav === 'recently-deleted';
  const meetings = uiData.meetings.filter(
    (meeting) =>
      meeting.id &&
      (!meeting.isExample || meeting.exampleLocale === locale) &&
      Boolean(meeting.deleted) === deleted,
  );
  const display = deleted
    ? meetings
    : meetings
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        .slice(0, 5);
  panel.parentElement.classList.toggle('is-trash', deleted);
  panel.hidden = !deleted && !display.length;
  if (panel.hidden) {
    panel.replaceChildren();
    panel.homeMarkup = '';
    return;
  }
  let previousDay;
  const markup = `<h2>${escapeHtml(t(deleted ? '最近删除' : '最近会议'))}</h2>${
    display
      .map((meeting) => {
        const key = escapeHtml(meeting.id);
        const title = escapeHtml(meeting.title);
        const context = [getWorkspaceName(meeting.workspaceId)];
        if (meeting.durationMs > 0)
          context.push(`${Math.ceil(meeting.durationMs / 60000)} ${t('分钟')}`);
        const date = meeting.createdAt && new Date(meeting.createdAt);
        const meta =
          date && Number.isFinite(date.valueOf())
            ? date.toLocaleDateString(BreviaI18n.localeTag(locale), {
                month: 'short',
                day: 'numeric',
              })
            : '';
        const day = meta ? date.toDateString() : '';
        const dayLabel = day === previousDay ? '' : meta;
        previousDay = day;
        const row = deleted ? 'div' : 'button';
        const open = deleted ? '' : ` type="button" data-open-recent="${key}" title="${title}"`;
        return `<${row} class="home-meeting"${open}><span class="home-meeting-mark" aria-hidden="true">${interfaceIcon(deleted ? 'trash' : 'document')}</span><span class="home-meeting-copy"><strong>${title}</strong><span>${escapeHtml(context.join(' · '))}</span></span><small>${escapeHtml(dayLabel)}</small>${deleted ? `<button class="home-restore" data-restore-recent="${key}">${escapeHtml(t('恢复'))}</button>` : interfaceIcon('chevron-right')}</${row}>`;
      })
      .join('') || `<p>${escapeHtml(t('还没有会议记录'))}</p>`
  }`;
  if (panel.homeMarkup !== markup) {
    panel.innerHTML = markup;
    panel.homeMarkup = markup;
  }
}
document.querySelector('[data-home-meetings]').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-recent]');
  if (open) {
    if (meetingActive && open.dataset.openRecent === breviaClient?.state.meeting?.id)
      return startQuickRecording();
    return openMeetingRow(open, open.dataset.openRecent);
  }
  const restore = event.target.closest('[data-restore-recent]');
  const meeting =
    restore && uiData.meetings.find((item) => item.id === restore.dataset.restoreRecent);
  if (!meeting || restore.disabled) return;
  restore.disabled = true;
  try {
    await mutateMeetings('restore', [meeting]);
    showToast(t('恢复'), undefined, 'success');
  } catch (error) {
    showToast(error.message, undefined, 'error');
  } finally {
    restore.disabled = false;
  }
});
/** 仅重新渲染会议列表，保留设置模态框事件绑定。@returns {void} */
function renderMeetingList() {
  const renameForm = meetingList.querySelector('[data-rename-meeting]');
  const renameFocus = renameForm?.contains(document.activeElement) ? document.activeElement : null;
  if (meetingRenameDraft) {
    editingMeetingIndex = uiData.meetings.findIndex(
      (meeting, index) => (meeting.id || String(index)) === meetingRenameDraft.key,
    );
    if (editingMeetingIndex < 0) {
      meetingRenameDraft = null;
      editingMeetingIndex = null;
    }
  }
  renderHomeMeetings();
  meetingList.innerHTML = renderSidebarMeetingTree();
  if (renameForm && meetingRenameDraft) {
    const replacement = meetingList.querySelector('[data-rename-meeting]');
    if (replacement && renameForm.dataset.renameMeeting === meetingRenameDraft.key) {
      renameForm.dataset.meetingIndex = editingMeetingIndex;
      replacement.replaceWith(renameForm);
      if (renameFocus?.isConnected) renameFocus.focus({ preventScroll: true });
    }
  }
  filterMeetings();
  syncMeetingSelection();
  cacheMeetingList();
  syncCurrentMeetingNavigation();
}

const prepareForm = document.querySelector('#meeting-form');
let importAudioSelection = null;
const prepareView = document.querySelector('#prepare-view');
const importRecording = document.querySelector('#import-recording');
const meetingTitle = document.querySelector('#meeting-title');
let meetingTitleEdited = false;
/** 仅在用户提供自己的标题之前刷新起始标题。@returns {void} */
function renderDefaultMeetingTitle() {
  if (!meetingTitleEdited) meetingTitle.value = BreviaI18n.defaultMeetingTitle(locale);
}
meetingTitle.addEventListener('input', () => {
  meetingTitleEdited = true;
});
// 会议语言的默认值：界面语言本身就是可识别的会议语言时直接用它。
// auto 的声明默认模型（Parakeet）不覆盖 zh/ja/ko，所以这三个界面必须给出显式语言，
// 否则默认会议会被路由到不支持该语言的模型。
const defaultMeetingLanguage = () => ({ zh: 'zh', ja: 'ja', ko: 'ko' })[locale] || 'auto';
/** 在保留其提交值的同时重建会议语言选择器。@returns {void} */
/** 渲染准备页的识别模型控件。 */
function prepareModelControl(language, refinedModel, modelOptions) {
  if (!modelOptions.length) return '';
  const words = (asrCopy.prepare || {})[locale] || (asrCopy.prepare || {}).en || {};
  return `<label class="prepare-model-select">${escapeHtml(words.modelLabel || t('识别模型'))}${desktopSelect('refined-model', refinedModel, modelOptions)}</label>`;
}
function renderPrepareSelects(refinedModelOverride) {
  const values = Object.fromEntries(new FormData(prepareForm));
  const workspaceOptions = [
    ['', t('公开工作区')],
    ...(typeof workspaces !== 'undefined' ? workspaces.map((ws) => [ws.id, ws.name]) : []),
    ['__new_workspace__', `+ ${t('新建工作区')}`],
  ];
  const workspaceValue =
    values['meeting-workspace'] === '__new_workspace__'
      ? activeWorkspaceId
      : (values['meeting-workspace'] ?? activeWorkspaceId);
  const language = values['meeting-language'] || defaultMeetingLanguage();
  // 手动选择已按语言保存；不能把上一种语言的自动默认值当作当前语言的偏好。
  const modelOptions = refinedModelOptions(language);
  const refinedModel = refinedModelOverride || defaultRefinedModelId(language);
  // 模型清单要等后端 initialize 返回；在那之前不渲染这一格，避免出现空白的禁用下拉。
  const modelLabel = prepareModelControl(language, refinedModel, modelOptions);
  prepareForm.querySelector('.form-grid').innerHTML =
    `<label>${t('工作区')}${desktopSelect('meeting-workspace', workspaceValue, workspaceOptions)}</label><label>${t('会议语言')}${desktopSelect('meeting-language', language, BreviaI18n.languageOptions(locale, t, true))}</label><label>${t('译文目标')}${desktopSelect('translation-target', values['translation-target'] || '', BreviaI18n.languageOptions(locale, t))}</label><label>${t('预期说话人数')}${desktopSelect('meeting-speakers', values['meeting-speakers'] || '-1', [['-1', t('自动检测')], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])])}</label>${modelLabel}`;
  const templateLabel = `<label>${escapeHtml(t('整理模板'))}${desktopSelect(
    'summary-template',
    values['summary-template'] || 'general',
    [
      ['general', t('通用')],
      ['weekly', t('周会')],
      ['interview', t('访谈')],
      ['review', t('评审')],
    ],
  )}</label>`;
  const processing = prepareForm.querySelector('[data-prepare-processing]');
  processing.replaceChildren();
  const extraSettings = prepareForm.querySelector('[data-prepare-extra-settings]');
  extraSettings.replaceChildren();
  if (prepareView.dataset.mode === 'import') {
    prepareForm
      .querySelector('.form-grid')
      .insertAdjacentHTML(
        'beforeend',
        `<label>${escapeHtml(t('会议日期（可留空）'))}<input type="date" name="meeting-date" value="${escapeHtml(values['meeting-date'] || '')}" title="${escapeHtml(t('仅在日期确定时填写，用于换算录音中的相对日期。'))}" /></label>`,
      );
    prepareForm.querySelectorAll('.form-grid label').forEach((label) => {
      if (
        label.querySelector(
          '[name="translation-target"], [name="refined-model"], [name="meeting-speakers"]',
        )
      )
        processing.append(label);
    });
  }
  if (prepareView.dataset.mode !== 'import') {
    prepareForm.querySelectorAll('.form-grid label').forEach((label) => {
      if (
        label.querySelector(
          '[name="refined-model"], [name="meeting-speakers"], [name="translation-target"]',
        )
      )
        extraSettings.append(label);
    });
  }
  (prepareView.dataset.mode === 'import' ? processing : extraSettings).insertAdjacentHTML(
    'beforeend',
    templateLabel,
  );
  prepareForm.querySelector('.prepare-processing').hidden = prepareView.dataset.mode !== 'import';
  renderCaptureMode();
  const importing = prepareView.dataset.mode === 'import';
  prepareView.querySelector('h1').textContent = t(importing ? '导入本地音频' : '新建会议');
  prepareView.querySelector('[data-prepare-description]').textContent = t(
    importing
      ? '导入会议录音，在电脑上转写和整理。'
      : '设置会议信息并选择录制来源，开始记录你的会议。',
  );
  prepareForm.querySelector('.primary-action').innerHTML = importing
    ? `${escapeHtml(t('导入录音'))}${interfaceIcon('arrow-right')}`
    : `${interfaceIcon('record')}${escapeHtml(t('开始录制'))}`;
  importRecording.querySelector('.import-recording-label').textContent = t('导入本地音频');
  importRecording.title = t('导入本地音频');
  if (activeView === 'prepare')
    crumb.textContent = importing ? t('导入录音') : catalog[locale].views.prepare;
}
const CAPTURE_MODES = new Set(['mic', 'system', 'both', 'phone']);
let currentCaptureMode = 'both';
let selectedPhoneDeviceId = '';
let capturePhones = [];
let phonePreviewDeviceId = null;
let phonePreviewLevel = null;
let phonePreviewTimer;
let phonePreviewPolling = false;
function syncPhonePreview() {
  const deviceId =
    activeView === 'prepare' &&
    prepareView.dataset.mode !== 'import' &&
    currentCaptureMode === 'phone' &&
    selectedPhoneDevice()?.captureReady &&
    !prepareForm.querySelector('.primary-action').classList.contains('is-pending')
      ? selectedPhoneDeviceId
      : null;
  if (deviceId === phonePreviewDeviceId) return;
  phonePreviewDeviceId = deviceId;
  phonePreviewLevel = null;
  clearInterval(phonePreviewTimer);
  if (!window.brevia?.mobile?.previewCapture) return;
  if (!deviceId) {
    void window.brevia.mobile.previewCapture({ device_id: null }).catch(() => {});
    return;
  }
  const poll = async () => {
    if (phonePreviewPolling) return;
    phonePreviewPolling = true;
    try {
      const meter = await window.brevia.mobile.previewCapture({ device_id: deviceId });
      if (phonePreviewDeviceId !== deviceId) return;
      phonePreviewLevel = meter.level;
    } catch (_) {
      if (phonePreviewDeviceId === deviceId) phonePreviewLevel = null;
    } finally {
      phonePreviewPolling = false;
    }
    if (phonePreviewDeviceId === deviceId) renderPrepareAudioSources();
  };
  phonePreviewTimer = setInterval(() => void poll(), 250);
  void poll();
}
function selectedPhoneDevice() {
  return capturePhones.find((device) => device.id === selectedPhoneDeviceId);
}
function updateCapturePhones(devices) {
  const phones = devices
    .filter((device) => device.connected)
    .map(({ id, name, captureReady }) => ({ id, name, captureReady }));
  if (JSON.stringify(phones) === JSON.stringify(capturePhones)) return;
  capturePhones = phones;
  if (!selectedPhoneDeviceId)
    selectedPhoneDeviceId = (phones.find((device) => device.captureReady) || phones[0])?.id || '';
  renderCaptureMode();
}
function captureModeInputs(mode = currentCaptureMode) {
  return {
    mic: mode === 'mic' || mode === 'both',
    system: mode === 'system' || mode === 'both',
    ...(mode === 'phone' ? { phone: selectedPhoneDeviceId } : {}),
  };
}
function captureModeSelect(value) {
  const options = [
    ['mic', t('麦克风'), t('适合面对面交流、个人口述')],
    ['system', t('系统音频'), t('适合网课、视频和电脑播放的音频')],
    ['both', t('麦克风 + 系统音频'), t('适合线上会议，同时收录双方声音')],
    ['phone', t('手机麦克风'), t('适合线下会议，用手机近距离收音')],
  ];
  const selected = options.find(([mode]) => mode === value) || options[2];
  return `<div class="flow-select capture-mode-select compose-source-switch"><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false" hidden>${escapeHtml(selected[1])}<span class="select-chevron">${interfaceIcon('chevron-down')}</span></button><input type="hidden" name="capture-mode" value="${escapeHtml(selected[0])}" /><div class="flow-select-options" role="radiogroup" aria-label="${escapeHtml(t('录制来源'))}">${options.map(([mode, label, scene]) => `<button type="button" role="radio" aria-checked="${mode === selected[0]}" data-flow-select-choice="capture-mode" data-value="${mode}" data-label="${escapeHtml(label)}" title="${escapeHtml(scene)}">${interfaceIcon(mode === 'phone' ? 'phone' : mode === 'mic' ? 'microphone' : mode === 'system' ? 'appearance' : 'waveform')}<span>${escapeHtml(label)}</span></button>`).join('')}</div></div>`;
}
function renderPhoneDeviceOptions() {
  const mount = prepareForm.querySelector('#phone-device-mount');
  const options = capturePhones.map((device) => [
    device.id,
    device.name,
    t(device.captureReady ? '已连接' : '未就绪'),
  ]);
  if (selectedPhoneDeviceId && !selectedPhoneDevice())
    options.unshift([selectedPhoneDeviceId, t('设备已断开'), t('未就绪')]);
  if (!options.length) options.push(['', t('尚未连接设备')]);
  mount.innerHTML = desktopSelect(
    'phone-device',
    selectedPhoneDeviceId,
    options,
    false,
    !capturePhones.length,
  );
  mount.querySelectorAll('[data-flow-select-choice]').forEach((option) => {
    option.disabled = !capturePhones.find((device) => device.id === option.dataset.value)
      ?.captureReady;
  });
}
function renderCaptureMode(value = currentCaptureMode) {
  const mount = prepareForm.querySelector('#capture-mode-mount');
  if (!mount) return;
  currentCaptureMode = CAPTURE_MODES.has(value) ? value : 'both';
  mount.innerHTML = captureModeSelect(currentCaptureMode);
  prepareView.querySelector('[data-prepare-source-description]').textContent = t(
    {
      mic: '适合面对面交流、个人口述',
      system: '适合网课、视频和电脑播放的音频',
      both: '适合线上会议，同时收录双方声音',
      phone: '适合线下会议，用手机近距离收音',
    }[currentCaptureMode],
  );
  const inputs = captureModeInputs();
  const micSetting = prepareForm.querySelector('#mic-device-setting');
  if (micSetting) micSetting.hidden = !inputs.mic;
  prepareForm.querySelector('#phone-device-setting').hidden = currentCaptureMode !== 'phone';
  renderPhoneDeviceOptions();
  const phoneReady = selectedPhoneDevice()?.captureReady;
  const hint = prepareForm.querySelector('#capture-mode-hint');
  hint.hidden = currentCaptureMode !== 'phone' || phoneReady || !selectedPhoneDevice();
  hint.textContent = hint.hidden ? '' : t('手机端未就绪，请打开或更新 Brevia');
  const submit = prepareForm.querySelector('.primary-action');
  submit.disabled =
    submit.classList.contains('is-pending') ||
    (prepareView.dataset.mode !== 'import' && currentCaptureMode === 'phone' && !phoneReady);
  syncPhonePreview();
  renderPrepareAudioSources();
  // 仅在准备页内预览麦克风；启动或首页重绘不应采集声音。
  if (activeView !== 'prepare' || prepareView.dataset.mode === 'import') return;
  if (inputs.mic) {
    void refreshMicDevices();
    void previewMicrophone();
  } else void breviaClient?.stopPreview();
}
function selectCurrentWorkspaceForMeeting() {
  const workspace = prepareForm.querySelector('[name="meeting-workspace"]');
  if (workspace) workspace.value = activeWorkspaceId;
  renderPrepareSelects();
}
function setPrepareMode(mode) {
  currentCaptureMode = 'both';
  prepareView.dataset.mode = mode;
  prepareForm.querySelector('.audio-import').hidden = mode !== 'import';
  if (mode === 'import') void breviaClient?.stopPreview();
  selectCurrentWorkspaceForMeeting();
  const error = prepareForm.querySelector('[data-prepare-error]');
  error.hidden = true;
  error.textContent = '';
}
const DEFAULT_REFINED_MODEL_ID = 'funasr-nano-int8';
const languageModelDefaults = {
  zh: { segmentation: 'pyannote-segmentation-3.0' },
  yue: { segmentation: 'pyannote-segmentation-3.0' },
  en: { segmentation: 'pyannote-segmentation-3.0' },
  default: { segmentation: 'pyannote-segmentation-3.0' },
};
const preferredModelsForLanguage = (language) =>
  languageModelDefaults[language] || languageModelDefaults.default;
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
  try {
    return JSON.parse(localStorage.getItem(PREFERRED_MODEL_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function rememberPreferredModel(modelId, language) {
  if (!modelId) return;
  const map = preferredModelMap();
  // 语言未知时按当前会议语言记，保证同一语言下次开会能命中。
  const key =
    language ||
    prepareForm.querySelector('[name="meeting-language"]')?.value ||
    defaultMeetingLanguage();
  map[key] = modelId;
  try {
    localStorage.setItem(PREFERRED_MODEL_KEY, JSON.stringify(map));
  } catch {
    /* 忽略存储失败。 */
  }
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
  Object.assign(prepareForm.dataset, {
    segmentationModel: models.segmentation,
    vadModel: 'silero-vad',
  });
}
if (breviaClient) {
  breviaClient.onCaptureError = (error) => {
    showToast(t(error.message), undefined, 'error');
    document.querySelector('#end-meeting').click();
  };
  breviaClient.onLevel = (track, level) => {
    if (meetingActive) {
      desktopLevel = Math.max(0, Math.min(1, level));
      desktopLevelAt = Date.now();
      if (window.brevia?.desktop && Date.now() - desktopLevelSentAt >= 80) {
        desktopLevelSentAt = Date.now();
        void window.brevia.desktop
          .publishLevel({ meetingId: breviaClient.state.meeting.id, level: desktopLevel })
          .catch(() => {});
      }
    }
    if (track !== 'mic') return;
    document.querySelectorAll('#mic-level, [data-onboarding-mic-level]').forEach((meter) => {
      if (meter.id === 'mic-level' && currentCaptureMode === 'phone') return;
      meter.style.setProperty('--level', Math.max(0, Math.min(1, level)));
    });
  };
  // 恢复用户上次选择的麦克风设备(若有)。
  if (savedMicDeviceId()) breviaClient.setMicDevice(savedMicDeviceId());
}
function setSourceBadge(labelEl, hintEl, { ok, text, hint }) {
  if (labelEl) {
    if (labelEl.textContent !== text) labelEl.textContent = text;
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
  const systemReady = status.systemAudioSupported !== false && systemAudioAllowed(status);
  const phone = currentCaptureMode === 'phone';
  const sourceLabel = document.querySelector('#mic-input-state > b');
  const sourceText = t(phone ? '手机麦克风' : '麦克风');
  if (sourceLabel.textContent !== sourceText) sourceLabel.textContent = sourceText;
  document.querySelector('#system-input-state').hidden = phone;
  const meter = document.querySelector('#mic-level');
  meter.setAttribute('aria-label', `${t(phone ? '手机麦克风' : '麦克风')} ${t('音量')}`);
  if (phone) meter.style.setProperty('--level', phonePreviewLevel ?? 0);
  setSourceBadge(document.querySelector('#mic-input-label'), null, {
    ok: phone ? phonePreviewLevel != null : micReady && inputs.mic,
    text: phone
      ? t(
          phonePreviewLevel != null
            ? '输入良好'
            : selectedPhoneDevice()?.captureReady
              ? '未检测'
              : '未就绪',
        )
      : inputs.mic
        ? micReady
          ? t('输入良好')
          : t('未就绪')
        : t('未启用'),
  });
  setSourceBadge(document.querySelector('#system-input-label'), null, {
    ok:
      inputs.system &&
      (systemReady ||
        (status.screen === 'unknown' &&
          screenProbe === true &&
          status.systemAudioSupported !== false)),
    text: inputs.system
      ? systemReady
        ? t('已连接')
        : status.screen === 'unknown' && status.systemAudioSupported !== false
          ? t(unknownScreenLabel())
          : t('未就绪')
      : t('未启用'),
  });
  if (!phone) renderMicDeviceOptions();
}
/** 拉取最新权限状态并刷新录音前页的录音源显示。@returns {Promise<void>} */
async function refreshPrepareAudioSources() {
  if (window.brevia?.permissions?.status) {
    const status = await window.brevia.permissions.status().catch(() => permissionStatus);
    if (status) permissionStatus = status;
  }
  renderPrepareAudioSources();
  if (permissionStatus?.microphone === 'granted' && captureModeInputs().mic)
    await refreshMicDevices();
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
    if (hint) {
      hint.textContent = userFacingError(error.message);
      hint.hidden = false;
    }
  }
}
const MIC_DEVICE_KEY = 'brevia-mic-device';
/** 读取用户保存的麦克风设备 id(空串表示系统默认)。@returns {string} */
function savedMicDeviceId() {
  try {
    return localStorage.getItem(MIC_DEVICE_KEY) || '';
  } catch {
    return '';
  }
}
/** 持久化所选麦克风设备 id。@param {string} deviceId 设备 id 或空串表示系统默认。@returns {void} */
function saveMicDeviceId(deviceId) {
  try {
    localStorage.setItem(MIC_DEVICE_KEY, deviceId || '');
  } catch {
    /* 忽略存储失败。 */
  }
}
/** 录制前页当前选中的麦克风设备 id(空串表示系统默认),来自自定义 flow-select 的隐藏字段。@returns {string} */
function selectedMicDeviceId() {
  return prepareForm.querySelector('[name="mic-device"]')?.value || '';
}
/** 缓存的麦克风设备列表,用于重建下拉选项。@type {Array<{deviceId:string,label:string}>} */
let cachedMicDevices;
let micDeviceRequest = 0;
/** 构建麦克风设备下拉的选项数组(首个为「系统默认」)。@returns {Array<[string,string]>} */
function micDeviceOptions() {
  return [
    ['', t('系统默认')],
    ...(cachedMicDevices || []).map((device) => [device.deviceId, device.label || t('麦克风设备')]),
  ];
}
/** 就地重建麦克风设备下拉:更新选项与选中标签,保留展开/收起状态;若已选设备断开则回退到系统默认。@returns {void} */
function renderMicDeviceOptions() {
  const mount = prepareForm.querySelector('#mic-device-mount');
  if (!mount) return;
  const saved = savedMicDeviceId();
  if (saved && cachedMicDevices && !cachedMicDevices.some((device) => device.deviceId === saved))
    saveMicDeviceId('');
  const options = micDeviceOptions();
  const flow = mount.querySelector('.flow-select');
  if (!flow) {
    mount.innerHTML = desktopSelect('mic-device', savedMicDeviceId(), options);
  } else {
    const previous = flow.querySelector('input').value || savedMicDeviceId();
    const current = options.some(([value]) => value === previous) ? previous : options[0][0];
    const template = document.createElement('template');
    template.innerHTML = desktopSelect('mic-device', current, options);
    flow
      .querySelector('.flow-select-options')
      .replaceChildren(...template.content.querySelector('.flow-select-options').childNodes);
    const label = options.find(([value]) => value === current)?.[1] || options[0][1];
    flow.querySelector('.flow-select-toggle').firstChild.nodeValue = label;
    flow.querySelector('input').value = current;
  }
  breviaClient?.setMicDevice(savedMicDeviceId());
}
/** 重新枚举系统麦克风设备并重建下拉。@returns {Promise<void>} */
async function refreshMicDevices() {
  const request = ++micDeviceRequest;
  const devices = await breviaClient?.listMicrophones().catch(() => undefined);
  if (!devices || request !== micDeviceRequest) return;
  cachedMicDevices = devices;
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
  return currentMeetingDetail?.id === meetingId
    ? currentMeetingDetail.title
    : breviaClient?.state.meeting?.id === meetingId
      ? breviaClient.state.meeting.title
      : uiData.meetings.find((meeting) => meeting.id === meetingId)?.title || '';
}
function showRefinementProgress(
  completed = 0,
  total = 0,
  meetingTitle = refinementMeetingTitle,
  meetingId,
  stage,
) {
  clearTimeout(refinementDismissTimer);
  if (meetingId) refinementCardDismissed = false;
  if (refinementCardDismissed) return;
  refinementMeetingTitle = meetingTitle;
  const copy = { title: t('正在精修'), waiting: t(stage || '准备中') };
  const previous =
    !meetingId && refinementCard.dataset.complete !== 'true'
      ? Number(refinementCard.dataset.completed || 0) /
        Math.max(1, Number(refinementCard.dataset.total || 0))
      : 0;
  const ratio = Math.max(previous, total ? Math.min(0.99, Math.max(0, completed / total)) : 0);
  revealTaskCard(refinementCard);
  refinementCard.querySelector('p').textContent = copy.title;
  let target = refinementCard.querySelector('.task-target');
  if (!target) {
    target = document.createElement('span');
    target.className = 'task-target';
    refinementCard.querySelector('.task-card-heading').after(target);
  }
  target.textContent = refinementMeetingTitle || '';
  refinementCard.querySelector('.task-card-heading').title = refinementMeetingTitle || copy.title;
  refinementPercent.innerHTML = renderTaskProgressLabel(
    refinementMeetingTitle || copy.waiting,
    total ? Math.round(ratio * 100) : undefined,
  );
  refinementPercent.title = copy.waiting;
  refinementBar.style.transform = `scaleX(${ratio})`;
  Object.assign(refinementCard.dataset, {
    completed: ratio * 100,
    total: 100,
    stage: stage || '',
    complete: 'false',
  });
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
  refinementCard.querySelector('p').textContent = refinementMeetingTitle
    ? `${title} - ${refinementMeetingTitle}`
    : title;
  refinementPercent.textContent = '100%';
  refinementBar.style.transform = 'scaleX(1)';
  Object.assign(refinementCard.dataset, { completed: 100, total: 100, complete: 'true' });
  syncTaskCardStack(refinementCard);
  finishTaskCard(refinementCard);
  refinementDismissTimer = setTimeout(hideRefinementProgress, 10000);
}
function hideRefinementProgress(dismissActiveTask = false) {
  if (dismissActiveTask && refinementCard.dataset.complete !== 'true')
    refinementCardDismissed = true;
  dismissTaskCard(refinementCard, () => {
    refinementCard.hidden = true;
    refinementCard.classList.remove('task-card-leave');
  });
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
    card.innerHTML = `<header class="task-card-heading"><span class="task-kind-icon">${interfaceIcon('translate')}</span><p></p>${taskCardControls()}</header><strong></strong><div class="task-card-progress"><div class="processing-bar" aria-hidden="true"><i></i></div></div>`;
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? completed / total : 0;
  card.querySelector('p').textContent = t('正在翻译字幕');
  card.querySelector('strong').innerHTML = renderTaskProgressLabel(
    BreviaI18n.languageName(locale, targetLanguage),
    Math.round(ratio * 100),
  );
  card.querySelector('i').style.transform = `scaleX(${ratio})`;
  Object.assign(card.dataset, { completed, total });
  syncTaskCardStack(card);
  if (completed === total) translationDismissTimer = setTimeout(() => dismissTaskCard(card), 10000);
}
const summaryTaskCopy = window.BreviaLocaleData.appCopy.summaryTaskCopy;

function summaryTaskLabel(stage) {
  const copy = summaryTaskCopy[locale] || summaryTaskCopy.en;
  return (
    {
      'summary.prepare': copy[1],
      'summary.generating': copy[2],
      'summary.saving': copy[3],
      'summary.complete': copy[4],
    }[stage] ||
    stage ||
    t('准备中')
  );
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
    card.innerHTML = `<header class="task-card-heading"><span class="task-kind-icon">${interfaceIcon('document')}</span><p></p>${taskCardControls()}</header><strong></strong><div class="task-card-progress"><div class="processing-bar" aria-hidden="true"><i></i></div>${taskPauseControl()}</div>`;
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? Math.min(1, completed / total) : 0;
  card.querySelector('p').textContent =
    stage === 'summary.complete' ? summaryTaskLabel(stage) : t('会议纪要');
  card.querySelector('strong').innerHTML = renderTaskProgressLabel(
    summaryTaskLabel(stage),
    total ? Math.round(ratio * 100) : undefined,
  );
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
    refinementCard.querySelector('p').textContent = refinementMeetingTitle
      ? `${title} - ${refinementMeetingTitle}`
      : title;
    const stage = t(refinementCard.dataset.stage || '准备中');
    refinementPercent.innerHTML = renderTaskProgressLabel(
      refinementMeetingTitle || stage,
      refinementCard.dataset.total === '0'
        ? undefined
        : Math.round(
            (Number(refinementCard.dataset.completed || 0) /
              Number(refinementCard.dataset.total || 1)) *
              100,
          ),
    );
  }
  const summary = document.querySelector('#summary-progress');
  if (summary) {
    const total = Number(summary.dataset.total || 0);
    summary.querySelector('p').textContent =
      summary.dataset.stage === 'summary.complete'
        ? summaryTaskLabel(summary.dataset.stage)
        : t('会议纪要');
    summary.querySelector('strong').innerHTML = renderTaskProgressLabel(
      summaryTaskLabel(summary.dataset.stage),
      total ? Math.round((Number(summary.dataset.completed || 0) / total) * 100) : undefined,
    );
  }
}
async function generateMeetingSummary(meetingId, config = requestConfig(summaryConfig)) {
  if (!meetingId) return;
  if (meetingActive) {
    showToast(t('实时会议中，结束后再生成会议纪要。'));
    return;
  }
  if (summaryGeneratingMeetingId) {
    showToast(t('已有会议纪要正在生成，请稍候。'));
    return;
  }
  if (!config || (config.provider === 'built-in' && !modelPaths.has(config.model))) {
    if (config?.provider === 'built-in')
      queueModelTask('summary.generate', { meeting_id: meetingId }, [config.model]);
    showSummaryConfigCard();
    return;
  }
  pendingModelTasks.delete(`summary.generate:${meetingId}`);
  summaryFeedback = null;
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
    if (summary?.configuration_required) {
      hideSummaryProgress();
      showSummaryConfigCard();
      return;
    }
    if (summary?.cancelled) {
      hideSummaryProgress();
      return;
    }
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
    meeting.summary ||= { data: summary };
    summaryGeneratingMeetingId = undefined;
    if (meetingId === breviaClient.state.selectedMeetingId) applyBackendDetail(meeting);
    dismissTaskCard(document.querySelector('#summary-config-required'));
    showSummaryComplete();
    showToast(t('会议纪要已生成'), undefined, 'success');
  } catch (error) {
    hideSummaryProgress();
    if (isSummaryAuthenticationError(error)) showSummaryConfigCard(error);
    else {
      summaryFeedback = {
        meetingId,
        title: t(
          uiData.detail.summary.markdown ? '纪要生成失败，现有纪要仍保留。' : '纪要生成失败',
        ),
        detail: error.detail || error.message,
        configure: false,
      };
      syncSummaryFeedback();
      if (activeView !== 'detail' || currentMeetingDetail?.id !== meetingId)
        showToast(error.message, undefined, 'error');
    }
  } finally {
    void resumeReadyModelTasks();
  }
}
const requiredModelIds = new Set();
const pendingModelTasks = new Map();
const resumingModelTasks = new Set();
let onboardingModelIds = [];
// 首启选型页是否已经满足「能出字幕」：勾了模型，或本地已经装了模型。由
// updateOnboardingSetup() 维护，供模型选择页「下一步」的守卫使用（见该函数注释）。
let onboardingModelReady = false;
let initializationPromise;
const useChinaModelSource = () =>
  locale === 'zh' && localStorage.getItem('brevia-china-model-source') === 'true';
const modelDownloadPayload = (modelId) => ({
  model_id: modelId,
  ...(useChinaModelSource() ? { source: 'china' } : {}),
});
const chinaModelSourceToggle = () =>
  locale === 'zh'
    ? `<p class="model-source-switch"><label data-tooltip="启用后优先使用 ModelScope，为中国大陆地区提供模型下载加速。"><input type="checkbox" data-china-model-source${useChinaModelSource() ? ' checked' : ''} /><span>国内下载源</span></label></p>`
    : '';
const onboardingCopy = window.BreviaLocaleData.appCopy.onboardingCopy;
const onboardingLanguageCopy = window.BreviaLocaleData.appCopy.onboardingLanguageCopy;
function queueModelTask(task, payload, models) {
  if (!task || (!payload?.meeting_id && !['meeting.start'].includes(task))) return;
  pendingModelTasks.set(`${task}:${payload.meeting_id || 'new'}`, { task, payload, models });
  if (task === 'summary.generate' && currentMeetingDetail?.id === payload.meeting_id) {
    uiData.detail.summary.waitingModels = true;
    renderMeetingDetail();
  }
}
async function resumeReadyModelTasks() {
  for (const [key, pending] of pendingModelTasks) {
    if (resumingModelTasks.has(key) || !pending.models.every((modelId) => modelPaths.has(modelId)))
      continue;
    if (pending.task === 'meeting.refine' && refinementBusyMeetingId) continue;
    if (pending.task === 'summary.generate' && (summaryGeneratingMeetingId || meetingActive))
      continue;
    pendingModelTasks.delete(key);
    resumingModelTasks.add(key);
    try {
      if (pending.task === 'summary.generate') {
        if (currentMeetingDetail?.id === pending.payload.meeting_id)
          uiData.detail.summary.waitingModels = false;
        // 下载前用户选择了本地处理。即使等待期间切换到远程供应商，也只用该本地模型。
        await generateMeetingSummary(pending.payload.meeting_id, {
          provider: 'built-in',
          model: pending.models[0],
          format: summaryProviderPresets['built-in'].format,
        });
      } else if (pending.task === 'meeting.refine') {
        await requestRefinement(pending.payload);
      } else if (pending.task === 'meeting.reconfigure') {
        // 仅在此会议仍是实时会议时重试；已停止的会议无法重新配置。
        if (breviaClient?.state.meeting?.id === pending.payload.meeting_id)
          await window.brevia.meeting.reconfigure(pending.payload);
      } else if (pending.task === 'meeting.start') {
        const { inputs, ...payload } = pending.payload;
        const meeting = await breviaClient.start(payload, inputs);
        if (meeting?.model_required)
          queueModelTask('meeting.start', pending.payload, meeting.model_required);
        else activateMeeting(meeting, payload);
      }
    } catch (error) {
      if (
        pending.task === 'meeting.refine' &&
        refinementCard.dataset.meetingId === pending.payload.meeting_id
      )
        hideRefinementProgress();
      showToast(error.message, undefined, 'error');
    } finally {
      resumingModelTasks.delete(key);
    }
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
const pendingModelProgress = new Set();
function scheduleModelLibraryRender(modelId) {
  if (activeModal !== 'models') return;
  pendingModelProgress.add(modelId);
  if (modelLibraryRenderFrame) return;
  modelLibraryRenderFrame = requestAnimationFrame(() => {
    modelLibraryRenderFrame = undefined;
    for (const id of pendingModelProgress) refreshModelCardProgress(id);
    pendingModelProgress.clear();
  });
}

/** 只有开始或结束传输才更换卡片操作。进度、暂停与继续保留原按钮和展开状态。 */
function refreshModelCardProgress(modelId) {
  if (activeModal !== 'models') return;
  const row = settingsModal.querySelector(`[data-model-card="${CSS.escape(modelId)}"]`);
  if (!row) return;
  const progress = modelDownloads.get(modelId);
  if (row.querySelector('.model-transfer') && progress && !progress.cancelled && !progress.error)
    updateModelTransfer(row, progress);
  else renderModelLibrary();
}

function updateModelTransfer(row, progress) {
  const transfer = row.querySelector('.model-transfer');
  const bar = transfer.querySelector('progress');
  const percent = progress.total
    ? Math.min(100, Math.round((100 * progress.received) / progress.total))
    : undefined;
  if (percent === undefined) bar.removeAttribute('value');
  else bar.value = percent;
  transfer.querySelector('[data-transfer-quantity]').textContent =
    percent === undefined
      ? ''
      : `${formatBytes(progress.received)} / ${formatBytes(progress.total)} · ${percent}%`;

  const state = progress.cancelling ? 'cancelling' : progress.paused ? 'paused' : 'downloading';
  if (transfer.dataset.state === state) return;
  transfer.dataset.state = state;
  const label =
    state === 'downloading'
      ? (modelLabels[locale] || modelLabels.en).downloading
      : t(state === 'paused' ? '暂停' : '正在取消');
  bar.setAttribute('aria-label', label);
  transfer.querySelector('[data-transfer-state]').textContent = label;
  const pause = row.querySelector('[data-pause-required]');
  const cancel = row.querySelector('[data-cancel-required]');
  pause.disabled = cancel.disabled = state === 'cancelling';
  pause.title =
    t(progress.paused ? '继续' : '暂停') +
    ' · ' +
    row.querySelector('.model-library-headline').textContent;
  pause.setAttribute('aria-label', pause.title);
  pause.innerHTML = interfaceIcon(progress.paused ? 'play' : 'pause');
}
let dismissedModelDownloadIds = [];
function renderModelDownloadQueue() {
  let card = document.querySelector('#model-download-queue');
  const entries = [...modelDownloads.entries()];
  // 关闭只隐藏当前下载；纯进度更新不能重新弹出，新任务仍会展示。
  if (entries.length && entries.every(([id]) => dismissedModelDownloadIds.includes(id))) return;
  dismissedModelDownloadIds = [];
  if (!entries.length) {
    dismissTaskCard(card);
    return;
  }
  if (!card) {
    card = document.createElement('aside');
    card.id = 'model-download-queue';
    card.className = 'processing-card required-models-card';
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const total = entries.reduce((sum, [id, progress]) => sum + (progress.total || modelSize(id)), 0);
  const received = entries.reduce(
    (sum, [id, progress]) =>
      sum + Math.min(progress.received || 0, progress.total || modelSize(id)),
    0,
  );
  const ratio = total ? received / total : 0;
  Object.assign(card.dataset, { completed: received, total });
  const heading = entries.some(([id]) => requiredModelIds.has(id))
    ? t('需要下载以下模型')
    : t('模型下载队列');
  // 只有条目或按钮状态变化时才重建 DOM。进度每秒刷新数十次，若每次都重建，
  // 会在 mousedown 与 mouseup 之间销毁按钮，click 永远无法触发，卡片看似点不动。
  const signature = JSON.stringify(
    entries
      .map(([id, progress]) => [
        id,
        !!progress.error,
        !!progress.cancelled,
        !!progress.cancelling,
        !!progress.paused,
      ])
      .concat([[heading]]),
  );
  if (card.dataset.signature !== signature) {
    card.dataset.signature = signature;
    const scrollTop = card.querySelector('ul')?.scrollTop || 0;
    card.innerHTML = `<header class="task-card-heading"><span class="task-kind-icon">${interfaceIcon('download')}</span><p>${heading} · ${entries.length}</p>${taskCardControls()}</header><div class="processing-bar" aria-hidden="true"><i style="transform:scaleX(${ratio})"></i></div><ul>${entries
      .map(([id, progress]) => {
        const itemRatio = progress.total ? Math.min(1, progress.received / progress.total) : 0;
        const status = progress.error
          ? `<small class="download-error">${t('下载失败')}</small><p class="download-error-detail">${escapeHtml(progress.error)}</p>`
          : progress.cancelled
            ? ''
            : `<small>${progress.cancelling ? t('正在取消') : progress.paused ? t('暂停') : progress.total ? `${Math.round(itemRatio * 100)}%` : t('准备中')}</small>`;
        const action =
          progress.error || progress.cancelled
            ? `<button type="button" data-download-required="${id}">${t(progress.error ? '重试' : '下载')}</button><button class="task-card-close" type="button" data-cancel-required="${id}" aria-label="${t('取消')}">${interfaceIcon('close')}</button>`
            : progress.cancelling
              ? ''
              : `<button class="task-card-close" type="button" data-pause-required="${id}" aria-label="${progress.paused ? t('继续') : t('暂停')}">${interfaceIcon(progress.paused ? 'play' : 'pause')}</button><button class="task-card-close" type="button" data-cancel-required="${id}" aria-label="${t('取消')}">${interfaceIcon('close')}</button>`;
        return `<li><span><b title="${escapeHtml(modelDisplayName(id))}">${escapeHtml(modelDisplayName(id))}</b>${status}</span><span class="model-actions">${action}</span><div class="processing-bar" aria-hidden="true"><i style="transform:scaleX(${itemRatio})"></i></div></li>`;
      })
      .join('')}</ul>`;
    card.querySelector('ul').scrollTop = scrollTop;
    syncTaskCardStack();
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
      if (small)
        small.textContent = progress.total ? `${Math.round(itemRatio * 100)}%` : t('准备中');
    }
  });
  syncTaskCardStack();
}
function renderRequiredModelsCard() {
  [...requiredModelIds]
    .filter((id) => modelPaths.has(id))
    .forEach((id) => requiredModelIds.delete(id));
  renderModelDownloadQueue();
}
async function cancelModelDownload(modelId) {
  const progress = modelDownloads.get(modelId);
  if (!progress || progress.cancelling) return;
  modelDownloads.set(modelId, { ...progress, cancelling: true });
  renderRequiredModelsCard();
  refreshModelCardProgress(modelId);
  try {
    await window.brevia?.models.cancel({ model_id: modelId });
  } catch (error) {
    const pending = modelDownloads.get(modelId);
    if (pending?.cancelling) modelDownloads.set(modelId, { ...pending, cancelling: false });
    renderRequiredModelsCard();
    refreshModelCardProgress(modelId);
    showToast(error.message, undefined, 'error');
  }
}
async function downloadRequiredModel(modelId) {
  dismissedModelDownloadIds = [];
  if (modelPaths.has(modelId)) {
    requiredModelIds.delete(modelId);
    renderRequiredModelsCard();
    return;
  }
  if (
    modelDownloads.has(modelId) &&
    !modelDownloads.get(modelId).error &&
    !modelDownloads.get(modelId).paused &&
    !modelDownloads.get(modelId).cancelled
  )
    return;
  if (
    !modelDownloads.has(modelId) ||
    modelDownloads.get(modelId).error ||
    modelDownloads.get(modelId).cancelled
  )
    modelDownloads.set(modelId, { received: 0, total: 0 });
  renderRequiredModelsCard();
  refreshModelCardProgress(modelId);
  try {
    await window.brevia?.models.download(modelDownloadPayload(modelId));
  } catch (error) {
    modelDownloads.set(modelId, { error: error.message });
    renderRequiredModelsCard();
    refreshModelCardProgress(modelId);
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
  card.innerHTML = `<header class="task-card-heading"><span class="task-kind-icon">${interfaceIcon('document')}</span><p>${(onboardingCopy[locale] || onboardingCopy.en).ready}</p>${taskCardControls()}</header>`;
  window.setTimeout(() => dismissTaskCard(card), 10000);
}
taskCards.addEventListener('click', (event) => {
  const backCard = event.target.closest('.is-task-card-back');
  if (
    backCard &&
    !event.target.closest('.task-card-actions, .model-actions, .mini-playback-controls')
  ) {
    activateTaskCard(backCard);
    return;
  }
  const taskPause = event.target.closest('[data-pause-task]');
  if (taskPause) {
    const card = taskPause.closest('.processing-card');
    const task = card.dataset.task;
    const meetingId = card.dataset.meetingId;
    if (!task || !meetingId) return;
    const paused = card.dataset.paused === 'true';
    taskPause.disabled = true;
    void window.brevia.task[paused ? 'resume' : 'pause']({ task, meeting_id: meetingId })
      .catch((error) => showToast(error.message, undefined, 'error'))
      .finally(() => {
        taskPause.disabled = false;
      });
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
      if (task && meetingId)
        void window.brevia.task
          .cancel({ task, meeting_id: meetingId })
          .catch((error) => showToast(error.message, undefined, 'error'));
    } else {
      if (card?.id === 'summary-progress') clearTimeout(summaryDismissTimer);
      if (card?.id === 'summary-config-required') clearTimeout(summaryConfigDismissTimer);
      // 关闭下载队列对于已取消/失败的模型是终结性的：删除它们，以便卡片无法
      // 重新浮现（并且库无法一直停留在"下载中"）。正在进行的下载继续运行。
      if (card?.id === 'model-download-queue') {
        for (const [modelId, progress] of modelDownloads) {
          if (progress.cancelled || progress.error) {
            modelDownloads.delete(modelId);
            requiredModelIds.delete(modelId);
          }
        }
        dismissedModelDownloadIds = [...modelDownloads.keys()];
        if (activeModal === 'models') renderModal('models');
      }
      dismissTaskCard(card);
    }
    return;
  }
  const one = event.target.closest('[data-download-required]');
  if (one) {
    void downloadRequiredModel(one.dataset.downloadRequired);
    return;
  }
  const pause = event.target.closest('[data-pause-required]');
  if (pause) {
    const modelId = pause.dataset.pauseRequired;
    const progress = modelDownloads.get(modelId);
    if (progress?.paused) void downloadRequiredModel(modelId);
    else
      void window.brevia?.models
        .pause({ model_id: modelId })
        .catch((error) => showToast(error.message, undefined, 'error'));
    return;
  }
  const cancel = event.target.closest('[data-cancel-required]');
  if (cancel) void cancelModelDownload(cancel.dataset.cancelRequired);
});
taskCards.addEventListener('keydown', (event) => {
  const card = event.target.closest('.is-task-card-back');
  if (card && event.target === card && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    activateTaskCard(card);
  }
});
/** 选择音频只更新表单；导入按钮沿用原来的导入和精修流程。 */
function renderImportAudioSelection() {
  const row = prepareForm.querySelector('.audio-import-selection');
  prepareForm
    .querySelector('.audio-dropzone')
    .classList.toggle('has-file', Boolean(importAudioSelection));
  const error = prepareForm.querySelector('[data-prepare-error]');
  if (importAudioSelection) {
    error.hidden = true;
    error.textContent = '';
  }
  row.hidden = !importAudioSelection;
  row.querySelector('[data-import-audio-name]').textContent = importAudioSelection?.name || '';
  row.querySelector('[data-import-audio-size]').textContent = importAudioSelection
    ? formatBytes(importAudioSelection.size)
    : '';
}
async function selectImportAudio(file) {
  const button = prepareForm.querySelector('[data-select-import-audio]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const selection = await window.brevia.meeting.selectAudio(file);
    if (selection) {
      const date = prepareForm.querySelector('[name="meeting-date"]');
      if (date && importAudioSelection && importAudioSelection.path !== selection.path)
        date.value = '';
      importAudioSelection = selection;
      renderImportAudioSelection();
    }
  } catch (error) {
    const message = t(error.detail || error.message);
    const errorNode = prepareForm.querySelector('[data-prepare-error]');
    errorNode.textContent = message;
    errorNode.hidden = false;
    showToast(message);
  } finally {
    button.disabled = false;
  }
}
const audioDropzone = prepareForm.querySelector('.audio-dropzone');
window.brevia?.on('native.drop', ({ path }) => {
  if (activeView === 'prepare' && prepareView.dataset.mode === 'import')
    void selectImportAudio(path);
});
audioDropzone.addEventListener('click', (event) => {
  if (!event.target.closest('button')) void selectImportAudio();
});
audioDropzone.addEventListener('keydown', (event) => {
  if (event.target === audioDropzone && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    void selectImportAudio();
  }
});
audioDropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  audioDropzone.classList.add('is-dragging');
});
audioDropzone.addEventListener('dragleave', (event) => {
  if (!audioDropzone.contains(event.relatedTarget)) audioDropzone.classList.remove('is-dragging');
});
audioDropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  audioDropzone.classList.remove('is-dragging');
  if (event.dataTransfer.files.length) void selectImportAudio(event.dataTransfer.files[0]);
});
/** 下拉使用视口坐标，避开表单滚动区裁切并在空间不足时向上展开。 */
function fitFlowSelectOptions(options, toggle, minimumWidth = 160, maximumHeight = 256) {
  if (options.hidden) return;
  const value = toggle.closest('.flow-select')?.querySelector('input[type="hidden"]')?.value;
  options.querySelectorAll('[data-value]').forEach((choice) => {
    choice.toggleAttribute('aria-current', choice.dataset.value === value);
    if (choice.getAttribute('role') === 'option')
      choice.setAttribute('aria-selected', String(choice.dataset.value === value));
  });
  const anchor = toggle.getBoundingClientRect();
  const available = Math.max(anchor.top - 12, innerHeight - anchor.bottom - 12);
  options.classList.add('is-floating');
  options.style.width = `${Math.min(Math.max(anchor.width, minimumWidth), innerWidth - 24)}px`;
  options.style.maxHeight = `${Math.min(maximumHeight, Math.max(80, available))}px`;
  options.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - options.offsetWidth - 12))}px`;
  options.style.top = `${anchor.bottom + options.offsetHeight + 12 <= innerHeight ? anchor.bottom + 4 : Math.max(12, anchor.top - options.offsetHeight - 4)}px`;
}
document.addEventListener('click', (event) => {
  for (const list of document.querySelectorAll('.flow-select-options.is-floating:not([hidden])')) {
    if (!list.closest('.flow-select').contains(event.target)) {
      list.hidden = true;
      list
        .closest('.flow-select')
        .querySelector('[data-flow-select-toggle]')
        ?.setAttribute('aria-expanded', 'false');
    }
  }
});
document.addEventListener(
  'scroll',
  (event) => {
    for (const list of document.querySelectorAll(
      '.flow-select-options.is-floating:not([hidden])',
    )) {
      const select = list.closest('.flow-select');
      // 字幕自动跟随等无关滚动不移动锚点，不能关闭用户正在操作的菜单。
      if (event.target.contains?.(select)) {
        list.hidden = true;
        select.querySelector('button')?.setAttribute('aria-expanded', 'false');
      }
    }
  },
  true,
);
prepareForm.addEventListener('click', (event) => {
  if (event.target.closest('[data-select-import-audio]')) {
    void selectImportAudio();
    return;
  }
  if (event.target.closest('[data-clear-import-audio]')) {
    const date = prepareForm.querySelector('[name="meeting-date"]');
    if (date) date.value = '';
    importAudioSelection = null;
    renderImportAudioSelection();
    return;
  }
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) {
    const options = toggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    const captureMode = toggle.closest('.capture-mode-select');
    // 打开麦克风设备下拉前刷新设备列表(插拔后保持最新),就地更新不会打断展开状态。
    if (opening && toggle.closest('#mic-device-mount')) void refreshMicDevices();
    prepareForm.querySelectorAll('.flow-select-options').forEach((list) => {
      const trigger = list.closest('.flow-select').querySelector('.flow-select-toggle');
      if (trigger.hidden) return;
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    });
    captureMode?.classList.remove('opens-upward');
    options.hidden = !opening;
    fitFlowSelectOptions(options, toggle);
    if (opening && captureMode && options.getBoundingClientRect().bottom > window.innerHeight)
      captureMode.classList.add('opens-upward');
    toggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const choice = event.target.closest('[data-flow-select-choice]');
  if (!choice || choice.disabled) return;
  const select = choice.closest('.flow-select');
  if (
    choice.dataset.flowSelectChoice === 'meeting-workspace' &&
    choice.dataset.value === '__new_workspace__'
  ) {
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
    showNewWorkspaceDialog(
      null,
      (workspace) => {
        prepareForm.querySelector('[name="meeting-workspace"]').value = workspace.id;
        renderPrepareSelects();
      },
      select.querySelector('.flow-select-toggle'),
    );
    return;
  }
  select.querySelector('input').value = choice.dataset.value;
  select.querySelector('.flow-select-toggle').firstChild.nodeValue =
    choice.dataset.label || choice.textContent;
  select.querySelector('.flow-select-options').hidden = true;
  select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
  if (choice.dataset.flowSelectChoice === 'meeting-language') {
    applyLanguageModelDefaults(choice.dataset.value);
    renderPrepareSelects();
  }
  if (choice.dataset.flowSelectChoice === 'refined-model') {
    // 只有用户主动改选才写入偏好；系统按语言做的回退不写（否则回退值会静默覆盖偏好，
    // 与 OpenWhispr #1288「浏览 picker 改掉了选择」同源）。见设计文档 §5.1。
    rememberPreferredModel(choice.dataset.value);
  }
  if (choice.dataset.flowSelectChoice === 'capture-mode') renderCaptureMode(choice.dataset.value);
  if (choice.dataset.flowSelectChoice === 'phone-device') {
    selectedPhoneDeviceId = choice.dataset.value;
    renderCaptureMode();
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
  const recommendedWord =
    (asrCopy.recommended || {})[locale] || (asrCopy.recommended || {}).en || '';
  const options = installed.map((model) => [
    model.id,
    model.name,
    model.id === RECOMMENDED_BUILTIN_MODEL_ID ? recommendedWord : '',
  ]);
  const selected = installed.find((model) => model.id === currentModelId) || installed[0];
  const progress = modelDownloads.get(selected.id);
  const inFlight = progress && !progress.error && !progress.cancelled;
  const labels = modelLabels[locale] || modelLabels.en;
  const downloadAction =
    allowDownload && !modelPaths.has(selected.id)
      ? `<button class="modal-action" type="button" data-download-model="${escapeHtml(selected.id)}"${inFlight ? ' disabled' : ''}>${interfaceIcon('download')}${escapeHtml(inFlight ? labels.downloading : labels.download)} · ${formatBytes(selected.size_bytes || 0)}</button>` +
        (progress?.error
          ? `<p class="summary-model-hint">${escapeHtml(progress.error)}</p>`
          : inFlight && progress.total
            ? `<p class="summary-model-hint">${Math.round(Math.min(1, progress.received / progress.total) * 100)}%</p>`
            : '')
      : '';
  const intro =
    builtinModelIntro[selected.id]?.[locale] || builtinModelIntro[selected.id]?.en || '';
  return (
    `<section class="preferences-model-picker">${renderPreferenceRow('本地模型', intro, desktopSelect('model', selected.id, options))}<div class="preferences-model-details">` +
    `<div class="preferences-model-footer">${renderModelLibraryRatings(selected)}` +
    (allowDownload
      ? downloadAction +
        (settingsModal.classList.contains('settings-page')
          ? `<button class="text-button" type="button" data-open-models-from-config>${escapeHtml(t('管理模型库'))}</button>`
          : '')
      : `<button class="text-button" type="button" data-open-models-from-config>${escapeHtml(t('管理模型库'))}</button>`) +
    '</div></div></section>' +
    (allowDownload
      ? ''
      : `<p class="summary-model-hint">${escapeHtml(hint || copy.builtinHint)}</p>`)
  );
}
/** 一个内置模型都没装时的空状态：不留死路，直接给去模型库的路。@param {string} storedModelId 配置里记着的模型 id（回填用，可能未安装）。@returns {string} 空状态标记。 */
function builtinModelEmptyState(storedModelId) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  return (
    `<input type="hidden" name="model" value="${escapeHtml(storedModelId)}" />` +
    `<div class="preferences-model-empty"><p class="summary-model-hint">${escapeHtml(t('还没有下载内置 AI 模型。'))}</p>` +
    `<button class="modal-action" type="button" data-open-models-from-config>${escapeHtml(t('管理模型库'))}</button></div>` +
    `<p class="summary-model-hint">${escapeHtml(copy.builtinHint)}</p>`
  );
}
/** 渲染纪要模型配置表单：单选供应商 + 按供应商条件显示的字段。@returns {string} */
function renderModelConfigFields(config, selectedModel, { required = true, hint } = {}) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const provider = config.provider;
  const preset = summaryProviderPresets[provider];
  const entry = providerEntry(config, provider);
  const isBuiltin = provider === 'built-in';

  const providerOptions = summaryProviders
    .filter((id) => !settingsModal.classList.contains('settings-page') || id !== 'built-in')
    .map((id) => [id, id === 'built-in' ? t('本地模型') : summaryProviderLabel(id)]);
  const page = settingsModal.classList.contains('settings-page');
  const providerField =
    page && isBuiltin
      ? '<input type="hidden" name="provider" value="built-in" />'
      : renderPreferenceRow(
          copy.provider,
          '',
          desktopSelect('provider', provider, providerOptions),
        );
  let fields = '';
  let builtinModelList = '';
  let currentModelId = '';
  if (isBuiltin) {
    const installed = modelCatalog.filter(
      (model) =>
        model.kind === 'llama-chat' &&
        (onboardingBuiltinProvider ||
          settingsModal.classList.contains('settings-page') ||
          modelPaths.has(model.id)),
    );
    const stored = modelPaths.has(entry.model) ? entry.model : '';
    currentModelId = installed.some((model) => model.id === selectedModel)
      ? selectedModel
      : stored ||
        (onboardingBuiltinProvider &&
          installed.find((model) => model.id === RECOMMENDED_BUILTIN_MODEL_ID)?.id) ||
        installed.find((model) => modelPaths.has(model.id))?.id ||
        installed[0]?.id ||
        '';
    builtinModelList = installed.length
      ? builtinModelPicker(
          currentModelId,
          installed,
          hint,
          onboardingBuiltinProvider || settingsModal.classList.contains('settings-page'),
        )
      : builtinModelEmptyState(stored);
  } else {
    // 固定供应商的请求地址由代码派生，只有自定义供应商才让用户填写。
    const requiredAttr = required ? ' required' : '';
    const endpointField = preset.needsEndpoint
      ? `<label class="preference-row preference-field"><span class="preference-copy">${copy.endpoint}</span><span class="preference-control"><input name="endpoint" value="${escapeHtml(entry.endpoint || '')}" type="url" placeholder="${escapeHtml(copy.endpointPlaceholder)}"${requiredAttr} /></span></label>`
      : '';
    // maxlength 对齐主进程的 zod 上限（model 128、keyLength 512），否则超长值要到
    // 主进程才被拒，用户只会看到一句无从下手的「操作失败」。
    const keyField = `<label class="preference-row preference-field"><span class="preference-copy">${copy.key}</span><span class="preference-control secret-field"><input name="apiKey" type="password" autocomplete="new-password" maxlength="512" value="${escapeHtml(modelConfigSecrets.get(config)?.[provider] || '')}" placeholder="${entry.keyReference ? '•'.repeat(entry.keyLength || 8) : ''}"${entry.keyReference || !required ? '' : ' required'} /><button class="icon-button" type="button" data-toggle-secret aria-label="${escapeHtml(t('显示或隐藏 API Key'))}" aria-pressed="false">${interfaceIcon('eye')}</button></span></label>`;
    const modelField = `<label class="preference-row preference-field"><span class="preference-copy">${copy.model}</span><span class="preference-control"><input name="model" value="${escapeHtml(entry.model ?? preset.model)}" maxlength="128" placeholder="${escapeHtml(preset.model)}"${requiredAttr} /></span></label>`;
    fields = `${endpointField}${keyField}${modelField}`;
  }

  return {
    markup: `<section class="preferences-model-connection"><div class="preferences-form-fields config-fields">${providerField}${fields}</div>${builtinModelList}<p class="preferences-privacy-note onboarding-privacy-hint">${interfaceIcon('info')}${escapeHtml(t(isBuiltin ? '本地模型在此设备上运行。' : '在线 AI 会将相关文字发送至所选服务商。'))}</p></section>`,
    saveDisabled: required && isBuiltin && !modelPaths.has(currentModelId),
  };
}
function renderModelConfigForm(config, formClass, selectedModel) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const fields = renderModelConfigFields(config, selectedModel);
  const state = JSON.stringify(config) === JSON.stringify(summaryConfig) ? 'saved' : 'dirty';
  return `<form class="${formClass} preferences-form">${fields.markup}<footer class="preferences-form-footer modal-form-actions">${renderSaveState(state)}<button class="secondary" type="button" data-cancel-model-config>${escapeHtml(t('取消'))}</button><button class="modal-action" type="submit"${fields.saveDisabled ? ' disabled' : ''}>${copy.save}</button></footer></form>`;
}
function renderSummaryModelForm() {
  return renderModelConfigForm(
    summaryConfigDraft || summaryConfig,
    'summary-model-form',
    selectedBuiltinModel,
  );
}
/** 示例取自本地首启演示，两种功能可在同一段会议上对照。 */
function renderAiSettingsExample(active) {
  const live = active === 'ai-assist';
  const mode = live ? aiAssistConfigDraft?.proactivity || 'assist' : 'summary';
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  const liveSample = aiOnboardingDemoCopy[locale] || aiOnboardingDemoCopy.en;
  const summary = aiOnboardingSummaryDemoCopy[locale] || aiOnboardingSummaryDemoCopy.en;
  const title = t(live ? 'AI 笔记' : '会议纪要');
  const state = mode === 'quiet' ? 'request' : mode === 'assist' ? 'suggested' : 'written';
  const line = (time, quote) =>
    `<div class="ai-example-turn"><time>${time}</time><p>${escapeHtml(quote)}</p></div>`;
  const fact = (icon, label, content) =>
    `<div class="ai-example-fact">${interfaceIcon(icon)}<div><small>${escapeHtml(label)}</small><p>${escapeHtml(content)}</p></div></div>`;
  const takeNote = live
    ? `<div class="ai-example-note-actions">
    <button data-ai-example-action="request" type="button">${interfaceIcon('ai')}${escapeHtml(t('请求 AI 建议'))}</button>
    <button data-ai-example-action="accept" type="button">${interfaceIcon('plus')}${escapeHtml(t('加入笔记'))}</button>
    <span data-example-saved tabindex="-1">${interfaceIcon('check')}${escapeHtml(t('已加入笔记'))}</span></div>`
    : '';
  return `<section class="ai-settings-example" data-ai-example="${active}" data-stage="${state}" data-initial-stage="${state}" aria-label="${escapeHtml(title + ' · ' + t('演示'))}">
    <header><h3>${escapeHtml(live ? copy.during : copy.after)}<span>·</span>${escapeHtml(t('演示'))}</h3></header>
    <div class="ai-example-scene">
      <div class="ai-example-source"><h4>${interfaceIcon('waveform')}${escapeHtml(t(live ? '实时转写' : '逐字稿'))}</h4>
      ${line('00:12', liveSample.transcriptText)}${!live ? line('00:24', liveSample.scenes.quiet[1][2].replace(/^[•*-]\s*/, '')) : ''}</div>
      <span class="ai-example-flow" aria-hidden="true">${interfaceIcon('arrow-right')}</span>
      <div class="ai-example-result"><h4>${interfaceIcon(live ? 'notebook' : 'document')}${escapeHtml(title)}</h4>
      <div class="ai-example-output">${live ? `<p class="ai-example-note">${escapeHtml(liveSample.scenes.quiet[0][2].replace(/^[•*-]\s*/, ''))}</p>` : fact('check', t('决定'), summary.decision) + fact('checkbox', t('待办'), summary.actions[0])}</div>${takeNote}</div>
    </div></section>`;
}
/** 由预览自身的 CSS 循环推动阶段；换页、隐藏或减少动态效果时没有后台定时器。 */
function advanceAiSettingsExample(example) {
  const stage = example.dataset.stage;
  example.dataset.stage =
    stage === 'request'
      ? 'suggested'
      : stage === 'suggested'
        ? 'written'
        : example.dataset.initialStage;
}
settingsModal.addEventListener('animationiteration', (event) => {
  const example = event.target.closest('[data-ai-example="ai-assist"]');
  if (
    example &&
    event.target.matches('.ai-example-turn') &&
    event.animationName === 'ai-example-transcript' &&
    !example.matches(':focus-within')
  )
    advanceAiSettingsExample(example);
});
function operateAiSettingsExample(button) {
  const example = button.closest('[data-ai-example]');
  const request = button.dataset.aiExampleAction === 'request';
  example.dataset.stage = request ? 'suggested' : 'written';
  example
    .querySelector(request ? '[data-ai-example-action="accept"]' : '[data-example-saved]')
    .focus({ preventScroll: true });
}
function renderAiSettingsTabs(active) {
  return settingsModal.classList.contains('settings-page')
    ? `<nav class="preferences-tabs settings-tabs" aria-label="${escapeHtml(t('AI 功能'))}"><button type="button" data-ai-settings-tab="summary-model" aria-selected="${active === 'summary-model'}">${t('会议纪要')}</button><button type="button" data-ai-settings-tab="ai-assist" aria-selected="${active === 'ai-assist'}">${t('AI 笔记')}</button></nav>${renderAiSettingsExample(active)}`
    : '';
}
function renderAiServiceChoice(config) {
  return `<fieldset class="preferences-choice-row"><legend>${t('服务方式')}</legend><div class="preference-copy" aria-hidden="true">${t('服务方式')}</div><div class="preferences-choice-options"><label><input type="radio" name="ai-service-way" value="built-in"${config.provider === 'built-in' ? ' checked' : ''} />${t('本地模型')}</label><label><input type="radio" name="ai-service-way" value="online"${config.provider !== 'built-in' ? ' checked' : ''} />${t('在线服务')}</label></div></fieldset>`;
}
/** 同页刷新保留阅读位置与展开状态；换页才复位，不能把刷新当作重新打开。 */
function replaceModalBody(kind, markup) {
  settingsModal.querySelector('.modal-title > .summary-enabled-control')?.remove();
  const body = settingsModal.querySelector('.modal-body');
  const panel = settingsModal.querySelector('.modal-panel');
  const same = !settingsModal.hidden && body.dataset.contentKind === kind;
  const scrollTop = body.scrollTop;
  const panelScrollTop = panel.scrollTop;
  const modalScrollTop = settingsModal.scrollTop;
  const scrollers = [
    '.model-library-list',
    '.speaker-directory',
    '.speaker-profile-detail',
    '.speaker-profile-list',
  ];
  const scrolls = scrollers.map((selector) => {
    const node = body.querySelector(selector);
    return [node?.scrollTop || 0, node?.scrollLeft || 0];
  });
  const details = [...body.querySelectorAll('details')].map((node, index) => [
    node.dataset.modalDetail || node.id || `${node.className}:${index}`,
    node.open,
  ]);
  const focused = body.contains(document.activeElement) ? document.activeElement : null;
  const focusAttribute =
    focused &&
    [...focused.attributes].find(
      (attribute) =>
        attribute.value &&
        (attribute.name === 'id' ||
          attribute.name === 'name' ||
          attribute.name.startsWith('data-')),
    );
  body.innerHTML = settingsModal.classList.contains('settings-page')
    ? `<div class="preferences-page-content">${markup}</div>`
    : markup;
  body.dataset.contentKind = kind;
  if (!same) {
    body.scrollTop = 0;
    panel.scrollTop = 0;
    settingsModal.scrollTop = 0;
    if (settingsModal.classList.contains('settings-page')) BreviaMotion.enter(body, 'sibling');
    return;
  }
  const expanded = new Map(details);
  body.querySelectorAll('details').forEach((node, index) => {
    const key = node.dataset.modalDetail || node.id || `${node.className}:${index}`;
    if (expanded.has(key)) node.open = expanded.get(key);
  });
  scrollers.forEach((selector, index) => {
    const node = body.querySelector(selector);
    if (node) {
      node.scrollTop = scrolls[index][0];
      node.scrollLeft = scrolls[index][1];
    }
  });
  if (focusAttribute) {
    const matches = body.querySelectorAll(
      `[${focusAttribute.name}="${CSS.escape(focusAttribute.value)}"]`,
    );
    if (matches.length === 1 && !matches[0].disabled) matches[0].focus({ preventScroll: true });
  }
  body.scrollTop = scrollTop;
  panel.scrollTop = panelScrollTop;
  settingsModal.scrollTop = modalScrollTop;
}
function renderSummaryModelModal() {
  summaryConfigDraft ||= structuredClone(summaryConfig);
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const page = settingsModal.classList.contains('settings-page');
  settingsModal.querySelector('.modal-title h2').textContent = page ? t('AI 功能') : copy.title;
  settingsModal.querySelector('.modal-title p').textContent =
    copy.featureIntro || summaryModelCopy.en.featureIntro;
  replaceModalBody(
    'summary-model',
    `${renderAiSettingsTabs('summary-model')}${page ? '<div class="preferences-ai-panel">' : ''}${onboardingBuiltinProvider || onboardingOnlineProvider ? '' : `<label class="preference-row summary-enabled-control"><span class="preference-copy" title="${escapeHtml(copy.featureIntro || summaryModelCopy.en.featureIntro)}"><b>${t('会后自动生成纪要')}</b></span><span class="preference-control"><input type="checkbox" data-summary-enabled${summaryConfig.enabled ? ' checked' : ''} /></span></label>`}${page ? renderAiServiceChoice(summaryConfigDraft) : ''}${renderSummaryModelForm()}${page ? '</div>' : ''}`,
  );
}

/** 渲染「AI 笔记」设置模态框：开关、主动性与独立模型连接。@returns {void} */
function renderAiAssistModal() {
  aiAssistConfigDraft ||= structuredClone(aiAssistConfig);
  const config = aiAssistConfigDraft;
  const page = settingsModal.classList.contains('settings-page');
  settingsModal.querySelector('.modal-title h2').textContent = page ? t('AI 功能') : t('AI 笔记');
  settingsModal.querySelector('.modal-title p').textContent = t(
    '让 AI 在会议中帮你发现重点、提取待办并整理笔记。',
  );
  const levels = ['quiet', 'assist', 'auto']
    .map(
      (value) =>
        `<label class="ai-assist-level${config.proactivity === value ? ' is-selected' : ''}"><input type="radio" name="proactivity" value="${value}"${config.proactivity === value ? ' checked' : ''} /><span>${t({ quiet: '手动', assist: '适度', auto: '主动' }[value])}</span></label>`,
    )
    .join('');
  const warning =
    deviceIsWeak() &&
    config.provider === 'built-in' &&
    /4b/i.test(providerEntry(config).model || '')
      ? `<p class="performance-weak-note">${interfaceIcon('warning')}${escapeHtml(t('本机性能有限，建议使用更小的内置模型（如 2B）或在线 LLM API，以获得更流畅的实时体验。'))}<button class="secondary" data-use-ai-2b type="button">${t('改用 2B AI 笔记模型')}</button></p>`
      : '';
  const fields = renderModelConfigFields(config, selectedAiAssistBuiltinModel, {
    required: config.enabled,
  });
  replaceModalBody(
    'ai-assist',
    `${renderAiSettingsTabs('ai-assist')}${page ? '<div class="preferences-ai-panel">' : ''}<form id="ai-assist-config-form" class="ai-assist-config-form preferences-form"><label class="preference-row summary-enabled-control"><span class="preference-copy" title="${escapeHtml(t('让 AI 在会议中帮你发现重点、提取待办并整理笔记。'))}"><b>${t('AI 笔记')}</b></span><span class="preference-control"><input aria-label="${escapeHtml(t('AI 笔记'))}" type="checkbox" name="enabled" form="ai-assist-config-form" data-ai-settings-enabled${config.enabled ? ' checked' : ''} /></span></label>${renderAiServiceChoice(config)}${fields.markup}<fieldset class="preferences-choice-row"><legend>${t('主动性')}</legend><div class="preference-copy" aria-hidden="true">${t('主动性')}</div><div class="preferences-choice-options">${levels}</div></fieldset>${warning}<footer class="preferences-form-footer modal-form-actions">${renderSaveState(JSON.stringify(config) === JSON.stringify(aiAssistConfig) ? 'saved' : 'dirty')}<button class="secondary" data-cancel-model-config type="button">${t('取消')}</button><button class="modal-action" type="submit"${fields.saveDisabled && config.enabled ? ' disabled' : ''}>${t('保存配置')}</button></footer></form>${page ? '</div>' : ''}`,
  );
  if (!page) {
    const toggle = settingsModal.querySelector('.modal-body .summary-enabled-control');
    toggle.querySelector('span').remove();
    toggle.classList.remove('preference-row');
    settingsModal.querySelector('.modal-title').append(toggle);
  }
}

async function switchAiAssistTo2B() {
  const model = 'qwen3.5-2b-q4km';
  if (!modelPaths.has(model)) {
    showToast(t('请先下载 2B AI 模型。'));
    return false;
  }
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
  showToast(t('AI 笔记已暂时停用。'));
}
let speakerProfileSearch = '';
function renderSpeakerProfileModal() {
  const copy = speakerProfileCopy[locale] || speakerProfileCopy.en;
  const voiceCopy = voiceFeaturesCopy[locale] || voiceFeaturesCopy.en;
  const limits = advancedSettings?.settings?.voice_profiles;
  settingsModal.querySelector('.modal-title h2').textContent = t('声纹管理');
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  const profile =
    speakerProfiles.find((item) => item.id === expandedSpeakerProfileId) || speakerProfiles[0];
  if (profile) expandedSpeakerProfileId = profile.id;
  const samples = profile ? speakerSamples.get(profile.id) || [] : [];
  const name =
    profile &&
    (editingSpeakerProfileId === profile.id
      ? `<form class="speaker-profile-rename-form" data-profile-id="${escapeHtml(profile.id)}"><input name="name" value="${escapeHtml(speakerProfileName(profile))}" maxlength="32" required /><button class="modal-action" type="submit">${t('保存')}</button></form>`
      : `<h2>${escapeHtml(speakerProfileName(profile))}</h2>`);
  const list = speakerProfiles
    .map(
      (item) =>
        `<button type="button" class="speaker-person" data-toggle-speaker-samples="${escapeHtml(item.id)}" aria-pressed="${item.id === profile?.id}"${speakerProfileName(item).toLocaleLowerCase().includes(speakerProfileSearch.toLocaleLowerCase()) ? '' : ' hidden'}>${interfaceIcon('person')}<span><b>${escapeHtml(speakerProfileName(item))}</b><small>${item.sample_count} ${escapeHtml(copy.samples)}</small></span>${interfaceIcon('chevron-right')}</button>`,
    )
    .join('');
  replaceModalBody(
    'speaker-profiles',
    `<div class="preferences-speakers speaker-manager"><aside class="preferences-people speaker-directory"><header class="preferences-people-toolbar"><label class="search">${interfaceIcon('search')}<input type="search" data-speaker-search aria-label="${t('搜索')}" placeholder="${t('搜索')}" value="${escapeHtml(speakerProfileSearch)}" /></label><details class="speaker-create"><summary aria-label="${escapeHtml(copy.add)}" title="${escapeHtml(copy.add)}">${interfaceIcon('plus')}<span>${escapeHtml(copy.add)}</span></summary><form class="speaker-profile-form"><label>${copy.name}<input name="name" maxlength="32" required /></label><button class="modal-action" type="submit">${copy.add}</button></form></details></header><div class="speaker-profile-list">${list || `<p class="page-empty">${t('暂无内容')}</p>`}</div></aside><section class="preferences-person speaker-profile-detail">${profile ? `<header class="speaker-detail-header"><div>${name}<small>${profile.sample_count}${limits ? `/${limits.max_samples}` : ''} ${copy.samples} · ${formatMeetingTime(profile.duration_ms || 0)}${limits ? ` / ${formatMeetingTime(limits.max_total_seconds * 1000)}` : ''}</small></div><div class="speaker-detail-actions"><button class="secondary" data-verify-speaker-profile="${escapeHtml(profile.id)}" type="button">${voiceCopy.verify}</button><button class="secondary" data-rename-speaker-profile="${escapeHtml(profile.id)}" type="button">${t('更改名称')}</button></div></header><section class="preferences-section speaker-add"><form class="preference-row preferences-sample-add speaker-sample-form" data-speaker-profile="${escapeHtml(profile.id)}"><div class="preference-copy"><h3>${copy.addSample}</h3><p>${t('请选择一段清晰的已有录音。')}</p></div><div class="preference-control"><button class="modal-action" type="submit">${t('选择录音并添加')}</button></div></form></section><section class="preferences-section"><header class="preferences-section-heading"><h3>${t('声纹样本')}</h3></header><div class="speaker-sample-list">${samples.length ? samples.map((sample) => `<article><button class="sample-play" data-play-speaker-sample="${escapeHtml(sample.id)}" type="button" aria-label="${t('播放录音')}">${interfaceIcon('play')}</button><input type="range" data-speaker-sample-seek="${escapeHtml(sample.id)}" min="0" max="${(sample.duration_ms || 0) / 1000}" step=".1" value="0" aria-label="${t('播放进度')}" /><time>${formatMeetingTime(sample.duration_ms || 0)}</time><button class="model-delete" data-delete-speaker-sample="${escapeHtml(sample.id)}" data-profile-id="${escapeHtml(profile.id)}" type="button">${copy.remove}</button></article>`).join('') : `<p class="page-empty">${copy.empty}</p>`}</div></section><button class="model-delete" data-delete-speaker-profile="${escapeHtml(profile.id)}" type="button">${copy.remove}</button>` : `<div class="page-empty">${interfaceIcon('person')}<h2>${t('声纹管理')}</h2><p>${copy.intro}</p></div>`}</section></div>`,
  );
}
speakerSampleAudio.addEventListener('timeupdate', () => {
  const id = speakerSampleAudio._button?.dataset.playSpeakerSample;
  const input = [...settingsModal.querySelectorAll('[data-speaker-sample-seek]')].find(
    (item) => item.dataset.speakerSampleSeek === id,
  );
  if (input) input.value = speakerSampleAudio.currentTime;
});

// 社交平台网页分享入口。本地应用没有可公开访问的会议链接,因此只能携带一小段文本;
// 各平台按 limit 截断。仅使用有稳定 https web-intent 的平台,微信等无 API 平台走文件分享。
const shareSocialUrls = {
  weibo: {
    limit: 1800,
    url: (text) => `https://service.weibo.com/share/share.php?title=${encodeURIComponent(text)}`,
  },
  x: {
    limit: 260,
    url: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
  },
  telegram: {
    limit: 1500,
    url: (text) => `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`,
  },
  whatsapp: { limit: 1500, url: (text) => `https://wa.me/?text=${encodeURIComponent(text)}` },
};
// ===== 导出与分享（统一面板）=====
// 导出内容清单：仅包含当前会议实际可用的内容。exportSelection 记录「已勾选内容 -> 所选格式」。
let exportSelection = {};
let exportMarkdownTarget = {};
const exportContentFormats = {
  notes: ['md', 'pdf', 'docx', 'txt'],
  mynotes: ['md', 'pdf', 'docx', 'txt'],
  transcript: ['srt', 'md', 'txt', 'json'],
};
const exportDefaultFormat = { notes: 'md', mynotes: 'md', transcript: 'srt', audio: 'wav' };
const exportTrack = { audio: 'mix' };
const exportContentLabel = {
  notes: () => t('会议纪要'),
  mynotes: () => t('我的笔记'),
  transcript: () => t('逐字稿'),
  audio: () => t('会议录音'),
};
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
    .replace(/^\s*\|(.*)\|\s*$/gm, (_, row) =>
      row
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(' · '),
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function shareTranscriptText() {
  return (uiData.detail.transcript || [])
    .map((row) => `[${row.time}] ${row.speaker.name}: ${row.text}`)
    .join('\n');
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
  while (value && encodeURIComponent(value).length > maxEncoded)
    value = value.slice(0, Math.max(1, Math.floor(value.length * 0.9)));
  if (value && value.length < text.length) value = `${value.trimEnd()}…`;
  return value;
}
// 把当前勾选的内容项交给主进程导出/打包/分享。mode: save 保存对话框, reveal 在文件夹中显示, system 系统分享面板。
async function runExportBundle(mode, anchor) {
  const items = selectedExportItems();
  if (!items.length) throw new Error(t('请先选择要导出的内容'));
  const result = await window.brevia?.meeting.exportBundle({
    meeting_id: currentMeetingDetail.id,
    items,
    mode,
    ...(anchor ? { anchor } : {}),
  });
  return { ...(result || {}), count: result ? items.length : null };
}
// 格式显示名采用实际文件类型的通用名，与 D12 保持一致。
const exportFormatDisplay = {
  md: 'Markdown',
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  srt: 'SRT',
  json: 'JSON',
  wav: 'WAV',
};
// 分享/转发渠道的轻量内联图标。
function sharePlatformIcon(id) {
  const common =
    'viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    system:
      '<path d="M14 6l4 4-4 4"/><path d="M18 10H9"/><path d="M12 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8"/>',
    copy: '<rect x="6" y="6" width="10" height="11" rx="1.5"/><path d="M13 3H5a2 2 0 0 0-2 2v9"/>',
    email: '<rect x="3" y="4.5" width="14" height="11" rx="1.5"/><path d="m3.5 6 6.5 5 6.5-5"/>',
    whatsapp:
      '<path d="M10 3a7 7 0 0 0-6 10.5L3 17l3.6-1A7 7 0 1 0 10 3Z"/><path d="M7.5 7.5c0 3 2.5 5.5 5.5 5.5l.6-1.4-1.6-.8-.6.6a4.6 4.6 0 0 1-1.8-1.8l.6-.6-.8-1.6L7.5 7.5Z"/>',
    telegram:
      '<path d="M17.5 3.5 3 9.2l4.2 1.6 1.7 5 2.5-1.7 3 2.4 3.1-12Z"/><path d="m7.2 10.8 6.8-4.3"/>',
    x: '<path d="m4 4 12 12M16 4 4 16"/>',
    weibo:
      '<path d="M8 12c1-1 3.5-2.5 4.5-1.5 1 .8-1 2-3 2-1.2 0-1.8-.3-1.5-.5Z"/><path d="M13.5 14.5c.5-.8-.8-2.4-1.5-3M7 4c-1.5 2-1.5 6 .5 8 1.6 1.7 4.6 2 6.7.8C16 12 16.5 9.5 15 8c-1-.8-2-.6-2.4-1.5"/>',
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
  settingsModal.querySelector('.modal-title h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = '';
  if (
    settingsModal.hidden ||
    settingsModal.querySelector('.modal-body').dataset.contentKind !== activeModal
  ) {
    const contents = exportContentMeta();
    const summaryOnly =
      activeView === 'detail' &&
      detailActiveTab === 'summary' &&
      contents.some(({ content }) => content === 'notes');
    exportSelection = {};
    contents.forEach(({ content }) => {
      exportSelection[content] =
        summaryOnly && content !== 'notes' ? null : exportDefaultFormat[content];
    });
  }
  replaceModalBody(activeModal, exportHubHtml());
  updateExportBuilderState();
}
// 统一「导出与分享」面板。
function exportHubHtml() {
  const copy = exportHubCopy[locale] || exportHubCopy.en;
  const order = ['mynotes', 'notes', 'transcript', 'audio'];
  const meta = exportContentMeta().sort(
    (a, b) => order.indexOf(a.content) - order.indexOf(b.content),
  );
  meta.forEach(({ content }) => {
    if (!(content in exportSelection)) exportSelection[content] = exportDefaultFormat[content];
  });
  const txt = copy.txt;
  const hasCauseTree = currentMeetingDetail?.summary?.data?.claims?.some(
    (claim) => claim.kind === 'cause',
  );
  const rows = meta
    .map(({ content }) => {
      const label = exportContentLabel[content]();
      const desc = copy.desc[content] || '';
      const graph =
        hasCauseTree && ['notes', 'mynotes'].includes(content)
          ? `<small>${escapeHtml(t('文件含鱼骨图'))}</small>`
          : '';
      const current = exportSelection[content] || exportDefaultFormat[content];
      const currentDisplay = exportFormatDisplay[current] || txt;
      const formatOptions = (exportContentFormats[content] || [])
        .map((format) => {
          const display = exportFormatDisplay[format] || txt;
          return `<button type="button" data-flow-select-choice="export-format-${content}" data-value="${format}">${escapeHtml(display)}</button>`;
        })
        .join('');
      return `<label class="export-content-row${exportSelection[content] ? ' is-checked' : ''}">
      <input type="checkbox" data-export-item="${content}"${exportSelection[content] ? ' checked' : ''}>
      ${interfaceIcon(content === 'audio' ? 'music' : content === 'transcript' ? 'waveform' : 'document')}<span class="export-content-name"><b title="${escapeHtml(desc)}">${escapeHtml(label)}</b>${graph}</span>
      ${
        content === 'audio'
          ? '<span class="export-format-fixed">WAV</span>'
          : `<span class="export-format-wrap flow-select">
        <button class="flow-select-toggle" type="button" data-flow-select-toggle aria-expanded="false">${escapeHtml(currentDisplay)}<span class="select-chevron">${interfaceIcon('chevron-down')}</span></button>
        <input type="hidden" data-export-format="${content}" value="${current}" />
        <div class="flow-select-options" hidden>${formatOptions}</div>
      </span>`
      }
    </label>`;
    })
    .join('');
  const wf = copy.workflow;
  const hasSummary = meta.some(({ content }) => content === 'notes');
  const destination = exportMarkdownTarget.path || exportMarkdownTarget.directory || '';
  const localNote =
    hasSummary && window.brevia?.meeting?.syncMarkdown
      ? `<section class="export-markdown">
    ${interfaceIcon('notes')}<span><b>${escapeHtml(wf.local)}</b>${destination ? `<small title="${escapeHtml(destination)}">${escapeHtml(destination.split(/[\\/]/).pop())}</small>` : ''}</span>
    <button type="button" class="secondary" data-sync-note="sync">${escapeHtml(exportMarkdownTarget.path ? wf.updateNote : wf.saveNote)}</button>
    ${destination ? `<button class="export-icon-action" type="button" data-sync-note="choose" title="${escapeHtml(wf.folder)}" aria-label="${escapeHtml(wf.folder)}">${interfaceIcon('folder')}</button>` : ''}
    <p role="status" data-sync-status hidden></p>
  </section>`
      : '';
  const bot =
    hasSummary && window.brevia?.share?.groupSummary
      ? `<details class="export-group-bot"><summary>${interfaceIcon('chat')}${escapeHtml(wf.bot)}</summary>
    <div><input type="password" data-group-address maxlength="500" autocomplete="off" aria-label="Webhook URL" placeholder="Webhook URL"><button type="button" class="secondary" data-group-send>${escapeHtml(wf.send)}</button></div>
    <p role="status" data-group-status hidden></p></details>`
      : '';
  const platforms = ['email', 'whatsapp', 'telegram', 'x', 'weibo']
    .map((id) => {
      const [label, desc] = copy.platform[id];
      return `<button type="button" class="share-platform" data-share-target="${id}" data-share-kind="text" title="${escapeHtml(desc)}">${sharePlatformIcon(id)}<b>${escapeHtml(label)}</b></button>`;
    })
    .join('');
  return `<div class="export-builder" data-export-meeting="${escapeHtml(currentMeetingDetail?.id)}">
    ${localNote}
    <section class="export-builder-section">
      <h3 class="sr-only">${copy.what}</h3>
      <div class="export-content-list">${rows || `<p class="export-empty">${copy.empty}</p>`}</div>
    </section>
    <section class="export-builder-section">
      <h3 class="sr-only">${copy.files}</h3>
      <p class="export-selection-summary" data-export-summary>${copy.emptySummary}</p>
      <div class="export-actions">
        ${window.brevia?.platform === 'darwin' ? `<button type="button" class="secondary" data-share-target="system" data-share-kind="file">${interfaceIcon('upload')}${escapeHtml(copy.platform.system[0])}</button>` : ''}<button type="button" class="secondary" data-share-target="copy" data-share-kind="text">${interfaceIcon('copy')}${escapeHtml(copy.platform.copy[0])}</button><button type="button" class="modal-action" data-export-save>${copy.save}</button>
      </div>
    </section>
    <section class="export-builder-section">
      <details class="export-more-share"><summary title="${escapeHtml(copy.shareHint)}">${copy.shareTo}</summary><div class="share-platforms">${platforms}</div>${bot}</details>
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
  if (summaryEl)
    summaryEl.textContent =
      count === 0 ? copy.emptySummary : count === 1 ? copy.summaryOne : copy.summaryMany;
  const hasText = selected.some(({ content }) => content !== 'audio');
  settingsModal.querySelectorAll('[data-export-save]').forEach((btn) => {
    btn.disabled = count === 0;
  });
  settingsModal.querySelectorAll('[data-share-target]').forEach((btn) => {
    const kind = btn.dataset.shareKind;
    btn.disabled = count === 0 || (kind === 'text' && !hasText);
  });
}
/** 模型事件只刷新内置模型选择，不打断在线配置表单的输入和焦点。 */
function refreshModelConfigModels() {
  const config =
    activeModal === 'summary-model'
      ? summaryConfigDraft
      : activeModal === 'ai-assist'
        ? aiAssistConfigDraft
        : null;
  if (config?.provider === 'built-in') renderModal(activeModal);
}

/** 渲染一个设置模态框。@param {'models'|'storage'|'summary-model'} kind 请求的模态框。@returns {void} */
let mobileConnectionContent;
let agentSettings;
let agentSettingsBusy = false;
let agentSettingsError = '';
function agentSetupGuide() {
  return renderAgentSetupGuide(agentSettings);
}
function renderAgentSettings() {
  return renderAgentSettingsPage(agentSettings, agentSettingsBusy, agentSettingsError);
}
async function enableAgentAccess() {
  if (agentSettingsBusy) return;
  agentSettingsBusy = true;
  agentSettingsError = '';
  settingsModal.querySelectorAll('[data-agent-enable]').forEach((control) => {
    control.disabled = true;
  });
  try {
    agentSettings = await window.brevia.agent.settings.save({
      enabled: true,
      permissions: { read: true, infer: true, record: true },
    });
  } catch (error) {
    // 保存响应失败时回读真实权限，避免显示过期的授权状态。
    agentSettings = await window.brevia.agent.settings.get().catch(() => agentSettings);
    agentSettingsError = userFacingError(error.detail || error.message);
  } finally {
    agentSettingsBusy = false;
    if (activeModal === 'agent-settings' && !settingsModal.hidden) {
      renderModal('agent-settings');
      settingsModal
        .querySelector('[data-agent-enable], [data-agent-copy="guide"]')
        ?.focus({ preventScroll: true });
    }
  }
}
function renderModal(kind) {
  const body = settingsModal.querySelector('.modal-body');
  const storageScrollTop =
    kind === 'storage' && !settingsModal.hidden && body.dataset.contentKind === kind
      ? body.scrollTop
      : 0;
  settingsModal.querySelector('[data-mobile-install-toggle]')?.remove();
  settingsModal.classList.remove('confirmation-modal');
  settingsFolders.hidden = true;
  document.body.append(settingsFolders);
  configureSettingsPage(kind);
  settingsModal.classList.toggle('summary-model-modal', kind === 'summary-model');
  if (kind === 'agent-settings') {
    settingsModal.querySelector('.modal-title h2').textContent = t('Agent 与 MCP');
    settingsModal.querySelector('.modal-title p').textContent = '';
    replaceModalBody(kind, renderAgentSettings());
    return;
  }
  if (kind === 'device-connection') {
    mobileConnectionContent ||= document.getElementById('mobile-dialog');
    const body = settingsModal.querySelector('.modal-body');
    const same = body.contains(mobileConnectionContent);
    settingsModal.querySelector('.modal-title h2').textContent = t('设备连接');
    settingsModal.querySelector('.modal-title p').textContent = t(
      '手机录音，电脑转写。也可以离线录音，稍后确认上传。',
    );
    if (!same) body.replaceChildren(mobileConnectionContent);
    body.dataset.contentKind = kind;
    mobileConnectionContent.hidden = false;
    return;
  }
  if (kind === 'advanced-settings') {
    settingsModal.querySelector('.modal-title h2').textContent = t('进阶设置');
    settingsModal.querySelector('.modal-title p').textContent = t(
      '为特定会议环境微调识别、端点检测、说话人分离和本地模型。',
    );
    replaceModalBody(
      kind,
      `${renderPermissionSettings()}<form class="advanced-settings-form preferences-form">${renderAdvancedSettings(advancedSettings?.settings || {}, advancedSettings || {})}<footer class="preferences-form-footer modal-form-actions">${renderSaveState('saved')}<button class="modal-action" type="submit">${t('确定')}</button><button class="secondary" data-reset-advanced-settings type="button">${t('恢复默认')}</button></footer></form>`,
    );
    validateAdvancedSettings(settingsModal.querySelector('.advanced-settings-form'));
    return;
  }
  if (kind === 'summary-model') {
    renderSummaryModelModal();
    return;
  }
  if (kind === 'ai-assist') {
    renderAiAssistModal();
    return;
  }
  if (kind === 'speaker-profiles') {
    renderSpeakerProfileModal();
    return;
  }
  if (kind === 'export' || kind === 'share') {
    renderExportModal();
    return;
  }
  if (kind === 'whats-new' || kind === 'upgrade-log') {
    renderWhatsNewModal();
    return;
  }
  const copy = (modalCopy[locale] || modalCopy.en)[kind];
  if (kind === 'storage') {
    const cleanup = storageCleanupCopy[locale] || storageCleanupCopy.en;
    settingsModal.querySelector('.modal-title h2').textContent = t('存储与隐私');
    settingsModal.querySelector('.modal-title p').textContent = t(
      '查看和管理保存在此设备上的会议录音、会议纪要与模型。',
    );
    renderSettingsFolderRows();
    replaceModalBody(
      kind,
      `<section class="preferences-section storage-overview"><header class="preferences-section-heading storage-usage-heading"><h3>${t('存储使用情况')}</h3></header><div class="preferences-storage-meter" data-storage-system-disk>${renderSystemDiskUsage()}</div><div class="storage-app-usage"><span></span><span></span></div></section><section class="preferences-section preferences-storage-management"><header class="preferences-section-heading storage-data-heading"><h3>${t('数据管理')}</h3><button class="secondary" data-cleanup-storage type="button">${cleanup.button}</button></header><div class="storage-list">${copy.items.map(([name], index) => `<div class="preference-row preferences-danger-row"><div class="preference-copy"><h3>${escapeHtml(t(index ? '清空模型' : '清空会议数据'))}</h3><p>${escapeHtml(t(index ? '清空已下载的模型文件。' : '删除此设备上的会议录音、转写文本与笔记。'))}</p></div><div class="preference-control"><button class="secondary modal-danger" data-clear-storage="${['meetings', 'models'][index]}" type="button">${t(index ? '清空模型' : '清空会议数据')}</button></div></div>`).join('')}</div></section><section class="preferences-section"><header class="preferences-section-heading"><h3>${t('隐私说明')}</h3></header><div class="preferences-privacy"><p>${interfaceIcon('storage')}${t('本地模型在此设备上运行。')}</p><p>${interfaceIcon('globe')}${t('在线 AI 会将相关文字发送至所选服务商。')}</p></div></section>`,
    );
    settingsModal.querySelector('.storage-overview').after(settingsFolders);
    settingsFolders.hidden = false;
    updateStorageUsage();
    body.scrollTop = storageScrollTop;
    return;
  }
  if (kind === 'models') {
    renderModelLibrary();
    return;
  }
  const modelStageOrder = new Map();
  (copy.items || []).forEach(([stage], index) => {
    if (!modelStageOrder.has(stage)) modelStageOrder.set(stage, index);
  });
  settingsModal.querySelector('.modal-title h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  replaceModalBody(
    kind,
    `<div class="modal-list">${copy.items
      .map((item, index) => {
        const [name, detail] = item;
        const label = `<b>${escapeHtml(name)}</b>`;
        return `<div><span>${label}<small>${escapeHtml(detail)}</small></span></div>`;
      })
      .join('')}</div>`,
  );
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
  return modelSelection.modelSizeSummary(model, { download: t('下载') }, formatBytes);
}
/** 渲染模型库：完全由 modelCatalog 生成，按能力分组，随包组件为只读行。
 *
 * 不再读 i18n 里那份与清单平行的显示数组——那份数据靠下标对齐，改清单顺序就会
 * 静默错位（设计文档 §1.4 / §9.5）。分组标题与定位短句都按 model.id / asr_role 取。
 * @returns {void} */
let modelLibraryTab = 'available';
function renderModelLibrary() {
  const roleWords = (asrCopy.asrRole || {})[locale] || (asrCopy.asrRole || {}).en || {};
  const modelWords = (asrCopy.model || {})[locale] || (asrCopy.model || {}).en || {};
  const labels = modelLabels[locale] || modelLabels.en;
  const languages = new Intl.DisplayNames([BreviaI18n.localeTag(locale)], { type: 'language' });
  const catalog = visibleModels();
  const stageIcons = {
    refined: 'captions',
    vad: 'waveform',
    diarization: 'person',
    'speaker-embedding': 'microphone',
    summary: 'notes',
    translation: 'translate',
  };

  settingsModal.querySelector('.modal-title h2').textContent =
    (modalCopy[locale] || modalCopy.en).models?.title || t('模型库');
  settingsModal.querySelector('.modal-title p').textContent = t(
    '下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。',
  );

  const rows = MODEL_LIBRARY_GROUPS.map(({ key, stage }) => {
    const models = catalog.filter(
      (model) =>
        modelLibraryGroup(model) === key &&
        (modelLibraryTab === 'installed'
          ? modelPaths.has(model.id) || model.bundled
          : !modelPaths.has(model.id) && !model.bundled),
    );
    if (!models.length) return '';
    const groupHint = t(
      {
        refined: '用于实时转写与会后精修。',
        vad: '语音活动检测',
        diarization: '说话人分离',
        'speaker-embedding': '声纹识别',
        summary: '会议纪要',
        translation: '翻译',
      }[key] || key,
    );
    const heading = `<header class="preferences-section-heading model-group-heading" title="${escapeHtml(groupHint)}"><h3>${escapeHtml((modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en)[stage] || key)}</h3></header>`;
    return (
      `<section class="preferences-model-group">${heading}<div class="preferences-model-rows">` +
      models
        .map((model) => {
          const isInstalled = modelPaths.has(model.id);
          const readOnly = Boolean(model.bundled);
          const progress = readOnly || isInstalled ? undefined : modelDownloads.get(model.id);
          const inFlight = progress && !progress.error && !progress.cancelled;
          const id = escapeHtml(model.id);
          const languageNames = (model.languages || [])
            .filter((code) => code !== 'all')
            .map((code) => languages.of(code));
          const language =
            languageNames.length && languageNames.length <= 3
              ? languageNames.join(' · ')
              : roleWords[model.asr_role] || (key === 'translation' ? roleWords.multilingual : '');
          const description = modelWords[model.id]?.tagline || modelLibraryDescription(model, '');
          const meta = `<span class="model-library-details"><span title="${escapeHtml(modelSizeSummary(model))}">${formatBytes(model.size_bytes || 0)}</span>${language ? `<span title="${escapeHtml(languageNames.join(', ') || language)}">${escapeHtml(language)}</span>` : ''}</span>`;
          const identity = `<span class="preferences-model-symbol">${interfaceIcon(stageIcons[key])}</span><span class="model-library-content"><b class="model-library-headline">${escapeHtml(model.name)}</b>${meta}</span>`;
          const intro = description
            ? `<details class="model-intro" data-modal-detail="model-${id}"><summary class="preferences-model-main" data-model-description="${id}">${identity}${interfaceIcon('chevron-down')}</summary><p class="model-library-description">${escapeHtml(description)}</p></details>`
            : `<div class="preferences-model-main">${identity}</div>`;
          const action = (attribute, icon, label) => {
            const name = escapeHtml(label + ' · ' + model.name);
            return `<button type="button" ${attribute}="${id}" aria-label="${name}" title="${name}">${interfaceIcon(icon)}</button>`;
          };
          let controls;
          if (readOnly) {
            controls = `<span class="model-library-readonly" title="${escapeHtml(t('必需'))}">${interfaceIcon('check')}${escapeHtml(t('随应用安装'))}</span>`;
          } else if (isInstalled) {
            controls =
              action('data-open-model-folder', 'folder', t('从文件夹打开')) +
              action('data-delete-model', 'trash', labels.remove);
          } else if (inFlight) {
            controls =
              action('data-pause-required', 'pause', t('暂停')) +
              action('data-cancel-required', 'close', t('取消'));
          } else {
            controls = action(
              'data-download-model',
              progress?.error ? 'refresh' : 'download',
              progress?.error ? t('重试') : labels.download,
            );
          }
          let status = '';
          if (progress?.error) {
            status = `<p class="model-transfer-error">${interfaceIcon('warning')}${escapeHtml(progress.error)}</p>`;
          } else if (inFlight) {
            status =
              '<div class="model-transfer"><div><span data-transfer-state></span><span data-transfer-quantity></span></div><progress max="100"></progress></div>';
          }
          return `<article class="preferences-model-row" data-model-card="${id}">${intro}<footer class="model-card-footer">${renderModelLibraryRatings(model)}<div class="preferences-model-actions">${controls}</div></footer>${status}</article>`;
        })
        .join('') +
      '</div></section>'
    );
  }).join('');

  replaceModalBody(
    'models',
    `<div class="preferences-library-toolbar model-library-toolbar"><nav class="preferences-tabs settings-tabs" aria-label="${escapeHtml(t('模型库'))}"><button type="button" data-model-library-tab="installed" aria-selected="${modelLibraryTab === 'installed'}">${t('已安装')}</button><button type="button" data-model-library-tab="available" aria-selected="${modelLibraryTab === 'available'}">${t('可下载')}</button></nav>${chinaModelSourceToggle()}</div><div class="preferences-library model-library-list">${rows || `<p class="page-empty">${t('暂无内容')}</p>`}</div>`,
  );
  for (const transfer of settingsModal.querySelectorAll('.model-transfer')) {
    const row = transfer.closest('[data-model-card]');
    updateModelTransfer(row, modelDownloads.get(row.dataset.modelCard));
  }
}

/** 渲染“更新日志”弹窗：标题 + 按版本倒序的内容列表。@returns {void} */
function renderWhatsNewModal() {
  const copy = whatsNewCopy[locale] || whatsNewCopy.en;
  if (activeModal === 'upgrade-log') {
    settingsModal.querySelector('.modal-title h2').textContent = copy.title;
    settingsModal.querySelector('.modal-title p').textContent = '';
    replaceModalBody(activeModal, renderWhatsNewList(installedAppVersion));
    if (!settingsModal.querySelector('.upgrade-log-actions'))
      settingsModal
        .querySelector('.modal-panel')
        .insertAdjacentHTML(
          'beforeend',
          `<footer class="upgrade-log-actions"><button type="button" data-update-log-about>${escapeHtml(copy.view)}${interfaceIcon('arrow-right')}</button><button class="modal-action" type="button" data-update-log-dismiss>${escapeHtml(t('开始使用'))}</button></footer>`,
        );
    return;
  }
  settingsModal.querySelector('.modal-title h2').textContent = t('关于与更新');
  settingsModal.querySelector('.modal-title p').textContent = t(
    '了解 Brevia 的版本信息、更新内容及相关资源。',
  );
  replaceModalBody(
    activeModal,
    `<section class="release-settings"><header><span class="about-brand-mark" aria-hidden="true"><img src="./assets/brevia-mark.svg" alt="" /></span><div><h3>${escapeHtml(updateCopy().title)}</h3><small>${escapeHtml(currentVersionLabel())} · v${escapeHtml(installedAppVersion || '—')}</small></div></header><div class="release-actions"><button class="secondary" data-check-app-update type="button">${interfaceIcon('refresh')}<span></span></button><button class="release-install" data-install-app-update hidden type="button">${interfaceIcon('download')}<span></span></button></div><div class="release-state"><span role="status" hidden></span><a data-release-link target="_blank" rel="noopener noreferrer" hidden></a></div><progress max="100" aria-label="${escapeHtml(updateCopy().downloading)}" hidden></progress><fieldset class="release-delay"><legend title="${escapeHtml(updateCopy().delayHint)}">${escapeHtml(updateCopy().delay)}</legend><div>${updateDelays.map((days) => `<label><input type="radio" name="release-delay" value="${days}"${days === updatePolicy.delayDays ? ' checked' : ''} /><span>${days ? new Intl.NumberFormat(BreviaI18n.localeTag(locale), { style: 'unit', unit: 'day', unitDisplay: 'short' }).format(days) : escapeHtml(updateCopy().immediate)}</span></label>`).join('')}</div></fieldset></section><a class="preferences-about-link about-repository" href="https://github.com/zerolovesea/Brevia" target="_blank" rel="noopener noreferrer">${interfaceIcon('github')}<span><b>GitHub</b><small>zerolovesea / Brevia</small></span>${interfaceIcon('chevron-right')}</a><section class="preferences-section preferences-release-notes"><header class="preferences-section-heading"><h3>${t('更新日志')}</h3></header>${renderWhatsNewList()}</section>`,
  );
  renderUpdateButton();
}
/** 当前版本展开、历史版本折叠；分类条目附提交引用与首次贡献者。 */
function renderWhatsNewList(installedVersion) {
  const copy = whatsNewCopy[locale] || whatsNewCopy.en;
  const releases = installedVersion
    ? [
        whatsNewLog?.find((entry) => entry.version === installedVersion),
        ...(whatsNewLog || []).filter(
          (entry) => compareVersions(entry.version, installedVersion) < 0,
        ),
      ].filter(Boolean)
    : whatsNewLog;
  if (
    !releases?.length ||
    (installedVersion && !releases.some((entry) => entry.version === installedVersion))
  )
    return `<p class="whatsnew-empty">${escapeHtml(copy.empty)}</p>`;
  const localized = (entry) => entry[locale] || entry.en || entry.zh || {};
  const repository = 'https://github.com/zerolovesea/Brevia';
  const link = (url, label) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  return `<div class="whatsnew-list">${releases
    .map((entry) => {
      const { version, date } = entry;
      const current = installedVersion ? version === installedVersion : entry.current;
      const content = localized(entry);
      const sections = [
        ['what', copy.what],
        ['improved', copy.improved],
        ['fixed', copy.fixed],
        ['security', copy.security],
        ['changes', copy.changes],
      ]
        .map(([key, label]) => {
          const items = content[key];
          if (!items || !items.length) return '';
          return `<section><h4>${escapeHtml(label)}</h4><ul>${items
            .map((item) => {
              const text = typeof item === 'string' ? item : item.text;
              const reference = /^[a-f0-9]{7,40}$/.test(item.commit || '')
                ? ` ${link(`${repository}/commit/${item.commit}`, item.commit.slice(0, 7))}`
                : '';
              return `<li>${escapeHtml(text)}${reference}</li>`;
            })
            .join('')}</ul></section>`;
        })
        .join('');
      const contributors = entry.contributors?.length
        ? `<section><h4>${escapeHtml(copy.contributors)}</h4><ul>${entry.contributors.map(({ login, pr }) => `<li>${link(`https://github.com/${encodeURIComponent(login)}`, `@${login}`)} · ${link(`${repository}/pull/${pr}`, `#${pr}`)}</li>`).join('')}</ul></section>`
        : '';
      const footer = entry.previousVersion
        ? `<footer>${link(`${repository}/compare/v${entry.previousVersion}...v${version}`, copy.fullChangelog)}</footer>`
        : '';
      const heading = `<div class="whatsnew-heading"><h3>v${escapeHtml(version)}${current ? `<em>${escapeHtml(copy.current)}</em>` : ''}</h3>${date ? `<time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>` : ''}</div>`;
      const body = `${content.summary ? `<p class="whatsnew-summary">${escapeHtml(content.summary)}</p>` : ''}${sections}${contributors}${footer}`;
      return current
        ? `<details class="whatsnew-entry is-current" data-modal-detail="${escapeHtml(entry.version)}" open><summary>${heading}</summary>${body}</details>`
        : `<details class="whatsnew-entry" data-modal-detail="${escapeHtml(entry.version)}"><summary>${heading}</summary>${body}</details>`;
    })
    .join('')}</div>`;
}
/** 鼠标操作保留当前位置；键盘打开的新交互接续到首个可操作控件。 */
function focusForKeyboard(element) {
  if (document.documentElement.hasAttribute('data-keyboard-navigation'))
    element?.focus({ preventScroll: true });
}
/** 显示设置模态框；键盘打开时接续焦点，鼠标打开时保留当前位置。@returns {void} */
function showSettingsModal(confirmationAnchor) {
  clearTimeout(modalDismissTimer);
  if (settingsModal.hidden) modalReturnFocus = document.activeElement;
  settingsModal.querySelector('.modal-title p').hidden = false;
  settingsModal
    .querySelector('.modal-close')
    .setAttribute(
      'aria-label',
      settingsModal.classList.contains('settings-page')
        ? t('返回')
        : (modalCopy[locale] || modalCopy.en).close,
    );
  settingsModal.classList.remove('modal-leave');
  settingsModal.classList.add('modal-enter');
  settingsModal.style.zIndex = '60';
  settingsModal.hidden = false;
  if (settingsModal.classList.contains('export-modal') || confirmationAnchor) {
    settingsModal.setAttribute('popover', 'auto');
    const trigger = confirmationAnchor || document.querySelector('[data-export-detail]');
    const source = trigger?.checkVisibility() ? trigger : null;
    settingsModal.showPopover(source ? { source } : undefined);
    if (source) modalReturnFocus = source;
    if (confirmationAnchor) {
      source?.classList.add('is-confirmation-anchor');
      settingsModal.querySelector('.modal-panel').setAttribute('aria-modal', 'false');
      settingsModal
        .querySelector('.modal-panel')
        .setAttribute('aria-labelledby', 'library-confirm-title');
    } else {
      settingsModal.querySelector('.modal-panel').removeAttribute('aria-describedby');
      source?.setAttribute('aria-expanded', 'true');
      settingsModal.querySelector('.modal-title h2').id = 'export-popover-title';
      settingsModal
        .querySelector('.modal-panel')
        .setAttribute('aria-labelledby', 'export-popover-title');
    }
    document.querySelector('.app-shell').inert = false;
    document.body.classList.remove('modal-open');
    focusForKeyboard(
      settingsModal.querySelector('[data-cancel-confirmation], [data-export-item]') ||
        settingsModal.querySelector('.modal-close'),
    );
    return;
  }
  if (settingsModal.hasAttribute('popover')) {
    document.querySelector('.is-confirmation-anchor')?.classList.remove('is-confirmation-anchor');
    settingsModal.removeAttribute('popover');
    document.querySelector('[data-export-detail]')?.setAttribute('aria-expanded', 'false');
  }
  focusForKeyboard(
    settingsModal.querySelector('[data-cancel-confirmation]') ||
      settingsModal.querySelector('button:not(:disabled)'),
  );
  const protectedFocus = !settingsModal.classList.contains('settings-page');
  document.querySelector('.app-shell').inert = protectedFocus;
  if (onboardingPage) onboardingPage.inert = protectedFocus;
  document.body.classList.add('modal-open');
  const actions = settingsModal.querySelector('form .modal-form-actions');
  if (
    actions &&
    !actions.querySelector('.save-state') &&
    ['summary-model', 'ai-assist', 'advanced-settings'].includes(activeModal)
  )
    actions.insertAdjacentHTML('afterbegin', renderSaveState('saved'));
}
/** Opens and focuses a settings modal. @param {'models'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
let modalDismissTimer;
let modalReturnFocus;
let modalRequestRevision = 0;
let confirmationAction;
let storageConfirmationPage;
function openConfirmation(title, detail, action, anchor, subject) {
  modalRequestRevision += 1;
  clearTimeout(modalDismissTimer);
  closeMeetingMenus(true);
  if (
    ['storage', 'device-connection'].includes(activeModal) &&
    settingsModal.classList.contains('settings-page')
  ) {
    // 移动真实页面节点保留目录、滚动位置与操作；确认时只让背景不可交互。
    const page = document.createElement('div');
    page.className = settingsModal.className;
    page.inert = true;
    storageConfirmationPage = {
      page,
      kind: activeModal,
      returnFocus: anchor || document.activeElement,
      returnDeviceId:
        activeModal === 'device-connection'
          ? (anchor || document.activeElement)?.closest('.mobile-device')?.dataset.deviceId
          : undefined,
      scrollTop: settingsModal.querySelector('.modal-body').scrollTop,
    };
    page.append(...settingsModal.childNodes);
    settingsModal.before(page);
    page.querySelector('.modal-body').scrollTop = storageConfirmationPage.scrollTop;
    settingsModal.innerHTML = settingsModalMarkup();
  }
  configureSettingsPage('confirmation');
  settingsModal.classList.add('confirmation-modal');
  settingsModal.classList.toggle(
    'permanent-confirmation',
    title === BreviaI18n.trashCopy(locale).purge,
  );
  const libraryAnchor =
    anchor && (!storageConfirmationPage || storageConfirmationPage.kind === 'device-connection')
      ? anchor
      : null;
  settingsModal.classList.toggle(
    'storage-confirmation',
    Boolean(storageConfirmationPage && !libraryAnchor),
  );
  settingsModal.classList.toggle('library-confirmation', Boolean(libraryAnchor));
  confirmationAction = action;
  activeModal = 'confirmation';
  settingsModal.querySelector('.modal-title h2').textContent = title;
  settingsModal.querySelector('.modal-title p').textContent = '';
  settingsModal.querySelector('.modal-body').innerHTML =
    `<div class="confirmation-actions">${interfaceIcon([t('删除工作区'), t('重新精修')].includes(title) ? 'warning' : 'trash')}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><button class="secondary" data-cancel-confirmation type="button">${t('取消')}</button><button class="modal-action modal-danger" data-confirm-action type="button">${escapeHtml(title === t('删除工作区') ? t('确认') : title)}</button></div>`;
  if (libraryAnchor) {
    const card = settingsModal.querySelector('.confirmation-actions');
    const heading = card.querySelector('h2');
    heading.id = 'library-confirm-title';
    card.querySelector('p').id = 'library-confirm-detail';
    if (subject) {
      const name = document.createElement('strong');
      name.className = 'confirmation-subject';
      name.textContent = subject;
      name.title = subject;
      heading.append(name);
    }
    settingsModal
      .querySelector('.modal-panel')
      .setAttribute('aria-describedby', 'library-confirm-detail');
  }
  showSettingsModal(libraryAnchor);
  if (storageConfirmationPage && anchor)
    positionFloating(settingsModal.querySelector('.modal-panel'), anchor, [
      'bottom-end',
      'top-end',
    ]);
}
async function openModal(kind) {
  if (kind === 'prompts') return;
  const revision = ++modalRequestRevision;
  const previousModal = activeModal;
  if (kind === 'ai-features') kind = 'summary-model';
  const same =
    activeModal === kind &&
    !settingsModal.hidden &&
    settingsModal.querySelector('.modal-body').dataset.contentKind === kind &&
    !settingsModal.classList.contains('modal-leave');
  if (same) return;
  if (kind === 'agent-settings') {
    try {
      const value = await window.brevia.agent.settings.get();
      if (revision !== modalRequestRevision) return;
      agentSettings = value;
      agentSettingsError = '';
    } catch (error) {
      if (revision === modalRequestRevision)
        showToast(error.detail || error.message, undefined, 'error');
      return;
    }
  }
  window.clearInterval(permissionPollTimer);
  clearTimeout(modalDismissTimer);
  if (kind === 'export' || kind === 'share') {
    const meeting_id = currentMeetingDetail?.id;
    const target =
      meeting_id && window.brevia?.meeting?.markdownTarget
        ? await window.brevia.meeting.markdownTarget({ meeting_id }).catch(() => null)
        : null;
    if (revision !== modalRequestRevision || meeting_id !== currentMeetingDetail?.id) return;
    exportMarkdownTarget = target || {};
  }
  if (kind === 'advanced-settings' || kind === 'speaker-profiles') {
    try {
      const [settings, status] = await Promise.all([
        window.brevia?.advancedSettings.get(),
        kind === 'advanced-settings'
          ? window.brevia?.permissions.status().catch(() => undefined)
          : undefined,
      ]);
      if (revision !== modalRequestRevision) return;
      advancedSettings = settings || { settings: {}, defaults: {} };
      permissionStatus = status;
    } catch (error) {
      if (revision !== modalRequestRevision) return;
      showToast(error.message, undefined, 'error');
      return;
    }
  }
  if (kind === 'speaker-profiles' && speakerProfiles.length) {
    const profile =
      speakerProfiles.find((item) => item.id === expandedSpeakerProfileId) || speakerProfiles[0];
    expandedSpeakerProfileId = profile.id;
    try {
      const samples = await window.brevia.speakerProfile.samples({ profile_id: profile.id });
      if (revision !== modalRequestRevision) return;
      speakerSamples.set(profile.id, samples);
    } catch (error) {
      if (revision !== modalRequestRevision) return;
      showToast(error.message, undefined, 'error');
    }
  }
  if (revision !== modalRequestRevision || activeModal !== previousModal) return;
  activeModal = kind;
  renderModal(kind);
  showSettingsModal();
  settingsModal.querySelector('.modal-body').scrollTop = 0;
  settingsModal.querySelector('.modal-panel').scrollTop = 0;
  settingsModal.scrollTop = 0;
  if (kind === 'advanced-settings') startPermissionPoll();
}
/** 在高级设置模态框打开时轮询系统权限状态，并仅在更改时重新渲染该部分。@returns {void} */
function startPermissionPoll() {
  window.clearInterval(permissionPollTimer);
  let refreshing = false;
  const timer = window.setInterval(async () => {
    if (activeModal !== 'advanced-settings' || settingsModal.hidden) {
      window.clearInterval(timer);
      return;
    }
    if (refreshing || permissionRequests.size) return;
    refreshing = true;
    const status = await window.brevia?.permissions.status().catch(() => undefined);
    refreshing = false;
    if (
      !status ||
      permissionPollTimer !== timer ||
      activeModal !== 'advanced-settings' ||
      settingsModal.hidden ||
      permissionRequests.size
    )
      return;
    const changed = JSON.stringify(status) !== JSON.stringify(permissionStatus);
    permissionStatus = status;
    if (changed) refreshPermissionSettings();
  }, 1000);
  permissionPollTimer = timer;
}
function refreshPermissionSettings() {
  const section = settingsModal.querySelector('[data-permission-settings]');
  if (!section) return;
  const body = settingsModal.querySelector('.modal-body');
  const scrollTop = body.scrollTop;
  const open = section.open;
  section.outerHTML = renderPermissionSettings();
  settingsModal.querySelector('[data-permission-settings]').open = open;
  body.scrollTop = scrollTop;
}
/** 关闭活动的设置模态框并恢复页面滚动。@returns {void} */
function closeModal() {
  modalRequestRevision += 1;
  if (settingsModal.hidden) return;
  if (storageConfirmationPage) {
    clearTimeout(modalDismissTimer);
    const { page, kind, returnFocus, returnDeviceId, scrollTop } = storageConfirmationPage;
    storageConfirmationPage = undefined;
    confirmationAction = undefined;
    settingsModal.removeAttribute('popover');
    document.querySelector('.is-confirmation-anchor')?.classList.remove('is-confirmation-anchor');
    settingsModal.className = page.className;
    settingsModal.replaceChildren(...page.childNodes);
    page.remove();
    activeModal = kind;
    document.querySelector('.app-shell').inert = false;
    settingsModal.querySelector('.modal-body').scrollTop = scrollTop;
    document.body.classList.add('modal-open');
    let focusTarget = returnFocus;
    if (!focusTarget?.isConnected && kind === 'device-connection') {
      focusTarget = returnDeviceId
        ? settingsModal.querySelector(
            `[data-device-id="${CSS.escape(returnDeviceId)}"] .trusted-device-revoke`,
          )
        : null;
      focusTarget ||= [
        ...settingsModal.querySelectorAll(
          '#mobile-dialog [data-mobile-page-step="pair"], #mobile-dialog [data-mobile-page-step="install"]',
        ),
      ].find((button) => button.checkVisibility());
    }
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    return;
  }
  if (settingsModal.hasAttribute('popover')) {
    const restoreFocus =
      settingsModal.contains(document.activeElement) || document.activeElement === document.body;
    activeModal = undefined;
    confirmationAction = undefined;
    document.querySelector('.is-confirmation-anchor')?.classList.remove('is-confirmation-anchor');
    const trigger = document.querySelector('[data-export-detail]');
    trigger?.setAttribute('aria-expanded', 'false');
    settingsModal.hidden = true;
    settingsModal.removeAttribute('popover');
    settingsModal.classList.remove('modal-enter');
    if (restoreFocus && modalReturnFocus?.isConnected)
      modalReturnFocus.focus({ preventScroll: true });
    return;
  }
  if (activeModal === 'whats-new' || activeModal === 'upgrade-log') markWhatsNewSeen();
  const returnTo = activeModal === 'whats-new' ? updateLogReturn : undefined;
  updateLogReturn = undefined;
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
  modalDismissTimer = setTimeout(
    () => {
      if (!settingsModal.classList.contains('modal-leave')) return;
      settingsModal.hidden = true;
      document.querySelector('.app-shell').inert = false;
      if (onboardingPage) onboardingPage.inert = false;
      if (returnTo) {
        void showView(returnTo.view).then(() => {
          if (returnTo.focus?.isConnected) returnTo.focus.focus({ preventScroll: true });
        });
      } else if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
      settingsModal.classList.remove('modal-leave');
      if (onboardingPage?.dataset.aiSettings !== 'true')
        document.body.classList.remove('modal-open');
    },
    settingsModal.classList.contains('settings-page') ? 0 : BreviaMotion.duration('exit'),
  );
}

let onboardingPage;
let onboardingPreviewLocale;
let onboardingSelectedLocale;
let onboardingAiDemoTimer;
let onboardingSummaryDemoTimer;
let onboardingMotion;
/** 演示只更新隔离样例，模式切换/关闭立即取消旧阶段。 */
function renderOnboardingAiDemo() {
  clearTimeout(onboardingAiDemoTimer);
  const demo = onboardingPage?.querySelector('[data-onboarding-ai-demo]');
  if (!demo) return;
  const enabled = onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked;
  const selectedMode =
    onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value || 'assist';
  const mode = enabled ? selectedMode : 'off';
  onboardingPage
    .querySelectorAll('.onboarding-ai-segments button')
    .forEach((button) => (button.disabled = mode === 'off'));
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  const sample = aiOnboardingDemoCopy[locale] || aiOnboardingDemoCopy.en;
  const modeLabel = t({ quiet: '手动', assist: '适度', auto: '主动' }[selectedMode]);
  const note = sample.scenes.quiet[0][2];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  demo.dataset.mode = mode;
  demo.dataset.stage = enabled ? 'idle' : 'off';
  demo.innerHTML = `<div class="onboarding-preview-paper"><h3>${escapeHtml(t('AI 笔记'))} <small>${escapeHtml(enabled ? `${modeLabel} · ${t('演示')}` : copy.demoOff)}</small></h3><blockquote class="onboarding-demo-transcript">${escapeHtml(sample.transcriptText)}</blockquote><div class="onboarding-demo-result"><div data-demo-notes></div><div data-demo-suggestion>${enabled ? '' : `<p>${escapeHtml(note)}</p>`}</div></div><div class="onboarding-demo-caption"><small data-demo-status>${escapeHtml(modeLabel)}</small>${enabled ? `<button type="button" data-demo-replay>${escapeHtml(copy.replay)}</button>` : ''}</div></div>`;
  if (mode === 'off') return;
  const suggestion = demo.querySelector('[data-demo-suggestion]');
  const notes = demo.querySelector('[data-demo-notes]');
  const status = demo.querySelector('[data-demo-status]');
  demo.querySelector('[data-demo-replay]').onclick = renderOnboardingAiDemo;
  const append = () => {
    notes.innerHTML = `<b>${escapeHtml(sample.notes)}</b><p>${escapeHtml(note)}</p>`;
    suggestion.replaceChildren();
    status.textContent = t('已加入笔记');
    demo.dataset.stage = 'written';
  };
  const propose = () => {
    demo.dataset.stage = 'suggestion';
    status.textContent = modeLabel;
    suggestion.innerHTML = `<p>${escapeHtml(note)}</p>`;
    if (mode === 'auto') {
      demo.dataset.stage = 'queued';
      suggestion.insertAdjacentHTML(
        'beforeend',
        `<small>${escapeHtml(t('建议已暂存，停笔后加入'))}</small>`,
      );
      if (reducedMotion) append();
      else onboardingAiDemoTimer = setTimeout(append, 1200);
    } else {
      suggestion.insertAdjacentHTML(
        'beforeend',
        `<div class="onboarding-preview-actions"><button type="button" data-demo-add>${escapeHtml(t('加入笔记'))}</button><button type="button" data-demo-ignore>${escapeHtml(t('忽略'))}</button></div>`,
      );
      suggestion.querySelector('[data-demo-add]').onclick = append;
      suggestion.querySelector('[data-demo-ignore]').onclick = () => {
        suggestion.replaceChildren();
        demo.dataset.stage = 'ignored';
      };
    }
  };
  const analyze = () => {
    demo.dataset.stage = 'analyzing';
    status.textContent = t('正在分析…');
    suggestion.textContent = t('正在分析…');
    if (reducedMotion) propose();
    else onboardingAiDemoTimer = setTimeout(propose, 1200);
  };
  if (mode === 'quiet') {
    demo.dataset.stage = 'idle';
    suggestion.innerHTML = `<button class="secondary" type="button">${interfaceIcon('ai')}${escapeHtml(t('请求 AI 建议'))}</button>`;
    suggestion.querySelector('button').onclick = analyze;
  } else analyze();
}
/** 纪要演示先展示任务阶段，完成后才展示文档与保存状态。 */
function renderOnboardingSummaryDemo() {
  clearTimeout(onboardingSummaryDemoTimer);
  const frame = onboardingPage?.querySelector('[data-onboarding-summary-demo]');
  if (!frame) return;
  const enabled = onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked;
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  const sample = aiOnboardingSummaryDemoCopy[locale] || aiOnboardingSummaryDemoCopy.en;
  frame.dataset.stage = enabled ? 'processing' : 'off';
  frame.innerHTML = `<div class="onboarding-preview-paper app-demo-summary-body"><h3>${escapeHtml(t('会议纪要'))} <small>${escapeHtml(enabled ? `${copy.after} · ${t('演示')}` : copy.demoOff)}</small></h3><div data-demo-summary-result><aside class="onboarding-demo-task">${interfaceIcon('document')}<span>${escapeHtml(t('正在生成会议纪要'))}</span><div class="processing-bar"><i style="transform:scaleX(.6)"></i></div></aside></div><div class="onboarding-demo-caption"><small data-demo-summary-status>${escapeHtml(copy.after)}</small>${enabled ? `<button type="button" data-summary-demo-replay>${escapeHtml(copy.replay)}</button>` : ''}</div></div>`;
  const complete = () => {
    frame.dataset.stage = enabled ? 'saved' : 'off';
    frame.querySelector('[data-demo-summary-result]').innerHTML =
      `<b>${escapeHtml(t('决定'))}</b><p>${escapeHtml(sample.decision)}</p><b>${escapeHtml(t('待办'))}</b><ul><li>${escapeHtml(sample.actions[0])}</li></ul>`;
    frame.querySelector('[data-demo-summary-status]').textContent = enabled
      ? t('已保存')
      : copy.after;
  };
  frame
    .querySelector('[data-summary-demo-replay]')
    ?.addEventListener('click', renderOnboardingSummaryDemo);
  if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) complete();
  else onboardingSummaryDemoTimer = setTimeout(complete, 1800);
}

function openOnboardingLanguage(
  initialLocale = onboardingSelectedLocale || window.BreviaOnboarding.systemLocale(),
) {
  modalRequestRevision += 1;
  activeModal = undefined;
  onboardingPreviewLocale = undefined;
  const choices = [
    ['zh', '简体中文'],
    ['en', 'English'],
    ['es', 'Español'],
    ['ja', '日本語'],
    ['ko', '한국어'],
    ['fr', 'Français'],
    ['de', 'Deutsch'],
    ['ru', 'Русский'],
  ];
  const defaultLocale = initialLocale;
  const wheelItems = choices
    .map(
      ([code, label]) =>
        `<label class="language-choice"><input type="radio" name="locale" value="${code}" data-language-wheel-value="${code}"${code === defaultLocale ? ' checked' : ''}/><span>${label}</span></label>`,
    )
    .join('');
  const page = document.createElement('main');
  page.className = 'onboarding-page onboarding-active onboarding-language-overlay';
  page.innerHTML = `<header class="onboarding-window-bar" data-tauri-drag-region><strong data-tauri-drag-region translate="no">Brevia</strong></header>${renderOnboardingRail('language', defaultLocale)}<form class="onboarding-page-content onboarding-language-page" data-onboarding-language><div class="onboarding-page-copy"><h1></h1><p></p></div><div class="language-picker" role="radiogroup" aria-label="${escapeHtml(t('切换语言'))}">${wheelItems}</div><div class="onboarding-actions"><button class="modal-action" type="submit"></button></div></form>`;
  revealOnboardingPage(page, 'language');
  updateOnboardingLanguageCopy(defaultLocale);
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="locale"]')) updateOnboardingLanguageCopy(event.target.value);
  });
  onboardingPage.addEventListener('submit', (event) => {
    event.preventDefault();
    const page = onboardingPage;
    const nextLocale = page.querySelector('[name="locale"]:checked').value;
    onboardingSelectedLocale = nextLocale;
    dismissOnboardingPage(() => {
      onboardingPreviewLocale = undefined;
      applyLanguage(nextLocale, true);
      openOnboardingPermissions();
    });
  });
}

function renderSettingsFolderRows() {
  const copy = onboardingStorageCopy[locale] || onboardingStorageCopy.en;
  settingsFolders.innerHTML = ['recordings', 'models']
    .map(
      (key, index) =>
        `<section class="preference-row preferences-folder"><div class="preference-copy"><h3>${escapeHtml(key === 'models' ? copy.models : copy.recordings)}</h3><p>${escapeHtml(t(key === 'models' ? '保存已下载的本地模型文件。' : '保存此设备上的会议录音。'))}</p><small data-settings-path="${key}"></small></div><div class="preference-control preferences-folder-control"><div class="storage-path-size"><b class="storage-size">${escapeHtml(storageUsage ? formatBytes([storageUsage.meetings, storageUsage.models][index]) : '—')}</b></div><div class="storage-folder-actions"><button class="secondary" data-change-folder="${key}" type="button">${copy.choose}</button><button class="secondary" data-open-storage="${key === 'models' ? 'models' : 'meetings'}" type="button">${t('从文件夹打开')}</button></div></div></section>`,
    )
    .join('');
  void refreshSettingsFolderRows();
}

/** 维护只更新容量，保留当前页面的按钮、焦点、滚动和展开状态。 */
function updateStorageUsage() {
  const sizes = storageUsage
    ? [storageUsage.meetings, storageUsage.models].map(formatBytes)
    : ['—', '—'];
  const usage = document.querySelector('.storage-app-usage');
  if (usage) {
    const copy = (modalCopy[locale] || modalCopy.en).storage;
    usage.children[0].textContent = `Brevia · ${storageUsage ? formatBytes(storageUsage.meetings + storageUsage.models) : '—'}`;
    usage.children[1].textContent = copy.items
      .map(([name], index) => `${name} · ${sizes[index]}`)
      .join('　');
  }
  settingsFolders.querySelectorAll('.storage-size').forEach((size, index) => {
    size.textContent = sizes[index];
  });
}

let storageMovePending = false;
/** 迁移和界面更新完成前禁用背景，避免并发修改存储位置。 */
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
  const protectedLayers = [document.querySelector('.app-shell'), onboardingPage, settingsModal]
    .filter(Boolean)
    .map((element) => [element, element.inert]);
  protectedLayers.forEach(([element]) => (element.inert = true));
  // 快速保存不闪出进度浮窗；真正耗时的迁移仍使用原生模态保护。
  const revealTimer = setTimeout(() => {
    dialog.showModal();
  }, 180);
  try {
    return await operation();
  } finally {
    clearTimeout(revealTimer);
    if (dialog.open) dialog.close();
    dialog.remove();
    protectedLayers.forEach(([element, inert]) => (element.inert = inert));
    storageMovePending = false;
  }
}
function storageErrorMessage(error) {
  const message = String(error.detail || error.message || error);
  if (/empty|ENOTEMPTY/.test(message)) return t('请选择空文件夹。');
  if (/Folders are/.test(message))
    return (onboardingStorageCopy[locale] || onboardingStorageCopy.en).moving;
  if (/Finish the current/.test(message)) return t('请先结束会议、精修和模型下载，再更改文件夹。');
  if (/separate|outside/.test(message))
    return t('模型和录音文件夹必须相互独立，且不能包含原数据文件夹。');
  if (/environment variable/.test(message)) return t('此文件夹由环境变量指定，无法在应用内更改。');
  return t('文件夹更改失败，请检查路径、磁盘连接和写入权限。');
}
/** 容量来自系统磁盘，Brevia 文件占用另行展示，避免把两种百分比混在一起。 */
function renderSystemDiskUsage() {
  const disk = systemDiskUsage;
  if (!disk || disk.total <= 0)
    return `<p class="storage-disk-detail">${t(disk === undefined ? '加载中' : '系统磁盘信息暂不可用')}</p>`;
  const percent = Math.round(Math.max(0, Math.min(1, disk.used / disk.total)) * 1000) / 10;
  const used = `${t('已使用')} ${formatBytes(disk.used)} / ${formatBytes(disk.total)}`;
  const free = `${t('可用空间')} ${formatBytes(disk.free)}`;
  return `<div class="storage-disk-heading"><span>${t('系统磁盘')}</span><strong>${t('已使用')} ${percent}%</strong></div><div class="storage-usage-bar" role="progressbar" aria-label="${escapeHtml(t('系统磁盘'))}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escapeHtml(`${used} · ${free}`)}"><i style="width:${percent}%"></i></div><div class="storage-disk-detail"><span>${escapeHtml(used)}</span><span>${escapeHtml(free)}</span></div>`;
}
async function refreshSettingsFolderRows() {
  try {
    const locations = await window.brevia.storage.locations();
    systemDiskUsage = locations.disk ?? null;
    const overview = document.querySelector('[data-storage-system-disk]');
    if (overview) overview.innerHTML = renderSystemDiskUsage();
    for (const key of ['recordings', 'models']) {
      const path = document.querySelector(`[data-settings-path="${key}"]`);
      const button = document.querySelector(`[data-change-folder="${key}"]`);
      if (!path || !button) continue;
      path.textContent = locations[key];
      path.title = locations[key];
      button.disabled = !locations[`${key}Managed`];
    }
  } catch (error) {
    showToast(error.message, undefined, 'error');
  }
}
renderSettingsFolderRows();

function updateOnboardingLanguageCopy(nextLocale) {
  if (!onboardingPage || onboardingPreviewLocale === nextLocale) return;
  onboardingPreviewLocale = nextLocale;
  onboardingSelectedLocale = nextLocale;
  const [title, prompt, nextLabel] =
    onboardingLanguageCopy[nextLocale] || onboardingLanguageCopy.en;
  const page = onboardingPage;
  const nodes = page.querySelectorAll('.onboarding-page-copy');
  onboardingMotion?.destroy();
  onboardingPage.querySelector('.onboarding-rail').outerHTML = renderOnboardingRail(
    'language',
    nextLocale,
  );
  onboardingMotion = window.BreviaOnboardingMotion.mount(
    page.querySelector('.onboarding-rail'),
    'language',
    nextLocale,
  );
  onboardingPage.querySelector('h1').textContent = title;
  onboardingPage.querySelector('.language-picker').setAttribute('aria-label', prompt);
  onboardingPage.querySelector('.onboarding-page-copy p').textContent = prompt;
  onboardingPage.querySelector('[type="submit"]').innerHTML =
    `${escapeHtml(nextLabel)}${interfaceIcon('arrow-right')}`;
  onboardingPage.lang = nextLocale;
  nodes.forEach((node) => BreviaMotion.enter(node));
}

function revealOnboardingPage(page, kind) {
  const previous = onboardingPage;
  const steps = ['language', 'permissions', 'setup', 'ai', 'phone'];
  const back = steps.indexOf(kind) < steps.indexOf(previous?.dataset.onboardingStep);
  page.dataset.onboardingStep = kind;
  page.classList.add('onboarding-page-enter');
  onboardingPage = page;
  document.body.append(page);
  BreviaMotion.enter(page.querySelector('.onboarding-page-content'), back ? 'back' : 'forward');
  // 新页已挂载才移除旧页，异步准备期间不露出会议库或空背景。
  previous?.remove();
  focusForKeyboard(
    page.querySelector(
      '.onboarding-page-content button:not(:disabled), .onboarding-page-content input:not(:disabled)',
    ),
  );
}

function showOnboardingPage(kind, content) {
  onboardingMotion?.destroy();
  onboardingMotion = undefined;
  const page = document.createElement('main');
  page.className = `onboarding-page onboarding-active onboarding-${kind}-overlay`;
  page.innerHTML = `<header class="onboarding-window-bar" data-tauri-drag-region><strong data-tauri-drag-region translate="no">Brevia</strong></header>${renderOnboardingRail(kind)}<div class="onboarding-page-content onboarding-${kind}-content">${content}</div>`;
  revealOnboardingPage(page, kind);
  if (['language', 'permissions', 'setup', 'ai', 'phone'].includes(kind))
    onboardingMotion = window.BreviaOnboardingMotion.mount(
      onboardingPage.querySelector('.onboarding-rail'),
      kind,
      locale,
    );
}

function dismissOnboardingPage(next) {
  clearTimeout(onboardingAiDemoTimer);
  clearTimeout(onboardingSummaryDemoTimer);
  const page = onboardingPage;
  if (!page) return Promise.resolve();
  if (page.dismissPromise) return page.dismissPromise;
  if (next) {
    const motion = onboardingMotion;
    page.inert = true;
    void breviaClient?.stopPreview();
    page.dismissPromise = Promise.resolve()
      .then(next)
      .then(
        (result) => {
          if (result === false) {
            page.inert = false;
            delete page.dismissPromise;
            return;
          }
          if (onboardingMotion === motion) {
            motion?.destroy();
            onboardingMotion = undefined;
          }
          page.remove();
          if (onboardingPage === page) {
            onboardingPage = undefined;
            if (page.dataset.aiSettings === 'true' && settingsModal.hidden)
              document.body.classList.remove('modal-open');
          }
        },
        (error) => {
          page.inert = false;
          delete page.dismissPromise;
          throw error;
        },
      );
    return page.dismissPromise;
  }
  onboardingMotion?.destroy();
  onboardingMotion = undefined;
  void breviaClient?.stopPreview();
  page.inert = true;
  page.classList.remove('onboarding-page-enter');
  page.classList.add('onboarding-page-leave');
  if (page.dataset.aiSettings === 'true') {
    page.classList.remove('modal-enter');
    page.classList.add('modal-leave');
  }
  page.dismissPromise = new Promise((resolve) => {
    window.setTimeout(() => {
      page.remove();
      if (onboardingPage === page) {
        onboardingPage = undefined;
        if (page.dataset.aiSettings === 'true' && settingsModal.hidden)
          document.body.classList.remove('modal-open');
        next?.();
      }
      resolve();
    }, BreviaMotion.duration('state'));
  });
  return page.dismissPromise;
}

// 识别模型文案（8 语种）由 asr-copy.js 提供；这里只做取值与回退。
const asrText = (group, fallback = 'en') =>
  (asrCopy[group] || {})[locale] || (asrCopy[group] || {})[fallback] || {};
/** 首启只列出承担默认语言的模型，其余模型在设置中按需下载。@returns {object[]} */
function onboardingAsrModels() {
  const defaults = new Set(
    asrCopy.LOCALES.map((language) => manifestDefaultRefinedModelId(language)),
  );
  return refinedModels().filter((model) => !model.bundled && defaults.has(model.id));
}
/** 首启默认勾选：按界面语言推导的推荐模型。
 *
 * 用界面语言而不是让用户先选会议语言，是因为他在第 ① 步刚做过这个选择，因果关系自明。
 * @returns {string} 模型 id。 */
function onboardingRecommendedModelId() {
  return manifestDefaultRefinedModelId(locale) || DEFAULT_REFINED_MODEL_ID;
}
async function openOnboardingSetup() {
  try {
    if (initializationPromise) await initializationPromise;
  } catch (error) {
    showToast(`${t('配置或后端启动失败')}: ${userFacingError(error.message)}`, undefined, 'error');
    openOnboardingPermissions();
    return;
  }
  const copy = asrText('setup');
  const storageCopy = onboardingStorageCopy[locale] || onboardingStorageCopy.en;
  let locations;
  try {
    locations = await window.brevia.storage.locations();
  } catch (error) {
    showToast(error.message, undefined, 'error');
    return false;
  }
  const modelWords = asrText('model');
  const recommendedWords = asrCopy.recommended || {};
  const recommendedId = onboardingRecommendedModelId();
  const models = onboardingAsrModels();

  const cards = models
    .map((model) => {
      const installed = modelPaths.has(model.id);
      const words = modelWords[model.id] || {};
      const isRecommended = model.id === recommendedId;
      const badges = [
        isRecommended
          ? `<span class="asr-badge is-recommended">${escapeHtml(recommendedWords[locale] || '')}</span>`
          : '',
      ].join('');
      // 默认只勾选按界面语言推导的推荐模型。
      // 勾选只决定「这一轮下载哪几个」（updateOnboardingSetup 会把已安装的过滤掉），
      // 所以没有必要替用户把所有已安装的模型也预选上——那只是让用户多点几次取消。
      // 任何模型都不禁用：即使用户已经装过，他也必须能取消勾选。
      return (
        `<label class="onboarding-model-card${isRecommended ? ' is-recommended' : ''}">` +
        `<input type="checkbox" name="onboarding-model" value="${escapeHtml(model.id)}"` +
        `${isRecommended ? ' checked' : ''} />` +
        `<span class="asr-card-body">` +
        `<span class="asr-card-head"><b>${escapeHtml(model.name)}</b>${badges}</span>` +
        `<small class="asr-tagline" title="${escapeHtml(words.onboarding || words.tagline || '')}">${escapeHtml(words.onboarding || words.tagline || '')}</small>` +
        `<i class="asr-size">${installed ? (modelLabels[locale] || modelLabels.en).installed : formatBytes(model.size_bytes || 0)}</i>` +
        `</span></label>`
      );
    })
    .join('');

  const bundled = modelCatalog.filter((model) => model.bundled);
  const bundledSize = bundled.reduce((total, model) => total + (model.size_bytes || 0), 0);
  const bundledDetail = window.brevia?.nativeAudio
    ? bundled.map((model) => model.name).join(' · ')
    : copy.bundledDetail;
  const bundledRow =
    `<div class="onboarding-bundled"><span><b>${escapeHtml(copy.bundledTitle || '')}</b>` +
    `<small>${escapeHtml(bundledDetail || '')}</small></span>` +
    `<i>${escapeHtml(formatBytes(bundledSize))}</i></div>`;

  const storageRow = (key, label, managed) =>
    `<div class="onboarding-folder-row"><span><span><b>${escapeHtml(label)}</b><small>${escapeHtml(t(key === 'models' ? '保存语音识别模型文件' : '保存会议的原始录音文件'))}</small></span><small class="onboarding-folder-path" data-storage-path="${key}" title="${escapeHtml(locations[key])}">${escapeHtml(locations[key])}</small></span><button class="secondary" data-select-storage="${key}" type="button"${managed ? '' : ' disabled'}>${escapeHtml(storageCopy.choose)}</button></div>`;
  const storageRows = `<details class="onboarding-section onboarding-folder-section" open><summary>${escapeHtml(storageCopy.title)}${interfaceIcon('chevron-down')}</summary>${storageRow('models', storageCopy.models, locations.modelsManaged)}${storageRow('recordings', storageCopy.recordings, locations.recordingsManaged)}</details>`;

  showOnboardingPage(
    'setup',
    `<section class="onboarding-setup-page">` +
      `<header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${escapeHtml(copy.title || '')}</h1>` +
      `<div class="onboarding-intro"><p>${escapeHtml(copy.pickHint || '')}</p></div></header>` +
      `<div class="onboarding-setup-sections">` +
      storageRows +
      `<section class="onboarding-section onboarding-model-selection">` +
      `<div class="onboarding-model-heading"><h2>${t('选择模型')}</h2><div class="onboarding-model-source">${chinaModelSourceToggle()}</div></div><div class="onboarding-model-grid">${cards}</div></section>` +
      `<section class="onboarding-section onboarding-bundled-section">${bundledRow}</section>` +
      `</div>` +
      `<div class="onboarding-actions"><div class="onboarding-model-summary"><strong>${escapeHtml(copy.estimate || '')}: <span data-onboarding-estimate></span></strong><small data-onboarding-guard hidden>${escapeHtml(copy.atLeastOne || '')}</small></div><button class="secondary onboarding-previous" data-onboarding-back-language type="button">${t('上一步')}</button><button class="secondary" data-finish-onboarding type="button">${escapeHtml(copy.later || '')}</button><button class="modal-action" data-download-onboarding-models type="button">${escapeHtml(copy.download || '')}${interfaceIcon('arrow-right')}</button></div></section>`,
  );

  updateOnboardingSetup();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-model"]')) updateOnboardingSetup();
    if (event.target.matches('[data-china-model-source]'))
      localStorage.setItem('brevia-china-model-source', event.target.checked);
  });
  onboardingPage.addEventListener('click', async (event) => {
    if (event.target.closest('[data-onboarding-back-language]')) {
      dismissOnboardingPage(openOnboardingPermissions);
      return;
    }
    const select = event.target.closest('[data-select-storage]');
    if (select) {
      try {
        const directory = await window.brevia.storage.chooseFolder();
        if (directory) {
          locations[select.dataset.selectStorage] = directory;
          const path = onboardingPage.querySelector(
            `[data-storage-path="${select.dataset.selectStorage}"]`,
          );
          path.textContent = directory;
          path.title = directory;
        }
      } catch (error) {
        showToast(error.message, undefined, 'error');
      }
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
        const result = await window.brevia.storage.setupLocations({
          models: locations.models,
          recordings: locations.recordings,
        });
        if (result.data) applyInitializationResult(result.data);
        if (download) {
          window.BreviaOnboarding.beginDownloads(onboardingModelIds);
          downloadRequiredModels(onboardingModelIds);
        }
      });
      await dismissOnboardingPage(openOnboardingAi);
    } catch (error) {
      showToast(storageErrorMessage(error), undefined, 'error');
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

async function finishOnboarding() {
  const firstEntry = window.BreviaOnboarding.isFirstLaunch();
  const page = onboardingPage;
  window.BreviaOnboarding.complete();
  closeModal();
  if (!firstEntry || !page?.classList.contains('onboarding-page')) return;
  document.body.classList.add('onboarding-handoff');
  try {
    await showView('home');
    page.inert = true;
    page.style.pointerEvents = 'none';
    await BreviaMotion.welcome(page, document.querySelector('.app-shell'));
  } finally {
    page.remove();
    if (onboardingPage === page) onboardingPage = undefined;
    document.body.classList.remove('onboarding-handoff');
  }
}
// Onboarding 的 AI 辅助配置页（PRD §22）：离线功能配置之后进入。
const aiOnboardingCopy = window.BreviaLocaleData.appCopy.aiOnboardingCopy;
const aiOnboardingDemoCopy = window.BreviaLocaleData.appCopy.aiOnboardingDemoCopy;
// AI 会议纪要演示：会后左下角出现任务卡片（进度条），随后显示整理好的纪要。
const aiOnboardingSummaryDemoCopy = window.BreviaLocaleData.appCopy.aiOnboardingSummaryDemoCopy;
function openOnboardingAi(settingsMode = false) {
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  // 低配设备默认「暂不开启」实时 AI 笔记（太耗资源），仅保留会后一次性的 AI 会议纪要。
  const defaultProactivity = settingsMode
    ? aiAssistConfig.proactivity
    : deviceIsWeak()
      ? 'off'
      : 'assist';
  const levels = copy.levels
    .filter(([value]) => ['quiet', 'assist', 'auto'].includes(value))
    .map(([value]) => [value, t({ quiet: '手动', assist: '适度', auto: '主动' }[value])]);
  const summaryIcon = interfaceIcon('document');
  const notesIcon = interfaceIcon('ai');
  const content = `<section class="${settingsMode ? 'ai-features-content' : 'onboarding-setup-page'} onboarding-ai-setup-page">
    ${
      settingsMode
        ? ''
        : `<header><h1>${escapeHtml(copy.title)}</h1>${copy.intro ? `<div class="onboarding-intro"><p>${escapeHtml(copy.intro)}</p></div>` : ''}</header>`
    }
    <div class="onboarding-ai-sections"><section class="onboarding-section onboarding-ai-feature onboarding-ai-row">
      <div class="onboarding-ai-copy">
        <div class="onboarding-ai-feature-head"><span class="onboarding-ai-icon">${notesIcon}</span><h2>${escapeHtml(t('AI 笔记'))}</h2><span class="onboarding-ai-timing">${escapeHtml(copy.during)}</span><label class="onboarding-ai-switch"><input type="checkbox" name="onboarding-ai-enabled" aria-label="${escapeHtml(copy.enableLiveNotes)}"${(settingsMode ? aiAssistConfig.enabled : defaultProactivity !== 'off') ? ' checked' : ''} /></label></div>
        <p class="onboarding-ai-feature-desc">${escapeHtml(copy.liveNotesDesc)}</p>
        <div class="onboarding-ai-levels"><div class="flow-select onboarding-ai-segments" role="radiogroup" aria-label="${escapeHtml(copy.proactivityTitle)}"><input type="hidden" name="onboarding-ai-proactivity" value="${defaultProactivity === 'off' ? 'assist' : defaultProactivity}" /><div class="flow-select-options">${levels.map(([value, title]) => `<button type="button" role="radio" aria-checked="${value === (defaultProactivity === 'off' ? 'assist' : defaultProactivity)}" data-flow-select-choice="onboarding-ai-proactivity" data-value="${value}">${escapeHtml(title)}</button>`).join('')}</div></div></div>
        <dl class="onboarding-ai-mode-guide">${copy.levels
          .filter(([value]) => value !== 'off')
          .map(
            ([value, , description]) =>
              `<div><dt>${escapeHtml(t({ quiet: '手动', assist: '适度', auto: '主动' }[value]))}</dt><dd>${escapeHtml(description)}</dd></div>`,
          )
          .join('')}</dl>
        ${settingsMode ? `<button class="secondary" data-configure-ai-notes type="button">${escapeHtml(t('配置 AI 笔记'))}</button>` : ''}
      </div><div class="onboarding-ai-frame"><aside class="onboarding-ai-demo" data-onboarding-ai-demo></aside></div>
    </section>
    <section class="onboarding-section onboarding-ai-feature onboarding-ai-row">
      <div class="onboarding-ai-copy">
        <div class="onboarding-ai-feature-head"><span class="onboarding-ai-icon">${summaryIcon}</span><h2>${escapeHtml(copy.meetingNotesTitle)}</h2><span class="onboarding-ai-timing">${escapeHtml(copy.after)}</span><label class="onboarding-ai-switch"><input type="checkbox" name="onboarding-summary-enabled" aria-label="${escapeHtml(copy.meetingNotesTitle)}"${summaryConfig.enabled ? ' checked' : ''} /></label></div>
        <p class="onboarding-ai-feature-desc">${escapeHtml(copy.meetingNotesDesc)}</p><p class="onboarding-ai-scope">${escapeHtml(copy.summaryScope)}</p>
        ${settingsMode ? `<div class="onboarding-ai-ways"><label><input type="radio" name="onboarding-ai-way" value="built-in"${summaryConfig.provider === 'built-in' ? ' checked' : ''} /><span><b>${escapeHtml(copy.builtin)}</b><small>${escapeHtml(copy.builtinHint)}</small></span></label><label><input type="radio" name="onboarding-ai-way" value="online"${summaryConfig.provider !== 'built-in' ? ' checked' : ''} /><span><b>${escapeHtml(copy.online)}${recommendTag(deviceIsWeak())}</b><small>${escapeHtml(copy.onlineHint)}</small></span></label></div>` : ''}
        ${settingsMode ? `<button class="secondary" data-configure-ai-summary type="button">${escapeHtml(t('配置服务'))}</button>` : ''}
      </div><div class="onboarding-ai-frame" data-onboarding-summary-demo></div>
    </section>
    ${settingsMode ? '' : `<div class="onboarding-shared-service"><span>${interfaceIcon('model')}<b>${escapeHtml(copy.serviceTitle)}</b><small>${escapeHtml(copy.serviceHint)}</small></span><button class="secondary" data-configure-ai-summary type="button">${escapeHtml(t('配置服务'))}</button></div>`}
    ${settingsMode ? `<p class="onboarding-privacy-hint">${interfaceIcon('info')}${escapeHtml(t('在线 AI 会将相关文字发送至所选服务商。'))}</p>` : ''}</div>
    <footer class="onboarding-ai-footer">${settingsMode ? '' : `<p>${escapeHtml(copy.adjustHint)}</p>`}<div class="onboarding-actions">${settingsMode ? '' : `<button class="secondary onboarding-previous" data-onboarding-back-language type="button">${escapeHtml(t('上一步'))}</button>`}<button class="secondary" data-onboarding-ai-skip type="button">${escapeHtml(settingsMode ? t('取消') : copy.skip)}</button><button class="modal-action" data-onboarding-ai-finish type="button">${escapeHtml(settingsMode ? t('保存配置') : t('下一步'))}${settingsMode ? '' : interfaceIcon('arrow-right')}</button></div></footer>
  </section>`;
  if (settingsMode) {
    onboardingPage = document.createElement('div');
    onboardingPage.className = `modal-backdrop ai-features-modal${activeView === 'settings' ? ' settings-page' : ''}`;
    onboardingPage.innerHTML = `${activeView === 'settings' ? renderSettingsNavigation('ai-features') : ''}<section class="modal-panel" role="${activeView === 'settings' ? 'region' : 'dialog'}" aria-modal="${activeView !== 'settings'}" aria-labelledby="ai-features-title"><header class="modal-head"><div class="modal-title"><h2 id="ai-features-title">${escapeHtml(t('AI 功能'))}</h2></div><button class="modal-close" data-close-ai-features type="button" aria-label="${escapeHtml(t('关闭'))}">${interfaceIcon('close')}</button></header><div class="modal-body">${content}</div></section>`;
    onboardingPage.classList.add('modal-enter');
    document.body.append(onboardingPage);
    document.body.classList.add('modal-open');
  } else showOnboardingPage('ai', content);
  onboardingPage.dataset.aiSettings = String(settingsMode);
  onboardingPage.querySelector('.onboarding-ai-segments').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll('[role="radio"]:not(:disabled)')];
    const selected = options.indexOf(document.activeElement);
    if (selected < 0) return;
    event.preventDefault();
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (selected + (event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
    options[index].focus();
    options[index].click();
  });
  renderOnboardingAiDemo();
  renderOnboardingSummaryDemo();
  const syncSummarySwitch = () => {
    const enabled = onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked;
    const serviceEnabled = settingsMode
      ? enabled
      : enabled || onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked;
    onboardingPage.querySelectorAll('[name="onboarding-ai-way"]').forEach((option) => {
      option.disabled = !serviceEnabled;
    });
    onboardingPage.querySelector('[data-configure-ai-summary]').disabled = settingsMode
      ? !enabled
      : !enabled && !onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked;
    onboardingPage
      .querySelector('[data-onboarding-summary-demo]')
      .classList.toggle('is-disabled', !enabled);
    renderOnboardingSummaryDemo();
  };
  syncSummarySwitch();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-summary-enabled"]')) syncSummarySwitch();
    if (
      event.target.matches('[name="onboarding-ai-proactivity"], [name="onboarding-ai-enabled"]')
    ) {
      renderOnboardingAiDemo();
      if (event.target.matches('[name="onboarding-ai-enabled"]')) syncSummarySwitch();
    }
  });
  onboardingPage.addEventListener('click', (event) => {
    const destination = event.target.closest('[data-settings-page]');
    if (destination) {
      const kind = destination.dataset.settingsPage;
      if (kind !== 'ai-features')
        dismissOnboardingPage(() => {
          if (kind !== 'general') return openModal(kind);
        });
      return;
    }
    if (
      settingsMode &&
      (event.target === onboardingPage || event.target.closest('[data-close-ai-features]'))
    ) {
      dismissOnboardingPage();
      return;
    }
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
      select.querySelectorAll('[role="radio"]').forEach((option) => {
        option.setAttribute('aria-checked', String(option === choice));
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const aiWay = event.target.closest('.onboarding-ai-ways label');
    if (aiWay || event.target.closest('[data-configure-ai-summary]')) {
      if (
        settingsMode &&
        !onboardingPage.querySelector('[name="onboarding-summary-enabled"]').checked
      )
        return;
      onboardingOnlineProvider =
        settingsMode &&
        (
          aiWay?.querySelector('input') ||
          onboardingPage.querySelector('[name="onboarding-ai-way"]:checked')
        ).value !== 'built-in';
      onboardingBuiltinProvider = !settingsMode || !onboardingOnlineProvider;
      summaryConfigDraft = structuredClone(summaryConfig);
      summaryConfigDraft.provider = !settingsMode
        ? summaryConfig.provider
        : onboardingOnlineProvider
          ? summaryConfig.provider === 'built-in'
            ? 'openai'
            : summaryConfig.provider
          : 'built-in';
      openModal('summary-model');
      return;
    }
    if (event.target.closest('[data-configure-ai-notes]')) {
      aiAssistConfigDraft = structuredClone(aiAssistConfig);
      aiAssistConfigDraft.enabled = onboardingPage.querySelector(
        '[name="onboarding-ai-enabled"]',
      ).checked;
      aiAssistConfigDraft.proactivity =
        onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value || 'assist';
      openModal('ai-assist');
      return;
    }
    if (event.target.closest('[data-onboarding-back-language]')) {
      dismissOnboardingPage(settingsMode ? undefined : openOnboardingSetup);
      return;
    }
    if (event.target.closest('[data-onboarding-ai-finish]')) {
      void finishAiOnboarding(undefined, settingsMode);
      return;
    }
    if (event.target.closest('[data-onboarding-ai-skip]')) {
      if (settingsMode) dismissOnboardingPage();
      else void finishAiOnboarding(false);
      return;
    }
  });
}
async function finishAiOnboarding(forceEnabled, settingsMode = false) {
  const proactivity =
    onboardingPage.querySelector('[name="onboarding-ai-proactivity"]')?.value || 'assist';
  const enabled =
    typeof forceEnabled === 'boolean'
      ? forceEnabled
      : onboardingPage.querySelector('[name="onboarding-ai-enabled"]')?.checked;
  const summaryEnabled =
    forceEnabled === false
      ? false
      : Boolean(onboardingPage.querySelector('[name="onboarding-summary-enabled"]')?.checked);
  if (settingsMode) {
    const ready = (config) => {
      const connection = requestConfig(config);
      return connection && (connection.provider !== 'built-in' || modelPaths.has(connection.model));
    };
    if (summaryEnabled && !ready(summaryConfig)) {
      showToast(t('请先选择或填写纪要模型。'));
      return;
    }
    if (enabled && !ready(aiAssistConfig)) {
      showToast(t('请先选择或填写 AI 笔记模型。'));
      return;
    }
  }
  // 首启只有一个服务入口，沿用两种配置的存储结构，共用连接与密钥引用。
  if (!settingsMode) {
    aiAssistConfig.provider = summaryConfig.provider;
    aiAssistConfig.providers = structuredClone(summaryConfig.providers);
  }
  summaryConfig.enabled = summaryEnabled;
  summaryConfigRevision += 1;
  aiAssistConfig.enabled = enabled;
  aiAssistConfig.proactivity = ['quiet', 'assist', 'auto'].includes(proactivity)
    ? proactivity
    : 'assist';
  aiAssistConfigRevision += 1;
  try {
    await Promise.all([persistSummaryConfig(), persistAiAssistConfig()]);
  } catch (error) {
    showToast(error.message, undefined, 'error');
    return;
  }
  if (settingsMode) {
    aiAssistTemporarilyDisabled = false;
    renderAiAssistToggle();
    const meetingId = breviaClient?.state.meeting?.id;
    if (meetingActive && meetingId) {
      if (aiAssistEnabled()) void startAiNoteForMeeting(meetingId);
      else stopAiNoteForMeeting(meetingId);
    }
    dismissOnboardingPage();
    showToast(t('已保存'), undefined, 'success');
  } else dismissOnboardingPage(openOnboardingMobile);
}

function openOnboardingMobile() {
  const platforms = (mobileConnectionContent || document.getElementById('mobile-dialog'))
    .querySelector('.mobile-install-platforms')
    .cloneNode(true);
  platforms.querySelectorAll('.mobile-install-platform').forEach((platform) => {
    const heading = platform.querySelector('h4');
    const android = heading.textContent.includes('Android');
    heading.querySelector('[data-interface-icon]').innerHTML = interfaceIcon('phone');
    const qr = platform.querySelector('.mobile-install-qr');
    const body = platform.querySelector(':scope > div');
    body.querySelector('p').remove();
    platform.prepend(heading, qr);
    body.insertAdjacentHTML(
      'afterbegin',
      `<b class="onboarding-install-scan">${escapeHtml(t(android ? '扫码下载 Android APK' : '扫码安装 Brevia'))}</b>`,
    );
  });
  // 原模板 iPhone 在前；引导按设计把 Android 放在左侧。
  platforms.prepend(platforms.lastElementChild);
  showOnboardingPage(
    'phone',
    `<section class="onboarding-setup-page onboarding-mobile-page">
      <header><h1>${t('连接你的手机')}</h1><div class="onboarding-intro"><p>${t('手机录音，电脑转写。也可以离线录音，稍后确认上传。')}</p></div></header>
      <section class="onboarding-section onboarding-mobile-downloads">${platforms.outerHTML}</section>
      <div class="onboarding-phone-mechanism"><span>${interfaceIcon('phone')}<span><b>${t('手机采集与保存')}</b><small>${t('在手机上录制会议或对话，录音保存在手机中。')}</small></span></span><i aria-hidden="true">${interfaceIcon('arrow-right')}</i><span>${interfaceIcon('laptop')}<span><b>${t('电脑转写与 AI 整理')}</b><small>${t('连接电脑后转写并整理会议内容。')}</small></span></span></div>
      <div class="onboarding-phone-pair"><b>${t('已安装手机端？')}</b><small>${t('在手机上打开 Brevia，连接新设备，开始使用。')}</small><button class="modal-action" data-onboarding-mobile-pair type="button">${t('连接新设备')}</button></div>
      <div class="onboarding-actions"><button class="secondary onboarding-previous" data-onboarding-mobile-back type="button">${t('上一步')}</button><button class="secondary" data-onboarding-mobile-skip type="button">${t('稍后')}</button><button class="modal-action" data-onboarding-mobile-next type="button">${t('开始使用')}</button></div>
    </section>`,
  );
  onboardingPage.addEventListener('click', (event) => {
    if (event.target.closest('[data-onboarding-mobile-pair]'))
      (mobileConnectionContent || document.getElementById('mobile-dialog'))
        .querySelector('#mobile-pair')
        .click();
    else if (event.target.closest('[data-onboarding-mobile-back]'))
      dismissOnboardingPage(openOnboardingAi);
    else if (event.target.closest('[data-onboarding-mobile-skip], [data-onboarding-mobile-next]'))
      dismissOnboardingPage(finishOnboarding);
  });
}

function openOnboardingPermissions(fixtureStatus) {
  const copy = onboardingCopy[locale] || onboardingCopy.en;
  const steps = [
    ['microphone', t('麦克风')],
    ['screen', t('系统音频')],
  ];
  const placeholders = steps
    .map(
      ([permission, label]) =>
        `<div class="onboarding-permission" aria-busy="true">${interfaceIcon(permission === 'microphone' ? 'microphone' : 'appearance')}<span class="onboarding-permission-copy"><b>${label}</b></span><span class="permission-status">${t('加载中')}</span></div>`,
    )
    .join('');
  showOnboardingPage(
    'permissions',
    `<section class="onboarding-setup-page onboarding-permissions-page"><header><h1>${t('准备好记录对话')}</h1><div class="onboarding-intro"><p>${t('按需授权，可随时在系统设置中更改。')}</p></div></header><section class="onboarding-section" data-onboarding-permissions>${placeholders}</section><p class="onboarding-privacy-hint">${interfaceIcon('info')}${t('仅使用麦克风时，可以稍后设置系统音频。')}</p><div class="onboarding-actions"><button class="secondary onboarding-previous" data-onboarding-back-language type="button">${t('上一步')}</button><button class="secondary" data-skip-onboarding-permissions type="button">${copy.later}</button><button class="modal-action" data-finish-onboarding type="button" disabled>${t('下一步')}${interfaceIcon('arrow-right')}</button></div></section>`,
  );
  const page = onboardingPage;
  const section = onboardingPage.querySelector('[data-onboarding-permissions]');
  const continueButton = onboardingPage.querySelector('[data-finish-onboarding]');
  let microphonePreviewed = false;
  let renderedStatus;
  const render = async () => {
    // 隔离截图可传固定权限状态；正常入口始终读取操作系统。
    const status = fixtureStatus || (await window.brevia.permissions.status());
    if (onboardingPage !== page) return;
    const signature = JSON.stringify([
      status,
      unknownScreenLabel(),
      [...grantedPermissions],
      [...permissionRequests],
    ]);
    if (signature === renderedStatus) return;
    renderedStatus = signature;
    const permissionGranted = (permission) =>
      grantedPermissions.has(permission) ||
      status[permission] === 'granted' ||
      (permission === 'screen' && systemAudioAllowed(status));
    section.innerHTML = steps
      .map(([permission, label]) => {
        const unsupported = permission === 'screen' && status.systemAudioSupported === false;
        const granted = permissionGranted(permission);
        const value = granted ? 'granted' : status[permission];
        const uncertain = permission === 'screen' && value === 'unknown';
        const pending = permissionRequests.has(permission);
        const canRequest =
          !['denied', 'restricted'].includes(value) &&
          (permission === 'screen' || value === 'not-determined');
        const action = granted
          ? ''
          : unsupported
            ? `<button class="secondary onboarding-permission-action" type="button" disabled>${t('不可用')}</button>`
            : `<button class="modal-action onboarding-permission-action" data-request-onboarding-permission="${permission}"${canRequest ? '' : ' data-permission-settings'} type="button" title="${escapeHtml(!canRequest ? permissionSettingsPath(permission, status) : uncertain && screenProbe === null ? t('播放其他应用的声音后重新检测。') : label)}"${pending ? ' disabled aria-busy="true"' : ''}>${t(pending ? '正在请求权限…' : uncertain && screenProbe !== undefined ? '重新检测' : '申请权限')}</button>`;
        const meter =
          permission === 'microphone' && granted
            ? `<i class="input-meter onboarding-mic-meter" data-onboarding-mic-level aria-label="${t('麦克风')} ${t('音量')}"></i>`
            : '';
        return `<div class="onboarding-permission${granted ? ' is-granted' : ''}">${interfaceIcon(permission === 'microphone' ? 'microphone' : 'appearance')}<span class="onboarding-permission-copy"><span class="onboarding-permission-title"><b>${label}</b>${meter}</span></span><span class="permission-status${granted ? ' is-granted' : value === 'denied' ? ' is-denied' : ''}">${granted ? checkIconSvg + t('已允许') : unsupported ? '' : t(uncertain ? unknownScreenLabel() : '未授权')}</span>${action}</div>`;
      })
      .join('');
    if (permissionGranted('microphone') && !microphonePreviewed) {
      microphonePreviewed = true;
      void breviaClient?.previewMic().catch((error) => {
        microphonePreviewed = false;
        showToast(error.message, undefined, 'error');
      });
    }
    if (!permissionGranted('microphone') && microphonePreviewed) {
      microphonePreviewed = false;
      void breviaClient?.stopPreview();
    }
    continueButton.disabled = !permissionGranted('microphone');
  };
  const grantedPermissions = new Set();
  const refresh = () =>
    render().catch((error) => {
      if (onboardingPage === page) showToast(error.message, undefined, 'error');
    });
  void refresh();
  const permissionPoll = window.setInterval(() => {
    if (onboardingPage !== page) {
      window.clearInterval(permissionPoll);
      return;
    }
    void refresh();
  }, 1000);
  onboardingPage.addEventListener('click', async (event) => {
    if (event.target.closest('[data-onboarding-back-language]')) {
      dismissOnboardingPage(() => openOnboardingLanguage(onboardingSelectedLocale));
      return;
    }
    if (event.target.closest('[data-finish-onboarding]')) {
      dismissOnboardingPage(openOnboardingSetup);
      return;
    }
    if (event.target.closest('[data-skip-onboarding-permissions]')) {
      dismissOnboardingPage(openOnboardingSetup);
      return;
    }
    const button = event.target.closest('[data-request-onboarding-permission]');
    if (!button) return;
    const kind = button.dataset.requestOnboardingPermission;
    if (permissionRequests.has(kind)) return;
    permissionRequests.add(kind);
    void refresh();
    try {
      if (button.hasAttribute('data-permission-settings')) {
        await (kind === 'screen'
          ? window.brevia.permissions.openScreenSettings()
          : window.brevia.permissions.openMicrophoneSettings());
      } else if ((await requestPermissionAccess(kind)) === true && kind !== 'screen')
        grantedPermissions.add(kind);
    } catch (error) {
      showToast(error.message, undefined, 'error');
    } finally {
      permissionRequests.delete(kind);
      await refresh();
    }
  });
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-settings-modal]');
  if (button) {
    await openModal(button.dataset.settingsModal);
    return;
  }
  if (!event.target.closest('#settings-view, .settings-folder-paths')) return;
  const destination = event.target.closest('[data-settings-page]');
  if (destination) {
    if (destination.dataset.settingsPage !== 'general')
      await openModal(destination.dataset.settingsPage);
    return;
  }
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) {
    const choices = toggle.parentElement.querySelector('.flow-select-options');
    choices.hidden = !choices.hidden;
    fitFlowSelectOptions(choices, toggle);
    toggle.setAttribute('aria-expanded', String(!choices.hidden));
    return;
  }
  const preference = event.target.closest('[data-flow-select-choice]');
  if (preference?.dataset.flowSelectChoice === 'interface-language') {
    applyLanguage(preference.dataset.value);
    return;
  }
  if (preference?.dataset.flowSelectChoice === 'interface-theme') {
    applyTheme(preference.dataset.value);
    const control = preference.closest('.flow-select');
    control.querySelector('input').value = preference.dataset.value;
    control.querySelector('.flow-select-toggle').firstChild.nodeValue = preference.dataset.label;
    control.querySelector('.flow-select-options').hidden = true;
    control.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
    return;
  }
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
        const result = await window.brevia.storage.setupLocations({
          ...locations,
          [folder.dataset.changeFolder]: chosen,
        });
        if (result.data) {
          applyInitializationResult(result.data);
          if (currentMeetingDetail?.id)
            applyBackendDetail(
              await window.brevia.meeting.get({ meeting_id: currentMeetingDetail.id }),
            );
        }
        await refreshSettingsFolderRows();
        if (result.changed)
          showToast(
            (onboardingStorageCopy[locale] || onboardingStorageCopy.en).moved,
            undefined,
            'success',
          );
      });
    } catch (error) {
      showToast(storageErrorMessage(error), undefined, 'error');
    } finally {
      folder.disabled = false;
    }
    return;
  }
  if (event.target.closest('[data-open-whats-new]')) openModal('whats-new');
});
speakerProfileCard
  .querySelector('button')
  .addEventListener('click', () => openModal('speaker-profiles'));
// 模型是否已安装只由 modelPaths 表示（后端每次 models.list() 都会给出权威 path）。
// 这里以前还维护过一份 installedModelNames（按显示名，靠 `.replace(' 0.6B int8', '')`
// 去凑 i18n 里的名字），但它没有任何读者：installModel / deleteInstalledModel /
// isModelInstalled 三个函数只是为了喂它。整条链路已删除。
const modelPaths = new Map();
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
      queueModelTask(
        'meeting.reconfigure',
        { meeting_id: meetingId, ...changes },
        result.model_required,
      );
      downloadRequiredModels(result.model_required);
      activateTaskCard(document.querySelector('#model-download-queue'));
      showToast(t('正在下载模型，完成后会自动切换'));
      return false;
    }
    return true;
  } catch (error) {
    liveConfig = previous;
    showToast(error.message, undefined, 'error');
    return false;
  }
}
settingsModal.addEventListener('toggle', (event) => {
  if (
    event.newState === 'closed' &&
    settingsModal.hasAttribute('popover') &&
    !settingsModal.matches(':popover-open')
  )
    closeModal();
});
settingsModal.addEventListener('click', async (event) => {
  const agentEnable = event.target.closest('[data-agent-enable]');
  if (agentEnable) {
    await enableAgentAccess();
    return;
  }
  const agentCopy = event.target.closest('[data-agent-copy]');
  if (agentCopy) {
    try {
      const text =
        agentCopy.dataset.agentCopy === 'guide'
          ? agentSetupGuide()
          : agentCopy.dataset.agentCopy === 'mcp'
            ? JSON.stringify({ mcpServers: { brevia: agentSettings.mcp } }, null, 2)
            : agentCopy.dataset.agentCopy === 'prompt'
              ? agentCopy.dataset.agentPrompt
              : agentSettings.cli_path;
      await window.brevia.share.copyText({ text });
      const icon = agentCopy.querySelector('[data-copy-icon]');
      if (icon) {
        clearTimeout(agentCopy.copyFeedbackTimer);
        icon.innerHTML = interfaceIcon('check');
        agentCopy.dataset.copyState = 'done';
        agentCopy.setAttribute('aria-label', t('已复制到剪贴板'));
        agentCopy.copyFeedbackTimer = setTimeout(() => {
          icon.innerHTML = interfaceIcon('copy');
          delete agentCopy.dataset.copyState;
          agentCopy.removeAttribute('aria-label');
          if (agentCopy.dataset.agentCopy === 'guide')
            agentCopy.setAttribute('aria-label', t('复制引导语'));
        }, 1800);
      } else showToast(t('已复制到剪贴板'), undefined, 'success');
    } catch (error) {
      showToast(error.detail || error.message, undefined, 'error');
    }
    return;
  }
  if (event.target.closest('[data-update-log-dismiss]')) {
    closeModal();
    return;
  }
  if (event.target.closest('[data-update-log-about]')) {
    const origin = { view: activeView, focus: modalReturnFocus };
    closeModal();
    await new Promise((resolve) => setTimeout(resolve, 240));
    await showView('settings');
    await openModal('whats-new');
    updateLogReturn = origin;
    return;
  }
  if (event.target.closest('[data-cancel-model-config]')) {
    closeModal();
    return;
  }
  if (event.target.closest('[data-check-app-update]')) {
    await checkForUpdates();
    return;
  }
  const exampleAction = event.target.closest('[data-ai-example-action]');
  if (exampleAction) {
    operateAiSettingsExample(exampleAction);
    return;
  }
  const aiTab = event.target.closest('[data-ai-settings-tab]');
  if (aiTab) {
    await openModal(aiTab.dataset.aiSettingsTab);
    return;
  }
  const secret = event.target.closest('[data-toggle-secret]');
  if (secret) {
    const input = secret.parentElement.querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    secret.setAttribute('aria-pressed', String(input.type === 'text'));
    return;
  }
  const modelTab = event.target.closest('[data-model-library-tab]');
  if (modelTab) {
    modelLibraryTab = modelTab.dataset.modelLibraryTab;
    renderModelLibrary();
    return;
  }
  const cancelModel = event.target.closest('[data-cancel-required]');
  if (cancelModel) {
    await cancelModelDownload(cancelModel.dataset.cancelRequired);
    return;
  }
  const pauseModel = event.target.closest('[data-pause-required]');
  if (pauseModel) {
    const id = pauseModel.dataset.pauseRequired;
    try {
      if (modelDownloads.get(id)?.paused) await downloadRequiredModel(id);
      else await window.brevia.models.pause({ model_id: id });
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const rename = event.target.closest('button[data-rename-speaker-profile]');
  if (rename) {
    editingSpeakerProfileId = rename.dataset.renameSpeakerProfile;
    renderSpeakerProfileModal();
    return;
  }
  const page = event.target.closest('[data-settings-page]');
  if (page) {
    if (page.dataset.settingsPage === 'general') closeModal();
    else await openModal(page.dataset.settingsPage);
    return;
  }
  if (event.target.closest('.modal-close') && activeModal === 'models' && modelsReturnTo) {
    activeModal = modelsReturnTo;
    modelsReturnTo = modelsReturnToPending = null;
    renderModal(activeModal);
    return;
  }
  if (event.target === settingsModal && activeModal === 'upgrade-log') return;
  if (event.target === settingsModal || event.target.closest('.modal-close')) {
    closeModal();
    return;
  }
  if (event.target.closest('[data-cancel-confirmation]')) {
    confirmationAction = undefined;
    closeModal();
    return;
  }
  if (event.target.closest('[data-use-ai-2b]')) {
    // switchAiAssistTo2B 自带成功/失败 toast。仅当是从「AI 笔记」或「性能」设置框
    // 进入时重渲染该框；从会中瓶颈弹窗进入（activeModal 为空）则保持弹窗不跳走。
    await switchAiAssistTo2B();
    if (activeModal === 'ai-assist') renderModal(activeModal);
    return;
  }
  if (event.target.closest('[data-disable-ai-assist]')) {
    temporarilyDisableAiAssist();
    closeModal();
    return;
  }
  if (event.target.closest('[data-reset-advanced-settings]')) {
    const form = settingsModal.querySelector('.advanced-settings-form');
    // 只恢复当前可见项，保留另一引擎的参数和历史兼容字段。
    for (const input of form.querySelectorAll('input[name]')) {
      input.value = input.name
        .split('.')
        .reduce((values, key) => values[key], advancedSettings.defaults);
    }
    validateAdvancedSettings(form);
    const status = form.querySelector('.save-state');
    if (status) status.outerHTML = renderSaveState('dirty');
    return;
  }
  const openPermission = event.target.closest('[data-open-permission-settings]');
  if (openPermission) {
    try {
      await (openPermission.dataset.openPermissionSettings === 'screen'
        ? window.brevia.permissions.openScreenSettings()
        : window.brevia.permissions.openMicrophoneSettings());
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const requestPermission = event.target.closest('[data-request-permission]');
  if (requestPermission) {
    const kind = requestPermission.dataset.requestPermission;
    if (permissionRequests.has(kind)) return;
    permissionRequests.add(kind);
    refreshPermissionSettings();
    try {
      await requestPermissionAccess(kind);
    } catch (error) {
      showToast(error.message, undefined, 'error');
    } finally {
      permissionStatus = await window.brevia?.permissions.status().catch(() => permissionStatus);
      permissionRequests.delete(kind);
      refreshPermissionSettings();
    }
    return;
  }
  if (event.target.closest('[data-confirm-action]')) {
    const action = confirmationAction;
    confirmationAction = undefined;
    closeModal();
    await action?.();
    return;
  }
  const batchExportFormat = event.target.closest('[data-batch-export-format]');
  if (batchExportFormat) {
    const content = settingsModal.querySelector('[data-batch-export-content]').value;
    closeModal();
    void exportSelectedMeetings(batchExportFormat.dataset.batchExportFormat, content);
    return;
  }
  const openStorage = event.target.closest('[data-open-storage]');
  if (openStorage) {
    try {
      await window.brevia?.storage.open({ partition: openStorage.dataset.openStorage });
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const clearStorage = event.target.closest('[data-clear-storage]');
  if (clearStorage) {
    const partition = clearStorage.dataset.clearStorage;
    openConfirmation(
      t(partition === 'models' ? '清空模型' : '清空会议数据'),
      t('此操作不可恢复。'),
      async () => {
        try {
          if (partition === 'meetings') {
            playerAudio.pause();
            playerAudio.removeAttribute('src');
            playerAudio.load();
            playbackStarted = false;
            renderMiniPlayback();
          }
          storageUsage = await window.brevia?.storage.clear({ partition });
          if (partition === 'meetings') {
            scheduleLibraryMetrics();
            currentMeetingDetail = null;
            if (breviaClient) breviaClient.state.selectedMeetingId = null;
            try {
              localStorage.removeItem(meetingCacheKey);
            } catch {
              /* 浏览器存储不可用时，仍以后端列表为准。 */
            }
            await refreshBackendMeetings();
          }
          updateStorageUsage();
          void refreshSettingsFolderRows();
          showToast(t('已清空'), undefined, 'success');
        } catch (error) {
          showToast(error.message, undefined, 'error');
        }
      },
      clearStorage,
    );
    return;
  }
  if (event.target.closest('[data-cleanup-storage]')) {
    try {
      const result = await window.brevia?.storage.cleanup();
      updateStorageUsage();
      void refreshSettingsFolderRows();
      const copy = storageCleanupCopy[locale] || storageCleanupCopy.en;
      showToast(copy.done.replace('{size}', formatBytes(result.freed_bytes)), undefined, 'success');
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const sync = event.target.closest('[data-sync-note]');
  if (sync) {
    const section = sync.closest('.export-markdown');
    const meeting_id = sync.closest('[data-export-meeting]').dataset.exportMeeting;
    const wf = (exportHubCopy[locale] || exportHubCopy.en).workflow;
    const buttons = section.querySelectorAll('button');
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await window.brevia.meeting.syncMarkdown({
        meeting_id,
        mode: sync.dataset.syncNote,
      });
      if (
        !result ||
        !section.isConnected ||
        settingsModal.hidden ||
        currentMeetingDetail?.id !== meeting_id
      )
        return;
      if (result.status === 'conflict') {
        const status = section.querySelector('[data-sync-status]');
        status.textContent = result.recoveryPath
          ? wf.recovered.replace('{path}', () => result.recoveryPath)
          : wf.conflict;
        status.hidden = false;
        const primary = section.querySelector('[data-sync-note]');
        primary.dataset.syncNote = 'copy';
        primary.textContent = wf.copyNote;
      } else {
        exportMarkdownTarget = result;
        renderExportModal();
        settingsModal.querySelector('[data-sync-note]')?.focus();
        showToast(t('已保存'), undefined, 'success');
      }
    } catch (error) {
      showToast(error.message, undefined, 'error');
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
    return;
  }
  const send = event.target.closest('[data-group-send]');
  if (send) {
    const group = send.closest('.export-group-bot');
    const address = group.querySelector('[data-group-address]');
    const status = group.querySelector('[data-group-status]');
    const wf = (exportHubCopy[locale] || exportHubCopy.en).workflow;
    const meeting_id = send.closest('[data-export-meeting]').dataset.exportMeeting;
    send.disabled = true;
    try {
      const result = await window.brevia.share.groupSummary({
        meeting_id,
        address: address.value.trim(),
      });
      status.textContent =
        result === 'sent'
          ? wf.sent
          : result === 'address'
            ? wf.address
            : result === 'size'
              ? wf.size
              : wf.failed;
      if (result === 'sent') address.value = '';
      if (result === 'address') address.focus();
    } catch {
      status.textContent = wf.failed;
    } finally {
      status.hidden = false;
      send.disabled = false;
    }
    return;
  }
  const exportSave = event.target.closest('[data-export-save]');
  if (exportSave) {
    const revision = modalRequestRevision;
    const title = currentMeetingDetail?.title || '';
    exportSave.disabled = true;
    try {
      const result = await runExportBundle('save');
      if (result && result.count !== null) {
        if (revision === modalRequestRevision && exportSave.isConnected) closeModal();
        const copy = exportHubCopy[locale] || exportHubCopy.en;
        showToast(
          result.count > 1 ? copy.savedBundle : t('已导出「{title}」').replace('{title}', title),
          undefined,
          'success',
        );
      } else if (revision === modalRequestRevision && exportSave.isConnected)
        updateExportBuilderState();
    } catch (error) {
      if (revision === modalRequestRevision && exportSave.isConnected) updateExportBuilderState();
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const shareTarget = event.target.closest('[data-share-target]');
  if (shareTarget) {
    const target = shareTarget.dataset.shareTarget;
    const revision = modalRequestRevision;
    const ownsPopover = () => revision === modalRequestRevision && shareTarget.isConnected;
    shareTarget.disabled = true;
    try {
      if (target === 'system') {
        // 原生分享面板:把所选文件(多项时打包)交给系统,可转发到 AirDrop / 微信 / 邮件等任意 App。
        // 传点击坐标让弹窗锚定在按钮处;不关闭面板,否则原生弹窗会孤立浮现。
        await runExportBundle('system', {
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
        });
        if (ownsPopover()) updateExportBuilderState();
      } else {
        const text = exportShareText();
        if (!text) throw new Error(t('暂无可分享的内容'));
        if (target === 'copy') {
          await window.brevia?.share.copyText({ text });
          if (ownsPopover()) closeModal();
          showToast(t('已复制到剪贴板'), undefined, 'success');
        } else if (target === 'email') {
          const subject = currentMeetingDetail?.title || '';
          await window.brevia?.share.openExternal({ url: buildMailto(subject, text) });
          if (ownsPopover()) closeModal();
        } else {
          const spec = shareSocialUrls[target];
          const title = currentMeetingDetail?.title || '';
          const combined = title && text ? `${title}\n\n${text}` : title || text;
          const excerpt = makeExcerpt(combined, spec.limit);
          if (!excerpt) throw new Error(t('暂无可分享的内容'));
          await window.brevia?.share.openExternal({ url: spec.url(excerpt) });
          if (ownsPopover()) closeModal();
        }
      }
    } catch (error) {
      if (ownsPopover()) updateExportBuilderState();
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const selectToggle = event.target.closest('[data-flow-select-toggle]');
  if (selectToggle) {
    const options = selectToggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    settingsModal.querySelectorAll('.flow-select-options').forEach((list) => {
      list.hidden = true;
      list.previousElementSibling.previousElementSibling?.setAttribute('aria-expanded', 'false');
    });
    options.hidden = !opening;
    fitFlowSelectOptions(options, selectToggle);
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
    select.querySelector('.flow-select-toggle').firstChild.nodeValue =
      selectChoice.dataset.label || selectChoice.textContent;
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
      modelCatalog
        .filter((model) => model.kind === 'llama-chat' && !modelPaths.has(model.id))
        .map((model) => model.id),
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
      try {
        speakerSamples.set(
          profileId,
          await window.brevia.speakerProfile.samples({ profile_id: profileId }),
        );
      } catch (error) {
        showToast(error.message, undefined, 'error');
      }
    }
    renderModal('speaker-profiles');
    return;
  }
  const playSpeakerSample = event.target.closest('[data-play-speaker-sample]');
  if (playSpeakerSample) {
    if (speakerSampleAudio._button === playSpeakerSample && !speakerSampleAudio.paused) {
      speakerSampleAudio.pause();
      playSpeakerSample.innerHTML = interfaceIcon('play');
      return;
    }
    speakerSampleAudio.pause();
    if (speakerSampleAudio._button) speakerSampleAudio._button.innerHTML = interfaceIcon('play');
    const sample = [...speakerSamples.values()]
      .flat()
      .find((item) => item.id === playSpeakerSample.dataset.playSpeakerSample);
    if (!sample?.audio_path) {
      showToast(t('未找到录音文件'));
      return;
    }
    try {
      speakerSampleAudio.src = await window.brevia.audioUrl(sample.audio_path);
      speakerSampleAudio._button = playSpeakerSample;
      await speakerSampleAudio.play();
      playSpeakerSample.innerHTML = interfaceIcon('pause');
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  const deleteSpeakerSample = event.target.closest('[data-delete-speaker-sample]');
  if (deleteSpeakerSample) {
    if (deleteSpeakerSample.disabled) return;
    deleteSpeakerSample.disabled = true;
    const profileId = deleteSpeakerSample.dataset.profileId;
    try {
      await window.brevia?.speakerProfile.deleteSample({
        profile_id: profileId,
        sample_id: deleteSpeakerSample.dataset.deleteSpeakerSample,
      });
      speakerProfiles = await window.brevia.speakerProfile.list();
      speakerSamples.set(
        profileId,
        await window.brevia.speakerProfile.samples({ profile_id: profileId }),
      );
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    renderModal('speaker-profiles');
    return;
  }
  const deleteSpeakerProfile = event.target.closest('[data-delete-speaker-profile]');
  if (deleteSpeakerProfile) {
    try {
      await window.brevia?.speakerProfile.delete({
        profile_id: deleteSpeakerProfile.dataset.deleteSpeakerProfile,
      });
      speakerProfiles = await window.brevia.speakerProfile.list();
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    renderModal('speaker-profiles');
    return;
  }
  const verifySpeakerProfile = event.target.closest('[data-verify-speaker-profile]');
  if (verifySpeakerProfile) {
    try {
      const result = await window.brevia?.speakerProfile.verify({
        profile_id: verifySpeakerProfile.dataset.verifySpeakerProfile,
      });
      if (result)
        showToast(
          `${result.name}: ${(result.score * 100).toFixed(1)}%${result.verified ? ' ✓' : ''}`,
        );
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  // 模型库的按钮一律携带 model_id，不再用数组下标——下标会随清单顺序变化而错位，
  // 曾导致「下载 A 却显示 B 的名字」。文案也按 id 从清单取，不再读 i18n 的下标数组。
  const download = event.target.closest('[data-download-model]');
  if (download) {
    const modelId = download.dataset.downloadModel;
    const model = modelCatalog.find((item) => item.id === modelId);
    if (!model || download.disabled || modelPaths.has(modelId)) return;
    dismissedModelDownloadIds = [];
    modelDownloads.set(modelId, { received: 0, total: 0 });
    const downloadModal = activeModal;
    renderModal(downloadModal);
    renderModelDownloadQueue();
    try {
      if (window.brevia) await window.brevia.models.download(modelDownloadPayload(modelId));
      else modelDownloads.delete(modelId);
    } catch (error) {
      modelDownloads.set(modelId, { error: error.message });
      showToast(error.message, undefined, 'error');
    }
    if (activeModal === downloadModal) renderModal(downloadModal);
    return;
  }
  const deleteModel = event.target.closest('[data-delete-model]');
  if (deleteModel) {
    const modelId = deleteModel.dataset.deleteModel;
    try {
      if (window.brevia) await window.brevia.models.delete({ model_id: modelId });
      modelPaths.delete(modelId);
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    renderModal('models');
    return;
  }
  const openModelFolder = event.target.closest('[data-open-model-folder]');
  if (openModelFolder) {
    const modelId = openModelFolder.dataset.openModelFolder;
    const directory = modelPaths.get(modelId);
    if (!directory) {
      showToast(t('未找到模型文件'));
      return;
    }
    try {
      await window.brevia?.showItem(`${directory}/.brevia.json`);
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    return;
  }
});
settingsModal.addEventListener('input', (event) => {
  const advancedForm = event.target.closest('.advanced-settings-form');
  if (advancedForm) validateAdvancedSettings(advancedForm);
  if (event.target.matches('[data-speaker-search]')) {
    speakerProfileSearch = event.target.value;
    settingsModal.querySelectorAll('.speaker-person').forEach((row) => {
      row.hidden = !row.textContent
        .toLocaleLowerCase()
        .includes(speakerProfileSearch.toLocaleLowerCase());
    });
    return;
  }
  if (event.target.matches('[data-speaker-sample-seek]')) {
    if (
      speakerSampleAudio._button?.dataset.playSpeakerSample ===
      event.target.dataset.speakerSampleSeek
    )
      speakerSampleAudio.currentTime = Number(event.target.value);
    return;
  }
  const form = event.target.closest('.summary-model-form, .ai-assist-config-form');
  if (!form) return;
  const config = form.matches('.ai-assist-config-form') ? aiAssistConfigDraft : summaryConfigDraft;
  const name = event.target.name;
  if (name === 'apiKey') {
    const keys = modelConfigSecrets.get(config) || {};
    keys[config.provider] = event.target.value;
    modelConfigSecrets.set(config, keys);
  } else if (name === 'model' || name === 'endpoint') {
    const entry = { ...providerEntry(config), [name]: event.target.value };
    const previousEndpoint = providerEntry(config).endpoint;
    if (name === 'endpoint' && previousEndpoint && previousEndpoint !== entry.endpoint) {
      delete entry.keyReference;
      delete entry.keyLength;
      const keys = modelConfigSecrets.get(config);
      if (keys) delete keys[config.provider];
      const field = form.elements.apiKey;
      field.value = '';
      field.placeholder = '';
      field.required = !form.matches('.ai-assist-config-form') || config.enabled;
    }
    config.providers[config.provider] = entry;
  }
});
settingsModal.addEventListener('change', async (event) => {
  if (event.target.matches('[data-batch-export-content]')) {
    settingsModal.querySelector('.export-options').innerHTML = batchFormatButtons(
      event.target.value,
    );
    return;
  }
  if (event.target.matches('[data-ai-settings-enabled]')) {
    aiAssistConfigDraft.enabled = event.target.checked;
    renderAiAssistModal();
    return;
  }
  if (event.target.matches('[name="ai-service-way"]')) {
    const config = activeModal === 'ai-assist' ? aiAssistConfigDraft : summaryConfigDraft;
    config.provider =
      event.target.value === 'built-in'
        ? 'built-in'
        : config.provider === 'built-in'
          ? 'openai'
          : config.provider;
    renderModal(activeModal);
    return;
  }
  if (event.target.matches('[data-summary-enabled]')) {
    const previous = summaryConfig.enabled;
    event.target.disabled = true;
    summaryConfig.enabled = event.target.checked;
    summaryConfigRevision += 1;
    try {
      await persistSummaryConfig();
    } catch (error) {
      summaryConfig.enabled = previous;
      event.target.checked = previous;
      showToast(error.message, undefined, 'error');
    } finally {
      event.target.disabled = false;
    }
    return;
  }
  if (event.target.matches('[data-china-model-source]')) {
    localStorage.setItem('brevia-china-model-source', event.target.checked);
    return;
  }
  if (event.target.matches('.ai-assist-level input[type=radio]')) {
    aiAssistConfigDraft.proactivity = event.target.value;
    const example = settingsModal.querySelector('[data-ai-example="ai-assist"]');
    if (example) example.outerHTML = renderAiSettingsExample('ai-assist');
    settingsModal
      .querySelectorAll('.ai-assist-level')
      .forEach((level) =>
        level.classList.toggle('is-selected', level.querySelector('input[type=radio]').checked),
      );
    return;
  }
  const exportItem = event.target.closest('[data-export-item]');
  if (exportItem) {
    const content = exportItem.dataset.exportItem;
    if (exportItem.checked) {
      if (!(content in exportSelection)) exportSelection[content] = exportDefaultFormat[content];
    } else delete exportSelection[content];
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
});
function saveModelConfig(form, config, keyPrefix, values = Object.fromEntries(new FormData(form))) {
  const isAiNoteForm = form.matches('.ai-assist-config-form');
  const modelMissingMessage = isAiNoteForm
    ? t('请先选择或填写 AI 笔记模型。')
    : t('请先选择或填写纪要模型。');
  const provider = summaryProviders.includes(values.provider) ? values.provider : config.provider;
  const preset = summaryProviderPresets[provider];
  const savedConfig = isAiNoteForm ? aiAssistConfig : summaryConfig;
  const savedEntry = providerEntry(savedConfig, provider);
  const entry = { model: (values.model || '').trim() };
  if (!entry.model) {
    showToast(modelMissingMessage);
    return false;
  }
  if (preset.needsEndpoint) {
    entry.endpoint = (values.endpoint || '').trim();
    if (!entry.endpoint) {
      showToast(t('请填写请求地址。'));
      return false;
    }
  }
  if (preset.needsKey) {
    // 请求地址变化后必须重新输入密钥，且不能覆盖其他功能仍引用的旧密钥。
    const sameEndpoint = !preset.needsEndpoint || savedEntry.endpoint === entry.endpoint;
    const previous = sameEndpoint ? savedEntry : {};
    if (values.apiKey) {
      entry.keyReference = `${keyPrefix}-${crypto.randomUUID()}`;
      entry.keyLength = values.apiKey.length;
    } else if (previous.keyReference && previous.keyLength) {
      entry.keyReference = previous.keyReference;
      entry.keyLength = previous.keyLength;
    } else {
      showToast(t('请填写 API Key。'));
      return false;
    }
  }
  config.provider = provider;
  config.providers = { ...savedConfig.providers, [provider]: entry };
  return true;
}
for (const type of ['input', 'change']) {
  settingsModal.addEventListener(type, (event) => {
    const status = event.target.closest('form')?.querySelector('.save-state');
    if (status) status.outerHTML = renderSaveState('dirty');
  });
}
/** 设置页保存后保留表单；会议和首次引导中的配置弹层保存后关闭。 */
function completeSettingsSave(form) {
  if (!form.isConnected) return;
  if (!settingsModal.classList.contains('settings-page')) {
    closeModal();
    return;
  }
  const field = form.elements.apiKey;
  if (field?.value) {
    field.placeholder = '•'.repeat(field.value.length);
    field.value = '';
    field.required = false;
  }
  const status = form.querySelector('.save-state');
  if (status) status.outerHTML = renderSaveState('saved');
}
settingsModal.addEventListener('submit', async (event) => {
  if (event.target.matches('.advanced-settings-form')) {
    event.preventDefault();
    validateAdvancedSettings(event.target);
    if (!event.target.reportValidity()) return;
    const status = event.target.querySelector('.save-state');
    const save = event.target.querySelector('[type="submit"]');
    if (save.disabled) return;
    const values = new FormData(event.target);
    const controls = [...event.target.elements];
    const previousDisabled = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    if (status) status.outerHTML = renderSaveState('saving');
    try {
      const settings = structuredClone(advancedSettings.settings);
      values.forEach((value, path) => {
        // 字段名是完整路径（如 vad.zh.threshold）：逐层下钻后再按原类型写回。
        const keys = path.split('.');
        const leaf = keys.pop();
        const parent = keys.reduce((node, key) => node[key], settings);
        parent[leaf] = typeof parent[leaf] === 'number' ? Number(value) : value;
      });
      await window.brevia?.advancedSettings.save({ settings });
      advancedSettings.settings = settings;
      completeSettingsSave(event.target);
      showToast(t('已保存'), undefined, 'success');
    } catch (error) {
      const status = event.target.querySelector('.save-state');
      if (status) status.outerHTML = renderSaveState('failed');
      showToast(error.message, undefined, 'error');
    } finally {
      controls.forEach((control, index) => {
        control.disabled = previousDisabled[index];
      });
    }
    return;
  }
  if (event.target.matches('.speaker-profile-rename-form')) {
    event.preventDefault();
    const profileId = event.target.dataset.profileId;
    const name = new FormData(event.target).get('name').trim();
    try {
      await window.brevia?.speakerProfile.rename({ profile_id: profileId, name });
      speakerProfiles = await window.brevia.speakerProfile.list();
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    editingSpeakerProfileId = null;
    renderModal('speaker-profiles');
    return;
  }
  if (event.target.matches('.ai-assist-config-form, .summary-model-form')) {
    event.preventDefault();
    const form = event.target;
    let previousSummary = structuredClone(summaryConfig);
    const previousAiAssist = structuredClone(aiAssistConfig);
    if (form.dataset.savePending === 'true') return;
    form.dataset.savePending = 'true';
    const formValues = Object.fromEntries(new FormData(form));
    const controls = [...form.elements].filter((control) =>
      control.matches('button, input, select, textarea'),
    );
    const previousDisabled = controls.map((button) => button.disabled);
    controls.forEach((button) => {
      button.disabled = true;
    });
    const status = form.querySelector('.save-state');
    if (status) status.outerHTML = renderSaveState('saving');
    try {
      if (event.target.matches('.ai-assist-config-form')) {
        event.preventDefault();
        const values = formValues;
        const enabled = values.enabled === 'on';
        const configured = Boolean(
          values.model?.trim() &&
            (aiAssistConfigDraft.provider === 'built-in' ||
              values.apiKey ||
              providerEntry(aiAssistConfigDraft).keyReference),
        );
        if (
          (enabled || configured) &&
          !saveModelConfig(event.target, aiAssistConfigDraft, 'ai-assist', formValues)
        )
          return;
        if (configured) {
          aiAssistConfig.provider = aiAssistConfigDraft.provider;
          aiAssistConfig.providers = aiAssistConfigDraft.providers;
        }
        aiAssistConfig.enabled = enabled;
        aiAssistTemporarilyDisabled = false;
        if (['quiet', 'assist', 'auto'].includes(values.proactivity))
          aiAssistConfig.proactivity = values.proactivity;
        aiAssistConfigRevision += 1;
        selectedAiAssistBuiltinModel = '';
        aiAssistConfigDraft = structuredClone(aiAssistConfig);
        await persistAiAssistConfig(
          configured && aiAssistConfig.provider !== 'built-in' ? values.apiKey : undefined,
        );
        completeSettingsSave(form);
        if (onboardingPage?.querySelector('[name="onboarding-ai-enabled"]')) {
          onboardingPage.querySelector('[name="onboarding-ai-enabled"]').checked =
            aiAssistConfig.enabled;
          onboardingPage.querySelector('[name="onboarding-ai-proactivity"]').value =
            aiAssistConfig.proactivity;
          const select = onboardingPage.querySelector('.onboarding-ai-levels .flow-select');
          select.querySelectorAll('[role="radio"]').forEach((option) => {
            option.setAttribute(
              'aria-checked',
              String(option.dataset.value === aiAssistConfig.proactivity),
            );
          });
          renderOnboardingAiDemo();
        }
        renderAiAssistToggle();
        const meetingId = breviaClient?.state.meeting?.id;
        if (meetingActive && meetingId) {
          if (aiAssistEnabled()) void startAiNoteForMeeting(meetingId);
          else stopAiNoteForMeeting(meetingId);
        }
        showToast(t('AI 笔记已保存'), undefined, 'success');
        return;
      }
      if (event.target.matches('.summary-model-form')) {
        event.preventDefault();
        if (!saveModelConfig(event.target, summaryConfigDraft, 'summary', formValues)) return;
        summaryConfig.provider = summaryConfigDraft.provider;
        summaryConfig.providers = summaryConfigDraft.providers;
        summaryConfigRevision += 1;
        selectedBuiltinModel = '';
        summaryConfigDraft = structuredClone(summaryConfig);
        await persistSummaryConfig(
          summaryConfig.provider !== 'built-in' ? formValues.apiKey : undefined,
        );
        previousSummary = structuredClone(summaryConfig);
        if (onboardingPage?.dataset.aiSettings === 'false') {
          aiAssistConfig.provider = summaryConfig.provider;
          aiAssistConfig.providers = structuredClone(summaryConfig.providers);
          aiAssistConfigRevision += 1;
          selectedAiAssistBuiltinModel = '';
          await persistAiAssistConfig();
        }
        dismissTaskCard(document.querySelector('#summary-config-required'));
        const ready = requestConfig(summaryConfig);
        if (ready && (ready.provider !== 'built-in' || modelPaths.has(ready.model))) {
          summaryFeedback = null;
          syncSummaryFeedback();
        }
        completeSettingsSave(form);
        showToast(t('纪要模型已保存'), undefined, 'success');
        return;
      }
    } catch (error) {
      summaryConfig = previousSummary;
      aiAssistConfig = previousAiAssist;
      const status = form.querySelector('.save-state');
      if (status) status.outerHTML = renderSaveState('failed');
      showToast(error.message, undefined, 'error');
    } finally {
      form.dataset.savePending = 'false';
      controls.forEach((button, index) => {
        button.disabled = previousDisabled[index];
      });
      const status = form.querySelector('[data-save-state="saving"]');
      if (status) status.outerHTML = renderSaveState('dirty');
    }
    return;
  }
  if (event.target.matches('.speaker-sample-form')) {
    event.preventDefault();
    const profileId = event.target.dataset.speakerProfile;
    const profile = speakerProfiles.find((item) => item.id === profileId);
    try {
      const result = await window.brevia?.speakerProfile.enroll({
        profile_id: profileId,
        name: profile.name,
      });
      if (result) {
        speakerProfiles = await window.brevia.speakerProfile.list();
        speakerSamples.set(
          profileId,
          await window.brevia.speakerProfile.samples({ profile_id: profileId }),
        );
        expandedSpeakerProfileId = profileId;
      }
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    renderModal('speaker-profiles');
    return;
  }
  if (event.target.matches('.speaker-profile-form')) {
    event.preventDefault();
    try {
      const values = new FormData(event.target);
      const profile = await window.brevia?.speakerProfile.enroll({
        name: values.get('name').trim(),
      });
      if (profile) speakerProfiles = await window.brevia.speakerProfile.list();
    } catch (error) {
      showToast(error.message, undefined, 'error');
    }
    renderModal('speaker-profiles');
    return;
  }
});
/* Locale copy lives in i18n.js; this alias keeps the renderer focused on state changes. */
const homeSlogan = document.querySelector('#home-slogan');
const homeEyebrow = document.querySelector('#home-eyebrow');
function activeWorkspaceDescription() {
  return activeWorkspaceId
    ? workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.description?.trim() || ''
    : '';
}
/** 最新图册使用固定副标题，工作区描述和最近删除提示仍来自真实状态。 */
function renderSlogan() {
  homeSlogan.textContent =
    activeLibraryNav === 'recently-deleted'
      ? BreviaI18n.trashCopy(locale).slogan
      : activeWorkspaceDescription() || t('所有对话，清晰归档。');
}

/** 应用并持久化选定的颜色主题。@param {'light'|'dark'} nextTheme 要应用的主题。@returns {void} */
function applyTheme(nextTheme) {
  theme = ['light', 'dark', 'system'].includes(nextTheme) ? nextTheme : 'system';
  localStorage.setItem('brevia-theme', theme);
  const effective =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  void window.brevia?.floatingCaption?.update?.({ theme: effective });
  themeToggle.innerHTML = interfaceIcon(effective === 'dark' ? 'moon' : 'sun');
  themeToggle.title = (themeLabels[locale] || themeLabels.en)[
    effective === 'dark' ? 'light' : 'dark'
  ];
  themeToggle.setAttribute('aria-label', themeToggle.title);
  const selector = document.querySelector('[name="interface-theme"]');
  if (selector) {
    selector.value = theme;
    selector.parentElement.querySelector('.flow-select-toggle').firstChild.nodeValue = t(
      { system: '跟随系统', light: '浅色', dark: '深色' }[theme],
    );
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'system') applyTheme('system');
});

/** 记录可在语言环境更改时替换的静态 DOM 文本和属性。
 *
 * 节点用 WeakRef 持有：renderMeetingList / renderSettingsView 等用 innerHTML 重建后会
 * 使旧节点游离，若用强引用会永久持有它们（内存泄漏）。WeakRef 让被替换的节点可被回收，
 * 存活的节点仍能正常更新。@returns {void} */
function collectTranslations() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('.brand-name, [translate="no"]')) continue;
    const key = node.nodeValue.trim();
    if (catalog.zh.labels[key])
      translatedNodes.push({
        node: new WeakRef(node),
        key,
        leading: node.nodeValue.match(/^\s*/)[0],
        trailing: node.nodeValue.match(/\s*$/)[0],
      });
  }
  document.querySelectorAll('[placeholder]').forEach((element) =>
    translatedNodes.push({
      element: new WeakRef(element),
      attribute: 'placeholder',
      key: element.placeholder,
    }),
  );
  document.querySelectorAll('[value]').forEach((element) =>
    translatedNodes.push({
      element: new WeakRef(element),
      attribute: 'value',
      key: element.value,
    }),
  );
  document.querySelectorAll('[aria-label]').forEach((element) => {
    const key = element.getAttribute('aria-label');
    if (catalog.zh.labels[key])
      translatedNodes.push({ element: new WeakRef(element), attribute: 'aria-label', key });
  });
  document.querySelectorAll('[title]').forEach((element) => {
    const key = element.getAttribute('title');
    if (catalog.zh.labels[key])
      translatedNodes.push({ element: new WeakRef(element), attribute: 'title', key });
  });
}
/** 应用语言环境、重绘依赖组件，并可选择对翻译节点进行动画处理。@param {'zh'|'en'|'es'} nextLocale 要应用的语言环境。@param {boolean} animate 是否对更改进行动画处理。@returns {void} */
function applyLanguage(nextLocale, animate = false) {
  // 确认内容含会议标题及不可逆后果，换语言时作废旧动作，由入口重新生成。
  let confirmationMeetingKey;
  if (activeModal === 'confirmation') {
    confirmationAction = undefined;
    closeModal();
    confirmationMeetingKey = document.activeElement
      ?.closest('.meeting-row')
      ?.getAttribute('data-selection-key');
  }
  closeMeetingPopovers();
  if (document.querySelector('.segment-context-menu')) closeSegmentContextMenu();
  locale = nextLocale;
  renderLibraryMetrics();
  localStorage.setItem('brevia-language', locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
  document.title = t('Brevia');
  document.querySelector('#live-info-toggle span:last-child').textContent = t('会议信息');
  document.querySelector('#live-info-panel').hidden = true;
  document.querySelector('#live-info-toggle').setAttribute('aria-expanded', 'false');
  applyTheme(theme);
  const rerendered = [
    '.preferences-workspace',
    '.meeting-list',
    '#meeting-form .form-grid',
    '.final-transcript',
    '.notes',
    '#model-download-queue',
  ].map((selector) => document.querySelector(selector));
  rerendered.push(
    batchToolbar,
    updateNotice.hidden ? null : updateNotice,
    settingsModal.hidden ? null : settingsModal.querySelector('.modal-panel'),
  );
  const rerenderedRoots = rerendered.filter(Boolean);
  const nodes = [
    ...new Set([
      ...translatedNodes
        .map(({ node, element }) => node?.deref()?.parentElement || element?.deref())
        .filter(
          (element) =>
            element?.isConnected && !rerenderedRoots.some((root) => root.contains(element)),
        ),
      ...rerenderedRoots,
      ...['#floating-caption-toggle', '#translation-toggle', '#playback-floating-caption-toggle']
        .map((selector) => document.querySelector(selector))
        .filter(Boolean),
    ]),
  ];
  const updateText = () => {
    translatedNodes.forEach(({ node, element, attribute, key, leading = '', trailing = '' }) => {
      const value = t(key);
      const textNode = node?.deref();
      if (textNode) {
        textNode.nodeValue = `${leading}${value}${trailing}`;
        return;
      }
      const target = element?.deref();
      if (target) {
        if (attribute === 'aria-label') target.setAttribute(attribute, value);
        else target[attribute] = value;
      }
    });
    renderPrepareSelects();
    renderPrepareAudioSources();
    renderPauseButton();
    updatePlayerDisplayControls();
    document.querySelector('#end-meeting').innerHTML =
      `${interfaceIcon('stop')}<span>${escapeHtml(t('结束会议'))}</span>`;
    renderSettingsView();
    document.querySelector('#mobile-connection').before(speakerProfileCard);
    document.querySelector('#settings-view .preferences-destinations').append(updateCard);
    renderSettingsFolderRows();
    renderDefaultMeetingTitle();
    renderMeetingList();
    renderWorkspaceNav();
    renderMeetingDetail();
    if (document.querySelector('.segment-profile-panel:not([hidden])')) renderSegmentProfilePanel();
    if (activeView === 'home') selectLibraryNav(activeLibraryNav);
    else
      crumb.textContent =
        activeView === 'prepare' && prepareView.dataset.mode === 'import'
          ? t('导入录音')
          : catalog[locale].views[activeView];
    renderSlogan();
    renderUpdateButton();
    renderUpdateNotice();
    renderSpeakerProfileCard();
    renderRequiredModelsCard();
    refreshLocalizedTaskCards();
    if (activeModal && activeModal !== 'confirmation') renderModal(activeModal);
    if (confirmationMeetingKey && document.activeElement === document.body) {
      const row = meetingList.querySelector(
        `[data-selection-key="${CSS.escape(confirmationMeetingKey)}"] [data-meeting-menu]`,
      );
      (row || meetingSearch).focus({ preventScroll: true });
    }
    renderFloatingCaptionToggle();
    setLiveTranslationEnabled(translationAllowed);
    renderLiveModelControl();
    renderPlaybackFloatingCaptionToggle();
    document.querySelectorAll('[data-tooltip-key]').forEach((button) => {
      const label = t(button.dataset.tooltipKey);
      button.dataset.tooltip = label;
      button.setAttribute(
        button.matches('[data-quick-recording]') ? 'aria-description' : 'aria-label',
        label,
      );
    });
    document.querySelectorAll('[data-note-highlight]').forEach((highlight) => {
      const seek = highlight.querySelector('[data-note-seek]');
      seek.dataset.tooltip = seek.ariaLabel = t('跳转到 {time}').replace(
        '{time}',
        seek.textContent,
      );
      const toggle = highlight.querySelector('[data-note-highlight-toggle]');
      toggle.dataset.tooltip = toggle.ariaLabel = t(
        toggle.getAttribute('aria-expanded') === 'true' ? '收起' : '展开',
      );
    });
    window.dispatchEvent(new Event('brevia:language-changed'));
    // 更新浮动字幕按钮工具提示
    document
      .querySelectorAll('#playback-floating-caption-toggle')
      .forEach((floatingCaptionToggle) => {
        floatingCaptionToggle.title = t('悬浮字幕');
        floatingCaptionToggle.setAttribute('aria-label', t('悬浮字幕'));
      });
  };
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    updateText();
    return;
  }
  nodes.forEach((element) => element.classList.add('locale-out'));
  window.setTimeout(() => {
    try {
      updateText();
    } finally {
      nodes.forEach((element) => {
        element.classList.remove('locale-out');
        element.classList.add('locale-in');
        window.setTimeout(() => element.classList.remove('locale-in'), 520);
      });
    }
  }, 380);
}
/** 显示简短的、自动清除的反馈消息。@param {string} content Toast 文本。@returns {void} */
/** 为缺失或被拒绝的纪要提供商凭据显示共享任务卡片。*/
let summaryConfigDismissTimer;
function showSummaryConfigCard(error) {
  clearTimeout(summaryConfigDismissTimer);
  const message = String(error?.detail || error?.message || '');
  const rejected = /LLM request failed \(403\)|error code: 1010/i.test(message);
  const authentication = Boolean(error && isSummaryAuthenticationError(error));
  const builtin = summaryConfig.provider === 'built-in';
  const retained = Boolean(uiData.detail.summary.markdown);
  const copy = {
    title: t(
      authentication
        ? rejected
          ? '纪要服务拒绝了请求'
          : '纪要服务认证失败'
        : builtin
          ? '内置纪要模型未配置'
          : '纪要模型需要配置',
    ),
    detail: t(
      authentication
        ? '请检查 API 地址、密钥和服务商访问策略。'
        : builtin
          ? retained
            ? '请先选择并下载一个内置纪要模型，再重新生成。现有纪要仍保留。'
            : '请先选择并下载一个内置纪要模型，再生成会议纪要。'
          : summaryProviderPresets[summaryConfig.provider]?.needsKey
            ? '请补全纪要服务的模型、API 地址和密钥，再重新生成。'
            : '请补全纪要服务的模型和连接配置，再重新生成。',
    ),
    action: t('配置纪要模型'),
  };
  if (activeView === 'detail' && currentMeetingDetail) {
    dismissTaskCard(document.querySelector('#summary-config-required'));
    summaryFeedback = {
      meetingId: currentMeetingDetail.id,
      ...copy,
      detail: authentication ? `${copy.detail} ${message}` : copy.detail,
      configure: true,
    };
    syncSummaryFeedback();
    return;
  }
  let card = document.querySelector('#summary-config-required');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'summary-config-required';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  card.innerHTML = `<header class="task-card-heading"><span class="task-kind-icon">${interfaceIcon('settings')}</span><p>${copy.title}</p>${taskCardControls()}</header><strong>${copy.detail}</strong><button class="secondary" type="button">${copy.action}</button>`;
  card.querySelector('.secondary').onclick = () => {
    clearTimeout(summaryConfigDismissTimer);
    dismissTaskCard(card);
    openModal('summary-model');
  };
  summaryConfigDismissTimer = setTimeout(() => dismissTaskCard(card), 30000);
}
/** 就地反馈只更新状态框，避免重新创建编辑器或清空已有纪要。 */
function syncSummaryFeedback() {
  const root = document.querySelector('[data-summary-feedback]');
  if (!root) return;
  const feedback = summaryFeedback?.meetingId === currentMeetingDetail?.id ? summaryFeedback : null;
  root.hidden = !feedback;
  if (!feedback) {
    root.replaceChildren();
    return;
  }
  root.setAttribute('role', 'status');
  root.innerHTML = `${interfaceIcon('info')}<div><strong>${escapeHtml(feedback.title)}</strong><p>${escapeHtml(feedback.detail || '')}</p></div>${feedback.configure ? `<button class="secondary" data-settings-modal="summary-model" type="button">${t('配置纪要模型')}</button>` : ''}<button class="summary-feedback-close" type="button" aria-label="${escapeHtml(t('关闭'))}">${interfaceIcon('close')}</button>`;
  root.querySelector('.summary-feedback-close').onclick = () => {
    summaryFeedback = null;
    syncSummaryFeedback();
  };
}
function isSummaryAuthenticationError(error) {
  return /LLM request failed \((401|403)\)|error code: 1010|API key|Authorization header|invalid_api_key|authentication/i.test(
    String(error.detail || error.message),
  );
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
  {
    pattern: /checksum mismatch|is missing required files|is missing required directory/i,
    key: '文件校验未通过，下载可能已损坏，请删除后重试。',
  },
  {
    pattern: /timed out|timeout|URLError|ConnectionError|IncompleteRead|SSL|CERTIFICATE/i,
    key: '网络中断导致下载失败，请检查网络后重试。',
  },
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
const showToast = (content, action, tone = 'info') => {
  const message = document.createElement('span');
  message.textContent = userFacingError(content);
  const mark = document.createElement('i');
  mark.className = 'toast-status-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = interfaceIcon(
    tone === 'success' ? 'check' : tone === 'error' ? 'warning' : 'info',
  );
  toast.dataset.tone = tone;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.replaceChildren(mark, message);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.run();
      toast.classList.remove('visible');
    });
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
  showToast(`${t('操作失败')}: ${message}`, undefined, 'error');
});
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message;
  if (message) {
    console.error(event.error || message);
    showToast(t('error.operation_failed'), undefined, 'error');
  }
});
/** 标记活动的会议库源并更新窗口面包屑。@param {'all-meetings'|'recently-deleted'} id 导航项 ID。@returns {void} */
function selectLibraryNav(id) {
  if (id !== activeLibraryNav) clearMeetingSelection();
  activeLibraryNav = id;
  document
    .querySelectorAll('.nav-item')
    .forEach((item) => item.classList.toggle('active', item.id === id));
  crumb.textContent = id === 'recently-deleted' ? t('最近删除') : catalog[locale].views.home;
  const deleted = id === 'recently-deleted';
  homeEyebrow.textContent = deleted ? t('最近删除') : t('会议库');
  homeEyebrow.disabled = true;
  homeEyebrow.className = 'eyebrow';
  document.querySelector('#trash-back').hidden = !deleted;
  document.querySelector('.navigation-sidebar').classList.toggle('showing-trash', deleted);
  meetingSearch.placeholder = deleted ? t('搜索已删除的会议') : t('搜索会议、字幕或说话人…');
  renderSlogan();
  updateHomeViewTitle();
}
/** 业务清理串行，视觉不阻塞导航；尚未开始的旧意图由最新导航替代。 */
async function transitionPage(current, next, swap = () => {}) {
  const revision = ++pageTransitionRevision;
  const previous = pageTransition;
  const transition = (async () => {
    if (previous) await previous.catch(() => {});
    if (revision !== pageTransitionRevision) return false;
    if (
      !settingsModal.hidden &&
      (settingsModal.classList.contains('export-modal') ||
        settingsModal.classList.contains('library-confirmation'))
    )
      closeModal();
    // 所有导航入口共用退出逻辑，会议库切换也必须清除设置页遮罩。
    if (next.id !== 'settings-view') {
      modalRequestRevision += 1;
      if (
        !settingsModal.hidden &&
        (settingsModal.classList.contains('settings-page') ||
          settingsModal.classList.contains('modal-leave'))
      ) {
        closeModal();
        clearTimeout(modalDismissTimer);
        settingsModal.hidden = true;
        settingsModal.classList.remove('modal-leave');
        document.querySelector('.app-shell').inert = false;
        if (onboardingPage) onboardingPage.inert = false;
        document.body.classList.remove('modal-open');
      }
      if (onboardingPage?.dataset.aiSettings === 'true') dismissOnboardingPage();
    }
    current = document.querySelector('.view.active') || current;
    const previousView = activeView;
    const child = ['prepare', 'detail', 'live'];
    const forward = child.includes(next.id.slice(0, -5)) && !child.includes(previousView);
    const back = child.includes(previousView) && !child.includes(next.id.slice(0, -5));
    if (forward) viewReturnFocus.set(current.id, document.activeElement);
    activeView = next.id.slice(0, -'-view'.length);
    syncPhonePreview();
    try {
      if (previousView === 'prepare' && activeView !== 'prepare') await breviaClient?.stopPreview();
      document
        .querySelector('.app-shell')
        .classList.toggle('is-live-meeting', activeView === 'live' && meetingActive);
      document
        .querySelector('.app-shell')
        .classList.toggle('is-settings-view', activeView === 'settings');
      crumb.textContent =
        activeView === 'prepare' && prepareView.dataset.mode === 'import'
          ? t('导入录音')
          : catalog[locale].views[activeView];
      if (activeView === 'home') selectLibraryNav(activeLibraryNav);
      else
        document
          .querySelectorAll('.nav-item')
          .forEach((item) => item.classList.toggle('active', item.dataset.view === activeView));
      if (activeView === 'detail') {
        if (previousView !== 'detail') switchDetailDocument('summary');
        resetDetailHeaderCollapse();
      }
      await swap();
      syncCurrentMeetingNavigation();
    } finally {
      BreviaMotion.cancel(current);
      current.classList.remove('active', 'leaving');
      next.classList.remove('active', 'leaving');
      next.classList.add('active');
      if (revision === pageTransitionRevision) {
        if (activeView === 'settings' && previousView !== 'settings')
          BreviaMotion.enter(next.querySelector('.settings-general-main'), 'settings');
        else BreviaMotion.enter(next, forward ? 'forward' : back ? 'back' : 'sibling');
        const focus = back ? viewReturnFocus.get(next.id) : null;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
      }
      renderMiniPlayback();
    }
    return revision === pageTransitionRevision;
  })();
  pageTransition = transition;
  try {
    return await transition;
  } finally {
    if (pageTransition === transition) pageTransition = null;
  }
}
/** 在顶级应用视图之间切换。@param {'home'|'prepare'|'live'|'detail'|'settings'} name 目标视图。*/
const showView = async (name) => {
  if (name === activeView && !pageTransition) return;
  if (
    typeof settleCorrectionDraft === 'function' &&
    (correctionDraft || uiData.detail.transcriptEditing || correctionPanelState?.saving) &&
    !(await settleCorrectionDraft())
  )
    return;
  if (typeof closeCorrectionPanel === 'function') closeCorrectionPanel();
  closeSearchPopup();
  closeMeetingPopovers();
  if (document.querySelector('.segment-context-menu')) closeSegmentContextMenu();
  if (typeof closeSegmentProfilePanel === 'function') closeSegmentProfilePanel(true);
  const current = document.querySelector(`#${activeView}-view`);
  const next = document.querySelector(`#${name}-view`);
  const navigated = await transitionPage(current, next);
  if (!navigated) return;
  if (name !== 'live' && meetingActive && !miniMeeting.hidden)
    taskCards.scrollTop = taskCards.scrollHeight;
  if (name === 'prepare') {
    renderCaptureMode();
    if (prepareView.dataset.mode !== 'import') void refreshPrepareAudioSources();
  }
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
  detailView
    .querySelectorAll('.transcript-body, .detail-notes-panel, .notes-editor, .notes-input')
    .forEach((panel) => {
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
document
  .querySelector('#detail-view')
  ?.addEventListener('scroll', updateDetailHeaderCollapse, true);
/** 使用与顶级视图相同的页面淡出/淡入时序切换会议库源。*/
async function showLibraryNav(id, revealLibrary = true) {
  if (revealLibrary) setLibraryVisible(true);
  const includeDeleted = id === 'recently-deleted';
  if (activeView === 'home' && id === activeLibraryNav && !pageTransition) return;
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  const current = document.querySelector(`#${activeView}-view`);
  const home = document.querySelector('#home-view');
  await transitionPage(current, home, async () => {
    selectLibraryNav(id);
    if (window.brevia)
      await refreshBackendMeetings(includeDeleted).catch((error) =>
        showToast(error.message, undefined, 'error'),
      );
  });
}
collectTranslations();
applyLanguage(locale);
applyLanguageModelDefaults(
  new FormData(prepareForm).get('meeting-language') || defaultMeetingLanguage(),
);
applyTheme(theme);
async function loadInstalledAppVersion() {
  try {
    const version = await window.brevia?.appInfo?.version?.();
    if (version) {
      applyInstalledVersion(version);
      return;
    }
  } catch {
    /* Fall through to the packaged manifest. */
  }
  try {
    const response = await fetch('../package.json');
    const { version } = await response.json();
    if (response.ok && version) applyInstalledVersion(version);
  } catch {
    /* Keep the unavailable marker when neither source can be read. */
  }
}
/** 记录已安装版本并触发“本次更新”弹窗判定。@param {string} version 已安装的应用版本。@returns {void} */
function applyInstalledVersion(version) {
  installedAppVersion = version;
  appVersion.textContent = `v${version}`;
  document.querySelector('[data-status-version]').textContent = appVersion.textContent;
  renderUpdateButton();
  maybeShowWhatsNew();
}
/** 按点号分段、逐段数值比较两个 semver 版本号。@param {string} a @param {string} b @returns {number} a<b → 负数，a>b → 正数。 */
function compareVersions(a, b) {
  const left = String(a)
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
  const right = String(b)
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
/** 仅在升级后自动弹出一次“更新日志”；首次安装只记录版本、不弹窗。@returns {void} */
function maybeShowWhatsNew() {
  clearTimeout(whatsNewRetryTimer);
  if (!installedAppVersion || installedAppVersion === '—' || whatsNewShown) return;
  try {
    const seen = localStorage.getItem('brevia-whatsnew-seen');
    if (!seen) {
      localStorage.setItem('brevia-whatsnew-seen', installedAppVersion);
      return;
    }
    if (compareVersions(seen, installedAppVersion) >= 0) return;
  } catch {
    whatsNewShown = true;
    return;
  }
  // 等待引导、恢复/录音、现有浮窗和页面过渡完成，避免覆盖用户正在处理的内容。
  if (
    !whatsNewReady ||
    onboardingPage ||
    activeModal ||
    meetingActive ||
    pageTransition ||
    document.querySelector('dialog[open], .workspace-dialog, #startup-splash')
  ) {
    whatsNewRetryTimer = setTimeout(maybeShowWhatsNew, 500);
    return;
  }
  whatsNewShown = true;
  void openModal('upgrade-log');
}
/** 记录当前版本已查看，避免下次启动重复弹窗。@returns {void} */
function markWhatsNewSeen() {
  whatsNewShown = true;
  clearTimeout(whatsNewRetryTimer);
  if (!installedAppVersion || installedAppVersion === '—') return;
  try {
    localStorage.setItem('brevia-whatsnew-seen', installedAppVersion);
  } catch {
    /* ignore */
  }
}
void loadInstalledAppVersion();
function scheduleUpdateCheck(delay) {
  clearTimeout(updateCheckTimer);
  nextUpdateCheckAt = Date.now() + delay;
  updateCheckTimer = setTimeout(() => void checkForUpdates({ silent: true }), delay);
}
async function checkForUpdates({ silent = false } = {}) {
  if (!window.brevia?.update || updateBusy) return;
  clearTimeout(updateCheckTimer);
  nextUpdateCheckAt = 0;
  updateBusy = 'check';
  renderUpdateButton();
  renderUpdateNotice();
  try {
    const result = await window.brevia.update.check();
    updateStatus = silent && result.status === 'unsupported' ? '' : result.status;
    updateAvailable = result.status === 'available' && Boolean(result.version);
    updateVersion = updateAvailable ? result.version : '';
    if (updatePolicy.offeredVersion !== updateVersion || !updatePolicy.releasedAt) {
      updatePolicy.releasedAt = Math.min(Date.now(), Date.parse(result.releaseDate) || Date.now());
      updatePolicy.offeredVersion = updateVersion;
    }
    if (result.status !== 'unsupported') updatePolicy.lastCheck = Date.now();
    persistUpdatePolicy();
    updateRetryDelay = 3600000;
    if (result.status !== 'unsupported') scheduleUpdateCheck(UPDATE_DAY);
  } catch (error) {
    if (!silent) showToast(userFacingError(error.message), undefined, 'error');
    scheduleUpdateCheck(updateRetryDelay);
    updateRetryDelay = Math.min(6 * 3600000, updateRetryDelay * 2);
  } finally {
    updateBusy = '';
    renderUpdateButton();
    renderUpdateNotice();
  }
}
function startAutomaticUpdateChecks() {
  // 新会话重新确认曾发现的版本，安装器也需要本次检查取得下载清单。
  const remaining = updatePolicy.offeredVersion
    ? 0
    : Math.min(UPDATE_DAY, (Number(updatePolicy.lastCheck) || 0) + UPDATE_DAY - Date.now());
  scheduleUpdateCheck(Math.max(1000, remaining));
}
window.addEventListener('focus', () => {
  if (nextUpdateCheckAt && Date.now() >= nextUpdateCheckAt) void checkForUpdates({ silent: true });
});
async function runUpdateAction() {
  if (updateBusy || !updateAvailable) return;
  updateBusy = 'install';
  updateDownloadProgress = null;
  renderUpdateButton();
  renderUpdateNotice();
  try {
    await window.brevia.update.install();
  } catch (error) {
    showToast(
      error.code === 'error.tasks.running'
        ? t(error.code)
        : userFacingError(error.detail || error.message),
      undefined,
      'error',
    );
  } finally {
    updateBusy = '';
    updateDownloadProgress = null;
    renderUpdateButton();
    renderUpdateNotice();
    scheduleUpdateCheck(UPDATE_DAY);
  }
}
updateButton.addEventListener('click', () => void checkForUpdates());
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-install-app-update]')) void runUpdateAction();
  if (event.target.closest('[data-dismiss-update]')) {
    updatePolicy.dismissedVersion = updateVersion;
    persistUpdatePolicy();
    renderUpdateNotice();
  }
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('.release-delay input')) return;
  const delay = Number(event.target.value);
  if (!updateDelays.includes(delay)) return;
  updatePolicy.delayDays = delay;
  persistUpdatePolicy();
  renderUpdateNotice();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const list = document.querySelector('.flow-select-options.is-floating:not([hidden])');
    if (list) {
      list.hidden = true;
      const toggle = list.closest('.flow-select').querySelector('[data-flow-select-toggle]');
      toggle?.setAttribute('aria-expanded', 'false');
      toggle?.focus();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (activeModal) {
      if (settingsModal.matches(':popover-open')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      closeModal();
    } else if (onboardingPage?.dataset.aiSettings === 'true') dismissOnboardingPage();
  }
});
// Command+/ 或 Ctrl+/：切换富文本 / Markdown 编辑模式。
document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key !== '/') return;
  const editor = meetingActive ? liveNotesEditor : detailNotesEditor || null;
  if (!editor) return;
  event.preventDefault();
  editor.setMode(editor.getMode() === 'rich' ? 'markdown' : 'rich');
});
/** 在录制期间导航离开时显示紧凑的实时会议控件。@returns {void} */
function minimizeMeeting() {
  miniTitle.textContent = document.querySelector('#live-name').textContent;
  miniTimer.textContent = document.querySelector('#timer').textContent;
  const wasHidden = miniMeeting.hidden;
  miniMeeting.hidden = false;
  if (wasHidden) taskCards.append(miniMeeting);
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view]');
  if (!target || ['all-meetings', 'recently-deleted'].includes(target.id)) return;
  if (target.dataset.view === 'home') {
    if (activeLibraryNav !== 'all-meetings') {
      // 设置返回与品牌入口仍需更换回收站数据，但保留用户原有的侧栏开合。
      void showLibraryNav('all-meetings', false).catch((error) =>
        showToast(error.message, undefined, 'error'),
      );
      return;
    }
    selectLibraryNav('all-meetings');
  }
  if (target.dataset.view === 'prepare') setPrepareMode(target.dataset.prepareMode || 'record');
  if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting();
  showView(target.dataset.view);
  if (target.dataset.view === 'settings') void refreshSettingsFolderRows();
});
homeEyebrow.addEventListener('click', async () => {
  if (activeLibraryNav !== 'recently-deleted') return;
  await showLibraryNav('all-meetings').catch((error) =>
    showToast(error.message, undefined, 'error'),
  );
});
function setLiveTranslationEnabled(enabled) {
  translationAllowed = enabled;
  const toggle = document.querySelector('#translation-toggle');
  toggle.dataset.enabled = String(enabled);
  toggle.innerHTML = interfaceIcon('translate');
  toggle.dataset.tooltip = t(enabled ? '翻译：开' : '翻译：关');
  toggle.setAttribute('aria-label', toggle.dataset.tooltip);
  document.querySelector('#translation-options').innerHTML = BreviaI18n.languageOptions(locale, t)
    .map(
      ([value, label]) =>
        `<button type="button" data-live-translation="${escapeHtml(value)}">${escapeHtml(label)}</button>`,
    )
    .join('');
  if (!enabled)
    document.querySelectorAll('.translation').forEach((line) => {
      line.hidden = true;
    });
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
  if (models.length < 2) {
    menu.hidden = true;
    return;
  }
  const current = liveConfig.refined_model_id || models[0].id;
  menu.hidden = false;
  const optionLabels = new Map(refinedModelOptions(language));
  toggle.innerHTML = interfaceIcon('model');
  toggle.dataset.tooltip = `${t('识别模型')}: ${optionLabels.get(current) || models[0].name}`;
  toggle.setAttribute('aria-label', toggle.dataset.tooltip);
  toggle.setAttribute('aria-expanded', String(!options.hidden));
  options.innerHTML = [...optionLabels]
    .map(
      ([id, label]) =>
        `<button type="button" data-live-model="${escapeHtml(id)}"${id === current ? ' aria-current="true"' : ''}>${escapeHtml(label)}</button>`,
    )
    .join('');
  if (!options.hidden) fitFlowSelectOptions(options, toggle, 320, 360);
}
function renderFloatingCaptionToggle() {
  const toggle = document.querySelector('#floating-caption-toggle');
  if (!toggle) return;
  toggle.dataset.enabled = String(floatingCaptionMode === 'live');
  toggle.innerHTML = interfaceIcon('captions');
  toggle.dataset.tooltip = t(floatingCaptionMode === 'live' ? '关闭悬浮字幕' : '开启悬浮字幕');
  toggle.setAttribute('aria-label', toggle.dataset.tooltip);
  toggle.setAttribute('aria-pressed', String(floatingCaptionMode === 'live'));
}
function renderPlaybackFloatingCaptionToggle() {
  const toggle = document.querySelector('#playback-floating-caption-toggle');
  if (!toggle) return;
  toggle.dataset.enabled = String(floatingCaptionMode === 'playback');
  toggle.textContent = t('字幕');
}
function nextFloatingCaptionMode(mode) {
  return floatingCaptionMode === mode ? null : mode;
}
function adoptMobileMeeting(meeting) {
  if (!breviaClient || breviaClient.state.meeting?.id === meeting.id) return;
  breviaClient.state.meeting = meeting;
  breviaClient.state.inputs = { mic: false, system: false };
  activateMeeting(meeting, meeting);
  clearInterval(timer);
  document.querySelector('#pause').disabled = !meeting.tags?.includes('手机麦克风');
  document.querySelector('#end-meeting').disabled = false;
  if (!meeting.tags?.includes('手机麦克风'))
    document.querySelector('#pause').textContent = t('在手机控制录音');
  const transcript = document.querySelector('#transcript-scroll');
  const segments = (meeting.segments || []).slice(-maxLiveSegments);
  const assignedSpeakers = new Set((meeting.speakers || []).map((person) => person.id));
  transcript.innerHTML = segments
    .map((segment) =>
      renderTranscriptSegment({
        ...renderSegmentData(segment, false, new Map()),
        showSpeaker:
          Boolean(segment.speaker_name) &&
          (segment.speaker_name !== segment.speaker || assignedSpeakers.has(segment.speaker)),
        live: true,
      }),
    )
    .join('');
  segments.forEach((segment, index) => {
    liveSegments.set(segment.id, transcript.children[index]);
    liveSegmentData.set(segment.id, {
      revision: Number(segment.revision) || 0,
      text: segment.text,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      track: segment.track,
      speaker: segment.speaker,
      speaker_name: segment.speaker_name,
    });
    latestLiveSegmentId = segment.id;
  });
  if (liveNotesEditor) liveNotesEditor.setMarkdown(meeting.notes || '');
  if (typeof syncCorrectionControls === 'function') syncCorrectionControls();
}
function activateMeeting(meeting, payload) {
  if (livePaletteMeetingId !== meeting.id) {
    livePaletteMeetingId = meeting.id;
    liveSpeakerPalette.clear();
    for (const person of meeting.speakers || [])
      speakerColor(person.id || person.name, liveSpeakerPalette);
  }
  if (typeof syncCorrectionControls === 'function') queueMicrotask(syncCorrectionControls);
  desktopSaveError = '';
  desktopSavedMeeting = null;
  document.querySelector('#pause').disabled = false;
  document.querySelector('#end-meeting').disabled = false;
  document.querySelector('#end-meeting').removeAttribute('data-awaiting-phone');
  document.querySelector('#end-meeting').removeAttribute('aria-busy');
  document.querySelector('#end-meeting').innerHTML =
    `${interfaceIcon('stop')}<span>${escapeHtml(t('结束会议'))}</span>`;
  document.querySelector('#transcript-scroll').classList.remove('is-finishing');
  const { title, workspace_id: workspaceId, language } = meeting || payload;
  // 上一场遗留的「无实时字幕」卡片不能带到这一场；本场的卡片要保留（它的归属 id 与本次相同）。
  dismissLiveCaptionUnavailable(meeting?.id || payload?.id || breviaClient?.state.meeting?.id);
  liveConfig = {
    language: language || 'auto',
    target_language: payload.target_language || null,
    refined_model_id: meeting?.refined_model_id || payload.refined_model_id || null,
  };
  document.querySelector('#live-name').textContent = title;
  uiData.meetings = uiData.meetings.filter((item) => item.id !== meeting.id);
  uiData.meetings.unshift({
    id: meeting.id,
    createdAt: meeting.created_at || new Date().toISOString(),
    tone: 'violet',
    title,
    meta: `${t('刚刚')} · 0 ${t('分钟')}`,
    workspaceId: workspaceId || '',
    workspace: workspaceId ? { name: getWorkspaceName(workspaceId) } : null,
    tags: meeting.tags || [],
    status: { tone: 'processing', label: '正在录制', detail: t('本地保存') },
  });
  document.querySelector('#transcript-scroll').innerHTML = '';
  const backToLatestButton = document.querySelector('#back-to-latest');
  if (backToLatestButton) backToLatestButton.hidden = true;
  if (liveNotesEditor) {
    liveNotesEditor.setMarkdown('');
    liveNotesEditor.setMode('rich');
  }
  resetAiNoteSuggestions();
  setLiveAcceptedClaims(meeting.accepted_claims || []);
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
  void startAiNoteForMeeting(meeting.id);
  miniMeeting.hidden = true;
  showView('live');
  startTimer();
  const inputs = breviaClient?.state.inputs;
  if (window.brevia?.desktop && (inputs?.phone || inputs?.mic || inputs?.system)) {
    const mode = inputs?.phone
      ? 'phone'
      : inputs?.mic
        ? inputs.system
          ? 'both'
          : 'mic'
        : 'system';
    void window.brevia.desktop
      .rememberCapture({ mode })
      .then((preferences) => {
        desktopPreferences = preferences;
      })
      .catch((error) => showToast(error.detail || error.message, undefined, 'error'));
  }
}
async function startConfiguredRecording(payload, captureMode) {
  const inputs = captureModeInputs(captureMode);
  if (captureMode === 'phone' && !selectedPhoneDevice()?.captureReady)
    throw new Error(t('手机端未就绪，请打开或更新 Brevia'));
  const meeting = breviaClient
    ? await breviaClient.start(payload, inputs, selectedMicDeviceId())
    : { id: null };
  if (meeting?.model_required) {
    queueModelTask('meeting.start', { ...payload, inputs }, meeting.model_required);
    downloadRequiredModels(meeting.model_required);
    activateTaskCard(document.querySelector('#model-download-queue'));
    showToast(t('正在下载会议所需模型，完成后会自动开始录制'));
    return null;
  }
  activateMeeting(meeting, payload);
  return meeting;
}
async function submitMeeting(event) {
  event.preventDefault();
  const submit = event.submitter || event.currentTarget.querySelector('[type=submit]');
  if (submit.disabled || meetingActive) return;
  const submitLabel = submit.innerHTML;
  submit.disabled = true;
  submit.classList.add('is-pending');
  syncPhonePreview();
  submit.setAttribute('aria-busy', 'true');
  submit.innerHTML = `<i class="button-spinner" aria-hidden="true"></i>${t('准备中')}`;
  const form = new FormData(event.currentTarget);
  const title = document.querySelector('#meeting-title').value.trim();
  const language = form.get('meeting-language') || defaultMeetingLanguage();
  const defaults = preferredModelsForLanguage(language);
  const refinedModelId = form.get('refined-model') || defaultRefinedModelId(language);
  const targetLanguage = form.get('translation-target') || null;
  const segmentationModelId = prepareForm.dataset.segmentationModel || defaults.segmentation;
  const captureMode = form.get('capture-mode') || currentCaptureMode;
  const payload = {
    title,
    language,
    num_speakers: Number(form.get('meeting-speakers') || -1),
    target_language: targetLanguage,
    refined_model_id: refinedModelId,
    speaker_segmentation_model_id: segmentationModelId,
    vad_model_id: prepareForm.dataset.vadModel || 'silero-vad',
    workspace_id: form.get('meeting-workspace') || null,
    summary_template: form.get('summary-template') || 'general',
  };
  try {
    if (prepareView.dataset.mode === 'import') {
      const meeting =
        window.brevia &&
        (await window.brevia.meeting.import({
          ...payload,
          ...(form.get('meeting-date') ? { meeting_date: form.get('meeting-date') } : {}),
          path: importAudioSelection?.path || 'selected-by-desktop',
        }));
      if (!meeting) return;
      breviaClient.state.selectedMeetingId = meeting.id;
      prepareForm.querySelector('[name="meeting-date"]').value = '';
      importAudioSelection = null;
      renderImportAudioSelection();
      applyBackendDetail(meeting);
      await refreshBackendMeetings();
      showView('detail');
      startRefinement();
      return;
    }
    await startConfiguredRecording(payload, captureMode);
  } catch (error) {
    const inlineError = document.querySelector('[data-prepare-error]');
    inlineError.textContent = error.detail || error.message;
    inlineError.hidden = false;
    showToast(error.message, undefined, 'error');
  } finally {
    submit.disabled =
      prepareView.dataset.mode !== 'import' &&
      currentCaptureMode === 'phone' &&
      !selectedPhoneDevice()?.captureReady;
    submit.classList.remove('is-pending');
    syncPhonePreview();
    submit.removeAttribute('aria-busy');
    submit.innerHTML = submitLabel;
  }
}
document
  .querySelector('#meeting-form')
  .addEventListener('submit', (event) => void submitMeeting(event));
/** 当前是否处于「暂停录制」状态：暂停按钮的 dataset 是唯一状态来源。@returns {boolean} 是否已暂停。 */
function meetingPaused() {
  return document.querySelector('#pause')?.dataset.paused === 'true';
}
/** 把录制 / 暂停状态同步到实时页 header、迷你控件与会议库列表，避免暂停后仍显示「正在录制」。@param {boolean} paused 是否已暂停。@returns {void} */
function renderRecordingState(paused) {
  scheduleDesktopRecording();
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
function liveInputLabel() {
  const phone = breviaClient?.state.meeting?.tags?.includes('手机录音');
  const inputs = breviaClient?.state.inputs || captureModeInputs();
  const label = phone
    ? breviaClient.state.meeting.tags.includes('手机麦克风')
      ? '手机麦克风'
      : '手机录音'
    : inputs.mic && inputs.system
      ? '麦克风 + 系统音频'
      : inputs.mic
        ? '麦克风'
        : '系统音频';
  return t(label);
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
  card.innerHTML =
    `<header class="task-card-heading"><span class="task-kind-icon">${interfaceIcon('warning')}</span><p>${escapeHtml(t('本次会议无法生成实时字幕'))}</p>${taskCardControls()}</header>` +
    `<p class="live-transcription-unavailable-body">${escapeHtml(t('识别模型未能加载，录音仍在正常保存。会议结束后可在详情页生成完整逐字稿。'))}</p>`;
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
  button.innerHTML = `${interfaceIcon(paused ? 'play' : 'pause')}<span>${escapeHtml(t(paused ? '继续' : '暂停'))}</span>`;
  renderRecordingState(paused);
}
/** 启动可见的录制计时器，替换任何先前的计时器。@returns {void} */
function startTimer() {
  clearInterval(timer);
  timer = setInterval(() => {
    seconds += 1;
    const value = new Date(seconds * 1000).toISOString().slice(11, 19);
    document.querySelector('#timer').textContent = value;
    miniTimer.textContent = value;
  }, 1000);
}
async function pauseCurrentRecording(event) {
  const button = event.currentTarget;
  if (button.disabled || !meetingActive) return false;
  const paused = button.dataset.paused === 'true';
  const nextPaused = !paused;
  button.disabled = true;
  try {
    const request = breviaClient?.pause(nextPaused);
    button.dataset.paused = String(nextPaused);
    renderPauseButton();
    if (nextPaused) clearInterval(timer);
    else startTimer();
    await request;
    return true;
  } catch (error) {
    button.dataset.paused = String(paused);
    renderPauseButton();
    if (paused) clearInterval(timer);
    else startTimer();
    showToast(error.message, undefined, 'error');
    return false;
  } finally {
    button.disabled = false;
  }
}
document
  .querySelector('#pause')
  .addEventListener('click', (event) => void pauseCurrentRecording(event));
document.querySelector('#mark-important').addEventListener('click', () => {
  if (!meetingActive) return;
  const segment = liveSegmentData.get(latestLiveSegmentId);
  liveNotesEditor.addHighlight(Math.floor(seconds * 1000), segment?.text || t('重点'));
  showToast(t('已加入笔记'), undefined, 'success');
});
// Worker 结束事件与停录响应可能先后到达，共享同一次收尾。
let recordingFinishPending = Promise.resolve();
function finishCurrentRecording(meeting) {
  if (
    !meetingActive ||
    (meeting && breviaClient?.state.meeting && meeting.id !== breviaClient.state.meeting.id)
  )
    return recordingFinishPending;
  meetingActive = false;
  recordingFinishPending = (async () => {
    clearInterval(timer);
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.close();
      floatingCaptionMode = null;
      renderFloatingCaptionToggle();
    }
    desktopSavedMeeting = meeting || null;
    desktopSaveError = '';
    if (meeting?.id) stopAiNoteForMeeting(meeting.id);
    resetAiNoteSuggestions();
    await breviaClient?.capture
      ?.stop()
      .catch((error) => console.error('Audio capture cleanup failed', error));
    if (breviaClient) {
      breviaClient.capture = null;
      breviaClient.state.meeting = null;
      breviaClient.state.inputs = null;
      if (meeting) {
        breviaClient.state.selectedMeetingId = meeting.id;
        applyBackendDetail(meeting);
      }
    }
    miniMeeting.hidden = true;
    showView('detail');
    const config = summaryRequestConfig();
    if (meeting && config && (config.provider !== 'built-in' || modelPaths.has(config.model)))
      void generateMeetingSummary(meeting.id, config);
    void resumeReadyModelTasks();
    if (window.brevia)
      void refreshBackendMeetings().catch((error) => showToast(error.message, undefined, 'error'));
  })();
  return recordingFinishPending;
}
async function stopCurrentRecording(event) {
  const button = event.currentTarget;
  if (button.disabled || !meetingActive) return false;
  const buttonLabel = button.innerHTML;
  let captureStopped = false;
  desktopSaveError = '';
  button.disabled = true;
  button.classList.add('is-pending');
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<i class="button-spinner" aria-hidden="true"></i>${t('结束中')}`;
  try {
    if (breviaClient?.state.meeting?.tags?.includes('手机录音')) {
      const meetingId = breviaClient.state.meeting.id;
      clearTimeout(liveNotesSaveTimer.current);
      await persistNotes(meetingId, currentNotesMarkdown());
      document.querySelector('#transcript-scroll').classList.add('is-finishing');
      await window.brevia.mobile.stop({ meeting_id: meetingId });
      button.dataset.awaitingPhone = meetingId;
      showToast(t('已请求手机结束录音，等待保存与同步'));
      return true;
    }
    clearInterval(timer);
    // 先释放采集；保存失败时会议 ID 与笔记草稿保留，允许再次结束。
    await breviaClient?.capture
      ?.stop()
      .catch((error) => console.error('Audio capture cleanup failed', error));
    captureStopped = true;
    clearTimeout(liveNotesSaveTimer.current);
    const notes = currentNotesMarkdown();
    const activeMeetingId = breviaClient?.state.meeting?.id;
    if (activeMeetingId) {
      await persistNotes(activeMeetingId, notes);
    }
    const meeting = breviaClient ? await breviaClient.stop(seconds * 1000) : null;
    await finishCurrentRecording(meeting);
    showToast(message('recordingSaved'), undefined, 'success');
    return true;
  } catch (error) {
    desktopSaveError = captureStopped ? error.detail || error.message : '';
    showToast(error.message, undefined, 'error');
    // 只有电脑采集确实收尾后才显示暂停；手机请求失败时继续保留真实录音状态。
    if (captureStopped) {
      document.querySelector('#pause').dataset.paused = 'true';
      renderPauseButton();
      document.querySelector('#pause').disabled = true;
    }
    return false;
  } finally {
    if (button.dataset.awaitingPhone) {
      button.disabled = true;
      button.classList.remove('is-pending');
      button.innerHTML = t('结束中');
    } else {
      document.querySelector('#transcript-scroll').classList.remove('is-finishing');
      button.disabled = false;
      button.classList.remove('is-pending');
      button.removeAttribute('aria-busy');
      button.innerHTML = buttonLabel;
    }
  }
}
document
  .querySelector('#end-meeting')
  .addEventListener('click', (event) => void stopCurrentRecording(event));
miniMeeting.addEventListener('click', () => {
  miniMeeting.hidden = true;
  showView('live');
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
document.querySelector('[data-live-transcript-toggle]').addEventListener('click', (event) => {
  const toggle = event.currentTarget;
  const expanded = toggle.getAttribute('aria-expanded') === 'false';
  if (!expanded && segmentProfileDraft?.saving) return;
  if (!expanded && segmentProfileDraft) closeSegmentProfilePanel(true);
  document.querySelector('#live-view').classList.toggle('is-transcript-collapsed', !expanded);
  document.querySelector('#live-transcript-panel').hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  if (expanded && followLiveTranscript) {
    const transcript = document.querySelector('#transcript-scroll');
    transcript.scrollTop = transcript.scrollHeight;
  }
});
const liveNotesRoot = document.querySelector('[data-live-notes-root]');
const aiSuggestionHost = document.querySelector('[data-ai-suggestion]');
if (aiSuggestionHost) liveNotesRoot.append(aiSuggestionHost);
const liveNotesEditor = createNotesEditor(liveNotesRoot, {
  onInput: (opts) => {
    scheduleNotesSave(
      liveNotesSaveTimer,
      currentNotesMarkdown,
      () => breviaClient?.state.meeting?.id,
    );
    // 程序化写入（AI 落笔/插入字幕）不算用户打字，避免触发 4 秒静默窗口。
    if (opts?.programmatic) return;
    signalAiNoteTyping(true);
    clearTimeout(aiNoteTypingTimer);
    aiNoteTypingTimer = setTimeout(() => signalAiNoteTyping(false), 4000);
  },
  getMeetingId: () => breviaClient?.state.meeting?.id,
  getHighlightTime: () => Math.floor(seconds * 1000),
});
// —— AI 辅助：header 开关与未启用 Popover ——
function aiAssistToggleButton() {
  return document.querySelector('[data-ai-assist-toggle]');
}
function aiRequestButton() {
  return document.querySelector('[data-ai-request]');
}
function renderAiAssistToggle() {
  const button = aiAssistToggleButton();
  if (!button) return;
  const copy = aiAssistCopy[locale] || aiAssistCopy.en;
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
    if (event.target.closest('[data-ai-assist-configure]')) {
      pop.remove();
      openModal('ai-assist');
    } else if (event.target.closest('[data-ai-assist-later]')) {
      pop.remove();
    }
  });
}
document.querySelector('[data-ai-assist-toggle]')?.addEventListener('click', () => {
  const button = aiAssistToggleButton();
  if (!button) return;
  if (aiAssistEnabled()) {
    openModal('ai-assist');
    return;
  }
  openAiAssistPopover(button);
});
// 点击开关与弹层之外时关闭配置提示。
document.addEventListener('click', (event) => {
  const pop = document.querySelector('[data-ai-assist-popover]');
  if (pop && !event.target.closest('[data-ai-assist-popover], [data-ai-assist-toggle]'))
    pop.remove();
});
// —— 实时 AI 辅助（阶段 3/4）：启动/停止引擎 + 输入状态信号 + 建议接收与 UI ——
let latestAiSuggestion = null;
let aiSuggestionQueue = [];
let aiNoteTypingTimer;
let aiNoteUserTyping = false;
let aiSuggestionAutoFadeTimer;
function aiSuggestionRoot() {
  return document.querySelector('[data-ai-suggestion]');
}
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
    await window.brevia.aiNote.start({
      meeting_id: meetingId,
      ...connection,
      proactivity: aiAssistConfig.proactivity,
      language: locale,
      prompt: aiNotePromptCopy[locale] || aiNotePromptCopy.en,
    });
  } catch {
    /* Best Effort：AI 辅助启动失败不影响录音与字幕主链路 */
  }
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
  window.brevia.aiNote
    .typing({
      meeting_id: meetingId,
      typing,
      ...(typing ? {} : { notes: currentNotesMarkdown().slice(-20000) }),
    })
    .catch(() => {});
}
function requestAiSuggestion() {
  const meetingId = breviaClient?.state.meeting?.id;
  if (!meetingId || !aiAssistEnabled() || aiAssistConfig.proactivity !== 'quiet') return;
  window.brevia?.aiNote
    ?.request({ meeting_id: meetingId, notes: currentNotesMarkdown().slice(-20000) })
    .catch(() => {});
}
document.querySelector('[data-ai-request]')?.addEventListener('click', requestAiSuggestion);
let liveAcceptedClaims = [];
function setLiveAcceptedClaims(claims) {
  liveAcceptedClaims = claims;
  const button = document.querySelector('[data-live-accepted]');
  button.hidden = !claims.length;
  button.title = t('已采纳的 AI 笔记');
  button.setAttribute('aria-label', button.title);
}
window.addEventListener('brevia:language-changed', () => setLiveAcceptedClaims(liveAcceptedClaims));
let pendingAutoSuggestions = [];
const seenAiSuggestions = new Set();
function resetAiNoteSuggestions() {
  clearTimeout(aiNoteTypingTimer);
  aiNoteUserTyping = false;
  pendingAutoSuggestions.length = 0;
  seenAiSuggestions.clear();
  aiSuggestionQueue = [];
  setLiveAcceptedClaims([]);
  document.querySelector('[data-live-note-dialog][open]')?.close();
  aiSuggestionDraftKey = null;
  latestAiSuggestion = null;
  hideAiSuggestion();
}
const pendingNoteSources = new Map();
function noteLineKey(text) {
  return text
    .trim()
    .replace(/^(?:#{1,6}|[-*+]|\d+\.)\s+/, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[。.!！]+$/, '')
    .trim();
}
function notesContainSuggestion(text) {
  const key = noteLineKey(text);
  return (
    !key ||
    currentNotesMarkdown()
      .split('\n')
      .some((line) => noteLineKey(line) === key)
  );
}
function appendAiSuggestion(suggestion) {
  if (notesContainSuggestion(suggestion.text)) return false;
  if (suggestion.source_tracked && suggestion.meeting_id && suggestion.id) {
    if (!pendingNoteSources.has(suggestion.meeting_id))
      pendingNoteSources.set(suggestion.meeting_id, new Set());
    pendingNoteSources.get(suggestion.meeting_id).add(suggestion.id);
  }
  liveNotesEditor.appendMarkdown(`${suggestion.type === 'topic' ? '##' : '-'} ${suggestion.text}`);
  scheduleNotesSave(
    liveNotesSaveTimer,
    currentNotesMarkdown,
    () => breviaClient?.state.meeting?.id,
  );
  window.brevia?.aiNote
    .dismiss({ meeting_id: suggestion.meeting_id, text: suggestion.text })
    .catch(() => {});
  return true;
}
function flushAutoSuggestions() {
  if (aiAssistConfig.proactivity !== 'auto' || aiNoteUserTyping) return;
  while (pendingAutoSuggestions.length) appendAiSuggestion(pendingAutoSuggestions.shift());
}
if (window.brevia?.on)
  window.brevia.on('ai-note.suggestion', (payload) => {
    if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
    if (seenAiSuggestions.has(payload.id)) return;
    seenAiSuggestions.add(payload.id);
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
if (window.brevia?.on)
  window.brevia.on('ai-note.evidence', (payload) => {
    if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
    const mergeEvidence = (suggestion) =>
      suggestion?.id === payload.id
        ? {
            ...suggestion,
            evidence: payload.evidence,
            sources: payload.sources ?? suggestion.sources,
          }
        : suggestion;
    latestAiSuggestion = mergeEvidence(latestAiSuggestion);
    aiSuggestionQueue = aiSuggestionQueue.map(mergeEvidence);
    pendingAutoSuggestions = pendingAutoSuggestions.map(mergeEvidence);
    // 采纳时已经冻结的引文只从保存结果恢复，后来的补充不应改写那次采纳。
    renderAiSuggestion();
  });
/** 展示队列里的下一条建议（没有则回到空状态）。@returns {void} */
function showNextAiSuggestion() {
  do {
    latestAiSuggestion = aiSuggestionQueue.shift() || null;
  } while (latestAiSuggestion && notesContainSuggestion(latestAiSuggestion.text));
  renderAiSuggestion();
}
if (window.brevia?.on)
  window.brevia.on('ai-note.analyzing', ({ meeting_id: meetingId, active }) => {
    if (meetingId !== breviaClient?.state.meeting?.id) return;
    aiAssistToggleButton()?.classList.toggle('is-analyzing', Boolean(active));
  });
/** 建议类型 → 浅色标签键。@param {string} type 后端建议类型。@returns {string} 文案键。 */
function aiSuggestionTypeKey(type) {
  return (
    {
      conclusion: '可能是一个结论',
      decision: '可能的决策',
      action: '可能的待办',
      number: '重要数字',
      date: '重要日期',
      question: '待确认事项',
      risk: '可能的风险',
      supplement: '补充',
      topic: '新话题',
    }[type] || '可能是一个结论'
  );
}
/** 渲染建议：topic → 分割线；打字中 → 徽标；否则 → 建议卡。@returns {void} */
function renderAiSuggestion() {
  const root = aiSuggestionRoot();
  if (!root) return;
  clearTimeout(aiSuggestionAutoFadeTimer);
  if (!latestAiSuggestion || !meetingActive) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  const suggestion = latestAiSuggestion;
  const count = suggestion.sources?.length || 0;
  const evidenceLabel = count
    ? `<button class="ai-suggestion-evidence text-button" type="button" data-live-suggestion-sources aria-haspopup="dialog">${escapeHtml(t('依据 {count} 段字幕').replace('{count}', count))}</button>`
    : `<small class="ai-suggestion-evidence">${escapeHtml(t('缺少原文依据'))}</small>`;
  if (suggestion.type === 'topic') {
    root.innerHTML = `<button type="button" class="ai-topic-divider" data-ai-topic="${escapeHtml(suggestion.id)}">${t('AI 检测到新话题：')}${escapeHtml(suggestion.text)}</button>${evidenceLabel}`;
    root.hidden = false;
    scheduleAiSuggestionAutoFade();
    return;
  }
  if (aiNoteUserTyping) {
    root.innerHTML = `<button type="button" class="ai-suggestion-badge" data-ai-suggestion-badge>${interfaceIcon('ai')} ${t('1 条建议')}</button>`;
    root.hidden = false;
    return;
  }
  const label = t(aiSuggestionTypeKey(suggestion.type));
  const actionLabel = suggestion.type === 'supplement' ? t('补充') : t('加入笔记');
  root.innerHTML = `<div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">${interfaceIcon('ai')}</span> <span class="ai-suggestion-type">${escapeHtml(label)}</span>${evidenceLabel}</div><p class="ai-suggestion-text">${escapeHtml(suggestion.text)}</p><div class="ai-suggestion-actions"><button type="button" class="ai-suggestion-accept" data-ai-accept>${interfaceIcon('plus')} ${escapeHtml(actionLabel)}</button><button type="button" class="ai-suggestion-ignore" data-ai-ignore>${t('忽略')}</button></div></div>`;
  root.hidden = false;
  scheduleAiSuggestionAutoFade();
}
function scheduleAiSuggestionAutoFade() {
  clearTimeout(aiSuggestionAutoFadeTimer);
  if (
    document.querySelector('[data-live-note-dialog][open]') ||
    aiSuggestionRoot()?.matches(':focus-within')
  )
    return;
  aiSuggestionAutoFadeTimer = setTimeout(hideAiSuggestion, 15000);
}
aiSuggestionHost?.addEventListener('focusin', () => clearTimeout(aiSuggestionAutoFadeTimer));
aiSuggestionHost?.addEventListener('focusout', () => {
  queueMicrotask(() => {
    if (latestAiSuggestion) scheduleAiSuggestionAutoFade();
  });
});
function hideAiSuggestion() {
  clearTimeout(aiSuggestionAutoFadeTimer);
  latestAiSuggestion = null;
  // 若队列里还有建议，继续展示下一条；否则回到空状态。
  if (aiSuggestionQueue.length) {
    showNextAiSuggestion();
    return;
  }
  const root = aiSuggestionRoot();
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
}
/** 接受建议：把内容写入正式笔记并上报忽略（去重）。@param {string} text 建议文本。@returns {void} */
async function acceptAiSuggestion(text) {
  const suggestion = latestAiSuggestion;
  const meetingId = breviaClient?.state.meeting?.id;
  if (!suggestion || !text || !meetingId || aiSuggestionAccepting) return false;
  aiSuggestionAccepting = true;
  clearTimeout(aiSuggestionAutoFadeTimer);
  const key = `${meetingId}:${suggestion.id}`;
  document.querySelectorAll('[data-ai-accept]').forEach((button) => {
    button.disabled = true;
  });
  try {
    if (aiSuggestionDraftKey !== key) {
      if (!appendAiSuggestion(suggestion)) {
        hideAiSuggestion();
        return true;
      }
      aiSuggestionDraftKey = key;
    }
    clearTimeout(liveNotesSaveTimer.current);
    await persistNotes(meetingId, currentNotesMarkdown());
    if (latestAiSuggestion?.id === suggestion.id) hideAiSuggestion();
    aiSuggestionDraftKey = null;
    showToast(t('已加入笔记'), undefined, 'success');
    return true;
  } catch (error) {
    showToast(error.message, undefined, 'error');
    return false;
  } finally {
    aiSuggestionAccepting = false;
    document.querySelectorAll('[data-ai-accept]').forEach((button) => {
      button.disabled = false;
    });
  }
}

/** 把 topic 建议转换为笔记正式标题。@returns {void} */
function convertTopicToHeading() {
  const suggestion = latestAiSuggestion;
  if (!suggestion || suggestion.type !== 'topic') return;
  void acceptAiSuggestion(suggestion.text);
}
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-live-accepted]')) {
    openLiveNoteEvidence(liveAcceptedClaims, t('已采纳的 AI 笔记'));
    return;
  }
  if (event.target.closest('[data-live-suggestion-sources]') && latestAiSuggestion) {
    openLiveNoteEvidence([latestAiSuggestion], t('引用'));
    return;
  }
  const accept = event.target.closest('[data-ai-accept]');
  if (accept) {
    const suggestion = latestAiSuggestion;
    if (suggestion) acceptAiSuggestion(suggestion.text);
    return;
  }
  if (event.target.closest('[data-ai-ignore]')) {
    const suggestion = latestAiSuggestion;
    const meetingId = breviaClient?.state.meeting?.id;
    if (suggestion && meetingId && window.brevia?.aiNote)
      window.brevia.aiNote
        .dismiss({ meeting_id: meetingId, text: suggestion.text })
        .catch(() => {});
    hideAiSuggestion();
    return;
  }
  if (event.target.closest('[data-ai-suggestion-badge]')) {
    aiNoteUserTyping = false;
    renderAiSuggestion();
    return;
  }
  if (event.target.closest('[data-ai-topic]')) {
    convertTopicToHeading();
    return;
  }
});
/** 返回当前笔记的 Markdown 文本（富文本或源码模式）。@returns {string} Markdown 笔记。 */
function currentNotesMarkdown() {
  return liveNotesEditor.getMarkdown();
}
/** 笔记存储上限（与后端及 IPC 校验一致，足以容纳几张内联图片）。 */
const MAX_NOTES_CHARS = 5 * 1024 * 1024;
let notesLimitNotified = false;
let notesSavePending = Promise.resolve();
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
  const sources = [...(pendingNoteSources.get(meetingId) || [])];
  notesSavePending = notesSavePending
    .catch(() => {})
    .then(async () => {
      const saved = await window.brevia.meeting.update({
        meeting_id: meetingId,
        updates: { notes: text, ...(sources.length ? { accepted_suggestion_ids: sources } : {}) },
      });
      if (meetingActive && breviaClient?.state.meeting?.id === meetingId && saved?.accepted_claims)
        setLiveAcceptedClaims(saved.accepted_claims);
      const pending = pendingNoteSources.get(meetingId);
      if (pending) {
        for (const id of sources) pending.delete(id);
        if (!pending.size) pendingNoteSources.delete(meetingId);
      }
    });
  return notesSavePending;
}
/** 防抖保存实时笔记；会议与文本在输入时共同取快照。@param {{current: number|undefined}} timer 防抖计时器。@param {() => string} getNotes 取笔记文本。@param {() => string|undefined} getMeetingId 取会议 id。@returns {void} */
function scheduleNotesSave(timer, getNotes, getMeetingId) {
  const meetingId = getMeetingId();
  if (!meetingId || !window.brevia?.meeting?.update) return;
  clearTimeout(timer.current);
  const notes = getNotes();
  const status = document.getElementById('save-state');
  if (status) status.innerHTML = renderSaveState('dirty');
  timer.current = setTimeout(() => {
    if (status) status.innerHTML = renderSaveState('saving');
    void persistNotes(meetingId, notes)
      .then(() => {
        if (getMeetingId() === meetingId && getNotes() === notes && status)
          status.innerHTML = renderSaveState('saved');
      })
      .catch((error) => {
        if (getMeetingId() === meetingId && getNotes() === notes && status)
          status.innerHTML = renderSaveState('failed');
        showToast(error.message, undefined, 'error');
      });
  }, 800);
}
const liveNotesSaveTimer = { current: undefined };
document.querySelector('.translation-menu').addEventListener('click', async (event) => {
  const options = document.querySelector('#translation-options');
  if (event.target.closest('#translation-toggle')) {
    options.hidden = !options.hidden;
    document
      .querySelector('#translation-toggle')
      .setAttribute('aria-expanded', String(!options.hidden));
    return;
  }
  const choice = event.target.closest('[data-live-translation]');
  if (!choice) return;
  const targetLanguage = choice.dataset.liveTranslation || null;
  const changed = targetLanguage !== liveConfig.target_language;
  options.hidden = true;
  document.querySelector('#translation-toggle').setAttribute('aria-expanded', 'false');
  if ((await reconfigureLive({ target_language: targetLanguage })) && changed) {
    document.querySelectorAll('.translation').forEach((line) => {
      line.remove();
    });
  }
});
document.querySelector('.live-model-menu').addEventListener('click', async (event) => {
  const options = document.querySelector('#live-model-options');
  const toggle = document.querySelector('#live-model-toggle');
  if (event.target.closest('#live-model-toggle')) {
    options.hidden = !options.hidden;
    fitFlowSelectOptions(options, toggle, 320, 360);
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
document.querySelector('#live-info-toggle').addEventListener('click', (event) => {
  const panel = document.querySelector('#live-info-panel');
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
  if (panel.hidden) return;
  const meeting = breviaClient?.state.meeting;
  const language =
    BreviaI18n.languageOptions(locale, t, true).find(
      ([value]) => value === (liveConfig.language || 'auto'),
    )?.[1] || liveConfig.language;
  panel.innerHTML = `<strong>${escapeHtml(document.querySelector('#live-name').textContent)}</strong><dl><dt>${escapeHtml(t('工作区'))}</dt><dd>${escapeHtml(getWorkspaceName(meeting?.workspace_id || ''))}</dd><dt>${escapeHtml(t('会议语言'))}</dt><dd>${escapeHtml(language)}</dd></dl>`;
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  document.querySelector('#live-info-panel').hidden = true;
  document.querySelector('#live-info-toggle').setAttribute('aria-expanded', 'false');
  for (const [options, toggle] of [
    ['#translation-options', '#translation-toggle'],
    ['#live-model-options', '#live-model-toggle'],
  ]) {
    document.querySelector(options).hidden = true;
    document.querySelector(toggle).setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.live-info')) {
    document.querySelector('#live-info-panel').hidden = true;
    document.querySelector('#live-info-toggle').setAttribute('aria-expanded', 'false');
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
      await new Promise((resolve) => setTimeout(resolve, 200));
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
      showToast(error.message, undefined, 'error');
      floatingCaptionMode = null;
      renderFloatingCaptionToggle();
      renderPlaybackFloatingCaptionToggle();
    }
  } else {
    await window.brevia?.floatingCaption?.close();
  }
});
meetingSearch.addEventListener('input', () => {
  scheduleMeetingSearch();
});
meetingSearchClear.addEventListener('click', () => {
  meetingSearch.value = '';
  meetingSearchClear.hidden = true;
  meetingSearch.focus();
  updateSearchPopup();
});
meetingSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSearchPopup();
    meetingSearch.blur();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.library-search')) closeSearchPopup();
});
meetingSearch.addEventListener('focus', () => {
  if (meetingSearch.value.trim()) updateSearchPopup();
});
searchResultsPanel.addEventListener('click', async (event) => {
  const result = event.target.closest('[data-search-result]');
  if (!result) return;
  const meetingId = result.dataset.searchResult;
  closeSearchPopup();
  meetingSearch.value = '';
  meetingSearchClear.hidden = true;
  if (!meetingId || !window.brevia) {
    showView('detail');
    return;
  }
  try {
    await openMeetingRow(result, meetingId);
  } catch (error) {
    showToast(error.message, undefined, 'error');
  }
});
searchResultsPanel.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  meetingSearch.focus({ preventScroll: true });
  closeSearchPopup();
});
window.addEventListener('resize', positionSearchPopup);
/** 对搜索结果文本进行安全高亮。@param {string} text 原文。@param {string} query 关键词。@returns {string} 带 <mark> 高亮的 HTML。 */
function highlightSearchMatch(text, query) {
  const source = String(text || '');
  const needle = query.trim();
  if (!needle) return escapeHtml(source);
  const lower = source.toLowerCase();
  const q = needle.toLowerCase();
  let out = '';
  let i = 0;
  while (i < source.length) {
    const hit = lower.indexOf(q, i);
    if (hit === -1) {
      out += escapeHtml(source.slice(i));
      break;
    }
    if (hit > i) out += escapeHtml(source.slice(i, hit));
    out += `<mark>${escapeHtml(source.slice(hit, hit + q.length))}</mark>`;
    i = hit + q.length;
  }
  return out;
}
/** 搜索输入变化后（带防抖）刷新结果浮窗。@returns {void} */
function scheduleMeetingSearch() {
  searchRequestId++;
  const query = meetingSearch.value;
  meetingSearchClear.hidden = !query.trim();
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(updateSearchPopup, 160);
}
/** 渲染搜索结果浮窗。@returns {Promise<void>} */
async function updateSearchPopup() {
  const query = meetingSearch.value.trim();
  if (!query) {
    closeSearchPopup();
    return;
  }
  const requestId = ++searchRequestId;
  let meetings;
  try {
    meetings = window.brevia ? await window.brevia.meeting.search({ query }) : [];
  } catch (error) {
    if (requestId !== searchRequestId) return;
    closeSearchPopup();
    showToast(error.message, undefined, 'error');
    return;
  }
  if (requestId !== searchRequestId) return;
  if (!meetings.length) {
    searchResultsPanel.innerHTML = `<div class="search-results-empty">${escapeHtml(t('未找到匹配的会议'))}</div>`;
  } else {
    searchResultsPanel.innerHTML = `<div class="search-results-head">${escapeHtml(query)}<small>${t('{count} 条结果').replace('{count}', String(meetings.length))}</small></div>${meetings
      .map((meeting) => {
        const created =
          meeting.created_at || meeting.createdAt
            ? new Date(meeting.created_at || meeting.createdAt).toLocaleDateString(
                BreviaI18n.localeTag(locale),
                { month: 'short', day: 'numeric' },
              )
            : '';
        const durationMs = meeting.duration_ms != null ? meeting.duration_ms : meeting.durationMs;
        const duration = durationMs ? `${Math.round(durationMs / 60000)} ${t('分钟')}` : '';
        const snippet =
          meeting.snippets && meeting.snippets.length
            ? `<p class="search-snippet"><b>${highlightSearchMatch(meeting.snippets[0].speaker_name, query)}</b><span>${highlightSearchMatch(meeting.snippets[0].text, meeting.snippets[0].matched_term || query)}</span></p>`
            : `<p class="search-snippet search-snippet-title"><span>${escapeHtml(t('标题匹配'))}</span></p>`;
        return `<button type="button" class="search-result" role="option" data-search-result="${escapeHtml(meeting.id)}"><strong>${highlightSearchMatch(meeting.title, query)}</strong><small>${escapeHtml([created, duration].filter(Boolean).join(' · '))}</small>${snippet}</button>`;
      })
      .join('')}`;
  }
  searchResultsPanel.hidden = false;
  if (!searchResultsPanel.matches(':popover-open')) searchResultsPanel.showPopover();
  positionSearchPopup();
}
function positionSearchPopup() {
  if (searchResultsPanel.hidden) return;
  positionFloating(searchResultsPanel, meetingSearch.closest('.search'), [
    'bottom-start',
    'top-start',
  ]);
}
function closeSearchPopup() {
  searchRequestId++;
  window.clearTimeout(searchDebounceTimer);
  if (searchResultsPanel.matches(':popover-open')) searchResultsPanel.hidePopover();
  searchResultsPanel.hidden = true;
  searchResultsPanel.innerHTML = '';
}
const meetingSelectionSurface = document.querySelector('.library-panel');
let dragSelection;
let suppressMeetingClick = false;
const toggleMeetingSelection = (row) => {
  meetingSelectionMode = true;
  const key = row.dataset.selectionKey;
  if (selectedMeetingKeys.has(key)) selectedMeetingKeys.delete(key);
  else selectedMeetingKeys.add(key);
  syncMeetingSelection();
};
const selectVisibleMeetings = () => {
  const rows = [...meetingList.querySelectorAll('.meeting-row:not([hidden])')];
  const allSelected =
    rows.length > 0 && rows.every((row) => selectedMeetingKeys.has(row.dataset.selectionKey));
  meetingSelectionMode = true;
  if (allSelected) {
    selectedMeetingKeys.clear();
    syncMeetingSelection();
  } else {
    rows.forEach((row) => selectedMeetingKeys.add(row.dataset.selectionKey));
    syncMeetingSelection();
  }
};
batchToolbar.querySelector('#batch-select-all').addEventListener('change', selectVisibleMeetings);
document.querySelector('#meeting-selection-toggle').addEventListener('click', () => {
  if (meetingSelectionMode) clearMeetingSelection();
  else {
    meetingSelectionMode = true;
    closeMeetingMenus();
    syncMeetingSelection();
  }
});
meetingSelectionSurface.addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0 ||
    !meetingList.contains(event.target) ||
    event.clientY < libraryToolbar.getBoundingClientRect().top ||
    event.target.closest(
      'button, input, textarea, select, a, [contenteditable="true"], .meeting-row, .meeting-actions, .batch-toolbar',
    )
  )
    return;
  dragSelection = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    additive: event.shiftKey,
    initial: new Set(selectedMeetingKeys),
    moved: false,
    marquee: document.createElement('div'),
  };
  dragSelection.marquee.className = 'selection-marquee';
});
meetingSelectionSurface.addEventListener('dragstart', (event) => {
  if (!event.target.closest('.meeting-row[draggable]')) event.preventDefault();
});
meetingList.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.meeting-row[draggable]');
  if (!row || event.target.closest('.meeting-actions')) return event.preventDefault();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.meetingId);
});
meetingSelectionSurface.addEventListener('pointermove', (event) => {
  if (!dragSelection || event.pointerId !== dragSelection.pointerId) return;
  if (
    !dragSelection.moved &&
    Math.hypot(event.clientX - dragSelection.x, event.clientY - dragSelection.y) < 4
  )
    return;
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
    window.setTimeout(() => {
      suppressMeetingClick = false;
    }, 0);
  }
  dragSelection.marquee.remove();
  meetingList.classList.remove('is-selecting');
  if (meetingSelectionSurface.hasPointerCapture(event.pointerId))
    meetingSelectionSurface.releasePointerCapture(event.pointerId);
  dragSelection = undefined;
  syncMeetingSelection();
};
meetingSelectionSurface.addEventListener('pointerup', finishDragSelection);
meetingSelectionSurface.addEventListener('pointercancel', finishDragSelection);
meetingSelectionSurface.addEventListener(
  'click',
  (event) => {
    if (!suppressMeetingClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
meetingList.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, [data-rename-meeting]')) return;
  const workspace = event.target.closest('[data-sidebar-workspace-toggle]');
  if (workspace && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    toggleSidebarWorkspace(workspace.dataset.workspaceId || '', event.key === 'ArrowRight');
    return;
  }
  const row = event.target.closest('.meeting-row');
  if (row && event.key === ' ') {
    event.preventDefault();
    toggleMeetingSelection(row);
  }
});
function batchFormatButtons(content) {
  const formats =
    content === 'transcript'
      ? ['md', 'txt', 'json', 'srt', 'docx', 'pdf']
      : content === 'audio'
        ? ['wav']
        : exportContentFormats[content];
  return formats
    .map(
      (format) =>
        `<button type="button" data-batch-export-format="${format}"><b>${exportFormatDisplay[format]}</b><strong>.${format}</strong></button>`,
    )
    .join('');
}
let batchExportSnapshot = [];
let batchOperationBusy = false;
function openBatchExport() {
  batchExportSnapshot = selectedMeetings().map((meeting) => ({ ...meeting }));
  activeModal = 'batch-export';
  configureSettingsPage(activeModal);
  settingsModal.querySelector('.modal-title h2').textContent = t('选择导出格式');
  settingsModal.querySelector('.modal-title p').textContent = BreviaI18n.selectionOverview(
    locale,
    selectedMeetings().length,
  );
  replaceModalBody(
    'batch-export',
    `<label class="export-content-row"><b>${escapeHtml((exportHubCopy[locale] || exportHubCopy.en).what)}</b>
    <select data-batch-export-content>${['transcript', 'mynotes', 'notes', 'audio'].map((type) => `<option value="${type}">${escapeHtml(exportContentLabel[type]())}</option>`).join('')}</select></label>
    <div class="export-options">${batchFormatButtons('transcript')}</div>`,
  );
  showSettingsModal();
}
function showBatchResults(meetings, results, action, retry) {
  activeModal = 'batch-results';
  configureSettingsPage(activeModal);
  settingsModal.querySelector('.modal-title h2').textContent = t(
    action === 'export' ? '导出结果' : '处理结果',
  );
  settingsModal.querySelector('.modal-title p').textContent = '';
  const failures = meetings.filter(
    (meeting) => results.find((result) => result.meeting_id === meeting.id)?.error,
  );
  const success = results.filter((result) => result.path || result.completed).length;
  replaceModalBody(
    'batch-results',
    `<div class="batch-results">${meetings
      .map((meeting) => {
        const result = results.find((result) => result.meeting_id === meeting.id);
        return `<article>${interfaceIcon('document')}<strong>${escapeHtml(meeting.title)}</strong><div class="${result?.error ? 'batch-result-error' : ''}">${interfaceIcon(result?.error ? 'warning' : result?.path || result?.completed ? 'check' : 'info')}<span>${escapeHtml(t(result?.error ? '操作失败' : result?.path || result?.completed ? (action === 'export' ? '已导出' : '已完成') : '结果待确认'))}</span>${result?.error ? `<small>${escapeHtml(userFacingError(result.error))}</small>` : ''}</div></article>`;
      })
      .join(
        '',
      )}<footer><span>${escapeHtml(t('已完成'))} ${success} / ${meetings.length}</span>${failures.length && retry ? `<button class="secondary" data-retry-batch>${escapeHtml(t('重试失败项'))}</button>` : ''}<button class="secondary" data-close-modal>${escapeHtml(t('关闭'))}</button></footer></div>`,
  );
  const retryButton = settingsModal.querySelector('[data-retry-batch]');
  retryButton?.addEventListener('click', async () => {
    if (retryButton.disabled) return;
    retryButton.disabled = true;
    try {
      await retry(failures);
    } finally {
      retryButton.disabled = false;
    }
  });
  showSettingsModal();
}
async function exportSelectedMeetings(
  format,
  content,
  meetings = batchExportSnapshot,
  previousResults = [],
) {
  if (!meetings.length || !format || batchOperationBusy) return;
  batchOperationBusy = true;
  try {
    const result = window.brevia
      ? await window.brevia.meeting.exportMany({
          meeting_ids: meetings.map(({ id }) => id).filter(Boolean),
          format,
          content,
          filename_prefix: `[${content === 'transcript' ? t('字幕') : exportContentLabel[content]()}]`,
        })
      : null;
    if (!result) return;
    const received =
      result.results ||
      (result.paths?.length === meetings.length
        ? meetings.map((meeting, index) => ({ meeting_id: meeting.id, path: result.paths[index] }))
        : []);
    const ids = new Set(meetings.map((meeting) => meeting.id));
    const combined = [...previousResults.filter((item) => !ids.has(item.meeting_id)), ...received];
    const allMeetings = batchExportSnapshot;
    showBatchResults(allMeetings, combined, 'export', (failures) =>
      exportSelectedMeetings(format, content, failures, combined),
    );
  } catch (error) {
    showBatchResults(batchExportSnapshot, previousResults, 'export', null);
    settingsModal.querySelector('.modal-title p').textContent =
      `${t('结果待确认')} · ${userFacingError(error.message)}`;
  } finally {
    batchOperationBusy = false;
  }
}
batchToolbar.addEventListener('click', async (event) => {
  if (event.target.closest('[data-batch-clear]')) {
    clearMeetingSelection();
    return;
  }
  const meetings = selectedMeetings().map((meeting) => ({ ...meeting }));
  if (!meetings.length) return;
  if (event.target.closest('[data-batch-restore]')) {
    try {
      if (await runBatchMutation('restore', meetings)) showToast(t('恢复'), undefined, 'success');
    } catch (error) {
      await refreshBackendMeetings(true);
      showToast(error.message, undefined, 'error');
    }
    return;
  }
  if (event.target.closest('[data-batch-export]')) {
    openBatchExport();
    return;
  }
  const permanently = activeLibraryNav === 'recently-deleted';
  const deleteLabel = permanently ? BreviaI18n.trashCopy(locale).purge : t('删除');
  const deleteButton = event.target.closest('[data-batch-delete]');
  if (deleteButton) {
    openConfirmation(
      deleteLabel,
      `${BreviaI18n.selectionOverview(locale, meetings.length)}\n${meetings.map((meeting) => '「' + meeting.title + '」').join('\n')}\n${meetingDeletionConsequence(meetings, permanently)}`,
      async () => {
        try {
          await runBatchMutation(permanently ? 'purge' : 'delete', meetings);
        } catch (error) {
          await refreshBackendMeetings();
          showToast(error.message, undefined, 'error');
        }
      },
      deleteButton,
    );
  }
});
/** 示例录音直接永久删除，混合选择须分别说明两种结果。 */
function meetingDeletionConsequence(meetings, permanently = false) {
  if (permanently) return t('此操作不可恢复。');
  const outcomes = [];
  if (meetings.some((meeting) => !meeting.isExample))
    outcomes.push(t('会议将移至最近删除，可在那里恢复。'));
  if (meetings.some((meeting) => meeting.isExample))
    outcomes.push(t('示例会议及录音将永久删除，无法恢复。'));
  return outcomes.join(' ');
}
const positionMeetingMenu = (menu, toggle, opensLeft = false) => {
  const anchor = toggle.getBoundingClientRect();
  const sidebar = toggle.closest('.library-panel');
  const reference = {
    left: anchor.left - 8,
    right: (sidebar?.getBoundingClientRect().right || anchor.right) + 8,
    top: anchor.top - 5,
    bottom: anchor.bottom + 5,
  };
  menu.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
  positionFloating(
    menu,
    reference,
    opensLeft
      ? ['left-start', 'left-end', 'right-start', 'right-end']
      : ['right-start', 'right-end', 'left-start', 'left-end'],
  );
  menu.classList.toggle('opens-up', Number.parseFloat(menu.style.top) < anchor.top - 5);
};
const positionOpenMeetingMenus = () => {
  document
    .querySelectorAll(
      '.meeting-menu:not([hidden]), .refine-menu:not([hidden]), .detail-translation-menu:not([hidden])',
    )
    .forEach((menu) => {
      const toggle =
        menu.closest('.meeting-actions')?.querySelector('[data-meeting-menu]') ||
        menu.previousElementSibling;
      if (!toggle) return;
      if (menu.classList.contains('meeting-menu')) positionMeetingMenu(menu, toggle);
      else positionFloating(menu, toggle, ['bottom-end', 'top-end']);
    });
  document
    .querySelectorAll('.meeting-workspace-menu')
    .forEach((menu) => positionWorkspaceAssignMenu(menu));
};
const openMeetingMenu = (menu, toggle, opensLeft = false) => {
  BreviaMotion.cancel(menu);
  menu.inert = false;
  menu.hidden = false;
  positionMeetingMenu(menu, toggle, opensLeft);
  focusForKeyboard(menu.querySelector('button:not(:disabled)'));
};
const closeMeetingMenus = (immediate = false) => {
  document.querySelectorAll('.meeting-workspace-menu').forEach((menu) => menu.remove());
  document.querySelectorAll('.meeting-menu').forEach((menu) => {
    if (menu.hidden) return;
    menu.inert = true;
    const hide = () => {
      menu.hidden = true;
      menu.inert = false;
    };
    // 保护弹窗接手时立即退掉下层菜单，避免焦点和旧层在遮罩后滞留。
    if (immediate) {
      BreviaMotion.cancel(menu);
      hide();
    } else BreviaMotion.leave(menu, hide);
  });
  document
    .querySelectorAll('[data-meeting-menu]')
    .forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
};
meetingList.addEventListener('scroll', positionOpenMeetingMenus);
window.addEventListener('resize', positionOpenMeetingMenus);
/** 为行操作和批量操作运行一次会议变更。*/
async function mutateMeetings(action, meetings) {
  const completed = new Set(),
    results = [];
  for (const meeting of meetings) {
    if (!meeting.id || results.some((result) => result.meeting_id === meeting.id)) continue;
    try {
      if (window.brevia) await window.brevia.meeting[action]({ meeting_id: meeting.id });
      completed.add(meeting.id);
      results.push({ meeting_id: meeting.id, completed: true });
    } catch (error) {
      results.push({ meeting_id: meeting.id, error: String(error.message || error) });
    }
  }
  if (['delete', 'restore', 'purge'].includes(action)) {
    uiData.meetings = uiData.meetings.filter((meeting) => !completed.has(meeting.id));
    if (completed.size) scheduleLibraryMetrics();
  }
  clearMeetingSelection();
  const failed = results.filter((result) => result.error);
  if (failed.length) {
    meetingSelectionMode = true;
    failed.forEach((result) => selectedMeetingKeys.add(result.meeting_id));
  }
  renderMeetingList();
  if (failed.length) {
    const error = new Error(failed.map((result) => result.error).join('; '));
    error.results = results;
    throw error;
  }
  return results;
}
async function runBatchMutation(action, meetings, previousResults = [], allMeetings = meetings) {
  if (batchOperationBusy) return false;
  batchOperationBusy = true;
  batchToolbar.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
  });
  try {
    const results = await mutateMeetings(action, meetings);
    if (previousResults.length) {
      const combined = [
        ...previousResults.filter(
          (result) => !meetings.some((meeting) => meeting.id === result.meeting_id),
        ),
        ...results,
      ];
      showBatchResults(allMeetings, combined, action, null);
    }
    return true;
  } catch (error) {
    const combined = [
      ...previousResults.filter(
        (result) => !meetings.some((meeting) => meeting.id === result.meeting_id),
      ),
      ...(error.results || []),
    ];
    showBatchResults(allMeetings, combined, action, (failures) =>
      runBatchMutation(action, failures, combined, allMeetings),
    );
    return false;
  } finally {
    batchOperationBusy = false;
    syncMeetingSelection();
  }
}

async function openMeetingRow(row, meetingId = row.dataset.meetingId) {
  if (currentMeetingDetail?.id !== meetingId) {
    // 持续可见的会议导航允许直接切换；未保存的文档必须先由用户保存或取消。
    if (uiData.detail.notesEditing || uiData.detail.summaryEditing) {
      showToast(t('请先保存或取消当前编辑'), undefined, 'error');
      return;
    }
    if (typeof settleCorrectionDraft === 'function' && !(await settleCorrectionDraft())) return;
    if (settingsModal.matches(':popover-open')) closeModal();
  }
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  if (!window.brevia) {
    showView('detail');
    return;
  }
  const request = ++meetingListRequest;
  row.style.opacity = '0.6';

  try {
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });

    row.style.opacity = '';
    if (request !== meetingListRequest) return;
    breviaClient.state.selectedMeetingId = meeting.id;
    applyBackendDetail(meeting);
    if (activeView === 'detail') switchDetailDocument('summary');
    await showView('detail');
    syncCurrentMeetingNavigation();
  } catch (error) {
    row.style.opacity = '';
    if (request === meetingListRequest) showToast(error.message, undefined, 'error');
  }
}
function finishMeetingRename(restoreFocus) {
  const key = meetingRenameDraft.key;
  meetingRenameDraft = null;
  editingMeetingIndex = null;
  renderMeetingList();
  if (restoreFocus)
    meetingList
      .querySelector(`[data-selection-key="${CSS.escape(key)}"]`)
      ?.focus({ preventScroll: true });
}
meetingList.addEventListener('click', async (event) => {
  if (suppressMeetingClick) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (event.target.closest('[data-rename-meeting]')) {
    event.stopPropagation();
    if (event.target.closest('[data-cancel-meeting-rename]') && !meetingRenameDraft?.saving) {
      finishMeetingRename(true);
    }
    return;
  }
  const selectionRow = event.target.closest('.meeting-row');
  if (event.target.matches('[data-select-meeting]')) {
    toggleMeetingSelection(selectionRow);
    return;
  }
  if (selectionRow && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    event.stopPropagation();
    toggleMeetingSelection(selectionRow);
    return;
  }
  const actions = event.target.closest('.meeting-actions');
  if (!actions) {
    if (selectionRow && meetingSelectionMode) {
      toggleMeetingSelection(selectionRow);
      return;
    }
    if (selectionRow && activeLibraryNav !== 'recently-deleted') {
      try {
        await openMeetingRow(selectionRow);
      } catch (error) {
        showToast(error.message, undefined, 'error');
      }
    }
    return;
  }
  event.stopPropagation();
  const menuToggle = event.target.closest('[data-meeting-menu]');
  if (menuToggle) {
    const menu = actions.querySelector('.meeting-menu');
    const opening = menu.hidden;
    closeMeetingMenus();
    if (opening) openMeetingMenu(menu, menuToggle);
    menuToggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const action = event.target.closest('[data-meeting-action]');
  if (action) {
    const index = Number(action.dataset.meetingIndex);
    const meeting = uiData.meetings[index];
    if (action.dataset.meetingAction === 'workspace') {
      const rect = action.getBoundingClientRect();
      document.querySelectorAll('.meeting-workspace-menu').forEach((menu) => menu.remove());
      if (typeof showWorkspaceAssignMenu === 'function') {
        showWorkspaceAssignMenu(index, rect);
      }
      return;
    }
    if (action.dataset.meetingAction === 'rename') {
      const pending = meetingList.querySelector('[data-rename-meeting] input');
      if (pending && (meetingRenameDraft?.saving || pending.value !== pending.defaultValue)) {
        closeMeetingMenus();
        const group = pending.closest('[data-sidebar-workspace]')?.dataset.sidebarWorkspace;
        if (collapsedSidebarWorkspaces.has(group)) toggleSidebarWorkspace(group, true);
        pending.scrollIntoView({ block: 'nearest' });
        pending.focus({ preventScroll: true });
        showToast(t(meetingRenameDraft?.saving ? '正在保存…' : '已修改 · 尚未保存'));
        return;
      }
      editingMeetingIndex = index;
      meetingRenameDraft = {
        key: meeting.id || String(index),
        title: meeting.title,
        saving: false,
        error: '',
      };
      closeMeetingMenus();
      renderMeetingList();
      const titleInput = meetingList.querySelector('[data-rename-meeting] input');
      titleInput?.focus({ preventScroll: true });
      titleInput?.select();
      return;
    }
    if (action.dataset.meetingAction === 'open-folder') {
      try {
        const detail = await window.brevia?.meeting.get({ meeting_id: meeting.id });
        const audio =
          detail?.audio?.playback?.mix ||
          detail?.audio?.playback?.mic ||
          detail?.audio?.playback?.system;
        if (!audio) {
          showToast(t('未找到录音文件'));
          return;
        }
        await window.brevia.showItem(audio);
      } catch (error) {
        showToast(error.message, undefined, 'error');
      }
      closeMeetingMenus();
      return;
    }
    if (action.dataset.meetingAction === 'export') {
      closeMeetingMenus();
      if (window.brevia && meeting.id)
        window.brevia.meeting
          .export({
            meeting_id: meeting.id,
            content: 'transcript',
            format: 'md',
            filename_prefix: `[${t('字幕')}]`,
          })
          .then(
            (value) =>
              value &&
              showToast(
                t('已导出「{title}」').replace('{title}', meeting.title),
                undefined,
                'success',
              ),
          )
          .catch((error) => showToast(error.message, undefined, 'error'));
      else
        showToast(t('已导出「{title}」').replace('{title}', meeting.title), undefined, 'success');
      return;
    }
    if (action.dataset.meetingAction === 'delete') {
      openConfirmation(
        t('删除'),
        meetingDeletionConsequence([meeting]),
        async () => {
          try {
            await mutateMeetings('delete', [meeting]);
            showToast(
              t(meeting.isExample ? '示例会议及录音已删除' : '会议已移至最近删除'),
              undefined,
              'success',
            );
          } catch (error) {
            showToast(error.message, undefined, 'error');
          }
        },
        actions.querySelector('[data-meeting-menu]'),
        meeting.title,
      );
      return;
    }
    if (action.dataset.meetingAction === 'restore') {
      try {
        await mutateMeetings('restore', [meeting]);
        showToast(t('恢复'), undefined, 'success');
      } catch (error) {
        showToast(error.message, undefined, 'error');
      }
      return;
    }
    if (action.dataset.meetingAction === 'purge') {
      openConfirmation(
        BreviaI18n.trashCopy(locale).purge,
        meetingDeletionConsequence([meeting], true),
        async () => {
          try {
            await mutateMeetings('purge', [meeting]);
            showToast(BreviaI18n.trashCopy(locale).purge, undefined, 'success');
          } catch (error) {
            showToast(error.message, undefined, 'error');
          }
        },
        actions.querySelector('[data-meeting-menu]'),
        meeting.title,
      );
      return;
    }
  }
});
meetingList.addEventListener('input', (event) => {
  if (!event.target.matches('[data-rename-meeting] input') || !meetingRenameDraft) return;
  event.target.setCustomValidity('');
  meetingRenameDraft.title = event.target.value;
  meetingRenameDraft.error = '';
  event.target.closest('form').querySelector('.meeting-rename-state').textContent = '';
});
meetingList.addEventListener('submit', async (event) => {
  if (!event.target.matches('[data-rename-meeting]')) return;
  event.preventDefault();
  const form = event.target,
    draft = meetingRenameDraft;
  if (!draft || draft.saving || form.dataset.renameMeeting !== draft.key) return;
  const ownsFocus = () =>
    document.activeElement === document.body || form.contains(document.activeElement);
  const title = form.querySelector('input').value.trim();
  if (!title) {
    form.querySelector('input').setCustomValidity(t('会议名称不能为空'));
    form.querySelector('input').reportValidity();
    return;
  }
  const meeting = uiData.meetings.find((item, index) => (item.id || String(index)) === draft.key);
  if (!meeting) return;
  draft.title = title;
  draft.saving = true;
  form.querySelectorAll('input,button').forEach((control) => {
    control.disabled = true;
  });
  form.querySelector('.meeting-rename-state').textContent = t('正在保存…');
  try {
    if (title !== meeting.title)
      await window.brevia?.meeting.update({ meeting_id: meeting.id, updates: { title } });
    const row = uiData.meetings.find((item) => item.id === meeting.id);
    if (row) row.title = title;
    if (currentMeetingDetail?.id === meeting.id) {
      currentMeetingDetail.title = title;
      const heading = document.querySelector('#detail-view .detail-head h1');
      heading.title = title;
      heading.textContent = title;
      renderMiniPlayback();
    }
    if (meetingActive && breviaClient?.state.meeting?.id === meeting.id) {
      breviaClient.state.meeting.title = title;
      document.querySelector('#live-name').textContent = title;
      miniTitle.textContent = title;
      scheduleDesktopRecording();
    }
    if (meetingRenameDraft === draft) {
      finishMeetingRename(ownsFocus());
    } else renderMeetingList();
  } catch (error) {
    draft.saving = false;
    draft.error = userFacingError(error.message);
    form.querySelectorAll('input,button').forEach((control) => {
      control.disabled = false;
    });
    form.querySelector('.meeting-rename-state').textContent =
      `${t('重命名失败，修改仍保留')} · ${draft.error}`;
    if (form.isConnected && ownsFocus()) form.querySelector('input').focus({ preventScroll: true });
  }
});
meetingList.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    !event.isComposing &&
    event.target.closest('[data-rename-meeting]') &&
    !meetingRenameDraft?.saving
  ) {
    event.preventDefault();
    event.stopPropagation();
    finishMeetingRename(true);
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.flow-select'))
    document.querySelectorAll('.flow-select-options:not([hidden])').forEach((options) => {
      const toggle = options.closest('.flow-select')?.querySelector('.flow-select-toggle');
      if (!toggle || toggle.hidden) return;
      options.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });
  if (!event.target.closest('.meeting-actions, .meeting-workspace-menu')) {
    closeMeetingMenus();
    document.querySelectorAll('.meeting-workspace-menu').forEach((menu) => menu.remove());
  }

  // 工作区相关事件
  const sidebarWorkspaceEdit = event.target.closest('[data-edit-sidebar-workspace]');
  if (sidebarWorkspaceEdit) {
    showEditWorkspaceDialog(
      sidebarWorkspaceEdit.dataset.editSidebarWorkspace,
      sidebarWorkspaceEdit,
    );
    return;
  }
  const sidebarWorkspace = event.target.closest('[data-sidebar-workspace-toggle]');
  if (sidebarWorkspace) {
    toggleSidebarWorkspace(sidebarWorkspace.dataset.workspaceId || '');
    return;
  }
  if (event.target.closest('#workspace-selector')) {
    toggleWorkspacePicker();
    return;
  }
  const workspaceItem = event.target.closest('.workspace-item');
  if (workspaceItem && typeof switchWorkspace === 'function') {
    const workspaceId = workspaceItem.dataset.workspaceId || '';
    closeWorkspacePicker(true);
    void switchWorkspace(workspaceId);
    return;
  }

  const newWorkspaceBtn = event.target.closest('[data-new-workspace]');
  if (newWorkspaceBtn && typeof showNewWorkspaceDialog === 'function') {
    showNewWorkspaceDialog(null, null, newWorkspaceBtn);
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
    showNewWorkspaceDialog(meeting?.id, null, newWorkspaceAssign);
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
      showEditWorkspaceDialog(workspaceId, workspaceItem);
    }
  }
});

const playerTime = document.querySelector('#player-time');
const playerDuration = document.querySelector('#player-duration');
const playButton = document.querySelector('#play');
let playbackCaptionSegmentId = undefined;
function syncPlaybackFloatingCaption() {
  if (floatingCaptionMode !== 'playback' || !window.brevia?.floatingCaption) return;
  const segment = uiData.detail.transcript.find(
    (item) =>
      playerAudio.currentTime >= item.startSeconds && playerAudio.currentTime < item.endSeconds,
  );
  const segmentId = segment?.speaker?.segmentId ?? null;
  if (segmentId === playbackCaptionSegmentId) return;
  playbackCaptionSegmentId = segmentId;
  window.brevia.floatingCaption.update({
    segmentId,
    text: segment?.text || '',
    translation: segment?.translation || null,
    isRefined: true,
    locale: floatingCaptionLocale,
  });
}
function renderMiniPlayback() {
  const active =
    activeView !== 'detail' && playbackStarted && Boolean(playerAudio.src) && !playerAudio.ended;
  const wasHidden = miniPlayback.hidden;
  miniPlayback.hidden = !active;
  if (!active) return;
  if (wasHidden) taskCards.append(miniPlayback);
  miniPlayback.querySelector('#mini-playback-title').textContent =
    currentMeetingDetail?.title || t('播放录音');
  miniPlayback.querySelector('#mini-playback-state').textContent = playerAudio.paused
    ? t('暂停')
    : t('正在播放');
  miniPlaybackSeek.setAttribute('aria-valuemax', String(playerAudio.duration || 0));
  miniPlaybackSeek.setAttribute('aria-valuenow', String(playerAudio.currentTime));
  miniPlaybackSeek.style.setProperty(
    '--played',
    `${playerAudio.duration ? (playerAudio.currentTime / playerAudio.duration) * 100 : 0}%`,
  );
  miniPlaybackSeek.querySelector('i').style.transform =
    `scaleX(${playerAudio.duration ? playerAudio.currentTime / playerAudio.duration : 0})`;
  miniPlaybackToggle.innerHTML = interfaceIcon(playerAudio.paused ? 'play' : 'pause');
  miniPlaybackToggle.setAttribute('aria-label', playerAudio.paused ? t('继续') : t('暂停'));
}
const updatePlayerControl = () => {
  const playing = !playerAudio.paused && !playerAudio.ended;
  playButton.classList.toggle('is-playing', playing);
  playButton.innerHTML = interfaceIcon(playing ? 'pause' : 'play');
  playButton.setAttribute('aria-label', t(playing ? '暂停录音' : '播放录音'));
  renderMiniPlayback();
  scheduleDesktopRecording();
};
/** 将音频进度控件格式化为 mm:ss 显示。@returns {void} */
const renderPlayerTime = () => {
  playerTime.textContent = formatMeetingTime(Number(progress.value) * 1000);
  playerDuration.textContent = formatMeetingTime(Number(progress.max) * 1000);
  progress.style.setProperty(
    '--played',
    `${(Number(progress.value) / Number(progress.max)) * 100}%`,
  );
};
/** 突出显示当前播放时间的转录段落，并使其在自己的滚动器中居中。*/
function syncPlaybackTranscript() {
  syncPlaybackFloatingCaption();
  const body = document.querySelector('.transcript-body');
  if (!body) return;
  const current = playerAudio.currentTime;
  const segments = [...body.querySelectorAll('.segment[data-start][data-end]')];
  const active = segments.find(
    (segment) => current >= Number(segment.dataset.start) && current < Number(segment.dataset.end),
  );
  const previous = body.querySelector('.segment.is-active');
  if (previous === active) return;
  if (previous) {
    previous.classList.remove('is-active');
    previous.removeAttribute('aria-current');
  }
  if (!active) return;
  active.classList.add('is-active');
  active.setAttribute('aria-current', 'true');
  if (!followPlaybackTranscript) return;
  const bodyRect = body.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  body.scrollTo({
    top:
      body.scrollTop + activeRect.top - bodyRect.top - (body.clientHeight - activeRect.height) / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
progress.addEventListener('input', () => {
  clearSegmentPlayback();
  followPlaybackTranscript = true;
  renderPlayerTime();
  playerAudio.currentTime = Number(progress.value);
  syncPlaybackTranscript();
});
playButton.addEventListener('click', async () => {
  clearSegmentPlayback();
  if (!playerAudio.src) {
    showToast(t('这场会议没有可播放的录音'));
    return;
  }
  if (playerAudio.paused) await playerAudio.play();
  else playerAudio.pause();
  showToast(message(playerAudio.paused ? 'paused' : 'playing'));
});
playerAudio.addEventListener('play', () => {
  playbackStarted = true;
  updatePlayerControl();
});
playerAudio.addEventListener('pause', updatePlayerControl);
playerAudio.addEventListener('ended', () => {
  playbackStarted = false;
  updatePlayerControl();
});
playerAudio.addEventListener('timeupdate', () => {
  progress.value = playerAudio.currentTime;
  renderPlayerTime();
  syncPlaybackTranscript();
  renderMiniPlayback();
  scheduleDesktopRecording();
});
document.querySelector('#playback-floating-caption-toggle')?.addEventListener('click', async () => {
  floatingCaptionMode = nextFloatingCaptionMode('playback');
  renderFloatingCaptionToggle();
  renderPlaybackFloatingCaptionToggle();
  if (floatingCaptionMode !== 'playback') {
    await window.brevia?.floatingCaption?.close();
    return;
  }
  try {
    await window.brevia?.floatingCaption?.show();
    if (floatingCaptionMode !== 'playback') return;
    playbackCaptionSegmentId = undefined;
    syncPlaybackFloatingCaption();
  } catch (error) {
    if (floatingCaptionMode !== 'playback') return;
    showToast(error.message, undefined, 'error');
    floatingCaptionMode = null;
    renderFloatingCaptionToggle();
    renderPlaybackFloatingCaptionToggle();
  }
});
function seekMiniPlayback(clientX) {
  clearSegmentPlayback();
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
miniPlaybackSeek.addEventListener('pointermove', (event) => {
  if (miniPlaybackSeek.hasPointerCapture(event.pointerId)) seekMiniPlayback(event.clientX);
});
miniPlaybackSeek.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  clearSegmentPlayback();
  playerAudio.currentTime = Math.max(
    0,
    Math.min(
      playerAudio.duration || 0,
      playerAudio.currentTime + (event.key === 'ArrowRight' ? 5 : -5),
    ),
  );
  progress.value = playerAudio.currentTime;
  renderPlayerTime();
  syncPlaybackTranscript();
  renderMiniPlayback();
});
miniPlaybackToggle.addEventListener('click', async () => {
  clearSegmentPlayback();
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
miniPlayback.addEventListener('dblclick', (event) => {
  if (!event.target.closest('button')) void showView('detail');
});
const playerMute = document.querySelector('#player-mute');
const playerFullscreen = document.querySelector('#player-fullscreen');
function updatePlayerDisplayControls() {
  const playerMute = document.querySelector('#player-mute');
  const playerFullscreen = document.querySelector('#player-fullscreen');
  playerMute.innerHTML = interfaceIcon(playerAudio.muted ? 'muted' : 'volume');
  playerMute.setAttribute('aria-label', t(playerAudio.muted ? '取消静音' : '静音'));
  playerMute.setAttribute('aria-pressed', String(playerAudio.muted));
  playerFullscreen.setAttribute('aria-label', t(document.fullscreenElement ? '退出全屏' : '全屏'));
  playerFullscreen.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  document.querySelectorAll('.player .skip').forEach((button, index) => {
    button.setAttribute('aria-label', t(index ? '前进 15 秒' : '后退 15 秒'));
  });
}
playerMute.addEventListener('click', () => {
  playerAudio.muted = !playerAudio.muted;
});
playerAudio.addEventListener('volumechange', updatePlayerDisplayControls);
playerFullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('#detail-view').requestFullscreen();
  } catch (error) {
    showToast(error.message, undefined, 'error');
  }
});
document.addEventListener('fullscreenchange', updatePlayerDisplayControls);
updatePlayerDisplayControls();
document.querySelectorAll('.player .skip').forEach((button, index) =>
  button.addEventListener('click', () => {
    clearSegmentPlayback();
    playerAudio.currentTime = Math.max(
      0,
      Math.min(playerAudio.duration || 0, playerAudio.currentTime + (index ? 15 : -15)),
    );
  }),
);
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
themeToggle.addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
);

async function saveInlineSegmentSpeaker(form) {
  if (form.dataset.saving) return;
  const name = new FormData(form).get('name').trim();
  if (!name) {
    editingSegmentSpeakerId = undefined;
    renderMeetingDetail();
    return;
  }
  form.dataset.saving = 'true';
  try {
    const meeting = await window.brevia?.segment.speaker({
      meeting_id: currentMeetingDetail.id,
      segment_id: form.dataset.segmentId,
      name,
    });
    editingSegmentSpeakerId = undefined;
    if (meeting) applyBackendDetail(meeting);
  } catch (error) {
    delete form.dataset.saving;
    showToast(error.message, undefined, 'error');
  }
}
const finalTranscript = document.querySelector('.final-transcript');
const segmentContextMenu = document.createElement('div');
segmentContextMenu.className = 'segment-context-menu';
segmentContextMenu.hidden = true;
segmentContextMenu.setAttribute('role', 'menu');
document.body.append(segmentContextMenu);
let segmentContextReturnFocus;
let contextSegmentId;
let contextMeetingId;
let contextSegment;
function closeSegmentContextMenu() {
  contextSegmentId = undefined;
  contextMeetingId = undefined;
  contextSegment = undefined;
  segmentContextMenu.inert = true;
  BreviaMotion.leave(segmentContextMenu, () => {
    segmentContextMenu.hidden = true;
    segmentContextMenu.inert = false;
  });
  document
    .querySelectorAll('.has-segment-menu')
    .forEach((row) => row.classList.remove('has-segment-menu'));
}
function positionFloating(
  floating,
  reference,
  placements = ['right-start', 'left-start', 'right-end', 'left-end'],
) {
  // 固定浮层定位前结束祖先位移，键盘打开和快速切页也不会建立错误的包含块。
  for (let element = reference; element; element = element.parentElement)
    BreviaMotion.cancel(element);
  const anchor = reference.getBoundingClientRect ? reference.getBoundingClientRect() : reference;
  floating.style.left = '0px';
  floating.style.top = '0px';
  const width = floating.offsetWidth;
  const height = floating.offsetHeight;
  const positions = {
    'bottom-start': { left: anchor.left, top: anchor.bottom + 4 },
    'top-start': { left: anchor.left, top: anchor.top - height - 4 },
    'bottom-end': { left: anchor.right - width, top: anchor.bottom + 4 },
    'top-end': { left: anchor.right - width, top: anchor.top - height - 4 },
    'right-center': { left: anchor.right, top: (anchor.top + anchor.bottom - height) / 2 },
    'right-start': { left: anchor.right, top: anchor.top },
    'left-start': { left: anchor.left - width, top: anchor.top },
    'right-end': { left: anchor.right, top: anchor.bottom - height },
    'left-end': { left: anchor.left - width, top: anchor.bottom - height },
  };
  const position =
    placements
      .map((placement) => positions[placement])
      .find(
        ({ left, top }) =>
          left >= 8 &&
          top >= 8 &&
          left + width <= window.innerWidth - 8 &&
          top + height <= window.innerHeight - 8,
      ) || positions[placements[0]];
  floating.style.left = `${Math.max(8, Math.min(position.left, window.innerWidth - width - 8))}px`;
  floating.style.top = `${Math.max(8, Math.min(position.top, window.innerHeight - height - 8))}px`;
}
function openSegmentContextMenu(meetingId, segmentId, x, y, segmentInfo) {
  BreviaMotion.cancel(segmentContextMenu);
  segmentContextMenu.inert = false;
  closeMeetingPopovers();
  followLiveTranscript = false;
  followPlaybackTranscript = false;
  contextMeetingId = meetingId;
  contextSegmentId = segmentId;
  contextSegment = segmentInfo || null;
  segmentContextMenu.innerHTML = `<button type="button" data-add-segment-note>${interfaceIcon('notes')}<span>${t('加入笔记')}</span></button><button type="button" data-open-segment-profile-menu>${interfaceIcon('waveform')}<span>${t('添加到声纹库')}</span></button><button type="button" data-mark-segment-speaker>${interfaceIcon('person')}<span>${t('标记说话人')}</span></button>${typeof openCorrection === 'function' ? `<button type="button" data-context-correction>${interfaceIcon('search')}<span>${t('替换此词…')}</span></button>` : ''}`;
  const source = [...document.querySelectorAll('.view.active .segment[data-segment-id]')].find(
    (row) => row.dataset.segmentId === segmentId,
  );
  segmentContextMenu.dataset.correctionQuery = source?.contains(window.getSelection()?.anchorNode)
    ? window.getSelection().toString()
    : '';
  segmentContextReturnFocus =
    source?.querySelector('[data-segment-actions]') || document.activeElement;
  source?.classList.add('has-segment-menu');
  segmentContextMenu
    .querySelectorAll('button')
    .forEach((button) => button.setAttribute('role', 'menuitem'));
  segmentContextMenu.style.visibility = 'hidden';
  segmentContextMenu.hidden = false;
  positionFloating(segmentContextMenu, { left: x, right: x, top: y, bottom: y });
  segmentContextMenu.style.visibility = '';
  focusForKeyboard(segmentContextMenu.querySelector('button'));
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
/** 重点保存字幕原文及其开始时间，不使用点击时的会议计时。 */
function addSubtitleHighlight(info, meetingId) {
  const markdown = info && noteHighlightMarkdown(info.start_ms, info.text);
  if (!markdown || !meetingId) {
    showToast(t('无法获取字幕内容'));
    return;
  }
  if (meetingActive && meetingId === breviaClient?.state.meeting?.id) {
    liveNotesEditor.addHighlight(info.start_ms, info.text);
  } else {
    if (
      (detailNotesEditor?.getMarkdown() || uiData.detail.notes || '').split('\n').includes(markdown)
    )
      return;
    appendTextToActiveNotes(markdown, meetingId);
  }
  showToast(t('已加入笔记'), undefined, 'success');
}
document.addEventListener('click', (event) => {
  const highlight = event.target.closest('[data-note-highlight]');
  if (!highlight) return;
  const toggle = event.target.closest('[data-note-highlight-toggle]');
  if (toggle) {
    const body = highlight.querySelector('.note-highlight-body');
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.dataset.tooltip = toggle.ariaLabel = t(body.hidden ? '展开' : '收起');
    return;
  }
  if (!event.target.closest('[data-note-seek]') && highlight.closest('[contenteditable="true"]'))
    return;
  const start = Number(highlight.dataset.noteHighlight) / 1000;
  if (!Number.isFinite(start) || start < 0) return;
  if (highlight.closest('#live-view')) {
    const transcript = document.querySelector('#transcript-scroll');
    const row = [...transcript.querySelectorAll('.segment[data-start]')].find(
      (item) => Math.abs(Number(item.dataset.start) - start) < 0.001,
    );
    if (row) {
      followLiveTranscript = false;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      document.querySelector('#back-to-latest')?.removeAttribute('hidden');
    }
    return;
  }
  if (!playerAudio.getAttribute('src')) {
    showToast(t('未找到录音文件'));
    return;
  }
  followPlaybackTranscript = true;
  playerAudio.currentTime = Math.min(
    start,
    Number.isFinite(playerAudio.duration) ? playerAudio.duration : start,
  );
  progress.value = playerAudio.currentTime;
  renderPlayerTime();
  syncPlaybackTranscript();
});
/** 根据会议与段落 id 解析字幕元数据（live 视图从内存映射取，详情页从后端段落取）。@param {string} meetingId 会议 id。@param {string} segmentId 段落 id。@returns {{text:string, start_ms:number, speaker:string}|null} */
function segmentInfoFor(meetingId, segmentId) {
  if (meetingId === breviaClient?.state.meeting?.id) {
    return liveSegmentData.get(segmentId) || null;
  }
  const segment = currentMeetingDetail?.segments?.find((item) => item.id === segmentId);
  return segment
    ? {
        text: segment.text,
        start_ms: segment.start_ms,
        speaker: segment.speaker,
        speaker_name: segment.speaker_name,
      }
    : null;
}
function detailSegmentFor(meetingId, segmentId, original = false) {
  if (currentMeetingDetail?.id !== meetingId) return;
  for (const key of original
    ? ['original_segments', 'current_segments', 'segments']
    : ['current_segments', 'segments']) {
    const segment = currentMeetingDetail[key]?.find((item) => item.id === segmentId);
    if (segment) return segment;
  }
}
let segmentPlayback;
let segmentPlaybackTimer;
function syncSegmentPlaybackButtons() {
  document.querySelectorAll('[data-segment-tool="play"]').forEach((button) => {
    const playing = Boolean(
      segmentPlayback &&
        segmentPlayback.meetingId === currentMeetingDetail?.id &&
        button.closest('[data-segment-id]')?.dataset.segmentId === segmentPlayback.segmentId,
    );
    if (button.getAttribute('aria-pressed') === String(playing)) return;
    button.setAttribute('aria-pressed', String(playing));
    button.title = t(playing ? '暂停播放' : '播放此段');
    button.setAttribute('aria-label', button.title);
    button.innerHTML = interfaceIcon(playing ? 'pause' : 'play');
  });
}
function clearSegmentPlayback(pause = false) {
  clearTimeout(segmentPlaybackTimer);
  segmentPlayback = undefined;
  if (pause) playerAudio.pause();
  syncSegmentPlaybackButtons();
}
/** timeupdate 频率不足以守住短句边界；按播放速度补充定时检查。 */
function checkSegmentPlayback() {
  clearTimeout(segmentPlaybackTimer);
  const clip = segmentPlayback;
  if (!clip) return;
  if (clip.meetingId !== currentMeetingDetail?.id || clip.src !== playerAudio.src) {
    clearSegmentPlayback();
    return;
  }
  if (playerAudio.currentTime >= clip.end) {
    clearSegmentPlayback(true);
    playerAudio.currentTime = clip.end;
    progress.value = clip.end;
    renderPlayerTime();
    return;
  }
  syncSegmentPlaybackButtons();
  if (!playerAudio.paused) {
    const remaining = ((clip.end - playerAudio.currentTime) * 1000) / playerAudio.playbackRate;
    segmentPlaybackTimer = setTimeout(checkSegmentPlayback, Math.max(16, Math.min(120, remaining)));
  }
}
async function playTranscriptSegment(meetingId, segmentId) {
  if (segmentPlayback?.meetingId === meetingId && segmentPlayback.segmentId === segmentId) {
    clearSegmentPlayback(true);
    return;
  }
  const segment = detailSegmentFor(
    meetingId,
    segmentId,
    uiData.detail.hasRefined && uiData.detail.transcriptVersion === 'original',
  );
  if (!segment) return;
  if (!playerAudio.getAttribute('src')) {
    showToast(t('这场会议没有可播放的录音'));
    return;
  }
  const start = Math.max(0, Number(segment.start_ms) / 1000);
  const end = Math.min(
    Number(segment.end_ms) / 1000,
    Number.isFinite(playerAudio.duration) ? playerAudio.duration : Infinity,
  );
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  clearSegmentPlayback(true);
  const clip = { meetingId, segmentId, start, end, src: playerAudio.src, initialSeek: true };
  segmentPlayback = clip;
  playerAudio.currentTime = start;
  progress.value = start;
  followPlaybackTranscript = true;
  renderPlayerTime();
  syncPlaybackTranscript();
  syncSegmentPlaybackButtons();
  try {
    await playerAudio.play();
    if (segmentPlayback === clip) checkSegmentPlayback();
  } catch (error) {
    if (segmentPlayback !== clip) return;
    clearSegmentPlayback();
    showToast(userFacingError(error.message), undefined, 'error');
  }
}
playerAudio.addEventListener('timeupdate', checkSegmentPlayback);
playerAudio.addEventListener('ratechange', checkSegmentPlayback);
playerAudio.addEventListener('pause', () => {
  if (playerAudio.paused) clearSegmentPlayback();
});
playerAudio.addEventListener('ended', () => clearSegmentPlayback());
playerAudio.addEventListener('emptied', () => {
  if (!playerAudio.getAttribute('src') || segmentPlayback?.src !== playerAudio.src)
    clearSegmentPlayback();
});
playerAudio.addEventListener('seeking', () => {
  // 点击片段自身的定位不取消边界；后续拖动、时间戳定位恢复普通播放。
  if (
    segmentPlayback?.initialSeek &&
    Math.abs(playerAudio.currentTime - segmentPlayback.start) < 0.05
  )
    return;
  clearSegmentPlayback();
});
playerAudio.addEventListener('seeked', () => {
  if (segmentPlayback) segmentPlayback.initialSeek = false;
});
const segmentTranslationRequests = new Map();
const transcriptTranslationRequests = new Set();
const liveTranslationRequests = new Map();
const translationWaiters = new Map();
function isMeetingTranslationPending(meetingId) {
  return (
    transcriptTranslationRequests.has(meetingId) ||
    liveTranslationRequests.has(meetingId) ||
    [...segmentTranslationRequests.values()].some((item) => item.meeting_id === meetingId)
  );
}
function isSegmentTranslationPending(meetingId, segmentId) {
  return (
    transcriptTranslationRequests.has(meetingId) ||
    liveTranslationRequests.has(meetingId) ||
    segmentTranslationRequests.has(JSON.stringify([meetingId, segmentId]))
  );
}
function notifyTranslationSettled(meetingId) {
  const waiters = translationWaiters.get(meetingId);
  translationWaiters.delete(meetingId);
  waiters?.forEach((resolve) => resolve());
}
/** 后台翻译等待同会议任务完成；获闸后再读取原文及目标语言。 */
async function acquireTranscriptTranslation(meetingId) {
  while (isMeetingTranslationPending(meetingId)) {
    await new Promise((resolve) => {
      const waiters = translationWaiters.get(meetingId) || [];
      waiters.push(resolve);
      translationWaiters.set(meetingId, waiters);
    });
  }
  transcriptTranslationRequests.add(meetingId);
  syncDetailTranslationPending(meetingId);
}
function releaseTranscriptTranslation(meetingId) {
  transcriptTranslationRequests.delete(meetingId);
  syncDetailTranslationPending(meetingId);
  notifyTranslationSettled(meetingId);
}
function syncDetailTranslationPending(meetingId) {
  if (currentMeetingDetail?.id !== meetingId) return;
  uiData.detail.translationPending = isMeetingTranslationPending(meetingId);
  for (const key of ['transcript', 'originalTranscript', 'refinedTranscript']) {
    uiData.detail[key]?.forEach((item) => {
      item.translationPending = isSegmentTranslationPending(meetingId, item.segmentId);
    });
  }
  document
    .querySelectorAll('.final-transcript [data-segment-tool="translate"]')
    .forEach((button) => {
      const segmentId = button.closest('[data-segment-id]')?.dataset.segmentId;
      const pending = isSegmentTranslationPending(meetingId, segmentId);
      button.disabled = pending;
      button.setAttribute('aria-busy', String(pending));
      button.title = t(pending ? '正在翻译字幕' : '翻译');
      button.setAttribute('aria-label', button.title);
    });
  document
    .querySelectorAll('[data-detail-translation-toggle], [data-detail-translation]')
    .forEach((button) => {
      button.disabled = uiData.detail.translationPending;
    });
}
/** 只合并仍匹配原文版本的译文，保留当前编辑器、滚动位置及另一场会议。 */
function applySegmentTranslation(meetingId, snapshot, result) {
  const current = detailSegmentFor(meetingId, snapshot.id);
  const sameSource = (segment) =>
    segment?.text === snapshot.text &&
    segment?.version === snapshot.version &&
    segment?.revision === snapshot.revision;
  if (
    !sameSource(current) ||
    result?.cancelled ||
    result?.meeting_id !== meetingId ||
    result?.segment_id !== snapshot.id ||
    typeof result.translation !== 'string'
  )
    return;
  for (const key of ['segments', 'current_segments', 'original_segments']) {
    currentMeetingDetail[key]
      ?.filter((item) => item.id === snapshot.id && sameSource(item))
      .forEach((item) => {
        item.translation = result.translation;
      });
  }
  if (currentMeetingDetail.correction?.stale_translations) {
    currentMeetingDetail.correction.stale_translations =
      currentMeetingDetail.correction.stale_translations.filter((id) => id !== snapshot.id);
  }
  for (const key of ['transcript', 'originalTranscript', 'refinedTranscript']) {
    uiData.detail[key]
      ?.filter((item) => item.segmentId === snapshot.id && sameSource(item))
      .forEach((item) => {
        item.translation = result.translation;
        item.translationStale = false;
      });
  }
  document
    .querySelectorAll(
      `.final-transcript [data-segment-id="${CSS.escape(snapshot.id)}"] .segment-copy`,
    )
    .forEach((copy) => {
      if (
        copy.querySelector('textarea') ||
        copy.querySelector('p:not(.translation)')?.textContent !== snapshot.text
      )
        return;
      let line = copy.querySelector('.translation');
      if (!line) {
        line = document.createElement('p');
        copy.append(line);
      }
      line.className = 'translation';
      line.textContent = result.translation;
    });
}
async function translateTranscriptSegment(meetingId, segmentId, targetLanguage) {
  const segment = detailSegmentFor(meetingId, segmentId);
  const key = JSON.stringify([meetingId, segmentId]);
  if (
    !segment ||
    !targetLanguage ||
    !window.brevia?.translation ||
    transcriptTranslationRequests.has(meetingId) ||
    liveTranslationRequests.has(meetingId) ||
    segmentTranslationRequests.has(key)
  )
    return;
  const snapshot = { ...segment, meeting_id: meetingId };
  segmentTranslationRequests.set(key, snapshot);
  syncDetailTranslationPending(meetingId);
  try {
    const result = await generateSegmentTranslation(snapshot, targetLanguage);
    applySegmentTranslation(meetingId, snapshot, result);
  } catch (error) {
    if (currentMeetingDetail?.id === meetingId)
      showToast(`${t('翻译失败')}: ${userFacingError(error.message)}`, undefined, 'error');
  } finally {
    segmentTranslationRequests.delete(key);
    syncDetailTranslationPending(meetingId);
    notifyTranslationSettled(meetingId);
  }
}
const segmentTranslationMenu = document.createElement('div');
let segmentTranslationAnchor;
segmentTranslationMenu.className = 'meeting-popover meeting-menu segment-translation-menu';
segmentTranslationMenu.setAttribute('popover', 'auto');
segmentTranslationMenu.setAttribute('role', 'menu');
document.body.append(segmentTranslationMenu);
segmentTranslationMenu.addEventListener('toggle', () => {
  if (!segmentTranslationMenu.matches(':popover-open'))
    segmentTranslationAnchor?.closest('.segment')?.classList.remove('has-segment-menu');
});
function openSegmentTranslation(meetingId, segmentId, anchor) {
  if (isSegmentTranslationPending(meetingId, segmentId)) return;
  closeMeetingPopovers();
  if (uiData.detail.translationTarget) {
    void translateTranscriptSegment(meetingId, segmentId, uiData.detail.translationTarget);
    return;
  }
  segmentTranslationMenu.setAttribute('aria-label', t('翻译'));
  segmentTranslationAnchor = anchor;
  segmentTranslationMenu.innerHTML = BreviaI18n.languageOptions(locale, t)
    .slice(1)
    .map(
      ([code, name]) =>
        `<button type="button" role="menuitem" data-segment-language="${escapeHtml(code)}">${escapeHtml(name)}</button>`,
    )
    .join('');
  segmentTranslationMenu.onclick = (event) => {
    const choice = event.target.closest('[data-segment-language]');
    if (
      !choice ||
      currentMeetingDetail?.id !== meetingId ||
      isSegmentTranslationPending(meetingId, segmentId)
    )
      return;
    closeMeetingPopovers();
    anchor.focus({ preventScroll: true });
    uiData.detail.translationTarget = choice.dataset.segmentLanguage;
    void translateTranscriptSegment(meetingId, segmentId, choice.dataset.segmentLanguage);
  };
  segmentTranslationMenu.onkeydown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...segmentTranslationMenu.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    buttons[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
    ]?.focus();
  };
  anchor.closest('.segment')?.classList.add('has-segment-menu');
  segmentTranslationMenu.showPopover();
  positionFloating(segmentTranslationMenu, anchor, ['bottom-end', 'top-end']);
  focusForKeyboard(segmentTranslationMenu.querySelector('button'));
}
segmentContextMenu.addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...segmentContextMenu.querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  buttons[
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
  ]?.focus();
});
segmentContextMenu.addEventListener('click', async (event) => {
  if (event.target.closest('[data-mark-segment-speaker]')) {
    const meetingId = contextMeetingId,
      segmentId = contextSegmentId,
      anchor = segmentContextReturnFocus;
    closeSegmentContextMenu();
    if (anchor?.isConnected) void openSegmentSpeakerPicker(meetingId, segmentId, anchor);
    return;
  }

  if (event.target.closest('[data-add-segment-note]')) {
    const info = contextSegment;
    const meetingId = contextMeetingId;
    closeSegmentContextMenu();
    if (info) {
      appendTextToActiveNotes(info.text, meetingId);
      showToast(t('已加入笔记'), undefined, 'success');
    } else showToast(t('无法获取字幕内容'));
    return;
  }
  if (event.target.closest('[data-open-segment-profile-menu]')) {
    const meetingId = contextMeetingId,
      segmentId = contextSegmentId;
    closeSegmentContextMenu();
    void openSegmentProfilePanel(meetingId, segmentId);
  }
});
const segmentSpeakerPicker = document.createElement('div');
segmentSpeakerPicker.className = 'meeting-popover segment-speaker-picker';
segmentSpeakerPicker.setAttribute('popover', 'auto');
segmentSpeakerPicker.setAttribute('role', 'dialog');
document.body.append(segmentSpeakerPicker);
function closeMeetingPopovers() {
  segmentSpeakerDraft = undefined;
  document
    .querySelectorAll('.meeting-popover:popover-open')
    .forEach((popover) => popover.hidePopover());
  document
    .querySelectorAll('.has-segment-menu')
    .forEach((row) => row.classList.remove('has-segment-menu'));
}
function isDefaultSegmentSpeakerName(name) {
  return /^(?:spk|speaker|说话人|話者|화자|hablante|orador|locuteur|intervenant|sprecher|говорящий|спикер)\d+$/i.test(
    name.replace(/[\s_-]+/g, ''),
  );
}
// 只同步身份，保留正文选区、翻译和滚动位置。
function updateLiveSpeaker(meetingId, segment) {
  if (!segment || breviaClient?.state.meeting?.id !== meetingId) return;
  const data = liveSegmentData.get(segment.id);
  const element = liveSegments.get(segment.id);
  if (!data || !element) return;
  const name = formatSpeakerName(segment.speaker_name || segment.speaker);
  let label = element.querySelector('.segment-speaker');
  if (!label) {
    label = document.createElement('button');
    label.type = 'button';
    label.className = 'segment-speaker';
    element.querySelector('.segment-meta').append(label);
  }
  label.dataset.segmentSpeaker = segment.id;
  label.dataset.speaker = segment.speaker;
  label.textContent = name;
  label.title = t('标记说话人');
  label.dataset.liveSpeaker = '';
  element.querySelector('.speaker-avatar')?.remove();
  label.insertAdjacentHTML(
    'beforebegin',
    renderSpeakerAvatar({ id: segment.speaker, name }, liveSpeakerPalette),
  );
  liveSegmentData.set(segment.id, {
    ...data,
    revision: Number(segment.revision) || data.revision,
    speaker: segment.speaker,
    speaker_name: name,
  });
}
async function openSegmentSpeakerPicker(meetingId, segmentId, anchor) {
  closeMeetingPopovers();
  followLiveTranscript = followPlaybackTranscript = false;
  const draft = { meetingId, segmentId, anchor, saving: false };
  segmentSpeakerDraft = draft;
  try {
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
    if (segmentSpeakerDraft !== draft) return;
    if (!anchor.isConnected || !anchor.checkVisibility() || anchor.closest('[inert]')) {
      segmentSpeakerDraft = undefined;
      return;
    }
    const segment = meeting.segments.find((item) => item.id === segmentId);
    if (!segment) throw Error(t('无法获取字幕内容'));
    const palette = meetingId === livePaletteMeetingId ? new Map(liveSpeakerPalette) : new Map();
    for (const person of meeting.speakers) speakerColor(person.id || person.name, palette);
    const names = [
      ...new Set([...meeting.speakers, ...speakerProfiles].map((person) => person.name)),
    ].filter((name) => name && name.length <= 32 && !isDefaultSegmentSpeakerName(name));
    segmentSpeakerPicker.setAttribute('aria-label', t('标记说话人'));
    segmentSpeakerPicker.innerHTML = `<header><h3>${escapeHtml(t('标记说话人'))}</h3><button class="icon-button" data-close-meeting-popover type="button" aria-label="${escapeHtml(t('关闭'))}">${interfaceIcon('close')}</button></header><form><label>${escapeHtml(t('说话人名称'))}<input name="name" required maxlength="32" autocomplete="off" placeholder="${escapeHtml(t('搜索'))}" /></label><div class="segment-speaker-options">${names.map((name) => `<button type="button" data-segment-speaker-choice="${escapeHtml(name)}"${name === segment.speaker_name ? ' aria-current="true"' : ''}>${renderSpeakerAvatar(meeting.speakers.find((person) => person.name === name) || speakerProfiles.find((person) => person.name === name) || name, palette)}<span>${escapeHtml(name)}</span></button>`).join('')}</div><p data-speaker-empty role="status"${names.length ? ' hidden' : ''}>${escapeHtml(t('暂无内容'))}</p><p>${escapeHtml(t('仅修改此段的说话人。'))}</p><p role="alert" hidden></p><button class="modal-action" type="submit">${escapeHtml(t('确认'))}</button></form>`;
    anchor.closest('.segment')?.classList.add('has-segment-menu');
    draft.open = true;
    segmentSpeakerPicker.showPopover();
    positionFloating(segmentSpeakerPicker, anchor, ['bottom-end', 'top-end']);
    focusForKeyboard(segmentSpeakerPicker.querySelector('input'));
  } catch (error) {
    if (segmentSpeakerDraft === draft) {
      segmentSpeakerDraft = undefined;
      closeMeetingPopovers();
      showToast(userFacingError(error.message), undefined, 'error');
    }
  }
}
segmentSpeakerPicker.addEventListener('input', (event) => {
  if (!event.target.matches('input[name="name"]')) return;
  event.target.setCustomValidity('');
  const query = event.target.value.trim().toLocaleLowerCase();
  const options = [...segmentSpeakerPicker.querySelectorAll('[data-segment-speaker-choice]')];
  options.forEach((option) => {
    option.hidden = !option.dataset.segmentSpeakerChoice.toLocaleLowerCase().includes(query);
  });
  segmentSpeakerPicker.querySelector('[data-speaker-empty]').hidden = options.some(
    (option) => !option.hidden,
  );
  segmentSpeakerPicker.querySelector('[role="alert"]').hidden = true;
});
segmentSpeakerPicker.addEventListener('click', (event) => {
  const choice = event.target.closest('[data-segment-speaker-choice]');
  if (!choice || segmentSpeakerDraft?.saving) return;
  segmentSpeakerPicker.querySelector('input').value = choice.dataset.segmentSpeakerChoice;
  segmentSpeakerPicker.querySelector('form').requestSubmit();
});
segmentSpeakerPicker.addEventListener('submit', async (event) => {
  event.preventDefault();
  const draft = segmentSpeakerDraft;
  if (!draft || draft.saving) return;
  const input = segmentSpeakerPicker.querySelector('input');
  const name = input.value.trim();
  if (!name || isDefaultSegmentSpeakerName(name)) {
    input.setCustomValidity(t('请填写真实的说话人名称。'));
    input.reportValidity();
    return;
  }
  draft.saving = true;
  segmentSpeakerPicker.querySelectorAll('button, input').forEach((control) => {
    control.disabled = true;
  });
  try {
    const meeting = await window.brevia.segment.speaker({
      meeting_id: draft.meetingId,
      segment_id: draft.segmentId,
      name,
    });
    if (currentMeetingDetail?.id === meeting.id) applyBackendDetail(meeting);
    if (breviaClient?.state.meeting?.id === meeting.id) {
      breviaClient.state.meeting.speakers = meeting.speakers;
      updateLiveSpeaker(
        meeting.id,
        (meeting.current_segments || meeting.segments || []).find(
          (segment) => segment.id === draft.segmentId,
        ),
      );
    }
    if (segmentSpeakerDraft === draft) {
      closeMeetingPopovers();
      const row = [...document.querySelectorAll('.view.active .segment[data-segment-id]')].find(
        (row) => row.dataset.segmentId === draft.segmentId,
      );
      const trigger = draft.anchor.isConnected
        ? draft.anchor
        : row?.querySelector('[data-live-speaker], [data-segment-tool="speaker"]');
      trigger?.focus({ preventScroll: true });
      showToast(t('已保存'), undefined, 'success');
    }
  } catch (error) {
    if (segmentSpeakerDraft === draft) {
      const message = segmentSpeakerPicker.querySelector('[role="alert"]');
      message.textContent = userFacingError(error.message);
      message.hidden = false;
    }
  } finally {
    if (segmentSpeakerDraft === draft) {
      draft.saving = false;
      segmentSpeakerPicker.querySelectorAll('button, input').forEach((control) => {
        control.disabled = false;
      });
    }
  }
});
document.addEventListener(
  'toggle',
  (event) => {
    if (!event.target.matches('.meeting-popover')) return;
    const open = event.newState === 'open';
    event.target
      .closest('.summary-participants')
      ?.querySelector('[data-summary-participants-toggle]')
      ?.setAttribute('aria-expanded', String(open));
    if (
      event.target === segmentSpeakerPicker &&
      !open &&
      (!segmentSpeakerDraft || segmentSpeakerDraft.open)
    ) {
      segmentSpeakerDraft = undefined;
      document
        .querySelectorAll('.has-segment-menu')
        .forEach((row) => row.classList.remove('has-segment-menu'));
    }
  },
  true,
);
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-meeting-popover]')) {
    const popover = event.target.closest('[popover]');
    popover.hidePopover();
    return;
  }
  const toggle = event.target.closest('[data-summary-participants-toggle]');
  if (!toggle) return;
  const popover = toggle.closest('.summary-participants').querySelector('[popover]');
  if (popover.matches(':popover-open')) {
    popover.hidePopover();
    return;
  }
  closeMeetingPopovers();
  popover.showPopover();
  toggle.setAttribute('aria-expanded', 'true');
  positionFloating(popover, toggle, ['bottom-end', 'top-end']);
});
window.addEventListener('resize', closeMeetingPopovers);
document.addEventListener('pointerdown', (event) => {
  if (
    segmentSpeakerDraft &&
    !segmentSpeakerDraft.open &&
    !event.target.closest('.segment-tools, .segment-context-menu')
  )
    closeMeetingPopovers();
});
document.addEventListener(
  'scroll',
  (event) => {
    if (!event.target.closest?.('.meeting-popover')) closeMeetingPopovers();
  },
  true,
);
const segmentProfilePanel = document.createElement('aside');
segmentProfilePanel.className = 'segment-profile-panel';
segmentProfilePanel.hidden = true;
segmentProfilePanel.setAttribute('aria-label', t('添加到声纹库'));
let segmentProfileDraft;
let segmentProfileReturnFocus;
const segmentProfileAudio = new Audio();
let segmentProfilePreviewTimer;
let segmentProfileMotion;
playerAudio.addEventListener('play', () => segmentProfileAudio.pause());
function closeSegmentProfilePanel(force = false) {
  if (segmentProfileDraft?.saving && !force) return;
  const { transform, opacity } = getComputedStyle(segmentProfilePanel);
  segmentProfileMotion?.cancel();
  segmentProfileAudio.pause();
  segmentProfileAudio.removeAttribute('src');
  segmentProfileDraft = undefined;
  segmentProfilePanel.inert = true;
  const complete = () => {
    segmentProfilePanel.hidden = true;
    segmentProfilePanel.parentElement?.classList.remove('has-segment-profile');
    document
      .querySelectorAll('.is-profile-source')
      .forEach((e) => e.classList.remove('is-profile-source'));
    if (segmentProfileReturnFocus?.isConnected)
      segmentProfileReturnFocus.focus({ preventScroll: true });
  };
  if (force || segmentProfilePanel.hidden) {
    complete();
    return;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  segmentProfileMotion = segmentProfilePanel.animate(
    [
      { transform, opacity },
      { transform: reduced ? 'none' : 'translateX(100%)', opacity: 0 },
    ],
    { duration: reduced ? 80 : 160, easing: 'ease-in' },
  );
  segmentProfileMotion.finished.then(complete, () => {});
}
function renderSegmentProfilePanel() {
  const draft = segmentProfileDraft;
  if (!draft) return;
  segmentProfilePanel.parentElement
    ?.querySelectorAll('[data-segment-id]')
    .forEach((row) =>
      row.classList.toggle('is-profile-source', row.dataset.segmentId === draft.segmentId),
    );
  const { segment, profileId, create, saving, success, error } = draft;
  const profile = speakerProfiles.find((item) => item.id === profileId);
  const name =
    success?.name || (create ? draft.name.trim() : profile && speakerProfileName(profile)) || '';
  const e = escapeHtml;
  const scope = t('本段说话人将标记为「{name}」。').replace('{name}', name);
  const limits = advancedSettings?.settings?.voice_profiles;
  const isFull = (item) =>
    item &&
    limits &&
    (item.sample_count >= limits.max_samples ||
      item.duration_ms + segment.end_ms - segment.start_ms > limits.max_total_seconds * 1000);
  const profiles = speakerProfiles
    .map((item) => {
      const full = isFull(item);
      return `<label class="segment-profile-person"${saving ? ' inert' : ''}><input type="radio" name="segment-profile" value="${e(item.id)}"${profileId === item.id ? ' checked' : ''}${full ? ' disabled' : ''} />${interfaceIcon('person')}<span><b>${e(speakerProfileName(item))}</b><small>${item.sample_count} ${e((speakerProfileCopy[locale] || speakerProfileCopy.en).samples)}${full ? ` · ${e(t('已达上限'))}` : ''}</small></span></label>`;
    })
    .join('');
  segmentProfilePanel.innerHTML = `<header><h2>${e(t('添加到声纹库'))}</h2><button class="icon-button" data-close-segment-profile type="button" aria-label="${e(t('关闭'))}"${saving ? ' disabled' : ''}>${interfaceIcon('close')}</button></header><div class="segment-profile-body">${success ? `<div class="segment-profile-success" role="status">${interfaceIcon('check')}<h3>${e(t('已添加到「{name}」').replace('{name}', name))}</h3><p>${e(scope)}</p></div>` : ''}<div class="segment-profile-source"><small>${e(draft.title)} · ${e(formatMeetingTime(segment.start_ms))} — ${e(formatMeetingTime(segment.end_ms))}</small><blockquote>${e(segment.text)}</blockquote><div class="segment-profile-audio"><button class="icon-button" data-preview-segment-profile type="button" aria-label="${e(t('播放录音'))}"${!draft.url || saving ? ' disabled' : ''}>${interfaceIcon('play')}</button><input type="range" data-segment-profile-seek min="${segment.start_ms / 1000}" max="${segment.end_ms / 1000}" step=".01" value="${segment.start_ms / 1000}" aria-label="${e(t('播放进度'))}"${!draft.url ? ' disabled' : ''}/><time>${e(formatMeetingTime(segment.end_ms - segment.start_ms))}</time></div></div>${success ? `<button class="secondary" data-view-segment-profile type="button">${e(t('查看声纹'))}</button>` : `<p class="segment-profile-hint">${e(t('请试听，确认片段中只有这位说话人。'))}</p><section class="segment-profile-choice">${create ? `<button class="text-button" data-existing-segment-profile type="button"${saving ? ' disabled' : ''}>${interfaceIcon('back')}${e(t('返回已有声纹'))}</button><h3>${e(t('新增声纹'))}</h3><form data-create-segment-profile><label>${e(t('声纹名称'))}<input name="name" maxlength="32" required autocomplete="off" value="${e(draft.name)}"${saving ? ' disabled' : ''}/></label><p>${e(t('这段录音将作为首个声音样本。'))}</p></form>` : `<h3>${e(t('添加到谁的声纹？'))}</h3><label class="search">${interfaceIcon('search')}<input type="search" data-segment-profile-search placeholder="${e(t('搜索'))}" aria-label="${e(t('搜索'))}" value="${e(draft.search)}"${saving ? ' disabled' : ''}/></label><div class="segment-profile-people">${profiles || `<p>${e(t('暂无已注册声纹'))}</p>`}</div><p data-segment-profile-empty hidden>${e(t('暂无内容'))}</p><button class="text-button" data-new-segment-profile type="button"${saving ? ' disabled' : ''}>${interfaceIcon('plus')}${e(t('新增声纹'))}</button>`}</section>`}<p class="segment-profile-error" role="alert"${error ? '' : ' hidden'}>${e(error || '')}</p></div><footer>${!success ? `<p data-segment-profile-scope>${name ? e(scope) : ''}</p>` : ''}<div>${success ? `<button class="modal-action" data-close-segment-profile type="button">${e(t('返回逐字稿'))}</button>` : `<button class="secondary" data-close-segment-profile type="button"${saving ? ' disabled' : ''}>${e(t('取消'))}</button><button class="modal-action" data-save-segment-profile type="button"${saving || !draft.url || !name || (!create && isFull(profile)) ? ' disabled' : ''}>${e(saving ? t('正在添加…') : create ? t('创建并添加') : t('添加到「{name}」').replace('{name}', name))}</button>`}</div></footer>`;
  filterSegmentProfiles();
}
function filterSegmentProfiles() {
  if (!segmentProfileDraft) return;
  const query = segmentProfileDraft.search.toLocaleLowerCase();
  const rows = [...segmentProfilePanel.querySelectorAll('.segment-profile-person')];
  rows.forEach((row) => {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
  });
  const empty = segmentProfilePanel.querySelector('[data-segment-profile-empty]');
  if (empty) empty.hidden = !rows.length || rows.some((row) => !row.hidden);
}
async function openSegmentProfilePanel(meetingId, segmentId, anchor) {
  if (segmentProfileDraft?.saving) return;
  closeSegmentProfilePanel(true);
  const layout = document.querySelector(activeView === 'live' ? '.live-layout' : '.detail-layout');
  const draft = { meetingId, segmentId, name: '', search: '', create: false, saving: false };
  segmentProfileDraft = draft;
  segmentProfileReturnFocus =
    anchor ||
    [...layout.querySelectorAll('[data-segment-id]')]
      .find((row) => row.dataset.segmentId === segmentId)
      ?.querySelector('[data-segment-actions]') ||
    document.activeElement;
  try {
    const [meeting, settings] = await Promise.all([
      window.brevia.meeting.get({ meeting_id: meetingId }),
      window.brevia.advancedSettings.get(),
    ]);
    if (segmentProfileDraft !== draft) return;
    advancedSettings = settings;
    const segment = meeting.segments.find((item) => item.id === segmentId);
    const path = meeting.audio?.playback?.[segment?.track] || meetingPlaybackPath(meeting);
    if (!segment || !path || !(segment.end_ms > segment.start_ms)) throw Error(t('未找到录音文件'));
    draft.segment = segment;
    draft.title = meeting.title || t('会议库');
    speakerProfiles = await window.brevia.speakerProfile.list();
    if (segmentProfileDraft !== draft) return;
    draft.profileId = segment.profile_id;
    draft.url = await window.brevia.audioUrl(path);
    if (segmentProfileDraft !== draft) return;
    playerAudio.pause();
    segmentProfileAudio.src = draft.url;
    layout.append(segmentProfilePanel);
    layout.classList.add('has-segment-profile');
    segmentProfilePanel.hidden = false;
    segmentProfilePanel.inert = false;
    layout
      .querySelectorAll('[data-segment-id]')
      .forEach((row) =>
        row.classList.toggle('is-profile-source', row.dataset.segmentId === segmentId),
      );
    renderSegmentProfilePanel();
    focusForKeyboard(
      segmentProfilePanel.querySelector('input[name=name], [data-segment-profile-search]'),
    );
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    segmentProfileMotion = segmentProfilePanel.animate(
      [
        { transform: reduced ? 'none' : 'translateX(100%)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: reduced ? 80 : 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  } catch (error) {
    if (segmentProfileDraft === draft) {
      closeSegmentProfilePanel();
      showToast(userFacingError(error.message), undefined, 'error');
    }
  }
}
async function saveSegmentProfile() {
  const draft = segmentProfileDraft;
  if (!draft || draft.saving || !draft.url) return;
  const name = draft.create
    ? draft.name.trim()
    : speakerProfileName(speakerProfiles.find((p) => p.id === draft.profileId) || {});
  if (!name) return;
  if (
    draft.create &&
    speakerProfiles.some(
      (p) => speakerProfileName(p).toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    draft.error = t('已有同名声纹，请选择已有声纹。');
    renderSegmentProfilePanel();
    return;
  }
  draft.saving = true;
  draft.error = '';
  segmentProfileAudio.pause();
  renderSegmentProfilePanel();
  try {
    const payload = { meeting_id: draft.meetingId, segment_id: draft.segmentId };
    const meeting = await (draft.create
      ? window.brevia.segment.speaker({ ...payload, name, enroll: true })
      : window.brevia.segment.addProfileSample({ ...payload, profile_id: draft.profileId }));
    const profiles = await window.brevia.speakerProfile.list();
    speakerProfiles = profiles;
    if (meeting && currentMeetingDetail?.id === meeting.id) applyBackendDetail(meeting);
    if (meeting)
      updateLiveSpeaker(
        meeting.id,
        (meeting.current_segments || meeting.segments || []).find(
          (segment) => segment.id === draft.segmentId,
        ),
      );
    if (segmentProfileDraft !== draft) return;
    draft.success = profiles.find((p) =>
      draft.create ? p.name === name : p.id === draft.profileId,
    );
    if (!draft.success?.sample_count) throw Error(t('无法提取声音样本，请选择清晰的单人语音。'));
    draft.profileId = draft.success.id;
  } catch (error) {
    draft.success = undefined;
    draft.error = t(userFacingError(error.message));
  } finally {
    if (segmentProfileDraft === draft) {
      draft.saving = false;
      renderSegmentProfilePanel();
    }
  }
}
segmentProfilePanel.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-segment-profile]')) closeSegmentProfilePanel();
  if (event.target.closest('[data-new-segment-profile], [data-existing-segment-profile]')) {
    if (segmentProfileDraft.saving) return;
    segmentProfileDraft.create = Boolean(event.target.closest('[data-new-segment-profile]'));
    segmentProfileDraft.error = '';
    renderSegmentProfilePanel();
  }
  if (event.target.closest('[data-save-segment-profile]')) void saveSegmentProfile();
  if (event.target.closest('[data-view-segment-profile]')) {
    expandedSpeakerProfileId = segmentProfileDraft.profileId;
    closeSegmentProfilePanel();
    void openModal('speaker-profiles');
  }
  if (event.target.closest('[data-preview-segment-profile]')) {
    const draft = segmentProfileDraft;
    const { segment } = draft;
    if (!segmentProfileAudio.paused) segmentProfileAudio.pause();
    else {
      playerAudio.pause();
      if (
        segmentProfileAudio.currentTime < segment.start_ms / 1000 ||
        segmentProfileAudio.currentTime >= segment.end_ms / 1000
      )
        segmentProfileAudio.currentTime = segment.start_ms / 1000;
      segmentProfileAudio.play().catch((error) => {
        if (segmentProfileDraft === draft) {
          segmentProfileDraft.error = userFacingError(error.message);
          renderSegmentProfilePanel();
        }
      });
    }
  }
});
segmentProfilePanel.addEventListener('input', (event) => {
  const draft = segmentProfileDraft;
  if (!draft || draft.saving) return;
  if (event.target.matches('[data-segment-profile-search]')) {
    draft.search = event.target.value;
    filterSegmentProfiles();
  }
  if (event.target.matches('input[name=name]')) {
    draft.name = event.target.value;
    draft.error = '';
    segmentProfilePanel.querySelector('.segment-profile-error').hidden = true;
    const submit = segmentProfilePanel.querySelector('[data-save-segment-profile]');
    submit.disabled = !draft.name.trim();
    segmentProfilePanel.querySelector('[data-segment-profile-scope]').textContent =
      draft.name.trim()
        ? t('本段说话人将标记为「{name}」。').replace('{name}', draft.name.trim())
        : '';
  }
  if (event.target.matches('[data-segment-profile-seek]'))
    segmentProfileAudio.currentTime = Math.min(
      draft.segment.end_ms / 1000,
      Math.max(draft.segment.start_ms / 1000, Number(event.target.value)),
    );
});
segmentProfilePanel.addEventListener('change', (event) => {
  if (
    event.target.name === 'segment-profile' &&
    segmentProfileDraft &&
    !segmentProfileDraft.saving
  ) {
    segmentProfileDraft.profileId = event.target.value;
    renderSegmentProfilePanel();
    segmentProfilePanel.querySelector('input[name=segment-profile]:checked')?.focus();
  }
});
segmentProfilePanel.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveSegmentProfile();
});
segmentProfileAudio.addEventListener('loadedmetadata', () => {
  if (segmentProfileDraft?.segment)
    segmentProfileAudio.currentTime = segmentProfileDraft.segment.start_ms / 1000;
});
function scheduleSegmentProfilePreview() {
  clearTimeout(segmentProfilePreviewTimer);
  if (!segmentProfileAudio.paused && segmentProfileDraft?.segment)
    segmentProfilePreviewTimer = setTimeout(
      () => segmentProfileAudio.pause(),
      Math.max(0, segmentProfileDraft.segment.end_ms / 1000 - segmentProfileAudio.currentTime) *
        1000,
    );
}
segmentProfileAudio.addEventListener('seeked', scheduleSegmentProfilePreview);
segmentProfileAudio.addEventListener('timeupdate', () => {
  const draft = segmentProfileDraft;
  if (!draft?.segment) return;
  if (segmentProfileAudio.currentTime >= draft.segment.end_ms / 1000) segmentProfileAudio.pause();
  const slider = segmentProfilePanel.querySelector('[data-segment-profile-seek]');
  if (slider) slider.value = Math.min(draft.segment.end_ms / 1000, segmentProfileAudio.currentTime);
});
for (const type of ['play', 'pause', 'ended'])
  segmentProfileAudio.addEventListener(type, () => {
    scheduleSegmentProfilePreview();
    const button = segmentProfilePanel.querySelector('[data-preview-segment-profile]');
    if (button) {
      button.innerHTML = interfaceIcon(segmentProfileAudio.paused ? 'play' : 'pause');
      button.setAttribute('aria-label', t(segmentProfileAudio.paused ? '播放录音' : '暂停播放'));
    }
  });
segmentProfileAudio.addEventListener('error', () => {
  if (segmentProfileDraft && segmentProfileAudio.hasAttribute('src')) {
    segmentProfileDraft.error = t('未找到录音文件');
    renderSegmentProfilePanel();
  }
});
document.addEventListener(
  'keydown',
  (event) => {
    if (
      event.key === 'Escape' &&
      (segmentSpeakerDraft || document.querySelector('.meeting-popover:popover-open'))
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const anchor =
        segmentSpeakerDraft?.anchor ||
        (segmentTranslationMenu.matches(':popover-open') ? segmentTranslationAnchor : null) ||
        document.querySelector('[data-summary-participants-toggle][aria-expanded="true"]');
      closeMeetingPopovers();
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape' && !segmentContextMenu.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSegmentContextMenu();
      if (segmentContextReturnFocus?.isConnected) segmentContextReturnFocus.focus();
      return;
    }
    if (event.key === 'Escape' && settingsModal.hidden && !segmentProfilePanel.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSegmentProfilePanel();
    }
  },
  true,
);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-segment-actions], [data-segment-tool]');
  if (!button) return;
  event.stopPropagation();
  hidePageTooltip();
  const row = button.closest('.segment[data-segment-id]');
  const meetingId =
    activeView === 'live' ? breviaClient?.state.meeting?.id : currentMeetingDetail?.id;
  if (!meetingId || !row) return;
  const segmentId = row.dataset.segmentId;
  const info = segmentInfoFor(meetingId, segmentId);
  if (button.dataset.segmentTool === 'play') {
    closeMeetingPopovers();
    void playTranscriptSegment(meetingId, segmentId);
  } else if (button.dataset.segmentTool === 'translate') {
    openSegmentTranslation(meetingId, segmentId, button);
  } else if (button.dataset.segmentTool === 'speaker') {
    void openSegmentSpeakerPicker(meetingId, segmentId, button);
  } else if (button.dataset.segmentTool === 'profile') {
    closeMeetingPopovers();
    void openSegmentProfilePanel(meetingId, segmentId, button);
  } else if (button.dataset.segmentTool === 'highlight') {
    addSubtitleHighlight(info, meetingId);
  } else if (button.dataset.segmentTool === 'note') {
    closeMeetingPopovers();
    if (info) {
      appendTextToActiveNotes(info.text, meetingId);
      showToast(t('已加入笔记'), undefined, 'success');
    } else showToast(t('无法获取字幕内容'));
  } else {
    closeMeetingPopovers();
    const rect = button.getBoundingClientRect();
    openSegmentContextMenu(meetingId, segmentId, rect.left, rect.bottom, info);
  }
});
finalTranscript.addEventListener('contextmenu', (event) => {
  const segment = event.target.closest('[data-segment-id]');
  if (!segment || !currentMeetingDetail) return;
  event.preventDefault();
  openSegmentContextMenu(
    currentMeetingDetail.id,
    segment.dataset.segmentId,
    event.clientX,
    event.clientY,
    segmentInfoFor(currentMeetingDetail.id, segment.dataset.segmentId),
  );
});
document.addEventListener('mousedown', (event) => {
  if (!segmentContextMenu.hidden && !segmentContextMenu.contains(event.target))
    closeSegmentContextMenu();
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
  if (refinementBusyMeetingId) {
    showToast(t('error.tasks.running'));
    return;
  }
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
    showToast(error.message, undefined, 'error');
  });
};
/** 用户在这次精修里显式选过的模型；没选过返回 undefined，让后端自己选。@returns {string|undefined} */
function pinnedRefineModel() {
  return uiData.detail.refinedModelPinned ? uiData.detail.refinedModelId : undefined;
}
/** 会议是否已有逐句人工修改。@returns {boolean} 有则为真。 */
function meetingHasUserEdits() {
  return Boolean(
    currentMeetingDetail?.segments?.some(
      (segment) => segment.user_edited || segment.version === 'user',
    ),
  );
}
/** 按菜单里的选择发起精修。
 *
 * 人工修改依赖段落 id；即使不换模型，VAD 或人数变化也可能重新分段。
 * @param {number} [numSpeakers] 固定说话人数。@returns {void} */
function refineWithSelectedModel(numSpeakers) {
  const modelId = pinnedRefineModel();
  if (meetingHasUserEdits()) {
    openConfirmation(
      t('重新精修'),
      t(
        '该会议已有逐句修改。重新精修可能改变分段，使这些修改不再出现在当前逐字稿中。原稿仍保存在本机历史数据中。',
      ),
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
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
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
async function translateLatestTranscript(targetLanguage, meeting = currentMeetingDetail) {
  const segments = meeting && latestTranscriptSegments(meeting).segments;
  if (
    !meeting ||
    !targetLanguage ||
    !segments?.length ||
    !window.brevia?.translation ||
    isMeetingTranslationPending(meeting.id)
  )
    return;
  // 全文请求会写回会议的目标语言，不能与同会议的单句请求交错。
  transcriptTranslationRequests.add(meeting.id);
  syncDetailTranslationPending(meeting.id);
  if (meeting.id === currentMeetingDetail?.id) {
    uiData.detail.translationTarget = targetLanguage;
    uiData.detail.translationPending = true;
    renderMeetingDetail();
  }
  try {
    let completed = 0;
    showTranslationProgress(completed, segments.length, targetLanguage);
    const results = await mapWithConcurrency(segments, 4, async (segment) => {
      try {
        return await generateSegmentTranslation(segment, targetLanguage);
      } finally {
        showTranslationProgress(++completed, segments.length, targetLanguage);
      }
    });
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) showToast(`${t('翻译失败')}: ${failure.reason.message}`, undefined, 'error');
    const refreshed = await window.brevia.meeting.get({ meeting_id: meeting.id });
    applyCorrectionMeeting(refreshed);
  } catch (error) {
    showToast(`${t('翻译失败')}: ${error.message}`, undefined, 'error');
  } finally {
    releaseTranscriptTranslation(meeting.id);
  }
}
/** 精修完成后等待旧译文落盘，再按最新目标语言翻译当前稿。 */
async function translateRefinedTranscript(meetingId) {
  await acquireTranscriptTranslation(meetingId);
  try {
    const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
    if (!meeting.target_language) return;
    const results = await mapWithConcurrency(
      latestTranscriptSegments(meeting).segments,
      4,
      (segment) =>
        generateSegmentTranslation({ ...segment, meeting_id: meetingId }, meeting.target_language),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) showToast(`${t('翻译失败')}: ${failure.reason.message}`, undefined, 'error');
    const refreshed = await window.brevia.meeting.get({ meeting_id: meetingId });
    applyCorrectionMeeting(refreshed);
  } catch (error) {
    showToast(`${t('翻译失败')}: ${error.message}`, undefined, 'error');
  } finally {
    releaseTranscriptTranslation(meetingId);
  }
}
/** 实时同语言字幕可并行；遇到回看或精修翻译则等待，并重新读取当前稿。 */
async function translateSettledTranscriptSegment(payload, targetLanguage) {
  const meetingId = payload.meeting_id;
  if (!meetingId || !targetLanguage) return;
  const active = liveTranslationRequests.get(meetingId);
  const conflicting =
    transcriptTranslationRequests.has(meetingId) ||
    [...segmentTranslationRequests.values()].some((item) => item.meeting_id === meetingId) ||
    (active && active.targetLanguage !== targetLanguage);
  if (conflicting) {
    await acquireTranscriptTranslation(meetingId);
    try {
      const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
      const segment = latestTranscriptSegments(meeting).segments.find(
        (item) => item.id === (payload.segment_id || payload.id),
      );
      const currentTarget =
        meetingActive && breviaClient?.state.meeting?.id === meetingId
          ? liveConfig.target_language
          : meeting.target_language;
      // 精修改写了分段时，不用旧事件的 fallback 原文重新创建过期字幕。
      if (segment && currentTarget)
        await generateSegmentTranslation({ ...segment, meeting_id: meetingId }, currentTarget);
    } finally {
      releaseTranscriptTranslation(meetingId);
    }
    return;
  }
  const batch = active || { targetLanguage, count: 0 };
  batch.count++;
  liveTranslationRequests.set(meetingId, batch);
  syncDetailTranslationPending(meetingId);
  try {
    await generateSegmentTranslation(payload, targetLanguage);
  } finally {
    if (--batch.count === 0) liveTranslationRequests.delete(meetingId);
    syncDetailTranslationPending(meetingId);
    notifyTranslationSettled(meetingId);
  }
}
/** 保存字幕编辑态下的逐句修正：只提交真正改动的段落，写入后端用户版本。@returns {Promise<void>} */
async function saveDetailTranscriptEdits() {
  const meeting = currentMeetingDetail;
  const d = uiData.detail;
  if (!meeting || !d.transcriptEditing || d.transcriptSaveState === 'saving') return;
  const original = new Map(
    (latestTranscriptSegments(meeting).segments || []).map((segment) => [
      segment.id,
      String(segment.text).trim(),
    ]),
  );
  const edits = [];
  d.transcriptErrors = {};
  for (const [segmentId, value] of Object.entries(d.transcriptDraft || {})) {
    const text = String(value).trim();
    if (!text || text.length > 4000) {
      d.transcriptErrors[segmentId] = t(!text ? '字幕内容不能为空' : '保存失败');
      renderMeetingDetail();
      document.querySelector(`[data-segment-text="${CSS.escape(segmentId)}"]`)?.focus();
      return;
    }
    if (!original.has(segmentId)) {
      d.transcriptSaveState = 'failed';
      renderMeetingDetail();
      showToast(t('保存失败，修改仍保留'), undefined, 'error');
      return;
    }
    if (text !== original.get(segmentId)) {
      const base = d.transcriptEditEntries?.find((entry) => entry.segmentId === segmentId);
      edits.push({
        segment_id: segmentId,
        text,
        ...(base
          ? { expected: { text: base.text, version: base.version, revision: base.revision } }
          : {}),
      });
    }
  }
  if (!edits.length) {
    d.transcriptEditing = false;
    d.transcriptDraft = {};
    d.transcriptSaveState = 'saved';
    renderMeetingDetail();
    return;
  }
  d.transcriptSaveState = 'saving';
  renderMeetingDetail();
  try {
    if (!window.brevia?.segment?.saveText) throw new Error(t('保存失败'));
    const updated = await window.brevia.segment.saveText({
      meeting_id: meeting.id,
      segments: edits,
    });
    if (!updated || updated.id !== meeting.id) throw new Error(t('保存失败'));
    if (currentMeetingDetail?.id !== meeting.id) return;
    d.transcriptEditing = false;
    d.transcriptDraft = {};
    d.transcriptSaveState = 'saved';
    detailActiveTab = 'transcript';
    applyBackendDetail(updated);
    showToast(t('字幕已保存'), undefined, 'success');
  } catch (error) {
    if (currentMeetingDetail?.id !== meeting.id) return;
    d.transcriptSaveState = 'failed';
    renderMeetingDetail();
    showToast(`${t('保存失败')}: ${error.message}`, undefined, 'error');
  }
}
finalTranscript.addEventListener('input', (event) => {
  const field = event.target.closest('[data-segment-text]');
  if (!field || uiData.detail.transcriptSaveState === 'saving') return;
  const d = uiData.detail;
  d.transcriptDraft ||= {};
  d.transcriptDraft[field.dataset.segmentText] = field.value;
  d.transcriptErrors = {};
  const original = new Map(
    (latestTranscriptSegments(currentMeetingDetail).segments || []).map((segment) => [
      segment.id,
      String(segment.text).trim(),
    ]),
  );
  d.transcriptSaveState = Object.entries(d.transcriptDraft).some(
    ([id, text]) => String(text).trim() !== original.get(id),
  )
    ? 'dirty'
    : 'unchanged';
  finalTranscript.querySelector('.detail-content-header').outerHTML = renderDetailTabbar();
  field
    .closest('.segment-copy')
    .classList.toggle(
      'is-modified',
      String(field.value).trim() !== original.get(field.dataset.segmentText),
    );
  const copy = field.closest('.segment-copy');
  const translationLabel = copy.querySelector('.translation > span');
  if (translationLabel)
    translationLabel.textContent = t(
      copy.classList.contains('is-modified') ? '译文（未更新）' : '翻译',
    );
  let marker = copy.querySelector('.segment-modified-state');
  if (copy.classList.contains('is-modified') && !marker) {
    marker = document.createElement('small');
    marker.className = 'segment-modified-state';
    marker.textContent = t('已修改');
    copy.prepend(marker);
  } else if (!copy.classList.contains('is-modified')) marker?.remove();
  field.removeAttribute('aria-invalid');
  finalTranscript.querySelectorAll('.segment-edit-error').forEach((element) => element.remove());
  resizeTranscriptField(field);
});
finalTranscript.addEventListener('click', async (event) => {
  // 点击字幕段的时间戳/说话人区域 → 定位播放该段。
  const segmentMeta = event.target.closest('.segment-meta');
  if (segmentMeta && !event.target.closest('[data-segment-speaker-input], .segment-tools')) {
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
    uiData.detail.notesSaveState = 'saved';
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
    if (uiData.detail.notesSaveState === 'saving') return;
    uiData.detail.notesSaveState = 'saving';
    document.querySelector('[data-notes-save-status]').innerHTML = renderSaveState('saving');
    const cancel = document.querySelector('[data-notes-cancel]');
    notesSave.disabled = true;
    cancel.disabled = true;
    try {
      await persistNotes(meetingId, notes);
      if (currentMeetingDetail?.id !== meetingId) return;
      if (uiData.detail.notesEditing && detailNotesEditor?.getMarkdown() !== notes) {
        uiData.detail.notesSaveState = 'dirty';
        finalTranscript.querySelector('.detail-content-header').outerHTML = renderDetailTabbar();
        return;
      }
      uiData.detail.notes = notes;
      uiData.detail.notesEditing = false;
      uiData.detail.notesSaveState = 'saved';
      detailActiveTab = 'notes';
      renderMeetingDetail();
    } catch (error) {
      if (currentMeetingDetail?.id === meetingId && uiData.detail.notesEditing) {
        uiData.detail.notesSaveState = 'failed';
        finalTranscript.querySelector('.detail-content-header').outerHTML = renderDetailTabbar();
        notesSave.textContent = t('重试');
        notesSave.setAttribute('aria-label', t('重试'));
        notesSave.title = t('重试');
      }
      showToast(error.message, undefined, 'error');
    } finally {
      notesSave.disabled = false;
      cancel.disabled = false;
    }
    return;
  }
  const editTranscript = event.target.closest('[data-edit-transcript]');
  if (editTranscript) {
    const d = uiData.detail;
    d.transcriptEditEntries = (
      d.hasRefined && d.transcriptVersion !== 'original'
        ? d.refinedTranscript
        : d.originalTranscript || d.transcript
    ).map((entry) => ({ ...entry }));
    uiData.detail.transcriptEditing = true;
    uiData.detail.transcriptSaveState = 'unchanged';
    uiData.detail.transcriptErrors = {};
    uiData.detail.transcriptDraft = {};
    detailActiveTab = 'transcript';
    renderMeetingDetail();
    focusForKeyboard(finalTranscript.querySelector('[data-segment-text]'));
    return;
  }
  const transcriptCancel = event.target.closest('[data-transcript-cancel]');
  if (transcriptCancel) {
    if (uiData.detail.transcriptSaveState === 'saving') return;
    uiData.detail.transcriptSaveState = 'saved';
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
    if (opening)
      finalTranscript.querySelectorAll('.refine-menu').forEach((menu) => {
        menu.hidden = true;
      });
    options.hidden = !opening;
    detailTranslationToggle.setAttribute('aria-expanded', String(opening));
    if (opening) positionFloating(options, detailTranslationToggle, ['bottom-end', 'top-end']);
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
      refineLanguageToggle
        .closest('.refine-menu')
        ?.querySelectorAll('.flow-select-options')
        .forEach((other) => {
          if (other !== options) other.hidden = true;
        });
    }
    options.hidden = !opening;
    fitFlowSelectOptions(options, refineLanguageToggle);
    refineLanguageToggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const refineLanguageChoice = event.target.closest('[data-flow-select-choice="refine-language"]');
  if (refineLanguageChoice) {
    const select = refineLanguageChoice.closest('.flow-select');
    select.querySelector('input').value = refineLanguageChoice.dataset.value;
    select.querySelector('.flow-select-toggle').firstChild.nodeValue =
      refineLanguageChoice.textContent;
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
    if (modelRow)
      modelRow.outerHTML = renderRefineModelRow(candidates, uiData.detail.refinedModelId);
    return;
  }
  const refineModelChoice = event.target.closest('[data-flow-select-choice="refine-model"]');
  if (refineModelChoice) {
    const select = refineModelChoice.closest('.flow-select');
    select.querySelector('input').value = refineModelChoice.dataset.value;
    // 用 data-label 而不是 textContent：模型选项还带「推荐」角标，textContent 会把角标
    // 也拼进按钮文案。
    select.querySelector('.flow-select-toggle').firstChild.nodeValue =
      refineModelChoice.dataset.label;
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
    finalTranscript.querySelectorAll('.refine-menu').forEach((other) => {
      if (other !== menu) other.hidden = true;
    });
    const opening = menu.hidden;
    if (opening) {
      finalTranscript.querySelectorAll('.detail-translation-menu').forEach((other) => {
        other.hidden = true;
      });
      finalTranscript
        .querySelectorAll('[data-detail-translation-toggle]')
        .forEach((button) => button.setAttribute('aria-expanded', 'false'));
    }
    menu.hidden = !opening;
    more.setAttribute('aria-expanded', String(!menu.hidden));
    // 打开选单时预填当前会议已知的说话人数（自动则留空，提示手动输入）。
    if (opening) {
      const input = menu.querySelector('[data-refine-num-speakers]');
      const numSpeakers = currentMeetingDetail?.num_speakers;
      if (input) input.value = Number.isInteger(numSpeakers) && numSpeakers > 0 ? numSpeakers : '';
      positionFloating(menu, more, ['bottom-end', 'top-end']);
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
  switchDetailDocument(tab.dataset.detailTab);
});
function switchDetailDocument(target) {
  if (correctionPanelState && correctionPanelState.scope !== target) {
    if (correctionPanelState.saving) return false;
    closeCorrectionPanel();
  }
  if (target === detailActiveTab) return true;
  detailActiveTab = target;
  setDetailLayoutMode(target === 'summary' ? 'summary' : 'transcript');
  // tabbar 的编辑动作跟随激活 tab（笔记 → 编辑笔记，字幕 → 逐句编辑字幕），
  // 因此切换 tab 时必须重建 tabbar，否则铅笔会停留在上一个 tab 的含义。
  const tabbar = finalTranscript.querySelector('.detail-content-header');
  if (tabbar) {
    const holder = document.createElement('div');
    holder.innerHTML = renderDetailTabbar();
    tabbar.replaceWith(holder.firstElementChild);
  }
  finalTranscript.querySelectorAll('[data-detail-panel]').forEach((panel) => {
    BreviaMotion.cancel(panel);
    panel.hidden = panel.dataset.detailPanel !== target;
  });
  syncDetailSummaryPanel();
  filterDetailTranscript();
  BreviaMotion.enter(finalTranscript.querySelector(`[data-detail-panel="${target}"]`), 'tab');
  finalTranscript.querySelector(`[data-detail-tab="${target}"]`)?.focus({ preventScroll: true });
  return true;
}
function filterDetailTranscript() {
  const query = String(uiData.detail.transcriptSearch || '')
    .trim()
    .toLocaleLowerCase();
  const transcript = document.querySelector('.final-transcript');
  const body = transcript.querySelector('.transcript-body');
  let matched = 0;
  const rows = [...(body?.querySelectorAll('.segment') || [])];
  rows.forEach((row) => {
    row.hidden = false;
    const match = row.textContent.toLocaleLowerCase().includes(query);
    row.classList.toggle('is-search-match', Boolean(query && match));
    if (match) matched++;
  });
  const fulltext = body?.querySelector('.refined-fulltext');
  if (fulltext) {
    fulltext.hidden = false;
    matched = fulltext.textContent.toLocaleLowerCase().includes(query) ? 1 : 0;
  }
  const result = transcript.querySelector('[data-transcript-results]');
  if (result) result.textContent = query ? `${matched}` : '';
  const panel = document.querySelector('.detail-search-results');
  if (!panel) return;
  panel.hidden = !query || detailActiveTab !== 'transcript';
  document.querySelector('#detail-view .notes').hidden = true;
  document.querySelectorAll('#detail-view [data-transcript-search]').forEach((input) => {
    if (input.value !== uiData.detail.transcriptSearch)
      input.value = uiData.detail.transcriptSearch || '';
  });
  panel.querySelector('[data-transcript-result-count]').textContent =
    `${t('搜索结果')} · ${matched}`;
  const list = panel.querySelector('[data-transcript-result-list]');
  list.replaceChildren();
  const matches = fulltext
    ? matched
      ? [fulltext]
      : []
    : rows.filter((row) => row.classList.contains('is-search-match'));
  matches.forEach((row) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'transcript-search-result';
    const time = document.createElement('time');
    time.textContent = row.querySelector('time')?.textContent || '';
    const copy = document.createElement('span');
    copy.textContent = row.querySelector('.segment-copy')?.textContent || row.textContent;
    button.append(time, copy);
    button.onclick = () => {
      row.scrollIntoView({ block: 'center' });
      (row.querySelector('.segment-meta') || row).click();
    };
    list.append(button);
  });
}
document.querySelector('#detail-view').addEventListener('input', (event) => {
  if (!event.target.matches('[data-transcript-search]')) return;
  uiData.detail.transcriptSearch = event.target.value;
  filterDetailTranscript();
});
document.querySelector('[data-close-transcript-search]').addEventListener('click', () => {
  uiData.detail.transcriptSearch = '';
  filterDetailTranscript();
  finalTranscript.querySelector('[data-transcript-search]')?.focus();
});
finalTranscript.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[data-detail-tab]');
  if (
    !tab ||
    !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
  )
    return;
  event.preventDefault();
  const tabs = [...finalTranscript.querySelectorAll('[role="tab"]')];
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (tabs.indexOf(tab) +
            (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
            tabs.length) %
          tabs.length;
  tabs[index].click();
});
finalTranscript.addEventListener('click', (event) => {
  const version = event.target.closest('[data-transcript-version]');
  if (!version || uiData.detail.transcriptEditing) return;
  uiData.detail.transcriptVersion = version.dataset.transcriptVersion;
  renderMeetingDetail();
});
document.addEventListener('click', (event) => {
  if (event.target.closest('.refine-wrap, .refine-menu, .detail-translation-action')) return;
  document.querySelectorAll('.refine-menu').forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll('.detail-translation-menu').forEach((menu) => {
    menu.hidden = true;
  });
  document
    .querySelectorAll('[data-refine-more]')
    .forEach((button) => button.setAttribute('aria-expanded', 'false'));
  document
    .querySelectorAll('[data-detail-translation-toggle]')
    .forEach((button) => button.setAttribute('aria-expanded', 'false'));
});
/** 同步详情页笔记草稿；只有点击保存才提交，取消编辑不会改变数据库。 */
function updateDetailNotesDraft() {
  if (!detailNotesEditor) return;
  uiData.detail.notes = detailNotesEditor.getMarkdown(); // 即时同步，避免重建面板时丢失未保存内容
  if (uiData.detail.notesSaveState === 'saving') return;
  uiData.detail.notesSaveState = 'dirty';
  document.querySelector('[data-notes-save-status]').innerHTML = renderSaveState('dirty');
}
finalTranscript.addEventListener('dblclick', (event) => {
  const speaker = event.target.closest('[data-segment-speaker]');
  if (speaker) {
    event.preventDefault();
    editingSegmentSpeakerId = speaker.dataset.segmentSpeaker;
    renderMeetingDetail();
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
  scheduleLibraryMetrics();
  if (typeof initializeWorkspaces === 'function') {
    initializeWorkspaces(result.workspaces || []);
    renderWorkspaceNav();
    updateHomeViewTitle();
  }
  speakerProfiles = result.speaker_profiles || [];
  modelPaths.clear();
  result.models
    .filter((model) => model.status === 'ready' && model.path)
    .forEach((model) => modelPaths.set(model.id, model.path));
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
    const duration = parseFloat(getComputedStyle(splash).transitionDuration) * 1000;
    if (!(duration > 0)) {
      splash.remove();
      return;
    }
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    // 减少动态效果、窗口隐藏或渲染中断时可能没有 transitionend。
    setTimeout(() => splash.remove(), duration + 32);
  };
  const revealAfterSplash = () => {
    dismissStartupSplash();
    startAutomaticUpdateChecks();
  };
  window.brevia.on('startup.ready', () => {
    const reveal = () => {
      const splash = document.querySelector('#startup-splash');
      const animations = splash?.getAnimations({ subtree: true }) || [];
      // 等真实矢量时间线结束；取消动画也必须释放启动遮罩。
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(
        revealAfterSplash,
      );
    };
    reveal();
  });
  if (window.BreviaOnboarding.isFirstLaunch()) openOnboardingLanguage();
  void loadSummaryConfig().catch((error) =>
    showToast(`${t('纪要配置加载失败')}: ${error.message}`, undefined, 'error'),
  );
  void loadAiAssistConfig().catch((error) =>
    showToast(`${t('AI 笔记配置加载失败')}: ${error.message}`, undefined, 'error'),
  );
  initializationPromise = breviaClient.initialize().then((result) => {
    applyInitializationResult(result);
    whatsNewReady = true;
    maybeShowWhatsNew();
    scheduleDesktopRecording();
  });
  void initializationPromise.catch((error) =>
    showToast(`${t('配置或后端启动失败')}: ${userFacingError(error.message)}`, undefined, 'error'),
  );

  const transcript = document.querySelector('#transcript-scroll');
  const backToLatest = document.querySelector('#back-to-latest');
  const isAtLiveBottom = () =>
    transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 32;
  const scrollLiveToLatest = (segment) => {
    if (!segment) return;
    transcript.scrollTop = transcript.scrollHeight;
    followLiveTranscript = true;
    if (backToLatest) backToLatest.hidden = true;
  };
  transcript.addEventListener(
    'scroll',
    () => {
      followLiveTranscript = isAtLiveBottom();
      if (backToLatest) backToLatest.hidden = followLiveTranscript;
    },
    { passive: true },
  );
  if (backToLatest) {
    backToLatest.addEventListener('click', () => {
      followLiveTranscript = true;
      transcript.scrollTop = transcript.scrollHeight;
      backToLatest.hidden = true;
    });
  }
  transcript.addEventListener('click', (event) => {
    const button = event.target.closest('[data-live-speaker]');
    const meetingId = breviaClient.state.meeting?.id;
    if (button && meetingId)
      void openSegmentSpeakerPicker(
        meetingId,
        button.closest('.segment').dataset.segmentId,
        button,
      );
  });
  transcript.addEventListener('contextmenu', (event) => {
    const segment = event.target.closest('[data-segment-id]');
    const meetingId = breviaClient.state.meeting?.id;
    if (!segment || !meetingId) return;
    event.preventDefault();
    openSegmentContextMenu(
      meetingId,
      segment.dataset.segmentId,
      event.clientX,
      event.clientY,
      segmentInfoFor(meetingId, segment.dataset.segmentId),
    );
  });
  const renderLiveEvent = (payload, wasPreviewed = false) => {
    // 防止重复事件覆盖已经展示的字幕。
    const revision = Number(payload.revision) || 0;
    const seenRevision = liveSegmentData.get(payload.segment_id)?.revision;
    if (seenRevision !== undefined && revision <= seenRevision) return;
    const shouldFollow =
      !segmentSpeakerDraft &&
      !correctionDraft &&
      correctionPanel.hidden &&
      (followLiveTranscript || isAtLiveBottom());
    const previous = liveSegments.get(payload.segment_id);
    if (correctionDraft?.segment.id === payload.segment_id) {
      liveSegmentData.set(payload.segment_id, {
        revision,
        text: payload.text,
        start_ms: payload.start_ms,
        end_ms: payload.end_ms,
        track: payload.track,
        speaker: payload.speaker,
      });
      return;
    }
    const translation = payload.translation || previous?.querySelector('.translation')?.textContent;
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      startSeconds: payload.start_ms / 1000,
      endSeconds: payload.end_ms / 1000,
      speaker: {
        id: payload.speaker,
        segmentId: payload.segment_id,
        name: formatSpeakerName(payload.speaker_name || payload.speaker) || t('说话人'),
      },
      text: payload.text,
      translation,
      showSpeaker: Boolean(payload.speaker_name),
      live: true,
      userEdited: Boolean(payload.user_edited),
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
      const next = [...transcript.querySelectorAll('.segment')].find(
        (item) => Number(item.dataset.start) > payload.start_ms / 1000,
      );
      transcript.insertBefore(element, next || null);
      if (shouldFollow && !wasPreviewed) BreviaMotion.enter(element, 'attention');
    }
    liveSegments.set(payload.segment_id, element);
    liveSegmentData.set(payload.segment_id, {
      revision,
      text: payload.text,
      start_ms: payload.start_ms,
      end_ms: payload.end_ms,
      track: payload.track,
      speaker: payload.speaker,
      speaker_name: payload.speaker_name,
    });
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
  for (const type of [
    'meeting.started',
    'meeting.recovered',
    'meeting.imported',
    'meeting.stopped',
  ]) {
    window.brevia.on(type, ({ meeting }) => syncBackendMeeting(meeting));
  }
  window.brevia.on('meeting.started', ({ meeting }) => {
    if (meeting?.tags?.includes('手机录音') && !meeting.tags.includes('手机麦克风'))
      adoptMobileMeeting(meeting);
  });
  window.brevia.on('agent.recording', ({ meeting, target, state, inputs }) => {
    if (target !== 'computer') {
      if (state !== 'stopped') adoptMobileMeeting(meeting);
      return;
    }
    if (state === 'stopped') {
      void finishCurrentRecording(meeting).catch((error) =>
        showToast(error.message, undefined, 'error'),
      );
      return;
    }
    if (breviaClient.state.meeting?.id !== meeting.id) {
      breviaClient.adoptNativeRecording(meeting, inputs);
      activateMeeting(meeting, meeting);
    }
    const paused = state === 'paused';
    if (breviaClient.capture) breviaClient.capture.paused = paused;
    document.querySelector('#pause').dataset.paused = String(paused);
    renderPauseButton();
    if (paused) clearInterval(timer);
    else startTimer();
    publishDesktopRecording();
  });
  window.brevia.on('meeting.reconfigured', ({ meeting }) => {
    syncBackendMeeting(meeting);
    if (!meeting || meeting.id !== breviaClient?.state.meeting?.id) return;
    const targetChanged = meeting.target_language !== liveConfig.target_language;
    breviaClient.state.meeting = { ...breviaClient.state.meeting, ...meeting };
    liveConfig = {
      language: meeting.language || 'auto',
      target_language: meeting.target_language || null,
      refined_model_id: meeting.refined_model_id || null,
    };
    if (targetChanged)
      document.querySelectorAll('.translation').forEach((line) => {
        line.remove();
      });
    setLiveTranslationEnabled(Boolean(liveConfig.target_language));
    renderLiveModelControl();
  });
  window.brevia.on('meeting.stopped', ({ meeting }) => {
    return finishCurrentRecording(meeting).catch((error) =>
      showToast(error.message, undefined, 'error'),
    );
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
  window.brevia.on(
    'app.maintenance',
    ({ meetings, speaker_profiles: profiles, storage, recoverable }) => {
      uiData.meetings = meetings.map(backendMeeting);
      speakerProfiles = profiles;
      storageUsage = storage;
      const storageSizes = [storage.meetings, storage.models].map(formatBytes);
      Object.values(modalCopy).forEach((copy) =>
        copy.storage.items.forEach((item, index) => {
          item[1] = storageSizes[index];
        }),
      );
      renderSpeakerProfileCard();
      renderMeetingList();
      if (activeModal === 'storage' || storageConfirmationPage?.kind === 'storage') {
        updateStorageUsage();
        void refreshSettingsFolderRows();
      }
      if (recoverable.length) showToast(t('发现可恢复录音').replace('{count}', recoverable.length));
    },
  );
  window.brevia.on('transcript.refined', (payload) => {
    if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
    const data = liveSegmentData.get(payload.segment_id);
    const element = liveSegments.get(payload.segment_id);
    if (
      !data ||
      !element ||
      Number(payload.revision) <= data.revision ||
      element.querySelector('.speaker-name-input')
    )
      return;
    updateLiveSpeaker(payload.meeting_id, { ...payload, id: payload.segment_id });
  });
  window.brevia.on('transcript.final', (payload) => {
    if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
    renderLiveEvent(payload, draftSegments.has(payload.track || 'mix'));
    // 只有正式段落覆盖整个草稿才移除；包含后续尾句的预览等待就地更新。
    for (const [key, draft] of draftSegments) {
      // 只让同一条音轨的正式段落撤下临时行：双轨会议里 mic 的 final 不该清掉 system
      // 仍在攒的临时行，否则它会消失又在下一个 draft 事件里重新冒出来（闪烁 + 高亮错位）。
      if (String(draft.dataset.draftTrack || 'mix') !== String(payload.track || 'mix')) continue;
      if (Number(draft.dataset.end) <= payload.end_ms / 1000) {
        draft.remove();
        draftSegments.delete(key);
      }
    }
  });
  // 同一条草稿同时承接流式识别和待提交段落，更新正文而不替换整行。
  // 完整覆盖的正式段落或清空事件到达后，才移除预览并交还高亮。
  window.brevia.on('transcript.draft', (payload) => {
    if (!meetingActive || payload.meeting_id !== breviaClient?.state.meeting?.id) return;
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
    const shouldFollow =
      !segmentSpeakerDraft &&
      !correctionDraft &&
      correctionPanel.hidden &&
      (followLiveTranscript || isAtLiveBottom());
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      startSeconds: payload.start_ms / 1000,
      endSeconds: payload.end_ms / 1000,
      speaker: { id: payload.speaker, name: '' },
      text: payload.text,
      showSpeaker: false,
      live: true,
    };
    let element = existing;
    if (!element) {
      const template = document.createElement('template');
      template.innerHTML = renderTranscriptSegment(entry);
      element = template.content.firstElementChild;
      element.classList.add('is-draft');
      element.dataset.draftTrack = key;
      element.querySelector('.caption-signals')?.remove();
      draftSegments.set(key, element);
    } else {
      // 识别收尾时会密集发送草稿；保留节点、焦点和光标动画，不整行重建。
      const text = element.querySelector('.segment-copy > p');
      if (text.textContent !== payload.text) text.textContent = payload.text;
      const time = element.querySelector('time');
      if (time.textContent !== entry.time) time.textContent = entry.time;
      element.dataset.start = String(entry.startSeconds);
      element.dataset.end = String(entry.endSeconds);
    }
    if (transcript.lastElementChild !== element) transcript.appendChild(element);
    if (!element.classList.contains('is-active')) {
      transcript.querySelectorAll('.segment.is-active').forEach((segment) => {
        segment.classList.remove('is-active');
        segment.removeAttribute('aria-current');
      });
      element.classList.add('is-active');
      element.setAttribute('aria-current', 'true');
    }
    if (shouldFollow) scrollLiveToLatest(element);
  });
  window.brevia.on('transcript.settled', async (payload) => {
    if (!translationAllowed) return;
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({
        segmentId: payload.segment_id,
        translationPending: true,
      });
    }
    try {
      await translateSettledTranscriptSegment(payload, liveConfig.target_language);
    } catch (error) {
      showToast(`${t('翻译失败')}: ${error.message}`, undefined, 'error');
    }
  });
  window.brevia.on('translation.ready', (payload) => {
    if (!payload.meeting_id || payload.meeting_id !== breviaClient.state.meeting?.id) return;
    const element = liveSegments.get(payload.segment_id);
    if (!element) return;
    const shouldFollow =
      !segmentSpeakerDraft &&
      !correctionDraft &&
      correctionPanel.hidden &&
      (followLiveTranscript || isAtLiveBottom());
    let line = element.querySelector('.translation');
    if (!line) {
      line = document.createElement('p');
      line.className = 'translation';
      element.querySelector('.segment-copy').append(line);
    }
    line.textContent = payload.translation;
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({
        segmentId: payload.segment_id,
        translation: translationAllowed ? payload.translation : null,
      });
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
    await translateRefinedTranscript(meeting_id);
  });
  window.brevia.on('summary.started', ({ meeting_id, completed, total, stage }) =>
    showSummaryProgress(completed, total, stage, meeting_id),
  );
  window.brevia.on('summary.progress', ({ completed, total, stage }) =>
    showSummaryProgress(completed, total, stage),
  );
  window.brevia.on('summary.ready', () => showSummaryComplete());
  for (const event of [
    'summary.ready',
    'refinement.ready',
    'meeting.stopped',
    'meeting.imported',
    'transcript.corrected',
    'app.maintenance',
  ]) {
    window.brevia.on(event, scheduleLibraryMetrics);
  }
  window.brevia.on('model.progress', ({ model_id, received, total }) => {
    if (!modelDownloads.has(model_id)) return;
    modelDownloads.set(model_id, {
      ...modelDownloads.get(model_id),
      received,
      total,
      paused: false,
    });
    scheduleModelLibraryRender(model_id);
    refreshModelConfigModels();
    scheduleRequiredModelsCardRender();
  });
  window.brevia.on('model.status', ({ model_id, status, error }) => {
    if (status === 'ready') {
      modelDownloads.delete(model_id);
      requiredModelIds.delete(model_id);
      if (onboardingModelIds.includes(model_id) && window.BreviaOnboarding.modelReady(model_id))
        showOfflineTranscriptionReady();
      window.brevia.models
        .list()
        .then((models) => {
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
        })
        .catch(() => {});
    } else if (status === 'paused' && modelDownloads.has(model_id))
      modelDownloads.set(model_id, { ...modelDownloads.get(model_id), paused: true });
    else if (status === 'downloading' && modelDownloads.has(model_id))
      modelDownloads.set(model_id, { ...modelDownloads.get(model_id), paused: false });
    else if (status === 'cancelled' && modelDownloads.has(model_id)) {
      if (requiredModelIds.has(model_id)) modelDownloads.set(model_id, { cancelled: true });
      else modelDownloads.delete(model_id);
    } else if (status === 'failed' && modelDownloads.has(model_id))
      modelDownloads.set(model_id, { error });
    else if (status === 'not_installed') modelPaths.delete(model_id);
    if (status === 'paused' || status === 'downloading') refreshModelCardProgress(model_id);
    else if (activeModal === 'models') renderModal('models');
    refreshModelConfigModels();
    renderRequiredModelsCard();
  });
  window.brevia.on('worker.warning', ({ code, message: warning, meeting_id: warningMeetingId }) => {
    // 实时识别不可用是「整场没有字幕」，不是可忽略的瞬时警告：改成常驻卡片。
    if (code === 'asr_unavailable') {
      showLiveCaptionUnavailable(warningMeetingId, warning);
      return;
    }
    showToast(code?.startsWith('error.') ? t(code) : warning);
  });
  window.brevia.on('worker.error', ({ code, message: error }) =>
    showToast(code ? `${t(code)} (${error})` : userFacingError(error), undefined, 'error'),
  );
  window.brevia.on('update.download-progress', (progress) => {
    updateDownloadProgress = progress;
    renderUpdateButton();
    renderUpdateNotice();
  });
  window.brevia.on('task.status', ({ task, meeting_id, status }) => {
    const card = [...taskCards.querySelectorAll('.processing-card')].find(
      (item) => item.dataset.task === task && item.dataset.meetingId === meeting_id,
    );
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
    queueModelTask(
      task,
      task === 'meeting.start' && queued?.payload.inputs
        ? { ...payload, inputs: queued.payload.inputs }
        : payload,
      models,
    );
    downloadRequiredModels(models);
  });
  window.brevia.on('speaker-profile.updated', async () => {
    speakerProfiles = await window.brevia.speakerProfile.list();
    renderSpeakerProfileCard();
  });
  window.brevia.on('speaker-profile.deleted', async () => {
    speakerProfiles = await window.brevia.speakerProfile.list();
    renderSpeakerProfileCard();
  });

  // Listen for floating caption window closed event to sync state
  window.brevia.on('floating-caption.closed', () => {
    floatingCaptionMode = null;
    document
      .querySelectorAll('#floating-caption-toggle, #playback-floating-caption-toggle')
      .forEach((toggle) => {
        toggle.dataset.enabled = 'false';
      });
    renderFloatingCaptionToggle();
  });

  document.querySelector('#recently-deleted').addEventListener('click', async () => {
    await showLibraryNav('recently-deleted').catch((error) =>
      showToast(error.message, undefined, 'error'),
    );
  });
  document.querySelector('#all-meetings').addEventListener('click', async () => {
    await showLibraryNav('all-meetings').catch((error) =>
      showToast(error.message, undefined, 'error'),
    );
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-summary-export]')) {
      document.querySelector('[data-export-detail]').click();
      return;
    }
    if (event.target.closest('[data-copy-summary]')) {
      const markdown = currentMeetingDetail?.summary?.data?.markdown;
      if (markdown)
        void window.brevia?.share
          .copyText({ text: markdown })
          .then(() => showToast(t('已复制到剪贴板'), undefined, 'success'))
          .catch((error) => showToast(error.message, undefined, 'error'));
      return;
    }
    if (event.target.closest('[data-open-summary-edit]')) {
      uiData.detail.summaryEditBase = currentMeetingDetail?.summary?.data?.markdown || '';
      uiData.detail.summaryEditing = true;
      uiData.detail.summarySaveState = 'saved';
      renderMeetingDetail();
      return;
    }
    if (event.target.closest('[data-cancel-inline-summary-edit]')) {
      uiData.detail.summaryDraft = undefined;
      uiData.detail.summaryEditing = false;
      uiData.detail.summarySaveState = 'saved';
      renderMeetingDetail();
      return;
    }
    if (event.target.closest('[data-save-inline-summary]')) {
      if (uiData.detail.summarySaveState === 'saving') return;
      const markdown = (inlineSummaryEditor?.getMarkdown() || '').trim();
      const meetingId = currentMeetingDetail?.id;
      if (!meetingId || !window.brevia?.summary?.save) return;
      if (!markdown) {
        showToast(t('纪要不能为空'));
        return;
      }
      uiData.detail.summarySaveState = 'saving';
      document.querySelector('[data-summary-save-status] .save-state').outerHTML =
        renderSaveState('saving');
      document
        .querySelectorAll('[data-cancel-inline-summary-edit], [data-save-inline-summary]')
        .forEach((button) => (button.disabled = true));
      void window.brevia.summary
        .save({ meeting_id: meetingId, markdown, expected_markdown: uiData.detail.summaryEditBase })
        .then((saved) => {
          scheduleLibraryMetrics();
          if (currentMeetingDetail?.id !== meetingId) return;
          const data = saved?.markdown
            ? saved
            : { ...currentMeetingDetail.summary?.data, markdown };
          currentMeetingDetail.summary = { data };
          uiData.detail.summaryEditBase = data.markdown;
          uiData.detail.summary = {
            ...data,
            hasFull: true,
            blocked: meetingActive,
            generating: false,
          };
          uiData.detail.summarySaveState =
            (inlineSummaryEditor?.getMarkdown() || '').trim() === markdown ? 'saved' : 'dirty';
          if (
            !uiData.detail.summaryEditing ||
            (inlineSummaryEditor?.getMarkdown() || '').trim() === markdown
          ) {
            uiData.detail.summaryDraft = undefined;
            uiData.detail.summaryEditing = false;
          }
          renderMeetingDetail();
          showToast(t('已保存'), undefined, 'success');
        })
        .catch((error) => {
          if (currentMeetingDetail?.id === meetingId && uiData.detail.summaryEditing) {
            uiData.detail.summarySaveState = 'failed';
            finalTranscript.querySelector('.detail-content-header').outerHTML =
              renderDetailTabbar();
          }
          showToast(error.message, undefined, 'error');
        });
      return;
    }
    if (event.target.closest('[data-generate-summary], [data-regenerate-summary]'))
      void generateMeetingSummary(currentMeetingDetail?.id);
  });

  document.querySelector('[data-export-detail]').addEventListener('click', () => {
    if (!breviaClient.state.selectedMeetingId) return;
    if (settingsModal.matches(':popover-open')) closeModal();
    else void openModal('export');
  });
}

/* 视图模块通过 appActions 回调应用层，实现必须在这里登记。
   放在文件末尾：上面的 function 声明已提升，而 const 箭头函数（showToast / showView /
   updatePlayerControl / renderPlayerTime）到这里都已初始化。 */
registerAppActions('app.js', {
  noteHighlightTime: () => Math.floor(playerAudio.currentTime * 1000),
  updateDetailNotesDraft,
  showToast,
  summaryWaitState: (meetingId) => pendingModelTasks.has(`summary.generate:${meetingId}`),
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

settingsModal.addEventListener('keydown', (event) => {
  if (activeModal !== 'upgrade-log' || event.key !== 'Tab') return;
  const controls = [
    ...settingsModal.querySelectorAll('button:not(:disabled), a[href], summary'),
  ].filter(
    (element) =>
      element.getClientRects().length &&
      !element.closest('details:not([open]) section, details:not([open]) footer'),
  );
  const index = controls.indexOf(document.activeElement);
  if (
    index < 0 ||
    (!event.shiftKey && index === controls.length - 1) ||
    (event.shiftKey && index === 0)
  ) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  }
});
if (!window.brevia) {
  whatsNewReady = true;
  maybeShowWhatsNew();
}

// 桌面入口共享实时页的操作与草稿；辅助窗口不直接调用录音 Worker。

async function startQuickRecording({ background = false } = {}) {
  if (meetingActive) {
    miniMeeting.hidden = true;
    showView('live');
    return;
  }
  if (quickRecordingBusy) return;
  quickRecordingBusy = true;
  const buttons = [...document.querySelectorAll('[data-quick-recording]')];
  buttons.forEach((button) => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.insertAdjacentHTML(
      'afterbegin',
      '<i class="button-spinner" data-quick-spinner aria-hidden="true"></i>',
    );
  });
  try {
    const meetings = window.brevia
      ? await window.brevia.meeting.list({ include_deleted: false })
      : [];
    const saved = meetings.find((meeting) => !meeting.is_example);
    const language = saved?.language || 'auto';
    const captureMode = desktopPreferences?.lastCaptureMode || 'both';
    const payload = {
      title: BreviaI18n.defaultMeetingTitle(locale),
      language,
      num_speakers: saved?.num_speakers ?? -1,
      target_language: saved?.target_language || null,
      refined_model_id: saved?.refined_model_id || defaultRefinedModelId(language),
      speaker_segmentation_model_id:
        saved?.speaker_segmentation_model_id || preferredModelsForLanguage(language).segmentation,
      vad_model_id: saved?.vad_model_id || 'silero-vad',
      workspace_id: saved ? saved.workspace_id || null : activeWorkspaceId || null,
      summary_template: saved?.summary_template || 'general',
    };
    const translationModel = modelCatalog.find((model) => model.stages?.includes('translation'));
    const required = [
      payload.refined_model_id,
      payload.vad_model_id,
      ...(payload.target_language ? [translationModel?.id] : []),
    ];
    if (
      (!window.brevia?.nativeAudio || captureMode === 'phone') &&
      !required.every((id) => id && modelPaths.has(id))
    ) {
      setPrepareMode('record');
      document.querySelector('#meeting-title').value = payload.title;
      for (const [key, value] of Object.entries({
        'meeting-language': language,
        'meeting-speakers': payload.num_speakers,
        'meeting-workspace': payload.workspace_id || '',
        'translation-target': payload.target_language || '',
        'summary-template': payload.summary_template,
      }))
        prepareForm.querySelector(`[name="${key}"]`).value = String(value);
      prepareForm.dataset.segmentationModel = payload.speaker_segmentation_model_id;
      prepareForm.dataset.vadModel = payload.vad_model_id;
      renderPrepareSelects(payload.refined_model_id);
      renderCaptureMode(captureMode);
      if (background) await window.brevia.desktop.show();
      await showView('prepare');
      const error = prepareForm.querySelector('[data-prepare-error]');
      error.textContent = t('请确认录音配置并下载所需模型后开始');
      error.hidden = false;
      return;
    }
    await startConfiguredRecording(payload, captureMode);
  } finally {
    quickRecordingBusy = false;
    buttons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.querySelector('[data-quick-spinner]')?.remove();
    });
  }
}
function confirmQuitRecording() {
  const dialog = document.querySelector('#quit-recording-dialog');
  const title = breviaClient?.state.meeting?.title || desktopSavedMeeting?.title || 'Brevia';
  dialog.querySelector('#quit-recording-title').textContent = t('结束录音并退出 Brevia？');
  dialog.querySelector('#quit-recording-description').textContent =
    `${t(meetingPaused() ? '当前已暂停“{title}”。' : '正在录制“{title}”。').replace('{title}', title)}\n${t('退出前会结束并保存当前录音。')}`;
  dialog.querySelector('[data-quit-background]').hidden =
    desktopPreferences?.closeBehavior !== 'hide';
  dialog.querySelector('[value="cancel"]').textContent = t(
    meetingPaused() ? '返回当前会议' : '继续录音',
  );
  dialog.querySelector('[value="confirm"]').innerHTML =
    `${interfaceIcon('stop')}<span>${escapeHtml(t('结束并退出'))}</span>`;
  dialog.onkeydown = (event) => {
    if (['Escape', 'Tab'].includes(event.key)) event.stopPropagation();
  };
  dialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
      once: true,
    });
    dialog.showModal();
  });
}
function desktopRecordingSnapshot() {
  const playback =
    !meetingActive &&
    playbackStarted &&
    playerAudio.src &&
    !playerAudio.ended &&
    currentMeetingDetail;
  if (playback) {
    const transcript = uiData.detail.transcript;
    const activeIndex = transcript.findIndex(
      (item) =>
        playerAudio.currentTime >= item.startSeconds && playerAudio.currentTime < item.endSeconds,
    );
    const captionId = (item) => String(item.speaker?.segmentId ?? item.startSeconds);
    return {
      ready: Boolean(breviaClient?.state.initialized && desktopPreferences),
      meetingId: playback.id,
      title: playback.title,
      phase: playerAudio.paused ? 'playback-paused' : 'playing',
      elapsed: Math.max(0, Math.floor(playerAudio.currentTime)),
      level: 0,
      input: t('播放录音'),
      canPause: true,
      locale,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      activeCaptionId: activeIndex >= 0 ? captionId(transcript[activeIndex]) : null,
      captions: transcript.map((item) => ({
        id: captionId(item),
        time: item.time || '',
        text: (item.text || '').slice(0, 20000),
        translation: (item.translation || '').slice(0, 20000),
        draft: false,
      })),
      notes: (uiData.detail.notes || '').slice(0, 200000),
      suggestion: null,
      aiEnabled: false,
      aiBusy: false,
      error: '',
    };
  }
  const meeting = meetingActive ? breviaClient?.state.meeting : null;
  const stopping = document.querySelector('#end-meeting').getAttribute('aria-busy') === 'true';
  const phase = meetingActive
    ? stopping
      ? 'saving'
      : desktopSaveError
        ? 'failed'
        : meetingPaused()
          ? 'paused'
          : 'recording'
    : desktopSavedMeeting
      ? 'saved'
      : 'idle';
  const captionNodes = [...document.querySelectorAll('#transcript-scroll .segment')].slice(-80);
  return {
    ready: Boolean(breviaClient?.state.initialized && desktopPreferences),
    meetingId: meeting?.id || desktopSavedMeeting?.id || null,
    title: meeting?.title || desktopSavedMeeting?.title || '',
    phase,
    elapsed: Math.max(0, seconds),
    level: phase === 'recording' && Date.now() - desktopLevelAt < 1000 ? desktopLevel : 0,
    input: liveInputLabel(),
    canPause: !document.querySelector('#pause').disabled,
    locale,
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    captions: captionNodes.map((node, index) => ({
      id: node.dataset.segmentId || node.dataset.draftTrack || String(index),
      time: node.querySelector('time')?.textContent || '',
      text: (node.querySelector('.segment-copy > p')?.textContent || '').slice(0, 20000),
      translation: translationAllowed
        ? (node.querySelector('.translation')?.textContent || '').slice(0, 20000)
        : '',
      draft: node.classList.contains('is-draft'),
    })),
    notes: currentNotesMarkdown().slice(0, 200000),
    suggestion: latestAiSuggestion
      ? { id: String(latestAiSuggestion.id), text: latestAiSuggestion.text.slice(0, 20000) }
      : null,
    aiEnabled: aiAssistEnabled(),
    aiBusy: Boolean(aiAssistToggleButton()?.classList.contains('is-analyzing')),
    error: desktopSaveError,
    captionNotice:
      document.querySelector('#live-transcription-unavailable')?.dataset.meetingId === meeting?.id
        ? (
            document.querySelector(
              '#live-transcription-unavailable .live-transcription-unavailable-body',
            )?.textContent || ''
          ).slice(0, 2000)
        : '',
  };
}
let desktopPublishedCaptions = null;
function publishDesktopRecording() {
  clearTimeout(desktopPublishTimer);
  desktopPublishTimer = null;
  const state = desktopRecordingSnapshot();
  if (!window.brevia?.desktop) return;
  const captionsKey = JSON.stringify([
    state.meetingId,
    state.phase,
    state.locale,
    state.captionNotice,
    state.captions,
  ]);
  if (captionsKey === desktopPublishedCaptions) delete state.captions;
  void window.brevia.desktop
    .publish(state)
    .then(() => {
      desktopPublishedCaptions = captionsKey;
    })
    .catch((error) => {
      desktopPublishedCaptions = null;
      console.error('Desktop state update failed', error);
    });
}
function scheduleDesktopRecording() {
  if (!desktopPublishTimer)
    desktopPublishTimer = setTimeout(() => {
      desktopPublishTimer = null;
      publishDesktopRecording();
    }, 120);
}
const desktopStateObserver = new MutationObserver(scheduleDesktopRecording);
['#live-view', '[data-ai-suggestion]'].forEach((selector) => {
  const node = document.querySelector(selector);
  if (node)
    desktopStateObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'data-paused', 'aria-busy', 'class'],
    });
});
desktopStateObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme', 'lang'],
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-quick-recording]'))
    void startQuickRecording().catch((error) => showToast(error.message, undefined, 'error'));
  scheduleDesktopRecording();
});
async function saveDesktopPreference(key, value) {
  if (!desktopPreferences || desktopSettingsBusy) return;
  desktopSettingsBusy = true;
  const status = document.querySelector('[data-desktop-settings-status]');
  if (status) {
    status.hidden = false;
    status.textContent = t('正在保存…');
  }
  const focusedToggle = document.activeElement?.dataset.desktopToggle === key;
  const controls = document.querySelectorAll('[data-desktop-settings] button:enabled');
  controls.forEach((button) => {
    button.disabled = true;
  });
  try {
    desktopPreferences = await window.brevia.desktop.savePreferences({
      [key]: value,
    });
    renderDesktopPreferences();
  } catch (error) {
    if (status) status.textContent = `${t('保存失败')} · ${error.detail || error.message}`;
    showToast(error.detail || error.message, undefined, 'error');
  } finally {
    desktopSettingsBusy = false;
    controls.forEach((button) => {
      button.disabled = false;
    });
    if (focusedToggle && document.activeElement === document.body) {
      const toggle = document.querySelector(`[data-desktop-toggle="${CSS.escape(key)}"]`);
      if (toggle?.checkVisibility()) toggle.focus({ preventScroll: true });
    }
  }
}
document.addEventListener('click', (event) => {
  const choice = event.target.closest('[data-flow-select-choice]');
  if (choice?.dataset.flowSelectChoice.startsWith('desktop-'))
    void saveDesktopPreference(choice.dataset.flowSelectChoice.slice(8), choice.dataset.value);
  const toggle = event.target.closest('[data-desktop-toggle]');
  if (toggle)
    void saveDesktopPreference(
      toggle.dataset.desktopToggle,
      !desktopPreferences[toggle.dataset.desktopToggle],
    );
});
async function controlAgentRecording(recording) {
  const { action, meeting_id: meetingId } = recording;
  if (action === 'start') {
    const tracks = recording.audio_tracks || ['mic'];
    const meeting = await breviaClient.start(
      { ...recording, agent_control: true },
      { mic: tracks.includes('mic'), system: tracks.includes('system') },
      recording.device_id,
    );
    if (meeting?.model_required) return meeting;
    activateMeeting(meeting, recording);
    return { meeting_id: meeting.id, state: 'recording', confirmed: true };
  }
  const activeId = breviaClient.state.meeting?.id;
  if (!meetingActive || !activeId || (meetingId && meetingId !== activeId))
    throw new Error(t('操作未完成，请在主窗口查看'));
  if (action === 'stop') {
    if (!(await stopCurrentRecording({ currentTarget: document.querySelector('#end-meeting') })))
      throw new Error(desktopSaveError || t('录音仍在保存，请稍后重试退出'));
    return { meeting_id: activeId, state: 'stopped', confirmed: true };
  }
  const paused = action === 'pause',
    wasPaused = meetingPaused();
  if (paused !== wasPaused) {
    await breviaClient.pause(paused);
    document.querySelector('#pause').dataset.paused = String(paused);
    renderPauseButton();
    if (paused) clearInterval(timer);
    else startTimer();
  }
  return { meeting_id: activeId, state: paused ? 'paused' : 'recording', confirmed: true };
}
if (window.brevia?.desktop) {
  void window.brevia.desktop
    .preferences()
    .then((preferences) => {
      desktopPreferences = preferences;
      renderDesktopPreferences();
      scheduleDesktopRecording();
    })
    .catch((error) => showToast(error.message, undefined, 'error'));
  window.brevia.on(
    'desktop.action',
    async ({ action, requestId, suggestionId, tab, meetingId, background, recording }) => {
      let error, result;
      try {
        if (['playback-pause', 'playback-stop'].includes(action)) {
          if (meetingActive || !playbackStarted || currentMeetingDetail?.id !== meetingId)
            throw new Error(t('操作未完成，请在主窗口查看'));
          if (action === 'playback-stop') miniPlaybackClose.click();
          else {
            clearSegmentPlayback();
            if (playerAudio.paused) await playerAudio.play();
            else playerAudio.pause();
          }
        }
        if (action === 'agent-recording') result = await controlAgentRecording(recording);
        if (action === 'agent-devices') result = await breviaClient.listMicrophones();
        if (
          ['pause', 'stop', 'mark', 'accept', 'ignore'].includes(action) &&
          (!meetingActive || meetingId !== breviaClient?.state.meeting?.id)
        )
          throw new Error(t('操作未完成，请在主窗口查看'));
        if (
          action === 'pause' &&
          !(await pauseCurrentRecording({ currentTarget: document.querySelector('#pause') }))
        )
          throw new Error(t('操作未完成，请在主窗口查看'));
        if (
          action === 'stop' &&
          !(await stopCurrentRecording({ currentTarget: document.querySelector('#end-meeting') }))
        )
          throw new Error(desktopSaveError || t('录音仍在保存，请稍后重试退出'));
        if (action === 'mark') {
          if (meetingPaused()) throw new Error(t('已暂停'));
          document.querySelector('#mark-important').click();
        }
        if (['accept', 'ignore'].includes(action)) {
          if (!latestAiSuggestion || latestAiSuggestion.id !== suggestionId)
            throw new Error(t('建议已更新，请重试'));
          if (action === 'accept') {
            if (!(await acceptAiSuggestion(latestAiSuggestion.text)))
              throw new Error(t('操作未完成，请在主窗口查看'));
          } else document.querySelector('[data-ai-ignore]')?.click();
        }
        if (action === 'confirm-quit') result = await confirmQuitRecording();
        if (action === 'quick') await startQuickRecording({ background });
        if (action === 'prepare') {
          setPrepareMode('record');
          showView('prepare');
        }
        if (action === 'settings') {
          showView('settings');
        }
        if (action === 'ai-settings') openModal('ai-features');
        if (action === 'models') openModal('models');
        if (action === 'return') {
          if (meetingActive) {
            miniMeeting.hidden = true;
            showView('live');
            if (tab === 'notes') liveNotesRoot.scrollIntoView({ block: 'nearest' });
          } else if (playbackStarted && currentMeetingDetail?.id === meetingId) {
            showView('detail');
          } else if (desktopSavedMeeting) {
            applyBackendDetail(desktopSavedMeeting);
            showView('detail');
          }
        }
        if (action === 'flush') {
          clearTimeout(liveNotesSaveTimer.current);
          if (meetingActive)
            await persistNotes(breviaClient?.state.meeting?.id, currentNotesMarkdown());
          await notesSavePending;
          if (uiData.detail.notesEditing || uiData.detail.summaryEditing || correctionDraft)
            throw new Error(t('请先保存或取消当前编辑后退出'));
        }
      } catch (failure) {
        error = String(failure.detail || failure.message).slice(0, 2000);
      } finally {
        publishDesktopRecording();
        await window.brevia.desktop.complete({
          requestId,
          ...(error ? { error } : {}),
          ...(result !== undefined ? { result } : {}),
        });
      }
    },
  );
}
scheduleDesktopRecording();

let desktopShortcutCapture = null;
async function finishDesktopShortcutCapture(value, restoreFocus = false) {
  const capture = desktopShortcutCapture;
  if (!capture) return;
  if (capture.finishing) return capture.finishing;
  clearTimeout(capture.timer);
  capture.finishing = complete();
  return capture.finishing;

  async function complete() {
    try {
      await window.brevia.desktop.editShortcuts({ editing: false });
      if (value !== undefined) await saveDesktopPreference(capture.key, value);
    } catch (error) {
      showToast(error.detail || error.message, undefined, 'error');
    } finally {
      desktopShortcutCapture = null;
      const button = document.querySelector(`[data-shortcut-control="${capture.key}"]`);
      if (button) {
        const row = button.closest('.preference-row');
        button.innerHTML = desktopShortcutValue(desktopPreferences[capture.key]);
        button.setAttribute(
          'aria-label',
          `${row.querySelector('h3').textContent} · ${desktopShortcutLabel(desktopPreferences[capture.key])}`,
        );
        button.setAttribute('aria-pressed', 'false');
        button.title = t('录制快捷键');
        if ((restoreFocus || value !== undefined) && activeView === 'settings' && !activeModal)
          button.focus();
      }
    }
  }
}
document.addEventListener('click', async (event) => {
  const action = event.target.closest(
    '[data-shortcut-control], [data-shortcut-clear], [data-shortcut-reset]',
  );
  if (!action || action.disabled || desktopSettingsBusy) return;
  if (desktopShortcutCapture) {
    const same = desktopShortcutCapture.button === action;
    await finishDesktopShortcutCapture();
    if (same || desktopShortcutCapture || !action.isConnected) return;
  }
  const button = action.closest('.desktop-shortcut').querySelector('[data-shortcut-control]');
  const key = button.dataset.shortcutControl;
  if (action !== button) {
    await saveDesktopPreference(
      key,
      action.hasAttribute('data-shortcut-reset') ? desktopShortcutDefault(key) : '',
    );
    document.querySelector(`[data-shortcut-control="${key}"]`)?.focus();
    return;
  }
  const capture = { key, button };
  desktopShortcutCapture = capture;
  button.focus();
  button.setAttribute('aria-pressed', 'true');
  button.textContent = t('请按组合键');
  button.setAttribute('aria-label', t('请按组合键，Esc 取消，退格清除'));
  button.title = t('无需切换窗口；组合键需包含 Ctrl、Alt 或 Command。Esc 取消，退格清除。');
  try {
    await window.brevia.desktop.editShortcuts({ editing: true });
    if (desktopShortcutCapture !== capture || capture.finishing) return;
    button.focus();
    capture.timer = setTimeout(() => void finishDesktopShortcutCapture(), 60000);
  } catch (error) {
    await finishDesktopShortcutCapture();
    showToast(error.detail || error.message, undefined, 'error');
  }
});
document.addEventListener(
  'keydown',
  (event) => {
    if (!desktopShortcutCapture) return;
    if (event.key === 'Tab') {
      void finishDesktopShortcutCapture();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (desktopShortcutCapture.finishing || event.repeat || event.isComposing) return;
    if (event.key === 'Escape') void finishDesktopShortcutCapture(undefined, true);
    else if (['Backspace', 'Delete'].includes(event.key)) void finishDesktopShortcutCapture('');
    else {
      const value = desktopShortcutFromEvent(event);
      if (value) void finishDesktopShortcutCapture(value);
    }
  },
  true,
);
document.addEventListener('focusout', (event) => {
  if (event.target === desktopShortcutCapture?.button) void finishDesktopShortcutCapture();
});
window.addEventListener('blur', () => void finishDesktopShortcutCapture());
