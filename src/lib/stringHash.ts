/**
 * Deterministic string hash (djb2) used to derive a stable palette index or
 * similar per-string pick — e.g. a payee's initial-letter avatar colour —
 * without persisting anything extra.
 */
export function stringHash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33) ^ s.charCodeAt(i);
  }
  return hash >>> 0; // unsigned, so callers can safely `% palette.length`
}

/**
 * First "letter" of a name for an initial-letter avatar: the first
 * grapheme-ish character (handled via Array.from, so surrogate-pair emoji
 * don't get split), uppercased only when it's alphabetic (so digits, emoji,
 * and punctuation render as-is rather than a no-op uppercase). Never returns
 * an empty string — falls back to "?" for a blank/whitespace-only name.
 */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = Array.from(trimmed)[0]!;
  return /\p{L}/u.test(first) ? first.toUpperCase() : first;
}
