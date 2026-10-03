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
  /** Set when a model picked the category and the text does not name it. */
  ungrounded?: boolean;
}

export type BudgetIntent = AffordIntent | BudgetCommandIntent;

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

// ─── budget commands (set / edit / remove) ──────────────────────────────────

/** How an edit changes the budget: to an absolute amount, or by a delta. */
export type BudgetChange =
  | { mode: 'to'; amount: number }
  | { mode: 'by'; direction: 'raise' | 'lower'; amount: number };

export interface EditBudgetIntent {
  kind: 'edit-budget';
  categoryName: string;
  change: BudgetChange;
  /** Set when a model picked the category and the text does not name it:
   *  the Assistant asks "Did you mean…?" before the confirm card. */
  ungrounded?: boolean;
}

export interface RemoveBudgetIntent {
  kind: 'remove-budget';
  categoryName: string;
  ungrounded?: boolean;
}

/** Why a budget command is answered with a question: a slot is missing, or
 *  the wording asks for something chat does not do (one category at a time,
 *  monthly only, ongoing only, positive amounts only). */
export type BudgetClarifyReason =
  | 'category'
  | 'amount'
  | 'wording'
  | 'single-category'
  | 'monthly-only'
  | 'month-scope'
  | 'positive-amount';

/** A budget command that is missing a slot, or wording the router and the
 *  model could not read: answered with a question or a hint, never a guess. */
export interface BudgetClarifyIntent {
  kind: 'budget-clarify';
  missing: BudgetClarifyReason;
  action: 'set' | 'edit' | 'remove' | null;
  /** The category words, when the user gave them. */
  categoryName?: string;
  /** The amount (major units), when the user gave it. */
  amount?: number;
}

export type BudgetCommandIntent =
  | SetBudgetIntent
  | EditBudgetIntent
  | RemoveBudgetIntent
  | BudgetClarifyIntent;

/** The amount phrase: a number with an optional currency symbol before, or
 *  "$"/code/word after. Captured loosely, then read by the one amount reader
 *  (`extractAmountCandidates`). */
const AMT_BODY =
  '(?:[$€£¥]|s\\$|sgd\\s|usd\\s)?\\s?\\d[\\d.,]*k?(?:\\s?(?:\\$|sgd|usd|dollars?|bucks))?';
const AMT = `(?<amt>${AMT_BODY})`;
const DET = '(?:(?:my|the|our|a|an)\\s+)?';
const CAT = '(?<cat>.+?)';
const NEWQ = '(?:new\\s+)?';
const SET_VERB = '(?:set|create|add|put|establish|start)';
const SET_VERB_MAKE = '(?:set|create|add|put|establish|start|make)';
const UP = 'raise|increase|bump(?:\\s+up)?|boost|up|grow';
const DOWN = 'lower|decrease|reduce|cut|trim|drop';
const ABS = 'edit|change|update|adjust|modify|make|revise|alter';
const EDIT_VERB = `(?<verb>${ABS}|${UP}|${DOWN})(?:\\s+(?:down|back|up|out))?`;
const REMOVE_VERB = '(?:remove|delete|clear|drop|cancel|reset|erase|scrap|ditch|kill|get rid of)';
/** The connector before an amount: "to", "of", "=", "is" or a colon (written as
 *  hex escape inside the class: Tailwind scans src/ for class-like text). */
const TO_OF = '(?:(?:to|of|at|is)\\s+|[=\\x3a]\\s*)?';
const ON = '(?:for|on|in|towards?)';
const MAX_WORD = '(?:max(?:imum)?(?:\\s+of)?|at most|no more than|not more than|up to)';

type Kind = 'set' | 'edit' | 'remove' | 'clarify-amount' | 'clarify-category';

interface Shape {
  re: RegExp;
  kind: Kind;
  /** Routes only when the text carried a monthly marker ("a month", "monthly"). */
  monthlyOnly?: boolean;
  /** A verb or "budget of" makes the intent plain: an unknown category is
   *  answered ("I couldn't find…"). Without it the words must BE a category. */
  explicit: boolean;
}

