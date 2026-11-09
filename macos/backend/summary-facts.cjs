// 保守估算：英文按约两个 ASCII 字符一个 token，其他文字按 UTF-8 字节预算。
function estimatedTokens(text) {
  let halfTokens = 0;
  for (const ch of text) halfTokens += ch.codePointAt(0) < 128 ? 1 : 2 * Buffer.byteLength(ch);
  return Math.ceil(halfTokens / 2);
}

function splitByBudget(text, budget, preserveSources = false) {
  if (budget < 128) throw new Error('Summary prompt exceeds the available model context');
  const chunks = [];
  let lines = [],
    used = 0;
  const flush = () => {
    if (lines.length) chunks.push(lines.join('\n'));
    lines = [];
    used = 0;
  };
  for (const line of text.split('\n')) {
    const size = estimatedTokens(line) + 1;
    if (used + size > budget) flush();
    if (size <= budget) {
      lines.push(line);
      used += size;
      continue;
    }
    const prefix = /^S\d+ \[[\d:]+\] /.exec(line)?.[0] || '';
    // 归并输入是一行一条事实。超长事实拆开后，每个片段仍须携带同一组来源。
    const marks = preserveSources
      ? [...line.matchAll(/\[\[(?:conclusion|decision|action|cause):[^\]\n]*\]\]/g)]
      : [];
    const suffix = marks.length ? ' ' + marks.map((m) => m[0]).join(' ') : '';
    const body = suffix
      ? line.replace(/\[\[(?:conclusion|decision|action|cause):[^\]\n]*\]\]/g, '').trimEnd()
      : line;
    const initial = estimatedTokens(prefix + suffix) * 2;
    if (initial + 8 > budget * 2)
      throw new Error('Fact references exceed the summary context budget');
    let part = prefix,
      cost = initial;
    for (const ch of body.slice(prefix.length)) {
      const n = ch.codePointAt(0) < 128 ? 1 : 2 * Buffer.byteLength(ch);
      if (cost + n > budget * 2) {
        chunks.push(part + suffix);
        part = prefix;
        cost = initial;
      }
      part += ch;
      cost += n;
    }
    chunks.push(part + suffix);
  }
  flush();
  return chunks;
}

// 限于模型已经引用的字幕，不以内容相似为由跨段移动时间戳。
function verifyFactSources(markdown, segments) {
  const plain = (text) =>
    text
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}%+.-]+/gu, '')
      .replace(/[.]+$/, '');
  const causal =
    /因为|由于|导致|致使|造成|归因|原因|缘于|所以|从而|不足|缺少|缺乏|过高|过低|太短|只有|why|because|due to|result|caus|lack|insufficient|reason|therefore|deshalb|wegen|carence|raison|manque|motivo|debido|falta|ため|ので|要因|不足|때문|원인|부족|причин|из-за/iu;
  return markdown
    .split('\n')
    .map((line) => {
      const fact = line
        .split('[[')[0]
        .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
        .trim();
      return line.replace(
        /\[\[(cause|conclusion|decision|action):([^\]]*)\]\]/g,
        (_, kind, references) => {
          let ids = references
            .split(',')
            .map((v) => v.trim())
            .filter((id) => /^S[1-9]\d*$/.test(id) && segments[Number(id.slice(1)) - 1]);
          const quote = (id) => segments[Number(id.slice(1)) - 1].text;
          const exact = ids.filter(
            (id) => plain(fact).length >= 4 && plain(quote(id)).includes(plain(fact)),
          );
          if (exact.length && !causal.test(fact)) ids = exact;
          if (
            kind === 'cause' &&
            /\d/.test(fact) &&
            !causal.test(fact) &&
            ids.length &&
            ids.every((id) => !causal.test(quote(id)))
          )
            kind = 'conclusion';
          return '[[' + kind + ':' + ids.join(',') + ']]';
        },
      );
    })
    .join('\n');
}
const emptySummaryLine =
  /^(?:[-*]\s*)?(?:[—–-]|未(?:明确)?(?:提及|讨论)(?:行动项|待办事项|关键数据|决定)?|无|未讨论|暂无|无相关内容|not discussed|not mentioned|none|no (?:action items|decisions|figures) (?:were mentioned|were discussed)|言及なし|該当なし|언급 없음|no se mencionó|non mentionné|nicht erwähnt|не упоминалось|n\/a)[.。]?$/i;

