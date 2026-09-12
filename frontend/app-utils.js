// 跨模块共享的**纯**工具函数。
//
// 与 app-state.js 同样的理由：这些函数被多个视图模块使用，放在 app.js 里会让视图模块为了
// 一个格式化函数去依赖整个 app.js，形成循环。这里只放无副作用、不碰 DOM、不读全局的纯函数，
// 因此可以被任何模块安全调用，也最容易写行为测试。
//
// 本文件在 index.html 里紧跟 app-state.js 加载，不依赖任何其它前端文件。

function formatBytes(bytes = 0) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
function formatMeetingTime(milliseconds = 0) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }

// 精修模型是否输出可对齐到原 segment 时间戳的结果。当前内置精修模型均为窗口式逐句精修
// （继承原时间戳）；未来若接入整段式无时间戳输出的模型，不会出现在该集合中，将走“精修全文”展示。
//
// 新增/退役整句识别模型时必须同步这里：`parakeet-tdt-0.6b-v3-int8` 加入清单时漏了，
// 于是英语/西语/法语/德语/俄语/混说会议（Parakeet 是这些语言的默认）的精修稿被当成
// 「无时间戳全文」渲染——页面对着用户说「当前模型不提供时间戳」，同时逐句编辑入口也
// 被关掉（ui-components.js 的 refinedMode 分支）。`test-ui.mjs` 里有一条与 models.json
// 联动的断言守住这个不变量。
const timestampAlignedRefinedModels = new Set([
  'qwen3-asr-0.6b-int8',
  'funasr-nano-int8',
  'parakeet-tdt-0.6b-v3-int8',
]);
function refinedModelSupportsTimestamps(modelId) { return timestampAlignedRefinedModels.has(modelId); }
