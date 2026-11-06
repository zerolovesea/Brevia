const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const FLOAT_KEYS = new Set([
  'max_speech_seconds',
  'microphone_target_rms',
  'microphone_minimum_rms',
  'microphone_peak',
  'quiet_speech_min_seconds',
  'quiet_speech_max_seconds',
  'quiet_speech_level_ratio',
  'cluster_threshold',
  'online_similarity_threshold',
  'voiceprint_similarity_threshold',
  'minimum_embedding_seconds',
  'boundary_tail_seconds',
  'min_duration_on',
  'min_duration_off',
  'auto_cluster_score_tolerance',
  'threshold',
  'min_silence_duration',
  'min_speech_duration',
  'max_speech_duration',
]);
function minimumCap(params) {
  return Math.max(1, Math.ceil((params.min_speech_duration + 0.4 + 0.064) / 0.032) * 0.032);
}
function limits(key) {
  const floating = FLOAT_KEYS.has(key),
    value = { min: 0, step: floating ? 'any' : 1 };
  if (
    [
      'sample_rate',
      'chunk_seconds',
      'max_speech_duration',
      'refined_window_seconds',
      'boundary_tail_seconds',
      'microphone_max_gain',
      'max_samples',
      'max_total_seconds',
      'timeout_seconds',
      'diarization_timeout_seconds',
      'max_refine_seconds',
      'diarization_chunk_ms',
      'embedding_window_ms',
      'max_auto_speakers',
      'min_auto_speaker_windows',
      'quiet_speech_max_seconds',
    ].includes(key)
  ) {
    if (floating) value.exclusive_min = true;
    else value.min = 1;
  }
  if (
    [
      'online_similarity_threshold',
      'voiceprint_similarity_threshold',
      'microphone_target_rms',
      'microphone_minimum_rms',
      'microphone_peak',
      'threshold',
      'quiet_speech_level_ratio',
      'quiet_speech_recovery',
    ].includes(key)
  )
    value.max = 1;
  if (key === 'cluster_threshold') value.max = 2;
  if (key === 'num_speakers') {
    value.min = -1;
    value.exclude = [0];
  }
  if (key === 'sample_rate') Object.assign(value, { min: 16000, max: 16000, read_only: true });
  return value;
}
function merge(defaults, input, full = false) {
  if (!input || Array.isArray(input) || typeof input !== 'object')
    throw new Error('Advanced settings must match the default template');
  const result = {};
  for (const [key, initial] of Object.entries(defaults)) {
    if (full && !(key in input))
      throw new Error('Advanced settings must match the default template');
    const value = key in input ? input[key] : initial;
    if (typeof initial === 'object') {
      result[key] = merge(initial, value, full);
      continue;
    }
    if (typeof value !== typeof initial) throw new Error('Invalid setting: ' + key);
    if (typeof value === 'number') {
      const rule = limits(key);
      if (
        !Number.isFinite(value) ||
        (!FLOAT_KEYS.has(key) && !Number.isInteger(value)) ||
        value < rule.min ||
        (rule.exclusive_min && value === rule.min) ||
        value > (rule.max ?? Infinity) ||
        rule.exclude?.includes(value)
      )
        throw new Error('Invalid setting: ' + key);
    }
    result[key] = value;
  }
  return result;
}
function validateSpeech(settings, defaults, migrate = false) {
  const live = settings.live_asr;
  if (live.quiet_speech_min_seconds > live.quiet_speech_max_seconds) {
    if (!migrate)
      throw new Error('quiet_speech_min_seconds must not exceed quiet_speech_max_seconds');
    live.quiet_speech_min_seconds = live.quiet_speech_max_seconds;
  }
  for (const [language, params] of Object.entries(settings.vad))
    if (params.max_speech_duration < minimumCap(params)) {
      if (!migrate) throw new Error('Invalid VAD speech cap');
      params.max_speech_duration = Math.max(
        minimumCap(params),
        defaults.vad[language].max_speech_duration,
      );
    }
  const minimum = Math.max(...Object.values(settings.vad).map(minimumCap));
  if ((live.max_speech_seconds || defaults.live_asr.max_speech_seconds) < minimum) {
    if (!migrate) throw new Error('Invalid live speech cap');
    live.max_speech_seconds = Math.max(minimum, defaults.live_asr.max_speech_seconds);
  }
  return settings;
}
class Configuration {
  constructor(root, resource = path.join(__dirname, '../../backend/settings.json')) {
    this.file = path.join(root, 'advanced-settings.json');
    this.defaults = JSON.parse(fs.readFileSync(resource, 'utf8'));
    this.value = structuredClone(this.defaults);
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (Number.isInteger(raw.audio?.sample_rate) && raw.audio.sample_rate > 0)
          raw.audio.sample_rate = 16000;
        const live = raw.live_asr;
        if (live && typeof live === 'object') {
          if (Number.isInteger(live.quiet_speech_recovery))
            live.quiet_speech_recovery = Number(Boolean(live.quiet_speech_recovery));
          for (const key of [
            'quiet_speech_min_seconds',
            'quiet_speech_max_seconds',
            'quiet_speech_level_ratio',
          ]) {
            const value = live[key];
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;
            if (key === 'quiet_speech_max_seconds' && value <= 0)
              live[key] = this.defaults.live_asr[key];
            else if (key === 'quiet_speech_level_ratio')
              live[key] = Math.max(0, Math.min(1, value));
            else live[key] = Math.max(0, value);
          }
        }
        this.value = validateSpeech(merge(this.defaults, raw), this.defaults, true);
      } catch {
        fs.renameSync(this.file, this.file + '.corrupt-' + randomUUID());
      }
    }
  }
  save(input) {
    const value = validateSpeech(merge(this.defaults, input, true), this.defaults);
    const temp = this.file + '.' + randomUUID();
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(value, null, 2));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.value = value;
    return value;
  }
  metadata(runtime) {
    const fields = {};
    function walk(value, prefix = '') {
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'object') walk(child, prefix + key + '.');
        else if (typeof child === 'number') fields[prefix + key] = limits(key);
      }
    }
    walk(this.value);
    for (const [language, params] of Object.entries(this.value.vad))
      Object.assign(fields['vad.' + language + '.max_speech_duration'], {
        min: minimumCap(params),
        exclusive_min: false,
      });
    return {
      settings: this.value,
      defaults: this.defaults,
      vad_runtime: runtime,
      inactive_fields: [
        'boundary_tail_seconds',
        'speaker_change_detection',
        'num_speakers',
        ...(runtime === 'mlx-audio'
          ? ['quiet_speech_min_seconds', 'quiet_speech_max_seconds', 'quiet_speech_level_ratio']
          : []),
      ],
      field_constraints: fields,
      speech_cap_default_seconds: this.defaults.live_asr.max_speech_seconds,
      speech_window_seconds: 0.032,
      speech_overlap_seconds: 0.4,
      speech_cap_minimum: Math.max(...Object.values(this.value.vad).map(minimumCap)),
      diarization_chunk_floor_ms: 0,
    };
  }
}
module.exports = { Configuration };
