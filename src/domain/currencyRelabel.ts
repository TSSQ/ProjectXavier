/**
 * Single-currency relabel (review F1 / M7) — pure domain logic.
 *
 * The app is single-currency: every account/transaction/recurring-template
 * row always carries the same `currency` code as the app-level setting
 * (src/features/settings/repository.ts). Changing that setting RELABELS every
 * stored amount to the new code — it never converts (no FX, no rates, no
 * network) — but a stored integer minor-unit amount only means the same
 * major-unit number if the old and new currencies share the same exponent.
 * When they don't (e.g. SGD → JPY), the integer itself must be rescaled so
 * the DISPLAYED number is preserved (1,000.00 SGD becomes ¥1,000, not
 * ¥100,000 or ¥10).
 *
 * `relabelCurrencyWithStore` is the actual relabel algorithm, but it depends
 * on nothing except the small `RelabelStore` port below — so it's fully
 * Node-testable with a fake/in-memory store, even though the real store
 * (src/features/settings/repository.ts) is backed by Drizzle/expo-sqlite and
 * can't run outside the app.
 */
import { currencyExponent, SUPPORTED_CURRENCIES } from './currency';
import { RecurrenceTemplate } from './types';

const SUPPORTED_CURRENCY_SET = new Set<string>(SUPPORTED_CURRENCIES);

/** True iff `code` (case/whitespace-insensitive) is one of the app's
 *  supported currencies. Guardrail #6: the trust boundary for `newCode`
 *  before it's ever written to a row — a future non-UI caller (deep link,
 *  restore-triggered relabel, etc.) can't push a garbage code into the
 *  ledger this way. */
export function isSupportedCurrencyCode(code: string): boolean {
  return SUPPORTED_CURRENCY_SET.has((code ?? '').trim().toUpperCase());
}

/** `Math.round(minor * 10 ** (toExp - fromExp))`. Identity when the two
 *  currencies share an exponent; rounds when the target has FEWER decimals
 *  (inherent to re-denominating into a lower-precision currency, not a bug —
 *  the Settings warning modal must say so). */
export function rescaleMinor(minor: number, fromExp: number, toExp: number): number {
  if (fromExp === toExp) return minor;
  return Math.round(minor * 10 ** (toExp - fromExp));
}

/** Rescale a single stored amount from `fromCode`'s exponent to `toCode`'s. */
export function relabelAmount(minor: number, fromCode: string, toCode: string): number {
  return rescaleMinor(minor, currencyExponent(fromCode), currencyExponent(toCode));
}

/** True only when the ledger is truly empty (no accounts, no transactions) —
 *  the only case Settings may change currency without the warn+confirm modal
 *  (relabelling zero rows has nothing to disclose). Recurring templates don't
 *  gate this: a series with no posted transactions yet still has no visible
 *  amounts to relabel-and-warn about, and the next `postDueOccurrences` run
 *  posts it (already relabelled) after this returns. */
export function canChangeCurrencyFreely(counts: {
  accountCount: number;
  transactionCount: number;
}): boolean {
  return counts.accountCount === 0 && counts.transactionCount === 0;
}

// ─── relabel algorithm, over an injectable store ───────────────────────────

export interface RelabelRow {
  id: string;
  currency: string;
  /** Minor-unit amount (an account's `openingBalance`, or a transaction's
   *  `amount`). */
  amount: number;
}

export interface RelabelTemplateRow {
  id: string;
  template: RecurrenceTemplate;
}

/**
 * The narrow port `relabelCurrencyWithStore` needs from the DB layer. The
 * real implementation (src/features/settings/repository.ts) wraps Drizzle;
 * tests use a plain in-memory fake (see currency-relabel.feature).
 */
export interface RelabelStore {
  getCurrency(): Promise<string>;
  listAccountRows(): Promise<RelabelRow[]>;
  listTransactionRows(): Promise<RelabelRow[]>;
  listRecurringTemplateRows(): Promise<RelabelTemplateRow[]>;
  updateAccountRow(id: string, currency: string, amount: number): Promise<void>;
  updateTransactionRow(id: string, currency: string, amount: number): Promise<void>;
  updateRecurringTemplateRow(id: string, template: RecurrenceTemplate): Promise<void>;
  setCurrencySetting(code: string): Promise<void>;
  /** Bumps the data-revision counter (F3) so a backup fires after the
   *  relabel — called exactly once, after the writes below. */
  bumpDataRevision(): Promise<void>;
  /** Runs `fn` atomically (a single DB transaction) — every row write below
   *  happens inside it, so a mid-relabel failure can't leave a half-relabelled
   *  (mixed-currency) ledger. */
  runInTransaction(fn: () => Promise<void>): Promise<void>;
}

/**
 * Relabels every stored amount from the store's current currency to
 * `newCode`: rewrites `currency` on every account/transaction/recurring-
 * template row and rescales its amount (identity when the exponent is
 * unchanged), updates the currency setting, then bumps the data revision
 * once. All row writes happen inside one transaction (`runInTransaction`) —
 * either the whole ledger ends up single-currency under `newCode`, or none
 * of it changes (a callback that throws mid-way — see `RelabelStore.
 * runInTransaction` — must roll every write in this pass back, not just stop
 * partway).
 *
 * Throws (before touching the store at all) when `newCode` isn't one of
 * `SUPPORTED_CURRENCIES` (guardrail #6) — normalising case/whitespace first,
 * so "jpy" / " JPY " still resolve, but a genuinely unknown/garbage code
 * (e.g. from a future non-UI caller) is rejected rather than written into
 * every row.
 */
export async function relabelCurrencyWithStore(
  store: RelabelStore,
  newCode: string
): Promise<void> {
  if (!isSupportedCurrencyCode(newCode)) {
    throw new Error(`relabelCurrency: "${newCode}" is not a supported currency code`);
  }
  const normalizedCode = newCode.trim().toUpperCase();

  const oldCode = await store.getCurrency();
  const fromExp = currencyExponent(oldCode);
  const toExp = currencyExponent(normalizedCode);

  await store.runInTransaction(async () => {
    const accounts = await store.listAccountRows();
    for (const row of accounts) {
      await store.updateAccountRow(
        row.id,
        normalizedCode,
        rescaleMinor(row.amount, fromExp, toExp)
      );
    }

    const txs = await store.listTransactionRows();
    for (const row of txs) {
      await store.updateTransactionRow(
        row.id,
        normalizedCode,
        rescaleMinor(row.amount, fromExp, toExp)
      );
    }

    const templates = await store.listRecurringTemplateRows();
    for (const row of templates) {
      await store.updateRecurringTemplateRow(row.id, {
        ...row.template,
        currency: normalizedCode,
        amount: rescaleMinor(row.template.amount, fromExp, toExp),
      });
    }

    await store.setCurrencySetting(normalizedCode);
  });

  await store.bumpDataRevision();
}
