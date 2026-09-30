import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { formatMoney } from '../../src/domain/money';
import { monthLabel, shortMonthDay } from '../../src/domain/dates';

const feature = loadFeature(path.resolve(__dirname, '../__features__/money-format-cache.feature'));

defineFeature(feature, (test) => {
  // Count constructions without changing behaviour: the cache lives in the
  // module, so each scenario loads a fresh copy of money.ts.
  let built: number;
  let fresh: typeof formatMoney;
  const RealNF = Intl.NumberFormat;

  beforeEach(() => {
    built = 0;
    const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.NumberFormat>) {
      built++;
      return new RealNF(...args);
    } as unknown as typeof Intl.NumberFormat;
    (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = Counting;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fresh = require('../../src/domain/money').formatMoney;
    });
  });
  afterEach(() => {
    (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = RealNF;
  });

  test('The same locale and currency reuse one formatter', ({ when, then }) => {
    when(/^formatMoney runs (\d+) times for "(.*)" in "(.*)"$/, (n: string, cur: string, loc: string) => {
      for (let i = 0; i < Number(n); i++) fresh(i * 100, cur, loc);
    });
    then(/^only (\d+) NumberFormat should have been built$/, (n: string) => expect(built).toBe(Number(n)));
  });

  test('Different currencies or locales get their own formatter', ({ when, then }) => {
    when('formatMoney runs for "SGD" in "en-US", "JPY" in "en-US" and "SGD" in "en-GB"', () => {
      for (let i = 0; i < 3; i++) {
        fresh(100, 'SGD', 'en-US');
        fresh(100, 'JPY', 'en-US');
        fresh(100, 'SGD', 'en-GB');
      }
    });
    then(/^(\d+) NumberFormats should have been built$/, (n: string) => expect(built).toBe(Number(n)));
  });

  // Intl may use a narrow no-break space between code and number.
  const norm = (s: string) => s.replace(/\u00a0|\u202f/g, ' ');

  test('Output is unchanged', ({ then, and }) => {
    then(/^formatting (\d+) minor units of "(.*)" should give "(.*)"$/, (m: string, cur: string, out: string) => {
      expect(norm(formatMoney(Number(m), cur))).toBe(out);
    });
    and(/^formatting (\d+) minor units of "(.*)" should give "(.*)"$/, (m: string, cur: string, out: string) => {
      expect(norm(formatMoney(Number(m), cur))).toBe(out);
    });
  });

  test("A malformed currency still falls back, and isn't remembered", ({ then, and }) => {
    then(/^formatting (\d+) minor units of "(.*)" should give "(.*)" twice$/, (m: string, cur: string, out: string) => {
      expect(fresh(Number(m), cur)).toBe(out);
      expect(fresh(Number(m), cur)).toBe(out);
    });
    and(/^formatting (\d+) minor units of "(.*)" should give "(.*)"$/, (m: string, cur: string, out: string) => {
      expect(fresh(Number(m), cur)).toBe(out);
    });
  });

  test('Short dates keep their shape', ({ then, and }) => {
    then(/^the short date for "(.*)" should be "(.*)"$/, (iso: string, out: string) => {
      expect(shortMonthDay(new Date(iso).getTime())).toBe(out);
    });
    and(/^the month label for "(.*)" should be "(.*)"$/, (iso: string, out: string) => {
      expect(monthLabel(new Date(iso).getTime())).toBe(out);
    });
  });

  // Same counting trick for DateTimeFormat, with the device's UTC offset
  // under the scenario's control.
  let dtBuilt: number;
  let offset: number;
  let freshShort: (ms: number) => string;
  const RealDTF = Intl.DateTimeFormat;
  const loadDates = () => {
    dtBuilt = 0;
    offset = -480;
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(() => offset);
    const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      dtBuilt++;
      return new RealDTF(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = Counting;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      freshShort = require('../../src/domain/dates').shortMonthDay;
    });
  };
  const restoreDates = () => {
    (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = RealDTF;
    jest.restoreAllMocks();
  };

  test('A date formatter is reused while the time zone holds', ({ when, then }) => {
    when(/^the short date is formatted (\d+) times in one time zone$/, (n: string) => {
      loadDates();
      for (let i = 0; i < Number(n); i++) freshShort(Date.UTC(2026, 8, 1 + i));
    });
    then(/^only (\d+) DateTimeFormat should have been built$/, (n: string) => {
      expect(dtBuilt).toBe(Number(n));
      restoreDates();
    });
  });

  test('Travelling to another time zone builds a fresh one', ({ when, then }) => {
    when('the short date is formatted, the UTC offset changes, and it is formatted again', () => {
      loadDates();
      freshShort(Date.UTC(2026, 8, 30));
      freshShort(Date.UTC(2026, 8, 30));
      offset = 0; // Singapore → London
      freshShort(Date.UTC(2026, 8, 30));
    });
    then(/^(\d+) DateTimeFormats should have been built$/, (n: string) => {
      expect(dtBuilt).toBe(Number(n));
      restoreDates();
    });
  });
});
