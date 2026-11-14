const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { schema } = require('./schema.cjs');

function resolveExisting(value) {
  try {
    return fs.realpathSync(value);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(resolveExisting(path.dirname(value)), path.basename(value));
  }
}
function safeChild(root, id, label = 'identifier') {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
    throw new Error('Invalid ' + label);
  const result = path.join(root, id);
  if (path.dirname(resolveExisting(result)) !== resolveExisting(root))
    throw new Error('Invalid ' + label);
  return result;
}
function atomicWrite(file, content) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
const utcNow = () => new Date().toISOString().replace('Z', '+00:00');
const expand = (value) => path.resolve(value.replace(/^~(?=\/|$)/, os.homedir()));

class StoreBase {
  constructor(root, options = {}) {
    this.root = expand(root);
    this.meetingsDir = expand(
      options.meetingsDir || process.env.BREVIA_MEETINGS_DIR || path.join(this.root, 'meetings'),
    );
    this.modelsDir = expand(
      options.modelsDir || process.env.BREVIA_MODELS_DIR || path.join(this.root, 'models'),
    );
    this.speakerProfilesDir = path.join(this.root, 'speaker-profiles');
    this.settings = options.settings || require('../../backend/settings.json');
    for (const dir of [this.root, this.meetingsDir, this.modelsDir, this.speakerProfilesDir])
      fs.mkdirSync(dir, { recursive: true });
    this.audioSessions = new Map();
    this.dbPath = path.join(this.root, 'brevia.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(schema);
    this.transaction(() => this.migrate());
  }
  query(sql, ...params) {
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row }));
  }
  one(sql, ...params) {
    const row = this.db.prepare(sql).get(...params);
    return row ? { ...row } : null;
  }
  run(sql, ...params) {
    return this.db.prepare(sql).run(...params);
  }
  transaction(fn) {
    const nested = (this.transactionDepth || 0) > 0;
    if (!nested) this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth = (this.transactionDepth || 0) + 1;
    try {
      const value = fn();
      if (value && typeof value.then === 'function')
        throw new Error('Storage transactions must be synchronous');
      if (!nested) this.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (!nested) this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  meetingDir(id) {
    return safeChild(this.meetingsDir, id, 'meeting id');
  }
  close() {
    this.closeAudioSessions?.();
    this.db.close();
  }
  migrate() {
    if (!this.one("SELECT 1 FROM app_meta WHERE key='glossary_examples_v1'")) {
      for (const [name, meaning] of [
        ['LLM', '大语言模型（Large Language Model），通过大量文本训练，可用于生成和理解语言。'],
        [
          'RAG',
          '检索增强生成（Retrieval-Augmented Generation），先检索相关资料，再用资料支持模型生成回答。',
        ],
        ['ASR', '自动语音识别（Automatic Speech Recognition），将语音转换为文字。'],
      ])
        this.run(
          "INSERT OR IGNORE INTO glossary_entries(scope,name,meaning) VALUES('',?,?)",
          name,
          meaning,
        );
      this.run("INSERT INTO app_meta(key,value) VALUES('glossary_examples_v1','1')");
    }
    const oldMeetings = new Set(this.query('PRAGMA table_info(meetings)').map((r) => r.name));
    const columns = {
      meetings: {
        summary_template: 'TEXT',
        meeting_date: 'TEXT',
        transcript_model_id: 'TEXT',
        workspace_id: 'TEXT REFERENCES workspaces(id) ON DELETE SET NULL',
        previous_workspace_id: 'TEXT',
        is_example: 'INTEGER NOT NULL DEFAULT 0',
        example_locale: 'TEXT',
        notes: "TEXT NOT NULL DEFAULT ''",
        speaker_segmentation_model_id: 'TEXT',
        num_speakers: 'INTEGER NOT NULL DEFAULT -1',
        vad_model_id: 'TEXT',
      },
      workspaces: { deleted_at: 'TEXT' },
      segments: { asr_text: 'TEXT', word_timestamps: 'TEXT' },
      speakers: { profile_id: 'TEXT' },
      speaker_profile_samples: { audio_path: 'TEXT', duration_ms: 'INTEGER NOT NULL DEFAULT 0' },
    };
    for (const [table, additions] of Object.entries(columns)) {
      const present = new Set(this.query(`PRAGMA table_info(${table})`).map((r) => r.name));
      for (const [name, type] of Object.entries(additions))
        if (!present.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    const version = this.one('PRAGMA user_version').user_version;
    if (version < 1) {
      const keys = this.query('PRAGMA table_info(segments)')
        .filter((r) => r.pk)
        .map((r) => r.name);
      if (JSON.stringify(keys) === JSON.stringify(['id', 'version'])) {
        this.db.exec(
          'CREATE TABLE segments_new (id TEXT NOT NULL,meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0,version TEXT NOT NULL,track TEXT NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,speaker TEXT NOT NULL,text TEXT NOT NULL,word_timestamps TEXT,translation TEXT,user_edited INTEGER NOT NULL DEFAULT 0,asr_text TEXT,PRIMARY KEY(meeting_id,id,version))',
        );
        this.db.exec(
          'INSERT INTO segments_new SELECT id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited,asr_text FROM segments',
        );
        this.db.exec(
          'DROP TABLE segments; ALTER TABLE segments_new RENAME TO segments; CREATE INDEX segments_meeting_time ON segments(meeting_id,start_ms)',
        );
      }
      const colors = ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'cyan', 'gray'];
      for (const [i, row] of this.query(
        "SELECT DISTINCT category FROM meetings WHERE category<>'' AND is_example=0",
      ).entries()) {
        let workspace = this.one(
          'SELECT id FROM workspaces WHERE id=? OR name=? COLLATE NOCASE',
          row.category,
          row.category,
        );
        if (workspace) this.run('UPDATE workspaces SET deleted_at=NULL WHERE id=?', workspace.id);
        else {
          workspace = { id: randomUUID() };
          this.run(
            "INSERT INTO workspaces(id,name,description,color,position,created_at,updated_at) VALUES(?,?,'',?,?,?,?)",
            workspace.id,
            row.category,
            colors[i % colors.length],
            i,
            utcNow(),
            utcNow(),
          );
        }
        this.run(
          "UPDATE meetings SET workspace_id=?,category='' WHERE category=?",
          workspace.id,
          row.category,
        );
      }
    }
    if (version < 2 || !oldMeetings.has('transcript_model_id'))
      this.db.exec(
        "UPDATE meetings SET transcript_model_id=refined_model_id WHERE EXISTS(SELECT 1 FROM segments s WHERE s.meeting_id=meetings.id AND (s.version='postprocess' OR s.version GLOB 'postprocess-*'))",
      );
    if (version < 2) this.db.exec('PRAGMA user_version=2');
    for (const column of ['streaming_model_id', 'power_saving'])
      if (oldMeetings.has(column)) this.db.exec(`ALTER TABLE meetings DROP COLUMN ${column}`);
    const examples = this.query(
      'SELECT DISTINCT workspace_id FROM meetings WHERE is_example=1 AND workspace_id IS NOT NULL',
    );
    this.db.exec("UPDATE meetings SET workspace_id=NULL,category='' WHERE is_example=1");
    for (const row of examples)
      this.run(
        'DELETE FROM workspaces WHERE id=? AND NOT EXISTS(SELECT 1 FROM meetings WHERE workspace_id=workspaces.id)',
        row.workspace_id,
      );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS segments_refinement_revision ON segments(meeting_id,revision DESC) WHERE version GLOB 'postprocess*' AND TRIM(text)<>''",
    );
    if (!this.one("SELECT 1 FROM app_meta WHERE key='correction_undo_entries_v1'")) {
      for (const row of this.query('SELECT meeting_id,data FROM transcript_corrections')) {
        const state = JSON.parse(row.data);
        for (const entry of state.undo?.entries || [])
          this.run(
            'INSERT OR REPLACE INTO correction_undo_entries(meeting_id,scope,segment_id,data) VALUES(?,?,?,?)',
            row.meeting_id,
            'transcript',
            entry.after.id,
            JSON.stringify(entry),
          );
        if (state.undo) delete state.undo.entries;
        for (const [scope, entry] of Object.entries(state.document_undo || {}))
          if ('before' in entry) {
            this.run(
              'INSERT OR REPLACE INTO correction_undo_entries(meeting_id,scope,segment_id,data) VALUES(?,?,?,?)',
              row.meeting_id,
              scope,
              '',
              JSON.stringify(entry),
            );
            state.document_undo[scope] = { count: entry.count };
          }
        this.run(
          'UPDATE transcript_corrections SET data=? WHERE meeting_id=?',
          JSON.stringify(state),
          row.meeting_id,
        );
      }
      this.run("INSERT INTO app_meta(key,value) VALUES('correction_undo_entries_v1','1')");
    }
  }
}
module.exports = { StoreBase, safeChild, resolveExisting, atomicWrite, utcNow };
