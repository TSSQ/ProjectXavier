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
