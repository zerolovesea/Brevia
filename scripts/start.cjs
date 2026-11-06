// macOS 本地启动与交付版本使用同一套 WebKit 和原生推理组件。
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.platform === 'darwin') {
  run(process.execPath, ['macos/runtime/package.cjs', 'app']);
  run('/usr/bin/open', [
    '-W',
    '-n',
    path.join(root, 'dist/native/image/Brevia.app'),
    '--args',
    ...process.argv.slice(2),
  ]);
} else if (process.platform === 'win32') {
  run(process.execPath, ['windows/package.cjs', 'app']);
  run(path.join(root, 'dist/native-win/app/Brevia.exe'), process.argv.slice(2));
} else run(require('electron'), ['.', ...process.argv.slice(2)]);
