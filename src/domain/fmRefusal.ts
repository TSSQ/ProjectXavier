/**
 * Distinguishes an on-device Foundation Models REFUSAL from a FAILURE.
 *
 * The FM prompt's sentinel is `amount: 0` for "this is not a transaction"
 * (hypotheticals, budgets, debts, chit-chat). `normalizeDeviceParseOutput`
 * turns that 0 into a null amount, and the result still validates as an
 * `AiParsedExpense`. That is a deliberate, schema-valid answer from the
 * model — NOT a failure — so the app must not paper over it by silently
 * handing the same text to the heuristic and confirming an expense the user
 * never asked for. A FAILURE (device unavailable, a throw on every attempt,
 * or output that never survived validation) still falls back to the
 * heuristic exactly as before.
 *
 * Framework-free (no RN imports) so the plain-node BDD suite covers it.
 */
import { isUsefulDeviceParse, hasAmountEvidence } from './deviceParsePrompt';
import { AiParsedExpense } from '../lib/validation';

/** What the on-device tier produced for one text. */
export type FmParseOutcome =
  /** A usable parse (positive amount) — use it. */
  | { kind: 'parsed'; parse: AiParsedExpense }
  /** A valid, schema-checked result with no usable amount: the model said
   *  "not a transaction". Do NOT fall back to the heuristic on its own. */
  | { kind: 'refused' }
  /** Unavailable / threw / timed out / invalid output — fall through. */
  | { kind: 'failed' };

/** Classify what `runDeviceParseAttempts` settled on. `parse` is non-null
 *  only for output that passed `aiParsedExpenseSchema`. A non-null parse
 *  without a usable amount is a refusal ONLY when `text` names an amount:
 *  the prompt's amount-0 sentinel also means "no amount stated" ("lunch at
 *  Chipotle"), and that must stay a `failed` so the heuristic fallback asks
 *  "how much?" as before. `forceExpense` (the explicit "/transactions" command)
 *  means the user already said it is an expense, so it is never refused. */
export function classifyDeviceParse(
  parse: AiParsedExpense | null,
  text: string,
  options?: { forceExpense?: boolean }
): FmParseOutcome {
  if (parse == null) return { kind: 'failed' };
  if (isUsefulDeviceParse(parse)) return { kind: 'parsed', parse };
  return options?.forceExpense || !hasAmountEvidence(text) ? { kind: 'failed' } : { kind: 'refused' };
}

/** The assistant's reply to a refusal. */
export const FM_REFUSAL_REPLY = "This doesn't look like a transaction, so I didn't log it.";
