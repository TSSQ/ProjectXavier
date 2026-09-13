/**
 * Turns a stored account `subtype` into something a person should read.
 *
 * The store screenshots for 1.2 caught this: the Dashboard showed
 * "credit_card" verbatim under an account name. `ACCOUNT_SUBTYPE_CHOICES`
 * already carried "Credit card" for exactly that value — three render sites
 * just never used it (app/(tabs)/dashboard.tsx, app/manage-accounts.tsx,
 * app/account/[id].tsx).
 *
 * A lookup alone is not enough, which is the part worth knowing. `subtype` is
 * a FREE-TEXT field on the manage-accounts screen, and `normalizeSubtype`
 * snake_cases whatever is typed (`"my piggy bank"` -> `my_piggy_bank`), so the
 * underscore leak reaches any value a user invents, not just the six known
 * kinds. Hence the fallback: humanise the separators and capitalise the first
 * letter, while leaving the user's own words alone.
 *
 * No React/Expo imports — this runs in the plain-Node BDD suite.
 */
import { ACCOUNT_SUBTYPE_CHOICES } from './accountAssistant';

// Typed as <string, string> deliberately: the choices array narrows to a
// union of its own literals, but the lookup key is whatever is stored,
// and free-text subtypes are by definition outside that union.
const LABEL_BY_VALUE: Map<string, string> = new Map(
  ACCOUNT_SUBTYPE_CHOICES.map((c) => [c.value, c.label]),
);

/** `"unknown"` is the sentinel the assistant's draft uses when it could not
 *  tell what kind of account this is — it is a stand-in for "not answered",
 *  not a kind of account, so it must never surface as the word "Unknown"
 *  under someone's account name. Rendering nothing is the honest output. */
const NOT_A_KIND = new Set(['unknown']);

export function accountSubtypeLabel(subtype: string | null | undefined): string | null {
  if (subtype == null) return null;
  const trimmed = subtype.trim();
  if (trimmed === '') return null;

  const lowered = trimmed.toLowerCase();
  if (NOT_A_KIND.has(lowered)) return null;

  const known = LABEL_BY_VALUE.get(lowered);
  if (known != null) return known;

  // A subtype the user invented. Undo the snake_casing `normalizeSubtype`
  // applied, collapse any repeated separators, and capitalise only the first
  // letter — their casing in the remaining words is theirs to keep.
  const spaced = trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (spaced === '') return null;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The account row's muted second line: kind, tag, and (where the caller asks
 * for it) "Archived", joined with " · ".
 *
 * This exists because the first pass at the subtype fix chased *call sites* —
 * it patched the three screens that showed `credit_card` and missed two more,
 * `AccountPickerSheet` and `AccountFilterSheet`, which had copied the same
 * `[subtype, tag].filter(Boolean).join(' · ')` expression. (The picker's own
 * comment says it is "the same idiom as manage-accounts.tsx's renderRow", so
 * the duplication was deliberate and documented — and still got missed.) One
 * function is the only version of this that a future copy-paste cannot get
 * wrong: there is nothing left to copy but a call.
 *
 * `archived` is opt-in rather than read off the account, because
 * manage-accounts appends its own "· Archived" suffix for muted rows and
 * would otherwise say it twice.
 */
export function accountMetaLine(
  parts: { subtype?: string | null; tag?: string | null; archived?: boolean | null },
  fallback = '',
): string {
  const line = [accountSubtypeLabel(parts.subtype), parts.tag, parts.archived ? 'Archived' : null]
    .filter(Boolean)
    .join(' · ');
  return line || fallback;
}
