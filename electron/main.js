const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, powerMonitor, screen, session, ShareMenu, shell, systemPreferences } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { z } = require('zod');
const { configureMacUpdater, createDisplayMediaHandler, isNewerVersion, registerScreenPermission, systemAudioSupported } = require('./main-logic');

const releasesUrl = 'https://github.com/zerolovesea/Brevia/releases/latest';

if (process.platform === 'darwin') app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

const root = path.join(__dirname, '..');
const packagedRoot = app.isPackaged ? process.resourcesPath : root;
const startupAnimationMs = 1700;
const startupDataWaitMs = 2200;
const workerLineLimit = 8 * 1024 * 1024;
const workerRequestTimeouts = new Map([
  ['meeting.audio', 15000],
  ['meeting.get', 15000],
  ['models.download', 15000], ['models.pause', 15000], ['models.cancel', 15000],
  ['task.pause', 15000], ['task.resume', 15000], ['task.cancel', 15000],
]);
const resetOnboarding = process.argv.includes('--reset-onboarding');
const dataDir = () => process.env.BREVIA_DATA_DIR || path.join(app.getPath('home'), 'brevia');
const legacyDataDir = () => app.getPath('userData');
const logsDir = () => path.join(dataDir(), 'logs');
const logFile = () => path.join(logsDir(), 'brevia.log');
const logText = (value) => value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value);
const powerStatus = async () => {
  if (!powerMonitor.isOnBatteryPower()) return { on_battery: false, low_battery: false };
  if (process.platform !== 'darwin') return { on_battery: true, low_battery: false };
  return new Promise((resolve) => {
    execFile('pmset', ['-g', 'batt'], (error, stdout = '') => {
      const percentage = Number(/(\d+)%/.exec(stdout)?.[1]);
      resolve({ on_battery: true, low_battery: Number.isFinite(percentage) && percentage <= 20 });
    });
  });
};
const bundledFfmpegPath = () => {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : root;
  const binary = path.join(base, 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return existsSync(binary) ? binary : '';
};
const writeLog = (level, value) => {
  const line = `${new Date().toISOString()} [${level}] ${logText(value).trim()}\n`;
  void mkdir(logsDir(), { recursive: true }).then(() => appendFile(logFile(), line, 'utf8')).catch((error) => console.error('Log write failed', error));
};
const stopProcess = (child) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
  else child.kill();
};
const migrateDataDir = async () => {
  if (process.env.BREVIA_DATA_DIR) return;
  const source = legacyDataDir();
  if (!existsSync(source) || existsSync(path.join(dataDir(), 'brevia.db'))) return;
  await mkdir(dataDir(), { recursive: true });
  for (const name of ['advanced-settings.json', 'brevia.db', 'brevia.db-shm', 'brevia.db-wal', 'meetings', 'models', 'speaker-profiles', 'summary-models.json', 'secrets', 'logs']) {
    const from = path.join(source, name);
    const to = path.join(dataDir(), name);
    if (!existsSync(from) || existsSync(to)) continue;
    await rename(from, to);
  }
};
app.setAppLogsPath(logsDir());
const command = z.object({ type: z.string().min(1), payload: z.record(z.string(), z.unknown()).default({}) });
const workerResponse = z.discriminatedUnion('ok', [
  z.object({ id: z.string().min(1), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ id: z.string().min(1), ok: z.literal(false), error: z.string() }).strict(),
]);
const workerEvent = z.object({
  type: z.enum([
    'app.maintenance', 'meeting.imported', 'meeting.reconfigured', 'meeting.recovered',
    'meeting.sources-separated', 'meeting.started',
    'meeting.stopped', 'model.progress', 'model.status', 'refinement.cancelled', 'refinement.progress',
    'refinement.ready', 'refinement.started', 'separation.progress',
    'separation.started', 'speaker-profile.deleted', 'speaker-profile.updated',
    'summary.progress', 'summary.ready', 'summary.started', 'task.status',
    'transcript.discarded', 'transcript.final', 'transcript.partial', 'transcript.refined',
    'translation.ready', 'worker.error', 'worker.warning',
  ]),
  schema_version: z.literal(1),
  payload: z.record(z.string(), z.unknown()),
}).strict();
const workerMessage = z.union([workerResponse, workerEvent]);
const meetingStart = z.object({
  title: z.string().trim().min(1).max(120),
  language: z.string().min(2).max(16),
  target_language: z.string().max(16).nullable().optional(),
  streaming_model_id: z.string().min(1),
  refined_model_id: z.string().min(1),
  speaker_segmentation_model_id: z.string().min(1).optional(),
  vad_model_id: z.string().min(1).optional(),
  num_speakers: z.number().int().refine((value) => value === -1 || value >= 1).optional(),
  power_saving: z.boolean().optional(),
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
const meetingUpdates = z.object({
  title: z.string().trim().min(1).max(120),
  tags: z.array(z.string().max(32)).max(20),
  archived_at: z.string().max(64).nullable(),
  refined_model_id: z.string().min(1).max(128),
}).partial();
const meetingReconfigure = id.extend({
  language: z.string().min(2).max(16).optional(),
  target_language: z.string().max(16).nullable().optional(),
  streaming_model_id: z.string().min(1).max(128).optional(),
  refined_model_id: z.string().min(1).max(128).optional(),
  power_saving: z.boolean().optional(),
});
// 纪要供应商固定为这六项；只有 built-in 在本地运行，因此其余都必须带请求地址。
const summaryProviderIds = ['built-in', 'claude', 'openai', 'openrouter', 'custom-openai', 'custom-claude'];
const isBuiltInProvider = (provider) => provider.toLowerCase() === 'built-in';
const requiresEndpoint = (provider) => !isBuiltInProvider(provider);
const summaryProviderEntry = z.object({
  model: z.string().trim().min(1).max(128),
  endpoint: z.string().url().optional(),
  keyReference: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  keyLength: z.number().int().positive().max(512).optional(),
});
const llmRequest = z.object({
  provider: z.string().trim().min(1), endpoint: z.string().url().optional(), model: z.string().trim().min(1),
  format: z.enum(['openai', 'claude']).optional(), key_reference: z.string().optional(),
}).refine(({ provider, endpoint }) => !requiresEndpoint(provider) || Boolean(endpoint), {
  message: 'Endpoint is required for remote providers', path: ['endpoint'],
});
// 单套生效配置，但每个供应商的模型/地址/密钥引用分别留存，切换供应商不会丢已填内容。
const summaryConfig = z.object({
  version: z.literal(2),
  provider: z.enum(summaryProviderIds),
  // partialRecord：只有用户配置过的供应商才出现在这里；z.record 在 zod 4 里要求键穷尽。
  providers: z.partialRecord(z.enum(summaryProviderIds), summaryProviderEntry),
});

class WorkerClient {
  constructor({ refinement = false } = {}) {
    this.pending = new Map();
    this.sequence = 0;
    this.restarts = 0;
    this.active = null;
    this.starting = null;
    this.refinement = refinement;
    this.recycleRequested = false;
    this.hasSpawned = false;
  }

  start() {
    if (this.process?.stdin && !this.process.stdin.destroyed && this.process.exitCode === null) return Promise.resolve();
    if (this.starting) return this.starting;
    const workerName = process.platform === 'win32' ? 'brevia-worker.exe' : 'brevia-worker';
    const bundled = path.join(packagedRoot, 'backend', 'runtime', 'brevia-worker', workerName);
    const useBundledWorker = app.isPackaged && !process.env.BREVIA_PYTHON && existsSync(bundled);
    const python = useBundledWorker ? bundled : (process.env.BREVIA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'));
    const args = useBundledWorker ? [] : ['-m', 'backend.worker'];
    const ffmpeg = process.env.BREVIA_FFMPEG || bundledFfmpegPath();
    const recoverInterrupted = !this.refinement && !this.hasSpawned;
    const child = spawn(python, args, {
      cwd: packagedRoot,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        BREVIA_DATA_DIR: dataDir(),
        BREVIA_MODELS_DIR: process.env.BREVIA_MODELS_DIR || path.join(dataDir(), 'models'),
        BREVIA_BUNDLED_MODELS_DIR: path.join(packagedRoot, 'backend', 'bundled-models'),
        BREVIA_RECOVER_INTERRUPTED: recoverInterrupted ? '1' : '0',
        ...(ffmpeg ? { BREVIA_FFMPEG: ffmpeg } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.starting = new Promise((resolve, reject) => {
      child.once('spawn', () => { this.hasSpawned = true; resolve(); });
      child.once('error', reject);
    }).finally(() => { this.starting = null; });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
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
        try { this.receive(workerMessage.parse(JSON.parse(line))); }
        catch (error) {
          writeLog('ERROR', error);
          this.fail(error);
          this.sendEvent('worker:log', { message: `Invalid worker output: ${error.message}` });
        }
      });
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (message) => {
      writeLog('WARNING', message);
      this.sendEvent('worker:log', { message });
    });
    child.on('error', (error) => this.fail(error));
    child.on('exit', (code, signal) => this.closed(code, signal, child));
    return this.starting;
  }

  receive(message) {
    if (message.type === 'worker.error' || (message.type === 'model.status' && message.payload.status === 'failed')) writeLog('ERROR', message.payload);
    if (message.type === 'worker.warning') writeLog('WARNING', message.payload);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error));
      this.recycleIfIdle();
      return;
    }
    if (message.type) this.sendEvent(message.type, message.payload);
  }

  async request(type, payload = {}) {
    const value = command.parse({ type, payload });
    if (!this.process?.stdin || this.process.stdin.destroyed || this.process.exitCode !== null) {
      if (app.isQuitting) return Promise.reject(new Error('Worker is shutting down'));
      await this.start();
    }
    const requestId = `cmd-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = workerRequestTimeouts.get(type);
      const timer = timeout && setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(new Error(`Worker request timed out: ${type}`));
        this.recycleIfIdle();
      }, timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.process.stdin.write(`${JSON.stringify({ id: requestId, ...value })}\n`, (error) => {
          if (error) {
            this.pending.delete(requestId);
            clearTimeout(timer);
            reject(error);
          }
        });
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  sendEvent(type, payload) {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('brevia:event', { type, payload }));
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
    stopProcess(child);
  }

  fail(error) {
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(error);
    });
    this.pending.clear();
  }

  async closed(code, signal, child) {
    if (child !== this.process) return;
    this.process = null;
    if (app.isQuitting) return;
    const reason = signal || `code ${code}`;
    this.fail(new Error(`Worker exited with ${reason}`));
    this.sendEvent('worker.error', { message: `转写进程已退出（${reason}）` });
    if (this.refinement) {
      const meetingId = this.active?.meeting_id;
      this.active = null;
      if (meetingId) void worker.request('meeting.refinement-recover', { meeting_id: meetingId })
        .then((meeting) => this.sendEvent('refinement.cancelled', { meeting_id: meetingId, meeting }))
        .catch((error) => writeLog('ERROR', `recover refinement: ${logText(error)}`));
      return;
    }
    if (this.restarts >= 1) return;
    this.restarts += 1;
    this.start();
    if (!this.active) return;
    try {
      await this.request('meeting.resume', {
        meeting_id: this.active.meeting_id,
      });
      this.sendEvent('worker.recovered', { meeting_id: this.active.meeting_id });
    } catch (error) {
      this.sendEvent('worker.error', { message: `录音仍在本地保留，但转写无法恢复：${error.message}` });
    }
  }
}

const worker = new WorkerClient();
// 精修会长时间占用 ONNX 线程；独立进程保证会议列表和详情查询不会被它饿死。
const refinementWorker = new WorkerClient({ refinement: true });
let startupInitialization;
const supportsSystemAudio = () => systemAudioSupported(process.platform, os.release());

function reportMainError(error, fatal = false) {
  const message = error instanceof Error ? error.message : String(error);
  writeLog('ERROR', error);
  console.error(error);
  try { worker.sendEvent('worker.error', { message, fatal }); } catch { /* The app may not have a window yet. */ }
}

process.on('unhandledRejection', (error) => reportMainError(error));
process.on('uncaughtException', (error) => reportMainError(error, true));
process.on('warning', (warning) => writeLog('WARNING', warning));

function initializeWorker() {
  if (!startupInitialization) {
    startupInitialization = worker.request('app.initialize').catch((error) => {
      startupInitialization = null;
      throw error;
    });
  }
  return startupInitialization;
}

function handle(channel, schema, type = channel) {
  ipcMain.handle(channel, async (_, payload = {}) => {
    try {
      return await worker.request(type, schema.parse(payload));
    } catch (error) {
      writeLog('ERROR', `${type}: ${logText(error)}`);
      throw error;
    }
  });
}

function requiredModels(error) {
  const match = String(error.message).match(/Models? ([a-z0-9.-]+(?:, [a-z0-9.-]+)*) (?:is|are) not installed/i);
  return match ? match[1].split(', ') : null;
}

function handleModelRequirement(channel, schema, type = channel) {
  ipcMain.handle(channel, async (_, payload = {}) => {
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
  const value = id.extend({
    refined_model_id: z.string().min(1).optional(),
    num_speakers: z.number().int().refine((count) => count === -1 || count >= 1).optional(),
    cluster_threshold: z.number().min(0).max(2).optional(),
  }).parse(payload);
  if (refinementWorker.active) {
    if (refinementWorker.active.meeting_id === value.meeting_id) return refinementWorker.active.promise;
    return Promise.reject(new Error('Another meeting is already being refined'));
  }
  const active = { meeting_id: value.meeting_id, promise: null };
  refinementWorker.active = active;
  active.promise = refinementWorker.request('meeting.refine', value).catch((error) => {
    const models = requiredModels(error);
    if (!models) throw error;
    worker.sendEvent('model.required', { models, task: 'meeting.refine', payload: value });
    return { model_required: models };
  }).finally(() => {
    if (refinementWorker.active !== active) return;
    refinementWorker.active = null;
    refinementWorker.recycle();
  });
  return active.promise;
}

function handleTaskControl(channel, schema) {
  ipcMain.handle(channel, (_, payload) => {
    const value = schema.parse(payload);
    return (value.task === 'meeting.refine' ? refinementWorker : worker).request(channel, value);
  });
}

async function setSecret(reference, value) {
  const directory = path.join(dataDir(), 'secrets');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${reference}.key`), value, { encoding: 'utf8', mode: 0o600 });
}

