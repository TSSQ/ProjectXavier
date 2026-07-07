/**
 * Generic string-matching helpers shared by the payee and category matchers
 * (see payees.ts, categories.ts). Framework-free and side-effect-free so it
 * can be exhaustively BDD-tested in plain Node.
 */

/** Normalise for comparison: trim, collapse inner whitespace, lowercase. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Escape regex metacharacters so a name can be embedded literally in a
 *  pattern. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex fragment matching `name` as a whole "word" in surrounding text: a
 * leading `\b` (names normally start with a word char) and a trailing
 * NEGATIVE LOOKAHEAD instead of `\b` — `\b` never matches immediately after a
 * non-word character, so a name ending in punctuation ("Acme Inc.", "Savings
 * (USD)") would otherwise never be considered bounded and a real mention
 * would be missed. The lookahead still rejects a longer word continuing past
 * the name (e.g. "Invest" inside "Investments") while accepting trailing
 * punctuation. Shared by `mentionedInText` (deviceParsePrompt.ts) and
 * `resolveTransferAccounts` (assistant.ts) so both name-in-text checks agree.
 */
export function boundedNamePattern(name: string): string {
  return `\\b${escapeRegExp(name)}(?![a-zA-Z0-9_])`;
}

/**
 * True when one normalized name contains the other as a whole-word phrase AND
 * the contained name makes up at least half the container's length. This is
 * the generic "same name plus noise words" signal — "kopitiam" vs "the old
 * kopitiam" — without hardcoding any stopword/article list, so it works in
 * any language. It complements the edit-distance net, which only tolerates
 * ~a third of the length in changes and so misses longer word additions. The
 * length ratio stops a short name ("shop") from claiming every longer phrase
 * that happens to contain it. Equal-length strings are never variants
 * (that's an exact match, handled elsewhere).
 */
export function isWholeWordVariant(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short || short.length === long.length) return false;
  if (short.length / long.length < 0.5) return false;
  return new RegExp(boundedNamePattern(short), 'i').test(long);
}

/** Classic Levenshtein edit distance between two strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Single rolling row keeps this O(min) space.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1, // insertion
        prev[j]! + 1, // deletion
        prev[j - 1]! + cost // substitution
      );
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/**
 * Edit-distance budget for a suggestion, scaled to the longer of the two names:
 * always allow a typo or two, and ~a third of the characters for longer names
 * (so "starbux" ≈ "starbucks", but unrelated names stay apart).
 */
export function fuzzyThreshold(maxLen: number): number {
  return Math.max(2, Math.round(maxLen * 0.34));
}
