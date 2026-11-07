// 成品 CLI 自动唤起真实宿主；使用临时库，不访问麦克风或用户会议。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const run = promisify(execFile);
async function main() {
  const bundle = path.resolve(process.argv[2] || 'dist/native/image/Brevia.app');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-cli-'));
  const launcher = path.join(root, 'launch');
  const pidFile = path.join(root, 'pid');
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nprintf '%s' "$$" > ${quote(pidFile)}\nexec ${quote(path.join(bundle, 'Contents/MacOS/Brevia'))} "$@"\n`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    BREVIA_DATA_DIR: root,
    BREVIA_MODELS_DIR: path.join(root, 'models'),
    BREVIA_MOBILE_PORT: '0',
    BREVIA_APP: launcher,
  };
  const cli = path.join(bundle, 'Contents/Resources/control/brevia');
  async function call(method, payload, noStart = false) {
    const { stdout } = await run(
      cli,
      [method, ...(payload ? [JSON.stringify(payload)] : []), ...(noStart ? ['--no-start'] : [])],
      { env, timeout: 200000, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout).result;
  }
  try {
    assert.deepEqual(await call('status', null, true), { running: false, ready: false });
    assert.ok(!fs.existsSync(pidFile));
    assert.equal((await call('status')).ready, true);
    const pid = fs.readFileSync(pidFile, 'utf8');
    assert.equal((await call('status')).ready, true);
    assert.equal(fs.readFileSync(pidFile, 'utf8'), pid, 'ready application must be reused');
    assert.ok((await call('models.list')).length);
    const job = await call('inference.run', {
      operation: 'translate',
      text: 'hello',
      target_language: 'zh',
      output_path: path.join(root, 'result.txt'),
    });
    let result;
    for (let i = 0; i < 100; i++) {
      result = await call('task.get', { task_id: job.task_id });
      if (result.status === 'failed') break;
      await delay(50);
    }
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'model_not_installed');
    assert.equal(fs.existsSync(path.join(root, 'result.txt')), false);
    console.log(
      'Packaged Agent: no-start, background auto-start, instance reuse, authenticated status and missing-model task passed.',
    );
  } finally {
    if (fs.existsSync(pidFile)) {
      try {
        process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await delay(500);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
