const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { ModelManager } = require('./models.cjs');
const { attachRecording } = require('./worker-session.cjs');

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform}: ASR catalog, downloads and legacy recording use the platform engine`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-platform-models-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const models = new ModelManager(root, () => {}, { platform });
    if (platform === 'linux') {
      const cuda = new ModelManager(root, () => {}, { platform, linuxBackend: 'cuda' });
      assert.deepEqual(models.recognitionDevice(), { device: 'cpu' });
      assert.deepEqual(cuda.recognitionDevice(), { device: 'gpu' });
      assert.equal(cuda.device().asr_backend, 'mlx-cuda');
    }
    const asr = models.list().filter((model) => model.capabilities.transcription && !model.retired);
    assert.ok(asr.length);
    assert.ok(
      asr.every((model) =>
        platform !== 'win32'
          ? model.runtime === 'mlx-audio'
          : model.runtime.startsWith('sherpa-onnx'),
      ),
    );
    for (const [family, name] of [
      ['funasr-nano', 'Fun-ASR-Nano'],
      ['qwen3-asr-0.6b', 'Qwen3-ASR 0.6B'],
      ['parakeet-tdt-0.6b-v3', 'Parakeet TDT 0.6B v3'],
    ]) {
      const matches = asr.filter((model) => model.id.startsWith(family));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].name, name);
    }
    assert.ok(models.get('silero-vad').runtime.startsWith('sherpa-onnx'));
    const foreign = platform !== 'win32' ? 'funasr-nano-int8' : 'funasr-nano-mlx';
    assert.equal(models.isKnown(foreign), false);
    await assert.rejects(models.install(foreign), /Unknown model/);
    const worker = { models };
    attachRecording(worker);
    const value = worker.sentencePayload({ language: 'zh', refined_model_id: foreign });
    assert.equal(
      value.refined_model_id,
      platform !== 'win32' ? 'funasr-nano-mlx' : 'funasr-nano-int8',
    );
    assert.throws(
      () => worker.sentencePayload({ refined_model_id: 'unknown-model' }),
      /Unknown model/,
    );
    const source = platform !== 'win32' ? 'qwen3-asr-0.6b-int8' : 'qwen3-asr-0.6b-mlx';
    const target = platform !== 'win32' ? 'qwen3-asr-0.6b-mlx' : 'qwen3-asr-0.6b-int8';
    assert.equal(
      worker.sentencePayload({ language: 'zh', refined_model_id: source }).refined_model_id,
      target,
    );
    assert.equal(models.defaultModel('en', source), target);
    const retired = worker.sentencePayload({
      language: 'zh',
      refined_model_id: 'fireredasr2-aed-mlx',
    });
    assert.equal(models.get(retired.refined_model_id).retired, undefined);
  });
}
