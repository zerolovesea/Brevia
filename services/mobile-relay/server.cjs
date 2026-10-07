const http = require('node:http');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

function ticket(secret, room, role) {
  return createHmac('sha256', secret).update(`${room}:${role}`).digest('hex');
}
function createRelay({ secret, turnSecret, turnUrls, maxRooms = 128, server: suppliedServer }) {
  if (!secret || secret.length < 32 || !turnSecret || turnSecret.length < 32)
    throw new Error('Relay and TURN secrets must contain at least 32 characters');
  if (!turnUrls?.length || turnUrls.some((url) => !/^turns?:/.test(url)))
    throw new Error('TURN_URLS is required');
  const rooms = new Map();
  const server =
    suppliedServer ||
    http.createServer((req, res) => {
      res.writeHead(req.url === '/health' ? 200 : 404);
      res.end(req.url === '/health' ? 'ok' : 'not found');
    });
  const wss = new WebSocketServer({ server, maxPayload: 96000, perMessageDeflate: false });
  wss.on('connection', (socket, request) => {
    // 票据只在 WSS 建立后发送，避免写入反向代理访问日志。
    if (request.headers.origin || wss.clients.size > maxRooms * 2 + 16) {
      socket.close(1008);
      return;
    }
    let room,
      role,
      joined = false,
      count = 0,
      windowAt = Date.now();
    socket.alive = true;
    socket.on('pong', () => {
      socket.alive = true;
    });
    const timeout = setTimeout(() => socket.close(1008), 5000);
    socket.on('error', () => {});
    socket.on('message', (raw) => {
      try {
        if (Date.now() - windowAt > 1000) {
          count = 0;
          windowAt = Date.now();
        }
        if (++count > 80) throw new Error('rate');
        const message = JSON.parse(raw);
        if (!joined) {
          ({ room, role } = message);
          if (
            !/^[a-f0-9]{32}$/.test(room) ||
            !['host', 'phone'].includes(role) ||
            !/^[a-f0-9]{64}$/.test(message.ticket) ||
            !timingSafeEqual(Buffer.from(ticket(secret, room, role)), Buffer.from(message.ticket))
          )
            throw new Error('authentication');
          if (!rooms.has(room) && rooms.size >= maxRooms) throw new Error('capacity');
          const peers = rooms.get(room) || {};
          // 同一角色的新连接取代网络切换后遗留的旧连接。
          peers[role]?.close(4001);
          peers[role] = socket;
          rooms.set(room, peers);
          joined = true;
          clearTimeout(timeout);
          const username = `${Math.floor(Date.now() / 1000) + 3600}:${room}`;
          const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
          socket.send(
            JSON.stringify({
              type: 'joined',
              iceServers: [{ urls: turnUrls, username, credential }],
            }),
          );
          if (peers.host && peers.phone) {
            const ready = JSON.stringify({
              type: 'ready',
              iceServers: [{ urls: turnUrls, username, credential }],
            });
            peers.host.send(ready);
            peers.phone.send(ready);
          }
          return;
        }
        if (
          message.type !== 'signal' ||
          typeof message.box !== 'string' ||
          message.box.length > 90000
        )
          throw new Error('message');
        const peer = rooms.get(room)?.[role === 'host' ? 'phone' : 'host'];
        if (peer?.readyState === WebSocket.OPEN) {
          if (peer.bufferedAmount > 256000) throw new Error('backpressure');
          peer.send(JSON.stringify({ type: 'signal', box: message.box }));
        }
      } catch {
        socket.close(1008);
      }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      const peers = rooms.get(room);
      if (peers?.[role] !== socket) return;
      delete peers[role];
      const peer = peers[role === 'host' ? 'phone' : 'host'];
      if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'away' }));
      if (!peers.host && !peers.phone) rooms.delete(room);
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) socket.terminate();
      else {
        socket.alive = false;
        socket.ping();
      }
    }
  }, 10000);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    wss.close();
  });
  return { server, wss };
}
if (require.main === module) {
  const { server } = createRelay({
    secret: process.env.RELAY_SECRET,
    turnSecret: process.env.TURN_SECRET,
    turnUrls: (process.env.TURN_URLS || '').split(',').filter(Boolean),
  });
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
}
module.exports = { createRelay, ticket };
