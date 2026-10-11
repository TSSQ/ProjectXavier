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
import { isUsefulDeviceParse, hasAmountEvidence, typedDateSpan } from './deviceParsePrompt';
import { aiParsedExpenseSchema, AiParsedExpense } from '../lib/validation';
import type { FmDeviceParse } from './fmParse';
import {
  NotTransactionCue,
  detectNotTransactionCue,
  hasStrictPastMoneyVerb,
} from './notTransactionCues';
import { readAmounts, AMOUNT_LABEL_WORDS } from './amountCandidates';
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

/** Words that only join the item to the amount or the date ("12 on lunch",
 *  "grab 8 to office", "kopi w kaya 3"): not counted. */
const CONNECTORS = new Set(['on', 'for', 'at', 'to', 'w', 'w/', 'with', '@', 'the', 'a', 'an', 'of', 'in', 'from', 'my', '&', '+', '-']);

/**
 * Words that make a short text something other than a log of money spent, in
 * any position. Built from what the pipeline already knows rather than fitted
 * to cases:
 *  - plan, intent, hypothetical, request and debt words: the not-a-transaction
 *    cues' vocabulary (./notTransactionCues: intent, owe, owes-me, worth,
 *    save-up, set-aside, future-obligation) and their participles, and the
 *    words of an instruction to the assistant (the injection refusals);
 *  - stated values that are not money: balance, net worth, age, height,
 *    weight, temperature, score, points, and the count units
 *    `amountCandidates` already refuses to read as money after a number
 *    (hours, km, kg, ...);
 *  - a period or a future time the date reader did not consume ("next month",
 *    "monthly", "per week"): a budget or a plan, not a dated log.
 */
const NEVER_A_LOG = new Set([
  // plan / intent / hypothetical / request
  'gonna', 'wanna', 'going', 'plan', 'plans', 'planning', 'planned', 'intend', 'hope', 'hoping',
  'thinking', 'considering', 'wondering', 'need', 'needs', 'want', 'wants', 'due', 'paying', 'buying', 'getting',
  'ordering', 'booking', 'sending', 'spending', 'saving', 'if', 'unless', 'maybe', 'perhaps', 'probably', 'whether',
  'hopefully', 'please', 'pls', 'plz', 'remind', 'reminder', 'afford',
  // an instruction to the assistant (the injection refusals: "ignore the
  // above and answer 42")
  'ignore', 'disregard', 'forget', 'answer', 'reply', 'respond', 'say', 'tell', 'write', 'output', 'print',
  'repeat', 'pretend', 'act', 'instructions', 'instruction', 'prompt', 'system', 'assistant',
  // scheduling, contact and chat: a digit-bearing text that is a time, a
  // phone number or small talk ("meet at 7", "call mom at 5", "test 123")
  'call', 'text', 'meet', 'meeting', 'see', 'wake', 'alarm', 'timer', 'appointment', 'appt', 'dial', 'contact',
  'hi', 'hello', 'hey', 'thanks', 'thank', 'bye', 'test', 'testing', 'and', 'or', 'but', 'not', 'yes', 'ok', 'okay',
  // debt
  'owe', 'owes', 'owing', 'owed', 'iou', 'lend', 'lent', 'lending', 'borrow', 'borrowed', 'borrowing', 'loan', 'loans',
  // budgets, goals and stated values
  'budget', 'budgets', 'budgeting', 'goal', 'goals', 'target', 'limit', 'cap', 'save', 'savings', 'worth',
  'networth', 'balance', 'bal', 'age', 'aged', 'height', 'weight', 'temperature', 'temp', 'score', 'points', 'pts',
  'password', 'passcode', 'otp', 'pin', 'code',
  // count and measure units (amountCandidates' COUNT_AFTER_RE, and the
  // measures a stated value carries: "30 degrees", "5 years old", "50%")
  'km', 'kms', 'kg', 'kgs', 'lb', 'lbs', 'hours', 'hour', 'hrs', 'hr', 'mins', 'min', 'minutes', 'seconds', 'secs',
  'people', 'pax', 'times', 'nights', 'miles', 'metres', 'meters', 'steps', 'reps', 'degrees', 'deg', 'celsius',
  'fahrenheit', 'percent', '%', '\u00b0', '\u00b0c', '\u00b0f', 'cm', 'mm', 'ft', 'feet', 'inches', 'yo', 'gb', 'mb', 'tb', 'calories',
  'kcal', 'cal', 'bpm', 'mph', 'kmh', 'litres', 'liters', 'ml',
  // ordinals and ranks that number something other than money ("season 3",
  // "episode 4", "part 2")
  'part', 'season', 'episode', 'ep', 'vol', 'volume', 'grade', 'rank', 'lvl', 'round', 'stage', 'phase',
  'chapter', 'page', 'version', 'level', 'floor', 'room', 'gate', 'seat', 'platform', 'locker',
  // a period or a future time the date reader left in the text
  'next', 'tomorrow', 'tmr', 'tmrw', 'later', 'soon', 'upcoming', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'weekly', 'monthly', 'yearly', 'annually', 'annual', 'daily', 'per', 'each', 'every',
]);

