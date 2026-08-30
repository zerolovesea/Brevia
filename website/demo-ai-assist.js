(function () {
  var chinese = document.documentElement.lang.indexOf('zh') === 0;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // —— Copy (zh / en) ——
  var copy = chinese ? {
    meeting: '产品周例会',
    crumb: '正在录制',
    liveName: '产品周例会',
    recording: '正在录制',
    saved: '已保存',
    captionsLabel: '实时字幕',
    notesLabel: '我的笔记',
    aiAssistLabel: 'AI 辅助',
    expandCaptions: '展开字幕',
    backToNotes: '返回笔记',
    captionsBtn: '字幕',
    translationBtn: '译文: 关',
    pauseBtn: 'Ⅱ 暂停',
    endBtn: '结束会议',
    toolbar: { bold: '加粗', italic: '斜体', h1: '标题 1', h2: '标题 2', h3: '标题 3', ul: '列表', ol: '编号列表', quote: '引用', link: '插入链接', image: '插入图片', code: '行内代码', todo: '待办', highlight: '重点', mode: '富文本' },
    accept: '＋ 加入笔记',
    ignore: '忽略',
    notesMarkdown: '## 本周重点\n\n- 移动端验收：本周完成\n- 测试版本：周五前提交',
    captions: [
      { time: '10:24', speaker: '产品负责人', text: '本周先完成移动端的验收，周五前给到测试版本。', signals: ['日期'] },
      { time: '10:25', speaker: 'Maya', text: '测试范围我来整理，重点覆盖语音转写和笔记联动。' },
      { time: '10:26', speaker: '产品负责人', text: '那就先把现有功能打磨稳定，不扩展新需求。' },
      { time: '10:27', speaker: 'Maya', text: '验收范围我再和测试团队对齐一下。' },
      { time: '10:28', speaker: '产品负责人', text: '好的，今天下班前把范围同步到群里。' },
      { time: '10:29', speaker: 'Maya', text: '没问题，我会把时间点也标上。' }
    ],
    suggestions: [
      { type: '可能的决策', text: '本周优先完成移动端，不扩展新需求。' },
      { type: '行动项', text: 'Maya：周五前提交测试版本。' },
      { type: '待确认', text: '移动端验收范围由产品和研发今天确认。' }
    ]
  } : {
    meeting: 'Product weekly',
    crumb: 'Recording',
    liveName: 'Product weekly',
    recording: 'Recording',
    saved: 'Saved',
    captionsLabel: 'Live captions',
    notesLabel: 'My notes',
    aiAssistLabel: 'AI assist',
    expandCaptions: 'Expand captions',
    backToNotes: 'Back to notes',
    captionsBtn: 'Captions',
    translationBtn: 'Translation: Off',
    pauseBtn: 'Ⅱ Pause',
    endBtn: 'End meeting',
    toolbar: { bold: 'Bold', italic: 'Italic', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', ul: 'List', ol: 'Numbered list', quote: 'Quote', link: 'Insert link', image: 'Insert image', code: 'Code', todo: 'Todo', highlight: 'Highlight', mode: 'Rich text' },
    accept: '＋ Add to notes',
    ignore: 'Dismiss',
    notesMarkdown: '## This week\n\n- Mobile acceptance: this week\n- Test build: by Friday',
    captions: [
      { time: '10:24', speaker: 'Product lead', text: 'We will finish mobile acceptance this week and ship a test build by Friday.', signals: ['Date'] },
      { time: '10:25', speaker: 'Maya', text: 'I will map the test scope, focusing on speech-to-text and notes sync.' },
      { time: '10:26', speaker: 'Product lead', text: 'Then we keep the current features stable instead of adding new scope.' },
      { time: '10:27', speaker: 'Maya', text: 'I will align the acceptance scope with the QA team.' },
      { time: '10:28', speaker: 'Product lead', text: 'Good. Share the scope to the channel before EOD.' },
      { time: '10:29', speaker: 'Maya', text: 'Sure, I will add the milestones too.' }
    ],
    suggestions: [
      { type: 'Possible decision', text: 'Finish mobile first this week. No new scope.' },
      { type: 'Action item', text: 'Maya: submit the test build by Friday.' },
      { type: 'Open question', text: 'Confirm the mobile acceptance scope today.' }
    ]
  };

  // —— Notes editor initial content (mirrors the app's rendered Markdown) ——
  function notesHtml() {
    var lines = copy.notesMarkdown.split('\n');
    var body = '';
    var inList = false;
    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (/^-\s+/.test(trimmed)) {
        if (!inList) { body += '<ul>'; inList = true; }
        body += '<li>' + trimmed.replace(/^-\s+/, '') + '</li>';
      } else {
        if (inList) { body += '</ul>'; inList = false; }
        if (/^##\s+/.test(trimmed)) body += '<h2>' + trimmed.replace(/^##\s+/, '') + '</h2>';
        else if (trimmed) body += '<p>' + trimmed + '</p>';
      }
    });
    if (inList) body += '</ul>';
    return body;
  }

  // —— Static toolbar markup, 1:1 with the real notes editor toolbar ——
  function toolbarHtml() {
    var t = copy.toolbar;
    var ul = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M7 4h6M7 8h6M7 12h6"/></svg>';
    var ol = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="1.5" y="5" font-size="6.5" fill="currentColor" stroke="none">1</text><text x="1.5" y="9.5" font-size="6.5" fill="currentColor" stroke="none">2</text><text x="1.5" y="14" font-size="6.5" fill="currentColor" stroke="none">3</text><path d="M7 4h6M7 8.5h6M7 13h6"/></svg>';
    var link = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6.2 9.8 3.6-3.6" /><path d="M7.2 11.4 5.6 13a2.6 2.6 0 0 1-3.6-3.6l1.6-1.6a2.6 2.6 0 0 1 3.6 0" /><path d="M8.8 4.6l1.6-1.6a2.6 2.6 0 0 1 3.6 3.6l-1.6 1.6a2.6 2.6 0 0 1-3.6 0" /></svg>';
    var image = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><circle cx="5.5" cy="6.2" r="1.4" /><path d="m1.5 11 3.6-3.6L11 12.8" /></svg>';
    var mode = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3h9M8 3v10"/></svg>';
    var btns = [
      ['bold', t.bold, '<b>B</b>'],
      ['italic', t.italic, '<i>I</i>'],
      ['h1', t.h1, 'H1'],
      ['h2', t.h2, 'H2'],
      ['h3', t.h3, 'H3'],
      ['ul', t.ul, ul],
      ['ol', t.ol, ol],
      ['quote', t.quote, '❝'],
      ['link', t.link, link],
      ['image', t.image, image],
      ['code', t.code, '&lt;/&gt;'],
      ['todo', t.todo, '☐'],
      ['highlight', t.highlight, '★'],
      ['mode-toggle', t.mode, mode]
    ];
    return btns.map(function (b) {
      return '<button type="button" data-notes-command="' + b[0] + '" title="' + b[1] + '" aria-label="' + b[1] + '">' + b[2] + '</button>';
    }).join('');
  }

  // —— Live-view shell, 1:1 with the real app (frontend/index.html #live-view) ——
  function shellHtml() {
    var c = copy;
    return String.raw`
    <main class="app-shell is-live-meeting">
      <aside class="sidebar" aria-label="主导航">
        <button class="brand"><span class="brand-mark" aria-hidden="true">言</span><img src="../frontend/assets/brevia-logo.svg" alt="brevia" /></button>
        <button class="new-meeting"><span class="new-meeting-icon">+</span><span class="new-meeting-label">开始会议</span></button>
        <nav>
          <button class="nav-item active"><span>⌂</span> 所有会议</button>
          <button class="nav-item"><span>◷</span> 最近删除</button>
          <button class="nav-item"><span>⚙</span> 设置</button>
        </nav>
      </aside>
      <section class="workspace">
        <header class="window-bar">
          <div class="traffic"><i></i><i></i><i></i></div>
          <span>${c.crumb}</span>
          <div class="window-actions">
            <button class="icon-button">文</button>
            <button class="icon-button">◐</button>
          </div>
        </header>
        <section class="view active" id="live-view">
          <header class="live-header">
            <div class="live-title">
              <strong>${c.liveName}</strong>
              <div class="live-status">
                <span class="recording"><i></i> ${c.recording}</span>
                <time data-demo-timer>00:12:45</time>
                <span class="save-state"><svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg> <span>${c.saved}</span></span>
              </div>
            </div>
            <div class="live-caption-controls">
              <button class="floating-caption-toggle" data-enabled="false" type="button" title="悬浮字幕">${c.captionsBtn}</button>
              <button class="translation-toggle" data-enabled="false" type="button">${c.translationBtn}</button>
            </div>
            <button class="pause-button" type="button">${c.pauseBtn}</button>
            <button class="end-button" type="button">${c.endBtn}</button>
          </header>
          <div class="live-layout">
            <section class="live-notes">
              <header class="live-section-head">
                <p class="eyebrow">${c.notesLabel}</p>
                <button class="ai-assist-toggle is-enabled" type="button"><span class="ai-assist-toggle-star">✦</span> <span>${c.aiAssistLabel}</span></button>
                <button class="live-mode-toggle" data-toggle-live-mode="caption" type="button" aria-label="${c.expandCaptions}" title="${c.expandCaptions}"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></button>
              </header>
              <div data-live-notes-root>
                <div class="notes-toolbar">${toolbarHtml()}</div>
                <div class="notes-url-pop" hidden><input type="text" placeholder="https://…" spellcheck="false" /></div>
                <div class="ai-suggestion" data-demo-ai-suggestion></div>
                <div class="notes-editor" contenteditable="false" aria-label="${c.notesLabel}" spellcheck="false" data-demo-notes-editor>${notesHtml()}</div>
                <textarea class="notes-input" hidden></textarea>
              </div>
            </section>
            <section class="live-captions">
              <header class="live-section-head">
                <p class="eyebrow">${c.captionsLabel}</p>
                <button class="live-mode-toggle" data-toggle-live-mode="notes" type="button" aria-label="${c.backToNotes}" title="${c.backToNotes}"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10 3-5 5 5 5"/></svg></button>
              </header>
              <div class="transcript-scroll" data-demo-transcript></div>
              <button class="back-to-latest" type="button" hidden><span>↓</span> <span>回到最新</span></button>
            </section>
          </div>
        </section>
      </section>
    </main>`;
  }

  // —— Suggestion card markup, 1:1 with renderAiSuggestion ——
  function suggestionHtml(s) {
    return String.raw`
    <div class="ai-suggestion-card">
      <div class="ai-suggestion-head"><span class="ai-suggestion-star">✦</span> <span class="ai-suggestion-type">${s.type}</span></div>
      <p class="ai-suggestion-text">${s.text}</p>
      <div class="ai-suggestion-actions">
        <button type="button" class="ai-suggestion-accept" data-demo-accept>${copy.accept}</button>
        <button type="button" class="ai-suggestion-ignore" data-demo-ignore>${copy.ignore}</button>
      </div>
    </div>`;
  }

  // —— Segment markup, 1:1 with renderTranscriptSegment ——
  function segmentHtml(seg) {
    var signals = seg.signals && seg.signals.length
      ? '<small class="caption-signals">' + seg.signals.join(' · ') + '</small>'
      : '';
    return String.raw`
    <article class="segment">
      <div class="segment-meta"><time>${seg.time}</time><button class="segment-speaker">${seg.speaker}</button>${signals}</div>
      <div class="segment-copy"><p>${seg.text}</p></div>
    </article>`;
  }

  var root = document.getElementById('demo-content');
  if (!root) return;
  root.innerHTML = shellHtml();

  // Scale the shell to the demo viewport (same math as demo-single.js).
  var viewport = document.getElementById('demo-viewport');
  var appShell = root.querySelector('.app-shell');
  function applyScale() {
    if (!viewport || !appShell) return;
    var rect = viewport.getBoundingClientRect();
    var scale = Math.min(rect.width / 1200, rect.height / 750, 1);
    appShell.style.transform = 'scale(' + scale + ')';
    appShell.style.transformOrigin = 'top left';
  }
  applyScale();
  window.addEventListener('resize', applyScale);

  var engine = new DemoEngine();
  engine.init(viewport, document.getElementById('virtual-cursor'), document.getElementById('cursor-ripple'));

  var transcript = root.querySelector('[data-demo-transcript]');
  var suggestionRoot = root.querySelector('[data-demo-ai-suggestion]');
  var editor = root.querySelector('[data-demo-notes-editor]');
  var timerEl = root.querySelector('[data-demo-timer]');

  // Tick the recording timer.
  var baseSeconds = 12 * 60 + 45;
  var timerSeconds = baseSeconds;
  window.setInterval(function () {
    timerSeconds += 1;
    var h = Math.floor(timerSeconds / 3600).toString().padStart(2, '0');
    var m = Math.floor((timerSeconds % 3600) / 60).toString().padStart(2, '0');
    var s = (timerSeconds % 60).toString().padStart(2, '0');
    if (timerEl) timerEl.textContent = h + ':' + m + ':' + s;
  }, 1000);

  function appendNote(text) {
    var li = document.createElement('li');
    li.textContent = text;
    var list = editor.querySelector('ul');
    if (!list) {
      list = document.createElement('ul');
      editor.appendChild(list);
    }
    list.appendChild(li);
    editor.scrollTop = editor.scrollHeight;
  }

  function showSuggestion(index) {
    var s = copy.suggestions[index % copy.suggestions.length];
    suggestionRoot.innerHTML = suggestionHtml(s);
    return s;
  }

  function hideSuggestion() {
    suggestionRoot.innerHTML = '';
  }

  // Static first paint (used for reduced motion and as the loop base).
  function renderStatic() {
    copy.captions.forEach(function (seg) {
      var wrap = document.createElement('div');
      wrap.innerHTML = segmentHtml(seg);
      transcript.appendChild(wrap.firstElementChild);
    });
    showSuggestion(0);
  }

  async function playLoop() {
    var captionIndex = 0;
    var suggestionIndex = 0;
    // Stream each caption first.
    for (; captionIndex < copy.captions.length; captionIndex++) {
      await engine.wait(700);
      await streamCaption(copy.captions[captionIndex]);
    }
    // Then cycle suggestions with a click on ＋ 加入笔记, while captions keep arriving.
    while (true) {
      showSuggestion(suggestionIndex);
      suggestionIndex = (suggestionIndex + 1) % copy.suggestions.length;
      await engine.wait(1100);
      await engine.moveCursor('[data-demo-accept]', 800);
      await engine.hover(320);
      await engine.click(300);
      var s = suggestionRoot.querySelector('.ai-suggestion-text');
      if (s) appendNote(s.textContent);
      hideSuggestion();
      await engine.wait(600);
      // A new live caption lands in between suggestions so the right panel stays alive.
      await streamCaption(copy.captions[captionIndex % copy.captions.length]);
      captionIndex += 1;
      // Keep the demo lively: reset the notes list when it grows long.
      if (editor.querySelectorAll('li').length > 5) {
        editor.innerHTML = notesHtml();
      }
    }
  }

  async function streamCaption(seg) {
    var wrap = document.createElement('div');
    wrap.innerHTML = segmentHtml(seg);
    var node = wrap.firstElementChild;
    node.style.opacity = '0';
    transcript.appendChild(node);
    await engine.wait(60);
    node.classList.add('text-appearing');
    node.style.opacity = '1';
    transcript.scrollTop = transcript.scrollHeight;
    await engine.wait(900);
    // Trim old lines so the panel doesn't grow forever.
    while (transcript.children.length > 6) {
      transcript.removeChild(transcript.firstElementChild);
    }
  }

  if (reducedMotion) {
    renderStatic();
    return;
  }
  engine.reset();
  playLoop();
}());
