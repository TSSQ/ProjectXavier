/**
 * Budget intents (docs/design/monthly-budgets-spec.md §6.1) — a pure,
 * deterministic check that runs BEFORE the parse pipeline and the
 * not-a-transaction cues, so an afford question with an amount and a
 * "set <category> budget to N" statement get an answer instead of a refusal.
 *
 * Narrow by design, like the cues it sits in front of: anything that is not
 * unmistakably one of these falls through unchanged ("Budget Rent a Car 85"
 * and "budget airline ticket 120" are still spends; "can I afford it" with no
 * amount keeps today's refusal). Framework-free.
 */
import { Category } from './types';
import { findCategoryMatch } from './categories';
import { budgetableCategories } from './budgets';
import { extractAmountCandidates } from './amountCandidates';
import { hasPastMoneyVerb, isAffordCue, stripAffordCue as removeAffordCue } from './notTransactionCues';

export interface AffordIntent {
  kind: 'afford';
  /** Major units, as the user wrote it. */
  amount: number;
  /** The text with the afford cue removed ("a 300 phone"): what "Log it" parses. */
  subject: string;
}

export interface SetBudgetIntent {
  kind: 'set-budget';
  /** The category words as the user wrote them. */
  categoryName: string;
  /** Major units. */
  amount: number;
}

export type BudgetIntent = AffordIntent | SetBudgetIntent;

// ─── afford ─────────────────────────────────────────────────────────────────

/** The first sentence of `text`: cut at "?", "." or "!" that is followed by
 *  more text ("$3.50" has no space after its dot, so it is not a break). */
export function firstClause(text: string): string {
  const m = /[?.!]+\s+\S/.exec(text);
  return m ? text.slice(0, m.index) : text;
}

/** The text with the afford cue (and the question mark) taken out, trimmed at
 *  the first sentence break ("a $300 phone? I have 500 left" -> "a $300 phone"). */
export function stripAffordCue(text: string): string {
  return removeAffordCue(firstClause(text)).replace(/[?!]+\s*$/, '').trim();
}

const NOUN_STOP = new Set([
  'a', 'an', 'the', 'for', 'of', 'some', 'my', 'our', 'new', 'it', 'now', 'this', 'that', 'on',
  'at', 'with', 'to', 'dollars', 'dollar', 'bucks', 'buck', 'sgd', 'usd', 'rm', 'about', 'around',
]);

/** The thing being bought, for the over-budget reply ("phone"): the subject
 *  without amounts, currency words and filler. Empty when nothing is left, or
 *  when what is left is too long to read as a noun phrase. */
export function affordNoun(subject: string): string {
  const words = subject
    .toLowerCase()
    .replace(/[$€£¥]/g, ' ')
    .split(/[\s,.;:]+/)
    .filter((w) => w && !/^\d[\d.,]*k?$/.test(w) && !NOUN_STOP.has(w));
  return words.length > 0 && words.length <= 3 ? words.join(' ') : '';
}

/** What "Log it" parses: the subject, with the amount stated explicitly when
 *  the subject does not already carry exactly that one amount. */
export function affordLogText(intent: AffordIntent): string {
  const found = extractAmountCandidates(intent.subject);
  return found.length === 1 && found[0]!.value === intent.amount
    ? intent.subject
    : `${intent.subject} ${intent.amount}`.trim();
}

function detectAfford(text: string): AffordIntent | null {
  if (!isAffordCue(text)) return null;
  // Only the question itself is read: a second sentence ("I have 500 left")
  // is neither a second amount nor a record of money that moved.
  const clause = firstClause(text);
  // Money that already moved ("…300 phone, bought it yesterday") is a log.
  if (hasPastMoneyVerb(clause)) return null;
  const candidates = extractAmountCandidates(clause);
  // Two readings ("500 this month … 300 phone") are ambiguous: leave it to the
  // existing refusal rather than guess which one is the purchase.
  if (candidates.length !== 1) return null;
  return { kind: 'afford', amount: candidates[0]!.value, subject: stripAffordCue(text) };
}

// ─── set budget ─────────────────────────────────────────────────────────────

/** The amount phrase at the end of the clause: a number with an optional
 *  currency symbol before or "$"/code/word after. Captured loosely, then read
 *  by the one amount reader (`extractAmountCandidates`). */
