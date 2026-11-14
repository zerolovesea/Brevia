const {
  app,
  NativeWindow,
  clipboard,
  dialog,
  ipcMain,
  globalShortcut,
  Menu,
  nativeImage,
  nativeAudio,
  Tray,
  powerMonitor,
  protocol,
  printPDF,
  screen,
  ShareMenu,
  shell,
} = require('./platform.cjs');
const { execFile, spawn } = require('node:child_process');
const {
  appendFile,
  copyFile,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  statfs,
  writeFile,
} = require('node:fs/promises');
const { constants, existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const {
  markdownTarget,
  syncMarkdown,
  serializeMarkdown,
  sendGroupSummary,
} = require('./markdown-workflow');
const { uploadShare } = require('./cloud-share.cjs');
const { MobileServer } = require('./mobile-server');
const { AgentService } = require('./agent-service.cjs');
const { createRecordingController } = require('./agent-recording.cjs');
const { DesktopController } = require('./desktop-controller');
const { selectedMeetingApp } = require('./meeting-app.cjs');
const {
  createLineBuffer,
  audioFileURL,
  isNewerVersion,
  migrateLegacyData,
  requiredModelsFrom,
  workerError,
  workerLogLevel,
  writeAtomicFile,
} = require('./main-logic');
const {
  applyPendingMove,
  currentDirectory,
  recordingsDirectory,
  setFirstRunDirectories,
} = require('./model-location');

// 跨宿主 IPC 使用 JSON 传递；使用统一的可序列化错误结果。
function handleIpc(channel, callback) {
  ipcMain.handle(channel, async (...args) => {
    try {
      const event = args[0];
      const frame = event?.senderFrame;
      const mainPage = pathToFileURL(path.join(packagedRoot, 'frontend', 'index.html')).href;
      const captionPage = pathToFileURL(
        path.join(packagedRoot, 'frontend', 'floating-caption.html'),
      ).href;
      const capsulePage = pathToFileURL(
        path.join(packagedRoot, 'frontend', 'recording-capsule.html'),
      ).href;
      const page = frame?.url?.split(/[?#]/)[0];
      if (
        !frame ||
        frame !== event.sender.mainFrame ||
        !(
          page === mainPage ||
          (page ===
            pathToFileURL(path.join(packagedRoot, 'frontend', 'meeting-prompt.html')).href &&
            channel === 'desktop.meeting-prompt') ||
          (page === capsulePage &&
            [
              'desktop.state',
              'desktop.action',
              'desktop.expand',
              'desktop.move',
              'meeting.note-image.save',
            ].includes(channel)) ||
          (page === captionPage &&
            [
              'floating-caption.close',
              'floating-caption.move',
              'floating-caption.set-always-on-top',
            ].includes(channel))
        )
      )
        throw new Error('Untrusted IPC sender');
      return await callback(...args);
    } catch (error) {
      writeLog('ERROR', `${channel}: ${logText(error)}`);
      const code = String(error.code || '').startsWith('error.')
        ? error.code
        : /Worker request timed out/.test(error.message)
          ? 'error.timeout'
          : 'error.operation_failed';
      return { __brevia_error: { code, detail: error.message } };
    }
  });
}

const root = path.join(__dirname, '..');
const packagedRoot = app.isPackaged ? process.resourcesPath : root;
const { configuredSummaryProvider } = require(
  path.join(packagedRoot, 'frontend', 'summary-providers.js'),
);
const { translate } = require(path.join(packagedRoot, 'frontend', 'i18n-data.js'));
const { defaultRefinedModelId } = require(
  path.join(packagedRoot, 'frontend', 'model-selection.js'),
);
const mainText = (key) => translate(key, app.getLocale().split('-')[0]);
const desktop = new DesktopController({
  platform: {
    app,
    NativeWindow,
    Menu,
    Tray,
    nativeImage,
    screen,
    globalShortcut,
    nativeAudio,
    supportsMeetingProbe: process.platform !== 'linux',
  },
  root: packagedRoot,
  dataDir: () => dataDir(),
  text: (key, locale) => translate(key, locale || app.getLocale().split('-')[0]),
  reportError: (error) => reportMainError(error),
});
const startupAnimationMs = 1700;
const startupDataWaitMs = 2200;
// 单行 JSON 消息上限：长会议逐字稿（含逐词时间戳）可能达到数十 MB；
// 8 MB 会在长时间录制/导入的会议请求时截断消息，64 MB 留足余量。
const workerLineLimit = 64 * 1024 * 1024;
// 兼容 UTF-8 笔记与 JSON 转义后的最大文本，并保留命令元数据空间。
const maximumCommandBytes = 32 * 1024 * 1024;
const dataTaskCommands = new Set([
  'agent.run',
  'meeting.start',
  'meeting.resume',
  'meeting.import',
  'meeting.refine',
  'summary.generate',
  'translation.generate',
  'mobile.translate',
  'meeting.export',
  'meeting.bundle',
  'meeting.bundle-files',
  'speaker-profile.enroll',
  'speaker-profile.verify',
  'speaker.rename',
  'segment.speaker',
  'segment.speaker-profile-sample',
  'models.download',
]);
const workerRequestTimeouts = new Map([
  ['agent.run', 600000],
  ['meeting.audio', 15000],
  ['meeting.get', 15000],
  ['models.download', 15000],
  ['models.pause', 15000],
  ['models.cancel', 15000],
  ['task.pause', 15000],
  ['task.resume', 15000],
  ['task.cancel', 15000],
  ['app.initialize', 180000],
  ['meeting.start', 180000],
  ['meeting.resume', 180000],
  ['meeting.reconfigure', 180000],
  ['summary.generate', 900000],
  // 精修和纪要收到自己的进度事件时续期；长任务仍有有限的无响应期限。
  ...[
    'meeting.refine',
    'translation.generate',
    'mobile.translate',
    'meeting.import',
    'meeting.stop',
    'meeting.pause',
    'meeting.export',
    'meeting.bundle',
    'meeting.bundle-files',
    'speaker-profile.enroll',
    'speaker-profile.verify',
    'speaker.rename',
    'segment.speaker',
    'segment.speaker-profile-sample',
  ].map((type) => [type, 600000]),
]);
const resetOnboarding = process.argv.includes('--reset-onboarding');
const dataDir = () => process.env.BREVIA_DATA_DIR || path.join(app.getPath('home'), 'brevia');
const modelsDir = () => currentDirectory(dataDir(), process.env.BREVIA_MODELS_DIR);
const recordingsDir = () => recordingsDirectory(dataDir(), process.env.BREVIA_MEETINGS_DIR);
const noteImagesDir = (meetingId) => path.join(recordingsDir(), meetingId, 'notes');
// Windows 路径大小写不敏感，而 path.resolve 不会归一化盘符大小写（d:\ vs D:\），
// 直接用 startsWith 比较前缀会误判。比较前统一折叠大小写。
const foldPath = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
const isWithin = (root, target) => {
  const base = foldPath(path.resolve(root));
  return foldPath(target).startsWith(`${base}${path.sep}`);
};
const legacyDataDir = () => app.getPath('userData');
const logsDir = () => path.join(dataDir(), 'logs');
const logFile = () => path.join(logsDir(), 'brevia.log');
const logText = (value) =>
  value instanceof Error
    ? value.stack || value.message
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
const writeLog = (level, value) => {
  const line = `${new Date().toISOString()} [${level}] ${logText(value).trim()}\n`;
  void mkdir(logsDir(), { recursive: true })
    .then(() => appendFile(logFile(), line, 'utf8'))
    .catch((error) => console.error('Log write failed', error));
};
const stoppingProcessGroups = new Set();
const stopProcess = (child, graceMs = 5000) => {
  if (!child?.pid) return;
  // 已退出的进程不要再按 pid 终止：pid 可能已被系统复用。
  if (child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
    return;
  }
  // 杀掉整个进程组：worker 会派生原生推理子进程，只 SIGTERM 父进程会留下孤儿进程。
  stoppingProcessGroups.add(child.pid);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      /* 进程可能已退出。 */
    }
  }
  // worker 忽略 SIGTERM 时会残留孤儿进程：给一个宽限期后升级为 SIGKILL。
  const escalation = setTimeout(() => {
    if (!stoppingProcessGroups.delete(child.pid)) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      if (child.exitCode === null && !child.signalCode) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已退出。 */
        }
      }
    }
  }, graceMs);
  escalation.unref?.();
};
let storageMigrationInProgress = false;
const migrateDataDir = async () => {
  if (process.env.BREVIA_DATA_DIR) return;
  // 先完成旧根目录中已经确认的迁移，避免遗留清理标记指向即将搬走的源。
  if (
    existsSync(path.join(legacyDataDir(), 'brevia.db')) &&
    !existsSync(path.join(dataDir(), 'brevia.db'))
  )
    await applyPendingMove(legacyDataDir());
  await migrateLegacyData(legacyDataDir(), dataDir());
};
const command = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const workerResponse = z.discriminatedUnion('ok', [
  z.object({ id: z.string().min(1), ok: z.literal(true), result: z.unknown() }).strict(),
  // 结构化错误字段：后端把 ModelNotInstalled 序列化成 error_code/error_models，主进程据此
  // 决定「先下载再重试」，不再正则解析 error 文本（见 main-logic.js 的 workerError）。
  z
    .object({
      id: z.string().min(1).nullable(),
      ok: z.literal(false),
      error: z.string(),
      error_code: z.string().max(64).optional(),
      error_models: z.array(z.string().min(1).max(128)).max(8).optional(),
    })
    .strict(),
]);
const workerEvent = z
  .object({
    type: z.enum([
      'agent.progress',
      'app.maintenance',
      'meeting.imported',
      'meeting.reconfigured',
      'meeting.recovered',
      'meeting.interrupted',
      'meeting.started',
      'meeting.stopped',
      'model.progress',
      'model.status',
      'refinement.cancelled',
      'refinement.progress',
      'refinement.ready',
      'refinement.started',
      'speaker-profile.deleted',
      'speaker-profile.updated',
      'glossary.failed',
      'glossary.updated',
      'summary.finished',
      'summary.progress',
      'summary.ready',
      'summary.started',
      'task.status',
      'transcript.corrected',
      'transcript.draft',
      'transcript.final',
      'transcript.partial',
      'transcript.refined',
      'transcript.settled',
      'translation.ready',
      'worker.error',
      'worker.warning',
      'ai-note.suggestion',
      'ai-note.evidence',
      'ai-note.analyzing',
    ]),
    schema_version: z.literal(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
const workerMessage = z.union([workerResponse, workerEvent]);
const summaryTemplate = z.enum(['general', 'weekly', 'interview', 'review']);
const meetingStart = z.object({
  summary_template: summaryTemplate.optional(),
  title: z.string().trim().min(1).max(120),
  // 语言由后端按空值兜底成 auto；这里不接受 ''/null，避免两端对同一个语义有两种判断。
  language: z.string().min(2).max(16).optional(),
  target_language: z.string().min(2).max(16).nullable().optional(),
  refined_model_id: z.string().min(1),
  speaker_segmentation_model_id: z.string().min(1).optional(),
  vad_model_id: z.string().min(1).optional(),
  num_speakers: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1)
    .optional(),
  audio_tracks: z
    .array(z.enum(['mic', 'system']))
    .min(1)
    .max(2)
    .optional(),
  workspace_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
});
const audio = z.object({
  meeting_id: z.string().uuid(),
  track: z.enum(['mic', 'system']),
  pcm: z.string().max(4 * 1024 * 1024),
  sample_rate: z.literal(16000),
  start_ms: z.number().nonnegative(),
  flush: z.boolean().optional(),
});
const id = z.object({ meeting_id: z.string().uuid() });
const noteImage = id.extend({
  mime_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  bytes: z.instanceof(ArrayBuffer),
});
const meetingUpdates = z
  .object({
    title: z.string().trim().min(1).max(120),
    tags: z.array(z.string().max(32)).max(20),
    archived_at: z.string().max(64).nullable(),
    meeting_date: z.iso.date().nullable(),
    accepted_suggestion_ids: z.array(z.string().uuid()).max(1000),
    refined_model_id: z.string().min(1).max(128),
    notes: z.string().max(5 * 1024 * 1024),
  })
  .partial();
const meetingReconfigure = id.extend({
  language: z.string().min(2).max(16).optional(),
  target_language: z.string().min(2).max(16).nullable().optional(),
  refined_model_id: z.string().min(1).max(128).optional(),
});
// 纪要与笔记共用供应商列表；只有 built-in 在本地运行，因此其余都必须带请求地址。
const summaryProviderIds = [
  'built-in',
  'claude',
  'openai',
  'gemini',
  'deepseek',
  'qwen',
  'kimi',
  'glm',
  'mistral',
  'groq',
  'openrouter',
  'opencode-go',
  'custom-openai',
  'custom-claude',
];
const isBuiltInProvider = (provider) => provider.toLowerCase() === 'built-in';
const requiresEndpoint = (provider) => !isBuiltInProvider(provider);
const summaryProviderEntry = z.object({
  model: z.string().trim().min(1).max(128),
  endpoint: z.string().url().optional(),
  keyReference: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .optional(),
  keyLength: z.number().int().positive().max(512).optional(),
});
const llmRequest = z
  .object({
    provider: z.string().trim().min(1),
    endpoint: z.string().url().optional(),
    model: z.string().trim().min(1),
    format: z.enum(['openai', 'claude']).optional(),
    key_reference: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .optional(),
  })
  .refine(({ provider, endpoint }) => !requiresEndpoint(provider) || Boolean(endpoint), {
    message: 'Endpoint is required for remote providers',
    path: ['endpoint'],
  });
// 单套生效配置，但每个供应商的模型/地址/密钥引用分别留存，切换供应商不会丢已填内容。
const summaryConfig = z.object({
  version: z.literal(2),
  enabled: z.boolean().default(true),
  provider: z.enum(summaryProviderIds),
  // partialRecord：只有用户配置过的供应商才出现在这里；z.record 在 zod 4 里要求键穷尽。
  providers: z.partialRecord(z.enum(summaryProviderIds), summaryProviderEntry),
});
// 实时 AI 辅助笔记：api_key 由 key_reference 在主进程解析。
const aiNoteStart = z
  .object({
    meeting_id: z.string().uuid(),
    provider: z.string().trim().min(1),
    endpoint: z.string().url().optional(),
    model: z.string().trim().min(1),
    format: z.enum(['openai', 'claude']).optional(),
    key_reference: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .optional(),
    proactivity: z.enum(['quiet', 'assist', 'auto']).default('assist'),
    language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']).default('zh'),
    prompt: z.object({
      instructions: z.string().trim().min(1).max(4000),
      state_labels: z.array(z.string().trim().min(1).max(64)).length(5),
    }),
  })
  .refine(({ provider, endpoint }) => !requiresEndpoint(provider) || Boolean(endpoint), {
    message: 'Endpoint is required for remote providers',
    path: ['endpoint'],
  });
const aiNoteTyping = z.object({
  meeting_id: z.string().uuid(),
  typing: z.boolean(),
  notes: z.string().max(20000).optional(),
});
const aiNoteRequest = z.object({
  meeting_id: z.string().uuid(),
  notes: z.string().max(20000).optional(),
});
const aiNoteDismiss = z.object({
  meeting_id: z.string().uuid(),
  text: z.string().max(400).optional(),
});
const aiNoteReconfigure = z.object({
  meeting_id: z.string().uuid(),
  min_interval_seconds: z.number().min(1).max(86400).nullable().optional(),
});

async function meetingFilesRoot(meetingId) {
  z.string().uuid().parse(meetingId);
  const expected = path.join(await realpath(recordingsDir()), meetingId);
  if ((await realpath(expected)) !== expected) throw new Error('Invalid meeting directory');
  return expected;
}

async function readNoteImage(meetingId, filename) {
  if (!/^[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/i.test(filename))
    throw new Error('Invalid note image');
  const root = await meetingFilesRoot(meetingId);
  const source = fileURLToPath(
    await audioFileURL(path.join(noteImagesDir(meetingId), filename), [root]),
  );
  if (source !== path.join(root, 'notes', filename) || (await stat(source)).size > 10 * 1024 * 1024)
    throw new Error('Invalid note image');
  const extension = path.extname(filename).slice(1).toLowerCase();
  return {
    image: await readFile(source),
    type: extension === 'jpg' ? 'image/jpeg' : 'image/' + extension,
  };
}

async function saveNoteImage({ meeting_id, mime_type, bytes }) {
  const image = Buffer.from(bytes);
  if (!image.length || image.length > 10 * 1024 * 1024)
    throw new Error('Image must be 10 MB or smaller');
  const extension = mime_type === 'image/jpeg' ? 'jpg' : mime_type.slice('image/'.length);
  const filename = `${randomUUID()}.${extension}`;
  const root = await meetingFilesRoot(meeting_id);
  await mkdir(noteImagesDir(meeting_id), { recursive: true });
  const directory = fileURLToPath(await audioFileURL(noteImagesDir(meeting_id), [root]));
  if (directory !== path.join(root, 'notes')) throw new Error('Invalid note image directory');
  await writeFile(path.join(directory, filename), image, { mode: 0o600, flag: 'wx' });
  return { url: `brevia-note://${meeting_id}/${filename}` };
}

function registerNoteImageProtocol() {
  protocol.handle('brevia-note', async (request) => {
    try {
      const url = new URL(request.url);
      const meetingId = url.hostname;
      const filename = decodeURIComponent(url.pathname.slice(1));
      const { image, type } = await readNoteImage(meetingId, filename);
      return new Response(image, { headers: { 'content-type': type } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

class WorkerClient {
  constructor({ refinement = false } = {}) {
    this.pending = new Map();
    this.outbox = [];
    this.writing = null;
    this.sequence = 0;
    this.restarts = 0;
    this.active = null;
    this.starting = null;
    this.refinement = refinement;
    this.recycleRequested = false;
    this.hasSpawned = false;
  }

  start() {
    if (this.process?.stdin && !this.process.stdin.destroyed && this.process.exitCode === null)
      return Promise.resolve();
    if (this.stopping) return this.stopping.then(() => this.start());
    if (this.starting) return this.starting;
    const recoverInterrupted = !this.refinement && !this.hasSpawned;
    const workerExecutable = process.execPath;
    const workerArgs = [path.join(packagedRoot, 'control', 'worker.cjs')];
    const child = spawn(workerExecutable, workerArgs, {
      cwd: packagedRoot,
      env: {
        ...process.env,
        BREVIA_DATA_DIR: dataDir(),
        BREVIA_MODELS_DIR: modelsDir(),
        BREVIA_MEETINGS_DIR: recordingsDir(),
        BREVIA_BUNDLED_MODELS_DIR: path.join(packagedRoot, 'backend', 'bundled-models'),
        BREVIA_RECOVER_INTERRUPTED: recoverInterrupted ? '1' : '0',
        ...{
          BREVIA_MACOS_NATIVE: '1',
          BREVIA_RESOURCES: packagedRoot,
          BREVIA_NATIVE_ENGINES: path.join(packagedRoot, 'engines'),
        },
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.process = child;
    this.writing = null;
    this.starting = new Promise((resolve, reject) => {
      child.once('spawn', () => {
        this.hasSpawned = true;
        resolve();
      });
      child.once('error', reject);
    }).finally(() => {
      this.starting = null;
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      // 旧进程在退出前可能仍在吐缓冲数据；重启后若不过滤来源，这些数据会被当成新进程
      // 的输出转发给渲染层，甚至误杀新进程的 pending 请求（fail() 会拒绝所有 pending）。
      if (child !== this.process) return;
      buffer += chunk;
      if (buffer.length > workerLineLimit) {
        const error = new Error('Worker output is too large');
        this.fail(error);
        stopProcess(child);
        return;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.filter(Boolean).forEach((line) => {
        try {
          this.receive(workerMessage.parse(JSON.parse(line)));
        } catch (error) {
          writeLog('ERROR', error);
          this.fail(error);
          this.sendEvent('worker:log', { message: `Invalid worker output: ${error.message}` });
        }
      });
    });
    child.stderr.setEncoding('utf8');
    const stderrBuffer = createLineBuffer((line) => {
      if (line.trim()) writeLog(workerLogLevel(line), line);
    });
    child.stderr.on('data', (message) => {
      if (child !== this.process) return;
      stderrBuffer.push(message);
      this.sendEvent('worker:log', { message });
    });
    child.stderr.on('end', () => {
      if (child === this.process) stderrBuffer.end();
    });
    child.on('error', (error) => {
      if (child === this.process) this.fail(error);
    });
    child.stdin.on('error', (error) => {
      if (child === this.process) this.fail(error);
    });
    child.on('exit', (code, signal) => this.closed(code, signal, child));
    return this.starting;
  }

  receive(message) {
    if (message.id === null) {
      writeLog('WARNING', message.error);
      return;
    }
    if (
      message.type === 'worker.error' ||
      (message.type === 'model.status' && message.payload.status === 'failed')
    )
      writeLog('ERROR', message.payload);
    if (message.type === 'worker.warning') writeLog('WARNING', message.payload);
    if (message.type === 'summary.progress') mobileServer?.updateSummaryProgress(message.payload);
    if (message.type === 'app.maintenance' && mobileServer) {
      void mobileServer
        .serial(() => mobileServer.refreshDeleted())
        .catch((error) => writeLog('ERROR', error.message));
    }
    if (['worker.warning', 'worker.error'].includes(message.type)) {
      const session = mobileServer?.sessions.get(message.payload?.meeting_id);
      if (session)
        session.processingWarning = message.payload.message || '电脑转写暂不可用，请在电脑检查模型';
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.ok ? pending.resolve(message.result) : pending.reject(workerError(message));
      this.recycleIfIdle();
      return;
    }
    if (message.type) {
      this.pending.forEach((pending, requestId) => {
        if (pending.meetingId !== message.payload.meeting_id) return;
        if (message.type === 'task.status' && message.payload.task === pending.type) {
          pending.paused = message.payload.status === 'paused';
          this.armTimeout(requestId);
        }
        if (
          (pending.type === 'agent.run' &&
            /^(agent|refinement|translation)\./.test(message.type)) ||
          (pending.type === 'mobile.translate' && message.type === 'translation.ready') ||
          (pending.type === 'meeting.refine' && message.type.startsWith('refinement.')) ||
          (pending.type === 'summary.generate' && message.type.startsWith('summary.')) ||
          (['meeting.stop', 'meeting.pause'].includes(pending.type) &&
            message.type.startsWith('transcript.'))
        )
          this.armTimeout(requestId);
      });
      this.sendEvent(message.type, message.payload);
    }
  }

  armTimeout(requestId) {
    const pending = this.pending.get(requestId);
    clearTimeout(pending.timer);
    if (pending.paused) return;
    pending.timer = setTimeout(
      () => {
        if (!this.pending.delete(requestId)) return;
        this.outbox = this.outbox.filter((entry) => entry.requestId !== requestId);
        pending.reject(new Error(`Worker request timed out: ${pending.type}`));
        this.recycleRequested = true;
        this.recycleIfIdle();
      },
      workerRequestTimeouts.get(pending.type) ?? 60000,
    );
  }

  writeNext() {
    if (this.writing || !this.outbox.length) return;
    const entry = this.outbox.shift();
    const child = this.process;
    this.writing = entry;
    try {
      // 一次只写一条，等待流的写入回调后再取下一条，让管道本身施加背压。
      child.stdin.write(entry.line, (error) => {
        if (this.writing !== entry) return;
        this.writing = null;
        if (error) this.fail(error);
        else this.writeNext();
      });
    } catch (error) {
      this.fail(error);
    }
  }

  async request(type, payload = {}, duringMigration = false) {
    if (storageMigrationInProgress && !duringMigration)
      throw new Error('Folders are being moved. Please wait.');
    const value = command.parse({ type, payload });
    if (!this.process?.stdin || this.process.stdin.destroyed || this.process.exitCode !== null) {
      if (app.isQuitting) return Promise.reject(new Error('Worker is shutting down'));
      await this.start();
    }
    if (storageMigrationInProgress && !duringMigration)
      throw new Error('Folders are being moved. Please wait.');
    // 快捷键、桌面与手机请求共用此入口；检查放到异步启动之后，避免越过安装锁。
    if (app.preparingUpdate && type !== 'models.can-relocate')
      throw Object.assign(new Error('Update installation is in progress'), {
        code: 'error.tasks.running',
      });
    if (destructiveOperationInProgress && dataTaskCommands.has(type))
      throw Object.assign(new Error('Wait for data cleanup to finish'), {
        code: 'error.tasks.running',
      });
    const requestId = `cmd-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, type, meetingId: payload.meeting_id });
      this.armTimeout(requestId);
      try {
        const line = `${JSON.stringify({ id: requestId, ...value })}\n`;
        if (Buffer.byteLength(line, 'utf8') > maximumCommandBytes)
          throw Object.assign(new Error('Command is too large'), {
            code: 'error.command_too_large',
          });
        this.outbox.push({ requestId, line });
        this.writeNext();
      } catch (error) {
        clearTimeout(this.pending.get(requestId)?.timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  sendEvent(type, payload) {
    agentService?.progress(type, payload);
    NativeWindow.getAllWindows().forEach((window) =>
      window.webContents.send('brevia:event', { type, payload }),
    );
  }

  recycle() {
    this.recycleRequested = true;
    this.recycleIfIdle();
  }

  recycleIfIdle() {
    if (!this.recycleRequested || this.active || this.pending.size) return;
    const child = this.process;
    this.recycleRequested = false;
    if (!child) return;
    this.process = null;
    this.stopping = new Promise((resolve) => child.once('exit', resolve)).finally(() => {
      this.stopping = null;
    });
    stopProcess(child);
  }

  async stopForMigration() {
    const child = this.process;
    if (!child && !this.stopping) return;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Worker did not stop before folder migration')),
        10000,
      );
    });
    const stopped = child ? new Promise((resolve) => child.once('exit', resolve)) : this.stopping;
    if (child) {
      this.process = null;
      child.stdin.end();
    }
    try {
      await Promise.race([stopped, timeout]);
    } catch (error) {
      if (child && child.exitCode === null && !child.signalCode) this.process = child;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  fail(error) {
    this.pending.forEach(({ reject, timer, type, meetingId }) => {
      clearTimeout(timer);
      if (type === 'summary.generate')
        this.sendEvent('summary.finished', { meeting_id: meetingId });
      reject(error);
    });
    this.pending.clear();
    this.outbox = [];
    this.writing = null;
  }

  abandonActive(reason) {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.sendEvent('meeting.interrupted', { meeting_id: active.meeting_id, reason });
  }

  async closed(code, signal, child) {
    if (child !== this.process) return;
    this.process = null;
    if (app.isQuitting) return;
    const reason = signal || `code ${code}`;
    this.fail(new Error(`Worker exited with ${reason}`));
    if (this.refinement) {
      this.sendEvent('worker.error', { code: 'error.worker_exited', message: reason });
      const meetingId = this.active?.meeting_id;
      this.active = null;
      if (meetingId)
        void worker
          .request('meeting.refinement-recover', { meeting_id: meetingId })
          .then((meeting) =>
            this.sendEvent('refinement.cancelled', { meeting_id: meetingId, meeting }),
          )
          .catch((error) => writeLog('ERROR', `recover refinement: ${logText(error)}`));
      return;
    }
    if (this.restarts >= 1) {
      this.sendEvent('worker.error', { code: 'error.worker_exited', message: reason });
      this.abandonActive(reason);
      return;
    }
    this.restarts += 1;
    // 新进程必须重新初始化：清掉缓存的启动初始化，否则 initializeWorker() 会继续返回
    // 旧 worker 的过期结果，新进程也收不到 app.initialize（启动维护、模型引用收敛等）。
    startupInitialization = null;
    void this.start().catch((error) => writeLog('ERROR', `restart worker: ${logText(error)}`));
    void initializeWorker().catch((error) =>
      writeLog('ERROR', `re-initialize after restart: ${logText(error)}`),
    );
    if (this.active?.mobile) {
      const session = mobileServer?.sessions.get(this.active.meeting_id);
      if (session)
        session.processingWarning = '电脑处理进程曾重启，录音已保留；会后可在电脑精修补全转写';
      this.restarts = 0;
      return; // Durable mobile spool reopens and resumes through mobile.apply.
    }
    if (!this.active) {
      this.sendEvent('worker.error', { code: 'error.worker_exited', message: reason });
      return;
    }
    try {
      await this.request('meeting.resume', {
        meeting_id: this.active.meeting_id,
      });
      // 恢复成功说明这次重启是有效的：重置额度，让同一场会议里后续的崩溃仍能自愈，
      // 而不是一次崩溃就用光预算、之后只能放弃。
      this.restarts = 0;
      this.sendEvent('worker.recovered', { meeting_id: this.active.meeting_id });
    } catch (error) {
      this.sendEvent('worker.error', { code: 'error.worker_recovery', message: error.message });
      this.abandonActive(error.message);
    }
  }
}

const worker = new WorkerClient();
let mobileServer;
let agentService;
let mobileApproval;
// 精修会长时间占用 ONNX 线程；独立进程保证会议列表和详情查询不会被它饿死。
const refinementWorker = new WorkerClient({ refinement: true });
let startupInitialization;

function reportMainError(error, fatal = false) {
  const message = error instanceof Error ? error.message : String(error);
  writeLog('ERROR', error);
  console.error(error);
  try {
    worker.sendEvent('worker.error', { message, fatal });
  } catch {
    /* The app may not have a window yet. */
  }
}

process.on('unhandledRejection', (error) => reportMainError(error));
process.on('uncaughtException', (error) => reportMainError(error, true));
process.on('warning', (warning) => writeLog('WARNING', warning));

function initializeWorker(duringMigration = false) {
  if (!startupInitialization) {
    startupInitialization = worker.request('app.initialize', {}, duringMigration).catch((error) => {
      startupInitialization = null;
      throw error;
    });
  }
  return startupInitialization;
}

async function migrateStorageFolders(value) {
  if (storageMigrationInProgress) throw new Error('Folders are already being moved');
  if (
    [...(mobileServer?.sessions.values() || [])].some(
      (s) => !s.finished || ['queued', 'running'].includes(s.task?.state),
    )
  )
    throw new Error('请先完成手机录音与补传，再移动文件夹');
  if (
    (process.env.BREVIA_MODELS_DIR && value.models !== modelsDir()) ||
    (process.env.BREVIA_MEETINGS_DIR && value.recordings !== recordingsDir())
  ) {
    throw new Error('Folder is controlled by an environment variable');
  }
  storageMigrationInProgress = true;
  let stopped = false;
  try {
    if (
      worker.active ||
      refinementWorker.active ||
      worker.pending.size ||
      refinementWorker.pending.size ||
      worker.starting ||
      refinementWorker.starting ||
      !(await worker.request('models.can-relocate', {}, true))
    ) {
      throw new Error(
        'Finish the current meeting, refinement and model downloads before changing folders',
      );
    }
    const changed = await setFirstRunDirectories(dataDir(), value, {
      models: process.env.BREVIA_MODELS_DIR,
      recordings: process.env.BREVIA_MEETINGS_DIR,
    });
    if (!changed) return { changed: false };
    startupInitialization = null;
    await Promise.all([worker.stopForMigration(), refinementWorker.stopForMigration()]);
    stopped = true;
    await applyPendingMove(dataDir());
    const data = await initializeWorker(true);
    stopped = false;
    return { changed: true, data };
  } catch (error) {
    if (stopped) {
      startupInitialization = null;
      await initializeWorker(true).catch((restartError) =>
        writeLog('ERROR', `storage migration worker restart: ${logText(restartError)}`),
      );
    }
    throw error;
  } finally {
    storageMigrationInProgress = false;
  }
}

function handle(channel, schema, type = channel) {
  handleIpc(channel, async (_, payload = {}) => {
    return requestWithTaskSafety(type, schema.parse(payload));
  });
}

let destructiveOperationInProgress = false;
const destructiveCommands = new Set([
  'meeting.delete',
  'meeting.purge',
  'workspace.delete',
  'storage.clear',
  'storage.cleanup',
  'models.delete',
]);
async function requestWithTaskSafety(type, value) {
  if (!destructiveCommands.has(type)) return worker.request(type, value);
  if (destructiveOperationInProgress)
    throw Object.assign(new Error('Wait for background tasks to finish before clearing data'), {
      code: 'error.tasks.running',
    });
  destructiveOperationInProgress = true;
  try {
    const active = refinementWorker.active;
    // 包括仍在管道排队、尚未来得及在 Worker 注册的任务。
    if (
      ['storage.clear', 'storage.cleanup', 'models.delete'].includes(type) &&
      (active || [...worker.pending.values()].some((pending) => dataTaskCommands.has(pending.type)))
    ) {
      throw Object.assign(new Error('Wait for background tasks to finish before clearing data'), {
        code: 'error.tasks.running',
      });
    }
    const affected =
      active &&
      (value.meeting_id === active.meeting_id ||
        (type === 'workspace.delete' &&
          (await worker.request('meeting.get', { meeting_id: active.meeting_id })).workspace_id ===
            value.workspace_id));
    if (affected) {
      await refinementWorker.request('task.cancel', {
        task: 'meeting.refine',
        meeting_id: active.meeting_id,
      });
      await active.promise.catch(() => {});
      // 等待进程退出，确保超时或异常路径也不会在删除后继续写入。
      if (refinementWorker.stopping) await refinementWorker.stopping;
    }
    const perform = async () => {
      if (
        [...(mobileServer?.sessions.values() || [])].some(
          (s) => !s.finished || ['queued', 'running'].includes(s.task?.state),
        )
      )
        throw new Error('请先完成手机录音与补传，再清理数据');
      try {
        const removeMeeting =
          type === 'meeting.delete' ||
          type === 'meeting.purge' ||
          (type === 'storage.clear' && value.partition === 'meetings');
        const execute = () => worker.request(type, value);
        return await (removeMeeting ? serializeMarkdown(execute) : execute());
      } finally {
        await mobileServer?.refreshDeleted();
      }
    };
    return await (mobileServer ? mobileServer.serial(perform) : perform());
  } finally {
    destructiveOperationInProgress = false;
  }
}

// 判定"模型没装"一律读结构化字段（error_code / error_models），不再正则解析报错文本：
// 那种耦合会在改文案时静默破坏下载链路。映射逻辑在 main-logic.js 里单测覆盖。
const requiredModels = (error) => requiredModelsFrom(error);

function handleModelRequirement(channel, schema, type = channel) {
  handleIpc(channel, async (_, payload = {}) => {
    const value = schema.parse(payload);
    try {
      return await worker.request(type, value);
    } catch (error) {
      const models = requiredModels(error);
      if (!models) throw error;
      worker.sendEvent('model.required', { models, task: type, payload: value });
      return { model_required: models };
    }
  });
}

function handleRefinement(payload) {
  if (destructiveOperationInProgress || storageMigrationInProgress)
    return Promise.reject(
      Object.assign(new Error('Wait for data cleanup to finish before refining'), {
        code: 'error.tasks.running',
      }),
    );
  const value = id
    .extend({
      language: z.string().min(2).max(16).optional(),
      target_language: z.string().min(2).max(16).nullable().optional(),
      refined_model_id: z.string().min(1).optional(),
      num_speakers: z
        .number()
        .int()
        .refine((count) => count === -1 || count >= 1)
        .optional(),
      cluster_threshold: z.number().min(0).max(2).optional(),
    })
    .parse(payload);
  if (agentService?.jobs.get(value.meeting_id)?.status === 'running')
    return Promise.reject(
      Object.assign(new Error('This meeting is being processed by an Agent task'), {
        code: 'error.tasks.running',
      }),
    );
  if (refinementWorker.active) {
    if (refinementWorker.active.meeting_id === value.meeting_id)
      return refinementWorker.active.promise;
    return Promise.reject(
      Object.assign(new Error('Another meeting is already being refined'), {
        code: 'error.tasks.running',
      }),
    );
  }
  const active = { meeting_id: value.meeting_id, promise: null };
  refinementWorker.active = active;
  active.promise = refinementWorker
    .request('meeting.refine', value)
    .catch((error) => {
      const models = requiredModels(error);
      if (!models) throw error;
      worker.sendEvent('model.required', { models, task: 'meeting.refine', payload: value });
      return { model_required: models };
    })
    .finally(() => {
      if (refinementWorker.active !== active) return;
      refinementWorker.active = null;
      refinementWorker.recycle();
    });
  return active.promise;
}

function handleTaskControl(channel, schema) {
  handleIpc(channel, (_, payload) => {
    const value = schema.parse(payload);
    if (
      value.task === 'meeting.refine' &&
      agentService?.jobs.get(value.meeting_id)?.status === 'running'
    ) {
      // Agent 精修在主 Worker；取消要结束整个文件流程，不能继续导出半份结果。
      if (channel === 'task.cancel')
        return worker.request('agent.cancel', { meeting_id: value.meeting_id });
      return worker.request(channel, value);
    }
    return (value.task === 'meeting.refine' ? refinementWorker : worker).request(channel, value);
  });
}

async function saveProviderConfig(payload, schema, save) {
  const config = schema.parse(payload);
  if (payload.apiKey === undefined) {
    await save(config);
    return config;
  }
  const apiKey = z.string().min(1).max(512).parse(payload.apiKey);
  const reference = config.providers[config.provider]?.keyReference;
  if (config.provider === 'built-in' || !reference)
    throw new Error('Missing provider key reference');
  const directory = path.join(dataDir(), 'secrets');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${reference}.key`);
  // 其他功能和排队中的任务可能仍在使用旧密钥。
  const handle = await open(file, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(apiKey);
    } finally {
      await handle.close();
    }
    await save(config);
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  return config;
}

async function getSecret(reference) {
  if (!reference) return '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(reference)) return '';
  try {
    return await readFile(path.join(dataDir(), 'secrets', `${reference}.key`), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

const summaryConfigPath = () => path.join(dataDir(), 'summary-models.json');
async function readSummaryConfig() {
  let text;
  try {
    text = await readFile(summaryConfigPath(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  // 只认 version 2；旧结构、非法 JSON 一律当作未配置，由渲染层回落到内置供应商。
  // 用户无法手动修复这个文件，所以这里不抛错，下次保存时直接覆盖。
  try {
    const current = summaryConfig.safeParse(JSON.parse(text));
    return current.success ? current.data : null;
  } catch {
    return null;
  }
}
async function writeSummaryConfig(config) {
  await writeAtomicFile(
    summaryConfigPath(),
    `${JSON.stringify(summaryConfig.parse(config), null, 2)}\n`,
  );
}

const aiAssistConfig = z.object({
  version: z.literal(2),
  enabled: z.boolean(),
  proactivity: z.enum(['quiet', 'assist', 'auto']),
  provider: z.enum(summaryProviderIds),
  providers: z.partialRecord(z.enum(summaryProviderIds), summaryProviderEntry),
});
const aiAssistConfigV1 = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  proactivity: z.enum(['quiet', 'assist', 'auto']),
});
const aiAssistConfigPath = () => path.join(dataDir(), 'ai-assist.json');
async function readAiAssistConfig() {
  let text;
  try {
    text = await readFile(aiAssistConfigPath(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  // v1 只含开关/主动性，模型连接当时复用纪要配置。升级后保留开关与主动性，
  // 并把纪要的当前供应商一并带入，避免存量用户（尤其在线供应商）被静默切到
  // 未配置的内置模型而导致 AI 笔记悄悄失效。
  try {
    const value = JSON.parse(text);
    const current = aiAssistConfig.safeParse(value);
    if (current.success) return current.data;
    const legacy = aiAssistConfigV1.safeParse(value);
    if (!legacy.success) return null;
    const summary = await readSummaryConfig();
    return {
      ...legacy.data,
      version: 2,
      provider:
        summary && summaryProviderIds.includes(summary.provider) ? summary.provider : 'built-in',
      providers:
        summary?.providers && typeof summary.providers === 'object' ? summary.providers : {},
    };
  } catch {
    return null;
  }
}
async function writeAiAssistConfig(config) {
  await writeAtomicFile(
    aiAssistConfigPath(),
    `${JSON.stringify(aiAssistConfig.parse(config), null, 2)}\n`,
  );
}

async function copyExportIntoDirectory(source, directory) {
  const { name, ext, base } = path.parse(source);
  for (let n = 1; n <= 10000; n++) {
    const target = path.join(directory, n === 1 ? base : `${name}-${n}${ext}`);
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many exports with the same name');
}

async function prepareExport(value) {
  const exported = await worker.request('meeting.export', value);
  if (!exported.print_pdf) return exported;
  if (!exported.path.endsWith('.print.html')) throw new Error('Invalid print document');
  const pdfPath = exported.path.replace(/\.print\.html$/, '.pdf');
  try {
    await writeAtomicFile(pdfPath, await printPDF(exported.path));
    return { path: pdfPath, format: 'pdf' };
  } finally {
    await rm(exported.path, { force: true });
  }
}

// 把若干已准备好的导出文件打包成一个 zip，归档文件名按会议名加内容标签命名。
async function buildSelectedBundle(meetingId, prepared) {
  const base = path.parse(prepared[0].path).name; // 同一会议的所有导出共享会议名基础
  const safe = (value) =>
    String(value || '')
      .replace(/[<>:"/\\|?*]+/g, '-')
      .trim() || 'item';
  const files = prepared.map((entry) => ({
    path: entry.path,
    name: `${base}-${safe(entry.label)}${path.extname(entry.path)}`,
  }));
  return (
    await worker.request('meeting.bundle-files', { meeting_id: meetingId, name: base, files })
  ).path;
}

function registerIpc() {
  const agentSettings = () => {
    const cli =
      process.platform === 'darwin'
        ? path.join(process.resourcesPath, 'control/brevia')
        : process.platform === 'linux'
          ? '/usr/bin/brevia'
          : path.resolve(process.resourcesPath, '../brevia.cmd');
    const mcp =
      process.platform === 'darwin'
        ? { command: cli, args: ['mcp'] }
        : {
            command: process.execPath,
            args: [path.join(process.resourcesPath, 'control/brevia.cjs'), 'mcp'],
          };
    mcp.env = { ...mcp.env, BREVIA_DATA_DIR: dataDir() };
    return {
      ...agentService.getSettings(),
      cli_path: cli,
      skill_path: path.join(
        app.isPackaged ? process.resourcesPath : root,
        'skills/brevia/SKILL.md',
      ),
      mcp,
    };
  };
  handleIpc('agent.settings.get', agentSettings);
  handleIpc('agent.settings.save', async (_, payload) => {
    await agentService.saveSettings(payload);
    return agentSettings();
  });
  handleIpc('desktop.preferences.get', () => desktop.preferences);
  handleIpc('desktop.preferences.save', (_, payload) => {
    if (Object.hasOwn(payload, 'meetingApps'))
      throw new Error('Select a meeting application first');
    return desktop.save(payload);
  });
  handleIpc('desktop.meeting-app', async (event, payload) => {
    const { remove } = z
      .object({ remove: z.string().min(1).max(32767).optional() })
      .strict()
      .parse(payload);
    if (remove) return desktop.changeMeetingApp(null, remove);
    const mac = process.platform === 'darwin';
    const locale = desktop.state?.locale || app.getLocale().split('-')[0];
    const title = translate('添加会议应用', locale);
    const selection = await dialog.showOpenDialog(NativeWindow.fromWebContents(event.sender), {
      title,
      properties: ['openFile'],
      defaultPath: mac ? '/Applications' : undefined,
      applicationLocale: locale,
      filters: [{ name: title, extensions: [mac ? 'app' : 'exe'] }],
    });
    if (selection.canceled || !selection.filePaths.length) return desktop.preferences;
    const selected = await selectedMeetingApp(selection.filePaths[0], selection.localizedAppName);
    return desktop.changeMeetingApp(selected);
  });
  handleIpc('desktop.shortcuts.edit', (_, payload) => {
    desktop.editShortcuts(z.object({ editing: z.boolean() }).strict().parse(payload).editing);
    return true;
  });
  handleIpc('desktop.capture.remember', (_, payload) => {
    const { mode } = z
      .object({ mode: z.enum(['mic', 'system', 'both', 'phone']) })
      .strict()
      .parse(payload);
    return desktop.save({ lastCaptureMode: mode });
  });
  handleIpc('desktop.show', () => {
    desktop.showMain();
    return true;
  });
  handleIpc('desktop.publish', (_, payload) => {
    desktop.update(payload);
    return true;
  });
  handleIpc('desktop.level', (_, payload) => {
    desktop.level(
      z.object({ meetingId: z.string(), level: z.number().min(0).max(1) }).parse(payload),
    );
    return true;
  });
  handleIpc('desktop.meeting-prompt', (event, payload) => {
    if (desktop.prompt?.webContents !== event.sender) throw new Error('Meeting prompt has closed');
    if (payload.action === 'state')
      return {
        name: desktop.promptName,
        theme: desktop.state.theme,
        locale: desktop.state.locale,
      };
    if (!['dismiss', 'record'].includes(payload.action)) throw new Error('Invalid prompt action');
    const record = payload.action === 'record' && desktop.canPrompt();
    desktop.prompt.destroy();
    if (record)
      return desktop.action('quick', { background: true }).catch((error) => {
        desktop.showMain();
        reportMainError(error);
      });
    return true;
  });
  handleIpc('desktop.state', () => ({
    ...desktop.state,
    expanded: desktop.expanded,
    above: desktop.above,
    pillOffset: desktop.pillOffset,
  }));
  handleIpc('desktop.action', (_, payload) => {
    const value = z
      .object({
        action: z.enum([
          'return',
          'playback-pause',
          'playback-stop',
          'pause',
          'stop',
          'mark',
          'accept',
          'ignore',
          'ai-settings',
          'models',
          'read-notes',
          'save-notes',
        ]),
        note: z
          .object({
            base: z.string().max(5 * 1024 * 1024),
            text: z.string().max(5 * 1024 * 1024),
          })
          .optional(),
        suggestionId: z.string().optional(),
        meetingId: z.string().nullable().optional(),
        tab: z.enum(['captions', 'notes']).optional(),
      })
      .parse(payload);
    return desktop.action(value.action, value);
  });
  handleIpc('desktop.complete', (_, payload) => {
    desktop.complete(
      z
        .object({
          requestId: z.string().uuid(),
          error: z.string().max(2000).optional(),
          result: z
            .union([
              z.boolean(),
              z.string().max(5 * 1024 * 1024),
              z
                .object({
                  meeting_id: z.string().uuid(),
                  state: z.enum(['recording', 'paused', 'stopped']),
                  confirmed: z.literal(true),
                })
                .strict(),
              z.object({ model_required: z.array(z.string().min(1)).max(8) }).strict(),
              z
                .array(
                  z
                    .object({ deviceId: z.string().max(1024), label: z.string().max(1024) })
                    .strict(),
                )
                .max(256),
            ])
            .optional(),
        })
        .parse(payload),
    );
    return true;
  });
  handleIpc('desktop.expand', async (_, payload) => {
    await desktop.expand(z.object({ expanded: z.boolean() }).parse(payload).expanded);
    return true;
  });
  handleIpc('desktop.move', async (_, payload) => {
    await desktop.move(
      z
        .object({
          dx: z.number().finite().min(-10000).max(10000),
          dy: z.number().finite().min(-10000).max(10000),
        })
        .parse(payload),
    );
    return true;
  });
  handleIpc('mobile.status', () => ({
    ...mobileServer.status(),
    approval: mobileApproval && {
      id: mobileApproval.id,
      name: mobileApproval.name,
      verification: mobileApproval.verification,
    },
  }));
  handleIpc('mobile.approve', (_, payload) => {
    const value = z
      .object({
        id: z.string().uuid(),
        allowed: z.boolean(),
        libraryAccess: z.boolean().default(false),
      })
      .parse(payload);
    if (mobileApproval?.id !== value.id) throw new Error('配对请求已过期');
    mobileApproval.resolve(value.allowed && { allowed: true, libraryAccess: value.libraryAccess });
    return { saved: true };
  });
  handleIpc('mobile.access', (_, payload) => {
    const { id, enabled } = z
      .object({ id: z.string().regex(/^[a-f0-9]{32}$/), enabled: z.boolean() })
      .parse(payload);
    return mobileServer.setLibraryAccess(id, enabled);
  });
  handleIpc('mobile.proposals', () => mobileServer.proposals());
  handleIpc('mobile.resolve-proposal', (_, payload) =>
    mobileServer.resolveProposal(
      id
        .extend({
          id: z.string().uuid(),
          accept: z.boolean(),
          expected_notes: z.string().max(5 * 1024 * 1024),
        })
        .parse(payload),
    ),
  );
  handleIpc('mobile.stop', (_, payload) => mobileServer.requestStop(id.parse(payload).meeting_id));
  handleIpc('mobile.start-capture', (_, payload) => {
    const { device_id: deviceId, ...value } = meetingStart
      .extend({
        device_id: z.string().regex(/^[a-f0-9]{32}$/),
      })
      .parse(payload);
    return mobileServer.startCapture(deviceId, value);
  });
  handleIpc('mobile.pause-capture', (_, payload) => {
    const value = id.extend({ paused: z.boolean() }).parse(payload);
    return mobileServer.pauseCapture(value.meeting_id, value.paused);
  });
  handleIpc('mobile.preview-capture', (_, payload) => {
    const value = z
      .object({
        device_id: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .nullable(),
      })
      .parse(payload);
    return mobileServer.previewCapture(value.device_id);
  });
  handleIpc('mobile.finish-received', (_, payload) =>
    mobileServer.finishReceived(id.parse(payload).meeting_id),
  );
  handleIpc('mobile.pair', () => mobileServer.openPairing());
  handleIpc('mobile.close-pairing', () => {
    mobileServer.pairing = null;
    return mobileServer.status();
  });
  handleIpc('mobile.disable', () => mobileServer.disable());
  handleIpc('mobile.revoke', (_, value) =>
    mobileServer.revoke(z.object({ id: z.string().regex(/^[a-f0-9]{32}$/) }).parse(value).id),
  );
  handleIpc('app.version', () => app.getVersion());
  handleIpc('update.check', () => checkForUpdate());
  let pendingInstall;
  handleIpc('update.install', () => {
    if (!pendingInstall)
      pendingInstall = installUpdate().finally(() => {
        pendingInstall = null;
      });
    return pendingInstall;
  });
  if (nativeAudio) {
    handleIpc('native-audio.devices', () => nativeAudio.query('devices'));
    handleIpc('native-audio.prepare', (_, payload) => {
      const value = z
        .object({
          mic: z.boolean(),
          system: z.boolean(),
          deviceId: z.string().max(1024).optional(),
          preview: z.boolean().optional(),
        })
        .parse(payload);
      if (worker.active && !worker.active.mobile) throw new Error('A recording is already active');
      return nativeAudio.prepare(
        value,
        (frame) => {
          if (worker.active?.meeting_id !== frame.meeting_id)
            throw new Error('Recording has ended');
          return worker.request('meeting.audio', audio.parse(frame));
        },
        (type, event) => worker.sendEvent(type, event),
      );
    });
    handleIpc('native-audio.start', (_, payload) => {
      const value = id.parse(payload);
      if (worker.active?.meeting_id !== value.meeting_id || worker.active.mobile)
        throw new Error('Invalid recording');
      return nativeAudio.command('start', value.meeting_id);
    });
    handleIpc('native-audio.pause', (_, payload) =>
      nativeAudio.command(z.boolean().parse(payload.paused) ? 'pause' : 'resume'),
    );
    handleIpc('native-audio.stop', () => nativeAudio.command('stop'));
  }
  handleIpc('permissions.status', () => nativeAudio.query('permissions'));
  handleIpc('permissions.request-microphone', () => nativeAudio.query('request-microphone'));
  let pendingScreenPermission;
  handleIpc('permissions.request-screen', () => {
    if (process.platform !== 'darwin') return nativeAudio.query('request-screen');
    // 只响应用户主动申请；macOS 拒绝过的权限仍需用户在系统设置中开启。
    if (!pendingScreenPermission) {
      pendingScreenPermission = (async () => {
        return nativeAudio.query('request-screen');
      })().finally(() => {
        pendingScreenPermission = undefined;
      });
    }
    return pendingScreenPermission;
  });
  handleIpc('permissions.open-screen-settings', async () => {
    if (process.platform !== 'darwin') return false;
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    return true;
  });
  handleIpc('permissions.open-microphone-settings', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );
      return true;
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone');
      return true;
    }
    return false;
  });
  handleIpc('app.initialize', () => initializeWorker());
  handleIpc('app.maintain', async () => {
    if (app.isQuitting) return {};
    try {
      return await worker.request('app.maintain');
    } catch (error) {
      if (app.isQuitting) return {};
      writeLog('ERROR', `app.maintain: ${logText(error)}`);
      throw error;
    }
  });
  handleIpc('meeting.start', async (_, payload) => {
    if ([...(mobileServer?.sessions.values() || [])].some((s) => !s.finished))
      throw new Error('请先在手机结束录音并完成补传');
    const { agent_control: agentControl, ...value } = meetingStart
      .extend({ agent_control: z.boolean().optional() })
      .parse(payload);
    let result;
    try {
      result = await worker.request('meeting.start', { ...value, require_models: false });
    } catch (error) {
      const models = requiredModels(error);
      if (!models) throw error;
      // Agent 的失败请求不能进入自动下载后重启录音的 UI 队列。
      if (!agentControl)
        worker.sendEvent('model.required', { models, task: 'meeting.start', payload: value });
      return { model_required: models };
    }
    worker.active = { meeting_id: result.id, started_at: Date.now() };
    worker.restarts = 0;
    resetFloatingCaptionState();
    return result;
  });
  // 仅允许导入由文件选择器或真实拖入 File 选中的路径；选择阶段不创建会议。
  let selectedImportAudio = null;
  const audioImportFilters = [
    { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] },
  ];
  handleIpc('meeting.select-audio', async (_, payload) => {
    const { path: dropped } = z.object({ path: z.string().max(4096).optional() }).parse(payload);
    const result = dropped
      ? { canceled: false, filePaths: [dropped] }
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: audioImportFilters });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!path.isAbsolute(file) || !audioImportFilters[0].extensions.includes(extension))
      throw new Error('Unsupported audio file');
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size === 0) throw new Error('Invalid audio file');
    selectedImportAudio = file;
    return { path: file, name: path.basename(file), size: metadata.size };
  });
  handleIpc('meeting.import', async (_, payload) => {
    const value = meetingStart
      .extend({ path: z.string().optional(), meeting_date: z.iso.date().nullable().optional() })
      .parse(payload);
    const selected =
      selectedImportAudio && value.path === selectedImportAudio
        ? { canceled: false, filePaths: [selectedImportAudio] }
        : await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: audioImportFilters,
          });
    if (selected.canceled) return null;
    const result = await worker.request('meeting.import', {
      ...value,
      path: selected.filePaths[0],
    });
    selectedImportAudio = null;
    resetFloatingCaptionState();
    return result;
  });
  handleIpc('meeting.audio', (_, payload) => {
    const value = audio.parse(payload);
    // 熄屏停会不会先等渲染进程的音频队列；丢弃其尾帧，避免已停止的 worker 报错。
    if (stoppingForSleep || worker.active?.meeting_id !== value.meeting_id)
      return { dropped: true };
    return worker.request('meeting.audio', value);
  });
  handleIpc('meeting.pause', async (_, payload) => {
    const value = id.extend({ paused: z.boolean() }).parse(payload);
    const result = await worker.request('meeting.pause', value);
    if (worker.active?.meeting_id === value.meeting_id) worker.active.paused = result.paused;
    return result;
  });
  handleModelRequirement('meeting.reconfigure', meetingReconfigure, 'meeting.reconfigure');
  handleIpc('meeting.stop', async (_, payload) => {
    if (worker.active?.mobile) throw new Error('请在手机结束本次录音');
    const value = id.extend({ duration_ms: z.number().nonnegative() }).parse(payload);
    const result = await worker.request('meeting.stop', value);
    worker.active = null;
    worker.recycle();
    return result;
  });
  handle(
    'meeting.list',
    z.object({ include_deleted: z.boolean().optional(), query: z.string().max(120).optional() }),
    'meeting.list',
  );
  handle('meeting.search', z.object({ query: z.string().max(120) }), 'meeting.search');
  handle('meeting.get', id, 'meeting.get');
  handle(
    'meeting.update',
    id.extend({
      updates: meetingUpdates,
      expected_notes: z
        .string()
        .max(5 * 1024 * 1024)
        .optional(),
    }),
    'meeting.update',
  );
  handle('meeting.delete', id, 'meeting.delete');
  handle('meeting.restore', id, 'meeting.restore');
  handle('meeting.purge', id, 'meeting.purge');
  handleIpc('meeting.refine', (_, payload) => handleRefinement(payload));
  handleIpc('meeting.note-image.save', async (event, payload) => {
    const value = noteImage.parse(payload);
    if (
      event.sender !== desktop.mainWindow?.webContents &&
      (event.sender !== desktop.capsule?.webContents ||
        value.meeting_id !== desktop.state?.meetingId ||
        !['recording', 'paused', 'playing', 'playback-paused'].includes(desktop.state.phase))
    )
      throw new Error(mainText('error.desktop.session_changed'));
    await worker.request('meeting.get', { meeting_id: value.meeting_id });
    return saveNoteImage(value);
  });
  handle('workspace.list', z.object({}), 'workspace.list');
  const termScope = z.object({ workspace_id: z.union([z.literal(''), z.string().uuid()]) });
  const termFlags = z.object({ post_replace: z.boolean(), hotword: z.boolean() });
  const termText = z.string().trim().min(1).max(80);
  handle('glossary.list', z.object({}), 'glossary.list');
  const glossaryEntry = termScope.extend({
    workspace_id: z.union([z.literal(''), z.literal('public'), z.string().uuid()]),
    name: termText,
    meaning: z.string().trim().min(1).max(1000),
  });
  const mention = z.object({ meeting_id: z.string().uuid(), original: termText });
  handle('glossary.source', mention, 'glossary.source');
  handle(
    'glossary.update',
    z.discriminatedUnion('action', [
      glossaryEntry.extend({ action: z.literal('save') }),
      glossaryEntry.merge(mention).extend({ action: z.literal('resolve') }),
      mention.extend({ action: z.literal('dismiss') }),
      z.object({ action: z.literal('clear') }),
    ]),
    'glossary.update',
  );
  handle('workspace.terms', termScope, 'workspace.terms');
  handle(
    'workspace.term.save',
    z.union([
      termScope.extend({ wrong: termText, remove: z.literal(true) }),
      termScope.merge(termFlags).extend({ wrong: termText, correct: termText }),
    ]),
    'workspace.term.save',
  );
  handle('workspace.get', z.object({ workspace_id: z.string() }), 'workspace.get');
  handle(
    'workspace.create',
    z.object({
      name: z.string().trim().min(1).max(50),
      description: z.string().max(200).optional(),
    }),
    'workspace.create',
  );
  handle(
    'workspace.update',
    z.object({
      workspace_id: z.string(),
      updates: z.object({
        name: z.string().trim().min(1).max(50).optional(),
        description: z.string().max(200).optional(),
      }),
    }),
    'workspace.update',
  );
  handle('workspace.delete', z.object({ workspace_id: z.string() }), 'workspace.delete');
  handle(
    'workspace.assign',
    z.object({ meeting_id: z.string().uuid(), workspace_id: z.string().uuid().nullable() }),
    'workspace.assign',
  );
  handle(
    'speaker.rename',
    id.extend({
      speaker_id: z.string(),
      name: z.string().trim().min(1).max(32),
      locked: z.boolean().optional(),
      meeting_only: z.boolean().optional(),
      merge_target_id: z.string().min(1).optional(),
    }),
    'speaker.rename',
  );
  handle('speaker-profile.list', z.object({}), 'speaker-profile.list');
  handle(
    'speaker-profile.samples',
    z.object({ profile_id: z.string().uuid() }),
    'speaker-profile.samples',
  );
  handleIpc('speaker-profile.enroll', async (_, payload) => {
    const value = z
      .object({ profile_id: z.string().uuid().optional(), name: z.string().trim().min(1).max(32) })
      .parse(payload);
    const selected = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }],
    });
    if (selected.canceled) return null;
    return worker
      .request('speaker-profile.enroll', { ...value, path: selected.filePaths[0] })
      .finally(() => worker.recycle());
  });
  handleIpc('speaker-profile.verify', async (_, payload) => {
    const value = z.object({ profile_id: z.string().uuid() }).parse(payload);
    const selected = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }],
    });
    if (selected.canceled) return null;
    return worker
      .request('speaker-profile.verify', { ...value, path: selected.filePaths[0] })
      .finally(() => worker.recycle());
  });
  handle(
    'speaker-profile.delete',
    z.object({ profile_id: z.string().uuid() }),
    'speaker-profile.delete',
  );
  handle(
    'speaker-profile.rename',
    z.object({ profile_id: z.string().uuid(), name: z.string().trim().min(1).max(32) }),
    'speaker-profile.rename',
  );
  handle(
    'speaker-profile.sample-delete',
    z.object({ profile_id: z.string().uuid(), sample_id: z.string().uuid() }),
    'speaker-profile.sample-delete',
  );
  handle(
    'storage.clear',
    z.object({ partition: z.enum(['meetings', 'models', 'exports']) }),
    'storage.clear',
  );
  handle('storage.cleanup', z.object({}), 'storage.cleanup');
  handle('settings.advanced.get', z.object({}), 'settings.advanced.get');
  handle('prompts.get', z.object({}).strict(), 'prompts.get');
  handle(
    'prompts.save',
    z
      .object({
        summary: z.string().max(4000),
        ai_note: z.string().max(4000),
        translation: z.string().max(4000),
      })
      .strict(),
    'prompts.save',
  );
  handle(
    'settings.advanced.save',
    z.object({ settings: z.record(z.string(), z.unknown()) }),
    'settings.advanced.save',
  );
  handleIpc('metrics.record', async (_, payload) => {
    if (app.isQuitting) return null;
    try {
      return await worker.request(
        'metrics.record',
        z.object({ app_duration_ms: z.number().int().nonnegative().optional() }).parse(payload),
      );
    } catch (error) {
      if (error.code === 'EPIPE' || app.isQuitting) return null;
      throw error;
    }
  });
  handle(
    'segment.speaker',
    id.extend({
      segment_id: z.string().min(1),
      name: z.string().trim().min(1).max(32),
      enroll: z.boolean().optional(),
      target_speaker_id: z.string().min(1).optional(),
    }),
  );
  // 同时限制单句和整批字符数，避免编辑请求占满 worker 的 32 MiB 命令容量。
  handle(
    'segment.text',
    id.extend({
      segments: z
        .array(
          z.object({
            segment_id: z.string().min(1),
            text: z.string().max(4000),
            expected: z
              .object({
                text: z.string().max(4000),
                version: z.string().max(64),
                revision: z.number().int().nonnegative(),
              })
              .optional(),
          }),
        )
        .min(1)
        .max(500)
        .refine((edits) => edits.reduce((total, edit) => total + edit.text.length, 0) <= 60000, {
          message: 'Too many subtitle edits in one save',
        }),
    }),
  );
  handle(
    'segment.correction',
    id.extend({
      action: z.enum(['replace', 'undo', 'disable']),
      scope: z.enum(['transcript', 'notes', 'summary']).optional(),
      document: z
        .object({
          text: z.string().max(5 * 1024 * 1024),
          occurrences: z.array(z.number().int().nonnegative()).min(1).max(4000),
        })
        .optional(),
      find: z.string().max(4000).optional(),
      replacement: z.string().max(4000).optional(),
      future: z.boolean().optional(),
      confirm_rule: z.boolean().optional(),
      expected_rule_replacement: z.string().max(4000).optional(),
      remember: termScope.merge(termFlags).optional(),
      matches: z
        .array(
          z.object({
            segment_id: z.string().min(1).max(128),
            text: z.string().max(4000),
            version: z.string().max(64),
            revision: z.number().int().nonnegative(),
            occurrences: z.array(z.number().int().nonnegative()).min(1).max(4000),
          }),
        )
        .min(1)
        .max(500)
        .optional(),
    }),
  );
  handleIpc('segment.speaker-profile-sample', async (_, payload) => {
    const value = id
      .extend({ segment_id: z.string().min(1), profile_id: z.string().uuid() })
      .parse(payload);
    return worker.request('segment.speaker-profile-sample', value).finally(() => worker.recycle());
  });
  handleIpc('storage.open', async (_, payload) => {
    const partition = z.enum(['meetings', 'models', 'exports']).parse(payload?.partition);
    const directory = partition === 'models' ? modelsDir() : recordingsDir();
    return shell.openPath(directory);
  });
  handleIpc('storage.locations', async () => {
    let disk = null;
    try {
      const stats = await statfs(app.getPath('home'));
      disk = {
        total: stats.blocks * stats.bsize,
        used: (stats.blocks - stats.bfree) * stats.bsize,
        free: stats.bavail * stats.bsize,
      };
    } catch {
      // 系统统计不可用时，仍允许查看和更改文件夹。
    }
    return {
      models: modelsDir(),
      recordings: recordingsDir(),
      modelsManaged: !process.env.BREVIA_MODELS_DIR,
      recordingsManaged: !process.env.BREVIA_MEETINGS_DIR,
      disk,
    };
  });
  handleIpc('storage.choose-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handleIpc('storage.setup-locations', async (_, payload) => {
    const value = z.object({ models: z.string(), recordings: z.string() }).parse(payload);
    return migrateStorageFolders(value);
  });
  handle('models.list', z.object({}), 'models.list');
  handle(
    'models.download',
    z.object({ model_id: z.string(), source: z.enum(['default', 'china']).optional() }),
    'models.download',
  );
  handle('models.pause', z.object({ model_id: z.string() }), 'models.pause');
  handle('models.cancel', z.object({ model_id: z.string() }), 'models.cancel');
  handle('models.delete', z.object({ model_id: z.string() }), 'models.delete');
  const taskControl = z.object({
    task: z.enum(['meeting.refine', 'summary.generate']),
    meeting_id: z.string(),
  });
  handleTaskControl('task.pause', taskControl);
  handleTaskControl('task.resume', taskControl);
  handleTaskControl('task.cancel', taskControl);
  handleIpc('summary.config.get', async () => readSummaryConfig());
  handleIpc('summary.config.save', (_, payload) =>
    saveProviderConfig(payload, summaryConfig, writeSummaryConfig),
  );
  handleIpc('ai-assist.config.get', async () => readAiAssistConfig());
  handleIpc('ai-assist.config.save', (_, payload) =>
    saveProviderConfig(payload, aiAssistConfig, writeAiAssistConfig),
  );
  handleIpc('summary.test', async (_, payload) => {
    const value = llmRequest.safeExtend({ apiKey: z.string().max(512).optional() }).parse(payload);
    if (isBuiltInProvider(value.provider)) throw new Error('Online provider required');
    const api_key = value.apiKey || (await getSecret(value.key_reference));
    if (!api_key) throw new Error('API Key is required');
    const started = Date.now();
    await require('../macos/backend/llm-client.cjs').complete(
      { ...value, api_key },
      'Reply only OK.',
      { timeout: 30 },
    );
    return { elapsed_ms: Date.now() - started };
  });
  handleIpc('summary.generate', async (_, payload) => {
    const value = id
      .extend({
        ...llmRequest.shape,
        context_size: z.number().int().min(1024).max(65536).optional(),
        template: summaryTemplate.optional(),
        language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']).default('en'),
        consent: z.literal(true),
      })
      .refine(({ provider, endpoint }) => !requiresEndpoint(provider) || Boolean(endpoint), {
        message: 'Endpoint is required for remote providers',
        path: ['endpoint'],
      })
      .parse(payload);
    const api_key = await getSecret(value.key_reference);
    if (!api_key && !isBuiltInProvider(value.provider)) return { configuration_required: true };
    return worker.request('summary.generate', { ...value, api_key, analyze_terms: true });
  });
  handleIpc('summary.save', async (_, payload) =>
    worker.request(
      'summary.save',
      z
        .union([
          id.extend({
            claim_id: z.string().uuid(),
            text: z.string().trim().min(1).max(10000),
            expected_text: z.string(),
          }),
          id.extend({
            markdown: z.string().max(5 * 1024 * 1024),
            expected_markdown: z.string().optional(),
          }),
        ])
        .parse(payload),
    ),
  );
  handleIpc('translation.generate', async (_, payload) => {
    const value = id
      .extend({
        segment_id: z.string(),
        segment: z
          .object({
            text: z.string().trim().min(1),
            start_ms: z.number().nonnegative(),
            end_ms: z.number().nonnegative(),
            speaker: z.string().trim().min(1).max(128),
            track: z.string().trim().min(1).max(32),
            revision: z.number().int().nonnegative(),
          })
          .optional(),
        target_language: z.string().min(2).max(16),
        consent: z.literal(true),
      })
      .parse(payload);
    return worker.request('translation.generate', value);
  });
  handleIpc('ai-note.start', async (_, payload) => {
    const value = aiNoteStart.parse(payload);
    const api_key = await getSecret(value.key_reference);
    if (!api_key && !isBuiltInProvider(value.provider)) return { configuration_required: true };
    return worker.request('ai-note.start', { ...value, api_key });
  });
  handleIpc('ai-note.stop', (_, payload) => worker.request('ai-note.stop', id.parse(payload)));
  handleIpc('ai-note.typing', (_, payload) =>
    worker.request('ai-note.typing', aiNoteTyping.parse(payload)),
  );
  handleIpc('ai-note.request', (_, payload) =>
    worker.request('ai-note.request', aiNoteRequest.parse(payload)),
  );
  handleIpc('ai-note.dismiss', (_, payload) =>
    worker.request('ai-note.dismiss', aiNoteDismiss.parse(payload)),
  );
  handleIpc('ai-note.reconfigure', (_, payload) =>
    worker.request('ai-note.reconfigure', aiNoteReconfigure.parse(payload)),
  );
  handleIpc('meeting.markdown-target', (_, payload) =>
    markdownTarget(dataDir(), recordingsDir(), id.parse(payload).meeting_id),
  );
  handleIpc('meeting.sync-markdown', async (event, payload) => {
    const { meeting_id, mode } = id
      .extend({ mode: z.enum(['sync', 'choose', 'copy']) })
      .parse(payload);
    return syncMarkdown(
      dataDir(),
      recordingsDir(),
      () => worker.request('meeting.markdown-note', { meeting_id }),
      mode,
      async (defaultPath) => {
        const result = await dialog.showOpenDialog(NativeWindow.fromWebContents(event.sender), {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: defaultPath || undefined,
        });
        return result.canceled ? null : result.filePaths[0];
      },
    );
  });
  handleIpc('share.cloud', async (_, payload) => {
    const { meeting_id, days, language, password } = id
      .extend({
        days: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30)]),
        password: z.string().min(1).max(128).optional(),
        language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']),
      })
      .parse(payload);
    return uploadShare(
      await worker.request('meeting.share-document', { meeting_id }),
      days,
      language,
      password,
    );
  });
  handleIpc('share.group-summary', async (_, payload) => {
    const { meeting_id, address } = id
      .extend({ address: z.string().trim().max(500) })
      .parse(payload);
    const meeting = await worker.request('meeting.get', { meeting_id });
    const markdown = meeting.summary?.data?.markdown;
    if (!markdown?.trim()) return 'empty';
    return sendGroupSummary(address, meeting.title + '\n\n' + markdown);
  });
  handleIpc('meeting.export', async (_, payload) => {
    const value = id
      .extend({
        content: z.enum(['transcript', 'notes', 'analysis', 'mynotes', 'audio']).optional(),
        format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'wav']),
        track: z.enum(['mix', 'mic', 'system']).optional(),
        filename_prefix: z.string().max(60).optional(),
      })
      .parse(payload);
    const exported = await prepareExport(value);
    const destination = await dialog.showSaveDialog({ defaultPath: path.basename(exported.path) });
    if (destination.canceled) return null;
    await copyFile(exported.path, destination.filePath);
    return { ...exported, path: destination.filePath };
  });
  handleIpc('meeting.export-many', async (_, payload) => {
    const value = z
      .object({
        meeting_ids: z.array(z.string().uuid()).min(1).max(200),
        format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'wav']).default('md'),
        content: z.enum(['notes', 'analysis', 'mynotes', 'transcript', 'audio']).optional(),
        filename_prefix: z.string().max(60).optional(),
      })
      .refine(({ content, format }) => {
        if (!content) return true;
        if (content === 'audio') return format === 'wav';
        if (content === 'transcript') return format !== 'wav';
        return ['md', 'txt', 'docx', 'pdf'].includes(format);
      })
      .parse(payload);
    const destination = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (destination.canceled) return null;
    const paths = [];
    const results = [];
    for (const meetingId of value.meeting_ids) {
      try {
        const exported = await prepareExport({
          meeting_id: meetingId,
          content: value.content || (value.format === 'wav' ? 'audio' : 'transcript'),
          format: value.format,
          ...(value.filename_prefix ? { filename_prefix: value.filename_prefix } : {}),
        });
        const target = await copyExportIntoDirectory(exported.path, destination.filePaths[0]);
        paths.push(target);
        results.push({ meeting_id: meetingId, path: target });
      } catch (error) {
        results.push({ meeting_id: meetingId, error: String(error.message || error) });
      }
    }
    // 保留既有 paths/format，补充实际逐项结果，避免部分写入后误报整体成功。
    return { paths, format: value.format, results };
  });
  handleIpc('meeting.share', async (_, payload) => {
    const exported = await worker.request('meeting.bundle', id.parse(payload));
    const destination = await dialog.showSaveDialog({ defaultPath: path.basename(exported.path) });
    if (destination.canceled) return null;
    await copyFile(exported.path, destination.filePath);
    return { ...exported, path: destination.filePath };
  });
  // 通用「导出与分享」入口：按用户勾选的内容项导出（逐字稿/纪要/我的笔记/录音，
  // 文本内容可选格式，录音使用默认 WAV）。单项直接交付该文件；多项打包为一个 zip。mode 决定交付方式：
  // save —— 弹出保存对话框；reveal —— 在文件夹中定位；system —— 弹出系统分享面板。
  handleIpc('meeting.export-bundle', async (event, payload) => {
    const value = z
      .object({
        meeting_id: z.string().uuid(),
        items: z
          .array(
            z.object({
              content: z.enum(['transcript', 'notes', 'analysis', 'mynotes', 'audio']),
              format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'wav']),
              track: z.enum(['mix', 'mic', 'system']).optional(),
              label: z.string().min(1).max(60).optional(),
              filename_prefix: z.string().max(60).optional(),
            }),
          )
          .min(1)
          .max(8),
        mode: z.enum(['save', 'reveal', 'system']).default('save'),
        anchor: z
          .object({
            x: z.number().int().min(0).max(100000),
            y: z.number().int().min(0).max(100000),
          })
          .optional(),
      })
      .parse(payload);
    // 1. 依次准备每项（prepareExport 会处理 PDF 渲染）。
    const prepared = [];
    for (const item of value.items) {
      const exported = await prepareExport({
        meeting_id: value.meeting_id,
        content: item.content,
        format: item.format,
        ...(item.track ? { track: item.track } : {}),
        ...(item.filename_prefix ? { filename_prefix: item.filename_prefix } : {}),
      });
      prepared.push({
        path: exported.path,
        format: exported.format,
        label: item.label || item.content,
      });
    }
    if (
      value.mode === 'save' &&
      value.items.length === 2 &&
      ['notes', 'analysis'].every((type) => value.items.some((item) => item.content === type))
    ) {
      const destination = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      });
      if (destination.canceled) return null;
      const paths = [];
      try {
        for (const file of prepared) {
          paths.push(await copyExportIntoDirectory(file.path, destination.filePaths[0]));
        }
      } catch (error) {
        await Promise.all(paths.map((target) => rm(target, { force: true })));
        throw error;
      }
      return { paths, count: paths.length };
    }
    // 2. 多项时打包为一个 zip；单项直接交付。
    let deliver = prepared;
    if (prepared.length > 1) {
      const zipPath = await buildSelectedBundle(value.meeting_id, prepared);
      deliver = [{ path: zipPath, format: 'zip', label: 'bundle' }];
    }
    const file = deliver[0];
    if (value.mode === 'save') {
      const destination = await dialog.showSaveDialog({ defaultPath: path.basename(file.path) });
      if (destination.canceled) return null;
      await copyFile(file.path, destination.filePath);
      return { paths: [destination.filePath], format: file.format, count: prepared.length };
    }
    if (value.mode === 'reveal') {
      shell.showItemInFolder(file.path);
      return { paths: [file.path], format: file.format, revealed: true, count: prepared.length };
    }
    if (value.mode === 'system') {
      if (process.platform !== 'darwin' || typeof ShareMenu !== 'function')
        throw new Error('System share is only available on macOS');
      const window = NativeWindow.fromWebContents(event.sender) || NativeWindow.getAllWindows()[0];
      if (!window) throw new Error('No window to anchor the share menu');
      await new ShareMenu({ filePaths: deliver.map((entry) => entry.path) }).popup({
        window,
        ...(value.anchor ? { x: value.anchor.x, y: value.anchor.y } : {}),
      });
      return { shared: true, format: file.format, count: prepared.length };
    }
    return null;
  });
  handleIpc('share.copy-text', async (_, payload) => {
    const value = z.object({ text: z.string().min(1).max(200000) }).parse(payload);
    await clipboard.writeText(value.text);
    return { copied: true };
  });
  handleIpc('share.open-external', async (_, payload) => {
    const value = z.object({ url: z.string().min(1).max(8000) }).parse(payload);
    // 仅放行社交网页分享(https)与邮件(mailto)。其余 scheme 一律拒绝,避免通过 IPC 触发任意协议处理器。
    if (!/^(https:\/\/|mailto:)/i.test(value.url)) throw new Error('Unsupported share URL');
    await shell.openExternal(value.url);
    return { opened: true };
  });
  handleIpc('share.file', async (_, payload) => {
    const value = z
      .object({
        meeting_id: z.string().uuid(),
        kind: z.enum(['export', 'bundle']).default('export'),
        content: z.enum(['transcript', 'notes', 'analysis', 'mynotes', 'audio']).optional(),
        format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'wav']).optional(),
        track: z.enum(['mix', 'mic', 'system']).optional(),
      })
      .parse(payload);
    // 与「导出」不同:直接写入会议的 exports 目录并在文件管理器中高亮,供用户手动拖入微信等无 API 平台。
    const exported =
      value.kind === 'bundle'
        ? await worker.request('meeting.bundle', { meeting_id: value.meeting_id })
        : await prepareExport({
            meeting_id: value.meeting_id,
            content: value.content,
            format: value.format || (value.content === 'audio' ? 'wav' : 'md'),
            ...(value.track ? { track: value.track } : {}),
          });
    shell.showItemInFolder(exported.path);
    return { ...exported, revealed: true };
  });
  // 系统原生分享面板(NSSharingServicePicker)。仅 macOS 提供;可分享纯文本或先导出的文件,
  // 用户从面板选 AirDrop / 信息 / 邮件 / 备忘录,以及任何注册了分享扩展的 App(如微信)。
  handleIpc('share.system', async (event, payload) => {
    if (process.platform !== 'darwin' || typeof ShareMenu !== 'function')
      throw new Error('System share is only available on macOS');
    const value = z
      .object({
        text: z.string().min(1).max(200000).optional(),
        anchor: z
          .object({
            x: z.number().int().min(0).max(100000),
            y: z.number().int().min(0).max(100000),
          })
          .optional(),
        file: z
          .object({
            meeting_id: z.string().uuid(),
            kind: z.enum(['export', 'bundle']).default('export'),
            content: z.enum(['transcript', 'notes', 'analysis', 'mynotes', 'audio']).optional(),
            format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'wav']).optional(),
            track: z.enum(['mix', 'mic', 'system']).optional(),
          })
          .optional(),
      })
      .refine((v) => v.text || v.file, { message: 'Nothing to share' })
      .parse(payload);
    const sharingItem = {};
    if (value.text) sharingItem.texts = [value.text];
    if (value.file) {
      const exported =
        value.file.kind === 'bundle'
          ? await worker.request('meeting.bundle', { meeting_id: value.file.meeting_id })
          : await prepareExport({
              meeting_id: value.file.meeting_id,
              content: value.file.content,
              format: value.file.format || (value.file.content === 'audio' ? 'wav' : 'md'),
              ...(value.file.track ? { track: value.file.track } : {}),
            });
      sharingItem.filePaths = [exported.path];
    }
    const window = NativeWindow.fromWebContents(event.sender) || NativeWindow.getAllWindows()[0];
    if (!window) throw new Error('No window to anchor the share menu');
    // 传入按钮坐标(相对窗口内容区),弹窗锚定在按钮处;无坐标时回退到窗口默认位置。
    await new ShareMenu(sharingItem).popup({
      window,
      ...(value.anchor ? { x: value.anchor.x, y: value.anchor.y } : {}),
    });
    return { shared: true };
  });
  handleIpc('shell.showItem', (_, filePath) => {
    const resolved = path.resolve(z.string().parse(filePath));
    if (
      ![dataDir(), recordingsDir(), modelsDir()].some(
        (root) => resolved === path.resolve(root) || isWithin(root, resolved),
      )
    )
      throw new Error('Invalid path');
    return shell.showItemInFolder(resolved);
  });
  handleIpc('audio.url', (_, filePath) =>
    audioFileURL(z.string().parse(filePath), [
      recordingsDir(),
      path.join(dataDir(), 'speaker-profiles'),
    ]),
  );
  handleIpc('floating-caption.show', () => {
    resetFloatingCaptionState();
    return showFloatingCaption();
  });
  handleIpc('floating-caption.close', () => closeFloatingCaption());
  handleIpc('floating-caption.update', (_, payload) => {
    const value = floatingCaptionPayload.parse(payload ?? {});

    // Handle finalize: move current → lastFinalized
    if (value.finalize) {
      floatingCaptionState.lastFinalized = {
        segmentId: floatingCaptionState.current.segmentId,
        text: floatingCaptionState.current.text,
        translation: floatingCaptionState.current.translation || null,
      };
      floatingCaptionState.current = {
        segmentId: null,
        text: '',
        isRefined: false,
        translation: null,
      };
      sendFloatingCaptionState();
      return true;
    }

    // Handle updateFinalized: update the lastFinalized text directly (for refined segments)
    if (value.updateFinalized && value.text !== undefined) {
      const pendingTranslation =
        floatingCaptionState.pendingTranslation.segmentId === value.segmentId
          ? floatingCaptionState.pendingTranslation.text
          : null;
      const existingTranslation =
        floatingCaptionState.lastFinalized.segmentId === value.segmentId
          ? floatingCaptionState.lastFinalized.translation
          : null;
      floatingCaptionState.lastFinalized = {
        segmentId: value.segmentId ?? null,
        text: value.text,
        translation: pendingTranslation || existingTranslation,
      };
      if (pendingTranslation)
        floatingCaptionState.pendingTranslation = { segmentId: null, text: null };
      // Clear current area only if it's showing the same segment that was just refined
      if (value.clearCurrentIfMatch && value.segmentId === floatingCaptionState.current.segmentId) {
        floatingCaptionState.current = {
          segmentId: null,
          text: '',
          isRefined: false,
          translation: null,
        };
      }
      sendFloatingCaptionState();
      return true;
    }

    // Handle segment text update
    if (value.segmentId !== undefined && value.text !== undefined) {
      // Starting a new segment
      if (floatingCaptionState.current.segmentId !== value.segmentId) {
        floatingCaptionState.current = {
          segmentId: value.segmentId,
          text: value.text,
          isRefined: value.isRefined || false,
          translation: null,
        };
      } else {
        // Updating existing segment
        floatingCaptionState.current.text = value.text;
        if (value.isRefined !== undefined) {
          floatingCaptionState.current.isRefined = value.isRefined;
        }
      }
    }

    // Handle translation update
    if (value.translation !== undefined && value.segmentId !== undefined) {
      if (floatingCaptionState.translationPending.segmentId === value.segmentId) {
        floatingCaptionState.translationPending = { segmentId: null };
      }
      if (value.segmentId === floatingCaptionState.current.segmentId) {
        floatingCaptionState.current.translation = value.translation;
      } else if (value.segmentId === floatingCaptionState.lastFinalized.segmentId) {
        floatingCaptionState.lastFinalized.translation = value.translation;
      } else {
        // Store as pending if doesn't match current segments
        floatingCaptionState.pendingTranslation = {
          segmentId: value.segmentId,
          text: value.translation,
        };
      }
    }

    if (value.translationPending !== undefined && value.segmentId !== undefined) {
      floatingCaptionState.translationPending = {
        segmentId: value.translationPending ? value.segmentId : null,
      };
    }

    if (value.locale !== undefined) floatingCaptionState.locale = value.locale;
    if (value.theme) floatingCaptionState.theme = value.theme;

    sendFloatingCaptionState();
    return true;
  });

  handleIpc('floating-caption.move', async (_, payload) => {
    const value = z.object({ deltaX: z.number(), deltaY: z.number() }).parse(payload ?? {});
    if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
      const bounds = floatingCaptionWindow.getBounds();
      await floatingCaptionWindow.setBounds({
        x: bounds.x + Math.round(value.deltaX),
        y: bounds.y + Math.round(value.deltaY),
      });
    }
    return true;
  });

  handleIpc('floating-caption.set-always-on-top', (_, payload) => {
    const value = z.object({ alwaysOnTop: z.boolean() }).parse(payload ?? {});
    if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
      floatingCaptionWindow.setAlwaysOnTop(value.alwaysOnTop, 'screen-saver');
    }
    return value.alwaysOnTop;
  });
}

