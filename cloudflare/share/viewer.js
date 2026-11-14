const languages = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];
let locale =
  (navigator.languages || [navigator.language])
    .map((value) => value.toLowerCase().split('-')[0])
    .find((value) => languages.includes(value)) || 'en';
const t = (key) => window.BreviaLocaleData.translate(key, locale);
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light';
const content = document.querySelector('#content');
const status = document.querySelector('#status');
const tabs = document.querySelector('#tabs');
const quotePreview = document.querySelector('#quote-preview');
let quoteAnchor;
const language = document.querySelector('#language');
const languageTrigger = language.querySelector('summary');
const languageOptions = language.querySelector('.shared-language-options');
const languageNames = {
  zh: '中文',
  en: 'English',
  es: 'Español',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
};
languageOptions.innerHTML = languages
  .map(
    (code) =>
      `<button type="button" data-language="${code}" lang="${code}">${languageNames[code]}</button>`,
  )
  .join('');
let snapshot,
  expiryTimer,
  view = 'summary',
  speakerFilter = null,
  transcriptMode = 'original',
  statusKey = '加载中';
const palette = new Map();
// 分享文本来自外部上传，按 Markdown 解析并清理生成的 HTML。
const markdown = new marked.Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    table(token) {
      return `<div class="shared-table">${marked.Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});
// 旧分享未保存身份时只能按原有姓名区分；新快照始终使用身份 ID。
const identity = (item) => (item.speaker_id ? 'id:' + item.speaker_id : 'name:' + item.speaker);
function hideQuotePreview() {
  quoteAnchor?.removeAttribute('aria-describedby');
  quoteAnchor = undefined;
  quotePreview.hidden = true;
  quotePreview.querySelector('strong').textContent = '';
  quotePreview.querySelector('p').textContent = '';
}
function showQuotePreview(button, timestamp, speaker, text) {
  hideQuotePreview();
  quoteAnchor = button;
  quotePreview.querySelector('strong').textContent = `${timestamp} · ${speaker}`;
  quotePreview.querySelector('p').textContent = text;
  quotePreview.hidden = false;
  const anchor = button.getBoundingClientRect();
  const { width, height } = quotePreview.getBoundingClientRect();
  const below = anchor.bottom + 8;
  quotePreview.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - width - 12))}px`;
  quotePreview.style.top = `${below + height <= innerHeight - 12 ? below : Math.max(12, anchor.top - height - 8)}px`;
  button.setAttribute('aria-describedby', quotePreview.id);
}
function wireSummaryTimestamps(article, speakerLabel) {
  const secondsToIndex = new Map();
  snapshot.transcript.forEach((item, index) => {
    const second = Math.floor(item.start_ms / 1000);
    // 旧快照只有段落起点，同秒多段时不能仅凭时间戳判定原话。
    secondsToIndex.set(second, secondsToIndex.has(second) ? null : index);
  });
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest('a, code, pre, button'))
      nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const group of node.data.matchAll(/\[[\d:·,，、–—\s-]+\]|〔[\d:·,，、–—\s-]+〕/g)) {
      for (const stamp of group[0].matchAll(/\d+(?::\d+)+/g)) {
        const time = stamp[0];
        if (!/^(?:\d{1,3}:)?\d{1,3}:\d{2}$/.test(time)) continue;
        const units = time.split(':').map(Number);
        if (units.at(-1) >= 60 || (units.length === 3 && units[1] >= 60)) continue;
        const index = secondsToIndex.get(units.reduce((seconds, unit) => seconds * 60 + unit, 0));
        if (!Number.isInteger(index)) continue;
        const item = snapshot.transcript[index];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shared-time';
        button.textContent = time;
        button.setAttribute('aria-label', `${t('逐字稿')} ${time}`);
        const preview = () => showQuotePreview(button, time, speakerLabel(item), item.text);
        button.addEventListener('pointerenter', (event) => {
          if (event.pointerType !== 'touch') preview();
        });
        button.addEventListener('pointerleave', () => {
          if (document.activeElement !== button) hideQuotePreview();
        });
        button.addEventListener('focus', preview);
        button.addEventListener('blur', hideQuotePreview);
        button.addEventListener('click', () => {
          if (speakerFilter !== identity(item)) speakerFilter = null;
          if (transcriptMode === 'translation') transcriptMode = 'comparison';
          view = 'transcript';
          renderShare();
          const row = content.querySelector(`[data-transcript-index="${index}"]`);
          row.focus({ preventScroll: true });
          row.scrollIntoView({ block: 'center' });
        });
        const start = group.index + stamp.index;
        fragment.append(node.data.slice(offset, start), button);
        offset = start + time.length;
      }
    }
    if (offset) {
      fragment.append(node.data.slice(offset));
      node.replaceWith(fragment);
    }
  }
}
function renderShare() {
  hideQuotePreview();
  document.documentElement.lang = locale;
  languageTrigger.innerHTML = `${interfaceIcon('globe')}<span>${languageNames[locale]}</span>${interfaceIcon('chevron-down')}`;
  languageTrigger.title = t('界面语言');
  languageTrigger.setAttribute('aria-label', `${t('界面语言')} · ${languageNames[locale]}`);
  for (const button of languageOptions.querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.language === locale));
  document.querySelector('#password-label').textContent = t('分享密码');
  document.querySelector('#unlock button').textContent = t('查看文档');
  status.textContent = t(statusKey);
  if (!snapshot) return;
  document.title = `${snapshot.title} · Brevia`;
  document.querySelector('#title').textContent = snapshot.title;
  const expires = new Date(snapshot.expiresAt * 1000);
  const expiry = document.querySelector('#expiry');
  expiry.title = `${t('有效期至')} ${expires.toLocaleString(locale)}`;
  expiry.setAttribute('aria-label', expiry.title);
  expiry.dateTime = expires.toISOString();
  expiry.innerHTML = `${interfaceIcon('clock')}<span>${escapeHtml(expires.toLocaleDateString(locale))}</span>`;
  const views = document.querySelector('#views');
  views.hidden = !Number.isSafeInteger(snapshot.views);
  if (!views.hidden) {
    views.title = t('浏览 {n} 次').replace('{n}', snapshot.views.toLocaleString(locale));
    views.setAttribute('aria-label', views.title);
    views.innerHTML = `${interfaceIcon('eye')}<span>${snapshot.views.toLocaleString(locale)}</span>`;
  }
  const people = new Map();
  for (const item of snapshot.transcript) {
    const id = identity(item);
    if (!people.has(id)) people.set(id, { id, name: item.speaker });
    if (id) speakerColor(id, palette);
  }
  const nameCounts = new Map();
  for (const person of people.values()) {
    person.label = formatSpeakerName(person.name) || t('说话人');
    person.ordinal = (nameCounts.get(person.label) || 0) + 1;
    nameCounts.set(person.label, person.ordinal);
  }
  const personLabel = ({ label, ordinal }) =>
    nameCounts.get(label) > 1 ? `${label} · ${ordinal}` : label;
  const calendarDate = snapshot.meeting_date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = calendarDate
    ? new Date(Number(calendarDate[1]), Number(calendarDate[2]) - 1, Number(calendarDate[3]))
    : snapshot.meeting_date
      ? new Date(snapshot.meeting_date)
      : null;
  document.querySelector('#meeting-meta').innerHTML = [
    date && Number.isFinite(date.getTime())
      ? `<span>${escapeHtml(date.toLocaleDateString(locale))}</span>`
      : '',
    snapshot.duration_ms !== undefined
      ? `<span>${interfaceIcon('clock')}${Math.max(1, Math.round(snapshot.duration_ms / 60000))} ${escapeHtml(t('分钟'))}</span>`
      : '',
  ].join('');
  const participants = document.querySelector('#participants');
  participants.hidden = !people.size;
  participants.setAttribute('aria-label', `${t('参与者')} (${people.size})`);
  participants.innerHTML = [...people.values()]
    .map(
      (person) =>
        `<span>${renderSpeakerAvatar(person, palette)}${escapeHtml(personLabel(person))}</span>`,
    )
    .join('');
  tabs.innerHTML = [
    ['summary', '会议纪要'],
    ['transcript', '逐字稿'],
  ]
    .map(
      ([key, label]) =>
        `<button type="button" data-view="${key}" aria-pressed="${view === key}">${escapeHtml(t(label))}</button>`,
    )
    .join('');
  tabs.hidden = false;
  if (view === 'transcript') {
    const peopleList = [...people.values()];
    const filters = `<div class="shared-speakers" role="group" aria-label="${escapeHtml(t('参与者'))}"><button type="button" data-speaker-filter="all" aria-pressed="${speakerFilter === null}">${escapeHtml(t('全部发言'))}</button>${peopleList.map((person, index) => `<button type="button" data-speaker-filter="${index}" aria-pressed="${speakerFilter === person.id}">${renderSpeakerAvatar(person, palette)}${escapeHtml(personLabel(person))}</button>`).join('')}</div>`;
    const modes = snapshot.transcript.some((item) => item.translation?.trim())
      ? `<div class="shared-transcript-modes" role="group" aria-label="${escapeHtml(t('逐字稿'))}">${[
          ['original', '原文'],
          ['translation', '仅译文'],
          ['comparison', '对照'],
        ]
          .map(
            ([mode, label]) =>
              `<button type="button" data-transcript-mode="${mode}" aria-pressed="${transcriptMode === mode}">${escapeHtml(t(label))}</button>`,
          )
          .join('')}</div>`
      : '';
    const rows = snapshot.transcript
      .map((item, index) => {
        if (speakerFilter !== null && identity(item) !== speakerFilter) return '';
        if (transcriptMode === 'translation' && !item.translation?.trim()) return '';
        const original = transcriptMode === 'translation' ? '' : `<p>${escapeHtml(item.text)}</p>`;
        const translation =
          transcriptMode !== 'original' && item.translation?.trim()
            ? `<p class="${transcriptMode === 'comparison' ? 'shared-translation' : ''}">${escapeHtml(item.translation)}</p>`
            : '';
        return `<article class="shared-segment" data-transcript-index="${index}" tabindex="-1">${renderSpeakerAvatar({ id: identity(item), name: item.speaker }, palette)}<div class="shared-speech"><div><b>${escapeHtml(personLabel(people.get(identity(item))))}</b><time>${formatMeetingTime(item.start_ms)}</time></div>${original}${translation}</div></article>`;
      })
      .join('');
    content.innerHTML = `<div class="shared-transcript-toolbar">${filters}${modes}</div>${rows || `<p class="shared-empty">${escapeHtml(t(transcriptMode === 'translation' ? '暂无译文' : '暂无内容'))}</p>`}`;
    content.querySelectorAll('[data-transcript-mode]').forEach((button) =>
      button.addEventListener('click', () => {
        transcriptMode = button.dataset.transcriptMode;
        renderShare();
        content
          .querySelector(`[data-transcript-mode="${transcriptMode}"]`)
          .focus({ preventScroll: true });
      }),
    );
    content.querySelectorAll('[data-speaker-filter]').forEach((button) =>
      button.addEventListener('click', () => {
        const choice = button.dataset.speakerFilter;
        speakerFilter = choice === 'all' ? null : peopleList[Number(choice)].id;
        renderShare();
        content.querySelector(`[data-speaker-filter="${choice}"]`)?.focus({ preventScroll: true });
      }),
    );
  }
  if (view === 'summary') {
    const groups = new Map();
    for (const claim of snapshot.claims) {
      if (!groups.has(claim.section))
        groups.set(claim.section, { label: claim.section || t('原因分析'), items: [] });
      groups.get(claim.section).items.push({
        ...claim,
        kind: 'cause',
        source_chars: claim.sources.reduce((sum, source) => sum + source.text.length, 0),
      });
    }
    const graph = groups.size
      ? renderCauseTree([...groups.values()], true)
      : `<p class="shared-empty">${escapeHtml(t('暂无内容'))}</p>`;
    content.innerHTML = `<div class="shared-review"><article class="shared-markdown">${DOMPurify.sanitize(markdown.parse(snapshot.markdown), { USE_PROFILES: { html: true } }) || escapeHtml(t('暂无内容'))}</article><aside aria-label="${escapeHtml(t('鱼骨图'))}">${graph}</aside></div>`;
    wireSummaryTimestamps(content.querySelector('.shared-markdown'), (item) =>
      personLabel(people.get(identity(item))),
    );
    for (const link of content.querySelectorAll(
      '.shared-markdown a[href^="http:" i], .shared-markdown a[href^="https:" i]',
    )) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
}
function expire() {
  clearTimeout(expiryTimer);
  if (!snapshot) return;
  const remaining = snapshot.expiresAt * 1000 - Date.now();
  if (remaining <= 0) {
    snapshot = null;
    content.replaceChildren();
    tabs.hidden = true;
    for (const id of ['title', 'expiry', 'views', 'meeting-meta', 'participants']) {
      const element = document.getElementById(id);
      element.textContent = '';
      element.removeAttribute('title');
      element.removeAttribute('aria-label');
      element.removeAttribute('datetime');
    }
    document.title = 'Brevia';
    statusKey = '链接不存在或已过期';
    status.hidden = false;
    renderShare();
  } else expiryTimer = setTimeout(expire, Math.min(remaining, 2147483647));
}
async function loadShare(password) {
  try {
    const id = location.pathname.match(/^\/s\/([a-f0-9]{32})$/)?.[1];
    if (!id) throw new Error();
    const response = await fetch(`/api/shares/${id}`, {
      cache: 'no-store',
      ...(password !== undefined
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          }
        : {}),
    });
    if (response.status === 401) {
      document.querySelector('#unlock').hidden = false;
      statusKey = password === undefined ? '请输入分享密码' : '密码不正确';
      status.hidden = false;
      renderShare();
      document.querySelector('#password').focus();
      return;
    }
    if (!response.ok) {
      statusKey =
        response.status === 429
          ? '尝试过多，请稍后再试'
          : response.status === 404
            ? '链接不存在或已过期'
            : '链接不可用，请刷新重试或联系分享者';
      status.hidden = false;
      document.querySelector('#unlock').hidden = response.status !== 429;
      renderShare();
      return;
    }
    snapshot = await response.json();
    transcriptMode = snapshot.transcript.some((item) => item.translation?.trim())
      ? 'comparison'
      : 'original';
    document.querySelector('#unlock').hidden = true;
    document.querySelector('#password').value = '';
    status.hidden = true;
    view = snapshot.markdown || snapshot.claims.length ? 'summary' : 'transcript';
    renderShare();
    expire();
  } catch {
    status.hidden = false;
    statusKey = '链接不可用，请刷新重试或联系分享者';
    renderShare();
  }
}
languageOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-language]');
  if (!button) return;
  locale = button.dataset.language;
  language.open = false;
  renderShare();
  languageTrigger.focus({ preventScroll: true });
});
language.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !language.open) return;
  event.preventDefault();
  language.open = false;
  languageTrigger.focus({ preventScroll: true });
});
// WebKit 的指针点击可能先让旧控件失焦，新选项不会立刻获焦。
document.addEventListener('focusin', (event) => {
  if (language.open && !language.contains(event.target)) language.open = false;
});
document.addEventListener('pointerdown', (event) => {
  if (language.open && !language.contains(event.target)) language.open = false;
});
tabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) {
    view = button.dataset.view;
    renderShare();
    tabs.querySelector(`[data-view="${view}"]`).focus({ preventScroll: true });
  }
});
document.addEventListener('scroll', hideQuotePreview, true);
window.addEventListener('resize', hideQuotePreview);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideQuotePreview();
});
document.addEventListener('visibilitychange', expire);
document.querySelector('#unlock').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await loadShare(document.querySelector('#password').value);
  } finally {
    button.disabled = false;
  }
});
renderShare();
void loadShare();
