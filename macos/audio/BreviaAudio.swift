import AVFoundation
import AudioToolbox
import CoreAudio
import CoreGraphics
import Foundation
import ScreenCaptureKit

private struct CaptureError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

// 标准输出只用于 JSONL。由音频串行队列写入，控制确认始终排在该命令之前的音频后。
private func emit(_ value: Any) {
  do {
    var data = try JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
    data.append(10)
    try FileHandle.standardOutput.write(contentsOf: data)
  } catch { exit(1) }
}

private struct InputDevice {
  let id: AudioDeviceID
  let uid: String
  let name: String

  static func available() throws -> [InputDevice] {
    var property = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr else {
      throw CaptureError("无法枚举麦克风设备")
    }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard !ids.isEmpty else { return [] }
    guard AudioObjectGetPropertyData(system, &property, 0, nil, &size, &ids) == noErr else {
      throw CaptureError("无法枚举麦克风设备")
    }
    return ids.compactMap { id in
      property.mSelector = kAudioDevicePropertyStreams
      property.mScope = kAudioDevicePropertyScopeInput
      guard AudioObjectGetPropertyDataSize(id, &property, 0, nil, &size) == noErr, size > 0
      else { return nil }
      func string(_ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
          mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
          mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var count = UInt32(MemoryLayout.size(ofValue: value))
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &count, &value) == noErr else {
          return nil
        }
        return value?.takeRetainedValue() as String?
      }
      guard let uid = string(kAudioDevicePropertyDeviceUID) else { return nil }
      return InputDevice(id: id, uid: uid, name: string(kAudioObjectPropertyName) ?? uid)
    }
  }
}

private let targetFormat = AVAudioFormat(
  commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!

// 保留连续重采样器和采样时钟；小帧合并到约 160 ms 再交付，暂停和结束立即冲刷。
final class Track {
  let name: String
  var converter: AVAudioConverter?
  var samples = Data()
  var startFrame = 0
  var nextFrame: Int?
  var preview = false
  var minimumFrame = 0
  private var expectedEnd = 0.0

  init(_ name: String) { self.name = name }

  func append(_ input: AVAudioPCMBuffer, position: Int) throws {
    // 静默的系统音轨可能中断源时钟；结束前一段重采样再对齐两轨。
    if converter?.inputFormat != input.format || Double(position) - expectedEnd > 1600 {
      try finish()
      converter = AVAudioConverter(from: input.format, to: targetFormat)
      converter?.primeMethod = .none
      converter?.downmix = true
      nextFrame = position
      expectedEnd = Double(position)
    }
    guard let converter else { throw CaptureError("不支持输入设备的音频格式") }
    let frames = Double(input.frameLength) * 16_000 / input.format.sampleRate
    expectedEnd += frames
    let capacity = ceil(frames) + 128
    guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: UInt32(capacity))
    else { throw CaptureError("无法创建采样缓冲区") }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, state in
      state.pointee = supplied ? .noDataNow : .haveData
      if supplied { return nil }
      supplied = true
      return input
    }
    if let error { throw error }
    guard status != .error else { throw CaptureError("音频重采样失败") }
    enqueue(output)
  }

  func enqueue(_ buffer: AVAudioPCMBuffer) {
    guard let bytes = buffer.int16ChannelData?[0], let position = nextFrame else { return }
    // AVAudioConverter 结束时会补齐滤波尾部；只保留实际采集时长。
    let count = min(Int(buffer.frameLength), max(0, Int(expectedEnd.rounded()) - position))
    nextFrame = position + count
    // 采集回调中可能含开始或恢复之前的样本，不写入这些样本。
    let skip = min(count, max(0, minimumFrame - position))
    guard count > skip else { return }
    if samples.isEmpty { startFrame = position + skip }
    samples.append(
      UnsafeRawPointer(bytes + skip).assumingMemoryBound(to: UInt8.self), count: (count - skip) * 2)
    if samples.count >= 5120 { flush() }
  }

  func flush() {
    guard !samples.isEmpty else { return }
    if name == "mic" {
      let level = samples.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> Double in
        var power = 0.0
        for offset in stride(from: 0, to: bytes.count, by: 2) {
          let sample = Double(bytes.loadUnaligned(fromByteOffset: offset, as: Int16.self)) / 32768
          power += sample * sample
        }
        return min(1, sqrt(power / Double(bytes.count / 2)) * 8)
      }
      emit(["type": "level", "track": name, "level": level])
    }
    if !preview {
      emit([
        "type": "audio", "track": name, "sample_rate": 16000, "start_ms": startFrame / 16,
        "pcm": samples.base64EncodedString(),
      ])
    }
    samples.removeAll(keepingCapacity: true)
  }

  func finish() throws {
    if let converter, let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: 2048) {
      var error: NSError?
      repeat {
        output.frameLength = 0
        let status = converter.convert(to: output, error: &error) { _, state in
          state.pointee = .endOfStream
          return nil
        }
        if let error { throw error }
        if status == .error { throw CaptureError("音频重采样失败") }
        enqueue(output)
        if status == .endOfStream || output.frameLength == 0 { break }
      } while true
    }
    flush()
    converter = nil
    nextFrame = nil
  }
}

