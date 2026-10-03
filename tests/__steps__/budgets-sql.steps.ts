import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runMigrations, MigrationDriver } from '../../src/db/migrationPlan';
import {
  RawBudgetRow,
  SELECT_BUDGETS,
  buildDeleteBudgetsFrom,
  buildDeleteBudgetsForCategory,
  buildInsertBudget,
  rawToBudgetRow,
} from '../../src/db/budgetSql';
import type { ParameterisedStatement } from '../../src/db/sql';
import { budgetFor, planBudgetWrite } from '../../src/domain/budgets';
import { budgetRow } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-sql.feature'));

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

const run = (db: DatabaseSync, stmt: ParameterisedStatement) =>
  db.prepare(stmt.sql).run(...stmt.params);

defineFeature(feature, (test) => {
  test('Budget statements bind every value', ({ given, when, then, and }) => {
    const evil = "dining'; DROP TABLE budgets;--";
    const month = "2026-10' OR '1'='1";
    let statements: ParameterisedStatement[] = [];
    given('a category id and month that look like SQL', () => undefined);
    when('I build the budget statements', () => {
      statements = [
        buildInsertBudget({ ...budgetRow('x', 5, '2026-10'), categoryId: evil, startMonth: month }),
        buildDeleteBudgetsFrom(evil, month),
        buildDeleteBudgetsForCategory(evil),
        SELECT_BUDGETS,
      ];
    });
    then('no statement should contain the value text', () => {
      for (const s of statements) {
        expect(s.sql).not.toContain('DROP TABLE');
        expect(s.sql).not.toContain("OR '1'");
      }
    });
    and('every statement should use bound parameters', () => {
      for (const s of statements) {
        expect((s.sql.match(/\?/g) ?? []).length).toBe(s.params.length);
      }
    });
  });

  test('The budgets repository builds SQL only through the parameterised builders', ({ when, then }) => {
    let source = '';
    when('I read the budgets repository source', () => {
      source = fs.readFileSync(
        path.resolve(__dirname, '../../src/features/budgets/repository.ts'),
        'utf8'
      );
    });
    then('it should contain no template-literal or concatenated SQL', () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/);
      expect(code).not.toMatch(/(?:runAsync|getAllAsync|execAsync)\(\s*`/);
      expect(code).not.toMatch(/(?:runAsync|getAllAsync|execAsync)\([^)]*\+/);
    });
  });

  test('The migration creates budgets and is safe to run twice', ({ given, when, then, and }) => {
    let db: DatabaseSync;
    let thrown: unknown;
    given('an empty database', () => {
      db = new DatabaseSync(':memory:');
    });
    when('I run the migrations twice', async () => {
      try {
        await runMigrations(driverFor(db));
        await runMigrations(driverFor(db));
      } catch (e) {
        thrown = e;
      }
    });
    then('the budgets table should exist with its index', () => {
      const cols = db.prepare('PRAGMA table_info(budgets);').all() as unknown as { name: string }[];
      expect(cols.map((c) => c.name)).toEqual([
        'id',
        'category_id',
        'amount',
        'start_month',
        'end_month',
        'created_at',
      ]);
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_budgets_category'")
        .all();
      expect(idx).toHaveLength(1);
    });
    and('the migrations should not have thrown', () => {
      expect(thrown).toBeUndefined();
    });
  });

  test('An onward write replaces later rows in a real database', ({ given, when, then }) => {
    let db: DatabaseSync;
    given(
      /^a database with an onward Dining budget from "(.*)" and a one-off for "(.*)"$/,
      async (from: string, oneOff: string) => {
        db = new DatabaseSync(':memory:');
        await runMigrations(driverFor(db));
        run(db, buildInsertBudget(budgetRow('dining', 500, from, null, 1)));
        run(db, buildInsertBudget(budgetRow('dining', 900, oneOff, oneOff, 2)));
      }
    );
    when(
      /^I apply an onward write of (\d+) from "(.*)" through the SQL builders$/,
      (major: string, month: string) => {
        const plan = planBudgetWrite({
          id: 'w-1',
          categoryId: 'dining',
          amount: Number(major) * 100,
          month,
          scope: 'onward',
          now: 3,
        });
        run(db, buildDeleteBudgetsFrom('dining', plan.deleteFromMonth!));
        run(db, buildInsertBudget(plan.insert));
      }
    );
    then(/^the stored budgets for Dining should resolve to (\d+) in December$/, (major: string) => {
      const raw = db.prepare(SELECT_BUDGETS.sql).all() as unknown as RawBudgetRow[];
      const rows = raw.map(rawToBudgetRow);
      expect(budgetFor(rows, 'dining', '2026-12')).toBe(Number(major) * 100);
      expect(rows.filter((r) => r.categoryId === 'dining')).toHaveLength(2);
    });
  });

  test("Deleting a category removes its budget rows and no one else's", ({ given, when, then }) => {
    let db: DatabaseSync;
    given('a database with budgets for Dining and Groceries', async () => {
      db = new DatabaseSync(':memory:');
      await runMigrations(driverFor(db));
      run(db, buildInsertBudget(budgetRow('dining', 500, '2026-09', null, 1)));
      run(db, buildInsertBudget(budgetRow('dining', 900, '2026-12', '2026-12', 2)));
      run(db, buildInsertBudget(budgetRow('groceries', 400, '2026-09', null, 3)));
    });
    when("I delete the Dining category's budgets through the SQL builders", () => {
      run(db, buildDeleteBudgetsForCategory('dining'));
    });
    then('only Groceries should still have budget rows', () => {
      const raw = db.prepare(SELECT_BUDGETS.sql).all() as unknown as RawBudgetRow[];
      expect(raw.map((r) => r.category_id)).toEqual(['groceries']);
    });
  });
});
