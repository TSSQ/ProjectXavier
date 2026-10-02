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
import { localParse, LocalParseContext } from './localParse';
import { isUsefulDeviceParse } from './deviceParsePrompt';
import { aiParsedExpenseSchema, AiParsedExpense } from '../lib/validation';

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
 *  only for output that passed `aiParsedExpenseSchema`, so a non-null parse
 *  without a usable amount is a refusal and a null parse is a failure. */
export function classifyDeviceParse(parse: AiParsedExpense | null): FmParseOutcome {
  if (parse == null) return { kind: 'failed' };
  return isUsefulDeviceParse(parse) ? { kind: 'parsed', parse } : { kind: 'refused' };
}

/** The assistant's reply to a refusal. */
export const FM_REFUSAL_REPLY = "This doesn't look like a transaction, so I didn't log it.";

/** The heuristic parse of `text`, schema-validated (guardrail #6). Used by
 *  the "Log anyway" action and the heuristic tier. `null` when the output
 *  fails validation. A result may still carry a null amount — the caller's
 *  `interpret()` turns that into the normal "how much?" clarification, never
 *  a $0 entry. */
export function heuristicExpense(text: string, ctx: LocalParseContext): AiParsedExpense | null {
  const validated = aiParsedExpenseSchema.safeParse(localParse(text, ctx));
  return validated.success ? validated.data : null;
}
