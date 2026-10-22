// 五步引导共用录音、转写、纪要轮播；只更新左侧，不调用真实服务。
(() => {
  const mounts = new WeakMap();
  const stages = ['language', 'permissions', 'setup', 'ai', 'phone'];
  const getCopy = (displayLocale) => {
    const dictionary = window.BreviaLocaleData?.onboardingMotionCopy || {};
    return { ...(dictionary.en || {}), ...(dictionary[displayLocale] || {}) };
  };
  function render(kind, displayLocale) {
    if (!stages.includes(kind)) throw new RangeError('Unknown onboarding motion kind');
    const copy = getCopy(displayLocale);
    const c = (key) => escapeHtml(copy[key] || '');
    return `<section class="bom" data-kind="${kind}"><div class="bom-paper" data-motion="paper" aria-hidden="true"><header class="bom-card-heading"><b>${c('meeting')}</b><span data-motion="record-indicator" class="bom-record-indicator"><i></i>00:18</span></header><svg class="bom-wave" viewBox="0 0 452 278" preserveAspectRatio="none"><path data-motion="curve-one" /><path data-motion="curve-two" /></svg><div class="bom-transcript"><p data-motion="transcript-one">${c('transcriptFirst')}</p><p data-motion="transcript-two">${c('transcriptSecond')}</p></div><div class="bom-minutes"><section data-motion="points"><h3>${c('pointsHeading')}</h3><p><i class="bom-bullet"></i>${c('pointItem')}</p></section><section data-motion="actions"><h3>${c('actionsHeading')}</h3><p><i class="bom-check-box"></i>${c('actionItem')}</p></section></div></div><div class="bom-captions" aria-hidden="true">${['record', 'transcript', 'summary'].map((name) => `<div data-motion="caption-${name}"><h3>${c(name + 'Heading')}</h3><p>${c(name + 'Caption')}</p></div>`).join('')}</div><div class="bom-pagination" aria-hidden="true">${['record', 'transcript', 'summary'].map((name) => `<i data-motion="dot-${name}"></i>`).join('')}</div></section>`;
  }
  // 沿用 reference.png 原轮播的声音曲线，段数一致以便平滑变形成文字基线。
  function curve(amplitude, baseline, phase = 0) {
    const points = Array.from({ length: 65 }, (_, index) => {
      const x = 24 + (404 * index) / 64;
      const envelope = Math.sin((Math.PI * index) / 64);
      const wave = Math.sin(index * 0.79 + phase) * 0.65 + Math.sin(index * 1.21 + phase) * 0.35;
      return [x, baseline + wave * amplitude * envelope];
    });
    let path = `M ${points[0].join(' ')}`;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1],
        current = points[index];
      const before = points[Math.max(0, index - 2)],
        after = points[Math.min(points.length - 1, index + 1)];
      path += ` C ${previous[0] + (current[0] - before[0]) / 6} ${previous[1] + (current[1] - before[1]) / 6} ${current[0] - (after[0] - previous[0]) / 6} ${current[1] - (after[1] - previous[1]) / 6} ${current.join(' ')}`;
    }
    return path;
  }
  function mount(rail, kind, displayLocale) {
    if (!stages.includes(kind)) throw new RangeError('Unknown onboarding motion kind');
    mounts.get(rail)?.destroy();
    if (!rail.querySelector(`.bom[data-kind="${kind}"]`))
      rail.insertAdjacentHTML('beforeend', render(kind, displayLocale));
    const root = rail.querySelector('.bom');
    const paper = root.querySelector('[data-motion="paper"]');
    const q = (names) =>
      Array.from(
        root.querySelectorAll(
          names
            .split(',')
            .map((name) => `[data-motion="${name}"]`)
            .join(','),
        ),
      );
    const gsap = window.gsap;
    if (!gsap || !window.CustomEase) throw new Error('Local GSAP and CustomEase are required');
    gsap.registerPlugin(window.CustomEase);
    const smooth = window.CustomEase.create('brevia-onboarding-smooth', '0.22,1,0.36,1');
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reducedMotion = preference.matches;
    const narrowViewport = window.matchMedia('(max-width: 700px)');
    const isHidden = () => document.hidden || narrowViewport.matches;
    const style = getComputedStyle(root);
    const waveColor = style.getPropertyValue('--color-text-subtle').trim() || '#969aa2';
    const lineColor = style.getPropertyValue('--color-line').trim() || '#d8dade';
    const duration = 9;
    const timeline = gsap.timeline({ paused: true, defaults: { duration: 0.6, ease: smooth } });
    const tl = timeline;
    const wave = curve(38, 152);
    // 基线跟随实际翻译的换行高度，波形与文字不会在切换时错位。
    const paperBounds = paper.getBoundingClientRect();
    const textBaselines = q('transcript-one,transcript-two').map((line) => {
      const bounds = line.getBoundingClientRect();
      const textStyle = getComputedStyle(line);
      const fontSize = parseFloat(textStyle.fontSize);
      const baseline =
        bounds.top -
        paperBounds.top +
        (parseFloat(textStyle.lineHeight) - fontSize) / 2 +
        fontSize * 0.8;
      return (baseline * 278) / paperBounds.height;
    });
    gsap.set(q('curve-one'), { attr: { d: wave }, opacity: 1, stroke: waveColor });
    gsap.set(q('curve-two'), { attr: { d: curve(0, 152) }, opacity: 0, stroke: waveColor });
    gsap.set(q('transcript-one,transcript-two,points,actions,caption-transcript,caption-summary'), {
      opacity: 0,
      y: 6,
    });
    gsap.set(q('transcript-one,transcript-two'), {
      clipPath: 'inset(0 100% 0 0)',
      filter: 'blur(1.5px)',
    });
    gsap.set(q('points,actions'), { filter: 'blur(1.5px)' });
    gsap.set(q('record-indicator,caption-record'), { opacity: 1, y: 0 });
    gsap.set(q('dot-record'), { scaleX: 3, opacity: 1 });
    gsap.set(q('dot-transcript,dot-summary'), { scaleX: 1, opacity: 0.2 });
    for (const [at, phase] of [
      [0, 'recording'],
      [2.35, 'transcript'],
      [5.35, 'minutes'],
      [8.1, 'recording'],
    ]) {
      tl.addLabel(phase === 'recording' && at ? 'return' : phase, at);
      tl.set(paper, { attr: { 'data-phase': phase } }, at);
    }
    tl.to(q('curve-one'), { attr: { d: curve(32, 152, 0.55) } }, 0.55);
    tl.to(q('curve-one'), { attr: { d: wave } }, 1.35);
    // 先把声音收成两条基线，再沿基线接入整句文字。
    tl.to(
      q('curve-one'),
      {
        attr: { d: curve(0, textBaselines[0]) },
        stroke: lineColor,
        duration: 0.7,
        ease: 'sine.inOut',
      },
      2.35,
    );
    tl.to(
      q('curve-two'),
      {
        attr: { d: curve(0, textBaselines[1]) },
        opacity: 0.65,
        stroke: lineColor,
        duration: 0.65,
        ease: 'sine.inOut',
      },
      2.48,
    );
    tl.to(
      q('record-indicator,caption-record'),
      { opacity: 0, y: -3, duration: 0.34, ease: 'sine.inOut' },
      2.35,
    );
    tl.to(q('caption-transcript'), { opacity: 1, y: 0, duration: 0.5 }, 2.55);
    tl.to(
      q('transcript-one,transcript-two'),
      {
        opacity: 1,
        y: 0,
        clipPath: 'inset(0 0% 0 0)',
        filter: 'blur(0px)',
        duration: 0.5,
        stagger: 0.1,
      },
      2.95,
    );
    tl.to(q('curve-one,curve-two'), { opacity: 0, duration: 0.48, ease: 'sine.inOut' }, 3.06);
    tl.to(q('dot-record'), { scaleX: 1, opacity: 0.2 }, 2.35);
    tl.to(q('dot-transcript'), { scaleX: 3, opacity: 1 }, 2.35);
    // 错开出口与入口，文字轻收拢后再落成两组纪要，避免整块重叠。
    tl.to(
      q('transcript-one,transcript-two'),
      {
        opacity: 0,
        y: -3,
        filter: 'blur(1.5px)',
        duration: 0.36,
        stagger: 0.06,
        ease: 'sine.inOut',
      },
      5.35,
    );
    tl.to(q('caption-transcript'), { opacity: 0, y: -3, duration: 0.34, ease: 'sine.inOut' }, 5.35);
    tl.to(q('caption-summary'), { opacity: 1, y: 0, duration: 0.5 }, 5.55);
    tl.to(
      q('points,actions'),
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.58, stagger: 0.1 },
      5.58,
    );
    tl.to(q('dot-transcript'), { scaleX: 1, opacity: 0.2 }, 5.35);
    tl.to(q('dot-summary'), { scaleX: 3, opacity: 1 }, 5.35);
    tl.to(q('points,actions'), { opacity: 0, y: 6, filter: 'blur(1.5px)', stagger: 0.045 }, 8.1);
    tl.to(q('caption-summary'), { opacity: 0, y: 6 }, 8.1);
    tl.to(q('record-indicator,caption-record'), { opacity: 1, y: 0 }, 8.1);
    tl.to(q('curve-one'), { attr: { d: wave }, opacity: 1, stroke: waveColor }, 8.1);
    tl.to(q('dot-summary'), { scaleX: 1, opacity: 0.2 }, 8.1);
    tl.to(q('dot-record'), { scaleX: 3, opacity: 1 }, 8.1);
    // 不可见的文字也回到初始位置，下一轮不会从上一轮的出口跳入。
    tl.set(q('transcript-one,transcript-two'), { y: 6, clipPath: 'inset(0 100% 0 0)' }, 8.8);
    tl.set(q('caption-transcript'), { y: 6 }, 8.8);
    tl.set(q('curve-two'), { attr: { d: curve(0, 152) }, stroke: waveColor }, 8.8);
    tl.to({}, { duration: 0.2 }, 8.8);
    let destroyed = false;
    let resumeWhenVisible = false;
    timeline.timeScale(1.35);
    const onVisibility = () => {
      if (destroyed) return;
      if (isHidden()) {
        resumeWhenVisible = resumeWhenVisible || !timeline.paused();
        timeline.pause();
      } else if (resumeWhenVisible && !preference.matches) {
        resumeWhenVisible = false;
        timeline.play();
      }
    };
    const onPreference = () => {
      if (preference.matches) {
        resumeWhenVisible = false;
        timeline.pause().seek(0);
      } else if (!isHidden()) timeline.play();
      else resumeWhenVisible = true;
    };
    timeline.eventCallback('onComplete', () => {
      if (!destroyed && !timeline.paused() && !preference.matches && !isHidden())
        timeline.restart();
    });
    document.addEventListener('visibilitychange', onVisibility);
    narrowViewport.addEventListener('change', onVisibility);
    preference.addEventListener('change', onPreference);
    timeline.seek(0);
    const handle = {
      timeline,
      seek(seconds) {
        if (destroyed) return;
        timeline.pause().seek(Math.max(0, Math.min(duration, Number(seconds) || 0)));
        resumeWhenVisible = false;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        timeline.pause();
        timeline.revert();
        timeline.kill();
        document.removeEventListener('visibilitychange', onVisibility);
        narrowViewport.removeEventListener('change', onVisibility);
        preference.removeEventListener('change', onPreference);
        mounts.delete(rail);
      },
    };
    mounts.set(rail, handle);
    if (!reducedMotion && !isHidden()) timeline.play();
    else if (!reducedMotion) resumeWhenVisible = true;
    return handle;
  }
  window.BreviaOnboardingMotion = { render, mount };
})();
