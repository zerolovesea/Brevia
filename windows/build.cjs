// 固定源码与校验值；Windows 的原生引擎不借用构建机 Python 或可选运行包。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist/native-win');
const sources = path.join(out, 'sources');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + ' failed (' + result.status + ')');
  return result;
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const part of fs.createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
async function download(url, file, sha) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && (await digest(file)) === sha) return;
  const temporary = file + '.part';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:')
      throw new Error('Download failed: ' + url);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    if ((await digest(temporary)) !== sha) throw new Error('Checksum mismatch: ' + url);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
const pins = [
  [
    'https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/miniaudio.h',
    'miniaudio.h',
    '7e4f3f13c8fe66df2080ac3dd12a89193e3c2463cb7f067c798abd7331cd8ee6',
  ],
  [
    'https://raw.githubusercontent.com/nothings/stb/f0569113c93ad095470c54bf34a17b36646bbbb5/stb_vorbis.c',
    'stb_vorbis.c',
    '4c7cb2ff1f7011e9d67950446b7eb9ca044f2e464d76bfbb0b84dd2e23e65636',
  ],
  [
    'https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/extras/decoders/libopus/miniaudio_libopus.h',
    'extras/decoders/libopus/miniaudio_libopus.h',
    '2d15bc4acb91a9775babe25527654f75ecc970ecdb05cdf2382a43d8e3eaed97',
  ],
  [
    'https://raw.githubusercontent.com/mackron/miniaudio/0.11.23/extras/decoders/libopus/miniaudio_libopus.c',
    'extras/decoders/libopus/miniaudio_libopus.upstream.c',
    'd58586494c65a4604c7b3d2e0a78851a9ed4ec8a56b68b300aa423a96c9e16ac',
  ],
  [
    'https://downloads.xiph.org/releases/ogg/libogg-1.3.6.tar.xz',
    'libogg-1.3.6.tar.xz',
    '5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061',
  ],
  [
    'https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz',
    'opus-1.6.1.tar.gz',
    '6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1',
  ],
  [
    'https://downloads.xiph.org/releases/opus/opusfile-0.12.tar.gz',
    'opusfile-0.12.tar.gz',
    '118d8601c12dd6a44f52423e68ca9083cc9f2bfe72da7a8c1acb22a80ae3550b',
  ],
  [
    'https://codeload.github.com/ggml-org/llama.cpp/tar.gz/e3546c7948e3af463d0b401e6421d5a4c2faf565',
    'llama-native.tar.gz',
    'f53842f1e5c1dd7a92776576cc4add2e381d0c1b345793e89459489019b9f61a',
  ],
  [
    'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v2.0.1/sherpa-onnx/c-api/c-api.h',
    'sherpa-headers/sherpa-onnx/c-api/c-api.h',
    '5698f38ba09ad2bdf085c56a6cbbd7741acf15e25f4ce5c7097b9702cadf437f',
  ],
];
const sherpa = 'sherpa-onnx-v2.0.1-win-x64-shared-MT-Release-no-tts-lib';
async function buildNative() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Build on Windows x64 with Visual Studio C++');
  fs.mkdirSync(sources, { recursive: true });
  for (const [url, name, sha] of pins) await download(url, path.join(sources, name), sha);
  await download(
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/${sherpa}.tar.bz2`,
    path.join(sources, 'sherpa.tar.bz2'),
    '21da6a8b92d63ca02ad41dbfc120012343aaaec2e5e02b14819c6b4f38004509',
  );
  for (const [archive, directory] of [
    ['libogg-1.3.6.tar.xz', 'libogg-1.3.6'],
    ['opus-1.6.1.tar.gz', 'opus-1.6.1'],
    ['opusfile-0.12.tar.gz', 'opusfile-0.12'],
    ['llama-native.tar.gz', 'llama.cpp-e3546c7948e3af463d0b401e6421d5a4c2faf565'],
    ['sherpa.tar.bz2', sherpa],
  ])
    if (!fs.existsSync(path.join(sources, directory)))
      run('tar', ['-xf', archive], { cwd: sources });
  const decoder = path.join(sources, 'extras/decoders/libopus/miniaudio_libopus.c');
  fs.copyFileSync(
    path.join(sources, 'extras/decoders/libopus/miniaudio_libopus.upstream.c'),
    decoder,
  );
  // 与 macOS 使用同一份上游双声道修复。
  run('git', [
    'apply',
    '--unsafe-paths',
    '--directory=' + path.join(sources, 'extras/decoders/libopus'),
    path.join(root, 'macos/inference/opus-stereo.patch'),
  ]);
  const build = path.join(out, 'build');
  run('cmake', [
    '-S',
    'windows',
    '-B',
    build,
    '-A',
    'x64',
    '-DSOURCES=' + sources.replaceAll('\\', '/'),
    '-DSHERPA=' + path.join(sources, sherpa).replaceAll('\\', '/'),
  ]);
  run('cmake', ['--build', build, '--config', 'Release', '--parallel', '4']);
  run(path.join(build, 'Release/native-helpers-test.exe'), []);
  run(path.join(build, 'Release/audio-test.exe'), []);
  run(path.join(build, 'Release/decode-test.exe'), []);
  const engines = path.join(out, 'engines');
  fs.mkdirSync(engines, { recursive: true });
  fs.copyFileSync(
    path.join(root, 'windows/funasr-cpu.conf'),
    path.join(engines, 'funasr-cpu.conf'),
  );
  fs.copyFileSync(
    path.join(build, 'Release/brevia-inference.exe'),
    path.join(engines, 'brevia-inference.exe'),
  );
  const dlls = fs.readdirSync(path.join(sources, sherpa, 'lib')).filter((n) => n.endsWith('.dll'));
  for (const name of dlls)
    fs.copyFileSync(path.join(sources, sherpa, 'lib', name), path.join(engines, name));
  run(path.join(engines, 'brevia-inference.exe'), [], { input: '', stdio: 'pipe', timeout: 30000 });
  const licenses = path.join(engines, 'licenses');
  fs.mkdirSync(licenses, { recursive: true });
  for (const [file, name] of [
    ['llama.cpp-e3546c7948e3af463d0b401e6421d5a4c2faf565/LICENSE', 'llama.cpp-LICENSE'],
    ['llama.cpp-e3546c7948e3af463d0b401e6421d5a4c2faf565/common/base64.hpp', 'base64-LICENSE'],
    ['libogg-1.3.6/COPYING', 'libogg-LICENSE'],
    ['opus-1.6.1/COPYING', 'opus-LICENSE'],
    ['opusfile-0.12/COPYING', 'opusfile-LICENSE'],
  ])
    fs.copyFileSync(path.join(sources, file), path.join(licenses, name));
  for (const [url, name, sha] of [
    [
      'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT',
      'nlohmann-LICENSE',
      '46a65cffd1ea955132d95a8dd921640714a8d6b537d2e4e482d31145ae95b603',
    ],
    [
      'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v2.0.1/LICENSE',
      'sherpa-LICENSE',
      'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
    ],
    [
      'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.28.2/LICENSE',
      'onnxruntime-LICENSE',
      '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
    ],
  ])
    await download(url, path.join(licenses, name), sha);
  for (const name of ['miniaudio.h', 'stb_vorbis.c']) {
    const text = fs.readFileSync(path.join(sources, name), 'utf8'),
      index = text.lastIndexOf('This software is available');
    if (index < 0) throw new Error('License missing: ' + name);
    fs.writeFileSync(path.join(licenses, name + '-LICENSE'), text.slice(index));
  }
  return { out, engines, audio: path.join(build, 'Release/brevia-audio.exe') };
}
if (require.main === module)
  buildNative().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { buildNative, run, download, digest };
