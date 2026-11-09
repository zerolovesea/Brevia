const fs = require('node:fs');
const path = require('node:path');
const { complete } = require('./llm-client.cjs');
const { ModelNotInstalled } = require('./models.cjs');
const prompts = require('./summary-prompts.json');
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
  const heading = text.search(/^#{1,6}\s+/m);
  return heading >= 0 ? text.slice(heading) : text;
}

function splitTranscript(transcript, budget) {
  if (!Number.isInteger(budget) || budget < 1) throw new Error('Invalid transcript budget');
  const chunks = [];
  let current = [];
  let length = 0;
  for (const line of transcript.split('\n')) {
    if (line.length > budget) {
      if (current.length) chunks.push(current.join('\n'));
      current = [];
      length = 0;
      const label = /^(S[1-9]\d* \[\d+:\d+\] )/.exec(line)?.[1] || '';
      const prefix = label.length < budget ? label : '';
      const body = line.slice(prefix.length);
      for (let offset = 0; offset < body.length; offset += budget - prefix.length)
        chunks.push(prefix + body.slice(offset, offset + budget - prefix.length));
    } else {
      if (current.length && length + line.length + 1 > budget) {
        chunks.push(current.join('\n'));
        current = [];
        length = 0;
      }
      current.push(line);
      length += line.length + 1;
    }
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.length ? chunks : [''];
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
    request = worker.prompts?.apply('summary', request) ?? request;
    const result =
      clean(await generate(payload, request, { signal })) ||
      clean(await generate(payload, request, { signal }));
    if (!result) throw failure('error.summary.empty_response', 'Summary response was empty');
    return result;
  }
  async function structuredMinutes(options, prompt, language, signal) {
    const headings = evidence.SUMMARY_HEADINGS[language] || evidence.SUMMARY_HEADINGS.en;
    const outline = headings.map((title) => '## ' + title).join('\n');
    const request = `${prompt}\n\nUse these seven level-two headings in this order, with content under each. Where nothing was stated, say so briefly in the output language. Use level-three headings for individual discussion topics.\n${outline}`;
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
            /[\p{L}\p{N}]/u.test(
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
        const options = { ...payload, max_tokens: payload.max_tokens ?? 3072 };
        let markdown;
        try {
          await control.wait();
          progress(meeting.id, 60);
          const instructions = prompts[language] || prompts.en;
          // 本地引擎串行；在线每批最多三条，失败后等待同批收尾，避免遗留请求。
          const mapChunks = async (chunks, summarize) => {
            const results = [];
            const concurrency = local(options) ? 1 : 3;
            for (let start = 0; start < chunks.length; start += concurrency) {
              await control.wait();
              const batch = await Promise.allSettled(
                chunks.slice(start, start + concurrency).map(summarize),
              );
              const failed = batch.find((result) => result.status === 'rejected');
              if (failed) throw failed.reason;
              results.push(...batch.map((result) => result.value));
            }
            return results;
          };
          if (transcript.length <= 10000) {
            markdown = await structuredMinutes(
              options,
              `${instructions}\n\n# ${meeting.title}\n${rules}\n\nDo not reveal reasoning or a thinking process. Begin directly with the requested Markdown.\n\n<transcript>\n${transcript}\n</transcript>`,
              language,
              control.signal,
            );
          } else {
            const chunks = splitTranscript(transcript, 9000);
            let completed = 0;
            const summaries = await mapChunks(chunks, async (chunk) => {
              await control.wait();
              const prompt = `${prompts.chunk[language] || prompts.chunk.en}\n\n${rules}\n\n<transcript>\n${chunk}\n</transcript>`;
              const visible = new Set(
                [...chunk.matchAll(/^(S[1-9]\d*) \[/gm)].map((match) => match[1]),
              );
              const summary = evidence.restrictSources(
                await response({ ...options, max_tokens: 512 }, prompt, control.signal),
                visible,
              );
              progress(meeting.id, 60 + Math.floor((30 * ++completed) / chunks.length));
              return summary;
            });
            let blocks = summaries.join('\n\n---\n\n');
            let rounds = 0;
            while (blocks.length > 16000) {
              if (++rounds > 8) throw new Error('Summary reduction exceeded eight rounds');
              const reduced = await mapChunks(splitTranscript(blocks, 9000), async (chunk) => {
                await control.wait();
                return evidence.restrictSources(
                  await response(
                    { ...options, max_tokens: 512 },
                    `${(prompts.merge[language] || prompts.merge.en).replaceAll('{title}', meeting.title)}\n${rules}\nCompress these partial summaries while retaining decisions, actions and source markers:\n${chunk}`,
                    control.signal,
                  ),
                  new Set(
                    [
                      ...chunk.matchAll(/\[\[(?:conclusion|decision|action|cause):([^\]]*)\]\]/g),
                    ].flatMap((match) => match[1].split(',').map((label) => label.trim())),
                  ),
                );
              });
              const next = reduced.join('\n\n---\n\n');
              if (next.length >= blocks.length)
                throw new Error('Summary reduction did not converge');
              blocks = next;
            }
            const visible = new Set(
              [
                ...blocks.matchAll(/\[\[(?:conclusion|decision|action|cause):([^\]]*)\]\]/g),
              ].flatMap((match) => match[1].split(',').map((label) => label.trim())),
            );
            markdown = evidence.restrictSources(
              await structuredMinutes(
                options,
                `${(prompts.merge[language] || prompts.merge.en).replaceAll('{title}', meeting.title)}\n\n${rules}\n\n<partial summaries>\n${blocks}\n</partial summaries>`,
                language,
                control.signal,
              ),
              visible,
            );
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

module.exports = { createLLMHandlers, splitTranscript, clean };
