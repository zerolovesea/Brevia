/**
 * Demo Scenarios V3 - Part 2: Prepare View & Live View
 */

// 继续 DemoScenariosV3 类的方法

DemoScenariosV3.prototype.setupPrepareUI = function () {
  // 精确还原准备页面（基于第二张截图）
  const html = String.raw`
    <main class="app-shell">
      ${this.sidebarHtml()}

      <section class="workspace">
        ${this.windowBarHtml('准备录制')}

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

                  <label class="prepare-model-select">识别模型<div class="flow-select"><button class="flow-select-toggle" type="button">Qwen3-ASR 0.6B <span>⌄</span></button></div></label>

                  <label>
                    工作区
                    <div class="flow-select">
                      <button class="flow-select-toggle" data-demo-id="category" type="button">
                        公开工作区 <span>⌄</span>
                      </button>
                    </div>
                  </label>
                </div>

                <fieldset><legend>录制来源</legend><div class="capture-settings"><label>采集模式<div class="flow-select capture-mode-select"><button class="flow-select-toggle" type="button">自动（记住上次）<span>⌄</span></button></div></label><label>麦克风设备<div class="flow-select"><button class="flow-select-toggle" type="button">系统默认<span>⌄</span></button></div></label></div><div class="capture-status"><span><b>麦克风</b><strong><i class="input-meter" style="--level:.65"></i><span>输入良好</span></strong></span><span><b>系统音频</b><strong>已连接</strong></span></div></fieldset>

                <button class="primary-action wide" data-demo-id="start-recording" type="button">
                  开始录制 <span>→</span>
                </button>
              </form>

            </div>

          </div>
        </section>
      </section>
    </main>
  `;
  return html;
};

// The real notes editor toolbar (1:1 with createNotesEditor in frontend/ui-components.js).
// Buttons: bold, italic, h1–h3, ul/ol (SVG), quote, link, image, code, todo, highlight, mode-toggle.
DemoScenariosV3.prototype.notesToolbarHtml = function () {
  const ul =
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M7 4h6M7 8h6M7 12h6"/></svg>';
  const ol =
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><text x="1.5" y="5" font-size="6.5" fill="currentColor" stroke="none">1</text><text x="1.5" y="9.5" font-size="6.5" fill="currentColor" stroke="none">2</text><text x="1.5" y="14" font-size="6.5" fill="currentColor" stroke="none">3</text><path d="M7 4h6M7 8.5h6M7 13h6"/></svg>';
  const link =
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6.2 9.8 3.6-3.6" /><path d="M7.2 11.4 5.6 13a2.6 2.6 0 0 1-3.6-3.6l1.6-1.6a2.6 2.6 0 0 1 3.6 0" /><path d="M8.8 4.6l1.6-1.6a2.6 2.6 0 0 1 3.6 3.6l-1.6 1.6a2.6 2.6 0 0 1-3.6 0" /></svg>';
  const image =
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><circle cx="5.5" cy="6.2" r="1.4" /><path d="m1.5 11 3.6-3.6L11 12.8" /></svg>';
  const mode =
    '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 3h9M8 3v10"/></svg>';
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
    [
      'table',
      '插入表格',
      '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="2" y="2" width="12" height="12"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/></svg>',
    ],
    ['code', '行内代码', '&lt;/&gt;'],
    ['todo', '待办', '☐'],
    ['highlight', '重点', '★'],
    ['mode-toggle', '富文本', mode],
  ];
  return (
    '<div class="notes-toolbar">' +
    btns
      .map(
        ([command, label, html]) =>
          `<button type="button" data-notes-command="${command}" title="${label}" aria-label="${label}">${html}</button>`,
      )
      .join('') +
    '</div>'
  );
};

