// 只加载当前应用的视图层；不加载宿主桥，不读取用户数据或申请设备权限。
const locale = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
const uiData = { detail: { summary: {} } };
const detailActiveTab = 'summary';
const editingMeetingIndex = null;
(async () => {
  const templateURL = new URL(document.querySelector('[rel="application-template"]').href);
  const response = await fetch(templateURL);
  if (!response.ok) throw new Error(`Application template: ${response.status}`);
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.theme = 'dark';
  await Promise.all(
    [...template.querySelectorAll('link[rel="stylesheet"]')].map(
      (link) =>
        new Promise((resolve, reject) => {
          const style = document.createElement('link');
          style.rel = 'stylesheet';
          style.href = new URL(link.getAttribute('href'), templateURL).href;
          style.onload = resolve;
          style.onerror = reject;
          document.head.append(style);
        }),
    ),
  );
  for (const name of [
    'i18n-data.js',
    'i18n.js',
    'i18n-runtime.js',
    'app-utils.js',
    'motion.js',
    'ui-components.js',
    'meeting-evidence.js',
  ]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(name, templateURL).href;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }
  const shell = template.querySelector('.app-shell');
  shell.removeAttribute('aria-live');
  document.body.append(shell);
  document.querySelectorAll('img[src]').forEach((img) => {
    img.src = new URL(img.getAttribute('src'), templateURL).href;
  });
  function localize(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const key = node.textContent.trim();
      if (key && !node.parentElement.closest('[translate="no"]'))
        node.textContent = node.textContent.replace(key, t(key));
    }
    for (const attribute of ['placeholder', 'aria-label', 'title', 'data-tooltip', 'alt']) {
      for (const element of root.querySelectorAll(`[${attribute}]`)) {
        element.setAttribute(attribute, t(element.getAttribute(attribute)));
      }
    }
  }
  localize(shell);
  document.querySelectorAll('[data-interface-icon]').forEach((el) => {
    el.innerHTML = interfaceIcon(el.dataset.interfaceIcon);
  });
  const pick = (cn, en) => (locale === 'zh' ? cn : en);
  const title = pick('产品设计周会', 'Product design weekly');
  const agentScene = createAgentDemo(pick);
  const lines = [
    [
      pick('林晓', 'Alex'),
      pick('让我们把第一次使用的流程再简化一些。', 'Simplifiquemos los primeros pasos.'),
      'Let’s make the first-time experience simpler.',
    ],
    [
      pick('陈默', 'Sam'),
      pick(
        '同意。先让用户完成录音，再介绍更多功能。',
        'De acuerdo. Primero, que puedan grabar. Después les mostramos las demás funciones.',
      ),
      'Agreed. Let people record first, then explore.',
    ],
    [
      pick('林晓', 'Alex'),
      pick('那周五之前，我来完成新版原型。', 'Tendré listo el nuevo prototipo antes del viernes.'),
      'I’ll have the updated prototype ready by Friday.',
    ],
  ];
  const action = locale === 'en' ? lines[2][2] : lines[2][1];
  const notes = createNotesEditor(shell.querySelector('[data-live-notes-root]'));
  shell.querySelector('#live-name').textContent = title;
  shell.querySelector('#detail-view h1').textContent = title;
  shell.querySelector('#detail-meta').textContent = pick(
    '手机麦克风 · 12 分钟',
    'Phone microphone · 12 min',
  );
  shell.querySelector('#player-duration').textContent = '12:08';
  shell.querySelector('[data-status-version]').textContent =
    new URLSearchParams(location.search).get('version') || '';
  shell.querySelector('#mobile-sidebar-status').textContent = t('等待设备连接');
  shell.querySelector('.workspace-container').classList.add('workspace-subnav');
  shell.querySelector('.workspace-container').innerHTML =
    `<div class="workspace-subnav-content"><div class="workspace-heading navigation-section-heading"><button class="workspace-selector"><span>${t('工作区')}</span>${interfaceIcon('chevron-down')}</button><button class="new-workspace">${interfaceIcon('plus')}</button></div></div>`;
  const groups = [
    [
      pick('产品团队', 'Product team'),
      [
        title,
        pick('用户访谈 · 新手体验', 'User interviews · Onboarding'),
        pick('设计评审 · 手机协同', 'Design review · Mobile'),
        pick('上周产品周会', 'Last week’s product sync'),
      ],
    ],
    [
      pick('研究与访谈', 'Research & interviews'),
      [
        pick('客户访谈 · 远程团队', 'Customer interview · Remote teams'),
        pick('可用性测试记录', 'Usability test notes'),
        pick('研究计划讨论', 'Research planning'),
      ],
    ],
    [
      pick('个人', 'Personal'),
      [
        pick('灵感与想法', 'Ideas and inspiration'),
        pick('播客 · 工作的未来', 'Podcast · The future of work'),
      ],
    ],
  ];
  shell.querySelector('.meeting-list').innerHTML = groups
    .map(
      ([name, titles], group) =>
        `<section class="sidebar-workspace"><header class="sidebar-workspace-header"><button class="workspace-item sidebar-workspace-toggle" aria-expanded="true">${interfaceIcon('chevron-right')}${interfaceIcon('folder')}<span class="workspace-label">${name}</span></button></header><div class="sidebar-workspace-meetings">${titles.map((name, i) => renderNavigationMeeting({ id: `demo-${group}-${i}`, title: name, tags: [], status: { label: t('已完成') }, statusCode: 'completed' }, i)).join('')}</div></section>`,
    )
    .join('');
  shell.querySelector('.navigation-meeting').classList.add('is-current');
  shell.querySelectorAll('.meeting-row-checkbox').forEach((input) => {
    input.hidden = true;
  });
  const phoneScene = document.createElement('div');
  phoneScene.className = 'pair-scene is-away';
  const pairing = template.querySelector('#mobile-pair-dialog');
  pairing.open = true;
  pairing.querySelector('#mobile-pairing').hidden = false;
  pairing.querySelector('#mobile-qr').src = './assets/pair-demo.png';
  pairing.querySelector('#mobile-pin').textContent = '482 916';
  localize(pairing);
  pairing
    .querySelectorAll('[data-interface-icon]')
    .forEach((el) => (el.innerHTML = interfaceIcon(el.dataset.interfaceIcon)));
  const handset = document.createElement('iframe');
  handset.className = 'pair-phone';
  handset.title = pick('Brevia 手机版', 'Brevia mobile');
  handset.setAttribute('allow', "camera 'none'; microphone 'none'");
  phoneScene.append(pairing, handset);
  document.body.append(phoneScene);
  let phoneState = '';
  const decisions = [
    pick(
      '首次使用只保留录音入口，模型和语言设置采用默认值。',
      'Keep first use focused on recording, with sensible model and language defaults.',
    ),
    pick('手机收音，电脑转写。', 'Record on the phone and transcribe on the computer.'),
    pick(
      '纪要保留原话引用，重要结论必须能回到录音核对。',
      'Keep source references in the summary so important decisions can be checked against the recording.',
    ),
  ];
  const headings = [
    pick('新手体验', 'First-time experience'),
    pick('手机协同', 'Phone and desktop'),
    pick('可信的会议纪要', 'Trustworthy meeting notes'),
  ];
  const markdown = `# ${title}\n\n${headings.map((heading, i) => `## ${heading}\n\n### ${pick('决定', 'Decision')}\n\n- ${decisions[i]}\n\n${pick('团队将在本周验证完整流程，保留已有录音和手动笔记。', 'The team will validate the complete flow this week, preserving recordings and handwritten notes.')}`).join('\n\n')}\n\n## ${pick('行动项', 'Action items')}\n\n- [ ] ${pick('林晓：周五前完成新版原型。', 'Alex: updated prototype by Friday.')}\n- [ ] ${pick('陈默：验证手机连接和离线补传。', 'Sam: validate phone pairing and offline upload.')}`;
  shell.querySelector('[data-library-metrics]').innerHTML = renderLibraryMetricsItems(
    {
      meeting_count: groups.reduce((count, [, meetings]) => count + meetings.length, 0),
      meeting_duration_ms: 96 * 60000,
      subtitle_characters: 14820,
      summary_characters: 2140,
    },
    BreviaI18n.localeTag(locale),
  );
  const reasons = [
    [
      pick('为什么先让用户开始录音？', 'Why put recording first?'),
      pick(
        '过多的初始设置打断对话，让用户还没开始就要做决定。',
        'Too many initial choices interrupt the conversation before recording starts.',
      ),
      pick(
        '默认值足以覆盖多数会议，进阶设置可以稍后调整。',
        'Defaults cover most meetings; advanced settings can follow later.',
      ),
    ],
    [
      pick('为什么用手机收音？', 'Why record on the phone?'),
      pick(
        '手机更靠近说话人，线下会议的人声更清晰。',
        'A phone placed near speakers captures clearer voices in the room.',
      ),
      pick(
        '电脑继续工作，录音通过局域网同步到同一场会议。',
        'Keep working on desktop while audio syncs over the local network.',
      ),
    ],
    [
      pick('为什么给结论保留来源？', 'Why keep sources attached?'),
      pick(
        'AI 整理的是讨论结果，参与者仍需核对措辞和责任归属。',
        'AI organizes the discussion; participants still need to verify wording and ownership.',
      ),
    ],
  ];
  const claims = [];
  decisions.forEach((text, i) => {
    const source = {
      segment_id: `demo-${i}`,
      current_segment_id: `demo-${i}`,
      start_ms: (i * 4 + 4) * 1000,
      end_ms: (i * 4 + 8) * 1000,
      text: lines[i][1],
      speaker: lines[i][0],
    };
    claims.push({
      id: `decision-${i}`,
      kind: 'decision',
      text,
      line: `- ${text}`,
      section: headings[i],
      sources: [source],
      source_chars: [...source.text].length,
    });
    reasons[i].slice(1).forEach((reason, j) =>
      claims.push({
        id: `cause-${i}-${j}`,
        kind: 'cause',
        text: reason,
        line: `- ${text}`,
        section: reasons[i][0],
        sources: [source],
        source_chars: [...source.text].length,
      }),
    );
  });
  const detail = shell.querySelector('.final-transcript');
  shell.querySelector('#detail-view .detail-layout').classList.add('is-summary-mode');
  shell.querySelector('#detail-view').append(shell.querySelector('.detail-actions'));
  shell.querySelector('#detail-meta').innerHTML =
    `<span>2026/11/07</span><span>${interfaceIcon('clock')}${pick('12 分钟', '12 min')}</span><span>${interfaceIcon('folder')}${pick('产品团队', 'Product team')}</span>`;
  const capsule = document.createElement('iframe');
  capsule.src = new URL(`./capsule-preview.html?lang=${locale}`, location.href).href;
  capsule.title = 'Brevia meeting capsule';
  Object.assign(capsule.style, {
    position: 'fixed',
    width: '344px',
    height: '440px',
    right: '32px',
    top: '90px',
    border: '0',
    background: 'transparent',
    zIndex: '100',
    opacity: '0',
    pointerEvents: 'none',
    transform: 'translateY(20px)',
  });
  document.body.append(capsule);
  await new Promise((resolve, reject) => {
    const receive = (event) => {
      if (event.origin !== location.origin || event.source !== capsule.contentWindow) return;
      if (event.data?.type === 'brevia-capsule-ready') {
        removeEventListener('message', receive);
        resolve();
      }
      if (event.data?.type === 'brevia-capsule-error') {
        removeEventListener('message', receive);
        reject(new Error('Capsule could not load'));
      }
    };
    addEventListener('message', receive);
  });
  let summaryStage = '';
  let noteSaved = false;
  let phaseBefore = -1;
  let capsuleShown = false;
  let transition;
  let paused = false;
  const suggestion = shell.querySelector('[data-ai-suggestion]');
  suggestion.innerHTML = `<div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">${interfaceIcon('ai')}</span><span class="ai-suggestion-type">${t('可能的待办')}</span></div><p class="ai-suggestion-text">${action}</p><div class="ai-suggestion-actions"><button class="ai-suggestion-accept" data-ai-accept>${interfaceIcon('plus')} ${t('加入笔记')}</button><button class="ai-suggestion-ignore">${t('忽略')}</button></div></div>`;
  const transcript = shell.querySelector('#transcript-scroll');
  transcript.innerHTML = lines
    .map(([name, text, translation], i) =>
      renderTranscriptSegment({
        time: `00:${String(4 + i * 4).padStart(2, '0')}`,
        speaker: { name, id: String(i % 2) },
        text,
        translation,
        segmentId: `demo-${i}`,
      }),
    )
    .join('');
  const segments = [...transcript.children].map((row) => ({
    row,
    label: row.querySelector('.segment-speaker'),
    text: row.querySelector('.segment-copy > p'),
    translation: row.querySelector('.translation'),
  }));
  const captions = lines.map(([, text, translation], i) => ({
    id: `line-${i}`,
    time: `00:${String(4 + i * 4).padStart(2, '0')}`,
    text,
    translation,
  }));
  let capsuleSecond = -1;
  let capsuleExpanded;
  const write = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  function render(time) {
    const clock = ((time % 56000) + 56000) % 56000;
    const phase = clock < 10000 ? 1 : clock < 20000 ? 2 : clock < 32000 ? 3 : clock < 40000 ? 0 : 4;
    const local = clock - [32000, 0, 10000, 20000, 40000][phase];
    const step = Math.floor(local / 1750);
    const view = phase === 3 ? 'detail-view' : 'live-view';
    if (phase !== phaseBefore) {
      document.body.dataset.phase = phase;
      shell
        .querySelectorAll('.workspace > .view')
        .forEach((el) => el.classList.toggle('active', el.id === view));
      shell.classList.toggle('is-live-meeting', phase === 1 || phase === 2);
      shell.classList.toggle('is-library-hidden', innerWidth <= 740);
      shell.classList.toggle('is-settings-view', phase === 4);
      shell.querySelector('#crumb').textContent =
        phase === 4 ? t('设置') : phase === 3 ? t('会议详情') : title;
    }
    agentScene(phase === 4 ? local : null);
    phoneScene.classList.toggle('is-away', phase !== 0);
    const connected = phase === 0 && local >= 2400;
    shell.querySelector('#mobile-nav').classList.toggle('is-connected', connected);
    write(shell.querySelector('#mobile-sidebar-status'), t(connected ? '已连接' : '等待设备连接'));
    if (phase === 0 && !handset.hasAttribute('src'))
      handset.src = `./mobile-preview/index.html?lang=${locale}`;
    if (phase === 0) {
      const screen = local < 2400 ? 'scan' : local < 4700 ? 'start' : 'record';
      if (phoneScene.dataset.step !== screen) phoneScene.dataset.step = screen;
      phoneScene.toggleAttribute('data-show-code', local < 1100);
      const caption = lines[0][1].slice(0, Math.max(0, Math.floor((local - 4800) / 45)));
      const seconds = Math.max(0, Math.floor((local - 4700) / 1000));
      const state = `${screen}:${caption}:${seconds}`;
      if (handset.contentWindow.showMeetingPreview && phoneState !== state) {
        handset.contentWindow.playMobilePreview(!paused);
        handset.contentWindow.showMeetingPreview(
          screen,
          caption,
          caption === lines[0][1] ? lines[0][2] : '',
          seconds,
        );
        phoneState = state;
      }
    } else if (phoneState) {
      phoneState = '';
      handset.contentWindow.playMobilePreview?.(false);
    }
    write(
      shell.querySelector('#timer'),
      `00:00:${String(Math.floor(clock / 1000) + 4).padStart(2, '0')}`,
    );
    if (phase === 1 || phaseBefore !== phase) {
      segments.forEach(({ row, label, text, translation }, i) => {
        row.hidden = phase === 1 && local < i * 2200;
        write(
          label,
          phase === 1 && local < i * 2200 + 850 ? pick('识别中…', 'Identifying…') : lines[i][0],
        );
        write(
          text,
          phase === 1
            ? lines[i][1].slice(0, Math.max(0, Math.floor((local - i * 2200) / 35)))
            : lines[i][1],
        );
        translation.hidden = phase === 1 && step < 2;
      });
    }
    suggestion.hidden = phase !== 2 || step >= 2;
    const accepted = phase >= 2 && (phase > 2 || local >= 3500);
    if (accepted !== noteSaved) {
      noteSaved = accepted;
      notes.setMarkdown(
        phase >= 2 && (phase > 2 || local >= 3500)
          ? `## ${pick('下一步', 'Next step')}\n\n- [ ] ${lines[2][0]} · ${pick('周五前完成新版原型', 'Updated prototype by Friday')}`
          : '',
      );
    }
    if (phase === 3) {
      const generated = local >= 2200;
      const nextStage = generated ? 'complete' : 'generating';
      if (summaryStage !== nextStage) {
        summaryStage = nextStage;
        uiData.detail.summary = { markdown: generated ? markdown : '', generating: !generated };
        detail.classList.toggle('has-cause-rail', generated);
        detail.innerHTML = `${renderDetailTabbar()}<div class="detail-summary-panel" data-detail-panel="summary">${renderMeetingSummary({ markdown: generated ? markdown : '', claims: generated ? claims : [], generating: !generated })}</div>${generated ? renderDetailCauseRail(claims, markdown, 'demo') : ''}`;
        if (generated) BreviaMotion.enter(detail.querySelector('.summary-preview'), 'content');
      }
      const source = detail.querySelector('details.evidence-claim');
      if (source) source.open = local >= 6500 && local < 11000;
      const rail = detail.querySelector('.detail-cause-scroll');
      if (rail)
        rail.scrollTop =
          (Math.max(0, local - 10000) / 4000) *
          Math.min(240, rail.scrollHeight - rail.clientHeight);
    } else summaryStage = '';
    const showCapsule = phase === 2 && local >= 4800;
    const expanded = showCapsule && local >= 6200;
    const seconds = Math.floor(clock / 1000) + 4;
    if (showCapsule && (!capsuleShown || expanded !== capsuleExpanded)) {
      capsuleExpanded = expanded;
      capsule.contentWindow.capsulePreview({
        locale,
        title,
        elapsed: seconds,
        expanded,
        captions,
        notes: noteSaved ? `- ${action}` : '',
      });
    }
    if (showCapsule && seconds !== capsuleSecond) {
      capsuleSecond = seconds;
      write(
        capsule.contentDocument.querySelector('#capsule-time'),
        `00:${String(seconds).padStart(2, '0')}`,
      );
    }
    if (showCapsule !== capsuleShown) {
      capsuleShown = showCapsule;
      transition?.cancel();
      shell.style.opacity = showCapsule ? '0.35' : '1';
      capsule.style.opacity = showCapsule ? '1' : '0';
      if (showCapsule)
        transition = capsule.animate(
          [
            { opacity: 0, transform: 'translateY(20px) scale(.92)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 500, easing: BreviaMotion.easing.out, fill: 'forwards' },
        );
    }
    if (phase !== phaseBefore) {
      if (phase === 3) BreviaMotion.enter(shell.querySelector(`#${view}`), 'forward');
      phaseBefore = phase;
    }
    const toggle = shell.querySelector('#translation-toggle');
    const enabled = phase !== 1 || step >= 2;
    if (toggle.dataset.enabled !== String(enabled)) {
      toggle.dataset.enabled = String(enabled);
      toggle.dataset.tooltip = t(enabled ? '翻译：开' : '翻译：关');
      toggle.setAttribute('aria-label', toggle.dataset.tooltip);
    }
    return phase;
  }
  window.appMotion = { render };
  addEventListener('resize', () => shell.classList.toggle('is-library-hidden', innerWidth <= 740));
  addEventListener('message', (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.type !== 'brevia-landing-frame'
    )
      return;
    paused = Boolean(event.data.paused);
    handset.contentWindow.playMobilePreview?.(!paused && phaseBefore === 0);
    if (Number.isFinite(event.data.time)) render(event.data.time);
    for (const animation of [
      ...document.getAnimations(),
      ...capsule.contentDocument.getAnimations(),
    ]) {
      if (
        paused &&
        event.data.settle &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
      )
        animation.finish();
      else if (paused) animation.pause();
      else if (animation.playState === 'paused') animation.play();
    }
  });
  render(0);
  document.body.inert = true;
  parent.postMessage({ type: 'brevia-landing-ready' }, location.origin);
})().catch((error) => {
  console.error(error);
  parent.postMessage({ type: 'brevia-landing-error' }, location.origin);
});
