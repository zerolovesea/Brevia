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
function parseClaims(markdown, segments, seekable = true, headings) {
  const output = [],
    claims = [],
    byLabel = new Map(segments.map((s, i) => ['S' + (i + 1), s]));
  let section = '',
    mainSection = '',
    fence = '';
  const lines = splitLines(markdown);
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
    const sources = references.map((s) => snapshot(byLabel.get(s), seekable));
    const stamps = [...new Set(sources.filter((s) => s.seekable).map((s) => clock(s.start_ms)))];
    const suffix = (stamps.length ? ' 〔' + stamps.join(' · ') + '〕' : '') + tableEnd;
    let kind = marks[0]?.[1] || (table ? 'action' : 'conclusion'),
      problem = section;
    const cause = text.match(CAUSE);
    if (kind === 'conclusion' && cause && sources.some((s) => CAUSE.test(s.text))) {
      kind = 'cause';
      problem =
        text
          .slice(0, cause.index)
          .split('：')
          .at(-1)
          .replace(/^[ ：:，,。.]+|[ ：:，,。.]+$/g, '') || section;
    }
    if (headings && kind === 'cause') problem = section;
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
function alignReplacement(claims, before, after) {
  const old = splitLines(before),
    next = splitLines(after);
  if (old.length !== next.length) return;
  for (const claim of claims) {
    const i = old.indexOf(claim.line);
    if (i < 0 || old.lastIndexOf(claim.line) !== i || old[i] === next[i]) continue;
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
    claim.detached =
      lines.filter((line) => line === (accepted ? claim.text : claim.line)).length !== 1;
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
  alignReplacement,
  resolveClaims,
  latestSegments,
  normalizeSummaryMarkdown,
};
