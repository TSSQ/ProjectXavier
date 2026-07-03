/**
 * Session-local account filter helpers.
 *
 * Selection = null means "all accounts"; string[] is an explicit allow-list of
 * account ids. All functions are pure and total — they never throw on empty
 * inputs.
 */

/** null = all accounts selected; string[] = explicit id allow-list. */
export type Selection = string[] | null;

/** True when the selection means "all accounts". */
export function isAllSelected(sel: Selection): boolean {
  return sel === null;
}

/**
 * The effective set of ids for a selection, restricted to ids that actually
 * exist in `accountIds`. Falls back to all ids if the filtered result is empty.
 */
export function effectiveIds(sel: Selection, accountIds: string[]): string[] {
  const candidates = sel ?? accountIds;
  const valid = candidates.filter((id) => accountIds.includes(id));
  return valid.length === 0 ? accountIds : valid;
}

/** Returns a "show all" selection. */
export function selectAll(): Selection {
  return null;
}

/**
 * Toggle a single account in a selection.
 *
 * - All-accounts (null) → focus on just `id`.
 * - Already selected → remove it (empty result = null = all; full set = null).
 * - Not selected → add it (full set = null).
 */
export function toggleAccount(
  sel: Selection,
  id: string,
  accountIds: string[]
): Selection {
  if (sel === null) {
    // Focusing on a single account from the "all" state.
    return [id];
  }
  const set = new Set(sel);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  if (set.size === 0) return null;
  if (set.size === accountIds.length) return null;
  return Array.from(set);
}

/**
 * Convert a draft id array from the filter sheet to a canonical Selection.
 * Empty → null (all). Full set → null (all). Otherwise keep the array.
 */
export function commitDraft(draftIds: string[], total: number): Selection {
  if (draftIds.length === 0) return null;
  if (draftIds.length === total) return null;
  return draftIds;
}

/**
 * Human-readable label for the current selection.
 * "All accounts" | account name | "N accounts"
 *
 * Derives from effectiveIds so that a stale selection (all ids gone) mirrors
 * the "all" fallback in effectiveIds and returns "All accounts" rather than
 * "0 accounts".
 */
export function scopeLabel(
  sel: Selection,
  accounts: { id: string; name: string }[]
): string {
  const ids = accounts.map(a => a.id);
  const eff = effectiveIds(sel, ids);
  if (isAllSelected(sel) || eff.length === ids.length) return 'All accounts';
  if (eff.length === 1) {
    return accounts.find(a => a.id === eff[0])?.name ?? '1 account';
  }
  return `${eff.length} accounts`;
}

/**
 * Split accounts into inline pills and a "more" count, capped at `cap`.
 *
 * - All selected: first `cap` accounts inline, rest as moreCount.
 * - Subset: only selected accounts; moreCount = accounts.length - inline.length.
 */
export function pillsSplit<T extends { id: string }>(
  accounts: T[],
  sel: Selection,
  cap: number
): { inline: T[]; moreCount: number } {
  if (isAllSelected(sel)) {
    const inline = accounts.slice(0, cap);
    return { inline, moreCount: accounts.length - inline.length };
  }
  const ids = new Set(sel!);
  const inline = accounts.filter((a) => ids.has(a.id));
  return { inline, moreCount: accounts.length - inline.length };
}

/**
 * Label for the Apply button in the filter sheet.
 * "Show all accounts" | "Show 1 account" | "Show N accounts"
 */
export function applyLabel(draftCount: number, total: number): string {
  if (draftCount === total || draftCount === 0) return 'Show all accounts';
  if (draftCount === 1) return 'Show 1 account';
  return `Show ${draftCount} accounts`;
}
