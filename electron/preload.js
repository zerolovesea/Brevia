const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload = {}) => ipcRenderer.invoke(channel, payload);
const listeners = new Map();

contextBridge.exposeInMainWorld('brevia', {
  initialize: invoke('app.initialize'),
  meeting: {
    start: invoke('meeting.start'),
    audio: invoke('meeting.audio'),
    pause: invoke('meeting.pause'),
    stop: invoke('meeting.stop'),
    list: invoke('meeting.list'),
    get: invoke('meeting.get'),
    update: invoke('meeting.update'),
    delete: invoke('meeting.delete'),
    restore: invoke('meeting.restore'),
    refine: invoke('meeting.refine'),
    export: invoke('meeting.export'),
    share: invoke('meeting.share'),
  },
  speaker: { rename: invoke('speaker.rename') },
  models: {
    list: invoke('models.list'),
    download: invoke('models.download'),
    delete: invoke('models.delete'),
  },
  terms: {
    list: invoke('terms.list'),
    save: invoke('terms.save'),
    delete: invoke('terms.delete'),
  },
  summary: { generate: invoke('summary.generate') },
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
