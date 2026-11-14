/* 本场文字纠错：预览快照与编辑草稿留在原位置，写入只通过后端事务。 */
let correctionDraft = null;
let correctionPanelState = null;
let correctionOpenVersion = 0;
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
        ? '.summary-document'
        : '.segment-copy > p, .refined-fulltext-body';
  const ranges = [
    ...document.querySelectorAll(`.view.active ${selector.split(', ').join(', .view.active ')}`),
  ]
    .filter((root) => root.checkVisibility())
    .flatMap((root) => correctionTextRanges(root, state.query));
  CSS.highlights.set('correction-search', new Highlight(...ranges));
}
const correctionContentObserver = new MutationObserver((records) => {
  if (
    records.some(({ target }) =>
      (target.parentElement || target).closest?.('[data-live-notes-root]'),
    )
  )
    syncLiveCorrectionNotes();
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
    if (meeting.accepted_claims) setLiveAcceptedClaims(meeting.accepted_claims);
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
    correctionPanelState.readVersion++;
    updateCorrectionPreview(correctionPanelState, meeting);
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
        : (d.summaryEditBase ?? currentMeetingDetail.summary?.data?.markdown ?? '');
    const choice = text !== before ? await chooseCorrectionDraft() : 'discard';
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      if (scope === 'notes') await persistNotes(currentMeetingDetail.id, text);
      else
        await window.brevia.summary.save({
          meeting_id: currentMeetingDetail.id,
          markdown: text,
          expected_markdown: before,
        });
      scheduleLibraryMetrics();
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
function suggestedTermPairs(meeting) {
  const text = meeting.summary?.data?.markdown || '';
  const segments = meeting.current_segments || meeting.segments || [];
  const pairs = [];
  const add = (wrong, correct) => {
    if (!wrong || wrong === correct || pairs.some((pair) => pair.wrong === wrong)) return;
    if (segments.some((segment) => segment.text.includes(wrong))) pairs.push({ wrong, correct });
  };
  for (const line of text.split('\n')) {
    // 只取明确写出的纠错映射；普通因果箭头不能变成词典规则。
    const entry = line
      .replace(/^\s*[-*•]\s*/, '')
      .replace(/[*`“”「」"]/g, '')
      .trim();
    const arrow = entry.match(
      /^(?:(?:术语纠错|纠错|错写|correction)\s*[:：]\s*)?([^→:：，。；;]{1,80}?)\s*→\s*([^→:：，。；;]{1,80})$/i,
    );
    const inverse = entry.match(
      /^([^（(]{1,80})[（(]\s*(?:误识为|错写为|misheard as)\s*[:：]?\s*([^）)]{1,80})[）)]$/i,
    );
    if (arrow) add(arrow[1].trim(), arrow[2].trim());
    if (inverse) add(inverse[2].trim(), inverse[1].trim());
    if (pairs.length === 8) break;
  }
  return pairs;
}

function termFlagsMarkup(post, hot, supported = true) {
  return `<label><input type="checkbox" data-term-post ${post ? 'checked' : ''} />${t('转写后替换')}</label><label><input type="checkbox" data-term-hotword ${hot ? 'checked' : ''} ${supported ? '' : 'disabled'} />${t('识别热词')}${supported ? '' : ` · ${t('当前模型不支持')}`}</label>`;
}

async function openWorkspaceTerms(workspaceId, anchor) {
  const rows = await window.brevia.workspace.terms({ workspace_id: workspaceId });
  if (!anchor?.isConnected) return;
  document.querySelector('.term-editor:popover-open')?.hidePopover();
  const panel = document.createElement('section');
  const e = escapeHtml;
  panel.className = 'workspace-dialog workspace-create-popover term-editor';
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('工作区词典'));
  panel.innerHTML = `<header class="ui-dialog-header"><div><h2>${t('工作区词典')}</h2><small>${e(getWorkspaceName(workspaceId))}</small></div><button class="modal-close" type="button" data-term-close aria-label="${t('关闭')}">${interfaceIcon('close')}</button></header>
  <div class="term-list"></div><form class="term-form"><label>${t('识别错写')}<input name="wrong" required maxlength="80" autocomplete="off" /></label><label>${t('正确术语')}<input name="correct" required maxlength="80" autocomplete="off" /></label>
  <div class="term-options"><span>${interfaceIcon('search')}${t('搜索别名')}</span>${termFlagsMarkup(false, false)}</div>
  <div class="ui-dialog-actions"><button type="button" class="ui-button ui-button-danger" data-term-remove hidden>${t('删除')}</button><button type="button" class="text-button" data-term-reset hidden>${t('取消')}</button><button type="submit" class="modal-action">${t('保存')}</button></div></form>`;
  const form = panel.querySelector('form');
  const supported = modelCatalog
    .filter((m) => m.supports_hotwords && !m.retired)
    .map((m) => m.name);
  panel.querySelector('[data-term-hotword]').parentElement.title =
    `${t('识别热词')} · ${supported.join(' / ') || t('当前模型不支持')}`;
  const list = panel.querySelector('.term-list');
  const reposition = () => {
    if (!anchor.isConnected) return panel.hidePopover();
    positionFloating(panel, anchor, ['bottom-start', 'top-start', 'bottom-end']);
  };
  const renderRows = () => {
    list.innerHTML = rows
      .map(
        (r, i) =>
          `<button type="button" data-term-index="${i}"><span>${e(r.wrong)}</span><span>→</span><strong>${e(r.correct)}</strong>${interfaceIcon('edit')}</button>`,
      )
      .join('');
    list.hidden = !rows.length;
    reposition();
  };
  const edit = (row) => {
    form.elements.wrong.readOnly = !!row;
    form.elements.wrong.value = row?.wrong || '';
    form.elements.correct.value = row?.correct || '';
    form.querySelector('[data-term-post]').checked = !!row?.post_replace;
    form.querySelector('[data-term-hotword]').checked = !!row?.hotword;
    form.querySelector('[data-term-remove]').hidden = !row;
    form.querySelector('[data-term-reset]').hidden = !row;
    form.elements[row ? 'correct' : 'wrong'].focus();
    reposition();
  };
  const save = async (remove) => {
    if (form.inert) return;
    form.inert = list.inert = true;
    try {
      const payload = { workspace_id: workspaceId, wrong: form.elements.wrong.value.trim() };
      if (remove) payload.remove = true;
      else
        Object.assign(payload, {
          correct: form.elements.correct.value.trim(),
          post_replace: form.querySelector('[data-term-post]').checked,
          hotword: form.querySelector('[data-term-hotword]').checked,
        });
      const next = await window.brevia.workspace.saveTerm(payload);
      if (!panel.isConnected) return;
      rows.splice(0, rows.length, ...next);
      renderRows();
      form.inert = false;
      edit(null);
    } catch (error) {
      showToast(userFacingError(error.message), undefined, 'error');
    } finally {
      form.inert = list.inert = false;
    }
  };
  panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-term-close]')) return panel.hidePopover();
    const item = event.target.closest('[data-term-index]');
    if (item) edit(rows[Number(item.dataset.termIndex)]);
    if (event.target.closest('[data-term-reset]')) edit(null);
    if (event.target.closest('[data-term-remove]')) {
      openConfirmation(
        t('删除'),
        `${form.elements.wrong.value} → ${form.elements.correct.value} · ${t('移除后，此词条将不再生效。')}`,
        () => save(true),
        event.target.closest('button'),
      );
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(false);
  });
  panel.addEventListener('toggle', (event) => {
    if (event.newState !== 'closed') return;
    window.removeEventListener('resize', reposition);
    const restore =
      panel.contains(document.activeElement) || document.activeElement === document.body;
    panel.remove();
    if (restore) anchor.focus({ preventScroll: true });
  });
  document.body.append(panel);
  panel.showPopover();
  renderRows();
  edit(null);
  window.addEventListener('resize', reposition);
}

async function openCorrection(query = '', rules = false, scope = 'transcript') {
  const meetingId = correctionMeetingId();
  const view = activeView;
  const requested = ++correctionOpenVersion;
  if (
    !meetingId ||
    !(await settleCorrectionDraft()) ||
    requested !== correctionOpenVersion ||
    activeView !== view ||
    correctionMeetingId() !== meetingId
  )
    return;
  if (scope === 'summary' && summaryGeneratingMeetingId === meetingId) return;
  if (correctionPanelState) closeCorrectionPanel();
  const version = ++correctionOpenVersion;
  if (
    scope === 'transcript' &&
    activeView === 'detail' &&
    uiData.detail.hasRefined &&
    uiData.detail.transcriptVersion === 'original'
  ) {
    showToast(t('请切回当前稿后替换'));
    return;
  }
  const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
  if (
    version !== correctionOpenVersion ||
    activeView !== view ||
    correctionMeetingId() !== meetingId
  )
    return;
  if (meeting.status === 'refining' && scope === 'transcript')
    throw Error(t('部分内容已变化，请更新预览'));
  const liveNotes = scope === 'notes' && view === 'live';
  const preview = liveNotes ? { ...meeting, notes: currentNotesMarkdown() } : meeting;
  correctionReturnFocus = document.activeElement;
  correctionPanelState = {
    meetingId,
    scope,
    meeting: preview,
    latest: meeting,
    notesBase: liveNotes
      ? preview.notes === (meeting.notes || '')
        ? preview.notes
        : null
      : undefined,
    readVersion: 0,
    query,
    replacement: '',
    termSuggestions: scope === 'transcript' ? suggestedTermPairs(meeting) : [],
    matches: correctionMatches(correctionSegments(preview, scope), query),
    rules,
    saving: false,
  };
  correctionPanel.hidden = false;
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
  focusForKeyboard(
    correctionPanel.querySelector('[data-correction-find]') ||
      correctionPanel.querySelector('button'),
  );
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
  const state = correctionPanelState;
  const source = state?.sourcePreview;
  if (source) {
    source.preview.remove();
    source.input.hidden = false;
  }
  correctionPanel.hidden = true;
  ++correctionOpenVersion;
  correctionPanelState = null;
  correctionContentObserver.disconnect();
  refreshCorrectionHighlights();
  let anchor = correctionReturnFocus;
  if (
    !anchor?.isConnected &&
    state?.meetingId === correctionMeetingId() &&
    anchor?.matches('[data-open-correction], [data-correction-rules]')
  ) {
    const selector = anchor.matches('[data-correction-rules]')
      ? '[data-correction-rules]'
      : `[data-open-correction="${state.scope}"]`;
    anchor = document.querySelector('.view.active ' + selector);
  }
  if (anchor?.isConnected) anchor.focus({ preventScroll: true });
}
function renderCorrectionPanel() {
  const state = correctionPanelState;
  if (!state) return;
  const e = escapeHtml;
  const live =
    state.scope === 'transcript' &&
    meetingActive &&
    breviaClient?.state.meeting?.id === state.meetingId;
  const supportsHotword = modelCatalog.some(
    (model) => model.id === state.meeting.refined_model_id && model.supports_hotwords,
  );
  const choices = state.termSuggestions || [];
  const suggestions = choices.length
    ? `<details class="term-suggestions"><summary>${t('纪要中的纠错')} · ${choices.length}</summary>${choices.map((pair, i) => `<button type="button" data-term-suggestion="${i}">${e(pair.wrong)} → ${e(pair.correct)}</button>`).join('')}</details>`
    : '';
  const remember = `<div class="correction-term"><label><input type="checkbox" data-term-remember ${state.remember ? 'checked' : ''} />${t('记为工作区搜索别名')}</label><div class="term-options" ${state.remember ? '' : 'hidden'}>${termFlagsMarkup(state.postReplace, state.hotword, supportsHotword)}</div></div>`;
  correctionPanel.innerHTML = `<header><h2 id="correction-title">${t(state.rules ? '本场规则' : '查找与替换')}</h2><button class="icon-button" data-close-correction type="button" aria-label="${t('关闭')}">${interfaceIcon('close')}</button></header>${state.rules ? `<div class="correction-results">${state.latest.correction?.rules?.length ? state.latest.correction.rules.map((rule, index) => `<div class="correction-rule"><strong>${e(rule.find)} → ${e(rule.replacement)}</strong><span>${t(rule.enabled && live ? '已启用' : '已停用')}</span><button class="text-button" type="button" data-reuse-correction="${index}">${t('重新应用')}</button>${rule.enabled ? `<button class="text-button" type="button" data-disable-correction="${index}">${t('停用')}</button>` : ''}</div>`).join('') : `<p>${t('暂无本场规则')}</p>`}</div><footer><button class="secondary" data-close-correction type="button">${t('关闭')}</button></footer>` : `<div class="correction-fields"><label>${t('查找')}<input data-correction-find maxlength="4000" value="${e(state.query)}" autocomplete="off" /></label><label>${t('替换为')}<input data-correction-replacement maxlength="4000" value="${e(state.replacement)}" autocomplete="off" /></label></div>${suggestions}<div class="correction-match-heading"><strong data-correction-count></strong><button class="text-button" data-correction-select-all type="button">${t('全选')}</button></div><div class="correction-results" data-correction-results></div>${live ? `<label class="correction-future" title="${e(t('仅对之后确认的新字幕生效'))}"><input type="checkbox" data-correction-future${state.future ? ' checked' : ''}/><span>${t('本场后续字幕也应用此规则')}</span></label>` : ''}${remember}<p class="correction-error" role="alert"></p><footer><button class="secondary" data-close-correction type="button">${t('取消')}</button><button class="modal-action" data-submit-correction type="button"></button></footer>`}`;
  if (!state.rules) renderCorrectionResults();
}
function renderCorrectionResults(focusedMatch = document.activeElement?.dataset?.correctionMatch) {
  const state = correctionPanelState;
  if (!state || state.rules) return;
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
    (state.remember && Math.max(state.query.length, state.replacement.length) > 80) ||
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
  refreshCorrectionHighlights();
  if (focusedMatch != null)
    correctionPanel
      .querySelector(`[data-correction-match="${focusedMatch}"]`)
      ?.focus({ preventScroll: true });
}
function syncLiveCorrectionNotes() {
  const state = correctionPanelState;
  if (
    !state ||
    state.notesBase === undefined ||
    activeView !== 'live' ||
    correctionMeetingId() !== state.meetingId
  )
    return;
  const notes = currentNotesMarkdown();
  if (state.sourcePreview && state.sourcePreview.preview.textContent !== notes)
    state.sourcePreview.preview.textContent = notes;
  if (state.meeting.notes !== notes)
    updateCorrectionPreview(state, { ...state.latest, notes }, true);
}
function updateCorrectionPreview(state, meeting, localNotes = false) {
  const previousRules = state.meeting.correction?.rules || [];
  if (!localNotes) {
    state.latest = meeting;
    if (
      state.notesBase !== undefined &&
      activeView === 'live' &&
      correctionMeetingId() === state.meetingId
    ) {
      const notes = currentNotesMarkdown();
      if ((meeting.notes || '') === notes) state.notesBase = notes;
      meeting = { ...meeting, notes };
    }
  }
  if (state.saving) return;
  state.meeting = meeting;
  if (state.rules) {
    const rules = meeting.correction?.rules || [];
    if (JSON.stringify(rules) === JSON.stringify(previousRules)) return;
    const focus = document.activeElement;
    const action = focus?.matches('[data-reuse-correction]')
      ? 'reuse-correction'
      : 'disable-correction';
    const rule = previousRules[focus?.getAttribute('data-' + action)];
    const hadFocus = correctionPanel.contains(focus);
    renderCorrectionPanel();
    if (hadFocus) {
      const index = rule && rules.findIndex((item) => item.find === rule.find);
      const target =
        correctionPanel.querySelector(`[data-${action}="${index}"]`) ||
        correctionPanel.querySelector('[data-close-correction]');
      target.focus({ preventScroll: true });
    }
    return;
  }
  if (!state.query) return;
  const previous = state.matches;
  const matches = correctionMatches(correctionSegments(meeting, state.scope), state.query);
  const key = (match) => match.segment.id + ':' + match.occurrence;
  const known = new Map(previous.map((match) => [key(match), match]));
  const focusedControl = document.activeElement?.matches('[data-correction-locate]')
    ? 'correction-locate'
    : 'correction-match';
  const focused = previous[document.activeElement?.getAttribute('data-' + focusedControl)];
  let focusIndex = null;
  let changed = previous.length !== matches.length || previous.limited !== matches.limited;
  matches.forEach((match, index) => {
    const old = known.get(key(match));
    const same =
      old &&
      old.segment.text === match.segment.text &&
      old.segment.version === match.segment.version;
    match.selected = same ? old.selected : !previous.length;
    if (!same || previous[index] !== old) changed = true;
    if (focused && old === focused) focusIndex = index;
  });
  state.matches = matches;
  if (!changed) return;
  renderCorrectionResults(null);
  if (focused) {
    const selector =
      focusIndex === null ? '[data-correction-find]' : `[data-${focusedControl}="${focusIndex}"]`;
    correctionPanel.querySelector(selector)?.focus({ preventScroll: true });
  }
}

async function refreshCorrectionMeeting(state) {
  const version = ++state.readVersion;
  const read = () => window.brevia.meeting.get({ meeting_id: state.meetingId });
  let meeting;
  try {
    meeting = await read();
  } catch (error) {
    if (correctionPanelState !== state || version !== state.readVersion) return;
    try {
      meeting = await read();
    } catch (retryError) {
      if (correctionPanelState === state && version === state.readVersion) throw retryError;
      return;
    }
  }
  if (correctionPanelState !== state || version !== state.readVersion) return;
  const message = correctionPanel.querySelector('.correction-error[data-refresh-error]');
  if (message) {
    message.textContent = '';
    delete message.dataset.refreshError;
  }
  updateCorrectionPreview(state, meeting);
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
    if (state.remember)
      payload.remember = {
        workspace_id: state.meeting.workspace_id || '',
        post_replace: !!state.postReplace,
        hotword: !!state.hotword,
      };
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
    if (state.future && old && state.confirmRule !== old.replacement) {
      openConfirmation(
        t('更新本场规则'),
        `${old.find} → ${old.replacement} → ${state.replacement}`,
        () => {
          if (
            correctionPanelState !== state ||
            state.query !== payload.find ||
            state.replacement !== payload.replacement
          )
            return;
          state.confirmRule = old.replacement;
          return submitCorrection();
        },
      );
      return;
    }
    if (state.future && typeof state.confirmRule === 'string') {
      payload.confirm_rule = true;
      payload.expected_rule_replacement = state.confirmRule;
    }
  }
  correctionSaving = true;
  document.querySelectorAll('[data-correction-undo]').forEach((button) => {
    button.disabled = true;
  });
  if (state) state.saving = true;
  const enabledControls = correctionPanel.querySelectorAll('button:enabled, input:enabled');
  enabledControls.forEach((control) => {
    control.disabled = true;
  });
  const submit = correctionPanel.querySelector('[data-submit-correction]');
  if (submit) submit.textContent = t('替换中…');
  const notesWasInert = liveNotesRoot.inert;
  const editingLiveNotes = payload.scope === 'notes' && activeView === 'live';
  const notes = editingLiveNotes ? currentNotesMarkdown() : null;
  if (editingLiveNotes) liveNotesRoot.inert = true;
  try {
    if (editingLiveNotes) {
      if (state && notes !== (state.meeting.notes || '')) throw Error('error.transcript_conflict');
      await notesSavePending.catch(() => {});
      const stored = await window.brevia.meeting.get({ meeting_id: meetingId });
      if (correctionMeetingId() !== meetingId || currentNotesMarkdown() !== notes)
        throw Error('error.transcript_conflict');
      if ((stored.notes || '') !== notes) {
        if (!state || (stored.notes || '') !== state.notesBase)
          throw Error('error.transcript_conflict');
        clearTimeout(liveNotesSaveTimer.current);
        await persistNotes(meetingId, notes, stored.notes || '');
      }
    }
    const meeting = await window.brevia.segment.correction(payload);
    if (editingLiveNotes && breviaClient?.state.meeting?.id === meetingId) {
      if (currentNotesMarkdown() === notes) liveNotesEditor.setMarkdown(meeting.notes || '');
      else showToast(t('电脑笔记已更新，请重新核对。'));
    }
    if (state) state.saving = false;
    applyCorrectionMeeting(meeting);
    if (action === 'disable' && state) {
      state.latest = meeting;
      renderCorrectionPanel();
    } else closeCorrectionPanel();
  } catch (error) {
    if (state) {
      state.saving = false;
      enabledControls.forEach((control) => {
        control.disabled = false;
      });
      const message = correctionPanel.querySelector('.correction-error');
      if (message) {
        const reason =
          error.message === 'error.transcript_conflict'
            ? t('匹配内容已变化，请核对后重试')
            : userFacingError(error.message);
        message.textContent = `${t('替换失败，修改仍保留')} · ${reason}`;
      }
      if (!state.rules) {
        renderCorrectionResults();
        await refreshCorrectionMeeting(state).catch(() => {});
      }
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
    const message = correctionPanel.querySelector('.correction-error');
    message.textContent = '';
    delete message.dataset.refreshError;
    state.matches = correctionMatches(correctionSegments(state.meeting, state.scope), state.query);
  } else if (event.target.matches('[data-correction-replacement]')) {
    state.confirmRule = false;
    state.replacement = event.target.value;
  } else if (event.target.matches('[data-term-remember]')) {
    state.remember = event.target.checked;
    correctionPanel.querySelector('.term-options').hidden = !state.remember;
  } else if (event.target.matches('[data-term-post]')) state.postReplace = event.target.checked;
  else if (event.target.matches('[data-term-hotword]')) state.hotword = event.target.checked;
  else if (event.target.matches('[data-correction-future]')) state.future = event.target.checked;
  else if (event.target.matches('[data-correction-match]'))
    state.matches[Number(event.target.dataset.correctionMatch)].selected = event.target.checked;
  renderCorrectionResults();
});
correctionPanel.addEventListener('click', (event) => {
  const state = correctionPanelState;
  if (!state || state.saving) return;
  if (event.target.closest('[data-close-correction]')) closeCorrectionPanel();
  const suggestion = event.target.closest('[data-term-suggestion]');
  if (suggestion) {
    const pair = state.termSuggestions[Number(suggestion.dataset.termSuggestion)];
    state.query = pair.wrong;
    state.replacement = pair.correct;
    state.remember = false;
    state.confirmRule = false;
    state.matches = correctionMatches(correctionSegments(state.meeting, state.scope), state.query);
    renderCorrectionPanel();
    correctionPanel.querySelector('[data-correction-find]').focus();
  }
  if (event.target.closest('[data-submit-correction]')) void submitCorrection();
  if (event.target.closest('[data-correction-select-all]')) {
    state.matches.forEach((match) => {
      match.selected = true;
    });
    renderCorrectionResults();
  }
  const locate = event.target.closest('[data-correction-locate]');
  if (locate) {
    const segment = state.matches[Number(locate.dataset.correctionLocate)].segment;
    if (
      state.scope === 'transcript' &&
      activeView === 'detail' &&
      uiData.detail.transcriptSpeaker &&
      uiData.detail.transcriptSpeaker !== segment.speaker
    ) {
      uiData.detail.transcriptSpeaker = '';
      renderMeetingDetail();
    }
    const row = [...document.querySelectorAll('.view.active .segment')].find(
      (item) => item.dataset.segmentId === segment.id,
    );
    row?.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (state.scope !== 'transcript') {
      const selector =
        state.scope === 'notes'
          ? '.detail-notes-content, [data-live-notes-root] .notes-editor'
          : '.summary-document';
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
      clearSegmentPlayback();
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
    state.matches = correctionMatches(correctionSegments(state.meeting, state.scope), rule.find);
    renderCorrectionPanel();
  }
});
document.addEventListener(
  'click',
  (event) => {
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
        switchDetailDocument('summary');
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
      '.transcript-body, #transcript-scroll, .detail-notes-content, .summary-document, [data-live-notes-root]',
    )
  ) {
    event.preventDefault();
    const scope = event.target.closest('.detail-notes-content, [data-live-notes-root]')
      ? 'notes'
      : event.target.closest('.summary-document')
        ? 'summary'
        : 'transcript';
    void openCorrection(window.getSelection()?.toString() || '', false, scope).catch((error) =>
      showToast(error.message),
    );
  }
});
document.addEventListener('input', (event) => {
  if (event.target.closest('[data-live-notes-root]')) syncLiveCorrectionNotes();
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
function refreshLiveTranscriptCorrection({ meeting_id }) {
  const state = correctionPanelState;
  if (state?.meetingId === meeting_id && state.scope === 'transcript')
    void refreshCorrectionMeeting(state).catch((error) => {
      if (correctionPanelState === state && state.query && !state.saving) {
        const message = correctionPanel.querySelector('.correction-error');
        if (message) {
          message.dataset.refreshError = 'true';
          message.textContent = userFacingError(error.message);
        }
      }
    });
}
window.brevia?.on('transcript.final', refreshLiveTranscriptCorrection);
window.brevia?.on('transcript.refined', refreshLiveTranscriptCorrection);
