/** 把 segment 转为可渲染数据（保留时间戳，供播放定位与逐句显示）。@param {object} segment 后端段落。@param {Map} speakerNames 说话人名称表。@returns {object} 渲染数据。 */
function renderSegmentData(segment, speakerNames) {
  const overlapSpeakers = [
    ...new Set((segment.word_timestamps || []).flatMap((word) => word.overlap_speakers || [])),
  ];
  return {
    time: formatMeetingTime(segment.start_ms),
    seconds: Math.floor(segment.start_ms / 1000),
    startSeconds: segment.start_ms / 1000,
    endSeconds: segment.end_ms / 1000,
    speaker: {
      id: segment.speaker,
      name: formatSpeakerName(segment.speaker_name),
      overlapNames:
        overlapSpeakers.length > 1
          ? overlapSpeakers.map((speaker) =>
              formatSpeakerName(speakerNames.get(speaker) || speaker),
            )
          : [],
    },
    text: segment.text,
    track: segment.track,
    version: segment.version,
    revision: segment.revision,
    userEdited: Boolean(segment.user_edited),
    replacementHighlight: currentMeetingDetail?.correction?.highlights?.[segment.id] || '',
    translationStale: Boolean(
      currentMeetingDetail?.correction?.stale_translations?.includes(segment.id),
    ),
    translation: segment.translation,
    translationPending: isSegmentTranslationPending(currentMeetingDetail?.id, segment.id),
    // 旧分段只供回看；翻译接口始终处理当前稿，避免把已精修的旧段重新写入。
    translationAvailable: (
      currentMeetingDetail?.current_segments ||
      currentMeetingDetail?.segments ||
      []
    ).some(
      (current) =>
        current.id === segment.id &&
        current.text === segment.text &&
        current.version === segment.version &&
        current.revision === segment.revision,
    ),
    // 逐句编辑按段落 id 定位：保存时以该 id 写入用户版本，覆盖自动识别结果。
    segmentId: segment.id,
  };
}

/** 展示、编辑和翻译均使用后端选定的当前逐字稿。 */
function latestTranscriptSegments(meeting) {
  return {
    revision: meeting.transcript_revision ?? null,
    segments: meeting.current_segments || meeting.segments,
  };
}

function meetingPlaybackPath(meeting) {
  return (
    meeting?.audio?.playback?.mix ||
    meeting?.audio?.playback?.mic ||
    meeting?.audio?.playback?.system
  );
}

