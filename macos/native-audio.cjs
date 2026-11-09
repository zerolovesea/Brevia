const { spawn, execFile } = require('node:child_process');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const path = require('node:path');

const run = promisify(execFile);
class NativeAudio {
  binary() {
    return (
      process.env.BREVIA_AUDIO_HELPER ||
      path.join(
        process.resourcesPath,
        'control',
        'brevia-audio' + (process.platform === 'win32' ? '.exe' : ''),
      )
    );
  }
  async query(command, ...args) {
    const probe = command === 'meeting-audio' && typeof args[0] === 'object';
    const request = run(this.binary(), probe ? [command, '--stdin'] : [command, ...args], {
      timeout: 120000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    if (probe) {
      request.child.stdin.on('error', () => {}); // execFile reports helper startup and exit errors.
      request.child.stdin.end(JSON.stringify(args[0]));
    }
    return JSON.parse((await request).stdout);
  }
  async prepare({ mic, system, deviceId, preview }, append, publish) {
    if (this.session) throw new Error('Audio capture is busy');
    const args = ['capture'];
    if (mic) args.push('--mic');
    if (system) args.push('--system');
    if (deviceId) args.push('--device', deviceId);
    if (preview) args.push('--preview');
    if (!mic && !system) throw new Error('Select an audio input');
    const proc = spawn(this.binary(), args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
    const state = { proc, append, publish, preview, meeting: null };
    this.session = state;
    const ready = this.waitFor(state, 'ready', 120000);
    const fail = (error) => {
      if (state.error) return;
      state.error = error;
      state.waiter?.reject(error);
      if (state.meeting || state.preview) publish('native-audio.error', { message: error.message });
      proc.kill();
    };
    proc.on('error', fail);
    proc.stdin.on('error', fail);
    const lines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    // 每次至多一批 PCM 等待 worker 确认；控制 ack 只在先前的帧已落盘后完成。
    const consume = async () => {
      try {
        for await (const line of lines) {
          const frame = JSON.parse(line);
          if (frame.type === 'audio') {
            if (!state.meeting || state.preview) throw new Error('Unexpected audio frame');
            await append({
              meeting_id: state.meeting,
              track: frame.track,
              pcm: frame.pcm,
              sample_rate: frame.sample_rate,
              start_ms: frame.start_ms,
            });
            // 停录需要先排空已采集的数据，有写入进展时延长等待。
            if (state.waiter?.name === 'stop') state.waiter.refresh();
          } else if (frame.type === 'level') {
            publish('native-audio.level', { track: frame.track, level: frame.level });
          } else if (frame.type === 'error') {
            throw new Error(frame.message);
          } else if (frame.type === 'ready' || frame.type === 'ack') {
            const name = frame.type === 'ready' ? 'ready' : frame.command;
            if (state.waiter?.name === name) {
              if (name === 'stop') state.stopped = true;
              state.waiter.resolve(frame);
            }
          }
        }
        if (!state.stopped) throw new Error('Audio recorder exited');
      } catch (error) {
        fail(error);
      } finally {
        if (this.session === state) this.session = null;
      }
    };
    void consume();
    return ready;
  }
  waitFor(state, name, timeout) {
    if (state.waiter) throw new Error('Audio operation is in progress');
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        clearTimeout(timer);
        state.waiter = null;
        fn(value);
      };
      const timer = setTimeout(() => {
        state.proc.kill();
        finish(reject, new Error('Audio recorder timed out: ' + name));
      }, timeout);
      state.waiter = {
        name,
        refresh: () => timer.refresh(),
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      };
    });
  }
  async command(name, meeting) {
    const state = this.session;
    if (!state) {
      if (name === 'stop') return;
      throw new Error('Audio capture is not prepared');
    }
    if (name === 'start') state.meeting = meeting;
    const ack = this.waitFor(state, name, 30000);
    state.proc.stdin.write(name + '\n');
    await ack;
    if (name === 'stop') {
      state.proc.stdin.end();
      if (this.session === state) this.session = null;
    }
  }
  dispose() {
    this.session?.proc.kill();
  }
}

module.exports = { NativeAudio };
