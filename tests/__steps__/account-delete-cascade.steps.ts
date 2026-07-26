import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { TABLES } from '../../src/db/migrationPlan';
import { runAccountDeleteCascade, AccountDeleteDriver } from '../../src/domain/accountDeleteCascade';
import { computeAccountDeleteImpact } from '../../src/domain/accountDeleteImpact';
import { Transaction, RecurringSeries } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-delete-cascade.feature'));

interface TxRow {
  id: string;
  account_id: string;
  type: string;
  amount: number;
  currency: string;
  transfer_account_id: string | null;
  occurred_at: number;
  created_at: number;
  source: string;
  pending: number;
}

interface SeriesRow {
  id: string;
  template: string;
}

function readTransactions(db: DatabaseSync): Transaction[] {
  const rows = db.prepare('SELECT * FROM transactions;').all() as unknown as TxRow[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    type: r.type as Transaction['type'],
    amount: r.amount,
    currency: r.currency,
    transferAccountId: r.transfer_account_id,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
    source: r.source as Transaction['source'],
    pending: !!r.pending,
  }));
}

function readSeries(db: DatabaseSync): RecurringSeries[] {
  const rows = db.prepare('SELECT * FROM recurring_series;').all() as unknown as SeriesRow[];
  return rows.map((r) => ({
    id: r.id,
    rule: { freq: 'monthly', interval: 1, anchor: 0, end: { kind: 'never' } },
    template: JSON.parse(r.template),
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: 0,
    archived: false,
  }));
}

