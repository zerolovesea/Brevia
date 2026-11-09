const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 464, height: 470 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const handlers = new Map();
      const state = {
        phase: 'playing',
        meetingId: '361aa4f4-d673-4548-9ad5-d851a739fbb5',
        locale: 'zh',
        theme: 'light',
        title: '回看测试',
        elapsed: 30,
        level: 0,
        canPause: true,
        expanded: false,
        activeCaptionId: '15',
        captions: Array.from({ length: 240 }, (_, index) => ({
          id: String(index),
          time: `00:${String(index).padStart(2, '0')}`,
          text: `第 ${index} 段完整字幕`,
          translation: '',
          draft: false,
        })),
        notes: '',
      };
      window.capsuleCalls = [];
      window.updateCapsule = (next, omitCaptions = false) => {
        Object.assign(state, next);
        handlers.get('desktop.state')({
          ...structuredClone(state),
          ...(omitCaptions ? { captions: undefined } : {}),
        });
      };
      window.brevia = {
        on: (name, fn) => handlers.set(name, fn),
        meeting: {
          noteImage: {
            save: async ({ meeting_id, mime_type, bytes }) => {
              if (
                meeting_id !== state.meetingId ||
                mime_type !== 'image/png' ||
                bytes.byteLength !== 3
              )
                throw new Error('Invalid image');
              return {
                url: `brevia-note://${meeting_id}/a375a771-9ddc-49fd-965f-5fae32fc5de5.png`,
              };
            },
          },
        },
        desktop: {
          state: async () => structuredClone(state),
          expand: async ({ expanded }) => {
            window.capsuleCalls.push(expanded);
            await new Promise((resolve) => setTimeout(resolve, 100));
            window.updateCapsule({ expanded });
          },
          action: async ({ action, note }) => {
            if (action === 'read-notes') return state.notes;
            if (action === 'save-notes') {
              if (note.base !== state.notes) throw new Error('Notes changed');
              window.updateCapsule({ notes: note.text }, true);
            }
          },
          move: async () => {},
        },
      };
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, '../frontend/recording-capsule.html')).href,
    );
    await page.evaluate(() => window.updateCapsule({ pillOffset: 64 }));
    const pillLeft = () => page.locator('.recording-pill').evaluate((node) => node.offsetLeft);
    await page.setViewportSize({ width: 344, height: 80 });
    assert.equal(await pillLeft(), 12);
    await page.setViewportSize({ width: 464, height: 470 });
    assert.equal(await pillLeft(), 76);
    await page.evaluate(() => window.updateCapsule({ pillOffset: 0 }));
    await page.waitForFunction(() => document.querySelector('#capsule-title')?.textContent);
    for (const theme of ['light', 'dark']) {
      const layout = await page.evaluate((theme) => {
        window.updateCapsule({ theme, title: '周会 20261106' }, true);
        const title = document.querySelector('#capsule-title'),
          text = title.firstChild;
        window.updateCapsule({ elapsed: 31 }, true);
        const short = title.offsetWidth < title.parentElement.clientWidth,
          stable = text === title.firstChild;
        window.updateCapsule({ title: '周会 '.repeat(40) }, true);
        return {
          short,
          stable,
          long: title.offsetWidth <= title.parentElement.clientWidth,
          clipped: title.scrollWidth > title.clientWidth,
          overflow: getComputedStyle(title).overflow,
          tooltip: title.title === title.textContent,
        };
      }, theme);
      assert.deepEqual(layout, {
        short: true,
        stable: true,
        long: true,
        clipped: true,
        overflow: 'clip',
        tooltip: true,
      });
    }
    await page.locator('.capsule-identity').hover();
    await page.waitForFunction(() => !document.querySelector('#capsule-panel').hidden);
    assert.equal(await page.locator('.capsule-line').count(), 240);
    assert.equal(
      await page.locator('[aria-current="true"] [data-caption-text]').textContent(),
      '第 15 段完整字幕',
    );
    assert.ok(await page.locator('#captions-panel').evaluate((node) => node.scrollTop > 0));
    await page.locator('#captions-panel').evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForFunction(() => !document.querySelector('#capsule-follow').hidden);
    await page.evaluate(() => window.updateCapsule({ activeCaptionId: '16' }, true));
    assert.equal(await page.locator('#captions-panel').evaluate((node) => node.scrollTop), 0);
    await page.locator('#captions-panel').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const last = await page.locator('.capsule-line').last().boundingBox();
    const body = await page.locator('#captions-panel').boundingBox();
    assert.ok(
      last.y >= body.y && last.y + last.height <= body.y + body.height + 1,
      '末段字幕可以滚动到可见区域',
    );
    assert.equal(
      await page.locator('.capsule-line').first().locator('[data-caption-text]').textContent(),
      '第 0 段完整字幕',
    );
    assert.equal(
      await page.locator('.capsule-line').last().locator('[data-caption-text]').textContent(),
      '第 239 段完整字幕',
    );
    await page.locator('#capsule-follow').click();
    assert.ok(await page.locator('#captions-panel').evaluate((node) => node.scrollTop > 0));
    // 窗口 IPC 比淡出慢时，淡出的面板也必须一直保持透明。
    await page.evaluate(() => {
      window.closeFrames = [];
      const sample = () => {
        const panel = document.querySelector('#capsule-panel');
        window.closeFrames.push({
          hidden: panel.hidden,
          opacity: Number(getComputedStyle(panel).opacity),
        });
        if (!panel.hidden) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.mouse.move(462, 468);
    await page.waitForFunction(() => document.querySelector('#capsule-panel').hidden);
    const frames = await page.evaluate(() => window.closeFrames);
    const faded = frames.findIndex((frame) => !frame.hidden && frame.opacity < 0.01);
    assert.ok(faded >= 0, '淡出必须完成');
    assert.ok(
      frames.slice(faded).every((frame) => frame.hidden || frame.opacity < 0.01),
      '等待原生窗口收起时不能闪回不透明',
    );
    await page.locator('.capsule-identity').hover();
    await page.waitForFunction(() => !document.querySelector('#capsule-panel').hidden);
    const closes = await page.evaluate(() => window.capsuleCalls.filter((value) => !value).length);
    await page.mouse.move(462, 468);
    await page.waitForFunction(() =>
      document
        .querySelector('#capsule-panel')
        .getAnimations()
        .some(
          (animation) =>
            animation.effect.getTiming().fill === 'forwards' && animation.playState === 'running',
        ),
    );
    await page.locator('.capsule-identity').hover();
    await page.waitForTimeout(350);
    assert.equal(
      await page.locator('#capsule-panel').evaluate((node) => node.hidden),
      false,
      '鼠标返回应取消收起',
    );
    assert.equal(
      await page.evaluate(() => window.capsuleCalls.filter((value) => !value).length),
      closes,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(462, 468);
    await page.waitForFunction(() => document.querySelector('#capsule-panel').hidden);
    await page.locator('.capsule-identity').hover();
    await page.locator('#notes-tab').click();
    await page.locator('#capsule-edit-notes').click();
    const input = page.locator('#capsule-note-form textarea');
    await input.fill('会议行动项');
    await page.mouse.move(462, 468);
    await page.waitForTimeout(500);
    assert.ok(await input.isVisible(), '输入时移出不能折叠');
    await input.evaluate((node) => {
      node.setSelectionRange(node.value.length, node.value.length);
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(3)], 'note.png', { type: 'image/png' }));
      node.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForFunction(() =>
      document.querySelector('textarea').value.includes('![](brevia-note://'),
    );
    await page.locator('.capsule-stop').click();
    assert.ok(await input.isVisible(), '结束播放前必须先处理未保存的笔记');
    assert.ok((await page.locator('#capsule-error').innerText()).includes('保存'));
    await input.press('Control+Enter');
    await page.locator('#capsule-notes img').waitFor({ state: 'attached' });
    await page.locator('#capsule-edit-notes').click();
    await input.fill('我正在编辑');
    await page.evaluate(() => window.updateCapsule({ notes: '并发修改' }, true));
    await input.press('Control+Enter');
    await page.locator('#capsule-error').waitFor();
    assert.equal(await input.inputValue(), '我正在编辑', '冲突保留本地输入');
    await page.locator('#capsule-note-form button[type=button]').click();
    assert.ok((await page.locator('#capsule-notes').innerText()).includes('并发修改'));
    await page.locator('#capsule-edit-notes').click();
    await input.fill('会话结束时的草稿');
    await page.evaluate(() => {
      window.updateCapsule({ meetingId: null, phase: 'idle', expanded: false });
      window.updateCapsule({
        meetingId: '361aa4f4-d673-4548-9ad5-d851a739fbb5',
        phase: 'playing',
        expanded: true,
      });
    });
    assert.equal(await input.inputValue(), '会话结束时的草稿');
    assert.ok(await input.isVisible(), '返回同一场会议后可继续编辑');
    assert.deepEqual(errors, []);
    console.log(
      'Capsule: fade retention, interrupted close, reduced motion and playback context passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
