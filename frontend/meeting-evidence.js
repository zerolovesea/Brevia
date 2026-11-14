/** 引文展示始终使用生成时的快照；只有后端确认了当前段落，才展示反向链接。 */
function evidenceDisplayText(claim) {
  return claim.kind === 'cause' ? claim.text.replace(/^\s*cause\s*[:：]\s*/i, '') : claim.text;
}
function transcriptEvidenceLinks(claims, accepted, historicalRows) {
  const history = historicalRows && new Map(historicalRows.map((row) => [row.segmentId, row]));
  const links = new Map();
  const seen = new Set();
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
        const key = JSON.stringify([
          group,
          id,
          claim.kind,
          claim.kind === 'cause' ? claim.section : '',
          evidenceDisplayText(claim).normalize('NFKC').replace(/\s+/g, '').trim(),
        ]);
        if (seen.has(key)) continue;
        seen.add(key);
        const link = `<button type="button" class="evidence-backlink" data-evidence-back="${escapeHtml(claim.id)}" data-evidence-document="${group}" title="${escapeHtml(evidenceDisplayText(claim))}">${interfaceIcon('notebook')}<span>${escapeHtml(evidenceDisplayText(claim))}</span>${interfaceIcon('chevron-right')}</button>`;
        links.set(id, (links.get(id) || '') + link);
      }
    }
  }
  return links;
}
const claimKindLabels = { decision: '决定', action: '待办', cause: '原因分析', conclusion: '结论' };
function renderEvidenceClaim(claim, accepted, branch = null, inline = false, readOnly = false) {
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
        readOnly || source.seekable === false
          ? ''
          : `<button type="button" data-play-evidence="${index}" aria-label="${escapeHtml(t('播放此段') + ' ' + formatMeetingTime(source.start_ms))}">${interfaceIcon('play')}${formatMeetingTime(source.start_ms)}</button>`;
      const locate =
        !readOnly && source.current_segment_id
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
    !readOnly && !accepted && !claim.detached
      ? `<button type="button" class="edit-evidence" data-edit-evidence>${interfaceIcon('edit')}${escapeHtml(t('编辑'))}</button>`
      : '';
  const layout = branch
    ? ` name="cause-${escapeHtml(branch.group)}" data-ink="${branch.index % 4}"`
    : '';
  let label = evidenceDisplayText(claim);
  if (branch && claim.section) {
    const index = label.indexOf(claim.section);
    if (index >= 0) {
      const before = label.slice(0, index);
      const after = label.slice(index + claim.section.length);
      const follows = after.match(
        /^[，, ]*(?:因为|原因是|缘于|because(?: of)?|due to)\s*([^。，,；;.!?]+)/iu,
      );
      const precedes = before.match(
        /([^，,。；;：:.!?]+?)[，, ]*(?:导致|造成|致使|因此|从而|所以(?:嗯)?(?:导致)?|led to|resulted in|caused)[，, ]*$/iu,
      );
      const clause = before.match(/([^，,。；;：:.!?]+?)[，,]\s*$/u);
      const reason = follows?.[1] || precedes?.[1] || clause?.[1];
      if (reason) label = readableCauseLabel(reason);
    }
  }
  const stem = branch || inline ? '' : '<span class="claim-stem" aria-hidden="true"></span>';
  return `<details class="evidence-claim${inline ? ' evidence-inline' : ''}"${layout} data-evidence-id="${id}"${readOnly ? ' data-evidence-readonly' : ''} data-evidence-document="${accepted ? 'notes' : 'summary'}"><summary>${stem}<span class="claim-reading">${inline ? '' : `<strong>${escapeHtml(label)}</strong>`}<small>${first ? `<time>${formatMeetingTime(first.start_ms)}</time>` : ''}${sourceLabel ? `<span class="source-status">${escapeHtml(t(sourceLabel))}</span>` : ''}${claim.sources.length ? escapeHtml(tally) : ''}${claim.detached || claim.edited ? `<span>${escapeHtml(t(claim.detached ? '与当前笔记待核对' : '已编辑'))}</span>` : ''}</small></span>${interfaceIcon('chevron-down')}</summary><div class="evidence-quotes">${history}${quoteRows}${edit}</div></details>`;
}

