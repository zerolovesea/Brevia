// 原生桌面共用预加载命令表，通过 Tauri 传输和系统音频能力执行。
(() => {
  if (window !== window.top) return;
  // macOS 14.0 的系统 WebKit 尚未提供 checkVisibility。
  if (!Element.prototype.checkVisibility) {
    Element.prototype.checkVisibility = function () {
      return this.getClientRects().length > 0;
    };
  }
  const listeners = new Map();
  const core = window.__TAURI__.core;
  const subscription = window.__TAURI__.event.listen('brevia:event', ({ payload }) => {
    const channel = payload.type === 'floating-caption:update' ? payload.type : 'brevia:event';
    for (const fn of listeners.get(channel) || [])
      fn(null, channel === 'brevia:event' ? payload : payload.payload);
  });
  const ipcRenderer = {
    async invoke(channel, payload) {
      await subscription;
      if (channel === 'meeting.note-image.save') {
        if (!(payload?.bytes instanceof ArrayBuffer) || payload.bytes.byteLength > 10 * 1024 * 1024)
          throw new Error('Invalid note image data');
        const bytes = new Uint8Array(payload.bytes);
        let text = '';
        for (let offset = 0; offset < bytes.length; offset += 32768)
          text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        payload = { ...payload, bytes: btoa(text) };
      }
      return core.invoke('desktop_invoke', { channel, payload });
    },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
  };
  const methods = (prefix, names) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        async (payload = {}) => {
          const result = await ipcRenderer.invoke(prefix + '.' + name, payload);
          if (result?.__brevia_error) throw new Error(result.__brevia_error.detail);
          return result;
        },
      ]),
    );
  const contextBridge = {
    exposeInMainWorld(name, api) {
      window[name] = Object.freeze({
        ...api,
        nativeAudio: methods('native-audio', ['devices', 'prepare', 'start', 'pause', 'stop']),
      });
    },
  };
  const webUtils = { getPathForFile: (file) => (typeof file === 'string' ? file : undefined) };
  const process = { platform: window.__BREVIA_PLATFORM__ || 'darwin' };
  {
    /* BREVIA_PRELOAD */
  }
})();
