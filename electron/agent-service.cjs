const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { schemas, scopeFor, failure } = require('./agent-contract.cjs');
const { z } = require('zod');
const { writeAtomicFile } = require('./main-logic');

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    permissions: z.object({ read: z.boolean(), infer: z.boolean(), record: z.boolean() }).strict(),
  })
  .strict();

function locations(root) {
  const canonical = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  const directory = path.join(canonical, '.agent');
  const hash = createHash('sha256').update(canonical).digest('hex');
  const socketDirectory =
    process.platform === 'win32'
      ? directory
      : path.join('/tmp', `brevia-agent-${process.getuid()}-${hash.slice(0, 24)}`);
  return {
    directory,
    socketDirectory,
    credentials: path.join(directory, 'credentials.json'),
    settings: path.join(directory, 'settings.json'),
    socket:
      process.platform === 'win32'
        ? '\\\\.\\pipe\\brevia-' + hash.slice(0, 24)
        : path.join(socketDirectory, 'control.sock'),
    recoveryPort: 20000 + (Number.parseInt(hash.slice(0, 8), 16) % 20000),
  };
}
const errorResult = (error) => ({
  code: error.code || 'operation_failed',
  message: error.message,
  ...(error.models ? { models: error.models } : {}),
});
class AgentService {
  constructor({ root, request, status, devices, recording }) {
    Object.assign(this, { root, request, status, devices, recording });
    this.jobs = new Map();
    this.queue = Promise.resolve();
    this.ready = false;
    this.settings = { enabled: true, permissions: { read: true, infer: true, record: true } };
  }
  getSettings() {
    return {
      ...structuredClone(this.settings),
      status: {
        running: Boolean(this.server?.listening),
        ready: this.ready,
        enabled: this.settings.enabled,
        ...(this.settingsError ? { error: this.settingsError } : {}),
      },
    };
  }
  async saveSettings(payload) {
    const value = settingsSchema.parse(payload);
    await writeAtomicFile(this.paths.settings, JSON.stringify(value) + '\n');
    this.settings = value;
    this.settingsError = null;
    return this.getSettings();
  }
  progress(type, p) {
    const job = this.jobs.get(p?.meeting_id);
    if (job && job.status === 'running')
      job.progress = { event: type, stage: p.stage, completed: p.completed, total: p.total };
  }
  async invoke(method, payload, scope) {
    if (!schemas[method]) throw failure('unknown_method', 'Unknown method: ' + method);
    if (scope !== scopeFor(method) && !(method === 'task.get' && scope === 'infer'))
      throw failure('forbidden', 'Required permission: ' + scopeFor(method));
    const stopping =
      method === 'task.cancel' || (method === 'recording.control' && payload?.action === 'stop');
    if ((!this.settings.enabled || !this.settings.permissions[scope]) && !stopping)
      throw failure('permission_disabled', 'This Agent permission is disabled in Brevia settings');
    const p = schemas[method].parse(payload);
    if (!this.ready) throw failure('not_ready', 'Brevia is still initializing');
    if (method === 'app.status') return { running: true, ready: true, ...this.status() };
    if (method === 'devices.list') return this.devices();
    if (method === 'recording.control') return this.recording(p);
    if (method === 'task.get' || method === 'task.cancel') {
      const job = this.jobs.get(p.task_id);
      if (!job)
        throw failure('task_not_found', 'Task is unavailable (expired or application restarted)');
      if (method === 'task.cancel' && ['queued', 'running'].includes(job.status)) {
        job.cancel_requested = true;
        if (job.status === 'running')
          await this.request('agent.cancel', { meeting_id: job.task_id });
        else {
          job.status = 'cancelled';
          job.finished_at = Date.now();
        }
      }
      return method === 'task.cancel'
        ? {
            task_id: job.task_id,
            status: job.status,
            cancel_requested: Boolean(job.cancel_requested),
          }
        : job;
    }
    if (method !== 'inference.run') return this.request(method, p);
    for (const [id, job] of this.jobs)
      if (job.finished_at && Date.now() - job.finished_at > 3600000) this.jobs.delete(id);
    if ([...this.jobs.values()].filter((j) => !j.finished_at).length >= 4 || this.jobs.size >= 128)
      throw failure('busy', 'Agent task limit reached');
    const job = { task_id: randomUUID(), status: 'queued', created_at: Date.now(), progress: null };
    this.jobs.set(job.task_id, job);
    // 推理串行共享业务引擎，排队不预加载模型，避免 Agent 同时提交时叠加内存峰值。
    this.queue = this.queue.then(async () => {
      try {
        if (job.cancel_requested) {
          job.status = 'cancelled';
          return;
        }
        job.status = 'running';
        const result = await this.request('agent.run', { ...p, meeting_id: job.task_id });
        job.status = result.cancelled ? 'cancelled' : 'completed';
        job.result = result;
      } catch (error) {
        job.status = job.cancel_requested ? 'cancelled' : 'failed';
        job.error = errorResult(error);
      } finally {
        job.finished_at = Date.now();
      }
    });
    return { ...job };
  }
  async listen() {
    fs.mkdirSync(this.root, { recursive: true });
    this.paths = locations(this.root);
    fs.mkdirSync(this.paths.directory, { recursive: true, mode: 0o700 });
    const info = fs.lstatSync(this.paths.directory);
    if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()))
      throw failure('unsafe_control_directory', 'Agent directory must belong to the current user');
    if (process.platform === 'win32') {
      // Windows 不实施 POSIX mode，先收紧目录 DACL，再写入继承此权限的凭据。
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `
        $ErrorActionPreference = 'Stop'
        $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $acl.SetOwner($owner)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $env:BREVIA_AGENT_DIRECTORY -AclObject $acl
      `,
        ],
        {
          env: { ...process.env, BREVIA_AGENT_DIRECTORY: this.paths.directory },
          windowsHide: true,
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      if (result.error || result.status !== 0)
        throw failure(
          'unsafe_control_directory',
          'Cannot secure Windows Agent credentials: ' +
            (result.error?.message || result.stderr.trim()),
        );
    } else {
      for (const directory of new Set([this.paths.directory, this.paths.socketDirectory])) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.uid !== process.getuid())
          throw failure(
            'unsafe_control_directory',
            'Agent socket directory must belong to the current user and cannot be a symlink',
          );
        fs.chmodSync(directory, 0o700);
      }
    }
    // 此监听同时是所有桌面入口的数据锁，必须先于 Worker 和数据库启动。
    this.server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      try {
        if (req.method !== 'POST' || req.url !== '/v1' || req.headers.origin)
          throw failure('forbidden', 'Only authenticated local POST requests are allowed');
        const supplied = Buffer.from(
          String(req.headers.authorization || '').replace(/^Bearer /, ''),
        );
        const scope = Object.keys(this.tokens).find((key) => {
          const token = Buffer.from(this.tokens[key]);
          return token.length === supplied.length && timingSafeEqual(token, supplied);
        });
        if (!scope) throw failure('unauthorized', 'Invalid local credential');
        const chunks = [];
        let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > 2 * 1024 * 1024) throw failure('too_large', 'Request exceeds 2 MiB');
          chunks.push(part);
        }
        const { method, params = {} } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.end(JSON.stringify({ ok: true, result: await this.invoke(method, params, scope) }));
      } catch (error) {
        res.statusCode = ['unauthorized', 'forbidden'].includes(error.code) ? 403 : 400;
        res.end(JSON.stringify({ ok: false, error: errorResult(error) }));
      }
    });
    this.server.requestTimeout = 15000;
    this.server.headersTimeout = 10000;
    // 内核独占绑定只序列化启动与旧 socket 回收；不用可被并发删除的 PID 文件锁。
    const recovery = net.createServer((socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        recovery.once('error', reject);
        recovery.listen(
          { host: '127.0.0.1', port: this.paths.recoveryPort, exclusive: true },
          () => {
            recovery.removeListener('error', reject);
            resolve();
          },
        );
      });
    } catch (error) {
      if (error.code === 'EADDRINUSE')
        throw failure(
          'already_running',
          'Brevia startup is busy (another launch or a local recovery-port conflict)',
        );
      throw error;
    }
    const bind = () =>
      new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.paths.socket, () => {
          this.server.removeListener('error', reject);
          resolve();
        });
      });
    try {
      try {
        await bind();
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        if (process.platform === 'win32')
          throw failure('already_running', 'Brevia already owns this data directory');
        // 必须在回收互斥内重新探测，不能用等待互斥之前观察到的旧状态。
        const stale = await new Promise((resolve) => {
          const probe = net.connect(this.paths.socket);
          probe.setTimeout(1000);
          probe.once('connect', () => {
            probe.destroy();
            resolve(false);
          });
          probe.once('timeout', () => {
            probe.destroy();
            resolve(false);
          });
          probe.once('error', (e) => resolve(e.code === 'ECONNREFUSED'));
        });
        if (!stale) throw failure('already_running', 'Brevia already owns this data directory');
        fs.unlinkSync(this.paths.socket);
        await bind();
      }
      try {
        const settingsFile = fs.lstatSync(this.paths.settings);
        if (!settingsFile.isFile()) throw new Error('Agent settings must be a regular file');
        this.settings = settingsSchema.parse(
          JSON.parse(fs.readFileSync(this.paths.settings, 'utf8')),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.settings.enabled = false;
          this.settingsError = 'Agent settings could not be read; save settings to recover';
        }
      }
      this.tokens = Object.fromEntries(
        ['read', 'infer', 'record'].map((scope) => [scope, randomBytes(32).toString('hex')]),
      );
      // 不跟随凭据文件软链；每次启动轮换令牌。
      const temporary = this.paths.credentials + '.' + randomUUID();
      try {
        fs.writeFileSync(
          temporary,
          JSON.stringify({ socket: this.paths.socket, tokens: this.tokens }),
          { flag: 'wx', mode: 0o600 },
        );
        fs.renameSync(temporary, this.paths.credentials);
        if (process.platform !== 'win32') fs.chmodSync(this.paths.socket, 0o600);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    } catch (error) {
      if (this.server.listening) await new Promise((resolve) => this.server.close(resolve));
      throw error;
    } finally {
      await new Promise((resolve) => recovery.close(resolve));
    }
  }

  close() {
    this.ready = false;
    return new Promise((resolve) => this.server?.close(resolve) || resolve());
  }
}
module.exports = { AgentService, locations, errorResult };
