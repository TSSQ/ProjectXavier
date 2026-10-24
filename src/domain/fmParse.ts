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
  slotNote,
} from './deviceParsePrompt';
import { candidateLabel, spelledReadings } from './amountCandidates';
import { FmAmountPlan } from './fmAmountPlan';
import { affirmsTransaction, AffirmationReason } from './fmRefusal';
import { resolveSign, isTransactionKindWord } from './signReader';
import { readSlots } from './slotReader';
import { pickPayee, resolveSlotPayee } from './slotPayee';
import { categoryFromPurpose, isUsersCategory } from './slotCategory';
import { PhraseMemoryRow } from './phraseMemory';
import { Account, Category, Payee } from './types';
import { normalizeName } from './textMatch';

/** A field the slot reader (./slotReader) set: `type` from who gave to whom,
 *  `payee` from the person slot, `category` and `note` from the purpose tail
 *  ("for lunch"). Recorded on the correction capture as `slot:<field>`
 *  (`appliedDefaultsOf`, ./correctionEdits). */
export type SlotField = 'type' | 'payee' | 'category' | 'note';

/** A validated parse plus the model's log-or-refuse verdict. `isTransaction:
 *  false` always comes with a null `amount`. `affirmed` is set when the model
 *  said false and code overrode it as a cold-start miss (`affirmsTransaction`,
 *  ./fmRefusal); then `isTransaction` is true and the amount is code's.
 *  `slotApplied` lists the fields the slot reader decided, when any. */
export type FmDeviceParse = AiParsedExpense & {
  isTransaction: boolean;
  affirmed?: AffirmationReason;
  slotApplied?: SlotField[];
};

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

/** Where the date comes from when the user's own words name none
 *  (`resolveTypedDate` is null): `now` for the on-device tier (the small model
 *  dates undated text yesterday on iOS 27 — never trusted), `model` for the
 *  BYOK cloud contract (src/features/ai/engines/shared.ts), whose models are
 *  told today's date and date undated text as today correctly — their
 *  `occurredOn` is the fallback, then `now` when they omit it. The user's own
 *  words always win under either. */
export type FmDateFallback = 'now' | 'model';

export interface FinishFmParseOptions {
  dateFallback?: FmDateFallback;
  /** The user's payees: the slot reader's person resolves against them
   *  (./slotPayee). Without them the person stays the user's own word. */
  payees?: readonly Payee[];
  /** The user's categories: the purpose tail resolves against them when the
   *  model gave no category or one not in the list (./slotCategory). */
  categories?: readonly Category[];
  /** Phrase memory rows, for the ladder's term-memory rung (`q:payee:` rows
   *  the user taught on the Ask card). Optional. */
  termMemory?: readonly PhraseMemoryRow[];
}

/**
 * Everything after `generateObject` for one attempt: resolve the amount,
 * normalize, apply the grounding guards, date it from the user's own words
 * (else today - or, for the cloud contract, the model's own date - see
 * `FmDateFallback`), decide the type where the words do
 * (`resolveSign`, ./signReader: a leading `+`, received/refund/paid/bought/...,
 * a transfer only with an own-account reference; a model `transfer` nothing
 * supports becomes an expense), drop a payee that is only a transaction-kind
 * word ("payday", "gift"), and re-validate (guardrail #6). A model refusal that
 * `affirmsTransaction` (./fmRefusal) reads as a cold-start miss is kept as a
 * transaction with the code-read amount. `accounts` are the user's own accounts
 * (the transfer rule); optional for callers without them. Where the sentence
 * says who gave to whom (./slotReader), that decides the type and names the
 * payee (resolved against `options.payees`, ./slotPayee). Returns null when
 * the result does not survive validation.
 */
export function finishFmParse(
  object: Record<string, unknown>,
  text: string,
  plan: FmAmountPlan,
  now: number,
  currency: string,
  accounts: readonly Account[] = [],
  options: FinishFmParseOptions = {}
): FmDeviceParse | null {
  // The verdict is strict: anything but a boolean is a malformed answer (null,
  // so the attempt counts as failed), never a refusal.
  if (typeof object.isTransaction !== 'boolean') return null;
  const affirmed = object.isTransaction ? null : affirmsTransaction(text, plan, now);
  const isTransaction = object.isTransaction || affirmed != null;
  const amount = isTransaction ? resolveFmAmount(plan, object.amount, text) : 0;
  const raw = { ...object, amount };
  const normalized = applyGroundingGuards(normalizeDeviceParseOutput(raw, currency), text, currency);
  const modelDate = options.dateFallback === 'model' ? normalized.occurredAt : null;
  normalized.occurredAt = resolveTypedDate(text, now) ?? modelDate ?? now;
  const slotApplied: SlotField[] = [];
  if (isTransaction) {
    const payees = options.payees ?? [];
    const sign = resolveSign(text, normalized.type, accounts, payees.map((p) => p.name));
    if (sign.rule === 'slot-direction' && sign.type !== normalized.type) slotApplied.push('type');
    normalized.type = sign.type;
    if (normalized.payee && isTransactionKindWord(normalized.payee)) normalized.payee = null;
    // Who the money went to or came from, read from the sentence: it names the
    // payee when the model's is not in the text, is the same word, or is the
    // purpose ("got 30 from dad for taxi").
    const slots = readSlots(text, { now, payees: payees.map((p) => p.name), accounts: accounts.map((a) => a.name) });
    if (slots.direction && slots.person && sign.rule === 'slot-direction') {
      const resolved = resolveSlotPayee(slots.person, payees, options.termMemory);
      const picked = pickPayee(normalized.payee, { person: slots.person, purpose: slots.purpose, resolved }, text);
      normalized.payee = picked.payee;
      if (picked.fromSlot) slotApplied.push('payee');
    }
    if (slots.direction && slots.purpose && sign.rule === 'slot-direction') {
      // What the money was for: the category when the model gave none of the
      // user's, and the note in the user's own words.
      const kind = normalized.type;
      const categories = options.categories ?? [];
      if ((kind === 'expense' || kind === 'income') && !isUsersCategory(normalized.category, kind, categories)) {
        const fromTail = categoryFromPurpose(slots.purpose, kind, categories, options.termMemory);
        if (fromTail) {
          normalized.category = fromTail;
          slotApplied.push('category');
        }
      }
      const note = slotNote(slots.purpose, { payee: normalized.payee, category: normalized.category });
      const kept = normalized.note && note && normalizeName(normalized.note).includes(normalizeName(note));
      if (note && !kept) {
        normalized.note = note;
        slotApplied.push('note');
      }
    }
  }
  const validated = aiParsedExpenseSchema.safeParse(normalized);
  if (!validated.success) return null;
  return {
    ...validated.data,
    isTransaction,
    ...(affirmed ? { affirmed } : {}),
    ...(slotApplied.length ? { slotApplied } : {}),
  };
}