const shape = (kind: Kind, explicit: boolean, body: string, monthlyOnly = false): Shape => ({
  re: new RegExp(`^${body}$`, 'i'),
  kind,
  explicit,
  ...(monthlyOnly ? { monthlyOnly } : {}),
});

/** Tried in order; the first that reads wins. */
const SHAPES: readonly Shape[] = [
  // ── set ──
  // set a budget of 300$ on food / want a budget of 300 for food
  shape('set', true, `(?:${SET_VERB_MAKE}\\s+(?:up\\s+)?)?${DET}${NEWQ}budget\\s+(?:of|at|to|=|is)\\s*${AMT}\\s+${ON}\\s+${DET}${CAT}`),
  // set groceries budget to 450
  shape('set', true, `${SET_VERB}\\s+(?:up\\s+)?${DET}${NEWQ}${CAT}\\s+budget\\s+${TO_OF}${AMT}`),
  // set a budget for food of 300 / set budget for food 300
  shape('set', true, `${SET_VERB_MAKE}\\s+(?:up\\s+)?${DET}${NEWQ}budget\\s+${ON}\\s+${DET}${CAT}\\s+${TO_OF}${AMT}`),
  // I want to spend max 450 on groceries
  shape('set', true, `spend\\s+(?:a\\s+)?${MAX_WORD}\\s+${AMT}\\s+${ON}\\s+${DET}${CAT}`),
  // ── remove ── (ahead of edit: "drop shopping budget" removes it, while
  // "drop shopping budget 20" has an amount and is the edit shape's: lower TO 20)
  shape('remove', true, `${REMOVE_VERB}\\s+${DET}${CAT}\\s+budget`),
  shape('remove', true, `${REMOVE_VERB}\\s+${DET}budget\\s+${ON}\\s+${DET}${CAT}`),
  shape('remove', true, `(?:stop|quit)\\s+budgeting\\s+(?:${ON}\\s+)?${DET}${CAT}`),
  shape('remove', false, `no\\s+budget\\s+${ON}\\s+${DET}${CAT}`),
  shape('remove', false, `no\\s+${CAT}\\s+budget`),
  // ── edit ──
  // raise food budget by 50 / edit food budget to 200$ / make my food budget 250
  shape('edit', true, `${EDIT_VERB}\\s+${DET}${CAT}\\s+budget\\s*(?<prep>to|by|at|of|=)?\\s*${AMT}`),
  // change the budget for food to 200
  shape('edit', true, `${EDIT_VERB}\\s+${DET}budget\\s+${ON}\\s+${DET}${CAT}\\s+(?<prep>to|by)\\s+${AMT}`),
  // ── clarify: a command that is missing a slot ──
  shape('clarify-amount', true, `${SET_VERB_MAKE}\\s+(?:up\\s+)?${DET}${NEWQ}${CAT}\\s+budget`),
  shape('clarify-amount', true, `${SET_VERB_MAKE}\\s+(?:up\\s+)?${DET}${NEWQ}budget\\s+${ON}\\s+${DET}${CAT}`),
  shape('clarify-amount', true, `${EDIT_VERB}\\s+${DET}${CAT}\\s+budget`),
  shape('clarify-category', true, `${SET_VERB_MAKE}\\s+(?:up\\s+)?${DET}${NEWQ}budget(?:\\s+(?:of|at|to|=|is))?\\s*${AMT}`),
  shape('clarify-category', true, `${SET_VERB_MAKE}\\s+(?:up\\s+)?${DET}${NEWQ}budget`),
  shape('clarify-category', true, `${REMOVE_VERB}\\s+${DET}budget`),
  // ── verbless set: only when the words ARE an existing category ──
  shape('set', false, `budget\\s+${AMT}\\s+${ON}\\s+${DET}${CAT}`),
  // budget for food 300 / budget for food: 300 / budget food: 300 / budget food 300
  // monthly. The category must exist, and "budget Taxi 12" with none of "for",
  // a colon or a monthly marker is still a spend, even when Taxi is a category.
  shape('set', false, `budget\\s+${ON}\\s+${DET}${CAT}\\s*${TO_OF}${AMT}`),
  shape('set', false, `budget\\s+${DET}${CAT}\\s*[=\\x3a]\\s*${AMT}`),
  shape('set', false, `budget\\s+${DET}${CAT}\\s+${AMT}`, true),
  shape('set', false, `${CAT}\\s+budget\\s*${TO_OF}${AMT}`),
  shape('set', false, `${CAT}\\s+${AMT}\\s+budget`),
  // cap food at 300 / limit shopping to 200 / max 450 on groceries
  shape('set', false, `(?:cap|limit|restrict|max(?:imum)?)\\s+${DET}${CAT}\\s+(?:to|at|=)\\s*${AMT}`),
  shape('set', false, `max(?:imum)?\\s+${AMT}\\s+(?:on|for)\\s+${DET}${CAT}`),
];

