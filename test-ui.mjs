import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, js] = await Promise.all(['index.html', 'styles.css', 'app.js'].map((file) => readFile(file)));
const text = (value) => value.toString();

for (const id of ['home-view', 'prepare-view', 'live-view', 'detail-view', 'settings-view', 'meeting-form', 'end-meeting']) {
  assert.match(text(html), new RegExp(`id="${id}"`));
}
assert.match(text(css), /prefers-reduced-motion:\s*reduce/);
assert.match(text(js), /showView\('live'\)/);
assert.match(text(js), /showView\('detail'\)/);
assert.match(text(html), /id="language-toggle"/);
assert.match(text(js), /catalog\s*=\s*{/);
assert.match(text(css), /page-in/);
assert.match(text(css), /language-out/);
console.log('UI structure checks passed.');
