const micMessage = (key) => {
  let locale = 'zh';
  if (typeof localStorage !== 'undefined') {
    try {
      locale = localStorage.getItem('brevia-language') || 'zh';
    } catch {
      /* 回退到中文。 */
    }
  }
  return window.BreviaLocaleData?.translate(key, locale) || key;
};

class NativeAudioCapture {
  constructor(onLevel, onError) {
    this.onLevel = onLevel;
    this.onError = onError;
    this.paused = false;
    this.unsubscribe = [];
  }

  attach() {
    this.unsubscribe.push(
      window.brevia.on('native-audio.level', ({ track, level }) => this.onLevel?.(track, level)),
      window.brevia.on('native-audio.error', ({ message }) =>
        this.onError?.(new Error(micMessage(message))),
      ),
    );
  }

  async prepare({ mic, system }, preview = false) {
    this.attach();
    this.preparing = window.brevia.nativeAudio.prepare({
      mic: Boolean(mic),
      system: Boolean(system),
      deviceId: this.micDeviceId || '',
      preview,
    });
    const { micFellBack } = await this.preparing;
    return micFellBack;
  }

  async previewMic() {
    if (this.preparing) return false;
    try {
      return await this.prepare({ mic: true }, true);
    } catch (error) {
      await this.stop().catch(() => {});
      this.preparing = null;
      this.stopPromise = null;
      throw error;
    }
  }

  start(meetingId) {
    this.meetingId = meetingId;
    return window.brevia.nativeAudio.start({ meeting_id: meetingId });
  }

  async setPaused(paused) {
    const result = await window.brevia.nativeAudio.pause({ paused });
    this.paused = paused;
    return result;
  }

  stop() {
    // 预览权限弹窗可能仍打开；只有本实例的设备获取完成后才释放它。
    return (this.stopPromise ??= (async () => {
      try {
        if (this.preparing) {
          await this.preparing;
          await window.brevia.nativeAudio.stop();
        }
      } finally {
        for (const off of this.unsubscribe.splice(0)) off();
      }
    })());
  }
}

window.breviaClient = window.brevia
  ? {
      state: { meeting: null, selectedMeetingId: null, initialized: null, inputs: null },
      capture: null,
      starting: false,
      stopping: false,
      preview: null,
      onLevel: null,
      onCaptureError: null,
      micDeviceId: '',
      // 设置要使用的麦克风设备(空串表示系统默认)。同时应用到现有与后续创建的采集实例。
      setMicDevice(deviceId) {
        this.micDeviceId = deviceId || '';
        if (this.capture) this.capture.micDeviceId = this.micDeviceId;
        if (this.preview) this.preview.micDeviceId = this.micDeviceId;
      },
      // 枚举系统可用的麦克风输入设备,供录制前页的下拉选择。
      async listMicrophones() {
        return window.brevia.nativeAudio.devices();
      },
      async initialize() {
        const result = await window.brevia.initialize();
        this.state.initialized = result;
        return result;
      },
      adoptNativeRecording(meeting, inputs) {
        if (this.state.meeting?.id === meeting.id) return;
        const capture = new NativeAudioCapture(this.onLevel, (error) =>
          this.onCaptureError?.(error),
        );
        capture.attach();
        capture.meetingId = meeting.id;
        // 宿主已取得设备确认，接管已有采集而不再次打开麦克风。
        capture.preparing = Promise.resolve();
        this.capture = capture;
        this.state.meeting = meeting;
        this.state.selectedMeetingId = meeting.id;
        this.state.inputs = inputs;
      },
      async start(payload, inputs, micDeviceId) {
        if (this.starting || this.stopping || this.state.meeting)
          throw new Error(micMessage('error.recording.start_busy'));
        this.starting = true;
        let capture, meeting;
        try {
          await this.stopPreview();
          if (inputs.phone) {
            const meeting = await window.brevia.mobile.startCapture({
              ...payload,
              device_id: inputs.phone,
            });
            this.state.meeting = meeting;
            this.state.selectedMeetingId = meeting.id;
            this.state.inputs = { ...inputs };
            return meeting;
          }
          capture = new NativeAudioCapture(this.onLevel, (error) => this.onCaptureError?.(error));
          capture.micDeviceId = micDeviceId ?? this.micDeviceId;
          if (inputs.system) {
            const permissions = await window.brevia.permissions.status();
            if (permissions.systemAudioSupported === false)
              throw new Error(micMessage('当前系统不支持直接录制系统音频，请仅使用麦克风'));
          }
          await capture.prepare(inputs);
          const startPayload = {
            ...payload,
            audio_tracks: Object.keys(inputs).filter((track) => inputs[track]),
          };
          meeting = await window.brevia.meeting.start(startPayload);
          if (meeting?.model_required) {
            await capture.stop();
            return meeting;
          }
          await capture.start(meeting.id);
          this.capture = capture;
          this.state.meeting = meeting;
          this.state.selectedMeetingId = meeting.id;
          this.state.inputs = { ...inputs };
          return meeting;
        } catch (error) {
          // 只释放本次启动拥有的采集；清理失败不能掩盖原始错误。
          try {
            await capture?.stop();
          } catch (cleanupError) {
            console.error('Audio capture cleanup failed', cleanupError);
          }
          if (meeting?.id) {
            try {
              await window.brevia.meeting.stop({ meeting_id: meeting.id, duration_ms: 0 });
            } catch (cleanupError) {
              console.error('Meeting stop after failed start', cleanupError);
            }
          }
          throw error;
        } finally {
          this.starting = false;
        }
      },
      async previewMic() {
        if (!this.preview) {
          this.preview = new NativeAudioCapture(this.onLevel);
          this.preview.micDeviceId = this.micDeviceId;
        }
        return this.preview.previewMic();
      },
      async stopPreview() {
        if (!this.preview) return;
        const preview = this.preview;
        this.preview = null;
        await preview.stop();
      },
      async pause(paused) {
        const meetingId = this.state.meeting?.id || this.capture?.meetingId;
        if (!meetingId) throw new Error(micMessage('当前没有正在进行的会议'));
        if (this.state.meeting?.tags?.includes('手机麦克风'))
          return window.brevia.mobile.pauseCapture({ meeting_id: meetingId, paused });
        const capture = this.capture;
        const previous = Boolean(capture?.paused);
        if (capture) await capture.setPaused(paused);
        try {
          return await window.brevia.meeting.pause({ meeting_id: meetingId, paused });
        } catch (error) {
          // 业务端拒绝切换时，采集状态也须恢复，避免界面继续计时却没有录音。
          try {
            await capture?.setPaused(previous);
          } catch (cleanupError) {
            console.error('Audio pause rollback failed', cleanupError);
          }
          throw error;
        }
      },
      async stop(durationMs) {
        const meetingId = this.state.meeting?.id || this.capture?.meetingId;
        if (!meetingId) throw new Error(micMessage('当前没有正在进行的会议'));
        const capture = this.capture;
        this.stopping = true;
        // 采集侧收尾失败不能阻断后端会议结束：否则 capture.stop() 抛错会让 meeting.stop 永远
        // 不被调用，会议在后端一直处于进行中。
        try {
          try {
            if (capture) await capture.stop();
          } catch (error) {
            console.error('Audio capture cleanup failed', error);
          }
          const meeting = await window.brevia.meeting.stop({
            meeting_id: meetingId,
            duration_ms: durationMs,
          });
          this.state.meeting = null;
          this.state.inputs = null;
          return meeting;
        } finally {
          this.capture = null;
          this.stopping = false;
        }
      },
    }
  : null;
