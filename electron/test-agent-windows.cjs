const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { packageAgent } = require('../scripts/package-agent.cjs');

test('Windows installed CLI starts its own application outside Electron Node mode', async () => {
  const module = { exports: {} };
  const env = { ELECTRON_RUN_AS_NODE: '1', BREVIA_DATA_DIR: 'C:\\Users\\me\\brevia' };
  let command, options;
  runInNewContext(fs.readFileSync(require.resolve('./agent-client.cjs'), 'utf8'), {
    __dirname: 'D:\\Custom Apps\\Brevia\\resources\\control',
    module,
    process: { platform: 'win32', env },
    require(name) {
      if (name === 'node:path') return path.win32;
      if (name === 'node:fs')
        return { existsSync: (file) => file === 'D:\\Custom Apps\\Brevia\\Brevia.exe' };
      if (name === 'node:os') return { homedir: () => 'C:\\Users\\me' };
      if (name === 'node:child_process')
        return {
          spawn(binary, args, opts) {
            command = binary;
            options = opts;
            assert.deepEqual(Array.from(args), ['--background']);
            const child = new EventEmitter();
            child.unref = () => {};
            setImmediate(() => child.emit('spawn'));
            return child;
          },
        };
      return require(name);
    },
  });
  await module.exports.launch();
  assert.equal(command, 'D:\\Custom Apps\\Brevia\\Brevia.exe');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(options.env.BREVIA_DATA_DIR, env.BREVIA_DATA_DIR);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(options.windowsHide, true);
});

test('Windows CLI distribution is standalone and needs no installed Node packages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-cli-dist-'));
  try {
    await packageAgent(root);
    const script = fs.readFileSync(path.join(root, 'brevia.cmd'), 'utf8');
    assert.ok(
      script.includes(
        '"%~dp0resources\\control\\node.exe" "%~dp0resources\\control\\brevia.cjs" %*',
      ),
    );
    assert.ok(script.includes('exit /b %ERRORLEVEL%'));
    const data = path.join(root, 'data');
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'brevia.cjs'), 'status', '--no-start'],
      {
        env: { ...process.env, BREVIA_DATA_DIR: data },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      result: { running: false, ready: false },
    });
    assert.equal(fs.existsSync(data), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  'Windows credentials inherit only the current user ACL',
  { skip: process.platform !== 'win32' },
  async () => {
    const { AgentService, locations } = require('./agent-service.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-windows-acl-'));
    const service = new AgentService({ root });
    try {
      await service.listen();
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `
      $ErrorActionPreference = 'Stop'
      $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $acl = Get-Acl -LiteralPath $env:BREVIA_AGENT_CREDENTIALS
      $directory = Get-Acl -LiteralPath (Split-Path -LiteralPath $env:BREVIA_AGENT_CREDENTIALS)
      ConvertTo-Json -Compress -InputObject @{ sid=$sid; protected=$directory.AreAccessRulesProtected; rules=@($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }) }
    `,
        ],
        {
          env: { ...process.env, BREVIA_AGENT_CREDENTIALS: locations(root).credentials },
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const acl = JSON.parse(result.stdout);
      assert.equal(acl.protected, true);
      assert.deepEqual(acl.rules, [acl.sid]);
    } finally {
      await service.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
