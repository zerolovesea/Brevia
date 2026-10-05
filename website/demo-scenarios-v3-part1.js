/**
 * Demo Scenarios V3 - Pixel-perfect UI restoration
 * 基于真实产品截图，精确还原所有UI元素
 */

class DemoScenariosV3 {
  constructor(engine, timeline) {
    this.engine = engine;
    this.timeline = timeline;
    this.mockData = this.initMockData();
  }

  sidebarHtml(active = 'home') {
    return String.raw`<aside class="sidebar" aria-label="主导航">
        <button class="brand" data-view="home" aria-label="Brevia 首页"><span class="brand-mark" aria-hidden="true">言</span><img src="../frontend/assets/brevia-logo.svg" alt="brevia" /></button>
        <button class="new-meeting" data-demo-id="new-meeting-btn" data-view="prepare" data-prepare-mode="record"><span class="new-meeting-icon">+</span><span class="new-meeting-label">开始会议</span></button>
        <button class="import-recording" id="import-recording" data-view="prepare" data-prepare-mode="import" type="button"><span class="import-recording-icon" aria-hidden="true">↥</span><span class="import-recording-label">导入录音</span></button>
        <nav>

          <button class="nav-item ${active === 'home' ? 'active' : ''}" id="all-meetings" data-view="home" aria-expanded="true"><span>⌂</span> 所有会议</button>
          <div class="workspace-subnav"><div class="workspace-subnav-content"><button class="workspace-item active"><span class="workspace-label">公开工作区</span><span class="workspace-count">3</span></button><button class="new-workspace">+ 新建工作区</button></div></div>
          <button class="nav-item" id="recently-deleted" data-view="home"><span>◷</span> 最近删除</button>
          <button class="nav-item ${active === 'settings' ? 'active' : ''}" data-view="settings"><span>⚙</span> 设置</button>
        </nav>
        </aside>`;
  }

  liveControlsHtml() {
    return String.raw`<div class="floating-control-bar live-control-bar"><div class="control-source"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="7" y="2" width="6" height="11" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3m-3 0h6"/></svg><i class="input-meter" style="--level: .65" data-live-mic-level aria-hidden="true"></i><span id="live-input-label">输入良好</span></div><div class="control-primary"><button class="pause-button" id="pause">Ⅱ 暂停</button><button class="end-button" id="end-meeting">结束会议</button></div><div class="control-secondary"><button class="mark-button" id="mark-important" type="button" title="重点"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 3h10v14l-5-3-5 3z"/></svg><span>重点</span></button><div class="live-more"><button class="live-more-toggle" id="live-more-toggle" type="button" aria-label="更多" title="更多" aria-controls="live-more-panel" aria-expanded="false">•••</button><div class="live-more-panel" id="live-more-panel" hidden><div class="live-caption-controls"><button class="floating-caption-toggle" id="floating-caption-toggle" data-demo-id="caption-toggle" data-enabled="false" title="悬浮字幕">字幕</button><div class="translation-menu flow-select"><button class="translation-toggle" id="translation-toggle" data-demo-id="translation-toggle" data-enabled="false" aria-expanded="false">翻译：关</button><div class="flow-select-options" id="translation-options" hidden></div></div><div class="live-model-menu flow-select" id="live-model-menu" hidden><button class="live-model-toggle" id="live-model-toggle" aria-expanded="false">识别模型</button><div class="flow-select-options" id="live-model-options" hidden></div></div></div></div></div></div></div>`;
  }

  initMockData() {
    return {
      transcription: {
        meetingTitle: '会议 20260810',
        language: '自动检测',
        translateTo: '不需要译文',
        participants: '留空自动匹配',
        category: '未分类',
        segments: [
          { time: '00:03', speaker: 'Alex Chen', text: 'Good morning everyone, thanks for joining today\'s Q3 product review.', translation: '大家早上好，感谢参加今天的第三季度产品评审。' },
          { time: '00:09', speaker: 'Sarah Kim', text: 'Thanks Alex. I\'ll start with the engineering update.', translation: '谢谢 Alex。我先介绍工程方面的更新。' },
          { time: '00:14', speaker: 'Alex Chen', text: 'Perfect. We have about 30 minutes for this session.', translation: '很好。我们这次会议大约30分钟。' },
          { time: '00:19', speaker: 'Sarah Kim', text: 'The new AI transcription features are on track for release.', translation: '新的AI转录功能按计划将要发布。' },
          { time: '00:25', speaker: 'Mike Torres', text: 'The beta testing feedback has been excellent so far.', translation: '目前beta测试的反馈非常好。' },
          { time: '00:31', speaker: 'Alex Chen', text: 'Great to hear. Let\'s discuss the timeline in detail.', translation: '很高兴听到这个消息。让我们详细讨论一下时间表。' }
        ]
      }
    };
  }

