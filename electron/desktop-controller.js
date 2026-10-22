const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { writeAtomicFile } = require('./main-logic');

const desktopPreferencesSchema = z.object({
  closeBehavior: z.enum(['quit', 'hide']).default('quit'),
  trayVisibility: z.enum(['always', 'background']).default('always'),
  autoCapsule: z.boolean().default(true),
  // 兼容旧偏好文件；胶囊现在固定悬浮，不再提供置顶开关。
  capsuleOnTop: z.boolean().default(true),
});
const desktopStateSchema = z.object({
  meetingId: z.string().nullable(),
  title: z.string().max(500),
  phase: z.enum(['idle', 'recording', 'paused', 'saving', 'failed', 'saved']),
  elapsed: z.number().int().nonnegative(),
  level: z.number().min(0).max(1),
  input: z.string().max(500),
  canPause: z.boolean(),
  locale: z.string().max(10),
  theme: z.enum(['light', 'dark']),
  captions: z
    .array(
      z.object({
        id: z.string(),
        time: z.string().max(30),
        text: z.string().max(20000),
        translation: z.string().max(20000),
        draft: z.boolean(),
      }),
    )
    .max(80),
  notes: z.string().max(200000),
  suggestion: z.object({ id: z.string(), text: z.string().max(20000) }).nullable(),
  aiEnabled: z.boolean(),
  aiBusy: z.boolean(),
  error: z.string().max(2000),
  captionNotice: z.string().max(2000).default(''),
});

// 同一窗口拥有采集；胶囊与原生菜单只发送动作，不能另开一套录音。
class DesktopController {
  constructor({ electron, root, dataDir, text, reportError }) {
    Object.assign(this, electron, { root, dataDir, text, reportError });
    this.preferences = desktopPreferencesSchema.parse({});
    this.state = null;
    this.pending = new Map();
    this.override = null;
    this.expanded = false;
    this.ready = false;
    this.bounds = null;
  }

  async load() {
    try {
      this.preferences = desktopPreferencesSchema.parse(
        JSON.parse(await readFile(this.file(), 'utf8')),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') this.reportError(error);
    }
  }

  file() {
    return path.join(this.dataDir(), 'desktop-preferences.json');
  }

  async save(payload) {
    const next = desktopPreferencesSchema.strict().parse(payload);
    // 先建立恢复入口；失败时不写入隐藏偏好，也不隐藏窗口。
    if (next.closeBehavior === 'hide') this.ensureTray();
    await writeAtomicFile(this.file(), JSON.stringify(next));
    this.preferences = next;
    this.sync();
    return next;
  }

  attach(window) {
    this.mainWindow = window;
    window.on('minimize', () => this.sync());
    window.on('restore', () => this.sync());
    window.on('show', () => this.sync());
    window.on('hide', () => this.sync());
    window.on('closed', () => {
      this.mainWindow = null;
      this.destroy();
    });
    window.webContents.on('render-process-gone', () => {
      for (const request of this.pending.values())
        request.reject(
          new Error(this.text('error.desktop.window_unavailable', this.state?.locale)),
        );
      this.pending.clear();
      this.state = null;
      this.sync();
    });
    this.sync();
  }

  background() {
    return !this.mainWindow?.isVisible() || this.mainWindow.isMinimized();
  }
  active() {
    return this.state?.meetingId && !['idle', 'saved'].includes(this.state.phase);
  }

  update(payload) {
    const state = desktopStateSchema.parse(payload);
    const changed = this.state?.meetingId !== state.meetingId;
    if (state.phase === 'saved' && this.state?.phase !== 'saved' && this.capsule?.isVisible()) {
      this.showSaved = true;
      clearTimeout(this.savedTimer);
      this.savedTimer = setTimeout(() => {
        this.showSaved = false;
        this.sync();
      }, 1500);
    }
    if (changed || !['saving', 'saved'].includes(state.phase)) {
      this.showSaved = false;
      clearTimeout(this.savedTimer);
    }
    const menuChanged =
      changed ||
      !this.state ||
      ['title', 'phase', 'input', 'canPause', 'locale'].some(
        (key) => state[key] !== this.state[key],
      ) ||
      state.elapsed !== this.state.elapsed;
    if (changed) {
      this.override = null;
      this.expanded = false;
    }
    this.state = state;
    this.sync(menuChanged);
    this.sendState();
  }

  level({ meetingId, level }) {
    if (this.state?.meetingId !== meetingId || this.state.phase !== 'recording') return;
    this.state.level = level;
    if (this.ready)
      this.capsule?.webContents.send('brevia:event', {
        type: 'desktop.level',
        payload: { meetingId, level },
      });
  }

  ensureTray() {
    if (this.tray) return;
    const icon = this.nativeImage.createFromPath(
      path.join(
        __dirname,
        process.platform === 'darwin' ? 'assets/trayTemplate.png' : 'assets/tray.png',
      ),
    );
    if (icon.isEmpty())
      throw new Error(this.text('error.desktop.icon_unavailable', this.state?.locale));
    icon.setTemplateImage(process.platform === 'darwin');
    this.tray = new this.Tray(icon);
    this.tray.setToolTip('Brevia');
    this.tray.on('double-click', () => this.showMain());
  }

  sync(rebuildMenu = true) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    try {
      if (this.preferences.trayVisibility === 'always' || this.background()) {
        this.ensureTray();
        if (rebuildMenu) this.updateMenu();
      } else if (this.tray) {
        this.tray.destroy();
        this.tray = null;
      }
    } catch (error) {
      this.reportError(error);
    }
    const wasVisible = Boolean(this.capsule?.isVisible());
    const visible =
      (this.active() || this.showSaved) &&
      (this.override === true ||
        (this.override !== false && this.preferences.autoCapsule && this.background()));
    if (visible) this.showCapsule();
    else this.capsule?.hide();
    this.capsule?.setAlwaysOnTop(true, 'floating');
    if (wasVisible !== Boolean(this.capsule?.isVisible())) this.updateMenuIfPresent();
  }

