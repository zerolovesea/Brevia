const https = require('node:https');
const { Bonjour } = require('bonjour-service');
const { networkInterfaces, hostname } = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {
  createHash,
  randomBytes,
  randomInt,
  X509Certificate,
  timingSafeEqual,
} = require('node:crypto');
const { z } = require('zod');
const selfsigned = require('selfsigned');
const QRCode = require('qrcode');
const hash = (v) => createHash('sha256').update(v).digest('hex');
const uuid = z.string().uuid();
const createSession = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(120),
  language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru', 'auto']).default('zh'),
  target_language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']).nullable().optional(),
  workspace_id: uuid.nullable().optional(),
  refined_model_id: z.string().max(100).optional(),
  speaker_segmentation_model_id: z.string().max(100).optional(),
  vad_model_id: z.string().max(100).optional(),
});
const fail = (status, message) => Object.assign(new Error(message), { status });

async function atomicJSON(file, value) {
  const tmp = `${file}.tmp`;
  const handle = await fs.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
  // Flush directory metadata where the platform supports it.
  try {
    const d = await fs.open(path.dirname(file), 'r');
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } catch (e) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(e.code)) throw e;
  }
}
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}
async function body(req) {
  if (Number(req.headers['content-length']) > 60000) throw fail(413, '请求过大');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 60000) throw fail(413, '请求过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(400, '无效请求');
  }
}

