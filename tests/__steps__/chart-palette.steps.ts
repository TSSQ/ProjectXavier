import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { darkColors, lightColors } from '../../src/theme/tokens';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'chart-palette.feature')
);

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const parts = hex.replace('#', '').match(/../g)!.map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * parts[0]! + 0.7152 * parts[1]! + 0.0722 * parts[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

defineFeature(feature, (test) => {
  let palette: readonly string[];

  test('Every dark series colour clears 3:1 on a dark card', ({ given, then }) => {
    given('the dark chart palette', () => {
      palette = darkColors.chartPalette;
    });
    then(/^every colour should clear 3:1 against "(.*)"$/, (card: string) => {
      const failures = palette
        .map((hex) => ({ hex, ratio: contrast(hex, card) }))
        .filter((r) => r.ratio < 3);
      expect(failures).toEqual([]);
    });
  });

  test('Every light series colour clears 3:1 on a light card', ({ given, then }) => {
    given('the light chart palette', () => {
      palette = lightColors.chartPalette;
    });
    then(/^every colour should clear 3:1 against "(.*)"$/, (card: string) => {
      const failures = palette
        .map((hex) => ({ hex, ratio: contrast(hex, card) }))
        .filter((r) => r.ratio < 3);
      expect(failures).toEqual([]);
    });
  });

  test('The two palettes stay the same length', ({ given, then }) => {
    given('both chart palettes', () => undefined);
    then('they should have the same number of colours', () => {
      expect(lightColors.chartPalette.length).toBe(darkColors.chartPalette.length);
    });
  });

  test('The palettes are actually different', ({ given, then }) => {
    given('both chart palettes', () => undefined);
    // Guards the regression directly: if someone re-points one palette at the
    // other, or reintroduces the static `colors` import, this fails.
    then(/^at least three colours should differ between them$/, () => {
      const differing = darkColors.chartPalette.filter(
        (hex, i) => hex !== lightColors.chartPalette[i]
      );
      expect(differing.length).toBeGreaterThanOrEqual(3);
    });
  });
});
