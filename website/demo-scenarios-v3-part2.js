/**
 * Demo Scenarios V3 - Part 2: Prepare View & Live View
 */

// 继续 DemoScenariosV3 类的方法

DemoScenariosV3.prototype.setupPrepareUI = function() {
  // 精确还原准备页面（基于第二张截图）
  const html = String.raw`
    <main class="app-shell">
      <aside class="sidebar">
        <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="brevia" /></button>
        <button class="new-meeting"><span>+</span> 开始会议</button>
        <nav>
          <button class="nav-item active"><span>⌂</span> 所有会议</button>
          <button class="nav-item"><span>◷</span> 最近删除</button>
          <button class="nav-item"><span>⚙</span> 设置</button>
        </nav>
      </aside>

      <section class="workspace">
        <header class="window-bar">
          <div class="traffic"><i></i><i></i><i></i></div>
          <span>准备录制</span>
          <div class="window-actions">
            <button class="icon-button">文</button>
            <button class="icon-button">◐</button>
          </div>
        </header>

        <section class="view active" id="prepare-view">
          <button class="back" data-view="home">← 返回会议库</button>

          <div class="prepare-layout">
            <div>
              <p class="eyebrow">准备录制</p>
              <h1>开始一场会议</h1>

              <form id="meeting-form">
                <label>
                  会议名称
                  <input data-demo-id="meeting-title" type="text" value="会议 20260810" maxlength="120" required />
                </label>

                <div class="form-grid">
                  <label>
                    会议语言
                    <div class="flow-select">
                      <button class="flow-select-toggle" data-demo-id="language-select" type="button">
                        自动检测 <span>⌄</span>
                      </button>
                    </div>
                  </label>

                  <label>
                    译文目标
                    <div class="flow-select">
                      <button class="flow-select-toggle" data-demo-id="translation-target" type="button">
                        不需要译文 <span>⌄</span>
                      </button>
                    </div>
                  </label>

                  <label>
                    预期说话人数
                    <input data-demo-id="speaker-count" type="text" placeholder="留空自动匹配" />
                  </label>

                  <label>
                    工作区
                    <div class="flow-select">
                      <button class="flow-select-toggle" data-demo-id="category" type="button">
                        未分类 <span>⌄</span>
                      </button>
                    </div>
                  </label>
                </div>

                <fieldset>
                  <legend>录制音频</legend>
                  <label class="choice">
                    <input name="capture-mic" type="checkbox" checked />
                    <span>
                      <b>我的麦克风</b>
                      <small>系统默认麦克风</small>
                    </span>
                    <strong class="input-state">
                      <i class="input-meter" style="--level: 0.65;" aria-hidden="true"></i>
                      输入良好
                    </strong>
                  </label>
                  <label class="choice">
                    <input name="capture-system" type="checkbox" checked />
                    <span>
                      <b>系统音频</b>
                      <small>需要授予屏幕与系统音频权限</small>
                    </span>
                    <strong>已就绪</strong>
                  </label>
                </fieldset>

                <button class="primary-action wide" data-demo-id="start-recording" type="button">
                  开始录制 <span>→</span>
                </button>
              </form>

              <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e5e5;">
                <button class="text-button">导入录音 →</button>
              </div>
            </div>

            <aside class="model-card">
              <div class="model-icon">⌁</div>
              <dl>
                <div>
                  <dt>计算设备</dt>
                  <dd>CPU</dd>
                </div>
                <div>
                  <dt>会议语言</dt>
                  <dd>中文</dd>
                </div>
                <div>
                  <dt>会议模式</dt>
                  <dd>标准模式</dd>
                </div>
              </dl>
              <dl class="model-detail-list" hidden>
                <div>
                  <dt>实时字幕模型</dt>
                  <dd>Streaming Zipformer Chinese XLarge</dd>
                </div>
                <div>
                  <dt>说话人分离模型</dt>
                  <dd>Pyannote + 3D-Speaker ERes2Net</dd>
                </div>
                <div>
                  <dt>会后精修模型</dt>
                  <dd>FunASR Nano int8</dd>
                </div>
              </dl>
              <button class="text-button" style="margin-top: 24px;">管理模型 →</button>
            </aside>
          </div>
        </section>
      </section>
    </main>
  `;
  return html;
};

// The real app's live panel is identical for every meeting (renderLivePanel in
// frontend/app.js): 模型与设置 with three selectors plus the power-saving choice.
// Shared here so the transcription and voiceprint demos render the same panel.
DemoScenariosV3.prototype.getLiveSettingsMarkup = function() {
  return String.raw`
    <section class="live-settings">
      <p class="eyebrow">模型与设置</p>

      <label class="config-select-field">
        会议语言
        <div class="flow-select">
          <button class="flow-select-toggle" type="button" aria-expanded="false">自动检测<span>⌄</span></button>
        </div>
      </label>

      <label class="config-select-field">
        实时识别模型
        <div class="flow-select">
          <button class="flow-select-toggle" type="button" aria-expanded="false">Streaming Zipformer Multilingual<span>⌄</span></button>
        </div>
      </label>

      <label class="config-select-field">
        精修模型
        <div class="flow-select">
          <button class="flow-select-toggle" type="button" aria-expanded="false">Qwen3-ASR 1.7B int8<span>⌄</span></button>
        </div>
      </label>

      <label class="choice live-power-saving">
        <input type="checkbox" />
        <span><b>省电模式</b><small>关闭实时降噪和精修，降低字幕更新频率；会后精修保持可用。</small></span>
      </label>
    </section>
  `;
};

