import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { configureMacUpdater, createDisplayMediaHandler, isNewerVersion, registerScreenPermission, systemAudioSupported } = require('./main-logic');

const screen = { id: 'screen:0:0' };
let selected;
await createDisplayMediaHandler({ getSources: async () => [screen] }, assert.fail)(null, (value) => { selected = value; });
assert.deepEqual(selected, { video: screen, audio: 'loopback' });

let logged;
await createDisplayMediaHandler({ getSources: async () => { throw new Error('denied'); } }, (...value) => { logged = value; })(null, (value) => { selected = value; });
assert.deepEqual(selected, {});
assert.equal(logged[0], 'ERROR');
assert.equal(logged[1].message, 'denied');

let permissionRequest;
await registerScreenPermission({ getSources: async (options) => { permissionRequest = options; } }, assert.fail);
assert.deepEqual(permissionRequest, { types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
await registerScreenPermission({ getSources: async () => { throw new Error('not listed'); } }, (...value) => { logged = value; });
assert.deepEqual(logged, ['WARNING', 'screen permission registration: not listed']);

const updater = { setFeedURL(value) { this.feed = value; } };
configureMacUpdater(updater);
assert.equal(updater.autoDownload, false);
assert.deepEqual(updater.feed, { provider: 'github', owner: 'zerolovesea', repo: 'Brevia' });

assert.equal(systemAudioSupported('darwin', '21.6.0'), false);
assert.equal(systemAudioSupported('darwin', '22.0.0'), true);
assert.equal(systemAudioSupported('win32', '0'), true);
assert.equal(systemAudioSupported('linux', '6.0.0'), false);
assert.equal(isNewerVersion('v1.0.6', '1.0.5'), true);
assert.equal(isNewerVersion('1.0.5', '1.0.5'), false);
assert.equal(isNewerVersion('1.0.4', '1.0.5'), false);

console.log('Electron behavior tests passed');
