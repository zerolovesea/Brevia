// 显示术语保留原词；引用与已保存的逐字稿不改写。
const glossaryUI = (() => {
  let state = { entries: [], mentions: [] },
    seq = 0,
    timer,
    active,
    seen = new Set();
  let scope = '';
  const prompt = document.querySelector('#glossary-prompt');
  const scopes = () => [
    { id: '', name: t('全局通用') },
    { id: 'public', name: t('公开工作区') },
    ...workspaces,
  ];
  const scopeOptions = (value) =>
    scopes()
      .map(
        (w) =>
          `<option value="${escapeHtml(w.id)}" ${w.id === value ? 'selected' : ''}>${escapeHtml(w.name)}</option>`,
      )
      .join('');
  const pending = () => state.mentions.filter((m) => !m.name);
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
  function paint(root = document.querySelector('#detail-view .summary-body'), mentions) {
    if (!root) return;
    root.querySelectorAll('.glossary-term').forEach((el) => el.replaceWith(el.dataset.original));
    root.normalize();
    const { terms, re } = matches(mentions);
    if (!terms.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes = [];
    while (walker.nextNode())
      if (!walker.currentNode.parentElement.closest('button,a,details,code,pre'))
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
        button.setAttribute('aria-label', m.name + ' · ' + original + ' · ' + m.meaning);
        info.append(original, document.createElement('br'), m.meaning);
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
      state = result;
      paint();
      if (active && !pending().some((m) => key(m) === key(active))) closePrompt();
    }
  }
  async function update(p) {
    await window.brevia.glossary.update(p);
    await refresh();
    if (activeModal === 'glossary' && !settingsModal.querySelector('[data-editor] form')) render();
  }
  const reportError = (error) => showToast(error.detail || error.message, undefined, 'error');
  function form(m, target) {
    return `<form class="glossary-form">
      <label>${t('术语名称')}<input name="name" required maxlength="80" value="${escapeHtml(m?.original || '')}"></label>
      <label>${t('释义')}<textarea name="meaning" required maxlength="1000" rows="2" placeholder="${t('这个词在会议中指什么？')}"></textarea></label>
      <footer>${m ? `<label class="glossary-scope" title="${t('保存到工作区')}">${interfaceIcon('folder')}<select aria-label="${t('保存到工作区')}" name="scope">${scopeOptions(target)}</select>${interfaceIcon('chevron-down')}</label><button type="button" class="secondary" data-dismiss>${t('不是术语')}</button>` : ''}<button class="modal-action">${t('保存')}</button></footer></form>`;
  }
  function bind(container, m, target) {
    const f = container.querySelector('form');
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.dataset.saving) return;
      f.dataset.saving = 'true';
      const submit = f.querySelector('.modal-action');
      submit.disabled = true;
      const { name, meaning } = f.elements;
      try {
        await update({
          action: m ? 'resolve' : 'save',
          workspace_id: f.elements.scope?.value ?? target,
          name: name.value,
          meaning: meaning.value,
          ...(m && { meeting_id: m.meeting_id, original: m.original }),
        });
        if (!m && f.isConnected && activeModal === 'glossary') render();
      } catch (error) {
        reportError(error);
      } finally {
        delete f.dataset.saving;
        submit.disabled = false;
      }
    };
  }
  function render() {
    const groups = [...scopes(), { id: 'pending', name: t('待处理') }];
    const selected = groups.find((g) => g.id === scope) || groups[0];
    scope = selected.id;
    const queue = scope === 'pending';
    const rows = queue ? pending() : state.entries.filter((e) => e.scope === scope);
    const navigation = groups
      .map(
        (g) =>
          `<button type="button" class="speaker-person" data-scope="${escapeHtml(g.id)}" aria-pressed="${g.id === scope}">${interfaceIcon(g.id === 'pending' ? 'clock' : g.id ? 'folder' : 'notebook')}<span><b>${escapeHtml(g.name)}</b></span>${interfaceIcon('chevron-right')}</button>`,
      )
      .join('');
    settingsModal.querySelector('.modal-title h2').textContent = t('术语库');
    settingsModal.querySelector('.modal-title p').textContent = '';
    replaceModalBody(
      'glossary',
      `<div id="glossary-library" class="preferences-speakers speaker-manager">
      <aside class="preferences-people speaker-directory"><div class="speaker-profile-list">${navigation}</div></aside>
      <section class="preferences-person speaker-profile-detail"><header class="speaker-detail-header"><div><h2>${escapeHtml(selected.name)}</h2><small>${escapeHtml(t(queue ? '待确认名词：{n}' : '术语：{n}').replace('{n}', rows.length))}</small></div>${!queue || rows.length ? `<button type="button" class="secondary" data-action>${queue ? t('清空队列') : t('添加术语')}</button>` : ''}</header>
      <section class="preferences-section glossary-list"><div data-editor hidden></div>${rows.length ? (queue ? rows.map((m, i) => `<button class="glossary-row" data-mention="${i}"><b>${escapeHtml(m.original)}</b><small>${escapeHtml(m.title)}</small>${interfaceIcon('chevron-right')}</button>`).join('') : `<dl>${rows.map((e) => `<div><dt title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</dt><dd>${escapeHtml(e.meaning)}</dd></div>`).join('')}</dl>`) : `<p class="page-empty">${queue ? t('暂无待确认名词') : t('暂无术语')}</p>`}</section></section></div>`,
    );
    const lib = settingsModal.querySelector('#glossary-library');
    for (const b of lib.querySelectorAll('[data-scope]'))
      b.onclick = () => {
        scope = b.dataset.scope;
        render();
        settingsModal.querySelector('[data-scope][aria-pressed="true"]').focus();
      };
    for (const b of lib.querySelectorAll('[data-mention]'))
      b.onclick = () => ask(rows[Number(b.dataset.mention)], false);
    const action = lib.querySelector('[data-action]');
    if (action)
      action.onclick = () => {
        if (queue) return update({ action: 'clear' }).catch(reportError);
        const editor = lib.querySelector('[data-editor]');
        editor.hidden = false;
        if (!editor.firstChild) {
          editor.innerHTML = form(null, scope);
          bind(editor, null, scope);
        }
        editor.querySelector('input').focus();
      };
  }
  function closePrompt() {
    clearTimeout(timer);
    prompt.hidePopover();
    active = null;
  }
  function ask(m, timed, loadSource = window.brevia.glossary.source) {
    if (active) {
      if (timed) return;
      closePrompt();
    }
    active = m;
    seen.add(key(m));
    prompt.innerHTML = `<header><span>${interfaceIcon('notebook')}${t('发现未知名词')}<small>· ${escapeHtml(m.title)}</small></span><button data-close aria-label="${t('关闭')}">${interfaceIcon('close')}</button></header>
      <h3 id="glossary-question">${escapeHtml(t('“{term}”是专业术语吗？').replace('{term}', m.original))}</h3>
      <div class="glossary-source" hidden></div>${form(m, m.workspace_id || 'public')}`;
    prompt.querySelector('[data-close]').onclick = closePrompt;
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
        if (index < 0) {
          sourceBox.textContent = t('当前转写中未找到原词');
        } else {
          const before = source.text.slice(0, index);
          const after = source.text.slice(index + m.original.length);
          // 超长段落只展示命中位置附近的原话。
          const left = Math.max(0, before.length - 55);
          const right = Math.min(after.length, 80);
          sourceBox.innerHTML = `<small>${t('转写原文')} · ${escapeHtml(formatMeetingTime(source.start_ms))}</small><p>${left ? '…' : ''}${escapeHtml(before.slice(left))}<mark>${escapeHtml(m.original)}</mark>${escapeHtml(after.slice(0, right))}${right < after.length ? '…' : ''}</p>`;
        }
        sourceBox.hidden = false;
      })
      .catch(reportError);
    prompt.showPopover();
    if (timed) timer = setTimeout(closePrompt, 18000);
  }
  prompt.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePrompt();
    }
  };
  document.querySelector('#open-glossary').onclick = async () => {
    if (activeModal === 'glossary') return;
    scope =
      activeView === 'detail' && currentMeetingDetail
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
    if (focus) form.elements[focus]?.focus();
  });
  window.brevia?.on('glossary.updated', () => {
    void refresh()
      .then(() => {
        if (activeModal === 'glossary' && !settingsModal.querySelector('[data-editor] form'))
          render();
        const m = pending().find((v) => !seen.has(key(v)));
        if (m && !active) ask(m, true);
      })
      .catch(reportError);
  });
  window.brevia?.on('glossary.failed', () =>
    showToast(t('本次术语识别未完成'), undefined, 'error'),
  );
  if (window.brevia?.glossary) void refresh().catch(reportError);
  return {
    ask,
    closePrompt,
    paint,
    render,
    refresh,
    copy(markdown) {
      return replaceGlossaryMarkdown(markdown, matches().terms);
    },
  };
})();
