/**
 * Deterministic query-intent gate (docs/design/ask-xavier-queries-spec.md
 * §5.1) — the fourth intent domain alongside `detectAccountIntent`'s
 * create/update/delete (src/domain/accountIntent.ts). Decides — without ever
 * asking a model — whether free text is a QUESTION/REPORT about the user's
 * own data ("how much did I spend on dining", "show my accounts", "total
 * income this year") rather than an ordinary expense ("spent 20 on lunch") or
 * an account command ("rename my wallet").
 *
 * Runs BEFORE `detectAccountIntent` in `runParse` (app/(tabs)/index.tsx) and
 * in the unified gate the intent-corpus suite exercises
 * (tests/__steps__/intent-corpus.steps.ts) — a query-shaped lead ALWAYS wins
 * over whatever verb/noun a downstream gate might also match (see
 * tests/intent-corpus.jsonl's "show me how to add an account" case: the
 * report-verb lead "show me" wins even though the tail could otherwise read
 * as an account-creation command). `/transactions` (forceExpense) bypasses
 * every gate, this one included, exactly as it already bypasses
 * `detectAccountIntent`.
 *
 * ── RULE: no gate change without corpus cases added first ──────────────────
 * This file exists because the account-intent gate's own history (see
 * accountIntent.ts's header) shows hand-tuned regex gates accrete edge cases
 * fast. Going forward, ANY change to the patterns below — a new lead phrase,
 * a widened keyword set, a narrowed exclusion — must land with new labeled
 * lines in `tests/intent-corpus.jsonl` FIRST (a case that fails on the OLD
 * code, passes on the NEW code), not just a code diff. `npm run eval:intent`
 * is the human-readable pass/fail surface for that corpus; the corpus itself,
 * not this file's prose, is the source of truth for what the gate must do.
 *
 * Three shapes (spec §5.1), checked as ordered alternatives — order only
 * matters for two overlapping shapes both firing on the same text (harmless;
 * either reason is a query):
 *  1. Interrogative LEAD — "how/what('s)/which/who/when" at the very START of
 *     the (trimmed, lowercased) text. Leading-only (not "contains anywhere")
 *     is a deliberate choice mirroring accountIntent.ts's own
 *     position-anchoring discipline for bare "new": a mid-sentence "what" is
 *     common in ordinary prose ("I know what to do") and would otherwise
 *     over-fire. Bare "how" (QA recall follow-up — widened from the original
 *     "how much"/"how many" only) covers "how's my spending"/"how did I spend
 *     my money" — no realistic expense/account utterance STARTS with "how",
 *     so this is a safe, unconditional widening (unlike the keyword shape
 *     below, which does need an expense-shape exclusion).
 *  2. Report-verb LEAD — "show (me)/list/compare/chart/graph/breakdown/add up"
 *     at the start. "add up" (not in the spec's literal list, spec §5.1's
 *     bullet only names show/list/compare/chart/graph/breakdown) is a
 *     deliberate addition — spec §7 acceptance #1 explicitly requires "add up
 *     my dining" to classify as a query, and "add up" has no sensible reading
 *     as an expense/account command, so it's folded into this same lead list
 *     rather than invented as a fourth shape.
 *  3. Keyword SHAPE — anywhere in the text (no lead requirement): "net worth",
 *     "balance history", "biggest/largest/highest expense/spend/purchase/
 *     payment" (QA recall follow-up — "biggest expense last month" has no
 *     interrogative/report lead and no total/sum/average word, so needs its
 *     own trigger), OR one of total/sum/average CO-OCCURRING with one of
 *     spent/spend/spending/income/earned/expense/expenses — BUT ONLY when the
 *     text carries NO stated amount (see the QA blocker note below). The
 *     spend-word set is widened past the spec's literal list (spent/spend/
 *     spending/income/earned) to also include "expense"/"expenses" — "sum of
 *     my dining expenses" reads unambiguously as a query and the widening
 *     carries no extra collision risk on its own (an ordinary expense
 *     utterance never pairs "expense(s)" with "total/sum/average" — the
 *     amount guard below is what actually protects the OTHER, real collision).
 *
 * ── QA BLOCKER: keyword shape was swallowing STATED-AMOUNT expenses ────────
 * "spent 50 total on dinner", "45 total spent on groceries", "spent a total
 * of 50 on groceries", "spent 20 on average lunches" all wrongly matched the
 * total/sum/average + spend-word shape and were classified as queries — with
 * no expense-ladder fallback on a query-gate hit, the transaction was simply
 * never recorded (silent data loss). The real distinguisher is FRAMING: a
 * query ASKS ("how much did I spend…", already caught by the interrogative
 * lead above, checked FIRST), an expense STATES ("spent 50…"). So once we've
 * already established this ISN'T an interrogative/report-verb lead, a bare
 * NUMERIC AMOUNT anywhere in the text (`hasStatedAmount`) means the
 * total/sum/average+spend-word shape must NOT fire — that combination, with
 * a number and no question framing, is someone STATING what they spent, not
 * asking. Genuine keyword-shape queries never need a bare amount ("total
 * spent on groceries this month", "average spending per month") so this
 * costs no real recall. Deliberately scoped to ONLY the total/sum/average
 * shape — "net worth"/"balance history"/"biggest expense" phrases don't
 * naturally co-occur with a stated amount in ordinary expense speech, so they
 * stay unconditional.
 *
 * ── QA MAJOR A follow-up: the amount guard over-reached onto years/durations
 * A bare "any digit" test also caught a 4-digit YEAR ("total spent IN 2025")
 * and a DURATION ("average spend over the last 6 months") — neither is a
 * spent AMOUNT, so both were wrongly suppressed to `null` even though they
 * carry a real query lead-in (they're genuinely asking a report question,
 * just with a year/duration qualifier instead of "this month"). `hasStatedAmount`
 * now walks every digit run in the text and EXCLUDES two shapes before
 * deciding any of them counts as a "stated amount":
 *  - a 4-digit year (1900-2099) immediately preceded by "in" ("total spent
 *    IN 2025") — scoped to the "in <year>" phrasing specifically (not bare
 *    "spent 2000 on rent", where "2000" IS a real amount) so a genuine
 *    $2000-shaped amount is never misread as the year 2000 just because it
 *    happens to look like one.
 *  - a duration expression: the number immediately followed by a day/week/
 *    month/year unit ("6 months"), or immediately preceded by "last"/"past"/
 *    "next" ("the last 6 …"). Either shape describes a TIME SPAN, not money.
 * Any digit run that survives both exclusions is a genuine stated amount, and
 * the keyword shape still won't fire — "spent 50 total on dinner" keeps its
 * "50" (not a year, not a duration) and stays an expense (`null`).
 *
 * Deliberate, documented false-widening (spec §7 acceptance #1's "show me the
 * money" case — "decide + document"): the report-verb lead "show me" also
 * matches this common idiom, which isn't really asking to see a chart. This
 * gate still classifies it as a query. Rationale: (a) telling idiom from
 * literal ask would need world knowledge no deterministic gate has, (b) the
 * cost of the false-widening is low and honest — the query ladder's floor
 * tier answers "I can answer things like…" rather than mis-executing
 * anything (queries are read-only, spec §2), unlike a false positive on the
 * account gate which risks silently mutating data.
 *
 * Accepted gap (QA follow-up, documented not fixed): "am I over budget" has
 * no budget feature/tool at all in this app, so it correctly falls through
 * to `null` (no interrogative lead matches "am", no report-verb lead, no
 * keyword shape) — there is nothing for any tier to answer, and inventing a
 * shape for it would be building a feature, not fixing a gate.
 */

