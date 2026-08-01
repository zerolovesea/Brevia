const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, safeStorage, session, shell, systemPreferences } = require('electron');
const { spawn } = require('node:child_process');
const { copyFile, mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { z } = require('zod');

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare');
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

const root = path.join(__dirname, '..');
const packagedRoot = app.isPackaged ? process.resourcesPath : root;
const startupAnimationMs = 1400;
const splashFadeMs = 360;
const dataDir = () => app.getPath('userData');
const command = z.object({ type: z.string().min(1), payload: z.record(z.string(), z.unknown()).default({}) });
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
  pcm: z.string(),
  sample_rate: z.literal(16000),
  start_ms: z.number().nonnegative(),
  flush: z.boolean().optional(),
});
const id = z.object({ meeting_id: z.string().uuid() });
const summaryModelConfig = z.object({
  name: z.string().trim().min(1).max(64), provider: z.string().trim().min(1).max(64),
  endpoint: z.string().url(), format: z.enum(['openai', 'claude']).optional(), model: z.string().trim().min(1).max(128),
  keyReference: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
});
const summaryConfig = z.object({
  models: z.array(summaryModelConfig).max(20), active: z.number().int().min(-1).max(19),
  prompt: z.string().trim().min(1).max(4000), sequence: z.number().int().nonnegative(),
});

class WorkerClient {
  constructor() {
    this.pending = new Map();
    this.sequence = 0;
    this.restarts = 0;
    this.active = null;
  }

  start() {
    if (this.process?.stdin && !this.process.stdin.destroyed && this.process.exitCode === null) return;
    const bundled = path.join(packagedRoot, '.venv', 'bin', 'python');
    const python = process.env.BREVIA_PYTHON || (existsSync(bundled) ? bundled : 'python3');
    const child = spawn(python, ['-m', 'backend.worker'], {
      cwd: packagedRoot,
      env: {
        ...process.env,
        BREVIA_DATA_DIR: dataDir(),
        BREVIA_MODELS_DIR: process.env.BREVIA_MODELS_DIR || (app.isPackaged ? path.join(dataDir(), 'models') : path.join(root, '.models')),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.filter(Boolean).forEach((line) => this.receive(JSON.parse(line)));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (message) => this.sendEvent('worker:log', { message }));
    child.on('error', (error) => this.fail(error));
    child.on('exit', (code) => this.closed(code, child));
  }

  receive(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error));
      return;
    }
    if (message.type) this.sendEvent(message.type, message.payload);
  }

  request(type, payload = {}) {
    const value = command.parse({ type, payload });
    if (!this.process?.stdin || this.process.stdin.destroyed || this.process.exitCode !== null) {
      if (app.isQuitting) return Promise.reject(new Error('Worker is shutting down'));
      this.start();
    }
    const requestId = `cmd-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.process.stdin.write(`${JSON.stringify({ id: requestId, ...value })}\n`, (error) => {
          if (error) {
            this.pending.delete(requestId);
            reject(error);
          }
        });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  sendEvent(type, payload) {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('brevia:event', { type, payload }));
  }

  fail(error) {
    this.pending.forEach(({ reject }) => reject(error));
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
        start_ms: this.active.elapsed(),
      });
      this.sendEvent('worker.recovered', { meeting_id: this.active.meeting_id });
    } catch (error) {
      this.sendEvent('worker.error', { message: `录音仍在本地保留，但转写无法恢复：${error.message}` });
    }
  }
}

const worker = new WorkerClient();

function handle(channel, schema, type = channel) {
  ipcMain.handle(channel, (_, payload = {}) => worker.request(type, schema.parse(payload)));
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
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用');
  const directory = path.join(dataDir(), 'secrets');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${reference}.bin`), safeStorage.encryptString(value), { mode: 0o600 });
}

