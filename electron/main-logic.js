const modelscopeUpdateFeed = Object.freeze({ provider: 'generic', url: 'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master' });

function configureMacUpdater(updater) {
  updater.autoDownload = false;
  updater.setFeedURL(modelscopeUpdateFeed);
}

function createDisplayMediaHandler(desktopCapturer, writeLog) {
  return async (_, callback) => {
    let source;
    try {
      [source] = await desktopCapturer.getSources({ types: ['screen'] });
    } catch (error) {
      writeLog('ERROR', error);
      callback({});
      return;
    }
    if (!source) {
      writeLog('WARNING', 'No screen source available for system audio capture');
      callback({});
      return;
    }
    // Electron may throw while validating this callback.  It was already called,
    // so it must never be retried from a catch block.
    callback({ video: source, audio: 'loopback' });
  };
}

async function registerScreenPermission(desktopCapturer, writeLog) {
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); }
  catch (error) { writeLog('WARNING', `screen permission registration: ${error.message}`); }
}

function systemAudioSupported(platform, kernelRelease) {
  return platform === 'win32' || (platform === 'darwin' && Number.parseInt(kernelRelease, 10) >= 22);
}

const versionParts = (version) => version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);
function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) if (next[index] !== installed[index]) return next[index] > installed[index];
  return false;
}

// ── worker 错误 → 结构化判定 ────────────────────────────────────────────────────
//
// 协议层以前只把异常压成字符串，于是主进程只能**正则解析人类可读的报错**来决定要不要
// 走"先下载再重试"：任何措辞改动都会静默破坏整条下载链路。现在后端把
// `ModelNotInstalled` 序列化成 `error_code` / `error_models`，这里读字段即可。
// 保留一个**语义化**的回退判据（而不是正则）：老 worker 二进制可能只给文本，
// 但那种情况只出现在开发期混用旧 runtime，判定条件写成"文本里出现 not installed"
// 这种宽泛匹配反而会误判，所以宁可不回退——协议两端同版本发布。
function workerError(message) {
  const error = new Error(typeof message.error === 'string' ? message.error : String(message.error));
  if (typeof message.error_code === 'string') error.code = message.error_code;
  if (Array.isArray(message.error_models)) error.models = message.error_models.filter((id) => typeof id === 'string');
  return error;
}

/** 该错误是否表示「模型没装」，是则返回缺失的模型 id 列表，否则返回 null。
 *
 * 只认结构化字段：`error_code === 'model_not_installed'` 且 `error_models` 非空。
 * @param {Error} error 由 workerError 构造（或任意错误）。
 * @returns {string[]|null} 缺失模型 id。
 */
function requiredModelsFrom(error) {
  if (!error || error.code !== 'model_not_installed') return null;
  const models = Array.isArray(error.models) ? error.models : [];
  return models.length ? models : null;
}

module.exports = {
  configureMacUpdater,
  createDisplayMediaHandler,
  isNewerVersion,
  registerScreenPermission,
  requiredModelsFrom,
  systemAudioSupported,
  workerError,
};
