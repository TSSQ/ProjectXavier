import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { currencyExponent, SUPPORTED_CURRENCIES } from '../../src/domain/currency';
import { toMinorUnits, toMajorUnits, formatMoney } from '../../src/domain/money';

const feature = loadFeature(path.resolve(__dirname, '../__features__/currency-scale.feature'));

const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP'];

defineFeature(feature, (test) => {
  test('A representative sample of currencies resolves to the right exponent', ({ then }) => {
    then(/^the exponent for currency "(.*)" should be (\d)$/, (code: string, exp: string) => {
      expect(currencyExponent(code)).toBe(parseInt(exp, 10));
    });
  });

  test('An unrecognised currency code defaults to 2 and never throws', ({ then }) => {
    then(/^the exponent for currency "(.*)" should be (\d)$/, (code: string, exp: string) => {
      expect(() => currencyExponent(code)).not.toThrow();
      expect(currencyExponent(code)).toBe(parseInt(exp, 10));
    });
  });

  test('A lowercase currency code still resolves correctly', ({ then }) => {
    then(/^the exponent for currency "(.*)" should be (\d)$/, (code: string, exp: string) => {
      expect(currencyExponent(code)).toBe(parseInt(exp, 10));
    });
  });

  test('Every SUPPORTED_CURRENCIES code resolves to a sane 0/2/3 exponent', ({ then, and }) => {
    then(/^every code in SUPPORTED_CURRENCIES should resolve to 0, 2, or 3$/, () => {
      for (const code of SUPPORTED_CURRENCIES) {
        expect([0, 2, 3]).toContain(currencyExponent(code));
      }
    });
    and(
      /^every code in SUPPORTED_CURRENCIES except JPY, KRW, VND, CLP should resolve to 2$/,
      () => {
        for (const code of SUPPORTED_CURRENCIES) {
          if (ZERO_DECIMAL.includes(code)) continue;
          expect(currencyExponent(code)).toBe(2);
        }
      }
    );
  });

  test('A 2-decimal currency scales ×100', ({ then, and }) => {
    then(/^toMinorUnits of ([\d.]+) in "(.*)" should be (\d+)$/, (major: string, code: string, minor: string) => {
      expect(toMinorUnits(parseFloat(major), code)).toBe(parseInt(minor, 10));
    });
    and(/^toMajorUnits of (\d+) in "(.*)" should be ([\d.]+)$/, (minor: string, code: string, major: string) => {
      expect(toMajorUnits(parseInt(minor, 10), code)).toBe(parseFloat(major));
    });
  });

  test('A 0-decimal currency scales ×1 (no fractional minor units)', ({ then, and }) => {
    then(/^toMinorUnits of ([\d.]+) in "(.*)" should be (\d+)$/, (major: string, code: string, minor: string) => {
      expect(toMinorUnits(parseFloat(major), code)).toBe(parseInt(minor, 10));
    });
    and(/^toMajorUnits of (\d+) in "(.*)" should be ([\d.]+)$/, (minor: string, code: string, major: string) => {
      expect(toMajorUnits(parseInt(minor, 10), code)).toBe(parseFloat(major));
    });
  });

  test('A 3-decimal currency scales ×1000', ({ then, and }) => {
    then(/^toMinorUnits of ([\d.]+) in "(.*)" should be (\d+)$/, (major: string, code: string, minor: string) => {
      expect(toMinorUnits(parseFloat(major), code)).toBe(parseInt(minor, 10));
    });
    and(/^toMajorUnits of (\d+) in "(.*)" should be ([\d.]+)$/, (minor: string, code: string, major: string) => {
      expect(toMajorUnits(parseInt(minor, 10), code)).toBe(parseFloat(major));
    });
  });

  test('toMinorUnits rounds a fractional minor unit', ({ then }) => {
    then(/^toMinorUnits of ([\d.]+) in "(.*)" should be (\d+)$/, (major: string, code: string, minor: string) => {
      expect(toMinorUnits(parseFloat(major), code)).toBe(parseInt(minor, 10));
    });
  });

  test('toMinorUnits without a currency defaults to 2-decimal (USD)', ({ then }) => {
    then(/^toMinorUnits of ([\d.]+) with no currency should be (\d+)$/, (major: string, minor: string) => {
      expect(toMinorUnits(parseFloat(major))).toBe(parseInt(minor, 10));
    });
  });

  test('A 0-decimal currency formats with no fraction digits', ({ then, and }) => {
    then(/^formatMoney of (\d+) in "(.*)" should contain "(.*)"$/, (minor: string, code: string, snippet: string) => {
      expect(formatMoney(parseInt(minor, 10), code)).toContain(snippet);
    });
    and(/^formatMoney of (\d+) in "(.*)" should not contain "(.*)"$/, (minor: string, code: string, snippet: string) => {
      expect(formatMoney(parseInt(minor, 10), code)).not.toContain(snippet);
    });
  });

  test('A 2-decimal currency formats with two fraction digits', ({ then }) => {
    then(/^formatMoney of (\d+) in "(.*)" should contain "(.*)"$/, (minor: string, code: string, snippet: string) => {
      expect(formatMoney(parseInt(minor, 10), code)).toContain(snippet);
    });
  });

  test('A 3-decimal currency formats with three fraction digits', ({ then }) => {
    then(/^formatMoney of (\d+) in "(.*)" should contain "(.*)"$/, (minor: string, code: string, snippet: string) => {
      expect(formatMoney(parseInt(minor, 10), code)).toContain(snippet);
    });
  });

  test('A malformed currency code degrades gracefully instead of throwing', ({ then }) => {
    then(/^formatMoney of (\d+) in "(.*)" should not throw$/, (minor: string, code: string) => {
      expect(() => formatMoney(parseInt(minor, 10), code)).not.toThrow();
    });
  });
});
