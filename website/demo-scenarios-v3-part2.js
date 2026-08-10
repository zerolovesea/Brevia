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
                    分类标签
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
              <h2 style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">计算设备</h2>
              <dl>
                <div>
                  <dt>计算设备</dt>
                  <dd>CPU</dd>
                </div>
                <div>
                  <dt>实时字幕模型</dt>
                  <dd>Streaming Zipformer Multilingual</dd>
                </div>
                <div>
                  <dt>说话人分离模型</dt>
                  <dd>Pyannote + 3D-Speaker CAM++</dd>
                </div>
                <div>
                  <dt>会后精修模型</dt>
                  <dd>Qwen3-ASR 1.7B int8</dd>
                </div>
                <div>
                  <dt>VAD 模型</dt>
                  <dd>Silero VAD</dd>
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

DemoScenariosV3.prototype.setupLiveUI = function(meetingTitle) {
  // 精确还原实时会议页面（基于第三张截图）
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
              <span class="recording"><i></i> 正在录制</span>
            </div>
            <time data-demo-id="timer">00:00:00</time>
            <button class="pause-button">Ⅱ 暂停</button>
            <button class="end-button">结束会议</button>
          </header>

          <div class="live-layout">
            <section class="transcript" aria-label="实时字幕">
              <div class="section-heading">
                <div class="current-caption">
                  <p class="eyebrow">实时字幕</p>
                  <h1 data-demo-id="live-caption"></h1>
                  <p class="live-caption-translation" data-demo-id="live-caption-translation" hidden></p>
                </div>
                <div class="caption-controls">
                  <button class="floating-caption-toggle" data-enabled="false" title="悬浮字幕">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="3" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
                      <path d="M4 6h8M4 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <button class="translation-toggle" data-demo-id="translation-toggle" data-enabled="false">
                    译文: 关
                  </button>
                </div>
              </div>
              <div class="transcript-scroll" data-demo-id="transcript-scroll"></div>
            </section>

            <aside class="live-panel">
              <!-- 参与者 -->
              <section>
                <p class="eyebrow" style="margin-bottom: 16px;">参与者 : 0</p>
                <div class="participants-list" data-demo-id="participants-list">
                  <p class="participants-empty">等待识别说话人</p>
                </div>
              </section>

              <!-- 模型与设置 -->
              <section class="live-settings">
                <p class="eyebrow" style="margin-bottom: 16px;">模型与设置</p>

                <label class="config-select-field">
                  会议语言
                  <div class="flow-select">
                    <button class="flow-select-toggle" type="button">
                      自动检测 <span>⌄</span>
                    </button>
                  </div>
                </label>

                <label class="config-select-field">
                  实时识别模型
                  <div class="flow-select">
                    <button class="flow-select-toggle" type="button">
                      Streaming Zipformer Multilingual <span>⌄</span>
                    </button>
                  </div>
                </label>

                <label class="config-select-field">
                  精修模型
                  <div class="flow-select">
                    <button class="flow-select-toggle" type="button">
                      Qwen3-ASR 1.7B int8 <span>⌄</span>
                    </button>
                  </div>
                </label>
              </section>

              <!-- 语音生成 -->
              <section class="tts-chat">
                <p class="eyebrow" style="margin-bottom: 16px;">语音生成</p>
                <form>
                  <div class="tts-selects">
                    <label class="config-select-field">
                      声音
                      <div class="flow-select">
                        <button class="flow-select-toggle" type="button">
                          声音 <span>⌄</span>
                        </button>
                      </div>
                    </label>

                    <label class="config-select-field">
                      语言
                      <div class="flow-select">
                        <button class="flow-select-toggle" type="button">
                          中文 <span>⌄</span>
                        </button>
                      </div>
                    </label>
                  </div>

                  <input type="text" placeholder="输入要朗读的内容..." />

                  <button type="submit">发送音频</button>
                </form>
                <p class="tts-hint">输入文本后，Brevia 会将其合成为语音并在会议中播放</p>
              </section>
            </aside>
          </div>
        </section>
      </section>
    </main>
  `;
  return html;
};

// State management methods
DemoScenariosV3.prototype.showPrepareView = function() {
  const content = document.getElementById('demo-content');
  content.innerHTML = this.setupPrepareUI();
};

DemoScenariosV3.prototype.fillMeetingTitle = function(title) {
  const input = this.engine.viewport.querySelector('[data-demo-id="meeting-title"]');
  if (input) {
    input.value = title;
    input.focus();
  }
};

DemoScenariosV3.prototype.showLiveView = function(meetingTitle) {
  const content = document.getElementById('demo-content');
  content.innerHTML = this.setupLiveUI(meetingTitle);
  this.startTimer();
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
  const toggle = this.engine.viewport.querySelector('[data-demo-id="translation-toggle"]');
  const liveCaptionTranslation = this.engine.viewport.querySelector('[data-demo-id="live-caption-translation"]');

  if (toggle) {
    toggle.textContent = '译文: 开';
    toggle.setAttribute('data-enabled', 'true');
  }

  if (liveCaptionTranslation) {
    liveCaptionTranslation.removeAttribute('hidden');
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
  const captionEl = this.engine.viewport.querySelector('[data-demo-id="live-caption"]');
  const translationEl = this.engine.viewport.querySelector('[data-demo-id="live-caption-translation"]');

  if (captionEl) {
    captionEl.textContent = text;
    captionEl.classList.add('caption-increment');
    setTimeout(() => captionEl.classList.remove('caption-increment'), 420);
  }

  if (translationEl && !translationEl.hasAttribute('hidden') && translation) {
    translationEl.textContent = translation;
  }
};

DemoScenariosV3.prototype.updateParticipantList = function(speakers) {
  const participantsList = this.engine.viewport.querySelector('[data-demo-id="participants-list"]');
  if (!participantsList) return;

  // Remove empty message
  const emptyMsg = participantsList.querySelector('.participants-empty');
  if (emptyMsg) emptyMsg.remove();

  // Update participant count
  const eyebrow = this.engine.viewport.querySelector('.live-panel .eyebrow');
  if (eyebrow && eyebrow.textContent.includes('参与者')) {
    eyebrow.textContent = `参与者 : ${speakers.length}`;
  }

  // Add participants
  speakers.forEach(speaker => {
    const existing = Array.from(participantsList.querySelectorAll('.person b')).find(b => b.textContent === speaker);
    if (!existing) {
      const person = document.createElement('div');
      person.className = 'person';
      person.innerHTML = `
        <div class="avatar">${speaker.split(' ').map(n => n[0]).join('').toUpperCase()}</div>
        <span><b>${speaker}</b></span>
      `;
      participantsList.appendChild(person);
    }
  });
};

DemoScenariosV3.prototype.generateLiveSegmentSteps = function(segments, start, end, withTranslation = false) {
  const steps = [];
  const uniqueSpeakers = new Set();

  for (let i = start; i < end && i < segments.length; i++) {
    const segment = segments[i];
    uniqueSpeakers.add(segment.speaker);

    // Update participants list
    if (uniqueSpeakers.size > 0) {
      steps.push({
        action: 'setState',
        handler: () => this.updateParticipantList(Array.from(uniqueSpeakers)),
        delay: 100
      });
    }

    // Update live caption
    steps.push({
      action: 'setState',
      handler: () => this.updateLiveCaption(segment.text, segment.translation),
      delay: 200
    });

    // Append segment to transcript
    steps.push({
      action: 'appendSegment',
      target: '[data-demo-id="transcript-scroll"]',
      html: this.createSegmentHTML(segment, withTranslation),
      duration: 300,
      delay: 200
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
