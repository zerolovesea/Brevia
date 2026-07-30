class AudioCapture {
  constructor(send) {
    this.send = send;
    this.sources = [];
    this.startedAt = 0;
    this.paused = false;
  }

  async start(meetingId, { mic, system }) {
    this.meetingId = meetingId;
    this.startedAt = performance.now();
    const requests = [];
    if (mic) requests.push(navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => this.connect('mic', stream)));
    if (system) requests.push(navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then((stream) => this.connect('system', stream)));
    if (!requests.length) throw new Error('至少选择一个音频输入');
    await Promise.all(requests);
  }

  async connect(track, stream) {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    let queue = Promise.resolve();
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (this.paused) return;
      const samples = this.resample(inputBuffer.getChannelData(0), context.sampleRate);
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
  async initialize() {
    const result = await window.brevia.initialize();
    this.state.initialized = result;
    return result;
  },
  async start(payload, inputs) {
    const meeting = await window.brevia.meeting.start(payload);
    this.capture = new AudioCapture(window.brevia.meeting.audio);
    try {
      await this.capture.start(meeting.id, inputs);
    } catch (error) {
      await window.brevia.meeting.stop({ meeting_id: meeting.id, duration_ms: 0 });
      throw error;
    }
    this.state.meeting = meeting;
    this.state.selectedMeetingId = meeting.id;
    return meeting;
  },
  async pause(paused) {
    this.capture.paused = paused;
    return window.brevia.meeting.pause({ meeting_id: this.state.meeting.id, paused });
  },
  async stop(durationMs) {
    await this.capture.stop();
    const meeting = await window.brevia.meeting.stop({ meeting_id: this.state.meeting.id, duration_ms: durationMs });
    this.state.meeting = null;
    return meeting;
  },
} : null;

