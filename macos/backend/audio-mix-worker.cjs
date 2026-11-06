const { parentPort, workerData } = require('node:worker_threads');
const { safeChild } = require('./store-base.cjs');
const audio = require('./store-audio.cjs');
const state = new Int32Array(workerData.state);
function checkpoint() {
  while (Atomics.load(state, 0) === 1) Atomics.wait(state, 0, 1, 1000);
  if (Atomics.load(state, 0) === 2) throw new Error('Audio processing cancelled');
}
const store = {
  ...audio,
  settings: workerData.settings,
  audioSessions: new Map(),
  meetingDir: (id) => safeChild(workerData.meetingsDir, id, 'meeting id'),
};
try {
  checkpoint();
  if (workerData.playback)
    for (const track of ['mic', 'system']) store.buildPlayback(workerData.mid, track, checkpoint);
  store.buildMixSync(
    workerData.mid,
    (ratio) => {
      checkpoint();
      parentPort.postMessage({ progress: ratio });
    },
    checkpoint,
  );
  checkpoint();
  parentPort.postMessage({ done: true });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
