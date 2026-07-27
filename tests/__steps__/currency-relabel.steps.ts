import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  rescaleMinor,
  canChangeCurrencyFreely,
  relabelCurrencyWithStore,
  RelabelRow,
  RelabelTemplateRow,
  RelabelStore,
} from '../../src/domain/currencyRelabel';
import { RecurrenceTemplate } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/currency-relabel.feature'));

/** A plain in-memory RelabelStore — proves relabelCurrencyWithStore's
 *  algorithm without touching Drizzle/expo-sqlite (the real store,
 *  src/features/settings/repository.ts, isn't Node-testable). */
class FakeRelabelStore implements RelabelStore {
  currency = 'USD';
  accountRows: RelabelRow[] = [];
  transactionRows: RelabelRow[] = [];
  templateRows: RelabelTemplateRow[] = [];
  bumpCount = 0;

  async getCurrency(): Promise<string> {
    return this.currency;
  }
  async listAccountRows(): Promise<RelabelRow[]> {
    return this.accountRows;
  }
  async listTransactionRows(): Promise<RelabelRow[]> {
    return this.transactionRows;
  }
  async listRecurringTemplateRows(): Promise<RelabelTemplateRow[]> {
    return this.templateRows;
  }
  async updateAccountRow(id: string, currency: string, amount: number): Promise<void> {
    const row = this.accountRows.find((r) => r.id === id)!;
    row.currency = currency;
    row.amount = amount;
  }
  async updateTransactionRow(id: string, currency: string, amount: number): Promise<void> {
    const row = this.transactionRows.find((r) => r.id === id)!;
    row.currency = currency;
    row.amount = amount;
  }
  async updateRecurringTemplateRow(id: string, template: RecurrenceTemplate): Promise<void> {
    const row = this.templateRows.find((r) => r.id === id)!;
    row.template = template;
  }
  async setCurrencySetting(code: string): Promise<void> {
    this.currency = code;
  }
  async bumpDataRevision(): Promise<void> {
    this.bumpCount++;
  }
  async runInTransaction(fn: () => Promise<void>): Promise<void> {
    await fn();
  }
}

/**
 * A RelabelStore that actually buffers writes and discards them on a thrown
 * callback — i.e. it behaves like a real DB transaction (all-or-nothing),
 * unlike `FakeRelabelStore.runInTransaction` above (a plain passthrough).
 * `runInTransaction` snapshots every row + the currency setting before
 * running `fn`; if `fn` throws, every field is restored from the snapshot
 * before the error is rethrown — proving relabelCurrencyWithStore's writes
 * are all inside the transaction boundary (MAJOR 2, QA F1 follow-up): a
 * failure partway through a batch of row updates must leave NOTHING
 * relabelled/rescaled, not just stop the loop early.
 *
 * `failOnUpdateCall` (1-indexed, counted across every updateXRow call in
 * call order) lets a scenario force a failure partway through the batch.
 */
class BufferedFakeRelabelStore implements RelabelStore {
  currency = 'USD';
  accountRows: RelabelRow[] = [];
  transactionRows: RelabelRow[] = [];
  templateRows: RelabelTemplateRow[] = [];
  bumpCount = 0;
  failOnUpdateCall: number | null = null;
  private updateCallCount = 0;

  private maybeFail(): void {
    this.updateCallCount++;
    if (this.failOnUpdateCall !== null && this.updateCallCount === this.failOnUpdateCall) {
      throw new Error(`BufferedFakeRelabelStore: simulated failure on update call ${this.updateCallCount}`);
    }
  }

  async getCurrency(): Promise<string> {
    return this.currency;
  }
  async listAccountRows(): Promise<RelabelRow[]> {
    return this.accountRows;
  }
  async listTransactionRows(): Promise<RelabelRow[]> {
    return this.transactionRows;
  }
  async listRecurringTemplateRows(): Promise<RelabelTemplateRow[]> {
    return this.templateRows;
  }
  async updateAccountRow(id: string, currency: string, amount: number): Promise<void> {
    this.maybeFail();
    const row = this.accountRows.find((r) => r.id === id)!;
    row.currency = currency;
    row.amount = amount;
  }
  async updateTransactionRow(id: string, currency: string, amount: number): Promise<void> {
    this.maybeFail();
    const row = this.transactionRows.find((r) => r.id === id)!;
    row.currency = currency;
    row.amount = amount;
  }
  async updateRecurringTemplateRow(id: string, template: RecurrenceTemplate): Promise<void> {
    this.maybeFail();
    const row = this.templateRows.find((r) => r.id === id)!;
    row.template = template;
  }
  async setCurrencySetting(code: string): Promise<void> {
    this.currency = code;
  }
  async bumpDataRevision(): Promise<void> {
    this.bumpCount++;
  }
  /** Snapshot-then-restore-on-throw — the fake's stand-in for a real ROLLBACK. */
  async runInTransaction(fn: () => Promise<void>): Promise<void> {
    const snapshot = {
      currency: this.currency,
      accountRows: this.accountRows.map((r) => ({ ...r })),
      transactionRows: this.transactionRows.map((r) => ({ ...r })),
      templateRows: this.templateRows.map((r) => ({ id: r.id, template: { ...r.template } })),
    };
    try {
      await fn();
    } catch (e) {
      this.currency = snapshot.currency;
      this.accountRows = snapshot.accountRows;
      this.transactionRows = snapshot.transactionRows;
      this.templateRows = snapshot.templateRows;
      throw e;
    }
  }
}

