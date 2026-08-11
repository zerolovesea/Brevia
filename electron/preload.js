const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload = {}) => ipcRenderer.invoke(channel, payload);

// 单一共享分发器：一个 ipcRenderer 监听器将事件分发到每种类型的处理器集合
// 这避免了每次 window.brevia.on() 调用时累积新的 'brevia:event' 监听器
// （这会在重新渲染时触发 MaxListenersExceededWarning）
const handlersByType = new Map();
ipcRenderer.on('brevia:event', (_, event) => {
  const handlers = handlersByType.get(event.type);
  if (!handlers) return;
  for (const handler of [...handlers]) handler(event.payload);
});

contextBridge.exposeInMainWorld('brevia', {
  platform: process.platform,
  initialize: invoke('app.initialize'),
  maintain: invoke('app.maintain'),
  appInfo: { version: invoke('app.version') },
  update: { check: invoke('update.check'), install: invoke('update.install') },
  permissions: { status: invoke('permissions.status'), requestMicrophone: invoke('permissions.request-microphone'), openMicrophoneSettings: invoke('permissions.open-microphone-settings'), openScreenSettings: invoke('permissions.open-screen-settings') },
  meeting: {
    start: invoke('meeting.start'),
    import: invoke('meeting.import'),
    audio: invoke('meeting.audio'),
    pause: invoke('meeting.pause'),
    reconfigure: invoke('meeting.reconfigure'),
    stop: invoke('meeting.stop'),
    list: invoke('meeting.list'),
    get: invoke('meeting.get'),
    update: invoke('meeting.update'),
    delete: invoke('meeting.delete'),
    restore: invoke('meeting.restore'),
    purge: invoke('meeting.purge'),
    refine: invoke('meeting.refine'),
    separate: invoke('meeting.separate'),
    export: invoke('meeting.export'),
    exportMany: invoke('meeting.export-many'),
    share: invoke('meeting.share'),
  },
  share: {
    copyText: invoke('share.copy-text'),
    openExternal: invoke('share.open-external'),
    file: invoke('share.file'),
    system: invoke('share.system'),
  },
  speaker: { rename: invoke('speaker.rename') },
  workspace: {
    list: invoke('workspace.list'),
    get: invoke('workspace.get'),
    create: invoke('workspace.create'),
    update: invoke('workspace.update'),
    delete: invoke('workspace.delete'),
    assign: invoke('workspace.assign'),
  },
  speakerProfile: {
    list: invoke('speaker-profile.list'),
    samples: invoke('speaker-profile.samples'),
    enroll: invoke('speaker-profile.enroll'),
    verify: invoke('speaker-profile.verify'),
    deleteSample: invoke('speaker-profile.sample-delete'),
    delete: invoke('speaker-profile.delete'),
    rename: invoke('speaker-profile.rename'),
  },
  storage: { clear: invoke('storage.clear'), open: invoke('storage.open') },
  advancedSettings: { get: invoke('settings.advanced.get'), save: invoke('settings.advanced.save') },
  metrics: { record: invoke('metrics.record') },
  segment: { speaker: invoke('segment.speaker'), addProfileSample: invoke('segment.speaker-profile-sample') },
  tts: { synthesize: invoke('tts.synthesize') },
  models: {
    list: invoke('models.list'),
    download: invoke('models.download'),
    pause: invoke('models.pause'),
    cancel: invoke('models.cancel'),
    delete: invoke('models.delete'),
  },
  task: { pause: invoke('task.pause'), resume: invoke('task.resume') },
  summary: { generate: invoke('summary.generate'), config: { get: invoke('summary.config.get'), save: invoke('summary.config.save') } },
  translation: { generate: invoke('translation.generate') },
  secret: { set: invoke('secret.set') },
  showItem: invoke('shell.showItem'),
  audioUrl: invoke('audio.url'),
  floatingCaption: {
    show: invoke('floating-caption.show'),
    close: invoke('floating-caption.close'),
    update: invoke('floating-caption.update'),
    move: invoke('floating-caption.move'),
    setAlwaysOnTop: invoke('floating-caption.set-always-on-top'),
  },
  closeFloatingCaption: invoke('floating-caption.close'),
  setFloatingCaptionAlwaysOnTop: invoke('floating-caption.set-always-on-top'),
  onFloatingCaptionUpdate(handler) {
    const listener = (_, data) => handler(data);
    ipcRenderer.on('floating-caption:update', listener);
    return () => ipcRenderer.removeListener('floating-caption:update', listener);
  },
  on(type, handler) {
    let handlers = handlersByType.get(type);
    if (!handlers) {
      handlers = new Set();
      handlersByType.set(type, handlers);
    }
    handlers.add(handler);
    return () => {
      const set = handlersByType.get(type);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) handlersByType.delete(type);
    };
  },
});
