/** Escapes text before it is interpolated into component markup. @param {string} value Raw text. @returns {string} Safe HTML text. */
const escapeHtml = (value) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
/** Returns whether two viewport rectangles overlap. @param {object} first First rectangle. @param {object} second Second rectangle. @returns {boolean} */
function rectanglesIntersect(first, second) { return first.left <= second.right && first.right >= second.left && first.top <= second.bottom && first.bottom >= second.top; }
/** Renders the shared custom select control. @param {string} name Submitted field name. @param {string} value Selected value. @param {Array<[string, string]>} options Value/label pairs. @param {boolean} activeModel Marks the active summary-model picker. @returns {string} Select markup. */
function flowSelect(name, value, options, activeModel = false) {
  const selected = options.find(([option]) => option === value) || options[0];
  return `<div class="flow-select"${activeModel ? ' data-active-summary-model' : ''}><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false">${escapeHtml(selected[1])}<span>⌄</span></button><input type="hidden" name="${name}" value="${escapeHtml(selected[0])}" /><div class="flow-select-options" hidden>${options.map(([option, label]) => `<button type="button" data-flow-select-choice="${name}" data-value="${escapeHtml(option)}">${escapeHtml(label)}</button>`).join('')}</div></div>`;
}
/** Renders one transcript entry for either live or completed meetings. @param {{time: string, seconds?: number, startSeconds?: number, endSeconds?: number, speaker: object, text: string, translation?: string, partial?: boolean}} entry Transcript data. @returns {string} Entry markup. */
function renderTranscriptSegment({ time, seconds, startSeconds, endSeconds, speaker, text, translation, partial = false }) {
  const timing = Number.isFinite(startSeconds) && Number.isFinite(endSeconds) ? ` data-start="${startSeconds}" data-end="${endSeconds}"` : '';
  return `<article class="segment${partial ? ' partial' : ''}"${partial ? ' id="partial-segment"' : ''}${timing}><div class="segment-meta"><time>${escapeHtml(time)}</time><b${speaker.id ? ` data-speaker="${escapeHtml(speaker.id)}"` : ''}>${escapeHtml(speaker.name)}</b>${seconds !== undefined ? `<button class="jump" data-time="${Number(seconds)}">${t('播放此段')}</button>` : ''}</div><p>${escapeHtml(text)}</p>${translation ? `<p class="translation">${escapeHtml(translation)}</p>` : ''}</article>`;
}
/** Renders one row in the meeting library. @param {{tone: string, title: string, meta: string, tags: string[], status: object}} meeting Meeting data. @param {number} index Meeting index. @returns {string} Row markup. */
function renderMeetingRow({ id, tone, title, meta, tags, status, deleted = false }, index) {
  const menu = deleted ? `<button data-meeting-action="restore" data-meeting-index="${index}">${t('恢复')}</button><button class="meeting-menu-danger" data-meeting-action="purge" data-meeting-index="${index}">${BreviaI18n.trashCopy(locale).purge}</button>` : `<button data-meeting-action="rename" data-meeting-index="${index}">${t('重命名')}</button><button data-meeting-action="category" data-meeting-index="${index}">${t('分类')} <span>›</span></button><button data-meeting-action="open-folder" data-meeting-index="${index}">${t('从文件夹打开')}</button><button data-meeting-action="export" data-meeting-index="${index}">${t('导出')}</button><button class="meeting-menu-danger" data-meeting-action="delete" data-meeting-index="${index}">${t('删除')}</button>`;
  return `<article class="meeting-row" data-meeting-index="${index}" data-selection-key="${escapeHtml(id || String(index))}" tabindex="0" aria-selected="false"${id ? ` data-meeting-id="${escapeHtml(id)}"` : ''}><div class="meeting-color ${tone}"></div><div class="meeting-main"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(meta)}</p>${tags.map((tag) => `<div class="tag">${escapeHtml(tag)}</div>`).join('')}</div><div class="meeting-status"><span class="status ${status.tone}">${escapeHtml(t(status.label))}</span><small>${escapeHtml(t(status.detail))}</small></div><div class="meeting-actions"><button class="more" data-meeting-menu="${index}" aria-label="${t('更多操作')}" aria-expanded="false">•••</button><div class="meeting-menu" hidden>${menu}</div><div class="meeting-rename-menu" hidden><form data-rename-meeting data-meeting-index="${index}"><label>${t('重命名')}<input name="title" value="${escapeHtml(title)}" maxlength="120" required /></label><span><button data-cancel-rename type="button">${t('取消')}</button><button type="submit">${t('保存')}</button></span></form></div><div class="meeting-category-menu" hidden><button class="meeting-menu-back" data-meeting-action="back">← ${t('分类')}</button><button data-assign-category="" data-meeting-index="${index}">${t('未分类')}</button>${categories.map((category) => `<span><button data-assign-category="${escapeHtml(category)}" data-meeting-index="${index}">${escapeHtml(category)}</button><button class="meeting-category-delete" data-delete-meeting-category="${escapeHtml(category)}" aria-label="${t('删除')} ${escapeHtml(category)}">×</button></span>`).join('')}<form data-new-meeting-category><input name="category" maxlength="32" placeholder="${t('新分类名称')}" required /><button type="submit">${t('添加')}</button></form></div></div></article>`;
}
/** Renders a model row used by both the library and newly downloaded models. @param {{icon: string, name: string, detail: string, intro?: string}} model Model data. @returns {string} Row markup. */
function renderModelRow({ icon, name, detail, intro = '' }) {
  return `<div class="model-row"><span class="model-icon">${icon}</span><div><b>${name}</b><small>${t(detail)}</small>${intro ? `<small>${t(intro)}</small>` : ''}</div><span class="status complete">${t('可用')}</span></div>`;
}
/** Renders a settings card with an optional term list and modal action. @param {{title: string, description: string, terms?: string[], action: string, modal: string}} card Card data. @returns {string} Card markup. */
function renderSettingsCard({ title, description, terms, action, modal }) {
  return `<section class="settings-card"><h2>${t(title)}</h2><p>${t(description)}</p>${terms ? `<div class="terms">${terms.map((term) => `<span>${t(term)}</span>`).join('')}</div>` : ''}<button class="secondary" data-settings-modal="${modal}">${t(action)}</button></section>`;
}
/** Renders one participant in the live-meeting sidebar. @param {{id: string, speakerId?: string, name: string, source: string, avatar: string, level: string}} participant Participant data. @returns {string} Participant markup. */
function renderParticipant({ id, speakerId = id, name, source, avatar, level }) {
  return `<div class="person"><span class="avatar ${avatar}">${id}</span><div><b data-speaker="${speakerId}" title="双击修改名称">${name}</b><small>${t(source)}</small></div><i class="level ${level}"></i></div>`;
}
/** Renders a compact label/value list. @param {Array<{label: string, value: string}>} items Status entries. @returns {string} Definition-list markup. */
function renderStatusList(items) { return `<dl>${items.map(({ label, value }) => `<div><dt>${t(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`; }
/** Renders the clipped meeting-summary preview in the detail sidebar. @param {{title: string, sections: object[], hasFull?: boolean}} summary Summary data. @returns {string} Summary markup. */
function renderMeetingSummary({ title, sections, hasFull = false }) {
  const excerpt = (text, limit) => text.length > limit ? `${text.slice(0, limit)}…` : text;
  return `<div class="summary-preview"><p class="eyebrow">${t('会议摘要')}</p><h2>${escapeHtml(excerpt(title || t('尚未生成会议摘要'), 96))}</h2>${sections.map((section) => `<section><h3>${escapeHtml(t(section.title))}</h3>${section.items ? section.items.slice(0, 2).map((item) => `<label><input type="checkbox" /> ${escapeHtml(item.text)}<small>${escapeHtml(item.speaker)}</small></label>`).join('') : `<p>${escapeHtml(excerpt(section.text, 150))}</p>`}</section>`).join('')}</div><button class="text-button" ${hasFull ? 'data-view-full-summary' : 'data-generate-summary'}>${hasFull ? t('查看完整内容') : t('生成完整会议纪要')} →</button>`;
}
/** Populates all data-driven static regions once the page shell is available. @returns {void} */
function renderStaticViews() {
  document.querySelector('.meeting-list').innerHTML = uiData.meetings.map(renderMeetingRow).join('');
  document.querySelector('#transcript-scroll').innerHTML = uiData.live.transcript.map(renderTranscriptSegment).join('');
  document.querySelector('.live-panel').innerHTML = `<section><p class="eyebrow">${t('参与者')}</p>${uiData.live.participants.map(renderParticipant).join('')}</section><section><p class="eyebrow">${t('本场状态')}</p>${renderStatusList(uiData.live.status)}</section><button class="text-button">${t('打开会议面板')} →</button>`;
  document.querySelector('#settings-view .settings-grid').innerHTML = `<section class="settings-card" id="installed-models"><h2>${t('模型库')}</h2><p>${t('管理语言识别模型的下载、删除与版本信息。')}</p><button class="secondary" data-settings-modal="models">${t('管理模型库')}</button></section>${uiData.settings.cards.map(renderSettingsCard).join('')}`;
}
/** Refreshes the transcript and summary panes for the selected meeting. @returns {void} */
function renderMeetingDetail() {
  document.querySelector('.final-transcript').innerHTML = `<div class="tabbar"><button class="tab active" data-detail-tab="transcript">${t('逐字稿')}</button><button class="tab" data-detail-tab="tracks">${t('双轨录音')}</button></div><div class="transcript-body" data-detail-panel="transcript">${uiData.detail.transcript.map(renderTranscriptSegment).join('')}</div><div class="dual-track-panel" data-detail-panel="tracks" hidden></div>`;
  document.querySelector('.notes').innerHTML = renderMeetingSummary(uiData.detail.summary);
}
