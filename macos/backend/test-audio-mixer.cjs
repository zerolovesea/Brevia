const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { AlignedAudioMixer, pcmFloats } = require('./audio-mixer.cjs');
const { wavInfo } = require('./audio-io.cjs');
function mix(mic, system, chunk = 2731) {
  const mixer = new AlignedAudioMixer(),
    output = [];
  for (let at = 0; at < Math.max(mic.length, system.length); at += chunk) {
    output.push(...mixer.accept('mic', mic.subarray(at, at + chunk), at / 16));
    output.push(...mixer.accept('system', system.subarray(at, at + chunk), at / 16));
  }
  output.push(...mixer.flush());
  const result = new Float32Array(output.reduce((n, p) => n + p.samples.length, 0));
  let cursor = 0;
  for (const frame of output) {
    assert.equal(frame.start_ms, Math.round(cursor / 16));
    result.set(frame.samples, cursor);
    cursor += frame.samples.length;
  }
  assert.deepEqual(mixer.flush(), []);
  return result;
}
function delayed(values, ms) {
  const offset = Math.round(ms * 16),
    result = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++)
    if (i - offset >= 0 && i - offset < values.length) result[i] = values[i - offset];
  return result;
}
function random(length, scale, seed) {
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    result[i] = (seed / 0xffffffff - 0.5) * scale;
  }
  return result;
}
function energy(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return sum;
}
test('Acoustic echo suppression preserves the playback clock for long and multiple delays', () => {
  const file = path.join(__dirname, '../../backend/fixtures/example-zh.wav'),
    info = wavInfo(file),
    system = pcmFloats(fs.readFileSync(file).subarray(info.offset, info.offset + info.bytes)).map(
      (x) => x * 0.4,
    );
  for (const paths of [
    [[120, 0.7]],
    [[700, 0.7]],
    [[1400, 0.7]],
    [[-300, 0.7]],
    [
      [120, 0.7],
      [280, 0.5],
    ],
  ]) {
    const mic = new Float32Array(system.length);
    for (const [delay, gain] of paths) {
      const echo = delayed(system, delay);
      for (let i = 0; i < mic.length; i++) mic[i] += echo[i] * gain;
    }
    const result = mix(mic, system),
      residual = result.map((x, i) => x - system[i]);
    assert.equal(result.length, system.length);
    assert.ok(
      10 * Math.log10(energy(mic) / Math.max(1e-20, energy(residual))) > 15,
      'echo paths ' + JSON.stringify(paths),
    );
  }
});
test('Local speech remains during double talk and chunking does not retime unrelated audio', () => {
  const system = random(16000 * 6, 0.2, 82),
    local = random(system.length, 0.12, 91),
    echo1 = delayed(system, 700),
    echo2 = delayed(system, 120),
    mic = local.map((x, i) => x + 0.7 * echo1[i] + 0.4 * echo2[i]),
    result = mix(mic, system),
    residual = result.map((x, i) => x - system[i]);
  let correlation = 0;
  for (let i = 0; i < local.length; i++) correlation += local[i] * residual[i];
  assert.ok(correlation / Math.sqrt(energy(local) * energy(residual)) > 0.99);
  assert.ok(Math.abs(correlation / energy(local) - 1) < 0.01);
  assert.deepEqual(result, mix(mic, system, system.length));
  const quiet = new Float32Array(local.length);
  assert.deepEqual(mix(local, quiet), local);
  assert.deepEqual(mix(quiet, system), system);
});
test('The first combined window is available within two seconds', () => {
  const mixer = new AlignedAudioMixer(),
    audio = new Float32Array(32000);
  assert.deepEqual(mixer.accept('mic', audio, 0), []);
  const windows = mixer.accept('system', audio, 0);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].samples.length, 24000);
  assert.equal(windows[0].start_ms, 0);
});
