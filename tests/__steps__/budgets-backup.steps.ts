import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runMigrations, MigrationDriver } from '../../src/db/migrationPlan';
import { SELECT_BUDGETS, buildInsertBudget } from '../../src/db/budgetSql';
import { OPTIONAL_SQL_TABLES, SQL_TABLES, missingTables } from '../../src/domain/sqliteBackupTables';
import { RawBackupRows, RawRow, buildBackupDataFromRows } from '../../src/domain/sqliteBackupRows';
import { BackupData, parseBackup, serializeBackup } from '../../src/lib/backup';
import { BudgetRow } from '../../src/domain/budgets';
import { FIXTURE_BUDGETS, budgetRow } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-backup.feature'));

function driverFor(db: DatabaseSync): MigrationDriver {
  return {
    execDdl: async (sql) => {
      db.exec(sql);
    },
    execAlter: async (sql) => {
      db.exec(sql);
    },
    columnNames: async (table) => {
      const rows = db.prepare(`PRAGMA table_info(${table});`).all() as unknown as { name: string }[];
      return new Set(rows.map((r) => r.name));
    },
  };
}

/** Reads an image the way sqliteFile.ts's readBackupDataFromAttached does:
 *  required tables must all be present, optional ones are read when present. */
function readImage(file: string): BackupData {
  const image = new DatabaseSync(file);
  try {
    const present = (
      image.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as {
        name: string;
      }[]
    ).map((r) => r.name);
    const missing = missingTables(present);
    if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
    const raw = {} as RawBackupRows;
    for (const t of SQL_TABLES) raw[t] = image.prepare(`SELECT * FROM ${t}`).all() as RawRow[];
    for (const t of OPTIONAL_SQL_TABLES) {
      if (present.includes(t)) raw[t] = image.prepare(`SELECT * FROM ${t}`).all() as RawRow[];
    }
    return buildBackupDataFromRows(raw);
  } finally {
    image.close();
  }
}

defineFeature(feature, (test) => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budgets-backup-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const migrated = async (): Promise<DatabaseSync> => {
    const db = new DatabaseSync(':memory:');
    await runMigrations(driverFor(db));
    return db;
  };
  const insert = (db: DatabaseSync, row: BudgetRow) => {
    const s = buildInsertBudget(row);
    db.prepare(s.sql).run(...s.params);
  };

  test('Budgets round-trip through a backup image', ({ given, when, then }) => {
    let live: DatabaseSync;
    let original: BudgetRow[] = [];
    let restored: BudgetRow[] = [];
    given('a database holding the mockup budgets and a one-off', async () => {
      live = await migrated();
      original = [...FIXTURE_BUDGETS, budgetRow('dining', 800, '2026-12', '2026-12', 2)];
      original.forEach((r) => insert(live, r));
    });
    when('I back it up as a SQLite image and restore it into a fresh database', async () => {
      const file = path.join(dir, 'backup.sqlite');
      live.exec(`VACUUM INTO '${file}'`);
      const data = readImage(file);
      const fresh = await migrated();
      for (const r of data.budgets ?? []) insert(fresh, r);
      restored = (fresh.prepare(SELECT_BUDGETS.sql).all() as unknown as Array<Record<string, unknown>>).map(
        (r) => ({
          id: r.id as string,
          categoryId: r.category_id as string,
          amount: r.amount as number | null,
          startMonth: r.start_month as string,
          endMonth: r.end_month as string | null,
          createdAt: r.created_at as number,
        })
      );
    });
    then('the restored budgets should equal the originals', () => {
      const key = (r: BudgetRow) => `${r.categoryId}|${r.startMonth}|${r.createdAt}`;
      expect([...restored].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
        [...original].sort((a, b) => key(a).localeCompare(key(b)))
      );
    });
  });

  test('An image from before budgets existed restores with none', ({ given, when, then }) => {
    let file: string;
    let data: BackupData;
    given('a backup image with no budgets table', async () => {
      const db = await migrated();
      db.exec('DROP TABLE budgets');
      file = path.join(dir, 'old.sqlite');
      db.exec(`VACUUM INTO '${file}'`);
    });
    when('I read it back', () => {
      data = readImage(file);
    });
    then('it should be accepted with no budgets', () => {
      expect(data.budgets).toEqual([]);
    });
  });

  test('A corrupt budget row rejects the whole restore', ({ given, when, then }) => {
    let file: string;
    let error: Error | null = null;
    given(/^a backup image whose budget amount is "(.*)"$/, async (bad: string) => {
      const db = await migrated();
      db.prepare(
        'INSERT INTO budgets (id, category_id, amount, start_month, end_month, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('b1', 'dining', bad, '2026-10', null, 1);
      file = path.join(dir, 'bad.sqlite');
      db.exec(`VACUUM INTO '${file}'`);
    });
    when('I read it back', () => {
      try {
        readImage(file);
      } catch (e) {
        error = e as Error;
      }
    });
    then('it should be rejected naming the budgets table', () => {
      expect(error?.message).toContain('budgets');
    });
  });

  test('A legacy JSON backup restores without budgets', ({ given, when, then }) => {
    let json = '';
    let parsed: BackupData | null = null;
    given('a legacy JSON backup', () => {
      json = serializeBackup({
        accounts: [],
        categories: [],
        payees: [],
        transactions: [],
        recurringSeries: [],
      });
    });
    when('I parse it', () => {
      parsed = parseBackup(json).data;
    });
    then('it should parse and carry no budgets', () => {
      expect(parsed).not.toBeNull();
      expect(parsed!.budgets ?? []).toEqual([]);
    });
  });

  test('A legacy JSON backup with a malformed budgets array restores with no budgets', ({ given, when, then }) => {
    let json = '';
    let parsed: BackupData | null = null;
    given('a legacy JSON backup carrying a malformed budgets array', () => {
      const envelope = JSON.parse(
        serializeBackup({ accounts: [], categories: [], payees: [], transactions: [], recurringSeries: [] })
      );
      envelope.data.budgets = [{ id: 1, categoryId: null, amount: 'NOT_A_NUMBER' }, 'junk'];
      json = JSON.stringify(envelope);
    });
    when('I parse it', () => {
      expect(() => (parsed = parseBackup(json).data)).not.toThrow();
    });
    then('it should parse and carry no budgets', () => {
      expect(parsed).not.toBeNull();
      expect('budgets' in parsed!).toBe(false);
    });
  });
});
