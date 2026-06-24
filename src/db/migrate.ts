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
     tag TEXT,
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
     name TEXT NOT NULL,
     default_category_id TEXT
   );`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
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
     receipt_ref TEXT,
     source_text TEXT
   );`,
  `CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);`,
];

/**
 * Additive column migrations for databases created before a column existed.
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so we add unconditionally and treat
 * a "duplicate column" error as already-applied (idempotent). New columns must
 * be nullable / have a default so existing rows remain valid.
 */
const ADD_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'transactions', column: 'source_text', ddl: 'ALTER TABLE transactions ADD COLUMN source_text TEXT;' },
];

export async function migrate(): Promise<void> {
  for (const statement of DDL) {
    await db.run(statement as never);
  }
  for (const { ddl } of ADD_COLUMNS) {
    try {
      await db.run(ddl as never);
    } catch (e) {
      // Column already present on an older DB — safe to ignore. Re-throw
      // anything that isn't the expected "duplicate column name" error.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name/i.test(msg)) throw e;
    }
  }
}
