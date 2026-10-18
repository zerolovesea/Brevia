// 核对真实分包产物及更新清单，防止上传目录、通道或哈希不一致。
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');
const { version } = require('../package.json');

async function main() {
  const root = path.resolve('dist/nsis-web');
  const manifest = yaml.load(await readFile(path.join(root, 'cuda.yml'), 'utf8'));
  const installer = `Brevia-${version}-x64-cuda-setup.exe`;
  const archive = `brevia-${version}-x64.nsis.7z`;
  assert.equal(manifest.version, version);
  assert.equal(manifest.path, installer);
  assert.equal(manifest.packages.x64.path, archive);
  for (const entry of [...manifest.files, manifest.packages.x64]) {
    const filename = entry.url || entry.path;
    assert.equal(path.basename(filename), filename);
    const file = path.join(root, filename);
    const size = (await stat(file)).size;
    assert.equal(size, entry.size);
    const digest = createHash('sha512');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    assert.equal(digest.digest('base64'), entry.sha512);
    console.log(`Verified CUDA distribution: ${filename} (${size} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
