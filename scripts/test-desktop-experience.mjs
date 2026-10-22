/** 隔离 Electron 验证下一版桌面入口、胶囊与截图，不触碰用户录音。 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.BREVIA_SKIP_E2E === '1') {
  console.log('Desktop experience skipped (BREVIA_SKIP_E2E=1)');
  process.exit(0);
}
const sandbox = path.join(root, '.e2e-tmp', `desktop-${process.pid}`);
const defaultWindowScale = (2 / 3) * 1.15 * 1.1;
const output = path.resolve(
  process.env.BREVIA_FEEDBACK_CAPTURE_DIR || 'output/uiux-next-version-2026-10-20/implementation',
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
const mainPort = await new Promise((resolve) => {
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
    `--inspect=${mainPort}`,
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
const connections = new Set();
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
  connections.add(socket);
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
  const mainSocket = socket;
  const connect = async (target) => {
    const connection = new WebSocket(target.webSocketDebuggerUrl);
    connections.add(connection);
    await new Promise((resolve, reject) => {
      connection.addEventListener('open', resolve);
      connection.addEventListener('error', reject);
    });
    connection.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data),
        item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) item.reject(Error(message.error.message));
      else item.resolve(message.result);
    });
    return connection;
  };
  const inspector = await connect(
    (await (await fetch(`http://127.0.0.1:${mainPort}/json/list`)).json())[0],
  );
  const mainEval = async (expression) => {
    const saved = socket;
    socket = inspector;
    try {
      return await evaluate(expression);
    } finally {
      socket = saved;
    }
  };
  const nativeWindow =
    "process.getBuiltinModule('module').createRequire(process.cwd()+'/electron/main.js')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'))";
  const capture = async (name) => {
    await delay(250);
    if (name === '14-quick-recording-tooltip')
      await evaluate(
        `document.querySelector('#home-view [data-quick-recording]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`,
      );
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, 'base64'));
    results.push(name);
  };
  await evaluate(`(async()=>{await showView('home');})()`);
  assert.ok(await evaluate(`document.querySelector('[data-quick-recording]').checkVisibility()`));
  assert.deepEqual(
    await evaluate(
      `(()=>{const a=getComputedStyle(document.querySelector('#home-view .quick-recording > span:last-child')),b=getComputedStyle(document.querySelector('#home-view [data-prepare-mode="record"]'));return [a.fontSize,a.fontWeight,b.fontSize,b.fontWeight]})()`,
    ),
    ['14px', '500', '14px', '500'],
    '录音按钮文字样式统一',
  );
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-hint]'))`), false);
  await evaluate(
    `(()=>{window.originalLibrary=uiData.meetings;const sample=uiData.meetings[0];uiData.meetings=[['产品体验复盘',0,24,4,true],['设计评审',0,38,3,true],['团队周会',3,56,8,true],['用户访谈',10,32,2,false],['版本规划',12,46,5,true]].map(([title,days,minutes,speakerCount,hasSummary],i)=>({...sample,id:'review-'+i,isExample:false,title,createdAt:new Date(Date.now()-days*86400000-3600000).toISOString(),durationMs:minutes*60000,speakerCount,hasSummary,tags:[]}));renderMeetingList();})()`,
  );
  await capture('01-library');
  const sidebarSizes = `([...document.querySelectorAll('.sidebar :is(.new-meeting,.import-recording,.nav-item,.mobile-sidebar-card)')].map(n=>({font:getComputedStyle(n.querySelector('strong')||n).fontSize,icon:getComputedStyle(n.querySelector('.interface-icon')).width})))`;
  const normalSidebar = await evaluate(sidebarSizes);
  assert.equal(
    await evaluate(`document.querySelector('.sidebar .new-meeting').textContent.trim()`),
    '开始录音',
  );
  const quickButton = await evaluate(
    `document.querySelector('#home-view [data-quick-recording]').getBoundingClientRect().toJSON()`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: quickButton.x + quickButton.width / 2,
    y: quickButton.y + quickButton.height / 2,
  });
  await delay(150);
  assert.equal(
    await evaluate(
      `document.querySelector('.page-tooltip').checkVisibility() && document.querySelector('.page-tooltip').textContent.includes('上次会议')`,
    ),
    true,
    '快速录音悬停说明配置来源',
  );
  assert.equal(
    await evaluate(
      `(()=>{const b=document.querySelector('#home-view [data-quick-recording]');return b.getAttribute('aria-label')||b.textContent.trim()})()`,
    ),
    '快速录音',
  );
  await capture('14-quick-recording-tooltip');
  await evaluate(`hidePageTooltip()`);
  await evaluate(
    `(async()=>{const oldStart=startConfiguredRecording,paths=new Map(modelPaths);try{for(const model of modelCatalog)modelPaths.set(model.id,'/fixture-model');window.quickRoutes=[];startConfiguredRecording=async(payload,mode)=>{window.quickRoutes.push({payload,mode,view:activeView});};await startQuickRecording();if(window.quickRoutes.length!==1||window.quickRoutes[0].mode!=='both'||window.quickRoutes[0].view!=='home'||activeView!=='home')throw Error('快速录音经过了准备页');}finally{startConfiguredRecording=oldStart;modelPaths.clear();for(const [key,value] of paths)modelPaths.set(key,value);}})()`,
  );

  await evaluate(
    `uiData.meetings=window.originalLibrary;delete window.originalLibrary;renderMeetingList();`,
  );
  await evaluate(
    `(async()=>{await showView('settings');const end=Date.now()+5000;while(!desktopPreferences){if(Date.now()>end)throw Error('Preferences unavailable');await new Promise(r=>setTimeout(r,50));}renderDesktopPreferences();})()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-desktop-toggle="autoCapsule"]').checkVisibility()`,
    ),
    true,
  );
  assert.equal(
    await evaluate(
      `Boolean(document.querySelector('[data-desktop-toggle="capsuleOnTop"], [data-reset-capsule]'))`,
    ),
    false,
    '移除置顶与重置位置入口',
  );
  assert.equal(
    await evaluate(
      `(()=>{const rows=[...document.querySelectorAll('#settings-view .settings-preferences > .flow-select')].map(n=>n.getBoundingClientRect());return rows.every(r=>Math.abs(r.width-rows[0].width)<1&&Math.abs(r.right-rows[0].right)<1)})()`,
    ),
    true,
    '通用设置下拉项宽度与右边缘对齐',
  );
  await capture('02-general-settings');
  await evaluate(
    `(async()=>{for(const code of ['zh','en','es','ja','ko','fr','de','ru']){applyLanguage(code);renderDesktopPreferences();const node=document.querySelector('[data-desktop-settings]');if(node.getBoundingClientRect().right>innerWidth+1)throw Error('Settings overflow '+code);}applyLanguage('zh');await saveDesktopPreference('closeBehavior','hide');})()`,
  );
  assert.equal(await evaluate(`desktopPreferences.closeBehavior`), 'hide');
  await mainEval(`${nativeWindow}.close(); true`);
  assert.equal(await mainEval(`${nativeWindow}.isVisible()`), false, '隐藏保留窗口');
  await mainEval(
    `process.getBuiltinModule('module').createRequire(process.cwd()+'/electron/main.js')('electron').app.emit('second-instance'); true`,
  );
  assert.equal(await mainEval(`${nativeWindow}.isVisible()`), true, '再次启动恢复隐藏主窗');
  await evaluate(String.raw`(async()=>{
    window.desktopPauseCalls=[];
    const meeting={id:'desktop-fixture',title:'产品周会',language:'zh',tags:[],workspace_id:null};
    breviaClient.state.meeting=meeting;breviaClient.state.inputs={mic:true,system:false};
    activateMeeting(meeting,meeting);clearInterval(timer);seconds=1122;document.querySelector('#timer').textContent='00:18:42';
    breviaClient.pause=async(value)=>{window.desktopPauseCalls.push(value);};
    aiAssistConfig.enabled=true;aiAssistConfig.proactivity='assist';
    latestAiSuggestion={id:'desktop-suggestion',meeting_id:meeting.id,type:'decision',text:'回看历史字幕时暂停自动跟随，避免新内容打断阅读。'};
    renderAiSuggestion();
    liveNotesEditor.setMarkdown('## 本次决定\n\n- 本次先优化快速录音、字幕阅读与状态反馈。\n\n## 下一步\n\n- 周四交付体验优化稿');
    const entries=[['16:32','字幕保留稳定的历史段落，新增内容集中在底部。','Keep confirmed paragraphs stable and append new content at the bottom.'],['17:05','用户回看旧内容时，新字幕不要把阅读位置拉走。','New captions should not interrupt users reviewing earlier content.'],['17:42','录音胶囊保留拖动和必要操作，下拉面板集中展示当前内容。','Keep the capsule compact and use its panel for reading.'],['18:12','完成讨论后，确认结论与负责人，再同步下一步。','Confirm the decisions, owners and next steps.']];
    document.querySelector('#transcript-scroll').innerHTML=entries.map(([time,text,translation],i)=>renderTranscriptSegment({time,text,translation,speaker:{id:'',name:''},showSpeaker:false,segmentId:'desktop-line-'+i})).join('');
    document.querySelector('#transcript-scroll').insertAdjacentHTML('beforeend',renderTranscriptSegment({time:'18:40',text:'会后把结论和下一步放在更容易看到的位置……',speaker:{id:'',name:''},showSpeaker:false}));
    document.querySelector('#transcript-scroll').lastElementChild.classList.add('is-draft');
    translationAllowed=true;desktopLevel=.6;desktopLevelAt=Date.now();publishDesktopRecording();
  })()`);
  assert.equal(
    await evaluate(
      `([...document.querySelectorAll('#live-view .live-section-head')].every(h=>{const b=h.querySelector('[data-open-correction]'),r=b.getBoundingClientRect(),t=h.querySelector('.eyebrow').getBoundingClientRect();return !b.textContent.trim()&&b.querySelector('svg')&&b.title&&b.getAttribute('aria-label')===b.title&&r.top<t.bottom&&r.bottom>t.top&&r.right<=h.getBoundingClientRect().right+1;}))`,
    ),
    true,
    '查找与替换使用带提示的图标，与各自标题同排',
  );
  await capture('03-live-workspace');
  await evaluate(`document.querySelector('.sidebar .brand').focus()`);
  await delay(350);
  assert.deepEqual(
    await evaluate(sidebarSizes),
    normalSidebar,
    '会议展开侧栏与常规侧栏字号、图标尺寸一致',
  );
  await capture('17-live-sidebar');
  await evaluate(`document.activeElement.blur()`);
  await delay(350);
  const collapsedNavIcons = await evaluate(
    `([...document.querySelectorAll('.sidebar .nav-item .interface-icon')].map(n=>[n.closest('button').id||n.closest('button').className,getComputedStyle(n).width]))`,
  );
  assert.ok(
    collapsedNavIcons.every(([, width]) => Math.abs(parseFloat(width) - 20) < 0.1),
    '收起侧栏不放大导航图标：' + JSON.stringify(collapsedNavIcons),
  );
  await evaluate(`window.quitConfirmation=confirmQuitRecording();true`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  assert.equal(
    await evaluate(`document.activeElement.value`),
    'confirm',
    '退出确认的 Tab 留在弹窗内',
  );
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  assert.equal(await evaluate(`window.quitConfirmation`), false, 'Esc 取消退出');
  await evaluate(`window.quitConfirmation=confirmQuitRecording();true`);
  await delay(250);
  assert.equal(await evaluate(`document.querySelector('#quit-recording-dialog').open`), true);
  assert.equal(
    await evaluate(`document.activeElement.value`),
    'cancel',
    '退出确认默认聚焦继续录音',
  );
  await evaluate(
    `document.querySelector('#quit-recording-dialog').getAnimations({subtree:true}).forEach(a=>a.finish())`,
  );
  assert.equal(
    await evaluate(
      `(()=>{const d=document.querySelector('#quit-recording-dialog'),r=d.getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1&&Math.abs(r.y+r.height/2-innerHeight/2)<1&&Math.abs(d.querySelector('[value="confirm"] svg').getBoundingClientRect().width-16)<.1})()`,
    ),
    true,
    '退出确认居中且包含结束图标',
  );
  await capture('15-quit-recording-confirmation');
  await evaluate(`document.querySelector('#quit-recording-dialog [value="cancel"]').click()`);
  assert.equal(await evaluate(`window.quitConfirmation`), false, '继续录音取消退出');
  await evaluate(
    `window.quitConfirmation=confirmQuitRecording();document.querySelector('#quit-recording-dialog [value="confirm"]').click()`,
  );
  assert.equal(await evaluate(`window.quitConfirmation`), true, '确认结果与保存动作分开验证');

  await evaluate(
    `(async()=>{const d=document.querySelector('#quit-recording-dialog');for(const code of ['zh','en','es','ja','ko','fr','de','ru']){applyLanguage(code);const confirmation=confirmQuitRecording();await document.fonts.ready;d.getAnimations().forEach(a=>a.finish());if(d.scrollWidth>d.clientWidth+1)throw Error('Quit dialog overflow '+code);d.close('cancel');if(await confirmation)throw Error('Cancel changed in '+code);}applyLanguage('zh');})()`,
  );
  await evaluate(
    `(async()=>{document.querySelector('#all-meetings').click();await pageTransition;publishDesktopRecording();})()`,
  );
  assert.equal(
    await evaluate(
      `(()=>{const m=document.querySelector('#mini-meeting'),r=m.getBoundingClientRect(),s=document.querySelector('.sidebar').getBoundingClientRect();return m.checkVisibility()&&m.closest('.sidebar')&&r.left>=s.left&&r.right<=s.right&&r.bottom<=s.bottom&&!document.querySelector('#background-recording')&&document.querySelector('#mini-timer').textContent==='00:18:42'})()`,
    ),
    true,
    '离开会议恢复侧栏中的真实会议卡片，不再覆盖正文',
  );
  await capture('04-background-recording');
  await mainEval(`${nativeWindow}.minimize(); true`);
  let capsule;
  for (let attempt = 0; attempt < 60; attempt++) {
    capsule = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) =>
      target.url.includes('/recording-capsule.html'),
    );
    if (capsule) break;
    await delay(100);
  }
  assert.ok(capsule, '最小化显示独立胶囊');
  const capsuleSocket = await connect(capsule);
  socket = capsuleSocket;
  await send('Runtime.enable');
  await send('Page.enable');
  await delay(300);
  assert.equal(await evaluate(`document.body.dataset.phase`), 'recording');
  const isolated = await evaluate(`window.brevia.desktop.preferences().then(()=>false,()=>true)`);
  assert.equal(isolated, true, '胶囊不能调用主窗口偏好写入权限');
  assert.equal(await evaluate(`document.querySelector('.capsule-grip').checkVisibility()`), true);
  assert.deepEqual(
    await evaluate(
      `(()=>{const pill=document.querySelector('.recording-pill'),r=pill.getBoundingClientRect();return [r.width,r.height,pill.scrollWidth<=pill.clientWidth+1]})()`,
    ),
    [320, 56, true],
    '小号胶囊尺寸且控件不溢出',
  );
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.capsule-pause,.capsule-stop')].every(b=>!b.textContent.trim()&&b.querySelector('svg')&&b.title&&b.getAttribute('aria-label')===b.title)`,
    ),
    true,
    '暂停与结束为带操作提示的纯图标',
  );
  assert.equal(await evaluate(`Boolean(document.querySelector('.capsule-return'))`), false);
  const nativeCapsule =
    "process.getBuiltinModule('module').createRequire(process.cwd()+'/electron/main.js')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/recording-capsule.html'))";
  const defaultBounds = await mainEval(`${nativeCapsule}.getBounds()`);
  const workArea = await mainEval(
    `process.getBuiltinModule('module').createRequire(process.cwd()+'/electron/main.js')('electron').screen.getDisplayMatching(${nativeCapsule}.getBounds()).workArea`,
  );
  assert.equal(defaultBounds.x, Math.round(workArea.x + (workArea.width - 344) / 2));
  assert.equal(
    defaultBounds.y,
    workArea.y + workArea.height - 80 - 32,
    '默认避开 Dock，靠底部显示',
  );
  await evaluate(`window.brevia.desktop.expand({expanded:true})`);
  await delay(300);
  assert.equal(await evaluate(`document.body.dataset.above`), 'true', '底部胶囊向上展开');
  const expandedBounds = await mainEval(`${nativeCapsule}.getBounds()`);
  assert.equal(
    expandedBounds.y + expandedBounds.height,
    defaultBounds.y + 80,
    '向上展开不移动锚点',
  );
  await capture('16-bottom-capsule-preview');
  await evaluate(`window.brevia.desktop.expand({expanded:false})`);
  // 后续继续覆盖屏幕上方的向下展开与跨间隙悬停。
  await evaluate(`window.brevia.desktop.move({dx:0,dy:${workArea.y + 32 - defaultBounds.y}})`);
  await delay(200);
  await evaluate(`document.querySelector('.capsule-identity').click()`);
  assert.equal(await mainEval(`${nativeWindow}.isMinimized()`), true, '标题点击不返回应用');
  const beforeDrag = await mainEval(`${nativeCapsule}.getBounds()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 44 });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 100,
    y: 44,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 124,
    y: 54,
    button: 'left',
    buttons: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 124,
    y: 54,
    button: 'left',
    clickCount: 1,
  });
  await delay(200);
  const afterDrag = await mainEval(`${nativeCapsule}.getBounds()`);
  assert.ok(
    Math.abs(afterDrag.x - beforeDrag.x) > 3 || Math.abs(afterDrag.y - beforeDrag.y) > 3,
    '标题区域可拖动胶囊',
  );
  assert.equal(await mainEval(`${nativeWindow}.isMinimized()`), true, '拖动松手不触发返回');
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    true,
    '拖动松手不触发展开',
  );
  const beforeGrip = await mainEval(`${nativeCapsule}.getBounds()`);
  const grip = await evaluate(
    `(()=>{const r=document.querySelector('.capsule-grip').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: grip.x,
    y: grip.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: grip.x + 10,
    y: grip.y,
    button: 'left',
    buttons: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: grip.x + 10,
    y: grip.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(100);
  const afterGrip = await mainEval(`${nativeCapsule}.getBounds()`);
  assert.ok(Math.abs(afterGrip.x - beforeGrip.x) > 3, '六点握柄仍可拖动');
  const logo = await evaluate(
    `(()=>{const r=document.querySelector('.capsule-logo').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...logo,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...logo,
    button: 'left',
    clickCount: 1,
  });
  await delay(350);
  assert.equal(
    await mainEval(`${nativeWindow}.isVisible() && !${nativeWindow}.isMinimized()`),
    true,
    '点击 Logo 从最小化恢复主窗口',
  );
  await mainEval(`${nativeWindow}.minimize(); true`);
  await delay(200);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await capture('05-capsule-recording');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 280, y: 42 });
  await delay(450);
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    false,
    'hover 展开',
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 280, y: 73 });
  await delay(400);
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    false,
    '跨间隙保持展开',
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 190 });
  await delay(400);
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    false,
    '面板超出胶囊宽度的区域仍保持展开',
  );
  await evaluate(`document.querySelector('#captions-panel').scrollTop=0`);
  await delay(100);
  assert.equal(
    await evaluate(
      `(()=>{const b=document.querySelector('#capsule-follow'),r=b.getBoundingClientRect(),p=document.querySelector('#captions-panel').getBoundingClientRect();return b.checkVisibility()&&!b.textContent.trim()&&b.closest('#captions-panel')&&r.bottom<=p.bottom+1&&!document.querySelector('.capsule-panel footer')})()`,
    ),
    true,
    '上翻后在字幕内显示纯图标跟随按钮，且没有独立底栏',
  );
  await capture('06-hover-captions');
  await evaluate(`document.querySelector('#capsule-follow').click()`);
  await delay(100);
  assert.equal(
    await evaluate(
      `(()=>{const p=document.querySelector('#captions-panel');return document.querySelector('#capsule-follow').hidden&&p.scrollHeight-p.scrollTop-p.clientHeight<24})()`,
    ),
    true,
    '点击图标回到最新并恢复跟随',
  );
  const geometry = await evaluate(
    `(()=>{const p=document.querySelector('.recording-pill').getBoundingClientRect(),r=document.querySelector('#capsule-panel').getBoundingClientRect();return {pill:p.toJSON(),panel:r.toJSON(),scroll:document.querySelector('#captions-panel').scrollHeight,client:document.querySelector('#captions-panel').clientHeight};})()`,
  );
  assert.ok(geometry.panel.bottom <= 470, '面板不越界');
  assert.equal(geometry.panel.width, 440, '缩短胶囊不缩窄展开面板');
  assert.equal(geometry.pill.width, 320);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('#capsule-open'))`),
    false,
    '展开面板不再显示重复的返回入口',
  );
  await evaluate(`document.querySelector('[data-tab="notes"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#notes-panel').hidden`), false);
  await capture('07-hover-notes');
  socket = mainSocket;
  await evaluate(
    `window.desktopSuggestionFixture=latestAiSuggestion;latestAiSuggestion=null;aiAssistToggleButton().classList.remove('is-analyzing');publishDesktopRecording()`,
  );
  await delay(200);
  socket = capsuleSocket;
  assert.equal(
    await evaluate(
      `(()=>{const s=document.querySelector('#capsule-suggestion');return !s.textContent.trim()&&!s.children.length&&document.querySelector('#capsule-ai-state').hidden&&document.querySelector('#capsule-notes').textContent.includes('本次决定')})()`,
    ),
    true,
    '无建议不显示占位或开启状态，保留本场笔记',
  );
  await capture('18-notes-without-suggestion');
  socket = mainSocket;
  await evaluate(`aiAssistToggleButton().classList.add('is-analyzing');publishDesktopRecording()`);
  await delay(200);
  socket = capsuleSocket;
  assert.equal(
    await evaluate(
      `(()=>{const n=document.querySelector('#capsule-ai-state');return n.checkVisibility()&&!n.textContent.trim()&&n.getAttribute('aria-label')==='正在分析…'&&getComputedStyle(n).animationName==='button-spin'&&!document.querySelector('#capsule-suggestion').textContent.trim()})()`,
    ),
    true,
    '正在分析仅显示带辅助名称的真实忙碌动画',
  );
  await capture('19-notes-analyzing');
  await evaluate(`document.querySelector('[data-tab="captions"]').click()`);
  assert.equal(
    await evaluate(
      `(()=>{const n=document.querySelector('.capsule-line[data-draft="true"] .capsule-progress');return n.checkVisibility()&&n.getAttribute('aria-label')==='识别中'&&getComputedStyle(n).animationName==='button-spin'&&!n.closest('article').textContent.includes('识别中')})()`,
    ),
    true,
    '临时字幕使用行内动画图标，不追加识别中文字',
  );
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.capsule-progress')).animationDuration`,
    ),
    '0s',
    '减少动态效果时停止旋转',
  );
  await send('Emulation.setEmulatedMedia', { features: [] });
  socket = mainSocket;
  await evaluate(
    `latestAiSuggestion=window.desktopSuggestionFixture;aiAssistToggleButton().classList.remove('is-analyzing');publishDesktopRecording()`,
  );
  await delay(200);
  socket = capsuleSocket;
  await evaluate(`document.querySelector('[data-tab="notes"]').click()`);
  await evaluate(`window.brevia.desktop.expand({expanded:false})`);
  await delay(180);
  const originalAnchor = await mainEval(`${nativeCapsule}.getBounds()`);
  await evaluate(`window.brevia.desktop.move({dx:10000,dy:0})`);
  const edgeAnchor = await mainEval(`${nativeCapsule}.getBounds()`);
  await evaluate(`window.brevia.desktop.expand({expanded:true})`);
  await delay(180);
  const edgeWindow = await mainEval(`${nativeCapsule}.getBounds()`);
  const edgePill = await evaluate(
    `document.querySelector('.recording-pill').getBoundingClientRect().toJSON()`,
  );
  assert.equal(edgeWindow.x + edgePill.left, edgeAnchor.x + 12, '屏幕右侧展开保持胶囊位置');
  assert.ok(
    Math.abs(
      (await evaluate(`document.querySelector('#capsule-panel').getBoundingClientRect().left`)) -
        12,
    ) < 1,
    '面板校正到窗口边界',
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 190 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 50, y: 42 });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`document.querySelector('#capsule-panel').hidden`)) break;
    await delay(50);
  }
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    true,
    '进入胶囊旁的透明空白会收起面板',
  );
  await evaluate(
    `window.brevia.desktop.move({dx:${originalAnchor.x - edgeAnchor.x},dy:${originalAnchor.y - edgeAnchor.y}})`,
  );
  await evaluate(`window.brevia.desktop.expand({expanded:true})`);
  await delay(180);

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`document.querySelector('#capsule-panel').hidden`)) break;
    await delay(50);
  }
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    true,
    '点击页签后离开仍可收起：' +
      JSON.stringify(
        await evaluate(
          `({hover:document.querySelector('.capsule-shell').matches(':hover'),keyboard:document.documentElement.hasAttribute('data-keyboard-navigation'),focus:document.activeElement.outerHTML})`,
        ),
      ),
  );
  await evaluate(`document.querySelector('#capsule-preview').click()`);
  await delay(300);
  await evaluate(`document.querySelector('[data-action="pause"]').click()`);
  await delay(400);
  assert.equal(await evaluate(`document.body.dataset.phase`), 'paused');
  assert.equal(
    await evaluate(
      `document.querySelector('.capsule-line[data-draft="true"] .capsule-progress').hidden`,
    ),
    true,
    '暂停不继续显示识别动画',
  );
  socket = mainSocket;
  assert.deepEqual(await evaluate(`window.desktopPauseCalls`), [true], '胶囊复用主窗口暂停');
  socket = capsuleSocket;
  await capture('08-capsule-paused');
  await evaluate(`document.querySelector('#capsule-pin').click()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await delay(450);
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    false,
    '固定后离开不收起',
  );
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await delay(200);
  assert.equal(
    await evaluate(`document.querySelector('#capsule-panel').hidden`),
    true,
    'Esc 收起面板',
  );
  socket = mainSocket;
  await evaluate(
    `document.querySelector('#end-meeting').setAttribute('aria-busy','true');publishDesktopRecording();`,
  );
  await delay(180);
  socket = capsuleSocket;
  assert.equal(await evaluate(`document.body.dataset.phase`), 'saving');
  assert.equal(
    await evaluate(`document.querySelector('#capsule-meter').hidden`),
    true,
    '保存中停止电平',
  );
  await capture('10-capsule-saving');
  socket = mainSocket;
  await evaluate(
    `document.querySelector('#end-meeting').removeAttribute('aria-busy');desktopSaveError='保存失败，请重试';publishDesktopRecording();`,
  );
  await delay(180);
  socket = capsuleSocket;
  assert.equal(await evaluate(`document.body.dataset.phase`), 'failed');
  assert.equal(
    await evaluate(`document.querySelector('.capsule-stop').disabled`),
    false,
    '失败保留重试',
  );
  assert.equal(
    await evaluate(`document.querySelector('.capsule-pause').hidden`),
    true,
    '保存失败只保留有效的重试操作',
  );
  assert.equal(
    await evaluate(`document.querySelector('.capsule-stop').getAttribute('aria-label')`),
    '重试保存',
  );
  await capture('11-capsule-save-failed');
  socket = mainSocket;
  await evaluate(
    `(async()=>{meetingActive=false;breviaClient.state.meeting=null;clearTimeout(liveNotesSaveTimer.current);latestAiSuggestion=null;await showView('home');publishDesktopRecording();})()`,
  );
  await mainEval(`${nativeWindow}.restore();${nativeWindow}.show();true`);
  await evaluate(
    `(async()=>{await showView('settings');applyTheme('dark');renderDesktopPreferences();})()`,
  );
  await capture('09-settings-dark');
  await evaluate(String.raw`(async()=>{
    applyTheme('light');const initialized=await window.brevia.initialize();
    const meeting=await window.brevia.meeting.get({meeting_id:initialized.meetings[0].id});
    applyBackendDetail(meeting);detailActiveTab='summary';
    uiData.detail.summary.markdown='## 会议摘要\n\n本次会议确认下一版本的体验优化范围：先缩短开录流程，再改善字幕阅读和处理状态。\n\n## 已确认决定\n\n- 提供快速录音入口，沿用有效的上次设置。\n- 历史字幕保持稳定，新内容在尾部更新。\n\n## 下一步\n\n| 任务 | 负责人 | 截止时间 |\n| --- | --- | --- |\n| 交付体验优化稿 | 设计 | 周四 |\n| 完成快速录音联调 | 开发 | 周五 |\n\n## 详细讨论\n\n录音入口、字幕排版与恢复策略。';
    renderMeetingDetail();await showView('detail');
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll('.summary-reading-section').length`), 3);
  assert.equal(await evaluate(`document.querySelector('.summary-discussion').open`), false);
  await capture('12-meeting-summary');
  await evaluate(
    `uiData.detail.summary.markdown='';uiData.detail.summary.waitingModels=true;renderMeetingDetail();`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.summary-waiting').checkVisibility()`),
    true,
  );
  await capture('13-waiting-model');
  socket = capsuleSocket;
  capsuleSocket.close();
  inspector.close();
  socket = mainSocket;
  writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scenes: results,
        geometry,
        defaultCapsule: { bounds: defaultBounds, workArea, expandedBounds },
        notes: '隔离模拟会话；真实 IPC、窗口、CSS、悬停与暂停动作，不验证实际音频识别。',
      },
      null,
      2,
    ),
  );
  console.log('Desktop experience checks passed:', results.length, 'screenshots');
} catch (error) {
  console.error(error, mainLog.slice(-2000));
  process.exitCode = 1;
} finally {
  for (const connection of connections) connection.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  // 测试会替换会话状态，不能依赖生产退出确认来清理隔离子进程。
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch {}
  } else {
    try {
      const direct = execFileSync('ps', ['-axo', 'pid=,ppid='], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([, parent]) => parent === child.pid)
        .map(([pid]) => pid);
      for (const pid of direct) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
      }
    } catch {}
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(1000)]);
  rmSync(sandbox, { recursive: true, force: true });
}
