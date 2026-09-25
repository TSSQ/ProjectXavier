import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { resolveTypedDate } from '../../src/domain/deviceParsePrompt';

const feature = loadFeature(path.resolve(__dirname, '../__features__/typed-dates.feature'));

const NOW = new Date(2026, 8, 25, 12, 0).getTime();

function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

defineFeature(feature, (test) => {
  test('A typed phrase names a day', ({ then }) => {
    then(/^typing "(.*)" should date it (\d{4}-\d{2}-\d{2})$/, (text: string, day: string) => {
      const at = resolveTypedDate(text.trim(), NOW);
      expect(at).not.toBeNull();
      expect(localDay(at!)).toBe(day);
    });
  });

  test('Text that names no day stays undated, so the caller uses today', ({ then }) => {
    then(/^typing "(.*)" should name no date$/, (text: string) => {
      expect(resolveTypedDate(text.trim(), NOW)).toBeNull();
    });
  });

  test('"on the 28th" typed early in January is last December', ({ then }) => {
    then(
      /^typing "(.*)" on (\d{4})-(\d{2})-(\d{2}) should date it (\d{4}-\d{2}-\d{2})$/,
      (text: string, y: string, m: string, d: string, day: string) => {
        const now = new Date(Number(y), Number(m) - 1, Number(d), 12).getTime();
        expect(localDay(resolveTypedDate(text, now)!)).toBe(day);
      }
    );
  });
});
