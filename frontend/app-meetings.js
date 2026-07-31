/** Maps persisted meetings into the presentation shape used by the meeting library. */
function backendMeeting(item) {
  return {
    id: item.id, tone: 'violet', title: item.title, createdAt: item.created_at,
    durationMs: item.duration_ms, statusCode: item.status, meta: '', category: item.category,
    tags: item.tags, status: {}, deleted: Boolean(item.deleted_at),
    isExample: Boolean(item.is_example), exampleLocale: item.example_locale,
  };
}

let meetingListRequest = 0;
async function refreshBackendMeetings(includeDeleted = activeLibraryNav === 'recently-deleted') {
  const request = ++meetingListRequest;
  const meetings = await window.brevia.meeting.list({ include_deleted: includeDeleted, query: meetingSearch.value.trim() });
  if (request !== meetingListRequest) return;
  uiData.meetings = meetings.map(backendMeeting);
  renderMeetingList();
}
