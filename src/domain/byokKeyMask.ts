/**
 * Pure BYOK API-key masking (docs/design/byok-saved-key-card-spec.md) — the
 * saved-key card renders `maskApiKey(key)` instead of ever re-displaying the
 * real key. Reveals only the last 4 characters; the rest is always a
 * CONSTANT run of mask dots, so the real key's length is never leaked.
 *
 * Node-testable — no React Native / Expo imports. `app/settings/byok.tsx`
 * renders this function's output; it never sees the key itself beyond the
 * moment of save.
 */

/** Constant mask-dot count — deliberately not tied to the real key's
 *  length, so a short key can't be distinguished from a long one. */
const MASK_DOTS = '••••••••';

/** Below this length, the key is fully masked (no characters revealed). */
const MIN_REVEAL_LENGTH = 8;

/** Number of trailing characters revealed for a key at/above the threshold. */
const REVEAL_CHARS = 4;

/**
 * Mask `key` for display: reveals only the last 4 characters for a key of at
 * least 8 characters (e.g. `••••••••3f9k`); anything shorter is fully masked
 * (dots only, no revealed characters). Never returns the full key; never
 * throws.
 *
 * Length and "last 4" are both measured in Unicode CODE POINTS
 * (`Array.from`), not UTF-16 code units — a plain `.length`/`.slice(-4)`
 * can split an astral character (e.g. an emoji) across the boundary and
 * emit an orphaned surrogate half, which is never valid to render.
 */
export function maskApiKey(key: string): string {
  const safe = typeof key === 'string' ? key : '';
  const codePoints = Array.from(safe);
  if (codePoints.length < MIN_REVEAL_LENGTH) {
    return MASK_DOTS;
  }
  return `${MASK_DOTS}${codePoints.slice(-REVEAL_CHARS).join('')}`;
}
