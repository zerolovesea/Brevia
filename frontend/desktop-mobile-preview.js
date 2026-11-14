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

  function markup() {
    return `<div class="dmp-phone" role="group" data-preview-label="交互预览">
      <div class="dmp-screen">
        <div class="dmp-statusbar"><b aria-hidden="true">9:41</b><span class="dmp-island"></span><button type="button" class="dmp-pause" data-preview-pause aria-pressed="false">${icon('pause')}</button></div>
        <section class="dmp-scene is-active" data-preview-scene="0" role="group" tabindex="-1" data-preview-label="会议列表">
          <header class="dmp-header"><img src="./assets/brevia-logo.svg" alt="Brevia"/><strong>Brevia</strong><span class="dmp-computer" role="img" aria-label="${escape(translate('连接电脑') + ' · ' + translate('演示'))}" title="${escape(translate('连接电脑') + ' · ' + translate('演示'))}">${icon('laptop')}</span></header>
          <div class="dmp-scroll">
            <div class="dmp-page-heading">${copy('会议', 'h2')}<span>03</span></div>
            <div class="dmp-search">${icon('search')}${copy('会议列表')}</div>
            ${copy('今天', 'h3')}
            <button class="dmp-meeting dmp-featured" type="button" data-preview-select="1"><span class="dmp-meeting-icon">${icon('waveform')}</span><span><strong>${copy('产品讨论')}</strong><small>14:30 · 12:08</small></span>${icon('chevron-right')}</button>
            <div class="dmp-meeting"><span class="dmp-meeting-icon">${icon('document')}</span><span><strong>${copy('项目周会')}</strong><small>10:00 · 28:16</small></span>${icon('chevron-right')}</div>
            ${copy('昨天', 'h3')}
            <div class="dmp-meeting"><span class="dmp-meeting-icon">${icon('notes')}</span><span><strong>${copy('设计评审')}</strong><small>16:00 · 36:42</small></span>${icon('chevron-right')}</div>
            <div class="dmp-list-footnote">${icon('check')}${copy('转写完成')}</div>
          </div>
          <div class="dmp-home-actions"><button class="dmp-record" data-preview-select="1" type="button">${icon('microphone')}${copy('开始录音')}</button></div>
          <nav class="dmp-phone-nav" aria-hidden="true"><span class="is-selected">${icon('list')}${copy('会议')}</span><span>${icon('notes')}${copy('笔记')}</span><span>${icon('settings')}${copy('设置')}</span></nav>
        </section>
        <section class="dmp-scene" data-preview-scene="1" role="group" tabindex="-1" data-preview-label="实时转写" aria-hidden="true" inert>
          <header class="dmp-header"><button type="button" class="dmp-back" data-preview-select="0" data-preview-label="返回">${icon('back')}</button><strong>${copy('产品讨论')}</strong></header>
          <div class="dmp-live-meta"><span><i></i>${copy('录音中')}</span><time data-preview-timer>00:42</time></div>
          <div class="dmp-waveform" aria-hidden="true">${Array.from({ length: 29 }, (_, index) => `<i style="--bar-level:${0.2 + Math.abs(Math.sin(index * 1.7)) * 0.65}"></i>`).join('')}</div>
          <div class="dmp-live-tabs"><span>${copy('实时转写')}</span><span>${copy('笔记')}</span></div>
          <div class="dmp-transcript">
            ${transcript.map((text, index) => `<article data-preview-utterance="${index}"><header><i>${index === 1 ? '2' : '1'}</i>${copy(index === 1 ? '发言人 2' : '发言人 1')}<time>00:${['36', '42', '48'][index]}</time></header><p data-preview-transcript="${index}">${escape(translate(text))}</p></article>`).join('')}
          </div>
          <div class="dmp-live-footer"><span class="dmp-record-indicator">${icon('recording')}</span><button data-preview-select="2" type="button">${copy('查看纪要')}${icon('arrow-right')}</button></div>
        </section>
        <section class="dmp-scene" data-preview-scene="2" role="group" tabindex="-1" data-preview-label="会议纪要" aria-hidden="true" inert>
          <header class="dmp-header"><button type="button" class="dmp-back" data-preview-select="1" data-preview-label="返回">${icon('back')}</button><strong>${copy('会议纪要')}</strong></header>
          <div class="dmp-scroll dmp-summary">
            <div class="dmp-summary-heading">${copy('产品讨论', 'h2')}<small>14:30 · 12:08</small></div>
            <div class="dmp-summary-status">${icon('ai')}${copy('会议总结')}<span>${icon('check')}<span data-preview-summary-state>${escape(translate('已完成'))}</span></span></div>
            <div class="dmp-summary-progress" aria-hidden="true"><i></i></div>
            ${copy('本次讨论明确了目标、负责人和交付时间。', 'p')}
            <div class="dmp-summary-lines" aria-hidden="true"><i></i><i></i><i></i></div>
            ${copy('行动项', 'h3')}
            <label class="dmp-task"><input type="checkbox" data-preview-task="0"/><span>${copy('整理下一步行动项')}</span></label>
            <label class="dmp-task"><input type="checkbox" data-preview-task="1"/><span>${copy('确认负责人和时间')}</span></label>
            <div class="dmp-summary-note">${icon('notes')}${copy('把讨论变成清晰、可执行的下一步。')}</div>
          </div>
          <div class="dmp-summary-footer">${icon('check')}${copy('转写完成')}</div>
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
        preview.style.setProperty('--summary-progress', progress);
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
        const value = translate(transcript[index]);
        const progress =
          fullScene || preference.matches
            ? 1
            : Math.max(0, Math.min(1, (elapsed - index * 1000 + 650) / 1100));
        const characters = [...value];
        const next = characters.slice(0, Math.ceil(characters.length * progress)).join('');
        if (text.textContent !== next) text.textContent = next;
        utterances[index].classList.toggle('is-pending', progress === 0);
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

    const controller = { refresh, select, setPaused, destroy };
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
