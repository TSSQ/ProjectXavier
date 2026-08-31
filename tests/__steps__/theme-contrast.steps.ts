import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { darkColors, lightColors } from '../../src/theme/tokens';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'theme-contrast.feature')
);

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
  const clears = (then: any) =>
    then(/^"(.*)" on "(.*)" should clear (.*)$/, (fg: string, bg: string, need: string) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(Number(need));
    });

  test('White text on a primary fill is readable, dark', ({ then }) => {
    clears(then);
    expect(darkColors.primaryFill).toBe('#3E6FD4');
  });
  test('White text on a primary fill is readable, light', ({ then }) => {
    clears(then);
    expect(lightColors.primaryFill).toBe('#2F6BDD');
  });
  test('Primary as text on a dark card is readable', ({ then }) => {
    clears(then);
    expect(darkColors.primary).toBe('#5B8DEF');
  });
  test('Primary as text on a light card is readable', ({ then }) => {
    clears(then);
    expect(lightColors.primary).toBe('#2F6BDD');
  });
  test('The two values are genuinely different in dark', ({ then }) => {
    then('the dark fill and text values should differ', () => {
      expect(darkColors.primaryFill).not.toBe(darkColors.primary);
      // And each fails the OTHER job — which is why one value cannot serve both.
      expect(contrast('#FFFFFF', darkColors.primary)).toBeLessThan(4.5);
      expect(contrast(darkColors.primaryFill, '#171B22')).toBeLessThan(4.5);
    });
  });
});
