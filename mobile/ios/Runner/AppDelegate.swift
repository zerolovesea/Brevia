import ActivityKit
import Flutter
import UIKit

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
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
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
