/** Maps persisted meetings into the presentation shape used by the meeting library. */
function backendMeeting(item) {
  return {
    id: item.id, tone: 'violet', title: item.title, createdAt: item.created_at,
    durationMs: item.duration_ms, statusCode: item.status, meta: '', category: item.category,
    tags: item.tags, status: {}, deleted: Boolean(item.deleted_at),
    isExample: Boolean(item.is_example), exampleLocale: item.example_locale,
  };
}

const meetingCacheKey = 'brevia-meetings-v1';
try {
  const cachedMeetings = JSON.parse(localStorage.getItem(meetingCacheKey) || '[]');
  if (Array.isArray(cachedMeetings)) uiData.meetings = cachedMeetings;
} catch { localStorage.removeItem(meetingCacheKey); }

function cacheMeetingList() {
  if (!window.brevia || activeLibraryNav !== 'all-meetings' || meetingSearch.value.trim()) return;
  try { localStorage.setItem(meetingCacheKey, JSON.stringify(uiData.meetings.filter(({ deleted }) => !deleted))); }
  catch { /* The backend remains authoritative when browser storage is unavailable or full. */ }
}

function syncBackendMeeting(item) {
  if (!item?.id) return;
  const meeting = backendMeeting(item);
  const index = uiData.meetings.findIndex(({ id }) => id === meeting.id);
  const visible = activeLibraryNav === 'recently-deleted' ? meeting.deleted : !meeting.deleted;
  if (!visible) {
    if (index >= 0) uiData.meetings.splice(index, 1);
    renderMeetingList();
    return;
  }
  if (index < 0) uiData.meetings.unshift(meeting);
  else uiData.meetings[index] = meeting;
  renderMeetingList();
}

let meetingListRequest = 0;
async function refreshBackendMeetings(includeDeleted = activeLibraryNav === 'recently-deleted') {
  const request = ++meetingListRequest;
  const meetings = await window.brevia.meeting.list({ include_deleted: includeDeleted, query: meetingSearch.value.trim() });
  if (request !== meetingListRequest) return;
  uiData.meetings = meetings.map(backendMeeting);
  renderMeetingList();
}
