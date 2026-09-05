/**
 * The row-snippet window — how much of the scanned photo a draft card shows,
 * and where (docs/design/row-snippet-spec.md §4.4). This is domain logic,
 * not view code: it decides what the user is shown of their own photo, and
 * QA proved (round 1, D4) that a naive top-anchored clip can hide the amount
 * entirely on a real fixture. It therefore lives in a framework-free module
 * the plain-Node BDD suite can test directly — `RowSnippet.tsx` is a thin
 * renderer over `computeSnippetWindow`, with no arithmetic of its own.
 *
 * All input/output geometry is normalised (0..1, top-left origin), the same
 * space as `SourceBand`/`OcrObservation`, except `dispW`/`dispH`/`translateX`/
 * `translateY`/`height`, which are pixels for the given `containerWidth`.
 */
import { SourceBand, unionBand } from './statementLayout';

export interface SnippetWindowInput {
  /** The whole row's band. */
  band: SourceBand;
  /** The band of just the line carrying the amount — must stay visible. */
  amountBand: SourceBand;
  /** Card width in px, from the container's onLayout. */
  containerWidth: number;
  /** The scanned photo's PIXEL dimensions (from the picker asset) — needed
   *  because `band.w`/`band.h` are normalised against different axes. */
  image: { width: number; height: number };
  /** Px cap on the strip's rendered height. */
  maxHeight: number;
}

export interface SnippetWindow {
  /** Full-image display width/height at this card's scale, in px. */
  dispW: number;
  dispH: number;
  /** Offsets (px, negative) to apply to the full-size Image so the visible
   *  window lands at the container's origin. */
  translateX: number;
  translateY: number;
  /** The container's rendered height, in px — always <= maxHeight. */
  height: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Two `SourceBand` rectangles → their union, reusing `statementLayout.ts`'s
 *  own `unionBand` reduction (adapted from x/y/w/h to the top/bottom/left/
 *  right shape it expects) rather than a second copy of the same min/max
 *  logic. */
function unionRect(a: SourceBand, b: SourceBand): SourceBand {
  const toLine = (r: SourceBand) => ({ top: r.y, bottom: r.y + r.h, left: r.x, right: r.x + r.w });
  return unionBand([toLine(a), toLine(b)]);
}

/** `band` grown vertically by 0.15×band.h on EACH side (0.3×h total),
 *  clamped back into 0..1 — guardrail 6: the band itself already comes from
 *  zod-bounded (0..1) observations, but padding can push it out of range. */
function paddedBand(band: SourceBand): SourceBand {
  const pad = 0.15 * band.h;
  const top = clamp01(band.y - pad);
  const bottom = clamp01(band.y + band.h + pad);
  const left = clamp01(band.x);
  const right = clamp01(band.x + band.w);
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/** Computes the strip a `RowSnippet` should show: the whole padded band when
 *  it fits within `maxHeight`, or a `maxHeight`-tall window bottom-aligned
 *  to the amount line when it doesn't (row-snippet-spec.md §4.4, D4) — a
 *  statement row's amount sits on its block's LAST line, so a naive
 *  top-anchored clip hides exactly what the user opened the card to check. */
export function computeSnippetWindow(input: SnippetWindowInput): SnippetWindow | null {
  const { amountBand, containerWidth, image, maxHeight } = input;
  // Defensive union at the boundary: `amountBand` is documented as a
  // subset of `band` (SnippetWindowInput), but the window-top guarantee
  // below only holds if `padded.y <= amountBand.y` — and that in turn only
  // holds if `band` genuinely contains `amountBand`. This function's own
  // correctness shouldn't depend on every caller honouring that premise
  // (round 2's bug was exactly a caller that didn't) — unioning `band` with
  // `amountBand` here guarantees containment regardless of what the caller
  // passed as `band`.
  const band = unionRect(input.band, amountBand);
  if (containerWidth <= 0 || image.width <= 0 || image.height <= 0) return null;
  if (band.w <= 0 || band.h <= 0) return null;

  const padded = paddedBand(band);
  if (padded.w <= 0 || padded.h <= 0) return null;

  const dispW = containerWidth / padded.w;
  const dispH = dispW * (image.height / image.width); // preserve pixel aspect
  const full = padded.h * dispH; // height if nothing were clipped

  const translateX = -padded.x * dispW;

  if (full <= maxHeight) {
    return { dispW, dispH, translateX, translateY: -padded.y * dispH, height: full };
  }

  // Too tall: bottom-align the visible window to the amount line, so the
  // number and as much of the description above it as fits stay visible.
  //
  // The upper clamp bound is `amountBand.y` — the amount line's own top —
  // and NOTHING else. `windowTop` (and so the visible window's top edge)
  // can therefore never sit below `amountBand.y`: whatever room is left
  // after fitting `maxHeight` above `amountBottom` is given to the
  // description first, and the amount's own top is the last thing ever
  // sacrificed. (History of why this bound is written exactly this way —
  // it previously carried the row's own padding term and could clip into
  // the amount — is in row-snippet-spec.md's D-section, not here.)
  //
  // Mathematical floor (criterion 2c-ii) — a LIMITATION, not a guarantee:
  // when `amountBand.h * dispH` alone exceeds `maxHeight`, the amount
  // cannot be shown in full no matter where the window is anchored —
  // filling `containerWidth` from a narrow `padded.w` blows `dispH` up
  // arbitrarily. `windowTop` is still clamped to `amountBand.y` in this
  // case, so the amount's TOP edge is what stays visible and its bottom is
  // what gets cut off — never the reverse — but the full line is not
  // guaranteed. No fixture reaches this (narrowest real bank1/ocbc
  // `band.w` is 0.798), so this isn't contorted around.
  const pad = 0.15 * band.h;
  const amountBottom = Math.min(amountBand.y + amountBand.h + pad, 1);
  const windowTop = clamp(amountBottom - maxHeight / dispH, padded.y, amountBand.y);
  return { dispW, dispH, translateX, translateY: -windowTop * dispH, height: maxHeight };
}
