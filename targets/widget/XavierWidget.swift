import SwiftUI
import WidgetKit

/// Deep links the widget can open — handled in app/(tabs)/index.tsx. Kept as
/// plain string constants (no third-party deps in this target).
private enum XavierDeepLink {
  static let focus = URL(string: "projectxavier://?focus=1")!
  static let scan = URL(string: "projectxavier://?scan=1")!
}

// MARK: - Timeline

struct XavierEntry: TimelineEntry {
  let date: Date
  /// nil = no usable summary (first run before the app has ever written one,
  /// or the file was missing/corrupt) — renders as the plain launcher, never
  /// as zeroed numbers (that's reserved for the gallery placeholder below).
  let summary: WidgetSummary?
}

struct XavierProvider: TimelineProvider {
  func placeholder(in context: Context) -> XavierEntry {
    XavierEntry(date: Date(), summary: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (XavierEntry) -> Void) {
    // Gallery previews use the zeroed placeholder so the preview shows the
    // real layout; any other snapshot reads live data — zeros are reserved
    // for the gallery, real no-data renders the launcher.
    let summary = context.isPreview ? WidgetSummary.placeholder : WidgetSummaryStore.read()
    completion(XavierEntry(date: Date(), summary: summary))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<XavierEntry>) -> Void) {
    let entry = XavierEntry(date: Date(), summary: WidgetSummaryStore.read())
    // .never: this widget never reloads on a schedule. The app pushes fresh
    // data by calling WidgetCenter.shared.reloadAllTimelines() (via
    // modules/widget-bridge) every time it writes a new summary.
    completion(Timeline(entries: [entry], policy: .never))
  }
}

// MARK: - Entry view (dispatches by widget family)

struct XavierWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  var entry: XavierProvider.Entry

  var body: some View {
    switch family {
    case .systemMedium:
      if let summary = entry.summary {
        MediumSummaryView(summary: summary)
      } else {
        // No usable summary yet — the medium slot falls back to the same
        // plain launcher as the small widget rather than showing zeros.
        SmallLauncherView()
      }
    case .accessoryCircular:
      CircularAccessoryView()
    case .accessoryInline:
      Text("Tell Xavier")
        .widgetURL(XavierDeepLink.focus)
    default:
      SmallLauncherView()
    }
  }
}

// MARK: - systemSmall: pure launcher

/// Whole widget is one tap target → focus the assistant input.
private struct SmallLauncherView: View {
  var body: some View {
    VStack(spacing: 10) {
      XavierBlobView(diameter: 64)
      Text("Tell Xavier…")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .containerBackground(XavierTheme.bg, for: .widget)
    .widgetURL(XavierDeepLink.focus)
  }
}

// MARK: - systemMedium: launcher + this-month summary

/// Two independent tap targets: the blob/prompt side opens the assistant
/// (focus), the small camera glyph opens the scan action sheet (scan) — see
/// docs/design/xavier-widget-spec.md.
private struct MediumSummaryView: View {
  let summary: WidgetSummary

  var body: some View {
    HStack(spacing: 16) {
      Link(destination: XavierDeepLink.focus) {
        VStack(spacing: 8) {
          XavierBlobView(diameter: 56)
          Text("Tell Xavier…")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("THIS MONTH")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white.opacity(0.6))
          Spacer()
          Link(destination: XavierDeepLink.scan) {
            Image(systemName: "camera.fill")
              .font(.system(size: 12))
              .foregroundStyle(.white.opacity(0.85))
              .frame(width: 26, height: 26)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
        MoneyRow(
          label: "Income",
          minor: summary.incomeMinor,
          currency: summary.currency,
          color: XavierTheme.income,
          sign: "+"
        )
        MoneyRow(
          label: "Expense",
          minor: summary.expenseMinor,
          currency: summary.currency,
          color: XavierTheme.expense,
          sign: "\u{2212}" // proper minus sign, matches the spec glyph
        )
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .containerBackground(XavierTheme.bg, for: .widget)
  }
}

private struct MoneyRow: View {
  let label: String
  let minor: Int
  let currency: String
  let color: Color
  let sign: String

  var body: some View {
    HStack {
      Text(label)
        .font(.system(size: 11))
        .foregroundStyle(.white.opacity(0.6))
      Spacer()
      Text("\(sign)\(formatMinorUnits(minor, currency: currency))")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
  }
}

// MARK: - Lock screen accessories

/// accessoryCircular renders in the system's vibrant/monochrome rendering
/// mode — most colors are ignored and replaced with the lock screen's tint,
/// so this draws shape only (a ring + two small eye pills), no gradient.
private struct CircularAccessoryView: View {
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      HStack(spacing: 3) {
        Capsule().frame(width: 4, height: 9)
        Capsule().frame(width: 4, height: 9)
      }
    }
    .widgetURL(XavierDeepLink.focus)
  }
}

// MARK: - Widget declaration

struct XavierWidget: Widget {
  let kind = "XavierWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: XavierProvider()) { entry in
      XavierWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Xavier")
    .description("Tap to talk to Xavier, or check this month's income and expense.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryInline])
  }
}
