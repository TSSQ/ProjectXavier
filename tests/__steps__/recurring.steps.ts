import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  nextOccurrenceAfter,
  dueOccurrences,
  forecastNetWorth,
  upcomingOccurrences,
  seriesTitle,
  backPostedOccurrences,
  upcomingTotals,
  splitSeriesAt,
  resolveTemplateForPosting,
} from '../../src/domain/recurrence';
import { localDayNoon } from '../../src/domain/dates';
import {
  RecurrenceRule,
  RecurringSeries,
  RecurrenceTemplate,
  RecurrenceFrequency,
  Transaction,
} from '../../src/domain/types';
import { dateToEpoch, nextId, money } from '../support/world';

/** Occurrence dates coming out of the engine are local-noon epochs; wrap the
 *  UTC-midnight test fixture dates the same way so expectations line up. */
const expectedDay = (date: string): number => localDayNoon(dateToEpoch(date));

/** Local (not UTC) construction for a split point. Production's call site
 *  (repository.ts's splitAndContinue) passes an already-local-noon
 *  `occurrenceDate` into `splitSeriesAt` — building it with `dateToEpoch`
 *  (midnight-UTC) would only coincidentally match under TZ=UTC. */
const localSplitPoint = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return localDayNoon(new Date(y, m - 1, d).getTime());
};

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/recurring.feature'),
);

