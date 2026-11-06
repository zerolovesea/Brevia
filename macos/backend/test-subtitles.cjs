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
test('Sentence splitting and word anchors match previous Unicode timing and refinement rules', () => {
  for (const [event, text, merge, expected] of fixture.sentences)
    assert.deepEqual(sentenceSubtitles(event, text, merge), expected);
  for (const [event, text, offsets, expected] of fixture.times)
    assert.deepEqual(
      offsets.map((offset) => timeAt(event, text, offset)),
      expected,
    );
});
