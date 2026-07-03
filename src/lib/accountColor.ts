/**
 * Stable colour per account index, shared by the dashboard's trend chart, its
 * legend, and the coloured pin on each account row so a line maps to its account.
 */
import { colors } from '../theme/tokens';

const PALETTE = [
  colors.primary, // blue
  colors.positive, // green
  '#E08A4B', // orange
  colors.teal, // teal
  colors.negative, // red
  colors.primary2, // purple
  colors.gold, // amber
  '#4B9FE0', // sky
];

export function accountColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}