function checkForUpdate() {
  return app.nativeUpdate('check');
}

async function installUpdate() {
  if (!['darwin', 'win32', 'linux'].includes(process.platform) || !app.isPackaged) return false;

  const requireIdle = async () => {
    const modelsIdle = await worker.request('models.can-relocate');
    if (
      !modelsIdle ||
      quitRequested ||
      app.isQuitting ||
      worker.active ||
      refinementWorker.active ||
      worker.starting ||
      refinementWorker.starting ||
      worker.pending.size ||
      refinementWorker.pending.size ||
      storageMigrationInProgress ||
      destructiveOperationInProgress ||
      [...(mobileServer?.sessions.values() || [])].some(
        (session) => !session.finished || ['queued', 'running'].includes(session.task?.state),
      )
    )
      throw Object.assign(new Error('Finish recording and background tasks before updating'), {
        code: 'error.tasks.running',
      });
  };
  await requireIdle();
  let disabledWindow;
  let downloaded = false;
  try {
    await app.nativeUpdate('download');
    downloaded = true;
    await requireIdle();
    // 下载期间仍可开始会议或编辑笔记；进入系统安装阶段前需确认存盘及空闲状态。
    const window = desktop.mainWindow;
    if (window && !window.isDestroyed() && window.isEnabled()) {
      window.setEnabled(false);
      disabledWindow = window;
    }
    if (desktop.state && !window?.webContents.isCrashed()) await desktop.action('flush');
    if (quitRequested || quittingAfterMeetingStop || app.isQuitting)
      throw new Error('Application is shutting down');
    app.preparingUpdate = true;
    // 手机建会在模型检查和写入 session 之间也有异步磁盘操作。
    await mobileServer?.queue;
    await requireIdle();
    // 安装器接管前先完成落盘；macOS 由宿主应用更新和重启。
    if (process.platform === 'win32')
      await Promise.all([worker.stopForMigration(), refinementWorker.stopForMigration()]);
    await app.nativeUpdate('install');
    installingUpdate = true;
    app.relaunch();
    app.quit();
    return true;
  } catch (error) {
    if (downloaded) await app.nativeUpdate('discard').catch(console.error);
    app.preparingUpdate = false;
    installingUpdate = false;
    if (disabledWindow && !disabledWindow.isDestroyed()) disabledWindow.setEnabled(true);
    if (disabledWindow?.isDestroyed() && !desktop.mainWindow && !app.isQuitting) {
      // macOS 原生安装会先关闭窗口。重启失败时恢复入口，原来的 IPC 调用者已经销毁。
      createWindow().webContents.once('did-finish-load', () => reportMainError(error));
    }
    throw error;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowScale = Math.min(0.9, width / 1280, height / 800);
  const window = new NativeWindow({
    width: Math.round(1280 * windowScale),
    height: Math.round(800 * windowScale),
    minWidth: Math.round(880 * windowScale),
    minHeight: Math.round(640 * windowScale),
  });
  let pageReady = false;
  let animationComplete = false;
  let initializationReady = false;
  let revealed = false;
  let reloadRevealTimer;
  const revealApp = () => {
    if (
      !pageReady ||
      !animationComplete ||
      !initializationReady ||
      revealed ||
      window.isDestroyed()
    )
      return;
    revealed = true;
    window.webContents.send('brevia:event', { type: 'startup.ready' });
  };
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(windowScale);
    pageReady = true;
    if (!process.argv.includes('--background')) window.show();
    if (revealed) {
      clearTimeout(reloadRevealTimer);
      reloadRevealTimer = setTimeout(() => {
        if (!window.isDestroyed())
          window.webContents.send('brevia:event', { type: 'startup.ready' });
      }, startupAnimationMs);
    } else revealApp();
  });
  window.loadFile(
    path.join(packagedRoot, 'frontend', 'index.html'),
    resetOnboarding ? { query: { resetOnboarding: '1' } } : undefined,
  );
  setTimeout(() => {
    animationComplete = true;
    revealApp();
  }, startupAnimationMs);
  void Promise.race([
    initializeWorker(),
    new Promise((resolve) => setTimeout(resolve, startupDataWaitMs)),
  ])
    .catch((error) => reportMainError(error))
    .then(() => {
      initializationReady = true;
      revealApp();
    });
  desktop.attach(window);
  window.on('close', (event) => {
    if (app.isQuitting || installingUpdate) return;
    event.preventDefault();
    if (desktop.preferences.closeBehavior === 'hide') {
      try {
        desktop.hideMain();
      } catch (error) {
        reportMainError(error);
      }
    } else app.quit();
  });
  window.on('closed', () => {
    closeFloatingCaption();
  });
  return window;
}

