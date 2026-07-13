import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  computeWidthFactor,
  clampFontScale,
  scaledSize,
  widthTier,
  byWidth,
  WidthTiered,
  AVATAR_IDLE,
  AVATAR_FLOW,
  QUICK_CHIP_HEIGHT,
  CHIP_HEIGHT,
  COMPOSER_HEIGHT,
  SCREEN_PADDING,
  DOT_SIZE,
  ROLE_BASE,
  ScaleRole,
} from '../../src/domain/scaleMath';

const feature = loadFeature(path.resolve(__dirname, '../__features__/scale-math.feature'));

/** Scenario table-name → the actual width-tiered table it exercises, so a
 *  transposed table entry (e.g. swapping the chip-height SE/Pro-Max values
 *  and silently un-fixing the 44pt touch target) fails here instead of only
 *  showing up on a simulator screenshot. */
const TABLES: Record<string, WidthTiered> = {
  'avatar idle size': AVATAR_IDLE,
  'avatar flow size': AVATAR_FLOW,
  'quick chip height': QUICK_CHIP_HEIGHT,
  'chip height': CHIP_HEIGHT,
  'composer height': COMPOSER_HEIGHT,
  'screen padding': SCREEN_PADDING,
  'dot size': DOT_SIZE,
};

defineFeature(feature, (test) => {
  test('Width factor scales with screen width and clamps to [0.94, 1.12]', ({ then }) => {
    then(/^the width factor for screen width (\d+) should be ([\d.]+)$/, (width: string, factor: string) => {
      // Precision 3 (±0.0005) pins the /390 divisor tightly enough that a
      // typo (e.g. /400) — which shifts every non-clamped value by several
      // hundredths — would fail here, while still tolerating the last digit
      // of the doc's own 4-decimal rounding.
      expect(computeWidthFactor(parseInt(width, 10))).toBeCloseTo(parseFloat(factor), 3);
    });
  });

  test('Font scale clamps to [0.85, 1.60]', ({ then }) => {
    then(/^the clamped font scale for raw font scale ([\d.]+) should be ([\d.]+)$/, (raw: string, scale: string) => {
      expect(clampFontScale(parseFloat(raw))).toBeCloseTo(parseFloat(scale), 5);
    });
  });

  test('Scaled size rounds base × widthFactor × fontScale for the role ramp', ({ then }) => {
    then(
      /^the scaled size for base (\d+), width factor ([\d.]+), font scale ([\d.]+) should be (\d+)$/,
      (base: string, widthFactor: string, fontScale: string, size: string) => {
        expect(
          scaledSize(parseInt(base, 10), parseFloat(widthFactor), parseFloat(fontScale))
        ).toBe(parseInt(size, 10));
      }
    );
  });

  test('Width-tiered spacing/touch-target tables pick the right SE/15/Pro Max entry', ({ then }) => {
    then(
      /^the (.+) for screen width (\d+) should be (\d+)$/,
      (table: string, width: string, value: string) => {
        expect(byWidth(parseInt(width, 10), TABLES[table]!)).toBe(parseInt(value, 10));
      }
    );
  });

  test('Width tier switches exactly at its breakpoints', ({ then }) => {
    then(/^the width tier for screen width (\d+) should be (\d)$/, (width: string, tier: string) => {
      expect(widthTier(parseInt(width, 10))).toBe(parseInt(tier, 10));
    });
  });

  test('Boundary widths land on the correct side of a width-tiered table', ({ then }) => {
    then(
      /^the (.+) for screen width (\d+) should be (\d+)$/,
      (table: string, width: string, value: string) => {
        expect(byWidth(parseInt(width, 10), TABLES[table]!)).toBe(parseInt(value, 10));
      }
    );
  });

  test('Each type-ramp role has its documented base at the 390pt reference width', ({ then }) => {
    then(/^the base for role (\w+) should be (\d+)$/, (role: string, base: string) => {
      expect(ROLE_BASE[role as ScaleRole]).toBe(parseInt(base, 10));
    });
  });
});
