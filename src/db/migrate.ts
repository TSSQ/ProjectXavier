/**
 * Schema bootstrap for the on-device SQLite database.
 *
 * DDL is static (no user input), so it is safe to execute directly. All data
 * DML goes through Drizzle / parameterised statements (see src/db/sql.ts).
 */
import { db } from './client';

const DDL = [
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     type TEXT NOT NULL,
     subtype TEXT,
     currency TEXT NOT NULL,
     opening_balance INTEGER NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0
   );`,
  `CREATE TABLE IF NOT EXISTS categories (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     parent_id TEXT,
     icon TEXT
   );`,
  `CREATE TABLE IF NOT EXISTS payees (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS transactions (
     id TEXT PRIMARY KEY NOT NULL,
     account_id TEXT NOT NULL,
     type TEXT NOT NULL,
     amount INTEGER NOT NULL,
     currency TEXT NOT NULL,
     category_id TEXT,
     payee_id TEXT,
     transfer_account_id TEXT,
     note TEXT,
     occurred_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     source TEXT NOT NULL,
     receipt_ref TEXT
   );`,
  `CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);`,
];

export async function migrate(): Promise<void> {
  for (const statement of DDL) {
    await db.run(statement as never);
  }
}