/** Build a minimal active series for testing. */
function makeSeries(
  partial: Partial<RecurringSeries> & { rule: RecurrenceRule },
): RecurringSeries {
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

function dailyRule(anchor: string, interval = 1): RecurrenceRule {
  return {
    freq: 'daily',
    interval,
    anchor: dateToEpoch(anchor),
    end: { kind: 'never' },
  };
}
function weeklyRule(anchor: string, interval = 1): RecurrenceRule {
  return {
    freq: 'weekly',
    interval,
    anchor: dateToEpoch(anchor),
    end: { kind: 'never' },
  };
}
function monthlyRule(anchor: string, interval = 1): RecurrenceRule {
  return {
    freq: 'monthly',
    interval,
    anchor: dateToEpoch(anchor),
    end: { kind: 'never' },
  };
}
function yearlyRule(anchor: string, interval = 1): RecurrenceRule {
  return {
    freq: 'yearly',
    interval,
    anchor: dateToEpoch(anchor),
    end: { kind: 'never' },
  };
}

defineFeature(feature, (test) => {
  let rule: RecurrenceRule;
  let result: number | null;
  let series: RecurringSeries;
  let dues: number[];
  let actualNetWorth: number;
  let allSeries: RecurringSeries[];
  let forecast: number;

  // ── nextOccurrenceAfter ──────────────────────────────────────────────────

  test('Daily rule produces consecutive occurrences', ({ given, when, then }) => {
    given(/^a daily rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = dailyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  test('Weekly rule steps by 7 days', ({ given, when, then }) => {
    given(/^a weekly rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = weeklyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  test('Bi-weekly rule steps by 14 days', ({ given, when, then }) => {
    given(/^a weekly rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = weeklyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  test('Monthly rule on the 1st advances one calendar month', ({ given, when, then }) => {
    given(/^a monthly rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = monthlyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  test('Monthly rule on the 31st clamps to February 28 in non-leap year', ({ given, when, then }) => {
    given(/^a monthly rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = monthlyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  test('Semi-annual rule steps by 6 months', ({ given, when, then }) => {
    given(/^a monthly rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = monthlyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  test('Yearly rule steps by one year', ({ given, when, then }) => {
    given(/^a yearly rule anchored on "([^"]+)" with interval (\d+)$/, (anchor, interval) => {
      rule = yearlyRule(anchor, Number(interval));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(expectedDay(expected));
    });
  });

  // ── dueOccurrences ────────────────────────────────────────────────────────

  test('Due occurrences returns all dates between last post and now', ({ given, then }) => {
    given(
      /^a monthly series anchored on "([^"]+)" with no last post and today is "([^"]+)"$/,
      (anchor, today) => {
        series = makeSeries({ rule: monthlyRule(anchor) });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then(/^due occurrences should be "([^"]+)", "([^"]+)", "([^"]+)"$/, (d1, d2, d3) => {
      expect(dues).toEqual([d1, d2, d3].map(expectedDay));
    });
  });

  test('Due occurrences respects the last posted date', ({ given, then }) => {
    given(
      /^a monthly series anchored on "([^"]+)" last posted on "([^"]+)" and today is "([^"]+)"$/,
      (anchor, lastPosted, today) => {
        series = makeSeries({
          rule: monthlyRule(anchor),
          lastPostedAt: dateToEpoch(lastPosted),
          postedCount: 2,
        });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then(/^due occurrences should be "([^"]+)", "([^"]+)"$/, (d1, d2) => {
      expect(dues).toEqual([d1, d2].map(expectedDay));
    });
  });

  test('Count-limited series stops after N occurrences', ({ given, then }) => {
    given(
      /^a monthly series anchored on "([^"]+)" limited to (\d+) occurrences with (\d+) already posted and today is "([^"]+)"$/,
      (anchor, limit, posted, today) => {
        series = makeSeries({
          rule: { ...monthlyRule(anchor), end: { kind: 'count', n: Number(limit) } },
          lastPostedAt: dateToEpoch('2026-02-01'),
          postedCount: Number(posted),
        });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then(/^due occurrences should be "([^"]+)"$/, (d1) => {
      expect(dues).toEqual([expectedDay(d1)]);
    });
  });

  test('Until-limited series stops on or before the end date', ({ given, then }) => {
    given(
      /^a monthly series anchored on "([^"]+)" ending until "([^"]+)" with no last post and today is "([^"]+)"$/,
      (anchor, until, today) => {
        series = makeSeries({
          rule: { ...monthlyRule(anchor), end: { kind: 'until', date: dateToEpoch(until) } },
        });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then(/^due occurrences should be "([^"]+)", "([^"]+)", "([^"]+)"$/, (d1, d2, d3) => {
      expect(dues).toEqual([d1, d2, d3].map(expectedDay));
    });
  });

  test('Paused series produces no due occurrences', ({ given, then }) => {
    given(
      /^a paused monthly series anchored on "([^"]+)" with no last post and today is "([^"]+)"$/,
      (anchor, today) => {
        series = makeSeries({ rule: monthlyRule(anchor), paused: true });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then('due occurrences should be empty', () => {
      expect(dues).toEqual([]);
    });
  });

  test('Skipped date is excluded from due occurrences', ({ given, then }) => {
    given(
      /^a monthly series anchored on "([^"]+)" with "([^"]+)" skipped and no last post and today is "([^"]+)"$/,
      (anchor, skipped, today) => {
        series = makeSeries({
          rule: monthlyRule(anchor),
          skippedDates: [expectedDay(skipped)],
        });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then(/^due occurrences should be "([^"]+)", "([^"]+)"$/, (d1, d2) => {
      expect(dues).toEqual([d1, d2].map(expectedDay));
    });
  });

  // ── forecastNetWorth ──────────────────────────────────────────────────────

  test('Forecast adds future income occurrences to actual net worth', ({
    given,
    and,
    when,
    then,
  }) => {
    given(/^an actual net worth of (\d+) minor units$/, (n) => {
      actualNetWorth = Number(n);
      allSeries = [];
    });
    and(
      /^a monthly income series of (\d+) with next occurrence "([^"]+)"$/,
      (amount, anchor) => {
        allSeries.push(
          makeSeries({
            rule: monthlyRule(anchor),
            template: { accountId: 'acc-1', type: 'income', amount: Number(amount), currency: 'USD' },
          }),
        );
      },
    );
    when(
      /^I forecast net worth from "([^"]+)" until "([^"]+)"$/,
      (from, until) => {
        forecast = forecastNetWorth(
          actualNetWorth, allSeries, dateToEpoch(from), dateToEpoch(until), 'USD',
        );
      },
    );
    then(/^the forecast should be (\d+) minor units$/, (expected) => {
      expect(forecast).toBe(Number(expected));
    });
  });

  test('Forecast subtracts future expense occurrences', ({ given, and, when, then }) => {
    given(/^an actual net worth of (\d+) minor units$/, (n) => {
      actualNetWorth = Number(n);
      allSeries = [];
    });
    and(
      /^a monthly expense series of (\d+) with next occurrence "([^"]+)"$/,
      (amount, anchor) => {
        allSeries.push(
          makeSeries({
            rule: monthlyRule(anchor),
            template: { accountId: 'acc-1', type: 'expense', amount: Number(amount), currency: 'USD' },
          }),
        );
      },
    );
    when(/^I forecast net worth from "([^"]+)" until "([^"]+)"$/, (from, until) => {
      forecast = forecastNetWorth(
        actualNetWorth, allSeries, dateToEpoch(from), dateToEpoch(until), 'USD',
      );
    });
    then(/^the forecast should be (\d+) minor units$/, (expected) => {
      expect(forecast).toBe(Number(expected));
    });
  });

  test('Transfer occurrences are net-worth-neutral in forecast', ({ given, and, when, then }) => {
    given(/^an actual net worth of (\d+) minor units$/, (n) => {
      actualNetWorth = Number(n);
      allSeries = [];
    });
    and(
      /^a monthly transfer series of (\d+) with next occurrence "([^"]+)"$/,
      (amount, anchor) => {
        allSeries.push(
          makeSeries({
            rule: monthlyRule(anchor),
            template: {
              accountId: 'acc-1', type: 'transfer', amount: Number(amount),
              currency: 'USD', transferAccountId: 'acc-2',
            },
          }),
        );
      },
    );
    when(/^I forecast net worth from "([^"]+)" until "([^"]+)"$/, (from, until) => {
      forecast = forecastNetWorth(
        actualNetWorth, allSeries, dateToEpoch(from), dateToEpoch(until), 'USD',
      );
    });
    then(/^the forecast should be (\d+) minor units$/, (expected) => {
      expect(forecast).toBe(Number(expected));
    });
  });

  // ── splitSeriesAt ─────────────────────────────────────────────────────────

  test('Splitting a series truncates the original and creates a continuation', ({
    given,
    when,
    then,
    and,
  }) => {
    let truncated: RecurringSeries;
    let continuation: RecurringSeries;
    const originalId = 'series-orig';

    given(/^a monthly series anchored on "([^"]+)" with no end$/, (anchor) => {
      series = makeSeries({ id: originalId, rule: monthlyRule(anchor) });
    });
    when(
      /^I split the series at "([^"]+)" with a new template$/,
      (splitDate) => {
        const newTemplate: RecurrenceTemplate = {
          accountId: 'acc-1',
          type: 'expense',
          amount: 2000,
          currency: 'USD',
        };
        const result = splitSeriesAt(
          series,
          dateToEpoch(splitDate),
          newTemplate,
          { ...series.rule, anchor: dateToEpoch(splitDate) },
          'series-new',
          dateToEpoch('2026-04-01'),
        );
        truncated = result.truncated;
        continuation = result.continuation;
      },
    );
    then(/^the truncated series should end before "([^"]+)"$/, (splitDate) => {
      expect(truncated.rule.end.kind).toBe('until');
      if (truncated.rule.end.kind === 'until') {
        expect(truncated.rule.end.date).toBeLessThan(expectedDay(splitDate));
      }
    });
    and(/^the continuation should be anchored on "([^"]+)"$/, (expected) => {
      expect(continuation.rule.anchor).toBe(expectedDay(expected));
    });
    and('the continuation should have a different id', () => {
      expect(continuation.id).not.toBe(originalId);
    });
  });

  test('Splitting a series before the split occurrence posts does not double-post it', ({
    given,
    when,
    then,
    and,
  }) => {
    let truncated: RecurringSeries;
    let continuation: RecurringSeries;

    given(/^a monthly series anchored on "([^"]+)" with no end$/, (anchor) => {
      series = makeSeries({ rule: monthlyRule(anchor) });
    });
    when(
      /^I split the series at "([^"]+)" with a new template$/,
      (splitDate) => {
        const newTemplate: RecurrenceTemplate = {
          accountId: 'acc-1',
          type: 'expense',
          amount: 2000,
          currency: 'USD',
        };
        // Match the production call site (repository.ts): occurrenceDate
        // arrives as an already-local-noon value, not a raw UTC date parse.
        const result = splitSeriesAt(
          series,
          localSplitPoint(splitDate),
          newTemplate,
          { ...series.rule, anchor: localSplitPoint(splitDate) },
          'series-new',
          dateToEpoch('2026-04-01'),
        );
        truncated = result.truncated;
        continuation = result.continuation;
      },
    );
    then(
      /^due occurrences for the truncated series as of "([^"]+)" should not include "([^"]+)"$/,
      (asOf, notIncluded) => {
        const dues = dueOccurrences(truncated, dateToEpoch(asOf));
        expect(dues).not.toContainEqual(expectedDay(notIncluded));
      },
    );
    and(
      /^due occurrences for the continuation series as of "([^"]+)" should include "([^"]+)"$/,
      (asOf, included) => {
        const dues = dueOccurrences(continuation, dateToEpoch(asOf));
        expect(dues).toContainEqual(expectedDay(included));
      },
    );
  });

  test('A healthy template is postable', ({ given, then }) => {
    let raw: unknown;
    given(/^a stored template that is a normal expense$/, () => {
      raw = {
        accountId: 'acc-1',
        type: 'expense',
        amount: 1500,
        currency: 'USD',
      };
    });
    then(/^resolveTemplateForPosting should say it is postable$/, () => {
      expect(resolveTemplateForPosting(raw)).toEqual(
        expect.objectContaining({ post: true }),
      );
    });
  });

  test('A self-transfer template is skipped, not thrown', ({ given, then }) => {
    let raw: unknown;
    given(
      /^a stored template that is a transfer with the same account on both sides$/,
      () => {
        raw = {
          accountId: 'acc-1',
          type: 'transfer',
          transferAccountId: 'acc-1',
          amount: 3000,
          currency: 'USD',
        };
      },
    );
    then(
      /^resolveTemplateForPosting should skip it for reason "(.*)"$/,
      (reason) => {
        expect(() => resolveTemplateForPosting(raw)).not.toThrow();
        expect(resolveTemplateForPosting(raw)).toEqual({ post: false, reason });
      },
    );
  });

  test('A genuinely corrupt template is skipped, not thrown', ({ given, then }) => {
    let raw: unknown;
    given(/^a stored template missing its accountId$/, () => {
      raw = { type: 'expense', amount: 1000, currency: 'USD' };
    });
    then(
      /^resolveTemplateForPosting should skip it for reason "(.*)"$/,
      (reason) => {
        expect(() => resolveTemplateForPosting(raw)).not.toThrow();
        expect(resolveTemplateForPosting(raw)).toEqual({ post: false, reason });
      },
    );
  });

  test('One bad template in a batch does not affect the others', ({ given, then }) => {
    let batch: unknown[];
    given(
      /^a batch of templates where one is a self-transfer and the rest are healthy$/,
      () => {
        batch = [
          { accountId: 'acc-1', type: 'expense', amount: 1000, currency: 'USD' },
          {
            accountId: 'acc-1',
            type: 'transfer',
            transferAccountId: 'acc-1',
            amount: 3000,
            currency: 'USD',
          },
          { accountId: 'acc-2', type: 'income', amount: 2000, currency: 'USD' },
        ];
      },
    );
    then(/^only the healthy templates in the batch should be postable$/, () => {
      const decisions = batch.map(resolveTemplateForPosting);
      expect(decisions.map((d) => d.post)).toEqual([true, false, true]);
    });
  });