let floatingCaptionWindow = null;
let floatingCaptionReady = false;
const floatingCaptionState = {
  lastFinalized: { segmentId: null, text: '', translation: null },
  current: { segmentId: null, text: '', isRefined: false, translation: null },
  pendingTranslation: { segmentId: null, text: null },
  translationPending: { segmentId: null },
  locale: 'zh',
};
const floatingCaptionPayload = z
  .object({
    segmentId: z.string().max(200).nullable().optional(),
    text: z.string().max(4000).optional(),
    translation: z.string().max(4000).nullable().optional(),
    isRefined: z.boolean().optional(),
    finalize: z.boolean().optional(),
    updateFinalized: z.boolean().optional(),
    clearCurrentIfMatch: z.boolean().optional(),
    theme: z.enum(['light', 'dark']).optional(),
    translationPending: z.boolean().optional(),
    locale: z.string().max(16).optional(),
  })
  .strict();

function resetFloatingCaptionState() {
  floatingCaptionState.lastFinalized = { segmentId: null, text: '', translation: null };
  floatingCaptionState.current = { segmentId: null, text: '', isRefined: false, translation: null };
  floatingCaptionState.pendingTranslation = { segmentId: null, text: null };
  floatingCaptionState.translationPending = { segmentId: null };
  sendFloatingCaptionState();
}

