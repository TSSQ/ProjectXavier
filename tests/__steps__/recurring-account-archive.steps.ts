import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { postableOccurrences, seriesToResumeOnUnarchive } from '../../src/domain/recurrence';
import { localDayNoon } from '../../src/domain/dates';
import { Account, RecurrenceRule, RecurringSeries } from '../../src/domain/types';
import { dateToEpoch, makeAccount, nextId } from '../support/world';

/** Occurrence dates coming out of the engine are local-noon epochs; wrap the
 *  UTC-midnight test fixture dates the same way so expectations line up
 *  (mirrors recurring.steps.ts's own `expectedDay`). */
const expectedDay = (date: string): number => localDayNoon(dateToEpoch(date));

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/recurring-account-archive.feature'),
);

function monthlyRule(anchor: string, interval = 1): RecurrenceRule {
  return { freq: 'monthly', interval, anchor: dateToEpoch(anchor), end: { kind: 'never' } };
}
function dailyRule(anchor: string, interval = 1): RecurrenceRule {
  return { freq: 'daily', interval, anchor: dateToEpoch(anchor), end: { kind: 'never' } };
}

/** Build a minimal series for testing (mirrors recurring.steps.ts's makeSeries). */
function makeSeries(partial: Partial<RecurringSeries> & { rule: RecurrenceRule }): RecurringSeries {
  return {
    id: nextId('series'),
    template: {
      accountId: 'acc-1',
      type: 'expense',
      amount: 1000,
      currency: 'USD',
    },
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: dateToEpoch('2026-01-01'),
    archived: false,
    ...partial,
  };
}

