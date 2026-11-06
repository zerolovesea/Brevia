// 使用真实权重验证原生服务，临时输入由仓库样例提供，不访问设备。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EngineClient } = require('../backend/engine.cjs');

function smokeModelIds() {
  const asr =
    process.env.BREVIA_TEST_MODEL ||
    (process.env.BREVIA_TEST_MLX ? 'qwen3-asr-0.6b-mlx' : 'funasr-nano-int8');
  return process.env.BREVIA_TEST_MLX
    ? [asr]
    : [
        asr,
        'silero-vad',
        'eres2net-base-3dspeaker-zh',
        'pyannote-segmentation-3.0',
        process.env.BREVIA_TEST_LLM || 'hy-mt2-1.8b-q4km',
      ];
}

async function main() {
  console.log(
    'Native inference smoke:',
    process.platform,
    process.arch,
    os.cpus()[0]?.model,
    os.release(),
  );
  const root = path.resolve(__dirname, '../..');
  const models = path.resolve(process.argv[2] || '.models');
  const engines = path.resolve(
    process.argv[3] ||
      (process.platform === 'win32' ? 'dist/native-win/engines' : 'dist/native/engines'),
  );
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'backend/models.json')));
  const lookup = (id) => {
    const model = catalog.find((m) => m.id === id);
    const directory = path.join(models, `${id}-${model.revision.replaceAll('/', '-')}`);
    assert.ok(fs.existsSync(directory), directory);
    return { ...model, path: directory };
  };
  const modelID = smokeModelIds()[0];
  const english = modelID.startsWith('parakeet-');
  const wav = fs.readFileSync(
    path.join(root, `backend/fixtures/example-${english ? 'en' : 'zh'}.wav`),
  );
  let audio;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') audio = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  assert.ok(audio);
  const pcm = audio.subarray(0, 16000 * 2 * 10).toString('base64');
  const binary =
    (process.env.BREVIA_TEST_MLX ? 'brevia-mlx' : 'brevia-inference') +
    (process.platform === 'win32' ? '.exe' : '');
  const engine = new EngineClient(path.join(engines, binary));
  const signal = AbortSignal.timeout(300000);
  const call = (type, payload) => engine.request(type, payload, { signal });
  try {
    const asr = lookup(modelID);
    const loaded = await call('asr.load', {
      path: asr.path,
      kind: asr.kind,
      files: asr.files,
      language: english ? 'en' : 'zh',
      hotwords: process.env.BREVIA_TEST_HOTWORDS?.split(',') || [],
      threads: 2,
    });
    assert.equal(
      loaded.max_speech_seconds,
      process.env.BREVIA_TEST_MLX
        ? 20
        : { qwen3: 50, 'funasr-nano': 22, whisper: 30 }[asr.kind] || 20,
    );
    const result = await call('asr.decode', { pcm, sample_rate: 16000 });
    assert.ok(result.text.length > 3, result.text);
    console.log(binary, modelID, 'ASR', result.text);
    if (english) {
      assert.ok(result.words.length > 0, 'Parakeet must preserve word timestamps');
      assert.ok(result.words.every((word) => word.end_ms >= word.start_ms && word.start_ms >= 0));
      assert.ok(
        result.words.every((word) => !word.text.includes('▁') && !word.text.startsWith('<|')),
      );
      assert.ok(result.words.every((word) => word.end_ms <= 10000));
      console.log('Word alignment', result.words.length, result.words[0]);
    }
    if (process.env.BREVIA_TEST_MLX) return;
    const vad = lookup('silero-vad');
    await call('vad.load', { path: path.join(vad.path, vad.files[0]) });
    const parts = await call('vad.feed', { pcm });
    parts.push(...(await call('vad.flush', {})));
    assert.ok(parts.length && parts.every((p) => p.end_ms > p.start_ms && p.pcm));
    await call('vad.reset', {});
    const fragmented = [];
    const starts = new Set();
    const samples = Buffer.from(pcm, 'base64');
    for (let at = 0; at < samples.length; at += 777 * 2) {
      const state = await call('vad.feed', {
        pcm: samples.subarray(at, at + 777 * 2).toString('base64'),
        with_state: true,
      });
      if (state.speech_detected) {
        assert.ok(state.current_segment_start >= 0);
        starts.add(state.current_segment_start / 16);
      } else assert.equal(state.current_segment_start, -1);
      fragmented.push(...state.segments);
    }
    fragmented.push(...(await call('vad.flush', { with_state: true })).segments);
    assert.deepEqual(fragmented, parts, 'VAD results must not depend on input chunk boundaries');
    assert.ok(fragmented.every((part) => starts.has(part.start_ms)));
    assert.ok(fragmented.every((part) => part.end_ms <= samples.length / 32));
    const embedding = lookup('eres2net-base-3dspeaker-zh');
    const vector = await call('speaker.embed', {
      path: path.join(embedding.path, embedding.files[0]),
      pcm,
      threads: 1,
    });
    assert.equal(vector.embedding.length, 512);
    const segmentation = lookup('pyannote-segmentation-3.0');
    const diarized = await call('speaker.diarize', {
      segmentation_path: path.join(segmentation.path, segmentation.files[0]),
      embedding_path: path.join(embedding.path, embedding.files[0]),
      pcm,
      num_speakers: 1,
    });
    assert.ok(diarized.segments.length);
    const translator = lookup(process.env.BREVIA_TEST_LLM || 'hy-mt2-1.8b-q4km');
    await call('llama.load', {
      path: path.join(translator.path, translator.files[0]),
      context_size: 1024,
      threads: 2,
    });
    const translation = await call('llama.generate', {
      prompt: 'Translate the following text into English. Output only the translation.\n\n你好。',
      max_tokens: 24,
      temperature: 0,
      chat: true,
      require_complete: true,
    });
    assert.match(translation.text, /hello/i);
    assert.doesNotMatch(translation.text, /<think>/);
    await assert.rejects(
      call('llama.generate', {
        prompt:
          'Translate the following text into English. Output only the translation.\n\n我们明天上午九点召开项目评审会议。',
        max_tokens: 1,
        temperature: 0,
        chat: true,
        require_complete: true,
      }),
      /Translation exceeded output token limit/,
    );
    const stopped = await call('llama.generate', {
      prompt: 'Translate the following text into English. Output only the translation.\n\n你好。',
      max_tokens: 24,
      temperature: 0,
      chat: true,
      stop_tokens: ['Hello', 'hello'],
      require_complete: true,
    });
    assert.doesNotMatch(stopped.text, /hello/i);
    console.log(
      'Native VAD, speaker embedding, diarization and GGUF translation passed.',
      translation.text,
    );
    await assert.rejects(call('asr.decode', { pcm: '*', sample_rate: 16000 }), /PCM/);
  } finally {
    engine.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { smokeModelIds };
