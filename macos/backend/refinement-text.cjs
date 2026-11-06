const { splitSentences, timeAt } = require('./subtitles.cjs');
const normalizedText = (text) =>
  String(text || '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
const numberDigits = Object.fromEntries(
  Array.from('零〇一二两三四五六七八九').map((x, i) => [
    x,
    [0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9][i],
  ]),
);
function cnInteger(text) {
  if (!text || !/[零〇一二两三四五六七八九十百千]/.test(text)) return null;
  if (Array.from(text).every((c) => c in numberDigits))
    return Number(Array.from(text, (c) => numberDigits[c]).join(''));
  let total = 0,
    section = 0,
    number = 0;
  for (const c of text) {
    if (c in numberDigits) number = numberDigits[c];
    else if ('十百千'.includes(c)) {
      section += (number || 1) * { '十': 10, '百': 100, '千': 1000 }[c];
      number = 0;
    } else if ('万亿'.includes(c)) {
      section = (section + number) * { '万': 10000, '亿': 100000000 }[c];
      total += section;
      section = number = 0;
    } else return null;
  }
  return total + section + number;
}
function cnDisplay(text) {
  const unit = /[万亿]$/.test(text) ? text.at(-1) : '',
    body = unit ? text.slice(0, -1) : text;
  if (unit && /[万亿]/.test(body)) return null;
  let number;
  if (body.includes('点')) {
    const [whole, fraction] = body.split('点');
    number = whole ? cnInteger(whole) : 0;
    if (number === null || !Array.from(fraction).every((c) => c in numberDigits)) return null;
    number += Number('0.' + Array.from(fraction, (c) => numberDigits[c]).join(''));
  } else number = cnInteger(body);
  return number === null ? null : String(number) + unit;
}
function normalizeNumbers(text) {
  return text
    .replace(/([零〇一二两三四五六七八九十百千万亿点]+)([岁年月日号元块角毛])/g, (all, n, u) =>
      cnDisplay(n) === null ? all : cnDisplay(n) + u,
    )
    .replace(
      /([零〇一二两三四五六七八九十百千]+)([多余来])([万亿])([岁年月日号元块角毛])?/g,
      (_, n, a, b, c) => (cnDisplay(n) || n) + a + b + (c || ''),
    )
    .replace(
      /百分之([零〇一二两三四五六七八九十百千万亿点]+)/g,
      (_, n) => (cnDisplay(n) || n) + '%',
    )
    .replace(
      /([零〇一二两三四五六七八九十百千万亿]+点[零〇一二三四五六七八九]+)/g,
      (_, n) => cnDisplay(n) || n,
    );
}
// 与 difflib 的递归最长公共子串匹配一致；只处理已被音频窗口限制的文本。
function matchingRatio(a, b) {
  if (!a.length && !b.length) return 1;
  const stack = [[0, a.length, 0, b.length]];
  let matched = 0;
  while (stack.length) {
    const [a0, a1, b0, b1] = stack.pop();
    let best = 0,
      ai = a0,
      bi = b0,
      previous = new Uint32Array(b1 - b0 + 1);
    for (let i = a0; i < a1; i++) {
      const next = new Uint32Array(b1 - b0 + 1);
      for (let j = b0; j < b1; j++)
        if (a[i] === b[j]) {
          next[j - b0 + 1] = previous[j - b0] + 1;
          if (next[j - b0 + 1] > best) {
            best = next[j - b0 + 1];
            ai = i - best + 1;
            bi = j - best + 1;
          }
        }
      previous = next;
    }
    if (best) {
      matched += best;
      if (a0 < ai && b0 < bi) stack.push([a0, ai, b0, bi]);
      if (ai + best < a1 && bi + best < b1) stack.push([ai + best, a1, bi + best, b1]);
    }
  }
  return (2 * matched) / (a.length + b.length);
}
function trimOverlap(previous, text) {
  if (!previous || !text) return [text, false];
  const a = normalizedText(previous),
    b = normalizedText(text);
  if (!a || !b) return [text, false];
  if (matchingRatio(a, b) >= 0.92) return ['', false];
  const max = Math.min(a.length, b.length, 200);
  let best = 0,
    offset = 0;
  for (let prefix = 0; prefix < Math.min(4, b.length) && !best; prefix++)
    for (let n = Math.min(max, b.length - prefix); n >= 4; n--)
      if (a.slice(-n) === b.slice(prefix, prefix + n)) {
        best = n;
        offset = prefix;
        break;
      }
  if (!best)
    for (let n = max; n >= 4; n--)
      if (matchingRatio(a.slice(-n), b.slice(0, n)) >= 0.9) {
        best = n;
        break;
      }
  if (!best) return [text, false];
  let count = 0;
  for (let i = 0; i < text.length; i++)
    if (/[\p{L}\p{N}]/u.test(text[i]) && ++count >= offset + best)
      return [text.slice(i + 1).replace(/^[ \t,.;:!?，。；：！？]+/, ''), true];
  return [text, false];
}
function isFragment(a, b) {
  a = normalizedText(a);
  b = normalizedText(b);
  if (!a || !b) return false;
  let common = 0;
  while (common < Math.min(a.length, b.length) && a[common] === b[common]) common++;
  return (
    common >= 4 &&
    a.length > common &&
    a.length - common <= Math.max(1, Math.floor(a.length / 5)) &&
    (a.length - common) / a.length <= 0.2
  );
}
function numberishCore(text) {
  const core = text
    .replace(/^[ \t。！？.!?；;，,、]+|[ \t。！？.!?；;，,、]+$/g, '')
    .replace(/[元亿元万块角毛分个点]+$/, '');
  return core && core.length <= 4 && /^[\d零〇一二两三四五六七八九十百千万亿点]+$/.test(core)
    ? core
    : null;
}
function numberRephrase(previous, current) {
  const prefix = current.match(/^[\u4e00-\u9fff]+/)?.[0] || '';
  for (let n = Math.min(prefix.length, 10); n >= 4; n--) {
    const piece = prefix.slice(0, n),
      at = previous.lastIndexOf(piece);
    if (at >= 0 && numberishCore(previous.slice(at + n)))
      return (previous.slice(0, at + n) + current.slice(n)).trim();
  }
  const match = current.match(/([\u4e00-\u9fff]{1,4})(\d+(?:\.\d+)?)/);
  if (match)
    for (let n = match[1].length; n > 0; n--) {
      const piece = match[1].slice(-n),
        at = previous.lastIndexOf(piece),
        tail = at >= 0 ? previous.slice(at + n) : '';
      if (/^[零〇一二两三四五六七八九十百千万亿点]+[。！？.!?；;]*$/.test(tail))
        return previous.slice(0, at) + current.slice(match.index);
    }
  return null;
}
function joinUtterance(a, b) {
  a = a.trim();
  b = b.trim();
  if (!a || !b) return a + b;
  return (
    a +
    (/[。！？.!?；;]$/.test(a) || (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)) ? ' ' : '') +
    b
  );
}
function joinPair(a, b, continuation = false) {
  a = a.trim();
  b = b.trim();
  if (!a || !b) return a + b;
  if (continuation && /[。！？.!?；;]$/.test(a)) return a.replace(/[。！？.!?；; ]+$/, '') + b;
  const rephrased = numberRephrase(a, b);
  if (rephrased !== null) return rephrased;
  const prev = splitSentences(a),
    next = splitSentences(b),
    tail = prev.at(-1)?.trim(),
    head = next[0]?.trim();
  if (tail && head) {
    if (isFragment(tail, b) || isFragment(tail, head))
      return joinUtterance(prev.slice(0, -1).join(''), b);
    if (isFragment(head, a) || isFragment(head, tail))
      return joinUtterance(a, next.slice(1).join(''));
  }
  if (isFragment(a, b)) return b;
  if (isFragment(b, a)) return a;
  return joinUtterance(a, b);
}
function trimRepeats(text) {
  const result = [];
  let previous = '';
  for (const chunk of splitSentences(text)) {
    let sentence = chunk.trimStart(),
      a = normalizedText(previous),
      b = normalizedText(sentence),
      overlap = 0;
    if (a && b && a[0] !== b[0])
      for (let offset = 1; offset < Math.min(4, b.length) && !overlap; offset++)
        for (let n = Math.min(a.length, b.length - offset); n >= 4; n--)
          if (a.slice(-n) === b.slice(offset, offset + n)) {
            overlap = offset + n;
            break;
          }
    if (overlap) {
      let count = 0;
      for (let i = 0; i < sentence.length; i++)
        if (/[\p{L}\p{N}]/u.test(sentence[i]) && ++count === overlap) {
          sentence = sentence.slice(i + 1).trimStart();
          break;
        }
      previous = joinUtterance(previous.replace(/[。！？.!?；; ]+$/, ''), sentence);
      result[result.length - 1] = previous;
      continue;
    }
    const rephrased = numberRephrase(previous, sentence);
    if (rephrased !== null) {
      previous = rephrased;
      result[result.length - 1] = previous;
      continue;
    }
    if (isFragment(previous, sentence)) {
      result[result.length - 1] = sentence;
      previous = sentence;
      continue;
    }
    if (isFragment(sentence, previous)) continue;
    result.push(chunk);
    previous = sentence;
  }
  return result.join('');
}
function assembleUtterances(segments, maximumMs) {
  const result = [];
  for (const event of segments) {
    const previous = result.at(-1);
    if (
      !previous ||
      previous.track !== event.track ||
      previous.speaker !== event.speaker ||
      event.start_ms - previous.end_ms > 1500
    ) {
      result.push({ ...event, word_timestamps: [...(event.word_timestamps || [])] });
      continue;
    }
    if (event.end_ms - previous.start_ms <= maximumMs) {
      previous.text = joinPair(previous.text, event.text, event.continues_previous);
      previous.end_ms = Math.max(previous.end_ms, event.end_ms);
      previous.word_timestamps.push(...(event.word_timestamps || []));
      continue;
    }
    const parts = splitSentences(previous.text),
      last = parts.at(-1);
    if (parts.length < 2 || !last.trim()) {
      result.push({ ...event, word_timestamps: [...(event.word_timestamps || [])] });
      continue;
    }
    const head = parts.slice(0, -1).join('').trim(),
      tail = last.trim(),
      cut = timeAt(
        previous,
        previous.text,
        [...previous.text.slice(0, previous.text.length - last.length)].length,
      ),
      words = previous.word_timestamps;
    result[result.length - 1] = {
      ...previous,
      text: head,
      end_ms: cut,
      word_timestamps: words.filter((w) => w.start_ms < cut),
    };
    result.push({
      ...event,
      text: joinPair(tail, event.text, event.continues_previous),
      start_ms: cut,
      word_timestamps: [
        ...words.filter((w) => w.start_ms >= cut),
        ...(event.word_timestamps || []),
      ],
    });
  }
  return result;
}
module.exports = {
  normalizeNumbers,
  normalizedText,
  trimOverlap,
  trimRepeats,
  assembleUtterances,
  matchingRatio,
  joinPair,
};
