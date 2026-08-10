/**
 * Demo i18n English Patch
 * Intercepts and translates Chinese UI strings to English before demo render.
 * Loads after scenarios, before demo-single.js.
 */

(function () {
  const translations = {
    // Navigation & Buttons
    '开始会议': 'Start Meeting',
    '所有会议': 'All Meetings',
    '最近删除': 'Recently Deleted',
    '设置': 'Settings',
    '返回会议库': '← Back to Library',
    '准备录制': 'Prepare Recording',
    '开始一场会议': 'Start a Meeting',
    '开始录制': 'Start Recording',
    '结束会议': 'End Meeting',
    '导入录音': 'Import Audio',
    '管理模型': 'Manage Models',
    '查看完整内容': 'View Full Content',
    '更多操作': 'More Actions',

    // Form Labels
    '会议名称': 'Meeting Title',
    '会议语言': 'Meeting Language',
    '译文目标': 'Translation Target',
    '预期说话人数': 'Expected Speakers',
    '分类标签': 'Category',
    '录制音频': 'Record Audio',
    '我的麦克风': 'My Microphone',
    '系统音频': 'System Audio',
    '系统默认麦克风': 'System Default Microphone',
    '需要授予屏幕与系统音频权限': 'Requires screen and system audio permissions',
    '输入良好': 'Input Good',
    '已就绪': 'Ready',

    // Meeting Data
    '会议 20260810': 'Meeting 20260810',
    '自动检测': 'Auto-detect',
    '不需要译文': 'No translation needed',
    '留空自动匹配': 'Leave blank for auto-match',
    '未分类': 'Uncategorized',
    '会议库': 'Meeting Library',
    '把会议留在掌控之中。': 'Keep your meetings under control.',
    '搜索会议、逐字稿或标签': 'Search meetings, transcripts or tags',
    '所有分类': 'All Categories',
    '最近 30 天': 'Last 30 Days',

    // Meeting Status
    '已整理': 'Summarized',
    '本地资源': 'Local resource',
    '本地录音': 'Local Recording',
    '示例会议': 'Example meeting',

    // Model Info
    '计算设备': 'Computing Device',
    '实时字幕模型': 'Live Caption Model',
    '说话人分离模型': 'Speaker Diarization Model',
    '会后精修模型': 'Post-meeting Refinement Model',

    // Live Meeting
    '实时转录': 'Live Transcription',
    '译文': 'Translation',
    '开': 'On',
    '关': 'Off',
    '说话人': 'Speaker',
    '说话人 1': 'Speaker 1',
    '说话人 2': 'Speaker 2',
    '说话人 3': 'Speaker 3',

    // Summary
    '会议纪要': 'Meeting Notes',
    '会议摘要': 'Summary',
    '关键决定': 'Key Decisions',
    '待办事项': 'Action Items',
    '下一步': 'Next Steps',

    // Voiceprint
    '张伟': 'Alex Chen',
    '李娜': 'Sarah Kim',
    '王强': 'Mike Torres',
    '声纹识别': 'Voiceprint Recognition'
  };

  // Intercept DemoScenariosV3 methods to translate output
  const originalSetupHomeUI = DemoScenariosV3.prototype.setupHomeUI;
  DemoScenariosV3.prototype.setupHomeUI = function () {
    let html = originalSetupHomeUI.call(this);
    return translateHTML(html);
  };

  if (DemoScenariosV3.prototype.setupPrepareUI) {
    const originalSetupPrepareUI = DemoScenariosV3.prototype.setupPrepareUI;
    DemoScenariosV3.prototype.setupPrepareUI = function () {
      let html = originalSetupPrepareUI.call(this);
      return translateHTML(html);
    };
  }

  if (DemoScenariosV3.prototype.setupLiveUI) {
    const originalSetupLiveUI = DemoScenariosV3.prototype.setupLiveUI;
    DemoScenariosV3.prototype.setupLiveUI = function (title) {
      let html = originalSetupLiveUI.call(this, translateText(title));
      return translateHTML(html);
    };
  }

  if (DemoScenariosV3.prototype.setupSummaryUI) {
    const originalSetupSummaryUI = DemoScenariosV3.prototype.setupSummaryUI;
    DemoScenariosV3.prototype.setupSummaryUI = function () {
      let html = originalSetupSummaryUI.call(this);
      return translateHTML(html);
    };
  }

  if (DemoScenariosV3.prototype.setupVoiceprintUI) {
    const originalSetupVoiceprintUI = DemoScenariosV3.prototype.setupVoiceprintUI;
    DemoScenariosV3.prototype.setupVoiceprintUI = function () {
      let html = originalSetupVoiceprintUI.call(this);
      return translateHTML(html);
    };
  }

  // Translate segment text
  if (DemoScenariosV3.prototype.showPrepareView) {
    const originalShowPrepareView = DemoScenariosV3.prototype.showPrepareView;
    DemoScenariosV3.prototype.showPrepareView = function () {
      let html = originalShowPrepareView.call(this);
      return translateHTML(html);
    };
  }

  // Helper: translate HTML string
  function translateHTML(html) {
    if (!html || typeof html !== 'string') return html;
    let result = html;
    for (const [zh, en] of Object.entries(translations)) {
      // Use word boundaries where appropriate to avoid partial matches
      const escaped = zh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), en);
    }
    return result;
  }

  // Helper: translate plain text
  function translateText(text) {
    if (!text || typeof text !== 'string') return text;
    return translations[text] || text;
  }

  // Patch mock data to English
  const originalInitMockData = DemoScenariosV3.prototype.initMockData;
  DemoScenariosV3.prototype.initMockData = function () {
    const data = originalInitMockData.call(this);
    if (data.transcription) {
      data.transcription.meetingTitle = 'Meeting 20260810';
      data.transcription.language = 'Auto-detect';
      data.transcription.translateTo = 'No translation needed';
      data.transcription.participants = 'Leave blank for auto-match';
      data.transcription.category = 'Uncategorized';
    }
    return data;
  };

  console.log('[i18n-en] English translation patch loaded');
})();