defineFeature(feature, (test) => {
  let accounts: Account[];
  let allSeries: RecurringSeries[];
  let series: RecurringSeries;
  let dues: number[];
  let resumed: RecurringSeries[];

  beforeEach(() => {
    accounts = [];
    allSeries = [];
  });

  const archiveAccount = (accountId: string) => {
    accounts.push(makeAccount({ id: accountId, name: accountId, archived: true }));
  };
  const activateAccount = (accountId: string) => {
    accounts.push(makeAccount({ id: accountId, name: accountId, archived: false }));
  };
  // Production unarchive (app/manage-accounts.tsx's onUnarchive) both flips
  // the account row AND advances the cursor. Mirror the account-row half
  // here so a "postable occurrences" check that follows "is unarchived" in
  // a scenario sees an active account, not the stale archived one.
  const unarchiveAccountInFixture = (accountId: string) => {
    accounts = accounts.filter((a) => a.id !== accountId);
    activateAccount(accountId);
  };

  // ── postableOccurrences (the post-time gate) ────────────────────────────

  test('A series targeting an archived account yields no due occurrences', ({
    given,
    and,
    then,
  }) => {
    given(
      /^a monthly series targeting account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (accountId: string, anchor: string) => {
        series = makeSeries({
          rule: monthlyRule(anchor),
          template: { accountId, type: 'expense', amount: 1000, currency: 'USD' },
        });
      },
    );
    and(/^account "([^"]+)" is archived$/, archiveAccount);
    then(/^postable occurrences as of "([^"]+)" should be empty$/, (asOf: string) => {
      dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
      expect(dues).toEqual([]);
    });
  });

  test('A series targeting an active account is unaffected', ({ given, and, then }) => {
    given(
      /^a monthly series targeting account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (accountId: string, anchor: string) => {
        series = makeSeries({
          rule: monthlyRule(anchor),
          template: { accountId, type: 'expense', amount: 1000, currency: 'USD' },
        });
      },
    );
    and(/^account "([^"]+)" is active$/, activateAccount);
    then(
      /^postable occurrences as of "([^"]+)" should be "([^"]+)", "([^"]+)", "([^"]+)"$/,
      (asOf: string, d1: string, d2: string, d3: string) => {
        dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
        expect(dues).toEqual([d1, d2, d3].map(expectedDay));
      },
    );
  });

  test('A series whose transfer destination is archived is also gated', ({
    given,
    and,
    then,
  }) => {
    given(
      /^a monthly transfer series from account "([^"]+)" to account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (fromId: string, toId: string, anchor: string) => {
        series = makeSeries({
          rule: monthlyRule(anchor),
          template: {
            accountId: fromId,
            type: 'transfer',
            amount: 1000,
            currency: 'USD',
            transferAccountId: toId,
          },
        });
      },
    );
    and(/^account "([^"]+)" is active$/, activateAccount);
    and(/^account "([^"]+)" is archived$/, archiveAccount);
    then(/^postable occurrences as of "([^"]+)" should be empty$/, (asOf: string) => {
      dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
      expect(dues).toEqual([]);
    });
  });

  // ── seriesToResumeOnUnarchive (the cursor advance) ──────────────────────

  test('Unarchiving selects exactly the series targeting that account, and no others', ({
    given,
    and,
    when,
    then,
  }) => {
    given(
      /^a monthly series "([^"]+)" targeting account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (id: string, accountId: string, anchor: string) => {
        allSeries.push(
          makeSeries({
            id,
            rule: monthlyRule(anchor),
            template: { accountId, type: 'expense', amount: 1000, currency: 'USD' },
          }),
        );
      },
    );
    and(
      /^a monthly series "([^"]+)" targeting account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (id: string, accountId: string, anchor: string) => {
        allSeries.push(
          makeSeries({
            id,
            rule: monthlyRule(anchor),
            template: { accountId, type: 'expense', amount: 1000, currency: 'USD' },
          }),
        );
      },
    );
    and(
      /^a monthly transfer series "([^"]+)" from account "([^"]+)" to account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (id: string, fromId: string, toId: string, anchor: string) => {
        allSeries.push(
          makeSeries({
            id,
            rule: monthlyRule(anchor),
            template: {
              accountId: fromId,
              type: 'transfer',
              amount: 1000,
              currency: 'USD',
              transferAccountId: toId,
            },
          }),
        );
      },
    );
    when(/^account "([^"]+)" is unarchived on "([^"]+)"$/, (accountId: string, now: string) => {
      resumed = seriesToResumeOnUnarchive(allSeries, accountId, dateToEpoch(now));
    });
    then(
      /^the series selected to resume should be "([^"]+)", "([^"]+)"$/,
      (id1: string, id2: string) => {
        expect(resumed.map((s) => s.id)).toEqual([id1, id2]);
      },
    );
    and(/^each selected series should have lastPostedAt "([^"]+)"$/, (date: string) => {
      expect(resumed.length).toBe(2);
      for (const s of resumed) {
        expect(s.lastPostedAt).toBe(expectedDay(date));
      }
    });
  });

  // ── The back-fill regression (the point of the feature) ─────────────────

  test('Archiving then unarchiving after a long gap does not back-post a burst', ({
    given,
    and,
    then,
    when,
  }) => {
    given(
      /^a daily series targeting account "([^"]+)" anchored on "([^"]+)" last posted on "([^"]+)"$/,
      (accountId: string, anchor: string, lastPosted: string) => {
        series = makeSeries({
          rule: dailyRule(anchor),
          template: { accountId, type: 'expense', amount: 1000, currency: 'USD' },
          lastPostedAt: dateToEpoch(lastPosted),
        });
      },
    );
    and(/^account "([^"]+)" is archived$/, archiveAccount);
    then(/^postable occurrences as of "([^"]+)" should be empty$/, (asOf: string) => {
      dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
      expect(dues).toEqual([]);
    });
    when(/^account "([^"]+)" is unarchived on "([^"]+)"$/, (accountId: string, now: string) => {
      const [resumedSeries] = seriesToResumeOnUnarchive([series], accountId, dateToEpoch(now));
      series = resumedSeries!;
      unarchiveAccountInFixture(accountId);
    });
    then(/^postable occurrences as of "([^"]+)" should be empty$/, (asOf: string) => {
      dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
      expect(dues).toEqual([]);
    });
    and(
      /^postable occurrences as of "([^"]+)" should be "([^"]+)"$/,
      (asOf: string, d1: string) => {
        dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
        expect(dues).toEqual([expectedDay(d1)]);
      },
    );
  });

  // ── A user-paused series is never silently resumed ───────────────────────

  test('A user-paused series stays paused across an archive/unarchive cycle', ({
    given,
    and,
    when,
    then,
  }) => {
    given(
      /^a paused monthly series targeting account "([^"]+)" anchored on "([^"]+)" with no last post$/,
      (accountId: string, anchor: string) => {
        series = makeSeries({
          rule: monthlyRule(anchor),
          template: { accountId, type: 'expense', amount: 1000, currency: 'USD' },
          paused: true,
        });
      },
    );
    and(/^account "([^"]+)" is archived$/, archiveAccount);
    when(/^account "([^"]+)" is unarchived on "([^"]+)"$/, (accountId: string, now: string) => {
      const [resumedSeries] = seriesToResumeOnUnarchive([series], accountId, dateToEpoch(now));
      series = resumedSeries!;
      unarchiveAccountInFixture(accountId);
    });
    then(/^the resumed series should still be paused$/, () => {
      expect(series.paused).toBe(true);
    });
    and(/^postable occurrences as of "([^"]+)" should be empty$/, (asOf: string) => {
      dues = postableOccurrences(series, dateToEpoch(asOf), accounts);
      expect(dues).toEqual([]);
    });
  });
});
