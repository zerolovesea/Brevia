const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, systemPreferences } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { z } = require('zod');
const { autoUpdater } = require('electron-updater');
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
const workerLineLimit = 4 * 1024 * 1024;
const workerRequestTimeouts = new Map([
  ['models.download', 15000], ['models.pause', 15000], ['models.cancel', 15000],
  ['task.pause', 15000], ['task.resume', 15000],
]);
const resetOnboarding = process.argv.includes('--reset-onboarding');
const dataDir = () => process.env.BREVIA_DATA_DIR || path.join(app.getPath('home'), 'brevia');
const legacyDataDir = () => app.getPath('userData');
const logsDir = () => path.join(dataDir(), 'logs');
const logFile = () => path.join(logsDir(), 'brevia.log');
const logText = (value) => value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value);
const bundledFfmpegPath = () => {
  try { return require('@ffmpeg-installer/ffmpeg').path.replace('app.asar', 'app.asar.unpacked'); } catch { return ''; }
};
const writeLog = (level, value) => {
  const line = `${new Date().toISOString()} [${level}] ${logText(value).trim()}\n`;
  void mkdir(logsDir(), { recursive: true }).then(() => appendFile(logFile(), line, 'utf8')).catch(() => {});
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
  for (const name of ['advanced-settings.json', 'brevia.db', 'brevia.db-shm', 'brevia.db-wal', 'meetings', 'models', 'speaker-profiles', 'summary-models.json', 'secrets', 'tts', 'logs']) {
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
    'app.maintenance', 'asr.language', 'diarization.ready', 'meeting.imported',
    'meeting.paused', 'meeting.recovered', 'meeting.sources-separated', 'meeting.started',
    'meeting.stopped', 'model.progress', 'model.status', 'refinement.progress',
    'refinement.ready', 'refinement.segment', 'refinement.started', 'separation.progress',
    'separation.started', 'speaker-profile.deleted', 'speaker-profile.updated',
    'summary.progress', 'summary.ready', 'summary.started', 'task.status',
    'transcript.discarded', 'transcript.final', 'transcript.partial', 'transcript.refined',
    'translation.ready', 'tts.ready', 'worker.error', 'worker.warning',
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
  speaker_embedding_model_id: z.string().min(1).optional(),
  vad_model_id: z.string().min(1).optional(),
  num_speakers: z.number().int().min(-1).max(20).optional(),
  category: z.string().max(32).optional(),
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
  category: z.string().max(32),
  tags: z.array(z.string().max(32)).max(20),
  archived_at: z.string().max(64).nullable(),
  refined_model_id: z.string().min(1).max(128),
}).partial();
const summaryModelConfig = z.object({
  name: z.string().trim().min(1).max(64), provider: z.string().trim().min(1).max(64),
  endpoint: z.string().url(), format: z.enum(['openai', 'claude']).optional(), model: z.string().trim().min(1).max(128),
  keyReference: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  keyLength: z.number().int().positive().max(512).optional(),
});
const summaryConfig = z.object({
  models: z.array(summaryModelConfig).max(20), active: z.number().int().min(-1).max(19),
  sequence: z.number().int().nonnegative(),
});

