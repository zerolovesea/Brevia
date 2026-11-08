// CI 只缓存已校验的 VAD 权重；准备到现有打包目录，不改变应用内下载源。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ModelManager } = require('../macos/backend/models.cjs');
const { TaskControl } = require('../macos/backend/tasks.cjs');

async function prepareBundledVAD() {
  const root = path.resolve(__dirname, '..');
  const manager = new ModelManager(path.join(root, 'dist/bundled-vad'), () => {}, {
    platform: 'win32',
    bundledRoot: null,
  });
  const model = manager.get('silero-vad');
  assert.match(model.archive_sha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(model.files.length, 1);
  const directory = manager.path(model.id);
  const file = path.join(directory, model.files[0]);
  const verify = async () => {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    assert.equal(hash.digest('hex'), model.archive_sha256, 'Bundled VAD cache checksum mismatch');
  };
  if (manager.isReady(model.id)) await verify();
  else {
    try {
      await manager.install(model.id, new TaskControl());
    } catch (error) {
      const transient =
        /Model download failed \((408|429|5\d\d)\)|fetch failed|Model download timed out|Incomplete model download/.test(
          error.message,
        ) ||
        ['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT'].includes(error.cause?.code || error.code);
      if (!transient) throw error;
      const mirror = model.china_downloads?.[0];
      assert.equal(
        model.china_downloads?.length,
        1,
        'VAD mirror must contain only the pinned model',
      );
      assert.equal(mirror.path, model.files[0], 'VAD mirror must use the pinned filename');
      assert.equal(mirror?.sha256, model.archive_sha256, 'VAD mirror must match the pinned model');
      console.warn('VAD primary download unavailable; trying the verified ModelScope mirror');
      await manager.install(model.id, new TaskControl(), true);
    }
    await verify();
  }
  // 现有打包器会在这些目录复用已验证的模型。
  const target = {
    darwin: path.join(root, 'dist/native/cache/models', path.basename(directory)),
    win32: path.join(root, 'dist/native-win/models', path.basename(directory)),
  }[process.platform];
  assert.ok(target, 'Unsupported bundled VAD platform');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(directory, target, { recursive: true });
  console.log('Verified bundled VAD ready:', target);
}

if (require.main === module)
  prepareBundledVAD().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { prepareBundledVAD };
