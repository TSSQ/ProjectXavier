/**
 * Depth-field palette — the background wells take their hues from the
 * avatar's own look, so the ambient gradient behind the app is the colour of
 * Xavier rather than a fixed blue/violet/green (requested 2026-09-06).
 *
 * Three wells: the look's two gradient stops plus their midpoint, at the
 * alphas the glass tokens already used. Light mode needs darker, weaker
 * hues (see docs/design/design_handoff_light_mode — glows tighten on white):
 * `glowLight` is the handoff's value for the look's primary hue, and the
 * other two take the same direction via `darkenForLight`.
 *
 * Framework-free so the BDD suite can pin it.
 */
import { AvatarLook } from './avatar';

/** Alpha per well, brightest first. Dark keeps the original token values. */
const DARK_ALPHAS = [0.2, 0.18, 0.12] as const;
const LIGHT_ALPHAS = [0.14, 0.12, 0.1] as const;

/** What light-mode hues are mixed toward — the dark palette's near-black. */
const LIGHT_MIX_TARGET = '#0E1116';
const LIGHT_MIX_AMOUNT = 0.3;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix of two hex colours; `amount` is how far to move from a to b. */
export function mixHex(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const at = 1 - amount;
  return toHex([ar * at + br * amount, ag * at + bg * amount, ab * at + bb * amount]);
}

/** The light-mode treatment for a hue that has no explicit handoff value. */
export function darkenForLight(hex: string): string {
  return mixHex(hex, LIGHT_MIX_TARGET, LIGHT_MIX_AMOUNT);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The three well colours for a look, brightest first. */
export function fieldColorsForLook(
  look: AvatarLook,
  scheme: 'dark' | 'light'
): [string, string, string] {
  const midpoint = mixHex(look.from, look.to, 0.5);
  const hues: [string, string, string] =
    scheme === 'dark'
      ? [look.from, look.to, midpoint]
      : [look.glowLight, darkenForLight(look.to), darkenForLight(midpoint)];
  const alphas = scheme === 'dark' ? DARK_ALPHAS : LIGHT_ALPHAS;
  return [rgba(hues[0], alphas[0]), rgba(hues[1], alphas[1]), rgba(hues[2], alphas[2])];
}