// The real notes editor toolbar (1:1 with createNotesEditor in frontend/ui-components.js).
// Buttons: bold, italic, h1–h3, ul/ol (SVG), quote, link, image, code, todo, highlight, mode-toggle.
DemoScenariosV3.prototype.notesToolbarHtml = function () {
  const ul = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M7 4h6M7 8h6M7 12h6"/></svg>';
  const ol = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="1.5" y="5" font-size="6.5" fill="currentColor" stroke="none">1</text><text x="1.5" y="9.5" font-size="6.5" fill="currentColor" stroke="none">2</text><text x="1.5" y="14" font-size="6.5" fill="currentColor" stroke="none">3</text><path d="M7 4h6M7 8.5h6M7 13h6"/></svg>';
  const link = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6.2 9.8 3.6-3.6" /><path d="M7.2 11.4 5.6 13a2.6 2.6 0 0 1-3.6-3.6l1.6-1.6a2.6 2.6 0 0 1 3.6 0" /><path d="M8.8 4.6l1.6-1.6a2.6 2.6 0 0 1 3.6 3.6l-1.6 1.6a2.6 2.6 0 0 1-3.6 0" /></svg>';
  const image = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><circle cx="5.5" cy="6.2" r="1.4" /><path d="m1.5 11 3.6-3.6L11 12.8" /></svg>';
  const mode = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3h9M8 3v10"/></svg>';
  const btns = [
    ['bold', '加粗', '<b>B</b>'],
    ['italic', '斜体', '<i>I</i>'],
    ['h1', '标题 1', 'H1'],
    ['h2', '标题 2', 'H2'],
    ['h3', '标题 3', 'H3'],
    ['ul', '列表', ul],
    ['ol', '编号列表', ol],
    ['quote', '引用', '❝'],
    ['link', '插入链接', link],
    ['image', '插入图片', image],
    ['code', '行内代码', '&lt;/&gt;'],
    ['todo', '待办', '☐'],
    ['highlight', '重点', '★'],
    ['mode-toggle', '富文本', mode]
  ];
  return '<div class="notes-toolbar">' + btns.map(([command, label, html]) => `<button type="button" data-notes-command="${command}" title="${label}" aria-label="${label}">${html}</button>`).join('') + '</div>';
};

DemoScenariosV3.prototype.setupLiveUI = function(meetingTitle) {
  // 精确还原新版实时会议页面：左侧「我的笔记」（AI 辅助开关 + 编辑器），右侧「实时字幕」。
  const notesToolbar = this.notesToolbarHtml();
  const html = String.raw`
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
          <span>正在录制</span>
          <div class="window-actions">
            <button class="icon-button">文</button>
            <button class="icon-button">◐</button>
          </div>
        </header>

        <section class="view active" id="live-view">
          <header class="live-header">
            <div class="live-title">
              <strong>${meetingTitle}</strong>
              <div class="live-status">
                <span class="recording"><i></i> 正在录制</span>
                <time data-demo-id="timer">00:00:00</time>
                <span class="save-state"><svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg> <span>已保存</span></span>
              </div>
            </div>
            <div class="live-caption-controls">
              <button class="floating-caption-toggle" data-demo-id="caption-toggle" data-enabled="false" type="button" title="悬浮字幕">字幕</button>
              <button class="translation-toggle" data-demo-id="translation-toggle" data-enabled="false" type="button">译文: 关</button>
            </div>
            <button class="pause-button">Ⅱ 暂停</button>
            <button class="end-button">结束会议</button>
          </header>

          <div class="live-layout">
            <section class="live-notes">
              <header class="live-section-head">
                <p class="eyebrow">我的笔记</p>
                <button class="ai-assist-toggle" type="button"><span class="ai-assist-toggle-star">✦</span> <span>AI 辅助</span></button>
                <button class="live-mode-toggle" data-toggle-live-mode="caption" type="button"><span>展开字幕</span> →</button>
              </header>
              <div data-live-notes-root>
                <div class="ai-assist-empty">
                  <div class="ai-assist-empty-inner">
                    <strong>开始记录会议重点</strong>
                    <p>你可以直接输入，也可以从右侧实时字幕中将重要内容加入笔记。</p>
                    <div class="ai-assist-empty-tags">
                      <button type="button">插入当前字幕</button>
                      <button type="button">记录当前时间点</button>
                    </div>
                  </div>
                </div>
                ${notesToolbar}
                <div class="notes-editor" data-demo-id="notes-editor" contenteditable="false" aria-label="我的笔记" spellcheck="false"></div>
                <textarea class="notes-input" hidden></textarea>
              </div>
            </section>

            <section class="live-captions">
              <header class="live-section-head">
                <p class="eyebrow">实时字幕</p>
                <button class="live-mode-toggle" data-toggle-live-mode="notes" type="button"><span>返回笔记</span> ←</button>
              </header>
              <div class="transcript-scroll" data-demo-id="transcript-scroll"></div>
              <button class="back-to-latest" type="button" hidden><span>↓</span> <span>回到最新</span></button>
            </section>
          </div>
        </section>
      </section>
    </main>
  `;
  return html;
};

// State management methods — shared fade-swap helper
DemoScenariosV3.prototype._fadeSwapContent = function(newHtml, callback) {
  const content = document.getElementById('demo-content');
  if (!content) return;

  content.style.transition = 'opacity 0.2s ease';
  content.style.opacity = '0';

  setTimeout(() => {
    content.innerHTML = newHtml;

    // Re-apply scale
    const viewport = document.getElementById('demo-viewport');
    const appShell = content.querySelector('.app-shell');
    if (appShell && viewport) {
      const designWidth = 1200;
      const designHeight = 750;
      const rect = viewport.getBoundingClientRect();
      const scale = Math.min(rect.width / designWidth, rect.height / designHeight, 1);
      appShell.style.transform = `scale(${scale})`;
      appShell.style.transformOrigin = 'top left';
    }

    if (callback) callback();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        content.style.opacity = '1';
        setTimeout(() => { content.style.transition = ''; }, 300);
      });
    });
  }, 200);
};

DemoScenariosV3.prototype.showPrepareView = function() {
  this._fadeSwapContent(this.setupPrepareUI());
};

