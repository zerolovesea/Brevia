// 适配现有桌面控制器使用的平台操作；只接受 Rust 宿主标记的窗口来源。
const { EventEmitter } = require('node:events');
const { createInterface } = require('node:readline');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { NativeAudio } = require('../macos/native-audio.cjs');

const callbacks = new Map();
const pending = new Map();
const windows = new Map();
const shortcuts = new Map();
const protocols = new Map();
const powerMonitor = new EventEmitter();
const app = new EventEmitter();
const nativeAudio = new NativeAudio();
let display = { x: 0, y: 0, width: 1280, height: 800 };
let currentTray;
let suspendedShortcuts = false;
const version = require('../package.json').version;
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}
function native(method, args = {}) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ native: id, method, args });
  });
}
function notify(method, args) {
  void native(method, args).catch(console.error);
}

Object.assign(app, {
  nativeUpdate: (operation) => native('update.' + operation),
  relaunch() {
    this.restartRequested = true;
  },
  isPackaged: true,
  getPath(key) {
    if (key === 'home') return os.homedir();
    if (key === 'userData')
      return process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Brevia')
        : path.join(os.homedir(), 'Library/Application Support/Brevia');
    throw new Error('Unknown app path ' + key);
  },
  getVersion: () => version,
  getLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  whenReady: () => Promise.resolve(),
  quit() {
    const event = {
      preventDefault() {
        this.prevented = true;
      },
    };
    app.emit('before-quit', event);
    if (!event.prevented) {
      app.emit('will-quit');
      notify(this.restartRequested ? 'app.relaunch' : 'app.quit');
    }
  },
});

class NativeWindow extends EventEmitter {
  static getAllWindows() {
    return [...windows.values()];
  }
  static fromWebContents(sender) {
    return sender.window;
  }
  constructor(options) {
    super();
    this.options = options;
    this.bounds = Object.fromEntries(
      ['width', 'height', 'x', 'y'].filter((k) => k in options).map((k) => [k, options[k]]),
    );
    this.visible = false;
    this.webContents = Object.assign(new EventEmitter(), {
      window: this,
      send: (channel, value) =>
        send({
          event: channel === 'brevia:event' ? value : { type: channel, payload: value },
          target: this.label,
        }),
      getURL: () => this.webContents.mainFrame?.url,
      setZoomFactor: (factor) => this.call('setZoom', { factor }),
      setWindowOpenHandler() {}, // 导航策略由 WKWebView 宿主强制执行。
      setIgnoreMenuShortcuts() {},
      isCrashed: () => Boolean(this.crashed),
      printToPDF: async () =>
        Buffer.from(await native('window.printPDF', { path: this.printFile }), 'base64'),
    });
  }
  async loadFile(file, options) {
    const page = path.basename(file);
    if (file.endsWith('.print.html')) {
      this.printFile = file;
      return;
    }
    if (!['index.html', 'floating-caption.html', 'recording-capsule.html'].includes(page))
      throw new Error('Unsupported window');
    this.label = page === 'index.html' ? 'main' : page.slice(0, -5);
    this.webContents.mainFrame = { url: pathToFileURL(file).href };
    windows.set(this.label, this);
    const { minWidth, minHeight, resizable, transparent, alwaysOnTop } = this.options;
    await native('window.create', {
      label: this.label,
      page,
      ...this.bounds,
      minWidth,
      minHeight,
      resizable,
      transparent,
      alwaysOnTop,
      visible: false,
      query: options?.query,
    });
  }
  call(method, args) {
    if (this.label && !this.destroyed) notify('window.' + method, { label: this.label, ...args });
  }
  show() {
    if (!this.visible) {
      this.visible = true;
      this.call('show');
      this.emit('show');
    }
  }
  showInactive() {
    if (!this.visible) {
      this.visible = true;
      this.call('show', { inactive: true });
      this.emit('show');
    }
  }
  hide() {
    if (this.visible) {
      this.visible = false;
      this.call('hide');
      this.emit('hide');
    }
  }
  focus() {
    this.call('focus');
  }
  restore() {
    this.minimized = false;
    this.call('restore');
    this.emit('restore');
  }
  isVisible() {
    return this.visible;
  }
  isMinimized() {
    return Boolean(this.minimized);
  }
  isDestroyed() {
    return Boolean(this.destroyed);
  }
  setBounds(bounds) {
    Object.assign(this.bounds, bounds);
    if (this.label && !this.destroyed)
      return native('window.setBounds', { label: this.label, ...this.bounds });
  }
  getBounds() {
    return { ...this.bounds };
  }
  setAlwaysOnTop(value) {
    this.options.alwaysOnTop = value;
    this.call('setAlwaysOnTop', { value });
  }
  setVisibleOnAllWorkspaces() {} // 宿主创建浮窗时设置。
  isEnabled() {
    return this.enabled !== false;
  }
  setEnabled(value) {
    this.enabled = value;
    this.call('setEnabled', { value });
  }
  close() {
    const event = {
      preventDefault() {
        this.prevented = true;
      },
    };
    this.emit('close', event);
    if (!event.prevented) this.destroy();
  }
  destroy() {
    if (this.destroyed) return;
    this.call('close');
    this.destroyed = true;
    windows.delete(this.label);
    this.emit('closed');
  }
}