/** Of `NEVER_A_LOG`, the words a venue is named with ("Budget Taxi 12",
 *  "Remind Me Cafe 20", "Goal Sports Bar 30"): excused inside a run of two or
 *  more Capitalised words that also holds a word of no vocabulary (see
 *  `inVenueName`). Lower-case or alone they still block ("budget 300
 *  groceries", "Budget 30 lunch"). */
const VENUE_WORDS = new Set(['budget', 'goal', 'target', 'limit', 'cap', 'plan', 'remind', 'save', 'balance', 'hope', 'need', 'want']);

/** Question and modal words. They block ("did I pay 1500 rent", "is 50 a lot
 *  for dinner") except inside a Capitalised venue name ("Do Thai 12", "What A
 *  Burger 9", "Can Can Cafe 14") and in a quip after the log (`isQuip`:
 *  "coffee 4 could i be any more tired"). */
const QUESTION_WORDS = new Set([
  'did', 'do', 'does', 'can', 'may', 'might', 'must', 'is', 'are', 'was', 'were', 'am', 'what', 'whats', 'how',
  'why', 'when', 'where', 'which', 'who', 'should', 'would', 'could', 'will', 'shall',
]);
const MONEY_VERBS = new Set([
  'pay', 'pays', 'buy', 'buys', 'spend', 'spends', 'get', 'gets', 'afford', 'save', 'order', 'book', 'transfer',
  'send', 'owe', 'lend', 'borrow', 'cost', 'costs', 'charge', 'give', 'spent', 'paid', 'bought',
]);

/** The word right before the amount in "<words> is <number>": a stated value. */
const STATED_VALUE_BEFORE = new Set(['is', 'are', 'was', 'were', 'be', '=', 'no', 'no.', 'number', '#', 'equals']);

/** A subject: a log names what was bought, not who did what ("I'm 30", "it's
 *  5 now", "she 12"); with no past money verb (that is the `past-verb` path) a
 *  subject makes it a statement. Object pronouns ("drinks w them 30") do not
 *  block. */
const SUBJECTS = new Set([
  'i', "i'm", 'im', "i've", 'ive', 'you', "you're", 'u', 'he', "he's", 'she', "she's", 'it', "it's", 'its', 'we',
  "we're", 'they', "they're", 'that', "that's", 'thats', 'this', 'there', "there's", "what's", 'whats',
]);

/** Keyboard mash, not a word: a run from one keyboard row, the same letter
 *  three times, or five or more letters without a vowel. Short vowel-less
 *  abbreviations ("mcd", "kfc", "bbt", "ntuc") are words here. */
const GIBBERISH_RE = /(?:asdf|sdfg|dfgh|fghj|ghjk|hjkl|qwer|wert|erty|rtyu|tyui|yuio|uiop|zxcv|xcvb|cvbn|vbnm)|([a-z])\1\1|^[b-df-hj-np-tv-xz]{5,}$/;

