/**
 * Account balance and net-worth calculations.
 *
 * Sign convention: every account balance is a signed asset value in minor
 * units. Spending money lowers the balance; this naturally models a credit
 * card (a liability) going more negative as you charge it, so net worth is
 * simply the sum of every account's signed balance.
 */
import { Account, RecurringSeries, Transaction, isCounted } from './types';

/**
 * Signed change a transaction applies to a given account, in minor units.
 * A pending OR future-dated (`occurredAt > now`) transaction always
 * contributes 0 — this single check is what excludes both from every
 * balance/net-worth calculation below, since they're all built on this
 * function. `now` is the clock the caller is computing "as of" — the actual
 * device clock for a live balance (`accountBalance`), or the `asOf` bound
 * itself for a point-in-time balance (`accountBalanceAsOf`) so that function's
 * behaviour stays exactly as it always was (see its own comment).
 */
export function signedDelta(tx: Transaction, accountId: string, now: number): number {
  if (!isCounted(tx, now)) return 0;
  return signedAmountFor(tx, accountId);
}

/**
 * Which way, and by how much, a transaction moves money FOR a given account —
 * direction only, with no view on whether it counts yet.
 *
 * This is what a ledger row should display. The account screen used to render
 * `signedDelta` directly, which returns 0 for anything not counted, so a
 * future-dated transaction showed as $0.00 while still showing its payee,
 * category and date — the row looked like a bug rather than like something
 * scheduled.
 *
 * Whether a row contributes to the balance is a separate question, and one
 * the screen already answers visibly through the Upcoming/Pending chip and
 * the dimmed styling. Conflating the two is what made the amount disappear.
 */
export function signedAmountFor(tx: Transaction, accountId: string): number {
  switch (tx.type) {
    case 'income':
      return tx.accountId === accountId ? tx.amount : 0;
    case 'expense':
      return tx.accountId === accountId ? -tx.amount : 0;
    case 'transfer':
      // A self-transfer (same account on both sides) is economically
      // neutral — booking it as pure outflow would be simply wrong
      // arithmetic. Defence in depth: the schema/form guards should prevent
      // these from ever being saved, but this keeps any that slip through
      // (or already exist) from distorting balances/net worth.
      if (tx.accountId === tx.transferAccountId) return 0;
      if (tx.accountId === accountId) return -tx.amount;
      if (tx.transferAccountId === accountId) return tx.amount;
      return 0;
    default:
      return 0;
  }
}

/** Current balance of a single account given all transactions. `now` is the
 *  device clock, injected by the caller (never read via `Date.now()` here). */
export function accountBalance(
  account: Account,
  transactions: Transaction[],
  now: number
): number {
  return transactions.reduce(
    (bal, tx) => bal + signedDelta(tx, account.id, now),
    account.openingBalance
  );
}

/** Balances for every account, keyed by account id. */
export function accountBalances(
  accounts: Account[],
  transactions: Transaction[],
  now: number
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const account of accounts) {
    balances.set(account.id, accountBalance(account, transactions, now));
  }
  return balances;
}

/**
 * Net worth = sum of all non-archived account ending balances. One-line
 * delegation to `netWorthOfAsOf` (spec docs/design/account-archive-restore-
 * spec.md §5.4), which does the actual summing over exactly the accounts
 * it's given. Safe because `accountBalance(a, txs, X)` and
 * `accountBalanceAsOf(a, txs, X)` always agree for the same `X` — both zero
 * out exactly the pending and occurredAt > X rows (see `accountBalanceAsOf`'s
 * own comment) — so routing the live `now` clock through as
 * `netWorthOfAsOf`'s `asOf` changes nothing about the result.
 */
export function netWorth(
  accounts: Account[],
  transactions: Transaction[],
  now: number
): number {
  return netWorthOfAsOf(accounts.filter((a) => !a.archived), transactions, now);
}

/**
 * Balance of an account including every transaction up to and including `asOf`
 * (epoch ms). Lets the dashboard show a balance "as of" a period boundary.
 *
 * Deliberately has NO separate `now` parameter — `asOf` doubles as the clock
 * passed into `signedDelta`/`isCounted`. Since the reduce below already only
 * visits rows with `tx.occurredAt <= asOf`, `isCounted(tx, asOf)`'s own date
 * check is always satisfied for those rows too, so this is exactly the same
 * (pending-only) exclusion this function always applied — future-dating adds
 * NO new exclusion here. That's intentional: "as of date X" already means
 * "everything up to and including X", future-dated or not, and this function
 * must not change behaviour for any existing caller (docs/design/
 * future-dated-transactions-spec.md §5 acceptance criterion 4).
 */
export function accountBalanceAsOf(
  account: Account,
  transactions: Transaction[],
  asOf: number
): number {
  return transactions.reduce(
    (bal, tx) =>
      tx.occurredAt <= asOf ? bal + signedDelta(tx, account.id, asOf) : bal,
    account.openingBalance
  );
}

