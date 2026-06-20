/**
 * Assistant decision logic — the pure brain behind the "describe an expense and
 * I'll log it" flow. Given a schema-validated AI parse plus the user's accounts,
 * it decides whether to (a) block (no account yet), (b) ask a clarifying
 * question (a required field is missing or confidence is low), or (c) present a
 * ready-to-save draft for confirmation.
 *
 * Framework-free and side-effect-free so it can be exhaustively BDD-tested in
 * plain Node. Persistence and ID/category/payee resolution happen in the
 * feature layer (see src/features/ai), never here.
 */
import { Account, Transaction, TransactionType } from './types';
import { AiParsedExpense, missingFields } from '../lib/validation';
import { formatMoney } from './money';

/** A proposed transaction, with category/payee still as names (not yet ids). */
export interface TransactionDraft {
  accountId: string;
  type: TransactionType;
  /** Positive magnitude in minor units; direction derives from `type`. */
  amount: number;
  currency: string;
  categoryName: string | null;
  payeeName: string | null;
  note: string | null;
  occurredAt: number;
  source: 'ai';
}

export type AssistantOutcome =
  | { kind: 'blocked'; message: string }
  | { kind: 'clarify'; message: string; missing: string[] }
  | { kind: 'confirm'; draft: TransactionDraft; message: string };

export interface AssistantContext {
  accounts: Account[];
  /** Preferred account for new entries; falls back to the first active one. */
  defaultAccountId?: string;
  /** Injected clock for deterministic tests. */
  now?: number;
  /** Below this AI confidence we ask for confirmation instead of drafting. */
  confidenceThreshold?: number;
}

/** Decide the next assistant step from a validated AI parse. */
export function interpret(
  parsed: AiParsedExpense,
  ctx: AssistantContext
): AssistantOutcome {
  const active = ctx.accounts.filter((a) => !a.archived);
  if (active.length === 0) {
    return {
      kind: 'blocked',
      message: "Let's add an account first so I know where to record this.",
    };
  }

  const missing = missingFields(parsed);
  if (missing.length > 0) {
    return { kind: 'clarify', message: questionFor(missing), missing };
  }

  const threshold = ctx.confidenceThreshold ?? 0.5;
  if (parsed.confidence < threshold) {
    return {
      kind: 'clarify',
      message:
        "I'm not totally sure I caught that — can you give me a little more detail?",
      missing: [],
    };
  }

  // Prefer the account the AI named (case-insensitive), then the configured
  // default, then the first active account. active is non-empty (checked above).
  const named = parsed.account
    ? active.find(
        (a) => a.name.toLowerCase() === parsed.account!.toLowerCase()
      )
    : undefined;
  const account =
    named ??
    (ctx.defaultAccountId
      ? active.find((a) => a.id === ctx.defaultAccountId)
      : undefined) ??
    active[0]!;

  const draft: TransactionDraft = {
    accountId: account.id,
    type: parsed.type!,
    amount: parsed.amount!,
    currency: parsed.currency ?? account.currency,
    categoryName: parsed.category,
    payeeName: parsed.payee,
    note: parsed.note,
    occurredAt: parsed.occurredAt ?? ctx.now ?? Date.now(),
    source: 'ai',
  };

  return { kind: 'confirm', draft, message: summarize(draft) };
}

/** Turn a confirmed draft into a persistable Transaction once ids are known. */
export function buildTransaction(
  draft: TransactionDraft,
  resolved: {
    id: string;
    createdAt: number;
    categoryId: string | null;
    payeeId: string | null;
  }
): Transaction {
  return {
    id: resolved.id,
    accountId: draft.accountId,
    type: draft.type,
    amount: draft.amount,
    currency: draft.currency,
    categoryId: resolved.categoryId,
    payeeId: resolved.payeeId,
    transferAccountId: null,
    note: draft.note,
    occurredAt: draft.occurredAt,
    createdAt: resolved.createdAt,
    source: draft.source,
    receiptRef: null,
  };
}

function questionFor(missing: string[]): string {
  const parts: string[] = [];
  if (missing.includes('amount')) parts.push('how much it was');
  if (missing.includes('type')) {
    parts.push('whether it was an expense, income, or transfer');
  }
  return `Almost there — can you tell me ${parts.join(' and ')}?`;
}

function summarize(d: TransactionDraft): string {
  const signed = d.type === 'expense' ? -d.amount : d.amount;
  const verb =
    d.type === 'expense'
      ? 'Spent'
      : d.type === 'income'
        ? 'Received'
        : 'Transferred';
  const who = d.payeeName ? ` at ${d.payeeName}` : '';
  const cat = d.categoryName ? ` (${d.categoryName})` : '';
  return `${verb} ${formatMoney(Math.abs(signed), d.currency)}${who}${cat}. Save it?`;
}
