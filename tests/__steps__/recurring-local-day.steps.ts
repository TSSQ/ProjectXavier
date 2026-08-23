import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { dueOccurrences, buildRecurringSeries } from '../../src/domain/recurrence';
import { localDayNoon } from '../../src/domain/dates';
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
// ── buildRecurringSeries ──────────────────────────────────────────────────

  describeBuildRecurringSeries(test);
  describeBackPosting(test);
});

/** The shared constructor used by every screen that can start a series. */
function describeBuildRecurringSeries(test: any) {
  let built: RecurringSeries;

  // A rule as the form hands it over: it already carries SOME anchor, which
  // buildRecurringSeries replaces with the transaction's own local noon.
  const RULE: RecurrenceRule = {
    freq: 'monthly' as RecurrenceFrequency,
    interval: 3,
    anchor: localMs('2020-01-01 03:00'),
    end: { kind: 'never' },
  };
  const TEMPLATE = {
    accountId: 'acct-1',
    type: 'expense' as const,
    amount: 4500,
    currency: 'SGD',
    categoryId: 'cat-1',
    payeeId: 'pay-1',
    transferAccountId: null,
    note: 'gym membership',
  };

  const whenBuild = (when: any) =>
    when(
      /^I build a recurring series for a transaction at local time (.+)$/,
      (dateTime: string) => {
        built = buildRecurringSeries({
          id: 'series-1',
          rule: RULE,
          template: TEMPLATE,
          occurredAt: localMs(dateTime),
          createdAt: localMs('2026-01-01 00:00'),
        });
      }
    );

  const expectNoonOn = (day: string) => {
    const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
    expect(built.rule.anchor).toBe(new Date(y, mo - 1, d, 12, 0, 0, 0).getTime());
  };

  for (const name of [
    "A new series anchors to the transaction's local day at noon",
    'A new series anchors to noon even for an early-morning transaction',
  ]) {
    test(name, ({ when, then }: any) => {
      whenBuild(when);
      then(/^the series anchor should be local noon on (.+)$/, expectNoonOn);
    });
  }

  test('A new series counts its anchor occurrence as already recorded', ({ when, then, and }: any) => {
    whenBuild(when);
    then(/^the series cursor should sit on the anchor$/, () => {
      expect(built.lastPostedAt).toBe(built.rule.anchor);
    });
    and(/^the series should have counted one occurrence$/, () => {
      expect(built.postedCount).toBe(1);
    });
    and(/^the series should not be paused$/, () => expect(built.paused).toBe(false));
    and(/^the series should have no skipped dates$/, () => expect(built.skippedDates).toEqual([]));
    and(/^the series should not be archived$/, () => expect(built.archived).toBe(false));
  });

  test("A new series keeps the rule's own frequency and interval", ({ when, then }: any) => {
    whenBuild(when);
    then(/^the series rule should keep its frequency and interval$/, () => {
      expect(built.rule.freq).toBe(RULE.freq);
      expect(built.rule.interval).toBe(RULE.interval);
    });
  });

  test('A new series carries the template through unchanged', ({ when, then }: any) => {
    whenBuild(when);
    then(/^the series template should carry the account, amount and note unchanged$/, () => {
      expect(built.template).toEqual(TEMPLATE);
    });
  });
}

/** A series created from a transaction the user just entered must never
 *  invent history behind it. */
function describeBackPosting(test: any) {
  let dues: number[];

  const whenPost = (when: any) =>
    when(
      /^I create a monthly series on local "([^"]+)" dated local "([^"]+)" and post it as of local "([^"]+)"$/,
      (created: string, dated: string, asOf: string) => {
        const at = (d: string, h = 12, mi = 0) => {
          const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
          return new Date(y, m - 1, dd, h, mi, 0, 0).getTime();
        };
        const series = buildRecurringSeries({
          id: 'series-bp',
          rule: {
            freq: 'monthly' as RecurrenceFrequency,
            interval: 1,
            anchor: localDayNoon(new Date(2020, 0, 1).getTime()),
            end: { kind: 'never' },
          },
          template: { accountId: 'a1', type: 'expense', amount: 13936, currency: 'SGD' },
          occurredAt: at(dated),
          createdAt: at(created, 15, 30),
        });
        dues = dueOccurrences(series, at(asOf, 15, 30));
      }
    );

  for (const name of [
    'A series created today but dated a year ago back-posts nothing',
    'A series created and dated today back-posts nothing',
  ]) {
    test(name, ({ when, then }: any) => {
      whenPost(when);
      then(/^no occurrences should be posted$/, () => {
        expect(dues).toHaveLength(0);
      });
    });
  }

  test('The next occurrence still posts when it comes due', ({ when, then }: any) => {
    whenPost(when);
    then(/^(\d+) occurrence should be posted$/, (n: string) => {
      expect(dues).toHaveLength(Number(n));
    });
  });

  test('A back-dated series keeps its original day of the month', ({ when, then, and }: any) => {
    whenPost(when);
    then(/^(\d+) occurrence should be posted$/, (n: string) => {
      expect(dues).toHaveLength(Number(n));
    });
    and(/^it should fall on day (\d+) of the month$/, (day: string) => {
      expect(new Date(dues[0]!).getDate()).toBe(Number(day));
    });
  });
}
