/**
 * Stable colour per account index, shared by the dashboard's trend chart, its
 * legend, and the coloured pin on each account row so a line maps to its account.
 */
import { ThemeColors } from '../theme/tokens';

/**
 * The palette is taken from the RESOLVED theme, not imported statically.
 *
 * This module used to `import { colors }`, which is a hard alias for
 * darkColors — so every trend line, donut slice, legend swatch and account pin
 * painted a dark-tuned hex onto a white card in light mode. The dark amber
 * measured 2.53:1 there against a 3:1 floor. tokens.ts already warned that the
 * static export is "for use only where useThemeColors() can't reach"; a
 * non-React module cannot call the hook, so the palette is passed in instead.
 */
export function accountColor(index: number, c: ThemeColors): string {
  const p = c.chartPalette;
  return p[((index % p.length) + p.length) % p.length]!;
}