async function getSecret(reference) {
  if (!reference) return '';
  try {
    const encrypted = await readFile(path.join(dataDir(), 'secrets', `${reference}.bin`));
    return safeStorage.decryptString(encrypted);
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

function registerIpc() {
  handle('app.initialize', z.object({}).passthrough(), 'app.initialize');
  ipcMain.handle('meeting.start', async (_, payload) => {
    const value = meetingStart.parse(payload);
    const started = Date.now();
    let result;
    try {
      result = await worker.request('meeting.start', { ...value, require_models: true });
    } catch (error) {
      const models = requiredModels(error);
      if (!models) throw error;
      worker.sendEvent('model.required', { models, task: 'meeting.start', payload: value });
      return { model_required: models };
    }
    worker.active = { meeting_id: result.id, elapsed: () => Date.now() - started };
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
  handle('meeting.update', id.extend({ updates: z.record(z.string(), z.unknown()) }), 'meeting.update');
  handle('meeting.delete', id, 'meeting.delete');
  handle('meeting.restore', id, 'meeting.restore');
  handle('meeting.purge', id, 'meeting.purge');
  handleModelRequirement('meeting.refine', id.extend({
    refined_model_id: z.string().min(1).optional(),
    num_speakers: z.number().int().min(-1).max(20).optional(),
    cluster_threshold: z.number().min(0).max(1).optional(),
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
  handle('metrics.record', z.object({ app_duration_ms: z.number().int().nonnegative().optional() }), 'metrics.record');
  handle('segment.speaker', id.extend({ segment_id: z.string().min(1), name: z.string().trim().min(1).max(32), enroll: z.boolean().optional() }), 'segment.speaker');
  handle('segment.speaker-profile-sample', id.extend({ segment_id: z.string().min(1), profile_id: z.string().uuid() }), 'segment.speaker-profile-sample');
  ipcMain.handle('storage.open', async (_, payload) => {
    const partition = z.enum(['meetings', 'models', 'exports']).parse(payload?.partition);
    const root = dataDir();
    const directory = partition === 'models' ? process.env.BREVIA_MODELS_DIR || path.join(root, 'models') : path.join(root, 'meetings');
    return shell.openPath(directory);
  });
  ipcMain.handle('tts.synthesize', async (_, payload) => {
    const value = z.object({ text: z.string().trim().min(1).max(1000), voice_id: z.string().min(1), target_language: z.enum(['zh', 'en']), provider: z.string(), endpoint: z.string().url(), model: z.string(), format: z.enum(['openai', 'claude']).optional(), key_reference: z.string().optional() }).parse(payload);
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
  handle('models.download', z.object({ model_id: z.string() }), 'models.download');
  handle('models.delete', z.object({ model_id: z.string() }), 'models.delete');
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
      key_reference: z.string().optional(), consent: z.literal(true), prompt: z.string().optional(),
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
    const exported = await worker.request('meeting.export', value);
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
      const exported = await worker.request('meeting.export', { meeting_id: meetingId, content: ['flac', 'wav', 'm4a'].includes(value.format) ? 'audio' : 'transcript', format: value.format });
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

async function promptInitialPermissions(window) {
  if (process.platform !== 'darwin') return;
  const microphone = systemPreferences.getMediaAccessStatus('microphone');
  const screen = systemPreferences.getMediaAccessStatus('screen');
  if (microphone !== 'not-determined' && screen !== 'not-determined') return;
  await dialog.showMessageBox(window, {
    type: 'info',
    title: '允许录制会议音频',
    message: 'Brevia 需要麦克风、屏幕与系统音频录制权限。',
    detail: '接下来会请求尚未授权的权限；系统会在需要时显示授权提示。',
    buttons: ['继续'],
  });
  if (microphone === 'not-determined') {
    await systemPreferences.askForMediaAccess('microphone');
  }
  if (screen === 'not-determined') {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    }).catch(() => []);
  }
}

function createWindow() {
  const splash = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.loadFile(path.join(packagedRoot, 'frontend', 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
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
  let mainReady = false;
  let animationComplete = false;
  let revealed = false;
  const showMain = () => {
    if (!mainReady || !animationComplete || revealed || window.isDestroyed()) return;
    revealed = true;
    window.show();
    promptInitialPermissions(window);
    const started = Date.now();
    const fadeSplash = () => {
      if (splash.isDestroyed()) return;
      const progress = Math.min(1, (Date.now() - started) / splashFadeMs);
      splash.setOpacity(1 - progress * progress);
      if (progress < 1) setTimeout(fadeSplash, 16);
      else splash.close();
    };
    fadeSplash();
  };
  window.loadFile(path.join(packagedRoot, 'frontend', 'index.html'));
  window.once('ready-to-show', () => {
    mainReady = true;
    showMain();
  });
  setTimeout(() => {
    animationComplete = true;
    showMain();
  }, startupAnimationMs);
  window.once('closed', () => {
    if (!splash.isDestroyed()) splash.close();
  });
  return window;
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_, callback) => {
    const [source] = await desktopCapturer.getSources({ types: ['screen'] });
    callback(source ? { video: source, audio: 'loopback' } : {});
  });
  worker.start();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('before-quit', () => {
  app.isQuitting = true;
  worker.process?.kill();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