// 使用实际排版后的端点。长段落换行、展开引文和窗口缩放都可能改变相邻分支的位置。
if (typeof customElements !== 'undefined') {
  customElements.define(
    'brevia-cause-tree',
    class extends HTMLElement {
      connectedCallback() {
        this.observer = new ResizeObserver(() => this.drawBranches());
        this.observer.observe(this);
        this.querySelectorAll('h3, h4, details, details > summary').forEach((node) =>
          this.observer.observe(node),
        );
      }
      disconnectedCallback() {
        this.observer.disconnect();
      }
      drawBranches() {
        const bounds = this.getBoundingClientRect();
        if (!bounds.width) return;
        const heading = this.querySelector('h3').getBoundingClientRect();
        const curves = this.querySelectorAll('svg.cause-tree-links > g');
        const x = 8;
        const top = heading.bottom - bounds.top;
        let bottom = top;
        let index = 0;
        this.querySelectorAll('.cause-tree-topic').forEach((topic) => {
          const subject = topic.querySelector('h4').getBoundingClientRect();
          topic.querySelectorAll('.evidence-claim > summary').forEach((summary) => {
            const curve = curves[index++];
            const card = summary.getBoundingClientRect();
            const hidden = summary.closest('.cause-tree-more:not([open])');
            curve.style.display = hidden ? 'none' : '';
            if (hidden) return;
            const endX = card.left - bounds.left;
            const endY = card.top + card.height / 2 - bounds.top;
            const y = Math.max(subject.bottom - bounds.top + 8, endY - 32);
            const midX = (x + endX) / 2;
            curve
              .querySelector('path')
              .setAttribute('d', `M ${x} ${y} C ${x} ${y + 16}, ${midX} ${endY}, ${endX} ${endY}`);
            curve.querySelector('circle').setAttribute('cx', endX);
            curve.querySelector('circle').setAttribute('cy', endY);
            bottom = Math.max(bottom, endY);
          });
        });
        this.querySelector('.cause-tree-spine').setAttribute('d', `M ${x} ${top} V ${bottom + 16}`);
      }
    },
  );
}

