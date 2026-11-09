const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { utcNow } = require('./store-base.cjs');
const {
  TEMPLATES,
  confirmedDate,
  parseClaims,
  resolveClaims,
  latestSegments,
  normalizeSummaryMarkdown,
} = require('./meeting-evidence.cjs');
const counts =
  "CASE WHEN EXISTS(SELECT 1 FROM speaker_turns st WHERE st.meeting_id=m.id AND st.version='postprocess') THEN (SELECT COUNT(DISTINCT speaker) FROM speaker_turns st WHERE st.meeting_id=m.id AND st.version='postprocess') ELSE (SELECT COUNT(DISTINCT speaker) FROM segments s WHERE s.meeting_id=m.id) END AS speaker_count,EXISTS(SELECT 1 FROM summaries s WHERE s.meeting_id=m.id AND s.data IS NOT NULL) AS has_summary";
const meetingRow = (row) => ({ ...row, tags: JSON.parse(row.tags) });
const like = (value) => '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
module.exports = {
  createMeeting(payload) {
    const mid = payload.meeting_id || randomUUID(),
      now = utcNow(),
      speakers = payload.num_speakers ?? -1,
      template = payload.summary_template ?? null;
    if (template !== null && !Object.hasOwn(TEMPLATES, template))
      throw new Error('Unknown meeting template');
    if (!Number.isInteger(speakers) || speakers < -1 || speakers === 0)
      throw new Error('Invalid speaker count');
    const folder = this.meetingDir(mid);
    if (fs.existsSync(folder)) throw new Error('Meeting data already exists');
    try {
      fs.mkdirSync(path.join(folder, 'audio'), { recursive: true });
      fs.mkdirSync(path.join(folder, 'exports'));
      this.writeManifest(mid, { meeting_id: mid, closed: false, tracks: {} });
      this.transaction(() => {
        if (
          payload.workspace_id &&
          !this.one('SELECT 1 FROM workspaces WHERE id=?', payload.workspace_id)
        )
          throw new Error('Workspace not found');
        this.run(
          'INSERT INTO meetings(id,title,language,target_language,refined_model_id,speaker_segmentation_model_id,vad_model_id,num_speakers,workspace_id,tags,status,meeting_date,summary_template,created_at,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          mid,
          payload.title.trim(),
          payload.language,
          payload.target_language ?? null,
          payload.refined_model_id,
          payload.speaker_segmentation_model_id ?? null,
          payload.vad_model_id ?? 'silero-vad',
          speakers,
          payload.workspace_id ?? null,
          JSON.stringify(payload.tags || []),
          'recording',
          confirmedDate(payload.meeting_date),
          template,
          now,
          now,
        );
      });
    } catch (e) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw e;
    }
    return this.getMeeting(mid);
  },
  listMeetings({ include_deleted = false, query = '' } = {}) {
    const clause = [include_deleted ? 'm.deleted_at IS NOT NULL' : 'm.deleted_at IS NULL'],
      params = [];
    if (query) {
      clause.push(
        '(m.title LIKE ? ESCAPE char(92) OR m.tags LIKE ? ESCAPE char(92) OR m.id IN(SELECT meeting_id FROM segments WHERE text LIKE ? ESCAPE char(92)))',
      );
      params.push(like(query), like(query), like(query));
    }
    return this.query(
      `SELECT m.*,${counts} FROM meetings m WHERE ${clause.join(' AND ')} ORDER BY m.created_at DESC`,
      ...params,
    ).map(meetingRow);
  },
  searchMeetings(query = '') {
    const q = query.trim();
    if (!q) return [];
    const aliases = new Map();
    for (const row of this.query(
      'SELECT workspace_id,wrong,correct FROM workspace_terms WHERE instr(lower(?),lower(correct)) OR instr(lower(?),lower(wrong))',
      q,
      q,
    )) {
      const terms = aliases.get(row.workspace_id) || new Set();
      for (const [a, b] of [
        [row.correct, row.wrong],
        [row.wrong, row.correct],
      ])
        if (q.toLowerCase().includes(a.toLowerCase()))
          terms.add(q.toLowerCase().split(a.toLowerCase()).join(b.toLowerCase()));
      aliases.set(row.workspace_id, terms);
    }
    const terms = [
      [null, like(q)],
      ...[...aliases].flatMap(([wid, words]) => [...words].map((word) => [wid, like(word)])),
    ];
    const rows = this.query(
      `WITH terms AS(SELECT json_extract(value,'$[0]') workspace,json_extract(value,'$[1]') term FROM json_each(?)),hits AS(SELECT m.id FROM terms k JOIN meetings m ON(k.workspace IS NULL OR k.workspace=COALESCE(m.workspace_id,'')) WHERE m.deleted_at IS NULL AND(m.title LIKE k.term ESCAPE char(92) OR m.tags LIKE k.term ESCAPE char(92)) UNION SELECT s.meeting_id FROM segments s JOIN meetings m ON s.meeting_id=m.id JOIN terms k ON(k.workspace IS NULL OR k.workspace=COALESCE(m.workspace_id,'')) LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker WHERE m.deleted_at IS NULL AND(s.text LIKE k.term ESCAPE char(92) OR p.name LIKE k.term ESCAPE char(92))) SELECT m.*,${counts} FROM meetings m JOIN hits ON hits.id=m.id ORDER BY m.created_at DESC`,
      JSON.stringify(terms),
    );
    return rows.map((row) => ({
      ...meetingRow(row),
      snippets: this.query(
        'SELECT s.start_ms,s.end_ms,COALESCE(p.name,s.speaker) speaker_name,s.text,k.value matched_term FROM segments s LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker JOIN json_each(?) k ON(instr(lower(s.text),lower(k.value)) OR instr(lower(p.name),lower(k.value))) WHERE s.meeting_id=? GROUP BY s.id,s.version ORDER BY s.start_ms LIMIT 3',
        JSON.stringify([q, ...[...(aliases.get(row.workspace_id || '') || [])].sort()]),
        row.id,
      ),
    }));
  },
  meetingExists(mid) {
    return !!this.one('SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL', mid);
  },
  getMeeting(mid, compact = false) {
    compact = typeof compact === 'object' ? !!compact.compact : compact;
    return this.transaction(() => {
      const row = this.one(`SELECT m.*,${counts} FROM meetings m WHERE m.id=?`, mid);
      if (!row) throw new Error('Meeting not found');
      const revision = this.one(
        "SELECT MAX(revision) AS n FROM segments WHERE meeting_id=? AND version GLOB 'postprocess*' AND TRIM(text)<>''",
        mid,
      ).n;
      const all = this.query(
        'SELECT s.*,COALESCE(p.name,s.speaker) speaker_name FROM segments s LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker WHERE s.meeting_id=?' +
          (compact
            ? " AND s.version='live' ORDER BY s.start_ms"
            : ' ORDER BY s.start_ms,s.version'),
        mid,
      );
      const current = compact ? this.currentSegments(mid) : latestSegments(all),
        data = (s) => {
          let words = JSON.parse(s.word_timestamps || '[]');
          if (compact)
            words = words
              .filter((w) => w.overlap_speakers?.length)
              .map((w) => ({ overlap_speakers: w.overlap_speakers }));
          return { ...s, word_timestamps: words };
        };
      const summary = this.one(
          'SELECT data,raw_response,created_at FROM summaries WHERE meeting_id=?',
          mid,
        ),
        correction = this.correctionState(mid);
      const undo = correction.undo,
        highlights = {};
      if (undo) {
        const texts = new Map(current.map((s) => [s.id, s.text]));
        for (const entry of this.query(
          "SELECT segment_id,json_extract(data,'$.after.text') text FROM correction_undo_entries WHERE meeting_id=? AND scope='transcript'",
          mid,
        ))
          if (texts.get(entry.segment_id) === entry.text)
            highlights[entry.segment_id] = undo.replacement || '';
      }
      const result = {
        ...meetingRow(row),
        segments: (compact ? current : all).map(data),
        transcript_revision: revision,
        speakers: this.query(
          'SELECT id,name,profile_id,locked FROM speakers WHERE meeting_id=? ORDER BY id',
          mid,
        ),
        speaker_turns: compact
          ? []
          : this.query(
              'SELECT version,start_ms,end_ms,speaker FROM speaker_turns WHERE meeting_id=? ORDER BY start_ms,end_ms',
              mid,
            ),
        summary: summary
          ? { ...summary, data: summary.data ? JSON.parse(summary.data) : null }
          : null,
        accepted_claims: resolveClaims(
          this.query(
            'SELECT data FROM ai_note_claims WHERE meeting_id=? AND accepted=1 ORDER BY rowid',
            mid,
          ).map((r) => JSON.parse(r.data)),
          current,
          row.notes,
          true,
        ),
        correction: {
          revision: correction.revision || 0,
          rules: correction.rules,
          undo_count: undo?.count || 0,
          document_undo_counts: Object.fromEntries(
            Object.entries(correction.document_undo || {}).map(([k, v]) => [k, v.count]),
          ),
          highlights,
          summary_stale: correction.summary_stale,
          stale_translations: correction.stale_translations,
        },
        audio: this.audioFiles(mid),
      };
      if (compact) {
        if (result.summary) delete result.summary.raw_response;
        if (revision !== null)
          result.original_segments = all.filter((s) => s.version === 'live').map(data);
      } else result.current_segments = current.map(data);
      const summaryData = result.summary?.data;
      if (typeof summaryData?.markdown === 'string') {
        summaryData.markdown = normalizeSummaryMarkdown(summaryData.markdown);
        if ('basis_date' in summaryData && summaryData.basis_date !== result.meeting_date)
          result.correction.summary_stale = true;
        resolveClaims(summaryData.claims || [], current, summaryData.markdown);
      }
      return result;
    });
  },
  updateMeeting(mid, updates, expectedNotes) {
    const allowed = [
      'title',
      'tags',
      'archived_at',
      'meeting_date',
      'refined_model_id',
      'language',
      'target_language',
      'notes',
    ];
    const fields = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(fields).length) return this.getMeeting(mid);
    if ('title' in fields) {
      fields.title = fields.title.trim();
      if (!fields.title) throw new Error('Title cannot be empty');
    }
    if ('notes' in fields)
      fields.notes = [...String(fields.notes || '')].slice(0, 5 * 1024 * 1024).join('');
    if ('meeting_date' in fields) fields.meeting_date = confirmedDate(fields.meeting_date);
    if ('tags' in fields) fields.tags = JSON.stringify(fields.tags);
    this.transaction(() => {
      if (
        expectedNotes !== undefined &&
        !this.one(
          "SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL AND COALESCE(notes,'')=?",
          mid,
          expectedNotes,
        )
      )
        throw new Error('电脑笔记已更新，请重新核对。');
      for (const id of new Set(updates.accepted_suggestion_ids || []))
        if (
          !('notes' in fields) ||
          !this.run('UPDATE ai_note_claims SET accepted=1 WHERE id=? AND meeting_id=?', id, mid)
            .changes
        )
          throw new Error('Suggestion no longer available');
      this.run(
        `UPDATE meetings SET ${Object.keys(fields)
          .map((k) => k + '=?')
          .join(',')} WHERE id=?`,
        ...Object.values(fields),
        mid,
      );
    });
    return this.getMeeting(mid);
  },
  setStatus(mid, status) {
    if (!['ready', 'refining', 'refined'].includes(status))
      throw new Error('Invalid meeting status');
    this.run('UPDATE meetings SET status=? WHERE id=?', status, mid);
    return this.getMeeting(mid);
  },
  async finishMeeting(mid, duration) {
    this.flushAudio(mid, true, true);
    await this.buildAudio(mid);
    this.run(
      "UPDATE meetings SET status='ready',ended_at=?,duration_ms=? WHERE id=?",
      utcNow(),
      Math.max(0, Math.trunc(duration)),
      mid,
    );
    const manifest = this.readManifest(mid);
    manifest.closed = true;
    try {
      this.writeManifest(mid, manifest);
    } catch (e) {
      this.run(
        "UPDATE meetings SET status='recording',ended_at=NULL,duration_ms=0 WHERE id=?",
        mid,
      );
      throw e;
    }
    return this.getMeeting(mid);
  },
  finishImportedMeeting(mid, duration) {
    this.run(
      "UPDATE meetings SET status='ready',ended_at=?,duration_ms=? WHERE id=?",
      utcNow(),
      Math.max(0, Math.trunc(duration)),
      mid,
    );
    this.writeManifest(mid, { ...this.readManifest(mid), source: 'audio_import', closed: true });
    return this.getMeeting(mid);
  },
  async recoverInterruptedMeetings() {
    const rows = this.query(
      "SELECT id,status FROM meetings WHERE status IN('recording','refining')",
    );
    for (const row of rows) {
      if (row.status === 'recording') {
        try {
          await this.finishMeeting(row.id, this.recordedDurationMs(row.id));
        } catch (error) {
          console.error(error);
          this.setStatus(row.id, 'ready');
        }
      } else this.setStatus(row.id, 'ready');
    }
    return rows.map((r) => r.id);
  },
  softDelete(mid, restore = false) {
    this.transaction(() => {
      const row = this.one(
        'SELECT is_example,deleted_at,workspace_id,previous_workspace_id FROM meetings WHERE id=?',
        mid,
      );
      if (!row) throw new Error('Meeting not found');
      if (row.is_example && !restore) {
        fs.rmSync(this.meetingDir(mid), { recursive: true, force: true });
        this.run(
          'INSERT OR REPLACE INTO app_meta(key,value) VALUES(?,?)',
          'example_deleted:' + mid,
          utcNow(),
        );
        this.run('DELETE FROM meetings WHERE id=?', mid);
        return;
      }
      if (restore) {
        if (!row.deleted_at) return;
        let wid = row.previous_workspace_id || row.workspace_id;
        if (wid && !this.run('UPDATE workspaces SET deleted_at=NULL WHERE id=?', wid).changes)
          wid = null;
        this.run(
          'UPDATE meetings SET deleted_at=NULL,workspace_id=?,previous_workspace_id=NULL WHERE id=?',
          wid,
          mid,
        );
      } else
        this.run(
          'UPDATE meetings SET deleted_at=?,previous_workspace_id=workspace_id WHERE id=? AND deleted_at IS NULL',
          utcNow(),
          mid,
        );
    });
  },
  permanentDelete(mid) {
    const row = this.one('SELECT deleted_at FROM meetings WHERE id=?', mid);
    if (!row) throw new Error('Meeting not found');
    if (!row.deleted_at) throw new Error('Only deleted meetings can be permanently deleted');
    this.purgeMobileRecording(mid);
    fs.rmSync(this.meetingDir(mid), { recursive: true, force: true });
    this.run('DELETE FROM meetings WHERE id=?', mid);
  },
  purgeExpired() {
    const cutoff = new Date(
        Date.now() - this.settings.meetings.deleted_retention_days * 86400000,
      ).toISOString(),
      ids = this.query(
        'SELECT id FROM meetings WHERE deleted_at IS NOT NULL AND deleted_at<?',
        cutoff,
      ).map((r) => r.id);
    for (const id of ids) this.permanentDelete(id);
    return ids;
  },
};
module.exports.seedExamples = function () {
  return this.transaction(() => {
    if (this.one("SELECT 1 FROM app_meta WHERE key='examples_seeded_v6'")) return false;
    const previous = this.one("SELECT 1 FROM app_meta WHERE key='examples_seeded_v5'");
    const examples = require('../../backend/examples.json');
    const fixture = path.join(
        process.env.BREVIA_RESOURCES || path.resolve(__dirname, '../..'),
        'backend/fixtures',
      ),
      now = utcNow();
    for (const example of examples) {
      if (this.one('SELECT 1 FROM app_meta WHERE key=?', 'example_deleted:' + example.id)) continue;
      const existing = this.one('SELECT is_example FROM meetings WHERE id=?', example.id);
      if (existing) {
        if (existing.is_example) {
          const old = this.one(
              'SELECT data,raw_response FROM summaries WHERE meeting_id=?',
              example.id,
            ),
            data = JSON.parse(old?.data || '{}');
          if (
            old?.raw_response === 'example' &&
            Object.keys(data).length === 1 &&
            data.markdown ===
              '# **' + example.title + '**\n\n' + require('./store-legacy.cjs')[example.locale]
          ) {
            const sources = example.segments.map(([start, end, speaker, text], i) => ({
                id: `example-${example.locale}-${i + 1}`,
                version: 'postprocess',
                track: 'mic',
                start_ms: start,
                end_ms: end,
                speaker_name: example.speakers[speaker],
                text,
              })),
              [markdown, claims] = parseClaims(
                '# ' + example.title + '\n\n' + example.review_markdown,
                sources,
                true,
              );
            this.run(
              'UPDATE summaries SET data=? WHERE meeting_id=?',
              JSON.stringify({ markdown, claims }),
              example.id,
            );
          }
        }
        continue;
      }
      if (previous) continue;
      const sources = example.segments.map(([start, end, speaker, text], i) => ({
        id: `example-${example.locale}-${i + 1}`,
        version: 'postprocess',
        track: 'mic',
        start_ms: start,
        end_ms: end,
        speaker_name: example.speakers[speaker],
        text,
      }));
      const [markdown, claims] = parseClaims(
        '# ' + example.title + '\n\n' + example.review_markdown,
        sources,
        true,
      );
      const folder = this.meetingDir(example.id);
      fs.mkdirSync(path.join(folder, 'audio'), { recursive: true });
      fs.mkdirSync(path.join(folder, 'exports'), { recursive: true });
      fs.copyFileSync(
        path.join(fixture, example.audio),
        path.join(folder, 'audio/playback-mic.wav'),
      );
      this.writeManifest(example.id, { meeting_id: example.id, closed: true, tracks: {} });
      this.run(
        'INSERT INTO meetings(id,title,language,target_language,refined_model_id,tags,status,created_at,started_at,ended_at,duration_ms,is_example,example_locale) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        example.id,
        example.title,
        example.language || example.locale,
        example.target_language || (example.locale === 'zh' ? 'en' : 'zh'),
        'funasr-nano-int8',
        JSON.stringify(example.tags),
        'refined',
        now,
        now,
        now,
        example.duration_ms,
        1,
        example.locale,
      );
      for (const [id, name] of Object.entries(example.speakers))
        this.run(
          'INSERT INTO speakers(meeting_id,id,name,locked) VALUES(?,?,?,1)',
          example.id,
          id,
          name,
        );
      for (const [i, [start, end, speaker, text, translation]] of example.segments.entries())
        this.run(
          'INSERT INTO segments(id,meeting_id,version,track,start_ms,end_ms,speaker,text,translation) VALUES(?,?,?,?,?,?,?,?,?)',
          `example-${example.locale}-${i + 1}`,
          example.id,
          'postprocess',
          'mic',
          start,
          end,
          speaker,
          text,
          translation,
        );
      this.run(
        'INSERT INTO summaries(meeting_id,data,raw_response,created_at) VALUES(?,?,?,?)',
        example.id,
        JSON.stringify({ markdown, claims }),
        'example',
        now,
      );
    }
    this.run("INSERT INTO app_meta(key,value) VALUES('examples_seeded_v6',?)", now);
    return true;
  });
};