const AMT =
  '((?:[$€£¥]|s\\$|sgd\\s|usd\\s)?\\s?\\d[\\d.,]*k?(?:\\s?(?:\\$|sgd|usd|dollars?|bucks))?)';
const END = '\\s*[.!]?$';
const TO = '(?:to\\s+|=\\s*|is\\s+)?';

const SET_RES: ReadonlyArray<{
  re: RegExp;
  category: number;
  amount: number;
  /** Starts with set/make: the user plainly means to set a budget. */
  explicit: boolean;
}> = [
  // set|make (my)? <category> budget (to)? <amount>
  { re: new RegExp('^(?:set|make)\\s+(?:my\\s+|the\\s+)?(.+?)\\s+budget\\s+' + TO + AMT + END, 'i'), category: 1, amount: 2, explicit: true },
  // <category> budget (to|=|is)? <amount>
  { re: new RegExp('^(.+?)\\s+budget\\s*' + TO + AMT + END, 'i'), category: 1, amount: 2, explicit: false },
  // budget <amount> for <category>
  { re: new RegExp('^budget\\s+' + AMT + '\\s+for\\s+(?:my\\s+|the\\s+)?(.+?)' + END, 'i'), category: 2, amount: 1, explicit: false },
];

/** Words that make a "category" a time or a sentence, not a category name. */
const NOT_A_CATEGORY = /\b(?:next|this|every|per|each|monthly|weekly|daily|month|week|year)\b/;
const FILLER_CATEGORY = new Set(['my', 'the', 'a', 'an', 'our', 'total', 'overall', 'new', 'whole']);
const QUESTION_START = /^(?:what|how|is|are|does|do|can|should|will|why|when)\b/;

function parseAmount(phrase: string): number | null {
  const found = extractAmountCandidates(phrase);
  return found.length === 1 ? found[0]!.value : null;
}

/** "Budget" as a brand or place ("Lunch at Budget 12"). */
const BRAND_BUDGET = /\b(?:at|with|from)\s+budget\b/i;

function detectSetBudget(text: string, categories: Category[]): SetBudgetIntent | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (BRAND_BUDGET.test(t)) return null;
  for (const { re, category, amount, explicit } of SET_RES) {
    const m = re.exec(t);
    if (!m) continue;
    const name = (m[category] ?? '').trim();
    const value = parseAmount(m[amount] ?? '');
    const lower = name.toLowerCase();
    const words = lower.split(' ');
    if (!name || value === null || value <= 0) continue;
    if (words.length > 3 || NOT_A_CATEGORY.test(lower) || QUESTION_START.test(lower)) continue;
    if (words.every((w) => FILLER_CATEGORY.has(w))) continue;
    // Without a verb ("Taxi budget 12") this reads as a spend as easily as a
    // statement, so it only routes when the words ARE an existing category.
    if (!explicit && resolveBudgetCategory(name, categories).kind !== 'exact') continue;
    return { kind: 'set-budget', categoryName: name, amount: value };
  }
  return null;
}

/** The budget intent in `text`, or null to fall through unchanged. Set-budget
 *  is checked first: "set groceries budget to 450" has no afford cue anyway,
 *  but the order keeps the more specific statement ahead of the question. */
export function detectBudgetIntent(
  text: string,
  categories: Category[] = []
): BudgetIntent | null {
  return detectSetBudget(text, categories) ?? detectAfford(text);
}

// ─── resolving the category ─────────────────────────────────────────────────

export type SetBudgetTarget =
  | { kind: 'exact'; category: Category }
  | { kind: 'suggestion'; category: Category }
  | { kind: 'none' };

/** Resolves the typed words to a top-level expense category: exact, "did you
 *  mean…?", or nothing. Child categories never carry a budget, so they are
 *  not offered. */
export function resolveBudgetCategory(name: string, categories: Category[]): SetBudgetTarget {
  const topLevel = budgetableCategories(categories);
  const match = findCategoryMatch(name, 'expense', topLevel);
  if (match.exact) return { kind: 'exact', category: match.exact };
  if (match.suggestion) return { kind: 'suggestion', category: match.suggestion };
  return { kind: 'none' };
}