class WorkerClient {
  constructor() {
    this.pending = new Map();
    this.sequence = 0;
    this.restarts = 0;
    this.active = null;
    this.starting = null;
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
    const child = spawn(python, args, {
      cwd: packagedRoot,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        BREVIA_DATA_DIR: dataDir(),
        BREVIA_MODELS_DIR: process.env.BREVIA_MODELS_DIR || path.join(dataDir(), 'models'),
        ...(ffmpeg ? { BREVIA_FFMPEG: ffmpeg } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.starting = new Promise((resolve, reject) => {
      child.once('spawn', resolve);
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
    child.on('exit', (code) => this.closed(code, child));
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

  fail(error) {
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(error);
    });
    this.pending.clear();
  }

  async closed(code, child) {
    if (child !== this.process) return;
    this.process = null;
    if (app.isQuitting) return;
    this.fail(new Error(`Worker exited with code ${code}`));
    this.sendEvent('worker.error', { message: `转写进程已退出（${code}）` });
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
  try {
    return summaryConfig.parse(JSON.parse(await readFile(summaryConfigPath(), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
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
    await writeFile(pdfPath, await printWindow.webContents.printToPDF({ printBackground: true }));
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
  ipcMain.handle('permissions.status', () => process.platform === 'darwin'
    ? { microphone: systemPreferences.getMediaAccessStatus('microphone'), screen: systemPreferences.getMediaAccessStatus('screen'), systemAudioSupported: supportsSystemAudio() }
    : { microphone: 'granted', screen: 'granted', systemAudioSupported: supportsSystemAudio() });
  ipcMain.handle('permissions.request-microphone', () => process.platform === 'darwin'
    ? systemPreferences.askForMediaAccess('microphone')
    : true);
  ipcMain.handle('permissions.open-screen-settings', async () => {
    if (process.platform !== 'darwin') return false;
    await registerScreenPermission(desktopCapturer, writeLog);
    const settings = spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'], { detached: true, stdio: 'ignore' });
    settings.unref();
    return true;
  });
  ipcMain.handle('permissions.open-microphone-settings', () => {
    if (process.platform !== 'darwin') return false;
    const settings = spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], { detached: true, stdio: 'ignore' });
    settings.unref();
    return true;
  });
  ipcMain.handle('app.initialize', () => initializeWorker());
  handle('app.maintain', z.object({}), 'app.maintain');
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
    return result;
  });
  ipcMain.handle('meeting.import', async (_, payload) => {
    const value = meetingStart.extend({ path: z.string().min(1) }).parse(payload);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }] });
    if (selected.canceled) return null;
    return worker.request('meeting.import', { ...value, path: selected.filePaths[0] });
  });
  handle('meeting.audio', audio, 'meeting.audio');
  handle('meeting.pause', id.extend({ paused: z.boolean() }), 'meeting.pause');
  ipcMain.handle('meeting.stop', async (_, payload) => {
    const value = id.extend({ duration_ms: z.number().nonnegative() }).parse(payload);
    const result = await worker.request('meeting.stop', value);
    worker.active = null;
    return result;
  });
  handle('meeting.list', z.object({ include_deleted: z.boolean().optional(), query: z.string().max(120).optional() }), 'meeting.list');
  handle('meeting.get', id, 'meeting.get');
  handle('meeting.update', id.extend({ updates: meetingUpdates }), 'meeting.update');
  handle('meeting.delete', id, 'meeting.delete');
  handle('meeting.restore', id, 'meeting.restore');
  handle('meeting.purge', id, 'meeting.purge');
  handleModelRequirement('meeting.refine', id.extend({
    refined_model_id: z.string().min(1).optional(),
    num_speakers: z.number().int().min(-1).max(20).optional(),
    cluster_threshold: z.number().min(0).max(2).optional(),
  }), 'meeting.refine');
  handleModelRequirement('meeting.separate', id, 'meeting.separate');
  handle('speaker.rename', id.extend({ speaker_id: z.string(), name: z.string().trim().min(1).max(32), locked: z.boolean().optional() }), 'speaker.rename');
  handle('speaker-profile.list', z.object({}), 'speaker-profile.list');
  handle('speaker-profile.samples', z.object({ profile_id: z.string().uuid() }), 'speaker-profile.samples');
  ipcMain.handle('speaker-profile.enroll', async (_, payload) => {
    const value = z.object({ profile_id: z.string().uuid().optional(), name: z.string().trim().min(1).max(32), reference_text: z.string().trim().max(500).optional() }).parse(payload);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }] });
    if (selected.canceled) return null;
    return worker.request('speaker-profile.enroll', { ...value, path: selected.filePaths[0] });
  });
  ipcMain.handle('speaker-profile.verify', async (_, payload) => {
    const value = z.object({ profile_id: z.string().uuid() }).parse(payload);
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg'] }] });
    if (selected.canceled) return null;
    return worker.request('speaker-profile.verify', { ...value, path: selected.filePaths[0] });
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
  handle('segment.speaker-profile-sample', id.extend({ segment_id: z.string().min(1), profile_id: z.string().uuid() }), 'segment.speaker-profile-sample');
  ipcMain.handle('storage.open', async (_, payload) => {
    const partition = z.enum(['meetings', 'models', 'exports']).parse(payload?.partition);
    const root = dataDir();
    const directory = partition === 'models' ? process.env.BREVIA_MODELS_DIR || path.join(root, 'models') : path.join(root, 'meetings');
    return shell.openPath(directory);
  });
  ipcMain.handle('tts.synthesize', async (_, payload) => {
    const value = z.object({ text: z.string().trim().min(1).max(1000), voice_id: z.string().min(1).optional(), target_language: z.enum(['zh', 'en', 'es', 'ko', 'fr', 'de', 'ru']), provider: z.string(), endpoint: z.string().url(), model: z.string(), format: z.enum(['openai', 'claude']).optional(), key_reference: z.string().optional() }).parse(payload);
    try {
      return await worker.request('tts.synthesize', { ...value, api_key: await getSecret(value.key_reference) });
    } catch (error) {
      const models = requiredModels(error);
      if (!models) throw error;
      worker.sendEvent('model.required', { models, task: 'tts.synthesize', payload: value });
      return { model_required: models };
    }
  });
  handle('models.list', z.object({}), 'models.list');
  handle('models.download', z.object({ model_id: z.string(), source: z.enum(['default', 'china']).optional() }), 'models.download');
  handle('models.pause', z.object({ model_id: z.string() }), 'models.pause');
  handle('models.cancel', z.object({ model_id: z.string() }), 'models.cancel');
  handle('models.delete', z.object({ model_id: z.string() }), 'models.delete');
  handle('task.pause', z.object({ task: z.enum(['meeting.refine', 'meeting.separate', 'summary.generate']), meeting_id: z.string() }), 'task.pause');
  handle('task.resume', z.object({ task: z.enum(['meeting.refine', 'meeting.separate', 'summary.generate']), meeting_id: z.string() }), 'task.resume');
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
      provider: z.string(), endpoint: z.string().url(), model: z.string(),
      format: z.enum(['openai', 'claude']).optional(),
      key_reference: z.string().optional(), language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']).default('en'), consent: z.literal(true),
    }).parse(payload);
    const api_key = await getSecret(value.key_reference);
    if (!api_key && value.provider !== 'Ollama') return { configuration_required: true };
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
      provider: z.string(),
      endpoint: z.string().url(),
      model: z.string(),
      format: z.enum(['openai', 'claude']).optional(),
      key_reference: z.string().optional(),
      consent: z.literal(true),
    }).parse(payload);
    return worker.request('translation.generate', { ...value, api_key: await getSecret(value.key_reference) });
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
  ipcMain.handle('shell.showItem', (_, filePath) => shell.showItemInFolder(z.string().parse(filePath)));
  ipcMain.handle('audio.url', (_, filePath) => {
    const resolved = path.resolve(z.string().parse(filePath));
    if (!resolved.startsWith(`${path.resolve(dataDir())}${path.sep}`)) throw new Error('Invalid audio path');
    return pathToFileURL(resolved).href;
  });
}

