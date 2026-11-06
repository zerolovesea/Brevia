const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { readWindow, normalized, EMBEDDING_MODEL } = require('./worker-speakers.cjs');

const similarity = (a, b) =>
  a.length === b.length ? a.reduce((sum, value, i) => sum + value * b[i], 0) : -1;

function audioWindow(store, meetingId, track, startMs, endMs) {
  const first = Math.round(startMs * 16),
    last = Math.round(endMs * 16);
  const chunkSamples = store.settings.audio.chunk_seconds * 16000;
  const read = (name) => {
    const pcm = Buffer.alloc((last - first) * 2);
    for (let start = first; start < last; ) {
      const index = Math.floor(start / chunkSamples),
        end = Math.min(last, (index + 1) * chunkSamples);
      const file = store.checkedAudioPath(
        meetingId,
        name + '-' + String(index).padStart(5, '0') + '.wav',
      );
      if (fs.existsSync(file))
        readWindow(file, (start % chunkSamples) / 16, (end - index * chunkSamples) / 16).copy(
          pcm,
          (start - first) * 2,
        );
      start = end;
    }
    return pcm;
  };
  if (track !== 'mix') return read(track);
  const mic = read('mic'),
    system = read('system');
  let a = 0,
    b = 0,
    dot = 0;
  for (let i = 0; i < mic.length; i += 2) {
    const x = mic.readInt16LE(i),
      y = system.readInt16LE(i);
    a += x * x;
    b += y * y;
    dot += x * y;
  }
  // 两路同时有不同人声时不强行归属；会后精修负责重叠说话和准确分段。
  if (Math.min(a, b) > Math.max(a, b) / 4 && dot / Math.sqrt(a * b) < 0.85) return null;
  return a > b ? mic : system;
}

