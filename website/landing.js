(() => {
  const zh = document.documentElement.lang.startsWith('zh');
  const pick = (cn, en) => (zh ? cn : en);
  const demo = document.querySelector('.demo');
  const canvas = document.querySelector('.demo-canvas');
  const toggle = demo;
  const description = demo.getAttribute('aria-label');
  const frame = document.createElement('iframe');
  frame.className = 'app-frame';
  frame.title = pick('Brevia 应用演示', 'Brevia application demo');
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  const url = new URL('./app-motion.html', location.href);
  url.searchParams.set('lang', zh ? 'zh' : 'en');
  url.searchParams.set('version', document.querySelector('[data-release-version]').textContent);
  frame.src = url.href;
  canvas.append(frame);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  demo.addEventListener('pointermove', (event) => {
    if (reduced.matches || !finePointer.matches) return;
    const rect = demo.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    demo.style.setProperty('--rim', String(0.035 + 0.05 * (1 - y)));
    demo.style.setProperty('--drift-x', `${(x - 0.5) * 6}px`);
    demo.style.setProperty('--drift-y', `${(y - 0.5) * 6}px`);
  });
  demo.addEventListener('pointerleave', () => {
    for (const name of ['rim', 'drift-x', 'drift-y']) demo.style.removeProperty(`--${name}`);
  });
  let paused = reduced.matches;
  let elapsed = reduced.matches ? 28000 : 0;
  let previous = null;
  let animation;
  let ready = false;

  const features = [
    ['live', pick('转写与 AI 笔记', 'Transcription & AI notes'), 0, 14800, 11200],
    ['fishbone', pick('鱼骨图', 'Fishbone diagram'), 22200, 32000, 28000],
    ['phone', pick('手机协作', 'Phone pairing'), 32000, 40000, 32500],
    ['agent', pick('Agent 与 MCP', 'Agent & MCP'), 40000, 56000, 54500],
    ['capsule', pick('会议胶囊', 'Meeting capsule'), 14800, 20000, 17500],
  ];
  let clip = features[0];
  const tabs = document.createElement('fieldset');
  tabs.className = 'feature-tabs';
  const legend = document.createElement('legend');
  legend.className = 'sr-only';
  legend.textContent = pick('选择演示功能', 'Choose a feature');
  tabs.append(legend);
  function select(feature) {
    clip = feature;
    elapsed = paused ? clip[4] : clip[2];
    previous = null;
    render();
    if (paused && ready) sync(true);
  }
  for (const feature of features) {
    const [id, label] = feature;
    const input = document.createElement('input');
    input.type = 'radio';
    input.className = 'sr-only';
    input.name = 'feature';
    input.id = `feature-${id}`;
    input.checked = id === 'live';
    const caption = document.createElement('label');
    caption.htmlFor = input.id;
    caption.textContent = label;
    input.addEventListener('change', () => select(feature));
    tabs.append(input, caption);
  }
  document.querySelector('.intro').append(tabs);
  select(features[0]);
  document.querySelector('[data-language]').search = location.search;
  function fit() {
    const compact = matchMedia('(max-width: 640px)').matches;
    const width = compact ? 600 : 1200;
    const height = compact ? 760 : 800;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    const scale = Math.min(
      canvas.clientWidth / width,
      canvas.clientHeight / height,
      compact ? 0.78 : 1,
    );
    frame.style.left = '50%';
    frame.style.transform = `translate(-50%,-50%) scale(${scale})`;
  }
  new ResizeObserver(fit).observe(canvas);
  function render() {
    if (!ready) return;
    const phase = String(frame.contentWindow.appMotion.render(elapsed));
    if (demo.dataset.phase !== phase) demo.dataset.phase = phase;
  }
  function tick(now) {
    if (previous !== null) elapsed += now - previous;
    previous = now;
    if (elapsed >= clip[3]) elapsed = clip[2] + ((elapsed - clip[2]) % (clip[3] - clip[2]));
    render();
    animation = requestAnimationFrame(tick);
  }
  function sync(settle = false) {
    cancelAnimationFrame(animation);
    previous = null;
    const label = paused ? pick('播放动画', 'Play animation') : pick('暂停动画', 'Pause animation');
    toggle.setAttribute('aria-label', `${description} · ${label}`);
    toggle.title = label;
    demo.classList.toggle('is-paused', paused || document.hidden);
    if (ready)
      frame.contentWindow.postMessage(
        {
          type: 'brevia-landing-frame',
          paused: paused || document.hidden,
          settle: settle === true,
        },
        location.origin,
      );
    if (ready && !paused && !document.hidden) animation = requestAnimationFrame(tick);
  }
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'brevia-landing-ready') {
      ready = true;
      render();
      sync(paused);
    }
    if (event.data?.type === 'brevia-landing-error') {
      const message = document.createElement('p');
      message.className = 'demo-fallback';
      message.textContent = pick('演示暂时无法加载', 'The demo could not load');
      canvas.replaceChildren(message);
    }
  });
  toggle.addEventListener('click', () => {
    paused = !paused;
    sync();
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      paused = !paused;
      sync();
    }
  });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', () => {
    paused = reduced.matches;
    if (paused) elapsed = clip[4];
    render();
    sync(paused);
  });
  render();
  sync();
  const platform = /Android/i.test(navigator.userAgent)
    ? 'android'
    : /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1)
      ? 'ios'
      : /Win/i.test(navigator.platform)
        ? 'windows'
        : /Linux/i.test(navigator.platform)
          ? 'linux'
          : 'macos';
  document.getElementById(`platform-${platform}`).checked = true;
  const android = document.querySelector('[data-platform="android"]');
  const readAndroidSize = async () => {
    try {
      const response = await fetch(new URL('latest.json', android.href));
      if (!response.ok) return;
      const { size, version } = await response.json();
      if (Number.isSafeInteger(size) && size > 0 && typeof version === 'string')
        android.querySelector('[data-size]').textContent =
          `v${version} · ${(size / 1e6).toFixed(1)} MB`;
    } catch {}
  };
  if (platform === 'android') readAndroidSize();
  else
    document
      .querySelector('#platform-android')
      .addEventListener('change', readAndroidSize, { once: true });
  document.querySelector('[data-language]').addEventListener('click', (event) => {
    try {
      sessionStorage.setItem('lang-selected', event.currentTarget.dataset.language);
    } catch {}
    event.currentTarget.hash = location.hash;
  });
})();
