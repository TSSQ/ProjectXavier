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
import { boundedNamePattern } from './textMatch';

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
  /** The account name the AI mentioned, when it didn't match any real account.
   *  Shown as a warning in the draft card so the user can correct it. */
  unmatchedAccountName?: string;
  /** The user's original utterance, attached by the screen before saving so it
   *  persists on the transaction (drives the assistant feed's user bubble). */
  sourceText?: string | null;
  /** Which fields were defaulted/guessed rather than parsed from the user's
   *  input — consumers (e.g. the draft card) may flag these for confirmation.
   *  Presentation-only metadata; NOT persisted onto the Transaction. */
  defaulted: { account: boolean; payee: boolean; category: boolean; date: boolean };
  /** Destination account id for a transfer (`type === 'transfer'` only). The
   *  model's own account field is never trusted for this — see
   *  `resolveTransferAccounts` — so it's resolved deterministically from the
   *  user's text before the draft is built. */
  transferAccountId?: string | null;
  /** Destination account name, for display (DraftCard's "To" row). */
  transferAccountName?: string | null;
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
  /** The user's raw utterance. Used only for transfer target/source extraction
   *  (resolveTransferAccounts) — the model's own fields are never trusted for
   *  a transfer's accounts. Optional so non-screen callers (most BDD) can omit
   *  it for non-transfer parses. */
  text?: string;
}

export interface TransferAccounts {
  /** Account matched after a "to" keyword — the transfer's destination. */
  to: Account | null;
  /** Account matched after a "from" keyword — an explicit source override. */
  from: Account | null;
}

/** Extract the destination/source accounts a transfer refers to, purely from
 *  the user's own text — the model's account field is never trusted for this
 *  (see the assistant-transfers spec). Matches `to <name>` / `from <name>`
 *  case-insensitively, word-bounded, against ACTIVE accounts only. When
 *  several account names match the same keyword (e.g. "Invest" and
 *  "Investments" both fit "to invest...") the longest name wins. */
export function resolveTransferAccounts(
  text: string,
  accounts: Account[]
): TransferAccounts {
  return {
    to: matchTransferKeyword(text, 'to', accounts),
    from: matchTransferKeyword(text, 'from', accounts),
  };
}

function matchTransferKeyword(
  text: string,
  keyword: 'to' | 'from',
  accounts: Account[]
): Account | null {
  let best: Account | null = null;
  for (const account of accounts) {
    const name = account.name.trim();
    if (!name) continue;
    // boundedNamePattern's trailing negative lookahead (not `\b`) still
    // rejects a longer word continuing past the name (Invest vs Investments)
    // while accepting names with trailing punctuation ("Savings (USD)").
    const re = new RegExp(`\\b${keyword}\\s+${boundedNamePattern(name)}`, 'i');
    if (re.test(text) && (!best || name.length > best.name.trim().length)) {
      best = account;
    }
  }
  return best;
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

  const now = ctx.now ?? Date.now();

  if (parsed.type === 'transfer') {
    return interpretTransfer(parsed, active, ctx, now);
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

  const validDate = acceptedDate(parsed.occurredAt, now);

  const draft: TransactionDraft = {
    accountId: account.id,
    type: parsed.type!,
    amount: parsed.amount!,
    currency: parsed.currency ?? account.currency,
    categoryName: parsed.category,
    payeeName: parsed.payee,
    note: parsed.note,
    occurredAt: validDate ?? now,
    source: 'ai',
    ...(parsed.account && !named ? { unmatchedAccountName: parsed.account } : {}),
    defaulted: {
      account: !named,
      payee: parsed.payee == null,
      category: parsed.category == null,
      date: validDate == null,
    },
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
    transferAccountId: draft.transferAccountId ?? null,
    note: draft.note,
    occurredAt: draft.occurredAt,
    createdAt: resolved.createdAt,
    source: draft.source,
    receiptRef: null,
    sourceText: draft.sourceText ?? null,
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
  if (d.type === 'transfer') {
    return `Transferred ${formatMoney(d.amount, d.currency)} to ${d.transferAccountName}. Save it?`;
  }
  const signed = d.type === 'expense' ? -d.amount : d.amount;
  const verb = d.type === 'expense' ? 'Spent' : 'Received';
  const who = d.payeeName ? ` at ${d.payeeName}` : '';
  const cat = d.categoryName ? ` (${d.categoryName})` : '';
  return `${verb} ${formatMoney(Math.abs(signed), d.currency)}${who}${cat}. Save it?`;
}

/** Accept the AI/text-derived date only if it's within a plausible window (not
 *  more than 2 years ago, not in the future). Rejects hallucinated years (e.g.
 *  2025 when today is 2026) and future dates. Returns null (→ default "now")
 *  when out of range or absent. */
function acceptedDate(aiDate: number | null, now: number): number | null {
  const TWO_YEARS = 2 * 365 * 24 * 60 * 60 * 1000;
  return aiDate != null && aiDate >= now - TWO_YEARS && aiDate <= now + 60_000
    ? aiDate
    : null;
}

/**
 * Decide the transfer path of `interpret()`: the destination account MUST
 * come from the user's own text (`resolveTransferAccounts`) — the model's
 * `account` field describes what the user said they used, not a transfer's
 * two-sided target, and is never trusted here. Source resolution order:
 * an explicit "from <account>" match, then the model-named account (if it
 * isn't the destination), then the configured default account (if it isn't
 * the destination), then the first other active account. Excluding the
 * destination at every step makes a same-account "transfer" impossible by
 * construction.
 */
function interpretTransfer(
  parsed: AiParsedExpense,
  active: Account[],
  ctx: AssistantContext,
  now: number
): AssistantOutcome {
  const { to, from } = resolveTransferAccounts(ctx.text ?? '', active);
  if (!to) {
    return {
      kind: 'clarify',
      message:
        'Which account should I transfer to? (e.g. "transfer $100 from OCBC 360 to Budget")',
      missing: ['transferAccount'],
    };
  }

  const named = parsed.account
    ? active.find((a) => a.name.toLowerCase() === parsed.account!.toLowerCase())
    : undefined;

  const fromMatch = from && from.id !== to.id ? from : undefined;
  const namedMatch = named && named.id !== to.id ? named : undefined;
  const defaultMatch =
    ctx.defaultAccountId && ctx.defaultAccountId !== to.id
      ? active.find((a) => a.id === ctx.defaultAccountId)
      : undefined;
  const firstOther = active.find((a) => a.id !== to.id);

  const source = fromMatch ?? namedMatch ?? defaultMatch ?? firstOther;
  if (!source) {
    // Only the destination account exists — nothing to transfer from.
    return {
      kind: 'blocked',
      message: "You'll need a second account to transfer between.",
    };
  }

  const validDate = acceptedDate(parsed.occurredAt, now);

  const draft: TransactionDraft = {
    accountId: source.id,
    type: 'transfer',
    amount: parsed.amount!,
    currency: parsed.currency ?? source.currency,
    categoryName: null,
    payeeName: null,
    note: parsed.note,
    occurredAt: validDate ?? now,
    source: 'ai',
    transferAccountId: to.id,
    transferAccountName: to.name,
    defaulted: {
      account: !fromMatch && !namedMatch,
      payee: false,
      category: false,
      date: validDate == null,
    },
  };

  return { kind: 'confirm', draft, message: summarize(draft) };
}
