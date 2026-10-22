(() => {
  let selected;
  try {
    selected = sessionStorage.getItem('lang-selected');
  } catch {}
  // 手动选择沿用到本次会话结束；首次访问按浏览器的语言优先顺序匹配。
  const supported = ['zh', 'en'];
  const preferred = (navigator.languages?.length ? navigator.languages : [navigator.language])
    .map((language) => String(language).toLowerCase().split('-')[0])
    .find((language) => supported.includes(language));
  const language = supported.includes(selected) ? selected : preferred || 'en';
  const current = location.pathname.match(/index-(zh|en)\.html$/)?.[1];
  if (current === language) return;
  const target = new URL(`./index-${language}.html`, location.href);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
})();
