/**
 * Deterministic transaction candidate resolution — the row-picking half of
 * chat delete/update (docs/design/chat-transaction-delete-update-spec.md
 * §5.3/§5.4). The model only ever emits `'delete' | 'update'`
 * (transactionOpSelection.ts); EVERYTHING here is pure, synchronous, and
 * model-free — narrowing the ledger from the user's own words, ranking the
 * survivors, and deciding how many to show. The user always taps the actual
 * row; nothing here writes anything.
 *
 * Framework-free (no RN/Expo imports) so it's exhaustively BDD-tested in
 * plain Node, injected clock throughout — never `Date.now()` in this module.
 */
import { Transaction, Account, Payee } from './types';
import { mentionedInText, resolveRelativeDate, resolveAbsoluteDate } from './deviceParsePrompt';
import { resolvePeriodFromText, resolvePeriodRange } from './periodRange';
import { hasRecencyMarker } from './transactionOpIntent';
import { isSameDay } from './dates';
import { toMinorUnits } from './money';

// ─── §5.3 — deterministic pre-filter (text -> constraints) ────────────────

export interface TransactionCandidateFilter {
  /** A single calendar day ("yesterday", "24th June") — resolveRelativeDate
   *  / resolveAbsoluteDate, epoch ms at local noon. Mutually exclusive with
   *  `range` (see buildCandidateFilter). */
  onDate: number | null;
  /** A period ("this month", "last week") — resolvePeriodFromText, resolved
   *  to a concrete `[start, end)`. */
  range: { start: number; end: number } | null;
  /** A recency marker ("last", "latest", "just added") was named — the
   *  ranked list is truncated to the single most recent match regardless of
   *  how many otherwise qualify (spec §5.1(b)/§5.4). */
  latest: boolean;
  payeeId: string | null;
  accountId: string | null;
  /** Minor units. Currency-anchored only ("$50") — see
   *  `extractAnchoredAmount`'s header for why a bare number is excluded. */
  amountMinor: number | null;
}

export interface CandidateFilterContext {
  payees: Payee[];
  accounts: Account[];
  /** Injected clock — never Date.now() inside this module. */
  now: number;
  /** Active currency (getCurrency()) — scales `amountMinor` to the right
   *  exponent, same convention as deviceParsePrompt.ts/localParse.ts. */
  currency: string;
}

/** A CURRENCY-SYMBOL-ANCHORED amount only ("$50", "£20.50") — deliberately
 *  narrower than localParse.ts's amount extraction (which also accepts bare
 *  numbers and verb-adjacency): a bare digit run in a delete/update request
 *  collides too easily with an unrelated quantity ("delete the transaction
 *  from 3 days ago", "remove my last 2 entries"). A false positive here
 *  becomes a wrong HARD FILTER that could coincidentally still match some
 *  other row (never producing the empty result the cascade needs to notice
 *  and recover from) — unlike the date/payee/account constraints, which all
 *  come from resolvers already proven against a real corpus. An explicit
 *  currency symbol is the one shape unambiguous enough to trust. */
const ANCHORED_AMOUNT_RE = /[$£€]\s?(\d[\d,]*(?:\.\d+)?)/;

function extractAnchoredAmount(text: string, currency: string): number | null {
  const m = ANCHORED_AMOUNT_RE.exec(text);
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return toMinorUnits(value, currency);
}

/** True when `item.name` (a real payee/account) appears as a whole word/
 *  phrase in `text`, exact match only — see buildCandidateFilter's header
 *  for why fuzzy matching is deliberately excluded here. */
function resolveExactMention<T extends { id: string; name: string }>(
  text: string,
  items: readonly T[]
): string | null {
  const matches = items.filter((item) => mentionedInText(item.name, text));
  return matches.length === 1 ? matches[0]!.id : null;
}

/**
 * Extract every deterministic constraint the text states, each from an
 * EXISTING corpus-tested resolver — no new date parsing. Payee/account
 * matching is EXACT only (mentionedInText, the same "does this known name
 * literally appear in the text" primitive the AI-parse grounding guards
 * use): a fuzzy/typo hit WIDENS the candidate list rather than filtering it,
 * so a misspelled payee never silently hides the right row.
 *
 * `onDate`/`range` are mutually exclusive: a single-day phrase
 * (resolveRelativeDate/resolveAbsoluteDate — "yesterday", "24th June") is
 * checked only when resolvePeriodFromText found no period phrase ("this
 * month", "last week") — the one phrase both could theoretically claim
 * ("last week") is a genuine PERIOD to a user narrowing a search, so the
 * period reading wins; resolveRelativeDate's OWN single-day-per-"last week"
 * reading exists for a different job (dating a brand-new expense) and isn't
 * what a search narrows by.
 */
