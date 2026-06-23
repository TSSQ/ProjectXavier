/**
 * Stable colour per account index, shared by the dashboard's trend chart, its
 * legend, and the coloured pin on each account row so a line maps to its account.
 */
const PALETTE = [
  '#5B8DEF', // blue
  '#33C27F', // green
  '#E08A4B', // orange
  '#2BB6A8', // teal
  '#F2637E', // red
  '#7C5BEF', // purple
  '#E0B84B', // amber
  '#4B9FE0', // sky
];

export function accountColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}
