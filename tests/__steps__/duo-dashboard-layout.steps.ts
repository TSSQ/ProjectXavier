import fs from 'fs';
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
  tableScenario('One point over the threshold rounds the summary column to nearest');
  tableScenario('A very wide screen caps the tile ring at the donut maximum');
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

describe('dashboard pager ref guard', () => {
  // NativeWind's interop wrapper re-renders RN 0.81+'s function-component
  // ScrollView with `{...props, ref: undefined}`, which drops React 19's
  // ref-as-prop. Without `cssInterop={false}` the pager's callback ref never
  // attaches, so the fold/unfold re-seat in onPagerLayout silently never runs
  // (found on the Duo simulator, PR #78; same failure as the Payees A–Z rail
  // and Combobox). Nothing in the Node suite renders views, hence a source
  // guard, like tests/__steps__/alpha-index.steps.ts.
  it('the chart pager ScrollView opts out of css interop and keeps its ref', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/dashboard.tsx'), 'utf8');
    const pager = src.match(/<ScrollView\s[^>]*pagingEnabled[^>]*>/);
    expect(pager).not.toBeNull();
    expect(pager![0]).toMatch(/ref=\{setPagerRef\}/);
    expect(pager![0]).toMatch(/cssInterop=\{false\}/);
    expect(pager![0]).toMatch(/onLayout=\{onPagerLayout\}/);
    // The prop, not the comment that explains why it is absent.
    expect(pager![0]).not.toMatch(/contentOffset=\{/);
  });
});
