import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { buildBackupDataFromRows, RawBackupRows, RawRow } from '../../src/domain/sqliteBackupRows';
import { BackupData } from '../../src/lib/backup';

const feature = loadFeature(path.resolve(__dirname, '../__features__/backup-sqlite-rows.feature'));

/** An otherwise-empty set of raw rows for all 6 tables — each scenario below
 *  overrides just the one table it's exercising. */
function emptyRawRows(): RawBackupRows {
  return {
    accounts: [],
    categories: [],
    payees: [],
    settings: [],
    transactions: [],
    recurring_series: [],
  };
}

defineFeature(feature, (test) => {
  test('A cross-schema restore fills in defaults for columns an older backup lacks', ({
    given,
    when,
    then,
    and,
  }) => {
    let rawRows: RawBackupRows;
    let data: BackupData;

    given(
      /^a raw transactions row missing the pending, series_id, occurrence_date, receipt_ref, and source_text columns$/,
      () => {
        rawRows = emptyRawRows();
        // Exactly what `SELECT * FROM src.transactions` would return on a
        // pre-migration backup: the columns simply aren't present at all —
        // not present-and-null, absent.
        rawRows.transactions = [
          {
            id: 'tx-1',
            account_id: 'acc-1',
            type: 'expense',
            amount: 1500,
            currency: 'USD',
            category_id: null,
            payee_id: null,
            transfer_account_id: null,
            note: null,
            occurred_at: 1_700_000_000_000,
            created_at: 1_700_000_000_000,
            source: 'manual',
          } as RawRow,
        ];
      },
    );

    when(/^I build BackupData from the attached rows$/, () => {
      data = buildBackupDataFromRows(rawRows);
    });

    then(/^it should succeed$/, () => {
      expect(data.transactions).toHaveLength(1);
    });

    and(/^the resulting transaction should have pending false and no seriesId$/, () => {
      const tx = data.transactions[0]!;
      expect(tx.pending).toBe(false);
      expect(tx.seriesId).toBeUndefined();
    });
  });

  test('A row with a non-numeric amount and an invalid type is rejected', ({ given, when, then }) => {
    let rawRows: RawBackupRows;
    let thrown: unknown;

    given(
      /^a raw transactions row with amount "(.*)", type "(.*)", and a dangling account_id$/,
      (amount: string, type: string) => {
        rawRows = emptyRawRows();
        rawRows.transactions = [
          {
            id: 'tx-evil',
            account_id: 'no-such-account',
            type,
            amount,
            currency: 'USD',
            occurred_at: 1_700_000_000_000,
            created_at: 1_700_000_000_000,
            source: 'manual',
          } as unknown as RawRow,
        ];
      },
    );

    when(/^I build BackupData from the attached rows$/, () => {
      try {
        buildBackupDataFromRows(rawRows);
      } catch (e) {
        thrown = e;
      }
    });

    then(/^it should throw an error mentioning "(.*)"$/, (expectedSubstring: string) => {
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(expectedSubstring);
    });
  });

  test("Boolean columns are coerced from SQLite's 0/1 to real booleans", ({ given, when, then }) => {
    let rawRows: RawBackupRows;
    let data: BackupData;

    given(/^a raw accounts row with archived stored as the integer 1$/, () => {
      rawRows = emptyRawRows();
      rawRows.accounts = [
        {
          id: 'acc-1',
          name: 'Checking',
          tag: null,
          subtype: null,
          icon: null,
          currency: 'USD',
          opening_balance: 100000,
          archived: 1,
        },
      ];
    });

    when(/^I build BackupData from the attached rows$/, () => {
      data = buildBackupDataFromRows(rawRows);
    });

    then(/^the resulting account's archived flag should be the boolean true$/, () => {
      expect(data.accounts[0]!.archived).toBe(true);
      expect(typeof data.accounts[0]!.archived).toBe('boolean');
    });
  });

  test('Recurring-series JSON text columns round-trip through validation', ({ given, when, then }) => {
    let rawRows: RawBackupRows;
    let data: BackupData;

    given(/^a raw recurring_series row with rule, template, and skipped_dates stored as JSON text$/, () => {
      rawRows = emptyRawRows();
      rawRows.recurring_series = [
        {
          id: 'series-1',
          rule: JSON.stringify({
            freq: 'monthly',
            interval: 1,
            byDay: 1,
            anchor: 1_700_000_000_000,
            end: { kind: 'never' },
          }),
          template: JSON.stringify({
            accountId: 'acc-1',
            type: 'expense',
            amount: 500,
            currency: 'USD',
          }),
          last_posted_at: null,
          posted_count: 0,
          paused: 0,
          skipped_dates: JSON.stringify([1_700_000_000_000]),
          created_at: 1_700_000_000_000,
          archived: 0,
        },
      ];
    });

    when(/^I build BackupData from the attached rows$/, () => {
      data = buildBackupDataFromRows(rawRows);
    });

    then(/^the resulting series should have a parsed rule, template, and skippedDates array$/, () => {
      const series = data.recurringSeries[0]!;
      expect(series.rule.freq).toBe('monthly');
      expect(series.template.accountId).toBe('acc-1');
      expect(series.skippedDates).toEqual([1_700_000_000_000]);
      expect(series.paused).toBe(false);
      expect(series.archived).toBe(false);
    });
  });

  test('Settings rows are collected into a key/value map', ({ given, when, then }) => {
    let rawRows: RawBackupRows;
    let data: BackupData;

    given(/^raw settings rows for "(.*)" and "(.*)"$/, (k1: string, k2: string) => {
      rawRows = emptyRawRows();
      rawRows.settings = [
        { key: k1, value: 'USD' },
        { key: k2, value: 'dark' },
      ];
    });

    when(/^I build BackupData from the attached rows$/, () => {
      data = buildBackupDataFromRows(rawRows);
    });

    then(/^the resulting settings map should contain both keys$/, () => {
      expect(data.settings).toEqual({ currency: 'USD', theme: 'dark' });
    });
  });

  test('A pre-existing self-transfer row is imported, not rejected (review F2)', ({
    given,
    and,
    when,
    then,
  }) => {
    let rawRows: RawBackupRows;
    let data: BackupData;

    given(/^a raw transactions row that is a healthy expense$/, () => {
      rawRows = emptyRawRows();
      rawRows.transactions.push({
        id: 'tx-healthy',
        account_id: 'acc-1',
        type: 'expense',
        amount: 1200,
        currency: 'USD',
        category_id: null,
        payee_id: null,
        transfer_account_id: null,
        note: null,
        occurred_at: 1_700_000_000_000,
        created_at: 1_700_000_000_000,
        source: 'manual',
      } as RawRow);
    });

    and(
      /^a raw transactions row that is a self-transfer with the same account on both sides$/,
      () => {
        rawRows.transactions.push({
          id: 'tx-self-transfer',
          account_id: 'acc-1',
          type: 'transfer',
          amount: 5000,
          currency: 'USD',
          category_id: null,
          payee_id: null,
          // Review F2's bug — same account on both sides. The write-strict
          // `transactionSchema` would reject this, but restoring an already-
          // persisted row must succeed (`transactionReadSchema`).
          transfer_account_id: 'acc-1',
          note: null,
          occurred_at: 1_700_000_000_000,
          created_at: 1_700_000_000_000,
          source: 'manual',
        } as RawRow);
      },
    );

    when(/^I build BackupData from the attached rows$/, () => {
      data = buildBackupDataFromRows(rawRows);
    });

    then(/^it should succeed$/, () => {
      expect(data.transactions).toHaveLength(2);
    });

    and(/^both transactions should be present in the result$/, () => {
      const ids = data.transactions.map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining(['tx-healthy', 'tx-self-transfer']));
    });
  });
});