private final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
  let queue = DispatchQueue(label: "brevia.audio.write")
  private let delivery = DispatchQueue(label: "brevia.audio.screen")
  private let slots = DispatchSemaphore(value: 192)
  private let failureLock = NSLock()
  private var failed = false
  private let mic = Track("mic"), system = Track("system")
  private var engine: AVAudioEngine?
  private var stream: SCStream?
  private var configurationObserver: NSObjectProtocol?
  private let firstMicBuffer = DispatchSemaphore(value: 0)
  private var microphoneFlowing = false
  private var startTime: Double?
  private var elapsed = 0.0
  private var stopped = false

  private var now: Double { AVAudioTime.seconds(forHostTime: mach_absolute_time()) }

  func fail(_ error: Error) {
    failureLock.lock()
    let first = !failed
    failed = true
    failureLock.unlock()
    if first {
      queue.async {
        if self.stopped { return }
        self.mic.flush()
        self.system.flush()
        emit(["type": "error", "message": error.localizedDescription])
        exit(1)
      }
    }
  }

  private func submit(
    _ track: Track, timestamp: Double, _ load: @escaping () throws -> AVAudioPCMBuffer
  ) {
    guard slots.wait(timeout: .now()) == .success else {
      fail(CaptureError("error.audio_backpressure"))
      return
    }
    queue.async {
      defer { self.slots.signal() }
      if track === self.mic && !self.microphoneFlowing {
        self.microphoneFlowing = true
        self.firstMicBuffer.signal()
      }
      guard let start = self.startTime, timestamp.isFinite else { return }
      do {
        let input = try load()
        let delta = timestamp - start
        if delta + Double(input.frameLength) / input.format.sampleRate <= 0 { return }
        try track.append(input, position: Int(((self.elapsed + delta) * 16000).rounded()))
      } catch { self.fail(error) }
    }
  }

  func prepare(microphone: Bool, desktop: Bool, uid: String, preview: Bool) async throws -> Bool {
    var fellBack = false
    if microphone {
      guard await AVCaptureDevice.requestAccess(for: .audio) else {
        throw CaptureError("麦克风访问被拒绝，请在系统设置中允许应用使用麦克风后重试")
      }
      let engine = AVAudioEngine()
      let input = engine.inputNode
      if !uid.isEmpty {
        if let device = try InputDevice.available().first(where: { $0.uid == uid }),
          let unit = input.audioUnit
        {
          var id = device.id
          guard
            AudioUnitSetProperty(
              unit, kAudioOutputUnitProperty_CurrentDevice,
              kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size)) == noErr
          else { throw CaptureError("无法打开所选麦克风") }
        } else {
          fellBack = true
        }
      }
      let format = input.outputFormat(forBus: 0)
      guard format.channelCount > 0, format.sampleRate > 0 else {
        throw CaptureError("未检测到麦克风设备，请在系统设置中开启麦克风访问权限")
      }
      input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, when in
        guard let self, buffer.frameLength > 0 else { return }
        // tap 返回后系统可以重用输入内存；在回调内仅复制，转换与管道写入在另一条队列中。
        guard
          let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength)
        else { return }
        copy.frameLength = buffer.frameLength
        for (from, to) in zip(
          UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList),
          UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList))
        {
          if let source = from.mData, let destination = to.mData {
            memcpy(destination, source, Int(from.mDataByteSize))
          }
        }
        self.submit(self.mic, timestamp: AVAudioTime.seconds(forHostTime: when.hostTime)) { copy }
      }
      self.engine = engine
      try engine.start()
      // 有些已断开的设备仍会成功启动 engine，至少收到一帧才向界面报告就绪。
      let received = await withCheckedContinuation { continuation in
        DispatchQueue.global().async {
          continuation.resume(returning: self.firstMicBuffer.wait(timeout: .now() + 3) == .success)
        }
      }
      guard received else {
        throw CaptureError("麦克风未产生音频数据")
      }
      configurationObserver = NotificationCenter.default.addObserver(
        forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
      ) { [weak self] _ in self?.fail(CaptureError("麦克风设备配置已更改，请重新开始录音")) }
    }
    if desktop {
      let content = try await SCShareableContent.excludingDesktopWindows(
        true, onScreenWindowsOnly: false)
      guard let display = content.displays.first else { throw CaptureError("未检测到可用显示器") }
      let filter = SCContentFilter(display: display, excludingWindows: [])
      let config = SCStreamConfiguration()
      config.width = 2
      config.height = 2
      config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
      config.capturesAudio = true
      config.sampleRate = 48000
      config.channelCount = 1
      config.excludesCurrentProcessAudio = true
      let stream = SCStream(filter: filter, configuration: config, delegate: self)
      try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: delivery)
      self.stream = stream
      try await stream.startCapture()
    }
    queue.sync {
      if preview {
        mic.preview = true
        startTime = now
      }
      emit(["type": "ready", "micFellBack": fellBack])
    }
    return fellBack
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) { fail(error) }

  func stream(
    _ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType
  ) {
    guard type == .audio, buffer.isValid, buffer.numSamples > 0 else { return }
    submit(system, timestamp: buffer.presentationTimeStamp.seconds) {
      guard let desc = buffer.formatDescription,
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc),
        let format = AVAudioFormat(streamDescription: asbd),
        let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: UInt32(buffer.numSamples))
      else { throw CaptureError("系统音频格式无效") }
      output.frameLength = UInt32(buffer.numSamples)
      let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
        buffer, at: 0, frameCount: Int32(buffer.numSamples), into: output.mutableAudioBufferList)
      guard status == noErr else { throw CaptureError("无法读取系统音频") }
      return output
    }
  }

  func command(_ command: String) async throws {
    if command == "stop" {
      if let observer = configurationObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      if let engine {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
      }
      if let stream {
        try await stream.stopCapture()
        delivery.sync {}
      }
    }
    try queue.sync {
      switch command {
      case "start", "resume":
        if startTime == nil {
          mic.minimumFrame = Int((elapsed * 16000).rounded())
          system.minimumFrame = mic.minimumFrame
          startTime = now
        }
      case "pause", "stop":
        if let startTime { elapsed += now - startTime }
        self.startTime = nil
        try mic.finish()
        try system.finish()
        if command == "stop" { stopped = true }
      default: throw CaptureError("未知音频控制命令")
      }
      emit(["type": "ack", "command": command])
    }
  }
}