/**
 * Net worth summed over EXACTLY the accounts given — no internal archived
 * filter (spec §5.4). `netWorth` and `netWorthAsOf` are one-line delegations
 * that pre-filter `!a.archived` and call this; a caller that wants archived
 * accounts included too (the dashboard's "Include archived" toggle) calls
 * this directly with its own already-scoped account list instead.
 */
export function netWorthOfAsOf(
  accounts: Account[],
  transactions: Transaction[],
  asOf: number,
  now?: number
): number {
  return accounts.reduce(
    (sum, a) => sum + accountBalanceAsOf(a, transactions, settledBy(asOf, now)),
    0
  );
}

/**
 * The clock a displayed balance should actually count with.
 *
 * `accountBalanceAsOf` uses its `asOf` bound as the clock, so asking for
 * "the balance as of the end of August" while it is still 23 August counts
 * transactions dated 25 August that have not happened. The dashboard did
 * exactly that: a future-dated charge was excluded from the ledger, shown in
 * Upcoming, and simultaneously already spent in the account balance.
 *
 * Clamping to `now` makes the balance mean "what has actually happened".
 * A PAST period is unaffected (its bound is already before now); only the
 * current or a future period changes, which is exactly where the projection
 * was leaking in. Money that has not moved yet belongs to the Upcoming
 * section and the forecast card, which is where it now appears.
 */
export function settledBy(asOf: number, now?: number): number {
  return now == null ? asOf : Math.min(asOf, now);
}

/** Net worth as of `asOf`: sum of every non-archived account's balance then.
 *  One-line delegation to `netWorthOfAsOf` — see that function's comment. */
export function netWorthAsOf(
  accounts: Account[],
  transactions: Transaction[],
  asOf: number
): number {
  return netWorthOfAsOf(accounts.filter((a) => !a.archived), transactions, asOf);
}

export interface AccountPeriodBalance {
  account: Account;
  /** Closing balance of the previous period (= the opening for this period). */
  start: number;
  /** Closing balance at the end of this period. */
  close: number;
  /** close - start: the net movement during the period. */
  change: number;
}

/**
 * Per-account start/close/change over a period `[range.start, range.end)`
 * (end exclusive), for EXACTLY the accounts given — no internal archived
 * filter (spec §5.4). The start balance rolls forward from the previous
 * period's closing balance; the closing balance adds this period's
 * transactions. `accountPeriodBalances` below is a one-line delegation that
 * pre-filters `!a.archived` and calls this.
 */
export function periodBalancesOf(
  accounts: Account[],
  transactions: Transaction[],
  range: { start: number; end: number },
  now?: number
): AccountPeriodBalance[] {
  return accounts.map((account) => {
    const start = accountBalanceAsOf(account, transactions, settledBy(range.start - 1, now));
    const close = accountBalanceAsOf(account, transactions, settledBy(range.end - 1, now));
    return { account, start, close, change: close - start };
  });
}

/**
 * Per-account start/close/change over a period, for non-archived accounts.
 * One-line delegation to `periodBalancesOf` — see that function's comment.
 */
export function accountPeriodBalances(
  accounts: Account[],
  transactions: Transaction[],
  range: { start: number; end: number }
): AccountPeriodBalance[] {
  return periodBalancesOf(accounts.filter((a) => !a.archived), transactions, range);
}

/**
 * One-time data-integrity scan (review F2): every posted transaction whose
 * transfer pins the same account on both sides — a forged self-transfer
 * that `signedDelta` already neutralises above, but which still needs
 * surfacing so the user can repair/delete the row. There should only ever be
 * a handful of these (the bug needs the specific copy-a-transfer flow that
 * predates this fix), so a plain filter is enough — no index needed.
 */
export function findSelfTransfers(transactions: Transaction[]): Transaction[] {
  return transactions.filter(
    (tx) =>
      tx.type === 'transfer' &&
      !!tx.transferAccountId &&
      tx.transferAccountId === tx.accountId
  );
}

/**
 * Same scan for active recurring-series templates: an unrepaired self-
 * transfer template would mint a new bad row every posting cycle, so it's
 * checked in the same startup pass as `findSelfTransfers`.
 */
export function findSelfTransferSeries(series: RecurringSeries[]): RecurringSeries[] {
  return series.filter(
    (s) =>
      s.template.type === 'transfer' &&
      !!s.template.transferAccountId &&
      s.template.transferAccountId === s.template.accountId
  );
}

/** Balance of an account sampled at each timestamp — used for trend charts. */
export function balanceSeries(
  account: Account,
  transactions: Transaction[],
  sampleTimes: number[]
): number[] {
  return sampleTimes.map((t) => accountBalanceAsOf(account, transactions, t));
}