// ── upcomingOccurrences date bound ────────────────────────────────────────

  describeUpcomingBound(test);
  describeSeriesTitle(test);
  describeIntervalGuard(test);
  describeBackPostedDetection(test);
  describeUpcomingTotals(test);
});

/** The dashboard forecast asks for occurrences in a WINDOW, not a count — see
 *  the feature file for the measurement that motivated the bound. */
function describeUpcomingBound(test: any) {
  let boundSeries: RecurringSeries;
  let upcoming: number[];
  let boundMs: number | undefined;

  const givenSeries = (given: any) =>
    given(
      /^a "([^"]+)" series anchored at local "([^"]+)" that never ends$/,
      (freq: string, anchor: string) => {
        boundSeries = {
          id: nextId('series'),
          rule: {
            freq: freq as RecurrenceRule['freq'],
            interval: 1,
            anchor: localSplitPoint(anchor),
            end: { kind: 'never' },
          },
          template: { accountId: 'a1', type: 'expense', amount: 2119, currency: 'SGD' },
          lastPostedAt: null,
          postedCount: 0,
          paused: false,
          skippedDates: [],
          createdAt: localSplitPoint(anchor),
          archived: false,
        } as RecurringSeries;
      }
    );

  const whenBounded = (when: any) =>
    when(
      /^I list upcoming occurrences from local "([^"]+)" until local "([^"]+)" with limit (\d+)$/,
      (from: string, until: string, limit: string) => {
        boundMs = localSplitPoint(until);
        upcoming = upcomingOccurrences(
          boundSeries,
          localSplitPoint(from),
          Number(limit),
          boundMs
        );
      }
    );

  const thenBeforeBound = (and: any) =>
    and(/^the last upcoming occurrence should be before the bound$/, () => {
      expect(upcoming[upcoming.length - 1]).toBeLessThan(boundMs!);
    });

  test('Upcoming occurrences stop at the requested date bound', ({ given, when, then, and }: any) => {
    givenSeries(given);
    whenBounded(when);
    then(/^there should be (\d+) upcoming occurrence$/, (n: string) => {
      expect(upcoming).toHaveLength(Number(n));
    });
    thenBeforeBound(and);
  });

  test('A date bound applies to a series anchored in the past too', ({ given, when, then, and }: any) => {
    givenSeries(given);
    whenBounded(when);
    then(/^there should be (\d+) upcoming occurrences$/, (n: string) => {
      expect(upcoming).toHaveLength(Number(n));
    });
    thenBeforeBound(and);
  });

  test('Every frequency respects the date bound', ({ given, when, then, and }: any) => {
    givenSeries(given);
    whenBounded(when);
    then(/^there should be (\d+) upcoming occurrences$/, (n: string) => {
      expect(upcoming).toHaveLength(Number(n));
    });
    thenBeforeBound(and);
  });

  test('Without a bound the limit still applies', ({ given, when, then }: any) => {
    givenSeries(given);
    when(
      /^I list upcoming occurrences from local "([^"]+)" with limit (\d+)$/,
      (from: string, limit: string) => {
        upcoming = upcomingOccurrences(boundSeries, localSplitPoint(from), Number(limit));
      }
    );
    then(/^there should be (\d+) upcoming occurrences$/, (n: string) => {
      expect(upcoming).toHaveLength(Number(n));
    });
  });
}

