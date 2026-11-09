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

// Core Audio 回调返回后会重用输入内存，必须先复制再交给重采样队列。
func copyAudioBuffer(_ source: UnsafePointer<AudioBufferList>, format: AVAudioFormat) throws
  -> AVAudioPCMBuffer
{
  let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: source))
  let bytesPerFrame = Int(format.streamDescription.pointee.mBytesPerFrame)
  guard bytesPerFrame > 0, let first = buffers.first else {
    throw CaptureError("无法获取系统音频，请检查系统权限后重试")
  }
  let frames = first.mDataByteSize / UInt32(bytesPerFrame)
  guard frames > 0, let copy = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else {
    throw CaptureError("无法获取系统音频，请检查系统权限后重试")
  }
  copy.frameLength = frames
  let destinations = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
  guard buffers.count == destinations.count else {
    throw CaptureError("无法获取系统音频，请检查系统权限后重试")
  }
  for (from, to) in zip(buffers, destinations) {
    guard from.mDataByteSize == to.mDataByteSize, let input = from.mData, let output = to.mData
    else { throw CaptureError("无法获取系统音频，请检查系统权限后重试") }
    memcpy(output, input, Int(to.mDataByteSize))
  }
  return copy
}

// Tap 在未授权时也可能交付静音；仅实际声音可以确认本次探测成功。
func containsSystemSound(_ buffer: AVAudioPCMBuffer) -> Bool {
  guard buffer.format.commonFormat == .pcmFormatFloat32 else { return false }
  for channel in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
    guard let data = channel.mData else { continue }
    let samples = UnsafeBufferPointer(
      start: data.assumingMemoryBound(to: Float.self),
      count: Int(channel.mDataByteSize) / MemoryLayout<Float>.stride)
    if samples.contains(where: { $0.isFinite && abs($0) > 0.000001 }) { return true }
  }
  return false
}

@available(macOS 14.4, *)
private func audioProcesses() throws -> [AudioObjectID] {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyProcessObjectList,
    mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  let system = AudioObjectID(kAudioObjectSystemObject)
  guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else {
    throw CaptureError("无法枚举系统音频进程")
  }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  if !ids.isEmpty && AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) != noErr {
    throw CaptureError("无法枚举系统音频进程")
  }
  return ids
}

@available(macOS 14.4, *)
private func processBundle(_ process: AudioObjectID) -> String? {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioProcessPropertyBundleID,
    mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout.size(ofValue: value))
  guard AudioObjectGetPropertyData(process, &address, 0, nil, &size, &value) == noErr else {
    return nil
  }
  return value?.takeRetainedValue() as String?
}

func meetingApp(_ bundle: String) -> String? {
  let names = [
    ("com.cloudmeeting.iflymeeting", "讯飞会议"),
    ("com.dancesuite.dance.ka.kaahyz17.mac", "i讯飞"),
    ("us.zoom.xos", "Zoom"), ("com.tencent.meeting", "Tencent Meeting"),
    ("com.tencent.rqd", "Tencent Meeting"), ("com.tencent.rqm", "Tencent Meeting"),
    ("com.tencent.rfmmeeting", "Tencent Meeting"), ("com.tencent.wemeet", "Tencent Meeting"),
    ("com.tencentmeeting", "Tencent Meeting"), ("com.hnc.discord", "Discord"),
    ("com.microsoft.teams", "Microsoft Teams"), ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.cisco.webex", "Webex"), ("com.google.chrome", "Google Chrome"),
    ("com.microsoft.edgemac", "Microsoft Edge"), ("com.apple.safari", "Safari"),
    ("org.mozilla.firefox", "Firefox"), ("com.brave.browser", "Brave"),
  ]
  let id = bundle.lowercased()
  switch id {
  case "com.electron.lark", "com.electron.lark.helper", "com.electron.lark.helper.plugin",
    "com.electron.lark.helper.renderer", "com.electron.lark.iron":
    return "飞书"
  case "com.larksuite.larkapp", "com.larksuite.larkapp.helper",
    "com.larksuite.larkapp.helper.plugin",
    "com.larksuite.larkapp.helper.renderer", "com.larksuite.larkapp.iron":
    return "Lark"
  case "com.alibaba.dingtalkmac", "5zsl2cju2t.com.dingtalk.meeting",
    "5zsl2cju2t.com.dingtalk.mac.tblive":
    return "钉钉"
  case "com.tencent.weworkmac", "com.tencent.wwmapp", "com.tencent.wework-helper",
    "88l2q4487u.com.tencent.wework.helper", "88l2q4487u.com.tencent.wework.helper.plugin",
    "88l2q4487u.com.tencent.wework.helper.renderer", "88l2q4487u.com.tencent.wework.helper.gpu":
    return "企业微信"
  case "com.tinyspeck.slackmacgap", "com.tinyspeck.slackmacgap.helper":
    return "Slack"
  case "com.tencent.tencentmeeting", "com.tencent.tencentmeeting.services.wmexternal":
    return "VooV Meeting"
  case "com.huawei.cloudlink", "com.huawei.cloudlink.welinkmeetinghelper":
    return "华为云会议"
  default: break
  }
  return names.first { id == $0.0 || id.hasPrefix($0.0 + ".") }?.1
}

