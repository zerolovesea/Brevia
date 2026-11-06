#if BREVIA_AUDIO_TEST
  import AVFoundation
  import Foundation

  @main
  struct AudioTests {
    static func main() throws {
      // 短帧检查重采样、恢复前裁剪和非整包收尾；用生成的恒幅音频，不访问用户设备。
      let input = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
      let buffer = AVAudioPCMBuffer(pcmFormat: input, frameCapacity: 2400)!
      buffer.frameLength = 2400
      for channel in 0..<2 {
        for frame in 0..<2400 { buffer.floatChannelData![channel][frame] = 0.25 }
      }
      let track = Track("system")
      track.minimumFrame = 640
      try track.append(buffer, position: 320)
      precondition(track.startFrame == 640)
      precondition(track.nextFrame == 1120)
      precondition(track.samples.count == 480 * 2)
      precondition(track.samples.withUnsafeBytes { $0.loadUnaligned(as: Int16.self) } > 7000)
      try track.finish()
      precondition(track.samples.isEmpty && track.nextFrame == nil)
    }
  }
#endif
