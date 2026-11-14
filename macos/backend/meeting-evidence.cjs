const { randomUUID } = require('node:crypto');
const TEMPLATES = {
  general: 'Group discussion by topic.',
  weekly: 'In Topic Discussion, cover progress, blockers and next week’s plans.',
  interview:
    'Under Topic Discussion, group observations, examples and follow-ups by interview question.',
  review: 'Under Topic Discussion, cover proposals, findings, causes and required revisions.',
};
const SUMMARY_HEADINGS = {
  zh: ['会议摘要', '核心结论', '议题讨论', '已确认决定', '行动项', '待确认事项', '关键数据'],
  en: [
    'Meeting Summary',
    'Key Conclusions',
    'Topic Discussion',
    'Confirmed Decisions',
    'Action Items',
    'Open Questions',
    'Key Figures',
  ],
  ja: [
    '会議概要',
    '主な結論',
    '議題別の討議',
    '決定事項',
    'アクション項目',
    '要確認事項',
    '主要データ',
  ],
  ko: [
    '회의 요약',
    '핵심 결론',
    '안건 논의',
    '확정된 결정',
    '실행 항목',
    '확인할 사항',
    '주요 데이터',
  ],
  es: [
    'Resumen de la reunión',
    'Conclusiones clave',
    'Temas tratados',
    'Decisiones confirmadas',
    'Tareas',
    'Cuestiones pendientes',
    'Datos clave',
  ],
  fr: [
    'Résumé de la réunion',
    'Conclusions principales',
    'Sujets discutés',
    'Décisions confirmées',
    'Actions à mener',
    'Questions en suspens',
    'Chiffres clés',
  ],
  de: [
    'Besprechungsübersicht',
    'Zentrale Schlussfolgerungen',
    'Besprochene Themen',
    'Bestätigte Entscheidungen',
    'Aufgaben',
    'Offene Fragen',
    'Kennzahlen',
  ],
  ru: [
    'Краткое содержание',
    'Основные выводы',
    'Обсуждение тем',
    'Принятые решения',
    'Задачи',
    'Открытые вопросы',
    'Ключевые данные',
  ],
};
function splitLines(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
const MARK = /\[\[(conclusion|decision|action|cause):([^\]\n]*)\]\]/g;
const CAUSE = /因为|原因(?:是|在于)|\bbecause\b|\bdue to\b/i;
const clock = (ms) =>
  [Math.floor(ms / 60000), Math.floor(ms / 1000) % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
function confirmedDate(value) {
  if (value == null || value === '') return null;
  if (
    typeof value !== 'string' ||
    Number(value.slice(0, 4)) < 1 ||
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('Invalid meeting date');
  return value;
}
function annotateDates(text, meetingDate) {
  if (!meetingDate) return text;
  const base = new Date(confirmedDate(meetingDate));
  const offsets = {
    今天: 0,
    明天: 1,
    后天: 2,
    大后天: 3,
    昨天: -1,
    前天: -2,
    大前天: -3,
    today: 0,
    tomorrow: 1,
    yesterday: -1,
    'the day after tomorrow': 2,
    'the day before yesterday': -2,
  };
  const days = 'monday tuesday wednesday thursday friday saturday sunday'.split(' ');
  const pattern =
    /(?:本|这|下下|下|上)(?:周|星期)[一二三四五六日天]|大后天|大前天|(?<![大昨明前后])(?:今天|明天|后天|昨天|前天)|\b(?:the day after tomorrow|the day before yesterday|tomorrow|today|yesterday|(?:next|this|last) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi;
  return text.replace(pattern, (term) => {
    let offset = offsets[term.toLowerCase()];
    const english = /^[\x00-\x7F]*$/.test(term);
    if (offset === undefined) {
      let weeks, day;
      if (english) {
        const [week, weekday] = term.toLowerCase().split(' ');
        weeks = { this: 0, last: -1, next: 1 }[week];
        day = days.indexOf(weekday);
      } else {
        weeks = term.startsWith('下下') ? 2 : { 本: 0, 这: 0, 下: 1, 上: -1 }[term[0]];
        day = '一二三四五六日'.indexOf(term.at(-1).replace('天', '日'));
      }
      offset = weeks * 7 + day - ((base.getUTCDay() + 6) % 7);
    }
    const date = new Date(base.getTime() + offset * 86400000);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return term;
    if (english) return `${term} (${date.toISOString().slice(0, 10)})`;
    const year =
      date.getUTCFullYear() === base.getUTCFullYear() ? '' : `${date.getUTCFullYear()} 年 `;
    return `${term}（${year}${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日）`;
  });
}
function evidenceInstructions(template, language) {
  if (!Object.hasOwn(TEMPLATES, template)) throw new Error('Unknown meeting template');
  if (language === 'zh')
    return `按所选模板组织议题讨论（${TEMPLATES[template]}）。每个议题用三级标题，发生了什么、有哪些观点写在正文中。如果发言明确解释了原因，把问题作为三级标题，在该标题下单列“- 原因说明 [[cause:S2,S4]]”。原话必须明确连接该问题和原因。关键数字、开放问题和时间先后不能用 cause 标记，不能从资料缺失推断待办或待确认事项。结论、决定、行动项分别使用 [[conclusion:S1]]、[[decision:S2]]、[[action:S3]]；段号必须来自对应原话。合并时保留事实、数据、来源标记、明确的术语修订、原相对日期及所附日历注释，不自行换算日期。`;
  return `Write in ${language}. ${TEMPLATES[template]} Preserve facts, decisions, actions, open questions, figures and explicitly stated causes during compression. End each substantive bullet with its supporting transcript IDs, e.g. [[decision:S1,S3]]. Use conclusion, decision, action or cause. Never guess IDs. Under Topic Discussion use a level-three problem heading and a distinct [[cause:...]] bullet only when the source explicitly connects that problem and cause. Preserve uncertainty, relative date wording and supplied calendar annotations. Never infer deadlines or causes from chronology. Preserve explicit terminology corrections.`;
}
function snapshot(row, seekable = true) {
  return {
    segment_id: row.id || row.segment_id,
    text: row.text,
    speaker: row.speaker_name || row.speaker || '',
    start_ms: row.start_ms,
    end_ms: row.end_ms ?? row.start_ms,
    track: row.track || 'mic',
    version: row.version || 'live',
    revision: row.revision || 0,
    seekable,
  };
}
function claimRecord(text, kind, sources, section = '', id) {
  return {
    id: id || randomUUID(),
    kind,
    text,
    original_text: text,
    section,
    sources,
    edited: false,
  };
}
function restrictSources(markdown, allowed) {
  const set = new Set(allowed);
  return markdown.replace(
    MARK,
    (_, kind, ids) =>
      `[[${kind}:${ids
        .split(',')
        .map((s) => s.trim())
        .filter((s) => set.has(s))
        .join(',')}]]`,
  );
}
// Compare both sides within the same source sentence so a nearby, unrelated cause cannot qualify.
const causalLink =
  /导致|造成|致使|因此|从而|所以(?:嗯)?(?:导致)?|因为|是由于|原因是|缘于|のため|によって|때문에|из-за|поэтому|привело к|\b(?:because(?: of)?|due to|led to|resulted in|therefore|caused|debido a|por eso|provocó|à cause de|entraîné|car|deshalb|wegen|verursachte)\b/iu;
const reverseLink = /因为|是由于|原因是|缘于|because|due to|debido a|à cause de|car|wegen|из-за/iu;
function supportedRelation(statement, heading, sources, marked) {
  const split = (text) => {
    const pairs = [];
    for (const link of text.matchAll(new RegExp(causalLink, 'giu'))) {
      const left = text
        .slice(0, link.index)
        .replace(/[，,\s]+$/gu, '')
        .split(/[：:。，,；;！？.!?]/u)
        .at(-1)
        .trim();
      const right = text
        .slice(link.index + link[0].length)
        .split(/[。，,；;！？.!?]/u)[0]
        .trim();
      if (!left || !right || /(?:一开始|当时|之前|之后|的时候)$/u.test(left)) continue;
      const outcome = left
        .replace(/^.{1,12}(?:指出|表示|提到|认为)[，：:]?/u, '')
        .replace(/的?(?:主要|直接|根本)$/u, '');
      if (reverseLink.test(link[0])) {
        if (outcome) pairs.push([right, outcome]);
      } else {
        pairs.push([left, right]);
      }
    }
    return pairs;
  };
  const pairs = split(statement);
  if (!pairs.length && marked) {
    const clauses = statement.replace(/[。.!\s]+$/gu, '').split(/[，,；;]/u);
    if (
      clauses.length > 1 &&
      clauses.length <= 3 &&
      sources.some((source) => /导致|造成|致使|led to|resulted in|caused/iu.test(source.text))
    )
      pairs.push(clauses.slice(-2));
    pairs.push([statement, heading]);
  }
  if (!pairs.length) return;
  const normalize = (value) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  const anchored = (phrase, speech) => {
    const target = normalize(speech);
    const tokens =
      phrase.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{N}]+/gu) || [];
    const anchors = tokens.flatMap((word) =>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)
        ? Array.from(word.matchAll(/(?=(..))/gu), (m) => m[1])
        : word.length >= 3 && !/^(the|and|for|that|was|with|this|are)$/i.test(word)
          ? [word]
          : [],
    );
    return (
      anchors.length &&
      anchors.filter((word) => target.includes(normalize(word))).length >=
        Math.min(3, Math.max(1, Math.floor(anchors.length * 0.6)))
    );
  };
  const negative =
    /并非|并不是|不是.{0,16}(?:导致|造成)|不会导致|未导致|没有导致|not (?:because|due to)|did not cause/iu;
  const uncertain =
    /可能|怀疑|猜测|是不是|是否|并非|并不是|不一定|未必|might|perhaps|possibly|not because|did not cause/iu;
  for (const source of sources) {
    for (const match of source.text.matchAll(/[^。！？.!?]+[。！？.!?]?/gu)) {
      const sentence = match[0];
      if (/[？?]$/.test(sentence) || negative.test(sentence) || negative.test(statement)) continue;
      const quoted = statement.trim() === source.text.trim();
      if (quoted && /我在想|是否|是不是|怀疑|不知道/u.test(sentence)) continue;
      const evidence = split(sentence);
      if (quoted) {
        const verified = [
          ...sentence.matchAll(
            /([^，,。！？.!?；;]{4,})[，,]?\s*(?:所以)?(?:嗯)?(?:导致|造成|致使)([^，,。！？.!?；;]{3,})/gu,
          ),
        ].find(
          (m) =>
            !/^(?:一个|这个|一些)?(?:问题|情况)[。！]?$/u.test(m[2].trim()) &&
            m[1].replace(/[嗯啊呃，,\s]/gu, '').length >= 4,
        );
        if (verified) return verified[2].trim();
        if (/\p{Script=Han}/u.test(sentence)) continue;
      }
      const pair = pairs.find((item) =>
        evidence.some((sides) => item.every((side, i) => anchored(side, sides[i]))),
      );
      if (!pair) continue;
      if (
        evidence.some(
          (sides) =>
            uncertain.test(sides.join(' ')) && pair.every((side, i) => anchored(side, sides[i])),
        ) &&
        !uncertain.test(pair.join(' '))
      )
        continue;
      if (pair[0] === pair[1]) continue;
      return pair[1].replace(/^[\s，,:：]+|[。.,，\s]+$/gu, '');
    }
  }
}
// Recover only source clauses already discussed in one uniquely matching topic.
function restoreCitedCauses(markdown, segments, headings) {
  const lines = splitLines(markdown);
  // Fenced examples are literal content, including apparent headings and source markers.
  if (lines.some((line) => /^\s*(?:`{3,}|~{3,})/u.test(line))) return markdown;
  let discussion = false;
  const topics = [];
  for (const [index, line] of lines.entries()) {
    if (/^##\s/u.test(line)) discussion = line.replace(/^##\s+|\*/gu, '').trim() === headings[2];
    if (!discussion) continue;
    if (/^###\s/u.test(line)) topics.push({ end: index + 1, text: line });
    else if (topics.length) {
      topics.at(-1).end = index + 1;
      topics.at(-1).text += '\n' + line;
    }
  }
  const added = new Set();
  const inserts = [];
  for (const match of markdown.matchAll(MARK)) {
    for (const id of match[2].split(',').map((value) => value.trim())) {
      if (!/^S[1-9]\d*$/.test(id) || added.has(id)) continue;
      added.add(id);
      const source = segments[Number(id.slice(1)) - 1];
      if (!source) continue;
      for (const clause of source.text.matchAll(
        /([^。，,！？.!?；;]{3,80})[，,]?\s*(?:所以)?(?:嗯)?(导致|造成|致使)([^。，,！？.!?；;]{3,60})/gu,
      )) {
        const quote = clause[0].trim();
        if (/[<>\[\]`*_~\\|\r\n]/u.test(quote)) continue;
        if (
          /怀疑|猜测|是不是|是否|不是|没有导致|不一定|未必/u.test(quote) ||
          /[？?]/u.test(source.text)
        )
          continue;
        const anchors = (text, part) =>
          new Set(
            Array.from(part.matchAll(/(?=([\p{Script=Han}]{2}))/gu), (m) => m[1]).filter((word) =>
              text.includes(word),
            ),
          ).size;
        const matches = topics.filter(
          (topic) => anchors(topic.text, clause[1]) >= 2 && anchors(topic.text, clause[3]) >= 2,
        );
        const citedTopics = matches.filter((topic) =>
          [...topic.text.matchAll(MARK)].some((mark) =>
            mark[2].split(',').some((label) => label.trim() === id),
          ),
        );
        const candidates = citedTopics.length ? citedTopics : matches;
        if (candidates.length !== 1) continue;
        const topic = candidates[0];
        if (
          topic.text.split('\n').some((row) => supportedRelation(row, '', [source], false)) ||
          topic.text.includes(quote) ||
          topic.text
            .split('\n')
            .some(
              (row) =>
                row.includes('[[cause:') &&
                supportedRelation(row.split('[[')[0], '', [source], true),
            ) ||
          !supportedRelation(quote, '', [source], false)
        )
          continue;
        inserts.push({ index: topic.end, line: '- ' + quote + ' [[cause:' + id + ']]' });
        break;
      }
    }
  }
  for (const item of inserts.sort((a, b) => b.index - a.index))
    lines.splice(item.index, 0, item.line);
  return lines.join('\n');
}
function parseClaims(markdown, segments, seekable = true, headings) {
  const output = [],
    claims = [],
    byLabel = new Map(segments.map((s, i) => ['S' + (i + 1), s]));
  let section = '',
    mainSection = '',
    fence = '';
  const lines = splitLines(headings ? restoreCitedCauses(markdown, segments, headings) : markdown);
  for (const [index, original] of lines.entries()) {
    const stripped = original.trim(),
      delimiter = stripped.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (stripped.startsWith(fence) && [...stripped].every((c) => c === fence[0])) fence = '';
      output.push(original);
      continue;
    }
    if (delimiter) {
      fence = delimiter[1];
      output.push(original);
      continue;
    }
    if (/^#{1,6}\s/.test(stripped)) {
      section = stripped.replace(/^[# ]+/, '').replace(/^[* ]+|[* ]+$/g, '');
      if (/^#{1,2}\s/.test(stripped)) mainSection = section;
      output.push(original);
      continue;
    }
    const table = stripped.startsWith('|'),
      next = (lines[index + 1] || '').trim();
    if (
      !/[\p{L}\p{N}]/u.test(stripped) ||
      (table && next.startsWith('|') && /^[| :\-]+$/.test(next)) ||
      ['（分段纪要过长，已截断）', '(partial summaries truncated)'].includes(stripped) ||
      /^(<!--|!\[|\[\^)/.test(stripped)
    ) {
      output.push(original);
      continue;
    }
    const marks = [...original.matchAll(MARK)];
    let cleaned = original.replace(MARK, '').trimEnd();
    let prefix = (cleaned.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/) || [''])[0],
      text = cleaned.slice(prefix.length).trim(),
      tableEnd = '';
    if (table && text.endsWith('|')) {
      prefix = cleaned.slice(0, cleaned.indexOf('|') + 1);
      text = text.replace(/^\|+|\|+$/g, '').trim();
      tableEnd = ' |';
      cleaned = prefix + ' ' + text;
      prefix += ' ';
    }
    if (!text) continue;
    const references = [
      ...new Set(
        marks.flatMap((m) => m[2].split(',').map((s) => s.trim())).filter((s) => byLabel.has(s)),
      ),
    ];
    if (
      headings &&
      !marks.length &&
      mainSection === headings[2] &&
      section !== mainSection &&
      causalLink.test(text)
    ) {
      const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu) || [text];
      for (const sentence of sentences.filter((value) => causalLink.test(value))) {
        const matches = [];
        for (const [label, segment] of byLabel) {
          if (supportedRelation(sentence, section, [segment], false)) matches.push(label);
          if (matches.length > 1) break;
        }
        if (matches.length !== 1) continue;
        if (sentences.length > 1) {
          // Cite only the supported sentence in a mixed, unmarked paragraph.
          const split = original.indexOf(sentence);
          const before = original.slice(0, split);
          const after = original.slice(split + sentence.length);
          if (before.trim() && before.trim() !== prefix.trim()) output.push(before.trimEnd());
          text = sentence.trim();
          cleaned = prefix + text;
          if (after.trim()) lines.splice(index + 1, 0, after.trim());
        }
        references.push(matches[0]);
        break;
      }
    }
    const sources = references.map((s) => snapshot(byLabel.get(s), seekable));
    const stamps = [...new Set(sources.filter((s) => s.seekable).map((s) => clock(s.start_ms)))];
    const suffix = (stamps.length ? ' 〔' + stamps.join(' · ') + '〕' : '') + tableEnd;
    let kind = marks[0]?.[1] || (table ? 'action' : 'conclusion'),
      problem = section;
    const cause = text.match(CAUSE);
    if (!headings && kind === 'conclusion' && cause && sources.some((s) => CAUSE.test(s.text))) {
      kind = 'cause';
      problem =
        text
          .slice(0, cause.index)
          .split('：')
          .at(-1)
          .replace(/^[ ：:，,。.]+|[ ：:，,。.]+$/g, '') || section;
    }
    if (headings && mainSection === headings[2] && ['cause', 'conclusion'].includes(kind)) {
      const marked = kind === 'cause' && section !== mainSection;
      const result = supportedRelation(text, section, sources, marked);
      if (result) {
        kind = 'cause';
        problem = result;
      } else {
        kind = 'conclusion';
      }
    }
    // 七章纪要只从议题讨论提取原因；模型有时会给关键数据和待确认事项也打 cause 标记。
    if (headings && kind === 'cause' && mainSection !== headings[2]) {
      kind =
        mainSection === headings[3]
          ? 'decision'
          : mainSection === headings[4]
            ? 'action'
            : 'conclusion';
    }
    if (kind === 'cause' && /^cause\s*[:：]\s*\S/i.test(text)) {
      text = text.replace(/^cause\s*[:：]\s*/i, '');
      cleaned = prefix + text;
    }
    const line = cleaned + suffix;
    claims.push({ ...claimRecord(text, kind, sources, problem), line, prefix, suffix });
    output.push(line);
  }
  return [output.join('\n'), claims];
}
function claimLineIndex(lines, claim, claims) {
  const first = lines.indexOf(claim.line);
  if (first < 0) return -1;
  const sharedCause =
    claim.kind === 'cause' &&
    claims.some(
      (other) =>
        other.kind === 'cause' && other.section !== claim.section && other.line === claim.line,
    );
  if (!sharedCause && first === lines.lastIndexOf(claim.line)) return first;
  if (claim.kind !== 'cause' || !claim.section) return -1;

  // 同一句原因可以产生不同结果。只在结果小节内有唯一命中时定位。
  let section = '';
  let fence = '';
  let match = -1;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const delimiter = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (trimmed.startsWith(fence) && [...trimmed].every((ch) => ch === fence[0])) fence = '';
      continue;
    }
    if (delimiter) {
      fence = delimiter[1];
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed))
      section = trimmed.replace(/^[# ]+/, '').replace(/^[* ]+|[* ]+$/g, '');
    if (section !== claim.section || line !== claim.line) continue;
    if (match >= 0) return -1;
    match = index;
  }
  return match;
}
function alignReplacement(claims, before, after) {
  const old = splitLines(before),
    next = splitLines(after);
  if (old.length !== next.length) return;
  for (const claim of claims) {
    const i = claimLineIndex(old, claim, claims);
    if (i < 0 || old[i] === next[i]) continue;
    const line = next[i];
    if (!line.startsWith(claim.prefix) || !line.endsWith(claim.suffix)) continue;
    const text = line
      .slice(claim.prefix.length, claim.suffix.length ? -claim.suffix.length : undefined)
      .trim();
    if (text) Object.assign(claim, { text, line, edited: text !== claim.original_text });
  }
}
function resolveClaims(claims, segments, markdown, accepted = false) {
  const key = (row) => JSON.stringify([row.track, row.start_ms, row.end_ms, row.text]);
  const indexed = new Map();
  for (const row of segments) {
    const k = key(row);
    indexed.set(k, indexed.has(k) ? null : row.id);
  }
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => (accepted ? line.replace(/^\s*(?:[-*+]|#{1,6})\s+/, '').trim() : line));
  for (const claim of claims || []) {
    claim.detached = accepted
      ? lines.filter((line) => line === claim.text).length !== 1
      : claimLineIndex(lines, claim, claims) < 0;
    for (const src of claim.sources) src.current_segment_id = indexed.get(key(src)) || null;
    const chars = claim.sources.reduce((n, s) => n + [...s.text.trim()].length, 0);
    claim.source_chars = chars;
    claim.status = !claim.sources.length
      ? 'missing'
      : claim.sources.some((s) => !s.current_segment_id)
        ? 'changed'
        : chars < 20
          ? 'thin'
          : 'supported';
  }
  return claims;
}
function latestSegments(segments) {
  const refined = segments.filter(
    (s) => s.version.startsWith('postprocess') && String(s.text || '').trim(),
  );
  const revision = refined.length
    ? refined.reduce((maximum, s) => Math.max(maximum, s.revision), -Infinity)
    : null;
  let base =
    revision !== null
      ? refined.filter((s) => s.revision === revision)
      : segments.filter((s) => s.version === 'live' && String(s.text || '').trim());
  if (!base.length && segments.every((s) => s.version === 'user'))
    base = segments.filter((s) => String(s.text || '').trim());
  const current = new Map(base.map((s) => [s.id, s]));
  for (const item of segments)
    if (item.version === 'user' && current.has(item.id)) current.set(item.id, item);
  return [...current.values()].sort((a, b) => a.start_ms - b.start_ms);
}
function normalizeSummaryMarkdown(markdown) {
  const text = String(markdown || '');
  const protectedPattern =
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[ \t]*(?=\n|$)|(?![\s\S]))|(`+)[^`]*?\2|!?\[[^\]\n]*\]\([^\)\n]*\)/gm;
  const pieces = [];
  let offset = 0;
  for (const match of text.matchAll(protectedPattern)) {
    pieces.push([false, text.slice(offset, match.index)], [true, match[0]]);
    offset = match.index + match[0].length;
  }
  pieces.push([false, text.slice(offset)]);
  const heading = /(?<=[^\s#\\])([ \t]*)(#{1,6}[ \t]+\*\*[^\n*]+\*\*)/g;
  if (!pieces.some(([keep, part]) => !keep && new RegExp(heading).test(part))) return text;
  return pieces
    .map(([keep, part]) =>
      keep
        ? part
        : part
            .replace(heading, '\n\n$2')
            .split('\n')
            .map((line) =>
              /^[ \t]*[-*][ \t]+/.test(line)
                ? line.replace(/(?<=[。！？；.!?;])[ \t]*([-*][ \t]+)(?=\S)/g, '\n$1')
                : line,
            )
            .join('\n'),
    )
    .join('');
}
module.exports = {
  TEMPLATES,
  SUMMARY_HEADINGS,
  clock,
  confirmedDate,
  annotateDates,
  evidenceInstructions,
  snapshot,
  claimRecord,
  restrictSources,
  parseClaims,
  claimLineIndex,
  alignReplacement,
  resolveClaims,
  latestSegments,
  normalizeSummaryMarkdown,
};
