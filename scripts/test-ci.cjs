const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const workflow = (name) =>
  fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8');
const mac = workflow('native-macos.yml');
const windows = workflow('windows-backend.yml');
const mobile = workflow('mobile.yml');
const release = workflow('release.yml');

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