DemoScenariosV3.prototype.fillMeetingTitle = function(title) {
  const input = this.engine.viewport.querySelector('[data-demo-id="meeting-title"]');
  if (input) {
    input.value = title;
    input.focus({ preventScroll: true });
  }
};

DemoScenariosV3.prototype.showLiveView = function(meetingTitle) {
  this._fadeSwapContent(this.setupLiveUI(meetingTitle), () => {
    this.startTimer();
  });
};

DemoScenariosV3.prototype.startTimer = function() {
  const timerEl = this.engine.viewport.querySelector('[data-demo-id="timer"]');
  if (!timerEl) return;

  let seconds = 0;
  const interval = setInterval(() => {
    if (this.engine.isPaused || !this.timeline.isRunning) {
      clearInterval(interval);
      return;
    }

    seconds++;
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);
};

DemoScenariosV3.prototype.enableTranslation = function() {
  // Enable translation toggle button
  const translationToggle = this.engine.viewport.querySelector('[data-demo-id="translation-toggle"]');
  if (translationToggle) {
    translationToggle.setAttribute('data-enabled', 'true');
  }

  // Show translations on existing segments
  const segments = this.engine.viewport.querySelectorAll('.segment[data-translation]');
  segments.forEach(seg => {
    const translation = seg.getAttribute('data-translation');
    const translationEl = seg.querySelector('.translation');
    if (translationEl && translation) {
      translationEl.textContent = translation;
      translationEl.style.display = 'block';
    }
  });
};

DemoScenariosV3.prototype.updateLiveCaption = function(text, translation) {
  // Caption elements removed - this method is now a no-op
  // Kept for compatibility with existing demo step sequences
};

DemoScenariosV3.prototype.getParticipantSourceLabel = function() {
  return '麦克风';
};

DemoScenariosV3.prototype.updateParticipantList = function(speakers) {
  const participantsList = this.engine.viewport.querySelector('[data-demo-id="participants-list"]');
  if (!participantsList) return;

  // Remove empty message
  const emptyMsg = participantsList.querySelector('.participants-empty');
  if (emptyMsg) emptyMsg.remove();

  // Update participant count on the participants eyebrow (real app: "参与者 · N")
  const eyebrow = this.engine.viewport.querySelector('[data-demo-id="participants-eyebrow"]');
  if (eyebrow) eyebrow.textContent = `${this.getParticipantsLabel()} · ${speakers.length}`;

  const avatarTones = ['blue', 'gray'];
  const source = this.getParticipantSourceLabel();

  // Add participants using the real .person markup
  speakers.forEach((speaker, index) => {
    const existing = Array.from(participantsList.querySelectorAll('.person b')).find(b => b.textContent === speaker);
    if (!existing) {
      const initial = speaker.trim().charAt(0).toUpperCase();
      const tone = avatarTones[index % avatarTones.length];
      const person = document.createElement('div');
      person.className = 'person';
      person.innerHTML = `<span class="avatar ${tone}">${initial}</span><div><b>${speaker}</b><small>${source}</small></div><i class="level"></i>`;
      participantsList.appendChild(person);
    }
  });
};

DemoScenariosV3.prototype.getParticipantsLabel = function() {
  return '参与者';
};

DemoScenariosV3.prototype.generateLiveSegmentSteps = function(segments, start, end, withTranslation = false) {
  const steps = [];
  const uniqueSpeakers = new Set();

  for (let i = start; i < end && i < segments.length; i++) {
    const segment = segments[i];
    uniqueSpeakers.add(segment.speaker);
    // Snapshot the speakers known so far, so each step reveals only the
    // participants seen up to this segment (the Set keeps growing while steps
    // are built, so capturing it by reference would fill the panel at once).
    const speakersSoFar = Array.from(uniqueSpeakers);

    // Append this segment to the transcript.
    steps.push({
      action: 'appendSegment',
      target: '[data-demo-id="transcript-scroll"]',
      html: this.createSegmentHTML(segment, withTranslation),
      duration: 300,
      delay: 200
    });

    // Reveal the speaker in the participants panel in the same beat as their
    // transcript line, so the two stay in sync.
    steps.push({
      action: 'setState',
      handler: () => this.updateParticipantList(speakersSoFar),
      delay: 100
    });

    // Scroll to bottom
    steps.push({
      action: 'scrollToBottom',
      target: '[data-demo-id="transcript-scroll"]',
      duration: 400,
      delay: 100
    });

    // Wait before next segment
    steps.push({
      action: 'wait',
      duration: 1200
    });
  }

  return steps;
};

DemoScenariosV3.prototype.createSegmentHTML = function(segment, withTranslation = false) {
  let html = `
    <div class="segment" data-translation="${segment.translation || ''}" style="padding: 16px 0;">
      <div class="segment-meta" style="gap: 4px;">
        <time>${segment.time}</time>
        <b>${segment.speaker}</b>
      </div>
      <div class="segment-copy">
        <p style="font-size: 18px; line-height: 1.8; margin: 0;">${segment.text}</p>
  `;

  if (segment.translation) {
    const display = withTranslation ? 'block' : 'none';
    html += `<p class="translation" style="display: ${display}; margin-top: 8px; font-size: 14px; color: gray;">${segment.translation}</p>`;
  }

  html += `
      </div>
    </div>
  `;

  return html;
};

// Summary demo UI setup
DemoScenariosV3.prototype.setupSummaryUI = function() {
  // 显示主页，准备点击会议进入详情
  return this.setupHomeUI();
};

DemoScenariosV3.prototype.showSummaryDetail = function() {
  const html = String.raw`
    <main class="app-shell">
      <aside class="sidebar">
        <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="brevia" /></button>
        <button class="new-meeting"><span>+</span> 开始会议</button>
        <nav>
          <button class="nav-item active"><span>⌂</span> 所有会议</button>
          <button class="nav-item"><span>◷</span> 最近删除</button>
          <button class="nav-item"><span>⚙</span> 设置</button>
        </nav>
      </aside>

      <section class="workspace">
        <header class="window-bar">
          <div class="traffic"><i></i><i></i><i></i></div>
          <span>会议详情</span>
          <div class="window-actions">
            <button class="icon-button">◐</button>
          </div>
        </header>

        <section class="view active" id="detail-view">
          <button class="back">← 返回会议库</button>
          <header class="detail-head">
            <div class="detail-title">
              <p class="eyebrow">本地会议</p>
              <h1>Q3 产品评审会议</h1>
              <p class="detail-meta">2026年8月7日 · 45 分钟 · 3 位参与者 · 已生成纪要</p>
            </div>
            <div class="detail-actions">
              <button class="secondary">分享</button>
              <button class="primary-action">导出 <span>↓</span></button>
            </div>
          </header>

          <section class="player">
            <button class="play">▶</button>
            <button class="skip">↶ 15</button>
            <button class="skip">15 ↷</button>
            <span class="player-time">18:32</span>
            <input type="range" min="0" max="100" value="42" />
            <span>本地录音</span>
            <div class="player-speed flow-select">
              <button class="flow-select-toggle" type="button">1×<span>⌄</span></button>
            </div>
          </section>

          <div class="detail-layout">
            <section class="final-transcript">
              <div class="tabbar">
                <div class="tabbar-tabs">
                  <button class="tab active" data-detail-tab="notes">我的笔记</button>
                  <button class="tab" data-detail-tab="transcript">字幕</button>
                </div>
                <div class="tabbar-extra">
                  <span class="refine-state is-done"><svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg> 已精修</span>
                  <button class="refine-more" type="button" aria-label="更多">···</button>
                </div>
              </div>

              <div class="detail-notes-panel" data-detail-panel="notes">
                <div class="detail-notes-view">
                  <div class="detail-notes-content markdown-content">
                    <h2>本周重点</h2>
                    <ul>
                      <li>移动端验收：本周完成</li>
                      <li>测试版本：周五前提交</li>
                      <li>转录延迟优化至 300ms 以内</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div class="transcript-panel" data-detail-panel="transcript" hidden>
                <div class="transcript-body">
                  <article class="segment">
                    <div class="segment-meta">
                      <time>01:39</time>
                      <button class="segment-speaker">李娜</button>
                    </div>
                    <div class="segment-copy">
                      <p>先同步一下工程进度，实时转录引擎的性能优化基本完成了，延迟从原来的八百毫秒降到了三百毫秒以内。</p>
                    </div>
                  </article>

                  <article class="segment">
                    <div class="segment-meta">
                      <time>01:54</time>
                      <button class="segment-speaker">张伟</button>
                    </div>
                    <div class="segment-copy">
                      <p>很好。多语言支持这块进展怎么样？我们这次要覆盖多少种语言？</p>
                    </div>
                  </article>

                  <article class="segment">
                    <div class="segment-meta">
                      <time>02:01</time>
                      <button class="segment-speaker">李娜</button>
                    </div>
                    <div class="segment-copy">
                      <p>目前已经支持三十多种语言，主流语种的识别准确率都在百分之九十五以上。</p>
                    </div>
                  </article>
                </div>
              </div>
            </section>

            <aside class="notes">
              <div class="summary-preview">
                <div class="summary-head">
                  <p class="eyebrow">会议纪要</p>
                  <button class="text-button">重新生成</button>
                </div>
                <div class="summary-body markdown-content">
                  <h2>摘要</h2>
                  <p>本次会议评审了第三季度的产品进展，重点包括实时转录引擎的性能优化、多语言支持的扩展以及新版界面的设计方向。</p>
                  <h2>核心结论</h2>
                  <ul>
                    <li>实时转录延迟优化至 300 毫秒以内</li>
                    <li>多语言支持已覆盖 30+ 语种</li>
                    <li>新版界面将于本季度末发布</li>
                  </ul>
                  <h2>行动项</h2>
                  <ul>
                    <li>完成实时转录引擎的性能压测 <small>李娜 · 8月20日</small></li>
                    <li>制定发布前的灰度测试方案 <small>张伟 · 8月22日</small></li>
                  </ul>
                </div>
                <button class="text-button" data-demo-id="view-full-summary" style="margin-top: 12px;">查看完整内容 →</button>
              </div>
            </aside>
          </div>
        </section>
      </section>
    </main>
  `;
  this._fadeSwapContent(html);
};

DemoScenariosV3.prototype.openSummaryModal = function() {
  const shell = this.engine.viewport.querySelector('.app-shell');
  if (!shell) return;

  // 移除已有弹窗
  const existing = shell.querySelector('.summary-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'summary-modal-overlay';
  overlay.style.cssText = 'position: absolute; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; opacity: 0; transition: opacity 0.3s ease;';

  overlay.innerHTML = String.raw`
    <div class="summary-modal" style="width: 760px; max-width: 90%; max-height: 82%; background: #fff; border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; transform: scale(0.96); transition: transform 0.3s ease;">
      <header style="display: flex; align-items: center; justify-content: space-between; padding: 20px 28px; border-bottom: 1px solid #eee; flex-shrink: 0;">
        <div>
          <h1 style="font-size: 20px; font-weight: 600; margin: 0;">Q3 产品评审会议</h1>
          <p style="color: #999; font-size: 13px; margin: 4px 0 0;">2026年8月7日 · 45分钟 · AI 会议纪要</p>
        </div>
        <button class="icon-button" style="font-size: 18px;">✕</button>
      </header>

      <div class="summary-modal-body" data-demo-id="summary-modal-body" style="padding: 28px; overflow-y: auto; line-height: 1.8; color: #404040;">
        <section style="margin-bottom: 32px;">
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">会议摘要</h2>
          <p style="font-size: 15px; margin: 0;">
            本次会议评审了第三季度的产品进展，重点包括实时转录引擎的性能优化、多语言支持的扩展以及新版界面的设计方向。实时转录延迟已优化至 300 毫秒以内，多语言支持覆盖 30 多种语种，主流语言识别准确率超过 95%。团队确认了新版界面将于本季度末发布，并明确了发布前的测试计划和责任分工。
          </p>
        </section>

        <section style="margin-bottom: 32px;">
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">核心结论</h2>
          <ul style="font-size: 15px; padding-left: 24px; margin: 0;">
            <li style="margin-bottom: 12px;">实时转录引擎性能优化完成，端到端延迟从 800ms 降至 300ms 以内</li>
            <li style="margin-bottom: 12px;">多语言支持已覆盖 30+ 语种，主流语言识别准确率超过 95%</li>
            <li style="margin-bottom: 12px;">新版用户界面确定于本季度末（9 月）正式发布</li>
            <li style="margin-bottom: 12px;">发布前需完成一轮完整的性能与兼容性测试</li>
          </ul>
        </section>

        <section style="margin-bottom: 32px;">
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">关键决策</h2>
          <ul style="font-size: 15px; padding-left: 24px; margin: 0;">
            <li style="margin-bottom: 12px;"><b>性能优先：</b>转录延迟作为本季度核心指标，持续跟进并保持在 300ms 以内 <small style="color: #999;">— 李娜</small></li>
            <li style="margin-bottom: 12px;"><b>多语言策略：</b>优先保障主流语种的准确率，长尾语种逐步迭代 <small style="color: #999;">— 张伟</small></li>
            <li style="margin-bottom: 12px;"><b>界面改版：</b>新版界面需与现有功能保持兼容，分阶段灰度发布</li>
          </ul>
        </section>

        <section style="margin-bottom: 32px;">
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">行动项</h2>
          <ul style="font-size: 15px; padding-left: 24px; margin: 0;">
            <li style="margin-bottom: 12px;">完成实时转录引擎的性能压测 <small style="color: #999;">负责人：李娜 · 截止：8月20日</small></li>
            <li style="margin-bottom: 12px;">补充长尾语种的测试语料 <small style="color: #999;">负责人：王强 · 截止：8月25日</small></li>
            <li style="margin-bottom: 12px;">完成新版界面的高保真原型 <small style="color: #999;">负责人：设计团队 · 截止：8月18日</small></li>
            <li style="margin-bottom: 12px;">制定发布前的灰度测试方案 <small style="color: #999;">负责人：张伟 · 截止：8月22日</small></li>
          </ul>
        </section>

        <section style="margin-bottom: 32px;">
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">风险与挑战</h2>
          <ul style="font-size: 15px; padding-left: 24px; margin: 0;">
            <li style="margin-bottom: 12px;">多语言模型的内存占用可能影响低配设备的性能</li>
            <li style="margin-bottom: 12px;">新版界面改版需要与现有功能保持兼容</li>
            <li style="margin-bottom: 12px;">发布时间较紧，测试周期需要额外的资源支持</li>
          </ul>
        </section>

        <section>
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">下次会议</h2>
          <p style="font-size: 15px; margin: 0;">
            2026年8月14日下午2点，继续跟进各项行动项的进展与发布前准备情况。
          </p>
        </section>
      </div>
    </div>
  `;

  shell.appendChild(overlay);

  // 触发过渡动画
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    const modal = overlay.querySelector('.summary-modal');
    if (modal) modal.style.transform = 'scale(1)';
  });
};