function readableCauseLabel(text) {
  return (
    text
      .replace(/^(?:所以|然后|其实|目前就是)\s*/u, '')
      .replace(/可以看出来是|[嗯呃]+/gu, '')
      .replace(/是比较/gu, '较')
      .replace(/会比较/gu, '会较')
      .replace(/(\p{Script=Han}{2,4})较\1较/gu, '$1较')
      .replace(/(明显|大|小|低|高|差|好)的$/u, '$1')
      .trim() || text
  );
}
function renderCauseTree(groups, readOnly = false) {
  const topics = groups
    .map(({ label, items, section, chapter }, index) => {
      const branches = items.map((claim) =>
        renderEvidenceClaim(claim, false, { group: items[0].id, index }, false, readOnly),
      );
      const visible = branches.slice(0, 3).join('');
      const more =
        branches.length > 3
          ? `<details class="cause-tree-more" data-cause-more="more-${escapeHtml(items[0].id)}"><summary>${escapeHtml(t('更多'))} · ${branches.length - 3}</summary><div class="cause-tree-branches">${branches.slice(3).join('')}</div></details>`
          : '';
      const title = escapeHtml(readableCauseLabel(label));
      const heading =
        section === undefined
          ? title
          : `<button type="button" data-summary-section-link="${section}" title="${escapeHtml(t('会议纪要') + ' · ' + chapter)}">${title}${interfaceIcon('chevron-right')}</button>`;
      return `<section class="cause-tree-topic" data-ink="${index % 4}"${section === undefined ? '' : ` data-cause-section="${section}"`}><h4>${heading}</h4><div class="cause-tree-branches">${visible}${more}</div></section>`;
    })
    .join('');
  const curves = groups
    .flatMap(({ items }, index) =>
      items.map(() => `<g data-ink="${index % 4}"><path/><circle r="2.5"/></g>`),
    )
    .join('');
  return `<section class="evidence-group evidence-cause-tree" aria-label="${escapeHtml(t('原因分析'))}"><brevia-cause-tree><svg class="cause-tree-links" aria-hidden="true"><path class="cause-tree-spine"/>${curves}</svg><h3>${escapeHtml(t('原因分析'))}</h3>${topics}</brevia-cause-tree></section>`;
}
function causeChapterGroups(claims, markdown) {
  const chaptersByLine = new Map();
  const chaptersByCause = new Map();
  for (const section of summaryDocumentSections(markdown)) {
    const label = section.title.replace(/^[* ]+|[* ]+$/g, '');
    for (const line of section.lines) {
      const key = JSON.stringify([label, line]);
      chaptersByLine.set(line, chaptersByLine.has(line) ? null : section);
      chaptersByCause.set(key, chaptersByCause.has(key) ? null : section);
    }
  }
  const groups = new Map();
  for (const claim of claims.filter((item) => item.kind === 'cause' && !item.detached)) {
    // 相同原因行分属不同结果时，用结果标题定位对应小节。
    const chapter = claim.line
      ? (chaptersByLine.get(claim.line) ??
        chaptersByCause.get(JSON.stringify([claim.section, claim.line])))
      : null;
    const label = claim.section || t('原因分析');
    const key = JSON.stringify([chapter?.id, label]);
    if (!groups.has(key))
      groups.set(key, { label, section: chapter?.id, chapter: chapter?.title, items: [] });
    const items = groups.get(key).items;
    if (
      !items.some(
        (item) =>
          item.text === claim.text &&
          item.line === claim.line &&
          JSON.stringify(item.sources) === JSON.stringify(claim.sources),
      )
    )
      items.push(claim);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.section ?? Infinity) - Number(b.section ?? Infinity) || 0,
  );
}
function renderDetailCauseRail(claims, markdown, meetingId) {
  const groups = String(markdown || '').trim() ? causeChapterGroups(claims, markdown) : [];
  if (!groups.length)
    return `<aside class="detail-cause-rail" data-meeting-id="${escapeHtml(String(meetingId))}" aria-label="${escapeHtml(t('原因分析'))}"><div class="detail-cause-scroll detail-cause-empty">${interfaceIcon('notebook')}<span>${escapeHtml(t('原因分析'))}</span></div></aside>`;
  return `<aside class="detail-cause-rail" data-meeting-id="${escapeHtml(String(meetingId))}" aria-label="${escapeHtml(t('原因分析'))}"><div class="detail-cause-scroll">${renderCauseTree(groups)}</div></aside>`;
}
function syncEvidenceReading() {
  const preview = document.querySelector('#detail-view .summary-body');
  const rail = document.querySelector('#detail-view .detail-cause-scroll');
  if (!preview || !rail) return;
  let active;
  let initialized = false;
  const followChapter = (scroll) => {
    if (detailActiveTab !== 'summary' || !preview.isConnected) return;
    const top = preview.getBoundingClientRect().top;
    const sections = [...preview.querySelectorAll('[data-summary-section]')];
    const section =
      sections.findLast((item) => item.getBoundingClientRect().top <= top + 40) || sections[0];
    if (!section || active === section.dataset.summarySection) return;
    active = section.dataset.summarySection;
    rail
      .querySelectorAll('[data-cause-section]')
      .forEach((topic) =>
        topic.classList.toggle('is-reading', topic.dataset.causeSection === active),
      );
    const topic = rail.querySelector(`[data-cause-section="${active}"]`);
    if (topic && scroll)
      rail.scrollTo({
        top:
          rail.scrollTop +
          topic.getBoundingClientRect().top -
          rail.getBoundingClientRect().top -
          Math.max(16, section.getBoundingClientRect().top - top),
      });
  };
  preview.onscroll = () => followChapter(initialized);
  // 刷新只恢复章节高亮，保留用户独立浏览原因图的位置。
  requestAnimationFrame(() => {
    followChapter(false);
    initialized = true;
  });
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
  const causes = accepted ? [] : [...groups.values()].filter((group) => group.causal);
  return (
    (causes.length ? renderCauseTree(causes) : '') +
    [...groups.values()]
      .filter((group) => accepted || !group.causal)
      .map(
        ({ label, items }) =>
          `<section class="evidence-group"><header>${interfaceIcon('notebook')}<h3>${escapeHtml(label)}</h3></header><div class="evidence-branches">${items.map((item) => renderEvidenceClaim(item, accepted)).join('')}</div></section>`,
      )
      .join('')
  );
}
function renderEvidenceNotebook(claims, markdown) {
  const occurrences = new Map();
  for (const { lines } of summaryDocumentSections(markdown))
    for (const line of lines) occurrences.set(line, (occurrences.get(line) || 0) + 1);
  const references = new Map();
  const displayLines = new Map();
  const history = [];
  for (const claim of claims) {
    if (claim.detached) history.push(claim);
    else if (claim.kind === 'cause') {
      const text = evidenceDisplayText(claim);
      if (
        text !== claim.text &&
        occurrences.get(claim.line) === 1 &&
        claim.line === claim.prefix + claim.text + claim.suffix
      )
        displayLines.set(claim.line, claim.prefix + text + claim.suffix);
    } else {
      if (claim.line && occurrences.get(claim.line) === 1)
        references.set(
          claim.line,
          (references.get(claim.line) || '') + renderEvidenceClaim(claim, false, null, true),
        );
      else history.push(claim);
    }
  }
  const disclosure = (items, label) =>
    items.length
      ? `<details class="evidence-document"><summary>${interfaceIcon('notebook')}${escapeHtml(t(label))}${interfaceIcon('chevron-down')}</summary>${renderClaimGroups(items)}</details>`
      : '';
  return `<div class="evidence-notebook"><div class="summary-document">${renderSummaryDocument(
    markdown
      .split(/\r?\n/)
      .map((line) => displayLines.get(line) ?? line)
      .join('\n'),
    references,
  )}</div>${disclosure(history, '生成时的结论')}</div>`;
}
function seekEvidence(source, play = false) {
  if (!source || source.seekable === false || !Number.isFinite(source.start_ms) || !playerAudio.src)
    return;
  const start = source.start_ms / 1000;
  if (start < 0 || (Number.isFinite(playerAudio.duration) && start > playerAudio.duration)) return;
  clearSegmentPlayback();
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
  const timestamp = event.target.closest('[data-summary-seek]');
  if (timestamp)
    return seekEvidence({ start_ms: Number(timestamp.dataset.summarySeek) * 1000 }, true);
  const sectionLink = event.target.closest('[data-summary-section-link]');
  if (sectionLink) {
    if (uiData.detail.summaryEditing) return showToast(t('请先保存或取消当前编辑'));
    if (!switchDetailDocument('summary')) return;
    const section = document.querySelector(
      `[data-summary-section="${CSS.escape(sectionLink.dataset.summarySectionLink)}"]`,
    );
    section?.scrollIntoView({ block: 'start' });
    section?.focus({ preventScroll: true });
    return;
  }
  const back = event.target.closest('[data-evidence-back]');
  if (back) {
    const card = document.querySelector(
      `[data-evidence-document="${CSS.escape(back.dataset.evidenceDocument)}"][data-evidence-id="${CSS.escape(back.dataset.evidenceBack)}"]`,
    );
    if (
      !card?.closest('.detail-cause-rail') &&
      !switchDetailDocument(back.dataset.evidenceDocument)
    )
      return;
    if (card) {
      const disclosure = card.closest('.evidence-document, .cause-tree-more');
      if (disclosure) disclosure.open = true;
      card.open = true;
      card.scrollIntoView({ block: 'center' });
      card.querySelector('summary').focus({ preventScroll: true });
    }
    return;
  }
  const card = event.target.closest('[data-evidence-id]');
  if (!card || card.hasAttribute('data-evidence-readonly')) return;
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
    uiData.detail.transcriptSpeaker = '';
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
    return `<section><h3>${escapeHtml(evidenceDisplayText(claim))}</h3>${claim.detached ? `<small>${escapeHtml(t('与当前笔记待核对'))}</small>` : ''}<div class="evidence-quotes">${quotes || escapeHtml(t('缺少原文依据'))}</div></section>`;
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
