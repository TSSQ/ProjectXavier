/**
 * Row → `TransactionDraft` — the second half of the statement-scan pipeline
 * (docs/design/statement-scan-spec.md §4.3/§4.5). Given the rows
 * `reconstructLayout` found and the user's grounding data (the account they
 * picked, their accounts/payees/categories/existing transactions, and a
 * clock), builds one draft per row: description cleanup, date resolution,
 * payee/category memory (reusing the same deterministic matchers the chat
 * path uses — no keyword-to-category guessing), a transfer hint, and a
 * likely-duplicate flag. Pure and framework-free; persistence and the
 * review queue live in the feature/screen layer.
 */
import { Account, Category, Payee, Transaction, TransactionType } from './types';
import { TransactionDraft } from './assistant';
import { StatementLayout, LayoutRow } from './statementLayout';
import { resolveAbsoluteDate } from './deviceParsePrompt';
import { localDayNoon, addLocalDays, isSameDay, formatDMY } from './dates';
import { toMinorUnits, formatMoney } from './money';
import { findPayeeMatch, PayeeMatch, normalizeName } from './payees';
import { findAccountMatch } from './accountMatch';
import { currencyConflict } from './currencyConflict';

/** A row's date line resolved to an epoch and whether it was actually
 *  guessed (no usable date text at all — occurredAt falls back to `now`). */
export interface ResolvedStatementDate {
  occurredAt: number;
  defaultedDate: boolean;
}

/** epoch ms at local noon for (year, month0, day). Mirrors the private
 *  helper of the same shape in deviceParsePrompt.ts — kept local here since
 *  that one isn't exported and this file needs only the year roll-back, not
 *  the full date-parsing surface. `resolveAbsoluteDate` itself (imported
 *  above) is plain regex parsing — no model call, despite living in a module
 *  that also builds the on-device prompt (criterion 17's source-grep targets
 *  the model-calling identifiers themselves, not this import). */
function localNoon(year: number, month0: number, day: number): number {
  return new Date(year, month0, day, 12, 0, 0, 0).getTime();
}

/** True for a leap year in the proleptic Gregorian calendar. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `ms` shifted one calendar year into the past, same month/day. Used only
 *  when `resolveAbsoluteDate`'s inferred-year result lands after `now` — a
 *  statement is never in the future, but `resolveAbsoluteDate` itself no
 *  longer rolls back (deviceParsePrompt.ts — that guard now belongs to
 *  whichever caller actually knows the text describes the past, which for a
 *  statement row is always true). 29 Feb clamps to 28 Feb when the rolled-
 *  back year isn't a leap year (reviewer MINOR 4) — the plain `Date`
 *  constructor would otherwise silently overflow into 1 March instead. */
function oneYearBefore(ms: number): number {
  const d = new Date(ms);
  const year = d.getFullYear() - 1;
  const month = d.getMonth();
  const day = d.getDate();
  const clampedDay = month === 1 && day === 29 && !isLeapYear(year) ? 28 : day;
  return localNoon(year, month, clampedDay);
}

/** Resolve a row's `dateText` (e.g. "25 Aug", "Today, 2 Sep 2026", bare
 *  "Today"/"Yesterday", or null) to an epoch, per spec §4.3.
 *
 *  1. `resolveAbsoluteDate` first — handles any printed calendar date,
 *     including one following "Today,"/"Yesterday," (so a printed date always
 *     wins over the device's own today). A result after `now` is rolled back
 *     one year (a statement is never in the future; `resolveAbsoluteDate`
 *     itself doesn't do this — see `oneYearBefore`) — and THAT roll-back
 *     itself is an assumption, not something read off the page, so it's
 *     flagged `defaultedDate: true` for the card to offer for confirmation
 *     (reviewer MINOR 4) — a printed date resolved WITHOUT a roll-back stays
 *     `defaultedDate: false`, same as before.
 *  2. A bare "Today"/"Yesterday" with no printed date falls back to the
 *     device's own today/yesterday.
 *  3. Anything else (including `dateText === null`) defaults to `now`,
 *     flagged `defaultedDate: true` for the card to offer for confirmation.
 */