async function getSecret(reference) {
  if (!reference) return '';
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
  const target = summaryConfigPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(summaryConfig.parse(config), null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function prepareExport(value) {
  const exported = await worker.request('meeting.export', value);
  if (!exported.print_pdf) return exported;
  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const pdfPath = exported.path.replace(/\.print\.html$/, '.pdf');
  try {
    await printWindow.loadFile(exported.path);
    await writeFile(pdfPath, await printWindow.webContents.printToPDF({
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="width:100%;text-align:center;opacity:.72"><svg width="98" height="28" viewBox="0 0 196 56" xmlns="http://www.w3.org/2000/svg" aria-label="Brevia"><rect width="56" height="56" fill="#000"/><text x="28" y="39" fill="#fff" font-family="PingFang SC,Hiragino Sans GB,Noto Sans CJK SC,sans-serif" font-size="28" font-weight="600" text-anchor="middle">言</text><text x="76" y="42" fill="#000" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" letter-spacing="-2">brevia</text></svg></div>',
      footerTemplate: '<div></div>',
    }));
    return { path: pdfPath, format: 'pdf' };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    await rm(exported.path, { force: true });
  }
}

function registerIpc() {
  ipcMain.handle('app.version', () => app.getVersion());
  ipcMain.handle('update.check', () => checkForUpdate());
  ipcMain.handle('update.install', () => installUpdate());
  ipcMain.handle('permissions.status', () => {
    if (process.platform === 'darwin') return { microphone: systemPreferences.getMediaAccessStatus('microphone'), screen: systemPreferences.getMediaAccessStatus('screen'), systemAudioSupported: supportsSystemAudio() };
    // Windows reports the real microphone privacy state; screen capture is not gated the same way.
    if (process.platform === 'win32') return { microphone: systemPreferences.getMediaAccessStatus('microphone'), screen: 'granted', systemAudioSupported: supportsSystemAudio() };
    return { microphone: 'granted', screen: 'granted', systemAudioSupported: supportsSystemAudio() };
  });
  ipcMain.handle('permissions.request-microphone', () => process.platform === 'darwin'
    ? systemPreferences.askForMediaAccess('microphone')
    // Windows has no runtime prompt; report whether the OS privacy toggle already allows access.
    : process.platform !== 'win32' || systemPreferences.getMediaAccessStatus('microphone') === 'granted');
  ipcMain.handle('permissions.open-screen-settings', async () => {
    if (process.platform !== 'darwin') return false;
    await registerScreenPermission(desktopCapturer, writeLog);
    const settings = spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'], { detached: true, stdio: 'ignore' });
    settings.unref();
    return true;
  });
  ipcMain.handle('permissions.open-microphone-settings', async () => {
    if (process.platform === 'darwin') {
      const settings = spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], { detached: true, stdio: 'ignore' });
      settings.unref();
      return true;
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone');
      return true;
    }
    return false;
  });
  ipcMain.handle('app.initialize', () => initializeWorker());
  ipcMain.handle('power.status', () => powerStatus());
  ipcMain.handle('app.maintain', async () => {
    if (app.isQuitting) return {};
    try {
      return await worker.request('app.maintain');
    } catch (error) {
      if (app.isQuitting) return {};
      writeLog('ERROR', `app.maintain: ${logText(error)}`);
      throw error;
    }
  });
  ipcMain.handle('meeting.start', async (_, payload) => {
    const value = meetingStart.parse(payload);
    let result;
    try {
      result = await worker.request('meeting.start', { ...value, require_models: true });
    } catch (error) {
      const models = requiredModels(error);
      if (!models) throw error;
      worker.sendEvent('model.required', { models, task: 'meeting.start', payload: value });
      return { model_required: models };
    }
    worker.active = { meeting_id: result.id, started_at: Date.now() };
    worker.restarts = 0;
    resetFloatingCaptionState();
    return result;
  });
  ipcMain.handle('meeting.import', async (_, payload) => {
    const value = meetingStart.extend({ path: z.string().min(1) }).parse(payload);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }] });
    if (selected.canceled) return null;
    const result = await worker.request('meeting.import', { ...value, path: selected.filePaths[0] });
    resetFloatingCaptionState();
    return result;
  });
  handle('meeting.audio', audio, 'meeting.audio');
  handle('meeting.pause', id.extend({ paused: z.boolean() }), 'meeting.pause');
  handleModelRequirement('meeting.reconfigure', meetingReconfigure, 'meeting.reconfigure');
  ipcMain.handle('meeting.stop', async (_, payload) => {
    const value = id.extend({ duration_ms: z.number().nonnegative() }).parse(payload);
    const result = await worker.request('meeting.stop', value);
    worker.active = null;
    worker.recycle();
    return result;
  });
  handle('meeting.list', z.object({ include_deleted: z.boolean().optional(), query: z.string().max(120).optional() }), 'meeting.list');
  handle('meeting.get', id, 'meeting.get');
  handle('meeting.update', id.extend({ updates: meetingUpdates }), 'meeting.update');
  handle('meeting.delete', id, 'meeting.delete');
  handle('meeting.restore', id, 'meeting.restore');
  handle('meeting.purge', id, 'meeting.purge');
  ipcMain.handle('meeting.refine', (_, payload) => handleRefinement(payload));
  handleModelRequirement('meeting.separate', id, 'meeting.separate');
  handle('workspace.list', z.object({}), 'workspace.list');
  handle('workspace.get', z.object({ workspace_id: z.string() }), 'workspace.get');
  handle('workspace.create', z.object({ name: z.string().trim().min(1).max(50), description: z.string().max(200).optional(), color: z.string().optional() }), 'workspace.create');
  handle('workspace.update', z.object({ workspace_id: z.string(), updates: z.object({ name: z.string().trim().min(1).max(50).optional(), description: z.string().max(200).optional(), color: z.string().optional() }) }), 'workspace.update');
  handle('workspace.delete', z.object({ workspace_id: z.string() }), 'workspace.delete');
  handle('workspace.assign', z.object({ meeting_id: z.string().uuid(), workspace_id: z.string().uuid().nullable() }), 'workspace.assign');
  handle('speaker.rename', id.extend({ speaker_id: z.string(), name: z.string().trim().min(1).max(32), locked: z.boolean().optional() }), 'speaker.rename');
  handle('speaker-profile.list', z.object({}), 'speaker-profile.list');
  handle('speaker-profile.samples', z.object({ profile_id: z.string().uuid() }), 'speaker-profile.samples');
  ipcMain.handle('speaker-profile.enroll', async (_, payload) => {
    const value = z.object({ profile_id: z.string().uuid().optional(), name: z.string().trim().min(1).max(32) }).parse(payload);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }] });
    if (selected.canceled) return null;
    return worker.request('speaker-profile.enroll', { ...value, path: selected.filePaths[0] })
      .finally(() => worker.recycle());
  });
  ipcMain.handle('speaker-profile.verify', async (_, payload) => {
    const value = z.object({ profile_id: z.string().uuid() }).parse(payload);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }] });
    if (selected.canceled) return null;
    return worker.request('speaker-profile.verify', { ...value, path: selected.filePaths[0] })
      .finally(() => worker.recycle());
  });
  handle('speaker-profile.delete', z.object({ profile_id: z.string().uuid() }), 'speaker-profile.delete');
  handle('speaker-profile.rename', z.object({ profile_id: z.string().uuid(), name: z.string().trim().min(1).max(32) }), 'speaker-profile.rename');
  handle('speaker-profile.sample-delete', z.object({ profile_id: z.string().uuid(), sample_id: z.string().uuid() }), 'speaker-profile.sample-delete');
  handle('storage.clear', z.object({ partition: z.enum(['meetings', 'models', 'exports']) }), 'storage.clear');
  handle('settings.advanced.get', z.object({}), 'settings.advanced.get');
  handle('settings.advanced.save', z.object({ settings: z.record(z.string(), z.unknown()) }), 'settings.advanced.save');
  ipcMain.handle('metrics.record', async (_, payload) => {
    if (app.isQuitting) return null;
    try {
      return await worker.request('metrics.record', z.object({ app_duration_ms: z.number().int().nonnegative().optional() }).parse(payload));
    } catch (error) {
      if (error.code === 'EPIPE' || app.isQuitting) return null;
      throw error;
    }
  });
  handle('segment.speaker', id.extend({ segment_id: z.string().min(1), name: z.string().trim().min(1).max(32), enroll: z.boolean().optional() }), 'segment.speaker');
  ipcMain.handle('segment.speaker-profile-sample', async (_, payload) => {
    const value = id.extend({ segment_id: z.string().min(1), profile_id: z.string().uuid() }).parse(payload);
    return worker.request('segment.speaker-profile-sample', value).finally(() => worker.recycle());
  });
  ipcMain.handle('storage.open', async (_, payload) => {
    const partition = z.enum(['meetings', 'models', 'exports']).parse(payload?.partition);
    const root = dataDir();
    const directory = partition === 'models' ? process.env.BREVIA_MODELS_DIR || path.join(root, 'models') : path.join(root, 'meetings');
    return shell.openPath(directory);
  });
  handle('models.list', z.object({}), 'models.list');
  handle('models.download', z.object({ model_id: z.string(), source: z.enum(['default', 'china']).optional() }), 'models.download');
  handle('models.pause', z.object({ model_id: z.string() }), 'models.pause');
  handle('models.cancel', z.object({ model_id: z.string() }), 'models.cancel');
  handle('models.delete', z.object({ model_id: z.string() }), 'models.delete');
  const taskControl = z.object({ task: z.enum(['meeting.refine', 'meeting.separate', 'summary.generate']), meeting_id: z.string() });
  handleTaskControl('task.pause', taskControl);
  handleTaskControl('task.resume', taskControl);
  handleTaskControl('task.cancel', taskControl);
  ipcMain.handle('secret.set', async (_, payload) => {
    const value = z.object({ reference: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), value: z.string().min(1) }).parse(payload);
    await setSecret(value.reference, value.value);
    return true;
  });
  ipcMain.handle('summary.config.get', async () => readSummaryConfig());
  ipcMain.handle('summary.config.save', async (_, payload) => {
    const config = summaryConfig.parse(payload);
    await writeSummaryConfig(config);
    return config;
  });
  ipcMain.handle('summary.generate', async (_, payload) => {
    const value = id.extend({
      ...llmRequest.shape,
      language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']).default('en'), consent: z.literal(true),
    }).refine(({ provider, endpoint }) => !requiresEndpoint(provider) || Boolean(endpoint), {
      message: 'Endpoint is required for remote providers', path: ['endpoint'],
    }).parse(payload);
    const api_key = await getSecret(value.key_reference);
    if (!api_key && !isBuiltInProvider(value.provider)) return { configuration_required: true };
    return worker.request('summary.generate', { ...value, api_key });
  });
  ipcMain.handle('translation.generate', async (_, payload) => {
    const value = id.extend({
      segment_id: z.string(),
      segment: z.object({
        text: z.string().trim().min(1), start_ms: z.number().nonnegative(), end_ms: z.number().nonnegative(),
        speaker: z.string().trim().min(1).max(128), track: z.string().trim().min(1).max(32), revision: z.number().int().nonnegative(),
      }).optional(),
      target_language: z.string().min(2).max(32),
      consent: z.literal(true),
    }).parse(payload);
    return worker.request('translation.generate', value);
  });
  ipcMain.handle('meeting.export', async (_, payload) => {
    const value = id.extend({
      content: z.enum(['transcript', 'notes', 'audio']).optional(),
      format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'flac', 'wav', 'm4a']),
      track: z.enum(['mix', 'mic', 'system', 'vocals', 'accompaniment']).optional(),
    }).parse(payload);
    const exported = await prepareExport(value);
    const destination = await dialog.showSaveDialog({ defaultPath: path.basename(exported.path) });
    if (destination.canceled) return null;
    await copyFile(exported.path, destination.filePath);
    return { ...exported, path: destination.filePath };
  });
  ipcMain.handle('meeting.export-many', async (_, payload) => {
    const value = z.object({ meeting_ids: z.array(z.string().uuid()).min(1).max(200), format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'flac', 'wav', 'm4a']).default('md') }).parse(payload);
    const destination = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (destination.canceled) return null;
    const paths = [];
    for (const meetingId of value.meeting_ids) {
      const exported = await prepareExport({ meeting_id: meetingId, content: ['flac', 'wav', 'm4a'].includes(value.format) ? 'audio' : 'transcript', format: value.format });
      const parsed = path.parse(exported.path);
      let target = path.join(destination.filePaths[0], parsed.base);
      for (let copy = 2; existsSync(target); copy += 1) target = path.join(destination.filePaths[0], `${parsed.name}-${copy}${parsed.ext}`);
      await copyFile(exported.path, target);
      paths.push(target);
    }
    return { paths, format: value.format };
  });
  ipcMain.handle('meeting.share', async (_, payload) => {
    const exported = await worker.request('meeting.bundle', id.parse(payload));
    const destination = await dialog.showSaveDialog({ defaultPath: path.basename(exported.path) });
    if (destination.canceled) return null;
    await copyFile(exported.path, destination.filePath);
    return { ...exported, path: destination.filePath };
  });
  ipcMain.handle('share.copy-text', (_, payload) => {
    const value = z.object({ text: z.string().min(1).max(200000) }).parse(payload);
    clipboard.writeText(value.text);
    return { copied: true };
  });
  ipcMain.handle('share.open-external', async (_, payload) => {
    const value = z.object({ url: z.string().min(1).max(8000) }).parse(payload);
    // 仅放行社交网页分享(https)与邮件(mailto)。其余 scheme 一律拒绝,避免通过 IPC 触发任意协议处理器。
    if (!/^(https:\/\/|mailto:)/i.test(value.url)) throw new Error('Unsupported share URL');
    await shell.openExternal(value.url);
    return { opened: true };
  });
  ipcMain.handle('share.file', async (_, payload) => {
    const value = z.object({
      meeting_id: z.string().uuid(),
      kind: z.enum(['export', 'bundle']).default('export'),
      content: z.enum(['transcript', 'notes', 'audio']).optional(),
      format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'flac', 'wav', 'm4a']).optional(),
      track: z.enum(['mix', 'mic', 'system', 'vocals', 'accompaniment']).optional(),
    }).parse(payload);
    // 与「导出」不同:直接写入会议的 exports 目录并在文件管理器中高亮,供用户手动拖入微信等无 API 平台。
    const exported = value.kind === 'bundle'
      ? await worker.request('meeting.bundle', { meeting_id: value.meeting_id })
      : await prepareExport({ meeting_id: value.meeting_id, content: value.content, format: value.format || 'md', ...(value.track ? { track: value.track } : {}) });
    shell.showItemInFolder(exported.path);
    return { ...exported, revealed: true };
  });
  // 系统原生分享面板(NSSharingServicePicker)。仅 macOS 提供;可分享纯文本或先导出的文件,
  // 用户从面板选 AirDrop / 信息 / 邮件 / 备忘录,以及任何注册了分享扩展的 App(如微信)。
  ipcMain.handle('share.system', async (event, payload) => {
    if (process.platform !== 'darwin' || typeof ShareMenu !== 'function') throw new Error('System share is only available on macOS');
    const value = z.object({
      text: z.string().min(1).max(200000).optional(),
      anchor: z.object({ x: z.number().int().min(0).max(100000), y: z.number().int().min(0).max(100000) }).optional(),
      file: z.object({
        meeting_id: z.string().uuid(),
        kind: z.enum(['export', 'bundle']).default('export'),
        content: z.enum(['transcript', 'notes', 'audio']).optional(),
        format: z.enum(['md', 'txt', 'json', 'srt', 'docx', 'pdf', 'flac', 'wav', 'm4a']).optional(),
        track: z.enum(['mix', 'mic', 'system', 'vocals', 'accompaniment']).optional(),
      }).optional(),
    }).refine((v) => v.text || v.file, { message: 'Nothing to share' }).parse(payload);
    const sharingItem = {};
    if (value.text) sharingItem.texts = [value.text];
    if (value.file) {
      const exported = value.file.kind === 'bundle'
        ? await worker.request('meeting.bundle', { meeting_id: value.file.meeting_id })
        : await prepareExport({ meeting_id: value.file.meeting_id, content: value.file.content, format: value.file.format || 'md', ...(value.file.track ? { track: value.file.track } : {}) });
      sharingItem.filePaths = [exported.path];
    }
    const window = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('No window to anchor the share menu');
    // 传入按钮坐标(相对窗口内容区),弹窗锚定在按钮处;无坐标时回退到窗口默认位置。
    new ShareMenu(sharingItem).popup({ window, ...(value.anchor ? { x: value.anchor.x, y: value.anchor.y } : {}) });
    return { shared: true };
  });
  ipcMain.handle('shell.showItem', (_, filePath) => shell.showItemInFolder(z.string().parse(filePath)));
  ipcMain.handle('audio.url', (_, filePath) => {
    const resolved = path.resolve(z.string().parse(filePath));
    if (!resolved.startsWith(`${path.resolve(dataDir())}${path.sep}`)) throw new Error('Invalid audio path');
    return pathToFileURL(resolved).href;
  });
  ipcMain.handle('floating-caption.show', () => { resetFloatingCaptionState(); return showFloatingCaption(); });
  ipcMain.handle('floating-caption.close', () => closeFloatingCaption());
  ipcMain.handle('floating-caption.update', (_, payload) => {
    const value = floatingCaptionPayload.parse(payload ?? {});

    // Handle finalize: move current → lastFinalized
    if (value.finalize) {
      floatingCaptionState.lastFinalized = {
        segmentId: floatingCaptionState.current.segmentId,
        text: floatingCaptionState.current.text,
        translation: floatingCaptionState.current.translation || null,
      };
      floatingCaptionState.current = { segmentId: null, text: '', isRefined: false, translation: null };
      sendFloatingCaptionState();
      return true;
    }

    // Handle updateFinalized: update the lastFinalized text directly (for refined segments)
    if (value.updateFinalized && value.text !== undefined) {
      const pendingTranslation = floatingCaptionState.pendingTranslation.segmentId === value.segmentId
        ? floatingCaptionState.pendingTranslation.text : null;
      const existingTranslation = floatingCaptionState.lastFinalized.segmentId === value.segmentId
        ? floatingCaptionState.lastFinalized.translation : null;
      floatingCaptionState.lastFinalized = { segmentId: value.segmentId ?? null, text: value.text, translation: pendingTranslation || existingTranslation };
      if (pendingTranslation) floatingCaptionState.pendingTranslation = { segmentId: null, text: null };
      // Clear current area only if it's showing the same segment that was just refined
      if (value.clearCurrentIfMatch && value.segmentId === floatingCaptionState.current.segmentId) {
        floatingCaptionState.current = { segmentId: null, text: '', isRefined: false, translation: null };
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

    sendFloatingCaptionState();
    return true;
  });

  ipcMain.handle('floating-caption.move', (_, payload) => {
    const value = z.object({ deltaX: z.number(), deltaY: z.number() }).parse(payload ?? {});
    if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
      const bounds = floatingCaptionWindow.getBounds();
      floatingCaptionWindow.setBounds({
        x: bounds.x + Math.round(value.deltaX),
        y: bounds.y + Math.round(value.deltaY),
      });
    }
    return true;
  });

  ipcMain.handle('floating-caption.set-always-on-top', (_, payload) => {
    const value = z.object({ alwaysOnTop: z.boolean() }).parse(payload ?? {});
    if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
      floatingCaptionWindow.setAlwaysOnTop(value.alwaysOnTop, 'screen-saver');
    }
    return value.alwaysOnTop;
  });
}