/** A gate hit. `reason` is informational only (which shape matched) — no
 *  caller branches on it; kept for debuggability/logging parity with
 *  `AccountIntent`'s `subtypeHint`. */
export interface QueryIntent {
  reason: 'interrogative' | 'report_verb' | 'keyword';
}

const INTERROGATIVE_LEAD_RE = /^(how|what|which|who|when)\b/;

const REPORT_VERB_LEAD_RE = /^(show me|show|list|compare|chart|graph|breakdown|add up)\b/;

const TOTAL_WORD_RE = /\b(total|sum|average)\b/;
const SPEND_WORD_RE = /\b(spent|spend|spending|income|earned|expenses?)\b/;
const NET_WORTH_RE = /\bnet worth\b/;
const BALANCE_HISTORY_RE = /\bbalance history\b/;
const BIGGEST_EXPENSE_RE = /\b(biggest|largest|highest)\s+(expense|spend|purchase|payment)\b/;

/** Any numeric run ("50", "$45", "20.50") — the raw candidate for a "stated
 *  amount"; year/duration exclusions (below) are applied per-match by
 *  `hasStatedAmount`, not baked into this regex. */
const AMOUNT_TOKEN_RE = /[$£€]?\d[\d,]*(?:\.\d+)?/g;

/** A 4-digit calendar year, 1900-2099. Only excluded from "stated amount"
 *  when immediately preceded by "in" (see `hasStatedAmount`) — a bare
 *  4-digit number elsewhere ("spent a total of 2000 on rent") stays a real
 *  amount rather than being misread as a year. */
