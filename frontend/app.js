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
function taskCardControls() { return '<span class="task-card-actions"><button class="task-card-close" data-minimize-task-card type="button" aria-label="最小化">—</button><button class="task-card-close" data-dismiss-task-card type="button" aria-label="关闭">×</button></span>'; }
function taskPauseControl() { return '<button class="task-card-close" data-pause-task type="button" aria-label="暂停" disabled>Ⅱ</button>'; }
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
const liveSpeakers = new Map();
const liveSegments = new Map();
const maxLiveSegments = 500;
let followLiveTranscript = true;
let toastTimer;
let switchingLanguage = false;
let meetingActive = false;
let translationAllowed = false;
let latestLiveSegmentId = null;
let editingMeetingIndex = null;
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
let updateVersion = '';
let updateBusy = false;
let installedAppVersion = '—';
let speakerProfiles = [];
let presetVoices = [];
let currentMeetingDetail = null;
let modelCatalog = [];
const modelSize = (modelId) => modelCatalog.find((model) => model.id === modelId)?.size_bytes || 0;
const modelLibraryMetaCopy = {
  zh: { download: '下载', languages: '语言', compute: '运行', installed: '已安装', streaming: '实时转写', refined: '会后精修', punctuation: '标点恢复', vad: '语音检测', denoise: '语音降噪', diarization: '说话人分离', voiceprint: '声纹识别' },
  en: { download: 'Download', languages: 'Languages', compute: 'Compute', installed: 'Installed', streaming: 'Live transcription', refined: 'Post-meeting refinement', punctuation: 'Punctuation', vad: 'Voice detection', denoise: 'Noise reduction', diarization: 'Speaker diarization', voiceprint: 'Voiceprint recognition' },
  es: { download: 'Descarga', languages: 'Idiomas', compute: 'Ejecución', installed: 'Instalado', streaming: 'Transcripción en vivo', refined: 'Refinamiento posterior', punctuation: 'Puntuación', vad: 'Detección de voz', denoise: 'Reducción de ruido', diarization: 'Separación de hablantes', voiceprint: 'Reconocimiento de voz' },
  ja: { download: 'ダウンロード', languages: '言語', compute: '実行環境', installed: 'インストール済み', streaming: 'ライブ文字起こし', refined: '会議後の高精度化', punctuation: '句読点復元', vad: '音声検出', denoise: 'ノイズ除去', diarization: '話者分離', voiceprint: '声紋認識' },
  ko: { download: '다운로드', languages: '언어', compute: '실행 환경', installed: '설치됨', streaming: '실시간 전사', refined: '회의 후 정제', punctuation: '문장 부호', vad: '음성 감지', denoise: '노이즈 제거', diarization: '화자 분리', voiceprint: '음성 지문 인식' },
  fr: { download: 'Téléchargement', languages: 'Langues', compute: 'Exécution', installed: 'Installé', streaming: 'Transcription en direct', refined: 'Affinage après réunion', punctuation: 'Ponctuation', vad: 'Détection vocale', denoise: 'Réduction du bruit', diarization: 'Séparation des locuteurs', voiceprint: 'Reconnaissance vocale' },
  de: { download: 'Download', languages: 'Sprachen', compute: 'Ausführung', installed: 'Installiert', streaming: 'Live-Transkription', refined: 'Nachbearbeitung', punctuation: 'Zeichensetzung', vad: 'Spracherkennung', denoise: 'Rauschunterdrückung', diarization: 'Sprechertrennung', voiceprint: 'Stimmabdruck-Erkennung' },
  ru: { download: 'Загрузка', languages: 'Языки', compute: 'Выполнение', installed: 'Установлено', streaming: 'Потоковая расшифровка', refined: 'Обработка после встречи', punctuation: 'Пунктуация', vad: 'Обнаружение речи', denoise: 'Шумоподавление', diarization: 'Разделение говорящих', voiceprint: 'Распознавание голоса' },
};
const modelStageMetaKey = { streaming: 'streaming', refined: 'refined', punctuation: 'punctuation', vad: 'vad', 'speech-enhancement': 'denoise', diarization: 'diarization', 'speaker-segmentation': 'diarization', 'speaker-embedding': 'voiceprint' };
/** Renders manifest-backed download/language/compute metadata for the model-library card. @param {object|undefined} model Model manifest item. @param {string} languages Localized language summary. @returns {string} */
function renderModelLibraryMeta(model, languages) {
  if (!model) return '';
  const copy = modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en;
  const compute = (model.backend || []).map((backend) => backend.toUpperCase()).join(' · ');
  return `<div class="model-library-meta"><span><small>${copy.download}</small><b>${formatBytes(model.size_bytes)}</b></span><span><small>${copy.languages}</small><b>${escapeHtml(languages)}</b></span><span><small>${copy.compute}</small><b>${escapeHtml(compute)}</b></span></div>`;
}
/** Renders capability/installed tags shown inline beside the model name. @param {object|undefined} model Model manifest item. @param {boolean} installed Whether the model is available locally. @returns {string} */
function renderModelLibraryTags(model, installed) {
  if (!model) return '';
  const copy = modelLibraryMetaCopy[locale] || modelLibraryMetaCopy.en;
  const capabilities = [...new Set((model.stages || []).map((stage) => copy[modelStageMetaKey[stage]]).filter(Boolean))];
  if (!installed && !capabilities.length) return '';
  return `<div class="model-library-tags">${installed ? `<span class="model-library-installed">${copy.installed}</span>` : ''}${capabilities.map((capability) => `<span>${capability}</span>`).join('')}</div>`;
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
/** Keeps the update notice above the mini meeting when both are visible. @returns {void} */
function syncFloatingNotices() { updateNotice.style.bottom = miniMeeting.hidden ? '' : `${miniMeeting.offsetHeight + 24}px`; }
/** Renders the floating update notice from current locale and availability state. @returns {void} */
function updateCopy() { return updateLabels[locale] || { ...updateLabels.en, title: t('软件更新'), action: t('检查更新') }; }
function currentVersionLabel() { return ({ zh: '当前版本', en: 'Current version', es: 'Versión actual', ja: '現在のバージョン', ko: '현재 버전', fr: 'Version actuelle', de: 'Aktuelle Version', ru: 'Текущая версия' })[locale] || 'Current version'; }
function availableUpdateLabel() { return updateVersion ? updateCopy().available.replace('0.2.0', updateVersion) : updateCopy().available; }
function renderUpdateNotice() { const copy = updateCopy(); updateNoticeText.textContent = availableUpdateLabel(); updateNoticeButton.textContent = copy.floating; updateNotice.hidden = !updateAvailable; requestAnimationFrame(syncFloatingNotices); }
/** Renders the settings-page update action from current locale and availability state. @returns {void} */
function renderUpdateButton() { const copy = updateCopy(); updateTitle.textContent = copy.title; updateDescription.textContent = updateAvailable ? availableUpdateLabel() : `${currentVersionLabel()} ${installedAppVersion}`; updateButton.textContent = updateBusy ? (updateAvailable ? copy.updating : copy.checking) : updateAvailable ? copy.update : copy.action; updateButton.disabled = updateBusy; }
const modelIds = [
  'paraformer-zh-en-int8',
  'zipformer-en-streaming-int8',
  'zipformer-zh-streaming-int8',
  'zipformer-multilingual-streaming',
  'zipformer-ko-streaming-int8',
  'zipformer-fr-streaming-int8',
  'nemotron-3.5-asr-streaming-0.6b-560ms-int8',
  'silero-vad',
  'online-punct-en-int8',
  'punct-ct-transformer-zh-en-int8',
  'qwen3-asr-0.6b-int8',
  'fire-red-asr2-ctc-zh-en-int8',
  'funasr-nano-int8',
  'whisper-turbo',
  'whisper-large-v3',
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
  'vits-mimic3-ko-kss-low',
  'vits-piper-fr-siwis-medium-int8',
  'vits-piper-de-thorsten-medium-int8',
  'vits-piper-es-sharvard-medium-int8',
  'vits-piper-ru-irina-medium-int8',
];
const summaryProviders = ['OpenAI', 'Anthropic', 'Kimi', 'Zhipu GLM', 'MiniMax', 'DeepSeek', 'OpenRouter', 'Ollama', 'Ollama Cloud'];
const ollamaChatEndpoint = 'http://127.0.0.1:11434/api/chat';
const ollamaCloudChatEndpoint = 'https://ollama.com/api/chat';
function summaryProviderLabel(provider) { return provider === 'Ollama' ? 'Ollama Local' : provider; }
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
function speakerProfileName(profile) {
  const builtinKey = profile.builtin_key || (profile.built_in && profile.name === '内置女声' ? 'builtin:female' : profile.built_in && profile.name === '内置男声' ? 'builtin:male' : '');
  const builtin = { 'builtin:female': ['内置女声', 'Built-in female voice', 'Voz femenina integrada', '内蔵女性音声', '내장 여성 음성', 'Voix féminine intégrée', 'Integrierte weibliche Stimme', 'Встроенный женский голос'], 'builtin:male': ['内置男声', 'Built-in male voice', 'Voz masculina integrada', '内蔵男性音声', '내장 남성 음성', 'Voix masculine intégrée', 'Integrierte männliche Stimme', 'Встроенный мужской голос'] }[builtinKey];
  return builtin ? builtin[['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'].indexOf(locale)] : profile.name;
}
/** Allocates the next local summary-model configuration name. @returns {string} New configuration name. */
function nextConfigName() { configSequence += 1; return `配置-${configSequence}`; }
/** Returns the non-secret summary configuration persisted in the app data directory. */
function currentSummaryConfig() {
  const models = summaryModels.map(({ apiKey, ...model }) => model);
  return { models, active: activeSummaryModel, sequence: configSequence };
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
let editingSegmentSpeakerId;
let advancedSettings;
const advancedSettingCopy = {
  zh: { sections: { audio: '音频', asr: '识别与端点检测', live_asr: '实时识别', punctuation: '标点恢复', diarization: '说话人分离', voice_profiles: '声纹库', meetings: '会议', llm: '纪要模型' }, fields: { sample_rate: '采样率（Hz）', chunk_seconds: '音频分块时长（秒）', endpoint_rule1_silence: '端点规则 1 静音时长（秒）', endpoint_rule2_silence: '端点规则 2 静音时长（秒）', maximum_utterance_seconds: '单句最长时长（秒）', refined_window_seconds: '精修窗口时长（秒）', auto_english_model_id: '英文识别模型', denoiser_model_id: '实时降噪模型', microphone_target_rms: '麦克风目标响度', microphone_minimum_rms: '麦克风最小响度', microphone_max_gain: '麦克风最大增益', microphone_peak: '麦克风峰值限制', english_model_id: '英文标点模型', chinese_model_id: '中英文标点模型', segmentation_model_id: '说话区间模型', embedding_model_id: '声纹嵌入模型', cluster_threshold: '聚类阈值', online_similarity_threshold: '在线匹配阈值', minimum_embedding_seconds: '最短声纹语音（秒）', num_speakers: '固定说话人数（-1 为自动）', min_duration_on: '最短说话时长（秒）', min_duration_off: '最短静音间隔（秒）', max_samples: '每人最大录音条数', max_total_seconds: '每人最大录音时长（秒）', deleted_retention_days: '删除记录保留天数', timeout_seconds: '模型请求超时（秒）' }, hint: '用于本地运行配置。' },
  en: { sections: { audio: 'Audio', asr: 'Recognition and endpointing', live_asr: 'Live recognition', punctuation: 'Punctuation', diarization: 'Speaker diarization', voice_profiles: 'Voiceprints', meetings: 'Meetings', llm: 'Summary model' }, fields: { sample_rate: 'Sample rate (Hz)', chunk_seconds: 'Audio chunk duration (s)', endpoint_rule1_silence: 'Endpoint rule 1 silence (s)', endpoint_rule2_silence: 'Endpoint rule 2 silence (s)', maximum_utterance_seconds: 'Maximum utterance duration (s)', refined_window_seconds: 'Refinement window (s)', auto_english_model_id: 'English recognition model', denoiser_model_id: 'Live denoiser model', microphone_target_rms: 'Microphone target loudness', microphone_minimum_rms: 'Microphone minimum loudness', microphone_max_gain: 'Microphone maximum gain', microphone_peak: 'Microphone peak limit', english_model_id: 'English punctuation model', chinese_model_id: 'Chinese-English punctuation model', segmentation_model_id: 'Speech-segmentation model', embedding_model_id: 'Voice embedding model', cluster_threshold: 'Clustering threshold', online_similarity_threshold: 'Online matching threshold', minimum_embedding_seconds: 'Minimum voiceprint audio (s)', num_speakers: 'Fixed speaker count (-1 = auto)', min_duration_on: 'Minimum speech duration (s)', min_duration_off: 'Minimum silence gap (s)', max_samples: 'Maximum recordings per person', max_total_seconds: 'Maximum recording duration per person (s)', deleted_retention_days: 'Deleted-record retention (days)', timeout_seconds: 'Model request timeout (s)' }, hint: 'Used by the local runtime.' },
  es: { sections: { audio: 'Audio', asr: 'Reconocimiento y detección de final', live_asr: 'Reconocimiento en vivo', punctuation: 'Puntuación', diarization: 'Separación de hablantes', voice_profiles: 'Huellas de voz', meetings: 'Reuniones', llm: 'Modelo de resumen' }, fields: { sample_rate: 'Frecuencia de muestreo (Hz)', chunk_seconds: 'Duración del bloque de audio (s)', endpoint_rule1_silence: 'Silencio de regla de final 1 (s)', endpoint_rule2_silence: 'Silencio de regla de final 2 (s)', maximum_utterance_seconds: 'Duración máxima de intervención (s)', refined_window_seconds: 'Ventana de refinamiento (s)', auto_english_model_id: 'Modelo de reconocimiento en inglés', denoiser_model_id: 'Modelo de reducción de ruido en vivo', microphone_target_rms: 'Volumen objetivo del micrófono', microphone_minimum_rms: 'Volumen mínimo del micrófono', microphone_max_gain: 'Ganancia máxima del micrófono', microphone_peak: 'Límite de pico del micrófono', english_model_id: 'Modelo de puntuación en inglés', chinese_model_id: 'Modelo de puntuación chino-inglés', segmentation_model_id: 'Modelo de segmentación de voz', embedding_model_id: 'Modelo de huella de voz', cluster_threshold: 'Umbral de agrupación', online_similarity_threshold: 'Umbral de coincidencia en línea', minimum_embedding_seconds: 'Audio mínimo para huella de voz (s)', num_speakers: 'Número fijo de hablantes (-1 = auto)', min_duration_on: 'Duración mínima de habla (s)', min_duration_off: 'Pausa mínima (s)', max_samples: 'Máximas grabaciones por persona', max_total_seconds: 'Duración máxima por persona (s)', deleted_retention_days: 'Retención de eliminados (días)', timeout_seconds: 'Tiempo de espera de solicitud (s)' }, hint: 'Se usa en la ejecución local.' },
  ja: { sections: { audio: '音声', asr: '認識と終端検出', live_asr: 'ライブ認識', punctuation: '句読点', diarization: '話者分離', voice_profiles: '声紋', meetings: '会議', llm: '要約モデル' }, fields: { sample_rate: 'サンプリングレート（Hz）', chunk_seconds: '音声チャンク長（秒）', endpoint_rule1_silence: '終端ルール 1 の無音（秒）', endpoint_rule2_silence: '終端ルール 2 の無音（秒）', maximum_utterance_seconds: '発話の最大長（秒）', refined_window_seconds: '高精度化ウィンドウ（秒）', auto_english_model_id: '英語認識モデル', denoiser_model_id: 'ライブノイズ除去モデル', microphone_target_rms: 'マイク目標音量', microphone_minimum_rms: 'マイク最小音量', microphone_max_gain: 'マイク最大ゲイン', microphone_peak: 'マイクピーク上限', english_model_id: '英語句読点モデル', chinese_model_id: '中英句読点モデル', segmentation_model_id: '音声区間モデル', embedding_model_id: '声紋埋め込みモデル', cluster_threshold: 'クラスタリング閾値', online_similarity_threshold: 'オンライン一致閾値', minimum_embedding_seconds: '声紋用の最短音声（秒）', num_speakers: '固定話者数（-1 = 自動）', min_duration_on: '最短発話時間（秒）', min_duration_off: '最短無音間隔（秒）', max_samples: '1 人あたりの最大録音数', max_total_seconds: '1 人あたりの最大録音時間（秒）', deleted_retention_days: '削除済み記録の保持日数', timeout_seconds: 'モデル要求タイムアウト（秒）' }, hint: 'ローカル実行に使用します。' },
  ko: { sections: { audio: '오디오', asr: '인식 및 종점 감지', live_asr: '실시간 인식', punctuation: '문장 부호', diarization: '화자 분리', voice_profiles: '음성 지문', meetings: '회의', llm: '요약 모델' }, fields: { sample_rate: '샘플링 레이트(Hz)', chunk_seconds: '오디오 청크 길이(초)', endpoint_rule1_silence: '종점 규칙 1 무음(초)', endpoint_rule2_silence: '종점 규칙 2 무음(초)', maximum_utterance_seconds: '최대 발화 길이(초)', refined_window_seconds: '정교화 창(초)', auto_english_model_id: '영어 인식 모델', denoiser_model_id: '실시간 잡음 제거 모델', microphone_target_rms: '마이크 목표 음량', microphone_minimum_rms: '마이크 최소 음량', microphone_max_gain: '마이크 최대 게인', microphone_peak: '마이크 피크 제한', english_model_id: '영어 문장 부호 모델', chinese_model_id: '중영 문장 부호 모델', segmentation_model_id: '음성 구간 모델', embedding_model_id: '음성 지문 임베딩 모델', cluster_threshold: '클러스터링 임계값', online_similarity_threshold: '온라인 일치 임계값', minimum_embedding_seconds: '최소 음성 지문 오디오(초)', num_speakers: '고정 화자 수(-1 = 자동)', min_duration_on: '최소 발화 시간(초)', min_duration_off: '최소 무음 간격(초)', max_samples: '1인당 최대 녹음 수', max_total_seconds: '1인당 최대 녹음 시간(초)', deleted_retention_days: '삭제 기록 보관 기간(일)', timeout_seconds: '모델 요청 시간 제한(초)' }, hint: '로컬 실행에 사용됩니다.' },
  fr: { sections: { audio: 'Audio', asr: 'Reconnaissance et détection de fin', live_asr: 'Reconnaissance en direct', punctuation: 'Ponctuation', diarization: 'Séparation des locuteurs', voice_profiles: 'Empreintes vocales', meetings: 'Réunions', llm: 'Modèle de résumé' }, fields: { sample_rate: 'Fréquence d’échantillonnage (Hz)', chunk_seconds: 'Durée du bloc audio (s)', endpoint_rule1_silence: 'Silence règle de fin 1 (s)', endpoint_rule2_silence: 'Silence règle de fin 2 (s)', maximum_utterance_seconds: 'Durée maximale de parole (s)', refined_window_seconds: 'Fenêtre d’affinage (s)', auto_english_model_id: 'Modèle de reconnaissance anglaise', denoiser_model_id: 'Modèle de débruitage en direct', microphone_target_rms: 'Volume cible du microphone', microphone_minimum_rms: 'Volume minimal du microphone', microphone_max_gain: 'Gain maximal du microphone', microphone_peak: 'Limite de crête du microphone', english_model_id: 'Modèle de ponctuation anglaise', chinese_model_id: 'Modèle de ponctuation chinois-anglais', segmentation_model_id: 'Modèle de segmentation de parole', embedding_model_id: 'Modèle d’empreinte vocale', cluster_threshold: 'Seuil de regroupement', online_similarity_threshold: 'Seuil de correspondance en ligne', minimum_embedding_seconds: 'Audio minimal pour empreinte (s)', num_speakers: 'Nombre fixe de locuteurs (-1 = auto)', min_duration_on: 'Durée minimale de parole (s)', min_duration_off: 'Pause minimale (s)', max_samples: 'Enregistrements maximum par personne', max_total_seconds: 'Durée maximale par personne (s)', deleted_retention_days: 'Conservation des éléments supprimés (jours)', timeout_seconds: 'Délai de requête du modèle (s)' }, hint: 'Utilisé par l’exécution locale.' },
  de: { sections: { audio: 'Audio', asr: 'Erkennung und Endpunkterkennung', live_asr: 'Live-Erkennung', punctuation: 'Zeichensetzung', diarization: 'Sprechertrennung', voice_profiles: 'Stimmabdrücke', meetings: 'Besprechungen', llm: 'Zusammenfassungsmodell' }, fields: { sample_rate: 'Abtastrate (Hz)', chunk_seconds: 'Audioblockdauer (s)', endpoint_rule1_silence: 'Stille für Endpunktregel 1 (s)', endpoint_rule2_silence: 'Stille für Endpunktregel 2 (s)', maximum_utterance_seconds: 'Maximale Äußerungsdauer (s)', refined_window_seconds: 'Nachbearbeitungsfenster (s)', auto_english_model_id: 'Englisches Erkennungsmodell', denoiser_model_id: 'Live-Entrauschungsmodell', microphone_target_rms: 'Mikrofon-Ziellautstärke', microphone_minimum_rms: 'Mikrofon-Mindestlautstärke', microphone_max_gain: 'Maximale Mikrofonverstärkung', microphone_peak: 'Mikrofon-Peakgrenze', english_model_id: 'Englisches Zeichensetzungsmodell', chinese_model_id: 'Chinesisch-englisches Zeichensetzungsmodell', segmentation_model_id: 'Sprachsegmentierungsmodell', embedding_model_id: 'Stimmabdruckmodell', cluster_threshold: 'Cluster-Schwellenwert', online_similarity_threshold: 'Online-Abgleichschwelle', minimum_embedding_seconds: 'Minimales Stimmabdruck-Audio (s)', num_speakers: 'Feste Sprecherzahl (-1 = auto)', min_duration_on: 'Minimale Sprechdauer (s)', min_duration_off: 'Minimale Stille (s)', max_samples: 'Maximale Aufnahmen pro Person', max_total_seconds: 'Maximale Aufnahmezeit pro Person (s)', deleted_retention_days: 'Aufbewahrung gelöschter Einträge (Tage)', timeout_seconds: 'Zeitüberschreitung der Modellanfrage (s)' }, hint: 'Wird von der lokalen Laufzeit verwendet.' },
  ru: { sections: { audio: 'Аудио', asr: 'Распознавание и определение конца', live_asr: 'Распознавание в реальном времени', punctuation: 'Пунктуация', diarization: 'Разделение говорящих', voice_profiles: 'Голосовые отпечатки', meetings: 'Встречи', llm: 'Модель сводки' }, fields: { sample_rate: 'Частота дискретизации (Гц)', chunk_seconds: 'Длительность аудиоблока (с)', endpoint_rule1_silence: 'Тишина правила конца 1 (с)', endpoint_rule2_silence: 'Тишина правила конца 2 (с)', maximum_utterance_seconds: 'Максимальная длительность реплики (с)', refined_window_seconds: 'Окно обработки (с)', auto_english_model_id: 'Модель английского распознавания', denoiser_model_id: 'Модель шумоподавления в реальном времени', microphone_target_rms: 'Целевая громкость микрофона', microphone_minimum_rms: 'Минимальная громкость микрофона', microphone_max_gain: 'Максимальное усиление микрофона', microphone_peak: 'Ограничение пика микрофона', english_model_id: 'Модель английской пунктуации', chinese_model_id: 'Модель китайско-английской пунктуации', segmentation_model_id: 'Модель сегментации речи', embedding_model_id: 'Модель голосового отпечатка', cluster_threshold: 'Порог кластеризации', online_similarity_threshold: 'Порог онлайн-сопоставления', minimum_embedding_seconds: 'Минимальное аудио для отпечатка (с)', num_speakers: 'Фиксированное число говорящих (-1 = авто)', min_duration_on: 'Минимальная длительность речи (с)', min_duration_off: 'Минимальная пауза (с)', max_samples: 'Максимум записей на человека', max_total_seconds: 'Максимальная длительность на человека (с)', deleted_retention_days: 'Хранение удалённых записей (дни)', timeout_seconds: 'Тайм-аут запроса модели (с)' }, hint: 'Используется локальным запуском.' },
};
function renderAdvancedSettings(settings) {
  const copy = advancedSettingCopy[locale] || advancedSettingCopy.en;
  return Object.entries(settings).map(([section, values]) => `<section class="advanced-settings-section"><h3>${escapeHtml(copy.sections[section] || section)}</h3>${Object.entries(values).map(([key, value]) => `<label><span><b>${escapeHtml(copy.fields[key] || key)}</b><small>${escapeHtml(copy.hint)}</small></span><input name="${escapeHtml(`${section}.${key}`)}" type="${typeof value === 'number' ? 'number' : 'text'}" step="any" value="${escapeHtml(String(value))}" /></label>`).join('')}</section>`).join('');
}
const modelDownloads = new Map();
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
function filterMeetings() { const query = meetingSearch.value.trim().toLowerCase(); const cutoff = Date.now() - Number(activeDateRange) * 86_400_000; document.querySelectorAll('.meeting-row').forEach((row) => { const meeting = uiData.meetings[Number(row.dataset.meetingIndex)]; const categoryMatch = !activeCategory || (activeCategory === '__unclassified' ? !meeting.category : meeting.category === activeCategory); const dateMatch = activeDateRange === 'all' || !meeting.createdAt || Date.parse(meeting.createdAt) >= cutoff; row.hidden = !categoryMatch || !dateMatch || (!window.brevia && !row.textContent.toLowerCase().includes(query)); }); }
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
function renderMeetingList() { document.querySelector('.meeting-list').innerHTML = uiData.meetings.map((meeting, index) => !meeting.isExample || meeting.exampleLocale === locale ? renderMeetingRow(localizeMeeting(meeting), index) : '').join(''); filterMeetings(); syncMeetingSelection(); cacheMeetingList(); }
renderCategoryFilter();
renderDateFilter();
const prepareForm = document.querySelector('#meeting-form');
const prepareView = document.querySelector('#prepare-view');
const prepareLayout = prepareView.querySelector('.prepare-layout');
const prepareBack = prepareView.querySelector('.back');
const desktopPrepareLayout = matchMedia('(min-width: 851px)');
/** Fits preparation controls into the visible desktop workspace while the window is resized. @returns {void} */
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
/** Refreshes the starter title only until the user provides their own. @returns {void} */
function renderDefaultMeetingTitle() { if (!meetingTitleEdited) meetingTitle.value = BreviaI18n.defaultMeetingTitle(locale); }
meetingTitle.addEventListener('input', () => { meetingTitleEdited = true; });
/** Rebuilds meeting-language selectors while preserving their submitted values. @returns {void} */
function renderPrepareSelects() {
  const values = Object.fromEntries(new FormData(prepareForm));
  const categoryOptions = [['', t('未分类')], ...categories.map((name) => [name, name])];
  prepareForm.querySelector('.form-grid').innerHTML = `<label>${t('会议语言')}${flowSelect('meeting-language', values['meeting-language'] || 'auto', BreviaI18n.languageOptions(locale, t, true))}</label><label>${t('译文目标')}${flowSelect('translation-target', values['translation-target'] || '', BreviaI18n.languageOptions(locale, t))}</label><label>${t('预期说话人数')}<input name="num-speakers" type="number" min="1" step="1" value="${values['num-speakers'] || ''}" placeholder="${t('留空自动匹配')}" /></label><label>${t('分类标签')}${flowSelect('meeting-category', values['meeting-category'] || '', categoryOptions)}</label>`;
  prepareForm.querySelector('.primary-action').firstChild.nodeValue = `${t('开始录制')} `;
  importRecording.textContent = t('导入录音');
  prepareModelCard.querySelector('#active-vad-model').previousElementSibling.textContent = t('VAD 模型');
  requestAnimationFrame(fitPrepareLayout);
}
const prepareModelChoices = {
  'active-streaming-model': [['', null], ['zipformer-zh-xlarge-streaming-int8', 'Streaming Zipformer Chinese XLarge'], ['zipformer-zh-streaming-int8', 'Streaming Zipformer Chinese'], ['zipformer-multilingual-streaming', 'Streaming Zipformer Multilingual'], ['paraformer-zh-en-int8', 'Streaming Paraformer'], ['zipformer-en-streaming-int8', 'Streaming Zipformer English'], ['zipformer-ko-streaming-int8', 'Streaming Zipformer Korean'], ['zipformer-fr-streaming-int8', 'Streaming Zipformer French'], ['nemotron-3.5-asr-streaming-0.6b-560ms-int8', 'Nemotron 3.5 ASR Streaming 0.6B (560ms)']],
  'active-diarization-model': [['|', null], ['pyannote-segmentation-3.0|eres2net-base-3dspeaker-zh', 'Pyannote + 3D-Speaker'], ['pyannote-segmentation-3.0|nemo-titanet-small-en', 'Pyannote + NeMo Titanet'], ['pyannote-segmentation-3.0|campplus-zh-en', 'Pyannote + 3D-Speaker CAM++'], ['reverb-diarization-v1|eres2net-base-3dspeaker-zh', 'Reverb + 3D-Speaker']],
  'active-vad-model': [['silero-vad', 'Silero VAD']],
};
function modelChoices(id) {
  if (id !== 'active-refined-model') return prepareModelChoices[id];
  return [['', null], ...modelCatalog.filter((model) => model.stages?.includes('refined')).map((model) => [model.id, model.name])];
}
function renderRefinedModelChoices() {
  const options = document.querySelector('.detail-refine .flow-select-options');
  if (!options) return;
  options.innerHTML = modelChoices('active-refined-model').slice(1).map(([id, name]) => `<button type="button" data-refine-model="${escapeHtml(id)}">${escapeHtml(name)}</button>`).join('');
}
renderRefinedModelChoices();
const languageModelDefaults = {
  zh: { streaming: 'zipformer-zh-xlarge-streaming-int8', refined: 'funasr-nano-int8', diarization: 'pyannote-segmentation-3.0|eres2net-base-3dspeaker-zh' },
  en: { streaming: 'zipformer-en-streaming-int8', refined: 'whisper-turbo', diarization: 'pyannote-segmentation-3.0|nemo-titanet-small-en' },
  ko: { streaming: 'zipformer-ko-streaming-int8', refined: 'whisper-turbo', diarization: 'pyannote-segmentation-3.0|nemo-titanet-small-en' },
  fr: { streaming: 'zipformer-fr-streaming-int8', refined: 'whisper-turbo', diarization: 'pyannote-segmentation-3.0|nemo-titanet-small-en' },
  es: { streaming: 'nemotron-3.5-asr-streaming-0.6b-560ms-int8', refined: 'whisper-large-v3', diarization: 'pyannote-segmentation-3.0|nemo-titanet-small-en' },
  default: { streaming: 'zipformer-multilingual-streaming', refined: 'whisper-turbo', diarization: 'pyannote-segmentation-3.0|nemo-titanet-small-en' },
};
const preferredModelsForLanguage = (language) => languageModelDefaults[language] || languageModelDefaults.default;
const requiredModelsForLanguage = (language) => {
  const { streaming, refined, diarization } = preferredModelsForLanguage(language);
  const punctuation = language === 'en' ? 'online-punct-en-int8' : ['zh', 'yue', 'auto'].includes(language) ? 'punct-ct-transformer-zh-en-int8' : undefined;
  return [streaming, 'silero-vad', punctuation, refined, ...diarization.split('|'), 'gtcrn-live-denoiser', 'spleeter-2stems-fp16'];
};
function requiredModelDetails(language) {
  const [streaming, vad, punctuation, refined, segmentation, embedding, denoiser, separation] = requiredModelsForLanguage(language);
  return [[streaming, 0], [vad, 1], [punctuation, 2], [refined, 3], [segmentation, 4], [embedding, 5], [denoiser, 6], [separation, 7]];
}
const compatibleStreamingModels = (language) => {
  const supported = {
    zh: new Set(['', 'zipformer-zh-xlarge-streaming-int8', 'zipformer-zh-streaming-int8', 'zipformer-multilingual-streaming', 'paraformer-zh-en-int8']),
    en: new Set(['', 'zipformer-en-streaming-int8', 'zipformer-multilingual-streaming', 'paraformer-zh-en-int8']),
    ko: new Set(['', 'zipformer-ko-streaming-int8', 'zipformer-multilingual-streaming']),
    fr: new Set(['', 'zipformer-fr-streaming-int8', 'zipformer-multilingual-streaming']),
    es: new Set(['', 'nemotron-3.5-asr-streaming-0.6b-560ms-int8']),
  };
  const allowed = supported[language] || new Set(['', 'zipformer-multilingual-streaming']);
  return prepareModelChoices['active-streaming-model'].filter(([id]) => allowed.has(id));
};
function setPrepareModel(id, model) {
  const value = document.querySelector(`#${id}`);
  const [first, second] = model.split('|');
  if (id === 'active-streaming-model') prepareForm.dataset.streamingModel = first;
  if (id === 'active-diarization-model') { prepareForm.dataset.segmentationModel = first; prepareForm.dataset.embeddingModel = second; }
  if (id === 'active-refined-model') prepareForm.dataset.refinedModel = first;
  if (id === 'active-vad-model') prepareForm.dataset.vadModel = first;
  value.dataset.model = model;
  value.textContent = modelChoices(id)?.find(([choice]) => choice === model)?.[1] || t('自动匹配');
}
function applyLanguageModelDefaults(language) {
  const models = preferredModelsForLanguage(language);
  setPrepareModel('active-streaming-model', models.streaming);
  setPrepareModel('active-refined-model', models.refined);
  setPrepareModel('active-diarization-model', models.diarization);
}
const prepareModelCard = document.querySelector('.model-card');
prepareModelCard.querySelector('dl').insertAdjacentHTML('beforeend', `<div><dt>${t('VAD 模型')}</dt><dd id="active-vad-model" data-model="silero-vad">Silero VAD</dd></div>`);
const modelPicker = document.createElement('div');
modelPicker.className = 'flow-select-options model-picker';
modelPicker.hidden = true;
prepareModelCard.append(modelPicker);
prepareModelCard.addEventListener('click', (event) => {
  const choice = event.target.closest('[data-model-picker-choice]');
  if (!choice) return;
  setPrepareModel(choice.dataset.modelPickerChoice, choice.dataset.value);
  modelPicker.hidden = true;
});
prepareModelCard.addEventListener('dblclick', (event) => {
  const value = event.target.closest('dd[id]');
  const language = new FormData(prepareForm).get('meeting-language') || 'auto';
  const choices = value && (value.id === 'active-streaming-model' ? compatibleStreamingModels(language) : modelChoices(value.id));
  if (!choices) return;
  modelPicker.innerHTML = choices.map(([id, name]) => `<button type="button" data-model-picker-choice="${value.id}" data-value="${id}">${name || t('自动匹配')}</button>`).join('');
  modelPicker.style.top = `${value.offsetTop + value.offsetHeight + 4}px`;
  modelPicker.hidden = false;
});
document.addEventListener('click', (event) => { if (!event.target.closest('.model-card')) modelPicker.hidden = true; });
if (breviaClient) {
  breviaClient.onLevel = (track, level) => {
    if (track !== 'mic') return;
    document.querySelectorAll('#mic-level, [data-onboarding-mic-level]').forEach((meter) => meter.style.setProperty('--level', Math.max(.04, level)));
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
function showRefinementProgress(completed = 0, total = 0, meetingTitle = refinementMeetingTitle, meetingId) {
  clearTimeout(refinementDismissTimer);
  refinementMeetingTitle = meetingTitle;
  const copy = { title: t('正在精修'), waiting: t('准备中') };
  const ratio = total ? Math.min(1, completed / total) : 0;
  revealTaskCard(refinementCard);
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${copy.title} - ${refinementMeetingTitle}` : copy.title;
  refinementPercent.textContent = total ? `${Math.round(ratio * 100)}%` : copy.waiting;
  refinementBar.style.transform = `scaleX(${ratio})`;
  Object.assign(refinementCard.dataset, { completed, total, complete: 'false' });
  if (meetingId) setTaskCardTask(refinementCard, 'meeting.refine', meetingId);
}
let refinementDismissTimer;
function showRefinementComplete() {
  clearTimeout(refinementDismissTimer);
  revealTaskCard(refinementCard);
  const title = t('会后精修已完成');
  refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${title} - ${refinementMeetingTitle}` : title;
  refinementPercent.textContent = '100%';
  refinementBar.style.transform = 'scaleX(1)';
  Object.assign(refinementCard.dataset, { completed: 100, total: 100, complete: 'true' });
  finishTaskCard(refinementCard);
  refinementDismissTimer = setTimeout(hideRefinementProgress, 10000);
}
function hideRefinementProgress() { dismissTaskCard(refinementCard, () => { refinementCard.hidden = true; refinementCard.classList.remove('task-card-leave'); }); }
let separationDismissTimer;
function showSeparationProgress(completed = 0, total = 100, meetingId) {
  clearTimeout(separationDismissTimer);
  let card = document.querySelector('#separation-progress');
  if (!card) {
    card = document.createElement('aside');
    card.id = 'separation-progress';
    card.className = 'processing-card';
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `<header class="task-card-heading"><p></p>${taskCardControls()}</header><strong></strong><div class="task-card-progress"><div class="processing-bar" aria-hidden="true"><i></i></div>${taskPauseControl()}</div>`;
    taskCards.append(card);
    enterTaskCard(card);
  } else if (card.classList.contains('task-card-leave')) enterTaskCard(card);
  const ratio = total ? Math.min(1, completed / total) : 0;
  card.querySelector('p').textContent = t('正在分离人声与非人声');
  card.querySelector('strong').textContent = total ? `${Math.round(ratio * 100)}%` : t('准备中');
  card.querySelector('i').style.transform = `scaleX(${ratio})`;
  Object.assign(card.dataset, { completed, total, complete: 'false' });
  if (meetingId) setTaskCardTask(card, 'meeting.separate', meetingId);
}
function showSeparationComplete() {
  showSeparationProgress(100, 100);
  document.querySelector('#separation-progress p').textContent = t('声源分离已完成');
  document.querySelector('#separation-progress').dataset.complete = 'true';
  finishTaskCard(document.querySelector('#separation-progress'));
  separationDismissTimer = setTimeout(() => dismissTaskCard(document.querySelector('#separation-progress')), 10000);
}
let summaryDismissTimer;
const summaryTaskCopy = {
  zh: ['正在生成会议纪要', '准备清洗转录', '正在清洗转录', '正在生成摘要', '正在保存纪要', '纪要已生成'],
  en: ['Generating meeting notes', 'Preparing transcript cleanup', 'Cleaning transcript', 'Generating summary', 'Saving meeting notes', 'Meeting notes generated'],
  es: ['Generando notas de reunión', 'Preparando la limpieza de la transcripción', 'Limpiando la transcripción', 'Generando el resumen', 'Guardando las notas', 'Notas de reunión generadas'],
  ja: ['会議メモを生成中', '文字起こしのクリーンアップを準備中', '文字起こしをクリーンアップ中', '要約を生成中', '会議メモを保存中', '会議メモを生成しました'],
  ko: ['회의록 생성 중', '전사 정리 준비 중', '전사 정리 중', '요약 생성 중', '회의록 저장 중', '회의록이 생성되었습니다'],
  fr: ['Génération des notes de réunion', 'Préparation du nettoyage de la transcription', 'Nettoyage de la transcription', 'Génération du résumé', 'Enregistrement des notes', 'Notes de réunion générées'],
  de: ['Besprechungsnotizen werden erstellt', 'Transkriptbereinigung wird vorbereitet', 'Transkript wird bereinigt', 'Zusammenfassung wird erstellt', 'Besprechungsnotizen werden gespeichert', 'Besprechungsnotizen erstellt'],
  ru: ['Создание заметок встречи', 'Подготовка очистки расшифровки', 'Очистка расшифровки', 'Создание сводки', 'Сохранение заметок встречи', 'Заметки встречи созданы'],
};
function summaryTaskLabel(stage) {
  const copy = summaryTaskCopy[locale] || summaryTaskCopy.en;
  return { 'summary.prepare': copy[1], 'summary.cleaning': copy[2], 'summary.generating': copy[3], 'summary.saving': copy[4], 'summary.complete': copy[5] }[stage] || stage || t('准备中');
}
function showSummaryProgress(completed = 0, total = 100, stage = 'summary.prepare', meetingId) {
  clearTimeout(summaryDismissTimer);
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
function hideSummaryProgress() { clearTimeout(summaryDismissTimer); dismissTaskCard(document.querySelector('#summary-progress')); }
function showSummaryComplete() {
  showSummaryProgress(100, 100, 'summary.complete');
  finishTaskCard(document.querySelector('#summary-progress'));
  summaryDismissTimer = setTimeout(hideSummaryProgress, 10000);
}
function refreshLocalizedTaskCards() {
  if (!refinementCard.hidden) {
    const title = refinementCard.dataset.complete === 'true' ? t('会后精修已完成') : t('正在精修');
    refinementCard.querySelector('p').textContent = refinementMeetingTitle ? `${title} - ${refinementMeetingTitle}` : title;
    refinementPercent.textContent = refinementCard.dataset.total === '0' ? t('准备中') : `${Math.round(Number(refinementCard.dataset.completed || 0) / Number(refinementCard.dataset.total || 1) * 100)}%`;
  }
  const separation = document.querySelector('#separation-progress');
  if (separation) separation.querySelector('p').textContent = separation.dataset.complete === 'true' ? t('声源分离已完成') : t('正在分离人声与非人声');
  const summary = document.querySelector('#summary-progress');
  if (summary) {
    const total = Number(summary.dataset.total || 0);
    summary.querySelector('p').textContent = (summaryTaskCopy[locale] || summaryTaskCopy.en)[0];
    summary.querySelector('strong').textContent = `${summaryTaskLabel(summary.dataset.stage)}${total ? ` · ${Math.round(Number(summary.dataset.completed || 0) / total * 100)}%` : ''}`;
  }
}
async function generateMeetingSummary() {
  const config = summaryModels[activeSummaryModel];
  if (!config || !breviaClient.state.selectedMeetingId) { showSummaryConfigCard(); return; }
  showSummaryProgress(0, 100, 'summary.prepare');
  try {
    const summary = await window.brevia.summary.generate({
      meeting_id: breviaClient.state.selectedMeetingId,
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      format: config.format,
      key_reference: config.keyReference,
      language: locale,
      consent: true,
    });
    if (summary?.configuration_required) { hideSummaryProgress(); showSummaryConfigCard(); return; }
    const meeting = await window.brevia.meeting.get({ meeting_id: breviaClient.state.selectedMeetingId });
    meeting.summary = { data: summary };
    applyBackendDetail(meeting);
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
let onboardingModelSelection;
let initializationPromise;
const useChinaModelSource = () => locale === 'zh' && localStorage.getItem('brevia-china-model-source') === 'true';
const modelDownloadPayload = (modelId) => ({ model_id: modelId, ...(useChinaModelSource() ? { source: 'china' } : {}) });
const chinaModelSourceToggle = () => locale === 'zh' ? `<p class="model-source-switch"><label><input type="checkbox" data-china-model-source${useChinaModelSource() ? ' checked' : ''} /><span>您是否身处中国大陆？</span></label><small>选择后将会使用大陆镜像源进行下载提速。</small></p>` : '';
const onboardingCopy = {
  zh: { languageHint: '之后你可以随时修改界面语言。', meetingTitle: '你通常使用哪些会议语言？', meetingHint: '我们正在为您准备需要的语音识别模型。', modelsTitle: '准备离线转写功能', modelsHint: '为此，我们需要下载以下内容。', estimate: '预计占用空间', download: '下载并继续', customize: '自定义下载', later: '稍后设置', ready: '离线转写已准备就绪', capabilities: ['实时字幕', '语音活动检测', '自动标点', '会后精修', '语音分段', '说话人识别', '实时降噪', '声源分离'] },
  en: { languageHint: 'You can change the interface language any time.', meetingTitle: 'What languages do you usually use in meetings?', meetingHint: 'We’ll prepare the speech recognition models you need.', modelsTitle: 'Prepare offline transcription', modelsHint: 'To recognize speech on this device, Brevia needs to download the following.', estimate: 'Estimated storage', download: 'Download and continue', customize: 'Customize downloads', later: 'Set up later', ready: 'Offline transcription is ready', capabilities: ['Live captions', 'Voice activity detection', 'Automatic punctuation', 'Post-meeting refinement', 'Speech segmentation', 'Speaker recognition', 'Live denoising', 'Source separation'] },
  es: { languageHint: 'Puedes cambiar el idioma de la interfaz en cualquier momento.', meetingTitle: '¿Qué idiomas usas habitualmente en las reuniones?', meetingHint: 'Prepararemos los modelos de reconocimiento de voz que necesitas.', modelsTitle: 'Preparar transcripción sin conexión', modelsHint: 'Para reconocer voz en este dispositivo, Brevia necesita descargar lo siguiente.', estimate: 'Almacenamiento estimado', download: 'Descargar y continuar', customize: 'Personalizar descargas', later: 'Configurar más tarde', ready: 'La transcripción sin conexión está lista', capabilities: ['Subtítulos en vivo', 'Detección de voz', 'Puntuación automática', 'Refinamiento posterior', 'Segmentación de voz', 'Reconocimiento de hablantes', 'Reducción de ruido', 'Separación de fuentes'] },
  ja: { languageHint: '表示言語はいつでも変更できます。', meetingTitle: '会議ではどの言語をよく使いますか？', meetingHint: '必要な音声認識モデルを準備します。', modelsTitle: 'オフライン文字起こしを準備', modelsHint: 'このデバイスで音声を認識するため、以下をダウンロードします。', estimate: '必要な容量', download: 'ダウンロードして続ける', customize: 'ダウンロードをカスタマイズ', later: 'あとで設定', ready: 'オフライン文字起こしの準備ができました', capabilities: ['ライブ字幕', '音声区間検出', '自動句読点', '会議後の高精度化', '音声分割', '話者認識', 'ライブノイズ除去', '音源分離'] },
  ko: { languageHint: '인터페이스 언어는 언제든 변경할 수 있습니다.', meetingTitle: '회의에서 주로 어떤 언어를 사용하나요?', meetingHint: '필요한 음성 인식 모델을 준비합니다.', modelsTitle: '오프라인 전사 준비', modelsHint: '이 기기에서 음성을 인식하려면 다음 항목을 다운로드해야 합니다.', estimate: '예상 저장 공간', download: '다운로드하고 계속', customize: '다운로드 사용자 지정', later: '나중에 설정', ready: '오프라인 전사가 준비되었습니다', capabilities: ['실시간 자막', '음성 활동 감지', '자동 문장 부호', '회의 후 정제', '음성 분할', '화자 인식', '실시간 노이즈 제거', '음원 분리'] },
  fr: { languageHint: 'Vous pourrez modifier la langue de l’interface à tout moment.', meetingTitle: 'Quelles langues utilisez-vous habituellement en réunion ?', meetingHint: 'Nous préparerons les modèles de reconnaissance vocale nécessaires.', modelsTitle: 'Préparer la transcription hors ligne', modelsHint: 'Pour reconnaître la voix sur cet appareil, Brevia doit télécharger les éléments suivants.', estimate: 'Espace estimé', download: 'Télécharger et continuer', customize: 'Personnaliser les téléchargements', later: 'Configurer plus tard', ready: 'La transcription hors ligne est prête', capabilities: ['Sous-titres en direct', 'Détection d’activité vocale', 'Ponctuation automatique', 'Affinage après réunion', 'Segmentation vocale', 'Reconnaissance du locuteur', 'Réduction du bruit', 'Séparation des sources'] },
  de: { languageHint: 'Sie können die Sprache der Oberfläche jederzeit ändern.', meetingTitle: 'Welche Sprachen verwenden Sie üblicherweise in Besprechungen?', meetingHint: 'Wir bereiten die benötigten Spracherkennungsmodelle vor.', modelsTitle: 'Offline-Transkription vorbereiten', modelsHint: 'Um Sprache auf diesem Gerät zu erkennen, muss Brevia Folgendes herunterladen.', estimate: 'Geschätzter Speicherbedarf', download: 'Herunterladen und fortfahren', customize: 'Downloads anpassen', later: 'Später einrichten', ready: 'Offline-Transkription ist bereit', capabilities: ['Live-Untertitel', 'Sprachaktivitätserkennung', 'Automatische Zeichensetzung', 'Nachbearbeitung', 'Sprachsegmentierung', 'Sprechererkennung', 'Live-Rauschunterdrückung', 'Quellentrennung'] },
  ru: { languageHint: 'Язык интерфейса можно изменить в любое время.', meetingTitle: 'Какие языки вы обычно используете на встречах?', meetingHint: 'Мы подготовим нужные модели распознавания речи.', modelsTitle: 'Подготовить офлайн-расшифровку', modelsHint: 'Чтобы распознавать речь на этом устройстве, Brevia нужно скачать следующее.', estimate: 'Требуемое место', download: 'Скачать и продолжить', customize: 'Настроить загрузки', later: 'Настроить позже', ready: 'Офлайн-расшифровка готова', capabilities: ['Субтитры в реальном времени', 'Определение голосовой активности', 'Автопунктуация', 'Обработка после встречи', 'Сегментация речи', 'Распознавание говорящих', 'Шумоподавление в реальном времени', 'Разделение источников'] },
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
const onboardingWelcome = {
  zh: ['让每一次对话都有记录', '实时字幕、自动纪要和本地语音处理。', '开始设置'],
  en: ['Make every conversation count', 'Live transcription, automatic meeting notes, and private on-device processing.', 'Start setup'],
  es: ['Haz que cada conversación cuente', 'Transcripción en vivo, notas automáticas y procesamiento privado en el dispositivo.', 'Comenzar'],
  ja: ['すべての会話を記録に残す', 'ライブ文字起こし、自動議事録、デバイス内の音声処理。', '設定を始める'],
  ko: ['모든 대화를 기록으로 남기세요', '실시간 전사, 자동 회의록 및 기기 내 음성 처리.', '설정 시작'],
  fr: ['Donnez de l’importance à chaque conversation', 'Transcription en direct, notes automatiques et traitement privé sur l’appareil.', 'Commencer'],
  de: ['Jedes Gespräch zählt', 'Live-Transkription, automatische Besprechungsnotizen und private Verarbeitung auf dem Gerät.', 'Einrichtung starten'],
  ru: ['Сохраняйте каждую беседу', 'Расшифровка в реальном времени, автоматические заметки и приватная обработка на устройстве.', 'Начать настройку'],
};
const onboardingWelcomeFeatures = {
  zh: [['实时字幕', '以低延迟持续呈现当前发言，便于随时回看语境。'], ['自动纪要', '从完整逐字稿提炼结论、风险与待办，而非只生成摘要。'], ['说话人识别', '结合语音分段与声纹嵌入，还原讨论中的参与者脉络。'], ['会后精修', '利用完整音频进行二次校正，提升正式记录的可读性。'], ['本地处理', '识别、模型与原始音频默认保留在本机。'], ['可检索会议库', '按会议、逐字稿和标签快速回到关键讨论。']],
  en: [['Live transcription', 'Low-latency captions preserve the context of every discussion.'], ['Automatic notes', 'Derive decisions, risks, and actions from the complete transcript.'], ['Speaker intelligence', 'Segmentation and voiceprints keep participant context intact.'], ['Post-meeting refinement', 'A second pass over the complete recording improves the final record.'], ['Private by default', 'Audio, models, and source recordings remain on your device.'], ['Searchable library', 'Return to important discussions through meetings, transcripts, and tags.']],
  es: [['Transcripción en vivo', 'Ve cada punto importante mientras se dice.'], ['Notas automáticas', 'Conserva decisiones, tareas y contexto juntos.'], ['Privado por defecto', 'El audio y los modelos permanecen en tu dispositivo.']],
  ja: [['ライブ文字起こし', '重要な発言をその場で確認できます。'], ['自動議事録', '決定、タスク、文脈をまとめて残します。'], ['プライベート処理', '音声とモデルはデバイス内に保存されます。']],
  ko: [['실시간 전사', '중요한 내용을 말하는 즉시 확인합니다.'], ['자동 회의록', '결정, 할 일, 맥락을 함께 보관합니다.'], ['기본 비공개', '오디오와 모델은 기기에 보관됩니다.']],
  fr: [['Transcription en direct', 'Voyez les points importants au moment où ils sont prononcés.'], ['Notes automatiques', 'Gardez décisions, actions et contexte au même endroit.'], ['Privé par défaut', 'L’audio et les modèles restent sur votre appareil.']],
  de: [['Live-Transkription', 'Wichtige Punkte werden sofort sichtbar.'], ['Automatische Notizen', 'Entscheidungen, Aufgaben und Kontext bleiben zusammen.'], ['Privat standardmäßig', 'Audio und Modelle bleiben auf Ihrem Gerät.']],
  ru: [['Расшифровка в реальном времени', 'Важные моменты видны сразу после произнесения.'], ['Автоматические заметки', 'Сохраняйте решения, задачи и контекст вместе.'], ['Конфиденциальность по умолчанию', 'Аудио и модели остаются на устройстве.']],
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
      const action = progress.error || progress.cancelled ? `<button type="button" data-download-required="${id}">${t(progress.error ? '重试' : '下载')}</button>` : progress.cancelling ? '' : `<button class="task-card-close" type="button" data-pause-required="${id}" aria-label="${progress.paused ? t('继续') : t('暂停')}">${progress.paused ? '▶' : 'Ⅱ'}</button><button class="task-card-close" type="button" data-cancel-required="${id}" aria-label="取消">×</button>`;
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
  if (choice.dataset.flowSelectChoice === 'meeting-language') applyLanguageModelDefaults(choice.dataset.value);
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
  const isOllama = current.provider === 'Ollama';
  const isOllamaCloud = current.provider === 'Ollama Cloud';
  const apiFormat = current.format === 'claude' ? 'claude' : 'openai';
  const configuredControl = summaryModels.length ? `<div class="configured-models"><label class="config-select-field">${copy.configured}${flowSelect('active-summary-model', String(activeSummaryModel), summaryModels.map((item, index) => [String(index), `${item.name} · ${summaryProviderLabel(item.provider)} · ${item.model}${index === activeSummaryModel ? ` · ${copy.active}` : ''}`]), true)}</label></div>` : '';
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  const endpoint = current.endpoint || (isOllama ? ollamaChatEndpoint : isOllamaCloud ? ollamaCloudChatEndpoint : '');
  settingsModal.querySelector('.modal-body').innerHTML = `<form class="summary-model-form"><div class="config-fields"><label>${copy.name}<input name="name" value="${escapeHtml(current.name)}" maxlength="64" required /></label><label class="config-select-field">${copy.provider}${flowSelect('provider', current.provider, summaryProviders.map((provider) => [provider, summaryProviderLabel(provider)]))}</label><label data-summary-api-key${isOllama ? ' hidden' : ''}>${copy.key}<input name="apiKey" type="password" autocomplete="new-password" placeholder="${current.keyReference ? '•'.repeat(current.keyLength || 8) : ''}" /></label><label>${copy.endpoint}<input name="endpoint" value="${escapeHtml(endpoint)}" required /></label><label class="config-select-field" data-summary-format${(isOllama || isOllamaCloud) ? ' hidden' : ''}>${copy.format}${flowSelect('format', apiFormat, [['openai', copy.openAIFormat], ['claude', copy.claudeFormat]])}</label><label>${copy.model}<input name="model" value="${escapeHtml(current.model)}" placeholder="llama3.2" required /></label></div>${isOllama ? `<p class="ollama-hint">${t('使用本机 Ollama，不需要 API Key。请填写已安装的模型名。')}</p>` : isOllamaCloud ? `<p class="ollama-hint">${t('直接调用 Ollama Cloud，需要 API Key。请填写已安装的模型名。')}</p>` : ''}<div class="modal-form-actions"><button class="modal-action" type="submit">${copy.save}</button><button class="secondary" data-new-summary-model type="button">${copy.add}</button>${editingSummaryModel >= 0 ? `<button class="model-delete" data-delete-summary-model type="button">${copy.remove}</button>` : ''}</div></form>${configuredControl}<section class="modal-subsection"><h3>${copy.jsonTitle}</h3><p>${copy.jsonIntro}</p><pre class="config-json">${escapeHtml(renderConfigPreview())}</pre></section>`;
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
    const profileName = speakerProfileName(profile);
    const name = editingSpeakerProfileId === profile.id ? `<form class="speaker-profile-rename-form" data-profile-id="${profile.id}"><input name="name" value="${escapeHtml(profileName)}" maxlength="32" required autofocus /></form>` : `<b data-rename-speaker-profile="${profile.id}" title="双击修改名称">${escapeHtml(profileName)}</b>`;
    return `<section class="speaker-profile-entry"><div class="speaker-profile-head"><span>${name}<small>${profile.built_in ? `${t('内置')} · ` : ''}${profile.sample_count}/50 ${copy.samples} · ${formatMeetingTime(profile.duration_ms || 0)} / 05:00</small></span><span><button class="secondary" data-toggle-speaker-samples="${profile.id}" type="button">${expanded ? t('收起') : t('查看录音')}</button><button class="secondary" data-add-speaker-sample="${profile.id}" type="button">${copy.addSample}</button><button class="secondary" data-verify-speaker-profile="${profile.id}" type="button">${voiceCopy.verify}</button>${profile.built_in ? '' : `<button class="model-delete" data-delete-speaker-profile="${profile.id}" type="button">${copy.remove}</button>`}</span></div>${adding ? `<form class="speaker-sample-form" data-speaker-profile="${profile.id}"><label>${voiceCopy.reference}<input name="reference_text" maxlength="500" required autofocus /></label><button class="modal-action" type="submit">${t('选择录音并添加')}</button><button class="secondary" data-cancel-speaker-sample type="button">${t('取消')}</button></form>` : ''}${expanded ? `<div class="speaker-sample-list">${samples.length ? samples.map((sample) => `<article><button class="sample-play" data-play-speaker-sample="${sample.id}" type="button" aria-label="${t('播放录音')}">▶</button><span><b>${escapeHtml(sample.reference_text || t('未填写文本'))}</b><small>${formatMeetingTime(sample.duration_ms || 0)}</small></span>${profile.built_in ? '' : `<button class="model-delete" data-delete-speaker-sample="${sample.id}" data-profile-id="${profile.id}" type="button">${copy.remove}</button>`}</article>`).join('') : `<p>${copy.empty}</p>`}</div>` : ''}</section>`;
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
function renderSummaryDetailModal() {
  const markdown = currentMeetingDetail?.summary?.data?.markdown;
  if (!markdown) { closeModal(); return; }
  const copy = summaryDetailCopy[locale] || summaryDetailCopy.en;
  settingsModal.querySelector('h2').textContent = copy[0];
  settingsModal.querySelector('.modal-title p').textContent = currentMeetingDetail.title;
  settingsModal.querySelector('.modal-body').innerHTML = `<article class="markdown-content">${renderMarkdown(markdown)}</article><div class="modal-form-actions"><button class="secondary" type="button" data-regenerate-summary>${copy[1]}</button></div><section class="modal-subsection"><h3>${copy[2]}</h3><div class="export-options"><button type="button" data-summary-export-choice data-format="md"><span><b>Markdown</b><small>${copy[3]}</small></span><strong>.md</strong></button><button type="button" data-summary-export-choice data-format="txt"><span><b>TXT</b><small>${copy[4]}</small></span><strong>.txt</strong></button><button type="button" data-summary-export-choice data-format="pdf"><span><b>PDF</b><small>${copy[5]}</small></span><strong>.pdf</strong></button></div></section>`;
}
/** Renders one settings modal. @param {'models'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
function renderModal(kind) {
  if (kind === 'advanced-settings') {
    settingsModal.querySelector('h2').textContent = t('进阶设置');
    settingsModal.querySelector('.modal-title p').textContent = t('修改后会立即应用于下一次会议与精修。');
    settingsModal.querySelector('.modal-body').innerHTML = `<form class="advanced-settings-form"><p>${t('可修改模型、端点静音、说话人分离及 sherpa-onnx 运行参数。')}</p>${renderAdvancedSettings(advancedSettings?.settings || {})}<div class="modal-form-actions"><button class="modal-action" type="submit">${t('确定')}</button><button class="secondary" data-reset-advanced-settings type="button">${t('恢复默认')}</button></div></form>`;
    return;
  }
  if (kind === 'summary-model') { renderSummaryModelModal(); return; }
  if (kind === 'speaker-profiles') { renderSpeakerProfileModal(); return; }
  if (kind === 'export') { renderExportModal(); return; }
  if (kind === 'summary-detail') { renderSummaryDetailModal(); return; }
  const copy = (modalCopy[locale] || modalCopy.en)[kind];
  if (kind === 'storage') {
    settingsModal.querySelector('h2').textContent = copy.title;
    settingsModal.querySelector('.modal-title p').textContent = copy.intro;
    settingsModal.querySelector('.modal-body').innerHTML = `<div class="storage-list">${copy.items.map(([name, size], index) => `<section><span><b>${escapeHtml(name)}</b><small>${escapeHtml(size)}</small></span><span><button class="secondary" data-open-storage="${['meetings', 'models', 'exports'][index]}" type="button">${t('从文件夹打开')}</button><button class="model-delete" data-clear-storage="${['meetings', 'models', 'exports'][index]}" type="button">${t('清空数据')}</button></span></section>`).join('')}</div>`;
    return;
  }
  const modelStageOrder = new Map();
  (copy.items || []).forEach(([stage], index) => { if (!modelStageOrder.has(stage)) modelStageOrder.set(stage, index); });
  const selectingOnboardingModels = kind === 'models' && Boolean(onboardingPage);
  const items = kind === 'models' ? copy.items.map((item, sourceIndex) => ({ item, sourceIndex })).sort((a, b) => modelStageOrder.get(a.item[0]) - modelStageOrder.get(b.item[0])) : copy.items;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', (modalCopy[locale] || modalCopy.en).close);
  settingsModal.querySelector('.modal-body').innerHTML = `${kind === 'models' ? chinaModelSourceToggle() : ''}<div class="modal-list${kind === 'models' ? ' model-library-list' : ''}">${items.map((entry, index) => {
    const item = kind === 'models' ? entry.item : entry;
    const sourceIndex = kind === 'models' ? entry.sourceIndex : index;
    const [name, detail] = kind === 'models' ? item.slice(1, 3) : item;
    const [stage, , , intro] = kind === 'models' ? item : [];
    const label = `<b>${escapeHtml(name)}</b>`;
    const progress = kind === 'models' ? modelDownloads.get(modelIds[sourceIndex]) : null;
    const ratio = progress?.total ? Math.min(1, progress.received / progress.total) : 0;
    const downloadProgress = progress?.error ? `<span class="model-download-progress">${escapeHtml(progress.error)}</span>` : progress ? `<span class="model-download-progress">${formatBytes(progress.received)} / ${formatBytes(progress.total)} · ${Math.round(ratio * 100)}%<i aria-hidden="true" style="transform:scaleX(${ratio})"></i></span>` : '';
    const size = kind === 'models' ? `<small>${formatBytes(modelSize(modelIds[sourceIndex]))}</small>` : '';
    const installed = kind === 'models' && modelPaths.has(modelIds[sourceIndex]);
    const model = kind === 'models' ? modelCatalog.find((candidate) => candidate.id === modelIds[sourceIndex]) : null;
    const metadata = kind === 'models' ? renderModelLibraryMeta(model, detail) : '';
    const tags = kind === 'models' ? renderModelLibraryTags(model, installed) : '';
    const nameRow = kind === 'models' ? `<div class="model-library-name">${label}${tags}</div>` : label;
    const actions = kind === 'models' ? selectingOnboardingModels ? `<label class="model-select"><input type="checkbox" data-onboarding-model-selection value="${modelIds[sourceIndex]}"${installed ? ' checked disabled' : onboardingModelSelection?.has(modelIds[sourceIndex]) ? ' checked' : ''} /></label>` : `<span class="model-actions">${installed ? `<button class="secondary" data-open-model-folder="${sourceIndex}" type="button">${t('从文件夹打开')}</button>` : ''}<button class="modal-action${installed ? ' modal-danger' : ''}" ${installed ? `data-delete-model="${sourceIndex}"` : `data-download-model="${sourceIndex}"`} type="button"${progress && !progress.error ? ' disabled' : ''}>${installed ? (modelLabels[locale] || modelLabels.en).remove : progress && !progress.error ? (modelLabels[locale] || modelLabels.en).downloading : (modelLabels[locale] || modelLabels.en).download}</button></span>` : '';
    const heading = kind === 'models' && (index === 0 || items[index - 1].item[0] !== stage) ? `<h3>${escapeHtml(stage)}</h3>` : '';
    return `${heading}<div class="${kind === 'models' ? 'model-library-item' : ''}"><span>${nameRow}${downloadProgress}${kind === 'models' ? `${intro ? `<p>${escapeHtml(intro)}</p>` : ''}${metadata}` : `<small>${escapeHtml(detail)}</small>${size}${intro ? `<small>${escapeHtml(intro)}</small>` : ''}`}</span>${actions}</div>`;
  }).join('')}</div>${selectingOnboardingModels ? `<div class="modal-form-actions"><button class="modal-action" data-download-onboarding-selected type="button"${onboardingModelSelection?.size ? '' : ' disabled'}>${(onboardingCopy[locale] || onboardingCopy.en).download}</button></div>` : ''}`;
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
  settingsModal.classList.remove('modal-leave');
  settingsModal.hidden = false;
  requestAnimationFrame(() => settingsModal.classList.add('modal-enter'));
  document.body.classList.add('modal-open');
  settingsModal.querySelector('[data-cancel-confirmation]').focus();
}
async function openModal(kind) {
  clearTimeout(modalDismissTimer);
  if (kind === 'advanced-settings') {
    try { advancedSettings = await window.brevia?.advancedSettings.get() || { settings: {}, defaults: {} }; } catch (error) { showToast(error.message); return; }
  }
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

let onboardingPage;
let onboardingPreviewLocale;
let onboardingSelectedLocale;
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
  const defaults = new Set(['en', locale]);
  showOnboardingPage('setup', `<section class="onboarding-setup-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="Back">←</button><header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${copy.modelsTitle}</h1><div class="onboarding-intro"><p>${copy.meetingHint} ${copy.modelsHint}</p><small>${securityHint}</small></div></header><section class="onboarding-section"><h2>${copy.meetingTitle}</h2><div class="onboarding-language-selection"><div class="onboarding-check-grid">${choices.map((code) => `<label><input type="checkbox" name="onboarding-language" value="${code}"${defaults.has(code) ? ' checked' : ''} /><span>${new Intl.DisplayNames([locale], { type: 'language' }).of(code)}</span></label>`).join('')}</div><aside class="onboarding-model-preview"><strong>${modelListLabels[0]}</strong><ul data-onboarding-language-models></ul></aside></div></section><section class="onboarding-section"><h2>${t('离线功能')}</h2><div class="onboarding-language-selection"><div class="onboarding-feature-grid">${copy.capabilities.map((capability) => `<label><input type="checkbox" checked disabled /><span>${capability}</span></label>`).join('')}</div><aside class="onboarding-model-preview"><strong>${modelListLabels[1]}</strong><ul data-onboarding-feature-models></ul></aside></div></section><section class="onboarding-model-summary"><strong>${copy.estimate}: <span data-onboarding-estimate></span></strong>${chinaModelSourceToggle()}</section><div class="onboarding-actions"><button class="modal-action" data-download-onboarding-models type="button">${copy.download}</button><button class="secondary" data-customize-onboarding-models type="button">${copy.customize}</button><button class="secondary" data-finish-onboarding type="button">${copy.later}</button></div></section>`);
  updateOnboardingSetup();
  onboardingPage.addEventListener('change', (event) => {
    if (event.target.matches('[name="onboarding-language"]')) updateOnboardingSetup();
    if (event.target.matches('[data-china-model-source]')) localStorage.setItem('brevia-china-model-source', event.target.checked);
  });
  onboardingPage.addEventListener('click', (event) => {
    if (event.target.closest('[data-onboarding-back-language]')) { dismissOnboardingPage(openOnboardingPermissions); return; }
    if (event.target.closest('[data-download-onboarding-models]')) { window.BreviaOnboarding.beginDownloads(onboardingModelIds); downloadRequiredModels(onboardingModelIds); dismissOnboardingPage(finishOnboarding); return; }
    if (event.target.closest('[data-customize-onboarding-models]')) { onboardingModelSelection = new Set(onboardingModelIds); void openModal('models'); return; }
    if (event.target.closest('[data-finish-onboarding]')) dismissOnboardingPage(finishOnboarding);
  });
}

function updateOnboardingSetup() {
  const languages = [...onboardingPage.querySelectorAll('[name="onboarding-language"]:checked')].map((input) => input.value);
  const uniqueModelIds = (details) => details.map(([modelId]) => modelId).filter((modelId, index, models) => modelId && models.indexOf(modelId) === index);
  const languageModels = uniqueModelIds(languages.flatMap((language) => {
    const [streaming, , , refined] = requiredModelsForLanguage(language);
    return [[streaming], [refined]];
  }));
  const featureModels = uniqueModelIds(languages.flatMap((language) => {
    const [, vad, punctuation, , segmentation, embedding, denoiser, separation] = requiredModelsForLanguage(language);
    return [[vad], [punctuation], [segmentation], [embedding], [denoiser], [separation]];
  }));
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

function openOnboardingPermissions() {
  const copy = onboardingCopy[locale] || onboardingCopy.en;
  const steps = [
    ['microphone', t('麦克风'), t('录制你的发言。')],
    ['screen', t('屏幕与系统音频'), t('录制屏幕共享中的系统声音。')],
  ];
  const placeholders = steps.map(([permission, label, detail], index) => `<div class="onboarding-permission"><span class="onboarding-permission-state">${index + 1}</span><span><b>${label}</b><small>${detail}</small></span><button class="modal-action onboarding-permission-action onboarding-permission-placeholder" type="button" disabled>${permission === 'microphone' ? t('允许') : t('继续')}</button></div>`).join('') + `<div class="onboarding-permission-complete onboarding-permission-placeholder" aria-hidden="true">&nbsp;</div>`;
  showOnboardingPage('permissions', `<section class="onboarding-setup-page onboarding-permissions-page"><button class="onboarding-back" data-onboarding-back-language type="button" aria-label="Back">←</button><header><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /><h1>${t('录制权限')}</h1><div class="onboarding-intro"><p>${t('言录需要麦克风、屏幕与系统音频权限，才能录制会议并生成实时字幕。')}</p></div></header><section class="onboarding-section" data-onboarding-permissions>${placeholders}</section><div class="onboarding-actions"><button class="modal-action" data-finish-onboarding type="button" disabled>${t('继续')}</button><button class="secondary" data-skip-onboarding-permissions type="button">${copy.later}</button></div></section>`);
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
      const state = granted ? '✓' : active ? String(index + 1) : '—';
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
    section.insertAdjacentHTML('beforeend', complete ? `<div class="onboarding-permission-complete">✓ ${t('录制权限')} ${t('已准备就绪')}</div>` : `<div class="onboarding-permission-complete onboarding-permission-placeholder" aria-hidden="true">&nbsp;</div>`);
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
});
let modelAction = document.querySelector('[data-settings-modal="models"]');
speakerProfileCard.querySelector('button').addEventListener('click', () => openModal('speaker-profiles'));
const installedModelNames = new Set();
const modelPaths = new Map();
/** Checks whether a model is installed locally. @param {string} name Model name. @returns {boolean} Whether the model exists in the installed set. */
function isModelInstalled(name) { return installedModelNames.has(name); }
/** Removes an installed model from the list and local state. @param {string} name Model name. @returns {void} */
function deleteInstalledModel(name) { installedModelNames.delete(name); }
/** Synchronizes installed-model actions after a locale or model-list change. @returns {void} */
function renderModelControls() {
  modelAction = document.querySelector('[data-settings-modal="models"]');
  modelAction.textContent = (modelLabels[locale] || modelLabels.en).manage;
}
/** Records a newly downloaded model for the management dialog. @param {{name: string}} model Downloaded model metadata. @returns {void} */
function installModel(model) {
  if (isModelInstalled(model.name)) return;
  installedModelNames.add(model.name);
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
  const voiceOptions = [['', copy.voice], ...[...presetVoices, ...speakerProfiles.filter((profile) => profile.has_reference).map((profile) => ({ id: profile.id, name: speakerProfileName(profile) }))].map((voice) => [voice.id, voice.name])];
  const ttsLanguages = ['zh', 'en', 'ko', 'fr', 'de', 'es', 'ru'].map((code) => [code, BreviaI18n.languageName(locale, code)]);
  document.querySelector('.live-panel').innerHTML = `<section><p class="eyebrow">${t('参与者')} · ${participants.length}</p><div class="participants-list">${people}</div></section><section><p class="eyebrow">${t('本场状态')}</p>${renderStatusList(uiData.live.status)}</section>`;
  document.querySelector('#tts-chat').innerHTML = `<p class="eyebrow">${copy.chat}</p><form id="tts-chat-form"><div class="tts-selects">${flowSelect('voice_id', '', voiceOptions)}${flowSelect('target_language', 'zh', ttsLanguages)}</div><input name="text" maxlength="1000" placeholder="${copy.placeholder}" required /><button type="submit">${copy.send}</button></form>`;
}
renderModelControls();
renderLivePanel();
settingsModal.addEventListener('click', async (event) => {
  if (event.target.closest('[data-download-onboarding-selected]')) {
    const models = [...(onboardingModelSelection || [])].filter((modelId) => !modelPaths.has(modelId));
    if (!models.length) return;
    onboardingModelIds = models;
    window.BreviaOnboarding.beginDownloads(models);
    downloadRequiredModels(models);
    closeModal();
    dismissOnboardingPage(finishOnboarding);
    return;
  }
  if (event.target === settingsModal || event.target.closest('.modal-close')) { closeModal(); return; }
  if (event.target.closest('[data-cancel-confirmation]')) { confirmationAction = undefined; closeModal(); return; }
  if (event.target.closest('[data-reset-advanced-settings]')) { advancedSettings.settings = advancedSettings.defaults; renderModal('advanced-settings'); return; }
  if (event.target.closest('[data-confirm-action]')) { const action = confirmationAction; confirmationAction = undefined; closeModal(); await action?.(); return; }
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
    if (select.querySelector('input').name === 'provider') {
      const form = select.closest('.summary-model-form');
      const provider = selectChoice.dataset.value;
      const ollama = provider === 'Ollama';
      const ollamaCloud = provider === 'Ollama Cloud';
      form.querySelector('[data-summary-api-key]').hidden = ollama;
      form.querySelector('[data-summary-format]').hidden = ollama || ollamaCloud;
      if (ollama || ollamaCloud) {
        form.querySelector('[name="endpoint"]').value = ollamaCloud ? ollamaCloudChatEndpoint : ollamaChatEndpoint;
        form.querySelector('[name="format"]').value = 'openai';
      }
    }
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
  const selection = event.target.closest('[data-onboarding-model-selection]');
  if (!selection) return;
  if (selection.checked) onboardingModelSelection.add(selection.value);
  else onboardingModelSelection.delete(selection.value);
  renderModal('models');
});
settingsModal.addEventListener('dblclick', (event) => {
  const profile = event.target.closest('[data-rename-speaker-profile]');
  if (!profile) return;
  editingSpeakerProfileId = profile.dataset.renameSpeakerProfile;
  renderModal('speaker-profiles');
  settingsModal.querySelector('.speaker-profile-rename-form input')?.select();
});
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
  if (event.target.matches('.summary-model-form')) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const previous = summaryModels[editingSummaryModel];
    values.keyReference = previous?.keyReference || `summary-${crypto.randomUUID()}`;
    if (values.apiKey && window.brevia) {
      values.keyLength = values.apiKey.length;
      await window.brevia.secret.set({ reference: values.keyReference, value: values.apiKey });
    }
    delete values.apiKey;
    if (editingSummaryModel < 0) { summaryModels.push(values); activeSummaryModel = summaryModels.length - 1; } else summaryModels[editingSummaryModel] = values;
    editingSummaryModel = activeSummaryModel;
    draftSummaryName = '';
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
});
let ttsSubmitting = false;
let activeTtsAudio;
async function playTts(result) {
  if (!result) return;
  activeTtsAudio?.pause();
  const audio = new Audio(await window.brevia.audioUrl(result.path));
  activeTtsAudio = audio;
  audio.addEventListener('ended', () => { if (activeTtsAudio === audio) activeTtsAudio = undefined; }, { once: true });
  await audio.play();
  showToast((voiceFeaturesCopy[locale] || voiceFeaturesCopy.en).ready);
}
document.querySelector('#live-view').addEventListener('submit', async (event) => {
  if (!event.target.matches('#tts-chat-form')) return;
  event.preventDefault();
  if (ttsSubmitting) return;
  const values = new FormData(event.target);
  const submit = event.target.querySelector('[type="submit"]');
  let submitLabel = '';
  try {
    const voiceId = values.get('voice_id');
    const targetLanguage = values.get('target_language');
    if (['zh', 'en'].includes(targetLanguage) && !voiceId) { showToast(t('请选择声音')); return; }
    const config = summaryModels[activeSummaryModel];
    if (!config) { showToast(t('请先配置翻译模型')); return; }
    ttsSubmitting = true;
    submitLabel = submit.innerHTML;
    submit.disabled = true;
    submit.classList.add('is-pending');
    submit.setAttribute('aria-busy', 'true');
    submit.innerHTML = `<i class="button-spinner" aria-hidden="true"></i>${t('准备中')}`;
    const result = await window.brevia?.tts.synthesize({ ...(voiceId ? { voice_id: voiceId } : {}), target_language: targetLanguage, text: values.get('text').trim(), provider: config.provider, endpoint: config.endpoint, model: config.model, format: config.format, key_reference: config.keyReference });
    if (result?.model_required) return;
    await playTts(result);
    event.target.reset();
  } catch (error) { showToast(error.message); } finally {
    if (!ttsSubmitting) return;
    ttsSubmitting = false;
    submit.disabled = false;
    submit.classList.remove('is-pending');
    submit.removeAttribute('aria-busy');
    submit.innerHTML = submitLabel;
  }
});
document.querySelector('#tts-chat').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-flow-select-toggle]');
  if (toggle) {
    const options = toggle.parentElement.querySelector('.flow-select-options');
    const opening = options.hidden;
    document.querySelector('#tts-chat').querySelectorAll('.flow-select-options').forEach((list) => { list.hidden = true; list.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
    const bounds = toggle.getBoundingClientRect();
    const liveBounds = document.querySelector('#live-view').getBoundingClientRect();
    const spaceAbove = bounds.top - liveBounds.top;
    const spaceBelow = liveBounds.bottom - bounds.bottom;
    const opensUp = spaceAbove > spaceBelow;
    options.classList.toggle('opens-up', opensUp);
    options.style.maxHeight = `${Math.max(64, Math.min(160, Math.max(spaceAbove, spaceBelow) - 8))}px`;
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
  const rerendered = [
    '.settings-grid', '.meeting-list', '#meeting-form .form-grid',
    '.final-transcript', '.notes', '.live-panel', '#tts-chat', '#model-download-queue',
  ].map((selector) => document.querySelector(selector));
  rerendered.push(batchToolbar, updateNotice.hidden ? null : updateNotice, settingsModal.hidden ? null : settingsModal.querySelector('.modal-panel'));
  const rerenderedRoots = rerendered.filter(Boolean);
  const nodes = [...new Set([
    ...translatedNodes
      .map(({ node, element }) => node?.parentElement || element)
      .filter((element) => element && !rerenderedRoots.some((root) => root.contains(element))),
    ...rerenderedRoots,
  ])];
  const updateText = () => {
    translatedNodes.forEach(({ node, element, attribute, key, leading = '', trailing = '' }) => {
      const value = t(key);
      if (node) node.nodeValue = `${leading}${value}${trailing}`;
      else element[attribute] = value;
    });
    renderPrepareSelects();
    renderPauseButton();
    renderSettingsView();
    document.querySelector('#settings-view .settings-grid').append(speakerProfileCard, updateCard);
    renderDefaultMeetingTitle();
    renderCategoryFilter();
    renderDateFilter();
    renderMeetingList();
    renderMeetingDetail();
    if (activeView === 'home') selectLibraryNav(activeLibraryNav);
    else crumb.textContent = catalog[locale].views[activeView];
    renderSlogan(false);
    renderUpdateButton();
    renderUpdateNotice();
    renderSpeakerProfileCard();
    renderModelControls();
    renderLivePanel();
    renderRequiredModelsCard();
    refreshLocalizedTaskCards();
    document.querySelector('[data-separate-detail]').textContent = (voiceFeaturesCopy[locale] || voiceFeaturesCopy.en).source;
    renderConfigPreview();
    if (activeModal) renderModal(activeModal);
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
  const copy = { title: t(rejected ? '纪要服务拒绝了请求' : '纪要模型需要配置'), detail: t(rejected ? '请检查 API 地址、密钥和服务商访问策略。' : 'API Key 未配置、已失效或不匹配当前服务。'), action: t('配置纪要模型') };
  card.innerHTML = `<header class="task-card-heading"><p>${copy.title}</p>${taskCardControls()}</header><strong>${copy.detail}</strong><button class="secondary" type="button">${copy.action}</button>`;
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
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason || '未知异步错误');
  showToast(`${t('操作失败')}: ${message}`);
});
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message;
  if (message) showToast(`${t('应用错误')}: ${message}`);
});
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
  if (name === 'prepare') { requestAnimationFrame(fitPrepareLayout); void previewMicrophone(); }
  renderMiniPlayback();
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
applyLanguageModelDefaults(new FormData(prepareForm).get('meeting-language') || 'auto');
applyTheme(theme);
async function loadInstalledAppVersion() {
  try {
    const version = await window.brevia?.appInfo?.version?.();
    if (version) { installedAppVersion = version; renderUpdateButton(); return; }
  } catch { /* Fall through to the packaged manifest. */ }
  try {
    const response = await fetch('../package.json');
    const { version } = await response.json();
    if (response.ok && version) { installedAppVersion = version; renderUpdateButton(); }
  } catch { /* Keep the unavailable marker when neither source can be read. */ }
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
  renderUpdateButton();
  try { await window.brevia.update.install(); }
  catch (error) { showToast(error.message); updateBusy = false; renderUpdateButton(); }
}
void checkForUpdates({ silent: true });
window.setInterval(() => { if (activeLibraryNav === 'recently-deleted') return; sloganIndex = (sloganIndex + 1) % (slogans[locale] || slogans.en).length; renderSlogan(true); }, 30000);
updateButton.addEventListener('click', () => void runUpdateAction());
updateNoticeButton.addEventListener('click', () => void runUpdateAction());
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
function minimizeMeeting() { miniTitle.textContent = document.querySelector('#live-name').textContent; miniTimer.textContent = document.querySelector('#timer').textContent; const wasHidden = miniMeeting.hidden; miniMeeting.hidden = false; if (wasHidden) taskCards.append(miniMeeting); requestAnimationFrame(syncFloatingNotices); }
document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (!target || ['all-meetings', 'recently-deleted'].includes(target.id)) return; if (target.dataset.view === 'home') selectLibraryNav('all-meetings'); if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting(); showView(target.dataset.view); });
homePrimary.addEventListener('click', () => showView('prepare'));
homeEyebrow.addEventListener('click', async () => {
  if (activeLibraryNav !== 'recently-deleted') return;
  await showLibraryNav('all-meetings').catch((error) => showToast(error.message));
});
function setLiveTranslationEnabled(enabled) {
  translationAllowed = enabled;
  const toggle = document.querySelector('#translation-toggle');
  toggle.dataset.enabled = String(enabled);
  toggle.textContent = t(enabled ? '译文: 开' : '译文: 关');
  if (!enabled) document.querySelectorAll('.translation').forEach((line) => { line.hidden = true; });
}
function activateMeeting(meeting, payload) {
  const { title, category, streaming_model_id: streamingModelId, speaker_segmentation_model_id: segmentationModelId, speaker_embedding_model_id: embeddingModelId, refined_model_id: refinedModelId } = payload;
  const streamingModelName = prepareModelChoices['active-streaming-model'].find(([id]) => id === streamingModelId)?.[1] || t('自动匹配');
  document.querySelector('#active-streaming-model').textContent = streamingModelName;
  uiData.live.status[0].value = streamingModelName;
  document.querySelector('#active-diarization-model').textContent = prepareModelChoices['active-diarization-model'].find(([id]) => id === `${segmentationModelId || ''}|${embeddingModelId || ''}`)?.[1] || t('自动匹配');
  document.querySelector('#active-refined-model').textContent = modelChoices('active-refined-model').find(([id]) => id === refinedModelId)?.[1] || t('自动匹配');
  document.querySelector('#live-name').textContent = title;
  uiData.meetings.unshift({ id: meeting.id, tone: 'violet', title, meta: `${t('刚刚')} · 0 ${t('分钟')}${category ? ` · ${category}` : ''}`, category, tags: [], status: { tone: 'processing', label: t('正在录制'), detail: t('双轨录音') } });
  document.querySelector('#transcript-scroll').innerHTML = '';
  document.querySelector('#live-caption').textContent = '';
  document.querySelector('#live-caption-translation').hidden = true;
  setLiveTranslationEnabled(Boolean(payload.target_language));
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
  const defaults = preferredModelsForLanguage(language);
  const targetLanguage = form.get('translation-target') || null;
  const streamingModelId = prepareForm.dataset.streamingModel || defaults.streaming;
  const refinedModelId = prepareForm.dataset.refinedModel || defaults.refined;
  const [defaultSegmentationModelId, defaultEmbeddingModelId] = defaults.diarization.split('|');
  const segmentationModelId = prepareForm.dataset.segmentationModel || defaultSegmentationModelId;
  const embeddingModelId = prepareForm.dataset.embeddingModel || defaultEmbeddingModelId;
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
  const language = form.get('meeting-language') || 'auto';
  const defaults = preferredModelsForLanguage(language);
  const [defaultSegmentationModelId, defaultEmbeddingModelId] = defaults.diarization.split('|');
  importRecording.disabled = true;
  try {
    const meeting = window.brevia && await window.brevia.meeting.import({
      title, language, target_language: form.get('translation-target') || null,
      streaming_model_id: prepareForm.dataset.streamingModel || defaults.streaming, refined_model_id: prepareForm.dataset.refinedModel || defaults.refined,
      speaker_segmentation_model_id: prepareForm.dataset.segmentationModel || defaultSegmentationModelId, speaker_embedding_model_id: prepareForm.dataset.embeddingModel || defaultEmbeddingModelId,
      num_speakers: Number(form.get('num-speakers') || -1), category: form.get('meeting-category') || '', path: 'selected-by-electron',
    });
    if (!meeting) return;
    applyBackendDetail(meeting);
    await refreshBackendMeetings();
    showView('detail');
    void window.brevia.meeting.refine({ meeting_id: meeting.id }).catch((error) => { hideRefinementProgress(); showToast(error.message); });
  } catch (error) { showToast(error.message); } finally { importRecording.disabled = false; }
});
let seconds = 0;
let timer;
/** Keeps the recording control label in sync with the active locale and state. @returns {void} */
function renderPauseButton() {
  const button = document.querySelector('#pause');
  const paused = button.dataset.paused === 'true';
  button.textContent = `${paused ? '▶' : 'Ⅱ'} ${t(paused ? '继续' : '暂停')}`;
}
/** Starts the visible recording timer, replacing any prior timer. @returns {void} */
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
  button.disabled = true;
  clearInterval(timer);
  try {
    const meeting = breviaClient ? await breviaClient.stop(seconds * 1000) : null;
    meetingActive = false;
    miniMeeting.hidden = true;
    syncFloatingNotices();
    if (meeting) {
      applyBackendDetail(meeting);
      void window.brevia.meeting.refine({ meeting_id: meeting.id }).catch((error) => {
        hideRefinementProgress();
        showToast(`${t('会后精修失败')}: ${error.message}`);
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
  const enabled = !translationAllowed;
  if (enabled && window.brevia) {
    const config = summaryModels[activeSummaryModel];
    if (!config || !breviaClient?.state.meeting?.target_language) { showToast(t('请先选择译文目标并配置纪要模型')); return; }
    if (!confirm(t('将确认字幕发送到 {provider} 生成译文。是否继续？').replace('{provider}', config.provider))) return;
  }
  setLiveTranslationEnabled(enabled);
  document.querySelectorAll('.translation').forEach((line) => { line.hidden = !enabled; });
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
  if (choice.dataset.flowSelectChoice === 'library-category') activeCategory = choice.dataset.value; else activeDateRange = choice.dataset.value;
  filterMeetings();
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
  if (event.target.matches('input, textarea')) return;
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
    const format = prompt(t('选择格式：md / txt / json / srt / docx / pdf / flac / wav / m4a'), 'md')?.toLowerCase();
    if (!format) return;
    try {
      const result = window.brevia ? await window.brevia.meeting.exportMany({ meeting_ids: meetings.map(({ id }) => id).filter(Boolean), format }) : { paths: meetings.map(({ title }) => `${title}.${format}`) };
      if (result) showToast(`${t('导出')}: ${BreviaI18n.selectionOverview(locale, meetings.length)}`);
    } catch (error) { showToast(error.message); }
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
const positionOpenMeetingMenus = () => document.querySelectorAll('.meeting-menu:not([hidden]), .meeting-category-menu:not([hidden])').forEach((menu) => {
  const toggle = menu.closest('.meeting-actions')?.querySelector('[data-meeting-menu]');
  if (toggle) positionMeetingMenu(menu, toggle, menu.classList.contains('meeting-category-menu'));
});
const openMeetingMenu = (menu, toggle, opensLeft = false) => { menu.hidden = false; positionMeetingMenu(menu, toggle, opensLeft); };
const closeCategoryMenu = (menu, done) => { if (menu.hidden) { done?.(); return; } menu.classList.add('is-closing'); window.setTimeout(() => { menu.hidden = true; menu.classList.remove('is-closing'); done?.(); }, 180); };
const closeMeetingMenus = () => { document.querySelectorAll('.meeting-menu').forEach((menu) => { menu.hidden = true; }); document.querySelectorAll('.meeting-category-menu').forEach((menu) => closeCategoryMenu(menu)); document.querySelectorAll('[data-meeting-menu]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false')); };
meetingList.addEventListener('scroll', positionOpenMeetingMenus);
window.addEventListener('resize', positionOpenMeetingMenus);
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
  const request = ++meetingListRequest;
  breviaClient.state.selectedMeetingId = row.dataset.meetingId;
  const meeting = await window.brevia.meeting.get({ meeting_id: row.dataset.meetingId });
  if (request !== meetingListRequest) return;
  applyBackendDetail(meeting);
  showView('detail');
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
    if (action.dataset.meetingAction === 'category') { actions.querySelector('.meeting-menu').hidden = true; openMeetingMenu(actions.querySelector('.meeting-category-menu'), actions.querySelector('[data-meeting-menu]'), true); return; }
    if (action.dataset.meetingAction === 'back') { closeCategoryMenu(actions.querySelector('.meeting-category-menu'), () => { openMeetingMenu(actions.querySelector('.meeting-menu'), actions.querySelector('[data-meeting-menu]')); }); return; }
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
  const category = event.target.closest('[data-assign-category]');
  if (category) { const meeting = uiData.meetings[Number(category.dataset.meetingIndex)]; setMeetingCategory(meeting, category.dataset.assignCategory); if (window.brevia && meeting.id) window.brevia.meeting.update({ meeting_id: meeting.id, updates: { category: meeting.category } }).catch((error) => showToast(error.message)); renderMeetingList(); return; }
  const deleteCategory = event.target.closest('[data-delete-meeting-category]');
  if (deleteCategory) { const category = deleteCategory.dataset.deleteMeetingCategory; uiData.meetings.filter((meeting) => meeting.category === category).forEach((meeting) => setMeetingCategory(meeting, '')); categories = categories.filter((name) => name !== category); if (activeCategory === category) activeCategory = ''; persistCategories(); renderCategoryFilter(); renderPrepareSelects(); renderMeetingList(); }
});
meetingList.addEventListener('submit', (event) => {
  if (event.target.matches('[data-rename-meeting]')) { event.preventDefault(); const title = new FormData(event.target).get('title').trim(); const meeting = uiData.meetings[Number(event.target.dataset.meetingIndex)]; editingMeetingIndex = null; if (title) { meeting.title = title; if (window.brevia && meeting.id) window.brevia.meeting.update({ meeting_id: meeting.id, updates: { title } }).catch((error) => showToast(error.message)); } renderMeetingList(); return; }
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
meetingList.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && event.target.matches('[data-rename-meeting] input')) { editingMeetingIndex = null; renderMeetingList(); }
});
document.addEventListener('click', (event) => {
  const renameForm = meetingList.querySelector('[data-rename-meeting]');
  if (renameForm && !event.target.closest('.meeting-row')) renameForm.requestSubmit();
  if (!event.target.closest('.flow-select')) document.querySelectorAll('.flow-select-options:not([hidden])').forEach((options) => { options.hidden = true; options.previousElementSibling.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  if (!event.target.closest('.meeting-actions')) closeMeetingMenus();
});
const progress = document.querySelector('#progress');
const playerTime = document.querySelector('#player-time');
const playerAudio = new Audio();
const playButton = document.querySelector('#play');
let playbackStarted = false;
let followPlaybackTranscript = true;
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
  if (!followPlaybackTranscript) return;
  const bodyRect = body.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  body.scrollTo({
    top: body.scrollTop + activeRect.top - bodyRect.top - (body.clientHeight - activeRect.height) / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
progress.addEventListener('input', () => { followPlaybackTranscript = true; renderPlayerTime(); playerAudio.currentTime = Number(progress.value); syncPlaybackTranscript(); });
document.addEventListener('click', (event) => { const button = event.target.closest('.jump'); if (button) { followPlaybackTranscript = true; progress.value = button.dataset.time; playerAudio.currentTime = Number(button.dataset.time); renderPlayerTime(); syncPlaybackTranscript(); showToast(message('located')); } });
playButton.addEventListener('click', async () => {
  if (!playerAudio.src) { showToast(t('这场会议没有可播放的录音')); return; }
  if (playerAudio.paused) await playerAudio.play(); else playerAudio.pause();
  showToast(message(playerAudio.paused ? 'paused' : 'playing'));
});
playerAudio.addEventListener('play', () => { playbackStarted = true; updatePlayerControl(); });
playerAudio.addEventListener('pause', updatePlayerControl);
playerAudio.addEventListener('ended', () => { playbackStarted = false; updatePlayerControl(); });
playerAudio.addEventListener('timeupdate', () => { progress.value = playerAudio.currentTime; renderPlayerTime(); syncPlaybackTranscript(); renderMiniPlayback(); });
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
function closeSegmentContextMenu() {
  contextSegmentId = undefined;
  contextMeetingId = undefined;
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
function openSegmentContextMenu(meetingId, segmentId, x, y) {
  followLiveTranscript = false;
  followPlaybackTranscript = false;
  contextMeetingId = meetingId;
  contextSegmentId = segmentId;
  const profiles = speakerProfiles.map((profile) => `<button type="button" data-add-segment-profile-sample="${profile.id}">${escapeHtml(speakerProfileName(profile))}</button>`).join('');
  const createProfile = `<div class="segment-context-submenu"><button type="button" data-open-segment-profile-create><span class="segment-context-label">${t('新增声纹')}</span><span class="segment-context-arrow" aria-hidden="true">›</span></button><form class="segment-context-options segment-context-name-form" data-create-segment-profile><label>${t('声纹名称')}<input name="name" maxlength="32" required autocomplete="off" /></label><button type="submit">${t('确定')}</button></form></div>`;
  segmentContextMenu.innerHTML = `<div class="segment-context-submenu"><button type="button" data-open-segment-profile-menu><span class="segment-context-label">${t('添加录音到声纹库')}</span><span class="segment-context-arrow" aria-hidden="true">›</span></button><div class="segment-context-options">${profiles || `<span>${t('暂无已注册声纹')}</span>`}${createProfile}</div></div>`;
  segmentContextMenu.style.visibility = 'hidden';
  segmentContextMenu.hidden = false;
  positionFloating(segmentContextMenu, { left: x, right: x, top: y, bottom: y });
  segmentContextMenu.style.visibility = '';
}
segmentContextMenu.addEventListener('click', async (event) => {
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
  openSegmentContextMenu(currentMeetingDetail.id, segment.dataset.segmentId, event.clientX, event.clientY);
});
document.addEventListener('mousedown', (event) => {
  if (!segmentContextMenu.hidden && !segmentContextMenu.contains(event.target)) closeSegmentContextMenu();
});
finalTranscript.addEventListener('click', (event) => {
  if (event.target.closest('[data-separate-from-tracks]')) { void startSeparation(); return; }
  const tab = event.target.closest('[data-detail-tab]');
  if (!tab) return;
  const target = tab.dataset.detailTab;
  finalTranscript.querySelectorAll('[data-detail-tab]').forEach((item) => item.classList.toggle('active', item.dataset.detailTab === target));
  finalTranscript.querySelectorAll('[data-detail-panel]').forEach((panel) => { panel.hidden = panel.dataset.detailPanel !== target; });
});
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
  window.brevia.on('startup.ready', dismissStartupSplash);
  if (window.BreviaOnboarding.isFirstLaunch()) openOnboardingLanguage();
  void loadSummaryConfig().catch((error) => showToast(`${t('纪要配置加载失败')}: ${error.message}`));
  initializationPromise = breviaClient.initialize().then((result) => {
    modelCatalog = result.models;
    renderRefinedModelChoices();
    setPrepareModel('active-refined-model', document.querySelector('#active-refined-model').dataset.model);
    uiData.meetings = result.meetings.map(backendMeeting);
    speakerProfiles = result.speaker_profiles || [];
    presetVoices = result.preset_voices || [];
    installedModelNames.clear();
    modelPaths.clear();
    result.models.filter((model) => model.status === 'ready').forEach((model) => {
      installedModelNames.add(model.name.replace(' 0.6B int8', ''));
      if (model.path) modelPaths.set(model.id, model.path);
    });
    document.querySelector('#active-device').textContent = result.device.backend.toUpperCase();
    uiData.live.status[1].value = result.device.backend.toUpperCase();
    renderLivePanel();
    renderSpeakerProfileCard();
    renderMeetingList();
    void window.brevia.maintain();
  });
  void initializationPromise.catch((error) => showToast(`${t('配置或后端启动失败')}: ${error.message}`));

  const transcript = document.querySelector('#transcript-scroll');
  const isAtLiveBottom = () => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 32;
  const scrollLiveToLatest = (segment) => {
    if (!segment) return;
    transcript.scrollTop = transcript.scrollHeight;
    followLiveTranscript = true;
  };
  transcript.addEventListener('scroll', () => { followLiveTranscript = isAtLiveBottom(); }, { passive: true });
  transcript.addEventListener('contextmenu', (event) => {
    const segment = event.target.closest('[data-segment-id]');
    const meetingId = breviaClient.state.meeting?.id;
    if (!segment || segment.classList.contains('partial') || !meetingId) return;
    event.preventDefault();
    openSegmentContextMenu(meetingId, segment.dataset.segmentId, event.clientX, event.clientY);
  });
  const renderLiveEvent = (payload, partial) => {
    const shouldFollow = followLiveTranscript || isAtLiveBottom();
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
    if (participant && payload.speaker_name && participant.name !== payload.speaker_name) {
      participant.name = payload.speaker_name;
      renderLivePanel();
    }
    const previous = liveSegments.get(payload.segment_id);
    const translation = payload.translation || previous?.querySelector('.translation')?.textContent;
    const entry = {
      time: formatMeetingTime(payload.start_ms),
      startSeconds: payload.start_ms / 1000,
      endSeconds: payload.end_ms / 1000,
      speaker: { id: payload.speaker, segmentId: payload.segment_id, name: payload.speaker_name || participant?.name || `${t('说话人')} ${participant?.id || payload.speaker.split('-').pop()}` },
      text: payload.text,
      translation,
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
    currentTranslation.hidden = !translation || !translationAllowed;
    currentTranslation.textContent = translation || '';
    const template = document.createElement('template');
    template.innerHTML = renderTranscriptSegment(entry);
    const element = template.content.firstElementChild;
    if (previous) previous.replaceWith(element);
    else {
      const next = [...transcript.querySelectorAll('.segment')].find((item) => Number(item.dataset.start) > payload.start_ms / 1000);
      transcript.insertBefore(element, next || null);
    }
    liveSegments.set(payload.segment_id, element);
    while (liveSegments.size > maxLiveSegments) {
      const [segmentId, stale] = liveSegments.entries().next().value;
      liveSegments.delete(segmentId);
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
    const config = summaryModels[activeSummaryModel];
    if (!targetLanguage || !config) return;
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
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      format: config.format,
      key_reference: config.keyReference,
      consent: true,
    });
  }
  window.brevia.on('transcript.refined', (payload) => renderLiveEvent(payload, false));
  window.brevia.on('transcript.final', async (payload) => {
    renderLiveEvent(payload, false);
    if (!translationAllowed) return;
    try {
      await generateSegmentTranslation(payload, breviaClient.state.meeting.target_language);
    } catch (error) { showToast(`${t('翻译失败')}: ${error.message}`); }
  });
  window.brevia.on('transcript.discarded', ({ segment_id }) => {
    liveSegments.get(segment_id)?.remove();
    liveSegments.delete(segment_id);
  });
  window.brevia.on('translation.ready', (payload) => {
    const element = liveSegments.get(payload.segment_id);
    if (!element) return;
    const shouldFollow = followLiveTranscript || isAtLiveBottom();
    let line = element.querySelector('.translation');
    if (!line) { line = document.createElement('p'); line.className = 'translation'; element.querySelector('.segment-copy').append(line); }
    line.textContent = payload.translation;
    if (payload.segment_id === latestLiveSegmentId) {
      const currentTranslation = document.querySelector('#live-caption-translation');
      currentTranslation.textContent = payload.translation;
      currentTranslation.hidden = !translationAllowed;
    }
    if (shouldFollow) scrollLiveToLatest(element);
  });
  window.brevia.on('refinement.started', ({ meeting_id, total }) => showRefinementProgress(0, total, refinementMeetingTitle, meeting_id));
  window.brevia.on('refinement.progress', ({ completed, total }) => showRefinementProgress(completed, total));
  window.brevia.on('refinement.ready', async ({ meeting }) => {
    syncBackendMeeting(meeting);
    const refineButton = document.querySelector('.detail-refine [data-flow-select-toggle]');
    refineButton.disabled = false;
    refineButton.innerHTML = `${t('精修')} <span>⌄</span>`;
    showRefinementComplete();
    if (meeting.id === breviaClient.state.selectedMeetingId) applyBackendDetail(meeting);
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
    scheduleRequiredModelsCardRender();
  });
  window.brevia.on('model.status', ({ model_id, status, error }) => {
    const index = modelIds.indexOf(model_id);
    if (index < 0) return;
    if (status === 'ready') {
      const [, name, detail, intro, icon] = (modalCopy[locale] || modalCopy.en).models.items[index];
      installModel({ icon, name, detail, intro });
      modelDownloads.delete(model_id);
      requiredModelIds.delete(model_id);
      if (onboardingModelIds.includes(model_id) && window.BreviaOnboarding.modelReady(model_id)) showOfflineTranscriptionReady();
      window.brevia.models.list().then((models) => {
        modelCatalog = models;
        renderRefinedModelChoices();
        const model = models.find((item) => item.id === model_id);
        if (model?.path) modelPaths.set(model_id, model.path);
        if (activeModal === 'models') renderModal('models');
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
    renderRequiredModelsCard();
  });
  window.brevia.on('worker.warning', ({ message: warning }) => showToast(warning));
  window.brevia.on('worker.error', ({ message: error }) => showToast(error));
  window.brevia.on('task.status', ({ task, meeting_id, status }) => {
    const card = [...taskCards.querySelectorAll('.processing-card')].find((item) => item.dataset.task === task && item.dataset.meetingId === meeting_id);
    setTaskCardPaused(card, status === 'paused');
  });
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
    downloadRequiredModels(models);
  });
  window.brevia.on('separation.started', ({ meeting_id, completed, total }) => showSeparationProgress(completed, total, meeting_id));
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
      if (result) showToast(t(result.recording_included ? '压缩包已导出' : '未找到录音，已导出逐字稿压缩包'));
    } catch (error) { showToast(error.message); }
  });
}
