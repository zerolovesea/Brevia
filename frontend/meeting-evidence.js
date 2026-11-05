/** 引文展示始终使用生成时的快照；只有后端确认了当前段落，才展示反向链接。 */
function transcriptEvidenceLinks(claims, accepted, historicalRows) {
  const history = historicalRows && new Map(historicalRows.map((row) => [row.segmentId, row]));
  const links = new Map();
  for (const [group, entries] of [
    ['summary', claims],
    ['notes', accepted],
  ]) {
    for (const claim of entries) {
      const segments = new Set();
      for (const src of claim.sources) {
        if (!history) {
          if (src.current_segment_id) segments.add(src.current_segment_id);
          continue;
        }
        const row = history.get(src.segment_id);
        if (
          row &&
          row.track === src.track &&
          row.text === src.text &&
          Math.round(row.startSeconds * 1000) === src.start_ms &&
          Math.round(row.endSeconds * 1000) === src.end_ms
        )
          segments.add(src.segment_id);
      }
      for (const id of segments) {
        const link = `<button type="button" class="evidence-backlink" data-evidence-back="${escapeHtml(claim.id)}" data-evidence-document="${group}" title="${escapeHtml(claim.text)}">${interfaceIcon('notebook')}<span>${escapeHtml(claim.text)}</span>${interfaceIcon('chevron-right')}</button>`;
        links.set(id, (links.get(id) || '') + link);
      }
    }
  }
  return links;
}
const claimKindLabels = { decision: '决定', action: '待办', cause: '原因分析', conclusion: '结论' };
function renderEvidenceClaim(claim, accepted, branch = null) {
  const sourceLabel = { changed: '原文已变化', thin: '依据较少', missing: '缺少原文依据' }[
    claim.status
  ];
  const id = escapeHtml(claim.id);
  const first = claim.sources.find((source) => source.seekable !== false);
  const tally = t('引用 {n} 段 · {c} 字')
    .replace('{n}', claim.sources.length)
    .replace('{c}', claim.source_chars ?? 0);
  const quoteRows = claim.sources
    .map((source, index) => {
      const time =
        source.seekable === false
          ? ''
          : `<button type="button" data-play-evidence="${index}" aria-label="${escapeHtml(t('播放') + ' ' + formatMeetingTime(source.start_ms))}">${interfaceIcon('play')}${formatMeetingTime(source.start_ms)}</button>`;
      const locate = source.current_segment_id
        ? `<button class="evidence-locate" type="button" data-locate-evidence="${index}">${escapeHtml(t('逐字稿'))}${interfaceIcon('chevron-right')}</button>`
        : '';
      return `<blockquote><div>${time}<span>${escapeHtml(formatSpeakerName(source.speaker))}</span>${locate}</div><p>${escapeHtml(source.text)}</p></blockquote>`;
    })
    .join('');
  const history =
    claim.edited && claim.original_text !== claim.text
      ? `<p class="evidence-original"><b>${escapeHtml(t('生成时的结论'))}</b>${escapeHtml(claim.original_text)}</p>`
      : '';
  const edit =
    !accepted && !claim.detached
      ? `<button type="button" class="edit-evidence" data-edit-evidence>${interfaceIcon('edit')}${escapeHtml(t('编辑'))}</button>`
      : '';
  const layout = branch
    ? ` name="cause-${escapeHtml(branch.group)}" data-ink="${branch.index % 4}"`
    : '';
  const stem = branch ? '' : '<span class="claim-stem" aria-hidden="true"></span>';
  return `<details class="evidence-claim"${layout} data-evidence-id="${id}" data-evidence-document="${accepted ? 'notes' : 'summary'}"><summary>${stem}<span class="claim-reading"><strong>${escapeHtml(claim.text)}</strong><small>${first ? `<time>${formatMeetingTime(first.start_ms)}</time>` : ''}${sourceLabel ? `<span class="source-status">${escapeHtml(t(sourceLabel))}</span>` : ''}${claim.sources.length ? escapeHtml(tally) : ''}${claim.detached || claim.edited ? `<span>${escapeHtml(t(claim.detached ? '与当前笔记待核对' : '已编辑'))}</span>` : ''}</small></span>${interfaceIcon('chevron-down')}</summary><div class="evidence-quotes">${history}${quoteRows}${edit}</div></details>`;
}

