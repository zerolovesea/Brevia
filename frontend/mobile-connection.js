(() => {
  const api = window.brevia?.mobile;
  if (!api) return;
  const output = document.getElementById('mobile-status');
  const dialog = document.getElementById('mobile-dialog');
  const pairing = document.getElementById('mobile-pairing');
  let expires = 0,
    approvalId = null,
    deviceList = null,
    polling = false,
    lastStatus = null,
    renderedLocale = null,
    pairValue = null,
    messageKey = '';
  const staticCopy = [];
  const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode,
      key = node.textContent.trim();
    if (/[\u3400-\u9fff]/.test(key)) staticCopy.push({ node, key });
  }
  const imageCopy = [...dialog.querySelectorAll('img[alt]')].map((node) => ({
    node,
    key: node.alt,
  }));
  function localize() {
    staticCopy.forEach(({ node, key }) => {
      node.textContent = t(key);
    });
    imageCopy.forEach(({ node, key }) => {
      node.alt = t(key);
    });
    document.querySelector('#mobile-nav strong').textContent = t('设备连接');
    if (breviaClient?.state.meeting?.tags?.includes('手机录音'))
      document.querySelector('#pause').textContent = t('在手机控制录音');
    if (currentMeetingDetail?.tags?.includes('手机录音'))
      document.querySelector('#detail-view .detail-title .eyebrow').textContent = t('手机录音');
    document.querySelector('#mobile-manage').textContent = t('查看与管理');
    dialog.querySelector('#mobile-dialog-status').textContent = messageKey ? t(messageKey) : '';
    if (pairValue)
      dialog.querySelector('#mobile-address').textContent =
        `${t('2 分钟内有效')} · ${pairValue.addresses.join(' / ') || t('未发现局域网，请连接 Wi-Fi')}`;
  }
  function message(key) {
    messageKey = key;
    dialog.querySelector('#mobile-dialog-status').textContent = t(key);
  }
  function open() {
    if (
      activeModal !== 'device-connection' ||
      settingsModal.hidden ||
      settingsModal.classList.contains('modal-leave')
    )
      void openModal('device-connection');
  }
  async function run(action) {
    try {
      await action();
    } catch (error) {
      output.textContent = t(error.detail || error.message || '连接失败，请重试');
      dialog.querySelector('#mobile-dialog-status').textContent = output.textContent;
    }
  }
  async function pair() {
    open();
    const value = await api.pair();
    await render(value);
    expires = value.expires;
    pairing.hidden = false;
    dialog.querySelector('#mobile-qr').src = value.qr;
    dialog.querySelector('#mobile-pin').textContent = value.pin;
    pairValue = value;
    localize();
  }
  async function render(value) {
    lastStatus = value;
    const localeChanged = renderedLocale !== locale;
    renderedLocale = locale;
    localize();
    const pending = value.sessions?.find((s) => !s.finished);
    dialog.querySelector('#mobile-finish-received').hidden = !pending || pending.ended;
    document.querySelectorAll('.mobile-source-tag').forEach((tag) => {
      tag.textContent = t('手机录音');
    });
    const connected = (value.devices || []).filter((d) => d.connected);
    const connectionStatus = connected.length
      ? '已连接'
      : value.enabled
        ? '等待设备连接'
        : '服务已关闭';
    document.getElementById('mobile-nav').classList.toggle('is-connected', connected.length > 0);
    document.getElementById('mobile-nav').title = `${t('设备连接')} · ${t(connectionStatus)}`;
    document.getElementById('mobile-sidebar-status').textContent = connected.length
      ? `${connected[0].name} · ${t('已连接')}`
      : t(connectionStatus);
    output.textContent = pending
      ? `${pending.title} · ${pending.ended ? t('电脑处理中') : t('来自手机的会议')}${pending.error ? ` · ${t(pending.error)}` : ''}`
      : connected.length
        ? `${connected.map((d) => d.name).join(', ')} · ${t('可以开始录音')}`
        : value.enabled
          ? ''
          : t('点击连接新设备，开启局域网连接。');
    const approval = dialog.querySelector('#mobile-approval');
    if ((value.approval?.id || null) !== approvalId || localeChanged) {
      const newRequest = (value.approval?.id || null) !== approvalId;
      approvalId = value.approval?.id || null;
      approval.replaceChildren();
      if (value.approval) {
        open();
        const request = value.approval;
        const copy = document.createElement('p');
        copy.textContent = `${request.name} ${t('请求连接。请核对手机上的校验码：')}${request.verification}`;
        const deny = document.createElement('button');
        deny.className = 'secondary';
        deny.textContent = t('拒绝');
        const allow = document.createElement('button');
        allow.className = 'modal-action';
        allow.textContent = t('允许连接');
        const respond = (allowed) =>
          run(async () => {
            await api.approve({ id: request.id, allowed });
            approval.replaceChildren();
            pairing.hidden = true;
            message(allowed ? '已允许连接，可以在手机开始会议。' : '已拒绝本次连接。');
          });
        deny.onclick = () => respond(false);
        allow.onclick = () => respond(true);
        approval.append(copy, deny, allow);
        if (newRequest) deny.focus({ preventScroll: true });
      }
    }
    const nextDevices = JSON.stringify(value.devices || []);
    if (deviceList !== nextDevices || localeChanged) {
      deviceList = nextDevices;
      const devices = dialog.querySelector('#mobile-devices');
      devices.replaceChildren();
      if (!value.devices?.length) {
        const empty = document.createElement('p');
        empty.className = 'mobile-device-empty';
        empty.textContent = t('尚未连接设备');
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
        row.append(name, facts, revoke);
        devices.append(row);
      }
    }
    if (pending && breviaClient) {
      if (breviaClient.state.meeting?.id !== pending.id) {
        const meeting = await window.brevia.meeting.get({ meeting_id: pending.id });
        if (meeting?.status === 'recording') adoptMobileMeeting(meeting);
      }
      if (breviaClient.state.meeting?.id === pending.id) {
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
          : !connected.length
            ? '连接中断 · 等待补传'
            : ['paused', 'interrupted'].includes(pending.state)
              ? '手机已暂停'
              : '手机录音中';
        for (const el of document.querySelectorAll(
          '#live-recording-state, #mini-meeting .mini-recording',
        ))
          el.textContent = t(label);
      }
    }
  }
  dialog.querySelector('#mobile-finish-received').onclick = () => {
    const pending = lastStatus?.sessions?.find((s) => !s.finished);
    if (!pending) return;
    openConfirmation(
      t('结束电脑上的录音？'),
      t('电脑将保存已收到的音频并解除录音占用。手机上的未传音频不会被删除，重新连接后可继续补传。'),
      async () => {
        await api.finishReceived({ meeting_id: pending.id });
        await poll();
      },
    );
  };
  dialog.querySelector('#mobile-pair').onclick = () => run(pair);
  document.getElementById('mobile-manage').onclick = open;
  document.getElementById('mobile-nav').onclick = open;
  dialog.querySelector('#mobile-close-pairing').onclick = () =>
    run(async () => {
      await render(await api.closePairing());
      pairing.hidden = true;
    });
  dialog.querySelector('#mobile-disable').onclick = () =>
    run(async () => {
      await render(await api.disable());
      pairing.hidden = true;
      message('手机连接服务已关闭');
    });
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
    open();
    void poll();
  });
  setInterval(() => {
    if (expires && Date.now() > expires) {
      pairing.hidden = true;
      expires = 0;
      message('配对码已过期，请重新显示配对码。');
    }
    void poll();
  }, 2000);
  window.addEventListener('brevia:language-changed', () => {
    localize();
    if (lastStatus) void render(lastStatus);
    else void poll();
  });
  localize();
  void poll();
})();