export function buildCandidateFilter(
  text: string,
  ctx: CandidateFilterContext
): TransactionCandidateFilter {
  const trimmed = text.trim();
  const t = trimmed.toLowerCase();

  const periodSpec = resolvePeriodFromText(trimmed, ctx.now);
  const range = periodSpec ? resolvePeriodRange(periodSpec, ctx.now) : null;
  const onDate = range
    ? null
    : (resolveRelativeDate(trimmed, ctx.now) ?? resolveAbsoluteDate(trimmed, ctx.now));

  return {
    onDate,
    range,
    latest: hasRecencyMarker(t),
    payeeId: resolveExactMention(trimmed, ctx.payees),
    accountId: resolveExactMention(trimmed, ctx.accounts),
    amountMinor: extractAnchoredAmount(trimmed, ctx.currency),
  };
}

// ─── §5.4 — ranking (pure, total, stable) ──────────────────────────────────

/** Score descending: exact date -> payee id -> exact amount -> account id ->
 *  in-range -> recency (spec §5.4). Power-of-two weights make this a strict
 *  lexicographic priority cascade — one higher-priority match always
 *  outweighs the SUM of every lower one — not a naive additive score where
 *  several weak signals could out-rank one strong one. */
function scoreOne(tx: Transaction, filter: TransactionCandidateFilter): number {
  let score = 0;
  if (filter.onDate != null && isSameDay(tx.occurredAt, filter.onDate)) score += 32;
  if (filter.payeeId != null && tx.payeeId === filter.payeeId) score += 16;
  if (filter.amountMinor != null && tx.amount === filter.amountMinor) score += 8;
  if (
    filter.accountId != null &&
    (tx.accountId === filter.accountId || tx.transferAccountId === filter.accountId)
  ) {
    score += 4;
  }
  if (
    filter.range != null &&
    tx.occurredAt >= filter.range.start &&
    tx.occurredAt < filter.range.end
  ) {
    score += 2;
  }
  return score;
}

/**
 * Deterministic, total, stable ranking (spec §5.4) — never mutates or drops
 * a row (that's `selectCandidates`'s job), always returns every input
 * transaction in SOME defined order. Ties broken by `occurredAt` desc then
 * `id` asc, so repeat calls over the same input are byte-identical (no
 * dependence on the input array's own order or on JS engine sort stability
 * quirks). `filter`'s constraint VALUES are used purely as scoring
 * signals here — including ones a caller may have already "dropped" for
 * hard-filtering purposes (selectCandidates) — a coincidental match still
 * deserves to rank higher among whichever survivors remain.
 */
