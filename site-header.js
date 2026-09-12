requestAnimationFrame(() => document.body.classList.add('is-ready'));

const languageRoot = document.querySelector('[data-lang]');
if (languageRoot) {
  const toggle = languageRoot.querySelector('[data-lang-toggle]');
  const menu = languageRoot.querySelector('.lang-menu');
  const close = () => {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => { if (!languageRoot.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  menu.querySelectorAll('[data-lang-option]').forEach((option) => option.addEventListener('click', (event) => {
    const language = option.dataset.langOption;
    sessionStorage.setItem('lang-selected', language);
    const current = document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    if (language === current) {
      event.preventDefault();
      close();
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    event.preventDefault();
    close();
    document.body.classList.add('is-leaving');
    const go = () => { location.href = option.href; };
    document.body.addEventListener('transitionend', go, { once: true });
    setTimeout(go, 500);
  }));
}

const renderStars = (count) => {
  if (!Number.isFinite(count)) return;
  const value = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(count);
  document.querySelectorAll('[data-gh-stars]').forEach((element) => { element.textContent = value; });
  document.querySelectorAll('[data-gh-star-wrap]').forEach((element) => {
    element.classList.remove('hidden');
    element.classList.add('inline-flex');
  });
};

const starCacheKey = 'gh-stars';
let cachedStars;
try { cachedStars = JSON.parse(localStorage.getItem(starCacheKey) || 'null'); } catch {}
if (cachedStars?.count !== undefined) renderStars(cachedStars.count);
if (!cachedStars || Date.now() - cachedStars.time >= 600000) {
  fetch('https://api.github.com/repos/zerolovesea/Brevia', { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then(({ stargazers_count: count }) => {
      renderStars(count);
      try { localStorage.setItem(starCacheKey, JSON.stringify({ count, time: Date.now() })); } catch {}
    })
    .catch(() => {});
}
