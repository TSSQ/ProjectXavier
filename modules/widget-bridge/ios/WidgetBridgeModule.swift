import ExpoModulesCore
import WidgetKit

/// Bridges the app's data-change chokepoints (src/features/widget/summary.ts)
/// to WidgetKit. The Xavier widget (targets/widget) uses a single `.never`
/// timeline entry — it never reloads on a schedule — so the app is
/// responsible for telling iOS to redraw it immediately after writing a
/// fresh `widget-summary.json` into the shared App Group container.
///
/// Stateless, like AppleOcrModule: there is nothing to hold onto between
/// calls, and reloadAllTimelines() is safe to call as often as needed (iOS
/// coalesces/rate-limits reloads on its own).
public class WidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    AsyncFunction("reloadWidgets") {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
