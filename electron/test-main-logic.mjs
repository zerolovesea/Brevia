import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

// 纪要配置只认 version 2：旧的 {models, active, sequence} 结构不再迁移，一律当作未配置。
const { z } = require('zod');
const mainSource = (await readFile(new URL('./main.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
assert.match(mainSource, /process\.platform === 'win32'\) Menu\.setApplicationMenu\(null\)/);
const oneLine = (decl) => { const start = mainSource.indexOf(decl); return mainSource.slice(start, mainSource.indexOf('\n', start) + 1); };
const schemaBlock = (decl) => { const start = mainSource.indexOf(decl); return mainSource.slice(start, mainSource.indexOf('\n});', start) + 5); };
const asyncFn = (name) => { const start = mainSource.indexOf(`async function ${name}(`); return mainSource.slice(start, mainSource.indexOf('\n}\n', start) + 2); };

const configDir = await mkdtemp(path.join(tmpdir(), 'brevia-summary-config-'));
const configFile = path.join(configDir, 'summary-models.json');
const configContext = { z, readFile, summaryConfigPath: () => configFile };
runInNewContext([
  oneLine('const summaryProviderIds = '),
  schemaBlock('const summaryProviderEntry = '),
  schemaBlock('const summaryConfig = '),
  asyncFn('readSummaryConfig'),
  'this.readSummaryConfig = readSummaryConfig;',
].join('\n'), configContext);
const readConfig = configContext.readSummaryConfig;
const writeConfig = (value) => writeFile(configFile, typeof value === 'string' ? value : JSON.stringify(value));

assert.equal(await readConfig(), null, 'a missing file reads as unconfigured');
const storedConfig = { version: 2, provider: 'custom-claude', providers: { 'custom-claude': { model: 'x', endpoint: 'https://example.com/v1', keyReference: 'summary-1', keyLength: 8 } } };
await writeConfig(storedConfig);
assert.deepEqual(await readConfig(), storedConfig, 'a valid version 2 config survives a round trip');
await writeConfig({ models: [{ name: '配置-1', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', format: 'openai', model: 'gpt-4.1-mini', keyReference: 'summary-1' }], active: 0, sequence: 1 });
assert.equal(await readConfig(), null, 'the pre-1.0.8 multi-config structure is not migrated');
await writeConfig({ version: 1, provider: 'openai', providers: {} });
assert.equal(await readConfig(), null, 'version 1 is rejected');
await writeConfig('{ not json');
assert.equal(await readConfig(), null, 'a corrupt file reads as unconfigured instead of throwing');
await writeConfig({ version: 2, provider: 'ollama', providers: {} });
assert.equal(await readConfig(), null, 'a removed provider id is rejected');
await writeConfig({ version: 2, provider: 'built-in', providers: {} });
assert.deepEqual(await readConfig(), { version: 2, provider: 'built-in', providers: {} }, 'built-in needs no provider entry');
await rm(configDir, { recursive: true, force: true });

console.log('Electron behavior tests passed');
