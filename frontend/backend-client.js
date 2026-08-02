class AudioCapture {
  constructor(send, onLevel) {
    this.send = send;
    this.onLevel = onLevel;
    this.pendingStreams = [];
    this.sources = [];
    this.preview = null;
    this.trackSamples = new Map();
    this.paused = false;
    this.stopPromise = null;
  }

  async prepare({ mic, system }) {
    const requests = [];
    if (mic) requests.push({ track: 'mic', stream: navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } }) });
    if (system) requests.push({ track: 'system', stream: navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) });
    if (!requests.length) throw new Error('至少选择一个音频输入');
    const results = await Promise.allSettled(requests.map(({ stream }) => stream));
    const failed = results.findIndex(({ status }) => status === 'rejected');
    if (failed >= 0) {
      results.filter(({ status }) => status === 'fulfilled').forEach(({ value }) => value.getTracks().forEach((track) => track.stop()));
      const label = requests[failed].track === 'system' ? '系统音频' : '麦克风';
      throw new Error(`无法获取${label}，请检查系统权限后重试`);
    }
    this.pendingStreams = results.map(({ value }, index) => ({ track: requests[index].track, stream: value }));
    const missing = this.pendingStreams.find(({ stream }) => !stream.getAudioTracks().length);
    if (missing) {
      await this.stop();
      throw new Error(`${missing.track === 'system' ? '系统音频' : '麦克风'}没有可用的音频轨道`);
    }
  }

  async previewMic() {
    if (this.preview) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('麦克风没有可用的音频轨道');
    }
    const resource = { stream, context: new AudioContext() };
    try {
      resource.source = resource.context.createMediaStreamSource(stream);
      resource.processor = resource.context.createScriptProcessor(4096, 1, 1);
      resource.mute = resource.context.createGain();
      resource.mute.gain.value = 0;
      resource.processor.onaudioprocess = ({ inputBuffer }) => {
        const input = inputBuffer.getChannelData(0);
        const power = input.reduce((total, sample) => total + sample * sample, 0) / input.length;
        if (this.onLevel) this.onLevel('mic', Math.min(1, Math.sqrt(power) * 8));
      };
      resource.source.connect(resource.processor);
      resource.processor.connect(resource.mute);
      resource.mute.connect(resource.context.destination);
      this.preview = resource;
      await resource.context.resume();
    } catch (error) {
      if (this.preview === resource) this.preview = null;
      await this.release(resource);
      throw error;
    }
  }

  async stopPreview() {
    if (!this.preview) return;
    const resource = this.preview;
    this.preview = null;
    await this.release(resource);
  }

  async start(meetingId) {
    this.meetingId = meetingId;
    this.trackSamples.clear();
    const streams = this.pendingStreams;
    this.pendingStreams = [];
    await Promise.all(streams.map(({ track, stream }) => this.connect(track, stream)));
  }

  async connect(track, stream) {
    const resource = { stream, context: new AudioContext() };
    const { context } = resource;
    let queue = Promise.resolve();
    let ready;
    const started = new Promise((resolve, reject) => {
      ready = resolve;
      setTimeout(() => reject(new Error(`${track === 'system' ? '系统音频' : '麦克风'}未产生音频数据`)), 3000);
    });
    try {
      resource.source = context.createMediaStreamSource(stream);
      resource.processor = context.createScriptProcessor(4096, 1, 1);
      resource.processor.onaudioprocess = ({ inputBuffer }) => {
        ready();
        if (this.paused) return;
        const input = inputBuffer.getChannelData(0);
        if (track === 'mic' && this.onLevel) {
          const power = input.reduce((total, sample) => total + sample * sample, 0) / input.length;
          this.onLevel(track, Math.min(1, Math.sqrt(power) * 8));
        }
        const samples = this.resample(input, context.sampleRate);
        const sampleOffset = this.trackSamples.get(track) || 0;
        this.trackSamples.set(track, sampleOffset + samples.length);
        const pcm = new Int16Array(samples.length);
        samples.forEach((sample, index) => { pcm[index] = Math.max(-1, Math.min(1, sample)) * 0x7fff; });
        const bytes = new Uint8Array(pcm.buffer);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        const payload = {
          meeting_id: this.meetingId,
          track,
          pcm: btoa(binary),
          sample_rate: 16000,
          start_ms: Math.round(sampleOffset / 16),
        };
        queue = queue.then(() => this.send(payload)).catch((error) => console.error('Audio frame failed', error));
      };
      resource.source.connect(resource.processor);
      resource.processor.connect(context.destination);
      resource.pending = () => queue;
      this.sources.push(resource);
      await context.resume();
      await started;
    } catch (error) {
      this.sources = this.sources.filter((item) => item !== resource);
      await this.release(resource);
      throw error;
    }
  }

  async release({ stream, context, source, processor, mute }) {
    for (const node of [processor, source, mute]) {
      try { node?.disconnect(); } catch { /* It may not have connected yet. */ }
    }
    stream?.getTracks().forEach((track) => {
      try { track.stop(); } catch { /* Continue releasing the remaining resources. */ }
    });
    if (context?.state !== 'closed') {
      try { await context.close(); } catch (error) { console.error('Audio context cleanup failed', error); }
    }
  }

  resample(input, sourceRate) {
    if (sourceRate === 16000) return input;
    const output = new Float32Array(Math.round(input.length * 16000 / sourceRate));
    const ratio = sourceRate / 16000;
    for (let index = 0; index < output.length; index += 1) {
      const position = index * ratio;
      const before = Math.floor(position);
      const after = Math.min(before + 1, input.length - 1);
      output[index] = input[before] + (input[after] - input[before]) * (position - before);
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
  state: { meeting: null, selectedMeetingId: null, initialized: null },
  capture: null,
  preview: null,
  onLevel: null,
  async initialize() {
    const result = await window.brevia.initialize();
    this.state.initialized = result;
    return result;
  },
  async start(payload, inputs) {
    await this.stopPreview();
    this.capture = new AudioCapture(window.brevia.meeting.audio, this.onLevel);
    let meeting;
    try {
      await this.capture.prepare(inputs);
      meeting = await window.brevia.meeting.start(payload);
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
    return meeting;
  },
  async previewMic() {
    if (!this.preview) this.preview = new AudioCapture(null, this.onLevel);
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
    if (this.capture) this.capture.paused = paused;
    return window.brevia.meeting.pause({ meeting_id: meetingId, paused });
  },
  async stop(durationMs) {
    const meetingId = this.state.meeting?.id || this.capture?.meetingId;
    if (!meetingId) throw new Error('当前没有正在进行的会议');
    if (this.capture) await this.capture.stop();
    const meeting = await window.brevia.meeting.stop({ meeting_id: meetingId, duration_ms: durationMs });
    this.capture = null;
    this.state.meeting = null;
    return meeting;
  },
} : null;
