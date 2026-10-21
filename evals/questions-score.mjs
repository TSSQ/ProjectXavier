/**
 * Scoring for the question eval (dev tooling — never ships; see evals/README.md
 * "Questions"). Runs under `tsx`: it imports the app's real domain code
 * (`executeQueryTool`, `detectIntent`, `periodKey`), never a copy.
 *
 * A case is scored on five axes, each `true`, `false`, or `null` (not
 * applicable to this case):
 *   intent   — the unified gate's routing class (`gateClass`) vs `expect.intent`
 *   tool     — the executed call's tool (the LAST call, which the app renders);
 *              for net worth also point vs series (`expect.series`)
 *   period   — that call's period / `asOf` after the code's override, compared
 *              as a RANGE at the case's `nowISO` (a quarter: its months tiled)
 *   filters  — set equality of the RESOLVED entity names over every call
 *              (each result's `filters[].names`, from src/domain/queryTools.ts,
 *              so a name that did not resolve is not a filter, exactly as the
 *              tool ran)
 *   answer   — `headlineMinor` of the result vs `expect.answerMinor`, exact
 * and passes when every applicable axis is true. Filter resolution lives in
 * queryTools.ts; this scores whatever that file does on the commit measured.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeQueryTool } from '../src/domain/queryTools.ts';
import { resolvePeriodRange } from '../src/domain/periodRange.ts';
import { detectIntent } from '../src/domain/intentGate.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const QUESTIONS_PATH = path.join(__dirname, 'questions.jsonl');
export const QUESTIONS_LEDGER_PATH = path.join(__dirname, 'questions-ledger.json');

/** Every period in the ledger and the dataset is Singapore local time; the
 *  resolver reads the process calendar, so pin it before anything resolves. */
export const QUESTIONS_TZ = 'Asia/Singapore';

export function loadQuestionCases(file = QUESTIONS_PATH) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function loadLedger(file = QUESTIONS_LEDGER_PATH) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The `QueryToolContext` for a case: the fixture ledger, at the case's own
 *  `nowISO`. */
export function toolContextFor(ledger, c) {
  return {
    accounts: ledger.accounts,
    transactions: ledger.transactions,
    categories: ledger.categories,
    payees: ledger.payees,
    now: Date.parse(c.context.nowISO),
  };
}

/** Per-entity use over the ledger — the same shape and rule as the app's
 *  `listGroundingUsage` (src/features/transactions/repository.ts: a count
 *  and the latest `occurredAt` per payee / category id, every row). */
export function ledgerUsage(ledger) {
  const tally = (key) => {
    const out = {};
    for (const t of ledger.transactions) {
      const id = t[key];
      if (id == null) continue;
      const u = (out[id] ??= { count: 0, lastUsedAt: null });
      u.count += 1;
      u.lastUsedAt = u.lastUsedAt == null ? t.occurredAt : Math.max(u.lastUsedAt, t.occurredAt);
    }
    return out;
  };
  return { payees: tally('payeeId'), categories: tally('categoryId') };
}

/** The question context every case carries, straight from the ledger. */
export function contextFromLedger(ledger, nowISO = ledger.nowISO) {
  return {
    categories: ledger.categories.map((c) => ({ name: c.name, kind: c.kind })),
    payees: ledger.payees.map((p) => p.name),
    accounts: ledger.accounts.map((a) => a.name),
    nowISO,
    currency: ledger.currency,
  };
}

/** The routing class the app gives `text`: `query`, `account` (the account
 *  gate's create/update/delete), `other` (the expense ladder — which logs, or
 *  refuses, so `expense` and `refuse` both expect it), or the name of any
 *  other route (tx_op, a budget route) — never a pass for a question label. */
export function gateClass(text) {
  const intent = detectIntent(text);
  if (intent === 'query') return 'query';
  if (intent === 'create' || intent === 'update' || intent === 'delete') return 'account';
  if (intent === null) return 'other';
  return intent;
}

export function expectedGateClass(intent) {
  if (intent === 'query') return 'query';
  if (intent === 'account') return 'account';
  return 'other';
}

/** Whether the gate's route is right for the label. `refuse` (nothing to
 *  log, nothing to answer) is right on the expense ladder (which refuses)
 *  AND on the query path, whose honest "I can answer things like…" reply is
 *  a refusal too — as long as no engine then answers it (see `scoreCase`).
 *  `gateMetrics` still counts a refuse routed to query as a false positive. */
export function gateRouteOk(intent, gate) {
  if (intent === 'refuse') return gate === 'other' || gate === 'query';
  return gate === expectedGateClass(intent);
}

