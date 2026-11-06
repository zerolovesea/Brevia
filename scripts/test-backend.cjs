const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const legacy = process.platform !== 'darwin' || process.argv.includes('--legacy');
const tests = legacy
  ? [
      'worker',
      'sentence',
      'packaging',
      'mlx',
      'audio_mixer',
      'mobile',
      'process_resources',
      'bench_diarization',
      'diarization',
    ].map((name) => 'backend.test_' + name)
  : fs
      .readdirSync(path.join(root, 'macos/backend'))
      .filter((name) => /^test-.*\.cjs$/.test(name))
      .map((name) => 'macos/backend/' + name);
const result = spawnSync(
  legacy ? 'python' : process.execPath,
  [...(legacy ? ['-m', 'unittest'] : ['--test']), ...tests],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status || (result.signal ? 1 : 0);