class MobileServer {
  constructor({
    directory,
    request,
    approve,
    active,
    discovered = () => {},
    advertise = true,
    port = 43187,
  }) {
    Object.assign(this, { directory, request, approve, active, discovered, advertise, port });
    this.lastSeen = new Map();
    this.discoveryNoticeAt = 0;
    this.queue = Promise.resolve();
    this.sessions = new Map();
    this.pairing = null;
    this.pairBusy = false;
    this.draining = false;
    this.devices = [];
  }
  serial(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.devices = await readJSON(path.join(this.directory, 'devices.json'), []);
    let identity = await readJSON(path.join(this.directory, 'identity.json'), null);
    if (!identity) {
      const keys = await selfsigned.generate([{ name: 'commonName', value: 'Brevia Local' }], {
        keySize: 2048,
        algorithm: 'sha256',
        days: 3650,
      });
      identity = { key: keys.private, cert: keys.cert };
      await atomicJSON(path.join(this.directory, 'identity.json'), identity);
    }
    this.identity = identity;
    this.fingerprint = hash(new X509Certificate(identity.cert).raw);
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isDirectory() && uuid.safeParse(e.name).success)) {
      const session = await readJSON(path.join(this.directory, entry.name, 'session.json'), null);
      if (session) {
        if (session.task?.state === 'running')
          session.task = { ...session.task, state: 'failed', error: '电脑已重启，请重新提交任务' };
        this.sessions.set(session.id, session);
      }
    }
    const config = await readJSON(path.join(this.directory, 'config.json'), {});
    if (config.enabled !== false) await this.enable();
  }
  async enable() {
    if (this.server) return this.status();
    const server = https.createServer({ ...this.identity, minVersion: 'TLSv1.2' }, (req, res) => {
      this.route(req)
        .then((value) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(value));
        })
        .catch((error) => {
          res.writeHead(error.status || (error instanceof z.ZodError ? 400 : 500), {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(
            JSON.stringify({
              error:
                error.status || error instanceof z.ZodError
                  ? error.message
                  : '电脑暂时无法完成请求，请重试',
            }),
          );
        });
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.maxConnections = 12;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '0.0.0.0', resolve);
    });
    this.server = server;
    server.on('error', (e) => {
      this.lastError = e.message;
    });
    this.port = server.address().port;
    if (this.advertise) {
      this.bonjour = new Bonjour({}, (error) => {
        this.lastError = error.message;
      });
      this.advertisement = this.bonjour.publish({
        name: `Brevia ${hostname()}`,
        type: 'brevia',
        port: this.port,
      });
      this.advertisement.on('error', (error) => {
        this.lastError = error.message;
      });
    }
    await atomicJSON(path.join(this.directory, 'config.json'), { enabled: true });
    this.timer = setInterval(() => {
      void this.drain();
    }, 1000);
    this.timer.unref();
    return this.status();
  }
  async disable() {
    this.pairing = null;
    clearInterval(this.timer);
    this.bonjour?.destroy();
    this.bonjour = null;
    this.lastSeen.clear();
    if (this.server) {
      const server = this.server;
      this.server = null;
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    await atomicJSON(path.join(this.directory, 'config.json'), { enabled: false });
    return this.status();
  }
  status() {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.family === 'IPv4')
      .map((n) => `https://${n.address}:${this.port}`);
    return {
      enabled: !!this.server,
      name: hostname(),
      addresses,
      fingerprint: this.fingerprint,
      devices: this.devices.map(({ id, name, firstConnectedAt }) => ({
        id,
        name,
        firstConnectedAt: firstConnectedAt || null,
        recordingCount: [...this.sessions.values()].filter((s) => s.owner === id && s.samples > 0)
          .length,
        connected: !!this.server && Date.now() - (this.lastSeen.get(id) || 0) < 15000,
      })),
      sessions: [...this.sessions.values()].map(
        ({ id, title, next, processed, samples, state, ended, finished, error }) => ({
          id,
          title,
          next,
          processed,
          samples,
          state,
          ended,
          finished,
          error,
        }),
      ),
      error: this.lastError || null,
    };
  }
  async openPairing() {
    await this.enable();
    this.pairing = {
      pin: String(randomInt(100000, 1000000)),
      secret: randomBytes(24).toString('hex'),
      expires: Date.now() + 120000,
      attempts: 0,
    };
    const status = this.status();
    const payload = JSON.stringify({
      v: 1,
      address: status.addresses[0] || '',
      fingerprint: this.fingerprint,
      secret: this.pairing.secret,
    });
    return {
      ...status,
      pin: this.pairing.pin,
      expires: this.pairing.expires,
      qr: await QRCode.toDataURL(payload, { width: 256, margin: 2 }),
    };
  }
  async revoke(id) {
    if ([...this.sessions.values()].some((s) => s.owner === id && !s.finished))
      throw fail(409, '该设备仍有未完成的录音，请先结束并补传');
    this.devices = this.devices.filter((d) => d.id !== id);
    await atomicJSON(path.join(this.directory, 'devices.json'), this.devices);
    return this.status();
  }
  async pair(value) {
    const input = z
      .object({
        name: z.string().trim().min(1).max(60),
        code: z.string().min(6).max(64),
        nonce: z.string().regex(/^[a-f0-9]{32}$/),
      })
      .parse(value);
    const p = this.pairing;
    if (!p || p.expires < Date.now() || p.attempts >= 5)
      throw fail(403, '配对已过期或尝试过多，请在电脑重新开启配对');
    if (this.pairBusy) throw fail(409, '正在确认另一部手机');
    p.attempts++;
    const supplied = Buffer.from(hash(input.code));
    if (![p.pin, p.secret].some((code) => timingSafeEqual(supplied, Buffer.from(hash(code)))))
      throw fail(403, '配对码错误');
    const verification = hash(`${this.fingerprint}:${input.nonce}`).slice(0, 8).toUpperCase();
    this.pairBusy = true;
    try {
      const allowed = await this.approve({ name: input.name, verification });
      if (!allowed || this.pairing !== p || p.expires < Date.now())
        throw fail(403, '电脑未允许连接，请重新配对');
      const token = randomBytes(32).toString('hex');
      const id = randomBytes(16).toString('hex');
      this.devices.push({
        id,
        name: input.name,
        firstConnectedAt: new Date().toISOString(),
        tokenHash: hash(token),
      });
      await atomicJSON(path.join(this.directory, 'devices.json'), this.devices);
      this.pairing = null;
      return { token, deviceId: id, name: hostname(), fingerprint: this.fingerprint };
    } finally {
      this.pairBusy = false;
    }
  }
  owner(req) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) throw fail(401, '请重新配对电脑');
    const digest = Buffer.from(hash(token));
    const device = this.devices.find((d) => timingSafeEqual(Buffer.from(d.tokenHash), digest));
    if (!device) throw fail(401, '电脑已取消信任，请重新配对');
    this.lastSeen.set(device.id, Date.now());
    return device.id;
  }
  session(id, owner) {
    const s = this.sessions.get(uuid.parse(id));
    if (!s || s.owner !== owner) throw fail(404, '会议不存在');
    return s;
  }
  requestStop(id) {
    return this.serial(async () => {
      const s = this.sessions.get(uuid.parse(id));
      if (!s) throw fail(404, '会议不存在');
      if (!s.ended) {
        const next = { ...s, stopRequested: true };
        await this.save(next);
        Object.assign(s, next);
      }
      return { requested: true, connected: Date.now() - (this.lastSeen.get(s.owner) || 0) < 15000 };
    });
  }
  save(s) {
    return atomicJSON(path.join(this.directory, s.id, 'session.json'), s);
  }
  async route(req) {
    // Browser pages cannot use this native API (no CORS or cookie authentication).
    if (req.headers.origin) throw fail(403, '仅允许已配对的手机应用');
    if (req.url === '/identity' && req.method === 'GET') {
      // Discovery is only a prompt, never authentication. Bound prompts globally.
      if (Date.now() - this.discoveryNoticeAt > 120000) {
        this.discoveryNoticeAt = Date.now();
        this.discovered();
      }
      return { v: 1, name: hostname(), fingerprint: this.fingerprint };
    }
    if (req.url === '/pair' && req.method === 'POST') return this.pair(await body(req));
    const owner = this.owner(req);
    if (req.url === '/options' && req.method === 'GET') return this.request('mobile.options', {});
    if (req.url === '/meetings' && req.method === 'GET')
      return [...this.sessions.values()]
        .filter((s) => s.owner === owner)
        .map((s) => ({
          id: s.id,
          title: s.title,
          ended: s.ended,
          finished: s.finished,
          samples: s.samples,
        }));
    const value = req.method === 'POST' || req.method === 'PUT' ? await body(req) : null;
    if (req.url === '/prepare' && req.method === 'POST')
      return this.request('mobile.prepare', createSession.parse(value));
    if (req.url === '/meetings' && req.method === 'POST')
      return this.serial(async () => {
        const v = createSession.parse(value);
        if (this.sessions.has(v.id)) return this.session(v.id, owner);
        if (this.active() || [...this.sessions.values()].some((s) => !s.finished))
          throw fail(409, '电脑有未完成的录音，请先结束并补传');
        await this.request('mobile.prepare', v);
        const s = {
          ...v,
          owner,
          next: 0,
          processed: 0,
          samples: 0,
          ended: false,
          finished: false,
          marks: [],
        };
        await fs.mkdir(path.join(this.directory, s.id), { recursive: true, mode: 0o700 });
        await this.save(s);
        this.sessions.set(s.id, s);
        return { id: s.id, next: 0, samples: 0 };
      });
    const match = /^\/meetings\/([a-f0-9-]+)\/(snapshot|chunks|end|marks|state|action)$/.exec(
      req.url,
    );
    if (!match) throw fail(404, '未找到接口');
    const s = this.session(match[1], owner);
    if (match[2] === 'snapshot' && req.method === 'GET') {
      let meeting = null;
      try {
        meeting = await this.request('meeting.get', { meeting_id: s.id });
      } catch {
        /* Durable spool can exist before worker creation. */
      }
      // Never expose PC filesystem paths or unrelated meeting data to a phone.
      return {
        id: s.id,
        next: s.next,
        samples: s.samples,
        processed: s.processed,
        ended: s.ended,
        finished: s.finished,
        stopRequested: s.stopRequested === true,
        task: s.task || null,
        workspace_id: meeting?.workspace_id ?? s.workspace_id ?? null,
        error: s.error || s.processingWarning || null,
        marks: s.marks,
        title: meeting?.title || s.title,
        notes: meeting?.notes || '',
        segments: meeting?.segments || [],
        summary: meeting?.summary || null,
      };
    }
    return this.serial(async () => {
      if (match[2] === 'action' && req.method === 'POST') {
        const v = z
          .discriminatedUnion('action', [
            z.object({ action: z.literal('workspace'), workspace_id: uuid.nullable() }),
            z.object({ action: z.literal('refine'), request_id: uuid }),
            z.object({
              action: z.literal('translate'),
              request_id: uuid,
              target_language: createSession.shape.target_language.unwrap().unwrap(),
              consent: z.literal(true),
            }),
          ])
          .parse(value);
        if (!s.finished) throw fail(409, '请先结束录音并完成同步');
        if (s.task?.state === 'running') {
          if (s.task.id === v.request_id) return { task: s.task };
          throw fail(409, '电脑正在处理这场会议，请稍后重试');
        }
        if (v.action === 'workspace') {
          await this.request('workspace.assign', {
            meeting_id: s.id,
            workspace_id: v.workspace_id,
          });
          const next = { ...s, workspace_id: v.workspace_id };
          await this.save(next);
          Object.assign(s, next);
          return { saved: true };
        }
        if (s.task?.id === v.request_id) return { task: s.task };
        const next = { ...s, task: { id: v.request_id, action: v.action, state: 'running' } };
        await this.save(next);
        Object.assign(s, next);
        // Long desktop tasks return immediately; phones poll the existing snapshot for completion.
        Promise.resolve()
          .then(() =>
            this.request(v.action === 'refine' ? 'meeting.refine' : 'mobile.translate', {
              meeting_id: s.id,
              target_language: v.target_language,
              consent: v.consent,
            }),
          )
          .then((result) => {
            if (result?.model_required) throw new Error('请先在电脑安装所需模型');
            return { ...s.task, state: 'done' };
          })
          .catch((error) => ({ ...s.task, state: 'failed', error: error.message }))
          .then((task) =>
            this.serial(async () => {
              const updated = { ...s, task };
              await this.save(updated);
              Object.assign(s, updated);
            }),
          )
          .catch((error) => {
            s.task = { ...s.task, state: 'failed', error: error.message };
          });
        return { task: s.task };
      }
      if (match[2] === 'state' && req.method === 'POST') {
        const v = z
          .object({ state: z.enum(['starting', 'recording', 'paused', 'interrupted', 'ended']) })
          .parse(value);
        s.state = v.state;
        return { saved: true };
      }
      if (match[2] === 'chunks' && req.method === 'PUT') {
        const v = z
          .object({
            seq: z.number().int().min(0).max(1000000),
            start_sample: z.number().int().min(0),
            pcm: z.string().min(4).max(42668),
          })
          .parse(value);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.pcm))
          throw fail(400, '无效音频');
        const pcm = Buffer.from(v.pcm, 'base64');
        if (!pcm.length || pcm.length > 32000 || pcm.length % 2) throw fail(400, '无效音频长度');
        const file = path.join(this.directory, s.id, `${v.seq}.json`);
        if (v.seq < s.next) {
          const previous = await readJSON(file, null);
          if (!previous || previous.pcm !== v.pcm || previous.start_sample !== v.start_sample)
            throw fail(409, '音频分片冲突');
          return { next: s.next, samples: s.samples };
        }
        if (s.ended || v.seq !== s.next || v.start_sample !== s.samples)
          throw fail(409, '请从电脑确认的位置补传');
        // Ack only after both audio and its manifest are durable. A failed manifest
        // update leaves an orphan that the same next upload may safely overwrite.
        await atomicJSON(file, v);
        const next = { ...s, next: s.next + 1, samples: s.samples + pcm.length / 2 };
        await this.save(next);
        Object.assign(s, next);
        return { next: s.next, samples: s.samples };
      }
      if (match[2] === 'end' && req.method === 'POST') {
        const v = z
          .object({
            count: z.number().int().nonnegative(),
            samples: z.number().int().nonnegative(),
          })
          .parse(value);
        if (v.count !== s.next || v.samples !== s.samples) throw fail(409, '仍有录音未补传');
        const next = { ...s, ended: true };
        await this.save(next);
        Object.assign(s, next);
        return { ended: true };
      }
      if (match[2] === 'marks' && req.method === 'POST') {
        const v = z
          .object({ id: uuid, sample: z.number().int().nonnegative(), note: z.string().max(200) })
          .parse(value);
        if (!s.marks.some((m) => m.id === v.id)) {
          if (s.marks.length >= 10000) throw fail(400, '重点数量已达上限');
          const next = { ...s, marks: [...s.marks, v] };
          await this.save(next);
          Object.assign(s, next);
        }
        return { saved: true };
      }
      throw fail(405, '不支持此操作');
    });
  }
  async drain() {
    if (this.draining || !this.server) return;
    this.draining = true;
    try {
      const s = [...this.sessions.values()].find((value) => !value.finished);
      if (!s) return;
      try {
        await this.request('mobile.apply', {
          ...createSession.parse(s),
          action: 'start',
          meeting_id: s.id,
          tags: ['手机录音'],
        });
        // ponytail: one worker and ordered replay; separate processing workers if concurrent meetings become a requirement.
        if (s.processed < s.next) {
          const chunk = await readJSON(
            path.join(this.directory, s.id, `${s.processed}.json`),
            null,
          );
          if (!chunk) throw new Error('电脑音频缓存缺失，请保留手机录音并导出');
          await this.request('mobile.apply', { ...chunk, meeting_id: s.id, action: 'chunk' });
          await this.serial(async () => {
            const next = { ...s, processed: s.processed + 1, error: null };
            await this.save(next);
            Object.assign(s, next);
          });
          setImmediate(() => {
            void this.drain();
          });
        } else if (s.ended) {
          await this.request('mobile.apply', {
            action: 'end',
            meeting_id: s.id,
            samples: s.samples,
          });
          await this.serial(async () => {
            const next = { ...s, finished: true, error: null };
            await this.save(next);
            Object.assign(s, next);
          });
        }
      } catch (e) {
        s.error = e.message || '电脑处理失败';
      }
    } finally {
      this.draining = false;
    }
  }
}
module.exports = { MobileServer, atomicJSON };
