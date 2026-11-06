const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { SentenceVAD } = require('./sentence-vad.cjs');
const { EngineClient } = require('./engine.cjs');
const { readWindow } = require('./worker-speakers.cjs');
const binary = path.resolve(__dirname, '../../dist/native/engines/brevia-inference'),
  model = path.resolve(__dirname, '../../.models/silero-vad-asr-models-v5');
const available =
  process.platform === 'darwin' &&
  fs.existsSync(binary) &&
  fs.existsSync(path.join(model, 'silero_vad.onnx'));
test(
  'Native SentenceVAD retains original cuts, 400ms lookback and previously unflushed final samples',
  { skip: !available },
  async () => {
    const worker = {
        settings: require('../../backend/settings.json'),
        models: { get: () => ({ files: ['silero_vad.onnx'] }), path: () => model },
        newEngine: () => new EngineClient(binary),
      },
      source = readWindow(path.join(__dirname, '../../backend/fixtures/example-zh.wav'));
    for (const expected of require('./test-vad-golden.json')) {
      const vad = await new SentenceVAD(worker, { language: 'zh' }, expected.maximum, 0).load(),
        pcm = Buffer.concat(Array(expected.repeats).fill(source)),
        parts = [];
      try {
        for (let at = 0; at < pcm.length; at += expected.chunk * 2)
          parts.push(...(await vad.accept(pcm.subarray(at, at + expected.chunk * 2), at / 32)));
        parts.push(...(await vad.flush()));
        assert.equal(parts.length, expected.segments.length);
        for (let i = 0; i < parts.length; i++) {
          const actual = parts[i],
            old = expected.segments[i],
            bytes = Buffer.from(actual.pcm, 'base64');
          assert.equal(actual.boundary, old.boundary);
          assert.ok(Math.abs(actual.start_ms - old.start_ms) <= 66);
          assert.ok(Math.abs(actual.end_ms - old.end_ms) <= 66);
          assert.ok(bytes.length <= expected.maximum * 32000);
          assert.ok(Math.abs(bytes.length / 32 - (actual.end_ms - actual.start_ms)) <= 1);
          if (expected.maximum === 20) {
            assert.equal(actual.start_ms, old.start_ms);
            assert.equal(
              createHash('sha256')
                .update(bytes.subarray(0, old.samples * 2))
                .digest('hex'),
              old.sha256,
            );
          }
          if (i) assert.ok(actual.start_ms >= parts[i - 1].end_ms - 401);
        }
        assert.equal(parts.at(-1).end_ms, Math.round(pcm.length / 32));
      } finally {
        vad.close();
      }
    }
  },
);
