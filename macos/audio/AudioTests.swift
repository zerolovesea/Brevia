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
      precondition(containsSystemSound(buffer))
      let quiet = AVAudioPCMBuffer(pcmFormat: input, frameCapacity: 32)!
      quiet.frameLength = 32
      for channel in 0..<2 {
        for frame in 0..<32 { quiet.floatChannelData![channel][frame] = 0 }
      }
      precondition(!containsSystemSound(quiet))
      let copy = try copyAudioBuffer(buffer.audioBufferList, format: input)
      buffer.floatChannelData![0][0] = 0.5
      precondition(copy.frameLength == 2400 && copy.floatChannelData![0][0] == 0.25)
      precondition(copy.floatChannelData![1][2399] == 0.25)
      // 交错声道同样复制全部数据；损坏或不完整的帧拒绝进入重采样队列。
      let interleaved = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 2, interleaved: true)!
      let packed = AVAudioPCMBuffer(pcmFormat: interleaved, frameCapacity: 100)!
      packed.frameLength = 100
      for index in 0..<200 { packed.floatChannelData![0][index] = Float(index) / 200 }
      let packedCopy = try copyAudioBuffer(packed.audioBufferList, format: interleaved)
      packed.floatChannelData![0][199] = 0
      precondition(packedCopy.floatChannelData![0][199] == 199.0 / 200)
      var malformed = packed.audioBufferList.pointee
      malformed.mBuffers.mDataByteSize -= 1
      do {
        _ = try copyAudioBuffer(&malformed, format: interleaved)
        preconditionFailure("不完整的音频帧必须被拒绝")
      } catch {}
      let track = Track("system")
      track.minimumFrame = 640
      try track.append(copy, position: 320)
      precondition(track.startFrame == 640)
      precondition(track.nextFrame == 1120)
      precondition(track.samples.count == 480 * 2)
      precondition(track.samples.withUnsafeBytes { $0.loadUnaligned(as: Int16.self) } > 7000)
      try track.finish()
      precondition(track.samples.isEmpty && track.nextFrame == nil)
    }
  }
#endif
