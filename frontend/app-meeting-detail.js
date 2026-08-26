/** 把 segment 转为可渲染数据（保留时间戳，供播放定位与逐句显示）。@param {object} segment 后端段落。@param {boolean} editable 是否允许改名。@param {Map} speakerNames 说话人名称表。@returns {object} 渲染数据。 */
function renderSegmentData(segment, editable, speakerNames) {
  const overlapSpeakers = [...new Set((segment.word_timestamps || []).flatMap((word) => word.overlap_speakers || []))];
  return {
    time: formatMeetingTime(segment.start_ms),
    seconds: Math.floor(segment.start_ms / 1000),
    startSeconds: segment.start_ms / 1000,
    endSeconds: segment.end_ms / 1000,
    speaker: {
      name: formatSpeakerName(segment.speaker_name),
      segmentId: editable ? segment.id : undefined,
      editing: editable && segment.id === editingSegmentSpeakerId,
      overlapNames: overlapSpeakers.length > 1 ? overlapSpeakers.map((speaker) => formatSpeakerName(speakerNames.get(speaker) || speaker)) : [],
    },
    text: segment.text,
    translation: segment.translation,
  };
}

function applyBackendDetail(meeting) {
  const sameDetail = currentMeetingDetail?.id === meeting.id;
  const transcriptScrollTop = sameDetail ? document.querySelector('.transcript-body')?.scrollTop : undefined;
  const sameMeeting = sameDetail && Boolean(playerAudio.src);
  currentMeetingDetail = meeting;
  // 仅在切换会议时重置详情页交互状态（激活 tab、精修状态、笔记编辑）；
  // 同一会议的后端刷新不得覆盖用户正在进行的操作。
  if (!sameDetail) {
    uiData.detail.refineState = 'idle';
    uiData.detail.notesEditing = false;
    detailNotesEditor = null;
    detailActiveTab = 'notes';
    detailTranscriptView = 'refined';
  }
  const refined = meeting.segments.filter((segment) => segment.version.startsWith('postprocess'));
  const revision = refined.length ? Math.max(...refined.map((segment) => segment.revision)) : null;
  const base = revision === null ? meeting.segments.filter((segment) => segment.version === 'live') : refined.filter((segment) => segment.revision === revision);
  const latest = new Map();
  [...base, ...meeting.segments.filter((segment) => segment.version === 'user')].forEach((segment) => { if (!latest.has(segment.id) || segment.version === 'user') latest.set(segment.id, segment); });
  const speakerNames = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.name]));
  const ordered = [...latest.values()].sort((a, b) => a.start_ms - b.start_ms);
  uiData.detail.transcript = ordered.map((segment) => renderSegmentData(segment, true, speakerNames));
  uiData.detail.refinedTranscript = revision === null ? [] : ordered.map((segment) => renderSegmentData(segment, false, speakerNames));
  uiData.detail.refinedFulltext = revision === null ? '' : ordered.map((segment) => `${formatSpeakerName(segment.speaker_name)}：${segment.text}`).join('\n\n');
  uiData.detail.refinedMode = revision === null ? null : refinedModelSupportsTimestamps(meeting.refined_model_id) ? 'timestamps' : 'fulltext';
  uiData.detail.hasRefined = revision !== null;
  uiData.detail.refinedModelId = meeting.refined_model_id || '';
  uiData.detail.numSpeakers = meeting.num_speakers || null;
  // 编辑中的笔记以本地草稿为准，不覆盖；非编辑状态同步服务器最新值。
  if (!sameDetail || !uiData.detail.notesEditing) uiData.detail.notes = meeting.notes || '';
  const summary = meeting.summary?.data;
  const summaryBlocked = meetingActive;
  const summaryGenerating = summaryGeneratingMeetingId === meeting.id;
  uiData.detail.summary = summary?.markdown ? { markdown: summary.markdown, hasFull: true, blocked: summaryBlocked, generating: summaryGenerating } : { title: '', sections: [], empty: true, blocked: summaryBlocked, generating: summaryGenerating };
  document.querySelector('#detail-view .detail-head h1').textContent = meeting.title;
  const metaParts = [];
  if (meeting.created_at) {
    metaParts.push(new Date(meeting.created_at).toLocaleDateString(BreviaI18n.localeTag(locale), { year: 'numeric', month: '2-digit', day: '2-digit' }));
  }
  metaParts.push(`${Math.max(1, Math.round((meeting.duration_ms || 0) / 60000))} ${t('分钟')}`);
  metaParts.push(`${Number(meeting.speaker_count || 0)} ${t('位参与者')}`);
  document.querySelector('#detail-meta').textContent = metaParts.join(' · ');
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
