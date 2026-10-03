/** Where each segment of a budget bar sits (pure; BudgetBar draws it). */

export interface BarGeometry {
  /** Each is a 0..1 share of the track. */
  fill: number;
  scheduledStart: number;
  scheduled: number;
  ghostStart: number;
  ghost: number;
  /** The ghost runs past the end of the track: draw the cap line. A purchase
   *  that exactly fills what is left fits, so it is not capped. */
  capped: boolean;
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Where each segment sits. The solid fill is clamped at the track's end (an
 *  over-budget category is a full bar), the scheduled segment takes what is
 *  left after it, and the ghost starts where the committed amount ends and is
 *  clamped at 100% — with `capped` set when the purchase does not fit. */
export function barGeometry(args: {
  budget: number;
  spent: number;
  scheduled?: number;
  ghostAmount?: number | null;
}): BarGeometry {
  const { budget } = args;
  if (budget <= 0) {
    return { fill: 0, scheduledStart: 0, scheduled: 0, ghostStart: 0, ghost: 0, capped: false };
  }
  const fill = clamp01(args.spent / budget);
  const scheduled = Math.min(1 - fill, clamp01((args.scheduled ?? 0) / budget));
  const ghostStart = clamp01((args.spent + (args.scheduled ?? 0)) / budget);
  const wanted = args.ghostAmount ? args.ghostAmount / budget : 0;
  const ghost = Math.min(1 - ghostStart, Math.max(0, wanted));
  return {
    fill,
    scheduledStart: fill,
    scheduled,
    ghostStart,
    ghost,
    capped: args.ghostAmount != null && ghostStart + wanted > 1,
  };
}
