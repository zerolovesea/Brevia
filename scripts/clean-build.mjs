// 清理本地构建产物，回收空间。
//
//   npm run clean        -> backend/build + backend/runtime（PyInstaller 中间目录与产物）
//   npm run clean:dist   -> dist（electron-builder 输出，注意可能含 release.sh 下载的发布件）
//
// 不动 backend/bundled-models：那是下载好的随包模型，体积大且重下慢，属于"资产"而不是
// "中间产物"；要一致性请跑 `npm run pack:backend`（它自带 prune）。
import { rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  build: ['backend/build', 'backend/runtime'],
  dist: ['dist'],
};

async function directorySize(target) {
  let total = 0;
  const entries = await readdir(target, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    const file = await stat(target).catch(() => null);
    return file?.isFile() ? file.size : 0;
  }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await stat(child).catch(() => null))?.size ?? 0;
  }
  return total;
}

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !TARGETS[name]);
if (unknown.length) {
  console.error(`unknown clean target: ${unknown.join(', ')} (expected: ${Object.keys(TARGETS).join(', ')})`);
  process.exit(1);
}

const names = requested.length ? requested : ['build'];
let freed = 0;
for (const name of names) {
  for (const relative of TARGETS[name]) {
    const target = path.join(ROOT, relative);
    const size = await directorySize(target);
    await rm(target, { recursive: true, force: true });
    freed += size;
    console.log(`removed ${relative}${size ? ` (${(size / 1024 / 1024).toFixed(1)} MB)` : ''}`);
  }
}
const hint = names.includes('build') ? '; run `npm run pack:backend` before packaging' : '';
console.log(`cleaned ${(freed / 1024 / 1024).toFixed(1)} MB${hint}.`);
