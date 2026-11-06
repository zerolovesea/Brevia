// 双轨保留各自时间轴，使用相关声学路径抵消后只向识别器交付混音。
function fft(real, imaginary, inverse = false) {
  const length = real.length;
  for (let i = 1, j = 0; i < length; i++) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let size = 2; size <= length; size *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < length; i += size) {
      let ur = 1,
        ui = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = i + k,
          b = a + size / 2;
        const vr = real[b] * ur - imaginary[b] * ui,
          vi = real[b] * ui + imaginary[b] * ur;
        real[b] = real[a] - vr;
        imaginary[b] = imaginary[a] - vi;
        real[a] += vr;
        imaginary[a] += vi;
        const next = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < length; i++) {
      real[i] /= length;
      imaginary[i] /= length;
    }
}
function pcmFloats(bytes) {
  const result = new Float32Array(bytes.length / 2);
  for (let i = 0; i < result.length; i++) result[i] = bytes.readInt16LE(i * 2) / 32768;
  return result;
}
function floatPCM(values) {
  const bytes = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++)
    bytes.writeInt16LE(Math.trunc(Math.max(-1, Math.min(1, values[i])) * 32767), i * 2);
  return bytes;
}
class AlignedAudioMixer {
  constructor(rate = 16000, maxDelayMs = 1500) {
    this.rate = rate;
    this.limit = Math.round((maxDelayMs * rate) / 1000);
    this.lookahead = Math.min(this.limit, rate / 2);
    this.window = Math.floor(rate * 1.5);
    this.buffers = { mic: new Float32Array(), system: new Float32Array() };
    this.starts = { mic: 0, system: 0 };
    this.ends = { mic: null, system: null };
    this.lastSeen = { mic: performance.now(), system: performance.now() };
    this.cursor = null;
    this.emitted = false;
    this.paths = [];
  }
  accept(track, values, startMs) {
    if (!values.length) return [];
    const start = Math.round((startMs * this.rate) / 1000);
    let end = this.ends[track];
    if (end === null) {
      this.starts[track] = start;
      end = start;
    }
    const gap = start - end;
    if (gap > this.rate * 5) {
      const output = this.flush();
      Object.assign(this, new AlignedAudioMixer(this.rate, (this.limit * 1000) / this.rate));
      return output.concat(this.accept(track, values, startMs));
    }
    if (gap > this.rate / 1000) {
      const padded = new Float32Array(values.length + gap);
      padded.set(values, gap);
      values = padded;
    } else if (gap < -this.rate / 1000) values = values.subarray(Math.min(values.length, -gap));
    const buffer = new Float32Array(this.buffers[track].length + values.length);
    buffer.set(this.buffers[track]);
    buffer.set(values, this.buffers[track].length);
    this.buffers[track] = buffer;
    this.ends[track] = end + values.length;
    this.lastSeen[track] = performance.now();
    if (this.cursor === null) this.cursor = start;
    else if (!this.emitted) this.cursor = Math.min(this.cursor, start);
    return this.drain();
  }
  read(track, start, count) {
    const result = new Float32Array(count),
      offset = start - this.starts[track];
    const lo = Math.max(0, -offset),
      hi = Math.min(count, this.buffers[track].length - offset);
    if (hi > lo) result.set(this.buffers[track].subarray(offset + lo, offset + hi), lo);
    return result;
  }
  cancelEcho(mic, start) {
    const count = mic.length,
      residual = mic.slice();
    if (count < this.rate / 10) {
      for (const [delay, gain] of this.paths) {
        const ref = this.read('system', start - delay, count);
        for (let i = 0; i < count; i++) residual[i] -= gain * ref[i];
      }
      return residual;
    }
    this.paths = [];
    let mean = 0,
      variance = 0;
    for (const value of mic) mean += value / count;
    for (const value of mic) variance += (value - mean) ** 2 / count;
    if (variance < 1e-7) return mic;
    const ref = this.read('system', start - this.limit, count + this.limit + this.lookahead);
    const sums = new Float64Array(ref.length + 1);
    for (let i = 0; i < ref.length; i++) sums[i + 1] = sums[i] + ref[i] ** 2;
    const energies = new Float64Array(ref.length - count + 1);
    for (let i = 0; i < energies.length; i++) energies[i] = sums[i + count] - sums[i];
    const size = 2 ** Math.ceil(Math.log2(ref.length + count));
    const real = new Float64Array(size),
      imag = new Float64Array(size);
    real.set(ref);
    fft(real, imag);
    for (let path = 0; path < 3; path++) {
      let power = 0;
      for (const value of residual) power += value * value;
      if (power < count * 1e-6) break;
      const rr = new Float64Array(size),
        ri = new Float64Array(size);
      rr.set(residual);
      fft(rr, ri);
      for (let i = 0; i < size; i++) {
        const value = real[i] * rr[i] + imag[i] * ri[i];
        ri[i] = imag[i] * rr[i] - real[i] * ri[i];
        rr[i] = value;
      }
      fft(rr, ri, true);
      let best = 0,
        score = 0;
      for (let i = 0; i < energies.length; i++) {
        if (energies[i] < count * 1e-6) continue;
        const value = Math.abs(rr[i]) / Math.sqrt(Math.max(energies[i] * power, 1e-20));
        if (value > score) {
          score = value;
          best = i;
        }
      }
      if (score < 0.35) break;
      const gain = rr[best] / energies[best];
      if (Math.abs(gain) > 4) break;
      this.paths.push([this.limit - best, gain]);
      for (let i = 0; i < count; i++) residual[i] -= gain * ref[best + i];
    }
    return residual;
  }
  drain(final = false) {
    const output = [];
    if (this.cursor === null) return output;
    const known = Object.values(this.ends).filter((v) => v !== null),
      newest = Math.max(...known);
    let available = known.length === 2 ? Math.min(...known) : this.cursor;
    const stalled = performance.now() - Math.min(...Object.values(this.lastSeen)) > 2000;
    if (
      final ||
      (stalled && newest - available > this.window) ||
      newest - available > this.rate * 15
    )
      available = newest;
    if (!final) available -= this.lookahead;
    while (available - this.cursor >= this.window || (final && available > this.cursor)) {
      const count = Math.min(this.window, available - this.cursor),
        mic = this.read('mic', this.cursor, count),
        system = this.read('system', this.cursor, count);
      for (let offset = 0; offset < count; offset += this.rate / 2)
        mic.set(
          this.cancelEcho(mic.slice(offset, offset + this.rate / 2), this.cursor + offset),
          offset,
        );
      let peak = 0;
      for (let i = 0; i < count; i++) {
        mic[i] += system[i];
        peak = Math.max(peak, Math.abs(mic[i]));
      }
      if (peak > 1) for (let i = 0; i < count; i++) mic[i] /= peak;
      output.push({ samples: mic, start_ms: Math.round((this.cursor * 1000) / this.rate) });
      this.emitted = true;
      this.cursor += count;
      for (const track of ['mic', 'system']) {
        const history = track === 'system' ? this.limit : 0;
        const remove = Math.max(
          0,
          Math.min(this.buffers[track].length, this.cursor - history - this.starts[track]),
        );
        this.buffers[track] = this.buffers[track].slice(remove);
        this.starts[track] += remove;
      }
    }
    return output;
  }
  flush() {
    return this.drain(true);
  }
}
module.exports = { AlignedAudioMixer, pcmFloats, floatPCM };
