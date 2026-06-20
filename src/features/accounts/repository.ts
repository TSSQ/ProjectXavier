/**
 * Account data access. All reads/writes go through Drizzle, which emits
 * parameterised statements.
 */
import { db } from '../../db/client';
import { accounts } from '../../db/schema';
import { Account } from '../../domain/types';

export async function listAccounts(): Promise<Account[]> {
  const rows = await db.select().from(accounts);
  return rows.map(rowToAccount);
}

export async function createAccount(account: Account): Promise<void> {
  await db.insert(accounts).values({
    id: account.id,
    name: account.name,
    type: account.type,
    subtype: account.subtype ?? null,
    currency: account.currency,
    openingBalance: account.openingBalance,
    archived: account.archived ?? false,
  });
}

function rowToAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account['type'],
    subtype: row.subtype ?? undefined,
    currency: row.currency,
    openingBalance: row.openingBalance,
    archived: row.archived,
  };
}
