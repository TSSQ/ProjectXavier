/** @type {import('tailwindcss').Config} */
// Design tokens live here as Tailwind theme values so className utilities map to
// the same palette as src/theme/tokens.ts (keep the two in sync). Values point
// at CSS custom properties (see global.css) so NativeWind's colour-scheme
// toggle re-themes every className consumer for free.
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require('nativewind/preset')],
  theme: {
    // REPLACES Tailwind's radius scale rather than extending it. While it was
    // under `extend`, rounded-xl/2xl/3xl/full and bare rounded all still
    // resolved to Tailwind's defaults, so the app shipped 12px, 16px, 24px and
    // 4px radii that exist nowhere in the design language — and three
    // different corner radii on bottom sheets alone.
    //
    // Note this does NOT make an off-scale class a build error: Tailwind emits
    // nothing for a utility outside its scale, so a stray `rounded-xl` now
    // renders with square corners and no warning. The guard is the scenario in
    // tests/__features__/radius-scale.feature, which greps the source.
    borderRadius: {
      none: '0px',
      sm: '8px',
      md: '14px',
      lg: '22px',
      pill: '999px',
    },
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        surfaceAlt: 'var(--color-surfaceAlt)',
        controlRaised: 'var(--color-controlRaised)',
        wellRecessed: 'var(--color-wellRecessed)',
        badgeFlat: 'var(--color-badgeFlat)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        primary: 'var(--color-primary)',
        primaryFill: 'var(--color-primaryFill)',
        primary2: 'var(--color-primary2)',
        positive: 'var(--color-positive)',
        negative: 'var(--color-negative)',
        border: 'var(--color-border)',
        onAccent: 'var(--color-onAccent)',
        borderAccent: 'var(--color-borderAccent)',
        surfaceBlue: 'var(--color-surfaceBlue)',
        grape: 'var(--color-grape)',
        gold: 'var(--color-gold)',
        amber: 'var(--color-amber)',
        teal: 'var(--color-teal)',
        chipIncome: 'var(--color-chipIncome)',
        chipTransfer: 'var(--color-chipTransfer)',
        chipExpense: 'var(--color-chipExpense)',
        grabHandle: 'var(--color-grabHandle)',
        deleteChipBg: 'var(--color-deleteChipBg)',
        deleteIcon: 'var(--color-deleteIcon)',
        amountPosFg: 'var(--color-amountPosFg)',
        amountPosBg: 'var(--color-amountPosBg)',
        amountNegFg: 'var(--color-amountNegFg)',
        amountNegBg: 'var(--color-amountNegBg)',
        accChipCash: 'var(--color-accChipCash)',
        accChipBank: 'var(--color-accChipBank)',
        accChipCard: 'var(--color-accChipCard)',
        accChipInvest: 'var(--color-accChipInvest)',
        iconMuted: 'var(--color-iconMuted)',
        controlBorder: 'var(--color-controlBorder)',
      },
    },
  },
  plugins: [],
};
