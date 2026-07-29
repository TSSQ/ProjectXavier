/**
 * Pure field-comparison scoring for the parse eval harness (dev tooling —
 * never ships). JS port of `evals/scoring.py`, kept EXACTLY equivalent (see
 * `evals/test-score.mjs`, which mirrors `evals/test_scoring.py`'s cases to
 * prove the two agree) so `npm run eval` doesn't need a Python venv to gate
 * the pipeline. See docs/design/parse-eval-pipeline-spec.md.
 *
 * CRITICAL: no parse/prompt logic lives here — only comparing an engine's
 * already-produced `AiParsedExpense` (or `null`) to hand-labeled ground truth
 * from dataset.jsonl. `evals/engines/run_node.mjs` is the only place that
 * runs real production parse code; this module is a thin, framework-free
 * comparator.
 */

// The five possible scored fields, named after the dataset's `expected` keys.
export const FIELDS = ['amountMinor', 'sign', 'dateISO', 'category', 'payee'];

// `amountMinor`/`sign`/`dateISO` are scored on every case (the label always
// asserts them). `category`/`payee` are ASSERTED fields — the dataset's
// labels were traced from the heuristic, so they're `null` on many cases
// where a real model legitimately proposes a value the heuristic never
// could; scoring a null label against a non-null model guess would unfairly
// tank a model engine's accuracy on cases the label simply never spoke to.
// So these two are scored ONLY when `expected[field]` is non-null — see
// `scoreCase` below.
const OBJECTIVE_FIELDS = ['amountMinor', 'sign', 'dateISO'];
const OPTIONAL_FIELDS = ['category', 'payee'];

/** Trim, collapse inner whitespace, lowercase — mirrors
 *  `src/domain/textMatch.ts`'s `normalizeName`, which `category`/`payee`
 *  matching is scored against. Kept in sync by hand: this file is
 *  intentionally plain JS (comparison only, mirroring scoring.py), so it
 *  does not import the real TS helper directly — that keeps this scorer
 *  runnable with plain `node`, no `tsx`/TS loader required. */