  updateMenu() {
    if (this.menuOpen) return;
    const t = (key) => this.text(key, this.state?.locale);
    const run = (action) => () => void this.action(action).catch(this.reportError);
    const state = this.state;
    const active = this.active();
    const busy = state?.phase === 'saving';
    const template = [
      { label: active ? state.title : 'Brevia', enabled: false },
      ...(active
        ? [
            {
              label: `${t(state.phase === 'paused' ? '已暂停' : busy ? '正在保存录音' : state.phase === 'failed' ? '保存失败' : '录音中')} · ${new Date(state.elapsed * 1000).toISOString().slice(11, 19)}`,
              enabled: false,
            },
            { label: state.input, enabled: false },
          ]
        : []),
      { type: 'separator' },
      {
        label: t(active ? '返回当前会议' : '打开 Brevia'),
        click: active ? run('return') : () => this.showMain(),
      },
      ...(active
        ? [
            {
              label: t(state.phase === 'paused' ? '继续录音' : '暂停录音'),
              enabled: state.canPause && !busy && state.phase !== 'failed',
              click: run('pause'),
            },
            { label: t('标记重点'), enabled: state.phase === 'recording', click: run('mark') },
            {
              label: t(state.phase === 'failed' ? '重试保存' : '结束并保存'),
              enabled: !busy,
              click: run('stop'),
            },
          ]
        : [
            { label: t('快速录音'), click: run('quick') },
            { label: t('开始录音'), click: run('prepare') },
          ]),
      { type: 'separator' },
      {
        label: t('显示录音胶囊'),
        type: 'checkbox',
        checked: Boolean(this.capsule?.isVisible()),
        enabled: Boolean(active),
        click: (item) => {
          this.override = item.checked;
          this.sync();
        },
      },
      { label: t('设置'), click: run('settings') },
      { type: 'separator' },
      { label: t('退出 Brevia'), click: () => this.app.quit() },
    ];
    const menu = this.Menu.buildFromTemplate(template);
    menu.on?.('menu-will-show', () => {
      this.menuOpen = true;
    });
    menu.on?.('menu-will-close', () => {
      this.menuOpen = false;
    });
    this.tray.setContextMenu(menu);
    this.tray.setToolTip(
      active
        ? `Brevia · ${state.title} · ${t(state.phase === 'paused' ? '已暂停' : busy ? '正在保存录音' : state.phase === 'failed' ? '保存失败' : '录音中')}`
        : 'Brevia',
    );
    if (process.platform === 'darwin') this.tray.setTitle(state?.phase === 'recording' ? '●' : '');
  }

