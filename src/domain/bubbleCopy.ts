/**
 * What Xavier says in his speech bubble (docs/design/xavier-speech-bubble-spec.md
 * §4-§5): the structured reply content and every confirmation string. Pure and
 * framework-free so the BDD suite covers it; the `SpeechBubble` component only
 * renders what is built here. Confirmations say what changed and never end in
 * a trailing question - the settle back to the greeting already asks it.
 */
import { formatMoney } from './money';
import { dateLabelFor } from './dates';
import { describeRule } from './recurrence';
import { accountMetaLine, accountSubtypeLabel } from './accountSubtypeLabel';
import { formatBudgetMoney } from './budgetCopy';
import { BudgetState, CategoryBudget, MonthKey, monthName, monthKeyOf } from './budgets';
import type { RecurrenceRule, TransactionType } from './types';

export type AmountTone = 'negative' | 'positive';

export interface BubbleBudget {
  /** Used share of the budget, 0..1 (spent + scheduled, capped at 1). */
  usedRatio: number;
  state: BudgetState;
  /** "SGD 25" */
  amountText: string;
  verb: 'left' | 'over';
  /** "in Food this month" | "in Food in September" */
  where: string;
}

export type BubbleContent =
  | { kind: 'text'; text: string }
  | {
      kind: 'receipt';
      /** "Saved SGD 5.00 to Food." */
      headline: string;
      /** The amount inside `headline`, for colouring. */
      amountText?: string;
      /** How to colour `amountText`; absent = plain text colour. */
      amountTone?: AmountTone;
      lines: string[];
      budget?: BubbleBudget;
    };

export const textBubble = (text: string): BubbleContent => ({ kind: 'text', text });

