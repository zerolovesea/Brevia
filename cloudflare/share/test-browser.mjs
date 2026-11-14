import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const origin = process.env.SHARE_TEST_URL || 'http://localhost:8787';
const response = await fetch(origin + '/api/shares', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    days: 3,
    password: 'test-pass',
    snapshot: {
      title: '产品周会 · 分享验收',
      language: 'en',
      meeting_date: '2026-11-11',
      duration_ms: 2700000,
      markdown: [
        '# 会议纪要',
        '## 项目进展',
        '试点定于周五开始。〔00:01 · 00:02〕 [00:59] `〔00:01〕`',
        '1. **负责人**：李明\n   - 完成验收',
        '- [x] 验证通过',
        '事项 | 状态\n--- | ---\n试点 | ~~延期~~',
        '> 周五开始。',
        '```js\nconst value = "<div>";\n```',
        '[官网](https://brevia.work) · [危险](javascript:alert%281%29)',
        '<script>alert(1)</script>',
      ].join('\n\n'),
      transcript: [
        {
          text: '我们周五启动试点。',
          translation: 'We will start the pilot on Friday.',
          speaker: '李明',
          speaker_id: 'a',
          start_ms: 1200,
        },
        { text: '另一个同名参与者。', speaker: '李明', speaker_id: 'b', start_ms: 2000 },
      ],
      claims: [
        '测试覆盖不足，导致上线延迟。',
        '测试设备未到位',
        '缺少回滚演练',
        '审批尚未完成',
      ].map((text, index) => ({
        id: 'cause-' + (index + 1),
        text,
        section: '上线安排',
        sources: [{ text: '还缺少移动端回归，需要补齐。', speaker: '李明', start_ms: 2000 }],
      })),
    },
  }),
});
assert.equal(response.status, 201, await response.clone().text());
const { url } = await response.json();
const browser = await (process.env.SHARE_TEST_WEBKIT ? webkit : chromium).launch({
  headless: true,
});
const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'America/Los_Angeles' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('output/playwright', { recursive: true });
try {
  await page.goto(origin + new URL(url).pathname);
  await page.locator('#unlock').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.shared-brand img').getAttribute('alt'), 'Brevia');
  assert.ok(
    await page.locator('.shared-brand img').evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  const iconResponse = await fetch(new URL(icon, origin));
  assert.equal(iconResponse.status, 200);
  assert.match(iconResponse.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal(await iconResponse.text(), await readFile('website/assets/brevia-mark.svg', 'utf8'));

  assert.equal(await page.locator('#content').textContent(), '');
  await page.locator('#password').fill('wrong');
  await page.locator('#unlock button').click();
  await page.getByText('密码不正确', { exact: true }).waitFor();
  await page.route('**/api/shares/*', (route) => route.fulfill({ status: 429 }), { times: 1 });
  await page.locator('#unlock button').click();
  await page.getByText('尝试过多，请稍后再试', { exact: true }).waitFor();
  await page.locator('#password').fill('test-pass');
  await page.locator('#unlock button').click();
  await page.locator('#tabs').waitFor({ state: 'visible' });
  assert.match(await page.locator('#content').textContent(), /试点定于周五/);
  assert.equal(await page.locator('#content script').count(), 0);
  const extraCause = page.locator('[data-evidence-id="cause-4"] > summary');
  const curve = page.locator('.cause-tree-links > g').nth(3);
  assert.equal(await extraCause.isVisible(), false);
  await curve.waitFor({ state: 'hidden' });
  await page.locator('.cause-tree-more > summary').click();
  await extraCause.waitFor({ state: 'visible' });
  await curve.waitFor({ state: 'visible' });
  const article = page.locator('.shared-markdown');
  assert.equal(await article.locator('ol li ul li').textContent(), '完成验收');
  assert.ok(await article.locator('input[type="checkbox"]').isChecked());
  assert.equal(await article.locator('table tbody del').textContent(), '延期');
  assert.match(await article.locator('blockquote').textContent(), /周五开始/);
  assert.match(await article.locator('pre code').textContent(), /<div>/);
  assert.equal(await article.getByText('危险', { exact: true }).getAttribute('href'), null);
  assert.equal(
    await article.getByRole('link', { name: '官网' }).getAttribute('rel'),
    'noopener noreferrer',
  );
  assert.match(await article.evaluate((el) => getComputedStyle(el).fontFamily), /Manrope/);
  assert.ok(
    await page.evaluate(async () => {
      await document.fonts.load('16px Manrope');
      return document.fonts.check('16px Manrope');
    }),
  );
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh');
  assert.equal(await page.locator('#participants .speaker-avatar').count(), 2);
  assert.match(await page.locator('#participants').textContent(), /李明 · 1.*李明 · 2/);
  assert.ok(
    await page
      .locator('#participants')
      .evaluate((el) => el.nextElementSibling.classList.contains('shared-statistics')),
  );
  const views = await page.locator('#views').textContent();
  assert.match(views, /1/);
  assert.equal(await article.locator('.shared-time').count(), 2);
  assert.equal(await article.locator('code .shared-time').count(), 0);
  assert.match(await article.textContent(), /\[00:59\]/);
  const firstTime = article.getByRole('button', { name: '逐字稿 00:01' });
  await firstTime.hover();
  await page.getByRole('tooltip').getByText('我们周五启动试点。', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await firstTime.focus();
  await firstTime.press('Enter');
  assert.equal(await page.locator('[data-view="transcript"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.transcriptIndex), '0');
  await page.locator('[data-view="transcript"]').click();
  assert.match(await page.locator('#meeting-meta').textContent(), /45/);
  assert.match(await page.locator('#meeting-meta').textContent(), /2026\/11\/11/);
  assert.equal(await page.locator('.shared-segment > .speaker-avatar').count(), 2);
  assert.equal(
    await page.locator('[data-transcript-mode="comparison"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.deepEqual(
    await page.locator('.shared-segment').first().locator('.shared-speech p').allTextContents(),
    ['我们周五启动试点。', 'We will start the pilot on Friday.'],
  );
  await page.locator('[data-transcript-mode="original"]').click();
  await page.locator('[data-speaker-filter="0"]').click();
  assert.equal(await page.locator('.shared-segment').count(), 1);
  assert.match(await page.locator('.shared-segment').textContent(), /周五/);
  const languageButton = page.locator('#language summary');
  await languageButton.focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-language="en"]').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#language').getAttribute('open'), null);
  await languageButton.click();
  // 模拟 WebKit 点击按钮时旧控件失焦但目标不获焦的事件顺序。
  await languageButton.focus();
  await page.locator('[data-language="en"]').evaluate((button) =>
    button.addEventListener(
      'mousedown',
      (event) => {
        event.preventDefault();
        document.activeElement.blur();
      },
      { once: true },
    ),
  );
  await page.locator('[data-language="en"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.match(await page.locator('.shared-segment').textContent(), /周五/);
  assert.equal(await page.locator('#views').textContent(), '1');
  assert.match(await page.locator('#views').getAttribute('aria-label'), /1 views/);
  assert.equal(await page.locator('.shared-statistics svg').count(), 2);
  assert.ok(!(await page.locator('#expiry').textContent()).includes('Expires'));
  assert.equal(
    await page.locator('.shared-segment').getByText('We will start the pilot on Friday.').count(),
    0,
  );
  await page.locator('[data-transcript-mode="translation"]').click();
  assert.equal(
    await page.locator('.shared-speech p').textContent(),
    'We will start the pilot on Friday.',
  );
  await page.locator('[data-speaker-filter="1"]').click();
  assert.equal(await page.locator('.shared-segment').count(), 0);
  await page.getByText('No translation available', { exact: true }).waitFor();
  await page.locator('[data-view="summary"]').click();
  await article.locator('.shared-time').filter({ hasText: '00:01' }).click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.transcriptIndex), '0');
  assert.equal(
    await page.locator('[data-speaker-filter="all"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.locator('[data-transcript-mode="comparison"]').getAttribute('aria-pressed'),
    'true',
  );

  await page.locator('[data-speaker-filter="0"]').click();
  await page.locator('[data-transcript-mode="comparison"]').click();
  assert.deepEqual(await page.locator('.shared-speech p').allTextContents(), [
    '我们周五启动试点。',
    'We will start the pilot on Friday.',
  ]);
  await page.locator('[data-speaker-filter="1"]').click();
  assert.match(await page.locator('.shared-segment').textContent(), /另一个/);
  await page.locator('[data-speaker-filter="all"]').click();
  await languageButton.click();
  await page.locator('[data-language="zh"]').click();
  assert.equal(await page.locator('#views').textContent(), views);
  for (const scheme of ['light', 'dark'])
    for (const width of [1280, 390]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((s) => (document.documentElement.dataset.theme = s), scheme);
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ['summary', 'transcript']) {
        await page.locator(`[data-view="${tab}"]`).click();
        if (tab === 'summary') {
          assert.equal(await page.locator('.shared-review .shared-markdown').count(), 1);
          const boxes = await page.locator('.shared-review > *').evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return { x: r.x, y: r.y, bottom: r.bottom };
            }),
          );
          assert.ok(width > 760 ? boxes[1].x > boxes[0].x : boxes[1].y >= boxes[0].bottom);

          await page.locator('#content [data-evidence-id="cause-1"] > summary').click();
          assert.equal(await page.locator('[data-edit-evidence], [data-play-evidence]').count(), 0);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({
          path: `output/playwright/share-${scheme}-${width}-${tab}.png`,
          fullPage: true,
        });
      }
    }
  // 真实 Workers 存储验证并发计数，不能用内存 mock 代替。
  const publicShare = await fetch(origin + '/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      days: 3,
      snapshot: {
        title: 'Counter validation',
        language: 'en',
        markdown: 'Synthetic test [00:04] [00:00]',
        transcript: [
          { text: 'Legacy transcript', speaker: 'Speaker', start_ms: 0 },
          { text: 'First same-second segment', speaker: 'Guest', speaker_id: '', start_ms: 4100 },
          {
            text: 'Second same-second segment',
            speaker: 'Third',
            speaker_id: 'Guest',
            start_ms: 4800,
          },
        ],
        claims: [],
      },
    }),
  });
  assert.equal(publicShare.status, 201);
  const publicUrl = (await publicShare.json()).url;
  const endpoint = origin + new URL(publicUrl).pathname.replace('/s/', '/api/shares/');
  const counts = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const response = await fetch(endpoint);
      assert.equal(response.status, 200);
      return (await response.json()).views;
    }),
  );
  assert.deepEqual(
    counts.sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  console.log('20 concurrent reads counted without loss');

  await page.goto(origin + new URL(publicUrl).pathname);
  await page.locator('#tabs').waitFor({ state: 'visible' });
  assert.deepEqual(await page.locator('.shared-time').allTextContents(), ['00:00']);
  assert.match(await article.textContent(), /\[00:04\]/);
  await page.locator('[data-view="transcript"]').click();
  assert.equal(await page.locator('[data-transcript-mode]').count(), 0);
  await page.getByText('Legacy transcript', { exact: true }).waitFor();
  await page.locator('[data-speaker-filter="1"]').click();
  assert.deepEqual(await page.locator('.shared-segment p').allTextContents(), [
    'First same-second segment',
  ]);
  await page.route('**/api/shares/*', (route) => route.fulfill({ status: 404 }), { times: 1 });
  await page.reload();
  await page.getByText('链接不存在或已过期', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Password, transcript, summary, cause diagram, XSS and 8 responsive theme screenshots passed',
  );
} finally {
  await browser.close();
}