export function resolveStatementDate(
  dateText: string | null,
  now: number
): ResolvedStatementDate {
  if (dateText == null) return { occurredAt: now, defaultedDate: true };

  const absolute = resolveAbsoluteDate(dateText, now);
  if (absolute != null) {
    if (absolute > now) {
      return { occurredAt: oneYearBefore(absolute), defaultedDate: true };
    }
    return { occurredAt: absolute, defaultedDate: false };
  }

  const trimmed = dateText.trim();
  if (/^today\b/i.test(trimmed)) {
    return { occurredAt: localDayNoon(now), defaultedDate: false };
  }
  if (/^yesterday\b/i.test(trimmed)) {
    return { occurredAt: addLocalDays(localDayNoon(now), -1), defaultedDate: false };
  }

  return { occurredAt: now, defaultedDate: true };
}

// ── Description cleanup (spec §4.3) ────────────────────────────────────────

const CARD_SUFFIX_RE = /^-\d{4}$/;
const LONG_DIGIT_RUN_RE = /\d{6,}/;
const NOISE_TOKENS = new Set([
  'ADV',
  'ADVICE',
  'OTHR',
  'ICT',
  'TRF',
  'SG',
  'SGP',
  'SINGAPORE',
  '•',
  '·',
  ':',
  '-',
]);
/** Longer suffix first, so "…SINGAPORE" (which doesn't itself end in "SG")
 *  is tried before the shorter "SG" fallback. */
const GLUED_SUFFIXES = ['SINGAPORE', 'SG'];
const EDGE_PUNCTUATION_RE = /^[\s"'.,;:!?()•·\-–—]+|[\s"'.,;:!?()•·\-–—]+$/g;

/** Strip a glued trailing SINGAPORE/SG from `token` when at least 3 letters
 *  remain (`InvestmentSINGAPORE` → `Investment`); otherwise `token` as-is. */
function unglueTrailing(token: string): string {
  const upper = token.toUpperCase();
  for (const suffix of GLUED_SUFFIXES) {
    if (upper.endsWith(suffix) && token.length > suffix.length) {
      const stripped = token.slice(0, token.length - suffix.length);
      const letters = stripped.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 3) return stripped;
    }
  }
  return token;
}

/** Cut an unmatched trailing "(" fragment ("OLD TEA HUT (CENTUR" → "OLD TEA
 *  HUT") — the last whitespace-delimited word only, when it opens a paren
 *  Vision never got to close. */
function cutUnmatchedTrailingParen(joined: string): string {
  const words = joined.split(' ');
  const last = words[words.length - 1];
  if (last && last.includes('(') && !last.includes(')')) {
    return words.slice(0, -1).join(' ').trim();
  }
  return joined;
}

/** Deterministic description cleanup, on whitespace tokens, in spec order
 *  (§4.3): drop the card suffix, drop long reference numbers, drop bank/
 *  noise tokens, un-glue a trailing SINGAPORE/SG, join + cut a dangling
 *  paren fragment + collapse whitespace + trim edge punctuation. Empty
 *  result → caller sets payeeName = null, defaulted.payee = true. */
export function cleanDescription(raw: string): string {
  let tokens = raw.split(/\s+/).filter(Boolean);
  tokens = tokens.filter((t) => !CARD_SUFFIX_RE.test(t));
  tokens = tokens.filter((t) => !LONG_DIGIT_RUN_RE.test(t));
  tokens = tokens.filter((t) => !NOISE_TOKENS.has(t.toUpperCase()));
  tokens = tokens.map(unglueTrailing);

  let joined = tokens.join(' ').replace(/\s+/g, ' ').trim();
  joined = cutUnmatchedTrailingParen(joined);
  joined = joined.replace(/\s+/g, ' ').trim();
  joined = joined.replace(EDGE_PUNCTUATION_RE, '').trim();
  return joined;
}

// ── Statement-only payee matching ──────────────────────────────────────────

/** Shortest a candidate payee name may be to stand as a whole-word prefix
 *  match below — guards against a too-short name ("Old") claiming almost
 *  any longer description. */
