// 主窗口和手机服务沿用同一组业务处理器；stdout 专供宿主 JSONL。
const path = require('node:path');
process.resourcesPath = process.env.BREVIA_RESOURCES || path.dirname(__dirname);
console.log = console.error;
const desktop = require('./electron-compat.cjs');
desktop.listen();
require('../electron/main.js');
