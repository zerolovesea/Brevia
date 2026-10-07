const assert = require('node:assert/strict');
if (process.env.BREVIA_SKIP_E2E === '1') {
  console.log('WebRTC integration skipped (BREVIA_SKIP_E2E=1).');
  process.exit(0);
}
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const selfsigned = require('selfsigned');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { MobileServer } = require('./mobile-server');
const { MobileRtc, seal, unseal } = require('./mobile-rtc');
const { createRelay, ticket } = require('../services/mobile-relay/server.cjs');
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
const timeout = setTimeout(() => {
  console.error('WebRTC test timed out');
  app.exit(1);
}, 45000);
app
  .whenReady()
  .then(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brevia-rtc-'));
    let server, transport, phone, relay, wire;
    try {
      const key = 'ab'.repeat(32);
      const value = { session: '12'.repeat(16), sdp: 'test offer' };
      assert.deepEqual(unseal(key, seal(key, value, 'phone'), 'phone'), value);
      assert.throws(() => unseal(key, seal(key, value, 'phone'), 'host'));
      const tampered = Buffer.from(seal(key, value, 'phone'), 'base64');
      tampered[16] ^= 1;
      assert.throws(() => unseal(key, tampered.toString('base64'), 'phone'));
      const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
      });
      // 仅本测试信任本次生成的证书，不关闭 TLS 验证。
      require('node:tls').setDefaultCACertificates([certificate.cert]);
      relay = createRelay({
        server: https.createServer({ key: certificate.private, cert: certificate.cert }),
        secret: key,
        turnSecret: 'cd'.repeat(32),
        turnUrls: ['turn:localhost:3478'],
      });
      relay.server.listen(0, '127.0.0.1');
      await once(relay.server, 'listening');
      const url = `wss://127.0.0.1:${relay.server.address().port}`;
      const room = '34'.repeat(16);
      const join = async (role) => {
        const ws = new WebSocket(url);
        await once(ws, 'open');
        const joined = once(ws, 'message');
        ws.send(JSON.stringify({ room, role, ticket: ticket(key, room, role) }));
        assert.equal(JSON.parse((await joined)[0]).type, 'joined');
        return ws;
      };
      const host = await join('host');
      const remote = await join('phone');
      const received = new Promise((resolve) => {
        const read = (raw) => {
          if (JSON.parse(raw).type === 'signal') {
            host.off('message', read);
            resolve([raw]);
          }
        };
        host.on('message', read);
      });
      remote.send(JSON.stringify({ type: 'signal', box: seal(key, value, 'phone') }));
      const forwarded = JSON.parse((await received)[0]);
      assert.deepEqual(unseal(key, forwarded.box, 'phone'), value);
      const rejected = new WebSocket(url);
      await once(rejected, 'open');
      const denied = once(rejected, 'close');
      rejected.send(JSON.stringify({ room, role: 'host', ticket: ticket(key, room, 'phone') }));
      assert.equal((await denied)[0], 1008);
      const replaced = once(remote, 'close');
      const replacement = await join('phone');
      assert.equal((await replaced)[0], 4001);
      replacement.terminate();
      host.terminate();

      const text = '会议😀'.repeat(18000);
      server = new MobileServer({
        directory,
        advertise: false,
        port: 0,
        approve: async () => true,
        active: () => false,
        request: async (type) => (type === 'meeting.get' ? { notes: text, segments: [] } : {}),
      });
      await server.init();
      const token = randomBytes(32).toString('hex');
      const device = {
        id: room,
        remoteKey: key,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      };
      server.devices.push(device);
      transport = new MobileRtc(server, { url, secret: key });
      await transport.start();
      transport.window.webContents.on('console-message', (event) => console.log(event.message));
      transport.window.webContents.on('preload-error', (_, __, error) => console.error(error));
      phone = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
      phone.webContents.session.setPermissionCheckHandler(() => true);
      phone.webContents.session.setPermissionRequestHandler((_, __, done) => done(true));
      phone.webContents.setWebRTCIPHandlingPolicy('default');
      transport.window.webContents.setWebRTCIPHandlingPolicy('default');
      await phone.loadURL('about:blank');
      wire = new WebSocket(url);
      let resolveReady;
      let hostReady = new Promise((resolve) => {
        resolveReady = resolve;
      });
      let signals = Promise.resolve();
      wire.on('message', (raw) => {
        const message = JSON.parse(raw);
        if (message.type === 'ready') resolveReady();
        if (message.type !== 'signal') return;
        const signal = unseal(key, message.box, 'host');
        signals = signals.then(() =>
          phone.webContents.executeJavaScript(
            signal.type === 'answer'
              ? `pc.setRemoteDescription(${JSON.stringify({ type: 'answer', sdp: signal.sdp })})`
              : `pc.addIceCandidate(${JSON.stringify(signal.candidate)})`,
          ),
        );
      });
      await once(wire, 'open');
      wire.send(JSON.stringify({ room, role: 'phone', ticket: ticket(key, room, 'phone') }));
      await hostReady;
      const negotiate = async () => {
        const session = randomBytes(16).toString('hex');
        const sdp = await phone.webContents.executeJavaScript(`(async () => {
        globalThis.pc?.close();
        globalThis.pc = new RTCPeerConnection({iceServers: []});
        globalThis.dc = pc.createDataChannel('brevia-v1', {ordered:true}); dc.binaryType='arraybuffer';
        globalThis.opened = new Promise(resolve => dc.onopen=resolve);
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise(resolve => { if(pc.iceGatheringState==='complete') resolve(); else pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')resolve()}; });
        return pc.localDescription.sdp;
      })()`);
        wire.send(
          JSON.stringify({
            type: 'signal',
            box: seal(key, { type: 'offer', session, sdp }, 'phone'),
          }),
        );
        await phone.webContents.executeJavaScript(
          `Promise.race([opened.then(()=>true),new Promise((_,reject)=>setTimeout(()=>reject(Error(JSON.stringify({ice:pc.iceConnectionState,state:pc.connectionState,dc:dc.readyState}))),10000))])`,
        );
      };
      await negotiate();
      const call = (method, route, data, bearer = token) =>
        phone.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const parts=[]; const timer=setTimeout(()=>reject(Error('RPC timeout')),5000);
      dc.onmessage=({data})=>{if(data===''){ clearTimeout(timer); const size=parts.reduce((n,p)=>n+p.length,0); const bytes=new Uint8Array(size); let offset=0; for(const p of parts){bytes.set(p,offset);offset+=p.length;} resolve(JSON.parse(new TextDecoder().decode(bytes))); } else parts.push(new Uint8Array(data));};
      const bytes=new TextEncoder().encode(${JSON.stringify(JSON.stringify({ method, route, data, token: bearer }))});
      for(let offset=0;offset<bytes.length;offset+=8000)dc.send(bytes.subarray(offset,offset+8000)); dc.send('');
    })`);
      assert.equal((await call('GET', '/meetings', null, 'ef'.repeat(32))).status, 401);
      const id = randomUUID();
      assert.equal(
        (await call('POST', '/meetings', { id, title: '移动会议', language: 'zh' })).status,
        200,
      );
      const chunk = { seq: 0, start_sample: 0, pcm: randomBytes(32000).toString('base64') };
      const ack = await call('PUT', `/meetings/${id}/chunks`, chunk);
      assert.equal(ack.value.next, 1);
      assert.deepEqual(
        JSON.parse(await fs.readFile(path.join(directory, id, '0.json'), 'utf8')),
        chunk,
      );
      // 模拟电脑休眠/唤醒、确认丢失后重新协商并重发，PCM 不重复落盘。
      hostReady = new Promise((resolve) => {
        resolveReady = resolve;
      });
      await transport.resume();
      await hostReady;
      await negotiate();
      assert.deepEqual(await call('PUT', `/meetings/${id}/chunks`, chunk), ack);
      assert.equal((await call('GET', `/meetings/${id}/snapshot`)).value.notes, text);
      assert.equal(
        (
          await call('PUT', `/meetings/${id}/chunks`, {
            ...chunk,
            pcm: Buffer.alloc(32000).toString('base64'),
          })
        ).status,
        409,
      );
      console.log(
        'WebRTC: real Chromium DataChannel, binary framing, Unicode, authentication, replay, wake/resume, authenticated WSS and relay isolation passed',
      );
    } finally {
      clearTimeout(timeout);
      wire?.terminate();
      transport?.stop();
      phone?.destroy();
      await server?.disable();
      for (const ws of relay?.wss.clients || []) ws.terminate();
      await new Promise((resolve) => (relay ? relay.server.close(resolve) : resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  })
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
