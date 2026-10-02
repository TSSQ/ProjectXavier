/**
 * How the on-device parse gets its amount (step 3), decided from the text
 * before the model is called. Pure and framework-free.
 *
 *  - `single`: the reading is unambiguous. Code supplies the amount and the
 *    model is not asked. That is when the text has exactly one firm reading in
 *    total (counted before the money-marked filter, so a "$3 tip" next to an
 *    unmarked price is two readings; masked dates, ids, counts like "3 hours"
 *    and label-like integers like "room 204" are not readings), or only one
 *    number token at all. A one-value choice is also single: nothing to choose.
 *  - `choice`: anything else with a number. The model picks one of every
 *    plausible reading, digits and spelled-out ("two hundred", "two fifty" as
 *    both 2.50 and 250) alike - a closed set, so it cannot invent a number.
 *  - `model`: no digit reading (a spelled-out number alone is not enough to
 *    commit to). The model's number is then accepted only if it
 *    equals a spelled-out phrase's value (fmParse.ts); otherwise there is no amount.
 */
import { AmountCandidate, readAmounts, spelledReadings } from './amountCandidates';

/** More candidates than this are not a useful closed set for a small model. */
export const MAX_AMOUNT_CHOICES = 8;

export type FmAmountPlan =
  | { mode: 'model' }
  | { mode: 'single'; value: number }
  | { mode: 'choice'; values: number[] };

/** At most MAX_AMOUNT_CHOICES values: money-marked ones first, then the largest
 *  (a small stray number is likelier a count than the spend), then back in
 *  reading order. */
function capChoices(list: AmountCandidate[]): number[] {
  if (list.length <= MAX_AMOUNT_CHOICES) return list.map((c) => c.value);
  return [...list]
    .sort((a, b) => Number(b.anchored) - Number(a.anchored) || b.value - a.value)
    .slice(0, MAX_AMOUNT_CHOICES)
    .sort((a, b) => a.index - b.index)
    .map((c) => c.value);
}

export function planFmAmount(text: string): FmAmountPlan {
  const { candidates, offered, tokens, firmCount } = readAmounts(text);
  const spelled = spelledReadings(text);
  const byValue = new Map<number, AmountCandidate>();
  for (const c of [...offered, ...spelled]) if (!byValue.has(c.value)) byValue.set(c.value, c);
  const readings = [...byValue.values()].sort((a, b) => a.index - b.index);
  // Spelled-out numbers alone never make a single: "ten pin bowling" must not
  // log 10. The model decides there, and fmParse.ts holds it to the spelled values.
  if (offered.length === 0) return { mode: 'model' };
  if (readings.length === 1) return { mode: 'single', value: readings[0]!.value };
  if (spelled.length === 0 && candidates.length === 1 && (firmCount === 1 || tokens === 1)) {
    return { mode: 'single', value: candidates[0]!.value };
  }
  return { mode: 'choice', values: capChoices(readings) };
}