/** How the Upcoming strip and the Recurring screen name a series. */
function describeSeriesTitle(test: any) {
  let title: string;

  const whenTitle = (when: any) =>
    when(
      /^I title a series with payee "([^"]*)" and category "([^"]*)"$/,
      (payeeName: string, categoryName: string) => {
        title = seriesTitle(
          { accountId: 'a1', type: 'expense', amount: 2000, currency: 'SGD' },
          { payeeName, categoryName }
        );
      }
    );

  for (const name of [
    'A series is titled by its payee',
    'A series with no payee falls back to its category',
    'A series with neither falls back to the type',
    'Whitespace-only names do not count as a title',
  ]) {
    test(name, ({ when, then }: any) => {
      whenTitle(when);
      then(/^the series title should be "([^"]*)"$/, (expected: string) => {
        expect(title).toBe(expected);
      });
    });
  }
}

/** A degenerate rule must not be able to hang the app. */
function describeIntervalGuard(test: any) {
  let rule: RecurrenceRule;
  let next: number | null;

  const givenRule = (given: any) =>
    given(/^a "([^"]+)" rule with interval (-?\d+)$/, (freq: string, interval: string) => {
      rule = {
        freq: freq as RecurrenceRule['freq'],
        interval: Number(interval),
        anchor: localDayNoon(new Date(2026, 7, 4).getTime()),
        end: { kind: 'never' },
      };
    });
  const whenNext = (when: any) =>
    when(/^I ask for the next occurrence$/, () => {
      next = nextOccurrenceAfter(rule, localDayNoon(new Date(2026, 7, 23).getTime()));
    });

  test('A rule that cannot advance schedules nothing instead of hanging', ({ given, when, then }: any) => {
    givenRule(given);
    whenNext(when);
    then(/^there should be no next occurrence$/, () => {
      expect(next).toBeNull();
    });
  });

  test('A normal interval still advances', ({ given, when, then }: any) => {
    givenRule(given);
    whenNext(when);
    then(/^there should be a next occurrence$/, () => {
      expect(typeof next).toBe('number');
    });
  });
}

