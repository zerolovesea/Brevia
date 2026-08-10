/**
 * Demo Scenarios V2 - Complete product flow with realistic UI
 */

class DemoScenariosV2 {
  constructor(engine, timeline) {
    this.engine = engine;
    this.timeline = timeline;
    this.mockData = this.initMockData();
  }

  initMockData() {
    return {
      transcription: {
        meetingTitle: 'Q3 Product Review',
        language: 'en',
        translateTo: 'zh',
        participants: 3,
        segments: [
          { time: '00:03', speaker: 'Alex Chen', text: 'Good morning everyone, thanks for joining today\'s Q3 product review.', translation: '大家早上好，感谢参加今天的第三季度产品评审。' },
          { time: '00:09', speaker: 'Sarah Kim', text: 'Thanks Alex. I\'ll start with the engineering update.', translation: '谢谢 Alex。我先介绍工程方面的更新。' },
          { time: '00:14', speaker: 'Alex Chen', text: 'Perfect. We have about 30 minutes for this session.', translation: '很好。我们这次会议大约30分钟。' },
          { time: '00:19', speaker: 'Sarah Kim', text: 'The new AI transcription features are on track for release.', translation: '新的AI转录功能按计划将要发布。' },
          { time: '00:25', speaker: 'Mike Torres', text: 'The beta testing feedback has been excellent so far.', translation: '目前beta测试的反馈非常好。' },
          { time: '00:31', speaker: 'Alex Chen', text: 'Great to hear. Let\'s discuss the timeline in detail.', translation: '很高兴听到这个消息。让我们详细讨论一下时间表。' }
        ],
        floatingCaptions: [
          { text: 'Good morning everyone, thanks for joining today\'s Q3 product review.', translation: '大家早上好，感谢参加今天的第三季度产品评审。' },
          { text: 'The new AI transcription features are on track for release.', translation: '新的AI转录功能按计划将要发布。' },
          { text: 'The beta testing feedback has been excellent so far.', translation: '目前beta测试的反馈非常好。' }
        ]
      },
      summary: {
        title: 'Q3 Product Review Meeting',
        duration: '28:34',
        date: '2024-08-10',
        summary: `## 会议摘要

团队回顾了第三季度路线图进展，讨论了即将发布的AI功能。

### 关键要点
- AI功能开发按计划进行，预计第三季度发布
- 翻译API集成提前完成
- Beta测试用户反馈非常积极

### 决策事项
- 3周后启动公开Beta测试
- 增加AI模型测试的QA资源
- 安排后续会议讨论上市策略

### 行动项
- **Sarah**: 周五前完成Beta版本文档
- **Alex**: 与市场团队协调发布材料
- **Mike**: 完成新AI端点的性能测试`,
        participants: [
          { name: 'Alex Chen', avatar: 'AC', role: 'Product Manager' },
          { name: 'Sarah Kim', avatar: 'SK', role: 'Engineering Lead' },
          { name: 'Mike Torres', avatar: 'MT', role: 'QA Engineer' }
        ]
      },
      voiceprint: {
        profiles: [
          { name: 'Alex Chen', avatar: 'AC', sample: '"Testing microphone, one two three"', status: 'enrolled' },
          { name: 'Sarah Kim', avatar: 'SK', sample: '"Hello, this is Sarah speaking"', status: 'enrolled' },
          { name: 'Mike Torres', avatar: 'MT', sample: '"Mike Torres here, testing audio"', status: 'enrolled' }
        ],
        recognition: [
          { time: '00:08', speaker: 'Alex Chen', text: 'Let me share the latest metrics with the team.' },
          { time: '00:14', speaker: 'Sarah Kim', text: 'These numbers look great, especially the conversion rate.' },
          { time: '00:19', speaker: 'Mike Torres', text: 'I noticed performance improved significantly after optimization.' }
        ]
      }
    };
  }

