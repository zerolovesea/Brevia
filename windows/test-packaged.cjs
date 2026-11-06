const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EngineClient } = require('../macos/backend/engine.cjs');
const { wavInfo } = require('../macos/backend/audio-io.cjs');
const app = path.resolve(process.argv[2] || 'dist/native-win/app');
const resources = path.join(app, 'resources');
const node = path.join(resources, 'control/node.exe');
function run(file, args) {
  const r = spawnSync(file, args, { stdio: 'inherit', timeout: 240000, windowsHide: true });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, file + ' ' + args.join(' '));
}
async function main() {
  assert.equal(process.platform, 'win32');
  if (path.resolve(process.execPath).toLowerCase() !== node.toLowerCase()) {
    run(node, [__filename, app]);
    return;
  }
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.ok(
        !/^(?:python|ffmpeg|electron)|\.py[co]?$|\.whl$|app\.asar$|chrome_elf\.dll$/i.test(
          entry.name,
        ),
        'Unexpected runtime: ' + file,
      );
      if (entry.isDirectory()) inspect(file);
    }
  }
  inspect(app);
  for (const file of [
    'Brevia.exe',
    'brevia.cmd',
    'resources/control/control.cjs',
    'resources/control/worker.cjs',
    'resources/control/brevia-audio.exe',
    'resources/engines/brevia-inference.exe',
  ])
    assert.ok(fs.existsSync(path.join(app, file)), file);
  run(node, ['scripts/test-packaged-agent.cjs', app]);
  run(node, ['macos/test-packaged-control.cjs', app]);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-win-engine-'));
  const engine = new EngineClient(path.join(resources, 'engines/brevia-inference.exe'));
  try {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(resources, 'backend/models.json'), 'utf8'),
    );
    const vad = catalog.find((m) => m.id === 'silero-vad');
    await engine.request('vad.load', {
      path: path.join(
        resources,
        'backend/bundled-models',
        vad.id + '-' + vad.revision.replaceAll('/', '-'),
        vad.files[0],
      ),
    });
    const silence = Buffer.alloc(32000).toString('base64');
    assert.deepEqual(await engine.request('vad.feed', { pcm: silence }), []);
    assert.deepEqual(await engine.request('vad.flush', {}), []);
    await assert.rejects(engine.request('vad.feed', { pcm: silence }), /Reset VAD/);
    await engine.request('vad.reset', {});
    const output = path.join(scratch, '解码.wav');
    await engine.request('audio.decode', {
      source: path.join(resources, 'backend/fixtures/example-zh.wav'),
      destination: output,
      sample_rate: 16000,
      channels: 1,
    });
    const info = wavInfo(output);
    assert.equal(info.sampleRate, 16000);
    assert.equal(info.channels, 1);
    assert.ok(info.frames > 16000);
    await assert.rejects(
      engine.request('audio.decode', { source: output, destination: output }),
      /preserved/,
    );
    const audio = spawnSync(path.join(resources, 'control/brevia-audio.exe'), ['permissions'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    assert.equal(audio.status, 0, audio.stderr);
    assert.equal(JSON.parse(audio.stdout).systemAudioSupported, true);
  } finally {
    engine.close();
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  console.log(
    'Packaged Windows: bundled Node, IPC, recording flush, native VAD/decoder, permissions, CLI and MCP passed.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
