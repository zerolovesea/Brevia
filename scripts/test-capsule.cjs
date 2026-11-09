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
        meetingId: 'meeting',
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
        desktop: {
          state: async () => structuredClone(state),
          expand: async ({ expanded }) => {
            window.capsuleCalls.push(expanded);
            await new Promise((resolve) => setTimeout(resolve, 100));
            window.updateCapsule({ expanded });
          },
          action: async () => {},
          move: async () => {},
        },
      };
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, '../frontend/recording-capsule.html')).href,
    );
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
