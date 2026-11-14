// 在目标平台生成本地安装包；离线发布不访问 Apple 公证服务。
const { spawnSync } = require('node:child_process');
const target = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
if (!target) throw new Error('Offline release requires macOS, Windows or Linux');
const env = { ...process.env };
for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) delete env[key];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands =
  target === 'linux'
    ? ['cpu', 'cuda'].map((backend) => ['run', 'dist:linux', '--', backend])
    : [['run', 'dist:' + target]];
for (const args of commands) {
  const result = spawnSync(npm, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
