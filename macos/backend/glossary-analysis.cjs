const { splitByBudget } = require('./summary-facts.cjs');
async function analyzeTerms(worker, meeting, transcript, options, generate, control) {
  const scope = meeting.workspace_id || 'public';
  const entries = worker.store.query(
    'SELECT scope,name,meaning FROM glossary_entries WHERE scope=? OR scope=? ORDER BY scope DESC',
    scope,
    '',
  );
  const catalog = new Map();
  for (const term of entries) if (!catalog.has(term.name)) catalog.set(term.name, term);
  const aliases = worker.store.query(
    'SELECT * FROM glossary_aliases WHERE scope=? OR scope=? ORDER BY scope DESC',
    scope,
    '',
  );
  const definitions = JSON.stringify(
    [...catalog.values()].map(({ name, meaning }) => [name, meaning]),
  );
  const { estimatedTokens } = require('./summary-facts.cjs');
  const budget = Math.min(6000, options.context_size - estimatedTokens(definitions) - 2000);
  for (const part of splitByBudget(transcript, budget)) {
    await control.wait();
    const raw = await generate(
      { ...options, max_tokens: 768, temperature: 0 },
      'Identify domain terms in this transcript. Return JSON {"terms":[{"original":"exact transcript spelling","match":"exact dictionary name or null"}]}. Match only when context and meaning identify the same entity, including a transcription error. Omit common words and uncertain matches to known names. Flag unfamiliar domain-specific names for human review. Dictionary: ' +
        definitions +
        '\nTranscript:\n' +
        part,
      { signal: control.signal, jsonMode: true },
    );
    const { terms } = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
    await control.wait();
    if (!worker.store.meetingExists(meeting.id)) return;
    let changed = false;
    for (const t of [
      ...aliases
        .filter((a) => part.includes(a.original))
        .map((a) => ({ original: a.original, match: a.name })),
      ...(Array.isArray(terms) ? terms : []),
    ]) {
      if (
        typeof t?.original !== 'string' ||
        !t.original.trim() ||
        t.original.length > 80 ||
        !part.includes(t.original) ||
        !meeting.segments.some((s) => s.text.includes(t.original))
      )
        continue;
      const known = catalog.get(t.original) || catalog.get(t.match);

      const result = worker.store.run(
        'INSERT INTO glossary_mentions(meeting_id,original,name,scope) VALUES(?,?,?,?) ON CONFLICT(meeting_id,original) DO UPDATE SET name=excluded.name,scope=excluded.scope WHERE glossary_mentions.name IS NULL AND glossary_mentions.dismissed=0 AND excluded.name IS NOT NULL',
        meeting.id,
        t.original,
        known?.name ?? null,
        known?.scope ?? null,
      );
      if (result.changes) changed = true;
    }
    if (changed) worker.emit('glossary.updated', { meeting_id: meeting.id });
  }
}
module.exports = { analyzeTerms };
