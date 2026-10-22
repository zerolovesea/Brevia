const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DesktopController, desktopStateSchema } = require('./desktop-controller');

class Window extends EventEmitter {
  constructor(options = {}) {
    super();
    this.visible = false;
    this.options = options;
    this.rectangle = { x: 0, y: 0, width: 344, height: 80 };
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
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
  const electron = {
    app: { quit() {} },
    BrowserWindow: Window,
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
      electron,
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
    const main = new Window();
    main.visible = true;
    controller.attach(main);
    const state = {
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
    assert.throws(() => desktopStateSchema.parse({ ...state, level: 9 }));
    assert.throws(() => desktopStateSchema.parse({ ...state, captions: Array(81).fill({}) }));
    controller.update(state);
    assert.equal(controller.capsule, undefined, '可见主窗不自动弹胶囊');
    main.minimized = true;
    main.emit('minimize');
    assert.equal(controller.capsule.isVisible(), true);
    assert.equal(controller.capsule.inactive, true, '显示胶囊不激活窗口');
    assert.equal(controller.capsule.getBounds().width, 344);
    assert.equal(controller.capsule.getBounds().height, 80);
    assert.equal(controller.capsule.getBounds().x, -622, '胶囊默认在工作区水平居中');
    assert.equal(controller.capsule.getBounds().y, 588, '胶囊默认靠工作区底部，留出 32px');
    controller.expand(true);
    assert.equal(controller.above, true, '默认位置向上展开');
    assert.equal(controller.capsule.getBounds().y + 470, 668, '展开保持胶囊底部锚点');
    controller.expand(false);
    assert.equal(controller.capsule.getBounds().y, 588, '收起保持默认位置');
    controller.bounds = { x: -1100, y: 680, width: 344, height: 80 };
    controller.expand(true);
    assert.equal(controller.above, true);
    assert.equal(controller.capsule.getBounds().x, -900);
    assert.ok(controller.capsule.getBounds().y >= 0);
    assert.ok(controller.capsule.getBounds().y + controller.capsule.getBounds().height <= 700);
    controller.bounds = { x: -400, y: 40, width: 344, height: 80 };
    controller.expand(true);
    assert.equal(controller.capsule.getBounds().width, 464, '展开面板保留阅读宽度');
    assert.equal(
      controller.capsule.getBounds().x + controller.pillOffset,
      -400,
      '屏幕右侧展开不移动胶囊',
    );
    assert.ok(controller.capsule.getBounds().x >= -900);
    assert.ok(controller.capsule.getBounds().x + controller.capsule.getBounds().width <= 0);
    controller.expand(false);
    assert.equal(controller.capsule.getBounds().x, -400);
    assert.equal(controller.capsule.getBounds().width, 344);
    assert.equal(controller.pillOffset, 0);
    controller.override = false;
    controller.sync();
    controller.update({ ...state, elapsed: 9 });
    assert.equal(controller.capsule.isVisible(), false, '刷新不能撤销本场手动隐藏');
    controller.update({ ...state, meetingId: 'two', title: '第二场' });
    assert.equal(controller.capsule.isVisible(), true, '新会话恢复自动规则');
    controller.override = true;
    main.minimized = false;
    main.show();
    assert.equal(controller.capsule.isVisible(), true, '手动胶囊回主窗后保留');
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
    electron.nativeImage.createFromPath = () => ({ isEmpty: () => true });
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
