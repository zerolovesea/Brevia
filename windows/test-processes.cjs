// Windows 集成测试的正常退出检查；不强杀宿主或 WebView2。
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function waitForWebViewExit(hostName, data) {
  const started = Date.now();
  // 不输出完整命令行、不关闭别的 WebView2；用实例名/资料目录及创建时间识别测试进程。
  const script = `
    $ErrorActionPreference = 'Stop'
    [void][Reflection.Assembly]::LoadWithPartialName('System.Management')
    $query = [System.Management.ManagementObjectSearcher]::new("SELECT ProcessId, CreationDate, CommandLine FROM Win32_Process WHERE Name='msedgewebview2.exe'")
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $first = $true
    try {
      while ($true) {
        $remaining = [Collections.Generic.List[string]]::new()
        $processes = $query.Get()
        try {
          foreach ($process in $processes) {
            $command = [string]$process['CommandLine']
            if (($env:BREVIA_SMOKE_HOST_NAME -and $command.IndexOf($env:BREVIA_SMOKE_HOST_NAME, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or $command.IndexOf($env:BREVIA_SMOKE_PROFILE, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
              $kind = [regex]::Match($command, '--type=([a-z-]+)').Groups[1].Value
              if (!$kind) { $kind = 'browser' }
              $remaining.Add("pid=" + $process['ProcessId'] + " created=" + $process['CreationDate'] + " type=" + $kind)
            }
            $process.Dispose()
          }
        } finally { $processes.Dispose() }
        if ($remaining.Count -eq 0) {
          exit 0
        }
        if ($first) {
          [Console]::WriteLine("Waiting for WebView2: " + [string]::Join(', ', $remaining))
          $first = $false
        }
        if ($watch.Elapsed.TotalSeconds -ge 20) {
          [Console]::Error.WriteLine("WebView2 exit timed out: " + [string]::Join(', ', $remaining))
          exit 1
        }
        [Threading.Thread]::Sleep(200)
      }
    } finally { $query.Dispose() }
  `;
  const result = spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: { ...process.env, BREVIA_SMOKE_HOST_NAME: hostName || '', BREVIA_SMOKE_PROFILE: data },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 25000,
    },
  );
  if (result.stdout) console.error(result.stdout.trim());
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'WebView2 process exit');
  console.error(`WebView2 process exit verified after ${Date.now() - started} ms.`);
}

module.exports = { waitForWebViewExit };
