const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm, mkdir, writeFile, realpath } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { selectedMeetingApp } = require('./meeting-app.cjs');
const { DesktopController, desktopStateSchema } = require('./desktop-controller');

class Window extends EventEmitter {
  constructor(options = {}) {
    super();
    this.visible = false;
    this.options = options;
    this.rectangle = { x: 0, y: 0, width: 344, height: 80 };
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.setIgnoreMenuShortcuts = (value) => {
      this.ignoreMenuShortcuts = value;
    };
    this.webContents.send = (...args) => {
      this.sent = args;
    };
  }
  isDestroyed() {
    return false;
  }
  isVisible() {
    return this.visible;
  }
  isMinimized() {
    return Boolean(this.minimized);
  }
  show() {
    this.visible = true;
    this.emit('show');
  }
  showInactive() {
    this.inactive = true;
    this.visible = true;
  }
  hide() {
    this.visible = false;
    this.emit('hide');
  }
  focus() {
    this.focused = true;
  }
  restore() {
    this.minimized = false;
    this.emit('restore');
  }
  getBounds() {
    return this.rectangle;
  }
  setBounds(bounds) {
    this.rectangle = bounds;
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  loadFile() {
    this.webContents.emit('did-finish-load');
    return Promise.resolve();
  }
  destroy() {
    this.visible = false;
    this.emit('closed');
  }
}
class Tray extends EventEmitter {
  setToolTip(text) {
    this.tip = text;
  }
  setTitle() {}
  setContextMenu(menu) {
    this.menu = menu;
  }
  destroy() {
    this.destroyed = true;
  }
}

(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brevia-desktop-'));
  const errors = [];
  const bindings = new Map();
  let suspended = false;
  const platform = {
    globalShortcut: {
      register(value, callback) {
        if (value === 'Alt+X' || bindings.has(value)) return false;
        bindings.set(value, callback);
        return true;
      },
      unregister: (value) => bindings.delete(value),
      setSuspended: (value) => {
        suspended = value;
      },
    },
    app: { quit() {} },
    NativeWindow: Window,
    Tray,
    nativeImage: {
      createFromPath: (file) => ({
        isEmpty: () => !require('node:fs').existsSync(file),
        setTemplateImage() {},
      }),
    },
    Menu: { buildFromTemplate: (menu) => menu },
    screen: {
      getDisplayMatching: () => ({ workArea: { x: -900, y: 0, width: 900, height: 700 } }),
    },
  };
  const make = () =>
    new DesktopController({
      platform,
      root: dir,
      dataDir: () => dir,
      text: (key) => key,
      reportError: (error) => errors.push(error),
    });
  const controller = make();
  try {
    await controller.load();
    assert.equal(controller.preferences.closeBehavior, 'quit', '升级不静默改为隐藏');
    await controller.save({
      closeBehavior: 'hide',
      trayVisibility: 'background',
      autoCapsule: true,
      capsuleOnTop: true,
    });
    const reloaded = make();
    await reloaded.load();
    assert.equal(reloaded.preferences.closeBehavior, 'hide');
    await assert.rejects(controller.save({ ...controller.preferences, closeBehavior: 'destroy' }));
    assert.deepEqual(reloaded.preferences.meetingApps, [], '旧偏好默认为空名单');
    const mac = process.platform === 'darwin';
    if (mac || process.platform === 'win32') {
      const selected = path.join(dir, mac ? 'Acme会议.app' : 'Acme会议.exe');
      if (mac) {
        await mkdir(path.join(selected, 'Contents'), { recursive: true });
        await writeFile(
          path.join(selected, 'Contents', 'Info.plist'),
          JSON.stringify({
            CFBundleIdentifier: 'com.Acme.Calls',
            CFBundlePackageType: 'APPL',
            CFBundleDisplayName: '企业会议',
          }),
        );
      } else await writeFile(selected, 'MZ');
      const app = await selectedMeetingApp(selected);
      assert.equal(app.id, mac ? 'com.acme.calls' : await realpath(selected));
      assert.equal(app.name, mac ? '企业会议' : 'Acme会议');
      await Promise.all([
        controller.changeMeetingApp(app),
        controller.changeMeetingApp(app),
        controller.save({ meetingPrompts: true }),
      ]);
      await reloaded.load();
      assert.deepEqual(reloaded.preferences.meetingApps, [app]);
      await controller.changeMeetingApp(null, app.id);
      await reloaded.load();
      assert.deepEqual(reloaded.preferences.meetingApps, []);
      if (mac) {
        const writeInfo = (id, types = []) =>
          writeFile(
            path.join(selected, 'Contents', 'Info.plist'),
            JSON.stringify({
              CFBundleIdentifier: id,
              CFBundlePackageType: 'APPL',
              CFBundleDisplayName: 'iFlyChat',
              CFBundleURLTypes: [{ CFBundleURLSchemes: ['https', 'acme-meeting'] }],
              CFBundleDocumentTypes: types,
            }),
          );
        await writeInfo('com.acme.collaboration', [
          { CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['com.acme.agenda'] },
        ]);
        assert.deepEqual(await selectedMeetingApp(selected, 'i讯飞'), {
          id: 'com.acme.collaboration',
          name: 'i讯飞',
        });
        for (const [id, type] of [
          ['com.brevia.app', {}],
          ['com.google.Chrome.canary', {}],
          [
            'org.other.browser',
            { CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.html'] },
          ],
          ['org.legacy.browser', { CFBundleTypeRole: 'Viewer', CFBundleTypeExtensions: ['htm'] }],
          [
            'org.xhtml.browser',
            { CFBundleTypeRole: 'Viewer', CFBundleTypeMIMETypes: ['application/xhtml+xml'] },
          ],
        ]) {
          await writeInfo(id, [type]);
          await assert.rejects(selectedMeetingApp(selected), { code: 'error.meeting_app.invalid' });
        }
      } else {
        for (const name of ['Brevia.exe', 'chrome.exe']) {
          const file = path.join(dir, name);
          await writeFile(file, 'MZ');
          await assert.rejects(selectedMeetingApp(file), { code: 'error.meeting_app.invalid' });
        }
      }
    }
    const main = new Window();
    main.visible = true;
    controller.attach(main);
    const state = {
      ready: true,
      meetingId: 'one',
      title: '第一场',
      phase: 'recording',
      elapsed: 8,
      level: 0.3,
      input: '麦克风',
      canPause: true,
      locale: 'zh',
      theme: 'light',
      captions: [],
      notes: '',
      suggestion: null,
      aiEnabled: false,
      aiBusy: false,
      error: '',
    };
    const detection = make();
    const owner = new Window();
    owner.visible = true;
    detection.attach(owner);
    let queries = 0;
    let audio = { active: ['Zoom'] };
    let cancellations = 0;
    detection.nativeAudio = {
      cancelMeetingProbe: () => {
        cancellations++;
      },
      query: async (command, options) => {
        assert.equal(command, 'meeting-audio');
        assert.deepEqual(options.apps, {
          'com.acme.calls': 'app:com.acme.calls',
          'com.other.calls': 'app:com.other.calls',
        });
        queries++;
        return audio;
      },
    };
    detection.update({
      ...state,
      phase: 'idle',
      ready: false,
      meetingId: null,
      systemAudioConfirmed: true,
    });
    detection.state.ready = true;
    await detection.checkMeetingSound();
    assert.equal(queries, 0, '前台窗口不检测声音');
    await detection.changeMeetingApp({ id: 'com.acme.calls', name: '企业会议' });
    await detection.changeMeetingApp({ id: 'com.other.calls', name: '企业会议' });
    owner.emit('blur');
    await detection.checkMeetingSound();
    assert.equal(detection.prompt, undefined, '静音会议不提示');
    audio.audible = 'Zoom';
    await detection.checkMeetingSound();
    assert.equal(detection.prompt.inactive, true);
    detection.prompt.destroy();
    await detection.checkMeetingSound();
    assert.equal(detection.prompt, null, '关闭后同一场不重复提示');
    audio = { active: ['Zoom', 'Discord'], audible: 'Discord' };
    await detection.checkMeetingSound();
    assert.equal(detection.promptName, 'Discord');
    detection.prompt.destroy();
    audio.audible = 'Zoom';
    await detection.checkMeetingSound();
    assert.equal(detection.prompt, null, '多个会议应用分别去重');
    audio = {
      active: ['app:com.acme.calls', 'app:com.other.calls'],
      audible: 'app:com.acme.calls',
    };
    await detection.checkMeetingSound();
    assert.equal(detection.promptName, '企业会议');
    detection.prompt.destroy();
    audio.audible = 'app:com.other.calls';
    await detection.checkMeetingSound();
    assert.equal(detection.promptSource, 'app:com.other.calls');
    await detection.changeMeetingApp(null, 'com.other.calls');
    assert.equal(detection.prompt, null, '移除正在发声的应用立即关闭对应提醒');
    let release;
    detection.nativeAudio.query = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pendingCheck = detection.checkMeetingSound();
    await detection.changeMeetingApp(null, 'com.acme.calls');
    release({ active: ['app:com.acme.calls'], audible: 'app:com.acme.calls' });
    await pendingCheck;
    assert.equal(detection.prompt, null, '移除期间迟到的检测结果不再弹出提醒');
    const beforeDisable = cancellations;
    const disabling = detection.checkMeetingSound();
    await detection.save({ meetingPrompts: false });
    release({ active: ['Zoom'], audible: 'Zoom' });
    await disabling;
    assert.equal(detection.prompt, null, '关闭检测后的旧探测作废');
    assert.ok(cancellations > beforeDisable, '关闭检测时终止原生探测');
    await detection.save({ meetingPrompts: true });
    detection.promptedApps.clear();
    detection.nativeAudio.query = async () => {
      owner.emit('focus');
      return audio;
    };
    await detection.checkMeetingSound();
    assert.equal(detection.prompt, null, '探测期间回到前台不弹窗');
    detection.destroy();
    assert.throws(() => desktopStateSchema.parse({ ...state, level: 9 }));
    assert.throws(() => desktopStateSchema.parse({ ...state, captions: Array(81).fill({}) }));
    controller.update({ ...state, ready: false });
    assert.equal(bindings.size, 0, '初始化完成前不注册快捷键');
    controller.update(state);
    assert.equal(controller.capsule, undefined, '可见主窗不自动弹胶囊');
    main.hide();
    assert.equal(controller.capsule, undefined, '仅隐藏到托盘不显示胶囊');
    main.show();
    main.minimized = true;
    main.emit('minimize');
    assert.equal(controller.capsule.isVisible(), true);
    assert.equal(controller.capsule.inactive, true, '显示胶囊不激活窗口');
    main.hide();
    assert.equal(controller.capsule.isVisible(), false, '最小化后隐藏到托盘也收起胶囊');
    main.show();
    assert.equal(controller.capsule.isVisible(), true);
    assert.equal(controller.capsule.getBounds().width, 344);
    assert.equal(controller.capsule.getBounds().height, 80);
    assert.equal(controller.capsule.getBounds().x, -622, '胶囊默认在工作区水平居中');
    assert.equal(controller.capsule.getBounds().y, 588, '胶囊默认靠工作区底部，留出 32px');
    await controller.expand(true);
    assert.equal(controller.above, true, '默认位置向上展开');
    assert.equal(controller.capsule.getBounds().y + 470, 668, '展开保持胶囊底部锚点');
    await controller.expand(false);
    assert.equal(controller.capsule.getBounds().y, 588, '收起保持默认位置');
    assert.equal(controller.above, true, '收起时保留展开方向，避免 CSS 布局在窗口缩放前翻转');
    const originalBounds = controller.capsule.setBounds.bind(controller.capsule);
    let finishBounds;
    controller.capsule.setBounds = (bounds) => {
      originalBounds(bounds);
      return new Promise((resolve) => {
        finishBounds = resolve;
      });
    };
    const previousEvent = controller.capsule.sent;
    const waitingForBounds = controller.expand(true);
    assert.equal(controller.capsule.sent, previousEvent, '原生窗口确认尺寸前不发送布局状态');
    controller.update({ ...state, elapsed: state.elapsed + 1 });
    assert.equal(
      controller.capsule.sent[1].payload.expanded,
      false,
      '进度更新不能提前发布未确认的尺寸',
    );
    finishBounds();
    await waitingForBounds;
    assert.equal(controller.capsule.sent[1].payload.expanded, true);
    controller.capsule.setBounds = originalBounds;
    await controller.expand(false);

    let failFirstResize;
    controller.capsule.setBounds = () =>
      new Promise((_, reject) => {
        failFirstResize = reject;
      });
    const firstResize = controller.expand(true);
    controller.capsule.setBounds = originalBounds;
    await controller.expand(false);
    const latestResize = controller.expand(true);
    failFirstResize(new Error('old resize timed out'));
    await assert.rejects(firstResize, /old resize timed out/);
    await latestResize;
    assert.equal(controller.targetExpanded, true, '迟到的旧超时不会撤销新展开');
    assert.equal(controller.expanded, true);
    await controller.expand(false);
    const expanding = controller.expand(true);
    controller.capsule.setBounds = () => Promise.reject(new Error('collapse timed out'));
    const collapsing = controller.expand(false);
    await expanding;
    await assert.rejects(collapsing, /collapse timed out/);
    assert.equal(controller.expanded, true, '保留最后确认的原生边界');
    assert.equal(controller.targetExpanded, true);
    controller.capsule.setBounds = originalBounds;
    await controller.expand(false);

    controller.bounds = { x: -1100, y: 680, width: 344, height: 80 };
    await controller.expand(true);
    assert.equal(controller.above, true);
    assert.equal(controller.capsule.getBounds().x, -900);
    assert.ok(controller.capsule.getBounds().y >= 0);
    assert.ok(controller.capsule.getBounds().y + controller.capsule.getBounds().height <= 700);
    controller.bounds = { x: -400, y: 40, width: 344, height: 80 };
    await controller.expand(true);
    assert.equal(controller.capsule.getBounds().width, 464, '展开面板保留阅读宽度');
    assert.equal(
      controller.capsule.getBounds().x + controller.pillOffset,
      -400,
      '屏幕右侧展开不移动胶囊',
    );
    assert.ok(controller.capsule.getBounds().x >= -900);
    assert.ok(controller.capsule.getBounds().x + controller.capsule.getBounds().width <= 0);
    await controller.expand(false);
    assert.equal(controller.capsule.getBounds().x, -400);
    assert.equal(controller.capsule.getBounds().width, 344);
    assert.equal(controller.pillOffset, 64, '折叠态提前保留下一次展开的右侧偏移');
    controller.override = false;
    controller.sync();
    controller.update({ ...state, elapsed: 9 });
    assert.equal(controller.capsule.isVisible(), false, '刷新不能撤销本场手动隐藏');
    controller.update({ ...state, meetingId: 'two', title: '第二场' });
    assert.equal(controller.capsule.isVisible(), true, '新会话恢复自动规则');
    controller.override = true;
    main.restore();
    assert.equal(controller.capsule.isVisible(), false, '手动显示也只在最小化期间生效');
    controller.capsule.webContents.emit('did-finish-load');
    assert.equal(controller.capsule.isVisible(), false, '恢复窗口后迟到的加载事件不能显示胶囊');
    controller.override = null;
    controller.update({ ...state, phase: 'playing' });
    const fullCaptions = Array.from({ length: 240 }, (_, index) => ({
      id: String(index),
      time: '00:00',
      text: `字幕 ${index}`,
      translation: '',
      draft: false,
    }));
    controller.update({ ...state, phase: 'playing', captions: fullCaptions });
    const { captions: omitted, ...progressOnly } = { ...state, phase: 'playing', elapsed: 20 };
    controller.update(progressOnly);
    assert.equal(controller.state.captions.length, 240, '进度更新保留完整字幕');
    assert.equal(
      controller.capsule.sent[1].payload.captions,
      undefined,
      '进度事件不反复传输完整正文',
    );

    assert.equal(Boolean(controller.active()), false, '播放不能被当成正在录音');
    assert.equal(controller.capsule.isVisible(), false, '主窗播放不显示胶囊');
    main.emit('blur');
    main.hide();
    assert.equal(controller.capsule.isVisible(), false, '播放期间失焦和隐藏不显示胶囊');
    main.show();
    main.minimized = true;
    main.emit('minimize');
    assert.equal(controller.capsule.isVisible(), true, '最小化后才显示播放胶囊');
    controller.update({ ...state, phase: 'playback-paused' });
    assert.equal(controller.capsule.isVisible(), true, '暂停保留播放控制');
    await controller.expand(true);
    controller.override = false;
    controller.update({ ...state, phase: 'playing', elapsed: 10 });
    assert.equal(controller.capsule.isVisible(), false, '进度更新不能撤销手动隐藏');
    controller.update({ ...state, phase: 'playing', meetingId: 'new-playback' });
    assert.equal(controller.capsule.isVisible(), true, '新会议播放恢复自动显示');
    assert.equal(controller.capsule.getBounds().height, 80, '换场收起同时还原原生窗口尺寸');
    controller.update({ ...state, phase: 'idle' });
    assert.equal(controller.capsule.isVisible(), false, '播放结束关闭胶囊');
    controller.update({ ...state, phase: 'playing' });
    await controller.save({ autoCapsule: false });
    assert.equal(controller.capsule.isVisible(), false, '关闭自动胶囊同样适用于播放');
    await controller.save({ autoCapsule: true });
    controller.update(state);
    assert.equal(controller.capsule.isVisible(), true, '同一会议从播放切换到录音也遵循最小化状态');
    main.restore();
    assert.equal(controller.capsule.isVisible(), false, '恢复窗口立即收起录音胶囊');
    const request = controller.action('pause');
    const payload = main.sent[1].payload;
    assert.equal(payload.action, 'pause');
    controller.complete({ requestId: payload.requestId });
    assert.equal(await request, true);
    const confirmation = controller.action('confirm-quit');
    controller.complete({ requestId: main.sent[1].payload.requestId, result: false });
    assert.equal(await confirmation, false, '取消确认保留 false 结果');
    const failed = controller.action('stop');
    controller.complete({ requestId: main.sent[1].payload.requestId, error: '保存失败' });
    await assert.rejects(failed, /保存失败/);
    controller.update({ ...state, phase: 'paused' });
    assert.equal(controller.state.phase, 'paused');
    const defaultKey = controller.preferences.recordingShortcut;
    assert.equal(bindings.has(defaultKey), true);
    await assert.rejects(controller.save({ recordingShortcut: 'R' }));
    await assert.rejects(controller.save({ recordingShortcut: 'Shift+R' }));
    await assert.rejects(controller.save({ recordingShortcut: 'Alt+X' }), /快捷键不可用/);
    assert.equal(controller.preferences.recordingShortcut, defaultKey);
    assert.equal(bindings.has(defaultKey), true, '冲突时保留旧绑定');
    const alias = defaultKey.replace(
      'CommandOrControl',
      process.platform === 'darwin' ? 'Command' : 'Control',
    );
    await assert.rejects(controller.save({ pauseShortcut: alias }), /同一快捷键/);
    await controller.save({ recordingShortcut: 'Alt+R', pauseShortcut: 'Alt+P' });
    assert.equal(bindings.has(defaultKey), false);
    assert.equal(bindings.size, 2);
    const preferenceFile = controller.file;
    controller.file = () => dir;
    await assert.rejects(controller.save({ recordingShortcut: 'Alt+T' }));
    controller.file = preferenceFile;
    assert.equal(controller.preferences.recordingShortcut, 'Alt+R');
    assert.equal(bindings.has('Alt+R'), true, '磁盘失败恢复旧快捷键');
    assert.equal(bindings.has('Alt+T'), false);
    await Promise.all([
      controller.save({ lastCaptureMode: 'mic' }),
      controller.save({ autoCapsule: false }),
    ]);
    assert.equal(controller.preferences.lastCaptureMode, 'mic');
    assert.equal(controller.preferences.autoCapsule, false, '独立偏好并发保存不会互相覆盖');
    controller.editShortcuts(true);
    assert.equal(suspended, true);
    assert.equal(main.ignoreMenuShortcuts, true, '按键编辑不能触发菜单的重新加载或退出');
    await controller.save({ lastCaptureMode: 'both' });
    assert.equal(suspended, true, '后台记忆来源不能打断按键编辑');
    main.emit('blur');
    assert.equal(suspended, false);
    assert.equal(main.ignoreMenuShortcuts, false);
    const recordingName = controller.shortcutName('Alt+R');
    const pauseName = controller.shortcutName('Alt+P');
    const invoke = (name) => {
      controller.shortcutCooldown = 0;
      return controller.runShortcut(name);
    };
    controller.update({ ...state, phase: 'idle', meetingId: null });
    main.hide();
    main.focused = false;
    const starting = invoke(recordingName);
    assert.equal(main.sent[1].payload.action, 'quick');
    assert.equal(main.sent[1].payload.background, true);
    assert.equal(main.isVisible(), false);
    assert.equal(main.focused, false);
    const startRequest = main.sent[1].payload.requestId;
    await invoke(recordingName);
    assert.equal(controller.pending.size, 1, '启动未确认时连按不重复发送');
    controller.complete({ requestId: startRequest });
    await starting;
    for (const phase of ['recording', 'paused', 'failed']) {
      controller.update({ ...state, phase });
      const stopping = invoke(recordingName);
      assert.equal(main.sent[1].payload.action, 'stop');
      controller.complete({ requestId: main.sent[1].payload.requestId });
      await stopping;
    }
    controller.update({ ...state, phase: 'saving' });
    await invoke(recordingName);
    assert.equal(controller.pending.size, 0, '保存中不重复结束');
    controller.update({ ...state, phase: 'recording', canPause: false });
    await invoke(pauseName);
    assert.equal(controller.pending.size, 0);
    controller.update(state);
    const pausing = invoke(pauseName);
    assert.equal(main.sent[1].payload.action, 'pause');
    controller.complete({ requestId: main.sent[1].payload.requestId });
    await pausing;
    await controller.runShortcut(recordingName);
    assert.equal(controller.pending.size, 0, '完成后短暂防抖');
    controller.editShortcuts(true);
    await invoke(recordingName);
    assert.equal(controller.pending.size, 0, '编辑中不响应快捷键');
    controller.editShortcuts(false);
    const failing = invoke(recordingName);
    controller.complete({ requestId: main.sent[1].payload.requestId, error: '保存错误' });
    await failing;
    assert.equal(main.isVisible(), true, '失败显示恢复入口');
    assert.equal(errors.pop().message, '保存错误');
    await controller.save({ recordingShortcut: '', pauseShortcut: '' });
    assert.equal(bindings.size, 0, '清除后释放注册');
    const conflict = make();
    conflict.preferences.recordingShortcut = 'Alt+X';
    const conflictWindow = new Window();
    conflict.attach(conflictWindow);
    conflict.update(state);
    await Promise.resolve();
    assert.equal(conflictWindow.isVisible(), true, '启动冲突显示窗口提示');
    assert.match(errors.pop().message, /快捷键不可用/);
    assert.equal(conflict.preferences.recordingShortcut, 'Alt+X', '启动冲突不覆盖保存配置');
    conflict.destroy();
    await controller.save({ recordingShortcut: 'Alt+R' });
    platform.nativeImage.createFromPath = () => ({ isEmpty: () => true });
    controller.tray?.destroy();
    controller.tray = null;
    assert.throws(() => controller.hideMain(), /error.desktop.icon_unavailable/);
    assert.equal(main.isVisible(), true, '入口创建失败时不隐藏主窗口');
    assert.equal(errors.length, 0);
    console.log(
      'Desktop lifecycle, geometry, preference persistence and action acknowledgement passed',
    );
  } finally {
    controller.destroy();
    assert.equal(bindings.size, 0);
    assert.equal(suspended, false);
    await rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// 真正退出必须等到保存确认；取消或失败后保留应用，不能落回旧的 8 秒强退。
(async () => {
  const fs = require('node:fs/promises');
  const { runInNewContext } = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, 'main.js'), 'utf8');
  const quitSource = source.slice(
    source.indexOf("app.on('before-quit'"),
    source.indexOf("app.on('window-all-closed'"),
  );
  for (const scenario of ['cancel', 'saved', 'failed', 'draft', 'idle', 'crashed']) {
    const calls = [];
    let callback;
    const context = {
      quittingAfterMeetingStop: false,
      installingUpdate: false,
      quitRequested: false,
      app: {
        on: (_, handler) => {
          callback = handler;
        },
        quit: () => calls.push('quit'),
      },
      worker: {
        active: scenario === 'idle' || scenario === 'draft' ? null : { meeting_id: 'one' },
      },
      desktop: {
        state: { locale: 'zh', title: '周会' },
        mainWindow: { webContents: { isCrashed: () => scenario === 'crashed' } },
        text: (key) => key,
        showMain: () => calls.push('show'),
        async action(action) {
          calls.push(action);
          if (scenario === 'draft' || (scenario === 'failed' && action === 'stop'))
            throw Error('保留修改与录音');
          if (action === 'confirm-quit') return scenario !== 'cancel';
          if (action === 'stop') context.worker.active = null;
        },
      },
      stopActiveMeeting: async () => {
        calls.push('fallback');
        context.worker.active = null;
      },
      dialog: { showMessageBox: async () => ({ response: scenario === 'cancel' ? 0 : 1 }) },
      reportMainError: () => calls.push('error'),
    };
    runInNewContext(quitSource, context);
    let prevented = false;
    callback({
      preventDefault() {
        prevented = true;
      },
    });
    for (let turn = 0; turn < 20 && context.quitRequested; turn++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prevented, true);
    if (scenario === 'saved') assert.deepEqual(calls, ['flush', 'confirm-quit', 'stop', 'quit']);
    if (scenario === 'idle') assert.deepEqual(calls, ['flush', 'quit']);
    if (scenario === 'crashed') assert.deepEqual(calls, ['fallback', 'quit']);
    if (scenario === 'cancel') assert.deepEqual(calls, ['flush', 'confirm-quit']);
    if (scenario === 'failed')
      assert.deepEqual(calls, ['flush', 'confirm-quit', 'stop', 'error', 'show']);
    if (scenario === 'draft') assert.deepEqual(calls, ['flush', 'error', 'show']);
  }
  console.log(
    'Quit cancellation, save acknowledgement, failure recovery and draft protection passed',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