/** The bubble's full text, for the accessibility label and a text-only view. */
export function bubbleText(content: BubbleContent): string {
  if (content.kind === 'text') return content.text;
  const parts = [content.headline, ...content.lines];
  if (content.budget) parts.push(`${content.budget.amountText} ${content.budget.verb} ${content.budget.where}`);
  return parts.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`)).join(' ');
}

// ─── saved transaction receipt ──────────────────────────────────────────────

export interface SavedReceiptInput {
  type: TransactionType;
  /** Positive magnitude, minor units. */
  amount: number;
  /** The transaction's own currency. */
  currency: string;
  occurredAt: number;
  now: number;
  payeeName: string | null;
  note?: string | null;
  category: { name: string; icon?: string | null } | null;
  accountName: string;
  /** The destination account of a transfer. */
  toAccountName?: string | null;
  /** Present only for an expense whose top-level category has a budget that month. */
  budget?: {
    topName: string;
    view: CategoryBudget;
    month: MonthKey;
    /** The budget's (app) currency. */
    currency: string;
  } | null;
}

const ICON_FALLBACK = '🏷️';

function categoryLine(input: SavedReceiptInput, extra?: string): string {
  const { category, accountName, occurredAt, now } = input;
  const parts = [
    category ? `${category.icon ?? ICON_FALLBACK} ${category.name}` : null,
    accountName,
    dateLabelFor(occurredAt, now),
    extra ?? null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function budgetPart(b: NonNullable<SavedReceiptInput['budget']>, now: number): BubbleBudget {
  const { view, topName, month, currency } = b;
  const where = month === monthKeyOf(now) ? 'this month' : `in ${monthName(month)}`;
  const over = view.left < 0;
  return {
    usedRatio: view.budget > 0 ? Math.min(1, Math.max(0, view.committed / view.budget)) : 1,
    state: view.state,
    amountText: formatBudgetMoney(Math.abs(view.left), currency),
    verb: over ? 'over' : 'left',
    where: `in ${topName} ${where}`,
  };
}

/** The receipt for a saved one-off transaction (spec §5, first three rows). */
export function savedReceipt(input: SavedReceiptInput): BubbleContent {
  const { type, category, accountName, toAccountName, payeeName } = input;
  const amountText = formatMoney(input.amount, input.currency);

  if (type === 'transfer') {
    return {
      kind: 'receipt',
      headline: `Moved ${amountText} from ${accountName} to ${toAccountName ?? 'another account'}.`,
      amountText,
      lines: [dateLabelFor(input.occurredAt, input.now)],
    };
  }
  if (type === 'income') {
    const from = payeeName ?? category?.name;
    return {
      kind: 'receipt',
      headline: from ? `Added ${amountText} from ${from}.` : `Added ${amountText} to ${accountName}.`,
      amountText,
      amountTone: 'positive',
      lines: [categoryLine(input)],
    };
  }
  const receipt: BubbleContent = {
    kind: 'receipt',
    headline: category
      ? `Saved ${amountText} to ${category.name}.`
      : `Saved ${amountText} to ${accountName}.`,
    amountText,
    amountTone: 'negative',
    lines: [category ? categoryLine(input) : dateLabelFor(input.occurredAt, input.now)],
  };
  if (input.budget) receipt.budget = budgetPart(input.budget, input.now);
  return receipt;
}

/** Fallback when the saved transaction can no longer be read. */
export const SAVED_FALLBACK = 'Saved.';

const REPEAT_WORDS: Record<string, string> = {
  annual: 'annually',
  'semi-annual': 'semi-annually',
  custom: '',
};

/** "Monthly" -> "monthly", "Annual" -> "annually", "Custom" -> "" (just "repeating"). */
function repeatWords(label: string): string {
  const lowered = label.toLowerCase();
  return REPEAT_WORDS[lowered] ?? lowered;
}

/** A save that became a repeating series (no transaction id). */
export function seriesText(args: {
  title: string | null;
  amount: number;
  currency: string;
  rule?: RecurrenceRule | null;
}): string {
  const amount = formatMoney(args.amount, args.currency);
  const how = args.rule ? repeatWords(describeRule(args.rule)) : '';
  const what = args.title ? `${args.title}, ${amount}` : amount;
  return `Set up ${what}, repeating${how ? ` ${how}` : ''}.`;
}

/** The receipt after a chat transaction update. */
export function updatedReceipt(input: SavedReceiptInput): BubbleContent {
  const amountText = formatMoney(input.amount, input.currency);
  const name = input.payeeName ?? input.category?.name ?? input.accountName;
  return {
    kind: 'receipt',
    headline: `Updated ${name}.`,
    lines: [categoryLine(input, amountText)],
  };
}

/** `updatedReceipt` from the saved row and the screen's lookups. */
export function updatedReceiptFor(args: {
  tx: { type: TransactionType; amount: number; currency: string; occurredAt: number; accountId: string };
  payeeName: string | null;
  categoryName: string | null;
  categories: { name: string; icon?: string | null }[];
  accounts: { id: string; name: string }[];
  now: number;
}): BubbleContent {
  const { tx, categoryName, categories, accounts } = args;
  return updatedReceipt({
    ...tx,
    now: args.now,
    payeeName: args.payeeName,
    category: categoryName
      ? { name: categoryName, icon: categories.find((x) => x.name === categoryName)?.icon }
      : null,
    accountName: accounts.find((a) => a.id === tx.accountId)?.name ?? 'Account',
  });
}

// ─── accounts ───────────────────────────────────────────────────────────────

/** "Created OCBC 360." with "Savings · opening balance $5,000.00". */
export function accountCreatedReceipt(args: {
  name: string;
  subtype?: string | null;
  openingBalance: number;
  currency: string;
}): BubbleContent {
  const balance =
    args.openingBalance === 0
      ? null
      : `opening balance ${formatMoney(args.openingBalance, args.currency)}`;
  const line = [accountMetaLine({ subtype: args.subtype }), balance].filter(Boolean).join(' · ');
  return {
    kind: 'receipt',
    headline: `Created ${args.name}.`,
    lines: line ? [line] : [],
  };
}

/** "a" or "an" for the word that follows. */
export function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

/** "Credit card" -> "credit card account"; a label already ending in "account" is left alone. */
function accountNoun(label: string): string {
  const lowered = label.trim().toLowerCase();
  return /\baccount$/.test(lowered) ? lowered : `${lowered} account`;
}

/** What an account update changed: rename, then retype, then balance. */
export function accountUpdatedText(args: {
  /** `currency` is the account's own, which its balance is shown in. */
  existing: { name: string; subtype?: string | null; openingBalance: number; currency: string };
  next: { name: string; subtype?: string | null; balance: number; balanceEdited: boolean };
}): string {
  const { existing, next } = args;
  const currency = existing.currency;
  const changes: string[] = [];
  if (next.name !== existing.name) changes.push(`Renamed ${existing.name} to ${next.name}`);
  const nextLabel = accountSubtypeLabel(next.subtype);
  if (nextLabel && nextLabel !== accountSubtypeLabel(existing.subtype)) {
    changes.push(`${next.name} is now ${withArticle(accountNoun(nextLabel))}`);
  }
  if (next.balanceEdited && next.balance !== existing.openingBalance) {
    changes.push(`Set ${next.name}'s balance to ${formatMoney(next.balance, currency)}`);
  }
  if (changes.length === 0) return `Updated ${next.name}.`;
  const rest = changes.length > 1 ? ', and updated the rest' : '';
  return `${changes[0]}${rest}.`;
}

