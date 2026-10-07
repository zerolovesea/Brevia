// Chromium 提供 ICE、DTLS 与可靠有序 SCTP；不采集媒体、不转码 PCM。
const peers = new Map();
function close(id, session) {
  const peer = peers.get(id);
  if (!peer || (session && peer.session !== session)) return;
  peers.delete(id);
  clearTimeout(peer.timeout);
  peer.channel?.close();
  peer.pc.close();
}
window.transport.on(async (message) => {
  const { id } = message;
  try {
    if (message.type === 'close') {
      close(id);
      return;
    }
    if (message.type === 'offer') {
      close(id);
      const pc = new RTCPeerConnection({ iceServers: message.iceServers });
      const peer = { pc, session: message.session, busy: false, parts: [], size: 0 };
      peers.set(id, peer);
      peer.timeout = setTimeout(() => close(id, peer.session), 20000);
      const candidates = [];
      let answered = false;
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        const value = {
          type: 'candidate',
          id,
          session: peer.session,
          candidate: candidate.toJSON(),
        };
        if (answered) window.transport.send(value);
        else candidates.push(value);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
          close(id, peer.session);
      };
      pc.ondatachannel = ({ channel }) => {
        if (
          peer.channel ||
          channel.label !== 'brevia-v1' ||
          !channel.ordered ||
          channel.maxRetransmits != null ||
          channel.maxPacketLifeTime != null
        ) {
          channel.close();
          return;
        }
        peer.channel = channel;
        channel.binaryType = 'arraybuffer';
        channel.onopen = () => clearTimeout(peer.timeout);
        channel.onclose = () => close(id, peer.session);
        channel.onmessage = ({ data }) => {
          if (peer.busy || (!(data instanceof ArrayBuffer) && data !== '')) {
            close(id);
            return;
          }
          if (data instanceof ArrayBuffer) {
            peer.size += data.byteLength;
            if (data.byteLength > 16000 || peer.size > 60000) {
              close(id);
              return;
            }
            peer.parts.push(new Uint8Array(data));
            clearTimeout(peer.timeout);
            peer.timeout = setTimeout(() => close(id, peer.session), 15000);
          } else {
            clearTimeout(peer.timeout);
            peer.busy = true;
            const bytes = new Uint8Array(peer.size);
            let offset = 0;
            for (const part of peer.parts) {
              bytes.set(part, offset);
              offset += part.length;
            }
            let request;
            try {
              request = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
              close(id);
              return;
            }
            peer.parts = [];
            peer.size = 0;
            window.transport.send({ type: 'request', id, session: peer.session, request });
          }
        };
      };
      peer.remoteReady = pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      await peer.remoteReady;
      await pc.setLocalDescription(await pc.createAnswer());
      window.transport.send({
        type: 'answer',
        id,
        session: peer.session,
        sdp: pc.localDescription.sdp,
      });
      answered = true;
      candidates.forEach((value) => window.transport.send(value));
    } else {
      const peer = peers.get(id);
      if (!peer || peer.session !== message.session) return;
      if (message.type === 'candidate') {
        await peer.remoteReady;
        await peer.pc.addIceCandidate(message.candidate);
      }
      if (message.type === 'response') {
        const channel = peer.channel;
        const end = Date.now() + 15000;
        const bytes = new TextEncoder().encode(message.response);
        for (let offset = 0; offset < bytes.length; offset += 8000) {
          while (channel.bufferedAmount > 64000) {
            if (Date.now() > end || channel.readyState !== 'open')
              throw new Error('channel stalled');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          channel.send(bytes.subarray(offset, offset + 8000));
        }
        peer.busy = false;
        channel.send('');
      }
    }
  } catch (error) {
    console.error('WebRTC transport:', error.message);
    close(id, message.session);
  }
});