class Tray extends EventEmitter {
  constructor() {
    super();
    currentTray = this;
    this.actions = new Map();
  }
  sync() {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (currentTray === this)
        notify('tray.set', {
          visible: true,
          tooltip: this.tooltip,
          title: this.title,
          items: this.items || [],
        });
    });
  }
  setContextMenu(template) {
    this.actions.clear();
    this.items = template.map((item, index) => {
      const id = 'tray-' + index;
      if (item.click) this.actions.set(id, () => item.click({ checked: !item.checked }));
      const { type, label, checked, enabled } = item;
      return { id, type, label, checked, enabled };
    });
    this.sync();
  }
  setToolTip(tooltip) {
    this.tooltip = tooltip;
    this.sync();
  }
  setTitle(title) {
    this.title = title;
    this.sync();
  }
  destroy() {
    currentTray = null;
    notify('tray.set', { visible: false });
  }
}

const globalShortcut = {
  async register(accelerator, fn) {
    if (shortcuts.has(accelerator)) return false;
    try {
      await native('shortcut.register', { accelerator });
    } catch {
      return false;
    }
    shortcuts.set(accelerator, fn);
    return true;
  },
  unregister(accelerator) {
    shortcuts.delete(accelerator);
    notify('shortcut.unregister', { accelerator });
  },
  unregisterAll() {
    for (const name of shortcuts.keys()) this.unregister(name);
  },
  setSuspended(value) {
    suspendedShortcuts = value;
  },
};

function receiveHost(message) {
  const view = windows.get(message.label);
  switch (message.host) {
    case 'window.crashed':
      if (view) {
        view.crashed = true;
        view.webContents.emit('render-process-gone');
      }
      break;
    case 'window.loaded':
      if (view) view.crashed = false;
      view?.webContents.emit('did-finish-load');
      break;
    case 'window.close':
      view?.close();
      break;
    case 'window.bounds':
      if (view) Object.assign(view.bounds, message.bounds);
      break;
    case 'window.focus':
    case 'window.blur':
      view?.emit(message.host.slice(7));
      break;
    case 'window.minimize':
    case 'window.restore':
      if (view) {
        view.minimized = message.host === 'window.minimize';
        view.emit(message.host.slice(7));
      }
      break;
    case 'screen.workArea':
      display = message.bounds || message.workArea;
      break;
    case 'tray.click':
      currentTray?.actions.get(message.id)?.();
      break;
    case 'shortcut':
      if (!suspendedShortcuts) shortcuts.get(message.accelerator)?.();
      break;
    case 'app.activate':
      app.emit('activate');
      break;
    case 'app.quit':
      app.quit();
      break;
    case 'app.suspend':
      powerMonitor.emit('suspend');
      break;
  }
}

async function dispatch({ channel, payload, label }) {
  if (channel === 'host.note-image' && label === 'host') {
    const response = await protocols.get('brevia-note')({
      url:
        'brevia-note://' +
        encodeURIComponent(payload.meeting_id) +
        '/' +
        encodeURIComponent(payload.filename),
    });
    if (!response.ok) throw new Error('Note image unavailable');
    return {
      base64: Buffer.from(await response.arrayBuffer()).toString('base64'),
      type: response.headers.get('content-type'),
    };
  }
  const sender = windows.get(label)?.webContents;
  if (!sender || !callbacks.has(channel)) throw new Error('Unknown desktop command');
  if (channel === 'meeting.note-image.save') {
    if (typeof payload?.bytes !== 'string' || payload.bytes.length > 13981016)
      throw new Error('Invalid note image data');
    const bytes = Buffer.from(payload.bytes, 'base64');
    if (
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024 ||
      bytes.toString('base64') !== payload.bytes
    )
      throw new Error('Invalid note image data');
    payload = {
      ...payload,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    };
  }
  const result = await callbacks.get(channel)({ sender, senderFrame: sender.mainFrame }, payload);
  if (channel === 'audio.url' && typeof result === 'string')
    return native('file.url', { path: fileURLToPath(result) });
  return result;
}

function listen() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      console.error(error);
      return;
    }
    if ('native' in message) {
      const entry = pending.get(message.native);
      if (entry) {
        pending.delete(message.native);
        if (message.error) entry.reject(new Error(String(message.error)));
        else entry.resolve(message.result);
      }
    } else if (message.host) receiveHost(message);
    else
      void dispatch(message).then(
        (result) => send({ id: message.id, result: result ?? null }),
        (error) => send({ id: message.id, error: error.message }),
      );
  });
  lines.on('close', () => {
    nativeAudio.dispose();
    app.emit('host-disconnected');
    process.exit(0);
  });
}

module.exports = {
  listen,
  app,
  NativeWindow,
  Tray,
  powerMonitor,
  globalShortcut,
  nativeAudio,
  ipcMain: { handle: (name, fn) => callbacks.set(name, fn) },
  screen: {
    getPrimaryDisplay: () => ({ id: 1, workArea: display, workAreaSize: display }),
    getDisplayMatching: () => ({ id: 1, workArea: display }),
  },
  protocol: { handle: (scheme, fn) => protocols.set(scheme, fn) },
  dialog: {
    showOpenDialog: (...args) => native('dialog.open', args.at(-1)),
    showSaveDialog: (...args) => native('dialog.save', args.at(-1)),
    showMessageBox: (...args) => native('dialog.message', args.at(-1)),
    showErrorBox: (title, message) => notify('dialog.message', { title, message, buttons: ['OK'] }),
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
  Menu: { buildFromTemplate: (template) => template },
  clipboard: { writeText: (text) => native('shell.copyText', { text }) },
  shell: {
    showItemInFolder: (path) => native('shell.showItem', { path }),
    openPath: (path) => native('shell.openPath', { path }),
    openExternal: (url) => native('shell.openExternal', { url }),
  },
  ShareMenu: class {
    constructor(item) {
      this.item = item;
    }
    popup({ window, x, y }) {
      return native('shell.share', { ...this.item, label: window.label, x, y });
    }
  },
};
