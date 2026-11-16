const { uploadSchema, MAX_BYTES } = require('../cloudflare/share/schema.cjs');
const config = require('./cloud-share-config.json');
function shareSnapshot(meeting, language) {
  if (['recording', 'paused'].includes(meeting.status))
    throw new Error('End the meeting before sharing');
  const speakerNames = new Map(
    (meeting.speakers || []).map((speaker) => [speaker.id, speaker.name]),
  );
  const segments = meeting.current_segments ?? meeting.segments ?? [];
  const byId = new Map(segments.map((item) => [item.id, item]));
  const source = (item) => {
    const current = item.segment_id ? byId.get(item.segment_id) : null;
    const speaker =
      current && current.text === item.text && current.start_ms === item.start_ms ? current : item;
    return {
      text: String(item.text || ''),
      speaker_id:
        speaker.speaker === 'spk-1' &&
        speaker.speaker_name === 'Unknown speaker' &&
        !speakerNames.has(speaker.speaker)
          ? ''
          : speaker.speaker
            ? String(speaker.speaker)
            : undefined,
      speaker: String(
        speakerNames.get(speaker.speaker) || speaker.speaker_name || speaker.speaker || '',
      ),
      start_ms: Math.max(0, Number(item.start_ms) || 0),
    };
  };
  const staleTranslations = new Set(meeting.correction?.stale_translations || []);
  return {
    title: meeting.title || 'Brevia',
    language,
    meeting_date: String(meeting.meeting_date ?? meeting.created_at ?? ''),
    duration_ms: Math.max(0, Number(meeting.duration_ms) || 0),
    markdown: meeting.summary?.data?.markdown || '',
    // 完整详情另带当前稿；meeting.get 返回的 compact 详情已经完成选版。
    transcript: segments.map((item) => ({
      ...source(item),
      translation: staleTranslations.has(item.id)
        ? undefined
        : item.translation?.trim() || undefined,
    })),
    claims: (meeting.summary?.data?.claims || [])
      .filter((item) => item.kind === 'cause' && !item.detached)
      .map((item) => ({
        id: item.id,
        text: item.text,
        section: item.section || '',
        status: ['missing', 'changed', 'thin', 'supported'].includes(item.status)
          ? item.status
          : undefined,
        sources: (item.sources || []).map(source),
      })),
  };
}
async function uploadShare(
  meeting,
  days,
  language,
  password,
  endpoint = process.env.BREVIA_SHARE_URL || config.url,
) {
  if (!endpoint) throw new Error('Cloud sharing is not configured (BREVIA_SHARE_URL)');
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  )
    throw new Error('Share service requires HTTPS');
  const body = JSON.stringify(
    uploadSchema.parse({ days, password, snapshot: shareSnapshot(meeting, language) }),
  );
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Document exceeds 4 MiB');
  const response = await fetch(new URL('/api/shares', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  // 响应也有上限，避免错误页或失控服务占满桌面内存。
  const reader = response.body.getReader();
  let bytes = 0,
    result = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new Error('Invalid share service response');
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) throw new Error(`Cloud sharing failed (${response.status})`);
  const data = JSON.parse(result);
  const link = new URL(data.url);
  if (
    link.origin !== url.origin ||
    !/^\/s\/[a-f0-9]{32}$/.test(link.pathname) ||
    !Number.isSafeInteger(data.expiresAt)
  )
    throw new Error('Invalid share service response');
  return { url: link.href, expiresAt: data.expiresAt };
}
module.exports = { shareSnapshot, uploadShare };
