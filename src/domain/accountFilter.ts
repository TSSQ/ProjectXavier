/**
 * Account filter helpers behind the Dashboard's account-filter pills/sheet.
 * The selection persists across launches (`dashboard_account_filter`, via
 * `getAccountFilterSelection`/`setAccountFilterSelection`,
 * src/features/settings/repository.ts) — `serializeSelection`/
 * `deserializeSelection` below are the pure (de)serialisation used at that
 * boundary. Selection = null means "all accounts"; string[] is an explicit
 * allow-list of account ids. All functions are pure and total — they never
 * throw on empty inputs.
 */
import { z } from 'zod';

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

// ─── Persistence (de)serialisation ──────────────────────────────────────────
//
// The setting itself is a plain string (getSetting/setSetting,
// src/features/settings/repository.ts), so a Selection has to round-trip
// through JSON. `null` serialises to the string "null"; an id list serialises
// to a JSON array — the two are trivially distinguishable on the way out.
//
// `storedSelectionSchema` is the shape allowed back in: `null` or an array of
// strings, nothing else. Anything read from the settings table is a trust
// boundary (CLAUDE.md guardrail #6) — an old app version, a hand-edited row,
// or plain disk corruption could hand back something else entirely — so
// `deserializeSelection` never throws and always degrades unrecognised input
// to `null` ("all accounts"), the same safe default an unset setting uses.

const storedSelectionSchema = z.array(z.string()).nullable();

/** Serialise a `Selection` for storage via `setSetting`. Plain JSON — see
 *  `deserializeSelection` for the inverse and how "all accounts" is told
 *  apart from an "explicit empty" selection on the way back in. */
export function serializeSelection(sel: Selection): string {
  return JSON.stringify(sel);
}

/**
 * Parse a persisted selection back into a `Selection`. Never throws.
 *
 * - `raw == null` (no row written yet) → `null` ("all accounts"), same as any
 *   other never-configured setting.
 * - Unparseable JSON, or JSON that isn't `null`/an array of strings (a
 *   number, an object, an array containing a non-string) → `null`. A
 *   malformed/garbage value must degrade safely, never throw.
 * - An explicit empty array (`"[]"`) → also `null`. Nothing in this module
 *   ever PRODUCES a non-null empty selection — `commitDraft` and
 *   `toggleAccount` both collapse an empty set back to `null` already — so a
 *   stored `[]` can only be a hand-edited or foreign value; treating it as
 *   "all accounts" (rather than "show zero accounts") keeps this function's
 *   output inside the same domain `effectiveIds` and friends already expect.
 */
export function deserializeSelection(raw: string | null | undefined): Selection {
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = storedSelectionSchema.safeParse(parsed);
  if (!result.success || result.data === null || result.data.length === 0) return null;
  return result.data;
}
