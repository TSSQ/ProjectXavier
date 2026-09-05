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
 * GLASS_UI_ENABLED gates the Liquid Glass material (Phase 1 tokens/primitive —
 * src/theme/glassTokens.ts, src/components/ui/Glass.tsx — and Phase 2 chrome:
 * tab bar, composer, FAB, sheets).
 *
 * ON by default on iOS as of Phase 2 ("Phase 2 is what makes it worth
 * switching on by default" — docs/design/glass-phase2-spec.md D2).
 * `EXPO_PUBLIC_GLASS=0` is the escape hatch. The platform gate itself lives in
 * useGlass() rather than here: this file is imported by parseMetrics, which
 * the plain-Node BDD suite loads, so it stays free of any `react-native`
 * import (Platform included).
 */
export const GLASS_UI_ENABLED: boolean = process.env.EXPO_PUBLIC_GLASS !== '0';
