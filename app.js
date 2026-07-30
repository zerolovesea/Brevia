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
Object.assign(catalog.zh.labels, { '播放此段': '播放' });
Object.assign(catalog.en.labels, { '播放此段': 'Play' });
Object.assign(catalog.es.labels, { '播放此段': 'Reproducir' });
Object.assign(catalog.zh.labels, {
  '开始录制': '开始录制', '继续会议': '继续会议', '我 · 麦克风': '我 · 麦克风', '计算设备': '计算设备', '预计空间': '预计空间', '识别模型': '识别模型', '已应用术语': '已应用术语', '12 个词条': '12 个词条', '可用': '可用', '已完成精修': '已完成精修', '中文确认文本 · 1.2 GB': '中文确认文本 · 1.2 GB', '英文与其他语言 · 466 MB': '英文与其他语言 · 466 MB', '+ 9': '+ 9', '纪要模型': '纪要模型', '配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。': '配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。', '管理纪要模型': '管理纪要模型', '总结提示词': '总结提示词', '编辑提示词': '编辑提示词', '配置 JSON': '配置 JSON', '当前启用的纪要模型配置。': '当前启用的纪要模型配置。'
});
Object.assign(catalog.en.labels, {
  '开始录制': 'Start recording', '继续会议': 'Resume meeting', '我 · 麦克风': 'Me · Microphone', '计算设备': 'Compute device', '预计空间': 'Estimated storage', '识别模型': 'Recognition model', '已应用术语': 'Applied terms', '12 个词条': '12 terms', '可用': 'Available', '已完成精修': 'Refinement complete', '中文确认文本 · 1.2 GB': 'Chinese final transcription · 1.2 GB', '英文与其他语言 · 466 MB': 'English and other languages · 466 MB', '+ 9': '+ 9', '纪要模型': 'Summary models', '配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。': 'Configure APIs for meeting notes. All configuration stays local and is never uploaded.', '管理纪要模型': 'Manage summary models', '总结提示词': 'Summary prompt', '编辑提示词': 'Edit prompt', '配置 JSON': 'Configuration JSON', '当前启用的纪要模型配置。': 'The active summary model configuration.'
});
Object.assign(catalog.es.labels, {
  '开始录制': 'Iniciar grabación', '继续会议': 'Reanudar reunión', '我 · 麦克风': 'Yo · Micrófono', '计算设备': 'Dispositivo de cálculo', '预计空间': 'Almacenamiento estimado', '识别模型': 'Modelo de reconocimiento', '已应用术语': 'Términos aplicados', '12 个词条': '12 términos', '可用': 'Disponible', '已完成精修': 'Refinamiento completo', '中文确认文本 · 1.2 GB': 'Transcripción final en chino · 1.2 GB', '英文与其他语言 · 466 MB': 'Inglés y otros idiomas · 466 MB', '+ 9': '+ 9', '纪要模型': 'Modelos de resumen', '配置用于生成会议纪要的 API。所有配置信息仅保存在本地，不会上传。': 'Configura API para las notas de reunión. Toda la configuración es local y no se carga.', '管理纪要模型': 'Gestionar modelos de resumen', '总结提示词': 'Prompt de resumen', '编辑提示词': 'Editar prompt', '配置 JSON': 'JSON de configuración', '当前启用的纪要模型配置。': 'La configuración activa del modelo de resumen.'
});
let locale = localStorage.getItem('brevia-language') || 'zh';
let theme = localStorage.getItem('brevia-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let activeView = 'home';
let toastTimer;
let switchingLanguage = false;
let meetingActive = false;
const translatedNodes = [];
/** Resolves a display label for the active locale. @param {string} key Chinese source label. @returns {string} Localized label or the original key. */
const t = (key) => catalog[locale].labels[key] || key;
/** Resolves a transient message for the active locale. @param {string} key Message identifier. @returns {string} Localized message. */
const message = (key) => catalog[locale].messages[key];
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
let updateAvailable = true;
/** Keeps the update notice above the mini meeting when both are visible. @returns {void} */
function syncFloatingNotices() { updateNotice.style.bottom = miniMeeting.hidden ? '' : `${miniMeeting.offsetHeight + 24}px`; }
/** Renders the floating update notice from current locale and availability state. @returns {void} */
function renderUpdateNotice() { const copy = updateLabels[locale]; updateNoticeText.textContent = copy.available; updateNoticeButton.textContent = copy.floating; updateNotice.hidden = !updateAvailable; requestAnimationFrame(syncFloatingNotices); }
/** Renders the settings-page update action from current locale and availability state. @returns {void} */
function renderUpdateButton() { const copy = updateLabels[locale]; updateTitle.textContent = copy.title; updateDescription.textContent = updateAvailable ? copy.available : copy.description; updateButton.textContent = updateAvailable ? copy.update : copy.action; updateButton.disabled = false; }
const modalCopy = {
  zh: {
    models: { title: '管理模型库', intro: '选择需要的模型。下载完成后可在会议前加载。', items: [['SenseVoice Small', '中文确认文本 · 1.2 GB'], ['Whisper Small', '英文与其他语言 · 466 MB'], ['Qwen3-ASR Large', '中文高精度转写 · 2.8 GB'], ['Whisper Turbo', '英文与多语言转写 · 1.6 GB']] },
    terms: { title: '管理术语库', intro: '术语用于会议准备、搜索和纪要。仅支持的模型会在转写中使用它们。', items: [['Brevia', '产品名称'], ['向量数据库', '技术术语'], ['CAM++', '说话人模型']], add: '添加术语', edit: '编辑', save: '保存', cancel: '取消', remove: '删除', placeholder: '输入术语或短语' },
    storage: { title: '本地存储', intro: '所有会议资料均保存在此设备。', items: [['会议与录音', '8.4 GB'], ['模型文件', '1.7 GB'], ['导出文件', '240 MB']] }, close: '关闭', download: '下载' },
  en: {
    models: { title: 'Manage model library', intro: 'Select the models you need. They can be loaded before a meeting.', items: [['SenseVoice Small', 'Chinese final transcription · 1.2 GB'], ['Whisper Small', 'English and other languages · 466 MB'], ['Qwen3-ASR Large', 'High-accuracy Chinese transcription · 2.8 GB'], ['Whisper Turbo', 'English and multilingual transcription · 1.6 GB']] },
    terms: { title: 'Manage terms', intro: 'Terms support meeting preparation, search, and notes. Only supported models use them in transcription.', items: [['Brevia', 'Product name'], ['Vector database', 'Technical term'], ['CAM++', 'Speaker model']], add: 'Add term', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete', placeholder: 'Enter a term or phrase' },
    storage: { title: 'Local storage', intro: 'All meeting data stays on this device.', items: [['Meetings and recordings', '8.4 GB'], ['Model files', '1.7 GB'], ['Exports', '240 MB']] }, close: 'Close', download: 'Download' },
  es: {
    models: { title: 'Gestionar biblioteca de modelos', intro: 'Selecciona los modelos necesarios. Se pueden cargar antes de una reunión.', items: [['SenseVoice Small', 'Transcripción final en chino · 1.2 GB'], ['Whisper Small', 'Inglés y otros idiomas · 466 MB'], ['Qwen3-ASR Large', 'Transcripción precisa en chino · 2.8 GB'], ['Whisper Turbo', 'Transcripción en inglés y multilingüe · 1.6 GB']] },
    terms: { title: 'Gestionar términos', intro: 'Los términos sirven para preparar reuniones, buscar y crear notas. Solo los modelos compatibles los usan al transcribir.', items: [['Brevia', 'Nombre del producto'], ['Base de datos vectorial', 'Término técnico'], ['CAM++', 'Modelo de hablantes']], add: 'Añadir término', edit: 'Editar', save: 'Guardar', cancel: 'Cancelar', remove: 'Eliminar', placeholder: 'Escribe un término o frase' },
    storage: { title: 'Almacenamiento local', intro: 'Todos los datos de reuniones permanecen en este dispositivo.', items: [['Reuniones y grabaciones', '8.4 GB'], ['Archivos de modelos', '1.7 GB'], ['Exportaciones', '240 MB']] }, close: 'Cerrar', download: 'Descargar' }
};
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
const defaultSummaryModels = [{ name: '配置-1', provider: 'OpenAI', apiKey: '', endpoint: 'https://api.openai.com/v1', format: 'openai', model: 'gpt-4.1-mini' }];
const savedSummaryConfig = JSON.parse(localStorage.getItem('brevia-summary-config') || 'null');
let summaryModels = savedSummaryConfig?.models?.length ? savedSummaryConfig.models : defaultSummaryModels;
let activeSummaryModel = savedSummaryConfig?.active ?? 0;
let editingSummaryModel = 0;
let configSequence = savedSummaryConfig?.sequence || summaryModels.length;
summaryModels.forEach((item, index) => { if (!item.name) item.name = `配置-${index + 1}`; });
let draftSummaryName = '';
let summaryPrompt = savedSummaryConfig?.prompt || '基于逐字稿提炼结论、决定、待办和风险；保留可追溯的来源。';
/** Allocates the next local summary-model configuration name. @returns {string} New configuration name. */
function nextConfigName() { configSequence += 1; return `配置-${configSequence}`; }
/** Saves summary-model settings to this browser only. @returns {void} */
function persistSummaryConfig() { localStorage.setItem('brevia-summary-config', JSON.stringify({ models: summaryModels, active: activeSummaryModel, prompt: summaryPrompt, sequence: configSequence })); }
const settingsModal = document.createElement('div');
settingsModal.className = 'modal-backdrop';
settingsModal.hidden = true;
settingsModal.innerHTML = '<section class="modal-panel" role="dialog" aria-modal="true"><header class="modal-head"><div class="modal-title"><h2></h2><p></p></div><button class="modal-close" type="button" aria-label="Close">×</button></header><div class="modal-body"></div></section>';
document.body.append(settingsModal);
let activeModal;
let termEntries = modalCopy.zh.terms.items.map(([name, detail]) => ({ name, detail }));
let editingTermIndex = null;
const prepareForm = document.querySelector('#meeting-form');
/** Rebuilds meeting-language selectors while preserving their submitted values. @returns {void} */
function renderPrepareSelects() {
  const values = Object.fromEntries(new FormData(prepareForm));
  prepareForm.querySelector('.form-grid').innerHTML = `<label>${t('会议语言')}${flowSelect('meeting-language', values['meeting-language'] || '中文', [['中文', t('中文')], ['English', 'English'], ['自动检测', t('自动检测')]])}</label><label>${t('译文目标')}${flowSelect('translation-target', values['translation-target'] || '英语', [['英语', t('英语')], ['不需要翻译', t('不需要翻译')], ['中文', t('中文')]])}</label>`;
}
renderPrepareSelects();
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
  const copy = summaryModelCopy[locale];
  const current = summaryModels[editingSummaryModel] || { name: draftSummaryName || `配置-${configSequence + 1}`, provider: 'OpenAI', apiKey: '', endpoint: '', format: '', model: '' };
  const apiFormat = current.format === 'claude' ? 'claude' : 'openai';
  const configuredControl = summaryModels.length ? `<div class="configured-models"><label class="config-select-field">${copy.configured}${flowSelect('active-summary-model', String(activeSummaryModel), summaryModels.map((item, index) => [String(index), `${item.name} · ${item.provider} · ${item.model}${index === activeSummaryModel ? ` · ${copy.active}` : ''}`]), true)}</label></div>` : '';
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-body').innerHTML = `<form class="summary-model-form"><div class="config-fields"><label>${copy.name}<input name="name" value="${escapeHtml(current.name)}" maxlength="64" required /></label><label class="config-select-field">${copy.provider}${flowSelect('provider', current.provider, summaryProviders.map((provider) => [provider, provider === 'Ollama' ? copy.ollama : provider]))}</label><label>${copy.key}<input name="apiKey" type="password" value="${escapeHtml(current.apiKey)}" required /></label><label>${copy.endpoint}<input name="endpoint" value="${escapeHtml(current.endpoint)}" required /></label><label class="config-select-field">${copy.format}${flowSelect('format', apiFormat, [['openai', copy.openAIFormat], ['claude', copy.claudeFormat]])}</label><label>${copy.model}<input name="model" value="${escapeHtml(current.model)}" required /></label></div><div class="modal-form-actions"><button class="modal-action" type="submit">${copy.save}</button><button class="secondary" data-new-summary-model type="button">${copy.add}</button>${editingSummaryModel >= 0 ? `<button class="model-delete" data-delete-summary-model type="button">${copy.remove}</button>` : ''}</div></form>${configuredControl}<section class="modal-subsection"><h3>${copy.promptTitle}</h3><p>${copy.promptIntro}</p><form class="prompt-form"><textarea name="prompt" rows="9" required>${escapeHtml(summaryPrompt)}</textarea><button class="modal-action" type="submit">${copy.save}</button></form></section><section class="modal-subsection"><h3>${copy.jsonTitle}</h3><p>${copy.jsonIntro}</p><pre class="config-json">${escapeHtml(renderConfigPreview())}</pre></section>`;
}
/** Renders one settings modal. @param {'models'|'terms'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
function renderModal(kind) {
  if (kind === 'summary-model') { renderSummaryModelModal(); return; }
  const copy = modalCopy[locale][kind];
  const items = kind === 'terms' ? termEntries.map(({ name, detail }) => [name, detail]) : copy.items;
  settingsModal.querySelector('h2').textContent = copy.title;
  settingsModal.querySelector('.modal-title p').textContent = copy.intro;
  settingsModal.querySelector('.modal-close').setAttribute('aria-label', modalCopy[locale].close);
  settingsModal.querySelector('.modal-body').innerHTML = `<div class="modal-list">${items.map(([name, detail], index) => {
    const termEditing = kind === 'terms' && editingTermIndex === index;
    const label = termEditing ? `<input class="term-edit-input" data-edit-term-input="${index}" value="${escapeHtml(name)}" maxlength="64" />` : `<b>${escapeHtml(name)}</b>`;
    const actions = kind === 'models' ? `<button class="modal-action${isModelInstalled(name) ? ' modal-danger' : ''}" ${isModelInstalled(name) ? `data-delete-model="${index}"` : `data-download-model="${index}"`} type="button">${isModelInstalled(name) ? modelLabels[locale].remove : modelLabels[locale].download}</button>` : kind === 'terms' ? `<span class="term-actions">${termEditing ? `<button class="modal-action" data-save-term="${index}" type="button">${copy.save}</button><button class="modal-action" data-cancel-term type="button">${copy.cancel}</button>` : `<button class="modal-action" data-edit-term="${index}" type="button">${copy.edit}</button><button class="modal-action" data-remove-term="${index}" type="button">${copy.remove}</button>`}</span>` : '';
    return `<div><span>${label}<small>${escapeHtml(detail)}</small></span>${actions}</div>`;
  }).join('')}</div>${kind === 'terms' ? `<form class="term-form"><input name="term" required maxlength="64" placeholder="${copy.placeholder}" /><button type="submit">${copy.add}</button></form>` : ''}`;
}
/** Opens and focuses a settings modal. @param {'models'|'terms'|'storage'|'summary-model'} kind Requested modal. @returns {void} */
function openModal(kind) { activeModal = kind; renderModal(kind); settingsModal.querySelector('.modal-close').setAttribute('aria-label', modalCopy[locale].close); settingsModal.hidden = false; document.body.classList.add('modal-open'); settingsModal.querySelector('.modal-close').focus(); }
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
  button.textContent = modelLabels[locale].remove;
  button.addEventListener('click', () => { deleteInstalledModel(row.querySelector('b').textContent); if (activeModal === 'models') renderModal('models'); });
  row.append(button);
}
/** Synchronizes installed-model actions after a locale or model-list change. @returns {void} */
function renderModelControls() { modelAction.textContent = modelLabels[locale].manage; modelCard.querySelectorAll('.model-row').forEach((row) => { attachModelDelete(row); row.querySelector('.model-delete').textContent = modelLabels[locale].remove; }); }
/** Inserts a newly downloaded model into the installed-model card. @param {string} name Model name. @param {string} detail Displayed model detail. @returns {void} */
function installModel(name, detail) {
  if (isModelInstalled(name)) return;
  const template = document.createElement('template');
  template.innerHTML = renderModelRow({ icon: '', name, detail });
  const row = template.content.firstElementChild;
  modelCard.insertBefore(row, modelAction);
  installedModelNames.add(name);
  attachModelDelete(row);
}
renderModelControls();
renderConfigPreview();
settingsModal.addEventListener('click', (event) => {
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
  if (download) { const [name, detail] = modalCopy[locale].models.items[Number(download.dataset.downloadModel)]; download.disabled = true; download.textContent = modelLabels[locale].downloading; window.setTimeout(() => { installModel(name, detail); renderModal('models'); }, 700); return; }
  const deleteModel = event.target.closest('[data-delete-model]');
  if (deleteModel) { const [name] = modalCopy[locale].models.items[Number(deleteModel.dataset.deleteModel)]; deleteInstalledModel(name); renderModal('models'); return; }
  const edit = event.target.closest('[data-edit-term]');
  if (edit) { editingTermIndex = Number(edit.dataset.editTerm); renderModal('terms'); settingsModal.querySelector('[data-edit-term-input]').focus(); return; }
  if (event.target.closest('[data-cancel-term]')) { editingTermIndex = null; renderModal('terms'); return; }
  const save = event.target.closest('[data-save-term]');
  if (save) { const index = Number(save.dataset.saveTerm); const input = settingsModal.querySelector(`[data-edit-term-input="${index}"]`); const name = input.value.trim(); if (name && !termEntries.some((entry, entryIndex) => entryIndex !== index && entry.name.toLowerCase() === name.toLowerCase())) termEntries[index].name = name; editingTermIndex = null; renderModal('terms'); return; }
  const remove = event.target.closest('[data-remove-term]');
  if (remove) { termEntries.splice(Number(remove.dataset.removeTerm), 1); editingTermIndex = null; renderModal('terms'); }
});
settingsModal.addEventListener('submit', (event) => {
  if (event.target.matches('.summary-model-form')) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
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
  termEntries.push({ name: term, detail: locale === 'zh' ? '自定义术语' : locale === 'es' ? 'Término personalizado' : 'Custom term' });
  renderModal('terms');
});
const slogans = {
  zh: ['每一场对话，都留有依据。', '让重要讨论，不再散落。', '从声音开始，留下清晰结论。', '记录发生的事，推进接下来的事。', '把会议留在掌控之中。'],
  en: ['Every conversation leaves a traceable record.', 'Keep important discussions in one place.', 'Start with sound. End with clear decisions.', 'Record what happened. Move the work forward.', 'Keep every meeting within reach.'],
  es: ['Cada conversación conserva un registro verificable.', 'Mantén las conversaciones importantes en un solo lugar.', 'Empieza con la voz. Termina con decisiones claras.', 'Registra lo que ocurrió. Haz avanzar el trabajo.', 'Mantén cada reunión bajo control.']
};
const homeSlogan = document.querySelector('#home-slogan');
let sloganIndex = Math.floor(Math.random() * slogans.zh.length);
/** Updates the rotating library slogan. @param {boolean} animate Whether to play the transition. @returns {void} */
function renderSlogan(animate = false) {
  const update = () => {
    homeSlogan.textContent = slogans[locale][sloganIndex];
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
  themeToggle.title = themeLabels[locale][dark ? 'light' : 'dark'];
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
    renderMeetingDetail();
    crumb.textContent = catalog[locale].views[activeView];
    renderSlogan(false);
    renderUpdateButton();
    renderUpdateNotice();
    renderModelControls();
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
/** Switches between top-level app views. @param {'home'|'prepare'|'live'|'detail'|'settings'} name Target view. @returns {void} */
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
window.setInterval(() => { sloganIndex = (sloganIndex + 1) % slogans[locale].length; renderSlogan(true); }, 30000);
updateButton.addEventListener('click', () => {
  updateButton.disabled = true;
  updateButton.textContent = updateLabels[locale].checking;
  window.setTimeout(() => { updateAvailable = true; updateDescription.textContent = updateLabels[locale].available; updateButton.textContent = updateLabels[locale].update; updateButton.disabled = false; renderUpdateNotice(); }, 700);
});
updateNoticeButton.addEventListener('click', () => { updateNoticeButton.textContent = updateLabels[locale].updating; updateNoticeButton.disabled = true; window.setTimeout(() => { updateAvailable = false; updateNotice.hidden = true; updateDescription.textContent = updateLabels[locale].current; updateButton.textContent = updateLabels[locale].current; }, 900); });
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
document.addEventListener('click', (event) => { const target = event.target.closest('[data-view]'); if (!target) return; if (activeView === 'live' && meetingActive && target.dataset.view !== 'live') minimizeMeeting(); showView(target.dataset.view); });
document.querySelector('#meeting-form').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#live-name').textContent = document.querySelector('#meeting-title').value || t('会议名称'); meetingActive = true; miniMeeting.hidden = true; syncFloatingNotices(); showView('live'); startTimer(); });
let seconds = 0;
let timer;
/** Starts the visible recording timer, replacing any prior timer. @returns {void} */
function startTimer() { clearInterval(timer); timer = setInterval(() => { seconds += 1; const value = new Date(seconds * 1000).toISOString().slice(11, 19); document.querySelector('#timer').textContent = value; miniTimer.textContent = value; }, 1000); }
document.querySelector('#pause').addEventListener('click', (event) => { const paused = event.currentTarget.dataset.paused === 'true'; event.currentTarget.dataset.paused = String(!paused); event.currentTarget.textContent = paused ? `Ⅱ ${t('暂停')}` : `▶ ${t('继续')}`; if (paused) startTimer(); else clearInterval(timer); });
document.querySelector('#end-meeting').addEventListener('click', () => { clearInterval(timer); meetingActive = false; miniMeeting.hidden = true; syncFloatingNotices(); showView('detail'); showToast(message('recordingSaved')); });
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
    nextLabel.addEventListener('dblclick', () => editSpeakerName(nextLabel));
    input.replaceWith(nextLabel);
    document.querySelectorAll(`[data-speaker="${speaker}"]`).forEach((node) => { node.textContent = name; });
  };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); if (event.key === 'Escape') { input.value = label.textContent; input.blur(); } });
  label.replaceWith(input);
  input.focus();
  input.select();
}
document.querySelectorAll('.person b[data-speaker]').forEach((label) => label.addEventListener('dblclick', () => editSpeakerName(label)));
document.querySelector('#translation-toggle').addEventListener('click', (event) => { const enabled = event.currentTarget.dataset.enabled !== 'false'; event.currentTarget.dataset.enabled = String(!enabled); event.currentTarget.textContent = t(enabled ? '译文: 关' : '译文: 开'); document.querySelectorAll('.translation').forEach((line) => line.hidden = enabled); });
document.querySelector('#latest').addEventListener('click', () => document.querySelector('#transcript-scroll').scrollTo({ top: 9999, behavior: 'smooth' }));
document.querySelector('#meeting-search').addEventListener('input', (event) => { const query = event.currentTarget.value.trim().toLowerCase(); document.querySelectorAll('.meeting-row').forEach((row) => row.hidden = !row.textContent.toLowerCase().includes(query)); });
const progress = document.querySelector('#progress');
const playerTime = document.querySelector('#player-time');
/** Formats the audio progress control as an mm:ss display. @returns {void} */
const renderPlayerTime = () => { const value = Number(progress.value); playerTime.textContent = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
progress.addEventListener('input', renderPlayerTime);
document.addEventListener('click', (event) => { const button = event.target.closest('.jump'); if (button) { progress.value = button.dataset.time; renderPlayerTime(); showToast(message('located')); } });
document.querySelector('#play').addEventListener('click', (event) => { const playing = event.currentTarget.textContent === '❚❚'; event.currentTarget.textContent = playing ? '▶' : '❚❚'; showToast(message(playing ? 'paused' : 'playing')); });
themeToggle.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