let macUpdateCheck;

function checkForUpdate() {
  if (!app.isPackaged) return Promise.resolve({ status: 'unsupported' });
  if (!['darwin', 'win32'].includes(process.platform)) return Promise.resolve({ status: 'unsupported' });
  if (macUpdateCheck) return macUpdateCheck;
  const { autoUpdater } = require('electron-updater');
  configureMacUpdater(autoUpdater);
  macUpdateCheck = new Promise((resolve, reject) => {
    const done = (result) => { cleanup(); resolve(result); };
    const fail = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      autoUpdater.removeListener('update-available', available);
      autoUpdater.removeListener('update-not-available', current);
      autoUpdater.removeListener('error', fail);
    };
    const available = (info) => done({ status: 'available', version: info.version });
    const current = () => done({ status: 'current' });
    autoUpdater.once('update-available', available);
    autoUpdater.once('update-not-available', current);
    autoUpdater.once('error', fail);
    autoUpdater.checkForUpdates().catch(fail);
  }).finally(() => { macUpdateCheck = undefined; });
  return macUpdateCheck;
}

async function installUpdate() {
  if (!['darwin', 'win32'].includes(process.platform) || !app.isPackaged) return false;

  const { autoUpdater } = require('electron-updater');

  // 监听下载进度并发送给前端
  const progressHandler = (info) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('brevia:event', {
        type: 'update.download-progress',
        payload: {
          bytesPerSecond: info.bytesPerSecond,
          percent: info.percent,
          transferred: info.transferred,
          total: info.total,
        },
      });
    });
  };

  autoUpdater.on('download-progress', progressHandler);

  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.removeListener('download-progress', progressHandler);
    autoUpdater.quitAndInstall();
    return true;
  } catch (error) {
    autoUpdater.removeListener('download-progress', progressHandler);
    throw error;
  }
}

