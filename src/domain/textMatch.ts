/**
 * Generic string-matching helpers shared by the payee and category matchers
 * (see payees.ts, categories.ts). Framework-free and side-effect-free so it
 * can be exhaustively BDD-tested in plain Node.
 */

/** Normalise for comparison: trim, collapse inner whitespace, lowercase. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
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
