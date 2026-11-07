/** 将持久化的会议数据映射为会议列表所需的展示结构。 */
function backendMeeting(item) {
  const workspaceId = item.is_example ? '' : item.workspace_id || '';
  return {
    id: item.id,
    tone: 'violet',
    title: item.title,
    createdAt: item.created_at,
    durationMs: item.duration_ms,
    statusCode: item.status,
    meta: '',
    workspaceId: workspaceId,
    workspace:
      workspaceId && typeof getWorkspaceName === 'function'
        ? {
            name: getWorkspaceName(workspaceId),
          }
        : null,
    tags: item.tags,
    status: {},
    deleted: Boolean(item.deleted_at),
    isExample: Boolean(item.is_example),
    exampleLocale: item.example_locale,
    hasSummary: Boolean(item.has_summary),
    speakerCount: Number(item.speaker_count || 0),
  };
}

const meetingCacheKey = 'brevia-meetings-v1';
const meetingCacheMaxAgeMs = 5 * 60 * 1000;
try {
  const cached = JSON.parse(localStorage.getItem(meetingCacheKey) || 'null');
  if (cached?.savedAt > Date.now() - meetingCacheMaxAgeMs && Array.isArray(cached.meetings))
    uiData.meetings = cached.meetings;
  else localStorage.removeItem(meetingCacheKey);
} catch {
  localStorage.removeItem(meetingCacheKey);
}

function cacheMeetingList() {
  if (!window.brevia || activeLibraryNav !== 'all-meetings') return;
  try {
    localStorage.setItem(
      meetingCacheKey,
      JSON.stringify({
        savedAt: Date.now(),
        meetings: uiData.meetings.filter(({ deleted }) => !deleted),
      }),
    );
  } catch {
    /* 当浏览器存储不可用或已满时，以后端数据为准。 */
  }
}

function syncBackendMeeting(item) {
  if (!item?.id) return;
  const meeting = backendMeeting(item);
  const index = uiData.meetings.findIndex(({ id }) => id === meeting.id);
  const visible = activeLibraryNav === 'recently-deleted' ? meeting.deleted : !meeting.deleted;
  if (!visible) {
    if (index >= 0) uiData.meetings.splice(index, 1);
    appActions.renderMeetingList();
    return;
  }
  if (index < 0) uiData.meetings.unshift(meeting);
  else uiData.meetings[index] = meeting;
  appActions.renderMeetingList();
}

let meetingListRequest = 0;
async function refreshBackendMeetings(includeDeleted = activeLibraryNav === 'recently-deleted') {
  const request = ++meetingListRequest;
  const meetings = await window.brevia.meeting.list({ include_deleted: includeDeleted });
  if (request !== meetingListRequest) return;
  uiData.meetings = meetings.map(backendMeeting);
  appActions.renderMeetingList();
}

let libraryMetrics;
let metricsRefreshTimer;

function renderLibraryMetrics() {
  if (!libraryMetrics) return;
  document.querySelector('[data-library-metrics]').innerHTML = renderLibraryMetricsItems(
    libraryMetrics,
    BreviaI18n.localeTag(locale),
  );
}

// 在内容落盘后合并刷新，实时字幕逐段到达时不扫描整个会议库。
function scheduleLibraryMetrics() {
  if (!window.brevia?.metrics?.record) return;
  clearTimeout(metricsRefreshTimer);
  const timer = setTimeout(async () => {
    try {
      const totals = await window.brevia.metrics.record({});
      if (!totals || timer !== metricsRefreshTimer) return;
      libraryMetrics = totals;
      renderLibraryMetrics();
    } catch (error) {
      console.warn('Unable to read library metrics', error);
    }
  }, 500);
  metricsRefreshTimer = timer;
}