function createWindow() {
  const appUrl = pathToFileURL(path.join(packagedRoot, 'frontend', 'index.html')).href;
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(appUrl)) return;
    event.preventDefault();
    openExternal(url);
  });
  let pageReady = false;
  let animationComplete = false;
  let initializationReady = false;
  let revealed = false;
  let reloadRevealTimer;
  const revealApp = () => {
    if (!pageReady || !animationComplete || !initializationReady || revealed || window.isDestroyed()) return;
    revealed = true;
    window.webContents.send('brevia:event', { type: 'startup.ready' });
  };
  window.webContents.on('did-finish-load', () => {
    pageReady = true;
    window.show();
    if (revealed) {
      clearTimeout(reloadRevealTimer);
      reloadRevealTimer = setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.send('brevia:event', { type: 'startup.ready' });
      }, startupAnimationMs);
    }
    else revealApp();
  });
  window.loadFile(path.join(packagedRoot, 'frontend', 'index.html'), resetOnboarding ? { query: { resetOnboarding: '1' } } : undefined);
  setTimeout(() => {
    animationComplete = true;
    revealApp();
  }, startupAnimationMs);
  void Promise.race([initializeWorker(), new Promise((resolve) => setTimeout(resolve, startupDataWaitMs))])
    .catch((error) => reportMainError(error))
    .then(() => { initializationReady = true; revealApp(); });
  window.on('closed', () => { closeFloatingCaption(); });
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
const floatingCaptionPayload = z.object({
  segmentId: z.string().max(200).nullable().optional(),
  text: z.string().max(4000).optional(),
  translation: z.string().max(4000).nullable().optional(),
  isRefined: z.boolean().optional(),
  finalize: z.boolean().optional(),
  updateFinalized: z.boolean().optional(),
  clearCurrentIfMatch: z.boolean().optional(),
  translationPending: z.boolean().optional(),
  locale: z.string().max(16).optional(),
}).strict();