export function rankCandidates(
  transactions: readonly Transaction[],
  filter: TransactionCandidateFilter
): Transaction[] {
  return [...transactions].sort((a, b) => {
    const diff = scoreOne(b, filter) - scoreOne(a, filter);
    if (diff !== 0) return diff;
    if (a.occurredAt !== b.occurredAt) return b.occurredAt - a.occurredAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ─── §5.3 — the cascade (never empties the list) ───────────────────────────

export type DroppedConstraint = 'amount' | 'payee' | 'account' | 'date';

/** Drop order: most specific first (spec §5.3). "date" covers BOTH `onDate`
 *  and `range` as one bucket — the filter shape only ever sets one of the
 *  two (see buildCandidateFilter), and the spec names four buckets, not
 *  five. */
const CASCADE_ORDER: readonly DroppedConstraint[] = ['amount', 'payee', 'account', 'date'];

function isActive(filter: TransactionCandidateFilter, constraint: DroppedConstraint): boolean {
  switch (constraint) {
    case 'amount':
      return filter.amountMinor != null;
    case 'payee':
      return filter.payeeId != null;
    case 'account':
      return filter.accountId != null;
    case 'date':
      return filter.onDate != null || filter.range != null;
  }
}

function matchesActive(
  tx: Transaction,
  filter: TransactionCandidateFilter,
  dropped: ReadonlySet<DroppedConstraint>
): boolean {
  if (!dropped.has('amount') && filter.amountMinor != null && tx.amount !== filter.amountMinor) {
    return false;
  }
  if (!dropped.has('payee') && filter.payeeId != null && tx.payeeId !== filter.payeeId) {
    return false;
  }
  if (!dropped.has('account') && filter.accountId != null) {
    const touchesAccount =
      tx.accountId === filter.accountId || tx.transferAccountId === filter.accountId;
    if (!touchesAccount) return false;
  }
  if (!dropped.has('date')) {
    if (filter.onDate != null && !isSameDay(tx.occurredAt, filter.onDate)) return false;
    if (
      filter.range != null &&
      (tx.occurredAt < filter.range.start || tx.occurredAt >= filter.range.end)
    ) {
      return false;
    }
  }
  return true;
}

export interface CandidateSelection {
  /** Ranked, ready to render — sized by `pickerSizeFor(candidates.length)`. */
  candidates: Transaction[];
  /** Which constraints the cascade had to drop (most-specific-first order)
   *  to avoid an empty result — empty when every stated constraint matched
   *  as-is. Lets the caller report "I couldn't match the amount exactly, so
   *  here's a wider list" (spec §5.3). */
  droppedConstraints: DroppedConstraint[];
}

/**
 * Resolve `filter` against the real ledger (spec §5.3/§5.4) — the single
 * entry point the chat screen calls. The filter NEVER empties the list as
 * long as `transactions` itself is non-empty: applied as a cascade, dropping
 * the most specific still-active constraint and retrying (amount -> payee ->
 * account -> date) whenever the current constraint set matches nothing. The
 * only way `candidates` comes back empty is an empty `transactions` array
 * (spec §9.4/§9.7 — never a silent no-op, the caller names what was
 * searched and offers "Open Transactions").
 *
 * `filter.latest` (spec §5.1(b)/§5.4): once the survivors are ranked, "my
 * LAST transaction" means exactly one row, not a menu — truncated to the
 * single top-ranked candidate regardless of how many otherwise qualify.
 */
export function selectCandidates(
  transactions: readonly Transaction[],
  filter: TransactionCandidateFilter
): CandidateSelection {
  const dropped = new Set<DroppedConstraint>();
  const droppedOrder: DroppedConstraint[] = [];
  let matched = transactions.filter((tx) => matchesActive(tx, filter, dropped));

  for (const constraint of CASCADE_ORDER) {
    if (matched.length > 0) break;
    if (!isActive(filter, constraint)) continue; // nothing to drop
    dropped.add(constraint);
    droppedOrder.push(constraint);
    matched = transactions.filter((tx) => matchesActive(tx, filter, dropped));
  }

  const ranked = rankCandidates(matched, filter);
  const candidates = filter.latest && ranked.length > 1 ? ranked.slice(0, 1) : ranked;
  return { candidates, droppedConstraints: droppedOrder };
}

// ─── §5.4 — picker sizing ───────────────────────────────────────────────────

export type PickerSize = 'none' | 'confirm' | 'inline' | 'sheet';

/** 0 -> no picker. 1 -> a confirm card (never auto-executed). 2-5 -> all
 *  shown inline. >5 -> top 3 inline + "Show all N" (spec §5.4 table). */
export function pickerSizeFor(count: number): PickerSize {
  if (count <= 0) return 'none';
  if (count === 1) return 'confirm';
  if (count <= 5) return 'inline';
  return 'sheet';
}

/** How many rows `pickerSizeFor`'s `'sheet'` size shows inline before
 *  "Show all N" (spec §5.4: "Top 3 inline"). */
export const SHEET_INLINE_PREVIEW_COUNT = 3;

// ─── §5.5/§9.5 — stale-row guard ────────────────────────────────────────────

/** The fields compared to detect a changed/stale row (spec §5.5): amount,
 *  occurredAt, accountId, payeeId, pending. */
export interface TransactionFingerprint {
  amount: number;
  occurredAt: number;
  accountId: string;
  payeeId: string | null;
  pending: boolean;
}

export function fingerprintTransaction(tx: Transaction): TransactionFingerprint {
  return {
    amount: tx.amount,
    occurredAt: tx.occurredAt,
    accountId: tx.accountId,
    payeeId: tx.payeeId ?? null,
    pending: tx.pending,
  };
}

/**
 * True when two fingerprints describe the SAME transaction state. Used
 * immediately before executing a delete/update (spec §5.5/§9.5): re-read the
 * row by id and compare fingerprints — on a mismatch (edited or deleted
 * elsewhere between render and tap), abort with no write.
 */
export function fingerprintsMatch(a: TransactionFingerprint, b: TransactionFingerprint): boolean {
  return (
    a.amount === b.amount &&
    a.occurredAt === b.occurredAt &&
    a.accountId === b.accountId &&
    a.payeeId === b.payeeId &&
    a.pending === b.pending
  );
}
