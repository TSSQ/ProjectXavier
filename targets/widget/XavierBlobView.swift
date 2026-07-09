import SwiftUI

/// Xavier's face, redrawn in plain SwiftUI (no image assets, no third-party
/// deps) to mirror assets/icon.png: a blue→purple gradient circle, a soft
/// top-left specular highlight, and two dark rounded-pill eyes each with a
/// small white catchlight. This is a static mirror of the app icon's look —
/// none of XavierPet.tsx's Reanimated motion (breathing, blinking, mood
/// states) makes sense in a WidgetKit timeline snapshot, so only the resting
/// "idle" pose is drawn here.
struct XavierBlobView: View {
  var diameter: CGFloat = 60

  var body: some View {
    ZStack {
      Circle()
        .fill(
          LinearGradient(
            colors: [XavierTheme.gradientFrom, XavierTheme.gradientTo],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )

      // Soft top-left highlight — mirrors the radial highlight baked into
      // assets/icon.png.
      Ellipse()
        .fill(Color.white.opacity(0.22))
        .frame(width: diameter * 0.46, height: diameter * 0.26)
        .blur(radius: diameter * 0.08)
        .offset(x: -diameter * 0.12, y: -diameter * 0.24)
        .mask(Circle())

      HStack(spacing: diameter * 0.12) {
        XavierEyeView(diameter: diameter)
        XavierEyeView(diameter: diameter)
      }
      .offset(y: diameter * 0.02)
    }
    .frame(width: diameter, height: diameter)
  }
}

/// One dark rounded-pill eye with a small white catchlight, positioned like
/// the app icon's eyes (catchlight near the top-inner corner).
private struct XavierEyeView: View {
  var diameter: CGFloat

  var body: some View {
    ZStack(alignment: .topLeading) {
      RoundedRectangle(cornerRadius: diameter * 0.065)
        .fill(XavierTheme.eye)
        .frame(width: diameter * 0.115, height: diameter * 0.17)
      Circle()
        .fill(Color.white)
        .frame(width: diameter * 0.032, height: diameter * 0.032)
        .offset(x: diameter * 0.028, y: diameter * 0.03)
    }
  }
}
