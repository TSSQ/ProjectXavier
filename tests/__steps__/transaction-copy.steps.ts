import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction } from '../../src/domain/types';
import { buildCopyInitial, copyLabelFor, CopyInitial, CopyNames } from '../../src/domain/transactionCopy';
import { makeTransaction, money, dateToEpoch } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/transaction-copy.feature')
);

defineFeature(feature, (test) => {
  let tx: Transaction;
  let screenAccountId: string;
  let names: CopyNames;
  let result: CopyInitial;
  let label: string;

  beforeEach(() => {
    names = { payeeName: '', categoryName: '' };
  });

  test("A copy is dated now, not the original's date", ({ given, when, then }) => {
    given(/^a transaction that occurred on "(.*)"$/, (date) => {
      tx = makeTransaction({
        type: 'expense',
        amount: money('10.00'),
        accountId: 'acc-1',
        occurredAt: dateToEpoch(date),
      });
    });
    when(/^I build the copy initial values as of "(.*)"$/, (date) => {
      result = buildCopyInitial(tx, { ...names, now: dateToEpoch(date) });
    });
    then(/^the copy's date should be "(.*)"$/, (date) => {
      expect(result.date).toBe(dateToEpoch(date));
    });
  });

  test("The copy's account comes from the transaction, not the current screen", ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^a transaction in account "(.*)"$/, (accountId) => {
      tx = makeTransaction({ type: 'expense', amount: money('10.00'), accountId });
    });
    and(/^the current screen is account "(.*)"$/, (accountId) => {
      screenAccountId = accountId;
    });
    when(/^I build the copy initial values$/, () => {
      result = buildCopyInitial(tx, { ...names, now: Date.UTC(2026, 0, 1) });
    });
    then(/^the copy's account should be "(.*)"$/, (accountId) => {
      expect(result.accountId).toBe(accountId);
      expect(result.accountId).not.toBe(screenAccountId);
    });
  });

  test('Copying a recurring occurrence produces a standalone entry', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^a transaction that is occurrence "(.*)" of series "(.*)"$/, (date, seriesId) => {
      tx = {
        ...makeTransaction({ type: 'expense', amount: money('10.00'), accountId: 'acc-1' }),
        seriesId,
        occurrenceDate: dateToEpoch(date),
      };
    });
    when(/^I build the copy initial values$/, () => {
      result = buildCopyInitial(tx, { ...names, now: Date.UTC(2026, 0, 1) });
    });
    then(/^the copy's repeat rule should be cleared$/, () => {
      expect(result.repeatRule).toBeNull();
    });
    and(/^the copy's series id should be cleared$/, () => {
      expect(result.seriesId).toBeNull();
    });
    and(/^the copy's occurrence date should be cleared$/, () => {
      expect(result.occurrenceDate).toBeNull();
    });
  });

  test('Copying a pending transaction starts it counted', ({ given, when, then }) => {
    given(/^a pending transaction$/, () => {
      tx = makeTransaction({
        type: 'expense',
        amount: money('10.00'),
        accountId: 'acc-1',
        pending: true,
      });
    });
    when(/^I build the copy initial values$/, () => {
      result = buildCopyInitial(tx, { ...names, now: Date.UTC(2026, 0, 1) });
    });
    then(/^the copy should not be pending$/, () => {
      expect(result.pending).toBe(false);
    });
  });

  test('Amount, type, note, and transfer destination are preserved', ({
    given,
    when,
    then,
    and,
  }) => {
    given(
      /^a transfer transaction of (.*) with note "(.*)" to account "(.*)"$/,
      (amt, note, transferAccountId) => {
        tx = makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: 'acc-1',
          transferAccountId,
          note,
        });
      }
    );
    when(/^I build the copy initial values$/, () => {
      result = buildCopyInitial(tx, { ...names, now: Date.UTC(2026, 0, 1) });
    });
    then(/^the copy's amount should be (.*)$/, (amt) => {
      expect(result.amountMinor).toBe(money(amt));
    });
    and(/^the copy's type should be "(.*)"$/, (type) => {
      expect(result.type).toBe(type);
    });
    and(/^the copy's note should be "(.*)"$/, (note) => {
      expect(result.note).toBe(note);
    });
    and(/^the copy's transfer account should be "(.*)"$/, (transferAccountId) => {
      expect(result.transferAccountId).toBe(transferAccountId);
    });
  });

  test('The copy label falls back from payee to category to type', ({
    given,
    when,
    then,
  }) => {
    given(
      /^a transaction of type "(.*)" with payee "(.*)" and category "(.*)"$/,
      (type, payeeName, categoryName) => {
        tx = makeTransaction({
          type: type as Transaction['type'],
          amount: money('1.00'),
          accountId: 'acc-1',
        });
        names = { payeeName, categoryName };
      }
    );
    when(/^I compute the copy label$/, () => {
      label = copyLabelFor(tx, names);
    });
    then(/^the copy label should be "(.*)"$/, (expected) => {
      expect(label).toBe(expected);
    });
  });
});
