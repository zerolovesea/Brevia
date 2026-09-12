/* 视图模块 → 应用层的唯一出口。
   ─────────────────────────────────────────────────────────────────────────────
   视图模块（ui-components / workspaces / app-meetings / app-meeting-detail）里有 27 处需要
   回调进 app.js 的动作（弹提示、重绘列表、切视图、更新播放器…）。此前它们直接调用定义在
   app.js 里的函数，依赖图因此成环：views → app.js → views。

   有了这层接缝，依赖方向变成单向：views → appActions ← app.js（app.js 启动时注册实现），
   从而具备 ESM 化所需的定序条件。同时它把"视图模块可以请求哪些应用动作"从隐式约定变成
   一份显式清单——写错名字会在启动时立刻失败，而不是等到用户点那个按钮。

   注意加载顺序：本文件必须在任何视图模块之前、且在 app.js 注册之前加载。注册发生前调用
   会抛出明确错误，而不是 undefined is not a function。 */
const APP_ACTION_NAMES = [
  // ui-components.js
  'scheduleDetailNotesSave', 'showToast',
  // workspaces.js
  'filterMeetings', 'renderMeetingList', 'openConfirmation', 'selectLibraryNav',
  'transitionPage', 'minimizeMeeting', 'showView',
  // app-meetings.js（renderMeetingList 已在上方声明，视图间共用同一个动作）
  // app-meeting-detail.js
  'updatePlayerControl', 'renderPlayerTime',
];
const registeredAppActions = new Map();
const appActions = new Proxy({}, {
  get(_target, name) {
    if (typeof name !== 'string' || !APP_ACTION_NAMES.includes(name)) return undefined;
    const implementation = registeredAppActions.get(name);
    if (implementation) return implementation;
    return () => {
      throw new Error(`应用动作 ${name} 尚未注册：app.js 调用了 registerAppActions 之后才能使用`);
    };
  },
  has: (_target, name) => registeredAppActions.has(name),
});

/** app.js 启动时把实现登记进来。重复注册或名字不在清单内都属于编程错误，直接抛出。 */
function registerAppActions(source, implementations) {
  for (const [name, implementation] of Object.entries(implementations)) {
    if (!APP_ACTION_NAMES.includes(name)) throw new Error(`registerAppActions(${source}): ${name} 不在 APP_ACTION_NAMES 清单中`);
    if (typeof implementation !== 'function') throw new TypeError(`registerAppActions(${source}): ${name} 不是函数`);
    if (registeredAppActions.has(name)) throw new Error(`registerAppActions(${source}): ${name} 已被重复注册`);
    registeredAppActions.set(name, implementation);
  }
}