private struct MeetingProbe: Decodable {
  let apps: [String: String]
  let excluded: Set<String>
}

func selectedMeetingName(_ bundle: String, apps: [String: String]) -> String? {
  let id = bundle.lowercased()
  return meetingApp(bundle) ?? apps[id]
    ?? apps.first { id == $0.key + ".helper" || id.hasPrefix($0.key + ".helper.") }?.value
}

private let meetingBrowsers = ["Google Chrome", "Microsoft Edge", "Safari", "Firefox", "Brave"]

private let meetTitlePattern: String = {
  let code = "[a-z]{3}-[a-z]{4}-[a-z]{3}"
  let separator = #"\s*[-–—]\s*"#
  let meet = "(?:google )?meet"
  let titles = [
    meet + separator + code, code + separator + meet, #"(?:https://)?meet\.google\.com/"# + code,
  ]
  let browser = "(?:google chrome|microsoft edge|mozilla firefox|brave|safari)"
  return #"^\s*(?:"# + titles.joined(separator: "|") + ")(?:" + separator + browser + #")?\s*$"#
}()

func isMeetTitle(_ title: String?) -> Bool {
  return title?.range(of: meetTitlePattern, options: [.regularExpression, .caseInsensitive]) != nil
}

// Window titles are available only with existing screen permission. Never request it from a probe.
private func visibleMeetBrowsers() -> Set<String> {
  guard CGPreflightScreenCaptureAccess(),
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)
      as? [[String: Any]]
  else { return [] }
  return Set(
    windows.compactMap { item in
      guard isMeetTitle(item[kCGWindowName as String] as? String),
        let owner = item[kCGWindowOwnerName as String] as? String
      else { return nil }
      return meetingBrowsers.first { owner.caseInsensitiveCompare($0) == .orderedSame }
    })
}

