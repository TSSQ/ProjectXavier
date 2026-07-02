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
import { normalizeName, editDistance, fuzzyThreshold } from './textMatch';

// Re-exported so existing import sites (e.g. Combobox, this file's own BDD
// steps) keep working — the canonical definitions now live in textMatch.ts,
// shared with categories.ts.
export { normalizeName, editDistance, fuzzyThreshold };

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
