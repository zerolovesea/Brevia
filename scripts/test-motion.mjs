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
assert.equal(animations.length, count);
assert.equal(motion.duration('exit'), 0);
preference.matches = false;
assert.equal(motion.duration('exit'), 140);
document.hidden = true;
motion.enter(element);
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
const inventory = spawnSync(process.execPath, ['scripts/motion-inventory.mjs'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(inventory.status, 0, inventory.stdout + inventory.stderr);
console.log(inventory.stdout.trim());
console.log(
  'Motion behavior: interruption, navigation relationships, Spring, system preferences and hidden-window cleanup passed.',
);
