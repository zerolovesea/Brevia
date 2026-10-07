const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createCipheriv, createDecipheriv, createHmac, randomBytes } = require('node:crypto');
const { WebSocket } = require('ws');
const { atomicJSON } = require('./mobile-server');

function seal(key, value, direction) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce);
  cipher.setAAD(Buffer.from(`brevia-v1:${direction}`));
  return Buffer.concat([
    nonce,
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}
function unseal(key, box, direction) {
  if (typeof box !== 'string' || box.length > 90000) throw new Error('Invalid signal');
  const bytes = Buffer.from(box, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(`brevia-v1:${direction}`));
  cipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]));
}
class MobileRtc {
  constructor(server, config) {
    const url = new URL(config.url);
    if (
      url.protocol !== 'wss:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-f0-9]{64}$/.test(config.secret)
    )
      throw new Error('Invalid remote.json: WSS URL and 64-character hex secret required');
    this.server = server;
    this.config = config;
    this.peers = new Map();
  }
  ticket(id, role) {
    return createHmac('sha256', this.config.secret).update(`${id}:${role}`).digest('hex');
  }
  async credentials(id) {
    return this.server.serial(async () => {
      const device = this.server.devices.find((d) => d.id === id);
      if (!device.remoteKey) {
        device.remoteKey = randomBytes(32).toString('hex');
        await atomicJSON(path.join(this.server.directory, 'devices.json'), this.server.devices);
      }
      if (this.window && !this.peers.has(id)) this.connect(device);
      return {
        url: this.config.url,
        room: id,
        key: device.remoteKey,
        ticket: this.ticket(id, 'phone'),
      };
    });
  }
  async start() {
    if (this.window || !this.server.server) return;
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'mobile-rtc-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: 'brevia-rtc',
      },
    });
    this.window = window;
    window.webContents.on('render-process-gone', () => {
      if (this.window !== window) return;
      this.stop();
      this.restartTimer = setTimeout(() => {
        void this.start().catch((error) => {
          this.server.lastError = error.message;
        });
      }, 5000);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    const networkPermissions = new Set([
      'local-network',
      'local-network-access',
      'loopback-network',
    ]);
    window.webContents.session.setPermissionCheckHandler(
      (contents, permission) =>
        contents === window.webContents && networkPermissions.has(permission),
    );
    window.webContents.session.setPermissionRequestHandler((contents, permission, done) =>
      done(contents === window.webContents && networkPermissions.has(permission)),
    );
    window.webContents.setWebRTCIPHandlingPolicy('default_public_and_private_interfaces');
    this.listener = (event, message) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        return;
      void this.event(message).catch(() => this.drop(message?.id));
    };
    ipcMain.on('mobile.rtc.event', this.listener);
    try {
      await window.loadFile(path.join(__dirname, 'mobile-rtc.html'));
    } catch (error) {
      if (this.window === window) this.stop();
      throw error;
    }
    if (this.window !== window) return;
    for (const device of this.server.devices) if (device.remoteKey) this.connect(device);
  }
  send(value) {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send('mobile.rtc.command', value);
  }
  connect(device) {
    if (!this.window || this.peers.has(device.id)) return;
    const peer = { device, attempt: 0, seen: new Set() };
    this.peers.set(device.id, peer);
    const open = () => {
      if (this.peers.get(device.id) !== peer) return;
      const ws = new WebSocket(this.config.url, {
        handshakeTimeout: 8000,
        maxPayload: 96000,
        perMessageDeflate: false,
      });
      peer.ws = ws;
      ws.on('open', () =>
        ws.send(
          JSON.stringify({ room: device.id, role: 'host', ticket: this.ticket(device.id, 'host') }),
        ),
      );
      let queue = Promise.resolve();
      ws.on('message', (raw) => {
        queue = queue
          .then(async () => {
            if (peer.ws !== ws || this.peers.get(device.id) !== peer) return;
            const value = JSON.parse(raw);
            if (value.type === 'joined' || value.type === 'ready') {
              peer.iceServers = value.iceServers;
              peer.attempt = 0;
            }
            if (value.type !== 'signal') return;
            const signal = unseal(device.remoteKey, value.box, 'phone');
            if (!/^[a-f0-9]{32}$/.test(signal.session)) throw new Error('Invalid session');
            if (signal.type === 'offer') {
              if (
                peer.seen.has(signal.session) ||
                typeof signal.sdp !== 'string' ||
                signal.sdp.length > 60000
              )
                return;
              peer.seen.add(signal.session);
              if (peer.seen.size > 32) peer.seen.delete(peer.seen.values().next().value);
              peer.session = signal.session;
              this.send({
                type: 'offer',
                id: device.id,
                session: signal.session,
                sdp: signal.sdp,
                iceServers: peer.iceServers,
              });
            } else if (signal.type === 'candidate' && signal.session === peer.session) {
              this.send({
                type: 'candidate',
                id: device.id,
                session: signal.session,
                candidate: signal.candidate,
              });
            }
          })
          .catch(() => ws.close(1008));
      });
      ws.on('error', () => {});
      // ws 自动回应 ping；额外期限发现休眠/切网留下的半开连接。
      let heartbeat = setTimeout(() => ws.terminate(), 25000);
      ws.on('ping', () => {
        clearTimeout(heartbeat);
        heartbeat = setTimeout(() => ws.terminate(), 25000);
      });
      ws.on('close', () => {
        clearTimeout(heartbeat);
        if (this.peers.get(device.id) !== peer) return;
        peer.retry = setTimeout(
          open,
          Math.min(10000, 500 * 2 ** Math.min(peer.attempt++, 5)) + Math.random() * 300,
        );
      });
    };
    open();
  }
  async event(message) {
    const peer = this.peers.get(message?.id);
    if (!peer || message.session !== peer.session) return;
    if (['answer', 'candidate'].includes(message.type)) {
      if (peer.ws.readyState === WebSocket.OPEN)
        peer.ws.send(
          JSON.stringify({ type: 'signal', box: seal(peer.device.remoteKey, message, 'host') }),
        );
      return;
    }
    if (
      message.type !== 'request' ||
      typeof message.request !== 'string' ||
      Buffer.byteLength(message.request) > 60000 ||
      peer.busy
    )
      return;
    peer.busy = true;
    let response;
    try {
      const input = JSON.parse(message.request);
      if (
        !['GET', 'POST', 'PUT'].includes(input.method) ||
        typeof input.route !== 'string' ||
        input.route.length > 200 ||
        !/^[a-f0-9]{64}$/.test(input.token)
      )
        throw Object.assign(new Error('Invalid request'), { status: 400 });
      const req = Readable.from(
        input.data == null ? [] : [Buffer.from(JSON.stringify(input.data))],
      );
      req.method = input.method;
      req.url = input.route;
      req.headers = { authorization: `Bearer ${input.token}` };
      // 信令票据不是 API 授权；同时绑定原有配对令牌和当前设备，阻止跨设备访问。
      if (this.server.owner(req) !== peer.device.id)
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      response = { status: 200, value: await this.server.route(req) };
    } catch (error) {
      response = {
        status: error.status || (error.name === 'ZodError' ? 400 : 500),
        value: {
          error:
            error.status || error.name === 'ZodError'
              ? error.message
              : '电脑暂时无法完成请求，请重试',
        },
      };
    } finally {
      peer.busy = false;
    }
    let encoded = JSON.stringify(response);
    if (Buffer.byteLength(encoded) > 16 * 1024 * 1024)
      encoded = JSON.stringify({ status: 413, value: { error: '电脑返回内容过大' } });
    this.send({ type: 'response', id: message.id, session: message.session, response: encoded });
  }
  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    clearTimeout(peer.retry);
    peer.ws.terminate();
    this.send({ type: 'close', id });
  }
  stop() {
    clearTimeout(this.restartTimer);
    for (const id of this.peers.keys()) this.drop(id);
    if (this.listener) ipcMain.removeListener('mobile.rtc.event', this.listener);
    const window = this.window;
    this.window = null;
    window?.destroy();
  }
  async resume() {
    this.stop();
    await this.start();
  }
}
module.exports = { MobileRtc, seal, unseal };
