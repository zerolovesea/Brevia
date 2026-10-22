// 仅提供演示数据与时钟；胶囊的 DOM、样式和状态渲染均来自正式应用。
async function createCapsuleScene(stage, locale) {
  const pick = (zh, en) => (locale === 'en' ? en : zh);
  const app = document.createElement('iframe');
  app.title = pick('实时会议', 'Live meeting');
  app.src = `./product-motion.html?scene=live&lang=${locale}&manual=1&version=${encodeURIComponent(motionParams.get('version') || '')}`;
  const capsule = document.createElement('iframe');
  capsule.title = pick('录音胶囊', 'Recording capsule');
  stage.innerHTML = `<style>
    #motion-stage{background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
    .capsule-demo-heading{position:absolute;left:48px;top:54px;right:48px}
    .capsule-demo-heading h1{font-size:32px;letter-spacing:-1px;margin:0 0 14px}
    .capsule-demo-heading p{font-size:18px;color:#686868;margin:0}
    .capsule-demo-app{position:absolute;left:0;top:0;width:1280px;height:800px;border:0;transform-origin:top left;background:white}
    .capsule-demo-window{position:absolute;left:808px;top:210px;width:464px;height:470px;border:0}
  </style><header class="capsule-demo-heading"><h1></h1><p></p></header>`;
  app.className = 'capsule-demo-app';
  capsule.className = 'capsule-demo-window';
  const loaded = (frame) =>
    new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  const appLoaded = loaded(app);
  stage.append(app);
  await appLoaded;
  // 子页面在字体就绪后才公布逐帧接口。
  while (!app.contentWindow.productMotion) await new Promise((resolve) => setTimeout(resolve, 20));
  const templateURL = new URL('../frontend/recording-capsule.html', location.href);
  const response = await fetch(templateURL);
  if (!response.ok) throw Error(`Capsule template: ${response.status}`);
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  template.querySelector('meta[http-equiv="Content-Security-Policy"]').remove();
  const base = template.createElement('base');
  base.href = templateURL.href;
  template.head.prepend(base);
  const bridge = template.createElement('script');
  bridge.textContent = `window.demoListeners={};window.brevia={
    on:(name,callback)=>window.demoListeners[name]=callback,
    desktop:{state:async()=>null,expand:async()=>{},action:async()=>{},move:async()=>{}}
  };`;
  template.head.append(bridge);
  const capsuleLoaded = loaded(capsule);
  capsule.srcdoc = '<!doctype html>' + template.documentElement.outerHTML;
  stage.append(capsule);
  await capsuleLoaded;
  await capsule.contentDocument.fonts.ready;
  const doc = capsule.contentDocument;
  const lines = [
    [
      pick(
        '周四交付测试版本，周五完成内部验收。',
        'Deliver the test build Thursday; complete acceptance Friday.',
      ),
      pick('Test build Thursday; acceptance Friday.', '周四交付测试版本，周五完成验收。'),
    ],
    [
      pick('下周一开始小范围发布。', 'Begin the limited rollout next Monday.'),
      pick('Begin the limited rollout next Monday.', '下周一开始小范围发布。'),
    ],
  ];
  const notes = pick(
    '## 本次决定\n- 下周一小范围发布\n## 行动项\n- 周四交付测试版本',
    '## Decisions\n- Limited rollout next Monday\n## Action items\n- Deliver the test build Thursday',
  );
  return (time) => {
    const seconds = time / 1000;
    const full = seconds < 2 || seconds >= 24;
    const progress = Math.min(1, Math.max(0, (seconds - 2) / 0.6));
    app.style.transform = full
      ? 'none'
      : `translate(${40 * progress}px,${250 * progress}px) scale(${1 - 0.41 * progress})`;
    app.style.borderRadius = full ? '0' : '10px';
    app.style.boxShadow = full ? 'none' : '0 12px 36px #00000012';
    app.contentWindow.productMotion.seek(Math.min(11900, seconds * 500));
    capsule.hidden = full;
    const phase =
      seconds >= 22
        ? 'saved'
        : seconds >= 21
          ? 'saving'
          : seconds >= 19
            ? 'failed'
            : seconds >= 18
              ? 'saving'
              : seconds >= 15 && seconds < 17
                ? 'paused'
                : 'recording';
    const elapsed =
      72 + Math.floor(seconds < 15 ? seconds : seconds < 17 ? 15 : Math.min(seconds - 2, 16));
    const appDoc = app.contentDocument;
    appDoc.querySelector('#timer').textContent = `00:01:${String(elapsed - 60).padStart(2, '0')}`;
    const status = pick(
      {
        recording: '正在录制',
        paused: '已暂停',
        saving: '正在保存录音',
        failed: '保存失败',
        saved: '已保存',
      }[phase],
      {
        recording: 'Recording',
        paused: 'Paused',
        saving: 'Saving recording',
        failed: 'Save failed',
        saved: 'Saved',
      }[phase],
    );
    appDoc.querySelector('#live-recording-state').lastChild.textContent = ' ' + status;
    appDoc.querySelector('#live-recording-state i').style.background =
      phase === 'recording' ? '' : '#999';
    const pause = appDoc.querySelector('#pause');
    pause.innerHTML =
      interfaceIcon(phase === 'paused' ? 'play' : 'pause') +
      `<span>${pick(phase === 'paused' ? '继续' : '暂停', phase === 'paused' ? 'Resume' : 'Pause')}</span>`;
    pause.disabled = !['recording', 'paused'].includes(phase);
    appDoc.querySelector('#end-meeting').disabled = pause.disabled;
    const expanded = seconds >= 5 && seconds < 18;
    const noteTab = seconds >= 9 && seconds < 15;
    stage.dataset.capsulePhase = phase;
    const heading =
      seconds < 5
        ? [
            pick('会议继续，窗口可以收起', 'Keep recording. Free your workspace.'),
            pick(
              '悬浮胶囊：录音状态、时长与控制始终在手边',
              'Recording status, elapsed time and controls stay within reach',
            ),
          ]
        : seconds < 9
          ? [
              pick('展开即看字幕与翻译', 'Open captions and translation'),
              pick(
                '实时跟随对话，不必切回主窗口',
                'Follow the conversation without returning to the main window',
              ),
            ]
          : seconds < 15
            ? [
                pick('重点，随手留下', 'Keep the important moments'),
                pick(
                  '查看本场笔记，采纳 AI 建议；面板也可固定展开',
                  'Read meeting notes, accept AI suggestions and pin the panel',
                ),
              ]
            : seconds < 18
              ? [
                  pick('暂停一下，随时继续', 'Pause. Resume when ready.'),
                  pick(
                    '胶囊与主窗口共用同一场录音',
                    'The capsule and main window control the same recording',
                  ),
                ]
              : [
                  pick('结束录音，安心保存', 'Finish recording and save'),
                  pick(
                    '保存中、失败重试、已保存：每一步都有明确反馈',
                    'Clear feedback while saving, retrying and completing',
                  ),
                ];
    stage.querySelector('h1').textContent = heading[0];
    stage.querySelector('header p').textContent = heading[1];
    capsule.contentWindow.demoListeners['desktop.state']({
      meetingId: 'readme-demo',
      title: pick('产品周会', 'Product sync'),
      locale,
      theme: 'light',
      phase,
      expanded,
      above: true,
      pillOffset: 0,
      canPause: true,
      elapsed,
      level: 0.4 + 0.3 * Math.sin(time / 180),
      captions: lines.map(([text, translation], i) => ({
        id: String(i),
        time: `01:${i ? '18' : '12'}`,
        text,
        translation,
        draft: false,
      })),
      notes:
        notes +
        (seconds >= 12.5
          ? pick('\n- 周五前完成内部验收', '\n- Complete internal acceptance by Friday')
          : ''),
      aiEnabled: true,
      aiBusy: noteTab && seconds < 10,
      suggestion:
        seconds >= 10 && seconds < 12.5
          ? { text: pick('周五前完成内部验收。', 'Complete internal acceptance by Friday.') }
          : null,
      error: phase === 'failed' ? pick('保存失败，请重试。', 'Save failed. Please retry.') : '',
    });
    doc.querySelector(noteTab ? '#notes-tab' : '#captions-tab').click();
    const pin = doc.querySelector('#capsule-pin');
    const pinned = noteTab && seconds >= 13;
    if ((pin.getAttribute('aria-pressed') === 'true') !== pinned) pin.click();
    for (const animation of doc.getAnimations()) {
      const duration = animation.effect.getComputedTiming().duration;
      animation.pause();
      animation.currentTime = Number.isFinite(animation.effect.getComputedTiming().endTime)
        ? animation.effect.getComputedTiming().endTime
        : time % (Number(duration) || 1000);
    }
    doc.querySelectorAll('#capsule-meter i').forEach((bar) => {
      bar.style.transition = 'none';
    });
  };
}
