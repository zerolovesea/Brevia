const { isDeepStrictEqual } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { schemas, failure } = require('./agent-contract.cjs');
const control = schemas['recording.control'];

function createRecordingController({
  worker,
  mobileServer,
  nativeAudio,
  desktop,
  parseStart,
  parseAudio,
  resetCaptions,
}) {
  const requests = new Map();
  let queue = Promise.resolve();

  function publish(meeting, target, state, inputs) {
    const event = { meeting_id: meeting.id, target, state, confirmed: true, meeting, inputs };
    worker.sendEvent('agent.recording', event);
    desktop.update({
      ready: true,
      elapsed: 0,
      level: 0,
      input: '',
      canPause: true,
      captions: [],
      notes: '',
      suggestion: null,
      aiEnabled: false,
      aiBusy: false,
      error: '',
      ...(desktop.state?.meetingId === meeting.id ? desktop.state : {}),
      locale: desktop.state?.locale || 'en',
      theme: desktop.state?.theme || 'light',
      meetingId: meeting.id,
      title: meeting.title || '',
      phase: state === 'stopped' ? (target === 'computer' ? 'saved' : 'saving') : state,
    });
    return { meeting_id: meeting.id, target, state, confirmed: true };
  }

  async function waitForPhone(session, expected) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (
        expected === 'stopped'
          ? session.ended && session.state === 'ended'
          : session.state === expected && !session.ended
      )
        return;
      if (
        session.captureError ||
        (expected !== 'stopped' && (session.ended || session.state === 'interrupted'))
      )
        throw failure('DEVICE_FAILED', session.captureError || 'The phone interrupted recording');
      await delay(100);
    }
    throw failure('DEVICE_TIMEOUT', `The phone did not confirm ${expected}`);
  }

  async function perform(payload) {
    const value = control.parse(payload);
    const { action, target, meeting_id: meetingId } = value;
    if (action === 'start') {
      const deadline = Date.now() + 30000;
      while (!desktop.state?.ready) {
        if (Date.now() >= deadline)
          throw failure('UI_NOT_READY', 'Brevia recording controls did not become ready');
        await delay(100);
      }
    }
    if (target !== 'computer') {
      let meeting;
      let session;
      if (action === 'start') {
        meeting = await mobileServer.startCapture(target, await parseStart(payload));
        session = mobileServer.sessions.get(meeting.id);
        try {
          await waitForPhone(session, 'recording');
        } catch (error) {
          // 超时后撤回开始指令，避免手机稍后联网时意外打开麦克风。
          await mobileServer.requestStop(meeting.id).catch((cleanupError) => {
            session.stopRequested = true;
            worker.sendEvent('worker.error', {
              meeting_id: meeting.id,
              message: cleanupError.message,
            });
          });
          throw error;
        }
      } else {
        session = [...mobileServer.sessions.values()].find(
          (item) =>
            item.owner === target && !item.finished && (!meetingId || item.id === meetingId),
        );
        if (!session) throw failure('NO_RECORDING', 'No active recording on this phone');
        if (action === 'stop') await mobileServer.requestStop(session.id);
        else await mobileServer.pauseCapture(session.id, action === 'pause');
        await waitForPhone(
          session,
          action === 'stop' ? 'stopped' : action === 'pause' ? 'paused' : 'recording',
        );
        meeting = await worker.request('meeting.get', { meeting_id: session.id });
      }
      return publish(
        meeting,
        target,
        action === 'stop' ? 'stopped' : action === 'pause' ? 'paused' : 'recording',
        { phone: target },
      );
    }
    if (!nativeAudio) {
      if (
        action === 'start' &&
        (worker.active || [...mobileServer.sessions.values()].some((s) => !s.finished))
      )
        throw failure('RECORDING_BUSY', 'Finish the active recording and phone upload first');
      const active = worker.active;
      if (
        action !== 'start' &&
        (!active || active.mobile || (meetingId && active.meeting_id !== meetingId))
      )
        throw failure('NO_RECORDING', 'No matching computer recording');
      const recording =
        action === 'start'
          ? {
              ...value,
              ...(await parseStart({ ...payload, audio_tracks: value.audio_tracks || ['mic'] })),
            }
          : { ...value, meeting_id: active.meeting_id };
      const result = await desktop.action('agent-recording', {
        recording,
        background: true,
        ...(recording.meeting_id ? { meetingId: recording.meeting_id } : {}),
      });
      if (result?.model_required)
        throw failure(
          'MODEL_NOT_INSTALLED',
          'Install the required local models: ' + result.model_required.join(', '),
        );
      if (!result?.confirmed)
        throw failure('DEVICE_FAILED', 'The audio capture did not confirm recording');
      return { ...result, target };
    }
    if (action === 'start') {
      if (worker.active || [...mobileServer.sessions.values()].some((s) => !s.finished))
        throw failure('RECORDING_BUSY', 'Finish the active recording and phone upload first');
      const tracks = value.audio_tracks || ['mic'];
      const inputs = {
        mic: tracks.includes('mic'),
        system: tracks.includes('system'),
        deviceId: value.device_id,
      };
      const start = await parseStart({
        ...payload,
        audio_tracks: ['mic', 'system'].filter((key) => inputs[key]),
      });
      if (!inputs.mic && !inputs.system) throw failure('INVALID_INPUT', 'Select an audio input');
      if (inputs.system && (await nativeAudio.query('permissions')).systemAudioSupported === false)
        throw failure('UNSUPPORTED', 'System audio capture is not supported');
      let meeting;
      let prepared = false;
      try {
        await nativeAudio.prepare(
          inputs,
          (frame) => {
            if (worker.active?.meeting_id !== frame.meeting_id)
              throw failure('NO_RECORDING', 'Recording has ended');
            return worker.request('meeting.audio', parseAudio(frame));
          },
          (type, event) => worker.sendEvent(type, event),
        );
        prepared = true;
        meeting = await worker.request('meeting.start', { ...start, require_models: false });
        worker.active = { meeting_id: meeting.id, started_at: Date.now() };
        worker.restarts = 0;
        resetCaptions();
        await nativeAudio.command('start', meeting.id);
        return publish(meeting, target, 'recording', inputs);
      } catch (error) {
        if (prepared) await nativeAudio.command('stop').catch(() => {});
        if (meeting) {
          try {
            await worker.request('meeting.stop', { meeting_id: meeting.id, duration_ms: 0 });
            if (worker.active?.meeting_id === meeting.id) worker.active = null;
          } catch (cleanupError) {
            worker.sendEvent('worker.error', {
              meeting_id: meeting.id,
              message: cleanupError.message,
            });
          }
        }
        throw error;
      }
    }
    const active = worker.active;
    if (!active || active.mobile || (meetingId && active.meeting_id !== meetingId))
      throw failure('NO_RECORDING', 'No matching computer recording');
    if (action === 'stop') {
      // 先等待采集器排空 PCM，再结束业务会议，不能丢失最后一批音频。
      await nativeAudio.command('stop');
      const meeting = await worker.request('meeting.stop', {
        meeting_id: active.meeting_id,
        duration_ms: Math.max(0, Date.now() - active.started_at),
      });
      if (worker.active === active) worker.active = null;
      worker.recycle();
      return publish(meeting, target, 'stopped');
    }
    const paused = action === 'pause',
      wasPaused = Boolean(active.paused);
    await nativeAudio.command(paused ? 'pause' : 'resume');
    let result;
    try {
      result = await worker.request('meeting.pause', { meeting_id: active.meeting_id, paused });
    } catch (error) {
      await nativeAudio.command(wasPaused ? 'pause' : 'resume').catch((cleanupError) => {
        worker.sendEvent('worker.error', {
          meeting_id: active.meeting_id,
          message: cleanupError.message,
        });
      });
      throw error;
    }
    active.paused = result.paused;
    const meeting = await worker.request('meeting.get', { meeting_id: active.meeting_id });
    return publish(meeting, target, paused ? 'paused' : 'recording');
  }

  return function action(payload) {
    const { request_id: requestId } = control.parse(payload);
    const prior = requests.get(requestId);
    if (prior) {
      if (!isDeepStrictEqual(prior.payload, payload))
        throw failure(
          'REQUEST_CONFLICT',
          'This request_id was already used with different parameters',
        );
      return prior.promise;
    }
    // 去重记录在当前应用会话内保留；到达上限时明确拒绝，不能静默重放旧指令。
    if (requests.size >= 4096)
      throw failure(
        'REQUEST_LIMIT',
        'Recording request limit reached; restart Brevia after stopping recording',
      );
    const copy = structuredClone(payload);
    const promise = queue.then(() => perform(copy));
    queue = promise.catch(() => {});
    requests.set(requestId, { payload: copy, promise });
    return promise;
  };
}
module.exports = { createRecordingController };
