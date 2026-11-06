const assert = require('node:assert/strict');
const { test } = require('node:test');
const text = require('./refinement-text.cjs'),
  speakers = require('./refinement-speakers.cjs');
const { cleanText } = require('./subtitles.cjs');
const { clusterAsync } = require('./worker-refinement.cjs');
const fixture = require('./test-refinement-golden.json');
const argumentsFor = {
  joinPair: ['continuation'],
  stabilize: ['minimum_ms', 'merge_gap_ms', 'absorb_gap_ms'],
  deoverlap: ['maximum_overlap_ms'],
  refinementTurns: ['merge_gap_ms'],
  decodeRange: ['context_ms'],
  autoCluster: ['num_speakers'],
};
const startFor = {
  joinPair: 2,
  stabilize: 1,
  deoverlap: 1,
  refinementTurns: 3,
  decodeRange: 4,
  autoCluster: 2,
};
const functions = { ...text, ...speakers, cleanText };
// 快照由旧实现27个真实回归测试捕获，覆盖词窗去重、数字补全、聚类和说话人边界。
for (const [index, entry] of fixture.cases.entries())
  test('Refinement matches original ' + entry.method + ' case ' + index, () => {
    const args = structuredClone(entry.args),
      names = argumentsFor[entry.method] || [];
    for (const [key, value] of Object.entries(entry.kwargs)) {
      const at = names.indexOf(key);
      assert.notEqual(at, -1);
      args[startFor[entry.method] + at] = value;
    }
    if (entry.method === 'assembleUtterances')
      args[1] = fixture.settings.asr.refined_window_seconds * 2000;
    if (entry.method === 'autoCluster') {
      args[2] ??= -1;
      args[3] = fixture.settings.refinement;
    }
    assert.deepEqual(functions[entry.method](...args), entry.result);
  });
test('Speaker clustering runs off the event loop and terminates on cancellation', async () => {
  const result = await clusterAsync(
    [
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
    ],
    [4000, 4000, 4000, 4000],
    2,
    fixture.settings.refinement,
  );
  assert.equal(result[0], result[1]);
  assert.equal(result[2], result[3]);
  assert.notEqual(result[0], result[2]);
  const controller = new AbortController();
  const task = clusterAsync(
    Array.from({ length: 2000 }, (_, i) => [Math.sin(i), Math.cos(i)]),
    Array(2000).fill(4000),
    -1,
    fixture.settings.refinement,
    controller.signal,
  );
  controller.abort(new Error('Cancelled by test'));
  await assert.rejects(task, /Cancelled by test/);
});