let macUpdateCheck;

function checkForUpdate() {
  if (!app.isPackaged) return Promise.resolve({ status: 'unsupported' });
  if (process.platform === 'win32') return fetch('https://api.github.com/repos/zerolovesea/Brevia/releases/latest', { headers: { 'User-Agent': 'Brevia' } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`GitHub update check failed (${response.status})`)))
    .then(({ tag_name }) => ({ status: isNewerVersion(tag_name, app.getVersion()) ? 'available' : 'current', version: tag_name.replace(/^v/, '') }));
  if (process.platform !== 'darwin') return Promise.resolve({ status: 'unsupported' });
  if (macUpdateCheck) return macUpdateCheck;
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
  if (process.platform === 'win32') return shell.openExternal(releasesUrl);
  if (process.platform !== 'darwin' || !app.isPackaged) return false;

  // 监听下载进度并发送给前端
  const progressHandler = (info) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('ipc-event', {
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
    .catch(() => {})
    .then(() => { initializationReady = true; revealApp(); });
  return window;
}

app.whenReady().then(async () => {
  await migrateDataDir().catch((error) => writeLog('WARNING', `data migration: ${logText(error)}`));
  session.defaultSession.setPermissionCheckHandler((_, permission) => permission === 'media' || permission === 'display-capture');
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'media' || permission === 'display-capture'));
  session.defaultSession.setDisplayMediaRequestHandler(createDisplayMediaHandler(desktopCapturer, writeLog));
  worker.start();
  registerIpc();
  void initializeWorker().catch(() => {});
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
let quittingAfterMeetingStop = false;
async function stopActiveMeetingBeforeQuit() {
  const active = worker.active;
  if (!active) return;
  worker.active = null;
  await worker.request('meeting.stop', {
    meeting_id: active.meeting_id,
    duration_ms: Math.max(0, Date.now() - active.started_at),
  });
}
app.on('before-quit', (event) => {
  if (quittingAfterMeetingStop) {
    app.isQuitting = true;
    stopProcess(worker.process);
    return;
  }
  event.preventDefault();
  quittingAfterMeetingStop = true;
  void Promise.race([
    stopActiveMeetingBeforeQuit(),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]).catch((error) => writeLog('WARNING', `stop meeting before quit: ${logText(error)}`)).finally(() => app.quit());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
