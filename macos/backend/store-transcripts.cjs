const { utcNow } = require('./store-base.cjs');
const { latestSegments, normalizeSummaryMarkdown } = require('./meeting-evidence.cjs');
const conflict = () =>
  Object.assign(new Error('部分内容已变化，请更新预览'), { code: 'error.transcript_conflict' });
const segmentValues = (p) => [
  p.segment_id,
  p.meeting_id,
  Math.trunc(p.revision || 0),
  p.version || 'live',
  p.track || 'mic',
  Math.trunc(p.start_ms),
  Math.trunc(p.end_ms),
  p.speaker || 'spk-1',
  p.text.trim(),
  p.word_timestamps?.length ? JSON.stringify(p.word_timestamps) : null,
  p.translation ?? null,
  Number(!!p.user_edited),
  p.asr_text ?? null,
];
const insert =
  'INSERT INTO segments(id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited,asr_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)';
module.exports = {
  currentSegments(mid, id) {
    const revision = this.one(
      "SELECT MAX(revision) n FROM segments WHERE meeting_id=? AND version GLOB 'postprocess*' AND TRIM(text)<>''",
      mid,
    ).n;
    let base = revision !== null ? "version GLOB 'postprocess*' AND revision=?" : "version='live'";
    const params = [mid, ...(revision !== null ? [revision] : [])];
    if (id !== undefined && id !== null) {
      base += ' AND id=?';
      params.push(id);
    }
    params.push(mid);
    return latestSegments(
      this.query(
        'WITH base AS (SELECT id,version FROM segments WHERE meeting_id=? AND ' +
          base +
          " AND TRIM(text)<>'') SELECT s.*,COALESCE(p.name,s.speaker) speaker_name FROM segments s LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker WHERE s.meeting_id=? AND s.id IN(SELECT id FROM base) AND(s.version='user' OR EXISTS(SELECT 1 FROM base b WHERE b.id=s.id AND b.version=s.version))",
        ...params,
      ),
    );
  },
  correctionState(mid) {
    const row = this.one('SELECT data FROM transcript_corrections WHERE meeting_id=?', mid);
    return row
      ? JSON.parse(row.data)
      : { rules: [], undo: null, summary_stale: false, stale_translations: [], revision: 0 };
  },
  saveCorrectionState(mid, state) {
    this.run(
      'INSERT INTO transcript_corrections(meeting_id,data) VALUES(?,?) ON CONFLICT(meeting_id) DO UPDATE SET data=excluded.data',
      mid,
      JSON.stringify(state),
    );
  },
  editableMeeting(mid, scope = 'transcript') {
    const row = this.one('SELECT status,deleted_at,workspace_id FROM meetings WHERE id=?', mid);
    if (!row || row.deleted_at) throw new Error('Meeting not found');
    if (scope === 'transcript' && row.status === 'refining') throw conflict();
    return row;
  },
  markCorrectionStale(mid, state, segments) {
    state.revision = (state.revision || 0) + 1;
    state.stale_translations = [
      ...new Set([
        ...state.stale_translations,
        ...segments.filter((s) => s.translation).map((s) => s.id),
      ]),
    ].sort();
    if (this.one('SELECT 1 FROM summaries WHERE meeting_id=?', mid)) state.summary_stale = true;
  },
  checkCorrectionBase(base, expected) {
    if (!base || ['text', 'version', 'revision'].some((k) => base[k] !== expected[k]))
      throw conflict();
  },
  writeCorrection(mid, base, text) {
    if (!text.trim() || [...text].length > 4000)
      throw Object.assign(new Error('字幕内容不能为空，且每段不能超过 4000 字'), {
        code: 'error.transcript_limit',
      });
    const version = base.version === 'live' ? 'live' : 'user';
    this.run(
      'INSERT INTO segments(id,meeting_id,revision,version,track,start_ms,end_ms,speaker,text,word_timestamps,translation,user_edited) VALUES(?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(meeting_id,id,version) DO UPDATE SET text=excluded.text,user_edited=1',
      base.id,
      mid,
      base.revision,
      version,
      base.track,
      base.start_ms,
      base.end_ms,
      base.speaker,
      text,
      base.word_timestamps ?? null,
      base.translation ?? null,
    );
    return { ...base, version, text, user_edited: 1 };
  },
  translationContext(mid, id) {
    const meeting = this.one(
      'SELECT id,target_language FROM meetings WHERE id=? AND deleted_at IS NULL',
      mid,
    );
    if (!meeting) throw new Error('Meeting not found');
    return [meeting, this.currentSegments(mid, id)[0] || null];
  },
  saveSegmentTexts(mid, edits) {
    if (!edits?.length || edits.length > 500) throw new Error('每批最多保存 500 段');
    this.transaction(() => {
      this.editableMeeting(mid);
      const current = new Map(this.currentSegments(mid).map((s) => [s.id, s])),
        state = this.correctionState(mid),
        changed = [];
      let total = 0;
      for (const edit of edits) {
        const text = String(edit.text || '')
          .trim()
          .replace(/\s+/g, ' ');
        if (!text) throw new Error('Subtitle text cannot be empty');
        total += [...text].length;
        if (total > 60000) throw new Error('每批最多保存 60000 字');
        const base = current.get(edit.segment_id);
        if (!base) throw new Error('Segment not found');
        if ('expected' in edit) this.checkCorrectionBase(base, edit.expected);
        this.writeCorrection(mid, base, text);
        changed.push(base);
      }
      this.markCorrectionStale(mid, state, changed);
      this.saveCorrectionState(mid, state);
    });
  },
  saveSegment(payload) {
    return this.transaction(() => {
      this.applyTranscriptRules(payload);
      return (
        this.run(
          insert +
            ' ON CONFLICT(meeting_id,id,version) DO UPDATE SET revision=excluded.revision,end_ms=excluded.end_ms,speaker=excluded.speaker,text=excluded.text,asr_text=excluded.asr_text,word_timestamps=excluded.word_timestamps,translation=excluded.translation WHERE segments.user_edited=0',
          ...segmentValues(payload),
        ).changes > 0
      );
    });
  },
  nextRefinementVersion(mid) {
    const value = this.one(
      "SELECT MAX(revision) AS n FROM segments WHERE meeting_id=? AND(version='postprocess' OR version GLOB 'postprocess-*')",
      mid,
    ).n;
    const revision = (value ?? -1) + 1;
    return [revision ? 'postprocess-' + revision : 'postprocess', revision];
  },
  replaceSegments(
    mid,
    segments,
    version = 'postprocess',
    revision = 0,
    { model_id = null, language = null } = {},
  ) {
    return this.transaction(() => {
      const state = this.correctionState(mid);
      state.undo = null;
      this.run(
        "DELETE FROM correction_undo_entries WHERE meeting_id=? AND scope='transcript'",
        mid,
      );
      this.markCorrectionStale(mid, state, this.currentSegments(mid));
      const ids = new Set(),
        normalized = segments.map((item) => {
          let id = item.segment_id,
            suffix = 1;
          while (ids.has(id)) id = item.segment_id + '-' + suffix++;
          ids.add(id);
          const value = {
            ...item,
            segment_id: id,
            meeting_id: mid,
            version,
            revision,
            user_edited: 0,
          };
          this.applyWorkspaceTerms(mid, value);
          return value;
        });
      this.run('DELETE FROM segments WHERE meeting_id=? AND version=?', mid, version);
      for (const item of normalized) this.run(insert, ...segmentValues(item));
      if (model_id !== null)
        this.run(
          "UPDATE meetings SET transcript_model_id=?,refined_model_id=?,language=?,status='refined' WHERE id=?",
          model_id,
          model_id,
          language,
          mid,
        );
      const current = new Set(this.currentSegments(mid).map((s) => s.id));
      state.stale_translations = [...new Set(state.stale_translations)]
        .filter((id) => current.has(id))
        .sort();
      this.saveCorrectionState(mid, state);
      return normalized;
    });
  },
  saveTranslation(
    mid,
    id,
    translation,
    { expected_text = null, expected_version = null, target_language = null } = {},
  ) {
    return this.transaction(() => {
      const base = this.currentSegments(mid, id)[0];
      if (
        !base ||
        (expected_text !== null && base.text !== expected_text) ||
        (expected_version !== null &&
          (base.version !== expected_version[0] || base.revision !== expected_version[1]))
      )
        return false;
      const state = this.correctionState(mid);
      if (state.stale_translations.includes(id)) {
        state.stale_translations = state.stale_translations.filter((s) => s !== id);
        this.saveCorrectionState(mid, state);
      }
      this.run(
        'UPDATE segments SET translation=? WHERE meeting_id=? AND id=? AND text=?',
        translation,
        mid,
        id,
        base.text,
      );
      if (target_language !== null)
        this.run(
          'UPDATE meetings SET target_language=? WHERE id=? AND target_language IS NOT ?',
          target_language,
          mid,
          target_language,
        );
      return true;
    });
  },
  renameSpeaker(mid, id, name, locked = false, profileId = null) {
    name = name.trim();
    if (!name) throw new Error('Speaker name cannot be empty');
    this.run(
      'INSERT INTO speakers(meeting_id,id,name,profile_id,locked) VALUES(?,?,?,?,?) ON CONFLICT(meeting_id,id) DO UPDATE SET name=excluded.name,profile_id=COALESCE(excluded.profile_id,speakers.profile_id),locked=excluded.locked',
      mid,
      id,
      name,
      profileId,
      Number(locked),
    );
  },
  replaceSpeakerTurns(mid, turns, version = 'postprocess') {
    this.transaction(() => {
      this.run('DELETE FROM speaker_turns WHERE meeting_id=? AND version=?', mid, version);
      for (const turn of turns)
        this.run(
          'INSERT INTO speaker_turns(meeting_id,version,start_ms,end_ms,speaker) VALUES(?,?,?,?,?)',
          mid,
          version,
          Math.trunc(turn.start_ms),
          Math.trunc(turn.end_ms),
          turn.speaker,
        );
    });
  },
  recordAiClaim(mid, claim) {
    this.run(
      'INSERT INTO ai_note_claims(meeting_id,id,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL) ON CONFLICT(meeting_id,id) DO UPDATE SET data=excluded.data WHERE accepted=0',
      mid,
      claim.id,
      JSON.stringify(claim),
      mid,
    );
  },
  editSummary(mid, payload) {
    this.transaction(() => {
      this.editableMeeting(mid, 'summary');
      const row = this.one('SELECT data FROM summaries WHERE meeting_id=?', mid),
        data = JSON.parse(row?.data || '{}');
      if (
        'expected_markdown' in payload &&
        normalizeSummaryMarkdown(data.markdown || '') !== payload.expected_markdown
      )
        throw conflict();
      if ('claim_id' in payload) {
        const claim = data.claims?.find((c) => c.id === payload.claim_id),
          lines = (data.markdown || '').split(/\r?\n/);
        if (
          !claim ||
          claim.text !== payload.expected_text ||
          lines.filter((l) => l === claim.line).length !== 1
        )
          throw new Error('Conclusion changed; reopen it to edit');
        const text = String(payload.text || '').trim();
        if (!text || [...text].length > 10000 || /[\r\n]/.test(text))
          throw new Error('Expected a single conclusion');
        const index = lines.indexOf(claim.line);
        lines[index] = claim.prefix + text + claim.suffix;
        Object.assign(claim, { text, line: lines[index], edited: text !== claim.original_text });
        data.markdown = lines.join('\n');
      } else data.markdown = String(payload.markdown);
      this.run(
        'INSERT INTO summaries(meeting_id,data,raw_response,created_at) VALUES(?,?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET data=excluded.data',
        mid,
        JSON.stringify(data),
        data.markdown,
        utcNow(),
      );
    });
    return this.getMeeting(mid, true).summary.data;
  },
  saveSummary(mid, data, raw, { expected_revision = null, expected_document = null } = {}) {
    return this.transaction(() => {
      if (expected_document !== null) {
        const base = this.one(
          "SELECT m.meeting_date,json_extract(s.data,'$.markdown') markdown FROM meetings m LEFT JOIN summaries s ON s.meeting_id=m.id WHERE m.id=? AND m.deleted_at IS NULL",
          mid,
        );
        if (!base) return false;
        if (
          base.meeting_date !== expected_document[0] ||
          normalizeSummaryMarkdown(base.markdown) !== expected_document[1]
        )
          throw conflict();
      }
      const state = this.correctionState(mid);
      state.summary_stale =
        expected_revision !== null && (state.revision || 0) !== expected_revision;
      if (this.meetingExists(mid)) this.saveCorrectionState(mid, state);
      return (
        this.run(
          'INSERT INTO summaries(meeting_id,data,raw_response,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL) ON CONFLICT(meeting_id) DO UPDATE SET data=excluded.data,raw_response=excluded.raw_response,created_at=excluded.created_at',
          mid,
          data ? JSON.stringify(data) : null,
          raw,
          utcNow(),
          mid,
        ).changes > 0
      );
    });
  },
};
