const views = [...document.querySelectorAll('.view')];
const crumb = document.querySelector('#crumb');
const toast = document.querySelector('#toast');
const languageToggle = document.querySelector('#language-toggle');
const languageOptions = document.querySelector('#language-options');
const themeToggle = document.querySelector('#theme-toggle');
const miniMeeting = document.querySelector('#mini-meeting');
const miniTitle = document.querySelector('#mini-title');
const miniTimer = document.querySelector('#mini-timer');
const catalog = {
  zh: {
    views: { home: '所有会议', prepare: '准备录制', live: '正在录制', detail: '会议详情', settings: '设置' },
    labels: { '所有会议': '所有会议', '最近删除': '最近删除', '设置': '设置', '开始会议': '开始会议', '会议库': '会议库', '准备录制': '准备录制', '实时字幕': '实时字幕', '会议详情': '会议详情', '本地优先': '本地优先', '音频与文本仅保存在此设备': '音频与文本仅保存在此设备', '每一场对话，都留有依据。': '每一场对话，都留有依据。', '录音、逐字稿和纪要只在你明确操作时导出或发送。': '录音、逐字稿和纪要只在你明确操作时导出或发送。', '搜索会议、逐字稿或标签': '搜索会议、逐字稿或标签', '所有分类': '所有分类', '最近 30 天': '最近 30 天', '返回会议库': '返回会议库', '开始一场会议': '开始一场会议', '先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。': '先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。', '录制音频': '录制音频', '会议名称': '会议名称', '会议语言': '会议语言', '译文目标': '译文目标', '我的麦克风': '我的麦克风', '系统音频': '系统音频', '输入良好': '输入良好', '已就绪': '已就绪', '当前模型': '当前模型', '中文确认文本与说话人分离': '中文确认文本与说话人分离', '管理模型与术语': '管理模型与术语', '正在录制': '正在录制', '暂停': '暂停', '继续': '继续', '结束会议': '结束会议', '保持在当下': '保持在当下', '译文: 开': '译文: 开', '译文: 关': '译文: 关', '回到最新': '回到最新', '参与者': '参与者', '本场状态': '本场状态', '我': '我', '麦克风': '麦克风', '系统音频': '系统音频', '打开会议面板': '打开会议面板', '导出': '导出', '逐字稿': '逐字稿', '摘要': '摘要', '纪要与待办': '纪要与待办', '播放此段': '播放此段', '生成完整会议纪要': '生成完整会议纪要', '模型与本地数据': '模型与本地数据', '已安装模型': '已安装模型', '下载更多模型': '下载更多模型', '术语库': '术语库', '12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。': '12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。', '管理术语库': '管理术语库', '存储与隐私': '存储与隐私', '会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。': '会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。', '查看本地存储': '查看本地存储', '中文': '中文', '英语': '英语', '不需要翻译': '不需要翻译', '自动检测': '自动检测', '切换语言': '切换语言', '切换主题': '切换主题', 'Brevia': 'Brevia', '向量数据库': '向量数据库', 'CAM++': 'CAM++' },
    messages: { recordingSaved: '录音已安全保存，正在整理逐字稿', located: '已定位到对应音频片段', playing: '正在播放混音轨道', paused: '播放已暂停' }
  },
  en: {
    views: { home: 'All meetings', prepare: 'Prepare meeting', live: 'Recording', detail: 'Meeting details', settings: 'Settings' },
    labels: { '所有会议': 'All meetings', '最近删除': 'Recently deleted', '设置': 'Settings', '开始会议': 'Start meeting', '会议库': 'Meeting library', '准备录制': 'Prepare recording', '实时字幕': 'Live transcript', '会议详情': 'Meeting details', '本地优先': 'Local first', '音频与文本仅保存在此设备': 'Audio and text stay on this device', '每一场对话，都留有依据。': 'Every conversation leaves a traceable record.', '录音、逐字稿和纪要只在你明确操作时导出或发送。': 'Audio, transcripts, and notes are exported or shared only when you choose to.', '搜索会议、逐字稿或标签': 'Search meetings, transcripts, or tags', '所有分类': 'All categories', '最近 30 天': 'Last 30 days', '返回会议库': 'Back to library', '开始一场会议': 'Start a meeting', '先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。': 'Confirm language and audio input first. The model loads before recording and keeps working without a network connection.', '录制音频': 'Audio capture', '会议名称': 'Meeting name', '会议语言': 'Meeting language', '译文目标': 'Translation target', '我的麦克风': 'My microphone', '系统音频': 'System audio', '输入良好': 'Input ready', '已就绪': 'Ready', '当前模型': 'Current model', '中文确认文本与说话人分离': 'Chinese final transcription and speaker separation', '管理模型与术语': 'Manage models and terms', '正在录制': 'Recording', '暂停': 'Pause', '继续': 'Resume', '结束会议': 'End meeting', '保持在当下': 'Stay with the conversation', '译文: 开': 'Translation: On', '译文: 关': 'Translation: Off', '回到最新': 'Back to latest', '参与者': 'Participants', '本场状态': 'Session status', '我': 'Me', '麦克风': 'Microphone', '系统音频': 'System audio', '打开会议面板': 'Open meeting panel', '导出': 'Export', '逐字稿': 'Transcript', '摘要': 'Summary', '纪要与待办': 'Notes and actions', '播放此段': 'Play this segment', '生成完整会议纪要': 'Generate meeting notes', '模型与本地数据': 'Models and local data', '已安装模型': 'Installed models', '下载更多模型': 'Download more models', '术语库': 'Term library', '12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。': '12 terms are available for meeting preparation, search, and notes. Only supported models use them during transcription.', '管理术语库': 'Manage terms', '存储与隐私': 'Storage and privacy', '会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。': 'Meeting data stays on this Mac. External LLMs require explicit confirmation before receiving a transcript.', '查看本地存储': 'View local storage', '中文': 'Chinese', '英语': 'English', '不需要翻译': 'No translation', '自动检测': 'Auto detect', '切换语言': 'Switch language', '切换主题': 'Switch theme', 'Brevia': 'Brevia', '向量数据库': 'Vector database', 'CAM++': 'CAM++' },
    messages: { recordingSaved: 'Recording saved safely. Preparing transcript.', located: 'Moved to the linked audio segment', playing: 'Playing mixed track', paused: 'Playback paused' }
  },
  es: {
    views: { home: 'Todas las reuniones', prepare: 'Preparar reunión', live: 'Grabando', detail: 'Detalles de la reunión', settings: 'Configuración' },
    labels: { '所有会议': 'Todas las reuniones', '最近删除': 'Eliminadas recientemente', '设置': 'Configuración', '开始会议': 'Iniciar reunión', '会议库': 'Biblioteca de reuniones', '准备录制': 'Preparar grabación', '实时字幕': 'Transcripción en vivo', '会议详情': 'Detalles de la reunión', '本地优先': 'Primero local', '音频与文本仅保存在此设备': 'El audio y el texto permanecen en este dispositivo', '每一场对话，都留有依据。': 'Cada conversación conserva un registro verificable.', '录音、逐字稿和纪要只在你明确操作时导出或发送。': 'El audio, las transcripciones y las notas se exportan o comparten solo cuando lo eliges.', '搜索会议、逐字稿或标签': 'Buscar reuniones, transcripciones o etiquetas', '所有分类': 'Todas las categorías', '最近 30 天': 'Últimos 30 días', '返回会议库': 'Volver a la biblioteca', '开始一场会议': 'Iniciar una reunión', '先确认语言与音频输入。模型会在开始前加载，录制过程不会因网络状态中断。': 'Primero confirma el idioma y la entrada de audio. El modelo carga antes de grabar y sigue funcionando sin conexión.', '录制音频': 'Captura de audio', '会议名称': 'Nombre de la reunión', '会议语言': 'Idioma de la reunión', '译文目标': 'Idioma de traducción', '我的麦克风': 'Mi micrófono', '系统音频': 'Audio del sistema', '输入良好': 'Entrada lista', '已就绪': 'Listo', '当前模型': 'Modelo actual', '中文确认文本与说话人分离': 'Transcripción final en chino y separación de hablantes', '管理模型与术语': 'Gestionar modelos y términos', '正在录制': 'Grabando', '暂停': 'Pausar', '继续': 'Reanudar', '结束会议': 'Finalizar reunión', '保持在当下': 'Sigue la conversación', '译文: 开': 'Traducción: Sí', '译文: 关': 'Traducción: No', '回到最新': 'Volver a lo último', '参与者': 'Participantes', '本场状态': 'Estado de la sesión', '我': 'Yo', '麦克风': 'Micrófono', '系统音频': 'Audio del sistema', '打开会议面板': 'Abrir panel de reunión', '导出': 'Exportar', '逐字稿': 'Transcripción', '摘要': 'Resumen', '纪要与待办': 'Notas y tareas', '播放此段': 'Reproducir este segmento', '生成完整会议纪要': 'Generar notas de reunión', '模型与本地数据': 'Modelos y datos locales', '已安装模型': 'Modelos instalados', '下载更多模型': 'Descargar más modelos', '术语库': 'Biblioteca de términos', '12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。': 'Hay 12 términos para preparar reuniones, buscar y crear notas. Solo los modelos compatibles los usan durante la transcripción.', '管理术语库': 'Gestionar términos', '存储与隐私': 'Almacenamiento y privacidad', '会议资料保存在此 Mac。外部 LLM 需要在发送逐字稿前明确确认。': 'Los datos de la reunión permanecen en este Mac. Los LLM externos requieren confirmación antes de recibir una transcripción.', '查看本地存储': 'Ver almacenamiento local', '中文': 'Chino', '英语': 'Inglés', '不需要翻译': 'Sin traducción', '自动检测': 'Detección automática', '切换语言': 'Cambiar idioma', '切换主题': 'Cambiar tema', 'Brevia': 'Brevia', '向量数据库': 'Base de datos vectorial', 'CAM++': 'CAM++' },
    messages: { recordingSaved: 'Grabación guardada. Preparando la transcripción.', located: 'Se abrió el segmento de audio vinculado', playing: 'Reproduciendo pista mezclada', paused: 'Reproducción pausada' }
  }
};
Object.assign(catalog.zh.labels, {
  '开始录制': '开始录制', '继续会议': '继续会议', '我 · 麦克风': '我 · 麦克风', '计算设备': '计算设备', '预计空间': '预计空间', '识别模型': '识别模型', '已应用术语': '已应用术语', '12 个词条': '12 个词条', '可用': '可用', '已完成精修': '已完成精修', '中文确认文本 · 1.2 GB': '中文确认文本 · 1.2 GB', '英文与其他语言 · 466 MB': '英文与其他语言 · 466 MB', '+ 9': '+ 9'
});
Object.assign(catalog.en.labels, {
  '开始录制': 'Start recording', '继续会议': 'Resume meeting', '我 · 麦克风': 'Me · Microphone', '计算设备': 'Compute device', '预计空间': 'Estimated storage', '识别模型': 'Recognition model', '已应用术语': 'Applied terms', '12 个词条': '12 terms', '可用': 'Available', '已完成精修': 'Refinement complete', '中文确认文本 · 1.2 GB': 'Chinese final transcription · 1.2 GB', '英文与其他语言 · 466 MB': 'English and other languages · 466 MB', '+ 9': '+ 9'
});
Object.assign(catalog.es.labels, {
  '开始录制': 'Iniciar grabación', '继续会议': 'Reanudar reunión', '我 · 麦克风': 'Yo · Micrófono', '计算设备': 'Dispositivo de cálculo', '预计空间': 'Almacenamiento estimado', '识别模型': 'Modelo de reconocimiento', '已应用术语': 'Términos aplicados', '12 个词条': '12 términos', '可用': 'Disponible', '已完成精修': 'Refinamiento completo', '中文确认文本 · 1.2 GB': 'Transcripción final en chino · 1.2 GB', '英文与其他语言 · 466 MB': 'Inglés y otros idiomas · 466 MB', '+ 9': '+ 9'
});
let locale = localStorage.getItem('brevia-language') || 'zh';
let theme = localStorage.getItem('brevia-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let activeView = 'home';
let toastTimer;
let switchingLanguage = false;
let meetingActive = false;
const translatedNodes = [];
const t = (key) => catalog[locale].labels[key] || key;
const message = (key) => catalog[locale].messages[key];
const themeLabels = {
  zh: { light: '切换至浅色主题', dark: '切换至深色主题' },
  en: { light: 'Switch to light theme', dark: 'Switch to dark theme' },
  es: { light: 'Cambiar al tema claro', dark: 'Cambiar al tema oscuro' }
};

function applyTheme(nextTheme) {
  theme = nextTheme;
  localStorage.setItem('brevia-theme', theme);
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeToggle.textContent = dark ? '☾' : '◐';
  themeToggle.title = themeLabels[locale][dark ? 'light' : 'dark'];
  themeToggle.setAttribute('aria-label', themeToggle.title);
}

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
    crumb.textContent = catalog[locale].views[activeView];
    if (animate) nodes.forEach((element) => { element.classList.remove('locale-out'); element.classList.add('locale-in'); window.setTimeout(() => element.classList.remove('locale-in'), 520); });
  };
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { updateText(); return; }
  switchingLanguage = true;
  nodes.forEach((element) => element.classList.add('locale-out'));
  window.setTimeout(() => { updateText(); switchingLanguage = false; }, 380);
}
const showToast = (content) => { toast.textContent = content; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400); };
const showView = (name) => {
  if (name === activeView) return;
  const current = document.querySelector(`#${activeView}-view`);
  const next = document.querySelector(`#${name}-view`);
  if (current.classList.contains('leaving')) return;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
  current.classList.add('leaving');
  window.setTimeout(() => {
    current.classList.remove('active', 'leaving');
    next.classList.add('active');
    activeView = name;
    crumb.textContent = catalog[locale].views[name];
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, duration);
};
collectTranslations();
applyLanguage(locale);
applyTheme(theme);
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
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeLanguageMenu(); languageToggle.focus(); } });
function minimizeMeeting() { miniTitle.textContent = document.querySelector('#live-name').textContent; miniTimer.textContent = document.querySelector('#timer').textContent; miniMeeting.hidden = false; }
document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (!target) return; if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting(); showView(target.dataset.view); });
document.querySelector('#meeting-form').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#live-name').textContent = document.querySelector('#meeting-title').value || t('会议名称'); meetingActive = true; miniMeeting.hidden = true; showView('live'); startTimer(); });
let seconds = 0;
let timer;
function startTimer() { clearInterval(timer); timer = setInterval(() => { seconds += 1; const value = new Date(seconds * 1000).toISOString().slice(11, 19); document.querySelector('#timer').textContent = value; miniTimer.textContent = value; }, 1000); }
document.querySelector('#pause').addEventListener('click', (event) => { const paused = event.currentTarget.dataset.paused === 'true'; event.currentTarget.dataset.paused = String(!paused); event.currentTarget.textContent = paused ? `Ⅱ ${t('暂停')}` : `▶ ${t('继续')}`; if (paused) startTimer(); else clearInterval(timer); });
document.querySelector('#end-meeting').addEventListener('click', () => { clearInterval(timer); meetingActive = false; miniMeeting.hidden = true; showView('detail'); showToast(message('recordingSaved')); });
miniMeeting.addEventListener('click', () => { miniMeeting.hidden = true; showView('live'); });
document.querySelector('#translation-toggle').addEventListener('click', (event) => { const enabled = event.currentTarget.dataset.enabled !== 'false'; event.currentTarget.dataset.enabled = String(!enabled); event.currentTarget.textContent = t(enabled ? '译文: 关' : '译文: 开'); document.querySelectorAll('.translation').forEach((line) => line.hidden = enabled); });
document.querySelector('#latest').addEventListener('click', () => document.querySelector('#transcript-scroll').scrollTo({ top: 9999, behavior: 'smooth' }));
document.querySelector('#meeting-search').addEventListener('input', (event) => { const query = event.currentTarget.value.trim().toLowerCase(); document.querySelectorAll('.meeting-row').forEach((row) => row.hidden = !row.textContent.toLowerCase().includes(query)); });
const progress = document.querySelector('#progress');
const playerTime = document.querySelector('#player-time');
const renderPlayerTime = () => { const value = Number(progress.value); playerTime.textContent = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
progress.addEventListener('input', renderPlayerTime);
document.querySelectorAll('.jump').forEach((button) => button.addEventListener('click', () => { progress.value = button.dataset.time; renderPlayerTime(); showToast(message('located')); }));
document.querySelector('#play').addEventListener('click', (event) => { const playing = event.currentTarget.textContent === '❚❚'; event.currentTarget.textContent = playing ? '▶' : '❚❚'; showToast(message(playing ? 'paused' : 'playing')); });
themeToggle.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