DemoScenariosV3.prototype.setupLiveUI = function (meetingTitle) {
  // 精确还原新版实时会议页面：左侧「我的笔记」（AI 辅助开关 + 编辑器），右侧「实时字幕」。
  const notesToolbar = this.notesToolbarHtml();
  const html = String.raw`
    <main class="app-shell is-live-meeting">
      ${this.sidebarHtml()}

      <section class="workspace">
        ${this.windowBarHtml('正在录制')}

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
          </header>

          <div class="live-layout">
            <section class="live-notes">
              <header class="live-section-head">
                <p class="eyebrow">我的笔记</p>
                <button class="ai-assist-toggle" type="button"><span class="ai-assist-toggle-star">✦</span> <span>AI 笔记</span></button>
                <button class="live-mode-toggle" data-toggle-live-mode="caption" type="button" aria-label="展开字幕" title="展开字幕"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></button>
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
                <button class="live-mode-toggle" data-toggle-live-mode="notes" type="button" aria-label="返回笔记" title="返回笔记"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10 3-5 5 5 5"/></svg></button>
              </header>
              <div class="transcript-scroll" data-demo-id="transcript-scroll"></div>
              <button class="back-to-latest" type="button" hidden><span>↓</span> <span>回到最新</span></button>
            </section>
          </div>
          ${this.liveControlsHtml()}
        </section>
      </section>
    </main>
  `;
  return html;
};

// State management methods — shared fade-swap helper
DemoScenariosV3.prototype._fadeSwapContent = function (newHtml, callback) {
  const content = document.getElementById('demo-content');
  if (!content) return;

  content.style.transition = 'opacity 0.2s ease';
  content.style.opacity = '0';

  return new Promise((resolve) =>
    setTimeout(
      () => {
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
        resolve();

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            content.style.opacity = '1';
            setTimeout(() => {
              content.style.transition = '';
            }, 300);
          });
        });
      },
      this.engine.reducedMotion ? 0 : 200,
    ),
  );
};

DemoScenariosV3.prototype.showPrepareView = function () {
  return this._fadeSwapContent(this.setupPrepareUI());
};

DemoScenariosV3.prototype.fillMeetingTitle = function (title) {
  const input = this.engine.viewport.querySelector('[data-demo-id="meeting-title"]');
  if (input) {
    input.value = title;
    input.focus({ preventScroll: true });
  }
};

DemoScenariosV3.prototype.showLiveView = function (meetingTitle) {
  return this._fadeSwapContent(this.setupLiveUI(meetingTitle), () => {
    this.startTimer();
  });
};

DemoScenariosV3.prototype.startTimer = function () {
  const timerEl = this.engine.viewport.querySelector('[data-demo-id="timer"]');
  if (!timerEl) return;

  let seconds = 0;
  const interval = setInterval(() => {
    if (this.engine.isPaused || !this.timeline.isRunning) {
      clearInterval(interval);
      return;
    }

    seconds++;
    const hrs = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);
};

DemoScenariosV3.prototype.enableTranslation = function () {
  this.engine.viewport.querySelector('#live-more-panel').hidden = true;
  // Enable translation toggle button
  const translationToggle = this.engine.viewport.querySelector(
    '[data-demo-id="translation-toggle"]',
  );
  if (translationToggle) {
    translationToggle.setAttribute('data-enabled', 'true');
  }

  // Show translations on existing segments
  const segments = this.engine.viewport.querySelectorAll('.segment[data-translation]');
  segments.forEach((seg) => {
    const translation = seg.getAttribute('data-translation');
    const translationEl = seg.querySelector('.translation');
    if (translationEl && translation) {
      translationEl.textContent = translation;
      translationEl.style.display = 'block';
    }
  });
};

DemoScenariosV3.prototype.getParticipantSourceLabel = function () {
  return '麦克风';
};

DemoScenariosV3.prototype.updateParticipantList = function (speakers) {
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
    const existing = Array.from(participantsList.querySelectorAll('.person b')).find(
      (b) => b.textContent === speaker,
    );
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

DemoScenariosV3.prototype.getParticipantsLabel = function () {
  return '参与者';
};

DemoScenariosV3.prototype.generateLiveSegmentSteps = function (
  segments,
  start,
  end,
  withTranslation = false,
) {
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
      delay: 200,
    });

    // Reveal the speaker in the participants panel in the same beat as their
    // transcript line, so the two stay in sync.
    steps.push({
      action: 'setState',
      handler: () => this.updateParticipantList(speakersSoFar),
      delay: 100,
    });

    // Scroll to bottom
    steps.push({
      action: 'scrollToBottom',
      target: '[data-demo-id="transcript-scroll"]',
      duration: 400,
      delay: 100,
    });

    // Wait before next segment
    steps.push({
      action: 'wait',
      duration: 1200,
    });
  }

  return steps;
};

