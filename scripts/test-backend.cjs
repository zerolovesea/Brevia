const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tests = fs
  .readdirSync(path.join(root, 'macos/backend'))
  .filter((name) => /^test-.*\.cjs$/.test(name))
  .map((name) => 'macos/backend/' + name);
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status || (result.signal ? 1 : 0);