/** Polite and desire openers: "can you", "I want to", "please", "let's". */
const LEAD =
  /^(?:(?:hey|hi|ok|okay|please|pls|(?:can|could|would|will) you(?: please)?|(?:i\s+)?(?:want|need|would like|'d like|wanna|like)(?:\s+to)?|let'?s)[,\s]+)+/i;
/** "a month", "monthly", "per month": the budget period, not part of the words. */
const MONTHLY_TAIL = /\s+(?:(?:a|per|each|every)\s+month|monthly|\/\s?mo(?:nth)?|pm)$/i;
const MONTHLY_ADJ = /\bmonthly\s+(?=budget\b)/gi;

/** Words that make a "category" a time or a sentence, not a category name. */
const NOT_A_CATEGORY =
  /\b(?:next|this|every|per|each|monthly|weekly|daily|month|week|year|today|tonight|yesterday|tomorrow|it|them|something|anything)\b/;
const FILLER_CATEGORY = new Set(['up', 'my', 'the', 'a', 'an', 'our', 'total', 'overall', 'new', 'whole']);
/** A question opener. "can you" is not one: "can you set food budget to 300" is a request. */
export const QUESTION_START = /^(?:what|how|is|are|does|do|can i|could i|should|will|why|when|which)\b/i;
/** "food and transport": more than one category in a slot meant for one. */
export const MULTI_CATEGORY = /\s(?:and|or|&)\s|[,&/]/i;
const LEADING_DET = /^(?:(?:my|the|our|a|an|new)\s+)+/i;

/** "Budget" as a brand or place ("Lunch at Budget 12"). */
export const BRAND_BUDGET = /\b(?:at|with|from)\s+budget\b/i;

function parseAmount(phrase: string): number | null {
  const found = extractAmountCandidates(phrase);
  return found.length === 1 ? found[0]!.value : null;
}

/** Whether the text says it is a monthly figure ("a month", "monthly"). */
function hasMonthlyMarker(text: string): boolean {
  const t = text.trim().replace(/[.!]+$/, '');
  return MONTHLY_TAIL.test(t) || /\bmonthly\b/i.test(t);
}

/** The text a shape is matched against: openers and the monthly tail removed. */
export function prepareBudgetText(text: string): string {
  const t = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '')
    .replace(/\s+please$/i, '')
    .replace(LEAD, '')
    .replace(MONTHLY_ADJ, '')
    .replace(MONTHLY_TAIL, '');
  return t.trim();
}

/** The category words with articles dropped, or null when they cannot be a
 *  category name: empty, digits, too many words, a time or a pronoun
 *  ("today", "it"), or a question. */