const STATEMENT_PAYEE_PREFIX_MIN_LEN = 4;

/**
 * `findPayeeMatch` layered with a statement-only third net (spec §4.3): bank
 * descriptions are routinely "<merchant> <legal suffix / branch>" ("Kopitiam
 * Investment", "NTUC FairPrice App") — `findPayeeMatch`'s generic fuzzy /
 * whole-word-variant nets are tuned for typed input, where a short common
 * word matching everything is a real false-positive risk, and rightly reject
 * these as too different from a bare "Kopitiam" or "NTUC" (the ≥50%-length
 * `isWholeWordVariant` guard, and the edit-distance budget, both correctly
 * say no). Loosening `findPayeeMatch` itself would relax that guard for
 * every typed-input caller too, so this is its own function instead.
 *
 * `exact`/`suggestion` from `findPayeeMatch` win outright and pass through
 * unchanged. Otherwise: a payee whose normalised name is ≥4 chars AND is a
 * whole-word PREFIX of the normalised description (the description equals
 * the payee name, or starts with the payee name plus a space) is offered as
 * `suggestion` — never `exact`, so adoption is still the user's own tap on
 * "Use X" (the card's existing suggestion chip), same as any other
 * near-miss. When several payees qualify, the LONGEST name wins ("NTUC
 * FairPrice" over "NTUC"), since a longer prefix match is a more specific —
 * and so more likely correct — merchant identification.
 */
export function findStatementPayeeMatch(name: string, existing: Payee[]): PayeeMatch {
  const result = findPayeeMatch(name, existing);
  if (result.exact || result.suggestion) return result;

  const target = normalizeName(name);
  if (!target) return result;

  let best: Payee | undefined;
  let bestLen = 0;
  for (const p of existing) {
    const cand = normalizeName(p.name);
    if (cand.length < STATEMENT_PAYEE_PREFIX_MIN_LEN) continue;
    if (target === cand || target.startsWith(`${cand} `)) {
      if (cand.length > bestLen) {
        best = p;
        bestLen = cand.length;
      }
    }
  }
  return best ? { suggestion: best } : result;
}

// ── Transfer hint ───────────────────────────────────────────────────────────

/** Checked against the row's RAW (uncleaned) description — the transfer
 *  vocabulary itself (TRF, ICT, …) is exactly what cleanup drops. */
const TRANSFER_HINT_RE = /\b(TRF|ICT|TRANSFER|TOP-?UP|PAYNOW|FAST|GIRO|IBFT)\b/i;

// ── Likely duplicate ────────────────────────────────────────────────────────

/** Same amount, same type, same local calendar day, and same account —
 *  flags, never removes, a draft (spec §4.3, criterion 12). No
 *  `|| draft.defaulted.account` fallback: unlike the chat path, a
 *  statement-scan draft's `accountId` is ALWAYS the account the user picked
 *  up front (§4.4 point 4 — `defaulted.account` is hardcoded `false` in
 *  `buildDraftForRow`), so that clause was dead on this path (reviewer
 *  MINOR 9). */
export function findLikelyDuplicate(
  draft: Pick<TransactionDraft, 'amount' | 'type' | 'occurredAt' | 'accountId'>,
  existing: Transaction[]
): { id: string; label: string } | null {
  const match = existing.find(
    (tx) =>
      tx.amount === draft.amount &&
      tx.type === draft.type &&
      isSameDay(tx.occurredAt, draft.occurredAt) &&
      tx.accountId === draft.accountId
  );
  if (!match) return null;
  return {
    id: match.id,
    label: `${formatMoney(match.amount, match.currency)} on ${formatDMY(match.occurredAt)}`,
  };
}

// ── Row → draft ──────────────────────────────────────────────────────────

export interface StatementDraftContext {
  /** The account the user picked up front (AccountPickerSheet) — every
   *  drafted row belongs to it; §4.4 point 4. */
  account: Account;
  accounts: Account[];
  payees: Payee[];
  categories: Category[];
  existing: Transaction[];
  now: number;
}

