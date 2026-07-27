import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { RecurringSeries, Transaction } from '../../src/domain/types';
import {
  transactionSchema,
  transactionReadSchema,
  recurrenceTemplateSchema,
  recurrenceTemplateReadSchema,
} from '../../src/lib/validation';
import {
  signedDelta,
  findSelfTransfers,
  findSelfTransferSeries,
} from '../../src/domain/balances';
import { makeTransaction, money, nextId } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/self-transfer-guard.feature')
);

/** Minimal active series for `findSelfTransferSeries` — only `template`
 *  matters to that predicate, but the rest of the shape must still be valid. */
function makeSeries(
  partial: Partial<RecurringSeries> & Pick<RecurringSeries, 'template'>
): RecurringSeries {
  return {
    id: nextId('series'),
    rule: { freq: 'monthly', interval: 1, anchor: Date.UTC(2026, 0, 1), end: { kind: 'never' } },
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: Date.UTC(2026, 0, 1),
    archived: false,
    ...partial,
  };
}

defineFeature(feature, (test) => {
  let accountIds: Record<string, string> = {};
  const accountId = (name: string): string =>
    (accountIds[name] ??= nextId('acc'));

  beforeEach(() => {
    accountIds = {};
  });

  test('The schema rejects a transaction transfer with the same account on both sides', ({
    given,
    then,
  }) => {
    let raw: unknown;
    given(
      /^a transaction transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        raw = makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: accountId(from),
          transferAccountId: accountId(to),
        });
      }
    );
    then(/^the transaction schema should reject it with "(.*)"$/, (message) => {
      const parsed = transactionSchema.safeParse(raw);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.message === message)).toBe(true);
      }
    });
  });

  test('The schema still accepts a normal transaction transfer between two accounts', ({
    given,
    then,
  }) => {
    let raw: unknown;
    given(
      /^a transaction transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        raw = makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: accountId(from),
          transferAccountId: accountId(to),
        });
      }
    );
    then(/^the transaction schema should accept it$/, () => {
      expect(transactionSchema.safeParse(raw).success).toBe(true);
    });
  });

  test('The schema still accepts an ordinary expense', ({ given, then }) => {
    let raw: unknown;
    given(/^a transaction expense from "(.*)" for (.*)$/, (from, amt) => {
      raw = makeTransaction({
        type: 'expense',
        amount: money(amt),
        accountId: accountId(from),
      });
    });
    then(/^the transaction schema should accept it$/, () => {
      expect(transactionSchema.safeParse(raw).success).toBe(true);
    });
  });

  test('The schema still accepts ordinary income', ({ given, then }) => {
    let raw: unknown;
    given(/^a transaction income into "(.*)" for (.*)$/, (into, amt) => {
      raw = makeTransaction({
        type: 'income',
        amount: money(amt),
        accountId: accountId(into),
      });
    });
    then(/^the transaction schema should accept it$/, () => {
      expect(transactionSchema.safeParse(raw).success).toBe(true);
    });
  });

  test('The recurring-template schema rejects a self-transfer template', ({
    given,
    then,
  }) => {
    let raw: unknown;
    given(
      /^a recurring template transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        raw = {
          accountId: accountId(from),
          type: 'transfer',
          amount: money(amt),
          currency: 'USD',
          transferAccountId: accountId(to),
        };
      }
    );
    then(
      /^the recurring template schema should reject it with "(.*)"$/,
      (message) => {
        const parsed = recurrenceTemplateSchema.safeParse(raw);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues.some((i) => i.message === message)).toBe(
            true
          );
        }
      }
    );
  });

  test('The recurring-template schema still accepts a normal transfer template', ({
    given,
    then,
  }) => {
    let raw: unknown;
    given(
      /^a recurring template transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        raw = {
          accountId: accountId(from),
          type: 'transfer',
          amount: money(amt),
          currency: 'USD',
          transferAccountId: accountId(to),
        };
      }
    );
    then(/^the recurring template schema should accept it$/, () => {
      expect(recurrenceTemplateSchema.safeParse(raw).success).toBe(true);
    });
  });

  test("A self-transfer contributes nothing to its own account's balance", ({
    given,
    then,
  }) => {
    let subjectTx: Transaction;
    given(/^a self-transfer of (.*) within "(.*)"$/, (amt, name) => {
      subjectTx = makeTransaction({
        type: 'transfer',
        amount: money(amt),
        accountId: accountId(name),
        transferAccountId: accountId(name),
      });
    });
    then(
      /^the signed delta of that row for "(.*)" should be (.*)$/,
      (name, expected) => {
        expect(signedDelta(subjectTx, accountId(name))).toBe(Number(expected));
      }
    );
  });

  test('findSelfTransfers finds the bad row among good ones', ({
    given,
    and,
    then,
  }) => {
    const transactions: Transaction[] = [];
    let badTx: Transaction;

    given(
      /^a normal transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        transactions.push(
          makeTransaction({
            type: 'transfer',
            amount: money(amt),
            accountId: accountId(from),
            transferAccountId: accountId(to),
          })
        );
      }
    );
    and(/^an expense from "(.*)" for (.*)$/, (name, amt) => {
      transactions.push(
        makeTransaction({
          type: 'expense',
          amount: money(amt),
          accountId: accountId(name),
        })
      );
    });
    and(/^a self-transfer of (.*) within "(.*)"$/, (amt, name) => {
      badTx = makeTransaction({
        type: 'transfer',
        amount: money(amt),
        accountId: accountId(name),
        transferAccountId: accountId(name),
      });
      transactions.push(badTx);
    });
    then(/^findSelfTransfers should return exactly the self-transfer$/, () => {
      const found = findSelfTransfers(transactions);
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe(badTx.id);
    });
  });

  test('findSelfTransfers finds nothing when every row is healthy', ({
    given,
    and,
    then,
  }) => {
    const transactions: Transaction[] = [];

    given(
      /^a normal transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        transactions.push(
          makeTransaction({
            type: 'transfer',
            amount: money(amt),
            accountId: accountId(from),
            transferAccountId: accountId(to),
          })
        );
      }
    );
    and(/^an expense from "(.*)" for (.*)$/, (name, amt) => {
      transactions.push(
        makeTransaction({
          type: 'expense',
          amount: money(amt),
          accountId: accountId(name),
        })
      );
    });
    then(/^findSelfTransfers should return no rows$/, () => {
      expect(findSelfTransfers(transactions)).toHaveLength(0);
    });
  });

  test('The read-tolerant transaction schema accepts a legacy self-transfer row', ({
    given,
    then,
  }) => {
    let raw: unknown;
    given(
      /^a stored transaction transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        raw = makeTransaction({
          type: 'transfer',
          amount: money(amt),
          accountId: accountId(from),
          transferAccountId: accountId(to),
        });
      }
    );
    then(/^the read-tolerant transaction schema should accept it$/, () => {
      // The row is "from Checking to Checking" — a self-transfer the
      // write-strict transactionSchema would reject, but a read/restore path
      // must tolerate.
      expect(transactionReadSchema.safeParse(raw).success).toBe(true);
    });
  });

  test('The read-tolerant recurring-template schema accepts a legacy self-transfer template', ({
    given,
    then,
  }) => {
    let raw: unknown;
    given(
      /^a stored recurring template transfer from "(.*)" to "(.*)" for (.*)$/,
      (from, to, amt) => {
        raw = {
          accountId: accountId(from),
          type: 'transfer',
          amount: money(amt),
          currency: 'USD',
          transferAccountId: accountId(to),
        };
      }
    );
    then(/^the read-tolerant recurring template schema should accept it$/, () => {
      expect(recurrenceTemplateReadSchema.safeParse(raw).success).toBe(true);
    });
  });

  test('findSelfTransferSeries finds the bad template among healthy ones', ({
    given,
    and,
    then,
  }) => {
    const series: RecurringSeries[] = [];
    let badSeries: RecurringSeries;

    given(
      /^an active series with a normal transfer template from "(.*)" to "(.*)"$/,
      (from, to) => {
        series.push(
          makeSeries({
            template: {
              accountId: accountId(from),
              type: 'transfer',
              amount: money('30.00'),
              currency: 'USD',
              transferAccountId: accountId(to),
            },
          })
        );
      }
    );
    and(/^an active series with an expense template from "(.*)"$/, (name) => {
      series.push(
        makeSeries({
          template: {
            accountId: accountId(name),
            type: 'expense',
            amount: money('5.00'),
            currency: 'USD',
          },
        })
      );
    });
    and(/^an active series with a self-transfer template within "(.*)"$/, (name) => {
      badSeries = makeSeries({
        template: {
          accountId: accountId(name),
          type: 'transfer',
          amount: money('40.00'),
          currency: 'USD',
          transferAccountId: accountId(name),
        },
      });
      series.push(badSeries);
    });
    then(/^findSelfTransferSeries should return exactly the self-transfer series$/, () => {
      const found = findSelfTransferSeries(series);
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe(badSeries.id);
    });
  });

  test('findSelfTransferSeries finds nothing when every series is healthy', ({
    given,
    and,
    then,
  }) => {
    const series: RecurringSeries[] = [];

    given(
      /^an active series with a normal transfer template from "(.*)" to "(.*)"$/,
      (from, to) => {
        series.push(
          makeSeries({
            template: {
              accountId: accountId(from),
              type: 'transfer',
              amount: money('30.00'),
              currency: 'USD',
              transferAccountId: accountId(to),
            },
          })
        );
      }
    );
    and(/^an active series with an expense template from "(.*)"$/, (name) => {
      series.push(
        makeSeries({
          template: {
            accountId: accountId(name),
            type: 'expense',
            amount: money('5.00'),
            currency: 'USD',
          },
        })
      );
    });
    then(/^findSelfTransferSeries should return no series$/, () => {
      expect(findSelfTransferSeries(series)).toHaveLength(0);
    });
  });
});
