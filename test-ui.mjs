import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, js, uiData, components] = await Promise.all(['index.html', 'styles.css', 'app.js', 'ui-data.js', 'ui-components.js'].map((file) => readFile(file)));
const text = (value) => value.toString();

for (const id of ['home-view', 'prepare-view', 'live-view', 'detail-view', 'settings-view', 'meeting-form', 'end-meeting']) {
  assert.match(text(html), new RegExp(`id="${id}"`));
}
assert.match(text(css), /prefers-reduced-motion:\s*reduce/);
assert.match(text(js), /showView\('live'\)/);
assert.match(text(js), /showView\('detail'\)/);
assert.match(text(html), /id="language-toggle"/);
assert.match(text(html), /id="home-slogan"/);
assert.match(text(html), /id="mini-meeting"/);
assert.match(text(js), /catalog\s*=\s*{/);
assert.match(text(js), /renderSlogan/);
assert.match(text(js), /minimizeMeeting/);
assert.match(text(css), /page-in/);
assert.match(text(css), /language-out/);
assert.match(text(html), /data-settings-modal="summary-model"/);
assert.match(text(js), /summaryProviders/);
assert.match(text(js), /persistSummaryConfig/);
assert.match(text(components), /function renderTranscriptSegment/);
assert.match(text(components), /function renderMeetingSummary/);
assert.match(text(components), /function flowSelect/);
assert.match(text(js), /renderMeetingDetail\(\);/);
assert.match(text(components), /function renderMeetingRow/);
assert.match(text(components), /function renderModelRow/);
assert.match(text(components), /function renderSettingsCard/);
assert.match(text(components), /function renderParticipant/);
assert.match(text(components), /function renderStatusList/);
assert.match(text(js), /renderStaticViews\(\);/);
assert.match(text(js), /function renderPrepareSelects/);
assert.match(text(uiData), /const uiData/);
assert.match(text(html), /ui-data\.js[\s\S]*ui-components\.js[\s\S]*app\.js/);
console.log('UI structure checks passed.');
