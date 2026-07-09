import SwiftUI

/// Hardcoded brand colors for the widget. Intentionally NOT theme-aware: like
/// the app icon (assets/icon.png), the widget is theme-fixed dark — it does
/// not follow the in-app Appearance switch (NativeWind colorScheme), since
/// there is no JS/React tree running here to drive it. Hexes copied from
/// global.css / src/theme/tokens.ts so the widget matches the app exactly.
enum XavierTheme {
  static let bg = Color(hex: 0x0E1116)
  static let gradientFrom = Color(hex: 0x5B8DEF)
  static let gradientTo = Color(hex: 0x7C5BEF)
  static let income = Color(hex: 0x33C27F)
  static let expense = Color(hex: 0xF2637E)
  /// Pupil color — matches the app's near-black `bg` token, same choice
  /// XavierPet.tsx makes for its eyes (see src/components/ui/XavierPet.tsx).
  static let eye = Color(hex: 0x0E1116)
}

private extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}
