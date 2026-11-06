const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LiveSubtitles, sentenceSubtitles, joinPending, timeAt } = require('./subtitles.cjs');
const fixture = require('./test-subtitles-golden.json');
const clean = ({ touched_at, ...value }) => value;
// 固定预期由原 Worker 的相同识别事件序列生成，保障接缝去重不会吞掉真实重复字。
test('Live subtitles preserve original tail-only holding, seam repair and paragraph behavior', () => {
  fixture.groups.forEach((group, index) => {
    const emitted = [],
      subtitles = new LiveSubtitles((value) => emitted.push(clean(value))),
      steps = [];
    for (const [event, text] of group) {
      subtitles.push(event, text);
      steps.push({ emitted: [...emitted], draft: subtitles.draft(event.track) });
    }
    assert.deepEqual(steps, fixture.results[index].steps);
    subtitles.flush();
    assert.deepEqual(emitted, fixture.results[index].final);
  });
});
test('Seam alignment preserves pauses and repairs partial re-decoding', () => {
  for (const [input, expected] of fixture.seams) assert.equal(joinPending(...input), expected);
});
test('Independent recognition units keep natural repetition and original time bounds', () => {
  const emitted = [],
    subtitles = new LiveSubtitles((value, spans) => emitted.push({ value, spans })),
    first = { segment_id: 'first', track: 'mic', start_ms: 0, end_ms: 3000, boundary: 'cut' },
    spans = [{ start: 3000, end: 6000 }];
  subtitles.publishUnit(first, '请确认。');
  subtitles.publishUnit(
    { ...first, segment_id: 'next', start_ms: 3000, end_ms: 6000 },
    '确认以后继续。',
    spans,
  );
  subtitles.publishUnit(
    { ...first, segment_id: 'system', track: 'system', start_ms: 5600, end_ms: 9000 },
    '继续继续。',
  );
  assert.deepEqual(
    emitted.map(({ value }) => value.text),
    ['请确认。', '确认以后继续。', '继续继续。'],
  );
  assert.equal(emitted[1].value.start_ms, 3000);
  assert.equal(emitted[1].value.end_ms, 6000);
  assert.deepEqual(emitted[1].spans, spans);
});
test('A duplicate-only lookback produces no punctuation caption and preserves the next seam', () => {
  const emitted = [],
    subtitles = new LiveSubtitles((value) => emitted.push(value)),
    event = { track: 'mic', start_ms: 0, end_ms: 20000, boundary: 'cut' };
  subtitles.publishUnit(event, '确认。');
  subtitles.publishUnit({ ...event, start_ms: 19600, end_ms: 20400 }, '确认。');
  assert.equal(emitted.length, 1);
  subtitles.publishUnit({ ...event, start_ms: 20000, end_ms: 22000 }, '确认后开始。');
  assert.deepEqual(
    emitted.map((value) => value.text),
    ['确认。', '后开始。'],
  );
});
test('Sentence splitting and word anchors match previous Unicode timing and refinement rules', () => {
  for (const [event, text, merge, expected] of fixture.sentences)
    assert.deepEqual(sentenceSubtitles(event, text, merge), expected);
  for (const [event, text, offsets, expected] of fixture.times)
    assert.deepEqual(
      offsets.map((offset) => timeAt(event, text, offset)),
      expected,
    );
});
