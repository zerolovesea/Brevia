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
const stackableTaskCardSelector = ':scope > :is(.processing-card, .mini-meeting, .mini-playback):not([hidden])';
function syncTaskCardStack(active) {
  const cards = [...taskCards.querySelectorAll(stackableTaskCardSelector)];
  active ||= cards.at(-1);
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
  if (!card?.matches(':is(.processing-card, .mini-meeting, .mini-playback):not([hidden])') || card.classList.contains('task-card-leave')) return;
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
const { catalog, streamingModelOptionTags, aiNotePromptCopy, storageCleanupCopy, exportHubCopy, whatsNewLog, appCopy: { stageLabels, themeLabels, updateLabels, modalCopy, modelLabels, summaryModelCopy, speakerProfileCopy, voiceFeaturesCopy, aiAssistCopy, whatsNewCopy } } = window.BreviaLocaleData;
if (new URLSearchParams(location.search).has('resetOnboarding')) localStorage.removeItem('brevia-onboarding-complete');
let locale = localStorage.getItem('brevia-language') || 'zh';
let theme = localStorage.getItem('brevia-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let activeView = 'home';
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
let activeLibraryNav = 'all-meetings';
const liveSegments = new Map();
const liveSegmentRevisions = new Map();
// 实时字幕段落元数据（text/start_ms/speaker），供「加入笔记」等本地规则辅助读取。
const liveSegmentData = new Map();
const maxLiveSegments = 500;
let followLiveTranscript = true;
let toastTimer;
let switchingLanguage = false;
let meetingActive = false;
// 镜像当前会议的实时配置，使实时面板控件能够反映（并驱动）热切换。
let liveConfig = { language: 'auto', streaming_model_id: '', refined_model_id: '', target_language: null, power_saving: false };
// —— 性能模式 / 设备能力（弱机检测）——
const PERFORMANCE_MODE_KEY = 'brevia-performance-mode';
let deviceReport = null;
let perfBottleneckShownForMeeting = null; // 记录已提示过瓶颈弹窗的会议 id
/** 读取用户性能模式（标准 / 效率）。@returns {'standard'|'efficiency'} */
function getPerformanceMode() {
  const saved = localStorage.getItem(PERFORMANCE_MODE_KEY);
  if (saved === 'efficiency' || saved === 'standard') return saved;
  return deviceIsWeak() ? 'efficiency' : 'standard';
}
/** 保存性能模式。@param {'standard'|'efficiency'} mode 目标模式。@returns {void} */
function setPerformanceMode(mode) {
  localStorage.setItem(PERFORMANCE_MODE_KEY, mode === 'efficiency' ? 'efficiency' : 'standard');
}
/** 本机是否属于弱机（CPU 推理且核心少），前端据此建议更小模型/在线 API/效率模式。@returns {boolean} */
function deviceIsWeak() {
  return Boolean(deviceReport?.weak);
}
/** 当前 AI 辅助是否使用内置（本地）模型；在线 LLM 无需因瓶颈调低频率。@returns {boolean} */
function aiAssistIsBuiltIn() {
  const provider = aiAssistConfig?.provider;
  return provider === 'built-in' || provider === 'builtin';
}
// 此会议打开了哪些捕获轨道；此处不存在的轨道无法实时切换。
let translationAllowed = false;
let latestLiveSegmentId = null;
let editingMeetingIndex = null;
// 详情页状态：当前字幕视图（精修/原始）、激活 tab、编辑前笔记（取消时恢复）。
let detailTranscriptView = 'refined';
let detailActiveTab = 'notes';
let detailNotesBeforeEdit = '';
const translatedNodes = [];
let floatingCaptionMode = null;
let floatingCaptionLocale = locale;
/** 解析当前语言环境的显示标签。@param {string} key 中文源标签。@returns {string} 本地化后的标签或原始键。*/
const t = (key) => stageLabels[key]?.[locale] || stageLabels[key]?.en || catalog[locale].labels[key] || key;
/** 解析当前语言环境的临时消息。@param {string} key 消息标识符。@returns {string} 本地化后的消息。*/
const message = (key) => catalog[locale].messages[key];
/** 当前机器的推荐设置 tag 标记。@param {boolean} show 是否显示。@returns {string} */
const recommendTag = (show) => show ? `<span class="model-library-tags recommend-tags"><span class="model-library-installed">${escapeHtml(t('当前机器的推荐设置'))}</span></span>` : '';
function formatBytes(bytes = 0) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
function formatMeetingTime(milliseconds = 0) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
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
let currentMeetingDetail = null;
let modelCatalog = [];
const modelSize = (modelId) => modelCatalog.find((model) => model.id === modelId)?.size_bytes || 0;
const modelLibraryMetaCopy = {
  zh: { download: '下载', languages: '语言', compute: '运行', installed: '已安装', quality: '质量', speed: '速度', qualityTiers: ['标准', '高', '极高'], speedTiers: ['较慢', '均衡', '快'], streaming: '实时转写', refined: '会后精修', punctuation: '标点恢复', vad: '语音检测', denoise: '语音降噪', diarization: '说话人分离', voiceprint: '声纹识别', summary: '会议纪要', translation: '字幕翻译' },
  en: { download: 'Download', languages: 'Languages', compute: 'Compute', installed: 'Installed', quality: 'Quality', speed: 'Speed', qualityTiers: ['Standard', 'High', 'Very high'], speedTiers: ['Slower', 'Balanced', 'Fast'], streaming: 'Live transcription', refined: 'Post-meeting refinement', punctuation: 'Punctuation', vad: 'Voice detection', denoise: 'Noise reduction', diarization: 'Speaker diarization', voiceprint: 'Voiceprint recognition', summary: 'Meeting notes', translation: 'Caption translation' },
  es: { download: 'Descarga', languages: 'Idiomas', compute: 'Ejecución', installed: 'Instalado', quality: 'Calidad', speed: 'Velocidad', qualityTiers: ['Estándar', 'Alta', 'Muy alta'], speedTiers: ['Más lento', 'Equilibrado', 'Rápido'], streaming: 'Transcripción en vivo', refined: 'Refinamiento posterior', punctuation: 'Puntuación', vad: 'Detección de voz', denoise: 'Reducción de ruido', diarization: 'Separación de hablantes', voiceprint: 'Reconocimiento de voz', summary: 'Notas de reunión', translation: 'Traducción de subtítulos' },
  ja: { download: 'ダウンロード', languages: '言語', compute: '実行環境', installed: 'インストール済み', quality: '品質', speed: '速度', qualityTiers: ['標準', '高', '最高'], speedTiers: ['やや遅い', 'バランス', '高速'], streaming: 'ライブ文字起こし', refined: '会議後の高精度化', punctuation: '句読点復元', vad: '音声検出', denoise: 'ノイズ除去', diarization: '話者分離', voiceprint: '声紋認識', summary: '議事録', translation: '字幕翻訳' },
  ko: { download: '다운로드', languages: '언어', compute: '실행 환경', installed: '설치됨', quality: '품질', speed: '속도', qualityTiers: ['표준', '높음', '최고'], speedTiers: ['다소 느림', '균형', '빠름'], streaming: '실시간 전사', refined: '회의 후 정제', punctuation: '문장 부호', vad: '음성 감지', denoise: '노이즈 제거', diarization: '화자 분리', voiceprint: '음성 지문 인식', summary: '회의록', translation: '자막 번역' },
  fr: { download: 'Téléchargement', languages: 'Langues', compute: 'Exécution', installed: 'Installé', quality: 'Qualité', speed: 'Vitesse', qualityTiers: ['Standard', 'Élevée', 'Très élevée'], speedTiers: ['Plus lent', 'Équilibré', 'Rapide'], streaming: 'Transcription en direct', refined: 'Affinage après réunion', punctuation: 'Ponctuation', vad: 'Détection vocale', denoise: 'Réduction du bruit', diarization: 'Séparation des locuteurs', voiceprint: 'Reconnaissance vocale', summary: 'Notes de réunion', translation: 'Traduction des sous-titres' },
  de: { download: 'Download', languages: 'Sprachen', compute: 'Ausführung', installed: 'Installiert', quality: 'Qualität', speed: 'Geschwindigkeit', qualityTiers: ['Standard', 'Hoch', 'Sehr hoch'], speedTiers: ['Langsamer', 'Ausgewogen', 'Schnell'], streaming: 'Live-Transkription', refined: 'Nachbearbeitung', punctuation: 'Zeichensetzung', vad: 'Spracherkennung', denoise: 'Rauschunterdrückung', diarization: 'Sprechertrennung', voiceprint: 'Stimmabdruck-Erkennung', summary: 'Besprechungsnotizen', translation: 'Untertitelübersetzung' },
  ru: { download: 'Загрузка', languages: 'Языки', compute: 'Выполнение', installed: 'Установлено', quality: 'Качество', speed: 'Скорость', qualityTiers: ['Стандарт', 'Высокое', 'Очень высокое'], speedTiers: ['Медленнее', 'Сбалансированно', 'Быстро'], streaming: 'Потоковая расшифровка', refined: 'Обработка после встречи', punctuation: 'Пунктуация', vad: 'Обнаружение речи', denoise: 'Шумоподавление', diarization: 'Разделение говорящих', voiceprint: 'Распознавание голоса', summary: 'Протокол встречи', translation: 'Перевод субтитров' },
};
const modelStageMetaKey = { streaming: 'streaming', refined: 'refined', punctuation: 'punctuation', vad: 'vad', 'speech-enhancement': 'denoise', diarization: 'diarization', 'speaker-segmentation': 'diarization', 'speaker-embedding': 'voiceprint', summary: 'summary', translation: 'translation' };
// 精心设计的质量/速度评级（1..3 → 标准/高/极高，较慢/均衡/快），以便模型库可以突出
// 模型擅长的方面，而不是模型名称。基于公开基准测试（WER/CER、DER/WDER、EER、RTF、参数）；
// 参见模型库重新设计说明。这些值是编辑评判，而非清单字段。
const modelRatings = {
  'zipformer-en-streaming-int8': { quality: 2, speed: 3 },
  'zipformer-ko-streaming-int8': { quality: 2, speed: 3 },
  'zipformer-fr-streaming-int8': { quality: 2, speed: 3 },
  'nemotron-3.5-asr-streaming-0.6b-560ms-int8': { quality: 3, speed: 2 },
  'silero-vad': { quality: 3, speed: 3 },
  'online-punct-en-int8': { quality: 1, speed: 3 },
  'punct-ct-transformer-zh-en-int8': { quality: 2, speed: 3 },
  'qwen3-asr-0.6b-int8': { quality: 2, speed: 3 },
  'funasr-nano-int8': { quality: 2, speed: 3 },
  'whisper-large-v3': { quality: 2, speed: 1 },
  'pyannote-segmentation-3.0': { quality: 2, speed: 3 },
  'eres2net-base-3dspeaker-zh': { quality: 2, speed: 3 },
  'zipformer-zh-xlarge-streaming-int8': { quality: 3, speed: 1 },
  'x-asr-zh-en-streaming-480ms-int8': { quality: 2, speed: 3 },
  'gtcrn-live-denoiser': { quality: 2, speed: 3 },
  // Built-in summary (llama-chat) models.
  'qwen3.5-4b-q4km': { quality: 3, speed: 1 },
  'qwen3.5-2b-q4km': { quality: 3, speed: 2 },
  // 内置字幕翻译（llama-translation）。捆绑的 Hy-MT2 1.8B 在本地运行，兼顾速度与质量。
  'hy-mt2-1.8b-q4km': { quality: 3, speed: 3 },
};
// 内置纪要模型的编辑性单行描述，取自每个模型的公开
// 定位（参数、优势、硬件适配）。按模型 id 索引，然后按语言环境索引。
const builtinModelIntro = {
  'qwen3.5-4b-q4km': {
    zh: 'Qwen3.5 系列旗舰小模型，4B 参数即可媲美更大模型，中英文纪要质量最高，适合性能较强的设备。',
    en: 'Flagship of the Qwen3.5 small series. At 4B it rivals much larger models, giving the best Chinese/English notes. Best on a capable machine.',
    es: 'Buque insignia de la serie Qwen3.5. Con 4B rivaliza con modelos más grandes y ofrece las mejores notas en chino/inglés. Ideal para equipos potentes.',
    ja: 'Qwen3.5 小型シリーズの旗艦。4B ながら大型モデルに匹敵し、中英の議事録品質は最高。高性能な端末向け。',
    ko: 'Qwen3.5 소형 시리즈의 플래그십. 4B로도 더 큰 모델에 필적하며 중국어/영어 회의록 품질이 가장 높습니다. 고성능 기기에 적합.',
    fr: 'Fleuron de la série Qwen3.5. À 4B, il rivalise avec des modèles bien plus grands et offre les meilleures notes en chinois/anglais. Idéal sur une machine puissante.',
    de: 'Flaggschiff der Qwen3.5-Kleinserie. Mit 4B misst es sich mit viel größeren Modellen und liefert die besten Notizen auf Chinesisch/Englisch. Ideal für leistungsstarke Geräte.',
    ru: 'Флагман малой серии Qwen3.5. При 4B соперничает с гораздо более крупными моделями и даёт лучшие заметки на китайском/английском. Лучше на мощном устройстве.',
  },
  'qwen3.5-2b-q4km': {
    zh: 'Qwen3.5 2B 参数，质量与速度均衡，中英文纪要表现出色，适合大多数设备日常使用。',
    en: 'Qwen3.5 at 2B. A balance of quality and speed with strong Chinese/English notes. A solid everyday choice for most machines.',
    es: 'Qwen3.5 de 2B. Equilibrio entre calidad y velocidad con buenas notas en chino/inglés. Buena opción diaria para la mayoría de equipos.',
    ja: 'Qwen3.5 2B。品質と速度のバランスが良く、中英の議事録も優秀。ほとんどの端末で日常使いに最適。',
    ko: 'Qwen3.5 2B. 품질과 속도의 균형이 좋고 중국어/영어 회의록이 뛰어납니다. 대부분의 기기에서 일상용으로 적합.',
    fr: 'Qwen3.5 en 2B. Équilibre entre qualité et vitesse avec de bonnes notes en chinois/anglais. Un bon choix quotidien pour la plupart des machines.',
    de: 'Qwen3.5 mit 2B. Ausgewogen zwischen Qualität und Geschwindigkeit mit starken Notizen auf Chinesisch/Englisch. Solide Alltagswahl für die meisten Geräte.',
    ru: 'Qwen3.5 на 2B. Баланс качества и скорости с хорошими заметками на китайском/английском. Надёжный повседневный выбор для большинства устройств.',
  },
};
/** 渲染一个评级维度的 3 级质量/速度刻度。@param {string} label 本地化的维度标签。@param {number} level 等级 1-3。@param {string} tierWord 本地化的等级名称。@returns {string} */
function ratingScale(label, level, tierWord) {
  const dots = [1, 2, 3].map((step) => `<i${step <= level ? ' class="on"' : ''}></i>`).join('');
  return `<span class="model-library-rating"><small>${escapeHtml(label)}</small><b>${escapeHtml(tierWord)}</b><span class="rating-scale" aria-hidden="true">${dots}</span></span>`;
}
/** 渲染模型库卡片的精心设计的质量/速度评级行。@param {object|undefined} model 模型清单项。@returns {string} */
function renderModelLibraryRatings(model) {
  const rating = model && modelRatings[model.id];
  if (!rating) return '';
  const copy = modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en;
  return `<div class="model-library-ratings">${ratingScale(copy.quality, rating.quality, copy.qualityTiers[rating.quality - 1])}${ratingScale(copy.speed, rating.speed, copy.speedTiers[rating.speed - 1])}</div>`;
}
/** 渲染语言标题旁边显示的能力/大小/已安装/名称标签。模型名称在这个标签行中（而非单独一行），以便在不与标题竞争的情况下保持可识别性。下载大小在这里作为标签，而非单独的元数据行，并且运行环境标签已被删除。@param {object|undefined} model 模型清单项。@param {boolean} installed 模型是否在本地可用。@param {string} name 本地化的模型显示名称。@returns {string} */
function renderModelLibraryTags(model, installed, name) {
  if (!model) return '';
  const copy = modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en;
  const capabilities = [...new Set((model.stages || []).map((stage) => copy[modelStageMetaKey[stage]]).filter(Boolean))];
  const sizeTag = model.size_bytes ? `<span class="model-library-size">${escapeHtml(formatBytes(model.size_bytes))}</span>` : '';
  const nameTag = name ? `<span class="model-library-modelname">${escapeHtml(name)}</span>` : '';
  return `<div class="model-library-tags">${installed ? `<span class="model-library-installed">${copy.installed}</span>` : ''}${capabilities.map((capability) => `<span>${capability}</span>`).join('')}${sizeTag}${nameTag}</div>`;
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
function currentVersionLabel() { return ({ zh: '当前版本', en: 'Current version', es: 'Versión actual', ja: '現在のバージョン', ko: '현재 버전', fr: 'Version actuelle', de: 'Aktuelle Version', ru: 'Текущая версия' })[locale] || 'Current version'; }
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
const modelIds = [
  'zipformer-zh-xlarge-streaming-int8',
  'x-asr-zh-en-streaming-480ms-int8',
  'zipformer-en-streaming-int8',
  'zipformer-ko-streaming-int8',
  'zipformer-fr-streaming-int8',
  'nemotron-3.5-asr-streaming-0.6b-560ms-int8',
  'silero-vad',
  'online-punct-en-int8',
  'punct-ct-transformer-zh-en-int8',
  'qwen3-asr-0.6b-int8',
  'funasr-nano-int8',
  'whisper-large-v3',
  'pyannote-segmentation-3.0',
  'eres2net-base-3dspeaker-zh',
  'gtcrn-live-denoiser',
  'hy-mt2-1.8b-q4km',
];
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
let summaryConfig = { version: 2, provider: 'built-in', providers: {} };
// 配置写入版本号：loadSummaryConfig 读取期间若发生保存，旧值作废（防覆盖竞态）。
let summaryConfigRevision = 0;
let summaryConfigDraft = null;
// 内置供应商在表单里待选的模型。重新渲染（下载/删除/选择）时存活，切换供应商时重置。
let selectedBuiltinModel = '';
let selectedAiAssistBuiltinModel = '';
// onboarding 里选了「在线 AI 供应商」后，供应商下拉不再列出「内置 AI」，
// 避免在线配置流程里混入本地内置选项。关闭模态框时复位。
let onboardingOnlineProvider = false;
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
function summaryRequestConfig() { return requestConfig(summaryConfig); }
function speakerProfileName(profile) {
  return profile.name;
}
/** 返回保存在应用数据目录中的非机密纪要配置。*/
function currentSummaryConfig() {
  return { version: 2, provider: summaryConfig.provider, providers: summaryConfig.providers };
}
/** 在浏览器存储之外保存纪要模型设置；密钥保留在 Electron 安全存储中。*/
async function persistSummaryConfig() {
  await window.brevia?.summary.config.save(currentSummaryConfig());
}
/** 应用已读取的配置；只认 version 2，其余一律回落到默认的内置供应商。*/
function applySummaryConfig(config) {
  summaryConfig = {
    version: 2,
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
settingsModal.innerHTML = '<section class="modal-panel" role="dialog" aria-modal="true"><header class="modal-head"><div class="modal-title"><h2></h2><p></p></div><button class="modal-close" type="button" aria-label="Close">×</button></header><div class="modal-body"></div></section>';
document.body.append(settingsModal);
let activeModal;
let summaryEditing = false;
let summaryEditor = null;
let editingSegmentSpeakerId;
let advancedSettings;
let permissionStatus;
let permissionPollTimer;
const advancedSettingCopy = {
  zh: { sections: { audio: '音频', asr: '识别与端点检测', live_asr: '实时识别', punctuation: '标点恢复', diarization: '说话人分离', voice_profiles: '声纹库', meetings: '会议', llm: '纪要模型' }, fields: { sample_rate: '采样率（Hz）', chunk_seconds: '音频分块时长（秒）', endpoint_rule1_silence: '端点规则 1 静音时长（秒）', endpoint_rule2_silence: '端点规则 2 静音时长（秒）', maximum_utterance_seconds: '单句最长时长（秒）', refined_window_seconds: '精修窗口时长（秒）', auto_english_model_id: '英文识别模型', denoiser_model_id: '实时降噪模型', denoiser_enabled: '实时降噪开关（0 关 1 开）', denoise_minimum_rms: '实时降噪最小响度', always_record_system_audio: '始终录制系统音频（0 自动待命 1 始终录制）', microphone_target_rms: '麦克风目标响度', microphone_minimum_rms: '麦克风最小响度', microphone_max_gain: '麦克风最大增益', microphone_peak: '麦克风峰值限制', english_model_id: '英文标点模型', chinese_model_id: '中英文标点模型', segmentation_model_id: '说话区间模型', cluster_threshold: '聚类阈值', online_similarity_threshold: '在线匹配阈值', minimum_embedding_seconds: '最短声纹语音（秒）', num_speakers: '固定说话人数（-1 为自动）', min_duration_on: '最短说话时长（秒）', min_duration_off: '最短静音间隔（秒）', max_samples: '每人最大录音条数', max_total_seconds: '每人最大录音时长（秒）', deleted_retention_days: '删除记录保留天数', timeout_seconds: '模型请求超时（秒）' }, hint: '用于本地运行配置。' },
  en: { sections: { audio: 'Audio', asr: 'Recognition and endpointing', live_asr: 'Live recognition', punctuation: 'Punctuation', diarization: 'Speaker diarization', voice_profiles: 'Voiceprints', meetings: 'Meetings', llm: 'Summary model' }, fields: { sample_rate: 'Sample rate (Hz)', chunk_seconds: 'Audio chunk duration (s)', endpoint_rule1_silence: 'Endpoint rule 1 silence (s)', endpoint_rule2_silence: 'Endpoint rule 2 silence (s)', maximum_utterance_seconds: 'Maximum utterance duration (s)', refined_window_seconds: 'Refinement window (s)', auto_english_model_id: 'English recognition model', denoiser_model_id: 'Live denoiser model', denoiser_enabled: 'Live denoiser (0 off, 1 on)', denoise_minimum_rms: 'Live denoiser min loudness', always_record_system_audio: 'Always record system audio (0 auto-standby, 1 always)', microphone_target_rms: 'Microphone target loudness', microphone_minimum_rms: 'Microphone minimum loudness', microphone_max_gain: 'Microphone maximum gain', microphone_peak: 'Microphone peak limit', english_model_id: 'English punctuation model', chinese_model_id: 'Chinese-English punctuation model', segmentation_model_id: 'Speech-segmentation model', cluster_threshold: 'Clustering threshold', online_similarity_threshold: 'Online matching threshold', minimum_embedding_seconds: 'Minimum voiceprint audio (s)', num_speakers: 'Fixed speaker count (-1 = auto)', min_duration_on: 'Minimum speech duration (s)', min_duration_off: 'Minimum silence gap (s)', max_samples: 'Maximum recordings per person', max_total_seconds: 'Maximum recording duration per person (s)', deleted_retention_days: 'Deleted-record retention (days)', timeout_seconds: 'Model request timeout (s)' }, hint: 'Used by the local runtime.' },
  es: { sections: { audio: 'Audio', asr: 'Reconocimiento y detección de final', live_asr: 'Reconocimiento en vivo', punctuation: 'Puntuación', diarization: 'Separación de hablantes', voice_profiles: 'Huellas de voz', meetings: 'Reuniones', llm: 'Modelo de resumen' }, fields: { sample_rate: 'Frecuencia de muestreo (Hz)', chunk_seconds: 'Duración del bloque de audio (s)', endpoint_rule1_silence: 'Silencio de regla de final 1 (s)', endpoint_rule2_silence: 'Silencio de regla de final 2 (s)', maximum_utterance_seconds: 'Duración máxima de intervención (s)', refined_window_seconds: 'Ventana de refinamiento (s)', auto_english_model_id: 'Modelo de reconocimiento en inglés', denoiser_model_id: 'Modelo de reducción de ruido en vivo', microphone_target_rms: 'Volumen objetivo del micrófono', microphone_minimum_rms: 'Volumen mínimo del micrófono', microphone_max_gain: 'Ganancia máxima del micrófono', microphone_peak: 'Límite de pico del micrófono', english_model_id: 'Modelo de puntuación en inglés', chinese_model_id: 'Modelo de puntuación chino-inglés', segmentation_model_id: 'Modelo de segmentación de voz', cluster_threshold: 'Umbral de agrupación', online_similarity_threshold: 'Umbral de coincidencia en línea', minimum_embedding_seconds: 'Audio mínimo para huella de voz (s)', num_speakers: 'Número fijo de hablantes (-1 = auto)', min_duration_on: 'Duración mínima de habla (s)', min_duration_off: 'Pausa mínima (s)', max_samples: 'Máximas grabaciones por persona', max_total_seconds: 'Duración máxima por persona (s)', deleted_retention_days: 'Retención de eliminados (días)', timeout_seconds: 'Tiempo de espera de solicitud (s)' }, hint: 'Se usa en la ejecución local.' },
  ja: { sections: { audio: '音声', asr: '認識と終端検出', live_asr: 'ライブ認識', punctuation: '句読点', diarization: '話者分離', voice_profiles: '声紋', meetings: '会議', llm: '要約モデル' }, fields: { sample_rate: 'サンプリングレート（Hz）', chunk_seconds: '音声チャンク長（秒）', endpoint_rule1_silence: '終端ルール 1 の無音（秒）', endpoint_rule2_silence: '終端ルール 2 の無音（秒）', maximum_utterance_seconds: '発話の最大長（秒）', refined_window_seconds: '高精度化ウィンドウ（秒）', auto_english_model_id: '英語認識モデル', denoiser_model_id: 'ライブノイズ除去モデル', microphone_target_rms: 'マイク目標音量', microphone_minimum_rms: 'マイク最小音量', microphone_max_gain: 'マイク最大ゲイン', microphone_peak: 'マイクピーク上限', english_model_id: '英語句読点モデル', chinese_model_id: '中英句読点モデル', segmentation_model_id: '音声区間モデル', cluster_threshold: 'クラスタリング閾値', online_similarity_threshold: 'オンライン一致閾値', minimum_embedding_seconds: '声紋用の最短音声（秒）', num_speakers: '固定話者数（-1 = 自動）', min_duration_on: '最短発話時間（秒）', min_duration_off: '最短無音間隔（秒）', max_samples: '1 人あたりの最大録音数', max_total_seconds: '1 人あたりの最大録音時間（秒）', deleted_retention_days: '削除済み記録の保持日数', timeout_seconds: 'モデル要求タイムアウト（秒）' }, hint: 'ローカル実行に使用します。' },
  ko: { sections: { audio: '오디오', asr: '인식 및 종점 감지', live_asr: '실시간 인식', punctuation: '문장 부호', diarization: '화자 분리', voice_profiles: '음성 지문', meetings: '회의', llm: '요약 모델' }, fields: { sample_rate: '샘플링 레이트(Hz)', chunk_seconds: '오디오 청크 길이(초)', endpoint_rule1_silence: '종점 규칙 1 무음(초)', endpoint_rule2_silence: '종점 규칙 2 무음(초)', maximum_utterance_seconds: '최대 발화 길이(초)', refined_window_seconds: '정교화 창(초)', auto_english_model_id: '영어 인식 모델', denoiser_model_id: '실시간 잡음 제거 모델', microphone_target_rms: '마이크 목표 음량', microphone_minimum_rms: '마이크 최소 음량', microphone_max_gain: '마이크 최대 게인', microphone_peak: '마이크 피크 제한', english_model_id: '영어 문장 부호 모델', chinese_model_id: '중영 문장 부호 모델', segmentation_model_id: '음성 구간 모델', cluster_threshold: '클러스터링 임계값', online_similarity_threshold: '온라인 일치 임계값', minimum_embedding_seconds: '최소 음성 지문 오디오(초)', num_speakers: '고정 화자 수(-1 = 자동)', min_duration_on: '최소 발화 시간(초)', min_duration_off: '최소 무음 간격(초)', max_samples: '1인당 최대 녹음 수', max_total_seconds: '1인당 최대 녹음 시간(초)', deleted_retention_days: '삭제 기록 보관 기간(일)', timeout_seconds: '모델 요청 시간 제한(초)' }, hint: '로컬 실행에 사용됩니다.' },
  fr: { sections: { audio: 'Audio', asr: 'Reconnaissance et détection de fin', live_asr: 'Reconnaissance en direct', punctuation: 'Ponctuation', diarization: 'Séparation des locuteurs', voice_profiles: 'Empreintes vocales', meetings: 'Réunions', llm: 'Modèle de résumé' }, fields: { sample_rate: 'Fréquence d’échantillonnage (Hz)', chunk_seconds: 'Durée du bloc audio (s)', endpoint_rule1_silence: 'Silence règle de fin 1 (s)', endpoint_rule2_silence: 'Silence règle de fin 2 (s)', maximum_utterance_seconds: 'Durée maximale de parole (s)', refined_window_seconds: 'Fenêtre d’affinage (s)', auto_english_model_id: 'Modèle de reconnaissance anglaise', denoiser_model_id: 'Modèle de débruitage en direct', microphone_target_rms: 'Volume cible du microphone', microphone_minimum_rms: 'Volume minimal du microphone', microphone_max_gain: 'Gain maximal du microphone', microphone_peak: 'Limite de crête du microphone', english_model_id: 'Modèle de ponctuation anglaise', chinese_model_id: 'Modèle de ponctuation chinois-anglais', segmentation_model_id: 'Modèle de segmentation de parole', cluster_threshold: 'Seuil de regroupement', online_similarity_threshold: 'Seuil de correspondance en ligne', minimum_embedding_seconds: 'Audio minimal pour empreinte (s)', num_speakers: 'Nombre fixe de locuteurs (-1 = auto)', min_duration_on: 'Durée minimale de parole (s)', min_duration_off: 'Pause minimale (s)', max_samples: 'Enregistrements maximum par personne', max_total_seconds: 'Durée maximale par personne (s)', deleted_retention_days: 'Conservation des éléments supprimés (jours)', timeout_seconds: 'Délai de requête du modèle (s)' }, hint: 'Utilisé par l’exécution locale.' },
  de: { sections: { audio: 'Audio', asr: 'Erkennung und Endpunkterkennung', live_asr: 'Live-Erkennung', punctuation: 'Zeichensetzung', diarization: 'Sprechertrennung', voice_profiles: 'Stimmabdrücke', meetings: 'Besprechungen', llm: 'Zusammenfassungsmodell' }, fields: { sample_rate: 'Abtastrate (Hz)', chunk_seconds: 'Audioblockdauer (s)', endpoint_rule1_silence: 'Stille für Endpunktregel 1 (s)', endpoint_rule2_silence: 'Stille für Endpunktregel 2 (s)', maximum_utterance_seconds: 'Maximale Äußerungsdauer (s)', refined_window_seconds: 'Nachbearbeitungsfenster (s)', auto_english_model_id: 'Englisches Erkennungsmodell', denoiser_model_id: 'Live-Entrauschungsmodell', microphone_target_rms: 'Mikrofon-Ziellautstärke', microphone_minimum_rms: 'Mikrofon-Mindestlautstärke', microphone_max_gain: 'Maximale Mikrofonverstärkung', microphone_peak: 'Mikrofon-Peakgrenze', english_model_id: 'Englisches Zeichensetzungsmodell', chinese_model_id: 'Chinesisch-englisches Zeichensetzungsmodell', segmentation_model_id: 'Sprachsegmentierungsmodell', cluster_threshold: 'Cluster-Schwellenwert', online_similarity_threshold: 'Online-Abgleichschwelle', minimum_embedding_seconds: 'Minimales Stimmabdruck-Audio (s)', num_speakers: 'Feste Sprecherzahl (-1 = auto)', min_duration_on: 'Minimale Sprechdauer (s)', min_duration_off: 'Minimale Stille (s)', max_samples: 'Maximale Aufnahmen pro Person', max_total_seconds: 'Maximale Aufnahmezeit pro Person (s)', deleted_retention_days: 'Aufbewahrung gelöschter Einträge (Tage)', timeout_seconds: 'Zeitüberschreitung der Modellanfrage (s)' }, hint: 'Wird von der lokalen Laufzeit verwendet.' },
  ru: { sections: { audio: 'Аудио', asr: 'Распознавание и определение конца', live_asr: 'Распознавание в реальном времени', punctuation: 'Пунктуация', diarization: 'Разделение говорящих', voice_profiles: 'Голосовые отпечатки', meetings: 'Встречи', llm: 'Модель сводки' }, fields: { sample_rate: 'Частота дискретизации (Гц)', chunk_seconds: 'Длительность аудиоблока (с)', endpoint_rule1_silence: 'Тишина правила конца 1 (с)', endpoint_rule2_silence: 'Тишина правила конца 2 (с)', maximum_utterance_seconds: 'Максимальная длительность реплики (с)', refined_window_seconds: 'Окно обработки (с)', auto_english_model_id: 'Модель английского распознавания', denoiser_model_id: 'Модель шумоподавления в реальном времени', microphone_target_rms: 'Целевая громкость микрофона', microphone_minimum_rms: 'Минимальная громкость микрофона', microphone_max_gain: 'Максимальное усиление микрофона', microphone_peak: 'Ограничение пика микрофона', english_model_id: 'Модель английской пунктуации', chinese_model_id: 'Модель китайско-английской пунктуации', segmentation_model_id: 'Модель сегментации речи', cluster_threshold: 'Порог кластеризации', online_similarity_threshold: 'Порог онлайн-сопоставления', minimum_embedding_seconds: 'Минимальное аудио для отпечатка (с)', num_speakers: 'Фиксированное число говорящих (-1 = авто)', min_duration_on: 'Минимальная длительность речи (с)', min_duration_off: 'Минимальная пауза (с)', max_samples: 'Максимум записей на человека', max_total_seconds: 'Максимальная длительность на человека (с)', deleted_retention_days: 'Хранение удалённых записей (дни)', timeout_seconds: 'Тайм-аут запроса модели (с)' }, hint: 'Используется локальным запуском.' },
};
function renderAdvancedSettings(settings) {
  const copy = advancedSettingCopy[locale] || advancedSettingCopy.en;
  return Object.entries(settings).map(([section, values]) => `<section class="advanced-settings-section"><h3>${escapeHtml(copy.sections[section] || section)}</h3>${Object.entries(values).map(([key, value]) => `<label><span><b>${escapeHtml(copy.fields[key] || key)}</b><small>${escapeHtml(copy.hint)}</small></span><input name="${escapeHtml(`${section}.${key}`)}" type="${typeof value === 'number' ? 'number' : 'text'}" step="any" value="${escapeHtml(String(value))}" /></label>`).join('')}</section>`).join('');
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
  const rows = [...document.querySelectorAll('.meeting-row')];
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
  document.querySelectorAll('.meeting-row').forEach((row) => {
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
  return {
    ...meeting,
    meta: `${created} · ${minutes} ${t('分钟')}`,
    status: meeting.statusCode === 'recording'
      ? { tone: 'processing', label: t('正在录制'), detail: t('本地保存') }
      : { tone: 'complete', label: t('已整理'), detail: meetingSecondaryInfo(meeting) },
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
function renderMeetingList() { document.querySelector('.meeting-list').innerHTML = uiData.meetings.map((meeting, index) => !meeting.isExample || meeting.exampleLocale === locale ? renderMeetingRow(localizeMeeting(meeting), index) : '').join(''); filterMeetings(); syncMeetingSelection(); cacheMeetingList(); }
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
const importRecording = document.createElement('button');
importRecording.className = 'secondary';
importRecording.type = 'button';
importRecording.id = 'import-recording';
importRecording.textContent = t('导入录音');
prepareForm.querySelector('[type="submit"]').after(importRecording);
const meetingTitle = document.querySelector('#meeting-title');
let meetingTitleEdited = false;
/** 仅在用户提供自己的标题之前刷新起始标题。@returns {void} */
function renderDefaultMeetingTitle() { if (!meetingTitleEdited) meetingTitle.value = BreviaI18n.defaultMeetingTitle(locale); }
meetingTitle.addEventListener('input', () => { meetingTitleEdited = true; });
/** 在保留其提交值的同时重建会议语言选择器。@returns {void} */
function renderPrepareSelects() {
  const values = Object.fromEntries(new FormData(prepareForm));
  const workspaceOptions = [
    ['', t('公开工作区')],
    ...(typeof workspaces !== 'undefined' ? workspaces.map((ws) => [ws.id, ws.name]) : []),
    ['__new_workspace__', `+ ${t('新建工作区')}`],
  ];
  const workspaceValue = values['meeting-workspace'] === '__new_workspace__' ? activeWorkspaceId : values['meeting-workspace'] ?? activeWorkspaceId;
  prepareForm.querySelector('.form-grid').innerHTML = `<label>${t('会议语言')}${flowSelect('meeting-language', values['meeting-language'] || locale, BreviaI18n.languageOptions(locale, t, true))}</label><label>${t('译文目标')}${flowSelect('translation-target', values['translation-target'] || '', BreviaI18n.languageOptions(locale, t))}</label><label>${t('工作区')}${flowSelect('meeting-workspace', workspaceValue, workspaceOptions)}</label>`;
  renderCaptureMode(values['capture-mode'] || savedCaptureMode());
  prepareForm.querySelector('.primary-action').firstChild.nodeValue = `${t('开始录制')} `;
  importRecording.textContent = t('导入录音');
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
  if (inputs.mic) { void refreshMicDevices(); void previewMicrophone(); }
  else void breviaClient?.stopPreview();
}
function selectCurrentWorkspaceForMeeting() {
  const workspace = prepareForm.querySelector('[name="meeting-workspace"]');
  if (workspace) workspace.value = activeWorkspaceId;
  renderPrepareSelects();
}
const DEFAULT_REFINED_MODEL_ID = 'funasr-nano-int8';
const MULTILINGUAL_REFINED_MODEL_ID = 'qwen3-asr-0.6b-int8';
// Qwen3-ASR 1.7B 在当前 sherpa-onnx 下不支持语言强制，暂不提供此模型。
const removedRefinedModelIds = new Set(['qwen3-asr-1.7b-int8']);
const refinedModelName = (id = DEFAULT_REFINED_MODEL_ID) => modelCatalog.find((model) => model.id === id)?.name || 'FunASR Nano int8';
const languageModelDefaults = {
  zh: { streaming: 'zipformer-zh-xlarge-streaming-int8', refined: DEFAULT_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
  en: { streaming: 'zipformer-en-streaming-int8', refined: DEFAULT_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
  ko: { streaming: 'zipformer-ko-streaming-int8', refined: MULTILINGUAL_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
  fr: { streaming: 'zipformer-fr-streaming-int8', refined: MULTILINGUAL_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
  es: { streaming: 'nemotron-3.5-asr-streaming-0.6b-560ms-int8', refined: MULTILINGUAL_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
  auto: { streaming: 'nemotron-3.5-asr-streaming-0.6b-560ms-int8', refined: MULTILINGUAL_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
  default: { streaming: 'nemotron-3.5-asr-streaming-0.6b-560ms-int8', refined: MULTILINGUAL_REFINED_MODEL_ID, segmentation: 'pyannote-segmentation-3.0' },
};
const preferredModelsForLanguage = (language) => {
  const models = languageModelDefaults[language] || languageModelDefaults.default;
  return getPerformanceMode() === 'efficiency' && ['zh', 'en'].includes(language)
    ? { ...models, streaming: 'x-asr-zh-en-streaming-480ms-int8' }
    : models;
};
const requiredModelsForLanguage = (language) => {
  const { streaming, refined, segmentation } = preferredModelsForLanguage(language);
  const punctuation = language === 'en' ? 'online-punct-en-int8' : ['zh', 'yue', 'auto'].includes(language) ? 'punct-ct-transformer-zh-en-int8' : undefined;
  return [streaming, 'silero-vad', punctuation, refined, segmentation, 'eres2net-base-3dspeaker-zh', 'gtcrn-live-denoiser'];
};
function applyLanguageModelDefaults(language) {
  const models = preferredModelsForLanguage(language);
  Object.assign(prepareForm.dataset, { streamingModel: models.streaming, segmentationModel: models.segmentation, vadModel: 'silero-vad' });
}
if (breviaClient) {
  breviaClient.onLevel = (track, level) => {
    if (track !== 'mic') return;
    document.querySelectorAll('#mic-level, [data-onboarding-mic-level]').forEach((meter) => meter.style.setProperty('--level', Math.max(.04, level)));
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
    if (hint) hint.textContent = error.message;
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
  const ratio = total ? Math.min(1, completed / total) : 0;
  revealTaskCard(refinementCard);
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${copy.title} - ${refinementMeetingTitle}` : copy.title;
  refinementPercent.textContent = total ? `${copy.waiting} · ${Math.round(ratio * 100)}%` : copy.waiting;
  refinementBar.style.transform = `scaleX(${ratio})`;
  Object.assign(refinementCard.dataset, { completed, total, stage: stage || '', complete: 'false' });
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
  finishTaskCard(refinementCard);
  refinementDismissTimer = setTimeout(hideRefinementProgress, 10000);
}
function hideRefinementProgress(dismissActiveTask = false) {
  if (dismissActiveTask && refinementCard.dataset.complete !== 'true') refinementCardDismissed = true;
  dismissTaskCard(refinementCard, () => { refinementCard.hidden = true; refinementCard.classList.remove('task-card-leave'); });
}
let summaryDismissTimer;
let summaryGeneratingMeetingId;
const summaryTaskCopy = {
  zh: ['正在生成会议纪要', '准备生成纪要', '正在生成摘要', '正在保存纪要', '纪要已生成'],
  en: ['Generating meeting notes', 'Preparing meeting notes', 'Generating summary', 'Saving meeting notes', 'Meeting notes generated'],
  es: ['Generando notas de reunión', 'Preparando las notas de reunión', 'Generando el resumen', 'Guardando las notas', 'Notas de reunión generadas'],
  ja: ['会議メモを生成中', '会議メモを準備中', '要約を生成中', '会議メモを保存中', '会議メモを生成しました'],
  ko: ['회의록 생성 중', '회의록 준비 중', '요약 생성 중', '회의록 저장 중', '회의록이 생성되었습니다'],
  fr: ['Génération des notes de réunion', 'Préparation des notes de réunion', 'Génération du résumé', 'Enregistrement des notes', 'Notes de réunion générées'],
  de: ['Besprechungsnotizen werden erstellt', 'Besprechungsnotizen werden vorbereitet', 'Zusammenfassung wird erstellt', 'Besprechungsnotizen werden gespeichert', 'Besprechungsnotizen erstellt'],
  ru: ['Создание заметок встречи', 'Подготовка заметок встречи', 'Создание сводки', 'Сохранение заметок встречи', 'Заметки встречи созданы'],
};
const summaryEmptyTranscriptCopy = {
  zh: '当前会议暂无逐字稿内容，请先完成转写后再生成会议纪要。',
  en: 'This meeting has no transcript yet. Finish transcription before generating meeting notes.',
  es: 'Esta reunión aún no tiene transcripción. Finaliza la transcripción antes de generar las notas.',
  ja: 'この会議にはまだ文字起こしがありません。文字起こし完了後に会議メモを生成してください。',
  ko: '이 회의에는 아직 전사 내용이 없습니다. 전사를 완료한 후 회의록을 생성하세요.',
  fr: 'Cette réunion ne contient pas encore de transcription. Terminez-la avant de générer les notes.',
  de: 'Für diese Besprechung liegt noch kein Transkript vor. Schließen Sie die Transkription zuerst ab.',
  ru: 'Для этой встречи пока нет расшифровки. Завершите расшифровку перед созданием заметок.',
};
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
    if (error.message === 'A meeting summary is already running') showToast(t('已有会议纪要正在生成，请稍候。'));
    else if (isSummaryAuthenticationError(error)) showSummaryConfigCard(error);
    else if (error.message === summaryEmptyTranscriptCopy.zh) showToast(summaryEmptyTranscriptCopy[locale] || summaryEmptyTranscriptCopy.en);
    else if (/Summary response was empty|Summary generation failed/.test(String(error.message || ''))) showToast(t('纪要生成失败：模型未返回有效内容，请稍后重试。'));
    else showToast(error.message);
  }
}
const requiredModelIds = new Set();
const pendingModelTasks = new Map();
const resumingModelTasks = new Set();
let onboardingModelIds = [];
let onboardingModelSelection;
let initializationPromise;
const useChinaModelSource = () => locale === 'zh' && localStorage.getItem('brevia-china-model-source') === 'true';
const modelDownloadPayload = (modelId) => ({ model_id: modelId, ...(useChinaModelSource() ? { source: 'china' } : {}) });
const chinaModelSourceToggle = () => locale === 'zh' ? `<p class="model-source-switch"><label><input type="checkbox" data-china-model-source${useChinaModelSource() ? ' checked' : ''} /><span>您是否身处中国大陆？</span></label><small>选择后将会使用大陆镜像源进行下载提速。</small></p>` : '';
const onboardingCopy = {
  zh: { languageHint: '之后你可以随时修改界面语言。', meetingTitle: '你通常使用哪些会议语言？', meetingHint: '我们正在为您准备需要的语音识别模型。', modelsTitle: '准备语音识别功能', modelsHint: '为此，我们需要下载以下内容。', estimate: '预计占用空间', download: '下载并继续', customize: '自定义下载', later: '稍后设置', ready: '功能已准备就绪', preferenceTitle: '你更看重哪一点？', preferenceQuality: '质量优先', preferenceQualityHint: '选用精度更高的模型，占用与耗时更大。', preferencePerformance: '性能优先', preferencePerformanceHint: '选用更轻快的模型，转写更省资源。', capabilities: ['实时字幕', '语音活动检测', '自动标点', '会后精修', '语音分段', '说话人识别', '实时降噪'], translation: '字幕翻译' },
  en: { languageHint: 'You can change the interface language any time.', meetingTitle: 'What languages do you usually use in meetings?', meetingHint: 'We’ll prepare the speech recognition models you need.', modelsTitle: 'Preparing features', modelsHint: 'To recognize speech on this device, Brevia needs to download the following.', estimate: 'Estimated storage', download: 'Download and continue', customize: 'Customize downloads', later: 'Set up later', ready: 'All set', preferenceTitle: 'What matters more to you?', preferenceQuality: 'Prioritize quality', preferenceQualityHint: 'Higher-accuracy models that use more space and time.', preferencePerformance: 'Prioritize performance', preferencePerformanceHint: 'Lighter, faster models that use fewer resources.', capabilities: ['Live captions', 'Voice activity detection', 'Automatic punctuation', 'Post-meeting refinement', 'Speech segmentation', 'Speaker recognition', 'Live denoising'], translation: 'Caption translation' },
  es: { languageHint: 'Puedes cambiar el idioma de la interfaz en cualquier momento.', meetingTitle: '¿Qué idiomas usas habitualmente en las reuniones?', meetingHint: 'Prepararemos los modelos de reconocimiento de voz que necesitas.', modelsTitle: 'Preparar funciones', modelsHint: 'Para reconocer voz en este dispositivo, Brevia necesita descargar lo siguiente.', estimate: 'Almacenamiento estimado', download: 'Descargar y continuar', customize: 'Personalizar descargas', later: 'Configurar más tarde', ready: 'Funciones listas', preferenceTitle: '¿Qué te importa más?', preferenceQuality: 'Priorizar la calidad', preferenceQualityHint: 'Modelos más precisos que usan más espacio y tiempo.', preferencePerformance: 'Priorizar el rendimiento', preferencePerformanceHint: 'Modelos más ligeros y rápidos que usan menos recursos.', capabilities: ['Subtítulos en vivo', 'Detección de voz', 'Puntuación automática', 'Refinamiento posterior', 'Segmentación de voz', 'Reconocimiento de hablantes', 'Reducción de ruido'], translation: 'Traducción de subtítulos' },
  ja: { languageHint: '表示言語はいつでも変更できます。', meetingTitle: '会議ではどの言語をよく使いますか？', meetingHint: '必要な音声認識モデルを準備します。', modelsTitle: '機能の準備', modelsHint: 'このデバイスで音声を認識するため、以下をダウンロードします。', estimate: '必要な容量', download: 'ダウンロードして続ける', customize: 'ダウンロードをカスタマイズ', later: 'あとで設定', ready: '機能の準備ができました', preferenceTitle: 'どちらを重視しますか？', preferenceQuality: '品質を優先', preferenceQualityHint: 'より高精度なモデル。容量と処理時間は増えます。', preferencePerformance: '性能を優先', preferencePerformanceHint: 'より軽快なモデル。リソース消費を抑えます。', capabilities: ['ライブ字幕', '音声区間検出', '自動句読点', '会議後の高精度化', '音声分割', '話者認識', 'ライブノイズ除去'], translation: '字幕翻訳' },
  ko: { languageHint: '인터페이스 언어는 언제든 변경할 수 있습니다.', meetingTitle: '회의에서 주로 어떤 언어를 사용하나요?', meetingHint: '필요한 음성 인식 모델을 준비합니다.', modelsTitle: '기능 준비', modelsHint: '이 기기에서 음성을 인식하려면 다음 항목을 다운로드해야 합니다.', estimate: '예상 저장 공간', download: '다운로드하고 계속', customize: '다운로드 사용자 지정', later: '나중에 설정', ready: '기능이 준비되었습니다', preferenceTitle: '무엇을 더 중시하나요?', preferenceQuality: '품질 우선', preferenceQualityHint: '정확도가 높은 모델. 용량과 시간이 더 필요합니다.', preferencePerformance: '성능 우선', preferencePerformanceHint: '더 가볍고 빠른 모델. 리소스를 적게 씁니다.', capabilities: ['실시간 자막', '음성 활동 감지', '자동 문장 부호', '회의 후 정제', '음성 분할', '화자 인식', '실시간 노이즈 제거'], translation: '자막 번역' },
  fr: { languageHint: 'Vous pourrez modifier la langue de l’interface à tout moment.', meetingTitle: 'Quelles langues utilisez-vous habituellement en réunion ?', meetingHint: 'Nous préparerons les modèles de reconnaissance vocale nécessaires.', modelsTitle: 'Préparer les fonctions', modelsHint: 'Pour reconnaître la voix sur cet appareil, Brevia doit télécharger les éléments suivants.', estimate: 'Espace estimé', download: 'Télécharger et continuer', customize: 'Personnaliser les téléchargements', later: 'Configurer plus tard', ready: 'Fonctions prêtes', preferenceTitle: 'Qu’est-ce qui compte le plus pour vous ?', preferenceQuality: 'Privilégier la qualité', preferenceQualityHint: 'Modèles plus précis, plus gourmands en espace et en temps.', preferencePerformance: 'Privilégier la performance', preferencePerformanceHint: 'Modèles plus légers et rapides, moins gourmands en ressources.', capabilities: ['Sous-titres en direct', 'Détection d’activité vocale', 'Ponctuation automatique', 'Affinage après réunion', 'Segmentation vocale', 'Reconnaissance du locuteur', 'Réduction du bruit'], translation: 'Traduction des sous-titres' },
  de: { languageHint: 'Sie können die Sprache der Oberfläche jederzeit ändern.', meetingTitle: 'Welche Sprachen verwenden Sie üblicherweise in Besprechungen?', meetingHint: 'Wir bereiten die benötigten Spracherkennungsmodelle vor.', modelsTitle: 'Funktionen vorbereiten', modelsHint: 'Um Sprache auf diesem Gerät zu erkennen, muss Brevia Folgendes herunterladen.', estimate: 'Geschätzter Speicherbedarf', download: 'Herunterladen und fortfahren', customize: 'Downloads anpassen', later: 'Später einrichten', ready: 'Alles bereit', preferenceTitle: 'Was ist Ihnen wichtiger?', preferenceQuality: 'Qualität priorisieren', preferenceQualityHint: 'Genauere Modelle, die mehr Speicher und Zeit benötigen.', preferencePerformance: 'Leistung priorisieren', preferencePerformanceHint: 'Leichtere, schnellere Modelle mit geringerem Ressourcenbedarf.', capabilities: ['Live-Untertitel', 'Sprachaktivitätserkennung', 'Automatische Zeichensetzung', 'Nachbearbeitung', 'Sprachsegmentierung', 'Sprechererkennung', 'Live-Rauschunterdrückung'], translation: 'Untertitelübersetzung' },
  ru: { languageHint: 'Язык интерфейса можно изменить в любое время.', meetingTitle: 'Какие языки вы обычно используете на встречах?', meetingHint: 'Мы подготовим нужные модели распознавания речи.', modelsTitle: 'Подготовка функций', modelsHint: 'Чтобы распознавать речь на этом устройстве, Brevia нужно скачать следующее.', estimate: 'Требуемое место', download: 'Скачать и продолжить', customize: 'Настроить загрузки', later: 'Настроить позже', ready: 'Функции готовы', preferenceTitle: 'Что для вас важнее?', preferenceQuality: 'Приоритет качеству', preferenceQualityHint: 'Более точные модели, требующие больше места и времени.', preferencePerformance: 'Приоритет производительности', preferencePerformanceHint: 'Более лёгкие и быстрые модели с меньшим потреблением ресурсов.', capabilities: ['Субтитры в реальном времени', 'Определение голосовой активности', 'Автопунктуация', 'Обработка после встречи', 'Сегментация речи', 'Распознавание говорящих', 'Шумоподавление в реальном времени'], translation: 'Перевод субтитров' },
};
const onboardingSecurityCopy = {
  zh: '模型资源来自可信来源，并经过完整性校验。\n您的音频数据不会上传至云端。',
  en: 'Models come from trusted sources and pass integrity checks.\nYour audio is never uploaded to the cloud.',
  es: 'Los modelos provienen de fuentes confiables y pasan comprobaciones de integridad.\nTu audio nunca se sube a la nube.',
  ja: 'モデルは信頼できる提供元から取得し、完全性を検証しています。\n音声データがクラウドにアップロードされることはありません。',
  ko: '모델은 신뢰할 수 있는 출처에서 제공되며 무결성 검사를 거칩니다.\n오디오 데이터는 클라우드에 업로드되지 않습니다.',
  fr: 'Les modèles proviennent de sources fiables et leur intégrité est vérifiée.\nVos données audio ne sont jamais envoyées dans le cloud.',
  de: 'Modelle stammen aus vertrauenswürdigen Quellen und werden auf Integrität geprüft.\nIhre Audiodaten werden nie in die Cloud hochgeladen.',
  ru: 'Модели получены из надёжных источников и проходят проверку целостности.\nВаши аудиоданные никогда не загружаются в облако.',
};
const onboardingModelListLabel = { zh: ['会议语言模型', '离线功能模型'], en: ['Meeting language models', 'Offline feature models'], es: ['Modelos de idioma de reunión', 'Modelos de funciones sin conexión'], ja: ['会議言語モデル', 'オフライン機能モデル'], ko: ['회의 언어 모델', '오프라인 기능 모델'], fr: ['Modèles de langue de réunion', 'Modèles de fonctions hors ligne'], de: ['Besprechungssprachmodelle', 'Offline-Funktionsmodelle'], ru: ['Модели языков встречи', 'Модели автономных функций'] };
const onboardingLanguageCopy = {
  zh: ['选择你的语言', '选择言录的界面语言。', '继续'],
  en: ['Choose your language', 'Choose the language for Brevia.', 'Continue'],
  es: ['Elige tu idioma', 'Elige el idioma para Brevia.', 'Continuar'],
  ja: ['言語を選択', 'Brevia で使用する言語を選択してください。', '続ける'],
  ko: ['언어를 선택하세요', 'Brevia에서 사용할 언어를 선택하세요.', '계속'],
  fr: ['Choisissez votre langue', 'Choisissez la langue de Brevia.', 'Continuer'],
  de: ['Sprache auswählen', 'Wählen Sie die Sprache für Brevia.', 'Fortfahren'],
  ru: ['Выберите язык', 'Выберите язык для Brevia.', 'Продолжить'],
};
function queueModelTask(task, payload, models) {
  if (!task || (!payload?.meeting_id && !['meeting.start'].includes(task))) return;
  pendingModelTasks.set(`${task}:${payload.meeting_id || 'new'}`, { task, payload, models });
}
async function resumeReadyModelTasks() {
  for (const [key, pending] of pendingModelTasks) {
    if (resumingModelTasks.has(key) || !pending.models.every((modelId) => modelPaths.has(modelId))) continue;
    pendingModelTasks.delete(key);
    resumingModelTasks.add(key);
    try {
      if (pending.task === 'meeting.refine') {
        await window.brevia.meeting.refine(pending.payload);
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
      hideRefinementProgress();
      showToast(error.message);
    } finally { resumingModelTasks.delete(key); }
  }
}
function modelDisplayName(modelId) {
  const item = (modalCopy[locale] || modalCopy.en).models.items[modelIds.indexOf(modelId)];
  return item?.[1] || modelId;
}
let requiredModelsRenderFrame;
function scheduleRequiredModelsCardRender() {
  if (requiredModelsRenderFrame) return;
  requiredModelsRenderFrame = requestAnimationFrame(() => {
    requiredModelsRenderFrame = undefined;
    renderRequiredModelsCard();
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
    // 打开麦克风设备下拉前刷新设备列表(插拔后保持最新),就地更新不会打断展开状态。
    if (opening && toggle.closest('#mic-device-mount')) void refreshMicDevices();
    prepareForm.querySelectorAll('.flow-select-options').forEach((list) => { list.hidden = true; list.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
    options.hidden = !opening;
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
  if (choice.dataset.flowSelectChoice === 'meeting-language') applyLanguageModelDefaults(choice.dataset.value);
  if (choice.dataset.flowSelectChoice === 'capture-mode') {
    try { localStorage.setItem(CAPTURE_MODE_KEY, choice.dataset.value); } catch { /* 忽略存储失败。 */ }
    renderCaptureMode(choice.dataset.value);
  }
  if (choice.dataset.flowSelectChoice === 'mic-device') void onMicDeviceChange();
});
/** 渲染内置纪要模型清单，含未安装模型的下载入口。@returns {string} 清单标记。*/
function renderBuiltinSummaryModels(currentModelId, hint) {
  const copy = summaryModelCopy[locale] || summaryModelCopy.en;
  const models = modelCatalog.filter((model) => model.kind === 'llama-chat');
  if (!models.length) return `<p class="summary-model-hint">${t('内置纪要模型清单暂不可用。')}</p>`;
  const labels = modelLabels[locale] || modelLabels.en;
  const rows = models.map((model) => {
    const installed = modelPaths.has(model.id);
    const intro = builtinModelIntro[model.id]?.[locale] || builtinModelIntro[model.id]?.en || '';
    const download = modelDownloads.get(model.id);
    const selected = installed && model.id === currentModelId;
    const recommended = model.id === 'qwen3.5-2b-q4km' ? `<em class="builtin-model-recommended">${t('推荐')}</em>` : '';
    const progress = download ? `<span class="model-download-progress">${download.total ? `${Math.round((download.received / download.total) * 100)}%` : labels.downloading}<i style="transform:scaleX(${download.total ? download.received / download.total : 0})"></i></span>` : '';
    const action = installed
      ? `<span class="summary-config-badge">${labels.installed}</span>`
      : `<button class="modal-action" data-download-summary-model="${escapeHtml(model.id)}" type="button"${download ? ' disabled' : ''}>${download ? labels.downloading : labels.download}</button>`;
    return `<div class="model-library-item${selected ? ' builtin-model-selected' : ''}"${installed ? ` data-builtin-model-id="${escapeHtml(model.id)}"` : ''}><span><b class="model-library-headline">${escapeHtml(model.name)}${recommended}</b><small>${model.size_bytes ? `${formatBytes(model.size_bytes)}` : ''}</small>${intro ? `<small>${escapeHtml(intro)}</small>` : ''}${renderModelLibraryRatings(model)}${progress}</span><span class="model-actions">${action}</span></div>`;
  }).join('');
  return `<div class="builtin-model-list modal-list">${rows}</div><p class="summary-model-hint">${hint || copy.builtinHint}</p>`;
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
  const providerField = `<label class="config-select-field">${copy.provider}${flowSelect('provider', provider, providerOptions)}</label>`;
  let fields = '';
  let builtinModelList = '';
  let currentModelId = '';
  if (isBuiltin) {
    const installed = modelCatalog.filter((model) => model.kind === 'llama-chat' && modelPaths.has(model.id));
    currentModelId = selectedModel || (modelPaths.has(entry.model) ? entry.model : installed[0]?.id || '');
    builtinModelList = `<input type="hidden" name="model" value="${escapeHtml(currentModelId)}" />${renderBuiltinSummaryModels(currentModelId, hint)}`;
  } else {
    // 固定供应商的请求地址由代码派生，只有自定义供应商才让用户填写。
    const requiredAttr = required ? ' required' : '';
    const endpointField = preset.needsEndpoint ? `<label>${copy.endpoint}<input name="endpoint" value="${escapeHtml(entry.endpoint || '')}" type="url" placeholder="${escapeHtml(copy.endpointPlaceholder)}"${requiredAttr} /></label>` : '';
    // maxlength 对齐主进程的 zod 上限（model 128、keyLength 512），否则超长值要到
    // 主进程才被拒，用户只会看到一句无从下手的「操作失败」。
    const keyField = `<label>${copy.key}<input name="apiKey" type="password" autocomplete="new-password" maxlength="512" placeholder="${entry.keyReference ? '•'.repeat(entry.keyLength || 8) : ''}"${entry.keyReference || !required ? '' : ' required'} /></label>`;
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
  settingsModal.querySelector('h2').textContent = t('AI 会议总结');
  settingsModal.querySelector('.modal-title p').textContent = copy.featureIntro || summaryModelCopy.en.featureIntro;
  settingsModal.querySelector('.modal-body').innerHTML = renderSummaryModelForm();
}
/** 渲染「AI 笔记」设置模态框：开关、主动性与独立模型连接。@returns {void} */
function renderAiAssistModal() {
  aiAssistConfigDraft ||= structuredClone(aiAssistConfig);
  const config = aiAssistConfigDraft;
  const copy = (aiAssistCopy[locale] || aiAssistCopy.en).modal;
  settingsModal.querySelector('h2').textContent = t('AI 笔记');
  settingsModal.querySelector('.modal-title p').textContent = t('让 AI 在会议中帮你发现重点、提取待办并整理笔记。');
  const proactivity = aiAssistConfig.enabled ? aiAssistConfig.proactivity : 'off';
  const levels = (aiOnboardingCopy[locale] || aiOnboardingCopy.en).levels.map(([value, title, detail]) => `<label class="ai-assist-level${proactivity === value ? ' is-selected' : ''}"><input type="radio" name="proactivity" value="${escapeHtml(value)}"${proactivity === value ? ' checked' : ''} /><span><b>${escapeHtml(title)}${recommendTag(value === 'off' && deviceIsWeak())}</b><small>${escapeHtml(detail)}</small></span></label>`).join('');
  const warning = (deviceIsWeak() && config.provider === 'built-in' && /4b/i.test(providerEntry(config).model || ''))
    ? `<p class="performance-weak-note">⚠ ${escapeHtml(t('本机性能有限，建议使用更小的内置模型（如 2B）或在线 LLM API，以获得更流畅的实时体验。'))}<br><button class="secondary" data-use-ai-2b type="button">${escapeHtml(t('改用 2B AI 笔记模型'))}</button>${meetingActive ? ` <button class="secondary" data-disable-ai-assist type="button">${escapeHtml(t('暂时停用 AI 笔记'))}</button>` : ''}</p>` : '';
  const modelFields = renderModelConfigFields(config, selectedAiAssistBuiltinModel, { required: proactivity !== 'off', hint: t('选择一个已下载的内置 AI 笔记模型。未下载的模型可在此直接下载。') });
  const aiForm = `<form class="ai-assist-config-form"><section class="ai-summary-section">${warning}<section class="ai-assist-proactivity"><p>${escapeHtml(copy.proactivityLabel)}</p><div class="ai-assist-levels">${levels}</div></section></section><section class="ai-summary-section"><h3>${escapeHtml(t('模型'))}</h3>${modelFields.markup}</section><div class="modal-form-actions"><button class="modal-action" type="submit"${modelFields.saveDisabled ? ' disabled' : ''}>${escapeHtml(t('保存配置'))}</button></div></form>`;
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="ai-summary-settings">${aiForm}</div>`;
}
/** 渲染「性能」设置模态框：性能模式（标准/效率）+ 设备能力提示。@returns {void} */
function renderPerformanceModal() {
  settingsModal.querySelector('h2').textContent = t('性能');
  settingsModal.querySelector('.modal-title p').textContent = t('选择性能或效率模式，在音频效果与字幕实时性之间取舍。');
  const mode = getPerformanceMode();
  const modeRow = (value, title, detail) => `<label class="ai-assist-level${mode === value ? ' is-selected' : ''}"><input type="radio" name="performance-mode" value="${value}"${mode === value ? ' checked' : ''} /><span><b>${escapeHtml(t(title))}${recommendTag(value === 'standard' ? !deviceIsWeak() : deviceIsWeak())}</b><small>${escapeHtml(t(detail))}</small></span></label>`;
  settingsModal.querySelector('.modal-body').innerHTML = `<form class="ai-assist-form"><section class="ai-assist-proactivity performance-mode-options"><p>${escapeHtml(t('性能模式'))}</p><div class="ai-assist-levels">${modeRow('standard', '性能模式', '标准模式：开启实时降噪与实时精修，体验最佳，适合性能较强的设备。')}${modeRow('efficiency', '效率模式', '关闭实时降噪，使用轻量模型二次精修。')}</div></section><div class="modal-form-actions"><button class="modal-action" type="submit">${escapeHtml(t('保存'))}</button></div></form>`;
}
/** 会中检测到性能瓶颈时，弹出是否临时降低到效率模式的对话框。@returns {void} */
function openPerformanceBottleneckDialog(meetingId) {
  settingsModal.querySelector('h2').textContent = t('检测到实时性能瓶颈');
  settingsModal.querySelector('.modal-title p').textContent = t('实时字幕精修长期积压，字幕出现延迟。是否临时降低到效率模式？');
  const aiActions = aiAssistEnabled()
    ? `<button class="secondary" data-use-ai-2b type="button">${escapeHtml(t('改用 2B AI 笔记模型'))}</button><button class="secondary" data-disable-ai-assist type="button">${escapeHtml(t('暂时停用 AI 笔记'))}</button>` : '';
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="confirmation-actions"><p>${escapeHtml(t('实时字幕精修长期积压，字幕出现延迟。是否临时降低到效率模式？'))}</p><button class="modal-action" data-confirm-perf-lower type="button">${escapeHtml(t('降低到效率模式'))}</button>${aiActions}<button class="secondary" data-cancel-confirmation type="button">${escapeHtml(t('保持当前设置'))}</button></div>`;
  showSettingsModal('[data-cancel-confirmation]');
  const lower = settingsModal.querySelector('[data-confirm-perf-lower]');
  if (lower) {
    lower.addEventListener('click', async () => {
      const result = await applyLiveEfficiency(meetingId);
      if (result) showToast(t('已切换到效率模式，实时字幕更实时；会后精修仍可用。'));
      closeModal();
    });
  }
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
/** 会中临时切换到效率模式：关实时降噪，以轻量流式模型做二阶段精修。@param {string} meetingId 会议 id。@returns {Promise<boolean>} */
async function applyLiveEfficiency(meetingId) {
  const meetingIdSafe = meetingId || breviaClient?.state.meeting?.id;
  if (!meetingIdSafe || !window.brevia) return false;
  try {
    const language = breviaClient?.state.meeting?.language;
    await reconfigureLive({
      power_saving: true,
      ...(['zh', 'en'].includes(language)
        ? { streaming_model_id: 'x-asr-zh-en-streaming-480ms-int8' }
        : {}),
    });
    if (aiAssistEnabled() && aiAssistIsBuiltIn() && window.brevia.aiNote) {
      await window.brevia.aiNote.reconfigure({ meeting_id: meetingIdSafe, min_interval_seconds: 120 }).catch(() => {});
      showToast(t('已降低 AI 笔记频率（内置模型）。'));
    }
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
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
  audio: ['m4a', 'wav', 'flac'],
};
const exportDefaultFormat = { notes: 'md', mynotes: 'md', transcript: 'srt', audio: 'm4a' };
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
  md: 'Markdown', pdf: 'PDF', docx: 'DOCX', txt: null, srt: 'SRT', json: 'JSON', m4a: 'M4A', wav: 'WAV', flac: 'FLAC',
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
      <span class="export-format-wrap flow-select">
        <button class="flow-select-toggle" type="button" data-flow-select-toggle aria-expanded="false">${escapeHtml(currentDisplay)}<span>⌄</span></button>
        <input type="hidden" data-export-format="${content}" value="${current}" />
        <div class="flow-select-options" hidden>${formatOptions}</div>
      </span>
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
const summaryDetailCopy = {
  zh: ['完整会议纪要', '重新生成', '导出会议纪要', '完整结构化会议纪要', '纯文本会议纪要', '适合归档与分享'],
  en: ['Full meeting notes', 'Regenerate', 'Export meeting notes', 'Complete structured meeting notes', 'Plain-text meeting notes', 'Suitable for archiving and sharing'],
  es: ['Notas completas de la reunión', 'Regenerar', 'Exportar notas de reunión', 'Notas de reunión estructuradas completas', 'Notas de reunión en texto sin formato', 'Adecuado para archivar y compartir'],
  ja: ['完全な会議メモ', '再生成', '会議メモをエクスポート', '完全な構造化会議メモ', 'プレーンテキストの会議メモ', 'アーカイブと共有に適しています'],
  ko: ['전체 회의록', '다시 생성', '회의록 내보내기', '완전한 구조화 회의록', '일반 텍스트 회의록', '보관 및 공유에 적합'],
  fr: ['Notes de réunion complètes', 'Régénérer', 'Exporter les notes de réunion', 'Notes de réunion structurées complètes', 'Notes de réunion en texte brut', 'Adapté à l’archivage et au partage'],
  de: ['Vollständige Besprechungsnotizen', 'Neu erstellen', 'Besprechungsnotizen exportieren', 'Vollständige strukturierte Besprechungsnotizen', 'Besprechungsnotizen als Klartext', 'Zum Archivieren und Teilen geeignet'],
  ru: ['Полные заметки встречи', 'Создать заново', 'Экспортировать заметки встречи', 'Полные структурированные заметки встречи', 'Заметки встречи в виде простого текста', 'Подходит для архивации и обмена'],
};
function summaryActionBar(editing) {
  const button = (action, label, icon) => `<button type="button" class="summary-action-icon" data-${action} title="${label}" aria-label="${label}">${summaryActionIcons[icon]}</button>`;
  return `<div class="summary-action-bar">${editing ? `${button('cancel-summary-edit', t('取消'), 'cancel')}${button('save-summary', t('保存'), 'save')}` : `${button('edit-summary', t('编辑'), 'edit')}${button('regenerate-summary', t('重新生成'), 'refresh')}`}</div>`;
}
function renderSummaryDetailModal() {
  const markdown = currentMeetingDetail?.summary?.data?.markdown;
  if (!markdown) { closeModal(); return; }
  const copy = summaryDetailCopy[locale] || summaryDetailCopy.en;
  settingsModal.querySelector('h2').textContent = copy[0];
  settingsModal.querySelector('.modal-title p').textContent = currentMeetingDetail.title;
  settingsModal.querySelector('.modal-body').innerHTML = summaryEditing
    ? `${summaryActionBar(true)}<div data-summary-editor></div>`
    : `${summaryActionBar(false)}<article class="markdown-content summary-modal-document">${renderMarkdown(cleanSummaryMarkdown(markdown))}</article>`;
  if (summaryEditing) {
    summaryEditor = createNotesEditor(settingsModal.querySelector('[data-summary-editor]'), { ariaLabel: t('会议纪要'), getMeetingId: () => currentMeetingDetail?.id });
    summaryEditor.setMarkdown(markdown);
    summaryEditor.focus();
  }
}
/** 渲染一个设置模态框。@param {'models'|'storage'|'summary-model'} kind 请求的模态框。@returns {void} */
function renderModal(kind) {
  if (kind === 'advanced-settings') {
    settingsModal.querySelector('h2').textContent = t('进阶设置');
    settingsModal.querySelector('.modal-title p').textContent = t('为特定会议环境微调识别、端点检测、说话人分离和本地模型。');
    settingsModal.querySelector('.modal-body').innerHTML = `${renderPermissionSettings()}<form class="advanced-settings-form"><p>${t('可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。')}</p>${renderAdvancedSettings(advancedSettings?.settings || {})}<div class="modal-form-actions"><button class="modal-action" type="submit">${t('确定')}</button><button class="secondary" data-reset-advanced-settings type="button">${t('恢复默认')}</button></div></form>`;
    return;
  }
  if (kind === 'summary-model') { renderSummaryModelModal(); return; }
  if (kind === 'ai-assist') { renderAiAssistModal(); return; }
  if (kind === 'performance') { renderPerformanceModal(); return; }
  if (kind === 'speaker-profiles') { renderSpeakerProfileModal(); return; }
  if (kind === 'export' || kind === 'share') { renderExportModal(); return; }
  if (kind === 'summary-detail') { renderSummaryDetailModal(); return; }
  if (kind === 'whats-new') { renderWhatsNewModal(); return; }
  const copy = (modalCopy[locale] || modalCopy.en)[kind];
  if (kind === 'storage') {
    const cleanup = storageCleanupCopy[locale] || storageCleanupCopy.en;
    settingsModal.querySelector('h2').textContent = t('存储与隐私');
    settingsModal.querySelector('.modal-title p').textContent = t('查看和管理保存在此 Mac 上的会议资料、模型与导出文件。');
    settingsModal.querySelector('.modal-body').innerHTML = `<div class="storage-list">${copy.items.map(([name, size], index) => `<section><span><b>${escapeHtml(name)}</b><small>${escapeHtml(size)}</small></span><span><button class="secondary" data-open-storage="${['meetings', 'models', 'exports'][index]}" type="button">${t('从文件夹打开')}</button><button class="model-delete" data-clear-storage="${['meetings', 'models', 'exports'][index]}" type="button">${t('清空数据')}</button></span></section>`).join('')}</div><div class="modal-form-actions"><button class="secondary" data-cleanup-storage type="button">${cleanup.button}</button><small>${cleanup.detail}</small></div>`;
    return;
  }
  const modelStageOrder = new Map();
  (copy.items || []).forEach(([stage], index) => { if (!modelStageOrder.has(stage)) modelStageOrder.set(stage, index); });
  const selectingOnboardingModels = kind === 'models' && Boolean(onboardingPage);
  const items = kind === 'models' ? copy.items.map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ sourceIndex }) => !modelCatalog.find((model) => model.id === modelIds[sourceIndex])?.bundled).sort((a, b) => modelStageOrder.get(a.item[0]) - modelStageOrder.get(b.item[0])) : copy.items;
  settingsModal.querySelector('h2').textContent = copy.title;
  // 模型库弹窗简介与设置卡片文案保持一致（以设置卡片内容为准）。
  settingsModal.querySelector('.modal-title p').textContent = kind === 'models' ? t('下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。') : copy.intro;
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close);
  settingsModal.querySelector('.modal-body').innerHTML = `${kind === 'models' ? chinaModelSourceToggle() : ''}<div class="modal-list${kind === 'models' ? ' model-library-list' : ''}">${items.map((entry, index) => {
    const item = kind === 'models' ? entry.item : entry;
    const sourceIndex = kind === 'models' ? entry.sourceIndex : index;
    const [name, detail] = kind === 'models' ? item.slice(1, 3) : item;
    const [stage, , , intro] = kind === 'models' ? item : [];
    const label = `<b>${escapeHtml(name)}</b>`;
    const progress = kind === 'models' ? modelDownloads.get(modelIds[sourceIndex]) : null;
    const ratio = progress?.total ? Math.min(1, progress.received / progress.total) : 0;
    // 已取消的条目是终结性的，而非进行中的：不为其渲染进度且不禁用其按钮，
    // 否则库会显示永久禁用的"下载中"，重新下载将变得不可能。
    const downloadInFlight = progress && !progress.error && !progress.cancelled;
    const downloadProgress = progress?.error ? `<span class="model-download-progress">${escapeHtml(progress.error)}</span>` : downloadInFlight ? `<span class="model-download-progress">${formatBytes(progress.received)} / ${formatBytes(progress.total)} · ${Math.round(ratio * 100)}%<i aria-hidden="true" style="transform:scaleX(${ratio})"></i></span>` : '';
    const size = kind === 'models' ? `<small>${formatBytes(modelSize(modelIds[sourceIndex]))}</small>` : '';
    const installed = kind === 'models' && modelPaths.has(modelIds[sourceIndex]);
    const model = kind === 'models' ? modelCatalog.find((candidate) => candidate.id === modelIds[sourceIndex]) : null;
    const ratings = kind === 'models' ? renderModelLibraryRatings(model) : '';
    const tags = kind === 'models' ? renderModelLibraryTags(model, installed, name) : '';
    // 以语言为主（"哪种声音"的问题）；模型名称在标签行中，而非单独一行。
    const nameRow = kind === 'models' ? `<div class="model-library-name"><b class="model-library-headline">${escapeHtml(detail)}</b>${tags}</div>` : label;
    const actions = kind === 'models' ? selectingOnboardingModels ? `<label class="model-select"><input type="checkbox" data-onboarding-model-selection value="${modelIds[sourceIndex]}"${installed ? ' checked disabled' : onboardingModelSelection?.has(modelIds[sourceIndex]) ? ' checked' : ''} /></label>` : `<span class="model-actions">${installed ? `<button class="secondary" data-open-model-folder="${sourceIndex}" type="button">${t('从文件夹打开')}</button>` : ''}<button class="modal-action${installed ? ' modal-danger' : ''}" ${installed ? `data-delete-model="${sourceIndex}"` : `data-download-model="${sourceIndex}"`} type="button"${downloadInFlight ? ' disabled' : ''}>${installed ? (modelLabels[locale] || modelLabels.en).remove : downloadInFlight ? (modelLabels[locale] || modelLabels.en).downloading : (modelLabels[locale] || modelLabels.en).download}</button></span>` : '';
    const heading = kind === 'models' && (index === 0 || items[index - 1].item[0] !== stage) ? `<h3>${escapeHtml(stage)}</h3>` : '';
    return `${heading}<div class="${kind === 'models' ? 'model-library-item' : ''}"><span>${nameRow}${downloadProgress}${kind === 'models' ? `${ratings}${intro ? `<p>${escapeHtml(intro)}</p>` : ''}` : `<small>${escapeHtml(detail)}</small>${size}${intro ? `<small>${escapeHtml(intro)}</small>` : ''}`}</span>${actions}</div>`;
  }).join('')}</div>${selectingOnboardingModels ? `<div class="modal-form-actions"><button class="modal-action" data-download-onboarding-selected type="button"${onboardingModelSelection?.size ? '' : ' disabled'}>${(onboardingCopy[locale] || onboardingCopy.en).download}</button></div>` : ''}`;
}
/** 渲染“更新日志”弹窗：标题 + 按版本倒序的内容列表。@returns {void} */
function renderWhatsNewModal() {
  const copy = whatsNewCopy[locale] || whatsNewCopy.en;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close);
  settingsModal.querySelector('.modal-body').innerHTML = renderWhatsNewList();
}
/** 渲染更新日志列表。@returns {string} 弹窗主体 HTML。 */
function renderWhatsNewList() {
  const copy = whatsNewCopy[locale] || whatsNewCopy.en;
  if (!whatsNewLog || !whatsNewLog.length) return `<p class="whatsnew-empty">${escapeHtml(copy.empty)}</p>`;
  const localized = (entry) => entry[locale] || entry.en || entry.zh || {};
  return `<div class="whatsnew-list">${whatsNewLog.map((entry) => {
    const { version, date, current } = entry;
    const content = localized(entry);
    const sections = [['what', copy.what], ['fixed', copy.fixed], ['improved', copy.improved], ['changes', copy.changes]]
      .map(([key, label]) => {
        const items = content[key];
        if (!items || !items.length) return '';
        return `<section><h4>${escapeHtml(label)}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
      })
      .join('');
    return `<article class="whatsnew-entry${current ? ' is-current' : ''}"><header><h3>v${escapeHtml(version)}${current ? `<em>${escapeHtml(copy.current)}</em>` : ''}</h3>${date ? `<time>${escapeHtml(date)}</time>` : ''}</header>${sections}</article>`;
  }).join('')}</div>`;
}
/** 显示设置模态框并播放进入动画；可选聚焦内部元素。@param {string} [focusSelector] 打开后聚焦的模态框内元素。@returns {void} */
function showSettingsModal(focusSelector) {
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
  if (kind === 'summary-detail') { summaryEditing = false; summaryEditor = null; }
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
  summaryEditing = false;
  summaryEditor = null;
  onboardingOnlineProvider = false;
  activeModal = undefined;
  settingsModal.style.zIndex = '';
  settingsModal.classList.remove('modal-enter');
  settingsModal.classList.add('modal-leave');
  modalDismissTimer = setTimeout(() => {
    if (!settingsModal.classList.contains('modal-leave')) return;
    settingsModal.hidden = true;
    settingsModal.classList.remove('modal-leave');
    document.body.classList.remove('modal-open');
  }, 220);
}

let onboardingPage;
let onboardingAiDemoTimer;
let onboardingSummaryDemoTimer;
let onboardingPreviewLocale;
let onboardingSelectedLocale;
let onboardingTourIndex = 0;
/** 渲染「AI 笔记」演示：复刻应用内实时会议界面——右侧实时字幕 + 左侧 AI 建议（随主动性切换）。@returns {void} */
function renderOnboardingAiDemo() {
  const demo = onboardingPage?.querySelector('[data-onboarding-ai-demo]');
  const mode = onboardingPage?.querySelector('[name="onboarding-ai-proactivity"]:checked')?.value || 'quiet';
  if (!demo) return;
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  const demoCopy = aiOnboardingDemoCopy[locale] || copy.demo || aiOnboardingCopy.en.demo;
  const speaker = t('说话人');
  const caption = (n) => `<div class="app-demo-caption"><span class="app-demo-speaker">${escapeHtml(speaker)} ${n}</span><p>${escapeHtml(demoCopy.transcriptText)}</p></div>`;
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
  clearInterval(onboardingAiDemoTimer);
  demo.dataset.mode = mode;
  paint();
  onboardingAiDemoTimer = setInterval(paint, 2800);
}
/** 渲染「AI 会议纪要」演示：复刻应用内会议详情界面——先出会后生成任务（进度条），再显示整理好的纪要。@returns {void} */
function renderOnboardingSummaryDemo() {
  const frame = onboardingPage?.querySelector('[data-onboarding-summary-demo]');
  if (!frame) return;
  const demo = aiOnboardingSummaryDemoCopy[locale] || aiOnboardingSummaryDemoCopy.en;
  frame.innerHTML = `<div class="app-demo-window"><div class="app-demo-window-bar"><i></i><i></i><i></i><span>${escapeHtml(demo.windowTitle)}</span></div><div class="app-demo-summary"><div class="app-demo-summary-task"><small>${escapeHtml(demo.task)}</small><i><b></b></i><span>${escapeHtml(demo.progress)}</span></div><div class="app-demo-summary-body"><p class="eyebrow">${escapeHtml(demo.heading)}</p><div class="markdown-content"><p>${escapeHtml(demo.decision)}</p><ul>${demo.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul></div></div></div></div>`;
  const stage = frame.querySelector('.app-demo-summary');
  let phase = 0;
  const tick = () => {
    phase = (phase + 1) % 2;
    stage.classList.toggle('show-card', phase === 1);
    stage.classList.remove('run-progress');
    void stage.offsetWidth; // 重启动画
    if (phase === 0) stage.classList.add('run-progress');
  };
  clearInterval(onboardingSummaryDemoTimer);
  stage.classList.add('run-progress');
  onboardingSummaryDemoTimer = setInterval(tick, 3000);
}
function openOnboardingLanguage(initialLocale = onboardingSelectedLocale || window.BreviaOnboarding.systemLocale()) {
  activeModal = undefined;
  onboardingPreviewLocale = undefined;
  const choices = [['zh', '简体中文'], ['en', 'English'], ['es', 'Español'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['ru', 'Русский']];
  const defaultLocale = initialLocale;
  const wheelItems = Array.from({ length: 5 }, (_, round) => choices.map(([code, label]) => `<button type="button" data-language-wheel-value="${code}" role="option" aria-selected="${code === defaultLocale}"${round === 2 ? '' : ' tabindex="-1"'}>${label}</button>`).join('')).join('');
  onboardingPage = document.createElement('main');
  onboardingPage.className = 'onboarding-page onboarding-active';
  onboardingPage.innerHTML = `<form class="onboarding-page-content onboarding-language-page" data-onboarding-language><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><div class="onboarding-page-copy"><h1></h1><p></p></div><input name="locale" type="hidden" value="${defaultLocale}" /><div class="language-wheel" role="listbox" aria-label="Choose your language">${wheelItems}</div><small class="onboarding-page-copy"></small><div class="onboarding-actions onboarding-page-copy"><button class="modal-action" type="submit"></button></div></form>`;
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

// 首次引导：功能演示（tour）。在设置完成后，以 1:1 复刻的应用界面逐一展示言录的核心能力。
const tourMeetingFallback = { zh: '会议', en: 'Meeting', es: 'Reunión', ja: '会議', ko: '회의', fr: 'Réunion', de: 'Besprechung', ru: 'Встреча' };
const tourAiSuggestionFallback = { zh: 'AI 建议', en: 'AI suggestion', es: 'Sugerencia de IA', ja: 'AI 提案', ko: 'AI 제안', fr: 'Suggestion IA', de: 'KI-Vorschlag', ru: 'Совет ИИ' };
const tourHowtoLabel = { zh: '如何使用', en: 'How to use', es: 'Cómo usarlo', ja: '使い方', ko: '사용 방법', fr: 'Comment l’utiliser', de: 'So verwenden', ru: 'Как использовать' };
const tourHowto = {
  zh: {
    0: ['在搜索框输入关键词，可搜索会议标题、字幕内容或说话人。', '搜索结果以浮窗展示，并高亮命中的关键词。', '点击某条结果即可打开该会议。'],
    1: ['输入会议名称，并选择会议语言与译文目标。', '勾选要录制的音频来源（麦克风 / 系统音频）。', '点击「开始录制」，模型加载后会自动开录。'],
    2: ['录制时，右侧实时字幕会持续滚动更新。', '每条字幕带时间与说话人，点击可回放定位。', '点击「展开字幕」，把字幕切到主视图。'],
    3: ['点击「AI 笔记」开启实时纪要。', 'AI 会自动提炼结论、风险与待办到笔记区。', '可将当前字幕片段一键加入笔记。'],
    4: ['会后自动生成精修逐字稿与纪要。', '拖动播放条回听，字幕会随之高亮。', '点击「导出」或「分享」，保存或发送纪要。'],
  },
  en: {
    0: ['Type keywords to search meeting titles, captions, or speakers.', 'Results appear in a popover with the query highlighted.', 'Click a result to open that meeting.'],
    1: ['Enter a meeting title, then choose the language and translation target.', 'Check which audio sources to record (mic / system audio).', 'Hit Start recording; models load before recording begins.'],
    2: ['Live captions scroll continuously on the right while recording.', 'Each caption carries a time and speaker; click to jump playback.', 'Expand captions to bring them to the main view.'],
    3: ['Enable AI notes to start real-time notes.', 'AI surfaces decisions, risks, and actions into your notes.', 'Add the current caption segment to your notes in one click.'],
    4: ['A refined transcript and notes are generated automatically.', 'Drag the playback bar to listen; captions highlight in sync.', 'Export or share the notes when you are done.'],
  },
  es: {
    0: ['Escribe palabras clave para buscar títulos, subtítulos o hablantes.', 'Los resultados aparecen en una ventana flotante con la búsqueda resaltada.', 'Haz clic en un resultado para abrir esa reunión.'],
    1: ['Escribe un título y elige el idioma y la traducción.', 'Marca qué fuentes de audio grabar (micrófono / sistema).', 'Pulsa Iniciar grabación; los modelos cargan antes.'],
    2: ['Los subtítulos en vivo se desplazan a la derecha al grabar.', 'Cada subtítulo tiene hora y hablante; pulsa para saltar.', 'Amplía los subtítulos para llevarlos a la vista principal.'],
    3: ['Activa la IA para notas en tiempo real.', 'La IA extrae conclusiones, riesgos y tareas a tus notas.', 'Añade el segmento actual a tus notas con un clic.'],
    4: ['Se genera automáticamente una transcripción refinada y notas.', 'Arrastra la barra para escuchar; los subtítulos se resaltan.', 'Exporta o comparte las notas al terminar.'],
  },
  ja: {
    0: ['キーワードで会議タイトル・字幕・話者を検索。', '結果は浮遊ウィンドウで表示され、キーワードがハイライト。', '結果をクリックすると会議が開きます。'],
    1: ['会議名を入力し、言語と翻訳先を選択。', '録音する音声ソース（マイク/システム）を選択。', '「録音を開始」でモデル読み込み後に開始。'],
    2: ['録音中、右側にライブ字幕が流れます。', '各字幕に時間と話者が付き、クリックで再生位置へ。', '「字幕を展開」で字幕をメイン表示に。'],
    3: ['「AIメモ」を有効にしてリアルタイムメモ。', 'AI が結論・リスク・ToDo をメモに抽出。', '現在の字幕をワンクリックでメモに追加。'],
    4: ['終了後に精修済みの文字起こしとメモを自動生成。', 'バーをドラッグして再生、字幕が連動ハイライト。', '「エクスポート」「共有」で保存・送信。'],
  },
  ko: {
    0: ['키워드로 회의 제목·자막·화자를 검색하세요.', '결과는 플로팅 창에 표시되며 키워드가 강조됩니다.', '결과를 클릭하면 회의가 열립니다.'],
    1: ['회의 이름을 입력하고 언어·번역 대상을 선택하세요.', '녹음할 오디오 소스(마이크/시스템)를 선택하세요.', '「녹음 시작」을 누르면 모델 로드 후 시작됩니다.'],
    2: ['녹음 중 오른쪽에 실시간 자막이 흐릅니다.', '각 자막에 시간·화자가 표시되며 클릭으로 이동.', '「자막 확대」로 자막을 메인 화면에.'],
    3: ['「AI 메모」를 켜서 실시간 메모를 시작하세요.', 'AI가 결론·리스크·할 일을 메모로 추출합니다.', '현재 자막을 한 번에 메모에 추가하세요.'],
    4: ['종료 후 정제된 녹취와 메모를 자동 생성합니다.', '바를 드래그해 재생하면 자막이 연동됩니다.', '「내보내기」「공유」로 저장·전송하세요.'],
  },
  fr: {
    0: ['Saisissez des mots-clés pour chercher titres, sous-titres ou locuteurs.', 'Les résultats s’affichent dans une fenêtre flottante avec la recherche surlignée.', 'Cliquez sur un résultat pour ouvrir cette réunion.'],
    1: ['Saisissez un titre, puis choisissez la langue et la traduction.', 'Cochez les sources audio à enregistrer (micro / système).', 'Cliquez sur Démarrer ; les modèles se chargent avant.'],
    2: ['Les sous-titres défilent à droite pendant l’enregistrement.', 'Chaque sous-titre a une heure et un locuteur ; cliquez pour sauter.', 'Agrandissez les sous-titres pour les mettre en premier plan.'],
    3: ['Activez les notes IA pour les notes en temps réel.', 'L’IA extrait conclusions, risques et tâches dans vos notes.', 'Ajoutez le segment courant à vos notes en un clic.'],
    4: ['Une transcription affinée et des notes sont générées automatiquement.', 'Faites glisser la barre pour écouter ; les sous-titres se surlignent.', 'Exportez ou partagez les notes à la fin.'],
  },
  de: {
    0: ['Geben Sie Schlüsselwörter ein, um Titel, Untertitel oder Sprecher zu suchen.', 'Die Ergebnisse erscheinen in einem Popover mit hervorgehobener Suche.', 'Klicken Sie auf ein Ergebnis, um die Besprechung zu öffnen.'],
    1: ['Titel eingeben, Sprache und Übersetzungsziel wählen.', 'Audioquellen (Mikrofon/System) zum Aufnehmen auswählen.', '„Aufnahme starten“; die Modelle laden vor dem Start.'],
    2: ['Live-Untertitel laufen rechts während der Aufnahme.', 'Jeder Untertitel hat Zeit und Sprecher; klicken zum Springen.', 'Untertitel vergrößern, um sie in die Hauptansicht zu bringen.'],
    3: ['KI-Notizen für Notizen in Echtzeit aktivieren.', 'KI zieht Schlussfolgerungen, Risiken und Aufgaben in Ihre Notizen.', 'Aktuelles Segment mit einem Klick zu Notizen hinzufügen.'],
    4: ['Ein bearbeitetes Transkript und Notizen werden automatisch erstellt.', 'Balken ziehen zum Anhören; Untertitel werden synchron hervorgehoben.', 'Notizen am Ende exportieren oder teilen.'],
  },
  ru: {
    0: ['Введите ключевые слова для поиска названий, субтитров или говорящих.', 'Результаты появляются во всплывающем окне с подсветкой запроса.', 'Нажмите на результат, чтобы открыть встречу.'],
    1: ['Введите название, затем выберите язык и перевод.', 'Отметьте источники звука для записи (микрофон/система).', 'Нажмите «Начать запись»; модели загрузятся заранее.'],
    2: ['Субтитры прокручиваются справа во время записи.', 'У каждого субтитра есть время и говорящий; клик для перехода.', 'Разверните субтитры, чтобы показать их на главном экране.'],
    3: ['Включите ИИ-заметки для заметок в реальном времени.', 'ИИ извлекает выводы, риски и задачи в ваши заметки.', 'Добавьте текущий фрагмент в заметки одним кликом.'],
    4: ['Обработанная расшифровка и заметки создаются автоматически.', 'Перетащите полосу для прослушивания; субтитры подсвечиваются.', 'Экспортируйте или поделитесь заметками в конце.'],
  },
};
function openOnboardingTour() {
  const copy = tourCopy[locale] || tourCopy.en;
  onboardingTourIndex = 0;
  const steps = copy.steps.map((step, index) => `<button type="button" class="onboarding-tour-step${index === 0 ? ' is-active' : ''}" data-onboarding-tour-step="${index}"><em>${String(index + 1).padStart(2, '0')}</em><span>${escapeHtml(step.label)}</span></button>`).join('');
  showOnboardingPage('tour', `<section class="onboarding-tour-page"><button class="onboarding-tour-skip" data-onboarding-tour-skip type="button">${escapeHtml(copy.skip)}</button><header class="onboarding-tour-head"><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${escapeHtml(copy.title)}</h1><div class="onboarding-intro"><p>${escapeHtml(copy.intro)}</p></div></header><div class="onboarding-tour"><div class="onboarding-tour-stage" data-onboarding-tour-stage></div><div class="onboarding-tour-side"><div class="onboarding-tour-steps">${steps}</div><div class="onboarding-tour-copy" data-onboarding-tour-copy></div><div class="onboarding-tour-actions"><button class="secondary" type="button" data-onboarding-tour-prev hidden>${escapeHtml(copy.back)}</button><button class="modal-action" type="button" data-onboarding-tour-next>${escapeHtml(copy.next)}</button></div></div></div><small class="onboarding-tour-hint">${escapeHtml(copy.hint)}</small></section>`);
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
  return `<aside class="sidebar"><button class="brand"><span class="brand-mark">言</span><img src="./assets/brevia-logo.svg" alt="brevia" /></button><button class="new-meeting${index === 1 ? ' is-tour-highlight' : ''}"><span class="new-meeting-icon">+</span><span class="new-meeting-label">${escapeHtml(t('开始会议'))}</span></button><nav>${items.map(([id, icon, label]) => `<button class="nav-item${id === 'all' ? ' active' : ''}"><span>${icon}</span>${escapeHtml(label)}</button>`).join('')}</nav></aside>`;
}
function tourView(index, demo) {
  const meetingName = demo.meeting || tourMeetingFallback[locale] || 'Meeting';
  const aiSuggestionLabel = tourAiSuggestionFallback[locale] || 'AI';
  const aiToggleLabel = (aiAssistCopy[locale] || aiAssistCopy.en).toggleOff;
  const liveHeader = (time) => `<header class="live-header tour-anim" style="--tour-delay:0ms"><div class="live-title"><strong>${escapeHtml(meetingName)}</strong><div class="live-status"><span class="recording"><i></i>${escapeHtml(t('正在录制'))}</span><time>${time}</time><span class="save-state"><svg class="check-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg>${escapeHtml(t('已保存'))}</span></div></div><div class="live-caption-controls"><button class="floating-caption-toggle">${escapeHtml(t('悬浮字幕'))}</button><button class="translation-toggle">${escapeHtml(t('译文: 关'))}</button></div><button class="pause-button">Ⅱ ${escapeHtml(t('暂停'))}</button><button class="end-button">${escapeHtml(t('结束会议'))}</button></header>`;
  const liveModeIcon = (path) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  const captionsPanel = (segments) => `<section class="live-captions tour-anim" style="--tour-delay:160ms"><header class="live-section-head"><p class="eyebrow">${escapeHtml(t('实时字幕'))}</p><button class="live-mode-toggle" data-toggle-live-mode="notes" aria-label="${escapeHtml(t('返回笔记'))}" title="${escapeHtml(t('返回笔记'))}">${liveModeIcon('m10 3-5 5 5 5')}</button></header><div class="transcript-scroll">${segments}</div></section>`;
  const segment = (time, speaker, text, delay = 220) => `<div class="segment tour-anim" style="--tour-delay:${delay}ms"><div class="segment-meta"><time>${time}</time><button class="segment-speaker">${escapeHtml(speaker)}</button></div><div class="segment-copy"><p>${escapeHtml(text)}</p></div></div>`;
  switch (index) {
    case 0: {
      const rows = demo.meetings.map(([title, meta, tags], i) => `<article class="meeting-row tour-anim" style="--tour-delay:${160 + i * 110}ms"><div class="meeting-main"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(meta)}</p><div class="meeting-tags">${(tags || []).map((tag) => `<div class="tag">${escapeHtml(tag)}</div>`).join('')}</div></div><div class="meeting-status"><span class="status">${escapeHtml(t('已精修'))}</span><small>${escapeHtml(demo.time || '14:20')}</small></div><div class="meeting-actions"><button class="more">•••</button></div></article>`).join('');
      return `<section class="view active" id="home-view"><div class="page-head"><div><button class="eyebrow tour-anim" type="button">${escapeHtml(t('会议库'))}</button><h1 class="tour-anim" style="--tour-delay:70ms">${escapeHtml(t('每一场对话，都留有依据。'))}</h1></div></div><div class="library-toolbar tour-anim" style="--tour-delay:110ms"><div class="library-search"><label class="search"><span>⌕</span><input type="search" placeholder="${escapeHtml(t('搜索会议、字幕或说话人…'))}" /></label></div></div><section class="meeting-list">${rows}</section></section>`;
    }
    case 1:
      return `<section class="view active" id="prepare-view"><button class="back tour-anim">← ${escapeHtml(t('返回会议库'))}</button><div class="prepare-layout"><div class="tour-anim" style="--tour-delay:60ms"><p class="eyebrow">${escapeHtml(t('准备录制'))}</p><h1>${escapeHtml(t('开始一场会议'))}</h1><form><label>${escapeHtml(t('会议名称'))}<input value="${escapeHtml(demo.name)}" /></label><div class="form-grid"><label>${escapeHtml(t('会议语言'))}<input value="${escapeHtml(demo.language)}" /></label><label>${escapeHtml(t('译文目标'))}<input value="${escapeHtml(demo.translation || t('不需要翻译'))}" /></label></div><fieldset><legend>${escapeHtml(t('录制音频'))}</legend><label class="choice"><input type="checkbox" checked /><span><b>${escapeHtml(t('我的麦克风'))}</b><small>${escapeHtml(t('系统默认麦克风'))}</small></span><strong class="input-state"><i class="input-meter" style="--level:.72"></i><span>${escapeHtml(t('输入良好'))}</span></strong></label><label class="choice"><input type="checkbox" checked /><span><b>${escapeHtml(t('系统音频'))}</b><small>${escapeHtml(t('需要授予屏幕与系统音频权限'))}</small></span><strong class="input-state"><span>${escapeHtml(t('已就绪'))}</span></strong></label></fieldset><button class="primary-action wide tour-anim" style="--tour-delay:200ms">${escapeHtml(t('开始录制'))} <span>→</span></button></form></div></div></section>`;
    case 2: {
      const segments = demo.segments.map(([speaker, text], i) => segment(`${String((i * 3) + 2).padStart(2, '0')}:00`, speaker, text, 240 + i * 130)).join('');
      return `<section class="view active" id="live-view">${liveHeader('04:23')}<div class="live-layout"><section class="live-notes tour-anim" style="--tour-delay:120ms"><header class="live-section-head"><p class="eyebrow">${escapeHtml(t('我的笔记'))}</p><button class="ai-assist-toggle"><span class="ai-assist-toggle-star">✦</span> ${escapeHtml(aiToggleLabel)}</button><button class="live-mode-toggle" data-toggle-live-mode="caption" aria-label="${escapeHtml(t('展开字幕'))}" title="${escapeHtml(t('展开字幕'))}">${liveModeIcon('m6 3 5 5-5 5')}</button></header><div class="notes-editor">${(demo.notes || []).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div></section>${captionsPanel(segments)}</div></section>`;
    }
    case 3: {
      // AI 纪要步骤的 demo 只含 decision/actions，无字幕；回退到上一步（实时字幕）的片段，
      // 避免渲染出空说话人 + 空文本的字幕行。
      const live = demo.live || demo.segments?.[0] || (tourCopy[locale] || tourCopy.en).steps[2].demo.segments?.[0] || [];
      return `<section class="view active" id="live-view">${liveHeader('07:41')}<div class="live-layout"><section class="live-notes tour-anim" style="--tour-delay:120ms"><header class="live-section-head"><p class="eyebrow">${escapeHtml(t('我的笔记'))}</p><button class="ai-assist-toggle is-enabled"><span class="ai-assist-toggle-star">✦</span> ${escapeHtml(aiToggleLabel)}</button><button class="live-mode-toggle" data-toggle-live-mode="caption" aria-label="${escapeHtml(t('展开字幕'))}" title="${escapeHtml(t('展开字幕'))}">${liveModeIcon('m6 3 5 5-5 5')}</button></header><div class="ai-suggestion tour-anim" style="--tour-delay:220ms"><div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">✦</span><span class="ai-suggestion-type">${escapeHtml(aiSuggestionLabel)}</span></div><p class="ai-suggestion-text">${escapeHtml(demo.decision)}</p></div></div><div class="notes-editor tour-anim" style="--tour-delay:320ms">${(demo.actions || []).map((action) => `<p>• ${escapeHtml(action)}</p>`).join('')}</div></section>${captionsPanel(segment('00:02', live[0] || '', live[1] || '', 300))}</div></section>`;
    }
    case 4: {
      const meta = demo.meta || (tourCopy[locale] || tourCopy.en).steps[0].demo.meetings[0]?.[1] || '';
      return `<section class="view active" id="detail-view"><button class="back tour-anim">← ${escapeHtml(t('返回会议库'))}</button><header class="detail-head tour-anim" style="--tour-delay:60ms"><div><p class="eyebrow">${escapeHtml(t('本地会议'))}</p><h1>${escapeHtml(meetingName)}</h1><p class="detail-meta">${escapeHtml(meta)}</p></div><div class="detail-actions"><button class="secondary">${escapeHtml(t('分享'))}</button><button class="primary-action">${escapeHtml(t('导出'))} <span>↓</span></button></div></header><section class="player tour-anim" style="--tour-delay:140ms"><button class="play">▶</button><button class="skip">↶ 15</button><button class="skip">15 ↷</button><span class="player-time">00:00</span><input type="range" min="0" max="1" value="0" /><span>${escapeHtml(t('本地录音'))}</span><div class="player-speed flow-select"><button class="flow-select-toggle" type="button">1× <span>⌄</span></button></div></section><div class="detail-layout"><section class="final-transcript tour-anim" style="--tour-delay:220ms"><div class="tabbar"><div class="tabbar-tabs"><button class="tab active">${escapeHtml(t('精修字幕'))}</button><button class="tab">${escapeHtml(t('原始转写'))}</button></div><button class="tabbar-action">${escapeHtml(t('更多'))}</button></div><div class="refined-fulltext"><div class="refined-fulltext-body">${escapeHtml(demo.refined)}</div></div></section><aside class="notes tour-anim" style="--tour-delay:300ms"><div class="tabbar"><div class="tabbar-tabs"><button class="tab active">${escapeHtml(t('会议纪要'))}</button></div></div><div class="detail-notes-panel"><p>${escapeHtml(demo.summary)}</p></div></aside></div></section>`;
    }
  }
  return '';
}

function updateOnboardingLanguageCopy(nextLocale) {
  if (!onboardingPage || onboardingPreviewLocale === nextLocale) return;
  onboardingPreviewLocale = nextLocale;
  onboardingSelectedLocale = nextLocale;
  const [title, prompt, continueLabel] = onboardingLanguageCopy[nextLocale] || onboardingLanguageCopy.en;
  const copy = onboardingCopy[nextLocale] || onboardingCopy.en;
  const nodes = onboardingPage.querySelectorAll('.onboarding-page-copy');
  nodes.forEach((node) => node.classList.add('locale-out'));
  window.setTimeout(() => {
    onboardingPage.querySelector('h1').textContent = title;
    onboardingPage.querySelector('.onboarding-page-copy p').textContent = prompt;
    onboardingPage.querySelector('small').textContent = copy.languageHint;
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
  clearInterval(onboardingAiDemoTimer);
  clearInterval(onboardingSummaryDemoTimer);
  void breviaClient?.stopPreview();
  page.classList.remove('onboarding-page-enter');
  page.classList.add('onboarding-page-leave');
  window.setTimeout(() => {
    page.remove();
    if (onboardingPage === page) onboardingPage = undefined;
    next?.();
  }, 260);
}

async function openOnboardingSetup() {
  try { if (initializationPromise) await initializationPromise; }
  catch (error) { showToast(`${t('配置或后端启动失败')}: ${error.message}`); openOnboardingPermissions(); return; }
  const copy = onboardingCopy[locale] || onboardingCopy.en;
  const modelListLabels = onboardingModelListLabel[locale] || onboardingModelListLabel.en;
  const securityHint = onboardingSecurityCopy[locale] || onboardingSecurityCopy.en;
  const choices = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];
  const defaults = new Set(window.BreviaOnboarding.defaultMeetingLanguages(locale));
  const perfMode = getPerformanceMode();
  const performanceModes = [['standard', '性能模式', '标准模式：开启实时降噪与实时精修，体验最佳，适合性能较强的设备。'], ['efficiency', '效率模式', '关闭实时降噪，使用轻量模型二次精修。']].map(([value, title, detail]) => `<label class="onboarding-ai-level${perfMode === value ? ' is-selected' : ''}"><input type="radio" name="onboarding-performance-mode" value="${value}"${perfMode === value ? ' checked' : ''} /><span><b>${escapeHtml(t(title))}${recommendTag(value === 'standard' ? !deviceIsWeak() : deviceIsWeak())}</b><small>${escapeHtml(t(detail))}</small></span></label>`).join('');
  showOnboardingPage('setup', `<section class="onboarding-setup-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="${t('返回')}">←</button><header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${copy.modelsTitle}</h1><div class="onboarding-intro"><p>${copy.meetingHint} ${copy.modelsHint}</p><small>${securityHint}</small></div></header><section class="onboarding-section"><h2>${t('性能模式')}</h2><div class="onboarding-ai-levels">${performanceModes}</div></section><section class="onboarding-section"><h2>${copy.meetingTitle}</h2><div class="onboarding-language-selection"><div class="onboarding-check-grid">${choices.map((code) => `<label><input type="checkbox" name="onboarding-language" value="${code}"${defaults.has(code) ? ' checked' : ''} /><span>${new Intl.DisplayNames([locale], { type: 'language' }).of(code)}</span></label>`).join('')}</div><aside class="onboarding-model-preview"><strong>${modelListLabels[0]}</strong><ul data-onboarding-language-models></ul></aside></div></section><section class="onboarding-section"><h2>${t('离线功能')}</h2><div class="onboarding-language-selection onboarding-feature-selection"><div class="onboarding-feature-grid">${copy.capabilities.slice(-1).map((capability) => `<label><input type="checkbox" name="onboarding-denoiser" checked /><span>${capability}</span></label>`).join('')}<label><input type="checkbox" name="onboarding-translation" checked /><span>${copy.translation}</span></label></div><aside class="onboarding-model-preview"><strong>${modelListLabels[1]}</strong><ul data-onboarding-feature-models></ul></aside></div></section><section class="onboarding-model-summary"><strong>${copy.estimate}: <span data-onboarding-estimate></span></strong>${chinaModelSourceToggle()}</section><div class="onboarding-actions"><button class="modal-action" data-download-onboarding-models type="button">${copy.download}</button><button class="secondary" data-customize-onboarding-models type="button">${copy.customize}</button><button class="secondary" data-finish-onboarding type="button">${copy.later}</button></div></section>`);
  updateOnboardingSetup();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-performance-mode"]')) {
      setPerformanceMode(event.target.value);
      onboardingPage.querySelectorAll('.onboarding-ai-level').forEach((level) => level.classList.toggle('is-selected', level.querySelector('input').checked));
      updateOnboardingSetup();
    }
    if (event.target.matches('[name="onboarding-language"], [name="onboarding-denoiser"], [name="onboarding-translation"]')) updateOnboardingSetup();
    if (event.target.matches('[data-china-model-source]')) localStorage.setItem('brevia-china-model-source', event.target.checked);
  });
  onboardingPage.addEventListener('click', (event) => {
    if (event.target.closest('[data-onboarding-back-language]')) { dismissOnboardingPage(openOnboardingPermissions); return; }
    if (event.target.closest('[data-download-onboarding-models]')) { window.BreviaOnboarding.beginDownloads(onboardingModelIds); downloadRequiredModels(onboardingModelIds); dismissOnboardingPage(openOnboardingAi); return; }
    if (event.target.closest('[data-customize-onboarding-models]')) { onboardingModelSelection = new Set(onboardingModelIds); void openModal('models'); return; }
    if (event.target.closest('[data-finish-onboarding]')) dismissOnboardingPage(openOnboardingAi);
  });
}

function updateOnboardingSetup() {
  const languages = [...onboardingPage.querySelectorAll('[name="onboarding-language"]:checked')].map((input) => input.value);
  const uniqueModelIds = (details) => details.map(([modelId]) => modelId).filter((modelId, index, models) => modelId && models.indexOf(modelId) === index);
  const languageModels = uniqueModelIds(languages.flatMap((language) => {
    const [streaming, , , refined] = requiredModelsForLanguage(language);
    return [[streaming], [refined]];
  }));
  const featureModels = [
    onboardingPage.querySelector('[name="onboarding-denoiser"]')?.checked && 'gtcrn-live-denoiser',
    onboardingPage.querySelector('[name="onboarding-translation"]')?.checked && 'hy-mt2-1.8b-q4km',
  ].filter(Boolean);
  const models = [...languageModels, ...featureModels];
  onboardingModelIds = models.filter((modelId) => !modelPaths.has(modelId));
  const size = onboardingModelIds.reduce((total, modelId) => total + modelSize(modelId), 0);
  onboardingPage.querySelector('[data-onboarding-estimate]').textContent = formatBytes(size);
  const renderModels = (models) => models.map((modelId) => `<li><span>${escapeHtml(modelDisplayName(modelId))}</span><small>${modelPaths.has(modelId) ? (modelLabels[locale] || modelLabels.en).installed : formatBytes(modelSize(modelId))}</small></li>`).join('');
  onboardingPage.querySelector('[data-onboarding-language-models]').innerHTML = renderModels(languageModels);
  onboardingPage.querySelector('[data-onboarding-feature-models]').innerHTML = renderModels(featureModels);
}

function finishOnboarding() {
  window.BreviaOnboarding.complete();
  closeModal();
}
// Onboarding 的 AI 辅助配置页（PRD §22）：离线功能配置之后进入。
const aiOnboardingCopy = {
  zh: { title: '启用 AI 功能', intro: '言录提供两项可独立开启的 AI 能力：会后生成会议纪要，以及会中实时协助记录。', meetingNotesTitle: 'AI 会议纪要', meetingNotesDesc: '会议结束后，AI 自动把整场对话整理成一份纪要。', meetingNotesConsequence: '不生成纪要也能正常录制与出字幕；之后可在「AI 会议总结」设置里随时开启。', wayTitle: '会议纪要使用哪种 AI？', wayHint: '内置 AI 在本机运行；在线 AI 使用你的 API Key。', builtin: '内置 AI', builtinHint: '免费、离线，数据更私密；会占用电脑性能，分析速度取决于本机性能。首次下载约 1–2 GB。', online: '在线 AI 供应商', onlineHint: '使用你自己的 API Key；对电脑性能占用更小，分析速度取决于网络状况。', configureOnline: '配置在线服务', liveNotesTitle: 'AI 笔记', liveNotesDesc: '在会议中，AI 实时提示重点、决策与待办，辅助记录笔记。', liveNotesConsequence: '不开 AI 笔记，仍会得到 AI 会议纪要；只是会中没有实时建议。', enableLiveNotes: '启用 AI 笔记', proactivityTitle: 'AI 笔记如何协助记录？', proactivityHint: '选得越主动，AI 介入越多；随时可在「AI 笔记」设置里调整。', offEmpty: '已选择暂不开启 AI 笔记，会中不会出现实时建议；会议结束后仍会生成 AI 会议纪要。', levels: [['off', '暂不开启 AI 笔记', '仅使用会后 AI 会议纪要，会中不产生实时建议。'], ['quiet', '只在我需要时', '只有你点击 AI、选中文字或主动要求时才出现。'], ['assist', '发现重点时提醒我', '发现结论、决策、待办、重要数字时适度提醒。'], ['auto', '自动帮我整理', '自动归纳结论、收集待办并整理会议内容。']], demo: { recording: '正在录制', meeting: '会议 ', transcript: '实时字幕', transcriptText: '“我们周五完成验收。”', notes: '我的笔记', scenes: { quiet: [['仅在需要时', '✦ AI 建议：确认截止时间', '• 周五前完成内部验收'], ['仅在需要时', '✦ AI 建议：记录待办', '• 产品团队跟进验收']], assist: [['发现重点', '✦ AI 建议：重要决策', '• 下周一开始小范围发布'], ['发现重点', '✦ AI 建议：行动项', '• 开发团队周四交付测试版']], auto: [['自动整理', '✦ AI 正在整理会议内容', '会议结论\n周五完成验收'], ['自动整理', '✦ AI 正在归纳待办', '下一步\n准备测试版本']] } }, finish: '完成', skip: '暂不启用' },
  en: { title: 'Set up AI features', intro: 'Brevia has two AI features for different purposes. You can turn each on or off:', meetingNotesTitle: 'AI meeting summary', meetingNotesDesc: 'After the meeting, AI automatically distills the whole conversation into a summary (conclusions, actions, risks). It runs once, so it works smoothly even on low-end devices.', meetingNotesConsequence: 'Recording and captions work fine without a summary; you can turn it on anytime in the AI meeting summary settings.', wayTitle: 'Which AI for the meeting summary?', wayHint: 'Built-in AI: free, offline, more private, downloads about 1–2 GB once. Online AI: uses your own API key, faster but needs internet and may cost money.', builtin: 'Built-in AI', builtinHint: 'Free, offline, most private. Downloads about 1–2 GB once.', online: 'Online AI', onlineHint: 'Uses your own API key online, faster, may cost money; only text is sent.', configureOnline: 'Configure online service', liveNotesTitle: 'AI notes (real-time suggestions)', liveNotesDesc: 'During the meeting, AI suggests key points, decisions, and actions in real time. It keeps using resources, so we suggest turning it off on low-end devices.', liveNotesConsequence: 'Without AI notes you still get the AI meeting summary; you just won’t get in-meeting suggestions.', enableLiveNotes: 'Enable AI notes', proactivityTitle: 'How should AI notes help?', proactivityHint: 'The more proactive, the more AI chimes in. You can adjust this anytime in the AI notes settings.', offEmpty: 'AI notes are off for now, so you won’t see in-meeting suggestions; you’ll still get the post-meeting AI summary.', levels: [['off', 'Don’t enable AI notes yet', 'Only use the post-meeting AI summary; no in-meeting suggestions.'], ['quiet', 'Only when I ask', 'Appears only when you click AI, select text, or ask directly.'], ['assist', 'Notify me of key points', 'Lightly notifies you about conclusions, decisions, actions, and key figures.'], ['auto', 'Organize for me automatically', 'Automatically summarizes conclusions and organizes the meeting.']], demo: { recording: 'Recording', meeting: 'Meeting ', transcript: 'Live transcript', transcriptText: '“We’ll complete acceptance on Friday.”', notes: 'My notes', scenes: { quiet: [['When needed', '✦ AI suggestion: confirm deadline', '• Finish internal acceptance by Friday'], ['When needed', '✦ AI suggestion: capture action', '• Product team follows up on acceptance']], assist: [['Key point found', '✦ AI suggestion: key decision', '• Start a limited rollout next Monday'], ['Key point found', '✦ AI suggestion: action item', '• Engineering delivers a test build Thursday']], auto: [['Auto organize', '✦ AI is organizing the meeting', '## Decision\n- Complete acceptance Friday'], ['Auto organize', '✦ AI is grouping actions', '## Next step\n- Prepare a test build']] } }, finish: 'Done', skip: 'Not now' },
  es: { title: 'Activar funciones de IA', intro: 'Brevia tiene dos funciones de IA con distintos fines. Puedes activar cada una por separado:', meetingNotesTitle: 'Resumen de reunión con IA', meetingNotesDesc: 'Tras la reunión, la IA resume toda la conversación en una nota de reunión.', meetingNotesConsequence: 'La grabación y los subtítulos funcionan sin resumen; puedes activarlo cuando quieras en los ajustes de resumen.', wayTitle: '¿Qué IA para el resumen?', wayHint: 'IA integrada: gratis, sin conexión y más privada; descarga una vez unos 1–2 GB. IA en línea: usa tu propia clave API, más rápida pero requiere conexión y puede costar.', builtin: 'IA integrada', builtinHint: 'Gratis, sin conexión, más privada. Descarga una vez ~1–2 GB.', online: 'IA en línea', onlineHint: 'Usa tu clave API en línea, más rápida, puede costar; solo texto.', configureOnline: 'Configurar servicio en línea', liveNotesTitle: 'Notas IA', liveNotesDesc: 'Durante la reunión, la IA sugiere puntos clave, decisiones y tareas en tiempo real para ayudarte a tomar notas.', liveNotesConsequence: 'Sin notas IA sigues teniendo el resumen de la reunión; solo pierdes las sugerencias en directo.', enableLiveNotes: 'Activar notas IA', proactivityTitle: '¿Cómo deben ayudar las notas IA?', proactivityHint: 'Cuanto más proactiva, más interviene la IA. Puedes ajustarlo cuando quieras en los ajustes de notas IA.', offEmpty: 'Has elegido no activar las notas IA por ahora; no verás sugerencias en tiempo real y seguirás teniendo el resumen tras la reunión.', levels: [['off', 'No activar notas IA todavía', 'Usar solo el resumen con IA; sin sugerencias en la reunión.'], ['quiet', 'Solo cuando lo pida', 'Aparece solo cuando haces clic en IA, seleccionas texto o lo pides.'], ['assist', 'Avisarme de puntos clave', 'Avisa de conclusiones, decisiones, tareas y cifras clave.'], ['auto', 'Organizar automáticamente', 'Resume conclusiones y organiza la reunión automáticamente.']], finish: 'Listo', skip: 'Ahora no' },
  ja: { title: 'AI 機能を有効にする', intro: 'Brevia には用途の異なる 2 つの AI 機能があります。それぞれ個別にオン/オフできます：', meetingNotesTitle: 'AI 会議要約', meetingNotesDesc: '会議後に AI が会話全体を会議メモにまとめます。', meetingNotesConsequence: '要約なしでも録音・字幕は正常に動作します。後からいつでも「AI 会議要約」設定で有効にできます。', wayTitle: '会議要約にはどの AI を使いますか？', wayHint: '内蔵 AI：無料・オフライン・よりプライベート。初回に約 1〜2 GB をダウンロード。オンライン AI：自分の API キーを使用。より速いが接続と費用がかかる場合があります。', builtin: '内蔵 AI', builtinHint: '無料・オフライン・よりプライベート。初回約 1〜2 GB。', online: 'オンライン AI', onlineHint: '自分の API キーで接続。より速いが費用の可能性。テキストのみ送信。', configureOnline: 'オンラインサービスを設定', liveNotesTitle: 'AI メモ', liveNotesDesc: '会議中に AI が要点・決定・タスクをリアルタイムで提示し、メモ取りを支援します。', liveNotesConsequence: 'AI メモをオフにしても AI 会議要約は得られます。会議中のリアルタイム提案だけがなくなります。', enableLiveNotes: 'AI メモを有効にする', proactivityTitle: 'AI メモはどのように手伝いますか？', proactivityHint: 'より積極的に設定するほど、AI の介入が増えます。あとでいつでも「AIメモ」設定で変更できます。', offEmpty: 'AI メモをまだ有効にしていないため、会議中のリアルタイム提案はありません。会議後も AI 会議要約は生成されます。', levels: [['off', 'AI メモはまだ使わない', '会後の AI 会議要約のみ使用。会議中の提案はありません。'], ['quiet', '必要なときだけ', 'クリックや選択、直接依頼したときだけ表示。'], ['assist', '要点を知らせる', '結論・決定・ToDo・重要な数字を適度に知らせます。'], ['auto', '自動で整理する', '結論をまとめ、会議内容を自動整理します。']], finish: '完了', skip: 'あとで' },
  ko: { title: 'AI 기능 사용', intro: 'Brevia에는 용도가 다른 두 가지 AI 기능이 있습니다. 각각 따로 켜고 끌 수 있습니다:', meetingNotesTitle: 'AI 회의 요약', meetingNotesDesc: '회의가 끝나면 AI가 전체 대화를 회의 요약으로 정리합니다.', meetingNotesConsequence: '요약이 없어도 녹음과 자막은 정상 작동합니다. 나중에 언제든 "AI 회의 요약" 설정에서 켤 수 있습니다.', wayTitle: '회의 요약에 어떤 AI를 쓸까요?', builtin: '내장 AI', builtinHint: '무료·오프라인·더 사적. 처음 약 1~2GB.', online: '온라인 AI', onlineHint: '자신의 API 키로 연결. 더 빠르고 비용 가능. 텍스트만 전송.', configureOnline: '온라인 서비스 구성', liveNotesTitle: 'AI 메모', liveNotesDesc: '회의 중 AI가 핵심·결정·할 일을 실시간으로 제안해 메모 작성을 돕습니다.', liveNotesConsequence: 'AI 메모를 꺼도 AI 회의 요약은 받습니다. 회의 중 실시간 제안만 사라집니다.', enableLiveNotes: 'AI 메모 사용', proactivityTitle: 'AI 메모는 어떻게 도와줄까요?', offEmpty: 'AI 메모를 아직 켜지 않아 회의 중 실시간 제안이 없습니다. 회의 후에도 AI 회의 요약은 생성됩니다.', levels: [['off', 'AI 메모 아직 사용 안 함', '회의 후 AI 요약만 사용합니다. 회의 중 제안은 없습니다.'], ['quiet', '필요할 때만', '클릭, 선택 또는 직접 요청할 때만 표시됩니다.'], ['assist', '핵심 포인트 알림', '결론·결정·할 일·중요 수치를 적절히 알립니다.'], ['auto', '자동으로 정리', '결론을 요약하고 회의를 자동 정리합니다.']], finish: '완료', skip: '나중에' },
  fr: { title: "Activer les fonctions IA", intro: "Brevia a deux fonctions IA à des fins différentes. Vous pouvez activer chacune séparément :", meetingNotesTitle: "Résumé de réunion IA", meetingNotesDesc: "Après la réunion, l'IA résume toute la conversation en une note de réunion.", meetingNotesConsequence: "L'enregistrement et les sous-titres fonctionnent sans résumé ; vous pourrez l'activer à tout moment dans les réglages du résumé.", wayTitle: "Quelle IA pour le résumé ?", wayHint: "IA intégrée : gratuite, hors ligne et plus privée ; télécharge environ 1–2 Go une fois. IA en ligne : utilise votre propre clé API, plus rapide mais nécessite internet et peut coûter.", builtin: "IA intégrée", builtinHint: "Gratuite, hors ligne, plus privée. ~1–2 Go une fois.", online: "IA en ligne", onlineHint: "Votre clé API en ligne, plus rapide, peut coûter ; texte seul.", configureOnline: 'Configurer le service en ligne', liveNotesTitle: "Notes IA", liveNotesDesc: "Pendant la réunion, l'IA suggère points clés, décisions et tâches en temps réel pour vous aider à prendre des notes.", liveNotesConsequence: "Sans notes IA, vous avez toujours le résumé de réunion ; seules les suggestions en direct disparaissent.", enableLiveNotes: "Activer les notes IA", proactivityTitle: "Comment les notes IA doivent-elles aider ?", proactivityHint: "Plus c'est proactif, plus l'IA intervient. Ajustable à tout moment dans les réglages des notes IA.", offEmpty: "Vous avez choisi de ne pas activer les notes IA pour l'instant : aucune suggestion en temps réel, mais vous aurez toujours le résumé IA après la réunion.", levels: [['off', "Ne pas activer les notes IA pour l'instant", "Utiliser uniquement le résumé IA après réunion ; aucune suggestion en direct."], ['quiet', 'Seulement quand je demande', "N'apparaît que lorsque vous cliquez, sélectionnez du texte ou demandez."], ['assist', "M'alerter des points clés", 'Alerte sur les conclusions, décisions, tâches et chiffres clés.'], ['auto', 'Organiser automatiquement', 'Résume les conclusions et organise la réunion automatiquement.']], finish: 'Terminé', skip: 'Pas maintenant' },
  de: { title: 'KI-Funktionen aktivieren', intro: 'Brevia hat zwei KI-Funktionen für unterschiedliche Zwecke. Sie können jede einzeln an- oder ausschalten:', meetingNotesTitle: 'KI-Besprechungszusammenfassung', meetingNotesDesc: 'Nach der Besprechung fasst die KI das ganze Gespräch in einer Zusammenfassung zusammen.', meetingNotesConsequence: 'Aufnahme und Untertitel funktionieren auch ohne Zusammenfassung; Sie können sie jederzeit in den Einstellungen aktivieren.', wayTitle: 'Welche KI für die Zusammenfassung?', wayHint: 'Integrierte KI: kostenlos, offline und am privatesten; einmaliger Download von ca. 1–2 GB. Online-KI: eigener API-Schlüssel, schneller, benötigt aber Internet und kann kosten.', builtin: 'Integrierte KI', builtinHint: 'Kostenlos, offline, am privatesten. Einmal ca. 1–2 GB.', online: 'Online-KI', onlineHint: 'Eigener API-Schlüssel online, schneller, kann kosten; nur Text.', configureOnline: 'Onlinedienst konfigurieren', liveNotesTitle: 'KI-Notizen', liveNotesDesc: 'Während der Besprechung schlägt die KI Punkte, Entscheidungen und Aufgaben in Echtzeit vor und hilft beim Mitschreiben.', liveNotesConsequence: 'Ohne KI-Notizen erhalten Sie weiterhin die Zusammenfassung; nur die Echtzeit-Vorschläge entfallen.', enableLiveNotes: 'KI-Notizen aktivieren', proactivityTitle: 'Wie sollen KI-Notizen helfen?', proactivityHint: 'Je proaktiver, desto mehr greift die KI ein. Sie können dies jederzeit in den KI-Notizen-Einstellungen anpassen.', offEmpty: 'KI-Notizen sind vorerst deaktiviert, daher keine Echtzeit-Vorschläge; die KI-Zusammenfassung nach der Besprechung erhalten Sie trotzdem.', levels: [['off', 'KI-Notizen noch nicht aktivieren', 'Nur die KI-Zusammenfassung nach der Besprechung; keine Echtzeit-Vorschläge.'], ['quiet', 'Nur wenn ich frage', 'Erscheint nur beim Klicken, Auswählen oder direkter Anfrage.'], ['assist', 'Über Kernpunkte informieren', 'Hinweise auf Schlussfolgerungen, Entscheidungen, Aufgaben und Zahlen.'], ['auto', 'Automatisch ordnen', 'Fasst Schlussfolgerungen zusammen und ordnet die Besprechung automatisch.']], finish: 'Fertig', skip: 'Später' },
  ru: { title: 'Включить функции ИИ', intro: 'В Brevia есть две функции ИИ для разных целей. Каждую можно включать отдельно:', meetingNotesTitle: 'ИИ-сводка встречи', meetingNotesDesc: 'После встречи ИИ сводит весь разговор в сводку встречи.', meetingNotesConsequence: 'Запись и субтитры работают и без сводки; её можно включить в любой момент в настройках ИИ-сводки.', wayTitle: 'Какой ИИ для сводки?', wayHint: 'Встроенный ИИ: бесплатно, офлайн и максимально приватно; одноразовое скачивание около 1–2 ГБ. Онлайн-ИИ: свой ключ API, быстрее, но нужен интернет и возможны расходы.', builtin: 'Встроенный ИИ', builtinHint: 'Бесплатно, офлайн, приватно. Один раз ~1–2 ГБ.', online: 'Онлайн-ИИ', onlineHint: 'Свой ключ API онлайн, быстрее, может стоить; только текст.', configureOnline: 'Настроить онлайн-сервис', liveNotesTitle: 'ИИ-заметки', liveNotesDesc: 'Во время встречи ИИ в реальном времени подсказывает ключевые моменты, решения и задачи, помогая вести заметки.', liveNotesConsequence: 'Без ИИ-заметок вы всё равно получите ИИ-сводку встречи; пропадут лишь подсказки во время встречи.', enableLiveNotes: 'Включить ИИ-заметки', proactivityTitle: 'Как ИИ-заметки должны помогать?', proactivityHint: 'Чем активнее, тем больше вмешивается ИИ. Это можно изменить в любой момент в настройках ИИ-заметок.', offEmpty: 'Вы пока не включили ИИ-заметки, поэтому во время встречи подсказок не будет; ИИ-сводку после встречи вы всё равно получите.', levels: [['off', 'Пока не включать ИИ-заметки', 'Только ИИ-сводка после встречи; без подсказок во время встречи.'], ['quiet', 'Только когда попрошу', 'Появляется только при клике, выборе текста или прямой просьбе.'], ['assist', 'Сообщать о ключевых моментах', 'Сообщает о выводах, решениях, задачах и важных цифрах.'], ['auto', 'Упорядочивать автоматически', 'Автоматически резюмирует выводы и упорядочивает встречу.']], finish: 'Готово', skip: 'Не сейчас' },
};
const aiOnboardingDemoCopy = {
  es: { recording: 'Grabando', meeting: 'Reunión ', transcript: 'Transcripción en vivo', transcriptText: '“Terminaremos la aceptación el viernes.”', notes: 'Mis notas', scenes: { quiet: [['Cuando sea necesario', '✦ Sugerencia de IA: confirmar plazo', '• Terminar la aceptación interna el viernes'], ['Cuando sea necesario', '✦ Sugerencia de IA: registrar tarea', '• Producto da seguimiento a la aceptación']], assist: [['Punto clave detectado', '✦ Sugerencia de IA: decisión clave', '• Iniciar despliegue limitado el lunes'], ['Punto clave detectado', '✦ Sugerencia de IA: tarea', '• Ingeniería entrega una versión de prueba el jueves']], auto: [['Organización automática', '✦ La IA organiza la reunión', '## Decisión\n- Completar la aceptación el viernes'], ['Organización automática', '✦ La IA agrupa las tareas', '## Siguiente paso\n- Preparar una versión de prueba']] } },
  ja: { recording: '録音中', meeting: '会議 ', transcript: 'ライブ字幕', transcriptText: '「金曜日に受け入れを完了します。」', notes: '自分のメモ', scenes: { quiet: [['必要なとき', '✦ AI の提案：期限を確認', '• 金曜日までに社内受け入れを完了'], ['必要なとき', '✦ AI の提案：タスクを記録', '• プロダクトチームが受け入れをフォロー']], assist: [['要点を発見', '✦ AI の提案：重要な決定', '• 来週月曜に限定公開を開始'], ['要点を発見', '✦ AI の提案：アクション', '• 開発チームが木曜にテスト版を納品']], auto: [['自動整理', '✦ AI が会議を整理中', '## 決定事項\n- 金曜日に受け入れを完了'], ['自動整理', '✦ AI がタスクを整理中', '## 次の手順\n- テスト版を準備']] } },
  ko: { recording: '녹음 중', meeting: '회의 ', transcript: '실시간 자막', transcriptText: '“금요일에 검수를 완료하겠습니다.”', notes: '내 메모', scenes: { quiet: [['필요할 때', '✦ AI 제안: 마감일 확인', '• 금요일까지 내부 검수 완료'], ['필요할 때', '✦ AI 제안: 할 일 기록', '• 제품팀이 검수를 후속 처리']], assist: [['핵심 포인트 발견', '✦ AI 제안: 주요 결정', '• 다음 주 월요일 제한 배포 시작'], ['핵심 포인트 발견', '✦ AI 제안: 실행 항목', '• 개발팀이 목요일 테스트 빌드 제공']], auto: [['자동 정리', '✦ AI가 회의를 정리 중', '## 결정\n- 금요일에 검수 완료'], ['자동 정리', '✦ AI가 할 일을 정리 중', '## 다음 단계\n- 테스트 빌드 준비']] } },
  fr: { recording: 'Enregistrement', meeting: 'Réunion ', transcript: 'Transcription en direct', transcriptText: '« Nous terminerons la recette vendredi. »', notes: 'Mes notes', scenes: { quiet: [['Au besoin', '✦ Suggestion IA : confirmer l’échéance', '• Terminer la recette interne vendredi'], ['Au besoin', '✦ Suggestion IA : noter une tâche', '• L’équipe produit suit la recette']], assist: [['Point clé détecté', '✦ Suggestion IA : décision clé', '• Lancement limité lundi prochain'], ['Point clé détecté', '✦ Suggestion IA : action', '• L’équipe technique livre une version de test jeudi']], auto: [['Organisation auto', '✦ L’IA organise la réunion', '## Décision\n- Terminer la recette vendredi'], ['Organisation auto', '✦ L’IA regroupe les actions', '## Prochaine étape\n- Préparer une version de test']] } },
  de: { recording: 'Aufnahme läuft', meeting: 'Besprechung ', transcript: 'Live-Transkript', transcriptText: '„Wir schließen die Abnahme am Freitag ab.“', notes: 'Meine Notizen', scenes: { quiet: [['Bei Bedarf', '✦ KI-Vorschlag: Frist bestätigen', '• Interne Abnahme bis Freitag abschließen'], ['Bei Bedarf', '✦ KI-Vorschlag: Aufgabe erfassen', '• Produktteam begleitet die Abnahme']], assist: [['Kernpunkt erkannt', '✦ KI-Vorschlag: wichtige Entscheidung', '• Begrenzten Rollout nächsten Montag starten'], ['Kernpunkt erkannt', '✦ KI-Vorschlag: Aktion', '• Entwicklung liefert Donnerstag einen Test-Build']], auto: [['Automatisch ordnen', '✦ KI ordnet die Besprechung', '## Entscheidung\n- Abnahme am Freitag abschließen'], ['Automatisch ordnen', '✦ KI bündelt Aufgaben', '## Nächster Schritt\n- Test-Build vorbereiten']] } },
  ru: { recording: 'Идёт запись', meeting: 'Встреча ', transcript: 'Субтитры в реальном времени', transcriptText: '«Мы завершим приёмку в пятницу.»', notes: 'Мои заметки', scenes: { quiet: [['По запросу', '✦ Совет ИИ: подтвердить срок', '• Завершить внутреннюю приёмку к пятнице'], ['По запросу', '✦ Совет ИИ: записать задачу', '• Команда продукта сопровождает приёмку']], assist: [['Найден ключевой момент', '✦ Совет ИИ: важное решение', '• Начать ограниченный запуск в следующий понедельник'], ['Найден ключевой момент', '✦ Совет ИИ: задача', '• Разработка сдаёт тестовую сборку в четверг']], auto: [['Автоупорядочивание', '✦ ИИ упорядочивает встречу', '## Решение\n- Завершить приёмку в пятницу'], ['Автоупорядочивание', '✦ ИИ группирует задачи', '## Следующий шаг\n- Подготовить тестовую сборку']] } },
};
// AI 会议纪要演示：会后左下角出现任务卡片（进度条），随后显示整理好的纪要。
const aiOnboardingSummaryDemoCopy = {
  zh: { windowTitle: '会议', task: '生成会议纪要', progress: '正在整理结论与待办…', heading: 'AI 会议纪要', decision: '本周五前完成内部验收，风险点由李娜统一整理。', actions: ['产品团队跟进验收', '开发下周一同步进展'] },
  en: { windowTitle: 'Meeting', task: 'Generating meeting summary', progress: 'Distilling conclusions and to-dos…', heading: 'AI meeting summary', decision: 'Complete internal acceptance by Friday; Mia consolidates the risks.', actions: ['Product team to follow up on acceptance', 'Engineering syncs progress Monday'] },
  es: { windowTitle: 'Reunión', task: 'Generando resumen de reunión', progress: 'Resumiendo conclusiones y tareas…', heading: 'Resumen de reunión con IA', decision: 'Completar la aceptación interna el viernes; Mía consolida los riesgos.', actions: ['El equipo de producto da seguimiento', 'Ingeniería sincroniza el lunes'] },
  ja: { windowTitle: '会議', task: '会議要約を生成中', progress: '結論とタスクを整理中…', heading: 'AI 会議要約', decision: '金曜までに社内受け入れを完了し、リスクは鈴木が整理します。', actions: ['プロダクトチームが受け入れをフォロー', '開発は月曜に同期'] },
  ko: { windowTitle: '회의', task: '회의 요약 생성 중', progress: '결론과 할 일을 정리 중…', heading: 'AI 회의 요약', decision: '금요일까지 내부 검수를 완료하고 리스크는 이나가 정리합니다.', actions: ['제품팀이 검수를 후속 처리', '개발팀은 월요일 동기화'] },
  fr: { windowTitle: 'Réunion', task: 'Génération du résumé', progress: 'Synthèse des conclusions…', heading: 'Résumé de réunion IA', decision: 'Terminer la recette interne vendredi ; Mía consolide les risques.', actions: ["L'équipe produit suit la recette", 'L’ingénierie synchronise lundi'] },
  de: { windowTitle: 'Besprechung', task: 'Zusammenfassung wird erstellt', progress: 'Schlussfolgerungen werden zusammengefasst…', heading: 'KI-Besprechungszusammenfassung', decision: 'Interne Abnahme bis Freitag abschließen; Mia bündelt die Risiken.', actions: ['Produktteam begleitet die Abnahme', 'Entwicklung synchronisiert Montag'] },
  ru: { windowTitle: 'Встреча', task: 'Создание сводки встречи', progress: 'Собираем выводы и задачи…', heading: 'ИИ-сводка встречи', decision: 'Завершить внутреннюю приёмку к пятнице; Миа собирает риски.', actions: ['Команда продукта сопровождает приёмку', 'Разработка синхронизируется в понедельник'] },
};
// 首次引导功能演示（tour）文案。
const tourCopy = {
  zh: {
    title: '三分钟了解言录', intro: '把每一场对话，变成可回看、可检索、可分享的记录。', start: '开始使用', next: '下一步', back: '上一步', skip: '跳过演示',
    hint: '识别、纪要、精修都在本机完成，音频不会上传到云端。',
    steps: [
      { label: '会议库', heading: '可检索的会议库', body: '所有会议按时间归档。你随时可以按名称、逐字稿或标签，快速找回某一场对话。', points: ['搜索会议、逐字稿与标签', '日期范围筛选', '删除后 30 天内可恢复'], callout: 'search', demo: { meetings: [['产品周会 · 2026-08-19', '04:23 · 中文 · 12 位参与者', ['发布计划', '风险']], ['需求评审 · 2026-08-17', '01:48 · 中文 · 6 位参与者', ['评审']]] } },
      { label: '准备会议', heading: '三秒开始一场会议', body: '只需起个名字、选好语言与音频来源，点一下就能开始。', points: ['选择会议语言与翻译目标', '麦克风 + 系统音频双轨录制', '录制前自动加载模型，不依赖网络'], callout: 'form', demo: { name: '会议', language: '中文', device: 'CPU', mode: '标准模式' } },
      { label: '实时字幕', heading: '边开会，边出字幕', body: '低延迟实时转写持续更新当前发言，还能区分不同说话人。', points: ['毫秒级实时字幕', '说话人识别与区分', '可开启悬浮字幕窗口'], callout: 'transcript', demo: { segments: [['张伟', '我们周五前要完成内部验收。'], ['李娜', '好，我把风险点整理出来。'], ['张伟', '那下周一同步进展。']] } },
      { label: 'AI 纪要', heading: 'AI 自动提炼结论与待办', body: '会议过程中 AI 帮你记录重点、提取决策与待办，不遗漏任何行动项。', points: ['自动提炼结论、风险与待办', '支持内置离线 AI 或在线服务', '文本才会发送，音频永远留在本机'], callout: 'notes', demo: { decision: '周五前完成内部验收', actions: ['产品团队跟进验收', '开发下周一同步进展'] } },
      { label: '会议详情', heading: '回放、精修与分享', body: '结束后可回听录音、查看精修后的逐字稿，并导出或分享纪要。', points: ['回放录音并跳转到对应字幕', '会后精修，提升正式记录可读性', '导出与分享会议纪要'], callout: 'player', demo: { refined: '我们确定周五前完成内部验收，风险点由李娜统一整理，下周一同步进展。', summary: '周五前完成内部验收' } },
    ],
  },
  en: {
    title: 'Meet Brevia in three minutes', intro: 'Turn every conversation into a record you can revisit, search, and share.', start: 'Start using', next: 'Next', back: 'Back', skip: 'Skip tour',
    hint: 'Recognition, notes, and refinement all run on this device; your audio never leaves it.',
    steps: [
      { label: 'Library', heading: 'A searchable meeting library', body: 'Every meeting is archived by time. Return to any conversation by name, transcript, or tag.', points: ['Search meetings, transcripts, and tags', 'Filter by date range', 'Restore within 30 days of deletion'], callout: 'search', demo: { meetings: [['Product weekly · 2026-08-19', '04:23 · Chinese · 12 participants', ['Launch', 'Risks']], ['Requirements review · 2026-08-17', '01:48 · Chinese · 6 participants', ['Review']]] } },
      { label: 'Prepare', heading: 'Start a meeting in seconds', body: 'Give it a name, pick a language and audio source, then hit record.', points: ['Choose the meeting language and translation target', 'Record mic and system audio together', 'Models load before recording, so it works offline'], callout: 'form', demo: { name: 'Meeting', language: 'Chinese', device: 'CPU', mode: 'Standard mode' } },
      { label: 'Live captions', heading: 'Captions as you speak', body: 'Low-latency live transcription tracks the current speaker and separates voices.', points: ['Millisecond-level live captions', 'Speaker recognition and separation', 'Optional floating caption window'], callout: 'transcript', demo: { segments: [['Alex', 'We need to complete acceptance by Friday.'], ['Mia', 'Got it, I’ll list the risks.'], ['Alex', 'We’ll sync progress Monday.']] } },
      { label: 'AI notes', heading: 'Key points and actions, automatically', body: 'AI captures decisions and to-dos while you talk, so no action is missed.', points: ['Derive conclusions, risks, and to-dos', 'Built-in offline or online AI', 'Only text is sent; audio stays on device'], callout: 'notes', demo: { decision: 'Complete acceptance by Friday', actions: ['Product team to follow up on acceptance', 'Engineering syncs progress Monday'] } },
      { label: 'Details', heading: 'Play back, refine, and share', body: 'Afterward, replay the audio, read the refined transcript, and export or share notes.', points: ['Replay audio and jump to matching captions', 'Post-meeting refinement for polished records', 'Export and share meeting notes'], callout: 'player', demo: { refined: 'We agreed to complete acceptance by Friday. Mia will consolidate the risks, and we will sync progress on Monday.', summary: 'Complete acceptance by Friday' } },
    ],
  },
  es: {
    title: 'Conoce Brevia en tres minutos', intro: 'Convierte cada conversación en un registro que puedes revisar, buscar y compartir.', start: 'Comenzar', next: 'Siguiente', back: 'Atrás', skip: 'Saltar la guía',
    hint: 'El reconocimiento, las notas y el refinado se ejecutan en este dispositivo; tu audio nunca sale de él.',
    steps: [
      { label: 'Biblioteca', heading: 'Una biblioteca de reuniones consultable', body: 'Cada reunión queda archivada por fecha. Vuelve a cualquier conversación por nombre, transcripción o etiqueta.', points: ['Busca reuniones, transcripciones y etiquetas', 'Filtra por rango de fechas', 'Restaura hasta 30 días después de eliminar'], callout: 'search', demo: { meetings: [['Reunión semanal de producto · 2026-08-19', '04:23 · Chino · 12 participantes', ['Lanzamiento', 'Riesgos']], ['Revisión de requisitos · 2026-08-17', '01:48 · Chino · 6 participantes', ['Revisión']]] } },
      { label: 'Preparar', heading: 'Empieza una reunión en segundos', body: 'Dale un nombre, elige el idioma y la fuente de audio, y pulsa grabar.', points: ['Elige idioma y traducción', 'Graba micrófono y audio del sistema', 'Los modelos cargan antes, sin depender de la red'], callout: 'form', demo: { name: 'Reunión', language: 'Chino', device: 'CPU', mode: 'Modo estándar' } },
      { label: 'Subtítulos en vivo', heading: 'Subtítulos mientras hablas', body: 'La transcripción en vivo de baja latencia sigue al hablante y separa las voces.', points: ['Subtítulos en vivo con baja latencia', 'Reconocimiento y separación de hablantes', 'Ventana de subtítulos flotante opcional'], callout: 'transcript', demo: { segments: [['Álex', 'Debemos completar la aceptación el viernes.'], ['Mía', 'Entendido, ordenaré los riesgos.'], ['Álex', 'Sincronizamos el progreso el lunes.']] } },
      { label: 'Notas IA', heading: 'Puntos clave y tareas, automáticamente', body: 'La IA captura decisiones y pendientes mientras hablas, para que nada se pierda.', points: ['Deriva conclusiones, riesgos y tareas', 'IA integrada sin conexión o en línea', 'Solo se envía texto; el audio queda en el dispositivo'], callout: 'notes', demo: { decision: 'Completar la aceptación el viernes', actions: ['El equipo de producto da seguimiento', 'Ingeniería sincroniza el lunes'] } },
      { label: 'Detalles', heading: 'Reproduce, refina y comparte', body: 'Después, reproduce el audio, lee la transcripción refinada y exporta o comparte las notas.', points: ['Reproduce y salta a los subtítulos', 'Refinamiento posterior para registros pulidos', 'Exporta y comparte las notas'], callout: 'player', demo: { refined: 'Acordamos completar la aceptación el viernes. Mía ordenará los riesgos y sincronizaremos el lunes.', summary: 'Completar la aceptación el viernes' } },
    ],
  },
  ja: {
    title: 'Brevia を 3 分で知る', intro: 'すべての会話を、見返して検索・共有できる記録に。', start: 'はじめる', next: '次へ', back: '戻る', skip: 'ガイドをスキップ',
    hint: '認識・議事録・精修はすべてこの端末で実行。音声は外に出ません。',
    steps: [
      { label: 'ライブラリ', heading: '検索できる会議ライブラリ', body: 'すべての会議が日時で整理されます。名前・文字起こし・タグでいつでも検索。', points: ['会議・文字起こし・タグを検索', '期間で絞り込み', '削除後 30 日以内に復元'], callout: 'search', demo: { meetings: [['プロダクト定例会 · 2026-08-19', '04:23 · 中国語 · 12 名', ['リリース', 'リスク']], ['要件レビュー · 2026-08-17', '01:48 · 中国語 · 6 名', ['レビュー']]] } },
      { label: '準備', heading: '数秒で会議を開始', body: '名前を付け、言語と音声ソースを選んで録音を始めるだけ。', points: ['会議言語と翻訳先を選択', 'マイク＋システム音声で録音', '開始前にモデルを読み込み、オフライン対応'], callout: 'form', demo: { name: '会議', language: '中国語', device: 'CPU', mode: '標準モード' } },
      { label: 'ライブ字幕', heading: '話すそばから字幕', body: '低遅延のリアルタイム文字起こしが発言を追い、話者を区別します。', points: ['低遅延のライブ字幕', '話者認識と分離', 'フローティング字幕も可能'], callout: 'transcript', demo: { segments: [['佐藤', '金曜までに内部受け入れを完了しましょう。'], ['鈴木', 'わかりました。リスクを整理します。'], ['佐藤', '月曜に進捗を共有しましょう。']] } },
      { label: 'AI メモ', heading: '結論と ToDo を自動で抽出', body: 'AI が話しながら決定やタスクを記録し、行動項目を逃しません。', points: ['結論・リスク・ToDo を抽出', '内蔵オフライン AI またはオンライン', '送信されるのはテキストのみ。音声は端末内'], callout: 'notes', demo: { decision: '金曜までに内部受け入れを完了', actions: ['プロダクトチームが受け入れをフォロー', 'エンジニアリングは月曜に同期'] } },
      { label: '詳細', heading: '再生・精修・共有', body: '終了後は音声を再生し、精修済みの文字起こしを確認して共有できます。', points: ['音声を再生し字幕へジャンプ', '会議後の精修で読みやすく', '議事録をエクスポート・共有'], callout: 'player', demo: { refined: '金曜までに内部受け入れを完了することで合意。リスクは鈴木が整理し、月曜に進捗を共有します。', summary: '金曜までに内部受け入れを完了' } },
    ],
  },
  ko: {
    title: 'Brevia를 3분 만에 알아보기', intro: '모든 대화를 다시 보고 검색하고 공유할 수 있는 기록으로.', start: '시작하기', next: '다음', back: '뒤로', skip: '둘러보기 건너뛰기',
    hint: '인식·회의록·정제가 모두 이 기기에서 실행되며, 오디오는 기기를 벗어나지 않습니다.',
    steps: [
      { label: '라이브러리', heading: '검색 가능한 회의 라이브러리', body: '모든 회의가 날짜별로 보관됩니다. 이름·녹취·태그로 언제든 다시 찾아보세요.', points: ['회의·녹취·태그 검색', '기간으로 필터링', '삭제 후 30일 이내 복원'], callout: 'search', demo: { meetings: [['제품 주간회의 · 2026-08-19', '04:23 · 한국어 · 참가자 12명', ['출시', '리스크']], ['요구사항 검토 · 2026-08-17', '01:48 · 한국어 · 참가자 6명', ['검토']]] } },
      { label: '준비', heading: '몇 초 만에 회의 시작', body: '이름을 정하고 언어와 오디오 소스를 선택한 뒤 녹음을 시작하세요.', points: ['회의 언어와 번역 대상 선택', '마이크 + 시스템 오디오 녹음', '시작 전 모델 로드, 오프라인 대응'], callout: 'form', demo: { name: '회의', language: '한국어', device: 'CPU', mode: '표준 모드' } },
      { label: '실시간 자막', heading: '말하는 즉시 자막', body: '저지연 실시간 전사가 발언을 따라가며 화자를 구분합니다.', points: ['밀리초 수준의 실시간 자막', '화자 인식 및 구분', '플로팅 자막 창 가능'], callout: 'transcript', demo: { segments: [['김민수', '금요일까지 내부 검수를 마칩시다.'], ['이지은', '네, 리스크를 정리할게요.'], ['김민수', '월요일에 진행 상황을 공유하죠.']] } },
      { label: 'AI 메모', heading: '결론과 할 일을 자동으로', body: '말하는 동안 AI가 결정과 작업을 기록해 놓치는 일이 없습니다.', points: ['결론·리스크·할 일 추출', '내장 오프라인 또는 온라인 AI', '텍스트만 전송, 오디오는 기기에 유지'], callout: 'notes', demo: { decision: '금요일까지 내부 검수 완료', actions: ['제품팀이 검수 후속 처리', '엔지니어링 월요일 동기화'] } },
      { label: '상세', heading: '재생·정제·공유', body: '종료 후 오디오를 재생하고 정제된 녹취를 확인하며 메모를 내보낼 수 있습니다.', points: ['오디오 재생 및 자막 이동', '회의 후 정제로 다듬기', '회의록 내보내기 및 공유'], callout: 'player', demo: { refined: '금요일까지 내부 검수를 완료하기로 합의했습니다. 리스크는 이지은이 정리하고 월요일에 진행 상황을 공유합니다.', summary: '금요일까지 내부 검수 완료' } },
    ],
  },
  fr: {
    title: 'Découvrez Brevia en trois minutes', intro: 'Transformez chaque conversation en un enregistrement à relire, chercher et partager.', start: 'Commencer', next: 'Suivant', back: 'Retour', skip: 'Passer la démo',
    hint: 'La reconnaissance, les notes et l’affinage tournent sur cet appareil ; votre audio ne le quitte jamais.',
    steps: [
      { label: 'Bibliothèque', heading: 'Une bibliothèque de réunions consultable', body: 'Chaque réunion est archivée par date. Retrouvez toute conversation par nom, transcription ou étiquette.', points: ['Rechercher réunions, transcriptions et étiquettes', 'Filtrer par période', 'Restaurer sous 30 jours après suppression'], callout: 'search', demo: { meetings: [['Réunion produit hebdo · 2026-08-19', '04:23 · Chinois · 12 participants', ['Lancement', 'Risques']], ['Revue des exigences · 2026-08-17', '01:48 · Chinois · 6 participants', ['Revue']]] } },
      { label: 'Préparer', heading: 'Lancez une réunion en quelques secondes', body: 'Donnez-lui un nom, choisissez la langue et la source audio, puis enregistrez.', points: ['Choisir langue et traduction', 'Enregistrer micro et audio système', 'Modèles chargés avant, fonctionne hors ligne'], callout: 'form', demo: { name: 'Réunion', language: 'Chinois', device: 'CPU', mode: 'Mode standard' } },
      { label: 'Sous-titres en direct', heading: 'Des sous-titres pendant que vous parlez', body: 'La transcription en direct à faible latence suit l’intervenant et sépare les voix.', points: ['Sous-titres en direct à faible latence', 'Reconnaissance et séparation des locuteurs', 'Fenêtre de sous-titres flottante optionnelle'], callout: 'transcript', demo: { segments: [['Paul', 'Nous devons finaliser la recette vendredi.'], ['Marie', 'D’accord, je liste les risques.'], ['Paul', 'Nous synchroniserons lundi.']] } },
      { label: 'Notes IA', heading: 'Points clés et actions, automatiquement', body: 'L’IA capture décisions et tâches pendant que vous parlez, sans rien manquer.', points: ['Déduire conclusions, risques et tâches', 'IA intégrée hors ligne ou en ligne', 'Seul le texte est envoyé ; l’audio reste local'], callout: 'notes', demo: { decision: 'Finaliser la recette vendredi', actions: ['L’équipe produit suit la recette', 'L’équipe technique synchronise lundi'] } },
      { label: 'Détails', heading: 'Relire, affiner et partager', body: 'Après coup, écoutez l’audio, lisez la transcription affinée et exportez ou partagez les notes.', points: ['Écouter et sauter aux sous-titres', 'Affinage après réunion', 'Exporter et partager les notes'], callout: 'player', demo: { refined: 'Nous avons convenu de finaliser la recette vendredi. Marie consolidera les risques et nous synchroniserons lundi.', summary: 'Finaliser la recette vendredi' } },
    ],
  },
  de: {
    title: 'Brevia in drei Minuten kennenlernen', intro: 'Machen Sie aus jedem Gespräch eine Aufzeichnung, die Sie nachschlagen, durchsuchen und teilen können.', start: 'Starten', next: 'Weiter', back: 'Zurück', skip: 'Tour überspringen',
    hint: 'Erkennung, Notizen und Nachbearbeitung laufen auf diesem Gerät; Ihre Audiodaten verlassen es nie.',
    steps: [
      { label: 'Bibliothek', heading: 'Eine durchsuchbare Besprechungsbibliothek', body: 'Jede Besprechung wird nach Datum archiviert. Finden Sie jede Unterhaltung über Name, Transkript oder Tag wieder.', points: ['Besprechungen, Transkripte und Tags durchsuchen', 'Nach Zeitraum filtern', 'Innerhalb von 30 Tagen nach Löschung wiederherstellen'], callout: 'search', demo: { meetings: [['Produktwochenmeeting · 2026-08-19', '04:23 · Chinesisch · 12 Teilnehmer', ['Launch', 'Risiken']], ['Anforderungsreview · 2026-08-17', '01:48 · Chinesisch · 6 Teilnehmer', ['Review']]] } },
      { label: 'Vorbereiten', heading: 'In Sekunden eine Besprechung starten', body: 'Geben Sie einen Namen ein, wählen Sie Sprache und Audioquelle und drücken Sie Aufnahme.', points: ['Sprache und Übersetzungsziel wählen', 'Mikrofon und Systemaudio aufnehmen', 'Modelle laden vor dem Start, offline-tauglich'], callout: 'form', demo: { name: 'Besprechung', language: 'Chinesisch', device: 'CPU', mode: 'Standardmodus' } },
      { label: 'Live-Untertitel', heading: 'Untertitel, während Sie sprechen', body: 'Die latenzarme Live-Transkription verfolgt den Sprecher und trennt die Stimmen.', points: ['Latenzarme Live-Untertitel', 'Sprechererkennung und -trennung', 'Optional schwebendes Untertitelfenster'], callout: 'transcript', demo: { segments: [['Alex', 'Wir müssen die Abnahme bis Freitag abschließen.'], ['Mia', 'Verstanden, ich liste die Risiken.'], ['Alex', 'Wir stimmen uns Montag ab.']] } },
      { label: 'KI-Notizen', heading: 'Kernpunkte und Aufgaben, automatisch', body: 'Die KI erfasst Entscheidungen und Aufgaben, während Sie sprechen – nichts wird übersehen.', points: ['Schlussfolgerungen, Risiken und Aufgaben ableiten', 'Integrierte Offline- oder Online-KI', 'Nur Text wird gesendet; Audio bleibt lokal'], callout: 'notes', demo: { decision: 'Abnahme bis Freitag abschließen', actions: ['Produktteam begleitet die Abnahme', 'Entwicklung stimmt sich Montag ab'] } },
      { label: 'Details', heading: 'Abspielen, nachbearbeiten und teilen', body: 'Danach können Sie das Audio abspielen, das bearbeitete Transkript lesen und Notizen exportieren oder teilen.', points: ['Audio abspielen und zu Untertiteln springen', 'Nachbearbeitung für saubere Aufzeichnungen', 'Notizen exportieren und teilen'], callout: 'player', demo: { refined: 'Wir haben vereinbart, die Abnahme bis Freitag abzuschließen. Mia konsolidiert die Risiken, und wir stimmen uns Montag ab.', summary: 'Abnahme bis Freitag abschließen' } },
    ],
  },
  ru: {
    title: 'Познакомьтесь с Brevia за три минуты', intro: 'Превратите любой разговор в запись, которую можно пересмотреть, найти и поделиться.', start: 'Начать', next: 'Далее', back: 'Назад', skip: 'Пропустить обзор',
    hint: 'Распознавание, заметки и обработка выполняются на этом устройстве; ваш звук никогда его не покидает.',
    steps: [
      { label: 'Библиотека', heading: 'Поисковая библиотека встреч', body: 'Каждая встреча архивируется по дате. Вернитесь к любому разговору по названию, расшифровке или тегу.', points: ['Поиск встреч, расшифровок и тегов', 'Фильтр по периоду', 'Восстановление в течение 30 дней'], callout: 'search', demo: { meetings: [['Еженедельная встреча продукта · 2026-08-19', '04:23 · Китайский · 12 участников', ['Запуск', 'Риски']], ['Ревью требований · 2026-08-17', '01:48 · Китайский · 6 участников', ['Ревью']]] } },
      { label: 'Подготовка', heading: 'Начните встречу за секунды', body: 'Дайте название, выберите язык и источник звука — и нажмите запись.', points: ['Выбор языка и перевода', 'Запись микрофона и системного звука', 'Модели загружаются заранее, работает офлайн'], callout: 'form', demo: { name: 'Встреча', language: 'Китайский', device: 'CPU', mode: 'Стандартный режим' } },
      { label: 'Субтитры', heading: 'Субтитры, пока вы говорите', body: 'Низколатентная расшифровка в реальном времени следит за говорящим и разделяет голоса.', points: ['Субтитры в реальном времени', 'Распознавание и разделение говорящих', 'Опциональное плавающее окно субтитров'], callout: 'transcript', demo: { segments: [['Алекс', 'Нам нужно завершить приёмку к пятнице.'], ['Мия', 'Понял, я сведу риски.'], ['Алекс', 'Синхронизируемся в понедельник.']] } },
      { label: 'Заметки ИИ', heading: 'Ключевые моменты и задачи автоматически', body: 'ИИ фиксирует решения и задачи, пока вы говорите, чтобы ничего не упустить.', points: ['Вывод выводов, рисков и задач', 'Встроенный офлайн или онлайн-ИИ', 'Отправляется только текст; звук остаётся локально'], callout: 'notes', demo: { decision: 'Завершить приёмку к пятнице', actions: ['Команда продукта сопровождает приёмку', 'Разработка синхронизируется в понедельник'] } },
      { label: 'Детали', heading: 'Воспроизводите, обрабатывайте и делитесь', body: 'После завершения прослушайте звук, прочитайте обработанную расшифровку и экспортируйте или поделитесь заметками.', points: ['Прослушивание и переход к субтитрам', 'Обработка после встречи', 'Экспорт и обмен заметками'], callout: 'player', demo: { refined: 'Мы договорились завершить приёмку к пятнице. Мия сведёт риски, и мы синхронизируемся в понедельник.', summary: 'Завершить приёмку к пятнице' } },
    ],
  },
};
function openOnboardingAi() {
  const copy = aiOnboardingCopy[locale] || aiOnboardingCopy.en;
  // 低配设备默认「暂不开启」实时 AI 笔记（太耗资源），仅保留会后一次性的 AI 会议纪要。
  const defaultProactivity = deviceIsWeak() ? 'off' : 'assist';
  const levels = copy.levels.map(([value, title, detail]) => `<label class="onboarding-ai-level${value === defaultProactivity ? ' is-selected' : ''}"><input type="radio" name="onboarding-ai-proactivity" value="${value}"${value === defaultProactivity ? ' checked' : ''} /><span><b>${escapeHtml(title)}${recommendTag(value === 'off' && deviceIsWeak())}</b><small>${escapeHtml(detail)}</small></span></label>`).join('');
  const brand = locale === 'zh' ? '<div class="onboarding-brand-name"><span>言</span><b>言录</b></div>' : '<img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" />';
  showOnboardingPage('setup', `<section class="onboarding-setup-page onboarding-ai-setup-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="${t('返回')}">←</button><header>${brand}<h1>${escapeHtml(copy.title)}</h1><div class="onboarding-intro"><p>${escapeHtml(copy.intro)}</p></div></header><section class="onboarding-section onboarding-ai-feature onboarding-ai-row"><div class="onboarding-ai-copy"><h2>${escapeHtml(copy.meetingNotesTitle)}</h2><p class="onboarding-ai-feature-desc">${escapeHtml(copy.meetingNotesDesc)}</p><p class="onboarding-ai-way-title">${escapeHtml(copy.wayTitle)}</p><div class="onboarding-ai-ways"><label><input type="radio" name="onboarding-ai-way" value="built-in" /><span><b>${escapeHtml(copy.builtin)}</b><small>${escapeHtml(copy.builtinHint)}</small></span></label><label><input type="radio" name="onboarding-ai-way" value="online" /><span><b>${escapeHtml(copy.online)}${recommendTag(deviceIsWeak())}</b><small>${escapeHtml(copy.onlineHint)}</small></span></label></div></div><div class="onboarding-ai-frame" data-onboarding-summary-demo></div></section><section class="onboarding-section onboarding-ai-feature onboarding-ai-row"><div class="onboarding-ai-copy"><h2>${escapeHtml(copy.liveNotesTitle)}</h2><p class="onboarding-ai-feature-desc">${escapeHtml(copy.liveNotesDesc)}</p><p class="onboarding-ai-way-title">${escapeHtml(copy.proactivityTitle)}</p><div class="onboarding-ai-levels">${levels}</div></div><div class="onboarding-ai-frame"><aside class="onboarding-ai-demo" data-onboarding-ai-demo></aside></div></section><div class="onboarding-actions"><button class="modal-action" data-onboarding-ai-finish type="button">${escapeHtml(copy.finish)}</button><button class="secondary" data-onboarding-ai-skip type="button">${escapeHtml(copy.skip)}</button></div></section>`);
  renderOnboardingAiDemo();
  renderOnboardingSummaryDemo();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-ai-proactivity"]')) {
      onboardingPage.querySelectorAll('.onboarding-ai-level').forEach((level) => level.classList.toggle('is-selected', level.querySelector('input').checked));
      renderOnboardingAiDemo();
    }
  });
  onboardingPage.addEventListener('click', (event) => {
    const aiWay = event.target.closest('.onboarding-ai-ways label');
    if (aiWay) {
      onboardingOnlineProvider = !aiWay.querySelector('[value="built-in"]');
      summaryConfig = { ...summaryConfig, provider: aiWay.querySelector('[value="built-in"]') ? 'built-in' : 'openai' };
      openModal('summary-model');
      return;
    }
    if (event.target.closest('[data-onboarding-back-language]')) { dismissOnboardingPage(openOnboardingSetup); return; }
    if (event.target.closest('[data-onboarding-ai-finish]')) { void finishAiOnboarding(); return; }
    if (event.target.closest('[data-onboarding-ai-skip]')) { void finishAiOnboarding(false); return; }
  });
}
async function finishAiOnboarding(forceEnabled) {
  const proactivity = onboardingPage.querySelector('[name="onboarding-ai-proactivity"]:checked')?.value || 'off';
  const enabled = typeof forceEnabled === 'boolean' ? forceEnabled : proactivity !== 'off';
  aiAssistConfig.enabled = enabled;
  aiAssistConfig.proactivity = ['quiet', 'assist', 'auto'].includes(proactivity) ? proactivity : 'assist';
  aiAssistConfigRevision += 1;
  await persistAiAssistConfig().catch(() => {});
  dismissOnboardingPage(openOnboardingTour);
}

function openOnboardingPermissions() {
  const copy = onboardingCopy[locale] || onboardingCopy.en;
  const steps = [
    ['microphone', t('麦克风'), t('录制你的发言。')],
    ['screen', t('屏幕与系统音频'), t('录制屏幕共享中的系统声音。')],
  ];
  const placeholders = steps.map(([permission, label, detail], index) => `<div class="onboarding-permission"><span class="onboarding-permission-state">${index + 1}</span><span><b>${label}</b><small>${detail}</small></span><button class="modal-action onboarding-permission-action onboarding-permission-placeholder" type="button" disabled>${permission === 'microphone' ? t('允许') : t('继续')}</button></div>`).join('') + `<div class="onboarding-permission-complete onboarding-permission-placeholder" aria-hidden="true">&nbsp;</div>`;
  showOnboardingPage('permissions', `<section class="onboarding-setup-page onboarding-permissions-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="${t('返回')}">←</button><header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${t('录制权限')}</h1><div class="onboarding-intro"><p>${t('言录需要麦克风、屏幕与系统音频权限，才能录制会议并生成实时字幕。')}</p></div></header><section class="onboarding-section" data-onboarding-permissions>${placeholders}</section><div class="onboarding-actions"><button class="modal-action" data-finish-onboarding type="button" disabled>${t('继续')}</button><button class="secondary" data-skip-onboarding-permissions type="button">${copy.later}</button></div></section>`);
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

document.querySelector('#settings-view .settings-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-settings-modal]');
  if (button) openModal(button.dataset.settingsModal);
  if (event.target.closest('[data-open-whats-new]')) openModal('whats-new');
});
let modelAction = document.querySelector('[data-settings-modal="models"]');
speakerProfileCard.querySelector('button').addEventListener('click', () => openModal('speaker-profiles'));
const installedModelNames = new Set();
const modelPaths = new Map();
/** 检查模型是否在本地安装。@param {string} name 模型名称。@returns {boolean} 模型是否存在于已安装集合中。*/
function isModelInstalled(name) { return installedModelNames.has(name); }
/** 从列表和本地状态中移除已安装的模型。@param {string} name 模型名称。@returns {void} */
function deleteInstalledModel(name) { installedModelNames.delete(name); }
/** 在语言环境或模型列表更改后同步已安装模型操作。@returns {void} */
function renderModelControls() {
  modelAction = document.querySelector('[data-settings-modal="models"]');
  modelAction.textContent = (modelLabels[locale] || modelLabels.en).manage;
}
/** 为管理对话框记录新下载的模型。@param {{name: string}} model 已下载的模型元数据。@returns {void} */
function installModel(model) {
  if (isModelInstalled(model.name)) return;
  installedModelNames.add(model.name);
}
/** 热切换当前会议的实时配置（语言/流式模型）。@param {object} changes 部分配置。@returns {Promise<void>} */
async function reconfigureLive(changes) {
  const meetingId = breviaClient?.state.meeting?.id;
  if (!window.brevia || !meetingId) return false;
  // 乐观应用，以便控件感觉即时；meeting.reconfigured 事件确认它。
  const previous = { ...liveConfig };
  liveConfig = { ...liveConfig, ...changes };
  try {
    const result = await window.brevia.meeting.reconfigure({ meeting_id: meetingId, ...changes });
    if (result?.model_required) {
      liveConfig = previous;
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
  if (event.target.closest('[data-download-onboarding-selected]')) {
    const models = [...(onboardingModelSelection || [])].filter((modelId) => !modelPaths.has(modelId));
    if (!models.length) return;
    onboardingModelIds = models;
    window.BreviaOnboarding.beginDownloads(models);
    downloadRequiredModels(models);
    closeModal();
    dismissOnboardingPage(openOnboardingTour);
    return;
  }
  if (event.target === settingsModal || event.target.closest('.modal-close')) { closeModal(); return; }
  if (event.target.closest('[data-cancel-confirmation]')) { confirmationAction = undefined; closeModal(); return; }
  if (event.target.closest('[data-use-ai-2b]')) {
    // switchAiAssistTo2B 自带成功/失败 toast。仅当是从「AI 笔记」或「性能」设置框
    // 进入时重渲染该框；从会中瓶颈弹窗进入（activeModal 为空）则保持弹窗不跳走。
    await switchAiAssistTo2B();
    if (activeModal === 'ai-assist' || activeModal === 'performance') renderModal(activeModal);
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
  if (event.target.closest('[data-edit-summary]')) { summaryEditing = true; renderModal('summary-detail'); return; }
  if (event.target.closest('[data-cancel-summary-edit]')) { summaryEditing = false; summaryEditor = null; renderModal('summary-detail'); return; }
  if (event.target.closest('[data-save-summary]')) {
    const markdown = (summaryEditor?.getMarkdown() || '').trim();
    const meetingId = currentMeetingDetail?.id;
    if (!meetingId || !window.brevia?.summary?.save) return;
    if (!markdown) { showToast(t('纪要不能为空')); return; }
    try {
      await window.brevia.summary.save({ meeting_id: meetingId, markdown });
      currentMeetingDetail.summary = { data: { markdown } };
      uiData.detail.summary = { markdown, hasFull: true, blocked: meetingActive, generating: false };
      summaryEditing = false;
      summaryEditor = null;
      renderModal('summary-detail');
      renderMeetingDetail();
      showToast(t('已保存'));
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
    select.querySelector('.flow-select-toggle').firstChild.nodeValue = selectChoice.textContent;
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
    // 导出与分享面板里的格式选择。
    if (choiceName.startsWith('export-format-')) {
      exportSelection[choiceName.slice('export-format-'.length)] = value;
      return;
    }
    return;
  }
  // 选择内置模型行将其标记为此配置将使用的模型。
  const builtinModelItem = event.target.closest('[data-builtin-model-id]');
  if (builtinModelItem) {
    const modelId = builtinModelItem.dataset.builtinModelId;
    const form = builtinModelItem.closest('.summary-model-form, .ai-assist-config-form');
    if (form) form.querySelector('[name="model"]').value = modelId;
    if (form?.matches('.ai-assist-config-form')) selectedAiAssistBuiltinModel = modelId;
    else selectedBuiltinModel = modelId;
    renderModal(activeModal === 'ai-assist' ? 'ai-assist' : 'summary-model');
    return;
  }
  // 内置纪要模型（llama-chat）不在通用模型库里，只能从这里下载。
  const downloadSummaryModel = event.target.closest('[data-download-summary-model]');
  if (downloadSummaryModel) {
    const modelId = downloadSummaryModel.dataset.downloadSummaryModel;
    modelDownloads.set(modelId, { received: 0, total: 0 });
    renderModal(activeModal === 'ai-assist' ? 'ai-assist' : 'summary-model');
    renderModelDownloadQueue();
    try {
      if (window.brevia) await window.brevia.models.download(modelDownloadPayload(modelId));
    } catch (error) {
      modelDownloads.delete(modelId);
      showToast(error.message);
      renderModal(activeModal === 'ai-assist' ? 'ai-assist' : 'summary-model');
    }
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
  const download = event.target.closest('[data-download-model]');
  if (download) {
    const index = Number(download.dataset.downloadModel);
    const [, name, detail, intro, icon] = (modalCopy[locale] || modalCopy.en).models.items[index];
    modelDownloads.set(modelIds[index], { received: 0, total: 0 });
    renderModal('models');
    renderModelDownloadQueue();
    try {
      if (window.brevia) await window.brevia.models.download(modelDownloadPayload(modelIds[index]));
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
});
settingsModal.addEventListener('change', (event) => {
  if (event.target.matches('[data-china-model-source]')) { localStorage.setItem('brevia-china-model-source', event.target.checked); return; }
  if (event.target.matches('.ai-assist-level input[type=radio]')) {
    settingsModal.querySelectorAll('.ai-assist-level').forEach((level) => level.classList.toggle('is-selected', level.querySelector('input[type=radio]').checked));
    return;
  }
  const selection = event.target.closest('[data-onboarding-model-selection]');
  if (selection) {
    if (selection.checked) onboardingModelSelection.add(selection.value);
    else onboardingModelSelection.delete(selection.value);
    renderModal('models');
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
        const [section, key] = path.split('.');
        settings[section][key] = typeof settings[section][key] === 'number' ? Number(value) : value;
      });
      advancedSettings.settings = settings;
      await window.brevia?.advancedSettings.save({ settings: advancedSettings.settings });
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
  if (event.target.matches('.ai-assist-form') && event.target.querySelector('[name="performance-mode"]')) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    if (values['performance-mode'] === 'efficiency' || values['performance-mode'] === 'standard') {
      setPerformanceMode(values['performance-mode']);
    }
    closeModal();
    renderPrepareSelects();
    showToast(t('性能模式已保存'));
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
    homeSlogan.textContent = activeLibraryNav === 'recently-deleted' ? t('最近删除') : workspaceDescription || (slogans[locale] || slogans.en)[sloganIndex];
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

/** 记录可在语言环境更改时替换的静态 DOM 文本和属性。@returns {void} */
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
      .map(({ node, element }) => node?.parentElement || element)
      .filter((element) => element && !rerenderedRoots.some((root) => root.contains(element))),
    ...rerenderedRoots,
    ...['#floating-caption-toggle', '#translation-toggle', '#playback-floating-caption-toggle']
      .map((selector) => document.querySelector(selector))
      .filter(Boolean),
  ])];
  const updateText = () => {
    translatedNodes.forEach(({ node, element, attribute, key, leading = '', trailing = '' }) => {
      const value = t(key);
      if (node) node.nodeValue = `${leading}${value}${trailing}`;
      else element[attribute] = value;
    });
    renderPrepareSelects();
    renderPrepareAudioSources();
    renderPauseButton();
    document.querySelector('#end-meeting').textContent = t('结束会议');
    renderSettingsView();
    document.querySelector('#advanced-settings').before(speakerProfileCard);
    document.querySelector('#settings-view .settings-grid').append(updateCard);
    renderDefaultMeetingTitle();
    renderMeetingList();
    renderWorkspaceNav();
    renderMeetingDetail();
    if (activeView === 'home') selectLibraryNav(activeLibraryNav);
    else crumb.textContent = catalog[locale].views[activeView];
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
  const rejected = /LLM request failed \(403\)|error code: 1010/i.test(String(error?.message || error));
  // 内置模型走本地 GGUF，与 API Key 无关；缺配置时给出针对性的指引，
  // 避免把「未选择本地模型」误报成「API Key 未配置」。
  const builtin = summaryConfig.provider === 'built-in';
  const copy = builtin
    ? { title: t('内置纪要模型未配置'), detail: t('请选择并下载一个内置纪要模型，之后即可完全离线生成纪要。'), action: t('选择纪要模型') }
    : { title: t(rejected ? '纪要服务拒绝了请求' : '纪要模型需要配置'), detail: t(rejected ? '请检查 API 地址、密钥和服务商访问策略。' : 'API Key 未配置、已失效或不匹配当前服务。'), action: t('配置纪要模型') };
  card.innerHTML = `<header class="task-card-heading"><p>${copy.title}</p>${taskCardControls()}</header><strong>${copy.detail}</strong><button class="secondary" type="button">${copy.action}</button>`;
  card.querySelector('.secondary').onclick = () => {
    clearTimeout(summaryConfigDismissTimer);
    dismissTaskCard(card);
    openModal('summary-model');
  };
  summaryConfigDismissTimer = setTimeout(() => dismissTaskCard(card), 30000);
}
function isSummaryAuthenticationError(error) {
  return /LLM request failed \((401|403)\)|error code: 1010|API key|Authorization header|invalid_api_key|authentication/i.test(String(error.message));
}
function userFacingError(content) {
  return /\b(?:worker request |operation )timed out\b/i.test(String(content)) ? t('操作超时，请稍后重试') : content;
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
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason || '未知异步错误');
  showToast(`${t('操作失败')}: ${message}`);
});
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message;
  if (message) showToast(`${t('应用错误')}: ${message}`);
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
/** 在视图或内容交换周围运行共享的页面淡出/淡入过渡。*/
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
/** 在顶级应用视图之间切换。@param {'home'|'prepare'|'live'|'detail'|'settings'} name 目标视图。*/
const showView = async (name) => {
  if (name === activeView) return;
  if (activeView === 'prepare' && name !== 'prepare') await breviaClient?.stopPreview();
  const current = document.querySelector(`#${activeView}-view`);
  const next = document.querySelector(`#${name}-view`);
  await transitionPage(current, next, () => {
    activeView = name;
    // 侧边栏“收起”态（is-live-meeting 在该应用里只承担侧边栏折叠样式）：
    // 会议进行中，以及进入会议详情页时都默认收起；悬浮/聚焦时才展开。
    document.querySelector('.app-shell').classList.toggle('is-live-meeting', (name === 'live' && meetingActive) || name === 'detail');
    crumb.textContent = catalog[locale].views[name];
    if (name === 'home') selectLibraryNav(activeLibraryNav);
    else document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
    if (name === 'detail') resetDetailHeaderCollapse();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  if (name === 'prepare') { requestAnimationFrame(fitPrepareLayout); renderCaptureMode(); void refreshPrepareAudioSources(); }
  renderMiniPlayback();
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
  detailView.querySelectorAll('.transcript-body, .detail-notes-panel').forEach((panel) => {
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
  if (activeView === 'live' && meetingActive) minimizeMeeting();
  if (activeView !== 'home') {
    selectLibraryNav(id);
    const refresh = window.brevia ? refreshBackendMeetings(includeDeleted) : Promise.resolve();
    await refresh.catch((error) => showToast(error.message));
    await showView('home');
    return;
  }
  if (id === activeLibraryNav) return;
  const home = document.querySelector('#home-view');
  selectLibraryNav(id);
  const refresh = window.brevia ? refreshBackendMeetings(includeDeleted) : Promise.resolve();
  await transitionPage(home, home, () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await refresh.catch((error) => showToast(error.message));
}
collectTranslations();
applyLanguage(locale);
applyLanguageModelDefaults(new FormData(prepareForm).get('meeting-language') || 'auto');
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
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (activeModal) closeModal(); else { closeLanguageMenu(); languageToggle.focus(); } } });
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
document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (!target || ['all-meetings', 'recently-deleted'].includes(target.id)) return; if (target.dataset.view === 'home') selectLibraryNav('all-meetings'); if (target.dataset.view === 'prepare') selectCurrentWorkspaceForMeeting(); if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting(); showView(target.dataset.view); });
homeEyebrow.addEventListener('click', async () => {
  if (activeLibraryNav !== 'recently-deleted') return;
  await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
});
function setLiveTranslationEnabled(enabled) {
  translationAllowed = enabled;
  const toggle = document.querySelector('#translation-toggle');
  toggle.dataset.enabled = String(enabled);
  toggle.textContent = t(enabled ? '译文: 开' : '译文: 关');
  document.querySelector('#translation-options').innerHTML = BreviaI18n.languageOptions(locale, t)
    .map(([value, label]) => `<button type="button" data-live-translation="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('');
  if (!enabled) document.querySelectorAll('.translation').forEach((line) => { line.hidden = true; });
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
  const { title, workspace_id: workspaceId, language, streaming_model_id: streamingModelId, refined_model_id: refinedModelId } = meeting || payload;
  liveConfig = { language: language || 'auto', streaming_model_id: streamingModelId || '', refined_model_id: refinedModelId || '', target_language: payload.target_language || null, power_saving: Boolean(payload.power_saving) };
  document.querySelector('#live-name').textContent = title;
  uiData.meetings.unshift({ id: meeting.id, tone: 'violet', title, meta: `${t('刚刚')} · 0 ${t('分钟')}`, workspaceId: workspaceId || '', workspace: workspaceId ? { name: getWorkspaceName(workspaceId) } : null, tags: [], status: { tone: 'processing', label: t('正在录制'), detail: t('本地保存') } });
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
  latestLiveSegmentId = null;
  liveSegments.clear();
  liveSegmentRevisions.clear();
  followLiveTranscript = true;
  renderMeetingList();
  meetingActive = true;
  seconds = 0;
  const pauseButton = document.querySelector('#pause');
  pauseButton.dataset.paused = 'false';
  renderPauseButton();
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
  const language = form.get('meeting-language') || 'auto';
  const defaults = preferredModelsForLanguage(language);
  const targetLanguage = form.get('translation-target') || null;
  const streamingModelId = prepareForm.dataset.streamingModel || defaults.streaming;
  const segmentationModelId = prepareForm.dataset.segmentationModel || defaults.segmentation;
  const captureMode = form.get('capture-mode') || savedCaptureMode();
  const inputs = captureModeInputs(captureMode);
  const payload = {
    title, language, target_language: targetLanguage, streaming_model_id: streamingModelId, refined_model_id: defaults.refined,
    speaker_segmentation_model_id: segmentationModelId,
    vad_model_id: prepareForm.dataset.vadModel || 'silero-vad', power_saving: getPerformanceMode() === 'efficiency', workspace_id: form.get('meeting-workspace') || null,
  };
  try {
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
importRecording.addEventListener('click', async () => {
  const form = new FormData(prepareForm);
  const title = meetingTitle.value.trim();
  if (!title) { meetingTitle.focus(); return; }
  const language = form.get('meeting-language') || 'auto';
  const defaults = preferredModelsForLanguage(language);
  importRecording.disabled = true;
  try {
    const meeting = window.brevia && await window.brevia.meeting.import({
      title, language, target_language: form.get('translation-target') || null,
      streaming_model_id: prepareForm.dataset.streamingModel || defaults.streaming, refined_model_id: defaults.refined,
      speaker_segmentation_model_id: prepareForm.dataset.segmentationModel || defaults.segmentation,
      workspace_id: form.get('meeting-workspace') || null, path: 'selected-by-electron',
    });
    if (!meeting) return;
    breviaClient.state.selectedMeetingId = meeting.id;
    applyBackendDetail(meeting);
    await refreshBackendMeetings();
    showView('detail');
    startRefinement(meeting.refined_model_id);
  } catch (error) { showToast(error.message); } finally { importRecording.disabled = false; }
});
let seconds = 0;
let timer;
/** 使录制控件标签与活动语言环境和状态保持同步。@returns {void} */
function renderPauseButton() {
  const button = document.querySelector('#pause');
  const paused = button.dataset.paused === 'true';
  button.textContent = `${paused ? '▶' : 'Ⅱ'} ${t(paused ? '继续' : '暂停')}`;
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
document.querySelector('#end-meeting').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const buttonLabel = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-pending');
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<i class="button-spinner" aria-hidden="true"></i>${t('结束中')}`;
  clearInterval(timer);
  try {
    // 结束前把笔记落库，会议详情页“我的笔记”延续显示。
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
    startTimer();
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
    // 效率模式 + 内置模型时，启动即调低 AI 笔记频率（在线 LLM 无需调低）。
    if (getPerformanceMode() === 'efficiency' && aiAssistIsBuiltIn()) {
      await window.brevia.aiNote.reconfigure({ meeting_id: meetingId, min_interval_seconds: 120 }).catch(() => {});
    }
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
  return window.brevia.meeting.update({ meeting_id: meetingId, updates: { notes: text } }).catch(() => {});
}
/** 防抖保存笔记（live 视图与详情页共用）。@param {{current: number|undefined}} timer 防抖计时器。@param {() => string} getNotes 取笔记文本。@param {() => string|undefined} getMeetingId 取会议 id。@returns {void} */
function scheduleNotesSave(timer, getNotes, getMeetingId) {
  const meetingId = getMeetingId();
  if (!meetingId || !window.brevia?.meeting?.update) return;
  clearTimeout(timer.current);
  timer.current = setTimeout(() => persistNotes(meetingId, getNotes()), 800);
}
const liveNotesSaveTimer = { current: undefined };
const detailNotesSaveTimer = { current: undefined };
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
document.addEventListener('click', (event) => {
  if (event.target.closest('.translation-menu')) return;
  document.querySelector('#translation-options').hidden = true;
  document.querySelector('#translation-toggle').setAttribute('aria-expanded', 'false');
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
        isRefined: false,
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
const meetingList = document.querySelector('.meeting-list');
const meetingSelectionSurface = document.querySelector('#home-view');
let dragSelection;
let suppressMeetingClick = false;
const toggleMeetingSelection = (row) => { const key = row.dataset.selectionKey; if (selectedMeetingKeys.has(key)) selectedMeetingKeys.delete(key); else selectedMeetingKeys.add(key); syncMeetingSelection(); };
document.querySelector('#meeting-select-all')?.addEventListener('click', () => {
  const rows = [...document.querySelectorAll('.meeting-row:not([hidden])')];
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
  if (event.target.matches('input, textarea')) return;
  const row = event.target.closest('.meeting-row');
  if (row && event.key === ' ') { event.preventDefault(); toggleMeetingSelection(row); }
});
const batchExportFormats = ['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'flac', 'wav', 'm4a'];
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
      ? await window.brevia.meeting.exportMany({ meeting_ids: meetings.map(({ id }) => id).filter(Boolean), format })
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
  if (window.brevia) await Promise.all([...ids].map((meeting_id) => window.brevia.meeting[action]({ meeting_id })));
  if (['delete', 'restore', 'purge'].includes(action)) uiData.meetings = uiData.meetings.filter((meeting) => !ids.has(meeting.id));
  clearMeetingSelection();
  renderMeetingList();
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
    if (action.dataset.meetingAction === 'export') { closeMeetingMenus(); if (window.brevia && meeting.id) window.brevia.meeting.export({ meeting_id: meeting.id, format: 'md' }).then((value) => value && showToast(t('已导出「{title}」').replace('{title}', meeting.title))).catch((error) => showToast(error.message)); else showToast(t('已导出「{title}」').replace('{title}', meeting.title)); return; }
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

const progress = document.querySelector('#progress');
const playerTime = document.querySelector('#player-time');
const playerAudio = new Audio();
const playButton = document.querySelector('#play');
let playbackStarted = false;
let followPlaybackTranscript = true;
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
const renderPlayerTime = () => { playerTime.textContent = formatMeetingTime(Number(progress.value) * 1000); };
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
// 精修模型是否输出可对齐到原 segment 时间戳的结果。当前内置精修模型均为窗口式逐句精修
// （继承原时间戳）；未来若接入整段式无时间戳输出的模型，不会出现在该集合中，将走“精修全文”展示。
const timestampAlignedRefinedModels = new Set(['qwen3-asr-0.6b-int8', 'funasr-nano-int8', 'whisper-large-v3']);
function refinedModelSupportsTimestamps(modelId) { return timestampAlignedRefinedModels.has(modelId); }
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
  scheduleDetailNotesSave();
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
/** 触发会后精修并同步字幕面板状态。@param {string} refinedModelId 精修模型 id。@param {number} [numSpeakers] 固定说话人数。@returns {void} */
const startRefinement = (refinedModelId, numSpeakers) => {
  if (!window.brevia?.meeting?.refine || !breviaClient?.state?.selectedMeetingId) return;
  uiData.detail.refineState = 'refining';
  renderMeetingDetail();
  void window.brevia.meeting.refine({
    meeting_id: breviaClient.state.selectedMeetingId,
    refined_model_id: refinedModelId,
    ...(numSpeakers ? { num_speakers: numSpeakers } : {}),
  }).catch((error) => {
    uiData.detail.refineState = 'idle';
    renderMeetingDetail();
    hideRefinementProgress();
    showToast(error.message);
  });
};
/** 首次精修待确认的模型 id（内联人数菜单确认后使用）。@type {string|undefined} */
let pendingRefineModelId;
finalTranscript.addEventListener('click', (event) => {
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
    clearTimeout(detailNotesSaveTimer.current);
    detailNotesEditor = null;
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
    clearTimeout(detailNotesSaveTimer.current);
    const notes = detailNotesEditor ? detailNotesEditor.getMarkdown() : uiData.detail.notes;
    detailNotesEditor = null;
    uiData.detail.notes = notes;
    uiData.detail.notesEditing = false;
    detailActiveTab = 'notes';
    renderMeetingDetail();
    if (breviaClient?.state.selectedMeetingId) {
      void persistNotes(breviaClient.state.selectedMeetingId, notes);
    }
    return;
  }
  const refineNow = event.target.closest('[data-refine-now]');
  if (refineNow) {
    pendingRefineModelId = currentMeetingDetail?.refined_model_id || preferredModelsForLanguage(currentMeetingDetail?.language || 'auto').refined;
    const menu = refineNow.nextElementSibling;
    document.querySelectorAll('.refine-menu').forEach((other) => { if (other !== menu) other.hidden = true; });
    menu.hidden = !menu.hidden;
    refineNow.setAttribute('aria-expanded', String(!menu.hidden));
    return;
  }
  const more = event.target.closest('[data-refine-more]');
  if (more) {
    const menu = more.nextElementSibling;
    finalTranscript.querySelectorAll('.refine-menu').forEach((other) => { if (other !== menu) other.hidden = true; });
    const opening = menu.hidden;
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
    if (refineAction.dataset.refineAction === 'original') {
      detailTranscriptView = detailTranscriptView === 'original' ? 'refined' : 'original';
      renderMeetingDetail();
      return;
    }
    if (refineAction.dataset.refineAction === 're-refine') {
      if (menu) menu.hidden = true;
      startRefinement(currentMeetingDetail?.refined_model_id || preferredModelsForLanguage(currentMeetingDetail?.language || 'auto').refined, refineNumSpeakers());
      return;
    }
    if (refineAction.dataset.refineAction === 'start') {
      if (menu) menu.hidden = true;
      startRefinement(pendingRefineModelId || currentMeetingDetail?.refined_model_id || preferredModelsForLanguage(currentMeetingDetail?.language || 'auto').refined, refineNumSpeakers());
      return;
    }
    if (refineAction.dataset.refineAction === 'model') {
      const list = refineAction.nextElementSibling;
      if (list) list.hidden = !list.hidden;
      return;
    }
  }
  const refineModel = event.target.closest('.refine-menu [data-refine-model]');
  if (refineModel) {
    const menu = refineModel.closest('.refine-menu');
    if (menu) menu.hidden = true;
    startRefinement(refineModel.dataset.refineModel, refineNumSpeakers());
    return;
  }
  const tab = event.target.closest('[data-detail-tab]');
  if (!tab) return;
  const target = tab.dataset.detailTab;
  detailActiveTab = target;
  finalTranscript.querySelectorAll('[data-detail-tab]').forEach((item) => item.classList.toggle('active', item.dataset.detailTab === target));
  finalTranscript.querySelectorAll('[data-detail-panel]').forEach((panel) => { panel.hidden = panel.dataset.detailPanel !== target; });
});
document.addEventListener('click', (event) => {
  if (event.target.closest('.refine-wrap, .refine-menu, [data-refine-more]')) return;
  document.querySelectorAll('.refine-menu').forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll('[data-refine-more]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
});
settingsModal.addEventListener('dblclick', (event) => {
  if (activeModal !== 'summary-detail' || summaryEditing || !event.target.closest('.summary-modal-document')) return;
  summaryEditing = true;
  renderModal('summary-detail');
});
/** 详情页富文本笔记编辑器实例（编辑模式下由 renderMeetingDetail 创建）。@type {object|null} */
let detailNotesEditor = null;
/** 详情页笔记防抖自动保存（800ms）；输入时即时同步到 uiData，避免重建面板丢失草稿。@returns {void} */
function scheduleDetailNotesSave() {
  if (!detailNotesEditor) return;
  uiData.detail.notes = detailNotesEditor.getMarkdown(); // 即时同步，避免重建面板时丢失未保存内容
  scheduleNotesSave(detailNotesSaveTimer, () => uiData.detail.notes, () => breviaClient?.state.selectedMeetingId);
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
  initializationPromise = breviaClient.initialize().then((result) => {
    modelCatalog = result.models;
    uiData.meetings = result.meetings.map(backendMeeting);
    // 初始化工作区
    if (typeof initializeWorkspaces === 'function') {
      initializeWorkspaces(result.workspaces || []);
      renderWorkspaceNav();
      updateHomeViewTitle();
    }
    speakerProfiles = result.speaker_profiles || [];
    installedModelNames.clear();
    modelPaths.clear();
    result.models.filter((model) => model.status === 'ready').forEach((model) => {
      installedModelNames.add(model.name.replace(' 0.6B int8', ''));
      if (model.path) modelPaths.set(model.id, model.path);
    });
    deviceReport = result.device || null;
    renderSpeakerProfileCard();
    renderMeetingList();
    void window.brevia.maintain();
  });
  void initializationPromise.catch((error) => showToast(`${t('配置或后端启动失败')}: ${error.message}`));

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
    if (!segment || segment.classList.contains('partial') || !meetingId) return;
    event.preventDefault();
    openSegmentContextMenu(meetingId, segment.dataset.segmentId, event.clientX, event.clientY, segmentInfoFor(meetingId, segment.dataset.segmentId));
  });
  const renderLiveEvent = (payload, partial) => {
    // 丢弃乱序/过期的段落更新：异步标点或精修可能晚于更新的 partial/final 到达，
    // 若按 segment_id 盲目替换会把较新的文本倒退回旧内容。
    const revision = Number(payload.revision) || 0;
    const seenRevision = liveSegmentRevisions.get(payload.segment_id);
    if (seenRevision !== undefined && revision <= seenRevision) return;
    liveSegmentRevisions.set(payload.segment_id, revision);
    const shouldFollow = followLiveTranscript || isAtLiveBottom();
    const previous = liveSegments.get(payload.segment_id);
    const translation = payload.translation || previous?.querySelector('.translation')?.textContent;
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      startSeconds: payload.start_ms / 1000,
      endSeconds: payload.end_ms / 1000,
      speaker: { id: payload.speaker, segmentId: payload.segment_id, name: formatSpeakerName(payload.speaker_name || payload.speaker) || `${t('说话人')} ${payload.speaker.split('-').pop()}` },
      text: payload.text,
      translation,
      partial,
      showSpeaker: false,
    };
    latestLiveSegmentId = payload.segment_id;
    // Update floating caption if enabled
    // - For partial transcripts: update current area
    // - For final transcripts: also update current area before finalizing
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({
        segmentId: payload.segment_id,
        text: payload.text,
        isRefined: false,
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
    liveSegmentData.set(payload.segment_id, { text: payload.text, start_ms: payload.start_ms, speaker: payload.speaker_name || payload.speaker });
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
  window.brevia.on('transcript.partial', (payload) => renderLiveEvent(payload, true));
  for (const type of ['meeting.started', 'meeting.recovered', 'meeting.imported', 'meeting.stopped']) {
    window.brevia.on(type, ({ meeting }) => syncBackendMeeting(meeting));
  }
  window.brevia.on('meeting.reconfigured', ({ meeting }) => {
    syncBackendMeeting(meeting);
    if (!meeting || meeting.id !== breviaClient?.state.meeting?.id) return;
    const targetChanged = meeting.target_language !== liveConfig.target_language;
    breviaClient.state.meeting = { ...breviaClient.state.meeting, ...meeting };
    liveConfig = { language: meeting.language || 'auto', streaming_model_id: meeting.streaming_model_id || '', refined_model_id: meeting.refined_model_id || '', target_language: meeting.target_language || null, power_saving: Boolean(meeting.power_saving) };
    if (targetChanged) document.querySelectorAll('.translation').forEach((line) => { line.remove(); });
    setLiveTranslationEnabled(Boolean(liveConfig.target_language));
  });
  window.brevia.on('live.performance', ({ meeting_id: meetingId, bottleneck }) => {    if (!meetingActive || !bottleneck) return;
    if (getPerformanceMode() === 'efficiency') return; // 已在效率模式，无需再提示
    if (perfBottleneckShownForMeeting === meetingId) return; // 每场会议只提示一次
    perfBottleneckShownForMeeting = meetingId;
    openPerformanceBottleneckDialog(meetingId);
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
    const storageSizes = [storage.meetings, storage.models, storage.exports].map(formatBytes);
    Object.values(modalCopy).forEach((copy) => copy.storage.items.forEach((item, index) => { item[1] = storageSizes[index]; }));
    renderSpeakerProfileCard();
    renderMeetingList();
    if (activeModal === 'storage') renderModal('storage');
    if (recoverable.length) showToast(t('发现可恢复录音').replace('{count}', recoverable.length));
  });
  async function generateSegmentTranslation(payload, targetLanguage) {
    // Translation runs on the bundled local model — no provider config needed.
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
  window.brevia.on('transcript.refined', async (payload) => {
    renderLiveEvent(payload, false);
    // Update floating caption with refined text
    // Move the refined text to the finalized area (top)
    // Clear current area (bottom) only if it's showing the same segment being refined
    if (floatingCaptionMode === 'live' && window.brevia?.floatingCaption) {
      window.brevia.floatingCaption.update({
        segmentId: payload.segment_id,
        text: payload.text,
        isRefined: true,
        updateFinalized: true,
        clearCurrentIfMatch: true,
      });
    }
  });
  window.brevia.on('transcript.final', (payload) => {
    renderLiveEvent(payload, false);
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
  window.brevia.on('transcript.discarded', ({ segment_id }) => {
    liveSegments.get(segment_id)?.remove();
    liveSegments.delete(segment_id);
    liveSegmentRevisions.delete(segment_id);
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
  window.brevia.on('refinement.progress', ({ completed, total, stage }) => showRefinementProgress(completed, total, refinementMeetingTitle, undefined, stage));
  window.brevia.on('refinement.cancelled', async ({ meeting }) => {
    hideRefinementProgress();
    if (meeting?.id === breviaClient.state.selectedMeetingId) {
      uiData.detail.refineState = 'idle';
      applyBackendDetail(meeting);
    }
    void refreshBackendMeetings();
  });
  window.brevia.on('refinement.ready', async ({ meeting_id }) => {
    const meeting = await window.brevia.meeting.get({ meeting_id });
    syncBackendMeeting(meeting);
    showRefinementComplete();
    if (meeting.id === breviaClient.state.selectedMeetingId) {
      uiData.detail.refineState = 'idle';
      applyBackendDetail(meeting);
    }
    if (!meeting.target_language) return;
    const refined = meeting.segments.filter((segment) => segment.version.startsWith('postprocess'));
    const revision = Math.max(...refined.map((segment) => segment.revision), -1);
    const results = await Promise.allSettled(refined.filter((item) => item.revision === revision).map((segment) => generateSegmentTranslation(segment, meeting.target_language)));
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
    if (activeModal === 'models') renderModal('models');
    if (activeModal === 'summary-model' || activeModal === 'ai-assist') renderModal(activeModal);
    scheduleRequiredModelsCardRender();
  });
  window.brevia.on('model.status', ({ model_id, status, error }) => {
    const index = modelIds.indexOf(model_id);
    // Summary / llama-chat models live only in modelCatalog, not in modelIds. Handle
    // their status the same way — otherwise a "ready" event is dropped and the download
    // sticks at 100% forever because modelDownloads is never cleared.
    if (status === 'ready') {
      if (index >= 0) {
        const [, name, detail, intro, icon] = (modalCopy[locale] || modalCopy.en).models.items[index];
        installModel({ icon, name, detail, intro });
      }
      modelDownloads.delete(model_id);
      requiredModelIds.delete(model_id);
      if (onboardingModelIds.includes(model_id) && window.BreviaOnboarding.modelReady(model_id)) showOfflineTranscriptionReady();
      window.brevia.models.list().then((models) => {
        modelCatalog = models;
        const model = models.find((item) => item.id === model_id);
        if (model?.path) modelPaths.set(model_id, model.path);
        if (activeModal === 'models') renderModal('models');
        if (activeModal === 'summary-model' || activeModal === 'ai-assist') renderModal(activeModal);
        renderRequiredModelsCard();
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
    if (activeModal === 'summary-model' || activeModal === 'ai-assist') renderModal(activeModal);
    renderRequiredModelsCard();
  });
  window.brevia.on('worker.warning', ({ code, message: warning }) => showToast(code === 'live_refinement_degraded' ? t('实时精修已自动降级以保持字幕实时。') : warning));
  window.brevia.on('worker.error', ({ message: error }) => showToast(error));
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
    if (task === 'meeting.refine') {
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
    if (event.target.closest('[data-view-full-summary]')) { openModal('summary-detail'); return; }
    if (event.target.closest('[data-open-summary-edit]')) { void openModal('summary-detail').then(() => { summaryEditing = true; renderModal('summary-detail'); }); return; }
    if (event.target.closest('[data-generate-summary]')) void generateMeetingSummary();
    if (event.target.closest('[data-regenerate-summary]')) void generateMeetingSummary();
  });
  document.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.summary-preview .summary-body')) return;
    void openModal('summary-detail').then(() => { summaryEditing = true; renderModal('summary-detail'); });
  });

  document.querySelector('[data-export-detail]').addEventListener('click', async () => {
    if (!breviaClient.state.selectedMeetingId) return;
    openModal('export');
  });
}
