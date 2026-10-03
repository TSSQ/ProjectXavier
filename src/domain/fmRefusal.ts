/**
 * Distinguishes an on-device Foundation Models REFUSAL from a FAILURE.
 *
 * The FM contract's first field is `isTransaction` (step 3). `false` is the
 * model's deliberate "this is not a transaction" (a question, plan, budget,
 * hypothetical, debt, joke or gibberish). `finishFmParse` (./fmParse) turns it
 * into a parse with a null amount that still validates as an `AiParsedExpense`:
 * a schema-valid answer, NOT a failure, so the app must not paper over it by
 * silently handing the same text to the heuristic and confirming an expense the
 * user never asked for. A FAILURE (device unavailable, a throw on every attempt,
 * or output that never survived validation) still falls back to the heuristic
 * exactly as before, and so does `isTransaction: true` with no amount ("lunch at
 * Chipotle"), which the heuristic turns into "how much?".
 *
 * Framework-free (no RN imports) so the plain-node BDD suite covers it.
 */
import { isUsefulDeviceParse, hasAmountEvidence } from './deviceParsePrompt';
import { aiParsedExpenseSchema, AiParsedExpense } from '../lib/validation';
import { FmDeviceParse } from './fmParse';
import { NotTransactionCue } from './notTransactionCues';

/** What the on-device tier produced for one text. */
export type FmParseOutcome =
  /** A usable parse (positive amount) — use it. */
  | { kind: 'parsed'; parse: AiParsedExpense }
  /** The model said "not a transaction" about text that names an amount. Do
   *  NOT fall back to the heuristic on its own. `cue` is set when the
   *  deterministic cue check refused it BEFORE the model ran
   *  (./notTransactionCues); absent for the model's own verdict. */
  | { kind: 'refused'; cue?: NotTransactionCue }
  /** Unavailable / threw / timed out / invalid output / a transaction with no
   *  amount — fall through. `reason` says why when no parse came back at all
   *  (see `FmFallbackReason`); a parse that was only not useful has none. */
  | { kind: 'failed'; reason?: FmFallbackReason };

/** Why the on-device tier produced nothing: it was not available, every
 *  attempt threw (Foundation Models' safety check does this on some texts), or
 *  the output never survived validation. Logged on the fallback's parse metric
 *  so a soak can measure the throw rate (`fmFallbackDetail`). */
export type FmFallbackReason = 'unavailable' | 'threw' | 'invalid';

/** `runDeviceParseAttempts`' `isFinal` for the FM path: the model's explicit
 *  "not a transaction" is its answer, so it is not retried. */
export const isRefusalVerdict = (parse: FmDeviceParse): boolean => !parse.isTransaction;

/** Classify what `runDeviceParseAttempts` settled on. `parse` is non-null only
 *  for output that passed `aiParsedExpenseSchema`. `isTransaction: false` is a
 *  refusal ONLY when `text` names an amount: with none ("what's my balance",
 *  gibberish) there is nothing to log anyway, and the heuristic fallback asks
 *  "how much?" as before. `forceExpense` (the explicit "/transactions" command)
 *  means the user already said it is an expense, so it is never refused.
 *  `threw` (attempts that threw) only decides the reason of a failure: `threw`
 *  wins if any attempt threw, even when a later attempt returned an invalid parse. */
export function classifyDeviceParse(
  parse: FmDeviceParse | null,
  text: string,
  options?: { forceExpense?: boolean; threw?: number }
): FmParseOutcome {
  if (parse == null) return { kind: 'failed', reason: options?.threw ? 'threw' : 'invalid' };
  if (!parse.isTransaction) {
    return options?.forceExpense || !hasAmountEvidence(text) ? { kind: 'failed' } : { kind: 'refused' };
  }
  if (!isUsefulDeviceParse(parse)) return { kind: 'failed' };
  // Re-validating strips the verdict: callers get a plain `AiParsedExpense`.
  return { kind: 'parsed', parse: aiParsedExpenseSchema.parse(parse) };
}

/** The assistant's reply to a refusal. */
export const FM_REFUSAL_REPLY = "This doesn't look like a transaction, so I didn't log it.";
