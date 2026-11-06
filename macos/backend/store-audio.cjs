const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite, resolveExisting } = require('./store-base.cjs');
function wavInfo(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(12);
    if (
      fs.readSync(fd, header, 0, 12, 0) !== 12 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    )
      throw new Error('Invalid WAV');
    let offset = 12,
      format;
    const size = fs.fstatSync(fd).size;
    while (offset + 8 <= size) {
      const chunk = Buffer.alloc(8);
      fs.readSync(fd, chunk, 0, 8, offset);
      const length = chunk.readUInt32LE(4),
        kind = chunk.toString('ascii', 0, 4);
      if (kind === 'fmt ') {
        if (length < 16 || offset + 8 + length > size) throw new Error('Invalid WAV format chunk');
        const data = Buffer.alloc(Math.min(length, 40));
        if (fs.readSync(fd, data, 0, data.length, offset + 8) !== data.length)
          throw new Error('Truncated WAV format chunk');
        const tag = data.readUInt16LE(0);
        // afconvert 会把 PCM16 写成扩展 WAVE；只接受明确声明的整数 PCM 子类型。
        if (tag === 0xfffe) {
          if (
            length < 40 ||
            data.readUInt16LE(16) < 22 ||
            18 + data.readUInt16LE(16) > length ||
            data.readUInt16LE(18) !== 16 ||
            !data.subarray(24, 40).equals(Buffer.from('0100000000001000800000aa00389b71', 'hex'))
          )
            throw new Error('Expected extensible PCM16 WAV');
        } else if (tag !== 1) throw new Error('Expected PCM WAV');
        format = {
          channels: data.readUInt16LE(2),
          sampleRate: data.readUInt32LE(4),
          bits: data.readUInt16LE(14),
        };
        if (
          !format.channels ||
          !format.sampleRate ||
          format.bits !== 16 ||
          data.readUInt16LE(12) !== format.channels * 2 ||
          data.readUInt32LE(8) !== format.sampleRate * format.channels * 2
        )
          throw new Error('Expected PCM16 WAV');
      }
      if (kind === 'data') {
        if (!format || format.bits !== 16) throw new Error('Expected PCM16 WAV');
        return {
          ...format,
          offset: offset + 8,
          bytes: Math.min(length, size - offset - 8),
          frames: Math.floor(Math.min(length, size - offset - 8) / (format.channels * 2)),
        };
      }
      offset += 8 + length + (length % 2);
    }
    throw new Error('Missing WAV data');
  } finally {
    fs.closeSync(fd);
  }
}
function wavHeader(bytes, rate = 16000, channels = 1) {
  if (bytes > 0xffffffff - 36) throw new Error('WAV exceeds RIFF capacity');
  const b = Buffer.alloc(44);
  b.write('RIFF');
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
function streamCopyWav(sources, destination, checkpoint = () => {}) {
  const first = wavInfo(sources[0]),
    temporary = destination + '.tmp';
  let bytes = 0;
  const out = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeSync(out, wavHeader(0, first.sampleRate, first.channels));
    const buffer = Buffer.alloc(1024 * 1024);
    for (const source of sources) {
      const info = wavInfo(source);
      if (info.sampleRate !== first.sampleRate || info.channels !== first.channels)
        throw new Error('Audio chunk format changed during recording');
      const input = fs.openSync(source, 'r');
      try {
        let at = 0;
        while (at < info.bytes) {
          checkpoint();
          const n = fs.readSync(
            input,
            buffer,
            0,
            Math.min(buffer.length, info.bytes - at),
            info.offset + at,
          );
          if (!n) throw new Error('Truncated audio');
          fs.writeSync(out, buffer, 0, n);
          bytes += n;
          at += n;
        }
      } finally {
        fs.closeSync(input);
      }
    }
    fs.writeSync(out, wavHeader(bytes, first.sampleRate, first.channels), 0, 44, 0);
    fs.fsyncSync(out);
  } catch (e) {
    fs.rmSync(temporary, { force: true });
    throw e;
  } finally {
    fs.closeSync(out);
  }
  fs.renameSync(temporary, destination);
}
const methods = {
  appendAudio(mid, track, encoded, sampleRate = this.settings.audio.sample_rate, startMs = 0) {
    if (!['mic', 'system'].includes(track)) throw new Error('Invalid audio track');
    if (
      typeof encoded === 'string' &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    )
      throw new Error('Invalid PCM encoding');
    const pcm = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded, 'base64');
    if (pcm.length % 2) throw new Error('PCM16 audio has an invalid byte length');
    let session = this.audioSessions.get(mid);
    if (!session) {
      const manifest = this.readManifest(mid);
      manifest.tracks ||= {};
      for (const state of Object.values(manifest.tracks))
        state.samples = (state.chunks || []).reduce(
          (n, name) => n + this.wavSamples(this.checkedAudioPath(mid, name)),
          0,
        );
      session = { manifest, writers: new Map(), checkpoint: -Infinity };
      this.audioSessions.set(mid, session);
    }
    const state = (session.manifest.tracks[track] ||= {
      sample_rate: sampleRate,
      samples: 0,
      chunks: [],
    });
    if (state.sample_rate !== sampleRate) throw new Error('Sample rate changed during recording');
    const chunkSamples = sampleRate * this.settings.audio.chunk_seconds;
    const append = (data) => {
      let at = 0;
      while (at < data.length) {
        const index = Math.floor(state.samples / chunkSamples),
          take = Math.min((chunkSamples - (state.samples % chunkSamples)) * 2, data.length - at),
          name = track + '-' + String(index).padStart(5, '0') + '.wav',
          file = this.checkedAudioPath(mid, name);
        let fd = session.writers.get(name);
        if (fd === undefined) {
          if (!fs.existsSync(file))
            fs.writeFileSync(file, wavHeader(0, sampleRate), { flag: 'wx' });
          fd = fs.openSync(file, 'r+');
          session.writers.set(name, fd);
        }
        const size = fs.fstatSync(fd).size;
        fs.writeSync(fd, data, at, take, size);
        fs.writeSync(fd, wavHeader(size + take - 44, sampleRate), 0, 44, 0);
        if (!state.chunks.includes(name)) {
          state.chunks.push(name);
          session.checkpoint = -Infinity;
        }
        state.samples += take / 2;
        at += take;
        if (state.samples % chunkSamples === 0) {
          fs.closeSync(fd);
          session.writers.delete(name);
        }
      }
    };
    const target = Math.round((Math.max(0, startMs) * sampleRate) / 1000);
    while (state.samples < target)
      append(Buffer.alloc(Math.min(target - state.samples, chunkSamples) * 2));
    append(pcm);
    this.flushAudio(mid);
    return state.samples;
  },
  checkedAudioPath(mid, name) {
    if (path.basename(name) !== name) throw new Error('Invalid audio path');
    const dir = path.join(this.meetingDir(mid), 'audio'),
      file = path.join(dir, name);
    if (
      path.dirname(resolveExisting(dir)) !== resolveExisting(this.meetingDir(mid)) ||
      path.dirname(resolveExisting(file)) !== resolveExisting(dir)
    )
      throw new Error('Invalid audio path');
    return file;
  },
  wavSamples(file) {
    try {
      return wavInfo(file).frames;
    } catch {
      return 0;
    }
  },
  flushAudio(mid, force = false, close = false) {
    const session = this.audioSessions.get(mid);
    if (!session) return;
    const now = performance.now();
    if (force) for (const fd of session.writers.values()) fs.fsyncSync(fd);
    if (force || now - session.checkpoint >= 1000) {
      this.writeManifest(mid, session.manifest);
      session.checkpoint = now;
    }
    if (close) {
      for (const fd of session.writers.values()) {
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      }
      this.audioSessions.delete(mid);
    }
  },
  closeAudioSessions() {
    for (const mid of this.audioSessions.keys()) this.flushAudio(mid, true, true);
  },
  audioFiles(mid) {
    const audio = path.join(this.meetingDir(mid), 'audio');
    const files = fs.existsSync(audio) ? fs.readdirSync(audio).sort() : [];
    return {
      mic: files.filter((s) => /^mic-.*\.wav$/.test(s)).map((s) => this.checkedAudioPath(mid, s)),
      system: files
        .filter((s) => /^system-.*\.wav$/.test(s))
        .map((s) => this.checkedAudioPath(mid, s)),
      playback: Object.fromEntries(
        ['mic', 'system', 'mix'].map((track) => [
          track,
          files.includes('playback-' + track + '.wav')
            ? this.checkedAudioPath(mid, 'playback-' + track + '.wav')
            : null,
        ]),
      ),
    };
  },
  recordedDurationMs(mid) {
    const tracks = this.audioFiles(mid);
    return Math.max(
      ...['mic', 'system'].map((track) =>
        tracks[track].reduce((n, file) => {
          try {
            const info = wavInfo(file);
            return n + Math.round((info.frames * 1000) / info.sampleRate);
          } catch {
            return n;
          }
        }, 0),
      ),
    );
  },
  buildPlayback(mid, track, checkpoint) {
    const sources = this.audioFiles(mid)[track];
    if (sources.length)
      streamCopyWav(sources, this.checkedAudioPath(mid, 'playback-' + track + '.wav'), checkpoint);
  },
  readManifest(mid) {
    const session = this.audioSessions.get(mid);
    if (session) return structuredClone(session.manifest);
    const file = path.join(this.meetingDir(mid), 'manifest.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  },
  writeManifest(mid, value) {
    atomicWrite(path.join(this.meetingDir(mid), 'manifest.json'), JSON.stringify(value, null, 2));
  },
  recoverableMeetings() {
    const result = [];
    for (const name of fs.readdirSync(this.meetingsDir)) {
      try {
        const value = this.readManifest(name);
        if (Object.keys(value).length && !value.closed) result.push(value);
      } catch {}
    }
    return result;
  },
};
module.exports = { ...methods, wavInfo, wavHeader, streamCopyWav };
module.exports.buildMixSync = function (mid, progress, checkpoint = () => {}) {
  const playback = this.audioFiles(mid).playback;
  if (!playback.mic || !playback.system) return;
  const { AlignedAudioMixer, pcmFloats, floatPCM } = require('./audio-mixer.cjs');
  const sources = ['mic', 'system'].map((track) => ({
    track,
    file: playback[track],
    info: wavInfo(playback[track]),
  }));
  if (
    sources.some((s) => s.info.channels !== 1 || s.info.sampleRate !== sources[0].info.sampleRate)
  )
    throw new Error('Expected matching mono PCM16 tracks');
  const target = this.checkedAudioPath(mid, 'playback-mix.wav');
  try {
    const info = wavInfo(target);
    if (
      fs.statSync(target).mtimeMs >= Math.max(...sources.map((s) => fs.statSync(s.file).mtimeMs)) &&
      info.frames === Math.max(...sources.map((s) => s.info.frames)) &&
      info.sampleRate === sources[0].info.sampleRate
    )
      return;
  } catch {}
  const temp = target + '.tmp',
    output = fs.openSync(temp, 'w', 0o600),
    rate = sources[0].info.sampleRate;
  const mixer = new AlignedAudioMixer(rate, this.settings.live_asr.mix_max_delay_ms);
  let samplesWritten = 0;
  const write = (frames) => {
    for (const frame of frames) {
      const targetFrame = Math.round((frame.start_ms * rate) / 1000);
      if (targetFrame > samplesWritten) {
        fs.writeSync(output, Buffer.alloc((targetFrame - samplesWritten) * 2));
        samplesWritten = targetFrame;
      }
      const bytes = floatPCM(frame.samples);
      fs.writeSync(output, bytes);
      samplesWritten += frame.samples.length;
    }
  };
  try {
    fs.writeSync(output, wavHeader(0, rate));
    for (const source of sources) source.fd = fs.openSync(source.file, 'r');
    const buffer = Buffer.alloc(rate * 2);
    const max = Math.max(...sources.map((s) => s.info.bytes));
    for (let offset = 0; offset < max; offset += buffer.length) {
      checkpoint();
      for (const source of sources) {
        const n = fs.readSync(
          source.fd,
          buffer,
          0,
          Math.max(0, Math.min(buffer.length, source.info.bytes - offset)),
          source.info.offset + offset,
        );
        if (n)
          write(
            mixer.accept(
              source.track,
              pcmFloats(buffer.subarray(0, n)),
              ((offset / 2) * 1000) / rate,
            ),
          );
      }
      progress?.(Math.min(1, (offset + buffer.length) / max));
    }
    write(mixer.flush());
    fs.writeSync(output, wavHeader(samplesWritten * 2, rate), 0, 44, 0);
    fs.fsyncSync(output);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  } finally {
    fs.closeSync(output);
    for (const source of sources) if (source.fd !== undefined) fs.closeSync(source.fd);
  }
  fs.renameSync(temp, target);
};

module.exports.buildMix = function (mid, progress, options = {}) {
  return require('./audio-job.cjs').audioJob(this, mid, { ...options, progress });
};
module.exports.buildAudio = function (mid, options = {}) {
  return require('./audio-job.cjs').audioJob(this, mid, { ...options, playback: true });
};
