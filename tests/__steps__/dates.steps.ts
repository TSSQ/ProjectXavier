import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { formatDMY, isSameDay, monthLabel } from '../../src/domain/dates';

const feature = loadFeature(path.resolve(__dirname, '../__features__/dates.feature'));

/** Build a local-time epoch from "YYYY-MM-DD" + "HH:MM". */
function localMs(ymd: string, hm: string): number {
  const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi).getTime();
}

defineFeature(feature, (test) => {
  test('Format a date as dd-MM-yyyy', ({ given, when, then }) => {
    let ms = 0;
    let formatted = '';
    given(/^the date (.*) at (.*) local$/, (ymd: string, hm: string) => {
      ms = localMs(ymd, hm);
    });
    when('I format it for display', () => {
      formatted = formatDMY(ms);
    });
    then(/^the formatted date should be "(.*)"$/, (expected: string) => {
      expect(formatted).toBe(expected);
    });
  });

  test('Two times on the same calendar day are the same day', ({ given, and, then }) => {
    let first = 0;
    let second = 0;
    given(/^a first date (.*) at (.*) local$/, (ymd: string, hm: string) => {
      first = localMs(ymd, hm);
    });
    and(/^a second date (.*) at (.*) local$/, (ymd: string, hm: string) => {
      second = localMs(ymd, hm);
    });
    then('the two dates should be the same day', () => {
      expect(isSameDay(first, second)).toBe(true);
    });
  });

  test('Times either side of midnight are different days', ({ given, and, then }) => {
    let first = 0;
    let second = 0;
    given(/^a first date (.*) at (.*) local$/, (ymd: string, hm: string) => {
      first = localMs(ymd, hm);
    });
    and(/^a second date (.*) at (.*) local$/, (ymd: string, hm: string) => {
      second = localMs(ymd, hm);
    });
    then('the two dates should not be the same day', () => {
      expect(isSameDay(first, second)).toBe(false);
    });
  });

  test('Month label for the widget summary', ({ given, when, then }) => {
    let ms = 0;
    let label = '';
    given(/^the date (.*) at (.*) local$/, (ymd: string, hm: string) => {
      ms = localMs(ymd, hm);
    });
    when('I compute its month label', () => {
      label = monthLabel(ms);
    });
    then(/^the month label should be "(.*)"$/, (expected: string) => {
      expect(label).toBe(expected);
    });
  });
});