defineFeature(feature, (test) => {
  // ─── rescaleMinor ───────────────────────────────────────────────────────
  test('Same exponent is an identity (no rescale)', ({ then }) => {
    then(
      /^rescaleMinor of (-?\d+) from exponent (\d) to exponent (\d) should be (-?\d+)$/,
      (minor: string, from: string, to: string, expected: string) => {
        expect(rescaleMinor(parseInt(minor, 10), parseInt(from, 10), parseInt(to, 10))).toBe(
          parseInt(expected, 10)
        );
      }
    );
  });

  test('Shrinking the exponent (SGD → JPY) preserves the displayed number', ({ then }) => {
    then(
      /^rescaleMinor of (-?\d+) from exponent (\d) to exponent (\d) should be (-?\d+)$/,
      (minor: string, from: string, to: string, expected: string) => {
        expect(rescaleMinor(parseInt(minor, 10), parseInt(from, 10), parseInt(to, 10))).toBe(
          parseInt(expected, 10)
        );
      }
    );
  });

  test('Shrinking the exponent rounds a fractional remainder', ({ then }) => {
    then(
      /^rescaleMinor of (-?\d+) from exponent (\d) to exponent (\d) should be (-?\d+)$/,
      (minor: string, from: string, to: string, expected: string) => {
        expect(rescaleMinor(parseInt(minor, 10), parseInt(from, 10), parseInt(to, 10))).toBe(
          parseInt(expected, 10)
        );
      }
    );
  });

  test('Growing the exponent (JPY → SGD) preserves the displayed number', ({ then }) => {
    then(
      /^rescaleMinor of (-?\d+) from exponent (\d) to exponent (\d) should be (-?\d+)$/,
      (minor: string, from: string, to: string, expected: string) => {
        expect(rescaleMinor(parseInt(minor, 10), parseInt(from, 10), parseInt(to, 10))).toBe(
          parseInt(expected, 10)
        );
      }
    );
  });

  test('A 2-decimal to 3-decimal grow scales ×10', ({ then }) => {
    then(
      /^rescaleMinor of (-?\d+) from exponent (\d) to exponent (\d) should be (-?\d+)$/,
      (minor: string, from: string, to: string, expected: string) => {
        expect(rescaleMinor(parseInt(minor, 10), parseInt(from, 10), parseInt(to, 10))).toBe(
          parseInt(expected, 10)
        );
      }
    );
  });

  // ─── canChangeCurrencyFreely ────────────────────────────────────────────
  const thenCanChangeFreely = (then: any) =>
    then(
      /^canChangeCurrencyFreely with (\d+) accounts and (\d+) transactions should be (true|false)$/,
      (accts: string, txs: string, expected: string) => {
        expect(
          canChangeCurrencyFreely({
            accountCount: parseInt(accts, 10),
            transactionCount: parseInt(txs, 10),
          })
        ).toBe(expected === 'true');
      }
    );

  test('An empty ledger (no accounts, no transactions) may change freely', ({ then }) => {
    thenCanChangeFreely(then);
  });
  test('Any account blocks the free change', ({ then }) => {
    thenCanChangeFreely(then);
  });
  test('Any transaction blocks the free change', ({ then }) => {
    thenCanChangeFreely(then);
  });
  test('Both accounts and transactions present blocks the free change', ({ then }) => {
    thenCanChangeFreely(then);
  });

  // ─── relabelCurrencyWithStore (fake store) ──────────────────────────────
  let store: FakeRelabelStore;
  let nextId = 0;

  const givenStoreCurrency = (given: any) =>
    given(/^the store's currency is "(.*)"$/, (code: string) => {
      store = new FakeRelabelStore();
      store.currency = code;
      nextId = 0;
    });

  const givenAccount = (and: any) =>
    and(/^an account with opening balance (\d+) in "(.*)"$/, (amount: string, currency: string) => {
      store.accountRows.push({ id: `acc-${++nextId}`, currency, amount: parseInt(amount, 10) });
    });

  const givenTransaction = (and: any) =>
    and(/^a transaction with amount (\d+) in "(.*)"$/, (amount: string, currency: string) => {
      store.transactionRows.push({ id: `tx-${++nextId}`, currency, amount: parseInt(amount, 10) });
    });

  const givenTemplate = (and: any) =>
    and(/^a recurring template with amount (\d+) in "(.*)"$/, (amount: string, currency: string) => {
      store.templateRows.push({
        id: `series-${++nextId}`,
        template: {
          accountId: 'acc-1',
          type: 'expense',
          amount: parseInt(amount, 10),
          currency,
        },
      });
    });

  let thrownError: unknown;

  const whenRelabel = (when: any) =>
    when(/^I relabel the currency to "(.*)"$/, async (code: string) => {
      thrownError = undefined;
      try {
        await relabelCurrencyWithStore(store, code);
      } catch (e) {
        thrownError = e;
      }
    });

  const thenShouldHaveThrown = (then: any) =>
    then(/^relabelling should have thrown$/, () => {
      expect(thrownError).toBeInstanceOf(Error);
    });

  const thenAccountStillIs = (and: any) =>
    and(
      /^the account's currency should still be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.accountRows[0]!.currency).toBe(currency);
        expect(store.accountRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );

  const thenBumpCalled = (then: any) =>
    then(/^bumpDataRevision should have been called (\d+) times?$/, (n: string) => {
      expect(store.bumpCount).toBe(parseInt(n, 10));
    });

  test('A same-exponent relabel preserves stored integers and rewrites codes', ({
    given,
    and,
    when,
    then,
  }) => {
    givenStoreCurrency(given);
    givenAccount(and);
    givenTransaction(and);
    givenTemplate(and);
    whenRelabel(when);
    then(
      /^the account's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.accountRows[0]!.currency).toBe(currency);
        expect(store.accountRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the transaction's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.transactionRows[0]!.currency).toBe(currency);
        expect(store.transactionRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the recurring template's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.templateRows[0]!.template.currency).toBe(currency);
        expect(store.templateRows[0]!.template.amount).toBe(parseInt(amount, 10));
      }
    );
    and(/^the currency setting should be "(.*)"$/, (currency: string) => {
      expect(store.currency).toBe(currency);
    });
  });

  test('A cross-exponent relabel rescales every stored amount', ({ given, and, when, then }) => {
    givenStoreCurrency(given);
    givenAccount(and);
    givenTransaction(and);
    givenTemplate(and);
    whenRelabel(when);
    then(
      /^the account's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.accountRows[0]!.currency).toBe(currency);
        expect(store.accountRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the transaction's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.transactionRows[0]!.currency).toBe(currency);
        expect(store.transactionRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the recurring template's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.templateRows[0]!.template.currency).toBe(currency);
        expect(store.templateRows[0]!.template.amount).toBe(parseInt(amount, 10));
      }
    );
  });

  test('The ledger is single-currency after a relabel', ({ given, and, when, then }) => {
    givenStoreCurrency(given);
    givenAccount(and);
    givenTransaction(and);
    whenRelabel(when);
    then(/^every row's currency should be "(.*)"$/, (code: string) => {
      for (const row of [...store.accountRows, ...store.transactionRows]) {
        expect(row.currency).toBe(code);
      }
    });
  });

  test('bumpDataRevision is called exactly once', ({ given, and, when, then }) => {
    givenStoreCurrency(given);
    givenAccount(and);
    whenRelabel(when);
    then(/^bumpDataRevision should have been called (\d+) time$/, (n: string) => {
      expect(store.bumpCount).toBe(parseInt(n, 10));
    });
  });

  // ─── newCode validation (guardrail #6) ──────────────────────────────────
  test('An unsupported currency code is rejected before touching the store', ({
    given,
    and,
    when,
    then,
  }) => {
    givenStoreCurrency(given);
    givenAccount(and);
    whenRelabel(when);
    thenShouldHaveThrown(then);
    thenAccountStillIs(and);
    thenBumpCalled(and);
  });

  test('An empty currency code is rejected', ({ given, when, then }) => {
    givenStoreCurrency(given);
    whenRelabel(when);
    thenShouldHaveThrown(then);
  });

  test('A lowercase-but-valid currency code is normalized and accepted', ({
    given,
    and,
    when,
    then,
  }) => {
    givenStoreCurrency(given);
    givenAccount(and);
    whenRelabel(when);
    then(
      /^the account's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(store.accountRows[0]!.currency).toBe(currency);
        expect(store.accountRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
  });

  // ─── Atomicity: a mid-transaction failure rolls every write back ────────
  let bufferedStore: BufferedFakeRelabelStore;
  let nextBufferedId = 0;
  let bufferedThrown: unknown;

  const givenBufferedStore = (given: any) =>
    given(/^a buffered store with currency "(.*)"$/, (code: string) => {
      bufferedStore = new BufferedFakeRelabelStore();
      bufferedStore.currency = code;
      nextBufferedId = 0;
      bufferedThrown = undefined;
    });

  const givenBufferedAccount = (and: any) =>
    and(
      /^a buffered account with opening balance (\d+) in "(.*)"$/,
      (amount: string, currency: string) => {
        bufferedStore.accountRows.push({
          id: `acc-${++nextBufferedId}`,
          currency,
          amount: parseInt(amount, 10),
        });
      }
    );

  const givenBufferedTransaction = (and: any) =>
    and(
      /^a buffered transaction with amount (\d+) in "(.*)"$/,
      (amount: string, currency: string) => {
        bufferedStore.transactionRows.push({
          id: `tx-${++nextBufferedId}`,
          currency,
          amount: parseInt(amount, 10),
        });
      }
    );

  const givenBufferedTemplate = (and: any) =>
    and(
      /^a buffered recurring template with amount (\d+) in "(.*)"$/,
      (amount: string, currency: string) => {
        bufferedStore.templateRows.push({
          id: `series-${++nextBufferedId}`,
          template: {
            accountId: 'acc-1',
            type: 'expense',
            amount: parseInt(amount, 10),
            currency,
          },
        });
      }
    );

  const givenBufferedFailsOnCall = (and: any) =>
    and(/^the buffered store fails on row-update call (\d+)$/, (n: string) => {
      bufferedStore.failOnUpdateCall = parseInt(n, 10);
    });

  const whenRelabelBuffered = (when: any) =>
    when(/^I relabel the buffered store's currency to "(.*)"$/, async (code: string) => {
      try {
        await relabelCurrencyWithStore(bufferedStore, code);
      } catch (e) {
        bufferedThrown = e;
      }
    });

  test('A successful relabel changes every row and the setting together', ({
    given,
    and,
    when,
    then,
  }) => {
    givenBufferedStore(given);
    givenBufferedAccount(and);
    givenBufferedTransaction(and);
    givenBufferedTemplate(and);
    whenRelabelBuffered(when);
    then(
      /^the buffered account's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(bufferedStore.accountRows[0]!.currency).toBe(currency);
        expect(bufferedStore.accountRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the buffered transaction's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(bufferedStore.transactionRows[0]!.currency).toBe(currency);
        expect(bufferedStore.transactionRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the buffered recurring template's currency should be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(bufferedStore.templateRows[0]!.template.currency).toBe(currency);
        expect(bufferedStore.templateRows[0]!.template.amount).toBe(parseInt(amount, 10));
      }
    );
    and(/^the buffered store's currency setting should be "(.*)"$/, (code: string) => {
      expect(bufferedStore.currency).toBe(code);
    });
    and(
      /^the buffered store's bumpDataRevision should have been called (\d+) times?$/,
      (n: string) => {
        expect(bufferedStore.bumpCount).toBe(parseInt(n, 10));
      }
    );
  });

  test('A failure partway through the transaction rolls back every write', ({
    given,
    and,
    when,
    then,
  }) => {
    givenBufferedStore(given);
    givenBufferedAccount(and);
    givenBufferedTransaction(and);
    givenBufferedTemplate(and);
    givenBufferedFailsOnCall(and);
    whenRelabelBuffered(when);
    then(/^relabelling the buffered store should have thrown$/, () => {
      expect(bufferedThrown).toBeInstanceOf(Error);
    });
    and(
      /^the buffered account's currency should still be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(bufferedStore.accountRows[0]!.currency).toBe(currency);
        expect(bufferedStore.accountRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the buffered transaction's currency should still be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(bufferedStore.transactionRows[0]!.currency).toBe(currency);
        expect(bufferedStore.transactionRows[0]!.amount).toBe(parseInt(amount, 10));
      }
    );
    and(
      /^the buffered recurring template's currency should still be "(.*)" and amount (\d+)$/,
      (currency: string, amount: string) => {
        expect(bufferedStore.templateRows[0]!.template.currency).toBe(currency);
        expect(bufferedStore.templateRows[0]!.template.amount).toBe(parseInt(amount, 10));
      }
    );
    and(/^the buffered store's currency setting should still be "(.*)"$/, (code: string) => {
      expect(bufferedStore.currency).toBe(code);
    });
    and(
      /^the buffered store's bumpDataRevision should have been called (\d+) times?$/,
      (n: string) => {
        expect(bufferedStore.bumpCount).toBe(parseInt(n, 10));
      }
    );
  });
});
