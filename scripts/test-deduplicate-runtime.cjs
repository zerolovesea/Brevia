const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  default: afterPack,
  deduplicateRuntime,
  prepareWindowsRuntime,
} = require('./deduplicate-runtime.cjs');

(async () => {
  await afterPack({ electronPlatformName: 'linux' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'brevia-runtime-'));
  try {
    const winRuntime = path.join(temp, 'windows');
    const winWorker = path.join(winRuntime, 'brevia-worker');
    const winHelper = path.join(winRuntime, 'brevia-llama-helper');
    const winLib = path.join(winWorker, '_internal', 'llama_cpp', 'lib');
    await fs.mkdir(winLib, { recursive: true });
    await fs.mkdir(winHelper, { recursive: true });
    await fs.writeFile(path.join(winWorker, 'brevia-worker.exe'), 'unified runtime');
    for (const name of ['llama.dll', 'llama.lib', 'llama.pdb', 'llama.h', 'LICENSE', 'model.bin']) {
      await fs.writeFile(path.join(winLib, name), 'fixture');
    }
    await prepareWindowsRuntime(winRuntime);
    assert.deepEqual((await fs.readdir(winLib)).sort(), ['LICENSE', 'llama.dll', 'model.bin']);
    await assert.rejects(fs.access(winHelper), { code: 'ENOENT' });
    await prepareWindowsRuntime(winRuntime); // idempotent; no symlinks on Windows.
    await fs.mkdir(winHelper);
    await fs.unlink(path.join(winWorker, 'brevia-worker.exe'));
    await assert.rejects(prepareWindowsRuntime(winRuntime), { code: 'ENOENT' });
    await fs.access(winHelper); // invalid input must not delete the old runtime.
    if (process.platform !== 'darwin') {
      console.log('Windows runtime packaging tests passed');
      return;
    }
    const worker = path.join(temp, 'brevia-worker', '_internal');
    const helper = path.join(temp, 'brevia-llama-helper', '_internal');
    for (const directory of [worker, helper]) {
      await fs.mkdir(path.join(directory, 'lib'), { recursive: true });
      await fs.writeFile(path.join(directory, 'lib', 'same'), 'shared');
      await fs.writeFile(path.join(directory, 'different'), directory === worker ? 'one' : 'two');
      const framework = path.join(directory, 'Python.framework');
      const version = path.join(framework, 'Versions', 'A');
      await fs.mkdir(path.join(version, 'Resources'), { recursive: true });
      await fs.copyFile('/usr/bin/true', path.join(version, 'Python'));
      await fs.writeFile(
        path.join(version, 'Resources', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Python</string>
<key>CFBundleIdentifier</key><string>org.brevia.test.python</string>
<key>CFBundlePackageType</key><string>FMWK</string></dict></plist>`,
      );
      await fs.symlink('A', path.join(framework, 'Versions', 'Current'));
      await fs.symlink('Versions/Current/Python', path.join(framework, 'Python'));
      await fs.symlink('Versions/Current/Resources', path.join(framework, 'Resources'));
    }
    await fs.writeFile(path.join(helper, 'unique'), 'helper only');
    await fs.symlink('lib/same', path.join(helper, 'existing-link'));
    assert.equal(await deduplicateRuntime(temp), 6);
    assert.equal(await fs.readFile(path.join(helper, 'lib', 'same'), 'utf8'), 'shared');
    assert.equal((await fs.lstat(path.join(helper, 'lib', 'same'))).isSymbolicLink(), true);
    assert.equal((await fs.lstat(path.join(helper, 'different'))).isSymbolicLink(), false);
    assert.equal(await fs.readFile(path.join(helper, 'unique'), 'utf8'), 'helper only');
    assert.equal(await deduplicateRuntime(temp), 0);
    // Reproduce the python.org framework layout used by GitHub's macOS runner.
    const framework = path.join(helper, 'Python.framework');
    for (const file of ['Python', 'Resources/Info.plist']) {
      assert.equal((await fs.lstat(path.join(framework, 'Versions', 'A', file))).isFile(), true);
    }
    execFileSync('codesign', ['--force', '--sign', '-', framework], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', framework], { stdio: 'pipe' });
    // Relative links must remain valid after moving the installed app.
    await fs.rename(temp, `${temp}-moved`);
    assert.equal(
      await fs.readFile(
        path.join(`${temp}-moved`, 'brevia-llama-helper', '_internal', 'existing-link'),
        'utf8',
      ),
      'shared',
    );
    console.log('Runtime deduplication tests passed');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
    await fs.rm(`${temp}-moved`, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
