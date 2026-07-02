/**
 * Category resolution — the pure logic behind the assistant's category
 * reconciliation, mirroring payees.ts. Framework-free and side-effect-free so
 * it can be exhaustively BDD-tested in plain Node; persistence lives in the
 * feature layer (see src/features/categories).
 *
 * Match a free-text/AI-suggested name to an existing category — exactly, or
 * "did you mean…?" via a small edit-distance (fuzzy-merge guard) — scoped to
 * the transaction kind, since an expense draft must never match an income
 * category (and vice versa).
 */
import { Category, TransactionType } from './types';
import { normalizeName, editDistance, fuzzyThreshold } from './textMatch';

export interface CategoryMatch {
  /** A normalised-equal existing category of the same kind, if any. */
  exact?: Category;
  /** A close-but-not-equal existing category of the same kind, "did you mean…?". */
  suggestion?: Category;
}

/**
 * Reconcile a name against existing categories, scoped to `kind` first.
 *
 * `exact` wins outright (the caller should just use it). Otherwise we look for
 * a single close match — among same-kind categories only — using a
 * length-aware edit-distance threshold, so short names need a near-perfect
 * match while longer names tolerate a typo or two ("Trvael" → "Travel"). No
 * close match → neither field is set, and the caller is free to create the
 * name as a brand-new category.
 */
export function findCategoryMatch(
  name: string,
  kind: TransactionType,
  existing: Category[]
): CategoryMatch {
  const target = normalizeName(name);
  if (!target) return {};

  const sameKind = existing.filter((c) => c.kind === kind);

  const exact = sameKind.find((c) => normalizeName(c.name) === target);
  if (exact) return { exact };

  let best: Category | undefined;
  let bestDistance = Infinity;
  let bestThreshold = 0;
  for (const c of sameKind) {
    const candidate = normalizeName(c.name);
    const distance = editDistance(target, candidate);
    if (distance < bestDistance) {
      best = c;
      bestDistance = distance;
      bestThreshold = fuzzyThreshold(Math.max(target.length, candidate.length));
    }
  }
  if (best && bestDistance > 0 && bestDistance <= bestThreshold) {
    return { suggestion: best };
  }
  return {};
}
