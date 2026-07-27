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

/// Mirrors `currencyExponent` (src/domain/currency.ts): the ISO 4217 minor-
/// unit exponent for `code` — 0, 2 (the common case), or 3. Never traps on an
/// unrecognised/legacy code (review F1 / M7 edge case) — defaults to 2.
func currencyExponent(_ code: String) -> Int {
  let zeroDecimal: Set<String> = ["JPY", "KRW", "VND", "CLP"]
  let threeDecimal: Set<String> = ["BHD", "KWD", "OMR", "TND"]
  let c = code.uppercased()
  if zeroDecimal.contains(c) { return 0 }
  if threeDecimal.contains(c) { return 3 }
  return 2
}

/// Minor units → major, formatted as currency, e.g. "SGD 1,234.56", "¥1,000"
/// for JPY (auto 0-decimal), "BHD 1.234" for a 3-decimal currency.
///
/// Divides by the CURRENCY's own exponent (review F1 / M7) rather than a
/// hard-coded /100, so a 0-decimal currency's stored minor units (already
/// whole yen, not cents) aren't shown 100x too small. `NumberFormatter`'s
/// `.currency` style + `currencyCode` then renders the right fraction digits
/// and symbol/code for that currency automatically (Foundation's own ISO
/// 4217 table already agrees with `currencyExponent` above). Locale is
/// pinned to en-US so grouping/decimal separators stay deterministic
/// regardless of device locale — no locale plumbing crosses the App Group
/// boundary today.
func formatMinorUnits(_ minor: Int, currency: String) -> String {
  let divisor = pow(10.0, Double(currencyExponent(currency)))
  let major = Double(minor) / divisor
  let formatter = NumberFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.numberStyle = .currency
  formatter.currencyCode = currency
  return formatter.string(from: NSNumber(value: major))
    ?? "\(currency) \(String(format: "%.\(currencyExponent(currency))f", major))"
}
