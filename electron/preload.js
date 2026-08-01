const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload = {}) => ipcRenderer.invoke(channel, payload);
const listeners = new Map();

contextBridge.exposeInMainWorld('brevia', {
  initialize: invoke('app.initialize'),
  permissions: { status: invoke('permissions.status'), requestMicrophone: invoke('permissions.request-microphone') },
  meeting: {
    start: invoke('meeting.start'),
    import: invoke('meeting.import'),
    audio: invoke('meeting.audio'),
    pause: invoke('meeting.pause'),
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
  speaker: { rename: invoke('speaker.rename') },
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
    delete: invoke('models.delete'),
  },
  summary: { generate: invoke('summary.generate'), config: { get: invoke('summary.config.get'), save: invoke('summary.config.save') } },
  translation: { generate: invoke('translation.generate') },
  secret: { set: invoke('secret.set') },
  showItem: invoke('shell.showItem'),
  audioUrl: invoke('audio.url'),
  on(type, handler) {
    const listener = (_, event) => {
      if (event.type === type) handler(event.payload);
    };
    listeners.set(handler, listener);
    ipcRenderer.on('brevia:event', listener);
    return () => {
      ipcRenderer.removeListener('brevia:event', listener);
      listeners.delete(handler);
    };
  },
});
