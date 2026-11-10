// CI 缓存只保存经现有模型管理器校验并安装完成的权重。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ModelManager } = require('../macos/backend/models.cjs');
const { TaskControl } = require('../macos/backend/tasks.cjs');
const { smokeModelIds } = require('../macos/inference/smoke.cjs');

async function main() {
  const root = path.resolve(process.argv[2] || 'dist/native-smoke-models');
  let reported = -1;
  const manager = new ModelManager(
    root,
    (type, value) => {
      if (type !== 'model.progress') return;
      const step = Math.floor((value.received / value.total) * 10);
      if (step > reported) {
        reported = step;
        console.log(value.model_id, Math.round(value.received / 1024 / 1024) + ' MiB');
      }
    },
    { bundledRoot: null },
  );
  for (const id of smokeModelIds()) {
    reported = -1;
    const model = manager.get(id);
    if (model.downloads) {
      assert.ok(model.downloads.length, id + ' needs verified files');
      for (const item of model.downloads)
        assert.match(item.sha256 || '', /^[a-f0-9]{64}$/, id + '/' + item.path);
    } else
      assert.match(model.archive_sha256 || '', /^[a-f0-9]{64}$/, id + ' needs a pinned checksum');
    console.log(id, manager.isReady(id) ? 'cached' : 'installing');
    const directory = await manager.install(id, new TaskControl());
    const marker = JSON.parse(fs.readFileSync(path.join(directory, '.brevia.json'), 'utf8'));
    assert.equal(marker.id, id, 'Unexpected smoke model cache');
    assert.equal(marker.revision, model.revision, 'Stale smoke model cache');
    if (model.downloads)
      assert.deepEqual(marker.downloads, model.downloads, 'Stale smoke model file checksums');
    else
      assert.equal(
        marker.archive_sha256,
        model.archive_sha256,
        'Unverified smoke model cache: remove ' + directory + ' and retry',
      );
  }
  console.log('Native smoke models ready:', root);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
