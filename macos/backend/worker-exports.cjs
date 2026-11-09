const fs = require('node:fs');
const path = require('node:path');
const { writeZip } = require('./export-zip.cjs');
const { clock, latestSegments } = require('./meeting-evidence.cjs');
const { resolveExisting } = require('./store-base.cjs');

const CAUSE_LABELS = {
  zh: ['原因分析', '缺少原文依据', '原文已变化', '依据较少', '与当前笔记待核对'],
  en: [
    'Cause analysis',
    'No source cited',
    'Transcript changed',
    'Limited evidence',
    'Check against edited notes',
  ],
  es: [
    'Análisis de causas',
    'Sin cita original',
    'La transcripción ha cambiado',
    'Poco respaldo',
    'Contrastar con las notas editadas',
  ],
  ja: ['原因分析', '出典なし', '原文変更あり', '根拠が少ない', '編集後のメモと要照合'],
  ko: ['원인 분석', '인용 없음', '원문 변경됨', '근거 부족', '수정된 노트와 대조 필요'],
  fr: [
    'Analyse des causes',
    'Aucune source citée',
    'Transcription modifiée',
    'Peu de sources',
    'À comparer aux notes modifiées',
  ],
  de: [
    'Ursachenanalyse',
    'Kein Beleg',
    'Transkript geändert',
    'Wenig Belegtext',
    'Mit bearbeiteten Notizen abgleichen',
  ],
  ru: [
    'Анализ причин',
    'Нет источника',
    'Текст изменился',
    'Мало подтверждений',
    'Сверить с изменёнными заметками',
  ],
};
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[char],
  );
