/** Escapes text before it is interpolated into component markup. @param {string} value Raw text. @returns {string} Safe HTML text. */
const escapeHtml = (value) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
/** Renders the shared custom select control. @param {string} name Submitted field name. @param {string} value Selected value. @param {Array<[string, string]>} options Value/label pairs. @param {boolean} activeModel Marks the active summary-model picker. @returns {string} Select markup. */
function flowSelect(name, value, options, activeModel = false) {
  const selected = options.find(([option]) => option === value) || options[0];
  return `<div class="flow-select"${activeModel ? ' data-active-summary-model' : ''}><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false">${escapeHtml(selected[1])}<span>⌄</span></button><input type="hidden" name="${name}" value="${escapeHtml(selected[0])}" /><div class="flow-select-options" hidden>${options.map(([option, label]) => `<button type="button" data-flow-select-choice="${name}" data-value="${escapeHtml(option)}">${escapeHtml(label)}</button>`).join('')}</div></div>`;
}
/** Renders one transcript entry for either live or completed meetings. @param {{time: string, seconds?: number, speaker: object, text: string, translation?: string, partial?: boolean}} entry Transcript data. @returns {string} Entry markup. */
function renderTranscriptSegment({ time, seconds, speaker, text, translation, partial = false }) {
  return `<article class="segment${partial ? ' partial' : ''}"${partial ? ' id="partial-segment"' : ''}><div class="segment-meta"><time>${time}</time><b${speaker.id ? ` data-speaker="${speaker.id}"` : ''}>${speaker.name}</b>${seconds !== undefined ? `<button class="jump" data-time="${seconds}">${t('播放此段')}</button>` : ''}</div><p>${text}</p>${translation ? `<p class="translation">${translation}</p>` : ''}</article>`;
}
/** Renders one row in the meeting library. @param {{tone: string, title: string, meta: string, tags: string[], status: object}} meeting Meeting data. @returns {string} Row markup. */
function renderMeetingRow({ tone, title, meta, tags, status }) {
  return `<article class="meeting-row" data-view="detail"><div class="meeting-color ${tone}"></div><div class="meeting-main"><h2>${title}</h2><p>${meta}</p>${tags.map((tag) => `<div class="tag">${tag}</div>`).join('')}</div><div class="meeting-status"><span class="status ${status.tone}">${status.label}</span><small>${status.detail}</small></div><button class="more" aria-label="更多操作">•••</button></article>`;
}
/** Renders a model row used by both the installed list and newly downloaded models. @param {{icon: string, name: string, detail: string}} model Model data. @returns {string} Row markup. */
function renderModelRow({ icon, name, detail }) {
  return `<div class="model-row"><span class="model-icon">${icon}</span><div><b>${name}</b><small>${detail}</small></div><span class="status complete">${t('可用')}</span></div>`;
}
/** Renders a settings card with an optional term list and modal action. @param {{title: string, description: string, terms?: string[], action: string, modal: string}} card Card data. @returns {string} Card markup. */
function renderSettingsCard({ title, description, terms, action, modal }) {
  return `<section class="settings-card"><h2>${t(title)}</h2><p>${t(description)}</p>${terms ? `<div class="terms">${terms.map((term) => `<span>${t(term)}</span>`).join('')}</div>` : ''}<button class="secondary" data-settings-modal="${modal}">${t(action)}</button></section>`;
}
/** Renders one participant in the live-meeting sidebar. @param {{id: string, name: string, source: string, avatar: string, level: string}} participant Participant data. @returns {string} Participant markup. */
function renderParticipant({ id, name, source, avatar, level }) {
  return `<div class="person"><span class="avatar ${avatar}">${id}</span><div><b data-speaker="${id}" title="双击修改名称">${name}</b><small>${t(source)}</small></div><i class="level ${level}"></i></div>`;
}
/** Renders a compact label/value list. @param {Array<{label: string, value: string}>} items Status entries. @returns {string} Definition-list markup. */
function renderStatusList(items) { return `<dl>${items.map(({ label, value }) => `<div><dt>${t(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`; }
/** Renders the read-only meeting summary in the detail sidebar. @param {{title: string, sections: object[]}} summary Summary data. @returns {string} Summary markup. */
function renderMeetingSummary({ title, sections }) {
  return `<p class="eyebrow">会议摘要</p><h2>${title}</h2>${sections.map((section) => `<section><h3>${section.title}</h3>${section.items ? section.items.map((item) => `<label><input type="checkbox" /> ${item.text}<small>${item.speaker}</small></label>`).join('') : `<p>${section.text}</p>`}</section>`).join('')}<button class="text-button">${t('生成完整会议纪要')} →</button>`;
}
/** Populates all data-driven static regions once the page shell is available. @returns {void} */
function renderStaticViews() {
  document.querySelector('.meeting-list').innerHTML = uiData.meetings.map(renderMeetingRow).join('');
  document.querySelector('#transcript-scroll').innerHTML = uiData.live.transcript.map(renderTranscriptSegment).join('');
  document.querySelector('.live-panel').innerHTML = `<section><p class="eyebrow">${t('参与者')}</p>${uiData.live.participants.map(renderParticipant).join('')}</section><section><p class="eyebrow">${t('本场状态')}</p>${renderStatusList(uiData.live.status)}</section><button class="text-button">${t('打开会议面板')} →</button>`;
  document.querySelector('#settings-view .settings-grid').innerHTML = `<section class="settings-card" id="installed-models"><h2>${t('已安装模型')}</h2>${uiData.settings.models.map(renderModelRow).join('')}<button class="secondary" data-settings-modal="models">${t('下载更多模型')}</button></section>${uiData.settings.cards.map(renderSettingsCard).join('')}`;
}
/** Refreshes the transcript and summary panes for the selected meeting. @returns {void} */
function renderMeetingDetail() {
  document.querySelector('.final-transcript').innerHTML = `<div class="tabbar"><button class="tab active">${t('逐字稿')}</button><button class="tab">${t('摘要')}</button></div>${uiData.detail.transcript.map(renderTranscriptSegment).join('')}`;
  document.querySelector('.notes').innerHTML = renderMeetingSummary(uiData.detail.summary);
}