function sendFloatingCaptionState() {
  if (!floatingCaptionWindow || floatingCaptionWindow.isDestroyed() || !floatingCaptionReady)
    return;
  // Send the entire state structure - the renderer knows how to handle it
  floatingCaptionWindow.webContents.send('floating-caption:update', {
    lastFinalized: floatingCaptionState.lastFinalized,
    current: floatingCaptionState.current,
    pendingTranslation: floatingCaptionState.pendingTranslation,
    translationPending: floatingCaptionState.translationPending,
    locale: floatingCaptionState.locale,
    theme: floatingCaptionState.theme,
  });
}

let floatingCaptionBounds = null;

function showFloatingCaption() {
  // Reuse existing window if it's still valid
  if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
    floatingCaptionWindow.showInactive();
    return true;
  }

  // Clear stale reference if window was destroyed
  if (floatingCaptionWindow) {
    floatingCaptionWindow = null;
    floatingCaptionReady = false;
  }

  const mainWindow = desktop.mainWindow;
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const { workArea } = display;
  const width = Math.min(660, workArea.width - 32);
  const height = 156;

  // Restore saved position or use default centered position
  const savedBounds =
    floatingCaptionBounds && screen.getDisplayMatching(floatingCaptionBounds).id === display.id
      ? floatingCaptionBounds
      : null;
  const x = savedBounds?.x ?? Math.round(workArea.x + (workArea.width - width) / 2);
  const y = savedBounds?.y ?? Math.round(workArea.y + workArea.height - height - 60);

  floatingCaptionReady = false;
  const captionWindow = (floatingCaptionWindow = new NativeWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
  }));

  captionWindow.webContents.on('did-finish-load', () => {
    if (floatingCaptionWindow !== captionWindow) return;
    floatingCaptionReady = true;
    sendFloatingCaptionState();
    if (!captionWindow.isDestroyed()) {
      captionWindow.showInactive();
    }
  });

  // Save position before window is destroyed
  captionWindow.on('close', () => {
    if (floatingCaptionWindow === captionWindow && !captionWindow.isDestroyed()) {
      floatingCaptionBounds = captionWindow.getBounds();
    }
  });

  captionWindow.on('closed', () => {
    if (floatingCaptionWindow !== captionWindow) return;
    floatingCaptionWindow = null;
    floatingCaptionReady = false;

    // Notify all windows that floating caption was closed
    NativeWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('brevia:event', {
          type: 'floating-caption.closed',
          payload: {},
        });
      }
    });
  });
  void captionWindow.loadFile(path.join(packagedRoot, 'frontend', 'floating-caption.html'));
  return true;
}

