// 每个 AudioContext 只需注册一次 worklet 模块。用 WeakMap 记录已加载的 context,
// 避免重复 addModule(重复调用虽无害但会产生冗余的网络/解析开销)。
const workletContexts = new WeakMap();
const stoppedMediaTracks = new WeakSet();
async function loadAudioWorklet(context) {
  if (workletContexts.get(context)) return;
  await context.audioWorklet.addModule('./audio-processor.js');
  workletContexts.set(context, true);
}

function stopMediaStream(stream) {
  const tracks = [...(stream?.getVideoTracks() || []), ...(stream?.getAudioTracks() || [])];
  for (const track of tracks) {
    if (track.readyState !== 'live' || stoppedMediaTracks.has(track)) continue;
    stoppedMediaTracks.add(track);
    try { track.stop(); } catch { /* 继续停止剩余的轨道。 */ }
  }
}

// 音频采集错误文案通过运行时 i18n 目录查询，键为中文源串。目录尚未加载或缺少键时回退到中文键。
const micMessage = (key) => {
  let locale = 'zh';
  if (typeof localStorage !== 'undefined') {
    try { locale = localStorage.getItem('brevia-language') || 'zh'; } catch { /* 回退到中文。 */ }
  }
  const labels = window.BreviaLocaleData?.catalog?.[locale]?.labels || {};
  return labels[key] || key;
};

// 将 getUserMedia DOMException 转换为可操作的消息。NotFoundError 表示操作系统未暴露
// 输入设备（在 Windows 上，通常是麦克风隐私开关关闭）；NotAllowedError 表示访问被拒绝。
function describeMicError(error) {
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return micMessage('未检测到麦克风设备，请在系统设置中开启麦克风访问权限');
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return micMessage('麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试');
  if (error?.name === 'NotReadableError') return micMessage('麦克风被其他程序占用，请关闭占用麦克风的程序后重试');
  return error?.message || micMessage('无法获取麦克风');
}

class AudioCapture {
  constructor(send, onLevel) {
    this.send = send;
    this.onLevel = onLevel;
    this.pendingStreams = [];
    this.sources = [];
    this.preview = null;
    this.paused = false;
    this.stopping = false;
    this.stopPromise = null;
    // 用户显式选择的麦克风设备 id(来自枚举);空串表示使用系统默认设备。
    // Windows 上「默认通信设备」可能被设成已拔出的耳机麦克风,导致拔掉耳机后收不到声音,
    // 因此允许用户固定选择内置麦克风,绕开有问题的系统默认。
    this.micDeviceId = '';
  }

  // 构造 getUserMedia 的音频约束,把所选设备固化为 exact deviceId。
  micConstraints() {
    const audio = { autoGainControl: true, echoCancellation: true, noiseSuppression: true };
    if (this.micDeviceId) audio.deviceId = { exact: this.micDeviceId };
    return audio;
  }