/** Cap on rows accepted per scan (spec §6) — enforced by the caller (the
 *  screen, via `chooseScanRoute` below, docs/design/unified-scan-spec.md
 *  §4.1) rather than here; `rowsToDrafts` itself has no opinion on count. */
export const MAX_STATEMENT_ROWS = 60;

// ── Scan routing ─────────────────────────────────────────────────────────

/** Where a scanned photo's layout should go next
 *  (docs/design/unified-scan-spec.md §4.1). */
export type ScanRoute =
  | { kind: 'queue'; rowCount: number } // ≥ 2 amount rows → account ask + one card per row
  | { kind: 'single' } // 0–1 rows, or a receipt → one transaction via the text parse
  | { kind: 'too_many'; rowCount: number }; // > maxRows → ask for two screenshots

/** Decides what a scanned photo's layout becomes: a review queue, one
 *  transaction, or a "too many rows" refusal (docs/design/unified-scan-
 *  spec.md §4.1). Pure — the screen owns everything downstream (account
 *  choice, `runParse`, `beginStatementQueue`).
 *
 *  Rules, in order:
 *  1. `layout.kind === 'receipt'` → `single`, always — a receipt is one
 *     purchase no matter how many item lines it has. Its `rows` are `[]` by
 *     construction (statement-scan-spec §4.2 rule 6), but this rule is
 *     checked FIRST so the routing doesn't rely on that construction detail.
 *  2. Otherwise, `rowCount` = the rows with `value > 0` — the same filter
 *     `rowsToDrafts` applies, so a zero-value row never tips the decision.
 *  3. `rowCount > maxRows` → `too_many`.
 *  4. `rowCount >= 2` → `queue`.
 *  5. Otherwise → `single` (covers `kind: 'single'` and `kind: 'unknown'`).
 *
 *  `kind` is deliberately consulted only in rule 1: the question the user
 *  asked for is "how many transactions are in this picture", and counting
 *  rows keeps the answer honest even if `kind`'s own definition drifts. */
export function chooseScanRoute(
  layout: Pick<StatementLayout, 'kind' | 'rows'>,
  maxRows: number = MAX_STATEMENT_ROWS
): ScanRoute {
  if (layout.kind === 'receipt') return { kind: 'single' };
  const rowCount = layout.rows.filter((r) => r.value > 0).length;
  if (rowCount > maxRows) return { kind: 'too_many', rowCount };
  if (rowCount >= 2) return { kind: 'queue', rowCount };
  return { kind: 'single' };
}

