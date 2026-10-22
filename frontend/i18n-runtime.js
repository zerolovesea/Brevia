// 视图模块先于 app.js 加载；词条查询共用主进程与辅助窗口使用的实现。
const { catalog } = window.BreviaLocaleData;
const t = (key) => window.BreviaLocaleData.translate(key, locale);
