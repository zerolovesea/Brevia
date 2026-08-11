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
                <div class="tts-selects">
                  <label class="config-select-field">
                    声音
                    <div class="flow-select">
                      <button class="flow-select-toggle" type="button">
                        中文 <span>⌄</span>
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

                <input type="text" placeholder="输入要朗读的内容..." style="width: 100%; padding: 8px; border: 1px solid #e5e5e5; border-radius: 4px; margin-top: 12px;" />
              </section>
            </aside>
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
            <div>
              <p class="eyebrow">本地会议</p>
              <h1>Q3 产品评审会议</h1>
              <p>2026年8月7日 · 45分钟</p>
            </div>
            <div class="detail-actions">
              <button class="secondary">精修</button>
              <button class="secondary">声源分离</button>
              <button class="secondary">转发</button>
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
          </section>

          <div class="detail-layout">
            <section class="final-transcript">
              <div class="tabbar">
                <button class="tab active">逐字稿</button>
                <button class="tab">精修字稿</button>
                <button class="tab">双轨录音</button>
              </div>

              <div class="transcript-body">
                <article class="segment">
                  <div class="segment-meta">
                    <time>01:39</time>
                    <b>李娜</b>
                  </div>
                  <div class="segment-copy">
                    <p>先同步一下工程进度，实时转录引擎的性能优化基本完成了，延迟从原来的八百毫秒降到了三百毫秒以内。</p>
                  </div>
                </article>

                <article class="segment">
                  <div class="segment-meta">
                    <time>01:54</time>
                    <b>张伟</b>
                  </div>
                  <div class="segment-copy">
                    <p>很好。多语言支持这块进展怎么样？我们这次要覆盖多少种语言？</p>
                  </div>
                </article>

                <article class="segment">
                  <div class="segment-meta">
                    <time>02:01</time>
                    <b>李娜</b>
                  </div>
                  <div class="segment-copy">
                    <p>目前已经支持三十多种语言，主流语种的识别准确率都在百分之九十五以上。</p>
                  </div>
                </article>
              </div>
            </section>

            <aside class="notes">
              <h2>Q3 产品评审会议</h2>

              <section>
                <h3>会议摘要</h3>
                <p style="font-size: 14px; color: #666; line-height: 1.6;">
                  本次会议评审了第三季度的产品进展，重点包括实时转录引擎的性能优化、多语言支持的扩展以及新版界面的设计方向。团队确认了发布时间节点和后续的测试计划。
                </p>
              </section>

              <section>
                <h3>核心结论</h3>
                <ul style="font-size: 13px; line-height: 1.8; color: #404040;">
                  <li>实时转录延迟优化至 300 毫秒以内</li>
                  <li>多语言支持已覆盖 30+ 语种</li>
                  <li>新版界面将于本季度末发布</li>
                </ul>
              </section>

              <button class="text-button" data-demo-id="view-full-summary" style="margin-top: 20px;">查看完整内容 →</button>
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
          <span>实时会议</span>
          <div class="window-actions">
            <button class="icon-button">◐</button>
          </div>
        </header>

        <section class="view active" id="live-view">
          <header class="live-header">
            <div class="live-title">
              <strong>团队周会</strong>
              <span class="recording"><i></i> 正在录制</span>
            </div>
            <time id="timer">00:15:23</time>
            <button class="pause-button">Ⅱ 暂停</button>
            <button class="end-button">结束会议</button>
          </header>

          <div class="live-layout">
            <section class="transcript">
              <div class="section-heading">
                <div class="current-caption">
                  <p class="eyebrow">实时字幕</p>
                  <h1 id="live-caption" aria-live="polite"></h1>
                </div>
              </div>

              <div class="transcript-scroll" id="transcript-scroll"></div>
            </section>

            <aside class="live-panel">
              <section>
                <p class="eyebrow" style="margin-bottom: 16px;">参与者（已识别声纹）</p>
                <div class="participants-list" data-demo-id="voiceprint-participants">
                  <p class="participants-empty">等待识别说话人</p>
                </div>
              </section>

              <section>
                <p class="eyebrow">声纹识别</p>
                <div class="live-settings">
                  <p style="font-size: 13px; color: #666; line-height: 1.6;">
                    系统已自动识别参与者的声纹特征，无需手动标注说话人。
                  </p>
                </div>
              </section>
            </aside>
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

    // 逐字打出字幕（同步更新顶部大字幕和段落文本）
    steps.push({
      action: 'setState',
      handler: async () => {
        const caption = this.engine.viewport.querySelector('#live-caption');
        const segText = this.engine.viewport.querySelector(`[data-demo-id="${segId}-text"]`);
        const scroll = this.engine.viewport.querySelector('#transcript-scroll');
        const chars = segment.text.split('');

        if (caption) caption.textContent = '';
        if (segText) segText.textContent = '';

        for (let i = 0; i < chars.length; i++) {
          if (this.engine.isPaused) {
            await this.engine.wait(100);
            i--;
            continue;
          }
          const ch = chars[i];
          if (caption) caption.textContent += ch;
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

DemoScenariosV3.prototype.updateVoiceprintParticipants = function(speakers) {
  const list = this.engine.viewport.querySelector('[data-demo-id="voiceprint-participants"]');
  if (!list) return;

  const colors = ['blue', 'gray', 'green'];
  const roles = ['项目经理', '前端工程师', '后端工程师', '设计师'];

  list.innerHTML = speakers.map((speaker, index) => {
    const initial = speaker.charAt(0);
    const color = colors[index % colors.length];
    const role = roles[index % roles.length];

    return `
      <article class="person">
        <div class="avatar ${color}">${initial}</div>
        <span>
          <b>${speaker}</b>
          <small>${role}</small>
        </span>
      </article>
    `;
  }).join('');
};
