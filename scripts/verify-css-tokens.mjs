/**
 * 计算样式指纹（人工回归工具，**不是**自动门禁）。
 *
 * 为什么存在：`tailwind.css` 里做过大范围颜色重构（令牌化、删暗色覆盖）时，
 * 源码 diff 和现有测试都看不出「某个元素在两个主题下的实际颜色变了没有」。
 * 这个工具启动真实 Electron 应用，用 CDP 把**所有元素**的颜色类计算样式抓下来，
 * 跑两次（改动前 / 改动后）直接 diff，把「零视觉变化」变成可核对的证据。
 *
 * 用法：
 *   node scripts/verify-css-tokens.mjs before.json
 *   # 改动 tailwind.css 后执行 npm run build
 *   node scripts/verify-css-tokens.mjs after.json
 *   node scripts/verify-css-tokens.mjs --diff before.json after.json
 *
 * 重要：运行间存在**已知噪声**——引导页的入场动画和语言轮的滚动会让若干按钮的
 * `is-active`/`is-scrolling` 状态在两次运行间不同，表现为固定几个按钮的颜色
 * 计数漂移（例如浅色下 rgb(38,34,30) 7→3、rgb(139,133,126) 38→42）。
 * 先用同一份 CSS 跑两次建立噪声基线，再拿改动后的结果与之比较；
 * 只有**超出噪声基线**的差异才是真回归。`--diff` 会把差异按元素分组输出。
 *
 * 需要 GUI 环境；不加新依赖（Node 内置 fetch/WebSocket + 已安装的 electron）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const COLOUR_PROPS = [
  'color', 'background-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color',
  'text-decoration-color', 'accent-color',
];

/** 把两份指纹按 (标签, id) 分组、忽略瞬时 class 后比较，返回每个主题的差异元素组。 */
function diff(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const [tag, , id, ...colours] = row.split('|');
      const key = `${tag}#${id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(colours.join('|'));
    }
    for (const values of map.values()) values.sort();
    return map;
  };
  let clean = true;
  for (const theme of ['light', 'dark']) {
    const a = group(before[theme] || []);
    const b = group(after[theme] || []);
    const keys = new Set([...a.keys(), ...b.keys()]);
    const changed = [...keys].filter((key) => JSON.stringify(a.get(key)) !== JSON.stringify(b.get(key)));
    console.log(`${theme}: ${a.size} -> ${b.size} 个元素组，差异 ${changed.length}`);
    for (const key of changed.sort()) {
      clean = false;
      console.log(`  * ${key}`);
      for (const value of a.get(key) || []) if (!(b.get(key) || []).includes(value)) console.log(`      only before: ${value}`);
      for (const value of b.get(key) || []) if (!(a.get(key) || []).includes(value)) console.log(`      only after:  ${value}`);
    }
  }
  console.log(clean
    ? '\n两组指纹在计算样式层面一致。'
    : '\n存在差异：先确认它是否落在运行间噪声基线内（见文件头说明），再判断是否为真回归。');
}

if (args[0] === '--diff') {
  diff(args[1], args[2]);
  process.exit(0);
}

const output = args[0];
if (!output) {
  console.error('用法：node scripts/verify-css-tokens.mjs <out.json> | --diff <before.json> <after.json>');
  process.exit(2);
}
const scratch = path.join(root, '.css-fingerprint-tmp');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(path.join(scratch, 'data'), { recursive: true });
mkdirSync(path.join(scratch, 'userdata'), { recursive: true });

const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => { const { port: p } = server.address(); server.close(() => resolve(p)); });
});
// 与 electron/test-e2e.mjs 同样的约束：临时目录必须在工作区内，Chromium 才写得进
// user-data-dir；--no-sandbox 让 Electron 子进程能在这个沙箱下启动。
const child = spawn(path.join(root, 'node_modules', '.bin', 'electron'), [
  '.', '--no-sandbox', `--user-data-dir=${path.join(scratch, 'userdata')}`, `--remote-debugging-port=${port}`,
], { cwd: root, env: { ...process.env, BREVIA_DATA_DIR: path.join(scratch, 'data') }, stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出。 */ } };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let socketUrl = null;
for (let attempt = 0; attempt < 200 && !socketUrl; attempt += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socketUrl = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? null;
  } catch { /* 调试端口还没起来。 */ }
  if (!socketUrl) await delay(150);
}
if (!socketUrl) {
  stop();
  console.error('✗ 未能连上渲染进程（需要 GUI 环境）。');
  process.exit(1);
}

const socket = new WebSocket(socketUrl);
const pending = new Map();
let nextId = 1;
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result); pending.delete(message.id); }
});
await new Promise((resolve) => socket.addEventListener('open', resolve));
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId += 1;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
for (let attempt = 0; attempt < 60; attempt += 1) {
  const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  if (state.result?.value === 'complete') break;
  await delay(200);
}
await delay(1500); // 等引导页入场动画稳定，缩小运行间噪声。

const probe = (theme) => `(() => {
  document.documentElement.setAttribute('data-theme', '${theme}');
  const props = ${JSON.stringify(COLOUR_PROPS)};
  const rows = [];
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    rows.push([element.tagName, (typeof element.className === 'string' ? element.className : '').trim().slice(0, 80), element.id,
      ...props.map((property) => style.getPropertyValue(property))].join('|'));
  }
  return rows.sort();
})()`;

const fingerprint = {};
for (const theme of ['light', 'dark']) {
  fingerprint[theme] = (await send('Runtime.evaluate', { expression: probe(theme), returnByValue: true })).result.value;
}
writeFileSync(output, JSON.stringify(fingerprint));
console.log(`${output}: light ${fingerprint.light.length} 行 / dark ${fingerprint.dark.length} 行`);
socket.close();
stop();
await delay(300);
rmSync(scratch, { recursive: true, force: true });
process.exit(0);
