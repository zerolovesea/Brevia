const fs = require('node:fs');
const path = require('node:path');
const { schemas, failure } = require('../../desktop/agent-contract.cjs');
const { latestSegments } = require('./meeting-evidence.cjs');
const { srtTime } = require('./worker-exports.cjs');
const { ModelNotInstalled } = require('./models.cjs');

function parseSubtitles(text) {
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/);
  const segments = [];
  const stamp = (value) => {
    const parts = value.replace(',', '.').split(':').map(Number);
    if (parts.at(-1) >= 60 || parts.at(-2) >= 60)
      throw failure('invalid_subtitles', 'Subtitle minutes and seconds must be below 60');
    return Math.round(
      (parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]) *
        1000,
    );
  };
  for (const block of blocks) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split('\n'),
      index = lines.findIndex((line) => line.includes('-->'));
    const match =
      index >= 0 &&
      /^(\d{1,}:\d{2}(?::\d{2})?[.,]\d{3})\s+-->\s+(\d{1,}:\d{2}(?::\d{2})?[.,]\d{3})(?:\s.*)?$/.exec(
        lines[index],
      );
    if (!match || index > 1) throw failure('invalid_subtitles', 'Malformed subtitle cue');
    const start_ms = stamp(match[1]),
      end_ms = stamp(match[2]),
      body = lines
        .slice(index + 1)
        .join('\n')
        .trim();
    if (!body || !Number.isFinite(end_ms) || end_ms <= start_ms)
      throw failure('invalid_subtitles', 'Invalid subtitle text or timestamps');
    segments.push({ start_ms, end_ms, text: body });
  }
  if (!segments.length) throw failure('invalid_subtitles', 'No subtitle cues found');
  return segments;
}
function render(result, format) {
  if (format === 'json') return JSON.stringify(result, null, 2) + '\n';
  const segments = result.segments;
  if (!segments) throw failure('invalid_format', 'Voice matching requires JSON output');
  const text = (segment) => {
    const body = segment.translation ?? segment.text;
    return result.operation === 'diarize'
      ? `[${segment.speaker || 'Unknown speaker'}] ${body}`
      : body;
  };
  if (['srt', 'vtt'].includes(format)) {
    if (segments.some((s) => !Number.isFinite(s.start_ms) || !Number.isFinite(s.end_ms)))
      throw failure(
        'timestamps_unavailable',
        'This input has no usable timestamps; choose TXT, Markdown or JSON',
      );
    const time = (ms) => (format === 'vtt' ? srtTime(ms).replace(',', '.') : srtTime(ms));
    return (
      (format === 'vtt' ? 'WEBVTT\n\n' : '') +
      segments
        .map((s, i) => `${i + 1}\n${time(s.start_ms)} --> ${time(s.end_ms)}\n${text(s)}`)
        .join('\n\n') +
      '\n'
    );
  }
  return segments.map(text).join(format === 'md' ? '\n\n' : '\n') + '\n';
}
async function writeResult(destination, content, control) {
  await control.wait();
  // wx 保证包括软链在内的已有目标均不覆盖；只清理本次持有的文件。
  const handle = await fs.promises.open(destination, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await control.wait();
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  }
  await handle.close();
  return fs.realpathSync(destination);
}
function createAgentHandlers(worker) {
  return {
    'agent.cancel': (p) => {
      worker.tasks.cancelForMeeting(p.meeting_id);
      return { cancel_requested: true };
    },
    'agent.run': (p) =>
      worker.tasks.running('agent.run', p.meeting_id, async (control) => {
        const { meeting_id, ...input } = p;
        const value = schemas['inference.run'].parse(input);
        const format = value.format || path.extname(value.output_path).slice(1).toLowerCase();
        if (!['txt', 'md', 'srt', 'vtt', 'json'].includes(format))
          throw failure('invalid_format', 'Specify TXT, MD, SRT, VTT or JSON');
        if (value.operation === 'voice-match' && format !== 'json')
          throw failure('invalid_format', 'Voice matching requires JSON output');
        if (
          fs.existsSync(value.output_path) ||
          (() => {
            try {
              fs.lstatSync(value.output_path);
              return true;
            } catch (e) {
              if (e.code === 'ENOENT') return false;
              throw e;
            }
          })()
        )
          throw failure('output_exists', 'Output already exists: ' + value.output_path);
        if (!fs.statSync(path.dirname(value.output_path)).isDirectory())
          throw failure('output_directory_missing', 'Output directory does not exist');
        if (
          value.input_path &&
          (!fs.statSync(value.input_path).isFile() || !fs.statSync(value.input_path).size)
        )
          throw failure('invalid_input', 'Input must be a nonempty local file');
        const emit = (stage, completed = 0, total = 1) =>
          worker.emit('agent.progress', { meeting_id, stage, completed, total });
        try {
          let result;
          emit('preparing');
          if (value.operation === 'voice-match')
            result = await worker.handlers['speaker-profile.verify']({
              meeting_id,
              path: value.input_path,
              profile_id: value.profile_id,
            });
          else {
            const ext = path.extname(value.input_path || '').toLowerCase();
            let segments;
            if (value.text || ['.txt', '.md', '.srt', '.vtt'].includes(ext)) {
              if (value.operation !== 'translate')
                throw failure('invalid_input', 'Text and subtitle files support translation');
              if (value.input_path && fs.statSync(value.input_path).size > 2 * 1024 * 1024)
                throw failure('input_too_large', 'Text input exceeds 2 MiB');
              const text = value.text ?? fs.readFileSync(value.input_path, 'utf8');
              if (!text.trim()) throw failure('invalid_input', 'Text input is empty');
              segments = ['.srt', '.vtt'].includes(ext) ? parseSubtitles(text) : [{ text }];
            } else {
              const model = value.model_id || worker.models.defaultModel(value.language);
              const missing = worker.models.missing([
                model,
                'silero-vad',
                ...(value.operation === 'translate' ? ['hy-mt2-1.8b-q4km'] : []),
              ]);
              if (missing.length) throw new ModelNotInstalled(missing);
              await control.wait();
              emit('decoding');
              try {
                await worker.handlers['meeting.import']({
                  meeting_id,
                  path: value.input_path,
                  title: path.basename(value.input_path),
                  language: value.language,
                  refined_model_id: model,
                });
              } catch (error) {
                if (control.cancelled) throw error;
                throw Object.assign(error, { code: error.code || 'decode_failed' });
              }
              await control.wait();
              emit('transcribing');
              await worker.handlers['meeting.refine']({
                meeting_id,
                language: value.language,
                refined_model_id: model,
                num_speakers: value.num_speakers,
                force_diarization: value.operation === 'diarize',
              });
              await control.wait();
              const meeting = await worker.handlers['meeting.get']({ meeting_id });
              segments = latestSegments(meeting.segments).map((s) => ({
                start_ms: s.start_ms,
                end_ms: s.end_ms,
                text: s.text,
                speaker: s.speaker_name,
              }));
            }
            if (value.operation === 'translate') {
              for (const [index, segment] of segments.entries()) {
                await control.wait();
                emit('translating', index, segments.length);
                // 分段保留字幕时间；长文本分块避免上下文静默截断。
                const characters = Array.from(segment.text),
                  translated = [];
                for (let at = 0; at < characters.length; at += 256) {
                  await control.wait();
                  const part = await worker.translateText(
                    characters.slice(at, at + 256).join(''),
                    value.target_language,
                    control.signal,
                    { complete: true },
                  );
                  if (!part.trim())
                    throw failure('translation_empty', 'Translation model returned no text');
                  translated.push(part);
                }
                segment.translation = translated.join('\n');
              }
            }
            result = {
              operation: value.operation,
              language: value.language,
              ...(value.target_language ? { target_language: value.target_language } : {}),
              segments,
            };
            if (!value.text && !['.txt', '.md', '.srt', '.vtt'].includes(ext))
              result.meeting_id = meeting_id;
          }
          await control.wait();
          emit('exporting');
          const output_path = await writeResult(value.output_path, render(result, format), control);
          emit('completed', 1, 1);
          return {
            output_path,
            format,
            meeting_id: result.meeting_id,
            segment_count: result.segments?.length,
            ...(value.operation === 'voice-match' ? { match: result } : {}),
          };
        } catch (error) {
          if (control.cancelled) return { cancelled: true };
          throw error;
        }
      }),
  };
}
module.exports = { createAgentHandlers, parseSubtitles, render, writeResult };
