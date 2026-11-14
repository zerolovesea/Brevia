(() => {
  const instances = new WeakMap();
  const transcript = [
    '我们先对齐这次会议的目标。',
    '接下来确认负责人和交付时间。',
    '把讨论变成清晰、可执行的下一步。',
  ];
  const translate = (key) => (typeof t === 'function' ? t(key) : key);
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const copy = (key, tag = 'span') =>
    `<${tag} data-preview-copy="${escape(key)}">${escape(translate(key))}</${tag}>`;
  const icon = (name) => interfaceIcon(name);

  function meetingTabs(summary) {
    const tabs = [
      ['document', '会议纪要'],
      ['list', '鱼骨图'],
      ['waveform', '转写'],
      ['notes', '笔记'],
      ...(summary ? [['bookmark', '重点']] : []),
    ];
    return (
      '<div class="dmp-meeting-tabs">' +
      tabs
        .map(([glyph, label], i) => {
          const body = icon(glyph) + copy(label);
          return i === 0 || i === 2
            ? `<button type="button" data-preview-select="${i === 0 ? 2 : 1}" aria-pressed="${i === (summary ? 0 : 2)}">${body}</button>`
            : `<span>${body}</span>`;
        })
        .join('') +
      '</div>'
    );
  }
  function markup() {
    return `<div class="dmp-phone" role="group" data-preview-label="交互预览">
      <div class="dmp-screen">
        <div class="dmp-statusbar"><b aria-hidden="true">9:41</b><span class="dmp-island"></span><span class="dmp-status-icons" aria-hidden="true"><svg viewBox="0 0 52 16"><path d="M1 11h3v4H1zm5-3h3v7H6zm5-3h3v10h-3zm5-3h3v13h-3z" fill="currentColor"/><path d="M23 6q6-6 12 0m-10 3q4-4 8 0m-6 3q2-2 4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><rect x="39" y="4" width="10" height="9" rx="2" fill="none" stroke="currentColor"/><path d="M41 6h6v5h-6zm9 1h2v3h-2z" fill="currentColor"/></svg></span><button type="button" class="dmp-pause" data-preview-pause aria-pressed="false">${icon('pause')}</button></div>
        <section class="dmp-scene is-active" data-preview-scene="0" role="group" tabindex="-1" data-preview-label="会议列表">
          <header class="dmp-brand"><img src="./assets/brevia-mark.svg" alt="Brevia"/><span>${icon('laptop')}${copy('连接电脑')}${icon('chevron-right')}</span></header>
          <div class="dmp-create"><div class="dmp-library-sources"><button type="button" data-preview-library="phone" aria-pressed="true" data-preview-label="手机会议">${icon('phone')}</button><button type="button" data-preview-library="computer" aria-pressed="false" data-preview-label="电脑会议">${icon('laptop')}</button></div>${icon('search')}<button type="button" data-preview-select="1">${icon('microphone')}${copy('新建录音')}</button></div>
          <div class="dmp-scroll">${copy('今天', 'small')}${['产品讨论', '项目周会'].map((name, i) => `<${i ? 'div' : 'button type="button" data-preview-select="2"'} class="dmp-meeting"><span>${copy(name, 'strong')}<small>${i ? '10:00 · 28:16' : '14:30 · 12:08'} · ${copy('已完成')}</small></span>${icon('more')}</${i ? 'div' : 'button'}>`).join('')}</div>
          <nav class="dmp-phone-nav"><span>${icon('waveform')}${copy('会议')}</span><span>${icon('notes')}${copy('笔记')}</span><span>${icon('settings')}${copy('设置')}</span></nav>
        </section>
        <section class="dmp-scene" data-preview-scene="1" role="group" tabindex="-1" data-preview-label="实时转写" aria-hidden="true" inert>
          <header class="dmp-header"><button type="button" class="dmp-back" data-preview-select="0" data-preview-label="返回">${icon('back')}</button><strong>${copy('产品讨论')}</strong></header>
          ${meetingTabs(false)}
          <div class="dmp-transcript">
            ${transcript.map((text, index) => `<article data-preview-utterance="${index}"><header><i>${index === 1 ? '2' : '1'}</i>${copy(index === 1 ? '发言人 2' : '发言人 1')}<time>00:${['36', '42', '48'][index]}</time></header><p data-preview-transcript="${index}">${escape(translate(text))}</p></article>`).join('')}
          </div>
          <div class="dmp-controls">
          <div class="dmp-live-meta"><span><i></i>${copy('录音中')}</span><time data-preview-timer>00:42</time></div>
          <div class="dmp-waveform" aria-hidden="true">${Array.from({ length: 29 }, (_, index) => `<i style="--bar-level:${0.2 + Math.abs(Math.sin(index * 1.7)) * 0.65}"></i>`).join('')}</div>
          <div class="dmp-control-row"><span>${icon('bookmark')}</span><span>${icon('pause')}</span><button type="button" data-preview-select="2" data-preview-label="查看纪要">${icon('stop')}</button></div></div>
        </section>
        <section class="dmp-scene" data-preview-scene="2" role="group" tabindex="-1" data-preview-label="会议纪要" aria-hidden="true" inert>
          <header class="dmp-header"><button type="button" class="dmp-back" data-preview-select="1" data-preview-label="返回">${icon('back')}</button><strong>${copy('产品讨论')}</strong></header>
          ${meetingTabs(true)}
          <div class="dmp-scroll dmp-summary"><small data-preview-summary-state></small><article>${copy('会议摘要', 'h3')}${copy('本次讨论明确了目标、负责人和交付时间。', 'p')}${copy('行动项', 'h3')}
          <label class="dmp-task"><input type="checkbox" data-preview-task="0"/>${copy('确认负责人和时间')}</label></article></div>
          <div class="dmp-playback">${icon('play')}<small>00:00 / 12:08</small><i></i>1×</div>
        </section>
        <div class="dmp-home-indicator" aria-hidden="true"></div>
      </div>
    </div>`;
  }

  function init(dialog = document.getElementById('mobile-dialog')) {
    if (!dialog) return null;
    if (instances.has(dialog)) return instances.get(dialog);
    const preview = dialog.querySelector('.mobile-page-preview');
    const content = dialog.querySelector('.mobile-page-content');
    if (!preview || !content) return null;
    const original = [...preview.childNodes];
    preview.innerHTML = markup();
    preview.classList.add('desktop-mobile-preview');
    content.classList.add('has-mobile-demo');
    const canvas = document.createElement('canvas');
    canvas.className = 'dmp-background';
    canvas.setAttribute('aria-hidden', 'true');
    content.prepend(canvas);
    const context = canvas.getContext('2d');
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const screens = [...preview.querySelectorAll('[data-preview-scene]')];
    const bars = [...preview.querySelectorAll('.dmp-waveform i')];
    const utterances = [...preview.querySelectorAll('[data-preview-utterance]')];
    const texts = [...preview.querySelectorAll('[data-preview-transcript]')];
    const pause = preview.querySelector('[data-preview-pause]');
    const timer = preview.querySelector('[data-preview-timer]');
    const summaryState = preview.querySelector('[data-preview-summary-state]');
    let liveTranscript = transcript;
    let scene = 0;
    let elapsed = 0;
    let clock = 0;
    let lastFrame = null;
    let lastPaint = -Infinity;
    let frame = null;
    let width = 0;
    let height = 0;
    let dotColor = '';
    let paused = false;
    let running = false;
    let destroyed = false;
    let intersecting = true;
    let fullScene = false;
    let playWhileFocused = false;
    let pointer = { x: 0.76, y: 0.42 };

    function visible() {
      return (
        dialog.isConnected &&
        !document.hidden &&
        intersecting &&
        dialog.checkVisibility() &&
        preview.checkVisibility()
      );
    }

    function drawBackground() {
      if (!context || !width || !height) return;
      context.clearRect(0, 0, width, height);
      context.fillStyle = dotColor;
      // Orca 原版是 5px 静态点阵；波纹是 Brevia 对动态背景要求的独立扩展。
      const phase = clock / 1800;
      for (let y = 10; y < height; y += 18) {
        for (let x = 10; x < width; x += 18) {
          const distance = Math.hypot(x - width * pointer.x, (y - height * pointer.y) * 0.8);
          const wave = (Math.sin(distance / 58 - phase) + 1) / 2;
          const ridge = Math.pow(wave, 5);
          const prominence = Math.max(0.12, 1 - distance / Math.max(width, height));
          context.globalAlpha = 0.025 + ridge * prominence * 0.17;
          context.beginPath();
          context.arc(
            x,
            y + Math.sin(x / 100 + phase) * ridge * 2,
            0.7 + ridge * 0.65,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
      context.globalAlpha = 1;
    }

    function sizeBackground() {
      const bounds = content.getBoundingClientRect();
      width = Math.round(bounds.width);
      height = Math.round(bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      dotColor = getComputedStyle(content).color;
      drawBackground();
    }

    function renderPhone() {
      preview.classList.toggle('is-tapping', running && elapsed >= 4500);
      if (scene === 2) {
        const progress = fullScene || preference.matches ? 1 : Math.min(1, elapsed / 1400);
        preview.classList.toggle('is-summary-ready', progress === 1);
        const state = translate(progress === 1 ? '已完成' : '处理中');
        if (summaryState.textContent !== state) summaryState.textContent = state;
      }
      if (scene !== 1) return;
      timer.textContent = `00:${String(42 + Math.floor(elapsed / 1000)).padStart(2, '0')}`;
      bars.forEach((bar, index) => {
        const level =
          0.12 +
          Math.abs(Math.sin(clock / 135 + index * 0.8) * Math.cos(index / 6 + clock / 420)) * 0.85;
        bar.style.setProperty('--bar-level', level.toFixed(3));
      });
      texts.forEach((text, index) => {
        const value = translate(liveTranscript[index] || '');
        const progress =
          fullScene || preference.matches
            ? 1
            : Math.max(0, Math.min(1, (elapsed - index * 1000 + 650) / 1100));
        const characters = [...value];
        const next = characters.slice(0, Math.ceil(characters.length * progress)).join('');
        if (text.textContent !== next) text.textContent = next;
        utterances[index].classList.toggle('is-pending', progress === 0 || !value);
        text.classList.toggle('is-writing', running && progress > 0 && progress < 1);
      });
    }

    function select(index, manual = true) {
      if (destroyed || !Number.isInteger(index) || index < 0 || index >= screens.length) return;
      if (scene === index) return;
      scene = index;
      elapsed = 0;
      fullScene = manual && (!running || paused || preference.matches);
      screens.forEach((screen, item) => {
        screen.classList.toggle('is-active', item === index);
        screen.classList.toggle('is-past', item < index);
        screen.setAttribute('aria-hidden', String(item !== index));
        screen.inert = item !== index;
      });
      preview.dataset.previewScene = String(index);
      renderPhone();
    }

    function tick(now) {
      frame = null;
      if (!running || destroyed) return;
      // 背景标签页不会补跑时间，暂停后从原位置继续，而不是跨越整个演示。
      const delta = lastFrame === null ? 0 : Math.min(80, now - lastFrame);
      lastFrame = now;
      elapsed += delta;
      clock += delta;
      if (elapsed >= 4740) select((scene + 1) % screens.length, false);
      if (now - lastPaint >= 1000 / 30) {
        lastPaint = now;
        drawBackground();
        renderPhone();
      }
      frame = requestAnimationFrame(tick);
    }

    function localize() {
      for (const node of preview.querySelectorAll('[data-preview-copy]'))
        node.textContent = translate(node.dataset.previewCopy);
      for (const node of preview.querySelectorAll('[data-preview-label]'))
        node.setAttribute('aria-label', translate(node.dataset.previewLabel));
      pause.setAttribute('aria-label', translate(paused ? '继续演示' : '暂停演示'));
      pause.title = translate(paused ? '继续演示' : '暂停演示');
      renderPhone();
    }

    function refresh() {
      if (destroyed) return;
      const next =
        visible() &&
        !preference.matches &&
        !paused &&
        (!preview.matches(':focus-within') || playWhileFocused);
      preview.classList.toggle('is-preview-reduced', preference.matches);
      preview.classList.toggle('is-preview-offpage', !visible());
      preview.dataset.previewRunning = String(next);
      if (next === running) return;
      running = next;
      lastFrame = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (running) frame = requestAnimationFrame(tick);
      else {
        preview.classList.remove('is-tapping');
        renderPhone();
      }
    }

    function setPaused(value) {
      if (destroyed) return;
      paused = Boolean(value);
      // 明确点击继续时允许焦点停留在播放按钮；后续键盘探索仍会暂停。
      playWhileFocused = !paused;
      preview.dataset.previewPaused = String(paused);
      pause.setAttribute('aria-pressed', String(paused));
      pause.innerHTML = icon(paused ? 'play' : 'pause');
      localize();
      refresh();
    }

    function onClick(event) {
      const library = event.target.closest('[data-preview-library]');
      if (library)
        for (const button of preview.querySelectorAll('[data-preview-library]'))
          button.setAttribute('aria-pressed', String(button === library));

      const target = event.target.closest('[data-preview-select]');
      if (target) {
        select(Number(target.dataset.previewSelect));
        screens[scene].focus({ preventScroll: true });
      }
      if (event.target.closest('[data-preview-pause]')) setPaused(!paused);
    }

    function onPointer(event) {
      if (!running) return;
      const bounds = content.getBoundingClientRect();
      pointer = {
        x: 0.55 + ((event.clientX - bounds.left) / bounds.width) * 0.35,
        y: 0.25 + ((event.clientY - bounds.top) / bounds.height) * 0.4,
      };
    }

    function onFocusIn() {
      playWhileFocused = false;
      refresh();
    }

    function onFocusOut() {
      queueMicrotask(() => {
        if (!preview.matches(':focus-within')) playWhileFocused = false;
        refresh();
      });
    }

    function onPreference() {
      if (preference.matches) fullScene = true;
      refresh();
      renderPhone();
      drawBackground();
    }

    const resize = new ResizeObserver(sizeBackground);
    resize.observe(content);
    const intersection = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting);
      refresh();
    });
    intersection.observe(preview);
    const state = new MutationObserver(refresh);
    // 只监听祖先显示状态，不观察演示内部每帧文字与样式更新。
    for (let node = dialog; node; node = node.parentElement)
      state.observe(node, {
        attributes: true,
        attributeFilter: ['hidden', 'class', 'style', 'open', 'data-mobile-page-state'],
      });
    const theme = new MutationObserver(sizeBackground);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('brevia:language-changed', localize);
    preference.addEventListener('change', onPreference);
    preview.addEventListener('click', onClick);
    preview.addEventListener('focusin', onFocusIn);
    preview.addEventListener('focusout', onFocusOut);
    content.addEventListener('pointermove', onPointer);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      state.disconnect();
      theme.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('brevia:language-changed', localize);
      window.removeEventListener('pagehide', destroy);
      preference.removeEventListener('change', onPreference);
      preview.removeEventListener('click', onClick);
      preview.removeEventListener('focusin', onFocusIn);
      preview.removeEventListener('focusout', onFocusOut);
      content.removeEventListener('pointermove', onPointer);
      canvas.remove();
      content.classList.remove('has-mobile-demo');
      preview.classList.remove(
        'desktop-mobile-preview',
        'is-preview-reduced',
        'is-preview-offpage',
        'is-tapping',
      );
      for (const key of ['previewScene', 'previewRunning', 'previewPaused'])
        delete preview.dataset[key];
      preview.replaceChildren(...original);
      instances.delete(dialog);
    }

    const controller = {
      refresh,
      select,
      setPaused,
      destroy,
      seekLive(time, entries) {
        liveTranscript = entries;
        select(1);
        fullScene = true;
        elapsed = Math.max(0, time);
        clock = elapsed;
        renderPhone();
      },
    };
    instances.set(dialog, controller);
    window.addEventListener('pagehide', destroy, { once: true });
    preview.dataset.previewScene = '0';
    preview.dataset.previewPaused = 'false';
    localize();
    sizeBackground();
    refresh();
    return controller;
  }

  window.BreviaDesktopMobilePreview = { init };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