  /**
   * Demo 1: Complete Real-time Transcription Flow
   */
  getTranscriptionDemo() {
    const { meetingTitle, language, translateTo, participants, segments, floatingCaptions } = this.mockData.transcription;

    return {
      name: 'transcription',
      setupUI: () => this.setupHomeUI(),
      steps: [
        // 1. Start at home page
        { action: 'wait', duration: 800 },

        // 2. Move to "Start Meeting" button in sidebar
        {
          action: 'moveCursor',
          target: '[data-demo-id="new-meeting-btn"]',
          duration: 1200,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // 3. Transition to prepare view
        {
          action: 'setState',
          handler: () => this.showPrepareView(),
          delay: 300
        },

        { action: 'wait', duration: 600 },

        // 4. Fill meeting title
        {
          action: 'moveCursor',
          target: '[data-demo-id="meeting-title-input"]',
          duration: 900,
          delay: 400
        },
        { action: 'click', duration: 200 },
        {
          action: 'setState',
          handler: () => this.fillMeetingTitle(meetingTitle),
          delay: 100
        },

        { action: 'wait', duration: 400 },

        // 5. Select meeting language
        {
          action: 'moveCursor',
          target: '[data-demo-id="language-select"]',
          duration: 800,
          delay: 300
        },
        { action: 'click', duration: 200 },
        {
          action: 'setState',
          handler: () => this.selectLanguage('English'),
          delay: 100
        },

        { action: 'wait', duration: 400 },

        // 6. Set participants
        {
          action: 'moveCursor',
          target: '[data-demo-id="participants-input"]',
          duration: 700,
          delay: 300
        },
        { action: 'click', duration: 200 },
        {
          action: 'setState',
          handler: () => this.setParticipants(participants),
          delay: 100
        },

        { action: 'wait', duration: 400 },

        // 7. Select translation language
        {
          action: 'moveCursor',
          target: '[data-demo-id="translation-select"]',
          duration: 800,
          delay: 300
        },
        { action: 'click', duration: 200 },
        {
          action: 'setState',
          handler: () => this.selectTranslation('中文'),
          delay: 100
        },

        { action: 'wait', duration: 500 },

        // 8. Click "Start Recording" button
        {
          action: 'moveCursor',
          target: '[data-demo-id="start-recording-btn"]',
          duration: 1000,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // 9. Transition to live view
        {
          action: 'setState',
          handler: () => this.showLiveView(meetingTitle),
          delay: 400
        },

        { action: 'wait', duration: 1000 },

        // 10. Show floating caption window
        {
          action: 'setState',
          handler: () => this.showFloatingCaption(),
          delay: 200
        },

        // 11. Display segments with floating captions
        ...this.generateLiveSegmentSteps(segments, floatingCaptions, 0, 3),

        { action: 'wait', duration: 800 },

        // 12. Move to translation toggle
        {
          action: 'moveCursor',
          target: '[data-demo-id="translation-toggle"]',
          duration: 900,
          delay: 400
        },
        { action: 'hover', duration: 300 },
        { action: 'click', duration: 300 },

        // 13. Enable translation
        {
          action: 'setState',
          handler: () => this.enableTranslation(),
          delay: 200
        },

        { action: 'wait', duration: 600 },

        // 14. Show more segments with translation
        ...this.generateLiveSegmentSteps(segments, floatingCaptions, 3, 6, true),

        // 15. Final pause
        { action: 'wait', duration: 2500 }
      ]
    };
  }

  // ===== UI Setup Methods =====

  setupHomeUI() {
    const html = `
      <main class="app-shell">
        <aside class="sidebar">
          <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="Brevia" /></button>
          <button class="new-meeting" data-demo-id="new-meeting-btn"><span>+</span> 开始会议</button>
          <nav>
            <button class="nav-item active"><span>⌂</span> 所有会议</button>
            <button class="nav-item"><span>◷</span> 最近删除</button>
            <button class="nav-item"><span>⚙</span> 设置</button>
          </nav>
        </aside>

        <section class="workspace">
          <header class="window-bar">
            <span>所有会议</span>
          </header>

          <section class="view active" style="display: block; opacity: 1; padding-top: 64px;">
            <div class="page-head">
              <div>
                <button class="eyebrow" type="button" disabled>会议库</button>
                <h1>每一场对话，都留有依据。</h1>
              </div>
              <button class="primary-action" data-demo-id="home-start-btn">开始会议 <span>→</span></button>
            </div>

            <div class="library-toolbar" style="margin-top: 64px;">
              <label class="search">
                <span>⌕</span>
                <input type="search" placeholder="搜索会议、逐字稿或标签" />
              </label>
            </div>

            <section class="meeting-list" style="margin-top: 24px;">
              <div class="meeting-row">
                <div class="meeting-color" style="background: #667eea;"></div>
                <div class="meeting-main">
                  <h2>Team Standup</h2>
                  <p><time>2024-08-09</time><span>·</span>15:32</p>
                </div>
                <div class="meeting-status">
                  <span class="status">已完成</span>
                </div>
              </div>
            </section>
          </section>
        </section>
      </main>
    `;
    return html;
  }

  setupPrepareUI() {
    const html = `
      <main class="app-shell">
        <aside class="sidebar">
          <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="Brevia" /></button>
          <button class="new-meeting"><span>+</span> 开始会议</button>
          <nav>
            <button class="nav-item active"><span>⌂</span> 所有会议</button>
            <button class="nav-item"><span>◷</span> 最近删除</button>
            <button class="nav-item"><span>⚙</span> 设置</button>
          </nav>
        </aside>

        <section class="workspace">
          <header class="window-bar">
            <span>准备录制</span>
          </header>

          <section class="view active" style="display: block; opacity: 1; padding-top: 32px;">
            <button class="back">← 返回会议库</button>

            <div class="prepare-layout" style="margin-top: 48px;">
              <div>
                <p class="eyebrow">准备录制</p>
                <h1 style="font-size: 52px;">开始一场会议</h1>

                <form style="margin-top: 32px;">
                  <label>
                    会议名称
                    <input data-demo-id="meeting-title-input" value="会议" maxlength="120" />
                  </label>

                  <div class="form-grid" style="margin-top: 24px;">
                    <label>
                      会议语言
                      <div class="flow-select">
                        <button class="flow-select-toggle" data-demo-id="language-select" type="button">
                          中文 <span>⌄</span>
                        </button>
                      </div>
                    </label>

                    <label>
                      参会人数
                      <input data-demo-id="participants-input" type="number" value="2" min="1" max="20" />
                    </label>

                    <label>
                      翻译语言
                      <div class="flow-select">
                        <button class="flow-select-toggle" data-demo-id="translation-select" type="button">
                          关闭 <span>⌄</span>
                        </button>
                      </div>
                    </label>
                  </div>

                  <fieldset style="margin-top: 24px;">
                    <legend>录制音频</legend>
                    <label class="choice">
                      <input name="capture-mic" type="checkbox" checked />
                      <span>
                        <b>我的麦克风</b>
                        <small>系统默认麦克风</small>
                      </span>
                      <strong class="input-state">
                        <i class="input-meter" style="--level: 0.6;" aria-hidden="true"></i>
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

                  <button class="primary-action wide" data-demo-id="start-recording-btn" type="button" style="margin-top: 32px;">
                    开始录制 <span>→</span>
                  </button>
                </form>
              </div>

              <aside class="model-card">
                <div class="model-icon">⌁</div>
                <dl>
                  <div>
                    <dt>计算设备</dt>
                    <dd>CPU</dd>
                  </div>
                  <div>
                    <dt>实时字幕模型</dt>
                    <dd>Streaming Zipformer Chinese XLarge</dd>
                  </div>
                  <div>
                    <dt>说话人分离模型</dt>
                    <dd>Pyannote + 3D-Speaker</dd>
                  </div>
                </dl>
              </aside>
            </div>
          </section>
        </section>
      </main>
    `;
    return html;
  }

  setupLiveUI(meetingTitle) {
    const html = `
      <main class="app-shell">
        <aside class="sidebar">
          <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="Brevia" /></button>
          <button class="new-meeting"><span>+</span> 开始会议</button>
          <nav>
            <button class="nav-item active"><span>⌂</span> 所有会议</button>
            <button class="nav-item"><span>⚙</span> 设置</button>
          </nav>
        </aside>

        <section class="workspace">
          <header class="window-bar">
            <span>实时会议</span>
          </header>

          <section class="view active" style="display: block; opacity: 1; height: calc(100vh - 64px); overflow: hidden;">
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
              <section class="transcript">
                <div class="section-heading">
                  <div class="current-caption">
                    <p class="eyebrow">实时字幕</p>
                    <h1 data-demo-id="live-caption" style="font-size: 28px;"></h1>
                    <p class="live-caption-translation" data-demo-id="live-caption-translation" hidden></p>
                  </div>
                  <div class="caption-controls">
                    <button class="floating-caption-toggle" data-demo-id="floating-caption-toggle" data-enabled="true" title="悬浮字幕" style="color: #000;">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="3" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
                        <path d="M4 6h8M4 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                      </svg>
                    </button>
                    <button class="translation-toggle" data-demo-id="translation-toggle" data-enabled="false">译文: 关</button>
                  </div>
                </div>
                <div class="transcript-scroll" data-demo-id="transcript-scroll"></div>
              </section>

              <aside class="live-panel">
                <section style="grid-template-rows: auto 1fr; display: grid; min-height: 0;">
                  <p class="eyebrow">参会者</p>
                  <div class="participants-list" data-demo-id="participants-list">
                    <div class="person">
                      <div class="avatar">AC</div>
                      <span><b>Alex Chen</b></span>
                    </div>
                    <div class="person">
                      <div class="avatar">SK</div>
                      <span><b>Sarah Kim</b></span>
                    </div>
                    <div class="person">
                      <div class="avatar">MT</div>
                      <span><b>Mike Torres</b></span>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </section>
      </main>

      <!-- Floating Caption Window -->
      <div data-demo-id="floating-caption-window" style="
        position: fixed;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%);
        width: 800px;
        max-width: 90vw;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(20px);
        border-radius: 12px;
        padding: 20px 24px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        display: none;
      ">
        <div data-demo-id="floating-caption-text" style="
          font-size: 24px;
          line-height: 1.5;
          color: white;
          font-weight: 400;
          letter-spacing: -0.02em;
          min-height: 36px;
        "></div>
        <div data-demo-id="floating-caption-translation" style="
          font-size: 18px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.8);
          margin-top: 12px;
          display: none;
        "></div>
      </div>
    `;
    return html;
  }

  // ===== State Management Methods =====

  showPrepareView() {
    const content = document.getElementById('demo-content');
    content.innerHTML = this.setupPrepareUI();
  }

  fillMeetingTitle(title) {
    const input = this.engine.viewport.querySelector('[data-demo-id="meeting-title-input"]');
    if (input) {
      input.value = title;
      input.focus();
    }
  }

  selectLanguage(language) {
    const select = this.engine.viewport.querySelector('[data-demo-id="language-select"]');
    if (select) {
      select.textContent = `${language} ⌄`;
    }
  }

  setParticipants(count) {
    const input = this.engine.viewport.querySelector('[data-demo-id="participants-input"]');
    if (input) {
      input.value = count;
    }
  }

  selectTranslation(language) {
    const select = this.engine.viewport.querySelector('[data-demo-id="translation-select"]');
    if (select) {
      select.textContent = `${language} ⌄`;
    }
  }

  showLiveView(meetingTitle) {
    const content = document.getElementById('demo-content');
    content.innerHTML = this.setupLiveUI(meetingTitle);

    // Start timer animation
    this.startTimer();
  }

  startTimer() {
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
  }

  showFloatingCaption() {
    const floatingWindow = this.engine.viewport.querySelector('[data-demo-id="floating-caption-window"]');
    if (floatingWindow) {
      floatingWindow.style.display = 'block';
      floatingWindow.style.opacity = '0';
      floatingWindow.style.transform = 'translateX(-50%) translateY(20px)';

      setTimeout(() => {
        floatingWindow.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        floatingWindow.style.opacity = '1';
        floatingWindow.style.transform = 'translateX(-50%) translateY(0)';
      }, 50);
    }
  }

  updateFloatingCaption(text, translation = null, showTranslation = false) {
    const textEl = this.engine.viewport.querySelector('[data-demo-id="floating-caption-text"]');
    const translationEl = this.engine.viewport.querySelector('[data-demo-id="floating-caption-translation"]');

    if (textEl) {
      textEl.textContent = text;
      textEl.style.animation = 'none';
      setTimeout(() => {
        textEl.style.animation = 'caption-increment 0.42s cubic-bezier(0.22, 1, 0.36, 1)';
      }, 10);
    }

    if (translationEl && translation && showTranslation) {
      translationEl.textContent = translation;
      translationEl.style.display = 'block';
    } else if (translationEl) {
      translationEl.style.display = 'none';
    }
  }

  enableTranslation() {
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
  }

  updateLiveCaption(text, translation = null) {
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
  }

  updateParticipantSpeaking(speakerName) {
    const participants = this.engine.viewport.querySelectorAll('.participants-list .person');
    participants.forEach(person => {
      const nameEl = person.querySelector('b');
      const smallEl = person.querySelector('small');

      if (nameEl && nameEl.textContent === speakerName) {
        if (!smallEl) {
          const newSmall = document.createElement('small');
          newSmall.textContent = '正在发言';
          nameEl.parentElement.appendChild(newSmall);
        }
      } else {
        if (smallEl) {
          smallEl.remove();
        }
      }
    });
  }

  // ===== Helper Methods =====

  generateLiveSegmentSteps(segments, floatingCaptions, start, end, withTranslation = false) {
    const steps = [];
    let floatingIndex = Math.floor(start / 2);

    for (let i = start; i < end && i < segments.length; i++) {
      const segment = segments[i];

      // Update participant speaking indicator
      steps.push({
        action: 'setState',
        handler: () => this.updateParticipantSpeaking(segment.speaker),
        delay: 100
      });

      // Update live caption
      steps.push({
        action: 'setState',
        handler: () => this.updateLiveCaption(segment.text, segment.translation),
        delay: 200
      });

      // Update floating caption (every other segment)
      if (i % 2 === 0 && floatingIndex < floatingCaptions.length) {
        const floatingCaption = floatingCaptions[floatingIndex];
        steps.push({
          action: 'setState',
          handler: () => this.updateFloatingCaption(
            floatingCaption.text,
            floatingCaption.translation,
            withTranslation
          ),
          delay: 100
        });
        floatingIndex++;
      }

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
        duration: 1000
      });
    }

    return steps;
  }

