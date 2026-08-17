/**
 * Build-time feature flags.
 *
 * METRICS_ENABLED gates the parse-diagnostics instrumentation (see
 * src/features/diagnostics/parseMetrics.ts and docs/design/parse-metrics-spec.md).
 * It is ON in dev and in any build that sets EXPO_PUBLIC_METRICS=1 (wire this to
 * the EAS preview/development profile only). In production it is OFF, so every
 * metrics write compiles down to a no-op and nothing is ever recorded.
 */
declare const __DEV__: boolean;

export const METRICS_ENABLED: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_METRICS === '1';

/**
 * GLASS_UI_ENABLED gates the Liquid Glass material (Phase 1 of the Apple Glass
 * UI proposal — src/theme/glassTokens.ts, src/components/ui/Glass.tsx).
 *
 * OFF by default, including in dev, so Phase 1 can land without changing a
 * single pixel of the shipping app: every `<Glass>` renders its opaque
 * fallback until this is turned on. Set EXPO_PUBLIC_GLASS=1 to see the
 * material. Phase 2 (chrome) is what makes it worth switching on by default.
 */
export const GLASS_UI_ENABLED: boolean = process.env.EXPO_PUBLIC_GLASS === '1';