/** The predicate that decides which rows a repair may delete. Every "kept"
 *  row below is a row a user would be furious to lose. */
function describeBackPostedDetection(test: any) {
  const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0, 0).getTime();
  const CREATED = new Date(2026, 7, 23, 15, 30).getTime();
  const template = {
    accountId: 'uob', type: 'expense' as const, amount: 13936, currency: 'SGD',
    categoryId: 'subs', payeeId: 'chatgpt', transferAccountId: null, note: null,
  };
  let series: RecurringSeries;
  let verdict: 'flagged' | 'kept';

  const row = (over: Partial<Transaction>): Transaction => ({
    id: 'x', accountId: 'uob', type: 'expense', amount: 13936, currency: 'SGD',
    categoryId: 'subs', payeeId: 'chatgpt', transferAccountId: null, note: null,
    occurredAt: noon(2025, 8, 4), createdAt: CREATED + 40, source: 'manual',
    receiptRef: null, seriesId: 'S1', occurrenceDate: noon(2025, 8, 4), pending: false,
    ...over,
  });

  const CASES: Record<string, Transaction> = {
    'phantom dated Sep 2025': row({}),
    'phantom dated Jan 2026': row({ occurrenceDate: noon(2026, 0, 4), occurredAt: noon(2026, 0, 4) }),
    'the anchor the user typed': row({ occurrenceDate: noon(2025, 7, 4), occurredAt: noon(2025, 7, 4) }),
    'a normal future occurrence': row({ occurrenceDate: noon(2026, 8, 4), occurredAt: noon(2026, 8, 4), createdAt: noon(2026, 8, 4) }),
    'posted late, clock was wrong': row({ createdAt: noon(2026, 5, 1) }),
    'the user edited the amount': row({ amount: 9999 }),
    'the user edited the payee': row({ payeeId: 'someone-else' }),
    'the user edited the note': row({ note: 'checked against statement' }),
    'a row from another series': row({ seriesId: 'S2' }),
    'a manual row tagged to series': row({ occurrenceDate: null }),
    'a row in no series at all': row({ seriesId: null, occurrenceDate: null }),
    'written after the batch window': row({ createdAt: CREATED + 10 * 60 * 1000 }),
  };

  test('Only occurrences invented before the series existed are flagged', ({ given, when, then }: any) => {
    given(/^a monthly series created on "([^"]+)" anchored "([^"]+)"$/, () => {
      series = {
        id: 'S1',
        rule: { freq: 'monthly' as RecurrenceFrequency, interval: 1, anchor: noon(2025, 7, 4), end: { kind: 'never' } },
        template,
        lastPostedAt: noon(2026, 7, 4),
        postedCount: 13,
        paused: false,
        skippedDates: [],
        createdAt: CREATED,
        archived: false,
      } as RecurringSeries;
    });
    when(/^I check a posted row "([^"]+)"$/, (name: string) => {
      const tx = CASES[name.trim()];
      if (!tx) throw new Error('unknown case: ' + name);
      verdict = backPostedOccurrences(series, [tx]).length > 0 ? 'flagged' : 'kept';
    });
    then(/^it should be (flagged|kept)$/, (expected: string) => {
      expect(verdict).toBe(expected);
    });
  });
}