class LiveSpeakers {
  constructor(worker, session) {
    this.worker = worker;
    this.session = session;
    this.queue = [];
    this.centers = [];
    this.nextAt = 0;
    this.sequence = worker.store
      .query('SELECT name FROM speakers WHERE meeting_id=?', session.meeting.id)
      .reduce((n, row) => Math.max(n, Number(/^spk-(\d+)$/.exec(row.name)?.[1] || 0)), 0);
  }
  enqueue(event) {
    if (
      this.closed ||
      this.paused ||
      this.disabled ||
      event.end_ms - event.start_ms < 1500 ||
      !this.worker.models.isReady(EMBEDDING_MODEL)
    )
      return;
    // 队列只持有定位信息，不积累整场录音或字幕正文。
    this.queue.push({
      id: event.segment_id,
      revision: event.revision,
      speaker: event.speaker,
      track: event.track,
      start: event.start_ms,
      end: event.end_ms,
      at: performance.now(),
    });
    if (this.queue.length > 8) this.queue.shift();
    this.schedule();
  }
  schedule() {
    if (
      this.closed ||
      this.paused ||
      this.disabled ||
      this.running ||
      this.timer ||
      !this.queue.length
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.run();
      },
      Math.max(100, this.nextAt - performance.now()),
    );
    this.timer.unref();
  }
  hasPriorityWork() {
    return (
      this.session.queued ||
      this.session.preprocessingQueued ||
      this.session.decoding ||
      this.session.overloaded ||
      this.worker.tasks.hasAny() ||
      [...this.worker.engines].some((engine) => engine !== this.engine && engine.pending?.size)
    );
  }
  async run() {
    if (this.closed || this.paused || this.running || this.disabled) return;
    const worker = this.worker,
      session = this.session;
    if (worker.session !== session) return this.close();
    this.queue = this.queue.filter((item) => performance.now() - item.at < 30000);
    if (!this.queue.length) return;
    if (performance.now() < this.nextAt || this.hasPriorityWork()) {
      this.nextAt = Math.max(this.nextAt, performance.now() + 500);
      this.schedule();
      return;
    }
    const item = this.queue.shift(),
      store = worker.store,
      mid = session.meeting.id;
    this.running = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.controller = new AbortController();
    const started = performance.now();
    let waitingMs = 0;
    try {
      const windows =
        item.end - item.start > 4000
          ? [
              [item.start, item.start + 2000],
              [item.end - 2000, item.end],
            ]
          : [[item.start, item.end]];
      const vectors = [];
      for (const [start, end] of windows) {
        // 前一窗计算期间可能新增字幕任务；每个短窗都让路，等待过期则丢弃。
        while (this.hasPriorityWork()) {
          if (performance.now() - item.at >= 30000) return;
          const waiting = performance.now();
          await delay(100, undefined, { signal: this.controller.signal });
          waitingMs += performance.now() - waiting;
        }
        this.controller.signal.throwIfAborted();
        if (performance.now() - item.at >= 30000) return;
        const pcm = audioWindow(store, mid, item.track, start, end);
        if (!pcm || !pcm.some((value) => value !== 0)) return;
        this.engine ||= worker.newEngine('sherpa-onnx');
        const embedding = worker.speakerEmbedding(
          this.engine,
          pcm,
          {
            signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(3000)]),
            wait: async () => this.controller.signal.throwIfAborted(),
          },
          { threads: 1 },
        );
        await Promise.resolve();
        if (this.engine.child?.pid) {
          try {
            os.setPriority(this.engine.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
          } catch {
            /* 无权调整时仍保持单线程预算。 */
          }
        }
        const vector = await embedding;
        if (!vector) return;
        vectors.push(normalized(vector));
      }
      if (
        this.closed ||
        this.paused ||
        worker.session !== session ||
        this.controller.signal.aborted
      )
        return;
      const threshold = worker.settings.diarization.online_similarity_threshold;
      // 首尾声纹不一致的长段落先保留未知，避免一句中换人后整段贴错姓名。
      if (vectors.length === 2 && similarity(vectors[0], vectors[1]) < threshold) return;
      const vector = normalized(
        vectors[0].map(
          (value, i) => vectors.reduce((sum, row) => sum + row[i], 0) / vectors.length,
        ),
      );
      const profile = store.matchSpeakerProfile(
        vector,
        Math.max(threshold, worker.settings.diarization.voiceprint_similarity_threshold),
      );
      let speaker;
      if (profile && profile.score - profile.runner_up_score >= 0.06) {
        speaker = { id: 'profile-' + profile.id, name: profile.name, profile_id: profile.id };
      } else {
        const scores = this.centers
          .map((center) => ({ center, score: similarity(center.vector, vector) }))
          .sort((a, b) => b.score - a.score);
        if (scores[0]?.score >= threshold) {
          if (scores[1] && scores[0].score - scores[1].score < 0.06) return;
          speaker = scores[0].center;
          speaker.vector = normalized(
            speaker.vector.map((value, i) => value * 0.8 + vector[i] * 0.2),
          );
        } else {
          if (this.centers.length >= worker.settings.refinement.max_auto_speakers) return;
          speaker = { id: 'live-' + randomUUID(), name: 'spk-' + ++this.sequence, vector };
          this.centers.push(speaker);
        }
      }
      const changed = store.transaction(() => {
        const row = store.one(
          "SELECT s.*,p.locked,p.profile_id,p.name FROM segments s LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker WHERE s.meeting_id=? AND s.id=? AND s.version='live'",
          mid,
          item.id,
        );
        if (
          !row ||
          row.user_edited ||
          row.locked ||
          row.profile_id ||
          (row.name && row.name !== row.speaker) ||
          row.revision !== item.revision ||
          row.speaker !== item.speaker ||
          !store.meetingExists(mid)
        )
          return null;
        store.run(
          'INSERT INTO speakers(meeting_id,id,name,profile_id,locked) VALUES(?,?,?,?,0) ON CONFLICT(meeting_id,id) DO NOTHING',
          mid,
          speaker.id,
          speaker.name,
          speaker.profile_id || null,
        );
        store.run(
          "UPDATE segments SET speaker=?,revision=revision+1 WHERE meeting_id=? AND id=? AND version='live'",
          speaker.id,
          mid,
          item.id,
        );
        const name = store.one(
          'SELECT name FROM speakers WHERE meeting_id=? AND id=?',
          mid,
          speaker.id,
        ).name;
        return {
          meeting_id: mid,
          segment_id: item.id,
          revision: row.revision + 1,
          track: row.track,
          start_ms: row.start_ms,
          end_ms: row.end_ms,
          text: row.text,
          translation: row.translation,
          speaker: speaker.id,
          speaker_name: name,
        };
      });
      if (changed) worker.emit('transcript.refined', changed);
    } catch (error) {
      if (!this.controller.signal.aborted) this.disabled = true;
    } finally {
      this.running = false;
      // 至少间隔八秒，并把实际计算时间限制在约 10% 的占空比内。
      this.nextAt =
        performance.now() + Math.max(8000, (performance.now() - started - waitingMs) * 9);
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.engine?.close();
        this.engine = null;
      }, 30000);
      this.idleTimer.unref();
      if (this.closed || this.paused || this.disabled) this.unload();
      else this.schedule();
    }
  }
  unload() {
    clearTimeout(this.timer);
    this.timer = null;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.controller?.abort();
    this.engine?.close();
    this.engine = null;
  }
  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      this.queue = [];
      this.unload();
    }
  }
  close() {
    this.closed = true;
    this.queue = [];
    this.centers = [];
    this.unload();
  }
}
module.exports = { LiveSpeakers, audioWindow };