function applyBackendDetail(meeting) {
  document.querySelector('#detail-view .detail-title .eyebrow').textContent =
    meeting.tags?.includes('手机麦克风')
      ? t('手机麦克风')
      : meeting.tags?.includes('手机录音')
        ? t('手机录音')
        : t('本地会议');
  const audioPath = meetingPlaybackPath(meeting);
  const sameDetail = currentMeetingDetail?.id === meeting.id;
  const transcriptScrollTop = sameDetail
    ? document.querySelector('.transcript-body')?.scrollTop
    : undefined;
  const sameMeeting =
    sameDetail &&
    Boolean(playerAudio.src) &&
    meetingPlaybackPath(currentMeetingDetail) === audioPath;
  currentMeetingDetail = meeting;
  // 仅在切换会议时重置详情页交互状态（激活 tab、精修状态、笔记编辑）；
  // 同一会议的后端刷新不得覆盖用户正在进行的操作。
  if (!sameDetail) {
    uiData.detail.refineState = 'idle';
    uiData.detail.notesEditing = false;
    uiData.detail.notesSaveState = 'saved';
    uiData.detail.summarySaveState = 'saved';
    detailNotesEditor?.destroy();
    detailNotesEditor = null;
    inlineSummaryEditor?.destroy();
    inlineSummaryEditor = null;
    uiData.detail.summaryDraft = undefined;
    uiData.detail.summaryEditing = false;
    uiData.detail.transcriptEditing = false;
    uiData.detail.transcriptSaveState = 'saved';
    uiData.detail.transcriptEditEntries = undefined;
    uiData.detail.transcriptErrors = {};
    uiData.detail.transcriptDraft = {};
    detailActiveTab = 'summary';
    uiData.detail.transcriptVersion = 'refined';
    uiData.detail.transcriptSearch = '';
    uiData.detail.transcriptSpeaker = '';
    uiData.detail.translationTarget = meeting.target_language || '';
  }
  const { revision, segments: ordered } = latestTranscriptSegments(meeting);
  const speakerNames = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.name]));
  const original =
    meeting.original_segments ||
    meeting.segments?.filter((segment) => segment.version === 'live') ||
    [];
  uiData.detail.hasOriginalTranscript = original.length > 0 || revision === null;
  if (!uiData.detail.hasOriginalTranscript) uiData.detail.transcriptVersion = 'refined';
  // 没有精修版本时只有当前稿；其中可能同时含有实时段落和人工修订段落。
  uiData.detail.originalTranscript = (revision === null ? ordered : original).map((segment) =>
    renderSegmentData(segment, speakerNames),
  );
  uiData.detail.transcript = ordered.map((segment) => renderSegmentData(segment, speakerNames));
  uiData.detail.refinedTranscript =
    revision === null ? [] : ordered.map((segment) => renderSegmentData(segment, speakerNames));
  uiData.detail.refinedFulltext =
    revision === null
      ? ''
      : ordered
          .map((segment) => `${formatSpeakerName(segment.speaker_name)}：${segment.text}`)
          .join('\n\n');
  uiData.detail.refinedMode =
    revision === null
      ? null
      : refinedModelSupportsTimestamps(meeting.transcript_model_id)
        ? 'timestamps'
        : 'fulltext';
  uiData.detail.hasRefined = revision !== null;
  // 精修模型：`refinedModelApplied` 是产出当前稿子的模型（精修完成后由后端写回会议记录），
  // `refinedModelId` 是「下一次精修用哪个」的选择态，`refinedModelPinned` 表示用户在菜单里
  // 显式改过。只在切换会议时播种选择，后台刷新不得覆盖用户刚改的选择。
  uiData.detail.refinedModelApplied = meeting.transcript_model_id || null;
  if (!sameDetail) {
    const options = refinedModelOptions(meeting.language || 'auto');
    uiData.detail.refinedModelId = options.some(([id]) => id === meeting.refined_model_id)
      ? meeting.refined_model_id
      : defaultRefinedModelId(meeting.language || 'auto');
    uiData.detail.refinedModelPinned = false;
  }
  // 保存后的字幕才可人工修正：录制中的会议仍在写入实时段落，此时不开放编辑入口。
  const liveMeetingId = meetingActive ? breviaClient?.state.meeting?.id : null;
  uiData.detail.transcriptEditable = meeting.id !== liveMeetingId && ordered.length > 0;
  // 仅切换会议时用会议语言播种：同一会议的后台刷新不得覆盖用户已选的精修语言。
  if (!sameDetail) uiData.detail.language = meeting.language || 'auto';
  // 精修菜单里「识别模型」的候选：与准备页同一个 refinedModelOptions，按当前精修语言算。
  // 语言在菜单里被改动时会由 app.js 的 refine-language 分支重算，所以这里每次刷新都覆盖。
  uiData.detail.refinedModelAppliedName =
    modelCatalog.find((model) => model.id === uiData.detail.refinedModelApplied)?.name || '';
  uiData.detail.refinedModelOptions = refinedModelOptions(uiData.detail.language);
  uiData.detail.numSpeakers = meeting.num_speakers || null;
  uiData.detail.translationPending = isMeetingTranslationPending(meeting.id);
  // 编辑中的笔记以本地草稿为准，不覆盖；非编辑状态同步服务器最新值。
  if (!sameDetail || !uiData.detail.notesEditing) uiData.detail.notes = meeting.notes || '';
  const summary = meeting.summary?.data;
  uiData.detail.acceptedClaims = meeting.accepted_claims || [];
  const summaryBlocked = meetingActive;
  const summaryGenerating = summaryGeneratingMeetingId === meeting.id;
  uiData.detail.summary = summary?.markdown
    ? {
        ...summary,
        hasFull: true,
        blocked: summaryBlocked,
        generating: summaryGenerating,
      }
    : {
        title: '',
        sections: [],
        empty: true,
        blocked: summaryBlocked,
        generating: summaryGenerating,
      };
  uiData.detail.summary.waitingModels =
    'summaryWaitState' in appActions && appActions.summaryWaitState(meeting.id);
  const heading = document.querySelector('#detail-view .detail-head h1');
  heading.textContent = meeting.title;
  heading.title = meeting.title;
  document.querySelector('#detail-view > .back').title = t('返回会议库');
  const date = meeting.meeting_date || (!('meeting_date' in meeting) && meeting.created_at);
  const dateLabel = date
    ? new Date(meeting.meeting_date ? date + 'T12:00:00' : date).toLocaleDateString(
        BreviaI18n.localeTag(locale),
        { year: 'numeric', month: '2-digit', day: '2-digit' },
      )
    : t('确认会议日期');
  const dateField =
    'meeting_date' in meeting
      ? `<label class="review-date" title="${escapeHtml(t('确认会议日期'))}">${escapeHtml(dateLabel)}<input type="date" data-review-date value="${escapeHtml(meeting.meeting_date || '')}" aria-label="${escapeHtml(t('确认会议日期'))}" /></label>`
      : escapeHtml(dateLabel);
  document.querySelector('#detail-meta').innerHTML =
    `<span>${dateField}</span><span>${interfaceIcon('clock')}${Math.max(1, Math.round((meeting.duration_ms || 0) / 60000))} ${escapeHtml(t('分钟'))}</span><span>${interfaceIcon('folder')}${escapeHtml(getWorkspaceName(meeting.workspace_id || ''))}</span>`;
  progress.max = Math.max(1, Math.ceil(meeting.duration_ms / 1000));
  if (!sameMeeting) {
    followPlaybackTranscript = true;
    playbackStarted = false;
    playerAudio.pause();
    playerAudio.currentTime = 0;
    progress.value = 0;
    appActions.updatePlayerControl();
    appActions.renderPlayerTime();
    playerAudio.removeAttribute('src');
    playerAudio.load();
    if (audioPath)
      window.brevia
        .audioUrl(audioPath)
        .then((url) => {
          if (
            currentMeetingDetail?.id !== meeting.id ||
            meetingPlaybackPath(currentMeetingDetail) !== audioPath
          )
            return;
          playerAudio.src = url;
        })
        .catch((error) => {
          if (currentMeetingDetail?.id === meeting.id)
            appActions.showToast(error.message, undefined, 'error');
        });
  } else {
    progress.value = playerAudio.currentTime;
    appActions.renderPlayerTime();
  }
  renderMeetingDetail();
  if (transcriptScrollTop !== undefined)
    document
      .querySelector('.transcript-body')
      ?.scrollTo({ top: transcriptScrollTop, behavior: 'instant' });
}
