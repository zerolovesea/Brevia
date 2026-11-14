// The model selects evidence. The renderer copies names, figures and qualifications from the transcript.
const sections = [
  'overview',
  'conclusions',
  'discussion',
  'decisions',
  'actions',
  'questions',
  'figures',
];

function evidencePrompt(language, template, preference, transcript) {
  return `Select evidence for ${template} meeting minutes in ${language}. Return JSON only: {"topics":[{"title":"short descriptive topic","discussion":[1,2],"decisions":[],"actions":[],"questions":[],"figures":[]}],"overview":[],"conclusions":[]}. Arrays contain actual numeric segment IDs. Read the entire transcript and cover every substantive topic, including later corrections. Select the shortest sequence of original statements that preserves the subject, comparisons, quantities, time spans and conditions. Include explicit causes in discussion. Only assign confirmed commitments to decisions, actual follow-ups to actions, and statements of measured quantities to figures. Keep questions and hypotheses in their original status. Prefer a few representative statements per topic.
${preference}
<transcript>
${transcript}
</transcript>`;
}

function renderSelection(text, segments, headings, allowed) {
  const json = JSON.parse(text.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ''));
  const bodies = sections.map(() => []);
  const seen = sections.map(() => new Set());
  const overview = [];
  const safe = (s) =>
    s
      .replace(/[\r\n]+/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/([\\\x60*_~|[\]])/g, '\\$1')
      .trim();
  const add = (key, values) => {
    const section = sections.indexOf(key);
    for (const value of Array.isArray(values) ? values : []) {
      const id = Number(String(value).replace(/^S/, ''));
      if (!allowed.has(id) || seen[section].has(id)) continue;
      seen[section].add(id);
      const quote = safe(segments[id - 1].text);
      if (
        key === 'decisions' &&
        !/(?:决定|确定|已|就不|没测|放弃|调回|先用|继续|优先|停止|确认|decided|agreed|approved)/iu.test(
          quote,
        )
      )
        continue;
      if (
        key === 'decisions' &&
        /我觉得|我建议|可能|如果|要不|也许|建议|might|suggest/i.test(quote)
      )
        continue;
      if (key === 'actions' && /[?？]$/.test(quote)) continue;
      if (key === 'decisions' && /想把|想留|估计|倾向|好像|是不是|[?？]$/.test(quote)) continue;
      const kind = { actions: 'action', decisions: 'decision' }[key] || 'conclusion';
      const previous = segments[id - 2];
      const needsContext =
        key === 'actions' && quote.length < 20 && previous && allowed.has(id - 1);
      const statement = needsContext ? safe(previous.text) + ' ' + quote : quote;
      const refs = needsContext ? 'S' + (id - 1) + ',S' + id : 'S' + id;
      bodies[section].push('- ' + statement + ' [[' + kind + ':' + refs + ']]');
    }
  };
  add('overview', json.overview);
  add('conclusions', json.conclusions);
  for (const topic of json.topics || []) {
    if (!topic || typeof topic.title !== 'string') continue;
    const start = bodies[2].length;
    for (const key of sections.slice(2)) add(key, topic[key]);
    if (bodies[2].length > start) {
      const title = topic.title.replace(/[\r\n#[\]<>]/g, ' ').trim();
      bodies[2].splice(start, 0, '### ' + title);
      const selected = topic.discussion
        .map((id) => Number(String(id).replace(/^S/, '')))
        .filter((id) => allowed.has(id));
      const evidence = selected.flatMap((id) =>
        (segments[id - 1].text.match(/[^。！？!?]+(?:[。！？!?]|$)/gu) || []).map((sentence) => ({
          id,
          sentence,
        })),
      );
      const anchors = Array.from(title.matchAll(/(?=([\u3400-\u9fff]{2}))/gu), (m) => m[1]);
      const score = (sentence) => anchors.filter((word) => sentence.includes(word)).length;
      const quote = evidence
        .filter(({ sentence }) => sentence.length >= 10 && !/[？?]$/.test(sentence))
        .sort((a, b) => score(b.sentence) - score(a.sentence))[0];
      if (quote)
        overview.push(
          '- **' + safe(title) + '** ' + safe(quote.sentence) + ' [[conclusion:S' + quote.id + ']]',
        );
    }
  }
  // Keep quantified progress and remaining balances together, even when the model omitted the topic.
  for (const id of allowed) {
    const quote = segments[id - 1].text;
    if (
      /(?:已|取了|完成|used|completed).{0,40}(?:[万千百%％]|\d).{0,40}(?:还[有剩]|剩余|remaining|left).{0,20}(?:[万千百%％]|\d)/iu.test(
        quote,
      ) &&
      !/[？?]/.test(quote)
    ) {
      add(
        'figures',
        allowed.has(id - 1) && /[万千百]|\d/.test(segments[id - 2].text) ? [id - 1, id] : [id],
      );
    }
  }
  if (!bodies[4].length) {
    for (const id of allowed) {
      const source = segments[id - 1].text;
      if (
        /(?:我(?:们)?(?:会|来|去)|我(?:再|去帮忙)|你(?:可以|去)|我们都).{0,16}(?:跟进|问一下|询问|核对|确认|留意|安排|反馈|提交)|\b(?:I|we) will (?:check|send|follow up|confirm)/iu.test(
          source,
        )
      )
        add('actions', [id]);
    }
  }
  if (!bodies[0].length && overview.length) bodies[0] = overview;
  if (!bodies[0].length)
    bodies[0] = bodies[2]
      .filter((line) => line.startsWith('### '))
      .map((line) => '- ' + line.slice(4));
  if (!bodies[1].length) bodies[1] = (bodies[3].length ? bodies[3] : overview).slice(0, 4);
  if (!seen[2].size) throw new Error('No sourced discussion in model response');
  return headings
    .map((heading, i) => '## ' + heading + '\n' + (bodies[i].join('\n') || '—'))
    .join('\n\n');
}
module.exports = { evidencePrompt, renderSelection };
