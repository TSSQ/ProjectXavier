/**
 * Currency-conflict check — the pure decision behind the "foreign-currency
 * amount corrupts balances" fix (a live money bug: `interpret()` in
 * assistant.ts used to store an AI-parsed transaction under whatever
 * currency the model heard in the text, even when it differed from the
 * destination account's own currency — e.g. "5.45 USD" into an SGD account
 * saved as USD 5.45, then every balance/total in domain/balances.ts and
 * domain/period.ts summed `tx.amount` currency-blind, so it moved the SGD
 * balance by 5.45 SGD instead. This app never converts currency (no FX, no
 * rates, no network call — CLAUDE.md #3): the fix is to ask, never guess.
 *
 * `currencyConflict` is that ask/don't-guess decision, factored out so it's
 * framework-free and directly BDD-testable. `interpret()`/`interpretTransfer()`
 * are the only callers today: when this returns true, they force the draft's
 * `currency` to the account's own currency (never the mismatched one) and
 * flag the draft so the confirm card can require the user to re-enter the
 * amount themselves before it can be saved.
 */

/**
 * True when `draftCurrency` names a currency that conflicts with
 * `accountCurrency` — i.e., both are present and, compared case/whitespace-
 * insensitively, differ. A missing/blank value on EITHER side is never a
 * conflict: there's nothing to compare, so the caller's own default (the
 * account's own currency) applies with no warning.
 */
export function currencyConflict(
  draftCurrency: string | null | undefined,
  accountCurrency: string | null | undefined
): boolean {
  const draft = (draftCurrency ?? '').trim().toUpperCase();
  const account = (accountCurrency ?? '').trim().toUpperCase();
  if (!draft || !account) return false;
  return draft !== account;
}
