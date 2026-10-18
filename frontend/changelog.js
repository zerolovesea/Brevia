/* 应用内更新日志；按版本倒序维护，界面文案保留在 i18n-data.js。 */
(() => {
  const releases = [
    {
      'version': '1.4.3',
      'date': '2026-10-18',
      'current': true,
      'previousVersion': '1.4.2',
      'contributors': [],
      'zh': {
        'summary':
          '修复 Windows 会后精修启动卡死，完善后台进程收尾，并修复设置、设备连接与安装更新相关问题。',
        'what': [],
        'improved': [
          {
            'text': '切换设置页与保存 AI 配置时保留当前页面，完善会议纪要生成中的反馈与动效。',
            'commit': 'e8c055148c67843e70843e17b213cee88517d480',
          },
          {
            'text': '统一分析进程的关闭与异常清理，防止后台进程残留及清理失败后继续加载模型。',
            'commit': '491a17bb97fd038b89de114b41125e401883a192',
          },
        ],
        'fixed': [
          {
            'text':
              '修复 Windows 精修分析子进程因继承命令输入管道而卡在启动阶段、进度长时间停在 15% 的问题。',
            'commit': 'c193323938e17cd07435a4d936209ad360d9c846',
          },
          {
            'text':
              '修复精修模型加载、字幕整理或保存失败后，界面仍停留在精修进行态的问题；严格执行分析启动及推理超时。',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
          {
            'text':
              'Windows 安装器不再在打开或取消时强制终止所有同名后台进程；应用内更新会在下载前和安装前检查录音及后台任务，避免中断会议。',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
          {
            'text':
              '修复 Windows 默认窗口下英文设备连接页多余滚动，并统一设备服务开关和配对码复制按钮的八语言可访问标签。',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
          {
            'text': '修复高级设置恢复默认后仍显示“已保存”的问题，并清理未使用的引导样式。',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
        ],
        'security': [],
        'changes': [
          {
            'text':
              'v1.4.3 为桌面版本，提供 macOS Apple Silicon 与 Windows x64 安装包；手机客户端不随本次桌面发布自动升级。',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
        ],
      },
      'en': {
        'summary':
          'Fixed Windows refinement startup freezes, strengthened background process cleanup, and resolved settings, device connection and update issues.',
        'what': [],
        'improved': [
          {
            'text':
              'Keep the current settings page when navigating or saving AI configuration, with clearer feedback and animation during meeting summary generation.',
            'commit': 'e8c055148c67843e70843e17b213cee88517d480',
          },
          {
            'text':
              'Unified analysis process shutdown and failure cleanup to prevent orphaned processes and further model loading after cleanup fails.',
            'commit': '491a17bb97fd038b89de114b41125e401883a192',
          },
        ],
        'fixed': [
          {
            'text':
              'Fixed Windows analysis subprocesses stalling during startup because they inherited the command input pipe, leaving refinement at 15%.',
            'commit': 'c193323938e17cd07435a4d936209ad360d9c846',
          },
          {
            'text':
              'Refinement now leaves the in-progress state when model loading, transcript assembly or saving fails. Analysis startup and inference deadlines are enforced.',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
          {
            'text':
              'Opening or cancelling the Windows installer no longer forcibly stops every background process with the same name. In-app updates check recording and background tasks before downloading and before installation.',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
          {
            'text':
              'Removed unnecessary scrolling on the English device connection page at the default Windows window size, and localized accessibility labels for the service switch and pairing-code copy button in all eight languages.',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
          {
            'text':
              'Fixed advanced settings reporting “Saved” after restoring defaults, and removed unused onboarding styles.',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
        ],
        'security': [],
        'changes': [
          {
            'text':
              'v1.4.3 is a desktop release for Apple Silicon macOS and Windows x64. Mobile clients are not automatically upgraded by this desktop release.',
            'commit': '748f7b89c15428aafcc2c3ee4dcd1e8ebbb635d0',
          },
        ],
      },
    },
    {
      'version': '1.4.2',
      'date': '2026-10-17',
      'previousVersion': '1.4.1',
      'contributors': [],
      'zh': {
        'summary':
          '完善会议记录与声纹管理，重新设计 AI 功能引导，并修复录音尾帧、重点时间点、AI 引用更新和删除失败后的数据保留问题。',
        'what': [
          {
            'text': '会议重点可带时间点保存到笔记，并从笔记定位对应录音或字幕。',
            'commit': '1b819087efeae279745ebe12b37afb18a90eca21',
          },
        ],
        'improved': [
          {
            'text':
              '重新设计 AI 功能引导右侧，区分会中 AI 笔记与会后会议纪要；同时介绍手动、适度、主动三种模式，提供交互演示、重播与关闭后的静态示例，补齐八语言文案。',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text':
              '完善会议详情、设置、播放器与设备连接的布局和操作反馈；统一减少动态效果与键盘导航，鼠标操作不再显示多余的焦点外框。',
            'commit': '1b819087efeae279745ebe12b37afb18a90eca21',
          },
          {
            'text':
              '声纹管理与字幕取样使用实际配置的样本数和时长上限；进阶设置统一界面与后端校验，隐藏当前引擎不适用的选项。',
            'commit': 'e4b0e005b59cb39fddbf812d888b59cd3128cea6',
          },
        ],
        'fixed': [
          {
            'text': '修复暂停后结束录音可能丢失采集尾帧的问题。',
            'commit': 'd38a6ff88f73257d6eb0496f0f5f123ad96605dd',
          },
          {
            'text':
              '修复长语音精修窗口加上上下文后可能超过模型上限，以及旧版采样率和轻声参数越界的问题。',
            'commit': 'd38a6ff88f73257d6eb0496f0f5f123ad96605dd',
          },
          {
            'text':
              '修复只修改一句字幕的说话人时影响其他字幕，以及不同字幕版本可能共用或误删声纹样本音频的问题。',
            'commit': 'd38a6ff88f73257d6eb0496f0f5f123ad96605dd',
          },
          {
            'text': '修复录音控制栏的重点标记使用上一句字幕时间，现按点击时的录音时间保存。',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text':
              '永久删除会议、示例会议或声纹档案时，文件清理失败会保留数据库记录与重试入口，避免残留音频失去管理入口。',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text': '修复 AI 笔记补充引用依据时因常量队列重新赋值而中断更新的问题。',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text': '修复引导页 AI 笔记标题和预览标题缺失，清理内容相同的重复翻译与未使用样式。',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
        ],
        'security': [],
        'changes': [
          {
            'text':
              '手机联动仅使用同一局域网的 HTTPS 配对与传输，移除旧远程中继和 WebRTC 连接路径；离开局域网后可继续本地录音，回到同一网络后补传。',
            'commit': '62894e6c96f1c6d94e42571f7ff670f6d14f291a',
          },
          {
            'text':
              'v1.4.2 为桌面版本，提供 macOS Apple Silicon 与 Windows x64 安装包；手机客户端不随本次桌面发布自动升级。',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
        ],
      },
      'en': {
        'summary':
          'Refined meeting notes and voiceprint management, redesigned AI onboarding, and fixed recording tails, highlight timestamps, AI evidence updates and data preservation after failed deletion.',
        'what': [
          {
            'text':
              'Save meeting highlights with timestamps and jump from notes to the corresponding recording or transcript.',
            'commit': '1b819087efeae279745ebe12b37afb18a90eca21',
          },
        ],
        'improved': [
          {
            'text':
              'Redesigned the right side of AI onboarding to distinguish in-meeting notes from post-meeting summaries. All three modes are explained together, with interactive previews, replay, static examples when disabled and copy in eight languages.',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text':
              'Refined meeting details, settings, playback and device connection layouts and feedback. Reduced-motion behavior and keyboard navigation are consistent, while mouse interactions avoid unnecessary focus outlines.',
            'commit': '1b819087efeae279745ebe12b37afb18a90eca21',
          },
          {
            'text':
              'Voiceprint management and transcript sampling use the configured sample and duration limits. Advanced settings share validation with the backend and hide options that do not apply to the active engine.',
            'commit': 'e4b0e005b59cb39fddbf812d888b59cd3128cea6',
          },
        ],
        'fixed': [
          {
            'text': 'Fixed audio tail frames being lost when ending a recording after pausing.',
            'commit': 'd38a6ff88f73257d6eb0496f0f5f123ad96605dd',
          },
          {
            'text':
              'Fixed refinement windows exceeding model limits after context was added, and migrated invalid legacy sample-rate and quiet-speech settings.',
            'commit': 'd38a6ff88f73257d6eb0496f0f5f123ad96605dd',
          },
          {
            'text':
              'Fixed renaming the speaker of one transcript segment affecting other segments, and voiceprint sample audio being shared or incorrectly removed across transcript versions.',
            'commit': 'd38a6ff88f73257d6eb0496f0f5f123ad96605dd',
          },
          {
            'text':
              'Highlights created from the recording controls now use the recording time at the click instead of the previous transcript segment’s timestamp.',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text':
              'If file cleanup fails while deleting a meeting, example meeting or voiceprint profile, its database record and retry path are preserved so remaining audio stays manageable.',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text':
              'Fixed AI note evidence updates failing because a pending suggestion queue was reassigned as a constant.',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
          {
            'text':
              'Restored missing AI note titles in onboarding and previews, and removed identical duplicate translations and unused styles.',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
        ],
        'security': [],
        'changes': [
          {
            'text':
              'Phone connectivity now uses HTTPS pairing and transfer on the same local network. The former remote relay and WebRTC paths are removed; recording can continue offline and upload after returning to the same network.',
            'commit': '62894e6c96f1c6d94e42571f7ff670f6d14f291a',
          },
          {
            'text':
              'v1.4.2 is a desktop release for Apple Silicon macOS and Windows x64. Mobile clients are not automatically upgraded by this desktop release.',
            'commit': '0ba597dd8400cf7d2b4e82e44cca2730033a1246',
          },
        ],
      },
    },
    {
      'version': '1.4.1',
      'date': '2026-10-15',
      'current': false,
      'previousVersion': '1.4.0',
      'contributors': [],
      'zh': {
        'summary':
          '新增 Apple Silicon 可选识别模型，精简首次使用引导，并修复声纹保留、PDF 导出和纪要生成的边界问题。',
        'what': [
          {
            'text':
              'Apple Silicon Mac 的模型库新增 Qwen3-ASR 1.7B 8bit 和 Whisper Large v3 Turbo，支持按需下载用于转写与会后精修。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
        ],
        'improved': [
          {
            'text':
              '首次使用引导只展示各语言推荐的识别模型，其他模型可在设置中按需下载；默认窗口与界面同步放大，提升可读性。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text': '更新中英文官网及完整会议演示，展示转写、AI 笔记采纳和纪要生成的实际操作流程。',
            'commit': 'b13e8a6702d2ed50886af3f7539eaea3550a7144',
          },
          {
            'text': '清理未使用的样式、脚本与重复音频，开发和设计资料归档至 dev 分支。',
            'commit': '14b3b4d87c8a658fe5d5b9142fdfafbe02b76698',
          },
        ],
        'fixed': [
          {
            'text':
              '修复启动清理可能误删默认名称的用户声纹或新下载的 Qwen3-ASR 模型；旧演示声纹清理保留后续添加的用户样本。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text': '修复含制表符列表或空标题的 Markdown 导出 PDF 时可能卡住的问题。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              '修复详细纪要被冲突的篇幅要求压缩，以及长会议分段纪要可能偏离指定输出语言的问题。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text': '麦克风设备失效时仅针对设备选择约束重试，避免掩盖其他采集约束错误。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              '修复无效缓存语言导致界面加载失败，以及切换语言后部分辅助功能标签未更新的问题。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
        ],
        'security': [
          {
            'text': '更新构建链中的缓存与 source map 依赖，修复对应的已知依赖安全问题。',
            'commit': '7717600d276b35e188074606266277c398265451',
          },
        ],
        'changes': [
          {
            'text':
              'v1.4.1 为桌面版本；两个新增模型仅适用于 Apple Silicon Mac，需在模型库手动下载，不改变已有模型选择。',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
        ],
      },
      'en': {
        'summary':
          'Optional Apple Silicon speech models, simpler onboarding, and fixes for voiceprint preservation, PDF export and summary generation.',
        'what': [
          {
            'text':
              'The Model Library on Apple Silicon Macs now offers Qwen3-ASR 1.7B 8bit and Whisper Large v3 Turbo as optional downloads for transcription and post-meeting refinement.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
        ],
        'improved': [
          {
            'text':
              'Onboarding shows the recommended speech models for each language; additional models remain available in Settings. A larger default window and interface improve readability.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              'Updated the bilingual website and meeting walkthrough to show transcription, accepting AI notes and generating summaries.',
            'commit': 'b13e8a6702d2ed50886af3f7539eaea3550a7144',
          },
          {
            'text':
              'Removed unused styles, scripts and duplicate audio, and archived development and design materials on the dev branch.',
            'commit': '14b3b4d87c8a658fe5d5b9142fdfafbe02b76698',
          },
        ],
        'fixed': [
          {
            'text':
              'Startup cleanup preserves user voiceprints with default names and newly downloaded Qwen3-ASR models; removing legacy demo samples preserves user samples added later.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              'Fixed PDF export hanging on Markdown containing tab-separated list markers or empty headings.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              'Removed conflicting length instructions that shortened detailed summaries, and kept chunked summaries of long meetings in the selected output language.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              'Microphone fallback retries device-selection failures without masking other capture constraint errors.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
          {
            'text':
              'Fixed startup failures caused by an invalid saved language and accessibility labels that did not update after changing languages.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
        ],
        'security': [
          {
            'text':
              'Updated cache and source-map dependencies in the build toolchain to address their known security issues.',
            'commit': '7717600d276b35e188074606266277c398265451',
          },
        ],
        'changes': [
          {
            'text':
              'v1.4.1 is a desktop release. Both new models require an Apple Silicon Mac and a manual Model Library download; existing model selections are preserved.',
            'commit': '2ca84f46f7f2c5f42e65139c64ac8c0dcd3b2d3e',
          },
        ],
      },
    },
    {
      'version': '1.4.0',
      'date': '2026-10-15',
      'current': false,
      'previousVersion': '1.3.1',
      'contributors': [],
      'zh': {
        'summary': '全新桌面与手机界面，新增手机麦克风联动，完善跨平台录音、设备连接与断线补传。',
        'what': [
          {
            'text':
              '重构桌面主界面与首次使用引导，统一工作区、会议列表、实时字幕、笔记、播放器和设置的操作体验。',
            'commit': 'debcfcb750e677211a8add885e35e7b8ebd8edf8',
          },
          {
            'text':
              '桌面可选择已连接的手机作为麦克风，支持试音及从电脑开始、暂停、继续和结束录音。',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
        ],
        'improved': [
          {
            'text':
              '统一明暗主题、多语言文案、键盘焦点和减少动态效果体验，完善不同窗口尺寸下的布局。',
            'commit': 'debcfcb750e677211a8add885e35e7b8ebd8edf8',
          },
          {
            'text':
              '重新整理会议详情中的逐字稿、笔记、纪要编辑与导出入口，保留保存失败时的草稿并支持重试。',
            'commit': 'debcfcb750e677211a8add885e35e7b8ebd8edf8',
          },
          {
            'text': '手机端与桌面采用统一界面风格，完善配对、录音状态、连接错误及权限提示。',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
          {
            'text':
              'Android 更新下载交由系统后台管理，离开页面后仍可继续；iOS 可检查 App Store 中的新版本。',
            'commit': '0c8804462f68c4b0259a6727cbf156c82a58b958',
          },
        ],
        'fixed': [
          {
            'text':
              '修复手机实时转写恢复后的字幕缺失、电脑重启后的控制状态恢复及断线补传边界问题，避免已确认音频被重复写入。',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
          {
            'text':
              '修复设置页切换时过期请求覆盖当前页面的问题；清理录音失败时保留索引，避免残留文件失去访问入口。',
            'commit': '6fafb4924937093d230c629e171fdabcecf65f0d',
          },
          {
            'text':
              '修复部分 OpenAI 兼容服务的纪要与 AI 笔记请求，补齐接口路径并兼容模型名大小写；修复暗色主题开关图标（感谢 @Sousukes，PR #9）。',
            'commit': 'e64f7d94da3318872a00d0078dc526883e97831e',
          },
          {
            'text':
              'Windows 本地 AI 运行库固定使用 AVX2 并禁用 AVX512；模型加载或推理失败后回收独立进程，减少异常重试残留的内存。',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
          {
            'text':
              '修复搜索结果异步覆盖、纪要标题与列表粘连、批量导出结果反馈，以及弹出菜单重复监听等问题。',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
          {
            'text': '修复英文设备连接页在默认窗口尺寸下的溢出，清理连接卡片的重复间距。',
            'commit': '3aa23a955175776aa42622b3eb25255c45316dd1',
          },
        ],
        'security': [
          {
            'text': '加强 Markdown 图片地址的属性转义，阻止恶意内容注入页面事件属性。',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
        ],
        'changes': [
          {
            'text':
              'v1.4.0 是桌面版本号；手机端功能随配套移动构建分发，iOS 正式上架与更新仍取决于 Apple 审核。',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
          {
            'text':
              '手机麦克风联动需要已配对、已连接且在前台就绪的配套手机应用；实时转写与 AI 处理仍由电脑完成。',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
          {
            'text':
              '断线期间音频继续保存在手机，恢复连接后续传已授权的录音；来电、强制退出和系统限制仍可能中断录音，结束后的补传可能需要保持手机应用在前台。',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
        ],
      },
      'en': {
        'summary':
          'Redesigned desktop and phone interfaces, phone microphone control, and more reliable cross-platform recording, device connections and upload recovery.',
        'what': [
          {
            'text':
              'A redesigned desktop interface and onboarding bring a consistent experience to workspaces, meeting lists, live captions, notes, playback and settings.',
            'commit': 'debcfcb750e677211a8add885e35e7b8ebd8edf8',
          },
          {
            'text':
              'Use a connected phone as the desktop microphone, preview its input level, and start, pause, resume or stop recording from the computer.',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
        ],
        'improved': [
          {
            'text':
              'More consistent light and dark themes, translations, keyboard focus and reduced-motion behavior, with layouts adapted to different window sizes.',
            'commit': 'debcfcb750e677211a8add885e35e7b8ebd8edf8',
          },
          {
            'text':
              'Reorganized transcript, note, summary editing and export controls in meeting details; drafts survive failed saves and can be retried.',
            'commit': 'debcfcb750e677211a8add885e35e7b8ebd8edf8',
          },
          {
            'text':
              'A shared visual style across phone and desktop, with clearer pairing, recording status, connection errors and permission guidance.',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
          {
            'text':
              'Android update downloads continue through the system download manager after leaving the page; iOS can check for newer App Store versions.',
            'commit': '0c8804462f68c4b0259a6727cbf156c82a58b958',
          },
        ],
        'fixed': [
          {
            'text':
              'Fixed missing captions after restoring a phone session, recording control state after a desktop restart, and upload recovery edge cases, without rewriting acknowledged audio.',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
          {
            'text':
              'Stale settings requests no longer replace the current page; failed recording cleanup preserves the index so remaining files stay accessible.',
            'commit': '6fafb4924937093d230c629e171fdabcecf65f0d',
          },
          {
            'text':
              'Fixed summary and AI note requests to stricter OpenAI-compatible services, including endpoint paths and model-name casing, plus the dark-theme switch icon (thanks to @Sousukes, PR #9).',
            'commit': 'e64f7d94da3318872a00d0078dc526883e97831e',
          },
          {
            'text':
              'Windows local AI builds use AVX2 with AVX512 disabled; failed model loads or inference release the sidecar process to reduce memory retained across retries.',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
          {
            'text':
              'Fixed stale search results, joined summary headings and list items, batch export result reporting, and duplicate popover listeners.',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
          {
            'text':
              'Fixed overflow on the English device connection page at the default window size by removing duplicate card spacing.',
            'commit': '3aa23a955175776aa42622b3eb25255c45316dd1',
          },
        ],
        'security': [
          {
            'text':
              'Hardened attribute escaping for Markdown image URLs to prevent malicious content from injecting page event handlers.',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
        ],
        'changes': [
          {
            'text':
              'v1.4.0 is the desktop version; phone features ship through companion mobile builds, and iOS availability and updates remain subject to Apple review.',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
          {
            'text':
              'Phone microphone control requires the companion app to be paired, connected and ready in the foreground; live transcription and AI processing still run on the computer.',
            'commit': '8dc8fe4540fcfdd117adc933de692e21caf7873e',
          },
          {
            'text':
              'Audio remains on the phone during a disconnection and authorized uploads resume after reconnection. Calls, force-stop and system limits can still interrupt recording; uploads after recording may require keeping the phone app in the foreground.',
            'commit': 'f4db152077903971fa220badc2b17bbf6ebe17a5',
          },
        ],
      },
    },
    {
      'version': '1.3.1',
      'date': '2026-10-10',
      'current': false,
      'previousVersion': '1.3.0',
      'contributors': [],
      'zh': {
        'summary': '精简手机会议操作，完善等待反馈、版本显示及桌面设备连接界面。',
        'what': ['未上传的本地会议可从长按菜单选择上传到电脑。'],
        'improved': [
          '手机结束录音直接保存；右滑会议显示删除按钮，点击后直接删除手机副本。',
          '新建录音按电脑连接情况选择同步或本地保存，减少多余选项。',
          '等待电脑输出期间持续显示三点动画，覆盖部分字幕、笔记和后续处理，并支持系统减少动态效果设置。',
          '桌面移除重复的手机录音标签及设备连接窗口中的会议操作区。',
          '重整多语言使用文档，新增中英文开发指南和手机界面截图。',
        ],
        'fixed': [
          '等待动画显示时不再同时显示“暂无转写”；默认发言人名称按界面语言显示。',
          'Android 检查更新显示当前版本、最新版本和构建号；退出设置页后不再继续发起版本检查请求。',
        ],
        'security': [],
        'changes': [
          'v1.3.1 是桌面版本号；手机端改进随配套移动构建分发。iOS 正式上架仍取决于 Apple 审核。',
          '删除手机会议不再二次确认；未上传录音删除前请自行导出保留。',
        ],
      },
      'en': {
        'summary':
          'Streamlines phone recording controls, waiting feedback, version details and desktop device management.',
        'what': ['Upload a local recording to a computer from its long-press menu.'],
        'improved': [
          'Ending a recording saves directly. Swipe right to reveal Delete, then tap to remove the phone copy.',
          'New recordings use the computer connection to choose syncing or local storage, with fewer setup options.',
          'Three animated dots remain visible while waiting for desktop output, including partial transcripts, notes and follow-up processing, and respect reduced-motion settings.',
          'Removed duplicate phone-recording labels and the meeting controls in the desktop device connection dialog.',
          'Reorganized multilingual user documentation and added English/Chinese developer guides and phone screenshots.',
        ],
        'fixed': [
          'Waiting dots replace the empty transcript message; default speaker names follow the interface language.',
          'Android update checks show installed and latest versions with build numbers, and no longer start a version-check request after leaving Settings.',
        ],
        'security': [],
        'changes': [
          'v1.3.1 is the desktop version; phone improvements ship through companion mobile builds. iOS public availability still depends on Apple review.',
          'Deleting a phone meeting no longer asks for confirmation. Export unuploaded recordings first if you want to keep them.',
        ],
      },
    },
    {
      'version': '1.3.0',
      'date': '2026-10-10',
      'current': false,
      'previousVersion': '1.2.3',
      'contributors': [],
      'zh': {
        'summary': '新增手机录音与电脑转写联动，完善离线补传、设备管理和录音恢复。',
        'what': [
          '新增手机设备连接与管理：在电脑确认二维码或 PIN 配对，手机录音由电脑识别并回传字幕与笔记。',
          '手机支持独立离线录音、时间点重点、回听与导出；选择电脑并确认后再上传。',
        ],
        'improved': [
          '按持久化样本位置恢复补传，重复上传不会重复写入音频；电脑重启或短暂断网后继续同步。',
          '完善手机连接提示与八种语言的错误文案；Android 支持从设置检查签名更新。',
        ],
        'fixed': [
          '修复慢网络阻塞暂停和结束录音的问题。',
          '修复翻译重复处理历史版本、未采用人工修改后字幕的问题。',
          '本地录音分片缺失时拒绝恢复并保留原文件，防止覆盖后续有效音频。',
          '会议复测支持导入音频，并沿用后端的平台和语言默认模型。',
        ],
        'security': ['配对凭据保存在系统安全存储，连接校验电脑身份；设备取消信任后撤销访问权限。'],
        'changes': [
          '手机本身不运行识别模型；实时转写和翻译需要电脑在线且安装相应模型。',
          'iOS 1.0 正在提交 App Store 审核，正式可下载时间取决于 Apple 审核；Android 可使用签名 APK。',
          '来电、强制停止和系统限制仍可能中断录音；结束录音后的补传可能需要保持手机应用在前台。',
        ],
      },
      'en': {
        'summary':
          'Adds phone recording with desktop transcription, with offline upload recovery, device management and safer recording recovery.',
        'what': [
          'Pair and manage phones from the desktop using a QR code or PIN and computer approval. Desktop recognition returns transcripts and notes to the phone.',
          'Record offline on the phone, mark timestamps, listen back and export; select a computer and confirm before uploading.',
        ],
        'improved': [
          'Uploads resume from persisted sample positions without duplicating audio, including after a desktop restart or a temporary disconnection.',
          'Clearer phone connection status and error messages in eight languages; Android can check for signed updates in Settings.',
        ],
        'fixed': [
          'Slow networks no longer block pause and stop controls.',
          'Translation processes the current transcript once and respects manual text edits.',
          'Missing local recording chunks now stop recovery and preserve the files instead of overwriting later valid audio.',
          'Meeting replay supports imported audio and follows backend platform and language model defaults.',
        ],
        'security': [
          'Pairing credentials use system secure storage and connections verify the computer identity; revoking trust removes device access.',
        ],
        'changes': [
          'The phone does not run recognition models. Live transcription and translation require an online computer with the corresponding models installed.',
          'iOS 1.0 is being submitted for App Store review; availability depends on Apple approval. Android is available as a signed APK.',
          'Calls, force-stop and system limits can interrupt recording. Uploads after recording may require keeping the phone app in the foreground.',
        ],
      },
    },
    {
      'version': '1.2.3',
      'date': '2026-10-05',
      'current': false,
      'previousVersion': '1.2.2',
      'contributors': [],
      'zh': {
        'summary':
          '本次更新带来 Apple 芯片 Mac 的 MLX 本地识别、统一的 AI 功能设置，并改善双轨录音与转写稳定性。',
        'what': [
          {
            'text':
              'Apple 芯片 Mac 使用 mlx-audio/MLX 运行 FunASR Nano、Qwen3-ASR、Parakeet 和 Silero VAD；FunASR 与 Qwen 支持识别过程中的草稿字幕。',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              '设置页新增统一的 AI 功能面板，集中配置实时 AI 笔记与会后总结；首次设置可直接下载所选本地总结模型。',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
        ],
        'improved': [
          {
            'text':
              '升级 MLX 后端后，本机 Apple M4 Pro 对同一批各 45 秒的中英文会议片段实测：FunASR Nano 与 Parakeet 的纯解码速度分别约为 v1.2.2 的 3.7 倍和 4.0 倍（不含模型加载时间；实际收益因设备、模型和音频而异）。',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              '麦克风与系统音频按时间对齐后统一混音，实时字幕与会后精修复用处理逻辑，减少回声导致的重复转写。',
            'commit': '148177e01a9a199af48aec784f864fd97bdd89cf',
          },
          {
            'text':
              '统一模型介绍与多语言文案，简化模型库大小信息和存储设置，改善模型下载进度、失败重试与设置页交互。',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
        ],
        'fixed': [
          {
            'text':
              '修复慢 MLX 推理阻塞后续录音写入的问题；实时识别积压时保留原始录音，并正确排空暂停、模型切换和结束时的任务。',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
          {
            'text':
              '修复长时间重叠发言的说话人信息被识别窗口覆盖的问题；保留重叠标记，同时避免对同一段混音重复转写。',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
          {
            'text':
              '改善双轨缓冲、单轨暂时无数据和安静麦克风输入的处理，减少音频不同步与轻声遗漏。',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              '校验连续语音切段上限并修复不安全的旧配置，避免过短切段造成识别异常；加强 Windows 冻结及安装包运行时检查。',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              '修复 macOS 运行时去重破坏 Python.framework 签名结构的问题，保留 framework 内的可执行文件与元数据，并增加实际签名验证。',
            'commit': '9061a5a8f41706f5e0bc285de751409da883b10a',
          },
        ],
        'security': [
          {
            'text':
              '阻止外部 AI 服务请求跨来源重定向，避免 API 凭据或会议文本被转发到配置之外的服务。',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
        ],
        'changes': [
          {
            'text':
              'Mac 升级后需下载对应的 MLX 识别模型；Windows 继续使用 Sherpa ONNX。已有录音与历史逐字稿仍保留。',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text': '重新精修会生成新的当前稿；旧稿中的人工修改不会自动迁移到新稿。',
            'commit': '148177e01a9a199af48aec784f864fd97bdd89cf',
          },
        ],
      },
      'en': {
        'summary':
          'This release brings local MLX recognition to Apple Silicon Macs, unified AI settings, and more reliable dual-track recording and transcription.',
        'what': [
          {
            'text':
              'Apple Silicon Macs now run FunASR Nano, Qwen3-ASR, Parakeet and Silero VAD through mlx-audio/MLX; FunASR and Qwen show draft captions while decoding.',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              'A unified AI features panel brings live AI notes and meeting summaries together; first-run setup can download the selected local summary model directly.',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
        ],
        'improved': [
          {
            'text':
              'With the MLX backend, tests on an Apple M4 Pro using the same 45 seconds of Chinese and 45 seconds of English meeting audio measured FunASR Nano and Parakeet decoding at about 3.7× and 4.0× their v1.2.2 speed, respectively (excluding model loading; results vary by device, model and audio).',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              'Microphone and system audio are aligned and mixed through a shared pipeline for live captions and refinement, reducing duplicate transcription from echo.',
            'commit': '148177e01a9a199af48aec784f864fd97bdd89cf',
          },
          {
            'text':
              'Unified model descriptions and localized copy, simplified model-size and storage displays, and improved download progress, retry handling and settings interactions.',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
        ],
        'fixed': [
          {
            'text':
              'Fixed slow MLX inference blocking subsequent audio writes; raw recording continues when live recognition falls behind, with ordered draining on pause, model changes and stop.',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
          {
            'text':
              'Fixed sustained speaker overlap being erased by transcription windows; overlap metadata is preserved without transcribing the same mixed interval twice.',
            'commit': '4e4015f7cbf7e212446bfd6b7ae08a546f58c857',
          },
          {
            'text':
              'Improved dual-track buffering, temporary gaps in either input and quiet microphone handling to reduce misalignment and missed quiet speech.',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              'Validated speech-segment limits and repaired unsafe saved settings to prevent invalid short cuts, with stronger frozen and packaged Windows runtime checks.',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              'Fixed runtime deduplication breaking Python.framework code signing on macOS by preserving framework executables and metadata, with an actual signing regression check.',
            'commit': '9061a5a8f41706f5e0bc285de751409da883b10a',
          },
        ],
        'security': [
          {
            'text':
              'Blocked cross-origin redirects for external AI requests to keep API credentials and meeting text within the configured service.',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
        ],
        'changes': [
          {
            'text':
              'After upgrading a Mac, download the corresponding MLX recognition model; Windows continues to use Sherpa ONNX. Existing recordings and historical transcripts remain available.',
            'commit': '8049d36b260e231e67e529688b04027a43553917',
          },
          {
            'text':
              'Running refinement again creates a new current transcript; manual edits to the previous transcript are not automatically carried over.',
            'commit': '148177e01a9a199af48aec784f864fd97bdd89cf',
          },
        ],
      },
    },
    {
      'version': '1.2.2',
      'date': '2026-10-02',
      'previousVersion': '1.2.1',
      'contributors': [
        {
          'login': 'anupamme',
          'pr': 2,
        },
        {
          'login': 'Sousukes',
          'pr': 4,
        },
      ],
      'zh': {
        'summary': '本次更新聚焦录音与数据安全、长会话稳定性，以及更清晰的双语更新日志。',
        'what': [
          {
            'text': '迁移模型或录音目录时显示进度浮窗，并锁定冲突操作，迁移结束后自动恢复。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              '更新日志按类别展示，支持提交链接、新贡献者致谢和完整版本对比；历史版本可折叠查看。',
            'commit': '2b36241a67c1855ae40809abdf237ec55a5f32d9',
          },
        ],
        'improved': [
          {
            'text':
              '统一逐字稿的展示、编辑、翻译和导出版本选择，避免历史精修结果被模型状态变化覆盖。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              '声纹取样只读取所选音频片段，限制整段样本的内存加载；统一编辑器监听器、后台任务和侧车进程的生命周期。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              '统一八语言文案与错误提示，保留配置表单和笔记编辑草稿，清理重复逻辑、失效样式和多余状态。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
        ],
        'fixed': [
          {
            'text': '修复批量删除与后台任务互斥冲突；部分操作失败时正确保留尚未处理的会议。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              '修复结束录音失败后无法重试、恢复同名工作区返回空值，以及迁移数据目录后声纹样本路径失效的问题。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              '导入、导出、翻译和声纹处理期间阻止冲突的数据清理；加强任务失败回滚与重复导出的文件名保护。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              '修复快速切换页面、重复点击引导页和长会话残留监听器的问题；保留有效字幕时间戳与人工修改。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text': '为 IPC 请求设置有限超时并加强输入校验，避免后端无响应时操作无限等待。',
            'commit': '45adfaf',
          },
          {
            'text':
              '修复取消 AI 推理时关闭已断开管道可能抛出异常的问题，确保子进程和两端管道均被回收。',
            'commit': '8f6e4592dff69c9b74009a2f6def393b6d489481',
          },
          {
            'text':
              '修复 Windows 并发保存配置时的文件替换冲突，按请求顺序写入并保留最后一次保存结果。',
            'commit': '2c0f3bc1baec6756a8007af264b8498ce4378932',
          },
        ],
        'security': [
          {
            'text':
              '加强存储路径、符号链接、归档导出和 IPC 输入校验；补齐三个 GGUF 模型下载文件的 SHA-256 校验。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text': '升级 js-yaml 依赖以纳入安全修复。',
            'commit': '6e6acc0a85d035fecb2587433d38ecc7c1570a8f',
          },
        ],
        'changes': [
          {
            'text':
              '录音导出统一为 WAV，移除 FLAC/M4A 选项；逐字稿和笔记的 Markdown、TXT、JSON、SRT、DOCX、PDF 导出保持可用。',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
        ],
      },
      'en': {
        'summary':
          'This release focuses on recording and data safety, long-session stability, and clearer bilingual release notes.',
        'what': [
          {
            'text':
              'Storage moves now show a progress dialog and block conflicting actions until the move finishes.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'The changelog now includes grouped changes, commit links, new contributor credits and a full comparison, with collapsible release history.',
            'commit': '2b36241a67c1855ae40809abdf237ec55a5f32d9',
          },
        ],
        'improved': [
          {
            'text':
              'Unified transcript selection across viewing, editing, translation and export, preserving historical refinements when model availability changes.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'Voiceprint learning reads only selected audio windows and bounds full-sample loading; editor listeners, background tasks and sidecar processes now share consistent cleanup rules.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'Consolidated copy and errors across eight languages, preserved configuration and note drafts, and removed duplicate logic, unused styles and redundant state.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
        ],
        'fixed': [
          {
            'text':
              'Fixed batch deletion conflicting with task safety checks; partially failed batches now retain unfinished meetings.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'Fixed retrying a failed recording stop, restoring a deleted workspace by name, and voiceprint sample paths after data migration.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'Protected imports, exports, translations and voiceprint processing from conflicting cleanup, and strengthened failure rollback and export filename reservation.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'Fixed rapid navigation, repeated onboarding clicks and stale listeners in long sessions, while preserving valid transcript timestamps and manual edits.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text':
              'Added finite IPC deadlines and stronger input validation to prevent operations from waiting indefinitely on an unresponsive worker.',
            'commit': '45adfaf',
          },
          {
            'text':
              'Fixed a broken-pipe race when cancelling AI inference, ensuring the child process and both pipes are released.',
            'commit': '8f6e4592dff69c9b74009a2f6def393b6d489481',
          },
          {
            'text':
              'Fixed conflicting file replacements during concurrent configuration saves on Windows; writes now preserve request order and the last saved value.',
            'commit': '2c0f3bc1baec6756a8007af264b8498ce4378932',
          },
        ],
        'security': [
          {
            'text':
              'Hardened storage paths, symlinks, archive exports and IPC validation, and added SHA-256 checks for all three GGUF model downloads.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
          {
            'text': 'Updated js-yaml to include security fixes.',
            'commit': '6e6acc0a85d035fecb2587433d38ecc7c1570a8f',
          },
        ],
        'changes': [
          {
            'text':
              'Audio export is now WAV-only; FLAC/M4A options have been removed. Markdown, TXT, JSON, SRT, DOCX and PDF exports remain available for text content.',
            'commit': '4b1f51e088cf3f3f2c623e641c453a8a6f5d7724',
          },
        ],
      },
    },
    {
      'version': '1.2.1',
      'date': '2026-09-27',
      'zh': {
        'what': [
          '支持在首次设置和设置页选择模型、会议录音的存储目录，并迁移已有文件。',
          '会议详情支持选择精修模型；精修完成后显示实际使用的模型。',
          'AI 纪要可独立开启或关闭，首次设置中可分别配置纪要与实时 AI 笔记。',
        ],
        'improved': [
          '优化首次设置、录音导入、会议准备页和详情页布局；统一 AI 引导页的标题与卡片比例，翻译与重新精修入口更加清晰。',
          '升级语音识别引擎至 sherpa-onnx 1.13.8，Qwen3-ASR 按所选会议语言识别。',
          '统一存储设置的多语言提示，清理重复样式并改善窄窗口与暗色模式显示。',
        ],
        'fixed': [
          '修复存储目录迁移中断后的恢复与校验问题，避免错误清理文件。',
          '修复修改字幕后仍使用旧词级时间戳的问题，并保留有效的精修句子时间对齐。',
          '修复取消麦克风预览后仍占用设备，以及重复获取麦克风的问题。',
          '修复首次引导中切换语言影响会议列表、AI 演示关闭后计时器继续运行，以及未保存的供应商选择覆盖当前配置的问题。',
          '修复字幕底部被播放器遮挡，以及窄窗口下侧栏隐藏的问题。',
        ],
      },
      'en': {
        'what': [
          'Choose storage folders for models and meeting recordings during setup or in settings, and move existing files.',
          'Choose a refinement model from meeting details and see which model produced the refined transcript.',
          'Turn AI summaries on or off independently, with separate setup controls for summaries and live AI notes.',
        ],
        'improved': [
          'Refined first-run setup, recording import, meeting preparation, and detail layouts; aligned AI setup heading and card sizes with other setup pages, with clearer translation and re-refinement actions.',
          'Updated the speech recognition engine to sherpa-onnx 1.13.8; Qwen3-ASR now follows the selected meeting language.',
          'Unified localized storage messages, removed redundant styles, and improved narrow-window and dark-mode layouts.',
        ],
        'fixed': [
          'Fixed recovery and validation after interrupted storage moves to prevent incorrect file cleanup.',
          'Fixed stale word timestamps being reused after subtitle edits while preserving valid sentence alignment during refinement.',
          'Fixed microphone previews retaining the device after cancellation or acquiring it more than once.',
          'Fixed onboarding language changes affecting the meeting list, AI demo timers continuing after being disabled, and unsaved provider choices overwriting the active configuration.',
          'Fixed the player covering the bottom of transcripts and the sidebar disappearing in narrow windows.',
        ],
      },
    },
    {
      'version': '1.2.0',
      'date': '2026-09-12',
      'zh': {
        'what': [
          '识别链路改为「VAD 分段 → 单次高精度识别」：每次说完停顿即出整句字幕，不再有半句闪烁。',
          '会议详情里的字幕支持逐句修改并保存；暂停录制时界面会明确显示已暂停。',
          '模型库完全按模型清单生成，每张卡片都显示真实名称、体积与速度/准确度刻度；清单声明了实测磁盘占用与内存需求的模型会一并显示。',
          '首启选型页用刻度表达速度与准确度，只下载你勾选的模型；随应用安装的语音检测、说话人分离、声纹模型直接标为已安装。',
          '准备页新增「识别模型」下拉，实时页也有同一个切换器，会中即可换模型。',
        ],
        'improved': [
          '字幕按段落聚合：相邻句子攒到约 110 字（拉丁 280 字符）才成一段，上限 150 字 / 380 字符，短句不再单独成段；段落边界只看真正的长停顿（≥1.2 秒），不按 VAD 端点切，超过 8 秒没有新结果也会兜底提交。',
          '精修字幕的时间戳、以及加入声纹库时保存的音频片段，改为按识别器给出的词级时间戳对齐，不再把一段时长按字数平摊，播放定位与声纹取样因此落在真正说话的那一句上。',
          '同一段样例音频的转写 CPU 时间下降约 74%–82%，进程峰值内存下降约 18%–28%。',
          '识别、翻译与 AI 笔记共用同一份已确认字幕，会中不再出现重复或互相覆盖的文本。',
          '进阶设置补齐了会后精修与语音检测的参数说明，以及实时段长上限。',
          '默认识别模型按会议语言决定，映射只写在 backend/models.json 一处；声明的默认模型未下载时改用已安装且支持该语言的模型，而不是让你再下一个。',
          '导入录音的说话人分离按预估耗时自动取舍，预估按物理核折算，超线程机器上不再晚一倍才判定。',
          '模型下载失败的提示区分磁盘空间、文件校验与网络中断，各自给出可行动的建议。',
          '下架了流式识别、标点恢复、实时降噪、效率模式与第二遍实时精修：不再下载、不再加载、不再存储。',
        ],
        'fixed': [
          '修复连续语音切点上的丢字：下一段解码会回看切点前 400 毫秒，被切在词中间的字重新带上完整上下文识别，重复部分按接缝对齐去掉。',
          '修复连续独白在硬切处丢字、接缝重复与句末标点错位的问题。',
          '修复段首回补被当成秒导致重复解码整段历史音频的问题。',
          '修复长会议逐句翻译时反复重写会议记录带来的卡顿。',
          '修复整句识别模型的精修稿被当成「无时间戳全文」展示、并因此隐藏逐句编辑入口的问题。',
          '修复下载队列把内置 AI 模型的内部 id（如 qwen3.5-2b-q4km）显示给用户的问题。',
          '修复暗色模式下首启模型卡片与实时识别模型切换器文字不可读的问题。',
          '修复恢复录音时识别链路起不来却仍报告恢复成功、结果整场没有字幕的问题。',
          '修复低音量语音被漏识的问题：两个已检测语音区间之间的音频现在也会转写（音乐下的人声、电话音、轻声发言），实时字幕与会后精修一致。',
          '修复手动修订字幕后再精修会让同一句显示两次的问题。',
          '修复精修稿把「他是。我们是。」粘成「他是我们是。」的问题：会后精修不再套用实时字幕的悬空连接词拼接规则。',
          '修复精修模型已下架/退役的会议里，逐句修改字幕会被静默丢弃的问题。',
          '修复精修字幕上右键不弹出菜单（加入笔记 / 添加录音到声纹库）的问题。',
          '修复两段字幕的音频并不重叠、只是恰好共享一个字时会被误删一个字的问题。',
          '修复进阶设置在含整数默认值（如 22 秒的段长上限）时保存必然报错「Invalid setting」的问题。',
          '修复日文、韩文界面新建会议时默认语言为「自动」的问题：「自动」的默认模型不覆盖日韩语；现在中、日、韩三种界面都默认用界面语言开会。',
        ],
      },
      'en': {
        'what': [
          'Recognition now runs as VAD segmentation → one high-accuracy decode, so a finished sentence appears right after each pause instead of a flickering half-line.',
          'Subtitles in meeting details can be edited sentence by sentence and saved; pausing a recording is now clearly shown.',
          'The model library is generated from the manifest: every card shows the real model name, its size, and its speed/accuracy rating (measured disk usage and memory floor where the manifest declares them).',
          'First-run setup puts speed and accuracy on a scale and downloads only the models you pick; bundled voice detection, diarization, and voiceprint models are marked as installed.',
          'Meeting setup gained a recognition-model selector, and the live screen has the same one, so the model can be switched mid-meeting.',
        ],
        'improved': [
          'Captions are now paragraph-sized: neighbouring sentences are coalesced up to roughly 110 Chinese characters (280 Latin) with a hard ceiling of 150 / 380, instead of standing alone one sentence at a time; a paragraph breaks only on a genuine long pause, not on every voice-detection endpoint, and a paragraph is submitted anyway after 8 seconds without new results.',
          'Refined subtitle timestamps — and the audio clips saved when you add a line to a voiceprint — now follow the recognizer’s word timestamps instead of spreading each speech window evenly by character count, so a refined line starts and ends where it was actually spoken.',
          'Transcription CPU time drops by roughly 74–82% and peak memory by 18–28% on the same sample audio.',
          'Recognition, translation, and AI notes all read the same confirmed captions, so text no longer duplicates or overwrites itself mid-meeting.',
          'Advanced settings now label the post-meeting refinement and voice-detection options, plus the live segment cap.',
          'The default recognition model follows the meeting language, and that mapping is declared once in backend/models.json; when the declared default is not installed, an installed model for the same language is used instead of asking for another download.',
          'Imported recordings decide on speaker diarization automatically, from an estimate scaled by physical cores, so the call is no longer twice as late on hyperthreaded machines.',
          'Download failures now distinguish disk space, integrity, and network problems, each with a next step.',
          'Removed the streaming recognizer, punctuation models, live denoising, the efficiency-mode switch, and the second live refinement pass: no longer downloaded, loaded, or stored.',
        ],
        'fixed': [
          'Fixed characters lost where continuous speech was cut: the next decode now reaches 400 ms back before the cut, so a word split across it is recognised again with full context, and the repeated part is aligned away at the seam.',
          'Fixed dropped words, duplicated seams, and misplaced sentence punctuation at hard cuts in continuous speech.',
          'Fixed speech padding being read as seconds, which re-decoded the whole audio history for every segment.',
          'Fixed repeated meeting writes that made sentence-by-sentence translation stutter on long meetings.',
          'Fixed refined transcripts from the current sentence-transcription models being shown as a plain “no timestamps” full-text view, which also hid the sentence-by-sentence editor.',
          'Fixed the download queue showing an internal model id (for example qwen3.5-2b-q4km) instead of the model name for built-in AI models.',
          'Fixed unreadable text in dark mode on the first-run model cards and the live recognition-model selector.',
          'Fixed a restored recording reporting success even when recognition could not start, which left the meeting with no captions at all.',
          'Fixed quiet speech that voice detection missed entirely: audio between two detected speech regions is now transcribed in live captions and in post-meeting refinement alike.',
          'Fixed a refined transcript showing the same sentence twice after a manual correction followed by a re-refinement.',
          'Fixed refined transcripts joining two complete sentences into one when the first ended in a connective (“他是。我们是。” became “他是我们是。”).',
          'Fixed per-sentence subtitle edits being silently discarded for a meeting whose refinement model is no longer offered.',
          'Fixed the segment context menu (add to notes, add this audio to a voiceprint) not opening on refined subtitles.',
          'Fixed a character being dropped where two captions met when they happened to share a character but their audio did not overlap.',
          'Fixed advanced settings failing to save with “Invalid setting” whenever a whole-number default (for example the 22-second segment cap) was round-tripped through the interface.',
          'Fixed Japanese and Korean interfaces defaulting a new meeting to “auto”, whose default model does not cover those languages; Chinese, Japanese, and Korean interfaces now default to the interface language.',
        ],
      },
    },
    {
      'version': '1.1.8',
      'date': '2026-09-04',
      'zh': {
        'what': ['会议纪要支持一键复制；导出的文件会按内容类型自动命名。'],
        'improved': [
          '音频采样在连续分块间保持精确时间轴，降低长时间录音出现时间漂移的可能。',
          '会议纪要会更完整地保留明确提出的后续行动项。',
        ],
        'fixed': ['清理已不再使用的摘要弹窗编辑逻辑，统一使用详情页内联编辑。'],
      },
      'en': {
        'what': [
          'Meeting notes can now be copied with one click, and exported files are named by content type.',
        ],
        'improved': [
          'Audio sampling now keeps a precise timeline across consecutive blocks, reducing the risk of drift in long recordings.',
          'Meeting notes more reliably retain explicitly stated follow-up actions.',
        ],
        'fixed': [
          'Removed the unused summary-dialog editor so editing consistently happens inline in meeting details.',
        ],
      },
    },
    {
      'version': '1.1.7',
      'date': '2026-09-02',
      'zh': {
        'what': ['会议详情中的纪要现可直接编辑，无需打开单独窗口。'],
        'improved': [
          '优化长录音与导入录音的会后精修，降低内存占用并缩短准备时间。',
          '效率模式下导入录音会跳过发言者区分，以更快完成会后精修。',
        ],
        'fixed': ['修复 Windows 上首次加载音频处理组件可能导致精修准备长时间无响应的问题。'],
      },
      'en': {
        'what': ['Meeting summaries can now be edited directly from the meeting details view.'],
        'improved': [
          'Optimized post-meeting refinement for long and imported recordings to reduce memory use and shorten preparation time.',
          'In Efficiency mode, imported recordings skip speaker distinction so post-meeting refinement finishes faster.',
        ],
        'fixed': [
          'Fixed an issue where the first Windows load of audio-processing components could leave refinement preparation unresponsive for an extended time.',
        ],
      },
    },
    {
      'version': '1.1.6',
      'date': '2026-08-30',
      'zh': {
        'what': [
          '新增会议资料导出与分享中心，支持逐字稿、纪要、笔记和录音按需导出或打包。',
          '支持在会议笔记中插入图片，并可保存编辑后的 AI 纪要。',
        ],
        'improved': [
          '自动音源会根据实际声音在麦克风与系统音频间切换，减少不必要的系统录音。',
          '优化会议搜索、实时字幕和精修性能，弱性能设备上会自动优先保证字幕实时性。',
        ],
        'fixed': ['修复 Windows 上导入音频及上传相关的兼容性问题。'],
      },
      'en': {
        'what': [
          'Added an export and sharing hub for transcripts, notes, personal notes, and recordings, with optional ZIP bundles.',
          'Meeting notes can now include images, and edited AI meeting notes can be saved.',
        ],
        'improved': [
          'Auto audio source now switches between microphone and system audio based on detected sound, avoiding unnecessary system recording.',
          'Improved meeting search, live-caption, and refinement performance; slower devices now prioritize keeping captions live.',
        ],
        'fixed': [
          'Fixed Windows compatibility issues when importing audio and uploading audio data.',
        ],
      },
    },
    {
      'version': '1.1.5',
      'date': '2026-08-26',
      'zh': {
        'improved': [
          '提升实时字幕的稳定性，降低识别过程中的中断与抖动。',
          '优化实时识别状态反馈，字幕延迟更低。',
        ],
        'fixed': ['修复直播转录中偶发的字幕停滞问题。'],
      },
      'en': {
        'improved': [
          'Improved live-caption stability and reduced interruptions during recognition.',
          'Optimized realtime recognition feedback for lower caption latency.',
        ],
        'fixed': ['Fixed an occasional caption stall during live transcription.'],
      },
    },
    {
      'version': '1.1.4',
      'date': '2026-08-22',
      'zh': {
        'improved': ['多项性能优化，界面操作更流畅。'],
      },
      'en': {
        'improved': ['Multiple performance optimizations for a smoother experience.'],
      },
    },
    {
      'version': '1.1.3',
      'date': '2026-08-18',
      'zh': {
        'improved': ['改进会后精修字幕的准确度与排版。'],
        'fixed': ['修复若干精修相关的边界问题。'],
      },
      'en': {
        'improved': ['Better accuracy and formatting for post-meeting refined transcripts.'],
        'fixed': ['Fixed several edge cases around refinement.'],
      },
    },
    {
      'version': '1.1.2',
      'date': '2026-08-12',
      'zh': {
        'improved': ['改进应用内更新流程与发布通道，升级更顺畅。'],
      },
      'en': {
        'improved': ['Improved the in-app update flow and release channel for smoother upgrades.'],
      },
    },
    {
      'version': '1.1.1',
      'date': '2026-08-05',
      'zh': {
        'what': ['新增 AI 会议总结与 AI 笔记，可自动发现重点、提取待办。'],
        'improved': ['支持内置本地模型与在线 LLM 两种纪要方式。'],
      },
      'en': {
        'what': [
          'Added AI meeting summaries and AI notes that surface key points and action items.',
        ],
        'improved': ['Support both built-in local models and online LLMs for summaries.'],
      },
    },
    {
      'version': '1.1.0',
      'date': '2026-07-30',
      'zh': {
        'what': ['首个 1.1 版本：本地会议录制、实时字幕、说话人识别与工作区组织。'],
      },
      'en': {
        'what': [
          'First 1.1 release: local meeting recording, live captions, speaker recognition, and workspace organization.',
        ],
      },
    },
  ];
  window.BreviaChangelog = releases;
})();
