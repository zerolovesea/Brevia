const { execFile } = require('node:child_process');
const { realpath, stat } = require('node:fs/promises');
const { promisify } = require('node:util');
const path = require('node:path');

const run = promisify(execFile);
const excludedBundle =
  /^(?:com\.brevia|com\.apple\.safari|com\.google\.chrome|org\.chromium\.chromium|org\.mozilla\.firefox|com\.microsoft\.edgemac|com\.brave\.browser|company\.thebrowser\.browser|com\.vivaldi\.vivaldi|com\.operasoftware\.opera|com\.duckduckgo\.macos\.browser)(?:\.|$)/i;
const excludedExe =
  /^(?:brevia(?:-.*)?|browser|chrome|chromium|firefox|msedge|msedgewebview2|brave|opera|vivaldi|iexplore|arc|zen|waterfox|duckduckgo|thorium|360chrome(?:x)?|360se|qqbrowser|sogouexplorer)\.exe$/i;

function invalid() {
  return Object.assign(new Error('Select a meeting application'), {
    code: 'error.meeting_app.invalid',
  });
}

function macMeetingApp(info, file, localizedName) {
  const id = info.CFBundleIdentifier;
  const webLinks = info.CFBundleURLTypes?.some((type) =>
    type.CFBundleURLSchemes?.some((scheme) => /^https?$/i.test(scheme)),
  );
  const webViewer = info.CFBundleDocumentTypes?.some(
    (type) =>
      type.CFBundleTypeRole === 'Viewer' &&
      [
        ...(type.LSItemContentTypes || []),
        ...(type.CFBundleTypeMIMETypes || []),
        ...(type.CFBundleTypeExtensions || []),
      ].some((format) =>
        /^(?:public\.x?html|text\/html|application\/xhtml\+xml|html?|xhtml)$/i.test(format),
      ),
  );
  if (
    info.CFBundlePackageType !== 'APPL' ||
    typeof id !== 'string' ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(id) ||
    excludedBundle.test(id) ||
    (webLinks && webViewer)
  )
    throw invalid();
  const label = [localizedName, info.CFBundleDisplayName, info.CFBundleName].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return {
    id: id.toLowerCase(),
    name: (label?.trim() || path.basename(file).slice(0, -4)).slice(0, 255),
  };
}

async function selectedMeetingApp(file, localizedName) {
  file = await realpath(file);
  if (process.platform === 'darwin' && /\.app$/i.test(file)) {
    const { stdout } = await run(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', path.join(file, 'Contents', 'Info.plist')],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return macMeetingApp(JSON.parse(stdout), file, localizedName);
  }
  if (process.platform !== 'win32' || !/\.exe$/i.test(file) || !(await stat(file)).isFile())
    throw invalid();
  const name = path.win32.basename(file);
  if (excludedExe.test(name)) throw invalid();
  // RegistryKey expands REG_EXPAND_SZ and preserves Unicode in browser installation paths.
  const browserCommands = String.raw`
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $ErrorActionPreference = 'Stop'
    foreach ($hive in 'CurrentUser','LocalMachine') {
      foreach ($view in 'Registry32','Registry64') {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
        $apps = $base.OpenSubKey('SOFTWARE\Clients\StartMenuInternet')
        if ($apps) {
          foreach ($id in $apps.GetSubKeyNames()) {
            $command = $apps.OpenSubKey("$id\shell\open\command")
            if ($command) { $command.GetValue('') }
          }
        }
      }
    }`;
  const { stdout } = await run(
    path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', browserCommands],
    { windowsHide: true, timeout: 10000 },
  );
  for (const command of stdout.split(/\r?\n/)) {
    const target = command.trim().match(/^"([^"]+)"|^(.+?\.exe)(?=\s|$)/i);
    if (!target) continue;
    const registered = target[1] || target[2];
    const resolved = await realpath(registered).catch(() => registered);
    if (resolved.toLowerCase() === file.toLowerCase()) throw invalid();
  }
  return { id: file, name: name.slice(0, -4) };
}
module.exports = { selectedMeetingApp };
