/**
 * How the on-device parse gets its amount (step 3), decided from the text
 * before the model is called. Pure and framework-free.
 *
 *  - `single`: exactly one plausible amount in the text. Code supplies it; the
 *    model is never asked for it.
 *  - `choice`: several. The model picks one from this closed set.
 *  - `model`: none found (no digits, or only dates/times/ids, or a spelled-out
 *    number the extractor does not read). The model may answer, but its amount
 *    is accepted only when the text supports it (see fmParse.ts).
 */
import { extractAmountCandidates } from './amountCandidates';

/** More candidates than this are not a useful closed set for a small model. */
export const MAX_AMOUNT_CHOICES = 8;

export type FmAmountPlan =
  | { mode: 'model' }
  | { mode: 'single'; value: number }
  | { mode: 'choice'; values: number[] };

export function planFmAmount(text: string): FmAmountPlan {
  const values = extractAmountCandidates(text)
    .map((c) => c.value)
    .slice(0, MAX_AMOUNT_CHOICES);
  if (values.length === 0) return { mode: 'model' };
  if (values.length === 1) return { mode: 'single', value: values[0]! };
  return { mode: 'choice', values };
}
