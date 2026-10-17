(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 639px)');
  const header = document.querySelector('.site-header');
  const motions = new Map();
  const zh = document.documentElement.lang.startsWith('zh');
  let scheduled = false;

  function syncMotions() {
    motions.forEach((state, element) => {
      const running = state.inView && !document.hidden;
      if (!state.ready) return;
      const command = JSON.stringify({
        type: 'brevia-motion-state',
        running,
        reduced: reducedMotion.matches,
      });
      if (command === state.command) return;
      state.command = command;
      state.frame.contentWindow.postMessage(JSON.parse(command), location.origin);
    });
  }

  function configureMotion(element, state) {
    const phone = element.dataset.motionScene.startsWith('phone-');
    const pairing = element.dataset.motionScene.startsWith('pair-');
    const width = pairing ? (compact.matches ? 420 : 1000) : phone ? 390 : 1280;
    const height = pairing ? (compact.matches ? 780 : 600) : phone ? 844 : 800;
    state.frame.style.width = `${width}px`;
    state.frame.style.height = `${height}px`;
    const scale = Math.min(element.clientWidth / width, element.clientHeight / height);
    state.frame.style.transform = `scale(${scale})`;
    const mode = `${pairing && compact.matches}`;
    if (state.mode === mode) return;
    state.mode = mode;
    state.ready = false;
    state.command = '';
    element.classList.remove('is-ready');
    const source = new URL('./product-motion.html?v=20261017-motion', location.href);
    source.searchParams.set('scene', element.dataset.motionScene);
    source.searchParams.set('shot', element.dataset.motionShot || 'overview');
    source.searchParams.set('lang', zh ? 'zh' : 'en');
    source.searchParams.set(
      'version',
      document.querySelector('[data-release-version]').textContent,
    );
    state.frame.src = source.href;
  }

  function mountMotion(element) {
    if (motions.has(element)) return;
    const frame = document.createElement('iframe');
    frame.title = element.getAttribute('aria-label');
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    const state = { frame, ready: false, inView: false };
    motions.set(element, state);
    element.append(frame);
    new ResizeObserver(() => configureMotion(element, state)).observe(element);
    configureMotion(element, state);
  }

  const motionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) mountMotion(entry.target);
        const state = motions.get(entry.target);
        if (state) state.inView = entry.isIntersecting;
      });
      syncMotions();
    },
    { threshold: 0.05 },
  );
  document
    .querySelectorAll('[data-motion-scene]')
    .forEach((element) => motionObserver.observe(element));

  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'brevia-motion-ready') return;
    motions.forEach((state, element) => {
      if (event.source !== state.frame.contentWindow) return;
      state.ready = true;
      state.command = '';
      configureMotion(element, state);
      const initial = Number(element.dataset.start || 1800);
      state.frame.contentWindow.postMessage(
        {
          type: 'brevia-motion-state',
          running: false,
          reduced: reducedMotion.matches,
          seek: initial,
        },
        location.origin,
      );
      element.classList.add('is-ready');
    });
    syncMotions();
  });

  function updateScroll() {
    scheduled = false;
    header.classList.toggle('is-scrolled', scrollY > 8);
    const sections = [...document.querySelectorAll('[data-nav-section]')];
    let active = '';
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= header.offsetHeight + innerHeight * 0.35)
        active = section.id;
    });
    if (active === 'library') active = 'features';
    document.querySelectorAll('[data-section-link]').forEach((link) => {
      if (link.hash === `#${active}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function requestScroll() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateScroll);
  }
  addEventListener('scroll', requestScroll, { passive: true });
  addEventListener('resize', requestScroll);
  reducedMotion.addEventListener('change', () => {
    requestScroll();
    syncMotions();
  });
  compact.addEventListener('change', () => {
    motions.forEach((state, element) => configureMotion(element, state));
    requestScroll();
  });
  document.addEventListener('visibilitychange', syncMotions);
  updateScroll();

  const software = document.querySelector('.software-section');
  software.querySelectorAll('.software-group').forEach((group) => {
    const duplicate = group.cloneNode(true);
    duplicate.setAttribute('aria-hidden', 'true');
    duplicate.inert = true;
    group.after(duplicate);
  });
  let softwareVisible = false;
  function syncSoftware() {
    software.classList.toggle(
      'is-scrolling',
      softwareVisible && !document.hidden && !reducedMotion.matches,
    );
  }
  new IntersectionObserver(
    ([entry]) => {
      softwareVisible = entry.isIntersecting;
      syncSoftware();
    },
    { threshold: 0.05 },
  ).observe(software);
  document.addEventListener('visibilitychange', syncSoftware);
  reducedMotion.addEventListener('change', syncSoftware);
  document.documentElement.classList.add('has-motion');

  const disclosures = [...document.querySelectorAll('.disclosure')];
  const menuAnimations = new Map();
  function setDisclosure(details, open) {
    const panel = details.querySelector('.disclosure-panel');
    const wasOpen = details.open;
    const { opacity, transform } = getComputedStyle(panel);
    menuAnimations.get(details)?.cancel();
    menuAnimations.delete(details);
    delete details.dataset.closing;
    panel.inert = !open;
    if (open) {
      disclosures.forEach((other) => {
        if (other !== details && other.open) setDisclosure(other, false);
      });
      details.open = true;
    } else if (!details.open) return;
    if (reducedMotion.matches || document.hidden) {
      details.open = open;
      return;
    }
    if (!open) details.dataset.closing = 'true';
    const animation = panel.animate(
      open
        ? [
            { opacity: wasOpen ? opacity : 0, transform: wasOpen ? transform : 'translateY(-4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ]
        : [
            { opacity, transform },
            { opacity: 0, transform },
          ],
      {
        duration: open ? 160 : 100,
        easing: open ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
      },
    );
    menuAnimations.set(details, animation);
    animation.finished.then(
      () => {
        if (menuAnimations.get(details) !== animation) return;
        details.open = open;
        delete details.dataset.closing;
        menuAnimations.delete(details);
      },
      () => {},
    );
  }
  function settleMenus() {
    if (!document.hidden && !reducedMotion.matches) return;
    menuAnimations.forEach((animation) => animation.finish());
  }
  document.addEventListener('visibilitychange', settleMenus);
  reducedMotion.addEventListener('change', settleMenus);
  disclosures.forEach((details) => {
    details.querySelector('summary').addEventListener('click', (event) => {
      event.preventDefault();
      setDisclosure(details, !details.open || details.dataset.closing === 'true');
    });
    details
      .querySelectorAll('a')
      .forEach((link) => link.addEventListener('click', () => setDisclosure(details, false)));
  });
  document.addEventListener('click', (event) => {
    disclosures.forEach((details) => {
      if (!details.contains(event.target) && !details.dataset.closing && details.open)
        setDisclosure(details, false);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    disclosures.forEach((details) => {
      if (!details.open) return;
      setDisclosure(details, false);
      details.querySelector('summary').focus();
    });
  });
  document.querySelectorAll('[data-language]').forEach((link) => {
    if (link.dataset.language === (document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'))
      link.setAttribute('aria-current', 'page');
    // 浏览器禁止存储时，普通语言链接仍可正常导航。
    link.addEventListener('click', () => {
      try {
        sessionStorage.setItem('lang-selected', link.dataset.language);
      } catch {}
      link.hash = location.hash;
    });
  });
})();
