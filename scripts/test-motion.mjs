import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const handlers = new Map();
const preference = {
  matches: false,
  addEventListener: (name, fn) => handlers.set(`media:${name}`, fn),
};
const attributes = new Map();
const document = {
  hidden: false,
  documentElement: { toggleAttribute: (name, value) => attributes.set(name, value) },
  addEventListener: (name, fn) => handlers.set(name, fn),
};
const context = {
  matchMedia: () => preference,
  document,
  window: { addEventListener: (name, fn) => handlers.set(name, fn) },
};
runInNewContext(readFileSync(new URL('../frontend/motion.js', import.meta.url), 'utf8'), context);
const motion = context.window.BreviaMotion;
const animations = [];
const element = {
  animate(frames, options) {
    let finish, reject;
    const animation = {
      frames,
      options,
      cancelled: false,
      finished: new Promise((resolve, fail) => {
        finish = resolve;
        reject = fail;
      }),
      cancel() {
        this.cancelled = true;
        reject(new Error('cancelled'));
      },
      finish() {
        this.finishedAtEnd = true;
        finish();
      },
    };
    animations.push(animation);
    return animation;
  },
};
motion.enter(element, 'forward');
assert.equal(animations.at(-1).options.duration, 280);
assert.equal(animations.at(-1).frames[0].transform, 'translateX(24px)');
assert.equal(animations.at(-1).frames[0].opacity, 1, 'page navigation never starts blank');
motion.enter(element, 'back');
assert.equal(animations[0].cancelled, true, 'replacement cancels the previous animation');
assert.equal(animations.at(-1).options.duration, 180);
assert.equal(animations.at(-1).frames[0].transform, 'translateX(-24px)');
const beforeSibling = animations.length;
motion.enter(element, 'sibling');
assert.equal(
  animations.length,
  beforeSibling,
  'same-level navigation never re-fades readable content',
);
motion.enter(element);
assert.ok(animations.at(-1).frames[0].opacity > 0, 'local feedback remains readable');
motion.enter(element, 'tab');
assert.equal(animations.at(-1).options.duration, 180);
assert.equal(animations.at(-1).frames[0].transform, 'translateY(6px)');
assert.ok(
  animations.at(-1).frames.every((frame) => frame.opacity === 1),
  'detail tabs never fade to blank',
);
motion.enter(element, 'settings');
assert.equal(animations.at(-1).options.duration, 180);
assert.equal(animations.at(-1).options.easing, 'ease-out');
assert.equal(animations.at(-1).frames[0].transform, 'translateY(8px)');
assert.equal(animations.at(-1).frames[0].opacity, 0);
assert.equal(animations.at(-1).frames.at(-1).opacity, 1);
const settingsEntry = animations.at(-1);
motion.enter(element, 'step-forward');
assert.equal(settingsEntry.cancelled, true, 'a new step interrupts settings entry');
assert.equal(animations.at(-1).options.duration, 280);
assert.equal(animations.at(-1).options.easing, 'cubic-bezier(0.32, 0.72, 0.24, 1)');
assert.equal(animations.at(-1).frames[0].transform, 'translateX(40px)');
assert.equal(animations.at(-1).frames[0].opacity, 0);
const forwardStep = animations.at(-1);
motion.enter(element, 'step-back');
assert.equal(forwardStep.cancelled, true, 'back interrupts an unfinished forward step');
assert.equal(animations.at(-1).options.duration, 280);
assert.equal(animations.at(-1).frames[0].transform, 'translateX(-40px)');
assert.equal(animations.at(-1).frames.at(-1).transform, 'translateX(0)');
const backwardStep = animations.at(-1);
motion.cancel(element);
assert.equal(backwardStep.cancelled, true, 'explicit cancellation retires a step');
motion.enter(element, 'press');
assert.equal(animations.at(-1).frames[1].scale, 1.004);
handlers.get('pointerdown')({ target: { parentElement: element } });
assert.equal(animations.at(-1).cancelled, true, 'new input interrupts visual settling');
motion.enter(element, 'attention');
assert.equal(animations.at(-1).options.duration, 1120);
preference.matches = true;
handlers.get('media:change')();
assert.equal(
  animations.at(-1).finishedAtEnd,
  true,
  'live preference change settles spatial effects',
);
const count = animations.length;
motion.enter(element, 'forward');
for (const kind of ['settings', 'step-forward', 'step-back']) motion.enter(element, kind);
assert.equal(animations.length, count);
assert.equal(motion.duration('exit'), 0);
preference.matches = false;
assert.equal(motion.duration('exit'), 140);
document.hidden = true;
motion.enter(element);
for (const kind of ['settings', 'step-forward', 'step-back']) motion.enter(element, kind);
assert.equal(animations.length, count, 'hidden windows do not run motion');
document.hidden = false;
motion.enter(element);
handlers.get('visibilitychange')();
assert.equal(animations.at(-1).cancelled, false);
document.hidden = true;
handlers.get('visibilitychange')();
assert.equal(animations.at(-1).finishedAtEnd, true);
document.hidden = false;
let closed = 0;
motion.leave(element, () => closed++);
const closing = animations.at(-1);
motion.enter(element);
closing.finish();
await Promise.resolve();
assert.equal(closed, 0, 'reopening cancels an obsolete close callback');
motion.leave(element, () => closed++);
handlers.get('pagehide')();
await Promise.resolve();
assert.equal(closed, 1, 'hidden-window cleanup completes pending exits');
await Promise.resolve();
handlers.get('keydown')({ key: 'Tab' });
assert.equal(attributes.get('data-keyboard-navigation'), true);
handlers.get('pointerdown')({ target: {} });
assert.equal(attributes.get('data-keyboard-navigation'), false);
handlers.get('keydown')({ key: 'ArrowLeft', metaKey: true });
assert.equal(attributes.get('data-keyboard-navigation'), false);
const page = { ...element };
const home = { ...element };
const sidebar = { ...element };
const shell = { querySelector: (selector) => (selector === '#home-view' ? home : sidebar) };
const welcome = motion.welcome(page, shell);
const entrance = animations.slice(-3);
assert.deepEqual(
  entrance.map((animation) => animation.options.duration),
  [260, 520, 420],
);
assert.equal(entrance[1].frames[0].opacity, 1, 'first home remains opaque during handoff');
handlers.get('pointerdown')({ target: {} });
await welcome;
assert.ok(
  entrance.every((animation) => animation.finishedAtEnd),
  'first input settles the entire welcome',
);
await Promise.resolve();
preference.matches = true;
const beforeReducedWelcome = animations.length;
await motion.welcome(page, shell);
assert.equal(
  animations.length,
  beforeReducedWelcome,
  'reduced motion skips first entry choreography',
);
preference.matches = false;
// 手机轮询会重复渲染同一阶段，只检查真实换步是否触发动效，避免刷新重播。
const mobileSource = readFileSync(
  new URL('../frontend/mobile-connection.js', import.meta.url),
  'utf8',
);
const mobileRenderStart = mobileSource.indexOf('  function renderMobilePage(');
const mobilePanels = ['intro', 'install', 'pair', 'paired'].map((state) => ({
  dataset: { mobilePanel: state },
}));
const mobileSurface = { ...element };
const mobileInstall = {};
const mobileTrusted = {};
let mobileVisible = true;
const mobileDialog = {
  dataset: {},
  checkVisibility: () => mobileVisible,
  querySelector: (selector) =>
    selector === '.mobile-page-main'
      ? mobileSurface
      : selector === '.mobile-install'
        ? mobileInstall
        : mobileTrusted,
  querySelectorAll: (selector) => (selector === '[data-mobile-panel]' ? mobilePanels : []),
};
const mobileContext = {
  dialog: mobileDialog,
  lastStatus: { devices: [] },
  mobilePageStep: null,
  BreviaMotion: motion,
};
runInNewContext(
  mobileSource.slice(mobileRenderStart, mobileSource.indexOf('\n  }\n', mobileRenderStart) + 4),
  mobileContext,
);
const beforeMobile = animations.length;
mobileContext.renderMobilePage();
assert.equal(animations.length, beforeMobile, 'initial mobile status does not replay entry');
mobileContext.mobilePageStep = 'install';
mobileContext.renderMobilePage();
assert.equal(animations.length, beforeMobile + 1);
assert.equal(animations.at(-1).frames[0].transform, 'translateX(40px)');
const installEntry = animations.at(-1);
mobileContext.renderMobilePage();
mobileContext.renderMobilePage({ devices: [] });
assert.equal(animations.length, beforeMobile + 1, 'polling and relocalization keep the step still');
assert.equal(installEntry.cancelled, false, 'same-state refresh leaves entry uninterrupted');
mobileContext.mobilePageStep = 'pair';
mobileContext.renderMobilePage();
assert.equal(installEntry.cancelled, true);
const pairEntry = animations.at(-1);
mobileContext.mobilePageStep = 'install';
mobileContext.renderMobilePage(undefined, 'step-back');
assert.equal(pairEntry.cancelled, true);
assert.equal(animations.at(-1).frames[0].transform, 'translateX(-40px)');
const backEntry = animations.at(-1);
mobileVisible = false;
mobileContext.mobilePageStep = null;
const beforeHiddenStage = animations.length;
mobileContext.renderMobilePage({ devices: [{ id: 'phone' }] });
assert.equal(backEntry.cancelled, true, 'hidden state changes cancel obsolete entry');
assert.equal(animations.length, beforeHiddenStage, 'hidden mobile pages never animate');
mobileVisible = true;
mobileContext.renderMobilePage({ devices: [{ id: 'phone' }] });
assert.equal(animations.length, beforeHiddenStage, 'revealing the same stage does not replay it');
preference.matches = true;
mobileContext.mobilePageStep = 'pair';
mobileContext.renderMobilePage();
assert.equal(animations.length, beforeHiddenStage, 'reduced motion also skips mobile steps');
assert.equal(mobileDialog.dataset.mobilePageState, 'pair', 'reduced motion preserves real state');
preference.matches = false;
const inventory = spawnSync(process.execPath, ['scripts/motion-inventory.mjs'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(inventory.status, 0, inventory.stdout + inventory.stderr);
console.log(inventory.stdout.trim());
console.log(
  'Motion behavior: interruption, navigation relationships, Spring, system preferences and hidden-window cleanup passed.',
);
