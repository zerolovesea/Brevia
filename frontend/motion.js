(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let welcomeAnimations = [];
  const timing = Object.freeze({
    press: 80,
    feedback: 120,
    state: 180,
    surface: 220,
    spatial: 280,
    exit: 140,
    menu: 160,
    menuExit: 100,
    task: 160,
    taskExit: 120,
  });
  const easing = Object.freeze({
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  });
  function cancel(element) {
    running.get(element)?.cancel();
    running.delete(element);
  }
  function enter(element, kind = 'content') {
    if (!element) return;
    cancel(element);
    // 同级切换由选中态表达，不把已经可读的整页重新淡成空白。
    if (kind === 'sibling') return;
    if (preference.matches || document.hidden || !element.animate) return;
    const offset = kind === 'forward' ? 24 : kind === 'back' ? -24 : 0;
    const frames =
      kind === 'attention'
        ? [
            { backgroundColor: 'var(--color-selected)', offset: 0 },
            { backgroundColor: 'var(--color-selected)', offset: 0.22 },
            { backgroundColor: 'transparent' },
          ]
        : kind === 'tab'
          ? [
              { opacity: 1, transform: 'translateY(6px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ]
          : kind === 'press'
            ? [{ scale: 0.98 }, { scale: 1.004, offset: 0.65 }, { scale: 1 }]
            : offset
              ? [
                  { opacity: 1, transform: `translateX(${offset}px)` },
                  { opacity: 1, transform: 'translateX(0)' },
                ]
              : [{ opacity: 0.72 }, { opacity: 1 }];
    const duration =
      kind === 'attention'
        ? 1120
        : offset
          ? kind === 'back'
            ? timing.state
            : timing.spatial
          : kind === 'press' || kind === 'tab'
            ? timing.state
            : timing.feedback;
    const animation = element.animate(frames, { duration, easing: easing.out });
    running.set(element, animation);
    const clean = () => {
      if (running.get(element) === animation) running.delete(element);
    };
    animation.finished.then(clean, clean);
  }
  function settle() {
    // 偏好变化或窗口隐藏时直接落到真实 DOM 终态，不能停在半透明的中间帧。
    [...running.values()].forEach((animation) => animation.finish());
  }
  function welcome(page, shell) {
    if (preference.matches || document.hidden || !page?.animate) return Promise.resolve();
    const targets = [
      [
        page,
        [
          { opacity: 1, transform: 'translateY(0) scale(1)' },
          { opacity: 0, transform: 'translateY(-12px) scale(.99)' },
        ],
        260,
      ],
      [
        shell.querySelector('#home-view'),
        [
          { opacity: 1, transform: 'translateY(16px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        520,
      ],
      [
        shell.querySelector('.sidebar'),
        [
          { opacity: 0.65, transform: 'translateX(-12px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        420,
      ],
    ];
    const animations = [];
    for (const [element, frames, duration] of targets) {
      if (!element) continue;
      cancel(element);
      const animation = element.animate(frames, {
        duration,
        easing: easing.out,
        fill: element === page ? 'forwards' : 'none',
      });
      running.set(element, animation);
      animations.push(animation);
      const clean = () => {
        if (running.get(element) === animation) running.delete(element);
      };
      animation.finished.then(clean, clean);
    }
    welcomeAnimations = animations;
    Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (welcomeAnimations === animations) welcomeAnimations = [];
    });
    return animations[0].finished.catch(() => {});
  }
  function leave(element, complete) {
    if (!element) return;
    cancel(element);
    if (preference.matches || document.hidden || !element.animate) {
      complete();
      return;
    }
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: timing.menuExit,
      easing: easing.in,
      fill: 'forwards',
    });
    running.set(element, animation);
    animation.finished.then(
      () => {
        if (running.get(element) !== animation) return;
        running.delete(element);
        complete();
        animation.cancel();
      },
      () => {},
    );
  }
  preference.addEventListener('change', settle);
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-motion-paused', document.hidden);
    if (document.hidden) settle();
  });
  window.addEventListener('pagehide', settle);
  document.addEventListener('keydown', (event) => {
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      document.documentElement.toggleAttribute('data-keyboard-navigation', true);
    if (welcomeAnimations.length) welcomeAnimations.forEach((animation) => animation.finish());
  });
  document.addEventListener('pointerdown', (event) => {
    document.documentElement.toggleAttribute('data-keyboard-navigation', false);
    if (welcomeAnimations.length) welcomeAnimations.forEach((animation) => animation.finish());
    let node = event.target;
    while (node) {
      // 新操作优先于尚未结束的视觉接手，固定定位菜单不会跟随页面半途漂移。
      if (running.has(node)) cancel(node);
      node = node.parentElement;
    }
  });
  // 弹性只用于离散控件的释放；行、卡片、拖动手柄与文字链接不回弹。
  document.addEventListener('pointerup', (event) => {
    const control = event.target.closest?.(
      '.primary-action, .modal-action, .secondary, .icon-button, .pause-button, .mark-button, .end-button',
    );
    if (
      control &&
      event.button === 0 &&
      !control.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')
    )
      enter(control, 'press');
  });
  window.BreviaMotion = {
    timing,
    easing,
    duration: (name) => (preference.matches ? 0 : timing[name]),
    enter,
    leave,
    cancel,
    welcome,
  };
})();
