import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct RecordingAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var status: String
    var seconds: Int
    var connected: Bool
    var uploadedSeconds: Int
    var statusLabel: String
    var connectionLabel: String
    var uploadedLabel: String
    var staleLabel: String
    var staleHint: String
    var returnHint: String
  }
  var sessionID: String
}

#if RECORDING_WIDGET
  @main
  struct RecordingWidget: Widget {
    var body: some WidgetConfiguration {
      ActivityConfiguration(for: RecordingAttributes.self) { context in
        HStack(spacing: 14) {
          Image(systemName: "waveform")
            .font(.title2).frame(width: 40, height: 40)
            .background(.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
          VStack(alignment: .leading, spacing: 6) {
            Text("Brevia").font(.subheadline.weight(.medium))
            status(context)
            Text(context.isStale ? context.state.staleHint : context.state.connectionLabel)
              .font(.caption).foregroundStyle(.secondary)
          }
          Spacer(minLength: 0)
          Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .activityBackgroundTint(Color(uiColor: .systemBackground))
        .activitySystemActionForegroundColor(.primary)
        .accessibilityHint(context.state.returnHint)
      } dynamicIsland: { context in
        DynamicIsland {
          DynamicIslandExpandedRegion(.leading) { Label("Brevia", systemImage: "waveform") }
          DynamicIslandExpandedRegion(.trailing) {
            Text(duration(context.state.seconds)).monospacedDigit()
          }
          DynamicIslandExpandedRegion(.bottom) {
            VStack(alignment: .leading, spacing: 6) {
              status(context)
              Text(
                context.isStale
                  ? context.state.staleHint
                  : context.state.connected
                    ? context.state.uploadedLabel : context.state.connectionLabel
              )
              .font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
          }
        } compactLeading: {
          Image(systemName: context.isStale ? "exclamationmark.circle" : "waveform")
            .foregroundStyle(
              context.state.status == "recording" && !context.isStale ? .red : .secondary)
        } compactTrailing: {
          Text(duration(context.state.seconds)).font(.caption).monospacedDigit()
        } minimal: {
          Image(systemName: context.isStale ? "exclamationmark.circle" : "waveform")
        }
      }
    }

    private func duration(_ seconds: Int) -> String {
      String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private func status(_ context: ActivityViewContext<RecordingAttributes>) -> some View {
      HStack(spacing: 6) {
        Circle().fill(
          context.state.status == "recording" && !context.isStale ? Color.red : Color.secondary
        )
        .frame(width: 7, height: 7)
        Text(context.isStale ? context.state.staleLabel : context.state.statusLabel)
        Text(duration(context.state.seconds)).monospacedDigit()
      }.font(.subheadline)
    }
  }
#endif
