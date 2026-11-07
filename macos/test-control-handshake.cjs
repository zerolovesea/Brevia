const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('native startup requires the host handshake and preserves the following command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-host-handshake-'));
  try {
    fs.mkdirSync(path.join(root, 'macos'));
    fs.mkdirSync(path.join(root, 'desktop'));
    const entry = path.join(root, 'macos/control.cjs');
    fs.copyFileSync(path.join(__dirname, 'control.cjs'), entry);
    fs.writeFileSync(
      path.join(root, 'desktop/platform.cjs'),
      `exports.listen = () => require('node:readline').createInterface({input:process.stdin})
        .on('line', line => process.stdout.write(line + '\\n'));`,
    );
    fs.writeFileSync(path.join(root, 'desktop/main.js'), "process.stdout.write('started\\n');");
    const run = (input) =>
      spawnSync(process.execPath, [entry], {
        env: { ...process.env, BREVIA_WAIT_FOR_HOST: '1' },
        input,
        encoding: 'utf8',
        timeout: 5000,
      });
    const valid = run('{"host":"ready"}\n{"id":1,"channel":"desktop.state"}\n');
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout, 'started\n{"id":1,"channel":"desktop.state"}\n');
    for (const input of ['', '{"host":"other"}\n', 'x'.repeat(80)]) {
      const invalid = run(input);
      assert.notEqual(invalid.status, 0);
      assert.equal(invalid.stdout, '');
      assert.match(invalid.stderr, /Native host disconnected|Invalid native host handshake/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('note images keep their bytes across the native JSON bridge and reject malformed input', async () => {
  const { EventEmitter } = require('node:events');
  const { createRequire } = require('node:module');
  const { runInNewContext } = require('node:vm');
  const lines = new EventEmitter();
  const pending = new Map();
  let next = 0;
  const module = { exports: {} };
  const nativeRequire = createRequire(path.join(__dirname, '../desktop/platform.cjs'));
  runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/platform.cjs'), 'utf8'), {
    module,
    require: (name) =>
      name === 'node:readline' ? { createInterface: () => lines } : nativeRequire(name),
    process: {
      ...process,
      stdout: {
        write(line) {
          const message = JSON.parse(line);
          if (message.native)
            queueMicrotask(() =>
              lines.emit('line', JSON.stringify({ native: message.native, result: true })),
            );
          else if (message.id) {
            const reply = pending.get(message.id);
            pending.delete(message.id);
            message.error ? reply.reject(new Error(message.error)) : reply.resolve(message.result);
          }
        },
      },
    },
    console,
    Buffer,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
  });
  const adapter = module.exports;
  adapter.listen();
  const view = new adapter.NativeWindow({});
  await view.loadFile(path.join(__dirname, '../frontend/index.html'));
  adapter.ipcMain.handle('meeting.note-image.save', (_, payload) => {
    assert.ok(payload.bytes instanceof ArrayBuffer);
    return Buffer.from(payload.bytes).toString('base64');
  });
  const request = (payload) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      lines.emit(
        'line',
        JSON.stringify({ id, label: 'main', channel: 'meeting.note-image.save', payload }),
      );
    });
  const window = {
    __BREVIA_PLATFORM__: 'win32',
    __TAURI__: {
      core: { invoke: (_name, value) => request(value.payload) },
      event: { listen: async () => () => {} },
    },
  };
  window.top = window;
  runInNewContext(
    fs
      .readFileSync(path.join(__dirname, 'bridge.js'), 'utf8')
      .replace(
        '/* BREVIA_PRELOAD */',
        fs.readFileSync(path.join(__dirname, '../desktop/preload.js'), 'utf8'),
      ),
    {
      window,
      Element: class {
        checkVisibility() {}
      },
      Uint8Array,
      ArrayBuffer,
      btoa,
    },
  );
  const bytes = Uint8Array.from({ length: 40000 }, (_, i) => i % 256);
  assert.equal(
    await window.brevia.meeting.noteImage.save({ bytes: bytes.buffer }),
    Buffer.from(bytes).toString('base64'),
  );
  await assert.rejects(window.brevia.meeting.noteImage.save({ bytes }), /Invalid note image data/);
  for (const value of [{}, [], '', 'AA==!', 'AA=', 'A'.repeat(13981020)])
    await assert.rejects(request({ bytes: value }), /Invalid note image data/);
  assert.equal(pending.size, 0);
});
