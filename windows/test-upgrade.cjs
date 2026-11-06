// 仅在一次性的 Windows CI runner 上安装真实旧版本，验证迁移与运行中更新的边界。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { download, digest } = require('./build.cjs');
const { waitForWebViewExit } = require('./test-processes.cjs');

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
  console.log(
    `Windows upgrade: ${path.basename(executable)} ${args.join(' ')} (expect ${expected})`,
  );
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    timeout: 600000,
    windowsHide: true,
    // NSIS 的末尾 /D= 与 _?= 路径即使含空格也不可加引号；只引用程序名。
    argv0: `"${executable}"`,
    windowsVerbatimArguments: true,
  });
  if (result.error) throw result.error;
  console.log(`Windows upgrade: installer exited with ${result.status}`);
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

function closeApp(child, executable) {
  // 新建的隔离资料默认关闭即退出；走真实窗口关闭/flush 链路，不用 TerminateProcess。
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BreviaTestWindow {
  delegate bool Callback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static IntPtr Find(uint process, bool log) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner != process) return true;
      var title = new StringBuilder(256); GetWindowText(window, title, title.Capacity);
      var kind = new StringBuilder(256); GetClassName(window, kind, kind.Capacity);
      bool visible = IsWindowVisible(window);
      if (log) Console.WriteLine("Test window: hwnd=" + window + " title=" + title + " class=" + kind + " visible=" + visible);
      if (visible && title.ToString() == "Brevia" && kind.ToString() == "Tauri Window") found = window;
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Close(IntPtr window) {
    Console.WriteLine("Closing Brevia main window: hwnd=" + window);
    if (!PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
  }
}
'@
    try { $app = [Diagnostics.Process]::GetProcessById([int]$env:BREVIA_TEST_PID) }
    catch [ArgumentException] { exit 0 }
    try {
      if ($app.MainModule.FileName -ne $env:BREVIA_TEST_EXE) { throw 'Test process identity changed' }
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $handle = [BreviaTestWindow]::Find($app.Id, $true)
      while (!$app.HasExited -and $handle -eq [IntPtr]::Zero -and $watch.Elapsed.TotalSeconds -lt 10) {
        [Threading.Thread]::Sleep(100)
        $app.Refresh()
        $handle = [BreviaTestWindow]::Find($app.Id, $false)
      }
      if (!$app.HasExited) {
        if ($handle -eq [IntPtr]::Zero) { throw 'Test app has no visible Brevia main window' }
        [BreviaTestWindow]::Close($handle)
      }
      if (!$app.WaitForExit(20000)) { throw 'Test app did not quit normally' }
    } finally { $app.Dispose() }
  `;
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        BREVIA_TEST_PID: String(child.pid),
        BREVIA_TEST_EXE: executable,
        // Add-Type 使用 Windows PowerShell 自带模块，不能继承 runner 的 PowerShell 7 模块。
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 35000,
    },
  );
  if (result.stdout) console.error(result.stdout.trim());
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Quit test app');
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
  const runtimeProfile = path.join(scratch, 'isolated-runtime');
  let app;
  let createdProfile = false;
  try {
    console.log('Windows upgrade: downloading the verified v1.4.5 installer');
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
    assert.equal(
      registry('HKLM', `${uninstallRoot}\\${legacyGuid}`, 'DisplayName', installed[0].view),
      'Brevia 1.4.5',
    );
    fs.mkdirSync(profile);
    createdProfile = true;
    const sentinel = path.join(profile, 'upgrade-preserved.txt');
    fs.writeFileSync(sentinel, 'user meetings and models must survive migration');

    // 即使 HKLM 登记可信，自定义目录中的卸载器仍可能被普通用户替换。
    const oldUninstaller = path.join(directory, 'Uninstall Brevia.exe');
    assert.equal(
      await digest(oldUninstaller),
      '42e3887c561ca98373e932f171cf19fe125d69c1075124f641f378951e6a4835',
    );
    const originalUninstaller = fs.readFileSync(oldUninstaller);
    try {
      fs.appendFileSync(oldUninstaller, 'tampered');
      install(installer, ['/S'], 1603);
      assert.ok(fs.existsSync(path.join(directory, 'resources/app.asar')));
      assert.ok(legacyEntries().length);
    } finally {
      fs.writeFileSync(oldUninstaller, originalUninstaller);
    }

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
    console.log('Windows upgrade: starting the installed native app');
    app = spawn(path.join(directory, 'Brevia.exe'), [], {
      env: { ...process.env, BREVIA_DATA_DIR: runtimeProfile },
      stdio: 'inherit',
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
    try {
      if (app && app.exitCode === null) {
        console.log('Windows upgrade: closing the native app normally');
        const exited = once(app, 'exit');
        closeApp(app, path.join(directory, 'Brevia.exe'));
        await exited;
        console.log('Windows upgrade: native host exited');
      }
      if (app) waitForWebViewExit(null, runtimeProfile);
      const uninstaller = path.join(directory, 'uninstall.exe');
      if (fs.existsSync(uninstaller)) install(uninstaller, ['/S', `_?=${directory}`]);
      if (createdProfile) fs.rmSync(profile, { recursive: true, force: true });
      fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } finally {
      // 清理失败应立即让 CI 报错；不能让仍存活的隔离子进程把失败步骤挂住。
      app?.unref();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
