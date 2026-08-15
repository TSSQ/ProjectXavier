import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction, Payee } from '../../src/domain/types';
import {
  buildCandidateFilter,
  selectCandidates,
  rankCandidates,
  pickerSizeFor,
  fingerprintTransaction,
  fingerprintsMatch,
  TransactionCandidateFilter,
  CandidateFilterContext,
  PickerSize,
} from '../../src/domain/transactionCandidates';

const feature = loadFeature(path.resolve(__dirname, '../__features__/transaction-candidates.feature'));

const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime();
const DAY = 86_400_000;

function makePayee(id: string, name: string): Payee {
  return { id, name };
}

function baseTx(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    accountId: 'acc-default',
    type: 'expense',
    amount: 1000,
    currency: 'USD',
    categoryId: null,
    payeeId: null,
    transferAccountId: null,
    note: null,
    occurredAt: NOW,
    createdAt: NOW,
    source: 'manual',
    receiptRef: null,
    sourceText: null,
    seriesId: null,
    occurrenceDate: null,
    pending: false,
    ...overrides,
  };
}

const EMPTY_FILTER: TransactionCandidateFilter = {
  onDate: null,
  range: null,
  latest: false,
  payeeId: null,
  accountId: null,
  amountMinor: null,
};

function threeRowLedger(): Transaction[] {
  return [
    baseTx({ id: 't1', accountId: 'acc-a', amount: 1000, occurredAt: NOW - 2 * DAY }),
    baseTx({ id: 't2', accountId: 'acc-b', amount: 2000, occurredAt: NOW - 1 * DAY }),
    baseTx({ id: 't3', accountId: 'acc-c', amount: 3000, occurredAt: NOW }),
  ];
}

function fiftyRowLedger(): Transaction[] {
  const rows: Transaction[] = [];
  for (let i = 0; i < 50; i++) {
    rows.push(
      baseTx({
        id: `t${String(i).padStart(3, '0')}`,
        accountId: i % 2 === 0 ? 'acc-a' : 'acc-b',
        amount: 1000 + i,
        occurredAt: NOW - i * 3_600_000,
      })
    );
  }
  return rows;
}

