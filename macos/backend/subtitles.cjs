function splitSentences(text) {
  const output = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (
      '。！？!?；;'.includes(text[i]) ||
      (text[i] === '.' && !(/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')))
    ) {
      output.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) output.push(text.slice(start));
  return output;
}
function cleanText(input) {
  let text = String(input || '')
    .split(/<asr_text>/i)
    .at(-1)
    .split(/<\|endoftext\|>/i)[0]
    .replace(/<\|[^|>]+\|>/g, ' ')
    .replaceAll('\ufffd', '')
    .replace(/```[^\n]*/g, '')
    .replace(/`\([^)]*\)`?/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/language\s*=?\s*[A-Za-z]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，。！？、；：,.!?;:…]+/, '')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  text = text.replace(/([\u4e00-\u9fff]{1,4}?)\1{7,}/g, '$1');
  const words = [...text.matchAll(/[\p{L}\p{N}_']+/gu)];
  for (let width = 1; width <= Math.min(6, Math.floor(words.length / 4)); width++) {
    const tail = words
      .slice(-width)
      .map((m) => m[0].toLowerCase())
      .join('\0');
    let cursor = words.length,
      repeats = 0;
    while (
      cursor >= width &&
      words
        .slice(cursor - width, cursor)
        .map((m) => m[0].toLowerCase())
        .join('\0') === tail
    ) {
      cursor -= width;
      repeats++;
    }
    if (repeats >= 4) {
      const last = words[cursor + width - 1];
      return text.slice(0, last.index + last[0].length).replace(/[ ,;，、]+$/, '');
    }
  }
  let previous;
  do {
    previous = text;
    text = text.replace(/(.{8,80}?)\1{2,}/g, '$1');
  } while (text !== previous);
  const sentenceCase = (value) => {
    const prefix = value.match(/^\s*/)[0],
      body = value.trimStart().toLowerCase();
    return (prefix + body.charAt(0).toUpperCase() + body.slice(1)).replace(
      /\b(?:ai|api|asr|cpu|fbi|gpu|html|http|https|llm|nasa|ny|url|ii)\b/gi,
      (word) => word.toUpperCase(),
    );
  };
  text = text.replace(/(?:\b[A-Z][A-Z'’-]*\b(?:[ \t,;:]+|(?=[.!?]|$))){3,}/g, sentenceCase);
  const letters = (text.match(/[A-Za-z]/g) || []).join('');
  if (letters.length >= 4 && letters === letters.toUpperCase())
    text = text.replace(/[^.!?]+/g, sentenceCase);
  return require('./refinement-text.cjs').normalizeNumbers(text);
}
function lengthLimits(text) {
  const cjk = (
    text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) || []
  ).length;
  return cjk > 0 && cjk * 3 >= (text.match(/[A-Za-z]/g) || []).length
    ? [60, 110, 150]
    : [150, 280, 380];
}
function unfinished(text) {
  return /(?:是|的|把|被|与|及|从|例如|比如|包括|在于|落在了|以外)[。.]?$/.test(text);
}
function joinText(left, right) {
  return left &&
    right &&
    !/\s$/.test(left) &&
    !/^\s/.test(right) &&
    /[\x00-\x7f]$/.test(left) &&
    /^[A-Za-z0-9]/.test(right)
    ? left + ' ' + right
    : left + right;
}
const charLength = (text) => [...text].length;
const charSlice = (text, start, end) => [...text].slice(start, end).join('');
const roundEven = (number) => {
  const floor = Math.floor(number),
    fraction = number - floor;
  return fraction === 0.5 ? floor + (floor % 2) : Math.round(number);
};
function charFind(text, token, from = 0) {
  const index = text.indexOf(token, charSlice(text, 0, from).length);
  return index < 0 ? -1 : charLength(text.slice(0, index));
}
function timelineAnchors(event, text) {
  const start = event.start_ms,
    end = event.end_ms,
    words = event.word_timestamps || [],
    letters = (value) => [...value].filter((char) => /[\p{L}\p{N}]/u.test(char)).join('');
  if (letters(words.map((word) => String(word.text || '')).join('')) !== letters(text))
    return [
      [0, start],
      [charLength(text), end],
    ];
  const anchors = [[0, start]];
  let cursor = 0,
    previous = start;
  for (const word of words) {
    const token = String(word.text || '').trim();
    if (!token) continue;
    const index = charFind(text, token, cursor);
    if (index < 0 || typeof word.start_ms !== 'number' || !Number.isFinite(word.start_ms)) continue;
    const time = Math.min(Math.max(Math.trunc(word.start_ms), start), end);
    if (time < previous) continue;
    anchors.push([index, time]);
    previous = time;
    cursor = index + charLength(token);
  }
  anchors.push([Math.max(charLength(text), cursor), end]);
  return anchors;
}
function timeAt(event, text, offset) {
  const length = charLength(text),
    start = event.start_ms,
    end = event.end_ms;
  if (!length || end <= start) return start;
  offset = Math.max(0, Math.min(length, offset));
  const anchors = timelineAnchors(event, text);
  for (let index = 0; index < anchors.length - 1; index++) {
    const left = anchors[index],
      right = anchors[index + 1];
    if (offset <= right[0]) {
      const span = right[0] - left[0];
      return span <= 0
        ? right[1]
        : left[1] + roundEven(((right[1] - left[1]) * (offset - left[0])) / span);
    }
  }
  return end;
}
function partTimes(event, source, parts) {
  const start = event.start_ms,
    end = event.end_ms,
    total = parts.reduce((sum, part) => sum + charLength(part), 0),
    offsets = [];
  let cursor = 0,
    located = true;
  for (const part of parts.slice(0, -1)) {
    const index = charFind(source, part, cursor);
    if (index < 0) {
      located = false;
      break;
    }
    cursor = index + charLength(part);
    offsets.push(cursor);
  }
  if (located && offsets.length && event.word_timestamps?.length) {
    const times = [start];
    let previous = start;
    for (const offset of offsets) {
      previous = Math.max(previous, Math.min(timeAt(event, source, offset), end));
      times.push(previous);
    }
    return [...times, end];
  }
  const times = [start];
  let consumed = 0;
  for (const part of parts.slice(0, -1)) {
    consumed += charLength(part);
    times.push(total ? start + roundEven(((end - start) * consumed) / total) : start);
  }
  return [...times, end];
}
function sentenceSubtitles(event, text, mergeUnfinished = true) {
  const [minimum, target, limit] = lengthLimits(text),
    sentences = [];
  for (const sentence of splitSentences(text)) {
    if (mergeUnfinished && sentences.length && unfinished(sentences.at(-1)))
      sentences[sentences.length - 1] = sentences.at(-1).replace(/[。.]+$/, '') + sentence.trim();
    else sentences.push(sentence);
  }
  let remaining = sentences.join('').trim();
  const parts = [];
  while (charLength(remaining) > limit) {
    const upper = Math.min(limit, charLength(remaining) - minimum),
      boundaries = [];
    let offset = 0;
    for (const sentence of splitSentences(remaining)) {
      offset += charLength(sentence);
      if (minimum <= offset && offset <= upper) boundaries.push(offset);
    }
    if (!boundaries.length)
      for (const match of charSlice(remaining, 0, upper).matchAll(
        /[，、：:;；]|(?<!\d),(?!\d)|\s+/g,
      )) {
        const end = charLength(remaining.slice(0, match.index + match[0].length));
        if (minimum <= end && end <= upper) boundaries.push(end);
      }
    let cut = boundaries.length
      ? boundaries.reduce((best, next) =>
          Math.abs(next - target) < Math.abs(best - target) ? next : best,
        )
      : Math.min(target, upper);
    if (!boundaries.length && /^[A-Za-z0-9]$/.test(charSlice(remaining, cut - 1, cut)))
      while (
        cut < charLength(remaining) &&
        /^[A-Za-z0-9]$/.test(charSlice(remaining, cut, cut + 1))
      )
        cut++;
    parts.push(charSlice(remaining, 0, cut).trim());
    remaining = charSlice(remaining, cut).trim();
  }
  if (remaining) parts.push(remaining);
  const times = partTimes(event, text, parts);
  return parts.map((part, index) => ({
    ...event,
    segment_id: index ? event.segment_id + '-s' + index : event.segment_id,
    start_ms: times[index],
    end_ms: times[index + 1],
    text: part,
  }));
}
function attachLeadingClosers(sentences) {
  const merged = [];
  for (let sentence of sentences) {
    let head = '';
    while (sentence && '”’」』）】〉»'.includes(sentence[0]) && merged.length) {
      head += sentence[0];
      sentence = sentence.slice(1);
    }
    if (head) merged[merged.length - 1] += head;
    if (sentence) merged.push(sentence);
  }
  return merged;
}
function dedupeSeam(previous, current, window = 0) {
  if (window <= 0) return current;
  const head = current.replace(/^[，,、 ]+/, ''),
    tail = previous.replace(/[。！？.!?；;，,、 ]+$/, '');
  for (let length = Math.min(charLength(tail), charLength(head), window); length > 0; length--)
    if (charSlice(tail, -length) === charSlice(head, 0, length) && charLength(head) > length)
      return charSlice(head, length);
  return current;
}
function anchorSplice(previous, current, overlap = 0) {
  const window = Math.min(charLength(previous), charLength(current), overlap);
  if (window < 2) return null;
  const tail = [...charSlice(previous, -window).replace(/[。！？.!?；;，,、 ]+$/, '')],
    head = [...charSlice(current, 0, window)];
  if (tail.length < 2 || head.length < 2) return null;
  // 与 SequenceMatcher 的最长公共子串及同长时最早起点规则一致。
  let best = { a: 0, b: 0, size: 0 };
  for (let a = 0; a < tail.length; a++)
    for (let b = 0; b < head.length; b++) {
      let size = 0;
      while (a + size < tail.length && b + size < head.length && tail[a + size] === head[b + size])
        size++;
      if (size > best.size) best = { a, b, size };
    }
  if (
    !best.size ||
    best.a + best.size < tail.length - 1 ||
    best.b > 1 ||
    !/[\p{L}\p{N}]/u.test(tail.slice(best.a, best.a + best.size).join(''))
  )
    return null;
  return (
    charSlice(previous, 0, charLength(previous) - window + best.a) + charSlice(current, best.b)
  );
}
function joinPending(previous, current, style, overlap = 0) {
  previous = (previous || '').trim();
  current = (current || '').trim();
  if (!previous) return current;
  if (!current) return previous;
  const window = overlap > 0 ? overlap : style === 'comma' ? 0 : 2,
    deduped = dedupeSeam(previous, current, window);
  if (deduped !== current || unfinished(previous)) return previous.replace(/[。.]+$/, '') + deduped;
  const spliced = anchorSplice(previous, current, window);
  if (spliced) return spliced;
  if (style !== 'comma') return null;
  const head = previous.replace(/[。！？.!?；;，,、 ]+$/, ''),
    tail = current.replace(/^[，,、 ]+/, '');
  return head && tail ? head + '，' + tail : head + tail;
}
class LiveSubtitles {
  constructor(publish, { overlapMs = 400 } = {}) {
    this.onSubtitle = publish;
    this.overlapMs = overlapMs;
    this.paragraphs = new Map();
    this.tails = new Map();
    this.joinStyles = new Map();
    this.voiceSpans = new Map();
  }
  publish(event) {
    const spans = (this.voiceSpans.get(event.track) || []).filter(
      (span) => span.end > event.start_ms && span.start < event.end_ms,
    );
    // 字幕可能在一次发声中间断句。只有完整覆盖的原始 VAD 区间才可用于归属。
    const supported = spans.every(
      (span) => !span.unknown && span.start >= event.start_ms && span.end <= event.end_ms,
    );
    this.onSubtitle(event, supported ? spans : []);
  }
  pruneVoiceSpans(track) {
    const from = Math.min(
      this.paragraphs.get(track)?.start_ms ?? Infinity,
      this.tails.get(track)?.start_ms ?? Infinity,
    );
    const retained = this.voiceSpans.get(track)?.filter((span) => span.end > from);
    if (retained?.length) this.voiceSpans.set(track, retained);
    else this.voiceSpans.delete(track);
  }
  push(event, text, voiceSpans) {
    const track = event.track,
      sentences = attachLeadingClosers(splitSentences(text).filter((sentence) => sentence.trim()));
    if (!sentences.length) return;
    if (voiceSpans) {
      const spans = this.voiceSpans.get(track) || [];
      if (voiceSpans.length) spans.push(...voiceSpans);
      else spans.push({ start: event.start_ms, end: event.end_ms, unknown: true });
      this.voiceSpans.set(track, spans);
    }
    const pending = this.tails.get(track);
    this.tails.delete(track);
    const total = sentences.reduce((sum, sentence) => sum + charLength(sentence), 0) || 1,
      duration = event.end_ms - event.start_ms,
      windows = [];
    let offset = 0;
    for (const sentence of sentences) {
      const start = event.start_ms + roundEven((duration * offset) / total);
      offset += charLength(sentence);
      windows.push([start, event.start_ms + roundEven((duration * offset) / total), sentence]);
    }
    const limit = lengthLimits(text)[2],
      pieces = [],
      style = this.joinStyles.get(track);
    let bodyFrom = windows[0][0];
    this.joinStyles.delete(track);
    if (pending) {
      const gap = windows[0][0] - pending.end_ms,
        overlap =
          gap < 0 && duration > 0
            ? Math.max(2, Math.min(8, roundEven((-gap * charLength(text)) / duration)))
            : 0;
      const joined = joinPending(pending.text, windows[0][2], style, overlap);
      if (joined && -this.overlapMs <= gap && gap <= 700 && charLength(joined) <= limit) {
        pieces.push({ ...pending, text: joined, end_ms: windows[0][1] });
        windows.shift();
        bodyFrom = windows.length ? windows[0][0] : event.end_ms;
      } else pieces.push(pending);
    }
    let tail = null,
      bodyUntil = event.end_ms;
    if (
      windows.length &&
      (['pause', 'cut'].includes(event.boundary) || unfinished(windows.at(-1)[2]))
    ) {
      const [start, , tailText] = windows.pop();
      tail = {
        ...event,
        segment_id: event.segment_id + '-tail',
        start_ms: start,
        end_ms: event.end_ms,
        text: tailText,
      };
      bodyUntil = start;
    }
    if (windows.length)
      pieces.push(
        ...sentenceSubtitles(
          { ...event, start_ms: bodyFrom, end_ms: bodyUntil },
          windows.map((window) => window[2]).join(''),
        ),
      );
    if (tail) {
      this.tails.set(track, tail);
      this.joinStyles.set(track, event.boundary === 'pause' ? 'comma' : null);
    }
    this.coalesce(track, pieces);
    this.pruneVoiceSpans(track);
  }
  coalesce(track, pieces) {
    const touched = performance.now();
    let paragraph = this.paragraphs.get(track);
    this.paragraphs.delete(track);
    for (const piece of pieces) {
      if (!paragraph) {
        paragraph = { ...piece, touched_at: touched };
        continue;
      }
      const held = charLength(paragraph.text),
        [minimum, target, limit] = lengthLimits(paragraph.text + piece.text);
      if (
        piece.start_ms - paragraph.end_ms < 1200 &&
        held < target &&
        (held + charLength(piece.text) <= limit || held < minimum)
      )
        paragraph = {
          ...paragraph,
          text: joinText(paragraph.text, piece.text),
          end_ms: piece.end_ms,
          touched_at: performance.now(),
        };
      else {
        this.publish(paragraph);
        paragraph = { ...piece, touched_at: touched };
      }
    }
    if (paragraph) {
      if (charLength(paragraph.text) >= lengthLimits(paragraph.text)[1]) this.publish(paragraph);
      else this.paragraphs.set(track, paragraph);
    }
  }
  flush(nowMs, tailMs = 12000) {
    for (const [track, value] of this.paragraphs)
      if (nowMs === undefined || performance.now() - value.touched_at >= 8000) {
        this.paragraphs.delete(track);
        this.publish(value);
      }
    for (const [track, value] of this.tails)
      if (nowMs === undefined || value.end_ms <= nowMs - tailMs) {
        this.tails.delete(track);
        this.joinStyles.delete(track);
        this.publish(value);
      }
    for (const track of this.voiceSpans.keys()) this.pruneVoiceSpans(track);
  }
  draft(track) {
    const parts = [this.paragraphs.get(track), this.tails.get(track)].filter(Boolean);
    return parts.length
      ? {
          start_ms: parts[0].start_ms,
          end_ms: parts.at(-1).end_ms,
          text: parts.map((part) => part.text).reduce(joinText),
        }
      : { start_ms: 0, end_ms: 0, text: '' };
  }
}
module.exports = {
  cleanText,
  splitSentences,
  sentenceSubtitles,
  LiveSubtitles,
  timeAt,
  timelineAnchors,
  partTimes,
  joinPending,
  anchorSplice,
  dedupeSeam,
};
