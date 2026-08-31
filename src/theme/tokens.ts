/** Design tokens — the single source of truth for colours, spacing, type. */
export const darkColors = {
  /**
   * The three jobs `surfaceAlt` used to do at once (Redline B3).
   *
   * The review asked us to "decide the role", but there was never one role to
   * decide: the same token painted the ghost Button (a control you press), the
   * SegmentedControl track (a well things sit inside) and TransactionRow's
   * chips (flat, read-only labels). Whichever single meaning we picked, a
   * third of the sites would have been wrong in a new way.
   *
   * Dark keeps its existing value for controls, which is what made dark read
   * correctly all along, and gains a genuinely darker well.
   */
  controlRaised: '#1F2530',
  wellRecessed: '#0B0E13',
  badgeFlat: '#12161D',

  /**
   * Depth, per theme. Elevation was never tokenised (Redline D3): the primary
   * glow was a five-property object hand-copied into six places across three
   * files, and the only other shadow in the app was written inline in
   * ContextMenu.
   *
   * The two themes express depth DIFFERENTLY, which is the whole reason this
   * has to be a token rather than a shared constant. Dark has luminance
   * headroom — surfaceAlt is genuinely lighter than surface, so a raised
   * control reads as raised without any shadow, and a heavy one would just
   * muddy it. Light has none: surface is already white, so nothing can be
   * lighter, and shadow is the only way to say "in front".
   */
  elevation: {
    /** A control lifted off the surface behind it. Near-nothing in dark,
     *  where the surface ladder already carries the meaning. */
    raised: {
      shadowColor: '#000000',
      shadowOpacity: 0.2,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    /** A menu or popover floating over the whole screen. Was inline in
     *  ContextMenu. */
    overlay: {
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 12,
    },
    /** The coloured glow under a primary FAB or Send button. shadowColor is
     *  left to the caller because it tracks `primary`, which differs per
     *  theme; everything else about the glow was identical in all six copies. */
    accentGlow: {
      shadowOpacity: 0.5,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
  },

  /**
   * Chart series colours, in order. Kept as an explicit list per theme rather
   * than assembled from the semantic tokens, because a chart series has a
   * different job and a different bar: it must clear 3:1 against the CARD it
   * is drawn on (WCAG non-text contrast), which two of the old entries did not
   * in light mode. Semantic tokens answer to text and chip requirements
   * instead, so borrowing them was what let dark-tuned hexes reach a white
   * card.
   *
   * Every entry is measured against its own theme's card colour; see the
   * scenarios in tests/__features__/chart-palette.feature.
   */
  chartPalette: [
    '#5B8DEF', // blue
    '#33C27F', // green
    '#E08A4B', // orange
    '#2BB6A8', // teal
    '#F2637E', // red
    '#7C5BEF', // purple
    '#E0B84B', // amber
    '#4B9FE0', // sky
  ],

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
  /** See darkColors. Light cannot express "raised" through luminance —
   *  surface is already pure white — so controlRaised is white and leans on
   *  elevation.raised for depth. The well keeps the old surfaceAlt value,
   *  which was always correct FOR A WELL and wrong only for controls. */
  controlRaised: '#FFFFFF',
  wellRecessed: '#EAEEF4',
  badgeFlat: '#EAEEF4',

  /** See darkColors.elevation. Light carries more of the work: with surface
   *  at pure white there is no lighter step available, so `raised` is a real
   *  shadow here rather than the token gesture it is in dark. */
  elevation: {
    raised: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.1,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    overlay: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 12,
    },
    accentGlow: {
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
  },

  /** Light-tuned series colours — see darkColors.chartPalette. The orange,
   *  amber and sky entries are materially darker than their dark-theme
   *  counterparts: at the dark values they measured 2.66, 2.53 and 2.86
   *  against a white card, all below the 3:1 floor. */
  chartPalette: [
    '#2F6BDD', // blue
    '#149158', // green
    '#BF6A1E', // orange
    '#1C8F84', // teal
    '#D63A56', // red
    '#6A45DE', // purple
    '#8A6D1F', // amber
    '#2A7FC4', // sky
  ],

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
  // The assistant's question role (Assistant home + /account Q&A responsive
  // scale — see useScaledType.ts and docs/design/responsive-scaling-spec.md).
  // Single source for the "prompt" role's base so the scale hook and this
  // token can't drift apart.
  prompt: 22,
};