defineFeature(feature, (test) => {
  test('The filter extracts a currency-anchored amount, an exact payee, and a single-day date', ({
    given,
    when,
    then,
    and,
  }) => {
    let payees: Payee[] = [];
    let filter: TransactionCandidateFilter;

    given(/^the known payees "(.*)" and "(.*)"$/, (a: string, b: string) => {
      payees = [makePayee('p1', a), makePayee('p2', b)];
    });
    when(/^I build a candidate filter from "(.*)"$/, (text: string) => {
      const ctx: CandidateFilterContext = { payees, accounts: [], now: NOW, currency: 'USD' };
      filter = buildCandidateFilter(text, ctx);
    });
    then(/^the filter amount should be (\d+) minor units$/, (minor: string) => {
      expect(filter.amountMinor).toBe(Number(minor));
    });
    and(/^the filter payee should resolve to "(.*)"$/, (name: string) => {
      const expected = payees.find((p) => p.name === name);
      expect(filter.payeeId).toBe(expected?.id);
    });
    and(/^the filter should have a single-day date$/, () => {
      expect(filter.onDate).not.toBeNull();
      expect(filter.range).toBeNull();
    });
  });

  test('A fuzzy/typo payee name is NOT treated as an exact filter match', ({ given, when, then }) => {
    let payees: Payee[] = [];
    let filter: TransactionCandidateFilter;

    given(/^the known payees "(.*)"$/, (a: string) => {
      payees = [makePayee('p1', a)];
    });
    when(/^I build a candidate filter from "(.*)"$/, (text: string) => {
      const ctx: CandidateFilterContext = { payees, accounts: [], now: NOW, currency: 'USD' };
      filter = buildCandidateFilter(text, ctx);
    });
    then(/^the filter payee should be unresolved$/, () => {
      expect(filter.payeeId).toBeNull();
    });
  });

  test('A bare (non-anchored) number is NOT treated as a stated amount', ({ when, then }) => {
    let filter: TransactionCandidateFilter;
    when(/^I build a candidate filter from "(.*)"$/, (text: string) => {
      const ctx: CandidateFilterContext = { payees: [], accounts: [], now: NOW, currency: 'USD' };
      filter = buildCandidateFilter(text, ctx);
    });
    then(/^the filter amount should be unresolved$/, () => {
      expect(filter.amountMinor).toBeNull();
    });
  });

  test('"latest" is recognised as a recency signal, distinct from a date', ({ when, then }) => {
    let filter: TransactionCandidateFilter;
    when(/^I build a candidate filter from "(.*)"$/, (text: string) => {
      const ctx: CandidateFilterContext = { payees: [], accounts: [], now: NOW, currency: 'USD' };
      filter = buildCandidateFilter(text, ctx);
    });
    then(/^the filter should be marked latest$/, () => {
      expect(filter.latest).toBe(true);
      expect(filter.onDate).toBeNull();
      expect(filter.range).toBeNull();
    });
  });

  test('The pre-filter is deterministic — identical input, identical output across 100 iterations', ({
    given,
    when,
    then,
  }) => {
    let payees: Payee[] = [];
    let filters: TransactionCandidateFilter[] = [];

    given(/^the known payees "(.*)"$/, (a: string) => {
      payees = [makePayee('p1', a)];
    });
    when(/^I build the same candidate filter (\d+) times from "(.*)"$/, (n: string, text: string) => {
      const ctx: CandidateFilterContext = { payees, accounts: [], now: NOW, currency: 'USD' };
      filters = Array.from({ length: Number(n) }, () => buildCandidateFilter(text, ctx));
    });
    then(/^every one of the 100 filters should be identical$/, () => {
      for (const f of filters) expect(f).toEqual(filters[0]);
    });
  });

  test('The cascade never empties the list — it drops the most specific constraint first and retries', ({
    given,
    when,
    then,
    and,
  }) => {
    let ledger: Transaction[] = [];
    let result: ReturnType<typeof selectCandidates>;

    given(/^a 3-row ledger with distinct accounts, dates and amounts$/, () => {
      ledger = threeRowLedger();
    });
    when(/^I select candidates with an amount that matches none of them and no other constraint$/, () => {
      result = selectCandidates(ledger, { ...EMPTY_FILTER, amountMinor: 9_999_999 });
    });
    then(/^the candidate count should be (\d+)$/, (n: string) => {
      expect(result.candidates.length).toBe(Number(n));
    });
    and(/^the dropped constraints should be "(.*)"$/, (list: string) => {
      expect(result.droppedConstraints).toEqual(list.split(', '));
    });
  });

  test('The cascade drops multiple constraints in order (amount, then payee) when needed', ({
    given,
    when,
    then,
    and,
  }) => {
    let ledger: Transaction[] = [];
    let result: ReturnType<typeof selectCandidates>;

    given(/^a 3-row ledger with distinct accounts, dates and amounts$/, () => {
      ledger = threeRowLedger();
    });
    when(/^I select candidates with an amount and a payee that together match none of them$/, () => {
      result = selectCandidates(ledger, {
        ...EMPTY_FILTER,
        amountMinor: 9_999_999,
        payeeId: 'payee-that-does-not-exist',
      });
    });
    then(/^the candidate count should be (\d+)$/, (n: string) => {
      expect(result.candidates.length).toBe(Number(n));
    });
    and(/^the dropped constraints should be "(.*)"$/, (list: string) => {
      expect(result.droppedConstraints).toEqual(list.split(', '));
    });
  });

  test('"latest" truncates an otherwise-larger ranked list to exactly one row', ({
    given,
    when,
    then,
  }) => {
    let ledger: Transaction[] = [];
    let result: ReturnType<typeof selectCandidates>;

    given(/^a 3-row ledger with distinct accounts, dates and amounts$/, () => {
      ledger = threeRowLedger();
    });
    when(/^I select candidates with no constraint at all and latest set$/, () => {
      result = selectCandidates(ledger, { ...EMPTY_FILTER, latest: true });
    });
    then(/^the candidate count should be (\d+)$/, (n: string) => {
      expect(result.candidates.length).toBe(Number(n));
    });
  });

  test('Ranking is total and stable — byte-identical order on repeat calls over a 50-row fixture', ({
    given,
    when,
    then,
  }) => {
    let ledger: Transaction[] = [];
    let first: string[] = [];
    let second: string[] = [];

    given(/^a 50-row ledger$/, () => {
      ledger = fiftyRowLedger();
    });
    when(/^I rank the candidates twice with the same filter$/, () => {
      first = rankCandidates(ledger, EMPTY_FILTER).map((t) => t.id);
      second = rankCandidates(ledger, EMPTY_FILTER).map((t) => t.id);
    });
    then(/^both rankings should be byte-identical in order$/, () => {
      expect(second).toEqual(first);
      expect(first.length).toBe(50);
    });
  });

  test('Picker sizing follows the 0/1/2-5/>5 rule', ({ then }) => {
    then(/^the picker size for (\d+) candidates should be "(.*)"$/, (count: string, size: string) => {
      expect(pickerSizeFor(Number(count))).toBe(size as PickerSize);
    });
  });

  test('An unchanged row passes the stale-row fingerprint guard', ({ given, when, then }) => {
    let tx: Transaction;
    let renderedFingerprint: ReturnType<typeof fingerprintTransaction>;
    let reReadFingerprint: ReturnType<typeof fingerprintTransaction>;

    given(/^a transaction fingerprinted at picker-render time$/, () => {
      tx = baseTx({ id: 't1', amount: 5000 });
      renderedFingerprint = fingerprintTransaction(tx);
    });
    when(/^the same transaction is re-read unchanged$/, () => {
      reReadFingerprint = fingerprintTransaction({ ...tx });
    });
    then(/^the fingerprints should match$/, () => {
      expect(fingerprintsMatch(renderedFingerprint, reReadFingerprint)).toBe(true);
    });
  });

  test('A row whose amount changed before the tap fails the fingerprint guard', ({
    given,
    when,
    then,
  }) => {
    let tx: Transaction;
    let renderedFingerprint: ReturnType<typeof fingerprintTransaction>;
    let reReadFingerprint: ReturnType<typeof fingerprintTransaction>;

    given(/^a transaction fingerprinted at picker-render time$/, () => {
      tx = baseTx({ id: 't1', amount: 5000 });
      renderedFingerprint = fingerprintTransaction(tx);
    });
    when(/^the transaction is re-read with a different amount$/, () => {
      reReadFingerprint = fingerprintTransaction({ ...tx, amount: 6000 });
    });
    then(/^the fingerprints should not match$/, () => {
      expect(fingerprintsMatch(renderedFingerprint, reReadFingerprint)).toBe(false);
    });
  });
});
