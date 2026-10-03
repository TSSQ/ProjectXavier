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
 *    spends; only "budget" + a money amount that ends the clause is);
 *  - a question word counts only in a question SHAPE ("should i", "is it",
 *    "how much"), never as a bare first word ("Do Thai 12", "Will 20");
 *  - clause-start anchoring: "coffee 4 could i be any more tired" is a spend;
 *  - quoted text is ignored ("asked 'should I?' then bought shoes 80");
 *  - NO cue fires when the text records money that already moved (a past-tense
 *    money verb anywhere: "paid 100 deposit, will pay balance next week");
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

/** Every cue id, in the order the rules are tried. A const tuple so the type
 *  below is a real union (the metric detail takes it, not a bare string). */
export const NOT_TRANSACTION_CUE_IDS = [
  'how-much-should',
  'should-i',
  'can-i',
  'could-i',
  'worth',
  'intent',
  'future-transfer',
  'leading-question',
  'remind-me',
  'future-obligation',
  'budget',
  'set-aside',
  'save-up',
  'i-save',
  'owe',
  'owes-me',
] as const;
export type NotTransactionCue = (typeof NOT_TRANSACTION_CUE_IDS)[number];
export const notTransactionCueSchema = z.enum(NOT_TRANSACTION_CUE_IDS);

/** Past-tense verbs that say money moved. Strict: a plain record of a payment. */
const PAST_STRICT_SRC =
  'paid|bought|spent|transferred|moved|settled|received|repaid|topped up|withdrew|deposited|charged';
/** Narrative verbs that also appear in an IOU or a budget sentence ("he got me
 *  lunch", "she lent me", "it cost 50"). */
const PAST_NARRATIVE_SRC = 'got|cost|sent|gave|lent|borrowed';
/** A past-tense money verb anywhere means the text records money that already
 *  moved. Then no cue fires and the model decides (missing a refusal is cheap,
 *  refusing a real expense is not). */
const PAST_ANY = new RegExp('\\b(?:' + PAST_STRICT_SRC + '|' + PAST_NARRATIVE_SRC + ')\\b');
/** The guard for the owe and budget cues: narrative verbs do not cancel them. */
const PAST_STRICT = new RegExp('\\b(?:' + PAST_STRICT_SRC + ')\\b');

/** Start of a clause: the text start, or after sentence punctuation or a comma. */
const CL = '(?:^|[.;:!?]\\s+|,\\s+)';
/** An optional currency prefix before a number. */
const CUR = '(?:[$\u20ac\u00a3\u00a5]|s\\$|sgd |usd |rm )?\\s?';
/** An optional currency written after the number ("300$", "300sgd", "20 dollars",
 *  "15 bucks") — the user's own habit, and it must not hide a clause-final amount. */
const CUR_AFTER = '(?:\\s?(?:\\$|sgd|usd|rm|dollars?|bucks))?';
/** A clause-final amount: what a budget statement or an IOU ends in. */
const AMOUNT_END = '\\d+(?:[.,]\\d+)*k?' + CUR_AFTER + '(?=\\s*(?:$|[,.]|for\\b|a\\b|an\\b|per\\b|each\\b|every\\b|monthly\\b|weekly\\b|this\\b|next\\b|and\\b|back\\b|from\\b))';

const rx = (src: string): RegExp => new RegExp(src);

/** The two shapes of an afford question, as regex sources — the single source
 *  of truth for the `can-i` cue AND for removing it from a text
 *  (`stripAffordCue`, used by src/domain/budgetIntent.ts). */
const CAN_I_VERB_SRC = 'can (?:i|we) (?:afford|buy|get|spend|pay|justify)\\b';
const CAN_I_AFFORD_SRC = '(?:(?:i|we) )?(?:can|could|cannot|can\'t|cant) afford\\b';

