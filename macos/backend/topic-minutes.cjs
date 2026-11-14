const { createHash } = require('node:crypto');
const { splitByBudget, estimatedTokens, unsupportedFact } = require('./summary-facts.cjs');

const kinds = ['overview', 'finding', 'cause', 'decision', 'action', 'open', 'figure'];
const normalize = (s) =>
  s
    .normalize('NFKC')
    .replace(/[\s\p{P}]/gu, '')
    .toLowerCase();
const plain = (s) => typeof s === 'string' && s.trim().replace(/[\r\n#\[\]]+/g, ' ');

function readTopics(raw, part, segments) {
  const { notes } = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
  if (!Array.isArray(notes)) throw new SyntaxError('Missing meeting notes');
  const visible = [...part.matchAll(/^S(\d+) \[/gm)].map((m) => Number(m[1]));
  const rows = [];
  for (const note of notes) {
    const text = plain(note?.text);
    const topic = plain(note?.topic);
    if (!text || !kinds.includes(note.kind) || (note.kind === 'cause' && !topic)) continue;
    if (!Array.isArray(note.refs) || !note.refs.length) continue;
    const ids = [];
    for (const ref of note.refs) {
      const anchor = typeof ref?.quote === 'string' && normalize(ref.quote);
      if (!anchor || anchor.length < 4) break;
      const matches = visible.filter((id) => normalize(segments[id - 1].text).includes(anchor));
      const given = Number(String(ref.id).replace(/^S/, ''));
      const id = matches.includes(given) ? given : matches.length === 1 && matches[0];
      if (!id) break;
      ids.push(id);
    }
    if (ids.length === note.refs.length)
      rows.push({ kind: note.kind, text, topic, ids: [...new Set(ids)] });
  }
  return rows;
}

async function topicMinutes({
  transcript,
  segments,
  headings,
  language,
  template,
  budget,
  local,
  mapChunks,
  generate,
  limit,
  wait,
  store,
  meetingId,
  modelKey,
  preview,
}) {
  const instruction =
    language === 'zh'
      ? '为未参会者按业务议题写会议纪要。overview 分主题综合进展、比较结果与未决选择；finding 记录重要细节。cause 专门解释业务问题：topic 是读者可独立理解的具体为什么问题，text 用完整句说明背景、作用过程和结果。覆盖会议中实际解释过的重要业务约束、成本差异、试验取舍和表现变化。一条只解释一个关系，保留发言中的条件、推测和反例。decision 只写明确拍板的选择，action 写后续工作。每条 refs 使用原始 S 段号和该段连续照抄的短语（建议6至12字）；跨段解释分别列出支撑原因和结果的段号，不要从主题相似推断因果。数字和专名沿用原话。'
      : 'Write thematic minutes for an absent colleague. Overview items synthesize progress, comparisons and unresolved choices; findings give supporting detail. For each explained outcome, write a self-contained why question as topic and a complete explanation of the mechanism and outcome as text. Keep hypotheses conditional. Decisions require explicit agreement. Cite short verbatim spans that together support each entire item.';
  const format =
    'JSON: {"notes":[{"kind":"overview|finding|cause|decision|action|open|figure","topic":"topic or why question","text":"synthesis","refs":[{"id":1,"quote":"short verbatim excerpt"}]}]}';
  const blocks = splitByBudget(transcript, Math.min(budget, local ? 2400 : 4200));
  async function draft(part, depth = 0) {
    await wait();
    try {
      const raw = await generate(
        [instruction, template + ' meeting; write in ' + language, format, part].join('\n'),
      );
      const rows = readTopics(raw, part, segments);
      if (!rows.length && estimatedTokens(part) > 450)
        throw new SyntaxError('No notes with verifiable quotations');
      return rows;
    } catch (error) {
      if (depth >= 2 || !(limit(error) || error instanceof SyntaxError)) throw error;
      const halves = splitByBudget(part, Math.max(128, Math.ceil(estimatedTokens(part) / 2)));
      if (halves.length < 2) throw error;
      const rows = [];
      for (const half of halves) rows.push(...(await draft(half, depth + 1)));
      return rows;
    }
  }
  const review =
    language === 'zh'
      ? '你在校订会议纪要。逐项对照这一项附带的转写原文，改写成原话能完整支持的书面总结；保留试验、假设和比较范围，删除无依据的归因、主体和数字。先选直接支持结论的发言编号（可多段）；只借相邻句解指代，不猜听写含混的人名或词。因果解释须回答本项的具体为什么问题，缺少答案就舍弃。返回 {"edits":[{"n":1,"text":"修订后的一至两句","topic":"修订后的业务问题或主题","sources":[原始发言编号]}]}，n 是条目编号，不是转写编号。每个 n 必须恰好返回一项；舍弃项返回空 text 和空 sources。'
      : 'Edit each note against its attached source speech. Retain only supported content and qualifications; omit an unsupported causal relationship. Return {"edits":[{"n":1,"text":"revised note","topic":"revised question or topic","sources":[original segment numbers]}]}, using the item number. Return exactly one entry for every n; use empty text and sources to discard an item.';
  const partials = new Array(blocks.length);
  let completed = 0;
  const drafts = await mapChunks(blocks, async (part, index) => {
    const labels = [...part.matchAll(/^S(\d+) \[/gm)].map((m) => Number(m[1]));
    const neighbors = [segments[labels[0] - 2]?.text, segments[labels.at(-1)]?.text];
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          instruction,
          format,
          review,
          language,
          template,
          modelKey,
          part,
          neighbors,
        ]),
      )
      .digest('hex');
    const cached = store.one?.(
      'SELECT facts FROM summary_chunks WHERE meeting_id=? AND position=? AND fingerprint=?',
      meetingId,
      index,
      key,
    );
    const rows = cached ? JSON.parse(cached.facts) : await draft(part);
    await wait();
    partials[index] = rows;
    preview?.(renderTopics(partials.flat(), headings, false), ++completed, blocks.length);
    return { rows, key, cached, part };
  });
  const rows = (
    await mapChunks(drafts, async ({ rows: draftRows, key, cached, part }, index) => {
      if (cached || !draftRows.length) return draftRows;
      const excerpts = new Map(
        [...part.matchAll(/^S(\d+) \[[^\]]*\] (.*)$/gm)].map((m) => [+m[1], m[2]]),
      );
      async function edit(batch) {
        await wait();
        const input = batch.map((r, i) => ({
          n: i + 1,
          kind: r.kind,
          topic: r.topic,
          text: r.text,
          speech: [...new Set(r.ids.flatMap((id) => [id - 1, id, id + 1]))]
            .filter((id) => id > 0 && id <= segments.length)
            .flatMap((id) => {
              const text = segments[id - 1].text;
              if (estimatedTokens(text) < budget / 4) return [{ id, text }];
              return excerpts.has(id) ? [{ id, text: excerpts.get(id) }] : [];
            }),
        }));
        try {
          const raw = await generate(review + '\n' + JSON.stringify(input));
          const { edits } = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
          if (
            !Array.isArray(edits) ||
            !batch.every((_, i) => edits.filter((e) => e?.n === i + 1).length === 1)
          )
            throw new SyntaxError('Incomplete reviewed notes');
          return batch.flatMap((r, i) => {
            const entry = edits.find((e) => e?.n === i + 1);
            const text = plain(entry?.text),
              topic = plain(entry?.topic);
            const kind = r.kind;
            const ids = Array.isArray(entry?.sources) && [...new Set(entry.sources)];
            return text &&
              ids?.length &&
              ids.every((id) => input[i].speech.some((s) => s.id === id)) &&
              !unsupportedFact(
                text,
                ids.map((id) => segments[id - 1].text),
              ) &&
              (kind !== 'cause' || topic)
              ? [{ ...r, kind, ids, text, topic: topic || r.topic }]
              : [];
          });
        } catch (error) {
          if (batch.length < 2 || !(limit(error) || error instanceof SyntaxError)) throw error;
          const half = Math.ceil(batch.length / 2);
          return [...(await edit(batch.slice(0, half))), ...(await edit(batch.slice(half)))];
        }
      }
      const rows = await edit(draftRows);
      if (!rows.length) return [];
      await wait();
      store.run?.(
        'INSERT OR REPLACE INTO summary_chunks SELECT id,?,?,? FROM meetings WHERE id=? AND deleted_at IS NULL',
        index,
        key,
        JSON.stringify(rows),
        meetingId,
      );
      return rows;
    })
  ).flat();
  if (!rows.length) throw new Error('No supported meeting notes after review');
  // Compose across blocks using only reviewed findings; references follow the selected findings.
  if (!local && blocks.length > 1) {
    const highlights = rows.filter((r) => r.kind === 'overview');
    const candidates =
      highlights.length >= 2
        ? highlights
        : rows.filter((r) => ['finding', 'decision', 'action'].includes(r.kind));
    const index = candidates.map((r, i) => i + 1 + '. ' + r.text).join('\n');
    if (candidates.length && estimatedTokens(index) < budget) {
      await wait();
      const prompt =
        'Compose a meeting-wide executive summary in ' +
        language +
        ' for a reader who missed the meeting. Group the main business topics across the entire meeting. Preserve uncertainty and distinguish trials from decisions. Each item must be fully supported by the numbered notes it selects. JSON {"overview":[{"text":"one concise thematic conclusion","notes":[1,2]}]}\n' +
        index;
      try {
        const raw = await generate(prompt);
        const { overview } = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
        const merged =
          Array.isArray(overview) &&
          overview.flatMap((r) => {
            const text = plain(r?.text);
            if (
              !text ||
              !Array.isArray(r.notes) ||
              !r.notes.length ||
              !r.notes.every((n) => Number.isInteger(n) && n > 0 && n <= candidates.length)
            )
              return [];
            const ids = [...new Set(r.notes.flatMap((n) => candidates[n - 1].ids))];
            if (
              unsupportedFact(
                text,
                ids.map((id) => segments[id - 1].text),
              )
            )
              return [];
            return [
              {
                kind: 'overview',
                text,
                ids,
              },
            ];
          });
        if (merged?.length) {
          for (const r of highlights) r.kind = 'finding';
          rows.unshift(...merged);
        }
      } catch (error) {
        if (!limit(error) && !(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return renderTopics(rows, headings, true);
}
function renderTopics(rows, headings, cited) {
  const sections = headings.map(() => new Map());
  for (const { kind, text, topic, ids } of rows) {
    const i = kinds.indexOf(kind);
    const section = sections[i];
    const group = i === 2 ? topic : '';
    if (!section.has(group)) section.set(group, new Set());
    const marker = [
      'conclusion',
      'conclusion',
      'cause',
      'decision',
      'action',
      'conclusion',
      'conclusion',
    ][i];
    section
      .get(group)
      .add(
        '- ' +
          text +
          ' [[' +
          marker +
          ':' +
          (cited ? ids.map((id) => 'S' + id).join(',') : '') +
          ']]',
      );
  }
  return headings
    .map(
      (heading, i) =>
        '## ' +
        heading +
        '\n' +
        ([...sections[i]]
          .map(([topic, lines]) => (topic ? '### ' + topic + '\n' : '') + [...lines].join('\n'))
          .join('\n\n') || '—'),
    )
    .join('\n\n');
}
module.exports = { readTopics, topicMinutes };
