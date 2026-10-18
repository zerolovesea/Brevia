// CUDA DLL 超出单文件 NSIS 的内存映射上限；同目录数据包仍可用于离线安装。
const { build, version } = require('./package.json');

module.exports = {
  ...build,
  win: {
    ...build.win,
    target: [{ target: 'nsis-web', arch: ['x64'] }],
    artifactName: 'Brevia-${version}-x64-cuda-setup.${ext}',
  },
  nsisWeb: {
    appPackageUrl: `https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/brevia-${version}-x64.nsis.7z`,
  },
  extraMetadata: { breviaRuntime: 'cuda' },
  generateUpdatesFilesForAllChannels: false,
  publish: build.publish.map((provider) => ({ ...provider, channel: 'cuda' })),
};
