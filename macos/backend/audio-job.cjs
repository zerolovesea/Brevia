const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
// 文件与FFT工作在独立线程运行；主线程继续接收录音帧以及暂停/取消命令。
function audioJob(store, mid, { playback = false, progress, signal, control } = {}) {
  signal?.throwIfAborted();
  store.audioJobs ||= new Set();
  if (store.audioJobs.has(mid)) throw new Error('Audio processing is already running');
  const temporary = ['mic', 'system', 'mix'].map((track) =>
    store.checkedAudioPath(mid, 'playback-' + track + '.wav.tmp'),
  );
  store.audioJobs.add(mid);
  const shared = new SharedArrayBuffer(4),
    state = new Int32Array(shared);
  Atomics.store(state, 0, control?.paused ? 1 : 0);
  const entry = process.env.BREVIA_RESOURCES
    ? path.join(process.env.BREVIA_RESOURCES, 'control/audio-mix-worker.cjs')
    : path.join(__dirname, 'audio-mix-worker.cjs');
  return new Promise((resolve, reject) => {
    let failure = null,
      complete = false,
      thread;
    const stop = (error) => {
      failure ||= error;
      Atomics.store(state, 0, 2);
      Atomics.notify(state, 0);
      // 终止会关闭线程拥有的文件描述符，exit之后才删除临时文件。
      thread?.terminate().catch(() => {});
    };
    const cancel = () => stop(signal.reason || new Error('Audio processing cancelled'));
    try {
      thread = new Worker(entry, {
        workerData: {
          state: shared,
          mid,
          meetingsDir: store.meetingsDir,
          settings: store.settings,
          playback,
        },
      });
    } catch (error) {
      store.audioJobs.delete(mid);
      reject(error);
      return;
    }
    const interval = setInterval(() => {
      if (failure) return;
      Atomics.store(state, 0, control?.paused ? 1 : 0);
      Atomics.notify(state, 0);
    }, 50);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    thread.on('message', (message) => {
      if (message.error) failure ||= new Error(message.error);
      if (message.done) complete = true;
      if (message.progress !== undefined)
        try {
          progress?.(message.progress);
        } catch (error) {
          stop(error);
        }
    });
    thread.on('error', (error) => {
      failure ||= error;
    });
    thread.on('exit', (code) => {
      clearInterval(interval);
      signal?.removeEventListener('abort', cancel);
      store.audioJobs.delete(mid);
      if (failure || !complete || code !== 0) {
        for (const file of temporary)
          try {
            fs.rmSync(file, { force: true });
          } catch {}
        reject(failure || new Error('Audio processing exited before completion (' + code + ')'));
      } else resolve();
    });
  });
}
module.exports = { audioJob };