// Voiceprint demo UI setup
DemoScenariosV3.prototype.setupVoiceprintUI = function() {
  // 声纹演示：切换到字幕模式（点击「展开字幕」一次后）——实时字幕在左（宽），笔记在右（窄）。
  const notesToolbar = this.notesToolbarHtml();
  const html = String.raw`
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
          <span>正在录制</span>
          <div class="window-actions">
            <button class="icon-button">文</button>
            <button class="icon-button">◐</button>
          </div>
        </header>

        <section class="view active" id="live-view">
          <header class="live-header">
            <div class="live-title">
              <strong>团队周会</strong>
              <div class="live-status">
                <span class="recording"><i></i> 正在录制</span>
                <time data-demo-id="timer">00:15:23</time>
                <span class="save-state"><svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 4.5" /></svg> <span>已保存</span></span>
              </div>
            </div>
            <div class="live-caption-controls">
              <button class="floating-caption-toggle" data-enabled="false" type="button" title="悬浮字幕">字幕</button>
              <button class="translation-toggle" data-enabled="false" type="button">译文: 关</button>
            </div>
            <button class="pause-button">Ⅱ 暂停</button>
            <button class="end-button">结束会议</button>
          </header>

          <div class="live-layout is-caption-mode">
            <section class="live-notes">
              <header class="live-section-head">
                <p class="eyebrow">我的笔记</p>
                <button class="ai-assist-toggle is-enabled" type="button"><span class="ai-assist-toggle-star">✦</span> <span>AI 辅助</span></button>
                <button class="live-mode-toggle" data-toggle-live-mode="caption" type="button"><span>展开字幕</span> →</button>
              </header>
              <div data-live-notes-root>
                <div class="ai-assist-empty">
                  <div class="ai-assist-empty-inner">
                    <strong>开始记录吧</strong>
                    <p>AI 会自动发现关键结论、待办和重要信息。</p>
                    <div class="ai-assist-empty-tags">
                      <span>记录重点</span>
                      <span>自动整理</span>
                      <span>关联工作区</span>
                    </div>
                  </div>
                </div>
                ${notesToolbar}
                <div class="notes-editor" data-demo-id="notes-editor" contenteditable="false" aria-label="我的笔记" spellcheck="false"></div>
                <textarea class="notes-input" hidden></textarea>
              </div>
            </section>

            <section class="live-captions">
              <header class="live-section-head">
                <p class="eyebrow">实时字幕</p>
                <button class="live-mode-toggle" data-toggle-live-mode="notes" type="button"><span>返回笔记</span> ←</button>
              </header>
              <div class="transcript-scroll" id="transcript-scroll"></div>
              <button class="back-to-latest" type="button" hidden><span>↓</span> <span>回到最新</span></button>
            </section>
          </div>
        </section>
      </section>
    </main>
  `;
  return html;
};