const RULES: ReadonlyArray<{ id: NotTransactionCue; re: RegExp; narrativeOk?: boolean }> = [
  // Questions and modals, at the start of a clause.
  { id: 'how-much-should', re: rx(CL + 'how much (?:should|can|could|would) (?:i|we)\\b') },
  { id: 'should-i', re: rx(CL + 'should (?:i|we)\\b') },
  { id: 'can-i', re: rx(CL + CAN_I_VERB_SRC) },
  // "can afford 300$ phone" — the subject dropped. Only "afford" is unambiguous
  // without one ("can buy" / "can get" read as a terse log as often as a plan).
  // Guarded (not a START rule): "I can afford 300$ phone now, bought it" logs.
  { id: 'can-i', re: rx(CL + CAN_I_AFFORD_SRC) },
  { id: 'could-i', re: rx(CL + 'could (?:i|we)\\b') },
  { id: 'worth', re: rx(CL + '(?:is (?:it|that|this) worth\\b|worth it\\?)') },
  // Intent and the future: first person or no subject, at the text start
  // ("Mei will pay me back" is someone else's plan inside a real log).
  {
    id: 'intent',
    re: rx(
      '^(?:(?:i|we)(?: am|\'m)?\\s+)?(?:thinking (?:of|about) (?:buying|getting|paying|spending)|planning (?:to|on) [a-z]|(?:want|wanna)(?: to)? (?:buy|get|spend|pay)|(?:plan|hope|intend) to (?:buy|get|spend|pay)|(?:going to|gonna) (?:buy|get|pay|spend|order|book|transfer|send))' +
        '|^(?:(?:i|we) will|(?:i|we)\'ll|will) (?:buy|pay|spend|transfer|get|send)\\b'
    ),
  },
  // A base-form transfer with a future marker: "transfer 500 to savings next month".
  { id: 'future-transfer', re: /^(?:transfer|move|send)\b.*\b(?:next (?:week|month|year)|in \d+ (?:days?|weeks?|months?))\b/ },
  // A question shape: auxiliary + subject, or a wh-word + a verb. A bare first
  // word is not enough ("Do Thai 12", "What A Burger 9", "Will 20").
  {
    id: 'leading-question',
    re: /^(?:(?:is|was|would)\s+(?:i|we|you|it|that|this|they|there|\d)|are\s+(?:you|they|there|\d)|(?:do|does|can|could|will)\s+(?:i|we|you)\b|how (?:do|does|much|many|can|could|should|would|is|are)\b|(?:what|why) (?:is|are|do|does|should|would|if|about)\b|what's\b)/,
  },
  { id: 'remind-me', re: rx('^remind me (?:to|at|about|on|in|that|tomorrow|when)\\b') },
  // A future obligation, only with a future marker.
  {
    id: 'future-obligation',
    re: /\bneeds? to pay\b.*\b(?:on|by|next|this)\b.*\b(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|week|month)|\b(?:is|are) due (?:on|by|next|this|tomorrow)\b/,
  },
  // Budgets: "budget" + a money amount that ends the clause. "Budget 30 lunch",
  // "budget 4 nights 90", "Budget Taxi 12" are not.
  { id: 'budget', narrativeOk: true, re: rx('\\bbudget(?:ing)?\\s+(?:(?:is|of|at|for)\\s+)?' + CUR + AMOUNT_END) },
  { id: 'set-aside', re: rx(CL + '(?:(?:i|we)(?:\'ll)? )?set aside ' + CUR + '\\d') },
  {
    id: 'save-up',
    re: rx(CL + '(?:(?:i|we)(?:\'m| am|\'re| are)? )?(?:saving(?: up)? for (?:a|an|the|my|our|\\d)|save up (?:' + CUR + '\\d|for\\b))'),
  },
  { id: 'i-save', re: rx(CL + '(?:i|we) (?:will |should |could |can )?save ' + CUR + '\\d') },
  // Debts and IOUs. "owed" (past) is a settled debt and never matches.
  {
    id: 'owe',
    narrativeOk: true,
    re: rx('^(?:(?:i|we) owe\\b(?!\\s+(?:nothing|no |nobody|less|more))(?=.*\\d)|owe \\S+ ' + CUR + AMOUNT_END + '$)'),
  },
  { id: 'owes-me', re: rx('^(?:[a-z]+ ){0,2}owes (?:me|us) ' + CUR + AMOUNT_END) },
];

/** Question and budget shapes at the very START of the text. A past-tense verb in
 *  a later clause does not cancel these ("can I afford a 300 phone, already spent
 *  500 this month"); `worth` is not here, so "worth it? bought 50" still logs. */
const START_RULES: ReadonlyArray<{ id: NotTransactionCue; re: RegExp }> = [
  { id: 'how-much-should', re: /^how much (?:should|can|could|would) (?:i|we)\b/ },
  { id: 'should-i', re: /^should (?:i|we)\b/ },
  { id: 'can-i', re: rx('^' + CAN_I_VERB_SRC) },
  { id: 'leading-question', re: /^what if\b/ },
  { id: 'budget', re: rx('^budget(?:ing)?\\s+(?:(?:is|of|at|for)\\s+)?' + CUR + AMOUNT_END) },
];

/** Lower-case, straighten curly quotes, drop quoted spans (a quoted phrase is
 *  reported speech, not the user's own intent), collapse whitespace. */
function prepare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/"[^"]*"|(?<=^|\s)'[^']*'(?=$|[\s.,!?])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first cue in `text`, or null. Pure text check: it does not look at
 *  whether the text names an amount (see `cueRefusal`). */
export function detectNotTransactionCue(text: string): { cue: NotTransactionCue } | null {
  const t = prepare(text);
  for (const rule of START_RULES) {
    if (rule.re.test(t)) return { cue: notTransactionCueSchema.parse(rule.id) };
  }
  const anyPast = PAST_ANY.test(t);
  const strictPast = PAST_STRICT.test(t);
  for (const rule of RULES) {
    if (rule.narrativeOk ? strictPast : anyPast) continue;
    if (rule.re.test(t)) return { cue: notTransactionCueSchema.parse(rule.id) };
  }
  return null;
}

const AFFORD_CUE_SPAN = new RegExp('\\b(?:' + CAN_I_VERB_SRC + '|' + CAN_I_AFFORD_SRC + ')', 'i');

/** `text` with the first afford cue ("can I afford", "can afford") removed;
 *  case and the rest of the text are kept. */
export function stripAffordCue(text: string): string {
  return text.replace(AFFORD_CUE_SPAN, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the text records money that already moved (a past-tense money
 *  verb anywhere: "paid", "bought", "spent", "got", …) — the guard every cue
 *  here already honours, exported for src/domain/budgetIntent.ts. */
export function hasPastMoneyVerb(text: string): boolean {
  return PAST_ANY.test(prepare(text));
}

/** True when `text` carries the 'can-i' afford cue ("can I afford a 300 phone",
 *  "can afford 300$ phone"). This module's `can-i` rules stay the single source
 *  of truth for what an afford question looks like — src/domain/budgetIntent.ts
 *  routes on this instead of keeping a second regex. Honours the same guards
 *  (a past-tense money verb cancels the later-clause rules; quoted text is
 *  ignored). */
export function isAffordCue(text: string): boolean {
  return detectNotTransactionCue(text)?.cue === 'can-i';
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
