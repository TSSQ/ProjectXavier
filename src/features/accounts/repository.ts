/**
 * Account data access. All reads/writes go through Drizzle, which emits
 * parameterised statements.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { accounts } from '../../db/schema';
import { Account } from '../../domain/types';

export async function listAccounts(): Promise<Account[]> {
  const rows = await db.select().from(accounts);
  return rows.map(rowToAccount);
}

export async function getAccount(id: string): Promise<Account | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  return rows[0] ? rowToAccount(rows[0]) : null;
}

export async function createAccount(account: Account): Promise<void> {
  await db.insert(accounts).values({
    id: account.id,
    name: account.name,
    tag: account.tag ?? null,
    subtype: account.subtype ?? null,
    icon: account.icon ?? null,
    currency: account.currency,
    openingBalance: account.openingBalance,
    archived: account.archived ?? false,
  });
}

export async function updateAccount(account: Account): Promise<void> {
  await db
    .update(accounts)
    .set({
      name: account.name,
      tag: account.tag ?? null,
      subtype: account.subtype ?? null,
      icon: account.icon ?? null,
      currency: account.currency,
      openingBalance: account.openingBalance,
      archived: account.archived ?? false,
    })
    .where(eq(accounts.id, account.id));
}

function rowToAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag ?? null,
    subtype: row.subtype ?? undefined,
    icon: row.icon ?? null,
    currency: row.currency,
    openingBalance: row.openingBalance,
    archived: row.archived,
  };
}
