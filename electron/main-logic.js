const { cp, mkdir, open, readFile, realpath, rename, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modelscopeUpdateFeed = Object.freeze({ provider: 'generic', url: 'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master' });

const pendingFileWrites = new Map();

async function writeAtomicFile(target, value) {
  target = path.resolve(target);
  const previous = pendingFileWrites.get(target);
  const writing = (async () => {
    // Serialize replacements of the same file, preserving save order on Windows too.
    await previous?.catch(() => {});
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(value, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  })();
  pendingFileWrites.set(target, writing);
  try { await writing; }
  finally { if (pendingFileWrites.get(target) === writing) pendingFileWrites.delete(target); }
}

async function migrateLegacyData(source, target) {
  if (path.resolve(source) === path.resolve(target)) return;
  const journal = path.join(target, '.brevia-data-migration.json');
  if (!existsSync(source) && !existsSync(journal)) return;
  const names = ['advanced-settings.json', 'meetings', 'models', 'models-location.json', 'speaker-profiles', 'summary-models.json', 'ai-assist.json', 'secrets', 'logs', 'brevia.db-shm', 'brevia.db-wal', 'brevia.db'];
  let state;
  if (existsSync(journal)) {
    state = JSON.parse(await readFile(journal, 'utf8'));
    if (state.source !== source || !Array.isArray(state.names) || state.names.some((name) => !names.includes(name)) || !/^[0-9a-f-]{36}$/.test(state.id)) throw new Error('Invalid migration journal');
  } else {
    // 两个完整数据库不能静默合并；没有源数据库的旧目录可为此前中断迁移的残留。
    if (existsSync(path.join(source, 'brevia.db')) && existsSync(path.join(target, 'brevia.db'))) return;
    for (const name of ['meetings', 'models', 'models-location.json']) {
      if (existsSync(path.join(source, name)) && existsSync(path.join(target, name))) throw new Error(`Migration destination already exists: ${path.join(target, name)}`);
    }
    state = { source, id: randomUUID(), names: names.filter((name) => existsSync(path.join(source, name)) && !existsSync(path.join(target, name))), publishing: null };
    if (!state.names.length) return;
    await writeAtomicFile(journal, JSON.stringify(state));
  }
  for (const name of state.names) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const staging = `${to}.${state.id}.brevia-migration`;
    if (state.publishing === name && existsSync(to) && !existsSync(staging)) {
      // 复制已提交、但源清理未完成。日志在发布之前落盘，只有本次拥有的目标可清理源。
      await rm(from, { recursive: true, force: true });
      state.publishing = null;
      await writeAtomicFile(journal, JSON.stringify(state));
    }
    if (!existsSync(from)) continue;
    if (existsSync(to)) throw new Error(`Migration destination already exists: ${to}`);
    try { await rename(from, to); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      // 目标卷内先完成复制再原子发布；中断后重复制仍在源目录中的最新文件。
      await rm(staging, { recursive: true, force: true });
      await cp(from, staging, { recursive: true, errorOnExist: true, force: false });
      state.publishing = name;
      await writeAtomicFile(journal, JSON.stringify(state));
      await rename(staging, to);
      await rm(from, { recursive: true, force: true });
      state.publishing = null;
      await writeAtomicFile(journal, JSON.stringify(state));
    }
    await rm(staging, { recursive: true, force: true });
    if (state.publishing) {
      state.publishing = null;
      await writeAtomicFile(journal, JSON.stringify(state));
    }
  }
  // 旧默认目录可能被显式写入配置；移动数据后同步其路径，外置目录保持原值。
  if (state.names.includes('models-location.json')) {
    const locationFile = path.join(target, 'models-location.json');
    const location = JSON.parse(await readFile(locationFile, 'utf8'));
    let changed = false;
    for (const key of ['current', 'recordings']) {
      if (!location[key]) continue;
      const relative = path.relative(source, location[key]);
      if (['models', 'meetings'].some((name) => state.names.includes(name) && (relative === name || relative.startsWith(`${name}${path.sep}`)))) {
        location[key] = path.join(target, relative);
        changed = true;
      }
    }
    if (changed) await writeAtomicFile(locationFile, JSON.stringify(location));
  }
  await rm(journal);
}

async function audioFileURL(filePath, directories) {
  const resolved = await realpath(filePath);
  for (const directory of directories) {
    let parent;
    try { parent = await realpath(directory); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const relative = path.relative(parent, resolved);
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return pathToFileURL(resolved).href;
  }
  throw new Error('Invalid audio path');
}

function configureMacUpdater(updater) {
  updater.autoDownload = false;
  updater.setFeedURL(modelscopeUpdateFeed);
}

function createDisplayMediaHandler(desktopCapturer, writeLog) {
  return async (_, callback) => {
    let source;
    try {
      [source] = await desktopCapturer.getSources({ types: ['screen'] });
    } catch (error) {
      writeLog('ERROR', error);
      callback({});
      return;
    }
    if (!source) {
      writeLog('WARNING', 'No screen source available for system audio capture');
      callback({});
      return;
    }
    // Electron may throw while validating this callback.  It was already called,
    // so it must never be retried from a catch block.
    callback({ video: source, audio: 'loopback' });
  };
}

async function registerScreenPermission(desktopCapturer, writeLog) {
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); }
  catch (error) { writeLog('WARNING', `screen permission registration: ${error.message}`); }
}

function systemAudioSupported(platform, kernelRelease) {
  return platform === 'win32' || (platform === 'darwin' && Number.parseInt(kernelRelease, 10) >= 22);
}

const versionParts = (version) => version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);
function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) if (next[index] !== installed[index]) return next[index] > installed[index];
  return false;
}

// ── worker 错误 → 结构化判定 ────────────────────────────────────────────────────
//
// 协议层以前只把异常压成字符串，于是主进程只能**正则解析人类可读的报错**来决定要不要
// 走"先下载再重试"：任何措辞改动都会静默破坏整条下载链路。现在后端把
// `ModelNotInstalled` 序列化成 `error_code` / `error_models`，这里读字段即可。
// 保留一个**语义化**的回退判据（而不是正则）：老 worker 二进制可能只给文本，
// 但那种情况只出现在开发期混用旧 runtime，判定条件写成"文本里出现 not installed"
// 这种宽泛匹配反而会误判，所以宁可不回退——协议两端同版本发布。
function workerError(message) {
  const error = new Error(typeof message.error === 'string' ? message.error : String(message.error));
  if (typeof message.error_code === 'string') error.code = message.error_code;
  if (Array.isArray(message.error_models)) error.models = message.error_models.filter((id) => typeof id === 'string');
  return error;
}

function workerLogLevel(message) {
  try { return JSON.parse(message).type === 'log' ? 'INFO' : 'WARNING'; }
  catch { return 'WARNING'; }
}

/** 该错误是否表示「模型没装」，是则返回缺失的模型 id 列表，否则返回 null。
 *
 * 只认结构化字段：`error_code === 'model_not_installed'` 且 `error_models` 非空。
 * @param {Error} error 由 workerError 构造（或任意错误）。
 * @returns {string[]|null} 缺失模型 id。
 */
function requiredModelsFrom(error) {
  if (!error || error.code !== 'model_not_installed') return null;
  const models = Array.isArray(error.models) ? error.models : [];
  return models.length ? models : null;
}

module.exports = {
  audioFileURL,
  configureMacUpdater,
  createDisplayMediaHandler,
  isNewerVersion,
  registerScreenPermission,
  requiredModelsFrom,
  systemAudioSupported,
  workerError,
  workerLogLevel,
  writeAtomicFile,
  migrateLegacyData,
};
