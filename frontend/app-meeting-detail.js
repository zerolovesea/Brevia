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
    // 逐句编辑按段落 id 定位：保存时以该 id 写入用户版本，覆盖自动识别结果。
    segmentId: segment.id,
  };
}

/** 返回当前可见的最新字幕：优先最新精修版本，并以手工编辑版本覆盖。
 * @param {object} meeting 会议详情。
 * @param {{ignoreRefined?: boolean}} [options] 忽略精修结果（识别模型已下架时按未精修处理）。 */
function latestTranscriptSegments(meeting, { ignoreRefined = false } = {}) {
  const refined = ignoreRefined ? [] : meeting.segments.filter((segment) => segment.version.startsWith('postprocess'));
  const revision = refined.length ? Math.max(...refined.map((segment) => segment.revision)) : null;
  const base = revision === null ? meeting.segments.filter((segment) => segment.version === 'live') : refined.filter((segment) => segment.revision === revision);
  const latest = new Map();
  [...base, ...meeting.segments.filter((segment) => segment.version === 'user')].forEach((segment) => { if (!latest.has(segment.id) || segment.version === 'user') latest.set(segment.id, segment); });
  return { revision, segments: [...latest.values()].sort((a, b) => a.start_ms - b.start_ms) };
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
    inlineSummaryEditor = null;
    uiData.detail.summaryEditing = false;
    uiData.detail.transcriptEditing = false;
    uiData.detail.transcriptDraft = {};
    detailActiveTab = 'notes';
    uiData.detail.translationTarget = meeting.target_language || '';
  }
  // 产出这场精修稿的识别模型已不可用（已退役，或来自更早版本、已从清单里移除）：
  // 精修结果不再可信，按「未精修」展示实时版本，等用户手动重新精修一次。
  //
  // 退役模型**仍然留在** modelCatalog 里——清单保留它的条目是为了让历史会议的
  // refined_model_id 还能被解析（见 ModelManager.remove_deprecated_models）。所以判据
  // 必须是「在清单里但标了 retired」，不能是「不在清单里」：后者只覆盖"被删除"这条老
  // 路径，对 retired 永远为假，这句降级就再也不会触发。
  const producedBy = meeting.refined_model_id
    ? modelCatalog.find((model) => model.id === meeting.refined_model_id)
    : undefined;
  const modelRetired = Boolean(meeting.refined_model_id)
    && modelCatalog.length > 0
    && (!producedBy || Boolean(producedBy.retired));
  // 展示用的段落集合与保存用的必须是同一份：精修模型退役时这里按实时版本展示，
  // 若保存时又去查精修版本，段落 id 对不上，用户的逐句修改会被静默丢弃。
  uiData.detail.ignoreRefined = modelRetired;
  const { revision, segments: ordered } = latestTranscriptSegments(meeting, { ignoreRefined: modelRetired });
  const speakerNames = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.name]));
  uiData.detail.transcript = ordered.map((segment) => renderSegmentData(segment, true, speakerNames));
  uiData.detail.refinedTranscript = revision === null ? [] : ordered.map((segment) => renderSegmentData(segment, false, speakerNames));
  uiData.detail.refinedFulltext = revision === null ? '' : ordered.map((segment) => `${formatSpeakerName(segment.speaker_name)}：${segment.text}`).join('\n\n');
  uiData.detail.refinedMode = revision === null ? null : refinedModelSupportsTimestamps(meeting.refined_model_id) ? 'timestamps' : 'fulltext';
  uiData.detail.hasRefined = revision !== null;
  // 保存后的字幕才可人工修正：录制中的会议仍在写入实时段落，此时不开放编辑入口。
  const liveMeetingId = meetingActive ? breviaClient?.state.meeting?.id : null;
  uiData.detail.transcriptEditable = meeting.id !== liveMeetingId && ordered.length > 0;
  // 仅切换会议时用会议语言播种：同一会议的后台刷新不得覆盖用户已选的精修语言。
  if (!sameDetail) uiData.detail.language = meeting.language || 'auto';
  uiData.detail.numSpeakers = meeting.num_speakers || null;
  uiData.detail.translationPending = false;
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
    playerAudio.pause(); playerAudio.currentTime = 0; progress.value = 0; appActions.updatePlayerControl(); appActions.renderPlayerTime();
    if (audioPath) window.brevia.audioUrl(audioPath).then((url) => { playerAudio.src = url; }); else { playerAudio.removeAttribute('src'); playerAudio.load(); }
  } else { progress.value = playerAudio.currentTime; appActions.renderPlayerTime(); }
  renderMeetingDetail();
  if (transcriptScrollTop !== undefined) document.querySelector('.transcript-body')?.scrollTo({ top: transcriptScrollTop, behavior: 'instant' });
}
