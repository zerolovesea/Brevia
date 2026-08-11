let dualTrackAudios = [];

function renderDualTrackPanel(meeting) {
  dualTrackAudios.forEach((audio) => { audio.pause(); audio.removeAttribute('src'); });
  dualTrackAudios = [];
  const panel = document.querySelector('[data-detail-panel="tracks"]');
  if (!panel) return;
  const tracks = [['vocals', t('人声轨'), meeting.audio.playback.vocals], ['accompaniment', t('非人声轨'), meeting.audio.playback.accompaniment]].filter(([, , path]) => path);
  if (!tracks.length) {
    panel.innerHTML = `<div class="dual-track-empty"><p>${t('完成声源分离后，人声与非人声录音会显示在这里。')}</p><button class="secondary" type="button" data-separate-from-tracks>${t('开始声源分离')}</button></div>`;
    return;
  }
  panel.innerHTML = tracks.map(([id, label]) => `<section class="track-player" data-track-player="${id}"><header><b>${label}</b><small>WAV</small></header><div><button class="play" type="button" aria-label="${t('播放录音')}">▶</button><time>00:00</time><input type="range" min="0" max="1" value="0" aria-label="${label}" /></div></section>`).join('');
  tracks.forEach(async ([id, , path]) => {
    const root = panel.querySelector(`[data-track-player="${id}"]`);
    const button = root.querySelector('.play');
    const range = root.querySelector('input');
    const time = root.querySelector('time');
    const audio = new Audio();
    dualTrackAudios.push(audio);
    try { audio.src = await window.brevia.audioUrl(path); } catch (error) { showToast(error.message); return; }
    const update = () => { range.value = audio.currentTime; time.textContent = formatMeetingTime(audio.currentTime * 1000); button.textContent = audio.paused ? '▶' : '❚❚'; button.classList.toggle('is-playing', !audio.paused); };
    button.addEventListener('click', async () => { dualTrackAudios.filter((item) => item !== audio).forEach((item) => item.pause()); if (audio.paused) await audio.play(); else audio.pause(); update(); });
    range.addEventListener('input', () => { audio.currentTime = Number(range.value); update(); });
    audio.addEventListener('loadedmetadata', () => { range.max = audio.duration || 1; });
    ['timeupdate', 'play', 'pause', 'ended'].forEach((event) => audio.addEventListener(event, update));
  });
}

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

async function startSeparation() {
  const meetingId = breviaClient?.state.selectedMeetingId;
  if (!window.brevia || !meetingId) return;
  if (!modelPaths.has('spleeter-2stems-fp16')) {
    queueModelTask('meeting.separate', { meeting_id: meetingId }, ['spleeter-2stems-fp16']);
    requiredModelIds.add('spleeter-2stems-fp16'); renderRequiredModelsCard(); return;
  }
  showSeparationProgress(0, 100);
  try {
    const result = await window.brevia.meeting.separate({ meeting_id: meetingId });
    if (result?.model_required) result.model_required.forEach((id) => requiredModelIds.add(id));
  } catch (error) { document.querySelector('#separation-progress')?.remove(); showToast(error.message); }
}