#if !BREVIA_AUDIO_TEST
  @main
  private struct AudioMain {
    static func main() async {
      var args = Array(CommandLine.arguments.dropFirst())
      do {
        if args == ["permissions"] {
          let microphone: String
          switch AVCaptureDevice.authorizationStatus(for: .audio) {
          case .authorized: microphone = "granted"
          case .notDetermined: microphone = "not-determined"
          case .restricted: microphone = "restricted"
          default: microphone = "denied"
          }
          emit([
            "microphone": microphone,
            "screen": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
            "systemAudioSupported": true,
          ])
          return
        }
        if args == ["request-screen"] {
          emit(CGRequestScreenCaptureAccess())
          return
        }
        if args == ["request-microphone"] {
          emit(await AVCaptureDevice.requestAccess(for: .audio))
          return
        }
        if args == ["devices"] {
          emit(try InputDevice.available().map { ["deviceId": $0.uid, "label": $0.name] })
          return
        }
        var uid = ""
        if let index = args.firstIndex(of: "--device") {
          guard index + 1 < args.count else { throw CaptureError("缺少麦克风设备 ID") }
          uid = args[index + 1]
          args.removeSubrange(index...(index + 1))
        }
        guard args.first == "capture", args.contains("--mic") || args.contains("--system") else {
          throw CaptureError("至少选择一个音频输入")
        }
        let capture = Capture()
        _ = try await capture.prepare(
          microphone: args.contains("--mic"), desktop: args.contains("--system"),
          uid: uid, preview: args.contains("--preview"))
        // readLine 不能阻塞主线程，ScreenCaptureKit 的流生命周期需要主运行循环。
        let commands = Task.detached {
          while let command = readLine() {
            try await capture.command(command)
            if command == "stop" { return }
          }
          try await capture.command("stop")
        }
        try await commands.value
      } catch {
        emit(["type": "error", "message": error.localizedDescription])
        exit(1)
      }
    }
  }
#endif