function safeTitle(text) {
  let name = String(text)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .trim();
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
  // Leave room for collision suffixes and .print.html on both desktop file systems.
  let result = '',
    bytes = 0;
  for (const char of name) {
    bytes += Buffer.byteLength(char);
    if (bytes > 220) break;
    result += char;
  }
  return result.replace(/[. ]+$/, '');
}
const inside = (file, directory) => file.startsWith(directory + path.sep);
const mermaidLabel = (text) =>
  String(text)
    .split(/\r?\n/)
    .join(' ')
    .replace(/["`#&<>%]/g, (char) => `#${char.codePointAt(0)};`);
function causeAppendix(meeting, body, markdown = true) {
  const summary = meeting.summary?.data || {},
    groups = new Map(),
    marker = `%% Brevia cause tree ${meeting.id}`;
  for (const claim of summary.claims || [])
    if (claim.kind === 'cause') {
      if (!groups.has(claim.section)) groups.set(claim.section, []);
      groups.get(claim.section).push(claim);
    }
  if (!groups.size || body.split(/\r?\n/).includes(marker)) return '';
  const [title, missing, changed, thin, detached] =
    CAUSE_LABELS[summary.language || meeting.example_locale || meeting.language] || CAUSE_LABELS.en;
  const statuses = { missing, changed, thin },
    lines = markdown ? [`## ${title}`, '', '```mermaid', 'flowchart LR', marker] : [title],
    quotes = [];
  let number = 0,
    group = 0;
  for (const [section, claims] of groups) {
    lines.push(markdown ? `    p${group}["${mermaidLabel(section || title)}"]` : section || title);
    for (const [index, claim] of claims.entries()) {
      number++;
      let label = `${number}. ${claim.text}`;
      if (statuses[claim.status]) label += ` · ${statuses[claim.status]}`;
      if (claim.detached) label += ` · ${detached}`;
      lines.push(
        markdown
          ? `    p${group} --- c${number}["${mermaidLabel(label)}"]`
          : `${index === claims.length - 1 ? '└──' : '├──'} ${label}`,
      );
      for (const source of claim.sources) {
        const stamp =
          source.seekable !== false ? `${clock(source.start_ms)}–${clock(source.end_ms)} · ` : '';
        let quote = `${source.speaker} · ${source.text}`.split(/\r?\n/).join(' ');
        if (markdown) {
          quote = quote.replace(/([\\`*_{}\[\]<>~&])/g, '\\$1');
          quotes.push(`> **${number}** · ${stamp}${quote}`);
        } else lines.push(`    ${stamp}${quote}`);
      }
    }
    group++;
  }
  if (markdown) {
    lines.push('```');
    for (const quote of quotes) lines.push('', quote);
  }
  return lines.join('\n');
}
function noteBody(meeting, contentType) {
  if (contentType === 'mynotes') {
    if (!(meeting.notes || '').trim()) throw new Error('会议中没有记录笔记。');
    return meeting.notes;
  }
  const summary = meeting.summary?.data;
  if (!summary) throw new Error('Generate meeting notes before exporting them');
  if (!summary.markdown) throw new Error('Meeting notes must be regenerated as Markdown');
  return summary.markdown;
}
function reserveStem(directory, stem, format) {
  if (path.dirname(resolveExisting(directory)) !== resolveExisting(path.dirname(directory)))
    throw new Error('Invalid export directory');
  fs.mkdirSync(directory, { recursive: true });
  stem = safeTitle(stem) || 'Brevia';
  for (let index = 0; index < 10000; index++) {
    const candidate = stem + (index ? `(${index})` : ''),
      extensions = format === 'pdf' ? ['pdf', 'print.html'] : [format];
    if (
      extensions.some((extension) =>
        fs.existsSync(path.join(directory, `${candidate}.${extension}`)),
      )
    )
      continue;
    const reservation = path.join(directory, `${candidate}.${extensions.at(-1)}`);
    try {
      fs.closeSync(fs.openSync(reservation, 'wx'));
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    if (format === 'pdf' && fs.existsSync(path.join(directory, `${candidate}.pdf`))) {
      fs.unlinkSync(reservation);
      continue;
    }
    return candidate;
  }
  throw new Error('Too many exports with the same name');
}
function markdownHTML(markdown) {
  const lines = String(markdown || '')
      .replace(/\r/g, '')
      .split('\n'),
    html = [],
    inline = (text) => escape(text).replace(/\*\*/g, '');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index],
      heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!line.trim()) {
      index++;
      continue;
    }
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index]))
        items.push(`<li>${inline(lines[index++].replace(/^[-*]\s+/, ''))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        const cells = lines[index++]
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells);
      }
      if (rows.length)
        html.push(
          '<table><thead><tr>' +
            rows[0].map((cell) => `<th>${inline(cell)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rows
              .slice(1)
              .map(
                (row) => '<tr>' + row.map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>',
              )
              .join('') +
            '</tbody></table>',
        );
      continue;
    }
    const paragraph = [lines[index++]];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3}\s+|[-*]\s+|\|)/.test(lines[index])
    )
      paragraph.push(lines[index++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('');
}
async function writeDocx(destination, content, checkpoint) {
  const paragraphs = String(content)
    .split(/\r?\n/)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`)
    .join('');
  await writeZip(
    destination,
    [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      },
      {
        name: 'word/document.xml',
        data:
          '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          paragraphs +
          '<w:sectPr/></w:body></w:document>',
      },
    ],
    checkpoint,
  );
}
function printHTML(content, markdown) {
  const body = markdown ? markdownHTML(content) : `<pre>${escape(content)}</pre>`;
  return (
    "<!doctype html><meta charset='utf-8'><style>@page{margin:64px 44px 48px}body{font:16px system-ui,sans-serif;line-height:1.7;margin:0 auto;max-width:760px}h1,h2,h3{line-height:1.3}h1{font-size:28px}h2{font-size:21px;margin-top:32px}h3{font-size:17px;margin-top:24px}ul{padding-left:1.4em}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left}pre{font:inherit;white-space:pre-wrap}</style>" +
    body
  );
}
function srtTime(milliseconds) {
  const ms = Math.max(0, Math.trunc(milliseconds)),
    seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function createExportHandlers(worker) {
  const store = worker.store;
  async function exportMeeting(payload, control) {
    const meeting = store.getMeeting(payload.meeting_id),
      format = String(payload.format).toLowerCase(),
      contentType = payload.content || 'transcript',
      directory = path.join(store.meetingDir(meeting.id), 'exports');
    const title = safeTitle(meeting.title).trim() || meeting.id,
      prefix = safeTitle(
        payload.filename_prefix ||
          {
            transcript: '[字幕]',
            notes: '[会议纪要]',
            analysis: '[原因分析]',
            mynotes: '[我的笔记]',
            audio: '[会议录音]',
          }[contentType] ||
          '',
      );
    if (contentType === 'audio') {
      if (format !== 'wav') throw new Error('Meeting audio is exported in its saved WAV format');
      const playback = meeting.audio.playback,
        track = payload.track || 'mix',
        source =
          track === 'mix' ? playback.mix || playback.mic || playback.system : playback[track];
      if (!source) throw new Error('The selected audio track is empty');
      if (!inside(fs.realpathSync(source), fs.realpathSync(store.meetingDir(meeting.id))))
        throw new Error('Invalid audio path');
      const stem = reserveStem(directory, prefix + title, format),
        destination = path.join(directory, `${stem}.${format}`);
      try {
        await control?.wait();
        await fs.promises.copyFile(source, destination);
        await control?.wait();
      } catch (error) {
        fs.rmSync(destination, { force: true });
        throw error;
      }
      return { path: destination, format };
    }
    if (!['transcript', 'notes', 'analysis', 'mynotes'].includes(contentType))
      throw new Error('Export content must be transcript, notes, analysis, mynotes, or audio');
    if (contentType === 'analysis' && !['md', 'txt', 'docx', 'pdf'].includes(format))
      throw new Error('Unsupported cause analysis format');
    if (!['md', 'txt', 'json', 'srt', 'docx', 'pdf'].includes(format))
      throw new Error('Unsupported text export format');
    const stale = new Set(meeting.correction?.stale_translations || []),
      segments = latestSegments(meeting.segments).map((item) =>
        stale.has(item.id) ? { ...item, translation: null } : item,
      );
    let content;
    if (format === 'json')
      content = JSON.stringify({ ...meeting, segments, current_segments: segments }, null, 2);
    else if (format === 'srt')
      content = segments
        .map(
          (item, index) =>
            `${index + 1}\n${srtTime(item.start_ms)} --> ${srtTime(item.end_ms)}\n${item.speaker_name}: ${item.text}`,
        )
        .join('\n\n');
    else if (['notes', 'mynotes'].includes(contentType)) {
      content = noteBody(meeting, contentType);
    } else if (contentType === 'analysis') {
      content = causeAppendix(meeting, '', format === 'md');
      if (!content) throw new Error('No cause analysis available');
    } else {
      const lines = segments.map(
        (item) =>
          `[${clock(item.start_ms)}] ${item.speaker_name}: ${item.text}` +
          (item.translation ? '\n' + item.translation : ''),
      );
      content = format === 'md' ? `# ${meeting.title}\n\n${lines.join('\n\n')}` : lines.join('\n');
    }
    const stem = reserveStem(directory, prefix + title, format),
      destination = path.join(directory, `${stem}.${format === 'pdf' ? 'print.html' : format}`);
    try {
      await control?.wait();
      if (format === 'docx') await writeDocx(destination, content, () => control?.wait());
      else
        fs.writeFileSync(
          destination,
          format === 'pdf'
            ? printHTML(content, ['notes', 'mynotes'].includes(contentType))
            : content,
        );
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
    return {
      path: destination,
      format: format === 'pdf' ? 'html' : format,
      print_pdf: format === 'pdf',
    };
  }
  async function bundleFiles(payload, control) {
    store.getMeeting(payload.meeting_id, true);
    const folder = fs.realpathSync(store.meetingDir(payload.meeting_id)),
      directory = path.join(folder, 'exports'),
      files = payload.files;
    if (!Array.isArray(files) || files.length < 1 || files.length > 8)
      throw new Error('Choose between one and eight export files');
    const names = new Set(),
      entries = files.map((item) => {
        const source = fs.realpathSync(item.path),
          roots = [resolveExisting(directory), resolveExisting(path.join(folder, 'audio'))];
        if (!inside(source, folder) || !roots.some((root) => inside(source, root)))
          throw new Error('Invalid archive source');
        if (!fs.statSync(source).isFile()) throw new Error('Archive source is unavailable');
        if (
          typeof item.name !== 'string' ||
          !item.name ||
          /[/\\\0]/.test(item.name) ||
          ['.', '..'].includes(item.name)
        )
          throw new Error('Invalid archive filename');
        if (names.has(item.name)) throw new Error('Duplicate archive filename');
        names.add(item.name);
        return { path: source, name: item.name };
      });
    const stem = reserveStem(directory, safeTitle(payload.name || 'Brevia'), 'zip'),
      destination = path.join(directory, stem + '.zip');
    try {
      await writeZip(destination, entries, () => control?.wait());
      return { path: destination, format: 'zip' };
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
  }
  async function bundle(payload, control) {
    const meeting = store.getMeeting(payload.meeting_id),
      title = safeTitle(meeting.title).trim() || meeting.id,
      audio = ['mix', 'mic', 'system'].map((track) => meeting.audio.playback[track]).find(Boolean),
      temporary = [];
    try {
      for (const format of ['md', 'txt'])
        temporary.push((await exportMeeting({ meeting_id: meeting.id, format }, control)).path);
      const files = [
        ...(audio ? [{ path: audio, name: title + '.wav' }] : []),
        ...temporary.map((source) => ({ path: source, name: title + path.extname(source) })),
      ];
      return {
        ...(await bundleFiles({ meeting_id: meeting.id, name: title, files }, control)),
        recording_included: Boolean(audio),
      };
    } finally {
      for (const file of temporary) fs.rmSync(file, { force: true });
    }
  }
  return {
    'meeting.markdown-note': (payload) => {
      const meeting = store.getMeeting(payload.meeting_id, true),
        body = noteBody(meeting, 'notes'),
        appendix = causeAppendix(meeting, body, true);
      return {
        id: meeting.id,
        title: meeting.title,
        deleted_at: meeting.deleted_at,
        markdown: body + (appendix ? '\n\n' + appendix : ''),
      };
    },
    'meeting.export': (payload) =>
      worker.tasks.running(
        'meeting.export',
        payload.meeting_id,
        (control) => exportMeeting(payload, control),
        { concurrent: true },
      ),
    'meeting.bundle': (payload) =>
      worker.tasks.running(
        'meeting.bundle',
        payload.meeting_id,
        (control) => bundle(payload, control),
        { concurrent: true },
      ),
    'meeting.bundle-files': (payload) =>
      worker.tasks.running('meeting.bundle-files', payload.meeting_id, (control) =>
        bundleFiles(payload, control),
      ),
  };
}
module.exports = {
  createExportHandlers,
  causeAppendix,
  noteBody,
  markdownHTML,
  reserveStem,
  srtTime,
};