// 用首轮提取的事实核对成稿；只补有原文来源、但在目标章节缺少对应引用或数字的事项。
function coverFacts(markdown, summaries, headings, segments) {
  const sections = markdown.split(/(?=^##\s)/m);
  const headingIndex = (section) =>
    headings.indexOf(
      section
        .split('\n')[0]
        .replace(/^##\s+/, '')
        .replaceAll('**', '')
        .trim(),
    );
  const normalize = (text) =>
    text
      .toLocaleLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}%]+/gu, '');
  const numbersIn = (text) => text.normalize('NFKC').match(/[-+]?\d+(?:[.,]\d+)*(?:%|‰)?/g) || [];
  const seen = new Set();
  for (const line of summaries.join('\n').split('\n')) {
    const mark = /\[\[(action|decision|conclusion):((?:S[1-9]\d*)(?:\s*,\s*S[1-9]\d*)*)\]\]/.exec(
      line,
    );
    if (!mark) continue;
    const labels = [...new Set(mark[2].split(',').map((v) => v.trim()))];
    const quotes = labels.map((id) => segments[Number(id.slice(1)) - 1]?.text || '');
    const fact = line
      .slice(0, mark.index)
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
      .trim();
    const numbers = numbersIn(fact);
    if (
      !fact ||
      quotes.some((q) => !q) ||
      numbers.some((n) => !quotes.some((q) => numbersIn(q).includes(n)))
    )
      continue;
    const target = mark[1] === 'action' ? 4 : mark[1] === 'decision' ? 3 : numbers.length ? 6 : -1;
    if (target < 0) continue;
    const idx = sections.findIndex((s) => headingIndex(s) === target);
    if (idx < 0) continue;
    const key = JSON.stringify([target, labels, normalize(fact)]);
    if (seen.has(key)) continue;
    seen.add(key);
    const covered = sections[idx].split('\n').some((row) => {
      const ids = [...row.matchAll(/\[\[\w+:([^\]]+)\]\]/g)].flatMap((m) =>
        m[1].split(',').map((v) => v.trim()),
      );
      const text = normalize(row.split('[[')[0]);
      return (
        (labels.every((id) => ids.includes(id)) ||
          ids.some((id) =>
            normalize(segments[Number(id.slice(1)) - 1]?.text || '').includes(normalize(fact)),
          )) &&
        numbers.every((n) => numbersIn(row.split('[[')[0]).includes(n)) &&
        (text.includes(normalize(fact)) || quotes.every((q) => text.includes(normalize(q))))
      );
    });
    if (covered) continue;
    // 自动补写仅使用可在原话中逐字找到的事实，不把模型推断升级为决定。
    if (
      !quotes.some((q) =>
        q
          .split(/(?<=[。！？!?；;])|(?<=\.)\s+/u)
          .some(
            (sentence) =>
              normalize(sentence) === normalize(fact) &&
              numbersIn(sentence).join('|') === numbers.join('|'),
          ),
      )
    )
      continue;
    const body = sections[idx].trimEnd().split('\n');
    if (body.slice(1).every((l) => !l.trim() || emptySummaryLine.test(l.trim()))) body.length = 1;
    sections[idx] = body.join('\n') + '\n- ' + fact + ' ' + mark[0] + '\n\n';
  }
  return sections.join('').trim();
}
module.exports = {
  estimatedTokens,
  splitByBudget,
  coverFacts,
  verifyFactSources,
  emptySummaryLine,
};
