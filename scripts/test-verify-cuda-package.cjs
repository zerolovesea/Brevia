const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { version } = require('../package.json');

const directory = mkdtempSync(path.join(os.tmpdir(), 'brevia-cuda-dist-'));
try {
  const root = path.join(directory, 'dist', 'nsis-web');
  mkdirSync(root, { recursive: true });
  const installer = `Brevia-${version}-x64-cuda-setup.exe`;
  const archive = `brevia-${version}-x64.nsis.7z`;
  const bytes = Buffer.from('fixture');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  for (const name of [installer, archive]) writeFileSync(path.join(root, name), bytes);
  writeFileSync(
    path.join(root, 'cuda.yml'),
    yaml.dump({
      version,
      path: installer,
      files: [{ url: installer, sha512, size: bytes.length }],
      packages: { x64: { path: archive, sha512, size: bytes.length } },
    }),
  );
  const run = () =>
    spawnSync(process.execPath, [path.join(__dirname, 'verify-cuda-package.cjs')], {
      cwd: directory,
      encoding: 'utf8',
    });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  writeFileSync(path.join(root, archive), Buffer.from('changed'));
  const corrupted = run();
  assert.equal(corrupted.status, 1);
  assert.match(corrupted.stderr, /ERR_ASSERTION/);
  console.log('CUDA distribution checksum and layout checks passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