DemoScenariosV3.prototype.generateVoiceprintSegmentSteps = function(segments) {
  const steps = [];
  const speakers = new Set();

  segments.forEach((segment, index) => {
    const segId = `vp-seg-${index}`;

    // 新建段落，说话人先显示为临时的"说话人 N"
    steps.push({
      action: 'setState',
      handler: () => {
        const scroll = this.engine.viewport.querySelector('#transcript-scroll');
        if (!scroll) return;

        const prevActive = scroll.querySelector('.segment.is-active');
        if (prevActive) prevActive.classList.remove('is-active');

        const segmentEl = document.createElement('article');
        segmentEl.className = 'segment is-active';
        segmentEl.innerHTML = `
          <div class="segment-meta">
            <time>${segment.time}</time>
            <b class="speaker-name provisional" data-demo-id="${segId}-speaker">${segment.provisional}</b>
          </div>
          <div class="segment-copy">
            <p data-demo-id="${segId}-text"></p>
          </div>
        `;
        scroll.appendChild(segmentEl);
        scroll.scrollTop = scroll.scrollHeight;
      },
      delay: 200
    });

    // 逐字打出字幕（段落文本）
    steps.push({
      action: 'setState',
      handler: async () => {
        const segText = this.engine.viewport.querySelector(`[data-demo-id="${segId}-text"]`);
        const scroll = this.engine.viewport.querySelector('#transcript-scroll');
        const chars = segment.text.split('');

        if (segText) segText.textContent = '';

        for (let i = 0; i < chars.length; i++) {
          if (this.engine.isPaused) {
            await this.engine.wait(100);
            i--;
            continue;
          }
          const ch = chars[i];
          if (segText) segText.textContent += ch;
          if (scroll) scroll.scrollTop = scroll.scrollHeight;
          await this.engine.wait(60);
        }
      },
      delay: 100
    });

    // 短暂停顿后，声纹识别完成：切换到真实说话人并放大高亮
    steps.push({ action: 'wait', duration: 700 });

    steps.push({
      action: 'setState',
      handler: () => {
        speakers.add(segment.speaker);
        const speakerEl = this.engine.viewport.querySelector(`[data-demo-id="${segId}-speaker"]`);
        if (speakerEl) {
          speakerEl.textContent = segment.speaker;
          speakerEl.classList.remove('provisional');
          speakerEl.classList.add('resolving');
          setTimeout(() => speakerEl.classList.remove('resolving'), 600);
        }
        this.updateVoiceprintParticipants(Array.from(speakers));
      },
      delay: 100
    });

    steps.push({ action: 'wait', duration: 1400 });
  });

  return steps;
};