function resetFloatingCaptionState() {
  floatingCaptionState.lastFinalized = { segmentId: null, text: '', translation: null };
  floatingCaptionState.current = { segmentId: null, text: '', isRefined: false, translation: null };
  floatingCaptionState.pendingTranslation = { segmentId: null, text: null };
  floatingCaptionState.translationPending = { segmentId: null };
  sendFloatingCaptionState();
}

function sendFloatingCaptionState() {
  if (!floatingCaptionWindow || floatingCaptionWindow.isDestroyed() || !floatingCaptionReady) return;
  // Send the entire state structure - the renderer knows how to handle it
  floatingCaptionWindow.webContents.send('floating-caption:update', {
    lastFinalized: floatingCaptionState.lastFinalized,
    current: floatingCaptionState.current,
    pendingTranslation: floatingCaptionState.pendingTranslation,
    translationPending: floatingCaptionState.translationPending,
    locale: floatingCaptionState.locale,
  });
}

let floatingCaptionBounds = null;

function showFloatingCaption() {
  // Reuse existing window if it's still valid
  if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
    floatingCaptionWindow.show();
    floatingCaptionWindow.focus();
    return true;
  }

  // Clear stale reference if window was destroyed
  if (floatingCaptionWindow) {
    floatingCaptionWindow = null;
    floatingCaptionReady = false;
  }

  const mainWindow = BrowserWindow.getAllWindows().find(window => window !== floatingCaptionWindow && !window.isDestroyed());
  const display = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const { workArea } = display;
  const width = Math.min(760, workArea.width - 80);
  const height = 220;

  // Restore saved position or use default centered position
  const savedBounds = floatingCaptionBounds && screen.getDisplayMatching(floatingCaptionBounds).id === display.id ? floatingCaptionBounds : null;
  const x = savedBounds?.x ?? Math.round(workArea.x + (workArea.width - width) / 2);
  const y = savedBounds?.y ?? Math.round(workArea.y + workArea.height - height - 60);

  floatingCaptionReady = false;
  const captionWindow = floatingCaptionWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true, // Skip taskbar to prevent appearing as separate window in dock
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // On macOS, explicitly show dock icon when floating caption is created
  // This ensures the main app stays accessible via dock
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
  captionWindow.setAlwaysOnTop(true, 'screen-saver');
  captionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  captionWindow.webContents.on('did-finish-load', () => {
    if (floatingCaptionWindow !== captionWindow) return;
    floatingCaptionReady = true;
    sendFloatingCaptionState();
    if (!captionWindow.isDestroyed()) {
      captionWindow.show();
      // After showing floating caption, restore focus to main window
      const mainWindow = BrowserWindow.getAllWindows().find(w => w !== captionWindow && !w.isDestroyed());
      if (mainWindow) {
        mainWindow.focus();
      }
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
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('brevia:event', {
          type: 'floating-caption.closed',
          payload: {}
        });
      }
    });
  });
  void captionWindow.loadFile(path.join(packagedRoot, 'frontend', 'floating-caption.html'));
  return true;
}

