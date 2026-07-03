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
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        surfaceAlt: 'var(--color-surfaceAlt)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        primary: 'var(--color-primary)',
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
        accent: 'var(--color-accent)',
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
      borderRadius: {
        sm: '8px',
        md: '14px',
        lg: '22px',
        pill: '999px',
      },
    },
  },
  plugins: [],
};
