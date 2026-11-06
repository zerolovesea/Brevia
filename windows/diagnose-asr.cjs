// 仅在真实模型门禁失败后采集公开样例诊断；不修改随包引擎或用户模型。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { download, digest } = require('./build.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const models = path.resolve(process.argv[2]);
  const engines = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-asr-diagnostic-'));
  const name = 'sherpa-onnx-v2.0.1-win-x64-shared-MT-Release-no-tts';
  try {
    console.log('ASR diagnostic CPU:', os.cpus()[0]?.model, os.release());
    await download(
      `https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/${name}.tar.bz2`,
      path.join(scratch, 'sherpa.tar.bz2'),
      'a644dfe2f7944afec9a356d2557c0452380f20ffcf2f8c704653cfce37558596',
    );
    const extracted = spawnSync('tar', ['-xf', 'sherpa.tar.bz2'], {
      cwd: scratch,
      encoding: 'utf8',
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    const binaries = path.join(scratch, name, 'bin');
    // 已与 03c6d6cb 的正式 MSVC 产物逐个核对；独立诊断无需重建整套安装器。
    for (const [dll, publishedDigest] of Object.entries({
      'sherpa-onnx-c-api.dll': 'ee2af9f49b8fc5dae135ad20c0b955cbab90d17b79cc1ad0db91e03b24962f68',
      'onnxruntime.dll': '7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25',
    })) {
      const official = path.join(scratch, name, 'lib', dll);
      assert.equal(
        await digest(official),
        engines ? await digest(path.join(engines, dll)) : publishedDigest,
        dll,
      );
    }
    const wav = fs.readFileSync(path.join(root, 'backend/fixtures/example-zh.wav'));
    let format, audio;
    for (let at = 12; at + 8 <= wav.length; ) {
      const size = wav.readUInt32LE(at + 4);
      const type = wav.toString('ascii', at, at + 4);
      if (type === 'fmt ') format = wav.subarray(at + 8, at + 8 + size);
      if (type === 'data') audio = wav.subarray(at + 8, at + 8 + size);
      at += 8 + size + (size % 2);
    }
    assert.equal(format?.readUInt16LE(0), 1);
    assert.equal(format.readUInt16LE(2), 1);
    assert.equal(format.readUInt32LE(4), 16000);
    assert.equal(format.readUInt16LE(14), 16);
    audio = audio.subarray(0, 16000 * 2 * 10);
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(36 + audio.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    format.copy(header, 20, 0, 16);
    header.write('data', 36);
    header.writeUInt32LE(audio.length, 40);
    const input = path.join(scratch, 'sample.wav');
    fs.writeFileSync(input, Buffer.concat([header, audio]));
    const model = path.join(models, 'funasr-nano-int8-asr-models-2025-12-30');
    // 配置文件按 UTF-8 读取，避免 Windows CLI 的 ANSI argv 改变中文语言提示。
    const recognizerConfig = path.join(scratch, 'recognizer.conf');
    fs.writeFileSync(
      recognizerConfig,
      '--funasr-nano-language=中文\n--funasr-nano-max-new-tokens=512\n--funasr-nano-temperature=0\n--funasr-nano-top-p=0.8\n--funasr-nano-itn=true\n',
    );
    for (const [mode, content] of [
      ['default', null],
      ['config-default', 'DEBUG=1\n'],
      ['basic-optimization', 'GraphOptimizationLevel=1\nDEBUG=1\n'],
      ['no-optimization', 'GraphOptimizationLevel=0\nDEBUG=1\n'],
      ['x64-precision', 'SessionConfig.session.x64quantprecision=1\nDEBUG=1\n'],
      [
        'no-integer-fusion',
        'SessionConfig.optimization.disable_specified_optimizers=MatMulIntegerToFloatFusion;DynamicQuantizeMatMulFusion\nDEBUG=1\n',
      ],
      ['no-prepacking', 'SessionConfig.session.disable_prepacking=1\nDEBUG=1\n'],
    ]) {
      let provider = 'cpu';
      if (content) {
        const config = path.join(scratch, mode + '.conf');
        fs.writeFileSync(config, content);
        provider += ':' + config;
      }
      console.log('ASR diagnostic mode:', mode);
      const result = spawnSync(
        path.join(binaries, 'sherpa-onnx-offline.exe'),
        [
          '--config=' + recognizerConfig,
          '--provider=' + provider,
          '--debug=true',
          '--num-threads=2',
          '--funasr-nano-encoder-adaptor=' + path.join(model, 'encoder_adaptor.int8.onnx'),
          '--funasr-nano-llm=' + path.join(model, 'llm.int8.onnx'),
          '--funasr-nano-embedding=' + path.join(model, 'embedding.int8.onnx'),
          '--funasr-nano-tokenizer=' + path.join(model, 'Qwen3-0.6B'),
          input,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      );
      console.log(result.stdout);
      console.error(result.stderr);
      console.log('ASR diagnostic status:', result.status, result.error?.message || '');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
