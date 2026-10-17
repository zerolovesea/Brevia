const pairingTimes = {
  camera: 1200,
  approval: 3800,
  connected: 6200,
  source: 7400,
  dropdown: 8700,
  selected: 10200,
  record: 12000,
  captions: 13000,
  duration: 34000,
};

// 官网只驱动演示时钟，不访问设备或启动录音；桌面画面复用正式应用模板。
window.createCaptureDemo = (stage, shell, template, locale, renderLive) => {
  const pick = (zh, en) => (locale === 'en' ? en : zh);
  const field = new URLSearchParams(location.search).get('capture') === 'field';
  const prepare = shell.querySelector('#prepare-view');
  const live = shell.querySelector('#live-view');
  const get = (selector) => stage.querySelector(selector);
  get('#meeting-title').value = pick('产品周会', 'Product sync');
  get('.form-grid').innerHTML = [
    ['工作区', 'meeting-workspace', pick('产品', 'Product')],
    ['会议语言', 'meeting-language', pick('中文', 'English')],
    ['译文目标', 'translation-target', pick('不翻译', 'No translation')],
    ['预期说话人数', 'meeting-speakers', pick('自动检测', 'Auto-detect')],
    ['识别模型', 'refined-model', 'SenseVoice Small'],
  ]
    .map(
      ([label, name, value]) =>
        `<label>${t(label)}${flowSelect(name, value, [[value, value]])}</label>`,
    )
    .join('');
  get('#capture-mode-mount').innerHTML =
    `<div class="flow-select capture-mode-select capture-source-list"><div class="flow-select-options" role="radiogroup">${[
      ['mic', '仅麦克风', '适合面对面交流、个人口述', 'microphone'],
      ['system', '仅系统音频', '适合网课、视频和电脑播放的音频', 'appearance'],
      ['both', '麦克风 + 系统音频', '适合线上会议，同时收录双方声音', 'waveform'],
      ['phone', '手机麦克风', '适合线下会议，用手机近距离收音', 'phone'],
    ]
      .map(
        ([value, label, description, icon]) =>
          `<button type="button" role="radio" aria-checked="${value === 'phone'}" data-value="${value}">${interfaceIcon(icon)}<span><b>${t(label)}</b><small>${t(description)}</small></span><i></i></button>`,
      )
      .join('')}</div></div>`;
  get('#mic-device-setting').hidden = true;
  get('#phone-device-setting').hidden = false;
  get('#phone-device-mount').innerHTML = flowSelect('phone-device', 'phone', [
    ['phone', 'iPhone', t('已连接')],
  ]);
  get('#mic-device-mount').innerHTML = flowSelect('mic-device', 'default', [
    ['default', pick('内置麦克风', 'Built-in microphone')],
  ]);
  get('#mic-input-label').textContent = t('输入良好');
  get('#system-input-state').hidden = true;
  const overlay = document.createElement('div');
  overlay.className = 'capture-pair-overlay';
  const modal = template.querySelector('#mobile-pair-dialog').cloneNode(true);
  modal.setAttribute('open', '');
  overlay.append(modal);
  stage.append(overlay);
  const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const label = walker.currentNode.textContent.trim();
    if (label)
      walker.currentNode.textContent = walker.currentNode.textContent.replace(label, t(label));
  }
  modal
    .querySelectorAll('[data-interface-icon]')
    .forEach((element) => (element.innerHTML = interfaceIcon(element.dataset.interfaceIcon)));
  get('#mobile-pairing').hidden = false;
  get('#mobile-qr').src = './assets/collaboration/pairing-preview.svg';
  get('#mobile-pin').textContent = '482 916';
  get('#mobile-approval').innerHTML =
    `<div class="mobile-request-info">${interfaceIcon('phone')}<p class="mobile-request-copy"><b>iPhone</b><span>${t('请求与 Brevia 建立连接。')}</span><span>${t('校验词')}</span><strong class="mobile-verification">8F2A7C91</strong><small>${t('请核对手机与电脑上的校验词。')}</small></p></div><div class="mobile-request-actions"><button class="secondary">${t('拒绝')}</button><button class="modal-action collab-allow">${t('允许连接')}</button></div>`;
  let previousPhase;
  return (time) => {
    const pairing = !field && time < pairingTimes.connected;
    const approval = pairing && time >= pairingTimes.approval;
    const recording = time >= (field ? 3000 : pairingTimes.record);
    const phase = pairing ? (approval ? 'approval' : 'scan') : recording ? 'recording' : 'ready';
    prepare.classList.toggle('active', !recording);
    live.classList.toggle('active', recording);
    shell.classList.toggle('is-live-meeting', recording);
    overlay.hidden = !pairing;
    get('#mobile-approval').hidden = !approval;
    get('#mobile-pair-waiting').hidden = approval;
    get('#mobile-pairing').hidden = approval;
    get('#mobile-pair-description').hidden = approval;
    get('.mobile-pair-network').hidden = approval;
    get('.mobile-pair-actions').hidden = approval;
    if (previousPhase !== phase) {
      if (
        previousPhase !== undefined &&
        stage.dataset.running === 'true' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        const target = pairing ? modal : recording ? live : prepare;
        target.animate(
          [
            { opacity: 0.35, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 360, easing: 'cubic-bezier(.16,1,.3,1)' },
        );
      }
      previousPhase = phase;
    }
    if (recording) {
      renderLive(Math.max(0, time - (field ? 6000 : pairingTimes.captions)));
      const seconds = Math.floor((time - (field ? 3000 : pairingTimes.record)) / 1000);
      get('#timer').textContent = `00:00:${String(seconds).padStart(2, '0')}`;
    }
    const phoneSource = field || time >= pairingTimes.source;
    get('#phone-device-setting').hidden = !phoneSource;
    get('#mic-device-setting').hidden = phoneSource;
    stage
      .querySelectorAll('.capture-source-list [role="radio"]')
      .forEach((option) =>
        option.setAttribute(
          'aria-checked',
          String(option.dataset.value === (phoneSource ? 'phone' : 'both')),
        ),
      );
    const dropdown = get('#phone-device-mount .flow-select');
    const expanded = !field && time >= pairingTimes.dropdown && time < pairingTimes.selected;
    dropdown.querySelector('.flow-select-options').hidden = !expanded;
    dropdown.querySelector('.flow-select-toggle').setAttribute('aria-expanded', String(expanded));
    const target = approval
      ? '.collab-allow'
      : time < pairingTimes.source
        ? '.capture-source-list [data-value="phone"]'
        : time < pairingTimes.dropdown
          ? '#phone-device-mount .flow-select-toggle'
          : time < pairingTimes.selected
            ? '#phone-device-mount [data-flow-select-choice]'
            : '.primary-action';
    const start = approval
      ? 4700
      : time < pairingTimes.source
        ? 6500
        : time < pairingTimes.dropdown
          ? 7700
          : time < pairingTimes.selected
            ? 9200
            : 11000;
    const cursor = get('.motion-cursor');
    // 录音开始后由实时笔记演示接管指针。
    if (!recording) {
      cursor.hidden = field || time < start || (pairing && !approval);
      stage
        .querySelectorAll(
          '.capture-source-list button,.flow-select-toggle,[data-flow-select-choice],.primary-action,.collab-allow',
        )
        .forEach((button) => button.classList.remove('motion-pressed'));
      if (!cursor.hidden) {
        const button = get(target);
        const box = button.getBoundingClientRect();
        const progress = Math.min(1, (time - start) / 650);
        const ease = (1 - progress) ** 4;
        cursor.style.transform = `translate(${box.left + box.width * 0.7 + ease * 50}px,${box.top + box.height * 0.65 - ease * 35}px)`;
        cursor.dataset.clicking = String(progress > 0.85);
        cursor.style.setProperty('--click-progress', Math.max(0, (progress - 0.85) / 0.15));
        button.classList.toggle('motion-pressed', progress > 0.9);
      }
    }
    get('#live-input-label').textContent = pick('手机麦克风', 'Phone microphone');
  };
};

