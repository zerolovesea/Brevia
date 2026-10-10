(() => {
  const en = document.documentElement.lang === 'en';
  const pick = (zh, english) => (en ? english : zh);
  document.documentElement.lang = en ? 'en' : 'zh-CN';
  const stages = [
    [
      pick('扫码连接电脑', 'Scan to connect'),
      pick(
        '同一局域网内，扫描电脑上的配对码。',
        'On the same local network, scan the code on your computer.',
      ),
    ],
    [
      pick('在电脑上确认连接', 'Approve on your computer'),
      pick(
        '确认这台手机后，建立设备连接；不会自动上传录音。',
        'Approve this phone. Pairing alone does not upload recordings.',
      ),
    ],
    [
      pick('手机录音，音频发送到电脑', 'Record on your phone'),
      pick(
        '开始实时转写，手机采集声音，电脑接收音频。',
        'Start live transcription. Your phone records and streams audio to your computer.',
      ),
    ],
    [
      pick('电脑运行模型，生成转写', 'Your computer transcribes'),
      pick(
        '语音模型在电脑本地运行，手机无需下载模型。',
        'The speech model runs locally on your computer, with no model download on your phone.',
      ),
    ],
    [
      pick('转写回传，手机同步阅读', 'Read the transcript on your phone'),
      pick(
        '电脑生成的文字回传手机，边录边看，跟上每一句讨论。',
        'Text flows back to your phone, so you can follow the conversation as you record.',
      ),
    ],
  ];
  const title = pick('产品设计周会', 'Product design review');
  const transcript = pick(
    '我们先完成手机端的录音流程，下周一起验证连接体验。',
    'Let’s finish the mobile recording flow, then test the connection experience next week.',
  );
  const story = document.querySelector('.mobile-story');
  const scenarios = new DemoScenariosV3();
  document.querySelector('#desktop-home').innerHTML = scenarios.setupHomeUI();
  const desktop = document.querySelector('#desktop-live');
  desktop.innerHTML = scenarios.setupLiveUI(title);
  desktop.querySelector('#live-input-label').textContent = pick('手机音频', 'Phone audio');
  desktop.querySelector('.recording').innerHTML = `<i></i>${pick('手机录音中', 'Phone recording')}`;
  desktop.querySelector('[data-demo-id="timer"]').textContent = '00:00:12';
  document.querySelector('.meeting-name').textContent = title;
  const segment = document.createElement('div');
  segment.className = 'segment mobile-demo-caption';
  segment.innerHTML =
    '<div class="segment-meta"><span>00:12</span></div><div class="segment-text"></div>';
  desktop.querySelector('.transcript-scroll').append(segment);
  const labels = {
    'scanner-title': pick('扫描二维码', 'Scan QR code'),
    'scan-label': pick(
      '在电脑 Brevia 中打开「设备连接」',
      'Open “Device connection” in Brevia on your computer',
    ),
    'manual-label': pick('▦ 输入配对码', '▦ Enter pairing code'),
    'connect-title': pick('连接电脑', 'Connect computer'),
    'verify-title': pick('请在电脑上允许连接', 'Allow the connection on your computer'),
    'verify-copy': pick('确认两端显示相同的校验码。', 'Check that both verification codes match.'),
    'verify-label': pick('校验码', 'Verification code'),
    'verify-note': pick('仅在校验码一致时允许连接', 'Only allow if the codes match'),
    'record-label': pick('录音中', 'Recording'),
    'phone-status': pick('▱ 已传到电脑  00:12', '▱ Sent to computer  00:12'),
    'speaker-label': pick('发言人 A', 'Speaker A'),
    'audio-label': pick('音频 →', 'Audio →'),
    'text-label': pick('← 转写', '← Text'),
    'pair-title': pick('连接新设备', 'Connect new device'),
    'pair-stop': pick('停止配对', 'Stop pairing'),
    'pair-description': pick('2 分钟内有效', 'Valid for 2 minutes'),
    'pair-note': pick('演示配对码', 'Demo pairing code'),
    'approval-copy': pick(
      'iPhone 请求连接。请核对手机上的校验码：8A3F21C9',
      'iPhone requests a connection. Check the code on your phone: 8A3F21C9',
    ),
    'pair-deny': pick('拒绝', 'Deny'),
    'pair-confirm': pick('允许连接', 'Allow connection'),
    'replay-story': pick('↻ 重播', '↻ Replay'),
  };
  Object.entries(labels).forEach(([id, text]) => {
    document.getElementById(id).textContent = text;
  });
  document.querySelector('#phone-tabs').innerHTML =
    `<span>${pick('转写', 'Transcript')}</span><span>${pick('笔记', 'Notes')}</span>`;
  document.querySelector('#phone-controls').innerHTML = pick(
    '<span>Ⅱ 暂停</span><span>重点</span><span>结束</span>',
    '<span>Ⅱ Pause</span><span>Mark</span><span>End</span>',
  );
  document.querySelector('#steps').innerHTML = [
    pick('扫码', 'Scan'),
    pick('确认', 'Approve'),
    pick('录音', 'Record'),
    pick('转写', 'Transcribe'),
    pick('回传', 'Sync'),
  ]
    .map((label, i) => `<li>${String(i + 1).padStart(2, '0')} ${label}</li>`)
    .join('');
  let stage = 0;
  let frame;
  let elapsed = 0;
  let previous = 0;
  const durations = [4800, 5600, 3600, 4600, 6800];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  function updateText(progress = 1) {
    const count = Math.ceil(transcript.length * Math.min(1, progress));
    desktop.querySelector('.segment-text').textContent =
      stage >= 3 ? transcript.slice(0, stage === 3 ? count : transcript.length) : '';
    document.querySelector('.phone-transcript p').textContent =
      stage === 4 ? transcript.slice(0, count) : '';
  }
  function render(next) {
    stage = next;
    story.dataset.stage = String(stage);
    document.querySelector('#step-count').textContent = `0${stage + 1}`;
    document.querySelector('#step-title').textContent = stages[stage][0];
    document.querySelector('#step-description').textContent = stages[stage][1];
    if (!paused && !reducedMotion.matches) {
      document.querySelector('.story-heading').animate(
        [
          { opacity: 0.35, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 550, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    }
    document
      .querySelectorAll('#steps li')
      .forEach((item, i) => item.classList.toggle('active', i === stage));
    segment.classList.toggle('visible', stage >= 3);
    document.querySelector('#phone-wait').textContent = pick(
      '暂无转写。电脑处理后的文字会显示在这里。',
      'No transcript yet. Text processed by your computer will appear here.',
    );
    story.classList.toggle('paused', paused);
    document.querySelector('#pause-story').textContent = paused
      ? pick('▶ 播放', '▶ Play')
      : pick('Ⅱ 暂停', 'Ⅱ Pause');
    updateText();
  }
  function tick(now) {
    if (previous) elapsed += now - previous;
    previous = now;
    if (elapsed >= durations[stage]) {
      elapsed = 0;
      render((stage + 1) % stages.length);
    }
    updateText(Math.max(0, (elapsed - 450) / 2300));
    story.style.setProperty('--progress', Math.min(1, elapsed / durations[stage]));
    story.classList.toggle('approving', stage === 1 && elapsed > 3500);
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    cancelAnimationFrame(frame);
    previous = 0;
    if (!paused && !document.hidden) frame = requestAnimationFrame(tick);
  }
  document.querySelector('#pause-story').addEventListener('click', () => {
    paused = !paused;
    story.classList.toggle('paused', paused);
    document.querySelector('#pause-story').textContent = paused
      ? pick('▶ 播放', '▶ Play')
      : pick('Ⅱ 暂停', 'Ⅱ Pause');
    schedule();
  });
  document.querySelector('#replay-story').addEventListener('click', () => {
    elapsed = 0;
    render(0);
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  render(paused ? 4 : 0);
  schedule();
  window.mobileDemo = {
    render,
    get stage() {
      return stage;
    },
  };
})();
