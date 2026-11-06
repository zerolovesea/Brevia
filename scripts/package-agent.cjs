// Windows CLI 复用安装包的 Electron Node 运行时，不依赖系统 Node 或单独 Worker。
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
async function packageAgent(destination = path.join(root, 'dist/agent')) {
  fs.mkdirSync(destination, { recursive: true });
  await build({
    bundle: true,
    platform: 'node',
    target: 'node22',
    absWorkingDir: root,
    entryPoints: ['scripts/brevia.cjs'],
    outfile: path.join(destination, 'brevia.cjs'),
  });
  fs.writeFileSync(
    path.join(destination, 'brevia.cmd'),
    [
      '@echo off',
      'setlocal',
      'set "ELECTRON_RUN_AS_NODE=1"',
      '"%~dp0Brevia.exe" "%~dp0resources\\control\\brevia.cjs" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'),
  );
}
if (require.main === module)
  packageAgent().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { packageAgent };
