const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { z } = require('zod');
const { writeAtomicFile } = require('./main-logic');

const shortcutSchema = z
  .string()
  .max(100)
  .refine(
    (value) =>
      value === '' ||
      (/(?:^|\+)(?:Control|Alt|Command|CommandOrControl)\+/.test(value) &&
        /^(?:(?:Control|Alt|Shift|Command|CommandOrControl)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(
          value,
        )),
  );
const desktopPreferencesSchema = z.object({
  recordingShortcut: shortcutSchema.default('Alt+CommandOrControl+R'),
  pauseShortcut: shortcutSchema.default(''),
  lastCaptureMode: z.enum(['mic', 'system', 'both', 'phone']).default('both'),
  closeBehavior: z.enum(['quit', 'hide']).default('quit'),
  trayVisibility: z.enum(['always', 'background']).default('always'),
  meetingPrompts: z.boolean().default(true),
  meetingApps: z
    .array(z.object({ id: z.string().min(1).max(32767), name: z.string().min(1).max(255) }))
    .default([]),
  autoCapsule: z.boolean().default(true),
  // 兼容旧偏好文件；胶囊现在固定悬浮，不再提供置顶开关。
  capsuleOnTop: z.boolean().default(true),
});
const desktopStateSchema = z
  .object({
    systemAudioConfirmed: z.boolean().default(false),
    ready: z.boolean().default(false),
    meetingId: z.string().nullable(),
    title: z.string().max(500),
    phase: z.enum([
      'idle',
      'recording',
      'paused',
      'saving',
      'failed',
      'saved',
      'playing',
      'playback-paused',
    ]),
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
      .optional(),
    notes: z.string().max(200000),
    suggestion: z.object({ id: z.string(), text: z.string().max(20000) }).nullable(),
    aiEnabled: z.boolean(),
    aiBusy: z.boolean(),
    error: z.string().max(2000),
    captionNotice: z.string().max(2000).default(''),
    activeCaptionId: z.string().nullable().default(null),
  })
  .refine(
    (state) =>
      ['playing', 'playback-paused'].includes(state.phase) ||
      !state.captions ||
      state.captions.length <= 80,
    { message: 'Too many live captions', path: ['captions'] },
  );

// 同一窗口拥有采集；胶囊与原生菜单只发送动作，不能另开一套录音。
class DesktopController {
  constructor({ platform, root, dataDir, text, reportError }) {
    Object.assign(this, platform, { root, dataDir, text, reportError });
    this.preferences = desktopPreferencesSchema.parse({});
    this.state = null;
    this.pending = new Map();
    this.override = null;
    this.expanded = false;
    this.targetExpanded = false;
    this.layoutVersion = 0;
    this.ready = false;
    this.bounds = null;
    this.shortcuts = new Map();
    this.promptedApps = new Map();
    this.savePending = Promise.resolve();
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

  save(payload) {
    const pending = this.savePending.then(() =>
      this.saveNext(typeof payload === 'function' ? payload(this.preferences) : payload),
    );
    this.savePending = pending.catch(() => {});
    return pending;
  }

  changeMeetingApp(selected, remove) {
    return this.save((previous) => {
      const meetingApps = previous.meetingApps.filter(({ id }) => id !== (selected?.id || remove));
      if (selected) meetingApps.push(selected);
      return { meetingApps };
    });
  }

  async saveNext(payload) {
    const next = desktopPreferencesSchema.strict().parse({ ...this.preferences, ...payload });
    if (
      next.recordingShortcut &&
      next.pauseShortcut &&
      this.shortcutName(next.recordingShortcut) === this.shortcutName(next.pauseShortcut)
    )
      throw new Error(this.text('两个录音动作不能使用同一快捷键', this.state?.locale));
    if (next.closeBehavior === 'hide') this.ensureTray();
    const previous = this.preferences;
    this.updatingShortcuts =
      this.shortcutsReady &&
      ['recordingShortcut', 'pauseShortcut'].some((key) => Object.hasOwn(payload, key));
    if (this.updatingShortcuts) this.globalShortcut.setSuspended(false);
    try {
      // 写入成功前保留旧注册，磁盘失败时无需重新争抢旧按键。
      if (this.updatingShortcuts) await this.registerShortcuts(next, true);
      await writeAtomicFile(this.file(), JSON.stringify(next));
      if (this.updatingShortcuts) await this.registerShortcuts(next);
    } catch (error) {
      if (this.updatingShortcuts) await this.registerShortcuts(previous);
      throw error;
    } finally {
      if (this.updatingShortcuts) this.globalShortcut.setSuspended(Boolean(this.shortcutEditing));
      this.updatingShortcuts = false;
    }
    if (Object.hasOwn(payload, 'meetingApps')) {
      this.nativeAudio?.cancelMeetingProbe();
      for (const { id } of previous.meetingApps) {
        if (next.meetingApps.some((app) => app.id === id)) continue;
        const source = 'app:' + id;
        this.promptedApps.delete(source);
        if (this.promptSource === source) this.prompt?.destroy();
      }
    }
    this.preferences = next;
    this.sync();
    return next;
  }

  shortcutName(value) {
    return value
      .replace('CommandOrControl', process.platform === 'darwin' ? 'Command' : 'Control')
      .split('+')
      .sort()
      .join('+');
  }

  async registerShortcuts(preferences, keepPrevious = false) {
    const next = new Map();
    for (const key of ['recordingShortcut', 'pauseShortcut']) {
      const value = preferences[key];
      if (!value) continue;
      const name = this.shortcutName(value);
      if (next.has(name))
        throw new Error(this.text('两个录音动作不能使用同一快捷键', this.state?.locale));
      next.set(name, { value, key });
    }
    const added = [];
    try {
      for (const [name, binding] of next) {
        if (this.shortcuts.has(name)) continue;
        const registered = this.globalShortcut.register(
          binding.value,
          () => void this.runShortcut(name),
        );
        if (!(registered instanceof Promise ? await registered : registered))
          throw new Error(this.text('快捷键不可用，请在设置中更换组合键', this.state?.locale));
        added.push(binding.value);
      }
    } catch (error) {
      for (const value of added) this.globalShortcut.unregister(value);
      throw error;
    }
    if (!keepPrevious)
      for (const [name, binding] of this.shortcuts)
        if (!next.has(name)) this.globalShortcut.unregister(binding.value);
    this.shortcuts = keepPrevious ? new Map([...this.shortcuts, ...next]) : next;
  }

  editShortcuts(editing) {
    clearTimeout(this.shortcutEditTimer);
    this.shortcutEditing = editing;
    this.globalShortcut.setSuspended(editing);
    this.mainWindow?.webContents.setIgnoreMenuShortcuts(editing);
    if (editing) this.shortcutEditTimer = setTimeout(() => this.editShortcuts(false), 60000);
  }

  async runShortcut(name) {
    if (
      this.shortcutEditing ||
      this.shortcutBusy ||
      this.updatingShortcuts ||
      !this.state?.ready ||
      Date.now() < (this.shortcutCooldown || 0) ||
      this.pending.size ||
      this.state.phase === 'saving'
    )
      return;
    const key = this.shortcuts.get(name)?.key;
    if (!key) return;
    const pause = key === 'pauseShortcut';
    if (pause && (!this.state.canPause || !['recording', 'paused'].includes(this.state.phase)))
      return;
    this.shortcutBusy = true;
    try {
      await this.action(pause ? 'pause' : this.active() ? 'stop' : 'quick', { background: true });
    } catch (error) {
      this.showMain();
      this.reportError(error);
    } finally {
      this.shortcutBusy = false;
      this.shortcutCooldown = Date.now() + 750;
    }
  }

  attach(window) {
    this.mainWindow = window;
    this.mainBlurred = false;
    window.on('focus', () => {
      this.mainBlurred = false;
      this.nativeAudio?.cancelMeetingProbe();
      this.prompt?.destroy();
    });
    window.on('blur', () => {
      this.mainBlurred = true;
      this.editShortcuts(false);
    });
    if (this.nativeAudio) {
      clearInterval(this.meetingTimer);
      this.meetingTimer = setInterval(() => void this.checkMeetingSound(), 8000);
      this.meetingTimer.unref();
    }
    window.on('minimize', () => this.sync());
    window.on('restore', () => this.sync());
    window.on('show', () => this.sync());
    window.on('hide', () => this.sync());
    window.on('closed', () => {
      this.mainWindow = null;
      this.destroy();
    });
    window.webContents.on('render-process-gone', () => {
      this.editShortcuts(false);
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

  canPrompt() {
    return (
      this.mainWindow &&
      (this.mainBlurred || this.background()) &&
      this.preferences.meetingPrompts &&
      this.state?.ready &&
      ['idle', 'saved'].includes(this.state.phase) &&
      !this.pending.size &&
      !this.nativeAudio?.session &&
      (process.platform !== 'darwin' || this.state.systemAudioConfirmed)
    );
  }

  async checkMeetingSound() {
    if (!this.canPrompt() || this.checkingSound) return;
    this.checkingSound = true;
    const main = this.mainWindow;
    try {
      const preferences = this.preferences;
      const { active, audible } = await this.nativeAudio.query('meeting-audio', {
        apps: Object.fromEntries(preferences.meetingApps.map(({ id }) => [id, 'app:' + id])),
        excluded: [...this.promptedApps.keys()],
      });
      if (preferences !== this.preferences || main !== this.mainWindow || !this.canPrompt()) return;
      const now = Date.now();
      for (const [name, lastActive] of this.promptedApps) {
        if (active.includes(name)) this.promptedApps.set(name, now);
        else if (now - lastActive > 60000) this.promptedApps.delete(name);
      }
      if (!audible || this.prompt || this.promptedApps.has(audible)) return;
      this.promptedApps.set(audible, now);
      this.promptSource = audible;
      this.promptName =
        preferences.meetingApps.find(({ id }) => 'app:' + id === audible)?.name || audible;
      const area = this.screen.getDisplayMatching(main.getBounds()).workArea;
      const width = Math.min(396, area.width - 16),
        height = width < 352 ? 216 : 178;
      const prompt = (this.prompt = new this.NativeWindow({
        x: area.x + area.width - width - 8,
        y: area.y + 8,
        width,
        height,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
      }));
      prompt.webContents.once('did-finish-load', () => {
        if (this.prompt === prompt && this.canPrompt()) prompt.showInactive();
        else prompt.destroy();
      });
      prompt.once('closed', () => {
        if (this.prompt === prompt) this.prompt = null;
        clearTimeout(timer);
      });
      const timer = setTimeout(() => prompt.destroy(), 30000);
      await prompt.loadFile(path.join(this.root, 'frontend', 'meeting-prompt.html'));
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.prompt?.destroy();
      // A missing device or revoked permission must never interrupt the foreground app.
      console.warn('Meeting detection:', error.message);
    } finally {
      this.checkingSound = false;
    }
  }

  background() {
    return !this.mainWindow?.isVisible() || this.mainWindow.isMinimized();
  }
  active() {
    return (
      this.state?.meetingId &&
      ['recording', 'paused', 'saving', 'failed'].includes(this.state.phase)
    );
  }

  playback() {
    return this.state?.meetingId && ['playing', 'playback-paused'].includes(this.state.phase);
  }

  update(payload) {
    const state = desktopStateSchema.parse(payload);
    const changed =
      this.state?.meetingId !== state.meetingId ||
      Boolean(this.playback()) !== ['playing', 'playback-paused'].includes(state.phase);
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
      if (this.expanded || this.targetExpanded) void this.expand(false).catch(this.reportError);
    }
    state.captions ??= changed ? [] : this.state?.captions || [];
    this.state = state;
    if (state.ready && !this.shortcutsReady) {
      this.shortcutsReady = true;
      void this.registerShortcuts(this.preferences).catch((error) => {
        this.showMain();
        this.reportError(error);
      });
    }
    this.sync(menuChanged);
    this.sendState(changed || payload.captions !== undefined);
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

  shouldShowCapsule() {
    return (
      this.mainWindow?.isMinimized() &&
      this.mainWindow.isVisible() &&
      (this.active() || this.playback() || this.showSaved) &&
      (this.override ?? this.preferences.autoCapsule)
    );
  }

  sync(rebuildMenu = true) {
    if (!this.canPrompt()) {
      this.nativeAudio?.cancelMeetingProbe();
      this.prompt?.destroy();
    }
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
    if (this.shouldShowCapsule()) this.showCapsule();
    else this.capsule?.hide();
    this.capsule?.setAlwaysOnTop(true, 'floating');
    if (wasVisible !== Boolean(this.capsule?.isVisible())) this.updateMenuIfPresent();
  }

  updateMenu() {
    if (this.menuOpen) return;
    const t = (key) => this.text(key, this.state?.locale);
    const run = (action) => () => void this.action(action).catch(this.reportError);
    const state = this.state;
    const playback = this.playback();
    const active = this.active() || playback;
    const paused = ['paused', 'playback-paused'].includes(state?.phase);
    const status = paused
      ? '已暂停'
      : playback
        ? '正在播放'
        : state?.phase === 'saving'
          ? '正在保存录音'
          : state?.phase === 'failed'
            ? '保存失败'
            : '录音中';
    const busy = state?.phase === 'saving';
    const template = [
      { label: active ? state.title : 'Brevia', enabled: false },
      ...(active
        ? [
            {
              label: `${t(status)} · ${new Date(state.elapsed * 1000).toISOString().slice(11, 19)}`,
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
              label: t(playback ? (paused ? '继续' : '暂停') : paused ? '继续录音' : '暂停录音'),
              enabled: state.canPause && !busy && state.phase !== 'failed',
              accelerator: !playback ? this.preferences.pauseShortcut || undefined : undefined,
              registerAccelerator: false,
              click: run(playback ? 'playback-pause' : 'pause'),
            },
            ...(!playback
              ? [{ label: t('标记重点'), enabled: state.phase === 'recording', click: run('mark') }]
              : []),
            {
              label: t(
                playback ? '关闭播放' : state.phase === 'failed' ? '重试保存' : '结束并保存',
              ),
              enabled: !busy,
              accelerator: !playback ? this.preferences.recordingShortcut || undefined : undefined,
              registerAccelerator: false,
              click: run(playback ? 'playback-stop' : 'stop'),
            },
          ]
        : [
            {
              label: t('快速录音'),
              accelerator: this.preferences.recordingShortcut || undefined,
              registerAccelerator: false,
              click: run('quick'),
            },
            { label: t('开始录音'), click: run('prepare') },
          ]),
      { type: 'separator' },
      {
        label: t('显示录音胶囊'),
        type: 'checkbox',
        checked: Boolean(this.capsule?.isVisible()),
        enabled: Boolean(active && this.mainWindow?.isMinimized() && this.mainWindow.isVisible()),
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
    this.tray.setToolTip(active ? `Brevia · ${state.title} · ${t(status)}` : 'Brevia');
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
    if (action === 'agent-devices') {
      const deadline = Date.now() + 30000;
      while (!this.state?.ready) {
        if (Date.now() >= deadline) throw new Error('Brevia device controls did not become ready');
        await delay(100);
      }
    }
    if (payload.meetingId && payload.meetingId !== this.state?.meetingId)
      throw new Error(this.text('error.desktop.session_changed', this.state?.locale));
    const meetingId = this.state?.meetingId || null;
    if (!this.mainWindow || this.mainWindow.isDestroyed())
      throw new Error(this.text('error.desktop.window_unavailable', this.state?.locale));
    if (
      !payload.background &&
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
              action === 'stop' ||
                (action === 'agent-recording' && payload.recording?.action === 'stop')
                ? 610000
                : 190000,
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
    const window = (this.capsule = new this.NativeWindow({
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
    void this.layout(false).catch(this.reportError);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('did-finish-load', () => {
      if (this.capsule !== window) return;
      this.ready = true;
      this.sendState();
      if (this.shouldShowCapsule()) window.showInactive();
      this.updateMenuIfPresent();
    });
    window.on('closed', () => {
      this.capsule = null;
      this.expanded = this.targetExpanded = false;
      this.ready = false;
    });
    void window.loadFile(path.join(this.root, 'frontend', 'recording-capsule.html'));
  }

  updateMenuIfPresent() {
    if (this.tray) this.updateMenu();
  }
  sendState(includeCaptions = true) {
    if (!this.ready || !this.capsule || this.capsule.isDestroyed()) return;
    const payload = {
      ...this.state,
      expanded: this.expanded,
      above: this.above,
      pillOffset: this.pillOffset,
    };
    if (!includeCaptions) delete payload.captions;
    this.capsule.webContents.send('brevia:event', { type: 'desktop.state', payload });
  }

  async layout(expanded) {
    const capsule = this.capsule;
    if (!capsule || capsule.isDestroyed()) return;
    const display = this.screen.getDisplayMatching(this.bounds || this.mainWindow.getBounds());
    const area = display.workArea;
    const pillWidth = Math.min(344, area.width);
    const panelWidth = Math.min(464, area.width);
    const width = expanded ? panelWidth : pillWidth;
    const pillX = Math.max(
      area.x,
      Math.min(
        this.bounds?.x ?? Math.round(area.x + (area.width - pillWidth) / 2),
        area.x + area.width - pillWidth,
      ),
    );
    const x = Math.max(area.x, Math.min(pillX, area.x + area.width - width));
    // Publish the expanded inset even while collapsed so WebKit can anchor the first resize frame.
    this.pillOffset = Math.max(0, pillX + panelWidth - area.x - area.width);
    const pillY = Math.max(
      area.y,
      Math.min(this.bounds?.y ?? area.y + area.height - 80 - 32, area.y + area.height - 80),
    );
    const height = expanded ? Math.min(470, area.height) : 80;
    this.above = pillY + Math.min(470, area.height) > area.y + area.height;
    const y = this.above ? Math.max(area.y, pillY + 80 - height) : pillY;
    this.bounds = { x: pillX, y: pillY, width: pillWidth, height: 80 };
    this.targetExpanded = expanded;
    const version = ++this.layoutVersion;
    try {
      await capsule.setBounds({ x, y, width, height });
    } catch (error) {
      if (this.capsule === capsule && this.layoutVersion === version)
        this.targetExpanded = this.expanded;
      throw error;
    }
    // Native bounds requests complete in order; the next request may still fail.
    if (this.capsule === capsule) this.expanded = expanded;
  }

  async move({ dx, dy }) {
    if (!this.bounds) return;
    this.bounds.x += dx;
    this.bounds.y += dy;
    await this.layout(this.targetExpanded);
    this.sendState(false);
  }

  async expand(expanded) {
    await this.layout(expanded);
    this.sendState(false);
  }
  destroy() {
    clearInterval(this.meetingTimer);
    this.nativeAudio?.cancelMeetingProbe();
    this.prompt?.destroy();
    this.editShortcuts(false);
    for (const binding of this.shortcuts.values()) this.globalShortcut.unregister(binding.value);
    this.shortcuts.clear();
    this.shortcutsReady = false;
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