export function validCategoryWords(raw: string | undefined): string | null {
  const name = (raw ?? '').trim().replace(LEADING_DET, '').trim();
  const lower = name.toLowerCase();
  const words = lower.split(' ');
  if (!name || /\d/.test(name)) return null;
  if (words.length > 3 || NOT_A_CATEGORY.test(lower) || QUESTION_START.test(lower)) return null;
  if (words.every((w) => FILLER_CATEGORY.has(w))) return null;
  return name;
}

const UP_VERB_RE = new RegExp(`^(?:${UP})$`, 'i');
const DOWN_VERB_RE = new RegExp(`^(?:${DOWN})$`, 'i');

/** How an edit changes the budget. Only "by N" is a delta: a bare number after
 *  a direction verb ("lower food budget 200", "drop shopping budget 20") is the
 *  new amount, as is any number after edit/change/make. "by" after a verb with
 *  no direction ("change food budget by 20") is not read: up or down is unknown. */
function editChange(verb: string, prep: string | undefined, amount: number): BudgetChange | null {
  const by = (prep ?? '').toLowerCase() === 'by';
  if (!by) return { mode: 'to', amount };
  if (UP_VERB_RE.test(verb)) return { mode: 'by', direction: 'raise', amount };
  if (DOWN_VERB_RE.test(verb)) return { mode: 'by', direction: 'lower', amount };
  return null;
}

const REMOVE_START = new RegExp(`^${REMOVE_VERB}\\b`, 'i');

function readShape(
  sh: Shape,
  t: string,
  categories: Category[],
  monthly: boolean
): BudgetCommandIntent | null {
  if (sh.monthlyOnly && !monthly) return null;
  const m = sh.re.exec(t);
  if (!m) return null;
  const g = m.groups ?? {};
  const name = 'cat' in g ? validCategoryWords(g.cat) : '';
  if (name === null) return null;
  const amount = g.amt === undefined ? null : parseAmount(g.amt);
  if (g.amt !== undefined && (amount === null || amount <= 0)) return null;
  const exact = name !== '' && resolveBudgetCategory(name, categories).kind === 'exact';
  // "food and transport" is two categories in a slot for one; only a category
  // that really is named that way gets through.
  if (MULTI_CATEGORY.test(name) && !exact) return null;
  // Without a verb ("Taxi budget 12") this reads as a spend as easily as a
  // statement, so it only routes when the words ARE an existing category.
  if (!sh.explicit && !exact) return null;
  switch (sh.kind) {
    case 'set':
      return { kind: 'set-budget', categoryName: name, amount: amount! };
    case 'remove':
      return { kind: 'remove-budget', categoryName: name };
    case 'edit': {
      if (amount === null) return null;
      const change = editChange(g.verb!, g.prep, amount);
      return change ? { kind: 'edit-budget', categoryName: name, change } : null;
    }
    case 'clarify-amount':
      return {
        kind: 'budget-clarify',
        missing: 'amount',
        action: g.verb === undefined ? 'set' : 'edit',
        categoryName: name,
      };
    case 'clarify-category':
      return {
        kind: 'budget-clarify',
        missing: 'category',
        action: REMOVE_START.test(t) ? 'remove' : 'set',
        ...(amount !== null ? { amount } : {}),
      };
  }
}

function detectBudgetCommand(text: string, categories: Category[]): BudgetCommandIntent | null {
  if (BRAND_BUDGET.test(text)) return null;
  const t = prepareBudgetText(text);
  const monthly = hasMonthlyMarker(text);
  for (const sh of SHAPES) {
    const hit = readShape(sh, t, categories, monthly);
    if (hit) return hit;
  }
  return null;
}

/** The budget intent in `text`, or null to fall through unchanged. Commands are
 *  checked first: "set groceries budget to 450" has no afford cue anyway, but
 *  the order keeps the more specific statement ahead of the question. */
export function detectBudgetIntent(
  text: string,
  categories: Category[] = []
): BudgetIntent | null {
  return detectBudgetCommand(text, categories) ?? detectAfford(text);
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
