// 浏览器集成测试使用确定性设备；真实系统采集由原生成品测试覆盖。
const { EventEmitter } = require('node:events');
const path = require('node:path');
class TestAudio extends EventEmitter {
  cancelMeetingProbe() {} // Test probes resolve immediately without starting a helper.
  async query(command) {
    if (command === 'meeting-audio') return { active: [], audible: null };
    if (command === 'devices') return [{ deviceId: 'test-mic', label: 'Test microphone' }];
    if (command.startsWith('request-')) return true;
    return { microphone: 'granted', screen: 'granted', systemAudioSupported: true };
  }
  async prepare(options, append, publish) {
    this.session = { options, append, publish };
    return { micFellBack: false };
  }
  async command(command, meeting) {
    if (command === 'start' && this.session) this.session.meeting = meeting;
    if (command === 'stop') this.session = null;
    return true;
  }
  dispose() {
    this.session = null;
  }
}
require.cache[require.resolve('../macos/native-audio.cjs')] = {
  id: require.resolve('../macos/native-audio.cjs'),
  filename: require.resolve('../macos/native-audio.cjs'),
  loaded: true,
  exports: { NativeAudio: TestAudio },
};
require(path.join(__dirname, '../macos/control.cjs'));
