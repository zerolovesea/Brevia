// Build a Debian x86_64 desktop package from the native builds on this machine.
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { run, download, copyLicenses } = require('../windows/build.cjs');
const { packageAgent } = require('../scripts/package-agent.cjs');
const { version } = require('../package.json');

async function main() {
  const backend = process.argv[2];
  if (!['cpu', 'cuda'].includes(backend)) throw new Error('Specify cpu or cuda');
  process.umask(0o022);
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('Build on Linux x86_64');
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'dist/native-linux');
  const sources = path.join(out, 'sources');
  const native = path.join(out, 'build');
  const sherpaName = 'sherpa-onnx-v2.0.1-linux-x64-shared-no-tts-lib';
  const sherpa = path.join(sources, sherpaName);
  await require('../windows/build.cjs').prepareSources(
    sources,
    sherpaName,
    'ce437357915491e6f2754b52bec7dcf62ff6fc6aaed9cdcd66f17807bbaef374',
  );
  run('cmake', [
    '-S',
    'windows',
    '-B',
    native,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DSOURCES=' + sources,
    '-DSHERPA=' + sherpa,
  ]);
  run('cmake', [
    '--build',
    native,
    '--target',
    'brevia-inference',
    'brevia-audio',
    '--parallel',
    '4',
  ]);
  run(process.execPath, ['scripts/build-linux-mlx.cjs', backend]);
  const mlxDir = path.join(
    process.env.BREVIA_LINUX_MLX_OUT || path.join(root, 'dist/native-linux-mlx'),
    backend,
  );
  run('npm', ['run', 'build']);
  const cargoTarget = process.env.CARGO_TARGET_DIR || path.join(out, 'cargo');
  run('cargo', ['build', '--locked', '--release', '--manifest-path', 'macos/host/Cargo.toml'], {
    env: { ...process.env, CARGO_TARGET_DIR: cargoTarget },
  });
  const host = path.join(cargoTarget, 'release/brevia-host');
  fs.mkdirSync(out, { recursive: true });
  const stage = fs.mkdtempSync(path.join(out, 'package-'));
  try {
    const resources = path.join(stage, 'usr/lib/Brevia');
    const control = path.join(resources, 'control');
    const engines = path.join(resources, 'engines');
    const copy = (src, dst) => {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(src, dst, { recursive: true, dereference: true });
    };
    const write = (name, text) => {
      const file = path.join(stage, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    copy(host, path.join(stage, 'usr/bin/brevia-desktop'));
    run('strip', ['--strip-debug', path.join(stage, 'usr/bin/brevia-desktop')]);
    copy(path.join(native, 'brevia-audio'), path.join(control, 'brevia-audio'));
    const webkit = run('pkg-config', ['--cflags', '--libs', 'webkit2gtk-4.1'], {
      stdio: 'pipe',
      encoding: 'utf8',
    })
      .stdout.trim()
      .split(/\s+/);
    run('cc', ['-O2', 'linux/PrintPDF.c', ...webkit, '-o', path.join(control, 'brevia-print')]);
    copy(path.join(native, 'brevia-inference'), path.join(engines, 'brevia-inference'));
    copy(mlxDir, engines);
    fs.writeFileSync(path.join(engines, 'mlx-backend'), backend + '\n');
    copy(path.join(sherpa, 'lib'), engines);
    run('patchelf', ['--set-rpath', '$ORIGIN', path.join(engines, 'libsherpa-onnx-c-api.so')]);
    copy(path.join(root, 'LICENSE'), path.join(stage, 'usr/share/doc/brevia/copyright'));
    await copyLicenses(sources, engines);
    const archive = path.join(out, 'node-v22.23.1-linux-x64.tar.xz');
    await download(
      'https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz',
      archive,
      '9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578',
    );
    run(
      'tar',
      ['xf', archive, 'node-v22.23.1-linux-x64/bin/node', 'node-v22.23.1-linux-x64/LICENSE'],
      { cwd: out },
    );
    copy(path.join(out, 'node-v22.23.1-linux-x64/bin/node'), path.join(control, 'node'));
    copy(path.join(out, 'node-v22.23.1-linux-x64/LICENSE'), path.join(control, 'node-LICENSE'));
    for (const file of [
      'backend/models.json',
      'backend/settings.json',
      'backend/examples.json',
      'backend/fixtures',
      'frontend/summary-providers.js',
      'frontend/i18n-data.js',
      'frontend/model-selection.js',
      'skills/brevia',
    ]) {
      copy(path.join(root, file), path.join(resources, file));
    }
    const silero = path.join(out, 'silero_vad.onnx');
    await download(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx',
      silero,
      '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
    );
    copy(
      silero,
      path.join(resources, 'backend/bundled-models/silero-vad-asr-models-v5/silero_vad.onnx'),
    );
    await build({
      bundle: true,
      platform: 'node',
      target: 'node22',
      absWorkingDir: root,
      entryPoints: {
        control: 'macos/control.cjs',
        worker: 'macos/backend/worker.cjs',
        'audio-mix-worker': 'macos/backend/audio-mix-worker.cjs',
      },
      outdir: control,
      outExtension: { '.js': '.cjs' },
    });
    await packageAgent(control);
    fs.rmSync(path.join(control, 'brevia.cmd'));
    write(
      'usr/bin/brevia',
      '#!/bin/sh\nexec /usr/lib/Brevia/control/node /usr/lib/Brevia/control/brevia.cjs "$@"\n',
    );
    fs.chmodSync(path.join(stage, 'usr/bin/brevia'), 0o755);
    copy(
      path.join(root, 'frontend/assets/brevia-logo.svg'),
      path.join(stage, 'usr/share/icons/hicolor/scalable/apps/brevia.svg'),
    );
    write(
      'usr/share/applications/brevia.desktop',
      '[Desktop Entry]\nType=Application\nName=Brevia\nExec=brevia-desktop\nIcon=brevia\nTerminal=false\nCategories=AudioVideo;Office;\n',
    );
    write(
      'DEBIAN/control',
      `Package: brevia\nVersion: ${version}\nArchitecture: amd64\nMaintainer: Brevia\nDepends: libc6 (>= 2.39), libwebkit2gtk-4.1-0, libayatana-appindicator3-1, libpulse0, libopenblas0-pthread, libarchive-tools, ffmpeg, zenity, xdg-utils, xclip, wl-clipboard\nDescription: Brevia local meeting recorder and transcription desktop app\n`,
    );
    const target = path.join(out, `Brevia-${version}-amd64-${backend}.deb`);
    run('chmod', ['-R', 'go-w', stage]);
    run('dpkg-deb', ['--root-owner-group', '-Zxz', '-z3', '--build', stage, target]);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