  createSegmentHTML(segment, withTranslation = false) {
    let html = `
      <div class="segment" data-translation="${segment.translation || ''}" style="padding: 16px 0;">
        <div class="segment-meta" style="gap: 4px;">
          <time>${segment.time}</time>
          <b>${segment.speaker}</b>
        </div>
        <div class="segment-copy">
          <p style="font-size: 18px; line-height: 1.8;">${segment.text}</p>
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
  }

  // Summary Demo Methods
  getSummaryDemo() {
    const { title, duration, date, summary, participants } = this.mockData.summary;

    return {
      name: 'summary',
      setupUI: () => this.setupSummaryUI(),
      steps: [
        { action: 'wait', duration: 800 },

        // Move to summary tab
        {
          action: 'moveCursor',
          target: '[data-demo-id="summary-tab"]',
          duration: 1000,
          delay: 400
        },
        { action: 'hover', duration: 300 },
        { action: 'click', duration: 300 },

        // Switch to summary view
        {
          action: 'setState',
          handler: () => this.showSummaryTab(),
          delay: 200
        },

        { action: 'wait', duration: 600 },

        // Move to generate button
        {
          action: 'moveCursor',
          target: '[data-demo-id="generate-summary-btn"]',
          duration: 900,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // Show generating state
        {
          action: 'setState',
          handler: () => this.showGeneratingSummary(),
          delay: 300
        },

        { action: 'wait', duration: 2000 },

        // Show summary content
        {
          action: 'setState',
          handler: () => this.showSummaryContent(summary),
          delay: 400
        },

        { action: 'wait', duration: 800 },

        // Scroll through summary
        {
          action: 'scrollToBottom',
          target: '[data-demo-id="summary-content"]',
          duration: 2000,
          delay: 600
        },

        { action: 'wait', duration: 1000 },

        // Move to participants
        {
          action: 'moveCursor',
          target: '[data-demo-id="participants-section"]',
          duration: 800,
          delay: 400
        },

        { action: 'wait', duration: 2000 }
      ]
    };
  }

  setupSummaryUI() {
    const { title, duration, date } = this.mockData.summary;

    const html = `
      <main class="app-shell">
        <aside class="sidebar">
          <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="Brevia" /></button>
          <button class="new-meeting"><span>+</span> 开始会议</button>
          <nav>
            <button class="nav-item active"><span>⌂</span> 所有会议</button>
            <button class="nav-item"><span>⚙</span> 设置</button>
          </nav>
        </aside>

        <section class="workspace">
          <header class="window-bar">
            <span>会议详情</span>
          </header>

          <section class="view active" style="display: block; opacity: 1; padding-top: 32px;">
            <button class="back">← 返回会议库</button>

            <header class="detail-head" style="margin-top: 32px;">
              <div>
                <p class="eyebrow">本地会议</p>
                <h1 style="font-size: 48px;">${title}</h1>
                <p style="margin-top: 12px; font-size: 15px; color: #666;">Duration: ${duration} · ${date}</p>
              </div>
              <div class="detail-actions">
                <button class="primary-action">导出 <span>↓</span></button>
              </div>
            </header>

            <div class="detail-layout" style="margin-top: 48px; display: grid; grid-template-columns: 2fr 1fr; gap: 32px;">
              <section class="final-transcript">
                <div class="tabbar">
                  <button class="tab active" data-demo-id="transcript-tab">逐字稿</button>
                  <button class="tab" data-demo-id="summary-tab">会议纪要</button>
                </div>

                <div class="transcript-body" data-demo-id="transcript-content" style="padding-top: 24px;">
                  <div class="segment" style="padding: 12px 0;">
                    <div class="segment-meta" style="gap: 4px;">
                      <time>00:03</time>
                      <b>Alex Chen</b>
                    </div>
                    <div class="segment-copy">
                      <p>Good morning everyone, thanks for joining today's Q3 product review.</p>
                    </div>
                  </div>
                  <div class="segment" style="padding: 12px 0;">
                    <div class="segment-meta" style="gap: 4px;">
                      <time>00:09</time>
                      <b>Sarah Kim</b>
                    </div>
                    <div class="segment-copy">
                      <p>Thanks Alex. I'll start with the engineering update.</p>
                    </div>
                  </div>
                </div>

                <div class="transcript-body" data-demo-id="summary-body" style="display: none; padding-top: 24px;">
                  <button class="primary-action" data-demo-id="generate-summary-btn" style="margin: 0;">
                    生成会议纪要 <span>→</span>
                  </button>
                  <div data-demo-id="summary-content" style="margin-top: 32px; max-height: 500px; overflow-y: auto;"></div>
                </div>
              </section>

              <aside class="notes">
                <h2 style="font-size: 18px; margin-top: 8px;">参会者</h2>
                <section data-demo-id="participants-section" style="margin-top: 16px;">
                  <div class="person" style="padding: 12px 0; display: grid; grid-template-columns: 32px 1fr; gap: 12px;">
                    <div class="avatar">AC</div>
                    <span><b>Alex Chen</b><small>Product Manager</small></span>
                  </div>
                  <div class="person" style="padding: 12px 0; display: grid; grid-template-columns: 32px 1fr; gap: 12px;">
                    <div class="avatar">SK</div>
                    <span><b>Sarah Kim</b><small>Engineering Lead</small></span>
                  </div>
                  <div class="person" style="padding: 12px 0; display: grid; grid-template-columns: 32px 1fr; gap: 12px;">
                    <div class="avatar">MT</div>
                    <span><b>Mike Torres</b><small>QA Engineer</small></span>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </section>
      </main>
    `;

    return html;
  }

  showSummaryTab() {
    const transcriptTab = this.engine.viewport.querySelector('[data-demo-id="transcript-tab"]');
    const summaryTab = this.engine.viewport.querySelector('[data-demo-id="summary-tab"]');
    const transcriptContent = this.engine.viewport.querySelector('[data-demo-id="transcript-content"]');
    const summaryBody = this.engine.viewport.querySelector('[data-demo-id="summary-body"]');

    if (transcriptTab) transcriptTab.classList.remove('active');
    if (summaryTab) summaryTab.classList.add('active');
    if (transcriptContent) transcriptContent.style.display = 'none';
    if (summaryBody) summaryBody.style.display = 'block';
  }

  showGeneratingSummary() {
    const btn = this.engine.viewport.querySelector('[data-demo-id="generate-summary-btn"]');
    if (btn) {
      btn.innerHTML = '<span class="button-spinner"></span> 正在生成...';
      btn.disabled = true;
      btn.style.cursor = 'wait';
      btn.style.opacity = '0.6';
    }
  }

  async showSummaryContent(summary) {
    const btn = this.engine.viewport.querySelector('[data-demo-id="generate-summary-btn"]');
    const content = this.engine.viewport.querySelector('[data-demo-id="summary-content"]');

    if (btn) {
      btn.style.display = 'none';
    }

    if (content) {
      const lines = summary.split('\n');
      let html = '<div class="markdown-content">';

      for (let line of lines) {
        if (line.startsWith('## ')) {
          html += `<h2 style="font-size: 18px; margin-top: 24px; font-weight: 500;">${line.substring(3)}</h2>`;
        } else if (line.startsWith('### ')) {
          html += `<h3 style="font-size: 14px; margin-top: 20px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">${line.substring(4)}</h3>`;
        } else if (line.startsWith('- ')) {
          html += `<p style="font-size: 14px; line-height: 1.8; color: #404040; margin: 8px 0;">${line.substring(2)}</p>`;
        } else if (line.trim()) {
          html += `<p style="font-size: 14px; line-height: 1.8; color: #404040; margin: 8px 0;">${line}</p>`;
        }
      }

      html += '</div>';

      content.innerHTML = html;
      content.style.opacity = '0';

      await this.engine.wait(50);

      content.style.transition = 'opacity 0.4s ease';
      content.style.opacity = '1';
    }
  }

  // Voiceprint Demo (simplified version)
  getVoiceprintDemo() {
    return {
      name: 'voiceprint',
      setupUI: () => this.setupVoiceprintUI(),
      steps: [
        { action: 'wait', duration: 800 },

        {
          action: 'moveCursor',
          target: '[data-demo-id="speaker-profiles"]',
          duration: 1000,
          delay: 400
        },

        { action: 'wait', duration: 1500 },

        {
          action: 'moveCursor',
          target: '[data-demo-id="test-recognition-btn"]',
          duration: 800,
          delay: 600
        },
        { action: 'hover', duration: 300 },
        { action: 'click', duration: 300 },

        {
          action: 'setState',
          handler: () => this.showRecognitionDemo(),
          delay: 400
        },

        { action: 'wait', duration: 1000 },

        ...this.generateRecognitionSteps(),

        { action: 'wait', duration: 2000 }
      ]
    };
  }

  setupVoiceprintUI() {
    const { profiles } = this.mockData.voiceprint;

    const html = `
      <main class="app-shell">
        <aside class="sidebar">
          <button class="brand"><img src="../frontend/assets/brevia-logo.svg" alt="Brevia" /></button>
          <button class="new-meeting"><span>+</span> 开始会议</button>
          <nav>
            <button class="nav-item"><span>⌂</span> 所有会议</button>
            <button class="nav-item active"><span>⚙</span> 设置</button>
          </nav>
        </aside>

        <section class="workspace">
          <header class="window-bar">
            <span>设置</span>
          </header>

          <section class="view active" style="display: block; opacity: 1; padding-top: 32px;">
            <button class="back">← 返回会议库</button>

            <p class="eyebrow" style="margin-top: 24px;">设置</p>
            <h1 style="font-size: 48px; margin-top: 8px;">说话人识别</h1>

            <div style="margin-top: 48px; max-width: 900px;">
              <div style="border: 1px solid #e5e5e5; padding: 32px;">
                <h2 style="font-size: 22px; font-weight: 400;">声纹档案</h2>
                <p style="margin-top: 8px; font-size: 13px; color: #666;">为团队成员录制声纹样本，Brevia 将在会议中自动识别说话人</p>

                <div data-demo-id="speaker-profiles" style="margin-top: 24px;">
                  ${profiles.map(profile => `
                    <div class="person" style="padding: 16px 0; border-bottom: 1px solid #e5e5e5; display: grid; grid-template-columns: 32px 1fr; gap: 12px;">
                      <div class="avatar">${profile.avatar}</div>
                      <span>
                        <b>${profile.name}</b>
                        <small>Voice sample: ${profile.sample}</small>
                      </span>
                    </div>
                  `).join('')}
                </div>

                <button class="secondary" style="margin-top: 20px;">+ 添加说话人</button>
              </div>

              <div style="border: 1px solid #e5e5e5; padding: 32px; margin-top: 24px;">
                <h2 style="font-size: 22px; font-weight: 400;">识别模型</h2>
                <dl style="margin-top: 16px;">
                  <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e5e5;">
                    <dt style="color: #666;">分离模型</dt>
                    <dd style="margin: 0;">Pyannote Segmentation 3.0</dd>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                    <dt style="color: #666;">声纹模型</dt>
                    <dd style="margin: 0;">3D-Speaker (ERes2Net Base)</dd>
                  </div>
                </dl>

                <button class="secondary" data-demo-id="test-recognition-btn" style="margin-top: 24px;">测试识别效果</button>
              </div>
            </div>
          </section>
        </section>
      </main>
    `;

    return html;
  }

  showRecognitionDemo() {
    const workspace = this.engine.viewport.querySelector('.workspace');
    if (!workspace) return;

    workspace.innerHTML = `
      <header class="window-bar">
        <span>识别测试</span>
      </header>

      <section class="view active" style="display: block; opacity: 1; padding-top: 32px;">
        <button class="back">← 返回设置</button>

        <h1 style="font-size: 36px; margin-top: 32px; margin-bottom: 24px;">声纹识别演示</h1>

        <div style="max-width: 900px;">
          <div data-demo-id="recognition-transcript" style="padding-top: 0;"></div>
        </div>
      </section>
    `;
  }

  generateRecognitionSteps() {
    const { recognition } = this.mockData.voiceprint;
    const steps = [];

    recognition.forEach((item, index) => {
      steps.push({
        action: 'appendSegment',
        target: '[data-demo-id="recognition-transcript"]',
        html: `
          <div class="segment" style="padding: 16px 0; border-bottom: 1px solid #e5e5e5;">
            <div class="segment-meta" style="gap: 4px;">
              <time>${item.time}</time>
              <b style="color: #16803c;">${item.speaker}</b>
            </div>
            <div class="segment-copy">
              <p style="font-size: 16px; line-height: 1.8;">${item.text}</p>
            </div>
          </div>
        `,
        duration: 200,
        delay: 600
      });

      steps.push({
        action: 'wait',
        duration: 1200
      });
    });

    return steps;
  }
}

// Export
window.DemoScenariosV2 = DemoScenariosV2;