function closeFloatingCaption() {
  if (floatingCaptionWindow && !floatingCaptionWindow.isDestroyed()) {
    // Save position before closing
    floatingCaptionBounds = floatingCaptionWindow.getBounds();
    floatingCaptionWindow.close();
  }
  floatingCaptionWindow = null;
  floatingCaptionReady = false;
  return true;
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') Menu.setApplicationMenu(null);
  await migrateDataDir().catch((error) => writeLog('WARNING', `data migration: ${logText(error)}`));
  session.defaultSession.setPermissionCheckHandler((_, permission) => permission === 'media' || permission === 'display-capture');
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'media' || permission === 'display-capture'));
  session.defaultSession.setDisplayMediaRequestHandler(createDisplayMediaHandler(desktopCapturer, writeLog));
  worker.start();
  registerIpc();
  void initializeWorker().catch((error) => reportMainError(error));
  createWindow();
  app.on('activate', () => {
    const mainWindow = BrowserWindow.getAllWindows().find(w => w !== floatingCaptionWindow && !w.isDestroyed());
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
let stoppingForSleep = false;
async function stopActiveMeeting() {
  const active = worker.active;
  if (!active) return;
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
powerMonitor.on('suspend', () => { void stopActiveMeetingForSleep(); });
app.on('before-quit', (event) => {
  if (quittingAfterMeetingStop) {
    app.isQuitting = true;
    stopProcess(worker.process);
    stopProcess(refinementWorker.process);
    return;
  }
  event.preventDefault();
  quittingAfterMeetingStop = true;
  void Promise.race([
    stopActiveMeeting(),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]).catch((error) => writeLog('WARNING', `stop meeting before quit: ${logText(error)}`)).finally(() => app.quit());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
