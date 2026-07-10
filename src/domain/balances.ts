/**
 * Account balance and net-worth calculations.
 *
 * Sign convention: every account balance is a signed asset value in minor
 * units. Spending money lowers the balance; this naturally models a credit
 * card (a liability) going more negative as you charge it, so net worth is
 * simply the sum of every account's signed balance.
 */
import { Account, Transaction, isCounted } from './types';

/**
 * Signed change a transaction applies to a given account, in minor units.
 * A pending transaction always contributes 0 — this single check is what
 * excludes pending txns from every balance/net-worth calculation below, since
 * they're all built on this function.
 */
export function signedDelta(tx: Transaction, accountId: string): number {
  if (!isCounted(tx)) return 0;
  switch (tx.type) {
    case 'income':
      return tx.accountId === accountId ? tx.amount : 0;
    case 'expense':
      return tx.accountId === accountId ? -tx.amount : 0;
    case 'transfer':
      if (tx.accountId === accountId) return -tx.amount;
      if (tx.transferAccountId === accountId) return tx.amount;
      return 0;
    default:
      return 0;
  }
}

/** Current balance of a single account given all transactions. */
export function accountBalance(
  account: Account,
  transactions: Transaction[]
): number {
  return transactions.reduce(
    (bal, tx) => bal + signedDelta(tx, account.id),
    account.openingBalance
  );
}

/** Balances for every account, keyed by account id. */
export function accountBalances(
  accounts: Account[],
  transactions: Transaction[]
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const account of accounts) {
    balances.set(account.id, accountBalance(account, transactions));
  }
  return balances;
}

/** Net worth = sum of all non-archived account ending balances. */
export function netWorth(
  accounts: Account[],
  transactions: Transaction[]
): number {
  return accounts
    .filter((a) => !a.archived)
    .reduce((sum, a) => sum + accountBalance(a, transactions), 0);
}

/**
 * Balance of an account including every transaction up to and including `asOf`
 * (epoch ms). Lets the dashboard show a balance "as of" a period boundary.
 */
export function accountBalanceAsOf(
  account: Account,
  transactions: Transaction[],
  asOf: number
): number {
  return transactions.reduce(
    (bal, tx) =>
      tx.occurredAt <= asOf ? bal + signedDelta(tx, account.id) : bal,
    account.openingBalance
  );
}

/** Net worth as of `asOf`: sum of every non-archived account's balance then. */
export function netWorthAsOf(
  accounts: Account[],
  transactions: Transaction[],
  asOf: number
): number {
  return accounts
    .filter((a) => !a.archived)
    .reduce((sum, a) => sum + accountBalanceAsOf(a, transactions, asOf), 0);
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
 * (end exclusive). The start balance rolls forward from the previous period's
 * closing balance; the closing balance adds this period's transactions.
 */
export function accountPeriodBalances(
  accounts: Account[],
  transactions: Transaction[],
  range: { start: number; end: number }
): AccountPeriodBalance[] {
  return accounts
    .filter((a) => !a.archived)
    .map((account) => {
      const start = accountBalanceAsOf(account, transactions, range.start - 1);
      const close = accountBalanceAsOf(account, transactions, range.end - 1);
      return { account, start, close, change: close - start };
    });
}

/** Balance of an account sampled at each timestamp — used for trend charts. */
export function balanceSeries(
  account: Account,
  transactions: Transaction[],
  sampleTimes: number[]
): number[] {
  return sampleTimes.map((t) => accountBalanceAsOf(account, transactions, t));
}
