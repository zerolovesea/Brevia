(async () => {
  const link = document.querySelector('.github-link');
  try {
    const response = await fetch('https://api.github.com/repos/zerolovesea/Brevia', {
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const { stargazers_count: stars } = await response.json();
    if (!Number.isSafeInteger(stars) || stars < 0) return;
    link.querySelector('[data-github-stars]').textContent = new Intl.NumberFormat('en', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(stars);
    const zh = document.documentElement.lang.startsWith('zh');
    const count = new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US').format(stars);
    link.setAttribute(
      'aria-label',
      zh ? `Brevia GitHub 仓库，${count} 颗星` : `Brevia on GitHub, ${count} stars`,
    );
  } catch {
    // 断网或 API 限流时保留未知星数，仓库链接仍可使用。
  }
})();