DemoScenariosV3.prototype.getVoiceprintRoles = function() {
  return ['项目经理', '前端工程师', '后端工程师', '设计师'];
};

DemoScenariosV3.prototype.updateVoiceprintParticipants = function(speakers) {
  const list = this.engine.viewport.querySelector('[data-demo-id="voiceprint-participants"]');
  if (!list) return;

  const colors = ['blue', 'gray'];
  const roles = this.getVoiceprintRoles();

  // Update the participant count eyebrow (real app: "参与者 · N")
  const eyebrow = this.engine.viewport.querySelector('[data-demo-id="voiceprint-eyebrow"]');
  if (eyebrow) eyebrow.textContent = `${this.getParticipantsLabel()} · ${speakers.length}`;

  // Use the real .person markup: avatar + name/role + level meter.
  list.innerHTML = speakers.map((speaker, index) => {
    const initial = speaker.trim().charAt(0);
    const color = colors[index % colors.length];
    const role = roles[index % roles.length];
    return `<div class="person"><span class="avatar ${color}">${initial}</span><div><b>${speaker}</b><small>${role}</small></div><i class="level"></i></div>`;
  }).join('');
};

// ============================================================================
// Model Library demo — real settings view + real model-library modal
// ============================================================================

// Localizable copy for the settings view. EN patch overrides this wholesale.
DemoScenariosV3.prototype.getSettingsCopy = function () {
  return {
    crumb: '设置',
    back: '← 返回会议库',
    eyebrow: '设置',
    h1: '模型与本地数据',
    cards: [
      { id: 'manage-models', title: '模型库', desc: '管理语言识别模型的下载、删除与版本信息。', button: '管理模型库' },
      { id: 'terms', title: '术语库', desc: '12 个词条可用于会议准备、搜索和纪要。仅支持的模型会将其用于转写。', button: '管理术语库' },
      { id: 'storage', title: '存储与隐私', desc: '会议资料保存在此设备。外部 LLM 需要在发送逐字稿前明确确认。', button: '查看本地存储' },
      { id: 'speaker', title: '说话人识别', desc: '仅保存用户明确提交的单人语音，用于会议片段的说话人识别与命名。', button: '管理说话人' }
    ]
  };
};

