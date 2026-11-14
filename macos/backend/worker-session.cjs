const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ModelNotInstalled, modelSupportsLanguage } = require('./models.cjs');
const { AlignedAudioMixer, pcmFloats, floatPCM } = require('./audio-mixer.cjs');
const { cleanText, LiveSubtitles } = require('./subtitles.cjs');
const { convertToPCM, wavInfo } = require('./audio-io.cjs');
const { SentenceVAD } = require('./sentence-vad.cjs');
const { LiveSpeakers } = require('./live-speakers.cjs');

function attachRecording(worker) {
  worker.recordingTail = Promise.resolve();
  worker.serialRecording = (fn) => {
    const result = worker.recordingTail.then(fn);
    worker.recordingTail = result.catch(() => {});
    return result;
  };
  worker.decodePCM = (value) => {
    if (
      typeof value !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    )
      throw new Error('Invalid PCM');
    const pcm = Buffer.from(value, 'base64');
    if (pcm.length % 2) throw new Error('PCM16 audio has an invalid byte length');
    return pcm;
  };
  worker.sentencePayload = (payload) => {
    const language = payload.language || 'auto';
    let id = payload.refined_model_id || worker.models.defaultModel(language);
    const prior = worker.models.isKnown(id) && worker.models.get(id);
    // 旧会议的退役或另一平台模型使用本机候选；未知 ID 仍交给目录校验拒绝。
    if (
      prior?.retired ||
      (!prior &&
        worker.models.all.some((model) => model.id === id && model.stages?.includes('refined')))
    )
      id = worker.models.defaultModel(language, id);
    const model = worker.models.get(id);
    if (!model.capabilities.transcription)
      throw new Error('Sentence transcription requires an offline ASR model');
    if (!modelSupportsLanguage(model, language))
      throw new Error('Model ' + id + ' does not support ' + language);
    return {
      ...payload,
      language,
      refined_model_id: id,
      vad_model_id: payload.vad_model_id || 'silero-vad',
    };
  };
  worker.loadRecognition = async (meeting) => {
    const missing = worker.models.missing([
      meeting.refined_model_id,
      meeting.vad_model_id || 'silero-vad',
    ]);
    if (missing.length) throw new ModelNotInstalled(missing);
    const model = worker.models.get(meeting.refined_model_id),
      recognizer = worker.newEngine(model.runtime),
      vads = new Map();
    try {
      const info = await recognizer.request('asr.load', {
        path: worker.models.path(model.id),
        kind: model.kind,
        ...(model.runtime === 'mlx-audio' && worker.models.recognitionDevice()),
        files: model.files,
        language: meeting.language,
        hotwords: worker.store.asrTermOptions(meeting).hotwords || [],
        threads: 2,
      });
      const vad = worker.settings.vad[meeting.language] || worker.settings.vad.default;
      const maximum = Math.min(
        info.max_speech_seconds || 20,
        worker.settings.live_asr.max_speech_seconds || 22,
        vad.max_speech_duration,
      );
      return {
        recognizer,
        vads,
        maximum,
        tailHoldMs: Math.max(6, maximum + 2) * 1000,
        meeting,
      };
    } catch (error) {
      recognizer.close();
      throw error;
    }
  };
  worker.prepareRecording = async (meeting, startMs = 0, tracks = [], requireASR = false) => {
    worker.active = meeting.id;
    const session = {
      meeting,
      startMs,
      sequence: 0,
      preprocess: Promise.resolve(),
      decode: Promise.resolve(),
      queued: 0,
      preprocessingQueued: 0,
      subtitleExpiryMs: 0,
      previewed: new Set(),
      previews: new Map(),
      overloaded: false,
      recognition: null,
      mixer:
        tracks.includes('mic') && tracks.includes('system')
          ? new AlignedAudioMixer(16000, worker.settings.live_asr.mix_max_delay_ms)
          : null,
    };
    session.subtitles = new LiveSubtitles((event, voiceSpans) => {
      if (!worker.store.saveSegment(event)) return;
      worker.emit('transcript.final', event);
      worker.emit('transcript.settled', event);
      session.liveSpeakers.enqueue(event, voiceSpans);
      try {
        worker.aiNoteOnSegment?.(event);
      } catch (error) {
        worker.emit('worker.warning', { meeting_id: meeting.id, message: error.message });
      }
    });
    worker.session = session;
    session.liveSpeakers = new LiveSpeakers(worker, session);
    try {
      session.recognition = await worker.loadRecognition(meeting);
    } catch (error) {
      if (requireASR) {
        session.liveSpeakers.close();
        worker.session = null;
        worker.active = null;
        throw error;
      }
      worker.emit('worker.warning', {
        meeting_id: meeting.id,
        code: 'asr_unavailable',
        message: error.message,
      });
    }
  };
  worker.startRecording = async (payload) => {
    if (worker.active) throw new Error('A meeting is already active');
    const value = worker.sentencePayload(payload),
      missing = worker.models.missing([
        value.refined_model_id,
        value.vad_model_id,
        ...(value.target_language ? ['hy-mt2-1.8b-q4km'] : []),
      ]);
    if (value.require_models && missing.length) throw new ModelNotInstalled(missing);
    const date = new Date(),
      meeting = worker.store.createMeeting({
        ...value,
        meeting_date: [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-'),
      });
    await worker.prepareRecording(meeting, 0, payload.audio_tracks || []);
    worker.emit('meeting.started', { meeting_id: meeting.id, meeting });
    return meeting;
  };
  worker.requireActive = (id) => {
    if (worker.active !== id) throw new Error('Meeting is not active');
  };
  function draft(session, track, partial) {
    const settled = session.subtitles.draft(track);
    const value = partial?.text
      ? { ...partial, text: [settled.text, partial.text].filter(Boolean).join(' ') }
      : settled.text
        ? settled
        : session.previews.get(track) || settled;
    worker.emit('transcript.draft', {
      meeting_id: session.meeting.id,
      segment_id: 'draft-' + track,
      track,
      speaker: track === 'mic' ? 'local-user' : 'spk-1',
      ...value,
    });
  }
  function queuePreview(session, track, segment, recognition) {
    session.previewed.add(track);
    // 首段草稿不切断 VAD，也不写会议；正式整句识别仍保留完整上下文。
    session.decode = session.decode.then(async () => {
      session.decoding = true;
      const update = (text) => {
        session.previews.set(track, {
          start_ms: segment.start_ms,
          end_ms: segment.end_ms,
          text: cleanText(text),
        });
        draft(session, track);
      };
      try {
        const result = await recognition.recognizer.request(
          'asr.decode',
          { pcm: segment.pcm, sample_rate: 16000 },
          { onEvent: (message) => update(message.text || message.payload?.text) },
        );
        update(result.text);
      } catch (error) {
        worker.emit('worker.warning', {
          meeting_id: session.meeting.id,
          code: 'sentence_transcription_failed',
          message: error.message,
        });
      } finally {
        session.decoding = false;
      }
    });
  }
  function queueSentence(session, track, segment, recognition) {
    if (session.overloaded) return;
    session.previewed.add(track);
    if (session.queued >= 64) {
      session.overloaded = true;
      worker.emit('worker.warning', {
        meeting_id: session.meeting.id,
        code: 'asr_unavailable',
        message: 'Live recognition cannot keep up; original audio is saved.',
      });
      return;
    }
    const file = path.join(
      worker.store.meetingDir(session.meeting.id),
      'audio',
      'sentence-' + randomUUID() + '.pcm',
    );
    fs.writeFileSync(file, Buffer.from(segment.pcm, 'base64'), { flag: 'wx', mode: 0o600 });
    const event = {
      meeting_id: session.meeting.id,
      segment_id: track + '-' + segment.start_ms + '-' + session.sequence++,
      revision: 1,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      boundary: segment.boundary || 'endpoint',
      speaker: track === 'mic' ? 'local-user' : 'spk-1',
      speaker_name: null,
      track,
    };
    session.queued++;
    session.decode = session.decode.then(async () => {
      session.decoding = true;
      try {
        const result = await recognition.recognizer.request(
          'asr.decode',
          { pcm: fs.readFileSync(file).toString('base64'), sample_rate: 16000 },
          {
            onEvent: (message) =>
              draft(session, track, {
                start_ms: event.start_ms,
                end_ms: event.end_ms,
                text: cleanText(message.text || message.payload?.text),
              }),
          },
        );
        const text = cleanText(result.text);
        session.previews.delete(track);
        if (!text) return;
        if (result.words?.length)
          event.word_timestamps = result.words.map((word) => ({
            ...word,
            start_ms: event.start_ms + word.start_ms,
            end_ms: event.start_ms + word.end_ms,
          }));
        session.subtitles.push(event, text, segment.voiceSpans || []);
        session.subtitles.flush(event.end_ms, recognition.tailHoldMs);
      } catch (error) {
        worker.emit('worker.warning', {
          meeting_id: session.meeting.id,
          code: 'sentence_transcription_failed',
          message: error.message,
          start_ms: event.start_ms,
          end_ms: event.end_ms,
        });
      } finally {
        session.decoding = false;
        session.queued--;
        fs.rmSync(file, { force: true });
        draft(session, track);
      }
    });
  }
  async function feed(session, track, samples, startMs) {
    const recognition = session.recognition;
    if (!recognition || session.overloaded || !samples.length) return;
    let vad = recognition.vads.get(track);
    if (vad && Math.abs(startMs - (vad.origin + vad.samples / 16)) > 2) {
      for (const part of await vad.flush()) queueSentence(session, track, part, recognition);
      vad.close();
      recognition.vads.delete(track);
      vad = null;
    }
    if (!vad) {
      vad = new SentenceVAD(worker, session.meeting, recognition.maximum, startMs);
      try {
        await vad.load();
      } catch (error) {
        vad.close();
        throw error;
      }
      recognition.vads.set(track, vad);
    }
    for (const part of await vad.accept(floatPCM(samples), startMs))
      queueSentence(session, track, part, recognition);
    if (!session.previewed.has(track) && !session.queued) {
      const preview = vad.preview();
      if (preview) queuePreview(session, track, preview, recognition);
    }
  }
  worker.recordAudio = async (payload) => {
    worker.requireActive(payload.meeting_id);
    if (
      !['mic', 'system', 'mix'].includes(payload.track) ||
      payload.sample_rate !== 16000 ||
      !Number.isFinite(payload.start_ms) ||
      payload.start_ms < 0
    )
      throw new Error('Invalid audio track, sample rate or timestamp');
    const session = worker.session,
      pcm = worker.decodePCM(payload.pcm);
    const total =
      payload.track === 'mix' || !pcm.length
        ? 0
        : worker.store.appendAudio(worker.active, payload.track, pcm, 16000, payload.start_ms);
    if (session?.recognition && !session.overloaded && session.preprocessingQueued >= 64) {
      session.overloaded = true;
      worker.emit('worker.warning', {
        meeting_id: payload.meeting_id,
        code: 'asr_unavailable',
        message: 'Live recognition cannot keep up; original audio is saved.',
      });
    }
    if (session?.recognition && !session.overloaded) {
      session.preprocessingQueued++;
      const samples = pcmFloats(pcm);
      if (payload.track === 'mic' && samples.length) {
        let power = 0,
          peak = 0;
        for (const value of samples) {
          power += value * value;
          peak = Math.max(peak, Math.abs(value));
        }
        const rms = Math.sqrt(power / samples.length),
          config = worker.settings.live_asr;
        if (rms >= config.microphone_minimum_rms) {
          const gain = Math.min(
            config.microphone_max_gain,
            config.microphone_target_rms / rms,
            peak ? config.microphone_peak / peak : Infinity,
          );
          if (gain > 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
        }
      }
      session.preprocess = session.preprocess
        .then(async () => {
          const windows =
            session.mixer && payload.track !== 'mix'
              ? session.mixer.accept(payload.track, samples, payload.start_ms)
              : [{ samples, start_ms: payload.start_ms }];
          for (const window of windows)
            await feed(
              session,
              session.mixer ? 'mix' : payload.track,
              window.samples,
              window.start_ms,
            );
          if (payload.start_ms >= session.subtitleExpiryMs) {
            session.subtitleExpiryMs = payload.start_ms + 1000;
            session.decode = session.decode.then(() => {
              session.subtitles.flush(payload.start_ms, session.recognition?.tailHoldMs);
              for (const track of ['mic', 'system', 'mix']) draft(session, track);
            });
          }
        })
        .finally(() => {
          session.preprocessingQueued--;
        })
        .catch((error) => {
          session.overloaded = true;
          worker.emit('worker.warning', {
            meeting_id: payload.meeting_id,
            code: 'asr_unavailable',
            message: error.message,
          });
        });
    }
    if (payload.flush) await worker.flushRecognition();
    return { samples: total };
  };
  worker.drainRecognition = async () => {
    const session = worker.session;
    if (!session) return;
    await session.preprocess;
    await session.decode;
  };
  worker.flushRecognition = async () => {
    const session = worker.session;
    if (!session) return;
    await session.preprocess;
    if (session.recognition && !session.overloaded) {
      if (session.mixer)
        for (const window of session.mixer.flush())
          await feed(session, 'mix', window.samples, window.start_ms);
      for (const [track, vad] of session.recognition.vads) {
        for (const part of await vad.flush())
          queueSentence(session, track, part, session.recognition);
        vad.close();
      }
      session.recognition.vads.clear();
    }
    await session.decode;
    session.previews.clear();
    session.subtitles.flush();
    for (const track of ['mic', 'system', 'mix']) draft(session, track);
  };
  worker.closeRecognition = (session) => {
    session?.recognition?.recognizer.close();
    for (const vad of session?.recognition?.vads.values() || []) vad.close();
    if (session) session.recognition = null;
  };
  worker.stopRecording = async (payload) => {
    worker.requireActive(payload.meeting_id);
    const session = worker.session;
    session?.liveSpeakers.close();
    try {
      await worker.flushRecognition();
    } finally {
      worker.closeRecognition(session);
      await worker.shutdownAiNote?.();
    }
    // 音轨时间轴已扣除暂停；没有原轨的兼容会话仍保留调用方时长。
    const duration =
      worker.store.recordedDurationMs(payload.meeting_id) || payload.duration_ms || 0;
    const meeting = await worker.store.finishMeeting(payload.meeting_id, duration);
    worker.session = null;
    worker.active = null;
    worker.emit('meeting.stopped', { meeting_id: meeting.id, meeting });
    return meeting;
  };
  return {
    'meeting.start': (p) => worker.serialRecording(() => worker.startRecording(p)),
    'meeting.audio': (p) => worker.serialRecording(() => worker.recordAudio(p)),
    'meeting.stop': (p) => worker.serialRecording(() => worker.stopRecording(p)),
    'meeting.pause': (p) =>
      worker.serialRecording(async () => {
        worker.requireActive(p.meeting_id);
        worker.session?.liveSpeakers.setPaused(Boolean(p.paused));
        if (p.paused) await worker.flushRecognition();
        return { paused: Boolean(p.paused) };
      }),
    'meeting.resume': (p) =>
      worker.serialRecording(async () => {
        if (worker.active) throw new Error('A meeting is already active');
        let meeting = worker.store.getMeeting(p.meeting_id);
        if (meeting.status !== 'recording') throw new Error('Meeting is not recording');
        const prior =
          worker.models.isKnown(meeting.refined_model_id) &&
          worker.models.get(meeting.refined_model_id);
        if (!prior || prior.retired || !modelSupportsLanguage(prior, meeting.language))
          meeting = worker.store.updateMeeting(meeting.id, {
            refined_model_id: worker.models.defaultModel(
              meeting.language,
              meeting.refined_model_id,
            ),
          });
        await worker.prepareRecording(
          meeting,
          worker.store.recordedDurationMs(meeting.id),
          Object.keys(worker.store.readManifest(meeting.id).tracks),
          true,
        );
        worker.emit('meeting.started', { meeting_id: meeting.id, meeting });
        return meeting;
      }),
    'meeting.reconfigure': (p) =>
      worker.serialRecording(async () => {
        worker.requireActive(p.meeting_id);
        const previous = worker.store.getMeeting(p.meeting_id);
        const updated = worker.sentencePayload({ ...previous, ...p });
        if (updated.target_language && !worker.models.isReady('hy-mt2-1.8b-q4km'))
          throw new ModelNotInstalled(['hy-mt2-1.8b-q4km']);
        const recognition = await worker.loadRecognition(updated);
        try {
          await worker.flushRecognition();
          const meeting = worker.store.updateMeeting(p.meeting_id, {
            language: updated.language,
            refined_model_id: updated.refined_model_id,
            target_language: updated.target_language,
          });
          worker.closeRecognition(worker.session);
          worker.session.recognition = recognition;
          worker.session.meeting = meeting;
          worker.session.overloaded = false;
          worker.emit('meeting.reconfigured', { meeting_id: meeting.id, meeting });
          return meeting;
        } catch (error) {
          recognition.recognizer.close();
          throw error;
        }
      }),
    'meeting.import': (p) => {
      const id = p.meeting_id || randomUUID();
      return worker.tasks.running('meeting.import', id, async (control) => {
        const value = worker.sentencePayload({ ...p, meeting_id: id });
        if (!fs.statSync(p.path).isFile()) throw new Error('Audio file not found');
        const meeting = worker.store.createMeeting(value),
          destination = path.join(worker.store.meetingDir(meeting.id), 'audio/playback-mic.wav'),
          engine = worker.newEngine('sherpa-onnx');
        try {
          await convertToPCM(p.path, destination, 16000, 1, engine, { signal: control.signal });
          await control.wait();
          const wav = wavInfo(destination);
          const result = worker.store.finishImportedMeeting(
            meeting.id,
            Math.round((wav.samples * 1000) / wav.sampleRate),
          );
          worker.emit('meeting.imported', { meeting_id: meeting.id, meeting: result });
          return result;
        } catch (error) {
          worker.store.softDelete(meeting.id);
          worker.store.permanentDelete(meeting.id);
          throw error;
        } finally {
          engine.close();
        }
      });
    },
  };
}
module.exports = { attachRecording };
