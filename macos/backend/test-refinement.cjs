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

test('Spoken identifiers retain leading zeroes and collapse only mixed-script equivalents', () => {
  assert.equal(cleanText('NASA B52 F-35 A320 GPU'), 'NASA B52 F-35 A320 GPU');
  for (const [source, expected] of [
    ['零五四B用了全电力推进', '054B用了全电力推进'],
    [
      '零五四B这样的护卫舰，也能和零五五，055编程一组去执行任务。',
      '054B这样的护卫舰，也能和055编程一组去执行任务。',
    ],
    [
      '九零幺型最高航速大约二十五节，九零三型还不到二十节。',
      '901型最高航速大约25节，903型还不到20节。',
    ],
    ['〇五四B、零零一号、百分之零点五', '054B、001号、0.5%'],
    ['055，055；零五五和零五五；零五五，052；零五五，55', '055，055；055和055；055，052；055，55'],
    ['零五四B，054C；零五四B，054B', '054B，054C；054B'],
    ['055，零五五；055B，零五五B', '055；055B'],
    ['零五五，055.5；零五五，055%', '055，055.5；055，055%'],
    ['一零五四B、九零零一型、九零零一', '1054B、9001型、九零零一'],
    ['1055，零五五；九零五五，055', '1055，055；九零五五，055'],
    ['一五计划，一心一意，三五成群', '一五计划，一心一意，三五成群'],
  ]) {
    assert.equal(text.normalizeNumbers(source), expected);
    assert.equal(cleanText(source), expected);
    assert.equal(text.normalizeNumbers(expected), expected);
  }
});
