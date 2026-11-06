// 仅在一次性的 Windows CI runner 上安装真实旧版本，验证迁移与运行中更新的边界。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { download } = require('./build.cjs');

const legacyGuid = 'cd5ecd10-b94d-5d23-8c47-11b57b4f71d8';
const uninstallRoot = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
function registry(hive, key, name, view) {
  const result = spawnSync('reg.exe', ['query', `${hive}\\${key}`, '/v', name, `/reg:${view}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status === 1) return null;
  assert.equal(result.status, 0, result.stderr);
  return (
    result.stdout
      .match(/REG_SZ\s+(.+)\r?$/m)?.[1]
      ?.trim()
      .replace(/^"|"$/g, '') ?? null
  );
}
function install(executable, args, expected = 0) {
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    timeout: 600000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${path.basename(executable)} ${args.join(' ')}`);
}
function legacyEntries() {
  return ['HKLM', 'HKCU'].flatMap((hive) =>
    [32, 64].flatMap((view) => {
      const directory = registry(hive, `Software\\${legacyGuid}`, 'InstallLocation', view);
      const uninstall = registry(hive, `${uninstallRoot}\\${legacyGuid}`, 'UninstallString', view);
      return directory || uninstall ? [{ hive, view, directory, uninstall }] : [];
    }),
  );
}
async function main() {
  assert.equal(process.platform, 'win32', 'Run this integration check on Windows');
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'This test installs apps; use a disposable CI runner',
  );
  const installer = path.resolve(process.argv[2] || '');
  assert.ok(fs.statSync(installer).isFile(), 'Pass the new native NSIS installer');
  assert.deepEqual(legacyEntries(), [], 'Refusing to replace an existing user installation');
  for (const view of [32, 64])
    assert.equal(registry('HKLM', `${uninstallRoot}\\Brevia`, 'InstallLocation', view), null);
  const profile = path.join(process.env.APPDATA, 'Brevia');
  assert.ok(!fs.existsSync(profile), 'Refusing to touch an existing user profile');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-upgrade-'));
  const directory = path.join(scratch, 'Custom Brevia Location');
  const oldInstaller = path.join(scratch, 'old-setup.exe');
  let app;
  let createdProfile = false;
  try {
    await download(
      'https://github.com/zerolovesea/Brevia/releases/download/v1.4.5/Brevia-1.4.5-x64-setup.exe',
      oldInstaller,
      '71016acd9f061f1401e549e14a77055c4a7985b0419958b500b171e5b0cd3559',
    );
    install(oldInstaller, ['/S', `/D=${directory}`]);
    assert.ok(fs.existsSync(path.join(directory, 'resources/app.asar')));
    const installed = legacyEntries();
    assert.equal(installed.length, 1, JSON.stringify(installed));
    assert.equal(installed[0].directory.toLowerCase(), directory.toLowerCase());
    assert.equal(installed[0].hive, 'HKLM');
    fs.mkdirSync(profile);
    createdProfile = true;
    const sentinel = path.join(profile, 'upgrade-preserved.txt');
    fs.writeFileSync(sentinel, 'user meetings and models must survive migration');

    // 不传 /D：原自定义目录应被自动保留；旧卸载器不能在写入新 resources 后运行。
    install(installer, ['/S']);
    assert.deepEqual(legacyEntries(), []);
    assert.ok(!fs.existsSync(path.join(directory, 'resources/app.asar')));
    assert.ok(!fs.existsSync(path.join(directory, 'Uninstall Brevia.exe')));
    for (const name of [
      'Brevia.exe',
      'resources/control/node.exe',
      'resources/control/control.cjs',
      'brevia.cmd',
    ])
      assert.ok(fs.existsSync(path.join(directory, name)), name);
    assert.equal(
      fs.readFileSync(sentinel, 'utf8'),
      'user meetings and models must survive migration',
    );
    assert.equal(
      registry('HKLM', `${uninstallRoot}\\Brevia`, 'InstallLocation', 64)?.toLowerCase(),
      directory.toLowerCase(),
    );

    // 重复安装应无副作用；实际宿主正在运行时静默安装必须退出而不强杀进程。
    install(installer, ['/S']);
    const runtimeProfile = path.join(scratch, 'isolated-runtime');
    app = spawn(path.join(directory, 'Brevia.exe'), ['--background'], {
      env: { ...process.env, BREVIA_DATA_DIR: runtimeProfile },
      stdio: 'inherit',
      windowsHide: true,
    });
    await once(app, 'spawn');
    const ready = path.join(runtimeProfile, '.agent/credentials.json');
    for (let count = 0; count < 120 && !fs.existsSync(ready); count++) {
      assert.equal(app.exitCode, null, 'Installed native app exited during startup');
      await delay(250);
    }
    assert.ok(fs.existsSync(ready), 'Installed native app did not start its Agent service');
    install(installer, ['/S'], 1618);
    assert.ok(process.kill(app.pid, 0), 'Installer terminated the running native app');
    assert.equal(
      fs.readFileSync(sentinel, 'utf8'),
      'user meetings and models must survive migration',
    );
    console.log(
      'Windows upgrade passed: real v1.4.5, custom directory, retained profile, removed legacy registration, repeat install, running-app protection.',
    );
  } finally {
    if (app && app.exitCode === null) {
      const exited = once(app, 'exit');
      // 仅收尾本测试启动且从未录音的隔离进程；生产安装器没有强杀分支。
      app.kill();
      await exited;
    }
    const uninstaller = path.join(directory, 'uninstall.exe');
    if (fs.existsSync(uninstaller)) install(uninstaller, ['/S', `_?=${directory}`]);
    if (createdProfile) fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
