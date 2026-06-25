/**
 * Schema bootstrap for the on-device SQLite database.
 *
 * DDL is static (no user input), so it is safe to execute directly. All data
 * DML goes through Drizzle / parameterised statements (see src/db/sql.ts).
 */
import { db, expoDb } from './client';

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
     source_text TEXT,
     series_id TEXT,
     occurrence_date INTEGER
   );`,
  `CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_series ON transactions(series_id) WHERE series_id IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS recurring_series (
     id TEXT PRIMARY KEY NOT NULL,
     rule TEXT NOT NULL,
     template TEXT NOT NULL,
     last_posted_at INTEGER,
     posted_count INTEGER NOT NULL DEFAULT 0,
     paused INTEGER NOT NULL DEFAULT 0,
     skipped_dates TEXT NOT NULL DEFAULT '[]',
     created_at INTEGER NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0
   );`,
];

/**
 * Additive column migrations for databases created before a column existed.
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so we check the live schema with
 * PRAGMA table_info and only ALTER when the column is missing — robust across
 * driver error-message formats. New columns must be nullable / have a default
 * so existing rows remain valid.
 */
const ADD_COLUMNS: Array<{ table: string; column: string; type: string }> = [
  { table: 'transactions', column: 'source_text', type: 'TEXT' },
  { table: 'transactions', column: 'series_id', type: 'TEXT' },
  { table: 'transactions', column: 'occurrence_date', type: 'INTEGER' },
];

/** Names of the columns currently on `table` (via PRAGMA table_info). */
async function columnNames(table: string): Promise<Set<string>> {
  const rows = await expoDb.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`
  );
  return new Set(rows.map((r) => r.name));
}

export async function migrate(): Promise<void> {
  for (const statement of DDL) {
    await db.run(statement as never);
  }
  for (const { table, column, type } of ADD_COLUMNS) {
    const existing = await columnNames(table);
    if (!existing.has(column)) {
      await expoDb.runAsync(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${type};`
      );
    }
  }
}
