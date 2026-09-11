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

module.exports = { configureMacUpdater, createDisplayMediaHandler, isNewerVersion, registerScreenPermission, systemAudioSupported };
