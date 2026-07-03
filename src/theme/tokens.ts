/** Design tokens — the single source of truth for colours, spacing, type. */
export const darkColors = {
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

export const lightColors: ThemeColors = {
  bg: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EAEEF4',
  text: '#141823',
  muted: '#586273',
  primary: '#2F6BDD',
  primary2: '#6A45DE',
  positive: '#149158',
  negative: '#D63A56',
  border: '#DEE4ED',
  onAccent: '#FFFFFF',
  borderAccent: '#B7C6EC',
  surfaceBlue: '#E6EEFC',
  grape: '#9A3FD6',
  gold: '#CF9A1E',
  amber: '#BF6A1E',
  teal: '#1C8F84',
  chipIncome: '#DCF1E6',
  chipTransfer: '#DCE9FB',
  chipExpense: '#FBE1E8',
  grabHandle: '#C7CED8',
  deleteChipBg: '#FBE1E8',
  deleteIcon: '#D63A56',
  accent: '#0E8A4F',
  amountPosFg: '#149158',
  amountPosBg: '#DCF1E6',
  amountNegFg: '#D63A56',
  amountNegBg: '#FBE1E8',
  accChipCash: '#DCF1E6',
  accChipBank: '#DCE9FB',
  accChipCard: '#FBE1E8',
  accChipInvest: '#E7E1FB',
  iconMuted: '#8B95A4',
  controlBorder: '#B7C0CC',
};

export type ThemeColors = typeof darkColors;

// Static dark palette. Use only where useThemeColors() can't reach: non-React
// modules (avatar.ts, accountColor.ts), and brand-fixed avatar features that
// are intentionally theme-independent (XavierPet.tsx — dark pupils, white
// highlight). Everything else in components must use the useThemeColors() hook.
export const colors = darkColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

export const typography = {
  title: 28,
  heading: 20,
  body: 16,
  caption: 13,
};
