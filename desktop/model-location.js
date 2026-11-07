const fs = require('node:fs');
const {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} = require('node:fs/promises');
const path = require('node:path');
const { writeAtomicFile } = require('./main-logic');

const file = (dataDir) => path.join(dataDir, 'models-location.json');
const defaultDirectory = (dataDir) => path.join(dataDir, 'models');
const defaultRecordingsDirectory = (dataDir) => path.join(dataDir, 'meetings');
const nested = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

function readLocation(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(file(dataDir), 'utf8'));
    const keys = new Set([
      'current',
      'recordings',
      'pending',
      'pendingRecordings',
      'cleanup',
      'recordingsCleanup',
    ]);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.entries(value).some(
        ([key, item]) => !keys.has(key) || typeof item !== 'string' || !path.isAbsolute(item),
      )
    )
      throw new Error('Invalid storage location metadata');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(
      `Cannot read ${file(dataDir)}. Restore this file to keep the configured external folders. ${error.message}`,
      { cause: error },
    );
  }
}

async function saveLocation(dataDir, value) {
  const next = { ...readLocation(dataDir), ...value };
  for (const [key, item] of Object.entries(next)) if (item === null) delete next[key];
  await writeAtomicFile(file(dataDir), JSON.stringify(next));
}

function currentDirectory(dataDir, override) {
  return override || readLocation(dataDir).current || defaultDirectory(dataDir);
}

function recordingsDirectory(dataDir, override) {
  return override || readLocation(dataDir).recordings || defaultRecordingsDirectory(dataDir);
}

async function emptyDirectory(directory) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Choose a regular folder');
  const resolved = await realpath(directory);
  if ((await readdir(resolved)).length) throw new Error('Choose an empty folder');
  return resolved;
}

async function setFirstRunDirectories(dataDir, { models, recordings }, overrides = {}) {
  const sourceModels = await realpath(currentDirectory(dataDir, overrides.models)).catch(() =>
    path.resolve(currentDirectory(dataDir, overrides.models)),
  );
  const sourceRecordings = await realpath(recordingsDirectory(dataDir, overrides.recordings)).catch(
    () => path.resolve(recordingsDirectory(dataDir, overrides.recordings)),
  );
  const nextModels = models ? await realpath(models) : sourceModels;
  const nextRecordings = recordings ? await realpath(recordings) : sourceRecordings;
  if (nested(nextModels, nextRecordings) || nested(nextRecordings, nextModels))
    throw new Error('Model and recording folders must be separate');
  if (nextModels !== sourceModels) {
    if (nested(sourceModels, nextModels) || nested(nextModels, sourceModels))
      throw new Error('Choose a folder outside the current model folder');
    await emptyDirectory(models);
  }
  if (nextRecordings !== sourceRecordings) {
    if (nested(sourceRecordings, nextRecordings) || nested(nextRecordings, sourceRecordings))
      throw new Error('Choose a folder outside the current recording folder');
    await emptyDirectory(recordings);
  }
  for (const target of [nextModels, nextRecordings]) {
    for (const source of [sourceModels, sourceRecordings]) {
      if (target !== source && (nested(source, target) || nested(target, source)))
        throw new Error('Choose separate folders outside the current data folders');
    }
  }
  const changed = nextModels !== sourceModels || nextRecordings !== sourceRecordings;
  if (changed)
    await saveLocation(dataDir, {
      ...(nextModels !== sourceModels ? { current: sourceModels } : {}),
      ...(nextRecordings !== sourceRecordings ? { recordings: sourceRecordings } : {}),
      pending: nextModels !== sourceModels ? nextModels : null,
      pendingRecordings: nextRecordings !== sourceRecordings ? nextRecordings : null,
    });
  return changed;
}

async function applyOneMove(
  dataDir,
  { currentKey, pendingKey, cleanupKey, fallback, markerName, label },
) {
  const location = readLocation(dataDir);
  if (location[cleanupKey]) {
    // 外置目标离线时保留旧目录，不能在检查目标之前删除最后一份可用文件。
    if (!(await lstat(location[currentKey])).isDirectory())
      throw new Error(`Current ${label} folder is unavailable`);
    if (
      (await readFile(path.join(location[currentKey], markerName), 'utf8')) !== location[cleanupKey]
    )
      throw new Error('Migration source does not match');
    await rm(location[cleanupKey], { recursive: true, force: true });
    await saveLocation(dataDir, { [cleanupKey]: null });
    await rm(path.join(location[currentKey], markerName), { force: true });
  }
  if (!location[pendingKey]) return;
  const source = location[currentKey] || fallback(dataDir);
  const target = location[pendingKey];
  if (source !== fallback(dataDir) && !fs.existsSync(source))
    throw new Error(`Current ${label} folder is unavailable`);
  const marker = path.join(target, markerName);
  const staging = `${target}.brevia-migration`;
  const stagingSource = path.join(staging, '.brevia-migration-source');
  if (!fs.existsSync(marker)) {
    if (fs.existsSync(staging)) {
      const owner = await readFile(stagingSource, 'utf8').catch(() =>
        readFile(path.join(staging, markerName), 'utf8').catch(() => null),
      );
      if (owner !== source) throw new Error(`Migration staging folder already exists: ${staging}`);
      // 复制未提交时重新复制源目录，避免恢复期间继续写入的文件被旧副本覆盖。
      if (!fs.existsSync(target)) await mkdir(target);
      await rm(staging, { recursive: true });
    }
    let present = [];
    try {
      present = await readdir(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // 崩溃恢复路径上 target 可能已被外部移除（例如 rmdir 之后 rename 之前中断）。
      // 把它当作空目录并补建，否则这次 ENOENT 会被 applyPendingMove 捕获、静默取消
      // 用户的整个目录迁移。
      await mkdir(target, { recursive: true });
    }
    if (present.length) throw new Error(`Chosen ${label} folder is no longer empty`);
    await mkdir(staging);
    await writeFile(stagingSource, source);
    if (fs.existsSync(source)) {
      for (const name of await readdir(source))
        await cp(path.join(source, name), path.join(staging, name), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
    }
    await writeFile(path.join(staging, markerName), source);
    await rm(stagingSource);
    // rmdir 原子地拒绝非空目录，保护复制期间由用户新放入的文件。
    await rmdir(target);
    await rename(staging, target);
  }
  if ((await readFile(marker, 'utf8')) !== source)
    throw new Error('Migration source does not match');
  await saveLocation(dataDir, { [currentKey]: target, [cleanupKey]: source, [pendingKey]: null });
  await rm(source, { recursive: true, force: true });
  await saveLocation(dataDir, { [cleanupKey]: null });
  await rm(marker);
}

async function applyPendingMove(dataDir) {
  try {
    await applyOneMove(dataDir, {
      currentKey: 'current',
      pendingKey: 'pending',
      cleanupKey: 'cleanup',
      fallback: defaultDirectory,
      markerName: '.brevia-models-migration',
      label: 'model',
    });
    await applyOneMove(dataDir, {
      currentKey: 'recordings',
      pendingKey: 'pendingRecordings',
      cleanupKey: 'recordingsCleanup',
      fallback: defaultRecordingsDirectory,
      markerName: '.brevia-recordings-migration',
      label: 'recording',
    });
  } catch (error) {
    // 失败后旧目录可能继续写入；取消未提交的移动，不能下次用陈旧副本覆盖它。
    await saveLocation(dataDir, { pending: null, pendingRecordings: null });
    throw error;
  }
}

module.exports = {
  readLocation,
  currentDirectory,
  recordingsDirectory,
  setFirstRunDirectories,
  applyPendingMove,
};
