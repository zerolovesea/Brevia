const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { wavInfo: readInfo, wavHeader, streamCopyWav } = require('./store-audio.cjs');
const run = promisify(execFile);
const wavInfo = (file) => {
  const value = readInfo(file);
  return { ...value, samples: value.frames };
};
async function convertToPCM(
  source,
  destination,
  sampleRate = 16000,
  channels = 1,
  engine = null,
  { signal } = {},
) {
  try {
    if (process.platform !== 'darwin') throw new Error('Use the native audio decoder');
    await run(
      '/usr/bin/afconvert',
      ['-f', 'WAVE', '-d', 'LEI16@' + sampleRate, '-c', String(channels), source, destination],
      { timeout: 3600000, maxBuffer: 1024 * 1024, signal },
    );
  } catch (error) {
    if (signal?.aborted || !engine) throw error;
    await engine.request(
      'audio.decode',
      { source, destination, sample_rate: sampleRate, channels },
      { timeout: 3600000, signal },
    );
  }
  return { path: destination };
}
module.exports = { convertToPCM, wavInfo, wavHeader, streamCopyWav };
