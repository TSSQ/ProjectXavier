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
