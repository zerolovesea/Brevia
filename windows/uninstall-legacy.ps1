param(
  [Parameter(Mandatory=$true)][string]$Uninstaller,
  [Parameter(Mandatory=$true)][string]$Directory,
  [Parameter(Mandatory=$true)][string]$Result
)
$ErrorActionPreference = 'Stop'
$code = 1
try {
  # 由安装器以普通用户启动；禁止 ShellExecute 自动提权用户可写的旧卸载器。
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $Uninstaller
  $start.Arguments = "/S /KEEP_APP_DATA --updated /currentuser _?=$Directory"
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $process = [System.Diagnostics.Process]::Start($start)
  $process.WaitForExit()
  $code = $process.ExitCode
  $process.Dispose()
} finally {
  [System.IO.File]::WriteAllText("$Result.tmp", [string]$code)
  [System.IO.File]::Move("$Result.tmp", $Result)
}