  /**
   * Demo 1: 完整的实时转录流程
   */
  getTranscriptionDemo() {
    const { meetingTitle, language, translateTo, participants, category, segments } = this.mockData.transcription;

    return {
      name: 'transcription',
      setupUI: () => this.setupHomeUI(),
      steps: [
        { action: 'wait', duration: 800 },

        // 移动到侧边栏的"开始会议"按钮
        {
          action: 'moveCursor',
          target: '[data-demo-id="new-meeting-btn"]',
          duration: 1200,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // 切换到准备页面
        {
          action: 'setState',
          handler: () => this.showPrepareView(),
          delay: 300
        },

        { action: 'wait', duration: 800 },

        // 填写会议名称
        {
          action: 'moveCursor',
          target: '[data-demo-id="meeting-title"]',
          duration: 900,
          delay: 400
        },
        { action: 'click', duration: 200 },
        {
          action: 'setState',
          handler: () => this.fillMeetingTitle(meetingTitle),
          delay: 100
        },

        { action: 'wait', duration: 600 },

        // 点击开始录制
        {
          action: 'moveCursor',
          target: '[data-demo-id="start-recording"]',
          duration: 1000,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // 切换到实时会议
        {
          action: 'setState',
          handler: () => this.showLiveView(meetingTitle),
          delay: 400
        },

        { action: 'wait', duration: 1000 },

        // 显示转录内容
        ...this.generateLiveSegmentSteps(segments, 0, 3),

        { action: 'wait', duration: 800 },

        // 从底部控制条的更多菜单开启翻译。
        { action: 'moveCursor', target: '#live-more-toggle', duration: 700 },
        { action: 'click', duration: 300 },
        { action: 'setState', handler: () => {
          this.engine.viewport.querySelector('#live-more-panel').hidden = false;
        } },
        // 开启翻译
        {
          action: 'moveCursor',
          target: '[data-demo-id="translation-toggle"]',
          duration: 900,
          delay: 400
        },
        { action: 'hover', duration: 300 },
        { action: 'click', duration: 300 },

        {
          action: 'setState',
          handler: () => this.enableTranslation(),
          delay: 200
        },

        { action: 'wait', duration: 600 },

        ...this.generateLiveSegmentSteps(segments, 3, 6, true),

        { action: 'wait', duration: 1200 },

        // 手动在笔记编辑器中写笔记：移动光标到笔记区域，点击后逐字输入。
        {
          action: 'moveCursor',
          target: '[data-demo-id="notes-editor"]',
          duration: 1000,
          delay: 400
        },
        { action: 'click', duration: 250 },
        {
          action: 'setState',
          handler: () => this.typeNoteIntoEditor('待办：周五前补一版本地部署预算。'),
          delay: 150
        },

        { action: 'wait', duration: 2200 }
      ]
    };
  }

  typeNoteIntoEditor(text) {
    const editor = this.engine.viewport.querySelector('[data-demo-id="notes-editor"]');
    if (!editor) return;
    editor.parentElement.querySelector('.ai-assist-empty')?.remove();
    return this.engine.typeText(editor, text, 1, 55);
  }

  // ===== UI Setup Methods =====

  setupHomeUI() {
    // 精确还原新版主页：无 page-head 主操作按钮，搜索“搜索会议…”，会议行无麦克风图标
    const html = String.raw`
      <main class="app-shell">
        ${this.sidebarHtml()}

        <section class="workspace">
          <header class="window-bar">
            <div class="traffic"><i></i><i></i><i></i></div>
            <span id="crumb">所有会议</span>
            <div class="window-actions">
              <a class="icon-button" href="https://github.com/zerolovesea/Brevia" target="_blank" rel="noopener" title="GitHub">
                <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
              </a>
              <div class="language-menu">
                <button class="icon-button" title="切换语言">文</button>
              </div>
              <button class="icon-button" title="切换主题">◐</button>
            </div>
          </header>

          <section class="view active" id="home-view">
            <div class="page-head">
              <div>
                <button class="eyebrow" id="home-eyebrow" type="button" disabled>会议库</button>
                <h1 id="home-slogan">听见讨论，留下下一步。</h1>
              </div>
            </div>

            <div class="library-toolbar">
              <div class="library-search"><label class="search">
                <span>⌕</span>
                <input type="search" placeholder="搜索会议、字幕或说话人…" />
              </label></div>
              <button class="meeting-select-all" id="meeting-select-all" type="button" hidden>全选</button>
            </div>

            <section class="meeting-list" aria-label="最近会议">
              <div class="meeting-row">
                <div class="meeting-main">
                  <h2>产品周例会 · 第 32 周</h2>
                  <p>
                    <time>8月7日 15:11</time>
                    <span>·</span>
                    <span>38 分钟</span>
                  </p>
                  <div class="meeting-tags">
                    <div class="tag">产品</div>
                    <div class="tag">规划</div>
                  </div>
                </div>
                <div class="meeting-status">
                  <span class="status complete">已整理</span>
                  <small>本地录音</small>
                </div>
                <div class="meeting-actions">
                  <button class="more" title="更多操作">⋯</button>
                </div>
              </div>

              <div class="meeting-row">
                <div class="meeting-main">
                  <h2>客户访谈 · 华东团队</h2>
                  <p>
                    <time>8月6日 20:40</time>
                    <span>·</span>
                    <span>47 分钟</span>
                  </p>
                  <div class="meeting-tags">
                    <div class="tag">客户</div>
                    <div class="tag">访谈</div>
                  </div>
                </div>
                <div class="meeting-status">
                  <span class="status complete">已整理</span>
                  <small>本地录音</small>
                </div>
                <div class="meeting-actions">
                  <button class="more" title="更多操作">⋯</button>
                </div>
              </div>

              <div class="meeting-row">
                <div class="meeting-main">
                  <h2>设计走查 · 桌面端</h2>
                  <p>
                    <time>8月6日 07:54</time>
                    <span>·</span>
                    <span>26 分钟</span>
                  </p>
                  <div class="meeting-tags">
                    <div class="tag">设计</div>
                    <div class="tag">体验</div>
                  </div>
                </div>
                <div class="meeting-status">
                  <span class="status complete">已整理</span>
                  <small>本地录音</small>
                </div>
                <div class="meeting-actions">
                  <button class="more" title="更多操作">⋯</button>
                </div>
              </div>
            </section>
          </section>
        </section>
      </main>
    `;
    return html;
  }

  /**
   * Demo 2: 会议纪要展示
   */
  getSummaryDemo() {
    return {
      name: 'summary',
      setupUI: () => this.setupSummaryUI(),
      steps: [
        { action: 'wait', duration: 800 },

        // 移动到会议列表中的某个会议
        {
          action: 'moveCursor',
          target: '.meeting-row:first-child',
          duration: 1200,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // 切换到详情视图
        {
          action: 'setState',
          handler: () => this.showSummaryDetail(),
          delay: 300
        },

        { action: 'wait', duration: 1200 },

        // 移动到右侧纪要面板
        {
          action: 'moveCursor',
          target: '.notes',
          duration: 800,
          delay: 400
        },

        { action: 'wait', duration: 1000 },

        // 展开纪要，与应用内的双栏切换一致。
        {
          action: 'moveCursor',
          target: '[data-toggle-detail-mode="summary"]',
          duration: 600,
          delay: 400
        },
        { action: 'hover', duration: 400 },
        { action: 'click', duration: 300 },

        // 将纪要切换到主栏。
        {
          action: 'setState',
          handler: () => this.engine.viewport.querySelector('.detail-layout').classList.add('is-summary-mode'),
          delay: 300
        },

        { action: 'wait', duration: 1200 },

        { action: 'setState', handler: () => this.engine.viewport.querySelector('#detail-view').classList.add('is-header-collapsed') },
        // 滚动浏览完整内容
        {
          action: 'scrollToBottom',
          target: '.summary-preview',
          duration: 3500,
          delay: 200
        },

        { action: 'setState', handler: () => { this.engine.viewport.querySelector('.summary-preview').scrollTop = 0; } },
        { action: 'wait', duration: 500 },
        { action: 'moveCursor', target: '[data-copy-summary]', duration: 700 },
        { action: 'click', duration: 300 },
        { action: 'setState', handler: () => {
          const button = this.engine.viewport.querySelector('[data-copy-summary]');
          button.textContent = '✓';
        } },
        { action: 'hideCursor' },
        { action: 'wait', duration: 2200 }
      ]
    };
  }

  /**
   * Demo 3: 声纹识别展示
   */
  getVoiceprintDemo() {
    const segments = [
      { time: '00:14:12', provisional: '说话人 1', speaker: '张伟', text: '大家好，我们开始今天的周会吧。' },
      { time: '00:14:28', provisional: '说话人 2', speaker: '李娜', text: '好的，我先汇报一下我这边的工作进展。' },
      { time: '00:14:45', provisional: '说话人 3', speaker: '王强', text: '上周遇到的技术问题已经解决了。' },
      { time: '00:15:18', provisional: '说话人 2', speaker: '李娜', text: '我这边的进度已经完成了百分之八十。' }
    ];

    return {
      name: 'voiceprint',
      setupUI: () => this.setupVoiceprintUI(),
      steps: [
        { action: 'wait', duration: 800 },

        // 显示声纹识别的转录内容
        ...this.generateVoiceprintSegmentSteps(segments),

        { action: 'wait', duration: 2000 }
      ]
    };
  }

  // 继续在下一个文件中...
}

window.DemoScenariosV3 = DemoScenariosV3;