export function normalizeName(name) {
  if (name === null || name === undefined) return null;
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** `occurredAtMs` (epoch ms, from the parsed `AiParsedExpense.occurredAt`)
 *  vs. `expectedDateIso` (a bare YYYY-MM-DD). Compared as a UTC calendar date
 *  since the Node runner pins TZ=UTC (see run_node.mjs) for reproducible
 *  relative/absolute date resolution. */
function dateMatches(occurredAtMs, expectedDateIso) {
  if (occurredAtMs == null || expectedDateIso == null) {
    return occurredAtMs == null && expectedDateIso == null;
  }
  const got = new Date(occurredAtMs).toISOString().slice(0, 10);
  return got === expectedDateIso;
}

/**
 * Score one engine's parse of one case against its expected ground truth.
 *
 * `expected === null` marks a "should fail to parse" case (dataset.jsonl's
 * `expected: null`) — correct iff the engine also returned `null`. This
 * mirrors the harness's own definition of a "usable parse" (see
 * run_node.mjs's `usableOrNull`, itself the app's real `isUsefulDeviceParse`).
 *
 * `category`/`payee` are ASSERTED fields: they're only added to `fields` (and
 * so only count toward `overall`) when `expected[field]` is non-null. A case
 * whose label leaves them `null` neither passes nor fails on them — they're
 * simply absent from the returned `fields` object, which keeps `overall`
 * meaning "every field the label actually asserted was correct" rather than
 * penalizing a model for proposing a category/payee the (heuristic-traced)
 * label never spoke to.
 *
 * Returns:
 *   { failToParseCase, correct (only for fail-to-parse cases), fields, overall }
 */
export function scoreCase(expected, parse) {
  if (expected === null || expected === undefined) {
    const correct = parse === null || parse === undefined;
    return { failToParseCase: true, correct, fields: {}, overall: correct };
  }

  const fields = {};

  if (parse === null || parse === undefined) {
    // Ground truth exists but the engine produced nothing usable — every
    // OBJECTIVE field is always scored as a miss; an OPTIONAL field only
    // counts as a miss when the label actually asserted it.
    for (const f of OBJECTIVE_FIELDS) fields[f] = false;
    for (const f of OPTIONAL_FIELDS) {
      if (expected[f] != null) fields[f] = false;
    }
    return { failToParseCase: false, fields, overall: false };
  }

  fields.amountMinor = parse.amount === expected.amountMinor;
  fields.sign = parse.type === expected.sign;
  fields.dateISO = dateMatches(parse.occurredAt, expected.dateISO);
  if (expected.category != null) {
    fields.category = normalizeName(parse.category) === normalizeName(expected.category);
  }
  if (expected.payee != null) {
    fields.payee = normalizeName(parse.payee) === normalizeName(expected.payee);
  }
  return { failToParseCase: false, fields, overall: Object.values(fields).every(Boolean) };
}

/**
 * Aggregate per-engine, per-field accuracy + a failing-case drill-down.
 *
 * `cases`: the dataset (each an object with at least `id`, `text`, `expected`).
 * `resultsByEngine`: engine id -> list of run_node.mjs result objects
 *   ({ id, status, parse, reason?, error? }).
 *
 * Returns { [engine]: { skipped, reason?, fieldAccuracy, overallAccuracy,
 *                        failToParseAccuracy, counts, failures, errors } }.
 */
export function aggregate(cases, resultsByEngine) {
  const report = {};
  for (const [engine, results] of Object.entries(resultsByEngine)) {
    if (!results || results.length === 0) {
      report[engine] = { skipped: true, reason: 'no results' };
      continue;
    }
    if (results.every((r) => r.status === 'skipped')) {
      report[engine] = { skipped: true, reason: results[0].reason ?? 'skipped' };
      continue;
    }

    const byId = new Map(results.map((r) => [r.id, r]));
    const fieldCorrect = Object.fromEntries(FIELDS.map((f) => [f, 0]));
    const fieldTotal = Object.fromEntries(FIELDS.map((f) => [f, 0]));
    let overallCorrect = 0;
    let overallTotal = 0;
    let failToParseCorrect = 0;
    let failToParseTotal = 0;
    const failures = [];
    const errors = [];

    for (const c of cases) {
      const r = byId.get(c.id);
      if (!r) continue;
      if (r.status === 'error') {
        errors.push({ id: c.id, text: c.text, error: r.error });
        continue;
      }

      const parse = r.parse ?? null;
      const scored = scoreCase(c.expected ?? null, parse);

      if (scored.failToParseCase) {
        failToParseTotal += 1;
        if (scored.correct) {
          failToParseCorrect += 1;
        } else {
          failures.push({ id: c.id, text: c.text, expected: null, got: parse });
        }
        continue;
      }

      overallTotal += 1;
      // Only tally a field for cases where scoreCase actually scored it —
      // category/payee are ASSERTED fields (absent from `scored.fields` when
      // the label left them null), so their denominators reflect only the
      // cases that assert them, not every case in the dataset.
      for (const f of FIELDS) {
        if (!(f in scored.fields)) continue;
        fieldTotal[f] += 1;
        if (scored.fields[f]) fieldCorrect[f] += 1;
      }
      if (scored.overall) {
        overallCorrect += 1;
      } else {
        failures.push({
          id: c.id,
          text: c.text,
          expected: c.expected,
          got: parse,
          fieldResults: scored.fields,
        });
      }
    }

    report[engine] = {
      skipped: false,
      fieldAccuracy: Object.fromEntries(
        FIELDS.map((f) => [f, fieldTotal[f] ? fieldCorrect[f] / fieldTotal[f] : null])
      ),
      // Denominators alongside the accuracy — for the ASSERTED fields
      // (category/payee) `total` is the count of cases whose label actually
      // asserted that field, not the full case count (see the scoring-fairness
      // note above `scoreCase`).
      fieldCounts: Object.fromEntries(
        FIELDS.map((f) => [f, { correct: fieldCorrect[f], total: fieldTotal[f] }])
      ),
      overallAccuracy: overallTotal ? overallCorrect / overallTotal : null,
      failToParseAccuracy: failToParseTotal ? failToParseCorrect / failToParseTotal : null,
      counts: {
        overallCorrect,
        overallTotal,
        failToParseCorrect,
        failToParseTotal,
      },
      failures,
      errors,
    };
  }
  return report;
}

/**
 * `score(cases, results)` — the harness-facing entry point: per-engine/
 * per-field/overall accuracy plus the list of failing case ids. `results` is
 * the same `{ [engine]: resultsArray }` shape `aggregate` takes; kept as a
 * separate named export (rather than only `aggregate`) per the eval-pipeline
 * spec's naming, and to give callers (`run-eval.mjs`) the failing-case *ids*
 * directly instead of the full failure objects.
 */
export function score(cases, results) {
  const report = aggregate(cases, results);
  for (const engineReport of Object.values(report)) {
    if (engineReport.skipped) continue;
    engineReport.failingCaseIds = [
      ...engineReport.failures.map((f) => f.id),
      ...engineReport.errors.map((e) => e.id),
    ];
  }
  return report;
}
