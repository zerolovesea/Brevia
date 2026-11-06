const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
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
  hasModel() {
    return this.worker.models.isReady(EMBEDDING_MODEL);
  }
  enqueue(event, voiceSpans = []) {
    if (this.closed || this.paused || this.disabled || !voiceSpans.length || !this.hasModel())
      return;
    // 采用 VAD 原始语音范围；不足一秒或证据过多的识别单元保持未知。
    // 每轮只计算一个至多四秒的窗口，后续证据仍受八秒预算和任务时效约束。
    const windows = [];
    let learn = true;
    for (const span of voiceSpans) {
      const start = Math.max(event.start_ms, span.start),
        end = Math.min(event.end_ms, span.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1000) return;
      learn &&= end - start >= 2000;
      windows.push([start, Math.min(start + 4000, end)]);
      if (end - start > 4000) windows.push([end - 4000, end]);
      if (windows.length > 4) return;
    }
    // 队列只保留定位与少量向量，不持有 PCM 或字幕正文。
    this.queue.push({
      id: event.segment_id,
      revision: event.revision,
      speaker: event.speaker,
      track: event.track,
      windows,
      vectors: [],
      learn,
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
    try {
      if (!this.editable(item)) return;
      const [start, end] = item.windows[item.vectors.length];
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
      item.vectors.push(normalized(vector));
      if (
        this.closed ||
        this.paused ||
        worker.session !== session ||
        this.controller.signal.aborted ||
        performance.now() - item.at >= 30000
      )
        return;
      if (item.vectors.length < item.windows.length) {
        this.queue.unshift(item);
        if (this.queue.length > 8) this.queue.pop();
        return;
      }
      const changed = store.transaction(() => {
        const row = this.editable(item);
        if (!row) return null;
        const candidate = this.identify(item);
        if (!candidate) return null;
        const { speaker } = candidate;
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
          candidate,
          event: {
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
          },
        };
      });
      if (changed) {
        this.learn(changed.candidate, item);
        worker.emit('transcript.refined', changed.event);
      }
    } catch (error) {
      if (!this.controller.signal.aborted) this.disabled = true;
    } finally {
      this.running = false;
      // 至少间隔八秒，并把实际计算时间限制在约 10% 的占空比内。
      this.nextAt = performance.now() + Math.max(8000, (performance.now() - started) * 9);
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
  editable(item) {
    const store = this.worker.store,
      mid = this.session.meeting.id;
    const row = store.one(
      "SELECT s.*,p.locked,p.profile_id,p.name FROM segments s LEFT JOIN speakers p ON p.meeting_id=s.meeting_id AND p.id=s.speaker WHERE s.meeting_id=? AND s.id=? AND s.version='live'",
      mid,
      item.id,
    );
    return row &&
      !row.user_edited &&
      !row.locked &&
      !row.profile_id &&
      (!row.name || row.name === row.speaker) &&
      row.revision === item.revision &&
      row.speaker === item.speaker &&
      store.meetingExists(mid)
      ? row
      : null;
  }
  identify(item) {
    const store = this.worker.store,
      threshold = this.worker.settings.diarization.online_similarity_threshold;
    const rows = store.query(
      'SELECT id,name,profile_id FROM speakers WHERE meeting_id=?',
      this.session.meeting.id,
    );
    const candidates = [];
    for (const profile of store.query('SELECT id,name,embedding FROM speaker_profiles')) {
      let vector;
      try {
        vector = normalized(JSON.parse(profile.embedding));
      } catch {
        continue;
      }
      const existing = rows.find((row) => row.profile_id === profile.id);
      const defaultId = 'profile-' + profile.id;
      candidates.push({
        key: 'profile-' + profile.id,
        speaker: {
          // 默认 ID 可能已被用户改绑到另一人，不能用冲突忽略覆盖其身份含义。
          id:
            existing?.id ||
            (rows.some((row) => row.id === defaultId) ? 'live-' + randomUUID() : defaultId),
          name: existing?.name || profile.name,
          profile_id: profile.id,
        },
        vector,
        threshold: Math.max(
          threshold,
          this.worker.settings.diarization.voiceprint_similarity_threshold,
        ),
      });
    }
    for (const center of this.centers) {
      const existing = rows.find((row) => row.id === center.id);
      // 人工绑定后以注册声纹为准，不把绑定前可能错误的临时中心带入该身份。
      if (existing?.profile_id) continue;
      candidates.push({
        key: center.id,
        speaker: { id: center.id, name: existing?.name || center.name },
        vector: center.vector,
        center,
        threshold,
      });
    }
    // 注册身份与未绑定临时中心共同排序；次优必须是另一个人。
    const matches = [];
    for (const vector of item.vectors) {
      const scores = candidates
        .map((candidate) => ({
          candidate,
          score: similarity(candidate.vector, vector),
        }))
        .sort((a, b) => b.score - a.score);
      const first = scores[0];
      if (!first || first.score < threshold) {
        matches.push(null);
        continue;
      }
      if (scores[1] && first.score - scores[1].score < 0.06) return null;
      // 接近已知人但尚未通过其注册门槛时保持未知，不能另建一个重复身份。
      if (first.score < first.candidate.threshold) return null;
      matches.push(first.candidate);
    }
    if (matches.some(Boolean))
      return matches.every((match) => match?.key === matches[0]?.key) ? matches[0] : null;
    if (!item.learn || this.centers.length >= this.worker.settings.refinement.max_auto_speakers)
      return null;
    // 新人没有可信参考中心，各个有声窗口必须互相一致，不能把混声均值学成新人。
    for (let i = 0; i < item.vectors.length; i++)
      for (let j = 0; j < i; j++)
        if (similarity(item.vectors[i], item.vectors[j]) < threshold) return null;
    return {
      speaker: { id: 'live-' + randomUUID(), name: 'spk-' + (this.sequence + 1) },
      fresh: true,
    };
  }
  learn(candidate, item) {
    if (!item.learn || (!candidate.center && !candidate.fresh)) return;
    const vector = normalized(
      item.vectors[0].map(
        (_, i) => item.vectors.reduce((sum, row) => sum + row[i], 0) / item.vectors.length,
      ),
    );
    // 只在数据库修订/人工更正检查通过并成功写回后学习；短句不能改变中心。
    if (candidate.fresh) {
      this.centers.push({ ...candidate.speaker, vector, count: 1 });
      this.sequence++;
    } else {
      const center = candidate.center,
        weight = Math.min(center.count, 50);
      center.vector = normalized(center.vector.map((value, i) => value * weight + vector[i]));
      center.count++;
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
