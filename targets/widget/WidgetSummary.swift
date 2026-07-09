import Foundation

/// Mirrors the JSON shape src/features/widget/summary.ts writes:
/// `{ version, periodLabel, incomeMinor, expenseMinor, currency, updatedAt }`.
///
/// This is the ONLY data this widget process ever reads — it must never
/// import app JS or touch Drizzle/SQLite (see docs/design/xavier-widget-spec.md,
/// "Widget process cannot use Drizzle/SQLite"). The summary is app-authored,
/// but the file still lives on disk where it can be partially written or
/// corrupted (e.g. the app is killed mid-write), so decoding here stays
/// defensive even though the producer is trusted.
struct WidgetSummary: Decodable {
  let version: Int
  let periodLabel: String
  let incomeMinor: Int
  let expenseMinor: Int
  let currency: String
  let updatedAt: Int
}

extension WidgetSummary {
  /// Zeroed placeholder used for the widget gallery preview / redacted
  /// snapshot — never the "real" no-data state (see WidgetSummaryStore.read,
  /// which returns nil instead when the real file is missing/corrupt).
  static let placeholder = WidgetSummary(
    version: 1,
    periodLabel: "This month",
    incomeMinor: 0,
    expenseMinor: 0,
    currency: "USD",
    updatedAt: 0
  )
}

enum WidgetSummaryStore {
  /// Must match `WIDGET_APP_GROUP` in src/features/widget/summary.ts and the
  /// `com.apple.security.application-groups` entry in
  /// targets/widget/expo-target.config.js / app.config.ts.
  static let appGroupId = "group.com.projectxavier.app"
  static let fileName = "widget-summary.json"

  /// Reads and decodes the shared summary file written by the app. Returns
  /// nil on ANY failure — missing App Group container, missing file, or
  /// corrupt/partial JSON — so the widget can fall back to the plain
  /// launcher layout instead of crashing or showing garbage numbers.
  static func read() -> WidgetSummary? {
    guard
      let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupId
      )
    else {
      return nil
    }
    let fileURL = containerURL.appendingPathComponent(fileName)
    guard let data = try? Data(contentsOf: fileURL) else {
      return nil
    }
    return try? JSONDecoder().decode(WidgetSummary.self, from: data)
  }
}

/// Minor units → major, prefixed with the ISO currency code, e.g. "SGD 1,234.56".
///
/// Divergence from `formatMoney` (src/domain/money.ts): the JS side uses
/// `Intl.NumberFormat(locale, { style: 'currency', currency })`, which for
/// some currencies substitutes a symbol (e.g. "$1,234.56" for USD in en-US)
/// rather than the ISO code. Reproducing that table in Swift without pulling
/// in a third-party dependency isn't worth it for a widget row, so this
/// always prefixes the plain ISO code instead — "SGD 1,234.56" either way,
/// "USD 1,234.56" instead of "$1,234.56". Grouping/decimal separators use a
/// fixed en-US-style format (comma thousands, period decimal) for the same
/// reason: no locale plumbing crosses the App Group boundary today.
func formatMinorUnits(_ minor: Int, currency: String) -> String {
  let major = Double(minor) / 100.0
  let formatter = NumberFormatter()
  formatter.numberStyle = .decimal
  formatter.minimumFractionDigits = 2
  formatter.maximumFractionDigits = 2
  formatter.groupingSeparator = ","
  formatter.decimalSeparator = "."
  formatter.usesGroupingSeparator = true
  let numberPart = formatter.string(from: NSNumber(value: major)) ?? String(format: "%.2f", major)
  return "\(currency) \(numberPart)"
}
