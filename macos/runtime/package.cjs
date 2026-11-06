// macOS 全组件构建。Python 解释器、扩展和可选运行包均不能进入交付应用。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'dist/native');
const version = require('../../package.json').version;
const identity = process.env.BREVIA_SIGN_IDENTITY || '-';
const nodeVersion = '22.23.1';
const nodeSha = 'fb526811860f81dcac7dd8b2b55eca4accfc5d61c3b7c2508f2639faee8a738d';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.signal || result.status}`);
  return result.stdout;
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const part of fs.createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
function sign(file, entitlements) {
  const args = ['--force', '--sign', identity];
  if (identity !== '-') args.push('--options', 'runtime', '--timestamp');
  if (entitlements) args.push('--entitlements', path.join(__dirname, entitlements));
  run('codesign', [...args, file], { stdio: 'pipe', timeout: 60000 });
}
function inspect(binary) {
  const text = run('otool', ['-arch', 'arm64', '-l', binary], { encoding: 'utf8', stdio: 'pipe' });
  const target =
    /cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform (?:1|MACOS)\s+minos ([\d.]+)/.exec(text) ||
    /cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)/.exec(text);
  if (
    !target ||
    Number(target[1].split('.')[0]) > 14 ||
    (target[1].startsWith('14.') && target[1] !== '14.0' && target[1] !== '14.0.0')
  )
    throw new Error('Invalid macOS 14 arm64 deployment target: ' + binary);
  for (const match of text.matchAll(
    /cmd LC_(?:LOAD|LOAD_WEAK|REEXPORT|LOAD_UPWARD|LAZY_LOAD)_DYLIB\s+cmdsize \d+\s+name (.+?) \(offset/g,
  )) {
    if (
      !/^(@rpath\/|@loader_path\/|@executable_path\/|\/usr\/lib\/|\/System\/Library\/)/.test(
        match[1],
      )
    )
      throw new Error('Build-machine dependency: ' + match[1]);
    if (/python/i.test(match[1])) throw new Error('Python dependency in ' + binary);
  }
  for (const match of text.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset/g)) {
    if (
      !/^(@loader_path(?:\/|$)|@executable_path(?:\/|$)|\/usr\/lib\/|\/System\/Library\/)/.test(
        match[1],
      )
    )
      throw new Error('Build-machine search path: ' + match[1]);
  }
}
async function binaries(directory, boundary = fs.realpathSync(directory)) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (/python|\.py[co]?$|\.whl$|\.so$/i.test(entry.name))
      throw new Error('Python runtime file in application: ' + file);
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(file);
      if (!target.startsWith(boundary + path.sep))
        throw new Error('External runtime symlink: ' + file);
    } else if (entry.isDirectory()) result.push(...(await binaries(file, boundary)));
    else if (entry.isFile()) {
      const descriptor = fs.openSync(file, 'r');
      const header = Buffer.alloc(4);
      try {
        fs.readSync(descriptor, header, 0, 4, 0);
      } finally {
        fs.closeSync(descriptor);
      }
      if (
        ['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca'].includes(
          header.toString('hex'),
        )
      )
        result.push(file);
    }
  }
  return result;
}
async function copyNode(control) {
  const cache = path.join(out, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `node-v${nodeVersion}.tar.xz`);
  const prefix = `node-v${nodeVersion}-darwin-arm64`;
  if (!fs.existsSync(archive) || (await digest(archive)) !== nodeSha)
    run('curl', [
      '--fail',
      '--location',
      '--proto',
      '=https',
      '--retry',
      '2',
      '-o',
      archive,
      `https://nodejs.org/dist/v${nodeVersion}/${prefix}.tar.xz`,
    ]);
  if ((await digest(archive)) !== nodeSha) throw new Error('Node.js checksum mismatch');
  for (const [source, name] of [
    ['bin/node', 'node'],
    ['LICENSE', 'node-LICENSE'],
  ]) {
    const target = fs.openSync(path.join(control, name), 'w', 0o755);
    try {
      run('/usr/bin/tar', ['-xOf', archive, `${prefix}/${source}`], {
        stdio: ['ignore', target, 'inherit'],
      });
    } finally {
      fs.closeSync(target);
    }
  }
}
async function prepareVAD(destination) {
  const { ModelManager } = require('../backend/models.cjs');
  const { TaskControl } = require('../backend/tasks.cjs');
  const manager = new ModelManager(path.join(out, 'cache/models'), () => {}, {
    catalogPath: path.join(root, 'backend/models.json'),
  });
  await manager.install('silero-vad', new TaskControl());
  fs.cpSync(
    manager.path('silero-vad'),
    path.join(destination, path.basename(manager.path('silero-vad'))),
    { recursive: true },
  );
}
async function updater(app) {
  const publicKey = process.env.BREVIA_NATIVE_UPDATE_PUBKEY;
  const privateKey =
    process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  const feed = path.join(out, 'latest-webkit.json');
  if (!publicKey && !privateKey) {
    fs.rmSync(feed, { force: true });
    return;
  }
  if (!publicKey || !privateKey || identity === '-')
    throw new Error('Native updates require both signing keys and Developer ID');
  run('codesign', [
    '--verify',
    '-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
    app,
  ]);
  const filename = `Brevia-WebKit-${version}-arm64.app.tar.gz`;
  const archive = path.join(out, filename);
  run('/usr/bin/tar', ['-czf', archive, '-C', path.dirname(app), path.basename(app)], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  run('cargo', ['tauri', 'signer', 'sign', '--app-version', version, archive]);
  const signature = fs.readFileSync(archive + '.sig', 'utf8').trim();
  const keyId = (text) =>
    Buffer.from(Buffer.from(text, 'base64').toString().split('\n')[1], 'base64').subarray(2, 10);
  if (!keyId(signature).equals(keyId(publicKey)))
    throw new Error('Updater public key and signature differ');
  fs.writeFileSync(
    feed,
    JSON.stringify(
      {
        version,
        platforms: {
          'darwin-aarch64': {
            signature,
            url: `https://github.com/zerolovesea/Brevia/releases/download/v${version}/${filename}`,
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
}
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Requires Apple silicon macOS');
  fs.mkdirSync(out, { recursive: true });
  run('bash', ['macos/inference/build.sh']);
  run('npm', ['run', 'build']);
  run(
    'macos/host/cargo.sh',
    ['build', '--manifest-path', 'macos/host/Cargo.toml', '--locked', '--release'],
    { env: { ...process.env, TAURI_CONFIG: JSON.stringify({ version }) } },
  );
  const stage = fs.mkdtempSync(path.join(out, '.package-'));
  try {
    const app = path.join(stage, 'Brevia.app');
    const contents = path.join(app, 'Contents');
    const resources = path.join(contents, 'Resources');
    const control = path.join(resources, 'control');
    fs.mkdirSync(control, { recursive: true });
    fs.mkdirSync(path.join(contents, 'MacOS'));
    fs.copyFileSync(
      path.join(
        process.env.CARGO_TARGET_DIR || path.join(root, 'macos/host/target'),
        'release/brevia-host',
      ),
      path.join(contents, 'MacOS/brevia-host'),
    );
    const plist = path.join(contents, 'Info.plist');
    fs.copyFileSync(path.join(root, 'macos/host/Info.plist'), plist);
    for (const key of ['CFBundleVersion', 'CFBundleShortVersionString'])
      run('plutil', ['-replace', key, '-string', version, plist]);
    fs.copyFileSync(
      path.join(root, 'electron/assets/icon.icns'),
      path.join(resources, 'icon.icns'),
    );
    fs.mkdirSync(path.join(resources, 'frontend'));
    for (const name of ['summary-providers.js', 'i18n-data.js'])
      fs.copyFileSync(path.join(root, 'frontend', name), path.join(resources, 'frontend', name));
    fs.cpSync(path.join(out, 'engines'), path.join(resources, 'engines'), {
      recursive: true,
      verbatimSymlinks: true,
    });
    const backend = path.join(resources, 'backend');
    fs.mkdirSync(backend);
    for (const name of ['settings.json', 'models.json', 'examples.json'])
      fs.copyFileSync(path.join(root, 'backend', name), path.join(backend, name));
    fs.cpSync(path.join(root, 'backend/fixtures'), path.join(backend, 'fixtures'), {
      recursive: true,
    });
    await prepareVAD(path.join(backend, 'bundled-models'));
    await copyNode(control);
    const options = { bundle: true, platform: 'node', target: 'node22', absWorkingDir: root };
    await build({
      ...options,
      entryPoints: ['macos/control.cjs'],
      alias: { electron: './macos/electron-compat.cjs' },
      external: ['electron-updater'],
      outfile: path.join(control, 'control.cjs'),
    });
    await build({
      ...options,
      entryPoints: {
        worker: 'macos/backend/worker.cjs',
        'audio-mix-worker': 'macos/backend/audio-mix-worker.cjs',
      },
      outdir: control,
      outExtension: { '.js': '.cjs' },
    });
    run('xcrun', [
      'swiftc',
      '-parse-as-library',
      '-O',
      '-target',
      'arm64-apple-macos14.0',
      'macos/audio/BreviaAudio.swift',
      '-o',
      path.join(control, 'brevia-audio'),
    ]);
    for (const binary of await binaries(app)) {
      inspect(binary);
      if (binary.endsWith('/node')) {
        run('xcrun', ['strip', '-x', '-S', binary]);
        sign(binary, 'node-entitlements.plist');
      } else sign(binary, 'host-entitlements.plist');
    }
    sign(app, 'host-entitlements.plist');
    run('codesign', ['--verify', '--deep', '--strict', app]);
    // Hardened Runtime 对 dylib 名称与签名的检查比 ad-hoc 严格，必须启动成品验证。
    for (const engine of ['brevia-inference', 'brevia-mlx'])
      run(path.join(resources, 'engines', engine), [], {
        input: '',
        stdio: 'pipe',
        timeout: 30000,
      });
    run('node', ['macos/test-packaged-control.cjs', app]);
    if (process.argv[2] === 'app') {
      const image = path.join(out, 'image');
      fs.rmSync(image, { recursive: true, force: true });
      fs.renameSync(stage, image);
      console.log(path.join(image, 'Brevia.app'));
      return;
    }
    await updater(app);
    fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
    const pending = path.join(out, `.Brevia-WebKit-${version}.dmg`);
    run('hdiutil', [
      'create',
      '-ov',
      '-fs',
      'HFS+',
      '-format',
      'ULMO',
      '-volname',
      'Brevia',
      '-srcfolder',
      stage,
      pending,
    ]);
    if (identity !== '-') sign(pending);
    run('hdiutil', ['verify', pending]);
    // 完整推理引擎统一随包，以原始 200 MB 目标作为回归上限。
    const size = fs.statSync(pending).size;
    if (size > 200_000_000) throw new Error('Complete DMG exceeds 200 MB: ' + size);
    const dmg = path.join(out, `Brevia-WebKit-${version}-arm64.dmg`);
    fs.renameSync(pending, dmg);
    const image = path.join(out, 'image');
    fs.rmSync(image, { recursive: true, force: true });
    fs.renameSync(stage, image);
    console.log(`${dmg}: ${size.toLocaleString()} bytes, SHA256 ${await digest(dmg)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { binaries, inspect };