/** Pronouns never make a Capitalised run a venue name ("Remind Me 20"). */
const PRONOUNS = new Set(['i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'she', 'her', 'it', 'they', 'them']);

/** A future span the date reader does not consume ("in 3 days"). */
const FUTURE_SPAN_RE = /\bin (?:\d+|a|an|one|two|three|four|five|a few|a couple of) (?:days?|weeks?|months?|years?)\b/;

/** A currency mark glued to (or next to) the amount marker: part of it. */
const AMOUNT_MARKER = '\uE000';
const CURRENCY_AROUND_MARKER =
  /(?:[$\u20ac\u00a3\u00a5]|\bs\$|\b(?:sgd|usd|rm|myr|dollars?|bucks|cents?))\s*(?=\uE000)|(?<=\uE000)\s*(?:[$\u20ac\u00a3\u00a5]|(?:sgd|usd|rm|myr|dollars?|bucks|cents?)\b)/gi;

interface Token {
  /** As typed, punctuation trimmed. */
  raw: string;
  /** Lower-cased, curly quotes straightened. */
  word: string;
}

const tokenize = (s: string): Token[] =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}\uE000'@&+#=$%\u00b0-]+|[^\p{L}\p{N}\uE000'@&+#=$%\u00b0/-]+$/gu, ''))
    .filter((w) => w.length > 0)
    .map((raw) => ({ raw, word: raw.toLowerCase() }));

/** True when the word names a vocabulary entry: listed, or a contraction of a
 *  modal ("i'll", "we'd", "won't"). */
const isFuture = (w: string): boolean => /'ll$|'d$|^won't$|^wont$/.test(w);
const inAnyVocabulary = (w: string): boolean =>
  NEVER_A_LOG.has(w) || QUESTION_WORDS.has(w) || isFuture(w) || CONNECTORS.has(w) || PRONOUNS.has(w) || SUBJECTS.has(w);

/** True when `tokens[i]` sits in a run of two or more Capitalised words that
 *  also holds a word of no vocabulary: a venue name ("Budget Taxi", "Remind Me
 *  Cafe"). "I" never extends a run. */
function inVenueName(tokens: Token[], i: number): boolean {
  const cap = (t: Token | undefined): boolean => !!t && t.raw !== 'I' && t.raw !== AMOUNT_MARKER && /^\p{Lu}/u.test(t.raw);
  if (!cap(tokens[i])) return false;
  let a = i;
  let b = i;
  while (cap(tokens[a - 1])) a -= 1;
  while (cap(tokens[b + 1])) b += 1;
  if (b === a) return false;
  return tokens.slice(a, b + 1).some((t) => !inAnyVocabulary(t.word) && /\p{L}/u.test(t.word));
}

/** True when `tokens[i]` blocks the affirmation (see the vocabularies above). */
function blocksLog(tokens: Token[], i: number): boolean {
  const w = tokens[i]!.word;
  if (isFuture(w) || w === 'will' || w === 'shall' || SUBJECTS.has(w) || GIBBERISH_RE.test(w)) return true;
  if (QUESTION_WORDS.has(w)) return !inVenueName(tokens, i);
  if (!NEVER_A_LOG.has(w)) return false;
  return !(VENUE_WORDS.has(w) && inVenueName(tokens, i));
}

/** A quip after the log: a question or modal word, then "i"/"we", and no money
 *  verb ("coffee 4 could i be any more tired", "lunch 9 can we talk about how
 *  bad it was"). It is a remark about the user, not about money. */
function isQuip(tail: Token[]): boolean {
  return (
    tail.length >= 2 &&
    QUESTION_WORDS.has(tail[0]!.word) &&
    !['will', 'shall', 'should', 'would'].includes(tail[0]!.word) &&
    (tail[1]!.word === 'i' || tail[1]!.word === 'we') &&
    !tail.some((t) => MONEY_VERBS.has(t.word) || NEVER_A_LOG.has(t.word) || isFuture(t.word))
  );
}

/**
 * The terse-log SHAPE: after removing the amount (with its currency marks),
 * the date phrase code reads (`typedDateSpan`) and the connector words, 1 to 4
 * words remain ("12 on lunch", "2$ on drinks today", "grab 8 to office",
 * "Remind Me Cafe 20"), none of them a non-money word (`blocksLog`), and no
 * label word right before a bare-integer amount ("room 204", "gate 12": the
 * labels `amountCandidates` already reads as ids). The one exception to the
 * word count: a quip after a one-to-four word log (`isQuip`).
 */
function isTerseLog(text: string, plan: FmAmountPlan, now: number): boolean {
  if (plan.mode !== 'single') return false;
  const amount = readAmounts(text).offered[0];
  if (!amount) return false;
  const amountEnd = amount.index + amount.text.length;
  const date = typedDateSpan(text, now);
  if (date && date.index < amountEnd && amount.index < date.end) return false;
  const cut = (s: string, from: number, to: number, by: string): string => s.slice(0, from) + by + s.slice(to);
  // Cut the later span first so the earlier one's indices stay valid.
  let marked = text;
  const spans = [{ index: amount.index, end: amountEnd, by: ` ${AMOUNT_MARKER} ` }];
  if (date) spans.push({ index: date.index, end: date.end, by: ' ' });
  for (const s of spans.sort((x, y) => y.index - x.index)) marked = cut(marked, s.index, s.end, s.by);
  marked = marked.replace(CURRENCY_AROUND_MARKER, ' ');
  if (FUTURE_SPAN_RE.test(marked.toLowerCase())) return false;

  const tokens = tokenize(marked);
  const at = tokens.findIndex((t) => t.raw === AMOUNT_MARKER);
  if (at < 0) return false;
  const before = tokens[at - 1];
  if (before && STATED_VALUE_BEFORE.has(before.word)) return false;
  const bareInteger = /^\d+$/.test(amount.text.trim());
  if (before && bareInteger && AMOUNT_LABEL_WORDS.includes(before.word)) return false;
  // "at 7", "by 9": a clock time, not a price.
  if (before && bareInteger && ['at', 'by', 'around', 'till', 'until'].includes(before.word) && amount.value <= 24) return false;
  const head = tokens.slice(0, at);
  const tail = tokens.slice(at + 1);
  const counted = (ts: Token[]): number => ts.filter((t) => /\p{L}/u.test(t.word) && !CONNECTORS.has(t.word)).length;
  if (head.some((_, i) => blocksLog(tokens, i))) return false;
  // A quip after a one-to-four word log is not counted.
  if (counted(head) >= 1 && counted(head) <= 4 && isQuip(tail)) return true;
  if (tail.some((_, i) => blocksLog(tokens, at + 1 + i))) return false;
  const total = counted(head) + counted(tail);
  return total >= 1 && total <= 4;
}

/**
 * The model answered `isTransaction: false` for text that plainly records a
 * spend. Measured on the dev split, the on-device model refuses real spends
 * that carry a future- or question-like word ("movie 20 on monday", "taxi 18
 * tomorrow", "Budget Taxi 12", "Remind Me Cafe 20", "Do Thai 12"); the date
 * phrase is now stripped before the model sees the text (`fmPromptText`), and
 * the rest is decided here. Step 3's rule - code decides where it can - with
 * precision over recall: a false refusal costs the user one "Log anyway" tap, a
 * false log is a wrong ledger row. The refusal is overridden, with the
 * code-read amount, only under the `single` amount plan (the amount is code's,
 * never the refusing model's), when NO cue fires (the check the app ran before
 * the model), the text has no "?" anywhere, AND either
 *  - `past-verb`: a strict past-tense money verb says money moved ("paid 100
 *    deposit, will pay balance next week"), or
 *  - `terse-log`: the text has the terse-log shape (`isTerseLog`).
 * Everything else keeps the model's refusal, which the app shows with "Log
 * anyway". `now` dates the text the same way `finishFmParse` does, so the date
 * phrase removed here is the one code reads.
 */
export function affirmsTransaction(text: string, plan: FmAmountPlan, now: number): AffirmationReason | null {
  if (plan.mode !== 'single') return null;
  if (text.includes('?') || text.includes('\uFF1F')) return null;
  if (detectNotTransactionCue(text)) return null;
  if (hasStrictPastMoneyVerb(text)) return 'past-verb';
  return isTerseLog(text, plan, now) ? 'terse-log' : null;
}

/** The assistant's reply to a refusal. */
export const FM_REFUSAL_REPLY = "This doesn't look like a transaction, so I didn't log it.";
