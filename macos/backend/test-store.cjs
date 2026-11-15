const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { Store } = require('./store.cjs');
const { wavInfo } = require('./audio-io.cjs');
const { TaskRegistry, TaskControl } = require('./tasks.cjs');
const { createExportHandlers } = require('./worker-exports.cjs');
const evidence = require('./meeting-evidence.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-store-test-')),
    store = new Store(root);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store };
}
test('capsule edits preserve later meeting notes and reject a stale base', (t) => {
  const { store } = setup(t);
  const id = 'capsule-notes';
  store.createMeeting({
    meeting_id: id,
    title: 'Meeting',
    language: 'zh',
    refined_model_id: 'test',
  });
  store.updateMeeting(id, { notes: 'original' });
  store.updateMeeting(id, { notes: 'phone' }, 'original');
  assert.throws(() => store.updateMeeting(id, { notes: 'capsule' }, 'original'), /重新核对/);
  assert.equal(store.getMeeting(id).notes, 'phone');
});
function readArchive(file) {
  if (process.platform === 'win32') {
    const script = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
      $zip = [IO.Compression.ZipFile]::OpenRead($env:BREVIA_TEST_ARCHIVE)
      try {
        $files = [ordered]@{}
        foreach ($entry in $zip.Entries) {
          $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
          try { $files[$entry.FullName] = $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
        [Console]::WriteLine((@{ names = @($files.Keys); files = $files } | ConvertTo-Json -Depth 4 -Compress))
      } finally { $zip.Dispose() }
    `;
    return JSON.parse(
      execFileSync(
        path.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { encoding: 'utf8', env: { ...process.env, BREVIA_TEST_ARCHIVE: file } },
      ),
    );
  }
  const names = execFileSync('/usr/bin/tar', ['-tf', file], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/);
  return {
    names,
    files: Object.fromEntries(
      names.map((name) => [
        name,
        execFileSync('/usr/bin/tar', ['-xOf', file, name.replace(/[\\?*\[\]]/g, '\\$&')], {
          encoding: 'utf8',
        }),
      ]),
    ),
  };
}
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['created_at', 'started_at', 'ended_at', 'updated_at'].includes(key)
          ? item
            ? 'DATE'
            : null
          : clean(item),
      ]),
    );
  return value;
}
// 固定快照由迁移前 Python Store 生成，覆盖持久化字段、纠错撤销及当前版本选择。
test('Store matches original data-layer snapshots through correction and refinement', (t) => {
  const { store: s } = setup(t),
    snapshots = [];
  function capture(name) {
    snapshots.push([name, s.getMeeting('golden'), s.metrics()]);
  }
  s.createMeeting({
    meeting_id: 'golden',
    title: '黄金验证',
    language: 'zh',
    refined_model_id: 'test',
    tags: ['重要'],
  });
  for (const [id, text] of [
    ['one', '北威亚和北威亚'],
    ['two', '我们使用北威亚'],
  ])
    s.saveSegment({
      meeting_id: 'golden',
      segment_id: id,
      text,
      start_ms: id === 'one' ? 0 : 1000,
      end_ms: id === 'one' ? 1000 : 2000,
      translation: 'old translation',
    });
  s.saveSummary('golden', { markdown: '北威亚的旧纪要' }, 'raw');
  capture('initial');
  const base = s.getMeeting('golden', true).segments[0];
  s.transcriptCorrection('golden', {
    action: 'replace',
    find: '北威亚',
    replacement: 'Brevia',
    future: true,
    matches: [
      {
        segment_id: 'one',
        text: base.text,
        version: base.version,
        revision: base.revision,
        occurrences: [0, 1],
      },
    ],
  });
  capture('replacement');
  const other = s.currentSegments('golden', 'two')[0];
  assert.throws(
    () =>
      s.transcriptCorrection('golden', {
        action: 'replace',
        find: '北威亚',
        replacement: '新版',
        future: true,
        confirm_rule: true,
        expected_rule_replacement: '先前的规则',
        matches: [
          {
            segment_id: 'two',
            text: other.text,
            version: other.version,
            revision: other.revision,
            occurrences: [0],
          },
        ],
      }),
    { code: 'error.transcript_rule_conflict' },
  );
  assert.equal(s.currentSegments('golden', 'two')[0].text, other.text);
  s.saveSegment({
    meeting_id: 'golden',
    segment_id: 'future',
    text: '新的北威亚',
    start_ms: 2000,
    end_ms: 3000,
  });
  capture('future');
  s.transcriptCorrection('golden', {
    scope: 'summary',
    action: 'replace',
    find: '北威亚',
    replacement: 'Brevia',
    document: { text: '北威亚的旧纪要', occurrences: [0] },
  });
  capture('document');
  s.transcriptCorrection('golden', { scope: 'summary', action: 'undo' });
  s.transcriptCorrection('golden', { action: 'undo' });
  capture('undo');
  s.replaceSegments(
    'golden',
    [
      {
        segment_id: 'ref',
        text: '精修😀北威亚',
        start_ms: 0,
        end_ms: 1000,
        translation: 'ref translated',
      },
    ],
    'postprocess',
    0,
    { model_id: 'test2', language: 'zh' },
  );
  s.saveSegmentTexts('golden', [{ segment_id: 'ref', text: '人工😀北威亚' }]);
  capture('refinement');
  s.saveTranslation('golden', 'ref', 'new translation', {
    expected_text: '人工😀北威亚',
    expected_version: ['user', 0],
    target_language: 'en',
  });
  capture('translation');
  assert.deepEqual(clean(snapshots), require('./test-store-golden.json'));
});

test('Evidence references, fenced code, headings and dates preserve original behavior', () => {
  const fixture = require('./test-evidence-golden.json');
  fixture.inputs.forEach((value, index) => {
    const [text, claims] = evidence.parseClaims(value, fixture.segments);
    for (const claim of claims) claim.id = 'CLAIM';
    assert.deepEqual(
      [text, evidence.resolveClaims(claims, fixture.segments, text)],
      fixture.results[index],
    );
  });
  const [cleaned, [cause]] = evidence.parseClaims(
    '- Cause：缺少资源 [[cause:S1]]',
    fixture.segments,
  );
  assert.equal(cleaned, '- 缺少资源 〔00:01〕');
  assert.equal(cause.line, cleaned);
  assert.equal(cause.text, '缺少资源');
  for (const [text, expected] of fixture.repair)
    assert.equal(evidence.normalizeSummaryMarkdown(text), expected);
  for (const [text, date, expected] of fixture.dates)
    assert.equal(evidence.annotateDates(text, date), expected);
  const [text, claims] = evidence.parseClaims('- 内容 [[decision:S1]]', fixture.segments);
  evidence.resolveClaims(
    claims,
    [fixture.segments[0], { ...fixture.segments[0], id: 'duplicate' }],
    text,
  );
  assert.equal(claims[0].status, 'changed');
});
test('Structured causes require both sides of a stated relation in the cited speech', () => {
  const headings = evidence.SUMMARY_HEADINGS.zh;
  const parse = (speech, row) =>
    evidence.parseClaims(
      '## ' + headings[2] + '\n### 延期\n- ' + row,
      [{ id: 'sample', text: speech, start_ms: 0 }],
      true,
      headings,
    )[1][0];
  assert.equal(
    parse('资源不足导致项目延期。', '资源不足导致项目延期 [[conclusion:S1]]').section,
    '项目延期',
  );
  for (const [speech, row] of [
    ['接口故障导致项目延期。', '资源不足导致项目延期 [[cause:S1]]'],
    ['资源不足导致项目延期。', '项目延期导致资源不足 [[conclusion:S1]]'],
    ['可能是资源不足导致项目延期。', '资源不足导致项目延期 [[cause:S1]]'],
    ['资源不足没有导致项目延期。', '资源不足导致项目延期 [[cause:S1]]'],
    ['资源不足导致项目延期吗？', '资源不足导致项目延期 [[cause:S1]]'],
    ['资源不足导致项目延期。', '资源不足导致项目延期 [[cause:S2]]'],
  ])
    assert.equal(parse(speech, row).kind, 'conclusion');
});
test('Result headings accept a reason after a speech pause and reject reversed or speculative edges', () => {
  const headings = evidence.SUMMARY_HEADINGS.zh;
  const kind = (speech, outcome, reason) =>
    evidence
      .parseClaims(
        '## ' + headings[2] + '\n### ' + outcome + '\n- ' + reason + ' [[cause:S1]]',
        [{ id: 'x', start_ms: 0, text: speech }],
        true,
        headings,
      )[1]
      .at(-1).kind;
  assert.equal(kind('整体还是收缩了。因为预算有限。', '整体收缩', '预算有限'), 'cause');
  assert.equal(kind('整体还是收缩了。因为预算有限。', '预算有限', '整体收缩'), 'conclusion');
  assert.equal(kind('整体还是收缩了。可能因为预算有限。', '整体收缩', '预算有限'), 'conclusion');
  assert.equal(kind('整体还是收缩了？因为预算有限？', '整体收缩', '预算有限'), 'conclusion');
});
test('Recover a cited cause only for a unique matching discussion, preserving uncertainty', () => {
  const headings = evidence.SUMMARY_HEADINGS.zh;
  const source = { id: 's', text: '资源可能不足，导致交付延期。', start_ms: 0 };
  const topic = '- 可用资源不足，交付延期。';
  const generate = (discussion) =>
    evidence
      .parseClaims(
        '## ' +
          headings[1] +
          '\n- 交付状态 [[conclusion:S1]]\n## ' +
          headings[2] +
          '\n' +
          discussion,
        [source],
        true,
        headings,
      )[1]
      .filter((claim) => claim.kind === 'cause');
  const first = '### 交付进度\n' + topic;
  const [claim] = generate(first);
  assert.match(claim.text, /可能不足/);
  assert.equal(claim.section, '交付延期');
  assert.deepEqual(generate(first + '\n### 其他进度\n' + topic), []);
});
test('Audio checkpoints survive reopening, silence gaps and rolled chunks preserve PCM', async (t) => {
  const { root, store } = setup(t);
  store.settings = { ...store.settings, audio: { ...store.settings.audio, chunk_seconds: 1 } };
  store.createMeeting({
    meeting_id: 'audio',
    title: 'Audio',
    language: 'zh',
    refined_model_id: 'test',
  });
  const samples = Buffer.alloc(32000);
  for (let i = 0; i < 16000; i++)
    samples.writeInt16LE(Math.round(Math.sin(i * 0.08) * 12000), i * 2);
  store.appendAudio('audio', 'mic', samples, 16000, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'meetings/audio/manifest.json'))).tracks.mic.samples,
    16000,
  );
  store.closeAudioSessions();
  store.appendAudio('audio', 'mic', samples, 16000, 2000);
  await store.finishMeeting('audio', 3000);
  const audio = store.audioFiles('audio').playback.mic,
    info = wavInfo(audio),
    bytes = fs.readFileSync(audio).subarray(info.offset);
  assert.equal(info.samples, 48000);
  assert.deepEqual(bytes.subarray(0, 32000), samples);
  assert.deepEqual(bytes.subarray(32000, 64000), Buffer.alloc(32000));
  assert.deepEqual(bytes.subarray(64000), samples);
  assert.equal(store.readManifest('audio').closed, true);
  assert.equal(store.recordedDurationMs('audio'), 3000);
  assert.equal(store.audioFiles('audio').mic.length, 3);
});
test('Exports create interoperable DOCX and ZIP64, and reject foreign paths', async (t) => {
  const { root, store } = setup(t),
    tasks = new TaskRegistry(),
    handlers = createExportHandlers({ store, tasks });
  store.createMeeting({
    meeting_id: 'export',
    title: '测试<标题>',
    language: 'zh',
    refined_model_id: 'test',
  });
  store.saveSegment({
    meeting_id: 'export',
    segment_id: 'one',
    start_ms: 0,
    end_ms: 1000,
    text: '测试 <script>alert(1)</script> 😀',
  });
  for (const content of ['notes', 'mynotes', 'analysis'])
    await assert.rejects(
      handlers['meeting.export']({ meeting_id: 'export', content, format: 'json' }),
      /Unsupported document export format/,
    );
  const docx = await handlers['meeting.export']({ meeting_id: 'export', format: 'docx' });
  assert.match(readArchive(docx.path).files['word/document.xml'], /&lt;script&gt;/);
  const read = t.mock.method(store, 'getMeeting');
  const bundle = await handlers['meeting.bundle']({ meeting_id: 'export' });
  assert.equal(read.mock.callCount(), 1);
  assert.equal(bundle.recording_included, false);
  assert.match(Object.values(readArchive(bundle.path).files).join('\n'), /测试/);
  const html = await handlers['meeting.export']({ meeting_id: 'export', format: 'pdf' });
  assert.equal(html.print_pdf, true);
  assert.doesNotMatch(fs.readFileSync(html.path, 'utf8'), /<script>/);
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'secret');
  const link = path.join(root, 'meetings/export/exports/escape.txt');
  fs.symlinkSync(outside, link);
  await assert.rejects(
    handlers['meeting.bundle-files']({
      meeting_id: 'export',
      files: [{ path: link, name: 'escape.txt' }],
    }),
    /Invalid archive source/,
  );
  const meeting = store.getMeeting('export');
  const [markdown, claims] = evidence.parseClaims(
    '## 议题讨论\n### 上线推迟\n- 缺少测试资源 [[cause:S1]]',
    meeting.segments,
  );
  store.saveSummary('export', { markdown, claims, language: 'zh' }, markdown);
  for (const format of ['md', 'txt', 'pdf', 'docx']) {
    const output = async (content) => {
      const file = (await handlers['meeting.export']({ meeting_id: 'export', format, content }))
        .path;
      return format === 'docx'
        ? readArchive(file).files['word/document.xml']
        : fs.readFileSync(file, 'utf8');
    };
    const minutes = await output('notes');
    const analysis = await output('analysis');
    assert.match(minutes, /议题讨论/);
    assert.doesNotMatch(minutes, /原因分析|alert/);
    assert.match(analysis, /原因分析/);
    assert.match(analysis, /alert/);
    assert.doesNotMatch(analysis, /议题讨论/);
  }
  const collision = await handlers['meeting.export']({ meeting_id: 'export', format: 'docx' });
  assert.notEqual(collision.path, docx.path);
});
test('Exports accept imported long filenames and produce portable archive names', async (t) => {
  const { store } = setup(t),
    handlers = createExportHandlers({ store, tasks: new TaskRegistry() }),
    title = 'a'.repeat(251) + '.wav';
  store.createMeeting({
    meeting_id: 'portable-export',
    title,
    language: 'en',
    refined_model_id: 'test',
  });
  store.saveSegment({
    meeting_id: 'portable-export',
    segment_id: 'one',
    start_ms: 0,
    end_ms: 1000,
    text: 'Kept transcript',
  });
  const first = await handlers['meeting.export']({ meeting_id: 'portable-export', format: 'md' }),
    second = await handlers['meeting.export']({ meeting_id: 'portable-export', format: 'md' });
  assert.notEqual(first.path, second.path);
  assert.ok(Buffer.byteLength(path.basename(first.path)) <= 255);
  assert.equal(fs.readFileSync(first.path, 'utf8').split('\n')[0], '# ' + title);
  for (const name of ['CON', 'LPT¹.notes', 'nul\u0000:name. ', '汉😀'.repeat(60)]) {
    store.updateMeeting('portable-export', { title: name });
    const archive = await handlers['meeting.bundle']({ meeting_id: 'portable-export' }),
      contents = readArchive(archive.path);
    assert.equal(contents.names.length, 2);
    for (const body of Object.values(contents.files)) assert.match(body, /Kept transcript/);
    if (name.startsWith('汉'))
      assert.ok(contents.names.every((filename) => filename.startsWith('汉😀')));
    for (const filename of [path.basename(archive.path), ...contents.names]) {
      assert.ok(Buffer.byteLength(filename) <= 255);
      assert.equal(filename, filename.toWellFormed());
      assert.doesNotMatch(filename, /[<>:"/\\|?*\x00-\x1f]/);
      assert.doesNotMatch(filename, /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i);
    }
  }
});
test('A stale correction rolls back edits and remembered terms together', (t) => {
  const { store } = setup(t);
  store.createMeeting({
    meeting_id: 'atomic',
    title: 'Atomic',
    language: 'zh',
    refined_model_id: 'test',
  });
  store.saveSegment({
    meeting_id: 'atomic',
    segment_id: 's',
    start_ms: 0,
    end_ms: 1000,
    text: '错词',
  });
  assert.throws(
    () =>
      store.transcriptCorrection('atomic', {
        action: 'replace',
        find: '错词',
        replacement: '正确',
        remember: { workspace_id: '', post_replace: true },
        matches: [
          { segment_id: 's', text: '陈旧内容', version: 'live', revision: 0, occurrences: [0] },
        ],
      }),
    (error) => error.code === 'error.transcript_conflict',
  );
  assert.deepEqual(store.workspaceTerms(''), []);
  assert.equal(store.getMeeting('atomic', true).segments[0].text, '错词');
  assert.throws(
    () =>
      store.createMeeting({
        meeting_id: '../escape',
        title: 'x',
        language: 'zh',
        refined_model_id: 'test',
      }),
    /Invalid meeting id/,
  );
});
test('Speaker profiles retain ownership and shared sample files until the final reference', (t) => {
  const { root, store } = setup(t),
    profile = store.ensureSpeakerProfile('张三'),
    directory = path.join(root, 'speaker-profiles', profile.id);
  fs.mkdirSync(directory);
  const audio = path.join(directory, 'sample.wav');
  fs.writeFileSync(audio, 'fixture');
  store.saveSpeakerProfileSample('张三', [1, 2, 3], 'source-1', profile.id, audio, 1000);
  store.saveSpeakerProfileSample('张三', [1, 2, 3], 'source-2', profile.id, audio, 1000);
  assert.throws(
    () => store.saveSpeakerProfileSample('李四', [1, 2, 3], 'source-1'),
    (error) => error.code === 'error.voice_sample_owned',
  );
  const samples = store.listSpeakerProfileSamples(profile.id);
  store.deleteSpeakerProfileSample(profile.id, samples[0].id);
  assert.equal(fs.existsSync(audio), true);
  store.deleteSpeakerProfileSample(profile.id, samples[1].id);
  assert.equal(fs.existsSync(audio), false);
  assert.equal(store.speakerProfile(profile.id).sample_count, 0);
});
test('Audio mixing stays responsive and cancellation removes partial output without altering saved tracks', async (t) => {
  const { store } = setup(t),
    { wavHeader } = require('./store-audio.cjs');
  store.createMeeting({
    meeting_id: 'mix',
    title: 'Mix',
    language: 'zh',
    refined_model_id: 'test',
  });
  const original = Buffer.alloc(16000 * 2 * 60);
  for (let i = 0; i < original.length / 2; i++)
    original.writeInt16LE(Math.round(Math.sin(i * 0.08) * 12000), i * 2);
  for (const track of ['mic', 'system'])
    fs.writeFileSync(
      store.checkedAudioPath('mix', 'playback-' + track + '.wav'),
      Buffer.concat([wavHeader(original.length), original]),
    );
  const target = store.checkedAudioPath('mix', 'playback-mix.wav'),
    previous = Buffer.from('previous output is preserved');
  fs.writeFileSync(target, previous);
  const control = new TaskControl();
  let turns = 0;
  const heartbeat = setInterval(() => turns++, 1);
  try {
    await assert.rejects(
      store.buildMix('mix', () => control.cancel(), { signal: control.signal, control }),
      /cancelled/,
    );
  } finally {
    clearInterval(heartbeat);
  }
  assert.ok(turns > 0);
  assert.deepEqual(fs.readFileSync(target), previous);
  assert.equal(fs.existsSync(target + '.tmp'), false);
  for (const track of ['mic', 'system']) {
    const file = store.checkedAudioPath('mix', 'playback-' + track + '.wav');
    assert.deepEqual(fs.readFileSync(file).subarray(44), original);
    fs.writeFileSync(file, Buffer.concat([wavHeader(32000), original.subarray(0, 32000)]));
  }
  await store.buildMix('mix');
  assert.equal(wavInfo(target).samples, 16000);
});
test('Legacy column order, segment keys and inline correction undo migrate without data loss', (t) => {
  const { DatabaseSync } = require('node:sqlite'),
    { schema } = require('./schema.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-schema-test-')),
    db = new DatabaseSync(path.join(root, 'brevia.db'));
  db.exec(schema);
  db.exec('ALTER TABLE speakers DROP COLUMN profile_id');
  db.exec('DROP TABLE segments');
  const oldSegments = schema
    .match(/CREATE TABLE IF NOT EXISTS segments \([\s\S]*?\n\);/)[0]
    .replace(/PRIMARY KEY\s*\(meeting_id,\s*id,\s*version\)/, 'PRIMARY KEY(id,version)');
  db.exec(oldSegments);
  db.prepare(
    "INSERT INTO meetings(id,title,language,refined_model_id,status,created_at) VALUES('old','Old','zh','test','ready','2020-01-01')",
  ).run();
  db.prepare(
    "INSERT INTO segments(id,meeting_id,version,track,start_ms,end_ms,speaker,text) VALUES('one','old','live','mic',0,1000,'spk-1','修改后')",
  ).run();
  const before = { id: 'one', version: 'live', revision: 0, text: '修改前' },
    after = { ...before, text: '修改后' };
  db.prepare('INSERT INTO transcript_corrections VALUES(?,?)').run(
    'old',
    JSON.stringify({
      rules: [],
      undo: { entries: [{ before, after }], count: 1 },
      summary_stale: false,
      stale_translations: [],
      revision: 1,
      document_undo: { notes: { before: 'before', after: 'after', count: 1 } },
    }),
  );
  db.close();
  const store = new Store(root);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(store.undoEntries('old', 'transcript'), [{ before, after }]);
  assert.equal(store.correctionState('old').undo.entries, undefined);
  assert.equal(store.undoEntries('old', 'notes')[0].before, 'before');
  store.setSegmentSpeaker('old', 'one', 'manual', null, '人工');
  assert.deepEqual(store.getMeeting('old', true).speakers, [
    { id: 'manual', name: '人工', profile_id: null, locked: 1 },
  ]);
  store.createMeeting({
    meeting_id: 'new',
    title: 'New',
    language: 'zh',
    refined_model_id: 'test',
  });
  store.saveSegment({
    meeting_id: 'new',
    segment_id: 'one',
    text: '另一场同编号',
    start_ms: 0,
    end_ms: 1000,
  });
  assert.equal(store.currentSegments('old')[0].text, '修改后');
  assert.equal(store.currentSegments('new')[0].text, '另一场同编号');
});
test('Workspace terminology searches historical spelling and survives workspace restoration', (t) => {
  const { store } = setup(t),
    workspace = store.createWorkspace({ name: 'Audio' });
  store.createMeeting({
    meeting_id: 'terms',
    title: 'Terms',
    language: 'zh',
    refined_model_id: 'test',
    workspace_id: workspace.id,
  });
  store.saveSegment({
    meeting_id: 'terms',
    segment_id: 'one',
    text: '我们使用北威亚',
    start_ms: 0,
    end_ms: 1000,
  });
  const term = {
    workspace_id: workspace.id,
    wrong: '北威亚',
    correct: 'Brevia',
    post_replace: false,
    hotword: false,
  };
  store.writeWorkspaceTerm(term);
  assert.equal(
    store.searchMeetings('我们使用Brevia')[0].snippets[0].matched_term,
    '我们使用北威亚',
  );
  store.writeWorkspaceTerm({ ...term, post_replace: true, hotword: true });
  const event = {
    meeting_id: 'terms',
    segment_id: 'two',
    text: '测试北威亚',
    start_ms: 1000,
    end_ms: 2000,
  };
  store.saveSegment(event);
  assert.equal(event.text, '测试Brevia');
  assert.equal(event.asr_text, '测试北威亚');
  store.deleteWorkspace(workspace.id);
  assert.equal(store.meetingExists('terms'), false);
  store.softDelete('terms', true);
  assert.equal(store.getMeeting('terms').workspace_id, workspace.id);
  assert.equal(store.getWorkspace(workspace.id).meeting_count, 1);
});
test('WAV parsing accepts system extensible PCM16 and rejects malformed or float subtypes', (t) => {
  const { root } = setup(t),
    { wavHeader } = require('./store-audio.cjs'),
    file = path.join(root, 'extensible.wav');
  // 取自 macOS afconvert 实际 Opus 转换输出的 40 字节 fmt 头。
  const systemFormat = Buffer.from(
    'feff0100803e0000007d00000200100016001000040000000100000000001000800000aa00389b71',
    'hex',
  );
  const chunk = (name, data, declared = data.length) => {
    const header = Buffer.alloc(8);
    header.write(name);
    header.writeUInt32LE(declared, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
  };
  const write = (format, declared) => {
    const body = Buffer.concat([
        Buffer.from('WAVE'),
        chunk('fmt ', format, declared),
        chunk('JUNK', Buffer.from([1, 2, 3])),
        chunk('data', Buffer.alloc(32)),
      ]),
      header = Buffer.alloc(8);
    header.write('RIFF');
    header.writeUInt32LE(body.length, 4);
    fs.writeFileSync(file, Buffer.concat([header, body]));
  };
  write(systemFormat);
  const info = wavInfo(file);
  assert.equal(info.channels, 1);
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.samples, 16);
  assert.equal(info.bytes, 32);
  for (const mutate of [
    (format) => format.writeUInt32LE(3, 24),
    (format) => format.writeUInt16LE(24, 18),
    (format) => format.writeUInt16LE(21, 16),
    (format) => format.writeUInt16LE(24, 16),
    (format) => format.writeUInt16LE(32, 14),
    (format) => format.writeUInt16LE(1, 12),
    (format) => format.writeUInt32LE(0, 4),
    (format) => format.writeUInt8(0, 39),
  ]) {
    const invalid = Buffer.from(systemFormat);
    mutate(invalid);
    write(invalid);
    assert.throws(() => wavInfo(file), /PCM16|format chunk/);
  }
  write(systemFormat.subarray(0, 38));
  assert.throws(() => wavInfo(file), /extensible PCM16/);
  write(systemFormat, 1000);
  assert.throws(() => wavInfo(file), /Invalid WAV format chunk/);
  fs.writeFileSync(file, Buffer.concat([wavHeader(32), Buffer.alloc(32)]));
  assert.equal(wavInfo(file).samples, 16);
  const floating = fs.readFileSync(file);
  floating.writeUInt16LE(3, 20);
  fs.writeFileSync(file, floating);
  assert.throws(() => wavInfo(file), /Expected PCM WAV/);
});

test('默认术语只补齐一次，保留自定义释义', (t) => {
  const { store } = setup(t);
  assert.deepEqual(
    store.glossary().entries.map((entry) => entry.name),
    ['ASR', 'LLM', 'RAG'],
  );
  store.updateGlossary({ action: 'save', workspace_id: '', name: 'LLM', meaning: '自定义释义' });
  store.run("DELETE FROM app_meta WHERE key='glossary_examples_v1'");
  store.transaction(() => store.migrate());
  assert.equal(
    store.glossary().entries.find((entry) => entry.name === 'LLM').meaning,
    '自定义释义',
  );
  assert.equal(store.glossary().entries.length, 3);
});

test('术语匹配仅使用本工作区和全局定义，挂起词可确认、恢复及清空', async (t) => {
  const { store } = setup(t);
  const ws = store.createWorkspace({ name: '术语验证' });
  const m = store.createMeeting({
    title: 'test',
    workspace_id: ws.id,
    language: 'zh',
    refined_model_id: 'test',
  });
  store.updateGlossary({ action: 'save', workspace_id: '', name: 'ACD', meaning: '平均通话时长' });
  const source = 'A C D 和小蓝盒';
  store.saveSegment({
    meeting_id: m.id,
    segment_id: 'glossary-source',
    start_ms: 3100,
    end_ms: 5100,
    text: source,
  });
  assert.deepEqual(store.glossarySource({ meeting_id: m.id, original: '小蓝盒' }), {
    text: source,
    start_ms: 3100,
    end_ms: 5100,
    audio_path: null,
  });
  assert.equal(store.glossarySource({ meeting_id: m.id, original: '不存在' }), null);
  const run = () =>
    require('./glossary-analysis.cjs').analyzeTerms(
      { store, emit() {} },
      { ...m, segments: [{ text: source }] },
      source,
      { context_size: 8192 },
      async () =>
        JSON.stringify({
          terms: [
            { original: 'A C D', match: 'ACD', quote: source },
            { original: '小蓝盒', match: null, quote: source },
            { original: '不存在', match: null },
          ],
        }),
      new TaskControl(),
    );
  await run();
  let mentions = store.glossary().mentions;
  assert.equal(mentions.length, 2);
  assert.equal(mentions.find((x) => x.original === 'A C D').name, null);
  assert.equal(mentions.find((x) => x.original === 'A C D').suggestion, 'ACD');
  store.updateGlossary({
    action: 'resolve',
    meeting_id: m.id,
    original: 'A C D',
    name: 'ACD',
    meaning: '平均通话时长',
    workspace_id: '',
  });
  assert.equal(
    store.glossaryDocument({ ...m, summary: { data: { markdown: 'A C D；XA C DY' } } }).summary.data
      .markdown,
    'ACD；XA C DY',
  );
  const markdown =
    'A C D [A C D](https://example.com/A C D) `A C D` ``A C D`` https://example.com/A%20C%20D\n[id]: https://example.com/A C D\n```\nA C D\n```';
  assert.equal(
    store.glossaryDocument({ ...m, summary: { data: { markdown } } }).summary.data.markdown,
    markdown.replace(/^A C D/, 'ACD'),
  );
  const { replaceGlossaryMarkdown } = require('../../frontend/glossary-markdown.js');
  assert.equal(
    replaceGlossaryMarkdown('ACD https://example.com/ACD', [{ original: 'ACD', name: '新名' }]),
    '新名 https://example.com/ACD',
  );
  assert.equal(
    replaceGlossaryMarkdown('旧词', [{ original: '旧词', name: 'A*[B](C)<D>&E' }]),
    'A\\*\\[B\\]\\(C\\)\\<D\\>&amp;E',
  );
  for (const [name, escaped] of [
    ['---', '\\-\\-\\-'],
    ['1. item', '1\\. item'],
    ['+ item', '\\+ item'],
    ['===', '\\=\\=\\='],
  ])
    assert.equal(replaceGlossaryMarkdown('旧词', [{ original: '旧词', name }]), escaped);
  store.updateGlossary({
    action: 'resolve',
    meeting_id: m.id,
    original: '小蓝盒',
    name: '蓝盒',
    meaning: '项目代号',
    workspace_id: ws.id,
  });
  store.updateGlossary({ action: 'dismiss', meeting_id: m.id, original: 'A C D' });
  await run();
  assert.deepEqual(
    store.glossary().mentions.map((x) => x.name),
    ['蓝盒'],
  );
  store.run('INSERT INTO glossary_mentions(meeting_id,original) VALUES(?,?)', m.id, '待确认');
  store.updateGlossary({ action: 'clear' });
  assert.deepEqual(
    store.glossary().mentions.map((x) => x.original),
    ['小蓝盒'],
  );
});

test('RY 首次建议 ROI 须确认，确认别名仅在语义匹配时复用', async (t) => {
  const { store } = setup(t);
  const meeting = store.createMeeting({
    title: '投放复盘',
    language: 'zh',
    refined_model_id: 'test',
  });
  const text = '投放成本100，收入120，RY为1.2。';
  store.saveSegment({
    meeting_id: meeting.id,
    segment_id: 'ry-source',
    start_ms: 0,
    end_ms: 1000,
    text,
  });
  let result = {
    original: 'RY',
    suggestion: 'ROI',
    meaning: '投资回报率',
    reason: '讨论投放成本与收入',
    quote: text,
  };
  const scan = () =>
    require('./glossary-analysis.cjs').analyzeTerms(
      { store, emit() {} },
      { ...meeting, segments: [{ text }] },
      text,
      { context_size: 8192 },
      async () => JSON.stringify({ terms: [result, { original: '不存在', suggestion: 'ABC' }] }),
      new TaskControl(),
    );
  await scan();
  assert.equal(store.glossary().mentions.length, 1);
  let term = store.glossary().mentions[0];
  assert.equal(term.name, null);
  assert.equal(term.suggestion, 'ROI');
  assert.equal(term.suggestion_meaning, '投资回报率');
  store.updateGlossary({
    action: 'resolve',
    meeting_id: meeting.id,
    original: 'RY',
    workspace_id: 'public',
    name: 'ROI',
    meaning: '投资回报率',
  });
  const second = store.createMeeting({
    title: '另一会议',
    language: 'zh',
    refined_model_id: 'test',
  });
  store.saveSegment({
    meeting_id: second.id,
    segment_id: 'another',
    start_ms: 0,
    end_ms: 1000,
    text,
  });
  result = { original: 'RY', match: 'ROI' };
  await require('./glossary-analysis.cjs').analyzeTerms(
    { store, emit() {} },
    { ...second, segments: [{ text }] },
    text,
    { context_size: 8192 },
    async () => JSON.stringify({ terms: [result] }),
    new TaskControl(),
  );
  assert.equal(store.glossary().mentions.find((m) => m.meeting_id === second.id).name, 'ROI');
  assert.ok(
    store.glossaryContext(second, text).some((t) => t.original === 'RY' && t.name === 'ROI'),
  );

  store.updateGlossary({ action: 'dismiss', meeting_id: second.id, original: 'RY' });
  await scan();
  assert.equal(store.glossary().mentions.filter((m) => m.meeting_id === second.id).length, 0);
});

test('术语含义局部核对保留原话、无关条目及并发人工改稿', async (t) => {
  const { store } = setup(t);
  const meeting = store.createMeeting({
    title: '核对ROI',
    language: 'zh',
    refined_model_id: 'test',
  });
  const text = '成本100，收入120，RY为1.2，还没确定是否扩大投放。';
  store.saveSegment({
    meeting_id: meeting.id,
    segment_id: 'source',
    start_ms: 0,
    end_ms: 1000,
    text,
  });
  store.run('INSERT INTO glossary_mentions(meeting_id,original) VALUES(?,?)', meeting.id, 'RY');
  store.updateGlossary({
    action: 'resolve',
    meeting_id: meeting.id,
    original: 'RY',
    workspace_id: 'public',
    name: 'ROI',
    meaning: '投资回报率',
  });
  const claim = {
    id: 'c1',
    kind: 'conclusion',
    text: 'RY为1.2。',
    line: '- RY为1.2。',
    sources: [{ text, start_ms: 0, segment_id: 'source' }],
  };
  const before = {
    markdown: `## 摘要

- RY为1.2。
- 下周复盘。`,
    claims: [claim],
  };
  store.saveSummary(meeting.id, before, '');
  const { reviewGlossary } = require('./glossary-review.cjs');
  const generate = async (_options, prompt = '') =>
    JSON.stringify(
      prompt.startsWith('Verify')
        ? { supported: true, quote: text }
        : { updates: [{ id: 'c1', text: 'ROI为1.2，尚未确定扩大投放。' }] },
    );
  const result = await reviewGlossary(
    { store },
    { meeting_id: meeting.id, original: 'RY' },
    generate,
    new TaskControl(),
  );
  assert.ok(result.summary.markdown.includes('尚未确定扩大投放'));
  assert.ok(result.summary.markdown.includes('- 下周复盘。'));
  assert.equal(result.summary.claims[0].sources[0].text, text);
  assert.ok(result.summary.claims[0].text.includes('RY'));
  store.saveSummary(meeting.id, before, '');
  const ignored = await reviewGlossary(
    { store },
    { meeting_id: meeting.id, original: 'RY' },
    async () => {
      store.saveSummary(meeting.id, { ...before, markdown: '人工改稿' }, '');
      return generate();
    },
    new TaskControl(),
  );
  assert.deepEqual(ignored, {});
  assert.equal(store.getMeeting(meeting.id, true).summary.data.markdown, '人工改稿');
});

test('工作区别名覆盖全局，局部核对拒绝否定翻转', async (t) => {
  const { store } = setup(t);
  const meeting = store.createMeeting({ title: 'RY', language: 'zh', refined_model_id: 'test' });
  const text = '这批投放的RY没有跑正，下周再看。';
  store.saveSegment({ meeting_id: meeting.id, segment_id: 's1', start_ms: 0, end_ms: 1000, text });
  store.run('INSERT INTO glossary_mentions(meeting_id,original) VALUES(?,?)', meeting.id, 'RY');
  store.updateGlossary({
    action: 'resolve',
    meeting_id: meeting.id,
    original: 'RY',
    workspace_id: '',
    name: 'ROI',
    meaning: '投资回报率',
  });
  const before = {
    markdown: '- RY没有跑正。',
    claims: [
      {
        id: 'c1',
        kind: 'conclusion',
        text: 'RY没有跑正。',
        line: '- RY没有跑正。',
        sources: [{ text, start_ms: 0 }],
      },
    ],
  };
  store.saveSummary(meeting.id, before, '');
  const result = await require('./glossary-review.cjs').reviewGlossary(
    { store },
    { meeting_id: meeting.id, original: 'RY' },
    async () =>
      JSON.stringify({
        updates: [{ id: 'c1', text: 'ROI已经跑正。' }],
        supported: true,
        quote: text,
      }),
    new TaskControl(),
  );
  assert.deepEqual(result, {});
  assert.equal(store.getMeeting(meeting.id, true).summary.data.markdown, before.markdown);
  store.updateGlossary({
    action: 'save',
    workspace_id: 'public',
    name: 'Retail Yield',
    meaning: '内部项目名称',
  });
  store.run(
    'INSERT INTO glossary_aliases(scope,original,name) VALUES(?,?,?)',
    'public',
    'RY',
    'Retail Yield',
  );
  assert.equal(
    store.glossaryContext(meeting, text).find((t) => t.original === 'RY').name,
    'Retail Yield',
  );
  const next = store.createMeeting({ title: 'next', language: 'zh', refined_model_id: 'test' });
  store.saveSegment({ meeting_id: next.id, segment_id: 's2', start_ms: 0, end_ms: 1000, text });
  await require('./glossary-analysis.cjs').analyzeTerms(
    { store, emit() {} },
    { ...next, segments: [{ text }] },
    text,
    { context_size: 8192 },
    async () => JSON.stringify({ terms: [{ original: 'RY', match: 'ROI', quote: text }] }),
    new TaskControl(),
  );
  assert.equal(store.glossary().mentions.find((m) => m.meeting_id === next.id).name, null);
});

test('术语服务返回空对象时重试普通JSON，空候选数组与结构错误区分', async (t) => {
  const { store } = setup(t);
  const m = store.createMeeting({ title: '兼容JSON', language: 'zh', refined_model_id: 'test' });
  const text = '投放成本100，收入120，RY为1.2。';
  store.saveSegment({ meeting_id: m.id, segment_id: 's1', start_ms: 0, end_ms: 1000, text });
  const modes = [];
  const scan = (generate) => {
    store.run('DELETE FROM glossary_scans WHERE meeting_id=?', m.id);
    return require('./glossary-analysis.cjs').analyzeTerms(
      { store, emit() {} },
      { ...m, segments: [{ text }] },
      text,
      { context_size: 8192 },
      generate,
      new TaskControl(),
    );
  };
  await scan(async (_options, _prompt, request) => {
    modes.push(request.jsonMode);
    return request.jsonMode
      ? '{"terms":[{}]}'
      : JSON.stringify({
          terms: [
            {
              original: 'RY',
              suggestion: 'ROI',
              meaning: '投资回报率',
              reason: '投放回报语境',
              quote: text,
            },
          ],
        });
  });
  assert.deepEqual(modes, [true, false]);
  assert.equal(store.glossary().mentions.find((m) => m.original === 'RY').suggestion, 'ROI');
  let calls = 0;
  await scan(async () => {
    calls++;
    return '{"terms":[]}';
  });
  assert.equal(calls, 1);
  await assert.rejects(
    scan(async () => '{"terms":[{}]}'),
    /candidate spelling is missing/,
  );
  await assert.rejects(
    scan(async () => 'null'),
    /candidate spelling is missing/,
  );
});

test('术语输出截断时按原文边界拆分重试，保留取消支持', async (t) => {
  const { store } = setup(t);
  const m = store.createMeeting({ title: '长段术语', language: 'zh', refined_model_id: 'test' });
  const text = '讨论内部指标及投放成本。'.repeat(180);
  store.saveSegment({ meeting_id: m.id, segment_id: 's1', start_ms: 0, end_ms: 1000, text });
  let truncated = 0,
    completed = 0;
  await require('./glossary-analysis.cjs').analyzeTerms(
    { store, emit() {} },
    { ...m, segments: [{ text }] },
    text,
    { context_size: 8192 },
    async (_options, prompt) => {
      const part = prompt.split('\nTranscript:\n')[1];
      if (part.length > 600) {
        truncated++;
        throw new Error('Model response reached the output limit');
      }
      completed++;
      return '{"terms":[]}';
    },
    new TaskControl(),
  );
  assert.ok(truncated > 0);
  assert.ok(completed > 0, '相同拆分片段只扫描一次');
});

test('术语候选拒绝普通单字与错位原话，允许完整名词及已确认单字', async (t) => {
  const { store } = setup(t);
  const m = store.createMeeting({ title: '误报回归', language: 'zh', refined_model_id: 'test' });
  const first = '其实整体还是收缩了，因为预算有限。';
  const second = '其他确期也是各家单独定制的。';
  for (const [index, text] of [first, second].entries())
    store.saveSegment({
      meeting_id: m.id,
      segment_id: 's' + index,
      start_ms: index * 1000,
      end_ms: index * 1000 + 900,
      text,
    });
  const scan = (terms) =>
    require('./glossary-analysis.cjs').analyzeTerms(
      { store, emit() {} },
      {
        ...m,
        segments: [
          { text: first, start_ms: 0 },
          { text: second, start_ms: 1000 },
        ],
      },
      first + '\n' + second,
      { context_size: 8192 },
      async () => JSON.stringify({ terms }),
      new TaskControl(),
    );
  await scan([
    { original: '其', reason: '其本身无独立问题', quote: second },
    { original: '确期', suggestion: '续期', meaning: '保险续期业务', quote: second },
    { original: '预算', quote: '另一个不存在的预算片段' },
  ]);
  assert.deepEqual(
    store.glossary().mentions.map((m) => m.original),
    ['确期'],
  );
  assert.deepEqual(store.glossarySource({ meeting_id: m.id, original: '确期' }), {
    text: second,
    start_ms: 1000,
    end_ms: 1900,
    audio_path: null,
  });
  store.run(
    'INSERT INTO glossary_mentions(meeting_id,original,source_quote) VALUES(?,?,?)',
    m.id,
    '其',
    second,
  );
  assert.ok(!store.glossary().mentions.some((m) => m.original === '其'));
  assert.equal(store.glossarySource({ meeting_id: m.id, original: '其' }), null);
  store.run(
    'UPDATE glossary_mentions SET source_quote=? WHERE meeting_id=? AND original=?',
    '已被改掉的确期原话',
    m.id,
    '确期',
  );
  assert.equal(store.glossarySource({ meeting_id: m.id, original: '确期' }), null);
  store.updateGlossary({
    action: 'save',
    workspace_id: 'public',
    name: '熵',
    meaning: '不确定性度量',
  });
  const third = '熵是本次模型的度量指标。';
  store.saveSegment({
    meeting_id: m.id,
    segment_id: 's2',
    start_ms: 2000,
    end_ms: 2900,
    text: third,
  });
  await require('./glossary-analysis.cjs').analyzeTerms(
    { store, emit() {} },
    { ...m, segments: [first, second, third].map((text, i) => ({ text, start_ms: i * 1000 })) },
    third,
    { context_size: 8192 },
    async () => JSON.stringify({ terms: [{ original: '熵', match: '熵', quote: third }] }),
    new TaskControl(),
  );
  assert.equal(store.glossary().mentions.find((m) => m.original === '熵').name, '熵');
});

test('术语扫描拒绝句子、去重缩写，重复生成复用已扫描片段，确认后提示重新生成', async (t) => {
  const { store } = setup(t);
  const m = store.createMeeting({ title: '队列验收', language: 'zh', refined_model_id: 'test' });
  const text =
    '这个url指的是一个组。URL、u r l用于链接，前端的R Y是指标，RY需要核对。成本比较高。他一条1毛，咱们一条一分。我幺八幺九二幺幺八六幺八六八二。';
  store.saveSegment({ meeting_id: m.id, segment_id: 's1', start_ms: 2000, end_ms: 7000, text });
  const audio = require('node:path').join(store.meetingDir(m.id), 'audio/playback-mic.wav');
  require('node:fs').writeFileSync(audio, Buffer.alloc(44));
  const worker = { store, emit() {} };
  const meeting = () => ({
    ...store.getMeeting(m.id, true),
    segments: store.currentSegments(m.id),
  });
  let calls = 0;
  const generate = async () => {
    calls++;
    return JSON.stringify({
      terms: [
        '这个url指的是一个组',
        '成本比较高。他一条1毛，咱们一条一分',
        '我幺八幺九二幺幺八六幺八六八二',
        '前端的R Y',
        'URL',
        'u r l',
        'RY',
        'R Y',
      ].map((original) => ({ original, quote: text, reason: '含义需要核对' })),
    });
  };
  const scan = () =>
    require('./glossary-analysis.cjs').analyzeTerms(
      worker,
      meeting(),
      text,
      { model: 'test', context_size: 8192 },
      generate,
      new TaskControl(),
    );
  await scan();
  assert.equal(calls, 1);
  assert.deepEqual(
    store.glossary().mentions.map((m) => m.original),
    ['RY', 'URL'],
  );
  assert.equal(worker.glossaryScans.size, 0, '扫描结束清理运行状态');
  await scan();
  assert.equal(calls, 1, '重复生成不再花token扫描相同原文和词库');
  const source = store.glossarySource({ meeting_id: m.id, original: 'URL' });
  assert.deepEqual(source, { text, start_ms: 2000, end_ms: 7000, audio_path: audio });
  store.run(
    'INSERT INTO glossary_mentions(meeting_id,original,source_quote) VALUES(?,?,?)',
    m.id,
    'u r l',
    text,
  );
  store.run(
    'INSERT INTO glossary_mentions(meeting_id,original,source_quote) VALUES(?,?,?)',
    m.id,
    '这个url指的是一个组',
    text,
  );
  assert.equal(store.glossary().mentions.length, 2, '历史噪声和变体也不计入待处理');
  store.updateGlossary({ action: 'dismiss', meeting_id: m.id, original: 'URL' });
  assert.deepEqual(
    store.glossary().mentions.map((m) => m.original),
    ['RY'],
    '排除术语同时排除其变体',
  );
  store.saveSummary(m.id, { markdown: '## 会议摘要\n\nRY需要核对。' }, '');
  store.updateGlossary({
    action: 'resolve',
    meeting_id: m.id,
    original: 'RY',
    name: 'ROI',
    meaning: '投资回报率',
    workspace_id: 'public',
  });
  assert.equal(store.glossary().regeneration[0].id, m.id);
  const revision = store.one(
    'SELECT revision FROM glossary_revisions WHERE meeting_id=?',
    m.id,
  ).revision;
  store.saveSummary(
    m.id,
    { markdown: '## 会议摘要\n\nROI需要核对。', glossary_revision: revision },
    '',
  );
  assert.equal(store.glossary().regeneration.length, 0);
  store.updateGlossary({
    action: 'resolve',
    meeting_id: m.id,
    original: 'RY',
    name: 'ROI',
    meaning: '本场指投放收入除以支出',
    workspace_id: 'public',
  });
  store.saveSummary(m.id, { markdown: '旧快照成稿', glossary_revision: revision }, '');
  assert.equal(
    store.glossary().regeneration.length,
    1,
    '生成期间确认新术语，旧快照成稿仍提示重新生成',
  );
});

test('术语扫描缓存隔离工作区，移区后重新确认匹配作用域', async (t) => {
  const { store } = setup(t);
  const a = store.createWorkspace({ name: 'A' }),
    b = store.createWorkspace({ name: 'B' });
  const m = store.createMeeting({
    title: '移区验证',
    language: 'zh',
    refined_model_id: 'test',
    workspace_id: a.id,
  });
  const text = '投放成本100，收入120，RY为1.2。';
  store.saveSegment({ meeting_id: m.id, segment_id: 's1', start_ms: 0, end_ms: 1000, text });
  for (const scope of [a.id, b.id]) {
    store.updateGlossary({
      action: 'save',
      workspace_id: scope,
      name: 'ROI',
      meaning: '投资回报率',
    });
    store.run('INSERT INTO glossary_aliases VALUES(?,?,?)', scope, 'RY', 'ROI');
  }
  let calls = 0;
  const scan = () =>
    require('./glossary-analysis.cjs').analyzeTerms(
      { store, emit() {} },
      { ...store.getMeeting(m.id, true), segments: store.currentSegments(m.id) },
      text,
      { context_size: 8192 },
      async () => {
        calls++;
        return JSON.stringify({ terms: [{ original: 'RY', match: 'ROI', quote: text }] });
      },
      new TaskControl(),
    );
  await scan();
  assert.equal(store.glossary().mentions[0].scope, a.id);
  store.run('UPDATE meetings SET workspace_id=? WHERE id=?', b.id, m.id);
  await scan();
  assert.equal(calls, 2);
  assert.equal(store.glossary().mentions[0].scope, b.id);
});

test('术语取消或原文并发变化不缓存未完成扫描，运行状态始终收尾', async (t) => {
  const { store } = setup(t);
  const m = store.createMeeting({ title: '取消核验', language: 'zh', refined_model_id: 'test' });
  const text = 'RY需要确认。';
  const segment = { meeting_id: m.id, segment_id: 's1', start_ms: 0, end_ms: 1000, text };
  store.saveSegment(segment);
  const worker = { store, emit() {} };
  const snapshot = { ...m, segments: store.currentSegments(m.id) };
  const scan = (generate, control = new TaskControl()) =>
    require('./glossary-analysis.cjs').analyzeTerms(
      worker,
      snapshot,
      text,
      { context_size: 8192 },
      generate,
      control,
    );
  const control = new TaskControl();
  await assert.rejects(
    scan(async () => {
      control.cancel();
      return '{"terms":[]}';
    }, control),
    { name: 'TaskCancelled' },
  );
  assert.equal(store.one('SELECT COUNT(*) n FROM glossary_scans').n, 0);
  assert.equal(worker.glossaryScans.size, 0);
  await scan(async () => {
    store.saveSegment({ ...segment, text: '改为确认ROI。' });
    return JSON.stringify({ terms: [{ original: 'RY', quote: text }] });
  });
  assert.equal(store.one('SELECT COUNT(*) n FROM glossary_scans').n, 0);
  assert.equal(store.glossary().mentions.length, 0);
  assert.equal(worker.glossaryScans.size, 0);
});

test('术语回听只读取长录音中的原句，确认建议允许空释义并保留已有定义', (t) => {
  const { store } = setup(t),
    fs = require('node:fs'),
    path = require('node:path');
  const { wavHeader } = require('./store-audio.cjs');
  const m = store.createMeeting({ title: '长录音回听', language: 'zh', refined_model_id: 'test' });
  const text = 'H5指网页技术。';
  store.saveSegment({ meeting_id: m.id, segment_id: 'h5', text, start_ms: 728000, end_ms: 730000 });
  store.run(
    'INSERT INTO glossary_mentions(meeting_id,original,source_quote) VALUES(?,?,?)',
    m.id,
    'H5',
    text,
  );
  const audio = path.join(store.meetingDir(m.id), 'audio/playback-mic.wav');
  const fd = fs.openSync(audio, 'w'),
    bytes = 110 * 60 * 32000;
  fs.writeSync(fd, wavHeader(bytes));
  fs.ftruncateSync(fd, 44 + bytes);
  const expected = Buffer.alloc(64000, 23);
  fs.writeSync(fd, expected, 0, expected.length, 44 + 728 * 32000);
  fs.closeSync(fd);
  for (let i = 0; i < 3; i++) {
    const clip = Buffer.from(
      store.glossaryAudio({ meeting_id: m.id, original: 'H5' }).split(',')[1],
      'base64',
    );
    assert.equal(clip.length, 64044);
    assert.deepEqual(clip.subarray(44), expected);
  }
  store.updateGlossary({
    action: 'resolve',
    meeting_id: m.id,
    original: 'H5',
    workspace_id: 'public',
    name: 'H5',
    meaning: '',
  });
  assert.equal(store.glossary().mentions[0].name, 'H5');
  store.updateGlossary({ action: 'save', workspace_id: 'public', name: 'H5', meaning: '网页技术' });
  store.updateGlossary({
    action: 'resolve',
    meeting_id: m.id,
    original: 'H5',
    workspace_id: 'public',
    name: 'H5',
    meaning: '',
  });
  assert.equal(store.glossary().entries.find((e) => e.name === 'H5').meaning, '网页技术');
});

test('术语默认适中并保留自选等级，关闭后不请求模型且词条保留', async (t) => {
  const { store } = setup(t);
  assert.deepEqual(store.glossarySettings(), { enabled: true, sensitivity: 'balanced' });
  store.updateGlossary({ action: 'settings', enabled: true, sensitivity: 'low' });
  assert.equal(store.glossarySettings().sensitivity, 'low');
  const m = store.createMeeting({ title: '灵敏度', language: 'zh', refined_model_id: 'test' }),
    text = 'RY和小蓝盒需要确认。';
  store.saveSegment({ meeting_id: m.id, segment_id: 't', start_ms: 0, end_ms: 1000, text });
  let calls = 0;
  const scan = () =>
    require('./glossary-analysis.cjs').analyzeTerms(
      { store, emit() {} },
      { ...m, segments: store.currentSegments(m.id) },
      text,
      { context_size: 8192, terminology_sensitivity: store.glossarySettings().sensitivity },
      async () => {
        calls++;
        return JSON.stringify({
          terms: [
            { original: 'RY', suggestion: 'ROI', priority: 'high', quote: text },
            { original: '小蓝盒', priority: 'normal', quote: text },
          ],
        });
      },
      new TaskControl(),
    );
  await scan();
  assert.deepEqual(
    store.glossary().mentions.map((x) => x.original),
    ['RY'],
  );
  store.updateGlossary({ action: 'settings', enabled: true, sensitivity: 'balanced' });
  await scan();
  assert.equal(store.glossary().mentions.length, 2);
  store.updateGlossary({ action: 'settings', enabled: false, sensitivity: 'low' });
  await scan();
  assert.equal(calls, 2);
  assert.equal(store.glossary().mentions.length, 2);
  assert.equal(store.glossary().settings.enabled, false);
});
