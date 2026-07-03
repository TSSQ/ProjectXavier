import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { darkColors, lightColors } from '../../src/theme/tokens';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/theme-tokens.feature')
);

// The exact dark values as they existed before Stage 2b (light mode) was
// added — copied from the pre-change tokens.ts. Dark must render pixel-
// identical, so this is a straight snapshot rather than a derived check.
const PRE_LIGHT_MODE_DARK_VALUES: Record<string, string> = {
  bg: '#0E1116',
  surface: '#171B22',
  surfaceAlt: '#1F2530',
  text: '#F2F5F9',
  muted: '#9AA4B2',
  primary: '#5B8DEF',
  primary2: '#7C5BEF',
  positive: '#33C27F',
  negative: '#F2637E',
  border: '#2A313C',
  onAccent: '#FFFFFF',
  borderAccent: '#33406E',
  surfaceBlue: '#1B2540',
  grape: '#B05BEF',
  gold: '#E0B84B',
  amber: '#E0884B',
  teal: '#2BB6A8',
  chipIncome: '#1C3A2E',
  chipTransfer: '#13314A',
  chipExpense: '#3A2330',
  grabHandle: '#3A414D',
  deleteChipBg: '#3A1F27',
  deleteIcon: '#F08AA0',
  accent: '#5FD497',
  amountPosFg: '#5FD497',
  amountPosBg: '#10301F',
  amountNegFg: '#F08AA0',
  amountNegBg: '#3A1F27',
  accChipCash: '#1C3A2E',
  accChipBank: '#13314A',
  accChipCard: '#3A2330',
  accChipInvest: '#2A2350',
  iconMuted: '#3A414D',
  controlBorder: '#3A414D',
};

defineFeature(feature, (test) => {
  test('Dark and light palettes define the same set of tokens', ({
    given,
    and,
    then,
  }) => {
    given('the dark theme palette', () => {
      // darkColors is imported directly.
    });
    and('the light theme palette', () => {
      // lightColors is imported directly.
    });
    then('both palettes should declare the same token keys', () => {
      const darkKeys = Object.keys(darkColors).sort();
      const lightKeys = Object.keys(lightColors).sort();
      expect(lightKeys).toEqual(darkKeys);
    });
  });

  test('Dark values are unchanged from before light mode was added', ({
    given,
    then,
  }) => {
    given('the dark theme palette', () => {
      // darkColors is imported directly.
    });
    then('the dark palette should match the pre-light-mode values', () => {
      expect(darkColors).toEqual(PRE_LIGHT_MODE_DARK_VALUES);
    });
  });
});