export const accountArchivedText = (name: string): string => `Archived ${name}.`;

// ─── deletes ────────────────────────────────────────────────────────────────

/** One transaction deleted; names the other account when a transfer moved its balance. */
export function deletedText(counterparty?: string | null): string {
  return counterparty ? `Deleted. ${counterparty}'s balance also changed.` : 'Deleted.';
}

/** Several transactions deleted. */
export function deletedManyText(count: number, counterparties: string[]): string {
  const [only] = counterparties;
  if (only === undefined) return `Deleted ${count}.`;
  if (counterparties.length === 1) return `Deleted ${count}. ${only}'s balance also changed.`;
  return `Deleted ${count}. The balances of ${joinNames(counterparties)} also changed.`;
}

/** "A and B", "A, B, and C". */
function joinNames(names: string[]): string {
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// ─── late receipts ──────────────────────────────────────────────────────────

/** A receipt built after an await may only land if nothing else has spoken
 *  since it started (the reply stamp has not moved). */
export const shouldApplyReceipt = (stampAtStart: number, stampNow: number): boolean =>
  stampAtStart === stampNow;

// ─── budgets ────────────────────────────────────────────────────────────────

/** "Groceries is now $450 a month." with "Starting October · was $400". */
export function budgetSetReceipt(args: {
  categoryName: string;
  next: number;
  previous: number | null;
  month: MonthKey;
  currency: string;
}): BubbleContent {
  const to = formatBudgetMoney(args.next, args.currency);
  const line =
    args.previous === null
      ? `Starting ${monthName(args.month)}`
      : `Starting ${monthName(args.month)} · was ${formatBudgetMoney(args.previous, args.currency)}`;
  return {
    kind: 'receipt',
    headline: `${args.categoryName} is now ${to} a month.`,
    amountText: to,
    lines: [line],
  };
}

/** "Removed the Food budget." */
export function budgetRemovedText(categoryName: string): string {
  return `Removed the ${categoryName} budget.`;
}

/** "Created Pets with a $50 monthly budget." with "Starting October". */
export function createCategoryReceipt(args: {
  name: string;
  amount: number;
  month: MonthKey;
  currency: string;
}): BubbleContent {
  const amountText = formatBudgetMoney(args.amount, args.currency);
  return {
    kind: 'receipt',
    headline: `Created ${args.name} with a ${amountText} monthly budget.`,
    amountText,
    lines: [`Starting ${monthName(args.month)}`],
  };
}

// ─── cancelled ──────────────────────────────────────────────────────────────

export const DISCARDED_TEXT = "No problem, I didn't save it.";
export const ACCOUNT_UPDATE_CANCELLED_TEXT = 'No problem, I left it as it was.';
