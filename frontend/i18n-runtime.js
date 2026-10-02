/* 翻译运行时。
   ─────────────────────────────────────────────────────────────────────────────
   为什么单独一个文件：`t()` 是视图模块调用最频繁的跨模块符号（125 处），但它原先定义在
   **最后加载**的 app.js 里。于是「视图模块 → t → app.js → 视图模块」构成真实的循环依赖，
   这也是 ESM 迁移无法定序的根因之一。把 t 及其直接依赖（catalog、stageLabels）前移到视图
   模块之前，依赖图就变成单向：

     state → utils → data → i18n-runtime → views → app

   `locale` 来自更早加载的 app-state.js，且在**调用时**才解析（不是加载时），所以这里的
   加载顺序是安全的：本文件只需保证 i18n-data.js 已执行完。 */
const { catalog, appCopy: { stageLabels } } = window.BreviaLocaleData;
const t = (key) => stageLabels[key]?.[locale] || stageLabels[key]?.en || catalog[locale].labels[key] || key;