function buildDraftForRow(row: LayoutRow, ctx: StatementDraftContext): TransactionDraft {
  const type: TransactionType = row.sign === '+' ? 'income' : 'expense';
  const { occurredAt, defaultedDate } = resolveStatementDate(row.dateText, ctx.now);
  const cleaned = cleanDescription(row.description);

  let payeeName: string | null = cleaned || null;
  let categoryName: string | null = null;
  let defaultedPayee = !cleaned;
  let defaultedCategory = true;

  if (cleaned) {
    // findStatementPayeeMatch, not findPayeeMatch directly, so there's one
    // entry point for statement payee matching — behaviour for `exact` is
    // identical either way (see findStatementPayeeMatch); its extra
    // prefix-match net only ever produces a `suggestion`, which is
    // presentation-only and computed by the screen, not adopted here.
    const match = findStatementPayeeMatch(cleaned, ctx.payees);
    if (match.exact) {
      payeeName = match.exact.name;
      const category = match.exact.defaultCategoryId
        ? ctx.categories.find((c) => c.id === match.exact!.defaultCategoryId)
        : undefined;
      categoryName = category ? category.name : null;
      defaultedCategory = false;
    }
  }

  let draftType: TransactionType = type;
  let transferAccountId: string | null | undefined;
  let transferAccountName: string | null | undefined;
  const transferHint = TRANSFER_HINT_RE.test(row.description);

  if (transferHint && cleaned) {
    const otherAccounts = ctx.accounts.filter((a) => a.id !== ctx.account.id);
    const match = findAccountMatch(cleaned, otherAccounts);
    // >= 0.85 only (reviewer M1) — findAccountMatch's own subtype-cue rung
    // (0.7/0.75) is confident enough to ANSWER "which account?" in chat, but
    // not confident enough to silently turn a row into a transfer and throw
    // away its payee: "PAYNOW TO JANE CASH GIFT" against a cash account
    // matched the "cash" subtype cue at 0.7 and discarded "Jane" entirely.
    // 0.85 keeps only the name-based match levels (exact/token-containment);
    // criterion 9's PayLah match (findAccountMatch('TOP-UP TO PAYLAH! Alex',
    // …) === 0.85) still clears this bar.
    if (match && match.account && !match.ambiguous && match.confidence >= 0.85) {
      draftType = 'transfer';
      transferAccountId = match.account.id;
      transferAccountName = match.account.name;
      // Transfers carry neither payee nor category — same invariant
      // interpretTransfer() enforces for the chat path (assistant.ts).
      payeeName = null;
      categoryName = null;
      defaultedPayee = false;
      defaultedCategory = false;
    }
  }

  const draft: TransactionDraft = {
    accountId: ctx.account.id,
    type: draftType,
    amount: toMinorUnits(row.value, ctx.account.currency),
    currency: ctx.account.currency,
    categoryName,
    payeeName,
    note: null,
    occurredAt,
    source: 'ai',
    sourceText: `${row.description} ${row.amountText}`.trim(),
    defaulted: {
      account: false, // the user chose it — §4.4 point 4.
      payee: defaultedPayee,
      category: defaultedCategory,
      date: defaultedDate,
    },
    // The band rides on the draft OBJECT, set here where the draft is built
    // from THIS row — never looked up by queue index (row-snippet-spec.md
    // D2/criterion 4: rowsToDrafts drops zero-value rows, so drafts[i] is
    // not layout.rows[i]).
    sourceBand: row.band,
    sourceAmountBand: row.amountBand,
  };
  if (draftType === 'transfer') {
    draft.transferAccountId = transferAccountId;
    draft.transferAccountName = transferAccountName;
  } else if (transferHint) {
    draft.transferHint = true;
  }

  // A row that printed its OWN currency, differing from the account's —
  // "AMAZON MKTPLACE USD 12.99" against an SGD account (reviewer B3). Same
  // ask-never-convert posture as the chat path's own currencyConflict use
  // (assistant.ts's interpretTransfer/interpret): `amount`/`currency` above
  // already stay the account's own, so this is purely the card's warning +
  // Save→Edit reroute (DraftCard, onConfirm) — both already handle
  // `mismatchedCurrency` unchanged, since it's the exact field the chat
  // path sets too. A bare "$" (row.currency === null) is never a claim.
  if (currencyConflict(row.currency, ctx.account.currency)) {
    draft.mismatchedCurrency = row.currency;
  }

  const duplicateOf = findLikelyDuplicate(draft, ctx.existing);
  if (duplicateOf) draft.duplicateOf = duplicateOf;

  return draft;
}

/** Turn every row `reconstructLayout` found into a draft. A row whose
 *  printed value is 0 is dropped (`dropped` counts it) rather than producing
 *  a zero-amount transaction. */
export function rowsToDrafts(
  layout: StatementLayout,
  ctx: StatementDraftContext
): { drafts: TransactionDraft[]; dropped: number } {
  const drafts: TransactionDraft[] = [];
  let dropped = 0;
  for (const row of layout.rows) {
    if (row.value === 0) {
      dropped++;
      continue;
    }
    drafts.push(buildDraftForRow(row, ctx));
  }
  return { drafts, dropped };
}

/** A receipt handed to the statement path stays ONE transaction (spec §4.5):
 *  `layout.text` still goes through the existing `runParse` ladder for
 *  everything else, but when the layout itself found a TOTAL/Grand total/
 *  Amount due line, that printed number — not whatever the parse ladder
 *  guessed — becomes the draft's amount. Returns `draft` unchanged (same
 *  reference) when there's no receipt total to apply. */
