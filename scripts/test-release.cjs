const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const prettier = require('prettier');

const root = path.resolve(__dirname, '..');
test('release links migrate Electron filenames and keep formatting through later native updates', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-release-links-'));
  const formatOptions = await prettier.resolveConfig(path.join(root, 'README.md'));
  try {
    fs.mkdirSync(path.join(scratch, 'docs'));
    fs.mkdirSync(path.join(scratch, 'website'));
    fs.mkdirSync(path.join(scratch, 'dist'));
    const readmes = [
      'README.md',
      ...fs
        .readdirSync(path.join(root, 'docs'))
        .filter((name) => /^README\.[a-z]{2}(?:-[A-Z]{2})?\.md$/.test(name))
        .map((name) => `docs/${name}`),
    ];
    for (const file of [...readmes, 'website/index-zh.html', 'website/index-en.html'])
      fs.copyFileSync(path.join(root, file), path.join(scratch, file));
    for (const version of ['9.8.7', '9.8.8']) {
      fs.writeFileSync(
        path.join(scratch, 'dist', `Brevia-WebKit-${version}-arm64.dmg`),
        Buffer.alloc(100000),
      );
      fs.writeFileSync(
        path.join(scratch, 'dist', `Brevia-${version}-x64-setup.exe`),
        Buffer.alloc(200000),
      );
      const result = spawnSync(
        process.execPath,
        [path.join(root, 'scripts/update-release-links.mjs')],
        {
          cwd: scratch,
          env: { ...process.env, VERSION: `v${version}` },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      for (const file of [...readmes, 'website/index-zh.html', 'website/index-en.html']) {
        const content = fs.readFileSync(path.join(scratch, file), 'utf8');
        assert.ok(content.includes(`Brevia-WebKit-${version}-arm64.dmg`), file);
        assert.ok(content.includes(`Brevia-${version}-x64-setup.exe`), file);
        assert.ok(!content.includes(`Brevia-${version}-arm64.dmg`), file);
        assert.ok(!content.includes('native-release-pending'), file);
        if (file.endsWith('.md'))
          assert.ok(await prettier.check(content, { ...formatOptions, filepath: file }), file);
        else {
          assert.ok(content.includes('data-size="macos">0.1 MB'), file);
          assert.ok(content.includes('data-size="windows">0.2 MB'), file);
        }
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('native notarization rejects failed Apple submissions and staples only accepted artifacts', () => {
  const script = fs.readFileSync(path.join(root, 'macos/runtime/package.cjs'), 'utf8');
  for (const status of ['Accepted', 'Invalid']) {
    const calls = [];
    const module = { exports: {} };
    const context = {
      __dirname: path.join(root, 'macos/runtime'),
      module,
      process: {
        env: {
          BREVIA_SIGN_IDENTITY: 'Developer ID',
          APPLE_ID: 'test',
          APPLE_APP_SPECIFIC_PASSWORD: 'test',
          APPLE_TEAM_ID: 'test',
        },
      },
      require(name) {
        if (name === '../../package.json') return { version: '1.0.0' };
        if (name === 'node:child_process')
          return {
            spawnSync(command, args) {
              calls.push([command, ...args]);
              return { status: 0, stdout: JSON.stringify({ status, id: 'submission' }) };
            },
          };
        if (name === 'node:fs') return { rmSync() {} };
        return require(name);
      },
    };
    runInNewContext(script, context);
    if (status === 'Invalid')
      assert.throws(() => module.exports.notarize('/tmp/Brevia.app'), /Invalid: submission/);
    else module.exports.notarize('/tmp/Brevia.app');
    assert.equal(
      calls.filter((call) => call[1] === 'stapler').length,
      status === 'Accepted' ? 2 : 0,
    );
    assert.equal(calls[0][0], 'ditto');
  }
});
