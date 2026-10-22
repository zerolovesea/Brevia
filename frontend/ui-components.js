/** 在文本插入到组件标记之前进行转义。@param {string} value 原始文本。@returns {string} 安全的 HTML 文本。 */
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character],
  );
/** 统一的勾选 SVG 图标（线框风格，颜色跟随 currentColor，由各状态的绿色类控制）。@type {string} */
const checkIconSvg =
  '<svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg>';
/** 界面共用线框图标；名称固定，外部文本不参与 SVG 插值。 */
function interfaceIcon(name) {
  const paths = {
    github:
      '<g transform="scale(1.5)"><path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></g>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2 1.8-5A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke-width="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r=".8" fill="currentColor"/><circle cx="3" cy="12" r=".8" fill="currentColor"/><circle cx="3" cy="18" r=".8" fill="currentColor"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H4v14h4"/>',
    laptop: '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M2 20h20"/>',
    notes: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    document:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    folder:
      '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    microphone:
      '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v5M8 22h8"/>',
    apple:
      '<path d="M13 6c0-3 2-4 4-4 0 2-1 4-4 4Z"/><path d="M17 12c0-2 1-3 3-4-1-2-4-3-6-2l-2 1-2-1C5 4 2 8 3 13c1 5 3 9 5 9l4-1 4 1c2 0 4-4 5-6-3-1-4-2-4-4Z"/>',
    android:
      '<path d="m7 3 2 3m8-3-2 3M5 11V9a7 7 0 0 1 14 0v2H5ZM5 13h14v6H5zM8 19v3m8-3v3M2 13v6m20-6v6"/><path d="M9 9h.01M15 9h.01"/>',
    'cloud-upload':
      '<path d="M7 18H6a4 4 0 0 1-.8-7.9 7 7 0 0 1 13.6 0A4 4 0 0 1 18 18h-1M12 21V10m-4 4 4-4 4 4"/>',
    'device-phone':
      '<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="18" r=".7" fill="currentColor"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
    advanced:
      '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    settings:
      '<path d="m9.5 3-.5 2-2 1.2-2-.6-2.5 4.3L4 11.3v2.4l-1.5 1.4L5 19.4l2-.6 2 1.2.5 2h5l.5-2 2-1.2 2 .6 2.5-4.3-1.5-1.4v-2.4l1.5-1.4L19 5.6l-2 .6L15 5l-.5-2Z"/><circle cx="12" cy="12.5" r="3"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    pin: '<path d="m14 3 7 7-4 1-4 5-2-2-6 6 6-6-2-2 5-4z"/>',
    capsule: '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 12h6"/>',
    close: '<path d="m5 5 14 14M19 5 5 19"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    refresh: '<path d="M20 4v6h-6M20 10a8 8 0 1 0-1 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
    minimize: '<path d="M5 12h14"/>',
    restore: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    'arrow-down': '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    model: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    ai: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    appearance: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>',
    storage:
      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    play: '<path d="m9 6 9 6-9 6z" fill="currentColor" stroke="none"/>',
    volume: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
    muted: '<path d="M3 9h4l5-4v14l-5-4H3zM17 9l5 6m0-6-5 6"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
    record:
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    recording: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/>',
    'play-circle': '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    translate:
      '<path d="M2 5h12M8 2v3M4 5c0 5 4 9 9 11M12 5c0 5-4 9-9 11M13 21l4-11 5 11M15 17h5"/>',
    music:
      '<path d="M10 18V5l10-2v13M10 8l10-2"/><ellipse cx="6" cy="18" rx="4" ry="3"/><ellipse cx="16" cy="16" rx="4" ry="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    captions: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 11h3m4 0h3M7 15h10"/>',
    waveform: '<path d="M4 10v4M8 5v14M12 2v20M16 6v12M20 10v4"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    'checkbox-checked':
      '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>',
    checkbox: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
    warning: '<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
    'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    edit: '<path d="m16 3 5 5L8 21H3v-5ZM14 5l5 5"/>',
    person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3c0-6 16-6 16 0v3"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'skip-back':
      '<path d="M3 8V3m0 5h5M4 7a9 9 0 1 1-1 9"/><text x="8" y="16" stroke="none" fill="currentColor" font-size="9" font-family="inherit">15</text>',
    'skip-forward':
      '<path d="M21 8V3m0 5h-5M20 7a9 9 0 1 0 1 9"/><text x="8" y="16" stroke="none" fill="currentColor" font-size="9" font-family="inherit">15</text>',
  };
  return `<svg class="interface-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.document}</svg>`;
}
/** 长任务名称可截断，真实百分比独立占位。 */
function renderTaskProgressLabel(label, percent) {
  return `<span class="task-progress-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>${percent === undefined ? '' : `<span class="task-progress-value"> · ${percent}%</span>`}`;
}
/** 引导仅表达现有步骤；内容和提交事件仍由各步骤拥有。 */
function renderOnboardingRail(kind, displayLocale = locale) {
  const translate = (key) => window.BreviaLocaleData.translate(key, displayLocale);
  const stages = ['language', 'permissions', 'setup', 'ai', 'phone'];
  const active = Math.max(0, stages.indexOf(kind));
  const motion = stages.includes(kind);
  const labels = ['语言', '权限', '模型与存储', 'AI 功能', '手机连接'];
  const details = [
    '选择界面语言',
    '授予必要权限',
    '选择 AI 模型与本地存储',
    '配置记录与总结能力',
    '可选，将手机与 Brevia 连接',
  ];
  return `<aside class="onboarding-rail${motion ? ' onboarding-motion-rail' : ''}"><div class="onboarding-brand-lockup" translate="no"><img class="onboarding-brand" src="./assets/brevia-logo.svg" alt="Brevia" /></div><h2>${escapeHtml(motion ? (window.BreviaLocaleData.onboardingMotionCopy[displayLocale] || window.BreviaLocaleData.onboardingMotionCopy.en).tagline : translate('让每一次对话，都有记录。'))}</h2>${motion ? window.BreviaOnboardingMotion.render(kind, displayLocale) : `<p>${escapeHtml(translate('录制会议，转写内容，生成要点，帮助你专注于真正重要的事。'))}</p><div class="onboarding-mechanism">${['microphone', 'document', 'list'].map((icon, index) => `${index ? `<i aria-hidden="true">${interfaceIcon('arrow-right')}</i>` : ''}<span>${interfaceIcon(icon)}<b>${escapeHtml(translate(['录制会议', '转写文字', '生成笔记'][index]))}</b><small>${escapeHtml(translate(['高质量录音', '快速准确', '提炼要点'][index]))}</small></span>`).join('')}</div>`}<ol>${labels.map((label, index) => `<li${index === active ? ' aria-current="step"' : ''}><span>${motion && index < active ? interfaceIcon('check') : index + 1}</span><div>${escapeHtml(translate(label))}${motion ? '' : `<small>${escapeHtml(translate(details[index]))}</small>`}</div></li>`).join('')}</ol></aside>`;
}
/** 设置导航与内容共用原有动作键，避免产生第二套设置状态。 */
function renderSettingsNavigation(kind) {
  const items = [
    ['general', '通用', 'settings'],
    ['models', '模型库', 'model'],
    ['ai-features', 'AI 功能', 'ai'],
    ['advanced-settings', '进阶设置', 'advanced'],
    ['speaker-profiles', '声纹管理', 'microphone'],
    ['device-connection', '设备连接', 'phone'],
    ['storage', '存储与隐私', 'storage'],
    ['whats-new', '关于与更新', 'info'],
  ];
  return `<nav class="settings-navigation" aria-label="${escapeHtml(t('设置'))}"><h2>${escapeHtml(t('设置'))}</h2>${items.map(([key, label, icon]) => `<button type="button" data-settings-page="${key}"${key === (['summary-model', 'ai-assist'].includes(kind) ? 'ai-features' : kind) ? ' aria-current="page"' : ''}>${interfaceIcon(icon)}<span>${escapeHtml(t(label))}</span></button>`).join('')}</nav>`;
}
let pageTooltip;
/** 将所有悬浮说明挂到 body，避免被任意视图或滚动区裁切。 */
function showPageTooltip(anchor, text) {
  if (typeof document === 'undefined') return;
  pageTooltip ||= Object.assign(document.createElement('div'), {
    className: 'page-tooltip',
    role: 'tooltip',
  });
  if (!pageTooltip.parentNode) document.body.append(pageTooltip);
  const quick = anchor.matches('[data-quick-recording]');
  pageTooltip.classList.toggle('quick-recording-tooltip', quick);
  pageTooltip.textContent = text || '';
  if (!pageTooltip.textContent) return;
  pageTooltip.hidden = false;
  pageTooltip.style.visibility = 'hidden';
  const rect = anchor.getBoundingClientRect();
  const box = pageTooltip.getBoundingClientRect();
  pageTooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`;
  const top = quick && rect.top - box.height - 8 < 40 ? rect.bottom + 8 : rect.top - box.height - 8;
  pageTooltip.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`;
  pageTooltip.style.visibility = '';
}
function hidePageTooltip() {
  if (pageTooltip) pageTooltip.hidden = true;
}
if (typeof document !== 'undefined') {
  // Enter 点击没有持续的 :active 状态，在业务处理前给出同样的短按压反馈。
  const keyboardButtonPresses = new WeakMap();
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || event.detail !== 0) return;
      const button = event.target.closest('button, a');
      if (
        !button ||
        button.matches(':disabled, [aria-disabled="true"]') ||
        getComputedStyle(button).getPropertyValue('--button-press-feedback').trim() !== '1' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        return;
      keyboardButtonPresses.get(button)?.cancel();
      keyboardButtonPresses.set(
        button,
        button.animate([{ scale: '1' }, { scale: '.98', offset: 80 / 260 }, { scale: '1' }], {
          duration: 260,
          easing: 'cubic-bezier(.16,1,.3,1)',
        }),
      );
    },
    true,
  );
  // 只约束最上层受保护弹窗；连续设置页仍可正常访问侧栏。
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const panels = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(
      (node) => node.getClientRects().length && !node.closest('[inert]'),
    );
    const panel = panels.find((node) => node.closest('.confirmation-modal')) || panels.at(-1);
    if (!panel) return;
    const controls = [
      ...panel.querySelectorAll(
        'button, input, select, textarea, summary, a[href], [tabindex="0"]',
      ),
    ].filter((node) => !node.disabled && node.getClientRects().length);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    if (
      index < 0 ||
      (!event.shiftKey && index === controls.length - 1) ||
      (event.shiftKey && index === 0)
    ) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0].focus();
    }
  });
  document.addEventListener('pointerover', (event) => {
    const anchor = event.target.closest?.(
      '.notes-toolbar button[data-tooltip], .model-source-switch label[data-tooltip], .segment-tools [data-tooltip], .live-caption-controls [data-tooltip], #mark-important[data-tooltip], [data-quick-recording][data-tooltip], .note-highlight [data-tooltip]',
    );
    if (anchor) showPageTooltip(anchor, anchor.dataset.tooltip);
  });
  document.addEventListener('pointerout', (event) => {
    const anchor = event.target.closest?.(
      '.notes-toolbar button[data-tooltip], .model-source-switch label[data-tooltip], .segment-tools [data-tooltip], .live-caption-controls [data-tooltip], #mark-important[data-tooltip], [data-quick-recording][data-tooltip], .note-highlight [data-tooltip]',
    );
    if (anchor && !anchor.contains(event.relatedTarget)) hidePageTooltip();
  });
  document.addEventListener('focusin', (event) => {
    const anchor = event.target.closest?.(
      '.live-caption-controls [data-tooltip], #mark-important[data-tooltip], [data-quick-recording][data-tooltip], .note-highlight [data-tooltip]',
    );
    if (anchor) showPageTooltip(anchor, anchor.dataset.tooltip);
  });
  document.addEventListener('focusout', (event) => {
    if (
      event.target.closest?.(
        '.live-caption-controls [data-tooltip], #mark-important[data-tooltip], [data-quick-recording][data-tooltip], .note-highlight [data-tooltip]',
      )
    )
      hidePageTooltip();
  });
  document.addEventListener('click', (event) => {
    if (
      event.target.closest?.(
        '.live-caption-controls, #mark-important, [data-quick-recording], .note-highlight',
      )
    )
      hidePageTooltip();
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
function rectanglesIntersect(first, second) {
  return (
    first.left <= second.right &&
    first.right >= second.left &&
    first.top <= second.bottom &&
    first.bottom >= second.top
  );
}
/** 渲染共享的自定义选择控件。
 *
 * 选项是 `[值, 文案]` 或 `[值, 文案, 角标]`。角标只在展开选项中、模型名右侧显示；
 * 选中态只保留模型名。
 * @param {string} name 提交的字段名称。@param {string} value 选中的值。@param {Array<[string, string, string?]>} options 值/标签/角标三元组。@param {boolean} activeModel 标记活动的摘要模型选择器。@returns {string} 选择框标记。 */
function flowSelect(name, value, options, activeModel = false, disabled = false) {
  // 回退到空白对，使空选项列表渲染为无害的占位符而不是抛出错误。
  const selected = options.find(([option]) => option === value) || options[0] || ['', ''];
  const badge = (option) =>
    option?.[2] ? `<em class="flow-select-badge">${escapeHtml(option[2])}</em>` : '';
  const icon = {
    'meeting-workspace': 'folder',
    'meeting-language': 'globe',
    'translation-target': 'translate',
    'meeting-speakers': 'person',
    'refined-model': 'cpu',
    'mic-device': 'microphone',
    'phone-device': 'phone',
  }[name];
  disabled = disabled || options.length === 0;
  return `<div class="flow-select"${activeModel ? ' data-active-summary-model' : ''}><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false"${disabled ? ' disabled' : ''}>${escapeHtml(selected[1])}${icon ? `<span class="select-value-icon">${interfaceIcon(icon)}</span>` : ''}<span class="select-chevron">${interfaceIcon('chevron-down')}</span></button><input type="hidden" name="${name}" value="${escapeHtml(selected[0])}" /><div class="flow-select-options" hidden>${options.map((option) => `<button type="button" data-flow-select-choice="${name}" data-value="${escapeHtml(option[0])}" data-label="${escapeHtml(option[1])}"${option[0] === selected[0] ? ' aria-current="true"' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(option[1])}${badge(option)}</button>`).join('')}</div></div>`;
}
/** 基于本地规则检测字幕中的明显信号（数字/日期/问句），不依赖大模型。@param {string} text 字幕文本。@returns {string[]} 命中的信号键名。 */
function detectCaptionSignals(text) {
  const value = String(text || '');
  const signals = [];
  if (/\d/.test(value)) signals.push('数字');
  if (/\d{1,4}[年/.-]\d{1,2}(?:[月/.-]\d{1,2})?/.test(value) || /周[一二三四五六日天]/.test(value))
    signals.push('日期');
  if (/[?？]/.test(value) || /为什么|怎么|是否/.test(value)) signals.push('问句');
  return signals;
}
/** 渲染一条逐字稿条目，用于实时会议或已完成的会议。@param {{time: string, startSeconds?: number, endSeconds?: number, speaker: object, text: string, translation?: string, segmentId?: string, textEditable?: boolean}} entry 逐字稿数据。@returns {string} 条目标记。 */
function renderCorrectedTranscript(text, word) {
  if (!word) return escapeHtml(text);
  return String(text)
    .split(word)
    .map(escapeHtml)
    .join(`<mark class="correction-saved-word">${escapeHtml(word)}</mark>`);
}
function renderTranscriptSegment({
  time,
  startSeconds,
  endSeconds,
  speaker,
  text,
  translation,
  showSpeaker = true,
  segmentId,
  textEditable = false,
  textModified = false,
  textSaving = false,
  textError = '',
  userEdited = false,
  translationStale = false,
  replacementHighlight = '',
}) {
  const timing =
    Number.isFinite(startSeconds) && Number.isFinite(endSeconds)
      ? ` data-start="${startSeconds}" data-end="${endSeconds}"`
      : '';
  const label = showSpeaker
    ? speaker.editing
      ? `<form class="inline-segment-speaker-form" data-segment-id="${speaker.segmentId}"><input class="speaker-name-input" data-segment-speaker-input name="name" value="${escapeHtml(speaker.name)}" maxlength="32" /></form>`
      : textEditable
        ? `<span class="segment-speaker">${escapeHtml(speaker.name)}</span>`
        : `<button class="segment-speaker"${speaker.segmentId ? ` data-segment-speaker="${escapeHtml(speaker.segmentId)}"` : ''}${speaker.id ? ` data-speaker="${escapeHtml(speaker.id)}"` : ''}>${escapeHtml(speaker.name)}</button>`
    : '';
  const overlap =
    showSpeaker && speaker.overlapNames?.length
      ? `<small class="overlap-speakers">${t('重叠说话')}：${escapeHtml(speaker.overlapNames.join('、'))}</small>`
      : '';
  // 人工编辑态下原文本正在被改写，依赖文本的信号徽标会立刻过期，因此只在只读态显示。
  const signalBadge =
    showSpeaker && !textEditable
      ? (() => {
          const signals = detectCaptionSignals(text);
          return signals.length
            ? `<small class="caption-signals" aria-label="${signals.map((signal) => t(signal)).join('、')}">${signals.map((signal) => t(signal)).join(' · ')}</small>`
            : '';
        })()
      : '';
  const translationLine = translation
    ? translationStale
      ? `<p class="translation is-stale">${t('译文 · 待更新')}</p>`
      : `<p class="translation">${textEditable ? `<span>${escapeHtml(t(textModified ? '译文（未更新）' : '翻译'))}</span> ` : ''}${escapeHtml(translation)}</p>`
    : '';
  // 编辑框与 electron/main.js 的 segment.text schema 同界（单句 4000 字符）；
  // 保存时后端会把换行折成空格，因此这里不需要限制成单行输入。
  const copy =
    textEditable && segmentId
      ? `<div class="segment-copy${textModified ? ' is-modified' : ''}">${textModified ? `<small class="segment-modified-state">${t('已修改')}</small>` : ''}<textarea class="segment-text-input"${textSaving ? ' disabled' : ''}${textError ? ' aria-invalid="true"' : ''} data-segment-text="${escapeHtml(segmentId)}" rows="1" maxlength="4000" aria-label="${escapeHtml(t('字幕文本'))}">${escapeHtml(text)}</textarea>${textError ? `<small class="segment-edit-error" role="alert">${escapeHtml(textError)}</small>` : ''}${translationLine}</div>`
      : `<div class="segment-copy">${userEdited ? `<small class="segment-modified-state">${t('已修改')}</small>` : ''}<p>${renderCorrectedTranscript(text, replacementHighlight)}</p>${translationLine}</div>`;
  // 右键菜单按段落 id 定位：详情页（原始/精修稿）只带顶层 segmentId，实时条目只带 speaker.segmentId。
  const contextSegmentId = segmentId || speaker.segmentId;
  const tools =
    contextSegmentId && !textEditable
      ? `<div class="segment-tools" role="group" aria-label="${escapeHtml(t('字幕'))}">${[
          ...(!showSpeaker ? [['edit', 'edit', '编辑']] : []),
          ['speaker', 'person', '标记说话人'],
          ['note', 'notes', '加入笔记'],
          ['highlight', 'bookmark', '重点'],
          ['profile', 'waveform', '添加到声纹库'],
        ]
          .map(
            ([action, icon, label]) =>
              `<button type="button" data-segment-tool="${action}" data-tooltip="${escapeHtml(t(label))}" aria-label="${escapeHtml(t(label))}"${action === 'speaker' ? ' aria-haspopup="dialog"' : ''}>${interfaceIcon(icon)}</button>`,
          )
          .join(
            '',
          )}<button class="segment-actions" data-segment-actions type="button" data-tooltip="${escapeHtml(t('更多'))}" aria-label="${escapeHtml(t('更多'))}" aria-haspopup="menu">${interfaceIcon('more')}</button></div>`
      : '';
  return `<article class="segment"${contextSegmentId ? ` data-segment-id="${escapeHtml(contextSegmentId)}"` : ''}${timing}><div class="segment-meta"><time>${escapeHtml(time)}</time>${showSpeaker && speaker.name ? `<span class="speaker-avatar" aria-hidden="true">${escapeHtml([...speaker.name][0])}</span>` : ''}${label}${overlap}${signalBadge}</div>${copy}${tools}</article>`;
}
/** 渲染会议库中的一行。@param {{tone: string, title: string, meta: string, tags: string[], status: object}} meeting 会议数据。@param {number} index 会议索引。@returns {string} 行标记。 */
function renderMeetingRow(
  { id, tone, title, meta, tags, status, statusCode, deleted = false, workspaceId, workspace },
  index,
) {
  const workspaceMenu =
    !deleted && typeof showWorkspaceAssignMenu === 'function'
      ? `<button data-meeting-action="workspace" data-meeting-index="${index}">${interfaceIcon('folder')}<span>${t('移至工作区')}</span>${interfaceIcon('chevron-right')}</button>`
      : '';
  const menu = deleted
    ? `<button data-meeting-action="restore" data-meeting-index="${index}">${interfaceIcon('restore')}<span>${t('恢复')}</span></button><button class="meeting-menu-danger" data-meeting-action="purge" data-meeting-index="${index}">${interfaceIcon('trash')}<span>${BreviaI18n.trashCopy(locale).purge}</span></button>`
    : `<button data-meeting-action="rename" data-meeting-index="${index}">${interfaceIcon('edit')}<span>${t('重命名')}</span></button>${workspaceMenu}<button data-meeting-action="open-folder" data-meeting-index="${index}">${interfaceIcon('folder')}<span>${t('从文件夹打开')}</span></button><button data-meeting-action="export" data-meeting-index="${index}">${interfaceIcon('upload')}<span>${t('导出')}</span></button>${status?.tone === 'processing' ? '' : `<button class="meeting-menu-danger" data-meeting-action="delete" data-meeting-index="${index}">${interfaceIcon('trash')}<span>${t('删除')}</span></button>`}`;
  const draft =
    typeof meetingRenameDraft !== 'undefined' && meetingRenameDraft?.key === (id || String(index))
      ? meetingRenameDraft
      : null;
  const heading =
    editingMeetingIndex === index
      ? `<form class="meeting-title-rename" data-rename-meeting data-meeting-index="${index}"><div class="meeting-rename-controls"><input name="title" value="${escapeHtml(draft?.title ?? title)}" maxlength="120" required aria-label="${t('重命名')}"${draft?.saving ? ' disabled' : ''} /><button type="submit" class="secondary"${draft?.saving ? ' disabled' : ''}>${interfaceIcon('checkbox-checked')}${t('保存')}</button><button type="button" class="secondary" data-cancel-meeting-rename${draft?.saving ? ' disabled' : ''}>${interfaceIcon('close')}${t('取消')}</button></div><small>${escapeHtml(t('Enter 保存 · Esc 取消'))}</small><p class="meeting-rename-meta">${escapeHtml(meta)}</p><span class="meeting-rename-state" role="status">${escapeHtml(t(draft?.saving ? '正在保存…' : draft?.error ? '重命名失败，修改仍保留' : draft?.title !== title ? '已修改 · 尚未保存' : '未修改'))}${draft?.error ? ` · ${escapeHtml(draft.error)}` : ''}</span></form>`
      : `<h2>${escapeHtml(title)}${tags.includes('手机录音') ? `<span class="meeting-source">${interfaceIcon('phone')}${escapeHtml(t(tags.includes('手机麦克风') ? '手机麦克风' : '手机录音'))}</span>` : ''}</h2>`;
  const workspaceLabel = workspace
    ? `${escapeHtml(t('工作区'))} · ${escapeHtml(workspace.name)}`
    : '';
  return `<article class="meeting-row" data-meeting-index="${index}" data-selection-key="${escapeHtml(id || String(index))}" tabindex="0" aria-selected="false"${id ? ` data-meeting-id="${escapeHtml(id)}"` : ''}${!deleted && id ? ' draggable="true"' : ''}><input class="meeting-row-checkbox" type="checkbox" data-select-meeting aria-label="${escapeHtml(t('选择'))} ${escapeHtml(title)}" /><span class="meeting-row-icon">${interfaceIcon('file')}</span><div class="meeting-main">${heading}${editingMeetingIndex === index ? '' : `<p>${escapeHtml(meta)}</p>`}</div><span class="meeting-workspace">${workspaceLabel}</span><div class="meeting-status"><span class="status ${status.tone}${status.paused ? ' is-paused' : ''}${statusCode === 'recording' ? ' is-recording' : ''}">${escapeHtml(t(status.label))}</span><small>${escapeHtml(t(status.detail))}</small></div><div class="meeting-actions"><button class="more" data-meeting-menu="${index}" aria-label="${t('更多操作')}" aria-expanded="false">${interfaceIcon('chevron-right')}</button><div class="meeting-menu" hidden>${menu}</div></div></article>`;
}
/** 渲染设置卡片及其模态框操作。@param {{title: string, description: string, action: string, modal: string}} card 卡片数据。@returns {string} 卡片标记。 */
function renderSettingsCard({ title, description, action, modal }) {
  return `<section class="settings-card" id="${modal}">${interfaceIcon({ 'ai-features': 'ai', 'advanced-settings': 'advanced', 'storage': 'storage' }[modal])}<h2>${t(title)}</h2><p>${t(description)}</p><button class="secondary settings-row-action" data-settings-modal="${modal}" aria-label="${escapeHtml(t(action))}">${interfaceIcon('chevron-right')}</button></section>`;
}
/** 渲染语言相关的设置卡片，不重置其他视图。 */
function renderSettingsView() {
  const settingsView = document.getElementById('settings-view');
  settingsView.querySelector('.settings-navigation')?.remove();
  settingsView.insertAdjacentHTML('afterbegin', renderSettingsNavigation('general'));
  const mobileCard = document.getElementById('mobile-connection');
  const speakerCard = document.getElementById('speaker-profiles-entry');
  const aboutCard = document.getElementById('app-update-entry');
  document.querySelector('#settings-view .settings-grid').innerHTML =
    `<h2 class="settings-group">${escapeHtml(t('会议与 AI'))}</h2><section class="settings-card" id="installed-models">${interfaceIcon('model')}<h2>${t('模型库')}</h2><p>${t('下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。')}</p><button class="secondary settings-row-action" data-settings-modal="models" aria-label="${escapeHtml(t('管理模型库'))}">${interfaceIcon('chevron-right')}</button></section>${uiData.settings.cards
      .filter((card) => card.modal !== 'storage')
      .map(renderSettingsCard)
      .join(
        '',
      )}<h2 class="settings-group">${escapeHtml(t('设备与数据'))}</h2>${uiData.settings.cards
      .filter((card) => card.modal === 'storage')
      .map(renderSettingsCard)
      .join('')}`;
  if (mobileCard) document.getElementById('storage').before(mobileCard);
  if (speakerCard) document.getElementById('storage').before(speakerCard);
  if (speakerCard && mobileCard) mobileCard.before(speakerCard);
  if (aboutCard) document.querySelector('#settings-view .settings-grid').append(aboutCard);
  const grid = document.querySelector('#settings-view .settings-grid');
  grid.insertAdjacentHTML(
    'afterbegin',
    `<h2 class="settings-group settings-basic-group">${escapeHtml(t('基本'))}</h2><section class="settings-card settings-preferences">${interfaceIcon('globe')}<h2>${escapeHtml(t('界面语言'))}</h2><p>${escapeHtml(t('切换语言'))}</p>${flowSelect(
      'interface-language',
      locale,
      [
        ['zh', '简体中文'],
        ['en', 'English'],
        ['es', 'Español'],
        ['ja', '日本語'],
        ['ko', '한국어'],
        ['fr', 'Français'],
        ['de', 'Deutsch'],
        ['ru', 'Русский'],
      ],
    )}</section><section class="settings-card settings-preferences">${interfaceIcon('appearance')}<h2>${escapeHtml(t('外观'))}</h2><p>${escapeHtml(t('切换主题'))}</p>${flowSelect(
      'interface-theme',
      typeof theme !== 'undefined' ? theme : 'system',
      [
        ['system', t('跟随系统')],
        ['light', t('浅色')],
        ['dark', t('深色')],
      ],
    )}</section>`,
  );
  renderDesktopPreferences();
}
function renderDesktopPreferences() {
  document.querySelector('[data-desktop-settings]')?.remove();
  if (!desktopPreferences || !window.brevia?.desktop) return;
  const status = document.querySelector('[data-desktop-settings-status]');
  if (status) status.innerHTML = renderSaveState('saved');
  const tray = t(window.brevia.platform === 'darwin' ? '菜单栏' : '托盘');
  const row = (label, description, control) =>
    `<section class="settings-card settings-preferences desktop-preference">${interfaceIcon({ 关闭主窗口时: 'window', 菜单栏图标: 'more', 托盘图标: 'more', 最小化时自动显示胶囊: 'capsule' }[label])}<div><h2>${escapeHtml(t(label))}</h2><p>${escapeHtml(description)}</p></div>${control}</section>`;
  const toggle = (key, label) =>
    `<button type="button" class="preference-switch" data-desktop-toggle="${key}" role="switch" aria-checked="${desktopPreferences[key]}" aria-label="${escapeHtml(t(label))}"><i></i></button>`;
  const content = `<div data-desktop-settings><h2 class="settings-group">${escapeHtml(t('窗口与后台'))}</h2>${row(
    '关闭主窗口时',
    desktopPreferences.closeBehavior === 'hide'
      ? t('关闭窗口不会结束录音，可从菜单栏或托盘重新打开')
      : t('录音中退出前会结束并保存当前录音'),
    flowSelect('desktop-closeBehavior', desktopPreferences.closeBehavior, [
      ['hide', `${t('隐藏到')}${tray}`],
      ['quit', t('退出应用')],
    ]),
  )}${row(
    window.brevia.platform === 'darwin' ? '菜单栏图标' : '托盘图标',
    t('隐藏窗口时始终保留入口'),
    flowSelect('desktop-trayVisibility', desktopPreferences.trayVisibility, [
      ['always', t('始终显示')],
      ['background', t('仅窗口隐藏时')],
    ]),
  )}<h2 class="settings-group">${escapeHtml(t('桌面录音胶囊'))}</h2>${row('最小化时自动显示胶囊', t('录音或暂停时显示；隐藏胶囊不会停止录音'), toggle('autoCapsule', '最小化时自动显示胶囊'))}</div>`;
  const grid = document.querySelector('#settings-view .settings-grid');
  grid.querySelector('.settings-preferences:last-of-type')?.insertAdjacentHTML('afterend', content);
  if (!grid.querySelector('[data-desktop-settings]')) grid.insertAdjacentHTML('beforeend', content);
}
/** 仅允许安全协议的链接/图片地址，阻止 javascript: 等注入。@param {string} url 原始地址。@returns {string} 安全地址。 */
function sanitizeUrl(url = '') {
  return /^(https?:|mailto:|data:image\/|brevia-note:\/\/)/i.test(url.trim()) ? url.trim() : '#';
}
/** 时间锚点沿用笔记 Markdown，导出后仍能读到时间与原文。 */
function noteHighlightMarkdown(startMs, text) {
  if (!Number.isSafeInteger(startMs) || startMs < 0 || !String(text || '').trim()) return '';
  return `> [${formatMeetingTime(startMs)}](#brevia-highlight-${startMs}) ${String(text)
    .replace(/[\r\n]+/g, ' ')
    .trim()}`;
}
function renderNoteHighlight(startMs, text) {
  const time = formatMeetingTime(startMs);
  return `<div class="note-highlight" data-note-highlight="${startMs}" contenteditable="false"><div class="note-highlight-line">${interfaceIcon('bookmark')}<button type="button" data-note-seek="${startMs}" data-tooltip="${escapeHtml(t('跳转到 {time}').replace('{time}', time))}" aria-label="${escapeHtml(t('跳转到 {time}').replace('{time}', time))}">${time}</button><span class="note-highlight-preview">${escapeHtml(text)}</span><button type="button" data-note-highlight-toggle aria-expanded="false" data-tooltip="${escapeHtml(t('展开'))}" aria-label="${escapeHtml(t('展开'))}">${interfaceIcon('chevron-down')}</button></div><p class="note-highlight-body" hidden>${escapeHtml(text)}</p></div>`;
}
/** 把富文本编辑器的 DOM 子树转换为 Markdown（支持粗体/斜体/代码/链接/图片/标题/列表/引用/表格）。@param {Node} root 根节点。@returns {string} Markdown 文本。 */
function htmlToMarkdown(root) {
  const lines = [];
  const inlineNodes = (children) => {
    let out = '';
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.matches?.('[data-note-highlight]')) {
        out += `\n\n${noteHighlightMarkdown(Number(child.dataset.noteHighlight), child.querySelector('.note-highlight-body')?.textContent)}\n\n`;
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        out += '\n';
        continue;
      }
      if (tag === 'ul' || tag === 'ol') continue;
      const inner = inlineNodes(child.childNodes);
      if (tag === 'b' || tag === 'strong') out += `**${inner}**`;
      else if (tag === 'i' || tag === 'em') out += `*${inner}*`;
      else if (tag === 'code') out += `\`${inner}\``;
      else if (tag === 'a') out += `[${inner}](${child.getAttribute('href') || ''})`;
      else if (tag === 'img')
        out += `![${child.getAttribute('alt') || ''}](${child.getAttribute('src') || ''})`;
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
        lines.push(
          `${'  '.repeat(depth)}${node.tagName.toLowerCase() === 'ol' ? `${index}.` : '-'} ${inlineNodes(child.childNodes)}`,
        );
        [...child.children]
          .filter((nested) => /^(ul|ol)$/i.test(nested.tagName))
          .forEach((nested) => list(nested, depth + 1));
        index += 1;
      } else if (tag === 'ul' || tag === 'ol') {
        // Chromium 在 Tab 缩进时会把嵌套列表放在前一个 <li> 的同级。
        list(child, depth + 1);
      }
    }
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent.trim()) lines.push(child.textContent);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (child.matches?.('[data-note-highlight]')) {
        lines.push(
          noteHighlightMarkdown(
            Number(child.dataset.noteHighlight),
            child.querySelector('.note-highlight-body')?.textContent,
          ),
          '',
        );
      } else if (tag === 'p' || tag === 'div') {
        lines.push(inline(child));
        lines.push('');
      } else if (/^h[1-3]$/.test(tag)) {
        lines.push(`${'#'.repeat(Number(tag[1]))} ${inline(child)}`);
        lines.push('');
      } else if (tag === 'ul' || tag === 'ol') {
        list(child);
        lines.push('');
      } else if (tag === 'blockquote') {
        lines.push(`> ${inline(child)}`);
        lines.push('');
      } else if (tag === 'hr') {
        lines.push('---');
        lines.push('');
      } else if (tag === 'table') {
        const rows = [...child.rows].map((row) =>
          [...row.cells].map((cell) => inline(cell).replace(/\|/g, ' ').trim()),
        );
        if (rows.length) {
          lines.push(`| ${rows[0].join(' | ')} |`);
          lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
          rows.slice(1).forEach((row) => lines.push(`| ${row.join(' | ')} |`));
          lines.push('');
        }
      } else lines.push(inline(child));
    }
  };
  walk(root);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/** 用 <code> 包裹编辑器中当前选区；无选区时插入占位代码片段。@param {HTMLElement} editor contenteditable 区域。@returns {void} */
