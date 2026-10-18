(() => {
  const api = window.brevia?.mobile;
  if (!api) return;
  const dialog = document.getElementById('mobile-dialog');
  const pairDialog = document.getElementById('mobile-pair-dialog');
  let pairingBusy = false;
  let pairClosing = null;
  const pairing = document.getElementById('mobile-pairing');
  let expires = 0,
    approvalId = null,
    deviceList = null,
    polling = false,
    lastStatus = null,
    renderedLocale = null,
    messageKey = '';
  const staticCopy = [];
  for (const root of [dialog, pairDialog]) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        key = node.textContent.trim();
      if (/[\u3400-\u9fff]/.test(key)) staticCopy.push({ node, key });
    }
  }
  const attributeCopy = [dialog, pairDialog]
    .flatMap((root) => [...root.querySelectorAll('[aria-label]')])
    .map((node) => ({
      node,
      key: node.getAttribute('aria-label'),
    }));
  const imageCopy = [
    ...dialog.querySelectorAll('img[alt]'),
    ...pairDialog.querySelectorAll('img[alt]'),
  ].map((node) => ({
    node,
    key: node.alt,
  }));
  function localize() {
    staticCopy.forEach(({ node, key }) => {
      node.textContent = t(key);
    });
    attributeCopy.forEach(({ node, key }) => node.setAttribute('aria-label', t(key)));
    imageCopy.forEach(({ node, key }) => {
      node.alt = t(key);
    });
    document.querySelector('#mobile-nav strong').textContent = t('设备连接');
    if (
      breviaClient?.state.meeting?.tags?.includes('手机录音') &&
      !breviaClient.state.meeting.tags.includes('手机麦克风')
    )
      document.querySelector('#pause').textContent = t('在手机控制录音');
    if (currentMeetingDetail?.tags?.includes('手机录音'))
      document.querySelector('#detail-view .detail-title .eyebrow').textContent = t(
        currentMeetingDetail.tags.includes('手机麦克风') ? '手机麦克风' : '手机录音',
      );
    document.querySelector('#mobile-manage').setAttribute('aria-label', t('查看与管理'));
    dialog.querySelector('#mobile-dialog-status').textContent = messageKey ? t(messageKey) : '';
  }
  function message(key) {
    messageKey = key;
    dialog.querySelector('#mobile-dialog-status').textContent = t(key);
  }
  async function open() {
    if (
      activeModal !== 'device-connection' ||
      settingsModal.hidden ||
      settingsModal.classList.contains('modal-leave')
    ) {
      if (activeView === 'live' && meetingActive) minimizeMeeting();
      await showView('settings');
      await openModal('device-connection');
    }
  }
  async function run(action) {
    try {
      await action();
    } catch (error) {
      const detail = t(error.detail || error.message || '连接失败，请重试');
      dialog.querySelector('#mobile-dialog-status').textContent = detail;
      pairDialog.querySelector('#mobile-pair-error').textContent = detail;
    }
  }
  function showPairDialog() {
    if (pairDialog.open) return;
    pairDialog.classList.remove('modal-leave');
    pairDialog.classList.add('modal-enter');
    pairDialog.showModal();
  }
  function closePairDialog() {
    if (pairClosing) return pairClosing;
    if (!pairDialog.open) {
      expires = 0;
      pairing.hidden = true;
      dialog.querySelector('.mobile-pair-preview').hidden = true;
      return Promise.resolve();
    }
    expires = 0;
    dialog.querySelector('.mobile-pair-preview').hidden = true;
    pairDialog.classList.remove('modal-enter');
    pairDialog.classList.add('modal-leave');
    pairClosing = new Promise((resolve) => {
      setTimeout(() => {
        pairDialog.close();
        pairDialog.classList.remove('modal-leave');
        pairing.hidden = true;
        pairDialog.querySelector('#mobile-approval').replaceChildren();
        pairClosing = null;
        resolve();
      }, BreviaMotion.duration('exit'));
    });
    return pairClosing;
  }
  async function pair(refresh = false) {
    if (pairingBusy || pairClosing || (pairDialog.open && !refresh)) return;
    if (refresh && !pairDialog.open) return;
    pairingBusy = true;
    pairDialog.querySelector('#mobile-pair-error').textContent = '';
    try {
      const value = await api.pair();
      if (refresh && (!pairDialog.open || pairClosing)) return;
      await render(value);
      expires = value.expires;
      document.getElementById('mobile-retry-pairing').hidden = true;
      document.getElementById('mobile-copy-pin').disabled = false;
      renderCountdown();
      pairDialog.querySelector('#mobile-pair-waiting').hidden = false;
      pairing.hidden = false;
      pairDialog.querySelector('#mobile-qr').src = value.qr;
      pairDialog.querySelector('#mobile-pin').textContent = value.pin;
      const preview = dialog.querySelector('.mobile-pair-preview');
      preview.querySelector('[data-mobile-pair-qr]').src = value.qr;
      preview.querySelector('[data-mobile-pair-pin]').textContent = value.pin;
      preview.hidden = true;
      localize();
      showPairDialog();
    } catch (error) {
      if (refresh && (!pairDialog.open || pairClosing)) return;
      expires = 0;
      pairing.hidden = true;
      dialog.querySelector('.mobile-pair-preview').hidden = true;
      document.getElementById('mobile-retry-pairing').hidden = false;
      showPairDialog();
      throw error;
    } finally {
      pairingBusy = false;
    }
  }
  async function render(value) {
    lastStatus = value;
    updateCapturePhones(value.devices || []);
    const localeChanged = renderedLocale !== locale;
    renderedLocale = locale;
    localize();
    const pending = value.sessions?.find((s) => !s.finished);
    const connected = (value.devices || []).filter((d) => d.connected);
    const connectionStatus = connected.length
      ? '已连接'
      : value.enabled
        ? '等待设备连接'
        : '服务已关闭';
    const switcher = dialog.querySelector('#mobile-service-toggle');
    switcher.checked = Boolean(value.enabled);
    dialog.querySelector('#mobile-service-enabled').textContent = t(
      value.enabled ? '已开启' : '服务已关闭',
    );
    dialog.querySelector('#mobile-connected-heading').textContent = connected.length
      ? connected.map((device) => device.name).join('、')
      : t('尚未连接设备');
    dialog.querySelector('#mobile-connected-description').textContent = t(
      connected.length
        ? '已连接 · 信任设备'
        : value.enabled
          ? '在手机端搜索电脑，桌面将自动显示配对窗口。'
          : '服务已关闭',
    );
    pairDialog.querySelector('#mobile-pair-waiting').hidden = Boolean(value.approval) || !expires;
    pairDialog.querySelector('.mobile-pair-network').hidden = Boolean(value.approval);
    pairDialog.classList.toggle('has-approval', Boolean(value.approval));
    const service = dialog.querySelector('#mobile-service-state');
    service.textContent = t(connectionStatus);
    service.dataset.connected = String(connected.length > 0);
    document.getElementById('mobile-nav').classList.toggle('is-connected', connected.length > 0);
    document.getElementById('mobile-nav').title = `${t('设备连接')} · ${t(connectionStatus)}`;
    document.getElementById('mobile-sidebar-status').textContent = connected.length
      ? `${connected[0].name} · ${t('已连接')}`
      : t(connectionStatus);
    const approval = pairDialog.querySelector('#mobile-approval');
    if (!pairClosing && ((value.approval?.id || null) !== approvalId || localeChanged)) {
      const newRequest = (value.approval?.id || null) !== approvalId;
      approvalId = value.approval?.id || null;
      approval.replaceChildren();
      if (value.approval) {
        showPairDialog();
        const request = value.approval;
        const copy = document.createElement('p');
        copy.className = 'mobile-request-copy';
        const deviceName = document.createElement('b');
        deviceName.textContent = request.name;
        const requestLabel = document.createElement('span');
        requestLabel.textContent = t('请求与 Brevia 建立连接。');
        const hint = document.createElement('span');
        hint.textContent = t('校验词');
        const verification = document.createElement('strong');
        verification.className = 'mobile-verification';
        verification.textContent = request.verification;
        copy.append(deviceName, requestLabel, hint, verification);
        const requestInfo = document.createElement('div');
        requestInfo.className = 'mobile-request-info';
        requestInfo.insertAdjacentHTML('afterbegin', interfaceIcon('phone'));
        requestInfo.append(copy);
        const deny = document.createElement('button');
        deny.className = 'secondary';
        deny.textContent = t('拒绝');
        const allow = document.createElement('button');
        allow.className = 'modal-action';
        allow.textContent = t('允许连接');
        const respond = (allowed) => {
          if (allow.disabled) return;
          deny.disabled = allow.disabled = true;
          return run(async () => {
            await api.approve({ id: request.id, allowed });
            await closePairDialog();
            message(allowed ? '已允许连接，可以在手机开始会议。' : '已拒绝本次连接。');
            await render(await api.status());
          }).finally(() => {
            deny.disabled = allow.disabled = false;
          });
        };
        deny.onclick = () => respond(false);
        allow.onclick = () => respond(true);
        const actions = document.createElement('div');
        actions.className = 'mobile-request-actions';
        const verificationHint = document.createElement('small');
        verificationHint.textContent = t('请核对手机与电脑上的校验词。');
        copy.append(verificationHint);
        const confirmation = document.createElement('small');
        confirmation.textContent = t('电脑确认后才建立信任。');
        actions.append(deny, allow, confirmation);
        approval.append(requestInfo, actions);
        if (newRequest) deny.focus({ preventScroll: true });
      }
    }
    const nextDevices = JSON.stringify(value.devices || []);
    if (deviceList !== nextDevices || localeChanged) {
      const body = dialog.closest('.modal-body');
      const scrollTop = body?.scrollTop || 0;
      deviceList = nextDevices;
      const devices = dialog.querySelector('#mobile-devices');
      devices.replaceChildren();
      if (!value.devices?.length) {
        const empty = document.createElement('p');
        empty.className = 'mobile-device-empty';
        empty.textContent = t('暂无已信任设备');
        empty.insertAdjacentHTML('afterbegin', interfaceIcon('device-phone'));
        devices.append(empty);
      }
      for (const device of value.devices || []) {
        const row = document.createElement('div');
        row.className = 'mobile-device';
        const name = document.createElement('div');
        name.textContent = device.name;
        const state = document.createElement('small');
        state.textContent = device.connected ? t('已连接 · 信任设备') : t('离线 · 保留信任');
        name.append(state);
        const facts = document.createElement('dl');
        facts.className = 'mobile-device-facts';
        const first = new Date(device.firstConnectedAt);
        const date =
          device.firstConnectedAt && Number.isFinite(first.getTime())
            ? new Intl.DateTimeFormat(BreviaI18n.localeTag(locale), {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(first)
            : t('未记录（旧版设备）');
        for (const [label, value] of [
          ['首次连接', date],
          [
            '会议录音',
            new Intl.NumberFormat(BreviaI18n.localeTag(locale)).format(device.recordingCount || 0),
          ],
        ]) {
          const group = document.createElement('div');
          const term = document.createElement('dt');
          const detail = document.createElement('dd');
          term.textContent = t(label);
          detail.textContent = value;
          group.append(term, detail);
          facts.append(group);
        }
        const revoke = document.createElement('button');
        revoke.className = 'secondary';
        revoke.textContent = t('取消信任');
        revoke.onclick = () => run(async () => render(await api.revoke({ id: device.id })));
        row.insertAdjacentHTML('afterbegin', interfaceIcon('phone'));
        row.dataset.connected = String(device.connected);
        row.append(name, facts, revoke);
        devices.append(row);
      }
      if (body) body.scrollTop = scrollTop;
    }
    if (pending && breviaClient) {
      if (breviaClient.state.meeting?.id !== pending.id) {
        const meeting = await window.brevia.meeting.get({ meeting_id: pending.id });
        if (meeting?.status === 'recording') adoptMobileMeeting(meeting);
      }
      if (breviaClient.state.meeting?.id === pending.id) {
        if (pending.desktopCapture) {
          const paused = ['paused', 'interrupted'].includes(pending.state);
          const button = document.querySelector('#pause');
          button.dataset.paused = String(paused);
          button.disabled = !!(
            pending.ended ||
            pending.stopRequested ||
            pending.state === 'starting'
          );
          renderPauseButton();
        }
        document
          .querySelector('#transcript-scroll')
          .classList.toggle('is-finishing', !!(pending.ended || pending.stopRequested));
        clearInterval(timer);
        seconds = Math.floor((pending.samples || 0) / 16000);
        const time = new Date(seconds * 1000).toISOString().slice(11, 19);
        document.getElementById('timer').textContent = time;
        miniTimer.textContent = time;
        const label = pending.ended
          ? '电脑处理中'
          : !connected.some((device) => device.id === pending.owner)
            ? '连接中断 · 等待补传'
            : ['paused', 'interrupted'].includes(pending.state)
              ? '手机已暂停'
              : pending.state === 'starting'
                ? '等待手机开始录音'
                : '手机录音中';
        for (const el of document.querySelectorAll(
          '#live-recording-state, #mini-meeting .mini-recording',
        ))
          el.textContent = t(label);
        if (pending.error)
          document.getElementById('live-recording-state').textContent = t(pending.error);
      }
    }
  }
  dialog.querySelector('#mobile-pair').onclick = () => run(pair);
  dialog.querySelector('#mobile-service-toggle').onchange = (event) => {
    const switcher = event.target;
    switcher.disabled = true;
    void run(async () => {
      if (switcher.checked) await pair();
      else {
        await api.disable();
        await closePairDialog();
      }
      await render(await api.status());
    }).finally(() => {
      switcher.disabled = false;
      void poll();
    });
  };
  document.getElementById('mobile-manage').onclick = open;
  document.getElementById('mobile-nav').onclick = open;
  const stopPairing = () =>
    run(async () => {
      if (approvalId) await api.approve({ id: approvalId, allowed: false });
      const value = await api.closePairing();
      await closePairDialog();
      await render(value);
    });
  pairDialog.querySelector('#mobile-close-pairing').onclick = stopPairing;
  dialog.querySelector('[data-mobile-cancel-preview]').onclick = stopPairing;
  pairDialog.querySelector('#mobile-dismiss-pairing').onclick = stopPairing;
  pairDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    stopPairing();
  });
  // 上层配对窗口处理 Escape，避免同时关闭后面的设备列表。
  pairDialog.addEventListener('keydown', (event) => event.stopPropagation());
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      await render(await api.status());
    } catch {
      /* Startup/replay may not have created the worker meeting yet. */
    } finally {
      polling = false;
    }
  }
  window.brevia.on('mobile.discovered', () => {
    void run(pair);
  });
  function renderCountdown() {
    if (!expires) return;
    const remaining = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
    document.getElementById('mobile-address').textContent =
      `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    dialog.querySelector('[data-mobile-pair-time]').textContent =
      document.getElementById('mobile-address').textContent;
    if (!remaining && !pairingBusy && pairDialog.open && !pairClosing) {
      expires = 0;
      void run(async () => {
        // 超时审批已无法建立信任，先结束旧请求，再刷新二维码和配对码。
        if (approvalId) await api.approve({ id: approvalId, allowed: false });
        await pair(true);
      });
    }
  }
  document.getElementById('mobile-copy-pin').onclick = () =>
    run(async () => {
      await window.brevia.share.copyText({
        text: document.getElementById('mobile-pin').textContent,
      });
      showToast(t('已复制到剪贴板'), undefined, 'success');
    });
  dialog.querySelector('[data-mobile-copy-preview]').onclick = () =>
    document.getElementById('mobile-copy-pin').click();
  document.getElementById('mobile-retry-pairing').onclick = () =>
    run(async () => {
      await closePairDialog();
      await pair();
    });
  setInterval(renderCountdown, 1000);
  setInterval(() => void poll(), 2000);
  window.addEventListener('brevia:language-changed', () => {
    localize();
    if (lastStatus) void render(lastStatus);
    else void poll();
  });
  for (const mount of [
    ...dialog.querySelectorAll('[data-interface-icon]'),
    ...pairDialog.querySelectorAll('[data-interface-icon]'),
  ])
    mount.innerHTML = interfaceIcon(mount.dataset.interfaceIcon);
  localize();
  void poll();
})();
