const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Worker: Thread } = require('node:worker_threads');
const { TaskCancelled } = require('./tasks.cjs');
const { ModelNotInstalled, modelSupportsLanguage } = require('./models.cjs');
const { wavInfo } = require('./audio-io.cjs');
const { readWindow, normalized, EMBEDDING_MODEL } = require('./worker-speakers.cjs');
const { cleanText, sentenceSubtitles } = require('./subtitles.cjs');
const {
  normalizeNumbers,
  trimOverlap,
  trimRepeats,
  assembleUtterances,
} = require('./refinement-text.cjs');
const {
  speakerFor,
  stabilize,
  deoverlap,
  refinementTurns,
  decodeRange,
  autoCluster,
} = require('./refinement-speakers.cjs');
function clusterAsync(embeddings, durations, count, config, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const thread = new Thread(
      `const {parentPort,workerData}=require('node:worker_threads');const normalized=${normalized.toString()};const autoCluster=${autoCluster.toString()};parentPort.postMessage(autoCluster(...workerData));`,
      { eval: true, workerData: [embeddings, durations, count, config] },
    );
    const abort = () => {
      void thread.terminate();
      reject(signal.reason || new TaskCancelled());
    };
    signal?.addEventListener('abort', abort, { once: true });
    thread.once('message', resolve);
    thread.once('error', reject);
    thread.once('exit', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code) reject(new Error('Speaker clustering exited (' + code + ')'));
    });
  });
}
function validTurns(turns, duration) {
  let dimensions;
  return (
    Array.isArray(turns) &&
    turns.every((t) => {
      if (
        !t ||
        !Number.isInteger(t.start_ms) ||
        !Number.isInteger(t.end_ms) ||
        t.start_ms < 0 ||
        t.end_ms <= t.start_ms ||
        t.end_ms > duration ||
        typeof t.speaker !== 'string'
      )
        return false;
      const v = t._embedding;
      if (v === null || v === undefined) return true;
      if (
        !Array.isArray(v) ||
        v.length < 1 ||
        v.length > 4096 ||
        v.some((x) => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e6) ||
        (dimensions !== undefined && dimensions !== v.length)
      )
        return false;
      dimensions = v.length;
      return true;
    })
  );
}
function rms(pcm) {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const n = pcm.readInt16LE(i) / 32768;
    sum += n * n;
  }
  return Math.sqrt(sum / (pcm.length / 2));
}
function quietTurns(file, turns, config) {
  const result = [];
  if (!config.quiet_speech_recovery) return result;
  for (let i = 1; i < turns.length; i++) {
    const previous = turns[i - 1],
      next = turns[i],
      start = previous.end_ms,
      end = next.start_ms;
    if (
      end - start < config.quiet_speech_min_seconds * 1000 ||
      end - start > config.quiet_speech_max_seconds * 1000
    )
      continue;
    const left =
        previous.end_ms - previous.start_ms >= 200
          ? readWindow(file, Math.max(previous.start_ms, previous.end_ms - 1000), previous.end_ms)
          : Buffer.alloc(0),
      right =
        next.end_ms - next.start_ms >= 200
          ? readWindow(file, next.start_ms, Math.min(next.end_ms, next.start_ms + 1000))
          : Buffer.alloc(0),
      level = rms(Buffer.concat([left, right]));
    if (!level) continue;
    const windowEnd = Math.max(start + 1, end - 300),
      pcm = readWindow(file, start, windowEnd),
      frames = Math.floor(pcm.length / 320),
      floor = Math.max(0.004, level * config.quiet_speech_level_ratio),
      loud = [];
    for (let frame = 0; frame < frames; frame++)
      if (rms(pcm.subarray(frame * 320, (frame + 1) * 320)) >= floor) loud.push(frame);
    if (!loud.length || loud.length * 5 < frames) continue;
    const first = Math.max(0, (loud[0] - 10) * 160),
      last = Math.min(pcm.length / 2, (loud.at(-1) + 11) * 160);
    if (last - first < config.quiet_speech_min_seconds * 16000) continue;
    const a = start + Math.round(((windowEnd - start) * first) / (pcm.length / 2)),
      b = start + Math.round(((windowEnd - start) * last) / (pcm.length / 2)),
      middle = (a + b) / 2;
    if (!turns.some((t) => t.start_ms <= middle && middle < t.end_ms))
      result.push({ start_ms: a, end_ms: b, speaker: previous.speaker, _quiet: true });
  }
  return result;
}
function createRefinementHandlers(worker) {
  const store = worker.store,
    settings = worker.settings;
  const progress = (meetingId, stage, completed = 0, total = 0) => {
    const [start, span] = {
      '对齐音频': [0, 10],
      '准备精修': [10, 5],
      '分析说话人': [15, 30],
      '转写中': [45, 50],
      '校正说话人': [95, 3],
      '整理结果': [98, 1],
    }[stage];
    worker.emit('refinement.progress', {
      meeting_id: meetingId,
      stage,
      completed: start + span * (total ? Math.max(0, Math.min(1, completed / total)) : 0),
      total: 100,
    });
  };
  async function speechRegions(meeting, file, duration, control) {
    const vad = worker.newEngine(worker.models.get(meeting.vad_model_id || 'silero-vad').runtime),
      speech = [];
    try {
      await vad.request(
        'vad.load',
        {
          path: path.join(
            worker.models.path(meeting.vad_model_id || 'silero-vad'),
            worker.models.get(meeting.vad_model_id || 'silero-vad').files[0],
          ),
          ...(settings.vad[meeting.language] || settings.vad.default),
        },
        { signal: control.signal },
      );
      for (let start = 0; start < duration; start += 10000) {
        await control.wait();
        const end = Math.min(duration, start + 10000),
          pcm = readWindow(file, start, end),
          result = await vad.request(
            'vad.feed',
            { pcm: pcm.toString('base64'), sample_rate: 16000 },
            { signal: control.signal },
          );
        speech.push(
          ...result.map(({ start_ms, end_ms }) => ({
            start_ms: Math.max(0, Math.round(start_ms)),
            end_ms: Math.min(duration, Math.round(end_ms)),
          })),
        );
        progress(meeting.id, '准备精修', end, duration);
      }
      const result = await vad.request('vad.flush', {}, { signal: control.signal });
      speech.push(
        ...result.map(({ start_ms, end_ms }) => ({
          start_ms: Math.max(0, Math.round(start_ms)),
          end_ms: Math.min(duration, Math.round(end_ms)),
        })),
      );
      return speech.filter((t) => t.end_ms > t.start_ms);
    } finally {
      vad.close();
    }
  }
  function cacheKey(file, speech, segmentation, threshold) {
    try {
      const ids = [segmentation, EMBEDDING_MODEL],
        files = [
          file,
          ...ids.flatMap((id) =>
            worker.models.get(id).files.map((name) => path.join(worker.models.path(id), name)),
          ),
        ];
      return createHash('sha256')
        .update(
          JSON.stringify({
            version: 2,
            files: files.map((name) => {
              const s = fs.statSync(name, { bigint: true });
              return [fs.realpathSync(name), String(s.size), String(s.mtimeNs)];
            }),
            models: ids.map((id) => worker.models.get(id)),
            speech,
            threshold,
            diarization: settings.diarization,
            refinement: settings.refinement,
          }),
        )
        .digest('hex');
    } catch {
      return null;
    }
  }
  async function diarize(meeting, file, duration, speech, segmentation, threshold, control) {
    const chunk = settings.refinement.diarization_chunk_ms,
      cache = file.replace(/\.wav$/, '.diarization.json'),
      key = cacheKey(file, speech, segmentation, threshold);
    if (duration > chunk && key)
      try {
        if (fs.statSync(cache).size <= 32 * 1024 * 1024) {
          const saved = JSON.parse(fs.readFileSync(cache, 'utf8'));
          if (saved.key === key && validTurns(saved.turns, duration)) {
            await control.wait();
            return saved.turns;
          }
        }
      } catch {}
    const turns = [],
      engine = worker.newEngine('sherpa-onnx');
    let degraded = false;
    // 原生引擎按模型路径缓存分段与声纹权重，所有窗口共用一次加载。
    try {
      for (let start = 0; start < duration; start += chunk) {
        await control.wait();
        const end = Math.min(duration, start + chunk),
          windowStart = Math.max(0, start - settings.refinement.diarization_overlap_ms),
          windowEnd = Math.min(duration, end + settings.refinement.diarization_overlap_ms),
          regions = speech.filter((s) => s.end_ms > windowStart && s.start_ms < windowEnd);
        if (!regions.length) continue;
        progress(meeting.id, '分析说话人', start, duration);
        let pieces = [];
        const pcm = readWindow(file, windowStart, windowEnd),
          masked = Buffer.from(pcm);
        let cursor = 0;
        for (const region of regions) {
          const a = Math.max(0, Math.round((region.start_ms - windowStart) * 16) * 2),
            b = Math.min(masked.length, Math.round((region.end_ms - windowStart) * 16) * 2);
          masked.fill(0, cursor, Math.min(masked.length, a));
          cursor = Math.max(cursor, b);
        }
        masked.fill(0, cursor);
        try {
          const response = await engine.request(
            'speaker.diarize',
            {
              segmentation_path: path.join(
                worker.models.path(segmentation),
                worker.models.get(segmentation).files[0],
              ),
              embedding_path: path.join(
                worker.models.path(EMBEDDING_MODEL),
                worker.models.get(EMBEDDING_MODEL).files[0],
              ),
              pcm: masked.toString('base64'),
              sample_rate: 16000,
              num_speakers: -1,
              threshold,
              threads: worker.models.device().threads,
              min_duration_on: settings.diarization.min_duration_on,
              min_duration_off: settings.diarization.min_duration_off,
            },
            {
              signal: control.signal,
              timeout:
                settings.refinement.diarization_timeout_seconds *
                1000 *
                Math.max(1, (end - start) / 30000),
            },
          );
          pieces = (response.segments || [])
            .map((s) => ({
              start_ms: Math.max(start, Math.round(s.start_ms + windowStart)),
              end_ms: Math.min(end, Math.round(s.end_ms + windowStart)),
              speaker: String(s.speaker),
            }))
            .filter((s) => s.end_ms > s.start_ms);
        } catch (error) {
          await control.wait();
          if (error.code === 'ENOENT') throw error;
          degraded = true;
          worker.emit('worker.warning', {
            meeting_id: meeting.id,
            code: 'diarization_chunk_fallback',
            start_ms: start,
            end_ms: end,
            message: error.message,
          });
        }
        if (!pieces.length)
          pieces = regions
            .map((r) => ({
              ...r,
              start_ms: Math.max(start, r.start_ms),
              end_ms: Math.min(end, r.end_ms),
              speaker: 'spk-1',
            }))
            .filter((r) => r.end_ms > r.start_ms);
        for (const piece of pieces)
          for (
            let a = piece.start_ms;
            a < piece.end_ms;
            a += settings.refinement.embedding_window_ms
          ) {
            await control.wait();
            const b = Math.min(piece.end_ms, a + settings.refinement.embedding_window_ms),
              turn = { ...piece, start_ms: a, end_ms: b, _embedding: null };
            try {
              turn._embedding = await worker.speakerEmbedding(
                engine,
                readWindow(file, a, b),
                control,
              );
            } catch (error) {
              await control.wait();
              degraded = true;
              worker.emit('worker.warning', {
                meeting_id: meeting.id,
                code: 'speaker_embedding_failed',
                message: error.message,
              });
            }
            turns.push(turn);
          }
      }
    } finally {
      engine.close();
    }
    if (key && !degraded && duration > chunk) {
      const temporary = cache + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify({ key, turns }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, cache);
      } catch (error) {
        console.error('Cannot cache speaker analysis:', error.message);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    return turns;
  }
  async function assignSpeakers(meeting, turns, numSpeakers, control) {
    const known = turns.map((t, i) => (t._embedding ? i : -1)).filter((i) => i >= 0),
      labels =
        known.length < 2
          ? known.map(() => 0)
          : await clusterAsync(
              known.map((i) => turns[i]._embedding),
              known.map((i) => turns[i].end_ms - turns[i].start_ms),
              numSpeakers,
              settings.refinement,
              control.signal,
            ),
      assigned = new Map(known.map((i, j) => [i, labels[j]]));
    for (let i = 0; i < turns.length; i++) {
      if (!assigned.has(i) && assigned.size) {
        let nearest = null,
          distance = Infinity;
        for (const j of assigned.keys()) {
          const gap = Math.max(
            0,
            turns[i].start_ms - turns[j].end_ms,
            turns[j].start_ms - turns[i].end_ms,
          );
          if (gap < distance) {
            distance = gap;
            nearest = j;
          }
        }
        assigned.set(i, assigned.get(nearest));
      }
      if (assigned.has(i)) turns[i].speaker = 'spk-' + (assigned.get(i) + 1);
    }
    const representatives = new Map();
    for (const turn of turns) {
      const previous = representatives.get(turn.speaker);
      if (!previous || turn.end_ms - turn.start_ms > previous.end_ms - previous.start_ms)
        representatives.set(turn.speaker, turn);
    }
    const replacements = new Map();
    for (const [speaker, turn] of representatives) {
      if (!turn._embedding) continue;
      const profile = store.matchSpeakerProfile(
        turn._embedding,
        settings.diarization.voiceprint_similarity_threshold,
      );
      if (profile && profile.score - profile.runner_up_score >= 0.08) {
        replacements.set(speaker, 'profile-' + profile.id);
        store.renameSpeaker(meeting.id, 'profile-' + profile.id, profile.name, false, profile.id);
      }
    }
    return turns.map(({ _embedding, ...t }) => ({
      ...t,
      speaker: replacements.get(t.speaker) || t.speaker,
    }));
  }
  async function refine(payload, control) {
    let meeting = store.getMeeting(payload.meeting_id);
    if (meeting.status === 'recording') throw new Error('Stop the meeting before refinement');
    const language = payload.language || meeting.language;
    if ('target_language' in payload)
      meeting = store.updateMeeting(meeting.id, { target_language: payload.target_language });
    let modelId = payload.refined_model_id || meeting.refined_model_id,
      model = worker.models.isKnown(modelId) ? worker.models.get(modelId) : null;
    if (
      !model ||
      model.retired ||
      (!('refined_model_id' in payload) &&
        (!worker.models.isReady(modelId) || !modelSupportsLanguage(model, language)))
    )
      modelId = worker.models.defaultModel(language, modelId);
    worker.sentencePayload({ language, refined_model_id: modelId });
    meeting = { ...meeting, language, refined_model_id: modelId };
    model = worker.models.get(modelId);
    const numSpeakers = Number(
        payload.num_speakers ?? meeting.num_speakers ?? settings.diarization.num_speakers,
      ),
      threshold = Number(payload.cluster_threshold ?? settings.diarization.cluster_threshold);
    if (!Number.isInteger(numSpeakers) || (numSpeakers !== -1 && numSpeakers < 1))
      throw new Error('num_speakers must be -1 or a supported positive integer');
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 2)
      throw new Error('cluster_threshold must be between 0 and 2');
    let tracks = ['mic', 'system'].filter((t) => meeting.audio.playback[t]);
    if (!tracks.length)
      throw Object.assign(new Error('The meeting has no audio to refine'), {
        code: 'error.refinement.no_audio',
      });
    const merge = tracks.length === 2,
      manifest = store.readManifest(meeting.id),
      imported =
        manifest.source === 'audio_import' ||
        (!Object.keys(manifest.tracks || {}).length && tracks.length === 1 && tracks[0] === 'mic');
    let duration = 0;
    for (const track of tracks) {
      const info = wavInfo(meeting.audio.playback[track]);
      if (info.frames / info.sampleRate > settings.refinement.max_refine_seconds)
        throw new Error('Audio exceeds the maximum refinement duration');
      duration = Math.max(duration, (info.frames * 1000) / info.sampleRate);
    }
    const flatImport =
        imported &&
        ((duration / 1000) * 0.4 * 4) /
          Math.max(1, worker.models.device().physical_cores || worker.models.device().cores) >
          300,
      segmentation =
        meeting.speaker_segmentation_model_id || settings.diarization.segmentation_model_id,
      required =
        payload.force_diarization === true ||
        merge ||
        tracks.includes('system') ||
        (imported && !flatImport);
    const missing = worker.models.missing([
      modelId,
      meeting.vad_model_id || 'silero-vad',
      ...(required ? [segmentation, EMBEDDING_MODEL] : []),
    ]);
    if (missing.length) throw new ModelNotInstalled(missing);
    const speakerReady =
        worker.models.isReady(segmentation) && worker.models.isReady(EMBEDDING_MODEL),
      recognizer = worker.newEngine(model.runtime);
    worker.emit('refinement.started', { meeting_id: meeting.id, total: 0, stage: '准备精修' });
    try {
      if (merge) {
        await control.wait();
        await store.buildMix(
          meeting.id,
          (ratio) => {
            if (control.cancelled) throw new TaskCancelled();
            progress(meeting.id, '对齐音频', ratio, 1);
          },
          { signal: control.signal, control },
        );
        tracks = ['mix'];
        meeting = { ...meeting, audio: store.audioFiles(meeting.id) };
      }
      const sources = new Map(),
        metadata = [];
      for (const track of tracks) {
        await control.wait();
        const file = meeting.audio.playback[track],
          info = wavInfo(file),
          trackDuration = Math.floor((info.frames * 1000) / info.sampleRate),
          speech = await speechRegions(meeting, file, trackDuration, control);
        let turns =
          required || (speakerReady && !flatImport)
            ? await assignSpeakers(
                meeting,
                await diarize(
                  meeting,
                  file,
                  trackDuration,
                  speech,
                  segmentation,
                  threshold,
                  control,
                ),
                numSpeakers,
                control,
              )
            : speech.map((s) => ({ ...s, speaker: 'local-user' }));
        if (tracks.length > 1)
          turns = turns.map((t) => ({
            ...t,
            speaker: t.speaker.startsWith('spk-') ? track + '-' + t.speaker : t.speaker,
          }));
        const auto = language === 'auto',
          stable = stabilize(turns, auto ? 2500 : 1000, 600, auto ? 1000 : 200),
          exclusive = stabilize(deoverlap(stable), auto ? 2500 : 1000, 600, auto ? 1000 : 200),
          preserved = deoverlap(stable, 1000),
          quiet =
            worker.models.get(meeting.vad_model_id || 'silero-vad').runtime === 'mlx-audio'
              ? []
              : quietTurns(file, exclusive, settings.live_asr);
        sources.set(track, {
          file,
          duration: trackDuration,
          turns: [...exclusive, ...quiet].sort(
            (a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms,
          ),
          metadata: [...preserved, ...quiet].sort(
            (a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms,
          ),
        });
        metadata.push(...sources.get(track).metadata);
      }
      await control.wait();
      progress(meeting.id, '转写中');
      const loaded = await recognizer.request(
        'asr.load',
        {
          path: worker.models.path(modelId),
          kind: model.kind,
          files: model.files,
          language,
          hotwords: store.asrTermOptions(meeting).hotwords || [],
          threads: worker.models.device().threads,
        },
        { signal: control.signal },
      );
      const maximum = Math.min(
        settings.asr.refined_window_seconds * 1000,
        (loaded.max_speech_seconds || 20) * 1000 - 1600,
      );
      if (maximum <= 0) throw new Error('Recognition model window is too short');
      let total = 0;
      for (const source of sources.values()) {
        source.windows = refinementTurns(
          source.turns,
          source.duration,
          maximum,
          language === 'auto' ? 2000 : 0,
        );
        total += source.windows.length;
      }
      const lockedIds = new Set(meeting.speakers.filter((s) => s.locked).map((s) => s.id)),
        latest = store.currentSegments(meeting.id),
        locked = latest.filter((s) => s.user_edited || lockedIds.has(s.speaker)),
        segments = [],
        ids = new Set(),
        previousText = new Map();
      let completed = 0;
      store.setStatus(meeting.id, 'refining');
      for (const [track, source] of sources)
        for (let index = 0; index < source.windows.length; index++) {
          await control.wait();
          const turn = source.windows[index],
            [start, end] = decodeRange(
              turn,
              source.windows[index - 1],
              source.windows[index + 1],
              source.duration,
            ),
            result = await recognizer.request(
              'asr.decode',
              { pcm: readWindow(source.file, start, end).toString('base64'), sample_rate: 16000 },
              { signal: control.signal },
            ),
            raw = trimRepeats(cleanText(result.text)),
            key = track + '\0' + turn.speaker,
            [trimmed, continued] = trimOverlap(previousText.get(key) || '', raw),
            text = normalizeNumbers(trimmed);
          previousText.set(key, raw);
          progress(meeting.id, '转写中', ++completed, total);
          if (!text) continue;
          const speaker =
            speakerFor(
              turn.start_ms,
              turn.end_ms,
              locked.filter((s) => track === 'mix' || s.track === track),
            ) ||
            turn.speaker ||
            (track === 'mic' ? 'local-user' : 'spk-1');
          let id = track + '-' + turn.start_ms;
          if (ids.has(id)) id += '-' + index;
          ids.add(id);
          segments.push({
            meeting_id: meeting.id,
            segment_id: id,
            version: 'postprocess',
            text,
            start_ms: turn.start_ms,
            end_ms: turn.end_ms,
            speaker,
            track,
            continues_previous: continued,
            word_timestamps: (result.words || []).map((w) => {
              const a = w.start_ms + start,
                b = w.end_ms + start,
                overlap = [
                  ...new Set(
                    source.metadata
                      .filter((t) => Math.min(b, t.end_ms) - Math.max(a, t.start_ms) > (b - a) / 2)
                      .map((t) => t.speaker),
                  ),
                ];
              return {
                ...w,
                start_ms: a,
                end_ms: b,
                speaker: speakerFor(a, b, source.turns) || speaker,
                overlap_speakers: overlap,
                overlap: overlap.length > 1,
              };
            }),
          });
        }
      progress(meeting.id, '校正说话人', total, total);
      progress(meeting.id, '整理结果', total, total);
      await control.wait();
      const paragraphs = assembleUtterances(
          segments.sort(
            (a, b) =>
              a.track.localeCompare(b.track) || a.start_ms - b.start_ms || a.end_ms - b.end_ms,
          ),
          settings.asr.refined_window_seconds * 2000,
        ).flatMap((event) =>
          sentenceSubtitles(event, event.text, false).map((p) => ({
            ...p,
            word_timestamps: event.word_timestamps.filter(
              (w) => p.start_ms <= w.start_ms && w.start_ms < p.end_ms,
            ),
          })),
        ),
        [version, revision] = store.nextRefinementVersion(meeting.id);
      store.transaction(() => {
        store.replaceSegments(meeting.id, paragraphs, version, revision, {
          model_id: modelId,
          language,
        });
        store.replaceSpeakerTurns(
          meeting.id,
          metadata.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms),
        );
        store.setStatus(meeting.id, 'refined');
      });
      const result = { meeting_id: meeting.id, status: 'refined' };
      worker.emit('refinement.ready', result);
      return result;
    } catch (error) {
      store.setStatus(meeting.id, 'ready');
      if (control.cancelled || error instanceof TaskCancelled) {
        worker.emit('refinement.cancelled', { meeting_id: meeting.id });
        return store.getMeeting(meeting.id);
      }
      worker.emit('worker.warning', {
        meeting_id: meeting.id,
        code: 'refinement_failed',
        message: error.message,
      });
      worker.emit('refinement.cancelled', {
        meeting_id: meeting.id,
        meeting: store.getMeeting(meeting.id),
      });
      throw error;
    } finally {
      recognizer.close();
    }
  }
  return {
    'meeting.refine': (p) =>
      worker.tasks.running('meeting.refine', p.meeting_id, (c) => refine(p, c)),
    'meeting.refinement-recover': (p) => {
      const meeting = store.getMeeting(p.meeting_id);
      return meeting.status === 'refining' ? store.setStatus(meeting.id, 'ready') : meeting;
    },
  };
}
module.exports = { createRefinementHandlers, quietTurns, validTurns, clusterAsync };