// Real model-library data. EN patch overrides this wholesale so we never rely
// on fragile substring translation for single-character tier words like 高/快.
DemoScenariosV3.prototype.getModelLibraryData = function () {
  return {
    title: '模型库',
    intro: '所有转写模型都在本地运行，不会将您的隐私上传到网络。',
    qualityLabel: '质量',
    speedLabel: '速度',
    qualityTiers: ['标准', '高', '极高'],
    speedTiers: ['较慢', '均衡', '快'],
    downloadLabel: '下载',
    installedLabel: '已安装',
    items: [
      { stage: '实时字幕', name: 'Streaming Zipformer Chinese XLarge', language: '中文 / 英语 / 粤语', intro: '原生流式识别，持续更新当前字幕。', quality: 3, speed: 1, installed: true, size: '1.1 GB' },
      { stage: '实时字幕', name: 'Streaming Zipformer English', language: '英语', intro: '英语原生流式识别。', quality: 2, speed: 3, installed: false, size: '520 MB' },
      { stage: '标点恢复', name: 'English Punctuation and Casing', language: '英语', intro: '恢复英文标点与大小写。', quality: 1, speed: 3, installed: false, size: '280 MB' },
      { stage: '标点恢复', name: '中英文标点恢复', language: '中文 / 英语 / 粤语', intro: '为实时字幕补全逗号、句号和问号。', quality: 2, speed: 3, installed: true, size: '290 MB' },
      { stage: '会后精修', name: 'Qwen3-ASR', language: '多语种', intro: '基于完整录音生成高精度修订版本。', quality: 2, speed: 3, installed: false, size: '1.9 GB' },
      { stage: '说话人分离', name: 'Pyannote Segmentation 3.0', language: '语言无关', intro: '检测单轨录音中的说话区间。', quality: 2, speed: 3, installed: true, size: '90 MB' },
      { stage: '说话人分离', name: '3D-Speaker ERes2Net Base', language: '中文', intro: '提取声纹并离线聚类说话人。', quality: 2, speed: 3, installed: false, size: '210 MB' }
    ]
  };
};
DemoScenariosV3.prototype.setupSettingsUI = function () {
  const copy = this.getSettingsCopy();
  const cards = copy.cards.map((card, index) => String.raw`
    <section class="settings-card"${index === 0 ? ' data-demo-id="model-library-card"' : ''}>
      <h2>${card.title}</h2>
      <p>${card.desc}</p>
      <button class="secondary" type="button"${index === 0 ? ' data-demo-id="manage-models-btn"' : ''}>${card.button}</button>
    </section>
  `).join('');

  return String.raw`
    <main class="app-shell">
      <aside class="sidebar">
        <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="brevia" /></button>
        <button class="new-meeting"><span>+</span> 开始会议</button>
        <nav>
          <button class="nav-item"><span>⌂</span> 所有会议</button>
          <button class="nav-item"><span>◷</span> 最近删除</button>
          <button class="nav-item active"><span>⚙</span> 设置</button>
        </nav>
      </aside>

      <section class="workspace">
        <header class="window-bar">
          <div class="traffic"><i></i><i></i><i></i></div>
          <span>${copy.crumb}</span>
          <div class="window-actions">
            <button class="icon-button">文</button>
            <button class="icon-button">◐</button>
          </div>
        </header>

        <section class="view active" id="settings-view">
          <button class="back">${copy.back}</button>
          <p class="eyebrow">${copy.eyebrow}</p>
          <h1>${copy.h1}</h1>
          <div class="settings-grid">${cards}</div>
        </section>
      </section>
    </main>
  `;
};

// Build the real .model-library-item card markup, grouped by <h3> stage.
DemoScenariosV3.prototype.renderModelLibraryItems = function () {
  const data = this.getModelLibraryData();
  let lastStage = null;
  return data.items.map((item) => {
    const heading = item.stage !== lastStage ? `<h3>${item.stage}</h3>` : '';
    lastStage = item.stage;
    const dots = (level) => [1, 2, 3].map((step) => `<i${step <= level ? ' class="on"' : ''}></i>`).join('');
    const ratings = String.raw`
      <div class="model-library-ratings">
        <span class="model-library-rating"><small>${data.qualityLabel}</small><b>${data.qualityTiers[item.quality - 1]}</b><span class="rating-scale" aria-hidden="true">${dots(item.quality)}</span></span>
        <span class="model-library-rating"><small>${data.speedLabel}</small><b>${data.speedTiers[item.speed - 1]}</b><span class="rating-scale" aria-hidden="true">${dots(item.speed)}</span></span>
      </div>`;
    const tags = String.raw`<div class="model-library-tags">${item.installed ? `<span class="model-library-installed">${data.installedLabel}</span>` : ''}<span>${item.language}</span><span class="model-library-size">${item.size}</span><span class="model-library-modelname">${item.name}</span></div>`;
    const action = item.installed
      ? `<button class="modal-action modal-danger" type="button">删除</button>`
      : `<button class="modal-action" type="button">${data.downloadLabel}</button>`;
    return String.raw`
      ${heading}
      <div class="model-library-item">
        <span>
          <div class="model-library-name"><b class="model-library-headline">${item.language}</b>${tags}</div>
          ${ratings}
          <p>${item.intro}</p>
        </span>
        <span class="model-actions">${action}</span>
      </div>`;
  }).join('');
};

DemoScenariosV3.prototype.openModelLibraryModal = function () {
  const shell = this.engine.viewport.querySelector('.app-shell');
  if (!shell) return;

  const existing = shell.querySelector('.modal-backdrop');
  if (existing) existing.remove();

  const data = this.getModelLibraryData();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop modal-enter';
  backdrop.innerHTML = String.raw`
    <section class="modal-panel" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div class="modal-title">
          <h2>${data.title}</h2>
          <p>${data.intro}</p>
        </div>
        <button class="modal-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="modal-body" data-demo-id="model-library-body">
        <div class="modal-list model-library-list">${this.renderModelLibraryItems()}</div>
      </div>
    </section>
  `;
  shell.appendChild(backdrop);
};

DemoScenariosV3.prototype.getModelLibraryDemo = function () {
    return {
      name: 'model-library',
      setupUI: () => this.setupSettingsUI(),
      steps: [
        { action: 'wait', duration: 900 },
        { action: 'moveCursor', target: '[data-demo-id="manage-models-btn"]', duration: 1200, delay: 400 },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },
        { action: 'setState', handler: () => this.openModelLibraryModal(), delay: 300 },
        { action: 'wait', duration: 1400 },
        { action: 'moveCursor', target: '[data-demo-id="model-library-body"] .model-library-item:first-child .model-actions button', duration: 900, delay: 300 },
        { action: 'wait', duration: 900 },
        { action: 'scrollToBottom', target: '[data-demo-id="model-library-body"]', duration: 5000, delay: 200 },
        { action: 'wait', duration: 2200 }
      ]
    };
  };