/** The one number a result is scored on, per tool. Chosen so it does not
 *  depend on a free model choice the case does not label (a `limit`, `n` or
 *  `granularity`):
 *   total_spent / total_income  amountMinor
 *   net_worth                   amountMinor, or the series' last point
 *   spending_by_category        the largest slice
 *   top_payees                  the top payee's total
 *   spending_over_time          the series summed
 *   search_transactions         the most recent row's amount (0 when none) */
export function headlineMinor(tool, result) {
  if (!result || typeof result !== 'object') return null;
  switch (tool) {
    case 'total_spent':
    case 'total_income':
      return result.amountMinor ?? null;
    case 'net_worth':
      if (Array.isArray(result.series)) return result.series.at(-1)?.amountMinor ?? 0;
      return result.amountMinor ?? null;
    case 'spending_by_category':
      return result.slices?.[0]?.amountMinor ?? 0;
    case 'top_payees':
      return result.rows?.[0]?.amountMinor ?? 0;
    case 'spending_over_time':
      return (result.series ?? []).reduce((s, p) => s + p.amountMinor, 0);
    case 'search_transactions':
      return result.rows?.[0]?.amountMinor ?? 0;
    default:
      return null;
  }
}

/** Which tool param a resolved name belongs to, by the ledger entity it names. */
function filterParam(ledger, name, tool) {
  if (ledger.categories.some((c) => c.name === name)) return 'category';
  if (ledger.payees.some((p) => p.name === name)) return 'payee';
  if (ledger.accounts.some((a) => a.name === name)) return 'account';
  throw new Error(`filter "${name}" names no ledger entity (tool ${tool})`);
}

const QUARTER_MONTHS = (q) => [3 * (q - 1), 3 * (q - 1) + 1, 3 * (q - 1) + 2];

/** The calls the label describes: one per filter for a union, three month
 *  calls for a quarter (no quarter `PeriodSpec` exists in the code). */
export function expectedCalls(ledger, c) {
  const e = c.expect;
  const periods =
    e.period && typeof e.period === 'object' && e.period.kind === 'quarter'
      ? QUARTER_MONTHS(e.period.quarter).map((month) => ({ kind: 'month', year: e.period.year, month }))
      : [e.period];
  const filterSets = e.filters.length > 1 ? e.filters.map((f) => [f]) : [e.filters];
  const calls = [];
  for (const period of periods) {
    for (const filters of filterSets) {
      const params = {};
      if (e.tool === 'net_worth') {
        if (period) params.asOf = period;
        params.series = e.series === true;
      } else {
        params.period = period;
      }
      if (e.tool === 'spending_over_time') params.granularity = 'month';
      if (e.tool === 'top_payees') params.n = 5;
      if (e.tool === 'search_transactions') params.limit = 10;
      for (const f of filters) params[filterParam(ledger, f, e.tool)] = f;
      calls.push({ tool: e.tool, params });
    }
  }
  return calls;
}

/** The headline the label implies: the expected calls over the ledger,
 *  summed when there are several (a union or a quarter). */
export function expectedAnswerMinor(ledger, c) {
  if (c.expect.intent !== 'query') return null;
  const ctx = toolContextFor(ledger, c);
  const calls = expectedCalls(ledger, c);
  let sum = 0;
  for (const call of calls) sum += headlineMinor(call.tool, executeQueryTool(ctx, call));
  return sum;
}

/** The entity names the call's filters actually applied: every named
 *  filter's resolution (`filters[].names`, src/domain/queryFilterResolution.ts
 *  — a union lists each member), else the older single-name fields. */
function resolvedNames(result) {
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.filters)) return result.filters.flatMap((f) => (Array.isArray(f?.names) ? f.names : []));
  return [result.resolvedCategory, result.resolvedPayee, result.resolvedAccount].filter(
    (n) => typeof n === 'string' && n.length > 0
  );
}

const isQuarter = (p) => !!p && typeof p === 'object' && p.kind === 'quarter';

/** `[start, end)` of a labelled period at `now` — a quarter is its three
 *  months (no quarter `PeriodSpec` in the code yet). */
function rangeOf(p, now) {
  if (isQuarter(p)) {
    const first = resolvePeriodRange({ kind: 'month', year: p.year, month: 3 * (p.quarter - 1) }, now);
    const last = resolvePeriodRange({ kind: 'month', year: p.year, month: 3 * (p.quarter - 1) + 2 }, now);
    return { start: first.start, end: last.end };
  }
  return resolvePeriodRange(p, now);
}

/** Whether the calls' periods cover exactly the labelled one. Compared as
 *  RANGES, so `this_month` and an explicit October are the same answer in
 *  October. A quarter passes when the calls' distinct periods tile it
 *  exactly (three month calls), or one call already spans it. Net worth
 *  "now" (`null`) matches only an absent `asOf`. */
