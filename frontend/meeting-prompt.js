(async () => {
  const prompt = window.brevia.desktop.meetingPrompt;
  const { name, locale, theme } = await prompt({ action: 'state' });
  const t = (key) => window.BreviaLocaleData.translate(key, locale);
  document.documentElement.lang = locale;
  document.documentElement.dataset.theme = theme;
  document.querySelector('h1').textContent = t('检测到 {app} 的音频').replace('{app}', name);
  document.querySelector('[data-action="record"]').textContent = t('开始录音');
  document.querySelector('[data-action="dismiss"]').textContent = t('取消');
  document.querySelector('main').hidden = false;
  document.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action) void prompt({ action }).catch(console.error);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void prompt({ action: 'dismiss' }).catch(console.error);
  });
})().catch(console.error);