  // 尝试打开麦克风轨道。若显式选择的设备已断开(例如拔出耳机),回退到系统默认并记录 micFellBack,
  // 避免录音直接失败;调用方可通过读取 micFellBack 同步 UI。
  async openMicStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints() });
    } catch (error) {
      if (this.micDeviceId && (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError')) {
        this.micDeviceId = '';
        this.micFellBack = true;
        return navigator.mediaDevices.getUserMedia({ audio: this.micConstraints() });
      }
      throw error;
    }
  }

  async requestTrack(track) {
    let stream;
    try {
      stream = track === 'mic'
        ? await this.openMicStream()
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { systemAudio: 'include', suppressLocalAudioPlayback: false } });
    } catch (error) {
      if (track === 'mic') throw new Error(describeMicError(error));
      throw error instanceof Error ? error : new Error(micMessage('无法获取系统音频，请检查系统权限后重试'));
    }
    if (!stream.getAudioTracks().length) throw new Error(micMessage(track === 'system' ? '未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试' : '麦克风没有可用的音频轨道'));
    return stream;
  }

  async prepare({ mic, system }) {
    const requests = [];
    if (mic) requests.push({ track: 'mic', stream: this.requestTrack('mic') });
    if (system) requests.push({ track: 'system', stream: this.requestTrack('system') });
    if (!requests.length) throw new Error(micMessage('至少选择一个音频输入'));
    const results = await Promise.allSettled(requests.map(({ stream }) => stream));
    const failed = results.findIndex(({ status }) => status === 'rejected');
    if (failed >= 0) {
      results.filter(({ status }) => status === 'fulfilled').forEach(({ value }) => stopMediaStream(value));
      if (requests[failed].track === 'mic') throw new Error(describeMicError(results[failed].reason));
      if (results[failed].reason?.message === micMessage('未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试')) throw results[failed].reason;
      throw new Error(micMessage('无法获取系统音频，请检查系统权限后重试'));
    }
    this.pendingStreams = results.map(({ value }, index) => ({ track: requests[index].track, stream: value }));
    const missing = this.pendingStreams.find(({ stream }) => !stream.getAudioTracks().length);
    if (missing) {
      await this.stop();
      throw new Error(micMessage(missing.track === 'system' ? '未检测到系统音频，请在系统设置中允许屏幕与系统音频录制后重试' : '麦克风没有可用的音频轨道'));
    }
  }

  async previewMic() {
    if (this.preview) return false;
    this.micFellBack = false;
    let stream;
    try {
      stream = await this.openMicStream();
    } catch (error) {
      throw new Error(describeMicError(error));
    }
    if (!stream.getAudioTracks().length) {
      stopMediaStream(stream);
      throw new Error(micMessage('麦克风没有可用的音频轨道'));
    }
    const resource = { stream, context: new AudioContext() };
    try {
      await loadAudioWorklet(resource.context);
      resource.source = resource.context.createMediaStreamSource(stream);
      resource.processor = new AudioWorkletNode(resource.context, 'audio-capture-processor');
      // worklet 只回传电平,预览阶段无需推流。节点不写输出缓冲,因此接到 destination 也是静音。
      resource.processor.port.onmessage = ({ data }) => {
        if (this.onLevel) this.onLevel('mic', data.level);
      };
      resource.source.connect(resource.processor);
      resource.processor.connect(resource.context.destination);
      this.preview = resource;
      await resource.context.resume();
    } catch (error) {
      if (this.preview === resource) this.preview = null;
      await this.release(resource);
      throw error;
    }
    return this.micFellBack;
  }

  async stopPreview() {
    if (!this.preview) return;
    const resource = this.preview;
    this.preview = null;
    await this.release(resource);
  }

  async start(meetingId) {
    this.meetingId = meetingId;
    this.stopping = false;
    this.startedAt = performance.now();
    const streams = this.pendingStreams;
    this.pendingStreams = [];
    await Promise.all(streams.map(({ track, stream }) => this.connect(track, stream)));
  }

  async setPaused(paused) {
    this.paused = paused;
    await Promise.allSettled(this.sources.map(async ({ context }) => {
      if (paused && context.state === 'running') await context.suspend();
      if (!paused && context.state === 'suspended') await context.resume();
    }));
  }

  async connect(track, stream) {
    const resource = {
      track, stream, context: new AudioContext(), startMs: Math.round(performance.now() - this.startedAt),
      inFlight: null, flushResolve: null,
    };
    const { context } = resource;
    let sampleOffset = 0;
    let ready;
    let readyTimer;
    const started = new Promise((resolve, reject) => {
      ready = () => { clearTimeout(readyTimer); resolve(); };
      readyTimer = setTimeout(() => reject(new Error(micMessage(track === 'system' ? '系统音频未产生音频数据' : '麦克风未产生音频数据'))), 3000);
    });
    try {
      await loadAudioWorklet(context);
      resource.source = context.createMediaStreamSource(stream);
      resource.processor = new AudioWorkletNode(context, 'audio-capture-processor');
      // worklet 累积样本并回传主线程,在此处理暂停/静音逻辑并推流到后端。
      resource.processor.port.onmessage = ({ data }) => {
        if (data.flushed) {
          resource.flushResolve?.();
          resource.flushResolve = null;
          return;
        }
        ready();
        if (this.paused || this.stopping) return;
        if (track === 'mic' && this.onLevel) {
          this.onLevel(track, data.level);
        }
        const samples = this.resample(data.samples, context.sampleRate);
        const offset = sampleOffset;
        sampleOffset += samples.length;
        const pcm = new Int16Array(samples.length);
        samples.forEach((sample, index) => { pcm[index] = Math.max(-1, Math.min(1, sample)) * 0x7fff; });
        this.enqueue(resource, pcm, resource.startMs + Math.round(offset / 16));
      };
      resource.source.connect(resource.processor);
      resource.processor.connect(context.destination);
      resource.pending = () => resource.inFlight;
      this.sources.push(resource);
      await context.resume();
      await started;
    } catch (error) {
      clearTimeout(readyTimer);
      this.sources = this.sources.filter((item) => item !== resource);
      await this.release(resource);
      throw error;
    }
  }

  enqueue(resource, pcm, startMs) {
    if (!pcm.length) return;
    const send = async () => {
      const bytes = new Uint8Array(pcm.buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      try {
        await this.send({ meeting_id: this.meetingId, track: resource.track, pcm: btoa(binary), sample_rate: 16000, start_ms: startMs });
      } catch (error) { console.error('Audio frame failed', error); }
    };
    resource.inFlight = resource.inFlight ? resource.inFlight.then(send) : send();
  }

  flush(resource) {
    if (!resource.processor?.port) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resource.flushResolve = null;
        resolve();
      }, 500);
      resource.flushResolve = () => { clearTimeout(timer); resolve(); };
      resource.processor.port.postMessage({ type: 'flush' });
    });
  }

  async release({ stream, context, source, processor }) {
    if (processor?.port) {
      processor.port.onmessage = null;
      try { processor.port.close(); } catch { /* 端口可能已经关闭。 */ }
    }
    for (const node of [processor, source]) {
      try { node?.disconnect(); } catch { /* 可能尚未连接。 */ }
    }
    stopMediaStream(stream);
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch (error) { console.error('Audio context cleanup failed', error); }
    }
  }

  resample(input, sourceRate) {
    if (sourceRate === 16000) return input;
    // 用「积分窗口（box filter）」低通后再抽取，抑制降采样混叠。旧实现用线性插值，
    // 在 48k→16k 这类整数倍时会退化成「每 3 个样本取 1 个」，完全没有抗混叠，
    // 高于 8kHz 的内容折回可听频段，造成录音发闷/发毛的「爆音」。
    const ratio = sourceRate / 16000;
    const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
    for (let index = 0; index < output.length; index += 1) {
      const start = index * ratio;
      const end = Math.min(input.length, start + ratio);
      let sum = 0;
      let weight = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j += 1) {
        const span = Math.min(j + 1, end) - Math.max(j, start);
        sum += input[j] * span;
        weight += span;
      }
      output[index] = weight ? sum / weight : 0;
    }
    return output;
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = (async () => {
      const preview = this.preview;
      const pendingStreams = this.pendingStreams;
      const sources = this.sources;
      this.preview = null;
      this.pendingStreams = [];
      this.sources = [];
      await Promise.allSettled(sources.map((resource) => this.flush(resource)));
      this.stopping = true;
      await Promise.allSettled(sources.map(({ pending }) => pending()));
      await Promise.all([
        ...pendingStreams.map(({ stream }) => this.release({ stream })),
        ...[preview, ...sources].filter(Boolean).map((resource) => this.release(resource)),
      ]);
    })();
    return this.stopPromise;
  }
}

