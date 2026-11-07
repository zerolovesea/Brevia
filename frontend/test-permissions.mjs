import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const permissionSource = app.slice(
  app.indexOf('function permissionSettingsPath('),
  app.indexOf('const modelDownloads ='),
);
const permissionRequests = new Set();
let requested = [];
const context = {
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
