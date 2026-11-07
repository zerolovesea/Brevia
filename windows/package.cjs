// Windows 复用系统 WebView2，缺失时由安装器补装；Node 和推理引擎始终随包提供。
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { buildNative, run, download, digest } = require('./build.cjs');
const { ModelManager } = require('../macos/backend/models.cjs');
const { TaskControl } = require('../macos/backend/tasks.cjs');
const { packageAgent } = require('../scripts/package-agent.cjs');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist/native-win');
const version = require('../package.json').version;
const nodeVersion = '22.23.1';
async function main() {
  const native = await buildNative();
  run(process.execPath, [
    process.env.npm_execpath ||
      path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    'run',
    'build',
  ]);
  const app = path.join(out, 'app'),
    resources = path.join(app, 'resources'),
    control = path.join(resources, 'control');
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(control, { recursive: true });
  const archive = path.join(out, `node-v${nodeVersion}-win-x64.zip`);
  await download(
    `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`,
    archive,
    '7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29',
  );
  run(
    'tar',
    [
      '-xf',
      path.basename(archive),
      `node-v${nodeVersion}-win-x64/node.exe`,
      `node-v${nodeVersion}-win-x64/LICENSE`,
    ],
    { cwd: out },
  );
  fs.copyFileSync(
    path.join(out, `node-v${nodeVersion}-win-x64/node.exe`),
    path.join(control, 'node.exe'),
  );
  fs.copyFileSync(
    path.join(out, `node-v${nodeVersion}-win-x64/LICENSE`),
    path.join(control, 'node-LICENSE'),
  );
  fs.copyFileSync(native.audio, path.join(control, 'brevia-audio.exe'));
  fs.cpSync(native.engines, path.join(resources, 'engines'), { recursive: true });
  const backend = path.join(resources, 'backend');
  fs.mkdirSync(backend);
  for (const name of ['settings.json', 'models.json', 'examples.json'])
    fs.copyFileSync(path.join(root, 'backend', name), path.join(backend, name));
  fs.cpSync(path.join(root, 'backend/fixtures'), path.join(backend, 'fixtures'), {
    recursive: true,
  });
  const manager = new ModelManager(path.join(out, 'models'), () => {});
  await manager.install('silero-vad', new TaskControl());
  fs.mkdirSync(path.join(backend, 'bundled-models'), { recursive: true });
  fs.cpSync(
    manager.path('silero-vad'),
    path.join(backend, 'bundled-models', path.basename(manager.path('silero-vad'))),
    { recursive: true },
  );
  fs.mkdirSync(path.join(resources, 'frontend'));
  for (const name of ['summary-providers.js', 'i18n-data.js', 'model-selection.js'])
    fs.copyFileSync(path.join(root, 'frontend', name), path.join(resources, 'frontend', name));
  fs.cpSync(path.join(root, 'skills/brevia'), path.join(resources, 'skills/brevia'), {
    recursive: true,
  });
  const common = { bundle: true, platform: 'node', target: 'node22', absWorkingDir: root };
  await build({
    ...common,
    entryPoints: ['macos/control.cjs'],
    outfile: path.join(control, 'control.cjs'),
  });
  await build({
    ...common,
    entryPoints: {
      worker: 'macos/backend/worker.cjs',
      'audio-mix-worker': 'macos/backend/audio-mix-worker.cjs',
    },
    outdir: control,
    outExtension: { '.js': '.cjs' },
  });
  await packageAgent(control);
  fs.renameSync(path.join(control, 'brevia.cmd'), path.join(app, 'brevia.cmd'));
  const privateKey =
    process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  const publicKey = process.env.BREVIA_NATIVE_UPDATE_PUBKEY;
  const signed = Boolean(privateKey);
  if (signed !== Boolean(publicKey)) throw new Error('Configure both native update signing keys');
  const config = {
    version,
    mainBinaryName: 'Brevia',
    plugins: { updater: { pubkey: publicKey || '' } },
    bundle: {
      active: true,
      targets: ['nsis'],
      createUpdaterArtifacts: signed,
      icon: [path.join(root, 'desktop/assets/icon.ico')],
      resources: { [resources]: 'resources/', [path.join(app, 'brevia.cmd')]: 'brevia.cmd' },
      windows: {
        webviewInstallMode: { type: 'embedBootstrapper', silent: true },
        ...(process.env.BREVIA_WINDOWS_CERT_THUMBPRINT && {
          certificateThumbprint: process.env.BREVIA_WINDOWS_CERT_THUMBPRINT,
          digestAlgorithm: 'sha256',
          timestampUrl: 'http://timestamp.digicert.com',
          tsp: true,
        }),
        nsis: {
          installerHooks: path.join(root, 'windows/installer-hooks.nsh'),
          installMode: 'perMachine',
          displayLanguageSelector: false,
          languages: ['English', 'SimpChinese'],
        },
      },
    },
  };
  const env = {
    ...process.env,
    TAURI_CONFIG: JSON.stringify(config),
    ...(signed && { TAURI_SIGNING_PRIVATE_KEY: privateKey }),
  };
  if (process.argv[2] === 'app') {
    run('cargo', ['build', '--release', '--locked', '--manifest-path', 'macos/host/Cargo.toml'], {
      env,
    });
  } else
    run('cargo', ['tauri', 'build', '--bundles', 'nsis', '--config', JSON.stringify(config)], {
      cwd: path.join(root, 'macos/host'),
      env,
    });
  const target = process.env.CARGO_TARGET_DIR || path.join(root, 'macos/host/target');
  const binary = path.join(
    target,
    'release',
    process.argv[2] === 'app' ? 'brevia-host.exe' : 'Brevia.exe',
  );
  fs.copyFileSync(binary, path.join(app, 'Brevia.exe'));
  run(process.execPath, ['windows/test-packaged.cjs', app]);
  if (process.argv[2] === 'app') return;
  const bundles = path.join(target, 'release/bundle/nsis');
  const filename = fs
    .readdirSync(bundles)
    .find((n) => n.endsWith('-setup.exe') && n.includes(version));
  if (!filename) throw new Error('Windows installer was not produced');
  const name = `Brevia-${version}-x64-setup.exe`,
    installer = path.join(out, name);
  fs.copyFileSync(path.join(bundles, filename), installer);
  if (signed) {
    const signature = fs.readFileSync(path.join(bundles, filename + '.sig'), 'utf8').trim();
    const keyId = (text) => {
      const record = Buffer.from(
        Buffer.from(text, 'base64').toString().split('\n')[1] || '',
        'base64',
      );
      if (record.length < 10) throw new Error('Invalid native update key or signature');
      return record.subarray(2, 10);
    };
    if (!keyId(signature).equals(keyId(publicKey)))
      throw new Error('Updater public key and signature differ');
    fs.writeFileSync(installer + '.sig', signature + '\n');
    fs.writeFileSync(
      path.join(out, 'latest-windows.json'),
      JSON.stringify(
        {
          version,
          platforms: {
            'windows-x86_64': {
              signature,
              url: `https://github.com/zerolovesea/Brevia/releases/download/v${version}/${name}`,
            },
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else fs.rmSync(path.join(out, 'latest-windows.json'), { force: true });
  console.log(
    `${installer}: ${fs.statSync(installer).size} bytes, SHA256 ${await digest(installer)}`,
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
