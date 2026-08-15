/**
 * Deterministic transaction-OP candidacy gate
 * (docs/design/chat-transaction-delete-update-spec.md §5.1) — the THIRD
 * intent domain in the unified gate (src/domain/intentGate.ts), checked
 * AFTER the query and account gates: decides — without ever asking a model —
 * whether free text asks to DELETE or UPDATE a transaction the user has
 * ALREADY recorded ("delete my last transaction", "fix the amount on my
 * last one to 30"), as opposed to recording a NEW expense ("paid mum 50",
 * already excluded — see below), an account command ("delete my savings
 * account" — already claimed by detectAccountIntent), or a question
 * (already claimed by detectQueryIntent).
 *
 * Only on a hit does the model contract ever run
 * (src/domain/transactionOpSelection.ts) — and even then the model NEVER
 * identifies WHICH transaction (spec §2): this gate only decides CANDIDACY
 * (is the text about an existing row at all), never resolves a row itself.
 * That is src/domain/transactionCandidates.ts's job, downstream, entirely
 * deterministic too. The model emits one enum; the user picks the row.
 *
 * A hit requires BOTH:
 *  (a) a mutation verb — delete/remove/undo/"get rid of"/scratch (DELETE-
 *      flavoured, spec's own floor classification for these) or
 *      edit/change/update/fix/amend/correct (UPDATE-flavoured). When both a
 *      delete- and an update-flavoured verb appear, delete wins (mirrors
 *      accountIntent.ts's own "destructive intent should not be silently
 *      downgraded" category-priority ordering).
 *  (b) an existing-transaction REFERENCE — a ledger noun (see LEDGER_NOUNS
 *      below — plural forms accepted too, a deliberate widening past the
 *      spec's literal singular list: "delete all my transactions" needs the
 *      plural to even name a noun for the bulk veto to find), a recency
 *      marker (last/latest/previous/most recent/just added), or a date
 *      phrase one of the EXISTING resolvers (deviceParsePrompt.ts's
 *      resolveRelativeDate/resolveAbsoluteDate) recognises — no new date
 *      parsing.
 *
 * Two vetoes, checked first (the spec's third — the account-noun veto — is
 * handled entirely by GATE ORDERING: detectAccountIntent runs before this
 * gate in intentGate.ts, so an account-shaped hit is claimed before this
 * function ever runs; see accountIntent.ts's ledger-noun veto for the one
 * collision ordering alone didn't fix, spec §5.1.1):
 *
 *  1. STATED-AMOUNT veto — reuses queryIntent.ts's "STATES vs ASKS" doctrine
 *     (`hasStatedAmount`, exported from there for this reuse): a bare amount
 *     with NEITHER a recency marker, NOR a ledger noun, NOR a date phrase is
 *     someone recording a NEW expense, not referencing an old one — veto,
 *     falls through to the expense ladder, model never runs.
 *
 *     In practice this can only ever fire when requirement (b) would
 *     ALSO independently fail (if any of the three reference signals is
 *     present, the veto's own exemption already covers it) — "paid mum 50"
 *     itself is actually excluded earlier, by requirement (a): "paid" isn't
 *     one of the mutation verbs above at all, so it never reaches this
 *     veto's check. Kept as its own explicit, separately-named guardrail
 *     anyway (not "optimised away" into requirement (b)) so the safety
 *     property stays visible/auditable if requirement (b)'s reference
 *     vocabulary ever widens later. Symmetrically "change yesterday's lunch
 *     to 15" carries a verb AND a reference (the date phrase "yesterday"),
 *     so the stated amount (15) does not veto it — date phrases are exempt
 *     from this veto exactly like ledger nouns/recency markers (the spec's
 *     own worked example).
 *  2. BULK veto — "all"/"every"/"each" near a ledger noun ("delete all my
 *     transactions"), or bare "everything" alone (its own unconditional
 *     trigger — "delete everything" has no separate noun to be "near", the
 *     word itself already means "every transaction") → not a candidate.
 *     This is the probe's [SAFETY] case: the text falls through to the
 *     expense ladder, which finds no amount and replies with its existing
 *     generic "couldn't parse that" — a plain refusal that executes
 *     nothing, with no special-cased UI needed.
 *
 * ── RULE: no gate change without corpus cases added first ──────────────────
 * Same discipline as queryIntent.ts's and accountIntent.ts's own headers —
 * this gate's vocabulary WILL accrete edge cases exactly like theirs did. Any
 * change to the verb/reference/veto lists below must land with new labeled
 * lines in tests/intent-corpus.jsonl FIRST (a case that fails on the OLD
 * code, passes on the NEW code), checked by
 * tests/__steps__/intent-corpus.steps.ts and `npm run eval:intent`.
 */
