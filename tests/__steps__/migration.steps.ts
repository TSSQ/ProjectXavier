import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runMigrations, MigrationDriver, TABLES } from '../../src/db/migrationPlan';

const feature = loadFeature(path.resolve(__dirname, '../__features__/migration.feature'));

/**
 * The transactions schema as it looked immediately before this feature added
 * `pending` — every other ADD_COLUMNS-era column (source_text, series_id,
 * occurrence_date) is already present, only `pending` is missing. Used to
 * simulate "upgrade an existing install" against a real SQLite engine.
 */
const PRE_PENDING_TRANSACTIONS_DDL = `
  CREATE TABLE IF NOT EXISTS transactions (
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
   );
`;

interface TableInfoRow {
  name: string;
  notnull: number;
  dflt_value: string | null;
}

function makeDriver(db: DatabaseSync): MigrationDriver {
  return {
    execDdl: async (sql: string) => {
      db.exec(sql);
    },
    execAlter: async (sql: string) => {
      db.exec(sql);
    },
    columnNames: async (table: string) => {
      const rows = db.prepare(`PRAGMA table_info(${table});`).all() as unknown as TableInfoRow[];
      return new Set(rows.map((r) => r.name));
    },
  };
}

function tableInfo(db: DatabaseSync, table: string): TableInfoRow[] {
  return db.prepare(`PRAGMA table_info(${table});`).all() as unknown as TableInfoRow[];
}

defineFeature(feature, (test) => {
  let db: DatabaseSync;
  let driver: MigrationDriver;
  let thrown: unknown;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    thrown = undefined;
  });

  const givenEmptyDatabase = () => {
    driver = makeDriver(db);
  };

  const givenPrePendingSchema = () => {
    // Every table except transactions is created from the current (real)
    // DDL — only transactions is rolled back to its pre-pending shape.
    for (const statement of TABLES) {
      if (!statement.includes('CREATE TABLE IF NOT EXISTS transactions')) {
        db.exec(statement);
      }
    }
    db.exec(PRE_PENDING_TRANSACTIONS_DDL);
    driver = makeDriver(db);
  };

  const givenExistingRow = () => {
    db.exec(`
      INSERT INTO transactions
        (id, account_id, type, amount, currency, occurred_at, created_at, source)
      VALUES
        ('tx-1', 'acc-1', 'expense', 1000, 'USD', 0, 0, 'manual');
    `);
  };

  const runMigration = async () => {
    await runMigrations(driver);
  };

  test('A fresh database gets a working pending column via CREATE TABLE', ({
    given,
    when,
    then,
    and,
  }) => {
    given('a brand-new, empty database', givenEmptyDatabase);
    when('I run the migration', runMigration);
    then(/^the transactions table should have a "pending" column$/, () => {
      const cols = tableInfo(db, 'transactions');
      expect(cols.some((c) => c.name === 'pending')).toBe(true);
    });
    and(/^the "pending" column should be NOT NULL with default 0$/, () => {
      const col = tableInfo(db, 'transactions').find((c) => c.name === 'pending')!;
      expect(col.notnull).toBe(1);
      expect(col.dflt_value).toBe('0');
    });
  });

  test('An existing pre-pending database gets the column via ALTER TABLE', ({
    given,
    and,
    when,
    then,
  }) => {
    given('a database with the pre-pending transactions schema', givenPrePendingSchema);
    and('a transaction row already saved in that database', givenExistingRow);
    when('I run the migration', runMigration);
    then(/^the transactions table should have a "pending" column$/, () => {
      const cols = tableInfo(db, 'transactions');
      expect(cols.some((c) => c.name === 'pending')).toBe(true);
    });
    and(/^the "pending" column should be NOT NULL with default 0$/, () => {
      const col = tableInfo(db, 'transactions').find((c) => c.name === 'pending')!;
      expect(col.notnull).toBe(1);
      expect(col.dflt_value).toBe('0');
    });
    and(/^the existing transaction row should default "pending" to 0$/, () => {
      const row = db.prepare('SELECT pending FROM transactions WHERE id = ?').get('tx-1') as {
        pending: number;
      };
      expect(row.pending).toBe(0);
    });
  });

  test('Running the migration twice does not fail or duplicate the column', ({
    given,
    when,
    then,
    and,
  }) => {
    given('a database with the pre-pending transactions schema', givenPrePendingSchema);
    when('I run the migration', runMigration);
    and('I run the migration again', async () => {
      try {
        await runMigrations(driver);
      } catch (e) {
        thrown = e;
      }
    });
    then(/^the migration should not have thrown$/, () => {
      expect(thrown).toBeUndefined();
    });
    and(/^the transactions table should have exactly one "pending" column$/, () => {
      const cols = tableInfo(db, 'transactions').filter((c) => c.name === 'pending');
      expect(cols.length).toBe(1);
    });
  });
});
