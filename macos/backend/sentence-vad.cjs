const path = require('node:path');
function rms(pcm) {
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const n = pcm.readInt16LE(i) / 32768;
    energy += n * n;
  }
  return pcm.length ? Math.sqrt(energy / (pcm.length / 2)) : 0;
}
function trimQuiet(pcm, startMs, endMs, level, config) {
  const minimum = config.quiet_speech_min_seconds;
  if (pcm.length < minimum * 32000) return null;
  const frames = Math.floor(pcm.length / 320),
    loud = [],
    floor = Math.max(level * config.quiet_speech_level_ratio, 0.004);
  for (let i = 0; i < frames; i++)
    if (rms(pcm.subarray(i * 320, (i + 1) * 320)) >= floor) loud.push(i);
  if (!loud.length || loud.length * 5 < frames) return null;
  const first = Math.max(0, (loud[0] - 10) * 320),
    last = Math.min(pcm.length, (loud.at(-1) + 11) * 320);
  if (last - first < minimum * 32000) return null;
  return {
    start_ms: startMs + Math.round(((endMs - startMs) * first) / pcm.length),
    end_ms: startMs + Math.round(((endMs - startMs) * last) / pcm.length),
    audio: Buffer.from(pcm.subarray(first, last)),
    boundary: 'cut',
  };
}
// 以32ms检测窗维护切点、回看与安静语音恢复；音频只保留模型窗口大小的环形历史。
class SentenceVAD {
  constructor(worker, meeting, maximum, startMs) {
    this.worker = worker;
    this.engine = worker.newEngine('sherpa-onnx');
    this.model = meeting.vad_model_id || 'silero-vad';
    const configured = worker.settings.vad[meeting.language] || worker.settings.vad.default;
    this.maximum = Math.min(maximum, configured.max_speech_duration);
    this.cap = Math.max(0.1, this.maximum - 0.4 - 0.032);
    this.params = { ...configured, min_silence_duration: 0.1, max_speech_duration: this.cap };
    this.gap = Math.max(
      Math.round(configured.min_silence_duration * 1000),
      meeting.language === 'auto' ? 2000 : 0,
    );
    this.recovery = worker.settings.live_asr;
    this.origin = startMs;
    this.samples = 0;
    this.delivered = Math.round(startMs * 16);
    this.hist = [];
    this.histFrom = this.delivered;
    this.histTotal = 0;
    this.bound = Math.round((this.cap + 2.5) * 16000) + 6400;
    this.pending = null;
    this.speechStart = null;
    this.seen = false;
    this.level = 0;
    this.idle = [];
    this.idleTotal = 0;
    this.idleAfterSpeech = false;
  }
  async load() {
    await this.engine.request('vad.load', {
      path: path.join(
        this.worker.models.path(this.model),
        this.worker.models.get(this.model).files[0],
      ),
      ...this.params,
    });
    return this;
  }
  remember(pcm) {
    this.hist.push(pcm);
    this.histTotal += pcm.length / 2;
    while (this.histTotal > this.bound) {
      const overflow = this.histTotal - this.bound,
        head = this.hist[0];
      if (head.length / 2 > overflow) {
        this.hist[0] = head.subarray(overflow * 2);
        this.histFrom += overflow;
        this.histTotal -= overflow;
        break;
      }
      this.hist.shift();
      this.histFrom += head.length / 2;
      this.histTotal -= head.length / 2;
    }
  }
  history(start, end) {
    start = Math.max(start, this.histFrom);
    end = Math.min(end, this.histFrom + this.histTotal);
    if (end <= start) return Buffer.alloc(0);
    const parts = [];
    let at = this.histFrom;
    for (const block of this.hist) {
      const next = at + block.length / 2;
      if (next > start && at < end)
        parts.push(
          block.subarray(Math.max(0, start - at) * 2, Math.min(block.length / 2, end - at) * 2),
        );
      at = next;
      if (at >= end) break;
    }
    return Buffer.concat(parts);
  }
  drain(parts) {
    const segments = [];
    for (const part of parts) {
      const raw = Buffer.from(part.pcm, 'base64'),
        begin = Math.round(part.start_ms * 16),
        start = Math.max(0, begin, this.delivered - Math.round(this.origin * 16)),
        end = Math.min(Math.round(part.end_ms * 16), this.samples),
        body = raw.subarray((start - begin) * 2, (end - begin) * 2);
      if (!body.length) continue;
      const absolute = Math.round(this.origin * 16) + start,
        lo = Math.max(absolute - 6400, this.histFrom, this.delivered),
        prefix = this.history(lo, absolute);
      segments.push({
        start_ms: Math.round((absolute - prefix.length / 2) / 16),
        end_ms: Math.round(this.origin + end / 16),
        audio: Buffer.concat([prefix, body]),
      });
      this.delivered = Math.round(this.origin * 16) + end;
    }
    return segments;
  }
  collect(parts, boundary = 'cut') {
    const completed = [];
    for (let segment of parts) {
      if (this.pending) {
        const gap = segment.start_ms - this.pending.end_ms;
        if (gap < this.gap && segment.end_ms - this.pending.start_ms <= this.maximum * 1000) {
          segment = {
            start_ms: this.pending.start_ms,
            end_ms: segment.end_ms,
            audio: Buffer.concat([
              this.pending.audio,
              Buffer.alloc(Math.max(0, Math.round(gap * 16)) * 2),
              segment.audio,
            ]),
          };
        } else completed.push({ ...this.pending, boundary: 'endpoint' });
      }
      this.pending = segment;
      if (segment.end_ms - segment.start_ms >= 8000) {
        completed.push({ ...segment, boundary });
        this.pending = null;
      }
    }
    return completed;
  }
  atQuietBoundary() {
    if (this.histTotal < 32000) return false;
    const data = this.history(
        this.histFrom + this.histTotal - 32000,
        this.histFrom + this.histTotal,
      ),
      energy = [];
    for (let at = 0; at < data.length; at += 640)
      energy.push(rms(data.subarray(at, at + 640)) ** 2);
    const sorted = energy.slice(0, -4).sort((a, b) => a - b),
      position = (sorted.length - 1) * 0.75,
      lo = Math.floor(position),
      level = sorted[lo] + (sorted[Math.ceil(position)] - sorted[lo]) * (position - lo);
    return level > 1e-7 && Math.max(...energy.slice(-4)) < level * 0.16;
  }
  trackQuiet(chunk, inSpeech, completed) {
    if (!this.recovery.quiet_speech_recovery) return;
    if (inSpeech) {
      this.seen = true;
      this.level = 0.999 * this.level + 0.001 * rms(chunk);
      const idle = this.idle,
        total = this.idleTotal;
      this.idle = [];
      this.idleTotal = 0;
      if (!idle.length || !this.idleAfterSpeech) return;
      let audio = Buffer.concat(idle);
      const end = Math.round(this.origin + (this.samples - chunk.length / 2) / 16),
        start = end - Math.round(total / 16);
      let keep = end;
      if (this.speechStart !== null) {
        const onset = Math.round(this.origin + this.speechStart / 16) - 300;
        if (onset <= start) return;
        keep = onset;
        audio = audio.subarray(0, Math.round((keep - start) * 16) * 2);
      }
      const trimmed = trimQuiet(audio, start, keep, this.level, this.recovery);
      if (trimmed) completed.push(trimmed);
      return;
    }
    if (!this.idle.length) this.idleAfterSpeech = this.seen;
    this.idle.push(chunk);
    this.idleTotal += chunk.length / 2;
    const bound = Math.round(this.recovery.quiet_speech_max_seconds * 16000);
    while (this.idleTotal > bound && this.idle.length) {
      const over = this.idleTotal - bound,
        head = this.idle[0];
      if (head.length / 2 > over) {
        this.idle[0] = head.subarray(over * 2);
        this.idleTotal -= over;
        break;
      }
      this.idle.shift();
      this.idleTotal -= head.length / 2;
    }
  }
  encoded(parts) {
    return parts.map(({ audio, ...part }) => ({ ...part, pcm: audio.toString('base64') }));
  }
  preview() {
    const start =
      this.pending?.start_ms ??
      (this.speechStart === null ? null : this.origin + this.speechStart / 16);
    if (start === null || this.origin + this.samples / 16 - start < 2000) return null;
    const end = Math.min(this.origin + this.samples / 16, start + 3000),
      audio = this.history(Math.round(start * 16), Math.round(end * 16));
    if (audio.length < 64000) return null;
    return { start_ms: end - audio.length / 32, end_ms: end, pcm: audio.toString('base64') };
  }
  async accept(pcm, startMs) {
    const completed = [];
    if (Math.abs(startMs - (this.origin + this.samples / 16)) > 2) {
      completed.push(...(await this.flush()));
      this.close();
      throw new Error('VAD input timeline is discontinuous');
    }
    for (let at = 0; at < pcm.length; at += 1024) {
      const chunk = Buffer.from(pcm.subarray(at, at + 1024));
      this.samples += chunk.length / 2;
      this.remember(chunk);
      const result = await this.engine.request('vad.feed', {
        pcm: chunk.toString('base64'),
        sample_rate: 16000,
        with_state: true,
      });
      const segments = this.drain(result.segments);
      completed.push(...this.encoded(this.collect(segments)));
      if (segments.length || !result.speech_detected) this.speechStart = null;
      if (result.speech_detected && this.speechStart === null)
        this.speechStart = Math.max(0, result.current_segment_start);
      if (this.speechStart !== null) {
        const start = this.pending?.start_ms ?? this.origin + this.speechStart / 16,
          elapsed = (this.origin + this.samples / 16 - start) / 1000,
          hard = elapsed >= this.cap,
          quiet = elapsed >= 8 && this.atQuietBoundary();
        if (hard || quiet) {
          const boundary = hard ? 'cut' : 'pause',
            flushed = await this.engine.request('vad.flush', { with_state: true });
          completed.push(...this.encoded(this.collect(this.drain(flushed.segments), boundary)));
          if (this.pending) {
            completed.push(...this.encoded([{ ...this.pending, boundary }]));
            this.pending = null;
          }
          await this.engine.request('vad.reset', {});
          this.origin += this.samples / 16;
          this.samples = 0;
          this.delivered = Math.round(this.origin * 16) - 6400;
          this.idle = [];
          this.idleTotal = 0;
          this.speechStart = null;
        }
      }
      if (
        this.pending &&
        !result.speech_detected &&
        this.origin + this.samples / 16 - this.pending.end_ms >= this.gap
      ) {
        completed.push(...this.encoded([{ ...this.pending, boundary: 'endpoint' }]));
        this.pending = null;
      }
      const recovered = [];
      this.trackQuiet(chunk, segments.length > 0 || result.speech_detected, recovered);
      completed.push(...this.encoded(recovered));
    }
    return completed;
  }
  async flush() {
    const result = await this.engine.request('vad.flush', { with_state: true }),
      completed = this.collect(this.drain(result.segments), 'endpoint');
    if (this.pending) {
      completed.push({ ...this.pending, boundary: 'endpoint' });
      this.pending = null;
    }
    return this.encoded(completed);
  }
  close() {
    this.engine.close();
  }
}
module.exports = { SentenceVAD, trimQuiet };
