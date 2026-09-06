import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { settleMeasuredHeight } from '../../src/domain/layoutSettle';

const feature = loadFeature(path.resolve(__dirname, '../__features__/layout-settle.feature'));

defineFeature(feature, (test) => {
  let out: number;
  const whenReports = (when: any) =>
    when(/^the layout reports ([\d.]+)$/, (raw: string) => {
      out = settleMeasuredHeight(Number(raw));
    });
  const thenIs = (then: any) =>
    then(/^the settled height should be (\d+)$/, (h: string) => {
      expect(out).toBe(Number(h));
    });

  test('A measurement is rounded up to a whole point', ({ when, then }) => {
    whenReports(when); thenIs(then);
  });
  test('Sub-point jitter within the same point keys the same', ({ when, then }) => {
    whenReports(when); thenIs(then);
  });
  test('A taller layout produces a new height', ({ when, then }) => {
    whenReports(when); thenIs(then);
  });
});
