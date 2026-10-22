/* 本场文字纠错：预览快照与编辑草稿留在原位置，写入只通过后端事务。 */
let correctionDraft = null;
let correctionPanelState = null;
let correctionReturnFocus = null;
let correctionSaving = false;
const correctionPanel = document.createElement('aside');
correctionPanel.className = 'correction-panel';
correctionPanel.hidden = true;
correctionPanel.setAttribute('role', 'region');
correctionPanel.setAttribute('aria-labelledby', 'correction-title');
document.body.append(correctionPanel);

const correctionPreviewLimit = 200;
function correctionMatches(segments, query) {
  const matches = [];
  for (const segment of segments) {
    let occurrence = 0;
    for (const offset of textMatchOffsets(segment.text, query)) {
      if (matches.length === correctionPreviewLimit) {
        matches.limited = true;
        return matches;
      }
      matches.push({ segment, offset, occurrence: occurrence++, selected: true });
    }
  }
  return matches;
}
function selectedCorrectionGroups(state) {
  const groups = new Map();
  for (const match of state.matches.filter((item) => item.selected)) {
    if (!groups.has(match.segment.id))
      groups.set(match.segment.id, {
        segment_id: match.segment.id,
        ...correctionSnapshot(match.segment),
        occurrences: [],
      });
    groups.get(match.segment.id).occurrences.push(match.occurrence);
  }
  return [...groups.values()];
}
function correctionMeetingId() {
  return activeView === 'live' ? breviaClient?.state.meeting?.id : currentMeetingDetail?.id;
}
function correctionControls(meeting, scope = 'transcript') {
  const state = meeting?.correction;
  const generating =
    scope === 'summary' &&
    typeof summaryGeneratingMeetingId !== 'undefined' &&
    summaryGeneratingMeetingId === meeting?.id;
  return `<div class="correction-controls"><button class="icon-button" type="button" data-open-correction="${scope}" title="${escapeHtml(t('查找与替换'))}" aria-label="${escapeHtml(t('查找与替换'))}"${generating ? ' disabled' : ''}>${interfaceIcon('search')}</button>${scope === 'transcript' && state?.rules?.length ? `<button class="text-button" type="button" data-correction-rules>${t('本场规则')} ${state.rules.filter((rule) => rule.enabled).length}</button>` : ''}</div>`;
}
function correctionFeedback(meeting, scope = 'transcript') {
  const state = meeting?.correction;
  if (!state) return '';
  const count = scope === 'transcript' ? state.undo_count : state.document_undo_counts?.[scope];
  const stale = scope === 'transcript' && (state.summary_stale || state.stale_translations?.length);
  return `${count ? `<div class="correction-feedback" role="status"><span>${interfaceIcon('check')}${t('已替换 {count} 处').replace('{count}', count)}</span><button class="text-button" type="button" data-correction-undo="${scope}">${t('撤销')}</button></div>` : ''}${stale ? `<div class="correction-stale">${interfaceIcon('info')}<span>${t('文字已更新；已有译文和会议纪要尚未更新。')}</span>${state.stale_translations?.length && meeting.target_language ? `<button class="text-button" type="button" data-correction-translate>${t('重新翻译')}</button>` : ''}${state.summary_stale && activeView !== 'live' ? `<button class="text-button" type="button" data-correction-summary>${t('查看纪要')}</button>` : ''}</div>` : ''}`;
}
function correctionSegments(meeting, scope = 'transcript') {
  if (scope === 'transcript') return meeting.current_segments || meeting.segments;
  return [
    {
      id: scope,
      text: scope === 'notes' ? meeting.notes || '' : meeting.summary?.data?.markdown || '',
      version: scope,
      revision: 0,
    },
  ];
}
// 使用浏览器文本高亮，不改写原文 DOM，也不破坏 Markdown、链接和用户选区。
function correctionTextRanges(root, query) {
  if (!query) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = '',
    node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, offset: text.length });
    text += node.textContent;
  }
  return correctionMatches([{ text }], query).map(({ offset }) => {
    const start = nodes.findLast((entry) => entry.offset <= offset);
    const end = nodes.find((entry) => entry.offset + entry.node.length >= offset + query.length);
    const range = document.createRange();
    range.setStart(start.node, offset - start.offset);
    range.setEnd(end.node, offset + query.length - end.offset);
    return range;
  });
}
function refreshCorrectionHighlights() {
  CSS.highlights.delete('correction-search');
  const state = correctionPanelState;
  if (!state || state.rules || !state.query) return;
  const selector =
    state.scope === 'notes'
      ? '.detail-notes-content, [data-live-notes-root] .notes-editor, .correction-markdown-source'
      : state.scope === 'summary'
        ? '.summary-body'
        : '.segment-copy > p, .refined-fulltext-body';
  const ranges = [
    ...document.querySelectorAll(`.view.active ${selector.split(', ').join(', .view.active ')}`),
  ]
    .filter((root) => root.checkVisibility())
    .flatMap((root) => correctionTextRanges(root, state.query));
  CSS.highlights.set('correction-search', new Highlight(...ranges));
}
const correctionContentObserver = new MutationObserver(() => {
  cancelAnimationFrame(correctionContentObserver.frame);
  correctionContentObserver.frame = requestAnimationFrame(refreshCorrectionHighlights);
});
function syncCorrectionControls() {
  const meeting = breviaClient?.state.meeting;
  const header = document.querySelector('#live-view .live-captions .live-section-head');
  if (header) {
    let controls = header.querySelector('.correction-controls');
    if (!controls) {
      header.insertAdjacentHTML('beforeend', correctionControls(meeting));
    } else controls.outerHTML = correctionControls(meeting);
    let feedback = document.querySelector('#live-correction-feedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = 'live-correction-feedback';
      header.after(feedback);
    }
    feedback.innerHTML = correctionFeedback(meeting);
  }
  const notesHeader = document.querySelector('#live-view .live-notes .live-section-head');
  if (notesHeader) {
    const controls = notesHeader.querySelector('.correction-controls');
    if (controls) controls.outerHTML = correctionControls(meeting, 'notes');
    else notesHeader.insertAdjacentHTML('beforeend', correctionControls(meeting, 'notes'));
    let feedback = document.querySelector('#live-notes-correction-feedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = 'live-notes-correction-feedback';
      notesHeader.after(feedback);
    }
    feedback.innerHTML = correctionFeedback(meeting, 'notes');
  }
}
window.addEventListener('brevia:language-changed', syncCorrectionControls);
function applyCorrectionMeeting(meeting) {
  if (currentMeetingDetail?.id === meeting.id) applyBackendDetail(meeting);
  if (breviaClient?.state.meeting?.id === meeting.id) {
    Object.assign(breviaClient.state.meeting, meeting);
    for (const segment of meeting.current_segments || meeting.segments) {
      const row = liveSegments.get(segment.id);
      const data = liveSegmentData.get(segment.id);
      if (data) data.text = segment.text;
      if (!row || correctionDraft?.segment.id === segment.id) continue;
      const copy = row.querySelector('.segment-copy > p');
      if (copy)
        copy.innerHTML = renderCorrectedTranscript(
          segment.text,
          meeting.correction?.highlights?.[segment.id],
        );
      row.classList.toggle('is-user-edited', Boolean(segment.user_edited));
      const translation = row.querySelector('.translation');
      if (translation) {
        translation.textContent = segment.translation || '';
        translation.classList.toggle(
          'is-stale',
          Boolean(meeting.correction?.stale_translations?.includes(segment.id)),
        );
      }
      if (floatingCaptionMode === 'live')
        window.brevia?.floatingCaption?.update({
          segmentId: segment.id,
          text: segment.text,
          updateFinalized: true,
          isRefined: true,
          locale: floatingCaptionLocale,
        });
    }
  }
  syncCorrectionControls();
  if (correctionPanelState?.meetingId === meeting.id) {
    correctionPanelState.latest = meeting;
    updateCorrectionPending();
  }
}
function correctionSnapshot(segment) {
  return { text: segment.text, version: segment.version, revision: segment.revision };
}
async function saveLiveCorrection() {
  const draft = correctionDraft;
  if (!draft || draft.saving) return false;
  const text = draft.field.value.trim();
  if (!text || text.length > 4000) {
    draft.error.textContent = t('字幕内容不能为空，且每段不能超过 4000 字');
    draft.field.focus();
    return false;
  }
  if (text === draft.segment.text) {
    closeLiveCorrection();
    return true;
  }
  draft.saving = true;
  draft.row.querySelectorAll('button, textarea').forEach((control) => {
    control.disabled = true;
  });
  try {
    const meeting = await window.brevia.segment.saveText({
      meeting_id: draft.meetingId,
      segments: [
        { segment_id: draft.segment.id, text, expected: correctionSnapshot(draft.segment) },
      ],
    });
    closeLiveCorrection();
    applyCorrectionMeeting(meeting);
    return true;
  } catch (error) {
    draft.error.textContent = `${t('保存失败，修改仍保留')} · ${userFacingError(error.message)}`;
    return false;
  } finally {
    draft.saving = false;
    if (correctionDraft === draft)
      draft.row.querySelectorAll('button, textarea').forEach((control) => {
        control.disabled = false;
      });
  }
}
function closeLiveCorrection() {
  const draft = correctionDraft;
  if (!draft) return;
  draft.row.querySelector('.segment-copy').innerHTML = draft.original;
  draft.row.classList.remove('is-editing', 'is-modified');
  draft.row.querySelector('.live-modified-state')?.remove();
  correctionDraft = null;
}
function chooseCorrectionDraft() {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'correction-draft-dialog';
    dialog.innerHTML = `<h2>${t('保留文字修改？')}</h2><p>${t('当前段落有尚未保存的修改。')}</p><footer><button class="secondary" data-choice="cancel">${t('继续编辑')}</button><button class="secondary" data-choice="discard">${t('放弃修改')}</button><button class="modal-action" data-choice="save">${t('保存后继续')}</button></footer>`;
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-choice]');
      if (choice) finish(choice.dataset.choice);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish('cancel');
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
async function settleCorrectionDraft() {
  if (correctionSaving || correctionDraft?.saving || correctionPanelState?.saving) return false;
  if (correctionDraft) {
    if (correctionDraft.field.value.trim() === correctionDraft.segment.text) closeLiveCorrection();
    else {
      const choice = await chooseCorrectionDraft();
      if (choice === 'cancel') return false;
      if (choice === 'save') return saveLiveCorrection();
      closeLiveCorrection();
    }
  }
  if (uiData.detail.transcriptEditing) {
    if (uiData.detail.transcriptSaveState === 'saving') return false;
    const choice =
      uiData.detail.transcriptSaveState === 'dirty' ||
      uiData.detail.transcriptSaveState === 'failed'
        ? await chooseCorrectionDraft()
        : 'discard';
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      await saveDetailTranscriptEdits();
      if (uiData.detail.transcriptEditing) return false;
    } else {
      uiData.detail.transcriptEditing = false;
      uiData.detail.transcriptDraft = {};
      uiData.detail.transcriptSaveState = 'saved';
      renderMeetingDetail();
    }
  }
  for (const scope of ['notes', 'summary']) {
    const d = uiData.detail;
    if (!d[`${scope}Editing`]) continue;
    if (d[`${scope}SaveState`] === 'saving') return false;
    const text =
      scope === 'notes' ? detailNotesEditor.getMarkdown() : inlineSummaryEditor.getMarkdown();
    const before =
      scope === 'notes'
        ? currentMeetingDetail.notes || ''
        : currentMeetingDetail.summary?.data?.markdown || '';
    const choice = text !== before ? await chooseCorrectionDraft() : 'discard';
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      if (scope === 'notes') await persistNotes(currentMeetingDetail.id, text);
      else
        await window.brevia.summary.save({ meeting_id: currentMeetingDetail.id, markdown: text });
    }
    d[`${scope}Editing`] = false;
    d[`${scope}SaveState`] = 'saved';
    if (scope === 'summary') d.summaryDraft = undefined;
    applyBackendDetail(await window.brevia.meeting.get({ meeting_id: currentMeetingDetail.id }));
  }
  return true;
}
async function openLiveCorrection(row) {
  if (!row || row.classList.contains('is-draft') || !(await settleCorrectionDraft())) return;
  const meetingId = breviaClient?.state.meeting?.id;
  const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
  const segment = (meeting.current_segments || meeting.segments).find(
    (item) => item.id === row.dataset.segmentId,
  );
  if (!segment || !row.isConnected) throw Error(t('部分内容已变化，请更新预览'));
  followLiveTranscript = false;
  const copy = row.querySelector('.segment-copy');
  const original = copy.innerHTML;
  copy.innerHTML = `<textarea class="segment-text-input" rows="2" maxlength="4000" aria-label="${t('字幕文本')}">${escapeHtml(segment.text)}</textarea><small class="segment-edit-error" role="alert"></small><div class="live-correction-actions"><button class="text-button" type="button" data-live-correction-replace>${t('替换相同词…')}</button><div><button class="secondary" type="button" data-live-correction-cancel>${t('取消')}</button><button class="modal-action" type="button" data-live-correction-save>${t('保存本段')}</button></div></div>`;
  const field = copy.querySelector('textarea');
  correctionDraft = {
    meetingId,
    segment,
    original,
    field,
    row,
    error: copy.querySelector('[role=alert]'),
    saving: false,
  };
  row.classList.add('is-editing');
  resizeTranscriptField(field);
  focusForKeyboard(field);
  const latest = document.querySelector('#back-to-latest');
  if (latest) latest.hidden = false;
}
async function openCorrection(query = '', rules = false, scope = 'transcript') {
  const meetingId = correctionMeetingId();
  if (!meetingId || !(await settleCorrectionDraft())) return;
  if (scope === 'summary' && summaryGeneratingMeetingId === meetingId) return;
  if (correctionPanelState) closeCorrectionPanel();
  if (
    scope === 'transcript' &&
    activeView === 'detail' &&
    uiData.detail.hasRefined &&
    uiData.detail.transcriptVersion === 'original'
  ) {
    showToast(t('请切回当前稿后替换'));
    return;
  }
  if (scope === 'notes' && activeView === 'live') {
    clearTimeout(liveNotesSaveTimer.current);
    await persistNotes(meetingId, currentNotesMarkdown());
  }
  const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
  if (meeting.status === 'refining' && scope === 'transcript')
    throw Error(t('部分内容已变化，请更新预览'));
  correctionReturnFocus = document.activeElement;
  correctionPanelState = {
    meetingId,
    scope,
    meeting,
    latest: meeting,
    query,
    replacement: '',
    matches: correctionMatches(correctionSegments(meeting, scope), query),
    rules,
    saving: false,
  };
  correctionPanel.hidden = false;
  document.querySelector('#live-view').classList.add('has-correction-panel');
  if (scope === 'notes' && activeView === 'live' && liveNotesEditor.getMode() === 'markdown') {
    const input = liveNotesRoot.querySelector('.notes-input');
    const preview = document.createElement('pre');
    preview.className = 'correction-markdown-source';
    preview.textContent = input.value;
    input.hidden = true;
    input.after(preview);
    correctionPanelState.sourcePreview = { input, preview };
  }
  renderCorrectionPanel();
  focusForKeyboard(correctionPanel.querySelector('input, button'));
  correctionContentObserver.disconnect();
  correctionContentObserver.observe(document.querySelector('.view.active'), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  followLiveTranscript = false;
}
function closeCorrectionPanel() {
  if (correctionPanelState?.saving) return;
  const source = correctionPanelState?.sourcePreview;
  if (source) {
    source.preview.remove();
    source.input.hidden = false;
  }
  correctionPanel.hidden = true;
  document.querySelector('#live-view').classList.remove('has-correction-panel');
  correctionPanelState = null;
  correctionContentObserver.disconnect();
  refreshCorrectionHighlights();
  if (correctionReturnFocus?.isConnected) correctionReturnFocus.focus({ preventScroll: true });
}
function renderCorrectionPanel() {
  const state = correctionPanelState;
  if (!state) return;
  const e = escapeHtml;
  const live =
    state.scope === 'transcript' &&
    meetingActive &&
    breviaClient?.state.meeting?.id === state.meetingId;
  correctionPanel.innerHTML = `<header><h2 id="correction-title">${t(state.rules ? '本场规则' : '查找与替换')}</h2><button class="icon-button" data-close-correction type="button" aria-label="${t('关闭')}">${interfaceIcon('close')}</button></header>${state.rules ? `<div class="correction-results">${state.latest.correction?.rules?.length ? state.latest.correction.rules.map((rule, index) => `<div class="correction-rule"><strong>${e(rule.find)} → ${e(rule.replacement)}</strong><span>${t(rule.enabled && live ? '已启用' : '已停用')}</span><button class="text-button" type="button" data-reuse-correction="${index}">${t('重新应用')}</button>${rule.enabled ? `<button class="text-button" type="button" data-disable-correction="${index}">${t('停用')}</button>` : ''}</div>`).join('') : `<p>${t('暂无本场规则')}</p>`}</div><footer><button class="secondary" data-close-correction type="button">${t('关闭')}</button></footer>` : `<div class="correction-fields"><label>${t('查找')}<input data-correction-find maxlength="4000" value="${e(state.query)}" autocomplete="off" /></label><label>${t('替换为')}<input data-correction-replacement maxlength="4000" value="${e(state.replacement)}" autocomplete="off" /></label></div><div class="correction-match-heading"><strong data-correction-count></strong><button class="text-button" data-correction-select-all type="button">${t('全选')}</button></div><div class="correction-pending" role="status" hidden></div><div class="correction-results" data-correction-results></div>${live ? `<label class="correction-future"><input type="checkbox" data-correction-future${state.future ? ' checked' : ''}/><span>${t('本场后续字幕也应用此规则')}<small>${t('仅对之后确认的新字幕生效')}</small></span></label>` : ''}<p class="correction-error" role="alert"></p><footer><button class="secondary" data-close-correction type="button">${t('取消')}</button><button class="modal-action" data-submit-correction type="button"></button></footer>`}`;
  if (!state.rules) renderCorrectionResults();
}
function renderCorrectionResults() {
  const state = correctionPanelState;
  if (!state || state.rules) return;
  const focusedMatch = document.activeElement?.dataset?.correctionMatch;
  const selected = state.matches.filter((match) => match.selected);
  const groups = selectedCorrectionGroups(state);
  const lengths = groups.map(
    (group) =>
      group.text.length +
      group.occurrences.length * (state.replacement.length - state.query.length),
  );
  const overLimit =
    state.scope === 'transcript'
      ? groups.length > 500 ||
        groups.some((group, index) => group.text.length > 4000 || lengths[index] > 4000) ||
        lengths.reduce((sum, length) => sum + length, 0) > 60000
      : lengths.some((length) => length > MAX_NOTES_CHARS);
  correctionPanel.querySelector('[data-correction-count]').textContent =
    state.scope !== 'transcript'
      ? t('匹配 {count} 处').replace('{count}', state.matches.length)
      : t('匹配 {count} 处 · 涉及 {segments} 段')
          .replace('{count}', state.matches.length)
          .replace('{segments}', new Set(state.matches.map((match) => match.segment.id)).size);
  if (state.matches.limited)
    correctionPanel.querySelector('[data-correction-count]').textContent +=
      ` · ${t('仅预览前 {count} 处，请分批替换或缩小范围。').replace('{count}', correctionPreviewLimit)}`;
  correctionPanel.querySelector('[data-correction-results]').innerHTML = state.matches.length
    ? state.matches
        .map((match, index) => {
          const { segment, offset } = match;
          const before = segment.text.slice(Math.max(0, offset - 30), offset);
          const after = segment.text.slice(
            offset + state.query.length,
            offset + state.query.length + 45,
          );
          let context = `${escapeHtml(before)}<mark>${escapeHtml(state.query)}</mark>${escapeHtml(after)}`;
          if (state.scope !== 'transcript' && /[*_#`\[\]>]/.test(before + after)) {
            let marker = '\uE000';
            while ((before + after).includes(marker)) marker += '\uE000';
            const preview = document.createElement('div');
            preview.innerHTML = renderMarkdown(before + marker + after);
            const parts = preview.textContent.split(marker);
            if (parts.length === 2)
              context = `${escapeHtml(parts[0])}<mark>${escapeHtml(state.query)}</mark>${escapeHtml(parts[1])}`;
          }
          return `<div class="correction-match"><input type="checkbox" data-correction-match="${index}" aria-label="${escapeHtml(t('选择此处'))}"${match.selected ? ' checked' : ''}/><div><button class="text-button correction-time" type="button" data-correction-locate="${index}">${state.scope === 'transcript' ? formatMeetingTime(segment.start_ms) : t('第 {count} 处').replace('{count}', index + 1)}</button><p>${context}</p><small>${escapeHtml(state.query)} → ${escapeHtml(state.replacement)}</small></div></div>`;
        })
        .join('')
    : `<p class="correction-empty">${t(state.query ? '未找到相同文字' : '输入要查找的文字')}</p>`;
  const submit = correctionPanel.querySelector('[data-submit-correction]');
  submit.textContent = t('替换所选 {count} 处').replace('{count}', selected.length);
  submit.disabled =
    !state.query.trim() ||
    !state.replacement.trim() ||
    state.query === state.replacement ||
    !selected.length ||
    overLimit;
  const error = correctionPanel.querySelector('.correction-error');
  if (overLimit) {
    error.textContent = t('error.transcript_limit');
    error.dataset.limit = 'true';
  } else if (error.dataset.limit) {
    error.textContent = '';
    delete error.dataset.limit;
  }
  updateCorrectionPending();
  refreshCorrectionHighlights();
  if (focusedMatch !== undefined)
    correctionPanel
      .querySelector(`[data-correction-match="${focusedMatch}"]`)
      ?.focus({ preventScroll: true });
}
function updateCorrectionPending() {
  const state = correctionPanelState;
  const notice = correctionPanel.querySelector('.correction-pending');
  if (!state || !notice) return;
  const current = correctionSegments(state.latest, state.scope);
  const preview = correctionSegments(state.meeting, state.scope);
  const changed =
    JSON.stringify(
      current.map((segment) => [segment.id, segment.text, segment.version, segment.revision]),
    ) !==
    JSON.stringify(
      preview.map((segment) => [segment.id, segment.text, segment.version, segment.revision]),
    );
  notice.hidden = !changed;
  notice.innerHTML = `${t('内容已更新，请更新预览')} <button class="text-button" type="button" data-refresh-correction>${t('更新预览')}</button>`;
}
async function submitCorrection(action = 'replace', find, scope = 'transcript') {
  const state = correctionPanelState;
  const meetingId = state?.meetingId || correctionMeetingId();
  if (!meetingId || state?.saving || correctionSaving) return;
  const payload = {
    meeting_id: meetingId,
    action,
    find,
    scope: action === 'undo' ? scope : state?.scope || scope,
  };
  if (action === 'replace') {
    if (!state || correctionPanel.querySelector('[data-submit-correction]').disabled) return;
    const groups = selectedCorrectionGroups(state);
    Object.assign(payload, {
      find: state.query,
      replacement: state.replacement,
      future: Boolean(state.future),
      matches: groups,
    });
    if (state.scope !== 'transcript') {
      payload.document = {
        text: groups[0].text,
        occurrences: state.matches
          .filter((match) => match.selected)
          .map((match) => match.occurrence),
      };
      delete payload.matches;
    }
    const old = state.latest.correction?.rules?.find(
      (rule) => rule.find === state.query && rule.replacement !== state.replacement,
    );
    if (state.future && old && !state.confirmRule) {
      openConfirmation(
        t('更新本场规则'),
        `${old.find} → ${old.replacement} → ${state.replacement}`,
        () => {
          state.confirmRule = true;
          return submitCorrection();
        },
      );
      return;
    }
    payload.confirm_rule = Boolean(state.confirmRule);
  }
  correctionSaving = true;
  document.querySelectorAll('[data-correction-undo]').forEach((button) => {
    button.disabled = true;
  });
  if (state) state.saving = true;
  correctionPanel.querySelectorAll('button, input').forEach((control) => {
    control.disabled = true;
  });
  const submit = correctionPanel.querySelector('[data-submit-correction]');
  if (submit) submit.textContent = t('替换中…');
  const notesWasInert = liveNotesRoot.inert;
  if (payload.scope === 'notes' && activeView === 'live') liveNotesRoot.inert = true;
  try {
    if (payload.scope === 'notes' && activeView === 'live') {
      if (state && currentNotesMarkdown() !== (state.meeting.notes || ''))
        throw Error(t('部分内容已变化，请更新预览'));
      clearTimeout(liveNotesSaveTimer.current);
      await persistNotes(meetingId, currentNotesMarkdown());
    }
    const meeting = await window.brevia.segment.correction(payload);
    if (payload.scope === 'notes' && activeView === 'live')
      liveNotesEditor.setMarkdown(meeting.notes || '');
    if (state) state.saving = false;
    applyCorrectionMeeting(meeting);
    if (action === 'disable' && state) {
      state.latest = meeting;
      renderCorrectionPanel();
    } else closeCorrectionPanel();
  } catch (error) {
    if (state) {
      state.saving = false;
      correctionPanel.querySelectorAll('button, input').forEach((control) => {
        control.disabled = false;
      });
      const message = correctionPanel.querySelector('.correction-error');
      if (message)
        message.textContent = `${t('替换失败，修改仍保留')} · ${userFacingError(error.message)}`;
      if (!state.rules) renderCorrectionResults();
    } else showToast(userFacingError(error.message), undefined, 'error');
  } finally {
    liveNotesRoot.inert = notesWasInert;
    correctionSaving = false;
    document.querySelectorAll('[data-correction-undo]').forEach((button) => {
      button.disabled = false;
    });
  }
}
correctionPanel.addEventListener('input', (event) => {
  const state = correctionPanelState;
  if (!state || state.saving) return;
  if (event.target.matches('[data-correction-find]')) {
    state.confirmRule = false;
    state.query = event.target.value;
    state.meeting = state.latest;
    state.matches = correctionMatches(correctionSegments(state.meeting, state.scope), state.query);
  } else if (event.target.matches('[data-correction-replacement]')) {
    state.confirmRule = false;
    state.replacement = event.target.value;
  } else if (event.target.matches('[data-correction-future]')) state.future = event.target.checked;
  else if (event.target.matches('[data-correction-match]'))
    state.matches[Number(event.target.dataset.correctionMatch)].selected = event.target.checked;
  renderCorrectionResults();
});
correctionPanel.addEventListener('click', (event) => {
  const state = correctionPanelState;
  if (!state || state.saving) return;
  if (event.target.closest('[data-close-correction]')) closeCorrectionPanel();
  if (event.target.closest('[data-submit-correction]')) void submitCorrection();
  if (event.target.closest('[data-correction-select-all]')) {
    state.matches.forEach((match) => {
      match.selected = true;
    });
    renderCorrectionResults();
  }
  if (event.target.closest('[data-refresh-correction]'))
    void (async () => {
      if (state.scope === 'notes' && activeView === 'live') {
        clearTimeout(liveNotesSaveTimer.current);
        await persistNotes(state.meetingId, currentNotesMarkdown());
        if (state.sourcePreview) state.sourcePreview.preview.textContent = currentNotesMarkdown();
      }
      return window.brevia.meeting.get({ meeting_id: state.meetingId });
    })()
      .then((meeting) => {
        state.meeting = state.latest = meeting;
        state.matches = correctionMatches(correctionSegments(meeting, state.scope), state.query);
        renderCorrectionResults();
      })
      .catch((error) => showToast(error.message, undefined, 'error'));
  const locate = event.target.closest('[data-correction-locate]');
  if (locate) {
    const segment = state.matches[Number(locate.dataset.correctionLocate)].segment;
    const row = [...document.querySelectorAll('.view.active .segment')].find(
      (item) => item.dataset.segmentId === segment.id,
    );
    row?.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (state.scope !== 'transcript') {
      const selector =
        state.scope === 'notes'
          ? '.detail-notes-content, [data-live-notes-root] .notes-editor'
          : '.summary-body';
      const root = [...document.querySelectorAll(selector)].find((node) => node.checkVisibility());
      const range =
        root && correctionTextRanges(root, state.query)[Number(locate.dataset.correctionLocate)];
      if (range) {
        const marker = document.createElement('span');
        const collapsed = range.cloneRange();
        collapsed.collapse(true);
        collapsed.insertNode(marker);
        marker.scrollIntoView({ block: 'center', behavior: 'instant' });
        marker.remove();
        refreshCorrectionHighlights();
      }
    } else if (activeView === 'detail') {
      playerAudio.currentTime = segment.start_ms / 1000;
      renderPlayerTime();
    }
  }
  const disable = event.target.closest('[data-disable-correction]');
  if (disable)
    void submitCorrection(
      'disable',
      state.latest.correction.rules[Number(disable.dataset.disableCorrection)].find,
    );
  const reuse = event.target.closest('[data-reuse-correction]');
  if (reuse) {
    const rule = state.latest.correction.rules[Number(reuse.dataset.reuseCorrection)];
    state.rules = false;
    state.query = rule.find;
    state.replacement = rule.replacement;
    state.meeting = state.latest;
    state.matches = correctionMatches(correctionSegments(state.meeting, state.scope), rule.find);
    renderCorrectionPanel();
  }
});
document.addEventListener(
  'click',
  (event) => {
    const tab = event.target.closest('[data-detail-tab]');
    if (tab && correctionPanelState && tab.dataset.detailTab !== correctionPanelState.scope) {
      if (correctionPanelState.saving) {
        event.stopImmediatePropagation();
        return;
      }
      closeCorrectionPanel();
    }
    const target = event.target.closest(
      '[data-open-correction], [data-correction-rules], [data-correction-undo], [data-live-correction-save], [data-live-correction-cancel], [data-live-correction-replace], [data-segment-tool="edit"], [data-correction-translate], [data-correction-summary], [data-context-correction]',
    );
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const run = async () => {
      if (target.matches('[data-live-correction-save]')) return saveLiveCorrection();
      if (target.matches('[data-live-correction-cancel]')) {
        if (!correctionDraft?.saving) return closeLiveCorrection();
        return;
      }
      if (target.matches('[data-segment-tool="edit"]'))
        return openLiveCorrection(target.closest('.segment'));
      if (target.matches('[data-live-correction-replace]')) {
        const field = correctionDraft.field;
        return openCorrection(field.value.slice(field.selectionStart, field.selectionEnd));
      }
      if (target.matches('[data-context-correction]')) {
        const query = segmentContextMenu.dataset.correctionQuery || '';
        closeSegmentContextMenu();
        return openCorrection(query);
      }
      if (target.matches('[data-correction-undo]')) {
        if (!(await settleCorrectionDraft())) return;
        return submitCorrection('undo', undefined, target.dataset.correctionUndo || 'transcript');
      }
      if (target.matches('[data-correction-translate]')) {
        const meeting = await window.brevia.meeting.get({ meeting_id: correctionMeetingId() });
        return translateLatestTranscript(meeting.target_language, meeting);
      }
      if (target.matches('[data-correction-summary]')) {
        detailActiveTab = 'summary';
        renderMeetingDetail();
        return;
      }
      return openCorrection(
        '',
        target.matches('[data-correction-rules]'),
        target.dataset.openCorrection || 'transcript',
      );
    };
    void run().catch((error) => showToast(userFacingError(error.message), undefined, 'error'));
  },
  true,
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !correctionPanel.hidden) {
    event.preventDefault();
    closeCorrectionPanel();
  }
  if (correctionDraft && event.target === correctionDraft.field) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveLiveCorrection();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      void settleCorrectionDraft();
    }
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === 'h' &&
    event.target.closest(
      '.transcript-body, #transcript-scroll, .detail-notes-content, .summary-body, [data-live-notes-root]',
    )
  ) {
    event.preventDefault();
    const scope = event.target.closest('.detail-notes-content, [data-live-notes-root]')
      ? 'notes'
      : event.target.closest('.summary-body')
        ? 'summary'
        : 'transcript';
    void openCorrection(window.getSelection()?.toString() || '', false, scope).catch((error) =>
      showToast(error.message),
    );
  }
});
document.addEventListener('input', (event) => {
  if (correctionDraft?.field === event.target) {
    resizeTranscriptField(event.target);
    const modified = event.target.value !== correctionDraft.segment.text;
    correctionDraft.row.classList.toggle('is-modified', modified);
    let marker = correctionDraft.row.querySelector('.live-modified-state');
    if (modified && !marker) {
      marker = document.createElement('small');
      marker.className = 'live-modified-state';
      marker.textContent = t('已修改');
      correctionDraft.row.querySelector('.segment-meta').append(marker);
    } else if (!modified) marker?.remove();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (correctionDraft && correctionDraft.field.value !== correctionDraft.segment.text) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.brevia?.on('transcript.corrected', ({ meeting }) => applyCorrectionMeeting(meeting));
window.brevia?.on('transcript.final', ({ meeting_id }) => {
  if (correctionPanelState?.meetingId === meeting_id)
    void window.brevia.meeting
      .get({ meeting_id })
      .then((meeting) => {
        if (correctionPanelState?.meetingId === meeting_id) {
          correctionPanelState.latest = meeting;
          updateCorrectionPending();
        }
      })
      .catch(() => {});
});
