// 真实胶囊组件运行在独立文档，桥接只更新演示内存，不连接桌面服务。
(async () => {
  const url = document.querySelector('[rel="application-template"]').href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Capsule template: ${response.status}`);
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  await Promise.all(
    [...template.querySelectorAll('link[rel="stylesheet"]')].map(
      (link) =>
        new Promise((resolve, reject) => {
          const style = document.createElement('link');
          style.rel = 'stylesheet';
          style.href = new URL(link.getAttribute('href'), url).href;
          style.onload = resolve;
          style.onerror = reject;
          document.head.append(style);
        }),
    ),
  );
  document.body.append(template.querySelector('.capsule-shell'));
  document.querySelectorAll('img[src]').forEach((img) => {
    img.src = new URL(img.getAttribute('src'), url).href;
  });
  const listeners = new Map();
  let state = {
    meetingId: 'website-demo',
    phase: 'recording',
    theme: 'light',
    locale: new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh',
    title: '',
    elapsed: 0,
    level: 0.4,
    canPause: true,
    captions: [],
    notes: '',
    expanded: false,
  };
  window.brevia = {
    on: (name, fn) => listeners.set(name, fn),
    desktop: {
      state: async () => state,
      expand: async ({ expanded }) => {
        state = { ...state, expanded };
        listeners.get('desktop.state')?.(state);
      },
      action: async () => {},
      move: async () => {},
    },
  };
  for (const name of ['i18n-data.js', 'motion.js', 'recording-capsule.js'])
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(name, url).href;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  window.capsulePreview = (next) => {
    state = { ...state, ...next };
    listeners.get('desktop.state')(state);
  };
  document.body.inert = true;
  parent.postMessage({ type: 'brevia-capsule-ready' }, location.origin);
})().catch((error) => {
  console.error(error);
  parent.postMessage({ type: 'brevia-capsule-error' }, location.origin);
});
