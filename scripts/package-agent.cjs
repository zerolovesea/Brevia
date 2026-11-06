// CLI 使用随安装包提供的 Node，不依赖系统环境。
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
      '"%~dp0resources\\control\\node.exe" "%~dp0resources\\control\\brevia.cjs" %*',
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
