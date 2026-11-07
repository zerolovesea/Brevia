// Run with: node scripts/test-website-demos.cjs [--record]
// --record 将官网演示导出到 output/website-demos；README 使用正式应用截图。
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 750 } });
  const win = await context.newPage();
  let cdp;
  const loadFile = (file) => win.goto(pathToFileURL(file).href);
  const shot = async (width) => {
    const data = await win.screenshot();
    if (win.viewportSize().width === width) return data;
    const result = spawnSync('magick', ['png:-', '-resize', String(width) + 'x', 'png:-'], {
      input: data,
    });
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  const errors = [];
  win.on('console', (event) => {
    if (event.type() === 'error') errors.push(event.text());
  });
  async function load(name, locale) {
    await win.goto(
      pathToFileURL(join(root, 'website', `demo-${name}${locale === 'en' ? '-en' : ''}.html`))
        .href + '?manual=1',
    );
    await win.evaluate('document.fonts.ready');
    const shell = await win.evaluate(`({
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
    writeFileSync(file, await shot(1200));
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/__github-repo__') {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      response.end(JSON.stringify({ stargazers_count: 1234 }));
      return;
    }
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
        '.wasm': 'application/wasm',
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
  await context.route('https://api.github.com/repos/zerolovesea/Brevia', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stargazers_count: 1234 }),
    }),
  );
  const waitForMotion = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await win.evaluate('!!window.productMotion')) return;
      await wait(50);
    }
    throw Error('Motion did not initialize');
  };
  const loadHome = async (language, directory = 'website', hash = '') => {
    await win.evaluate(`sessionStorage.setItem('lang-selected', '${language}')`);
    await win.goto(`${siteURL}/${directory}/index-${language}.html${hash ? '#' + hash : ''}`);
  };
  try {
    await import('./test-github-stars.mjs');
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
        const result = await win.evaluate(`(async () => {
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
          await win.evaluate("document.querySelector('.summary-preview').scrollTop = 0");
        }
        if (name === 'transcription') assert.equal(result.segments, 6);
        if (name === 'voiceprint') {
          assert.equal(result.segments, 4);
          assert.equal(
            await win.evaluate(
              "!!document.querySelector('#detail-view') && !document.querySelector('#live-view')",
            ),
            true,
          );
          assert.equal(
            await win.evaluate(
              "document.querySelectorAll('.speaker-name:not(.provisional)').length",
            ),
            4,
          );
        }
        if (['transcription', 'caption-bar'].includes(name))
          assert.equal(
            await win.evaluate(
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
            await win.evaluate("document.querySelector('.modal-body').scrollTop = 0");
          if (files[name]) await capture(join(tour, files[name]));
        }
        console.log(`PASS ${locale}/${name} (two cycles)`);
      }
      await load('ai-assist', locale);
      assert.equal(await win.evaluate("document.querySelectorAll('.live-control-bar').length"), 1);
      assert.equal(
        await win.evaluate(
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
          writeFileSync(join(frames, `${String(frame).padStart(4, '0')}.png`), await shot(1200));
          if (frame === 84)
            writeFileSync(
              join(tour, locale === 'zh' ? 'AI辅助笔记.png' : 'AI Assist Notes.png'),
              await shot(1200),
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
      assert.ok(await win.evaluate("document.querySelectorAll('.segment').length > 0"));
      assert.equal(await win.evaluate("document.querySelectorAll('.segment-speaker').length"), 0);
      console.log(`PASS ${locale}/ai-assist`);
    }
    for (const locale of ['zh', 'en']) {
      await win.goto(
        pathToFileURL(join(root, `website/demo-mobile${locale === 'en' ? '-en' : ''}.html`)).href,
      );
      const mobile = await win.evaluate(`(() => {
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
    cdp = await context.newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await loadFile(join(root, 'website/demo-summary.html'));
    await wait(1200);
    assert.equal(await win.evaluate('demoDebug.timeline.loopEnabled'), false);
    assert.equal(await win.evaluate('demoDebug.timeline.isRunning'), false);
    assert.equal(
      await win.evaluate("!!document.querySelector('.detail-layout.is-summary-mode')"),
      true,
    );
    console.log('PASS reduced motion');
    await cdp.detach();
    for (const locale of ['zh', 'en']) {
      await win.setViewportSize({ width: 1280, height: 800 });
      await win.goto(
        `${siteURL}/website/product-motion.html?scene=capsule&lang=${locale}&manual=1`,
      );
      await waitForMotion();
      for (const [time, phase, expanded, tab] of [
        [3000, 'recording', false, 'captions'],
        [6500, 'recording', true, 'captions'],
        [10500, 'recording', true, 'notes'],
        [13500, 'recording', true, 'notes'],
        [15500, 'paused', true, 'captions'],
        [17500, 'recording', true, 'captions'],
        [18500, 'saving', false, 'captions'],
        [19500, 'failed', false, 'captions'],
        [21500, 'saving', false, 'captions'],
        [22500, 'saved', false, 'captions'],
        [32500, 'recording', true, 'captions'],
        [10500, 'recording', true, 'notes'],
      ]) {
        const state = await win.evaluate(`(() => {
            productMotion.seek(${time});
            const doc = document.querySelector('.capsule-demo-window').contentDocument;
            const pill = doc.querySelector('.recording-pill').getBoundingClientRect();
            return {phase:doc.body.dataset.phase, expanded:!doc.querySelector('#capsule-panel').hidden,
              tab:doc.querySelector('[aria-selected="true"]').dataset.tab,
              suggestion:doc.querySelector('#capsule-suggestion').textContent.trim(),
              pinned:doc.querySelector('#capsule-pin').getAttribute('aria-pressed'),
              retry:doc.querySelector('.capsule-stop').getAttribute('aria-label'),
              fits:pill.left>=0 && pill.right<=464 && pill.bottom<=470,
              synced:document.querySelector('.capsule-demo-app').contentDocument.querySelector('#timer').textContent.endsWith(doc.querySelector('#capsule-time').textContent),
              notes:doc.querySelector('#capsule-notes').textContent};
          })()`);
        assert.equal(state.synced, true, `${locale}/capsule: timer differs from main window`);
        assert.equal(state.phase, phase);
        assert.equal(state.expanded, expanded);
        assert.equal(state.tab, tab);
        assert.equal(state.fits, true, `${locale}/capsule: clipped controls`);
        if (time === 10500) assert.ok(state.suggestion.length > 0);
        if (time === 13500) {
          assert.equal(state.suggestion, '');
          assert.equal(state.pinned, 'true');
          assert.ok(
            state.notes.includes(
              locale === 'zh' ? '周五前完成内部验收' : 'Complete internal acceptance',
            ),
          );
        }
        if (phase === 'failed')
          assert.equal(state.retry, locale === 'zh' ? '重试保存' : 'Retry saving');
        if (record && time < 26000) await capture(join(output, `capsule-${locale}-${time}.png`));
      }
      console.log(`PASS motion ${locale}/capsule (states, controls and reverse seek)`);
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
        await win.setViewportSize({ width: phone ? 390 : 1280, height: phone ? 844 : 800 });
        await win.goto(
          `${siteURL}/website/product-motion.html?scene=${scene}&lang=${locale}&manual=1`,
        );
        await waitForMotion();
        if (scene === 'tour') {
          const libraryRows = await win.evaluate(`(() => {
              productMotion.seek(0);
              const rows = [...document.querySelectorAll('.meeting-row')];
              return {count: rows.length, maxHeight: Math.max(...rows.map(row => row.getBoundingClientRect().height))};
            })()`);
          assert.equal(libraryRows.count, 4);
          assert.ok(libraryRows.maxHeight <= 50, '概览四行会议保持概念图密度');
        }
        const states = [];
        for (const time of scene === 'pair-microphone'
          ? [2000, 8000, 26000]
          : scene === 'library'
            ? [1000, 4500, 10500]
            : ['live', 'summary'].includes(scene)
              ? [2000, 6000, 10500]
              : [2000, 8000, 17000]) {
          states.push(
            await win.evaluate(`(() => {
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
        assert.notEqual(states[0].text, states[1].text, `${locale}/${scene}: no functional motion`);
        if (updatePosters && ['tour', 'live', 'summary', 'library'].includes(scene)) {
          const time = { tour: 0, live: 6600, summary: 11500, library: 1000 }[scene];
          await win.evaluate(
            `productMotion.seek(${time});document.querySelector('.motion-cursor').hidden=true`,
          );
          await wait(180);
          const directory = join(root, 'website/assets/app-ui');
          mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, `${locale}-${scene}.png`), await shot(1280));
        }
        if (scene === 'tour') {
          const flow = await win.evaluate(`(() => {
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
            await win.setViewportSize({ width: 1280, height: height });
            await win.evaluate('productMotion.seek(2900)');
            await wait(80);
            const prepare = await win.evaluate(`(() => {
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
          const ordering = await win.evaluate(`(() => {
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
          const acceptance = await win.evaluate(
            `(()=>{productMotion.seek(5000);const before=document.querySelector('.notes-editor').innerText;const label=document.querySelector('.ai-suggestion-type').textContent;productMotion.seek(5200);return {before,after:document.querySelector('.notes-editor').innerText,label,checkboxes:document.querySelectorAll('.notes-editor input[type=checkbox]').length,headings:document.querySelectorAll('.notes-editor h2').length,flying:document.querySelectorAll('.motion-accepted-note').length}})()`,
          );
          assert.equal(acceptance.before.includes(locale === 'zh' ? '既定范围' : 'agreed'), false);
          assert.ok(acceptance.after.includes(locale === 'zh' ? '既定范围' : 'agreed'));
          assert.equal(acceptance.label, locale === 'zh' ? '可能的决策' : 'Possible decision');
          assert.equal(acceptance.checkboxes, 0);
          assert.equal(acceptance.headings, 0);
          assert.equal(acceptance.flying, 0);
          const repeatedAccepts = await win.evaluate(`(() => {
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
          const acceptedUI = await win.evaluate(`(() => {
              productMotion.seek(6600);
              const root=document.querySelector('[data-live-notes-root]');
              return {suggestionInside:root.contains(document.querySelector('[data-ai-suggestion]')),
                toolbarVisible:root.querySelector('.notes-toolbar').checkVisibility(),
                toast:document.querySelector('#toast.visible')?.innerText};
            })()`);
          assert.equal(
            acceptedUI.suggestionInside,
            true,
            'Suggestions share the official notes surface',
          );
          assert.equal(
            acceptedUI.toolbarVisible,
            true,
            'The meeting toolbar stays visible after accepting a suggestion',
          );
          assert.equal(acceptedUI.toast, locale === 'zh' ? '已加入笔记' : 'Added to notes');
          await capture(
            join(root, 'output/playwright/affine-implementation', `notes-added-${locale}.png`),
          );
        }
        if (scene === 'tour') {
          const choreography = await win.evaluate(`(() => {
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
          assert.equal(choreography.first, choreography.repeated, 'Cursor seeks deterministically');
          assert.equal(choreography.clicking, true, `${locale}/${scene}: click ripple missing`);
          assert.equal(
            choreography.hitsTarget,
            true,
            `${locale}/${scene}: cursor misses its target`,
          );
        }
        assert.equal(
          await win.evaluate("document.querySelector('.motion-camera') === null"),
          true,
          `${locale}/${scene}: demos must not zoom or pan`,
        );
        if (scene === 'summary') {
          const layout = await win.evaluate(`(() => {
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
          assert.equal(states[0].summary, undefined, 'Summary text is absent while the task runs');
          const generation = await win.evaluate(`(() => {
              return [500,1200,3000,5000,5300,8000,12500].map(time => {
                productMotion.seek(time);
                const task=document.querySelector('#summary-progress');
                return {body:document.querySelector('.summary-body')?.innerText,
                  taskVisible:!task.hidden, inSidebar:!!task.closest('.sidebar #task-cards'),
                  progress:Number(task.querySelector('[role=progressbar]').getAttribute('aria-valuenow')),
                  step:task.dataset.stage, canGenerate:!!document.querySelector('[data-generate-summary]:not([disabled])'),
                  canCopy:!!document.querySelector('[data-copy-summary]'),
                  pending:!!document.querySelector('.summary-empty[role=status] .summary-generating-icon')};
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
          assert.equal(generation[4].body, generation[5].body, 'Completed summary appears in full');
          assert.equal(generation[6].body, undefined, 'Loop clears the previous summary');
          assert.equal(generation[6].taskVisible, false);
          for (const [name, time] of [
            ['task', 3000],
            ['complete', 6000],
          ]) {
            await win.evaluate(`productMotion.seek(${time})`);
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
            const confirmation = await win.evaluate(
              "productMotion.seek(4200);!document.querySelector('.collab-approval').hidden&&!document.querySelector('.collab-desktop iframe').contentDocument.querySelector('#mobile-approval').hidden",
            );
            assert.equal(confirmation, true, 'Scanning must lead to desktop approval');
            const actions = await win.evaluate(
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
        const repeated = await win.evaluate(
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
        await win.setViewportSize({ width: 1280, height: 800 });
        await win.goto(
          `${siteURL}/website/product-motion.html?scene=live&shot=${shot}&lang=${locale}&manual=1`,
        );
        await waitForMotion();
        shots[shot] = await win.evaluate(`(() => {
            const sample = time => {
              productMotion.seek(time);
              return {source:document.querySelector('#transcript-scroll').innerText,
                notes:document.querySelectorAll('.notes-editor li').length,
                suggestion:!document.querySelector('[data-ai-suggestion]').hidden,
                translations:document.querySelectorAll('#transcript-scroll .translation').length,
                layoutToggle:!!document.querySelector('[data-toggle-live-mode]')};
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
      assert.equal(shots.captions[3].layoutToggle, false);
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
      assert.equal(shots.notes[3].layoutToggle, false);
      console.log(`PASS differentiated transcription and AI review ${locale}`);
    }
    const captures = join(root, 'output/playwright/landing');
    mkdirSync(captures, { recursive: true });
    const waitForApp = () =>
      win.waitForFunction(() => !!document.querySelector('.app-frame')?.contentWindow.appMotion);
    for (const locale of ['zh', 'en']) {
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [768, 1024],
        [1280, 720],
        [1440, 900],
        [1920, 1080],
        [568, 320],
      ]) {
        await win.setViewportSize({ width, height });
        await loadHome(locale);
        await waitForApp();
        if (locale === 'en' && width === 1440) {
          await win.locator('.demo').click();
          const preview = await win.locator('.app-frame').evaluate((frame) => {
            const app = frame.contentDocument;
            const capsule = app.querySelector('iframe:not(.pair-phone)').contentDocument;
            const untranslated = [];
            for (const time of [6000, 11000, 17000, 28000, 33000, 54500]) {
              frame.contentWindow.appMotion.render(time);
              for (const doc of time === 17000 ? [app, capsule] : [app]) {
                const visible = [...doc.querySelectorAll('*')].filter(
                  (el) =>
                    el.checkVisibility({ visibilityProperty: true }) &&
                    el.getBoundingClientRect().width,
                );
                for (const el of visible) {
                  const strings = [...el.childNodes]
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent);
                  strings.push(
                    ...['title', 'placeholder', 'aria-label', 'data-tooltip', 'alt'].map((key) =>
                      el.getAttribute(key),
                    ),
                  );
                  untranslated.push(
                    ...strings.filter((text) => text && /\p{Script=Han}/u.test(text)),
                  );
                }
              }
            }
            return {
              untranslated,
              source: capsule.querySelector('[data-caption-text]').textContent,
              target: capsule.querySelector('.capsule-translation').textContent,
            };
          });
          assert.deepEqual(preview.untranslated, []);
          assert.match(preview.source, /^Simplifiquemos/);
          assert.match(preview.target, /^Let’s make/);
        }
        const layout = await win.evaluate(() => {
          const frame = document.querySelector('.app-frame');
          const app = frame.contentDocument;
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            demos: document.querySelectorAll('.demo').length,
            media: app.querySelectorAll('video,img[src$=".png"]:not(#mobile-qr),img[src$=".webp"]')
              .length,
            currentStyles: !!app.querySelector('link[href$="/desktop-workspace.css"]'),
            controls: document.querySelectorAll('.motion-toggle,.demo-controls').length,
            fits:
              frame.getBoundingClientRect().top >= 0 &&
              frame.getBoundingClientRect().bottom <= innerHeight &&
              document.querySelector('.download-area')?.getBoundingClientRect().bottom <=
                innerHeight,
            scrollable: document.documentElement.scrollHeight > innerHeight,
            canvas: document.querySelector('.demo-canvas').getBoundingClientRect().height,
            backend: !!frame.contentWindow.brevia,
          };
        });
        assert.equal(layout.overflow, false, `${locale}/${width}: horizontal overflow`);
        assert.equal(layout.demos, 1);
        assert.equal(layout.media, 0, 'Application renders live DOM, not screenshots');
        assert.equal(layout.controls, 0);
        assert.ok(layout.currentStyles && layout.fits && layout.canvas >= 150);
        assert.equal(layout.scrollable, false, 'The default page fits in the viewport');
        assert.equal(layout.backend, false, 'Demonstration has no native backend');
        for (const platform of ['macos', 'windows', 'ios', 'android']) {
          await win.locator(`label[for="platform-${platform}"]`).click();
          assert.equal(await win.locator('.platform-link:visible').count(), 1);
          assert.equal(
            await win.locator('.platform-link:visible').getAttribute('data-platform'),
            platform,
          );
        }
        if ([390, 1440].includes(width)) {
          await win.evaluate(() => scrollTo(0, 0));
          await win.screenshot({ path: join(captures, `${locale}-${width}.png`), fullPage: true });
        }
      }
    }
    await win.setViewportSize({ width: 1440, height: 1100 });
    await win.clock.install();
    await loadHome('zh');
    await waitForApp();
    await win.clock.runFor(100);
    const previewFrame = await win.locator('.app-frame').elementHandle();
    assert.deepEqual(await win.locator('.feature-tabs label').allTextContents(), [
      '转写与 AI 笔记',
      '鱼骨图',
      '手机协作',
      'Agent 与 MCP',
      '会议胶囊',
    ]);
    for (const [feature, phase] of [
      ['live', 1],
      ['fishbone', 3],
      ['capsule', 2],
      ['agent', 4],
      ['phone', 0],
    ]) {
      await win.locator(`label[for="feature-${feature}"]`).click();
      assert.equal(await win.locator('.demo').getAttribute('data-phase'), String(phase));
      assert.ok(
        await previewFrame.evaluate((frame) => frame === document.querySelector('.app-frame')),
      );
    }
    await win.waitForFunction(
      () =>
        !!document.querySelector('.app-frame').contentDocument.querySelector('.pair-phone')
          .contentWindow.showMeetingPreview,
    );
    const feature = await win.locator('.app-frame').evaluate((frame) => {
      const doc = frame.contentDocument;
      const capsule = doc.querySelector('iframe:not(.pair-phone)').contentDocument;
      const seek = (time) => frame.contentWindow.appMotion.render(time);
      const steps = [33000, 35000, 38900].map((time) => {
        seek(time);
        return doc.querySelector('.pair-scene').dataset.step;
      });
      const phoneUI =
        !!doc.querySelector('#mobile-pair-dialog[open] #mobile-qr') &&
        !!doc.querySelector('.pair-phone').contentWindow.showMeetingPreview;
      seek(200);
      const identifying = doc.querySelector('.segment-speaker').textContent;
      seek(4800);
      const recognized = doc.querySelector('.segment-speaker').textContent;
      const translated = !!doc.querySelector('#transcript-scroll .translation')?.textContent;
      seek(11000);
      const aiVisible = !doc.querySelector('[data-ai-suggestion]').hidden;
      const contrast = (selector) => {
        const style = doc.defaultView.getComputedStyle(doc.querySelector(selector));
        const luminance = (color) =>
          color
            .match(/\d+/g)
            .slice(0, 3)
            .reduce((sum, channel, i) => {
              const n = Number(channel) / 255;
              return (
                sum +
                [0.2126, 0.7152, 0.0722][i] *
                  (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
        const a = luminance(style.color),
          b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const readable = ['.ai-suggestion-accept', '#pause'].every(
        (selector) => contrast(selector) >= 4.5,
      );
      const fullColor = getComputedStyle(frame.parentElement).filter === 'none';
      const metrics = doc.querySelectorAll('[data-library-metrics] > [aria-label]').length;
      const card = doc.querySelector('.ai-suggestion-card');
      seek(11017);
      const stableCard = card === doc.querySelector('.ai-suggestion-card');
      seek(17000);
      const expanded = !capsule.querySelector('#capsule-panel').hidden;
      const pauseIcon = capsule.querySelector('.capsule-pause svg');
      seek(18100);
      const stableCapsule = pauseIcon === capsule.querySelector('.capsule-pause svg');
      seek(28000);
      return {
        steps,
        phoneUI,
        readable,
        fullColor,
        metrics,
        stableCard,
        stableCapsule,
        identifying,
        recognized,
        translated,
        aiVisible,
        expanded,
        causes: !!doc.querySelector('.detail-cause-scroll'),
      };
    });
    assert.deepEqual(feature, {
      steps: ['scan', 'start', 'record'],
      phoneUI: true,
      readable: true,
      fullColor: true,
      metrics: 4,
      stableCard: true,
      stableCapsule: true,
      identifying: '识别中…',
      recognized: '林晓',
      translated: true,
      aiVisible: true,
      expanded: true,
      causes: true,
    });
    await win.locator('label[for="feature-live"]').click();
    await win.clock.runFor(11000);
    assert.ok(
      await previewFrame.evaluate(
        (frame) => !frame.contentDocument.querySelector('[data-ai-suggestion]').hidden,
      ),
    );
    await win.clock.runFor(4000);
    assert.equal(await win.locator('.demo').getAttribute('data-phase'), '1');
    await win.locator('.demo').click();
    await win.clock.runFor(11000);
    assert.equal(await win.locator('.demo').getAttribute('data-phase'), '1');
    await win.locator('.demo').focus();
    await win.keyboard.press('Space');
    await win.clock.runFor(11000);
    assert.equal(await win.locator('.demo').getAttribute('data-phase'), '2');
    await win.locator('#feature-live').focus();
    await win.keyboard.press('ArrowRight');
    assert.ok(await win.locator('#feature-fishbone').isChecked());
    await win.locator('label[for="feature-agent"]').click();
    await win.clock.runFor(2300);
    const agent = win.frameLocator('.app-frame').locator('.agent-demo');
    await agent.locator('.agent-guide-copy[data-copy-state="done"]').waitFor();
    assert.equal(
      await agent.locator('.settings-navigation [aria-current=page]').innerText(),
      'Agent 与 MCP',
    );
    assert.equal(
      await win
        .locator('.app-frame')
        .evaluate(
          (frame) =>
            frame.contentDocument.querySelector('.window-bar').getBoundingClientRect().left,
        ),
      0,
      'Settings toolbar spans the full app window',
    );
    const prompt = await agent.locator('.agent-guide').innerText();
    await win.clock.runFor(1200);
    assert.equal(await agent.locator('.codex-composer .agent-paste').innerText(), prompt);
    const request = await agent.locator('.codex-input-task').innerText();
    assert.match(request, /entrevista\.wav/);
    await win.clock.runFor(1600);
    assert.equal(await agent.locator('.codex-user-message').innerText(), `${prompt}\n\n${request}`);
    assert.match(await agent.locator('.agent-work code').innerText(), /SKILL\.md/);
    await win.clock.runFor(1000);
    assert.match(await agent.locator('.agent-work code').innerText(), /status --no-start/);
    await win.clock.runFor(2000);
    assert.match(
      await agent.locator('.agent-work code').innerText(),
      /transcribe.*entrevista\.wav/,
    );
    await win.clock.runFor(2200);
    assert.match(
      await agent.locator('.agent-work code').innerText(),
      /translate.*entrevista\.es\.srt/,
    );
    await win.clock.runFor(3200);
    assert.match(
      await agent.locator('.codex-code pre').innerText(),
      /00:00:04,000 --> 00:00:08,000[\s\S]*We decided to test/,
    );
    assert.deepEqual(await agent.locator('.agent-reply code').allTextContents(), [
      'entrevista.es.srt',
      'entrevista.en.srt',
    ]);
    await agent.locator('.agent-reply').waitFor();
    await win.clock.runFor(3000);
    assert.equal(await agent.getAttribute('data-screen'), 'settings');
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.locator('.demo.is-paused').waitFor();
    await agent.locator('.agent-reply').waitFor();
    await win.emulateMedia({ reducedMotion: 'no-preference' });
    console.log(
      'PASS default feature tabs, merged live/notes loop, Agent skill, CLI and MCP handoff',
    );
    const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const noScript = await noScriptContext.newPage();
    await noScript.goto(`${siteURL}/website/index-en.html`);
    for (const platform of ['macos', 'windows', 'ios', 'android']) {
      await noScript.locator(`label[for="platform-${platform}"]`).click();
      assert.equal(
        await noScript.locator('.platform-link:visible').getAttribute('data-platform'),
        platform,
      );
    }
    await noScriptContext.close();
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
      await waitForApp();
      const resources = await win.evaluate(`(async () => {
          document.querySelectorAll('img').forEach(image => image.loading = 'eager');
          await Promise.all([...document.images].map(image => image.decode()));
          return [...document.querySelectorAll('[src], link[rel="stylesheet"]')].map(element => element.src || element.href);
        })()`);
      for (const url of resources)
        assert.ok((await fetch(url)).ok, `Missing deployed resource ${url}`);
      await wait(400);
      assert.equal(
        await win.evaluate("!!document.querySelector('.app-frame')?.contentWindow.appMotion"),
        true,
      );
    }
    // 发布脚本相对仓库根目录读取官网和 README，只在临时副本验证。
    cpSync(join(root, 'website'), join(temp, 'website'), { recursive: true });
    const readmes = [
      'README.md',
      ...readdirSync(join(root, 'docs'))
        .filter((name) => /^README\.[a-z]{2}(?:-[A-Z]{2})?\.md$/.test(name))
        .map((name) => `docs/${name}`),
    ];
    mkdirSync(join(temp, 'docs'), { recursive: true });
    for (const file of readmes) cpSync(join(root, file), join(temp, file));
    mkdirSync(join(temp, 'dist'));
    for (const name of ['Brevia-WebKit-9.8.7-arm64.dmg', 'Brevia-9.8.7-x64-setup.exe'])
      writeFileSync(join(temp, 'dist', name), Buffer.alloc(100000));
    const release = spawnSync(process.execPath, [join(root, 'scripts/update-release-links.mjs')], {
      cwd: temp,
      env: { ...process.env, VERSION: 'v9.8.7' },
      encoding: 'utf8',
    });
    assert.equal(release.status, 0, release.stderr);
    for (const file of readmes) {
      const markdown = readFileSync(join(temp, file), 'utf8');
      assert.ok(markdown.includes('Brevia-WebKit-9.8.7-arm64.dmg'), file);
      assert.ok(markdown.includes('Brevia-9.8.7-x64-setup.exe'), file);
      assert.ok(!/Brevia-<version>| · `(?:arm64\.dmg|x64-setup\.exe)`/.test(markdown), file);
    }
    for (const locale of ['zh', 'en']) {
      const html = readFileSync(join(temp, `website/index-${locale}.html`), 'utf8');
      assert.ok(html.includes('Brevia-WebKit-9.8.7-arm64.dmg'));
      assert.ok(html.includes('Brevia-9.8.7-x64-setup.exe'));
      assert.ok(html.includes('>v9.8.7<'));
      assert.ok(
        html.includes('data-size="macos">0.1 MB') && html.includes('data-size="windows">0.1 MB'),
      );
    }
    // 跨语言跳转保留章节，入口页沿用语言选择；存储被禁用时也能进入主页。
    await loadHome('zh', '__deployed__', 'privacy');
    await Promise.all([
      win.waitForEvent('load'),
      win.evaluate('document.querySelector(\'[data-language="en"]\').click()'),
    ]);
    assert.ok(win.url().endsWith('index-en.html#privacy'));
    // 入口页主动跳转会取消 浏览器的初始加载，这是正常导航。
    await win
      .goto(`${siteURL}/__deployed__/index.html#notes`)
      .catch((error) => assert.match(error.message, /ERR_ABORTED|interrupted/));
    await wait(200);
    assert.ok(win.url().endsWith('index-en.html#notes'));
    cdp = await context.newCDPSession(win);
    await cdp.send('Page.enable');
    for (const [languages, expected, entry] of [
      [['zh-HK', 'en-US'], 'zh', 'index-en.html'],
      [['fr-FR', 'en-GB'], 'en', 'index-zh.html'],
      [['fr-FR', 'zh-CN'], 'zh', 'index-en.html'],
      [['es-ES'], 'en', 'index-zh.html'],
    ]) {
      const { identifier: languageScript } = await cdp.send(
        'Page.addScriptToEvaluateOnNewDocument',
        {
          source: `sessionStorage.removeItem('lang-selected'); Object.defineProperty(navigator, 'languages', {get: () => ${JSON.stringify(languages)}});`,
        },
      );
      await win
        .goto(`${siteURL}/__deployed__/${entry}?browser=${languages[0]}-${expected}#mobile`)
        .catch((error) => assert.match(error.message, /ERR_ABORTED|interrupted/));
      await wait(200);
      assert.ok(
        win.url().endsWith(`index-${expected}.html?browser=${languages[0]}-${expected}#mobile`),
      );
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: languageScript,
      });
    }
    console.log('PASS browser language matching and unsupported-language fallback');
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        "Object.defineProperty(window, 'sessionStorage', {get() { throw new DOMException('Blocked', 'SecurityError'); }});",
    });
    await win
      .goto(`${siteURL}/__deployed__/index.html#mobile`)
      .catch((error) => assert.match(error.message, /ERR_ABORTED|interrupted/));
    await wait(200);
    assert.ok(/index-(en|zh)\.html#mobile$/.test(win.url()));
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier,
    });
    await cdp.detach();
    console.log('PASS language navigation, saved preference, and blocked storage');
    console.log('PASS deployed assets and release-link updates');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
