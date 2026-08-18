function displaySpeakerName(name) {
  // 后端已把命中声纹的 profile-{id} 与非聚类轨道重命名为真实姓名/“Local user”，
  // 这里只把未命中的原始标签（spk-N / mic-spk-N / system-spk-N）转成可读文案。
  const match = /^(?:(mic|system)-)?spk-(\d+)$/.exec(String(name ?? ''));
  if (!match) return name;
  const [, track, index] = match;
  const zh = locale === 'zh';
  const origin = track === 'mic' ? (zh ? '本机' : 'Mic') : track === 'system' ? (zh ? '远端' : 'Remote') : '';
  const speaker = zh ? `说话人 ${index}` : `Speaker ${index}`;
  return origin ? `${origin}${zh ? '' : ' '}${speaker}` : speaker;
}

function applyBackendDetail(meeting) {
  const sameDetail = currentMeetingDetail?.id === meeting.id;
  const transcriptScrollTop = sameDetail ? document.querySelector('.transcript-body')?.scrollTop : undefined;
  const sameMeeting = sameDetail && Boolean(playerAudio.src);
  currentMeetingDetail = meeting;
  const refined = meeting.segments.filter((segment) => segment.version.startsWith('postprocess'));
  const revision = refined.length ? Math.max(...refined.map((segment) => segment.revision)) : null;
  const base = revision === null ? meeting.segments.filter((segment) => segment.version === 'live') : refined.filter((segment) => segment.revision === revision);
  const latest = new Map();
  [...base, ...meeting.segments.filter((segment) => segment.version === 'user')].forEach((segment) => { if (!latest.has(segment.id) || segment.version === 'user') latest.set(segment.id, segment); });
  const speakerNames = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.name]));
  uiData.detail.transcript = [...latest.values()].sort((a, b) => a.start_ms - b.start_ms).map((segment) => {
    const overlapSpeakers = [...new Set(segment.word_timestamps.flatMap((word) => word.overlap_speakers || []))];
    return { time: `${String(Math.floor(segment.start_ms / 60000)).padStart(2, '0')}:${String(Math.floor(segment.start_ms / 1000) % 60).padStart(2, '0')}`, seconds: Math.floor(segment.start_ms / 1000), startSeconds: segment.start_ms / 1000, endSeconds: segment.end_ms / 1000, speaker: { name: displaySpeakerName(segment.speaker_name), segmentId: segment.id, editing: segment.id === editingSegmentSpeakerId, overlapNames: overlapSpeakers.length > 1 ? overlapSpeakers.map((speaker) => displaySpeakerName(speakerNames.get(speaker) || speaker)) : [] }, text: segment.text, translation: segment.translation };
  });
  uiData.detail.refinedTranscript = revision === null ? [] : [...latest.values()].sort((a, b) => a.start_ms - b.start_ms).map((segment) => ({ speaker: { name: displaySpeakerName(segment.speaker_name) }, text: segment.text }));
  const summary = meeting.summary?.data;
  uiData.detail.summary = summary?.markdown ? { markdown: summary.markdown, hasFull: true } : { title: '', sections: [], empty: true };
  document.querySelector('#detail-view .detail-head h1').textContent = meeting.title;
  progress.max = Math.max(1, Math.ceil(meeting.duration_ms / 1000));
  const audioPath = meeting.audio.playback.mix || meeting.audio.playback.mic || meeting.audio.playback.system;
  if (!sameMeeting) {
    followPlaybackTranscript = true;
    playbackStarted = false;
    playerAudio.pause(); playerAudio.currentTime = 0; progress.value = 0; updatePlayerControl(); renderPlayerTime();
    if (audioPath) window.brevia.audioUrl(audioPath).then((url) => { playerAudio.src = url; }); else { playerAudio.removeAttribute('src'); playerAudio.load(); }
  } else { progress.value = playerAudio.currentTime; renderPlayerTime(); }
  renderMeetingDetail();
  if (transcriptScrollTop !== undefined) document.querySelector('.transcript-body')?.scrollTo({ top: transcriptScrollTop, behavior: 'instant' });
}
