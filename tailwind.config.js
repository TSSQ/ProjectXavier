/** @type {import('tailwindcss').Config} */
// Design tokens live here as Tailwind theme values so className utilities map to
// the same palette as src/theme/tokens.ts (keep the two in sync).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
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
