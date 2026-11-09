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
  const bundle = await handlers['meeting.bundle']({ meeting_id: 'export' });
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
