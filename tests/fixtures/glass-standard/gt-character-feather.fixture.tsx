/**
 * Regression fixture for glass-standard.feature's "stray '>' before size"
 * scenario (QA round 2 MAJOR 1, vector 2). The old tag scan stopped dead at
 * the FIRST '>' character after `<Feather`, so an ordinary quoted attribute
 * value containing '>' — an accessibilityLabel here, a `testID={x > 0 ? …}`
 * or a `{/* comment > *\/}` in the wild — hid an otherwise-plain off-scale
 * literal with no trace at all.
 *
 * Lives under tests/fixtures/, not app/ or src/, so it is never picked up by
 * the real source-scan scenarios (those only walk app/ and src/) — the
 * dedicated regression scenario reads this file directly instead.
 */
import { Feather } from '@expo/vector-icons';

export function GtCharacterFeatherFixture() {
  return <Feather accessibilityLabel="Continue >" name="arrow-right" size={20} color="#000" />;
}
