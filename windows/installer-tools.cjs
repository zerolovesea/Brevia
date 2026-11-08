const fs = require('node:fs');
const path = require('node:path');
const { download, run } = require('./build.cjs');

// 与固定的 Tauri CLI 2.12.2 对齐；复用带重试和 SHA256 校验的源码缓存。
async function prepareInstallerTools(tools) {
  const sources = path.resolve(__dirname, '../dist/native-win/sources');
  const archive = path.join(sources, 'nsis-3.11.zip');
  const plugin = path.join(sources, 'nsis_tauri_utils-0.5.3.dll');
  await download(
    'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip',
    archive,
    'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1',
  );
  await download(
    'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll',
    plugin,
    '5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709',
  );
  fs.mkdirSync(tools, { recursive: true });
  const nsis = path.join(tools, 'NSIS');
  fs.rmSync(path.join(tools, 'nsis-3.11'), { recursive: true, force: true });
  run('tar', ['-xf', archive, '-C', tools]);
  fs.rmSync(nsis, { recursive: true, force: true });
  fs.renameSync(path.join(tools, 'nsis-3.11'), nsis);
  const plugins = path.join(nsis, 'Plugins/x86-unicode/additional');
  fs.mkdirSync(plugins, { recursive: true });
  fs.copyFileSync(plugin, path.join(plugins, 'nsis_tauri_utils.dll'));
}

module.exports = { prepareInstallerTools };
