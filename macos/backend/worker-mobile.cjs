const { modelSupportsLanguage } = require('./models.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { wavHeader, wavInfo } = require('./audio-io.cjs');

function createMobileHandlers(worker) {
  const store = worker.store;
  return {
    'mobile.library': () =>
      store.query(
        'SELECT id,title,status,created_at,duration_ms FROM meetings WHERE deleted_at IS NULL ORDER BY created_at DESC',
      ),
    'mobile.proposal.put': (p) =>
      store.transaction(() => {
        if (!store.one('SELECT 1 FROM meetings WHERE id=? AND deleted_at IS NULL', p.meeting_id))
          return { missing: true };
        const prior = store.one(
          'SELECT id,state FROM mobile_note_proposals WHERE meeting_id=? AND device_id=?',
          p.meeting_id,
          p.device_id,
        );
        if (prior?.id === p.id) return prior;
        if (prior?.state === 'pending') return { conflict: true };
        store.run(
          "INSERT INTO mobile_note_proposals(meeting_id,device_id,id,base_revision,notes,state) VALUES(?,?,?,?,?,'pending') ON CONFLICT(meeting_id,device_id) DO UPDATE SET id=excluded.id,base_revision=excluded.base_revision,notes=excluded.notes,state='pending'",
          p.meeting_id,
          p.device_id,
          p.id,
          p.base_revision,
          p.notes,
        );
        return { id: p.id, state: 'pending' };
      }),
    'mobile.proposal.status': (p) =>
      store.one(
        'SELECT id,state FROM mobile_note_proposals WHERE meeting_id=? AND device_id=?',
        p.meeting_id,
        p.device_id,
      ),
    'mobile.proposal.list': (p) =>
      store.query(
        "SELECT p.*,m.title AS meeting_title FROM mobile_note_proposals p JOIN meetings m ON m.id=p.meeting_id WHERE p.state='pending' AND m.deleted_at IS NULL AND (? IS NULL OR p.meeting_id=?) ORDER BY p.rowid",
        p.meeting_id ?? null,
        p.meeting_id ?? null,
      ),
    'mobile.proposal.resolve': (p) =>
      store.transaction(() => {
        const row = store.one(
          'SELECT p.notes,p.state FROM mobile_note_proposals p JOIN meetings m ON m.id=p.meeting_id WHERE p.meeting_id=? AND p.id=? AND m.deleted_at IS NULL',
          p.meeting_id,
          p.id,
        );
        if (!row || row.state !== 'pending') return { missing: true };
        const result = { id: p.id, meeting_id: p.meeting_id, state: 'declined' };
        if (p.accept) {
          if (
            !store.run(
              'UPDATE meetings SET notes=? WHERE id=? AND notes=?',
              row.notes,
              p.meeting_id,
              p.expected_notes,
            ).changes
          )
            return { conflict: true };
          Object.assign(result, { state: 'accepted', notes: row.notes });
        }
        store.run(
          "UPDATE mobile_note_proposals SET state=?,notes='' WHERE id=?",
          result.state,
          p.id,
        );
        return result;
      }),
    'mobile.proposal.forget': (p) => {
      store.run(
        'DELETE FROM mobile_note_proposals WHERE device_id=? AND meeting_id NOT IN (SELECT value FROM json_each(?))',
        p.device_id,
        JSON.stringify(p.keep_meetings || []),
      );
      return { saved: true };
    },
    'mobile.options': () => ({
      models: worker.models
        .list()
        .filter((m) => m.capabilities.transcription && !m.retired)
        .map((m) => ({
          id: m.id,
          name: m.name,
          status: m.status,
          languages: ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru', 'auto'].filter((language) =>
            modelSupportsLanguage(m, language),
          ),
          default_for_languages: m.default_for_languages || [],
        })),
      workspaces: store.listWorkspaces().map(({ id, name }) => ({ id, name })),
    }),
    'mobile.translate': async (p) => {
      const meeting = store.getMeeting(p.meeting_id, true);
      if (meeting.status === 'recording') throw new Error('请先结束会议');
      if (!meeting.segments?.length) throw new Error('会议暂无可翻译的字幕');
      for (const segment of meeting.segments)
        await worker.handlers['translation.generate']({ ...p, segment_id: segment.id });
      return { translated: true };
    },
    'mobile.prepare': (p) => {
      if (p.id && store.one('SELECT id FROM meetings WHERE id=?', p.id))
        throw new Error('会议编号已存在，请重新创建手机会议');
      const value = worker.sentencePayload(p),
        needed = [value.refined_model_id, value.vad_model_id];
      if (value.target_language) needed.push('hy-mt2-1.8b-q4km');
      const missing = worker.models.missing(needed);
      if (missing.length && p.transfer_mode !== 'import')
        throw new Error('请先在电脑模型库安装所选会议需要的模型：' + missing.join(', '));
      if (value.workspace_id && !store.listWorkspaces().some((w) => w.id === value.workspace_id))
        throw new Error('工作区已不存在，请重新选择');
      return { ready: true };
    },
    'mobile.import': (p) =>
      worker.tasks.running('meeting.import', p.meeting_id, async (control) => {
        const id = p.meeting_id;
        if (
          !/^[a-f0-9-]{36}$/.test(id) ||
          !Number.isSafeInteger(p.count) ||
          p.count < 0 ||
          !Number.isSafeInteger(p.samples) ||
          p.samples < 0 ||
          p.samples * 2 > 0xffffffff - 36
        )
          throw new Error('Invalid mobile import');
        const directory = path.join(worker.root, 'mobile', id);
        if (
          (await fs.realpath(directory)) !== path.join(await fs.realpath(worker.root), 'mobile', id)
        )
          throw new Error('Invalid mobile import directory');
        const source = JSON.parse(await fs.readFile(path.join(directory, 'session.json'), 'utf8'));
        if (
          source.id !== id ||
          source.deleted ||
          source.transfer_mode !== 'import' ||
          !source.ended ||
          source.closedOnDesktop ||
          source.next !== p.count ||
          source.samples !== p.samples
        )
          throw new Error('Mobile recording has not been fully received');
        const row = store.one('SELECT id,deleted_at FROM meetings WHERE id=?', id);
        if (row?.deleted_at) throw new Error('会议已删除，请恢复后重试');
        let meeting;
        if (row) {
          meeting = store.getMeeting(id);
          const manifest = store.readManifest(id);
          if (manifest.mobile_import !== id) throw new Error('会议编号已存在，请重新创建手机会议');
          if (manifest.source === 'audio_import') {
            const info = wavInfo(meeting.audio.playback.mic);
            if (info.frames !== p.samples)
              throw new Error('Imported audio does not match the received recording');
            return meeting;
          }
        } else {
          meeting = store.createMeeting(worker.sentencePayload({ ...p, tags: ['手机录音'] }));
          store.writeManifest(id, { ...store.readManifest(id), mobile_import: id });
        }
        const target = store.checkedAudioPath(id, 'playback-mic.wav'),
          temp = target + '.tmp';
        let output;
        try {
          output = await fs.open(temp, 'w', 0o600);
          await output.writeFile(wavHeader(p.samples * 2, 16000));
          let samples = 0;
          for (let seq = 0; seq < p.count; seq++) {
            await control.wait();
            const chunk = JSON.parse(
              await fs.readFile(path.join(directory, `${seq}.json`), 'utf8'),
            );
            const pcm = worker.decodePCM(chunk.pcm);
            if (
              chunk.seq !== seq ||
              chunk.start_sample !== samples ||
              !pcm.length ||
              pcm.length > 32000
            )
              throw new Error('Invalid mobile audio chunk');
            await output.writeFile(pcm);
            samples += pcm.length / 2;
          }
          if (samples !== p.samples)
            throw new Error('Mobile audio length does not match the receipt');
          await output.sync();
          await output.close();
          output = null;
          await control.wait();
          await fs.rename(temp, target);
          const result = store.finishImportedMeeting(id, p.samples / 16);
          worker.emit('meeting.imported', { meeting_id: id, meeting: result });
          return result;
        } catch (error) {
          store.setStatus(id, 'ready');
          throw error;
        } finally {
          await output?.close();
          await fs.rm(temp, { force: true });
        }
      }),
    'mobile.apply': (p) =>
      worker.serialRecording(async () => {
        if (worker.active && worker.active !== p.meeting_id)
          throw new Error('电脑正在处理另一场录音，请稍后重试');
        const row = store.one('SELECT id,deleted_at FROM meetings WHERE id=?', p.meeting_id);
        if (row?.deleted_at) throw new Error('会议已删除，请恢复后重试');
        let meeting = row ? store.getMeeting(p.meeting_id) : null;
        if (!meeting) {
          if (p.action !== 'start') throw new Error('请先创建手机会议');
          return worker.startRecording({
            ...p,
            tags: p.desktop_capture ? ['手机录音', '手机麦克风'] : ['手机录音'],
            audio_tracks: ['mic'],
          });
        }
        if (p.action === 'start') {
          if (!meeting.tags.includes('手机录音'))
            meeting = store.updateMeeting(meeting.id, { tags: [...meeting.tags, '手机录音'] });
          return meeting;
        }
        if (p.action === 'end' && meeting.status === 'ready' && !worker.active) return meeting;
        if (!worker.active) {
          const prior =
            worker.models.isKnown(meeting.refined_model_id) &&
            worker.models.get(meeting.refined_model_id);
          if (!prior || prior.retired || !modelSupportsLanguage(prior, meeting.language))
            meeting = store.updateMeeting(meeting.id, {
              refined_model_id: worker.models.defaultModel(
                meeting.language,
                meeting.refined_model_id,
              ),
            });
          const manifest = store.readManifest(meeting.id);
          manifest.closed = false;
          store.writeManifest(meeting.id, manifest);
          store.run("UPDATE meetings SET status='recording',ended_at=NULL WHERE id=?", meeting.id);
          await worker.prepareRecording(meeting, store.recordedDurationMs(meeting.id), ['mic']);
        }
        if (p.action === 'end')
          return worker.stopRecording({ meeting_id: meeting.id, duration_ms: p.samples / 16 });
        if (p.action !== 'chunk') throw new Error('Invalid mobile action');
        const pcm = worker.decodePCM(p.pcm),
          start = p.start_sample;
        if (!Number.isSafeInteger(start) || start < 0 || pcm.length === 0 || pcm.length > 32000)
          throw new Error('Invalid PCM chunk');
        const manifest = store.readManifest(meeting.id);
        const recorded = store.audioSessions.has(meeting.id)
          ? manifest.tracks?.mic?.samples || 0
          : store
              .audioFiles(meeting.id)
              .mic.reduce((total, file) => total + store.wavSamples(file), 0);
        if (start > recorded) throw new Error('Missing audio before this chunk');
        const remaining = pcm.subarray(Math.max(0, recorded - start) * 2);
        if (remaining.length)
          await worker.recordAudio({
            meeting_id: meeting.id,
            track: 'mic',
            pcm: remaining.toString('base64'),
            sample_rate: 16000,
            start_ms: recorded / 16,
          });
        await worker.drainRecognition();
        store.flushAudio(meeting.id, true);
        return { samples: Math.max(recorded, start + pcm.length / 2) };
      }),
  };
}
module.exports = { createMobileHandlers };
