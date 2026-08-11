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
    '实时识别模型': 'Live Recognition Model',
    '精修模型': 'Refinement Model',
    '模型与设置': 'Models & Settings',
    '语音生成': 'Speech Generation',
    '声音': 'Voice',
    '语言': 'Language',
    '中文': 'Chinese',
    '输入要朗读的内容...': 'Enter text to read aloud...',

    // Live Meeting
    '实时转录': 'Live Transcription',
    '译文': 'Translation',
    '开': 'On',
    '关': 'Off',
    '说话人': 'Speaker',
    '说话人 1': 'Speaker 1',
    '说话人 2': 'Speaker 2',
    '说话人 3': 'Speaker 3',
    '参与者 : 0': 'Participants: 0',
    '等待识别说话人': 'Waiting to identify speakers',
    '正在录制': 'Recording',
    '暂停': 'Pause',
    '悬浮字幕': 'Floating Captions',
    '译文: 关': 'Translation: Off',
    '译文: 开': 'Translation: On',

    // Summary
    '会议纪要': 'Meeting Notes',
    '会议摘要': 'Summary',
    '关键决定': 'Key Decisions',
    '待办事项': 'Action Items',
    '下一步': 'Next Steps',
    '会议详情': 'Meeting Details',
    '本地会议': 'Local Meeting',
    'Q3 产品评审会议': 'Q3 Product Review',
    '2026年8月7日 · 45分钟': 'Aug 7, 2026 · 45 min',
    '精修': 'Refine',
    '声源分离': 'Separate Audio',
    '转发': 'Share',
    '导出': 'Export',
    '逐字稿': 'Transcript',
    '精修字稿': 'Refined Transcript',
    '双轨录音': 'Dual-track Audio',
    '先同步一下工程进度，实时转录引擎的性能优化基本完成了，延迟从原来的八百毫秒降到了三百毫秒以内。': 'First, an engineering update: performance work on the live transcription engine is nearly complete, reducing latency from 800 ms to under 300 ms.',
    '很好。多语言支持这块进展怎么样？我们这次要覆盖多少种语言？': 'Great. How is multilingual support progressing? How many languages will we cover this time?',
    '目前已经支持三十多种语言，主流语种的识别准确率都在百分之九十五以上。': 'We now support more than 30 languages, with over 95% recognition accuracy for major languages.',
    '本次会议评审了第三季度的产品进展，重点包括实时转录引擎的性能优化、多语言支持的扩展以及新版界面的设计方向。团队确认了发布时间节点和后续的测试计划。': 'This meeting reviewed third-quarter product progress, including live transcription performance, expanded multilingual support, and the direction for the new interface. The team confirmed release timing and the follow-up test plan.',
    '核心结论': 'Key Takeaways',
    '实时转录延迟优化至 300 毫秒以内': 'Live transcription latency reduced to under 300 ms',
    '多语言支持已覆盖 30+ 语种': 'Multilingual support now covers 30+ languages',
    '新版界面将于本季度末发布': 'The new interface will launch at the end of this quarter',
    '2026年8月7日 · 45分钟 · AI 会议纪要': 'Aug 7, 2026 · 45 min · AI Meeting Notes',
    '本次会议评审了第三季度的产品进展，重点包括实时转录引擎的性能优化、多语言支持的扩展以及新版界面的设计方向。实时转录延迟已优化至 300 毫秒以内，多语言支持覆盖 30 多种语种，主流语言识别准确率超过 95%。团队确认了新版界面将于本季度末发布，并明确了发布前的测试计划和责任分工。': 'This meeting reviewed third-quarter product progress, focusing on live transcription performance, expanded multilingual support, and the new interface. Live transcription latency is now under 300 ms, support covers more than 30 languages, and major-language accuracy exceeds 95%. The team confirmed a quarter-end launch with clear testing and ownership plans.',
    '实时转录引擎性能优化完成，端到端延迟从 800ms 降至 300ms 以内': 'Live transcription optimization is complete, reducing end-to-end latency from 800 ms to under 300 ms',
    '多语言支持已覆盖 30+ 语种，主流语言识别准确率超过 95%': 'Support covers 30+ languages, with over 95% accuracy for major languages',
    '新版用户界面确定于本季度末（9 月）正式发布': 'The new interface will officially launch at the end of this quarter (September)',
    '发布前需完成一轮完整的性能与兼容性测试': 'Complete a full performance and compatibility test cycle before release',
    '关键决策': 'Key Decisions',
    '性能优先：': 'Performance First:',
    '转录延迟作为本季度核心指标，持续跟进并保持在 300ms 以内': 'Keep transcription latency below 300 ms as a core quarterly metric',
    '多语言策略：': 'Multilingual Strategy:',
    '优先保障主流语种的准确率，长尾语种逐步迭代': 'Prioritize accuracy for major languages and iterate on long-tail languages',
    '界面改版：': 'Interface Redesign:',
    '新版界面需与现有功能保持兼容，分阶段灰度发布': 'Keep the new interface compatible with existing features and roll it out in stages',
    '行动项': 'Action Items',
    '完成实时转录引擎的性能压测': 'Complete load testing for the live transcription engine',
    '补充长尾语种的测试语料': 'Add test corpora for long-tail languages',
    '完成新版界面的高保真原型': 'Complete the high-fidelity prototype for the new interface',
    '制定发布前的灰度测试方案': 'Prepare the staged release test plan',
    '风险与挑战': 'Risks & Challenges',
    '多语言模型的内存占用可能影响低配设备的性能': 'Multilingual model memory use may affect lower-end devices',
    '发布时间较紧，测试周期需要额外的资源支持': 'The release timeline is tight and testing needs additional resources',
    '下次会议': 'Next Meeting',
    '2026年8月14日下午2点，继续跟进各项行动项的进展与发布前准备情况。': 'Aug 14, 2026 at 2:00 PM, to review action-item progress and release readiness.',

    // Voiceprint
    '张伟': 'Alex Chen',
    '李娜': 'Sarah Kim',
    '王强': 'Mike Torres',
    '声纹识别': 'Voiceprint Recognition',
    '实时会议': 'Live Meeting',
    '团队周会': 'Team Weekly Meeting',
    '参与者（已识别声纹）': 'Participants (identified voiceprints)',
    '系统已自动识别参与者的声纹特征，无需手动标注说话人。': 'Voiceprints are identified automatically, so no manual speaker labels are needed.',
    '项目经理': 'Project Manager',
    '前端工程师': 'Frontend Engineer',
    '后端工程师': 'Backend Engineer',
    '设计师': 'Designer',
    '大家好，我们开始今天的周会吧。': 'Good morning, everyone. Let’s start today’s weekly meeting.',
    '好的，我先汇报一下我这边的工作进展。': 'Sure. I’ll start with an update on my work.',
    '上周遇到的技术问题已经解决了。': 'The technical issue we encountered last week has been resolved.',
    '我这边的进度已经完成了百分之八十。': 'My work is now 80% complete.'
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

  // All scenario state changes use this shared renderer, including detail views.
  const originalFadeSwapContent = DemoScenariosV3.prototype._fadeSwapContent;
  DemoScenariosV3.prototype._fadeSwapContent = function (html, callback) {
    return originalFadeSwapContent.call(this, translateHTML(html), callback);
  };

  const originalOpenSummaryModal = DemoScenariosV3.prototype.openSummaryModal;
  DemoScenariosV3.prototype.openSummaryModal = function () {
    originalOpenSummaryModal.call(this);
    const modal = this.engine.viewport.querySelector('.summary-modal');
    if (modal) modal.innerHTML = translateHTML(modal.innerHTML);
  };

  const originalEnableTranslation = DemoScenariosV3.prototype.enableTranslation;
  DemoScenariosV3.prototype.enableTranslation = function () {
    originalEnableTranslation.call(this);
    const toggle = this.engine.viewport.querySelector('[data-demo-id="translation-toggle"]');
    if (toggle) toggle.textContent = 'Translation: On';
  };

  const originalGenerateVoiceprintSegments = DemoScenariosV3.prototype.generateVoiceprintSegmentSteps;
  DemoScenariosV3.prototype.generateVoiceprintSegmentSteps = function (segments) {
    return originalGenerateVoiceprintSegments.call(this, segments.map(segment => ({
      ...segment,
      provisional: translateText(segment.provisional),
      speaker: translateText(segment.speaker),
      text: translateText(segment.text)
    })));
  };

  const originalUpdateVoiceprintParticipants = DemoScenariosV3.prototype.updateVoiceprintParticipants;
  DemoScenariosV3.prototype.updateVoiceprintParticipants = function (speakers) {
    originalUpdateVoiceprintParticipants.call(this, speakers);
    const list = this.engine.viewport.querySelector('[data-demo-id="voiceprint-participants"]');
    if (list) list.innerHTML = translateHTML(list.innerHTML);
  };

  // Helper: translate HTML string
  function translateHTML(html) {
    if (!html || typeof html !== 'string') return html;
    let result = html;
    for (const [zh, en] of Object.entries(translations).sort(([a], [b]) => b.length - a.length)) {
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
