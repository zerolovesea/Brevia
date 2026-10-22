// 演示复用正式应用的外壳、图标、词条和渲染函数，不启动录音或后端。
const motionParams = new URLSearchParams(location.search);
const locale = motionParams.get('lang') === 'en' ? 'en' : 'zh';
// 正式组件通过 classic script 的共享状态读取这三项。
window.editingMeetingIndex = null;
window.uiData = { detail: {} };
window.detailActiveTab = 'summary';

(async () => {
  const pick = (zh, en) => (locale === 'en' ? en : zh);
  const scene = [
    'capsule',
    'tour',
    'live',
    'summary',
    'library',
    'phone-live',
    'phone-offline',
    'pair-microphone',
    'pair-field',
  ].includes(motionParams.get('scene'))
    ? motionParams.get('scene')
    : 'live';
  const phone = scene.startsWith('phone-');
  const tour = scene === 'tour';
  const collaboration = scene.startsWith('pair-');
  let renderCollaboration;
  let renderCapture;
  let liveNotesEditor;
  let fitPrepare;
  let acceptedCount = -1;
  const stage = document.querySelector('#motion-stage');
  stage.dataset.scene = scene;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const duration =
    scene === 'capsule'
      ? 26000
      : tour
        ? 28000
        : collaboration || motionParams.has('capture')
          ? pairingTimes.duration
          : ['live', 'summary', 'library'].includes(scene)
            ? 12000
            : 20000;
  let elapsed = 0;
  let previous = 0;
  let frame = 0;
  let running = parent === window && !motionParams.has('manual');
  let reduced = reducedMotion.matches;
  let lastPaint = -Infinity;
  const rendered = new Map();
  const write = (selector, html) => {
    if (rendered.get(selector) === html) return;
    rendered.set(selector, html);
    stage.querySelector(selector).innerHTML = html;
  };
  const timeText = (seconds) =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const reveal = (text, progress) =>
    [...text].slice(0, Math.ceil([...text].length * clamp(progress))).join('');
  const meeting = pick('产品周会', 'Product sync');
  const participants =
    locale === 'en'
      ? ['Alex Chen', 'Mia Lee', 'Sam Wang', 'Robin Lin']
      : ['张伟', '李娜', '王强', '林晨'];
  const captions = [
    [
      '我们今天确认新用户引导的上线范围。',
      'Today we will confirm the launch scope for the new onboarding flow.',
    ],
    [
      '设计稿已经完成，开发团队周四可以交付测试版本。',
      'The design is ready. Engineering can deliver a test build on Thursday.',
    ],
    [
      '周五前完成内部验收，下周一开始小范围发布。',
      'Complete internal acceptance by Friday, then start a limited rollout next Monday.',
    ],
    [
      '我来整理测试范围，重点覆盖语音转写和笔记联动。',
      'I will prepare the test scope, focusing on transcription and notes.',
    ],
    [
      '先把现有功能打磨稳定，不扩展新需求。',
      'Let us keep the current features stable before adding new scope.',
    ],
  ];
  const noteItems = [
    pick('按既定范围发布新用户引导。', 'Release the agreed onboarding scope.'),
    pick('周四交付测试版本', 'Deliver the test build on Thursday'),
    pick('周五前完成内部验收', 'Complete internal acceptance by Friday'),
    pick('下周一开始小范围发布', 'Begin a limited rollout next Monday'),
  ];
  const summaryBlocks = [
    `## ${pick('会议摘要', 'Overview')}\n\n${pick('会议确认了新用户引导的上线范围。设计已完成，团队将按计划交付测试版本，并开展小范围发布。', 'The team confirmed the onboarding launch scope. The design is complete, with a test build and a limited rollout planned next.')}`,
    `## ${pick('核心结论', 'Key conclusions')}\n\n- ${noteItems[0]}\n- ${pick('本周优先稳定现有功能，不扩展新需求。', 'Prioritize stability this week without adding new scope.')}`,
    `## ${pick('已确认决定', 'Decisions')}\n\n- ${pick('决定：下周一开始小范围发布。', 'Start the limited rollout next Monday.')}\n- ${pick('确认方：会议参与者。', 'Confirmed by the meeting participants.')}`,
    `## ${pick('行动项', 'Action items')}\n\n| ${pick('任务 | 负责人 | 截止时间 | 状态', 'Task | Owner | Due | Status')} |\n| --- | --- | --- | --- |\n| ${pick('交付测试版本 | 开发团队 | 周四 | 待开始', 'Deliver test build | Engineering | Thursday | Planned')} |\n| ${pick('完成内部验收 | 产品团队 | 周五 | 待开始', 'Internal acceptance | Product | Friday | Planned')} |`,
  ];
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  document.documentElement.classList.toggle('is-collaboration', collaboration);
  document.body.classList.toggle('is-phone', phone);
  document.body.classList.toggle('is-compact', motionParams.has('compact'));
  const focus = ['captions', 'notes', 'full'].includes(motionParams.get('focus'))
    ? motionParams.get('focus')
    : '';
  document.body.dataset.focus = focus;

  if (scene === 'capsule') {
    renderCollaboration = await createCapsuleScene(stage, locale);
  } else if (collaboration) {
    renderCollaboration = await createCollaborationScene(stage, scene, locale);
  } else if (!phone) {
    const templateURL = new URL('index.html', document.querySelector('[data-app-style]').href);
    const response = await fetch(templateURL);
    if (!response.ok) throw Error(`Application template: ${response.status}`);
    const template = new DOMParser().parseFromString(await response.text(), 'text/html');
    const shell = template.querySelector('.app-shell');
    shell.removeAttribute('aria-live');
    shell
      .querySelectorAll('img')
      .forEach((image) => (image.src = new URL(image.getAttribute('src'), templateURL).href));
    const viewId =
      scene === 'live' ? 'live-view' : scene === 'summary' ? 'detail-view' : 'home-view';
    shell.querySelectorAll('.workspace > .view').forEach((view) => {
      const keep = tour
        ? ['home-view', 'prepare-view', 'live-view', 'detail-view'].includes(view.id)
        : view.id === viewId || (motionParams.has('capture') && view.id === 'prepare-view');
      if (!keep) view.remove();
      else view.classList.toggle('active', view.id === viewId);
    });
    shell.classList.toggle('is-live-meeting', scene === 'live');
    stage.append(shell, template.querySelector('#toast').cloneNode(true));
    const textNodes = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
    while (textNodes.nextNode()) {
      const node = textNodes.currentNode;
      if (node.parentElement?.closest('.brand-name, [translate="no"]')) continue;
      const label = node.textContent.trim();
      if (label) node.textContent = node.textContent.replace(label, t(label));
    }
    shell
      .querySelectorAll('[data-interface-icon]')
      .forEach((element) => (element.innerHTML = interfaceIcon(element.dataset.interfaceIcon)));
    shell.querySelectorAll('[placeholder], [aria-label], [title]').forEach((element) => {
      for (const attribute of ['placeholder', 'aria-label', 'title'])
        if (element.hasAttribute(attribute))
          element.setAttribute(attribute, t(element.getAttribute(attribute)));
    });
    shell.querySelector('#app-version').textContent = motionParams.get('version') || 'v1.4.1';
    shell.querySelector('#theme-toggle').innerHTML = interfaceIcon('sun');
    shell.querySelector('.workspace-container').innerHTML =
      `<div class="workspace-subnav-content"><div class="workspace-heading"><h3>${t('工作区')}</h3><button class="new-workspace">${interfaceIcon('plus')}</button></div><button class="workspace-item workspace-selector">${interfaceIcon('folder')}<span class="workspace-label">${pick('产品', 'Product')}</span>${interfaceIcon('chevron-down')}</button></div>`;
    if (motionParams.has('capture'))
      renderCapture = createCaptureDemo(stage, shell, template, locale, renderLive);
    if (scene === 'live' || tour) {
      shell.querySelector('#live-name').textContent = meeting;
      shell.querySelector('#live-input-label').textContent = motionParams.has('capture')
        ? pick('手机麦克风', 'Phone microphone')
        : pick('麦克风 + 系统音频', 'Microphone + system audio');
      const notesRoot = shell.querySelector('[data-live-notes-root]');
      notesRoot.replaceChildren(shell.querySelector('[data-ai-suggestion]'));
      liveNotesEditor = createNotesEditor(notesRoot);
      notesRoot.querySelector('.notes-editor').contentEditable = 'false';
      notesRoot.querySelector('.notes-toolbar').hidden = true;
      shell.querySelector('#translation-options').innerHTML = BreviaI18n.languageOptions(locale, t)
        .map(
          ([value, label]) =>
            `<button type="button" data-live-translation="${escapeHtml(value)}">${escapeHtml(label)}</button>`,
        )
        .join('');
    }
    if (scene === 'summary' || tour) {
      const detail = shell.querySelector('#detail-view');
      detail.querySelector('h1').textContent = meeting;
      detail.querySelector('h1').title = meeting;
      detail.querySelector('.detail-layout').classList.add('is-summary-mode');
      detail.querySelector('.detail-layout').dataset.detailMode = 'summary';
      detail.querySelector('#detail-meta').innerHTML =
        `<span>2026/10/15</span><span>${interfaceIcon('clock')} ${pick('18 分钟', '18 min')}</span><span>${interfaceIcon('folder')} ${pick('产品', 'Product')}</span>`;
      detail.querySelector('.final-transcript').innerHTML =
        `${renderDetailTabbar()}<div class="detail-summary-panel" data-detail-panel="summary"></div>`;
      detail.append(detail.querySelector('.detail-actions'));
      detail.querySelector('#player-duration').textContent = '18:24';
      const task = shell.querySelector('#refinement-progress').cloneNode(true);
      task.id = 'summary-progress';
      task.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      task.classList.add('task-card-stack-item');
      task.querySelector('.task-kind-icon').innerHTML = interfaceIcon('document');
      shell.querySelector('#task-cards').append(task);
    }
    if (scene === 'library' || tour) {
      shell.querySelector('#home-eyebrow').textContent = pick('产品', 'Product');
      shell.querySelector('#home-slogan').textContent = pick(
        '所有对话，清晰归档。',
        'Every conversation, clearly organized.',
      );
      shell.querySelector('#workspace-edit').hidden = false;
    }
    if (tour) {
      const prepare = shell.querySelector('#prepare-view');
      prepare.querySelector('h1').textContent = t('新建会议');
      prepare.querySelector('[data-prepare-description]').textContent =
        t('设置会议信息并选择录制来源，开始记录你的会议。');
      prepare.querySelector('[data-prepare-source-description]').textContent =
        t('选择要录制的音频来源，可单选。');
      prepare.querySelector('.form-grid').innerHTML =
        `<label>${t('工作区')}${flowSelect('meeting-workspace', 'product', [['product', pick('产品', 'Product')]])}</label><label>${t('会议语言')}${flowSelect('meeting-language', locale === 'zh' ? 'zh' : 'auto', BreviaI18n.languageOptions(locale, t, true))}</label><label>${t('译文目标')}${flowSelect('translation-target', '', BreviaI18n.languageOptions(locale, t))}</label>`;
      prepare.querySelector('[data-prepare-extra-settings]').innerHTML =
        `<label>${t('预期说话人数')}${flowSelect('meeting-speakers', '-1', [['-1', t('自动检测')], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])])}</label><label class="prepare-model-select">${t('识别模型')}${flowSelect('refined-model', locale === 'zh' ? 'funasr-nano-mlx' : 'parakeet-tdt-0.6b-v3-mlx', [[locale === 'zh' ? 'funasr-nano-mlx' : 'parakeet-tdt-0.6b-v3-mlx', pick('Fun-ASR-Nano', 'Parakeet TDT 0.6B v3')]])}</label>`;
      prepare.querySelector('#capture-mode-mount').innerHTML =
        `<div class="flow-select capture-mode-select capture-source-list"><input type="hidden" name="capture-mode" value="both" /><div class="flow-select-options" role="radiogroup" aria-label="${t('录制来源')}">${[
          ['mic', '仅麦克风', '适合面对面交流、个人口述', 'microphone'],
          ['system', '仅系统音频', '适合网课、视频和电脑播放的音频', 'appearance'],
          ['both', '麦克风 + 系统音频', '适合线上会议，同时收录双方声音', 'waveform'],
          ['phone', '手机麦克风', '适合线下会议，用手机近距离收音', 'phone'],
        ]
          .map(
            ([value, label, description, icon]) =>
              `<button type="button" role="radio" aria-checked="${value === 'both'}" data-flow-select-choice="capture-mode" data-value="${value}">${interfaceIcon(icon)}<span><b>${t(label)}</b><small>${t(description)}</small></span><i></i></button>`,
          )
          .join('')}</div></div>`;
      prepare.querySelector('#mic-device-mount').innerHTML = flowSelect('mic-device', 'default', [
        ['default', pick('内置麦克风', 'Built-in microphone')],
      ]);
      prepare.querySelector('#mic-input-label').textContent = t('输入良好');
      prepare.querySelector('#system-input-label').textContent = t('已连接');
      prepare.querySelector('.primary-action').innerHTML =
        `${interfaceIcon('record')}${t('开始录制')}`;
      // 与正式应用保持相同的紧凑布局判断，避免较矮的演示窗口挤压电平和按钮。
      fitPrepare = () => {
        if (!prepare.classList.contains('active')) return;
        prepare.classList.remove('is-compact');
        const crowded =
          prepare.querySelector('fieldset').getBoundingClientRect().bottom + 12 >
          prepare.querySelector('.prepare-input-status').getBoundingClientRect().top;
        prepare.classList.toggle('is-compact', innerWidth <= 850 || crowded);
      };
      new ResizeObserver(fitPrepare).observe(prepare);
    }
  } else {
    stage.innerHTML = `<section class="motion-phone"><header class="motion-phone-header"><strong>${scene === 'phone-offline' ? pick('客户访谈', 'Customer interview') : pick('设计周会', 'Design weekly')}</strong><span class="motion-phone-meta"></span><i>${interfaceIcon('more')}</i></header><div class="motion-phone-tabs"></div><div class="motion-phone-content"></div><div class="motion-phone-sync"></div><footer class="motion-phone-controls"><button>${interfaceIcon('pause')}</button><button class="phone-bookmark">${interfaceIcon('bookmark')}</button><button class="phone-stop">${interfaceIcon('stop')}</button></footer><div class="motion-phone-toast"></div></section>`;
  }

  const cursor = document.createElement('div');
  cursor.className = 'motion-cursor';
  cursor.hidden = true;
  stage.append(cursor);

  const shot = ['captions', 'notes'].includes(motionParams.get('shot'))
    ? motionParams.get('shot')
    : 'overview';
  function pointAt(target, approach, click = -1) {
    if (!target) return;
    const box = target.getBoundingClientRect();
    const remaining = (1 - clamp(approach)) ** 3;
    const x = box.left + box.width * 0.65;
    const y = box.top + box.height * 0.65;
    cursor.dataset.clicking = String(click >= 0 && click <= 1);
    cursor.style.setProperty('--click-progress', clamp(click));
    const press = click >= 0 && click <= 1 ? 1 - 0.12 * Math.sin(click * Math.PI) : 1;
    cursor.style.transform = `translate(${x + remaining * 70}px,${y - remaining * 50}px) scale(${press})`;
  }

  function renderLive(time) {
    const seconds = time / 1000;
    const transcription = shot === 'captions';
    const reviewing = shot === 'notes';
    const captionClock = reviewing ? 4 : seconds;
    const translated = transcription && seconds >= 6.75;
    const visible = Math.min(
      captions.length,
      Math.max(0, Math.floor((captionClock - 0.25) / 0.7) + 1),
    );
    const lines = captions
      .slice(0, visible)
      .map((pair, index) => {
        const progress = (captionClock - 0.25 - index * 0.7) / 0.35;
        return renderTranscriptSegment({
          time: timeText(index * 3),
          speaker: {},
          showSpeaker: false,
          text: reveal(pair[locale === 'en' ? 1 : 0], progress),
          translation: translated && progress >= 1 ? pair[locale === 'en' ? 0 : 1] : '',
        });
      })
      .join('');
    write('#transcript-scroll', lines);
    const translationToggle = stage.querySelector('#translation-toggle');
    translationToggle.dataset.enabled = String(translated);
    const translationLabel = t(translated ? '翻译：开' : '翻译：关');
    translationToggle.setAttribute('aria-label', translationLabel);
    translationToggle.dataset.tooltip = translationLabel;
    const choosingLanguage = transcription && seconds >= 6.05 && seconds < 6.75;
    stage.querySelector('#translation-options').hidden = !choosingLanguage;
    translationToggle.setAttribute('aria-expanded', String(choosingLanguage));
    // 先完成字幕，再分析已有内容；笔记区直接使用已完成的字幕作为审核依据。
    const events = transcription
      ? []
      : [
          {
            text: noteItems[0],
            start: reviewing ? 0.9 : 4.2,
            accept: reviewing ? 1.8 : 5.1,
            type: 'decision',
          },
        ];
    const acceptedEvents = events.filter((event) => seconds >= event.accept);
    if (acceptedCount < 0 || acceptedEvents.length < acceptedCount) {
      liveNotesEditor.setMarkdown('');
      acceptedCount = 0;
    }
    acceptedEvents
      .slice(acceptedCount)
      .forEach((event) => liveNotesEditor.appendMarkdown(`- ${event.text}`));
    acceptedCount = acceptedEvents.length;
    const lastAccepted = acceptedEvents.at(-1);
    renderToast(lastAccepted && seconds - lastAccepted.accept < 4 ? t('已加入笔记') : '');
    const current = events.find((event) => seconds >= event.start && seconds < event.accept);
    const suggestion = stage.querySelector('[data-ai-suggestion]');
    suggestion.hidden = !current;
    const assist = stage.querySelector('[data-ai-assist-toggle]');
    assist.classList.toggle('is-enabled', !transcription);
    const assistCopy = BreviaLocaleData.appCopy.aiAssistCopy[locale];
    assist.querySelector('[data-ai-assist-toggle-label]').textContent = transcription
      ? assistCopy.toggleOff
      : assistCopy.toggleOn;
    assist.classList.toggle(
      'is-analyzing',
      events.some((event) => seconds >= event.start - 0.35 && seconds < event.start),
    );
    cursor.hidden = !current || seconds < current.start + 0.15 || focus === 'captions';
    if (current) {
      const phase = seconds - current.start;
      write(
        '[data-ai-suggestion]',
        `<div class="ai-suggestion-card"><div class="ai-suggestion-head"><span class="ai-suggestion-star">${interfaceIcon('ai')}</span><span class="ai-suggestion-type">${t(current.type === 'decision' ? '可能的决策' : '可能的待办')}</span><span class="ai-suggestion-evidence">${t('依据 {count} 段字幕').replace('{count}', '1')}</span></div><p class="ai-suggestion-text">${escapeHtml(current.text)}</p><div class="ai-suggestion-actions"><button class="ai-suggestion-accept${phase > 0.65 ? ' motion-pressed' : ''}" data-ai-accept>${interfaceIcon('plus')} ${t('加入笔记')}</button><button class="ai-suggestion-ignore" data-ai-ignore>${t('忽略')}</button></div></div>`,
      );
      pointAt(
        suggestion.querySelector('[data-ai-accept]'),
        (phase - 0.15) / 0.3,
        phase >= 0.65 ? (phase - 0.65) / 0.18 : -1,
      );
    }
    if (transcription) {
      cursor.hidden = seconds < 4.5 || seconds > 7.2;
      if (seconds < 5.3)
        pointAt(
          stage.querySelector('#live-more-toggle'),
          (seconds - 4.5) / 0.3,
          seconds >= 4.95 ? (seconds - 4.95) / 0.18 : -1,
        );
      else if (seconds < 6.2)
        pointAt(
          translationToggle,
          (seconds - 5.3) / 0.3,
          seconds >= 5.85 ? (seconds - 5.85) / 0.18 : -1,
        );
      else
        pointAt(
          stage.querySelector(`[data-live-translation="${locale === 'en' ? 'zh' : 'en'}"]`),
          (seconds - 6.2) / 0.25,
          seconds >= 6.55 ? (seconds - 6.55) / 0.18 : -1,
        );
    }
    stage.querySelector('#timer').textContent = `00:${timeText(12 + seconds)}`;
    const transcript = stage.querySelector('#transcript-scroll');
    const target = transcript.scrollHeight - transcript.clientHeight;
    transcript.scrollTop =
      stage.dataset.running === 'true'
        ? transcript.scrollTop + (target - transcript.scrollTop) * 0.2
        : target;
  }
  function renderToast(message) {
    const toast = stage.querySelector('#toast');
    toast.classList.toggle('visible', Boolean(message));
    toast.dataset.tone = 'success';
    write(
      '#toast',
      message
        ? `<i class="toast-status-mark" aria-hidden="true">${interfaceIcon('check')}</i><span>${escapeHtml(message)}</span>`
        : '',
    );
  }
  function renderSummary(time) {
    const seconds = time / 1000;
    const started = seconds >= 0.9;
    const complete = seconds >= 5.3;
    const progress = clamp((seconds - 0.9) / 4.4);
    const markdown = complete ? `# ${meeting}\n\n${summaryBlocks.join('\n\n')}` : '';
    const html = renderMeetingSummary({ markdown, generating: started && !complete, participants });
    if (rendered.get('summary') !== html) {
      rendered.set('summary', html);
      uiData.detail.summary = { markdown, generating: started && !complete };
      stage.querySelector('#detail-view .detail-content-header').outerHTML = renderDetailTabbar();
      stage.querySelector('.detail-head .summary-participants')?.remove();
      stage.querySelector('[data-detail-panel="summary"]').replaceChildren();
      stage.querySelector('.notes').innerHTML = html;
      syncDetailSummaryPanel();
      if (complete && stage.dataset.running === 'true')
        BreviaMotion.enter(stage.querySelector('.summary-body'), 'tab');
    }
    const task = stage.querySelector('#summary-progress');
    task.hidden = !started;
    const copy = BreviaLocaleData.appCopy.summaryTaskCopy[locale];
    const step = complete ? 4 : seconds < 1.5 ? 1 : seconds < 4.85 ? 2 : 3;
    const percent = Math.round(progress * 100);
    task.querySelector('.task-card-heading p').textContent = complete ? copy[4] : copy[0];
    task.querySelector('strong').innerHTML = renderTaskProgressLabel(copy[step], percent);
    Object.assign(task.dataset, {
      completed: percent,
      total: 100,
      stage: ['', 'summary.prepare', 'summary.generating', 'summary.saving', 'summary.complete'][
        step
      ],
    });
    const bar = task.querySelector('.processing-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', copy[0]);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(percent));
    bar.removeAttribute('aria-hidden');
    bar.querySelector('i').style.transform = `scaleX(${progress})`;
    task.querySelector('[data-pause-task]').disabled = complete;
    const summary = stage.querySelector('[data-task-summary]');
    summary.hidden = !started;
    summary.querySelector('[data-task-summary-label]').textContent = t('任务');
    summary.querySelector('[data-task-summary-count]').textContent = '1';
    summary.querySelector('[data-task-summary-status]').textContent = `${percent}%`;
    const toggle = stage.querySelector('[data-toggle-task-stack]');
    toggle.hidden = !started;
    toggle.querySelector('[data-task-count]').textContent = `${t('任务')} · 1`;
    stage.querySelector('.app-shell').style.setProperty('--task-progress', progress);
    renderToast(
      complete && seconds < 7
        ? t('会议纪要已生成')
        : seconds >= 7.2 && seconds < 11.2
          ? t('已复制到剪贴板')
          : '',
    );
    cursor.hidden = (started && seconds < 6.5) || seconds > 7.5;
    const target = stage.querySelector(started ? '[data-copy-summary]' : '[data-generate-summary]');
    pointAt(
      target,
      (seconds - (started ? 6.5 : 0.1)) / 0.3,
      seconds >= (started ? 7 : 0.65) ? (seconds - (started ? 7 : 0.65)) / 0.18 : -1,
    );
    target?.classList.toggle(
      'motion-pressed',
      started ? seconds >= 7 && seconds < 7.2 : seconds >= 0.65,
    );
    const body = stage.querySelector('.summary-body');
    if (body)
      body.parentElement.scrollTop =
        seconds >= 8
          ? clamp((seconds - 8) / 2.5) *
            (body.parentElement.scrollHeight - body.parentElement.clientHeight)
          : 0;
  }
  function renderLibrary(time) {
    const seconds = time / 600;
    const query =
      seconds >= 3 && seconds < 10 ? reveal(pick('产品', 'Product'), (seconds - 3) / 0.4) : '';
    const search = stage.querySelector('#meeting-search');
    search.value = query;
    const titles = [
      pick('需求评审', 'Requirements review'),
      pick('项目复盘', 'Project retrospective'),
      pick('客户访谈', 'Customer interview'),
      meeting,
    ];
    const matches = titles.filter(
      (title) => !query || title.toLowerCase().includes(query.toLowerCase()),
    );
    const rows = matches
      .map((title, index) =>
        renderMeetingRow(
          {
            id: `motion-${index}`,
            title,
            meta: pick('10月15日 10:34 · 18 分钟', 'Oct 15, 10:34 · 18 min'),
            tags: [],
            status: {
              tone: 'done',
              label: pick('已整理', 'Ready'),
              detail: pick('2 位参与者 · 已生成纪要', '2 participants · Minutes ready'),
            },
            workspace: { name: pick('产品', 'Product') },
          },
          index,
        ),
      )
      .join('');
    write(
      '.meeting-list',
      `<header class="library-group"><h2>${pick('今天', 'Today')}</h2><span>${matches.length}</span></header>${rows}`,
    );
    stage.querySelectorAll('.meeting-row-checkbox').forEach((checkbox) => (checkbox.hidden = true));
    const menu = stage.querySelector('.meeting-row .meeting-menu');
    menu.hidden = !(seconds >= 12 && seconds < 16);
    stage.querySelector('.meeting-row').classList.toggle('motion-selected', seconds >= 11);
    const exportAction = menu.querySelector('[data-meeting-action="export"]');
    exportAction.classList.toggle('motion-pressed', seconds >= 14);
    cursor.hidden = seconds < 2 || seconds > 15.5;
    if (seconds < 10)
      pointAt(search, (seconds - 2) / 0.3, seconds >= 2.8 ? (seconds - 2.8) / 0.6 : -1);
    else if (seconds < 12)
      pointAt(
        stage.querySelector('[data-meeting-menu]'),
        (seconds - 10) / 0.3,
        seconds >= 11.5 ? (seconds - 11.5) / 0.6 : -1,
      );
    else pointAt(exportAction, (seconds - 12) / 0.3, seconds >= 13.9 ? (seconds - 13.9) / 0.6 : -1);
    let toast = stage.querySelector('.motion-export-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'motion-export-toast';
      stage.append(toast);
    }
    toast.textContent = pick('会议记录已导出', 'Meeting exported');
    toast.hidden = seconds < 16;
  }
  function renderPhone(time) {
    const seconds = time / 1000;
    const offline = scene === 'phone-offline';
    const notes = !offline && seconds >= 10 && seconds < 15;
    const elapsedLabel = timeText((offline ? 8 * 60 : 12 * 60) + seconds);
    write(
      '.motion-phone-meta',
      offline
        ? ''
        : `<span class="phone-record-dot"></span>${pick('录音中', 'Recording')} · ${elapsedLabel}`,
    );
    stage.querySelector('.motion-phone-tabs').hidden = offline;
    if (!offline)
      write(
        '.motion-phone-tabs',
        [pick('转写', 'Transcript'), pick('笔记', 'Notes'), pick('重点', 'Highlights')]
          .map(
            (label, index) =>
              `<span class="${index === (notes ? 1 : 0) ? 'active' : ''}">${label}</span>`,
          )
          .join(''),
      );
    if (offline) {
      write(
        '.motion-phone-content',
        `<div class="phone-record-focus"><span class="phone-record-dot"></span><strong>${pick('录音中', 'Recording')}</strong><time>${elapsedLabel}</time></div><div class="phone-local-note">${interfaceIcon('phone')}<div><strong>${pick('仅保存在手机', 'Saved on this phone')}</strong><p>${pick('无需连接电脑。录音保存在本机，连接后由你主动上传。', 'No computer needed. Audio stays on your phone until you choose to upload it.')}</p></div></div>`,
      );
    } else if (notes) {
      write(
        '.motion-phone-content',
        `<div class="phone-notes markdown-content">${renderMarkdown(`## ${pick('本周重点', 'This week')}\n\n- ${noteItems[1]}\n- ${noteItems[2]}\n\n## ${pick('下一步', 'Next steps')}\n\n- [ ] ${noteItems[3]}`)}</div>`,
      );
    } else {
      const count = Math.min(3, Math.floor(seconds / 0.7) + 1);
      write(
        '.motion-phone-content',
        captions
          .slice(0, count)
          .map(
            (pair, index) =>
              `<article class="phone-caption"><time>${timeText(index * 12)}</time><p>${escapeHtml(reveal(pair[locale === 'en' ? 1 : 0], (seconds - index * 0.7) / 0.35))}</p></article>`,
          )
          .join(''),
      );
    }
    stage
      .querySelector('.phone-bookmark')
      .classList.toggle('motion-pressed', seconds >= 5 && seconds < 6.5);
    cursor.hidden = seconds < 4 || seconds > 7;
    pointAt(
      stage.querySelector('.phone-bookmark'),
      seconds - 4,
      seconds >= 5 ? (seconds - 5) / 0.6 : -1,
    );
    const toast = stage.querySelector('.motion-phone-toast');
    toast.hidden = !(seconds >= 5.2 && seconds < 7.2);
    toast.textContent = pick('已标记重点', 'Highlight saved');
    const sync = stage.querySelector('.motion-phone-sync');
    sync.hidden = offline;
    if (!offline)
      write(
        '.motion-phone-sync',
        `<span>${interfaceIcon('phone')}<b>${pick('录音保存在本机', 'Audio saved locally')}</b><small>${elapsedLabel}</small></span><span>${interfaceIcon('laptop')}<b>${pick('已传到电脑', 'Sent to computer')}</b><small>${elapsedLabel}</small></span>`,
      );
  }
  function renderTour(time) {
    const phase =
      time < 1600 ? 'home' : time < 4800 ? 'prepare' : time < 17000 ? 'live' : 'summary';
    const viewId = phase === 'summary' ? 'detail-view' : `${phase}-view`;
    stage
      .querySelectorAll('.workspace > .view')
      .forEach((view) => view.classList.toggle('active', view.id === viewId));
    stage.querySelector('.app-shell').classList.toggle('is-live-meeting', phase === 'live');
    stage.querySelector('#all-meetings').classList.toggle('active', phase === 'home');
    const enteredPrepare = phase === 'prepare' && stage.dataset.tourPhase !== phase;
    if (
      stage.dataset.tourPhase &&
      stage.dataset.tourPhase !== phase &&
      stage.dataset.running === 'true'
    )
      BreviaMotion.enter(stage.querySelector(`#${viewId}`), phase === 'home' ? 'back' : 'forward');
    stage.dataset.tourPhase = phase;
    if (enteredPrepare) fitPrepare();
    if (phase !== 'summary') {
      stage.querySelector('#summary-progress').hidden = true;
      stage.querySelector('[data-task-summary]').hidden = true;
      stage.querySelector('[data-toggle-task-stack]').hidden = true;
    }
    if (phase === 'home') {
      renderLive(0);
      renderLibrary(0);
      cursor.hidden = time < 250;
      pointAt(
        stage.querySelector('.new-meeting'),
        (time - 250) / 350,
        time >= 1200 ? (time - 1200) / 180 : -1,
      );
    } else if (phase === 'prepare') {
      const title = stage.querySelector('#meeting-title');
      title.value = reveal(meeting, (time - 1900) / 350);
      cursor.hidden = false;
      if (time < 2400) pointAt(title, (time - 1600) / 250, time >= 1850 ? (time - 1850) / 180 : -1);
      else if (time < 3400)
        pointAt(
          stage.querySelector('#capture-mode-mount [data-value="both"]'),
          (time - 2400) / 250,
          time >= 2650 ? (time - 2650) / 180 : -1,
        );
      else
        pointAt(
          stage.querySelector('#meeting-form .primary-action'),
          (time - 3500) / 300,
          time >= 4400 ? (time - 4400) / 180 : -1,
        );
    } else if (phase === 'live') {
      renderLive(time - 4800);
      if (time >= 16000) {
        cursor.hidden = false;
        pointAt(
          stage.querySelector('#end-meeting'),
          (time - 16000) / 300,
          time >= 16600 ? (time - 16600) / 180 : -1,
        );
      }
    } else renderSummary(time - 17000);
  }
  const paint =
    collaboration || scene === 'capsule'
      ? renderCollaboration
      : tour
        ? renderTour
        : scene === 'live'
          ? renderCapture || renderLive
          : scene === 'summary'
            ? renderSummary
            : scene === 'library'
              ? renderLibrary
              : renderPhone;
  function renderAt(time) {
    const phase = ((time % duration) + duration) % duration;
    stage.style.opacity = '1';
    paint(phase);
    stage.dataset.phase = String(Math.floor(phase));
    stage.dataset.cycle = String(Math.floor(time / duration));
  }
  function tick(now) {
    if (previous) elapsed += Math.min(100, now - previous);
    previous = now;
    if (collaboration || now - lastPaint >= 16) {
      renderAt(elapsed);
      lastPaint = now;
    }
    const meter = stage.querySelector('[data-live-mic-level]');
    if (meter) {
      const speech = 0.5 + 0.5 * Math.sin(elapsed / 1100);
      const level =
        0.12 + speech * (0.4 + 0.2 * Math.sin(elapsed / 91) + 0.15 * Math.sin(elapsed / 213));
      meter.style.setProperty('--level', clamp(level));
    }
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    cancelAnimationFrame(frame);
    previous = 0;
    stage.dataset.running = String(running && !reduced && !document.hidden);
    stage.dataset.reduced = String(reduced);
    if (reduced) {
      renderAt(duration - 2500);
      stage.style.opacity = '1';
    } else if (running && !document.hidden) frame = requestAnimationFrame(tick);
    if (reduced || !running || document.hidden)
      stage.getAnimations({ subtree: true }).forEach((animation) => {
        if (!(animation instanceof CSSAnimation)) animation.finish();
      });
  }
  addEventListener('message', (event) => {
    if (
      event.source !== parent ||
      event.origin !== location.origin ||
      event.data?.type !== 'brevia-motion-state'
    )
      return;
    running = event.data.running === true;
    reduced = event.data.reduced === true;
    if (Number.isFinite(event.data.seek)) {
      elapsed = Math.max(0, Math.min(duration - 500, event.data.seek));
      renderAt(elapsed);
    }
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => {
    reduced = reducedMotion.matches;
    schedule();
  });
  elapsed = 1800;
  renderAt(elapsed);
  await document.fonts.ready;
  window.productMotion = {
    scene,
    duration,
    seek(time) {
      elapsed = time;
      renderAt(time);
    },
    get elapsed() {
      return elapsed;
    },
    get running() {
      return stage.dataset.running === 'true';
    },
  };
  schedule();
  parent.postMessage({ type: 'brevia-motion-ready' }, location.origin);
})().catch((error) => console.error('Brevia motion:', error));
