/**
 * A deterministic "this is not a transaction" check that runs BEFORE the
 * on-device model (src/features/ai/deviceParse.ts).
 *
 * Product decision (2026-10-01): questions, plans, budgets, hypotheticals and
 * IOUs are REFUSED even when they contain an amount. The Mac's Foundation
 * Models refuses these, but the same code on an iPhone (iOS 27.0.1) answers
 * `isTransaction: true` for all of them, so the verdict cannot rest on the
 * model alone (evals/README.md, "Mac versus iPhone"). Step 3's rule applies:
 * code decides where it can.
 *
 * CONSERVATIVE BY DESIGN. A false refusal of a real expense is the costly
 * error (the user must tap "Log anyway"), a missed refusal is the cheap one
 * (the model, or the confirm card, still sees it). So each cue is narrow:
 *  - it must be a whole word or phrase, never a substring ("budget" alone is
 *    NOT a cue: "Budget Rent a Car 85" and "budget airline ticket 120" are
 *    spends; only "budget" followed by a number or "is/of" is);
 *  - quoted text is ignored ("asked 'should I?' then bought shoes 80");
 *  - past tense never matches ("owed", "was gonna buy");
 *  - a bare trailing "?" is NOT a cue ("dinner 30?" is a terse spend).
 * Every cue is checked against ALL dev cases (0 hits on a transaction, see
 * evals/README.md, "Not-a-transaction cues"), and a unit test pins the real
 * expenses that carry cue-like words.
 *
 * Framework-free (no RN imports) so the plain-node BDD suite and the eval
 * harness import the exact module the app ships.
 */
import { z } from 'zod';
import { hasAmountEvidence } from './deviceParsePrompt';

interface CueRule {
  id: string;
  re: RegExp;
}

/** Ordered; the first match names the cue. Each regex runs on lower-cased text
 *  with quoted spans removed (`prepare`). No character class below holds a
 *  colon (NativeWind scans src/ regex literals; see the tailwind CSS test). */
const RULES: readonly CueRule[] = [
  // Questions and modals.
  { id: 'how-much-should', re: /\bhow much (?:should|can|could|would) (?:i|we)\b/ },
  { id: 'should-i', re: /\bshould (?:i|we)\b/ },
  { id: 'can-i', re: /\bcan (?:i|we) (?:afford|buy|get|spend|pay|justify)\b/ },
  { id: 'could-i', re: /\bcould (?:i|we)\b/ },
  { id: 'worth', re: /\bis (?:it|that|this) worth\b|\bworth it\?/ },
  { id: 'what-if', re: /\bwhat if\b/ },
  // Intent and the future. Past forms ("was gonna buy") are excluded.
  {
    id: 'intent',
    re: /(?<!\b(?:was|were|wasn't|weren't|never) )\b(?:thinking (?:of|about) (?:buying|getting|paying|spending)|planning (?:to|on)|(?:want|wanna|plan|hope|intend)(?: to)? (?:buy|get|spend|pay)|(?:going to|gonna) (?:buy|get|pay|spend|order|book)|will (?:buy|pay|spend|transfer|get)|i'?ll (?:buy|pay|spend|get|transfer|send))\b/,
  },
  // A leading auxiliary or wh-word. `(?!')` keeps "Will's cafe 12" a payee.
  {
    id: 'leading-question',
    re: /^(?:(?:is|are|do|does|would|will|can|could|should|shall)\b(?!')|how\b|what\b|why\b)/,
  },
  { id: 'remind-me', re: /^remind me\b/ },
  // A future obligation: only with a future marker ("need to pay ... on friday",
  // "is due on monday"); a bare "need to pay" is not enough to refuse on.
  {
    id: 'future-obligation',
    re: /\bneeds? to pay\b.*\b(?:on|by|next|this)\b.*\b(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|week|month)|\b(?:is|are) due (?:on|by|next|this|tomorrow)\b/,
  },
  // Budgets and saving.
  { id: 'budget', re: /\bbudget(?:ing)?\s+(?:(?:is|of|at)\s+)?[^\d\s]{0,4}\s?\d/ },
  { id: 'set-aside', re: /\bset aside\b/ },
  { id: 'save-up', re: /\bsave up\b|\bsaving (?:up )?for\b/ },
  { id: 'i-save', re: /\b(?:i|we) (?:will |should |could |can )?save \d/ },
  // Debts and IOUs. "owed" (past) is a settled debt and never matches.
  { id: 'owe', re: /^(?:(?:i|we) )?owe\b/ },
  { id: 'owes-me', re: /^(?:[a-z]+ ){0,2}owes (?:me|us)\b/ },
];

export const NOT_TRANSACTION_CUE_IDS = RULES.map((r) => r.id) as [string, ...string[]];
export const notTransactionCueSchema = z.enum(NOT_TRANSACTION_CUE_IDS);
export type NotTransactionCue = z.infer<typeof notTransactionCueSchema>;

/** Lower-case, straighten curly quotes, drop quoted spans (a quoted phrase is
 *  reported speech, not the user's own intent), collapse whitespace. */
function prepare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/"[^"]*"|(?<=^|\s)'[^']*'(?=$|[\s.,!?])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first cue in `text`, or null. Pure text check: it does not look at
 *  whether the text names an amount (see `cueRefusal`). */
export function detectNotTransactionCue(text: string): { cue: NotTransactionCue } | null {
  const t = prepare(text);
  for (const rule of RULES) {
    if (rule.re.test(t)) return { cue: notTransactionCueSchema.parse(rule.id) };
  }
  return null;
}

/** The gate `deviceParse` (and the eval harness) apply before calling the
 *  model: a cue fires AND the text names an amount AND the user did not use
 *  "/transactions" (`forceExpense`, which bypasses the check entirely). With no
 *  amount evidence the text goes to the model as before (then failed, then the
 *  heuristic's "how much?"). */
export function cueRefusal(
  text: string,
  options?: { forceExpense?: boolean }
): { cue: NotTransactionCue } | null {
  if (options?.forceExpense || !hasAmountEvidence(text)) return null;
  return detectNotTransactionCue(text);
}
