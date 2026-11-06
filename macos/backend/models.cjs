const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const tar = require('tar');
const { TaskControl, TaskCancelled } = require('./tasks.cjs');
const activeInstallations = new Set();

const CAPABILITIES = {
  llm: ['summary', 'text', ['text']],
  transcription: ['refined', 'audio', ['transcript']],
  translation: ['translation', 'text', ['translation']],
  vad: ['vad', 'audio', ['speech_intervals']],
  separation: ['separation', 'audio', ['audio_tracks']],
  diarization: ['diarization', 'audio', ['speaker_turns', 'speaker_activity']],
  embedding: ['speaker-embedding', 'audio', ['speaker_embedding']],
};
function modelCapabilities(model) {
  if (model.capabilities) {
    for (const [name, value] of Object.entries(model.capabilities)) {
      const shape = CAPABILITIES[name];
      if (!shape || value?.input !== shape[1] || !shape[2].includes(value.output))
        throw new Error('Invalid model capability: ' + name);
    }
    return model.capabilities;
  }
  const result = {};
  for (const [name, [stage, input, outputs]] of Object.entries(CAPABILITIES)) {
    if (
      !model.stages?.includes(stage) ||
      (name === 'diarization' && model.kind === 'speaker-embedding')
    )
      continue;
    result[name] = {
      input,
      output:
        name === 'diarization' && model.kind === 'speaker-segmentation'
          ? 'speaker_activity'
          : outputs[0],
    };
  }
  return result;
}
function modelSupportsLanguage(model, language) {
  if (language === 'auto') return ['qwen3', 'whisper', 'nemo-transducer'].includes(model.kind);
  return model.languages?.some((value) => value === language || value === 'all') || false;
}
class ModelNotInstalled extends Error {
  constructor(models) {
    super('Models ' + models.join(', ') + ' are not installed');
    this.code = 'model_not_installed';
    this.models = models;
  }
}
function safePath(root, name) {
  const target = path.resolve(root, name);
  if (
    !name ||
    path.isAbsolute(name) ||
    target === root ||
    !target.startsWith(path.resolve(root) + path.sep)
  )
    throw new Error('Invalid model path');
  return target;
}
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const part of fs.createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
async function extract(file, directory, control) {
  await control.wait();
  await fsp.mkdir(directory, { recursive: true });
  // System libarchive decodes bzip2 as well as gzip. Only Node's checked extractor
  // writes files; stdin avoids Windows argv encoding issues in user directory names.
  const executable =
      process.platform === 'win32'
        ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
        : '/usr/bin/tar',
    child = spawn(executable, ['-cf', '-', '@-'], { windowsHide: true }),
    input = fs.createReadStream(file);
  let failure,
    stderr = '';
  const stop = (error) => {
    failure ||= error;
    input.destroy();
    child.kill('SIGKILL');
  };
  const exited = new Promise((resolve) => {
    child.once('error', stop);
    child.once('close', (code, signal) => {
      if (code !== 0)
        failure ||= new Error('Model archive decoder failed: ' + (stderr || signal || code));
      resolve();
    });
  });
  child.stderr.on('data', (data) => {
    stderr = (stderr + data.toString()).slice(-4096);
  });
  const unpack = tar.x({
    cwd: directory,
    strict: true,
    preservePaths: false,
    filter: (name, entry) => {
      if (failure) return false;
      try {
        safePath(directory, name.replace(/\/$/, ''));
        if (!['File', 'Directory', 'OldFile', 'ContiguousFile'].includes(entry.type))
          throw new Error('Unsupported model archive member');
        return true;
      } catch (error) {
        stop(error);
        return false;
      }
    },
  });
  unpack.on('error', stop);
  const unpacked = new Promise((resolve) => unpack.once('close', resolve)),
    abort = () => stop(control.signal.reason || new TaskCancelled()),
    feeding = pipeline(input, child.stdin).catch(stop);
  control.signal.addEventListener('abort', abort, { once: true });
  if (control.cancelled) abort();
  try {
    for await (const chunk of child.stdout) {
      await control.wait();
      if (failure) break;
      const ready = unpack.write(chunk);
      if (failure) break;
      if (!ready) await once(unpack, 'drain', { signal: control.signal });
    }
  } catch (error) {
    stop(error);
  } finally {
    // end() closes partial entries too; don't abort the parser with open output files.
    unpack.end();
    await Promise.all([feeding, exited, unpacked]);
    control.signal.removeEventListener('abort', abort);
  }
  await control.wait();
  if (failure) throw failure;
}
function modelDirectoryName(model) {
  return model.id + '-' + model.revision.replaceAll('/', '-');
}
class ModelManager {
  constructor(
    root,
    event = () => {},
    {
      bundledRoot = process.env.BREVIA_BUNDLED_MODELS_DIR,
      catalogPath = path.join(__dirname, '../../backend/models.json'),
      platform = process.platform,
    } = {},
  ) {
    this.root = path.resolve(root);
    this.bundledRoot = bundledRoot;
    this.event = event;
    this.platform = platform;
    fs.mkdirSync(this.root, { recursive: true });
    this.all = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    this.catalog = new Map();
    for (const model of this.all)
      if (!model.platforms || model.platforms.includes(platform === 'win32' ? 'windows' : platform))
        this.catalog.set(model.id, model);
    if (platform === 'darwin')
      for (const model of this.all)
        if (model.platforms?.includes('macos-webkit')) this.catalog.set(model.id, model);
    for (const model of this.catalog.values()) {
      model.capabilities = modelCapabilities(model);
      model.runtime_tier = 'core';
    }
    this.downloads = new Map();
    this.slots = 0;
  }
  get(id) {
    const value = this.catalog.get(id);
    if (!value) throw new Error('Unknown model');
    return value;
  }
  isKnown(id) {
    return this.catalog.has(id);
  }
  localPath(id) {
    return safePath(this.root, modelDirectoryName(this.get(id)));
  }
  bundledPath(id) {
    return this.bundledRoot ? safePath(this.bundledRoot, modelDirectoryName(this.get(id))) : null;
  }
  readyAt(id, directory) {
    return Boolean(
      directory && this.get(id).files.every((file) => fs.existsSync(safePath(directory, file))),
    );
  }
  isBundled(id) {
    return this.readyAt(id, this.bundledPath(id));
  }
  isReady(id) {
    return this.isKnown(id) && (this.readyAt(id, this.localPath(id)) || this.isBundled(id));
  }
  path(id) {
    const local = this.localPath(id);
    return !this.readyAt(id, local) && this.isBundled(id) ? this.bundledPath(id) : local;
  }
  list() {
    return [...this.catalog.values()].map((model) => ({
      ...model,
      status: this.isReady(model.id) ? 'ready' : 'not_installed',
      bundled: this.isBundled(model.id),
      supports_hotwords:
        ['qwen3', 'funasr-nano'].includes(model.kind) ||
        (model.kind === 'whisper' && model.runtime === 'mlx-audio'),
      path: this.isReady(model.id) ? this.path(model.id) : null,
    }));
  }
  missing(ids) {
    return [...new Set(ids.filter((id) => id && !this.isReady(id)))];
  }
  defaultModel(language) {
    const candidates = [...this.catalog.values()]
      .filter(
        (m) => m.capabilities.transcription && !m.retired && modelSupportsLanguage(m, language),
      )
      .sort((a, b) => (a.refined_priority ?? 99) - (b.refined_priority ?? 99));
    const declared = candidates.find((m) => m.default_for_languages?.includes(language));
    return (
      declared && this.isReady(declared.id)
        ? declared
        : candidates.find((m) => this.isReady(m.id)) || declared || candidates[0]
    )?.id;
  }
  device() {
    let physical = os.cpus().length;
    try {
      if (this.platform === 'darwin')
        physical = Number(
          execFileSync('/usr/sbin/sysctl', ['-n', 'hw.physicalcpu'], {
            encoding: 'utf8',
            timeout: 2000,
          }).trim(),
        );
    } catch {}
    return {
      architecture: os.arch(),
      asr_backend: this.platform === 'darwin' ? 'mlx-metal' : 'cpu',
      providers: ['CPUExecutionProvider'],
      backend: 'cpu',
      threads: Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))),
      cores: os.cpus().length,
      physical_cores: physical,
      weak: false,
    };
  }
  delete(id) {
    fs.rmSync(this.localPath(id), { recursive: true, force: true });
    this.event('model.status', {
      model_id: id,
      status: this.isBundled(id) ? 'ready' : 'not_installed',
    });
    return { model_id: id, deleted: true };
  }
  cleanupUnlisted() {
    const known = new Set(this.all.map((model) => model.id));
    const removed = [];
    let freed = 0;
    const size = (directory) =>
      fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
        const file = path.join(directory, entry.name);
        return (
          total + (entry.isDirectory() ? size(file) : entry.isFile() ? fs.statSync(file).size : 0)
        );
      }, 0);
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.root, entry.name);
      if (/^\.download-[A-Za-z0-9]{6}$/.test(entry.name)) {
        let owner;
        try {
          owner = JSON.parse(
            fs.readFileSync(path.join(directory, '.brevia-download.json'), 'utf8'),
          );
        } catch {
          continue;
        }
        if (typeof owner.id !== 'string' || !Number.isSafeInteger(owner.pid) || owner.pid < 1)
          continue;
        if (activeInstallations.has(directory)) continue;
        if (owner.pid !== process.pid)
          try {
            process.kill(owner.pid, 0);
            continue;
          } catch (error) {
            if (error.code !== 'ESRCH') continue;
          }
        freed += size(directory);
        fs.rmSync(directory, { recursive: true });
        removed.push(entry.name);
        continue;
      }
      let marker;
      try {
        marker = JSON.parse(fs.readFileSync(path.join(directory, '.brevia.json'), 'utf8'));
      } catch {
        continue;
      }
      if (!marker.id || known.has(marker.id)) continue;
      freed += size(directory);
      fs.rmSync(directory, { recursive: true });
      removed.push(entry.name);
    }
    return { removed, freed_bytes: freed };
  }
  downloadUrl(value, china) {
    if (!china) return value;
    if (value.startsWith('https://github.com/')) return 'https://gh-proxy.com/' + value;
    return value.replace(/^https:\/\/huggingface.co\//, 'https://hf-mirror.com/');
  }
  async downloadFile(url, destination, control, report) {
    if (new URL(url).protocol !== 'https:') throw new Error('Model downloads require HTTPS');
    for (let attempt = 0; attempt < 5; attempt++) {
      await control.wait();
      let received = fs.existsSync(destination) ? fs.statSync(destination).size : 0;
      const timeout = new AbortController();
      const signal = AbortSignal.any([control.signal, timeout.signal]);
      let timer, response;
      const reset = () => {
        clearTimeout(timer);
        timer = setTimeout(() => timeout.abort(new Error('Model download timed out')), 30000);
        timer.unref();
      };
      try {
        let current = new URL(url);
        for (let redirect = 0; redirect <= 8; redirect++) {
          if (current.protocol !== 'https:')
            throw Object.assign(new Error('Unsafe model redirect'), { code: 'unsafe_redirect' });
          reset();
          response = await fetch(current, {
            headers: received ? { Range: 'bytes=' + received + '-' } : {},
            redirect: 'manual',
            signal,
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirect === 8) throw new Error('Invalid model redirect');
          current = new URL(location, current);
        }
        if (response.status === 416) {
          const range = /^bytes \*\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
          await response.body?.cancel();
          if (range && received > 0 && Number(range[1]) === received) {
            report(received);
            return;
          }
          await fsp.rm(destination, { force: true });
          throw new Error('Invalid model download range');
        }
        if (!response.ok || !response.body)
          throw new Error('Model download failed (' + response.status + ')');
        const partial = response.status === 206;
        let expected = null;
        if (partial) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
            response.headers.get('Content-Range') || '',
          );
          if (
            !range ||
            Number(range[1]) !== received ||
            Number(range[2]) < received ||
            Number(range[2]) + 1 !== Number(range[3])
          ) {
            await response.body.cancel();
            await fsp.rm(destination, { force: true });
            throw new Error('Invalid model download range');
          }
          expected = Number(range[3]);
        } else {
          received = 0;
          const size = response.headers.get('content-length');
          if (size != null && /^\d+$/.test(size) && !response.headers.get('content-encoding'))
            expected = Number(size);
        }
        const output = await fsp.open(destination, partial ? 'a' : 'w');
        const reader = response.body.getReader();
        try {
          report(received);
          while (true) {
            // 暂停不计入网络超时；大权重仅在连续 30 秒未收到数据时重试。
            clearTimeout(timer);
            await control.wait();
            reset();
            const { value, done } = await reader.read();
            if (done) break;
            await output.writeFile(value);
            received += value.length;
            report(received);
          }
          if (expected !== null && received !== expected)
            throw new Error('Incomplete model download');
        } finally {
          await reader.cancel().catch(() => {});
          await output.close();
        }
        await control.wait();
        return;
      } catch (error) {
        clearTimeout(timer);
        await response?.body?.cancel().catch(() => {});
        await control.wait();
        if (attempt === 4 || error.code === 'unsafe_redirect') throw error;
        await delay(1000 * 2 ** attempt, undefined, { signal: control.signal });
      } finally {
        clearTimeout(timer);
      }
    }
  }
  async install(id, control, china = false) {
    const model = this.get(id);
    if (model.retired) throw new Error('Model ' + id + ' is no longer offered');
    if (this.isReady(id)) return this.path(id);
    const disk = fs.statfsSync(this.root);
    if (disk.bavail * disk.bsize < model.size_bytes * 2) throw new Error('Insufficient disk space');
    const temp = await fsp.mkdtemp(path.join(this.root, '.download-'));
    activeInstallations.add(temp);
    let source = path.join(temp, 'model'),
      digest = null;
    try {
      await fsp.writeFile(
        path.join(temp, '.brevia-download.json'),
        JSON.stringify({ id, pid: process.pid }),
        { flag: 'wx', mode: 0o600 },
      );
      await fsp.mkdir(source);
      const downloads = (china ? model.china_downloads : null) || model.downloads;
      if (downloads) {
        let received = 0;
        for (const item of downloads) {
          const destination = safePath(item.extract ? temp : source, item.path);
          await fsp.mkdir(path.dirname(destination), { recursive: true });
          await this.downloadFile(
            this.downloadUrl(item.url, china),
            destination,
            control,
            (value) =>
              this.event('model.progress', {
                model_id: id,
                received: received + value,
                total: model.size_bytes,
              }),
          );
          if (item.sha256 && (await checksum(destination)) !== item.sha256)
            throw new Error('Model download checksum mismatch');
          if (item.extract) {
            const directory = path.join(temp, 'extract-' + received);
            await extract(destination, directory, control);
            await fsp.cp(safePath(directory, item.directory), source, { recursive: true });
          }
          received += (await fsp.stat(destination)).size;
        }
      } else {
        const archive = path.join(temp, 'archive');
        await this.downloadFile(
          this.downloadUrl(china && model.china_url ? model.china_url : model.url, china),
          archive,
          control,
          (received) =>
            this.event('model.progress', { model_id: id, received, total: model.size_bytes }),
        );
        if (model.archive_sha256) {
          digest = await checksum(archive);
          if (digest !== model.archive_sha256) throw new Error('Model archive checksum mismatch');
        }
        if (model.directory) {
          const directory = path.join(temp, 'extract');
          await extract(archive, directory, control);
          source = safePath(directory, model.directory);
        } else await fsp.rename(archive, safePath(source, model.files[0]));
      }
      if (!this.readyAt(id, source)) throw new Error('Model archive is missing required files');
      await control.wait();
      await fsp.writeFile(
        path.join(source, '.brevia.json'),
        JSON.stringify(
          { ...model, downloaded_at: Date.now() / 1000, archive_sha256: digest },
          null,
          2,
        ),
      );
      const target = this.localPath(id),
        backup = path.join(temp, 'previous');
      if (fs.existsSync(target)) await fsp.rename(target, backup);
      try {
        await fsp.rename(source, target);
      } catch (error) {
        if (fs.existsSync(backup)) await fsp.rename(backup, target);
        throw error;
      }
      return target;
    } finally {
      activeInstallations.delete(temp);
      await fsp.rm(temp, { recursive: true, force: true });
    }
  }
  download(id, source) {
    this.get(id);
    const current = this.downloads.get(id);
    if (current) {
      current.paused = false;
      return { model_id: id, status: 'downloading' };
    }
    const control = new TaskControl();
    this.downloads.set(id, control);
    this.event('model.status', { model_id: id, status: 'downloading' });
    void (async () => {
      let acquired = false;
      try {
        while (this.slots >= 2) {
          await control.wait();
          await delay(50);
        }
        this.slots++;
        acquired = true;
        await this.install(id, control, source === 'china');
        this.event('model.status', { model_id: id, status: 'ready' });
      } catch (error) {
        this.event('model.status', {
          model_id: id,
          status: control.cancelled || error instanceof TaskCancelled ? 'cancelled' : 'failed',
          error: error.message,
        });
      } finally {
        if (acquired) this.slots--;
        this.downloads.delete(id);
      }
    })();
    return { model_id: id, status: 'downloading' };
  }
  pause(id) {
    const control = this.downloads.get(id);
    if (!control) return { model_id: id, status: 'not_downloading' };
    control.paused = true;
    const value = { model_id: id, status: 'paused' };
    this.event('model.status', value);
    return value;
  }
  cancel(id) {
    const control = this.downloads.get(id);
    if (!control) throw new Error('Model is not downloading');
    control.cancel();
    return { model_id: id, status: 'cancelling' };
  }
}
module.exports = { ModelManager, ModelNotInstalled, modelCapabilities, modelSupportsLanguage };
