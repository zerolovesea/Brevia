/** 独立复拍标注反馈；隔离窗口、数据与静音音频，不代替全量 E2E。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = path.join(root, '.e2e-tmp', `feedback-${process.pid}`);
const defaultWindowScale = (2 / 3) * 1.15 * 1.1;
const output = path.resolve(
  process.env.BREVIA_FEEDBACK_CAPTURE_DIR ||
    'output/playwright/layout-style-comparison/captures/feedback',
);
mkdirSync(sandbox, { recursive: true });
mkdirSync(path.join(sandbox, 'data'), { recursive: true });
mkdirSync(path.join(sandbox, 'recordings'), { recursive: true });
mkdirSync(output, { recursive: true });
const port = await new Promise((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const audio = Buffer.alloc(44 + 40 * 16000 * 2);
audio.write('RIFF');
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24);
audio.writeUInt32LE(32000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(audio.length - 44, 40);
const audioPath = path.join(sandbox, 'silent.wav');
writeFileSync(audioPath, audio);
const child = spawn(
  createRequire(import.meta.url)('electron'),
  [
    '.',
    '--no-sandbox',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(sandbox, 'userdata')}`,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      BREVIA_DATA_DIR: path.join(sandbox, 'data'),
      BREVIA_MEETINGS_DIR: path.join(sandbox, 'recordings'),
      BREVIA_MOBILE_PORT: '0',
      BREVIA_PYTHON: process.env.BREVIA_PYTHON || path.join(root, '.venv/bin/python'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  },
);
let mainLog = '',
  socket,
  nextId = 0;
child.stderr.on('data', (data) => (mainLog += data));
const pending = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`CDP timeout: ${method}`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const results = [];
try {
  let target;
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (tab) => tab.type === 'page',
      );
    } catch {
      /* 启动期间调试端口尚未就绪。 */
    }
    if (target) break;
    await delay(100);
  }
  assert.ok(target, mainLog);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data),
      item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(Error(message.error.message));
    else item.resolve(message.result);
  });
  await send('Runtime.enable');
  await send('Page.enable');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`typeof initializationPromise !== 'undefined'`)) break;
    await delay(100);
  }
  await evaluate('initializationPromise');
  await evaluate(
    `(async()=>{const deadline=Date.now()+10000;while(document.querySelector('#startup-splash')){if(Date.now()>deadline)throw Error('启动遮罩未退出');await new Promise(r=>setTimeout(r,100));}})()`,
  );
  await evaluate(
    `(()=>{applyLanguage('zh');applyTheme('light');if(onboardingPage)dismissOnboardingPage();closeModal();})()`,
  );
  await delay(400);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 0,
    height: 0,
    deviceScaleFactor: 1 / defaultWindowScale,
    mobile: false,
  });
  await evaluate(
    `(async()=>{await showView('home');const base=uiData.meetings.at(-1)||{};workspaces=[{id:'feedback-overseas',name:'海外'},{id:'feedback-personal',name:'个人'},{id:'feedback-long',name:'用于检查长名称显示和滚动的工作区'}];activeWorkspaceId='feedback-overseas';uiData.meetings=['产品周会','客户访谈','项目复盘'].map((title,i)=>({...base,id:'feedback-'+i,title,isExample:false,workspaceId:activeWorkspaceId,createdAt:new Date(Date.now()-i*86400000).toISOString(),durationMs:1800000,speakerCount:2,hasSummary:true,tags:[],statusCode:'completed',status:{tone:'done',label:'已整理',detail:''}}));renderWorkspaceNav();renderMeetingList();updateHomeViewTitle();})()`,
  );
  // 真实指针和 Enter 按键验证反馈，不触发录制、删除或远程请求。
  await evaluate(
    `(()=>{const rack=document.createElement('div');rack.id='feedback-buttons';rack.style.cssText='position:fixed;left:400px;top:300px;z-index:1000;display:flex;gap:16px';rack.innerHTML='<button class="primary-action">下一步</button><button class="secondary">配置服务</button><button class="icon-button" style="transform:translateY(2px)" aria-label="关闭">'+interfaceIcon('close')+'</button><button class="secondary" disabled>下载中…</button>';document.body.append(rack);rack.querySelectorAll('button').forEach(button=>{button.dataset.clicks='0';button.onclick=()=>button.dataset.clicks=String(Number(button.dataset.clicks)+1);});})()`,
  );
  for (const theme of ['light', 'dark']) {
    await evaluate(`applyTheme('${theme}')`);
    for (let index = 0; index < 4; index++) {
      const point = await evaluate(
        `(()=>{const b=document.querySelectorAll('#feedback-buttons button')[${index}],r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:b.offsetWidth,height:b.offsetHeight,transform:getComputedStyle(b).transform};})()`,
      );
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await evaluate(
        `Promise.all([...document.querySelectorAll('#feedback-buttons button')[${index}].getAnimations()].map(animation=>animation.finished.catch(()=>{})))`,
      );
      const pressed = await evaluate(
        `(()=>{const b=document.querySelectorAll('#feedback-buttons button')[${index}],s=getComputedStyle(b);return {scale:s.scale,opacity:s.opacity,duration:s.transitionDuration,width:b.offsetWidth,height:b.offsetHeight,transform:s.transform,active:b.matches(':active'),hover:b.matches(':hover')};})()`,
      );
      if (index < 3) {
        assert.ok(
          Math.abs(Number(pressed.scale) - 0.98) < 0.001,
          `${theme} button press scale ${index} ${JSON.stringify(pressed)}`,
        );
        assert.ok(pressed.duration.includes('0.08s'), 'press duration');
      } else assert.ok(['none', '1'].includes(pressed.scale), 'disabled button stays still');
      assert.equal(pressed.width, point.width, 'press preserves layout width');
      assert.equal(pressed.height, point.height, 'press preserves layout height');
      assert.equal(pressed.transform, point.transform, 'press preserves positioned icons');
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await delay(200);
      assert.ok(
        await evaluate(
          `(()=>{const b=document.querySelectorAll('#feedback-buttons button')[${index}],s=getComputedStyle(b);return ['none','1'].includes(s.scale)&&s.transitionDuration.includes('0.18s');})()`,
        ),
        'release completes in 180ms',
      );
    }
  }
  await evaluate(`document.querySelector('#feedback-buttons .secondary').focus()`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13,
  });
  assert.ok(
    await evaluate(
      `document.activeElement.getAnimations().some(a=>a.effect.getTiming().duration===260)`,
    ),
    'Enter has press feedback ' +
      JSON.stringify(
        await evaluate(
          `({focused:document.activeElement.outerHTML,animations:document.activeElement.getAnimations().map(a=>a.effect.getTiming()),eligible:getComputedStyle(document.activeElement).getPropertyValue('--button-press-feedback')})`,
        ),
      ),
  );
  await delay(300);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    text: ' ',
    windowsVirtualKeyCode: 32,
  });
  await delay(100);
  assert.ok(
    await evaluate(`Math.abs(Number(getComputedStyle(document.activeElement).scale)-.98)<.001`),
    'Space holds the same press feedback',
  );
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
  });
  await delay(300);
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13,
  });
  assert.equal(
    await evaluate(`document.activeElement.getAnimations().length`),
    0,
    'reduced motion skips keyboard scale',
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 450, y: 320 });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 450,
    y: 320,
    button: 'left',
    clickCount: 1,
  });
  await delay(30);
  assert.ok(
    await evaluate(
      `(()=>{const s=getComputedStyle(document.querySelector('#feedback-buttons button'));return ['none','1'].includes(s.scale)&&Number(s.opacity)>.84&&Number(s.opacity)<.86;})()`,
    ),
    'reduced motion keeps tone feedback without scale ' +
      JSON.stringify(
        await evaluate(
          `(()=>{const b=document.querySelector('#feedback-buttons button'),s=getComputedStyle(b);return {scale:s.scale,opacity:s.opacity,active:b.matches(':active'),reduce:matchMedia('(prefers-reduced-motion: reduce)').matches};})()`,
        ),
      ),
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 450,
    y: 320,
    button: 'left',
    clickCount: 1,
  });
  assert.ok(
    await evaluate(
      `(()=>{const buttons=[...document.querySelectorAll('#feedback-buttons button')];return buttons.slice(0,3).every(b=>Number(b.dataset.clicks)>=2)&&buttons[3].dataset.clicks==='0';})()`,
    ),
    'feedback preserves enabled and disabled clicks',
  );
  await evaluate(`document.querySelector('#feedback-buttons').remove();applyTheme('light')`);
  await send('Emulation.setEmulatedMedia', { features: [] });
  console.log('Button motion pointer, keyboard, theme and reduced-motion checks passed');
  const scenes = [
    [
      'library',
      `(()=>{const a=document.querySelector('#meeting-selection-toggle').getBoundingClientRect(),b=document.querySelector('#home-view .primary-action').getBoundingClientRect(),w=document.querySelector('#workspace-selector').getBoundingClientRect(),c=document.querySelector('.workspace-subnav').getBoundingClientRect();if(Math.abs(a.top-b.top)>1||Math.abs(a.height-b.height)>1||w.bottom>c.bottom)throw Error('选择按钮或工作区裁剪 '+JSON.stringify({selection:a,primary:b,selector:w,container:c}));const add=document.querySelector('.new-workspace'),ar=add.getBoundingClientRect(),ir=add.querySelector('svg').getBoundingClientRect();if(Math.abs(ar.x+ar.width/2-ir.x-ir.width/2)>1||Math.abs(ar.y+ar.height/2-ir.y-ir.height/2)>1)throw Error('添加工作区图标未居中');const expected=document.createElement('span');expected.innerHTML=interfaceIcon('chevron-right');if(document.querySelector('[data-meeting-menu] svg').outerHTML!==expected.innerHTML)throw Error('会议行未使用箭头');const nav=document.querySelector('#all-meetings'),group=document.querySelector('.library-group h2');if(getComputedStyle(document.body).fontWeight!=='400'||getComputedStyle(document.querySelector('.library-toolbar .search input')).fontWeight!=='400'||getComputedStyle(nav).fontSize!=='16px'||Math.abs(nav.querySelector('svg').getBoundingClientRect().width-20)>1||getComputedStyle(group).fontSize!=='20px')throw Error('正文/侧栏图标/分组标题样式再次被覆盖 '+JSON.stringify({body:getComputedStyle(document.body).fontWeight,nav:getComputedStyle(nav).fontSize,icon:nav.querySelector('svg').getBoundingClientRect().width,group:getComputedStyle(group).fontSize}));})()`,
    ],
    [
      'workspace-picker',
      `(()=>{document.querySelector('#workspace-selector').click();const r=workspacePicker.getBoundingClientRect(),hit=document.elementFromPoint(r.left+30,r.top+30);if(!workspacePicker.matches(':popover-open')||!workspacePicker.contains(hit))throw Error('工作区弹层被遮挡');if(Math.abs(r.width-256)>1||r.height>337||workspacePicker.querySelector('.workspace-item').getBoundingClientRect().height>31)throw Error('工作区菜单仍沿用过宽/过疏旧值');})()`,
    ],
    [
      'workspace-search',
      `(()=>{const input=workspacePicker.querySelector('input');input.value='个人';input.dispatchEvent(new Event('input'));if(workspacePicker.querySelectorAll('[data-workspace-id]').length!==1)throw Error('工作区筛选失效');})()`,
    ],
    [
      'workspace-create',
      `(async()=>{workspacePicker.querySelector('[data-new-workspace]').click();if(workspacePicker||!document.querySelector('.workspace-dialog'))throw Error('工作区创建弹窗被选择器遮挡');})()`,
    ],
    [
      'selection-empty',
      `(async()=>{document.querySelector('.workspace-dialog [data-close-modal]').click();await new Promise(r=>setTimeout(r,350));document.querySelector('#meeting-selection-toggle').click();if(selectedMeetingKeys.size||!batchToolbar.querySelector('[data-batch-delete]').disabled||!batchToolbar.querySelector('[data-batch-export]').disabled)throw Error('0项动作应禁用');})()`,
    ],
    [
      'meeting-submenu',
      `(()=>{document.querySelector('#meeting-selection-toggle').click();document.querySelector('[data-meeting-menu]').click();document.querySelector('[data-meeting-action=workspace]').click();window.dispatchEvent(new Event('resize'));const parent=document.querySelector('.meeting-menu:not([hidden])').getBoundingClientRect(),sub=document.querySelector('.meeting-workspace-menu').getBoundingClientRect();if(Math.abs(parent.top-sub.top)>1||Math.abs(parent.left-sub.right-8)>1)throw Error('二级菜单连接错位');})()`,
    ],
    [
      'playback-task',
      `(async()=>{closeMeetingMenus();currentMeetingDetail={id:'feedback-detail',title:'产品周会',segments:[],speakers:[]};playerAudio.muted=true;playerAudio.src=${JSON.stringify(pathToFileURL(audioPath).href)};await playerAudio.play();playerAudio.currentTime=12;renderMiniPlayback();const bar=miniPlaybackSeek.getBoundingClientRect();if([...miniPlayback.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||miniPlayback.querySelector('#mini-playback-caption')||Math.abs(bar.height-6)>1||getComputedStyle(miniPlaybackSeek,'::after').content!=='none')throw Error('播放卡片未统一');const card=miniPlayback.getBoundingClientRect(),icon=miniPlayback.querySelector('.task-kind-icon').getBoundingClientRect();if(Math.abs(icon.top+icon.height/2-card.top-card.height/2)>1||getComputedStyle(miniPlayback).borderColor==='rgb(214, 214, 214)')throw Error('任务图标或播放边框不一致');miniPlaybackToggle.click();if(!playerAudio.paused)throw Error('后台暂停失效');})()`,
    ],
    [
      'sidebar-six-tasks',
      `(()=>{miniMeeting.hidden=false;miniTitle.textContent='产品周会';miniTimer.textContent='18:42';showRefinementProgress(42,100,'产品周会',currentMeetingDetail.id,'正在识别');const model=onboardingAsrModels()[0];modelDownloads.set(model.id,{received:model.size_bytes*.42,total:model.size_bytes});renderModelDownloadQueue();showTranslationProgress(56,100,'en');showSummaryProgress(68,100,'summary.generating');document.querySelectorAll('#translation-progress,#summary-progress').forEach(c=>c.hidden=false);syncTaskCardStack();taskCards.scrollTop=0;const title=refinementCard.querySelector('header p'),cards=[...taskCards.children].filter(c=>!c.hidden);if(cards.length!==6||title.scrollWidth>title.clientWidth+1)throw Error('六任务布局 '+JSON.stringify({cards:cards.map(c=>c.id),width:title.clientWidth,scroll:title.scrollWidth}));})()`,
    ],
    [
      'detail-notes',
      `(async()=>{playerAudio.pause();miniPlayback.hidden=true;await showView('detail');currentMeetingDetail={id:'feedback-detail',title:'产品周会',segments:[],speakers:[]};Object.assign(uiData.detail,{notes:'- 项目计划\\n- 确认下一步',transcript:[{time:'00:00',text:'先回顾上周进展。',speaker:{name:'张伟'},startSeconds:0,endSeconds:10}],hasRefined:false,hasOriginalTranscript:true,transcriptEditing:false,notesEditing:false,summaryEditing:false,summary:{markdown:'## 会议摘要\\n回顾进展，确认下一步。'}});detailActiveTab='notes';document.querySelector('#detail-view .detail-head h1').textContent=currentMeetingDetail.title;showSummaryProgress(100,100,'summary.complete');renderMeetingDetail();if(document.querySelector('.summary-review-hint')||document.querySelector('#language-toggle'))throw Error('已删除入口仍存在');})()`,
    ],
    [
      'detail-transcript',
      `(()=>{document.querySelector('[data-detail-tab=transcript]').click();const panel=document.querySelector('[data-detail-panel=transcript]');if(panel.hidden||!panel.getAnimations().length)throw Error('逐字稿切换缺少动画');})()`,
    ],
    [
      'detail-summary',
      `(()=>{document.querySelector('[data-detail-tab=summary]').click();const panel=document.querySelector('[data-detail-panel=summary]');if(panel.hidden||!panel.getAnimations().length)throw Error('纪要切换缺少动画');const body=panel.querySelector('.summary-body');body.innerHTML=renderMarkdown('# 产品周会\\n\\n---\\n\\n## 会议摘要\\n'+('回顾进展，确认下一步。'.repeat(75))+'\\n\\n---\\n\\n---\\n\\n## 核心结论\\n保持已有计划。');const headings=[...body.querySelectorAll('hr + h2')];if(headings.length!==2||headings.some(h=>getComputedStyle(h).borderTopWidth!=='0px')||getComputedStyle(body.querySelector('hr + hr')).display!=='none'||parseFloat(getComputedStyle(body).paddingRight)<16)throw Error('纪要重复横线或滚动留白回归');})()`,
    ],
    [
      'detail-summary-sidebar-scroll',
      `(()=>{const html=document.querySelector('[data-detail-panel=summary] .summary-body').innerHTML;document.querySelector('[data-detail-tab=transcript]').click();const body=document.querySelector('#detail-view .notes .summary-body');body.innerHTML=html;if(body.scrollHeight<=body.clientHeight||parseFloat(getComputedStyle(body).paddingRight)<16||[...body.querySelectorAll('hr + h2')].some(h=>getComputedStyle(h).borderTopWidth!=='0px'))throw Error('纪要侧栏滚动或分隔线回归');})()`,
    ],
    [
      'detail-reduced-motion',
      `(()=>{document.querySelector('[data-detail-tab=notes]').click();const panel=document.querySelector('[data-detail-panel=notes]');if(panel.hidden||panel.getAnimations().length)throw Error('减少动态效果未生效');})()`,
    ],
    [
      'onboarding-ai',
      `(()=>{openOnboardingAi();const enabled=onboardingPage.querySelector('[name=onboarding-ai-enabled]');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));const button=onboardingPage.querySelector('[data-flow-select-choice=onboarding-ai-proactivity][data-value=auto]');button.click();const card=button.closest('.onboarding-ai-row').getBoundingClientRect(),levels=button.parentElement.getBoundingClientRect();if(levels.bottom>card.bottom||levels.top<card.top)throw Error('主动性选择条越过卡片');if(button.getAttribute('aria-checked')!=='true'||getComputedStyle(button).justifyContent!=='center'||!getComputedStyle(button.parentElement,'::before').transitionDuration.includes('0.18'))throw Error('主动性选择器缺少居中或动画');})()`,
    ],
    [
      'onboarding-phone',
      `(async()=>{dismissOnboardingPage();await new Promise(r=>setTimeout(r,350));openOnboardingMobile();if(onboardingPage.querySelector('.mobile-install-platform p,.mobile-install-platform small')||onboardingPage.querySelectorAll('.mobile-install-qr').length!==2)throw Error('安装说明未简化或二维码丢失');})()`,
    ],
    [
      'device-connection',
      `(async()=>{dismissOnboardingPage();await new Promise(r=>setTimeout(r,350));await showView('home');await document.querySelector('#mobile-nav').onclick();if(activeView!=='settings'||!settingsModal.classList.contains('settings-page'))throw Error('侧栏设备入口未进入设计设置页');const heading=document.querySelector('.mobile-service-heading'),switcher=heading.querySelector('.onboarding-ai-switch');if(getComputedStyle(switcher).marginLeft!=='0px'||switcher.getBoundingClientRect().left-heading.getBoundingClientRect().left>310)throw Error('设备开关仍被通用auto边距推右');const button=settingsModal.querySelector('[data-mobile-install-toggle]');if(!button||!settingsModal.querySelector('.mobile-install').hidden)throw Error('安装入口未移到顶部');})()`,
    ],
    [
      'device-install',
      `(()=>{settingsModal.querySelector('[data-mobile-install-toggle]').click();if(settingsModal.querySelector('.mobile-install').hidden||settingsModal.querySelectorAll('.mobile-install-qr').length!==2)throw Error('安装入口无法展开');})()`,
    ],
    [
      'device-languages',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,350));for(const language of Object.keys(catalog)){applyLanguage(language);await openModal('device-connection');const checks={pair:document.querySelector('#mobile-pair').textContent===t('连接新设备'),title:document.querySelector('#mobile-install-title').textContent===t('安装Brevia手机端'),button:document.querySelector('[data-mobile-install-toggle]').textContent===t('安装Brevia手机端'),heading:document.querySelector('.mobile-install-platform h4').textContent===t('iPhone · App Store'),description:document.querySelector('.mobile-install-platform p').textContent===t('扫码或点击链接，从 App Store 免费安装 Brevia。'),state:document.querySelector('.mobile-device-empty')?.textContent===t('暂无已信任设备'),connected:document.querySelector('#mobile-connected-heading').textContent===t('尚未连接设备'),sidebar:[...document.querySelector('#mobile-nav').querySelectorAll('strong,svg,#mobile-sidebar-status,#mobile-nav-dot')].every(n=>{if(!n.getClientRects().length)return true;const r=n.getBoundingClientRect(),o=document.querySelector('#mobile-nav').getBoundingClientRect();const style=getComputedStyle(n),clipped=n.id==='mobile-sidebar-status'&&style.clipPath==='inset(50%)'&&style.overflow==='hidden';return r.left>=o.left-1&&r.right<=o.right+1&&(clipped||n.scrollWidth<=n.clientWidth+1);})};if(Object.values(checks).some(v=>!v))throw Error(language+JSON.stringify(checks));closeModal();await new Promise(r=>setTimeout(r,350));}applyLanguage('zh');if(document.querySelector('[data-ai-assist-empty]'))throw Error('空白笔记仍显示介绍占位');liveNotesEditor.setMode('markdown');liveNotesEditor.setMode('rich');})()`,
    ],
    [
      'settings-language',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,350));await showView('settings');const choices=document.querySelectorAll('#settings-view [data-flow-select-choice=interface-language]');if(choices.length!==8)throw Error('设置语言选项丢失');const english=[...choices].find(c=>c.dataset.value==='en');english.closest('.flow-select').querySelector('[data-flow-select-toggle]').click();english.click();if(locale!=='en'||localStorage.getItem('brevia-language')!=='en')throw Error('设置切换语言失效');})()`,
    ],
    ...['en', 'ru'].map((language) => [
      `onboarding-language-${language}`,
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,300));if(onboardingPage)await new Promise(r=>dismissOnboardingPage(r));openOnboardingLanguage('${language}');await new Promise(r=>setTimeout(r,300));const rail=onboardingPage.querySelector('.onboarding-rail'),bounds=rail.getBoundingClientRect();for(const e of rail.querySelectorAll('h2,p,.onboarding-mechanism b,.onboarding-mechanism small,li')){const r=e.getBoundingClientRect();if(r.right>bounds.right+1||r.bottom>bounds.bottom+1||e.scrollWidth>e.clientWidth+1)throw Error('${language}引导文案被裁切 '+e.textContent);}})()`,
    ]),
    [
      'onboarding-permission-meter',
      `(async()=>{await new Promise(r=>dismissOnboardingPage(r));applyLanguage('zh');openOnboardingPermissions({microphone:'granted',screen:'granted',systemAudioSupported:true});await new Promise(r=>setTimeout(r,150));breviaClient.onLevel('mic',0.5);const meter=onboardingPage.querySelector('[data-onboarding-mic-level]');if(!getComputedStyle(meter).maskImage.includes("rx='2'"))throw Error('电平缺少圆角分段');})()`,
    ],
    [
      'onboarding-model-options',
      `(async()=>{await new Promise(r=>dismissOnboardingPage(r));await openOnboardingSetup();const section=onboardingPage.querySelector('.onboarding-setup-sections'),header=onboardingPage.querySelector('.onboarding-model-heading');if(section.scrollHeight>section.clientHeight+1||!header.querySelector('[data-china-model-source]'))throw Error('默认页面未完整显示模型选项 '+JSON.stringify({height:section.clientHeight,scroll:section.scrollHeight}));if(onboardingPage.querySelector('.asr-tagline').textContent!=='轻量高效，中文识别效果更佳。')throw Error('模型简介与设计稿不符');const folder=onboardingPage.querySelector('details'),expanded=parseFloat(getComputedStyle(folder,'::details-content').blockSize);folder.querySelector('summary').click();await new Promise(r=>setTimeout(r,70));const closing=parseFloat(getComputedStyle(folder,'::details-content').blockSize);if(closing<=0||closing>=expanded)throw Error('保存位置收起缺少动画 '+JSON.stringify({expanded,closing}));await new Promise(r=>setTimeout(r,250));if(parseFloat(getComputedStyle(folder,'::details-content').blockSize)!==0)throw Error('保存位置未完成收起');folder.querySelector('summary').click();await new Promise(r=>setTimeout(r,70));const opening=parseFloat(getComputedStyle(folder,'::details-content').blockSize);if(opening<=0||opening>=expanded)throw Error('保存位置展开缺少动画 '+JSON.stringify({expanded,opening}));})()`,
    ],
    [
      'onboarding-ai-service-first',
      `(async()=>{await new Promise(r=>dismissOnboardingPage(r));openOnboardingAi();if(!onboardingPage.querySelector('.onboarding-ai-sections').firstElementChild.matches('.onboarding-shared-service')||onboardingPage.querySelector('[name=onboarding-ai-way]'))throw Error('引导服务入口未统一');})()`,
    ],
    [
      'onboarding-ai-full-description',
      `(async()=>{onboardingBuiltinProvider=true;onboardingOnlineProvider=false;summaryConfigDraft=structuredClone(summaryConfig);summaryConfigDraft.provider='built-in';await openModal('summary-model');const intro=settingsModal.querySelector('.model-picker-intro'),style=getComputedStyle(intro);if(style.webkitLineClamp!=='none'||intro.scrollHeight>intro.clientHeight+1)throw Error('模型说明仍被裁切');})()`,
    ],
    [
      'onboarding-shared-provider',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,260));onboardingPage.querySelector('[data-configure-ai-summary]').click();const provider=settingsModal.querySelector('[name=provider]');if(provider.value!=='built-in'||settingsModal.querySelectorAll('[data-flow-select-choice=provider]').length!==6||!settingsModal.querySelector('[data-download-model]'))throw Error('默认本地服务缺少供应商或下载入口');settingsModal.querySelector('[data-flow-select-choice=provider][data-value=custom-openai]').click();if(!settingsModal.querySelector('[name=apiKey]')||!settingsModal.querySelector('[name=endpoint]'))throw Error('在线服务表单缺失');settingsModal.querySelector('[data-flow-select-choice=provider][data-value=built-in]').click();if(settingsModal.querySelector('[name=apiKey]')||!settingsModal.querySelector('[data-download-model]'))throw Error('切回本地模型失败');})()`,
    ],
    [
      'onboarding-phone-pair-overlay',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,300));await new Promise(r=>dismissOnboardingPage(r));openOnboardingMobile();const rail=onboardingPage.querySelector('.onboarding-rail'),content=onboardingPage.querySelector('.onboarding-mobile-page'),before=[rail.getBoundingClientRect().width,content.getBoundingClientRect().width];onboardingPage.querySelector('[data-onboarding-mobile-pair]').click();const deadline=Date.now()+10000;while(!document.querySelector('#mobile-pair-dialog').open){if(Date.now()>deadline)throw Error('配对浮窗未打开');await new Promise(r=>setTimeout(r,50));}if(before[0]!==rail.getBoundingClientRect().width||before[1]!==content.getBoundingClientRect().width||getComputedStyle(content).display==='none')throw Error('配对浮窗改变了背景页面');if(!onboardingPage.textContent.includes('无线麦克风'))throw Error('手机端用途说明缺失');})()`,
    ],
    [
      'onboarding-pair-auto-refresh',
      `(async()=>{const qr=document.querySelector('#mobile-qr').src,clock=Date.now;try{Date.now=()=>clock()+121000;await new Promise(r=>setTimeout(r,1300));}finally{Date.now=clock;}await new Promise(r=>setTimeout(r,1100));const dialog=document.querySelector('#mobile-pair-dialog');if(!dialog.open||qr===document.querySelector('#mobile-qr').src||!document.querySelector('#mobile-retry-pairing').hidden||document.querySelector('#mobile-copy-pin').disabled||document.querySelector('#mobile-pair-error').textContent)throw Error('超时未自动刷新有效配对码');if(document.querySelector('#mobile-address').textContent==='00:00')throw Error('刷新后倒计时未重置');if(Math.abs(dialog.getBoundingClientRect().width-620)>1||!document.querySelector('#mobile-pair-description').textContent.includes('用应用扫描'))throw Error('配对浮窗宽度或应用扫码提示不正确');})()`,
    ],
    [
      'settings-about-logo',
      `(async()=>{document.querySelector('#mobile-close-pairing').click();await new Promise(r=>setTimeout(r,300));await new Promise(r=>dismissOnboardingPage(r));await showView('home');document.querySelector('.sidebar-settings').click();await pageTransition;await openModal('whats-new');await new Promise(r=>setTimeout(r,260));const sidebar=document.querySelector('.sidebar'),brand=document.querySelector('.brand-mark img'),about=settingsModal.querySelector('.about-brand-mark img');await Promise.all([brand.decode(),about.decode()]);if(Math.abs(sidebar.getBoundingClientRect().width-72)>1||getComputedStyle(document.querySelector('.brand-name')).display!=='none'||!brand.naturalWidth||!about.naturalWidth)throw Error('收起侧栏或关于页缺少 logo');})()`,
    ],
    [
      'settings-return-library',
      `(async()=>{for(const id of ['all-meetings','recently-deleted']){await showView('settings');await openModal('models');const node=document.getElementById(id),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!node.contains(hit))throw Error('设置遮挡了主导航 '+id);hit.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pageTransition;await new Promise(r=>setTimeout(r,260));if(activeView!=='home'||activeLibraryNav!==id||!settingsModal.hidden||document.querySelector('.app-shell').inert||Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-240)>1)throw Error('设置返回会议库失败 '+id+' '+JSON.stringify({view:activeView,nav:activeLibraryNav,modalHidden:settingsModal.hidden,inert:document.querySelector('.app-shell').inert,width:document.querySelector('.sidebar').getBoundingClientRect().width}));}await showLibraryNav('all-meetings');})()`,
    ],
    [
      'storage-system-disk',
      `(async()=>{await showView('settings');await openModal('storage');const deadline=Date.now()+5000;while(!settingsModal.querySelector('[role=progressbar]')){if(Date.now()>deadline)throw Error('系统磁盘用量未显示');await new Promise(r=>setTimeout(r,50));}const bar=settingsModal.querySelector('[role=progressbar]');if(Math.abs(Number(bar.getAttribute('aria-valuenow'))-systemDiskUsage.used/systemDiskUsage.total*100)>.1||!bar.getAttribute('aria-valuetext').includes(formatBytes(systemDiskUsage.total))||!settingsModal.querySelector('.storage-app-usage'))throw Error('磁盘容量或占比不是实际数据');})()`,
    ],
    [
      'storage-confirmation-no-flash',
      `(async()=>{await showView('settings');await openModal('storage');await new Promise(r=>setTimeout(r,300));const panel=settingsModal.querySelector('.modal-panel'),body=settingsModal.querySelector('.modal-body'),privacy=body.querySelector('.storage-privacy'),usage=body.querySelector('.storage-app-usage'),original=storageUsage;privacy.open=true;body.scrollTop=body.scrollHeight;for(const partition of ['meetings','models']){const button=body.querySelector('[data-clear-storage='+partition+']');button.focus();const scroll=body.scrollTop;button.click();const background=storageConfirmationPage.page;if(background.querySelector('.modal-panel')!==panel||getComputedStyle(panel).opacity!=='1'||panel.getAnimations().some(a=>a.animationName==='overlay-in'&&a.playState!=='finished'))throw Error('确认框导致背景页面重新进入或闪烁');settingsModal.querySelector('[data-cancel-confirmation]').click();await new Promise(r=>requestAnimationFrame(r));if(settingsModal.querySelector('.modal-panel')!==panel||document.activeElement!==button||body.scrollTop!==scroll||!privacy.open||getComputedStyle(panel).opacity!=='1')throw Error('取消后页面闪烁或状态丢失 '+JSON.stringify({partition,panel:settingsModal.querySelector('.modal-panel')===panel,focus:document.activeElement===button,scrollBefore:scroll,scrollAfter:body.scrollTop,privacy:privacy.open,opacity:getComputedStyle(panel).opacity}));storageUsage={meetings:partition==='meetings'?0:100,models:partition==='models'?0:200};updateStorageUsage();await refreshSettingsFolderRows();if(body.querySelector('.storage-app-usage')!==usage||body.querySelector('[data-clear-storage='+partition+']')!==button||!privacy.open||body.scrollTop!==scroll||!usage.textContent.includes(formatBytes(storageUsage.meetings+storageUsage.models)))throw Error('容量刷新重建页面或丢失滚动位置');}storageUsage=original;updateStorageUsage();privacy.open=false;body.scrollTop=0;})()`,
    ],
    [
      'settings-refresh-reading-position',
      `(async()=>{await showView('settings');const oldProfiles=speakerProfiles,oldTab=modelLibraryTab;for(const kind of ['models','summary-model','ai-assist','advanced-settings','speaker-profiles','whats-new','device-connection','storage']){await openModal(kind);await new Promise(r=>setTimeout(r,260));if(kind==='models'){modelLibraryTab='installed';renderModelLibrary();}if(kind==='summary-model'){summaryConfigDraft.provider='custom-openai';renderSummaryModelModal();}if(kind==='ai-assist'){aiAssistConfigDraft.provider='custom-openai';renderAiAssistModal();}if(kind==='speaker-profiles'){speakerProfiles=Array.from({length:12},(_,i)=>({id:'feedback-speaker-'+i,name:'样本说话人 '+i,sample_count:0}));renderSpeakerProfileModal();}if(kind==='device-connection')settingsModal.querySelector('[data-mobile-install-toggle]').click();const body=settingsModal.querySelector('.modal-body'),panel=settingsModal.querySelector('.modal-panel'),navigation=settingsModal.querySelector('.settings-navigation');body.style.maxHeight='160px';const detail=body.querySelector('details');if(detail)detail.open=true;body.scrollTop=body.scrollHeight;const before=body.scrollTop;if(before<1)throw Error('刷新用例没有滚动 '+kind);renderModal(kind);if(Math.abs(body.scrollTop-before)>1||getComputedStyle(panel).opacity!=='1'||settingsModal.querySelector('.settings-navigation')!==navigation||detail&&!body.querySelector('details').open)throw Error('同页刷新丢失阅读位置或闪烁 '+kind+' '+JSON.stringify({before,after:body.scrollTop,opacity:getComputedStyle(panel).opacity}));await openModal(kind);if(Math.abs(body.scrollTop-before)>1)throw Error('重复点击当前设置项回到顶部 '+kind);if(kind==='advanced-settings'){const section=body.querySelector('[data-permission-settings]');section.open=true;const top=body.scrollTop;refreshPermissionSettings();if(!body.querySelector('[data-permission-settings]').open||Math.abs(body.scrollTop-top)>1)throw Error('权限更新收起内容或跳动');}body.style.maxHeight='';}speakerProfiles=oldProfiles;modelLibraryTab=oldTab;})()`,
    ],
    [
      'settings-navigation-resets-position',
      `(async()=>{await openModal('whats-new');const body=settingsModal.querySelector('.modal-body');body.scrollTop=body.scrollHeight;await openModal('models');if(body.scrollTop!==0)throw Error('真正换页未从顶部开始');await openModal('device-connection');if(!settingsModal.querySelector('.mobile-install').hidden)throw Error('设备页新打开未复位安装说明');})()`,
    ],
    [
      'floating-refresh-and-quick-close',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,260));await showView('home');await openModal('summary-model');summaryConfigDraft.provider='custom-openai';renderModal('summary-model');await new Promise(r=>setTimeout(r,260));const body=settingsModal.querySelector('.modal-body'),panel=settingsModal.querySelector('.modal-panel');settingsModal.style.maxHeight='240px';body.querySelector('[name=endpoint]').focus();settingsModal.scrollTop=settingsModal.scrollHeight;const before=settingsModal.scrollTop;renderModal('summary-model');if(before<1||Math.abs(settingsModal.scrollTop-before)>1||document.activeElement.name!=='endpoint'||panel.getAnimations().some(a=>a.animationName==='overlay-in'&&a.playState!=='finished'))throw Error('配置浮窗刷新跳动或重播动画 '+JSON.stringify({before,after:settingsModal.scrollTop,focus:document.activeElement.outerHTML,animations:panel.getAnimations().map(a=>({name:a.animationName,time:a.currentTime,play:a.playState})),hidden:settingsModal.hidden,kind:body.dataset.contentKind}));settingsModal.style.maxHeight='';closeModal();await new Promise(r=>setTimeout(r,260));await openModal('upgrade-log');await new Promise(r=>setTimeout(r,260));renderWhatsNewModal();renderWhatsNewModal();if(settingsModal.querySelectorAll('.upgrade-log-actions').length!==1)throw Error('更新日志刷新重复插入操作栏');closeModal();await new Promise(r=>setTimeout(r,260));await openModal('models');closeModal();await new Promise(r=>requestAnimationFrame(r));if(settingsModal.classList.contains('modal-enter'))throw Error('关闭后旧帧重加进入状态');await new Promise(r=>setTimeout(r,260));if(!settingsModal.hidden)throw Error('快速关闭未完成');await showView('settings');})()`,
    ],
    [
      'settings-task-summary-bottom',
      `(async()=>{await showView('settings');closeModal();await new Promise(r=>setTimeout(r,260));refinementCard.hidden=false;refinementCard.dataset.completed='29';refinementCard.dataset.total='100';syncTaskCardStack(refinementCard);await new Promise(r=>setTimeout(r,260));const card=document.querySelector('[data-task-summary]'),r=card.getBoundingClientRect(),device=document.querySelector('#mobile-nav').getBoundingClientRect();if(device.top<r.bottom||device.top-r.bottom>32||innerHeight-r.bottom>160)throw Error('任务缩略卡未靠下显示');for(const node of card.querySelectorAll('span,b')){const box=node.getBoundingClientRect();if(box.left<r.left||box.right>r.right+1||box.bottom>r.bottom+1)throw Error('任务缩略内容越过卡片');}if(card.querySelector('[data-task-summary-label]').scrollHeight>card.querySelector('[data-task-summary-label]').clientHeight)throw Error('任务名称换行');})()`,
    ],
    [
      'settings-ai-summary-alignment',
      `(async()=>{await showView('settings');refinementCard.hidden=true;syncTaskCardStack();summaryConfigDraft=structuredClone(summaryConfig);summaryConfigDraft.provider='custom-openai';await openModal('summary-model');await new Promise(r=>setTimeout(r,260));const toggle=settingsModal.querySelector('.summary-enabled-control input'),way=settingsModal.querySelector('.ai-service-choice'),radio=way.querySelector('input'),field=settingsModal.querySelector('.config-fields .flow-select-toggle'),row=settingsModal.querySelector('.summary-enabled-control');if(Math.abs(toggle.getBoundingClientRect().left-field.getBoundingClientRect().left)>1||Math.abs(radio.getBoundingClientRect().left-field.getBoundingClientRect().left)>1)throw Error('会议纪要控件未按选项列对齐');if(way.getBoundingClientRect().top-row.getBoundingClientRect().bottom<11||settingsModal.querySelector('.config-fields').getBoundingClientRect().top-way.getBoundingClientRect().bottom<11)throw Error('服务方式行间距过窄');})()`,
    ],
    [
      'settings-ai-notes-alignment',
      `(async()=>{aiAssistConfigDraft=structuredClone(aiAssistConfig);aiAssistConfigDraft.provider='custom-openai';await openModal('ai-assist');await new Promise(r=>setTimeout(r,260));const toggle=settingsModal.querySelector('.summary-enabled-control input'),way=settingsModal.querySelector('.ai-service-choice'),radio=way.querySelector('input'),field=settingsModal.querySelector('.config-fields .flow-select-toggle'),row=settingsModal.querySelector('.summary-enabled-control'),r=toggle.getBoundingClientRect();if(way.getBoundingClientRect().top-row.getBoundingClientRect().bottom<11||Math.abs(r.left-field.getBoundingClientRect().left)>1||Math.abs(radio.getBoundingClientRect().left-field.getBoundingClientRect().left)>1)throw Error('智能笔记未独占开关行或控件未对齐');if(Math.abs(r.width-44)>1||Math.abs(r.height-26)>1||getComputedStyle(toggle).paddingTop!=='3px')throw Error('开关图标尺寸错误 '+JSON.stringify({width:r.width,height:r.height,padding:getComputedStyle(toggle).paddingTop,border:getComputedStyle(toggle).borderWidth}));})()`,
    ],
    [
      'settings-sidebar-collapsed',
      `(async()=>{await showView('settings');await openModal('models');await new Promise(r=>setTimeout(r,260));const mobile=document.querySelector('#mobile-nav svg').getBoundingClientRect(),settings=document.querySelector('.sidebar-settings svg').getBoundingClientRect();if(Math.abs(mobile.x+mobile.width/2-settings.x-settings.width/2)>1)throw Error('收起侧栏图标未对齐');if(getComputedStyle(settingsModal.querySelector('.settings-back')).display!=='none')throw Error('设置返回箭头仍可见');})()`,
    ],
    [
      'settings-sidebar-hover-open',
      `(async()=>{await new Promise(r=>setTimeout(r,70));const sidebar=document.querySelector('.sidebar'),width=sidebar.getBoundingClientRect().width;if(width<=72||width>=240)throw Error('侧栏展开缺少动画 '+width);await new Promise(r=>setTimeout(r,220));if(Math.abs(sidebar.getBoundingClientRect().width-240)>1||getComputedStyle(document.querySelector('.brand-name')).display==='none'||Math.abs(settingsModal.getBoundingClientRect().left-240)>1)throw Error('悬停未展开侧栏或设置遮挡侧栏 '+JSON.stringify({width:sidebar.getBoundingClientRect().width,brand:getComputedStyle(document.querySelector('.brand-name')).display,left:settingsModal.getBoundingClientRect().left,styleLeft:getComputedStyle(settingsModal).left,hover:sidebar.matches(':hover'),focus:sidebar.matches(':focus-within')}));})()`,
    ],
    [
      'settings-sidebar-hover-close',
      `(async()=>{await new Promise(r=>setTimeout(r,70));const sidebar=document.querySelector('.sidebar'),width=sidebar.getBoundingClientRect().width;if(width<=72||width>=240)throw Error('侧栏收起缺少动画 '+width);await new Promise(r=>setTimeout(r,220));if(Math.abs(sidebar.getBoundingClientRect().width-72)>1||getComputedStyle(document.querySelector('.brand-name')).display!=='none')throw Error('移开鼠标后侧栏未收起');})()`,
    ],
  ];
  // 录制笔记空态沿用真实编辑器与动作，数据仅在隔离窗口内。
  scenes.push(
    [
      'live-notes-empty-disabled',
      `(async()=>{applyTheme('light');await showView('live');meetingActive=true;document.querySelector('.app-shell').classList.add('is-live-meeting');document.querySelector('#live-name').textContent='产品周会';aiAssistConfig={...aiAssistConfig,enabled:false};aiAssistTemporarilyDisabled=false;liveNotesToolbar.hidden=true;liveNotesEditor.setMode('rich');liveNotesEditor.setMarkdown('');renderAiAssistToggle();})()`,
    ],
    ['live-notes-empty-enabled', `(()=>{aiAssistConfig.enabled=true;renderAiAssistToggle();})()`],
    [
      'live-notes-empty-toolbar-dark',
      `(()=>{applyTheme('dark');liveNotesToolbar.hidden=false;})()`,
    ],
    [
      'live-notes-filled',
      `(()=>{applyTheme('light');liveNotesToolbar.hidden=true;liveNotesEditor.setMarkdown('## 会议重点\\n\\n- 确认下周发布计划。');if(document.querySelector('[data-ai-assist-empty]'))throw Error('已有笔记仍显示介绍占位');})()`,
    ],
  );
  // 精修稿只替换隔离数据，仍调用正式列表、纪要与共享阅读布局。
  scenes.push(
    [
      'polish-library',
      `(()=>{closeModal();meetingActive=false;workspaces[0].name='产品';activeWorkspaceId=workspaces[0].id;const source=uiData.meetings[0];uiData.meetings=['需求评审','项目复盘','客户访谈','产品周会'].map((title,i)=>({...source,id:'polish-'+i,title,workspaceId:activeWorkspaceId,workspace:{name:'产品'},durationMs:1080000,createdAt:new Date(new Date().setHours(10,34,0,0)).toISOString(),speakerCount:2,hasSummary:true}));showView('home');renderWorkspaceNav();renderMeetingList();updateHomeViewTitle();const icon=document.querySelector('.meeting-row-icon'),search=document.querySelector('.library-toolbar .search'),edit=document.querySelector('#workspace-edit');if(getComputedStyle(icon).backgroundColor!=='rgba(0, 0, 0, 0)'||getComputedStyle(search).backgroundColor!=='rgb(255, 255, 255)'||getComputedStyle(edit).borderTopColor!=='rgba(0, 0, 0, 0)')throw Error('精修列表表面未生效');const row=document.querySelector('.meeting-row');for(const [selector,x] of [['.meeting-main',360],['.meeting-workspace',705],['.meeting-status',902]]){const actual=row.querySelector(selector).getBoundingClientRect().x;if(Math.abs(actual-x)>8)throw Error('概念图列表列对齐偏差 '+selector+' '+actual);}})()`,
    ],
    [
      'polish-summary',
      `(async()=>{const init=await window.brevia.initialize();const source=await window.brevia.meeting.get({meeting_id:init.meetings[0].id});source.title='产品周会';source.duration_ms=1080000;source.workspace_id=activeWorkspaceId;source.created_at='2026-10-15T02:34:00Z';source.speakers=[{id:'polish-zhang',name:'张伟'},{id:'polish-li',name:'李娜'},{id:'polish-wang',name:'王强'},{id:'polish-zhao',name:'赵敏'}];applyBackendDetail(source);Object.assign(uiData.detail,{notes:'',transcript:[],hasRefined:false,hasOriginalTranscript:true,transcriptEditing:false,notesEditing:false,summaryEditing:false,summary:{markdown:'# 产品周会\\n\\n## 会议摘要\\n会议确认了新用户引导的上线范围。设计已完成，团队将按计划交付测试版本，并开展小范围发布。\\n\\n## 核心结论\\n- 按既定范围发布新用户引导。\\n- 本周优先稳定现有功能，不扩展新需求。\\n\\n## 已确认决定\\n- 下周一开始小范围发布。\\n- 确认方：会议参与者。\\n\\n## 行动项\\n| 任务 | 负责人 | 截止时间 | 状态 |\\n| --- | --- | --- | --- |\\n| 交付测试版本 | 开发团队 | 周四 | 待开始 |\\n| 完成内部验收 | 产品团队 | 周五 | 待开始 |'}});showView('detail');detailActiveTab='summary';renderMeetingDetail();document.querySelector('#detail-view .detail-head h1').textContent=currentMeetingDetail.title;showSummaryProgress(100,100,'summary.complete');if(document.querySelector('#summary-progress header p').textContent!==summaryTaskLabel('summary.complete'))throw Error('已完成纪要仍显示生成中');const card=document.querySelector('#summary-progress').getBoundingClientRect(),device=document.querySelector('#mobile-nav').getBoundingClientRect();if(card.bottom>device.top||device.top<innerHeight-150)throw Error('任务卡或固定入口没有靠下排列 '+JSON.stringify({card:card.toJSON(),device:device.toJSON()}));const body=document.querySelector('[data-detail-panel=summary] .summary-body'),label=document.querySelector('.summary-head .eyebrow');if(body.querySelectorAll('.summary-reading-section').length!==4||body.querySelectorAll('tbody tr').length!==2||getComputedStyle(label).fontSize!=='16px'||getComputedStyle(body.querySelector('td')).borderLeftWidth!=='0px')throw Error('精修纪要结构或层级错误');})()`,
    ],
  );
  const joinedSummary =
    '# **会议纪要格式检查**\n## **会议摘要**\n讨论模型输出的标题、列表与报价，保留原始内容。## **核心结论**\n- 第一项已确认。- 第二项待确认。## **议题讨论**\n### **报价与范围**\n- 主要讨论：报价为 19、22、23.5 美元，范围为 75% 与 100%。- 当前结论：继续核对。### **后续安排**\n- 风险或限制：负责人未明确。- 待确认：交付时间。## **行动项**\n- 核对报价。- 确认负责人。';
  scenes.push(
    [
      'summary-markdown-before',
      `(async()=>{applyTheme('light');meetingActive=false;await showView('detail');const meetings=await window.brevia.meeting.list({});const id=meetings[0].id;await window.brevia.summary.save({meeting_id:id,markdown:${JSON.stringify(joinedSummary)}});const meeting=await window.brevia.meeting.get({meeting_id:id});meeting.title='会议纪要格式检查';meeting.summary.data.markdown=${JSON.stringify(joinedSummary)};applyBackendDetail(meeting);detailActiveTab='summary';renderMeetingDetail();})()`,
    ],
    [
      'summary-markdown-current',
      `(async()=>{const meeting=await window.brevia.meeting.get({meeting_id:currentMeetingDetail.id});meeting.title='会议纪要格式检查';applyBackendDetail(meeting);detailActiveTab='summary';renderMeetingDetail();const body=document.querySelector('[data-detail-panel=summary] .summary-body');if(body.querySelectorAll('h2').length!==4||body.querySelectorAll('h3').length!==2||body.querySelectorAll('li').length!==8||body.textContent.includes('##'))throw Error('纪要章节或列表未完整渲染');if(!currentMeetingDetail.summary.data.markdown.includes(${JSON.stringify('。\n- 第二项')}))throw Error('复制入口内容仍有粘连列表');})()`,
    ],
    [
      'summary-markdown-bottom',
      `(()=>{const body=document.querySelector('[data-detail-panel=summary] .summary-body');body.scrollTop=body.scrollHeight;const last=body.querySelector('li:last-child');if(!body.textContent.endsWith('确认负责人。')||body.querySelectorAll('li').length!==8)throw Error('纪要末尾内容丢失');const items=body.querySelectorAll('li'),r=items[items.length-1].getBoundingClientRect(),b=body.getBoundingClientRect();if(r.bottom>b.bottom+1||r.top<b.top)throw Error('纪要最后一项无法滚动访问');})()`,
    ],
    [
      'summary-markdown-editor',
      `(()=>{document.querySelector('[data-detail-panel=summary] [data-open-summary-edit]').click();const editor=document.querySelector('[data-inline-summary-editor] .notes-editor');if(editor.querySelectorAll('h2').length!==4||editor.querySelectorAll('h3').length!==2||editor.querySelectorAll('li').length!==8)throw Error('纪要编辑器未复用修复内容');if(!inlineSummaryEditor.getMarkdown().includes('## **核心结论**'))throw Error('纪要编辑往返丢失标题');})()`,
    ],
  );
  scenes.push([
    'live-ai-online',
    `(async()=>{applyTheme('light');await showView('live');meetingActive=true;document.querySelector('.app-shell').classList.add('is-live-meeting');await openModal('ai-assist');aiAssistConfigDraft={...aiAssistConfig,enabled:true,provider:'custom-claude',providers:{'custom-claude':{endpoint:'https://example.invalid/v1/messages',model:'test-model'}}};renderModal('ai-assist');})()`,
  ]);
  scenes.push(
    [
      'live-ai-menu',
      `(()=>{settingsModal.querySelector('.config-fields [data-flow-select-toggle]').click();const list=settingsModal.querySelector('.config-fields [data-flow-select-toggle]').closest('.flow-select').querySelector('.flow-select-options');if(list.hidden||list.getBoundingClientRect().bottom>innerHeight||!list.classList.contains('is-floating'))throw Error('AI供应商下拉被裁剪');})()`,
    ],
    [
      'live-ai-bottom',
      `(()=>{settingsModal.querySelector('.flow-select-options:not([hidden])').hidden=true;const body=settingsModal.querySelector('.modal-body');body.scrollTop=body.scrollHeight;const save=body.querySelector('[type=submit]');save.focus();const r=save.getBoundingClientRect(),b=body.getBoundingClientRect();if(r.bottom>b.bottom+1||r.top<b.top)throw Error('AI保存按钮无法访问');})()`,
    ],
    [
      'live-ai-dark',
      `(()=>{applyTheme('dark');settingsModal.querySelector('.modal-body').scrollTop=0;})()`,
    ],
    [
      'live-summary-config',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,260));await openModal('summary-model');summaryConfigDraft={...summaryConfig,provider:'custom-openai',providers:{'custom-openai':{endpoint:'https://example.invalid/v1/chat/completions',model:'test-model'}}};renderModal('summary-model');})()`,
    ],
    [
      'live-ai-short',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,260));applyTheme('light');await openModal('ai-assist');aiAssistConfigDraft={...aiAssistConfig,enabled:true,provider:'custom-claude',providers:{'custom-claude':{endpoint:'https://example.invalid/v1/messages',model:'test-model'}}};renderModal('ai-assist');})()`,
    ],
    [
      'live-ai-closed',
      `(async()=>{closeModal();await new Promise(r=>setTimeout(r,260));if(!settingsModal.hidden||document.querySelector('.app-shell').inert||document.body.classList.contains('modal-open'))throw Error('关闭AI选项未恢复会议交互');const r=document.querySelector('#live-view .live-control-bar').getBoundingClientRect();if(r.bottom>innerHeight+1)throw Error('会议操作栏被挤出窗口');})()`,
    ],
  );
  for (const [name, theme, language] of [
    ['subtitle-menu-light', 'light', 'zh'],
    ['subtitle-menu-dark', 'dark', 'zh'],
    ['subtitle-menu-en', 'light', 'en'],
    ['subtitle-menu-de', 'dark', 'de'],
  ]) {
    scenes.push([
      name,
      `(async()=>{closeModal();applyTheme('${theme}');applyLanguage('${language}');await showView('live');meetingActive=true;document.querySelector('.app-shell').classList.add('is-live-meeting');document.querySelector('#live-name').textContent='产品周会';liveNotesEditor.setMarkdown('');const segment={id:'menu-preview',text:'Confirm the release scope and complete the internal review by Friday.',start_ms:135000,end_ms:145000};document.querySelector('#transcript-scroll').innerHTML=renderTranscriptSegment({time:'02:15',startSeconds:135,endSeconds:145,speaker:{name:'张伟'},text:segment.text,showSpeaker:false,segmentId:segment.id});const row=document.querySelector('#transcript-scroll .segment'),anchor=row.querySelector('[data-segment-actions]').getBoundingClientRect();openSegmentContextMenu('menu-preview',segment.id,anchor.right,anchor.bottom,segment);const menu=segmentContextMenu.getBoundingClientRect();if(menu.left<8||menu.right>innerWidth-8||menu.top<8||menu.bottom>innerHeight-8)throw Error('字幕菜单超出窗口');if([...segmentContextMenu.querySelectorAll('button')].some(button=>button.scrollWidth>button.clientWidth+1))throw Error('字幕菜单文案溢出');})()`,
    ]);
  }
  const selectedScenes = process.env.BREVIA_FEEDBACK_CAPTURE_SCENES?.split(',');
  for (const [name, expression] of scenes) {
    if (selectedScenes && !selectedScenes.includes(name)) continue;
    if (name === 'live-ai-short')
      await send('Emulation.setDeviceMetricsOverride', {
        width: 800,
        height: 600,
        deviceScaleFactor: 1,
        mobile: false,
      });
    if (name === 'live-ai-closed') {
      await send('Emulation.clearDeviceMetricsOverride');
      await send('Emulation.setDeviceMetricsOverride', {
        width: 0,
        height: 0,
        deviceScaleFactor: 1 / defaultWindowScale,
        mobile: false,
      });
    }
    console.log('Checking', name);
    if (name === 'detail-reduced-motion')
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    else if (name === 'onboarding-ai') await send('Emulation.setEmulatedMedia', { features: [] });
    if (name.startsWith('settings-sidebar-hover-'))
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: name.endsWith('open') ? 35 : 400,
        y: 100,
      });
    await evaluate(expression);
    await evaluate('document.fonts.ready');
    await delay(250);
    await evaluate(
      `document.getAnimations().forEach(a=>a.effect.getComputedTiming().iterations===Infinity?a.pause():a.finish())`,
    );
    if (
      (name.startsWith('live-ai') && name !== 'live-ai-closed') ||
      name === 'live-summary-config'
    ) {
      await evaluate(
        `(()=>{const root=settingsModal,p=root.querySelector('.modal-panel'),b=root.querySelector('.modal-body'),r=p.getBoundingClientRect();if(getComputedStyle(root).overflowY!=='clip'||document.scrollingElement.scrollHeight>innerHeight+1||r.top<0||r.bottom>innerHeight+1||getComputedStyle(b).overflowY!=='auto'||getComputedStyle(b).overscrollBehaviorY!=='contain')throw Error('AI浮窗仍撑出外层滚动 '+JSON.stringify({classes:root.className,outer:[root.clientHeight,root.scrollHeight],documentHeight:document.scrollingElement.scrollHeight,height:innerHeight,panel:r.toJSON(),body:[b.clientHeight,b.scrollHeight,getComputedStyle(b).overflowY,getComputedStyle(b).overscrollBehaviorY]}));root.scrollTop=100;if(root.scrollTop!==0||root.querySelector('.modal-head').getBoundingClientRect().top<r.top)throw Error('外层浮窗仍可滚动');})()`,
      );
    }
    if (name.startsWith('live-notes-empty')) {
      await evaluate(
        `(()=>{const surface=liveNotesRoot.querySelector('.notes-editor:not([hidden]),.notes-input:not([hidden])');if(!surface||!surface.getClientRects().length||document.querySelector('[data-ai-assist-empty]'))throw Error('空白笔记编辑区异常');})()`,
      );
    }
    if (name.startsWith('polish-'))
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 12 });
    const geometry = await evaluate(
      `({width:innerWidth,height:innerHeight,overflow:document.body.scrollWidth>innerWidth+1,splash:!!document.querySelector('#startup-splash'),sidebar:Object.fromEntries(['.brand','.new-meeting','.import-recording','#all-meetings','#recently-deleted','.workspace-subnav','.workspace-heading','#workspace-selector','.task-stack-toggle','.task-cards','#mobile-nav','.sidebar-settings'].map(selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return [selector,e?{x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight}:null]}))})`,
    );
    if (name.startsWith('live-ai'))
      geometry.modal = await evaluate(
        `(()=>{const root=settingsModal,p=root.querySelector('.modal-panel'),b=root.querySelector('.modal-body');return {outerHeight:root.clientHeight,outerScrollHeight:root.scrollHeight,bodyHeight:b.clientHeight,bodyScrollHeight:b.scrollHeight,panel:p.getBoundingClientRect().toJSON()};})()`,
      );
    assert.equal(geometry.overflow, false, name + ' overflow');
    assert.equal(geometry.splash, false, name + ' startup overlay');
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const png = Buffer.from(shot.data, 'base64');
    // 原生窗口与 zoom 的整数取整最多相差一个像素，不拉伸截图掩盖差异。
    const compact = name === 'live-ai-short';
    assert.ok(Math.abs(png.readUInt32BE(16) - (compact ? 800 : 1280)) <= 1);
    assert.ok(Math.abs(png.readUInt32BE(20) - (compact ? 600 : 800)) <= 1);
    writeFileSync(path.join(output, `${name}.png`), png);
    results.push({ name, ...geometry });
  }
  if (!selectedScenes || selectedScenes.includes('live-notes-empty-disabled')) {
    await evaluate(
      `(()=>{meetingActive=true;applyTheme('light');for(const code of ['zh','en','es','ja','ko','fr','de','ru']){applyLanguage(code);for(const enabled of [false,true]){aiAssistConfig.enabled=enabled;renderAiAssistToggle();for(const mode of ['rich','markdown']){liveNotesEditor.setMode(mode);liveNotesEditor.setMarkdown('');const surface=liveNotesRoot.querySelector('.notes-editor:not([hidden]),.notes-input:not([hidden])');if(!surface||!surface.getClientRects().length||document.querySelector('[data-ai-assist-empty]'))throw Error('空白笔记编辑区异常 '+code+' '+enabled+' '+mode);liveNotesEditor.setMarkdown('核对发布计划');if(!currentNotesMarkdown().includes('核对发布计划'))throw Error('笔记输入失败');liveNotesEditor.setMarkdown('');if(currentNotesMarkdown().trim())throw Error('笔记清空失败');}}}applyLanguage('zh');liveNotesEditor.setMode('rich');})()`,
    );
    console.log('Empty notes: editing, clear and eight languages passed');
  }
  writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(results, null, 2));
  console.log('Feedback capture and behavior checks passed:', results.length);
} catch (error) {
  console.error(error, mainLog.slice(-2000));
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* 已退出。 */
  }
  await delay(400);
  rmSync(sandbox, { recursive: true, force: true });
}
