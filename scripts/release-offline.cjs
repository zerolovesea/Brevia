// 在目标平台生成本地安装包；离线发布不访问 Apple 公证服务。
const { spawnSync } = require('node:child_process');
const target = { darwin: 'mac', win32: 'win' }[process.platform];
if (!target) throw new Error('Offline release requires macOS or Windows');
const env = { ...process.env };
for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) delete env[key];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands =
  target === 'mac'
    ? [['run', 'dist:mac']]
    : [
        ['run', 'pack:backend'],
        ['run', 'package:win'],
      ];
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
