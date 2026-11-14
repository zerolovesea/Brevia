const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { locations } = require('./agent-service.cjs');
const { scopeFor, failure } = require('./agent-contract.cjs');

function credentials(root, scope) {
  const file = locations(root).credentials;
  const info = fs.lstatSync(file);
  if (!info.isFile() || (process.getuid && (info.uid !== process.getuid() || info.mode & 0o077)))
    throw failure('unsafe_credentials', 'Local credentials must be private to their owner');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 自定义令牌不会回退到更高权限，便于把限权凭据交给外部 Agent。
  return {
    socket: locations(root).socket,
    token: process.env.BREVIA_AGENT_TOKEN || value.tokens[scope],
  };
}
function transport(auth, method, params) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: auth.socket,
        path: '/v1',
        method: 'POST',
        headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (part) => {
          size += part.length;
          if (size > 64 * 1024 * 1024)
            req.destroy(failure('response_too_large', 'Response exceeds 64 MiB'));
          else chunks.push(part);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString());
            if (result.ok) resolve(result.result);
            else reject(Object.assign(new Error(result.error.message), result.error));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    const timeout = method === 'recording.control' && params.action === 'stop' ? 660000 : 240000;
    req.setTimeout(timeout, () =>
      req.destroy(
        failure('timeout', 'Brevia request timed out; retry recording with the same request_id'),
      ),
    );
    req.on('error', reject);
    req.end(JSON.stringify({ method, params }));
  });
}
function launch() {
  let binary = process.env.BREVIA_APP;
  if (!binary) {
    const bundled = path.resolve(__dirname, '../../MacOS/Brevia');
    const candidates =
      process.platform === 'darwin'
        ? [
            bundled,
            '/Applications/Brevia.app/Contents/MacOS/Brevia',
            path.join(os.homedir(), 'Applications/Brevia.app/Contents/MacOS/Brevia'),
          ]
        : process.platform === 'linux'
          ? ['/usr/bin/brevia-desktop']
          : [
              path.resolve(__dirname, '../../Brevia.exe'),
              path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs/Brevia/Brevia.exe'),
              path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Brevia/Brevia.exe'),
            ];
    binary = candidates.find((file) => fs.existsSync(file));
  }
  if (!binary || !path.isAbsolute(binary) || !fs.existsSync(binary))
    throw failure(
      'app_not_found',
      'Install Brevia or set BREVIA_APP to its absolute executable path',
    );
  const env = { ...process.env };
  // 防止从旧版 CLI 启动时继承 Node 模式，影响被选择的历史应用入口。
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, ['--background'], {
    detached: true,
    stdio: 'ignore',
    env,
    windowsHide: true,
  });
  child.unref();
  return new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(child));
    child.once('error', (e) => reject(failure('launch_failed', e.message)));
  });
}
async function call(
  method,
  params = {},
  {
    noStart = false,
    root = process.env.BREVIA_DATA_DIR || path.join(os.homedir(), 'brevia'),
    start = launch,
    timeout = 180000,
  } = {},
) {
  const attempt = () => transport(credentials(root, scopeFor(method)), method, params);
  try {
    return await attempt();
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED', 'not_ready'].includes(error.code)) throw error;
    if (noStart) {
      if (method === 'app.status') return { running: error.code === 'not_ready', ready: false };
      throw failure('not_running', 'Brevia is not ready and automatic startup is disabled');
    }
    let child;
    if (error.code !== 'not_ready') child = await start();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await delay(200);
      try {
        return await attempt();
      } catch (e) {
        if (!['ENOENT', 'ECONNREFUSED', 'not_ready'].includes(e.code)) throw e;
      }
      if (child?.exitCode && child.exitCode !== 0)
        throw failure('launch_failed', 'Brevia exited during startup with code ' + child.exitCode);
      if (child?.signalCode)
        throw failure(
          'launch_failed',
          'Brevia was terminated during startup by ' + child.signalCode,
        );
    }
    throw failure(
      'startup_timeout',
      'Brevia did not become ready; check application logs, data lock and model storage',
    );
  }
}
module.exports = { call, transport, credentials, launch };
