// 在 Windows CI 中用安装包自带运行时验证 CLI/MCP，不能借用构建机 Node。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32')
  throw new Error('Run the packaged Windows Agent check on Windows');
const app = path.resolve(process.argv[2]);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-packaged-agent-'));
try {
  for (const file of [
    'brevia.cmd',
    'resources/control/brevia.cjs',
    'resources/skills/brevia/SKILL.md',
  ])
    assert.ok(fs.existsSync(path.join(app, file)), file);
  const request = (args, input) => {
    const result = spawnSync(
      path.join(app, 'Brevia.exe'),
      [path.join(app, 'resources/control/brevia.cjs'), ...args],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BREVIA_DATA_DIR: scratch },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        input,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim().split('\n').map(JSON.parse);
  };
  assert.deepEqual(request(['status', '--no-start']), [
    { ok: true, result: { running: false, ready: false } },
  ]);
  const messages = request(
    ['mcp', '--no-start'],
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]
      .map((value) => JSON.stringify(value) + '\n')
      .join(''),
  );
  assert.equal(messages.length, 2);
  assert.ok(messages[1].result.tools.some((tool) => tool.name === 'inference_run'));
  assert.deepEqual(fs.readdirSync(scratch), []);
  console.log('Packaged Windows Agent: CLI, MCP, Skill and side-effect-free status passed.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
