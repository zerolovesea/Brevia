import ActivityKit
import Flutter
import StoreKit
import UIKit
import flutter_webrtc

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var activityTask: Task<Void, Never>?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    do {
      let manager = FileManager.default
      var support = try manager.url(
        for: .applicationSupportDirectory, in: .userDomainMask,
        appropriateFor: nil, create: true)
      var resources = URLResourceValues()
      resources.isExcludedFromBackup = true
      try support.setResourceValues(resources)
      try manager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: support.path)
    } catch {
      NSLog("Brevia recording storage protection: %@", error.localizedDescription)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    // WebRTC 仅传数据，音频会话由现有录音器管理，重连不可重置麦克风。
    FlutterWebRTCPlugin.setAudioSessionManagementEnabled(false)
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let updates = FlutterMethodChannel(
      name: "com.brevia/app_update",
      binaryMessenger: engineBridge.applicationRegistrar.messenger())
    updates.setMethodCallHandler { call, result in
      switch call.method {
      case "version":
        result(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
      case "build":
        result(Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))
      case "storeCountry":
        // 商店账号地区优先，未登录商店时使用设备地区；查询只包含公开 App ID。
        let region = SKPaymentQueue.default().storefront?.countryCode
        let locale = Locale(identifier: "en_US_POSIX")
        let name = region.flatMap { locale.localizedString(forRegionCode: $0) }
        let country = name.flatMap { name in
          Locale.isoRegionCodes.first {
            $0.count == 2 && locale.localizedString(forRegionCode: $0) == name
          }
        }
        result(country ?? Locale.current.regionCode ?? "US")
      case "openStore":
        let url = URL(string: "https://apps.apple.com/app/id6819869442")!
        UIApplication.shared.open(url) { opened in
          if opened {
            result(nil)
          } else {
            result(
              FlutterError(
                code: "store_unavailable", message: "Cannot open App Store", details: nil))
          }
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    if #available(iOS 16.2, *) {
      activityTask = Task {
        for activity in Activity<RecordingAttributes>.activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      let channel = FlutterMethodChannel(
        name: "brevia/recording-activity",
        binaryMessenger: engineBridge.applicationRegistrar.messenger())
      channel.setMethodCallHandler { [weak self] call, result in
        guard let self else { return }
        let previous = self.activityTask
        self.activityTask = Task { @MainActor in
          await previous?.value
          let args = call.arguments as? [String: Any] ?? [:]
          let sessionID = args["id"] as? String ?? ""
          let status = args["status"] as? String ?? "ended"
          let activities = Activity<RecordingAttributes>.activities.filter {
            $0.attributes.sessionID == sessionID
          }
          if call.method == "end" || status == "ended" {
            for activity in activities { await activity.end(nil, dismissalPolicy: .immediate) }
          } else if call.method == "start" || call.method == "update" {
            let state = RecordingAttributes.ContentState(
              status: status,
              seconds: args["seconds"] as? Int ?? 0, connected: args["connected"] as? Bool ?? false,
              uploadedSeconds: args["uploadedSeconds"] as? Int ?? 0,
              statusLabel: args["statusLabel"] as? String ?? "Recording",
              connectionLabel: args["connectionLabel"] as? String ?? "",
              uploadedLabel: args["uploadedLabel"] as? String ?? "",
              staleLabel: args["staleLabel"] as? String ?? "Check status",
              staleHint: args["staleHint"] as? String ?? "Open the app to check recording",
              returnHint: args["returnHint"] as? String ?? "Return to meeting")
            // Expire the status if recording stops unexpectedly; never run a speculative timer.
            let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(30))
            if call.method == "start" && activities.isEmpty
              && ActivityAuthorizationInfo().areActivitiesEnabled
            {
              do {
                _ = try Activity.request(
                  attributes: RecordingAttributes(sessionID: sessionID), content: content)
              } catch {
                result(
                  FlutterError(code: "activity", message: error.localizedDescription, details: nil))
                return
              }
            } else {
              for activity in activities { await activity.update(content) }
            }
          } else {
            result(FlutterMethodNotImplemented)
            return
          }
          result(nil)
        }
      }
    }
  }
}