window.breviaClient = window.brevia ? {
  state: { meeting: null, selectedMeetingId: null, initialized: null, inputs: null },
  capture: null,
  preview: null,
  onLevel: null,
  micDeviceId: '',
  // 设置要使用的麦克风设备(空串表示系统默认)。同时应用到现有与后续创建的采集实例。
  setMicDevice(deviceId) {
    this.micDeviceId = deviceId || '';
    if (this.capture) this.capture.micDeviceId = this.micDeviceId;
    if (this.preview) this.preview.micDeviceId = this.micDeviceId;
  },
  // 枚举系统可用的麦克风输入设备,供录制前页的下拉选择。
  async listMicrophones() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((device) => device.kind === 'audioinput')
        .filter((device) => device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
        .map((device) => ({ deviceId: device.deviceId, label: device.label || '' }));
    } catch { return []; }
  },
  async initialize() {
    const result = await window.brevia.initialize();
    this.state.initialized = result;
    return result;
  },
  async start(payload, inputs, micDeviceId) {
    await this.stopPreview();
    this.capture = new AudioCapture(window.brevia.meeting.audio, this.onLevel);
    this.capture.micDeviceId = micDeviceId ?? this.micDeviceId;
    let meeting;
    try {
      if (inputs.system) {
        const permissions = await window.brevia.permissions.status();
        if (permissions.systemAudioSupported === false) throw new Error('当前系统不支持直接录制系统音频，请仅使用麦克风');
      }
      await this.capture.prepare(inputs);
      meeting = await window.brevia.meeting.start({ ...payload, audio_tracks: Object.keys(inputs).filter((track) => inputs[track]) });
      if (meeting?.model_required) {
        await this.capture.stop();
        this.capture = null;
        return meeting;
      }
      await this.capture.start(meeting.id);
    } catch (error) {
      await this.capture.stop();
      if (meeting) await window.brevia.meeting.stop({ meeting_id: meeting.id, duration_ms: 0 });
      this.capture = null;
      throw error;
    }
    this.state.meeting = meeting;
    this.state.selectedMeetingId = meeting.id;
    this.state.inputs = { ...inputs };
    return meeting;
  },
  async previewMic() {
    if (!this.preview) {
      this.preview = new AudioCapture(null, this.onLevel);
      this.preview.micDeviceId = this.micDeviceId;
    }
    return this.preview.previewMic();
  },
  async stopPreview() {
    if (!this.preview) return;
    const preview = this.preview;
    this.preview = null;
    await preview.stopPreview();
  },
  async pause(paused) {
    const meetingId = this.state.meeting?.id || this.capture?.meetingId;
    if (!meetingId) throw new Error('当前没有正在进行的会议');
    if (this.capture) await this.capture.setPaused(paused);
    return window.brevia.meeting.pause({ meeting_id: meetingId, paused });
  },
  async stop(durationMs) {
    const meetingId = this.state.meeting?.id || this.capture?.meetingId;
    if (!meetingId) throw new Error('当前没有正在进行的会议');
    if (this.capture) await this.capture.stop();
    const meeting = await window.brevia.meeting.stop({ meeting_id: meetingId, duration_ms: durationMs });
    this.capture = null;
    this.state.meeting = null;
    this.state.inputs = null;
    return meeting;
  },
} : null;
