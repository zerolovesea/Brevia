/** 在文本插入到组件标记之前进行转义。@param {string} value 原始文本。@returns {string} 安全的 HTML 文本。 */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
/** 统一的勾选 SVG 图标（线框风格，颜色跟随 currentColor，由各状态的绿色类控制）。@type {string} */
const checkIconSvg = '<svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg>';
/** 会议纪要操作共用图标。 */
const summaryActionIcons = {
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 11.8 8.3-8.3 1.7 1.7-8.3 8.3L3 13z"/><path d="m10.3 4.5 1.7 1.7"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="7" height="8" rx="1"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 6.5A5 5 0 1 0 14 10"/><path d="M13 2.5v4h-4"/></svg>',
  save: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2.5h8l2 2v9H3z"/><path d="M5 2.5v4h6v-4M5.5 12h5"/></svg>',
  cancel: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 4 8 8m0-8-8 8"/></svg>',
};
let pageTooltip;
/** 将所有悬浮说明挂到 body，避免被任意视图或滚动区裁切。 */
function showPageTooltip(anchor, text) {
  if (typeof document === 'undefined') return;
  pageTooltip ||= Object.assign(document.createElement('div'), { className: 'page-tooltip', role: 'tooltip' });
  if (!pageTooltip.parentNode) document.body.append(pageTooltip);
  pageTooltip.textContent = text || '';
  if (!pageTooltip.textContent) return;
  pageTooltip.hidden = false;
  pageTooltip.style.visibility = 'hidden';
  const rect = anchor.getBoundingClientRect();
  const box = pageTooltip.getBoundingClientRect();
  pageTooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`;
  pageTooltip.style.top = `${Math.max(8, Math.min(rect.top - box.height - 8, window.innerHeight - box.height - 8))}px`;
  pageTooltip.style.visibility = '';
}
function hidePageTooltip() { if (pageTooltip) pageTooltip.hidden = true; }
if (typeof document !== 'undefined') {
  document.addEventListener('pointerover', (event) => {
    const anchor = event.target.closest?.('.notes-toolbar button[data-tooltip]');
    if (anchor) showPageTooltip(anchor, anchor.dataset.tooltip);
  });
  document.addEventListener('pointerout', (event) => {
    const anchor = event.target.closest?.('.notes-toolbar button[data-tooltip]');
    if (anchor && !anchor.contains(event.relatedTarget)) hidePageTooltip();
  });
}
/** 格式化说话人名称，支持多语言。@param {object|string} speaker 说话人对象或名称字符串。@returns {string} 格式化的说话人名称。 */
function formatSpeakerName(speaker) {
  const name = typeof speaker === 'string' ? speaker : speaker?.name;
  if (!name) return '';
  if (name === 'local-user' || name === 'Local user') return t('本机用户');
  const match = name.match(/^(?:(mic|system)-)?spk-(\d+)$/);
  if (match) {
    const [, track, index] = match;
    const origin = track === 'mic' ? t('本机') : track === 'system' ? t('远端') : '';
    return `${origin ? `${origin} ` : ''}${t('说话人')} ${index}`;
  }
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
/** 基于本地规则检测字幕中的明显信号（数字/日期/问句），不依赖大模型。@param {string} text 字幕文本。@returns {string[]} 命中的信号键名。 */
function detectCaptionSignals(text) {
  const value = String(text || '');
  const signals = [];
  if (/\d/.test(value)) signals.push('数字');
  if (/\d{1,4}[年/.-]\d{1,2}(?:[月/.-]\d{1,2})?/.test(value) || /周[一二三四五六日天]/.test(value)) signals.push('日期');
  if (/[?？]/.test(value) || /为什么|怎么|是否/.test(value)) signals.push('问句');
  return signals;
}
/** 渲染一条逐字稿条目，用于实时会议或已完成的会议。@param {{time: string, startSeconds?: number, endSeconds?: number, speaker: object, text: string, translation?: string, partial?: boolean}} entry 逐字稿数据。@returns {string} 条目标记。 */
function renderTranscriptSegment({ time, startSeconds, endSeconds, speaker, text, translation, partial = false, showSpeaker = true }) {
  const timing = Number.isFinite(startSeconds) && Number.isFinite(endSeconds) ? ` data-start="${startSeconds}" data-end="${endSeconds}"` : '';
  const label = showSpeaker ? (speaker.editing ? `<form class="inline-segment-speaker-form" data-segment-id="${speaker.segmentId}"><input class="speaker-name-input" data-segment-speaker-input name="name" value="${escapeHtml(speaker.name)}" maxlength="32" /></form>` : `<button class="segment-speaker"${speaker.segmentId ? ` data-segment-speaker="${escapeHtml(speaker.segmentId)}"` : ''}${speaker.id ? ` data-speaker="${escapeHtml(speaker.id)}"` : ''}>${escapeHtml(speaker.name)}</button>`) : '';
  const overlap = showSpeaker && speaker.overlapNames?.length ? `<small class="overlap-speakers">${t('重叠说话')}：${escapeHtml(speaker.overlapNames.join('、'))}</small>` : '';
  const signalBadge = !partial ? (() => { const signals = detectCaptionSignals(text); return signals.length ? `<small class="caption-signals" style="white-space:nowrap;flex:none" aria-label="${signals.map((signal) => t(signal)).join('、')}">${signals.map((signal) => t(signal)).join(' · ')}</small>` : ''; })() : '';
  return `<article class="segment${partial ? ' partial' : ''}"${partial ? ' id="partial-segment"' : ''}${speaker.segmentId ? ` data-segment-id="${escapeHtml(speaker.segmentId)}"` : ''}${timing}><div class="segment-meta"><time>${escapeHtml(time)}</time>${label}${overlap}${signalBadge}</div><div class="segment-copy"><p>${escapeHtml(text)}</p>${translation ? `<p class="translation">${escapeHtml(translation)}</p>` : ''}</div></article>`;
}
/** 渲染会议库中的一行。@param {{tone: string, title: string, meta: string, tags: string[], status: object}} meeting 会议数据。@param {number} index 会议索引。@returns {string} 行标记。 */
function renderMeetingRow({ id, tone, title, meta, tags, status, deleted = false, workspaceId, workspace }, index) {
  const workspaceMenu = !deleted && typeof showWorkspaceAssignMenu === 'function'
    ? `<button data-meeting-action="workspace" data-meeting-index="${index}">${t('移至工作区')} <span>›</span></button>`
    : '';
  const menu = deleted ? `<button data-meeting-action="restore" data-meeting-index="${index}">${t('恢复')}</button><button class="meeting-menu-danger" data-meeting-action="purge" data-meeting-index="${index}">${BreviaI18n.trashCopy(locale).purge}</button>` : `<button data-meeting-action="rename" data-meeting-index="${index}">${t('重命名')}</button>${workspaceMenu}<button data-meeting-action="open-folder" data-meeting-index="${index}">${t('从文件夹打开')}</button><button data-meeting-action="export" data-meeting-index="${index}">${t('导出')}</button>${status?.tone === 'processing' ? '' : `<button class="meeting-menu-danger" data-meeting-action="delete" data-meeting-index="${index}">${t('删除')}</button>`}`;
  const heading = editingMeetingIndex === index ? `<form class="meeting-title-rename" data-rename-meeting data-meeting-index="${index}"><input name="title" value="${escapeHtml(title)}" maxlength="120" required aria-label="${t('重命名')}" /></form>` : `<h2>${escapeHtml(title)}</h2>`;
  const workspaceBadge = workspace ? `<div class="workspace-badge"><span class="workspace-icon">◆</span>${escapeHtml(workspace.name)}</div>` : '';
  return `<article class="meeting-row" data-meeting-index="${index}" data-selection-key="${escapeHtml(id || String(index))}" tabindex="0" aria-selected="false"${id ? ` data-meeting-id="${escapeHtml(id)}"` : ''}${!deleted && id ? ' draggable="true"' : ''}><div class="meeting-main">${heading}<p>${escapeHtml(meta)}</p><div class="meeting-tags">${workspaceBadge}${tags.map((tag) => `<div class="tag">${escapeHtml(tag)}</div>`).join('')}</div></div><div class="meeting-status"><span class="status ${status.tone}">${escapeHtml(t(status.label))}</span><small>${escapeHtml(t(status.detail))}</small></div><div class="meeting-actions"><button class="more" data-meeting-menu="${index}" aria-label="${t('更多操作')}" aria-expanded="false">•••</button><div class="meeting-menu" hidden>${menu}</div></div></article>`;
}
/** 渲染设置卡片及其模态框操作。@param {{title: string, description: string, action: string, modal: string}} card 卡片数据。@returns {string} 卡片标记。 */
function renderSettingsCard({ title, description, action, modal }) {
  return `<section class="settings-card" id="${modal}"><h2>${t(title)}</h2><p>${t(description)}</p><button class="secondary" data-settings-modal="${modal}">${t(action)}</button></section>`;
}
/** 渲染语言相关的设置卡片，不重置其他视图。 */
function renderSettingsView() {
  document.querySelector('#settings-view .settings-grid').innerHTML = `<section class="settings-card" id="performance-mode-card"><h2>${t('性能')}</h2><p>${t('选择性能或效率模式，在音频效果与字幕实时性之间取舍。')}</p><button class="secondary" data-settings-modal="performance">${t('配置性能模式')}</button></section><section class="settings-card" id="installed-models"><h2>${t('模型库')}</h2><p>${t('下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。')}</p><button class="secondary" data-settings-modal="models">${t('管理模型库')}</button></section>${uiData.settings.cards.map(renderSettingsCard).join('')}`;
}
/** 仅允许安全协议的链接/图片地址，阻止 javascript: 等注入。@param {string} url 原始地址。@returns {string} 安全地址。 */
function sanitizeUrl(url = '') {
  return /^(https?:|mailto:|data:image\/|brevia-note:\/\/)/i.test(url.trim()) ? url.trim() : '#';
}
/** 把富文本编辑器的 DOM 子树转换为 Markdown（支持粗体/斜体/代码/链接/图片/标题/列表/引用/表格）。@param {Node} root 根节点。@returns {string} Markdown 文本。 */
function htmlToMarkdown(root) {
  const lines = [];
  const inlineNodes = (children) => {
    let out = '';
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'ul' || tag === 'ol') continue;
      const inner = inlineNodes(child.childNodes);
      if (tag === 'b' || tag === 'strong') out += `**${inner}**`;
      else if (tag === 'i' || tag === 'em') out += `*${inner}*`;
      else if (tag === 'code') out += `\`${inner}\``;
      else if (tag === 'a') out += `[${inner}](${child.getAttribute('href') || ''})`;
      else if (tag === 'img') out += `![${child.getAttribute('alt') || ''}](${child.getAttribute('src') || ''})`;
      else out += inner;
    }
    return out;
  };
  const inline = (node) => inlineNodes(node.childNodes);
  const list = (node, depth = 0) => {
    let index = 1;
    for (const child of node.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'li') {
        lines.push(`${'  '.repeat(depth)}${node.tagName.toLowerCase() === 'ol' ? `${index}.` : '-'} ${inlineNodes(child.childNodes)}`);
        [...child.children].filter((nested) => /^(ul|ol)$/i.test(nested.tagName)).forEach((nested) => list(nested, depth + 1));
        index += 1;
      } else if (tag === 'ul' || tag === 'ol') {
        // Chromium 在 Tab 缩进时会把嵌套列表放在前一个 <li> 的同级。
        list(child, depth + 1);
      }
    }
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { if (child.textContent.trim()) lines.push(child.textContent); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'p' || tag === 'div') { lines.push(inline(child)); lines.push(''); }
      else if (/^h[1-3]$/.test(tag)) { lines.push(`${'#'.repeat(Number(tag[1]))} ${inline(child)}`); lines.push(''); }
      else if (tag === 'ul' || tag === 'ol') {
        list(child);
        lines.push('');
      } else if (tag === 'blockquote') { lines.push(`> ${inline(child)}`); lines.push(''); }
      else if (tag === 'hr') { lines.push('---'); lines.push(''); }
      else if (tag === 'table') {
        const rows = [...child.rows].map((row) => [...row.cells].map((cell) => inline(cell).replace(/\|/g, ' ').trim()));
        if (rows.length) {
          lines.push(`| ${rows[0].join(' | ')} |`);
          lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
          rows.slice(1).forEach((row) => lines.push(`| ${row.join(' | ')} |`));
          lines.push('');
        }
      }
      else lines.push(inline(child));
    }
  };
  walk(root);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** 用 <code> 包裹编辑器中当前选区；无选区时插入占位代码片段。@param {HTMLElement} editor contenteditable 区域。@returns {void} */