// 使用实际排版后的端点。长段落换行、展开引文和窗口缩放都可能改变相邻分支的位置。
if (typeof customElements !== 'undefined') {
  customElements.define(
    'brevia-cause-tree',
    class extends HTMLElement {
      connectedCallback() {
        this.observer = new ResizeObserver(() => this.drawBranches());
        this.observer.observe(this);
        this.observer.observe(this.querySelector('h3'));
        this.querySelectorAll('details, details > summary').forEach((node) =>
          this.observer.observe(node),
        );
      }
      disconnectedCallback() {
        this.observer.disconnect();
      }
      drawBranches() {
        const bounds = this.getBoundingClientRect();
        if (!bounds.width) return;
        const subject = this.querySelector('h3').getBoundingClientRect();
        const curves = this.querySelectorAll('svg.cause-tree-links > g');
        const stacked = getComputedStyle(this).getPropertyValue('--tree-stacked').trim() === '1';
        const x = (stacked ? subject.left + 13 : subject.right) - bounds.left;
        const y = (stacked ? subject.bottom : subject.top + subject.height / 2) - bounds.top;
        this.querySelectorAll('details > summary').forEach((summary, i) => {
          const card = summary.getBoundingClientRect();
          const endX = card.left - bounds.left;
          const endY = card.top + card.height / 2 - bounds.top;
          const midX = (x + endX) / 2;
          const d = stacked
            ? `M ${x} ${y} C ${x} ${y + (endY - y) * 0.48}, ${x} ${endY}, ${endX} ${endY}`
            : `M ${x} ${y} C ${midX} ${y}, ${midX} ${endY}, ${endX} ${endY}`;
          curves[i].querySelector('path').setAttribute('d', d);
          curves[i].querySelector('circle').setAttribute('cx', endX);
          curves[i].querySelector('circle').setAttribute('cy', endY);
        });
      }
    },
  );
}

