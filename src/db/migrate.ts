/**
 * Schema bootstrap for the on-device SQLite database.
 *
 * DDL is static (no user input), so it is safe to execute directly. All data
 * DML goes through Drizzle / parameterised statements (see src/db/sql.ts).
 *
 * The actual DDL/ADD_COLUMNS list and the migration algorithm live in
 * ./migrationPlan (framework-free, so it's testable in the plain-Node BDD
 * suite against node:sqlite) — this file is just the expo-sqlite/Drizzle
 * adapter (MigrationDriver) for that algorithm.
 */
import { db, expoDb } from './client';
import { runMigrations, MigrationDriver } from './migrationPlan';

/** Names of the columns currently on `table` (via PRAGMA table_info). */
async function columnNames(table: string): Promise<Set<string>> {
  const rows = await expoDb.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`
  );
  return new Set(rows.map((r) => r.name));
}

const driver: MigrationDriver = {
  execDdl: async (sql) => {
    await db.run(sql as never);
  },
  execAlter: async (sql) => {
    await expoDb.runAsync(sql);
  },
  columnNames,
};

export async function migrate(): Promise<void> {
  await runMigrations(driver);
}
