/**
 * Stable colour per category, shared by the dashboard's donut charts and their
 * legends. Categories carry no persisted colour (see src/db/schema.ts — only
 * `icon`), so this always falls back to a palette index, keyed off a stable
 * sort of the category id so the same category keeps the same colour across
 * renders (both donut slices and legend swatches read from the same slice
 * order, so this only needs to be stable within one render — a simple
 * index-into-palette by render position is enough).
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

export function categoryColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}
