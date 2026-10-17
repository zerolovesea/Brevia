// Run with: npx electron scripts/test-website-demos.cjs [--record]
// --record 将官网演示导出到 output/website-demos；README 使用正式应用截图。
const { app, BrowserWindow } = require('electron');
const {
  writeFileSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  cpSync,
  readdirSync,
} = require('node:fs');
const { join, resolve, extname, sep } = require('node:path');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const output = join(root, 'output/website-demos');
const record = process.argv.includes('--record');
const updatePosters = process.argv.includes('--update-posters');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temp = mkdtempSync(join(tmpdir(), 'brevia-demos-'));
app.setPath('userData', join(temp, 'profile'));

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1200,
      height: 750,
      useContentSize: true,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    const errors = [];
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    async function load(name, locale) {
      await win.loadFile(
        join(root, 'website', `demo-${name}${locale === 'en' ? '-en' : ''}.html`),
        { query: { manual: '1' } },
      );
      await win.webContents.executeJavaScript('document.fonts.ready');
      const shell = await win.webContents.executeJavaScript(`({
        deviceEntry: document.querySelectorAll('.sidebar #mobile-nav').length,
        deviceLabel: document.querySelector('.mobile-sidebar-heading strong')?.textContent,
        toolbar: ['app-version', 'language-toggle', 'theme-toggle'].every(id => document.getElementById(id)),
      })`);
      assert.equal(shell.deviceEntry, 1, `${locale}/${name}: device entry missing`);
      assert.equal(shell.deviceLabel, locale === 'zh' ? '设备连接' : 'Device connection');
      assert.equal(shell.toolbar, true, `${locale}/${name}: current toolbar missing`);
    }
    async function capture(file) {
      await wait(350);
      writeFileSync(file, (await win.webContents.capturePage()).resize({ width: 1200 }).toPNG());
    }
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      const deployed = path.startsWith('/__deployed__/');
      const base = deployed ? join(temp, 'site') : root;
      const file = resolve(
        base,
        '.' + decodeURIComponent(deployed ? path.slice('/__deployed__'.length) : path),
      );
      if (!file.startsWith(base + sep)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const data = readFileSync(file);
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
        };
        response
          .writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
          .end(data);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const siteURL = `http://127.0.0.1:${server.address().port}`;
    const waitForMotion = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await win.webContents.executeJavaScript('!!window.productMotion')) return;
        await wait(50);
      }
      throw Error('Motion did not initialize');
    };
    const loadHome = async (language, directory = 'website', hash = '') => {
      await win.webContents.executeJavaScript(
        `sessionStorage.setItem('lang-selected', '${language}')`,
      );
      await win.loadURL(`${siteURL}/${directory}/index-${language}.html${hash ? '#' + hash : ''}`);
    };
    try {
      for (const locale of ['zh', 'en']) {
        const tour = join(output, 'tour', locale);
        if (record) {
          mkdirSync(tour, { recursive: true });
          mkdirSync(join(output, 'demo'), { recursive: true });
        }
        await load('home', locale);
        if (record) await capture(join(output, `home-${locale === 'zh' ? 'cn' : 'en'}.png`));
        for (const name of [
          'transcription',
          'summary',
          'voiceprint',
          'caption-bar',
          'model-library',
        ]) {
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
                const notes = document.querySelector('[data-detail-panel]:not([hidden])').getBoundingClientRect();
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
            await win.webContents.executeJavaScript(
              "document.querySelector('.summary-preview').scrollTop = 0",
            );
          }
          if (name === 'transcription') assert.equal(result.segments, 6);
          if (name === 'voiceprint') {
            assert.equal(result.segments, 4);
            assert.equal(
              await win.webContents.executeJavaScript(
                "!!document.querySelector('#detail-view') && !document.querySelector('#live-view')",
              ),
              true,
            );
            assert.equal(
              await win.webContents.executeJavaScript(
                "document.querySelectorAll('.speaker-name:not(.provisional)').length",
              ),
              4,
            );
          }
          if (['transcription', 'caption-bar'].includes(name))
            assert.equal(
              await win.webContents.executeJavaScript(
                "document.querySelectorAll('.segment-meta b, .segment-speaker').length",
              ),
              0,
            );
          if (record) {
            const files = {
              transcription: '实时会议和翻译.png',
              summary: '多语言支持与会议纪要.png',
              voiceprint: '注册声纹识别.png',
              'model-library': '模型库.png',
            };
            if (name === 'model-library')
              await win.webContents.executeJavaScript(
                "document.querySelector('.modal-body').scrollTop = 0",
              );
            if (files[name]) await capture(join(tour, files[name]));
          }
          console.log(`PASS ${locale}/${name} (two cycles)`);
        }
        await load('ai-assist', locale);
        assert.equal(
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.live-control-bar').length",
          ),
          1,
        );
        assert.equal(
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.live-header .end-button, .segment-speaker').length",
          ),
          0,
        );
        if (record) {
          const frames = join(temp, locale);
          mkdirSync(frames);
          // Real-time capture: preserve the cursor, typing, and acceptance timings.
          const started = Date.now();
          for (let frame = 0; frame < 160; frame++) {
            await wait(Math.max(0, started + frame * 125 - Date.now()));
            writeFileSync(
              join(frames, `${String(frame).padStart(4, '0')}.png`),
              (await win.webContents.capturePage()).resize({ width: 1200 }).toPNG(),
            );
            if (frame === 84)
              writeFileSync(
                join(tour, locale === 'zh' ? 'AI辅助笔记.png' : 'AI Assist Notes.png'),
                (await win.webContents.capturePage()).resize({ width: 1200 }).toPNG(),
              );
          }
          const encoded = spawnSync(
            'ffmpeg',
            [
              '-y',
              '-loglevel',
              'error',
              '-framerate',
              '8',
              '-i',
              join(frames, '%04d.png'),
              '-filter_complex',
              '[0:v]scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
              '-loop',
              '0',
              join(output, 'demo', `ai-assist-${locale}.gif`),
            ],
            { encoding: 'utf8' },
          );
          assert.equal(encoded.status, 0, encoded.stderr);
        }
        if (!record) await wait(1800);
        assert.ok(
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.segment').length > 0",
          ),
        );
        assert.equal(
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.segment-speaker').length",
          ),
          0,
        );
        console.log(`PASS ${locale}/ai-assist`);
      }
      for (const locale of ['zh', 'en']) {
        await win.loadFile(join(root, `website/demo-mobile${locale === 'en' ? '-en' : ''}.html`));
        const mobile = await win.webContents.executeJavaScript(`(() => {
          document.querySelector('#pause-story').click();
          const result = [];
          for (let cycle = 0; cycle < 2; cycle++) {
            for (let stage = 0; stage < 5; stage++) {
              mobileDemo.render(stage);
              result.push({
                stage: document.querySelector('.mobile-story').dataset.stage,
                desktop: document.querySelectorAll('.mobile-demo-caption.visible').length,
                phone: document.querySelector('.phone-transcript p').textContent,
              });
            }
          }
          return result;
        })()`);
        mobile.forEach((state, i) => {
          const stage = i % 5;
          assert.equal(state.stage, String(stage));
          assert.equal(state.desktop, stage >= 3 ? 1 : 0);
          assert.equal(Boolean(state.phone), stage === 4);
        });
        console.log(`PASS ${locale}/mobile (two cycles)`);
      }
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await win.loadFile(join(root, 'website/demo-summary.html'));
      await wait(1200);
      assert.equal(
        await win.webContents.executeJavaScript('demoDebug.timeline.loopEnabled'),
        false,
      );
      assert.equal(await win.webContents.executeJavaScript('demoDebug.timeline.isRunning'), false);
      assert.equal(
        await win.webContents.executeJavaScript(
          "!!document.querySelector('.detail-layout.is-summary-mode')",
        ),
        true,
      );
      console.log('PASS reduced motion');
      win.webContents.debugger.detach();
      for (const locale of ['zh', 'en']) {
        for (const scene of [
          'tour',
          'live',
          'summary',
          'library',
          'phone-live',
          'phone-offline',
          'pair-microphone',
          'pair-field',
        ]) {
          const phone = scene.startsWith('phone-');
          win.setContentSize(phone ? 390 : 1280, phone ? 844 : 800);
          await win.loadURL(
            `${siteURL}/website/product-motion.html?scene=${scene}&lang=${locale}&manual=1`,
          );
          await waitForMotion();
          const states = [];
          for (const time of scene === 'pair-microphone'
            ? [2000, 8000, 26000]
            : scene === 'library'
              ? [1000, 4500, 10500]
              : ['live', 'summary'].includes(scene)
                ? [2000, 6000, 10500]
                : [2000, 8000, 17000]) {
            states.push(
              await win.webContents.executeJavaScript(`(() => {
              productMotion.seek(${time});
              const translation = document.querySelector('#translation-toggle');
              if (translation && !translation.querySelector('svg')) throw Error('Translation control must keep the application icon');
              return { text: document.querySelector('#motion-stage').innerText,
                overflow: document.documentElement.scrollWidth > innerWidth,
                visible: !document.querySelector('.view') || getComputedStyle(document.querySelector('.view.active')).opacity === '1',
                segments: document.querySelectorAll('.segment').length,
                notes: document.querySelectorAll('.notes-editor li').length,
                rows: document.querySelectorAll('.meeting-row').length,
                search: document.querySelector('#meeting-search')?.value,
                summary: document.querySelector('.summary-body')?.innerText,
                collaborationPhase: document.querySelector('.collab-scene')?.dataset.phase,
                appShell: document.querySelector('.collab-desktop iframe')?.contentDocument.querySelectorAll('.app-shell #live-view').length,
                phoneText: document.querySelector('.collab-phone')?.innerText,
                computerText: document.querySelector('.collab-desktop iframe')?.contentDocument.body.innerText,
                summaryWide: !document.querySelector('.detail-layout') || document.querySelector('.final-transcript').getBoundingClientRect().width >= document.querySelector('.detail-layout').getBoundingClientRect().width - 1,
              };
            })()`),
            );
          }
          states.forEach((state) => {
            assert.equal(state.overflow, false, `${locale}/${scene}: motion viewport overflow`);
            assert.equal(state.visible, true);
            assert.equal(
              state.summaryWide,
              true,
              `${locale}/${scene}: summary must use the full reading area`,
            );
          });
          assert.notEqual(
            states[0].text,
            states[1].text,
            `${locale}/${scene}: no functional motion`,
          );
          if (updatePosters && ['tour', 'live', 'summary', 'library'].includes(scene)) {
            const time = { tour: 0, live: 6600, summary: 11500, library: 1000 }[scene];
            await win.webContents.executeJavaScript(
              `productMotion.seek(${time});document.querySelector('.motion-cursor').hidden=true`,
            );
            await wait(180);
            const directory = join(root, 'website/assets/app-ui');
            mkdirSync(directory, { recursive: true });
            writeFileSync(
              join(directory, `${locale}-${scene}.png`),
              (await win.webContents.capturePage()).resize({ width: 1280 }).toPNG(),
            );
          }
          if (scene === 'tour') {
            const flow = await win.webContents.executeJavaScript(`(() => {
              const states = [1000, 2150, 2900, 14000, 26000, 29000].map(time => {
                productMotion.seek(time);
                return {phase: document.querySelector('#motion-stage').dataset.tourPhase,
                  title: document.querySelector('#meeting-title').value,
                  options: !document.querySelector('#capture-mode-mount .flow-select-options').hidden,
                  notes: document.querySelectorAll('.notes-editor li').length,
                  summary: document.querySelector('.summary-body')?.innerText};
              });
              return {duration:productMotion.duration, states};
            })()`);
            assert.equal(flow.duration, 28000);
            assert.deepEqual(
              flow.states.map((state) => state.phase),
              ['home', 'prepare', 'prepare', 'live', 'summary', 'home'],
            );
            assert.ok(flow.states[1].title.length > 0, 'Tour types the meeting title');
            assert.equal(flow.states[2].options, true, 'Audio source cards stay visible');
            for (const height of [720, 800]) {
              win.setContentSize(1280, height);
              await win.webContents.executeJavaScript('productMotion.seek(2900)');
              await wait(80);
              const prepare = await win.webContents.executeJavaScript(`(() => {
                const view = document.querySelector('#prepare-view');
                const source = view.querySelector('fieldset').getBoundingClientRect();
                const status = view.querySelector('.prepare-input-status').getBoundingClientRect();
                const button = view.querySelector('.primary-action').getBoundingClientRect();
                return {
                  heading: view.querySelector('h1').textContent,
                  fields: [...view.querySelectorAll('.form-grid input')].map(input => input.name),
                  extras: [...view.querySelectorAll('[data-prepare-extra-settings] input')].map(input => input.name),
                  sources: [...view.querySelectorAll('[role=radio]')].map(button => button.dataset.value),
                  selected: view.querySelector('[role=radio][aria-checked=true]')?.dataset.value,
                  dropdowns: view.querySelectorAll('#capture-mode-mount .flow-select-toggle:not([hidden])').length,
                  language: view.querySelector('[name=meeting-language]').value,
                  model: view.querySelector('[name=refined-model]').value,
                  recordIcon: !!view.querySelector('.primary-action .interface-icon'),
                  libraryActive: document.querySelector('#all-meetings').classList.contains('active'),
                  fits: source.bottom <= status.top && status.bottom <= button.top && button.bottom <= innerHeight,
                };
              })()`);
              assert.equal(prepare.heading, locale === 'zh' ? '新建会议' : 'New meeting');
              assert.deepEqual(prepare.fields, [
                'meeting-workspace',
                'meeting-language',
                'translation-target',
              ]);
              assert.deepEqual(prepare.extras, ['meeting-speakers', 'refined-model']);
              assert.deepEqual(prepare.sources, ['mic', 'system', 'both', 'phone']);
              assert.equal(prepare.selected, 'both');
              assert.equal(prepare.dropdowns, 0, 'Sources use official radio cards');
              assert.equal(prepare.language, locale === 'zh' ? 'zh' : 'auto');
              assert.equal(
                prepare.model,
                locale === 'zh' ? 'funasr-nano-mlx' : 'parakeet-tdt-0.6b-v3-mlx',
              );
              assert.equal(prepare.recordIcon, true);
              assert.equal(
                prepare.libraryActive,
                false,
                'Only Start meeting is selected in the sidebar',
              );
              assert.equal(
                prepare.fits,
                true,
                `${locale}/prepare: sources, levels and record button must fit at ${height}px`,
              );
            }
            const prepareCapture = join(root, 'output/playwright/affine-implementation');
            mkdirSync(prepareCapture, { recursive: true });
            await capture(join(prepareCapture, `prepare-${locale}.png`));
            assert.equal(flow.states[3].notes, 1, 'Tour demonstrates note acceptance once');
            assert.ok(flow.states[4].summary.includes(locale === 'zh' ? '行动项' : 'Action items'));
            assert.equal(flow.states[5].notes, 0, 'Tour resets notes when the next meeting starts');
          }
          if (scene === 'live') {
            assert.equal(states[2].segments, 5);
            assert.equal(states[2].notes, 1);
            const ordering = await win.webContents.executeJavaScript(`(() => {
              productMotion.seek(3500);
              const source = document.querySelector('#transcript-scroll').innerText;
              const noEarlyNotes = document.querySelectorAll('.notes-editor li').length === 0 && document.querySelector('[data-ai-suggestion]').hidden;
              productMotion.seek(4400);
              return {noEarlyNotes, sourceUnchanged:source === document.querySelector('#transcript-scroll').innerText,
                suggestion:!document.querySelector('[data-ai-suggestion]').hidden};
            })()`);
            assert.equal(
              ordering.noEarlyNotes,
              true,
              'Transcript must finish before AI extraction begins',
            );
            assert.equal(ordering.sourceUnchanged, true, 'AI reviews completed source text');
            assert.equal(ordering.suggestion, true);
            const acceptance = await win.webContents.executeJavaScript(
              `(()=>{productMotion.seek(5000);const before=document.querySelector('.notes-editor').innerText;const label=document.querySelector('.ai-suggestion-type').textContent;productMotion.seek(5200);return {before,after:document.querySelector('.notes-editor').innerText,label,checkboxes:document.querySelectorAll('.notes-editor input[type=checkbox]').length,headings:document.querySelectorAll('.notes-editor h2').length,flying:document.querySelectorAll('.motion-accepted-note').length}})()`,
            );
            assert.equal(
              acceptance.before.includes(locale === 'zh' ? '既定范围' : 'agreed'),
              false,
            );
            assert.ok(acceptance.after.includes(locale === 'zh' ? '既定范围' : 'agreed'));
            assert.equal(acceptance.label, locale === 'zh' ? '可能的决策' : 'Possible decision');
            assert.equal(acceptance.checkboxes, 0);
            assert.equal(acceptance.headings, 0);
            assert.equal(acceptance.flying, 0);
            const repeatedAccepts = await win.webContents.executeJavaScript(`(() => {
              return [6300,7700,9100,11000].map(time => {
                productMotion.seek(time);
                return {suggestion:!document.querySelector('[data-ai-suggestion]').hidden,
                  cursor:!document.querySelector('.motion-cursor').hidden,
                  notes:document.querySelectorAll('.notes-editor li').length};
              });
            })()`);
            repeatedAccepts.forEach((state) => {
              assert.equal(state.suggestion, false, 'No repeated suggestion after acceptance');
              assert.equal(state.cursor, false, 'No repeated confirmation click');
              assert.equal(state.notes, 1, 'Keep the accepted note visible');
            });
            const acceptedUI = await win.webContents.executeJavaScript(`(() => {
              productMotion.seek(6600);
              const root=document.querySelector('[data-live-notes-root]');
              return {suggestionInside:root.contains(document.querySelector('[data-ai-suggestion]')),
                toolbarHidden:root.querySelector('.notes-toolbar').hidden,
                toast:document.querySelector('#toast.visible')?.innerText};
            })()`);
            assert.equal(
              acceptedUI.suggestionInside,
              true,
              'Suggestions share the official notes surface',
            );
            assert.equal(
              acceptedUI.toolbarHidden,
              true,
              'Notes toolbar starts collapsed in the app',
            );
            assert.equal(acceptedUI.toast, locale === 'zh' ? '已加入笔记' : 'Added to notes');
            await capture(
              join(root, 'output/playwright/affine-implementation', `notes-added-${locale}.png`),
            );
          }
          if (scene === 'tour') {
            const choreography = await win.webContents.executeJavaScript(`(() => {
              const at = 9750;
              const cursor = document.querySelector('.motion-cursor');
              productMotion.seek(at);
              const first = cursor.style.transform;
              const clicking = cursor.dataset.clicking === 'true' && getComputedStyle(cursor, '::before').display === 'block';
              const target = document.querySelector('[data-ai-accept]');
              const pointer = cursor.getBoundingClientRect(), button = target.getBoundingClientRect();
              const hitsTarget = pointer.left >= button.left - 1 && pointer.left <= button.right + 1 && pointer.top >= button.top - 1 && pointer.top <= button.bottom + 1;
              productMotion.seek(2000);
              productMotion.seek(at);
              return {first, repeated: cursor.style.transform, clicking, hitsTarget};
            })()`);
            assert.equal(
              choreography.first,
              choreography.repeated,
              'Cursor seeks deterministically',
            );
            assert.equal(choreography.clicking, true, `${locale}/${scene}: click ripple missing`);
            assert.equal(
              choreography.hitsTarget,
              true,
              `${locale}/${scene}: cursor misses its target`,
            );
          }
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelector('.motion-camera') === null",
            ),
            true,
            `${locale}/${scene}: demos must not zoom or pan`,
          );
          if (scene === 'summary') {
            const layout = await win.webContents.executeJavaScript(`(() => {
              productMotion.seek(6000);
              const view = document.querySelector('#detail-view');
              const header = view.querySelector('.detail-layout').getBoundingClientRect().top - view.getBoundingClientRect().top;
              return { header, roster: view.querySelectorAll('.detail-head .summary-participant-preview-person').length,
                overflow: view.querySelector('.final-transcript').scrollWidth > view.querySelector('.final-transcript').clientWidth,
                panel: view.querySelector('[data-detail-panel="summary"]').classList.contains('detail-summary-panel'),
                opaque: [0,100,11990,12000].every(time => {productMotion.seek(time);return getComputedStyle(document.querySelector('#motion-stage')).opacity === '1'})};
            })()`);
            assert.ok(layout.header < 160, `${locale}: detail header must remain compact`);
            assert.equal(layout.roster, 3);
            assert.equal(layout.panel, true);
            assert.equal(layout.overflow, false);
            assert.equal(layout.opaque, true, 'Demo loops must never fade the entire app');
          }
          if (scene === 'summary') {
            assert.equal(
              states[0].summary,
              undefined,
              'Summary text is absent while the task runs',
            );
            const generation = await win.webContents.executeJavaScript(`(() => {
              return [500,1200,3000,5000,5300,8000,12500].map(time => {
                productMotion.seek(time);
                const task=document.querySelector('#summary-progress');
                return {body:document.querySelector('.summary-body')?.innerText,
                  taskVisible:!task.hidden, inSidebar:!!task.closest('.sidebar #task-cards'),
                  progress:Number(task.querySelector('[role=progressbar]').getAttribute('aria-valuenow')),
                  step:task.dataset.stage, canGenerate:!!document.querySelector('[data-generate-summary]:not([disabled])'),
                  canCopy:!!document.querySelector('[data-copy-summary]'),
                  pending:!!document.querySelector('.summary-actions button[disabled]')};
              });
            })()`);
            assert.equal(generation[0].taskVisible, false);
            assert.equal(generation[0].canGenerate, true);
            generation.slice(1, 4).forEach((state) => {
              assert.equal(state.taskVisible, true);
              assert.equal(state.inSidebar, true);
              assert.equal(state.body, undefined, 'No partial summary before task completion');
              assert.equal(state.canCopy, false);
              assert.equal(state.pending, true);
            });
            assert.ok(
              generation[1].progress < generation[2].progress &&
                generation[2].progress < generation[3].progress,
            );
            assert.deepEqual(
              generation.slice(1, 5).map((state) => state.step),
              ['summary.prepare', 'summary.generating', 'summary.saving', 'summary.complete'],
            );
            assert.equal(generation[4].progress, 100);
            assert.equal(generation[4].canCopy, true);
            assert.equal(generation[4].pending, false);
            assert.equal(
              generation[4].body,
              generation[5].body,
              'Completed summary appears in full',
            );
            assert.equal(generation[6].body, undefined, 'Loop clears the previous summary');
            assert.equal(generation[6].taskVisible, false);
            for (const [name, time] of [
              ['task', 3000],
              ['complete', 6000],
            ]) {
              await win.webContents.executeJavaScript(`productMotion.seek(${time})`);
              await capture(
                join(
                  root,
                  'output/playwright/affine-implementation',
                  `summary-${name}-${locale}.png`,
                ),
              );
            }
            assert.ok(states[2].summary.includes(locale === 'zh' ? '行动项' : 'Action items'));
          }
          if (scene === 'library') {
            assert.equal(states[1].rows, 1);
            assert.equal(states[2].rows, 4);
            assert.equal(states[1].search, locale === 'zh' ? '产品' : 'Product');
          }
          if (scene.startsWith('pair-')) {
            assert.equal(states[2].appShell, 1, 'Desktop screen must use the actual app shell');
            const word = locale === 'zh' ? '周四' : 'Thursday';
            assert.ok(states[2].computerText.includes(word));
            if (scene === 'pair-microphone') {
              assert.equal(states[0].collaborationPhase, 'scan');
              assert.equal(
                states[2].phoneText.includes(word),
                false,
                'Computer-initiated microphone sessions keep text on desktop',
              );
              const confirmation = await win.webContents.executeJavaScript(
                "productMotion.seek(4200);!document.querySelector('.collab-approval').hidden&&!document.querySelector('.collab-desktop iframe').contentDocument.querySelector('#mobile-approval').hidden",
              );
              assert.equal(confirmation, true, 'Scanning must lead to desktop approval');
              const actions = await win.webContents.executeJavaScript(
                `(()=>{const child=document.querySelector('.collab-desktop iframe').contentDocument;productMotion.seek(500);const tap=!document.querySelector('.collab-connect').hidden;productMotion.seek(2200);const aligning=document.querySelector('.collab-scene').dataset.scanAction;productMotion.seek(3500);const locked=document.querySelector('.collab-scene').dataset.scanAction;productMotion.seek(5000);const phoneCode=document.querySelector('.collab-verification').textContent,computerCode=child.querySelector('.mobile-verification').textContent;productMotion.seek(9000);const expanded=child.querySelector('#phone-device-mount .flow-select-toggle').getAttribute('aria-expanded');const choice=child.querySelector('#phone-device-mount [data-flow-select-choice]').textContent;productMotion.seek(10500);return {tap,aligning,locked,phoneCode,computerCode,expanded,choice,selected:child.querySelector('.capture-source-list [data-value=phone]').getAttribute('aria-checked'),closed:child.querySelector('#phone-device-mount .flow-select-options').hidden}})()`,
              );
              assert.equal(actions.tap, true);
              assert.equal(actions.aligning, 'align');
              assert.equal(actions.locked, 'locked');
              assert.match(actions.phoneCode, /^[A-F0-9]{8}$/);
              assert.equal(actions.phoneCode, actions.computerCode);
              assert.equal(actions.expanded, 'true');
              assert.ok(actions.choice.includes('iPhone'));
              assert.equal(actions.selected, 'true');
              assert.equal(actions.closed, true);
            } else {
              assert.equal(states[0].collaborationPhase, 'ready');
              assert.equal(states[1].collaborationPhase, 'recording');
              assert.equal(states[2].collaborationPhase, 'return');
              assert.ok(
                states[2].phoneText.includes(word),
                'Phone-initiated sessions return computed text to phone',
              );
            }
          }
          const repeated = await win.webContents.executeJavaScript(
            `(() => { productMotion.seek(productMotion.duration + ${scene === 'library' ? 1000 : 2000}); return document.querySelector('#motion-stage').innerText; })()`,
          );
          assert.equal(
            repeated,
            states[0].text,
            `${locale}/${scene}: loop must reset without accumulating content`,
          );
          console.log(`PASS motion ${locale}/${scene} (progress and loop)`);
        }
        const shots = {};
        for (const shot of ['captions', 'notes']) {
          win.setContentSize(1280, 800);
          await win.loadURL(
            `${siteURL}/website/product-motion.html?scene=live&shot=${shot}&lang=${locale}&manual=1`,
          );
          await waitForMotion();
          shots[shot] = await win.webContents.executeJavaScript(`(() => {
            const sample = time => {
              productMotion.seek(time);
              return {source:document.querySelector('#transcript-scroll').innerText,
                notes:document.querySelectorAll('.notes-editor li').length,
                suggestion:!document.querySelector('[data-ai-suggestion]').hidden,
                translations:document.querySelectorAll('#transcript-scroll .translation').length,
                captionMode:document.querySelector('.live-layout').classList.contains('is-caption-mode')};
            };
            return [sample(500),sample(1100),sample(1900),sample(7000)];
          })()`);
        }
        assert.ok(
          shots.captions[3].source.length > shots.captions[0].source.length,
          'Transcription streams new utterances',
        );
        assert.equal(shots.captions[0].translations, 0);
        assert.equal(shots.captions[3].translations, 5, 'Translation follows enabling the feature');
        assert.equal(shots.captions[3].captionMode, true);
        assert.ok(
          shots.captions.every((state) => state.notes === 0 && !state.suggestion),
          'Transcription must not duplicate the AI notes demo',
        );
        assert.ok(
          shots.notes.every((state) => state.source === shots.notes[0].source),
          'AI notes use stable, completed evidence',
        );
        assert.equal(shots.notes[1].notes, 0, 'A suggestion is not a saved note');
        assert.equal(shots.notes[1].suggestion, true);
        assert.equal(shots.notes[2].notes, 1, 'Only accepting a suggestion adds it to the notes');
        assert.equal(shots.notes[3].notes, 1);
        assert.equal(
          shots.notes[3].suggestion,
          false,
          'AI notes demo accepts only one suggestion per cycle',
        );
        assert.equal(shots.notes[3].captionMode, false);
        console.log(`PASS differentiated transcription and AI review ${locale}`);
      }
      const captures = join(root, 'output/playwright/affine-implementation');
      mkdirSync(captures, { recursive: true });
      async function waitForPlayer(selector) {
        for (let attempt = 0; attempt < 120; attempt++) {
          if (
            await win.webContents.executeJavaScript(
              `!!document.querySelector('${selector} iframe')?.contentWindow.productMotion`,
            )
          )
            return;
          await wait(30);
        }
        throw Error(`Player did not load: ${selector}`);
      }
      for (const locale of ['zh', 'en']) {
        for (const width of [320, 375, 390, 696, 768, 1024, 1280, 1440]) {
          win.setContentSize(width, 900);
          await loadHome(locale);
          await win.webContents.executeJavaScript(`(async () => {
            document.querySelectorAll('img').forEach(image => image.loading = 'eager');
            await Promise.all([...document.images].map(image => image.decode()));
            await document.fonts.ready;
          })()`);
          const page = await win.webContents.executeJavaScript(`({
            overflow: document.documentElement.scrollWidth > innerWidth,
            headerFits: [...document.querySelectorAll('.header-inner > *, .header-actions > *')].filter(element => element.getClientRects().length).every(element => {const rect = element.getBoundingClientRect();return rect.left >= 0 && rect.right <= innerWidth;}),
            headings: document.querySelectorAll('h1').length,
            motions: document.querySelectorAll('[data-motion-scene]').length,
            staticApplicationImages: document.querySelectorAll('.privacy-app img[src*="/app-ui/"][src*="-models.png"]').length,
            missingAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(link => !document.getElementById(link.hash.slice(1))).map(link => link.hash),
            downloads: [...document.querySelectorAll('.platform-row a')].map(link => link.href),
            sticky: getComputedStyle(document.querySelector('.site-header')).position,
            featureSections: [...document.querySelectorAll('[data-story-panel]')].every(panel => panel.getBoundingClientRect().height > 0 && !panel.hasAttribute('aria-hidden')),
            softwareBrands: document.querySelectorAll('.software-group:not([aria-hidden]) .software-brand').length,
            icons: [...document.querySelectorAll('use')].every(use => ['./icons.svg#', './sketches.svg#'].some(prefix => use.getAttribute('href').startsWith(prefix))),
            qrWidths: [...document.querySelectorAll('.qr-link img')].map(img=>img.getBoundingClientRect().width),
            mobileFirst: getComputedStyle(document.querySelector('#mobile-download')).order,
          })`);
          assert.equal(page.overflow, false, `${locale}/${width}: horizontal overflow`);
          assert.equal(page.headerFits, true, `${locale}/${width}: header clipped`);
          assert.equal(page.headings, 1);
          assert.deepEqual(
            page.qrWidths,
            width < 640 ? [0, 0] : [128, 128],
            'Desktop QR codes stay secondary; phones use direct download buttons',
          );
          const downloadLayout = await win.webContents.executeJavaScript(`(() => {
            const rows = [...document.querySelectorAll('.platform-row')];
            return {
              readable: [...document.querySelectorAll('.platform-name')].every(name => name.getBoundingClientRect().width >= 140),
              linksFit: rows.every(row => [...row.querySelectorAll('a')].filter(link => link.getClientRects().length).every(link => {const a = link.getBoundingClientRect(), r = row.getBoundingClientRect();return a.left >= r.left && a.right <= r.right + 1 && link.scrollWidth <= link.clientWidth + 1})),
              mobileActions: document.querySelectorAll('#mobile-download .platform-name > .button').length,
              heights: rows.map(row => row.getBoundingClientRect().height),
              stacked: document.querySelector('#mobile-download').getBoundingClientRect().top > document.querySelector('.download-column').getBoundingClientRect().bottom,
            };
          })()`);
          assert.equal(downloadLayout.readable, true, `${locale}/${width}: platform text squeezed`);
          assert.equal(
            downloadLayout.linksFit,
            true,
            `${locale}/${width}: download button clipped`,
          );
          assert.equal(downloadLayout.mobileActions, 2);
          if (width >= 640)
            assert.ok(
              Math.max(...downloadLayout.heights) - Math.min(...downloadLayout.heights) < 1,
              `${locale}/${width}: download row proportions differ`,
            );
          if (width >= 640 && width < 1000)
            assert.equal(
              downloadLayout.stacked,
              true,
              'Tablet download groups stack before text gets cramped',
            );
          assert.equal(page.motions, 7);
          assert.equal(
            page.staticApplicationImages,
            1,
            'Privacy section includes the real model library',
          );
          assert.equal(page.featureSections, true);
          if (width >= 1000) {
            const splitLayout = await win.webContents
              .executeJavaScript(`['#transcription','#notes','#minutes','#mobile-microphone','#mobile-field','#library'].every(selector => {
              const panel = document.querySelector(selector);
              const copy = panel.querySelector('.scene-copy,.collaboration-copy,.section-intro').getBoundingClientRect();
              const visual = panel.querySelector('.scene-visual,.collaboration-visual,.library-visual').getBoundingClientRect();
              return visual.left > copy.right && Math.min(copy.bottom, visual.bottom) > Math.max(copy.top, visual.top);
            })`);
            assert.equal(
              splitLayout,
              true,
              `${locale}/${width}: feature text must sit left of its application window`,
            );
          }

          const artwork = await win.webContents.executeJavaScript(`(() => {
            const image = document.querySelector('.privacy-app');
            const parent = image.closest('.privacy-local').getBoundingClientRect();
            const box = image.getBoundingClientRect();
            return {transform:getComputedStyle(image).transform, fits:box.left >= parent.left && box.right <= parent.right + 1,
              connections:document.querySelectorAll('.connected-art,.connection-arm').length,
              note:!!document.querySelector('.note-paper h4')};
          })()`);
          assert.equal(artwork.transform, 'none', 'Model library stays upright');
          assert.equal(artwork.fits, true, `${locale}/${width}: model library clipped`);
          assert.equal(
            artwork.connections,
            0,
            'Workflow uses readable notes instead of diagram chrome',
          );
          assert.equal(artwork.note, true);

          assert.equal(page.softwareBrands, 20);
          assert.equal(page.icons, true);
          assert.deepEqual(page.missingAnchors, []);
          assert.ok(page.downloads.some((url) => url.endsWith('.dmg')));
          assert.ok(page.downloads.some((url) => url.endsWith('-setup.exe')));
          assert.ok(page.downloads.includes('https://apps.apple.com/app/id6819869442'));
          assert.ok(page.downloads.some((url) => url.endsWith('/android/Brevia-android.apk')));
          assert.equal(page.sticky, 'sticky');
          if (width < 640) assert.equal(page.mobileFirst, '-1');
          await waitForPlayer('.hero-visual');
          const assetVersions = await win.webContents.executeJavaScript(`(() => {
            const frame = document.querySelector('.hero-visual iframe');
            const urls = [...document.querySelectorAll('link[href*="landing.css"],script[src*="landing.js"]')].map(element => element.href || element.src);
            urls.push(frame.src, ...[...frame.contentDocument.querySelectorAll('link[href*="-motion.css"],script[src*="-motion.js"]')].map(element => element.href || element.src));
            return {count:urls.length, versioned:urls.every(url => new URL(url).searchParams.has('v'))};
          })()`);
          assert.equal(assetVersions.count, 7);
          assert.equal(
            assetVersions.versioned,
            true,
            'Returning visitors must receive the matching styles and scripts',
          );
          const beforeMotion = await win.webContents.executeJavaScript(
            "document.querySelector('.hero-visual iframe').contentWindow.productMotion.elapsed",
          );
          await wait(160);
          assert.ok(
            (await win.webContents.executeJavaScript(
              "document.querySelector('.hero-visual iframe').contentWindow.productMotion.elapsed",
            )) > beforeMotion,
            'Visible hero should play',
          );
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelectorAll('.demo-controls,.software-footer,.scene-hint,[data-motion-toggle],[data-motion-replay],[data-software-toggle]').length",
            ),
            0,
            'Demo labels and controls must be removed',
          );
          assert.equal(
            await win.webContents.executeJavaScript(
              '/示例会议|真实组件演示|暂停滚动|Sample meeting|Real interface|Pause scrolling|System-audio permission required/.test(document.body.innerText)',
            ),
            false,
            'Demo meta copy must be removed in both languages',
          );
          if ([390, 1440].includes(width)) {
            writeFileSync(
              join(captures, `${locale}-${width}-hero.png`),
              (await win.webContents.capturePage()).resize({ width }).toPNG(),
            );
          }
          await win.webContents.executeJavaScript(
            "document.querySelector('[data-story]').scrollIntoView({behavior:'instant'})",
          );
          for (const target of ['transcription', 'notes', 'minutes']) {
            await win.webContents.executeJavaScript(
              `document.querySelector('#${target}').scrollIntoView({behavior:'instant',block:'center'})`,
            );
            await wait(450);
            await waitForPlayer(`#${target}`);
            const state = await win.webContents.executeJavaScript(`(() => {
              const panel = document.querySelector('#${target}');const demo = panel.querySelector('[data-motion-scene]');
              const frame = demo.querySelector('iframe');const bounds=frame.getBoundingClientRect();
              return {visible:getComputedStyle(panel).visibility, running:frame.contentWindow.productMotion.running, noCrop:bounds.width <= demo.clientWidth + 1 && bounds.height <= demo.clientHeight + 1,
                focus: frame.contentDocument.body.dataset.focus, sidebar: getComputedStyle(frame.contentDocument.querySelector('.sidebar')).display, text:frame.contentDocument.querySelector('#motion-stage').innerText};
            })()`);
            assert.equal(
              state.visible,
              'visible',
              `${locale}/${width}/${target}: visible product section`,
            );
            assert.equal(state.running, true);
            assert.equal(state.noCrop, true);
            assert.equal(state.focus, '', 'Product scenes must keep the complete application');
            assert.notEqual(
              state.sidebar,
              'none',
              'Product scenes include the application sidebar',
            );
            assert.ok(state.text.includes(locale === 'zh' ? '产品周会' : 'Product sync'));
            if (target === 'transcription') {
              await win.webContents.executeJavaScript(
                "document.querySelector('#transcription iframe').contentWindow.productMotion.seek(7500)",
              );
            }
            if (target === 'notes') {
              const effect = await win.webContents.executeJavaScript(
                `(() => {const frame=document.querySelector('#notes iframe');frame.contentWindow.productMotion.seek(1650);const d=frame.contentDocument;return {cursor:!d.querySelector('.motion-cursor').hidden,suggestion:d.querySelector('.ai-suggestion-text').textContent};})()`,
              );
              assert.equal(effect.cursor, true);
              assert.ok(effect.suggestion.includes(locale === 'zh' ? '既定范围' : 'agreed'));
              await win.webContents.executeJavaScript(
                "document.querySelector('#notes iframe').contentWindow.productMotion.seek(1900)",
              );
            }
            if ([390, 1440].includes(width)) {
              await wait(80);
              writeFileSync(
                join(captures, `${locale}-${width}-${target}.png`),
                (await win.webContents.capturePage()).resize({ width }).toPNG(),
              );
            }
          }
          await win.webContents.executeJavaScript(
            "document.querySelector('.software-section').scrollIntoView({behavior:'instant',block:'center'})",
          );
          await wait(100);
          const software = await win.webContents.executeJavaScript(`(() => {
            const brands = [...document.querySelectorAll('.software-brand')];
            const boxes = brands.map(brand => brand.getBoundingClientRect());
            return {
              duplicates: document.querySelectorAll('.software-group[aria-hidden]').length,
              overlap: boxes.some((box, i) => boxes.some((other, j) => i !== j && box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)),
              labelsFit: brands.every(brand => brand.scrollWidth <= brand.clientWidth),
              animation: getComputedStyle(document.querySelector('.software-group')).animationName,
            };
          })()`);
          assert.equal(software.duplicates, 2, 'Each row has one hidden seamless-loop copy');
          assert.equal(software.overlap, false, `${locale}/${width}: software logos overlap`);
          assert.equal(software.labelsFit, true, `${locale}/${width}: software labels clipped`);
          assert.equal(software.animation, 'software-travel');
          const wallSelector = "document.querySelector('.software-group')";
          const beforeScroll = await win.webContents.executeJavaScript(
            `getComputedStyle(${wallSelector}).transform`,
          );
          await wait(100);
          assert.notEqual(
            await win.webContents.executeJavaScript(`getComputedStyle(${wallSelector}).transform`),
            beforeScroll,
            'Visible software rows scroll',
          );
          const overlapsAtLoop = await win.webContents.executeJavaScript(`(() => {
            const groups = [...document.querySelectorAll('.software-group')];
            return [0, 0.5, 0.9999].some(progress => {
              groups.forEach(group => group.getAnimations().forEach(animation => animation.currentTime = animation.effect.getTiming().duration * progress));
              const boxes = [...document.querySelectorAll('.software-brand')].map(brand => brand.getBoundingClientRect());
              return boxes.some((box, i) => boxes.some((other, j) => i !== j && box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top));
            });
          })()`);
          assert.equal(
            overlapsAtLoop,
            false,
            `${locale}/${width}: logos overlap around loop boundary`,
          );
          await win.webContents.executeJavaScript(
            "document.querySelector('.software-wall').focus({preventScroll:true})",
          );
          assert.equal(
            await win.webContents.executeJavaScript(
              `getComputedStyle(${wallSelector}).animationPlayState`,
            ),
            'paused',
            'Keyboard focus pauses logos',
          );
          await win.webContents.executeJavaScript(
            "document.activeElement.blur();Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))",
          );
          await wait(60);
          const hiddenScroll = await win.webContents.executeJavaScript(
            `getComputedStyle(${wallSelector}).transform`,
          );
          await wait(100);
          assert.equal(
            await win.webContents.executeJavaScript(`getComputedStyle(${wallSelector}).transform`),
            hiddenScroll,
            'Background logos stay still',
          );
          await win.webContents.executeJavaScript(
            "delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))",
          );
          const navigation = await win.webContents.executeJavaScript(`(() => {
            const links = [...document.querySelectorAll('.workflow-nav a')];
            return {
              destinations: links.map(link => link.hash),
              readable: links.every(link => link.scrollWidth <= link.clientWidth && link.clientHeight >= 44),
              heroPreview: !!document.querySelector('.hero-caption a[target="_blank"]'),
              headingsFit: [...document.querySelectorAll('h1,h2,h3')].every(heading => heading.scrollWidth <= heading.clientWidth),
              trustLabelsFit: [...document.querySelectorAll('.hero-trust > span')].every(label => label.scrollWidth <= label.clientWidth && getComputedStyle(label).whiteSpace === 'nowrap'),
              featureHeadingLines: document.querySelector('#features h2').clientHeight / parseFloat(getComputedStyle(document.querySelector('#features h2')).lineHeight),
            };
          })()`);
          assert.deepEqual(navigation.destinations, ['#transcription', '#notes', '#minutes']);
          assert.equal(navigation.readable, true, `${locale}/${width}: workflow labels clipped`);
          assert.equal(navigation.heroPreview, true, 'Hero interface can be opened at full size');
          assert.equal(navigation.headingsFit, true, `${locale}/${width}: heading clipped`);
          assert.equal(navigation.trustLabelsFit, true, `${locale}/${width}: trust label split`);
          if (locale === 'zh')
            assert.ok(
              navigation.featureHeadingLines <= 2.1,
              `${width}: Chinese feature heading breaks mid-phrase`,
            );
          for (const target of [
            'features',
            'software-title',
            'mobile',
            'mobile-microphone',
            'mobile-field',
            'library',
            'privacy',
            'download',
          ]) {
            await win.webContents.executeJavaScript(
              `document.querySelector('#${target}').scrollIntoView({behavior:'instant'})`,
            );
            await wait(200);
            if (target.startsWith('mobile-')) {
              await waitForPlayer(`#${target}`);
              const pairing = await win.webContents.executeJavaScript(
                `(()=>{const el=document.querySelector('#${target} .motion-demo'),f=el.querySelector('iframe'),r=f.getBoundingClientRect();return {scene:f.contentWindow.productMotion.scene,running:f.contentWindow.productMotion.running,fits:r.width<=el.clientWidth+1&&r.height<=el.clientHeight+1}})()`,
              );
              assert.equal(
                pairing.scene,
                target === 'mobile-field' ? 'pair-field' : 'pair-microphone',
              );
              assert.equal(pairing.running, true);
              assert.equal(pairing.fits, true);
            }
            if ([390, 1440].includes(width))
              writeFileSync(
                join(captures, `${locale}-${width}-${target}.png`),
                (await win.webContents.capturePage()).resize({ width }).toPNG(),
              );
          }
          const pausedAt = await win.webContents.executeJavaScript(
            "document.querySelector('.hero-visual iframe').contentWindow.productMotion.elapsed",
          );
          await wait(100);
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelector('.hero-visual iframe').contentWindow.productMotion.elapsed",
            ),
            pausedAt,
            'Offscreen motion should pause',
          );
          if (width < 1000) {
            await win.webContents.executeJavaScript(
              "document.querySelector('.mobile-menu summary').click()",
            );
            assert.equal(
              await win.webContents.executeJavaScript(
                "document.querySelector('.mobile-menu').open",
              ),
              true,
            );
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait(140);
            assert.equal(
              await win.webContents.executeJavaScript(
                "document.querySelector('.mobile-menu').open",
              ),
              false,
            );
          }
          await win.webContents.executeJavaScript(
            "document.querySelector('.language-picker summary').click()",
          );
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelector('.language-picker').open",
            ),
            true,
          );
          await win.webContents.executeJavaScript("document.querySelector('h1').click()");
          await wait(140);
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelector('.language-picker').open",
            ),
            false,
          );
          await win.webContents.executeJavaScript(`(() => {
            const trigger = document.querySelector('.language-picker summary');
            trigger.click(); trigger.click(); trigger.click();
          })()`);
          await wait(200);
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelector('.language-picker').open",
            ),
            true,
            'Reopening cancels the old exit',
          );
          await win.webContents.executeJavaScript(
            "document.querySelector('.language-picker summary').click()",
          );
          await wait(140);
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.faq-item summary')[1].click()",
          );
          assert.equal(
            await win.webContents.executeJavaScript(
              "document.querySelectorAll('.faq-item')[1].open",
            ),
            true,
          );
          console.log(`PASS homepage ${locale}/${width}: autoplay, sections, layout, downloads`);
        }
      }
      // 结果过后进入下一轮；离屏、后台和减少动态效果仍暂停。
      win.setContentSize(1440, 900);
      await loadHome('zh');
      await waitForPlayer('.hero-visual');
      const initialTransform = await win.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('.hero-window')).transform",
      );
      await win.webContents.executeJavaScript(
        "scrollTo({top:document.querySelector('.hero-visual').offsetTop - document.querySelector('.site-header').offsetHeight - 24,behavior:'instant'})",
      );
      await wait(80);
      const scrolledTransform = await win.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('.hero-window')).transform",
      );
      assert.equal(initialTransform, 'none');
      assert.equal(scrolledTransform, 'none', 'Scrolling must not zoom the hero');
      await win.webContents.executeJavaScript("scrollTo({top:0,behavior:'instant'})");
      await wait(80);
      await win.webContents.executeJavaScript(
        "const player=document.querySelector('.hero-visual iframe').contentWindow.productMotion;player.seek(player.duration-600)",
      );
      await wait(900);
      const loop = await win.webContents.executeJavaScript(
        "(()=>{const f=document.querySelector('.hero-visual iframe');return {running:f.contentWindow.productMotion.running,cycle:Number(f.contentDocument.querySelector('#motion-stage').dataset.cycle)}})()",
      );
      assert.equal(loop.running, true);
      assert.ok(loop.cycle >= 1, 'Homepage demos must loop');
      await loadHome('zh');
      await waitForPlayer('.hero-visual');
      await wait(80);
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.hero-visual iframe').contentWindow.productMotion.running",
        ),
        true,
      );
      await win.webContents.executeJavaScript(
        "Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))",
      );
      await wait(80);
      assert.equal(
        await win.webContents.executeJavaScript(
          "document.querySelector('.hero-visual iframe').contentWindow.productMotion.running",
        ),
        false,
      );
      await win.webContents.executeJavaScript(
        "delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))",
      );
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await wait(200);
      const reduced = await win.webContents.executeJavaScript(
        `({playing:[...document.querySelectorAll('.motion-demo iframe')].some(frame=>frame.contentWindow.productMotion?.running),scroll:getComputedStyle(document.documentElement).scrollBehavior,hero:getComputedStyle(document.querySelector('.hero-window')).transform,software:getComputedStyle(document.querySelector('.software-group')).animationName,stage:getComputedStyle(document.querySelector('.scene-visual .motion-demo')).transform,faq:getComputedStyle(document.querySelector('.faq-item'),'::details-content').transitionDuration})`,
      );
      assert.equal(reduced.playing, false);
      assert.equal(reduced.scroll, 'auto');
      assert.equal(reduced.hero, 'none');
      assert.equal(reduced.software, 'none');
      assert.equal(reduced.stage, 'none');
      assert.equal(reduced.faq, '0s', 'Reduced motion also disables FAQ size interpolation');
      win.webContents.debugger.detach();
      console.log('PASS continuous loop, background pause, and reduced motion');

      const noScript = new BrowserWindow({
        show: false,
        width: 1440,
        height: 900,
        webPreferences: { javascript: false },
      });
      try {
        await noScript.loadFile(join(root, 'website/index-zh.html'));
        // 调试协议读取 DOM，不在页面执行脚本。
        noScript.webContents.debugger.attach('1.3');
        const { root: dom } = await noScript.webContents.debugger.sendCommand('DOM.getDocument');
        const { nodeId } = await noScript.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: dom.nodeId,
          selector: '.story-panel',
        });
        const { model } = await noScript.webContents.debugger.sendCommand('DOM.getBoxModel', {
          nodeId,
        });
        assert.ok(model.width > 0 && model.height > 0);
      } finally {
        noScript.destroy();
      }
      console.log('PASS homepage without JavaScript');

      // 与 Pages 工作流使用相同的目录布局和路径替换。
      const deployed = join(temp, 'site');
      cpSync(join(root, 'website'), deployed, { recursive: true });
      cpSync(join(root, 'docs/assets'), join(deployed, 'docs/assets'), { recursive: true });
      cpSync(join(root, 'frontend'), join(deployed, 'frontend'), { recursive: true });
      for (const name of readdirSync(deployed).filter((name) => name.endsWith('.html'))) {
        const file = join(deployed, name);
        writeFileSync(
          file,
          readFileSync(file, 'utf8')
            .replaceAll('../docs/assets/', './docs/assets/')
            .replaceAll('../frontend/', './frontend/'),
        );
      }
      for (const locale of ['zh', 'en']) {
        await loadHome(locale, '__deployed__');
        const resources = await win.webContents.executeJavaScript(`(async () => {
          document.querySelectorAll('img').forEach(image => image.loading = 'eager');
          await Promise.all([...document.images].map(image => image.decode()));
          return [...document.querySelectorAll('[src], link[rel="stylesheet"]')].map(element => element.src || element.href);
        })()`);
        for (const url of resources)
          assert.ok((await fetch(url)).ok, `Missing deployed resource ${url}`);
        await wait(400);
        assert.equal(
          await win.webContents.executeJavaScript(
            "document.querySelector('.hero-visual .motion-demo').classList.contains('is-ready')",
          ),
          true,
        );
      }
      // 发布脚本相对仓库根目录读取 website/，只在临时副本验证。
      cpSync(join(root, 'website'), join(temp, 'website'), { recursive: true });
      const release = spawnSync(
        process.execPath,
        [join(root, 'scripts/update-release-links.mjs')],
        {
          cwd: temp,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VERSION: 'v9.8.7' },
          encoding: 'utf8',
        },
      );
      assert.equal(release.status, 0, release.stderr);
      for (const locale of ['zh', 'en']) {
        const html = readFileSync(join(temp, `website/index-${locale}.html`), 'utf8');
        assert.ok(html.includes('Brevia-9.8.7-arm64.dmg'));
        assert.ok(html.includes('Brevia-9.8.7-x64-setup.exe'));
        assert.ok(html.includes('>v9.8.7<'));
      }
      // 跨语言跳转保留章节，入口页沿用语言选择；存储被禁用时也能进入主页。
      await loadHome('zh', '__deployed__', 'privacy');
      await Promise.all([
        new Promise((resolve) => win.webContents.once('did-finish-load', resolve)),
        win.webContents.executeJavaScript(
          'document.querySelector(\'.language-picker [data-language="en"]\').click()',
        ),
      ]);
      assert.ok(win.webContents.getURL().endsWith('index-en.html#privacy'));
      // 入口页主动跳转会取消 Electron 的初始加载，这是正常导航。
      await win
        .loadURL(`${siteURL}/__deployed__/index.html#notes`)
        .catch((error) => assert.equal(error.code, 'ERR_ABORTED'));
      await wait(200);
      assert.ok(win.webContents.getURL().endsWith('index-en.html#notes'));
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Page.enable');
      for (const [languages, expected, entry] of [
        [['zh-HK', 'en-US'], 'zh', 'index-en.html'],
        [['fr-FR', 'en-GB'], 'en', 'index-zh.html'],
        [['fr-FR', 'zh-CN'], 'zh', 'index-en.html'],
        [['es-ES'], 'en', 'index-zh.html'],
      ]) {
        const { identifier: languageScript } = await win.webContents.debugger.sendCommand(
          'Page.addScriptToEvaluateOnNewDocument',
          {
            source: `sessionStorage.removeItem('lang-selected'); Object.defineProperty(navigator, 'languages', {get: () => ${JSON.stringify(languages)}});`,
          },
        );
        await win
          .loadURL(`${siteURL}/__deployed__/${entry}?browser=${languages[0]}-${expected}#mobile`)
          .catch((error) => assert.equal(error.code, 'ERR_ABORTED'));
        await wait(200);
        assert.ok(
          win.webContents
            .getURL()
            .endsWith(`index-${expected}.html?browser=${languages[0]}-${expected}#mobile`),
        );
        await win.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: languageScript,
        });
      }
      console.log('PASS browser language matching and unsupported-language fallback');
      const { identifier } = await win.webContents.debugger.sendCommand(
        'Page.addScriptToEvaluateOnNewDocument',
        {
          source:
            "Object.defineProperty(window, 'sessionStorage', {get() { throw new DOMException('Blocked', 'SecurityError'); }});",
        },
      );
      await win
        .loadURL(`${siteURL}/__deployed__/index.html#mobile`)
        .catch((error) => assert.equal(error.code, 'ERR_ABORTED'));
      await wait(200);
      assert.ok(/index-(en|zh)\.html#mobile$/.test(win.webContents.getURL()));
      await win.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
        identifier,
      });
      win.webContents.debugger.detach();
      console.log('PASS language navigation, saved preference, and blocked storage');
      console.log('PASS deployed assets and release-link updates');
      assert.deepEqual(errors, []);
    } finally {
      win.destroy();
      server.close();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('quit', () => rmSync(temp, { recursive: true, force: true }));
