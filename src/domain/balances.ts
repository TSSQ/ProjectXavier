/**
 * Account balance and net-worth calculations.
 *
 * Sign convention: every account balance is a signed asset value in minor
 * units. Spending money lowers the balance; this naturally models a credit
 * card (a liability) going more negative as you charge it, so net worth is
 * simply the sum of every account's signed balance.
 */
import { Account, Transaction } from './types';

/** Signed change a transaction applies to a given account, in minor units. */
export function signedDelta(tx: Transaction, accountId: string): number {
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
