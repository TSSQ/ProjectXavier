/** @type {import('tailwindcss').Config} */
// Design tokens live here as Tailwind theme values so className utilities map to
// the same palette as src/theme/tokens.ts (keep the two in sync).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
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
        positiveBright: '#5FD497',
        grape: '#B05BEF',
        gold: '#E0B84B',
        amber: '#E0884B',
        teal: '#2BB6A8',
        chipIncome: '#1C3A2E',
        chipTransfer: '#13314A',
        chipExpense: '#3A2330',
        grabHandle: '#3A414D', // Stage 2: needs a light value
        deleteChipBg: '#3A1F27', // Stage 2: needs a light value
        deleteIcon: '#F08AA0', // Stage 2: needs a light value
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