window.createCollaborationScene = async (stage, scene, locale) => {
  const field = scene === 'pair-field';
  const pick = (zh, en) => (locale === 'en' ? en : zh);
  const icon = interfaceIcon;
  const meeting = pick('产品周会', 'Product sync');
  const sentences = [
    pick('设计稿已经完成。', 'The design is ready.'),
    pick('周四交付测试版本。', 'Deliver the test build on Thursday.'),
    pick('下周一开始小范围发布。', 'Begin a limited rollout next Monday.'),
  ];
  const reveal = (text, progress) =>
    [...text].slice(0, Math.ceil([...text].length * Math.max(0, Math.min(1, progress)))).join('');
  stage.innerHTML = `<div class="collab-scene ${field ? 'collab-field' : 'collab-microphone'}">
    <div class="collab-phone"><div class="collab-phone-viewport"><section class="motion-phone">
      <div class="collab-connect collab-screen"><header>${icon('back')}<strong>${pick('连接电脑', 'Connect computer')}</strong></header><h2>${pick('连接你的电脑', 'Connect your computer')}</h2><p>${pick('打开电脑 Brevia 的「设备连接」', 'Open Device connection in Brevia on your computer')}</p><button class="collab-scan-start"><svg class="interface-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><use href="./icons.svg#scan"/></svg>${pick('扫描二维码', 'Scan QR code')}</button></div>
      <div class="collab-camera collab-screen"><header>${icon('back')}<strong>${pick('扫描二维码', 'Scan QR code')}</strong></header><p>${pick('在电脑 Brevia 中打开「设备连接」', 'Open Device connection in Brevia on your computer')}</p><div class="collab-scan-frame"><img src="./assets/collaboration/pairing-preview.svg" width="240" height="240" alt=""><i class="collab-scan-line"></i></div></div>
      <div class="collab-approval collab-screen"><header>${icon('back')}<strong>${pick('连接电脑', 'Connect computer')}</strong></header><h2>${pick('等待电脑确认', 'Waiting for computer approval')}</h2><p>${pick('校验词', 'Verification words')}</p><strong class="collab-verification">8F2A7C91</strong><p>MacBook Pro</p></div>
      <div class="collab-phone-prepare collab-screen"><header>${icon('back')}<strong>${field ? pick('新建录音', 'New recording') : pick('连接电脑', 'Connect computer')}</strong></header>${field ? `<label>${pick('会议标题', 'Meeting title')}<span>${meeting}</span></label><label>${pick('会议语言', 'Meeting language')}<span>${pick('中文', 'English')}${icon('chevron-down')}</span></label><label>${pick('工作区', 'Workspace')}<span>${pick('产品', 'Product')}${icon('chevron-down')}</span></label><label>${pick('识别模型', 'Recognition model')}<span>SenseVoice Small${icon('chevron-down')}</span></label>` : `<h2>${pick('连接与设备', 'Connection & devices')}</h2><p>${pick('手机负责录音，电脑负责转写', 'Phone records, computer transcribes')}</p>`}<div class="collab-computer-card">${icon('laptop')}<div><strong>MacBook Pro</strong><p>${field ? pick('手机采集音频，电脑完成转写', 'Phone captures audio, computer transcribes') : pick('已连接', 'Connected')}</p></div>${icon('check')}</div>${field ? `<button class="collab-phone-start">${pick('开始录音', 'Start recording')}</button>` : `<p class="collab-ready-copy">${pick('手机麦克风已就绪', 'Phone microphone ready')}</p>`}</div>
      <header class="motion-phone-header"><strong>${meeting}</strong><span class="motion-phone-meta"></span><i>${icon('more')}</i></header>
      <div class="motion-phone-tabs"></div><div class="motion-phone-content"><div class="collab-phone-wave"><span class="phone-record-dot"></span><strong>${pick('录音中', 'Recording')}</strong><time class="collab-phone-timer">00:00</time><div class="phone-local-note">${icon('phone')}<div><strong>${pick('电脑会议的手机录音', 'Phone audio for a computer meeting')}</strong><p>${pick('这场会议由电脑发起，逐字稿和笔记保存在电脑。录音保留在手机，断线后可补传。', 'This meeting was started on your computer. Transcripts and notes stay there. Audio is kept on your phone and can be uploaded after reconnecting.')}</p></div></div></div><div class="collab-phone-result"></div></div>
      <div class="motion-phone-sync"></div><footer class="motion-phone-controls"><button>${icon('pause')}</button><button>${icon('bookmark')}</button><button class="phone-stop">${icon('stop')}</button></footer>
    </section></div><div class="collab-phone-island"></div><div class="collab-phone-home"></div></div>
    <div class="collab-transfer" aria-hidden="true"><span class="collab-link-status"></span><div class="collab-link-line"><i class="collab-audio-packet"></i></div><span class="collab-audio-label">${pick('音频', 'Audio')}</span>${field ? `<div class="collab-link-line collab-return-line"><i class="collab-text-packet"></i></div><span class="collab-return-label">${pick('文字与笔记', 'Text & notes')}</span>` : ''}</div>
    <div class="collab-desktop"><iframe title="${pick('Brevia 桌面应用', 'Brevia desktop app')}" tabindex="-1" aria-hidden="true"></iframe></div>
    <div class="collab-pointer motion-cursor" hidden></div>
  </div>`;
  const root = stage.firstElementChild;
  const get = (selector) => root.querySelector(selector);
  const show = (selector, visible) => (get(selector).hidden = !visible);
  const write = (selector, value) => {
    const el = get(selector);
    if (el.innerHTML !== value) el.innerHTML = value;
  };
  const frame = get('iframe');
  const childReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      removeEventListener('message', ready);
      reject(Error('Desktop demo did not initialize'));
    }, 15000);
    function ready(event) {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== location.origin ||
        event.data?.type !== 'brevia-motion-ready'
      )
        return;
      clearTimeout(timeout);
      removeEventListener('message', ready);
      resolve();
    }
    addEventListener('message', ready);
  });
  const source = new URL('./product-motion.html', location.href);
  source.search = new URLSearchParams({
    v: '20261015-once',
    scene: 'live',
    capture: field ? 'field' : 'microphone',
    lang: locale,
    manual: '1',
    version: new URLSearchParams(location.search).get('version') || 'v1.4.0',
  });
  frame.src = source.href;
  const fit = () => {
    const desktop = get('.collab-desktop');
    frame.style.transform = `scale(${desktop.clientWidth / 1040})`;
    desktop.style.height = `${(desktop.clientWidth * 720) / 1040}px`;
    const phone = get('.collab-phone');
    get('.collab-phone-viewport').style.transform = `scale(${(phone.clientWidth - 8) / 390})`;
  };
  new ResizeObserver(fit).observe(root);
  fit();
  await childReady;
  let lastContent = -Infinity;
  let lastTime = -Infinity;
  let previousScreen;
  let previousNote = false;
  return (time) => {
    const seconds = time / 1000;
    const pairing = !field && time < pairingTimes.connected;
    const approval = pairing && time >= pairingTimes.approval;
    const recording = time >= (field ? 3000 : pairingTimes.record);
    const receiving = field && seconds >= 9;
    const note = field && seconds >= 18;
    root.dataset.phase = pairing
      ? approval
        ? 'approval'
        : 'scan'
      : recording
        ? receiving
          ? 'return'
          : 'recording'
        : 'ready';
    root.dataset.recording = String(recording);
    root.dataset.returning = String(receiving);
    const meter = frame.contentDocument.querySelector('[data-live-mic-level]');
    if (meter)
      meter.style.setProperty(
        '--level',
        recording ? 0.35 + 0.2 * Math.sin(seconds * 5) + 0.1 * Math.sin(seconds * 13) : 0,
      );
    get('.collab-scan-line').style.transform =
      `translateY(${Math.max(0, Math.min(1, (time - 2100) / 1200)) * 240}px)`;
    const camera = pairing && time >= pairingTimes.camera && !approval;
    const alignment = Math.max(0, Math.min(1, (time - pairingTimes.camera) / 1300));
    const remaining = (1 - alignment) ** 3;
    get('.collab-scan-frame img').style.transform =
      `translate(${remaining * 90}px,${remaining * 65}px) scale(${1 + remaining * 0.35})`;
    get('.collab-scan-frame').classList.toggle('is-locked', camera && time > 3300);
    root.dataset.scanAction =
      !field && time < pairingTimes.camera
        ? 'open-camera'
        : camera
          ? time > 3300
            ? 'locked'
            : 'align'
          : 'complete';
    const screen = pairing
      ? approval
        ? '.collab-approval'
        : camera
          ? '.collab-camera'
          : '.collab-connect'
      : recording
        ? '.motion-phone-header'
        : '.collab-phone-prepare';
    if (screen !== previousScreen) {
      if (
        previousScreen &&
        stage.dataset.running === 'true' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        get('.motion-phone').animate(
          [
            { opacity: 0.4, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 400, easing: 'cubic-bezier(.16,1,.3,1)' },
        );
      previousScreen = screen;
    }
    if (Math.abs(time - lastContent) >= 16 || time < lastTime) {
      frame.contentWindow.productMotion.seek(time);
      frame.contentDocument.querySelector('#motion-stage').dataset.running = stage.dataset.running;
      show('.collab-connect', pairing && !camera && !approval);
      show('.collab-camera', camera);
      show('.collab-approval', approval);
      show('.collab-phone-prepare', !pairing && !recording);
      show('.motion-phone-header', recording);
      show('.motion-phone-tabs', recording && field);
      show('.motion-phone-content', recording);
      show('.collab-phone-wave', recording && !field);
      show('.collab-phone-result', receiving);
      show('.motion-phone-sync', recording);
      show('.motion-phone-controls', recording);
      const timer = `00:${String(Math.floor(Math.max(0, seconds - (field ? 3 : pairingTimes.record / 1000)))).padStart(2, '0')}`;
      write(
        '.motion-phone-meta',
        `<span class="phone-record-dot"></span>${pick('录音中', 'Recording')} · ${timer}`,
      );
      write('.collab-phone-timer', timer);
      write(
        '.motion-phone-tabs',
        [pick('转写', 'Transcript'), pick('笔记', 'Notes'), pick('重点', 'Highlights')]
          .map(
            (label, i) => `<span class="${i === (note ? 1 : 0) ? 'active' : ''}">${label}</span>`,
          )
          .join(''),
      );
      if (receiving)
        write(
          '.collab-phone-result',
          note
            ? `<div class="phone-notes markdown-content">${frame.contentDocument.querySelector('.notes-editor').innerHTML}</div>`
            : sentences
                .slice(0, Math.min(3, Math.floor((seconds - 9) / 3) + 1))
                .map(
                  (line, i) =>
                    `<article class="phone-caption"><time>00:0${i * 3}</time><p>${escapeHtml(reveal(line, (seconds - 9 - i * 3) / 1.5))}</p></article>`,
                )
                .join(''),
        );
      write(
        '.motion-phone-sync',
        `<span>${icon('phone')}<b>${pick('录音保存在本机', 'Audio saved locally')}</b><small>${timer}</small></span><span>${icon('laptop')}<b>${pick('已传到电脑', 'Sent to computer')}</b><small>${timer}</small></span>`,
      );
      write(
        '.collab-link-status',
        pairing ? pick('扫码配对', 'Scan to pair') : pick('已连接', 'Connected'),
      );
      lastContent = time;
    }
    if (
      note !== previousNote &&
      stage.dataset.running === 'true' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      get('.collab-phone-result').animate(
        [
          { opacity: 0.3, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
    previousNote = note;
    lastTime = time;
    const scanningTap = !field && time >= 400 && time < pairingTimes.camera;
    const pointing = scanningTap || (field && seconds >= 1.5 && seconds < 3);
    show('.collab-pointer', pointing);
    if (pointing) {
      const button = get(scanningTap ? '.collab-scan-start' : '.collab-phone-start');
      const box = button.getBoundingClientRect();
      const approach =
        (1 - Math.min(1, (seconds - (scanningTap ? 0.4 : 1.5)) / (scanningTap ? 0.6 : 1.2))) ** 4;
      get('.collab-pointer').style.transform =
        `translate(${box.left + box.width * 0.75 + approach * 30}px,${box.top + box.height * 0.65 - approach * 40}px)`;
      const click = (seconds - (scanningTap ? 1 : 2.7)) / 0.45;
      get('.collab-pointer').dataset.clicking = String(click >= 0 && click <= 1);
      get('.collab-pointer').style.setProperty('--click-progress', Math.max(0, Math.min(1, click)));
      button.classList.toggle('motion-pressed', scanningTap ? time >= 1000 : seconds >= 2.7);
    }
  };
};
