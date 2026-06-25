import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  nextOccurrenceAfter,
  dueOccurrences,
  forecastNetWorth,
  splitSeriesAt,
  startOfUTCDay,
} from '../../src/domain/recurrence';
import {
  RecurrenceRule,
  RecurringSeries,
  RecurrenceTemplate,
} from '../../src/domain/types';
import { dateToEpoch, nextId } from '../support/world';

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
      expect(result).toBe(dateToEpoch(expected));
    });
    when(/^I ask for the next occurrence after "([^"]+)"$/, (date) => {
      result = nextOccurrenceAfter(rule, dateToEpoch(date));
    });
    then(/^the result should be "([^"]+)"$/, (expected) => {
      expect(result).toBe(dateToEpoch(expected));
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
      expect(result).toBe(dateToEpoch(expected));
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
      expect(result).toBe(dateToEpoch(expected));
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
      expect(result).toBe(dateToEpoch(expected));
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
      expect(result).toBe(dateToEpoch(expected));
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
      expect(result).toBe(dateToEpoch(expected));
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
      expect(result).toBe(dateToEpoch(expected));
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
      expect(dues).toEqual([d1, d2, d3].map(dateToEpoch));
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
      expect(dues).toEqual([d1, d2].map(dateToEpoch));
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
      expect(dues).toEqual([dateToEpoch(d1)]);
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
      expect(dues).toEqual([d1, d2, d3].map(dateToEpoch));
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
          skippedDates: [dateToEpoch(skipped)],
        });
        dues = dueOccurrences(series, dateToEpoch(today));
      },
    );
    then(/^due occurrences should be "([^"]+)", "([^"]+)"$/, (d1, d2) => {
      expect(dues).toEqual([d1, d2].map(dateToEpoch));
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
        expect(truncated.rule.end.date).toBeLessThan(dateToEpoch(splitDate));
      }
    });
    and(/^the continuation should be anchored on "([^"]+)"$/, (expected) => {
      expect(startOfUTCDay(continuation.rule.anchor)).toBe(dateToEpoch(expected));
    });
    and('the continuation should have a different id', () => {
      expect(continuation.id).not.toBe(originalId);
    });
  });
});