  showMain() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show();
    this.mainWindow.focus();
    this.sync();
  }

  hideMain() {
    this.ensureTray();
    this.updateMenu();
    this.mainWindow.hide();
  }

  async action(action, payload = {}) {
    if (payload.meetingId && payload.meetingId !== this.state?.meetingId)
      throw new Error(this.text('error.desktop.session_changed', this.state?.locale));
    const meetingId = this.state?.meetingId || null;
    if (!this.mainWindow || this.mainWindow.isDestroyed())
      throw new Error(this.text('error.desktop.window_unavailable', this.state?.locale));
    if (
      ['return', 'prepare', 'settings', 'quick', 'ai-settings', 'models', 'confirm-quit'].includes(
        action,
      )
    )
      this.showMain();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer =
        action === 'confirm-quit'
          ? null
          : setTimeout(
              () => {
                this.pending.delete(requestId);
                reject(new Error(this.text('error.desktop.action_pending', this.state?.locale)));
              },
              action === 'stop' ? 610000 : 190000,
            );
      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.mainWindow.webContents.send('brevia:event', {
        type: 'desktop.action',
        payload: { action, requestId, meetingId, ...payload },
      });
    });
  }

  complete({ requestId, error, result }) {
    const request = this.pending.get(requestId);
    if (!request) return;
    this.pending.delete(requestId);
    if (error) request.reject(new Error(error));
    else request.resolve(result ?? true);
  }

  showCapsule() {
    if (this.capsule && !this.capsule.isDestroyed()) {
      if (this.ready && !this.capsule.isVisible()) this.capsule.showInactive();
      return;
    }
    const window = (this.capsule = new this.BrowserWindow({
      width: 344,
      height: 80,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      acceptFirstMouse: true,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    }));
    this.layout(false);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('did-finish-load', () => {
      if (this.capsule !== window) return;
      this.ready = true;
      this.sendState();
      if (
        this.active() &&
        (this.override === true ||
          (this.override !== false && this.background() && this.preferences.autoCapsule))
      )
        window.showInactive();
      this.updateMenuIfPresent();
    });
    window.on('closed', () => {
      this.capsule = null;
      this.ready = false;
    });
    void window.loadFile(path.join(this.root, 'frontend', 'recording-capsule.html'));
  }

  updateMenuIfPresent() {
    if (this.tray) this.updateMenu();
  }
  sendState() {
    if (this.ready && this.capsule && !this.capsule.isDestroyed())
      this.capsule.webContents.send('brevia:event', {
        type: 'desktop.state',
        payload: {
          ...this.state,
          expanded: this.expanded,
          above: this.above,
          pillOffset: this.pillOffset,
        },
      });
  }

  layout(expanded) {
    if (!this.capsule || this.capsule.isDestroyed()) return;
    const display = this.screen.getDisplayMatching(this.bounds || this.mainWindow.getBounds());
    const area = display.workArea;
    const pillWidth = Math.min(344, area.width);
    const width = Math.min(expanded ? 464 : 344, area.width);
    const pillX = Math.max(
      area.x,
      Math.min(
        this.bounds?.x ?? Math.round(area.x + (area.width - pillWidth) / 2),
        area.x + area.width - pillWidth,
      ),
    );
    const x = Math.max(area.x, Math.min(pillX, area.x + area.width - width));
    this.pillOffset = pillX - x;
    const pillY = Math.max(
      area.y,
      Math.min(this.bounds?.y ?? area.y + area.height - 80 - 32, area.y + area.height - 80),
    );
    const height = expanded ? Math.min(470, area.height) : 80;
    this.above = expanded && pillY + height > area.y + area.height;
    const y = this.above ? Math.max(area.y, pillY + 80 - height) : pillY;
    this.bounds = { x: pillX, y: pillY, width: pillWidth, height: 80 };
    this.expanded = expanded;
    this.capsule.setBounds({ x, y, width, height });
  }

  move({ dx, dy }) {
    if (!this.bounds) return;
    this.bounds.x += dx;
    this.bounds.y += dy;
    this.layout(this.expanded);
    this.sendState();
  }

  expand(expanded) {
    this.layout(expanded);
    this.sendState();
  }
  destroy() {
    clearTimeout(this.savedTimer);
    this.tray?.destroy();
    this.tray = null;
    this.capsule?.destroy();
    this.capsule = null;
    for (const request of this.pending.values())
      request.reject(new Error(this.text('error.desktop.closed', this.state?.locale)));
    this.pending.clear();
  }
}

module.exports = { DesktopController, desktopPreferencesSchema, desktopStateSchema };
