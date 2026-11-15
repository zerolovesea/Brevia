const {
  isTermCandidate,
  containsTerm,
  termIdentity,
  distinctMentions,
} = require('./glossary-candidate.cjs');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { wavInfo, wavHeader } = require('./store-audio.cjs');
const { utcNow } = require('./store-base.cjs');
const { replaceGlossaryMarkdown } = require('../../frontend/glossary-markdown.js');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
module.exports = {
  glossaryDocument(meeting) {
    const summary = meeting.summary?.data;
    if (!summary) return meeting;
    const mentions = this.query(
      "SELECT original,name FROM glossary_mentions WHERE meeting_id=? AND dismissed=0 AND name IS NOT NULL AND (scope='' OR scope=?) ORDER BY length(original) DESC",
      meeting.id,
      meeting.workspace_id || 'public',
    );
    if (!mentions.length) return meeting;
    const names = new Map(mentions.map((m) => [m.original, m.name]));
    const re = new RegExp(
      mentions
        .map(
          (m) =>
            (/^[a-z0-9]/i.test(m.original) ? '(?<![A-Za-z0-9_])' : '') +
            escapeRegExp(m.original) +
            (/[a-z0-9]$/i.test(m.original) ? '(?![A-Za-z0-9_])' : ''),
        )
        .join('|'),
      'gu',
    );
    const replace = (value) =>
      typeof value === 'string' ? value.replace(re, (m) => names.get(m)) : value;
    return {
      ...meeting,
      summary: {
        ...meeting.summary,
        data: {
          ...summary,
          markdown: replaceGlossaryMarkdown(summary.markdown, mentions),
          claims: (summary.claims || []).map((c) => ({
            ...c,
            text: replace(c.text),
            section: replace(c.section),
            line: replaceGlossaryMarkdown(c.line, mentions),
          })),
        },
      },
    };
  },
  glossaryContext(meeting, transcript) {
    const scope = meeting.workspace_id || 'public';
    const definitions = new Map();
    for (const term of this.query(
      'SELECT * FROM glossary_entries WHERE scope=? OR scope=? ORDER BY scope DESC',
      scope,
      '',
    ))
      if (!definitions.has(term.name)) definitions.set(term.name, term);
    const terms = new Map();
    for (const alias of this.query(
      'SELECT * FROM glossary_aliases WHERE scope=? OR scope=? ORDER BY scope DESC',
      scope,
      '',
    )) {
      if (terms.has(alias.original)) continue;
      terms.set(alias.original, alias);
    }
    const ignored = new Set(
      this.query(
        'SELECT original FROM glossary_mentions WHERE meeting_id=? AND dismissed=1',
        meeting.id,
      ).map((m) => m.original),
    );
    return [
      ...[...definitions.values()]
        .filter((t) => transcript.includes(t.name))
        .map((t) => ({ original: t.name, name: t.name, meaning: t.meaning })),
      ...[...terms.values()]
        .filter(
          (a) =>
            !ignored.has(a.original) && transcript.includes(a.original) && definitions.has(a.name),
        )
        .map((a) => ({
          original: a.original,
          name: a.name,
          meaning: definitions.get(a.name).meaning,
        })),
    ];
  },
  glossarySource({ meeting_id, original }) {
    const mention = this.one(
      'SELECT name,source_quote FROM glossary_mentions WHERE meeting_id=? AND original=?',
      meeting_id,
      original,
    );
    const quote = mention?.source_quote;
    if (mention && !mention.name && (!isTermCandidate(original) || !quote)) return null;
    const segments = this.currentSegments(meeting_id);
    const source = quote
      ? segments.find((s) => containsTerm(s.text, original) && s.text.includes(quote))
      : segments.find((s) => containsTerm(s.text, original));
    if (!source) return null;
    const playback = this.audioFiles(meeting_id).playback;
    return {
      text: source.text,
      start_ms: source.start_ms,
      end_ms: source.end_ms,
      audio_path: playback.mix || playback.mic || playback.system || null,
    };
  },
  glossaryAudio(payload) {
    const source = this.glossarySource(payload);
    if (!source?.audio_path) throw new Error('Source audio unavailable');
    const info = wavInfo(source.audio_path);
    const start = Math.max(0, Math.round((source.start_ms * info.sampleRate) / 1000));
    const end = Math.min(info.frames, Math.round((source.end_ms * info.sampleRate) / 1000));
    const bytes = (end - start) * info.channels * 2;
    // 只读原句，限制异常分段的内存占用，不把整场 WAV 传进 WebView。
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 8 * 1024 * 1024)
      throw new Error('Source audio segment exceeds playback limit');
    const data = Buffer.alloc(bytes),
      fd = fs.openSync(source.audio_path, 'r');
    try {
      let read = 0;
      while (read < bytes) {
        const n = fs.readSync(
          fd,
          data,
          read,
          bytes - read,
          info.offset + start * info.channels * 2 + read,
        );
        if (!n) throw new Error('Truncated source audio');
        read += n;
      }
    } finally {
      fs.closeSync(fd);
    }
    return (
      'data:audio/wav;base64,' +
      Buffer.concat([wavHeader(bytes, info.sampleRate, info.channels), data]).toString('base64')
    );
  },
  glossarySettings() {
    const saved = this.one("SELECT value FROM app_meta WHERE key='glossary_settings'");
    return saved ? JSON.parse(saved.value) : { enabled: true, sensitivity: 'balanced' };
  },
  glossary() {
    return {
      entries: this.query('SELECT * FROM glossary_entries ORDER BY name'),
      settings: this.glossarySettings(),
      mentions: distinctMentions(
        this.query(
          'SELECT g.*,m.title,m.workspace_id,e.meaning FROM glossary_mentions g JOIN meetings m ON m.id=g.meeting_id LEFT JOIN glossary_entries e ON e.scope=g.scope AND e.name=g.name WHERE m.deleted_at IS NULL AND dismissed=0 ORDER BY g.rowid DESC',
        ),
      ),
      regeneration: this.query(
        "SELECT m.id,m.title FROM meetings m JOIN summaries s ON s.meeting_id=m.id JOIN glossary_revisions g ON g.meeting_id=m.id WHERE m.deleted_at IS NULL AND g.revision>COALESCE(json_extract(s.data,'$.glossary_revision'),0) ORDER BY m.created_at DESC",
      ),
    };
  },
  updateGlossary(p) {
    return this.transaction(() => {
      if (p.action === 'settings')
        this.run(
          "INSERT INTO app_meta VALUES('glossary_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          JSON.stringify({ enabled: p.enabled, sensitivity: p.sensitivity }),
        );
      else if (p.action === 'clear')
        this.run('UPDATE glossary_mentions SET dismissed=1 WHERE name IS NULL');
      else if (p.action === 'dismiss') {
        for (const mention of this.query(
          'SELECT original FROM glossary_mentions WHERE meeting_id=?',
          p.meeting_id,
        ))
          if (termIdentity(mention.original) === termIdentity(p.original))
            this.run(
              'UPDATE glossary_mentions SET dismissed=1 WHERE meeting_id=? AND original=?',
              p.meeting_id,
              mention.original,
            );
      } else {
        if (p.workspace_id && p.workspace_id !== 'public' && !this.getWorkspace(p.workspace_id))
          throw new Error('Workspace unavailable');
        this.run(
          "INSERT INTO glossary_entries VALUES(?,?,?) ON CONFLICT(scope,name) DO UPDATE SET meaning=CASE WHEN excluded.meaning<>'' THEN excluded.meaning ELSE glossary_entries.meaning END",
          p.workspace_id,
          p.name,
          p.meaning ||
            this.one(
              "SELECT meaning FROM glossary_entries WHERE name=? AND (scope=? OR scope='') ORDER BY scope DESC LIMIT 1",
              p.name,
              p.workspace_id,
            )?.meaning ||
            '',
        );
        if (p.action === 'resolve')
          this.run(
            'INSERT INTO glossary_aliases VALUES(?,?,?) ON CONFLICT(scope,original) DO UPDATE SET name=excluded.name',
            p.workspace_id,
            p.original,
            p.name,
          );
        if (p.action === 'resolve')
          this.run(
            'UPDATE glossary_mentions SET name=?,scope=? WHERE meeting_id=? AND original=?',
            p.name,
            p.workspace_id,
            p.meeting_id,
            p.original,
          );
        if (p.action === 'resolve') {
          this.run(
            'INSERT INTO glossary_revisions VALUES(?,1) ON CONFLICT(meeting_id) DO UPDATE SET revision=revision+1',
            p.meeting_id,
          );
          for (const mention of this.query(
            'SELECT original FROM glossary_mentions WHERE meeting_id=? AND name IS NULL',
            p.meeting_id,
          ))
            if (termIdentity(mention.original) === termIdentity(p.original))
              this.run(
                'UPDATE glossary_mentions SET dismissed=1 WHERE meeting_id=? AND original=?',
                p.meeting_id,
                mention.original,
              );
        }
      }
      return this.glossary();
    });
  },
  listWorkspaces() {
    return this.query(
      'SELECT w.*,(SELECT COUNT(*) FROM meetings m WHERE m.workspace_id=w.id AND m.deleted_at IS NULL) AS meeting_count FROM workspaces w WHERE w.deleted_at IS NULL ORDER BY w.position,w.created_at',
    );
  },
  getWorkspace(id) {
    return this.one(
      'SELECT w.*,(SELECT COUNT(*) FROM meetings m WHERE m.workspace_id=w.id AND m.deleted_at IS NULL) AS meeting_count FROM workspaces w WHERE w.id=? AND w.deleted_at IS NULL',
      id,
    );
  },
  createWorkspace(payload) {
    return this.transaction(() => {
      const name = payload.name.trim(),
        now = utcNow(),
        existing = this.one(
          'SELECT id,deleted_at FROM workspaces WHERE name=? COLLATE NOCASE',
          name,
        );
      let id;
      if (existing) {
        if (existing.deleted_at === null) throw new Error(`Workspace '${name}' already exists`);
        id = existing.id;
        this.run('UPDATE workspaces SET deleted_at=NULL,updated_at=? WHERE id=?', now, id);
      } else {
        id = randomUUID();
        const position = this.one('SELECT COALESCE(MAX(position),-1)+1 AS n FROM workspaces').n;
        this.run(
          'INSERT INTO workspaces(id,name,description,position,created_at,updated_at) VALUES(?,?,?,?,?,?)',
          id,
          name,
          (payload.description || '').trim(),
          position,
          now,
          now,
        );
      }
      return this.getWorkspace(id);
    });
  },
  updateWorkspace(id, updates) {
    return this.transaction(() => {
      if (!this.one('SELECT id FROM workspaces WHERE id=?', id))
        throw new Error('Workspace not found');
      const fields = {};
      if ('name' in updates) {
        fields.name = updates.name.trim();
        if (
          this.one(
            'SELECT id FROM workspaces WHERE name=? COLLATE NOCASE AND id<>?',
            fields.name,
            id,
          )
        )
          throw new Error('Workspace name already exists');
      }
      if ('description' in updates) fields.description = updates.description.trim();
      if (Object.keys(fields).length) {
        fields.updated_at = utcNow();
        this.run(
          `UPDATE workspaces SET ${Object.keys(fields)
            .map((k) => k + '=?')
            .join(',')} WHERE id=?`,
          ...Object.values(fields),
          id,
        );
      }
      return this.getWorkspace(id);
    });
  },
  deleteWorkspace(id) {
    return this.transaction(() => {
      if (!this.one('SELECT id FROM workspaces WHERE id=?', id))
        throw new Error('Workspace not found');
      this.run(
        'UPDATE meetings SET deleted_at=?,previous_workspace_id=workspace_id WHERE workspace_id=? AND deleted_at IS NULL',
        utcNow(),
        id,
      );
      this.run('UPDATE workspaces SET deleted_at=? WHERE id=?', utcNow(), id);
    });
  },
  reorderWorkspaces(ids) {
    this.transaction(() =>
      ids.forEach((id, i) =>
        this.run('UPDATE workspaces SET position=?,updated_at=? WHERE id=?', i, utcNow(), id),
      ),
    );
  },
  assignMeetingToWorkspace(mid, wid) {
    this.transaction(() => {
      if (!this.one('SELECT id FROM meetings WHERE id=?', mid))
        throw new Error('Meeting not found');
      this.checkedWorkspace(wid);
      this.run('UPDATE meetings SET workspace_id=? WHERE id=?', wid || null, mid);
    });
  },
  checkedWorkspace(wid) {
    if (wid && !this.one('SELECT id FROM workspaces WHERE id=? AND deleted_at IS NULL', wid))
      throw new Error('Workspace not found');
    return wid || '';
  },
  workspaceTerms(wid) {
    return this.query(
      'SELECT wrong,correct,post_replace,hotword FROM workspace_terms WHERE workspace_id=? ORDER BY correct,wrong',
      this.checkedWorkspace(wid),
    );
  },
  saveTerm(wid, payload, remember = false) {
    wid = this.checkedWorkspace(wid);
    const wrong = payload.wrong.trim(),
      correct = payload.correct.trim();
    if (
      !wrong ||
      !correct ||
      wrong === correct ||
      Math.max([...wrong].length, [...correct].length) > 80 ||
      /[\x00-\x1F]/.test(wrong + correct)
    )
      throw new Error('请输入两个不同的术语，每项最多 80 字');
    const rows = this.workspaceTerms(wid),
      existing = rows.find((r) => r.wrong === wrong);
    let post = !!payload.post_replace,
      hot = !!payload.hotword;
    if (remember && existing) {
      if (existing.correct !== correct) throw new Error('工作区已有不同的正确术语，请先编辑词条');
      post ||= !!existing.post_replace;
      hot ||= !!existing.hotword;
    }
    if (!existing && rows.length >= 128) throw new Error('每个工作区最多保存 128 个词条');
    if (hot) {
      const words = new Set(
        rows.filter((r) => r.hotword && r.wrong !== wrong).map((r) => r.correct),
      );
      words.add(correct);
      if (
        correct.includes(',') ||
        [...words].reduce((n, s) => n + [...s].length, 0) + words.size > 256
      )
        throw new Error('识别热词合计限 256 字，单个热词不能含英文逗号');
    }
    this.run(
      'INSERT INTO workspace_terms(workspace_id,wrong,correct,post_replace,hotword) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,wrong) DO UPDATE SET correct=excluded.correct,post_replace=excluded.post_replace,hotword=excluded.hotword',
      wid,
      wrong,
      correct,
      Number(post),
      Number(hot),
    );
  },
  writeWorkspaceTerm(payload) {
    return this.transaction(() => {
      const wid = this.checkedWorkspace(payload.workspace_id);
      if (payload.remove)
        this.run(
          'DELETE FROM workspace_terms WHERE workspace_id=? AND wrong=?',
          wid,
          payload.wrong,
        );
      else this.saveTerm(wid, payload);
      return this.workspaceTerms(wid);
    });
  },
  asrTermOptions(meeting) {
    const hotwords = [
      ...new Set(
        this.workspaceTerms(meeting.workspace_id)
          .filter((r) => r.hotword)
          .map((r) => r.correct),
      ),
    ];
    return hotwords.length ? { hotwords } : {};
  },
  workspaceReplacements(mid) {
    return this.query(
      "SELECT wrong,correct FROM workspace_terms WHERE post_replace=1 AND workspace_id=(SELECT COALESCE(workspace_id,'') FROM meetings WHERE id=?) ORDER BY length(wrong) DESC",
      mid,
    );
  },
  applyWorkspaceTerms(mid, payload) {
    const rows = this.workspaceReplacements(mid);
    if (!rows.length) return;
    const byWrong = new Map(rows.map((r) => [r.wrong, r.correct])),
      pattern = new RegExp(rows.map((r) => escapeRegExp(r.wrong)).join('|'), 'g');
    const text = payload.text.replace(pattern, (s) => byWrong.get(s));
    if (text !== payload.text && [...text].length <= 4000)
      Object.assign(payload, { text, asr_text: payload.text, word_timestamps: null });
  },
};
