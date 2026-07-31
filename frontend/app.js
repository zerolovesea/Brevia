const views = [...document.querySelectorAll('.view')];
const crumb = document.querySelector('#crumb');
const toast = document.querySelector('#toast');
const languageToggle = document.querySelector('#language-toggle');
const languageOptions = document.querySelector('#language-options');
const themeToggle = document.querySelector('#theme-toggle');
const miniMeeting = document.querySelector('#mini-meeting');
const miniTitle = document.querySelector('#mini-title');
const miniTimer = document.querySelector('#mini-timer');
const refinementCard = document.querySelector('#refinement-progress');
const refinementPercent = document.querySelector('#refinement-percent');
const refinementBar = document.querySelector('#refinement-bar');
const taskCards = document.querySelector('#task-cards');
function enterTaskCard(card) {
  card.classList.remove('task-card-leave');
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
  if (wasHidden || wasLeaving) enterTaskCard(card);
}
const { catalog, appCopy: { stageLabels, themeLabels, updateLabels, modalCopy, modelLabels, summaryModelCopy, speakerProfileCopy, voiceFeaturesCopy } } = window.BreviaLocaleData;
let locale = localStorage.getItem('brevia-language') || 'zh';
let theme = localStorage.getItem('brevia-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let activeView = 'home';
let activeLibraryNav = 'all-meetings';
const liveSpeakers = new Map();
const liveSegments = new Map();
let followLiveTranscript = true;
let toastTimer;
let switchingLanguage = false;
let meetingActive = false;
let translationAllowed = false;
let latestLiveSegmentId = null;
const translatedNodes = [];
/** Resolves a display label for the active locale. @param {string} key Chinese source label. @returns {string} Localized label or the original key. */
const t = (key) => stageLabels[key]?.[locale] || stageLabels[key]?.en || catalog[locale].labels[key] || key;
/** Resolves a transient message for the active locale. @param {string} key Message identifier. @returns {string} Localized message. */
const message = (key) => catalog[locale].messages[key];
function formatBytes(bytes = 0) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
function formatMeetingTime(milliseconds = 0) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
const defaultCategories = ['产品', '设计', '外部会议'];
let categories = JSON.parse(localStorage.getItem('brevia-categories') || 'null') || defaultCategories;
renderStaticViews();
const speakerProfileCard = document.createElement('section');
speakerProfileCard.className = 'settings-card';
speakerProfileCard.innerHTML = '<h2></h2><p></p><button class="secondary" type="button"></button>';
document.querySelector('#settings-view .settings-grid').append(speakerProfileCard);
const updateCard = document.createElement('section');
updateCard.className = 'update-card';
updateCard.innerHTML = '<div><h2></h2><p></p></div><button class="update-button" type="button"></button>';
document.querySelector('#settings-view .settings-grid').append(updateCard);
const updateTitle = updateCard.querySelector('h2');
const updateDescription = updateCard.querySelector('p');
const updateButton = updateCard.querySelector('button');
const updateNotice = document.createElement('aside');
updateNotice.className = 'software-update-notice';
updateNotice.hidden = true;
updateNotice.innerHTML = '<span></span><button type="button"></button>';
document.body.append(updateNotice);
const updateNoticeText = updateNotice.querySelector('span');
const updateNoticeButton = updateNotice.querySelector('button');
let updateAvailable = false;
let speakerProfiles = [];
let presetVoices = [];
let currentMeetingDetail = null;
let expandedSpeakerProfileId = null;
let addingSampleProfileId = null;
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
/** Keeps the update notice above the mini meeting when both are visible. @returns {void} */
function syncFloatingNotices() { updateNotice.style.bottom = miniMeeting.hidden ? '' : `${miniMeeting.offsetHeight + 24}px`; }
/** Renders the floating update notice from current locale and availability state. @returns {void} */
function updateCopy() { return updateLabels[locale] || { ...updateLabels.en, title: t('软件更新'), description: t('当前版本 0.1.0'), action: t('检查更新') }; }
function renderUpdateNotice() { const copy = updateCopy(); updateNoticeText.textContent = copy.available; updateNoticeButton.textContent = copy.floating; updateNotice.hidden = !updateAvailable; requestAnimationFrame(syncFloatingNotices); }
/** Renders the settings-page update action from current locale and availability state. @returns {void} */
function renderUpdateButton() { const copy = updateCopy(); updateTitle.textContent = copy.title; updateDescription.textContent = updateAvailable ? copy.available : copy.description; updateButton.textContent = updateAvailable ? copy.update : copy.action; updateButton.disabled = false; }
const modelIds = [
  'paraformer-zh-en-int8',
  'zipformer-en-streaming-int8',
  'zipformer-zh-streaming-int8',
  'zipformer-zh-en-streaming-int8',
  'zipformer-multilingual-streaming',
  'zipformer-ko-streaming-int8',
  'zipformer-fr-streaming-int8',
  'silero-vad',
  'ten-vad',
  'online-punct-en-int8',
  'punct-ct-transformer-zh-en-int8',
  'qwen3-asr-0.6b-int8',
  'sensevoice-int8',
  'whisper-turbo',
  'qwen3-asr-1.7b-int8',
  'pyannote-segmentation-3.0',
  'reverb-diarization-v1',
  'eres2net-base-3dspeaker-zh',
  'nemo-titanet-small-en',
  'campplus-zh-en',
  'zipformer-zh-xlarge-streaming-int8',
  'gtcrn-live-denoiser',
  'spleeter-2stems-fp16',
  'zipvoice-zh-en',
];
const modelSizes = [1047319737, 310414022, 132634597, 511274346, 258999581, 418218652, 398444115, 30667839, 2313101, 332211, 64717756, 878702423, 163002883, 563790207, 2900000000, 6958444, 10918585, 39593761, 40257283, 28281164, 597755927, 535638, 35271738, 163320194];
const summaryProviders = ['OpenAI', 'Anthropic', 'Kimi', 'Zhipu GLM', 'MiniMax', 'DeepSeek', 'OpenRouter', 'Ollama'];
const defaultSummaryModels = [{ name: '配置-1', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', format: 'openai', model: 'gpt-4.1-mini' }];
let savedSummaryConfig = null;
try { savedSummaryConfig = JSON.parse(localStorage.getItem('brevia-summary-config') || 'null'); } catch { /* Ignore malformed legacy browser storage. */ }
let summaryModels = savedSummaryConfig?.models?.length ? savedSummaryConfig.models : defaultSummaryModels;
const legacySummaryKeys = summaryModels.filter((item) => item.apiKey).map((item) => ({ reference: item.keyReference || `summary-${crypto.randomUUID()}`, value: item.apiKey, item }));
legacySummaryKeys.forEach(({ reference, item }) => { item.keyReference = reference; delete item.apiKey; });
let activeSummaryModel = savedSummaryConfig?.active ?? 0;
let editingSummaryModel = 0;
let configSequence = savedSummaryConfig?.sequence || summaryModels.length;
summaryModels.forEach((item, index) => { if (!item.name) item.name = `配置-${index + 1}`; });
let draftSummaryName = '';
let summaryPrompt = savedSummaryConfig?.prompt || '基于逐字稿提炼结论、决定、待办和风险；保留可追溯的来源。';
/** Allocates the next local summary-model configuration name. @returns {string} New configuration name. */
function nextConfigName() { configSequence += 1; return `配置-${configSequence}`; }
/** Returns the non-secret summary configuration persisted in the app data directory. */
function currentSummaryConfig() {
  const models = summaryModels.map(({ apiKey, ...model }) => model);
  return { models, active: activeSummaryModel, prompt: summaryPrompt, sequence: configSequence };
}
/** Saves summary-model settings outside browser storage; keys remain in Electron safe storage. */
async function persistSummaryConfig() {
  await window.brevia?.summary.config.save(currentSummaryConfig());
}
function applySummaryConfig(config) {
  summaryModels = config.models;
  activeSummaryModel = config.active;
  editingSummaryModel = activeSummaryModel;
  configSequence = config.sequence;
  summaryPrompt = config.prompt;
  summaryModels.forEach((item, index) => { if (!item.name) item.name = `配置-${index + 1}`; });
}
async function loadSummaryConfig() {
  const stored = await window.brevia?.summary.config.get();
  if (stored) applySummaryConfig(stored);
  else {
    await Promise.all(legacySummaryKeys.map(({ reference, value }) => window.brevia?.secret.set({ reference, value })));
    await persistSummaryConfig();
  }
  localStorage.removeItem('brevia-summary-config');
}
const settingsModal = document.createElement('div');
settingsModal.className = 'modal-backdrop';
settingsModal.hidden = true;
settingsModal.innerHTML = '<section class="modal-panel" role="dialog" aria-modal="true"><header class="modal-head"><div class="modal-title"><h2></h2><p></p></div><button class="modal-close" type="button" aria-label="Close">×</button></header><div class="modal-body"></div></section>';
document.body.append(settingsModal);
let activeModal;
const modelDownloads = new Map();
let termEntries = modalCopy.zh.terms.items.map(([name, detail]) => ({ name, detail }));
let editingTermIndex = null;
let activeCategory = '';
let activeDateRange = '30';
const persistCategories = () => localStorage.setItem('brevia-categories', JSON.stringify(categories));
const categoryFilter = document.querySelector('#category-filter');
const dateFilter = document.querySelector('#date-filter');
const libraryToolbar = document.querySelector('.library-toolbar');
const meetingSearch = document.querySelector('#meeting-search');
const selectedMeetingKeys = new Set();
const batchToolbar = document.createElement('section');
batchToolbar.className = 'batch-toolbar';
batchToolbar.hidden = true;
batchToolbar.setAttribute('aria-live', 'polite');
batchToolbar.innerHTML = '<strong data-batch-count></strong><div class="batch-actions"><button type="button" data-batch-restore></button><div class="batch-category" data-batch-category></div><button type="button" data-batch-export></button><button class="batch-delete" type="button" data-batch-delete></button><button type="button" data-batch-clear></button></div>';
libraryToolbar.after(batchToolbar);
/** Synchronizes selected-row styling and the contextual batch toolbar. @param {boolean} updateToolbar Whether to redraw batch actions. @returns {void} */
function syncMeetingSelection(updateToolbar = true) {
  const rows = [...document.querySelectorAll('.meeting-row')];
  const available = new Set(rows.map((row) => row.dataset.selectionKey));
  [...selectedMeetingKeys].filter((key) => !available.has(key)).forEach((key) => selectedMeetingKeys.delete(key));
  rows.forEach((row) => { const selected = selectedMeetingKeys.has(row.dataset.selectionKey); row.classList.toggle('is-selected', selected); row.setAttribute('aria-selected', String(selected)); });
  if (!updateToolbar) return;
  batchToolbar.hidden = selectedMeetingKeys.size === 0;
  batchToolbar.querySelector('[data-batch-count]').textContent = BreviaI18n.selectionOverview(locale, selectedMeetingKeys.size);
  const deleted = activeLibraryNav === 'recently-deleted';
  const category = batchToolbar.querySelector('[data-batch-category]');
  const exportButton = batchToolbar.querySelector('[data-batch-export]');
  const restoreButton = batchToolbar.querySelector('[data-batch-restore]');
  category.hidden = deleted;
  exportButton.hidden = deleted;
  restoreButton.hidden = !deleted;
  category.innerHTML = flowSelect('batch-category', '__choose', [['__choose', t('分类')], ['', t('未分类')], ...categories.map((name) => [name, name])]);
  restoreButton.textContent = t('恢复');
  exportButton.textContent = t('导出');
  batchToolbar.querySelector('[data-batch-delete]').textContent = deleted ? BreviaI18n.trashCopy(locale).purge : t('删除');
  batchToolbar.querySelector('[data-batch-clear]').textContent = t('取消');
}
const selectedMeetings = () => uiData.meetings.filter((meeting, index) => selectedMeetingKeys.has(meeting.id || String(index)));
function clearMeetingSelection() { selectedMeetingKeys.clear(); syncMeetingSelection(); }
/** Rebuilds the category filter from user-managed categories. @returns {void} */
function renderCategoryFilter() { categoryFilter.innerHTML = flowSelect('library-category', activeCategory, [['', t('所有分类')], ['__unclassified', t('未分类')], ...categories.map((name) => [name, name])]); }
function renderDateFilter() { dateFilter.innerHTML = flowSelect('library-date', activeDateRange, [['30', t('最近 30 天')], ['7', t('最近 7 天')], ['90', t('最近 90 天')], ['all', t('全部时间')]]); }
/** Applies the active category and text query to the meeting library. @returns {void} */
function filterMeetings() { const query = meetingSearch.value.trim().toLowerCase(); document.querySelectorAll('.meeting-row').forEach((row) => { const meeting = uiData.meetings[Number(row.dataset.meetingIndex)]; const categoryMatch = !activeCategory || (activeCategory === '__unclassified' ? !meeting.category : meeting.category === activeCategory); row.hidden = !categoryMatch || (!window.brevia && !row.textContent.toLowerCase().includes(query)); }); }
/** Updates a meeting category and its library metadata. @param {object} meeting Meeting to update. @param {string} category Target category or empty for unclassified. @returns {void} */
function setMeetingCategory(meeting, category) { meeting.category = category; meeting.meta = meeting.meta.replace(/ · [^·]+$/, category ? ` · ${category}` : ''); }
/** Formats backend meeting metadata in the current interface language. @param {object} meeting Stored UI meeting. @returns {object} Display-ready meeting. */
function localizeMeeting(meeting) {
  if (!meeting.createdAt) return meeting;
  const languageTag = BreviaI18n.localeTag(locale);
  const created = new Date(meeting.createdAt).toLocaleString(languageTag, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = Math.round(meeting.durationMs / 60000);
  return {
    ...meeting,
    meta: `${created} · ${minutes} ${t('分钟')}${meeting.category ? ` · ${meeting.category}` : ''}`,
    status: meeting.statusCode === 'recording'
      ? { tone: 'processing', label: t('正在录制'), detail: t('本地保存') }
      : { tone: 'complete', label: t('已整理'), detail: t('本地录音') },
  };
}
/** Re-renders only the meeting list, preserving settings-modal event bindings. @returns {void} */
function renderMeetingList() { document.querySelector('.meeting-list').innerHTML = uiData.meetings.map((meeting, index) => !meeting.isExample || meeting.exampleLocale === locale ? renderMeetingRow(localizeMeeting(meeting), index) : '').join(''); filterMeetings(); syncMeetingSelection(); }
renderCategoryFilter();
renderDateFilter();
const prepareForm = document.querySelector('#meeting-form');
const importRecording = document.createElement('button');
importRecording.className = 'secondary';
importRecording.type = 'button';
importRecording.id = 'import-recording';
importRecording.textContent = '导入录音';
prepareForm.querySelector('[type="submit"]').after(importRecording);
const meetingTitle = document.querySelector('#meeting-title');
let meetingTitleEdited = false;
/** Refreshes the starter title only until the user provides their own. @returns {void} */
function renderDefaultMeetingTitle() { if (!meetingTitleEdited) meetingTitle.value = BreviaI18n.defaultMeetingTitle(locale); }
meetingTitle.addEventListener('input', () => { meetingTitleEdited = true; });
/** Rebuilds meeting-language selectors while preserving their submitted values. @returns {void} */
function renderPrepareSelects() {
  const values = Object.fromEntries(new FormData(prepareForm));
  const categoryOptions = [['', t('未分类')], ...categories.map((name) => [name, name])];
  prepareForm.querySelector('.form-grid').innerHTML = `<label>${t('会议语言')}${flowSelect('meeting-language', values['meeting-language'] || 'auto', BreviaI18n.languageOptions(locale, t, true))}</label><label>${t('译文目标')}${flowSelect('translation-target', values['translation-target'] || '', BreviaI18n.languageOptions(locale, t))}</label><label>${t('预期说话人数')}<input name="num-speakers" type="number" min="1" step="1" value="${values['num-speakers'] || ''}" placeholder="${t('留空自动匹配')}" /></label><label>${t('分类标签')}${flowSelect('meeting-category', values['meeting-category'] || '', categoryOptions)}</label>`;
}
const prepareModelChoices = {
  'active-streaming-model': [['', null], ['zipformer-zh-xlarge-streaming-int8', 'Streaming Zipformer Chinese XLarge'], ['zipformer-zh-streaming-int8', 'Streaming Zipformer Chinese'], ['zipformer-zh-en-streaming-int8', 'Streaming Zipformer Chinese and English'], ['zipformer-multilingual-streaming', 'Streaming Zipformer Multilingual'], ['paraformer-zh-en-int8', 'Streaming Paraformer'], ['zipformer-en-streaming-int8', 'Streaming Zipformer English'], ['zipformer-ko-streaming-int8', 'Streaming Zipformer Korean'], ['zipformer-fr-streaming-int8', 'Streaming Zipformer French'], ['sensevoice-int8', 'SenseVoice int8']],
  'active-diarization-model': [['|', null], ['pyannote-segmentation-3.0|eres2net-base-3dspeaker-zh', 'Pyannote + 3D-Speaker'], ['pyannote-segmentation-3.0|nemo-titanet-small-en', 'Pyannote + NeMo Titanet'], ['pyannote-segmentation-3.0|campplus-zh-en', 'Pyannote + 3D-Speaker CAM++']],
  'active-vad-model': [['silero-vad', 'Silero VAD'], ['ten-vad', 'TEN-VAD']],
  'active-refined-model': [['', null], ['qwen3-asr-0.6b-int8', 'Qwen3-ASR'], ['qwen3-asr-1.7b-int8', 'Qwen3-ASR 1.7B int8'], ['sensevoice-int8', 'SenseVoice int8'], ['whisper-turbo', 'Whisper Turbo']],
};
const prepareModelCard = document.querySelector('.model-card');
prepareModelCard.querySelector('dl').insertAdjacentHTML('beforeend', '<div><dt>VAD 模型</dt><dd id="active-vad-model" data-model="silero-vad">Silero VAD</dd></div>');
const modelPicker = document.createElement('div');
modelPicker.className = 'flow-select-options model-picker';
modelPicker.hidden = true;
prepareModelCard.append(modelPicker);
prepareModelCard.addEventListener('click', (event) => {
  const choice = event.target.closest('[data-model-picker-choice]');
  if (!choice) return;
  const value = document.querySelector(`#${choice.dataset.modelPickerChoice}`);
  const [first, second] = choice.dataset.value.split('|');
  if (value.id === 'active-streaming-model') prepareForm.dataset.streamingModel = first;
  if (value.id === 'active-diarization-model') { prepareForm.dataset.segmentationModel = first; prepareForm.dataset.embeddingModel = second; }
  if (value.id === 'active-refined-model') prepareForm.dataset.refinedModel = first;
  if (value.id === 'active-vad-model') prepareForm.dataset.vadModel = first;
  value.dataset.model = choice.dataset.value;
  value.textContent = choice.textContent;
  modelPicker.hidden = true;
});
prepareModelCard.addEventListener('dblclick', (event) => {
  const value = event.target.closest('dd[id]');
  const choices = value && prepareModelChoices[value.id];
  if (!choices) return;
  modelPicker.innerHTML = choices.map(([id, name]) => `<button type="button" data-model-picker-choice="${value.id}" data-value="${id}">${name || t('自动匹配')}</button>`).join('');
  modelPicker.style.top = `${value.offsetTop + value.offsetHeight + 4}px`;
  modelPicker.hidden = false;
});
document.addEventListener('click', (event) => { if (!event.target.closest('.model-card')) modelPicker.hidden = true; });
if (breviaClient) {
  breviaClient.onLevel = (track, level) => {
    if (track === 'mic') document.querySelector('#mic-level').style.setProperty('--level', Math.max(.04, level));
  };
}
async function previewMicrophone() {
  if (!breviaClient || !prepareForm.querySelector('[name="capture-mic"]').checked) return;
  try {
    await breviaClient.previewMic();
    document.querySelector('#mic-input-state').lastChild.textContent = t('输入良好');
  } catch (error) {
    document.querySelector('#mic-input-state').lastChild.textContent = error.message;
  }
}
prepareForm.querySelector('[name="capture-mic"]').addEventListener('change', (event) => {
  if (event.target.checked) void previewMicrophone();
  else void breviaClient?.stopPreview();
});
let refinementMeetingTitle = '';
function showRefinementProgress(completed = 0, total = 0, meetingTitle = refinementMeetingTitle) {
  clearTimeout(refinementDismissTimer);
  refinementMeetingTitle = meetingTitle;
  const copy = { title: t('正在精修'), waiting: t('准备中') };
  const ratio = total ? Math.min(1, completed / total) : 0;
  revealTaskCard(refinementCard);
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${copy.title} - ${refinementMeetingTitle}` : copy.title;
  refinementPercent.textContent = total ? `${Math.round(ratio * 100)}%` : copy.waiting;
  refinementBar.style.transform = `scaleX(${ratio})`;
}
let refinementDismissTimer;
function showRefinementComplete() {
  clearTimeout(refinementDismissTimer);
  revealTaskCard(refinementCard);
  const title = t('会后精修已完成');
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${title} - ${refinementMeetingTitle}` : title;
  refinementPercent.textContent = '100%';
  refinementBar.style.transform = 'scaleX(1)';
  refinementDismissTimer = setTimeout(hideRefinementProgress, 10000);
}
function hideRefinementProgress() { dismissTaskCard(refinementCard, () => { refinementCard.hidden = true; refinementCard.classList.remove('task-card-leave'); }); }
let separationDismissTimer;
function showSeparationProgress(completed = 0, total = 100) {
  clearTimeout(separationDismissTimer);
  let card = document.querySelector('#separation-progress');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'separation-progress';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<header class="task-card-heading"><p></p><button class="task-card-close" data-dismiss-task-card type="button" aria-label="关闭">×</button></header><strong></strong><div class="processing-bar" aria-hidden="true"><i></i></div>';
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? Math.min(1, completed / total) : 0;
  card.querySelector('p').textContent = t('正在分离人声与非人声');
  card.querySelector('strong').textContent = total ? `${Math.round(ratio * 100)}%` : t('准备中');
  card.querySelector('i').style.transform = `scaleX(${ratio})`;
}
function showSeparationComplete() {
  showSeparationProgress(100, 100);
  document.querySelector('#separation-progress p').textContent = t('声源分离已完成');
  separationDismissTimer = setTimeout(() => dismissTaskCard(document.querySelector('#separation-progress')), 10000);
}
let summaryDismissTimer;
function showSummaryProgress(completed = 0, total = 100, stage = t('准备中')) {
  clearTimeout(summaryDismissTimer);
  let card = document.querySelector('#summary-progress');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'summary-progress';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<header class="task-card-heading"><p></p><button class="task-card-close" data-dismiss-task-card type="button" aria-label="关闭">×</button></header><strong></strong><div class="processing-bar" aria-hidden="true"><i></i></div>';
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? Math.min(1, completed / total) : 0;
  card.querySelector('p').textContent = '正在生成会议纪要';
  card.querySelector('strong').textContent = `${stage}${total ? ` · ${Math.round(ratio * 100)}%` : ''}`;
  card.querySelector('i').style.transform = `scaleX(${ratio})`;
}
function hideSummaryProgress() { clearTimeout(summaryDismissTimer); dismissTaskCard(document.querySelector('#summary-progress')); }
function showSummaryComplete() {
  showSummaryProgress(100, 100, '纪要已生成');
  summaryDismissTimer = setTimeout(hideSummaryProgress, 10000);
}
const requiredModelIds = new Set();
const pendingModelTasks = new Map();
const resumingModelTasks = new Set();
function queueModelTask(task, payload, models) {
  if (!task || (!payload?.meeting_id && !['meeting.start', 'tts.synthesize'].includes(task))) return;
  pendingModelTasks.set(`${task}:${payload.meeting_id || 'new'}`, { task, payload, models });
}
async function resumeReadyModelTasks() {
  for (const [key, pending] of pendingModelTasks) {
    if (resumingModelTasks.has(key) || !pending.models.every((modelId) => modelPaths.has(modelId))) continue;
    pendingModelTasks.delete(key);
    resumingModelTasks.add(key);
    try {
      if (pending.task === 'meeting.refine') {
        showRefinementProgress(0, 0, currentMeetingDetail?.title);
        await window.brevia.meeting.refine(pending.payload);
      } else if (pending.task === 'meeting.separate') {
        showSeparationProgress(0, 100);
        await window.brevia.meeting.separate(pending.payload);
      } else if (pending.task === 'meeting.start') {
        const { inputs, ...payload } = pending.payload;
        const meeting = await breviaClient.start(payload, inputs);
        if (meeting?.model_required) queueModelTask('meeting.start', pending.payload, meeting.model_required);
        else activateMeeting(meeting, payload);
      } else if (pending.task === 'tts.synthesize') {
        const result = await window.brevia.tts.synthesize(pending.payload);
        if (result?.model_required) queueModelTask('tts.synthesize', pending.payload, result.model_required);
        else await playTts(result);
      }
    } catch (error) {
      hideRefinementProgress();
      document.querySelector('#separation-progress') && dismissTaskCard(document.querySelector('#separation-progress'));
      showToast(error.message);
    } finally { resumingModelTasks.delete(key); }
  }
}
function modelDisplayName(modelId) {
  const item = (modalCopy[locale] || modalCopy.en).models.items[modelIds.indexOf(modelId)];
  return item?.[1] || modelId;
}
function renderRequiredModelsCard() {
  [...requiredModelIds].filter((id) => modelPaths.has(id)).forEach((id) => requiredModelIds.delete(id));
  let card = document.querySelector('#required-models');
  if (!requiredModelIds.size) { dismissTaskCard(card); return; }
  if (!card) {
    card = document.createElement('aside');
    card.id = 'required-models';
    card.className = 'processing-card required-models-card';
    card.setAttribute('aria-live', 'polite');
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ids = [...requiredModelIds];
  card.innerHTML = `<header class="task-card-heading"><p>${t('需要下载以下模型')}</p><span class="task-card-actions"><button type="button" data-download-required-all>${t('全部下载')}</button><button class="task-card-close" data-dismiss-task-card type="button" aria-label="关闭">×</button></span></header><ul>${ids.map((id) => {
    const progress = modelDownloads.get(id);
    const ratio = progress?.total ? Math.min(1, progress.received / progress.total) : 0;
    const status = progress?.error ? escapeHtml(progress.error) : progress ? (progress.total ? `${Math.round(ratio * 100)}%` : t('准备中')) : '';
    return `<li><span><b>${escapeHtml(modelDisplayName(id))}</b><small>${status}</small></span><button type="button" data-download-required="${id}"${progress && !progress.error ? ' disabled' : ''}>${progress && !progress.error ? t('下载中') : t('下载')}</button><div class="processing-bar" aria-hidden="true"><i style="transform:scaleX(${ratio})"></i></div></li>`;
  }).join('')}</ul>`;
}
async function downloadRequiredModel(modelId) {
  if (modelPaths.has(modelId)) { requiredModelIds.delete(modelId); renderRequiredModelsCard(); return; }
  modelDownloads.set(modelId, { received: 0, total: 0 });
  renderRequiredModelsCard();
  try {
    await window.brevia?.models.download({ model_id: modelId });
  } catch (error) {
    modelDownloads.set(modelId, { error: error.message });
    renderRequiredModelsCard();
  }
}
taskCards.addEventListener('click', (event) => {
  const close = event.target.closest('[data-dismiss-task-card]');
  if (close) {
    const card = close.closest('.processing-card');
    if (card === refinementCard) hideRefinementProgress();
    else {
      if (card?.id === 'separation-progress') clearTimeout(separationDismissTimer);
      if (card?.id === 'summary-progress') clearTimeout(summaryDismissTimer);
      if (card?.id === 'summary-config-required') clearTimeout(summaryConfigDismissTimer);
      dismissTaskCard(card);
    }
    return;
  }
  const one = event.target.closest('[data-download-required]');
  if (one) { void downloadRequiredModel(one.dataset.downloadRequired); return; }
  if (event.target.closest('[data-download-required-all]')) {
    void Promise.all([...requiredModelIds].map(downloadRequiredModel));
  }
});
prepareForm.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) {
    const options = toggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    prepareForm.querySelectorAll('.flow-select-options').forEach((list) => { list.hidden = true; list.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
    options.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const choice = event.target.closest('[data-flow-select-choice]');
  if (!choice) return;
  const select = choice.closest('.flow-select');
  select.querySelector('input').value = choice.dataset.value;
  select.querySelector('.flow-select-toggle').firstChild.nodeValue = choice.textContent;
  select.querySelector('.flow-select-options').hidden = true;
  select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
});
/** Produces the safe-to-display subset of the active model configuration. @returns {string} Formatted JSON without API keys. */
function renderConfigPreview() {
  const current = summaryModels[activeSummaryModel];
  return JSON.stringify(current ? { name: current.name, provider: current.provider, endpoint: current.endpoint, format: current.format, model: current.model } : {}, null, 2);
}
/** Renders the editable summary-model configuration modal. @returns {void} */
function renderSummaryModelModal() {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const current = summaryModels[editingSummaryModel] || { name: draftSummaryName || `配置-${configSequence + 1}`, provider: 'OpenAI', apiKey: '', endpoint: '', format: '', model: '' };
  const apiFormat = current.format === 'claude' ? 'claude' : 'openai';
  const configuredControl = summaryModels.length ? `<div class="configured-models"><label class="config-select-field">${copy.configured}${flowSelect('active-summary-model', String(activeSummaryModel), summaryModels.map((item, index) => [String(index), `${item.name} · ${item.provider} · ${item.model}${index === activeSummaryModel ? ` · ${copy.active}` : ''}`]), true)}</label></div>` : '';
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-body').innerHTML = `<form class="summary-model-form"><div class="config-fields"><label>${copy.name}<input name="name" value="${escapeHtml(current.name)}" maxlength="64" required /></label><label class="config-select-field">${copy.provider}${flowSelect('provider', current.provider, summaryProviders.map((provider) => [provider, provider === 'Ollama' ? copy.ollama : provider]))}</label><label>${copy.key}<input name="apiKey" type="password" autocomplete="new-password" placeholder="${current.keyReference ? '已安全保存，留空表示不修改' : ''}" /></label><label>${copy.endpoint}<input name="endpoint" value="${escapeHtml(current.endpoint)}" required /></label><label class="config-select-field">${copy.format}${flowSelect('format', apiFormat, [['openai', copy.openAIFormat], ['claude', copy.claudeFormat]])}</label><label>${copy.model}<input name="model" value="${escapeHtml(current.model)}" required /></label></div><div class="modal-form-actions"><button class="modal-action" type="submit">${copy.save}</button><button class="secondary" data-new-summary-model type="button">${copy.add}</button>${editingSummaryModel >= 0 ? `<button class="model-delete" data-delete-summary-model type="button">${copy.remove}</button>` : ''}</div></form>${configuredControl}<section class="modal-subsection"><h3>${copy.promptTitle}</h3><p>${copy.promptIntro}</p><form class="prompt-form"><textarea name="prompt" rows="9" required>${escapeHtml(summaryPrompt)}</textarea><button class="modal-action" type="submit">${copy.save}</button></form></section><section class="modal-subsection"><h3>${copy.jsonTitle}</h3><p>${copy.jsonIntro}</p><pre class="config-json">${escapeHtml(renderConfigPreview())}</pre></section>`;
}
function renderSpeakerProfileModal() {
  const copy = speakerProfileCopy[locale] || speakerProfileCopy.en;
  const voiceCopy = voiceFeaturesCopy[locale] || voiceFeaturesCopy.en;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-body').innerHTML = `<form class="speaker-profile-form"><label>${copy.name}<input name="name" maxlength="32" required /></label><label>${voiceCopy.reference}<input name="reference_text" maxlength="500" required /></label><button class="modal-action" type="submit">${copy.add}</button></form><div class="speaker-profile-list">${speakerProfiles.map((profile) => {
    const samples = speakerSamples.get(profile.id) || [];
    const expanded = expandedSpeakerProfileId === profile.id;
    const adding = addingSampleProfileId === profile.id;
    return `<section class="speaker-profile-entry"><div class="speaker-profile-head"><span><b>${escapeHtml(profile.name)}</b><small>${profile.built_in ? `${t('内置')} · ` : ''}${profile.sample_count}/50 ${copy.samples} · ${formatMeetingTime(profile.duration_ms || 0)} / 05:00</small></span><span><button class="secondary" data-toggle-speaker-samples="${profile.id}" type="button">${expanded ? t('收起') : t('查看录音')}</button><button class="secondary" data-add-speaker-sample="${profile.id}" type="button">${copy.addSample}</button><button class="secondary" data-verify-speaker-profile="${profile.id}" type="button">${voiceCopy.verify}</button>${profile.built_in ? '' : `<button class="model-delete" data-delete-speaker-profile="${profile.id}" type="button">${copy.remove}</button>`}</span></div>${adding ? `<form class="speaker-sample-form" data-speaker-profile="${profile.id}"><label>${voiceCopy.reference}<input name="reference_text" maxlength="500" required autofocus /></label><button class="modal-action" type="submit">${t('选择录音并添加')}</button><button class="secondary" data-cancel-speaker-sample type="button">${t('取消')}</button></form>` : ''}${expanded ? `<div class="speaker-sample-list">${samples.length ? samples.map((sample) => `<article><button class="sample-play" data-play-speaker-sample="${sample.id}" type="button" aria-label="${t('播放录音')}">▶</button><span><b>${escapeHtml(sample.reference_text || t('未填写文本'))}</b><small>${formatMeetingTime(sample.duration_ms || 0)}</small></span>${profile.built_in ? '' : `<button class="model-delete" data-delete-speaker-sample="${sample.id}" data-profile-id="${profile.id}" type="button">${copy.remove}</button>`}</article>`).join('') : `<p>${copy.empty}</p>`}</div>` : ''}</section>`;
  }).join('')}</div>`;
}
function renderExportModal() {
  const separated = Boolean(currentMeetingDetail?.audio?.playback?.vocals && currentMeetingDetail?.audio?.playback?.accompaniment);
  settingsModal.querySelector('h2').textContent = t('导出会议');
  settingsModal.querySelector('.modal-title p').textContent = currentMeetingDetail?.title || '';
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="export-options">
    <button type="button" data-export-choice data-content="transcript" data-format="md"><span><b>Markdown</b><small>${t('带说话人和时间戳的逐字稿')}</small></span><strong>.md</strong></button>
    <button type="button" data-export-choice data-content="transcript" data-format="srt"><span><b>${t('字幕文件')}</b><small>${t('标准时间轴字幕')}</small></span><strong>.srt</strong></button>
    <button type="button" data-export-choice data-content="audio" data-format="wav" data-track="mix"><span><b>${t('原录音')}</b><small>${t('未修改的会议混音')}</small></span><strong>.wav</strong></button>
    <button type="button" data-export-choice data-content="audio" data-format="wav" data-track="vocals"${separated ? '' : ' disabled'}><span><b>${t('人声轨')}</b><small>${separated ? t('声源分离结果') : t('请先完成声源分离')}</small></span><strong>.wav</strong></button>
    <button type="button" data-export-choice data-content="audio" data-format="wav" data-track="accompaniment"${separated ? '' : ' disabled'}><span><b>${t('非人声轨')}</b><small>${separated ? t('声源分离结果') : t('请先完成声源分离')}</small></span><strong>.wav</strong></button>
  </div>`;
}
function renderSummaryDetailModal() {
  const summary = currentMeetingDetail?.summary?.data;
  if (!summary) { closeModal(); return; }
  const list = (items, render) => items.length ? `<ul>${items.map(render).join('')}</ul>` : `<p>${t('无')}</p>`;
  settingsModal.querySelector('h2').textContent = t('完整会议纪要');
  settingsModal.querySelector('.modal-title p').textContent = currentMeetingDetail.title;
  settingsModal.querySelector('.modal-body').innerHTML = `<article class="summary-detail-content"><p class="summary-detail-lead">${escapeHtml(summary.summary)}</p><section><h3>${t('决定')}</h3>${list(summary.decisions, (item) => `<li>${escapeHtml(item.text)}</li>`)}</section><section><h3>${t('待办')}</h3>${list(summary.action_items, (item) => `<li>${escapeHtml(item.task)}<small>${escapeHtml(item.owner || t('待确认'))}${item.due ? ` · ${escapeHtml(item.due)}` : ''}</small></li>`)}</section><section><h3>${t('开放问题')}</h3>${list(summary.open_questions, (item) => `<li>${escapeHtml(String(item))}</li>`)}</section></article><div class="modal-form-actions"><button class="secondary" type="button" data-regenerate-summary>${t('重新生成')}</button></div><section class="modal-subsection"><h3>${t('导出会议纪要')}</h3><div class="export-options"><button type="button" data-summary-export-choice data-format="md"><span><b>Markdown</b><small>${t('完整结构化会议纪要')}</small></span><strong>.md</strong></button><button type="button" data-summary-export-choice data-format="txt"><span><b>TXT</b><small>${t('纯文本会议纪要')}</small></span><strong>.txt</strong></button><button type="button" data-summary-export-choice data-format="pdf"><span><b>PDF</b><small>${t('适合归档与分享')}</small></span><strong>.pdf</strong></button></div></section>`;
}
/** Renders one settings modal. @param {'models'|'terms'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
function renderModal(kind) {
  if (kind === 'summary-model') { renderSummaryModelModal(); return; }
  if (kind === 'speaker-profiles') { renderSpeakerProfileModal(); return; }
  if (kind === 'export') { renderExportModal(); return; }
  if (kind === 'summary-detail') { renderSummaryDetailModal(); return; }
  const copy = (modalCopy[locale] || modalCopy.en)[kind];
  const modelStageOrder = new Map();
  (copy.items || []).forEach(([stage], index) => { if (!modelStageOrder.has(stage)) modelStageOrder.set(stage, index); });
  const items = kind === 'models' ? copy.items.map((item, sourceIndex) => ({ item, sourceIndex })).sort((a, b) => modelStageOrder.get(a.item[0]) - modelStageOrder.get(b.item[0])) : kind === 'terms' ? termEntries.map(({ name, detail }) => [name, detail === '自定义术语' ? t(detail) : detail]) : copy.items;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close);
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="modal-list${kind === 'models' ? ' model-library-list' : ''}">${items.map((entry, index) => {
    const item = kind === 'models' ? entry.item : entry;
    const sourceIndex = kind === 'models' ? entry.sourceIndex : index;
    const [name, detail] = kind === 'models' ? item.slice(1, 3) : item;
    const [stage, , , intro] = kind === 'models' ? item : [];
    const termEditing = kind === 'terms' && editingTermIndex === index;
    const label = termEditing ? `<input class="term-edit-input" data-edit-term-input="${index}" value="${escapeHtml(name)}" maxlength="64" />` : `<b>${escapeHtml(name)}</b>`;
    const progress = kind === 'models' ? modelDownloads.get(modelIds[sourceIndex]) : null;
    const ratio = progress?.total ? Math.min(1, progress.received / progress.total) : 0;
    const downloadProgress = progress?.error ? `<span class="model-download-progress">${escapeHtml(progress.error)}</span>` : progress ? `<span class="model-download-progress">${formatBytes(progress.received)} / ${formatBytes(progress.total)} · ${Math.round(ratio * 100)}%<i aria-hidden="true" style="transform:scaleX(${ratio})"></i></span>` : '';
    const size = kind === 'models' ? `<small>${formatBytes(modelSizes[sourceIndex])}</small>` : '';
    const actions = kind === 'models' ? `<span class="model-actions">${isModelInstalled(name) && modelPaths.has(modelIds[sourceIndex]) ? `<button class="secondary" data-open-model-folder="${sourceIndex}" type="button">${t('从文件夹打开')}</button>` : ''}<button class="modal-action${isModelInstalled(name) ? ' modal-danger' : ''}" ${isModelInstalled(name) ? `data-delete-model="${sourceIndex}"` : `data-download-model="${sourceIndex}"`} type="button"${progress && !progress.error ? ' disabled' : ''}>${isModelInstalled(name) ? (modelLabels[locale] || modelLabels.en).remove : progress && !progress.error ? (modelLabels[locale] || modelLabels.en).downloading : (modelLabels[locale] || modelLabels.en).download}</button></span>` : kind === 'terms' ? `<span class="term-actions">${termEditing ? `<button class="modal-action" data-save-term="${index}" type="button">${copy.save}</button><button class="modal-action" data-cancel-term type="button">${copy.cancel}</button>` : `<button class="modal-action" data-edit-term="${index}" type="button">${copy.edit}</button><button class="modal-action" data-remove-term="${index}" type="button">${copy.remove}</button>`}</span>` : '';
    const heading = kind === 'models' && (index === 0 || items[index - 1].item[0] !== stage) ? `<h3>${escapeHtml(stage)}</h3>` : '';
    return `${heading}<div><span>${label}${downloadProgress}<small>${escapeHtml(detail)}</small>${size}${intro ? `<small>${escapeHtml(intro)}</small>` : ''}</span>${actions}</div>`;
  }).join('')}</div>${kind === 'terms' ? `<form class="term-form"><input name="term" required maxlength="64" placeholder="${copy.placeholder}" /><button type="submit">${copy.add}</button></form>` : ''}`;
}
/** Opens and focuses a settings modal. @param {'models'|'terms'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
let modalDismissTimer;
function openModal(kind) {
  clearTimeout(modalDismissTimer);
  activeModal = kind;
  renderModal(kind);
  settingsModal.classList.remove('modal-leave');
  settingsModal.hidden = false;
  requestAnimationFrame(() => settingsModal.classList.add('modal-enter'));
  document.body.classList.add('modal-open');
  settingsModal.querySelector('.modal-close').focus();
}
/** Closes the active settings modal and restores page scrolling. @returns {void} */
function closeModal() {
  if (settingsModal.hidden) return;
  activeModal = undefined;
  settingsModal.classList.remove('modal-enter');
  settingsModal.classList.add('modal-leave');
  modalDismissTimer = setTimeout(() => {
    if (!settingsModal.classList.contains('modal-leave')) return;
    settingsModal.hidden = true;
    settingsModal.classList.remove('modal-leave');
    document.body.classList.remove('modal-open');
  }, 220);
}
const settingsActions = [...document.querySelectorAll('#settings-view [data-settings-modal]')];
settingsActions.forEach((button) => button.addEventListener('click', () => openModal(button.dataset.settingsModal)));
const modelAction = document.querySelector('[data-settings-modal="models"]');
speakerProfileCard.querySelector('button').addEventListener('click', () => openModal('speaker-profiles'));
const installedModelNames = new Set();
const modelPaths = new Map();
/** Checks whether a model is installed locally. @param {string} name Model name. @returns {boolean} Whether the model exists in the installed set. */
function isModelInstalled(name) { return installedModelNames.has(name); }
/** Removes an installed model from the list and local state. @param {string} name Model name. @returns {void} */
function deleteInstalledModel(name) { installedModelNames.delete(name); }
/** Synchronizes installed-model actions after a locale or model-list change. @returns {void} */
function renderModelControls() {
  modelAction.textContent = (modelLabels[locale] || modelLabels.en).manage;
}
/** Records a newly downloaded model for the management dialog. @param {{name: string}} model Downloaded model metadata. @returns {void} */
function installModel(model) {
  if (isModelInstalled(model.name)) return;
  installedModelNames.add(model.name);
}
/** Updates the term summary card after terms or the interface language changes. @returns {void} */
function renderTermOverview() {
  const card = document.querySelectorAll('#settings-view .settings-card')[1];
  const count = termEntries.length;
  card.querySelector('p').textContent = BreviaI18n.termOverview(locale, count);
  card.querySelector('.terms').innerHTML = count
    ? termEntries.slice(0, 4).map((term) => `<span>${escapeHtml(term.name)}</span>`).join('')
    : `<span>${t('暂无术语')}</span>`;
}
/** Renders participants discovered from voiceprints together with the current meeting status. @returns {void} */
function renderLivePanel() {
  const copy = voiceFeaturesCopy[locale] || voiceFeaturesCopy.en;
  const participants = [...liveSpeakers.values()];
  const people = participants.length
    ? participants.map((participant) => renderParticipant({
      ...participant,
      name: participant.name || `${t('说话人')} ${participant.id}`,
    })).join('')
    : `<p class="participants-empty">${t('等待识别说话人')}</p>`;
  const voices = [...presetVoices, ...speakerProfiles.filter((profile) => profile.has_reference).map((profile) => ({ id: profile.id, name: profile.name }))].map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.name)}</option>`).join('');
  const noVoice = !voices;
  document.querySelector('.live-panel').innerHTML = `<section><p class="eyebrow">${t('参与者')} · ${participants.length}</p><div class="participants-list">${people}</div></section><section><p class="eyebrow">${t('本场状态')}</p>${renderStatusList(uiData.live.status)}</section>`;
  document.querySelector('#tts-chat').innerHTML = `<p class="eyebrow">${locale === 'zh' ? '语音对话' : 'Voice conversation'}</p><form id="tts-chat-form"><div class="tts-selects"><select name="voice_id" aria-label="${copy.voice}" ${noVoice ? 'disabled' : ''}><option value="">${copy.voice}</option>${voices}</select><select name="target_language" aria-label="${copy.voice}"><option value="zh">中文</option><option value="en">English</option></select></div><input name="text" maxlength="1000" placeholder="${copy.placeholder}" required /><button type="submit" ${noVoice ? 'disabled' : ''}>${copy.send}</button>${noVoice ? `<p class="tts-hint">${locale === 'zh' ? '请先在声纹库注册可用声音' : 'Register a voiceprint before sending speech'}</p>` : ''}</form>`;
}
renderModelControls();
renderTermOverview();
renderLivePanel();
settingsModal.addEventListener('click', async (event) => {
  if (event.target === settingsModal || event.target.closest('.modal-close')) { closeModal(); return; }
  const summaryExport = event.target.closest('[data-summary-export-choice]');
  if (summaryExport) {
    summaryExport.disabled = true;
    try {
      const result = await window.brevia?.meeting.export({ meeting_id: breviaClient.state.selectedMeetingId, content: 'notes', format: summaryExport.dataset.format });
      if (result) { closeModal(); showToast(t('导出完成')); }
    } catch (error) { summaryExport.disabled = false; showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-regenerate-summary]')) { closeModal(); void generateMeetingSummary(); return; }
  const exportChoice = event.target.closest('[data-export-choice]');
  if (exportChoice) {
    exportChoice.disabled = true;
    try {
      const result = await window.brevia?.meeting.export({
        meeting_id: breviaClient.state.selectedMeetingId,
        content: exportChoice.dataset.content,
        format: exportChoice.dataset.format,
        ...(exportChoice.dataset.track ? { track: exportChoice.dataset.track } : {}),
      });
      if (result) { closeModal(); showToast(t('导出完成')); }
    } catch (error) { exportChoice.disabled = false; showToast(error.message); }
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
    select.querySelector('input').value = selectChoice.dataset.value;
    select.querySelector('.flow-select-toggle').firstChild.nodeValue = selectChoice.textContent;
    select.querySelector('.flow-select-options').hidden = true;
    select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
    if (select.hasAttribute('data-active-summary-model')) { activeSummaryModel = Number(selectChoice.dataset.value); editingSummaryModel = activeSummaryModel; await persistSummaryConfig(); renderModal('summary-model'); }
    return;
  }
  const addSummaryModel = event.target.closest('[data-new-summary-model]');
  if (addSummaryModel) { editingSummaryModel = -1; draftSummaryName = nextConfigName(); renderModal('summary-model'); return; }
  if (event.target.closest('[data-delete-summary-model]')) {
    summaryModels.splice(editingSummaryModel, 1);
    activeSummaryModel = summaryModels.length ? Math.min(activeSummaryModel, summaryModels.length - 1) : -1;
    editingSummaryModel = activeSummaryModel;
    draftSummaryName = summaryModels.length ? '' : nextConfigName();
    await persistSummaryConfig();
    renderModal('summary-model');
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
  const download = event.target.closest('[data-download-model]');
  if (download) {
    const index = Number(download.dataset.downloadModel);
    const [, name, detail, intro, icon] = (modalCopy[locale] || modalCopy.en).models.items[index];
    modelDownloads.set(modelIds[index], { received: 0, total: 0 });
    renderModal('models');
    try {
      if (window.brevia) await window.brevia.models.download({ model_id: modelIds[index] });
      else { installModel({ icon, name, detail, intro }); modelDownloads.delete(modelIds[index]); }
    } catch (error) { showToast(error.message); }
    renderModal('models');
    return;
  }
  const deleteModel = event.target.closest('[data-delete-model]');
  if (deleteModel) {
    const index = Number(deleteModel.dataset.deleteModel);
    const [, name] = (modalCopy[locale] || modalCopy.en).models.items[index];
    try {
      if (window.brevia) await window.brevia.models.delete({ model_id: modelIds[index] });
      deleteInstalledModel(name);
      modelPaths.delete(modelIds[index]);
    } catch (error) { showToast(error.message); }
    renderModal('models');
    return;
  }
  const openModelFolder = event.target.closest('[data-open-model-folder]');
  if (openModelFolder) {
    const modelId = modelIds[Number(openModelFolder.dataset.openModelFolder)];
    const directory = modelPaths.get(modelId);
    if (!directory) { showToast(t('未找到模型文件')); return; }
    try { await window.brevia?.showItem(`${directory}/.brevia.json`); } catch (error) { showToast(error.message); }
    return;
  }
  const edit = event.target.closest('[data-edit-term]');
  if (edit) { editingTermIndex = Number(edit.dataset.editTerm); renderModal('terms'); settingsModal.querySelector('[data-edit-term-input]').focus(); return; }
  if (event.target.closest('[data-cancel-term]')) { editingTermIndex = null; renderModal('terms'); return; }
  const save = event.target.closest('[data-save-term]');
  if (save) {
    const index = Number(save.dataset.saveTerm);
    const input = settingsModal.querySelector(`[data-edit-term-input="${index}"]`);
    const name = input.value.trim();
    if (name && !termEntries.some((entry, entryIndex) => entryIndex !== index && entry.name.toLowerCase() === name.toLowerCase())) {
      termEntries[index].name = name;
      if (window.brevia) await window.brevia.terms.save({ id: termEntries[index].id, text: name });
    }
    editingTermIndex = null;
    renderModal('terms');
    return;
  }
  const remove = event.target.closest('[data-remove-term]');
  if (remove) {
    const [term] = termEntries.splice(Number(remove.dataset.removeTerm), 1);
    if (window.brevia && term.id) await window.brevia.terms.delete({ term_id: term.id });
    editingTermIndex = null;
    renderModal('terms');
  }
});
settingsModal.addEventListener('submit', async (event) => {
  if (event.target.matches('.summary-model-form')) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const previous = summaryModels[editingSummaryModel];
    values.keyReference = previous?.keyReference || `summary-${crypto.randomUUID()}`;
    if (values.apiKey && window.brevia) await window.brevia.secret.set({ reference: values.keyReference, value: values.apiKey });
    delete values.apiKey;
    if (editingSummaryModel < 0) { summaryModels.push(values); activeSummaryModel = summaryModels.length - 1; } else summaryModels[editingSummaryModel] = values;
    editingSummaryModel = activeSummaryModel;
    draftSummaryName = '';
    await persistSummaryConfig();
    renderConfigPreview();
    renderModal('summary-model');
    return;
  }
  if (event.target.matches('.prompt-form')) {
    event.preventDefault();
    summaryPrompt = new FormData(event.target).get('prompt').trim();
    await persistSummaryConfig();
    renderConfigPreview();
    renderModal('summary-model');
    return;
  }
  if (event.target.matches('.speaker-sample-form')) {
    event.preventDefault();
    const profileId = event.target.dataset.speakerProfile;
    const profile = speakerProfiles.find((item) => item.id === profileId);
    try {
      const referenceText = new FormData(event.target).get('reference_text').trim();
      const result = await window.brevia?.speakerProfile.enroll({ profile_id: profileId, name: profile.name, reference_text: referenceText });
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
      const profile = await window.brevia?.speakerProfile.enroll({ name: values.get('name').trim(), reference_text: values.get('reference_text').trim() });
      if (profile) speakerProfiles = await window.brevia.speakerProfile.list();
    } catch (error) { showToast(error.message); }
    renderModal('speaker-profiles');
    return;
  }
  if (!event.target.matches('.term-form')) return;
  event.preventDefault();
  const term = new FormData(event.target).get('term').trim();
  if (!term || termEntries.some((entry) => entry.name.toLowerCase() === term.toLowerCase())) return;
  if (window.brevia) {
    const terms = await window.brevia.terms.save({ text: term });
    termEntries = terms.map((item) => ({ id: item.id, name: item.text, detail: item.note || '自定义术语' }));
  } else termEntries.push({ name: term, detail: locale === 'zh' ? '自定义术语' : locale === 'es' ? 'Término personalizado' : 'Custom term' });
  renderModal('terms');
});
async function playTts(result) {
  if (!result) return;
  const audio = new Audio(await window.brevia.audioUrl(result.path));
  await audio.play();
  showToast((voiceFeaturesCopy[locale] || voiceFeaturesCopy.en).ready);
}
document.querySelector('#live-view').addEventListener('submit', async (event) => {
  if (!event.target.matches('#tts-chat-form')) return;
  event.preventDefault();
  const values = new FormData(event.target);
  try {
    const voiceId = values.get('voice_id');
    const config = summaryModels[activeSummaryModel];
    if (!config) { showToast(locale === 'zh' ? '请先配置翻译模型' : 'Configure a translation model first'); return; }
    const result = await window.brevia?.tts.synthesize({ voice_id: voiceId, target_language: values.get('target_language'), text: values.get('text').trim(), provider: config.provider, endpoint: config.endpoint, model: config.model, format: config.format, key_reference: config.keyReference });
    if (result?.model_required) return;
    await playTts(result);
    event.target.reset();
  } catch (error) { showToast(error.message); }
});
/* Locale copy lives in i18n.js; this alias keeps the renderer focused on state changes. */
const slogans = BreviaI18n.slogans;
/*
  zh: ['每一场对话，都留有依据。', '让重要讨论，不再散落。', '从声音开始，留下清晰结论。', '记录发生的事，推进接下来的事。', '把会议留在掌控之中。'],
  en: ['Every conversation leaves a traceable record.', 'Keep important discussions in one place.', 'Start with sound. End with clear decisions.', 'Record what happened. Move the work forward.', 'Keep every meeting within reach.'],
  es: ['Cada conversación conserva un registro verificable.', 'Mantén las conversaciones importantes en un solo lugar.', 'Empieza con la voz. Termina con decisiones claras.', 'Registra lo que ocurrió. Haz avanzar el trabajo.', 'Mantén cada reunión bajo control.'],
  ja: ['すべての会話に、確かな記録を。', '大切な議論を、一か所に。', '音声から始め、明確な決定へ。', '起きたことを記録し、仕事を前へ進める。', 'すべての会議を手の届く場所に。'],
  ko: ['모든 대화에 추적 가능한 기록을 남깁니다.', '중요한 논의를 한곳에 모으세요.', '소리로 시작해 명확한 결정으로 마무리하세요.', '일어난 일을 기록하고 업무를 앞으로 나아가게 하세요.', '모든 회의를 가까이 두세요.'],
  fr: ['Chaque conversation laisse une trace vérifiable.', 'Gardez les discussions importantes au même endroit.', 'Commencez par le son. Terminez par des décisions claires.', 'Consignez ce qui s’est passé. Faites avancer le travail.', 'Gardez chaque réunion à portée de main.'],
  de: ['Jedes Gespräch hinterlässt eine nachvollziehbare Aufzeichnung.', 'Halten Sie wichtige Gespräche an einem Ort fest.', 'Mit Ton beginnen. Mit klaren Entscheidungen enden.', 'Dokumentieren Sie das Geschehene und bringen Sie die Arbeit voran.', 'Behalten Sie jede Besprechung im Blick.'],
  ru: ['Каждый разговор оставляет проверяемую запись.', 'Храните важные обсуждения в одном месте.', 'Начните со звука. Завершите ясными решениями.', 'Записывайте произошедшее и двигайте работу вперёд.', 'Держите каждую встречу под рукой.']
};*/
const homeSlogan = document.querySelector('#home-slogan');
const homeEyebrow = document.querySelector('#home-eyebrow');
const homePrimary = document.querySelector('#home-primary');
let sloganIndex = Math.floor(Math.random() * slogans.zh.length);
/** Updates the rotating library slogan. @param {boolean} animate Whether to play the transition. @returns {void} */
function renderSlogan(animate = false) {
  const update = () => {
    homeSlogan.textContent = activeLibraryNav === 'recently-deleted' ? t('最近删除') : (slogans[locale] || slogans.en)[sloganIndex];
    if (animate) {
      homeSlogan.classList.remove('slogan-out');
      homeSlogan.classList.add('slogan-in');
      window.setTimeout(() => homeSlogan.classList.remove('slogan-in'), 440);
    }
  };
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  homeSlogan.classList.add('slogan-out');
  window.setTimeout(update, 280);
}

/** Applies and persists the selected color theme. @param {'light'|'dark'} nextTheme Theme to apply. @returns {void} */
function applyTheme(nextTheme) {
  theme = nextTheme;
  localStorage.setItem('brevia-theme', theme);
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeToggle.textContent = dark ? '☾' : '◐';
  themeToggle.title = (themeLabels[locale] || themeLabels.en)[dark ? 'light' : 'dark'];
  themeToggle.setAttribute('aria-label', themeToggle.title);
}

/** Records static DOM text and attributes that can be replaced on locale changes. @returns {void} */
function collectTranslations() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const key = node.nodeValue.trim();
    if (catalog.zh.labels[key]) translatedNodes.push({ node, key, leading: node.nodeValue.match(/^\s*/)[0], trailing: node.nodeValue.match(/\s*$/)[0] });
  }
  document.querySelectorAll('[placeholder]').forEach((element) => translatedNodes.push({ element, attribute: 'placeholder', key: element.placeholder }));
  document.querySelectorAll('[value]').forEach((element) => translatedNodes.push({ element, attribute: 'value', key: element.value }));
  document.querySelectorAll('[aria-label]').forEach((element) => {
    const key = element.getAttribute('aria-label');
    if (catalog.zh.labels[key]) translatedNodes.push({ element, attribute: 'aria-label', key });
  });
  document.querySelectorAll('[title]').forEach((element) => {
    const key = element.getAttribute('title');
    if (catalog.zh.labels[key]) translatedNodes.push({ element, attribute: 'title', key });
  });
}
/** Applies a locale, redraws dependent components, and optionally animates translated nodes. @param {'zh'|'en'|'es'} nextLocale Locale to apply. @param {boolean} animate Whether to animate the change. @returns {void} */
function applyLanguage(nextLocale, animate = false) {
  locale = nextLocale;
  localStorage.setItem('brevia-language', locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
  languageToggle.title = t('切换语言');
  languageToggle.setAttribute('aria-label', t('切换语言'));
  applyTheme(theme);
  languageOptions.querySelectorAll('[data-language]').forEach((option) => option.setAttribute('aria-current', String(option.dataset.language === locale)));
  const nodes = [...new Set(translatedNodes.map(({ node, element }) => node?.parentElement || element).filter(Boolean))];
  const updateText = () => {
    translatedNodes.forEach(({ node, element, attribute, key, leading = '', trailing = '' }) => {
      const value = t(key);
      if (node) node.nodeValue = `${leading}${value}${trailing}`;
      else element[attribute] = value;
    });
    renderPrepareSelects();
    renderDefaultMeetingTitle();
    renderMeetingList();
    renderMeetingDetail();
    if (activeView === 'home') selectLibraryNav(activeLibraryNav);
    else crumb.textContent = catalog[locale].views[activeView];
    renderSlogan(false);
    renderUpdateButton();
    renderUpdateNotice();
    renderSpeakerProfileCard();
    renderModelControls();
    renderTermOverview();
    renderLivePanel();
    renderRequiredModelsCard();
    document.querySelector('[data-separate-detail]').textContent = (voiceFeaturesCopy[locale] || voiceFeaturesCopy.en).source;
    renderConfigPreview();
    if (activeModal) renderModal(activeModal);
    if (animate) nodes.forEach((element) => { element.classList.remove('locale-out'); element.classList.add('locale-in'); window.setTimeout(() => element.classList.remove('locale-in'), 520); });
  };
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { updateText(); return; }
  switchingLanguage = true;
  nodes.forEach((element) => element.classList.add('locale-out'));
  window.setTimeout(() => { updateText(); switchingLanguage = false; }, 380);
}
/** Shows a short, self-clearing feedback message. @param {string} content Toast text. @returns {void} */
/** Shows the shared task card for missing or rejected summary-provider credentials. */
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
  const rejected = /LLM request failed \(403\)|error code: 1010/i.test(String(error?.message || error));
  const copy = locale === 'zh'
    ? { title: rejected ? '纪要服务拒绝了请求' : '纪要模型需要配置', detail: rejected ? '请检查 API 地址、密钥和服务商访问策略。' : 'API Key 未配置、已失效或不匹配当前服务。', action: '配置纪要模型' }
    : { title: rejected ? 'Summary provider rejected the request' : 'Configure summary model', detail: rejected ? 'Check the API URL, key, and provider access policy.' : 'The API key is missing, invalid, or rejected by this provider.', action: 'Configure model' };
  card.innerHTML = `<header class="task-card-heading"><p>${copy.title}</p><button class="task-card-close" data-dismiss-task-card type="button" aria-label="关闭">×</button></header><strong>${copy.detail}</strong><button class="secondary" type="button">${copy.action}</button>`;
  card.querySelector('.secondary').onclick = () => {
    clearTimeout(summaryConfigDismissTimer);
    dismissTaskCard(card);
    editingSummaryModel = activeSummaryModel;
    openModal('summary-model');
  };
  summaryConfigDismissTimer = setTimeout(() => dismissTaskCard(card), 30000);
}
function isSummaryAuthenticationError(error) {
  return /LLM request failed \((401|403)\)|error code: 1010|API key|Authorization header|invalid_api_key|authentication/i.test(String(error.message));
}
/** Displays a transient message and, when supplied, one explicit safe next action. */
const showToast = (content, action) => {
  const message = document.createElement('span');
  message.textContent = content;
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
/** Marks the active meeting-library source and updates the window breadcrumb. @param {'all-meetings'|'recently-deleted'} id Navigation item ID. @returns {void} */
function selectLibraryNav(id) {
  if (id !== activeLibraryNav) clearMeetingSelection();
  activeLibraryNav = id;
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.id === id));
  crumb.textContent = id === 'recently-deleted' ? t('最近删除') : catalog[locale].views.home;
  const deleted = id === 'recently-deleted';
  homeEyebrow.className = deleted ? 'back' : 'eyebrow';
  homeEyebrow.disabled = !deleted;
  homeEyebrow.textContent = deleted ? BreviaI18n.trashCopy(locale).back : t('会议库');
  homePrimary.hidden = deleted;
  if (!deleted) homePrimary.innerHTML = `${t('开始会议')} <span>→</span>`;
  renderSlogan(false);
}
/** Runs the shared page-out/page-in transition around a view or content swap. */
async function transitionPage(current, next, swap) {
  if (current.classList.contains('leaving')) return;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
  current.classList.add('leaving');
  await new Promise((resolve) => window.setTimeout(resolve, duration));
  current.classList.remove('active', 'leaving');
  try {
    await swap();
  } finally {
    next.classList.remove('active', 'leaving');
    void next.offsetWidth;
    next.classList.add('active');
  }
}
/** Switches between top-level app views. @param {'home'|'prepare'|'live'|'detail'|'settings'} name Target view. */
const showView = async (name) => {
  if (name === activeView) return;
  if (activeView === 'prepare' && name !== 'prepare') await breviaClient?.stopPreview();
  const current = document.querySelector(`#${activeView}-view`);
  const next = document.querySelector(`#${name}-view`);
  await transitionPage(current, next, () => {
    activeView = name;
    crumb.textContent = catalog[locale].views[name];
    if (name === 'home') selectLibraryNav(activeLibraryNav);
    else document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  if (name === 'prepare') void previewMicrophone();
};
/** Switches meeting-library sources with the same page-out/page-in timing as top-level views. */
async function showLibraryNav(id) {
  const includeDeleted = id === 'recently-deleted';
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  if (activeView !== 'home') {
    selectLibraryNav(id);
    await showView('home');
    if (window.brevia) void refreshBackendMeetings(includeDeleted).catch((error) => showToast(error.message));
    return;
  }
  if (id === activeLibraryNav) return;
  const home = document.querySelector('#home-view');
  await transitionPage(home, home, () => {
    selectLibraryNav(id);
    if (window.brevia) void refreshBackendMeetings(includeDeleted).catch((error) => showToast(error.message));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
collectTranslations();
applyLanguage(locale);
applyTheme(theme);
window.setInterval(() => { if (activeLibraryNav === 'recently-deleted') return; sloganIndex = (sloganIndex + 1) % (slogans[locale] || slogans.en).length; renderSlogan(true); }, 30000);
updateButton.addEventListener('click', () => {
  updateButton.disabled = true;
  updateButton.textContent = (updateLabels[locale] || updateLabels.en).checking;
  window.setTimeout(() => { const copy = updateLabels[locale] || updateLabels.en; updateAvailable = false; updateDescription.textContent = copy.current; updateButton.textContent = copy.current; updateButton.disabled = false; renderUpdateNotice(); }, 700);
});
updateNoticeButton.addEventListener('click', () => { updateNoticeButton.textContent = (updateLabels[locale] || updateLabels.en).updating; updateNoticeButton.disabled = true; window.setTimeout(() => { const copy = updateLabels[locale] || updateLabels.en; updateAvailable = false; updateNotice.hidden = true; updateDescription.textContent = copy.current; updateButton.textContent = copy.current; }, 900); });
/** Closes the language menu and updates its disclosure state. @returns {void} */
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
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (activeModal) closeModal(); else { closeLanguageMenu(); languageToggle.focus(); } } });
/** Shows the compact live-meeting control when navigating away during recording. @returns {void} */
function minimizeMeeting() { miniTitle.textContent = document.querySelector('#live-name').textContent; miniTimer.textContent = document.querySelector('#timer').textContent; miniMeeting.hidden = false; requestAnimationFrame(syncFloatingNotices); }
document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (!target || ['all-meetings', 'recently-deleted'].includes(target.id)) return; if (target.dataset.view === 'home') selectLibraryNav('all-meetings'); if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting(); showView(target.dataset.view); });
homePrimary.addEventListener('click', () => showView('prepare'));
homeEyebrow.addEventListener('click', async () => {
  if (activeLibraryNav !== 'recently-deleted') return;
  await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
});
function activateMeeting(meeting, payload) {
  const { title, category, streaming_model_id: streamingModelId, speaker_segmentation_model_id: segmentationModelId, speaker_embedding_model_id: embeddingModelId, refined_model_id: refinedModelId } = payload;
  const streamingModelName = streamingModelId === 'zipformer-en-streaming-int8' ? 'Streaming Zipformer English' : streamingModelId === 'paraformer-zh-en-int8' ? 'Streaming Paraformer' : 'Streaming Zipformer Chinese XLarge';
  document.querySelector('#active-streaming-model').textContent = streamingModelName;
  document.querySelector('#active-diarization-model').textContent = prepareModelChoices['active-diarization-model'].find(([id]) => id === `${segmentationModelId || ''}|${embeddingModelId || ''}`)?.[1] || t('自动匹配');
  document.querySelector('#active-refined-model').textContent = refinedModelId === 'qwen3-asr-1.7b-int8' ? 'Qwen3-ASR 1.7B int8' : refinedModelId === 'qwen3-asr-0.6b-int8' ? 'Qwen3-ASR' : '自动匹配';
  document.querySelector('#live-name').textContent = title;
  uiData.meetings.unshift({ id: meeting.id, tone: 'violet', title, meta: `刚刚 · 0 分钟${category ? ` · ${category}` : ''}`, category, tags: [], status: { tone: 'processing', label: '正在录制', detail: '双轨录音' } });
  document.querySelector('#transcript-scroll').innerHTML = '';
  document.querySelector('#live-caption').textContent = '';
  document.querySelector('#live-caption-translation').hidden = true;
  latestLiveSegmentId = null;
  liveSpeakers.clear();
  liveSegments.clear();
  followLiveTranscript = true;
  renderLivePanel();
  renderMeetingList();
  meetingActive = true;
  seconds = 0;
  miniMeeting.hidden = true;
  syncFloatingNotices();
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
  const language = form.get('meeting-language') || 'auto';
  const targetLanguage = form.get('translation-target') || null;
  const streamingModelId = prepareForm.dataset.streamingModel || (language === 'en' ? 'zipformer-en-streaming-int8' : 'zipformer-zh-xlarge-streaming-int8');
  const refinedModelId = prepareForm.dataset.refinedModel || 'qwen3-asr-0.6b-int8';
  const segmentationModelId = prepareForm.dataset.segmentationModel || undefined;
  const embeddingModelId = prepareForm.dataset.embeddingModel || undefined;
  const payload = {
    title, language, target_language: targetLanguage, streaming_model_id: streamingModelId, refined_model_id: refinedModelId,
    speaker_segmentation_model_id: segmentationModelId, speaker_embedding_model_id: embeddingModelId,
    vad_model_id: prepareForm.dataset.vadModel || 'silero-vad', num_speakers: Number(form.get('num-speakers') || -1), category: form.get('meeting-category') || '',
  };
  const inputs = { mic: form.has('capture-mic'), system: form.has('capture-system') };
  try {
    const meeting = breviaClient ? await breviaClient.start(payload, inputs) : { id: null };
    if (meeting?.model_required) {
      queueModelTask('meeting.start', { ...payload, inputs }, meeting.model_required);
      return;
    }
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
importRecording.addEventListener('click', async () => {
  const form = new FormData(prepareForm);
  const title = meetingTitle.value.trim();
  if (!title) { meetingTitle.focus(); return; }
  importRecording.disabled = true;
  try {
    const meeting = window.brevia && await window.brevia.meeting.import({
      title, language: form.get('meeting-language') || 'auto', target_language: form.get('translation-target') || null,
      streaming_model_id: prepareForm.dataset.streamingModel || 'zipformer-zh-xlarge-streaming-int8', refined_model_id: prepareForm.dataset.refinedModel || 'qwen3-asr-0.6b-int8',
      speaker_segmentation_model_id: prepareForm.dataset.segmentationModel || undefined, speaker_embedding_model_id: prepareForm.dataset.embeddingModel || undefined,
      num_speakers: Number(form.get('num-speakers') || -1), category: form.get('meeting-category') || '', path: 'selected-by-electron',
    });
    if (!meeting) return;
    applyBackendDetail(meeting);
    await refreshBackendMeetings();
    showView('detail');
    showRefinementProgress(0, 0, meeting.title);
    void window.brevia.meeting.refine({ meeting_id: meeting.id }).catch((error) => { hideRefinementProgress(); showToast(error.message); });
  } catch (error) { showToast(error.message); } finally { importRecording.disabled = false; }
});
let seconds = 0;
let timer;
/** Starts the visible recording timer, replacing any prior timer. @returns {void} */
function startTimer() { clearInterval(timer); timer = setInterval(() => { seconds += 1; const value = new Date(seconds * 1000).toISOString().slice(11, 19); document.querySelector('#timer').textContent = value; miniTimer.textContent = value; }, 1000); }
document.querySelector('#pause').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const paused = button.dataset.paused === 'true';
  try {
    if (breviaClient) await breviaClient.pause(!paused);
    button.dataset.paused = String(!paused);
    button.textContent = paused ? `Ⅱ ${t('暂停')}` : `▶ ${t('继续')}`;
    if (paused) startTimer(); else clearInterval(timer);
  } catch (error) { showToast(error.message); }
});
document.querySelector('#end-meeting').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  clearInterval(timer);
  try {
    const meeting = breviaClient ? await breviaClient.stop(seconds * 1000) : null;
    meetingActive = false;
    miniMeeting.hidden = true;
    syncFloatingNotices();
    if (meeting) {
      applyBackendDetail(meeting);
      showRefinementProgress(0, 0, meeting.title);
      void window.brevia.meeting.refine({ meeting_id: meeting.id }).catch((error) => {
        hideRefinementProgress();
        showToast(`会后精修失败：${error.message}`);
      });
    }
    showView('detail');
    showToast(message('recordingSaved'));
    if (window.brevia) await refreshBackendMeetings();
  } catch (error) {
    showToast(error.message);
    startTimer();
  } finally { button.disabled = false; }
});
miniMeeting.addEventListener('click', () => { miniMeeting.hidden = true; syncFloatingNotices(); showView('live'); });
/** Replaces a speaker label with an inline editor and propagates the saved name. @param {HTMLElement} label Speaker-name element. @returns {void} */
function editSpeakerName(label) {
  const speaker = label.dataset.speaker;
  const input = document.createElement('input');
  input.className = 'speaker-name-input';
  input.value = label.textContent;
  input.maxLength = 32;
  const commit = () => {
    const name = input.value.trim() || `说话人 ${speaker}`;
    const nextLabel = document.createElement('b');
    nextLabel.dataset.speaker = speaker;
    nextLabel.title = '双击修改名称';
    nextLabel.textContent = name;
    input.replaceWith(nextLabel);
    if (liveSpeakers.has(speaker)) liveSpeakers.get(speaker).name = name;
    document.querySelectorAll(`[data-speaker="${speaker}"]`).forEach((node) => { node.textContent = name; });
    const meetingId = breviaClient?.state.meeting?.id || breviaClient?.state.selectedMeetingId;
    if (window.brevia && meetingId) window.brevia.speaker.rename({ meeting_id: meetingId, speaker_id: speaker, name }).catch((error) => showToast(error.message));
  };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); if (event.key === 'Escape') { input.value = label.textContent; input.blur(); } });
  label.replaceWith(input);
  input.focus();
  input.select();
}
document.querySelector('.live-panel').addEventListener('dblclick', (event) => {
  const label = event.target.closest('.person b[data-speaker]');
  if (label) editSpeakerName(label);
});
document.querySelector('#translation-toggle').addEventListener('click', (event) => {
  const enabled = event.currentTarget.dataset.enabled !== 'false';
  if (!enabled && window.brevia) {
    const config = summaryModels[activeSummaryModel];
    if (!config || !breviaClient?.state.meeting?.target_language) { showToast('请先选择译文目标并配置纪要模型'); return; }
    if (!confirm(`将确认字幕发送到 ${config.provider} 生成译文。是否继续？`)) return;
    translationAllowed = true;
  } else translationAllowed = false;
  event.currentTarget.dataset.enabled = String(!enabled);
  event.currentTarget.textContent = t(enabled ? '译文: 关' : '译文: 开');
  document.querySelectorAll('.translation').forEach((line) => { line.hidden = enabled; });
  const currentTranslation = document.querySelector('#live-caption-translation');
  currentTranslation.hidden = enabled || !currentTranslation.textContent;
});
meetingSearch.addEventListener('input', () => { if (window.brevia) refreshBackendMeetings().catch((error) => showToast(error.message)); else filterMeetings(); });
libraryToolbar.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) { const options = toggle.parentElement.querySelector('.flow-select-options'); const opening = options.hidden; libraryToolbar.querySelectorAll('.flow-select-options').forEach((list) => { list.hidden = true; list.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); }); options.hidden = !opening; toggle.setAttribute('aria-expanded', String(opening)); return; }
  const choice = event.target.closest('[data-flow-select-choice]');
  if (!choice) return;
  const select = choice.closest('.flow-select');
  select.querySelector('input').value = choice.dataset.value;
  select.querySelector('.flow-select-toggle').firstChild.nodeValue = choice.textContent;
  select.querySelector('.flow-select-options').hidden = true;
  select.querySelector('.flow-select-toggle').setAttribute('aria-expanded', 'false');
  if (choice.dataset.flowSelectChoice === 'library-category') { activeCategory = choice.dataset.value; filterMeetings(); } else { activeDateRange = choice.dataset.value; }
});
const meetingList = document.querySelector('.meeting-list');
const meetingSelectionSurface = document.querySelector('#home-view');
let dragSelection;
let suppressMeetingClick = false;
const toggleMeetingSelection = (row) => { const key = row.dataset.selectionKey; if (selectedMeetingKeys.has(key)) selectedMeetingKeys.delete(key); else selectedMeetingKeys.add(key); syncMeetingSelection(); };
meetingSelectionSurface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.clientY < libraryToolbar.getBoundingClientRect().top || event.target.closest('.meeting-actions, .batch-toolbar')) return;
  dragSelection = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, additive: event.shiftKey, initial: new Set(selectedMeetingKeys), moved: false, marquee: document.createElement('div') };
  dragSelection.marquee.className = 'selection-marquee';
});
meetingSelectionSurface.addEventListener('dragstart', (event) => event.preventDefault());
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
  document.querySelectorAll('.meeting-row:not([hidden])').forEach((row) => {
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
  const row = event.target.closest('.meeting-row');
  if (row && event.key === ' ') { event.preventDefault(); toggleMeetingSelection(row); }
});
batchToolbar.addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) { const options = toggle.parentElement.querySelector('.flow-select-options'); options.hidden = !options.hidden; toggle.setAttribute('aria-expanded', String(!options.hidden)); return; }
  const choice = event.target.closest('[data-flow-select-choice]');
  if (choice) {
    choice.closest('.flow-select-options').hidden = true;
    if (choice.dataset.value === '__choose') return;
    const meetings = selectedMeetings();
    meetings.forEach((meeting) => setMeetingCategory(meeting, choice.dataset.value));
    try {
      if (window.brevia) await Promise.all(meetings.filter(({ id }) => id).map(({ id, category }) => window.brevia.meeting.update({ meeting_id: id, updates: { category } })));
      renderMeetingList();
    } catch (error) { await refreshBackendMeetings(); showToast(error.message); }
    return;
  }
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
    const format = prompt('选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a', 'md')?.toLowerCase();
    if (!format) return;
    try {
      const result = window.brevia ? await window.brevia.meeting.exportMany({ meeting_ids: meetings.map(({ id }) => id).filter(Boolean), format }) : { paths: meetings.map(({ title }) => `${title}.${format}`) };
      if (result) showToast(`${t('导出')}: ${BreviaI18n.selectionOverview(locale, meetings.length)}`);
    } catch (error) { showToast(error.message); }
    return;
  }
  const permanently = activeLibraryNav === 'recently-deleted';
  const deleteLabel = permanently ? BreviaI18n.trashCopy(locale).purge : t('删除');
  if (event.target.closest('[data-batch-delete]') && confirm(`${BreviaI18n.selectionOverview(locale, meetings.length)}\n${deleteLabel}?`)) {
    try {
      await mutateMeetings(permanently ? 'purge' : 'delete', meetings);
    } catch (error) { await refreshBackendMeetings(); showToast(error.message); }
  }
});
const closeCategoryMenu = (menu, done) => { if (menu.hidden) { done?.(); return; } menu.classList.add('is-closing'); window.setTimeout(() => { menu.hidden = true; menu.classList.remove('is-closing'); done?.(); }, 180); };
const closeMeetingMenus = () => { document.querySelectorAll('.meeting-menu, .meeting-rename-menu').forEach((menu) => { menu.hidden = true; }); document.querySelectorAll('.meeting-category-menu').forEach((menu) => closeCategoryMenu(menu)); document.querySelectorAll('[data-meeting-menu]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false')); };
/** Runs one meeting mutation for both row actions and batch actions. */
async function mutateMeetings(action, meetings) {
  const ids = new Set(meetings.map(({ id }) => id).filter(Boolean));
  if (window.brevia) await Promise.all([...ids].map((meeting_id) => window.brevia.meeting[action]({ meeting_id })));
  if (['delete', 'restore', 'purge'].includes(action)) uiData.meetings = uiData.meetings.filter((meeting) => !ids.has(meeting.id));
  clearMeetingSelection();
  renderMeetingList();
}
async function openMeetingRow(row) {
  if (!window.brevia) { showView('detail'); return; }
  breviaClient.state.selectedMeetingId = row.dataset.meetingId;
  applyBackendDetail(await window.brevia.meeting.get({ meeting_id: row.dataset.meetingId }));
  showView('detail');
}
meetingList.addEventListener('click', async (event) => {
  if (suppressMeetingClick) { event.preventDefault(); event.stopImmediatePropagation(); return; }
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
  if (menuToggle) { const menu = actions.querySelector('.meeting-menu'); const opening = menu.hidden; closeMeetingMenus(); menu.hidden = !opening; menuToggle.setAttribute('aria-expanded', String(opening)); return; }
  if (event.target.closest('[data-cancel-rename]')) { actions.querySelector('.meeting-rename-menu').hidden = true; actions.querySelector('.meeting-menu').hidden = false; return; }
  const action = event.target.closest('[data-meeting-action]');
  if (action) {
    const index = Number(action.dataset.meetingIndex);
    const meeting = uiData.meetings[index];
    if (action.dataset.meetingAction === 'category') { actions.querySelector('.meeting-menu').hidden = true; actions.querySelector('.meeting-category-menu').hidden = false; return; }
    if (action.dataset.meetingAction === 'back') { closeCategoryMenu(actions.querySelector('.meeting-category-menu'), () => { actions.querySelector('.meeting-menu').hidden = false; }); return; }
    if (action.dataset.meetingAction === 'rename') { actions.querySelector('.meeting-menu').hidden = true; const rename = actions.querySelector('.meeting-rename-menu'); rename.hidden = false; rename.querySelector('input').focus(); rename.querySelector('input').select(); return; }
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
    if (action.dataset.meetingAction === 'export') { closeMeetingMenus(); if (window.brevia && meeting.id) window.brevia.meeting.export({ meeting_id: meeting.id, format: 'md' }).then((value) => value && showToast(`已导出「${meeting.title}」`)).catch((error) => showToast(error.message)); else showToast(`已导出「${meeting.title}」`); return; }
    if (action.dataset.meetingAction === 'delete') {
      try {
        await mutateMeetings('delete', [meeting]);
        showToast(meeting.isExample ? '示例会议及录音已删除' : '会议已移至最近删除');
      } catch (error) { showToast(error.message); }
      return;
    }
    if (action.dataset.meetingAction === 'restore') { try { await mutateMeetings('restore', [meeting]); showToast(t('恢复')); } catch (error) { showToast(error.message); } return; }
    if (action.dataset.meetingAction === 'purge' && confirm(`${BreviaI18n.trashCopy(locale).purge}?`)) { try { await mutateMeetings('purge', [meeting]); showToast(BreviaI18n.trashCopy(locale).purge); } catch (error) { showToast(error.message); } return; }
  }
  const category = event.target.closest('[data-assign-category]');
  if (category) { const meeting = uiData.meetings[Number(category.dataset.meetingIndex)]; setMeetingCategory(meeting, category.dataset.assignCategory); if (window.brevia && meeting.id) window.brevia.meeting.update({ meeting_id: meeting.id, updates: { category: meeting.category } }).catch((error) => showToast(error.message)); renderMeetingList(); return; }
  const deleteCategory = event.target.closest('[data-delete-meeting-category]');
  if (deleteCategory) { const category = deleteCategory.dataset.deleteMeetingCategory; uiData.meetings.filter((meeting) => meeting.category === category).forEach((meeting) => setMeetingCategory(meeting, '')); categories = categories.filter((name) => name !== category); if (activeCategory === category) activeCategory = ''; persistCategories(); renderCategoryFilter(); renderPrepareSelects(); renderMeetingList(); }
});
meetingList.addEventListener('submit', (event) => {
  if (event.target.matches('[data-rename-meeting]')) { event.preventDefault(); const title = new FormData(event.target).get('title').trim(); const meeting = uiData.meetings[Number(event.target.dataset.meetingIndex)]; if (title) { meeting.title = title; if (window.brevia && meeting.id) window.brevia.meeting.update({ meeting_id: meeting.id, updates: { title } }).catch((error) => showToast(error.message)); renderMeetingList(); } return; }
  if (!event.target.matches('[data-new-meeting-category]')) return;
  event.preventDefault();
  const category = new FormData(event.target).get('category').trim();
  if (!category || categories.some((name) => name.toLowerCase() === category.toLowerCase())) return;
  categories.push(category);
  persistCategories();
  renderCategoryFilter();
  renderPrepareSelects();
  renderMeetingList();
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.flow-select')) document.querySelectorAll('.flow-select-options:not([hidden])').forEach((options) => { options.hidden = true; options.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  if (!event.target.closest('.meeting-actions')) closeMeetingMenus();
});
const progress = document.querySelector('#progress');
const playerTime = document.querySelector('#player-time');
const playerAudio = new Audio();
const playButton = document.querySelector('#play');
const updatePlayerControl = () => {
  const playing = !playerAudio.paused && !playerAudio.ended;
  playButton.classList.toggle('is-playing', playing);
  playButton.textContent = playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-label', playing ? '暂停录音' : '播放录音');
};
/** Formats the audio progress control as an mm:ss display. @returns {void} */
const renderPlayerTime = () => { const value = Number(progress.value); playerTime.textContent = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
/** Highlights the transcript segment at the current playback time and keeps it centered in its own scroller. */
function syncPlaybackTranscript() {
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
  const bodyRect = body.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  body.scrollTo({
    top: body.scrollTop + activeRect.top - bodyRect.top - (body.clientHeight - activeRect.height) / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
progress.addEventListener('input', () => { renderPlayerTime(); playerAudio.currentTime = Number(progress.value); syncPlaybackTranscript(); });
document.addEventListener('click', (event) => { const button = event.target.closest('.jump'); if (button) { progress.value = button.dataset.time; playerAudio.currentTime = Number(button.dataset.time); renderPlayerTime(); syncPlaybackTranscript(); showToast(message('located')); } });
playButton.addEventListener('click', async () => {
  if (!playerAudio.src) { showToast('这场会议没有可播放的录音'); return; }
  if (playerAudio.paused) await playerAudio.play(); else playerAudio.pause();
  showToast(message(playerAudio.paused ? 'paused' : 'playing'));
});
playerAudio.addEventListener('play', updatePlayerControl);
playerAudio.addEventListener('pause', updatePlayerControl);
playerAudio.addEventListener('ended', updatePlayerControl);
playerAudio.addEventListener('timeupdate', () => { progress.value = playerAudio.currentTime; renderPlayerTime(); syncPlaybackTranscript(); });
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

function backendMeeting(item) {
  return {
    id: item.id,
    tone: 'violet',
    title: item.title,
    createdAt: item.created_at,
    durationMs: item.duration_ms,
    statusCode: item.status,
    meta: '',
    category: item.category,
    tags: item.tags,
    status: {},
    deleted: Boolean(item.deleted_at),
    isExample: Boolean(item.is_example),
    exampleLocale: item.example_locale,
  };
}

let meetingListRequest = 0;
async function refreshBackendMeetings(includeDeleted = activeLibraryNav === 'recently-deleted') {
  const request = ++meetingListRequest;
  const meetings = await window.brevia.meeting.list({ include_deleted: includeDeleted, query: meetingSearch.value.trim() });
  if (request !== meetingListRequest) return;
  uiData.meetings = meetings.map(backendMeeting);
  renderMeetingList();
}

let dualTrackAudios = [];
function renderDualTrackPanel(meeting) {
  dualTrackAudios.forEach((audio) => { audio.pause(); audio.removeAttribute('src'); });
  dualTrackAudios = [];
  const panel = document.querySelector('[data-detail-panel="tracks"]');
  if (!panel) return;
  const tracks = [
    ['vocals', t('人声轨'), meeting.audio.playback.vocals],
    ['accompaniment', t('非人声轨'), meeting.audio.playback.accompaniment],
  ].filter(([, , path]) => path);
  if (!tracks.length) {
    panel.innerHTML = `<div class="dual-track-empty"><p>${t('完成声源分离后，人声与非人声录音会显示在这里。')}</p><button class="secondary" type="button" data-separate-from-tracks>${t('开始声源分离')}</button></div>`;
    return;
  }
  panel.innerHTML = tracks.map(([id, label]) => `<section class="track-player" data-track-player="${id}"><header><b>${label}</b><small>WAV</small></header><div><button class="play" type="button" aria-label="${t('播放录音')}">▶</button><time>00:00</time><input type="range" min="0" max="1" value="0" aria-label="${label}" /></div></section>`).join('');
  tracks.forEach(async ([id, , path]) => {
    const root = panel.querySelector(`[data-track-player="${id}"]`);
    const button = root.querySelector('.play');
    const range = root.querySelector('input');
    const time = root.querySelector('time');
    const audio = new Audio();
    dualTrackAudios.push(audio);
    try { audio.src = await window.brevia.audioUrl(path); } catch (error) { showToast(error.message); return; }
    const update = () => {
      range.value = audio.currentTime;
      time.textContent = formatMeetingTime(audio.currentTime * 1000);
      button.textContent = audio.paused ? '▶' : '❚❚';
      button.classList.toggle('is-playing', !audio.paused);
    };
    button.addEventListener('click', async () => {
      dualTrackAudios.filter((item) => item !== audio).forEach((item) => item.pause());
      if (audio.paused) await audio.play(); else audio.pause();
      update();
    });
    range.addEventListener('input', () => { audio.currentTime = Number(range.value); update(); });
    audio.addEventListener('loadedmetadata', () => { range.max = audio.duration || 1; });
    audio.addEventListener('timeupdate', update);
    audio.addEventListener('play', update);
    audio.addEventListener('pause', update);
    audio.addEventListener('ended', update);
  });
}
document.querySelector('.final-transcript').addEventListener('click', (event) => {
  if (event.target.closest('[data-separate-from-tracks]')) { void startSeparation(); return; }
  const tab = event.target.closest('[data-detail-tab]');
  if (!tab) return;
  const target = tab.dataset.detailTab;
  document.querySelectorAll('[data-detail-tab]').forEach((item) => item.classList.toggle('active', item.dataset.detailTab === target));
  document.querySelectorAll('[data-detail-panel]').forEach((panel) => { panel.hidden = panel.dataset.detailPanel !== target; });
});

function applyBackendDetail(meeting) {
  currentMeetingDetail = meeting;
  const refined = meeting.segments.filter((segment) => segment.version.startsWith('postprocess'));
  const revision = refined.length ? Math.max(...refined.map((segment) => segment.revision)) : null;
  const base = revision === null ? meeting.segments.filter((segment) => segment.version === 'live') : refined.filter((segment) => segment.revision === revision);
  const latest = new Map();
  [...base, ...meeting.segments.filter((segment) => segment.version === 'user')].forEach((segment) => {
    if (!latest.has(segment.id) || segment.version === 'user') latest.set(segment.id, segment);
  });
  uiData.detail.transcript = [...latest.values()].sort((a, b) => a.start_ms - b.start_ms).map((segment) => ({
    time: `${String(Math.floor(segment.start_ms / 60000)).padStart(2, '0')}:${String(Math.floor(segment.start_ms / 1000) % 60).padStart(2, '0')}`,
    seconds: Math.floor(segment.start_ms / 1000),
    startSeconds: segment.start_ms / 1000,
    endSeconds: segment.end_ms / 1000,
    speaker: { name: segment.speaker_name },
    text: segment.text,
    translation: segment.translation,
  }));
  const summary = meeting.summary?.data;
  uiData.detail.summary = summary ? {
    title: summary.summary,
    sections: [
      { title: '决定', text: summary.decisions.map((item) => item.text).join('；') || '无' },
      { title: '待办', items: summary.action_items.map((item) => ({ text: item.task, speaker: item.owner || '待确认' })) },
    ],
    hasFull: true,
  } : { title: '', sections: [], empty: true };
  document.querySelector('#detail-view .detail-head h1').textContent = meeting.title;
  progress.max = Math.max(1, Math.ceil(meeting.duration_ms / 1000));
  progress.value = 0;
  playerAudio.pause();
  playerAudio.currentTime = 0;
  updatePlayerControl();
  renderPlayerTime();
  const audioPath = meeting.audio.playback.mix || meeting.audio.playback.mic || meeting.audio.playback.system;
  if (audioPath) window.brevia.audioUrl(audioPath).then((url) => { playerAudio.src = url; });
  else { playerAudio.removeAttribute('src'); playerAudio.load(); }
  renderMeetingDetail();
  renderDualTrackPanel(meeting);
}

async function startSeparation() {
  const meetingId = breviaClient?.state.selectedMeetingId;
  if (!window.brevia || !meetingId) return;
  if (!modelPaths.has('spleeter-2stems-fp16')) {
    queueModelTask('meeting.separate', { meeting_id: meetingId }, ['spleeter-2stems-fp16']);
    requiredModelIds.add('spleeter-2stems-fp16');
    renderRequiredModelsCard();
    return;
  }
  showSeparationProgress(0, 100);
  try {
    const result = await window.brevia.meeting.separate({ meeting_id: meetingId });
    if (result?.model_required) result.model_required.forEach((id) => requiredModelIds.add(id));
  } catch (error) {
    document.querySelector('#separation-progress')?.remove();
    showToast(error.message);
  }
}

if (window.brevia) {
  Promise.all([loadSummaryConfig(), breviaClient.initialize()]).then(([, result]) => {
    uiData.meetings = result.meetings.map(backendMeeting);
    speakerProfiles = result.speaker_profiles || [];
    presetVoices = result.preset_voices || [];
    termEntries = result.terms.map((item) => ({ id: item.id, name: item.text, detail: item.note || '自定义术语' }));
    installedModelNames.clear();
    modelPaths.clear();
    result.models.filter((model) => model.status === 'ready').forEach((model) => {
      installedModelNames.add(model.name.replace(' 0.6B int8', ''));
      if (model.path) modelPaths.set(model.id, model.path);
    });
    document.querySelector('#active-device').textContent = result.device.backend.toUpperCase();
    uiData.live.status[1].value = result.device.backend.toUpperCase();
    uiData.live.status[2].value = String(result.terms.length);
    renderLivePanel();
    const storageSizes = [result.storage.meetings, result.storage.models, result.storage.exports].map(formatBytes);
    Object.values(modalCopy).forEach((copy) => {
      copy.storage.items.forEach((item, index) => { item[1] = storageSizes[index]; });
    });
    renderTermOverview();
    renderSpeakerProfileCard();
    renderMeetingList();
    if (result.recoverable.length) showToast(`发现 ${result.recoverable.length} 场可恢复录音`);
  }).catch((error) => showToast(`配置或后端启动失败：${error.message}`));

  const transcript = document.querySelector('#transcript-scroll');
  const scrollLiveToLatest = (segment) => {
    if (!segment) return;
    transcript.scrollTop = transcript.scrollHeight;
  };
  transcript.addEventListener('wheel', () => { followLiveTranscript = false; }, { passive: true });
  transcript.addEventListener('pointerdown', () => { followLiveTranscript = false; });
  transcript.addEventListener('scroll', () => {
    if (Math.abs(transcript.scrollTop - (transcript.scrollHeight - transcript.clientHeight)) < 24) followLiveTranscript = true;
  }, { passive: true });
  const renderLiveEvent = (payload, partial) => {
    const shouldFollow = followLiveTranscript;
    if (!partial && !liveSpeakers.has(payload.speaker)) {
      const number = liveSpeakers.size + 1;
      liveSpeakers.set(payload.speaker, {
        id: String(number),
        speakerId: payload.speaker,
        name: '',
        source: payload.track === 'system' ? '系统音频' : '麦克风',
        avatar: number % 2 ? 'blue' : 'gray',
        level: '',
      });
      renderLivePanel();
    }
    const participant = liveSpeakers.get(payload.speaker);
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      speaker: { id: payload.speaker, name: participant?.name || `${t('说话人')} ${participant?.id || payload.speaker.split('-').pop()}` },
      text: payload.text,
      translation: payload.translation,
      partial,
    };
    latestLiveSegmentId = payload.segment_id;
    const currentCaption = document.querySelector('#live-caption');
    const currentTranslation = document.querySelector('#live-caption-translation');
    currentCaption.textContent = payload.text;
    currentCaption.scrollLeft = currentCaption.scrollWidth;
    currentCaption.classList.remove('caption-increment');
    void currentCaption.offsetWidth;
    currentCaption.classList.add('caption-increment');
    currentTranslation.hidden = !payload.translation || !translationAllowed;
    currentTranslation.textContent = payload.translation || '';
    const template = document.createElement('template');
    template.innerHTML = renderTranscriptSegment(entry);
    const previous = liveSegments.get(payload.segment_id);
    const element = template.content.firstElementChild;
    if (previous) previous.replaceWith(element);
    else transcript.append(element);
    liveSegments.set(payload.segment_id, element);
    transcript.querySelectorAll('.segment.is-active').forEach((segment) => {
      segment.classList.remove('is-active');
      segment.removeAttribute('aria-current');
    });
    element.classList.add('is-active');
    element.setAttribute('aria-current', 'true');
    if (shouldFollow) scrollLiveToLatest(element);
  };
  window.brevia.on('transcript.partial', (payload) => renderLiveEvent(payload, true));
  window.brevia.on('transcript.final', async (payload) => {
    renderLiveEvent(payload, false);
    if (!translationAllowed) return;
    const config = summaryModels[activeSummaryModel];
    try {
      await window.brevia.translation.generate({
        meeting_id: payload.meeting_id,
        segment_id: payload.segment_id,
        target_language: breviaClient.state.meeting.target_language,
        provider: config.provider,
        endpoint: config.endpoint,
        model: config.model,
        format: config.format,
        key_reference: config.keyReference,
        consent: true,
      });
    } catch (error) { showToast(`翻译失败：${error.message}`); }
  });
  window.brevia.on('transcript.discarded', ({ segment_id }) => {
    liveSegments.get(segment_id)?.remove();
    liveSegments.delete(segment_id);
  });
  window.brevia.on('translation.ready', (payload) => {
    const element = liveSegments.get(payload.segment_id);
    if (!element) return;
    let line = element.querySelector('.translation');
    if (!line) { line = document.createElement('p'); line.className = 'translation'; element.append(line); }
    line.textContent = payload.translation;
    if (payload.segment_id === latestLiveSegmentId) {
      const currentTranslation = document.querySelector('#live-caption-translation');
      currentTranslation.textContent = payload.translation;
      currentTranslation.hidden = !translationAllowed;
    }
  });
  window.brevia.on('refinement.started', ({ total }) => showRefinementProgress(0, total));
  window.brevia.on('refinement.progress', ({ completed, total }) => showRefinementProgress(completed, total));
  window.brevia.on('refinement.ready', ({ meeting }) => {
    const refineButton = document.querySelector('.detail-refine [data-flow-select-toggle]');
    refineButton.disabled = false;
    refineButton.innerHTML = `${t('精修')} <span>⌄</span>`;
    showRefinementComplete();
    if (meeting.id === breviaClient.state.selectedMeetingId) applyBackendDetail(meeting);
  });
  window.brevia.on('summary.started', ({ completed, total, stage }) => showSummaryProgress(completed, total, stage));
  window.brevia.on('summary.progress', ({ completed, total, stage }) => showSummaryProgress(completed, total, stage));
  window.brevia.on('summary.ready', () => showSummaryComplete());
  window.brevia.on('model.progress', ({ model_id, received, total }) => {
    if (!modelDownloads.has(model_id)) return;
    modelDownloads.set(model_id, { received, total });
    if (activeModal === 'models') renderModal('models');
    renderRequiredModelsCard();
  });
  window.brevia.on('model.status', ({ model_id, status, error }) => {
    const index = modelIds.indexOf(model_id);
    if (index < 0) return;
    if (status === 'ready') {
      const [, name, detail, intro, icon] = (modalCopy[locale] || modalCopy.en).models.items[index];
      installModel({ icon, name, detail, intro });
      modelDownloads.delete(model_id);
      requiredModelIds.delete(model_id);
      window.brevia.models.list().then((models) => {
        const model = models.find((item) => item.id === model_id);
        if (model?.path) modelPaths.set(model_id, model.path);
        if (activeModal === 'models') renderModal('models');
        renderRequiredModelsCard();
        void resumeReadyModelTasks();
      }).catch(() => {});
    } else if (status === 'failed' && modelDownloads.has(model_id)) modelDownloads.set(model_id, { error });
    else if (status === 'not_installed') modelPaths.delete(model_id);
    if (activeModal === 'models') renderModal('models');
    renderRequiredModelsCard();
  });
  window.brevia.on('worker.warning', ({ message: warning }) => showToast(warning));
  window.brevia.on('worker.error', ({ message: error }) => showToast(error));
  window.brevia.on('model.required', ({ models, task, payload }) => {
    if (task === 'meeting.refine') {
      hideRefinementProgress();
      const refineButton = document.querySelector('.detail-refine [data-flow-select-toggle]');
      refineButton.disabled = false;
      refineButton.innerHTML = `${t('精修')} <span>⌄</span>`;
    }
    if (task === 'meeting.separate') dismissTaskCard(document.querySelector('#separation-progress'));
    const queued = pendingModelTasks.get(`${task}:${payload?.meeting_id || 'new'}`);
    queueModelTask(task, task === 'meeting.start' && queued?.payload.inputs ? { ...payload, inputs: queued.payload.inputs } : payload, models);
    models.forEach((id) => requiredModelIds.add(id));
    renderRequiredModelsCard();
  });
  window.brevia.on('separation.started', ({ completed, total }) => showSeparationProgress(completed, total));
  window.brevia.on('separation.progress', ({ completed, total }) => showSeparationProgress(completed, total));
  window.brevia.on('meeting.sources-separated', async ({ meeting_id }) => {
    showSeparationComplete();
    if (meeting_id === breviaClient.state.selectedMeetingId) {
      applyBackendDetail(await window.brevia.meeting.get({ meeting_id }));
    }
  });
  window.brevia.on('speaker-profile.updated', async () => { speakerProfiles = await window.brevia.speakerProfile.list(); renderSpeakerProfileCard(); renderLivePanel(); });
  window.brevia.on('speaker-profile.deleted', async () => { speakerProfiles = await window.brevia.speakerProfile.list(); renderSpeakerProfileCard(); renderLivePanel(); });

  document.querySelector('#recently-deleted').addEventListener('click', async () => {
    await showLibraryNav('recently-deleted').catch((error) => showToast(error.message));
  });
  document.querySelector('#all-meetings').addEventListener('click', async () => {
    await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
  });

  async function generateMeetingSummary() {
    const config = summaryModels[activeSummaryModel];
    if (!config || !breviaClient.state.selectedMeetingId) { showSummaryConfigCard(); return; }
    showSummaryProgress(0, 100, '准备逐字稿');
    try {
      const summary = await window.brevia.summary.generate({
        meeting_id: breviaClient.state.selectedMeetingId,
        provider: config.provider,
        endpoint: config.endpoint,
        model: config.model,
        format: config.format,
        key_reference: config.keyReference,
        prompt: summaryPrompt,
        consent: true,
      });
      if (summary?.configuration_required) { hideSummaryProgress(); showSummaryConfigCard(); return; }
      const meeting = await window.brevia.meeting.get({ meeting_id: breviaClient.state.selectedMeetingId });
      meeting.summary = { data: summary };
      applyBackendDetail(meeting);
      dismissTaskCard(document.querySelector('#summary-config-required'));
      showSummaryComplete();
      showToast('会议纪要已生成');
    } catch (error) {
      hideSummaryProgress();
      if (isSummaryAuthenticationError(error)) showSummaryConfigCard(error);
      else showToast(error.message);
    }
  }
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-view-full-summary]')) { openModal('summary-detail'); return; }
    if (event.target.closest('[data-generate-summary]')) void generateMeetingSummary();
  });

  document.querySelector('[data-export-detail]').addEventListener('click', async () => {
    if (!breviaClient.state.selectedMeetingId) return;
    openModal('export');
  });

  document.querySelector('[data-separate-detail]').addEventListener('click', () => void startSeparation());

  document.querySelector('.detail-refine').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-flow-select-toggle]');
    const options = event.currentTarget.querySelector('.flow-select-options');
    if (toggle) {
      options.hidden = !options.hidden;
      toggle.setAttribute('aria-expanded', String(!options.hidden));
      return;
    }
    const choice = event.target.closest('[data-refine-model]');
    if (!choice || !breviaClient.state.selectedMeetingId) return;
    options.hidden = true;
    const button = event.currentTarget.querySelector('[data-flow-select-toggle]');
    button.disabled = true;
    button.textContent = t('正在精修');
    showRefinementProgress(0, 0, document.querySelector('#detail-view .detail-head h1').textContent);
    void window.brevia.meeting.refine({ meeting_id: breviaClient.state.selectedMeetingId, refined_model_id: choice.dataset.refineModel }).catch((error) => {
      button.disabled = false;
      button.innerHTML = `${t('精修')} <span>⌄</span>`;
      hideRefinementProgress();
      showToast(error.message);
    });
  });

  document.querySelector('[data-share-detail]').addEventListener('click', async () => {
    if (!breviaClient.state.selectedMeetingId) return;
    try {
      const result = await window.brevia.meeting.share({ meeting_id: breviaClient.state.selectedMeetingId });
      if (result) showToast(result.recording_included ? '压缩包已导出' : '未找到录音，已导出逐字稿压缩包');
    } catch (error) { showToast(error.message); }
  });
}
