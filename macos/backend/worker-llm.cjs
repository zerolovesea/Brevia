const fs = require('node:fs');
const path = require('node:path');
const { complete } = require('./llm-client.cjs');
const { ModelNotInstalled } = require('./models.cjs');
const prompts = require('./summary-prompts.json');
const { createHash } = require('node:crypto');
const {
  estimatedTokens,
  splitByBudget,
  coverFacts,
  verifyFactSources,
  emptySummaryLine,
} = require('./summary-facts.cjs');
const evidence = require('./meeting-evidence.cjs');

const languages = {
  zh: 'Chinese',
  en: 'English',
  es: 'Spanish',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
};
const local = (payload) => ['built-in', 'builtin'].includes(payload.provider?.toLowerCase());
const clock = (ms) =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function clean(text) {
  text = evidence.normalizeSummaryMarkdown(text).replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  const close = text.toLowerCase().lastIndexOf('</think>');
  if (close >= 0) text = text.slice(close + 8);
  text = text.replace(/<\/?think>/gi, '').trim();
  // 小模型也会只返回段号。先统一标记，让分段归并继续按允许的来源集合过滤。
  text = text.replace(/\[\[(S[1-9]\d*(?:\s*,\s*S[1-9]\d*)*)\]\]/g, '[[conclusion:$1]]');
  return text.replace(
    /\[\[(?:fact|number|date|data):((?:S[1-9]\d*)(?:\s*,\s*S[1-9]\d*)*)\]\]/gi,
    '[[conclusion:$1]]',
  );
}

const summaryLimit = (error) =>
  /output token limit|output limit|exceed.*context|context_length_exceeded|maximum context length/i.test(
    error.message,
  );

function summaryReferences(text) {
  return new Set(
    [...text.matchAll(/\[\[(?:conclusion|decision|action|cause):([^\]]*)\]\]/g)].flatMap((m) =>
      m[1].split(',').map((id) => id.trim()),
    ),
  );
}

