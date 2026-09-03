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
import { AiParsedExpense, missingFields, truncateSourceText } from '../lib/validation';
import { formatMoney } from './money';
import { boundedNamePattern } from './textMatch';
import { currencyConflict } from './currencyConflict';
import { SourceBand } from './statementLayout';

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
  /** Excluded from every money aggregation while true (see domain/types.ts
   *  isCounted). `interpret()` pre-sets this to `true` only when the parse's
   *  (already guard-checked — see deviceParsePrompt.ts's
   *  textHasPendingMarker) `pending` came back true, so the confirm sheet
   *  opens with Pending already on for an explicit "pending $40 dinner";
   *  otherwise it's left undefined (→ not-pending). The user can still flip
   *  it in the confirm-edit sheet before saving, which always wins on save. */
  pending?: boolean;
  /** Set when the AI named a currency that conflicts with the destination
   *  account's own currency (see currencyConflict, domain/currencyConflict.ts)
   *  — carries the currency the AI heard, purely for the confirm card's
   *  warning copy. `currency`/`amount` above are already forced to the
   *  account's own currency and the literal parsed number: this app never
   *  invents an FX rate (CLAUDE.md #3 — ask, never convert), so the flag's
   *  only job is to make the confirm card warn the user and require them to
   *  re-enter the amount themselves (via Edit) before the draft can be
   *  saved. Undefined/null when there's no conflict — the common case. */
  mismatchedCurrency?: string | null;
  /** Statement-scan only (docs/design/statement-scan-spec.md §4.3) — the raw
   *  row text looked like a transfer (TRF/ICT/TOP-UP/PAYNOW/…) but
   *  `findAccountMatch` couldn't confidently resolve a destination account,
   *  so the draft stays expense/income rather than guessing. Presentation
   *  only: drives the card's "Looks like a transfer — Edit to pick the
   *  account." copy, never persisted. Unset for every non-statement draft. */
  transferHint?: boolean;
  /** Statement-scan only — a same-amount/same-day/same-account transaction
   *  already on the ledger (`findLikelyDuplicate`), surfaced as a warning on
   *  the card. Never auto-skips the draft; presentation only. */
  duplicateOf?: { id: string; label: string } | null;
  /** Statement-scan only — set by `applyReceiptTotal` when a receipt's
   *  amount was replaced by the layout's own TOTAL/Grand total/Amount due
   *  line rather than whatever the parse ladder guessed. Presentation only:
   *  drives "Amount taken from the receipt's TOTAL line." */
  amountFromTotal?: boolean;
  /** Unified-scan only (docs/design/unified-scan-spec.md §9 follow-up 1,
   *  taken early) — set by `applyLayoutAmount` when a single-row, fully-read
   *  layout's own printed amount replaced whatever the text parse ladder
   *  guessed (e.g. a card suffix like "-4008" mistaken for the amount).
   *  Presentation only: drives "Amount taken from the amount printed in the
   *  photo." Mutually exclusive with `amountFromTotal` — a receipt total
   *  always wins when both could apply. */
  amountFromRow?: boolean;
  /** Review-only (docs/design/row-snippet-spec.md, D1 — never persisted): the
   *  normalised region of the scanned photo the amount was read from, set
   *  alongside `amountFromRow`/`amountFromTotal` in exactly the three places
   *  a draft learns its amount from a row/receiptTotal — `buildDraftForRow`,
   *  `applyReceiptTotal`, `applyLayoutAmount`'s one-row branch (all
   *  statementDrafts.ts). Carried on the draft OBJECT rather than looked up
   *  by queue index, because `rowsToDrafts` drops zero-value rows, so
   *  `drafts[i]` is not `layout.rows[i]` (criterion 4's index-drift
   *  regression). Drives the review card's `RowSnippet`; unset for every
   *  chat-parsed draft. */
  sourceBand?: SourceBand;
  /** Review-only, same lifetime/rule as `sourceBand` above (set alongside
   *  it, in the same three places, never by index) — the band of just the
   *  LINE carrying the amount, a strict subset of `sourceBand`. Lets the
   *  review card's `RowSnippet`/`computeSnippetWindow` guarantee the amount
   *  stays visible even when `sourceBand` itself is taller than the strip
   *  (row-snippet-spec.md §4.4/D4 — a top-anchored clip on a real ocbc
   *  fixture hid the amount entirely on every row). */
  sourceAmountBand?: SourceBand;
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
  // Ask, never convert (CLAUDE.md #3 — no FX, no rates, no network call): a
  // parsed currency that conflicts with the account's own is never stored —
  // the account's currency always wins, and the conflict is flagged on the
  // draft instead so the confirm card can require the user to re-enter the
  // amount themselves. See currencyConflict's own header for the bug this
  // closes.
  const hasCurrencyConflict = currencyConflict(parsed.currency, account.currency);

  const draft: TransactionDraft = {
    accountId: account.id,
    type: parsed.type!,
    amount: parsed.amount!,
    currency: account.currency,
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
    ...(parsed.pending ? { pending: true } : {}),
    ...(hasCurrencyConflict ? { mismatchedCurrency: parsed.currency } : {}),
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
    // Truncated to the schema's cap (surrogate-safe — see truncateSourceText)
    // — an unbounded raw utterance/OCR scan (e.g. a long receipt) would
    // otherwise fail transactionSchema.parse and make the transaction
    // permanently unsaveable (assessment H2). The draft itself keeps the
    // full text for display; only the persisted value caps. Nullish (not
    // truthy) check so an empty string passes through unchanged rather than
    // collapsing to null.
    sourceText: draft.sourceText != null ? truncateSourceText(draft.sourceText) : null,
    // draft.pending is `true` only when interpret() carried a guard-checked
    // FM pending signal (textHasPendingMarker) or the user toggled it in the
    // confirm-edit sheet (see onEditSave in app/(tabs)/index.tsx); otherwise
    // a freshly-parsed draft starts counted.
    pending: draft.pending ?? false,
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
  // Same ask-never-convert rule as the non-transfer path above — compared
  // against the SOURCE account, since that's whose currency `accountId`
  // (and therefore the stored transaction) carries.
  const hasCurrencyConflict = currencyConflict(parsed.currency, source.currency);

  const draft: TransactionDraft = {
    accountId: source.id,
    type: 'transfer',
    amount: parsed.amount!,
    currency: source.currency,
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
    ...(parsed.pending ? { pending: true } : {}),
    ...(hasCurrencyConflict ? { mismatchedCurrency: parsed.currency } : {}),
  };

  return { kind: 'confirm', draft, message: summarize(draft) };
}
