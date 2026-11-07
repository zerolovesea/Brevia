// 主窗口和手机服务沿用同一组业务处理器；stdout 专供宿主 JSONL。
const path = require('node:path');
if (process.env.BREVIA_WAIT_FOR_HOST === '1') {
  // Windows 宿主先把控制进程加入 Job，再允许它派生录音与推理进程。
  const { readSync } = require('node:fs');
  const byte = Buffer.alloc(1);
  let ready = '';
  while (ready.length < 64 && !ready.endsWith('\n')) {
    if (readSync(0, byte, 0, 1, null) !== 1) throw new Error('Native host disconnected');
    ready += byte.toString('ascii');
  }
  if (ready !== '{"host":"ready"}\n') throw new Error('Invalid native host handshake');
}
process.resourcesPath = process.env.BREVIA_RESOURCES || path.dirname(__dirname);
console.log = console.error;
const desktop = require('../desktop/platform.cjs');
desktop.listen();
require('../desktop/main.js');