function renderCauseTree(label, items) {
  const group = items[0].id;
  const branches = items
    .map((claim, index) => renderEvidenceClaim(claim, false, { group, index }))
    .join('');
  const curves = items
    .map((_, index) => `<g data-ink="${index % 4}"><path/><circle r="2.5"/></g>`)
    .join('');
  return `<section class="evidence-group evidence-cause-tree" aria-label="${escapeHtml(t('原因分析'))}"><brevia-cause-tree><svg class="cause-tree-links" aria-hidden="true">${curves}</svg><h3>${label !== t('原因分析') ? `<small>${escapeHtml(t('原因分析'))}</small>` : ''}<span>${escapeHtml(label)}</span></h3><div class="cause-tree-branches">${branches}</div></brevia-cause-tree></section>`;
}
function renderClaimGroups(claims, accepted = false) {
  const groups = new Map();
  for (const claim of claims) {
    const label = accepted
      ? t('已采纳的 AI 笔记')
      : claim.section || t(claimKindLabels[claim.kind] || '结论');
    const key = (claim.kind === 'cause' ? 'cause:' : 'note:') + label;
    if (!groups.has(key)) groups.set(key, { label, causal: claim.kind === 'cause', items: [] });
    groups.get(key).items.push(claim);
  }
  return [...groups.values()]
    .map(({ label, causal, items }) =>
      causal && !accepted
        ? renderCauseTree(label, items)
        : `<section class="evidence-group"><header>${interfaceIcon('notebook')}<h3>${escapeHtml(label)}</h3></header><div class="evidence-branches">${items.map((item) => renderEvidenceClaim(item, accepted)).join('')}</div></section>`,
    )
    .join('');
}
function renderEvidenceNotebook(claims, markdown) {
  const causes = claims.filter((claim) => claim.kind === 'cause' && !claim.detached);
  const references = claims.filter((claim) => claim.kind !== 'cause' && !claim.detached);
  const history = claims.filter((claim) => claim.detached);
  const disclosure = (items, label) =>
    items.length
      ? `<details class="evidence-document"><summary>${interfaceIcon('notebook')}${escapeHtml(t(label))}${interfaceIcon('chevron-down')}</summary>${renderClaimGroups(items)}</details>`
      : '';
  return `<div class="evidence-notebook">${renderClaimGroups(causes)}<div class="summary-document">${renderSummaryDocument(markdown)}</div>${disclosure(references, '引用')}${disclosure(history, '生成时的结论')}</div>`;
}
function seekEvidence(source, play = false) {
  if (!source || source.seekable === false || !Number.isFinite(source.start_ms) || !playerAudio.src)
    return;
  const start = source.start_ms / 1000;
  playerAudio.currentTime = start;
  progress.value = start;
  renderPlayerTime();
  if (play)
    void playerAudio.play().catch((error) => {
      if (error.name !== 'AbortError') showToast(error.message, undefined, 'error');
    });
}
function editEvidenceClaim(claim, meetingId) {
  const dialog = document.createElement('dialog');
  dialog.className = 'claim-edit-dialog';
  dialog.setAttribute('aria-label', t('编辑结论'));
  dialog.innerHTML = `<form><label><strong>${escapeHtml(t('编辑结论'))}</strong><textarea required maxlength="4000" rows="4"></textarea></label><p role="alert" hidden></p><footer><button class="secondary" type="button">${escapeHtml(t('取消'))}</button><button class="primary-action" type="submit">${escapeHtml(t('保存'))}</button></footer></form>`;
  const input = dialog.querySelector('textarea');
  input.value = claim.text;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
  dialog.addEventListener('cancel', (event) => {
    if (input.disabled) event.preventDefault();
  });
  dialog.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const text = input.value.trim().replace(/\s*[\r\n]+\s*/g, ' ');
    if (!text || input.disabled) return;
    if (text === claim.text) return dialog.close();
    const controls = [...dialog.querySelectorAll('button, textarea')];
    controls.forEach((control) => (control.disabled = true));
    try {
      await window.brevia.summary.save({
        meeting_id: meetingId,
        claim_id: claim.id,
        expected_text: claim.text,
        text,
      });
      const meeting = await window.brevia.meeting.get({ meeting_id: meetingId });
      if (currentMeetingDetail?.id === meetingId) applyBackendDetail(meeting);
      dialog.close();
    } catch (error) {
      const message = dialog.querySelector('[role="alert"]');
      message.textContent = userFacingError(error.detail || error.message);
      message.hidden = false;
      controls.forEach((control) => (control.disabled = false));
    }
  };
  dialog.showModal();
  input.focus();
}
document.addEventListener('click', (event) => {
  const back = event.target.closest('[data-evidence-back]');
  if (back) {
    if (!switchDetailDocument(back.dataset.evidenceDocument)) return;
    const card = document.querySelector(
      `[data-evidence-document="${CSS.escape(back.dataset.evidenceDocument)}"][data-evidence-id="${CSS.escape(back.dataset.evidenceBack)}"]`,
    );
    if (card) {
      const document = card.closest('.evidence-document');
      if (document) document.open = true;
      card.open = true;
      card.scrollIntoView({ block: 'center' });
      card.querySelector('summary').focus({ preventScroll: true });
    }
    return;
  }
  const card = event.target.closest('[data-evidence-id]');
  if (!card) return;
  const claims =
    card.dataset.evidenceDocument === 'notes'
      ? uiData.detail.acceptedClaims
      : uiData.detail.summary?.claims;
  const claim = claims?.find((item) => item.id === card.dataset.evidenceId);
  if (!claim) return;
  if (event.target.closest('[data-edit-evidence]'))
    return editEvidenceClaim(claim, currentMeetingDetail.id);
  const locate = event.target.closest('[data-locate-evidence]');
  if (locate) {
    const source = claim.sources[Number(locate.dataset.locateEvidence)];
    if (!source?.current_segment_id) return;
    if (uiData.detail.transcriptEditing) return showToast(t('请先保存或取消当前编辑'));
    if (!switchDetailDocument('transcript')) return;
    uiData.detail.transcriptSearch = '';
    uiData.detail.transcriptVersion = uiData.detail.hasRefined ? 'refined' : 'original';
    renderMeetingDetail();
    const segment = document.querySelector(
      `.transcript-body [data-segment-id="${CSS.escape(source.current_segment_id)}"]`,
    );
    segment?.scrollIntoView({ block: 'center' });
    segment
      ?.querySelector(
        `[data-evidence-back="${CSS.escape(claim.id)}"][data-evidence-document="${CSS.escape(card.dataset.evidenceDocument)}"]`,
      )
      ?.focus({ preventScroll: true });
    seekEvidence(source);
    return;
  }
  const play = event.target.closest('[data-play-evidence]');
  if (play) seekEvidence(claim.sources[Number(play.dataset.playEvidence)], true);
  else if (event.target.closest('summary') && !card.open)
    seekEvidence(claim.sources.find((source) => source.seekable !== false));
});

