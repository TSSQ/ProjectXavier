import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction } from '../../src/domain/types';
import { groupTransactionsByDay, DaySection } from '../../src/lib/grouping';
import { makeTransaction, money } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/transaction-grouping.feature')
);

/** Local noon of a "YYYY-MM-DD" — the day identity the ledger groups on. */
const day = (d: string): number => {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, dd, 12, 0, 0, 0).getTime();
};

defineFeature(feature, (test) => {
  let now: number;
  let txs: Transaction[];
  let sections: DaySection[];
  /** Payee name is carried on the row itself only in these fixtures — the real
   *  screen resolves it from an id, which is irrelevant to grouping. */
  const payeeOf = new Map<string, string>();

  const givenToday = (given: any) =>
    given(/^today is "([^"]+)"$/, (d: string) => {
      now = day(d);
    });

  const givenRows = (and: any) =>
    and(/^these transactions:$/, (table: Array<{ date: string; payee: string }>) => {
      payeeOf.clear();
      txs = table.map((r) => {
        const tx = makeTransaction({
          type: 'expense',
          amount: money('10.00'),
          accountId: 'a1',
          occurredAt: day(r.date),
        });
        payeeOf.set(tx.id, r.payee);
        return tx;
      });
    });

  const thenSections = (then: any) =>
    then(/^the sections should be "([^"]*)"$/, (expected: string) => {
      expect(sections.map((s) => s.title).join(', ')).toBe(expected);
    });

  test('Without a clock the grouping is unchanged', ({ given, and, when, then }) => {
    givenToday(given);
    givenRows(and);
    when(/^I group them without a clock$/, () => {
      sections = groupTransactionsByDay(txs);
    });
    thenSections(then);
  });

  const whenGroup = (when: any) =>
    when(/^I group them as of today$/, () => {
      sections = groupTransactionsByDay(txs, now);
    });

  test('Future-dated rows collect into one Upcoming section', ({ given, and, when, then }) => {
    givenToday(given);
    givenRows(and);
    whenGroup(when);
    thenSections(then);
    and(/^the Upcoming section should hold "([^"]*)"$/, (expected: string) => {
      const up = sections.find((s) => s.title === 'Upcoming');
      expect(up?.data.map((t) => payeeOf.get(t.id)).join(', ')).toBe(expected);
    });
  });

  test('Upcoming runs soonest first', ({ given, and, when, then }) => {
    givenToday(given);
    givenRows(and);
    whenGroup(when);
    then(/^the Upcoming section should hold "([^"]*)"$/, (expected: string) => {
      const up = sections.find((s) => s.title === 'Upcoming');
      expect(up?.data.map((t) => payeeOf.get(t.id)).join(', ')).toBe(expected);
    });
  });

  for (const name of [
    'A transaction dated later today stays under today',
    'With nothing upcoming there is no Upcoming section',
    'Past days still run newest first',
  ]) {
    test(name, ({ given, and, when, then }) => {
      givenToday(given);
      givenRows(and);
      whenGroup(when);
      thenSections(then);
    });
  }
});
