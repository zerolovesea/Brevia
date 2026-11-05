const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} = require('node:fs/promises');
const path = require('node:path');
const { writeAtomicFile } = require('./main-logic');

const digest = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const registry = (root) => path.join(root, 'markdown-targets.json');
const missing = (error) => {
  if (error.code !== 'ENOENT') throw error;
  return null;
};

const bindingFile = (recordings, id) => path.join(recordings, id, 'markdown-target.json');

async function markdownTarget(root, recordings, id) {
  const [file, preferences] = await Promise.all([
    readFile(bindingFile(recordings, id), 'utf8').catch(missing),
    readFile(registry(root), 'utf8').catch(missing),
  ]);
  return {
    path: file ? JSON.parse(file).path : '',
    directory: preferences ? JSON.parse(preferences).directory : '',
  };
}

async function rememberFile(recordings, id, target) {
  const file = bindingFile(recordings, id);
  const temporary = file + '.' + randomUUID() + '.tmp';
  // 不重建父目录。会议永久删除、示例删除和到期清理同时清除其导出绑定。
  try {
    await writeFile(temporary, JSON.stringify({ path: target }), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function noteStem(title) {
  let stem = String(title || 'Brevia')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .trim()
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return Array.from(stem || 'Brevia')
    .slice(0, 48)
    .join('');
}

// 只更新专属内容块。没有标记、重复标记、用户改写块正文时，一律保留原文件。
function mergeMarkdown(previous, id, markdown) {
  const start = '<!-- brevia:' + id + ' ';
  const end = '<!-- /brevia:' + id + ' -->';
  if (markdown.includes(start) || markdown.includes(end)) return null;
  const eol = previous?.includes('\r\n') ? '\r\n' : '\n';
  const body = markdown.trim().replace(/\r\n?/g, '\n').replace(/\n/g, eol);
  const block = start + digest(body) + ' -->' + eol + body + eol + end;
  if (previous === null) return block + eol + eol;
  const first = previous.indexOf(start);
  const last = previous.indexOf(end);
  if (
    first < 0 ||
    last < first ||
    first !== previous.lastIndexOf(start) ||
    last !== previous.lastIndexOf(end)
  )
    return null;
  const managed = previous
    .slice(first + start.length, last)
    .match(/^([0-9a-f]{64}) -->\r?\n([\s\S]*)\r?\n$/);
  if (!managed || digest(managed[2].replace(/\r$/, '')) !== managed[1]) return null;
  return previous.slice(0, first) + block + previous.slice(last + end.length);
}

async function syncDirectory(directory) {
  // Windows 不提供目录 fsync；在支持它的文件系统上，先固化新入口，再撤掉恢复标记。
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
  } finally {
    await handle.close();
  }
}

async function copyExclusive(source, target) {
  await copyFile(source, target, constants.COPYFILE_EXCL);
  const handle = await open(target, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// link 以独占方式发布已经完整写好的文件；不支持硬链接的磁盘也禁止覆盖现有项。
async function publish(source, target) {
  try {
    await link(source, target);
  } catch (error) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
    await copyExclusive(source, target);
  }
}

const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const maxNoteBytes = 32 * 1024 * 1024;

// 文件名保留实际内容校验和；UUID 区分内容相同但仍有不同编辑器句柄的版本。
// 每次只 stat 已验证过的旧文件，元数据变化或应用重启后再按字节核对。
const priorFingerprints = new Map();
const versionPattern = /^([a-f0-9]{64})(?:\.[a-f0-9-]{36})?\.(previous|pending)$/;
async function priorMatches(file, checksum) {
  const stat = await lstat(file, { bigint: true });
  if (!stat.isFile() || stat.size > maxNoteBytes) return false;
  const fingerprint = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('.');
  if (priorFingerprints.get(file) === fingerprint) return true;
  if (hashBytes(await readFile(file)) !== checksum) return false;
  // FAT 等磁盘的时间戳精度可低至两秒，在同一个时钟刻度内不能排除等长覆盖。
  const stableBefore = BigInt(Date.now() - 2100) * 1000000n;
  if (stat.mtimeNs < stableBefore && stat.ctimeNs < stableBefore)
    priorFingerprints.set(file, fingerprint);
  return true;
}

async function changedPrior(prior, target) {
  const directory = path.dirname(target);
  if (!(await lstat(prior)).isFile()) return { status: 'conflict', recoveryPath: prior };
  const recovery = await mkdtemp(path.join(directory, 'Brevia-recovery-'));
  await syncDirectory(directory);
  const recoveryPath = path.join(recovery, path.basename(target));
  // rename 保留旧 inode，后续通过同一已打开句柄写入的手记也落在可见副本。
  await rename(prior, recoveryPath);
  priorFingerprints.delete(prior);
  await syncDirectory(recovery);
  await syncDirectory(directory);
  await syncDirectory(path.dirname(prior));
  return { status: 'conflict', recoveryPath };
}

async function retainPrior(pending, checksum) {
  const history = path.dirname(pending);
  const previous = path.join(history, checksum + '.' + randomUUID() + '.previous');
  await rename(pending, previous);
  priorFingerprints.delete(pending);
  await syncDirectory(history);
  return previous;
}

async function restoreIfMissing(source, target) {
  if (!(await lstat(source)).isFile()) return;
  try {
    // 恢复到独立 inode，用户正常写回当前版本时不会误报为对历史版本的修改。
    await copyExclusive(source, target);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await syncDirectory(path.dirname(target));
}

async function checkHistory(history, target) {
  const info = await lstat(history).catch(missing);
  if (!info) return null;
  if (!info.isDirectory()) return { status: 'conflict', recoveryPath: history };
  const versions = [];
  for (const name of await readdir(history)) {
    const parsed = versionPattern.exec(name);
    if (!parsed) return { status: 'conflict', recoveryPath: history };
    versions.push({ file: path.join(history, name), checksum: parsed[1], phase: parsed[2] });
  }
  const interrupted = versions.filter((version) => version.phase === 'pending');
  if (interrupted.length > 1) return { status: 'conflict', recoveryPath: history };
  // 中断版本优先恢复；即使另一历史版本有手记，工作流目标也先恢复为可打开的文件。
  const pending = interrupted[0];
  let restoredPrior;
  if (pending) {
    if (!(await lstat(pending.file)).isFile())
      return { status: 'conflict', recoveryPath: pending.file };
    await restoreIfMissing(pending.file, target);
    if (!(await priorMatches(pending.file, pending.checksum)))
      return changedPrior(pending.file, target);
    restoredPrior = await retainPrior(pending.file, pending.checksum);
  }
  for (const version of versions) {
    if (version !== pending && !(await priorMatches(version.file, version.checksum)))
      return changedPrior(version.file, target);
  }
  return { restoredPrior };
}

async function updateNote(target, id, markdown, existing) {
  const directory = path.dirname(target);
  const history = path.join(
    directory,
    '.brevia-' + digest(id + path.basename(target)).slice(0, 24),
  );
  const inspected = existing ? await checkHistory(history, target) : null;
  if (inspected?.status) return inspected;
  // 中断时若另一个程序写入了无效或不属于 Brevia 的目标，把原笔记交给用户选择。
  const conflict = () =>
    inspected?.restoredPrior
      ? changedPrior(inspected.restoredPrior, target)
      : { status: 'conflict' };
  const info = await lstat(target).catch(missing);
  if (info && !existing) return { status: 'occupied' };
  if ((existing && !info) || (info && (!info.isFile() || info.size > maxNoteBytes)))
    return conflict();
  const original = info ? await readFile(target) : null;
  let text = null;
  if (original) {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
    } catch {
      return conflict();
    }
  }
  const next = mergeMarkdown(text, id, markdown);
  if (next === null) return conflict();
  if (next === text) return { status: 'saved' };
  const temporary = path.join(directory, '.brevia-' + randomUUID() + '.tmp');
  try {
    const handle = await open(temporary, 'wx', info?.mode ?? 0o600);
    try {
      await handle.writeFile(next);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (original) {
      if (await mkdir(history, { recursive: true, mode: 0o700 })) await syncDirectory(directory);
      const checksum = hashBytes(original);
      const backup = path.join(history, checksum + '.' + randomUUID() + '.pending');
      await rename(target, backup);
      await syncDirectory(history);
      await syncDirectory(directory);
      try {
        if (!(await priorMatches(backup, checksum))) {
          await restoreIfMissing(backup, target);
          return changedPrior(backup, target);
        }
        await publish(temporary, target);
      } catch (error) {
        if (error.code === 'EEXIST') return changedPrior(backup, target);
        // 保留 pending，重试时可确认恢复，勿覆盖外部编辑器创建的新文件。
        await restoreIfMissing(backup, target);
        throw error;
      }
      await syncDirectory(directory);
      if (!(await priorMatches(backup, checksum))) return changedPrior(backup, target);
      await retainPrior(backup, checksum);
    } else {
      try {
        await publish(temporary, target);
        await syncDirectory(directory);
      } catch (error) {
        if (error.code === 'EEXIST') return { status: 'occupied' };
        throw error;
      }
    }
    return { status: 'saved' };
  } finally {
    await rm(temporary, { force: true });
  }
}

let pending = Promise.resolve();
function serializeMarkdown(operation) {
  const task = pending.then(operation);
  pending = task.catch(() => {});
  return task;
}

function syncMarkdown(root, recordings, getMeeting, mode, pickDirectory) {
  return serializeMarkdown(async () => {
    const meeting = await getMeeting();
    if (meeting.deleted_at) throw new Error('Meeting was deleted');
    const markdown = meeting.markdown;
    if (!markdown?.trim()) throw new Error('No saved Markdown summary');
    const previous = await markdownTarget(root, recordings, meeting.id);
    let directory = previous.path ? path.dirname(previous.path) : previous.directory;
    if (!directory || mode === 'choose') {
      directory = await pickDirectory(directory);
      if (!directory) return null;
      directory = await realpath(directory);
    }
    if ((await realpath(directory)) !== directory)
      return { status: 'conflict', path: previous.path || directory };
    const reuse = previous.path && mode === 'sync';
    const stem = noteStem(meeting.title);
    for (let i = 1; i <= 10000; i++) {
      const target = reuse
        ? previous.path
        : path.join(directory, stem + (i === 1 ? '' : ' (' + i + ')') + '.md');
      const result = await updateNote(target, meeting.id, markdown, reuse);
      if (result.status === 'occupied') continue;
      if (result.status === 'saved' && !reuse) {
        await rememberFile(recordings, meeting.id, target);
        if (directory !== previous.directory)
          await writeAtomicFile(registry(root), JSON.stringify({ directory }));
      }
      return { ...result, path: target, directory };
    }
    throw new Error('Too many Markdown files with this name');
  });
}

async function sendGroupSummary(address, text, request = fetch) {
  // 机器人令牌仅本次使用。禁止重定向，避免携带会议内容访问其他服务。
  if (
    !/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(
      address,
    )
  )
    return 'address';
  const body = JSON.stringify({ msg_type: 'text', content: { text } });
  if (Buffer.byteLength(body) > 20000) return 'size';
  try {
    const response = await request(address, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return 'failed';
    const data = await response.json();
    return data.code === 0 || (data.code === undefined && data.StatusCode === 0)
      ? 'sent'
      : 'failed';
  } catch {
    return 'failed';
  }
}

module.exports = { markdownTarget, syncMarkdown, serializeMarkdown, sendGroupSummary };
