import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runMigrations, MigrationDriver } from '../../src/db/migrationPlan';
import { SELECT_BUDGETS, buildInsertBudget, RawBudgetRow } from '../../src/db/budgetSql';
import * as schema from '../../src/db/schema';
import { BackupData } from '../../src/lib/backup';
import { budgetRow } from '../support/budgetFixture';

// The native database client cannot load in Node. These fakes record what the
// repositories ask of it; `expoDb` is backed by a real node:sqlite database so
// the parameterised budget statements actually run.
jest.mock('../../src/db/client', () => {
  const state: {
    calls: Array<{ op: string; table: unknown; values?: unknown; inTx: boolean }>;
    inTx: boolean;
    sqlite: { prepare: (sql: string) => { run: (...p: unknown[]) => unknown } } | null;
  } = { calls: [], inTx: false, sqlite: null };
  const record = (op: string, table: unknown, values?: unknown) =>
    state.calls.push({ op, table, values, inTx: state.inTx });
  return {
    __state: state,
    schema: {},
    db: {
      delete: (table: unknown) => ({
        where: async () => {
          record('delete', table);
        },
        then: (resolve: (v?: unknown) => void) => {
          record('delete', table);
          resolve();
        },
      }),
      insert: (table: unknown) => ({
        values: async (v: unknown) => {
          record('insert', table, v);
        },
      }),
    },
    expoDb: {
      withTransactionAsync: async (fn: () => Promise<void>) => {
        state.inTx = true;
        try {
          await fn();
        } finally {
          state.inTx = false;
        }
      },
      runAsync: async (sql: string, params: unknown[]) => {
        record('sql', sql, params);
        state.sqlite!.prepare(sql).run(...params);
      },
    },
  };
});
jest.mock('../../src/features/settings/repository', () => ({
  bumpDataRevision: async () => undefined,
  getAllSettings: async () => ({}),
  getSetting: async () => null,
  setSetting: async () => undefined,
  applySettings: async () => undefined,
  getDataRevision: async () => 0,
}));
jest.mock('../../src/lib/id', () => ({ newId: () => 'id-1' }));
jest.mock('../../src/features/backup/icloud', () => ({}));
jest.mock('../../src/features/backup/sqliteFile', () => ({}));
jest.mock('../../src/features/recurring/repository', () => ({
  postDueOccurrences: async () => undefined,
}));
jest.mock('../../src/features/widget/summary', () => ({
  updateWidgetSummary: async () => undefined,
  scheduleWidgetSummaryUpdate: () => undefined,
}));

import * as client from '../../src/db/client';
import { deleteCategory } from '../../src/features/categories/repository';
import { applyBackup } from '../../src/features/backup/repository';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-persistence.feature'));
const state = (client as unknown as { __state: { calls: any[]; inTx: boolean; sqlite: DatabaseSync | null } })
  .__state;

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

defineFeature(feature, (test) => {
  beforeEach(() => {
    state.calls.length = 0;
    state.inTx = false;
  });

  test('Deleting a category deletes its budget rows inside the transaction', ({ given, when, then, and }) => {
    given('a database with budgets for Dining and Groceries', async () => {
      const db = new DatabaseSync(':memory:');
      await runMigrations(driverFor(db));
      for (const r of [
        budgetRow('dining', 500, '2026-09', null, 1),
        budgetRow('dining', 900, '2026-12', '2026-12', 2),
        budgetRow('groceries', 400, '2026-09', null, 3),
      ]) {
        const s = buildInsertBudget(r);
        db.prepare(s.sql).run(...s.params);
      }
      state.sqlite = db;
    });
    when('I delete the Dining category through the repository', async () => {
      await deleteCategory('dining');
    });
    then('the category row should be deleted inside a transaction', () => {
      const del = state.calls.find((c) => c.op === 'delete' && c.table === schema.categories);
      expect(del?.inTx).toBe(true);
      const budgetSql = state.calls.find((c) => c.op === 'sql' && /DELETE FROM budgets/.test(c.table));
      expect(budgetSql?.inTx).toBe(true);
      expect(budgetSql?.values).toEqual(['dining']);
    });
    and('only Groceries should still have budget rows', () => {
      const raw = state.sqlite!.prepare(SELECT_BUDGETS.sql).all() as unknown as RawBudgetRow[];
      expect(raw.map((r) => r.category_id)).toEqual(['groceries']);
    });
  });

  test('Restore writes every budget column', ({ given, when, then, and }) => {
    let data: BackupData;
    const budgets = [budgetRow('dining', 600, '2026-10', '2026-10', 7), budgetRow('groceries', 400, '2026-01', null, 8)];
    given('a backup holding a one-off and an open-ended budget', () => {
      data = { accounts: [], categories: [], payees: [], transactions: [], recurringSeries: [], budgets };
    });
    when('I apply the backup', async () => {
      await applyBackup(data);
    });
    then('each budget should be inserted with every column', () => {
      const inserts = state.calls.filter((c) => c.op === 'insert' && c.table === schema.budgets);
      expect(inserts.map((c) => c.values)).toEqual(
        budgets.map((b) => ({
          id: b.id,
          categoryId: b.categoryId,
          amount: b.amount,
          startMonth: b.startMonth,
          endMonth: b.endMonth,
          createdAt: b.createdAt,
        }))
      );
      expect(inserts.every((c) => c.inTx)).toBe(true);
    });
    and('the budgets should be cleared before they are inserted', () => {
      const ops = state.calls.map((c) => `${c.op}:${c.table === schema.budgets ? 'budgets' : ''}`);
      expect(ops.indexOf('delete:budgets')).toBeGreaterThan(-1);
      expect(ops.indexOf('delete:budgets')).toBeLessThan(ops.indexOf('insert:budgets'));
    });
  });

  test('Restore refuses a malformed budget row at the write boundary', ({ given, when, then }) => {
    let data: BackupData;
    let error: unknown = null;
    given('a backup holding a budget with an amount of 0', () => {
      data = {
        accounts: [],
        categories: [],
        payees: [],
        transactions: [],
        recurringSeries: [],
        budgets: [{ ...budgetRow('dining', 600, '2026-10'), amount: 0 }],
      };
    });
    when('I apply the backup expecting a failure', async () => {
      try {
        await applyBackup(data);
      } catch (e) {
        error = e;
      }
    });
    then('the restore should have been rejected', () => {
      expect(error).not.toBeNull();
    });
  });
});
