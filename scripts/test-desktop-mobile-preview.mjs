import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 用可控帧时钟检验真实控制器，不启动 Electron，也不模拟任何配对服务。
class Node {
  constructor() {
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.values = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name)),
    };
    this.style = {
      setProperty: (key, value) => this.values.set(key, value),
      removeProperty: (key) => this.values.delete(key),
    };
    this.childNodes = [];
    this.isConnected = true;
    this.visible = true;
    this.textContent = '';
    this.parentElement = null;
    this.focused = false;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  getAttribute(key) {
    return this.attributes.get(key);
  }
  addEventListener(key, callback) {
    this.listeners.set(key, callback);
  }
  removeEventListener(key, callback) {
    if (this.listeners.get(key) === callback) this.listeners.delete(key);
  }
  dispatch(key, event = {}) {
    this.listeners.get(key)?.(event);
  }
  checkVisibility() {
    return this.visible;
  }
  getBoundingClientRect() {
    return { width: 600, height: 400, left: 0, top: 0 };
  }
  matches(selector) {
    return selector === ':focus-within' ? this.focused : this.role === 'tab';
  }
  focus() {
    this.focused = true;
  }
  prepend(node) {
    this.childNodes.unshift(node);
  }
  replaceChildren(...nodes) {
    this.childNodes = nodes;
  }
  remove() {
    this.removed = true;
  }
}

function fixture({ reduced = false, visible = true } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  let now = 0;
  const observers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      observers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const document = new Node();
  document.documentElement = new Node();
  document.hidden = false;
  const window = new Node();
  window.devicePixelRatio = 2;
  const preference = new Node();
  preference.matches = reduced;
  const preview = new Node();
  const original = new Node();
  preview.childNodes = [original];
  const content = new Node();
  const dialog = new Node();
  dialog.visible = visible;
  dialog.parentElement = document.documentElement;
  const screens = Array.from({ length: 3 }, () => new Node());
  const tabs = Array.from({ length: 3 }, () => {
    const node = new Node();
    node.role = 'tab';
    return node;
  });
  const bars = Array.from({ length: 29 }, () => new Node());
  const utterances = Array.from({ length: 3 }, () => new Node());
  const texts = Array.from({ length: 3 }, () => new Node());
  const pause = new Node();
  const timer = new Node();
  const summary = new Node();
  const translated = new Node();
  translated.dataset.previewCopy = '交互预览';
  const canvas = new Node();
  let points = [];
  let painted = 0;
  const drawing = {
    clearRect() {
      points = [];
      painted++;
    },
    setTransform() {},
    beginPath() {},
    arc(...values) {
      points.push(values);
    },
    fill() {},
  };
  canvas.getContext = () => drawing;
  document.createElement = (tag) => {
    assert.equal(tag, 'canvas');
    return canvas;
  };
  document.getElementById = () => dialog;
  dialog.querySelector = (selector) => (selector === '.mobile-page-preview' ? preview : content);
  preview.querySelectorAll = (selector) =>
    ({
      '[data-preview-scene]': screens,
      '[role="tab"]': tabs,
      '.dmp-waveform i': bars,
      '[data-preview-utterance]': utterances,
      '[data-preview-transcript]': texts,
      '[data-preview-copy]': [translated],
      '[data-preview-label]': [],
    })[selector] || [];
  preview.querySelector = (selector) =>
    ({
      '[data-preview-pause]': pause,
      '[data-preview-timer]': timer,
      '[data-preview-summary-state]': summary,
    })[selector];
  let language = 'zh';
  const context = {
    window,
    document,
    interfaceIcon: (name) => `<svg data-icon="${name}"></svg>`,
    t: (key) => (language === 'zh' ? key : `en:${key}`),
    matchMedia: () => preference,
    getComputedStyle: () => ({ color: '#171717' }),
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    MutationObserver: Observer,
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    queueMicrotask,
  };
  runInNewContext(
    readFileSync(new URL('../frontend/desktop-mobile-preview.js', import.meta.url), 'utf8'),
    context,
  );
  const api = window.BreviaDesktopMobilePreview;
  assert.equal(
    content.childNodes.length,
    1,
    'loading the desktop script mounts the preview automatically',
  );
  const controller = api.init();
  function advance(duration, step = 40) {
    const end = now + duration;
    while (now < end) {
      now = Math.min(end, now + step);
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(now);
    }
  }
  return {
    api,
    controller,
    preview,
    content,
    dialog,
    screens,
    tabs,
    bars,
    texts,
    timer,
    summary,
    pause,
    preference,
    document,
    window,
    frames,
    observers,
    canvas,
    original,
    translated,
    advance,
    points: () => points,
    painted: () => painted,
    language(value) {
      language = value;
      window.dispatch('brevia:language-changed');
    },
  };
}

const demo = fixture();
assert.equal(demo.api.init(), demo.controller, 'repeated mounting reuses one controller');
assert.equal(demo.content.childNodes.length, 1, 'repeated mounting never duplicates its canvas');
assert.equal(demo.preview.dataset.previewScene, '0');
assert.equal(demo.preview.dataset.previewRunning, 'true');
assert.equal(demo.frames.size, 1);
const initialPixels = JSON.stringify(demo.points());
demo.advance(800);
assert.notEqual(
  JSON.stringify(demo.points()),
  initialPixels,
  'the actual canvas points change over time',
);
assert.equal(demo.preview.dataset.previewScene, '0', 'reading time precedes navigation');
demo.advance(3760);
assert.ok(demo.preview.classes.has('is-tapping'), 'a tap hint precedes the push');
demo.advance(240);
assert.equal(demo.preview.dataset.previewScene, '1');
assert.equal(demo.screens[0].inert, true, 'inactive content cannot receive keyboard input');
assert.equal(demo.screens[1].inert, false);
assert.equal(demo.tabs[1].getAttribute('aria-selected'), 'true');
const textBefore = demo.texts.map((node) => node.textContent).join('');
const levelBefore = demo.bars[10].values.get('--bar-level');
demo.advance(1440);
assert.notEqual(
  demo.texts.map((node) => node.textContent).join(''),
  textBefore,
  'transcript content advances inside its scene',
);
assert.notEqual(
  demo.bars[10].values.get('--bar-level'),
  levelBefore,
  'the audio meter advances without replacing the screen',
);
assert.notEqual(demo.timer.textContent, '00:42');

