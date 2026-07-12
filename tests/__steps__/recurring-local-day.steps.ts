import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { dueOccurrences } from '../../src/domain/recurrence';
import { RecurrenceRule, RecurringSeries, RecurrenceFrequency } from '../../src/domain/types';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/recurring-local-day.feature'),
);

/** Build a local-time epoch from "YYYY-MM-DD HH:MM" — deliberately using the
 *  local Date constructor (not Date.UTC) so these scenarios actually exercise
 *  the timezone the suite is running under, per package.json's "test:tz". */
function localMs(dateTime: string): number {
  const [ymd, hm] = dateTime.split(' ');
  const [y, mo, d] = ymd!.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm!.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** "YYYY-MM-DD" for the local calendar day containing `ms`. */
function localCalendarDay(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Pulls every quoted "YYYY-MM-DD" out of a comma-separated step-text list. */
function parseQuotedDays(list: string): string[] {
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

function makeSeries(rule: RecurrenceRule): RecurringSeries {
  return {
    id: 'series-tz-1',
    rule,
    template: { accountId: 'acc-1', type: 'expense', amount: 1000, currency: 'USD' },
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: rule.anchor,
    archived: false,
  };
}

function buildRule(freq: RecurrenceFrequency, anchor: string, interval: string): RecurrenceRule {
  return {
    freq,
    interval: Number(interval),
    anchor: localMs(anchor),
    end: { kind: 'never' },
  };
}

defineFeature(feature, (test) => {
  test('Daily series anchored on local today posts on the intended local days', ({
    given,
    when,
    then,
  }) => {
    let series: RecurringSeries;
    let dues: number[];

    given(
      /^a daily series anchored at local "([^"]+)" with interval (\d+)$/,
      (anchor: string, interval: string) => {
        series = makeSeries(buildRule('daily', anchor, interval));
      },
    );
    when(/^I compute due occurrences as of local "([^"]+)"$/, (now: string) => {
      dues = dueOccurrences(series, localMs(now));
    });
    then(/^the due occurrences' local calendar days should be (.+)$/, (list: string) => {
      expect(dues.map(localCalendarDay)).toEqual(parseQuotedDays(list));
    });
  });

  test('Weekly series posts on the intended local day in both zones', ({
    given,
    when,
    then,
  }) => {
    let series: RecurringSeries;
    let dues: number[];

    given(
      /^a weekly series anchored at local "([^"]+)" with interval (\d+)$/,
      (anchor: string, interval: string) => {
        series = makeSeries(buildRule('weekly', anchor, interval));
      },
    );
    when(/^I compute due occurrences as of local "([^"]+)"$/, (now: string) => {
      dues = dueOccurrences(series, localMs(now));
    });
    then(/^the due occurrences' local calendar days should be (.+)$/, (list: string) => {
      expect(dues.map(localCalendarDay)).toEqual(parseQuotedDays(list));
    });
  });

  test('Monthly series on the 1st posts in the intended local month', ({
    given,
    when,
    then,
  }) => {
    let series: RecurringSeries;
    let dues: number[];

    given(
      /^a monthly series anchored at local "([^"]+)" with interval (\d+)$/,
      (anchor: string, interval: string) => {
        series = makeSeries(buildRule('monthly', anchor, interval));
      },
    );
    when(/^I compute due occurrences as of local "([^"]+)"$/, (now: string) => {
      dues = dueOccurrences(series, localMs(now));
    });
    then(/^the due occurrences' local calendar days should be (.+)$/, (list: string) => {
      expect(dues.map(localCalendarDay)).toEqual(parseQuotedDays(list));
    });
  });

  // ── DST spring-forward guard ──────────────────────────────────────────────
  // Explicit timeout so a regression (infinite loop in dueOccurrences) fails
  // this test rather than hanging the whole run.

  test(
    'Daily series survives a spring-forward transition without stalling',
    ({ given, when, then }) => {
      let series: RecurringSeries;
      let dues: number[];

      given(
        /^a daily series anchored at local "([^"]+)" with interval (\d+)$/,
        (anchor: string, interval: string) => {
          series = makeSeries(buildRule('daily', anchor, interval));
        },
      );
      when(/^I compute due occurrences as of local "([^"]+)"$/, (now: string) => {
        dues = dueOccurrences(series, localMs(now));
      });
      then(/^the due occurrences' local calendar days should be (.+)$/, (list: string) => {
        expect(dues.map(localCalendarDay)).toEqual(parseQuotedDays(list));
      });
    },
    5_000,
  );

  test(
    'Weekly series survives a spring-forward transition without stalling',
    ({ given, when, then }) => {
      let series: RecurringSeries;
      let dues: number[];

      given(
        /^a weekly series anchored at local "([^"]+)" with interval (\d+)$/,
        (anchor: string, interval: string) => {
          series = makeSeries(buildRule('weekly', anchor, interval));
        },
      );
      when(/^I compute due occurrences as of local "([^"]+)"$/, (now: string) => {
        dues = dueOccurrences(series, localMs(now));
      });
      then(/^the due occurrences' local calendar days should be (.+)$/, (list: string) => {
        expect(dues.map(localCalendarDay)).toEqual(parseQuotedDays(list));
      });
    },
    5_000,
  );

  // ── DST fall-back guard ────────────────────────────────────────────────────

  test(
    'Daily series survives a fall-back transition without stalling',
    ({ given, when, then }) => {
      let series: RecurringSeries;
      let dues: number[];

      given(
        /^a daily series anchored at local "([^"]+)" with interval (\d+)$/,
        (anchor: string, interval: string) => {
          series = makeSeries(buildRule('daily', anchor, interval));
        },
      );
      when(/^I compute due occurrences as of local "([^"]+)"$/, (now: string) => {
        dues = dueOccurrences(series, localMs(now));
      });
      then(/^the due occurrences' local calendar days should be (.+)$/, (list: string) => {
        expect(dues.map(localCalendarDay)).toEqual(parseQuotedDays(list));
      });
    },
    5_000,
  );
});