function wrapInlineCode(editor) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const text = range.toString();
  if (!text) { document.execCommand('insertText', false, '`代码`'); return; }
  const code = document.createElement('code');
  code.textContent = text;
  range.deleteContents();
  range.insertNode(code);
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}
/** 创建所见即所得 Markdown 笔记编辑器（富文本默认，可切 Markdown 源码），live 视图与详情页共用。
 * @param {HTMLElement} root 容器，编辑器 DOM 将追加到其中。
 * @param {{onInput?: Function, ariaLabel?: string, getMeetingId?: Function}} options 输入回调、编辑器标签与图片归属会议。
 * @returns {{setMarkdown: Function, getMarkdown: Function, setMode: Function, focus: Function}} 编辑器 API。 */
function createNotesEditor(root, options = {}) {
  const { onInput = null, ariaLabel = t('我的笔记'), getMeetingId = () => null } = options;
  const toolbarButtons = [
    ['bold', '加粗', '<b>B</b>'],
    ['italic', '斜体', '<i>I</i>'],
    ['h1', '标题 1', 'H1'],
    ['h2', '标题 2', 'H2'],
    ['h3', '标题 3', 'H3'],
    ['ul', '列表', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M7 4h6M7 8h6M7 12h6"/></svg>'],
    ['ol', '编号列表', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="1.5" y="5" font-size="6.5" fill="currentColor" stroke="none">1</text><text x="1.5" y="9.5" font-size="6.5" fill="currentColor" stroke="none">2</text><text x="1.5" y="14" font-size="6.5" fill="currentColor" stroke="none">3</text><path d="M7 4h6M7 8.5h6M7 13h6"/></svg>'],
    ['quote', '引用', '❝'],
    ['link', '插入链接', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6.2 9.8 3.6-3.6" /><path d="M7.2 11.4 5.6 13a2.6 2.6 0 0 1-3.6-3.6l1.6-1.6a2.6 2.6 0 0 1 3.6 0" /><path d="M8.8 4.6l1.6-1.6a2.6 2.6 0 0 1 3.6 3.6l-1.6 1.6a2.6 2.6 0 0 1-3.6 0" /></svg>'],
    ['image', '插入图片', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><circle cx="5.5" cy="6.2" r="1.4" /><path d="m1.5 11 3.6-3.6L11 12.8" /></svg>'],
    ['table', '插入表格', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="2" y="2" width="12" height="12"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/></svg>'],
    ['code', '行内代码', '&lt;/&gt;'],
    ['todo', '待办', '☐'],
    ['highlight', '重点', '★'],
    ['mode-toggle', '富文本', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3h9M8 3v10"/></svg>'],
  ];
  const toolbar = document.createElement('div');
  toolbar.className = 'notes-toolbar';
  toolbar.innerHTML = toolbarButtons.map(([command, key, html]) => `<button type="button" data-notes-command="${command}" data-tooltip-key="${key}" data-tooltip="${t(key)}" aria-label="${t(key)}">${html}</button>`).join('');
  const urlPop = document.createElement('div');
  urlPop.className = 'notes-url-pop';
  urlPop.hidden = true;
  urlPop.innerHTML = `<input type="text" placeholder="https://…" spellcheck="false" /><button class="notes-url-ok" data-notes-url-ok type="button">${t('确定')}</button><button class="text-button" data-notes-url-cancel type="button">${t('取消')}</button>`;
  const findPop = document.createElement('div');
  findPop.className = 'notes-find-pop';
  findPop.hidden = true;
  findPop.innerHTML = `<input data-notes-find placeholder="${t('查找')}" /><input data-notes-replace placeholder="${t('替换为')}" /><button type="button" data-notes-find-prev aria-label="${t('上一个')}">↑</button><button type="button" data-notes-find-next aria-label="${t('下一个')}">↓</button><button type="button" data-notes-replace-all>${t('全部替换')}</button><button type="button" data-notes-find-close aria-label="${t('关闭')}">×</button>`;
  const editor = document.createElement('div');
  editor.className = 'notes-editor';
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('aria-label', ariaLabel);
  editor.spellcheck = false;
  const input = document.createElement('textarea');
  input.className = 'notes-input';
  input.hidden = true;
  input.placeholder = '';
  input.spellcheck = false;
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
  imageInput.hidden = true;
  const suggestion = root.querySelector('[data-ai-suggestion]');
  root.append(toolbar, urlPop, findPop, ...(suggestion ? [suggestion] : []), editor, input, imageInput);
  // 回车产生 <p>，让富文本编辑器的 DOM 结构规范、便于转回 Markdown。
  document.execCommand('defaultParagraphSeparator', false, 'p');
  let urlTarget = null;
  let mode = 'rich';
  let findMatchIndex = -1;
  const urlInput = urlPop.querySelector('input');
  const findInput = findPop.querySelector('[data-notes-find]');
  const replaceInput = findPop.querySelector('[data-notes-replace]');
  function insertText(text) {
    if (mode === 'markdown') {
      const start = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, start) + text + input.value.slice(input.selectionEnd ?? start);
      input.focus();
      if (onInput) onInput();
    } else {
      editor.focus();
      document.execCommand('insertText', false, text);
      if (onInput) onInput();
    }
  }
  function openUrlPop(target, anchor) {
    urlTarget = target;
    urlInput.value = '';
    urlPop.hidden = false;
    const rect = anchor.getBoundingClientRect();
    urlPop.style.position = 'fixed';
    urlPop.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - urlPop.offsetHeight - 12))}px`;
    urlPop.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - urlPop.offsetWidth - 12))}px`;
    urlInput.focus();
  }
  function closeUrlPop() { urlPop.hidden = true; urlTarget = null; }
  function openFind() { findPop.hidden = false; findInput.focus(); findInput.select(); }
  function richMatches(query) {
    const nodes = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let text = ''; let node;
    while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.textContent; }
    const matches = []; const needle = query.toLocaleLowerCase(); const haystack = text.toLocaleLowerCase();
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + needle.length)) matches.push({ start: index, end: index + needle.length });
    return { nodes, matches };
  }
  function selectFindMatch(step = 1) {
    const query = findInput.value;
    if (!query) return;
    if (mode === 'markdown') {
      const haystack = input.value.toLocaleLowerCase(); const needle = query.toLocaleLowerCase();
      const startFrom = step > 0 ? (input.selectionEnd || 0) : Math.max(0, (input.selectionStart || input.value.length) - 1);
      let index = step > 0 ? haystack.indexOf(needle, startFrom) : haystack.lastIndexOf(needle, startFrom);
      if (index < 0) index = step > 0 ? haystack.indexOf(needle) : haystack.lastIndexOf(needle);
      if (index >= 0) { input.focus(); input.setSelectionRange(index, index + query.length); }
      return;
    }
    const { nodes, matches } = richMatches(query);
    if (!matches.length) return;
    findMatchIndex = (findMatchIndex + step + matches.length) % matches.length;
    const match = matches[findMatchIndex];
    const locate = (position) => nodes.find((item) => position >= item.start && position <= item.start + item.node.textContent.length);
    const start = locate(match.start); const end = locate(match.end);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start.node, match.start - start.start); range.setEnd(end.node, match.end - end.start);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  function replaceAll() {
    const query = findInput.value;
    if (!query) return;
    const source = mode === 'rich' ? htmlToMarkdown(editor) : input.value;
    const next = source.split(query).join(replaceInput.value);
    if (next === source) return;
    input.value = next; editor.innerHTML = renderMarkdown(next); findMatchIndex = -1;
    if (onInput) onInput({ programmatic: true });
  }
  /** 切换富文本 / Markdown 模式：工具栏始终可见，Markdown 模式下仅禁用依赖 execCommand 的格式按钮。 */
  function setMode(nextMode) {
    mode = nextMode === 'markdown' ? 'markdown' : 'rich';
    const richOnlyCommands = new Set(['bold', 'italic', 'h1', 'h2', 'h3', 'ul', 'ol', 'quote', 'code', 'link']);
    toolbar.querySelectorAll('[data-notes-command]').forEach((button) => {
      const command = button.dataset.notesCommand;
      if (command === 'mode-toggle') {
        const showingMarkdown = mode === 'markdown';
        button.classList.toggle('is-active', showingMarkdown);
        button.dataset.tooltip = showingMarkdown ? t('切换到富文本') : t('切换到 Markdown');
        button.setAttribute('aria-label', button.dataset.tooltip);
        button.innerHTML = showingMarkdown
          ? '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m5.5 4.5-3.5 3.5 3.5 3.5"/><path d="m10.5 4.5 3.5 3.5-3.5 3.5"/></svg>'
          : '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3h9M8 3v10"/></svg>';
        button.disabled = false;
      } else {
        button.disabled = mode === 'markdown' && richOnlyCommands.has(command);
      }
    });
    if (mode === 'markdown') {
      input.value = htmlToMarkdown(editor);
      editor.hidden = true;
      input.hidden = false;
      toolbar.hidden = false;
      urlPop.hidden = true;
    } else {
      editor.innerHTML = renderMarkdown(input.value);
      editor.hidden = false;
      input.hidden = true;
      toolbar.hidden = false;
    }
  }
  toolbar.addEventListener('mousedown', (event) => event.preventDefault());
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-notes-command]');
    if (!button) return;
    const command = button.dataset.notesCommand;
    if (command === 'mode-toggle') { setMode(mode === 'rich' ? 'markdown' : 'rich'); return; }
    editor.focus();
    if (command === 'bold') document.execCommand('bold');
    else if (command === 'italic') document.execCommand('italic');
    else if (command === 'h1' || command === 'h2' || command === 'h3') document.execCommand('formatBlock', false, command.toUpperCase());
    else if (command === 'ul') document.execCommand('insertUnorderedList');
    else if (command === 'ol') document.execCommand('insertOrderedList');
    else if (command === 'quote') document.execCommand('formatBlock', false, 'BLOCKQUOTE');
    else if (command === 'code') wrapInlineCode(editor);
    else if (command === 'table') {
      if (mode === 'markdown') insertText(`| ${t('列 1')} | ${t('列 2')} |\n| --- | --- |\n| ${t('内容')} | ${t('内容')} |`);
      else document.execCommand('insertHTML', false, `<table><thead><tr><th>${t('列 1')}</th><th>${t('列 2')}</th></tr></thead><tbody><tr><td>${t('内容')}</td><td>${t('内容')}</td></tr></tbody></table><p><br></p>`);
    }
    else if (command === 'todo') insertText(mode === 'markdown' ? '- [ ] ' : '☐ ');
    else if (command === 'highlight') {
      const prefix = t('重点：');
      if (mode === 'markdown') insertText(`**${prefix}** `);
      else { document.execCommand('bold'); document.execCommand('insertText', false, prefix); document.execCommand('bold'); if (onInput) onInput(); }
    }
    else if (command === 'link') openUrlPop(command, button);
    else if (command === 'image') imageInput.click();
  });
  imageInput.addEventListener('change', () => {
    const [file] = imageInput.files;
    imageInput.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showToast(t('图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。'));
      return;
    }
    const meetingId = getMeetingId();
    if (!meetingId || !window.brevia?.meeting?.noteImage?.save) return;
    file.arrayBuffer().then((bytes) => window.brevia.meeting.noteImage.save({ meeting_id: meetingId, mime_type: file.type, bytes }))
      .then(({ url }) => {
        if (mode === 'markdown') insertText(`![](${url})`);
        else { editor.focus(); document.execCommand('insertImage', false, url); if (onInput) onInput(); }
      })
      .catch((error) => showToast(error.message));
  });
  urlPop.querySelector('[data-notes-url-ok]').addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url && urlTarget) {
      editor.focus();
      if (urlTarget === 'link') document.execCommand('createLink', false, url);
      else document.execCommand('insertImage', false, url);
    }
    closeUrlPop();
  });
  urlPop.querySelector('[data-notes-url-cancel]').addEventListener('click', closeUrlPop);
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); urlPop.querySelector('[data-notes-url-ok]').click(); }
    if (event.key === 'Escape') closeUrlPop();
  });
  findPop.addEventListener('click', (event) => {
    if (event.target.closest('[data-notes-find-prev]')) selectFindMatch(-1);
    if (event.target.closest('[data-notes-find-next]')) selectFindMatch(1);
    if (event.target.closest('[data-notes-replace-all]')) replaceAll();
    if (event.target.closest('[data-notes-find-close]')) findPop.hidden = true;
  });
  findPop.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  findInput.addEventListener('input', () => { findMatchIndex = -1; selectFindMatch(1); });
  findInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); selectFindMatch(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') findPop.hidden = true; });
  const closeFindOnOutsidePointer = (event) => {
    if (!findPop.isConnected) { document.removeEventListener('pointerdown', closeFindOnOutsidePointer); return; }
    if (!findPop.hidden && !findPop.contains(event.target)) findPop.hidden = true;
  };
  document.addEventListener('pointerdown', closeFindOnOutsidePointer);
  [editor, input].forEach((surface) => surface.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); openFind(); }
    if (event.key !== 'Tab') return;
    const listItem = (window.getSelection()?.anchorNode?.parentElement || editor).closest('li');
    if (mode === 'rich' && listItem) {
      event.preventDefault();
      document.execCommand(event.shiftKey ? 'outdent' : 'indent');
      if (onInput) onInput();
      return;
    }
    if (mode !== 'markdown') return;
    const start = input.selectionStart;
    const lineStart = input.value.lastIndexOf('\n', start - 1) + 1;
    const indent = input.value.slice(lineStart).match(/^(\s*)(?=(?:[-*]|\d+\.)\s+)/)?.[1];
    if (indent === undefined) return;
    event.preventDefault();
    if (event.shiftKey) input.setRangeText(indent.slice(0, Math.max(0, indent.length - 2)), lineStart, lineStart + indent.length, 'preserve');
    else input.setRangeText('  ', lineStart, lineStart, 'preserve');
    if (onInput) onInput();
  }));
  editor.addEventListener('input', () => {
    const anchor = window.getSelection()?.anchorNode;
    let block = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('p, li, h1, h2, h3, blockquote');
    const ordered = /^\d+\.\s$/.test(block?.textContent || '');
    if (ordered || /^[-*]\s$/.test(block?.textContent || '')) {
      const list = document.createElement(ordered ? 'ol' : 'ul');
      const item = document.createElement('li');
      list.append(item);
      if (block === editor) editor.replaceChildren(list);
      else block.replaceWith(list);
      block = item;
      const range = document.createRange();
      range.selectNodeContents(item);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (onInput) onInput({ block });
  });
  input.addEventListener('input', () => { if (onInput) onInput(); });
  return {
    setMarkdown(markdown) {
      const text = String(markdown || '');
      input.value = text;
      editor.innerHTML = renderMarkdown(text);
    },
    appendMarkdown(markdown) {
      const existing = this.getMarkdown();
      const next = existing && existing.trim() ? `${existing.replace(/\n+$/, '')}\n\n${markdown}` : String(markdown || '');
      this.setMarkdown(next);
      // 程序化写入（AI 落笔/插入字幕等）与用户打字区分开，调用方据此决定是否
      // 触发「正在输入」信号，避免 AI 刚写完自己就被当成用户在打字。
      if (onInput) onInput({ programmatic: true });
    },
    getMarkdown() {
      return mode === 'rich' ? htmlToMarkdown(editor) : input.value;
    },
    getMode() { return mode; },
    setMode,
    focus() { (mode === 'rich' ? editor : input).focus(); },
  };
}
/** 渲染生成的会议纪要所使用的 Markdown 子集，已对模型输出进行转义。 */
function renderMarkdown(markdown) {
  const inline = (value) => escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${sanitizeUrl(src)}" alt="${alt}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener">${text}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const html = [];
  const listLine = (value) => value.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
  const renderList = (start) => {
    const first = listLine(lines[start]);
    const indent = first[1].length;
    const ordered = /\d+\.$/.test(first[2]);
    const tag = ordered ? 'ol' : 'ul';
    const items = [];
    let index = start;
    while (index < lines.length) {
      const item = listLine(lines[index]);
      if (!item || item[1].length !== indent || (/\d+\.$/.test(item[2])) !== ordered) break;
      index += 1;
      let nested = '';
      while (index < lines.length) {
        const child = listLine(lines[index]);
        if (!child || child[1].length <= indent) break;
        const rendered = renderList(index);
        nested += rendered.html;
        index = rendered.index;
      }
      items.push(`<li>${inline(item[3])}${nested}</li>`);
    }
    return { html: `<${tag}>${items.join('')}</${tag}>`, index };
  };
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
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { html.push('<hr />'); index += 1; continue; }
    if (/^>\s?/.test(line)) {
      const items = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) items.push(inline(lines[index++].replace(/^>\s?/, '')));
      html.push(`<blockquote>${items.join('<br />')}</blockquote>`); continue;
    }
    if (/^[-*]\s*\[[ xX]\]\s*/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s*\[[ xX]\]\s*/.test(lines[index])) {
        const task = lines[index++].match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
        items.push(`<li class="task-item"><span aria-hidden="true">${task[1].toLowerCase() === 'x' ? '☑' : '☐'}</span>${inline(task[2])}</li>`);
      }
      html.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (listLine(line)) {
      const rendered = renderList(index);
      html.push(rendered.html); index = rendered.index; continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}\s+|\||[-*]\s*(?:\[[ xX]\]\s*|\s)|\d+\.\s+|>\s?|---|\*\*\*|___)/.test(lines[index])) paragraph.push(lines[index++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('');
}
/** 移除旧纪要中标题前的模型控制残留，保证已保存内容也能正常显示。 */
function cleanSummaryMarkdown(markdown) {
  const text = String(markdown || '').trim();
  const heading = text.search(/^#{1,6}\s+/m);
  return heading > 0 ? text.slice(heading) : text;
}
/** 渲染详情侧边栏中的会议纪要：标题行（会议纪要 + 生成/重新生成）+ 内容。@param {{markdown?: string, hasFull?: boolean}} summary 摘要数据。@returns {string} 摘要标记。 */
function renderMeetingSummary({ markdown, hasFull = false, blocked = false, generating = false, editing = false }) {
  const blockedAttrs = blocked ? ` disabled title="${escapeHtml(t('实时会议中，结束后再生成会议纪要。'))}"` : '';
  const action = editing
    ? `<span class="summary-actions"><button class="summary-action-icon" data-cancel-inline-summary-edit title="${escapeHtml(t('取消'))}" aria-label="${escapeHtml(t('取消'))}">${summaryActionIcons.cancel}</button><button class="summary-action-icon" data-save-inline-summary title="${escapeHtml(t('保存'))}" aria-label="${escapeHtml(t('保存'))}">${summaryActionIcons.save}</button></span>`
    : generating ? '' : markdown
    ? `<span class="summary-actions"><button class="summary-action-icon" data-open-summary-edit title="${escapeHtml(t('编辑'))}" aria-label="${escapeHtml(t('编辑'))}">${summaryActionIcons.edit}</button><button class="summary-action-icon" data-copy-summary title="${escapeHtml(t('复制会议纪要'))}" aria-label="${escapeHtml(t('复制会议纪要'))}">${summaryActionIcons.copy}</button><button class="summary-action-icon" data-regenerate-summary title="${escapeHtml(t('重新生成'))}" aria-label="${escapeHtml(t('重新生成'))}"${blockedAttrs}>${summaryActionIcons.refresh}</button></span>`
    : `<button class="text-button" data-generate-summary${blockedAttrs}>${t('生成')} →</button>`;
  return `<div class="summary-preview"><div class="summary-head"><p class="eyebrow">${t('会议纪要')}</p>${action}</div>${editing ? `<div class="summary-inline-edit"><div data-inline-summary-editor></div></div>` : markdown ? `<div class="summary-body markdown-content">${renderMarkdown(cleanSummaryMarkdown(markdown))}</div><button class="text-button" data-view-full-summary>${t('查看完整内容')} →</button>` : `<p class="summary-empty">${t('尚未生成')}</p>`}</div>`;
}
/** 在页面外壳可用后填充所有数据驱动的静态区域。@returns {void} */
function renderStaticViews() {
  document.querySelector('.meeting-list').innerHTML = uiData.meetings.map(renderMeetingRow).join('');
  document.querySelector('#transcript-scroll').innerHTML = uiData.live.transcript.map(renderTranscriptSegment).join('');
  renderSettingsView();
}
/** 渲染详情页 tabbar 右侧的精修状态控件（未精修 → 按钮；精修中 → 文案；已精修 → ✓ + ··· 菜单）。@param {object} d 详情数据。@returns {string} 标记。 */
function renderRefineStatus(d) {
  if (d.refineState === 'refining') return `<span class="refine-state">${t('正在精修')}</span>`;
  if (!d.hasRefined) return `<span class="refine-wrap"><button class="secondary refine-now" data-refine-now type="button">${t('精修字幕')}</button><div class="refine-menu" hidden><label class="refine-menu-speakers"><span>${t('会议人数')}</span><input type="number" min="1" step="1" inputmode="numeric" data-refine-num-speakers placeholder="${t('留空自动识别')}" /></label><button type="button" data-refine-action="start">${t('开始精修')}</button></div></span>`;
  const modelOptions = modelCatalog
    .filter((model) => model.stages?.includes('refined') && !removedRefinedModelIds.has(model.id))
    .map((model) => `<button type="button" data-refine-model="${escapeHtml(model.id)}">${escapeHtml(model.name)}</button>`)
    .join('');
  return `<span class="refine-state is-done">${checkIconSvg} ${t('已精修')}</span><button class="refine-more" data-refine-more type="button" aria-label="${t('更多')}" aria-expanded="false">···</button><div class="refine-menu" hidden><button type="button" data-refine-action="original">${detailTranscriptView === 'original' ? t('查看精修字幕') : t('查看原始转写')}</button><button type="button" data-refine-action="re-refine">${t('重新精修')}</button><label class="refine-menu-speakers"><span>${t('会议人数')}</span><input type="number" min="1" step="1" inputmode="numeric" data-refine-num-speakers placeholder="${t('留空自动识别')}" /></label><button type="button" data-refine-action="model">${t('更换精修模型')} <span>›</span></button><div class="refine-model-list" data-refine-model-list hidden>${modelOptions}</div></div>`;
}
/** 刷新选定会议的逐字稿、笔记和摘要面板。@returns {void} */
function renderMeetingDetail() {
  const d = uiData.detail;
  const notesPanel = d.notesEditing
    ? `<div class="detail-notes-edit"><div data-detail-notes-root></div></div>`
    : `<div class="detail-notes-view">${d.notes && String(d.notes).trim() ? `<div class="detail-notes-content markdown-content">${renderMarkdown(d.notes)}</div>` : `<p class="detail-notes-empty">${t('会议中没有记录笔记。')}</p>`}</div>`;
  const notesTabAction = d.notesEditing
    ? `<button class="tabbar-action" data-notes-cancel type="button" aria-label="${t('取消')}" title="${t('取消')}"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m4 4 8 8m0-8-8 8"/></svg></button><button class="tabbar-action is-save" data-notes-save type="button" aria-label="${t('保存')}" title="${t('保存')}"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 3 3 7-7"/></svg></button>`
    : detailActiveTab === 'notes' ? `<button class="tabbar-action" data-edit-notes type="button" aria-label="${t('编辑')}" title="${t('编辑')}"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11.5 8.6-8.6 1.9 1.9-8.6 8.6L3 13.5z"/><path d="m10.5 4 1.9 1.9"/></svg></button>` : '';
  const hasRefined = Boolean(d.hasRefined && d.refinedTranscript.length);
  const fulltextMode = hasRefined && d.refinedMode === 'fulltext';
  const showingRefined = hasRefined && d.refinedMode === 'timestamps' && detailTranscriptView !== 'original';
  let transcriptBody;
  if (fulltextMode) {
    transcriptBody = `<div class="refined-fulltext"><p class="eyebrow">${t('精修全文')}</p><p class="refined-fulltext-hint">${t('经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。')}</p><div class="refined-fulltext-body">${escapeHtml(d.refinedFulltext)}</div></div>`;
  } else {
    transcriptBody = (showingRefined ? d.refinedTranscript : d.transcript).map(renderTranscriptSegment).join('');
  }
  document.querySelector('.final-transcript').innerHTML = `<div class="tabbar"><div class="tabbar-tabs"><button class="tab${detailActiveTab === 'notes' ? ' active' : ''}" data-detail-tab="notes">${t('我的笔记')}</button><button class="tab${detailActiveTab === 'transcript' ? ' active' : ''}" data-detail-tab="transcript">${t('字幕')}</button></div><div class="tabbar-extra">${notesTabAction}${renderRefineStatus(d)}</div></div><div class="detail-notes-panel" data-detail-panel="notes"${detailActiveTab !== 'notes' ? ' hidden' : ''}>${notesPanel}</div><div class="transcript-panel" data-detail-panel="transcript"${detailActiveTab !== 'transcript' ? ' hidden' : ''}><div class="transcript-body">${transcriptBody}</div></div>`;
  if (d.notesEditing) {
    const root = document.querySelector('[data-detail-notes-root]');
    if (root) {
      detailNotesEditor = createNotesEditor(root, { onInput: scheduleDetailNotesSave, getMeetingId: () => currentMeetingDetail?.id });
      detailNotesEditor.setMarkdown(d.notes);
      detailNotesEditor.focus();
    }
  }
  document.querySelector('.notes').innerHTML = renderMeetingSummary({ ...d.summary, editing: d.summaryEditing });
  if (d.summaryEditing) {
    const root = document.querySelector('[data-inline-summary-editor]');
    if (root) {
      inlineSummaryEditor = createNotesEditor(root, { ariaLabel: t('会议纪要'), getMeetingId: () => currentMeetingDetail?.id });
      inlineSummaryEditor.setMarkdown(d.summary.markdown);
      inlineSummaryEditor.focus();
    }
  }
}
