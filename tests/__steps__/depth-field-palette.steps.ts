import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { fieldColorsForLook, mixHex } from '../../src/domain/depthField';
import { AVATAR_LOOKS, lookById } from '../../src/domain/avatar';

const feature = loadFeature(path.resolve(__dirname, '../__features__/depth-field-palette.feature'));

/** Relative luminance of an "rgba(r,g,b,a)" string, ignoring alpha. */
function luminance(rgba: string): number {
  const [r, g, b] = rgba
    .replace(/rgba?\(|\)/g, '')
    .split(',')
    .slice(0, 3)
    .map((v) => Number(v) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function alphaOf(rgba: string): number {
  const parts = rgba.replace(/rgba?\(|\)/g, '').split(',');
  return Number(parts[3]);
}

defineFeature(feature, (test) => {
  let wells: [string, string, string];
  let lookId: string;

  const whenRead = (when: any) =>
    when(
      /^I read the depth-field colours for "(.*)" in "(dark|light)"$/,
      (id: string, scheme: string) => {
        lookId = id;
        wells = fieldColorsForLook(lookById(id), scheme as 'dark' | 'light');
      }
    );
  const thenWellIs = (step: any) =>
    step(/^well (\d) should be "(.*)"$/, (n: string, expected: string) => {
      expect(wells[Number(n) - 1]).toBe(expected);
    });

  test("Dark wells are the look's own gradient stops", ({ when, then, and }) => {
    whenRead(when); thenWellIs(then); thenWellIs(and);
  });

  test('The third well is the midpoint of the two stops', ({ when, then }) => {
    whenRead(when);
    then('well 3 should be the midpoint hue of the look', () => {
      const look = lookById(lookId);
      const mid = mixHex(look.from, look.to, 0.5).replace('#', '');
      const rgb = [0, 2, 4].map((i) => parseInt(mid.slice(i, i + 2), 16));
      expect(wells[2]).toBe(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.12)`);
    });
  });

  test('Light wells use the handoff hue for the primary stop', ({ when, then }) => {
    whenRead(when); thenWellIs(then);
  });

  test('Every look is darker and weaker in light mode', ({ then, and }) => {
    then('for every look each light well should be darker than its dark well', () => {
      for (const look of AVATAR_LOOKS) {
        const dark = fieldColorsForLook(look, 'dark');
        const light = fieldColorsForLook(look, 'light');
        for (let i = 0; i < 3; i++) {
          expect(luminance(light[i] as string)).toBeLessThan(luminance(dark[i] as string));
        }
      }
    });
    and('for every look each light well should be less opaque than its dark well', () => {
      for (const look of AVATAR_LOOKS) {
        const dark = fieldColorsForLook(look, 'dark');
        const light = fieldColorsForLook(look, 'light');
        for (let i = 0; i < 3; i++) {
          expect(alphaOf(light[i] as string)).toBeLessThan(alphaOf(dark[i] as string));
        }
      }
    });
  });
});
