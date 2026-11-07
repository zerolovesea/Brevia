// All displayed calls are scripted examples; the demo has no host bridge or clipboard access.
function createAgentDemo(pick) {
  const app = '/Applications/Brevia.app/Contents';
  const cli = `${app}/Resources/control/brevia`;
  const skill = `${app}/Resources/skills/brevia/SKILL.md`;
  const settings = {
    enabled: true,
    permissions: { read: true, infer: true, record: true },
    status: { ready: true },
    cli_path: cli,
    skill_path: skill,
    mcp: { env: { BREVIA_DATA_DIR: '/Users/demo/brevia' } },
  };
  const prompt = renderAgentSetupGuide(settings);
  const audio = 'entrevista.wav';
  const directory = '/Users/demo/Audio/';
  const es = 'entrevista.es.srt';
  const en = 'entrevista.en.srt';
  const request = pick(
    '把 entrevista.wav 转成西班牙语字幕，再译成英语。保留时间轴，两份 SRT 都放在录音旁边。',
    'Transcribe entrevista.wav in Spanish, then translate it into English. Save both SRT files beside the recording with the same timestamps.',
  );
  const source = document.createElement('section');
  source.className = 'agent-demo';
  source.hidden = true;
  const thread = pick('访谈字幕', 'Interview subtitles');
  const text = [
    [
      '00:00:00,000 --> 00:00:04,000',
      '¿Qué cambió después de la entrevista?',
      'What changed after the interview?',
    ],
    [
      '00:00:04,000 --> 00:00:08,000',
      'Decidimos probar el prototipo el viernes.',
      'We decided to test the prototype on Friday.',
    ],
  ];
  source.innerHTML = `<div class="agent-source settings-page modal-backdrop">
    ${renderSettingsNavigation('agent-settings')}${settingsModalMarkup()}</div>
    <div class="codex-window">
      <div class="codex-title"><span aria-hidden="true">←　→　◫</span><strong>${thread}</strong><span>···</span></div>
      <div class="codex-rail" aria-hidden="true">${interfaceIcon('home')}${interfaceIcon('clock')}${interfaceIcon('settings')}</div>
      <aside class="codex-nav"><b>Codex ﹀</b><div>${interfaceIcon('edit')}${pick('新聊天', 'New chat')}</div><small>${pick('项目', 'Projects')}</small><div>${interfaceIcon('folder')} Audio</div><small>${pick('最近', 'Recents')}</small><div class="codex-active">${thread}</div></aside>
      <main class="codex-thread"><div class="codex-history">
      <div class="codex-welcome">${pick('我们要构建什么？', 'What should we build?')}</div>
      <div class="codex-turn"><div class="codex-user-message"></div>
        <div class="agent-work"><small></small><code></code></div>
        <section class="codex-subtitles"><b></b><div class="codex-code"><header>‹/›　srt</header><pre></pre></div></section>
        <div class="agent-reply"><span>${pick('已保存两份字幕，时间轴一致。', 'Saved both subtitle files with matching timestamps.')}</span><code>${es}</code><code>${en}</code></div>
      </div></div>
      <div class="codex-composer"><div class="agent-paste"></div><p class="codex-input-task">${request}</p><span class="codex-placeholder">${pick('和 Codex 一起工作', 'Work with Codex')}</span>
      <footer><span>＋　${pick('请求批准', 'Ask for approval')}</span><span>5.4　⌄　<span class="codex-send">↑</span></span></footer></div>
      </main>
    </div>`;
  document.body.append(source);
  const settingsPage = source.querySelector('.agent-source');
  const settingsPanel = settingsPage.querySelector('.modal-panel');
  settingsPanel.classList.add('preferences-workspace');
  settingsPanel.querySelector('.modal-head').classList.add('preferences-titlebar');
  settingsPanel.querySelector('h2').textContent = t('Agent 与 MCP');
  const settingsBody = settingsPanel.querySelector('.modal-body');
  settingsBody.classList.add('preferences-scroll');
  settingsBody.innerHTML = renderAgentSettingsPage(settings);
  const paste = source.querySelector('.agent-paste');
  paste.textContent = prompt;
  const history = source.querySelector('.codex-history');
  source.querySelector('.codex-user-message').textContent = `${prompt}\n\n${request}`;
  const copy = source.querySelector('[data-agent-copy="guide"]');
  const copyIcon = copy.querySelector('[data-copy-icon]');
  const work = source.querySelector('.agent-work');
  const reply = source.querySelector('.agent-reply');
  const subtitles = source.querySelector('.codex-subtitles');
  const jobs = [
    [pick('读取 Brevia Skill', 'Read Brevia Skill'), `Read ${skill}`],
    [
      pick('检查 CLI 与本机模型', 'Check CLI and local models'),
      `${cli} status --no-start  ·  MCP: models_list`,
    ],
    [
      pick('转写音频 · MCP 已连接', 'Transcribing audio · MCP connected'),
      `inference_run({operation:"transcribe", language:"es", input_path:"${directory}${audio}", output_path:"${directory}${es}"})`,
    ],
    [
      pick('西班牙语字幕已写入', 'Spanish subtitles written'),
      `task_get → completed · ${directory}${es}`,
    ],
    [
      pick('翻译字幕 · 保留时间轴', 'Translating subtitles · keeping timestamps'),
      `inference_run({operation:"translate", language:"es", target_language:"en", input_path:"${directory}${es}", output_path:"${directory}${en}"})`,
    ],
    [pick('翻译完成', 'Translation complete'), `task_get → completed · ${directory}${en}`],
  ];
  settingsPage.remove();
  let last = -1;
  return (time) => {
    source.hidden = time === null;
    if (source.hidden) {
      if (settingsPage.isConnected) settingsPage.remove();
      last = -1;
      return;
    }
    const stage = [1600, 3000, 4700, 5700, 6800, 9100, 9900, 13000, 16000].findIndex(
      (end) => time < end,
    );
    if (stage === last) return;
    last = stage;
    source.dataset.screen = stage < 2 ? 'settings' : stage === 2 ? 'paste' : 'work';
    if (stage < 2 && !settingsPage.isConnected) source.prepend(settingsPage);
    if (stage >= 2 && settingsPage.isConnected) settingsPage.remove();
    if (stage === 1) copy.dataset.copyState = 'done';
    else delete copy.dataset.copyState;
    copyIcon.innerHTML = interfaceIcon(stage === 1 ? 'check' : 'copy');
    copy.setAttribute('aria-label', t(stage === 1 ? '已复制到剪贴板' : '复制引导语'));
    paste.hidden = stage !== 2;
    work.hidden = stage < 3;
    if (stage >= 3) {
      const [label, cmd] = jobs[stage - 3];
      work.querySelector('small').textContent = label;
      work.querySelector('code').textContent = cmd;
    }
    subtitles.hidden = stage < 6;
    if (stage >= 6) {
      const translated = stage === 8;
      subtitles.querySelector('b').textContent = translated ? en : es;
      subtitles.querySelector('pre').textContent = text
        .map(
          ([time, spanish, english], i) => `${i + 1}\n${time}\n${translated ? english : spanish}`,
        )
        .join('\n\n');
    }
    reply.hidden = stage < 8;
    history.scrollTop = stage >= 6 ? history.scrollHeight : 0;
  };
}
