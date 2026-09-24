import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { isDateOnlyLine } from '../../src/domain/dateGrammar';
import { resolveAbsoluteDate } from '../../src/domain/deviceParsePrompt';
import { resolveStatementDate } from '../../src/domain/statementDrafts';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'date-grammar.feature'));

/** Thursday 24 September 2026, 10:00 local — see the feature's description. */
const NOW = new Date(2026, 8, 24, 10, 0, 0, 0).getTime();

const ymd = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

defineFeature(feature, (test) => {
  test('A printed date is a date header and resolves to its day', ({ then, and }) => {
    then(/^"(.*)" should be a date header$/, (text: string) => {
      expect(isDateOnlyLine(text)).toBe(true);
    });
    // The statement-row path: the same resolver the review queue uses, which
    // also owns "Today"/"Yesterday". A defaulted date is a miss, not a pass.
    and(/^"(.*)" should resolve to (\d{4}-\d{2}-\d{2})$/, (text: string, date: string) => {
      const resolved = resolveStatementDate(text, NOW);
      expect(resolved.defaultedDate).toBe(false);
      expect(ymd(resolved.occurredAt)).toBe(date);
    });
  });

  test('Ordinary text is never a date header', ({ then }) => {
    then(/^"(.*)" should not be a date header$/, (text: string) => {
      expect(isDateOnlyLine(text)).toBe(false);
    });
  });

  test('Text holding no real date resolves to none', ({ then }) => {
    then(/^the date in "(.*)" should be none$/, (text: string) => {
      expect(resolveAbsoluteDate(text, NOW)).toBeNull();
    });
  });

  test('When text holds several dates, the right one wins', ({ then }) => {
    then(/^the date in "(.*)" should be (\d{4}-\d{2}-\d{2})$/, (text: string, date: string) => {
      const ts = resolveAbsoluteDate(text, NOW);
      expect(ts).not.toBeNull();
      expect(ymd(ts!)).toBe(date);
    });
  });
});
