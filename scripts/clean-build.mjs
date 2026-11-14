// 清理本地构建产物，回收空间。
//
//   npm run clean        -> 原生编译缓存及历史 PyInstaller 中间目录
//   npm run clean:dist   -> dist（包括已构建的应用、安装包与下载缓存）
//
// 普通清理保留模型、下载归档与成品；下次 npm start 自动重建。
import { rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  build: [
    'backend/build',
    'backend/runtime',
    'macos/host/target',
    'macos/inference/.build',
    'dist/native/inference-sources/ogg-build',
    'dist/native/inference-sources/opus-build',
    'dist/native/inference-sources/opusfile-build',
    'dist/native/inference-sources/llama-native-build',
    'dist/native/inference-sources/llama-native-build-v1.0.0',
    'dist/native-win/build',
    'dist/native-win/cuda/build',
    'dist/native-linux/build',
    'dist/native-linux/cargo',
    'dist/native-linux-mlx/build',
  ],
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
  console.error(
    `unknown clean target: ${unknown.join(', ')} (expected: ${Object.keys(TARGETS).join(', ')})`,
  );
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
const hint = names.includes('build') ? '; npm start will rebuild the required components' : '';
console.log(`cleaned ${(freed / 1024 / 1024).toFixed(1)} MB${hint}.`);
