import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const permissionSource = app.slice(
  app.indexOf('let screenProbe ='),
  app.indexOf('const modelDownloads ='),
);
const permissionRequests = new Set();
let requested = [];
const notices = [];
const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const context = {
  localStorage,
  window: {
    brevia: {
      platform: 'darwin',
      nativeAudio: true,
      permissions: {
        requestScreen: async () => {
          requested.push('screen');
          return true;
        },
        requestMicrophone: async () => {
          requested.push('microphone');
          return true;
        },
      },
    },
  },
  t: (value) => value,
  interfaceIcon: () => '',
  escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
  permissionRequests,
  showToast: (message) => notices.push(message),
  permissionStatus: { microphone: 'denied', screen: 'denied', systemAudioSupported: true },
};
runInNewContext(permissionSource, context);

const screenRow = context.permissionRow('screen', '屏幕与系统音频', '', false, true, false, false);
assert.match(screenRow, /data-request-permission="screen"/);
assert.match(screenRow, /data-open-permission-settings="screen"/);
assert.match(screenRow, /隐私与安全性 → 屏幕与系统音频录制/);
permissionRequests.add('screen');
assert.match(
  context.permissionRow('screen', '', '', false, true, false, false),
  /data-request-permission="screen"[^>]*disabled aria-busy="true"/,
);
permissionRequests.clear();
assert.doesNotMatch(
  context.permissionRow('screen', '', '', true, false, false, false),
  /data-request-permission|data-open-permission-settings/,
);
assert.doesNotMatch(
  context.permissionRow('screen', '', '', false, false, false, true),
  /data-request-permission|data-open-permission-settings/,
);
assert.doesNotMatch(
  context.permissionRow('microphone', '', '', false, true, false, false),
  /data-request-permission/,
  'macOS cannot re-prompt a denied microphone permission',
);
assert.match(context.renderPermissionSettings(), /data-request-permission="screen"/);
context.permissionStatus = {};
assert.doesNotMatch(
  context.renderPermissionSettings(),
  /不可用/,
  'unknown status is not unsupported',
);

await context.requestPermissionAccess('screen');
await context.requestPermissionAccess('microphone');
assert.deepEqual(
  requested,
  ['screen', 'microphone'],
  'native access does not open a web microphone',
);
context.window.brevia.permissions.requestScreen = async () => false;
await assert.rejects(
  context.requestPermissionAccess('screen'),
  /隐私与安全性 → 屏幕与系统音频录制/,
);

// Tap 权限无法被动查询；请求已发起不代表允许，更不能把静音当作拒绝。
context.permissionStatus = {
  microphone: 'granted',
  screen: 'unknown',
  systemAudioCapture: 'core-audio-tap',
  systemAudioSupported: true,
};
assert.match(context.permissionSettingsPath('screen'), /仅系统音频录制/);
const audioOnlyRow = context.permissionRow(
  'screen',
  '系统音频',
  '',
  false,
  false,
  false,
  false,
  true,
);
assert.match(audioOnlyRow, /录音时确认/);
assert.match(audioOnlyRow, /data-request-permission="screen"/);
assert.doesNotMatch(audioOnlyRow, /已允许|未授权|is-denied/);
assert.match(context.renderPermissionSettings(), /<b>系统音频<\/b>/);
assert.match(context.renderPermissionSettings(), /录音时确认/);
context.window.brevia.permissions.requestScreen = async () => null;
assert.equal(await context.requestPermissionAccess('screen'), null);
assert.deepEqual(notices, ['已发起权限申请']);
assert.match(context.renderPermissionSettings(), /已发起权限申请/);
assert.match(context.renderPermissionSettings(), /重新检测/);
context.window.brevia.permissions.requestScreen = async () => true;
await context.requestPermissionAccess('screen');
assert.match(context.renderPermissionSettings(), /已允许/);
assert.doesNotMatch(
  context.renderPermissionSettings(),
  /重新检测|data-request-permission="screen"/,
);
const restarted = { ...context };
runInNewContext(permissionSource, restarted);
assert.match(restarted.renderPermissionSettings(), /已允许/, 'confirmation survives app restart');
assert.equal(restarted.systemAudioAllowed({ screen: 'denied' }), false);
assert.equal(
  restarted.systemAudioAllowed({ screen: 'unknown', systemAudioCapture: 'screen-capture-kit' }),
  false,
);
restarted.window.brevia.permissions.requestScreen = async () => null;
await restarted.requestPermissionAccess('screen');
assert.match(restarted.renderPermissionSettings(), /data-request-permission="screen"/);
assert.equal(storage.size, 0, 'an inconclusive explicit recheck clears the previous confirmation');

// Polling cannot overlap a system prompt, duplicate itself, or redraw a page after navigation.
const timers = new Map();
let timerId = 0;
let refreshes = 0;
let polls = 0;
let completePoll;
Object.assign(context, {
  activeModal: 'advanced-settings',
  settingsModal: { hidden: false },
  permissionPollTimer: undefined,
  permissionStatus: { screen: 'denied' },
  refreshPermissionSettings: () => {
    refreshes += 1;
  },
});
context.window.setInterval = (callback) => {
  timers.set(++timerId, callback);
  return timerId;
};
context.window.clearInterval = (id) => timers.delete(id);
context.window.brevia.permissions.status = () => {
  polls += 1;
  return new Promise((resolve) => {
    completePoll = resolve;
  });
};
runInNewContext(
  app.slice(
    app.indexOf('function startPermissionPoll('),
    app.indexOf('function refreshPermissionSettings('),
  ),
  context,
);
context.startPermissionPoll();
permissionRequests.add('screen');
await timers.get(timerId)();
assert.equal(polls, 0);
permissionRequests.clear();
const inFlight = timers.get(timerId)();
await timers.get(timerId)();
assert.equal(polls, 1);
context.activeModal = 'general';
completePoll({ screen: 'granted' });
await inFlight;
assert.equal(refreshes, 0, 'a response from the previous page must not update UI');
context.activeModal = 'advanced-settings';
const oldRequest = timers.get(timerId)();
context.startPermissionPoll();
completePoll({ screen: 'granted' });
await oldRequest;
assert.equal(refreshes, 0, 'a superseded poll cannot replace the current status');
const currentRequest = timers.get(timerId)();
completePoll({ screen: 'granted' });
await currentRequest;
assert.equal(refreshes, 1);
console.log('permission UI behavior tests passed');