DemoScenariosV3.prototype.createSegmentHTML = function (segment, withTranslation = false) {
  let html = `
    <div class="segment" data-translation="${segment.translation || ''}" style="padding: 16px 0;">
      <div class="segment-meta" style="gap: 4px;">
        <time>${segment.time}</time>
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
DemoScenariosV3.prototype.setupSummaryUI = function () {
  // 显示主页，准备点击会议进入详情
  return this.setupHomeUI();
};

DemoScenariosV3.prototype.setupSummaryDetailUI = function () {
  const html = String.raw`
    <main class="app-shell">
      ${this.sidebarHtml()}

      <section class="workspace">
        ${this.windowBarHtml('会议详情')}

        <section class="view active" id="detail-view">
          <button class="back">← 返回会议库</button>
          <header class="detail-head">
            <div class="detail-title">
              <p class="eyebrow">本地会议</p>
              <h1>Q3 产品评审会议</h1>
              <p class="detail-meta">2026年8月7日 · 45 分钟 · 3 位参与者 · 已生成纪要</p>
            </div>
            <div class="detail-actions">
              <button class="primary-action" data-export-detail>导出与分享</button>
            </div>
          </header>


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
                  <span class="summary-actions"><button class="summary-action-icon" data-open-summary-edit title="编辑" aria-label="编辑"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 11.8 8.3-8.3 1.7 1.7-8.3 8.3L3 13z"/><path d="m10.3 4.5 1.7 1.7"/></svg></button><button class="summary-action-icon" data-copy-summary title="复制会议纪要" aria-label="复制会议纪要"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="7" height="8" rx="1"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"/></svg></button><button class="summary-action-icon" data-regenerate-summary title="重新生成" aria-label="重新生成"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 6.5A5 5 0 1 0 14 10"/><path d="M13 2.5v4h-4"/></svg></button></span>
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
              </div>
            </aside>
            <button class="detail-mode-toggle" data-toggle-detail-mode="summary" type="button" aria-label="展开会议纪要" title="展开会议纪要"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></button><button class="detail-mode-toggle" data-toggle-detail-mode="transcript" type="button" aria-label="展开字幕" title="展开字幕"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10 3-5 5 5 5"/></svg></button>
          </div>
          <section class="player floating-control-bar"><div class="player-source"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3V5L6 8H3z"/><path d="M13 7a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/></svg><span>本地录音</span><span class="player-time" id="player-time">18:32</span></div><div class="player-actions"><button class="skip" type="button" aria-label="后退 15 秒">↶ 15</button><button class="play" id="play" aria-label="播放录音">▶</button><button class="skip" type="button" aria-label="前进 15 秒">15 ↷</button></div><div class="player-meta"><span class="player-duration" id="player-duration">45:00</span><div class="player-speed flow-select"><button class="flow-select-toggle" data-flow-select-toggle type="button" aria-expanded="false">1×<span>⌄</span></button><input id="playback-rate" type="hidden" value="1" /><div class="flow-select-options" hidden><button type="button" data-playback-rate="1">1×</button><button type="button" data-playback-rate="1.25">1.25×</button><button type="button" data-playback-rate="1.5">1.5×</button><button type="button" data-playback-rate="2">2×</button></div></div></div><div class="player-track"><input id="progress" type="range" min="0" max="2700" value="1112" aria-label="播放进度" /></div></section>
        </section>
      </section>
    </main>
  `;
  return html;
};

DemoScenariosV3.prototype.showSummaryDetail = function () {
  return this._fadeSwapContent(this.setupSummaryDetailUI());
};

// Voiceprint demo UI setup
DemoScenariosV3.prototype.setupVoiceprintUI = function () {
  const template = document.createElement('template');
  template.innerHTML = this.setupSummaryDetailUI();
  const root = template.content;
  root.querySelector('[data-detail-panel="notes"]').hidden = true;
  root.querySelector('[data-detail-panel="transcript"]').hidden = false;
  root.querySelectorAll('[data-detail-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.detailTab === 'transcript');
  });
  const transcript = root.querySelector('.transcript-body');
  transcript.id = 'transcript-scroll';
  transcript.innerHTML = '';
  root.querySelector('.tabbar-extra').innerHTML =
    '<button class="text-button" data-demo-id="refine-speakers">开始精修</button>';
  return template.innerHTML;
};

DemoScenariosV3.prototype.generateVoiceprintSegmentSteps = function (segments) {
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
      delay: 200,
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
      delay: 100,
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
      delay: 100,
    });

    steps.push({ action: 'wait', duration: 1400 });
  });

  return steps;
};

DemoScenariosV3.prototype.getVoiceprintRoles = function () {
  return ['项目经理', '前端工程师', '后端工程师', '设计师'];
};

DemoScenariosV3.prototype.updateVoiceprintParticipants = function (speakers) {
  const list = this.engine.viewport.querySelector('[data-demo-id="voiceprint-participants"]');
  if (!list) return;

  const colors = ['blue', 'gray'];
  const roles = this.getVoiceprintRoles();

  // Update the participant count eyebrow (real app: "参与者 · N")
  const eyebrow = this.engine.viewport.querySelector('[data-demo-id="voiceprint-eyebrow"]');
  if (eyebrow) eyebrow.textContent = `${this.getParticipantsLabel()} · ${speakers.length}`;

  // Use the real .person markup: avatar + name/role + level meter.
  list.innerHTML = speakers
    .map((speaker, index) => {
      const initial = speaker.trim().charAt(0);
      const color = colors[index % colors.length];
      const role = roles[index % roles.length];
      return `<div class="person"><span class="avatar ${color}">${initial}</span><div><b>${speaker}</b><small>${role}</small></div><i class="level"></i></div>`;
    })
    .join('');
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
    h1: '应用设置',
    cards: [
      {
        id: 'manage-models',
        title: '模型库',
        desc: '下载和管理本地语音识别模型，为字幕、精修和说话人识别提供能力。',
        button: '管理模型库',
      },
      {
        id: 'ai',
        title: 'AI 功能',
        desc: '配置 AI 模型会议纪要，以及智能笔记。',
        button: '配置 AI 功能',
      },
      {
        id: 'speaker',
        title: '说话人识别',
        desc: '管理已注册的声纹与说话人名称。',
        button: '管理说话人',
      },
      {
        id: 'advanced',
        title: '进阶设置',
        desc: '为特定会议环境微调识别、端点检测、说话人分离和本地模型。',
        button: '配置进阶设置',
      },
      {
        id: 'storage',
        title: '存储与隐私',
        desc: '查看和管理保存在此设备上的会议录音、会议纪要与模型。',
        button: '查看本地存储',
      },
    ],
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
      {
        stage: '整句识别',
        name: 'Fun-ASR-Nano',
        language: '中文 / 英语 / 粤语',
        intro: '中文会议首选：中文准确率高，覆盖粤语等方言，也能识别英语。',
        quality: 3,
        speed: 3,
        installed: true,
        size: '1.68 GB',
      },
      {
        stage: '整句识别',
        name: 'Qwen3-ASR 0.6B 8bit',
        language: '多语种',
        intro: '覆盖 30 种语言和 22 种中文方言并自动判断语种；日韩会议的默认模型。',
        quality: 3,
        speed: 3,
        installed: false,
        size: '1.01 GB',
      },
      {
        stage: '整句识别',
        name: 'Parakeet TDT 0.6B v3',
        language: '欧洲 25 种语言',
        intro: '英语与欧洲语言的默认模型，自动判断语种，自带标点与大小写。',
        quality: 3,
        speed: 3,
        installed: false,
        size: '2.51 GB',
      },
      {
        stage: '随应用安装',
        name: 'Silero VAD',
        language: '语言无关',
        intro: '判断此刻是否有人说话，用于切分句子边界；随应用安装。',
        quality: 3,
        speed: 3,
        installed: true,
        bundled: true,
        size: '2 MB',
      },
      {
        stage: '随应用安装',
        name: 'Pyannote Segmentation 3.0',
        language: '语言无关',
        intro: '检测单轨录音中的说话区间，为说话人分离提供边界；随应用安装。',
        quality: 2,
        speed: 3,
        installed: true,
        bundled: true,
        size: '7 MB',
      },
      {
        stage: '随应用安装',
        name: '3D-Speaker ERes2Net Base',
        language: '中文',
        intro: '提取声纹并离线聚类说话人；随应用安装。',
        quality: 2,
        speed: 3,
        installed: true,
        bundled: true,
        size: '40 MB',
      },
      {
        stage: 'AI 笔记与会议纪要',
        name: 'Qwen 3.5 2B',
        language: '中文 / 英语',
        intro: '在本机生成会中建议与会议纪要。',
        quality: 3,
        speed: 2,
        installed: false,
        size: '1.3 GB',
      },
      {
        stage: '字幕翻译',
        name: 'Tencent Hy-MT2 1.8B',
        language: '33 种语言',
        intro: '把字幕翻译为目标语言，全部在本机运行。',
        quality: 3,
        speed: 3,
        installed: false,
        size: '1.13 GB',
      },
    ],
  };
};
DemoScenariosV3.prototype.setupSettingsUI = function () {
  const copy = this.getSettingsCopy();
  const cards = copy.cards
    .map(
      (card, index) => String.raw`
    <section class="settings-card"${index === 0 ? ' data-demo-id="model-library-card"' : ''}>
      <h2>${card.title}</h2>
      <p>${card.desc}</p>
      <button class="secondary" type="button"${index === 0 ? ' data-demo-id="manage-models-btn"' : ''}>${card.button}</button>
    </section>
  `,
    )
    .join('');

  return String.raw`
    <main class="app-shell">
      ${this.sidebarHtml('settings')}

      <section class="workspace">
        ${this.windowBarHtml(copy.crumb)}

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
  return data.items
    .map((item) => {
      const heading = item.stage !== lastStage ? `<h3>${item.stage}</h3>` : '';
      lastStage = item.stage;
      const dots = (level) =>
        [1, 2, 3].map((step) => `<i${step <= level ? ' class="on"' : ''}></i>`).join('');
      const ratings = String.raw`
      <div class="model-library-ratings">
        <span class="model-library-rating"><small>${data.qualityLabel}</small><b>${data.qualityTiers[item.quality - 1]}</b><span class="rating-scale" aria-hidden="true">${dots(item.quality)}</span></span>
        <span class="model-library-rating"><small>${data.speedLabel}</small><b>${data.speedTiers[item.speed - 1]}</b><span class="rating-scale" aria-hidden="true">${dots(item.speed)}</span></span>
      </div>`;
      const tags = `<div class="model-library-tags">${item.bundled ? '<span class="model-library-installed">随应用安装</span>' : item.installed ? `<span class="model-library-installed">${data.installedLabel}</span>` : ''}</div>`;
      const action = item.bundled
        ? '<span class="model-library-readonly">必需</span>'
        : item.installed
          ? '<button class="secondary" type="button">从文件夹打开</button><button class="modal-action modal-danger" type="button">删除</button>'
          : `<button class="modal-action" type="button">${data.downloadLabel}</button>`;
      return String.raw`
      ${heading}
      <div class="model-library-item">
        <span>
          <div class="model-library-name"><b class="model-library-headline">${item.name}</b>${tags}</div>
          ${ratings}
          <p>${item.intro}</p><small class="model-library-size">${item.size}</small>
        </span>
        <span class="model-actions">${action}</span>
      </div>`;
    })
    .join('');
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
      {
        action: 'moveCursor',
        target: '[data-demo-id="manage-models-btn"]',
        duration: 1200,
        delay: 400,
      },
      { action: 'hover', duration: 400 },
      { action: 'click', duration: 300 },
      { action: 'setState', handler: () => this.openModelLibraryModal(), delay: 300 },
      { action: 'wait', duration: 1400 },
      {
        action: 'moveCursor',
        target: '[data-demo-id="model-library-body"] .model-library-item .model-actions button',
        duration: 900,
        delay: 300,
      },
      { action: 'wait', duration: 900 },
      {
        action: 'scrollToBottom',
        target: '[data-demo-id="model-library-body"]',
        duration: 5000,
        delay: 200,
      },
      { action: 'wait', duration: 2200 },
    ],
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
      {
        text: '我们先过一下这个季度的整体进展。',
        translation: "Let's start by reviewing the overall progress this quarter.",
      },
      {
        text: '实时转录的延迟已经优化到三百毫秒以内。',
        translation: 'Live transcription latency is now under 300 milliseconds.',
      },
      {
        text: '多语言支持这块也覆盖了三十多种语言。',
        translation: 'Multilingual support now covers more than 30 languages.',
      },
    ],
  };
};

