/**
 * How the on-device parse gets its amount (step 3), decided from the text
 * before the model is called. Pure and framework-free.
 *
 *  - `single`: the reading is unambiguous: exactly one candidate, and it is
 *    either marked as money by a symbol, code or currency word, or it is the
 *    only number in the whole text. Code supplies it; the model is not asked.
 *  - `choice`: anything else with a number in it. The model picks one of
 *    every plausible reading (a closed set, so it cannot invent one).
 *  - `model`: no digits that read as an amount, or a spelled-out number with
 *    no money-marked digit next to it ("dinner for 4, two hundred"): a closed
 *    set of digits cannot express a spelled number, so the model may answer
 *    freely, and its number is accepted only when the text has a spelled-out
 *    number (see fmParse.ts).
 */
import { AmountCandidate, readAmounts, spelledNumberEvidence } from './amountCandidates';

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
  const { candidates, offered, tokens } = readAmounts(text);
  if (offered.length === 0) return { mode: 'model' };
  const strong = candidates.some((c) => c.anchored);
  if (!strong && spelledNumberEvidence(text)) return { mode: 'model' };
  if (candidates.length === 1 && (strong || tokens === 1)) {
    return { mode: 'single', value: candidates[0]!.value };
  }
  return { mode: 'choice', values: capChoices(strong ? candidates : offered) };
}
