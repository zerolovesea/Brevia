// 只加载当前应用的视图层；不加载宿主桥，不读取用户数据或申请设备权限。
const locale = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
const uiData = { detail: { summary: {} } };
const workspaces = [{ id: 'product', name: locale === 'zh' ? '产品团队' : 'Product team' }];
const currentMeetingDetail = { id: 'demo', workspace_id: workspaces[0].id };
const detailActiveTab = 'summary';
const editingMeetingIndex = null;
(async () => {
  const templateURL = new URL(document.querySelector('[rel="application-template"]').href);
  const response = await fetch(templateURL);
  if (!response.ok) throw new Error(`Application template: ${response.status}`);
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.theme = 'light';
  const stylesReady = Promise.all(
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
  const shell = template.querySelector('.app-shell');
  shell.removeAttribute('aria-live');
  shell.querySelectorAll('img[src]').forEach((img) => {
    img.src = new URL(img.getAttribute('src'), templateURL).href;
  });
  document.body.append(shell, template.querySelector('#glossary-prompt'));
  const scriptsReady = Promise.all(
    [
      'i18n-data.js',
      'i18n.js',
      'i18n-runtime.js',
      'app-utils.js',
      'motion.js',
      'ui-components.js',
      'meeting-evidence.js',
      'glossary-markdown.js',
      'glossary.js',
      'desktop-mobile-preview.js',
    ].map(
      (name) =>
        new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.async = false;
          script.src = new URL(name, templateURL).href;
          script.onload = resolve;
          script.onerror = reject;
          document.head.append(script);
        }),
    ),
  );
  await Promise.all([stylesReady, scriptsReady]);
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
  const phoneFrame = document.createElement('div');
  phoneFrame.className = 'pair-handset';
  phoneScene.append(pairing, phoneFrame);
  document.body.append(phoneScene);
  const phoneDemo = document.createElement('section');
  phoneDemo.id = 'mobile-dialog';
  phoneDemo.className = 'pair-shared-preview';
  phoneDemo.dataset.mobilePageState = 'intro';
  phoneDemo.innerHTML =
    '<div class="mobile-page-content"><div class="mobile-page-preview"></div></div>';
  phoneFrame.append(phoneDemo);
  const phoneController = BreviaDesktopMobilePreview.init(phoneDemo);
  phoneController.setPaused(true);
  phoneController.select(1);
  phoneDemo.querySelector('.dmp-screen').append(handset);
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
  const discussion = [
    pick(
      '第一次开会先录音吧。模型和语言用默认值就够了，一开始选太多会打断对话。',
      'Let people record first. Default model and language settings cover most meetings, and too many choices interrupt the conversation.',
    ),
    pick(
      '手机放在发言人旁边会听得清楚些。就用手机收音，通过局域网传到电脑转写，电脑还能继续工作。',
      'The phone is clearer when placed by the speakers. Let it record and send audio over the local network for desktop transcription while we keep working.',
    ),
    pick(
      '纪要是 AI 整理的。每条结论留个原话入口，大家才能回听，核对具体措辞和谁负责。',
      'AI drafts the minutes. Keep a link from each conclusion to the recording so we can check the exact wording and who owns it.',
    ),
  ];
  const claims = [];
  decisions.forEach((text, i) => {
    const source = {
      segment_id: `discussion-${i}`,
      current_segment_id: `discussion-${i}`,
      start_ms: (i * 35 + 50) * 1000,
      end_ms: (i * 35 + 64) * 1000,
      text: discussion[i],
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
  let capsuleReady = false;
  let latestTime = 0;
  const capsuleError = document.createElement('p');
  capsuleError.textContent = pick('胶囊演示暂时无法加载', 'The capsule demo could not load');
  Object.assign(capsuleError.style, {
    position: 'fixed',
    inset: '35% 12%',
    zIndex: '101',
    textAlign: 'center',
  });
  capsuleError.hidden = true;
  document.body.append(capsuleError);
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== capsule.contentWindow) return;
    if (event.data?.type === 'brevia-capsule-ready') {
      capsuleReady = true;
      render(latestTime);
      syncAnimations(paused);
    }
    if (event.data?.type === 'brevia-capsule-error') {
      capsule.dataset.failed = 'true';
      render(latestTime);
    }
  });
  // 桌面首帧无需等待胶囊子窗口就绪。
  requestAnimationFrame(() => {
    capsule.src = new URL(`./capsule-preview.html?lang=${locale}`, location.href).href;
    document.body.append(capsule);
  });
  const mention = {
    meeting_id: currentMeetingDetail.id,
    workspace_id: currentMeetingDetail.workspace_id,
    title,
    original: 'L L M',
  };
  const meaning = pick('大语言模型', 'Large language model');
  const termQuote = pick(
    '纪要整理用的是 L L M，也就是能理解和生成文字的大语言模型。',
    'We use an L L M, a large language model that understands and generates text, to organize the minutes.',
  );
  const termMarkdown =
    '## ' +
    t('会议摘要') +
    '\n\n- ' +
    pick(
      '团队将使用 L L M 整理会议纪要，并为结论保留原话引用。',
      'The team will use an L L M to organize meeting minutes and retain source quotes.',
    );
  const prompt = document.querySelector('#glossary-prompt');
  let summaryStage = '';
  let reveals = [];
  let textReveals = [];

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
    latestTime = time;
    const clock = ((time % 65000) + 65000) % 65000;
    const phase =
      clock < 10000
        ? 1
        : clock < 20000
          ? 2
          : clock < 32000
            ? 3
            : clock < 40000
              ? 0
              : clock < 56000
                ? 4
                : 5;
    const local = clock - [32000, 0, 10000, 20000, 40000, 56000][phase];
    const step = Math.floor(local / 1750);
    const reviewing = phase === 3 || phase === 5;
    const view = reviewing ? 'detail-view' : 'live-view';
    if (phase !== phaseBefore) {
      if (phaseBefore === 5) glossaryUI.closePrompt();
      document.body.dataset.phase = phase;
      shell
        .querySelectorAll('.workspace > .view')
        .forEach((el) => el.classList.toggle('active', el.id === view));
      shell.classList.toggle('is-live-meeting', phase === 1 || phase === 2);
      shell.classList.toggle('is-library-hidden', innerWidth <= 740);
      shell.classList.toggle('is-settings-view', phase === 4);
      shell.querySelector('#crumb').textContent =
        phase === 4 ? t('设置') : reviewing ? t('会议详情') : title;
    }
    const sideBySide = phase === 0 && innerWidth > 740;
    shell.style.width = sideBySide ? 'calc(100% - 380px)' : '';
    shell.classList.toggle('is-library-hidden', innerWidth <= 740 || sideBySide);
    agentScene(phase === 4 ? local : null);
    phoneScene.classList.toggle('is-away', phase !== 0);
    const connected = phase === 0 && local >= 2400;
    shell.querySelector('#mobile-nav').classList.toggle('is-connected', connected);
    write(shell.querySelector('#mobile-sidebar-status'), t(connected ? '已连接' : '等待设备连接'));
    if (phase === 0 && !handset.hasAttribute('src'))
      handset.src = `./mobile-preview/index.html?lang=${locale}`;
    if (phase === 0) {
      const screen = local < 2400 ? 'scan' : local < 4700 ? 'start' : 'record';
      if (phoneScene.dataset.step !== screen) {
        phoneScene.dataset.step = screen;
        phoneController.select(screen === 'record' ? 1 : 0);
        phoneController.setPaused(true);
      }
      phoneScene.toggleAttribute('data-show-code', local < 1100);
      phoneFrame.classList.toggle('is-recording', screen === 'record');
      handset.hidden = screen === 'record';
      const caption = lines[0][1].slice(0, Math.max(0, Math.floor((local - 4800) / 45)));
      const seconds = Math.max(0, Math.floor((local - 4700) / 1000));
      if (screen === 'record') phoneController.seekLive(local - 4700, [caption, '', '']);
      const phoneSpeaker = phoneDemo.querySelector('.dmp-transcript header');
      write(
        phoneSpeaker.querySelector('span'),
        local < 5500 ? pick('识别中…', 'Identifying…') : lines[0][0],
      );
      write(phoneSpeaker.querySelector('time'), '00:04');
      segments.forEach(({ row, label, text, translation }, i) => {
        row.hidden = screen !== 'record' || i !== 0;
        translation.hidden = caption !== lines[0][1];
        if (i === 0) {
          write(text, caption);
          write(label, local < 5500 ? pick('识别中…', 'Identifying…') : lines[0][0]);
        }
      });
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
      phase === 0
        ? `00:00:${String(42 + Math.max(0, Math.floor((local - 4700) / 1000))).padStart(2, '0')}`
        : `00:00:${String(Math.floor(clock / 1000) + 4).padStart(2, '0')}`,
    );
    if (phase === 1 || (phase !== 0 && phaseBefore !== phase)) {
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
        const sourceCompleteAt = i * 2200 + lines[i][1].length * 35;
        translation.hidden = phase === 1 && (step < 2 || local < sourceCompleteAt + 350);
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
    if (reviewing) {
      const glossary = phase === 5;
      const done = local >= (glossary ? 6200 : 8200);
      const stage = phase + ':' + done;
      if (stage !== summaryStage) {
        const entering = !summaryStage.startsWith(phase + ':');
        summaryStage = stage;
        uiData.detail.summary = { markdown: glossary ? termMarkdown : markdown, generating: !done };
        if (entering) {
          detail.classList.toggle('has-cause-rail', !glossary);
          detail.innerHTML =
            renderDetailTabbar() +
            '<div class="detail-summary-panel" data-detail-panel="summary">' +
            renderMeetingSummary({
              markdown: uiData.detail.summary.markdown,
              claims: glossary ? [] : claims,
            }) +
            '</div>' +
            (glossary ? '' : renderDetailCauseRail(claims, markdown, 'demo'));
          reveals = glossary
            ? []
            : [
                ...Array.from(detail.querySelectorAll('.summary-reading-section'), (el, i) => [
                  el,
                  200 + i * 680,
                ]),
                ...Array.from(detail.querySelectorAll('.cause-tree-topic'), (el, i) => [
                  el,
                  1200 + i * 1700,
                ]),
                ...Array.from(
                  detail.querySelectorAll('.cause-tree-topic .evidence-claim'),
                  (el, i) => [el, 1600 + i * 920],
                ),
                ...Array.from(detail.querySelectorAll('.cause-tree-links > g'), (el, i) => [
                  el,
                  1600 + i * 920,
                ]),
                ...Array.from(detail.querySelectorAll('.cause-tree-spine'), (el) => [el, 1200]),
                ...Array.from(detail.querySelectorAll('.evidence-inline'), (el) => [el, 7200]),
              ];
          textReveals = [];
          if (!glossary)
            for (const [section, start] of reveals.filter(([el]) =>
              el.matches('.summary-reading-section'),
            )) {
              const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
              const nodes = [];
              while (walker.nextNode())
                if (
                  walker.currentNode.data.trim() &&
                  !walker.currentNode.parentElement.closest('details')
                )
                  nodes.push(walker.currentNode);
              let offset = 0;
              for (const node of nodes) {
                const chars = Array.from(node.data);
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < chars.length; i += 3) {
                  const span = document.createElement('span');
                  span.textContent = chars.slice(i, i + 3).join('');
                  textReveals.push([span, start + Math.min(750, offset * 12)]);
                  fragment.append(span);
                  offset += 3;
                }
                node.replaceWith(fragment);
              }
            }
        } else {
          detail.querySelector('.detail-content-header').outerHTML = renderDetailTabbar();
        }
        if (glossary)
          glossaryUI.paint(
            detail.querySelector('.summary-body'),
            done ? [{ ...mention, name: 'LLM', meaning }] : [],
          );
      }
      if (glossary) {
        const open = local >= 1200 && !done;
        if (open && !prompt.matches(':popover-open'))
          glossaryUI.ask(mention, false, async () => ({ text: termQuote, start_ms: 24000 }));
        if (!open && prompt.matches(':popover-open')) glossaryUI.closePrompt();
        if (open) {
          const fields = prompt.querySelector('form').elements;
          fields.name.value =
            local < 2300 ? mention.original : 'LLM'.slice(0, Math.max(0, (local - 2300) / 150));
          fields.meaning.value = meaning.slice(0, Math.max(0, (local - 3200) / 85));
          fields.meaning
            .closest('form')
            .querySelector('.modal-action')
            .classList.toggle('demo-save', local >= 5600);
        }
      } else {
        for (const [el, start] of reveals) {
          const bubble = el.matches('.evidence-claim,.cause-tree-topic');
          const fraction = Math.max(0, Math.min(1, (local - start) / (bubble ? 350 : 220)));
          el.style.display = local < start ? 'none' : '';
          el.style.opacity = String(fraction);
          if (bubble)
            el.style.clipPath =
              'inset(' +
              (1 - fraction) * 7 +
              '% ' +
              (1 - fraction) * 12 +
              '% ' +
              (1 - fraction) * 7 +
              '% 0 round 12px)';
        }
        for (const [span, start] of textReveals)
          span.style.opacity = String(Math.max(0, Math.min(1, (local - start) / 220)));
      }
    } else summaryStage = '';
    const capsuleRequested = phase === 2 && local >= 4800;
    capsuleError.hidden = !capsuleRequested || capsule.dataset.failed !== 'true';
    const showCapsule = capsuleRequested && capsuleReady;
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
  function syncAnimations(settle) {
    handset.contentWindow.playMobilePreview?.(!paused && phaseBefore === 0);
    phoneController.setPaused(true);
    for (const animation of [
      ...document.getAnimations(),
      ...(capsuleReady ? capsule.contentDocument.getAnimations() : []),
    ]) {
      if (paused && settle && Number.isFinite(animation.effect?.getComputedTiming().endTime))
        animation.finish();
      else if (paused) animation.pause();
      else if (animation.playState === 'paused') animation.play();
    }
  }
  addEventListener('message', (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.type !== 'brevia-landing-frame'
    )
      return;
    paused = Boolean(event.data.paused);
    if (Number.isFinite(event.data.time)) render(event.data.time);
    syncAnimations(event.data.settle);
  });
  render(0);
  document.body.inert = true;
  parent.postMessage({ type: 'brevia-landing-ready' }, location.origin);
})().catch((error) => {
  console.error(error);
  parent.postMessage({ type: 'brevia-landing-error' }, location.origin);
});
