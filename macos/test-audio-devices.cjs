// 手动硬件回归：node macos/test-audio-devices.cjs <brevia-audio> [设备 UID ...]
// 仅检查电平事件与 PCM 帧数，不保存或输出设备采集的音频。
const assert = require('node:assert/strict');
const path = require('node:path');
const { NativeAudio } = require('./native-audio.cjs');

async function check() {
  assert.ok(process.argv[2], '请提供待验证的 brevia-audio 路径');
  process.env.BREVIA_AUDIO_HELPER = path.resolve(process.argv[2]);
  const audio = new NativeAudio();
  const devices = ['', ...process.argv.slice(3), 'brevia-disconnected-test-device'];
  try {
    for (const deviceId of devices) {
      console.log(`CHECK: ${deviceId || '系统默认'}`);
      let levels = 0;
      let samples = 0;
      let captureError;
      const publish = (type, frame) => {
        if (type === 'native-audio.level') levels++;
        if (type === 'native-audio.error') captureError = new Error(frame.message);
      };
      const append = async (frame) => {
        if (frame.track === 'mic') {
          assert.equal(frame.sample_rate, 16000);
          assert.ok(frame.start_ms >= 0 && frame.start_ms < 3000, '麦克风时间戳应对齐会议起点');
          samples += Buffer.from(frame.pcm, 'base64').length / 2;
        }
      };
      const preview = await audio.prepare(
        { mic: true, system: false, deviceId, preview: true },
        append,
        publish,
      );
      assert.equal(preview.micFellBack, deviceId === devices.at(-1));
      await new Promise((resolve) => setTimeout(resolve, 600));
      await audio.command('stop');
      assert.ok(levels > 0, '预览必须持续交付电平，静音也应有事件');
      assert.equal(samples, 0, '预览不能发送录音');
      await audio.prepare({ mic: true, system: true, deviceId }, append, publish);
      await audio.command('start', 'hardware-test');
      await new Promise((resolve) => setTimeout(resolve, 600));
      await audio.command('pause');
      assert.ok(samples > 0, '双轨录音必须交付麦克风 PCM');
      const pausedSamples = samples;
      await audio.command('resume');
      await new Promise((resolve) => setTimeout(resolve, 600));
      await audio.command('stop');
      assert.ok(samples > pausedSamples, '恢复后必须继续交付 PCM');
      assert.ifError(captureError);
      console.log(`PASS: ${deviceId || '系统默认'}，预览 → 双轨 → 暂停/恢复 → 停止`);
    }
  } finally {
    audio.dispose();
  }
}

check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
