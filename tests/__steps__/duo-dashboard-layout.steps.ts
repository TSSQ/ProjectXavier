import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  COLUMN_GAP,
  GRID_GAP,
  DashboardLayout,
  dashboardLayout,
} from '../../src/domain/dashboardLayout';

const feature = loadFeature(path.resolve(__dirname, '../__features__/duo-dashboard-layout.feature'));

/** "354", "-50", "NaN" or "Infinity" from the feature text, as a number. */
const num = (s: string): number => Number(s);

defineFeature(feature, (test) => {
  let layout: DashboardLayout;

  const whenLayout = (when: (re: RegExp, fn: (w: string) => void) => void) =>
    when(/^I lay out the dashboard for a content width of (-?[\d.]+|NaN|Infinity)$/, (w) => {
      layout = dashboardLayout(num(w));
    });
  const thenColumns = (then: (re: RegExp, fn: (n: string) => void) => void) =>
    then(/^the dashboard should have (1|2) columns?$/, (n) => {
      expect(layout.columns).toBe(Number(n));
    });
  const widthStep = (
    and: (re: RegExp, fn: (v: string) => void) => void,
    label: string,
    key: keyof DashboardLayout
  ) =>
    and(new RegExp(`^the ${label} should be (\\d+)$`), (v) => {
      expect(layout[key]).toBe(Number(v));
    });

  const allWidths = (and: (re: RegExp, fn: (v: string) => void) => void) => {
    widthStep(and, 'left width', 'leftWidth');
    widthStep(and, 'right width', 'rightWidth');
    widthStep(and, 'tile width', 'tileWidth');
    widthStep(and, 'tile content width', 'tileContentWidth');
    widthStep(and, 'tile donut', 'tileDonut');
  };

  const tableScenario = (title: string) =>
    test(title, ({ when, then, and }) => {
      whenLayout(when);
      thenColumns(then);
      allWidths(and);
    });

  tableScenario('iPhone 17 Pro in portrait stays on one column');
  tableScenario('Duo cover display with the rail on the right stays on one column');
  tableScenario('Duo Split View half stays on one column');
  tableScenario('Duo open display in portrait splits into two columns');
  tableScenario(
    'Duo open display in landscape with the rail on the right splits into two columns'
  );
  tableScenario('One point short of the threshold is still one column');
  tableScenario('Exactly the threshold is two columns');
  tableScenario('A negative width is one empty column');
  tableScenario('A NaN width is one empty column');
  tableScenario('An infinite width is treated as zero');

  test('The two columns and their gap add up to the content width', ({ when, then, and }) => {
    whenLayout(when);
    thenColumns(then);
    and(/^the left width plus the column gap plus the right width should be (\d+)$/, (v) => {
      expect(layout.leftWidth + COLUMN_GAP + layout.rightWidth).toBe(Number(v));
    });
    and(/^two tiles plus the grid gap should fit inside the right width$/, () => {
      expect(layout.tileWidth * 2 + GRID_GAP).toBeLessThanOrEqual(layout.rightWidth);
    });
  });
});
