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
const { catalog } = window.BreviaLocaleData;
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
const translatedNodes = [];
const stageLabels = {
  标点恢复: { zh: '标点恢复', en: 'Punctuation restoration', es: 'Restauración de puntuación' },
};
/** Resolves a display label for the active locale. @param {string} key Chinese source label. @returns {string} Localized label or the original key. */
const t = (key) => stageLabels[key]?.[locale] || catalog[locale].labels[key] || key;
/** Resolves a transient message for the active locale. @param {string} key Message identifier. @returns {string} Localized message. */
const message = (key) => catalog[locale].messages[key];
const defaultCategories = ['产品', '设计', '外部会议'];
let categories = JSON.parse(localStorage.getItem('brevia-categories') || 'null') || defaultCategories;
renderStaticViews();
const themeLabels = {
  zh: { light: '切换至浅色主题', dark: '切换至深色主题' },
  en: { light: 'Switch to light theme', dark: 'Switch to dark theme' },
  es: { light: 'Cambiar al tema claro', dark: 'Cambiar al tema oscuro' }
};
const updateLabels = {
  zh: { title: '软件更新', description: '当前版本 0.1.0', action: '检查更新', checking: '正在检查…', available: '发现新版本 0.2.0', update: '更新至 0.2.0', floating: '更新 Brevia', updating: '正在更新…', current: '已是最新版本' },
  en: { title: 'Software updates', description: 'Current version 0.1.0', action: 'Check for updates', checking: 'Checking…', available: 'Version 0.2.0 is available', update: 'Update to 0.2.0', floating: 'Update Brevia', updating: 'Updating…', current: 'Up to date' },
  es: { title: 'Actualizaciones', description: 'Versión actual 0.1.0', action: 'Buscar actualizaciones', checking: 'Comprobando…', available: 'La versión 0.2.0 está disponible', update: 'Actualizar a 0.2.0', floating: 'Actualizar Brevia', updating: 'Actualizando…', current: 'Ya está actualizado' }
};
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
/** Keeps the update notice above the mini meeting when both are visible. @returns {void} */
function syncFloatingNotices() { updateNotice.style.bottom = miniMeeting.hidden ? '' : `${miniMeeting.offsetHeight + 24}px`; }
/** Renders the floating update notice from current locale and availability state. @returns {void} */
function updateCopy() { return updateLabels[locale] || { ...updateLabels.en, title: t('软件更新'), description: t('当前版本 0.1.0'), action: t('检查更新') }; }
function renderUpdateNotice() { const copy = updateCopy(); updateNoticeText.textContent = copy.available; updateNoticeButton.textContent = copy.floating; updateNotice.hidden = !updateAvailable; requestAnimationFrame(syncFloatingNotices); }
/** Renders the settings-page update action from current locale and availability state. @returns {void} */
function renderUpdateButton() { const copy = updateCopy(); updateTitle.textContent = copy.title; updateDescription.textContent = updateAvailable ? copy.available : copy.description; updateButton.textContent = updateAvailable ? copy.update : copy.action; updateButton.disabled = false; }
const modalCopy = {
  zh: {
    models: { title: '模型库', intro: '所有转写模型都在本地运行，不会将您的隐私上传到网络。', languages: '建议语言', items: [['实时字幕', 'Streaming Paraformer', '中文 / 英语 / 粤语', '原生流式识别，持续更新当前字幕。', '⌁'], ['会后精修', 'Qwen3-ASR', '多语种', '基于完整录音生成高精度修订版本。', 'Q'], ['说话人分离', 'Pyannote Segmentation 3.0', '语言无关', '检测单轨录音中的说话区间。', 'P'], ['说话人分离', '3D-Speaker ERes2Net Base', '中文', '提取声纹并离线聚类说话人。', '3D']] },
    terms: { title: '管理术语库', intro: '术语用于会议准备、搜索和纪要。仅支持的模型会在转写中使用它们。', items: [['Brevia', '产品名称'], ['向量数据库', '技术术语'], ['CAM++', '说话人模型']], add: '添加术语', edit: '编辑', save: '保存', cancel: '取消', remove: '删除', placeholder: '输入术语或短语' },
    storage: { title: '本地存储', intro: '所有会议资料均保存在此设备。', items: [['会议与录音', '8.4 GB'], ['模型文件', '1.7 GB'], ['导出文件', '240 MB']] }, close: '关闭', download: '下载' },
  en: {
    models: { title: 'Model library', intro: 'All transcription models run locally. Your private data is never uploaded to the network.', languages: 'Recommended languages', items: [['Live captions', 'Streaming Paraformer', 'Chinese / English / Cantonese', 'Native streaming recognition that continuously updates the active caption.', '⌁'], ['Post-meeting refinement', 'Qwen3-ASR', 'Multilingual', 'Creates a high-accuracy revision from the complete recording.', 'Q'], ['Speaker diarization', 'Pyannote Segmentation 3.0', 'Language independent', 'Detects speaker regions in a single-track recording.', 'P'], ['Speaker diarization', '3D-Speaker ERes2Net Base', 'Chinese', 'Extracts speaker embeddings for offline clustering.', '3D']] },
    terms: { title: 'Manage terms', intro: 'Terms support meeting preparation, search, and notes. Only supported models use them in transcription.', items: [['Brevia', 'Product name'], ['Vector database', 'Technical term'], ['CAM++', 'Speaker model']], add: 'Add term', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete', placeholder: 'Enter a term or phrase' },
    storage: { title: 'Local storage', intro: 'All meeting data stays on this device.', items: [['Meetings and recordings', '8.4 GB'], ['Model files', '1.7 GB'], ['Exports', '240 MB']] }, close: 'Close', download: 'Download' },
  es: {
    models: { title: 'Biblioteca de modelos', intro: 'Todos los modelos de transcripción se ejecutan localmente. Tus datos privados nunca se suben a la red.', languages: 'Idiomas recomendados', items: [['Subtítulos en vivo', 'Streaming Paraformer', 'Chino / inglés / cantonés', 'Reconocimiento nativo en streaming que actualiza el subtítulo activo.', '⌁'], ['Refinamiento posterior', 'Qwen3-ASR', 'Multilingüe', 'Crea una revisión precisa a partir de la grabación completa.', 'Q'], ['Separación de hablantes', 'Pyannote Segmentation 3.0', 'Independiente del idioma', 'Detecta regiones de habla en una grabación de una pista.', 'P'], ['Separación de hablantes', '3D-Speaker ERes2Net Base', 'Chino', 'Extrae huellas de voz para agrupar hablantes sin conexión.', '3D']] },
    terms: { title: 'Gestionar términos', intro: 'Los términos sirven para preparar reuniones, buscar y crear notas. Solo los modelos compatibles los usan al transcribir.', items: [['Brevia', 'Nombre del producto'], ['Base de datos vectorial', 'Término técnico'], ['CAM++', 'Modelo de hablantes']], add: 'Añadir término', edit: 'Editar', save: 'Guardar', cancel: 'Cancelar', remove: 'Eliminar', placeholder: 'Escribe un término o frase' },
    storage: { title: 'Almacenamiento local', intro: 'Todos los datos de reuniones permanecen en este dispositivo.', items: [['Reuniones y grabaciones', '8.4 GB'], ['Archivos de modelos', '1.7 GB'], ['Exportaciones', '240 MB']] }, close: 'Cerrar', download: 'Descargar' }
};
const modelIds = [
  'paraformer-zh-en-int8',
  'qwen3-asr-0.6b-int8',
  'pyannote-segmentation-3.0',
  'eres2net-base-3dspeaker-zh',
];
const modelLabels = {
  zh: { manage: '管理模型库', download: '下载', downloading: '下载中…', installed: '已安装', remove: '删除' },
  en: { manage: 'Manage model library', download: 'Download', downloading: 'Downloading…', installed: 'Installed', remove: 'Delete' },
  es: { manage: 'Gestionar biblioteca de modelos', download: 'Descargar', downloading: 'Descargando…', installed: 'Instalado', remove: 'Eliminar' }
};
const summaryModelCopy = {
  zh: { title: '管理纪要模型', intro: '所有配置信息仅保存在本地，不会上传。', name: '配置名', provider: '供应商', key: 'API Key', endpoint: '请求地址', format: 'API 格式', model: '主模型', save: '保存配置', add: '新建配置', remove: '删除配置', configured: '已配置模型', active: '正在使用', promptTitle: '总结提示词', promptIntro: '该提示词将用于生成 AI 会议纪要。', jsonTitle: '配置 JSON', jsonIntro: '当前启用的纪要模型配置。', ollama: '本地 Ollama', openAIFormat: 'OpenAI 格式', claudeFormat: 'Claude 格式' },
  en: { title: 'Manage summary models', intro: 'All configuration stays on this device and is never uploaded.', name: 'Configuration name', provider: 'Provider', key: 'API Key', endpoint: 'Request URL', format: 'API format', model: 'Primary model', save: 'Save configuration', add: 'New configuration', remove: 'Delete configuration', configured: 'Configured models', active: 'In use', promptTitle: 'Summary prompt', promptIntro: 'This prompt is used to generate AI meeting notes.', jsonTitle: 'Configuration JSON', jsonIntro: 'The active summary model configuration.', ollama: 'Local Ollama', openAIFormat: 'OpenAI format', claudeFormat: 'Claude format' },
  es: { title: 'Gestionar modelos de resumen', intro: 'Toda la configuración se guarda en este dispositivo y no se carga.', name: 'Nombre de configuración', provider: 'Proveedor', key: 'API Key', endpoint: 'URL de solicitud', format: 'Formato de API', model: 'Modelo principal', save: 'Guardar configuración', add: 'Nueva configuración', remove: 'Eliminar configuración', configured: 'Modelos configurados', active: 'En uso', promptTitle: 'Prompt de resumen', promptIntro: 'Este prompt se usa para generar notas de reunión con IA.', jsonTitle: 'JSON de configuración', jsonIntro: 'La configuración activa del modelo de resumen.', ollama: 'Ollama local', openAIFormat: 'Formato OpenAI', claudeFormat: 'Formato Claude' }
};
const summaryProviders = ['OpenAI', 'Anthropic', 'Kimi', 'Zhipu GLM', 'MiniMax', 'DeepSeek', 'OpenRouter', 'Ollama'];
const defaultSummaryModels = [{ name: '配置-1', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', format: 'openai', model: 'gpt-4.1-mini' }];
const savedSummaryConfig = JSON.parse(localStorage.getItem('brevia-summary-config') || 'null');
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
/** Saves summary-model settings to this browser only. @returns {void} */
function persistSummaryConfig() {
  const models = summaryModels.map(({ apiKey, ...model }) => model);
  localStorage.setItem('brevia-summary-config', JSON.stringify({ models, active: activeSummaryModel, prompt: summaryPrompt, sequence: configSequence }));
}
const settingsModal = document.createElement('div');
settingsModal.className = 'modal-backdrop';
settingsModal.hidden = true;
settingsModal.innerHTML = '<section class="modal-panel" role="dialog" aria-modal="true"><header class="modal-head"><div class="modal-title"><h2></h2><p></p></div><button class="modal-close" type="button" aria-label="Close">×</button></header><div class="modal-body"></div></section>';
document.body.append(settingsModal);
let activeModal;
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
const meetingTitle = document.querySelector('#meeting-title');
let meetingTitleEdited = false;
/** Refreshes the starter title only until the user provides their own. @returns {void} */
function renderDefaultMeetingTitle() { if (!meetingTitleEdited) meetingTitle.value = BreviaI18n.defaultMeetingTitle(locale); }
meetingTitle.addEventListener('input', () => { meetingTitleEdited = true; });
/** Rebuilds meeting-language selectors while preserving their submitted values. @returns {void} */
function renderPrepareSelects() {
  const values = Object.fromEntries(new FormData(prepareForm));
  const categoryOptions = [['', t('未分类')], ...categories.map((name) => [name, name])];
  prepareForm.querySelector('.form-grid').innerHTML = `<label>${t('会议语言')}${flowSelect('meeting-language', values['meeting-language'] || 'auto', BreviaI18n.languageOptions(locale, t, true))}</label><label>${t('译文目标')}${flowSelect('translation-target', values['translation-target'] || '', BreviaI18n.languageOptions(locale, t))}</label><label>${t('分类标签')}${flowSelect('meeting-category', values['meeting-category'] || '', categoryOptions)}</label>`;
}
renderPrepareSelects();
if (breviaClient) {
  breviaClient.onLevel = (track, level) => {
    if (track === 'mic') document.querySelector('#mic-level').style.setProperty('--level', Math.max(.04, level));
  };
}
function showRefinementProgress(completed = 0, total = 0) {
  const copy = { title: t('正在精修'), detail: t('原版逐字稿仍可查看'), waiting: t('准备中') };
  const ratio = total ? Math.min(1, completed / total) : 0;
  refinementCard.hidden = false;
  refinementCard.querySelector('p').textContent = copy.title;
  refinementCard.querySelector('small').textContent = copy.detail;
  refinementPercent.textContent = total ? `${Math.round(ratio * 100)}%` : copy.waiting;
  refinementBar.style.transform = `scaleX(${ratio})`;
}
function hideRefinementProgress() { refinementCard.hidden = true; }
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
/** Renders one settings modal. @param {'models'|'terms'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
function renderModal(kind) {
  if (kind === 'summary-model') { renderSummaryModelModal(); return; }
  const copy = (modalCopy[locale] || modalCopy.en)[kind];
  const items = kind === 'terms' ? termEntries.map(({ name, detail }) => [name, detail === '自定义术语' ? t(detail) : detail]) : copy.items;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close);
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="modal-list${kind === 'models' ? ' model-library-list' : ''}">${items.map((item, index) => {
    const [name, detail] = kind === 'models' ? item.slice(1, 3) : item;
    const [stage, , , intro] = kind === 'models' ? item : [];
    const termEditing = kind === 'terms' && editingTermIndex === index;
    const label = termEditing ? `<input class="term-edit-input" data-edit-term-input="${index}" value="${escapeHtml(name)}" maxlength="64" />` : `<b>${escapeHtml(name)}</b>`;
    const actions = kind === 'models' ? `<button class="modal-action${isModelInstalled(name) ? ' modal-danger' : ''}" ${isModelInstalled(name) ? `data-delete-model="${index}"` : `data-download-model="${index}"`} type="button">${isModelInstalled(name) ? (modelLabels[locale] || modelLabels.en).remove : (modelLabels[locale] || modelLabels.en).download}</button>` : kind === 'terms' ? `<span class="term-actions">${termEditing ? `<button class="modal-action" data-save-term="${index}" type="button">${copy.save}</button><button class="modal-action" data-cancel-term type="button">${copy.cancel}</button>` : `<button class="modal-action" data-edit-term="${index}" type="button">${copy.edit}</button><button class="modal-action" data-remove-term="${index}" type="button">${copy.remove}</button>`}</span>` : '';
    const heading = kind === 'models' && (index === 0 || items[index - 1][0] !== stage) ? `<h3>${escapeHtml(stage)}</h3>` : '';
    return `${heading}<div><span>${label}<small>${escapeHtml(detail)}</small>${intro ? `<small>${escapeHtml(intro)}</small>` : ''}</span>${actions}</div>`;
  }).join('')}</div>${kind === 'terms' ? `<form class="term-form"><input name="term" required maxlength="64" placeholder="${copy.placeholder}" /><button type="submit">${copy.add}</button></form>` : ''}`;
}
/** Opens and focuses a settings modal. @param {'models'|'terms'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
function openModal(kind) { activeModal = kind; renderModal(kind); settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close); settingsModal.hidden = false; document.body.classList.add('modal-open'); settingsModal.querySelector('.modal-close').focus(); }
/** Closes the active settings modal and restores page scrolling. @returns {void} */
function closeModal() { activeModal = undefined; settingsModal.hidden = true; document.body.classList.remove('modal-open'); }
const settingsActions = [...document.querySelectorAll('#settings-view [data-settings-modal]')];
settingsActions.forEach((button) => button.addEventListener('click', () => openModal(button.dataset.settingsModal)));
const modelCard = document.querySelector('#installed-models');
const modelAction = document.querySelector('[data-settings-modal="models"]');
const installedModelNames = new Set([...modelCard.querySelectorAll('.model-row b')].map((name) => name.textContent));
/** Checks whether a model is installed locally. @param {string} name Model name. @returns {boolean} Whether the model exists in the installed set. */
function isModelInstalled(name) { return installedModelNames.has(name); }
/** Removes an installed model from the list and local state. @param {string} name Model name. @returns {void} */
function deleteInstalledModel(name) { const row = [...modelCard.querySelectorAll('.model-row')].find((item) => item.querySelector('b').textContent === name); if (row) row.remove(); installedModelNames.delete(name); }
/** Adds the per-row delete action if the row does not already have one. @param {HTMLElement} row Installed-model row. @returns {void} */
function attachModelDelete(row) {
  if (row.querySelector('.model-delete')) return;
  const button = document.createElement('button');
  button.className = 'model-delete';
  button.type = 'button';
  button.textContent = (modelLabels[locale] || modelLabels.en).remove;
  button.addEventListener('click', () => { deleteInstalledModel(row.querySelector('b').textContent); if (activeModal === 'models') renderModal('models'); });
  row.append(button);
}
/** Synchronizes installed-model actions after a locale or model-list change. @returns {void} */
function renderModelControls() {
  modelAction.textContent = (modelLabels[locale] || modelLabels.en).manage;
  modelCard.querySelectorAll('.model-row').forEach((row) => {
    attachModelDelete(row);
    row.querySelector('.model-delete').textContent = (modelLabels[locale] || modelLabels.en).remove;
    if (row.dataset.stage) row.querySelector('small').textContent = `${t(row.dataset.stage)} · ${row.dataset.languages}`;
  });
}
/** Inserts a newly downloaded model into the model-library card. @param {{icon: string, name: string, detail: string, intro: string}} model Downloaded model metadata. @returns {void} */
function installModel(model) {
  if (isModelInstalled(model.name)) return;
  const template = document.createElement('template');
  template.innerHTML = renderModelRow(model);
  const row = template.content.firstElementChild;
  if (model.stage) {
    row.dataset.stage = model.stage;
    row.dataset.languages = model.languages.join(' / ');
  }
  modelCard.insertBefore(row, modelAction);
  installedModelNames.add(model.name);
  attachModelDelete(row);
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
  const participants = [...liveSpeakers.values()];
  const people = participants.length
    ? participants.map((participant) => renderParticipant({
      ...participant,
      name: participant.name || `${t('说话人')} ${participant.id}`,
    })).join('')
    : `<p class="participants-empty">${t('等待识别说话人')}</p>`;
  document.querySelector('.live-panel').innerHTML = `<section><p class="eyebrow">${t('参与者')} · ${participants.length}</p>${people}</section><section><p class="eyebrow">${t('本场状态')}</p>${renderStatusList(uiData.live.status)}</section>`;
}
renderModelControls();
renderTermOverview();
renderLivePanel();
renderConfigPreview();
settingsModal.addEventListener('click', async (event) => {
  if (event.target === settingsModal || event.target.closest('.modal-close')) { closeModal(); return; }
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
    if (select.hasAttribute('data-active-summary-model')) { activeSummaryModel = Number(selectChoice.dataset.value); editingSummaryModel = activeSummaryModel; persistSummaryConfig(); renderModal('summary-model'); }
    return;
  }
  const addSummaryModel = event.target.closest('[data-new-summary-model]');
  if (addSummaryModel) { editingSummaryModel = -1; draftSummaryName = nextConfigName(); renderModal('summary-model'); return; }
  if (event.target.closest('[data-delete-summary-model]')) {
    summaryModels.splice(editingSummaryModel, 1);
    activeSummaryModel = summaryModels.length ? Math.min(activeSummaryModel, summaryModels.length - 1) : -1;
    editingSummaryModel = activeSummaryModel;
    draftSummaryName = summaryModels.length ? '' : nextConfigName();
    persistSummaryConfig();
    renderModal('summary-model');
    return;
  }
  const download = event.target.closest('[data-download-model]');
  if (download) {
    const index = Number(download.dataset.downloadModel);
    const [, name, detail, intro, icon] = (modalCopy[locale] || modalCopy.en).models.items[index];
    download.disabled = true;
    download.textContent = (modelLabels[locale] || modelLabels.en).downloading;
    try {
      if (window.brevia) await window.brevia.models.download({ model_id: modelIds[index] });
      installModel({ icon, name, detail, intro });
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
    } catch (error) { showToast(error.message); }
    renderModal('models');
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
    persistSummaryConfig();
    renderConfigPreview();
    renderModal('summary-model');
    return;
  }
  if (event.target.matches('.prompt-form')) {
    event.preventDefault();
    summaryPrompt = new FormData(event.target).get('prompt').trim();
    persistSummaryConfig();
    renderConfigPreview();
    renderModal('summary-model');
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
    renderModelControls();
    renderTermOverview();
    renderLivePanel();
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
const showToast = (content) => { toast.textContent = content; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400); };
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
  const current = document.querySelector(`#${activeView}-view`);
  const next = document.querySelector(`#${name}-view`);
  await transitionPage(current, next, () => {
    activeView = name;
    crumb.textContent = catalog[locale].views[name];
    if (name === 'home') selectLibraryNav(activeLibraryNav);
    else document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
};
/** Switches meeting-library sources with the same page-out/page-in timing as top-level views. */
async function showLibraryNav(id) {
  const includeDeleted = id === 'recently-deleted';
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  if (activeView !== 'home') {
    selectLibraryNav(id);
    if (window.brevia) await refreshBackendMeetings(includeDeleted);
    await showView('home');
    return;
  }
  if (id === activeLibraryNav) return;
  const home = document.querySelector('#home-view');
  await transitionPage(home, home, async () => {
    selectLibraryNav(id);
    if (window.brevia) await refreshBackendMeetings(includeDeleted);
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
document.querySelector('#meeting-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  const form = new FormData(event.currentTarget);
  const title = document.querySelector('#meeting-title').value.trim();
  const language = form.get('meeting-language') || 'auto';
  const targetLanguage = form.get('translation-target') || null;
  try {
    const meeting = breviaClient ? await breviaClient.start({
      title,
      language,
      target_language: targetLanguage,
      streaming_model_id: language === 'en' ? 'zipformer-en-streaming-int8' : 'paraformer-zh-en-int8',
      refined_model_id: 'qwen3-asr-0.6b-int8',
      category: form.get('meeting-category') || '',
    }, { mic: form.has('capture-mic'), system: form.has('capture-system') }) : { id: null };
    document.querySelector('#active-model-name').textContent = language === 'en' ? 'Streaming Zipformer English' : 'Streaming Paraformer';
    document.querySelector('#live-name').textContent = title;
    uiData.meetings.unshift({ id: meeting.id, tone: 'violet', title, meta: `刚刚 · 0 分钟${form.get('meeting-category') ? ` · ${form.get('meeting-category')}` : ''}`, category: form.get('meeting-category'), tags: [], status: { tone: 'processing', label: '正在录制', detail: '双轨录音' } });
    document.querySelector('#transcript-scroll').innerHTML = '';
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
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
});
let seconds = 0;
let timer;
/** Starts the visible recording timer, replacing any prior timer. @returns {void} */
function startTimer() { clearInterval(timer); timer = setInterval(() => { seconds += 1; const value = new Date(seconds * 1000).toISOString().slice(11, 19); document.querySelector('#timer').textContent = value; miniTimer.textContent = value; }, 1000); }
document.querySelector('#pause').addEventListener('click', async (event) => {
  const paused = event.currentTarget.dataset.paused === 'true';
  try {
    if (breviaClient) await breviaClient.pause(!paused);
    event.currentTarget.dataset.paused = String(!paused);
    event.currentTarget.textContent = paused ? `Ⅱ ${t('暂停')}` : `▶ ${t('继续')}`;
    if (paused) startTimer(); else clearInterval(timer);
  } catch (error) { showToast(error.message); }
});
document.querySelector('#end-meeting').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  clearInterval(timer);
  try {
    const meeting = breviaClient ? await breviaClient.stop(seconds * 1000) : null;
    meetingActive = false;
    miniMeeting.hidden = true;
    syncFloatingNotices();
    if (meeting) applyBackendDetail(meeting);
    showView('detail');
    showToast(message('recordingSaved'));
    if (window.brevia) await refreshBackendMeetings();
  } catch (error) {
    showToast(error.message);
    startTimer();
  } finally { event.currentTarget.disabled = false; }
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
    if (window.brevia && meetingId) window.brevia.speaker.rename({ meeting_id: meetingId, speaker_id: speaker.startsWith('spk-') ? speaker : `spk-${speaker}`, name }).catch((error) => showToast(error.message));
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
});
document.querySelector('#latest').addEventListener('click', () => {
  followLiveTranscript = true;
  document.querySelector('#transcript-scroll').scrollTo({ top: 9999, behavior: 'smooth' });
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
      if (window.brevia) await Promise.all(meetings.filter(({ id }) => id).map(({ id }) => window.brevia.meeting.restore({ meeting_id: id })));
      uiData.meetings = uiData.meetings.filter((meeting, index) => !selectedMeetingKeys.has(meeting.id || String(index)));
      clearMeetingSelection();
      renderMeetingList();
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
      if (window.brevia) await Promise.all(meetings.filter(({ id }) => id).map(({ id }) => window.brevia.meeting[permanently ? 'purge' : 'delete']({ meeting_id: id })));
      uiData.meetings = uiData.meetings.filter((meeting, index) => !selectedMeetingKeys.has(meeting.id || String(index)));
      clearMeetingSelection();
      renderMeetingList();
    } catch (error) { await refreshBackendMeetings(); showToast(error.message); }
  }
});
const closeCategoryMenu = (menu, done) => { if (menu.hidden) { done?.(); return; } menu.classList.add('is-closing'); window.setTimeout(() => { menu.hidden = true; menu.classList.remove('is-closing'); done?.(); }, 180); };
const closeMeetingMenus = () => { document.querySelectorAll('.meeting-menu, .meeting-rename-menu').forEach((menu) => { menu.hidden = true; }); document.querySelectorAll('.meeting-category-menu').forEach((menu) => closeCategoryMenu(menu)); document.querySelectorAll('[data-meeting-menu]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false')); };
meetingList.addEventListener('click', async (event) => {
  if (suppressMeetingClick) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  const selectionRow = event.target.closest('.meeting-row');
  if (selectionRow && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); toggleMeetingSelection(selectionRow); return; }
  const actions = event.target.closest('.meeting-actions');
  if (!actions) return;
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
    if (action.dataset.meetingAction === 'export') { closeMeetingMenus(); if (window.brevia && meeting.id) window.brevia.meeting.export({ meeting_id: meeting.id, format: 'md' }).then((value) => value && showToast(`已导出「${meeting.title}」`)).catch((error) => showToast(error.message)); else showToast(`已导出「${meeting.title}」`); return; }
    if (action.dataset.meetingAction === 'delete') {
      try {
        if (window.brevia && meeting.id) await window.brevia.meeting.delete({ meeting_id: meeting.id });
        uiData.meetings.splice(index, 1);
        renderMeetingList();
        showToast(meeting.isExample ? '示例会议及录音已删除' : '会议已移至最近删除');
      } catch (error) { showToast(error.message); }
      return;
    }
    if (action.dataset.meetingAction === 'restore') { if (window.brevia && meeting.id) window.brevia.meeting.restore({ meeting_id: meeting.id }).then(() => { uiData.meetings.splice(index, 1); renderMeetingList(); showToast('会议已恢复'); }).catch((error) => showToast(error.message)); return; }
    if (action.dataset.meetingAction === 'purge' && confirm(`${BreviaI18n.trashCopy(locale).purge}?`)) { if (window.brevia && meeting.id) window.brevia.meeting.purge({ meeting_id: meeting.id }).then(() => { uiData.meetings.splice(index, 1); renderMeetingList(); showToast(BreviaI18n.trashCopy(locale).purge); }).catch((error) => showToast(error.message)); return; }
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

function applyBackendDetail(meeting) {
  const versions = { live: 1, postprocess: 2, user: 3 };
  const latest = new Map();
  const baseVersion = meeting.status === 'refined' ? 'postprocess' : 'live';
  meeting.segments.filter((segment) => [baseVersion, 'user'].includes(segment.version)).forEach((segment) => {
    if (!latest.has(segment.id) || versions[segment.version] >= versions[latest.get(segment.id).version]) latest.set(segment.id, segment);
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
}

if (window.brevia) {
  Promise.all(legacySummaryKeys.map(({ reference, value }) => window.brevia.secret.set({ reference, value }))).then(persistSummaryConfig).catch((error) => showToast(`密钥迁移失败：${error.message}`));
  breviaClient.initialize().then((result) => {
    uiData.meetings = result.meetings.map(backendMeeting);
    termEntries = result.terms.map((item) => ({ id: item.id, name: item.text, detail: item.note || '自定义术语' }));
    installedModelNames.clear();
    modelCard.querySelectorAll('.model-row').forEach((row) => row.remove());
    result.models.filter((model) => model.status === 'ready').forEach((model) => installModel({
      icon: model.kind === 'qwen3' ? 'Q' : model.kind === 'speaker-segmentation' ? 'P' : model.kind === 'speaker-embedding' ? '3D' : '⌁',
      name: model.name.replace(' 0.6B int8', ''),
      detail: '',
      stage: model.stages.includes('streaming') ? '实时字幕' : model.stages.includes('diarization') ? '说话人分离' : model.stages.includes('punctuation') ? '标点恢复' : '会后精修',
      languages: model.languages.slice(0, 3),
    }));
    document.querySelector('#active-device').textContent = result.device.backend.toUpperCase();
    uiData.live.status[1].value = result.device.backend.toUpperCase();
    uiData.live.status[2].value = String(result.terms.length);
    renderLivePanel();
    const formatBytes = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    const storageSizes = [result.storage.meetings, result.storage.models, result.storage.exports].map(formatBytes);
    ['zh', 'en', 'es'].forEach((language) => {
      modalCopy[language].storage.items.forEach((item, index) => { item[1] = storageSizes[index]; });
    });
    renderTermOverview();
    renderMeetingList();
    if (result.recoverable.length) showToast(`发现 ${result.recoverable.length} 场可恢复录音`);
  }).catch((error) => showToast(`后端启动失败：${error.message}`));

  const transcript = document.querySelector('#transcript-scroll');
  const scrollLiveToLatest = () => { transcript.scrollTop = transcript.scrollHeight; };
  transcript.addEventListener('wheel', () => { followLiveTranscript = false; }, { passive: true });
  transcript.addEventListener('pointerdown', () => { followLiveTranscript = false; });
  transcript.addEventListener('scroll', () => {
    if (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 24) followLiveTranscript = true;
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
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      speaker: { id: payload.speaker, name: participant?.name || `${t('说话人')} ${participant?.id || payload.speaker.split('-').pop()}` },
      text: payload.text,
      translation: payload.translation,
      partial,
    };
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
    if (shouldFollow) scrollLiveToLatest();
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
  window.brevia.on('translation.ready', (payload) => {
    const element = liveSegments.get(payload.segment_id);
    if (!element) return;
    let line = element.querySelector('.translation');
    if (!line) { line = document.createElement('p'); line.className = 'translation'; element.append(line); }
    line.textContent = payload.translation;
  });
  window.brevia.on('asr.language', ({ language }) => {
    document.querySelector('#active-model-name').textContent = language === 'en' ? 'Streaming Zipformer English' : 'Streaming Paraformer';
  });
  window.brevia.on('refinement.started', ({ total }) => showRefinementProgress(0, total));
  window.brevia.on('refinement.progress', ({ completed, total }) => showRefinementProgress(completed, total));
  window.brevia.on('refinement.ready', ({ meeting }) => {
    hideRefinementProgress();
    if (meeting.id === breviaClient.state.selectedMeetingId) applyBackendDetail(meeting);
  });
  window.brevia.on('worker.warning', ({ message: warning }) => showToast(warning));
  window.brevia.on('worker.error', ({ message: error }) => showToast(error));

  meetingList.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-meeting-id]');
    if (!row || activeLibraryNav === 'recently-deleted' || event.target.closest('.meeting-actions')) return;
    try {
      breviaClient.state.selectedMeetingId = row.dataset.meetingId;
      applyBackendDetail(await window.brevia.meeting.get({ meeting_id: row.dataset.meetingId }));
    } catch (error) { showToast(error.message); }
  });

  document.querySelector('#recently-deleted').addEventListener('click', async () => {
    await showLibraryNav('recently-deleted').catch((error) => showToast(error.message));
  });
  document.querySelector('#all-meetings').addEventListener('click', async () => {
    await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
  });

  document.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-generate-summary]')) return;
    const config = summaryModels[activeSummaryModel];
    if (!config || !breviaClient.state.selectedMeetingId) { showToast('请先配置纪要模型'); return; }
    if (!confirm('将逐字稿发送到所选模型供应商以生成纪要。是否继续？')) return;
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
      const meeting = await window.brevia.meeting.get({ meeting_id: breviaClient.state.selectedMeetingId });
      meeting.summary = { data: summary };
      applyBackendDetail(meeting);
      showToast('会议纪要已生成');
    } catch (error) { showToast(error.message); }
  });

  document.querySelector('[data-refine-meeting]').addEventListener('click', async (event) => {
    if (!breviaClient.state.selectedMeetingId) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = t('正在精修…');
    showRefinementProgress();
    try {
      applyBackendDetail(await window.brevia.meeting.get({ meeting_id: breviaClient.state.selectedMeetingId }));
      applyBackendDetail(await window.brevia.meeting.refine({ meeting_id: breviaClient.state.selectedMeetingId }));
      showToast(t('会后精修已完成'));
    } catch (error) { showToast(error.message); }
    finally {
      hideRefinementProgress();
      button.disabled = false;
      button.textContent = t('会后精修');
    }
  });

  document.querySelector('[data-export-detail]').addEventListener('click', async () => {
    if (!breviaClient.state.selectedMeetingId) return;
    const format = prompt('选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a', 'md')?.toLowerCase();
    if (!format) return;
    const content = ['flac', 'wav', 'm4a'].includes(format) ? 'audio' : 'transcript';
    try {
      const result = await window.brevia.meeting.export({ meeting_id: breviaClient.state.selectedMeetingId, content, format });
      if (result) showToast('逐字稿已导出');
    } catch (error) { showToast(error.message); }
  });

  document.querySelector('[data-share-detail]').addEventListener('click', async () => {
    if (!breviaClient.state.selectedMeetingId) return;
    try {
      await window.brevia.meeting.share({ meeting_id: breviaClient.state.selectedMeetingId, content: 'transcript', format: 'md' });
    } catch (error) { showToast(error.message); }
  });
}
