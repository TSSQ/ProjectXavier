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
import type { FmDeviceParse } from './fmParse';
import {
  NotTransactionCue,
  detectNotTransactionCue,
  hasStrictPastMoneyVerb,
} from './notTransactionCues';
import { readAmounts } from './amountCandidates';
import { FmAmountPlan } from './fmAmountPlan';

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

// ─── transaction affirmation ───────────────────────────────────────────────

/** Why a model refusal was overridden as a cold-start miss (see
 *  `affirmsTransaction`). Carried on the parse (`FmDeviceParse.affirmed`) for
 *  the debug screen and the eval's diagnostics. */
export type AffirmationReason = 'past-verb' | 'terse-log';

/** Date words a terse log carries beside the amount ("movie 20 on monday",
 *  "snack 4 tomorrow", "lunch 12 last friday", "rent 1500 on the 1st"). Removed
 *  before the word count; the date itself is `resolveTypedDate`'s. */
const DATE_PHRASE_RE = new RegExp(
  [
    "\\b(?:on |last |this |next |every |coming )?(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\b",
    '\\b(?:yesterday|today|tomorrow|tonight|tmr|ytd)\\b',
    '\\b(?:this|last|next|yesterday) (?:morning|afternoon|evening|night|week|month|year)\\b',
    '\\b(?:day before yesterday)\\b',
    '\\b(?:\\d+|a|an|one|two|three|four|five|six|seven|a couple of|few) (?:days?|weeks?|months?|years?|hours?) ago\\b',
    '\\bon (?:the )?\\d{1,2}(?:st|nd|rd|th)?\\b',
    '\\b(?:in|from|since) (?:19|20)\\d{2}\\b',
  ].join('|'),
  'gi'
);

/** Words that make a short text something other than a log: a plan or a
 *  future payment ("paying the 300 deposit tomorrow"), a hypothetical ("lunch
 *  12 if I go"), a debt ("Sam owes me 20 lunch"), a request ("room 204 please")
 *  or a stated value ("my pin is 1234", "my locker code is 4471"). Modals that
 *  only count with a pronoun ("should I", "can we") are the cue check's and are
 *  not here, so a venue named like a question ("Can Can Cafe 14", "Do Thai 12",
 *  "What A Burger 9") and a quip after the log ("coffee 4 could i be any more
 *  tired") still log. */
const NOT_A_LOG_WORDS = new Set([
  'will', "'ll", 'gonna', 'going', 'need', 'needs', 'want', 'wanna', 'plan', 'plans', 'planning',
  'paying', 'buying', 'getting', 'ordering', 'booking', 'sending', 'due',
  'if', 'unless', 'maybe', 'perhaps', 'probably', 'might', 'may', 'whether', 'hopefully',
  'owe', 'owes', 'owing', 'iou', 'lend', 'lent', 'borrow', 'borrowed',
  'please', 'pls', 'pin', 'code', 'password', 'passcode', 'otp',
]);
/** The word right before the amount in "<words> is <number>": a stated value. */
const STATED_VALUE_BEFORE = new Set(['is', 'are', 'was', 'were', 'be', '=', 'no', 'no.', 'number', '#']);

/** The amount's span replaced by a marker, so the words around it can be
 *  counted and the word before it inspected. */
const AMOUNT_MARKER = '\uE000';

/** A "<one to four words> <amount>" log: "movie 20 on monday", "Budget 30
 *  lunch", "Remind Me Cafe 20", "Do Thai 12". At most four words lead up to the
 *  amount (a date phrase does not count); words after it are commentary and are
 *  allowed ("coffee 4 could i be any more tired") unless one of them is a plan,
 *  hypothetical, debt, request or stated-value word (`NOT_A_LOG_WORDS`).
 *  Requires the one unambiguous amount the single plan carries. */
function isTerseLog(text: string, plan: FmAmountPlan): boolean {
  if (plan.mode !== 'single') return false;
  const span = readAmounts(text).offered[0];
  if (!span) return false;
  const marked = text.slice(0, span.index) + ` ${AMOUNT_MARKER} ` + text.slice(span.index + span.text.length);
  const words = marked
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(DATE_PHRASE_RE, ' ')
    // A currency symbol or word next to the amount belongs to it.
    .replace(/(?:[$\u20ac\u00a3\u00a5]|s\$|sgd|usd|rm|dollars?|bucks|cents?)\s*(?=\uE000)|(?<=\uE000)\s*(?:\$|sgd|usd|rm|dollars?|bucks|cents?)\b/g, ' ')
    .split(/\s+/)
    .filter((w) => w === AMOUNT_MARKER || /[a-z\u00c0-\u024f]/.test(w));
  const at = words.indexOf(AMOUNT_MARKER);
  if (at < 0) return false;
  const rest = words.filter((w) => w !== AMOUNT_MARKER).map((w) => w.replace(/^[^a-z']+|[^a-z']+$/g, ''));
  if (rest.length < 1 || at > 4) return false;
  if (rest.some((w) => NOT_A_LOG_WORDS.has(w) || w.endsWith("'ll") || w.endsWith("'d"))) return false;
  const before = at > 0 ? words[at - 1]!.replace(/[,;:]+$/, '') : null;
  if (before && STATED_VALUE_BEFORE.has(before)) return false;
  return true;
}

/**
 * The model answered `isTransaction: false` for text that plainly records a
 * spend. Measured on the dev split (2026-10-10), the on-device model refuses
 * real spends that carry a future- or question-like word ("movie 20 on
 * monday", "taxi 18 tomorrow", "Budget Taxi 12", "Remind Me Cafe 20", "Do Thai
 * 12") while the cue check (./notTransactionCues) correctly lets them through.
 * Step 3's rule: code decides where it can. The refusal is overridden, with the
 * code-read amount, when NO cue fires (the check the app ran before the model)
 * AND either
 *  - `past-verb`: a strict past-tense money verb says money moved ("paid 100
 *    deposit, will pay balance next week"), or
 *  - `terse-log`: the text is a terse "<one to four words> <amount>" log with no
 *    plan, debt, request or stated-value word in it (see `isTerseLog`).
 * Only under the `single` amount plan: the amount is then code's, never the
 * refusing model's. Every dev refusal case still refuses (evals/test-sign.mjs).
 */
export function affirmsTransaction(text: string, plan: FmAmountPlan): AffirmationReason | null {
  if (plan.mode !== 'single') return null;
  if (detectNotTransactionCue(text)) return null;
  if (hasStrictPastMoneyVerb(text)) return 'past-verb';
  return isTerseLog(text, plan) ? 'terse-log' : null;
}

/** The assistant's reply to a refusal. */
export const FM_REFUSAL_REPLY = "This doesn't look like a transaction, so I didn't log it.";
