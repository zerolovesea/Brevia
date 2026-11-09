const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { convertToPCM, wavInfo, wavHeader } = require('./audio-io.cjs');
const { ModelNotInstalled } = require('./models.cjs');
const { timeAt } = require('./subtitles.cjs');
const EMBEDDING_MODEL = 'eres2net-base-3dspeaker-zh';
function readWindow(file, startMs = 0, endMs = Infinity) {
  const info = wavInfo(file);
  if (info.channels !== 1 || info.sampleRate !== 16000)
    throw new Error('Expected mono 16 kHz PCM16 audio');
  const start = Math.max(0, Math.min(info.frames, Math.round((startMs * info.sampleRate) / 1000)));
  const end = Math.max(start, Math.min(info.frames, Math.round((endMs * info.sampleRate) / 1000)));
  const data = Buffer.alloc((end - start) * 2),
    fd = fs.openSync(file, 'r');
  try {
    let at = 0;
    while (at < data.length) {
      const n = fs.readSync(fd, data, at, data.length - at, info.offset + start * 2 + at);
      if (!n) throw new Error('Truncated audio');
      at += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return data;
}
function normalized(values) {
  const norm = Math.sqrt(values.reduce((n, x) => n + x * x, 0));
  if (!norm || !Number.isFinite(norm)) throw new Error('Invalid speaker embedding');
  return values.map((x) => x / norm);
}
function defaultName(name) {
  return /^(?:spk|speaker|说话人|話者|화자|hablante|orador|locuteur|intervenant|sprecher|говорящий|спикер)\d+$/iu.test(
    name.trim().replace(/[\s_-]+/g, ''),
  );
}
function createSpeakerHandlers(worker) {
  const store = worker.store;
  worker.speakerEmbedding = async (engine, pcm, control, { threads = 4 } = {}) => {
    await control?.wait();
    if (pcm.length < worker.settings.diarization.minimum_embedding_seconds * 32000) return null;
    if (!worker.models.isReady(EMBEDDING_MODEL)) throw new ModelNotInstalled([EMBEDDING_MODEL]);
    const descriptor = worker.models.get(EMBEDDING_MODEL);
    if (
      descriptor.revision !== 'speaker-recongition-models' ||
      descriptor.archive_sha256 !==
        '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b'
    )
      throw new Error('Speaker embedding model is incompatible with saved voiceprints');
    const result = await engine.request(
      'speaker.embed',
      {
        path: path.join(
          worker.models.path(EMBEDDING_MODEL),
          worker.models.get(EMBEDDING_MODEL).files[0],
        ),
        pcm: pcm.toString('base64'),
        sample_rate: 16000,
        threads,
      },
      { signal: control?.signal },
    );
    return result.embedding?.length ? result.embedding : null;
  };
  async function voiceFile(p, control, verify) {
    if (!fs.existsSync(p.path) || !fs.statSync(p.path).isFile())
      throw Object.assign(new Error('Audio file not found'), { code: 'error.audio_not_found' });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brevia-voice-')),
      file = path.join(temp, 'sample.wav'),
      engine = worker.newEngine('sherpa-onnx');
    try {
      await control.wait();
      await convertToPCM(p.path, file, 16000, 1, engine, { signal: control.signal });
      const info = wavInfo(file);
      if (info.frames / info.sampleRate > worker.settings.voice_profiles.max_total_seconds)
        throw new Error('Voice recording exceeds maximum duration');
      const pcm = readWindow(file),
        embedding = await worker.speakerEmbedding(engine, pcm, control);
      if (!embedding)
        throw Object.assign(new Error('Voice sample is too short'), {
          code: 'error.voice_sample_short',
        });
      if (verify) {
        const profile = store.speakerProfile(p.profile_id),
          candidate = normalized(embedding),
          reference = JSON.parse(profile.embedding);
        if (candidate.length !== reference.length)
          throw new Error("Voiceprint model does not match this person's registered samples");
        const score = candidate.reduce((n, x, i) => n + x * reference[i], 0);
        return {
          profile_id: profile.id,
          name: profile.name,
          score,
          verified: score >= worker.settings.diarization.online_similarity_threshold,
        };
      }
      const profile = p.profile_id
          ? store.speakerProfile(p.profile_id)
          : store.ensureSpeakerProfile(p.name),
        directory = path.join(store.speakerProfilesDir, profile.id);
      fs.mkdirSync(directory, { recursive: true });
      const audio = path.join(directory, randomUUID() + '.wav'),
        stat = fs.statSync(p.path, { bigint: true }),
        sourceKey = 'file:' + fs.realpathSync(p.path) + ':' + stat.mtimeNs + ':' + stat.size;
      fs.copyFileSync(file, audio, fs.constants.COPYFILE_EXCL);
      try {
        await control.wait();
        return store.saveSpeakerProfileSample(
          p.name,
          embedding,
          sourceKey,
          profile.id,
          audio,
          Math.round(pcm.length / 32),
        );
      } catch (error) {
        fs.rmSync(audio, { force: true });
        throw error;
      }
    } finally {
      engine.close();
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  async function learnSegment(meeting, id, profile, control) {
    const latest = new Map();
    for (const item of meeting.segments) {
      if (item.id !== id || !(item.version === 'live' || item.version.startsWith('postprocess')))
        continue;
      const previous = latest.get(item.id);
      if (
        !previous ||
        (item.version.startsWith('postprocess') &&
          (previous.version === 'live' || item.revision >= previous.revision))
      )
        latest.set(item.id, item);
    }
    const archived = store.listSpeakerProfileSamples(profile.id),
      existing = new Set(archived.map((s) => s.source_key));
    let count = archived.length,
      totalMs = archived.reduce((n, s) => n + s.duration_ms, 0);
    const engine = worker.newEngine('sherpa-onnx');
    try {
      for (const segment of latest.values()) {
        await control.wait();
        const file = meeting.audio.playback[segment.track];
        if (!file || !fs.existsSync(file)) continue;
        const pcm = readWindow(file, segment.start_ms, segment.end_ms),
          text = segment.text || '',
          sentences = text
            .trim()
            .split(/(?<=[。！？.!?])\s*/)
            .filter(Boolean);
        const total = sentences.reduce((n, s) => n + [...s].length, 0);
        let fallback,
          cursor = segment.start_ms,
          position = 0;
        for (let index = 0; index < sentences.length; index++) {
          const sentence = sentences[index],
            found = text.indexOf(sentence, position);
          position = found < 0 ? -1 : found + sentence.length;
          const end =
            index === sentences.length - 1
              ? segment.end_ms
              : segment.word_timestamps?.length && position >= 0
                ? Math.max(
                    cursor,
                    Math.min(
                      segment.end_ms,
                      timeAt(segment, text, [...text.slice(0, position)].length),
                    ),
                  )
                : cursor +
                  Math.round(
                    ((segment.end_ms - segment.start_ms) * [...sentence].length) /
                      Math.max(1, total),
                  );
          const sourceKey =
              'meeting:' + meeting.id + ':' + profile.id + ':' + segment.id + ':' + index,
            duration = Math.max(0, end - cursor);
          if (!existing.has(sourceKey)) {
            if (
              count >= worker.settings.voice_profiles.max_samples ||
              totalMs + duration > worker.settings.voice_profiles.max_total_seconds * 1000
            )
              break;
            const clip = pcm.subarray(
                Math.round((cursor - segment.start_ms) * 16) * 2,
                Math.round((end - segment.start_ms) * 16) * 2,
              ),
              // 只有短句无法提取时才计算整段声纹，多条短句共用同一个回退请求。
              embedding =
                (await worker.speakerEmbedding(engine, clip, control)) ||
                (await (fallback ||= worker.speakerEmbedding(engine, pcm, control)));
            if (embedding) {
              const directory = path.join(store.speakerProfilesDir, profile.id);
              fs.mkdirSync(directory, { recursive: true });
              const audio = path.join(directory, randomUUID() + '.wav');
              fs.writeFileSync(audio, Buffer.concat([wavHeader(clip.length), clip]), {
                flag: 'wx',
                mode: 0o600,
              });
              try {
                await control.wait();
                profile = store.saveSpeakerProfileSample(
                  profile.name,
                  embedding,
                  sourceKey,
                  profile.id,
                  audio,
                  duration,
                );
              } catch (error) {
                fs.rmSync(audio, { force: true });
                throw error;
              }
              existing.add(sourceKey);
              count++;
              totalMs += duration;
            }
          }
          cursor = end;
        }
      }
    } finally {
      engine.close();
    }
    if (
      !store
        .listSpeakerProfileSamples(profile.id)
        .some((s) =>
          s.source_key.startsWith('meeting:' + meeting.id + ':' + profile.id + ':' + id + ':'),
        )
    )
      throw new Error('无法提取声音样本，请选择清晰的单人语音。');
    return profile;
  }
  const managed = (type, fn) => (p) =>
    worker.tasks.running(type, p.meeting_id, (control) => fn(p, control), { concurrent: true });
  return {
    'speaker-profile.rename': (p) => store.renameSpeakerProfile(p.profile_id, p.name),
    'speaker-profile.list': () => store.listSpeakerProfiles(),
    'speaker-profile.samples': (p) => store.listSpeakerProfileSamples(p.profile_id),
    'speaker-profile.enroll': managed('speaker-profile.enroll', async (p, c) => {
      const profile = await voiceFile(p, c, false);
      worker.emit('speaker-profile.updated', { profile });
      return profile;
    }),
    'speaker-profile.verify': managed('speaker-profile.verify', (p, c) => voiceFile(p, c, true)),
    'speaker-profile.delete': (p) => {
      store.deleteSpeakerProfile(p.profile_id);
      worker.emit('speaker-profile.deleted', { profile_id: p.profile_id });
      return { profile_id: p.profile_id, deleted: true };
    },
    'speaker-profile.sample-delete': (p) => {
      const profile = store.deleteSpeakerProfileSample(p.profile_id, p.sample_id);
      worker.emit('speaker-profile.updated', { profile });
      return profile;
    },
    'speaker.rename': managed('speaker.rename', (p) => {
      if (p.meeting_only) {
        store.editableMeeting(p.meeting_id);
        const segments = store.currentSegments(p.meeting_id);
        if (!segments.some((segment) => segment.speaker === p.speaker_id))
          throw new Error('Speaker not found');
        if (
          store.one(
            'SELECT 1 FROM speakers WHERE meeting_id=? AND id<>? AND name=?',
            p.meeting_id,
            p.speaker_id,
            p.name,
          ) ||
          segments.some(
            (segment) => segment.speaker !== p.speaker_id && segment.speaker_name === p.name,
          )
        )
          throw Object.assign(new Error('Speaker name already in use'), {
            code: 'error.speaker_name_taken',
          });
        store.renameSpeaker(p.meeting_id, p.speaker_id, p.name, p.locked);
        return store.getMeeting(p.meeting_id);
      }
      const profile = defaultName(p.name) ? null : store.ensureSpeakerProfile(p.name);
      store.renameSpeaker(p.meeting_id, p.speaker_id, p.name, p.locked || false, profile?.id);
      if (profile) worker.emit('speaker-profile.updated', { profile });
      return store.getMeeting(p.meeting_id);
    }),
    'segment.speaker-profile-sample': managed('segment.speaker-profile-sample', async (p, c) => {
      const profile = await learnSegment(
        store.getMeeting(p.meeting_id),
        p.segment_id,
        store.speakerProfile(p.profile_id),
        c,
      );
      store.setSegmentSpeaker(
        p.meeting_id,
        p.segment_id,
        'profile-' + profile.id,
        profile.id,
        profile.name,
      );
      worker.emit('speaker-profile.updated', { profile });
      return store.getMeeting(p.meeting_id);
    }),
    'segment.speaker': managed('segment.speaker', async (p, c) => {
      const meeting = store.getMeeting(p.meeting_id);
      if (defaultName(p.name)) return meeting;
      if (!meeting.segments.some((s) => s.id === p.segment_id))
        throw new Error('Segment not found');
      if (!p.enroll) {
        const target = meeting.speakers.find((s) => s.name === p.name);
        store.setSegmentSpeaker(
          p.meeting_id,
          p.segment_id,
          target?.id || 'manual-' + randomUUID(),
          target?.profile_id,
          p.name,
        );
        return store.getMeeting(p.meeting_id);
      }
      const ids = new Set(store.listSpeakerProfiles().map((s) => s.id));
      let profile = store.ensureSpeakerProfile(p.name);
      try {
        profile = await learnSegment(meeting, p.segment_id, profile, c);
      } catch (error) {
        if (!ids.has(profile.id) && !store.speakerProfile(profile.id).sample_count)
          store.deleteSpeakerProfile(profile.id);
        throw error;
      }
      store.setSegmentSpeaker(
        p.meeting_id,
        p.segment_id,
        'profile-' + profile.id,
        profile.id,
        profile.name,
      );
      worker.emit('speaker-profile.updated', { profile });
      return store.getMeeting(p.meeting_id);
    }),
  };
}
module.exports = { createSpeakerHandlers, readWindow, normalized, EMBEDDING_MODEL };
