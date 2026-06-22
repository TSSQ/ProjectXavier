/**
 * Payee resolution — the pure logic behind "pick or create a payee" and the
 * assistant's payee reconciliation. Framework-free and side-effect-free so it
 * can be exhaustively BDD-tested in plain Node; persistence lives in the feature
 * layer (see src/features/payees).
 *
 * Two jobs:
 *  1. Match a free-text/AI-suggested name to an existing payee — exactly, or
 *     "did you mean…?" via a small edit-distance (fuzzy-merge guard).
 *  2. Decide which category to auto-fill: an existing payee's learned default,
 *     otherwise whatever the user/AI supplied.
 */
import { Payee } from './types';

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

export interface PayeeMatch {
  /** A normalised-equal existing payee, if any. */
  exact?: Payee;
  /** A close-but-not-equal existing payee to offer as "did you mean…?". */
  suggestion?: Payee;
}

/**
 * Reconcile a name against existing payees.
 *
 * `exact` wins outright (the caller should just use it). Otherwise we look for a
 * single close match using a length-aware edit-distance threshold, so short
 * names need a near-perfect match while longer names tolerate a typo or two
 * ("starbux" → "Starbucks"). No close match → neither field is set, and the
 * caller is free to create the name as a brand-new payee.
 */
export function findPayeeMatch(name: string, existing: Payee[]): PayeeMatch {
  const target = normalizeName(name);
  if (!target) return {};

  const exact = existing.find((p) => normalizeName(p.name) === target);
  if (exact) return { exact };

  let best: Payee | undefined;
  let bestDistance = Infinity;
  let bestThreshold = 0;
  for (const p of existing) {
    const candidate = normalizeName(p.name);
    const distance = editDistance(target, candidate);
    if (distance < bestDistance) {
      best = p;
      bestDistance = distance;
      bestThreshold = fuzzyThreshold(Math.max(target.length, candidate.length));
    }
  }
  if (best && bestDistance > 0 && bestDistance <= bestThreshold) {
    return { suggestion: best };
  }
  return {};
}

/**
 * Edit-distance budget for a suggestion, scaled to the longer of the two names:
 * always allow a typo or two, and ~a third of the characters for longer names
 * (so "starbux" ≈ "starbucks", but unrelated names stay apart).
 */
export function fuzzyThreshold(maxLen: number): number {
  return Math.max(2, Math.round(maxLen * 0.34));
}

/**
 * Decide the category id for a transaction given an (optionally) explicit choice
 * and the resolved payee. An explicit category always wins; otherwise we fall
 * back to the payee's learned default ("prefer learned default").
 */
export function resolveCategoryId(
  explicitCategoryId: string | null | undefined,
  payee: Payee | null | undefined
): string | null {
  if (explicitCategoryId) return explicitCategoryId;
  return payee?.defaultCategoryId ?? null;
}
