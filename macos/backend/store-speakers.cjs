const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeChild, resolveExisting, utcNow } = require('./store-base.cjs');
function normalized(embedding) {
  const values = Array.from(embedding, Number);
  const norm = Math.sqrt(values.reduce((n, x) => n + x * x, 0));
  if (!norm || !Number.isFinite(norm)) throw new Error('Speaker embedding is empty');
  return values.map((x) => x / norm);
}
module.exports = {
  listSpeakerProfiles() {
    return this.query(
      'SELECT id,name,sample_count,created_at,updated_at,COALESCE((SELECT SUM(duration_ms) FROM speaker_profile_samples sample WHERE sample.profile_id=speaker_profiles.id),0) duration_ms FROM speaker_profiles ORDER BY name COLLATE NOCASE',
    );
  },
  speakerProfile(id) {
    const row = this.one('SELECT * FROM speaker_profiles WHERE id=?', id);
    if (!row) throw new Error('Speaker profile not found');
    return row;
  },
  sampleAudioPath(id, audio) {
    if (!audio) return null;
    if (path.isAbsolute(audio)) {
      if (
        path.basename(path.dirname(audio)) !== id ||
        path.basename(path.dirname(path.dirname(audio))) !== 'speaker-profiles'
      )
        return null;
    } else if (path.basename(audio) !== audio || ['', '.', '..'].includes(audio)) return null;
    const directory = safeChild(this.speakerProfilesDir, id),
      result = path.join(directory, path.basename(audio));
    return path.dirname(resolveExisting(result)) === resolveExisting(directory) ? result : null;
  },
  listSpeakerProfileSamples(id) {
    this.speakerProfile(id);
    return this.query(
      'SELECT id,profile_id,source_key,created_at,audio_path,duration_ms FROM speaker_profile_samples WHERE profile_id=? ORDER BY created_at DESC',
      id,
    ).map((r) => ({ ...r, audio_path: this.sampleAudioPath(id, r.audio_path) }));
  },
  ensureSpeakerProfile(name) {
    name = name.trim();
    if (!name) throw new Error('Speaker name cannot be empty');
    return this.transaction(() => {
      let row = this.one('SELECT id FROM speaker_profiles WHERE name=? COLLATE NOCASE', name);
      if (!row) {
        row = { id: randomUUID() };
        this.run(
          'INSERT INTO speaker_profiles(id,name,embedding,sample_count,created_at,updated_at) VALUES(?,?,?,?,?,?)',
          row.id,
          name,
          '[]',
          0,
          utcNow(),
          utcNow(),
        );
      }
      return this.speakerProfile(row.id);
    });
  },
  refreshSpeakerCenter(id) {
    const samples = this.query(
      'SELECT embedding FROM speaker_profile_samples WHERE profile_id=?',
      id,
    ).map((r) => JSON.parse(r.embedding));
    const center = samples.length
      ? normalized(
          samples[0].map((_, i) => samples.reduce((n, row) => n + row[i], 0) / samples.length),
        )
      : [];
    this.run(
      'UPDATE speaker_profiles SET embedding=?,sample_count=?,updated_at=? WHERE id=?',
      JSON.stringify(center),
      samples.length,
      utcNow(),
      id,
    );
  },
  saveSpeakerProfileSample(
    name,
    embedding,
    sourceKey,
    profileId = null,
    audioPath = null,
    durationMs = 0,
  ) {
    const vector = normalized(embedding);
    let existing, saved;
    this.transaction(() => {
      let profile = profileId
        ? this.one('SELECT * FROM speaker_profiles WHERE id=?', profileId)
        : this.one('SELECT * FROM speaker_profiles WHERE name=? COLLATE NOCASE', name.trim());
      if (!profile) {
        profileId = randomUUID();
        this.run(
          'INSERT INTO speaker_profiles(id,name,embedding,sample_count,created_at,updated_at) VALUES(?,?,?,?,?,?)',
          profileId,
          name.trim(),
          JSON.stringify(vector),
          0,
          utcNow(),
          utcNow(),
        );
        profile = this.speakerProfile(profileId);
      } else if (
        JSON.parse(profile.embedding).length &&
        JSON.parse(profile.embedding).length !== vector.length
      )
        throw new Error("Voiceprint model does not match this person's registered samples");
      profileId = profile.id;
      if (audioPath) {
        const file = this.sampleAudioPath(profileId, audioPath);
        if (!file) throw new Error('Voiceprint audio must be inside its profile directory');
        audioPath = path.basename(file);
      }
      existing = this.one(
        'SELECT id,profile_id,audio_path FROM speaker_profile_samples WHERE source_key=?',
        sourceKey,
      );
      if (existing) {
        if (existing.profile_id !== profileId)
          throw Object.assign(new Error('Recording already belongs to another voiceprint'), {
            code: 'error.voice_sample_owned',
          });
        saved = false;
        if (audioPath)
          this.run(
            'UPDATE speaker_profile_samples SET audio_path=?,duration_ms=? WHERE id=?',
            audioPath,
            Math.trunc(durationMs),
            existing.id,
          );
      } else {
        const usage = this.one(
            'SELECT COUNT(*) samples,COALESCE(SUM(duration_ms),0) duration_ms FROM speaker_profile_samples WHERE profile_id=?',
            profileId,
          ),
          limits = this.settings.voice_profiles;
        if (usage.samples >= limits.max_samples)
          throw Object.assign(new Error('Voiceprint recording count limit reached'), {
            code: 'error.voice_sample_limit',
          });
        if (usage.duration_ms + durationMs > limits.max_total_seconds * 1000)
          throw Object.assign(new Error('Voiceprint recording duration limit reached'), {
            code: 'error.voice_duration_limit',
          });
        this.run(
          'INSERT INTO speaker_profile_samples(id,profile_id,source_key,embedding,created_at,audio_path,duration_ms) VALUES(?,?,?,?,?,?,?)',
          randomUUID(),
          profileId,
          sourceKey,
          JSON.stringify(vector),
          utcNow(),
          audioPath,
          Math.trunc(durationMs),
        );
        this.refreshSpeakerCenter(profileId);
        saved = true;
      }
    });
    if (
      existing &&
      audioPath &&
      this.sampleAudioPath(profileId, existing.audio_path) !==
        this.sampleAudioPath(profileId, audioPath)
    )
      this.deleteSampleAudio(profileId, existing.audio_path);
    return { ...this.speakerProfile(profileId), added: saved };
  },
  deleteSampleAudio(id, audioPath) {
    const file = this.sampleAudioPath(id, audioPath);
    if (
      file &&
      !this.query('SELECT audio_path FROM speaker_profile_samples WHERE profile_id=?', id).some(
        (r) => this.sampleAudioPath(id, r.audio_path) === file,
      )
    ) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        console.error(error);
      }
    }
  },
  deleteSpeakerProfileSample(id, sampleId) {
    let sample;
    this.transaction(() => {
      sample = this.one(
        'SELECT audio_path FROM speaker_profile_samples WHERE id=? AND profile_id=?',
        sampleId,
        id,
      );
      if (!sample) return;
      this.run('DELETE FROM speaker_profile_samples WHERE id=?', sampleId);
      this.refreshSpeakerCenter(id);
    });
    if (sample) this.deleteSampleAudio(id, sample.audio_path);
    return this.speakerProfile(id);
  },
  matchSpeakerProfile(embedding, threshold) {
    const vector = normalized(embedding),
      scores = this.query('SELECT id,name,embedding,sample_count FROM speaker_profiles')
        .map((row) => {
          const candidate = JSON.parse(row.embedding);
          return candidate.length === vector.length
            ? { ...row, score: vector.reduce((n, x, i) => n + x * candidate[i], 0) }
            : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
    if (!scores.length || scores[0].score < threshold) return null;
    const first = scores[0];
    return {
      id: first.id,
      name: first.name,
      sample_count: first.sample_count,
      score: first.score,
      runner_up_score: scores[1]?.score ?? -1,
    };
  },
  deleteSpeakerProfile(id) {
    fs.rmSync(safeChild(this.speakerProfilesDir, id, 'speaker profile id'), {
      recursive: true,
      force: true,
    });
    this.run('DELETE FROM speaker_profiles WHERE id=?', id);
  },
  deleteLegacyBuiltinProfiles() {
    const rows = this.query(
      "SELECT id,profile_id FROM speaker_profile_samples WHERE source_key LIKE 'builtin:%'",
    );
    for (const row of rows) {
      const profile = this.deleteSpeakerProfileSample(row.profile_id, row.id);
      if (!profile.sample_count) this.deleteSpeakerProfile(profile.id);
    }
    return new Set(rows.map((r) => r.profile_id)).size;
  },
  setSegmentSpeaker(mid, id, speaker, profileId = null, name = null) {
    this.transaction(() => {
      this.run(
        'UPDATE segments SET speaker=?,user_edited=1 WHERE meeting_id=? AND id=?',
        speaker,
        mid,
        id,
      );
      this.run(
        'INSERT INTO speakers(meeting_id,id,name,profile_id,locked) VALUES(?,?,?,?,1) ON CONFLICT(meeting_id,id) DO UPDATE SET name=excluded.name,profile_id=excluded.profile_id,locked=1',
        mid,
        speaker,
        name || speaker,
        profileId,
      );
    });
  },
  renameSpeakerProfile(id, name) {
    name = name.trim();
    if (!name) throw new Error('Speaker profile name cannot be empty');
    this.run('UPDATE speaker_profiles SET name=?,updated_at=? WHERE id=?', name, utcNow(), id);
    return this.speakerProfile(id);
  },
};
