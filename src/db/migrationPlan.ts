/**
 * DB-agnostic migration plan: the DDL statements, the additive-column list,
 * and the algorithm that runs them in order. No SQLite driver import here
 * (unlike src/db/migrate.ts, which imports expo-sqlite at module-eval time
 * via ./client and so can't be loaded from the plain-Node BDD suite) — this
 * file, and the migration algorithm itself, stay testable there by depending
 * only on the small MigrationDriver interface below. Production wires that
 * interface to expo-sqlite/Drizzle (see migrate.ts); the plain-Node suite
 * wires it to node:sqlite, so the exact same algorithm — same DDL text, same
 * column-existence decision — runs against a real SQLite engine in tests.
 */

export interface ColumnAddition {
  table: string;
  column: string;
  type: string;
}

/**
 * Base tables (CREATE TABLE IF NOT EXISTS). These run first. On an existing
 * database they are no-ops; missing columns on old tables are added afterwards
 * by ADD_COLUMNS.
 */
export const TABLES = [
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     tag TEXT,
     subtype TEXT,
     icon TEXT,
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
     occurrence_date INTEGER,
     pending INTEGER NOT NULL DEFAULT 0
   );`,
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
  // Parse diagnostics (test-build-only writes; empty in production). Created
  // unconditionally so migration stays branch-free. See
  // docs/design/parse-metrics-spec.md.
  `CREATE TABLE IF NOT EXISTS parse_metrics (
     id TEXT PRIMARY KEY NOT NULL,
     created_at INTEGER NOT NULL,
     engine TEXT NOT NULL,
     outcome TEXT NOT NULL,
     confidence_bucket INTEGER,
     input_len_bucket TEXT,
     missing_fields TEXT,
     null_fields TEXT,
     grounding_counts TEXT,
     device_ai_capable INTEGER,
     latency_ms INTEGER,
     resolved TEXT,
     tx_id TEXT,
     payee_swapped INTEGER,
     edited INTEGER,
     edited_amount INTEGER,
     edited_type INTEGER,
     edited_payee INTEGER,
     edited_category INTEGER,
     edited_date INTEGER,
     amount_delta_bucket INTEGER
   );`,
];

/**
 * Indexes — run LAST, after ADD_COLUMNS, because some reference columns that
 * only exist on an upgraded database after their ALTER TABLE (e.g.
 * idx_tx_series depends on transactions.series_id). Creating them before the
 * column is added fails on existing databases.
 */
export const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_series ON transactions(series_id) WHERE series_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_pm_tx ON parse_metrics(tx_id);`,
];

/**
 * Additive column migrations for databases created before a column existed.
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so we check the live schema with
 * PRAGMA table_info and only ALTER when the column is missing — robust across
 * driver error-message formats. New columns must be nullable / have a default
 * so existing rows remain valid.
 */
export const ADD_COLUMNS: ColumnAddition[] = [
  { table: 'accounts', column: 'icon', type: 'TEXT' },
  { table: 'transactions', column: 'source_text', type: 'TEXT' },
  { table: 'transactions', column: 'series_id', type: 'TEXT' },
  { table: 'transactions', column: 'occurrence_date', type: 'INTEGER' },
  { table: 'transactions', column: 'pending', type: 'INTEGER NOT NULL DEFAULT 0' },
];

/**
 * Which of `additions` still need an ALTER TABLE, given a snapshot of each
 * table's current columns (table name → its column names). Pure — no I/O —
 * so it's the cheapest thing to unit-test directly: a column already present
 * is never returned again (idempotency), and the returned entries carry the
 * exact type clause (e.g. `INTEGER NOT NULL DEFAULT 0`) that will be ALTERed
 * in.
 */
export function pendingColumnAdditions(
  existingColumns: Record<string, Set<string>>,
  additions: ColumnAddition[] = ADD_COLUMNS
): ColumnAddition[] {
  return additions.filter(
    ({ table, column }) => !(existingColumns[table]?.has(column))
  );
}

/**
 * The minimal surface `runMigrations` needs from a SQLite driver: run a DDL
 * statement (CREATE TABLE / CREATE INDEX), run an ALTER TABLE, and read a
 * table's current columns (PRAGMA table_info). Production wires this to
 * expo-sqlite/Drizzle (migrate.ts); the plain-Node BDD suite wires it to
 * node:sqlite.
 */
export interface MigrationDriver {
  /** CREATE TABLE / CREATE INDEX — always idempotent (IF NOT EXISTS). */
  execDdl(sql: string): Promise<void>;
  /** ALTER TABLE ADD COLUMN — only ever called when the column is missing. */
  execAlter(sql: string): Promise<void>;
  /** Column names currently on `table`, via PRAGMA table_info. */
  columnNames(table: string): Promise<Set<string>>;
}

/**
 * Runs the full migration sequence — tables, then additive columns, then
 * indexes — against any MigrationDriver. This is the single implementation
 * of the migration algorithm; migrate.ts's `migrate()` and the plain-Node
 * test suite both call it, just with different drivers, so there is no
 * separate "test copy" of this logic to drift out of sync.
 */
export async function runMigrations(driver: MigrationDriver): Promise<void> {
  // 1. Tables (no-ops on an existing DB).
  for (const statement of TABLES) {
    await driver.execDdl(statement);
  }
  // 2. Add columns missing on databases created before they existed — must
  //    happen before any index that references them.
  for (const { table, column, type } of ADD_COLUMNS) {
    const existing = await driver.columnNames(table);
    const pending = pendingColumnAdditions({ [table]: existing }, [{ table, column, type }]);
    if (pending.length > 0) {
      await driver.execAlter(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    }
  }
  // 3. Indexes — now every referenced column is guaranteed to exist.
  for (const statement of INDEXES) {
    await driver.execDdl(statement);
  }
}