import { escapeRegExp } from './textMatch';
import { hasStatedAmount } from './queryIntent';
import { resolveRelativeDate, resolveAbsoluteDate } from './deviceParsePrompt';

export type TransactionOpVerbCategory = 'delete' | 'update';

/** A gate hit — `verbCategory` is the DETERMINISTIC floor classification
 *  (spec §5.2 "floor behaviour": when no engine is available, the app falls
 *  back to this verb category rather than refusing outright — safe because
 *  the picker, not the classifier, protects the data). The model, when
 *  available, still gets the final say via the one-enum contract; this is
 *  only the last-resort fallback. */
export interface TransactionOpCandidate {
  verbCategory: TransactionOpVerbCategory;
}

function boundaryAlternation(words: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${words.map(escapeRegExp).join('|')})\\b`);
}

/** Delete-flavoured mutation verbs (spec §5.1(a)). */
const DELETE_VERBS = ['delete', 'remove', 'undo', 'get rid of', 'scratch'] as const;
/** Update-flavoured mutation verbs (spec §5.1(a)). */
const UPDATE_VERBS = ['edit', 'change', 'update', 'fix', 'amend', 'correct'] as const;
const DELETE_VERB_RE = boundaryAlternation(DELETE_VERBS);
const UPDATE_VERB_RE = boundaryAlternation(UPDATE_VERBS);

/** Ledger nouns (spec §5.1(b)) naming an EXISTING recorded row. Plural forms
 *  are a deliberate widening past the spec's literal singular list (see the
 *  module header) — exported so accountIntent.ts's §5.1.1 ledger-noun veto
 *  shares this EXACT vocabulary rather than a second, driftable copy. */
const UNAMBIGUOUS_LEDGER_NOUNS = [
  'transaction', 'transactions',
  'entry', 'entries',
  'expense', 'expenses',
  'purchase', 'purchases',
  'charge', 'charges',
  'payment', 'payments',
  'record', 'records',
] as const;
/** Bare pronouns — carry no lexical content of their own, so (unlike the
 *  unambiguous nouns above) whether they're a REFERENCE at all depends on
 *  what precedes them; see CONDITIONAL_CLAUSE_LEAD_RE / hasLedgerNounReference. */
const PRONOUN_LEDGER_NOUNS = ['one', 'it', 'that'] as const;

export const LEDGER_NOUNS = [...UNAMBIGUOUS_LEDGER_NOUNS, ...PRONOUN_LEDGER_NOUNS] as const;
const UNAMBIGUOUS_LEDGER_NOUN_RE = boundaryAlternation(UNAMBIGUOUS_LEDGER_NOUNS);
const PRONOUN_LEDGER_NOUN_RE = boundaryAlternation(PRONOUN_LEDGER_NOUNS);

/** Conditional/subordinating words that, immediately before a bare pronoun
 *  ("it"/"one"/"that"), mean the pronoun refers to whatever the CLAUSE is
 *  about (a balance, a plan, …) rather than an existing transaction —
 *  QA-found device regression: "update me on my balance WHEN IT gets to
 *  500" is an alert request, not a reference to a recorded row. Mirrors
 *  accountIntent.ts's own QA MAJOR B structural fix for the identical
 *  "when/if" clause shape on its rebalance-by-name trigger. Deliberately
 *  scoped to the PRONOUN forms only — the unambiguous nouns carry their own
 *  lexical meaning regardless of what precedes them ("if THAT PAYMENT
 *  clears" is still genuinely about a transaction). */
const CONDITIONAL_CLAUSE_LEAD_RE = /\b(?:when|if|unless)\s*$/;

/** Requirement (b)'s ledger-noun pathway: the unambiguous nouns match
 *  anywhere; a bare pronoun only counts when NOT immediately preceded by a
 *  conditional/subordinating word (see CONDITIONAL_CLAUSE_LEAD_RE). */
function hasLedgerNounReference(t: string): boolean {
  if (UNAMBIGUOUS_LEDGER_NOUN_RE.test(t)) return true;
  const re = new RegExp(PRONOUN_LEDGER_NOUN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const before = t.slice(0, m.index);
    if (!CONDITIONAL_CLAUSE_LEAD_RE.test(before)) return true;
  }
  return false;
}

/** Recency markers (spec §5.1(b)). */
const RECENCY_MARKERS = ['last', 'latest', 'previous', 'most recent', 'just added'] as const;
const RECENCY_MARKER_RE = boundaryAlternation(RECENCY_MARKERS);

/** True when `t` contains one of the recency markers above — exported so
 *  transactionCandidates.ts's `buildCandidateFilter` (spec §5.3) can read the
 *  SAME "latest" signal this gate already recognises, rather than a second
 *  copy of the word list. */
export function hasRecencyMarker(t: string): boolean {
  return RECENCY_MARKER_RE.test(t);
}

/** A fixed reference instant used ONLY to ask the EXISTING date resolvers
 *  "does this text name a date phrase at all" (spec §5.1(b)'s third
 *  reference pathway). The match/no-match outcome of resolveRelativeDate /
 *  resolveAbsoluteDate never actually depends on which instant is passed
 *  (their phrase regexes are `now`-independent; `now` only scales the
 *  RESOLVED epoch value, which this presence-only check throws away) — so a
 *  fixed constant keeps this function pure and clock-independent, exactly
 *  like its sibling gates (queryIntent.ts, accountIntent.ts), instead of
 *  threading a live `now` through detectIntent's whole call chain just for a
 *  yes/no check.
 */
const DATE_PRESENCE_PROBE_NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

function hasDatePhrase(t: string): boolean {
  return (
    resolveRelativeDate(t, DATE_PRESENCE_PROBE_NOW) != null ||
    resolveAbsoluteDate(t, DATE_PRESENCE_PROBE_NOW) != null
  );
}

/** Requirement (b): an existing-transaction reference — any of the three
 *  pathways (ledger noun, recency marker, date phrase). */
function hasReference(t: string): boolean {
  return hasLedgerNounReference(t) || hasRecencyMarker(t) || hasDatePhrase(t);
}

/** Bare "everything" — its own unconditional bulk trigger (see the module
 *  header's veto-2 note). */
const BULK_ALONE_RE = /\beverything\b/;

/** "all"/"every"/"each", followed within a short span (0-3 filler words —
 *  covers a determiner/possessive like "all MY transactions") by a ledger
 *  noun. Unlike bare "everything", these three are ordinary quantifier words
 *  that need a nearby ledger noun to mean "every transaction" specifically,
 *  rather than firing on any unrelated "all"/"every"/"each" in ordinary
 *  prose. */
const BULK_ADJACENT_LEDGER_NOUN_RE = new RegExp(
  `\\b(?:all|every|each)\\b(?:\\s+[a-z']+){0,3}\\s+(?:${LEDGER_NOUNS.join('|')})\\b`
);

function isBulkVeto(t: string): boolean {
  return BULK_ALONE_RE.test(t) || BULK_ADJACENT_LEDGER_NOUN_RE.test(t);
}

/**
 * Deterministic transaction-op candidacy gate. Returns
 * `{ verbCategory }` on a hit, or `null` when the text isn't recognised as a
 * DELETE/UPDATE request about an already-recorded transaction — including an
 * ordinary new expense ("paid mum 50"), a bulk request ("delete everything"),
 * and anything an earlier gate (query, account) already claims. See the
 * module header for the full requirement/veto rationale.
 */
export function detectTransactionOpCandidate(text: string): TransactionOpCandidate | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  // Requirement (a): a mutation verb. Delete-flavoured checked first — same
  // "destructive intent isn't silently downgraded" priority accountIntent.ts
  // uses for its own create/update/delete categories.
  const isDelete = DELETE_VERB_RE.test(t);
  const isUpdate = !isDelete && UPDATE_VERB_RE.test(t);
  if (!isDelete && !isUpdate) return null;

  // Veto 2 (bulk) — checked before requirement (b), per spec §5.1.
  if (isBulkVeto(t)) return null;

  const referenced = hasReference(t);

  // Veto 1 (stated amount) — see the module header for why this can never
  // actually fire without requirement (b) below also failing on its own;
  // kept explicit anyway.
  if (hasStatedAmount(t) && !referenced) return null;

  // Requirement (b): an existing-transaction reference.
  if (!referenced) return null;

  return { verbCategory: isDelete ? 'delete' : 'update' };
}
