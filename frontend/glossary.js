// 显示术语保留原词；引用与已保存的逐字稿不改写。
const glossaryUI = (() => {
  let state = { entries: [], mentions: [] },
    seq = 0,
    timer,
    active,
    seen = new Set();
  let queueTimer,
    queuePaused = false;
  let hydrated = false,
    additions = 0,
    additionTimer,
    sourceAudio,
    sourceAudioUrl,
    sourcePlaybackVersion = 0,
    configSaving = false;
  const promptedMeetings = new Set();
  let scope = '';
  let libraryDraft;
  const prompt = document.querySelector('#glossary-prompt');
  const defaultMeanings = new Set([
    '自动语音识别（Automatic Speech Recognition），将语音转换为文字。',
    '大语言模型（Large Language Model），通过大量文本训练，可用于生成和理解语言。',
    '检索增强生成（Retrieval-Augmented Generation），先检索相关资料，再用资料支持模型生成回答。',
  ]);
  const displayMeaning = (meaning) => (defaultMeanings.has(meaning) ? t(meaning) : meaning);

  const scopes = () => [
    { id: '', name: t('全局通用') },
    { id: 'public', name: t('公开工作区') },
    ...workspaces,
  ];
  const pending = () => state.mentions.filter((m) => !m.name);
  const badge = (count) =>
    count ? `<span class="glossary-count" aria-hidden="true">${count}</span>` : '';
  function setCount(button, count) {
    if (!button) return;
    let tag = button.querySelector('.glossary-count');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'glossary-count';
      tag.setAttribute('aria-hidden', 'true');
      button.insertBefore(tag, button.querySelector(':scope > .interface-icon:last-child'));
    }
    tag.textContent = count;
    tag.hidden = !count;
  }
  function showAddition() {
    clearTimeout(additionTimer);
    additionTimer = null;
    if (!additions || document.hidden || !pending().length) {
      additions = 0;
      return;
    }
    const button = document.querySelector('#open-glossary');
    const count = additions > 4 ? additions - 3 : 1;
    additions -= count;
    const plus = document.createElement('span');
    plus.className = 'glossary-increment';
    plus.textContent = '+' + count;
    plus.setAttribute('aria-hidden', 'true');
    button.append(plus);
    setTimeout(() => plus.remove(), 800);
    if (additions) additionTimer = setTimeout(showAddition, 480);
  }
  function updateIndicators(added = 0) {
    const config = state.settings || { enabled: true, sensitivity: 'balanced' };
    const toggle = settingsModal.querySelector('[data-glossary-enabled]');
    if (toggle) {
      toggle.setAttribute('aria-checked', String(config.enabled));
      toggle.disabled = configSaving;
    }
    for (const level of settingsModal.querySelectorAll('[data-glossary-sensitivity]')) {
      level.disabled = configSaving || !config.enabled;
      level.setAttribute(
        'aria-checked',
        String(level.dataset.glossarySensitivity === config.sensitivity),
      );
    }
    const button = document.querySelector('#open-glossary');
    const count = pending().length;
    setCount(button, count);
    const pendingButton = settingsModal.querySelector('[data-scope="pending"]');
    setCount(pendingButton, count);
    pendingButton?.setAttribute('aria-label', t('待确认名词：{n}').replace('{n}', count));
    const scanning = Boolean(state.scanning?.length);
    button.classList.toggle('is-scanning', scanning);
    const label = t('术语库') + ' · ' + t('待确认名词：{n}').replace('{n}', count);
    button.setAttribute('aria-label', label);
    button.title = label + (scanning ? ' · ' + t('正在检查术语') : '');
    if (added && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      additions += added;
      if (!additionTimer) showAddition();
    }
    const regenerate = document.querySelector('#detail-view [data-regenerate-summary]');
    const changed = state.regeneration?.some((m) => m.id === currentMeetingDetail?.id);
    document.querySelector('.glossary-regeneration-hint')?.remove();
    if (changed && regenerate && !summaryGeneratingMeetingId) {
      const hint = document.createElement('span');
      hint.className = 'glossary-regeneration-hint';
      hint.textContent = t('术语已更新');
      hint.title = t('重新生成可将已确认的术语用于整场纪要与鱼骨图');
      regenerate.before(hint);
    }
  }
  function schedulePrompt() {
    clearTimeout(queueTimer);
    if (
      active ||
      state.settings?.enabled === false ||
      queuePaused ||
      document.hidden ||
      (typeof onboardingPage !== 'undefined' && onboardingPage)
    )
      return;
    queueTimer = setTimeout(() => {
      if (
        active ||
        state.settings?.enabled === false ||
        queuePaused ||
        document.hidden ||
        (typeof onboardingPage !== 'undefined' && onboardingPage)
      )
        return;
      const candidates = pending().filter(
        (m) => promptedMeetings.has(m.meeting_id) && !seen.has(key(m)),
      );
      const mention =
        candidates.find((m) => m.meeting_id === currentMeetingDetail?.id) || candidates[0];
      if (mention) ask(mention, true);
    }, 1200);
  }
  const key = (m) => JSON.stringify([m.meeting_id, m.original]);
  function matches(mentions = state.mentions) {
    const terms = mentions
      .filter(
        (m) =>
          m.meeting_id === currentMeetingDetail?.id &&
          m.name &&
          (!m.scope || m.scope === (currentMeetingDetail.workspace_id || 'public')),
      )
      .sort((a, b) => b.original.length - a.original.length);
    const re = new RegExp(
      terms
        .map(
          (m) =>
            (/^[a-z0-9]/i.test(m.original) ? '(?<![A-Za-z0-9_])' : '') +
            m.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            (/[a-z0-9]$/i.test(m.original) ? '(?![A-Za-z0-9_])' : ''),
        )
        .join('|'),
      'gu',
    );
    return { terms, re };
  }
  function paint(root, mentions) {
    if (!root) {
      updateIndicators();
      for (const target of document.querySelectorAll(
        '#detail-view .summary-body, #detail-view .detail-cause-rail h4, #detail-view .detail-cause-rail summary strong',
      ))
        paint(target, mentions);
      return;
    }
    root.querySelectorAll('.glossary-term').forEach((el) => el.replaceWith(el.dataset.original));
    root.normalize();
    const { terms, re } = matches(mentions);
    if (!terms.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes = [];
    while (walker.nextNode())
      if (
        !walker.currentNode.parentElement.closest('button,a,code,pre') &&
        (!walker.currentNode.parentElement.closest('details') ||
          root.closest('.detail-cause-rail summary'))
      )
        nodes.push(walker.currentNode);
    for (const node of nodes) {
      let pos = 0;
      const frag = document.createDocumentFragment();
      for (const hit of node.data.matchAll(re)) {
        const m = terms.find((t) => t.original === hit[0]);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'glossary-mark';
        button.textContent = m.name;
        const term = document.createElement('span');
        term.className = 'glossary-term';
        term.dataset.original = m.original;
        const info = document.createElement('span');
        info.className = 'glossary-term-info';
        const original = t('原词') + ' · ' + m.original;
        button.setAttribute(
          'aria-label',
          m.name + ' · ' + original + ' · ' + displayMeaning(m.meaning),
        );
        info.append(original, document.createElement('br'), displayMeaning(m.meaning));
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.textContent = t('恢复原词');
        restore.onclick = () =>
          update({ action: 'dismiss', meeting_id: m.meeting_id, original: m.original }).catch(
            reportError,
          );
        info.append(restore);
        term.append(button, info);
        frag.append(node.data.slice(pos, hit.index), term);
        pos = hit.index + hit[0].length;
      }
      if (pos) {
        frag.append(node.data.slice(pos));
        node.replaceWith(frag);
      }
    }
  }
  async function refresh() {
    const id = ++seq;
    const result = await window.brevia.glossary.list();
    if (id === seq) {
      const libraryChanged = ['entries', 'mentions', 'regeneration', 'scanning'].some(
        (field) => JSON.stringify(state[field]) !== JSON.stringify(result[field]),
      );
      const previous = new Set(pending().map(key));
      state = result;
      if (state.settings?.enabled === false) closePrompt();
      paint();
      updateIndicators(hydrated ? pending().filter((m) => !previous.has(key(m))).length : 0);
      hydrated = true;
      if (active && !pending().some((m) => key(m) === key(active))) closePrompt(false);
      if (
        libraryChanged &&
        activeModal === 'glossary' &&
        !settingsModal.querySelector('[data-editor] form')
      )
        render();
      schedulePrompt();
    }
  }
  async function update(p) {
    await window.brevia.glossary.update(p);
    await refresh();
    if (p.action === 'resolve') void reviewMeaning(p);
  }
  async function reviewMeaning(p) {
    const config = summaryConfig.enabled ? requestConfig(summaryConfig) : null;
    if (!config || !window.brevia.glossary.review) return;
    try {
      const result = await window.brevia.glossary.review({
        meeting_id: p.meeting_id,
        original: p.original,
        provider: config.provider,
        model: config.model,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        format: config.format,
        key_reference: config.keyReference,
        consent: true,
      });
      if (
        result?.summary &&
        currentMeetingDetail?.id === p.meeting_id &&
        activeView === 'detail' &&
        !uiData.detail.summaryEditing &&
        !uiData.detail.notesEditing &&
        !uiData.detail.transcriptEditing &&
        !summaryGeneratingMeetingId &&
        uiData.detail.summary?.markdown === result.before
      ) {
        applyBackendDetail({ ...currentMeetingDetail, summary: { data: result.summary } });
        revealSummaryUpdates(true);
      }
    } catch (error) {
      if (/cancel|abort/i.test(error.message)) return;
      showToast(t('术语理解更新失败，已保留词条。'), undefined, 'error');
    }
  }
  const reportError = (error) => showToast(error.detail || error.message, undefined, 'error');
  function stopPlayback() {
    sourcePlaybackVersion++;
    const audio = sourceAudio;
    sourceAudio = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (sourceAudioUrl) URL.revokeObjectURL(sourceAudioUrl);
    sourceAudioUrl = null;
  }
  function form(m, target, entry) {
    return `<form class="glossary-form">
      <label>${t('术语名称')}<input name="name" required maxlength="80" value="${escapeHtml(entry?.name || m?.suggestion || m?.original || '')}"></label>
      <label>${t('释义')}<textarea name="meaning" ${m || entry ? '' : 'required'} maxlength="1000" rows="2" placeholder="${t('这个词在会议中指什么？')}">${escapeHtml(entry?.meaning || m?.suggestion_meaning || '')}</textarea></label>
      <footer>${
        m
          ? `<div class="glossary-scope" title="${t('保存到工作区')}">${interfaceIcon('folder')}${desktopSelect(
              'scope',
              target,
              scopes().map((w) => [w.id, w.name]),
            )}</div><button type="button" class="secondary" data-dismiss>${t('不是术语')}</button>`
          : ''
      }${!m ? `<button type="button" class="secondary" data-cancel>${t('取消')}</button>` : ''}<button class="modal-action">${t(m ? '确认' : '保存')}</button></footer></form>`;
  }
  function bind(container, m, target, entry) {
    const f = container.querySelector('form');
    if (!m) libraryDraft = { scope: target, mode: entry ? 'edit' : 'add', form: f };
    const cancel = f.querySelector('[data-cancel]');
    if (cancel)
      cancel.onclick = () => {
        if (!f.dataset.saving) {
          if (libraryDraft?.form === f) libraryDraft = null;
          render(entry?.name ?? null);
        }
      };
    f.onkeydown = (event) => {
      if (
        event.key !== 'Enter' ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.shiftKey ||
        event.target.closest?.('button,.flow-select')
      )
        return;
      event.preventDefault();
      if (!f.dataset.saving) f.requestSubmit();
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.dataset.saving) return;
      f.dataset.saving = 'true';
      const submit = f.querySelector('.modal-action');
      submit.disabled = true;
      const { name, meaning } = f.elements;
      try {
        await update({
          action: m ? 'resolve' : entry ? 'edit' : 'save',
          ...(entry && { original_name: entry.name }),
          workspace_id: f.elements.scope?.value ?? target,
          name: name.value,
          meaning: meaning.value,
          ...(m && { meeting_id: m.meeting_id, original: m.original }),
        });
        if (!m) {
          if (libraryDraft?.form === f) libraryDraft = null;
          if (f.isConnected && activeModal === 'glossary') render(entry ? name.value.trim() : null);
        }
      } catch (error) {
        reportError(error);
      } finally {
        delete f.dataset.saving;
        submit.disabled = false;
      }
    };
  }
  function preserveEditor(lib) {
    const form = lib.querySelector('[data-editor] form');
    if (!form) return false;
    const saving = Boolean(form.dataset.saving);
    const dirty = [...form.querySelectorAll('input, textarea')].some(
      (input) => input.value !== input.defaultValue,
    );
    if (!saving && !dirty) return false;
    showToast(t(saving ? '正在保存…' : '已修改 · 尚未保存'));
    form.querySelector('input, textarea, button')?.focus();
    return true;
  }
  function render(focusName) {
    if (libraryDraft && !libraryDraft.form.isConnected) scope = libraryDraft.scope;
    const groups = [...scopes(), { id: 'pending', name: t('待处理') }];
    const selected = groups.find((g) => g.id === scope) || groups[0];
    scope = selected.id;
    const queue = scope === 'pending';
    const config = state.settings || { enabled: true, sensitivity: 'balanced' };
    const rows = queue ? pending() : state.entries.filter((e) => e.scope === scope);
    const navigation = groups
      .map(
        (g) =>
          `<button type="button" class="speaker-person" data-scope="${escapeHtml(g.id)}" aria-pressed="${g.id === scope}">${interfaceIcon(g.id === 'pending' ? 'clock' : g.id ? 'folder' : 'notebook')}<span><b>${escapeHtml(g.name)}</b></span>${g.id === 'pending' ? badge(pending().length) : ''}${interfaceIcon('chevron-right')}</button>`,
      )
      .join('');
    settingsModal.querySelector('.modal-title h2').textContent = t('术语库');
    settingsModal.querySelector('.modal-title p').textContent = '';
    replaceModalBody(
      'glossary',
      `<div id="glossary-library" class="preferences-speakers speaker-manager">
      <aside class="preferences-people speaker-directory"><div class="speaker-profile-list">${navigation}</div></aside>
      <section class="preferences-person speaker-profile-detail"><div class="glossary-preferences"><label>${t('自动识别术语')}<button type="button" class="preference-toggle" data-glossary-enabled role="switch" aria-label="${t('自动识别术语')}" aria-checked="${config.enabled}"><span></span></button></label><div class="glossary-sensitivity flow-select onboarding-ai-segments" role="radiogroup" aria-label="${t('触发程度')}"><div class="flow-select-options">${[
        ['low', '低'],
        ['balanced', '适中'],
        ['high', '高'],
      ]
        .map(
          ([value, label]) =>
            `<button type="button" role="radio" data-glossary-sensitivity="${value}" data-value="${{ low: 'quiet', balanced: 'assist', high: 'auto' }[value]}" aria-checked="${config.sensitivity === value}"${config.enabled ? '' : ' disabled'}>${t(label)}</button>`,
        )
        .join(
          '',
        )}</div></div></div><header class="speaker-detail-header"><div><h2>${escapeHtml(selected.name)}</h2><small>${escapeHtml(t(queue ? '待确认名词：{n}' : '术语：{n}').replace('{n}', rows.length))}</small></div>${!queue || rows.length ? `<button type="button" class="secondary" data-action>${queue ? t('清空队列') : t('添加术语')}</button>` : ''}</header>
      ${queue ? `<div class="glossary-queue-status" role="status">${(state.scanning || []).map((s) => `<p>${escapeHtml(s.title)} · ${t('正在检查术语')} · ${s.completed}/${s.total}</p>`).join('')}${(state.regeneration || []).map((m) => `<div class="glossary-regenerate"><span><b>${escapeHtml(m.title)}</b><small>${t('重新生成可将已确认的术语用于整场纪要与鱼骨图')}</small></span><button type="button" class="secondary" data-regenerate="${escapeHtml(m.id)}"${summaryGeneratingMeetingId ? ' disabled' : ''}>${t('重新生成')}</button></div>`).join('')}</div>` : ''}
      <section class="preferences-section glossary-list"><div data-editor hidden></div>${rows.length ? (queue ? rows.map((m, i) => `<button class="glossary-row" data-mention="${i}"><b>${escapeHtml(m.original)}</b><small>${escapeHtml(m.title)}</small>${interfaceIcon('chevron-right')}</button>`).join('') : `<dl>${rows.map((e, i) => `<div><dt title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</dt><dd>${escapeHtml(displayMeaning(e.meaning))}</dd><dd class="glossary-entry-actions"><button type="button" class="icon-button" data-edit="${i}" title="${t('编辑')}" aria-label="${escapeHtml(t('编辑') + ' · ' + e.name)}">${interfaceIcon('edit')}</button><button type="button" class="icon-button" data-delete="${i}" title="${t('删除')}" aria-label="${escapeHtml(t('删除') + ' · ' + e.name)}">${interfaceIcon('trash')}</button></dd></div>`).join('')}</dl>`) : `<p class="page-empty">${queue ? t('暂无待确认名词') : t('暂无术语')}</p>`}</section></section></div>`,
    );
    const lib = settingsModal.querySelector('#glossary-library');
    lib.querySelector('.glossary-sensitivity').onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
      const at = buttons.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (at + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    };
    for (const b of lib.querySelectorAll('[data-glossary-enabled],[data-glossary-sensitivity]'))
      b.onclick = async () => {
        if (configSaving) return;
        const focused = document.activeElement === b;
        configSaving = true;
        const current = state.settings || config;
        updateIndicators();
        try {
          await update({
            action: 'settings',
            enabled: b.hasAttribute('data-glossary-enabled') ? !current.enabled : current.enabled,
            sensitivity: b.dataset.glossarySensitivity || current.sensitivity,
          });
        } catch (error) {
          reportError(error);
        } finally {
          configSaving = false;
          updateIndicators();
          if (focused && b.isConnected && document.activeElement === document.body)
            b.focus({ preventScroll: true });
        }
      };
    for (const b of lib.querySelectorAll('[data-scope]'))
      b.onclick = () => {
        if (preserveEditor(lib)) return;
        libraryDraft = null;
        scope = b.dataset.scope;
        render();
        settingsModal.querySelector('[data-scope][aria-pressed="true"]').focus();
      };
    for (const b of lib.querySelectorAll('[data-mention]'))
      b.onclick = () => ask(rows[Number(b.dataset.mention)], false);
    for (const b of lib.querySelectorAll('[data-regenerate]'))
      b.onclick = async () => {
        closePrompt();
        await generateMeetingSummary(b.dataset.regenerate);
        await refresh();
        if (activeModal === 'glossary') render();
      };
    for (const b of lib.querySelectorAll('[data-edit]'))
      b.onclick = () => {
        if (preserveEditor(lib)) return;
        const entry = rows[Number(b.dataset.edit)];
        const editor = lib.querySelector('[data-editor]');
        editor.hidden = false;
        editor.dataset.mode = 'edit';
        editor.innerHTML = form(null, scope, entry);
        bind(editor, null, scope, entry);
        editor.querySelector('input').focus();
      };
    for (const b of lib.querySelectorAll('[data-delete]'))
      b.onclick = () => {
        if (preserveEditor(lib)) return;
        libraryDraft = null;
        const entry = rows[Number(b.dataset.delete)];
        const editor = lib.querySelector('[data-editor]');
        editor.hidden = false;
        editor.dataset.mode = 'delete';
        editor.innerHTML = `<form class="glossary-form"><b>${escapeHtml(entry.name)}</b><p>${t('删除此术语及其别名关联？会议原文将保留。')}</p><footer><button type="button" class="secondary" data-cancel>${t('取消')}</button><button class="modal-action modal-danger">${t('删除')}</button></footer></form>`;
        const f = editor.querySelector('form');
        f.querySelector('[data-cancel]').onclick = () => {
          if (!f.dataset.saving) render(entry.name);
        };
        f.onsubmit = async (event) => {
          event.preventDefault();
          if (f.dataset.saving) return;
          f.dataset.saving = 'true';
          const submit = f.querySelector('.modal-action');
          submit.disabled = true;
          try {
            await update({ action: 'delete', workspace_id: entry.scope, name: entry.name });
            if (f.isConnected && activeModal === 'glossary') render(null);
          } catch (error) {
            reportError(error);
          } finally {
            delete f.dataset.saving;
            submit.disabled = false;
          }
        };
        f.querySelector('[data-cancel]').focus();
      };
    const action = lib.querySelector('[data-action]');
    if (action)
      action.onclick = () => {
        if (queue) return update({ action: 'clear' }).catch(reportError);
        if (preserveEditor(lib)) return;
        const editor = lib.querySelector('[data-editor]');
        editor.hidden = false;
        if (!editor.firstChild || editor.dataset.mode !== 'add') {
          editor.dataset.mode = 'add';
          editor.innerHTML = form(null, scope);
          bind(editor, null, scope);
        }
        editor.querySelector('input').focus();
      };
    if (libraryDraft?.scope === scope) {
      const editor = lib.querySelector('[data-editor]');
      editor.hidden = false;
      editor.dataset.mode = libraryDraft.mode;
      editor.replaceChildren(libraryDraft.form);
    }
    updateIndicators();
    if (focusName !== undefined) {
      const index = rows.findIndex((entry) => entry.name === focusName);
      (lib.querySelector(`[data-edit="${index}"]`) || action)?.focus();
    }
  }
  function closePrompt(defer = true) {
    if (defer) queuePaused = true;
    clearTimeout(queueTimer);
    clearTimeout(timer);
    stopPlayback();
    prompt.hidePopover();
    active = null;
  }
  function promptContent(m, questionId = 'glossary-question', source = '') {
    return `<header><span>${interfaceIcon('notebook')}${t('发现未知名词')}<small>· ${escapeHtml(m.title)}</small></span><button data-close aria-label="${t('关闭')}">${interfaceIcon('close')}</button></header>
      <h3 id="${questionId}">${escapeHtml(m.suggestion && m.suggestion !== m.original ? t('这里的“{term}”是否指“{suggestion}”？').replace('{term}', m.original).replace('{suggestion}', m.suggestion) : t('“{term}”是专业术语吗？').replace('{term}', m.original))}</h3>
      ${m.reason ? `<p class="glossary-reason">${escapeHtml(m.reason)}</p>` : ''}<div class="glossary-source"${source ? '' : ' hidden'}>${source}</div>${form(m, m.workspace_id || 'public')}`;
  }
  function ask(m, timed, loadSource = window.brevia.glossary.source) {
    if (active) {
      if (timed) return;
      closePrompt(false);
    }
    clearTimeout(queueTimer);
    if (!timed) {
      queuePaused = false;
      promptedMeetings.add(m.meeting_id);
    }
    active = m;
    seen.add(key(m));
    prompt.innerHTML = promptContent(m);
    prompt.querySelector('[data-close]').onclick = () => closePrompt();
    bind(prompt, m);
    prompt.querySelector('[data-dismiss]').onclick = () =>
      update({ action: 'dismiss', meeting_id: m.meeting_id, original: m.original }).catch(
        reportError,
      );
    prompt.onfocusin = prompt.oninput = () => clearTimeout(timer);
    const sourceBox = prompt.querySelector('.glossary-source');
    loadSource({ meeting_id: m.meeting_id, original: m.original })
      .then((source) => {
        if (!sourceBox.isConnected || active !== m) return;
        const index = source?.text.indexOf(m.original) ?? -1;
        if (index < 0 && timed) {
          closePrompt(false);
          schedulePrompt();
          return;
        }
        if (index < 0) {
          sourceBox.textContent = t('当前转写中未找到原词');
        } else {
          const before = source.text.slice(0, index);
          const after = source.text.slice(index + m.original.length);
          // 超长段落只展示命中位置附近的原话。
          const left = Math.max(0, before.length - 55);
          const right = Math.min(after.length, 80);
          sourceBox.innerHTML = `<div class="glossary-source-heading"><small>${t('转写原文')} · ${escapeHtml(formatMeetingTime(source.start_ms))}</small>${source.audio_path ? `<button type="button" data-play-source title="${t('播放原文')}" aria-label="${t('播放原文')}">${interfaceIcon('play')}</button>` : ''}</div><p>${left ? '…' : ''}${escapeHtml(before.slice(left))}<mark>${escapeHtml(m.original)}</mark>${escapeHtml(after.slice(0, right))}${right < after.length ? '…' : ''}</p>`;
          const play = sourceBox.querySelector('[data-play-source]');
          if (play)
            play.onclick = async () => {
              if (play.disabled) return;
              clearTimeout(timer);
              if (sourceAudio && !sourceAudio.paused) {
                sourceAudio.pause();
                return;
              }
              play.disabled = true;
              const version = sourcePlaybackVersion;
              let deadline;
              try {
                const timeout = new Promise((_, reject) => {
                  deadline = setTimeout(() => reject(new Error(t('播放失败'))), 12000);
                });
                const bounded = (request) => Promise.race([request, timeout]);
                if (!sourceAudio) {
                  const url = await bounded(
                    window.brevia.glossary.audio({
                      meeting_id: m.meeting_id,
                      original: m.original,
                    }),
                  );
                  if (active !== m || !play.isConnected || version !== sourcePlaybackVersion)
                    return;
                  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) =>
                    c.charCodeAt(0),
                  );
                  sourceAudioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
                  sourceAudio = new Audio(sourceAudioUrl);
                  const audio = sourceAudio;
                  const reset = () => {
                    play.innerHTML = interfaceIcon('play');
                    play.title = t('播放原文');
                    play.setAttribute('aria-label', play.title);
                  };
                  audio.onpause = audio.onended = reset;
                  audio.onerror = () => {
                    if (sourceAudio === audio) {
                      reset();
                      reportError(new Error(t('播放失败')));
                    }
                  };
                }
                playerAudio.pause();
                sourceAudio.currentTime = 0;
                await bounded(sourceAudio.play());
                if (active !== m) return;
                play.innerHTML = interfaceIcon('pause');
                play.title = t('暂停');
                play.setAttribute('aria-label', play.title);
              } catch (error) {
                if (active === m && play.isConnected && error.name !== 'AbortError') {
                  stopPlayback();
                  reportError(error);
                }
              } finally {
                clearTimeout(deadline);
                if (play.isConnected) play.disabled = false;
              }
            };
        }
        sourceBox.hidden = false;
        if (timed) {
          prompt.showPopover();
          timer = setTimeout(() => closePrompt(), 18000);
        }
      })
      .catch((error) => {
        if (active !== m) return;
        if (timed) {
          closePrompt(false);
          schedulePrompt();
        }
        reportError(error);
      });
    if (!timed) prompt.showPopover();
  }
  prompt.onkeydown = (e) => {
    if (e.key === 'Escape') {
      if (prompt.querySelector('.flow-select-options:not([hidden])')) return;
      e.stopPropagation();
      closePrompt();
    }
  };
  document.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Enter' ||
      event.repeat ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.shiftKey ||
      !active ||
      !prompt.matches(':popover-open') ||
      prompt.contains(event.target)
    )
      return;
    // 不截获用户在正文或其他表单中输入的回车。
    if (
      event.target.closest(
        'input,textarea,select,a,button,summary,[role="button"],[contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    event.preventDefault();
    const form = prompt.querySelector('form');
    if (!form.dataset.saving) form.requestSubmit();
  });
  prompt.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-flow-select-toggle]');
    const choice = e.target.closest('[data-flow-select-choice]');
    if (!toggle && !choice) return;
    e.stopPropagation();
    const select = (toggle || choice).closest('.flow-select');
    const list = select.querySelector('.flow-select-options');
    const trigger = select.querySelector('.flow-select-toggle');
    if (toggle) {
      list.hidden = !list.hidden;
      fitFlowSelectOptions(list, trigger);
    } else {
      select.querySelector('input').value = choice.dataset.value;
      trigger.firstChild.nodeValue = choice.dataset.label;
      for (const option of list.querySelectorAll('[data-value]')) {
        const selected = option.dataset.value === choice.dataset.value;
        option.setAttribute('aria-selected', String(selected));
        option.toggleAttribute('aria-current', selected);
      }
      list.hidden = true;
      trigger.focus({ preventScroll: true });
    }
    trigger.setAttribute('aria-expanded', String(!list.hidden));
  });
  document.querySelector('#open-glossary').onclick = async () => {
    if (activeModal === 'glossary') return;
    scope =
      pending().length || state.regeneration?.length || state.scanning?.length
        ? 'pending'
        : activeView === 'detail' && currentMeetingDetail
          ? currentMeetingDetail.workspace_id || 'public'
          : '';
    if (onboardingPage) await dismissOnboardingPage();
    if (activeView !== 'settings') await showView('settings');
    if (activeView === 'settings') await openModal('glossary');
  };
  window.addEventListener('brevia:language-changed', () => {
    paint();
    if (!active || prompt.querySelector('form')?.dataset.saving) return;
    const mention = active;
    const fields = [...prompt.querySelector('form').elements];
    const values = fields.filter((field) => field.name).map((field) => [field.name, field.value]);
    const focus = document.activeElement?.name;
    ask(mention, false);
    const form = prompt.querySelector('form');
    for (const [name, value] of values) form.elements[name].value = value;
    const trigger = form.querySelector?.('.flow-select-toggle');
    if (trigger)
      trigger.firstChild.nodeValue =
        scopes().find((s) => s.id === form.elements.scope.value)?.name || '';
    if (focus) form.elements[focus]?.focus();
  });
  window.brevia?.on('summary.ready', () => void refresh().catch(reportError));
  window.brevia?.on('glossary.updated', () => void refresh().catch(reportError));
  window.brevia?.on('glossary.failed', () =>
    showToast(t('本次术语识别未完成'), undefined, 'error'),
  );
  window.brevia?.on('summary.started', ({ meeting_id }) => {
    promptedMeetings.clear();
    promptedMeetings.add(meeting_id);
    queuePaused = false;
    for (const k of seen) if (JSON.parse(k)[0] === meeting_id) seen.delete(k);
  });
  document.addEventListener('visibilitychange', schedulePrompt);
  if (typeof playerAudio !== 'undefined') playerAudio.addEventListener('play', stopPlayback);
  if (window.brevia?.glossary) void refresh().catch(reportError);
  return {
    settings: () => state.settings || { enabled: true, sensitivity: 'balanced' },
    configure: (settings) => update({ action: 'settings', ...settings }),
    demo() {
      const meaning = t('自动语音识别（Automatic Speech Recognition），将语音转换为文字。');
      const sentence = escapeHtml(t('本次会议使用 {term} 生成转写，再整理为会议纪要。'));
      const original = sentence.replace('{term}', 'A S R');
      const result = sentence.replace('{term}', '<span class="glossary-mark">ASR</span>');
      const source = `<div class="glossary-source-heading"><small>${t('转写原文')} · 00:12</small><button type="button" data-play-source aria-label="${t('播放原文')}">${interfaceIcon('play')}</button></div><p>${sentence.replace('{term}', '<mark>A S R</mark>')}</p>`;
      return `<div class="glossary-demo" inert><div class="glossary-demo-line"><span class="glossary-demo-original">${original}</span><span class="glossary-demo-result">${result}</span></div><section class="glossary-demo-popup">${promptContent({ title: t('演示'), original: 'A S R', suggestion: 'ASR', suggestion_meaning: meaning }, 'glossary-demo-question', source)}</section></div>`;
    },
    ask,
    closePrompt,
    paint,
    render,
    refresh,
    stopPlayback,
    copy(markdown) {
      return replaceGlossaryMarkdown(markdown, matches().terms);
    },
  };
})();
