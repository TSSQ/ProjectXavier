/**
 * Guided account-UPDATE flow assembly for chat — the pure, framework-free
 * brain behind an update gate hit (docs/design/account-chat-crud-spec.md
 * §5.2), mirroring `accountAssistant.ts`'s `buildReadyAccountFromChat` for
 * create. Every gate hit reaches this and lands on an EDITABLE confirm card,
 * never a question about the operation itself (a "which account?" question
 * only ever comes from `findAccountMatch` failing to resolve a target).
 *
 * Deterministic-first, model-assisted (spec §6.2 verdict): the specific
 * sub-operation (rename/retype/rebalance) is classified by verb-pattern
 * FIRST; the model's own `operation` is only a tiebreak, used exactly when
 * the deterministic classifier can't tell.
 *
 * BALANCE SAFETY (QA blocker, financial-data-corruption): `parseOpeningBalance`
 * strips every non-digit from the WHOLE utterance — fine for a genuine
 * REBALANCE ("set OCBC balance to 5000"), catastrophic for a rename/retype,
 * where any incidental digits in the text (a date, a card's last-4, "to
 * Rainy Day" has none but plenty of real utterances do) would silently
 * become the new balance, or a rename with NO digits at all would zero a
 * real balance. So `newBalance` is parsed from the text ONLY when the
 * classified op is 'rebalance' — every other op carries the EXISTING
 * account's balance through unchanged (`buildAccountUpdateDraft`), and
 * `resolveUpdatedAccount` re-enforces the same rule at the write boundary
 * (defense in depth: correct even if a draft was built incorrectly), unless
 * the user explicitly edited the balance field on the confirm card
 * (`balanceEdited`).
 */
import { Account } from './types';
import { parseOpeningBalance, normalizeSubtype } from './accountAssistant';
import { detectSubtypeCue } from './accountMatch';
import { escapeRegExp } from './textMatch';
import { AccountUpdateOperation, ACCOUNT_UPDATE_OPERATIONS } from './accountUpdateSchema';
import { AccountUpdateDraftExtraction } from './accountUpdatePrompt';

/** What the chat flow hands to an editable confirm card for an update gate
 *  hit — every field pre-filled, ready for `updateAccount` once confirmed. */
export interface AccountUpdateDraft {
  op: AccountUpdateOperation;
  newName: string;
  newSubtype?: string;
  /** The account's EXISTING balance for rename/retype (never parsed from the
   *  utterance — see the module header); `parseOpeningBalance(text)` ONLY
   *  when `op === 'rebalance'`, or whatever the user explicitly typed into
   *  the confirm card's balance field afterwards (see `balanceEdited`). */
  newBalance: number;
  /** True only when `newBalance` reflects an intentional balance change — a
   *  classified 'rebalance' op, or the user manually editing the confirm
   *  card's balance field. False means `newBalance` is just the existing
   *  balance carried through unchanged, and `resolveUpdatedAccount` must
   *  NEVER treat it as a real change even if this draft was somehow built
   *  with a wrong value. */
  balanceEdited: boolean;
}

const KNOWN_OPS = new Set<string>(ACCOUNT_UPDATE_OPERATIONS);

/**
 * Removes whole-word occurrences of `accountName` from `text` (case-
 * insensitive) before the classifier looks for a subtype cue — the account's
 * OWN name often contains a subtype word ("DBS SAVINGS", "OCBC CURRENT"),
 * which would otherwise be misread as "the user mentioned a NEW type"
 * ("change my DBS Savings name" must classify as rename, not retype, even
 * though "Savings" — the EXISTING account's own name — is a bank-subtype cue
 * word).
 */
function stripAccountName(text: string, accountName: string): string {
  if (!accountName) return text;
  return text.replace(new RegExp(escapeRegExp(accountName), 'ig'), ' ');
}

/**
 * Deterministic sub-operation classifier — the PRIMARY signal (spec §6.2):
 * an unambiguous verb ("rename", "rebalance", or a literal "balance"
 * mention) decides outright; otherwise, whether the text mentions a new
 * account TYPE at all (`detectSubtypeCue`, e.g. "a credit card", "the card")
 * — checked with the target account's OWN name stripped out first, see
 * `stripAccountName` — decides retype vs rename for the remaining edit verbs
 * (change/update/edit/set/make). Returns 'unknown' only when none of this
 * applies — the caller then falls back to the model's own `operation` as a
 * tiebreak.
 */