private func sampleBufferAudio(_ buffer: CMSampleBuffer) throws -> AVAudioPCMBuffer {
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

private final class MeetingSample: NSObject, SCStreamOutput {
  let sound = DispatchSemaphore(value: 0)
  func stream(
    _ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType
  ) {
    if type == .audio, sample.isValid, sample.numSamples > 0,
      let pcm = try? sampleBufferAudio(sample), containsSystemSound(pcm)
    {
      sound.signal()
    }
  }
}

private func legacyMeetingAudio(_ probeOptions: MeetingProbe) async throws -> Any {
  guard CGPreflightScreenCaptureAccess() else { return ["active": [String]()] }
  let content = try await SCShareableContent.excludingDesktopWindows(
    true, onScreenWindowsOnly: false)
  guard let display = content.displays.first else { return ["active": [String]()] }
  var active: [String] = []
  var candidate: String?
  for app in content.applications {
    guard var name = selectedMeetingName(app.bundleIdentifier, apps: probeOptions.apps) else {
      continue
    }
    if meetingBrowsers.contains(name) {
      guard
        content.windows.contains(where: {
          $0.isOnScreen && $0.owningApplication?.processID == app.processID && isMeetTitle($0.title)
        })
      else { continue }
      name = "Google Meet"
    }
    let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
    let config = SCStreamConfiguration()
    config.width = 2
    config.height = 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    config.capturesAudio = true
    let probe = MeetingSample()
    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
    try stream.addStreamOutput(
      probe, type: .audio, sampleHandlerQueue: DispatchQueue(label: "brevia.meeting-audio"))
    try await stream.startCapture()
    let sound = probe.sound
    let audible = await withCheckedContinuation { continuation in
      DispatchQueue.global().async {
        continuation.resume(returning: sound.wait(timeout: .now() + 0.6) == .success)
      }
    }
    try await stream.stopCapture()
    if audible {
      active.append(name)
      if !probeOptions.excluded.contains(name) { candidate = name }
    }
  }
  return ["active": active, "audible": candidate as Any] as [String: Any]
}

@available(macOS 14.4, *)
private func meetingAudio(_ probeOptions: MeetingProbe) throws -> Any {
  func running(_ process: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Bool {
    var address = AudioObjectPropertyAddress(
      mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: 0)
    var flag: UInt32 = 0
    var size = UInt32(MemoryLayout.size(ofValue: flag))
    return AudioObjectGetPropertyData(process, &address, 0, nil, &size, &flag) == noErr && flag != 0
  }
  let processes = try audioProcesses().compactMap { id -> (AudioObjectID, String)? in
    guard let name = processBundle(id).flatMap({ selectedMeetingName($0, apps: probeOptions.apps) })
    else { return nil }
    return (id, name)
  }
  let meetBrowsers = visibleMeetBrowsers()
  var active: [String] = []
  var candidate: String?
  for (name, group) in Dictionary(grouping: processes, by: { $0.1 }).sorted(by: { $0.key < $1.key })
  {
    let output = group.map { $0.0 }.filter { running($0, kAudioProcessPropertyIsRunningOutput) }
    guard !output.isEmpty else { continue }
    if meetingBrowsers.contains(name) && !meetBrowsers.contains(name) { continue }
    let label = meetBrowsers.contains(name) ? "Google Meet" : name
    active.append(label)
    if probeOptions.excluded.contains(label) || candidate != nil { continue }
    let done = DispatchSemaphore(value: 0)
    let tap = SystemAudioTap(delivery: DispatchQueue(label: "brevia.meeting-audio"))
    try tap.start(
      included: output,
      receive: { buffer, _ in
        if containsSystemSound(buffer) { done.signal() }
      }, fail: { _ in })
    let audible = done.wait(timeout: .now() + 0.45) == .success
    tap.stop()
    if audible { candidate = label }
  }
  return ["active": active, "audible": candidate as Any] as [String: Any]
}

@available(macOS 14.4, *)
private final class SystemAudioTap {
  private var tap: AudioObjectID = 0
  private var device: AudioObjectID = 0
  private var io: AudioDeviceIOProcID?
  private var formatListener: AudioObjectPropertyListenerBlock?
  private var format: AVAudioFormat?
  private let delivery: DispatchQueue

  init(delivery: DispatchQueue) { self.delivery = delivery }

  private func check(_ status: OSStatus) throws {
    guard status == noErr else {
      fputs("Core Audio tap error: \(status)\n", stderr)
      throw CaptureError("无法获取系统音频，请检查系统权限后重试")
    }
  }

  private func readFormat() throws -> AVAudioFormat {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain)
    var description = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout.size(ofValue: description))
    try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &description))
    guard let format = AVAudioFormat(streamDescription: &description) else {
      throw CaptureError("无法获取系统音频，请检查系统权限后重试")
    }
    return format
  }

  func start(
    included: [AudioObjectID]? = nil,
    receive: @escaping (AVAudioPCMBuffer, Double) -> Void, fail: @escaping (Error) -> Void
  ) throws {
    do {
      // 排除归属于本应用的音频进程，避免将其回放再次录入系统音轨。
      var address = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
      let description: CATapDescription
      if let included {
        description = CATapDescription(stereoMixdownOfProcesses: included)
      } else {
        let excluded = try audioProcesses().filter { processBundle($0) == "com.brevia.app" }
        description = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
      }
      description.name = "Brevia System Audio"
      description.isPrivate = true
      description.muteBehavior = .unmuted
      try check(AudioHardwareCreateProcessTap(description, &tap))
      format = try readFormat()
      // 不绑定物理输出设备，让全局混音 Tap 跟随系统输出，也不改用户的音频路由。
      let aggregate: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Brevia System Audio",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        // true 会等到某个应用播放声音才启动，会议开始前的安静状态也必须能录音。
        kAudioAggregateDeviceTapAutoStartKey: false,
        kAudioAggregateDeviceSubDeviceListKey: [],
        kAudioAggregateDeviceTapListKey: [
          [
            kAudioSubTapUIDKey: description.uuid.uuidString,
            kAudioSubTapDriftCompensationKey: true,
          ]
        ],
      ]
      try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device))
      let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
        guard let self else { return }
        do { self.format = try self.readFormat() } catch { fail(error) }
      }
      address.mSelector = kAudioTapPropertyFormat
      try check(AudioObjectAddPropertyListenerBlock(tap, &address, delivery, listener))
      formatListener = listener
      try check(
        AudioDeviceCreateIOProcIDWithBlock(&io, device, delivery) {
          [weak self] _, input, time, _, _ in
          guard let self, let format = self.format,
            input.pointee.mNumberBuffers > 0, input.pointee.mBuffers.mDataByteSize > 0
          else { return }
          do {
            let timestamp =
              time.pointee.mFlags.contains(.hostTimeValid)
              ? time.pointee.mHostTime : mach_absolute_time()
            receive(
              try copyAudioBuffer(input, format: format),
              AVAudioTime.seconds(forHostTime: timestamp))
          } catch { fail(error) }
        })
      try check(AudioDeviceStart(device, io))
    } catch {
      stop()
      throw error
    }
  }

  func stop() {
    if device != 0, let io {
      AudioDeviceStop(device, io)
      AudioDeviceDestroyIOProcID(device, io)
      self.io = nil
    }
    if tap != 0, let listener = formatListener {
      var address = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
      AudioObjectRemovePropertyListenerBlock(tap, &address, delivery, listener)
      formatListener = nil
    }
    delivery.sync {}
    if device != 0 {
      AudioHardwareDestroyAggregateDevice(device)
      device = 0
    }
    if tap != 0 {
      AudioHardwareDestroyProcessTap(tap)
      tap = 0
    }
  }

  deinit { stop() }
}

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
  // AnyObject 使 macOS 14.0 仍能加载宿主；仅在 14.4+ 构造 Tap。
  private var systemTap: AnyObject?
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
      if #available(macOS 14.4, *) {
        let tap = SystemAudioTap(delivery: delivery)
        systemTap = tap
        try tap.start(
          receive: { [weak self] buffer, timestamp in
            guard let self else { return }
            self.submit(self.system, timestamp: timestamp) { buffer }
          }, fail: { [weak self] error in self?.fail(error) })
      } else {
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
      try sampleBufferAudio(buffer)
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
      if #available(macOS 14.4, *), let tap = systemTap as? SystemAudioTap {
        tap.stop()
        systemTap = nil
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
        if args.first == "meeting-audio" {
          let options =
            args.dropFirst().first == "--stdin"
            ? try JSONDecoder().decode(
              MeetingProbe.self, from: FileHandle.standardInput.readDataToEndOfFile())
            : MeetingProbe(apps: [:], excluded: Set(args.dropFirst()))
          if #available(macOS 14.4, *) {
            emit(try meetingAudio(options))
          } else {
            emit(try await legacyMeetingAudio(options))
          }
          return
        }
        if args == ["permissions"] {
          let microphone: String
          switch AVCaptureDevice.authorizationStatus(for: .audio) {
          case .authorized: microphone = "granted"
          case .notDetermined: microphone = "not-determined"
          case .restricted: microphone = "restricted"
          default: microphone = "denied"
          }
          let audioOnly: Bool
          if #available(macOS 14.4, *) { audioOnly = true } else { audioOnly = false }
          emit([
            "microphone": microphone,
            // 沿用 screen 协议字段；公开 API 无法静默查询 Tap 授权，不能用录屏权限代替。
            "screen": audioOnly
              ? "unknown" : CGPreflightScreenCaptureAccess() ? "granted" : "denied",
            "systemAudioCapture": audioOnly ? "core-audio-tap" : "screen-capture-kit",
            "systemAudioSupported": true,
          ])
          return
        }
        if args == ["request-screen"] {
          if #available(macOS 14.4, *) {
            let delivery = DispatchQueue(label: "brevia.audio.permission")
            let tap = SystemAudioTap(delivery: delivery)
            let finished = DispatchSemaphore(value: 0)
            var audible = false
            var failure: Error?
            try tap.start(
              receive: { buffer, _ in
                if !audible && containsSystemSound(buffer) {
                  audible = true
                  finished.signal()
                }
              },
              fail: { error in
                failure = error
                finished.signal()
              })
            await withCheckedContinuation { continuation in
              DispatchQueue.global().async {
                _ = finished.wait(timeout: .now() + 3)
                continuation.resume()
              }
            }
            tap.stop()
            if let failure { throw failure }
            if audible { emit(true) } else { emit(NSNull()) }
          } else {
            _ = CGRequestScreenCaptureAccess()
            // 系统设置可能尚未打开，false 不等于用户已经拒绝。
            emit(CGPreflightScreenCaptureAccess() ? true : NSNull())
          }
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