/** What the 30-day forecast card counts. */
function describeUpcomingTotals(test: any) {
  const noon = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, dd, 12, 0, 0, 0).getTime();
  };
  let now: number;
  let until: number;
  let txs: Transaction[];
  let all: RecurringSeries[];
  let totals: { incoming: number; outgoing: number; net: number };

  const row = (over: Partial<Transaction>): Transaction => ({
    id: nextId('tx'), accountId: 'a1', type: 'expense', amount: 0, currency: 'SGD',
    categoryId: null, payeeId: null, transferAccountId: null, note: null,
    occurredAt: now, createdAt: now, source: 'manual', receiptRef: null,
    seriesId: null, occurrenceDate: null, pending: false, ...over,
  });

  const givenWindow = (given: any) =>
    given(/^today is "([^"]+)" and the window runs (\d+) days$/, (d: string, days: string) => {
      now = noon(d);
      until = now + Number(days) * 86_400_000;
      txs = [];
      all = [];
    });

  const givenSubject = (and: any) =>
    and(
      /^a (?:one-off (expense|income|transfer) of ([\d.]+) dated "([^"]+)"|monthly series of ([\d.]+) anchored "([^"]+)" whose first occurrence is already a row)$/,
      (kind: string|undefined, amt: string|undefined, date: string|undefined,
       sAmt: string|undefined, sAnchor: string|undefined) => {
        if (kind) {
          txs = [row({ type: kind as any, amount: money(amt!), occurredAt: noon(date!) })];
          return;
        }
        const anchor = noon(sAnchor!);
        all = [{
          id: 'S1',
          rule: { freq: 'monthly' as RecurrenceFrequency, interval: 1, anchor, end: { kind: 'never' } },
          template: { accountId: 'a1', type: 'expense', amount: money(sAmt!), currency: 'SGD' },
          lastPostedAt: anchor, postedCount: 1, paused: false, skippedDates: [],
          createdAt: now, archived: false,
        } as RecurringSeries];
        txs = [row({
          type: 'expense', amount: money(sAmt!), occurredAt: anchor,
          seriesId: 'S1', occurrenceDate: anchor,
        })];
      }
    );

  const whenTotal = (when: any) =>
    when(/^I total what is upcoming$/, () => {
      totals = upcomingTotals(all, txs, now, until, 'SGD');
    });

  for (const [name, hasSecond] of [
    ['A one-off future-dated expense counts toward the forecast', true],
    ['A one-off future-dated income counts toward the forecast', true],
    ['A row dated beyond the window is not counted', false],
    ['A past row is not counted', false],
    ['A future-dated transfer does not move the forecast', true],
    ['A recurring entry already written as a row is counted once', false],
  ] as const) {
    test(name, ({ given, and, when, then }: any) => {
      givenWindow(given);
      givenSubject(and);
      whenTotal(when);
      then(/^(outgoing|incoming) should be (\d+)$/, (which: string, n: string) => {
        expect((totals as any)[which]).toBe(Number(n));
      });
      if (hasSecond) {
        and(/^(outgoing|incoming) should be (\d+)$/, (which: string, n: string) => {
          expect((totals as any)[which]).toBe(Number(n));
        });
      }
    });
  }
}