function wrapInlineCode(editor) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const text = range.toString();
  if (!text) {
    document.execCommand('insertText', false, '`代码`');
    return;
  }
  const code = document.createElement('code');
  code.textContent = text;
  range.deleteContents();
  range.insertNode(code);
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}
/** 笔记表格允许的行列上限，以及「插入表格」选择器的网格尺寸。 */
const NOTE_TABLE_LIMITS = { columns: 20, rows: 50, gridColumns: 10, gridRows: 8 };
/** 把任意来源的行列数收敛到合法区间，非法输入按 1 处理。@param {*} value 目标行列数。@param {number} max 该维度的上限。@returns {number} 合法行列数。 */
function clampTableSize(value, max) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(1, number)) : 1;
}
/** 第 N 列的表头占位文案（8 语种模板）。@param {number} index 从 1 开始的列序号。@returns {string} 本地化表头。 */
function tableColumnLabel(index) {
  return t('列 {n}').replace('{n}', String(index));
}
/** 生成富文本编辑器插入的表格标记。@param {{columns: number, rows: number}} size 列数与总行数（含表头行）。@returns {string} 表格标记，末尾补一个空段落便于继续输入。 */
function noteTableHtml({ columns, rows }) {
  const cols = clampTableSize(columns, NOTE_TABLE_LIMITS.columns);
  const total = clampTableSize(rows, NOTE_TABLE_LIMITS.rows);
  const head = Array.from(
    { length: cols },
    (_, index) => `<th>${escapeHtml(tableColumnLabel(index + 1))}</th>`,
  ).join('');
  const body = Array.from(
    { length: total - 1 },
    () =>
      `<tr>${Array.from({ length: cols }, () => `<td>${escapeHtml(t('内容'))}</td>`).join('')}</tr>`,
  ).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p><br></p>`;
}
/** 生成 Markdown 模式的表格文本。@param {{columns: number, rows: number}} size 列数与总行数（含表头行）。@returns {string} Markdown 表格。 */
function noteTableMarkdown({ columns, rows }) {
  const cols = clampTableSize(columns, NOTE_TABLE_LIMITS.columns);
  const total = clampTableSize(rows, NOTE_TABLE_LIMITS.rows);
  const head = Array.from({ length: cols }, (_, index) => tableColumnLabel(index + 1));
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(head),
    line(head.map(() => '---')),
    ...Array.from({ length: total - 1 }, () => line(Array.from({ length: cols }, () => t('内容')))),
  ].join('\n');
}
/** 选区所在的块级元素，用于判断引用、标题等块格式的开关状态。@param {HTMLElement} editor contenteditable 区域。@returns {HTMLElement|null} 块级元素。 */
function selectionBlock(editor) {
  const anchor = window.getSelection()?.anchorNode;
  const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
  if (!element || !editor.contains(element)) return null;
  return element.closest('p, li, h1, h2, h3, blockquote') || null;
}
/** 当前选区生效的块格式命令，用于把工具栏按钮标记为按下状态。@param {HTMLElement} editor contenteditable 区域。@returns {string|null} 命令名。 */
function activeBlockCommand(editor) {
  const block = selectionBlock(editor);
  if (!block) return null;
  if (block.closest('blockquote')) return 'quote';
  const tag = block.tagName.toLowerCase();
  if (/^h[1-3]$/.test(tag)) return tag;
  const list = block.closest('ul, ol');
  return list ? list.tagName.toLowerCase() : null;
}
/** 把块元素换成另一种标签，保留内部内容。@param {HTMLElement} block 原块元素。@param {string} tagName 目标标签。@returns {HTMLElement} 新块元素。 */
function retagBlock(block, tagName) {
  const replacement = document.createElement(tagName);
  while (block.firstChild) replacement.append(block.firstChild);
  if (!replacement.firstChild) replacement.append(document.createElement('br'));
  block.replaceWith(replacement);
  return replacement;
}
/** 退出引用块：把引用内容还原成普通段落，拆开引用里的块级子元素，空引用不会留下空壳。@param {HTMLElement} quote 要退出的 blockquote。@returns {HTMLElement} 还原后的块元素。 */
function unwrapBlockquote(quote) {
  const blocks = [...quote.children].filter((child) =>
    /^(p|div|h[1-6]|ul|ol|blockquote)$/.test(child.tagName.toLowerCase()),
  );
  if (blocks.length) {
    quote.replaceWith(...blocks);
    return blocks[0];
  }
  return retagBlock(quote, 'p');
}
/** 把光标放到元素末尾，让退出引用/标题后可以继续输入。@param {HTMLElement} element 目标元素。@returns {void} */
function placeCaretAtEnd(element) {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
/** 创建所见即所得 Markdown 笔记编辑器（富文本默认，可切 Markdown 源码），live 视图与详情页共用。
 * @param {HTMLElement} root 容器，编辑器 DOM 将追加到其中。
 * @param {{onInput?: Function, ariaLabel?: string, getMeetingId?: Function}} options 输入回调、编辑器标签与图片归属会议。
 * @returns {{setMarkdown: Function, getMarkdown: Function, setMode: Function, focus: Function, destroy: Function}} 编辑器 API。 */
function createNotesEditor(root, options = {}) {
  const listeners = new AbortController();
  const {
    onInput = null,
    ariaLabel = t('我的笔记'),
    getMeetingId = () => null,
    getHighlightTime = null,
  } = options;
  const toolbarButtons = [
    ['bold', '加粗', '<b>B</b>'],
    ['italic', '斜体', '<i>I</i>'],
    ['h1', '标题 1', 'H1'],
    ['h2', '标题 2', 'H2'],
    ['h3', '标题 3', 'H3'],
    [
      'ul',
      '列表',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M7 4h6M7 8h6M7 12h6"/></svg>',
    ],
    [
      'ol',
      '编号列表',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="1.5" y="5" font-size="6.5" fill="currentColor" stroke="none">1</text><text x="1.5" y="9.5" font-size="6.5" fill="currentColor" stroke="none">2</text><text x="1.5" y="14" font-size="6.5" fill="currentColor" stroke="none">3</text><path d="M7 4h6M7 8.5h6M7 13h6"/></svg>',
    ],
    ['quote', '引用', '❝'],
    [
      'link',
      '插入链接',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6.2 9.8 3.6-3.6" /><path d="M7.2 11.4 5.6 13a2.6 2.6 0 0 1-3.6-3.6l1.6-1.6a2.6 2.6 0 0 1 3.6 0" /><path d="M8.8 4.6l1.6-1.6a2.6 2.6 0 0 1 3.6 3.6l-1.6 1.6a2.6 2.6 0 0 1-3.6 0" /></svg>',
    ],
    [
      'image',
      '插入图片',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><circle cx="5.5" cy="6.2" r="1.4" /><path d="m1.5 11 3.6-3.6L11 12.8" /></svg>',
    ],
    [
      'table',
      '插入表格',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="2" y="2" width="12" height="12"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/></svg>',
    ],
    ['code', '行内代码', '&lt;/&gt;'],
    ['todo', '待办', interfaceIcon('checkbox')],
    ['highlight', '重点', interfaceIcon('bookmark')],
    [
      'mode-toggle',
      '富文本',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3h9M8 3v10"/></svg>',
    ],
  ];
  const toolbar = document.createElement('div');
  toolbar.className = 'notes-toolbar';
  toolbar.innerHTML = toolbarButtons
    .map(
      ([command, key, html]) =>
        `<button type="button" data-notes-command="${command}" data-tooltip-key="${key}" data-tooltip="${t(key)}" aria-label="${t(key)}">${html}</button>`,
    )
    .join('');
  const urlPop = document.createElement('div');
  urlPop.className = 'notes-url-pop';
  urlPop.hidden = true;
  urlPop.innerHTML = `<input type="text" placeholder="https://…" spellcheck="false" /><button class="notes-url-ok" data-notes-url-ok type="button">${t('确定')}</button><button class="text-button" data-notes-url-cancel type="button">${t('取消')}</button>`;
  const findPop = document.createElement('div');
  findPop.className = 'notes-find-pop';
  findPop.hidden = true;
  findPop.innerHTML = `<input data-notes-find placeholder="${t('查找')}" /><input data-notes-replace placeholder="${t('替换为')}" /><button type="button" data-notes-find-prev aria-label="${t('上一个')}">${interfaceIcon('arrow-up')}</button><button type="button" data-notes-find-next aria-label="${t('下一个')}">${interfaceIcon('arrow-down')}</button><button type="button" data-notes-replace-all>${t('全部替换')}</button><button type="button" data-notes-find-close aria-label="${t('关闭')}">${interfaceIcon('close')}</button>`;
  const tablePop = document.createElement('div');
  tablePop.className = 'notes-table-pop';
  tablePop.hidden = true;
  const tableGrid = Array.from(
    { length: NOTE_TABLE_LIMITS.gridRows },
    (_, row) =>
      `<div class="notes-table-row">${Array.from({ length: NOTE_TABLE_LIMITS.gridColumns }, (_, column) => `<button type="button" data-notes-table-cell="${column + 1}:${row + 1}" aria-label="${column + 1} × ${row + 1}"></button>`).join('')}</div>`,
  ).join('');
  tablePop.innerHTML = `<div class="notes-table-grid" role="group" aria-label="${t('选择行列数')}">${tableGrid}</div><p class="notes-table-size" data-notes-table-size></p><div class="notes-table-fields"><label>${t('行数')}<input type="number" inputmode="numeric" min="1" max="${NOTE_TABLE_LIMITS.rows}" value="2" data-notes-table-rows /></label><label>${t('列数')}<input type="number" inputmode="numeric" min="1" max="${NOTE_TABLE_LIMITS.columns}" value="2" data-notes-table-columns /></label><button type="button" data-notes-table-insert>${t('插入')}</button></div>`;
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
  root.append(
    toolbar,
    urlPop,
    findPop,
    tablePop,
    ...(suggestion ? [suggestion] : []),
    editor,
    input,
    imageInput,
  );
  // 回车产生 <p>，让富文本编辑器的 DOM 结构规范、便于转回 Markdown。
  document.execCommand('defaultParagraphSeparator', false, 'p');
  let urlTarget = null;
  let mode = 'rich';
  let findMatchIndex = -1;
  let tableSize = { columns: 2, rows: 2 };
  let savedRange = null;
  const urlInput = urlPop.querySelector('input');
  const findInput = findPop.querySelector('[data-notes-find]');
  const replaceInput = findPop.querySelector('[data-notes-replace]');
  const tableSizeLabel = tablePop.querySelector('[data-notes-table-size]');
  const tableRowsInput = tablePop.querySelector('[data-notes-table-rows]');
  const tableColumnsInput = tablePop.querySelector('[data-notes-table-columns]');
  function insertText(text) {
    if (mode === 'markdown') {
      const start = input.selectionStart ?? input.value.length;
      input.value =
        input.value.slice(0, start) + text + input.value.slice(input.selectionEnd ?? start);
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
  }
  function closeUrlPop() {
    urlPop.hidden = true;
    urlTarget = null;
  }
  function openFind() {
    findPop.hidden = false;
  }
  /** 把选择器里的行列数同步到网格高亮、计数文案与输入框。@param {{columns: *, rows: *}} next 目标行列数。@param {boolean} syncFields 是否回写数字输入框（用户正在输入时保持原样）。@returns {void} */
  function applyTableSize(next, syncFields = true) {
    tableSize = {
      columns: clampTableSize(next.columns, NOTE_TABLE_LIMITS.columns),
      rows: clampTableSize(next.rows, NOTE_TABLE_LIMITS.rows),
    };
    if (syncFields) {
      tableColumnsInput.value = String(tableSize.columns);
      tableRowsInput.value = String(tableSize.rows);
    }
    tableSizeLabel.textContent = `${tableSize.columns} × ${tableSize.rows}`;
    tablePop.querySelectorAll('[data-notes-table-cell]').forEach((cell) => {
      const [column, row] = cell.dataset.notesTableCell.split(':').map(Number);
      cell.classList.toggle('is-on', column <= tableSize.columns && row <= tableSize.rows);
    });
  }
  // 打开选择器时记住光标位置：点数字输入框会让编辑器失焦，插入前需要还原。
  function openTablePop(anchor) {
    const selection = window.getSelection();
    savedRange =
      selection?.rangeCount && editor.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    applyTableSize({ columns: 2, rows: 2 });
    tablePop.hidden = false;
    const rect = anchor.getBoundingClientRect();
    tablePop.style.position = 'fixed';
    tablePop.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - tablePop.offsetHeight - 12))}px`;
    tablePop.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - tablePop.offsetWidth - 12))}px`;
  }
  function closeTablePop() {
    tablePop.hidden = true;
  }
  /** 按当前行列数插入表格（富文本插入 HTML，Markdown 模式插入源码），随后关闭选择器。@param {{columns: *, rows: *}} size 目标行列数。@returns {void} */
  function insertTable(size) {
    closeTablePop();
    if (mode === 'markdown') {
      insertText(`${noteTableMarkdown(size)}\n`);
      return;
    }
    if (savedRange && editor.contains(savedRange.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    editor.focus();
    document.execCommand('insertHTML', false, noteTableHtml(size));
    if (onInput) onInput();
  }
  function richMatches(query) {
    const nodes = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    const matches = [];
    for (const index of textMatchOffsets(text, query))
      matches.push({ start: index, end: index + query.length });
    return { nodes, matches };
  }
  function selectFindMatch(step = 1) {
    const query = findInput.value;
    if (!query) return;
    if (mode === 'markdown') {
      const haystack = input.value;
      const needle = query;
      const startFrom =
        step > 0
          ? input.selectionEnd || 0
          : Math.max(0, (input.selectionStart || input.value.length) - 1);
      let index =
        step > 0 ? haystack.indexOf(needle, startFrom) : haystack.lastIndexOf(needle, startFrom);
      if (index < 0) index = step > 0 ? haystack.indexOf(needle) : haystack.lastIndexOf(needle);
      if (index >= 0) {
        input.focus();
        input.setSelectionRange(index, index + query.length);
      }
      return;
    }
    const { nodes, matches } = richMatches(query);
    if (!matches.length) return;
    findMatchIndex = (findMatchIndex + step + matches.length) % matches.length;
    const match = matches[findMatchIndex];
    const locate = (position) =>
      nodes.find(
        (item) => position >= item.start && position <= item.start + item.node.textContent.length,
      );
    const start = locate(match.start);
    const end = locate(match.end);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start.node, match.start - start.start);
    range.setEnd(end.node, match.end - end.start);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function replaceAll() {
    const query = findInput.value;
    if (!query) return;
    const source = mode === 'rich' ? htmlToMarkdown(editor) : input.value;
    const next = source.split(query).join(replaceInput.value);
    if (next === source) return;
    input.value = next;
    editor.innerHTML = renderMarkdown(next);
    findMatchIndex = -1;
    if (onInput) onInput({ programmatic: true });
  }
  /** 切换富文本 / Markdown 模式：工具栏始终可见，Markdown 模式下仅禁用依赖 execCommand 的格式按钮。 */
  function setMode(nextMode) {
    mode = nextMode === 'markdown' ? 'markdown' : 'rich';
    const richOnlyCommands = new Set([
      'bold',
      'italic',
      'h1',
      'h2',
      'h3',
      'ul',
      'ol',
      'quote',
      'code',
      'link',
    ]);
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
      // Markdown 源码模式没有块格式，清掉富文本遗留的高亮，只保留模式切换按钮。
      toolbar.querySelectorAll('[data-notes-command].is-active').forEach((button) => {
        if (button.dataset.notesCommand !== 'mode-toggle') button.classList.remove('is-active');
      });
      input.value = htmlToMarkdown(editor);
      editor.hidden = true;
      input.hidden = false;
      urlPop.hidden = true;
      tablePop.hidden = true;
    } else {
      editor.innerHTML = renderMarkdown(input.value);
      editor.hidden = false;
      input.hidden = true;
    }
  }
  /** 把当前选区的块格式标到工具栏上，让「引用」「标题」等开关状态可见（可再次点击关闭）。@returns {void} */
  function syncToolbarState() {
    if (!toolbar.isConnected) {
      document.removeEventListener('selectionchange', syncToolbarState);
      return;
    }
    const anchor = window.getSelection()?.anchorNode;
    if (!anchor || !editor.contains(anchor)) return;
    const block = mode === 'rich' ? activeBlockCommand(editor) : null;
    const pressed = (command) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };
    toolbar.querySelectorAll('[data-notes-command]').forEach((button) => {
      const command = button.dataset.notesCommand;
      if (command === 'mode-toggle') return;
      const active =
        command === 'bold' || command === 'italic'
          ? mode === 'rich' && pressed(command)
          : command === block;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-pressed', 'true');
      else button.removeAttribute('aria-pressed');
    });
  }
  document.addEventListener('selectionchange', syncToolbarState, { signal: listeners.signal });
  toolbar.addEventListener('mousedown', (event) => event.preventDefault());
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-notes-command]');
    if (!button) return;
    const command = button.dataset.notesCommand;
    if (command === 'mode-toggle') {
      setMode(mode === 'rich' ? 'markdown' : 'rich');
      return;
    }
    if (command === 'highlight' && getHighlightTime) {
      const selection = window.getSelection();
      const selected =
        mode === 'markdown'
          ? input.value.slice(input.selectionStart, input.selectionEnd)
          : selection?.rangeCount &&
              editor.contains(selection.getRangeAt(0).commonAncestorContainer)
            ? selection.toString()
            : '';
      const startMs = getHighlightTime();
      const markdown = noteHighlightMarkdown(startMs, selected);
      if (!markdown) {
        appActions.showToast(t('请先选择笔记内容'));
        return;
      }
      if (mode === 'markdown') insertText(`\n\n${markdown}\n\n`);
      else {
        const range = selection.getRangeAt(0).cloneRange();
        editor.focus();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand(
          'insertHTML',
          false,
          `${renderNoteHighlight(startMs, selected.replace(/[\r\n]+/g, ' ').trim())}<br>`,
        );
        onInput?.();
      }
      return;
    }
    editor.focus();
    if (command === 'bold') document.execCommand('bold');
    else if (command === 'italic') document.execCommand('italic');
    else if (command === 'h1' || command === 'h2' || command === 'h3') {
      // 再点一次同一个标题级别就退回正文，避免用户被标题格式困住。
      const block = selectionBlock(editor);
      if (block && block.tagName.toLowerCase() === command) {
        placeCaretAtEnd(retagBlock(block, 'p'));
        if (onInput) onInput();
      } else document.execCommand('formatBlock', false, command.toUpperCase());
    } else if (command === 'ul') document.execCommand('insertUnorderedList');
    else if (command === 'ol') document.execCommand('insertOrderedList');
    else if (command === 'quote') {
      // 引用是可切换的块格式：已在引用中时把它还原成普通段落。
      const quote = selectionBlock(editor)?.closest('blockquote');
      if (quote) {
        placeCaretAtEnd(unwrapBlockquote(quote));
        if (onInput) onInput();
      } else document.execCommand('formatBlock', false, 'BLOCKQUOTE');
    } else if (command === 'code') wrapInlineCode(editor);
    else if (command === 'table') openTablePop(button);
    else if (command === 'todo') insertText(mode === 'markdown' ? '- [ ] ' : '☐ ');
    else if (command === 'highlight') {
      const prefix = t('重点：');
      if (mode === 'markdown') insertText(`**${prefix}** `);
      else {
        document.execCommand('bold');
        document.execCommand('insertText', false, prefix);
        document.execCommand('bold');
        if (onInput) onInput();
      }
    } else if (command === 'link') openUrlPop(command, button);
    else if (command === 'image') imageInput.click();
    syncToolbarState();
  });
  imageInput.addEventListener('change', () => {
    const [file] = imageInput.files;
    imageInput.value = '';
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      appActions.showToast(t('图片必须是 PNG、JPEG、GIF 或 WebP，且不超过 10 MB。'));
      return;
    }
    const meetingId = getMeetingId();
    if (!meetingId || !window.brevia?.meeting?.noteImage?.save) return;
    file
      .arrayBuffer()
      .then((bytes) =>
        window.brevia.meeting.noteImage.save({
          meeting_id: meetingId,
          mime_type: file.type,
          bytes,
        }),
      )
      .then(({ url }) => {
        if (mode === 'markdown') insertText(`![](${url})`);
        else {
          editor.focus();
          document.execCommand('insertImage', false, url);
          if (onInput) onInput();
        }
      })
      .catch((error) => appActions.showToast(error.message, undefined, 'error'));
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
    if (event.key === 'Enter') {
      event.preventDefault();
      urlPop.querySelector('[data-notes-url-ok]').click();
    }
    if (event.key === 'Escape') closeUrlPop();
  });
  // 除数字输入框外不改焦点，否则富文本里的插入位置会在点选行列时丢失。
  tablePop.addEventListener('mousedown', (event) => {
    if (!event.target.closest('input')) event.preventDefault();
  });
  tablePop.addEventListener('mouseover', (event) => {
    const cell = event.target.closest('[data-notes-table-cell]');
    if (!cell) return;
    const [column, row] = cell.dataset.notesTableCell.split(':').map(Number);
    applyTableSize({ columns: column, rows: row });
  });
  tablePop.addEventListener('click', (event) => {
    const cell = event.target.closest('[data-notes-table-cell]');
    if (cell) {
      const [column, row] = cell.dataset.notesTableCell.split(':').map(Number);
      insertTable({ columns: column, rows: row });
      return;
    }
    if (event.target.closest('[data-notes-table-insert]')) insertTable(tableSize);
  });
  [tableRowsInput, tableColumnsInput].forEach((field) => {
    field.addEventListener('input', () =>
      applyTableSize({ columns: tableColumnsInput.value, rows: tableRowsInput.value }, false),
    );
    field.addEventListener('blur', () => applyTableSize(tableSize));
  });
  tablePop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.closest('input')) {
      event.preventDefault();
      insertTable(tableSize);
    }
    if (event.key === 'Escape') closeTablePop();
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
  findInput.addEventListener('input', () => {
    findMatchIndex = -1;
    selectFindMatch(1);
  });
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectFindMatch(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') findPop.hidden = true;
  });
  const closeFindOnOutsidePointer = (event) => {
    if (!findPop.hidden && !findPop.contains(event.target)) findPop.hidden = true;
  };
  document.addEventListener('pointerdown', closeFindOnOutsidePointer, { signal: listeners.signal });
  // 点击工具栏以外的任何位置都收起行列选择器，避免弹窗停留在编辑器上。
  const closeTablePopOnOutsidePointer = (event) => {
    if (!tablePop.hidden && !tablePop.contains(event.target) && !toolbar.contains(event.target))
      closeTablePop();
  };
  document.addEventListener('pointerdown', closeTablePopOnOutsidePointer, {
    signal: listeners.signal,
  });
  [editor, input].forEach((surface) =>
    surface.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openFind();
      }
      // 光标仍留在编辑器里时，Esc 也要能收起行列选择器。
      if (event.key === 'Escape' && !tablePop.hidden) {
        closeTablePop();
        return;
      }
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
      if (event.shiftKey)
        input.setRangeText(
          indent.slice(0, Math.max(0, indent.length - 2)),
          lineStart,
          lineStart + indent.length,
          'preserve',
        );
      else input.setRangeText('  ', lineStart, lineStart, 'preserve');
      if (onInput) onInput();
    }),
  );
  editor.addEventListener('input', () => {
    const anchor = window.getSelection()?.anchorNode;
    let block = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest(
      'p, li, h1, h2, h3, blockquote',
    );
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
  input.addEventListener('input', () => {
    if (onInput) onInput();
  });
  return {
    destroy() {
      listeners.abort();
    },
    setMarkdown(markdown) {
      const text = String(markdown || '');
      input.value = text;
      editor.innerHTML = renderMarkdown(text);
    },
    appendMarkdown(markdown) {
      const existing = this.getMarkdown();
      const next =
        existing && existing.trim()
          ? `${existing.replace(/\n+$/, '')}\n\n${markdown}`
          : String(markdown || '');
      this.setMarkdown(next);
      // 程序化写入（AI 落笔/插入字幕等）与用户打字区分开，调用方据此决定是否
      // 触发「正在输入」信号，避免 AI 刚写完自己就被当成用户在打字。
      if (onInput) onInput({ programmatic: true });
    },
    addHighlight(startMs, text) {
      const markdown = noteHighlightMarkdown(startMs, text);
      if (!markdown) return false;
      if (this.getMarkdown().split('\n').includes(markdown)) return false;
      if (mode === 'rich') {
        editor.insertAdjacentHTML(
          'beforeend',
          `${renderNoteHighlight(
            startMs,
            String(text)
              .replace(/[\r\n]+/g, ' ')
              .trim(),
          )}<p><br></p>`,
        );
        onInput?.({ programmatic: true });
      } else this.appendMarkdown(markdown);
      return true;
    },
    getMarkdown() {
      return mode === 'rich' ? htmlToMarkdown(editor) : input.value;
    },
    getMode() {
      return mode;
    },
    setMode,
    focus() {
      (mode === 'rich' ? editor : input).focus();
    },
  };
}
/** 渲染生成的会议纪要所使用的 Markdown 子集，已对模型输出进行转义。 */
function renderMarkdown(markdown) {
  const inline = (value) =>
    String(value)
      // 只解析原始文本，后续标记不能再次改写生成的 HTML 属性。
      .split(/(!?\[[^\]\n]*\]\([^)\n]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g)
      .map((part) => {
        const link = part.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
        if (link) {
          const url = escapeHtml(sanitizeUrl(link[3]));
          return link[1]
            ? `<img src="${url}" alt="${escapeHtml(link[2])}" />`
            : `<a href="${url}" target="_blank" rel="noopener">${inline(link[2])}</a>`;
        }
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`'))
          return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**'))
          return `<strong>${inline(part.slice(2, -2))}</strong>`;
        if (part.length > 2 && part.startsWith('*') && part.endsWith('*'))
          return `<em>${inline(part.slice(1, -1))}</em>`;
        return escapeHtml(part);
      })
      .join('');
  const lines = String(markdown || '')
    .replace(/\r/g, '')
    .split('\n');
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
      if (!item || item[1].length !== indent || /\d+\.$/.test(item[2]) !== ordered) break;
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
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const highlight = line.match(/^> \[[^\]\n]+\]\(#brevia-highlight-(\d+)\) (.+)$/);
    if (highlight && Number.isSafeInteger(Number(highlight[1]))) {
      html.push(renderNoteHighlight(Number(highlight[1]), highlight[2]));
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\|/.test(lines[index]))
        rows.push(
          lines[index++]
            .split('|')
            .slice(1, -1)
            .map((cell) => inline(cell.trim())),
        );
      const body = rows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
      if (body.length)
        html.push(
          `<table><thead><tr>${body[0].map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${body
            .slice(1)
            .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        );
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      html.push('<hr />');
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const items = [];
      while (index < lines.length && /^>\s?/.test(lines[index]))
        items.push(inline(lines[index++].replace(/^>\s?/, '')));
      html.push(`<blockquote>${items.join('<br />')}</blockquote>`);
      continue;
    }
    if (/^[-*]\s*\[[ xX]\]\s*/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s*\[[ xX]\]\s*/.test(lines[index])) {
        const task = lines[index++].match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
        items.push(
          `<li class="task-item"><span class="markdown-task-mark" role="checkbox" aria-checked="${task[1].toLowerCase() === 'x'}" aria-disabled="true">${task[1].toLowerCase() === 'x' ? interfaceIcon('check') : ''}</span><span class="markdown-task-text">${inline(task[2])}</span></li>`,
        );
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (listLine(line)) {
      const rendered = renderList(index);
      html.push(rendered.html);
      index = rendered.index;
      continue;
    }
    const paragraph = [lines[index++]];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3}\s+|\||[-*]\s*(?:\[[ xX]\]\s*|\s)|\d+\.\s+|>\s?)/.test(lines[index]) &&
      !/^(---|\*\*\*|___)\s*$/.test(lines[index])
    )
      paragraph.push(lines[index++]);
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
/** 保存提示只反映当前内容的写入结果，不把 AI 输出等同于人工核对。 */
function renderSaveState(state = 'saved') {
  const label = {
    saved: '已保存',
    dirty: '已修改 · 尚未保存',
    saving: '正在保存…',
    failed: '保存失败，修改仍保留',
  }[state];
  const mark = state === 'saved' ? interfaceIcon('check') : state === 'failed' ? '!' : '';
  return `<span class="save-state" data-save-state="${state}" role="status"><i class="save-state-mark" aria-hidden="true">${mark}</i>${escapeHtml(t(label || '已保存'))}</span>`;
}
function renderSummaryDocument(markdown) {
  const html = renderMarkdown(cleanSummaryMarkdown(markdown));
  const parts = html.split(/(<h[12]\b[^>]*>[\s\S]*?<\/h[12]>)/i);
  if (parts.length < 3) return html;
  let result = parts[0];
  for (let index = 1; index < parts.length; index += 2) {
    const title = parts[index];
    const content = parts[index + 1] || '';
    const label = title.replace(/<[^>]+>/g, '').trim();
    const discussion =
      /^(详细讨论|讨论记录|詳細な議論|詳細討論|상세 논의|Discussion|Detailed discussion|Discusión|Discussion détaillée|Detaillierte Diskussion|Подробное обсуждение)$/i.test(
        label,
      );
    result += discussion
      ? `<details class="summary-discussion"><summary>${title}<span>${escapeHtml(t('展开讨论记录'))}${interfaceIcon('chevron-down')}</span></summary><div>${content}</div></details>`
      : `<section class="summary-reading-section">${title}<div>${content}</div></section>`;
  }
  return result;
}
/** 纪要面板只渲染正文；操作与状态由三个标签共用的页头提供。 */
function renderMeetingSummary({
  markdown,
  waitingModels = false,
  generating = false,
  editing = false,
  participants = [],
}) {
  const people = participants.length
    ? `<section class="summary-participants"><button type="button" data-summary-participants-toggle aria-haspopup="dialog" aria-controls="summary-participants-popover" aria-expanded="false"><span class="summary-participant-count">${escapeHtml(t('参与者'))} (${participants.length})</span><span class="summary-participant-avatars">${participants
        .slice(0, 3)
        .map(
          (person) =>
            `<span class="summary-participant-preview-person"><i class="speaker-avatar" aria-hidden="true">${escapeHtml([...formatSpeakerName(person)][0] || '')}</i><span>${escapeHtml(formatSpeakerName(person))}</span></span>`,
        )
        .join(
          '',
        )}${participants.length > 3 ? `<small>+${participants.length - 3}</small>` : ''}</span>${interfaceIcon('chevron-down')}</button><div id="summary-participants-popover" class="meeting-popover summary-participants-popover" popover role="dialog" aria-label="${escapeHtml(t('参与者'))}"><header><h3>${escapeHtml(t('参与者'))} (${participants.length})</h3><button class="icon-button" data-close-meeting-popover type="button" aria-label="${escapeHtml(t('关闭'))}">${interfaceIcon('close')}</button></header><label class="search">${interfaceIcon('search')}<input type="search" data-participant-search aria-label="${escapeHtml(t('搜索'))}" placeholder="${escapeHtml(t('搜索'))}" /></label><div class="summary-participant-list">${participants.map((person) => `<span><i class="speaker-avatar" aria-hidden="true">${escapeHtml([...formatSpeakerName(person)][0] || '')}</i><span>${escapeHtml(formatSpeakerName(person))}</span></span>`).join('')}</div><p data-participant-empty role="status" hidden>${escapeHtml(t('暂无内容'))}</p></div></section>`
    : '';
  return `<div class="summary-preview"><div class="summary-feedback" data-summary-feedback hidden></div>${people}${editing ? `<div class="summary-inline-edit"><div data-inline-summary-editor></div></div>` : markdown ? `<div class="summary-body markdown-content">${renderSummaryDocument(markdown)}</div>` : waitingModels ? `<section class="summary-waiting"><span>${interfaceIcon('check')}${escapeHtml(t('录音已保存'))}</span><div>${interfaceIcon('document')}<h2>${escapeHtml(t('录音已保存'))}</h2><p>${escapeHtml(t('纪要等待所需模型，就绪后会自动继续。'))}</p><div><button class="secondary" data-settings-modal="models" type="button">${interfaceIcon('download')}${escapeHtml(t('模型库'))}</button><button class="secondary" data-detail-tab="transcript" type="button">${interfaceIcon('document')}${escapeHtml(t('逐字稿'))}</button></div></div></section>` : `<p class="summary-empty">${t(generating ? '正在生成会议纪要' : '尚未生成会议纪要')}</p>`}</div>`;
}
/** 在页面外壳可用后填充所有数据驱动的静态区域。@returns {void} */
function renderStaticViews() {
  document.querySelector('.meeting-list').innerHTML = uiData.meetings
    .map(renderMeetingRow)
    .join('');
  document.querySelector('#transcript-scroll').innerHTML = uiData.live.transcript
    .map((entry) => renderTranscriptSegment({ ...entry, showSpeaker: false }))
    .join('');
  renderSettingsView();
}
/** 渲染精修菜单里的「识别模型」行。
 *
 * 候选由调用方传入（app.js 用准备页同一个 `refinedModelOptions`：按 `refined_priority`
 * 排序、排除退役模型、过滤掉不支持当前语言的模型，未安装的带体积和下载字样）。
 * **这里只负责改选中项**，未安装的模型要到点「开始精修 / 重新精修」时才真正走下载队列。
 * 没有候选（模型清单还没加载完）时返回空串。
 * @param {Array<[string, string, string?]>} options 值/标签/角标三元组。@param {string} [selectedId] 当前选中的模型 id。
 * @returns {string} 标记。
 */
function renderRefineModelRow(options, selectedId) {
  if (!Array.isArray(options) || !options.length) return '';
  return `<label class="refine-menu-speakers" data-refine-model-row><span>${escapeHtml(t('识别模型'))}</span>${flowSelect('refine-model', selectedId, options)}</label>`;
}
/** 「已精修」标签里的模型名后缀，让人一眼看出当前稿子由哪个模型产出。@param {object} d 详情数据。@returns {string} 后缀标记。 */
function refineAppliedModelSuffix(d) {
  return d.refinedModelAppliedName ? ` · ${escapeHtml(d.refinedModelAppliedName)}` : '';
}
/** 逐字稿专属操作；精修状态统一放在导航行。 */
function renderRefineStatus(d) {
  if (d.refineState === 'refining') return '';
  const languageSelect = `<label class="refine-menu-speakers"><span>${t('会议语言')}</span>${flowSelect('refine-language', d.language || 'auto', BreviaI18n.languageOptions(locale, t, true))}</label>`;
  const translationMenu = `<span class="detail-translation-action"><button class="detail-icon-action" data-detail-translation-toggle type="button" aria-label="${t('翻译')}" title="${t('翻译')}" aria-expanded="false"${d.translationPending ? ' disabled' : ''}>${interfaceIcon('translate')}${t('翻译')}${interfaceIcon('chevron-down')}</button><div class="detail-translation-menu" hidden>${BreviaI18n.languageOptions(
    locale,
    t,
  )
    .slice(1)
    .map(
      ([code, name]) =>
        `<button type="button" data-detail-translation="${escapeHtml(code)}">${escapeHtml(name)}</button>`,
    )
    .join('')}</div></span>`;
  const refineMenu =
    typeof refinementBusyMeetingId !== 'undefined' && refinementBusyMeetingId
      ? `<span class="refine-state" role="status">${t('error.tasks.running')}</span>`
      : `<span class="refine-wrap"><button class="detail-icon-action" data-refine-more type="button" aria-label="${t('重新精修')}" title="${t('重新精修')}" aria-expanded="false">${interfaceIcon('refresh')}${t(d.hasRefined ? '重新精修' : '开始精修')}</button><div class="refine-menu" hidden>${languageSelect}${renderRefineModelRow(d.refinedModelOptions, d.refinedModelId)}<label class="refine-menu-speakers"><span>${t('会议人数')}</span><input type="number" min="1" step="1" inputmode="numeric" data-refine-num-speakers placeholder="${t('留空自动识别')}" /></label><button type="button" data-refine-action="${d.hasRefined ? 're-refine' : 'start'}">${d.hasRefined ? t('重新精修') : t('开始精修')}</button></div></span>`;
  return `${translationMenu}${refineMenu}`;
}
/** 三个标签共用导航、保存状态与操作栏，切换标签时只重建页头，不重建编辑器。 */
function renderDetailTabbar() {
  const d = uiData.detail;
  const scope = detailActiveTab;
  const summary = d.summary || {};
  const editing = Boolean(d[`${scope}Editing`]);
  const saveState = d[`${scope}SaveState`] || 'saved';
  const busy = saveState === 'saving';
  let actions = '',
    context = '',
    status = '';
  if (scope === 'notes') {
    status = `<span data-notes-save-status>${renderSaveState(saveState)}</span>`;
    actions = editing
      ? `<button class="tabbar-action" data-notes-cancel type="button"${busy ? ' disabled' : ''} aria-label="${t('取消')}">${interfaceIcon('close')}${t('取消')}</button><button class="tabbar-action is-save" data-notes-save type="button"${busy ? ' disabled' : ''} aria-label="${t(saveState === 'failed' ? '重试' : '保存')}">${interfaceIcon('check')}${t(saveState === 'failed' ? '重试' : '保存')}</button>`
      : `<button class="tabbar-action" data-edit-notes type="button" aria-label="${t('编辑')}">${interfaceIcon('edit')}${t('编辑')}</button>`;
  } else if (scope === 'summary') {
    status = `<span data-summary-save-status>${summary.waitingModels ? `<span class="refine-state">${escapeHtml(t('等待模型'))}</span>` : summary.generating ? `<span class="refine-state" role="status">${t('正在生成会议纪要')}</span>` : summary.markdown || editing ? renderSaveState(saveState) : ''}</span>`;
    const blocked = summary.blocked
      ? ` title="${escapeHtml(t('实时会议中，结束后再生成会议纪要。'))}"`
      : '';
    const disabled = summary.blocked || summary.generating ? ' disabled' : '';
    const generationIcon = summary.generating
      ? `<span class="summary-generating-icon" aria-hidden="true">${interfaceIcon('ai')}</span>`
      : interfaceIcon(summary.markdown ? 'refresh' : 'ai');
    actions = editing
      ? `<button class="tabbar-action" data-cancel-inline-summary-edit type="button"${busy ? ' disabled' : ''} aria-label="${t('取消')}">${interfaceIcon('close')}${t('取消')}</button><button class="tabbar-action is-save" data-save-inline-summary type="button"${busy ? ' disabled' : ''} aria-label="${t(saveState === 'failed' ? '重试' : '保存')}">${interfaceIcon('check')}${t(saveState === 'failed' ? '重试' : '保存')}</button>`
      : `<button class="tabbar-action" data-open-summary-edit type="button"${!summary.markdown || summary.generating ? ' disabled' : ''} aria-label="${t('编辑')}">${interfaceIcon('edit')}${t('编辑')}</button>`;
    if (!editing)
      context = `${summary.markdown ? `<button class="tabbar-action" data-copy-summary type="button" aria-label="${t('复制会议纪要')}">${interfaceIcon('copy')}${t('复制')}</button>` : ''}<button class="tabbar-action" ${summary.markdown ? 'data-regenerate-summary' : 'data-generate-summary'} type="button"${disabled}${blocked}${summary.generating ? ' aria-busy="true"' : ''}>${generationIcon}${t(summary.generating ? '正在生成会议纪要' : summary.markdown ? '重新生成' : '生成纪要')}</button>`;
  } else {
    status = editing
      ? `<span class="save-state" data-transcript-save-status role="status">${escapeHtml(t({ unchanged: '未修改', dirty: '已修改 · 尚未保存', saving: '正在保存…', failed: '保存失败，修改仍保留', saved: '已保存' }[saveState] || '未修改'))}</span>`
      : d.refineState === 'refining'
        ? `<span class="refine-state" role="status">${t('正在精修')}</span>`
        : d.hasRefined
          ? `<span class="refine-state is-done" role="status" title="${escapeHtml(t('已精修'))}${refineAppliedModelSuffix(d)}">${t('已精修')}${refineAppliedModelSuffix(d)}</span>`
          : '';
    if (editing)
      actions = `<button class="tabbar-action" data-transcript-cancel type="button"${busy ? ' disabled' : ''} aria-label="${t('取消')}">${interfaceIcon('close')}${t('取消')}</button><button class="tabbar-action is-save" data-transcript-save type="button"${busy ? ' disabled' : ''} aria-label="${t(saveState === 'failed' ? '重试' : '保存')}">${interfaceIcon('check')}${t(saveState === 'failed' ? '重试' : '保存')}</button>`;
    // 精修重建段落时保持只读，历史原始稿和无时间戳全文沿用既有编辑边界。
    else if (
      detailActiveTab === 'transcript' &&
      d.transcriptEditable &&
      d.refinedMode !== 'fulltext' &&
      d.refineState !== 'refining' &&
      !(d.hasRefined && d.transcriptVersion === 'original')
    )
      actions = `<button class="tabbar-action" data-edit-transcript type="button" aria-label="${t('编辑')}">${interfaceIcon('edit')}${t('编辑')}</button>`;
    if (!editing)
      context = `<div class="transcript-versions">${d.hasRefined ? `<button type="button" data-transcript-version="refined" aria-pressed="${d.transcriptVersion !== 'original'}">${t('精修')}</button>` : ''}<button type="button" data-transcript-version="original"${d.hasOriginalTranscript === false ? ' disabled' : ''} aria-pressed="${!d.hasRefined || d.transcriptVersion === 'original'}">${t('原始')}</button></div><label class="search">${interfaceIcon('search')}<input type="search" data-transcript-search aria-label="${t('搜索')}" placeholder="${t('搜索')}" value="${escapeHtml(d.transcriptSearch || '')}" /></label><span data-transcript-results role="status"></span>${renderRefineStatus(d)}`;
  }
  const find =
    !editing && (scope !== 'transcript' || actions) && typeof correctionControls === 'function'
      ? correctionControls(currentMeetingDetail, scope)
      : '';
  return `<div class="detail-content-header"><div class="tabbar"><div class="tabbar-tabs" role="tablist" aria-label="${t('笔记')} / ${t('逐字稿')} / ${t('会议纪要')}">${[
    ['notes', '笔记'],
    ['transcript', '逐字稿'],
    ['summary', '会议纪要'],
  ]
    .map(
      ([key, label]) =>
        `<button class="tab${scope === key ? ' active' : ''}" data-detail-tab="${key}" id="detail-tab-${key}" role="tab" aria-selected="${scope === key}" aria-controls="detail-panel-${key}" tabindex="${scope === key ? '0' : '-1'}">${t(label)}</button>`,
    )
    .join(
      '',
    )}</div><div class="detail-content-status">${status}</div></div><div class="detail-content-toolbar" role="toolbar" aria-label="${t(scope === 'notes' ? '笔记' : scope === 'summary' ? '会议纪要' : '逐字稿')}"><div class="detail-content-actions">${find}${actions}</div><div class="detail-content-context">${context}</div></div></div>`;
}

function resizeTranscriptField(field) {
  field.style.height = 'auto';
  field.style.height = Math.max(40, field.scrollHeight + 2) + 'px';
}
/** 刷新选定会议的逐字稿、笔记和摘要面板。@returns {void} */
function renderMeetingDetail() {
  const d = uiData.detail;
  const actions = document.querySelector('#detail-view .detail-actions');
  if (actions) document.querySelector('#detail-view').append(actions);
  document.querySelector('#detail-view .detail-head .summary-participants')?.remove();
  const notesHadFocus = Boolean(document.activeElement?.closest('[data-detail-notes-root]'));
  const summaryHadFocus = Boolean(document.activeElement?.closest('[data-inline-summary-editor]'));
  const notesMode = detailNotesEditor?.getMode();
  const summaryMode = inlineSummaryEditor?.getMode();
  detailNotesEditor?.destroy();
  inlineSummaryEditor?.destroy();
  detailNotesEditor = inlineSummaryEditor = null;
  const notesPanel = d.notesEditing
    ? `<div class="detail-notes-edit"><div data-detail-notes-root></div></div>`
    : `<div class="detail-notes-view">${typeof correctionFeedback === 'function' ? correctionFeedback(currentMeetingDetail, 'notes') : ''}${d.notes && String(d.notes).trim() ? `<div class="detail-notes-content markdown-content">${renderMarkdown(d.notes)}</div>` : `<p class="detail-notes-empty">${t('会议中没有记录笔记。')}</p>`}</div>`;
  const hasRefined = Boolean(d.hasRefined && d.refinedTranscript.length);
  const fulltextMode =
    hasRefined && d.transcriptVersion !== 'original' && d.refinedMode === 'fulltext';
  const showingRefined =
    hasRefined && d.transcriptVersion !== 'original' && d.refinedMode === 'timestamps';
  let transcriptBody;
  if (fulltextMode) {
    transcriptBody = `<div class="refined-fulltext"><p class="eyebrow">${t('精修全文')}</p><p class="refined-fulltext-hint">${t('经过会后模型整理后的完整转写文本。由于当前模型不提供时间戳，该版本不支持逐句音频定位。')}</p><div class="refined-fulltext-body">${escapeHtml(d.refinedFulltext)}</div></div>`;
  } else {
    // 编辑态下用草稿覆盖后端文本，使并发刷新不会吞掉尚未保存的输入。
    const draft = d.transcriptEditing ? d.transcriptDraft || {} : {};
    transcriptBody = (
      d.transcriptEditing && d.transcriptEditEntries
        ? d.transcriptEditEntries
        : showingRefined
          ? d.refinedTranscript
          : d.transcriptVersion === 'original'
            ? d.originalTranscript || d.transcript
            : d.transcript
    )
      .map((entry) => ({
        ...entry,
        text: draft[entry.segmentId] ?? entry.text,
        textEditable: Boolean(d.transcriptEditing),
        textModified: Boolean(
          d.transcriptEditing &&
            draft[entry.segmentId] !== undefined &&
            String(draft[entry.segmentId]).trim() !== String(entry.text).trim(),
        ),
        textSaving: d.transcriptSaveState === 'saving',
        textError: d.transcriptErrors?.[entry.segmentId] || '',
      }))
      .map(renderTranscriptSegment)
      .join('');
  }
  const focusedField = document.activeElement?.closest?.('[data-segment-text]');
  const focusState =
    d.transcriptEditing && focusedField
      ? {
          id: focusedField.dataset.segmentText,
          start: focusedField.selectionStart,
          end: focusedField.selectionEnd,
        }
      : null;
  document.querySelector('.final-transcript').innerHTML =
    `${renderDetailTabbar()}<div class="detail-notes-panel" data-detail-panel="notes" id="detail-panel-notes" role="tabpanel" aria-labelledby="detail-tab-notes"${detailActiveTab !== 'notes' ? ' hidden' : ''}>${notesPanel}</div><div class="detail-summary-panel" data-detail-panel="summary" id="detail-panel-summary" role="tabpanel" aria-labelledby="detail-tab-summary"${detailActiveTab !== 'summary' ? ' hidden' : ''}></div><div class="transcript-panel" data-detail-panel="transcript" id="detail-panel-transcript" role="tabpanel" aria-labelledby="detail-tab-transcript"${detailActiveTab !== 'transcript' ? ' hidden' : ''}><div class="transcript-body">${typeof correctionFeedback === 'function' ? correctionFeedback(currentMeetingDetail) : ''}${transcriptBody}</div></div>`;
  document.querySelectorAll('[data-segment-text]').forEach((field) => resizeTranscriptField(field));
  filterDetailTranscript();
  if (focusState) {
    const restored = [...document.querySelectorAll('[data-segment-text]')].find(
      (field) => field.dataset.segmentText === focusState.id,
    );
    if (restored) {
      restored.focus();
      restored.setSelectionRange(focusState.start, focusState.end);
    }
  }
  if (d.notesEditing) {
    const root = document.querySelector('[data-detail-notes-root]');
    if (root) {
      detailNotesEditor = createNotesEditor(root, {
        onInput: (...args) => appActions.updateDetailNotesDraft(...args),
        getMeetingId: () => currentMeetingDetail?.id,
        getHighlightTime: () => appActions.noteHighlightTime(),
      });
      if (notesMode) detailNotesEditor.setMode(notesMode);
      detailNotesEditor.setMarkdown(d.notes);
      if (notesHadFocus) detailNotesEditor.focus();
    }
  }
  document.querySelector('.notes').innerHTML = renderMeetingSummary({
    ...d.summary,
    editing: d.summaryEditing,
    saveState: d.summarySaveState,
    participants: currentMeetingDetail?.speakers || [],
  });
  syncDetailSummaryPanel();
  const summaryPreview = document.querySelector('#detail-view .summary-preview');
  if (summaryPreview && typeof correctionFeedback === 'function')
    summaryPreview.insertAdjacentHTML(
      'afterbegin',
      correctionFeedback(currentMeetingDetail, 'summary'),
    );
  filterDetailTranscript();
  syncSummaryFeedback();
  if (d.summaryEditing) {
    const root = document.querySelector('[data-inline-summary-editor]');
    if (root) {
      inlineSummaryEditor = createNotesEditor(root, {
        ariaLabel: t('会议纪要'),
        getMeetingId: () => currentMeetingDetail?.id,
        onInput: () => {
          d.summaryDraft = inlineSummaryEditor.getMarkdown();
          d.summarySaveState = 'dirty';
          const status = document.querySelector('[data-summary-save-status] .save-state');
          if (status) status.outerHTML = renderSaveState('dirty');
        },
      });
      if (summaryMode) inlineSummaryEditor.setMode(summaryMode);
      inlineSummaryEditor.setMarkdown(d.summaryDraft ?? d.summary.markdown);
      if (summaryHadFocus) inlineSummaryEditor.focus();
    }
  }
}

/** 三个标签共用阅读区；参会者留在固定页头，纪要编辑器不随切换重建。 */
function syncDetailSummaryPanel() {
  const root = document.querySelector('#detail-view');
  const main = root?.querySelector('[data-detail-panel="summary"]');
  const aside = root?.querySelector('.notes');
  const preview = root?.querySelector('.summary-preview');
  if (!main || !aside || !preview) return;
  const body = preview.querySelector('.summary-body');
  if (body && !body.querySelector('.summary-reading-section')) {
    let content;
    for (const node of [...body.children]) {
      if (node.tagName === 'H2') {
        const section = document.createElement('section');
        section.className = 'summary-reading-section';
        content = document.createElement('div');
        body.insertBefore(section, node);
        section.append(node, content);
      } else if (node.tagName === 'H1') content = null;
      else if (content) content.append(node);
    }
  }
  const people = preview.querySelector('.summary-participants');
  if (people) root.querySelector('.detail-title').append(people);
  aside.hidden = true;
  main.append(preview);
}