defineFeature(feature, (test) => {
  let db: DatabaseSync;
  let ids: Record<string, string>;
  let calls: string[];
  let failAccountDelete: boolean;
  let failBackup: boolean;
  /** Set to insert a NEW recurring series referencing the target account
   *  DURING `forcePreDeleteBackup` — simulating something happening in that
   *  async I/O window (TOCTOU scenario). */
  let insertSeriesDuringBackup: { seriesId: string; accountName: string } | null;
  let thrown: unknown;

  // Live lookup + delete — mirrors production's
  // `deleteRecurringSeriesReferencingAccount` exactly (src/features/
  // accounts/repository.ts): re-reads which series reference the account
  // AT DELETE TIME, never a list computed before the backup.
  function deleteRecurringSeriesReferencingAccountLive(accountId: string): void {
    const rows = db.prepare('SELECT id, template FROM recurring_series;').all() as unknown as SeriesRow[];
    const matchingIds = rows
      .filter((r) => {
        const tpl = JSON.parse(r.template) as { accountId?: string; transferAccountId?: string | null };
        return tpl.accountId === accountId || tpl.transferAccountId === accountId;
      })
      .map((r) => r.id);
    for (const id of matchingIds) {
      db.prepare('DELETE FROM recurring_series WHERE id = ?').run(id);
    }
  }

  function makeDriver(): AccountDeleteDriver {
    return {
      forcePreDeleteBackup: async () => {
        calls.push('backup');
        if (insertSeriesDuringBackup) {
          const { seriesId, accountName } = insertSeriesDuringBackup;
          db.prepare(
            'INSERT INTO recurring_series (id, rule, template, created_at) VALUES (?, ?, ?, 0);'
          ).run(
            seriesId,
            '{}',
            JSON.stringify({ accountId: idOf(accountName), type: 'expense', amount: 1000, currency: 'USD' })
          );
        }
        if (failBackup) throw new Error('injected backup failure');
      },
      transaction: async (fn) => {
        db.exec('BEGIN');
        try {
          await fn();
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
      deleteTransactionsForAccount: async (accountId: string) => {
        calls.push('delete-transactions');
        db.prepare('DELETE FROM transactions WHERE account_id = ? OR transfer_account_id = ?').run(
          accountId,
          accountId
        );
      },
      deleteRecurringSeriesReferencingAccount: async (accountId: string) => {
        calls.push('delete-series');
        deleteRecurringSeriesReferencingAccountLive(accountId);
      },
      deleteAccountRow: async (accountId: string) => {
        calls.push('delete-account');
        if (failAccountDelete) throw new Error('injected failure');
        db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
      },
    };
  }

  function idOf(name: string): string {
    const id = ids[name];
    if (!id) throw new Error(`no account id recorded for "${name}"`);
    return id;
  }

  function insertAccount(name: string): string {
    const id = `acc-${name.toLowerCase().replace(/\s+/g, '-')}`;
    db.prepare(
      'INSERT INTO accounts (id, name, currency, opening_balance, archived) VALUES (?, ?, ?, ?, 0);'
    ).run(id, name, 'USD', 0);
    ids[name] = id;
    return id;
  }

  function insertTx(
    accountName: string,
    type: Transaction['type'],
    amountMajor: number,
    transferAccountName?: string
  ): void {
    const txId = `tx-${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO transactions
        (id, account_id, type, amount, currency, transfer_account_id, occurred_at, created_at, source, pending)
       VALUES (?, ?, ?, ?, 'USD', ?, 0, 0, 'manual', 0);`
    ).run(
      txId,
      idOf(accountName),
      type,
      amountMajor * 100,
      transferAccountName ? idOf(transferAccountName) : null
    );
  }

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    for (const statement of TABLES) db.exec(statement);
    ids = {};
    calls = [];
    failAccountDelete = false;
    failBackup = false;
    insertSeriesDuringBackup = null;
    thrown = undefined;
  });

  test('A successful cascade deletes exactly the right rows, in one transaction, after a forced backup', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^a database with two accounts "(.*)" and "(.*)"$/, (a: string, b: string) => {
      insertAccount(a);
      insertAccount(b);
    });
    and(/^a \$10 expense on "(.*)"$/, (name: string) => {
      insertTx(name, 'expense', 10);
    });
    and(/^a \$500 transfer from "(.*)" to "(.*)"$/, (from: string, to: string) => {
      insertTx(from, 'transfer', 500, to);
    });
    and(/^a \$200 transfer from "(.*)" to "(.*)"$/, (from: string, to: string) => {
      insertTx(from, 'transfer', 200, to);
    });
    and(/^a recurring series referencing "(.*)"$/, (name: string) => {
      db.prepare(
        'INSERT INTO recurring_series (id, rule, template, created_at) VALUES (?, ?, ?, 0);'
      ).run(
        'series-1',
        '{}',
        JSON.stringify({ accountId: idOf(name), type: 'expense', amount: 1000, currency: 'USD' })
      );
    });
    and(/^an unrelated transaction on a third account "(.*)"$/, (name: string) => {
      insertAccount(name);
      insertTx(name, 'expense', 5);
    });
    when(/^I run the delete cascade for "(.*)"$/, async (name: string) => {
      const accountId = idOf(name);
      await runAccountDeleteCascade(makeDriver(), accountId);
    });
    then(/^a pre-delete backup should have been taken before any row was deleted$/, () => {
      expect(calls[0]).toBe('backup');
      expect(calls).toContain('delete-transactions');
      expect(calls).toContain('delete-account');
    });
    and(/^every transaction referencing "(.*)" should be gone$/, (name: string) => {
      const remaining = readTransactions(db).filter(
        (tx) => tx.accountId === idOf(name) || tx.transferAccountId === idOf(name)
      );
      expect(remaining).toHaveLength(0);
    });
    and(/^the recurring series referencing "(.*)" should be gone$/, () => {
      const rows = db.prepare('SELECT * FROM recurring_series;').all();
      expect(rows).toHaveLength(0);
    });
    and(/^the "(.*)" account row should be gone$/, (name: string) => {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?;').get(idOf(name));
      expect(row).toBeUndefined();
    });
    and(/^the unrelated transaction on "(.*)" should still exist$/, (name: string) => {
      const remaining = readTransactions(db).filter((tx) => tx.accountId === idOf(name));
      expect(remaining).toHaveLength(1);
    });
    and(/^"(.*)"'s own balance should no longer include the deleted transfers$/, (name: string) => {
      const remainingTx = readTransactions(db).filter((tx) => tx.accountId === idOf(name));
      // Only the counterparty's OWN transactions remain — none reference the
      // deleted account any more, so its balance recomputes without them.
      expect(remainingTx.some((tx) => tx.transferAccountId != null)).toBe(false);
    });
  });

  test('A failure during the cascade rolls back every delete, but the backup still happened', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^a database with two accounts "(.*)" and "(.*)"$/, (a: string, b: string) => {
      insertAccount(a);
      insertAccount(b);
    });
    and(/^a \$10 expense on "(.*)"$/, (name: string) => {
      insertTx(name, 'expense', 10);
    });
    and(/^a \$500 transfer from "(.*)" to "(.*)"$/, (from: string, to: string) => {
      insertTx(from, 'transfer', 500, to);
    });
    and(/^the account-row delete is set to fail$/, () => {
      failAccountDelete = true;
    });
    when(/^I run the delete cascade for "(.*)" and it fails$/, async (name: string) => {
      const accountId = idOf(name);
      try {
        await runAccountDeleteCascade(makeDriver(), accountId);
      } catch (e) {
        thrown = e;
      }
    });
    then(/^a pre-delete backup should have been taken$/, () => {
      expect(thrown).toBeDefined();
      expect(calls[0]).toBe('backup');
    });
    and(/^every transaction referencing "(.*)" should still exist$/, (name: string) => {
      const remaining = readTransactions(db).filter(
        (tx) => tx.accountId === idOf(name) || tx.transferAccountId === idOf(name)
      );
      expect(remaining).toHaveLength(2);
    });
    and(/^the "(.*)" account row should still exist$/, (name: string) => {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?;').get(idOf(name));
      expect(row).toBeDefined();
    });
  });

  test('A failed backup aborts the whole cascade — zero rows change (QA MINOR follow-up)', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^a database with two accounts "(.*)" and "(.*)"$/, (a: string, b: string) => {
      insertAccount(a);
      insertAccount(b);
    });
    and(/^a \$10 expense on "(.*)"$/, (name: string) => {
      insertTx(name, 'expense', 10);
    });
    and(/^the pre-delete backup is set to fail$/, () => {
      failBackup = true;
    });
    when(/^I run the delete cascade for "(.*)" and it fails$/, async (name: string) => {
      const accountId = idOf(name);
      try {
        await runAccountDeleteCascade(makeDriver(), accountId);
      } catch (e) {
        thrown = e;
      }
    });
    then(/^the cascade should have thrown$/, () => {
      expect(thrown).toBeDefined();
    });
    and(/^no delete of any kind should have been attempted$/, () => {
      expect(calls).toEqual(['backup']);
    });
    and(/^every transaction referencing "(.*)" should still exist$/, (name: string) => {
      const remaining = readTransactions(db).filter((tx) => tx.accountId === idOf(name));
      expect(remaining).toHaveLength(1);
    });
    and(/^the "(.*)" account row should still exist$/, (name: string) => {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?;').get(idOf(name));
      expect(row).toBeDefined();
    });
  });

  test('A recurring series created DURING the backup window is still deleted — no TOCTOU (QA MINOR follow-up)', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^a database with two accounts "(.*)" and "(.*)"$/, (a: string, b: string) => {
      insertAccount(a);
      insertAccount(b);
    });
    and(/^a recurring series named "(.*)" referencing "(.*)" is inserted DURING the pre-delete backup$/, (
      seriesId: string,
      accountName: string
    ) => {
      insertSeriesDuringBackup = { seriesId, accountName };
    });
    when(/^I run the delete cascade for "(.*)"$/, async (name: string) => {
      // Impact is computed BEFORE the cascade runs (mirrors production,
      // src/features/accounts/repository.ts) — it CANNOT see the series
      // that gets inserted later, during the backup step.
      const accountId = idOf(name);
      const impactBefore = computeAccountDeleteImpact(accountId, readTransactions(db), readSeries(db));
      expect(impactBefore.recurringSeriesIds).toHaveLength(0);
      await runAccountDeleteCascade(makeDriver(), accountId);
    });
    then(/^the recurring series named "(.*)" should be gone too$/, (seriesId: string) => {
      const row = db.prepare('SELECT * FROM recurring_series WHERE id = ?;').get(seriesId);
      expect(row).toBeUndefined();
    });
  });
});
