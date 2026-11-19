const { createHash } = require('node:crypto');
const { supportedRelation } = require('./meeting-evidence.cjs');
const { splitByBudget, estimatedTokens, unsupportedFact } = require('./summary-facts.cjs');

const kinds = ['overview', 'finding', 'cause', 'decision', 'action', 'open', 'figure'];
const normalize = (s) =>
  s
    .normalize('NFKC')
    .replace(/[\s\p{P}]/gu, '')
    .toLowerCase();
const plain = (s) => typeof s === 'string' && s.trim().replace(/[\r\n#\[\]]+/g, ' ');

function readTopics(raw, part, segments) {
  const notes = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''))?.notes;
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
  remoteOutputBudget,
  reviewBudget = budget,
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
  // 结构化条目要同时写结论和原话，在线小输出窗口先给两者预留空间。
  const target = local
    ? 2400
    : Math.min(4200, remoteOutputBudget ? Math.max(128, Math.floor(remoteOutputBudget / 2)) : 4200);
  const blocks = splitByBudget(transcript, Math.min(budget, target));
  const wholeMeeting =
    !local && blocks.length === 1
      ? language === 'zh'
        ? '这是整场会议。用一至三条 overview 概括最终状态，涵盖会尾确认的决定并引用其段号。后续已推翻的提议只作历史背景。其他每项选最合适的一个分类，避免重复；保留行动的负责人和时限。'
        : 'This is the entire meeting. Use one to three overview items for the final status, including the confirmed closing decision and its source. Treat superseded proposals as historical. Give each detail a single best category and retain action owners and deadlines.'
      : '';
  async function draft(part, depth = 0) {
    await wait();
    try {
      const raw = await generate(
        [
          instruction,
          !depth && wholeMeeting,
          template + ' meeting; write in ' + language,
          format,
          part,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      const rows = readTopics(raw, part, segments);
      if (!rows.length && estimatedTokens(part) > 450)
        throw new SyntaxError('No notes with verifiable quotations');
      return rows;
    } catch (error) {
      if (!limit(error) && !(depth < 2 && error instanceof SyntaxError)) throw error;
      const halves = splitByBudget(part, Math.max(128, Math.ceil(estimatedTokens(part) / 2)));
      if (halves.length < 2) throw error;
      const rows = [];
      for (const half of halves) rows.push(...(await draft(half, depth + 1)));
      return rows;
    }
  }
  const review =
    language === 'zh'
      ? '你在校订会议纪要。speech 是按原始段号索引的原话。逐项核对 items 中 sources 指向的原话；相邻 context 只有直接支持本项时才可引用。改写成原话能完整支持的书面总结；保留试验、假设和比较范围，删除无依据的归因、主体和数字。先选直接支持结论的发言编号（可多段）；只借相邻句解指代，不猜听写含混的人名或词。因果解释须回答本项的具体为什么问题，缺少答案就舍弃。返回 {"edits":[{"n":1,"text":"修订后的一至两句","topic":"修订后的业务问题或主题","sources":[原始发言编号]}]}，n 是条目编号，不是转写编号。数字须和同一句中的指标一起核实。听写含混时保留原话能支持的定性关系，勿猜测指标名称或换算口语数字。只在原 kind 分错时补充更正后的 kind：候选日期或待定选择用 open，安排工作用 action，正式拍板才用 decision。每个 n 必须恰好返回一项；舍弃项返回空 text 和空 sources。'
      : 'For each item check its sources against the speech dictionary keyed by original segment number. Cite adjacent context only when it directly supports that item. Retain only supported content and qualifications; omit an unsupported causal relationship. Return {"edits":[{"n":1,"text":"revised note","topic":"revised question or topic","sources":[original segment numbers]}]}, using the item number. Verify each figure together with its metric in the same source statement. For unclear figures keep only supported qualitative facts. If its kind is wrong, include the corrected kind: open for tentative proposals, action for assigned work, decision only for confirmed choices. Return exactly one entry for every n; use empty text and sources to discard an item.';
  const numberCorrection =
    language === 'zh'
      ? ' 上一版数字或指标错误。仅看本项原话，用一句话写明做了什么、发生了什么变化。省略模糊数值，只写原话明确支持的定性关系；若保留小数，须照录同时说清指标与数值的原文分句。仍无法支持就舍弃。'
      : ' Use only the cited speech. Write one sentence explaining what changed and in which direction. Omit ambiguous values. Retain decimals only in a verbatim clause naming their metric, or discard the item.';
  const partials = new Array(blocks.length);
  let completed = 0;
  const groups = await mapChunks(blocks, async (part, index) => {
    const excerpts = new Map(
      [...part.matchAll(/^S(\d+) \[[^\]]*\] (.*)$/gm)].map((m) => [+m[1], m[2]]),
    );
    const available = new Map();
    for (const id of new Set([...excerpts.keys()].flatMap((id) => [id - 1, id, id + 1]))) {
      const text = segments[id - 1]?.text;
      if (!text) continue;
      const excerpt = estimatedTokens(text) < budget / 4 ? text : excerpts.get(id);
      if (excerpt) available.set(id, excerpt);
    }
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          instruction,
          wholeMeeting,
          format,
          review,
          numberCorrection,
          language,
          template,
          modelKey,
          part,
          [...available],
        ]),
      )
      .digest('hex');
    const cached = store.one?.(
      'SELECT facts FROM summary_chunks WHERE meeting_id=? AND position=? AND fingerprint=?',
      meetingId,
      index,
      key,
    );
    const draftRows = cached ? JSON.parse(cached.facts) : await draft(part);
    await wait();
    partials[index] = draftRows;
    preview?.(renderTopics(partials.flat(), headings, false), ++completed, blocks.length);
    if (cached) return draftRows;
    async function edit(batch, repairNumbers = false) {
      await wait();
      const speech = {};
      const items = batch.map((r, i) => {
        const sources = [];
        const context = [];
        for (const id of new Set(
          repairNumbers ? r.ids : r.ids.flatMap((id) => [id - 1, id, id + 1]),
        )) {
          if (!available.has(id)) continue;
          speech[id] = available.get(id);
          if (r.ids.includes(id)) sources.push(id);
          else context.push(id);
        }
        return {
          n: i + 1,
          kind: r.kind,
          topic: r.topic,
          text: repairNumbers ? undefined : r.text,
          sources,
          context,
        };
      });
      const prompt =
        review + (repairNumbers ? numberCorrection : '') + '\n' + JSON.stringify({ speech, items });
      if (batch.length === 1 || estimatedTokens(prompt) <= reviewBudget) {
        try {
          const raw = await generate(prompt);
          const reply = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
          // 部分本地模型会直接输出校订数组，或给完整对象多包一层数组。
          let edits = reply?.edits;
          if (Array.isArray(reply)) {
            edits = reply.length === 1 && Array.isArray(reply[0]?.edits) ? reply[0].edits : reply;
          }
          if (
            !Array.isArray(edits) ||
            edits.length !== batch.length ||
            !batch.every((_, i) => edits.filter((e) => e?.n === i + 1).length === 1)
          )
            throw new SyntaxError('Incomplete reviewed notes');
          const retry = [];
          const accepted = batch.flatMap((r, i) => {
            const entry = edits.find((e) => e?.n === i + 1);
            const text = plain(entry?.text),
              topic = plain(entry?.topic);
            let kind = kinds.includes(entry?.kind) ? entry.kind : r.kind;
            if (text && /[?？]$/.test(text)) kind = 'open';
            const ids = Array.isArray(entry?.sources) && [...new Set(entry.sources)];
            if (
              !text ||
              !ids?.length ||
              (kind === 'cause' && !topic) ||
              !ids.every((id) => items[i].sources.includes(id) || items[i].context.includes(id))
            )
              return [];
            const row = { ...r, kind, ids, text, topic: topic || r.topic };
            const quotes = ids.map((id) => speech[id]);
            // 小模型会把原话中的小数冠以另一项指标。保留小数时核对所在分句。
            const ungroundedDecimal =
              local &&
              /\d+\.\d+/.test(text) &&
              text
                .split(/[，。；！？;!?]|(?<!\d)[.,]|[.,](?!\d)/u)
                .some(
                  (clause) =>
                    /\d+\.\d+/.test(clause) &&
                    !quotes.some((quote) =>
                      quote.replace(/\s+/g, '').includes(clause.replace(/\s+/g, '')),
                    ),
                );
            if (unsupportedFact(text, quotes) || ungroundedDecimal) {
              if (!repairNumbers && /\d/.test(text)) retry.push(row);
              if (!local || !repairNumbers) return [];
              // 两次核对仍误解数值时，仅展示能完整照录的短原话，不替它解释指标。
              return ids.flatMap((id) => {
                const quote = segments[id - 1].text.trim();
                if (!speech[id].includes(quote) || estimatedTokens(quote) > 180) return [];
                const cause =
                  kind === 'cause' && supportedRelation(quote, topic, [{ text: quote }], true);
                if (!cause && !/\d/.test(quote)) return [];
                return [
                  {
                    kind: cause ? 'cause' : 'finding',
                    topic: cause ? topic : '',
                    text:
                      language === 'zh'
                        ? '原话：“' + plain(quote) + '”'
                        : 'Source: “' + plain(quote) + '”',
                    ids: [id],
                  },
                ];
              });
            }
            return [row];
          });
          if (retry.length) {
            try {
              accepted.push(...(await edit(retry, true)));
            } catch (error) {
              if (!limit(error) && !(error instanceof SyntaxError)) throw error;
            }
          }
          return accepted;
        } catch (error) {
          if (batch.length < 2 || !(limit(error) || error instanceof SyntaxError)) throw error;
        }
      }
      const half = Math.ceil(batch.length / 2);
      return [
        ...(await edit(batch.slice(0, half), repairNumbers)),
        ...(await edit(batch.slice(half), repairNumbers)),
      ];
    }
    const rows = draftRows.length ? await edit(draftRows) : [];
    partials[index] = rows;
    await wait();
    store.run?.(
      'INSERT OR REPLACE INTO summary_chunks SELECT id,?,?,? FROM meetings WHERE id=? AND deleted_at IS NULL',
      index,
      key,
      JSON.stringify(rows),
      meetingId,
    );
    return rows;
  });
  const rows = groups.flat();
  if (!rows.length) {
    // 整场没有可用结果时允许重新提取，避免每次重试都命中同一批空结果。
    store.run?.("DELETE FROM summary_chunks WHERE meeting_id=? AND facts='[]'", meetingId);
    throw new Error('No supported meeting notes after review');
  }
  const highlights = rows.filter((r) => r.kind === 'overview');
  // 同一块也可能先提议、后拍板，综合摘要时要同时看见两者。
  const decisions = rows.filter((r) => r.kind === 'decision');
  const latestDecision = decisions.sort((a, b) => Math.max(...b.ids) - Math.max(...a.ids))[0];
  const missingDecision =
    latestDecision && !highlights.some((r) => latestDecision.ids.every((id) => r.ids.includes(id)));
  if (!local && (blocks.length > 1 || missingDecision)) {
    const candidates =
      highlights.length >= 2
        ? rows.filter((r) => r.kind === 'overview' || r.kind === 'decision')
        : rows.filter((r) => ['overview', 'finding', 'decision', 'action'].includes(r.kind));
    candidates.sort((a, b) => Math.max(...a.ids) - Math.max(...b.ids));
    const index = candidates.map((r, i) => i + 1 + '. [' + r.kind + '] ' + r.text).join('\n');
    if (candidates.length && estimatedTokens(index) < budget) {
      await wait();
      const prompt =
        'Compose a meeting-wide executive summary in ' +
        language +
        ' for a reader who missed the meeting. Write at most four concise conclusions about the main business topics. Combine related evidence and lead with final decisions. The notes are in transcript order. State each topic’s final status: when a later confirmed decision resolves an earlier proposal, cite the decision and report the outcome. Mention an earlier proposal only to explain how the final decision changed. Keep unresolved hypotheses conditional. Each item must be fully supported by the numbered notes it selects. JSON {"overview":[{"text":"one concise thematic conclusion","notes":[1,2]}]}\n' +
        index;
      try {
        const raw = await generate(prompt);
        const overview = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''))?.overview;
        const summarized = new Set();
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
            for (const n of r.notes) summarized.add(candidates[n - 1]);
            return [
              {
                kind: 'overview',
                text,
                ids,
              },
            ];
          });
        if (merged?.length) {
          if (
            latestDecision &&
            !merged.some((r) => latestDecision.ids.every((id) => r.ids.includes(id)))
          ) {
            merged.unshift({ ...latestDecision, kind: 'overview' });
          }
          // 被综合的分段摘要可能描述会中尚未拍板的状态，不再把它列为最终结论。
          const supporting = rows.filter((r) => r.kind !== 'overview' || !summarized.has(r));
          for (const r of supporting) {
            if (r.kind === 'overview') {
              r.kind = 'finding';
              r.text =
                (language === 'zh' ? '当时讨论中，' : 'At that point in the discussion, ') + r.text;
            }
          }
          return renderTopics([...merged, ...supporting], headings, true);
        }
      } catch (error) {
        if (!limit(error) && !(error instanceof SyntaxError)) throw error;
      }
    }
  }
  if (!local && missingDecision) rows.unshift({ ...latestDecision, kind: 'overview' });
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
