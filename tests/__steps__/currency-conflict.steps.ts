import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { currencyConflict } from '../../src/domain/currencyConflict';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/currency-conflict.feature')
);

/** `"USD"` -> `'USD'`, `null` (bare keyword) -> `null`, `""`/`"   "` -> `''`/`'   '`. */
function parseCurrencyArg(raw: string): string | null {
  if (raw === 'null') return null;
  const quoted = raw.match(/^"(.*)"$/);
  return quoted ? quoted[1]! : raw;
}

defineFeature(feature, (test) => {
  const assertConflict = (then: any) =>
    then(
      /^(".*"|null) against account currency (".*"|null) should (not conflict|conflict)$/,
      (draftRaw: string, accountRaw: string, expectation: string) => {
        const draft = parseCurrencyArg(draftRaw);
        const account = parseCurrencyArg(accountRaw);
        expect(currencyConflict(draft, account)).toBe(expectation === 'conflict');
      }
    );

  test('The same currency on both sides never conflicts', ({ then }) => {
    assertConflict(then);
  });

  test('A different currency conflicts', ({ then }) => {
    assertConflict(then);
  });

  test('The comparison is case-insensitive', ({ then, and }) => {
    assertConflict(then);
    assertConflict(and);
  });

  test('A missing draft currency never conflicts', ({ then, and }) => {
    assertConflict(then);
    assertConflict(and);
    assertConflict(and);
  });

  test('An account with no currency never conflicts', ({ then, and }) => {
    assertConflict(then);
    assertConflict(and);
  });
});
