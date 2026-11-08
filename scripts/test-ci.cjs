const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

const workflow = (name) =>
  fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8');
const mac = workflow('native-macos.yml');
const windows = workflow('windows-backend.yml');
const mobile = workflow('mobile.yml');
const release = workflow('release.yml');
const website = workflow('deploy-pages.yml');

function triggered(source, file) {
  const list = source.match(/    paths: &[^\n]+\n((?:      - '[^']+'\n)+)/);
  assert.ok(list, 'PR and push must share one path filter');
  const anchor = source.match(/    paths: &([^\n]+)/)[1];
  assert.ok(source.includes(`    paths: *${anchor}`));
  let matched = false;
  for (const [, pattern] of list[1].matchAll(/- '([^']+)'/g)) {
    const excluded = pattern.startsWith('!');
    if (path.posix.matchesGlob(file, excluded ? pattern.slice(1) : pattern)) matched = !excluded;
  }
  return matched;
}

test('platform filters keep shared runtime inputs and skip unrelated changes', () => {
  for (const [file, expected] of [
    ['macos/audio/BreviaAudio.swift', [true, false, false]],
    ['macos/inference/Sources/main.swift', [true, false, false]],
    ['macos/inference/mlx-alignment.patch', [true, false, false]],
    ['macos/host/src/appkit.m', [true, false, false]],
    ['macos/host/src/windows.rs', [false, true, false]],
    ['macos/host/src/main.rs', [true, true, false]],
    ['macos/backend/worker.cjs', [true, true, false]],
    ['macos/bridge.js', [true, true, false]],
    ['macos/inference/NativeInference.cpp', [true, true, false]],
    ['macos/inference/EngineProtocol.h', [true, true, false]],
    ['macos/inference/opus-stereo.patch', [true, true, false]],
    ['backend/fixtures/example-zh.wav', [true, true, false]],
    ['skills/brevia/SKILL.md', [true, true, false]],
    ['frontend/app.js', [true, true, false]],
    ['windows/AudioCapture.cpp', [false, true, false]],
    ['mobile/ios/Runner/SceneDelegate.swift', [false, false, true]],
    ['mobile/lib/recorder.dart', [false, false, true]],
    ['scripts/ci-mobile-changes.py', [false, false, true]],
    ['mobile/README.md', [false, false, false]],
    ['backend/README.md', [false, false, false]],
    ['macos/inference/README.md', [false, false, false]],
    ['website/index-zh.html', [false, false, false]],
    ['.github/workflows/release.yml', [true, true, false]],
  ]) {
    assert.deepEqual(
      [mac, windows, mobile].map((source) => triggered(source, file)),
      expected,
      file,
    );
  }
});

test('website-only scripts run website checks without triggering desktop packages', () => {
  for (const file of [
    'website/app-motion.js',
    'scripts/test-website-demos.cjs',
    'scripts/update-release-links.mjs',
  ]) {
    for (const source of [mac, windows]) assert.equal(triggered(source, file), false, file);
    assert.equal(triggered(website, file), true, file);
  }
  for (const source of [mac, windows]) {
    for (const file of [
      'scripts/prepare-bundled-vad.cjs',
      '.github/actions/bundled-vad/action.yml',
    ])
      assert.equal(triggered(source, file), true, file);
  }
  assert.match(website, /run: node scripts\/test-website-demos.cjs/);
  const publish = website.slice(website.indexOf('  deploy:\n'));
  assert.match(publish, /needs: check/);
  assert.match(
    publish,
    /if: github.event_name != 'pull_request' && github.ref == 'refs\/heads\/main'/,
  );
  assert.doesNotMatch(
    website.slice(0, website.indexOf('  deploy:\n')),
    /pages: write|id-token: write/,
  );
  assert.match(website, /group: website-\$\{\{ github.ref \}\}/);
});

test('all desktop packaging workflows prepare the same verified VAD cache', () => {
  for (const [source, packaging] of [
    [mac, 'npm run dist:mac'],
    [windows, 'npm run dist:win'],
    [release, 'npm run dist:mac'],
  ]) {
    const prepare = source.indexOf('uses: ./.github/actions/bundled-vad');
    assert.ok(prepare >= 0 && prepare < source.indexOf(packaging));
  }
  const action = fs.readFileSync(
    path.join(__dirname, '../.github/actions/bundled-vad/action.yml'),
    'utf8',
  );
  assert.match(action, /archive_sha256/);
  assert.match(
    action,
    /bundled-vad-v1-\$\{\{ runner.os \}\}-\$\{\{ steps.model.outputs.revision \}\}-\$\{\{ steps.model.outputs.sha \}\}/,
  );
  assert.match(action, /model.revision/);
  assert.doesNotMatch(action, /restore-keys:/);
  assert.ok(
    action.indexOf('run: node scripts/prepare-bundled-vad.cjs') <
      action.indexOf('uses: actions/cache/save@v4'),
  );
  assert.match(action, /key: \$\{\{ steps.cache.outputs.cache-primary-key \}\}/);
});

test('bundled VAD verifies cache hits, stages each platform and limits mirror fallback', async () => {
  const script = fs.readFileSync(path.join(__dirname, 'prepare-bundled-vad.cjs'), 'utf8');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-bundled-vad-'));
  const data = Buffer.from('pinned VAD fixture');
  const sha = createHash('sha256').update(data).digest('hex');
  const model = {
    id: 'silero-vad',
    revision: 'asr-models/v5',
    files: ['silero_vad.onnx'],
    archive_sha256: sha,
    china_downloads: [{ path: 'silero_vad.onnx', sha256: sha }],
  };
  let fixture = 0;
  async function run(platform, { cached, error, mirrorSha = sha, rejects } = {}) {
    const root = path.join(scratch, String(fixture++));
    const directory = path.join(root, 'dist/bundled-vad/silero-vad-asr-models-v5');
    const calls = [];
    class Manager {
      get() {
        return { ...model, china_downloads: [{ path: 'silero_vad.onnx', sha256: mirrorSha }] };
      }
      path() {
        return directory;
      }
      isReady() {
        return fs.existsSync(path.join(directory, model.files[0]));
      }
      async install(id, control, mirror = false) {
        calls.push(mirror);
        if (error && !mirror) throw error;
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, model.files[0]), data);
      }
    }
    if (cached !== undefined) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, model.files[0]), cached);
    }
    const output = { exports: {} };
    runInNewContext(script, {
      require: (name) =>
        name.endsWith('/models.cjs')
          ? { ModelManager: Manager }
          : name.endsWith('/tasks.cjs')
            ? { TaskControl: class {} }
            : require(name),
      module: output,
      __dirname: path.join(root, 'scripts'),
      process: { platform },
      console: { log() {}, warn() {} },
    });
    const result = output.exports.prepareBundledVAD();
    if (
      rejects ||
      cached?.toString() === 'corrupt' ||
      error?.message.includes('checksum') ||
      mirrorSha !== sha
    ) {
      await assert.rejects(result, rejects || /checksum|pinned model/i);
      assert.deepEqual(calls, cached ? [] : [false]);
      return;
    }
    await result;
    assert.deepEqual(calls, cached ? [] : error ? [false, true] : [false]);
    const target = {
      darwin: 'dist/native/cache/models/silero-vad-asr-models-v5/silero_vad.onnx',
      win32: 'dist/native-win/models/silero-vad-asr-models-v5/silero_vad.onnx',
    }[platform];
    assert.deepEqual(fs.readFileSync(path.join(root, target)), data);
  }
  try {
    for (const platform of ['darwin', 'win32']) await run(platform, { cached: data });
    await run('darwin');
    await run('win32', { error: new Error('Model download failed (504)') });
    await run('win32', {
      error: new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }),
    });
    await run('darwin', { error: new Error('Incomplete model download') });
    await run('darwin', { error: new Error('Model download failed (404)'), rejects: /404/ });
    await run('darwin', { error: new Error('Unsafe model redirect'), rejects: /Unsafe/ });
    await run('darwin', { error: new Error('ENOSPC'), rejects: /ENOSPC/ });
    await run('darwin', { cached: Buffer.from('corrupt') });
    await run('win32', { error: new Error('Model archive checksum mismatch') });
    await run('win32', {
      error: new Error('Model download failed (504)'),
      mirrorSha: '0'.repeat(64),
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('CI and Release share compatible caches without caching signed distributions', () => {
  const keys = [mac, windows, release].map(
    (source) => source.match(/key: (native-build-v2[^\n]+)/)[1],
  );
  assert.equal(new Set(keys).size, 1, 'CI and Release must use the same key');
  for (const source of [mac, windows, release]) {
    const key = source.match(/key: (native-build-v2[^\n]+)/)[1];
    assert.ok(key.includes('runner.os') && key.includes('runner.arch'));
    assert.ok(key.includes('native-cache-image.outputs.version') && key.includes('github.sha'));
    assert.ok(key.includes('hashFiles('));
    for (const config of ['native-macos.yml', 'windows-backend.yml', 'release.yml'])
      assert.ok(key.includes(config), 'toolchain selection must invalidate the cache');
    const restore = source.match(/restore-keys: \|\n +([^\n]+)/)[1];
    assert.equal(
      restore,
      key.replace('${{ github.sha }}', ''),
      'do not restore incompatible dependency caches',
    );
    assert.match(source, /uses: actions\/cache@v4/);
  }
  for (const source of [mac, windows]) {
    const paths = source.slice(
      source.indexOf('      - name: Cache native compilation'),
      source.indexOf('      - name: Restore native bundler'),
    );
    assert.doesNotMatch(
      paths,
      /RUNNER_TEMP|\.p12|keychain|dist\/native\/image|dist\/native-win\/app|release\/bundle/,
    );
    assert.match(paths, /!macos\/host\/target\/release\/deps\/brevia_host-\*/);
    const matrixName = source === mac ? 'macOS ARM64' : 'Windows x64';
    const matrix = release.slice(release.indexOf('- name: ' + matrixName));
    const ciPaths = paths
      .match(/path: \|\n([\s\S]*?)          key:/)[1]
      .trim()
      .split('\n')
      .map((line) => line.trim());
    const releasePaths = matrix
      .match(/cache-paths: \|\n([\s\S]*?)            artifact:/)[1]
      .trim()
      .split('\n')
      .map((line) => line.trim());
    assert.deepEqual(
      releasePaths,
      ciPaths,
      'cache path lists must match for GitHub cache version compatibility',
    );
  }
});

test('mobile distribution requires checks, platform selection and the original channel gate', () => {
  assert.match(mobile, /fetch-depth: 0/);
  assert.match(mobile, /run: python3 \.\.\/scripts\/ci-mobile-changes\.py/);
  for (const platform of ['android', 'ios']) {
    const job = mobile.slice(mobile.indexOf(`  ${platform}:\n`));
    assert.match(job, /^  \w+:\n    needs: check\n/);
    const condition = job.match(/    if: ([^\n]+)/)[1];
    for (const gate of [
      "github.event_name != 'pull_request'",
      "github.ref == 'refs/heads/main'",
      "inputs.channel != 'appstore'",
      `needs.check.outputs.${platform} == 'true'`,
    ])
      assert.ok(condition.includes(gate), gate);
  }
});

test('cache archive excludes the host binary even when tar recursively includes directories', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-cache-paths-'));
  try {
    const deps = 'macos/host/target/release/deps';
    const files = [`${deps}/brevia_host-abc.exe`, `${deps}/libserde-abc.rlib`];
    fs.mkdirSync(path.join(scratch, deps), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(scratch, file), 'fixture');
    for (const source of [mac, windows]) {
      const block = source.slice(
        source.indexOf('      - name: Cache native compilation'),
        source.indexOf('      - name: Restore native bundler'),
      );
      const patterns = block
        .match(/path: \|\n([\s\S]*?)          key:/)[1]
        .trim()
        .split('\n')
        .map((line) => line.trim());
      // cache 的 glob 不隐式展开目录，但 tar 会递归；排除子文件不能抵消父目录被选中。
      const entries = [deps, ...files].filter((file) => {
        let included = false;
        for (const pattern of patterns) {
          const excluded = pattern.startsWith('!');
          if (path.posix.matchesGlob(file, excluded ? pattern.slice(1) : pattern))
            included = !excluded;
        }
        return included;
      });
      const archive = path.join(scratch, 'cache.tar');
      execFileSync('tar', ['-cf', archive, '-T', '-'], {
        cwd: scratch,
        input: entries.join('\n') + '\n',
      });
      const listing = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' });
      assert.match(listing, /libserde-abc.rlib/);
      assert.doesNotMatch(listing, /brevia_host-abc.exe/);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
