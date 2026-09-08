/**
 * Regression fixture for glass-standard.feature's "multi-line Feather size"
 * scenario (QA round 1). `<Feather ... size={N} .../>` wrapped across lines
 * — the idiomatic RN/Prettier formatting — used to be invisible to a
 * per-line scan: not flagged, and not counted against any allowlist budget.
 *
 * Lives under tests/fixtures/, not app/ or src/, so it is never picked up by
 * the real source-scan scenarios in glass-standard.steps.ts (those only walk
 * app/ and src/) — the dedicated regression scenario reads this file
 * directly instead.
 */
import { Feather } from '@expo/vector-icons';

export function MultilineFeatherFixture() {
  return (
    <Feather
      name="x"
      size={20}
      color="#000"
    />
  );
}