export function classifyAccountUpdateOp(text: string, accountName = ''): AccountUpdateOperation {
  const t = stripAccountName(text, accountName).toLowerCase();
  if (/\brebalance\b/.test(t) || /\bbalance\b/.test(t)) return 'rebalance';
  if (/\brename\b/.test(t)) return 'rename';
  if (/\bretype\b/.test(t)) return 'retype';
  if (/\b(change|update|edit|make|set)\b/.test(t)) {
    return detectSubtypeCue(t) ? 'retype' : 'rename';
  }
  return 'unknown';
}

/**
 * Assemble an `AccountUpdateDraft` from the raw utterance, the resolved
 * target `account`, and whatever the extraction ladder produced (or `null`
 * when no engine ran/produced anything usable — the deterministic floor).
 */
export function buildAccountUpdateDraft(
  text: string,
  account: Account,
  extraction: AccountUpdateDraftExtraction | null
): AccountUpdateDraft {
  const deterministicOp = classifyAccountUpdateOp(text, account.name);
  const modelOp =
    extraction && KNOWN_OPS.has(extraction.operation) && extraction.operation !== 'unknown'
      ? extraction.operation
      : null;
  const op = deterministicOp !== 'unknown' ? deterministicOp : (modelOp ?? 'unknown');

  const newName = extraction?.newName?.trim() || account.name;

  const modelSubtype =
    extraction && extraction.newSubtype !== 'unknown' ? extraction.newSubtype : undefined;
  const cueSubtype = detectSubtypeCue(stripAccountName(text, account.name)) ?? undefined;
  const newSubtype = normalizeSubtype(modelSubtype ?? cueSubtype ?? account.subtype ?? '');

  // BALANCE SAFETY — see the module header: only 'rebalance' ever parses a
  // number out of the utterance; every other op keeps the account's real,
  // existing balance so a rename/retype can never zero (or corrupt) it.
  const balanceEdited = op === 'rebalance';
  const newBalance = balanceEdited ? parseOpeningBalance(text) : account.openingBalance;

  return {
    op,
    newName,
    newSubtype,
    newBalance,
    balanceEdited,
  };
}

/** What actually gets written by `updateAccount` for a confirmed update
 *  draft — the write-time guardrail against the balance-corruption blocker
 *  (QA), kept as its OWN pure, BDD-tested function (not just relying on
 *  `buildAccountUpdateDraft`'s own default) so the write path is provably
 *  safe even if a draft were ever constructed with a stale/wrong
 *  `newBalance`: `openingBalance` only ever comes from `draft.newBalance`
 *  when `draft.balanceEdited` is true (a real rebalance, or an explicit
 *  manual edit on the confirm card) — otherwise it is ALWAYS
 *  `existing.openingBalance`, verbatim. */
export interface AccountUpdateWrite {
  name: string;
  subtype?: string;
  openingBalance: number;
}

export function resolveUpdatedAccount(
  existing: Account,
  draft: AccountUpdateDraft
): AccountUpdateWrite {
  return {
    name: draft.newName,
    subtype: draft.newSubtype,
    openingBalance: draft.balanceEdited ? draft.newBalance : existing.openingBalance,
  };
}

/**
 * The chat reply when neither the deterministic classifier nor the model
 * could tell WHAT the user wants changed about an already-resolved account
 * (`draft.op === 'unknown'`) — a clarify QUESTION (QA MINOR follow-up), not
 * a confirm card: a card built from an unknown op would write nothing
 * (`resolveUpdatedAccount` keeps the existing name/subtype/balance
 * unchanged), so showing one is a pointless no-op the user can't act on.
 * The caller (app/(tabs)/index.tsx) must check `draft.op === 'unknown'`
 * BEFORE calling `setPendingAccountUpdate` and use this message instead.
 */
export function buildAccountUpdateClarifyMessage(accountName: string): string {
  return `What would you like to change about "${accountName}"?`;
}
