/** 在文本插入到组件标记之前进行转义。@param {string} value 原始文本。@returns {string} 安全的 HTML 文本。 */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
/** 格式化说话人名称，支持多语言。@param {object|string} speaker 说话人对象或名称字符串。@returns {string} 格式化的说话人名称。 */
function formatSpeakerName(speaker) {
  const name = typeof speaker === 'string' ? speaker : speaker?.name;
  if (!name) return '';
  // 如果是 spk-N 格式，转换为本地化的 "说话人 N" / "Speaker N"
  const match = name.match(/^spk-(\d+)$/);
  if (match) return `${t('说话人')} ${match[1]}`;
  return name;
}
/** 判断两个视口矩形是否重叠。@param {object} first 第一个矩形。@param {object} second 第二个矩形。@returns {boolean} */
function rectanglesIntersect(first, second) { return first.left <= second.right && first.right >= second.left && first.top <= second.bottom && first.bottom >= second.top; }
/** 渲染共享的自定义选择控件。@param {string} name 提交的字段名称。@param {string} value 选中的值。@param {Array<[string, string]>} options 值/标签对。@param {boolean} activeModel 标记活动的摘要模型选择器。@returns {string} 选择框标记。 */
function flowSelect(name, value, options, activeModel = false, disabled = false) {
  // 回退到空白对，使空选项列表渲染为无害的占位符而不是抛出错误。
  const selected = options.find(([option]) => option === value) || options[0] || ['', ''];
  disabled = disabled || options.length === 0;
  return `<div class="flow-select"${activeModel ? ' data-active-summary-model' : ''}><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false"${disabled ? ' disabled' : ''}>${escapeHtml(selected[1])}<span>⌄</span></button><input type="hidden" name="${name}" value="${escapeHtml(selected[0])}" /><div class="flow-select-options" hidden>${options.map(([option, label]) => `<button type="button" data-flow-select-choice="${name}" data-value="${escapeHtml(option)}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`).join('')}</div></div>`;
}
/** 渲染一条逐字稿条目，用于实时会议或已完成的会议。@param {{time: string, seconds?: number, startSeconds?: number, endSeconds?: number, speaker: object, text: string, translation?: string, partial?: boolean}} entry 逐字稿数据。@returns {string} 条目标记。 */
function renderTranscriptSegment({ time, seconds, startSeconds, endSeconds, speaker, text, translation, partial = false }) {
  const timing = Number.isFinite(startSeconds) && Number.isFinite(endSeconds) ? ` data-start="${startSeconds}" data-end="${endSeconds}"` : '';
  const label = speaker.editing ? `<form class="inline-segment-speaker-form" data-segment-id="${speaker.segmentId}"><input class="speaker-name-input" data-segment-speaker-input name="name" value="${escapeHtml(speaker.name)}" maxlength="32" /></form>` : `<button class="segment-speaker"${speaker.segmentId ? ` data-segment-speaker="${escapeHtml(speaker.segmentId)}"` : ''}${speaker.id ? ` data-speaker="${escapeHtml(speaker.id)}"` : ''}>${escapeHtml(speaker.name)}</button>`;
  const overlap = speaker.overlapNames?.length ? `<small class="overlap-speakers">${t('重叠说话')}：${escapeHtml(speaker.overlapNames.join('、'))}</small>` : '';
  return `<article class="segment${partial ? ' partial' : ''}"${partial ? ' id="partial-segment"' : ''}${speaker.segmentId ? ` data-segment-id="${escapeHtml(speaker.segmentId)}"` : ''}${timing}><div class="segment-meta"><time>${escapeHtml(time)}</time>${label}${overlap}${seconds !== undefined ? `<button class="jump" data-time="${Number(seconds)}">${t('播放此段')}</button>` : ''}</div><div class="segment-copy"><p>${escapeHtml(text)}</p>${translation ? `<p class="translation">${escapeHtml(translation)}</p>` : ''}</div></article>`;
}
/** 渲染会议库中的一行。@param {{tone: string, title: string, meta: string, tags: string[], status: object}} meeting 会议数据。@param {number} index 会议索引。@returns {string} 行标记。 */
function renderMeetingRow({ id, tone, title, meta, tags, status, deleted = false }, index) {
  const menu = deleted ? `<button data-meeting-action="restore" data-meeting-index="${index}">${t('恢复')}</button><button class="meeting-menu-danger" data-meeting-action="purge" data-meeting-index="${index}">${BreviaI18n.trashCopy(locale).purge}</button>` : `<button data-meeting-action="rename" data-meeting-index="${index}">${t('重命名')}</button><button data-meeting-action="category" data-meeting-index="${index}">${t('分类')} <span>›</span></button><button data-meeting-action="open-folder" data-meeting-index="${index}">${t('从文件夹打开')}</button><button data-meeting-action="export" data-meeting-index="${index}">${t('导出')}</button>${status?.tone === 'processing' ? '' : `<button class="meeting-menu-danger" data-meeting-action="delete" data-meeting-index="${index}">${t('删除')}</button>`}`;
  const microphone = '<svg class="meeting-color" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-5 8v1a5 5 0 0 0 10 0v-1M12 17v4m-3 0h6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  const heading = editingMeetingIndex === index ? `<form class="meeting-title-rename" data-rename-meeting data-meeting-index="${index}"><input name="title" value="${escapeHtml(title)}" maxlength="120" required aria-label="${t('重命名')}" /></form>` : `<h2>${escapeHtml(title)}</h2>`;
  return `<article class="meeting-row" data-meeting-index="${index}" data-selection-key="${escapeHtml(id || String(index))}" tabindex="0" aria-selected="false"${id ? ` data-meeting-id="${escapeHtml(id)}"` : ''}>${microphone}<div class="meeting-main">${heading}<p>${escapeHtml(meta)}</p>${tags.map((tag) => `<div class="tag">${escapeHtml(tag)}</div>`).join('')}</div><div class="meeting-status"><span class="status ${status.tone}">${escapeHtml(t(status.label))}</span><small>${escapeHtml(t(status.detail))}</small></div><div class="meeting-actions"><button class="more" data-meeting-menu="${index}" aria-label="${t('更多操作')}" aria-expanded="false">•••</button><div class="meeting-menu" hidden>${menu}</div><div class="meeting-category-menu" hidden><button class="meeting-menu-back" data-meeting-action="back">← ${t('分类')}</button><button data-assign-category="" data-meeting-index="${index}">${t('未分类')}</button>${categories.map((category) => `<span><button data-assign-category="${escapeHtml(category)}" data-meeting-index="${index}">${escapeHtml(category)}</button><button class="meeting-category-delete" data-delete-meeting-category="${escapeHtml(category)}" aria-label="${t('删除')} ${escapeHtml(category)}">×</button></span>`).join('')}<form data-new-meeting-category><input name="category" maxlength="32" placeholder="${t('新分类名称')}" required /><button type="submit">${t('添加')}</button></form></div></div></article>`;
}
/** 渲染模型行，用于模型库和新下载的模型。@param {{icon: string, name: string, detail: string, intro?: string}} model 模型数据。@returns {string} 行标记。 */
function renderModelRow({ icon, name, detail, intro = '' }) {
  return `<div class="model-row"><span class="model-icon">${icon}</span><div><b>${name}</b><small>${t(detail)}</small>${intro ? `<small>${t(intro)}</small>` : ''}</div><span class="status complete">${t('可用')}</span></div>`;
}
/** 渲染设置卡片及其模态框操作。@param {{title: string, description: string, action: string, modal: string}} card 卡片数据。@returns {string} 卡片标记。 */
function renderSettingsCard({ title, description, action, modal }) {
  return `<section class="settings-card"><h2>${t(title)}</h2><p>${t(description)}</p><button class="secondary" data-settings-modal="${modal}">${t(action)}</button></section>`;
}
/** 渲染语言相关的设置卡片，不重置其他视图。 */
function renderSettingsView() {
  document.querySelector('#settings-view .settings-grid').innerHTML = `<section class="settings-card" id="installed-models"><h2>${t('模型库')}</h2><p>${t('管理语言识别模型的下载、删除与版本信息。')}</p><button class="secondary" data-settings-modal="models">${t('管理模型库')}</button></section>${uiData.settings.cards.map(renderSettingsCard).join('')}`;
}
/** 渲染实时会议侧边栏中的一个参与者。@param {{id: string, speakerId?: string, name: string, source: string, avatar: string, level: string}} participant 参与者数据。@returns {string} 参与者标记。 */
function renderParticipant({ id, speakerId = id, name, source, avatar, level }) {
  return `<div class="person"><span class="avatar ${escapeHtml(avatar)}">${escapeHtml(id)}</span><div><b data-speaker="${escapeHtml(speakerId)}" title="双击修改名称">${escapeHtml(name)}</b><small>${escapeHtml(t(source))}</small></div><i class="level ${escapeHtml(level)}"></i></div>`;
}
/** 渲染紧凑的标签/值列表。@param {Array<{label: string, value: string}>} items 状态条目。@returns {string} 定义列表标记。 */
function renderStatusList(items) { return `<dl>${items.map(({ label, value }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`; }
/** 渲染生成的会议纪要所使用的 Markdown 子集，已对模型输出进行转义。 */
function renderMarkdown(markdown) {
  const inline = (value) => escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const html = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const level = heading[1].length; html.push(`<h${level}>${inline(heading[2])}</h${level}>`); index += 1; continue; }
    if (/^\|/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\|/.test(lines[index])) rows.push(lines[index++].split('|').slice(1, -1).map((cell) => inline(cell.trim())));
      const body = rows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
      if (body.length) html.push(`<table><thead><tr>${body[0].map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(/^[-*]\s+/, ''))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`); continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}\s+|\||[-*]\s+)/.test(lines[index])) paragraph.push(lines[index++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('');
}
/** 渲染详情侧边栏中裁剪后的会议摘要预览。@param {{title: string, sections: object[], markdown?: string, hasFull?: boolean}} summary 摘要数据。@returns {string} 摘要标记。 */
function renderMeetingSummary({ title, sections, markdown, hasFull = false }) {
  if (markdown) return `<div class="summary-preview markdown-content">${renderMarkdown(markdown)}</div><button class="text-button" data-view-full-summary>${t('查看完整内容')} →</button>`;
  const excerpt = (text, limit) => text.length > limit ? `${text.slice(0, limit)}…` : text;
  return `<div class="summary-preview"><p class="eyebrow">${t('会议摘要')}</p><h2>${escapeHtml(excerpt(title || t('尚未生成会议摘要'), 96))}</h2>${sections.map((section) => `<section><h3>${escapeHtml(t(section.title))}</h3>${section.items ? section.items.slice(0, 2).map((item) => `<label><input type="checkbox" /> ${escapeHtml(item.text)}<small>${escapeHtml(item.speaker)}</small></label>`).join('') : `<p>${escapeHtml(excerpt(section.text, 150))}</p>`}</section>`).join('')}</div><button class="text-button" ${hasFull ? 'data-view-full-summary' : 'data-generate-summary'}>${hasFull ? t('查看完整内容') : t('生成完整会议纪要')} →</button>`;
}
/** 在页面外壳可用后填充所有数据驱动的静态区域。@returns {void} */
function renderStaticViews() {
  document.querySelector('.meeting-list').innerHTML = uiData.meetings.map(renderMeetingRow).join('');
  document.querySelector('#transcript-scroll').innerHTML = uiData.live.transcript.map(renderTranscriptSegment).join('');
  document.querySelector('.live-panel').innerHTML = `<section><p class="eyebrow">${t('参与者')}</p>${uiData.live.participants.map(renderParticipant).join('')}</section>`;
  renderSettingsView();
}
/** 刷新选定会议的逐字稿和摘要面板。@returns {void} */
function renderMeetingDetail() {
  document.querySelector('.final-transcript').innerHTML = `<div class="tabbar"><button class="tab active" data-detail-tab="transcript">${t('逐字稿')}</button><button class="tab" data-detail-tab="refined">${t('精修字稿')}</button><button class="tab" data-detail-tab="tracks">${t('双轨录音')}</button></div><div class="transcript-body" data-detail-panel="transcript">${uiData.detail.transcript.map(renderTranscriptSegment).join('')}</div><div class="transcript-body" data-detail-panel="refined" hidden>${uiData.detail.refinedTranscript.map(({ speaker, text }) => `<article class="segment"><div class="segment-meta"><span class="segment-speaker">${escapeHtml(formatSpeakerName(speaker))}</span></div><div class="segment-copy"><p>${escapeHtml(text)}</p></div></article>`).join('') || `<p class="refined-transcript-empty">${t('完成精修后，这里会显示不带时间戳的校对稿。')}</p>`}</div><div class="dual-track-panel" data-detail-panel="tracks" hidden></div>`;
  document.querySelector('.notes').innerHTML = renderMeetingSummary(uiData.detail.summary);
}
