class AudioCapture {
  constructor(send, onLevel) {
    this.send = send;
    this.onLevel = onLevel;
    this.pendingStreams = [];
    this.sources = [];
    this.preview = null;
    this.startedAt = 0;
    this.paused = false;
  }

  async prepare({ mic, system }) {
    const requests = [];
    if (mic) requests.push({ track: 'mic', stream: navigator.mediaDevices.getUserMedia({ audio: true }) });
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('麦克风没有可用的音频轨道');
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = ({ inputBuffer }) => {
      const input = inputBuffer.getChannelData(0);
      const power = input.reduce((total, sample) => total + sample * sample, 0) / input.length;
      if (this.onLevel) this.onLevel('mic', Math.min(1, Math.sqrt(power) * 8));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.preview = { stream, context, source, processor, mute };
    await context.resume();
  }

  async stopPreview() {
    if (!this.preview) return;
    const { stream, context, source, processor, mute } = this.preview;
    this.preview = null;
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }

  async start(meetingId) {
    this.meetingId = meetingId;
    this.startedAt = performance.now();
    const streams = this.pendingStreams;
    this.pendingStreams = [];
    await Promise.all(streams.map(({ track, stream }) => this.connect(track, stream)));
  }

  connect(track, stream) {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    let queue = Promise.resolve();
    let ready;
    const started = new Promise((resolve, reject) => {
      ready = resolve;
      setTimeout(() => reject(new Error(`${track === 'system' ? '系统音频' : '麦克风'}未产生音频数据`)), 3000);
    });
    processor.onaudioprocess = ({ inputBuffer }) => {
      ready();
      if (this.paused) return;
      const input = inputBuffer.getChannelData(0);
      if (track === 'mic' && this.onLevel) {
        const power = input.reduce((total, sample) => total + sample * sample, 0) / input.length;
        this.onLevel(track, Math.min(1, Math.sqrt(power) * 8));
      }
      const samples = this.resample(input, context.sampleRate);
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
        start_ms: Math.max(0, Math.round(performance.now() - this.startedAt - samples.length / 16)),
      };
      queue = queue.then(() => this.send(payload)).catch((error) => console.error('Audio frame failed', error));
    };
    source.connect(processor);
    processor.connect(context.destination);
    this.sources.push({ stream, context, source, processor, pending: () => queue });
    context.resume();
    return started;
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
    await this.stopPreview();
    this.pendingStreams.forEach(({ stream }) => stream.getTracks().forEach((track) => track.stop()));
    this.pendingStreams = [];
    this.sources.forEach(({ stream, processor, source }) => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    });
    await Promise.all(this.sources.map(({ pending }) => pending()));
    await Promise.all(this.sources.map(({ context }) => context.close()));
    this.sources = [];
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
