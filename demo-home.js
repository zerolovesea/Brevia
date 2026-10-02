(function () {
  const slogans = {
    zh: [
      '听见讨论，留下下一步。',
      'AI 辅助笔记，及时接住关键时刻。',
      '决策、待办与问题，不必等到会后。',
      '记录正在发生的事，推进接下来的事。',
      '把每场会议，变成可行动的记录。'
    ],
    en: [
      'Hear the discussion. Keep the next step.',
      'AI Assist Notes catches the moments that matter.',
      'Decisions, actions, and questions before the meeting ends.',
      'Record what is happening. Move the work forward.',
      'Turn every meeting into an actionable record.'
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
