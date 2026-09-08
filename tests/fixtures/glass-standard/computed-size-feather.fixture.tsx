/**
 * Regression fixture for glass-standard.feature's "non-literal Feather size"
 * scenario (QA round 2 MAJOR 1, vector 1). `iconSize` here is an arbitrary
 * local variable — not a digit literal, and not `ICON.sm`/`md`/`lg` (the one
 * symbolic form the guard's modest evaluator resolves) — so it must surface
 * as a COMPUTED match the scan can't statically resolve, forcing an
 * allowlist decision, rather than producing zero matches and passing
 * invisibly. `app/welcome.tsx:319`'s `size={Math.round(size * (56 / 140))}`
 * is the same bug, live in the tree.
 *
 * Lives under tests/fixtures/, not app/ or src/, so it is never picked up by
 * the real source-scan scenarios (those only walk app/ and src/) — the
 * dedicated regression scenario reads this file directly instead.
 */
import { Feather } from '@expo/vector-icons';

export function ComputedSizeFeatherFixture({ iconSize }: { iconSize: number }) {
  return <Feather name="alert-circle" size={iconSize} color="#000" />;
}
