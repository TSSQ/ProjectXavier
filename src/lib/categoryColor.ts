/**
 * Stable colour per category, shared by the dashboard's donut charts and their
 * legends. Categories carry no persisted colour (see src/db/schema.ts — only
 * `icon`), so this always falls back to a palette index, keyed off a stable
 * sort of the category id so the same category keeps the same colour across
 * renders (both donut slices and legend swatches read from the same slice
 * order, so this only needs to be stable within one render — a simple
 * index-into-palette by render position is enough).
 */
import { ThemeColors } from '../theme/tokens';

/** Theme-resolved, for the same reason as accountColor — see that file. */
export function categoryColor(index: number, c: ThemeColors): string {
  const p = c.chartPalette;
  return p[((index % p.length) + p.length) % p.length]!;
}
