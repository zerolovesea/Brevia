(() => {
  const bridge = window.brevia.desktop;
  const select = (selector) => document.querySelector(selector);
  const panel = select('#capsule-panel');
  const captions = select('#capsule-captions');
  const captionBody = select('#captions-panel');
  const meter = select('#capsule-meter');
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{ pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>', play: '<path d="m8 5 11 7-11 7z"/>', retry: '<path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>', pin: '<path d="m14 3 7 7-4 1-4 5-2-2-6 6 6-6-2-2 5-4z"/>', down: '<path d="M12 4v16m-6-6 6 6 6-6"/>' }[name] || ''}</svg>`;
  let state,
    tab = 'captions',
    pinned = false,
    expanded = false,
    follow = true;
  let openTimer,
    closeTimer,
    pointerDown = false,
    drag = null,
    suppressClick = false,
    busy = false;
  const t = (key) => window.BreviaLocaleData.translate(key, state?.locale || 'zh');
  const escape = (value) =>
    String(value || '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  // 同一组真实电平驱动初次状态和后续采样，暂停时各声柱落到底线。
  for (const weight of [0.35, 0.7, 1, 0.55, 0.8, 0.4]) {
    const bar = meter.appendChild(document.createElement('i'));
    bar.style.setProperty('--weight', weight);
  }

  let expandRevision = 0;
  let closingAnimation;
  async function expand(value) {
    if (!value && closingAnimation) return;
    const revision = ++expandRevision;
    const wasClosing = Boolean(closingAnimation);
    closingAnimation?.cancel();
    closingAnimation = null;
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (expanded === value && !wasClosing) return;
    try {
      if (!value && window.BreviaMotion.duration('exit')) {
        closingAnimation = panel.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: window.BreviaMotion.duration('exit'),
          easing: window.BreviaMotion.easing.in,
          fill: 'forwards',
        });
        await closingAnimation.finished.catch(() => {});
        if (revision !== expandRevision) return;
      }
      await bridge.expand({ expanded: value });
    } catch (error) {
      if (revision === expandRevision) {
        closingAnimation?.cancel();
        closingAnimation = null;
        showError(error);
      }
    }
  }
  function showError(error) {
    const node = select('#capsule-error');
    node.textContent = error.detail || error.message || String(error);
    node.hidden = false;
  }
  async function action(actionName) {
    if (busy) return;
    busy = true;
    select('#capsule-error').hidden = true;
    renderControls();
    try {
      await bridge.action({
        action:
          ['playing', 'playback-paused'].includes(state?.phase) &&
          ['pause', 'stop'].includes(actionName)
            ? `playback-${actionName}`
            : actionName,
        meetingId: state?.meetingId || null,
        tab,
        ...(state?.suggestion ? { suggestionId: state.suggestion.id } : {}),
      });
    } catch (error) {
      await expand(true);
      showError(error);
    } finally {
      busy = false;
      renderControls();
    }
  }
  function renderControls() {
    if (!state) return;
    const playback = ['playing', 'playback-paused'].includes(state.phase);
    const paused = ['paused', 'playback-paused'].includes(state.phase);
    const saving = state.phase === 'saving';
    const inactive = ['idle', 'saved'].includes(state.phase);
    const pause = select('.capsule-pause'),
      stop = select('.capsule-stop');
    pause.innerHTML = icon(paused ? 'play' : 'pause');
    pause.title = t(paused ? '继续' : '暂停');
    pause.setAttribute('aria-label', pause.title);
    pause.disabled = busy || saving || inactive || !state.canPause || state.phase === 'failed';
    pause.hidden = saving || inactive || state.phase === 'failed';
    stop.innerHTML = icon(state.phase === 'failed' ? 'retry' : 'stop');
    stop.title = t(playback ? '关闭播放' : state.phase === 'failed' ? '重试保存' : '结束会议');
    stop.setAttribute('aria-label', stop.title);
    stop.disabled = busy || saving || inactive;
    stop.hidden = saving || inactive;
    const home = select('.capsule-logo'),
      preview = select('#capsule-preview'),
      pin = select('#capsule-pin');
    home.title = t('返回当前会议');
    home.setAttribute('aria-label', home.title);
    select('.capsule-grip').title = t('拖动胶囊');
    preview.title = t(expanded ? (pinned ? '收起' : '固定展开') : '展开字幕与笔记');
    preview.setAttribute('aria-label', preview.title);
    pin.innerHTML = icon('pin');
    pin.title = t(pinned ? '取消固定' : '固定展开');
    pin.setAttribute('aria-label', pin.title);
    pin.setAttribute('aria-pressed', String(pinned));
    select('#capsule-follow').innerHTML = icon('down');
    select('#capsule-follow').title = t('跟随最新');
    select('#capsule-follow').setAttribute('aria-label', t('跟随最新'));
    select('#capsule-follow').hidden = tab !== 'captions' || follow;
    const analysis = select('#capsule-ai-state');
    analysis.hidden = tab !== 'notes' || !state.aiEnabled || !state.aiBusy;
    analysis.setAttribute('aria-label', t('正在分析…'));
    analysis.title = t('正在分析…');
  }
  function setTab(next) {
    tab = next;
    document.querySelectorAll('[role="tab"]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.tab === tab));
      button.tabIndex = button.dataset.tab === tab ? 0 : -1;
    });
    select('#captions-panel').hidden = tab !== 'captions';
    select('#notes-panel').hidden = tab !== 'notes';
    renderControls();
  }
  function notePreview(markdown) {
    return markdown
      .split('\n')
      .map((line) => {
        const heading = line.match(/^#{1,6}\s+(.+)/);
        if (heading) return `<h4>${escape(heading[1])}</h4>`;
        const bullet = line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s*)?(.*)/);
        if (bullet) return `<p class="capsule-note-bullet">${escape(bullet[1])}</p>`;
        return line ? `<p>${escape(line)}</p>` : '';
      })
      .join('');
  }
  function render(next) {
    if (!next?.phase) return;
    const captionsChanged = Array.isArray(next.captions);
    if (!captionsChanged)
      next = { ...next, captions: state?.meetingId === next.meetingId ? state.captions : [] };
    const changed =
      state?.meetingId !== next.meetingId ||
      ['playing', 'playback-paused'].includes(state?.phase) !==
        ['playing', 'playback-paused'].includes(next.phase);
    const previousError = state?.error;
    const previousCaption = state?.activeCaptionId;
    const wasExpanded = expanded;
    state = next;
    if (state.error) showError({ message: state.error });
    else if (previousError) select('#capsule-error').hidden = true;
    if (changed) {
      ++expandRevision;
      closingAnimation?.cancel();
      closingAnimation = null;
      pinned = false;
      follow = true;
      setTab('captions');
    }
    expanded = Boolean(state.expanded);
    panel.hidden = !expanded;
    if (!expanded) {
      closingAnimation?.cancel();
      closingAnimation = null;
    }
    select('#capsule-preview').setAttribute('aria-expanded', String(expanded));
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.lang = state.locale;
    document.body.dataset.phase = state.phase;
    document.body.dataset.above = String(Boolean(state.above));
    document.body.style.setProperty('--capsule-offset', `${state.pillOffset || 0}px`);
    select('#capsule-title').textContent = state.title;
    select('#capsule-title').title = state.title;
    select('#capsule-status').textContent = t(
      {
        playing: '正在播放',
        'playback-paused': '已暂停',
        recording: '录音中',
        paused: '已暂停',
        saving: '正在保存录音',
        failed: '保存失败',
        saved: '已保存',
        idle: '未在录音',
      }[state.phase],
    );
    select('#capsule-status').title = select('#capsule-status').textContent;
    select('#capsule-time').textContent = new Date(state.elapsed * 1000)
      .toISOString()
      .slice(state.elapsed >= 3600 ? 11 : 14, 19);
    meter.style.setProperty('--level', state.phase === 'recording' ? state.level : 0);
    meter.hidden = ['saving', 'saved', 'failed', 'idle', 'playing', 'playback-paused'].includes(
      state.phase,
    );
    select('[role="tablist"]').setAttribute('aria-label', t('展开字幕与笔记'));
    select('#captions-tab').textContent = t('实时字幕');
    select('#notes-tab').textContent = t('笔记');
    // 逐段更新正文，保留滚动容器和已确认节点，电平刷新不会重建阅读内容。
    if (captionsChanged) {
      const existing = new Map([...captions.children].map((node) => [node.dataset.id, node]));
      let previous = null;
      for (const entry of state.captions) {
        let node = existing.get(entry.id);
        if (!node) {
          node = document.createElement('article');
          node.className = 'capsule-line';
          node.dataset.id = entry.id;
          node.innerHTML =
            '<time></time><div><p><span data-caption-text></span><span class="button-spinner capsule-progress" role="img" hidden></span></p><p class="capsule-translation"></p></div>';
          captions.append(node);
        }
        if (node !== (previous ? previous.nextSibling : captions.firstChild))
          captions.insertBefore(node, previous ? previous.nextSibling : captions.firstChild);
        previous = node;
        existing.delete(entry.id);
        node.dataset.draft = String(entry.draft);
        const time = node.querySelector('time'),
          text = node.querySelector('[data-caption-text]'),
          progress = node.querySelector('.capsule-progress'),
          translation = node.querySelector('.capsule-translation');
        if (time.textContent !== entry.time) time.textContent = entry.time;
        if (text.textContent !== entry.text) text.textContent = entry.text;
        progress.hidden = !entry.draft || state.phase !== 'recording';
        progress.setAttribute('aria-label', t('识别中'));
        progress.title = t('识别中');
        if (translation.textContent !== entry.translation)
          translation.textContent = entry.translation;
        translation.hidden = !entry.translation;
      }
      existing.forEach((node) => node.remove());
      if (!state.captions.length)
        captions.innerHTML = `<div class="capsule-empty">${escape(state.captionNotice || t(['playing', 'playback-paused'].includes(state.phase) ? '暂无内容' : '等待语音'))}${state.captionNotice ? `<p><button data-action="models" type="button">${escape(t('模型库'))}</button></p>` : ''}</div>`;
    }
    const previousCurrent = captions.querySelector('[aria-current="true"]');
    if (previousCurrent?.dataset.id !== state.activeCaptionId) {
      previousCurrent?.removeAttribute('aria-current');
      if (previousCurrent) delete previousCurrent.dataset.current;
      const current =
        state.activeCaptionId &&
        captions.querySelector(`[data-id="${CSS.escape(state.activeCaptionId)}"]`);
      if (current) {
        current.dataset.current = 'true';
        current.setAttribute('aria-current', 'true');
      }
    }
    if (
      follow &&
      (!['playing', 'playback-paused'].includes(state.phase) ||
        (state.activeCaptionId &&
          (previousCaption !== state.activeCaptionId || (!wasExpanded && expanded))))
    )
      scrollToCurrentCaption();
    const suggestion = state.suggestion;
    const suggestionHtml = suggestion
      ? `<section class="capsule-suggestion"><h3>${escape(t('待采纳建议'))}</h3><p>${escape(suggestion.text)}</p><div class="capsule-suggestion-actions"><button data-action="accept" type="button">${escape(t('采纳'))}</button><button data-action="ignore" type="button">${escape(t('忽略'))}</button></div></section>`
      : '';
    if (select('#capsule-suggestion').innerHTML !== suggestionHtml)
      select('#capsule-suggestion').innerHTML = suggestionHtml;
    const notesHtml = state.notes
      ? `<h3>${escape(t('本场笔记'))}</h3><div class="capsule-note-copy">${notePreview(state.notes)}</div>`
      : '';
    if (select('#capsule-notes').innerHTML !== notesHtml)
      select('#capsule-notes').innerHTML = notesHtml;
    renderControls();
  }
  const shell = select('.capsule-shell');
  shell.addEventListener('pointerenter', () => {
    clearTimeout(closeTimer);
    if (closingAnimation) void expand(true);
  });
  // 靠近暂停或结束时保持位置稳定，只有读数和字幕按钮触发悬停预览。
  document.querySelectorAll('.capsule-identity, .capsule-preview').forEach((trigger) => {
    trigger.addEventListener('pointerenter', () => {
      if (!expanded && !pointerDown) openTimer = setTimeout(() => void expand(true), 250);
    });
    trigger.addEventListener('pointerleave', () => clearTimeout(openTimer));
  });
  function scheduleClose() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    const keyboardInside =
      document.documentElement.hasAttribute('data-keyboard-navigation') &&
      panel.contains(document.activeElement);
    if (!pinned && !pointerDown && !keyboardInside)
      closeTimer = setTimeout(() => void expand(false), 350);
  }
  shell.addEventListener('pointerleave', scheduleClose);
  document.addEventListener('pointerdown', () => {
    pointerDown = true;
    suppressClick = false;
  });
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    if (!shell.matches(':hover')) scheduleClose();
  });
  select('#capsule-preview').onclick = () => {
    // 悬停已经展开时，点击保留面板，避免刚想阅读就将它收起。
    pinned = !(expanded && pinned);
    renderControls();
    void expand(pinned);
  };
  select('#capsule-pin').onclick = () => {
    pinned = !pinned;
    renderControls();
  };
  function scrollToCurrentCaption() {
    const current = captions.querySelector('[data-current="true"]');
    if (!current) {
      if (['playing', 'playback-paused'].includes(state?.phase)) return;
      captionBody.scrollTop = captionBody.scrollHeight;
      return;
    }
    const bounds = captionBody.getBoundingClientRect();
    const row = current.getBoundingClientRect();
    captionBody.scrollTop +=
      row.top - bounds.top - Math.max(0, (captionBody.clientHeight - row.height) / 2);
  }
  select('#capsule-follow').onclick = () => {
    follow = true;
    scrollToCurrentCaption();
    renderControls();
  };
  captionBody.addEventListener('scroll', () => {
    if (tab !== 'captions' || !expanded) return;
    const current = state?.activeCaptionId && captions.querySelector('[data-current="true"]');
    if (current) {
      const body = captionBody.getBoundingClientRect(),
        row = current.getBoundingClientRect();
      follow = row.bottom > body.top && row.top < body.bottom;
    } else
      follow = captionBody.scrollHeight - captionBody.scrollTop - captionBody.clientHeight < 24;
    renderControls();
  });
  document.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) setTab(tabButton.dataset.tab);
    const button = event.target.closest('[data-action]');
    if (button) void action(button.dataset.action);
  });
  document.addEventListener('keydown', (event) => {
    suppressClick = false;
    if (event.key === 'Escape') {
      pinned = false;
      void expand(false);
      select('#capsule-preview').focus();
    }
    if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      setTab(tab === 'captions' ? 'notes' : 'captions');
      select(`[data-tab="${tab}"]`).focus();
    }
  });
  const pill = select('.recording-pill');
  pill.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.capsule-pause, .capsule-stop')) return;
    suppressClick = false;
    drag = { x: event.screenX, y: event.screenY, moved: false };
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  });
  pill.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.screenX - drag.x,
      dy = event.screenY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) <= 3) return;
    if (!drag.moved) {
      drag.moved = true;
      pill.setPointerCapture(event.pointerId);
      pill.classList.add('is-dragging');
    }
    drag.x = event.screenX;
    drag.y = event.screenY;
    if (dx || dy) void bridge.move({ dx, dy }).catch(showError);
  });
  function finishDrag() {
    if (!drag) return;
    suppressClick = drag.moved;
    drag = null;
    pointerDown = false;
    pill.classList.remove('is-dragging');
  }
  document.addEventListener('pointerup', finishDrag);
  document.addEventListener('pointercancel', finishDrag);
  pill.addEventListener('lostpointercapture', finishDrag);
  // 捕获阶段拦住拖动后的 click，避免触发 Logo 返回或字幕展开。
  pill.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.brevia.on('desktop.level', ({ meetingId, level }) => {
    if (state?.meetingId !== meetingId || state.phase !== 'recording') return;
    state.level = level;
    meter.style.setProperty('--level', level);
  });
  window.brevia.on('desktop.state', render);
  void bridge.state().then(render).catch(showError);
})();