demo.controller.setPaused(true);
assert.equal(demo.frames.size, 0);
assert.equal(demo.preview.dataset.previewPaused, 'true');
const pausedText = demo.texts.map((node) => node.textContent).join('');
const pausedPaints = demo.painted();
const pausedProgress = demo.preview.values.get('--demo-progress');
demo.advance(60000);
assert.equal(demo.painted(), pausedPaints, 'user pause suspends drawing work');
assert.equal(demo.texts.map((node) => node.textContent).join(''), pausedText);
demo.controller.setPaused(false);
demo.advance(40);
assert.equal(
  demo.preview.values.get('--demo-progress'),
  pausedProgress,
  'resume never catches up the hidden elapsed time',
);

demo.document.hidden = true;
demo.document.dispatch('visibilitychange');
assert.equal(demo.frames.size, 0, 'background windows stop the frame loop');
demo.advance(50000);
demo.document.hidden = false;
demo.document.dispatch('visibilitychange');
assert.equal(demo.frames.size, 1);
demo.dialog.visible = false;
demo.observers[2].callback();
assert.equal(demo.frames.size, 0, 'leaving the page stops work even while the window stays active');
demo.dialog.visible = true;
demo.observers[2].callback();
demo.observers[1].callback([{ isIntersecting: false }]);
assert.equal(demo.frames.size, 0, 'scrolling the demo off screen stops work');
demo.observers[1].callback([{ isIntersecting: true }]);
assert.equal(demo.frames.size, 1);
demo.preview.focused = true;
demo.preview.dispatch('focusin');
assert.equal(demo.frames.size, 0, 'keyboard exploration pauses automatic page replacement');
demo.controller.select(2);
assert.equal(
  demo.summary.textContent,
  '已完成',
  'manual inspection shows complete content while focus pauses playback',
);
demo.controller.setPaused(true);
demo.controller.setPaused(false);
assert.equal(demo.frames.size, 1, 'explicit resume plays while its button retains keyboard focus');
demo.preview.dispatch('focusin');
assert.equal(demo.frames.size, 0, 'moving keyboard focus into another control pauses again');
demo.preview.focused = false;
demo.controller.refresh();

demo.controller.select(2);
demo.advance(1600);
assert.equal(demo.summary.textContent, '已完成', 'summary processing reaches completion');
assert.ok(demo.preview.classes.has('is-summary-ready'));
demo.language('en');
assert.equal(demo.translated.textContent, 'en:交互预览');
assert.equal(demo.preview.dataset.previewScene, '2', 'language updates preserve the active screen');
assert.equal(demo.summary.textContent, 'en:已完成');
let prevented = false;
demo.preview.dispatch('keydown', {
  target: demo.tabs[2],
  key: 'Home',
  preventDefault() {
    prevented = true;
  },
});
assert.equal(prevented, true);
assert.equal(demo.preview.dataset.previewScene, '0');
assert.equal(demo.tabs[0].focused, true);

demo.preference.matches = true;
demo.preference.dispatch('change');
assert.equal(demo.frames.size, 0, 'enabling reduced motion cancels an active loop');
demo.controller.select(1);
assert.ok(
  demo.texts.every((node) => node.textContent.length > 0),
  'reduced motion preserves all readable transcript content',
);
assert.equal(demo.preview.dataset.previewScene, '1', 'manual navigation remains available');
demo.controller.setPaused(true);
demo.preference.matches = false;
demo.preference.dispatch('change');
assert.equal(demo.frames.size, 0, 'system preference changes never override user pause');
demo.controller.setPaused(false);
assert.equal(demo.frames.size, 1);
const staleFrame = [...demo.frames.values()][0];
const paintsBeforeDestroy = demo.painted();
demo.controller.destroy();
assert.equal(demo.frames.size, 0);
assert.ok(demo.observers.every((observer) => observer.disconnected));
assert.equal(demo.document.listeners.size, 0);
assert.equal(demo.window.listeners.size, 0);
assert.equal(demo.preference.listeners.size, 0);
assert.equal(demo.preview.listeners.size, 0);
assert.equal(demo.content.listeners.size, 0);
assert.equal(demo.canvas.removed, true);
assert.equal(demo.preview.childNodes[0], demo.original, 'cleanup restores the original mount');
staleFrame(999999);
assert.equal(demo.painted(), paintsBeforeDestroy, 'a stale frame cannot restart after disposal');
demo.controller.destroy();

const quiet = fixture({ reduced: true });
assert.equal(quiet.frames.size, 0, 'reduced motion at mount never starts a frame loop');
quiet.controller.select(2);
assert.equal(quiet.summary.textContent, '已完成');
quiet.controller.destroy();
const hidden = fixture({ visible: false });
assert.equal(hidden.frames.size, 0, 'hidden initial mounts never animate');
hidden.controller.destroy();

console.log(
  'Mobile preview: live DOM scenes, canvas frames, manual navigation, pause, visibility, reduced motion and disposal passed.',
);
