import { requireOptionalNativeModule } from 'expo-modules-core';

interface WidgetBridgeModule {
  /** Ask WidgetKit to redraw every timeline for this app's widgets. */
  reloadWidgets(): Promise<void>;
}

// Optional so importing this file never throws where the native module isn't
// linked (Android, Expo Go) — same seam as modules/apple-ocr.
const WidgetBridge = requireOptionalNativeModule<WidgetBridgeModule>('WidgetBridge');

/**
 * Fire-and-forget: nudges WidgetKit to reload the Xavier widget's `.never`
 * timeline right after src/features/widget/summary.ts writes a fresh
 * App-Group summary. Never throws and never needs to be awaited — a missing
 * module (Android, Expo Go, a build without the widget target) or a failed
 * native call must never surface to the caller; widget staleness is not
 * worth surfacing (see summary.ts's file header).
 */
export function reloadWidgets(): void {
  WidgetBridge?.reloadWidgets().catch(() => {
    // Swallow — see doc comment above.
  });
}

export default reloadWidgets;
