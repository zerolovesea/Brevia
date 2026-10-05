// Run with: npx electron scripts/test-website-demos.cjs [--record]
// --record refreshes the README images and GIFs from the same website demos.
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const record = process.argv.includes('--record');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const temp = mkdtempSync(join(tmpdir(), 'brevia-demos-'));
app.setPath('userData', join(temp, 'profile'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 750, useContentSize: true, show: false,
    webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  async function load(name, locale) {
    await win.loadFile(join(root, 'website', `demo-${name}${locale === 'en' ? '-en' : ''}.html`), { query: { manual: '1' } });
    await win.webContents.executeJavaScript('document.fonts.ready');
  }
  async function capture(file) {
    await wait(350);
    writeFileSync(file, (await win.webContents.capturePage()).resize({ width: 1200 }).toPNG());
  }
  try {
    for (const locale of ['zh', 'en']) {
      const tour = join(root, 'docs/assets/tour', locale);
      await load('home', locale);
      if (record) await capture(join(root, 'website/assets', `home-${locale === 'zh' ? 'cn' : 'en'}.png`));
      for (const name of ['transcription', 'summary', 'voiceprint', 'caption-bar', 'model-library']) {
        await load(name, locale);
        const result = await win.webContents.executeJavaScript(`(async () => {
          const { engine, timeline } = window.demoDebug;
          timeline.setLoop(false);
          engine.wait = () => Promise.resolve();
          engine.moveCursor = async target => {
            const element = document.querySelector(target);
            if (!element || !element.getClientRects().length) throw new Error('Invisible target: ' + target);
            const r = element.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.top >= innerHeight || r.bottom <= 0)
              throw new Error('Clipped target: ' + target);
          };
          engine.click = engine.hover = async () => {};
          engine.scrollToBottom = async element => { element.scrollTop = element.scrollHeight; };
          for (let loop = 0; loop < 2; loop++) {
            if (loop) timeline.onRestart();
            for (const step of timeline.steps) {
              await timeline.executeStep(step);
              if (step.action === 'setState') await new Promise(r => setTimeout(r, 220));
              if (document.querySelector('#detail-view')) {
                const layout = document.querySelector('.detail-layout').getBoundingClientRect();
                const notes = document.querySelector('.notes').getBoundingClientRect();
                const player = document.querySelector('.player').getBoundingClientRect();
                if (layout.height < 200 || notes.height < 200 || layout.bottom > player.top + 1 || player.bottom > innerHeight)
                  throw new Error('Meeting notes or player clipped');
              }
            }
          }
          const control = document.querySelector('.live-control-bar');
          if (document.querySelector('#live-view') && (!control || control.getBoundingClientRect().bottom > innerHeight))
            throw new Error('Live controls missing or clipped');
          return { shell: document.querySelectorAll('.app-shell').length,
            segments: document.querySelectorAll('.segment').length,
            modal: !!document.querySelector('.summary-modal-overlay'),
            copied: document.querySelector('[data-copy-summary]')?.textContent,
            expanded: !!document.querySelector('.detail-layout.is-summary-mode') };
        })()`);
        assert.equal(result.shell, 1, `${locale}/${name}: shell`);
        if (name === 'summary') {
          assert.equal(result.modal, false);
          assert.equal(result.expanded, true);
          assert.equal(result.copied, '✓');
          // Capture the readable first state, before scrolling to the bottom.
          await win.webContents.executeJavaScript("document.querySelector('.summary-preview').scrollTop = 0");
        }
        if (name === 'transcription') assert.equal(result.segments, 6);
        if (name === 'voiceprint') assert.equal(result.segments, 4);
        if (record) {
          const files = { transcription: '实时会议和翻译.png', summary: '多语言支持与会议纪要.png', voiceprint: '注册声纹识别.png', 'model-library': '模型库.png' };
          if (name === 'model-library') await win.webContents.executeJavaScript("document.querySelector('.modal-body').scrollTop = 0");
          if (files[name]) await capture(join(tour, files[name]));
        }
        console.log(`PASS ${locale}/${name} (two cycles)`);
      }
      await load('ai-assist', locale);
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.live-control-bar').length"), 1);
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.live-header .end-button').length"), 0);
      if (record) {
        const frames = join(temp, locale);
        mkdirSync(frames);
        // Real-time capture: preserve the cursor, typing, and acceptance timings.
        const started = Date.now();
        for (let frame = 0; frame < 160; frame++) {
          await wait(Math.max(0, started + frame * 125 - Date.now()));
          writeFileSync(join(frames, `${String(frame).padStart(4, '0')}.png`), (await win.webContents.capturePage()).resize({ width: 1200 }).toPNG());
          if (frame === 84) writeFileSync(join(tour, locale === 'zh' ? 'AI辅助笔记.png' : 'AI Assist Notes.png'), (await win.webContents.capturePage()).resize({ width: 1200 }).toPNG());
        }
        const encoded = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '8', '-i', join(frames, '%04d.png'),
          '-filter_complex', '[0:v]scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
          '-loop', '0', join(root, 'docs/assets/demo', `ai-assist-${locale}.gif`)], { encoding: 'utf8' });
        assert.equal(encoded.status, 0, encoded.stderr);
      }
      console.log(`PASS ${locale}/ai-assist`);
    }
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await win.loadFile(join(root, 'website/demo-summary.html'));
    await wait(1200);
    assert.equal(await win.webContents.executeJavaScript('demoDebug.timeline.loopEnabled'), false);
    assert.equal(await win.webContents.executeJavaScript('demoDebug.timeline.isRunning'), false);
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.detail-layout.is-summary-mode')"), true);
    console.log('PASS reduced motion');
    win.webContents.debugger.detach();
    for (const width of [1440, 390]) {
      win.setContentSize(width, 844);
      await win.loadFile(join(root, 'website/index-zh.html'));
      await wait(800);
      const frames = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.demo-canvas')).map(canvas => {
        const frame = canvas.querySelector('iframe').getBoundingClientRect();
        return { width: frame.width, expected: canvas.clientWidth, height: frame.height };
      })`);
      assert.equal(frames.length, 7);
      for (const frame of frames) {
        assert.ok(Math.abs(frame.width - frame.expected) < 1, 'Embed must fit the canvas');
        assert.ok(Math.abs(frame.height / frame.width - 750 / 1200) < .01);
      }
      console.log(`PASS website embeds at ${width}px`);
    }
    assert.deepEqual(errors, []);
  } finally {
    win.destroy();
    app.quit();
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => rmSync(temp, { recursive: true, force: true }));
