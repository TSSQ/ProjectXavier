/**
 * The on-device (Foundation Models) expense parse, step 3: the model decides
 * whether the text is a transaction (`isTransaction`, its first field) and
 * picks what only it can (category, payee, type where the words leave it
 * open...), while code reads the amount wherever it can and the type where the
 * words decide it (./signReader). One module so the app (src/features/ai/deviceParse.ts)
 * and the eval harness (evals/fm/pipeline.mjs) run the identical logic.
 *
 * Per text, `planFmAmount` (fmAmountPlan.ts) yields one of three plans, and
 * each has its own schema:
 *   - `single`: no `amount` field at all; code supplies the amount;
 *   - `choice`: `amount` is a closed enum of the candidates found in the text;
 *   - `model`: `amount` is a free number, trusted only if the text supports it.
 *
 * Framework-free, so the plain-node BDD suite covers it.
 */
import { z } from 'zod';
import { aiParsedExpenseSchema, AiParsedExpense } from '../lib/validation';
import {
  deviceParseFmSchema,
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  resolveTypedDate,
} from './deviceParsePrompt';
import { candidateLabel, spelledReadings } from './amountCandidates';
import { FmAmountPlan } from './fmAmountPlan';
import { affirmsTransaction, AffirmationReason } from './fmRefusal';
import { resolveSign, isTransactionKindWord } from './signReader';
import { Account } from './types';

/** A validated parse plus the model's log-or-refuse verdict. `isTransaction:
 *  false` always comes with a null `amount`. `affirmed` is set when the model
 *  said false and code overrode it as a cold-start miss (`affirmsTransaction`,
 *  ./fmRefusal); then `isTransaction` is true and the amount is code's. */
export type FmDeviceParse = AiParsedExpense & { isTransaction: boolean; affirmed?: AffirmationReason };

/** The zod schema the model's output is validated against for `plan`. */
export function fmParseSchemaFor(plan: FmAmountPlan): z.ZodObject<z.ZodRawShape> {
  if (plan.mode === 'single') return deviceParseFmSchema.omit({ amount: true });
  if (plan.mode === 'choice') {
    const labels = plan.values.map(candidateLabel) as [string, ...string[]];
    return deviceParseFmSchema.extend({
      amount: z
        .enum(labels)
        .describe('Which of the amounts listed in the prompt is the money that moved, copied exactly.'),
    });
  }
  return deviceParseFmSchema;
}

/** The amount (major units) to hand to `normalizeDeviceParseOutput`, or 0 for
 *  "none". Code wins wherever it found a candidate; the model's own number is
 *  accepted only when the text supports it - a spelled-out amount the extractor
 *  does not read - so an amount invented for text with no number is dropped. */
export function resolveFmAmount(plan: FmAmountPlan, modelAmount: unknown, text: string): number {
  if (plan.mode === 'single') return plan.value;
  if (plan.mode === 'choice') {
    return plan.values.find((v) => candidateLabel(v) === modelAmount) ?? 0;
  }
  if (typeof modelAmount !== 'number') return 0;
  // No reading in the text: the model's number counts only if a spelled-out
  // phrase has that value ("two hundred" -> 200), never an invented one.
  return spelledReadings(text).some((c) => Math.abs(c.value - modelAmount) < 1e-6) ? modelAmount : 0;
}

/**
 * Everything after `generateObject` for one attempt: resolve the amount,
 * normalize, apply the grounding guards, date it from the user's own words
 * (else today - never the model's), decide the type where the words do
 * (`resolveSign`, ./signReader: a leading `+`, received/refund/paid/bought/...,
 * a transfer only with an own-account reference; a model `transfer` nothing
 * supports becomes an expense), drop a payee that is only a transaction-kind
 * word ("payday", "gift"), and re-validate (guardrail #6). A model refusal that
 * `affirmsTransaction` (./fmRefusal) reads as a cold-start miss is kept as a
 * transaction with the code-read amount. `accounts` are the user's own accounts
 * (the transfer rule); optional for callers without them. Returns null when
 * the result does not survive validation.
 */
export function finishFmParse(
  object: Record<string, unknown>,
  text: string,
  plan: FmAmountPlan,
  now: number,
  currency: string,
  accounts: readonly Account[] = []
): FmDeviceParse | null {
  // The verdict is strict: anything but a boolean is a malformed answer (null,
  // so the attempt counts as failed), never a refusal.
  if (typeof object.isTransaction !== 'boolean') return null;
  const affirmed = object.isTransaction ? null : affirmsTransaction(text, plan);
  const isTransaction = object.isTransaction || affirmed != null;
  const amount = isTransaction ? resolveFmAmount(plan, object.amount, text) : 0;
  const raw = { ...object, amount };
  const normalized = applyGroundingGuards(normalizeDeviceParseOutput(raw, currency), text, currency);
  normalized.occurredAt = resolveTypedDate(text, now) ?? now;
  if (isTransaction) {
    normalized.type = resolveSign(text, normalized.type, accounts).type;
    if (normalized.payee && isTransactionKindWord(normalized.payee)) normalized.payee = null;
  }
  const validated = aiParsedExpenseSchema.safeParse(normalized);
  if (!validated.success) return null;
  return { ...validated.data, isTransaction, ...(affirmed ? { affirmed } : {}) };
}