document.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-review-date]');
  if (!input || !input.validity.valid || !currentMeetingDetail) return;
  const id = currentMeetingDetail.id;
  input.disabled = true;
  try {
    await window.brevia.meeting.update({
      meeting_id: id,
      updates: { meeting_date: input.value || null },
    });
    const refreshed = await window.brevia.meeting.get({ meeting_id: id });
    if (currentMeetingDetail?.id === id) applyBackendDetail(refreshed);
  } catch (error) {
    if (input.isConnected) {
      input.disabled = false;
      input.value = currentMeetingDetail?.meeting_date || '';
    }
    showToast(userFacingError(error.detail || error.message), undefined, 'error');
  }
});

function liveEvidenceSegment(source) {
  const row = liveSegmentData.get(source.segment_id);
  const element = liveSegments.get(source.segment_id);
  if (
    !element?.isConnected ||
    !row ||
    row.text !== source.text ||
    row.track !== source.track ||
    row.start_ms !== source.start_ms ||
    row.end_ms !== source.end_ms ||
    element.querySelector('.segment-text-input')
  )
    return null;
  return element;
}

// 实时页只展示推理时的快照。相同秒数可能有多条字幕，不能只按时间回查。
function openLiveNoteEvidence(claims, title) {
  const meetingId = breviaClient?.state.meeting?.id;
  if (!meetingActive || !meetingId || !claims.length) return;
  const dialog = document.createElement('dialog');
  dialog.dataset.liveNoteDialog = '';
  dialog.className = 'claim-edit-dialog';
  dialog.setAttribute('aria-label', title);
  const sources = [];
  const sections = claims.map((claim) => {
    const quotes = (claim.sources || [])
      .map((source) => {
        const index = sources.push(source) - 1;
        const stamp =
          source.seekable !== false && Number.isFinite(source.start_ms)
            ? `<time>${formatMeetingTime(source.start_ms)}</time>`
            : '';
        const locate = liveEvidenceSegment(source)
          ? `<button type="button" class="evidence-locate" data-live-locate="${index}">${escapeHtml(t('逐字稿'))}${interfaceIcon('chevron-right')}</button>`
          : '';
        return `<blockquote><div>${stamp}<span>${escapeHtml(formatSpeakerName(source.speaker))}</span>${locate}</div><p>${escapeHtml(source.text)}</p></blockquote>`;
      })
      .join('');
    return `<section><h3>${escapeHtml(claim.text)}</h3>${claim.detached ? `<small>${escapeHtml(t('与当前笔记待核对'))}</small>` : ''}<div class="evidence-quotes">${quotes || escapeHtml(t('缺少原文依据'))}</div></section>`;
  });
  dialog.innerHTML = `<header><h2>${escapeHtml(title)}</h2><form method="dialog"><button class="icon-button" aria-label="${escapeHtml(t('关闭'))}">${interfaceIcon('close')}</button></form></header>${sections.join('')}`;
  dialog.addEventListener('click', (event) => {
    const button = event.target.closest('[data-live-locate]');
    if (!button || breviaClient?.state.meeting?.id !== meetingId) return;
    const row = liveEvidenceSegment(sources[Number(button.dataset.liveLocate)]);
    if (!row) {
      button.replaceWith(document.createTextNode(t('原文已变化')));
      return;
    }
    dialog.close();
    followLiveTranscript = false;
    const toggle = document.querySelector('[data-live-transcript-toggle]');
    if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center' });
  });
  clearTimeout(aiSuggestionAutoFadeTimer);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      if (latestAiSuggestion && meetingActive) scheduleAiSuggestionAutoFade();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
}
