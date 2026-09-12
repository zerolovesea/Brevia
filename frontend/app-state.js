// 跨模块共享的可变状态。
//
// 为什么单独成文件：前端是 classic script，全局作用域对所有文件可见——于是任何一个视图
// 模块要用状态，就直接去 app.js 里拿，形成 app.js ↔ 视图模块的**循环依赖**，而"谁先加载"
// 成了隐含的依赖图。把这些被多个模块共享的状态下沉到最底层（本文件在 index.html 里第一个
// 加载，且不依赖任何其它前端文件），依赖方向就变成单向：视图模块 → app-state.js。
//
// 只放**状态**，不放行为：行为留在各自的模块里。搬迁是纯移动（classic script 下 let/const
// 是脚本级词法绑定，跨文件读写语义不变），frontend/test-ui.mjs 里的「加载顺序契约」与
// 「全局符号不得重复声明」两道门禁保证漏删原声明或顺序写错时立刻失败。

let locale = localStorage.getItem('brevia-language') || 'zh';
let activeView = 'home';
let activeLibraryNav = 'all-meetings';
let meetingActive = false;
let editingMeetingIndex = null;
let detailActiveTab = 'notes';
let currentMeetingDetail = null;
let inlineSummaryEditor = null;
let detailNotesEditor = null;
let modelCatalog = [];
let editingSegmentSpeakerId;
let summaryGeneratingMeetingId;
let seconds = 0;
let timer;
const progress = document.querySelector('#progress');
const playerAudio = new Audio();
let playbackStarted = false;
let followPlaybackTranscript = true;
