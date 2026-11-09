import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../website/github-stars.js', import.meta.url), 'utf8');
const response = (stars) => ({ ok: true, json: async () => ({ stargazers_count: stars }) });

async function render(result, lang = 'en') {
  const counter = { textContent: '—' };
  let label = 'GitHub';
  let requests = 0;
  await runInNewContext(source, {
    document: {
      documentElement: { lang },
      querySelector: () => ({
        querySelector: () => counter,
        setAttribute: (_, value) => (label = value),
      }),
    },
    fetch: async (url, options) => {
      requests++;
      assert.equal(url, 'https://api.github.com/repos/zerolovesea/Brevia');
      assert.equal(options.credentials, 'omit');
      assert.ok(options.signal instanceof AbortSignal);
      if (result instanceof Error) throw result;
      return result;
    },
    AbortSignal,
    Intl,
  });
  assert.equal(requests, 1);
  return { text: counter.textContent, label };
}

assert.deepEqual(await render(response(69), 'zh-CN'), {
  text: '69',
  label: 'Brevia GitHub 仓库，69 颗星',
});
assert.deepEqual(await render(response(1234)), {
  text: '1.2K',
  label: 'Brevia on GitHub, 1,234 stars',
});
assert.equal((await render(response(0))).text, '0');
for (const result of [
  response(-1),
  response('69'),
  response(1.5),
  response(Number.MAX_SAFE_INTEGER + 1),
  { ok: false, status: 403 },
  { ok: true, json: async () => null },
  new Error('offline'),
  new DOMException('timeout', 'TimeoutError'),
]) {
  assert.deepEqual(await render(result), { text: '—', label: 'GitHub' });
}
console.log('PASS GitHub stars: localization, compact counts, validation, and offline fallback');

// 核对真实页面接线，避免只有孤立脚本测试通过。
for (const lang of ['en', 'zh']) {
  const html = readFileSync(new URL(`../website/index-${lang}.html`, import.meta.url), 'utf8');
  assert.match(html, /<script defer src="\.\/github-stars\.js"><\/script>/);
  assert.match(html, /<span data-github-stars aria-hidden="true">—<\/span>/);
}
