const { randomUUID } = require('node:crypto');
const rules = require('./ai-note-rules.json');
const { snapshot, claimRecord, annotateDates, clock } = require('./meeting-evidence.cjs');

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const number =
  /\d+(?:\.\d+)?%?|百分之[零一二三四五六七八九十百千万两]+|[零一二三四五六七八九十百千万亿两]{2,}\s*[%％]?/;
const date = /\d{1,4}[年/.\-]\d{1,2}(?:[月/.\-]\d{1,2})?|周[一二三四五六日天]/;
const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;

// 建议长度有上限，按最长连续匹配块计算与旧版 SequenceMatcher 相同的字符相似度。
function similarity(a, b) {
  const pending = [[0, a.length, 0, b.length]];
  let count = 0;
  while (pending.length) {
    const [loA, hiA, loB, hiB] = pending.pop();
    let bestA = loA,
      bestB = loB,
      size = 0;
    let previous = new Map();
    for (let i = loA; i < hiA; i++) {
      const row = new Map();
      for (let j = loB; j < hiB; j++) {
        if (a[i] !== b[j]) continue;
        const length = (previous.get(j - 1) || 0) + 1;
        row.set(j, length);
        if (length > size) {
          size = length;
          bestA = i - length + 1;
          bestB = j - length + 1;
        }
      }
      previous = row;
    }
    if (!size) continue;
    count += size;
    if (loA < bestA && loB < bestB) pending.push([loA, bestA, loB, bestB]);
    if (bestA + size < hiA && bestB + size < hiB)
      pending.push([bestA + size, hiA, bestB + size, hiB]);
  }
  return a.length + b.length ? (2 * count) / (a.length + b.length) : 1;
}
function duplicate(a, b) {
  if (similarity(a, b) >= 0.7) return true;
  if (cjk.test(a) || cjk.test(b)) return false;
  const grams = (text) =>
    new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
  const first = grams(a),
    second = grams(b);
  const count = [...first].filter((value) => second.has(value)).length;
  return count >= 3 && count / Math.min(first.size, second.size) >= 0.6;
}
function extractJSON(text) {
  // 扫描配对括号，同时跳过 JSON 字符串内的括号和转义字符。
  for (let start = 0; start < text.length; start++) {
    if (!'[{'.includes(text[start])) continue;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let end = start; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if ('[{'.includes(char)) depth++;
      else if (']}'.includes(char) && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}
function parseSuggestions(raw) {
  const data = extractJSON(String(raw || ''));
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.suggestions)
      ? data.suggestions
      : data?.type
        ? [data]
        : [];
  return items.slice(0, 1).flatMap((item) => {
    const type =
      rules.type_aliases[
        String(item?.type || '')
          .trim()
          .toLowerCase()
      ];
    const line = String(item?.text || item?.suggestion || '').trim();
    if (/[\r\n\u2028\u2029]/.test(line)) return [];
    const text = line.slice(0, 64);
    return type && text
      ? [{ type, text, importance: String(item.importance || 'medium'), evidence: item.evidence }]
      : [];
  });
}
function useful(item) {
  const text = item.text;
  if (
    normalize(text).length < 6 ||
    rules.meta_words.filter((word) => text.toLowerCase().includes(word)).length >= 2
  )
    return false;
  if (
    item.type === 'topic' &&
    /^(?:本期|这期|本次|本场|今天|关于|on|about|in this|the (?:topic|subject) of)\b|(?:的话题|的讨论|相关话题|有关问题|related topic|discussion about|talk about)\s*$/i.test(
      text,
    )
  )
    return false;
  if (['action', 'supplement'].includes(item.type) && (text.match(/[,，]/g) || []).length >= 3)
    return false;
  if (
    item.type === 'number' &&
    (!number.test(text) ||
      text.replace(
        /[0-9０-９.．%％年月日时分秒个点万亿千百十亿块元角分号\s,，。；;：:、\-/()（）【】]/g,
        '',
      ).length < 4)
  )
    return false;
  return item.type !== 'date' || date.test(text);
}

function createAiNoteHandlers(worker) {
  const sessions = new Map();
  function cancel(session) {
    session.stopped = true;
    session.generation++;
    session.controller?.abort();
    clearInterval(session.timer);
    worker.emit('ai-note.analyzing', { meeting_id: session.id, active: false });
  }
  function remember(session, segment) {
    const text = segment.text.trim();
    const entry = text
      .replace(/\s+/g, '')
      .replace(/^[，。！？!?；;：:、]+|[，。！？!?；;：:、]+$/g, '')
      .slice(0, 34);
    const has = (list) => list.some((word) => text.toLowerCase().includes(word));
    const kind = has(rules.decision_words)
      ? 'decisions'
      : has(rules.action_words)
        ? 'actions'
        : has(rules.question_words)
          ? 'questions'
          : number.test(text) || date.test(text)
            ? 'facts'
            : null;
    if (kind) {
      const entries = session.state[kind];
      if (
        entry &&
        !entries.slice(-6).some((old) => similarity(normalize(old), normalize(entry)) >= 0.85)
      )
        entries.push(entry);
      session.state[kind] = entries.slice(kind === 'facts' ? -4 : -3);
    }
    if (has(rules.topic_markers) || has(rules.intro_markers)) session.state.topic = entry;
  }
  worker.aiNoteOnSegment = (event) => {
    const session = sessions.get(event.meeting_id);
    if (!session) return;
    const segment = snapshot({
      ...event,
      text: String(event.text || ''),
      start_ms: Number(event.start_ms || 0),
    });
    session.segments.push(segment);
    session.segments = session.segments.slice(-200);
    remember(session, segment);
    session.pendingChars += segment.text.length;
    session.version++;
    void analyze(session);
  };
  worker.shutdownAiNote = () => {
    for (const session of sessions.values()) cancel(session);
    sessions.clear();
  };

  async function analyze(session) {
    if (session.stopped || session.running || session.typing || session.version <= session.analyzed)
      return;
    if (session.proactivity === 'quiet') {
      if (!session.requested) return;
    } else if (
      Date.now() - session.lastRun < (session.interval ?? 60) * 1000 &&
      session.pendingChars < 240
    )
      return;
    session.running = true;
    session.requested = false;
    session.controller = new AbortController();
    const signal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(40000)]);
    const { generation, version, pendingChars } = session;
    let remaining = session.language === 'zh' ? 450 : 900;
    const window = [];
    for (const row of session.segments.slice(session.language === 'zh' ? -5 : -8).reverse()) {
      const label = `[${clock(row.start_ms)}] `;
      if (remaining <= label.length) break;
      const line = label + annotateDates(row.text, session.meetingDate);
      if (window.length && line.length > remaining) break;
      window.push([row, line.slice(0, remaining)]);
      remaining -= Math.min(line.length, remaining) + 1;
    }
    window.reverse();
    const state = ['topic', 'facts', 'decisions', 'actions', 'questions']
      .flatMap((key, index) => {
        const value = session.state[key];
        return value.length
          ? [
              `${session.prompt.state_labels?.[index] || ''}: ${Array.isArray(value) ? value.join('; ') : value}`,
            ]
          : [];
      })
      .join('\n')
      .slice(0, 420);
    const prompt = `${session.prompt.instructions || ''}\n\n<meeting_state>\n${state || '(empty)'}\n</meeting_state>\n\n<accepted_claims>\n${
      session.claims
        .slice(-6)
        .map((claim) => '- ' + claim.text)
        .join('\n') || '(empty)'
    }\n</accepted_claims>\n\n<recent_transcript>\n${window.map(([, line]) => line).join('\n') || '(empty)'}\n</recent_transcript>\n\n<user_note>\n${session.paragraph.slice(0, 80) || '(empty)'}\n</user_note>`;
    worker.emit('ai-note.analyzing', { meeting_id: session.id, active: true });
    try {
      const raw = await worker.llmComplete(
        { ...session.connection, max_tokens: 160, timeout: 40, temperature: 0.2 },
        (worker.prompts?.apply('ai_note', prompt) ?? prompt) +
          (['built-in', 'builtin'].includes(session.connection.provider?.toLowerCase())
            ? '\n/no_think'
            : ''),
        { signal },
      );
      if (
        session.stopped ||
        session.generation !== generation ||
        sessions.get(session.id) !== session
      )
        return;
      for (const item of parseSuggestions(raw)) {
        const requested = Array.isArray(item.evidence) ? item.evidence : [item.evidence];
        const stamps = window.map(([row]) => clock(row.start_ms));
        item.evidence = [
          ...new Set(
            requested.filter(
              (stamp) =>
                typeof stamp === 'string' && stamps.filter((other) => other === stamp).length === 1,
            ),
          ),
        ].slice(0, 2);
        item.sources = window
          .filter(([row]) => row.segment_id && item.evidence.includes(clock(row.start_ms)))
          .map(([row]) => snapshot(row));
        const norm = normalize(item.text);
        const prior = session.claims.find(
          (claim) => claim.type === item.type && duplicate(claim.norm, norm),
        );
        if (prior) {
          prior.evidence = [...new Set([...prior.evidence, ...item.evidence])];
          const known = new Set(prior.sources.map((source) => source.segment_id));
          prior.sources.push(...item.sources.filter((source) => !known.has(source.segment_id)));
          worker.store.recordAiClaim(
            session.id,
            claimRecord(prior.text, prior.type, prior.sources, '', prior.id),
          );
          worker.emit('ai-note.evidence', {
            meeting_id: session.id,
            id: prior.id,
            evidence: prior.evidence,
            sources: prior.sources,
          });
          continue;
        }
        if (
          !useful(item) ||
          session.dismissed.has(norm) ||
          session.claims.some((claim) => claim.norm === norm) ||
          (item.type === 'topic' && session.topics.has(norm))
        )
          continue;
        if (
          Object.values(session.state)
            .flat()
            .some((entry) => entry && similarity(normalize(entry), norm) >= 0.92)
        )
          continue;
        item.id = randomUUID();
        item.norm = norm;
        if (item.type === 'topic') session.topics.add(norm);
        session.claims.push(item);
        session.claims = session.claims.slice(-24);
        worker.store.recordAiClaim(
          session.id,
          claimRecord(item.text, item.type, item.sources, '', item.id),
        );
        worker.emit('ai-note.suggestion', {
          meeting_id: session.id,
          id: item.id,
          type: item.type,
          text: item.text,
          importance: item.importance,
          evidence: item.evidence,
          sources: item.sources,
          source_tracked: true,
        });
      }
    } catch (error) {
      // 辅助笔记失败不影响正在录制的原音和字幕。
      if (!signal.aborted)
        worker.emit('worker.warning', { meeting_id: session.id, message: error.message });
    } finally {
      if (sessions.get(session.id) === session)
        worker.emit('ai-note.analyzing', { meeting_id: session.id, active: false });
      session.running = false;
      if (session.generation === generation && !session.stopped) {
        session.analyzed = Math.max(session.analyzed, version);
        session.pendingChars = Math.max(0, session.pendingChars - pendingChars);
      }
      session.lastRun = Date.now();
    }
  }

  return {
    'ai-note.start': (payload) => {
      const meeting = worker.store.getMeeting(payload.meeting_id, { compact: true });
      const previous = sessions.get(meeting.id);
      if (previous) cancel(previous);
      const session = {
        id: meeting.id,
        meetingDate: meeting.meeting_date,
        connection: payload,
        language: payload.language || 'zh',
        proactivity: payload.proactivity || 'assist',
        prompt: payload.prompt || {},
        state: { topic: '', facts: [], decisions: [], actions: [], questions: [] },
        segments: [],
        claims: [],
        topics: new Set(),
        dismissed: new Set(),
        typing: false,
        paragraph: '',
        stopped: false,
        running: false,
        generation: 0,
        version: 0,
        analyzed: 0,
        pendingChars: 0,
        lastRun: Date.now(),
      };
      sessions.set(meeting.id, session);
      session.timer = setInterval(() => void analyze(session), 1000);
      session.timer.unref();
      return { started: true };
    },
    'ai-note.stop': ({ meeting_id: id }) => {
      const session = sessions.get(id);
      if (!session) return { stopped: false };
      cancel(session);
      sessions.delete(id);
      return { stopped: true };
    },
    'ai-note.typing': (payload) => {
      const session = sessions.get(payload.meeting_id);
      if (!session) return { ok: false };
      session.typing = Boolean(payload.typing);
      if (payload.notes != null) session.paragraph = String(payload.notes).slice(-80);
      if (session.typing) {
        session.generation++;
        session.controller?.abort();
      }
      return { ok: true };
    },
    'ai-note.request': (payload) => {
      const session = sessions.get(payload.meeting_id);
      if (!session) return { ok: false };
      if (payload.notes != null) session.paragraph = String(payload.notes).slice(-80);
      session.requested = true;
      session.version++;
      void analyze(session);
      return { ok: true };
    },
    'ai-note.dismiss': (payload) => {
      const session = sessions.get(payload.meeting_id);
      if (!session) return { ok: false };
      session.dismissed.add(normalize(payload.text));
      return { ok: true };
    },
    'ai-note.reconfigure': (payload) => {
      const session = sessions.get(payload.meeting_id);
      if (!session) return { ok: false };
      const interval =
        payload.min_interval_seconds == null
          ? null
          : Math.max(1, Number(payload.min_interval_seconds));
      if (interval != null && !Number.isFinite(interval))
        throw new Error('Invalid analysis interval');
      session.interval = interval;
      return { ok: true, min_interval_seconds: interval };
    },
  };
}

module.exports = { createAiNoteHandlers, parseSuggestions, similarity };