function createLLMHandlers(worker) {
  const queues = new Map();
  async function generate(payload, prompt, { signal, channel = 'assistant', chat = true } = {}) {
    if (!local(payload))
      return complete(payload, prompt, { signal, timeout: worker.settings.llm.timeout_seconds });
    const modelId = payload.model_id || payload.model;
    if (typeof modelId !== 'string' || !modelId.trim()) throw new Error('Model is required');
    if (!worker.models.isReady(modelId)) throw new ModelNotInstalled([modelId]);
    const directory = worker.models.path(modelId);
    const file = fs.readdirSync(directory).find((name) => name.endsWith('.gguf'));
    if (!file) throw new Error('GGUF file is missing');
    const previous = queues.get(channel) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        const engine = worker.engineFactory('llama', channel);
        await engine.request(
          'llama.load',
          { path: path.join(directory, file), context_size: payload.context_size ?? 16384 },
          { signal },
        );
        return engine.request(
          'llama.generate',
          {
            prompt,
            chat,
            max_tokens: payload.max_tokens ?? 2048,
            context_size: payload.context_size ?? 16384,
            temperature: payload.temperature ?? 0.7,
            top_k: payload.top_k ?? 40,
            top_p: payload.top_p ?? 0.95,
            stop_tokens: payload.stop_tokens,
            require_complete: payload.require_complete,
          },
          { signal },
        );
      });
    queues.set(channel, task);
    // 排队中的调用也能立即取消；队列仍等待原任务，不能让后来的请求越过在飞推理。
    const pending = signal
      ? new Promise((resolve, reject) => {
          const finish = (callback, value) => {
            signal.removeEventListener('abort', aborted);
            callback(value);
          };
          const aborted = () => finish(reject, signal.reason);
          task.then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
          if (signal.aborted) aborted();
          else signal.addEventListener('abort', aborted, { once: true });
        })
      : task;
    const result = await pending.catch((error) => {
      if (
        channel === 'translation' &&
        payload.require_complete &&
        error.message.startsWith('Translation exceeded output token limit')
      )
        throw failure('translation_truncated', error.message);
      throw error;
    });
    return String(result.text || '')
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
      .replace(/^[\s\S]*<\/think>/i, '')
      .trim();
  }
  worker.llmComplete = generate;
  worker.translateText = async (text, targetLanguage, signal, { complete = false } = {}) => {
    const prompt = `Translate the following text into ${languages[targetLanguage] || targetLanguage}. Output only the translation, with no explanations.\n\n${text}`;
    const request = worker.prompts?.apply('translation', prompt) ?? prompt;
    return (
      await generate(
        {
          provider: 'built-in',
          model: 'hy-mt2-1.8b-q4km',
          max_tokens: complete ? 2048 : 512,
          require_complete: complete,
          context_size: request === prompt ? 4096 : 16384,
          temperature: 0.3,
          stop_tokens: ['<|im_end|>', '<|endoftext|>'],
        },
        request,
        { signal: signal, channel: 'translation', chat: true },
      )
    ).trim();
  };

  async function response(payload, prompt, signal) {
    let request = prompt + '\n\nPut every Markdown heading and list item on its own line.';
    request += payload.summaryPreference;
    const result =
      clean(await generate(payload, request, { signal })) ||
      clean(await generate(payload, request, { signal }));
    if (!result) throw failure('error.summary.empty_response', 'Summary response was empty');
    return result;
  }
  async function structuredMinutes(options, prompt, language, signal) {
    const headings = evidence.SUMMARY_HEADINGS[language] || evidence.SUMMARY_HEADINGS.en;
    const outline = headings.map((title) => '## ' + title).join('\n');
    const request = `${prompt}\n\nUse these seven level-two headings in this order, with content under each. Where nothing was stated, put a single em dash (—) under that heading. Use level-three headings for individual discussion topics.\n${outline}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await response(
        options,
        request +
          (attempt
            ? '\nThe previous answer missed the required outline. Include every section.'
            : ''),
        signal,
      );
      const sections = [...result.matchAll(/^##[ \t]+(.+)$/gm)];
      if (
        sections.length === headings.length &&
        sections.every(
          (match, i) =>
            match[1].trim().replace(/^\*\*(.+)\*\*$/, '$1') === headings[i] &&
            /(?:[\p{L}\p{N}]|^\s*—\s*$)/u.test(
              result
                .slice(match.index + match[0].length, sections[i + 1]?.index)
                .replace(/^#{1,6}\s+.*$|\[\[[^\]\n]*\]\]/gm, ''),
            ),
        )
      )
        return result;
      signal.throwIfAborted();
    }
    throw new Error('The model returned incomplete structured meeting minutes');
  }
  const progress = (id, completed, stage = 'summary.generating') =>
    worker.emit('summary.progress', { meeting_id: id, completed, total: 100, stage });
  return {
    'summary.save': (payload) => worker.store.editSummary(payload.meeting_id, payload),
    'summary.generate': (payload) =>
      worker.tasks.running('summary.generate', payload.meeting_id, async (control) => {
        if (worker.active)
          throw failure('error.summary.live_meeting', '实时会议中，结束后再生成会议纪要。');
        if (!payload.consent)
          throw failure('error.sharing_not_confirmed', 'Transcript sharing was not confirmed');
        const meeting = worker.store.getMeeting(payload.meeting_id, { compact: true });
        const previous = meeting.summary?.data || {};
        const template =
          payload.template || meeting.summary_template || previous.template || 'general';
        const language = payload.language || 'en';
        const rules = evidence.evidenceInstructions(template, language);
        const segments = meeting.segments;
        const transcript = segments
          .map(
            (segment, index) =>
              `S${index + 1} [${clock(segment.start_ms)}] ${segment.speaker_name}: ` +
              evidence.annotateDates(segment.text.replace(/[\r\n]+/g, ' '), meeting.meeting_date),
          )
          .join('\n');
        if (!transcript)
          throw failure(
            'error.summary.no_transcript',
            '当前会议暂无逐字稿内容，请先完成转写后再生成会议纪要。',
          );
        worker.emit('summary.started', {
          meeting_id: meeting.id,
          completed: 10,
          total: 100,
          stage: 'summary.prepare',
        });
        const catalogContext = worker.models.catalog.get(
          payload.model_id || payload.model,
        )?.context_size;
        const context =
          payload.context_size ??
          (local(payload) ? Math.min(16384, catalogContext || 16384) : 8192);
        const options = {
          ...payload,
          context_size: context,
          require_complete: true,
          summaryPreference: worker.prompts?.apply('summary', '') || '',
          max_tokens: Math.min(payload.max_tokens ?? 3072, Math.floor(context / 3)),
        };
        const headings = evidence.SUMMARY_HEADINGS[language] || evidence.SUMMARY_HEADINGS.en;
        const instructions = prompts[language] || prompts.en;
        const merge = (prompts.merge[language] || prompts.merge.en).replaceAll(
          '{title}',
          meeting.title,
        );
        const overhead = options.summaryPreference;
        const rulesCost = Math.max(
          ...Object.keys(evidence.TEMPLATES).map((id) =>
            estimatedTokens(evidence.evidenceInstructions(id, language)),
          ),
        );
        const budget =
          context -
          options.max_tokens -
          estimatedTokens(overhead + headings.join('\n')) -
          rulesCost -
          Math.max(
            estimatedTokens(instructions + meeting.title),
            estimatedTokens(merge),
            estimatedTokens(prompts.chunk[language] || prompts.chunk.en),
          ) -
          384;
        if (budget < 128)
          throw failure(
            'error.summary.failed',
            'Summary prompt exceeds the available model context',
          );
        let markdown;
        try {
          await control.wait();
          progress(meeting.id, 60);
          // 先完成的请求可立即处理下一段；失败后等待在途请求结束，再向调用方报告。
          const mapChunks = async (chunks, summarize) => {
            const results = new Array(chunks.length);
            let next = 0,
              failure;
            const run = async () => {
              try {
                while (!failure && next < chunks.length) {
                  await control.wait();
                  if (failure || next >= chunks.length) return;
                  const index = next++;
                  results[index] = await summarize(chunks[index], index);
                }
              } catch (error) {
                failure ||= error;
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(chunks.length, local(options) ? 1 : 3) }, run),
            );
            if (failure) throw failure;
            return results;
          };
          if (estimatedTokens(transcript) <= budget) {
            try {
              markdown = await structuredMinutes(
                options,
                `${instructions}\n\n# ${meeting.title}\n${rules}\n\nDo not reveal reasoning or a thinking process. Begin directly with the requested Markdown.\n\n<transcript>\n${transcript}\n</transcript>`,
                language,
                control.signal,
              );
            } catch (error) {
              if (control.signal.aborted || !summaryLimit(error)) throw error;
            }
          }
          if (!markdown) {
            const chunkBudget =
              estimatedTokens(transcript) <= budget
                ? Math.max(128, Math.ceil(estimatedTokens(transcript) / 2))
                : budget;
            const chunks = splitByBudget(transcript, chunkBudget);
            worker.store.run?.(
              'DELETE FROM summary_chunks WHERE meeting_id=? AND position>=?',
              meeting.id,
              chunks.length,
            );
            let completed = 0;
            const summaries = await mapChunks(chunks, async (chunk, index) => {
              await control.wait();
              const previous = index ? chunks[index - 1].split('\n').at(-1) : '';
              const contextLine = previous && estimatedTokens(previous) <= 120 ? previous : '';
              const factPrompt = (part, previousLine) =>
                `${prompts.chunk[language] || prompts.chunk.en}\nExtract a compact list of facts, including every decision, action, date and figure, explicit cause and open question. Use verbatim wording for decisions, tasks and quantities where possible. Preserve numbers exactly. End each factual bullet with its source marker [[action:S1]], [[decision:S2]], [[conclusion:S3]] or [[cause:S4]]. Use only IDs from this block. The preceding line is context for pronouns, not a new fact.\n<preceding_context>${previousLine}</preceding_context>\n<transcript>\n${part}\n</transcript>`;
              const prompt = factPrompt(chunk, contextLine);
              const fingerprint = createHash('sha256')
                .update(
                  JSON.stringify([
                    2,
                    language,
                    options.provider,
                    options.endpoint,
                    options.format,
                    options.model,
                    options.model_id,
                    context,
                    options.max_tokens,
                    options.temperature,
                    options.top_k,
                    options.top_p,
                    overhead,
                    prompt,
                  ]),
                )
                .digest('hex');
              let summary = worker.store.one?.(
                'SELECT facts FROM summary_chunks WHERE meeting_id=? AND position=? AND fingerprint=?',
                meeting.id,
                index,
                fingerprint,
              )?.facts;
              if (!summary) {
                async function extract(part, previousLine, depth) {
                  await control.wait();
                  const visible = new Set([...part.matchAll(/^(S[1-9]\d*) \[/gm)].map((m) => m[1]));
                  try {
                    return evidence.restrictSources(
                      await response(
                        { ...options, max_tokens: Math.min(1536, options.max_tokens) },
                        factPrompt(part, previousLine),
                        control.signal,
                      ),
                      visible,
                    );
                  } catch (error) {
                    if (control.signal.aborted || depth >= 3 || !summaryLimit(error)) throw error;
                    const smaller = splitByBudget(
                      part,
                      Math.max(128, Math.ceil(estimatedTokens(part) / 2)),
                    );
                    if (smaller.length < 2) throw error;
                    const facts = [];
                    for (const piece of smaller) facts.push(await extract(piece, '', depth + 1));
                    return facts.join('\n');
                  }
                }
                summary = await extract(chunk, contextLine, 0);
                await control.wait();
                if (/\[\[(?:action|decision|cause|conclusion):S\d+/.test(summary))
                  worker.store.run?.(
                    'INSERT OR REPLACE INTO summary_chunks SELECT id,?,?,? FROM meetings WHERE id=? AND deleted_at IS NULL',
                    index,
                    fingerprint,
                    summary,
                    meeting.id,
                  );
              }
              progress(meeting.id, 60 + Math.floor((30 * ++completed) / chunks.length));
              return summary;
            });
            let blocks = summaries.join('\n\n---\n\n');
            const writeMinutes = async (facts) =>
              evidence.restrictSources(
                await structuredMinutes(
                  options,
                  `${merge}\n\n${rules}\n\n<partial summaries>\n${facts}\n</partial summaries>`,
                  language,
                  control.signal,
                ),
                summaryReferences(facts),
              );
            if (estimatedTokens(blocks) > budget) {
              try {
                const reduced = await mapChunks(
                  splitByBudget(blocks, budget, true),
                  async (chunk) =>
                    evidence.restrictSources(
                      await response(
                        { ...options, max_tokens: Math.min(1536, options.max_tokens) },
                        `${rules}\nCompress these partial summaries into a shorter fact list, not a finished document. Preserve source markers for decisions, actions, causes and figures:\n${chunk}`,
                        control.signal,
                      ),
                      summaryReferences(chunk),
                    ),
                );
                const candidate = reduced.join('\n\n---\n\n');
                const retained = summaryReferences(candidate);
                if (
                  estimatedTokens(candidate) <= budget &&
                  [...summaryReferences(blocks)].every((id) => retained.has(id))
                )
                  blocks = candidate;
              } catch (error) {
                if (control.signal.aborted || !summaryLimit(error)) throw error;
              }
            }
            if (estimatedTokens(blocks) <= budget) {
              try {
                markdown = await writeMinutes(blocks);
              } catch (error) {
                if (control.signal.aborted || !summaryLimit(error)) throw error;
              }
            }
            if (!markdown) {
              // 成稿过长或压缩没有缩小时，按组写七章再拼接，不截去末尾的事实。
              const parts = splitByBudget(
                blocks,
                Math.min(budget, Math.max(128, Math.ceil(estimatedTokens(blocks) / 2))),
                true,
              );
              const writePart = async (part, depth = 0) => {
                try {
                  await control.wait();
                  return [await writeMinutes(part)];
                } catch (error) {
                  if (control.signal.aborted || !summaryLimit(error) || depth >= 3) throw error;
                  const smaller = splitByBudget(
                    part,
                    Math.max(128, Math.ceil(estimatedTokens(part) / 2)),
                    true,
                  );
                  if (smaller.length < 2) throw error;
                  const written = [];
                  for (const piece of smaller) written.push(...(await writePart(piece, depth + 1)));
                  return written;
                }
              };
              const drafts = (await mapChunks(parts, (part) => writePart(part))).flat();
              const bodies = headings.map(() => new Set());
              for (const draft of drafts) {
                const sections = [...draft.matchAll(/^##[ \t]+.+$/gm)];
                sections.forEach((match, i) => {
                  const body = draft
                    .slice(match.index + match[0].length, sections[i + 1]?.index)
                    .trim();
                  if (body && !emptySummaryLine.test(body)) bodies[i].add(body);
                });
              }
              markdown = headings
                .map((heading, i) => '## ' + heading + '\n' + ([...bodies[i]].join('\n\n') || '—'))
                .join('\n\n');
            }
            markdown = coverFacts(markdown, summaries, headings, segments);
          }
          await control.wait();
          if (!markdown)
            throw failure('error.summary.empty_response', 'Summary response was empty');
        } catch (error) {
          if (control.signal.aborted || !worker.store.meetingExists(meeting.id))
            return { cancelled: true };
          if (error.models || error.code) throw error;
          if (
            /\b(?:401|403)\b|error code:\s*1010|API key|Authorization header|invalid_api_key|authentication/i.test(
              error.message,
            )
          )
            throw failure('error.summary.authentication', 'Summary authentication failed');
          throw failure('error.summary.failed', 'Summary generation failed: ' + error.message);
        }
        const model = worker.models.catalog.get(meeting.transcript_model_id);
        const timed =
          meeting.transcript_revision == null ||
          (model?.stages?.includes('refined') && !model.retired);
        markdown = verifyFactSources(markdown, segments);
        const [rendered, claims] = evidence.parseClaims(
          markdown,
          segments,
          timed,
          evidence.SUMMARY_HEADINGS[language] || evidence.SUMMARY_HEADINGS.en,
        );
        const data = {
          markdown: rendered,
          language,
          claims,
          template,
          basis_date: meeting.meeting_date,
        };
        if (
          !worker.store.saveSummary(meeting.id, data, markdown, {
            expected_revision: meeting.correction?.revision || 0,
            expected_document: [meeting.meeting_date, previous.markdown || ''],
          })
        )
          return { cancelled: true };
        progress(meeting.id, 100, 'summary.saving');
        const saved = worker.store.getMeeting(meeting.id, { compact: true }).summary.data;
        worker.emit('summary.ready', { meeting_id: meeting.id, summary: saved });
        return saved;
      }),
    'translation.generate': (payload) =>
      worker.tasks.running(
        'translation.generate',
        payload.meeting_id,
        async (control) => {
          if (!payload.consent)
            throw failure('error.sharing_not_confirmed', 'Transcript sharing was not confirmed');
          let [meeting, segment] = worker.store.translationContext(
            payload.meeting_id,
            payload.segment_id,
          );
          if (!segment && payload.segment) {
            worker.store.saveSegment({
              ...payload.segment,
              meeting_id: meeting.id,
              segment_id: payload.segment_id,
            });
            [, segment] = worker.store.translationContext(payload.meeting_id, payload.segment_id);
          }
          if (!segment) throw failure('error.segment_not_found', 'Transcript segment not found');
          await control.wait();
          const translation = await worker.translateText(
            segment.text,
            payload.target_language,
            control.signal,
          );
          await control.wait();
          if (
            !worker.store.saveTranslation(meeting.id, segment.id, translation, {
              expected_text: segment.text,
              expected_version: [segment.version, segment.revision],
              target_language: payload.target_language,
            })
          )
            return { cancelled: true };
          const event = { meeting_id: meeting.id, segment_id: segment.id, translation };
          worker.emit('translation.ready', event);
          return event;
        },
        { concurrent: true },
      ),
  };
}

module.exports = { createLLMHandlers, clean };