export function applyReceiptTotal(
  draft: TransactionDraft,
  layout: Pick<StatementLayout, 'receiptTotal'>
): TransactionDraft {
  if (!layout.receiptTotal) return draft;
  return {
    ...draft,
    amount: toMinorUnits(layout.receiptTotal.value, draft.currency),
    amountFromTotal: true,
    sourceBand: layout.receiptTotal.band,
    // D6 (QA round 2): `band` unions the TOTAL-label line with the amount
    // line, which is NOT always tight — footer copy, a QR block or a
    // thank-you line between them makes that union tall enough to clip the
    // amount itself. `amountBand` is the amount's own line alone; there are
    // no "already tight" exemptions, so this is never set to `band`.
    sourceAmountBand: layout.receiptTotal.amountBand,
  };
}

/** The single-transaction path's amount (and, where safe, type) override
 *  (docs/design/unified-scan-spec.md §9 follow-up 1, taken early) — the
 *  text parse ladder (FM or the heuristic floor) reads from `layout.text`,
 *  which has no idea which token is the real amount; a card suffix like
 *  "-4008" can outrank the real total at high confidence (reviewer repro:
 *  `localParse` returned 400800 for a PayLah notification whose printed
 *  amount was SGD 23.40). When the layout ITSELF found exactly one
 *  fully-read row, that printed number is the ground truth and replaces
 *  whatever the parse guessed.
 *
 *  Rule order:
 *  1. `layout.receiptTotal` set → delegate to `applyReceiptTotal` (a
 *     receipt's TOTAL line always wins when both could apply).
 *  2. Else, a single-row, fully-read, positive layout (`kind === 'single'`,
 *     `unreadRows === 0`, exactly one row, `value > 0`) → the row's value
 *     becomes the amount (`toMinorUnits(row.value, draft.currency)` —
 *     never a silent conversion, ask-never-convert CLAUDE.md #3), flagged
 *     `amountFromRow`. The type is corrected from the row's own printed
 *     sign, mirroring `buildDraftForRow` (QA MAJOR 2 — a bare heuristic
 *     parse has no way to see a PayNow `+` and can default a genuine
 *     credit to expense): unless the text parse already decided
 *     `'transfer'` (left alone — the row can't know the destination
 *     account), `sign: '+'` forces `type: 'income'`, `sign: '-'` forces
 *     `type: 'expense'`, and `sign: '?'` leaves the text parse's own type
 *     untouched. When the row printed its OWN currency and it conflicts
 *     with the draft's (`currencyConflict`, reviewer S1/S2 — same
 *     queue-path semantics as `buildDraftForRow`'s `mismatchedCurrency`),
 *     the amount/type overrides still apply (the row is still the best
 *     available number) but `mismatchedCurrency` is set too, so the card
 *     warns and Save reroutes to Edit exactly as the queue path does.
 *  3. Otherwise, `draft` is returned unchanged (same reference) — a
 *     multi-line receipt with no total, an unread row, or a zero-value row
 *     all fall through rather than override an honestly-parsed amount with
 *     a row the layout couldn't fully trust.
 *
 *  Only the amount, type, and the presentation-only flags ever change —
 *  date, payee and category stay whatever the text parse decided. */
export function applyLayoutAmount(
  draft: TransactionDraft,
  layout: Pick<StatementLayout, 'kind' | 'rows' | 'receiptTotal' | 'unreadRows'>
): TransactionDraft {
  if (layout.receiptTotal) return applyReceiptTotal(draft, layout);
  const row = layout.rows[0];
  if (
    layout.kind === 'single' &&
    layout.unreadRows === 0 &&
    layout.rows.length === 1 &&
    row &&
    row.value > 0
  ) {
    const next: TransactionDraft = {
      ...draft,
      amount: toMinorUnits(row.value, draft.currency),
      amountFromRow: true,
      sourceBand: row.band,
      sourceAmountBand: row.amountBand,
    };
    if (draft.type !== 'transfer') {
      if (row.sign === '+') next.type = 'income';
      else if (row.sign === '-') next.type = 'expense';
      // sign === '?': leave the text parse's own type alone.
    }
    if (currencyConflict(row.currency, draft.currency)) {
      next.mismatchedCurrency = row.currency;
    }
    return next;
  }
  return draft;
}
