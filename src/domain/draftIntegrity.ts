/**
 * Write-boundary guard for a confirmed assistant draft
 * (docs/design/stale-draft-spec.md — "a pending draft must not outlive the
 * data it points at").
 *
 * A confirm-card `TransactionDraft` freezes `accountId` and `currency` at the
 * moment it was built (`interpret()`/`interpretTransfer()`/`rowsToDrafts()`)
 * and can sit on screen indefinitely — tab switches don't unmount it
 * (app/(tabs)/_layout.tsx uses a plain `<Tabs>`). Meanwhile the account it
 * points at can be deleted, or its currency relabelled in place (Settings'
 * `relabelCurrency` rewrites every account/transaction row's currency code
 * but knows nothing about in-memory state), or the whole DB replaced by a
 * backup restore — and `transactions.accountId` has no `.references()`
 * (src/db/schema.ts) to catch any of that at the SQL layer. The write itself
 * has to check.
 *
 * A transfer draft carries a SECOND account reference — `transferAccountId`,
 * the destination — with the exact same exposure: deleting the destination
 * account behind an open transfer card leaves the same orphan, through the
 * same unchecked write, so it gets the same guard as the source (`accountId`).
 * The two get distinct statuses/errors so the copy can say which side
 * disappeared rather than a generic "an account is gone".
 *
 * This closes two of CLAUDE.md's architecture guardrails:
 *  - #1, "SQLite is the source of truth" — a stale in-memory draft must
 *    never out-rank what's actually in the DB right now.
 *  - #3, "ask, never convert" — a currency conflict that only becomes
 *    visible at save time (because the account was relabelled after the
 *    card was built) gets the exact same refusal `currencyConflict` gives a
 *    conflict caught at parse time; the "ask already happened, against
 *    stale facts" loophole is closed.
 *
 * Pure and framework-free, same discipline as `interpret()`
 * (domain/assistant.ts): takes the live account list as an argument instead
 * of reading the DB, so it's directly BDD-testable in the plain-Node suite
 * and the actual DB read stays in features/ai/saveDraft.ts. Shared by both
 * layers of the fix — src/features/ai/saveDraft.ts's write-time refusal
 * (§3.1) and app/(tabs)/index.tsx's focus-time re-validation (§3.2) call the
 * same `checkDraftIntegrity`, so "what counts as stale" is decided in
 * exactly one place.
 */
import { Account } from './types';
import { TransactionDraft } from './assistant';
import { currencyConflict } from './currencyConflict';

/** Thrown by `assertDraftIsSaveable` when a draft's `accountId` no longer
 *  matches any account — it was deleted (or a backup restore replaced the
 *  ledger) while the card sat on screen. Carries no account id; the message
 *  is all the screen needs. */
export class DraftAccountGoneError extends Error {
  constructor() {
    super("That account doesn't exist anymore.");
    this.name = 'DraftAccountGoneError';
  }
}

/** Thrown by `assertDraftIsSaveable` when a TRANSFER draft's
 *  `transferAccountId` (the destination) no longer matches any account —
 *  the same exposure as `DraftAccountGoneError`, on the other side of the
 *  transfer. Kept as its own type (rather than reusing
 *  `DraftAccountGoneError`) so the screen can tell the user which account
 *  disappeared. */
export class DraftTransferAccountGoneError extends Error {
  constructor() {
    super("The account you're moving money to doesn't exist anymore.");
    this.name = 'DraftTransferAccountGoneError';
  }
}

/** Thrown by `assertDraftIsSaveable` when the draft's frozen `currency` no
 *  longer matches the account's CURRENT currency — e.g. Settings'
 *  `relabelCurrency` ran after the card was built. Saving would silently
 *  write the old code into a relabelled ledger; refusing here mirrors what
 *  `interpret()` would have decided had it run right now (see
 *  domain/currencyConflict.ts). */
export class DraftCurrencyStaleError extends Error {
  constructor() {
    super("This account's currency changed since then.");
    this.name = 'DraftCurrencyStaleError';
  }
}

/** The outcomes `checkDraftIntegrity` can report. `'ok'` means the draft is
 *  still safe to save/keep exactly as built. */
export type DraftIntegrityStatus =
  | 'ok'
  | 'account-gone'
  | 'transfer-account-gone'
  | 'currency-changed';

/**
 * Does `draft` still make sense against `accounts` (the live list, read at
 * check time)? Never throws — a pure yes/no/why for callers (like the
 * screen's focus-time re-validation) that need to decide rather than fail.
 *
 * Source (`accountId`) is checked before the transfer destination
 * (`transferAccountId`), which is checked before currency — an arbitrary but
 * stable precedence, since a draft can only be reported as ONE status at a
 * time.
 */
export function checkDraftIntegrity(
  draft: TransactionDraft,
  accounts: Account[]
): DraftIntegrityStatus {
  const account = accounts.find((a) => a.id === draft.accountId);
  if (!account) return 'account-gone';
  // `transferAccountId` is only ever set for `type === 'transfer'` (see
  // TransactionDraft's own field comment) — the type check is belt-and-
  // braces, not load-bearing.
  if (draft.type === 'transfer' && draft.transferAccountId) {
    const dest = accounts.find((a) => a.id === draft.transferAccountId);
    if (!dest) return 'transfer-account-gone';
  }
  if (currencyConflict(draft.currency, account.currency)) return 'currency-changed';
  return 'ok';
}

/**
 * Refuse to save `draft` against `accounts` (the live list, read at save
 * time) if any of the above has been invalidated since the card was built.
 * Throws a typed error the screen can catch and explain — never a silent
 * no-op (§3.1) — and resolves with nothing when the draft is still good to
 * write.
 */
export function assertDraftIsSaveable(draft: TransactionDraft, accounts: Account[]): void {
  const status = checkDraftIntegrity(draft, accounts);
  if (status === 'account-gone') throw new DraftAccountGoneError();
  if (status === 'transfer-account-gone') throw new DraftTransferAccountGoneError();
  if (status === 'currency-changed') throw new DraftCurrencyStaleError();
}
