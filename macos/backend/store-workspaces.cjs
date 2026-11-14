const { randomUUID } = require('node:crypto');
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
  glossarySource({ meeting_id, original }) {
    const source = this.currentSegments(meeting_id).find((segment) =>
      segment.text.includes(original),
    );
    return source ? { text: source.text, start_ms: source.start_ms } : null;
  },
  glossary() {
    return {
      entries: this.query('SELECT * FROM glossary_entries ORDER BY name'),
      mentions: this.query(
        'SELECT g.*,m.title,m.workspace_id,e.meaning FROM glossary_mentions g JOIN meetings m ON m.id=g.meeting_id LEFT JOIN glossary_entries e ON e.scope=g.scope AND e.name=g.name WHERE m.deleted_at IS NULL AND dismissed=0 ORDER BY g.rowid DESC',
      ),
    };
  },
  updateGlossary(p) {
    return this.transaction(() => {
      if (p.action === 'clear')
        this.run('UPDATE glossary_mentions SET dismissed=1 WHERE name IS NULL');
      else if (p.action === 'dismiss')
        this.run(
          'UPDATE glossary_mentions SET dismissed=1 WHERE meeting_id=? AND original=?',
          p.meeting_id,
          p.original,
        );
      else {
        if (p.workspace_id && p.workspace_id !== 'public' && !this.getWorkspace(p.workspace_id))
          throw new Error('Workspace unavailable');
        this.run(
          'INSERT INTO glossary_entries VALUES(?,?,?) ON CONFLICT(scope,name) DO UPDATE SET meaning=excluded.meaning',
          p.workspace_id,
          p.name,
          p.meaning,
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