// ============================================================================
// Floating Caption Bar demo — real live view + real floating-caption overlay
// ============================================================================

// Caption script: each line finalizes the previous line, streams a new live
// line, then reveals its translation. EN patch overrides this wholesale.
DemoScenariosV3.prototype.getCaptionData = function () {
  return {
    meetingTitle: '产品评审会议',
    lines: [
      { text: '我们先过一下这个季度的整体进展。', translation: "Let's start by reviewing the overall progress this quarter." },
      { text: '实时转录的延迟已经优化到三百毫秒以内。', translation: 'Live transcription latency is now under 300 milliseconds.' },
      { text: '多语言支持这块也覆盖了三十多种语言。', translation: 'Multilingual support now covers more than 30 languages.' }
    ]
  };
};

DemoScenariosV3.prototype.getCaptionTranscript = function () {
  return [
    { time: '00:00:12', speaker: '主持人', text: '欢迎大家参加这次产品评审，我们按议程开始。' },
    { time: '00:00:24', speaker: '李娜', text: '好的，我先同步一下这个季度的整体情况。' }
  ];
};

DemoScenariosV3.prototype.setupCaptionUI = function () {
  const { meetingTitle } = this.getCaptionData();
  // Reuse the real live view, then overlay the real floating-caption component.
  let liveHtml = this.setupLiveUI(meetingTitle);

  // Pre-populate the transcript so the live view reads as an active meeting.
  const transcript = this.getCaptionTranscript().map((segment) => String.raw`
    <div class="segment" style="padding: 16px 0;">
      <div class="segment-meta" style="gap: 4px;"><time>${segment.time}</time><b>${segment.speaker}</b></div>
      <div class="segment-copy"><p style="font-size: 18px; line-height: 1.8; margin: 0;">${segment.text}</p></div>
    </div>
  `).join('');
  liveHtml = liveHtml.replace(
    '<div class="transcript-scroll" data-demo-id="transcript-scroll"></div>',
    `<div class="transcript-scroll" data-demo-id="transcript-scroll">${transcript}</div>`
  );

  const overlay = String.raw`
    <div class="demo-caption-overlay" data-demo-id="caption-overlay">
      <div class="caption-shell">
        <div class="caption-controls">
          <button class="close-btn" type="button" title="关闭" aria-label="关闭">×</button>
        </div>
        <div class="caption-container">
          <div class="caption-finalized hidden" data-demo-id="caption-finalized"></div>
          <div class="caption-text" data-demo-id="caption-text"></div>
          <div class="caption-translation hidden" data-demo-id="caption-translation"></div>
        </div>
      </div>
    </div>
  `;
  // Inject the overlay just before the closing </main> so it scales with the shell.
  return liveHtml.replace('</main>', `${overlay}</main>`);
};

DemoScenariosV3.prototype.generateCaptionSteps = function () {
  const { lines } = this.getCaptionData();
  const steps = [];

  lines.forEach((line, index) => {
    // Finalize the previous live line into the dimmed history row.
    if (index > 0) {
      const prev = lines[index - 1];
      steps.push({
        action: 'setState',
        handler: () => {
          const finalized = this.engine.viewport.querySelector('[data-demo-id="caption-finalized"]');
          const translation = this.engine.viewport.querySelector('[data-demo-id="caption-translation"]');
          const text = this.engine.viewport.querySelector('[data-demo-id="caption-text"]');
          if (finalized) {
            finalized.textContent = prev.text;
            finalized.classList.remove('hidden');
          }
          if (translation) { translation.textContent = ''; translation.classList.add('hidden'); }
          if (text) text.textContent = '';
        },
        delay: 100
      });
    }

    // Stream the live caption character by character.
    steps.push({
      action: 'setState',
      handler: async () => {
        const text = this.engine.viewport.querySelector('[data-demo-id="caption-text"]');
        if (!text) return;
        text.textContent = '';
        const chars = line.text.split('');
        for (let i = 0; i < chars.length; i++) {
          if (this.engine.isPaused) { await this.engine.wait(100); i--; continue; }
          text.textContent += chars[i];
          await this.engine.wait(55);
        }
      },
      delay: 200
    });

    steps.push({ action: 'wait', duration: 500 });

    // Reveal the translation line beneath the live caption.
    steps.push({
      action: 'setState',
      handler: () => {
        const translation = this.engine.viewport.querySelector('[data-demo-id="caption-translation"]');
        if (translation) {
          translation.textContent = line.translation;
          translation.classList.remove('hidden');
        }
      },
      delay: 100
    });

    steps.push({ action: 'wait', duration: 1600 });
  });

  return steps;
};

DemoScenariosV3.prototype.getCaptionBarDemo = function () {
    return {
      name: 'caption-bar',
      setupUI: () => this.setupCaptionUI(),
      steps: [
        { action: 'wait', duration: 700 },
        // Enable the floating-caption toggle in the live header.
        { action: 'moveCursor', target: '[data-demo-id="caption-toggle"]', duration: 1000, delay: 300 },
        { action: 'hover', duration: 300 },
        { action: 'click', duration: 300 },
        { action: 'setState', handler: () => {
          const toggle = this.engine.viewport.querySelector('[data-demo-id="caption-toggle"]');
          if (toggle) toggle.setAttribute('data-enabled', 'true');
          const overlay = this.engine.viewport.querySelector('[data-demo-id="caption-overlay"]');
          if (overlay) overlay.classList.add('is-visible');
        }, delay: 200 },
        { action: 'wait', duration: 600 },
        ...this.generateCaptionSteps(),
        { action: 'wait', duration: 2000 }
      ]
    };
  };
