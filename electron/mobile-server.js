const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { Bonjour } = require('bonjour-service');
const { networkInterfaces, hostname } = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
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
  num_speakers: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1)
    .optional(),
  target_language: z.enum(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']).nullable().optional(),
  workspace_id: uuid.nullable().optional(),
  summary_template: z.enum(['general', 'weekly', 'interview', 'review']).optional(),
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
async function body(req, limit = 60000) {
  if (Number(req.headers['content-length']) > limit) throw fail(413, '请求过大');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fail(413, '请求过大');
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
    changed = () => {},
    advertise = true,
    port = 43187,
  }) {
    Object.assign(this, {
      directory,
      request,
      approve,
      active,
      discovered,
      changed,
      advertise,
      port,
    });
    this.lastSeen = new Map();
    this.captureReady = new Map();
    this.captureLevels = new Map();
    this.capturePreview = null;
    this.discoveryNoticeAt = 0;
    this.queue = Promise.resolve();
    this.sessions = new Map();
    this.desktopTasks = {};
    this.fileStreams = new Map();
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
    this.desktopTasks = await readJSON(path.join(this.directory, 'desktop-tasks.json'), {});
    for (const task of Object.values(this.desktopTasks)) {
      if (task.state === 'running')
        Object.assign(task, { state: 'failed', error: '电脑已重启，请重新提交任务' });
    }
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
        // 重启后不能让尚未响应的手机突然开启麦克风。
        if (session.desktopCapture && session.state === 'starting') {
          Object.assign(session, { ended: true, stopRequested: true, state: 'ended' });
          await this.save(session);
        }
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
        .then(async (value) => {
          if (value?.fileHandle) {
            const { fileHandle, mime, deviceId, meetingId } = value;
            let source;
            try {
              const { size } = await fileHandle.stat();
              if (res.destroyed) return;
              this.assertAccess(deviceId, meetingId);
              res.writeHead(200, {
                'Content-Type': mime,
                'Content-Length': size,
                'Cache-Control': 'no-store',
              });
              source = fileHandle.createReadStream();
              this.fileStreams.set(source, deviceId);
              await pipeline(source, res);
            } finally {
              this.fileStreams.delete(source);
              source?.destroy();
              await fileHandle.close();
            }
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(value));
        })
        .catch((error) => {
          if (res.destroyed || res.headersSent) return;
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
    this.captureReady.clear();
    this.captureLevels.clear();
    this.capturePreview = null;
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
    // 地址范围与手机端 DesktopConnection.endpoint 保持一致，避免二维码被手机拒绝。
    const addresses = Object.entries(networkInterfaces())
      .flatMap(([name, entries]) =>
        (entries || [])
          .filter((n) => {
            if (!n || n.internal || n.family !== 'IPv4') return false;
            const [a, b] = n.address.split('.').map(Number);
            return (
              a === 10 ||
              (a === 172 && b >= 16 && b <= 31) ||
              (a === 192 && b === 168) ||
              (a === 169 && b === 254)
            );
          })
          .map((n) => ({
            address: n.address,
            // shortcut: 名称只能识别常见虚拟网卡，多实体网卡选错时再引入路由检测。
            priority:
              Number(
                /virtual|vethernet|vmware|vbox|docker|wsl|vpn|tailscale|zerotier|wireguard|^(utun|tun|tap)\d*/i.test(
                  name,
                ),
              ) + (n.address.startsWith('169.254.') ? 2 : 0),
          })),
      )
      .sort((a, b) => a.priority - b.priority)
      .map((n) => `https://${n.address}:${this.port}`);
    return {
      enabled: !!this.server,
      name: hostname(),
      addresses,
      fingerprint: this.fingerprint,
      devices: this.devices.map(({ id, name, firstConnectedAt, libraryAccess }) => ({
        libraryAccess: libraryAccess === true,
        id,
        name,
        firstConnectedAt: firstConnectedAt || null,
        recordingCount: [...this.sessions.values()].filter((s) => s.owner === id && s.samples > 0)
          .length,
        connected: !!this.server && Date.now() - (this.lastSeen.get(id) || 0) < 15000,
        captureReady: !!this.server && Date.now() - (this.captureReady.get(id) || 0) < 6000,
      })),
      sessions: [...this.sessions.values()]
        .filter((s) => !s.deleted)
        .map(
          ({
            id,
            title,
            next,
            processed,
            samples,
            state,
            ended,
            stopRequested,
            finished,
            error,
            captureError,
            desktopCapture,
            owner,
          }) => ({
            id,
            title,
            next,
            processed,
            samples,
            state,
            ended,
            stopRequested,
            finished,
            error: error || captureError,
            desktopCapture: desktopCapture === true,
            owner,
          }),
        ),
      error: this.lastError || null,
    };
  }
  async openPairing() {
    await this.enable();
    this.pairing = null;
    const status = this.status();
    if (!status.addresses.length)
      throw fail(409, '未找到可用的局域网 IPv4 地址，请连接 Wi-Fi 或以太网后重试。');
    this.pairing = {
      pin: String(randomInt(100000, 1000000)),
      secret: randomBytes(24).toString('hex'),
      expires: Date.now() + 120000,
      attempts: 0,
    };
    const payload = JSON.stringify({
      v: 1,
      address: status.addresses[0],
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
  async saveDevices(devices) {
    await atomicJSON(path.join(this.directory, 'devices.json'), devices);
    this.devices = devices;
  }
  stopDeviceStreams(id) {
    for (const [stream, owner] of this.fileStreams) {
      if (owner === id) stream.destroy();
    }
  }
  setLibraryAccess(id, enabled) {
    return this.serial(async () => {
      if (!this.devices.some((device) => device.id === id)) throw fail(404, '设备不存在');
      const devices = this.devices.map((device) =>
        device.id === id ? { ...device, libraryAccess: enabled === true } : device,
      );
      await this.saveDevices(devices);
      if (!enabled) {
        this.stopDeviceStreams(id);
        const own = [...this.sessions.values()]
          .filter((s) => s.owner === id && !s.deleted && !s.desktopCapture)
          .map((s) => s.id);
        await this.request('mobile.proposal.forget', { device_id: id, keep_meetings: own });
      }
      this.changed();
      return this.status();
    });
  }
  revoke(id) {
    return this.serial(async () => {
      if ([...this.sessions.values()].some((s) => s.owner === id && !s.finished))
        throw fail(409, '该设备仍有未完成的录音，请先结束并补传');
      await this.saveDevices(this.devices.filter((d) => d.id !== id));
      this.stopDeviceStreams(id);
      this.captureLevels.delete(id);
      if (this.capturePreview?.deviceId === id) this.capturePreview = null;
      await this.request('mobile.proposal.forget', { device_id: id });
      this.changed();
      return this.status();
    });
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
      if (
        (allowed !== true && allowed?.allowed !== true) ||
        this.pairing !== p ||
        p.expires < Date.now()
      )
        throw fail(403, '电脑未允许连接，请重新配对');
      const token = randomBytes(32).toString('hex');
      const id = randomBytes(16).toString('hex');
      await this.serial(() =>
        this.saveDevices([
          ...this.devices,
          {
            libraryAccess: allowed?.libraryAccess === true,
            id,
            name: input.name,
            firstConnectedAt: new Date().toISOString(),
            tokenHash: hash(token),
          },
        ]),
      );
      this.pairing = null;
      return {
        token,
        deviceId: id,
        name: hostname(),
        fingerprint: this.fingerprint,
      };
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
    if (s.deleted) throw fail(410, '会议已在电脑永久删除');
    return s;
  }
  async refreshDeleted() {
    for (const [id, session] of this.sessions) {
      if (session.deleted) continue;
      const saved = await readJSON(path.join(this.directory, id, 'session.json'), null);
      if (saved?.deleted) this.sessions.set(id, saved);
    }
  }
  async finishReceived(id) {
    await this.enable();
    return this.serial(async () => {
      const s = this.sessions.get(uuid.parse(id));
      if (!s || s.deleted) throw fail(404, '会议不存在');
      if (!s.finished) {
        // 明确结束当前已接收内容；手机回来后仍可在原会议补传尾部，保留时间轴。
        const next = {
          ...s,
          ended: true,
          closedOnDesktop: true,
          stopRequested: true,
          state: 'ended',
        };
        await this.save(next);
        Object.assign(s, next);
      }
      return { saved: true };
    });
  }
  requestStop(id) {
    return this.serial(async () => {
      const s = this.sessions.get(uuid.parse(id));
      if (!s) throw fail(404, '会议不存在');
      if (!s.ended) {
        const next = { ...s, stopRequested: true };
        if (s.desktopCapture && s.state === 'starting' && !s.samples)
          Object.assign(next, { ended: true, closedOnDesktop: true });
        await this.save(next);
        Object.assign(s, next);
      }
      return { requested: true, connected: Date.now() - (this.lastSeen.get(s.owner) || 0) < 15000 };
    });
  }
  save(s) {
    return atomicJSON(path.join(this.directory, s.id, 'session.json'), s);
  }
  startCapture(deviceId, payload) {
    return this.serial(async () => {
      if (!this.status().devices.some((d) => d.id === deviceId && d.connected && d.captureReady))
        throw fail(409, '请在已连接的手机上打开 Brevia，并结束其他录音');
      if (this.active() || [...this.sessions.values()].some((s) => !s.finished))
        throw fail(409, '电脑有未完成的录音，请先结束并补传');
      const value = createSession.parse({ ...payload, id: randomUUID() });
      await this.request('mobile.prepare', value);
      const s = {
        ...value,
        owner: deviceId,
        desktopCapture: true,
        captureExpires: 0,
        controlVersion: 0,
        desiredState: 'recording',
        state: 'starting',
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
      try {
        const meeting = await this.request('mobile.apply', {
          ...value,
          meeting_id: s.id,
          action: 'start',
          desktop_capture: true,
        });
        // 模型加载完成后才给手机计时，避免首次加载耗尽响应窗口。
        s.captureExpires = Date.now() + 30000;
        await this.save(s);
        return meeting;
      } catch (error) {
        Object.assign(s, { ended: true, stopRequested: true, state: 'ended' });
        await this.save(s);
        throw error;
      }
    });
  }
  previewCapture(deviceId) {
    if (
      deviceId &&
      !this.status().devices.some((d) => d.id === deviceId && d.connected && d.captureReady)
    )
      throw fail(409, '手机端未就绪，请打开或更新 Brevia');
    // 试音只保留电平；短租约防止桌面关闭后手机继续占用麦克风。
    if (this.capturePreview?.deviceId !== deviceId) this.captureLevels.clear();
    this.capturePreview = deviceId ? { deviceId, expires: Date.now() + 3000 } : null;
    const meter = this.captureLevels.get(deviceId);
    return { deviceId, level: meter && Date.now() - meter.at < 1000 ? meter.level : null };
  }
  pauseCapture(id, paused) {
    return this.serial(async () => {
      const s = this.sessions.get(uuid.parse(id));
      if (!s?.desktopCapture || s.ended || s.stopRequested) throw fail(409, '当前手机录音不可控制');
      if (Date.now() - (this.lastSeen.get(s.owner) || 0) >= 15000)
        throw fail(409, '连接中断 · 等待补传');
      const next = {
        ...s,
        desiredState: paused ? 'paused' : 'recording',
        controlVersion: s.controlVersion + 1,
      };
      await this.save(next);
      Object.assign(s, next);
      return { requested: true };
    });
  }
  canAccess(owner, id) {
    const device = this.devices.find((entry) => entry.id === owner);
    const session = this.sessions.get(id);
    if (!device) return false;
    if (session && (session.owner !== owner || session.deleted)) return false;
    return (session && !session.desktopCapture) || device.libraryAccess === true;
  }
  assertAccess(owner, id) {
    if (!this.canAccess(owner, id)) throw fail(404, '会议不存在');
  }
  meetingState(meeting) {
    const s = this.sessions.get(meeting.id);
    if (s && !s.finished) return s.state === 'paused' ? 'paused' : 'recording';
    const active = this.active();
    if (meeting.status === 'paused' || (active?.meeting_id === meeting.id && active.paused))
      return 'paused';
    if (meeting.status === 'recording' || active?.meeting_id === meeting.id) return 'recording';
    return 'ended';
  }
  async desktopMeetings(owner) {
    const hasGrant = this.devices.find((d) => d.id === owner)?.libraryAccess;
    if (!hasGrant) return [];
    const rows = await this.request('mobile.library', {});
    return rows
      .filter(
        ({ id }) =>
          this.canAccess(owner, id) &&
          (!this.sessions.has(id) || this.sessions.get(id).desktopCapture),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        state: this.meetingState(row),
        created_at: row.created_at,
        duration_ms: row.duration_ms,
      }));
  }
  async sharedMeeting(owner, id) {
    this.assertAccess(owner, id);
    let meeting;
    try {
      meeting = await this.request('meeting.get', { meeting_id: id });
    } catch (error) {
      if (/meeting not found/i.test(error.message)) throw fail(404, '会议不存在');
      throw error;
    }
    this.assertAccess(owner, id);
    if (!meeting || meeting.deleted_at || meeting.id !== id) throw fail(404, '会议不存在');
    return meeting;
  }
  proposals(meetingId) {
    return this.request('mobile.proposal.list', { meeting_id: meetingId || null }).then((rows) =>
      rows
        .filter((row) => this.canAccess(row.device_id, row.meeting_id))
        .map((row) => ({
          ...row,
          device_name: this.devices.find((device) => device.id === row.device_id).name,
        })),
    );
  }
  resolveProposal(value) {
    return this.serial(async () => {
      const pending = await this.proposals(value.meeting_id);
      if (!pending.some((p) => p.id === value.id)) throw fail(404, '提议已失效');
      const result = await this.request('mobile.proposal.resolve', value);
      if (result.conflict) throw fail(409, '电脑笔记已更新，请重新核对。');
      if (result.missing) throw fail(404, '提议已失效');
      this.changed();
      return result;
    });
  }
  async sharedRoute(req, owner, id, operation, filename) {
    this.assertAccess(owner, id);
    if (filename && operation !== 'images') throw fail(404, '未找到接口');
    if (req.method === 'GET') {
      const meeting = await this.sharedMeeting(owner, id);
      const playback = meeting.audio?.playback;
      const audioPath = playback?.mix || playback?.mic || playback?.system;
      if (operation === 'audio' && audioPath && this.meetingState(meeting) === 'ended') {
        const fileHandle = await this.request('mobile.audio.open', {
          meeting_id: id,
          path: audioPath,
        });
        return { fileHandle, mime: 'audio/wav', deviceId: owner, meetingId: id };
      }
      if (
        operation === 'images' &&
        filename &&
        /^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/.test(filename)
      ) {
        const result = await this.request('mobile.image.read', { meeting_id: id, filename });
        this.assertAccess(owner, id);
        return result;
      }
      if (operation !== 'snapshot') throw fail(404, '内容不可用');
      const proposal = await this.request('mobile.proposal.status', {
        meeting_id: id,
        device_id: owner,
      });
      this.assertAccess(owner, id);
      const notes = meeting.notes || '';
      const stale = new Set(meeting.correction?.stale_translations);
      return {
        id,
        title: meeting.title,
        state: this.meetingState(meeting),
        created_at: meeting.created_at,
        duration_ms: meeting.duration_ms,
        notes,
        revision: hash(notes),
        segments: (meeting.current_segments || meeting.segments || []).map(
          ({ id, text, start_ms, end_ms, speaker, speaker_name, track, translation, version }) => ({
            id,
            text,
            start_ms,
            end_ms,
            speaker,
            speaker_name,
            track,
            version,
            translation: stale.has(id) ? null : translation,
          }),
        ),
        summary: meeting.summary
          ? { data: meeting.summary.data, created_at: meeting.summary.created_at }
          : null,
        accepted_claims: meeting.accepted_claims || [],
        has_audio: Boolean(audioPath) && this.meetingState(meeting) === 'ended',
        task: this.sessions.get(id)?.task || this.desktopTasks[id] || null,
        proposal,
      };
    }
    if (req.method !== 'POST' || filename) throw fail(405, '不支持此操作');
    const maxImageBytes = 4 * 1024 * 1024;
    const maxNotesBytes = 5 * 1024 * 1024;
    const limit =
      operation === 'images'
        ? Math.ceil(maxImageBytes / 3) * 4 + 256
        : operation === 'proposals'
          ? maxNotesBytes + 512
          : 60000;
    const value = await body(req, limit);
    return this.serial(async () => {
      const meeting = await this.sharedMeeting(owner, id);
      if (operation === 'proposals') {
        const v = z
          .object({
            id: uuid,
            base_revision: z.string().regex(/^[a-f0-9]{64}$/),
            notes: z.string().max(maxNotesBytes),
          })
          .parse(value);
        const result = await this.request('mobile.proposal.put', {
          ...v,
          meeting_id: id,
          device_id: owner,
        });
        if (result.missing) throw fail(404, '会议不存在');
        if (result.conflict) throw fail(409, '上一份笔记正在等待电脑确认');
        this.changed();
        return result;
      }
      if (operation === 'images') {
        const { mime_type, base64 } = z
          .object({
            mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
            base64: z.string().min(4),
          })
          .parse(value);
        const bytes = Buffer.from(base64, 'base64');
        if (bytes.length > maxImageBytes || bytes.toString('base64') !== base64)
          throw fail(400, '图片格式无效');
        const magic = {
          'image/jpeg': 'ffd8ff',
          'image/png': '89504e470d0a1a0a',
          'image/webp': '52494646',
        }[mime_type];
        if (
          !bytes.subarray(0, magic.length / 2).equals(Buffer.from(magic, 'hex')) ||
          (mime_type === 'image/webp' && bytes.toString('ascii', 8, 12) !== 'WEBP')
        )
          throw fail(400, '图片格式无效');
        return this.request('mobile.image.save', { meeting_id: id, mime_type, bytes });
      }
      if (operation === 'action') {
        if (this.meetingState(meeting) !== 'ended') throw fail(409, '请先结束录音并完成同步');
        if (!['summary', 'refine'].includes(value?.action)) throw fail(400, '不支持此操作');
        return this.startTask(id, value, this.sessions.get(id));
      }
      throw fail(404, '未找到接口');
    });
  }
  async saveTask(id, task) {
    const s = this.sessions.get(id);
    if (s && !s.deleted) {
      await this.save({ ...s, task });
      s.task = task;
    } else if (!s) {
      const tasks = { ...this.desktopTasks, [id]: task };
      await atomicJSON(path.join(this.directory, 'desktop-tasks.json'), tasks);
      this.desktopTasks = tasks;
    }
  }
  async startTask(id, input, session) {
    const v = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('workspace'), workspace_id: uuid.nullable() }),
        z.object({ action: z.literal('refine'), request_id: uuid }),
        z.object({ action: z.literal('summary'), request_id: uuid, consent: z.literal(true) }),
        z.object({
          action: z.literal('translate'),
          request_id: uuid,
          target_language: createSession.shape.target_language.unwrap().unwrap(),
          consent: z.literal(true),
        }),
      ])
      .parse(input);
    if (session && !session.finished) throw fail(409, '请先结束录音并完成同步');
    const prior = session?.task || this.desktopTasks[id];
    if (prior && prior.id === v.request_id) return { task: prior };
    if (prior?.state === 'running') throw fail(409, '电脑正在处理这场会议，请稍后重试');
    if (v.action === 'workspace') {
      await this.request('workspace.assign', { meeting_id: id, workspace_id: v.workspace_id });
      await this.save({ ...session, workspace_id: v.workspace_id });
      Object.assign(session, { workspace_id: v.workspace_id });
      return { saved: true };
    }
    const task = { id: v.request_id, action: v.action, state: 'running' };
    await this.saveTask(id, task);
    const command = {
      summary: 'mobile.summary',
      refine: 'meeting.refine',
      translate: 'mobile.translate',
    }[v.action];
    Promise.resolve()
      .then(() =>
        this.request(command, {
          meeting_id: id,
          target_language: v.target_language,
          consent: v.consent,
        }),
      )
      .then((result) => {
        if (result?.model_required) throw fail(409, '请先在电脑安装所需模型');
        if (result?.cancelled || (v.action === 'refine' && result?.status !== 'refined'))
          throw fail(409, '电脑已取消任务，请重试');
        return { ...task, state: 'done' };
      })
      .catch((error) => ({
        ...task,
        state: 'failed',
        error: error.status === 409 ? error.message : '电脑操作失败，请在电脑查看详情。',
      }))
      .then((done) => this.serial(() => this.saveTask(id, done)))
      .catch((error) => {
        this.lastError = error.message;
      });
    return { task };
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
    if (req.url === '/desktop-meetings' && req.method === 'GET') return this.desktopMeetings(owner);
    const shared =
      /^\/desktop-meetings\/([a-f0-9-]+)\/(snapshot|action|proposals|images|audio)(?:\/([a-f0-9.-]+))?$/.exec(
        req.url,
      );
    if (shared) return this.sharedRoute(req, owner, uuid.parse(shared[1]), shared[2], shared[3]);
    const document =
      /^\/desktop-meetings\/([a-f0-9-]+)\/document\/(notes|mynotes)\/(pdf|docx)$/.exec(req.url);
    if (document && req.method === 'GET') {
      const [, rawId, content, format] = document;
      const meetingId = uuid.parse(rawId);
      const meeting = await this.sharedMeeting(owner, meetingId);
      if (this.meetingState(meeting) !== 'ended') throw fail(409, '请先结束录音并完成同步');
      const fileHandle = await this.request('mobile.document.open', {
        meeting_id: meetingId,
        content,
        format,
      });
      const mime =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      return { fileHandle, mime, deviceId: owner, meetingId };
    }
    if (req.url === '/options' && req.method === 'GET') return this.request('mobile.options', {});
    if (req.url === '/meetings' && req.method === 'GET')
      return [...this.sessions.values()]
        .filter((s) => s.owner === owner && !s.deleted)
        .map((s) => ({
          id: s.id,
          title: s.title,
          ended: s.ended,
          finished: s.finished,
          samples: s.samples,
        }));
    const value = req.method === 'POST' || req.method === 'PUT' ? await body(req) : null;
    if (req.url === '/capture' && req.method === 'POST') {
      const { available, level } = z
        .object({ available: z.boolean(), level: z.number().min(0).max(1).nullable().optional() })
        .parse(value);
      if (available) this.captureReady.set(owner, Date.now());
      else this.captureReady.delete(owner);
      if (available && level != null && this.capturePreview?.deviceId === owner)
        this.captureLevels.set(owner, { level, at: Date.now() });
      else this.captureLevels.delete(owner);
      const s = [...this.sessions.values()].find(
        (s) =>
          s.owner === owner &&
          s.desktopCapture &&
          s.state === 'starting' &&
          !s.ended &&
          !s.stopRequested &&
          s.captureExpires > Date.now(),
      );
      return {
        request: available && s ? { ...createSession.parse(s), desktopCapture: true } : null,
        preview: Boolean(
          available &&
            !s &&
            !this.active() &&
            this.capturePreview?.deviceId === owner &&
            this.capturePreview.expires > Date.now(),
        ),
      };
    }
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
        if (!s.desktopCapture) meeting = await this.request('meeting.get', { meeting_id: s.id });
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
        desktopCapture: s.desktopCapture === true,
        desiredState: s.desiredState,
        controlVersion: s.controlVersion,
        task: s.task || null,
        workspace_id: meeting?.workspace_id ?? s.workspace_id ?? null,
        error: s.error || s.captureError || s.processingWarning || null,
        marks: s.marks,
        title: meeting?.title || s.title,
        notes: meeting?.notes || '',
        segments: (meeting?.segments || []).map((segment) =>
          meeting.correction?.stale_translations?.includes(segment.id)
            ? { ...segment, translation: null }
            : segment,
        ),
        summary: meeting?.summary || null,
        accepted_claims: meeting?.accepted_claims || [],
      };
    }
    return this.serial(async () => {
      // 等待队列时可能已被永久删除，必须重新检查当前会话。
      const s = this.session(match[1], owner);
      if (match[2] === 'action' && req.method === 'POST') {
        if (s.desktopCapture) throw fail(403, '请在电脑管理这场会议');
        return this.startTask(s.id, value, s);
      }
      if (match[2] === 'state' && req.method === 'POST') {
        const v = z
          .object({
            state: z.enum(['starting', 'recording', 'paused', 'interrupted', 'ended']),
            error: z.string().max(200).optional(),
          })
          .parse(value);
        const next = { ...s, state: v.state, captureError: v.error || null };
        if (s.desktopCapture && v.state === 'interrupted' && s.state === 'starting' && !s.samples)
          Object.assign(next, {
            ended: true,
            stopRequested: true,
            captureError: v.error || '手机未能开始录音，请打开手机 Brevia 后重试',
          });
        await this.save(next);
        Object.assign(s, next);
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
        if ((s.ended && !s.closedOnDesktop) || v.seq !== s.next || v.start_sample !== s.samples)
          throw fail(409, '请从电脑确认的位置补传');
        // Ack only after both audio and its manifest are durable. A failed manifest
        // update leaves an orphan that the same next upload may safely overwrite.
        await atomicJSON(file, v);
        const next = {
          ...s,
          next: s.next + 1,
          samples: s.samples + pcm.length / 2,
          ended: false,
          finished: false,
          closedOnDesktop: false,
        };
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
        const next = { ...s, ended: true, closedOnDesktop: false };
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
        if (
          s.desktopCapture &&
          !s.ended &&
          s.state === 'starting' &&
          s.captureExpires > 0 &&
          s.captureExpires <= Date.now()
        ) {
          await this.serial(async () => {
            if (s.state !== 'starting' || s.ended || s.captureExpires > Date.now()) return;
            Object.assign(s, {
              ended: true,
              stopRequested: true,
              state: 'ended',
              captureError: '手机未能开始录音，请打开手机 Brevia 后重试',
            });
            await this.save(s);
          });
        }
        await this.request('mobile.apply', {
          ...createSession.parse(s),
          action: 'start',
          meeting_id: s.id,
          tags: ['手机录音'],
          desktop_capture: s.desktopCapture === true,
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
          await this.serial(async () => {
            if (!s.ended || s.processed !== s.next) return;
            await this.request('mobile.apply', {
              action: 'end',
              meeting_id: s.id,
              samples: s.samples,
            });
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
module.exports = { MobileServer };
