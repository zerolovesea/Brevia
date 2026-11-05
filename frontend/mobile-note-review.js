(() => {
  const api = window.brevia?.mobile;
  if (!api?.proposals) return;
  const trigger = document.getElementById('mobile-notes-pending');
  const dialog = document.createElement('dialog');
  dialog.className = 'mobile-note-review';
  dialog.setAttribute('aria-labelledby', 'mobile-review-title');
  dialog.innerHTML = `<header><h2 id="mobile-review-title"></h2><button type="button" class="icon-button" data-close>${interfaceIcon('close')}</button></header>
    <select data-choice></select><div class="mobile-note-columns"><section><h3 data-desk-title></h3><div data-desk></div></section><section><h3 data-phone-title></h3><div data-phone></div></section></div>
    <p role="status" data-message></p><footer><button class="secondary" data-keep></button><button class="modal-action" data-apply></button></footer>`;
  document.body.append(dialog);
  const el = (name) => dialog.querySelector(`[data-${name}]`);
  let rows = [];
  let preview = null;
  let reading = 0;
  let listing = 0;
  let busy = false;
  const live = (id) => meetingActive && breviaClient?.state.meeting?.id === id;
  const editing = (id) => currentMeetingDetail?.id === id && uiData.detail.notesEditing;
  function notice(key) {
    el('message').textContent = key ? t(key) : '';
  }
  // 仅嵌入当前会议自身的附件。其余 Markdown 保持可读，也不会触发外部网络请求。
  function showNotes(element, markdown, meetingId) {
    element.replaceChildren();
    let offset = 0;
    const images = /!\[([^\]\n]*)\]\((brevia-note:\/\/([^/]+)\/([\w.-]+))\)/gi;
    for (const match of markdown.matchAll(images)) {
      if (match[3] !== meetingId || !/^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/i.test(match[4]))
        continue;
      element.append(markdown.slice(offset, match.index));
      const img = document.createElement('img');
      img.src = match[2];
      img.alt = match[1];
      element.append(img);
      offset = match.index + match[0].length;
    }
    element.append(markdown.slice(offset) || (markdown ? '' : '—'));
  }
  async function read(row, message = '') {
    const version = ++reading;
    preview = null;
    el('apply').disabled = true;
    el('keep').disabled = true;
    el('desk').replaceChildren();
    el('phone').replaceChildren();
    notice(message);
    if (!row) return;
    try {
      const id = row.meeting_id;
      // 实时笔记采用防抖保存，读取比较版本前要先将当前草稿写入。
      if (
        live(id) &&
        document.querySelector(
          '#save-state :is([data-save-state="dirty"], [data-save-state="failed"])',
        )
      ) {
        clearTimeout(liveNotesSaveTimer.current);
        const draft = currentNotesMarkdown();
        await persistNotes(id, draft);
        if (live(id) && draft === currentNotesMarkdown())
          document.getElementById('save-state').innerHTML = renderSaveState('saved');
      }
      await notesSavePending.catch(() => {});
      const liveText = live(id) ? currentNotesMarkdown() : null;
      const meeting = await window.brevia.meeting.get({ meeting_id: id });
      if (version !== reading || !dialog.open) return;
      preview = { row, expected: meeting.notes || '', liveText };
      showNotes(el('desk'), preview.expected, id);
      showNotes(el('phone'), row.notes, id);
      el('apply').disabled = editing(id);
      el('keep').disabled = false;
      if (editing(id)) notice('请先保存或取消电脑上的笔记编辑。');
    } catch (error) {
      if (version === reading) notice(error.message);
    }
  }
  function renderChoices() {
    const selected = el('choice').value;
    el('choice').replaceChildren(
      ...rows.map((row) => new Option(`${row.meeting_title} · ${row.device_name}`, row.id)),
    );
    if (rows.some((row) => row.id === selected)) el('choice').value = selected;
    el('choice').disabled = rows.length === 1;
  }
  async function refresh() {
    const version = ++listing;
    try {
      const pending = await api.proposals();
      if (version !== listing) return;
      rows = pending;
      trigger.hidden = !rows.length;
      trigger.textContent = `${t('手机笔记更新')} · ${rows.length}`;
      if (!dialog.open || busy) return;
      if (!rows.length) {
        dialog.close();
        return;
      }
      renderChoices();
      if (preview?.row.id !== el('choice').value)
        await read(rows.find((row) => row.id === el('choice').value));
    } catch (error) {
      if (dialog.open) notice(error.message);
    }
  }
  trigger.onclick = () => {
    if (busy || !rows.length || dialog.open) return;
    dialog.querySelector('h2').textContent = t('手机笔记更新');
    el('close').setAttribute('aria-label', t('关闭'));
    el('choice').setAttribute('aria-label', t('会议'));
    el('desk-title').textContent = t('电脑笔记');
    el('phone-title').textContent = t('手机笔记');
    el('apply').textContent = t('采用手机笔记');
    el('keep').textContent = t('保留电脑笔记');
    renderChoices();
    dialog.showModal();
    void read(rows.find((row) => row.id === el('choice').value));
  };
  dialog.onclose = () => {
    ++reading;
    preview = null;
  };
  el('close').onclick = () => dialog.close();
  el('choice').onchange = () => read(rows.find((row) => row.id === el('choice').value));
  async function resolve(accept) {
    if (busy || !preview) return;
    const { row, expected, liveText } = preview;
    const id = row.meeting_id;
    busy = true;
    el('keep').disabled = el('apply').disabled = true;
    el('choice').disabled = true;
    try {
      if (accept && (editing(id) || (live(id) && currentNotesMarkdown() !== liveText))) {
        await read(row, '电脑笔记已更新，请重新核对。');
        return;
      }
      const result = await api.resolveProposal({
        id: row.id,
        meeting_id: id,
        accept,
        expected_notes: expected,
      });
      if (accept && result.state === 'accepted') {
        if (live(id)) {
          const current = currentNotesMarkdown();
          if (current === liveText) {
            liveNotesEditor.setMarkdown(result.notes);
          } else if (liveText !== null && current.startsWith(liveText)) {
            // IPC 返回前，AI 可能已将另一条被采纳的建议追加到实时笔记。
            clearTimeout(liveNotesSaveTimer.current);
            const appended = current.slice(liveText.length);
            const separator = !liveText && result.notes && !appended.startsWith('\n') ? '\n\n' : '';
            liveNotesEditor.setMarkdown(result.notes + separator + appended);
            await persistNotes(id, currentNotesMarkdown());
          } else {
            showToast(t('电脑笔记已更新，请重新核对。'));
          }
        }
        if (currentMeetingDetail?.id === id && !editing(id)) {
          currentMeetingDetail.notes = uiData.detail.notes = result.notes;
          if (activeView === 'detail' && detailActiveTab === 'notes') renderMeetingDetail();
        }
      }
      preview = null;
    } catch (error) {
      if (dialog.open)
        await read(
          row,
          error.message.includes('重新核对') ? '电脑笔记已更新，请重新核对。' : error.message,
        );
    } finally {
      busy = false;
      await refresh();
    }
  }
  el('apply').onclick = () => resolve(true);
  el('keep').onclick = () => resolve(false);
  window.brevia.on('mobile.collaboration', refresh);
  window.addEventListener('focus', refresh);
  void refresh();
})();