const YEAR_DIGITS_RE = /^(19|20)\d{2}$/;
const YEAR_LEAD_RE = /\bin\s*$/;

/** A duration UNIT immediately after the number ("6 MONTHS") or a duration
 *  LEAD word immediately before it ("the LAST 6 …") — either means the
 *  number describes a time span, not an amount of money. */
const DURATION_UNIT_RE = /^(day|week|month|year)s?\b/;
const DURATION_LEAD_RE = /\b(last|past|next)\s*$/;

/**
 * True when `t` (already trimmed/lowercased) contains at least one numeric
 * run that is a genuine STATED SPENDING AMOUNT — i.e. not a calendar year
 * ("in 2025") and not part of a duration expression ("6 months", "the last 6
 * …"). See the module header's QA MAJOR A note for the full rationale.
 */
function hasStatedAmount(t: string): boolean {
  const re = new RegExp(AMOUNT_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const digitsOnly = m[0].replace(/[^0-9]/g, '');
    if (!digitsOnly) continue;

    const before = t.slice(0, m.index);
    if (YEAR_DIGITS_RE.test(digitsOnly) && YEAR_LEAD_RE.test(before)) continue;

    const after = t.slice(m.index + m[0].length).replace(/^[,\s]+/, '');
    if (DURATION_UNIT_RE.test(after)) continue;
    if (DURATION_LEAD_RE.test(before)) continue;

    return true; // a genuine stated amount survives every exclusion
  }
  return false;
}

/**
 * Deterministic query-intent gate. Returns `{ reason }` on a hit, or `null`
 * when the text isn't recognised as a question/report about the user's own
 * data — including ordinary expenses ("spent 20 on lunch") and account
 * commands, both of which must fall through to their own gates/ladders
 * instead. See the module header for the shape rules, the stated-amount
 * exclusion (and its year/duration carve-outs), and the documented "show me
 * the money" false-widening.
 */
export function detectQueryIntent(text: string): QueryIntent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  if (INTERROGATIVE_LEAD_RE.test(t)) return { reason: 'interrogative' };
  if (REPORT_VERB_LEAD_RE.test(t)) return { reason: 'report_verb' };
  if (NET_WORTH_RE.test(t) || BALANCE_HISTORY_RE.test(t)) return { reason: 'keyword' };
  if (BIGGEST_EXPENSE_RE.test(t)) return { reason: 'keyword' };
  if (TOTAL_WORD_RE.test(t) && SPEND_WORD_RE.test(t) && !hasStatedAmount(t)) {
    return { reason: 'keyword' };
  }

  return null;
}
