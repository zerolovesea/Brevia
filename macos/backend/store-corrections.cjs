const { alignReplacement, normalizeSummaryMarkdown } = require('./meeting-evidence.cjs');
const error = (code, message) => Object.assign(new Error(message), { code });
const conflict = () => error('error.transcript_conflict', '部分内容已变化，请更新预览');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function replaceOccurrences(text, find, replacement, selected) {
  if (
    typeof find !== 'string' ||
    typeof replacement !== 'string' ||
    !find.trim() ||
    !replacement.trim() ||
    find === replacement ||
    Math.max([...find].length, [...replacement].length) > 4000
  )
    throw new Error('请输入不同的查找文字和替换文字');
  const offsets = [...text.matchAll(new RegExp(escape(find), 'g'))].map((m) => m.index);
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.length > 4000 ||
    selected.some((i) => !Number.isInteger(i) || i < 0 || i >= offsets.length) ||
    new Set(selected).size !== selected.length
  )
    throw conflict();
  for (const index of [...selected].sort((a, b) => b - a)) {
    const at = offsets[index];
    text = text.slice(0, at) + replacement + text.slice(at + find.length);
  }
  return text;
}
module.exports = {
  saveUndoEntry(mid, scope, id, entry) {
    this.run(
      'INSERT OR REPLACE INTO correction_undo_entries(meeting_id,scope,segment_id,data) VALUES(?,?,?,?)',
      mid,
      scope,
      id,
      JSON.stringify(entry),
    );
  },
  undoEntries(mid, scope) {
    return this.query(
      'SELECT data FROM correction_undo_entries WHERE meeting_id=? AND scope=? ORDER BY segment_id',
      mid,
      scope,
    ).map((r) => JSON.parse(r.data));
  },
  clearUndoEntries(mid, scope) {
    this.run('DELETE FROM correction_undo_entries WHERE meeting_id=? AND scope=?', mid, scope);
  },
  correctDocument(mid, state, scope, payload) {
    if (payload.future) throw new Error('后续字幕规则仅适用于逐字稿');
    const data =
      scope === 'summary'
        ? JSON.parse(this.one('SELECT data FROM summaries WHERE meeting_id=?', mid)?.data || '{}')
        : null;
    const text =
      scope === 'notes'
        ? this.one('SELECT notes FROM meetings WHERE id=?', mid).notes || ''
        : normalizeSummaryMarkdown(data.markdown);
    const undos = (state.document_undo ||= {});
    let updated;
    if (payload.action === 'undo') {
      const undo = this.undoEntries(mid, scope)[0];
      if (!undo || text !== undo.after) throw conflict();
      updated = undo.before;
      delete undos[scope];
      this.clearUndoEntries(mid, scope);
    } else if (payload.action === 'replace') {
      if (text !== payload.document?.text) throw conflict();
      updated = replaceOccurrences(
        text,
        payload.find,
        payload.replacement,
        payload.document.occurrences,
      );
      if ([...updated].length > 5 * 1024 * 1024) throw new Error('内容超过容量上限');
      const count = payload.document.occurrences.length;
      this.saveUndoEntry(mid, scope, '', { before: text, after: updated, count });
      undos[scope] = { count };
    } else throw new Error('Unknown correction action');
    if (scope === 'notes') this.run('UPDATE meetings SET notes=? WHERE id=?', updated, mid);
    else {
      if (data.claims) alignReplacement(data.claims, text, updated);
      data.markdown = updated;
      this.run('UPDATE summaries SET data=? WHERE meeting_id=?', JSON.stringify(data), mid);
    }
    this.saveCorrectionState(mid, state);
  },
  transcriptCorrection(mid, payload) {
    return this.transaction(() => {
      const scope = payload.scope || 'transcript';
      if (!['transcript', 'notes', 'summary'].includes(scope))
        throw new Error('Unknown correction scope');
      const meeting = this.editableMeeting(mid, scope),
        state = this.correctionState(mid);
      if (payload.remember && payload.action === 'replace') {
        if ((meeting.workspace_id || '') !== payload.remember.workspace_id) throw conflict();
        this.saveTerm(
          meeting.workspace_id,
          { ...payload.remember, wrong: payload.find, correct: payload.replacement },
          true,
        );
      }
      if (scope !== 'transcript') {
        this.correctDocument(mid, state, scope, payload);
        return;
      }
      const current = new Map(this.currentSegments(mid).map((s) => [s.id, s]));
      if (payload.action === 'disable') {
        for (const rule of state.rules) if (rule.find === payload.find) rule.enabled = false;
      } else if (payload.action === 'undo') {
        const undo = state.undo;
        if (!undo) throw new Error('没有可撤销的替换');
        const entries = this.undoEntries(mid, 'transcript');
        for (const entry of entries)
          this.checkCorrectionBase(current.get(entry.after.id), entry.after);
        for (const entry of entries)
          this.writeCorrection(mid, current.get(entry.after.id), entry.before.text);
        if (undo.rule) {
          state.rules = state.rules.filter((r) => r.find !== undo.rule);
          if (undo.previous_rule) state.rules.push(undo.previous_rule);
        }
        this.markCorrectionStale(
          mid,
          state,
          entries.map((e) => current.get(e.after.id)),
        );
        state.undo = null;
        this.clearUndoEntries(mid, 'transcript');
      } else if (payload.action === 'replace') {
        const { find, replacement, matches } = payload;
        if (
          typeof find !== 'string' ||
          typeof replacement !== 'string' ||
          !find.trim() ||
          !replacement.trim() ||
          find === replacement ||
          Math.max([...find].length, [...replacement].length) > 4000
        )
          throw new Error('请输入不同的查找文字和替换文字');
        if (!Array.isArray(matches) || !matches.length || matches.length > 500)
          throw error('error.transcript_limit', '每批最多替换 500 段');
        const entries = [],
          seen = new Set();
        let count = 0,
          total = 0;
        for (const match of matches) {
          if (seen.has(match.segment_id)) throw new Error('重复段落');
          seen.add(match.segment_id);
          const base = current.get(match.segment_id);
          this.checkCorrectionBase(base, match);
          const text = replaceOccurrences(base.text, find, replacement, match.occurrences);
          total += [...text].length;
          if (total > 60000)
            throw error('error.transcript_limit', '每批最多保存 60000 字，请缩小替换范围');
          entries.push({ before: base, after: this.writeCorrection(mid, base, text) });
          count += match.occurrences.length;
        }
        const previous = state.rules.find((r) => r.find === find) || null,
          enabled = !!payload.future;
        if (enabled) {
          if (!['recording', 'paused', 'interrupted'].includes(meeting.status))
            throw error('error.transcript_ended', '录音已结束，后续字幕规则未启用，请更新预览');
          if (
            (payload.expected_rule_replacement !== undefined &&
              previous?.replacement !== payload.expected_rule_replacement) ||
            (previous && previous.replacement !== replacement && !payload.confirm_rule)
          )
            throw error('error.transcript_rule_conflict', '本场已有不同的替换规则，请确认更新');
          state.rules = state.rules.filter((r) => r.find !== find);
          state.rules.push({ find, replacement, enabled: true });
        }
        this.clearUndoEntries(mid, 'transcript');
        for (const entry of entries) this.saveUndoEntry(mid, 'transcript', entry.after.id, entry);
        state.undo = { count, replacement, rule: enabled ? find : null, previous_rule: previous };
        this.markCorrectionStale(
          mid,
          state,
          entries.map((e) => e.before),
        );
      } else throw new Error('Unknown correction action');
      this.saveCorrectionState(mid, state);
    });
  },
  applyTranscriptRules(payload) {
    const mid = payload.meeting_id;
    if ((payload.version || 'live') !== 'live' || payload.user_edited) return;
    const prior = this.one(
      "SELECT text,asr_text FROM segments WHERE meeting_id=? AND id=? AND version='live'",
      mid,
      payload.segment_id,
    );
    if (prior) {
      if (prior.asr_text && [prior.asr_text, prior.text].includes(payload.text))
        Object.assign(payload, {
          text: prior.text,
          asr_text: prior.asr_text,
          word_timestamps: null,
        });
      return;
    }
    const meeting = this.one('SELECT status FROM meetings WHERE id=?', mid);
    if (!meeting || !['recording', 'paused', 'interrupted'].includes(meeting.status)) return;
    const state = this.correctionState(mid),
      replacements = new Map(this.workspaceReplacements(mid).map((r) => [r.wrong, r.correct])),
      local = new Map(state.rules.filter((r) => r.enabled).map((r) => [r.find, r.replacement]));
    for (const [key, value] of local) replacements.set(key, value);
    if (!replacements.size) return;
    const original = payload.text,
      pattern = new RegExp(
        [...replacements.keys()]
          .sort((a, b) => b.length - a.length)
          .map(escape)
          .join('|'),
        'g',
      );
    let text = original.replace(pattern, (m) => replacements.get(m));
    if (text === original) return;
    if ([...text].length > 4000) {
      for (const rule of state.rules) rule.enabled = false;
      this.saveCorrectionState(mid, state);
      payload.correction_error = '后续字幕替换超过 4000 字，已停用本场规则并保留识别原文';
      payload.correction_error_code = 'error.transcript_rule_limit';
      return;
    }
    text = text.trim();
    Object.assign(payload, { text, asr_text: original });
    const matched = [...original.matchAll(pattern)];
    if (matched.some((m) => local.has(m[0]))) payload.user_edited = true;
    else payload.word_timestamps = null;
    const undo = state.undo,
      tracked = matched.filter((m) => undo && m[0] === undo.rule);
    if (tracked.length) {
      const before = original.replace(pattern, (m) => (m === undo.rule ? m : replacements.get(m))),
        base = {
          id: payload.segment_id,
          text: before,
          version: 'live',
          revision: Math.trunc(payload.revision || 0),
          translation: payload.translation ?? null,
        };
      this.saveUndoEntry(mid, 'transcript', payload.segment_id, {
        before: base,
        after: { ...base, text },
      });
      undo.count += tracked.length;
    }
    this.markCorrectionStale(mid, state, []);
    this.saveCorrectionState(mid, state);
  },
};
