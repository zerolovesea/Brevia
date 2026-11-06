// 两种桌面壳共用 preload 的公开命令表，只有 IPC 传输和原生采集不同。
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
  const require = () => ({
    contextBridge,
    ipcRenderer,
    webUtils: { getPathForFile: (file) => (typeof file === 'string' ? file : undefined) },
  });
  const process = { platform: 'darwin' };
  {
    /* BREVIA_PRELOAD */
  }
})();