async function closeFloatingCaption() {
  if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
    // Save position before closing
    floatingCaptionBounds = floatingCaptionWindow.getBounds();
    const closing = floatingCaptionWindow;
    await new Promise((resolve) => {
      closing.once('closed', resolve);
      closing.close();
    });
  }
  return true;
}

app.on('host-disconnected', () => {
  for (const client of [worker, refinementWorker]) stopProcess(client.process);
});
app.whenReady().then(async () => {
  let agentRecording;
  try {
    agentService = new AgentService({
      root: dataDir(),
      request: (type, payload) => worker.request(type, payload),
      status: () => ({ version: app.getVersion(), active: worker.active, native: true }),
      devices: async () => ({
        computer: await nativeAudio.query('devices'),
        mobile: mobileServer.status(),
      }),
      recording: async (payload) => agentRecording(payload),
    });
    await agentService.listen();
    await migrateDataDir();
    await applyPendingMove(dataDir());
  } catch (error) {
    dialog.showErrorBox(
      mainText('error.storage_recovery'),
      `${mainText('error.storage_recovery_hint')}\n\n${error.message}`,
    );
    app.quit();
    return;
  }
  if (modelsDir() !== path.join(dataDir(), 'models') && !existsSync(modelsDir())) {
    dialog.showErrorBox(mainText('error.storage_unavailable'), modelsDir());
    app.quit();
    return;
  }
  if (recordingsDir() !== path.join(dataDir(), 'meetings') && !existsSync(recordingsDir())) {
    dialog.showErrorBox(mainText('error.storage_unavailable'), recordingsDir());
    app.quit();
    return;
  }
  registerNoteImageProtocol();
  mobileServer = new MobileServer({
    // 端到端测试使用临时端口，避免与正在运行的桌面端争用。
    port: process.env.BREVIA_MOBILE_PORT === '0' ? 0 : undefined,
    directory: path.join(dataDir(), 'mobile'),
    active: () =>
      worker.active ||
      ((app.preparingUpdate || storageMigrationInProgress || destructiveOperationInProgress) && {
        busy: true,
      }),
    discovered: () => worker.sendEvent('mobile.discovered', {}),
    changed: (value = {}) => worker.sendEvent('mobile.collaboration', value),
    request: async (type, payload) => {
      if (storageMigrationInProgress || destructiveOperationInProgress)
        throw new Error('电脑正在移动或清理数据，请稍后重试');
      if (type === 'mobile.document.open') {
        const value = id
          .extend({ content: z.enum(['notes', 'mynotes']), format: z.enum(['docx', 'pdf']) })
          .parse(payload);
        const root = await meetingFilesRoot(value.meeting_id);
        const exported = await prepareExport({ ...value, filename_prefix: randomUUID() + '-' });
        const source = fileURLToPath(await audioFileURL(exported.path, [root]));
        if (
          path.dirname(source) !== path.join(root, 'exports') ||
          path.extname(source) !== '.' + value.format
        )
          throw new Error('Invalid export file');
        const handle = await open(source, 'r');
        // 响应通过文件句柄发送，只移除此请求创建的临时导出。
        try {
          await rm(source);
          return handle;
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      if (type === 'mobile.audio.open') {
        const root = await meetingFilesRoot(payload.meeting_id);
        const source = fileURLToPath(await audioFileURL(payload.path, [root]));
        if (!source.endsWith('.wav')) throw new Error('Invalid audio file');
        return open(source, 'r');
      }
      if (type === 'mobile.image.save') return saveNoteImage(payload);
      if (type === 'mobile.image.read') {
        const { image, type: mime_type } = await readNoteImage(
          payload.meeting_id,
          payload.filename,
        );
        return { mime_type, base64: image.toString('base64') };
      }
      if (type === 'mobile.summary') {
        const config = (await readSummaryConfig()) || { provider: 'built-in', providers: {} };
        const models =
          config.provider === 'built-in' ? await worker.request('models.list', {}) : [];
        const ready = models.filter(
          (m) => m.status === 'ready' && m.path && m.kind === 'llama-chat',
        );
        const service = configuredSummaryProvider(config, ready[0]?.id);
        if (
          !service ||
          (service.provider === 'built-in' && !ready.some((m) => m.id === service.model))
        )
          throw Object.assign(new Error('请先在电脑配置纪要模型'), { status: 409 });
        const { provider, model, endpoint, format, keyReference } = service;
        const api_key = await getSecret(keyReference);
        if (provider !== 'built-in' && (!api_key || payload.consent !== true))
          throw Object.assign(new Error('请先在电脑配置纪要模型和在线服务密钥'), { status: 409 });
        return worker.request('summary.generate', {
          meeting_id: payload.meeting_id,
          provider,
          model,
          endpoint,
          format,
          api_key,
          language: payload.language || app.getLocale().split('-')[0],
          consent: true,
        });
      }
      if (type === 'meeting.refine') return handleRefinement(payload);
      const result = await worker.request(type, payload);
      if (type === 'mobile.apply') {
        if (payload.action === 'end') {
          worker.active = null;
          worker.recycle();
        } else
          worker.active = { meeting_id: payload.meeting_id, started_at: Date.now(), mobile: true };
      }
      return result;
    },
    approve: ({ name, verification }) =>
      new Promise((resolve) => {
        const id = randomUUID();
        const timeout = setTimeout(() => finish(false), 120000);
        function finish(allowed) {
          clearTimeout(timeout);
          if (mobileApproval?.id === id) mobileApproval = null;
          resolve(allowed);
        }
        mobileApproval = { id, name, verification, resolve: finish };
        worker.sendEvent('mobile.discovered', {});
      }),
  });
  try {
    await mobileServer.init();
  } catch (error) {
    writeLog('ERROR', `mobile service: ${error.message}`);
  }
  worker.start();
  registerIpc();
  agentRecording = createRecordingController({
    worker,
    mobileServer,
    nativeAudio,
    desktop,
    parseStart: async (payload) => {
      const models = await worker.request('models.list', {});
      const modelId =
        payload.refined_model_id ||
        defaultRefinedModelId({
          catalog: models,
          language: payload.language || 'auto',
          installed: new Set(
            models.filter((model) => model.status === 'ready').map((model) => model.id),
          ),
        });
      if (!modelId) throw new Error('No transcription model supports the requested language');
      return meetingStart.parse({
        ...payload,
        title: payload.title || 'Brevia Agent',
        refined_model_id: modelId,
      });
    },
    parseAudio: (payload) => audio.parse(payload),
    resetCaptions: resetFloatingCaptionState,
  });
  void initializeWorker()
    .then(() => {
      agentService.ready = true;
    })
    .catch((error) => reportMainError(error));
  await desktop.load();
  createWindow();
  app.on('activate', () => {
    const mainWindow = desktop.mainWindow;
    if (mainWindow) {
      // Restore and focus main window when dock icon is clicked
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    } else {
      // No main window exists, create one
      createWindow();
    }
  });
});
let quittingAfterMeetingStop = false;
let quitRequested = false;
let installingUpdate = false;
let stoppingForSleep = false;
async function stopActiveMeeting() {
  const active = worker.active;
  if (!active) return;
  if (active.mobile) return; // Durable mobile spool is resumed after PC wake/restart.
  if (nativeAudio)
    try {
      await nativeAudio.command('stop');
    } catch (error) {
      writeLog('WARNING', `stop native recorder: ${logText(error)}`);
      worker.sendEvent('native-audio.error', { message: error.message });
    }
  await worker.request('meeting.stop', {
    meeting_id: active.meeting_id,
    duration_ms: Math.max(0, Date.now() - active.started_at),
  });
  if (worker.active === active) worker.active = null;
}
async function stopActiveMeetingForSleep() {
  if (stoppingForSleep || !worker.active) return;
  stoppingForSleep = true;
  try {
    await stopActiveMeeting();
  } catch (error) {
    writeLog('WARNING', `stop meeting for system sleep: ${logText(error)}`);
  } finally {
    stoppingForSleep = false;
  }
}
powerMonitor.on('suspend', () => {
  void stopActiveMeetingForSleep();
});
app.on('before-quit', (event) => {
  // Squirrel 尚在准备时不能让普通退出隐式安装，只有系统确认的更新退出才可放行。
  if (app.preparingUpdate && !installingUpdate) {
    event.preventDefault();
    return;
  }
  if (quittingAfterMeetingStop || installingUpdate) {
    app.isQuitting = true;
    stopProcess(worker.process);
    stopProcess(refinementWorker.process);
    // Node 退出后定时器不再运行；退出前收尾已发送 SIGTERM 的所有进程组。
    for (const pid of stoppingProcessGroups) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* 已退出。 */
      }
    }
    stoppingProcessGroups.clear();
    return;
  }
  event.preventDefault();
  if (quitRequested) return;
  quitRequested = true;
  void (async () => {
    try {
      const rendererCrashed = desktop.mainWindow?.webContents?.isCrashed?.();
      if (desktop.state && !rendererCrashed) await desktop.action('flush');
      if (worker.active) {
        const t = (key) => desktop.text(key, desktop.state?.locale);
        const quitMeetingId = desktop.state?.meetingId;
        let confirmed;
        if (rendererCrashed || !desktop.state) {
          const result = await dialog.showMessageBox(desktop.mainWindow, {
            type: 'question',
            title: t('退出 Brevia'),
            message: t('结束录音并退出 Brevia？'),
            detail: `${desktop.state?.title || 'Brevia'}\n${t('退出前会结束并保存当前录音。')}`,
            buttons: [t('继续录音'), t('结束并退出')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          confirmed = result.response === 1;
        } else confirmed = await desktop.action('confirm-quit');
        if (!confirmed) return;
        if (rendererCrashed || !desktop.state) await stopActiveMeeting();
        else await desktop.action('stop', { meetingId: quitMeetingId });
        // 手机结束为异步补传，不能把已发送停止指令当作已保存。
        if (worker.active) throw new Error(t('录音仍在保存，请稍后重试退出'));
      }
      quittingAfterMeetingStop = true;
      app.quit();
    } catch (error) {
      reportMainError(error);
      desktop.showMain();
    } finally {
      quitRequested = false;
    }
  })();
});
app.on('window-all-closed', () => {
  // macOS 原生更新会先关闭全部窗口，再由 Squirrel 决定重启或报告错误。
  if (!installingUpdate) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void agentService?.close();
});