function periodMatches(expected, periods, now) {
  if (expected == null) return periods.length > 0 && periods.every((p) => p == null);
  if (periods.some((p) => p == null)) return false;
  const want = rangeOf(expected, now);
  const ranges = [...new Map(periods.map((p) => [JSON.stringify(p), resolvePeriodRange(p, now)])).values()].sort(
    (a, b) => a.start - b.start
  );
  if (!isQuarter(expected) || ranges.length === 1) {
    const r = ranges[ranges.length - 1];
    return r.start === want.start && r.end === want.end;
  }
  let cursor = want.start;
  for (const r of ranges) {
    if (r.start !== cursor) return false;
    cursor = r.end;
  }
  return cursor === want.end;
}

const callPeriod = (k) => (k.tool === 'net_worth' ? k.params.asOf : k.params.period);

/**
 * Score one case. `served` is what an engine produced for it AFTER the gate:
 * `{ calls: [{ tool, params, result }] }` (one call for the floor / FM, any
 * number for the cloud loop), or `null` when the engine produced no call
 * (declined, or the floor stood aside). `gate` is `gateClass(text)`.
 */
export function scoreCase(c, { gate, served }) {
  const e = c.expect;
  if (e.intent !== 'query') {
    // A non-question that an engine answered with a number is wrong, even
    // when the gate's route alone was acceptable (a refuse on the query path).
    const answered = (served?.calls ?? []).length > 0;
    const intent = gateRouteOk(e.intent, gate) && !answered;
    return { axes: { intent, tool: null, period: null, filters: null, answer: null }, pass: intent, answered };
  }
  const intent = gate === expectedGateClass(e.intent);
  const calls = served?.calls ?? [];
  if (calls.length === 0) {
    const axes = { intent, tool: false, period: false, filters: false, answer: false };
    return { axes, pass: false, answered: false };
  }
  const now = Date.parse(c.context.nowISO);
  const last = calls[calls.length - 1];
  // Net worth: point vs series is part of picking the right tool call.
  const tool = last.tool === e.tool && (e.tool !== 'net_worth' || (last.params.series === true) === (e.series === true));
  const union = e.filters.length > 1 || isQuarter(e.period);
  // A union / quarter is answered by several calls: score the distinct calls
  // of the expected tool whose applied filters belong to the label (an
  // exploratory unfiltered or duplicate call neither counts nor inflates).
  const wanted = new Set(e.filters);
  const parts = union
    ? [...new Map(
        calls
          .filter((k) => k.tool === e.tool)
          .filter((k) => {
            const names = resolvedNames(k.result);
            return e.filters.length === 0 ? names.length === 0 : names.length > 0 && names.every((n) => wanted.has(n));
          })
          .map((k) => [JSON.stringify([k.tool, callPeriod(k) ?? null, resolvedNames(k.result).sort()]), k])
      ).values()]
    : [last];
  const actualPeriod = callPeriod(last);
  const period = periodMatches(e.period, (union && parts.length ? parts : [last]).map(callPeriod), now);
  const actualFilters = [...new Set(calls.flatMap((k) => resolvedNames(k.result)))].sort();
  const filters = JSON.stringify(actualFilters) === JSON.stringify([...e.filters].sort());
  const actualAnswer = union
    ? parts.reduce((sum, k) => sum + (headlineMinor(k.tool, k.result) ?? 0), 0)
    : headlineMinor(last.tool, last.result);
  const answer = actualAnswer === e.answerMinor;
  const axes = { intent, tool, period, filters, answer };
  return {
    axes,
    pass: intent && tool && period && filters && answer,
    answered: true,
    actual: { tool: last.tool, period: actualPeriod ?? null, filters: actualFilters, answerMinor: actualAnswer },
  };
}

/** Gate precision / recall for the `query` class, plus the costly error: a
 *  question the gate hands to the expense ladder (which may log it). */
export function gateMetrics(rows) {
  let tp = 0, fp = 0, fn = 0, queryToLadder = 0;
  for (const r of rows) {
    const isQuery = r.case.expect.intent === 'query';
    const saidQuery = r.gate === 'query';
    if (isQuery && saidQuery) tp++;
    else if (!isQuery && saidQuery) fp++;
    else if (isQuery && !saidQuery) {
      fn++;
      if (r.gate === 'other') queryToLadder++;
    }
  }
  return {
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    questionsToExpenseLadder: queryToLadder,
  };
}

/** Per-axis `{ correct, total, accuracy }` over the rows where the axis applies. */
export function axisBreakdown(rows) {
  const out = {};
  for (const axis of ['intent', 'tool', 'period', 'filters', 'answer']) {
    const applicable = rows.filter((r) => r.score && r.score.axes[axis] !== null);
    const correct = applicable.filter((r) => r.score.axes[axis]).length;
    out[axis] = { correct, total: applicable.length, accuracy: applicable.length ? correct / applicable.length : null };
  }
  return out;
}