DemoScenariosV3.prototype.getCaptionTranscript = function () {
  return [
    { time: '00:00:12', speaker: '主持人', text: '欢迎大家参加这次产品评审，我们按议程开始。' },
    { time: '00:00:24', speaker: '李娜', text: '好的，我先同步一下这个季度的整体情况。' },
  ];
};

DemoScenariosV3.prototype.setupCaptionUI = function () {
  const { meetingTitle } = this.getCaptionData();
  // Reuse the real live view, then overlay the real floating-caption component.
  let liveHtml = this.setupLiveUI(meetingTitle);

  // Pre-populate the transcript so the live view reads as an active meeting.
  const transcript = this.getCaptionTranscript()
    .map(
      (segment) => String.raw`
    <div class="segment" style="padding: 16px 0;">
      <div class="segment-meta" style="gap: 4px;"><time>${segment.time}</time></div>
      <div class="segment-copy"><p style="font-size: 18px; line-height: 1.8; margin: 0;">${segment.text}</p></div>
    </div>
  `,
    )
    .join('');
  liveHtml = liveHtml.replace(
    '<div class="transcript-scroll" data-demo-id="transcript-scroll"></div>',
    `<div class="transcript-scroll" data-demo-id="transcript-scroll">${transcript}</div>`,
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
          const finalized = this.engine.viewport.querySelector(
            '[data-demo-id="caption-finalized"]',
          );
          const translation = this.engine.viewport.querySelector(
            '[data-demo-id="caption-translation"]',
          );
          const text = this.engine.viewport.querySelector('[data-demo-id="caption-text"]');
          if (finalized) {
            finalized.textContent = prev.text;
            finalized.classList.remove('hidden');
          }
          if (translation) {
            translation.textContent = '';
            translation.classList.add('hidden');
          }
          if (text) text.textContent = '';
        },
        delay: 100,
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
          if (this.engine.isPaused) {
            await this.engine.wait(100);
            i--;
            continue;
          }
          text.textContent += chars[i];
          await this.engine.wait(55);
        }
      },
      delay: 200,
    });

    steps.push({ action: 'wait', duration: 500 });

    // Reveal the translation line beneath the live caption.
    steps.push({
      action: 'setState',
      handler: () => {
        const translation = this.engine.viewport.querySelector(
          '[data-demo-id="caption-translation"]',
        );
        if (translation) {
          translation.textContent = line.translation;
          translation.classList.remove('hidden');
        }
      },
      delay: 100,
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
      // Open the bottom control bar's More menu before enabling captions.
      { action: 'moveCursor', target: '#live-more-toggle', duration: 700 },
      { action: 'click', duration: 300 },
      {
        action: 'setState',
        handler: () => {
          this.engine.viewport.querySelector('#live-more-panel').hidden = false;
        },
      },
      {
        action: 'moveCursor',
        target: '[data-demo-id="caption-toggle"]',
        duration: 1000,
        delay: 300,
      },
      { action: 'hover', duration: 300 },
      { action: 'click', duration: 300 },
      {
        action: 'setState',
        handler: () => {
          const toggle = this.engine.viewport.querySelector('[data-demo-id="caption-toggle"]');
          if (toggle) toggle.setAttribute('data-enabled', 'true');
          const overlay = this.engine.viewport.querySelector('[data-demo-id="caption-overlay"]');
          if (overlay) overlay.classList.add('is-visible');
          this.engine.viewport.querySelector('#live-more-panel').hidden = true;
        },
        delay: 200,
      },
      { action: 'wait', duration: 600 },
      ...this.generateCaptionSteps(),
      { action: 'wait', duration: 2000 },
    ],
  };
};
