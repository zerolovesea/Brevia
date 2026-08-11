(function () {
  const slogans = {
    zh: [
      '每一场对话，都留有依据。',
      '让重要讨论，不再散落。',
      '从声音开始，留下清晰结论。',
      '记录发生的事，推进接下来的事。',
      '把会议留在掌控之中。'
    ],
    en: [
      'Every conversation leaves a traceable record.',
      'Keep important discussions in one place.',
      'Start with sound. End with clear decisions.',
      'Record what happened. Move the work forward.',
      'Keep every meeting within reach.'
    ]
  };

  function render() {
    const content = document.getElementById('demo-content');
    if (!content) return;
    content.innerHTML = new DemoScenariosV3().setupHomeUI();

    const locale = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
    const messages = slogans[locale];
    const title = content.querySelector('#home-slogan');
    if (!title) return;

    let index = 0;
    title.textContent = messages[index];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    window.setInterval(() => {
      title.classList.add('slogan-out');
      window.setTimeout(() => {
        index = (index + 1) % messages.length;
        title.textContent = messages[index];
        title.classList.remove('slogan-out');
        title.classList.add('slogan-in');
        window.setTimeout(() => title.classList.remove('slogan-in'), 440);
      }, 280);
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
